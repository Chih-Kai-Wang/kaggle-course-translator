# NativeRead (原版美感 AI 網頁與 PDF 翻譯) — Claude 接手文件 (Handoff Guide)

## 1. 專案基本資訊與路徑
- **本機專案資料夾（Active Workspace）**：
  `/Users/wangzhikai/.gemini/antigravity/scratch/native-read`
- **GitHub 遠端倉庫**：
  `https://github.com/Chih-Kai-Wang/native-read`（分支：`main`，最新 Tag：`v2.2.0`，HEAD：`ed1898f`）
- **GitHub Pages 線上部署網址（手機版 PWA / Userscript / Android 安裝包）**：
  - 手機版 PWA App：`https://chih-kai-wang.github.io/native-read/`
  - 全平台 Userscript（iOS Safari / Android）：`https://chih-kai-wang.github.io/native-read/nativeread.user.js`
  - Android 擴充瀏覽器安裝包（Lemur / Kiwi / Edge / Firefox）：`https://chih-kai-wang.github.io/native-read/nativeread-android-extension.zip`
- **本機測試瀏覽器環境（Ego Lite Chromium）**：
  - 已載入未封裝擴充功能路徑：`/Users/wangzhikai/.gemini/antigravity/scratch/native-read`
  - Extension ID：`ckeknfhpandgmippabbfkndmndainpff`
  - 已在本機 `chrome.storage.local`（`kct_settings_v1`）配置好使用者的 Gemini Tier 1 API Key 與預設模型 `gemini-3.5-flash-lite`（**注意：切勿在終端機或日誌印出原始 API Key**）。

---

## 2. 產品核心設計原則（使用者明確要求，後續修改務必遵守）
1. **預設靜默、手動觸發（Zero Auto-Translate by Default）**：
   - `manifest.json` **不包含任何靜態 `content_scripts`**。
   - 開啟任何網站（包含 Kaggle、Wikipedia、MDN、Google Drive 等）預設 **0 注入、0 懸浮球、0 API 呼叫**。
   - 只有在使用者點擊擴充彈窗「立即翻譯此頁面」、按下快捷鍵 `Alt+T`、使用右鍵選單，或將特定網域加入「單站白名單（`autoTranslateHosts`）」時，才由 `background/service-worker.js` 透過 `chrome.scripting` 動態注入。
2. **原版美感排版（Native-Feel Typography & Layout）**：
   - 保留原網站西文字體在最前方，自動剝離尾部通用字族（`sans-serif` / `serif` / `monospace`），再依區塊字體基因（`serif` / `sans` / `mono`）配對目標語言母語字體（如繁中 `Noto Serif TC` / `PingFang TC` / `JetBrains Mono`）。
   - DOM 寫入嚴格只使用 `document.createTextNode`（**零 `innerHTML` 注入**），保護行內 `<code>`、KaTeX/MathJax 公式與 `<a>` 超連結可點擊性。
3. **極速低成本串流架構（SSE + NDJSON + 思考強度控制 + 視口優先）**：
   - 模型思考強度預設為 `fastest`（自動設定 Gemini 2.5 `thinkingBudget: 0` / Gemini 3 `thinkingLevel: "MINIMAL"` 或 OpenAI `reasoning_effort: "low"`），把延遲與 Token 成本降到最低。
   - 採用 `kct-stream` 長連線 Port + NDJSON 逐行串流（收到一行 `{"k":"...","v":"..."}` 立即推送前端透過 `requestAnimationFrame` 微批次上屏）。
   - 視口優先 `IntersectionObserver`（`rootMargin: 600px`），只先翻譯螢幕可見區域，往下捲動才動態載入。
   - 持久化快取採用 IndexedDB（`shared/cache-db.js`，資料庫 `kct_cache_db_v2`，容量 20,000 筆 LRU）。
4. **全網站與 PDF 白皮書通吃（無特殊網站硬編碼拆分）**：
   - `content/site-analyzer.js` 採用雙階段通用掃描（Pass 1 語意區塊 `p, h1..h6, li, td, blockquote...` + Pass 2 現代 SPA `div, span, a, label` 安全葉子文字節點）。
   - `content/code-overlay.js` 統一處理所有網站的 `<pre><code>` 與 CodeMirror 6 程式碼 `#` 註解翻譯（不將 Jupyter Notebook 拆成特殊分支）。
   - 支援兩種類型的 PDF 原版翻譯：
     1. **內建本機 PDF.js 閱讀器（`viewer/pdf-viewer.html`）**：支援直接開啟 `.pdf` 網址、arXiv 論文、本機 `.pdf` 檔案，或從彈窗一鍵將 Google Drive PDF 轉為串流下載載入；具備雙欄論文切欄、單頁畫布底色與字色取樣、原位覆蓋（Overlay）與雙欄對照（Split）模式。
     2. **Google 雲端硬碟 PDF 檢視器（`drive.google.com/file/d/.../view`）頁內原位翻譯**：自動識別 `.ndfHFb-c4YZDc-cYSp0e-DARUcf-Df1ZY-bN97Pc-haAclf` 隱藏文字層，依座標合併單行 `<p>` 為完整段落、將圖層提至 `z-index: 2; opacity: 1`，並對該頁 `blob:` 圖片取樣底色與墨色進行原位字級自適應覆蓋。
5. **手機全平台支援（Android & iOS）**：
   - 支援三種手機使用方式：手機獨立 PWA（`docs/`）、全平台 Userscript（`docs/nativeread.user.js`）、Android 擴充瀏覽器安裝包（`docs/nativeread-android-extension.zip`）。
   - 電腦端設定頁（`options/options.html`）內建 100% 純本機 Canvas ISO/IEC 18004 QR Code 產生器與 `#nr_sync=<base64url>` 零打字金鑰同步。

---

## 3. 檔案結構與模組職責

```text
/Users/wangzhikai/.gemini/antigravity/scratch/native-read/
├── manifest.json                 # MV3 設定檔 (v2.2.0，動態 scripting 注入，無靜態 content_scripts)
├── shared/
│   ├── config.js                 # KCTConfig：模型預設集、語系字體表、Endpoint/Thinking 解析、URL/PDF/GDrive 判斷、Settings 讀寫
│   └── cache-db.js               # KCTCacheDB：IndexedDB 20,000 筆 LRU 翻譯快取 + storage.local 舊快取自動遷移
├── background/
│   └── service-worker.js         # MV3 背景服務：SSE+NDJSON 串流翻譯、429 自適應限流佇列、ensureInjected 動態注入、右鍵選單、Alt+T、#nr_sync 攔截
├── content/
│   ├── site-analyzer.js          # KCTSiteAnalyzer：Readability 主文探測、Pass 1+Pass 2 通用 DOM 掃描、Google Drive PDF 文字層段落合併、字體基因探測
│   ├── code-overlay.js           # KCTCodeOverlay：通用 <pre> 程式碼註解覆蓋、CodeMirror 6 註解浮層、執行輸出區「譯」按鈕
│   ├── renderer.js               # KCTRenderer：零 innerHTML 節點渲染、原版字體配對、Google Drive PDF 圖片底色/墨色取樣與字級縮放
│   ├── content.css               # 頁面排版樣式（替換/原文/雙語模式、字體變數、Google Drive PDF 覆蓋層樣式）
│   └── content.js                # 內容腳本主控：IntersectionObserver 視口懶載入、kct-stream Port 串流、Shadow DOM 懸浮球（含手機觸控拖曳）、手機長按選字翻譯
├── popup/
│   ├── popup.html / popup.css    # 擴充彈窗 UI（含手機全螢幕分頁響應式排版）
│   └── popup.js                  # 彈窗控制邏輯（單站白名單、思考強度、模式切換、一鍵開啟 PDF 閱讀器）
├── options/
│   ├── options.html / options.css# 進階設定頁 UI
│   └── options.js                # API 測試、IndexedDB 快取管理、純本機 ISO/IEC 18004 QR Code 編碼器與 #nr_sync 手機同步連結產生器
├── viewer/
│   ├── pdf-viewer.html           # 內建 PDF.js 原版翻譯閱讀器頁面
│   ├── pdf-viewer.css            # PDF 閱讀器樣式（含 <=768px 手機 Fit-Width 與垂直雙欄對照響應式設計）
│   └── pdf-viewer.js             # PDF 幾何段落重組（雙欄切欄）、畫布底色取樣、原位覆蓋字級自適應、SSE 串流翻譯
├── vendor/
│   └── pdfjs/                    # 本地打包 pdfjs-dist@4.10.38 (pdf.min.mjs + pdf.worker.min.mjs，Apache-2.0，isEvalSupported: false)
├── scripts/
│   └── build-mobile.js           # 手機建置腳本：將 shared/* + content/* 打包為 docs/nativeread.user.js 與 docs/nativeread-android-extension.zip
└── docs/                         # GitHub Pages 靜態部署目錄 (https://chih-kai-wang.github.io/native-read/)
    ├── index.html / app.css / app.js  # 手機版獨立 PWA App（支援手機直接開 PDF 白皮書原位翻譯 + 網頁/文字串流翻譯 + #nr_sync 自動匯入）
    ├── manifest.webmanifest / sw.js   # PWA 安裝清單與離線快取 Service Worker
    ├── nativeread.user.js             # 自動產生的單檔通用 Userscript (勿手動編輯，由 scripts/build-mobile.js 產生)
    └── nativeread-android-extension.zip # 自動產生的 Android 擴充安裝包
```

---

## 4. 常用開發、建置與驗證指令

### A. 修改 `shared/`、`content/`、`popup/`、`options/`、`viewer/` 後重建手機版產物
只要修改了擴充功能核心程式碼，請執行以下指令同步更新 `docs/nativeread.user.js` 與 `docs/nativeread-android-extension.zip`：
```bash
cd /Users/wangzhikai/.gemini/antigravity/scratch/native-read
node scripts/build-mobile.js
```

### B. 語法與敏感資訊檢查
```bash
cd /Users/wangzhikai/.gemini/antigravity/scratch/native-read
for f in shared/*.js background/*.js content/*.js popup/*.js options/*.js viewer/*.js scripts/*.js docs/app.js docs/sw.js docs/nativeread.user.js; do
  node --check "$f" || exit 1
done
```

---

## 5. 目前完成狀態與後續可延伸方向
- **目前狀態**：
  - `v2.0.0`（全網站按需注入 + SSE 串流 + 原版字體配對 + IndexedDB 快取）✅ 已完成並實測通過
  - `v2.1.0`（更名 NativeRead + 通用 SPA 葉子節點遍歷 + 內建 PDF.js 原版翻譯閱讀器）✅ 已完成並實測通過
  - `v2.2.0` + `ed1898f`（手機觸控 UI + PWA + Userscript + Android 擴充包 + 本機 QR Code `#nr_sync` 同步 + Google Drive PDF 檢視器頁內原位段落合併與底色/墨色取樣覆蓋）✅ 已完成、推送至 GitHub 並於實機驗證通過
- **接手提示**：
  - 若使用者回報特定網站或特定 PDF 版面微調需求，可直接查看：
    - 網頁 DOM 擷取與 Google Drive PDF 段落合併：`content/site-analyzer.js`（`collectUniversalCandidateElements`、`preparePdfOverlayLayers`）
    - 網頁與 Google Drive PDF 渲染與取樣：`content/renderer.js`（`applyBlockTranslation`、`samplePdfImageColors`、`styleAndFitPdfOverlayBlock`）
    - 獨立 PDF 閱讀器段落重組與渲染：`viewer/pdf-viewer.js`（`extractPageParagraphs`、`renderOverlayBlocks`）
    - 手機 PWA 與 Userscript 打包：`docs/app.js`、`scripts/build-mobile.js`
