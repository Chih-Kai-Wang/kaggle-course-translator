# AI 原版美感翻譯 v2.0.0（原 Kaggle 課程智慧翻譯助手）

一款專注於「**原版無框美感排版**」與「**極速串流體驗**」的全網通用 AI 網頁翻譯 Chrome / Chromium Manifest V3 擴充功能（支援 Google Chrome、Microsoft Edge、Brave、Ego Lite 等瀏覽器）。

**v2.0.0** 從專精 Kaggle Learn 與 Jupyter Notebook 的翻譯工具全面進化為**支援任意 `http://` / `https://` 網站的通用 AI 翻譯助手**，同時完整保留對 Kaggle 跨域 `<iframe>`、JupyterLab v4 與 CodeMirror 6 編輯器的深度專屬支援。

預設提供**繁體中文（台灣用語）**與多國語言即時切換，並堅持**預設靜默、按需啟動、無多餘框線、零第三方中轉**的極簡設計哲學。

---

## v2.0.0 核心亮點

### 1. 預設靜默．全網按需啟動（On-Demand Default）
- **零侵入日常瀏覽**：預設不會在所有網頁背景自動注入或私自翻譯，保持瀏覽器極速輕量。
- **任意網站即時翻譯**：瀏覽技術文件、部落格、GitHub、學術論文、新聞或 Kaggle 課程時，按下快捷鍵 **`Alt+T`**（macOS 亦可使用 `Option+T`），或點擊瀏覽器工具列圖示 → **「立即翻譯此頁面」**，即可免重新整理頁面即時注入並翻譯。
- **單站自動翻譯白名單**：可在彈出面板頂部的**目前網站列**一鍵勾選「**總是自動翻譯此網站**」（例如 `www.kaggle.com`、`docs.python.org`），或在設定頁管理白名單清單。

### 2. SSE 串流逐段即時上屏（Streaming Translation）
- 原生支援 **OpenAI 相容 SSE 串流**與 **Google Gemini `:streamGenerateContent?alt=sse`**。
- 模型每吐出一段譯文即刻渲染上屏，大幅縮短首字等待時間，不再乾等整批完成。

### 3. 視口優先懶翻譯（Viewport-First Lazy Loading）
- 透過 `IntersectionObserver` 優先翻譯目前螢幕可視範圍內的內容，捲動到哪翻到哪。
- 長篇技術文件與論文可瞬間完成首屏呈現，並大幅節省大模型 Token 額度。

### 4. 本機決策樹與原版美感排版配對（Local Decision Tree & Native Typography）
- **本機規則決策樹**：翻譯前先於本機精準過濾導覽列、頁尾、工具按鈕、數學公式（LaTeX / MathJax / KaTeX）、程式碼識別符、URL 與純數字表格，避免雜訊污染與無效 API 呼叫。
- **原版字體智慧配對**：自動偵測各段落原有字族（襯線 Serif / 無襯線 Sans-serif），於「**原版自動配對**」模式下分別補配優雅的中文明體或清晰黑體，同時保留原站英數字體、字重、字級、行高與留白節奏。
- 支援 **譯文（原版乾淨排版）／ 僅原文 ／ 簡潔雙語** 三種模式，並提供啟動後才顯示的精簡懸浮控制列。

### 5. 思考強度分級控制（Thinking Effort Control）
- 提供 **極速（最低思考強度 · 推薦）／ 平衡（低思考強度）／ 深度（中等思考強度）** 三段控制。
- 針對 Gemini 2.5 / 3.x 及推論型 OpenAI 模型自動對應調整思考預算，在日常技術閱讀時達到最快回應與最低費用，閱讀長難句或文學內容時亦可切換深度思考。

### 6. IndexedDB 高容量本機快取
- 從 `chrome.storage.local` 升級為 **IndexedDB 高容量本機 LRU 快取**，依「**模型 + 目標語言**」持久化儲存已翻譯的網頁段落與程式碼註解。
- 重訪已讀頁面或回看教學文件時毫秒級命中快取，零延遲且不重複消耗 API 額度。

### 7. Kaggle Learn / JupyterLab / CodeMirror 6 深度專屬能力（完整保留）
- **跨域 `<iframe>` 無縫穿透**：支援 Kaggle Learn 課程內文與 Exercise 實作編輯器（`*.kaggleusercontent.com`、`*.kaggle.net`）。
- **程式碼 `#` / `//` 註解智慧翻譯（不影響程式執行）**：
  - 靜態 `<pre>` / `<code>` 區塊自動辨識引號與註解語法，保留原始語法高亮。
  - **CodeMirror 6 編輯器**採用分離式唯讀疊加層顯示譯文註解；當點擊程式碼準備編輯或切回原文模式時自動還原英文，絕不改動底層程式碼或干擾 `step_X.check()` 驗證。
- **Notebook 輸出「譯」按鈕與劃詞翻譯**：一鍵翻譯 `hint()`、`solution()` 提示與 Python Traceback 報錯；在任意網頁選取文字即可即時彈出劃詞翻譯卡片。

---

## 安裝與使用

### 1. 載入擴充功能
1. 下載或 Clone 本專案：
   ```bash
   git clone https://github.com/Chih-Kai-Wang/kaggle-course-translator.git
   ```
2. 開啟 Chromium 系瀏覽器的擴充功能管理頁面：
   - Chrome：`chrome://extensions/`
   - Edge：`edge://extensions/`
   - Brave / Ego Lite：`chrome://extensions/`
3. 開啟右上角 **開發人員模式（Developer mode）**。
4. 點擊 **載入未封裝項目（Load unpacked）**，選擇 `kaggle-course-translator` 資料夾。

### 2. 設定大模型 API 與偏好
1. 點擊瀏覽器工具列上的擴充功能圖示 → **進階與 API 設定**。
2. 選擇模型服務商（內建 Google Gemini 原生介面、DeepSeek、OpenAI、通義千問 Qwen、SiliconFlow、Moonshot Kimi、智譜 GLM、OpenRouter 與本機 Ollama）：
   - **Google Gemini（原生介面 · 推薦免費額度方案）**：填入 Google AI Studio API Key，預設推薦 `gemini-3.5-flash-lite`（免費層高速低延遲，支援串流與思考強度控制），亦可選擇 `gemini-3.1-flash-lite` / `gemini-3.8-flash` / `gemini-4-hydrogen`。
   - **OpenAI 相容端點 / 本機 Ollama**：支援任意中轉站、OneAPI 或本機 `http://localhost:11434/v1`。
3. 貼上 API Key，點擊 **測試連線** 確認成功後點擊 **儲存設定**。
4. 依需求調整 **原版美感字體配對**、**思考強度**、**視口懶翻譯**、**SSE 串流**、**自動翻譯網站白名單**與**領域術語表**。

### 3. 日常使用方式
- **快捷鍵啟動**：在任意外文網頁按下 **`Alt+T`** 立即翻譯（再次按或透過懸浮列可切換原文／譯文／雙語）。
- **彈出面板控制**：點擊工具列圖示可立即翻譯、強制重譯、還原原文、切換目標語言或將目前網站加入自動翻譯白名單。
- **Kaggle 課程與實作**：可將 `www.kaggle.com` 加入自動翻譯白名單，開啟 `/learn` 或 Exercise Notebook 時即自動呈現原版美感譯文與註解翻譯。

---

## 隱私與安全

- **無任何第三方中轉伺服器**：所有翻譯請求皆由瀏覽器背景 Service Worker 直接發送至您自行設定的模型端點。
- **本機儲存**：API Key 與偏好設定僅存於瀏覽器本機 `chrome.storage.local`，譯文快取僅存於本機 IndexedDB，隨時可於設定頁一鍵清空。
- **嚴格遵循 Chrome Manifest V3 CSP**：無 `eval()`、無內嵌腳本、所有動態譯文與 UI 皆以安全 DOM API 渲染。

---

## 專案結構

```text
kaggle-course-translator/
├── manifest.json              # Manifest V3 宣告、Alt+T 快捷鍵與按需腳本注入權限
├── shared/
│   └── config.js              # Schema v5 設定管理、模型預設、語言/術語表與白名單工具
├── background/
│   └── service-worker.js      # SSE 串流與批次翻譯排程、思考強度控制、按需注入與 IndexedDB LRU 快取
├── content/
│   ├── content.js             # 本機決策樹、原版字體偵測、視口懶翻譯、註解疊加層與懸浮控制列
│   └── content.css            # 原版無框排版樣式、Serif/Sans CJK 字型配對與懸浮 UI
├── popup/                     # 全網通用快速控制面板（含目前網站白名單開關）
├── options/                   # 進階設定頁（思考強度、字體配對、白名單管理、API 與 IndexedDB 快取）
├── icons/                     # 擴充功能圖示 (16 / 48 / 128 px)
├── LICENSE                    # MIT License
└── README.md
```

---

## 授權條款

本專案採用 [MIT License](LICENSE) 開源釋出，歡迎提出 Issue 或 Pull Request 一起打造更優雅的閱讀與學習體驗。
