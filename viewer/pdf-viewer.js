import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');

const {
  TARGET_LANGUAGES,
  SETTINGS_KEY,
  getSettings,
  saveSettings,
  hashText,
  resolveTargetLanguage
} = globalThis.KCTConfig;

const ZOOM_STEPS = [0.75, 0.85, 1.0, 1.15, 1.25, 1.5, 1.75];
const SERIF_FONT_REGEX = /serif|times|garamond|georgia|mincho|cambria|palatino|cmr|charter|merriweather|baskerville|book|roman|caslon|minion|nimbusrom|computer\s*modern|cmbx|cmti|cmsl|ptm|ppl|bch/i;
const SANS_FONT_REGEX = /sans|arial|helvetica|calibri|roboto|inter|lato|open\s*sans|verdana|tahoma|gothic|cmss|nimbus\s*sans/i;
const MONO_FONT_REGEX = /mono|courier|consolas|menlo|code|cmtt|inconsolata|fira\s*code|dejavusansmono/i;
const BOLD_FONT_REGEX = /(?:^|[-_+,\s])(bold|black|heavy|semibold|demi|medi(?:um)?|extra|ultra|bx\d*|b\d{2}|sfbx|cmbx|nimbus.*medi)/i;
const ITALIC_FONT_REGEX = /(?:^|[-_+,\s])(italic|oblique|slant|ti\d*|sl\d*|cmti|cmsl)/i;
const MATH_FONT_REGEX = /(?:^|[\s+_-])(?:cmmi|cmsy|cmex|msam|msbm|xyatip|xybtip|eufm|eusm|rsfs)\d*|\b(?:math|symbol|stix|cambria\s*math|latinmodernmath)\b/i;
const BULLET_PREFIX_REGEX = /^(?:[•●▪▸►‣⁃◦–—\-*]|(?:\(?\d{1,3}[.)])|(?:[a-zA-Z][.)]\s))(?:\s|$)/;

// ============================================================
// DOM References
// ============================================================
const dom = {
  viewerMain: document.getElementById('viewerMain'),
  docTitle: document.getElementById('docTitle'),
  pageIndicator: document.getElementById('pageIndicator'),
  modeSegmented: document.getElementById('modeSegmented'),
  langSelect: document.getElementById('langSelect'),
  zoomOutBtn: document.getElementById('zoomOutBtn'),
  zoomResetBtn: document.getElementById('zoomResetBtn'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  statusBadge: document.getElementById('statusBadge'),
  statusText: document.getElementById('statusText'),
  statusActionBtn: document.getElementById('statusActionBtn'),
  openFileBtn: document.getElementById('openFileBtn'),
  fileInput: document.getElementById('fileInput'),
  settingsBtn: document.getElementById('settingsBtn'),

  emptyState: document.getElementById('emptyState'),
  emptyOpenBtn: document.getElementById('emptyOpenBtn'),
  urlForm: document.getElementById('urlForm'),
  urlInput: document.getElementById('urlInput'),

  loadingState: document.getElementById('loadingState'),
  loadingTitle: document.getElementById('loadingTitle'),
  loadingSub: document.getElementById('loadingSub'),

  errorState: document.getElementById('errorState'),
  errorTitle: document.getElementById('errorTitle'),
  errorDetail: document.getElementById('errorDetail'),
  retryUrlBtn: document.getElementById('retryUrlBtn'),
  errorOpenFileBtn: document.getElementById('errorOpenFileBtn'),

  pagesContainer: document.getElementById('pagesContainer'),
  dragOverlay: document.getElementById('dragOverlay'),

  comparePopover: document.getElementById('comparePopover'),
  compareOrigText: document.getElementById('compareOrigText'),
  compareTransText: document.getElementById('compareTransText'),
  copyOrigBtn: document.getElementById('copyOrigBtn'),
  copyTransBtn: document.getElementById('copyTransBtn'),
  compareCloseBtn: document.getElementById('compareCloseBtn')
};

// ============================================================
// Application State
// ============================================================
const state = {
  settings: null,
  mode: 'overlay', // 'overlay' | 'split' | 'original'
  zoom: 1.0,
  baseFitScale: 1.35,
  docLoadToken: 0,
  translationEpoch: 0,

  pdfDoc: null,
  numPages: 0,
  currentPage: 1,
  docTitle: '',
  docHost: 'local-pdf',
  sourceUrl: '',
  defaultPageWidth: 612,
  defaultPageHeight: 792,
  activeFetchController: null,

  pages: new Map(), // pageNum -> PageRecord
  translations: new Map(), // hashKey -> translated string

  // Metrics for toolbar status
  totalParagraphs: 0,
  translatedParagraphs: 0,
  cachedKeys: new Set(),
  lastError: '',
  lastErrorCode: '',

  // Observers & Scroll Tracking
  renderObserver: null,
  pageTrackRaf: 0,

  // Streaming Port ('kct-stream')
  streamPort: null,
  streamReqSeq: 0,
  activeStreamRequests: new Map(), // requestId -> req

  // Active compare popover state
  activeCompareAnchor: null,
  activeComparePara: null,
  dragDepth: 0
};

// ============================================================
// UI Helpers & Status
// ============================================================
function showStage(stage) {
  dom.emptyState.hidden = stage !== 'empty';
  dom.loadingState.hidden = stage !== 'loading';
  dom.errorState.hidden = stage !== 'error';
  dom.pagesContainer.hidden = stage !== 'pages';
}

function recomputeProgressMetrics() {
  let total = 0;
  let translated = 0;
  let cached = 0;
  let active = 0;
  for (const pageRec of state.pages.values()) {
    if (pageRec.translationInFlight) active += 1;
    for (const para of pageRec.translatableParagraphs || []) {
      total += 1;
      if (state.translations.has(para.key)) {
        translated += 1;
        if (state.cachedKeys.has(para.key)) cached += 1;
      }
    }
  }
  state.totalParagraphs = total;
  state.translatedParagraphs = translated;
  return { total, translated, cached, active };
}

function updateStatusBadge() {
  if (state.lastError) {
    dom.statusBadge.dataset.state = 'error';
    dom.statusText.textContent = state.lastError;
    dom.statusText.title = state.lastError;
    if (state.lastErrorCode === 'NO_API_KEY') {
      dom.statusActionBtn.textContent = '前往設定';
      dom.statusActionBtn.hidden = false;
    } else {
      dom.statusActionBtn.hidden = true;
    }
    return;
  }

  dom.statusActionBtn.hidden = true;

  if (!state.pdfDoc) {
    dom.statusBadge.dataset.state = 'idle';
    dom.statusText.textContent = '就緒';
    dom.statusText.title = '';
    return;
  }

  const { total, translated, cached, active } = recomputeProgressMetrics();

  if (active > 0) {
    dom.statusBadge.dataset.state = 'streaming';
    const progress = total > 0
      ? `串流翻譯中 ${translated}/${total}`
      : '串流翻譯中...';
    dom.statusText.textContent = progress;
    dom.statusText.title = progress;
    return;
  }

  if (translated > 0) {
    dom.statusBadge.dataset.state = 'done';
    const label = `已譯 ${translated} 段`;
    dom.statusText.textContent = label;
    dom.statusText.title = label;
    return;
  }

  dom.statusBadge.dataset.state = 'idle';
  dom.statusText.textContent = `已載入 ${state.numPages} 頁`;
  dom.statusText.title = '';
}

function updatePageIndicator(pageNum) {
  if (!state.numPages) {
    dom.pageIndicator.hidden = true;
    return;
  }
  state.currentPage = Math.max(1, Math.min(state.numPages, pageNum));
  dom.pageIndicator.hidden = false;
  dom.pageIndicator.textContent = `第 ${state.currentPage} / ${state.numPages} 頁`;
}

function updateZoomUI() {
  const pct = Math.round(state.zoom * 100);
  dom.zoomResetBtn.textContent = `${pct}%`;
  dom.zoomOutBtn.disabled = state.zoom <= ZOOM_STEPS[0] + 0.001;
  dom.zoomInBtn.disabled = state.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.001;
}

function computeTargetDisplayWidth(mode = state.mode) {
  const vw = window.innerWidth || 1024;
  if (mode === 'split' && vw > 900) {
    const containerW = Math.min(1560, vw - 40);
    return Math.max(280, Math.floor((containerW - 22) * 0.5));
  }
  if (vw <= 768) {
    return Math.max(260, vw - 20);
  }
  const avail = vw - (mode === 'split' ? 40 : 48);
  return Math.min(860, Math.max(280, avail));
}

function computePageBaseFitScale(pageUnscaledWidth, mode = state.mode) {
  const targetDisplayWidth = computeTargetDisplayWidth(mode);
  return Math.max(0.25, Math.min(1.65, targetDisplayWidth / Math.max(120, pageUnscaledWidth)));
}

function computeOverlayBox(para, viewport) {
  const padX = para.isCompactLabel ? 1.5 : 2.5;
  const padY = para.isCompactLabel ? 0.5 : 1.0;
  const left = Math.max(0, para.x - padX);
  const top = Math.max(0, para.y - padY);
  const width = Math.min(viewport.width - left, para.w + padX * 2);
  const minHeight = para.h + padY * 2;
  const maxHeight = Math.max(minHeight, para.maxAllowedHeight + padY);
  return { left, top, width, minHeight, maxHeight };
}

function syncCurrentPageFromViewport() {
  if (!state.numPages || state.pages.size === 0) return;
  const vh = window.innerHeight || 800;
  const toolbarBottom = document.getElementById('toolbar')?.getBoundingClientRect().bottom || 52;
  const anchorY = toolbarBottom + Math.max(40, (vh - toolbarBottom) * 0.35);

  let anchorMatch = null;
  let bestOverlapPage = null;
  let bestOverlap = 0;

  for (const pageRec of state.pages.values()) {
    const rect = pageRec.rowEl.getBoundingClientRect();
    if (rect.top > vh) break;
    if (rect.bottom < toolbarBottom) continue;

    if (rect.top <= anchorY && rect.bottom >= anchorY) {
      anchorMatch = pageRec.pageNum;
      break;
    }

    const visTop = Math.max(toolbarBottom, rect.top);
    const visBot = Math.min(vh, rect.bottom);
    const overlap = Math.max(0, visBot - visTop);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestOverlapPage = pageRec.pageNum;
    }
  }

  const nextPage = anchorMatch ?? bestOverlapPage;
  if (nextPage !== null && nextPage !== state.currentPage) {
    updatePageIndicator(nextPage);
  }
}

function scheduleSyncCurrentPage() {
  if (state.pageTrackRaf) return;
  state.pageTrackRaf = requestAnimationFrame(() => {
    state.pageTrackRaf = 0;
    syncCurrentPageFromViewport();
  });
}

function setMode(nextMode) {
  if (!['overlay', 'split', 'original'].includes(nextMode)) return;
  state.mode = nextMode;
  dom.viewerMain.dataset.mode = nextMode;
  closeComparePopover();

  const buttons = dom.modeSegmented.querySelectorAll('.nr-seg-btn');
  for (const btn of buttons) {
    const active = btn.dataset.mode === nextMode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  }

  if (state.pdfDoc) {
    const nextBaseFitScale = computePageBaseFitScale(state.defaultPageWidth || 612, nextMode);
    let anyScaleChanged = Math.abs(nextBaseFitScale - state.baseFitScale) > 0.01;
    if (!anyScaleChanged) {
      for (const pageRec of state.pages.values()) {
        const expected = computePageBaseFitScale(pageRec.baseWidth || state.defaultPageWidth || 612, nextMode);
        if (Math.abs(expected - (pageRec.baseFitScale || state.baseFitScale)) > 0.01) {
          anyScaleChanged = true;
          break;
        }
      }
    }
    if (anyScaleChanged) {
      state.baseFitScale = nextBaseFitScale;
      refreshPageShellsForCurrentScale();
    }
  }

  // Re-fit any overlays that were rendered while overlay layer was display:none (in split/original mode)
  if (nextMode === 'overlay') {
    requestAnimationFrame(() => {
      for (const pageRec of state.pages.values()) {
        if (!pageRec.needsOverlayRefit || !pageRec.viewport) continue;
        pageRec.needsOverlayRefit = false;
        for (const para of pageRec.translatableParagraphs || []) {
          const el = pageRec.overlayById.get(para.id);
          if (!el) continue;
          const box = computeOverlayBox(para, pageRec.viewport);
          fitOverlayTypography(el, para, box.maxHeight, box.width);
        }
      }
      syncCurrentPageFromViewport();
    });
  } else {
    requestAnimationFrame(() => {
      syncCurrentPageFromViewport();
    });
  }
}

function populateLanguageSelect(currentLang) {
  dom.langSelect.replaceChildren();
  for (const [id, info] of Object.entries(TARGET_LANGUAGES)) {
    if (id === 'custom' && !String(state.settings?.customTargetLang || '').trim()) {
      continue;
    }
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id === 'custom'
      ? String(state.settings?.customTargetLang || info.label)
      : info.label;
    dom.langSelect.appendChild(opt);
  }
  if (Array.from(dom.langSelect.options).some((o) => o.value === currentLang)) {
    dom.langSelect.value = currentLang;
  } else {
    dom.langSelect.value = 'zh-TW';
  }
}

function getPageContext() {
  return {
    pageType: 'universal',
    title: state.docTitle || 'PDF Document',
    host: state.docHost || 'local-pdf',
    useTechGlossary: true
  };
}

// ============================================================
// Language, Math Preservation & LaTeX Normalization
// ============================================================
const PROSE_STOPWORD_SET = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as',
  'that', 'this', 'these', 'those', 'which', 'or', 'and', 'but', 'not',
  'we', 'our', 'they', 'their', 'it', 'its', 'can', 'may', 'will',
  'has', 'have', 'had', 'using', 'used', 'into', 'between', 'among',
  'above', 'below', 'each', 'all', 'both', 'such', 'figure', 'table',
  'section', 'also', 'more', 'most', 'only', 'than', 'then', 'when'
]);

const MATH_KEYWORD_SET = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'exp', 'lim', 'sup', 'inf', 'max', 'min', 'argmax', 'argmin',
  'softmax', 'sigmoid', 'relu', 'gelu', 'det', 'dim', 'mod', 'diag', 'trace',
  'concat', 'attention', 'multihead', 'layernorm', 'sublayer', 'ffn', 'pe', 'pos'
]);

function isDisplayedMathBlock(clean, meta = {}) {
  const explicitMathOps = (
    clean.match(/[=≈≠≤≥≡≢∼≃≅∝<>±×÷−·⋅∙∘⊗⊕∗∑∏∫∮√∞∂∇∈∉∋⊂⊃⊆⊇∪∩∀∃∧∨¬→←↔⇒⇐⇔↦^_{}\\|′″‖⟨⟩⌊⌋⌈⌉]/g) || []
  ).length;
  const relationOps = (clean.match(/[=≈≠≤≥≡∼∝∈∉⊂⊆→⇒⇔]/g) || []).length;
  const funcCallMatches = clean.match(/[A-Za-z_][A-Za-z0-9_]*\s*\(/g) || [];
  const funcCallTokens = funcCallMatches.length;
  const arithOps = (clean.match(/(?<=[A-Za-z0-9)\]}])\s*[+\-/]\s*(?=[A-Za-z0-9(\[{√∑∫])/g) || []).length;

  // Strip "where <var> ... =" intro only for stopword counting
  const strippedWhere = clean.replace(/^where\s+(?=[A-Za-z_\u0391-\u03C9].*[=≈≤≥∈])/i, '');
  const rawTokens = strippedWhere.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  let proseStopwords = 0;
  for (const tok of rawTokens) {
    if (PROSE_STOPWORD_SET.has(tok.toLowerCase())) {
      proseStopwords += 1;
    }
  }

  // Count non-math prose words (exclude function names, math keywords, CamelCase/underscored ids, short vars)
  const withoutFuncNames = strippedWhere.replace(/[A-Za-z_][A-Za-z0-9_]*\s*\(/g, '(');
  const candidateWords = withoutFuncNames.match(/[A-Za-z][A-Za-z0-9_]*/g) || [];
  let nonMathProseWords = 0;
  for (const w of candidateWords) {
    const low = w.toLowerCase();
    if (w.length <= 2) continue;
    if (w.includes('_')) continue;
    if (/[a-z][A-Z]/.test(w)) continue; // CamelCase identifiers (LayerNorm, MultiHead, Sublayer)
    if (PROSE_STOPWORD_SET.has(low) || MATH_KEYWORD_SET.has(low)) continue;
    nonMathProseWords += 1;
  }

  const mathRatio = explicitMathOps / Math.max(1, clean.length);
  const wordsAll = clean.match(/[a-zA-Z\p{L}]{2,}/gu) || [];
  if (explicitMathOps >= 3 && mathRatio > 0.16 && wordsAll.length < 6) {
    return true;
  }
  if (meta.isHeading) return false;

  if (meta.endsWithEqNum && relationOps >= 1 && proseStopwords <= 2) return true;
  if (relationOps >= 1 && (explicitMathOps + funcCallTokens + arithOps) >= 2 && proseStopwords <= 1 && nonMathProseWords <= 3) {
    return true;
  }
  if ((explicitMathOps + arithOps) >= 3 && proseStopwords === 0 && nonMathProseWords <= 2) return true;
  if ((meta.mathFontRatio || 0) >= 0.45 && proseStopwords <= 1 && nonMathProseWords <= 2) return true;
  if (
    meta.isCentered &&
    (meta.lineCount || 1) <= 2 &&
    (explicitMathOps + funcCallTokens) >= 2 &&
    proseStopwords === 0 &&
    nonMathProseWords <= 2 &&
    !/[.?!]$/.test(clean)
  ) {
    return true;
  }
  return false;
}

function shouldTranslatePdfText(text, targetLangId, meta = {}) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 4) return false;

  // Skip URLs, emails, DOIs, arXiv stamps
  if (/^(?:https?:\/\/|www\.|mailto:|ftp:\/\/)\S+$/i.test(clean)) return false;
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(clean)) return false;
  if (/^(?:doi:|arxiv:)\S+$/i.test(clean)) return false;

  // Skip pure numbers, equation tags, page numbers, table numbers, ratios, dates
  if (/^[\d\s.,:%+\-−–—/()[\]$€£¥°×÷±·⋅≈≠≤≥∞√∑∏∫∂∇∈∉⊂⊃∪∩∀∃→←↔⇒⇐⇔′″‖⟨⟩\u0370-\u03FF]+$/.test(clean)) return false;
  if (/^(?:\(\s*\d+(?:\.\d+)*[a-z]?\s*\)|\[\s*\d+(?:,\s*\d+)*\s*\])$/.test(clean)) return false;
  if (/^(?:page|p\.?|pp\.?)\s*\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(clean)) return false;
  if (/^\d+\s*\/\s*\d+$/.test(clean)) return false;
  if (/^(?:fig\.?|figure|table|tab\.?|eq\.?)\s*\d+[a-z]?\.?$/i.test(clean)) return false;

  const letters = clean.match(/\p{L}/gu) || [];
  if (letters.length < 2) return false;

  // Skip pure monospace code-like lines
  if (meta.isMono && /[=(){}[\];<>]|^\s*(?:def|class|import|from|return|const|let|var|for|while|if)\b/.test(clean)) {
    return false;
  }

  // Skip displayed equations / mathematical formulas
  if (isDisplayedMathBlock(clean, meta)) {
    return false;
  }

  const words = clean.match(/[a-zA-Z\p{L}]{2,}/gu) || [];

  // Skip single short isolated chart tick labels / tiny table cells (unless heading)
  if (
    !meta.isHeading &&
    meta.lineCount === 1 &&
    meta.widthRatio !== undefined &&
    meta.widthRatio < 0.14 &&
    words.length <= 2 &&
    clean.length < 16
  ) {
    return false;
  }

  // Skip text already written in target language
  const letterTotal = letters.length;
  const hanCount = (clean.match(/\p{Script=Han}/gu) || []).length;
  const kanaCount = (clean.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
  const hangulCount = (clean.match(/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/g) || []).length;
  const target = String(targetLangId || 'zh-TW');

  if (target === 'zh-TW' || target === 'zh-CN') {
    if (kanaCount / letterTotal >= 0.12) return true; // Japanese -> translate to Chinese
    if (hanCount / letterTotal >= 0.55) {
      const latinWords = clean.match(/[a-zA-Z]{2,}/g) || [];
      if (latinWords.length < 6) return false;
    }
  } else if (target === 'ja') {
    if ((kanaCount + hanCount) / letterTotal >= 0.55 && kanaCount >= 2) {
      return false;
    }
  } else if (target === 'ko') {
    if (hangulCount / letterTotal >= 0.5) {
      return false;
    }
  }

  return true;
}

function protectInlineMath(text) {
  const src = String(text || '');
  const placeholders = new Map();
  let seq = 0;
  const addToken = (match) => {
    const token = `[[M${seq++}]]`;
    placeholders.set(token, match);
    return token;
  };

  let out = src;

  // 1. Parenthesized sequences/tuples: (x 1 , ..., x n ), (z 1 , ..., z n ), (y_1, ..., y_m)
  out = out.replace(
    /\(\s*[A-Za-z\u0391-\u03C9](?:\s*_?\s*[0-9a-zA-Z])?\s*,\s*(?:\.\.\.|…)\s*,\s*[A-Za-z\u0391-\u03C9](?:\s*_?\s*[0-9a-zA-Z])?\s*\)/g,
    (m) => (m.includes('[[M') ? m : addToken(m))
  );

  // 2. Math function calls with math operators or 1-2 short variable arguments (supports 1 level of nested parens)
  out = out.replace(
    /\b[A-Za-z][A-Za-z0-9_]*\(((?:\([^()]{1,28}\)|[^()]){1,48})\)/g,
    (m, inner) => {
      if (m.includes('[[M')) return m;
      const hasMathOp = /[=+\-−*/^_<>|]/.test(inner);
      const isShortVarArgs = /^\s*[A-Za-z\u0391-\u03C9](?:\s*,\s*[A-Za-z\u0391-\u03C9])?\s*$/.test(inner);
      if (hasMathOp || isShortVarArgs) {
        return addToken(m);
      }
      return m;
    }
  );

  // 3. Compact inline assignments/relations: N = 6, d model = 512, d_k = 64, z = [[M0]]
  out = out.replace(
    /\b[A-Za-z\u0391-\u03C9](?:_[A-Za-z0-9]+|\s+[a-z]{1,6})?\s*[=≈≠≤≥∈⊂→]\s*(?:(?:−|-)?\d+(?:\.\d+)?|\[\[M\d+\]\]|\([^)]{1,32}\))/g,
    (m) => addToken(m)
  );

  return { text: out, placeholders };
}

function restoreMathPlaceholders(text, placeholders) {
  let out = String(text || '');
  if (!placeholders || placeholders.size === 0) return out;
  for (let pass = 0; pass < 4; pass++) {
    const next = out.replace(/\[\[\s*M\s*(\d+)\s*\]\]/gi, (full, idx) => {
      const key = `[[M${idx}]]`;
      return placeholders.has(key) ? placeholders.get(key) : full;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

const LATEX_BLACKBOARD_MAP = {
  R: 'ℝ', Z: 'ℤ', N: 'ℕ', C: 'ℂ', E: '𝔼', P: 'ℙ', Q: 'ℚ'
};

const LATEX_SYMBOL_MAP = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ',
  rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', cdot: '·', cdots: '⋯', ldots: '…', dots: '…', vdots: '⋮', ddots: '⋱',
  pm: '±', mp: '∓', div: '÷', ast: '∗', star: '⋆', circ: '∘', bullet: '•',
  otimes: '⊗', oplus: '⊕', leq: '≤', le: '≤', geq: '≥', ge: '≥',
  neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝',
  ll: '≪', gg: '≫', in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃',
  subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩', forall: '∀', exists: '∃',
  neg: '¬', land: '∧', lor: '∨', to: '→', rightarrow: '→', leftarrow: '←',
  leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦',
  sum: '∑', prod: '∏', int: '∫', oint: '∮', infty: '∞', partial: '∂', nabla: '∇',
  emptyset: '∅', varnothing: '∅', angle: '∠', prime: '′', perp: '⊥', parallel: '∥',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉'
};

const UNICODE_SUBSCRIPT_MAP = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ',
  n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ'
};

const UNICODE_SUPERSCRIPT_MAP = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  n: 'ⁿ', i: 'ⁱ', T: 'ᵀ', '*': '∗'
};

function readBraceGroup(str, openIdx) {
  if (str[openIdx] !== '{') return null;
  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === '{' && str[i - 1] !== '\\') depth += 1;
    else if (str[i] === '}' && str[i - 1] !== '\\') {
      depth -= 1;
      if (depth === 0) {
        return { content: str.slice(openIdx + 1, i), endIdx: i + 1 };
      }
    }
  }
  return null;
}

function replaceLatexMacroWithOneArg(str, macroRegex, transformFn) {
  let out = '';
  let pos = 0;
  macroRegex.lastIndex = 0;
  let match;
  while ((match = macroRegex.exec(str)) !== null) {
    const start = match.index;
    const afterCmd = start + match[0].length;
    let braceStart = afterCmd;
    while (braceStart < str.length && str[braceStart] === ' ') braceStart += 1;
    const grp = readBraceGroup(str, braceStart);
    if (!grp) continue;
    out += str.slice(pos, start) + transformFn(grp.content, match[1]);
    pos = grp.endIdx;
    macroRegex.lastIndex = pos;
  }
  return out + str.slice(pos);
}

function replaceLatexFrac(str) {
  const fracRe = /\\(?:d|t)?frac\b/g;
  let out = '';
  let pos = 0;
  let match;
  while ((match = fracRe.exec(str)) !== null) {
    const start = match.index;
    let idx = start + match[0].length;
    while (idx < str.length && str[idx] === ' ') idx += 1;
    const numGrp = readBraceGroup(str, idx);
    if (!numGrp) continue;
    idx = numGrp.endIdx;
    while (idx < str.length && str[idx] === ' ') idx += 1;
    const denGrp = readBraceGroup(str, idx);
    if (!denGrp) continue;
    const num = numGrp.content.trim();
    const den = denGrp.content.trim();
    const numFmt = /[+\-\s]/.test(num) && !/^\(.*\)$/.test(num) ? `(${num})` : num;
    const denFmt = /[+\-\s]/.test(den) && !/^\(.*\)$/.test(den) ? `(${den})` : den;
    out += str.slice(pos, start) + `${numFmt}/${denFmt}`;
    pos = denGrp.endIdx;
    fracRe.lastIndex = pos;
  }
  return out + str.slice(pos);
}

function mapScriptChars(raw, mapObj, fallbackPrefix) {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  let converted = '';
  for (const ch of trimmed) {
    if (!Object.prototype.hasOwnProperty.call(mapObj, ch)) {
      return `${fallbackPrefix}${trimmed}`;
    }
    converted += mapObj[ch];
  }
  return converted;
}

function latexToUnicode(expr) {
  let s = String(expr || '').trim();
  if (!s) return '';

  // Remove sizing & explicit LaTeX spacing macros
  s = s.replace(/\\(?:left|right|bigl?|Bigl?|biggl?|Biggl?|bigr?|Bigr?|biggr?|Biggr?)\b/g, '');
  s = s.replace(/\\(?:qquad|quad|,|;|!|:|\s)/g, ' ');

  // Unwrap \mathbb{R} -> ℝ
  s = replaceLatexMacroWithOneArg(s, /\\mathbb\b/g, (inner) => {
    const k = inner.trim();
    return LATEX_BLACKBOARD_MAP[k] || k;
  });

  // Iteratively unwrap text/font wrappers (\text, \mathrm, \operatorname, \mathbf, etc.)
  const fontWrapperRe = /\\(?:text|mathrm|operatorname|mathbf|mathit|mathsf|mathtt|boldsymbol|bm|mathcal|mbox)\b/g;
  for (let pass = 0; pass < 3; pass++) {
    const next = replaceLatexMacroWithOneArg(s, fontWrapperRe, (inner) => inner);
    if (next === s) break;
    s = next;
  }

  // Convert \frac / \dfrac / \tfrac and \sqrt and accents
  for (let pass = 0; pass < 2; pass++) {
    s = replaceLatexFrac(s);
    s = replaceLatexMacroWithOneArg(s, /\\sqrt\b/g, (inner) => {
      const t = inner.trim();
      return t.length === 1 ? `√${t}` : `√(${t})`;
    });
  }
  s = replaceLatexMacroWithOneArg(s, /\\(hat|bar|tilde|vec|overline)\b/g, (inner, cmd) => {
    const t = inner.trim();
    const comb = cmd === 'hat' ? '\u0302' : cmd === 'tilde' ? '\u0303' : cmd === 'vec' ? '\u20D7' : '\u0304';
    return t.length === 1 ? `${t}${comb}` : t;
  });

  // Convert \{ and \} before brace cleanup
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}').replace(/\\\|/g, '‖').replace(/\\%/g, '%');

  // Map Greek & math symbol commands
  s = s.replace(/\\([A-Za-z]+)/g, (full, name) => {
    if (Object.prototype.hasOwnProperty.call(LATEX_SYMBOL_MAP, name)) {
      return LATEX_SYMBOL_MAP[name];
    }
    return name;
  });

  // Convert _{...} / _x and ^{...} / ^x to Unicode sub/superscripts when fully representable
  s = s.replace(/_([A-Za-z0-9+\-=()])(?![A-Za-z0-9])/g, (_, ch) => mapScriptChars(ch, UNICODE_SUBSCRIPT_MAP, '_'));
  s = s.replace(/\^([A-Za-z0-9+\-=()*])(?![A-Za-z0-9])/g, (_, ch) => mapScriptChars(ch, UNICODE_SUPERSCRIPT_MAP, '^'));
  s = replaceLatexMacroWithOneArg(s, /_/g, (inner) => mapScriptChars(inner, UNICODE_SUBSCRIPT_MAP, '_'));
  s = replaceLatexMacroWithOneArg(s, /\^/g, (inner) => mapScriptChars(inner, UNICODE_SUPERSCRIPT_MAP, '^'));

  // Clean stray braces and normalize whitespace
  s = s.replace(/\{([^{}]+)\}/g, '$1').replace(/\{([^{}]+)\}/g, '$1');
  return s.replace(/\s+/g, ' ').trim();
}

function cleanLatexMathInText(text) {
  let out = String(text || '');
  if (!out) return out;

  // 1. Display math $$...$$ and \[...\]
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, inner) => latexToUnicode(inner));
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_, inner) => latexToUnicode(inner));

  // 2. Inline math \(...\)
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_, inner) => latexToUnicode(inner));

  // 3. Inline single-line $...$ (currency-safe: no space right after $ or before closing $)
  out = out.replace(/(?<!\\)\$([^\s$\n](?:[^\n$]*[^\s$\n])?)\$/g, (full, inner) => {
    const hasLatexOrMathOp = /[\\=^_{}<>]|[\u0370-\u03FF\u2200-\u22FF]/.test(inner);
    if (
      /^\d/.test(inner) &&
      !hasLatexOrMathOp &&
      (/\s+[a-z]{2,}/i.test(inner) || !/[+\-*/()]/.test(inner) || /[-–]$/.test(inner))
    ) {
      return full;
    }
    return latexToUnicode(inner);
  });

  // 4. Stray LaTeX wrappers leaked outside delimiters (\text{...}, \mathrm{...}, \frac{...}{...})
  if (/\\(?:text|mathrm|operatorname|mathbf|frac|sqrt|alpha|beta|gamma|theta|lambda|sigma|sum|prod|times|cdot|leq|geq|neq|approx|rightarrow)\b/.test(out)) {
    out = replaceLatexMacroWithOneArg(
      out,
      /\\(?:text|mathrm|operatorname|mathbf|mathit|mathsf|mathtt|boldsymbol|bm)\b/g,
      (inner) => inner
    );
    out = replaceLatexFrac(out);
    out = out.replace(/\\(alpha|beta|gamma|delta|epsilon|varepsilon|theta|lambda|mu|sigma|phi|psi|omega|Gamma|Delta|Theta|Lambda|Sigma|Phi|Psi|Omega|times|cdot|leq|geq|neq|approx|infty|sum|prod|partial|nabla|rightarrow|leftarrow|Rightarrow)\b/g,
      (_, name) => LATEX_SYMBOL_MAP[name] || name
    );
  }

  return out;
}

// ============================================================
// Smart Geometric Paragraph Grouping
// ============================================================
function detectFontMeta(fontName, styles, commonObjs = null) {
  const style = styles?.[fontName] || null;
  let fontObj = null;
  if (commonObjs && fontName && typeof commonObjs.has === 'function' && commonObjs.has(fontName)) {
    try {
      fontObj = commonObjs.get(fontName);
    } catch (_) {
      fontObj = null;
    }
  }
  const combined = `${fontObj?.name || ''} ${fontObj?.fallbackName || ''} ${style?.fontFamily || ''} ${fontName || ''}`;
  const isMono = style?.fontFamily === 'monospace' || MONO_FONT_REGEX.test(combined);
  const isMathFont = !isMono && MATH_FONT_REGEX.test(combined);
  const isSerif = !isMono && (style?.fontFamily === 'serif' || (SERIF_FONT_REGEX.test(combined) && !SANS_FONT_REGEX.test(combined)));
  const fontWeightNum = Number(fontObj?.cssFontInfo?.fontWeight || 0);
  const isBold = Boolean(fontObj?.bold || fontObj?.black || fontWeightNum >= 600 || BOLD_FONT_REGEX.test(combined));
  const italicAngle = Number(fontObj?.cssFontInfo?.italicAngle || 0);
  const isItalic = Boolean(fontObj?.italic || Math.abs(italicAngle) > 2 || ITALIC_FONT_REGEX.test(combined));
  return { isSerif, isMono, isBold, isItalic, isMathFont };
}

function joinLineSpans(spans) {
  let out = '';
  let prev = null;
  for (const sp of spans) {
    const str = sp.str;
    if (!str) continue;
    if (!prev) {
      out = str;
    } else {
      const gap = sp.x - prev.right;
      const avgFs = (sp.fontSize + prev.fontSize) * 0.5;
      const prevEndsSpace = /\s$/.test(out);
      const currStartsSpace = /^\s/.test(str);
      const prevLastChar = out.trimEnd().slice(-1);
      const currFirstChar = str.trimStart().slice(0, 1);
      const bothCjk = /[\p{Script=Han}\u3040-\u30ff]/u.test(prevLastChar) &&
        /[\p{Script=Han}\u3040-\u30ff]/u.test(currFirstChar);

      if (prevEndsSpace || currStartsSpace) {
        out = `${out.trimEnd()} ${str.trimStart()}`;
      } else if (prev.scriptRole === 'sup' && !sp.scriptRole && /^[A-Za-z0-9\p{L}]/u.test(str.trimStart()) && gap > avgFs * 0.08) {
        out = `${out.trimEnd()} ${str.trimStart()}`;
      } else if (!prev.scriptRole && sp.scriptRole && gap <= avgFs * 0.22) {
        out += str;
      } else if (!bothCjk && gap > avgFs * 0.16) {
        out = `${out} ${str}`;
      } else {
        out += str;
      }
    }
    prev = sp;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function joinParagraphLines(lines) {
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const seg = lines[i].text.trim();
    if (!seg) continue;
    if (!out) {
      out = seg;
      continue;
    }
    // De-hyphenate wrapped English words (e.g. "transfor-" + "mation" -> "transformation")
    if (/[a-zA-Z]-$/.test(out) && /^[a-z]/.test(seg)) {
      out = out.slice(0, -1) + seg;
    } else {
      const prevLast = out.slice(-1);
      const nextFirst = seg.slice(0, 1);
      const bothCjk = /[\p{Script=Han}\u3040-\u30ff]/u.test(prevLast) &&
        /[\p{Script=Han}\u3040-\u30ff]/u.test(nextFirst);
      out = bothCjk ? out + seg : `${out} ${seg}`;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

function computeMedianFontSize(paragraphs) {
  const weighted = [];
  for (const p of paragraphs) {
    const len = p.text.length;
    if (len >= 20) {
      weighted.push({ fs: p.fontSize, weight: len });
    }
  }
  const source = weighted.length > 0
    ? weighted
    : paragraphs.map((p) => ({ fs: p.fontSize, weight: Math.max(1, p.text.length) }));
  if (source.length === 0) return 12;

  source.sort((a, b) => a.fs - b.fs);
  const totalWeight = source.reduce((acc, s) => acc + s.weight, 0);
  let acc = 0;
  for (const s of source) {
    acc += s.weight;
    if (acc >= totalWeight * 0.5) return s.fs;
  }
  return source[Math.floor(source.length / 2)].fs;
}

function orderParagraphsReadingOrder(paragraphs, pageWidth) {
  if (!paragraphs || paragraphs.length <= 1) return paragraphs;
  const medianFs = computeMedianFontSize(paragraphs);
  const yEps = Math.min(3, Math.max(1.5, medianFs * 0.2));
  const minColGutter = Math.max(5, medianFs * 0.65);

  function sortFallback(items) {
    return items.slice().sort((a, b) => {
      const yDiff = a.y - b.y;
      if (Math.abs(yDiff) <= Math.min(a.fontSize, b.fontSize) * 0.45) {
        return a.x - b.x;
      }
      return yDiff || (a.x - b.x);
    });
  }

  function findInteriorXValley(items) {
    const binW = 2;
    const numBins = Math.max(1, Math.ceil(pageWidth / binW));
    const occ = new Float32Array(numBins);
    let minItemX = Infinity;
    let maxItemRight = -Infinity;

    for (const p of items) {
      if (p.x < minItemX) minItemX = p.x;
      if (p.right > maxItemRight) maxItemRight = p.right;
      const b0 = Math.max(0, Math.floor(p.x / binW));
      const b1 = Math.min(numBins - 1, Math.floor(p.right / binW));
      for (let b = b0; b <= b1; b++) occ[b] += Math.max(1, p.h);
    }

    const searchMinX = Math.max(pageWidth * 0.18, minItemX + medianFs);
    const searchMaxX = Math.min(pageWidth * 0.82, maxItemRight - medianFs);
    if (searchMaxX <= searchMinX) return null;

    const minBin = Math.max(0, Math.floor(searchMinX / binW));
    const maxBin = Math.min(numBins - 1, Math.ceil(searchMaxX / binW));
    const margin = Math.max(4, medianFs * 0.35);

    let bestResult = null;
    let bestScore = Infinity;

    for (let b = minBin; b <= maxBin; b++) {
      if (occ[b] >= bestScore) continue;
      const gutterX = (b + 0.5) * binW;
      let leftCount = 0;
      let rightCount = 0;
      let straddleCount = 0;
      for (const p of items) {
        if (p.right <= gutterX + margin) leftCount++;
        else if (p.x >= gutterX - margin) rightCount++;
        else straddleCount++;
      }
      if (
        leftCount >= 2 &&
        rightCount >= 2 &&
        straddleCount > 0 &&
        straddleCount <= Math.max(2, Math.floor(items.length * 0.35))
      ) {
        bestScore = occ[b];
        bestResult = { gutterX, margin };
      }
    }

    return bestResult;
  }

  function xyCut(items, depth = 0) {
    if (items.length <= 1 || depth > 12) return sortFallback(items);

    // 1. Try Y-Cut (partition into horizontal bands with clear vertical whitespace)
    const byTop = items.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const yBands = [];
    let curBand = [byTop[0]];
    let maxBottom = byTop[0].bottom;
    for (let i = 1; i < byTop.length; i++) {
      const p = byTop[i];
      if (p.y >= maxBottom - yEps) {
        yBands.push(curBand);
        curBand = [p];
        maxBottom = p.bottom;
      } else {
        curBand.push(p);
        if (p.bottom > maxBottom) maxBottom = p.bottom;
      }
    }
    yBands.push(curBand);
    if (yBands.length > 1) {
      const out = [];
      for (const band of yBands) out.push(...xyCut(band, depth + 1));
      return out;
    }

    // 2. Try X-Cut (partition band into N columns left-to-right via X-interval sweep)
    const byLeft = items.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
    const xCols = [];
    let curCol = [byLeft[0]];
    let maxRight = byLeft[0].right;
    for (let i = 1; i < byLeft.length; i++) {
      const p = byLeft[i];
      if (p.x >= maxRight + minColGutter) {
        xCols.push(curCol);
        curCol = [p];
        maxRight = p.right;
      } else {
        curCol.push(p);
        if (p.right > maxRight) maxRight = p.right;
      }
    }
    xCols.push(curCol);
    if (xCols.length > 1) {
      const out = [];
      for (const col of xCols) out.push(...xyCut(col, depth + 1));
      return out;
    }

    // 3. Straddler-Split Fallback (centered/spanning items crossing a strong interior valley)
    const valley = findInteriorXValley(byTop);
    if (valley) {
      const subBands = [];
      let cur = [];
      const isStraddler = (p) => !(p.right <= valley.gutterX + valley.margin || p.x >= valley.gutterX - valley.margin);
      for (const p of byTop) {
        if (isStraddler(p)) {
          if (cur.length > 0) {
            subBands.push(cur);
            cur = [];
          }
          subBands.push([p]);
        } else {
          cur.push(p);
        }
      }
      if (cur.length > 0) subBands.push(cur);
      if (subBands.length > 1) {
        const out = [];
        for (const sb of subBands) out.push(...xyCut(sb, depth + 1));
        return out;
      }
    }

    return sortFallback(items);
  }

  return xyCut(paragraphs, 0);
}

function extractPdfParagraphs(textContent, viewport, commonObjs = null) {
  const rawItems = textContent?.items || [];
  const styles = textContent?.styles || {};
  if (rawItems.length === 0) return [];

  // 1. Convert PDF text items into CSS viewport coordinates
  const spans = [];
  for (const item of rawItems) {
    if (!item || typeof item.str !== 'string') continue;
    const trimmed = item.str.trim();
    if (!trimmed) continue;
    if (!Array.isArray(item.transform) || item.transform.length < 6) continue;

    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const angle = Math.atan2(tx[1], tx[0]);
    // Skip vertically/strongly rotated text (e.g., rotated chart Y-axis labels)
    if (Math.abs(angle) > 0.25) continue;

    const fontSize = Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]) || (item.height * viewport.scale) || 12;
    if (!Number.isFinite(fontSize) || fontSize < 3.8 * viewport.scale) continue;

    const x = tx[4];
    const baselineY = tx[5];
    let w = (item.width || 0) * viewport.scale;
    if (!Number.isFinite(w) || w <= 0) {
      w = trimmed.length * fontSize * 0.52;
    }
    const h = Math.max(fontSize * 1.14, (item.height || 0) * viewport.scale);
    const top = baselineY - fontSize * 0.88;
    const bottom = baselineY + fontSize * 0.24;

    if (x + w < 0 || x > viewport.width || bottom < 0 || top > viewport.height) {
      continue;
    }

    const fontMeta = detectFontMeta(item.fontName, styles, commonObjs);
    spans.push({
      str: item.str,
      charLen: trimmed.length,
      x,
      right: x + w,
      w,
      top,
      bottom,
      h,
      baselineY,
      fontSize,
      scriptRole: null,
      ...fontMeta
    });
  }

  if (spans.length === 0) return [];

  // 2a. Strict same-scale row clustering
  spans.sort((a, b) => (a.baselineY - b.baselineY) || (a.x - b.x));
  const rawRows = [];
  for (const sp of spans) {
    let matchedRow = null;
    for (let i = rawRows.length - 1; i >= 0; i--) {
      const row = rawRows[i];
      const minFs = Math.min(row.avgFontSize, sp.fontSize);
      const maxFs = Math.max(row.avgFontSize, sp.fontSize);
      const tol = 0.34 * minFs;
      if (Math.abs(sp.baselineY - row.baselineY) <= tol && maxFs / Math.max(0.1, minFs) <= 1.25) {
        matchedRow = row;
        break;
      }
      if (sp.baselineY - row.baselineY > maxFs * 1.2) {
        break;
      }
    }
    if (matchedRow) {
      const prevWeight = matchedRow.weight;
      const nextWeight = prevWeight + sp.charLen;
      matchedRow.baselineY = (matchedRow.baselineY * prevWeight + sp.baselineY * sp.charLen) / nextWeight;
      matchedRow.avgFontSize = (matchedRow.avgFontSize * prevWeight + sp.fontSize * sp.charLen) / nextWeight;
      matchedRow.weight = nextWeight;
      if (sp.top < matchedRow.top) matchedRow.top = sp.top;
      if (sp.bottom > matchedRow.bottom) matchedRow.bottom = sp.bottom;
      matchedRow.spans.push(sp);
    } else {
      rawRows.push({
        baselineY: sp.baselineY,
        avgFontSize: sp.fontSize,
        weight: sp.charLen,
        top: sp.top,
        bottom: sp.bottom,
        spans: [sp]
      });
    }
  }

  // 2b. Geometric Superscript/Subscript Absorption anchored to hostRow.avgFontSize
  rawRows.sort((a, b) => a.baselineY - b.baselineY);
  for (let rIdx = 0; rIdx < rawRows.length; rIdx++) {
    const row = rawRows[rIdx];
    const remainingSpans = [];
    for (const sp of row.spans) {
      let bestHost = null;
      let bestDist = Infinity;
      let bestRole = null;

      for (let hIdx = 0; hIdx < rawRows.length; hIdx++) {
        if (hIdx === rIdx) continue;
        const hostRow = rawRows[hIdx];
        const hostFs = hostRow.avgFontSize;
        if (Math.abs(hostRow.baselineY - sp.baselineY) > 0.65 * hostFs) continue;
        if (row.avgFontSize > 0.90 * hostFs) continue;

        // Guard 2: Size asymmetry
        const sizeOk = sp.fontSize <= 0.85 * hostFs || (sp.fontSize <= 0.90 * hostFs && sp.charLen <= 3);
        if (!sizeOk) continue;

        // Guard 1: Vertical script zone
        const dySup = hostRow.baselineY - sp.baselineY;
        const dySub = sp.baselineY - hostRow.baselineY;
        const isSuper = dySup >= 0.10 * hostFs && dySup <= 0.62 * hostFs && sp.bottom >= hostRow.top - 0.15 * hostFs;
        const isSub = dySub >= 0.06 * hostFs && dySub <= 0.48 * hostFs && sp.top <= hostRow.bottom + 0.12 * hostFs;
        if (!isSuper && !isSub) continue;

        // Guard 3 & 4: Non-stacking horizontal disjointness + horizontal adjacency
        let stackedOverlap = false;
        let minHorizGap = Infinity;
        let hasMainSpan = false;
        for (const h of hostRow.spans) {
          if (h.scriptRole) continue;
          hasMainSpan = true;
          const xOver = Math.min(sp.right, h.right) - Math.max(sp.x, h.x);
          if (xOver > 0.35 * sp.w) {
            stackedOverlap = true;
            break;
          }
          const hGap = Math.max(0, sp.x - h.right, h.x - sp.right);
          if (hGap < minHorizGap) minHorizGap = hGap;
        }
        if (!hasMainSpan || stackedOverlap || minHorizGap > 1.2 * hostFs) continue;

        const dist = Math.abs(hostRow.baselineY - sp.baselineY) + minHorizGap * 0.1;
        if (dist < bestDist) {
          bestDist = dist;
          bestHost = hostRow;
          bestRole = isSuper ? 'sup' : 'sub';
        }
      }

      if (bestHost) {
        sp.scriptRole = bestRole;
        bestHost.spans.push(sp);
      } else {
        remainingSpans.push(sp);
      }
    }
    row.spans = remainingSpans;
  }

  const rows = rawRows.filter((r) => r.spans.length > 0);

  // 3. Split rows into column-safe horizontal line segments via contiguous gutter support
  for (const row of rows) {
    row.spans.sort((a, b) => a.x - b.x);
  }

  const binW = 2;
  const numBins = Math.max(1, Math.ceil(viewport.width / binW));
  const gapVotes = new Uint16Array(numBins);
  const bulletOnlyRe = /^(?:[•●▪▸►‣⁃◦–—\-*]|\(?\d{1,3}[.)]|[a-zA-Z][.)])$/;

  for (const row of rows) {
    for (let i = 1; i < row.spans.length; i++) {
      const prev = row.spans[i - 1];
      const curr = row.spans[i];
      const gap = curr.x - prev.right;
      const maxFs = Math.max(prev.fontSize, curr.fontSize);
      if (i === 1 && prev.w < 2.4 * maxFs && bulletOnlyRe.test(prev.str.trim())) continue;
      if (gap >= 1.0 * maxFs) {
        const b0 = Math.max(0, Math.floor(prev.right / binW));
        const b1 = Math.min(numBins - 1, Math.floor(curr.x / binW));
        for (let b = b0; b <= b1; b++) gapVotes[b] += 1;
      }
    }
  }

  const rowBridgesX = (otherRow, xLeft, xRight, maxFs) => {
    const innerL = xLeft + 0.15 * maxFs;
    const innerR = xRight - 0.15 * maxFs;
    const xCenter = (xLeft + xRight) * 0.5;
    for (let i = 0; i < otherRow.spans.length; i++) {
      const s = otherRow.spans[i];
      if (s.right > innerL && s.x < innerR) return true;
      if (i > 0) {
        const p = otherRow.spans[i - 1];
        if (p.right <= xCenter && s.x >= xCenter && (s.x - p.right) < 0.95 * Math.max(p.fontSize, s.fontSize)) {
          return true;
        }
      }
    }
    return false;
  };

  const rowHasGutterAt = (otherRow, xCenter, maxFs) => {
    let hasLeft = false;
    let hasRight = false;
    let maxLeftRight = -Infinity;
    let minRightX = Infinity;
    const guardHalf = 0.25 * maxFs;
    for (const s of otherRow.spans) {
      if (s.x < xCenter + guardHalf && s.right > xCenter - guardHalf) return false;
      if (s.right <= xCenter - guardHalf) {
        hasLeft = true;
        if (s.right > maxLeftRight) maxLeftRight = s.right;
      } else if (s.x >= xCenter + guardHalf) {
        hasRight = true;
        if (s.x < minRightX) minRightX = s.x;
      }
    }
    return hasLeft && hasRight && (minRightX - maxLeftRight) >= 0.95 * maxFs;
  };

  const lines = [];
  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx];
    let segSpans = [row.spans[0]];

    const flushSegment = (group) => {
      const text = joinLineSpans(group);
      if (!text) return;
      let minX = Infinity;
      let maxRight = -Infinity;
      let minTop = Infinity;
      let maxBottom = -Infinity;
      let totalWeight = 0;
      let mainWeight = 0;
      let fsSum = 0;
      let baselineSum = 0;
      let serifWeight = 0;
      let boldWeight = 0;
      let italicWeight = 0;
      let monoWeight = 0;
      let mathFontWeight = 0;

      for (const s of group) {
        if (s.x < minX) minX = s.x;
        if (s.right > maxRight) maxRight = s.right;
        if (s.top < minTop) minTop = s.top;
        if (s.bottom > maxBottom) maxBottom = s.bottom;
        totalWeight += s.charLen;
        if (!s.scriptRole) {
          mainWeight += s.charLen;
          fsSum += s.fontSize * s.charLen;
          baselineSum += s.baselineY * s.charLen;
        }
        if (s.isSerif) serifWeight += s.charLen;
        if (s.isBold) boldWeight += s.charLen;
        if (s.isItalic) italicWeight += s.charLen;
        if (s.isMono) monoWeight += s.charLen;
        if (s.isMathFont) mathFontWeight += s.charLen;
      }

      if (mainWeight === 0) {
        for (const s of group) {
          mainWeight += s.charLen;
          fsSum += s.fontSize * s.charLen;
          baselineSum += s.baselineY * s.charLen;
        }
      }

      lines.push({
        text,
        x: minX,
        right: maxRight,
        w: Math.max(1, maxRight - minX),
        top: minTop,
        bottom: maxBottom,
        h: Math.max(1, maxBottom - minTop),
        baselineY: baselineSum / mainWeight,
        fontSize: fsSum / mainWeight,
        weight: totalWeight,
        mathFontWeight,
        isSerif: serifWeight > totalWeight * 0.5,
        isBold: boldWeight > totalWeight * 0.5,
        isItalic: italicWeight > totalWeight * 0.5,
        isMono: monoWeight > totalWeight * 0.6
      });
    };

    for (let i = 1; i < row.spans.length; i++) {
      const prev = segSpans[segSpans.length - 1];
      const curr = row.spans[i];
      const gap = curr.x - prev.right;
      const maxFs = Math.max(prev.fontSize, curr.fontSize);
      const fsRatioDiff = Math.abs(prev.fontSize - curr.fontSize) / maxFs;
      const gapCenter = (prev.right + curr.x) * 0.5;

      let shouldSplit = false;
      const segWidth = prev.right - segSpans[0].x;
      const isBulletPrefix =
        segWidth < 2.4 * maxFs &&
        gap <= 2.8 * maxFs &&
        bulletOnlyRe.test(joinLineSpans(segSpans));

      if (!isBulletPrefix && gap > 0.95 * maxFs) {
        let contiguousClear = 1;
        for (let k = rIdx - 1; k >= 0; k--) {
          if (row.baselineY - rows[k].baselineY > 18 * maxFs) break;
          if (rowBridgesX(rows[k], prev.right, curr.x, maxFs)) break;
          if (rowHasGutterAt(rows[k], gapCenter, maxFs)) contiguousClear += 1;
        }
        for (let k = rIdx + 1; k < rows.length; k++) {
          if (rows[k].baselineY - row.baselineY > 18 * maxFs) break;
          if (rowBridgesX(rows[k], prev.right, curr.x, maxFs)) break;
          if (rowHasGutterAt(rows[k], gapCenter, maxFs)) contiguousClear += 1;
        }

        const voteBin = Math.max(0, Math.min(numBins - 1, Math.floor(gapCenter / binW)));
        const pageVotes = gapVotes[voteBin] || 0;

        shouldSplit =
          (contiguousClear >= 3 && gap >= 1.05 * maxFs) ||
          (contiguousClear >= 2 && gap >= 1.25 * maxFs) ||
          (gap > 1.35 * maxFs && fsRatioDiff > 0.25) ||
          (gap >= 1.15 * maxFs && pageVotes >= 4) ||
          gap > 2.6 * maxFs;
      }

      if (shouldSplit) {
        flushSegment(segSpans);
        segSpans = [curr];
      } else {
        segSpans.push(curr);
      }
    }
    flushSegment(segSpans);
  }

  // 4. Merge consecutive lines in the same column into coherent reading paragraphs
  lines.sort((a, b) => (a.top - b.top) || (a.x - b.x));
  const rawParagraphs = [];

  for (const line of lines) {
    let bestPara = null;
    let bestGap = Infinity;

    for (let i = rawParagraphs.length - 1; i >= 0; i--) {
      const p = rawParagraphs[i];
      const avgFs = (p.fontSize + line.fontSize) * 0.5;
      const vGap = line.top - p.bottom;

      // Vertical gap check (<= 1.65 * avgFontSize)
      if (vGap > 1.65 * avgFs) continue;
      if (vGap < -0.55 * avgFs) continue;
      if (line.baselineY - p.lastBaselineY < 0.45 * avgFs) continue;

      // Tightened font size similarity (12%) + 1-line larger-font heading separation
      const fsDiff = Math.abs(line.fontSize - p.fontSize) / Math.max(line.fontSize, p.fontSize);
      if (fsDiff > 0.12) continue;
      if (p.lines.length === 1 && p.fontSize >= line.fontSize * 1.08 && p.w < line.w * 0.80) {
        continue;
      }

      // Same-column horizontal overlap check
      const overlap = Math.min(line.right, p.right) - Math.max(line.x, p.x);
      const minW = Math.min(line.w, p.w);
      const leftDiff = Math.abs(line.x - p.x);
      const centerDiff = Math.abs((line.x + line.right) * 0.5 - (p.x + p.right) * 0.5);
      const sameColumn =
        (overlap > 0 && (overlap >= 0.22 * minW || leftDiff <= 2.4 * avgFs)) ||
        centerDiff <= 2.2 * avgFs;
      if (!sameColumn) continue;

      // Reject merging full-width line with narrow column block (or centered narrow stub with wide body)
      const widthRatio = Math.max(line.w, p.w) / Math.max(1, minW);
      if (widthRatio > 2.2 && leftDiff > 4.0 * avgFs && centerDiff > 2.5 * avgFs) {
        continue;
      }
      if (
        p.lines.length === 1 &&
        line.w > p.w * 2.0 &&
        line.x < p.x - 1.5 * avgFs &&
        line.right > p.right + 1.5 * avgFs
      ) {
        continue;
      }

      // Break on bullet / list item prefixes
      if (BULLET_PREFIX_REGEX.test(line.text)) continue;

      // Break on monospace code vs prose transition
      if (p.isMono !== line.isMono) continue;

      const lastLine = p.lines[p.lines.length - 1];
      const pJoinedText = joinParagraphLines(p.lines);

      // Bidirectional bold boundary guards
      if (
        p.isBold &&
        !line.isBold &&
        p.lines.length <= 2 &&
        p.w < viewport.width * 0.72 &&
        (lastLine.w < line.w * 0.85 || !/[a-z,]$/.test(pJoinedText) || vGap > 0.22 * avgFs || p.fontSize > line.fontSize * 1.03)
      ) {
        continue;
      }
      if (
        !p.isBold &&
        line.isBold &&
        (line.w < p.w * 0.88 || vGap > 0.20 * avgFs || line.fontSize > p.fontSize * 1.03 || /^(\d+(?:\.\d+)*\.?\s+|[A-Z][a-z]+$)/.test(line.text))
      ) {
        continue;
      }

      // Italic boundary guard
      if (
        p.isItalic !== line.isItalic &&
        p.lines.length === 1 &&
        (p.w < viewport.width * 0.45 || vGap > 0.25 * avgFs) &&
        !/[a-z,]-?$/.test(lastLine.text)
      ) {
        continue;
      }

      // Centered author / affiliation / email short-line stack guard
      if (
        p.lines.length === 1 &&
        p.w < viewport.width * 0.28 &&
        line.w < viewport.width * 0.28 &&
        !/[-,;]$/.test(lastLine.text) &&
        !/^[a-z]/.test(line.text) &&
        !/\b(?:of|for|and|in|at|the|on|to|with|de|von|van)$/i.test(lastLine.text) &&
        lastLine.text.split(/\s+/).length <= 5 &&
        (/@|\{/.test(line.text) || (!/[.?!:]$/.test(lastLine.text) && centerDiff <= 1.2 * avgFs))
      ) {
        continue;
      }

      // Break on new paragraph first-line indent when previous line ended short
      if (
        line.x - p.x > 1.25 * avgFs &&
        lastLine.right < p.right - 1.8 * avgFs
      ) {
        continue;
      }

      // Break when previous line clearly ended a paragraph (short line + terminal punctuation + visible gap)
      if (
        p.lines.length >= 2 &&
        lastLine.w < p.w * 0.72 &&
        /[.?!。？！:]$/.test(lastLine.text) &&
        vGap > 0.35 * avgFs
      ) {
        continue;
      }

      // Ensure no other paragraph sits strictly between p and line in overlapping X range
      let blocked = false;
      for (let j = i + 1; j < rawParagraphs.length; j++) {
        const other = rawParagraphs[j];
        const xOver = Math.min(other.right, Math.max(line.right, p.right)) - Math.max(other.x, Math.min(line.x, p.x));
        if (xOver > avgFs && other.y >= p.bottom - 2 && other.bottom <= line.top + 2) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      if (vGap < bestGap) {
        bestGap = vGap;
        bestPara = p;
      }
    }

    if (bestPara) {
      bestPara.lines.push(line);
      bestPara.x = Math.min(bestPara.x, line.x);
      bestPara.right = Math.max(bestPara.right, line.right);
      bestPara.w = bestPara.right - bestPara.x;
      bestPara.y = Math.min(bestPara.y, line.top);
      bestPara.bottom = Math.max(bestPara.bottom, line.bottom);
      bestPara.h = bestPara.bottom - bestPara.y;
      bestPara.lastBaselineY = line.baselineY;

      const nextW = bestPara.weight + line.weight;
      bestPara.fontSize = (bestPara.fontSize * bestPara.weight + line.fontSize * line.weight) / nextW;
      bestPara.serifWeight += line.isSerif ? line.weight : 0;
      bestPara.boldWeight += line.isBold ? line.weight : 0;
      bestPara.italicWeight += line.isItalic ? line.weight : 0;
      bestPara.monoWeight += line.isMono ? line.weight : 0;
      bestPara.mathFontWeight += line.mathFontWeight || 0;
      bestPara.weight = nextW;
      bestPara.isSerif = bestPara.serifWeight > nextW * 0.5;
      bestPara.isBold = bestPara.boldWeight > nextW * 0.5;
      bestPara.isItalic = bestPara.italicWeight > nextW * 0.5;
      bestPara.isMono = bestPara.monoWeight > nextW * 0.6;
    } else {
      rawParagraphs.push({
        lines: [line],
        x: line.x,
        right: line.right,
        w: line.w,
        y: line.top,
        bottom: line.bottom,
        h: line.h,
        lastBaselineY: line.baselineY,
        fontSize: line.fontSize,
        weight: line.weight,
        serifWeight: line.isSerif ? line.weight : 0,
        boldWeight: line.isBold ? line.weight : 0,
        italicWeight: line.isItalic ? line.weight : 0,
        monoWeight: line.isMono ? line.weight : 0,
        mathFontWeight: line.mathFontWeight || 0,
        isSerif: line.isSerif,
        isBold: line.isBold,
        isItalic: line.isItalic,
        isMono: line.isMono
      });
    }
  }

  // Finalize text & compute line height ratio
  const finalized = rawParagraphs.map((p) => {
    const text = joinParagraphLines(p.lines);
    let avgLineHeightRatio = 1.32;
    if (p.lines.length >= 2) {
      let deltaSum = 0;
      for (let i = 1; i < p.lines.length; i++) {
        deltaSum += Math.max(p.fontSize, p.lines[i].baselineY - p.lines[i - 1].baselineY);
      }
      avgLineHeightRatio = (deltaSum / (p.lines.length - 1)) / Math.max(1, p.fontSize);
      avgLineHeightRatio = Math.max(1.18, Math.min(1.55, avgLineHeightRatio));
    }
    const isCentered =
      Math.abs((p.x + p.right) * 0.5 - viewport.width * 0.5) <= viewport.width * 0.08 &&
      p.w < viewport.width * 0.72;
    const endsWithEqNum = /\(\s*\d+(?:\.\d+)*[a-z]?\s*\)$/.test(text);
    const mathFontRatio = (p.mathFontWeight || 0) / Math.max(1, p.weight);

    return {
      text,
      key: hashText(text),
      x: p.x,
      y: p.y,
      right: p.right,
      bottom: p.bottom,
      w: p.w,
      h: p.h,
      fontSize: p.fontSize,
      avgLineHeightRatio,
      lineCount: p.lines.length,
      isSerif: p.isSerif,
      isBold: p.isBold,
      isItalic: p.isItalic,
      isMono: p.isMono,
      isCentered,
      endsWithEqNum,
      mathFontRatio,
      isHeading: false,
      isCompactLabel: false,
      textNearestBelowY: viewport.height - 6,
      maxAllowedHeight: p.h + 4
    };
  });

  const medianFs = computeMedianFontSize(finalized);
  const ordered = orderParagraphsReadingOrder(finalized, viewport.width);

  // Detect headings & calculate safe vertical breathing room (without colliding into next block)
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i];
    p.isHeading =
      (p.fontSize >= 1.20 * medianFs && p.lineCount <= 3 && p.text.length <= 220) ||
      (p.isBold &&
        p.fontSize >= 0.98 * medianFs &&
        p.lineCount <= 2 &&
        p.text.length <= 100 &&
        !/[.,;:]$/.test(p.text) &&
        (p.fontSize >= 1.08 * medianFs ||
          /^(?:\d+(?:\.\d+)*\.?\s+|abstract|introduction|background|related work|method|experiments?|results?|discussion|conclusion|references|appendix|acknowledg|summary|overview)/i.test(p.text)));

    let nearestBelowY = viewport.height - 6;
    for (let j = 0; j < ordered.length; j++) {
      if (i === j) continue;
      const other = ordered[j];
      if (other.y < p.bottom - 2) continue;
      const xOverlap = Math.min(p.right, other.right) - Math.max(p.x, other.x);
      if (xOverlap > 4) {
        if (other.y < nearestBelowY) {
          nearestBelowY = other.y;
        }
      }
    }
    p.textNearestBelowY = nearestBelowY;
    const availableGap = Math.max(0, nearestBelowY - p.bottom);
    const extraAllowance = Math.min(availableGap * 0.72, Math.max(4, p.fontSize * 0.85));
    p.maxAllowedHeight = p.h + 3 + extraAllowance;
  }

  return ordered;
}

// ============================================================
// Canvas Perimeter Pixel Sampling (Native Background Matching)
// ============================================================
function computeLuminance(r, g, b) {
  const srgb = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(lumA, lumB) {
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function medianValue(arr) {
  if (!arr.length) return 255;
  const sorted = arr.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function sampleParagraphColors(pageImageData, para, cssWidth, cssHeight, canvasWidth, canvasHeight) {
  if (!pageImageData || !pageImageData.data) {
    return { bg: '#ffffff', fg: '#111827', isDarkBg: false, bgRgb: [255, 255, 255] };
  }
  const data = pageImageData.data;
  const scaleX = canvasWidth / Math.max(1, cssWidth);
  const scaleY = canvasHeight / Math.max(1, cssHeight);

  const clampX = (px) => Math.max(0, Math.min(canvasWidth - 1, Math.round(px)));
  const clampY = (py) => Math.max(0, Math.min(canvasHeight - 1, Math.round(py)));

  const leftPx = para.x * scaleX;
  const rightPx = para.right * scaleX;
  const topPx = para.y * scaleY;
  const bottomPx = para.bottom * scaleY;
  const pad = Math.max(2, Math.round(2.5 * scaleX));

  const points = [];
  const horizSteps = 8;
  for (let i = 0; i <= horizSteps; i++) {
    const t = i / horizSteps;
    const px = leftPx + (rightPx - leftPx) * t;
    points.push([clampX(px), clampY(topPx - pad)]);
    points.push([clampX(px), clampY(bottomPx + pad)]);
  }
  const vertSteps = 5;
  for (let i = 1; i < vertSteps; i++) {
    const t = i / vertSteps;
    const py = topPx + (bottomPx - topPx) * t;
    points.push([clampX(leftPx - pad), clampY(py)]);
    points.push([clampX(rightPx + pad), clampY(py)]);
  }

  const rs = [];
  const gs = [];
  const bs = [];

  for (const [px, py] of points) {
    const offset = (py * canvasWidth + px) * 4;
    if (data[offset + 3] < 20) continue;
    rs.push(data[offset]);
    gs.push(data[offset + 1]);
    bs.push(data[offset + 2]);
  }

  if (rs.length === 0) {
    return { bg: '#ffffff', fg: '#111827', isDarkBg: false, bgRgb: [255, 255, 255] };
  }

  const r = medianValue(rs);
  const g = medianValue(gs);
  const b = medianValue(bs);
  const bgLum = computeLuminance(r, g, b);

  const lightInkLum = computeLuminance(248, 250, 252); // #f8fafc
  const darkInkLum = computeLuminance(17, 24, 39); // #111827

  const isDarkBg = contrastRatio(bgLum, lightInkLum) > contrastRatio(bgLum, darkInkLum);
  const fg = isDarkBg ? '#f8fafc' : '#111827';
  const bg = `rgb(${r}, ${g}, ${b})`;

  return { bg, fg, isDarkBg, bgRgb: [r, g, b] };
}

function refineMaxHeightWithCanvasInk(pageImageData, ordered, cssWidth, cssHeight, canvasWidth, canvasHeight) {
  if (!pageImageData || !pageImageData.data || !ordered || ordered.length === 0) return;
  const data = pageImageData.data;
  const scaleX = canvasWidth / Math.max(1, cssWidth);
  const scaleY = canvasHeight / Math.max(1, cssHeight);
  const xStepPx = Math.max(1, Math.round(2 * scaleX));

  for (const para of ordered) {
    const [bgR, bgG, bgB] = para.colors?.bgRgb || [255, 255, 255];

    // 1. Scan downward below para.bottom for raster/vector ink, rules, or tinted diagram boxes
    const scanTopCss = para.bottom + Math.max(2.0, para.fontSize * 0.14);
    const textCeiling = Number.isFinite(para.textNearestBelowY) ? para.textNearestBelowY : (cssHeight - 6);
    const scanBottomCss = Math.min(textCeiling, para.bottom + Math.max(18, para.fontSize * 1.35));

    if (scanBottomCss > scanTopCss + 1) {
      const insetX = para.w > 24 ? 2 : 0;
      const xStartPx = Math.max(0, Math.min(canvasWidth - 1, Math.round((para.x + insetX) * scaleX)));
      const xEndPx = Math.max(xStartPx, Math.min(canvasWidth - 1, Math.round((para.right - insetX) * scaleX)));
      const yStartPx = Math.max(0, Math.min(canvasHeight - 1, Math.ceil(scanTopCss * scaleY)));
      const yEndPx = Math.max(yStartPx, Math.min(canvasHeight - 1, Math.floor(scanBottomCss * scaleY)));

      const samplesPerRow = Math.max(1, Math.floor((xEndPx - xStartPx) / xStepPx) + 1);
      const strongThreshold = Math.max(2, Math.ceil(samplesPerRow * 0.03));
      const tintThreshold = Math.max(2, Math.ceil(samplesPerRow * 0.25));

      let obstacleCssY = null;
      for (let py = yStartPx; py <= yEndPx; py++) {
        let strongHits = 0;
        let tintHits = 0;
        for (let px = xStartPx; px <= xEndPx; px += xStepPx) {
          const offset = (py * canvasWidth + px) * 4;
          if (data[offset + 3] < 20) continue;
          const dr = Math.abs(data[offset] - bgR);
          const dg = Math.abs(data[offset + 1] - bgG);
          const db = Math.abs(data[offset + 2] - bgB);
          const maxDiff = Math.max(dr, dg, db);
          const dist = dr + dg + db;
          if (maxDiff >= 40 || dist >= 75) {
            strongHits += 1;
            if (strongHits >= strongThreshold) break;
          } else if (maxDiff >= 24 || dist >= 48) {
            tintHits += 1;
          }
        }
        if (strongHits >= strongThreshold || tintHits >= tintThreshold) {
          obstacleCssY = py / scaleY;
          break;
        }
      }

      if (obstacleCssY !== null) {
        const nearestBelowY = Math.min(textCeiling, obstacleCssY - 1.5);
        const availableGap = Math.max(0, nearestBelowY - para.bottom);
        const extraAllowance = availableGap <= 1 ? 0 : Math.min(availableGap * 0.72, Math.max(2, para.fontSize * 0.85));
        const basePad = para.lineCount === 1 ? 1 : 3;
        para.maxAllowedHeight = Math.min(para.maxAllowedHeight, para.h + basePad + extraAllowance);
      }
    }

    // 2. Detect compact diagram / box labels surrounded by nearby vector borders on >= 2 edges
    para.isCompactLabel = false;
    if (para.lineCount === 1 && para.w < cssWidth * 0.32 && para.text.length <= 64) {
      const checkEdge = (pts) => {
        let hits = 0;
        for (const [cx, cy] of pts) {
          const px = Math.max(0, Math.min(canvasWidth - 1, Math.round(cx)));
          const py = Math.max(0, Math.min(canvasHeight - 1, Math.round(cy)));
          const offset = (py * canvasWidth + px) * 4;
          if (data[offset + 3] < 20) continue;
          const dr = Math.abs(data[offset] - bgR);
          const dg = Math.abs(data[offset + 1] - bgG);
          const db = Math.abs(data[offset + 2] - bgB);
          if (Math.max(dr, dg, db) >= 40 || (dr + dg + db) >= 75) {
            hits += 1;
            if (hits >= 2) return true;
          }
        }
        return false;
      };

      const lPx = para.x * scaleX;
      const rPx = para.right * scaleX;
      const tPx = para.y * scaleY;
      const bPx = para.bottom * scaleY;
      const d2 = 2.5 * scaleX;
      const d4 = 4.0 * scaleX;
      const dy2 = 2.5 * scaleY;
      const dy4 = 4.0 * scaleY;

      let borderedEdges = 0;
      const hPtsTop = [];
      const hPtsBot = [];
      for (let k = 0; k <= 4; k++) {
        const px = lPx + ((rPx - lPx) * k) / 4;
        hPtsTop.push([px, tPx - dy2], [px, tPx - dy4]);
        hPtsBot.push([px, bPx + dy2], [px, bPx + dy4]);
      }
      if (checkEdge(hPtsTop)) borderedEdges += 1;
      if (checkEdge(hPtsBot)) borderedEdges += 1;

      const vPtsLeft = [];
      const vPtsRight = [];
      for (let k = 0; k <= 3; k++) {
        const py = tPx + ((bPx - tPx) * k) / 3;
        vPtsLeft.push([lPx - d2, py], [lPx - d4, py]);
        vPtsRight.push([rPx + d2, py], [rPx + d4, py]);
      }
      if (checkEdge(vPtsLeft)) borderedEdges += 1;
      if (checkEdge(vPtsRight)) borderedEdges += 1;

      if (borderedEdges >= 2) {
        para.isCompactLabel = true;
      }
    }
  }
}

// ============================================================
// Overlay & Split View Rendering
// ============================================================
function fitOverlayTypography(el, para, maxHeight, boxWidth) {
  const startScale = para.isHeading ? 0.96 : 0.94;
  const minFs = Math.max(8.5, para.fontSize * 0.60);
  let fs = Math.max(minFs, para.fontSize * startScale);
  const minLh = para.lineCount === 1 ? 1.10 : 1.14;
  let lh = para.lineCount === 1 ? 1.15 : Math.max(1.20, Math.min(1.46, para.avgLineHeightRatio));

  el.style.fontSize = `${fs.toFixed(2)}px`;
  el.style.lineHeight = lh.toFixed(2);
  el.style.maxHeight = '';
  el.classList.remove('is-clipped');

  const fits = () => el.scrollHeight <= maxHeight + 1 && el.scrollWidth <= boxWidth + 2;

  let guard = 0;
  while (!fits() && fs > minFs + 0.15 && guard < 18) {
    fs = Math.max(minFs, fs * 0.92);
    if (lh > minLh) {
      lh = Math.max(minLh, lh - 0.03);
    }
    el.style.fontSize = `${fs.toFixed(2)}px`;
    el.style.lineHeight = lh.toFixed(2);
    guard += 1;
  }

  if (el.scrollHeight > maxHeight + 2) {
    el.style.maxHeight = `${Math.ceil(maxHeight)}px`;
    el.classList.add('is-clipped');
  }
}

function renderParagraphOverlay(pageRec, para, zh) {
  if (!pageRec.overlayLayer || !pageRec.viewport) return;

  const langInfo = resolveTargetLanguage(state.settings);
  const cleanedZh = cleanLatexMathInText(zh);
  const box = computeOverlayBox(para, pageRec.viewport);

  let el = pageRec.overlayById.get(para.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'nr-pdf-para';
    el.dataset.paraId = String(para.id);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleComparePopover(el, para, state.translations.get(para.key) || cleanedZh);
    });
    pageRec.overlayLayer.appendChild(el);
    pageRec.overlayById.set(para.id, el);
  }

  const colors = para.colors || { bg: '#ffffff', fg: '#111827', isDarkBg: false };
  el.textContent = cleanedZh;
  el.style.left = `${box.left.toFixed(1)}px`;
  el.style.top = `${box.top.toFixed(1)}px`;
  el.style.width = `${box.width.toFixed(1)}px`;
  el.style.minHeight = `${box.minHeight.toFixed(1)}px`;
  el.style.backgroundColor = colors.bg;
  el.style.color = colors.fg;
  el.style.fontFamily = para.isSerif ? langInfo.serifFontStack : langInfo.sansFontStack;
  el.style.fontWeight = (para.isBold || para.isHeading) ? '700' : '400';
  el.style.textAlign = (para.lineCount === 1 && para.isCentered && (para.isHeading || para.isBold)) ? 'center' : '';
  el.classList.toggle('is-dark-bg', Boolean(colors.isDarkBg));
  el.classList.toggle('is-compact-label', Boolean(para.isCompactLabel));

  if (state.mode !== 'overlay') {
    pageRec.needsOverlayRefit = true;
  } else {
    fitOverlayTypography(el, para, box.maxHeight, box.width);
  }
}

function buildSplitCardSkeleton(pageRec) {
  const body = pageRec.splitBody;
  if (!body) return;
  body.replaceChildren();
  pageRec.splitElById.clear();

  const langInfo = resolveTargetLanguage(state.settings);

  if (pageRec.translatableParagraphs.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'nr-split-empty';
    empty.textContent = '此頁無可翻譯正文段落（可能為圖表、純掃描影像或目標語言內容）。';
    body.appendChild(empty);
    pageRec.splitStatusEl.textContent = '無需翻譯';
    return;
  }

  for (const para of pageRec.translatableParagraphs) {
    const pEl = document.createElement(para.isHeading ? 'h3' : 'p');
    pEl.className = 'nr-split-para is-pending';
    if (para.isHeading) pEl.classList.add('is-heading');
    else if (para.isBold) pEl.classList.add('is-bold');
    pEl.style.fontFamily = para.isSerif ? langInfo.serifFontStack : langInfo.sansFontStack;
    pEl.textContent = para.text;
    pEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const translated = state.translations.get(para.key);
      if (translated) {
        toggleComparePopover(pEl, para, translated);
      }
    });
    body.appendChild(pEl);
    pageRec.splitElById.set(para.id, pEl);
  }

  pageRec.splitStatusEl.textContent = `待翻譯 0 / ${pageRec.translatableParagraphs.length}`;
}

function updateSplitParagraph(pageRec, para, zh) {
  const pEl = pageRec.splitElById.get(para.id);
  if (!pEl) return;
  const langInfo = resolveTargetLanguage(state.settings);
  pEl.textContent = cleanLatexMathInText(zh);
  pEl.classList.remove('is-pending');
  if (!para.isHeading) {
    pEl.classList.toggle('is-bold', Boolean(para.isBold));
  }
  pEl.style.fontFamily = para.isSerif ? langInfo.serifFontStack : langInfo.sansFontStack;

  const doneCount = pageRec.translatableParagraphs.reduce(
    (acc, item) => acc + (state.translations.has(item.key) ? 1 : 0),
    0
  );
  const total = pageRec.translatableParagraphs.length;
  pageRec.splitStatusEl.textContent = doneCount >= total
    ? `已完成 ${total} 段`
    : `翻譯中 ${doneCount} / ${total}`;
}

function applyTranslationToPage(pageRec, key, zh) {
  const matched = pageRec.paragraphsByKey.get(key);
  if (!matched || matched.length === 0) return;

  for (const para of matched) {
    renderParagraphOverlay(pageRec, para, zh);
    updateSplitParagraph(pageRec, para, zh);
  }
}

// ============================================================
// Inline Original-English Compare Popover
// ============================================================
function closeComparePopover() {
  dom.comparePopover.hidden = true;
  if (state.activeCompareAnchor) {
    state.activeCompareAnchor.classList.remove('is-active-compare');
    state.activeCompareAnchor = null;
  }
  state.activeComparePara = null;
}

function toggleComparePopover(anchorEl, para, translatedText) {
  if (state.activeCompareAnchor === anchorEl && !dom.comparePopover.hidden) {
    closeComparePopover();
    return;
  }

  const cleanedZh = cleanLatexMathInText(translatedText);

  if (state.activeCompareAnchor) {
    state.activeCompareAnchor.classList.remove('is-active-compare');
  }
  state.activeCompareAnchor = anchorEl;
  state.activeComparePara = { orig: para.text, trans: cleanedZh };
  anchorEl.classList.add('is-active-compare');

  const langInfo = resolveTargetLanguage(state.settings);
  dom.compareOrigText.textContent = para.text;
  dom.compareTransText.textContent = cleanedZh;
  dom.compareTransText.style.fontFamily = para.isSerif ? langInfo.serifFontStack : langInfo.sansFontStack;

  dom.comparePopover.hidden = false;

  // Position safely within viewport bounds near the clicked paragraph
  const anchorRect = anchorEl.getBoundingClientRect();
  const popRect = dom.comparePopover.getBoundingClientRect();
  const margin = 12;
  const toolbarBottom = Math.ceil((document.getElementById('toolbar')?.getBoundingClientRect().bottom || 52) + 8);

  let left = anchorRect.left;
  if (left + popRect.width > window.innerWidth - margin) {
    left = window.innerWidth - popRect.width - margin;
  }
  left = Math.max(margin, left);

  let top = anchorRect.bottom + 8;
  if (top + popRect.height > window.innerHeight - margin) {
    const aboveTop = anchorRect.top - popRect.height - 8;
    if (aboveTop >= toolbarBottom) {
      top = aboveTop;
    } else {
      top = Math.max(toolbarBottom, window.innerHeight - popRect.height - margin);
    }
  }

  dom.comparePopover.style.left = `${Math.round(left)}px`;
  dom.comparePopover.style.top = `${Math.round(top)}px`;
}

// ============================================================
// SSE Streaming Port ('kct-stream') + TRANSLATE_BATCH Fallback
// ============================================================
function cancelAllActiveStreams() {
  for (const [requestId, req] of state.activeStreamRequests.entries()) {
    if (req.timer) clearTimeout(req.timer);
    if (state.streamPort) {
      try {
        state.streamPort.postMessage({ type: 'CANCEL_STREAM', requestId });
      } catch (_) {}
    }
    req.resolve({ cancelled: true });
  }
  state.activeStreamRequests.clear();
}

function handleStreamMessage(msg) {
  if (!msg || typeof msg !== 'object' || !msg.requestId) return;
  const req = state.activeStreamRequests.get(msg.requestId);
  if (!req) return;

  if (req.timer) {
    clearTimeout(req.timer);
    req.timer = setTimeout(() => {
      state.activeStreamRequests.delete(msg.requestId);
      if (state.streamPort) {
        try {
          state.streamPort.postMessage({ type: 'CANCEL_STREAM', requestId: msg.requestId });
        } catch (_) {}
      }
      req.reject({ portFallback: true, error: '串流回應逾時' });
    }, 60000);
  }

  if (msg.type === 'ITEM') {
    if (req.epoch !== state.translationEpoch) return;
    if (msg.key && typeof msg.zh === 'string' && msg.zh.trim()) {
      req.receivedKeys.add(msg.key);
      req.onItem(msg.key, msg.zh.trim(), Boolean(msg.cached));
    }
    return;
  }

  if (msg.type === 'DONE') {
    if (req.timer) clearTimeout(req.timer);
    state.activeStreamRequests.delete(msg.requestId);
    req.resolve({ ok: true, translatedCount: msg.translatedCount || 0 });
    return;
  }

  if (msg.type === 'ERROR') {
    if (req.timer) clearTimeout(req.timer);
    state.activeStreamRequests.delete(msg.requestId);
    req.reject({
      error: msg.error || '串流翻譯失敗',
      errorCode: msg.errorCode || ''
    });
  }
}

function ensureStreamPort() {
  if (state.streamPort) return state.streamPort;
  const port = chrome.runtime.connect({ name: 'kct-stream' });
  port.onMessage.addListener(handleStreamMessage);
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (state.streamPort === port) {
      state.streamPort = null;
    }
    for (const [reqId, req] of state.activeStreamRequests.entries()) {
      if (req.timer) clearTimeout(req.timer);
      state.activeStreamRequests.delete(reqId);
      req.reject({ portFallback: true, error: '串流連線中斷' });
    }
  });
  state.streamPort = port;
  return port;
}

function sendBatchViaStreamPort(uniqueItems, pageContext, epoch, receivedKeys, onItem) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = ensureStreamPort();
    } catch (err) {
      reject({ portFallback: true, error: err?.message || '無法建立串流連線' });
      return;
    }

    const requestId = `pdf_${Date.now()}_${++state.streamReqSeq}`;
    const req = {
      epoch,
      receivedKeys,
      onItem,
      resolve,
      reject,
      timer: setTimeout(() => {
        state.activeStreamRequests.delete(requestId);
        if (state.streamPort) {
          try {
            state.streamPort.postMessage({ type: 'CANCEL_STREAM', requestId });
          } catch (_) {}
        }
        reject({ portFallback: true, error: '串流連線逾時' });
      }, 60000)
    };
    state.activeStreamRequests.set(requestId, req);

    try {
      port.postMessage({
        type: 'TRANSLATE_STREAM',
        requestId,
        items: uniqueItems,
        pageContext
      });
    } catch (err) {
      if (req.timer) clearTimeout(req.timer);
      state.activeStreamRequests.delete(requestId);
      state.streamPort = null;
      reject({ portFallback: true, error: err?.message || '傳送串流訊息失敗' });
    }
  });
}

async function sendBatchViaFallback(uniqueItems, pageContext, epoch, onItem) {
  const response = await chrome.runtime.sendMessage({
    type: 'TRANSLATE_BATCH',
    items: uniqueItems,
    pageContext
  });
  if (epoch !== state.translationEpoch) return;
  if (!response?.ok) {
    const err = new Error(response?.error || '批次翻譯失敗');
    err.errorCode = response?.errorCode || '';
    throw err;
  }
  const results = response.results || {};
  for (const item of uniqueItems) {
    const hit = results[item.key];
    if (hit && typeof hit.zh === 'string' && hit.zh.trim()) {
      onItem(item.key, hit.zh.trim(), Boolean(hit.cached));
    }
  }
}

function buildPageBatches(items) {
  const maxCount = Math.max(1, Number(state.settings?.batchSize || 20));
  const maxChars = Math.max(800, Number(state.settings?.maxBatchChars || 5500));
  const batches = [];
  let current = [];
  let chars = 0;

  for (const item of items) {
    if (current.length >= maxCount || (current.length > 0 && chars + item.text.length > maxChars)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += item.text.length;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

async function translatePageParagraphs(pageRec, epoch) {
  if (epoch !== state.translationEpoch) return;
  if (pageRec.translationInFlight || pageRec.translatedEpoch === epoch) return;

  const targetLangId = state.settings?.targetLang || 'zh-TW';
  const viewportWidth = pageRec.viewport?.width || 800;

  // Filter paragraphs for current target language
  const translatable = pageRec.allParagraphs.filter((para) =>
    shouldTranslatePdfText(para.text, targetLangId, {
      isHeading: para.isHeading,
      isMono: para.isMono,
      lineCount: para.lineCount,
      widthRatio: para.w / Math.max(1, viewportWidth),
      mathFontRatio: para.mathFontRatio,
      isCentered: para.isCentered,
      endsWithEqNum: para.endsWithEqNum
    })
  );

  pageRec.translatableParagraphs = translatable;
  pageRec.paragraphsByKey.clear();
  for (const para of translatable) {
    if (!pageRec.paragraphsByKey.has(para.key)) {
      pageRec.paragraphsByKey.set(para.key, []);
    }
    pageRec.paragraphsByKey.get(para.key).push(para);
  }

  buildSplitCardSkeleton(pageRec);

  if (translatable.length === 0) {
    pageRec.translatedEpoch = epoch;
    updateStatusBadge();
    return;
  }

  updateStatusBadge();

  // Immediately paint any paragraphs already in memory from another page or zoom
  const uncachedByKey = new Map();
  for (const para of translatable) {
    const existing = state.translations.get(para.key);
    if (existing) {
      applyTranslationToPage(pageRec, para.key, existing);
    } else if (!uncachedByKey.has(para.key)) {
      const protectedRes = protectInlineMath(para.text);
      para.mathPlaceholders = protectedRes.placeholders;
      uncachedByKey.set(para.key, {
        key: para.key,
        text: protectedRes.text,
        kind: 'block'
      });
    } else {
      const protectedRes = protectInlineMath(para.text);
      para.mathPlaceholders = protectedRes.placeholders;
    }
  }

  const toRequest = Array.from(uncachedByKey.values());
  if (toRequest.length === 0) {
    pageRec.translatedEpoch = epoch;
    updateStatusBadge();
    return;
  }

  const runSeq = (pageRec.translationRunSeq || 0) + 1;
  pageRec.translationRunSeq = runSeq;
  pageRec.translationInFlight = true;
  state.lastError = '';
  state.lastErrorCode = '';
  updateStatusBadge();

  const batches = buildPageBatches(toRequest);
  const pageContext = getPageContext();
  const useStream = state.settings?.streamTranslation !== false;

  const onItemArrived = (key, zh, cached) => {
    if (epoch !== state.translationEpoch) return;
    let samplePara = pageRec.paragraphsByKey.get(key)?.[0] || null;
    if (!samplePara) {
      for (const otherPage of state.pages.values()) {
        const hit = otherPage.paragraphsByKey.get(key)?.[0];
        if (hit) {
          samplePara = hit;
          break;
        }
      }
    }
    const restored = restoreMathPlaceholders(zh, samplePara?.mathPlaceholders);
    const cleanZh = cleanLatexMathInText(restored);
    state.translations.set(key, cleanZh);
    if (cached) state.cachedKeys.add(key);
    applyTranslationToPage(pageRec, key, cleanZh);
    // Also propagate to any other already-rendered page sharing the exact same header/paragraph key
    for (const otherPage of state.pages.values()) {
      if (otherPage !== pageRec && otherPage.paragraphsByKey.has(key)) {
        applyTranslationToPage(otherPage, key, cleanZh);
      }
    }
    updateStatusBadge();
  };

  let allSucceeded = true;

  try {
    for (const batch of batches) {
      if (epoch !== state.translationEpoch) return;
      const receivedKeys = new Set();

      if (useStream) {
        let needFallback = false;
        try {
          const res = await sendBatchViaStreamPort(batch, pageContext, epoch, receivedKeys, onItemArrived);
          if (res?.cancelled || epoch !== state.translationEpoch) return;
        } catch (err) {
          if (epoch !== state.translationEpoch) return;
          if (err?.portFallback) {
            needFallback = true;
          } else {
            state.lastError = err?.error || err?.message || '串流翻譯失敗';
            state.lastErrorCode = err?.errorCode || '';
            allSucceeded = false;
            if (state.lastErrorCode === 'NO_API_KEY') break;
          }
        }

        if (needFallback && epoch === state.translationEpoch) {
          const remaining = batch.filter((it) => !receivedKeys.has(it.key));
          if (remaining.length > 0) {
            try {
              await sendBatchViaFallback(remaining, pageContext, epoch, onItemArrived);
            } catch (fbErr) {
              state.lastError = fbErr?.message || '翻譯請求失敗';
              state.lastErrorCode = fbErr?.errorCode || '';
              allSucceeded = false;
              if (state.lastErrorCode === 'NO_API_KEY') break;
            }
          }
        }
      } else {
        try {
          await sendBatchViaFallback(batch, pageContext, epoch, onItemArrived);
        } catch (err) {
          state.lastError = err?.message || '翻譯請求失敗';
          state.lastErrorCode = err?.errorCode || '';
          allSucceeded = false;
          if (state.lastErrorCode === 'NO_API_KEY') break;
        }
      }
    }

    if (allSucceeded && epoch === state.translationEpoch) {
      pageRec.translatedEpoch = epoch;
    }
  } finally {
    if (pageRec.translationRunSeq === runSeq) {
      pageRec.translationInFlight = false;
    }
    updateStatusBadge();
  }
}

// ============================================================
// Per-Page Lazy Canvas Rendering & Geometry Extraction
// ============================================================
function cancelPageRender(pageRec) {
  if (!pageRec) return;
  pageRec.renderSeq = (pageRec.renderSeq || 0) + 1;
  if (pageRec.renderTask) {
    const task = pageRec.renderTask;
    pageRec.renderTask = null;
    try {
      task.cancel();
    } catch (_) {}
  }
}

async function renderAndTranslatePage(pageNum, { forceCanvas = false } = {}) {
  const pageRec = state.pages.get(pageNum);
  const pdfDoc = state.pdfDoc;
  if (!pageRec || !pdfDoc) return;

  const loadToken = state.docLoadToken;
  let targetScale = (pageRec.baseFitScale || state.baseFitScale) * state.zoom;

  const needsCanvas = forceCanvas || !pageRec.rendered || Math.abs(pageRec.renderedScale - targetScale) > 0.005;

  if (needsCanvas) {
    const renderSeq = (pageRec.renderSeq || 0) + 1;
    pageRec.renderSeq = renderSeq;

    if (pageRec.renderTask) {
      const prevTask = pageRec.renderTask;
      pageRec.renderTask = null;
      try {
        prevTask.cancel();
        await prevTask.promise.catch(() => {});
      } catch (_) {}
      if (renderSeq !== pageRec.renderSeq || loadToken !== state.docLoadToken) return;
    }

    let activeRenderTask = null;
    try {
      const pdfPage = await pdfDoc.getPage(pageNum);
      if (renderSeq !== pageRec.renderSeq || loadToken !== state.docLoadToken) return;

      // Guard again right before touching canvas in case another renderTask started during getPage()
      if (pageRec.renderTask) {
        const prevTask = pageRec.renderTask;
        pageRec.renderTask = null;
        try {
          prevTask.cancel();
          await prevTask.promise.catch(() => {});
        } catch (_) {}
        if (renderSeq !== pageRec.renderSeq || loadToken !== state.docLoadToken) return;
      }

      const baseVp = pdfPage.getViewport({ scale: 1.0 });
      pageRec.baseWidth = baseVp.width;
      pageRec.baseHeight = baseVp.height;
      pageRec.baseFitScale = computePageBaseFitScale(baseVp.width, state.mode);
      targetScale = pageRec.baseFitScale * state.zoom;

      const viewport = pdfPage.getViewport({ scale: targetScale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

      pageRec.sheetEl.style.width = `${viewport.width}px`;
      pageRec.sheetEl.style.height = `${viewport.height}px`;

      const canvas = pageRec.canvasEl;
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      activeRenderTask = pdfPage.render({
        canvasContext: ctx,
        viewport
      });
      pageRec.renderTask = activeRenderTask;

      await activeRenderTask.promise;
      if (renderSeq !== pageRec.renderSeq || loadToken !== state.docLoadToken) return;
      pageRec.renderTask = null;
      pageRec.rendered = true;
      pageRec.renderedScale = targetScale;
      pageRec.viewport = viewport;
      pageRec.loaderEl.hidden = true;

      // Capture page canvas pixels ONCE per page instead of 1000+ per-pixel getImageData readbacks
      let pageImageData = null;
      try {
        pageImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch (_) {}

      // Extract (or re-extract at new scale) text geometry & sample perimeter background pixels
      const textContent = await pdfPage.getTextContent();
      if (renderSeq !== pageRec.renderSeq || loadToken !== state.docLoadToken) return;

      const paragraphs = extractPdfParagraphs(textContent, viewport, pdfPage.commonObjs);
      for (let i = 0; i < paragraphs.length; i++) {
        paragraphs[i].id = `p${pageNum}_${i}`;
        paragraphs[i].colors = sampleParagraphColors(
          pageImageData,
          paragraphs[i],
          viewport.width,
          viewport.height,
          canvas.width,
          canvas.height
        );
      }
      refineMaxHeightWithCanvasInk(
        pageImageData,
        paragraphs,
        viewport.width,
        viewport.height,
        canvas.width,
        canvas.height
      );

      pageRec.allParagraphs = paragraphs;
      pageRec.overlayLayer.replaceChildren();
      pageRec.overlayById.clear();

      // If this page already started or finished translating for the current epoch (e.g. zoom re-render),
      // rebuild key index with new-scale paragraphs and repaint any existing translations immediately.
      if (pageRec.translatedEpoch === state.translationEpoch || pageRec.translationInFlight) {
        const targetLangId = state.settings?.targetLang || 'zh-TW';
        pageRec.translatableParagraphs = paragraphs.filter((para) =>
          shouldTranslatePdfText(para.text, targetLangId, {
            isHeading: para.isHeading,
            isMono: para.isMono,
            lineCount: para.lineCount,
            widthRatio: para.w / Math.max(1, viewport.width),
            mathFontRatio: para.mathFontRatio,
            isCentered: para.isCentered,
            endsWithEqNum: para.endsWithEqNum
          })
        );
        pageRec.paragraphsByKey.clear();
        for (const para of pageRec.translatableParagraphs) {
          if (!pageRec.paragraphsByKey.has(para.key)) {
            pageRec.paragraphsByKey.set(para.key, []);
          }
          pageRec.paragraphsByKey.get(para.key).push(para);
          const zh = state.translations.get(para.key);
          if (zh) {
            renderParagraphOverlay(pageRec, para, zh);
          }
        }
        return;
      }
    } catch (err) {
      if (err?.name === 'RenderingCancelledException' || renderSeq !== pageRec.renderSeq || loadToken !== state.docLoadToken) {
        return;
      }
      console.warn(`[NativeRead PDF] Render page ${pageNum} error:`, err);
      return;
    } finally {
      if (activeRenderTask && pageRec.renderTask === activeRenderTask) {
        pageRec.renderTask = null;
      }
    }
  }

  // Trigger lazy streaming translation for this page
  await translatePageParagraphs(pageRec, state.translationEpoch);
}

// ============================================================
// Document Shell Creation & Observers
// ============================================================
function disconnectObservers() {
  if (state.renderObserver) {
    state.renderObserver.disconnect();
    state.renderObserver = null;
  }
  if (state.pageTrackRaf) {
    cancelAnimationFrame(state.pageTrackRaf);
    state.pageTrackRaf = 0;
  }
}

function buildPageShells(numPages, defaultWidth, defaultHeight) {
  dom.pagesContainer.replaceChildren();
  state.pages.clear();

  const cssW = Math.round(defaultWidth * state.baseFitScale * state.zoom);
  const cssH = Math.round(defaultHeight * state.baseFitScale * state.zoom);

  const frag = document.createDocumentFragment();

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const row = document.createElement('section');
    row.className = 'nr-page-row';
    row.dataset.pageNum = String(pageNum);

    // Left column: Canvas + Overlay
    const canvasCol = document.createElement('div');
    canvasCol.className = 'nr-page-canvas-col';

    const sheet = document.createElement('div');
    sheet.className = 'nr-page-sheet';
    sheet.style.width = `${cssW}px`;
    sheet.style.height = `${cssH}px`;

    const canvas = document.createElement('canvas');
    canvas.className = 'nr-pdf-canvas';

    const overlayLayer = document.createElement('div');
    overlayLayer.className = 'nr-overlay-layer';

    const loader = document.createElement('div');
    loader.className = 'nr-page-loader';
    loader.textContent = `第 ${pageNum} 頁載入中...`;

    const badge = document.createElement('div');
    badge.className = 'nr-page-num-badge';
    badge.textContent = `P. ${pageNum}`;

    sheet.append(canvas, overlayLayer, loader, badge);
    canvasCol.appendChild(sheet);

    // Right column: Split-view translated card
    const splitCol = document.createElement('div');
    splitCol.className = 'nr-page-split-col';

    const splitCard = document.createElement('article');
    splitCard.className = 'nr-split-card';

    const splitHeader = document.createElement('div');
    splitHeader.className = 'nr-split-card-header';

    const splitTitle = document.createElement('span');
    splitTitle.textContent = `第 ${pageNum} 頁 · 譯文`;

    const splitStatus = document.createElement('span');
    splitStatus.className = 'nr-split-page-status';
    splitStatus.textContent = '等待捲動至此頁...';

    splitHeader.append(splitTitle, splitStatus);

    const splitBody = document.createElement('div');
    splitBody.className = 'nr-split-card-body';

    splitCard.append(splitHeader, splitBody);
    splitCol.appendChild(splitCard);

    row.append(canvasCol, splitCol);
    frag.appendChild(row);

    state.pages.set(pageNum, {
      pageNum,
      rowEl: row,
      sheetEl: sheet,
      canvasEl: canvas,
      overlayLayer,
      loaderEl: loader,
      splitBody,
      splitStatusEl: splitStatus,
      baseWidth: defaultWidth,
      baseHeight: defaultHeight,
      baseFitScale: state.baseFitScale,
      rendered: false,
      renderedScale: 0,
      renderTask: null,
      viewport: null,
      allParagraphs: [],
      translatableParagraphs: [],
      paragraphsByKey: new Map(),
      overlayById: new Map(),
      splitElById: new Map(),
      translatedEpoch: -1,
      translationInFlight: false,
      isVisible: false
    });
  }

  dom.pagesContainer.appendChild(frag);
}

function setupObservers() {
  disconnectObservers();

  state.renderObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const pageNum = Number(entry.target.dataset.pageNum);
        const pageRec = state.pages.get(pageNum);
        if (!pageRec) continue;
        pageRec.isVisible = entry.isIntersecting;
        if (entry.isIntersecting) {
          renderAndTranslatePage(pageNum);
        } else if (!pageRec.rendered && pageRec.renderTask) {
          cancelPageRender(pageRec);
        }
      }
    },
    { rootMargin: '500px 0px', threshold: 0.01 }
  );

  for (const pageRec of state.pages.values()) {
    state.renderObserver.observe(pageRec.rowEl);
  }
  scheduleSyncCurrentPage();
}

// ============================================================
// PDF Loading (URL + Local File)
// ============================================================
function hasPdfMagicHeader(uint8) {
  const limit = Math.min(uint8.length, 1024);
  for (let i = 0; i <= limit - 5; i++) {
    if (
      uint8[i] === 0x25 && // %
      uint8[i + 1] === 0x50 && // P
      uint8[i + 2] === 0x44 && // D
      uint8[i + 3] === 0x46 && // F
      uint8[i + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

function deriveFilenameFromUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const gId = parsed.searchParams.get('id');
    if (gId && (parsed.hostname.includes('drive.google.com') || parsed.hostname.includes('docs.google.com'))) {
      return `GoogleDrive_${gId.slice(0, 8)}.pdf`;
    }
    const seg = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    return seg || parsed.hostname;
  } catch (_) {
    return 'PDF Document';
  }
}

async function openPdfFromArrayBuffer(arrayBuffer, { title, host, sourceUrl = '' }) {
  const loadToken = ++state.docLoadToken;
  state.translationEpoch += 1;
  cancelAllActiveStreams();
  disconnectObservers();
  closeComparePopover();

  for (const pageRec of state.pages.values()) {
    cancelPageRender(pageRec);
  }

  if (state.pdfDoc) {
    try {
      await state.pdfDoc.destroy();
    } catch (_) {}
    state.pdfDoc = null;
  }

  state.translations.clear();
  state.cachedKeys.clear();
  state.totalParagraphs = 0;
  state.translatedParagraphs = 0;
  state.lastError = '';
  state.lastErrorCode = '';
  state.docTitle = title || 'PDF Document';
  state.docHost = host || 'local-pdf';
  state.sourceUrl = sourceUrl;

  dom.docTitle.textContent = state.docTitle;
  dom.docTitle.title = state.docTitle;
  document.title = `${state.docTitle} · NativeRead PDF`;

  showStage('loading');
  dom.loadingTitle.textContent = '正在解析 PDF 文件...';
  dom.loadingSub.textContent = state.docTitle;

  try {
    const bytes = new Uint8Array(arrayBuffer);
    if (!hasPdfMagicHeader(bytes)) {
      throw new Error('所載入的內容並非有效的 PDF 檔案（可能需要登入權限）。');
    }

    const loadingTask = pdfjsLib.getDocument({ data: bytes, isEvalSupported: false });
    const pdfDoc = await loadingTask.promise;
    if (loadToken !== state.docLoadToken) {
      pdfDoc.destroy().catch(() => {});
      return;
    }

    state.pdfDoc = pdfDoc;
    state.numPages = pdfDoc.numPages;

    // Extract PDF metadata title if available
    try {
      const meta = await pdfDoc.getMetadata();
      const metaTitle = String(meta?.info?.Title || '').trim();
      if (metaTitle && metaTitle.length >= 3 && metaTitle.length <= 160) {
        state.docTitle = metaTitle;
        dom.docTitle.textContent = metaTitle;
        dom.docTitle.title = metaTitle;
        document.title = `${metaTitle} · NativeRead PDF`;
      }
    } catch (_) {}

    // Measure page 1 to compute comfortable 100% fit-width scale
    const firstPage = await pdfDoc.getPage(1);
    if (loadToken !== state.docLoadToken) return;

    const baseViewport = firstPage.getViewport({ scale: 1.0 });
    state.defaultPageWidth = baseViewport.width;
    state.defaultPageHeight = baseViewport.height;
    state.baseFitScale = computePageBaseFitScale(baseViewport.width, state.mode);
    state.zoom = 1.0;
    updateZoomUI();

    buildPageShells(pdfDoc.numPages, baseViewport.width, baseViewport.height);
    showStage('pages');
    updatePageIndicator(1);
    updateStatusBadge();
    setupObservers();
    window.scrollTo({ top: 0, behavior: 'instant' });
    syncCurrentPageFromViewport();
  } catch (err) {
    if (loadToken !== state.docLoadToken) return;
    console.error('[NativeRead PDF] Failed to open PDF:', err);
    showError(
      '無法解析此 PDF 文件',
      err?.message || 'PDF 檔案可能已損毀、受密碼保護，或需要網站登入權限。',
      Boolean(sourceUrl)
    );
  }
}

function showError(title, detail, canRetryUrl) {
  showStage('error');
  dom.errorTitle.textContent = title;
  dom.errorDetail.textContent = detail;
  dom.retryUrlBtn.hidden = !canRetryUrl;
  dom.pageIndicator.hidden = true;
  updateStatusBadge();
}

function abortActiveFetch() {
  if (state.activeFetchController) {
    try {
      state.activeFetchController.abort();
    } catch (_) {}
    state.activeFetchController = null;
  }
}

async function loadPdfFromUrl(rawUrl) {
  const normalizedUrl = typeof globalThis.KCTConfig?.resolvePdfSourceUrl === 'function'
    ? (globalThis.KCTConfig.resolvePdfSourceUrl(rawUrl) || rawUrl)
    : rawUrl;
  let parsed;
  try {
    parsed = new URL(normalizedUrl);
  } catch (_) {
    showError('PDF 連結格式無效', `無法辨識網址：${rawUrl}`, false);
    return;
  }

  const isFileUrl = parsed.protocol === 'file:';
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && !isFileUrl) {
    showError('不支援的連結協定', '僅支援 http(s):// 連結，或請改用「開啟本機 PDF 檔案」。', false);
    return;
  }

  abortActiveFetch();
  const loadToken = ++state.docLoadToken;
  const controller = new AbortController();
  state.activeFetchController = controller;
  const fetchTimer = setTimeout(() => controller.abort(), 45000);

  state.sourceUrl = parsed.toString();
  showStage('loading');
  dom.loadingTitle.textContent = isFileUrl ? '正在讀取本機 PDF...' : '正在下載 PDF 文件...';
  dom.loadingSub.textContent = parsed.toString();

  try {
    let response;
    try {
      response = await fetch(parsed.toString(), { credentials: 'include', signal: controller.signal });
    } catch (innerErr) {
      if (controller.signal.aborted) throw innerErr;
      response = await fetch(parsed.toString(), { credentials: 'omit', signal: controller.signal });
    }

    if (loadToken !== state.docLoadToken) return;
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());
    }
    const contentLen = Number(response.headers.get('Content-Length') || 0);
    if (contentLen > 100 * 1024 * 1024) {
      throw new Error('PDF 檔案超過 100 MB 上限，請下載後拆分再載入。');
    }

    const buffer = await response.arrayBuffer();
    if (loadToken !== state.docLoadToken) return;
    await openPdfFromArrayBuffer(buffer, {
      title: deriveFilenameFromUrl(parsed.toString()),
      host: isFileUrl ? 'local-pdf' : parsed.hostname,
      sourceUrl: isFileUrl ? '' : parsed.toString()
    });
  } catch (err) {
    if (loadToken !== state.docLoadToken) return;
    if (isFileUrl) {
      const fileName = deriveFilenameFromUrl(parsed.toString());
      showError(
        '請直接選擇本機 PDF 檔案',
        `無法直接讀取本機路徑（${fileName}）。請點擊下方「開啟本機 PDF 檔案」、拖曳檔案至此視窗，或於擴充功能設定啟用「允許存取檔案網址」。`,
        false
      );
      return;
    }
    showError(
      '無法從網址載入 PDF',
      `${err?.message || '網路或存取限制'}。若為需要登入的私密文件，請先下載後點選下方「開啟本機 PDF 檔案」。`,
      true
    );
  } finally {
    clearTimeout(fetchTimer);
    if (state.activeFetchController === controller) {
      state.activeFetchController = null;
    }
  }
}

async function loadPdfFromFile(file) {
  if (!file) return;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    showError('不支援的檔案格式', `「${file.name}」不是 PDF 檔案，請選擇 .pdf 文件。`, false);
    return;
  }

  abortActiveFetch();
  const loadToken = ++state.docLoadToken;
  showStage('loading');
  dom.loadingTitle.textContent = '正在讀取本機 PDF...';
  dom.loadingSub.textContent = file.name;

  try {
    const buffer = await file.arrayBuffer();
    if (loadToken !== state.docLoadToken) return;
    await openPdfFromArrayBuffer(buffer, {
      title: file.name.replace(/\.pdf$/i, ''),
      host: 'local-pdf',
      sourceUrl: ''
    });
  } catch (err) {
    if (loadToken !== state.docLoadToken) return;
    showError('無法讀取本機檔案', err?.message || '讀取檔案時發生錯誤。', false);
  }
}

// ============================================================
// Language Change & Zoom Re-layout
// ============================================================
async function handleTargetLanguageChange(newLang, { persist = true } = {}) {
  state.settings = { ...(state.settings || {}), targetLang: newLang };
  if (persist) {
    state.settings = await saveSettings({ targetLang: newLang });
  }
  if (!state.pdfDoc) return;

  state.translationEpoch += 1;
  cancelAllActiveStreams();
  closeComparePopover();

  state.translations.clear();
  state.cachedKeys.clear();
  state.totalParagraphs = 0;
  state.translatedParagraphs = 0;
  state.lastError = '';
  state.lastErrorCode = '';

  for (const pageRec of state.pages.values()) {
    pageRec.translatedEpoch = -1;
    pageRec.translationRunSeq = (pageRec.translationRunSeq || 0) + 1;
    pageRec.translationInFlight = false;
    pageRec.overlayLayer.replaceChildren();
    pageRec.overlayById.clear();
    pageRec.splitBody.replaceChildren();
    pageRec.splitElById.clear();
    pageRec.splitStatusEl.textContent = '重新翻譯中...';
  }

  updateStatusBadge();

  // Immediately re-translate visible/near-viewport pages (reusing rendered canvases!)
  const vh = window.innerHeight || 800;
  for (const pageRec of state.pages.values()) {
    const rect = pageRec.rowEl.getBoundingClientRect();
    const nearViewport = pageRec.isVisible || (rect.bottom >= -500 && rect.top <= vh + 500);
    if (nearViewport) {
      renderAndTranslatePage(pageRec.pageNum, { forceCanvas: false });
    }
  }
}

function applyZoom(nextZoom) {
  const clamped = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], nextZoom));
  if (Math.abs(clamped - state.zoom) < 0.001) return;

  state.zoom = clamped;
  updateZoomUI();
  closeComparePopover();
  refreshPageShellsForCurrentScale();
}

function refreshPageShellsForCurrentScale() {
  if (!state.pdfDoc) return;

  const vh = window.innerHeight || 800;
  for (const pageRec of state.pages.values()) {
    const baseW = pageRec.baseWidth || state.defaultPageWidth || 612;
    const baseH = pageRec.baseHeight || state.defaultPageHeight || 792;
    pageRec.baseFitScale = computePageBaseFitScale(baseW, state.mode);
    const nextScale = pageRec.baseFitScale * state.zoom;

    pageRec.sheetEl.style.width = `${Math.round(baseW * nextScale)}px`;
    pageRec.sheetEl.style.height = `${Math.round(baseH * nextScale)}px`;

    const rect = pageRec.rowEl.getBoundingClientRect();
    const nearViewport = pageRec.isVisible || (rect.bottom >= -500 && rect.top <= vh + 500);
    if (nearViewport) {
      renderAndTranslatePage(pageRec.pageNum, { forceCanvas: true });
    } else {
      cancelPageRender(pageRec);
      pageRec.rendered = false;
      pageRec.renderedScale = 0;
      pageRec.loaderEl.hidden = false;
    }
  }
  scheduleSyncCurrentPage();
}

function stepZoom(direction) {
  let idx = ZOOM_STEPS.findIndex((v) => Math.abs(v - state.zoom) < 0.02);
  if (idx === -1) {
    idx = ZOOM_STEPS.findIndex((v) => v > state.zoom);
    if (idx === -1) idx = ZOOM_STEPS.length - 1;
  }
  const nextIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + direction));
  applyZoom(ZOOM_STEPS[nextIdx]);
}

// ============================================================
// Event Listeners & Initialization
// ============================================================
function bindEvents() {
  window.addEventListener('scroll', scheduleSyncCurrentPage, { passive: true });

  let resizeTimer = null;
  let lastWindowWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (!state.pdfDoc) return;
    if (Math.abs(window.innerWidth - lastWindowWidth) < 16) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      lastWindowWidth = window.innerWidth;
      if (!state.pdfDoc) return;
      const baseWidth = Math.max(120, state.defaultPageWidth || 612);
      const nextBaseFitScale = computePageBaseFitScale(baseWidth, state.mode);
      if (Math.abs(nextBaseFitScale - state.baseFitScale) > 0.015) {
        state.baseFitScale = nextBaseFitScale;
        closeComparePopover();
        refreshPageShellsForCurrentScale();
      } else {
        scheduleSyncCurrentPage();
      }
    }, 220);
  });

  // Mode segmented buttons
  dom.modeSegmented.addEventListener('click', (e) => {
    const btn = e.target.closest('.nr-seg-btn');
    if (!btn || !btn.dataset.mode) return;
    setMode(btn.dataset.mode);
  });

  // Target language selector
  dom.langSelect.addEventListener('change', () => {
    handleTargetLanguageChange(dom.langSelect.value);
  });

  // Zoom controls
  dom.zoomOutBtn.addEventListener('click', () => stepZoom(-1));
  dom.zoomInBtn.addEventListener('click', () => stepZoom(1));
  dom.zoomResetBtn.addEventListener('click', () => applyZoom(1.0));

  // Local PDF file picker triggers
  const triggerFilePicker = () => {
    dom.fileInput.value = '';
    dom.fileInput.click();
  };
  dom.openFileBtn.addEventListener('click', triggerFilePicker);
  dom.emptyOpenBtn.addEventListener('click', triggerFilePicker);
  dom.errorOpenFileBtn.addEventListener('click', triggerFilePicker);

  dom.fileInput.addEventListener('change', () => {
    const file = dom.fileInput.files?.[0];
    if (file) {
      loadPdfFromFile(file);
    }
  });

  // URL form & retry
  dom.urlForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = dom.urlInput.value.trim();
    if (val) {
      loadPdfFromUrl(val);
    }
  });

  dom.retryUrlBtn.addEventListener('click', () => {
    if (state.sourceUrl) {
      loadPdfFromUrl(state.sourceUrl);
    }
  });

  // Settings & Error quick action
  const openOptions = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }).catch(() => {});
  };
  dom.settingsBtn.addEventListener('click', openOptions);
  dom.statusActionBtn.addEventListener('click', openOptions);

  // Compare popover controls
  dom.compareCloseBtn.addEventListener('click', closeComparePopover);
  dom.comparePopover.addEventListener('click', (e) => e.stopPropagation());

  const copyWithFeedback = async (btn, text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const prev = btn.textContent;
      btn.textContent = '已複製';
      setTimeout(() => {
        btn.textContent = prev;
      }, 1200);
    } catch (_) {}
  };

  dom.copyOrigBtn.addEventListener('click', () => {
    copyWithFeedback(dom.copyOrigBtn, state.activeComparePara?.orig || '');
  });

  dom.copyTransBtn.addEventListener('click', () => {
    copyWithFeedback(dom.copyTransBtn, state.activeComparePara?.trans || '');
  });

  document.addEventListener('click', () => {
    if (!dom.comparePopover.hidden) {
      closeComparePopover();
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dom.comparePopover.hidden) {
      closeComparePopover();
      return;
    }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === '1') setMode('overlay');
    else if (e.key === '2') setMode('split');
    else if (e.key === '3') setMode('original');
    else if (e.key === '+' || e.key === '=') {
      if (!e.metaKey && !e.ctrlKey) stepZoom(1);
    } else if (e.key === '-') {
      if (!e.metaKey && !e.ctrlKey) stepZoom(-1);
    } else if (e.key === '0') {
      if (!e.metaKey && !e.ctrlKey) applyZoom(1.0);
    }
  });

  // Global drag-and-drop for local PDF files
  const hasFiles = (dt) => Array.from(dt?.types || []).includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    state.dragDepth += 1;
    dom.dragOverlay.hidden = false;
  });

  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) {
      dom.dragOverlay.hidden = true;
    }
  });

  window.addEventListener('drop', (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    state.dragDepth = 0;
    dom.dragOverlay.hidden = true;
    const file = Array.from(e.dataTransfer.files || []).find(
      (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    );
    if (file) {
      loadPdfFromFile(file);
    }
  });

  window.addEventListener('pagehide', () => {
    abortActiveFetch();
    cancelAllActiveStreams();
    disconnectObservers();
    for (const pageRec of state.pages.values()) {
      cancelPageRender(pageRec);
    }
    if (state.streamPort) {
      try {
        state.streamPort.disconnect();
      } catch (_) {}
      state.streamPort = null;
    }
    if (state.pdfDoc) {
      state.pdfDoc.destroy().catch(() => {});
      state.pdfDoc = null;
    }
  });

  // Sync settings updates from Options page (e.g., user enters API Key, switches model/lang/glossary)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
    const nextSettings = changes[SETTINGS_KEY].newValue;
    if (!nextSettings) return;
    const prev = state.settings;
    const hadError = Boolean(state.lastError);
    state.settings = nextSettings;
    populateLanguageSelect(nextSettings.targetLang || 'zh-TW');

    const needsRetranslate = Boolean(
      prev && (
        nextSettings.targetLang !== prev.targetLang ||
        nextSettings.customTargetLang !== prev.customTargetLang ||
        nextSettings.model !== prev.model ||
        nextSettings.protocol !== prev.protocol ||
        nextSettings.customGlossary !== prev.customGlossary
      )
    );

    if (state.pdfDoc && needsRetranslate) {
      handleTargetLanguageChange(nextSettings.targetLang || 'zh-TW', { persist: false });
    } else if (state.pdfDoc && hadError) {
      state.lastError = '';
      state.lastErrorCode = '';
      updateStatusBadge();
      for (const pageRec of state.pages.values()) {
        if (pageRec.isVisible && pageRec.translatedEpoch !== state.translationEpoch) {
          renderAndTranslatePage(pageRec.pageNum, { forceCanvas: false });
        }
      }
    }
  });
}

async function init() {
  state.settings = await getSettings();
  populateLanguageSelect(state.settings.targetLang || 'zh-TW');
  setMode('overlay');
  updateZoomUI();
  updateStatusBadge();
  bindEvents();

  const params = new URLSearchParams(window.location.search);
  const srcParam = params.get('src');
  if (srcParam && srcParam.trim()) {
    await loadPdfFromUrl(srcParam.trim());
  } else {
    showStage('empty');
  }
}

init();
