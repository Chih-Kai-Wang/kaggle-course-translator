(() => {
  if (globalThis.KCTSiteAnalyzer) return;

  const BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, td, th, figcaption, summary, dt, dd';

  const SKIP_ANCESTOR_SELECTOR = [
    '[data-kct-ui]',
    '[translate="no"]',
    '.notranslate',
    'pre',
    'code',
    'kbd',
    'samp',
    'var',
    'textarea',
    'input',
    'select',
    'option',
    'svg',
    'canvas',
    'script',
    'style',
    'noscript',
    '.CodeMirror',
    '.cm-editor',
    '.monaco-editor',
    '.blob-code',
    '.react-code-lines',
    '.jp-CodeCell .jp-InputArea',
    '.jp-InputPrompt',
    '.jp-CodeMirrorEditor',
    '.jp-OutputArea-prompt',
    '.jp-CodeCell .jp-OutputArea-output',
    '.jp-OutputArea-executeResult',
    '.output_result',
    '.output_subarea',
    '.katex',
    '.MathJax',
    'mjx-container',
    'table.dataframe',
    '.dataframe',
    '.material-icons',
    '.material-icons-outlined',
    '.material-symbols-outlined',
    '.material-symbols-rounded',
    '.google-symbols',
    '.anchor-link',
    '.jp-InternalAnchorLink',
    '[contenteditable="true"]'
  ].join(', ');

  const NAV_EXCLUDE_SELECTOR = [
    'nav',
    'footer',
    'aside',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="complementary"]',
    '[role="contentinfo"]',
    '[role="tablist"]',
    'button'
  ].join(', ');

  const LESSON_CELL_SELECTOR = [
    '.jp-RenderedHTMLCommon',
    '.jp-MarkdownOutput',
    '.rendered_html',
    '.text_cell_render',
    '.markdown-converter__text--rendered'
  ].join(', ');

  const COURSE_CONTAINER_SELECTOR = [
    LESSON_CELL_SELECTOR,
    'main',
    'article',
    '[role="main"]'
  ].join(', ');

  const SEMANTIC_ROOT_SELECTOR = [
    LESSON_CELL_SELECTOR,
    'article',
    'main',
    '[role="main"]',
    '.markdown-body',
    '.rst-content',
    '.wy-nav-content',
    '.md-content',
    '.vp-doc',
    '.theme-doc-markdown',
    '.prose',
    '.post-content',
    '.article-content',
    '.entry-content',
    '#mw-content-text',
    '[itemprop="articleBody"]'
  ].join(', ');

  const INLINE_PROTECT_SELECTOR = 'code, kbd, var, .katex, .MathJax, mjx-container, math, .mwe-math-element, sup.reference';

  const SHADOW_SKIP_SELECTOR = '[data-kct-ui], script, style, svg, pre, code, noscript, template, iframe, .cm-editor, .CodeMirror, .monaco-editor';

  const PROSE_TAGS = new Set(['P', 'LI', 'BLOCKQUOTE', 'DD', 'FIGCAPTION']);

  const LEAF_CANDIDATE_TAGS = new Set(['DIV', 'SPAN', 'A', 'LABEL', 'BUTTON']);

  const CHILD_BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, ul, ol, blockquote, table, td, th, section, article, main, nav, aside, header, footer, form, div, pre, hr, iframe, figure, figcaption, details, summary, dl, dt, dd, fieldset, dialog';

  const LEAF_FORBIDDEN_DESCENDANT_SELECTOR = 'button, input, select, textarea, img, picture, video, audio, canvas, svg, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [contenteditable="true"], .material-icons, .material-icons-outlined, .material-symbols-outlined, .material-symbols-rounded, .google-symbols';

  const LEAF_UI_CONTROL_SELECTOR = 'button, [role="button"], [role="menu"], [role="menuitem"], [role="tab"], time, [datetime]';

  const PURE_METADATA_REGEX = /^(?:@\w+|\d[\d,.]*\s*(?:k|m|b|views?|likes?|replies?|comments?|points?|hours?|mins?|minutes?|days?|weeks?|months?|years?|ago|entries|teams|votes?)?)$/i;

  const TECH_TITLE_REGEX = /\b(machine learning|deep learning|neural network|llm|transformer|python|pytorch|tensorflow|pandas|scikit|sklearn|kaggle|dataset|algorithm|gradient|xgboost|lightgbm|regression|classification|reinforcement learning|data science|jupyter|notebook|api|sdk|typescript|javascript|kubernetes|docker)\b/i;

  function isTopFrame() {
    try {
      return window === window.top;
    } catch (_) {
      return false;
    }
  }

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('[hidden], .sr-only, [aria-hidden="true"]')) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  }

  function isInsideExcludedChrome(el) {
    if (el.closest(NAV_EXCLUDE_SELECTOR)) return true;
    const hdr = el.closest('header');
    if (hdr) {
      // Allow <article><header><h1>...</h1></header></article> while excluding top site navbars
      const insideContent = Boolean(hdr.closest('article, main, [role="main"]'));
      const isSiteBanner = hdr.getAttribute('role') === 'banner' || Boolean(hdr.querySelector('nav'));
      if (!insideContent || isSiteBanner) return true;
    }
    return false;
  }

  function extractMicroTitle() {
    const docTitle = String(document.title || '').replace(/\s+/g, ' ').trim();
    const h1El = document.querySelector('main h1, article h1, h1');
    const h1Text = h1El ? String(h1El.textContent || '').replace(/\s+/g, ' ').replace(/\s*¶\s*$/, '').trim() : '';

    let combined = docTitle;
    if (h1Text) {
      const probe = h1Text.slice(0, 24).toLowerCase();
      if (!docTitle) {
        combined = h1Text;
      } else if (!docTitle.toLowerCase().includes(probe)) {
        combined = `${h1Text} — ${docTitle}`;
      }
    }
    return combined.slice(0, 120);
  }

  function classifyPage() {
    const host = String(location.hostname || '').toLowerCase();
    const title = extractMicroTitle();
    const hasCodeWidgets = Boolean(
      document.querySelector('pre, .cm-editor, .CodeMirror, .monaco-editor, .jp-Cell')
    );
    const useTechGlossary = Boolean(
      hasCodeWidgets ||
      document.querySelector('.katex, .MathJax, mjx-container, .markdown-body') ||
      TECH_TITLE_REGEX.test(title)
    );

    return {
      pageType: 'universal',
      hasCodeWidgets,
      title,
      host,
      useTechGlossary
    };
  }

  function dedupeTopmost(nodes) {
    return nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
  }

  function scoreReadabilityContainer(el) {
    if (!el || !isElementVisible(el)) return { score: 0, textLen: 0, linkRatio: 1 };
    const blocks = el.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, figcaption');
    let textLen = 0;
    let linkLen = 0;
    let pCount = 0;

    for (const b of blocks) {
      if (b.closest('[data-kct-ui], nav, footer, aside, [role="navigation"], [role="banner"], [role="complementary"], pre, code, script, style')) {
        continue;
      }
      const txt = String(b.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt.length < 4) continue;
      textLen += txt.length;
      if (b.tagName === 'P' && txt.length >= 25) pCount += 1;

      const links = b.querySelectorAll('a');
      for (const a of links) {
        linkLen += String(a.textContent || '').replace(/\s+/g, ' ').trim().length;
      }
    }

    // Modern SPA fallback: when semantic containers use div/span instead of <p>
    if (textLen < 30) {
      let sampled = 0;
      const leaves = el.querySelectorAll('div, span');
      for (const node of leaves) {
        if (sampled >= 80) break;
        if (node.querySelector('div, p, li, nav, footer, aside, header')) continue;
        if (node.closest('[data-kct-ui], nav, footer, aside, [role="navigation"], [role="banner"], [role="complementary"], pre, code, script, style, button')) {
          continue;
        }
        const txt = String(node.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt.length < 12 || PURE_METADATA_REGEX.test(txt)) continue;
        textLen += txt.length;
        sampled += 1;
        if (node.closest('a')) linkLen += txt.length;
      }
    }

    if (textLen < 30) {
      return { score: textLen * 0.1, textLen, linkRatio: 1 };
    }

    const linkRatio = Math.min(1, linkLen / textLen);
    let score = textLen + pCount * 40;
    if (linkRatio > 0.55) {
      score *= Math.max(0.05, 1 - linkRatio);
    }

    if (
      el.tagName === 'ARTICLE' ||
      el.id === 'mw-content-text' ||
      el.matches('.markdown-body, .rst-content, .post-content, .article-content, .entry-content, .vp-doc, .theme-doc-markdown, [itemprop="articleBody"]')
    ) {
      score *= 1.25;
    }

    return { score, textLen, linkRatio };
  }

  function findContentRoots(scope) {
    if (scope === 'all') {
      return [document.body].filter(Boolean);
    }

    // Generic interactive IDE shell skip: cells live inside the editor's embedded iframe
    if (isTopFrame() && document.querySelector('[data-testid="notebook-editor-render-tid"]')) {
      return [];
    }

    // Dedicated multi-page document viewer containers (e.g. Google Drive PDF Viewer)
    const gdrivePages = Array.from(document.querySelectorAll('.ndfHFb-c4YZDc-cYSp0e-DARUcf'));
    if (gdrivePages.length > 0) {
      return [document.body];
    }
    const gdrivePdfRoot = document.querySelector(
      '.ndfHFb-c4YZDc-cYSp0e-DARUcf-gSKZZ, .ndfHFb-c4YZDc-cYSp0e-s2gQvd'
    );
    if (gdrivePdfRoot && isElementVisible(gdrivePdfRoot)) {
      return [document.body];
    }

    // Dedicated embedded rendered-cell containers (e.g. Jupyter / Notebook outputs)
    const cells = Array.from(document.querySelectorAll(LESSON_CELL_SELECTOR)).filter(
      (node) => isElementVisible(node) && !node.closest('[data-testid="notebook-editor-render-tid"]')
    );
    if (cells.length > 0) {
      const dedupedCells = dedupeTopmost(cells);
      const h1 = document.querySelector('main h1');
      if (h1 && isElementVisible(h1) && !dedupedCells.some((c) => c.contains(h1))) {
        return [h1, ...dedupedCells];
      }
      return dedupedCells;
    }

    // Universal main-content detection via semantic containers + Readability scoring
    const semanticNodes = Array.from(document.querySelectorAll(SEMANTIC_ROOT_SELECTOR)).filter(
      (node) =>
        isElementVisible(node) &&
        !node.closest('[data-kct-ui], [data-testid="notebook-editor-render-tid"], nav, footer, aside, [role="navigation"], [role="complementary"]')
    );

    if (semanticNodes.length > 0) {
      const scored = semanticNodes
        .map((node) => ({ node, ...scoreReadabilityContainer(node) }))
        .filter((item) => item.score >= 30);

      if (scored.length > 0) {
        // Prefer tighter inner semantic containers (e.g. <article> inside <main>) when they capture main content cleanly
        const refined = scored.filter((outer) => {
          const betterInner = scored.some((inner) => (
            inner !== outer &&
            outer.node.contains(inner.node) &&
            inner.textLen >= outer.textLen * 0.65 &&
            inner.linkRatio <= outer.linkRatio + 0.08
          ));
          return !betterInner;
        });

        const maxScore = Math.max(...refined.map((x) => x.score));
        const winners = refined
          .filter((x) => x.score >= Math.max(40, maxScore * 0.25))
          .map((x) => x.node);

        const dedupedWinners = dedupeTopmost(winners);
        if (dedupedWinners.length > 0) {
          const topH1 = document.querySelector('#firstHeading, main h1, article h1, [role="main"] h1');
          if (topH1 && isElementVisible(topH1) && !dedupedWinners.some((w) => w.contains(topH1))) {
            return [topH1, ...dedupedWinners];
          }
          return dedupedWinners;
        }
      }
    }

    // Readability fallback on div/section containers for non-semantic layouts
    if (document.body) {
      const rawCandidates = [];
      const seenParents = new Set();
      const paragraphs = document.querySelectorAll('p, blockquote');
      for (const p of paragraphs) {
        if (p.closest('[data-kct-ui], nav, header, footer, aside, [role="navigation"], [role="banner"], [role="complementary"]')) {
          continue;
        }
        const parent = p.parentElement;
        if (!parent || parent === document.body || seenParents.has(parent)) continue;
        seenParents.add(parent);
        rawCandidates.push(parent);
        if (rawCandidates.length >= 60) break;
      }

      if (rawCandidates.length > 0) {
        const scoredFallback = rawCandidates
          .map((node) => ({ node, ...scoreReadabilityContainer(node) }))
          .filter((x) => x.score >= 120 && x.linkRatio <= 0.55)
          .sort((a, b) => b.score - a.score);

        if (scoredFallback.length > 0) {
          const topScore = scoredFallback[0].score;
          const selected = scoredFallback
            .filter((x) => x.score >= topScore * 0.35)
            .slice(0, 6)
            .map((x) => x.node);
          const deduped = dedupeTopmost(selected);
          if (deduped.length > 0) return deduped;
        }
      }

      return [document.body];
    }

    return [];
  }

  function queryAllDeep(root, selector, depth = 0) {
    const results = [];
    if (!root || depth > 5) return results;

    if (root.nodeType === Node.ELEMENT_NODE) {
      if (root.matches(SHADOW_SKIP_SELECTOR)) return results;
      if (root.matches(selector)) {
        results.push(root);
      }
    }

    try {
      const directMatches = root.querySelectorAll(selector);
      for (const el of directMatches) {
        results.push(el);
      }
    } catch (_) {
      return results;
    }

    if (depth >= 5) return results;

    // Traverse open shadowRoot hosts without entering skipped subtrees
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node.matches && node.matches(SHADOW_SKIP_SELECTOR)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let current;
    while ((current = walker.nextNode())) {
      if (current.shadowRoot) {
        const nested = queryAllDeep(current.shadowRoot, selector, depth + 1);
        for (const item of nested) {
          results.push(item);
        }
      }
    }

    return results;
  }

  function shouldTranslateText(text, targetLangId = 'zh-TW') {
    const clean = String(text || '').replace(/\[\[\s*\/?[CMLAS]\d+\s*\]\]/g, '').trim();
    if (clean.length < 2) return false;

    // Skip URLs, emails, file paths, and Jupyter cell prompts
    if (/^(?:https?:\/\/|mailto:|ftp:\/\/)\S+$/i.test(clean)) return false;
    if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(clean)) return false;
    if (/^(?:\/[\w.@+-]+){2,}\/?$/.test(clean)) return false;
    if (/^[a-zA-Z]:\\[\w\\.-]+$/.test(clean)) return false;
    if (/^(In|Out)\s*\[\s*\d*\s*\]:?$/i.test(clean)) return false;

    // Skip ASCII single-token code identifiers like train_test_split or model.fit(X, y)
    const isAsciiOnly = /^[\x00-\x7F]+$/.test(clean);
    if (isAsciiOnly) {
      if (clean.length < 3) return false;
      if (!/[a-zA-Z]{2,}/.test(clean)) return false;
      if (!/\s/.test(clean) && /[_().=<>[\]{}:/\\]/.test(clean)) return false;
    }

    const letters = clean.match(/\p{L}/gu) || [];
    if (letters.length < 2) return false;

    const letterTotal = letters.length;
    const hanCount = (clean.match(/\p{Script=Han}/gu) || []).length;
    const kanaCount = (clean.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
    const hangulCount = (clean.match(/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/g) || []).length;

    const target = String(targetLangId || 'zh-TW');

    if (target === 'zh-TW' || target === 'zh-CN') {
      // If text has meaningful Hiragana/Katakana, it is Japanese -> DO translate into Chinese
      if (kanaCount / letterTotal >= 0.12) {
        return true;
      }
      const cjkRatio = hanCount / letterTotal;
      if (cjkRatio >= 0.55) {
        // Check if there is still a substantial foreign sentence mixed in (e.g. >= 6 Latin words)
        const latinWords = clean.match(/[a-zA-Z]{2,}/g) || [];
        if (latinWords.length < 6) {
          return false;
        }
      }
    } else if (target === 'ja') {
      const kanaRatio = kanaCount / letterTotal;
      const jpRatio = (hanCount + kanaCount) / letterTotal;
      if (kanaRatio >= 0.15 && jpRatio >= 0.45) {
        return false;
      }
    } else if (target === 'ko') {
      if (hangulCount / letterTotal >= 0.45) {
        return false;
      }
    }

    return true;
  }

  const renderedSerifCache = new Map();
  const KNOWN_SANS_RE = /sans|helvetica|arial|roboto|inter|system-ui|-apple-system|segoe|noto sans|pingfang|droid sans|verdana|tahoma|open sans|lato|montserrat/i;

  function detectRenderedSerif(family) {
    const clean = String(family || '').replace(/^['"]+|['"]+$/g, '').trim();
    if (!clean) return false;
    if (renderedSerifCache.has(clean)) {
      return renderedSerifCache.get(clean);
    }

    let isSerif = false;
    try {
      const safeName = clean.replace(/"/g, '\\"');
      if (document.fonts && document.fonts.check(`16px "${safeName}"`)) {
        const W = 160;
        const H = 180;
        const canvas = typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(W, H)
          : document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.clearRect(0, 0, W, H);
          ctx.fillStyle = '#000';
          ctx.textBaseline = 'top';
          ctx.font = `400 120px "${safeName}", monospace`;
          ctx.fillText('I', 20, 20);

          const data = ctx.getImageData(0, 0, W, H).data;
          const rowWidths = [];
          for (let y = 0; y < H; y++) {
            let minX = -1;
            let maxX = -1;
            const rowOffset = y * W * 4;
            for (let x = 0; x < W; x++) {
              if (data[rowOffset + x * 4 + 3] > 32) {
                if (minX === -1) minX = x;
                maxX = x;
              }
            }
            if (minX !== -1) {
              rowWidths.push(maxX - minX + 1);
            }
          }

          const n = rowWidths.length;
          if (n >= 10) {
            const topCount = Math.max(1, Math.ceil(n * 0.1));
            let topWidth = 0;
            for (let i = 0; i < topCount; i++) {
              if (rowWidths[i] > topWidth) topWidth = rowWidths[i];
            }

            const midStart = Math.floor(n * 0.3);
            const midEnd = Math.max(midStart + 1, Math.ceil(n * 0.7));
            const midSlice = rowWidths.slice(midStart, midEnd).sort((a, b) => a - b);
            const midMedian = midSlice[Math.floor(midSlice.length / 2)] || 0;

            if (midMedian > 0 && (topWidth / midMedian) >= 1.8) {
              isSerif = true;
            }
          }
        }
      }
    } catch {
      isSerif = false;
    }

    renderedSerifCache.set(clean, isSerif);
    return isSerif;
  }

  function probeTypography(el) {
    const style = getComputedStyle(el);
    const origFontFamily = style.fontFamily || '';
    const ffLower = origFontFamily.toLowerCase();

    let archetype = 'sans';
    if (/(?:^|[\s,'"])(?:mono|monospace|consolas|menlo|monaco|courier|fira\s*code|jetbrains|sfmono|inconsolata|source\s*code|roboto\s*mono|ibm\s*plex\s*mono)/i.test(ffLower)) {
      archetype = 'mono';
    } else {
      const withoutSans = ffLower.replace(/sans-serif/g, '');
      if (/(?:serif|georgia|times|garamond|palatino|charter|merriweather|newsreader|playfair|libre\s*baskerville|baskerville|cambria|minion|source\s*serif|noto\s*serif|pt\s*serif|lora|eb\s*garamond|crimson|mincho|songti|mingliu|pmingliu|simsun)/i.test(withoutSans)) {
        archetype = 'serif';
      } else {
        const firstFamily = origFontFamily.split(',')[0].replace(/^[\s'"]+|[\s'"]+$/g, '');
        if (firstFamily && !KNOWN_SANS_RE.test(firstFamily) && detectRenderedSerif(firstFamily)) {
          archetype = 'serif';
        }
      }
    }

    let needsLineHeightLift = false;
    if (PROSE_TAGS.has(el.tagName)) {
      const lineClamp = style.webkitLineClamp || style.getPropertyValue('-webkit-line-clamp');
      const isClamped = Boolean(lineClamp && lineClamp !== 'none' && lineClamp !== '0');
      if (!isClamped) {
        const fs = parseFloat(style.fontSize);
        const lh = parseFloat(style.lineHeight);
        if (Number.isFinite(fs) && fs > 0 && Number.isFinite(lh) && (lh / fs) < 1.62) {
          needsLineHeightLift = true;
        }
      }
    }

    return {
      archetype,
      needsLineHeightLift,
      origFontFamily
    };
  }

  const PAIRED_STYLE_TAGS = new Set([
    'B', 'STRONG', 'I', 'EM', 'U', 'MARK', 'S', 'SMALL', 'SUB', 'SUP'
  ]);

  function extractBlockContent(el) {
    const placeholders = new Map();
    let codeIdx = 0;
    let mathIdx = 0;
    let linkIdx = 0;
    let anchorIdx = 0;
    let styleIdx = 0;
    let nestedListEl = null;

    function walkChildren(parent, insideLiRoot) {
      const buf = [];
      for (const child of parent.childNodes) {
        walk(child, insideLiRoot, buf);
      }
      return buf.join('');
    }

    function walk(node, insideLiRoot, out) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        out.push(node.nodeValue);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      if (node.matches('[data-kct-ui]')) return;

      // For <li>, stop before nested <ul>/<ol> so we only translate the parent bullet's own text
      if (insideLiRoot && (node.tagName === 'UL' || node.tagName === 'OL')) {
        if (!nestedListEl) nestedListEl = node;
        return;
      }

      if (node.matches(INLINE_PROTECT_SELECTOR)) {
        const isMath = node.matches('.katex, .MathJax, mjx-container, math, .mwe-math-element, sup.reference');
        const token = isMath ? `[[M${mathIdx++}]]` : `[[C${codeIdx++}]]`;
        placeholders.set(token, node);
        out.push(token);
        return;
      }

      if (node.matches('script, style, noscript, svg, canvas, textarea, input, select, .anchor-link, .jp-InternalAnchorLink, .material-icons, .material-symbols-outlined, .material-symbols-rounded, .google-symbols, [aria-hidden="true"]')) {
        return;
      }

      if (node.tagName === 'BR') {
        out.push('\n');
        return;
      }

      if (node.tagName === 'A' && node !== el && node.hasAttribute('href')) {
        const aText = String(node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!aText) return;
        if (!shouldTranslateText(aText)) {
          const token = `[[L${linkIdx++}]]`;
          placeholders.set(token, node);
          out.push(token);
          return;
        }
        const inner = walkChildren(node, insideLiRoot);
        if (!inner.trim()) {
          if (inner) out.push(inner);
          return;
        }
        const id = anchorIdx++;
        const open = `[[A${id}]]`;
        const close = `[[/A${id}]]`;
        placeholders.set(open, node);
        out.push(open, inner, close);
        return;
      }

      if (PAIRED_STYLE_TAGS.has(node.tagName) && node !== el) {
        const inner = walkChildren(node, insideLiRoot);
        if (!inner.trim()) {
          if (inner) out.push(inner);
          return;
        }
        const id = styleIdx++;
        const open = `[[S${id}]]`;
        const close = `[[/S${id}]]`;
        placeholders.set(open, node);
        out.push(open, inner, close);
        return;
      }

      for (const child of node.childNodes) {
        walk(child, insideLiRoot, out);
      }
    }

    const parts = [];
    const isLi = el.tagName === 'LI';
    for (const child of el.childNodes) {
      walk(child, isLi, parts);
    }

    let text = parts.join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (/^H[1-6]$/.test(el.tagName)) {
      text = text.replace(/\s*¶\s*$/g, '').trim();
    }
    return { text, placeholders, nestedListEl };
  }

  // Descend from a block into the single inline chain that holds all of its text (li > a > b),
  // so the translation is rendered INSIDE the original link / emphasis and stays clickable.
  const INLINE_DESCENT_TAGS = new Set([
    'A', 'B', 'STRONG', 'I', 'EM', 'U', 'MARK', 'SMALL',
    'SPAN', 'FONT', 'CITE', 'Q', 'S', 'INS', 'DEL', 'ABBR'
  ]);
  const FORM_CONTROL_SELECTOR = 'input, textarea, select, button, option, optgroup, label, output, meter, progress';

  function resolveInlineHost(block) {
    if (!block || block.nodeType !== Node.ELEMENT_NODE) return block;
    const isStartLi = block.tagName === 'LI';
    let cur = block;

    while (true) {
      let onlyChildEl = null;
      let blocked = false;

      for (const child of cur.childNodes) {
        if (child.nodeType === Node.COMMENT_NODE) continue;
        if (child.nodeType === Node.TEXT_NODE) {
          if (child.nodeValue && child.nodeValue.trim().length > 0) {
            blocked = true;
            break;
          }
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) {
          blocked = true;
          break;
        }
        if (child.matches('[data-kct-ui]')) continue;
        if (isStartLi && (child.tagName === 'UL' || child.tagName === 'OL')) continue;

        if (onlyChildEl) {
          blocked = true;
          break;
        }
        onlyChildEl = child;
      }

      if (blocked || !onlyChildEl) break;
      if (!INLINE_DESCENT_TAGS.has(onlyChildEl.tagName)) break;
      if (onlyChildEl.matches(INLINE_PROTECT_SELECTOR)) break;
      if (onlyChildEl.matches(FORM_CONTROL_SELECTOR)) break;

      cur = onlyChildEl;
    }

    return cur;
  }

  function parsePctBoxStyle(styleStr) {
    if (!styleStr) return null;
    const get = (k) => {
      const m = styleStr.match(new RegExp(`(?:^|;|\\s)${k}\\s*:\\s*([\\d.]+)%`, 'i'));
      return m ? parseFloat(m[1]) : null;
    };
    const left = get('left');
    const top = get('top');
    const width = get('width');
    const height = get('height');
    if (left === null || top === null || width === null || height === null) return null;
    return { left, top, width, height };
  }

  const PDF_TOC_LINE_REGEX = /^(.*\p{L}.*?)[\s.·•…_\-–—]+(\d{1,4}|[ivxlcdm]{1,7})$/iu;

  // Table-of-contents rows ("Title ........ 12") are single lines whose page numbers share one right edge.
  // Require >= 3 aligned rows on the same page so body lines that merely end in a number are never caught.
  function detectPdfTocEntries(groups) {
    const result = new Map();
    const candidates = [];
    for (const g of groups) {
      if (g.lineCount !== 1) continue;
      const m = g.text.match(PDF_TOC_LINE_REGEX);
      if (!m) continue;
      const title = m[1].replace(/[\s.·•…_]+$/u, '').trim();
      if (title.length < 2) continue;
      candidates.push({ g, title, num: m[2], right: g.left + g.width });
    }
    if (candidates.length < 3) return result;

    const rights = candidates.map((c) => c.right).sort((a, b) => a - b);
    const medianRight = rights[Math.floor(rights.length / 2)];
    const aligned = candidates.filter((c) => Math.abs(c.right - medianRight) <= 1.2);
    if (aligned.length < 3) return result;

    for (const c of aligned) {
      result.set(c.g, { title: c.title, num: c.num });
    }
    return result;
  }

  function preparePdfOverlayLayers(roots) {
    const searchRoots = Array.isArray(roots) && roots.length > 0 ? roots : [document.body];
    const layerSelector = '.ndfHFb-c4YZDc-cYSp0e-DARUcf-Df1ZY-bN97Pc-haAclf';
    const layers = new Set();

    for (const r of searchRoots) {
      if (!r || r.nodeType !== Node.ELEMENT_NODE) continue;
      if (r.matches && r.matches(layerSelector)) layers.add(r);
      const found = r.querySelectorAll ? r.querySelectorAll(layerSelector) : [];
      for (const l of found) layers.add(l);
    }

    for (const layer of layers) {
      layer.setAttribute('data-kct-pdf-layer', '1');
      const ps = Array.from(layer.querySelectorAll('p'));
      if (ps.length === 0) continue;

      if (
        layer.getAttribute('data-kct-pdf-merged-count') === String(ps.length) &&
        layer.querySelector('p[data-kct-pdf-block="1"]')
      ) {
        continue;
      }

      // Skip if any <p> in this layer is already wrapped with active translation spans
      if (layer.querySelector('p[data-kct-has-trans="1"]')) {
        continue;
      }

      const items = [];
      for (const p of ps) {
        if (!p.hasAttribute('data-kct-orig-style')) {
          p.setAttribute('data-kct-orig-style', p.getAttribute('style') || '');
        }
        if (!p.hasAttribute('data-kct-orig-text')) {
          p.setAttribute('data-kct-orig-text', p.textContent || '');
        }
        p.removeAttribute('data-kct-pdf-merged');
        p.removeAttribute('data-kct-pdf-block');

        const origStyle = p.getAttribute('data-kct-orig-style') || '';
        const box = parsePctBoxStyle(origStyle);
        const origText = (p.getAttribute('data-kct-orig-text') || '').replace(/\s+/g, ' ').trim();
        if (!box || !origText) continue;

        items.push({
          el: p,
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          text: origText
        });
      }

      if (items.length === 0) continue;

      items.sort((a, b) => (Math.abs(a.top - b.top) > 0.55 ? a.top - b.top : a.left - b.left));

      const groups = [];
      for (const item of items) {
        let matchedGroup = null;
        for (let gi = groups.length - 1; gi >= 0; gi--) {
          const candidate = groups[gi];
          const prevBottom = candidate.top + candidate.height;
          const vGap = item.top - prevBottom;
          if (vGap > 1.2 * Math.max(candidate.avgLineH, item.height, 1)) {
            continue;
          }
          const hRatio = Math.abs(item.height - candidate.avgLineH) / Math.max(item.height, candidate.avgLineH, 0.1);
          const leftDiff = Math.abs(item.left - candidate.left);
          const isTocLine = /\s+\d{1,3}$/.test(candidate.lastLineText) || /\s+\d{1,3}$/.test(item.text);
          const colEndThreshold = candidate.width > 50 ? 44 : candidate.width * 0.72;
          const prevEndedShort = candidate.lastWidth < colEndThreshold && /[.!?。！？]$/.test(candidate.text);

          if (
            !isTocLine &&
            !prevEndedShort &&
            hRatio <= 0.36 &&
            leftDiff <= 3.6 &&
            vGap >= -0.45 * candidate.avgLineH &&
            vGap <= 0.88 * candidate.avgLineH
          ) {
            matchedGroup = candidate;
            break;
          }
        }

        if (matchedGroup) {
          const prevBottom = matchedGroup.top + matchedGroup.height;
          const newLeft = Math.min(matchedGroup.left, item.left);
          const newRight = Math.max(matchedGroup.left + matchedGroup.width, item.left + item.width);
          const newBottom = Math.max(prevBottom, item.top + item.height);
          matchedGroup.left = newLeft;
          matchedGroup.width = newRight - newLeft;
          matchedGroup.height = newBottom - matchedGroup.top;
          matchedGroup.avgLineH = (matchedGroup.avgLineH * matchedGroup.lineCount + item.height) / (matchedGroup.lineCount + 1);
          matchedGroup.lineCount += 1;
          matchedGroup.lastWidth = item.width;
          matchedGroup.lastLineText = item.text;
          matchedGroup.lastTop = item.top;
          matchedGroup.text = matchedGroup.text.endsWith('-') && /^[a-z]/.test(item.text)
            ? matchedGroup.text.slice(0, -1) + item.text
            : `${matchedGroup.text} ${item.text}`;
          matchedGroup.members.push(item);
          continue;
        }

        groups.push({
          left: item.left,
          top: item.top,
          width: item.width,
          height: item.height,
          avgLineH: item.height,
          lineCount: 1,
          lastWidth: item.width,
          lastLineText: item.text,
          lastTop: item.top,
          text: item.text,
          members: [item]
        });
      }

      const tocEntries = detectPdfTocEntries(groups);

      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        let nearestBelowTop = 98.5;
        for (let oj = 0; oj < groups.length; oj++) {
          if (gi === oj) continue;
          const other = groups[oj];
          if (other.top < g.top + g.height - 0.4) continue;
          const xOverlap = Math.min(g.left + g.width, other.left + other.width) - Math.max(g.left, other.left);
          if (xOverlap > 1.5 && other.top < nearestBelowTop) {
            nearestBelowTop = other.top;
          }
        }
        const safeHeight = Math.max(g.height, Math.min(g.height + g.avgLineH * 0.45, nearestBelowTop - g.top - 0.25));
        const primary = g.members[0].el;
        primary.setAttribute(
          'style',
          `left: ${g.left.toFixed(4)}%; top: ${g.top.toFixed(4)}%; width: ${g.width.toFixed(4)}%; height: ${safeHeight.toFixed(4)}%;`
        );
        primary.setAttribute('data-kct-pdf-block', '1');
        primary.setAttribute('data-kct-pdf-lines', String(g.lineCount));
        primary.setAttribute('data-kct-pdf-line-h', g.avgLineH.toFixed(4));
        primary.setAttribute(
          'data-kct-pdf-box',
          `${g.left.toFixed(3)},${g.top.toFixed(3)},${g.width.toFixed(3)},${g.height.toFixed(3)}`
        );
        const pitch = g.lineCount > 1 ? (g.lastTop - g.top) / (g.lineCount - 1) : 0;
        if (pitch > 0) {
          primary.setAttribute('data-kct-pdf-pitch', pitch.toFixed(4));
        } else {
          primary.removeAttribute('data-kct-pdf-pitch');
        }

        const toc = tocEntries.get(g);
        if (toc) {
          // Translate only the entry title; the page number + dot leader are re-drawn natively by the renderer
          primary.setAttribute('data-kct-pdf-toc', '1');
          primary.setAttribute('data-kct-pdf-toc-num', toc.num);
          primary.textContent = toc.title;
        } else {
          primary.removeAttribute('data-kct-pdf-toc');
          primary.removeAttribute('data-kct-pdf-toc-num');
          primary.textContent = g.text;
        }

        for (let i = 1; i < g.members.length; i++) {
          const absorbed = g.members[i].el;
          absorbed.setAttribute('data-kct-pdf-merged', 'absorbed');
        }
      }

      layer.setAttribute('data-kct-pdf-merged-count', String(ps.length));
      delete layer._kctTypoKey; // blocks changed: re-measure native glyph sizes on next fit
    }
  }

  function restorePdfOverlayLayers(root = document) {
    const layers = root.querySelectorAll ? root.querySelectorAll('[data-kct-pdf-layer="1"]') : [];
    for (const layer of layers) {
      layer.removeAttribute('data-kct-pdf-merged-count');
      const ps = layer.querySelectorAll('p[data-kct-orig-style], p[data-kct-orig-text]');
      for (const p of ps) {
        if (p.hasAttribute('data-kct-orig-style')) {
          p.setAttribute('style', p.getAttribute('data-kct-orig-style') || '');
          p.removeAttribute('data-kct-orig-style');
        }
        if (p.hasAttribute('data-kct-orig-text')) {
          p.textContent = p.getAttribute('data-kct-orig-text') || '';
          p.removeAttribute('data-kct-orig-text');
        }
        p.removeAttribute('data-kct-pdf-block');
        p.removeAttribute('data-kct-pdf-lines');
        p.removeAttribute('data-kct-pdf-line-h');
        p.removeAttribute('data-kct-pdf-box');
        p.removeAttribute('data-kct-pdf-merged');
        p.removeAttribute('data-kct-pdf-pitch');
        p.removeAttribute('data-kct-pdf-toc');
        p.removeAttribute('data-kct-pdf-toc-num');
        p.removeAttribute('data-kct-pdf-typo-key');
        p.removeAttribute('data-kct-pdf-fs-pct');
        p.removeAttribute('data-kct-pdf-bold');
        p.removeAttribute('data-kct-pdf-toc-leader');
        p.style.removeProperty('--kct-pdf-bg');
        p.style.removeProperty('--kct-pdf-fg');
      }
      layer.removeAttribute('data-kct-pdf-layer');
      delete layer._kctTypoKey;
    }
  }

  // A semantic block is only translatable as ONE unit when all of its text flows in a single
  // inline formatting context. Rows built from flex/grid/block cells (e.g. forum list items with
  // title, author, vote count and comment count in separate boxes) are layout containers: merging
  // their cells into one sentence glues unrelated values together and breaks the layout, so they
  // are left to Pass 2, which translates each text cell on its own.
  const COMPOSITE_IGNORE_SELECTOR = 'script, style, noscript, template, svg, math, button, [role="button"], .notranslate, [translate="no"], [aria-hidden="true"], [data-kct-ui], .material-icons, .material-symbols-outlined, .material-symbols-rounded, .google-symbols';
  const COMPOSITE_TEXT_RE = /[\p{L}\p{N}]/u;
  const COMPOSITE_MAX_TEXT_NODES = 400;

  function isCompositeLayoutBlock(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const view = el.ownerDocument?.defaultView || window;
    const displayCache = new Map();
    const displayOf = (node) => {
      if (!displayCache.has(node)) {
        let d = 'inline';
        try { d = view.getComputedStyle(node).display || 'inline'; } catch (_) { /* ignore */ }
        displayCache.set(node, d);
      }
      return displayCache.get(node);
    };
    const isLi = el.tagName === 'LI';
    const boxes = new Set();
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let seen = 0;
    let node;
    while ((node = walker.nextNode())) {
      if (++seen > COMPOSITE_MAX_TEXT_NODES) break;
      if (!COMPOSITE_TEXT_RE.test(node.nodeValue || '')) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      let box = el;
      let skip = false;
      for (let cur = parent; cur && cur !== el; cur = cur.parentElement) {
        if (cur.matches(COMPOSITE_IGNORE_SELECTOR)) { skip = true; break; }
        if (isLi && (cur.tagName === 'UL' || cur.tagName === 'OL')) { skip = true; break; }
        const d = displayOf(cur);
        if (d === 'none') { skip = true; break; }
        if (box !== el) continue; // nearest box already found; keep scanning only for ignored ancestors
        const parentDisplay = cur.parentElement ? displayOf(cur.parentElement) : '';
        const blockified = /(^|\s)(flex|grid|inline-flex|inline-grid)$/.test(parentDisplay);
        if (blockified || !d.startsWith('inline')) box = cur;
      }
      if (skip) continue;
      boxes.add(box);
      if (boxes.size >= 2) return true;
    }
    return false;
  }

  function shouldSkipBlock(el, scope, elementState) {
    if (!el || !el.isConnected) return true;
    if (el.getAttribute('data-kct-pdf-merged') === 'absorbed') return true;
    if (el.classList && el.classList.contains('ndfHFb-c4YZDc-cYSp0e-DARUcf-Df1ZY-tJHJj')) return true;
    if (elementState && elementState.has(el)) return true;
    if (el.closest(SKIP_ANCESTOR_SELECTOR)) return true;
    if (scope !== 'all' && isInsideExcludedChrome(el)) return true;
    if (!isElementVisible(el)) return true;

    if (el.hasAttribute('data-kct-has-trans') || el.querySelector('[data-kct-ui="trans"]')) return true;

    // Leaf-block check: if element contains child block elements (other than nested ul/ol in li), let child blocks handle it
    const nestedSelector = el.tagName === 'LI'
      ? 'p, h1, h2, h3, h4, h5, h6, blockquote, td, th'
      : 'p, h1, h2, h3, h4, h5, h6, blockquote, td, th, li, dt, dd';
    const childBlock = el.querySelector(nestedSelector);
    if (childBlock && childBlock !== el) {
      return true;
    }

    if (isCompositeLayoutBlock(el)) return true;

    return false;
  }

  function hasClaimedAncestor(el, claimedSet) {
    let cur = el.parentElement;
    if (!cur && el.getRootNode) {
      const root = el.getRootNode();
      if (root instanceof ShadowRoot) cur = root.host;
    }
    while (cur) {
      if (claimedSet.has(cur)) return true;
      if (cur.parentElement) {
        cur = cur.parentElement;
      } else if (cur.getRootNode) {
        const root = cur.getRootNode();
        cur = root instanceof ShadowRoot ? root.host : null;
      } else {
        cur = null;
      }
    }
    return false;
  }

  function isMeaningfulLeafText(text) {
    const clean = String(text || '')
      .replace(/\[\[\s*\/?[CMLAS]\d+\s*\]\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return false;
    if (PURE_METADATA_REGEX.test(clean)) return false;

    if (clean.length >= 12) return true;
    const asciiWords = clean.match(/[a-zA-Z]{2,}/g) || [];
    if (asciiWords.length >= 3) return true;
    const cjkLetters = clean.match(/[\p{Script=Han}\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/gu) || [];
    if (cjkLetters.length >= 4) return true;

    return false;
  }

  function collectUniversalCandidateElements(roots, scope, elementState) {
    if (!Array.isArray(roots) || roots.length === 0) return [];

    preparePdfOverlayLayers(roots);

    const claimedSet = new Set();
    const pass1 = [];
    const pass2 = [];

    // Pass 1: Semantic prose & structure blocks
    for (const root of roots) {
      if (!root) continue;
      const semanticCandidates = queryAllDeep(root, BLOCK_SELECTOR);
      for (const el of semanticCandidates) {
        if (claimedSet.has(el)) continue;
        if (shouldSkipBlock(el, scope, elementState)) continue;

        const host = resolveInlineHost(el);
        if (claimedSet.has(host) || elementState?.has(host)) continue;

        let cur = host;
        while (cur) {
          claimedSet.add(cur);
          if (cur === el) break;
          cur = cur.parentElement;
        }
        claimedSet.add(el);
        pass1.push(host);
      }
    }

    // Pass 2: Universal div / span / a / label leaf text blocks for modern SPAs (ordered cheapest-first)
    const tryClaimLeaf = (el) => {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
      if (!LEAF_CANDIDATE_TAGS.has(el.tagName)) return false;
      if (el.shadowRoot) return false; // Never wrap a Shadow DOM host or its slotted projection breaks
      if (claimedSet.has(el) || hasClaimedAncestor(el, claimedSet)) return false;
      if (elementState && elementState.has(el)) return false;
      if (el.hasAttribute('data-kct-has-trans')) return false;

      const rawText = String(el.textContent || '').trim();
      if (rawText.length < 4) return false;

      if (el.querySelector(CHILD_BLOCK_SELECTOR)) return false;
      if (el.querySelector(LEAF_FORBIDDEN_DESCENDANT_SELECTOR)) return false;
      if (el.querySelector('[data-kct-ui="trans"]')) return false;
      if (isCompositeLayoutBlock(el)) return false;
      if (el.closest(SKIP_ANCESTOR_SELECTOR)) return false;
      if (scope !== 'all' && (isInsideExcludedChrome(el) || el.closest(LEAF_UI_CONTROL_SELECTOR))) {
        return false;
      }

      // If a <div> or <span> only wraps <a> link(s) with no own substantial text outside links,
      // defer to the <a> element(s) so hyperlinks remain clickable in replace mode
      if ((el.tagName === 'DIV' || el.tagName === 'SPAN') && el.querySelector('a[href]')) {
        let ownTextLen = 0;
        for (const cn of el.childNodes) {
          if (cn.nodeType === Node.TEXT_NODE) {
            ownTextLen += cn.nodeValue.trim().length;
          }
        }
        if (ownTextLen < 4) return false;
      }

      if (!isElementVisible(el)) return false;

      const { text } = extractBlockContent(el);
      if (!isMeaningfulLeafText(text)) return false;

      claimedSet.add(el);
      pass2.push(el);
      return true;
    };

    const walkLeafCandidates = (rootNode, depth = 0) => {
      if (!rootNode || depth > 5) return;

      if (rootNode.nodeType === Node.ELEMENT_NODE) {
        if (
          claimedSet.has(rootNode) ||
          (elementState && elementState.has(rootNode)) ||
          rootNode.matches('[data-kct-ui], [data-kct-has-trans]') ||
          rootNode.matches(SKIP_ANCESTOR_SELECTOR)
        ) {
          return;
        }
        if (tryClaimLeaf(rootNode)) {
          return;
        }
      }

      const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
          if (claimedSet.has(node)) return NodeFilter.FILTER_REJECT;
          if (elementState && elementState.has(node)) return NodeFilter.FILTER_REJECT;
          if (node.matches && (
            node.matches('[data-kct-ui], [data-kct-has-trans]') ||
            node.matches(SKIP_ANCESTOR_SELECTOR)
          )) {
            return NodeFilter.FILTER_REJECT;
          }
          if (scope !== 'all' && node.matches && node.matches(NAV_EXCLUDE_SELECTOR)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      let current;
      while ((current = walker.nextNode())) {
        if (current.shadowRoot && depth < 5) {
          walkLeafCandidates(current.shadowRoot, depth + 1);
        }
        tryClaimLeaf(current);
      }
    };

    for (const root of roots) {
      if (!root) continue;
      walkLeafCandidates(root, 0);
    }

    if (pass2.length === 0) return pass1;
    if (pass1.length === 0) return pass2;

    const combined = [...pass1, ...pass2];
    combined.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return combined;
  }

  globalThis.KCTSiteAnalyzer = {
    isCompositeLayoutBlock,
    BLOCK_SELECTOR,
    SKIP_ANCESTOR_SELECTOR,
    NAV_EXCLUDE_SELECTOR,
    LESSON_CELL_SELECTOR,
    COURSE_CONTAINER_SELECTOR,
    INLINE_PROTECT_SELECTOR,
    isTopFrame,
    isElementVisible,
    classifyPage,
    findContentRoots,
    queryAllDeep,
    shouldTranslateText,
    probeTypography,
    extractBlockContent,
    shouldSkipBlock,
    preparePdfOverlayLayers,
    restorePdfOverlayLayers,
    collectUniversalCandidateElements
  };
})();
