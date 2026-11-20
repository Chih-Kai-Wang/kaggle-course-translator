// Runs in page: extraction + fake translators + render + invariant checks
async function runInlineFixture() {
  const SA = globalThis.KCTSiteAnalyzer, R = globalThis.KCTRenderer;
  document.documentElement.classList.add('kct-active', 'kct-mode-replace');
  const results = [];
  const roots = [document.querySelector('article')];
  const blocks = SA.collectUniversalCandidateElements(roots, 'all', new WeakMap());
  const fake = (text, mode) => {
    // "keep": translate words but keep every token; "drop": lose all paired/atomic tokens
    const translated = text.split(/(\[\[\s*\/?[CMLAS]\d+\s*\]\])/g)
      .map((seg) => /^\[\[/.test(seg) ? seg : seg.replace(/[A-Za-z][A-Za-z ,.'-]*/g, (w) => '譯' + w.trim().length))
      .join('');
    return mode === 'keep' ? translated : R.stripAllTokens(translated);
  };
  // Layout rows (flex/grid cells) must never be merged into one translation unit.
  for (const el of blocks) {
    const t = el.textContent;
    const merged = /Looking for teammates/.test(t) && /32 comments/.test(t);
    results.push({ mode: 'layout', host: el.tagName, text: t.trim().slice(0, 70), fallback: false, linkOk: !merged, hostIsLink: false, boldKept: null });
  }
  for (const mode of ['keep', 'drop']) {
    for (const el of blocks) {
      if (el.hasAttribute('data-kct-has-trans')) continue;
      const before = { links: [...el.querySelectorAll('a[href]')].map(a => a.href).concat(el.matches('a[href]') ? [el.href] : []), boldInside: !!el.closest('b,strong') || !!el.querySelector('b,strong') };
      const { text, placeholders, nestedListEl } = SA.extractBlockContent(el);
      const zh = fake(text, mode);
      R.applyBlockTranslation({ el, zh, placeholders, nestedListEl, typo: null }, {}, null);
      const trans = el.querySelector(':scope > .kct-trans-wrap');
      const fallback = el.getAttribute('data-kct-structure-fallback') === '1';
      const visibleLinks = fallback
        ? [...el.querySelector(':scope > .kct-orig-wrap').querySelectorAll('a[href]')].map(a => a.href)
        : [...trans.querySelectorAll('a[href]')].map(a => a.href);
      const hostIsLink = !!el.closest('a[href]');
      const linkOk = hostIsLink || before.links.every(h => visibleLinks.includes(h));
      const transWeight = getComputedStyle(trans.firstChild?.nodeType === 1 ? trans.firstChild : trans).fontWeight;
      results.push({ mode, host: el.tagName, text: text.slice(0, 70), fallback, linkOk, hostIsLink, boldKept: before.boldInside ? (Number(getComputedStyle(trans).fontWeight) >= 600 || !!trans.querySelector('b,strong')) : null });
    }
    R.clearAllInjectedTranslations(null, null);
  }
  return results;
}
