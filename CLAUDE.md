# CLAUDE.md — NativeRead Project Context & Handoff Instructions

Please read **`HANDOFF.md`** in this directory FIRST. It contains:
1. **Gemini 4 Neon / Carbon / Hydrogen & Thinking Effort Allocation Table (§0)**:
   - **`Gemini 4 Neon` (`Medium`, or `High` only for complex root-cause debugging)**: Use for main orchestration, `ego-browser` live visual/geometric verification (Step 3), and authoring the master English/Traditional Chinese technical architecture READMEs (Step 1A).
   - **`Gemini 4 Carbon` (`Medium`)**: Use for targeted single-file code edits and edge-case fixes (e.g., Step 2 `docs/app.js` remote PDF CORS timeout & Google Drive URL resolution, or any fix after live browser testing).
   - **`Gemini 4 Hydrogen` (`Low` / `Minimal`)**: Use for high-throughput parallel translation of the remaining 6 README languages (`zh-CN`, `ja`, `ko`, `es`, `fr`, `de` in Step 1B) and fast static syntax/link/build checks (`node --check`, `node scripts/build-mobile.js`).
2. **Completed Milestones (M1–M5, R4 On-Demand Vision Image Overlay backend + frontend, M6 core fixes)** — all 14 JS files in the repo already include these changes and pass `node --check`.
3. **Remaining 3-Step Checklist to Finish**:
   - **Step 1 (M7)**: Create the 8-language dual-purpose Product + Technical Architecture + Security README suite (`README.md`, `README.zh-TW.md`, `README.zh-CN.md`, `README.ja.md`, `README.ko.md`, `README.es.md`, `README.fr.md`, `README.de.md`) and re-run `node scripts/build-mobile.js`.
   - **Step 2 (M6 polish)**: Add `resolvePdfSourceUrl` + fast timeout/CORS fallback guidance to `loadPdfFromUrl` in `docs/app.js`.
   - **Step 3 (Final Live Verification)**: Reload extension `ckeknfhpandgmippabbfkndmndainpff` in `ego-browser` and verify Popup/Options/PWA UI, Wikipedia Infobox, arXiv PDF, Google Drive PDF (Page 1 & Page 6), and R4 Vision Image Overlay on `/Users/wangzhikai/.gemini/antigravity/brain/e95f85c3-fc73-4733-b755-4d760c6c1a3e/.user_uploaded/media_1795192856884_40c9d866.jpg`.

## Critical Invariants
1. **Default silent (on-demand only)**: Never add static `content_scripts` to `manifest.json`; `autoTranslate` defaults to `false`.
2. **DOM safety**: Never assign unescaped translated strings via `innerHTML`; use `document.createTextNode` / `textContent`.
3. **Secret safety**: Never print, log, or commit raw API keys from `chrome.storage.local`.
4. **Browser session cleanup**: Always wrap `ego-browser nodejs` scripts in `try { ... } finally { await task.finish({ keep: [] }); }`.
5. **Rebuild mobile artifacts after any source/README change**:
   ```bash
   node scripts/build-mobile.js
   ```
