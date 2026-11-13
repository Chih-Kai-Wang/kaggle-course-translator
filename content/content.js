(() => {
  if (globalThis.__KCT_INITIALIZED__) return;
  globalThis.__KCT_INITIALIZED__ = true;

  const {
    TARGET_LANGUAGES,
    resolveTargetLanguage,
    getSettings,
    saveSettings,
    hashText,
    SETTINGS_KEY
  } = globalThis.KCTConfig;

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

  const NAV_EXCLUDE_SELECTOR = 'nav, header, footer, [role="navigation"], [role="banner"], [role="tablist"], button';
  const COURSE_CONTAINER_SELECTOR = [
    '.jp-RenderedHTMLCommon',
    '.jp-MarkdownOutput',
    '.rendered_html',
    '.text_cell_render',
    '.markdown-converter__text--rendered',
    'main',
    'article',
    '[role="main"]'
  ].join(', ');

  const INLINE_PROTECT_SELECTOR = 'code, kbd, var, .katex, .MathJax, mjx-container';

  let settings = null;
  let lastUrl = location.href;
  let scanTimer = null;
  let isProcessingQueue = false;
  let activeRequests = 0;
  const MAX_CONCURRENT_BATCHES = 2;

  // Track elements already queued or translated in this document
  const elementState = new WeakMap(); // el -> 'queued' | 'done' | 'error'
  const commentState = new WeakMap(); // span/line -> 'queued' | 'done'
  const cmOverlayBySpan = new WeakMap(); // cm span/line -> overlay div inside .cm-scroller
  const commentCacheByBody = new Map(); // rawCommentBody -> cleanedTranslatedBody
  const pendingItems = []; // { kind?: 'block' | 'comment', el, key, text, placeholders?, nestedListEl?, commentInfo? }
  let totalDetected = 0;
  let totalTranslated = 0;
  let lastErrorMsg = '';
  const subframeStats = new Map(); // frameId -> { totalDetected, totalTranslated, isBusy, lastErrorMsg }

  // Floating widget & selection UI refs (top frame / active frame)
  let widgetEl = null;
  let selBtnEl = null;
  let selPopoverEl = null;
  let currentSelectionText = '';

  function isTopFrame() {
    try {
      return window === window.top;
    } catch (_) {
      return false;
    }
  }

  function applyDisplayModeClass(mode) {
    const root = document.documentElement;
    root.classList.add('kct-active');
    root.classList.remove('kct-mode-bilingual', 'kct-mode-replace', 'kct-mode-original');
    const resolvedMode = mode || settings?.displayMode || 'replace';
    if (resolvedMode === 'original') {
      root.classList.add('kct-mode-original');
    } else if (resolvedMode === 'bilingual') {
      root.classList.add('kct-mode-bilingual');
    } else {
      root.classList.add('kct-mode-replace');
    }

    root.classList.toggle('kct-comments-on', settings?.translateCodeComments !== false);

    root.classList.remove('kct-lang-tc', 'kct-lang-sc', 'kct-lang-ja', 'kct-lang-ko', 'kct-lang-latin');
    const langInfo = resolveTargetLanguage(settings);
    root.classList.add(langInfo.fontClass || 'kct-lang-tc');

    updateWidgetUI();
  }

  function isElementVisible(el) {
    if (!el.isConnected) return false;
    if (el.closest('[hidden], .sr-only, [aria-hidden="true"]')) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  }

  function isMostlyCJK(text) {
    const stripped = text.replace(/\s+/g, '');
    if (!stripped) return false;
    const cjk = (stripped.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) || []).length;
    return cjk / stripped.length > 0.25;
  }

  function hasMeaningfulEnglish(text) {
    const clean = text.replace(/\[\[[CM]\d+\]\]/g, '').trim();
    if (clean.length < 3) return false;
    if (!/[a-zA-Z]{2,}/.test(clean)) return false;
    if (/^https?:\/\/\S+$/i.test(clean)) return false;
    if (/^(In|Out)\s*\[\s*\d*\s*\]:?$/i.test(clean)) return false;
    // Skip single-token code identifiers like train_test_split or model.fit(X, y)
    if (!/\s/.test(clean) && /[_().=<>[\]]/.test(clean)) return false;
    return !isMostlyCJK(clean);
  }

  function extractBlockContent(el) {
    const placeholders = new Map();
    let codeIdx = 0;
    let mathIdx = 0;
    let nestedListEl = null;
    const parts = [];

    function walk(node, insideLiRoot) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.nodeValue);
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
        const isMath = node.matches('.katex, .MathJax, mjx-container');
        const token = isMath ? `[[M${mathIdx++}]]` : `[[C${codeIdx++}]]`;
        placeholders.set(token, node);
        parts.push(token);
        return;
      }

      if (node.tagName === 'BR') {
        parts.push('\n');
        return;
      }

      if (node.matches('script, style, noscript, svg, canvas, textarea, input, select, .anchor-link, .jp-InternalAnchorLink, .material-icons, .material-symbols-outlined, .material-symbols-rounded, .google-symbols, [aria-hidden="true"]')) {
        return;
      }

      for (const child of node.childNodes) {
        walk(child, insideLiRoot);
      }
    }

    const isLi = el.tagName === 'LI';
    for (const child of el.childNodes) {
      walk(child, isLi);
    }

    let text = parts.join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (/^H[1-6]$/.test(el.tagName)) {
      text = text.replace(/\s*¶\s*$/g, '').trim();
    }
    return { text, placeholders, nestedListEl };
  }

  function getCandidateRoots() {
    if (settings.scope === 'all') {
      return [document.body].filter(Boolean);
    }
    // On Kaggle Notebook Editor host page (/code/.../edit), actual cells live inside the JupyterLab iframe;
    // keep the host IDE sidebar chrome (Notebook / Input / Output / /kaggle/working) uncluttered in course mode.
    if (isTopFrame() && /\/code\/[^/]+\/[^/]+\/edit(?:\/|$)/i.test(location.pathname)) {
      return [];
    }

    const found = Array.from(document.querySelectorAll(COURSE_CONTAINER_SELECTOR));
    // Keep only top-most matched containers to avoid scanning same subtree twice
    const filtered = found.filter((node) => {
      if (node.closest('[data-testid="notebook-editor-render-tid"]')) return false;
      return !found.some((other) => other !== node && other.contains(node));
    });
    if (filtered.length > 0) return filtered;

    const siteContent = document.getElementById('site-content');
    if (siteContent && !siteContent.querySelector('[data-testid="notebook-editor-render-tid"]')) {
      return [siteContent];
    }

    // In notebook subframes, markdown might sit directly under body
    if (!isTopFrame() && document.body) {
      return [document.body];
    }
    return [];
  }

  function shouldSkipBlock(el) {
    if (!el || !el.isConnected) return true;
    if (elementState.has(el)) return true;
    if (el.closest(SKIP_ANCESTOR_SELECTOR)) return true;
    if (settings.scope === 'course' && el.closest(NAV_EXCLUDE_SELECTOR)) return true;
    if (!isElementVisible(el)) return true;

    // Skip if element already contains our injected translation
    if (el.hasAttribute('data-kct-has-trans') || el.querySelector('[data-kct-ui="trans"]')) return true;

    // Leaf-block check: if element contains child block elements (other than nested ul/ol in li), let child blocks handle it
    const childBlock = el.querySelector('p, h1, h2, h3, h4, h5, h6, blockquote, td, th');
    if (childBlock && childBlock !== el) {
      // Edge case: <li><p>...</p></li> -> skip <li>, let <p> be translated
      return true;
    }

    return false;
  }

  function getTextOffsetInParent(parent, targetNode) {
    let offset = 0;
    const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (targetNode === node || targetNode.contains(node)) {
        return offset;
      }
      offset += node.nodeValue ? node.nodeValue.length : 0;
    }
    return -1;
  }

  function isCommentOffsetInPythonLine(lineText, targetOffset) {
    if (targetOffset < 0) return false;
    let quote = null;
    for (let i = 0; i < targetOffset; i++) {
      const ch = lineText[i];
      if (quote) {
        if (ch === '\\') {
          i += 1;
          continue;
        }
        if (quote.length === 3) {
          if (lineText.slice(i, i + 3) === quote) {
            quote = null;
            i += 2;
          }
        } else if (ch === quote) {
          quote = null;
        }
      } else {
        if (ch === '#') {
          return i === targetOffset;
        }
        const tri = lineText.slice(i, i + 3);
        if (tri === "'''" || tri === '"""') {
          quote = tri;
          i += 2;
        } else if (ch === "'" || ch === '"') {
          quote = ch;
        }
      }
    }
    return quote === null;
  }

  function parseTranslatableComment(rawText) {
    const raw = String(rawText || '');
    if (!raw || raw.includes('\n')) return null;
    const match = raw.match(/^(\s*)(#+)(\s*)(.*)$/);
    if (!match) return null;
    const [, leadWs, hashes, midWs, body] = match;
    const trimmedBody = body.trim();
    if (trimmedBody.length < 3) return null;
    if (/^(?:type:\s*ignore|noqa\b|pylint:|pyright:|mypy:|-\*-|coding[:=]|!\/|In\s*\[|Out\s*\[|%%\w+|%%|[-=*#_~]{3,}$)/i.test(trimmedBody)) {
      return null;
    }
    if (!hasMeaningfulEnglish(trimmedBody)) return null;
    if (isMostlyCJK(trimmedBody)) return null;
    return {
      leadWs,
      hashes,
      midWs: midWs || ' ',
      body: trimmedBody
    };
  }

  function ensureCodeFontSizeVar(containerEl, sampleSpan) {
    if (!containerEl || containerEl.dataset.kctFontMeasured === '1') return;
    const fs = getComputedStyle(sampleSpan).fontSize;
    if (fs && fs !== '0px') {
      containerEl.style.setProperty('--kct-code-font-size', fs);
      containerEl.dataset.kctFontMeasured = '1';
    }
  }

  function collectCodeComments() {
    if (!settings || !settings.enabled || settings.translateCodeComments === false) return [];
    const items = [];
    const seen = new Set();

    // 1. Static tutorial / viewer <pre> code blocks (Pygments spans)
    const pres = document.querySelectorAll('pre');
    for (const pre of pres) {
      if (pre.closest('.cm-editor, .CodeMirror, .monaco-editor, [data-kct-ui]')) continue;
      if (!isElementVisible(pre)) continue;
      const commentSpans = pre.querySelectorAll('span.c1, span.c, span.cm, span.cs, span.ch');
      for (const span of commentSpans) {
        if (seen.has(span) || commentState.has(span)) continue;
        if (span.hasAttribute('data-kct-comment-trans')) continue;
        if (span.children.length > 0) continue;
        seen.add(span);

        const info = parseTranslatableComment(span.textContent);
        if (!info) continue;
        ensureCodeFontSizeVar(pre, span);
        commentState.set(span, 'queued');
        items.push({
          kind: 'comment',
          el: span,
          key: hashText(`COMMENT::${info.body}`),
          text: `# ${info.body}`,
          commentInfo: info
        });
      }
    }

  function resolveOpaqueBackground(el) {
    let cur = el;
    while (cur && cur.nodeType === Node.ELEMENT_NODE) {
      const bg = getComputedStyle(cur).backgroundColor;
      if (bg && bg !== 'transparent') {
        const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\)/i);
        if (!m || m[4] === undefined || parseFloat(m[4]) > 0.85) {
          return m ? `rgb(${m[1]}, ${m[2]}, ${m[3]})` : bg;
        }
      }
      cur = cur.parentElement;
    }
    return document.body?.dataset?.jpThemeLight === 'false' ? '#202124' : '#ffffff';
  }

  function renderCmCommentOverlay(ed, span, fullComment) {
    if (!ed || !span || !ed.isConnected || !span.isConnected) return;
    const scroller = ed.querySelector('.cm-scroller');
    if (!scroller) return;

    if (getComputedStyle(scroller).position === 'static') {
      scroller.style.position = 'relative';
    }

    let layer = scroller.querySelector(':scope > [data-kct-ui="cm-layer"]');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'kct-cm-layer';
      layer.setAttribute('data-kct-ui', 'cm-layer');
      layer.setAttribute('translate', 'no');
      scroller.appendChild(layer);
    }

    const scRect = scroller.getBoundingClientRect();
    const spRect = span.getBoundingClientRect();
    if (spRect.width === 0 || spRect.height === 0) return;

    let badge = cmOverlayBySpan.get(span);
    if (!badge || !badge.isConnected || badge.parentElement !== layer) {
      badge = document.createElement('div');
      badge.className = 'kct-cm-comment';
      badge.setAttribute('data-kct-ui', 'cm-comment');
      badge.setAttribute('translate', 'no');
      layer.appendChild(badge);
      cmOverlayBySpan.set(span, badge);
    }

    const spanStyle = getComputedStyle(span);
    const top = Math.round(spRect.top - scRect.top + scroller.scrollTop);
    const left = Math.floor(spRect.left - scRect.left + scroller.scrollLeft);
    const height = Math.ceil(spRect.height);
    const minWidth = Math.ceil(spRect.width + 6);
    const availWidth = Math.max(minWidth, Math.floor(scroller.clientWidth - left - 10));

    badge.textContent = fullComment;
    badge.style.top = `${top}px`;
    badge.style.left = `${left}px`;
    badge.style.height = `${height}px`;
    badge.style.minWidth = `${minWidth}px`;
    badge.style.maxWidth = `${availWidth}px`;
    badge.style.fontSize = spanStyle.fontSize || '14px';
    badge.style.lineHeight = `${height}px`;
    badge.style.fontStyle = spanStyle.fontStyle || 'italic';
    badge.style.color = spanStyle.color;
    badge.style.backgroundColor = resolveOpaqueBackground(ed);
  }

  function syncCmOverlays() {
    if (!settings || settings.translateCodeComments === false || settings.displayMode === 'original') return;
    const layers = document.querySelectorAll('.kct-cm-layer');
    for (const layer of layers) {
      for (const badge of Array.from(layer.children)) {
        if (!badge.isConnected) badge.remove();
      }
    }
    const editors = document.querySelectorAll('.cm-editor');
    for (const ed of editors) {
      if (ed.closest('.jp-MarkdownCell') || !isElementVisible(ed)) continue;
      const lines = ed.querySelectorAll('.cm-line');
      for (const line of lines) {
        const lineText = line.textContent || '';
        if (!lineText.includes('#')) continue;
        const leafSpans = Array.from(line.querySelectorAll('span')).filter((s) => s.children.length === 0);
        const targets = leafSpans.length > 0 ? leafSpans : [line];
        for (const t of targets) {
          const info = parseTranslatableComment(t.textContent);
          if (!info) continue;
          const cached = commentCacheByBody.get(info.body);
          if (cached) {
            renderCmCommentOverlay(ed, t, `${info.leadWs}${info.hashes}${info.midWs}${cached}`);
          }
        }
      }
    }
  }

    // 2. Interactive JupyterLab v4 CodeMirror 6 code cells (non-intrusive overlay layer)
    const cmEditors = document.querySelectorAll('.cm-editor');
    for (const ed of cmEditors) {
      if (ed.closest('.jp-MarkdownCell')) continue;
      if (!isElementVisible(ed)) continue;
      const lines = ed.querySelectorAll('.cm-line');
      for (const line of lines) {
        const lineText = line.textContent || '';
        if (!lineText.includes('#')) continue;

        const leafSpans = Array.from(line.querySelectorAll('span')).filter((s) => s.children.length === 0);
        if (leafSpans.length > 0) {
          for (const span of leafSpans) {
            if (seen.has(span)) continue;
            const info = parseTranslatableComment(span.textContent);
            if (!info) continue;

            const spanOffset = getTextOffsetInParent(line, span);
            const hashOffset = spanOffset + info.leadWs.length;
            if (!isCommentOffsetInPythonLine(lineText, hashOffset)) continue;

            seen.add(span);
            const cachedTrans = commentCacheByBody.get(info.body);
            if (cachedTrans) {
              renderCmCommentOverlay(ed, span, `${info.leadWs}${info.hashes}${info.midWs}${cachedTrans}`);
              commentState.set(span, 'done');
              continue;
            }
            if (commentState.has(span)) continue;

            commentState.set(span, 'queued');
            items.push({
              kind: 'comment',
              cmEditor: ed,
              el: span,
              key: hashText(`COMMENT::${info.body}`),
              text: `# ${info.body}`,
              commentInfo: info
            });
          }
        } else if (!seen.has(line)) {
          const info = parseTranslatableComment(lineText);
          if (info) {
            seen.add(line);
            const cachedTrans = commentCacheByBody.get(info.body);
            if (cachedTrans) {
              renderCmCommentOverlay(ed, line, `${info.leadWs}${info.hashes}${info.midWs}${cachedTrans}`);
              commentState.set(line, 'done');
              continue;
            }
            if (commentState.has(line)) continue;
            commentState.set(line, 'queued');
            items.push({
              kind: 'comment',
              cmEditor: ed,
              el: line,
              key: hashText(`COMMENT::${info.body}`),
              text: `# ${info.body}`,
              commentInfo: info
            });
          }
        }
      }
    }

    return items;
  }

  function collectBlocks() {
    if (!settings || !settings.enabled) return [];
    const roots = getCandidateRoots();
    const collected = [];
    const seen = new Set();

    for (const root of roots) {
      const candidates = root.querySelectorAll(BLOCK_SELECTOR);
      for (const el of candidates) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (shouldSkipBlock(el)) continue;

        const { text, placeholders, nestedListEl } = extractBlockContent(el);
        if (!hasMeaningfulEnglish(text)) continue;

        const key = hashText(text);
        elementState.set(el, 'queued');
        collected.push({ el, key, text, placeholders, nestedListEl });
      }
    }
    return collected;
  }

  function sortViewportFirst(items) {
    const vh = window.innerHeight || 800;
    return items.sort((a, b) => {
      const ra = a.el.getBoundingClientRect();
      const rb = b.el.getBoundingClientRect();
      const aVis = ra.bottom >= -200 && ra.top <= vh + 500;
      const bVis = rb.bottom >= -200 && rb.top <= vh + 500;
      if (aVis !== bVis) return aVis ? -1 : 1;
      return ra.top - rb.top;
    });
  }

  function buildTranslatedFragment(zhText, placeholders) {
    const frag = document.createDocumentFragment();
    const tokens = String(zhText || '').split(/(\[\[\s*[CM]\d+\s*\]\])/g);

    for (const part of tokens) {
      if (!part) continue;
      const m = part.match(/^\[\[\s*([CM]\d+)\s*\]\]$/);
      if (m) {
        const canonical = `[[${m[1]}]]`;
        const origNode = placeholders.get(canonical);
        if (origNode) {
          frag.appendChild(origNode.cloneNode(true));
          continue;
        }
      }
      frag.appendChild(document.createTextNode(part));
    }
    return frag;
  }

  function needsInlineInjection(el) {
    const tag = el.tagName;
    if (tag === 'TD' || tag === 'TH' || tag === 'A' || tag === 'SPAN') {
      return true;
    }
    const display = getComputedStyle(el).display || '';
    if (display.includes('inline')) return true;
    const parent = el.parentElement;
    if (!parent) return false;
    const parentDisplay = getComputedStyle(parent).display || '';
    return parentDisplay.includes('flex') || parentDisplay.includes('grid');
  }

  async function renderBatchWithRAF(renderJobs) {
    const BATCH = 15;
    for (let i = 0; i < renderJobs.length; i += BATCH) {
      const slice = renderJobs.slice(i, i + BATCH);
      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          for (const job of slice) {
            if (job.kind === 'comment') {
              const { el, zh, commentInfo, cmEditor } = job;
              if (!el.isConnected) continue;
              const cleaned = String(zh || '').replace(/^\s*#+\s*/, '').trim();
              if (cleaned) {
                const fullComment = `${commentInfo.leadWs}${commentInfo.hashes}${commentInfo.midWs}${cleaned}`;
                commentCacheByBody.set(commentInfo.body, cleaned);
                if (cmEditor && cmEditor.isConnected) {
                  renderCmCommentOverlay(cmEditor, el, fullComment);
                } else {
                  el.setAttribute('data-kct-comment-trans', fullComment);
                }
                commentState.set(el, 'done');
                totalTranslated += 1;
              } else {
                commentState.delete(el);
              }
              continue;
            }

            const { el, zh, placeholders, nestedListEl } = job;
            if (!el.isConnected) continue;
            if (el.hasAttribute('data-kct-has-trans') || el.querySelector('[data-kct-ui="trans"]')) {
              elementState.set(el, 'done');
              continue;
            }

            const origWrap = document.createElement('span');
            origWrap.className = 'kct-orig-wrap';
            origWrap.setAttribute('data-kct-ui', 'orig');

            const children = Array.from(el.childNodes);
            for (const child of children) {
              if (nestedListEl && child === nestedListEl) continue;
              origWrap.appendChild(child);
            }

            const transWrap = document.createElement('span');
            transWrap.className = 'kct-trans-wrap';
            transWrap.setAttribute('data-kct-ui', 'trans');
            transWrap.setAttribute('translate', 'no');
            transWrap.appendChild(buildTranslatedFragment(zh, placeholders));

            if (needsInlineInjection(el)) {
              el.setAttribute('data-kct-inline-layout', '1');
            }

            if (nestedListEl && nestedListEl.parentElement === el) {
              el.insertBefore(origWrap, nestedListEl);
              el.insertBefore(transWrap, nestedListEl);
            } else {
              el.append(origWrap, transWrap);
            }

            el.setAttribute('data-kct-has-trans', '1');
            elementState.set(el, 'done');
            totalTranslated += 1;
          }
          resolve();
        });
      });
      if (globalThis.scheduler?.yield) {
        await globalThis.scheduler.yield();
      }
    }
    updateWidgetUI();
  }

  function takeNextBatch() {
    const maxCount = Number(settings.batchSize || 8);
    const maxChars = Number(settings.maxBatchChars || 1800);
    const batch = [];
    let chars = 0;

    while (pendingItems.length > 0 && batch.length < maxCount) {
      const next = pendingItems[0];
      if (!next.el.isConnected) {
        pendingItems.shift();
        continue;
      }
      if (batch.length > 0 && chars + next.text.length > maxChars) {
        break;
      }
      pendingItems.shift();
      batch.push(next);
      chars += next.text.length;
    }
    return batch;
  }

  async function processQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    lastErrorMsg = '';
    updateWidgetUI();

    try {
      const workers = [];
      const spawnWorker = async () => {
        while (pendingItems.length > 0) {
          const batch = takeNextBatch();
          if (batch.length === 0) break;

          // Deduplicate same text keys within this batch
          const uniqueMap = new Map();
          for (const item of batch) {
            if (!uniqueMap.has(item.key)) {
              uniqueMap.set(item.key, {
                key: item.key,
                text: item.text,
                kind: item.kind || 'block'
              });
            }
          }

          activeRequests += 1;
          updateWidgetUI();
          try {
            const response = await chrome.runtime.sendMessage({
              type: 'TRANSLATE_BATCH',
              items: Array.from(uniqueMap.values())
            });

            if (!response?.ok) {
              lastErrorMsg = response?.error || '翻譯失敗';
              for (const item of batch) {
                if (item.kind === 'comment') commentState.delete(item.el);
                else elementState.delete(item.el);
              }
              if (response?.errorCode === 'NO_API_KEY') {
                pendingItems.length = 0;
                break;
              }
              continue;
            }

            const results = response.results || {};
            const jobs = [];
            for (const item of batch) {
              const hit = results[item.key];
              if (hit?.zh) {
                jobs.push({
                  kind: item.kind || 'block',
                  cmEditor: item.cmEditor,
                  el: item.el,
                  zh: hit.zh,
                  placeholders: item.placeholders,
                  nestedListEl: item.nestedListEl,
                  commentInfo: item.commentInfo
                });
              } else {
                if (item.kind === 'comment') commentState.delete(item.el);
                else elementState.delete(item.el);
              }
            }
            if (jobs.length > 0) {
              await renderBatchWithRAF(jobs);
            }
          } catch (err) {
            lastErrorMsg = err?.message || '通訊失敗';
            for (const item of batch) {
              if (item.kind === 'comment') commentState.delete(item.el);
              else elementState.delete(item.el);
            }
          } finally {
            activeRequests -= 1;
            updateWidgetUI();
          }
        }
      };

      const concurrency = Math.min(MAX_CONCURRENT_BATCHES, Math.max(1, Math.ceil(pendingItems.length / 4)));
      for (let i = 0; i < concurrency; i++) {
        workers.push(spawnWorker());
      }
      await Promise.all(workers);
    } finally {
      isProcessingQueue = false;
      updateWidgetUI();
    }
  }

  function injectOutputTranslateButtons() {
    if (!settings || settings.showOutputTranslateBtn === false) return;
    const outputAreas = document.querySelectorAll(
      '.jp-OutputArea-output .jp-RenderedText, .output_subarea.output_text, .output_subarea.output_stream, .output_subarea.output_error'
    );
    for (const area of outputAreas) {
      if (area.dataset.kctOutputBound === '1') continue;
      if (area.closest('.dataframe, table.dataframe')) continue;
      const rawText = (area.innerText || area.textContent || '').trim();
      if (rawText.length < 6 || !/[a-zA-Z]{3,}/.test(rawText) || isMostlyCJK(rawText)) continue;

      area.dataset.kctOutputBound = '1';
      area.classList.add('kct-output-host');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kct-output-btn';
      btn.setAttribute('data-kct-ui', 'output-btn');
      btn.setAttribute('translate', 'no');
      btn.textContent = '譯';
      btn.title = '翻譯此執行輸出（如 Hint 提示 / Check 驗證 / 錯誤訊息）';

      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const existing = area.querySelector('.kct-output-trans');
        if (existing) {
          existing.remove();
          btn.textContent = '譯';
          return;
        }
        const latestText = (area.innerText || area.textContent || '').replace(/^譯\s*/, '').trim();
        btn.textContent = '翻譯中...';
        btn.disabled = true;
        try {
          const res = await chrome.runtime.sendMessage({
            type: 'TRANSLATE_SINGLE',
            mode: 'output',
            text: latestText.slice(0, 3500)
          });
          const box = document.createElement('div');
          box.className = 'kct-output-trans';
          box.setAttribute('data-kct-ui', 'output-trans');
          box.setAttribute('translate', 'no');
          box.textContent = res?.ok ? res.zh : (res?.error || '翻譯失敗');
          area.appendChild(box);
          btn.textContent = '收起譯文';
        } catch (err) {
          btn.textContent = '重試';
        } finally {
          btn.disabled = false;
        }
      });

      area.appendChild(btn);
    }
  }

  function scanAndTranslate(force = false) {
    if (!settings) return;
    injectOutputTranslateButtons();
    if (!settings.enabled && !force) return;
    if (!settings.autoTranslate && !force) return;

    const newBlocks = collectBlocks();
    const newComments = collectCodeComments();
    const newItems = [...newBlocks, ...newComments];
    if (newItems.length > 0) {
      totalDetected += newItems.length;
      pendingItems.push(...newItems);
      sortViewportFirst(pendingItems);
      updateWidgetUI();
      processQueue();
    } else {
      updateWidgetUI();
    }
  }

  function scheduleScan(delay = 450) {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        totalDetected = 0;
        totalTranslated = 0;
        pendingItems.length = 0;
        lastErrorMsg = '';
      }
      scanAndTranslate(false);
    }, delay);
  }

  function clearAllInjectedTranslations() {
    const wrappedHosts = document.querySelectorAll('[data-kct-has-trans="1"]');
    for (const el of wrappedHosts) {
      const origWrap = el.querySelector(':scope > [data-kct-ui="orig"]');
      const transWrap = el.querySelector(':scope > [data-kct-ui="trans"]');
      if (origWrap) {
        while (origWrap.firstChild) {
          el.insertBefore(origWrap.firstChild, origWrap);
        }
        origWrap.remove();
      }
      if (transWrap) {
        transWrap.remove();
      }
      el.removeAttribute('data-kct-has-trans');
      el.removeAttribute('data-kct-inline-layout');
      elementState.delete(el);
    }

    const commentedEls = document.querySelectorAll('[data-kct-comment-trans]');
    for (const cel of commentedEls) {
      cel.removeAttribute('data-kct-comment-trans');
      commentState.delete(cel);
    }
    const cmLayers = document.querySelectorAll('[data-kct-ui="cm-layer"]');
    for (const layer of cmLayers) {
      layer.remove();
    }
    commentCacheByBody.clear();

    pendingItems.length = 0;
    totalDetected = 0;
    totalTranslated = 0;
    lastErrorMsg = '';
    updateWidgetUI();
  }

  // --- Floating Control Widget (Top Frame Only) ---
  function createFloatingWidget() {
    if (!isTopFrame() || widgetEl) return;
    if (settings && settings.showFloatingBall === false) return;

    const el = document.createElement('div');
    el.id = 'kct-floating-widget';
    el.setAttribute('data-kct-ui', 'widget');
    el.setAttribute('translate', 'no');

    const brand = document.createElement('span');
    brand.className = 'kct-brand';
    brand.title = '點擊展開/收起 Kaggle 翻譯工具列';

    const dot = document.createElement('span');
    dot.className = 'kct-dot';
    const brandText = document.createElement('span');
    brandText.textContent = 'K譯';
    brand.append(dot, brandText);

    const status = document.createElement('span');
    status.className = 'kct-status';
    status.textContent = '就緒';

    const controls = document.createElement('div');
    controls.className = 'kct-controls';

    const seg = document.createElement('div');
    seg.className = 'kct-seg';
    const modes = [
      { id: 'replace', label: '譯文' },
      { id: 'original', label: '原文' },
      { id: 'bilingual', label: '雙語' }
    ];
    for (const m of modes) {
      const btn = document.createElement('button');
      btn.dataset.mode = m.id;
      btn.textContent = m.label;
      btn.title = m.id === 'replace'
        ? '以譯文呈現，保持與原文相同的版面排版'
        : m.id === 'original'
          ? '顯示英文原文'
          : '簡潔雙語對照';
      btn.addEventListener('click', async () => {
        settings = await saveSettings({ displayMode: m.id });
        applyDisplayModeClass(m.id);
      });
      seg.appendChild(btn);
    }

    const langSelect = document.createElement('select');
    langSelect.className = 'kct-lang-select';
    langSelect.title = '切換目標翻譯語言';
    for (const lang of Object.values(TARGET_LANGUAGES)) {
      const opt = document.createElement('option');
      opt.value = lang.id;
      opt.textContent = lang.shortLabel;
      langSelect.appendChild(opt);
    }
    langSelect.value = settings?.targetLang || 'zh-TW';
    langSelect.addEventListener('change', async (e) => {
      const val = e.target.value;
      if (val === 'custom' && !settings?.customTargetLang) {
        await chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
        langSelect.value = settings?.targetLang || 'zh-TW';
        return;
      }
      settings = await saveSettings({ targetLang: val });
      applyDisplayModeClass(settings.displayMode);
    });

    const translateBtn = document.createElement('button');
    translateBtn.className = 'kct-icon-btn';
    translateBtn.textContent = '↻';
    translateBtn.title = '立即掃描並翻譯目前頁面（含程式碼註解與內嵌 Notebook）';
    translateBtn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        type: 'BROADCAST_TO_TAB',
        payload: { type: 'KCT_COMMAND', action: 'TRANSLATE_NOW' }
      });
    });

    const optBtn = document.createElement('button');
    optBtn.className = 'kct-icon-btn';
    optBtn.textContent = '⚙';
    optBtn.title = '開啟 API Key、語言與術語表設定';
    optBtn.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    });

    const minBtn = document.createElement('button');
    minBtn.className = 'kct-icon-btn';
    minBtn.textContent = '—';
    minBtn.title = '收起懸浮工具列';
    minBtn.addEventListener('click', () => {
      el.classList.add('kct-collapsed');
    });

    brand.addEventListener('click', () => {
      el.classList.toggle('kct-collapsed');
    });

    controls.append(seg, langSelect, translateBtn, optBtn, minBtn);
    el.append(brand, status, controls);
    document.body.appendChild(el);
    widgetEl = el;
    updateWidgetUI();
  }

  function getAggregatedStats() {
    let detected = totalDetected;
    let translated = totalTranslated;
    let isBusy = isProcessingQueue || activeRequests > 0;
    let err = lastErrorMsg;

    for (const s of subframeStats.values()) {
      detected += Number(s.totalDetected || 0);
      translated += Number(s.totalTranslated || 0);
      if (s.isBusy) isBusy = true;
      if (!err && s.lastErrorMsg) err = s.lastErrorMsg;
    }

    return {
      totalDetected: detected,
      totalTranslated: translated,
      isBusy,
      lastErrorMsg: err
    };
  }

  async function reportStatusToTop() {
    if (isTopFrame()) return;
    try {
      await chrome.runtime.sendMessage({
        type: 'FRAME_STATUS',
        stats: {
          totalDetected,
          totalTranslated,
          isBusy: isProcessingQueue || activeRequests > 0,
          lastErrorMsg
        }
      });
    } catch (_) {
      // Ignore if tab/extension context is unloading
    }
  }

  function updateWidgetUI() {
    if (!isTopFrame()) {
      reportStatusToTop();
      return;
    }
    if (!widgetEl) return;
    const dot = widgetEl.querySelector('.kct-dot');
    const status = widgetEl.querySelector('.kct-status');
    const modeBtns = widgetEl.querySelectorAll('.kct-seg button');
    const agg = getAggregatedStats();

    dot.classList.remove('kct-busy', 'kct-err');
    const hasKey = Boolean(settings?.apiKey?.trim()) || /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(settings?.baseUrl || '');

    if (agg.lastErrorMsg) {
      dot.classList.add('kct-err');
      status.textContent = agg.lastErrorMsg;
      status.title = agg.lastErrorMsg;
    } else if (agg.isBusy) {
      dot.classList.add('kct-busy');
      status.textContent = `翻譯中 ${agg.totalTranslated}/${agg.totalDetected}`;
      status.title = status.textContent;
    } else if (!hasKey) {
      dot.classList.add('kct-err');
      status.textContent = '未設定 API Key';
      status.title = '請點選「⚙」填寫大模型 API Key';
    } else if (agg.totalTranslated > 0) {
      status.textContent = `已譯 ${agg.totalTranslated} 項`;
      status.title = status.textContent;
    } else {
      status.textContent = settings?.autoTranslate ? '自動監聽中' : '就緒';
      status.title = status.textContent;
    }

    const curMode = settings?.displayMode || 'replace';
    for (const btn of modeBtns) {
      btn.classList.toggle('kct-active', btn.dataset.mode === curMode);
    }
    const langSel = widgetEl.querySelector('.kct-lang-select');
    if (langSel && settings?.targetLang) {
      langSel.value = settings.targetLang;
    }
  }

  // --- Selection Translation (Works in both Main Page & Jupyter Iframe) ---
  function removeSelectionUI() {
    if (selBtnEl) {
      selBtnEl.remove();
      selBtnEl = null;
    }
    if (selPopoverEl) {
      selPopoverEl.remove();
      selPopoverEl = null;
    }
  }

  function clampPosition(x, y, width, height) {
    const maxX = Math.max(12, window.innerWidth - width - 12);
    const maxY = Math.max(12, window.innerHeight - height - 12);
    return {
      left: Math.min(Math.max(12, x), maxX),
      top: Math.min(Math.max(12, y), maxY)
    };
  }

  function showSelectionPopover(x, y, text) {
    removeSelectionUI();
    const pop = document.createElement('div');
    pop.id = 'kct-sel-popover';
    pop.setAttribute('data-kct-ui', 'selection');
    pop.setAttribute('translate', 'no');

    const head = document.createElement('div');
    head.className = 'kct-pop-head';
    const title = document.createElement('span');
    title.textContent = 'Kaggle 劃詞翻譯';

    const actions = document.createElement('div');
    actions.className = 'kct-pop-actions';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '複製';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', removeSelectionUI);

    actions.append(copyBtn, closeBtn);
    head.append(title, actions);

    const body = document.createElement('div');
    body.className = 'kct-pop-body';
    body.textContent = '正在翻譯...';

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(body.textContent || '');
        copyBtn.textContent = '已複製';
        setTimeout(() => { copyBtn.textContent = '複製'; }, 1200);
      } catch (_) {}
    });

    pop.append(head, body);
    document.body.appendChild(pop);
    const pos = clampPosition(x, y + 10, 380, 220);
    pop.style.left = `${pos.left}px`;
    pop.style.top = `${pos.top}px`;
    selPopoverEl = pop;

    (async () => {
      const res = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_SINGLE',
        text
      });
      if (!pop.isConnected) return;
      body.textContent = res?.ok ? res.zh : (res?.error || '翻譯失敗');
    })();
  }

  function setupSelectionListener() {
    document.addEventListener('mouseup', (e) => {
      if (!settings?.selectionTranslate) return;
      if (e.target && e.target.closest && e.target.closest('[data-kct-ui]')) return;

      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : '';
        if (!text || text.length < 3 || text.length > 2500 || !/[a-zA-Z]{2,}/.test(text) || isMostlyCJK(text)) {
          if (!selPopoverEl) removeSelectionUI();
          return;
        }
        currentSelectionText = text;
        if (selBtnEl) selBtnEl.remove();

        const btn = document.createElement('button');
        btn.id = 'kct-sel-btn';
        btn.setAttribute('data-kct-ui', 'selection');
        btn.setAttribute('translate', 'no');
        btn.textContent = '譯';
        const pos = clampPosition(e.clientX + 8, e.clientY + 10, 44, 28);
        btn.style.left = `${pos.left}px`;
        btn.style.top = `${pos.top}px`;
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          showSelectionPopover(pos.left, pos.top, currentSelectionText);
        });
        document.body.appendChild(btn);
        selBtnEl = btn;
      }, 20);
    });

    document.addEventListener('mousedown', (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-kct-ui="selection"]')) return;
      removeSelectionUI();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') removeSelectionUI();
    });
  }

  // --- Observers & Messaging ---
  function setupObservers() {
    const observer = new MutationObserver((mutations) => {
      let hasExternalNodes = false;
      for (const m of mutations) {
        if (m.target && m.target.closest && m.target.closest('[data-kct-ui]')) continue;
        if (m.addedNodes && m.addedNodes.length > 0) {
          for (const n of m.addedNodes) {
            if (n.nodeType === Node.ELEMENT_NODE && !n.matches('[data-kct-ui]')) {
              hasExternalNodes = true;
              break;
            }
          }
        }
        if (hasExternalNodes) break;
      }
      if (hasExternalNodes) {
        scheduleScan(450);
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener('resize', () => {
      requestAnimationFrame(syncCmOverlays);
    });

    window.addEventListener('popstate', () => scheduleScan(400));
    window.addEventListener('hashchange', () => scheduleScan(400));

    // Also trigger re-prioritized scan on inner or window scroll & focusout (JupyterLab hydration)
    let scrollTimer = null;
    const onScrollOrBlur = () => {
      if (pendingItems.length > 0) {
        sortViewportFirst(pendingItems);
      }
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => scheduleScan(250), 250);
    };
    document.addEventListener('scroll', onScrollOrBlur, { passive: true, capture: true });
    document.addEventListener('focusout', () => scheduleScan(200));
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'KCT_GET_STATUS') {
      if (!isTopFrame()) return false;
      const agg = getAggregatedStats();
      sendResponse({
        ok: true,
        isTop: true,
        totalDetected: agg.totalDetected,
        totalTranslated: agg.totalTranslated,
        isBusy: agg.isBusy,
        lastErrorMsg: agg.lastErrorMsg
      });
      return false;
    }

    if (message?.type === 'KCT_DIAG') {
      const roots = getCandidateRoots();
      const allPs = Array.from(document.querySelectorAll('p, h1, h2, h3, li')).slice(0, 8);
      const samples = allPs.map((el) => ({
        tag: el.tagName,
        text: (el.innerText || '').slice(0, 50),
        state: elementState.get(el) || null,
        skipAncestor: Boolean(el.closest(SKIP_ANCESTOR_SELECTOR)),
        navExclude: Boolean(el.closest(NAV_EXCLUDE_SELECTOR)),
        visible: isElementVisible(el),
        inRoots: roots.some((r) => r.contains(el))
      }));
      const cmSamples = Array.from(document.querySelectorAll('.cm-editor')).map((ed, idx) => {
        const lines = Array.from(ed.querySelectorAll('.cm-line')).filter((l) => l.textContent.includes('#'));
        return {
          idx,
          visible: isElementVisible(ed),
          edClass: ed.className,
          edFontSizeVar: ed.style.getPropertyValue('--kct-code-font-size'),
          lines: lines.slice(0, 3).map((line) => {
            const span = line.querySelector('span[data-kct-comment-trans], span');
            return {
              lineClass: line.className,
              lineHtml: line.innerHTML.slice(0, 180),
              spanState: span ? (commentState.get(span) || null) : null,
              transAttr: span?.getAttribute('data-kct-comment-trans') || null,
              spanFontSize: span ? getComputedStyle(span).fontSize : null,
              afterContent: span ? getComputedStyle(span, '::after').content : null
            };
          })
        };
      });
      sendResponse({
        ok: true,
        href: location.href.slice(0, 100),
        isTop: isTopFrame(),
        htmlClass: document.documentElement.className,
        roots: roots.map((r) => `${r.tagName}#${r.id}.${String(r.className || '').slice(0, 40)}`),
        totalPs: document.querySelectorAll('p').length,
        cmEditors: document.querySelectorAll('.cm-editor').length,
        transComments: document.querySelectorAll('[data-kct-comment-trans]').length,
        totalTranslated,
        totalDetected,
        lastErrorMsg,
        subframes: Array.from(subframeStats.entries()),
        cmSamples,
        samples
      });
      return false;
    }

    if (message?.type === 'KCT_FRAME_STATUS') {
      if (!isTopFrame()) return false;
      if (message.frameId !== undefined && message.stats) {
        subframeStats.set(message.frameId, message.stats);
        updateWidgetUI();
      }
      sendResponse({ ok: true });
      return false;
    }

    (async () => {
      if (message?.type === 'KCT_COMMAND') {
        switch (message.action) {
          case 'TRANSLATE_NOW':
            settings = await getSettings();
            scanAndTranslate(true);
            break;
          case 'RETRANSLATE':
            clearAllInjectedTranslations();
            if (isTopFrame()) subframeStats.clear();
            settings = await getSettings();
            scanAndTranslate(true);
            break;
          case 'CLEAR_PAGE':
            clearAllInjectedTranslations();
            if (isTopFrame()) subframeStats.clear();
            break;
        }
        sendResponse({ ok: true });
      }
    })();
    return true;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
    const prev = settings;
    settings = changes[SETTINGS_KEY].newValue;
    applyDisplayModeClass(settings.displayMode);

    if (isTopFrame()) {
      if (settings.showFloatingBall === false && widgetEl) {
        widgetEl.remove();
        widgetEl = null;
      } else if (settings.showFloatingBall !== false && !widgetEl) {
        createFloatingWidget();
      }
    }

    if (prev && (
      prev.scope !== settings.scope ||
      prev.targetLang !== settings.targetLang ||
      prev.customTargetLang !== settings.customTargetLang ||
      prev.translateCodeComments !== settings.translateCodeComments ||
      (!prev.enabled && settings.enabled)
    )) {
      clearAllInjectedTranslations();
      if (isTopFrame()) subframeStats.clear();
      scanAndTranslate(true);
    } else if (prev && !prev.autoTranslate && settings.autoTranslate) {
      scanAndTranslate(false);
    }
    updateWidgetUI();
  });

  async function init() {
    settings = await getSettings();
    applyDisplayModeClass(settings.displayMode);
    if (isTopFrame()) {
      createFloatingWidget();
    }
    setupSelectionListener();
    setupObservers();
    if (settings.enabled && settings.autoTranslate) {
      // Initial scan + follow-up scan for async React/Jupyter hydration
      setTimeout(() => scanAndTranslate(false), 600);
      setTimeout(() => scanAndTranslate(false), 2200);
      setTimeout(() => scanAndTranslate(false), 4500);
    }
  }

  init();
})();
