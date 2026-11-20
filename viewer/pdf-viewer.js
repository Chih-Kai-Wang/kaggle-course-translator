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
const SERIF_FONT_REGEX = /serif|times|garamond|georgia|mincho|cambria|palatino|cmr|charter|merriweather|baskerville|book|roman|caslon|minion|nimbusrom|computer\s*modern/i;
const SANS_FONT_REGEX = /sans|arial|helvetica|calibri|roboto|inter|lato|open\s*sans|verdana|tahoma|gothic|cmss|nimbus\s*sans/i;
const MONO_FONT_REGEX = /mono|courier|consolas|menlo|code|cmtt|inconsolata|fira\s*code|dejavusansmono/i;
const BOLD_FONT_REGEX = /bold|black|heavy|semibold|demi|medi|bx\d/i;
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

  // Observers
  renderObserver: null,
  pageTrackObserver: null,

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
    const cacheHint = cached > 0 ? `（快取 ${cached}）` : '';
    const label = `已譯 ${translated} 段${cacheHint}`;
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

  // Re-fit any overlays that were rendered while overlay layer was display:none (in split/original mode)
  if (nextMode === 'overlay') {
    requestAnimationFrame(() => {
      for (const pageRec of state.pages.values()) {
        if (!pageRec.needsOverlayRefit || !pageRec.viewport) continue;
        pageRec.needsOverlayRefit = false;
        for (const para of pageRec.translatableParagraphs || []) {
          const el = pageRec.overlayById.get(para.id);
          if (!el) continue;
          const padX = 2.5;
          const padY = 1.5;
          const left = Math.max(0, para.x - padX);
          const width = Math.min(pageRec.viewport.width - left, para.w + padX * 2);
          const minHeight = para.h + padY * 2;
          const maxHeight = Math.max(minHeight, para.maxAllowedHeight + padY);
          fitOverlayTypography(el, para, maxHeight, width);
        }
      }
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
// Language & Non-Prose Filtering
// ============================================================
function shouldTranslatePdfText(text, targetLangId, meta = {}) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 4) return false;

  // Skip URLs, emails, DOIs, arXiv stamps
  if (/^(?:https?:\/\/|www\.|mailto:|ftp:\/\/)\S+$/i.test(clean)) return false;
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(clean)) return false;
  if (/^(?:doi:|arxiv:)\S+$/i.test(clean)) return false;

  // Skip pure numbers, page numbers, table numbers, ratios, dates
  if (/^[\d\s.,:%+\-–—/()[\]$€£¥°×]+$/.test(clean)) return false;
  if (/^(?:page|p\.?|pp\.?)\s*\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(clean)) return false;
  if (/^\d+\s*\/\s*\d+$/.test(clean)) return false;
  if (/^(?:fig\.?|figure|table|tab\.?|eq\.?)\s*\d+[a-z]?\.?$/i.test(clean)) return false;

  const letters = clean.match(/\p{L}/gu) || [];
  if (letters.length < 2) return false;

  // Skip pure monospace code-like lines
  if (meta.isMono && /[=(){}[\];<>]|^\s*(?:def|class|import|from|return|const|let|var|for|while|if)\b/.test(clean)) {
    return false;
  }

  // Skip equation / formula blocks with heavy mathematical operators and few prose words
  const words = clean.match(/[a-zA-Z\p{L}]{2,}/gu) || [];
  const mathSymbols = (clean.match(/[=≈≠≤≥<>±×÷∑∏∫√∞∂∇∈∉⊂⊃∪∩∀∃^_{}\\|]/g) || []).length;
  if (mathSymbols >= 3 && mathSymbols / clean.length > 0.16 && words.length < 6) {
    return false;
  }

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

// ============================================================
// Smart Geometric Paragraph Grouping
// ============================================================
function detectFontMeta(fontName, styles) {
  const style = styles?.[fontName] || null;
  const combined = `${style?.fontFamily || ''} ${fontName || ''}`;
  const isMono = MONO_FONT_REGEX.test(combined);
  const isSerif = !isMono && SERIF_FONT_REGEX.test(combined) && !SANS_FONT_REGEX.test(combined);
  const isBold = BOLD_FONT_REGEX.test(combined);
  return { isSerif, isMono, isBold };
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
  if (paragraphs.length <= 1) return paragraphs;
  const midX = pageWidth * 0.5;
  const margin = Math.max(16, pageWidth * 0.03);

  // Sort by top first to partition into horizontal bands separated by full-width spanning blocks
  const byTop = [...paragraphs].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const bands = [];
  let currentBand = [];

  const isSpanning = (p) => p.x < midX - margin && p.right > midX + margin && p.w > pageWidth * 0.52;

  for (const p of byTop) {
    if (isSpanning(p)) {
      if (currentBand.length > 0) {
        bands.push({ spanning: false, items: currentBand });
        currentBand = [];
      }
      bands.push({ spanning: true, items: [p] });
    } else {
      currentBand.push(p);
    }
  }
  if (currentBand.length > 0) {
    bands.push({ spanning: false, items: currentBand });
  }

  const ordered = [];
  for (const band of bands) {
    if (band.spanning || band.items.length <= 1) {
      ordered.push(...band.items);
      continue;
    }
    const leftCol = [];
    const rightCol = [];
    const other = [];
    for (const p of band.items) {
      if (p.right <= midX + margin) {
        leftCol.push(p);
      } else if (p.x >= midX - margin) {
        rightCol.push(p);
      } else {
        other.push(p);
      }
    }
    if (leftCol.length > 0 && rightCol.length > 0 && other.length === 0) {
      leftCol.sort((a, b) => a.y - b.y);
      rightCol.sort((a, b) => a.y - b.y);
      ordered.push(...leftCol, ...rightCol);
    } else {
      band.items.sort((a, b) => (a.y - b.y) || (a.x - b.x));
      ordered.push(...band.items);
    }
  }
  return ordered;
}

function extractPdfParagraphs(textContent, viewport) {
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
    if (!Number.isFinite(fontSize) || fontSize < 5.0 * viewport.scale) continue;

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

    const fontMeta = detectFontMeta(item.fontName, styles);
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
      ...fontMeta
    });
  }

  if (spans.length === 0) return [];

  // 2. Cluster into horizontal baseline rows
  spans.sort((a, b) => (a.baselineY - b.baselineY) || (a.x - b.x));
  const rows = [];
  for (const sp of spans) {
    let matchedRow = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      const tol = 0.45 * Math.min(row.avgFontSize, sp.fontSize);
      if (Math.abs(sp.baselineY - row.baselineY) <= tol) {
        matchedRow = row;
        break;
      }
      if (sp.baselineY - row.baselineY > Math.max(row.avgFontSize, sp.fontSize) * 1.2) {
        break;
      }
    }
    if (matchedRow) {
      const prevWeight = matchedRow.weight;
      const nextWeight = prevWeight + sp.charLen;
      matchedRow.baselineY = (matchedRow.baselineY * prevWeight + sp.baselineY * sp.charLen) / nextWeight;
      matchedRow.avgFontSize = (matchedRow.avgFontSize * prevWeight + sp.fontSize * sp.charLen) / nextWeight;
      matchedRow.weight = nextWeight;
      matchedRow.spans.push(sp);
    } else {
      rows.push({
        baselineY: sp.baselineY,
        avgFontSize: sp.fontSize,
        weight: sp.charLen,
        spans: [sp]
      });
    }
  }

  // 3. Split rows into column-safe horizontal line segments (gap > 3.2 * fontSize)
  const lines = [];
  for (const row of rows) {
    row.spans.sort((a, b) => a.x - b.x);
    let segSpans = [row.spans[0]];

    const flushSegment = (group) => {
      const text = joinLineSpans(group);
      if (!text) return;
      let minX = Infinity;
      let maxRight = -Infinity;
      let minTop = Infinity;
      let maxBottom = -Infinity;
      let totalWeight = 0;
      let fsSum = 0;
      let baselineSum = 0;
      let serifWeight = 0;
      let boldWeight = 0;
      let monoWeight = 0;

      for (const s of group) {
        if (s.x < minX) minX = s.x;
        if (s.right > maxRight) maxRight = s.right;
        if (s.top < minTop) minTop = s.top;
        if (s.bottom > maxBottom) maxBottom = s.bottom;
        totalWeight += s.charLen;
        fsSum += s.fontSize * s.charLen;
        baselineSum += s.baselineY * s.charLen;
        if (s.isSerif) serifWeight += s.charLen;
        if (s.isBold) boldWeight += s.charLen;
        if (s.isMono) monoWeight += s.charLen;
      }

      lines.push({
        text,
        x: minX,
        right: maxRight,
        w: Math.max(1, maxRight - minX),
        top: minTop,
        bottom: maxBottom,
        h: Math.max(1, maxBottom - minTop),
        baselineY: baselineSum / totalWeight,
        fontSize: fsSum / totalWeight,
        weight: totalWeight,
        isSerif: serifWeight > totalWeight * 0.5,
        isBold: boldWeight > totalWeight * 0.5,
        isMono: monoWeight > totalWeight * 0.6
      });
    };

    for (let i = 1; i < row.spans.length; i++) {
      const prev = segSpans[segSpans.length - 1];
      const curr = row.spans[i];
      const gap = curr.x - prev.right;
      const maxFs = Math.max(prev.fontSize, curr.fontSize);
      const fsRatioDiff = Math.abs(prev.fontSize - curr.fontSize) / maxFs;

      // Standard 2-column academic papers have column gutters as narrow as 1.25-2.0 * fontSize
      // (while normal justified word spaces stay < 1.0 * fontSize)
      const shouldSplit =
        gap > 1.5 * maxFs ||
        (gap > 1.15 * maxFs && fsRatioDiff > 0.25);

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

      // Font size similarity within 20%
      const fsDiff = Math.abs(line.fontSize - p.fontSize) / Math.max(line.fontSize, p.fontSize);
      if (fsDiff > 0.20) continue;

      // Same-column horizontal overlap check
      const overlap = Math.min(line.right, p.right) - Math.max(line.x, p.x);
      const minW = Math.min(line.w, p.w);
      const leftDiff = Math.abs(line.x - p.x);
      const centerDiff = Math.abs((line.x + line.right) * 0.5 - (p.x + p.right) * 0.5);
      const sameColumn =
        (overlap > 0 && (overlap >= 0.22 * minW || leftDiff <= 2.4 * avgFs)) ||
        centerDiff <= 2.2 * avgFs;
      if (!sameColumn) continue;

      // Reject merging full-width line with narrow column block (or vice versa)
      const widthRatio = Math.max(line.w, p.w) / Math.max(1, minW);
      if (widthRatio > 2.2 && leftDiff > 4.0 * avgFs && centerDiff > 2.5 * avgFs) {
        continue;
      }

      // Break on bullet / list item prefixes
      if (BULLET_PREFIX_REGEX.test(line.text)) continue;

      // Break on monospace code vs prose transition
      if (p.isMono !== line.isMono) continue;

      // Break on bold subheading followed by regular body text
      if (p.isBold !== line.isBold && p.lines.length === 1 && p.w < viewport.width * 0.65) {
        continue;
      }

      // Break on new paragraph first-line indent when previous line ended short
      const lastLine = p.lines[p.lines.length - 1];
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
      bestPara.monoWeight += line.isMono ? line.weight : 0;
      bestPara.weight = nextW;
      bestPara.isSerif = bestPara.serifWeight > nextW * 0.5;
      bestPara.isBold = bestPara.boldWeight > nextW * 0.5;
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
        monoWeight: line.isMono ? line.weight : 0,
        isSerif: line.isSerif,
        isBold: line.isBold,
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
      isMono: p.isMono,
      isHeading: false,
      maxAllowedHeight: p.h + 4
    };
  });

  const medianFs = computeMedianFontSize(finalized);
  const ordered = orderParagraphsReadingOrder(finalized, viewport.width);

  // Detect headings & calculate safe vertical breathing room (without colliding into next block)
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i];
    p.isHeading =
      (p.fontSize >= 1.22 * medianFs && p.lineCount <= 3 && p.text.length <= 220) ||
      (p.isBold && p.fontSize >= 1.08 * medianFs && p.lineCount <= 2 && p.text.length <= 120 && !/[.,;]$/.test(p.text));

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
    return { bg: '#ffffff', fg: '#111827', isDarkBg: false };
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
    return { bg: '#ffffff', fg: '#111827', isDarkBg: false };
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

  return { bg, fg, isDarkBg };
}

// ============================================================
// Overlay & Split View Rendering
// ============================================================
function fitOverlayTypography(el, para, maxHeight, boxWidth) {
  const startScale = para.isHeading ? 0.96 : 0.94;
  const minFs = Math.max(8.5, para.fontSize * 0.60);
  let fs = Math.max(minFs, para.fontSize * startScale);
  let lh = para.lineCount === 1 ? 1.24 : Math.max(1.22, Math.min(1.46, para.avgLineHeightRatio));

  el.style.fontSize = `${fs.toFixed(2)}px`;
  el.style.lineHeight = lh.toFixed(2);
  el.style.maxHeight = '';
  el.classList.remove('is-clipped');

  const fits = () => el.scrollHeight <= maxHeight + 1 && el.scrollWidth <= boxWidth + 2;

  let guard = 0;
  while (!fits() && fs > minFs + 0.15 && guard < 18) {
    fs = Math.max(minFs, fs * 0.92);
    if (lh > 1.18) {
      lh = Math.max(1.18, lh - 0.03);
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
  const padX = 2.5;
  const padY = 1.5;
  const left = Math.max(0, para.x - padX);
  const top = Math.max(0, para.y - padY);
  const width = Math.min(pageRec.viewport.width - left, para.w + padX * 2);
  const minHeight = para.h + padY * 2;
  const maxHeight = Math.max(minHeight, para.maxAllowedHeight + padY);

  let el = pageRec.overlayById.get(para.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'nr-pdf-para';
    el.dataset.paraId = String(para.id);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleComparePopover(el, para, state.translations.get(para.key) || zh);
    });
    pageRec.overlayLayer.appendChild(el);
    pageRec.overlayById.set(para.id, el);
  }

  const colors = para.colors || { bg: '#ffffff', fg: '#111827', isDarkBg: false };
  el.textContent = zh;
  el.style.left = `${left.toFixed(1)}px`;
  el.style.top = `${top.toFixed(1)}px`;
  el.style.width = `${width.toFixed(1)}px`;
  el.style.minHeight = `${minHeight.toFixed(1)}px`;
  el.style.backgroundColor = colors.bg;
  el.style.color = colors.fg;
  el.style.fontFamily = para.isSerif ? langInfo.serifFontStack : langInfo.sansFontStack;
  el.style.fontWeight = (para.isBold || para.isHeading) ? '700' : '400';
  el.classList.toggle('is-dark-bg', Boolean(colors.isDarkBg));

  if (state.mode !== 'overlay') {
    pageRec.needsOverlayRefit = true;
  } else {
    fitOverlayTypography(el, para, maxHeight, width);
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
  pEl.textContent = zh;
  pEl.classList.remove('is-pending');
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

  if (state.activeCompareAnchor) {
    state.activeCompareAnchor.classList.remove('is-active-compare');
  }
  state.activeCompareAnchor = anchorEl;
  state.activeComparePara = { orig: para.text, trans: translatedText };
  anchorEl.classList.add('is-active-compare');

  const langInfo = resolveTargetLanguage(state.settings);
  dom.compareOrigText.textContent = para.text;
  dom.compareTransText.textContent = translatedText;
  dom.compareTransText.style.fontFamily = para.isSerif ? langInfo.serifFontStack : langInfo.sansFontStack;

  dom.comparePopover.hidden = false;

  // Position safely within viewport bounds near the clicked paragraph
  const anchorRect = anchorEl.getBoundingClientRect();
  const popRect = dom.comparePopover.getBoundingClientRect();
  const margin = 12;
  const toolbarBottom = 64;

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
      widthRatio: para.w / Math.max(1, viewportWidth)
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
      uncachedByKey.set(para.key, {
        key: para.key,
        text: para.text,
        kind: 'block'
      });
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
    state.translations.set(key, zh);
    if (cached) state.cachedKeys.add(key);
    applyTranslationToPage(pageRec, key, zh);
    // Also propagate to any other already-rendered page sharing the exact same header/paragraph key
    for (const otherPage of state.pages.values()) {
      if (otherPage !== pageRec && otherPage.paragraphsByKey.has(key)) {
        applyTranslationToPage(otherPage, key, zh);
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
async function renderAndTranslatePage(pageNum, { forceCanvas = false } = {}) {
  const pageRec = state.pages.get(pageNum);
  const pdfDoc = state.pdfDoc;
  if (!pageRec || !pdfDoc) return;

  const loadToken = state.docLoadToken;
  const targetScale = state.baseFitScale * state.zoom;

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

      const renderTask = pdfPage.render({
        canvasContext: ctx,
        viewport
      });
      pageRec.renderTask = renderTask;

      await renderTask.promise;
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

      const paragraphs = extractPdfParagraphs(textContent, viewport);
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
            widthRatio: para.w / Math.max(1, viewport.width)
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
      if (err?.name === 'RenderingCancelledException') return;
      console.warn(`[NativeRead PDF] Render page ${pageNum} error:`, err);
      return;
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
  if (state.pageTrackObserver) {
    state.pageTrackObserver.disconnect();
    state.pageTrackObserver = null;
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
        }
      }
    },
    { rootMargin: '500px 0px', threshold: 0.01 }
  );

  state.pageTrackObserver = new IntersectionObserver(
    (entries) => {
      let bestPage = null;
      let bestRatio = 0;
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= bestRatio) {
          bestRatio = entry.intersectionRatio;
          bestPage = Number(entry.target.dataset.pageNum);
        }
      }
      if (bestPage !== null) {
        updatePageIndicator(bestPage);
      }
    },
    { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.1, 0.25, 0.5] }
  );

  for (const pageRec of state.pages.values()) {
    state.renderObserver.observe(pageRec.rowEl);
    state.pageTrackObserver.observe(pageRec.rowEl);
  }
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
      throw new Error('所載入的內容並非有效的 PDF 檔案（可能因權限保護而回傳了登入頁面）。');
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
    if (window.innerWidth <= 768) {
      const targetDisplayWidth = Math.max(280, window.innerWidth - 16);
      state.baseFitScale = Math.max(0.42, Math.min(1.65, targetDisplayWidth / Math.max(200, baseViewport.width)));
    } else {
      const targetDisplayWidth = Math.min(860, Math.max(540, window.innerWidth - 72));
      state.baseFitScale = Math.max(0.95, Math.min(1.65, targetDisplayWidth / Math.max(200, baseViewport.width)));
    }
    state.zoom = 1.0;
    updateZoomUI();

    buildPageShells(pdfDoc.numPages, baseViewport.width, baseViewport.height);
    showStage('pages');
    updatePageIndicator(1);
    updateStatusBadge();
    setupObservers();
    window.scrollTo({ top: 0, behavior: 'instant' });
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
    showError('不支援的連結協定', '僅支援 http://、https:// 公開 PDF 連結，或請改用「開啟本機 PDF 檔案」。', false);
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
        `瀏覽器預設限制擴充功能直接讀取 file:// 路徑（${fileName}）。請點擊下方「開啟本機 PDF 檔案」或將檔案直接拖曳至此視窗，或在 chrome://extensions 啟用「允許存取檔案網址」。`,
        false
      );
      return;
    }
    showError(
      '無法從網址載入 PDF',
      `讀取失敗（${err?.message || '網路或存取限制'}）。\n如果此檔案需要網站登入 Cookie 或為私密文件，請先下載到電腦後點選下方「開啟本機 PDF 檔案」。`,
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
  const nextScale = state.baseFitScale * state.zoom;
  for (const pageRec of state.pages.values()) {
    // Scale both rendered and unrendered placeholder shells immediately so scroll position stays coherent
    if (pageRec.viewport && pageRec.renderedScale > 0) {
      const ratio = nextScale / pageRec.renderedScale;
      pageRec.sheetEl.style.width = `${Math.round(pageRec.viewport.width * ratio)}px`;
      pageRec.sheetEl.style.height = `${Math.round(pageRec.viewport.height * ratio)}px`;
    } else {
      pageRec.sheetEl.style.width = `${Math.round(state.defaultPageWidth * nextScale)}px`;
      pageRec.sheetEl.style.height = `${Math.round(state.defaultPageHeight * nextScale)}px`;
    }
    const rect = pageRec.rowEl.getBoundingClientRect();
    const nearViewport = pageRec.isVisible || (rect.bottom >= -500 && rect.top <= vh + 500);
    if (nearViewport) {
      renderAndTranslatePage(pageRec.pageNum, { forceCanvas: true });
    } else {
      pageRec.rendered = false;
    }
  }
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
  let resizeTimer = null;
  let lastWindowWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (!state.pdfDoc) return;
    if (Math.abs(window.innerWidth - lastWindowWidth) < 16) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      lastWindowWidth = window.innerWidth;
      if (!state.pdfDoc) return;
      const baseWidth = Math.max(200, state.defaultPageWidth || 612);
      let nextBaseFitScale;
      if (window.innerWidth <= 768) {
        const targetDisplayWidth = Math.max(280, window.innerWidth - 16);
        nextBaseFitScale = Math.max(0.42, Math.min(1.65, targetDisplayWidth / baseWidth));
      } else {
        const targetDisplayWidth = Math.min(860, Math.max(540, window.innerWidth - 72));
        nextBaseFitScale = Math.max(0.95, Math.min(1.65, targetDisplayWidth / baseWidth));
      }
      if (Math.abs(nextBaseFitScale - state.baseFitScale) > 0.015) {
        state.baseFitScale = nextBaseFitScale;
        closeComparePopover();
        refreshPageShellsForCurrentScale();
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
