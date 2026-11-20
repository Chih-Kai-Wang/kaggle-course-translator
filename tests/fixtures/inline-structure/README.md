# Inline-structure regression fixture (no API calls)

Checks that translations never silently drop links or emphasis:

- `keep` mode: a fake translator keeps every `[[C#]]/[[M#]]/[[L#]]` token and paired `[[A#]]…[[/A#]]`, `[[S#]]…[[/S#]]` tag → links and bold must survive in the translation.
- `drop` mode: the fake translator loses every token → the block must either keep its link through `resolveInlineHost` or render with `data-kct-structure-fallback="1"` (original stays visible and clickable).

Run (from the repository root):

```bash
python3 -m http.server 8778 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8778/tests/fixtures/inline-structure/index.html` in a browser and run in the console:

```js
for (const f of ['../../../shared/config.js', '../../../content/site-analyzer.js', '../../../content/renderer.js', 'run.js']) {
  await new Promise((ok, bad) => { const s = document.createElement('script'); s.src = f; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
}
console.table(await runInlineFixture());
```

Every row must have `linkOk: true`; rows with `fallback: false` and an original `<b>` must have `boldKept: true`.
