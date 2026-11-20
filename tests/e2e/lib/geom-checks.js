// Pure browser-injectable DOM & geometric verification functions.
// Each eval* function MUST remain self-contained (zero outer closures) so
// page.evaluate(fn, arg) works directly inside ego-browser.

export function evalOverflowCheck() {
  const doc = document.documentElement;
  const body = document.body;
  const innerWidth = window.innerWidth;
  const innerHeight = window.innerHeight;
  const docScrollWidth = doc ? doc.scrollWidth : 0;
  const docClientWidth = doc ? doc.clientWidth : innerWidth;
  const docScrollHeight = doc ? doc.scrollHeight : 0;
  const docClientHeight = doc ? doc.clientHeight : innerHeight;
  const bodyScrollWidth = body ? body.scrollWidth : 0;
  return {
    innerWidth,
    innerHeight,
    docScrollWidth,
    docClientWidth,
    docScrollHeight,
    docClientHeight,
    bodyScrollWidth,
    horizOverflow: docScrollWidth > docClientWidth + 1,
    vertOverflow: docScrollHeight > docClientHeight + 1
  };
}

export function evalPairwiseOverlapCheck(opts = {}) {
  const selector = opts.selector || '.nr-pdf-para';
  const scopeSelector = opts.scopeSelector || null;
  const minOverlapPx = Number.isFinite(opts.minOverlapPx) ? opts.minOverlapPx : 4;
  const minAreaRatio = Number.isFinite(opts.minAreaRatio) ? opts.minAreaRatio : 0.03;

  const isVisible = (el) => {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };

  const checkGroup = (elements, scopeLabel) => {
    const items = [];
    for (const el of elements) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      items.push({
        el,
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
        text: (el.textContent || '').trim().slice(0, 50)
      });
    }
    const overlaps = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const h = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (w > minOverlapPx && h > minOverlapPx) {
          const area = w * h;
          const minArea = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
          const ratio = minArea > 0 ? area / minArea : 0;
          if (ratio > minAreaRatio) {
            overlaps.push({
              scope: scopeLabel,
              aText: a.text,
              bText: b.text,
              overlapW: Math.round(w * 10) / 10,
              overlapH: Math.round(h * 10) / 10,
              areaRatio: Math.round(ratio * 1000) / 1000
            });
          }
        }
      }
    }
    return { count: items.length, overlaps };
  };

  if (scopeSelector) {
    const scopes = Array.from(document.querySelectorAll(scopeSelector));
    let totalCount = 0;
    const allOverlaps = [];
    scopes.forEach((sc, idx) => {
      const res = checkGroup(Array.from(sc.querySelectorAll(selector)), `${scopeSelector}#${idx}`);
      totalCount += res.count;
      allOverlaps.push(...res.overlaps);
    });
    return { count: totalCount, overlaps: allOverlaps };
  }

  return checkGroup(Array.from(document.querySelectorAll(selector)), 'document');
}

export function evalWidgetCollisionCheck() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const widgets = [];
  const offscreen = [];

  const inspectEl = (name, el) => {
    if (!el) return null;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return null;
    const info = {
      name,
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height
    };
    widgets.push(info);
    if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
      offscreen.push(info);
    }
    return info;
  };

  const widgetHost = document.querySelector('#kct-widget-host');
  if (widgetHost && widgetHost.shadowRoot) {
    inspectEl('kct-pill', widgetHost.shadowRoot.querySelector('.kct-pill'));
  }

  const selHost = document.querySelector('#kct-selection-host');
  if (selHost && selHost.shadowRoot) {
    inspectEl('kct-sel-btn', selHost.shadowRoot.querySelector('.kct-sel-btn'));
    inspectEl('kct-sel-popover', selHost.shadowRoot.querySelector('.kct-sel-popover'));
  }

  const usHost = document.querySelector('[data-kct-ui="userscript-host"]');
  if (usHost && usHost.shadowRoot) {
    inspectEl('nr-pill', usHost.shadowRoot.querySelector('.nr-pill'));
    inspectEl('nr-edge-tab', usHost.shadowRoot.querySelector('.nr-edge-tab'));
  }

  const collisions = [];
  for (let i = 0; i < widgets.length; i++) {
    for (let j = i + 1; j < widgets.length; j++) {
      const a = widgets[i];
      const b = widgets[j];
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2) {
        collisions.push({ a: a.name, b: b.name, overlapW: w, overlapH: h });
      }
    }
  }

  return { viewport: { vw, vh }, widgets, offscreen, collisions };
}

export function evalTableCrushCheck(opts = {}) {
  const tableSelector = opts.tableSelector || 'table';
  const minThWidthPx = Number.isFinite(opts.minThWidthPx) ? opts.minThWidthPx : 28;
  const tables = Array.from(document.querySelectorAll(tableSelector));
  const crushed = [];
  let checkedHeaders = 0;

  for (const table of tables) {
    const tRect = table.getBoundingClientRect();
    if (tRect.width <= 0 || tRect.height <= 0) continue;
    const ths = Array.from(table.querySelectorAll('th'));
    for (const th of ths) {
      const st = getComputedStyle(th);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const text = (th.textContent || '').trim();
      if (text.length < 2) continue;
      checkedHeaders++;
      const r = th.getBoundingClientRect();
      if (r.width > 0 && r.width < minThWidthPx && r.height > r.width * 2.2) {
        crushed.push({
          text: text.slice(0, 40),
          width: Math.round(r.width * 10) / 10,
          height: Math.round(r.height * 10) / 10
        });
      }
    }
  }

  return { tableCount: tables.length, checkedHeaders, crushed };
}

export function evalRawLatexLeakCheck(opts = {}) {
  const selector =
    opts.selector ||
    '.nr-pdf-para, .nr-split-para, p[data-kct-pdf-block="1"] [data-kct-ui="trans"]';
  const re = /\$\$?[^$\n]{1,120}\$\$?|\\(?:text|frac|sqrt|sum|prod|alpha|beta|theta)\b/;
  const nodes = Array.from(document.querySelectorAll(selector));
  const leaks = [];
  for (const el of nodes) {
    const txt = (el.textContent || '').trim();
    if (!txt) continue;
    const m = txt.match(re);
    if (m) {
      leaks.push({ match: m[0], text: txt.slice(0, 80) });
    }
  }
  return { totalChecked: nodes.length, leaks };
}

export function evalContrastAndLuminanceCheck(opts = {}) {
  const selector =
    opts.selector || '[data-kct-has-trans="1"] > .kct-trans-wrap, .nr-pdf-para';
  const minContrastRatio = Number.isFinite(opts.minContrastRatio) ? opts.minContrastRatio : 3.0;

  const parseColor = (str) => {
    if (!str) return null;
    const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (!m) return null;
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] !== undefined ? Number(m[4]) : 1
    };
  };

  const relLum = ({ r, g, b }) => {
    const toLin = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
  };

  const resolveBg = (el) => {
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const bg = parseColor(getComputedStyle(cur).backgroundColor);
      if (bg && bg.a > 0.15) return bg;
      cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host) || null;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  const els = Array.from(document.querySelectorAll(selector));
  const failures = [];
  let checked = 0;

  for (const el of els) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) continue;
    const txt = (el.textContent || '').trim();
    if (!txt) continue;
    const fg = parseColor(st.color);
    if (!fg || fg.a < 0.1) continue;
    const bg = resolveBg(el);
    const l1 = relLum(fg);
    const l2 = relLum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    checked++;
    if (ratio < minContrastRatio) {
      failures.push({
        ratio: Math.round(ratio * 100) / 100,
        fg: st.color,
        bg: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
        text: txt.slice(0, 50)
      });
    }
  }

  return { checked, failures };
}

export function evalEllipsisAndClipCheck(opts = {}) {
  const selector = opts.selector || '.nr-nav-label';
  const els = Array.from(document.querySelectorAll(selector));
  const truncated = [];
  for (const el of els) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    if (el.scrollWidth > el.clientWidth + 1) {
      truncated.push({
        text: (el.textContent || '').trim(),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth
      });
    }
  }
  const clippedPdfParas = Array.from(document.querySelectorAll('.nr-pdf-para.is-clipped')).map((el) => ({
    text: (el.textContent || '').trim().slice(0, 50),
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight
  }));
  return { checked: els.length, truncated, clippedPdfParas };
}

export function evalSecurityProseScan(opts = {}) {
  const defaultPatterns = [
    'chrome.storage.local',
    '第三方伺服器',
    'URL Fragment',
    '安全設計',
    'GM_xmlhttpRequest',
    '絕不經過',
    '不經過第三方',
    'localStorage 與 IndexedDB',
    '僅儲存於您的手機本機',
    '僅儲存於本機',
    '高容量 LRU 快取',
    '網址 # 錨點'
  ];
  const patterns = Array.isArray(opts.customPatterns) && opts.customPatterns.length > 0
    ? opts.customPatterns
    : defaultPatterns;

  const collectText = (root) => {
    let acc = '';
    if (!root) return acc;
    if (typeof root.innerText === 'string') {
      acc += '\n' + root.innerText;
    } else if (typeof root.textContent === 'string') {
      acc += '\n' + root.textContent;
    }
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const node of all) {
      if (node.shadowRoot) {
        acc += '\n' + collectText(node.shadowRoot);
      }
    }
    return acc;
  };

  const fullText = collectText(document.body || document.documentElement);
  const found = patterns.filter((pat) => fullText.includes(pat));
  return { found };
}

export async function auditOverflow(page) {
  return await page.evaluate(evalOverflowCheck);
}

export async function auditPairwiseOverlap(page, opts = {}) {
  return await page.evaluate(evalPairwiseOverlapCheck, opts);
}

export async function auditWidgetCollision(page) {
  return await page.evaluate(evalWidgetCollisionCheck);
}

export async function auditTableCrush(page, opts = {}) {
  return await page.evaluate(evalTableCrushCheck, opts);
}

export async function auditRawLatexLeaks(page, opts = {}) {
  return await page.evaluate(evalRawLatexLeakCheck, opts);
}

export async function auditContrastAndLuminance(page, opts = {}) {
  return await page.evaluate(evalContrastAndLuminanceCheck, opts);
}

export async function auditEllipsisAndClip(page, opts = {}) {
  return await page.evaluate(evalEllipsisAndClipCheck, opts);
}

export async function auditSecurityProse(page, opts = {}) {
  return await page.evaluate(evalSecurityProseScan, opts);
}
