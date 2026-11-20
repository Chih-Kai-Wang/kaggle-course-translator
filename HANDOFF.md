# NativeRead (原版美感 AI 網頁、PDF 與資訊圖表翻譯) — Claude 接手與續作指南 (Handoff Guide)

## 0. 模型與思考強度配置指南（Gemini 4 Neon / Carbon / Hydrogen & Thinking Effort Allocation）

使用者已授權在 Vertex AI 中調度 **`Gemini 4 Neon`**、**`Gemini 4 Hydrogen`**（以及視需要搭配 **`Gemini 4 Carbon`**）。為了在 **\$100 額度內達到最高品質與最低延遲／成本**，請嚴格依照下表分配各任務的模型與思考強度（Thinking Effort）：

### A. 任務級模型與思考強度分配表

| 任務階段 | 具體工作內容 | 指定模型 | 思考強度 (Thinking Effort) | 配置理由 |
| :--- | :--- | :--- | :--- | :--- |
| **1. 主控協調與實機視覺／幾何驗收**<br>*(Step 3: Live Browser Audit)* | 驅動 `ego-browser` 實測 Wikipedia Infobox、arXiv 雙欄 PDF、Google Drive PDF (P.1 & P.6)、**R4 工程圖表原位覆蓋**與手機 PWA (`390x844`)；檢視截圖與 DOM 幾何邊界 | **`Gemini 4 Neon`** | **`Medium`**<br>*(若遇複雜跨檔幾何／競態 Bug 診斷時升至 **`High`**)* | `Neon` 具備最強的多模態視覺檢視與跨檔架構推理能力；日常巡檢用 `Medium`，僅在需要深度根因推導時開 `High`。 |
| **2. 程式碼精準修補與邊界加固**<br>*(Step 2: M6 `docs/app.js` & 實測微調)* | 為 `docs/app.js` `loadPdfFromUrl` 補上 Google Drive URL 轉換與 15 秒 CORS 逾時提示，以及實測中發現的局部 JS/CSS 修補 | **`Gemini 4 Carbon`**<br>*(或 `Gemini 4 Neon`)* | **`Medium`** | 局部單檔邏輯與 UI 狀態機修補不需要 `Neon (High)`，使用 `Carbon (Medium)`（或 `Neon (Low/Medium)`）即可精準完成且大幅節省額度。 |
| **3. 技術規格母本定稿**<br>*(Step 1A: `README.md` (en) & `README.zh-TW.md`)* | 撰寫含本地零延遲決策模型、雙軌 PDF 幾何切欄、R4 多模態圖片覆蓋與安全架構的英文／繁中母本 README | **`Gemini 4 Neon`**<br>*(或 `Gemini 4 Carbon`)* | **`Medium`** | 母本需精準對照程式碼實作細節與演算法參數，`Medium` 思考強度可確保架構圖與技術描述零誤差。 |
| **4. 多語系 README 平行擴展**<br>*(Step 1B: `zh-CN`, `ja`, `ko`, `es`, `fr`, `de` 共 6 檔)* | 基於已定稿的母本 README，平行生成其餘 6 國語言版本（保持章節、表格、相對連結與跨語言切換列 100% 同步） | **`Gemini 4 Hydrogen`** | **`Low`** | 當技術結構與內容已由母本鎖定後，多語系轉換屬於高吞吐平行生成任務，用 `Hydrogen (Low)` 速度最快、成本最低且母語流暢度極佳。 |
| **5. 語法檢查、連結驗證與打包**<br>*(Static Checks & `build-mobile.js`)* | 執行 `node --check`、`node scripts/build-mobile.js`、8 語系交叉連結檢查與敏感金鑰掃描 | **`Gemini 4 Hydrogen`** | **`Minimal` / `Low`** | 確定性工具呼叫與輸出檢查不需要額外推理鏈，設為 `Minimal` / `Low` 零思考延遲最省額度。 |

### B. 調度原則（給 Claude Code 的執行守則）
1. **避免全員開 `Neon (High)`**：切勿把平行子代理（如 6 語系文件翻譯或靜態檢查）全部掛在 `Neon (High)` 上，否則會快速消耗額度並觸發 RPM/TPM 限流。
2. **「母本用 Neon/Carbon (Medium) → 扇出用 Hydrogen (Low) → 實機視覺驗收用 Neon (Medium/High)」**：這是最能發揮 `Neon` + `Carbon` + `Hydrogen` 三階組合效益的黃金管線。
3. **瀏覽器內擴充功能本身（NativeRead 執行期翻譯與 R4 圖片視覺翻譯）**：
   - 本機 Ego Lite 瀏覽器（Extension ID：`ckeknfhpandgmippabbfkndmndainpff`）的 `chrome.storage.local`（`kct_settings_v1`）已設定好使用者的 Gemini API Key 與 `gemini-3.5-flash-lite`（`thinkingEffort: "fastest"`）。**請直接沿用，切勿印出或覆蓋原始 API Key。**

---

## 1. 專案基本資訊與環境路徑
- **本機專案根目錄（Active Workspace）**：
  `/Users/wangzhikai/.gemini/antigravity/scratch/native-read`
- **GitHub 遠端倉庫**：
  `https://github.com/Chih-Kai-Wang/native-read`（GitHub Pages：`https://chih-kai-wang.github.io/native-read/`）
- **本機測試瀏覽器（Ego Lite Chromium）**：
  - Unpacked Extension ID：`ckeknfhpandgmippabbfkndmndainpff`
  - 自動化 CLI：`export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH" && ego-browser skill`
  - **重要規範**：不可同時並行跑兩個 `ego-browser` session；每次執行 `ego-browser nodejs` 必須在 `try { ... } finally { await task.finish({ keep: [] }); }` 中關閉工作空間，避免遺留分頁。
- **手機端打包腳本**：
  `node scripts/build-mobile.js`（會自動由 `shared/` + `content/` 產生 `docs/nativeread.user.js` 並將擴充功能與所有 `README*.md` 打包進 `docs/nativeread-android-extension.zip`）。

---

## 2. 已完成並驗證落盤的項目（M1–M5、R4 前後端、M6 核心皆已就緒，全數通過 `node --check`）

目前工作目錄中的所有 14 支核心 JS 檔案均已修改完成並通過 `node --check` 與 `node scripts/build-mobile.js`：

### ✅ M1：核心安全、真正 LRU 快取、韌性串流傳輸 ＋ R4 圖片視覺翻譯背景引擎
- `shared/config.js` & `shared/cache-db.js`：
  - `kct_cache_db_v2` 實作真正的 20,000 筆 **LRU 淘汰機制**（讀取命中時節流更新 `ts` 時間戳，容量滿時依 `ts` 索引淘汰最久未用項目）。
  - 新增 `isFilePdfUrl`、`extractGoogleDriveFileId`、`resolvePdfSourceUrl`（自動將 Google Drive `/file/d/<ID>/view` 轉為可串流下載 URL）。
- `background/service-worker.js`：
  - **`#nr_sync` 來源與負載安全鎖定**：僅允許來自受信任的官方 PWA（`https://chih-kai-wang.github.io/native-read/*`）與擴充自身頁面自動匯入 `#nr_sync`，防止第三方惡意網頁透過 `#nr_sync` 竄改 `baseUrl` 竊取既有 API Key。
  - **韌性 SSE / NDJSON 與多物件 JSON Fallback**：支援 `[[C#]]`、`[[M#]]`、`[[L#]]` 佔位符保護，修補 `extractJsonObject` 避開前言方括號 `[2]` 誤判，並強化跨頁框 429 自適應冷卻排程。
  - **R4 按需圖片／資訊圖表視覺翻譯背景引擎（`kct-translate-image` + `TRANSLATE_IMAGE`）**：
    - 註冊右鍵選單 `NativeRead 翻譯圖片文字`（`contexts: ['image']`），即使頁面未啟動全文翻譯也可單獨對圖片觸發。
    - 背景 `fetch` 圖片二進位資料（繞過頁面 Canvas CORS 限制），利用 `createImageBitmap` + `OffscreenCanvas` 自動縮放超大型圖片（`<= 1600px`）並於背景完成每個文字框 `[ymin, xmin, ymax, xmax]`（0–1000 座標）的**邊框背景色（`bg`）與最高對比文字墨色（`fg`）取樣**。
    - 單次多模態呼叫同時支援 Gemini 原生 `inlineData` 與 OpenAI 相容 `image_url`，結果寫入 `CacheDB`（`await CacheDB.putMany`）避免重複計費。

### ✅ M2 & M3：網頁／SPA 決策模型、行內公式／連結保護、真實明暗偵測、Google Drive PDF 雙欄原位覆蓋 ＋ R4 前端懸停覆蓋 UI
- `content/site-analyzer.js`：
  - `INLINE_PROTECT_SELECTOR` 擴充保護 `<math>`、`.mwe-math-element`、`sup.reference`（`[[M#]]`），且 `extractBlockContent` 對短識別碼／引用 `<a href>` 產生 `[[L#]]` 佔位符。
  - `findContentRoots` 自動保留 `#firstHeading / main h1`，支援 `BUTTON` 葉子節點，且在 Google Drive PDF 檢視器（`.ndfHFb-c4YZDc-cYSp0e-DARUcf`）固定回傳 `[document.body]` 確保**第 1 頁至第 51 頁全數納入掃描**。
  - `preparePdfOverlayLayers` 升級為**向前跨群組搜尋同欄（X 座標對齊）段落**，完美支援雙欄 Google Drive PDF，並計算每個段落框的 `nearestBelowTop` 安全高度上限（`safeHeight`）防止垂直重疊，同時保留目錄（TOC）引導點線（dot leader）偵測。
- `content/renderer.js` & `content/content.css`：
  - `buildTranslatedFragment` 原生還原 `[[C#]]`、`[[M#]]`、`[[L#]]` DOM 節點（**零 `innerHTML`**）。
  - `detectPageDarkBackground()` 根據頁面真實背景明度切換 `html.kct-page-dark`，移除無條件的 `@media (prefers-color-scheme: dark)` `:root` 覆蓋（解決深色系統下淺色網頁雙語字色變白的問題）。
  - 修復 Wikipedia `.infobox` 與資料表 `<th>` 被長網址擠成單字垂直列的問題（`min-width: 4.5em` + `td` `overflow-wrap: anywhere`）。
  - Google Drive PDF 覆蓋塊將 `box-shadow` 光暈收斂至 `2px`、預設 `overflow: hidden` 並在 `:hover` 時提升 `z-index: 30; height: auto; overflow: visible;`，且 `img._kctSamplePixels` 綁定 `img.currentSrc || img.src`。
  - **R4 圖片原位覆蓋渲染器（`renderImageVisionOverlay`、`refitAllImageVisionOverlays`、`clearAllImageVisionOverlays`）**：在圖片外層建立對齊的 `.kct-img-overlay-host` 與 `.kct-img-overlay-layer`，依 `[ymin, xmin, ymax, xmax]` 繪製原位譯文框、套用背景取樣之 `--kct-img-bg` / `--kct-img-fg` 與字級自適應縮放，保留原圖插畫與結構線條。
- `content/content.js`：
  - 實作 R4 大型內容圖片（`>= 200x140`，排除導覽列與 Google Drive PDF 頁面底圖）右上角懸停極簡按鈕（`譯圖` / `原圖` / `顯示譯圖`），並支援右鍵選單 `KCT_COMMAND` -> `TRANSLATE_IMAGE` 直接觸發。

### ✅ M4：內建 PDF.js 閱讀器引擎與介面精簡（`viewer/pdf-viewer.html`, `viewer/pdf-viewer.css`, `viewer/pdf-viewer.js`）
- 升級 X 軸投影雙欄／多欄閱讀順序切欄、修正作者欄與 `Abstract` 標題被合併的問題、保護數學公式避免裸露 `$...$` LaTeX 字串、加入畫布非背景墨水密度檢查防止文字框蓋到圖表（Figure/Table），修復雙欄對照（Split Mode）縮放與頁碼同步，並移除拖拽層與狀態列的冗長安全／快取技術字串。

### ✅ M5：Popup 與 Options 介面精簡美化（`popup/*`, `options/*`）
- `popup/` 高度壓縮至 `<= 600px`（`380x600` 視口零垂直捲軸），序列化 `saveSettings` 與 `flushCustomLang()` 防止競態。
- `options/` 移除所有安全／儲存位置／URL Fragment 冗長說明文字（移交 README）、在未點擊前隱藏 `#mobile-sync-box` 空白 QR 區域、移除裸露長網址換行、合併重複的儲存按鈕，並將進階引擎參數收合至 `<details>`。

### ✅ M6 核心：手機版 PWA 關鍵 Bug 修復與打包腳本更新（`docs/*`, `scripts/build-mobile.js`）
- 修復 `docs/app.css` `.nr-text-input` 在 `.nr-field` 垂直 flex 容器中因 `flex: 1 1 200px` 變成 **200px 巨大高度輸入框**的 Bug（現已修正為 `width: 100%; flex: none;`）。
- 修復 `docs/app.js` 缺少 `abortAllActiveRequests()` 導致切換語言時拋出 `ReferenceError` 的問題，並補上 `state.currentWebArticle` 賦值。
- 移除 `docs/index.html` 中的安全性與 CSP 技術文案，並將底部導覽列精簡為 4 字標籤（`PDF 閱讀` | `網頁翻譯` | `瀏覽器外掛` | `模型設定`），在 360–390px 手機螢幕不再截斷。
- 更新 `scripts/build-mobile.js` 自動將根目錄所有 `README*.md` 納入 `docs/nativeread-android-extension.zip`（並排除 `tests/`）。

---

## 3. 交給 Claude 接手完成的剩餘清單（Remaining Tasks Checklist）

請 Claude 依序完成以下 3 個收尾步驟：

### Step 1 — 撰寫 8 語系「產品介紹 ＋ 完整技術規格 ＋ 安全架構」README（Requirement R3 & R4）
使用者明確要求：**README 語言盡可能多（超越繁中、簡中、英文），同時作為產品介紹與技術文件說明，並承接從各 UI 移除的安全性說明**。
1. 建立並同步以下 **8 個語系檔案**（頂部均附跨語言切換列）：
   - `README.md`（English 主檔，或以繁中／英文為主並在頂部互相連結所有 8 語系）
   - `README.zh-TW.md`（繁體中文）
   - `README.zh-CN.md`（简体中文）
   - `README.ja.md`（日本語）
   - `README.ko.md`（한국어）
   - `README.es.md`（Español）
   - `README.fr.md`（Français）
   - `README.de.md`（Deutsch）
2. 每份 README 必須包含三大核心章節：
   - **一、產品功能與全平台快速上手（Product Overview & Quick Start）**：
     桌面擴充功能（預設靜默按需啟動 `Alt+T`）、內建 PDF.js 閱讀器、Google Drive PDF 頁內原位翻譯、**R4 網頁內嵌資訊圖表／圖片按需原位翻譯（右鍵或懸停「譯圖」）**、手機全平台支援（獨立 PWA App、iOS/Android 通用 Userscript、Android 擴充 ZIP、純本機 QR Code `#nr_sync` 一秒同步）。
   - **二、系統技術架構與本地決策模型（Technical Architecture & Local Decision Model）**：
     1. **本地零延遲決策模型（Zero-Latency Local Decision Tree — `content/site-analyzer.js`）**：Readability 密度評分與連結率懲罰、Pass 1 語意區塊＋Pass 2 現代 SPA 安全葉子節點雙階段掃描、開放式 Shadow DOM 穿透、行內保護區符記（`[[C#]]` 程式碼、`[[M#]]` KaTeX/MathJax/MathML/引用、`[[L#]]` 行內連結）、語系字元比例過濾（`shouldTranslateText`）與**字體基因配對（Font-Gene Pairing：剝離尾部通用字族、保留原站西文字體並配對母語 Serif/Sans/Mono）**。
     2. **雙軌 PDF 原版排版管線（Dual PDF Native Layout Pipelines）**：
        - 內建 PDF.js 閱讀器（`viewer/pdf-viewer.js`）：Span-to-Line 基線聚類、X 軸投影雙欄／多欄切欄、單次 `getImageData` 邊框底色與對比色取樣、下方畫布墨水密度防撞檢測、字級自適應縮放、原位覆蓋（Overlay）與雙欄對照（Split）雙模式。
        - Google Drive PDF 檢視器頁內覆蓋（`content/site-analyzer.js` + `content/renderer.js`）：`.ndfHFb-...` 隱藏文字層跨欄座標合併、TOC 目錄點線原生重建、`blob:` 頁面影像 x-height 與筆畫粗細光柵量測、底色／墨色取樣與防重疊高度夾制。
     3. **R4 按需多模態資訊圖表原位翻譯管線（On-Demand Multimodal Vision Image Overlay）**：
        嚴格按需觸發（絕不自動掃描全頁圖片）、背景 Service Worker 跨網域圖片擷取與 `OffscreenCanvas` 智慧降採樣、單次 Vision 結構化 `[ymin, xmin, ymax, xmax]`（0–1000）座標與譯文輸出、背景色與墨色取樣、保留插圖之原位覆蓋層。
     4. **極速串流、視口懶載入、限流與持久化 LRU 快取**：
        `kct-stream` 長連線 Port + SSE/NDJSON 逐行串流 + 15 項 `requestAnimationFrame` 微批次上屏、`ThinkingEffort`（`fastest` 零思考延遲預設）、`IntersectionObserver`（`rootMargin: 600px`）、跨頁框 429 自適應退避排程，以及 IndexedDB `kct_cache_db_v2` 20,000 筆真正 LRU 快取。
     5. **完整專案目錄樹**（含 `shared/`, `background/`, `content/`, `viewer/`, `popup/`, `options/`, `docs/`, `scripts/`）。
   - **三、隱私與安全架構（Privacy & Security Architecture — 集中自各使用介面移入之說明）**：
     本機儲存（`chrome.storage.local` / `localStorage` / `IndexedDB`）、直連官方／自訂模型端點（無第三方中繼伺服器）、`#nr_sync` URL Fragment（`#` 後方錨點依 HTTP 規範絕不傳送至伺服器、受信任來源驗證與匯入後立即 `history.replaceState` 抹除）、零 `innerHTML`（全 `document.createTextNode` 防 XSS）、MV3 嚴格 CSP（PDF.js `isEvalSupported: false`）、纯本機 Canvas ISO/IEC 18004 QR Code 編碼、Shadow DOM 樣式隔離。
3. 寫完 8 份 README 後，務必再次執行：
   ```bash
   node scripts/build-mobile.js
   ```
   讓 `docs/nativeread-android-extension.zip` 包含全部 8 份 `README*.md`。

### Step 2 — 補齊 `docs/app.js` 遠端 PDF CORS 友善逾時提示（M6 小項）
- 在 `docs/app.js` 的 `loadPdfFromUrl` 中，確保先套用 `resolvePdfSourceUrl`（支援貼入 Google Drive PDF 檢視連結），並為 `fetch` 加上明確的 `AbortController` 逾時（例如 15 秒），若因瀏覽器跨網域 CORS 限制無法直接下載外部 PDF（如在純靜態網頁直接抓 `arxiv.org`），立即結束 loading 畫面並顯示清晰的引導提示（提供一鍵「在新分頁開啟下載後選擇本機檔案」按鈕），不再無限轉圈。

### Step 3 — 執行 `ego-browser` 真實瀏覽器端對端實測與截圖驗收
使用 `ego-browser nodejs`（記得每次結束呼叫 `await task.finish({ keep: [] })`）：
1. 在 `chrome://extensions/` 重新載入 `ckeknfhpandgmippabbfkndmndainpff` 並確認 `errText: null`（0 錯誤）。
2. 實測並確認：
   - **Popup (`380x600`) & Options & PDF 空狀態**：Popup 免捲動完整顯示（`scrollHeight <= 600`），Options 與 PDF 閱讀器已無冗長安全文案，Options 未點擊前不顯示空白 QR 框。
   - **Wikipedia (`https://en.wikipedia.org/wiki/Attention_Is_All_You_Need`)**：右側 Infobox 表格 `<th>` 標籤正常寬度不壓扁成單字垂直列，內文連結可點擊。
   - **Kaggle Learn SPA / MDN**：深淺色主題正常、標題與內容翻譯完整。
   - **內建 PDF 閱讀器 (`https://arxiv.org/pdf/1706.03762.pdf`)**：第 1 頁作者與 `Abstract` 層級分明、第 3 頁無裸露 `$...$` LaTeX 原始碼、Overlay 與 Split 模式切換正常。
   - **Google Drive PDF (`https://drive.google.com/file/d/1IR7CddF_2FyQo_PdfBNTaEA50EGiVt2r/view`)**：第 1 頁封面與第 6 頁內文皆可原位翻譯覆蓋，懸浮控制列正常顯示。
   - **R4 圖片按需原位翻譯**：載入使用者提供的測試圖表 `/Users/wangzhikai/.gemini/antigravity/brain/e95f85c3-fc73-4733-b755-4d760c6c1a3e/.user_uploaded/media_1795192856884_40c9d866.jpg`，驗證懸停點擊「譯圖」（或 `TRANSLATE_IMAGE`）後，4 格工程卡片文字原位翻譯為繁體中文且左側 3D 結構插圖完好保留。
   - **手機版 PWA (`docs/`，`390x844` 視口)**：確認設定頁 `#setModel` 高度正常（約 `40px`，不再是 `200px`）、底部 4 字導覽列不截斷、無安全冗長文案。
3. 最後執行語法與安全檢查：
   ```bash
   cd /Users/wangzhikai/.gemini/antigravity/scratch/native-read
   node scripts/build-mobile.js
   for f in shared/*.js background/*.js content/*.js popup/*.js options/*.js viewer/*.js scripts/*.js docs/app.js docs/sw.js docs/nativeread.user.js; do node --check "$f" || exit 1; done
   ```
   若使用者需要推送至 GitHub，可一併 `git commit` 並 `git push origin main`。
