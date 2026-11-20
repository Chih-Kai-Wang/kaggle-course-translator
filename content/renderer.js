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

  globalThis.KCTRenderer = {
    applyDisplayModeClass,
    applyBlockTranslation,
    renderJobsWithRAF,
    clearAllInjectedTranslations,
    buildTranslatedFragment,
    sanitizeFontFamily
  };
})();
