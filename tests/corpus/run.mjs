// Corpus driver (runs inside `ego-browser nodejs`; use tests/corpus/run.sh).
// Loads every snapshot in tests/corpus/pages/, injects the analyzer/renderer from SRC_BASE,
// runs check.js and writes tests/corpus/results/<label>.json.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = globalThis.CORPUS_ROOT;
const PORT = globalThis.CORPUS_PORT;
const SRC_BASE = globalThis.CORPUS_SRC || '';   // '' = working tree, else e.g. 'tests/corpus/.rev/2ac805b/'
const LABEL = globalThis.CORPUS_LABEL || 'working';
const ONLY = String(globalThis.CORPUS_ONLY || '').split(',').filter(Boolean);

const pagesDir = path.join(ROOT, 'tests', 'corpus', 'pages');
const fixturesDir = path.join(ROOT, 'tests', 'corpus', 'fixtures');
const listHtml = (dir, prefix) => (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
  .filter((f) => f.endsWith('.html')).map((f) => ({ id: f.replace(/\.html$/, ''), url: `${prefix}/${f}` }));
const pages = [...listHtml(fixturesDir, 'tests/corpus/fixtures'), ...listHtml(pagesDir, 'tests/corpus/pages')]
  .filter((p) => !ONLY.length || ONLY.includes(p.id));
const scripts = ['shared/config.js', 'content/site-analyzer.js', 'content/renderer.js'].map((p) => `/${SRC_BASE}${p}`).concat(['/tests/corpus/check.js']);

const task = await taskSpace('corpus run ' + LABEL);
const results = {};
try {
  const w = task.page('p1');
  for (const { id, url } of pages) {
    await w.goto(`http://127.0.0.1:${PORT}/${url}?t=${Date.now()}`);
    await w.waitForLoadState();
    await new Promise((r) => setTimeout(r, 1500));
    const res = await w.evaluate(async (scripts) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = scripts[0].replace(/shared\/config\.js$/, 'content/content.css');
      document.head.appendChild(css);
      for (const src of scripts) {
        await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src + '?t=' + Date.now(); s.onload = ok; s.onerror = () => bad(new Error('load ' + src)); document.head.appendChild(s); });
      }
      await new Promise((r) => setTimeout(r, 300));
      return await globalThis.runCorpusCheck({ scope: 'course' });
    }, scripts);
    results[id] = res;
    const c = res.counts;
    console.log(`${id.padEnd(24)} units ${String(res.units).padStart(4)} cov ${res.coverage.toFixed(3)} ` + Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' ') + `${res.overflow ? ' overflow ' + res.overflow : ''}  ${res.collectMs}ms`);
  }
} finally {
  await task.finish({ keep: [] });
}
const outDir = path.join(ROOT, 'tests', 'corpus', 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${LABEL}.json`), JSON.stringify(results, null, 2));
