# Kaggle 課程智慧翻譯助手 (Kaggle Course Translator)

一款專為 **Kaggle Learn 課程**與 **Notebook 實作練習（Exercise）** 打造的 Chrome / Chromium Manifest V3 擴充功能（支援 Google Chrome、Microsoft Edge、Brave、Ego Lite 等瀏覽器）。

預設提供**繁體中文（台灣用語）**並支援多國語言即時切換，強調「**原版無框排版美學**」、「**Python `#` 註解智慧翻譯**」與「**全域一鍵切換原文 / 譯文**」。

---

## 為什麼瀏覽器內建整頁翻譯在 Kaggle 經常失效？

1. **教學與實作內嵌跨域 `<iframe>`**：Kaggle 課程內文與 Exercise 編輯器透過 `*.kaggleusercontent.com` 及 `*.kaggle.net`（JupyterLab v4）載入，內建整頁翻譯經常無法穿透或無法觸發即時更新。
2. **排版美感與可讀性容易被破壞**：生硬的插件外框、底色塊或字型錯位會打亂原本清晰的標題階層、清單縮排與行距。
3. **程式碼、公式與 `#` 註解難以兼顧**：一般網頁翻譯容易破壞 `train_test_split`、LaTeX 數學式與變數名稱，卻又經常漏翻程式碼區塊內的 `#` 註解；或因直接修改 DOM 導致 Notebook 無法執行。

---

## 核心特色

- **原版乾淨排版．無多餘框線**
  - 預設採用 **譯文模式**：於原節點內進行語意替換，完整繼承 Kaggle 原有的字級、留白、色彩與縮排結構，去除多餘邊框與色塊。
  - 針對 CJK 與英文／程式碼混排最佳化字型堆疊（`Google Sans Flex` / `Inter` / `PingFang TC` / `Noto Sans TC`）。
  - 支援 **譯文 / 原文 / 簡潔雙語** 三種顯示模式，透過右下角精簡懸浮列隨時無縫切換。

- **Python `#` 程式碼註解智慧翻譯（不影響程式執行）**
  - **課程教學頁（Tutorial）**：自動識別靜態 `<pre>` 程式區塊內的 `#` 註解行，以引號狀態分析避免誤判字串內的 `#` 符號，保留原始語法高亮。
  - **實作編輯器（Exercise / CodeMirror 6）**：透過與 `.cm-content` 分離的唯讀疊加層（`.kct-cm-layer`）顯示譯文註解；當您**點擊該程式碼儲存格準備編輯**或**切換至「原文」模式**時自動恢復英文註解，絕不改動底層程式碼或干擾 `step_X.check()` 驗證。

- **多語言支援（預設繁體中文．台灣用語）**
  - 內建 9 種語言及自訂語言選項：繁體中文（台灣）、简体中文、日本語、한국어、Español、Français、Deutsch、Tiếng Việt、Português。
  - 內建機器學習常見術語詞彙表（如 `overfitting → 過度擬合`、`validation set → 驗證集`、`pipeline → 管線 (Pipeline)`），並可在設定頁自行微調。

- **實作 Hint / 報錯一鍵翻譯與劃詞翻譯**
  - Notebook 輸出區塊自動附帶「譯」按鈕，可一鍵翻譯 `hint()`、`solution()` 提示與 Python Traceback 錯誤訊息。
  - 選取頁面任意英文片段或終端錯誤訊息即可即時彈出翻譯卡片。

- **多模型 API 與本機隱私保護**
  - 內建 DeepSeek、OpenAI、Google Gemini、通義千問 Qwen、SiliconFlow、Moonshot Kimi、智譜 GLM、OpenRouter 及本機 Ollama 預設設定。
  - 支援依「**模型 + 目標語言**」快取譯文於瀏覽器本機 `chrome.storage.local`，重開課程零延遲、節省 API 費用。
  - **無任何第三方中轉伺服器**：所有 API Key 僅存放於您的瀏覽器本機，由背景 Service Worker 直接連線至您指定的模型端點。

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
   - Ego Lite：`chrome://extensions/`
3. 開啟右上角 **開發人員模式（Developer mode）**。
4. 點擊 **載入未封裝項目（Load unpacked）**，選擇 `kaggle-course-translator` 資料夾。

### 2. 設定模型與 API Key
1. 點擊瀏覽器工具列上的擴充功能圖示 → **模型與 API 設定**。
2. 選擇模型服務商（推薦使用 **DeepSeek `deepseek-chat`**，或 **Google Gemini** / **OpenAI** / **Ollama** 等）。
3. 貼上您的 API Key，點擊 **測試連線** 確認成功後點擊 **儲存設定**。

### 3. 開始學習 Kaggle 課程
- 開啟任一 Kaggle Learn 教學或 Exercise Notebook（`/learn`、`/code/.../edit`），即可自動以原版排版呈現翻譯。
- 透過右下角精簡懸浮條可隨時切換 **`譯文 | 原文 | 雙語`** 或更換目標語言。

---

## 專案結構

```text
kaggle-course-translator/
├── manifest.json              # Manifest V3 設定與跨域 iframe 權限宣告
├── shared/
│   └── config.js              # 多模型預設、目標語言清單、台灣用語詞彙表與設定遷移
├── background/
│   └── service-worker.js      # LLM API 請求排程、多語言提示詞組裝與本機 LRU 快取
├── content/
│   ├── content.js             # 跨域 DOM 掃描、Python # 註解解析、CodeMirror 疊加層與懸浮列
│   └── content.css            # 無框原版排版樣式、字型堆疊、Glassmorphism 懸浮控制條
├── popup/                     # 擴充功能彈出快速控制面板
├── options/                   # 完整模型、API、詞彙表與顯示設定頁面
├── icons/                     # 擴充功能圖示 (16 / 48 / 128 px)
├── LICENSE                    # MIT License
└── README.md
```

---

## 授權條款

本專案採用 [MIT License](LICENSE) 開源釋出，歡迎提出 Issue 或 Pull Request 一起改善 Kaggle 學習體驗。
