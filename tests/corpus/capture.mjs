// Capture real-site layout snapshots for the segmentation corpus.
//
//   tests/corpus/capture.sh                      # all sites
//   tests/corpus/capture.sh kaggle-discussion    # one site
//
// Each snapshot keeps the page's DOM structure and CSS (serialized from
// document.styleSheets, because CSS-in-JS sheets live only in cssRules) but
// scrambles every word into a same-length pseudo-word, replaces link targets
// and drops images/scripts, so no personal data or article text is stored.
// Output: tests/corpus/pages/<id>.html (git-ignored; re-capture at any time).
import fs from 'node:fs';
import path from 'node:path';

const SITES = [
  { id: 'kaggle-discussion', url: 'https://www.kaggle.com/competitions/santa-2026/discussion' },
  { id: 'wikipedia-transformer', url: 'https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)' },
  { id: 'colah-home', url: 'https://colah.github.io/' },
  { id: 'mdn-closures', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures' },
  { id: 'hackernews', url: 'https://news.ycombinator.com/' },
  { id: 'stackoverflow-question', url: 'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array' },
  { id: 'github-repo', url: 'https://github.com/karpathy/nanoGPT' },
  { id: 'arxiv-abs', url: 'https://arxiv.org/abs/1706.03762' }
];

// ego-browser runs scripts outside the repo cwd; capture.sh prepends globalThis.CORPUS_ROOT.
const OUT_DIR = path.join(globalThis.CORPUS_ROOT || process.cwd(), 'tests', 'corpus', 'pages');
fs.mkdirSync(OUT_DIR, { recursive: true });
const only = String(globalThis.CORPUS_ONLY || '').split(',').filter(Boolean);

function snapshotInPage() {
  const hash = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  const LOWER = 'etaoinshrdlucmfwypvbgk';
  const scrambleWord = (w) => {
    let h = hash(w);
    let out = '';
    for (const ch of w) {
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      if (/[a-z]/.test(ch)) out += LOWER[h % LOWER.length];
      else if (/[A-Z]/.test(ch)) out += LOWER[h % LOWER.length].toUpperCase();
      else if (/\p{L}/u.test(ch)) out += '字';
      else out += ch; // digits, punctuation, whitespace stay (they drive layout and metadata rules)
    }
    return out;
  };
  const scramble = (text) => String(text).replace(/[\p{L}\p{M}]+/gu, scrambleWord);
  // Keep code-ish tokens recognisable as code (camelCase/snake_case/dots) by scrambling letters only.

  // 1. CSS from cssRules (works for CSS-in-JS); cross-origin sheets fall back to <link>.
  const cssParts = [];
  const crossLinks = [];
  for (const sheet of document.styleSheets) {
    let rules = null;
    try { rules = sheet.cssRules; } catch (_) { rules = null; }
    if (!rules) {
      if (sheet.href) crossLinks.push(sheet.href);
      continue;
    }
    const base = sheet.href || location.href;
    let css = '';
    for (const r of rules) css += r.cssText + '\n';
    css = css.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => {
      if (/^(data:|#)/.test(u)) return m;
      try { return `url("${new URL(u, base).href}")`; } catch (_) { return m; }
    });
    // Background images in site CSS may be avatars etc. Fonts are kept (typography matters).
    css = css.replace(/background(-image)?:[^;}]*url\([^)]*\)[^;}]*/g, (m) => (/@font-face/.test(m) ? m : 'background-image: none'));
    cssParts.push(css);
  }

  // 2. Record rendered image sizes before cloning.
  const imgs = [...document.querySelectorAll('img, svg, video, canvas, picture')];
  const sizes = imgs.map((el) => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });

  const clone = document.documentElement.cloneNode(true);
  const cloneImgs = [...clone.querySelectorAll('img, svg, video, canvas, picture')];
  cloneImgs.forEach((el, i) => {
    const s = sizes[i] || { w: 0, h: 0 };
    const ph = document.createElement('span');
    ph.setAttribute('data-corpus-media', el.tagName.toLowerCase());
    ph.style.cssText = `display:inline-block;width:${s.w}px;height:${s.h}px;background:#8884;vertical-align:middle`;
    if (el.className && typeof el.className === 'string') ph.className = el.className;
    el.replaceWith(ph);
  });

  clone.querySelectorAll('script, noscript, iframe, link, style, meta:not([charset]):not([name="viewport"]), template, object, embed, [data-kct-ui]').forEach((n) => n.remove());
  clone.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const n = attr.name;
      if (n.startsWith('data-kct') || n.startsWith('on') || n === 'srcset' || n === 'nonce' || n === 'integrity') { el.removeAttribute(n); continue; }
      if (['alt', 'title', 'aria-label', 'placeholder', 'aria-description', 'value', 'content'].includes(n)) {
        el.setAttribute(n, scramble(attr.value));
      } else if (n === 'href' || n === 'action' || n === 'src') {
        const v = attr.value;
        if (v.startsWith('#')) continue;
        el.setAttribute(n, `https://example.com/${hash(v).toString(36)}`);
      } else if (n === 'style' && /url\(/.test(attr.value)) {
        el.setAttribute(n, attr.value.replace(/url\([^)]*\)/g, 'none'));
      } else if (n.startsWith('data-') && attr.value.length > 24) {
        el.removeAttribute(n);
      }
    }
  });
  // Icon-font ligatures (e.g. "arrow_drop_up") render as glyphs; keep them so icons keep their size.
  const ICON_SELECTOR = '.google-symbols, .material-icons, .material-icons-outlined, .material-symbols-outlined, .material-symbols-rounded, .material-symbols-sharp';
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  let t;
  while ((t = walker.nextNode())) {
    if (t.parentElement && t.parentElement.closest(ICON_SELECTOR)) continue;
    t.nodeValue = scramble(t.nodeValue);
  }

  const head = clone.querySelector('head') || clone.insertBefore(document.createElement('head'), clone.firstChild);
  const title = head.querySelector('title');
  if (title) title.textContent = 'corpus';
  const meta = document.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  head.prepend(meta);
  for (const href of crossLinks) {
    if (!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(href)) continue; // fonts only
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    head.appendChild(l);
  }
  const style = document.createElement('style');
  style.setAttribute('data-corpus-css', '1');
  style.textContent = cssParts.join('\n');
  head.appendChild(style);
  return {
    html: '<!doctype html>\n' + clone.outerHTML,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    cssBytes: style.textContent.length
  };
}

const task = await taskSpace('corpus capture');
try {
  const w = task.page('p1');
  for (const site of SITES) {
    if (only.length && !only.includes(site.id)) continue;
    await w.goto(site.url);
    await w.waitForLoadState();
    await new Promise((r) => setTimeout(r, 6000));
    // Scroll once through the page so lazy content renders, then back to top.
    await w.evaluate(async () => {
      for (let y = 0; y < Math.min(document.body.scrollHeight, 30000); y += innerHeight) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 150));
      }
      scrollTo(0, 0);
    });
    await new Promise((r) => setTimeout(r, 1500));
    const snap = await w.evaluate(snapshotInPage);
    const file = path.join(OUT_DIR, `${site.id}.html`);
    const html = snap.html.replace('<head>', `<head>\n<!-- corpus:${site.id} viewport:${snap.viewport.w}x${snap.viewport.h} -->`);
    fs.writeFileSync(file, html, 'utf8');
    console.log(`${site.id}\t${(html.length / 1024).toFixed(0)} KB\tcss ${(snap.cssBytes / 1024).toFixed(0)} KB\tviewport ${snap.viewport.w}x${snap.viewport.h}`);
  }
} finally {
  await task.finish({ keep: [] });
}
