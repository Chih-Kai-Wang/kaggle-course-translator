// Page-side corpus checker. Loaded after shared/config.js, content/site-analyzer.js and
// content/renderer.js. Mirrors content.js (collectCandidateBlocks) with a fake translator,
// renders every unit in replace mode, and measures invariants that do NOT depend on how the
// segmenter decides units:
//   merged     unit text sits in side-by-side layout cells (separate columns on one row)
//   nonInline  an element inside .kct-trans-wrap renders as a box (block/flex/grid/table)
//   linkLost   a link of the original is missing from the visible translation
//   fallback   structure guard showed the original instead of the translation
//   overflow   translation introduced horizontal page overflow
//   coverage   share of visible letters in the content roots that ended up in a unit
(function () {
  const TOKEN_RE = /(\[\[\s*\/?[CMLAS]\d+\s*\]\])/g;

  function fakeTranslate(text) {
    return text.split(TOKEN_RE).map((seg) => {
      if (/^\[\[/.test(seg)) return seg;
      return seg.replace(/[\p{L}\p{M}]/gu, '譯'); // 1:1 so letter weights stay comparable
    }).join('');
  }

  function visibleLetterCount(root) {
    let n = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || p.closest('script, style, noscript, template, [data-kct-ui]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let t;
    while ((t = walker.nextNode())) {
      const p = t.parentElement;
      if (!p.getClientRects().length) continue;
      const m = t.nodeValue.match(/[\p{L}]/gu);
      if (m) n += m.length;
    }
    return n;
  }

  // Independent merge detector: two text runs of one unit on the same visual row but far
  // apart horizontally (more than 3 em) are different layout cells, not one sentence.
  function outOfFlowWithin(node, root) {
    for (let c = node; c && c !== root; c = c.parentElement) {
      const cs = getComputedStyle(c);
      if (cs.position === 'absolute' || cs.position === 'fixed' || cs.float !== 'none') return true;
    }
    return false;
  }

  function sideBySideCells(el) {
    const items = [];
    const push = (r, fs, label) => {
      if (r.width > 0 && r.height > 0) items.push({ l: r.left, r: r.right, t: r.top, b: r.bottom, fs, s: label });
    };
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = walker.nextNode()) && items.length < 200) {
      if (!t.nodeValue.trim()) continue;
      const p = t.parentElement;
      // Formula internals are measured as one occupied box below, not as separate text runs.
      if (!p || p.closest('[data-kct-ui], math, .mwe-math-element, .katex, .MathJax, mjx-container')) continue;
      if (outOfFlowWithin(p, el)) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      const fs = parseFloat(getComputedStyle(p).fontSize) || 16;
      for (const r of range.getClientRects()) push(r, fs, t.nodeValue.trim().slice(0, 12));
    }
    // Non-text inline content (images, icons, formulas, inline-blocks) also occupies the row.
    for (const n of el.querySelectorAll('img, svg, math, video, canvas, [data-corpus-media], code, kbd, .mwe-math-element, .katex, mjx-container')) {
      if (n.closest('[data-kct-ui]')) continue;
      for (const r of n.getClientRects()) push(r, 16, '<' + n.tagName.toLowerCase() + '>');
    }
    // Box test: two text-bearing layout boxes (block-level or flex/grid items, not inline-blocks)
    // that sit side by side on one row are separate cells, whatever their text overflow does.
    const boxOf = (node) => {
      for (let cur = node.parentElement; cur && cur !== el; cur = cur.parentElement) {
        const d = getComputedStyle(cur).display;
        const pd = cur.parentElement ? getComputedStyle(cur.parentElement).display : '';
        if (/flex|grid/.test(pd) || !(d.startsWith('inline') || d === 'contents')) return cur;
      }
      return null;
    };
    const boxes = new Set();
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let tn;
    while ((tn = tw.nextNode()) && boxes.size < 60) {
      if (!/[\p{L}\p{N}]/u.test(tn.nodeValue)) continue;
      const p = tn.parentElement;
      if (!p || p.closest('[data-kct-ui], .google-symbols, .material-icons, .material-symbols-outlined, button, math, .mwe-math-element, .katex, .MathJax, mjx-container')) continue;
      if (outOfFlowWithin(p, el)) continue;
      const box = boxOf(tn);
      if (box) boxes.add(box);
    }
    const boxList = [...boxes].map((b) => ({ b, r: b.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.height > 0);
    for (let i = 0; i < boxList.length; i++) {
      for (let j = i + 1; j < boxList.length; j++) {
        const A = boxList[i];
        const B = boxList[j];
        if (A.b.contains(B.b) || B.b.contains(A.b)) continue;
        const vOv = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
        if (vOv < Math.min(A.r.height, B.r.height) * 0.5) continue;
        const hGap = Math.max(A.r.left, B.r.left) - Math.min(A.r.right, B.r.right);
        if (hGap >= 0) return { gap: Math.round(hGap), between: [A.b.textContent.trim().slice(0, 12), B.b.textContent.trim().slice(0, 12)], kind: 'cells' };
      }
    }
    // Group into visual rows; only horizontally ADJACENT items on a row may form a gap.
    items.sort((a, b) => a.t - b.t || a.l - b.l);
    const rows = [];
    for (const it of items) {
      const row = rows.find((r) => {
        const ov = Math.min(r.b, it.b) - Math.max(r.t, it.t);
        return ov >= Math.min(r.b - r.t, it.b - it.t) * 0.5;
      });
      if (row) { row.items.push(it); row.t = Math.min(row.t, it.t); row.b = Math.max(row.b, it.b); } else rows.push({ t: it.t, b: it.b, items: [it] });
    }
    for (const row of rows) {
      row.items.sort((a, b) => a.l - b.l);
      let reach = row.items[0].r;
      for (let i = 1; i < row.items.length; i++) {
        const it = row.items[i];
        const gap = it.l - reach;
        if (gap > 3 * Math.max(it.fs, 12)) return { gap: Math.round(gap), between: [row.items[i - 1].s, it.s] };
        reach = Math.max(reach, it.r);
      }
    }
    return null;
  }

  function nonInlineInside(transWrap) {
    const bad = [];
    for (const n of transWrap.querySelectorAll('*')) {
      if (n.closest('ul, ol') && n.closest('ul, ol') !== transWrap) continue;
      if (n.tagName === 'BR' || n.tagName === 'WBR') continue;
      if (n.closest('[data-kct-atomic]')) continue; // original box kept in place as an atomic token
      if (n.classList.contains('kct-flex-run')) continue; // one flex/grid item holding a whole translated run
      // Atomic tokens (formulas, code) are restored as clones of the original; their inner layout is theirs.
      if (n.closest('math, .mwe-math-element, .katex, .MathJax, mjx-container')) continue;
      const d = getComputedStyle(n).display;
      if ((d.startsWith('inline') && !/flex|grid/.test(d)) || d === 'contents' || d === 'none') continue;
      // A box is only a problem when translated prose sits directly in it (one sentence split into cells).
      const ownLetters = [...n.childNodes].some((c) => c.nodeType === 3 && /\p{L}/u.test(c.nodeValue));
      if (!ownLetters) continue;
      bad.push(`${n.tagName.toLowerCase()}[${d}]`);
    }
    return bad;
  }

  // Dominant typography (font-size + weight carrying the most letters) of a subtree.
  function dominantStyle(root) {
    const tally = new Map();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = walker.nextNode())) {
      const n = (t.nodeValue.match(/\p{L}/gu) || []).length;
      if (!n || !t.parentElement) continue;
      let hidden = false;
      for (let c = t.parentElement; c && c !== root; c = c.parentElement) {
        const cs = getComputedStyle(c);
        if ((cs.display === 'none' && !c.classList.contains('kct-orig-wrap')) || cs.clip.startsWith('rect(0')) { hidden = true; break; }
      }
      if (hidden) continue;
      const cs = getComputedStyle(t.parentElement);
      const key = `${Math.round(parseFloat(cs.fontSize))}px/${cs.fontWeight >= 600 ? 'bold' : 'normal'}`;
      tally.set(key, (tally.get(key) || 0) + n);
    }
    let best = '';
    let max = 0;
    for (const [k, v] of tally) if (v > max) { max = v; best = k; }
    return best;
  }

  // Letters actually rendered inside a subtree (skips display:none and clipped screen-reader text).
  function renderedLetters(root) {
    let n = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = walker.nextNode())) {
      const p = t.parentElement;
      if (!p) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      if (!range.getClientRects().length) continue; // text node itself not rendered
      // MathML text can report rects even under a display:none ancestor; check ancestors explicitly.
      let hiddenAncestor = false;
      for (let c = p; c && c !== root; c = c.parentElement) {
        if (c.classList.contains('kct-orig-wrap')) continue;
        const acs = getComputedStyle(c);
        // display:none, or clipped screen-reader-only text (e.g. Wikipedia's .mwe-math-mathml-a11y)
        if (acs.display === 'none' || /^rect\((0|1px)/.test(acs.clip) || acs.opacity === '0') { hiddenAncestor = true; break; }
      }
      if (hiddenAncestor) continue;
      const cs = getComputedStyle(p);
      if (cs.visibility === 'hidden' || cs.clip.startsWith('rect(0') || cs.clip.startsWith('rect(1px')) continue;
      const m = t.nodeValue.match(/[\p{L}\p{N}]/gu);
      if (m) n += m.length;
    }
    return n;
  }

  const MEDIA_SELECTOR = 'img, svg, picture, video, canvas, iframe, input, select, textarea, button, [data-corpus-media]';
  function renderedMedia(root) {
    let n = 0;
    for (const m of root.querySelectorAll(MEDIA_SELECTOR)) {
      if (m.closest('svg') && m.tagName.toLowerCase() !== 'svg') continue;
      const cs = getComputedStyle(m);
      if (cs.visibility === 'hidden') continue;
      if (m.getClientRects().length) n += 1;
    }
    return n;
  }
  function verbatimTexts(root) {
    return [...root.querySelectorAll('[translate="no"], .notranslate')].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim()).filter(Boolean);
  }

  // Text a reader can see (skips display:none, visibility:hidden and clipped screen-reader text).
  function visibleText(root) {
    let out = '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = walker.nextNode())) {
      let hidden = false;
      for (let c = t.parentElement; c && c !== root.parentElement; c = c.parentElement) {
        if (c.classList.contains('kct-orig-wrap')) continue;
        const cs = getComputedStyle(c);
        if (cs.display === 'none' || cs.visibility === 'hidden' || /^rect\((0|1px)/.test(cs.clip)) { hidden = true; break; }
      }
      if (!hidden) out += t.nodeValue;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  globalThis.runCorpusCheck = async function runCorpusCheck(opts = {}) {
    const SA = globalThis.KCTSiteAnalyzer;
    const R = globalThis.KCTRenderer;
    const scope = opts.scope || 'course';
    const html = document.documentElement;
    html.classList.add('kct-active', 'kct-mode-replace');

    const t0 = performance.now();
    const roots = SA.findContentRoots(scope);
    const candidates = SA.collectUniversalCandidateElements(roots, scope, new WeakMap());
    const collectMs = Math.round(performance.now() - t0);

    const totalLetters = roots.reduce((n, r) => n + visibleLetterCount(r), 0);
    const scrollW0 = document.documentElement.scrollWidth;

    const jobs = [];
    for (const el of candidates) {
      const { text, placeholders, nestedListEl } = SA.extractBlockContent(el);
      if (!SA.shouldTranslateText(text, 'zh-TW')) continue;
      jobs.push({ el, text, placeholders, nestedListEl, merged: sideBySideCells(el), lettersBefore: renderedLetters(el), mediaBefore: renderedMedia(el), verbatim: verbatimTexts(el), styleBefore: dominantStyle(el), links: [...el.querySelectorAll('a[href]')].filter((a) => a.getClientRects().length > 0).map((a) => a.href) });
    }

    const issues = { merged: [], nonInline: [], linkLost: [], styleLost: [], contentLost: [], contentGained: [], mediaLost: [], verbatimLost: [], nested: [], rescanNew: [], fallback: [], expectMissed: [] };
    // Expectation probes are read BEFORE rendering (moving nodes changes parent-scoped CSS).
    const expectProbes = new Map();
    for (const e of document.querySelectorAll('[data-expect="translated"]')) expectProbes.set(e, visibleText(e).slice(0, 12));
    const hostSet = new Set(jobs.map((j) => j.el));
    for (const j of jobs) {
      let crossedList = false;
      for (let cur = j.el.parentElement; cur; cur = cur.parentElement) {
        if (cur.tagName === 'UL' || cur.tagName === 'OL') crossedList = true;
        // An LI host renders only up to its nested list; items in that list are separate units.
        if (hostSet.has(cur) && !(cur.tagName === 'LI' && crossedList)) { issues.nested.push({ tag: j.el.tagName, outer: cur.tagName, sample: j.text.slice(0, 50) }); break; }
      }
    }
    let unitLetters = 0;
    for (const job of jobs) {
      const typo = SA.probeTypography(job.el);
      R.applyBlockTranslation({ el: job.el, zh: fakeTranslate(job.text), placeholders: job.placeholders, nestedListEl: job.nestedListEl, typo }, {}, null);
      unitLetters += (job.text.replace(TOKEN_RE, '').match(/\p{L}/gu) || []).length;
      const sample = job.text.replace(TOKEN_RE, '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (job.merged) issues.merged.push({ tag: job.el.tagName, ...job.merged, sample });
      const transWrap = job.el.querySelector(':scope > .kct-trans-wrap');
      if (!transWrap) continue;
      const fb = job.el.getAttribute('data-kct-structure-fallback') === '1';
      if (fb) issues.fallback.push({ tag: job.el.tagName, sample });
      const origWrap = job.el.querySelector(':scope > .kct-orig-wrap');
      if (!fb && origWrap) {
        const before = job.styleBefore; // measured in the original position, before any wrapper existed
        const after = dominantStyle(transWrap);
        if (before && after && before !== after) issues.styleLost.push({ tag: job.el.tagName, before, after, sample });
      }
      // Everything that was visible in the host must still be visible after rendering (1:1 fake translation).
      const lettersAfter = renderedLetters(job.el);
      if (!fb && job.lettersBefore > 0 && lettersAfter < job.lettersBefore * 0.9) {
        issues.contentLost.push({ tag: job.el.tagName, before: job.lettersBefore, after: lettersAfter, sample });
      }
      if (!fb && lettersAfter > job.lettersBefore * 1.1 + 2) {
        issues.contentGained.push({ tag: job.el.tagName, before: job.lettersBefore, after: lettersAfter, sample });
      }
      const mediaAfter = renderedMedia(job.el);
      if (mediaAfter < job.mediaBefore) issues.mediaLost.push({ tag: job.el.tagName, before: job.mediaBefore, after: mediaAfter, sample });
      if (!fb) {
        const tText = transWrap.textContent;
        const missing = job.verbatim.filter((v) => !tText.includes(v));
        if (missing.length) issues.verbatimLost.push({ tag: job.el.tagName, missing, sample });
      }
      const bad = nonInlineInside(transWrap);
      if (bad.length) issues.nonInline.push({ tag: job.el.tagName, bad: bad.slice(0, 4), sample });
      if (!fb && !job.el.closest('a[href]')) {
        const visible = new Set([...transWrap.querySelectorAll('a[href]')].map((a) => a.href));
        if (job.links.some((h) => !visible.has(h))) issues.linkLost.push({ tag: job.el.tagName, sample });
      }
    }
    const overflow = document.documentElement.scrollWidth - scrollW0;
    const rendered = new WeakMap();
    for (const j of jobs) rendered.set(j.el, 'done');
    const again = SA.collectUniversalCandidateElements(SA.findContentRoots(scope), scope, rendered);
    for (const el of again) {
      if (el.hasAttribute('data-kct-has-trans')) continue;
      if (el.querySelector('[data-kct-has-trans]') || el.closest('[data-kct-has-trans]')) {
        issues.rescanNew.push({ tag: el.tagName, sample: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 50) });
      }
    }

    // Hand-written expectations (tests/corpus/fixtures): every [data-expect="translated"] element must
    // be covered by a unit; data-expect-unit="self" means it must BE the unit host (not split).
    const expectMissed = [];
    for (const e of document.querySelectorAll('[data-expect="translated"]')) {
      const probe = expectProbes.get(e) || '';
      const hosts = jobs.filter((j) => j.el === e || j.el.contains(e) || e.contains(j.el));
      const covered = hosts.some((j) => j.text.replace(TOKEN_RE, '').replace(/\s+/g, ' ').includes(probe));
      const selfOk = e.getAttribute('data-expect-unit') !== 'self' || hosts.some((j) => j.el === e || (e.contains(j.el) && j.text.replace(TOKEN_RE, '').replace(/\s+/g, ' ').trim().length >= e.textContent.replace(/\s+/g, ' ').trim().length * 0.8));
      if (!covered || !selfOk) expectMissed.push({ tag: e.tagName, why: !covered ? 'not translated' : 'split into pieces', sample: probe });
    }
    issues.expectMissed = expectMissed;

    return {
      units: jobs.length,
      candidates: candidates.length,
      coverage: totalLetters ? Math.round((unitLetters / totalLetters) * 1000) / 1000 : 0,
      collectMs,
      overflow: overflow > 2 ? overflow : 0,
      unitSamples: jobs.map((j) => j.el.tagName + ':' + j.text.replace(TOKEN_RE, '').replace(/\s+/g, ' ').trim().slice(0, 50)),
      counts: Object.fromEntries(Object.entries(issues).map(([k, v]) => [k, v.length])),
      issues: Object.fromEntries(Object.entries(issues).map(([k, v]) => [k, v.slice(0, 6)]))
    };
  };
})();
