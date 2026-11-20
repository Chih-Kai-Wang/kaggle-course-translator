(() => {
  if (globalThis.KCTRenderer) return;

  const { resolveTargetLanguage } = globalThis.KCTConfig;
  const KCTSiteAnalyzer = globalThis.KCTSiteAnalyzer;

  const SHADOW_MODE_CSS = [
    ':host-context(html.kct-mode-replace) .kct-orig-wrap { display: none !important; }',
    ':host-context(html.kct-mode-replace) .kct-trans-wrap { display: contents; }',
    ':host-context(html.kct-mode-original) .kct-trans-wrap { display: none !important; }',
    ':host-context(html.kct-mode-original) .kct-orig-wrap { display: contents; }',
    ':host-context(html.kct-mode-bilingual) .kct-orig-wrap { display: contents; }',
    ':host-context(html.kct-mode-bilingual) .kct-trans-wrap { display: block; margin-top: 0.35em; padding-left: 10px; border-left: 2px solid rgba(148,163,184,0.45); font-size: 0.94em; line-height: 1.7; opacity: 0.88; }'
  ].join('\n');

  const GENERIC_FONT_TOKENS = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'ui-rounded',
    '-apple-system',
    'blinkmacsystemfont',
    'emoji',
    'math',
    'fangsong'
  ]);

  function sanitizeFontFamily(rawFont) {
    if (!rawFont) return '';
    // Split on commas outside quotes so we can strip generic catch-all families
    // (which would otherwise intercept CJK fallback before --kct-font-* is reached)
    // and avoid slicing mid-quote.
    const tokens = [];
    let buf = '';
    let quote = null;
    for (let i = 0; i < rawFont.length; i++) {
      const ch = rawFont[i];
      if (quote) {
        if (ch === '\\' && i + 1 < rawFont.length) {
          i += 1;
          continue;
        }
        if (ch === quote) quote = null;
        else buf += ch;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ',') {
        tokens.push(buf.trim());
        buf = '';
      } else {
        buf += ch;
      }
    }
    if (buf.trim()) tokens.push(buf.trim());

    const kept = [];
    for (const rawTok of tokens) {
      if (/[;:{}\\<>@`\r\n]/.test(rawTok)) continue;
      const clean = rawTok.replace(/["']/g, '').trim();
      if (!clean || clean.length > 60) continue;
      if (GENERIC_FONT_TOKENS.has(clean.toLowerCase())) continue;
      kept.push(/\s/.test(clean) ? `"${clean}"` : clean);
      if (kept.length >= 5) break;
    }
    return kept.join(', ');
  }

  function ensureShadowModeStyle(el) {
    const rootNode = el.getRootNode ? el.getRootNode() : null;
    if (!rootNode || !(rootNode instanceof ShadowRoot)) return;
    if (rootNode.querySelector('style[data-kct-ui="shadow-mode-style"]')) return;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-kct-ui', 'shadow-mode-style');
    styleEl.textContent = SHADOW_MODE_CSS;
    rootNode.appendChild(styleEl);
  }

  function applyDisplayModeClass(settings) {
    const root = document.documentElement;
    if (!root) return;

    root.classList.toggle('kct-active', settings?.enabled !== false);

    root.classList.remove('kct-mode-bilingual', 'kct-mode-replace', 'kct-mode-original');
    const resolvedMode = settings?.displayMode || 'replace';
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

    root.classList.remove('kct-typo-native', 'kct-typo-system', 'kct-typo-preserve');
    const typoMode = settings?.typographyMatch || 'native';
    if (typoMode === 'system') {
      root.classList.add('kct-typo-system');
    } else if (typoMode === 'preserve') {
      root.classList.add('kct-typo-preserve');
    } else {
      root.classList.add('kct-typo-native');
    }
  }

  function buildTranslatedFragment(zhText, placeholders) {
    const frag = document.createDocumentFragment();
    const tokens = String(zhText || '').split(/(\[\[\s*[CM]\d+\s*\]\])/g);

    for (const part of tokens) {
      if (!part) continue;
      const m = part.match(/^\[\[\s*([CM]\d+)\s*\]\]$/);
      if (m && placeholders) {
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

  function samplePdfImageColors(img, boxStr) {
    if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight || !boxStr) {
      return { bg: '#ffffff', fg: '#1e293b', ready: false };
    }
    const parts = boxStr.split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      return { bg: '#ffffff', fg: '#1e293b', ready: true };
    }
    const [leftPct, topPct, widthPct, heightPct] = parts;

    try {
      const W = 400;
      const H = 520;
      if (!img._kctSamplePixels) {
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, W, H);
        img._kctSamplePixels = ctx.getImageData(0, 0, W, H).data;
      }
      const data = img._kctSamplePixels;
      const x0 = Math.max(0, Math.min(W - 1, Math.floor((leftPct / 100) * W)));
      const y0 = Math.max(0, Math.min(H - 1, Math.floor((topPct / 100) * H)));
      const x1 = Math.max(x0, Math.min(W - 1, Math.ceil(((leftPct + widthPct) / 100) * W)));
      const y1 = Math.max(y0, Math.min(H - 1, Math.ceil(((topPct + heightPct) / 100) * H)));

      const borderRs = [];
      const borderGs = [];
      const borderBs = [];
      const pushPixel = (px, py) => {
        const idx = (py * W + px) * 4;
        if (data[idx + 3] < 128) return;
        borderRs.push(data[idx]);
        borderGs.push(data[idx + 1]);
        borderBs.push(data[idx + 2]);
      };

      for (let x = x0; x <= x1; x += 2) {
        pushPixel(x, y0);
        pushPixel(x, y1);
      }
      for (let y = y0; y <= y1; y += 2) {
        pushPixel(x0, y);
        pushPixel(x1, y);
      }

      if (borderRs.length === 0) {
        return { bg: '#ffffff', fg: '#1e293b', ready: true };
      }
      borderRs.sort((a, b) => a - b);
      borderGs.sort((a, b) => a - b);
      borderBs.sort((a, b) => a - b);
      const mid = Math.floor(borderRs.length / 2);
      const bgR = borderRs[mid];
      const bgG = borderGs[mid];
      const bgB = borderBs[mid];
      const bgLum = 0.2126 * bgR + 0.7152 * bgG + 0.0722 * bgB;

      const contrastPixels = [];
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const idx = (y * W + x) * 4;
          if (data[idx + 3] < 128) continue;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const diff = Math.abs(lum - bgLum);
          if (diff >= 40) {
            contrastPixels.push({ r, g, b, lum, diff });
          }
        }
      }

      let fg = bgLum > 140 ? '#1e293b' : '#f8fafc';
      if (contrastPixels.length >= 3) {
        contrastPixels.sort((a, b) => b.diff - a.diff);
        const take = Math.max(2, Math.min(20, Math.ceil(contrastPixels.length * 0.08)));
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        for (let i = 0; i < take; i++) {
          sumR += contrastPixels[i].r;
          sumG += contrastPixels[i].g;
          sumB += contrastPixels[i].b;
        }
        let fgR = Math.round(sumR / take);
        let fgG = Math.round(sumG / take);
        let fgB = Math.round(sumB / take);
        const fgLum = 0.2126 * fgR + 0.7152 * fgG + 0.0722 * fgB;
        // Compensate for anti-aliased raster downsampling so body text stays crisp & readable
        if (bgLum > 160 && fgLum > 95) {
          const darken = fgLum > 135 ? 0.58 : 0.76;
          fgR = Math.round(fgR * darken);
          fgG = Math.round(fgG * darken);
          fgB = Math.round(fgB * darken);
        } else if (bgLum <= 95 && fgLum < 185) {
          fgR = Math.min(255, Math.round(fgR + (255 - fgR) * 0.45));
          fgG = Math.min(255, Math.round(fgG + (255 - fgG) * 0.45));
          fgB = Math.min(255, Math.round(fgB + (255 - fgB) * 0.45));
        }
        fg = `rgb(${fgR}, ${fgG}, ${fgB})`;
      }

      const bg = `rgb(${bgR}, ${bgG}, ${bgB})`;
      return { bg, fg, ready: true };
    } catch (_) {
      return { bg: '#ffffff', fg: '#1e293b', ready: true };
    }
  }

  function styleAndFitPdfOverlayBlock(el) {
    if (!el || !el.isConnected || el.getAttribute('data-kct-pdf-block') !== '1') return;
    const layer = el.closest('[data-kct-pdf-layer="1"]');
    const pageContainer = layer?.parentElement || el.parentElement;
    const boxStr = el.getAttribute('data-kct-pdf-box') || '';

    const applyColorsFromImg = () => {
      if (!el.isConnected) return false;
      const img = pageContainer?.querySelector('img');
      const sampled = samplePdfImageColors(img, boxStr);
      el.style.setProperty('--kct-pdf-bg', sampled.bg);
      el.style.setProperty('--kct-pdf-fg', sampled.fg);
      if (!sampled.ready && img) {
        img.addEventListener('load', () => {
          const retry = samplePdfImageColors(img, boxStr);
          if (el.isConnected) {
            el.style.setProperty('--kct-pdf-bg', retry.bg);
            el.style.setProperty('--kct-pdf-fg', retry.fg);
          }
        }, { once: true });
      }
      return sampled.ready;
    };

    if (!applyColorsFromImg()) {
      setTimeout(applyColorsFromImg, 650);
    }

    const rectSource = layer || pageContainer;
    const pageH = rectSource?.getBoundingClientRect?.().height || 1035.5;
    const avgLineHPct = parseFloat(el.getAttribute('data-kct-pdf-line-h')) || 1.8;
    const lineCount = parseInt(el.getAttribute('data-kct-pdf-lines'), 10) || 1;
    const linePx = (avgLineHPct / 100) * pageH;

    let fontSize;
    let lineHeight;
    let fontWeight = '400';

    if (lineCount === 1 && avgLineHPct >= 2.2) {
      fontSize = Math.round(linePx * 0.80);
      lineHeight = '1.22';
      fontWeight = '700';
    } else if (avgLineHPct >= 2.8) {
      fontSize = Math.round(linePx * 0.74);
      lineHeight = '1.28';
      fontWeight = '400';
    } else {
      fontSize = Math.round(linePx * 0.78);
      lineHeight = '1.42';
      fontWeight = '400';
    }

    fontSize = Math.max(10, Math.min(42, fontSize));
    el.style.setProperty('--kct-pdf-fs', `${fontSize}px`);
    el.style.setProperty('--kct-pdf-lh', lineHeight);
    el.style.setProperty('--kct-pdf-fw', fontWeight);

    const targetH = el.clientHeight;
    const targetW = el.clientWidth;
    if (targetH > 8 && targetW > 12) {
      let fs = fontSize;
      let guard = 0;
      while (
        guard < 16 &&
        fs > 9.5 &&
        (el.scrollHeight > targetH + 3 || el.scrollWidth > targetW + 6)
      ) {
        fs = Math.max(9.5, +(fs - (fs > 18 ? 1.5 : 0.75)).toFixed(2));
        el.style.setProperty('--kct-pdf-fs', `${fs}px`);
        guard += 1;
      }
    }
  }

  function applyBlockTranslation(job, settings, state) {
    const { el, zh, placeholders, nestedListEl, typo } = job;
    if (!el || !el.isConnected) {
      return 'disconnected';
    }
    if (el.hasAttribute('data-kct-has-trans') || el.querySelector('[data-kct-ui="trans"]')) {
      if (state?.elementState) state.elementState.set(el, 'done');
      return 'already';
    }

    ensureShadowModeStyle(el);

    const origWrap = document.createElement('span');
    origWrap.className = 'kct-orig-wrap';
    origWrap.setAttribute('data-kct-ui', 'orig');

    const children = Array.from(el.childNodes);
    for (const child of children) {
      if (nestedListEl && child === nestedListEl) break;
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

    const typoInfo = typo || KCTSiteAnalyzer?.probeTypography?.(el) || {
      archetype: 'sans',
      needsLineHeightLift: false,
      origFontFamily: ''
    };

    const archetype = typoInfo.archetype || 'sans';
    el.setAttribute('data-kct-typo', archetype);
    if (typoInfo.needsLineHeightLift) {
      el.setAttribute('data-kct-lh-lift', '1');
    }

    const safeFont = sanitizeFontFamily(typoInfo.origFontFamily);
    if (safeFont) {
      el.style.setProperty('--kct-orig-font', safeFont);
      el.setAttribute('data-kct-has-orig-font', '1');
    } else {
      el.style.removeProperty('--kct-orig-font');
      el.removeAttribute('data-kct-has-orig-font');
    }

    if (nestedListEl && nestedListEl.parentElement === el) {
      el.insertBefore(origWrap, nestedListEl);
      el.insertBefore(transWrap, nestedListEl);
    } else {
      el.append(origWrap, transWrap);
    }

    el.setAttribute('data-kct-has-trans', '1');
    if (el.getAttribute('data-kct-pdf-block') === '1') {
      styleAndFitPdfOverlayBlock(el);
    }
    if (state?.elementState) state.elementState.set(el, 'done');
    return 'rendered';
  }

  function nextFrameOrFallback() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const timer = setTimeout(finish, 600);
      requestAnimationFrame(() => {
        clearTimeout(timer);
        finish();
      });
    });
  }

  async function renderJobsWithRAF(jobs, settings, notebookAdapter, state) {
    if (!jobs || jobs.length === 0) return;
    const MAX_PER_FRAME = 15;

    for (let i = 0; i < jobs.length; i += MAX_PER_FRAME) {
      const slice = jobs.slice(i, i + MAX_PER_FRAME);
      await nextFrameOrFallback();

      for (const job of slice) {
        if (job.epoch !== undefined && state && job.epoch !== state.translationEpoch) {
          continue;
        }
        try {
          if (job.kind === 'comment') {
            const outcome = notebookAdapter.renderCommentTranslation(job, settings, state);
            if (outcome === 'rendered') {
              state.totalTranslated += 1;
            } else {
              state.totalDetected = Math.max(state.totalTranslated, state.totalDetected - 1);
            }
          } else {
            const outcome = applyBlockTranslation(job, settings, state);
            if (outcome === 'rendered') {
              state.totalTranslated += 1;
            } else {
              state.totalDetected = Math.max(state.totalTranslated, state.totalDetected - 1);
            }
          }
        } catch (jobErr) {
          console.warn('[KCT] render job error:', jobErr);
          if (state && !state.lastErrorMsg) {
            state.lastErrorMsg = `渲染錯誤: ${jobErr?.message || jobErr}`;
          }
        }
      }

      if (i + MAX_PER_FRAME < jobs.length && typeof globalThis.scheduler?.yield === 'function') {
        try {
          await globalThis.scheduler.yield();
        } catch (_) {}
      }
    }
  }

  function clearAllInjectedTranslations(state, notebookAdapter) {
    const wrappedHosts = KCTSiteAnalyzer?.queryAllDeep
      ? KCTSiteAnalyzer.queryAllDeep(document.body || document.documentElement, '[data-kct-has-trans="1"]')
      : Array.from(document.querySelectorAll('[data-kct-has-trans="1"]'));

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
      el.removeAttribute('data-kct-typo');
      el.removeAttribute('data-kct-lh-lift');
      el.removeAttribute('data-kct-has-orig-font');
      el.style.removeProperty('--kct-orig-font');
      el.style.removeProperty('--kct-pdf-bg');
      el.style.removeProperty('--kct-pdf-fg');
      el.style.removeProperty('--kct-pdf-fs');
      el.style.removeProperty('--kct-pdf-lh');
      el.style.removeProperty('--kct-pdf-fw');
    }

    if (KCTSiteAnalyzer?.restorePdfOverlayLayers) {
      KCTSiteAnalyzer.restorePdfOverlayLayers(document);
    }

    if (notebookAdapter?.clearNotebookOverlays) {
      notebookAdapter.clearNotebookOverlays(state);
    }

    if (state) {
      // Reset WeakMap completely so any previously 'queued' or 'observed' blocks can be re-scanned
      state.elementState = new WeakMap();
      state.translationEpoch += 1;
      if (Array.isArray(state.pendingItems)) {
        state.pendingItems.length = 0;
      }
      state.totalDetected = 0;
      state.totalTranslated = 0;
      state.lastErrorMsg = '';
    }
  }

  function refitAllPdfOverlayBlocks() {
    const blocks = document.querySelectorAll('p[data-kct-pdf-block="1"][data-kct-has-trans="1"]');
    for (const el of blocks) {
      styleAndFitPdfOverlayBlock(el);
    }
  }

  globalThis.KCTRenderer = {
    applyDisplayModeClass,
    applyBlockTranslation,
    renderJobsWithRAF,
    clearAllInjectedTranslations,
    buildTranslatedFragment,
    sanitizeFontFamily,
    styleAndFitPdfOverlayBlock,
    refitAllPdfOverlayBlocks
  };
})();
