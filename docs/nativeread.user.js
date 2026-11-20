// ==UserScript==
// @name         NativeRead — 原版美感 AI 網頁翻譯 (Mobile & Desktop)
// @namespace    https://chih-kai-wang.github.io/native-read/
// @version      2.3.0
// @description  保留原網站 Serif / Sans 排版氣質的 AI 串流網頁與程式碼註解翻譯器（支援 iOS Safari Stay / Userscripts 與 Android Tampermonkey / 狐猴 / Kiwi）
// @author       Chih-Kai Wang
// @homepageURL  https://github.com/Chih-Kai-Wang/native-read
// @supportURL   https://github.com/Chih-Kai-Wang/native-read/issues
// @updateURL    https://chih-kai-wang.github.io/native-read/nativeread.meta.js
// @downloadURL  https://chih-kai-wang.github.io/native-read/nativeread.user.js
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(() => {
  if (globalThis.KCTConfig) return;

  const PROVIDER_PRESETS = {
    deepseek: {
      id: 'deepseek',
      label: 'DeepSeek（推薦 · 高性價比）',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      defaultModel: 'deepseek-chat',
      placeholderKey: 'sk-...',
      hint: '支援 deepseek-chat (V3)，機器學習與資料科學術語翻譯準確、速度快、成本極低。'
    },
    openai: {
      id: 'openai',
      label: 'OpenAI',
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o-mini',
      placeholderKey: 'sk-...',
      hint: '建議使用 gpt-4o-mini 或 gpt-4.1-mini。'
    },
    gemini: {
      id: 'gemini',
      label: 'Google Gemini（原生介面 · 支援免費額度）',
      protocol: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      defaultModel: 'gemini-3.5-flash-lite',
      suggestedModels: [
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-3.8-flash',
        'gemini-4-hydrogen',
        'gemini-3.6-flash',
        'gemini-2.5-flash'
      ],
      placeholderKey: 'AQ... 或 AIza...',
      hint: '使用 Google AI Studio API Key；免費額度首選 gemini-3.5-flash-lite（500 RPD），高階翻譯可選 gemini-3.8-flash / gemini-4-hydrogen。'
    },
    qwen: {
      id: 'qwen',
      label: '通義千問 Qwen（阿里雲百煉）',
      protocol: 'openai',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      defaultModel: 'qwen-plus',
      placeholderKey: 'sk-...',
      hint: '建議使用 qwen-plus 或 qwen-turbo-latest。'
    },
    siliconflow: {
      id: 'siliconflow',
      label: 'SiliconFlow 矽基流動',
      protocol: 'openai',
      baseUrl: 'https://api.siliconflow.cn/v1',
      defaultModel: 'deepseek-ai/DeepSeek-V3',
      placeholderKey: 'sk-...',
      hint: '可呼叫 DeepSeek-V3、Qwen2.5 等多種開源模型。'
    },
    moonshot: {
      id: 'moonshot',
      label: 'Moonshot Kimi',
      protocol: 'openai',
      baseUrl: 'https://api.moonshot.cn/v1',
      defaultModel: 'moonshot-v1-8k',
      placeholderKey: 'sk-...',
      hint: '中文語意理解流暢。'
    },
    zhipu: {
      id: 'zhipu',
      label: '智譜 GLM',
      protocol: 'openai',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      defaultModel: 'glm-4-flash',
      placeholderKey: '...',
      hint: 'glm-4-flash 提供免費額度。'
    },
    openrouter: {
      id: 'openrouter',
      label: 'OpenRouter',
      protocol: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      defaultModel: 'google/gemini-2.5-flash',
      suggestedModels: [
        'google/gemini-2.5-flash',
        'google/gemini-2.5-flash-lite',
        'deepseek/deepseek-chat'
      ],
      placeholderKey: 'sk-or-...',
      hint: '聚合多家大模型，填入對應模型 ID 即可。'
    },
    custom: {
      id: 'custom',
      label: '自訂 OpenAI 相容介面 / 本機 Ollama',
      protocol: 'openai',
      baseUrl: 'http://localhost:11434/v1',
      defaultModel: 'qwen2.5:7b',
      placeholderKey: '可留空或填金鑰',
      hint: '支援任何 OpenAI 相容中轉站、OneAPI 或本機 Ollama。'
    }
  };

  const LATIN_FONTS = {
    serifFontStack: 'Georgia, "Noto Serif", "Times New Roman", serif',
    sansFontStack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif',
    monoFontStack: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
  };

  const TARGET_LANGUAGES = {
    'zh-TW': {
      id: 'zh-TW',
      label: '繁體中文（台灣）',
      shortLabel: '繁中',
      promptName: 'Traditional Chinese (Taiwanese Mandarin phrasing and terminology)',
      fontClass: 'kct-lang-tc',
      testSampleHint: '繁體中文（台灣用語）',
      serifFontStack: '"Songti TC", "Noto Serif TC", "PMingLiU", serif',
      sansFontStack: '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif',
      monoFontStack: '"PingFang TC", "Noto Sans TC", monospace'
    },
    'zh-CN': {
      id: 'zh-CN',
      label: '简体中文',
      shortLabel: '简中',
      promptName: 'Simplified Chinese (Mainland China phrasing)',
      fontClass: 'kct-lang-sc',
      testSampleHint: '简体中文',
      serifFontStack: '"Songti SC", "Noto Serif SC", "SimSun", serif',
      sansFontStack: '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
      monoFontStack: '"PingFang SC", "Noto Sans SC", monospace'
    },
    ja: {
      id: 'ja',
      label: '日本語',
      shortLabel: '日本語',
      promptName: 'Japanese (natural technical Japanese)',
      fontClass: 'kct-lang-ja',
      testSampleHint: '日本語',
      serifFontStack: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif',
      sansFontStack: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif',
      monoFontStack: '"Hiragino Sans", "Noto Sans JP", monospace'
    },
    ko: {
      id: 'ko',
      label: '한국어',
      shortLabel: '한국어',
      promptName: 'Korean (natural technical Korean)',
      fontClass: 'kct-lang-ko',
      testSampleHint: '한국어',
      serifFontStack: '"AppleMyungjo", "Batang", "Noto Serif KR", serif',
      sansFontStack: '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif',
      monoFontStack: '"Apple SD Gothic Neo", "Noto Sans KR", monospace'
    },
    es: {
      id: 'es',
      label: 'Español',
      shortLabel: 'ES',
      promptName: 'Spanish (neutral technical Spanish)',
      fontClass: 'kct-lang-latin',
      testSampleHint: 'Español',
      ...LATIN_FONTS
    },
    fr: {
      id: 'fr',
      label: 'Français',
      shortLabel: 'FR',
      promptName: 'French (natural technical French)',
      fontClass: 'kct-lang-latin',
      testSampleHint: 'Français',
      ...LATIN_FONTS
    },
    de: {
      id: 'de',
      label: 'Deutsch',
      shortLabel: 'DE',
      promptName: 'German (natural technical German)',
      fontClass: 'kct-lang-latin',
      testSampleHint: 'Deutsch',
      ...LATIN_FONTS
    },
    vi: {
      id: 'vi',
      label: 'Tiếng Việt',
      shortLabel: 'VI',
      promptName: 'Vietnamese (natural technical Vietnamese)',
      fontClass: 'kct-lang-latin',
      testSampleHint: 'Tiếng Việt',
      ...LATIN_FONTS
    },
    pt: {
      id: 'pt',
      label: 'Português',
      shortLabel: 'PT',
      promptName: 'Portuguese (natural technical Portuguese)',
      fontClass: 'kct-lang-latin',
      testSampleHint: 'Português',
      ...LATIN_FONTS
    },
    custom: {
      id: 'custom',
      label: '自訂語言...',
      shortLabel: '自訂',
      promptName: '',
      fontClass: 'kct-lang-latin',
      testSampleHint: 'Custom',
      ...LATIN_FONTS
    }
  };

  const DEFAULT_GLOSSARY = [
    'overfitting -> 過度擬合',
    'underfitting -> 擬合不足',
    'cross-validation -> 交叉驗證',
    'validation set -> 驗證集',
    'validation data -> 驗證資料',
    'training set -> 訓練集',
    'training data -> 訓練資料',
    'test set -> 測試集',
    'feature engineering -> 特徵工程',
    'gradient boosting -> 梯度提升',
    'random forest -> 隨機森林',
    'decision tree -> 決策樹',
    'mean absolute error (MAE) -> 平均絕對誤差 (MAE)',
    'RMSE -> 均方根誤差 (RMSE)',
    'target leakage -> 目標洩漏',
    'data leakage -> 資料洩漏',
    'pipeline -> 管線 (Pipeline)',
    'function -> 函式',
    'hyperparameter -> 超參數'
  ].join('\n');

  const CURRENT_SCHEMA_VERSION = 5;

  const DEFAULT_SETTINGS = {
    settingsSchemaVersion: CURRENT_SCHEMA_VERSION,
    enabled: true,
    autoTranslate: false,
    autoTranslateHosts: [],
    targetLang: 'zh-TW',
    customTargetLang: '',
    displayMode: 'replace', // 'replace' | 'original' | 'bilingual'
    scope: 'course', // 'course' | 'all'
    translateCodeComments: true,
    selectionTranslate: true,
    showFloatingBall: true,
    showOutputTranslateBtn: true,
    lazyViewport: true,
    streamTranslation: true,
    thinkingEffort: 'fastest', // 'fastest' | 'balanced' | 'deep'
    typographyMatch: 'native', // 'native' | 'system' | 'preserve'
    providerId: 'deepseek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.2,
    batchSize: 20,
    maxBatchChars: 5500,
    customGlossary: DEFAULT_GLOSSARY
  };

  const SETTINGS_KEY = 'kct_settings_v1';
  const CACHE_KEY = 'kct_translation_cache_v1';

  function resolveTargetLanguage(settings) {
    const id = settings?.targetLang || 'zh-TW';
    if (id === 'custom') {
      const customName = String(settings?.customTargetLang || '').trim();
      return {
        id: 'custom',
        label: customName || '自訂語言',
        shortLabel: customName ? customName.slice(0, 4) : '自訂',
        promptName: customName || 'Traditional Chinese (Taiwan)',
        fontClass: 'kct-lang-latin',
        isCustom: true,
        ...LATIN_FONTS
      };
    }
    return TARGET_LANGUAGES[id] || TARGET_LANGUAGES['zh-TW'];
  }

  function normalizeOpenAIEndpoint(baseUrl) {
    const clean = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!clean) return '';
    if (clean.endsWith('/chat/completions')) return clean;
    if (/\/(v\d+|openai|compatible-mode\/v1|api\/paas\/v\d+)$/i.test(clean)) {
      return `${clean}/chat/completions`;
    }
    return `${clean}/v1/chat/completions`;
  }

  function normalizeGeminiEndpoint(baseUrl, model) {
    const clean = String(baseUrl || 'https://generativelanguage.googleapis.com/v1beta')
      .trim()
      .replace(/\/+$/, '');
    const m = String(model || 'gemini-2.5-flash').trim().replace(/^models\//, '');
    if (clean.includes(':generateContent') || clean.includes(':streamGenerateContent')) {
      return clean;
    }
    if (/\/v1(beta)?$/i.test(clean)) {
      return `${clean}/models/${encodeURIComponent(m)}:generateContent`;
    }
    return `${clean}/v1beta/models/${encodeURIComponent(m)}:generateContent`;
  }

  function resolveEndpoint(settings) {
    if (settings?.protocol === 'gemini') {
      return normalizeGeminiEndpoint(settings.baseUrl, settings.model);
    }
    return normalizeOpenAIEndpoint(settings?.baseUrl);
  }

  function resolveStreamEndpoint(settings) {
    const endpoint = resolveEndpoint(settings);
    if (!endpoint) return '';
    if (settings?.protocol === 'gemini') {
      const streamUrl = endpoint.includes(':streamGenerateContent')
        ? endpoint
        : endpoint.replace(':generateContent', ':streamGenerateContent');
      try {
        const parsed = new URL(streamUrl);
        parsed.searchParams.set('alt', 'sse');
        return parsed.toString();
      } catch (_) {
        return streamUrl.includes('?') ? `${streamUrl}&alt=sse` : `${streamUrl}?alt=sse`;
      }
    }
    return endpoint;
  }

  function resolveThinkingConfig(model, effort = 'fastest') {
    const norm = String(model || '').replace(/^models\//i, '').trim().toLowerCase();
    if (!norm) return null;
    const mode = effort === 'balanced' || effort === 'deep' ? effort : 'fastest';

    if (/^gemini-(?:3\.5-flash-lite|3\.6-flash|3-flash|3\.1-flash-lite)/.test(norm)) {
      if (mode === 'fastest') return { thinkingLevel: 'MINIMAL' };
      if (mode === 'balanced') return { thinkingLevel: 'LOW' };
      return { thinkingLevel: 'MEDIUM' };
    }
    if (/^gemini-(?:3\.8-flash|4-|3\.1-pro|3-pro)/.test(norm)) {
      if (mode === 'deep') return { thinkingLevel: 'MEDIUM' };
      return { thinkingLevel: 'LOW' };
    }
    if (/^gemini-2\.5-flash(?:-lite)?(?:$|[-.])/.test(norm)) {
      if (mode === 'fastest') return { thinkingBudget: 0 };
      if (mode === 'balanced') return { thinkingBudget: 512 };
      return { thinkingBudget: 2048 };
    }
    return null;
  }

  function normalizeHostname(host) {
    return String(host || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  }

  function isHostWhitelisted(hostname, settings) {
    const norm = normalizeHostname(hostname);
    if (!norm) return false;
    const hosts = Array.isArray(settings?.autoTranslateHosts) ? settings.autoTranslateHosts : [];
    return hosts.some((entry) => {
      const rule = normalizeHostname(entry);
      if (!rule) return false;
      return norm === rule || norm.endsWith(`.${rule}`);
    });
  }

  async function toggleHostWhitelist(hostname) {
    const norm = normalizeHostname(hostname);
    const current = await getSettings();
    if (!norm) {
      return { whitelisted: false, settings: current };
    }
    const existing = Array.isArray(current.autoTranslateHosts)
      ? current.autoTranslateHosts.map(normalizeHostname).filter(Boolean)
      : [];
    const matched = existing.some((rule) => norm === rule || norm.endsWith(`.${rule}`));
    let nextHosts;
    let whitelisted;
    if (matched) {
      nextHosts = existing.filter((rule) => !(norm === rule || norm.endsWith(`.${rule}`)));
      whitelisted = false;
    } else {
      nextHosts = Array.from(new Set([...existing, norm]));
      whitelisted = true;
    }
    const settings = await saveSettings({ autoTranslateHosts: nextHosts });
    return { whitelisted, settings };
  }

  function isInjectableUrl(url) {
    if (!url || typeof url !== 'string') return false;
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (host === 'chromewebstore.google.com') return false;
    if (host === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')) return false;
    if (host === 'microsoftedge.microsoft.com' && parsed.pathname.startsWith('/addons')) return false;
    return true;
  }

  function isLocalEndpoint(baseUrl) {
    return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(String(baseUrl || '').trim());
  }

  const EXTENSIONLESS_PDF_HOSTS = new Set([
    'arxiv.org',
    'export.arxiv.org',
    'openreview.net',
    'aclanthology.org',
    'proceedings.mlr.press'
  ]);

  function isFileUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      return new URL(url).protocol === 'file:';
    } catch (_) {
      return false;
    }
  }

  function isFilePdfUrl(url) {
    if (!url || typeof url !== 'string') return false;
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      return false;
    }
    if (parsed.protocol !== 'file:') return false;
    const pathname = parsed.pathname || '';
    if (/\.html?$/i.test(pathname)) return false;
    return /\.pdf$/i.test(pathname);
  }

  function isRemotePdfUrl(url) {
    if (!url || typeof url !== 'string') return false;
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname || '';
    // Never hijack HTML viewer pages wrapping a .pdf filename (e.g. GitHub /blob/..., Wikipedia File:...)
    if (/\/blob\//i.test(pathname) || /\/wiki\/File:/i.test(pathname) || /\.html?$/i.test(pathname)) {
      return false;
    }
    if (/\.pdf$/i.test(pathname)) return true;
    if (EXTENSIONLESS_PDF_HOSTS.has(host) && /^\/pdf\/[^/]+/i.test(pathname)) return true;
    for (const [k, v] of parsed.searchParams.entries()) {
      if (k.toLowerCase() === 'format' && v.toLowerCase() === 'pdf') return true;
    }
    return false;
  }

  function isPdfUrl(url, { includeFile = true } = {}) {
    return isRemotePdfUrl(url) || (includeFile && isFilePdfUrl(url));
  }

  function extractGoogleDriveFileId(url) {
    if (!url || typeof url !== 'string') return '';
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      return '';
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== 'drive.google.com' && host !== 'docs.google.com') return '';
    const m = (parsed.pathname || '').match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
    if (m) return m[1];
    const qId = parsed.searchParams.get('id');
    if (qId && /^[a-zA-Z0-9_-]{10,}$/.test(qId)) return qId;
    return '';
  }

  function resolvePdfSourceUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const gdriveId = extractGoogleDriveFileId(url);
    if (gdriveId) {
      return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(gdriveId)}`;
    }
    if (isPdfUrl(url)) return url;
    return '';
  }

  async function getSettings() {
    if (!chrome?.runtime?.id) {
      return { ...DEFAULT_SETTINGS, autoTranslateHosts: [] };
    }
    let data;
    try {
      data = await chrome.storage.local.get(SETTINGS_KEY);
    } catch (_) {
      return { ...DEFAULT_SETTINGS, autoTranslateHosts: [] };
    }
    const raw = data[SETTINGS_KEY];
    if (!raw) {
      return { ...DEFAULT_SETTINGS, autoTranslateHosts: [] };
    }
    const ver = raw.settingsSchemaVersion || 1;
    if (ver < CURRENT_SCHEMA_VERSION) {
      let migrated = { ...DEFAULT_SETTINGS, ...raw };
      if (ver < 2) {
        migrated = {
          ...migrated,
          targetLang: raw.targetLang || 'zh-TW',
          displayMode: raw.displayMode === 'bilingual' ? 'replace' : (raw.displayMode || 'replace'),
          translateCodeComments: raw.translateCodeComments ?? true,
          customGlossary: (!raw.customGlossary || raw.customGlossary.includes('过拟合'))
            ? DEFAULT_GLOSSARY
            : raw.customGlossary
        };
      }
      migrated.autoTranslate = false;
      migrated.autoTranslateHosts = Array.isArray(raw.autoTranslateHosts)
        ? raw.autoTranslateHosts.map(normalizeHostname).filter(Boolean)
        : [];
      migrated.lazyViewport = raw.lazyViewport ?? true;
      migrated.streamTranslation = raw.streamTranslation ?? true;
      migrated.thinkingEffort = raw.thinkingEffort || 'fastest';
      migrated.typographyMatch = raw.typographyMatch || 'native';
      migrated.batchSize = (!raw.batchSize || raw.batchSize === 8 || raw.batchSize === 16 || raw.batchSize === 24)
        ? 20
        : raw.batchSize;
      migrated.maxBatchChars = (!raw.maxBatchChars || raw.maxBatchChars === 1800 || raw.maxBatchChars === 4500 || raw.maxBatchChars === 6500)
        ? 5500
        : raw.maxBatchChars;
      migrated.settingsSchemaVersion = CURRENT_SCHEMA_VERSION;
      try {
        await chrome.storage.local.set({ [SETTINGS_KEY]: migrated });
      } catch (_) {
        // Ignore persistence error during read-time migration
      }
      return migrated;
    }
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      autoTranslateHosts: Array.isArray(raw.autoTranslateHosts)
        ? raw.autoTranslateHosts.map(normalizeHostname).filter(Boolean)
        : []
    };
  }

  async function saveSettings(partial) {
    const current = await getSettings();
    const next = {
      ...current,
      ...partial,
      settingsSchemaVersion: CURRENT_SCHEMA_VERSION
    };
    if (Array.isArray(next.autoTranslateHosts)) {
      next.autoTranslateHosts = Array.from(
        new Set(next.autoTranslateHosts.map(normalizeHostname).filter(Boolean))
      );
    } else {
      next.autoTranslateHosts = [];
    }
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  }

  function hashText(str) {
    // FNV-1a 64-bit split into two 32-bit hashes for very low collision
    let h1 = 0x811c9dc5;
    let h2 = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= (c + i) & 0xffff;
      h2 = Math.imul(h2, 0x01000193);
    }
    return `${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}_${str.length}`;
  }

  function sanitizeApiKey(rawKey) {
    return String(rawKey || '')
      .trim()
      .replace(/^Bearer\s+/i, '')
      .trim();
  }

  globalThis.KCTConfig = {
    PROVIDER_PRESETS,
    TARGET_LANGUAGES,
    DEFAULT_GLOSSARY,
    DEFAULT_SETTINGS,
    SETTINGS_KEY,
    CACHE_KEY,
    resolveTargetLanguage,
    normalizeOpenAIEndpoint,
    normalizeGeminiEndpoint,
    resolveEndpoint,
    resolveStreamEndpoint,
    resolveThinkingConfig,
    normalizeHostname,
    isHostWhitelisted,
    toggleHostWhitelist,
    isInjectableUrl,
    isFileUrl,
    isFilePdfUrl,
    isRemotePdfUrl,
    isPdfUrl,
    extractGoogleDriveFileId,
    resolvePdfSourceUrl,
    isLocalEndpoint,
    sanitizeApiKey,
    getSettings,
    saveSettings,
    hashText
  };
})();

(() => {
  if (globalThis.KCTSiteAnalyzer) return;

  const BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, td, th, figcaption, summary, dt, dd';

  const SKIP_ANCESTOR_SELECTOR = [
    '[data-kct-ui]',
    '[translate="no"]',
    '.notranslate',
    'pre',
    'code',
    'kbd',
    'samp',
    'var',
    'textarea',
    'input',
    'select',
    'option',
    'svg',
    'canvas',
    'script',
    'style',
    'noscript',
    '.CodeMirror',
    '.cm-editor',
    '.monaco-editor',
    '.blob-code',
    '.react-code-lines',
    '.jp-CodeCell .jp-InputArea',
    '.jp-InputPrompt',
    '.jp-CodeMirrorEditor',
    '.jp-OutputArea-prompt',
    '.jp-CodeCell .jp-OutputArea-output',
    '.jp-OutputArea-executeResult',
    '.output_result',
    '.output_subarea',
    '.katex',
    '.MathJax',
    'mjx-container',
    'table.dataframe',
    '.dataframe',
    '.material-icons',
    '.material-icons-outlined',
    '.material-symbols-outlined',
    '.material-symbols-rounded',
    '.google-symbols',
    '.anchor-link',
    '.jp-InternalAnchorLink',
    '[contenteditable="true"]'
  ].join(', ');

  const NAV_EXCLUDE_SELECTOR = [
    'nav',
    'footer',
    'aside',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="complementary"]',
    '[role="contentinfo"]',
    '[role="tablist"]',
    'button'
  ].join(', ');

  const LESSON_CELL_SELECTOR = [
    '.jp-RenderedHTMLCommon',
    '.jp-MarkdownOutput',
    '.rendered_html',
    '.text_cell_render',
    '.markdown-converter__text--rendered'
  ].join(', ');

  const COURSE_CONTAINER_SELECTOR = [
    LESSON_CELL_SELECTOR,
    'main',
    'article',
    '[role="main"]'
  ].join(', ');

  const SEMANTIC_ROOT_SELECTOR = [
    LESSON_CELL_SELECTOR,
    'article',
    'main',
    '[role="main"]',
    '.markdown-body',
    '.rst-content',
    '.wy-nav-content',
    '.md-content',
    '.vp-doc',
    '.theme-doc-markdown',
    '.prose',
    '.post-content',
    '.article-content',
    '.entry-content',
    '#mw-content-text',
    '[itemprop="articleBody"]'
  ].join(', ');

  const INLINE_PROTECT_SELECTOR = 'code, kbd, var, .katex, .MathJax, mjx-container, math, .mwe-math-element, sup.reference';

  const SHADOW_SKIP_SELECTOR = '[data-kct-ui], script, style, svg, pre, code, noscript, template, iframe, .cm-editor, .CodeMirror, .monaco-editor';

  const PROSE_TAGS = new Set(['P', 'LI', 'BLOCKQUOTE', 'DD', 'FIGCAPTION']);

  const LEAF_CANDIDATE_TAGS = new Set(['DIV', 'SPAN', 'A', 'LABEL', 'BUTTON']);

  const CHILD_BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, ul, ol, blockquote, table, td, th, section, article, main, nav, aside, header, footer, form, div, pre, hr, iframe, figure, figcaption, details, summary, dl, dt, dd, fieldset, dialog';

  const LEAF_FORBIDDEN_DESCENDANT_SELECTOR = 'button, input, select, textarea, img, picture, video, audio, canvas, svg, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [contenteditable="true"], .material-icons, .material-icons-outlined, .material-symbols-outlined, .material-symbols-rounded, .google-symbols';

  const LEAF_UI_CONTROL_SELECTOR = 'button, [role="button"], [role="menu"], [role="menuitem"], [role="tab"], time, [datetime]';

  const PURE_METADATA_REGEX = /^(?:@\w+|\d[\d,.]*\s*(?:k|m|b|views?|likes?|replies?|comments?|points?|hours?|mins?|minutes?|days?|weeks?|months?|years?|ago|entries|teams|votes?)?)$/i;

  const TECH_TITLE_REGEX = /\b(machine learning|deep learning|neural network|llm|transformer|python|pytorch|tensorflow|pandas|scikit|sklearn|kaggle|dataset|algorithm|gradient|xgboost|lightgbm|regression|classification|reinforcement learning|data science|jupyter|notebook|api|sdk|typescript|javascript|kubernetes|docker)\b/i;

  function isTopFrame() {
    try {
      return window === window.top;
    } catch (_) {
      return false;
    }
  }

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('[hidden], .sr-only, [aria-hidden="true"]')) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  }

  function isInsideExcludedChrome(el) {
    if (el.closest(NAV_EXCLUDE_SELECTOR)) return true;
    const hdr = el.closest('header');
    if (hdr) {
      // Allow <article><header><h1>...</h1></header></article> while excluding top site navbars
      const insideContent = Boolean(hdr.closest('article, main, [role="main"]'));
      const isSiteBanner = hdr.getAttribute('role') === 'banner' || Boolean(hdr.querySelector('nav'));
      if (!insideContent || isSiteBanner) return true;
    }
    return false;
  }

  function extractMicroTitle() {
    const docTitle = String(document.title || '').replace(/\s+/g, ' ').trim();
    const h1El = document.querySelector('main h1, article h1, h1');
    const h1Text = h1El ? String(h1El.textContent || '').replace(/\s+/g, ' ').replace(/\s*¶\s*$/, '').trim() : '';

    let combined = docTitle;
    if (h1Text) {
      const probe = h1Text.slice(0, 24).toLowerCase();
      if (!docTitle) {
        combined = h1Text;
      } else if (!docTitle.toLowerCase().includes(probe)) {
        combined = `${h1Text} — ${docTitle}`;
      }
    }
    return combined.slice(0, 120);
  }

  function classifyPage() {
    const host = String(location.hostname || '').toLowerCase();
    const title = extractMicroTitle();
    const hasCodeWidgets = Boolean(
      document.querySelector('pre, .cm-editor, .CodeMirror, .monaco-editor, .jp-Cell')
    );
    const useTechGlossary = Boolean(
      hasCodeWidgets ||
      document.querySelector('.katex, .MathJax, mjx-container, .markdown-body') ||
      TECH_TITLE_REGEX.test(title)
    );

    return {
      pageType: 'universal',
      hasCodeWidgets,
      title,
      host,
      useTechGlossary
    };
  }

  function dedupeTopmost(nodes) {
    return nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
  }

  function scoreReadabilityContainer(el) {
    if (!el || !isElementVisible(el)) return { score: 0, textLen: 0, linkRatio: 1 };
    const blocks = el.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, figcaption');
    let textLen = 0;
    let linkLen = 0;
    let pCount = 0;

    for (const b of blocks) {
      if (b.closest('[data-kct-ui], nav, footer, aside, [role="navigation"], [role="banner"], [role="complementary"], pre, code, script, style')) {
        continue;
      }
      const txt = String(b.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt.length < 4) continue;
      textLen += txt.length;
      if (b.tagName === 'P' && txt.length >= 25) pCount += 1;

      const links = b.querySelectorAll('a');
      for (const a of links) {
        linkLen += String(a.textContent || '').replace(/\s+/g, ' ').trim().length;
      }
    }

    // Modern SPA fallback: when semantic containers use div/span instead of <p>
    if (textLen < 30) {
      let sampled = 0;
      const leaves = el.querySelectorAll('div, span');
      for (const node of leaves) {
        if (sampled >= 80) break;
        if (node.querySelector('div, p, li, nav, footer, aside, header')) continue;
        if (node.closest('[data-kct-ui], nav, footer, aside, [role="navigation"], [role="banner"], [role="complementary"], pre, code, script, style, button')) {
          continue;
        }
        const txt = String(node.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt.length < 12 || PURE_METADATA_REGEX.test(txt)) continue;
        textLen += txt.length;
        sampled += 1;
        if (node.closest('a')) linkLen += txt.length;
      }
    }

    if (textLen < 30) {
      return { score: textLen * 0.1, textLen, linkRatio: 1 };
    }

    const linkRatio = Math.min(1, linkLen / textLen);
    let score = textLen + pCount * 40;
    if (linkRatio > 0.55) {
      score *= Math.max(0.05, 1 - linkRatio);
    }

    if (
      el.tagName === 'ARTICLE' ||
      el.id === 'mw-content-text' ||
      el.matches('.markdown-body, .rst-content, .post-content, .article-content, .entry-content, .vp-doc, .theme-doc-markdown, [itemprop="articleBody"]')
    ) {
      score *= 1.25;
    }

    return { score, textLen, linkRatio };
  }

  function findContentRoots(scope) {
    if (scope === 'all') {
      return [document.body].filter(Boolean);
    }

    // Generic interactive IDE shell skip: cells live inside the editor's embedded iframe
    if (isTopFrame() && document.querySelector('[data-testid="notebook-editor-render-tid"]')) {
      return [];
    }

    // Dedicated multi-page document viewer containers (e.g. Google Drive PDF Viewer)
    const gdrivePages = Array.from(document.querySelectorAll('.ndfHFb-c4YZDc-cYSp0e-DARUcf'));
    if (gdrivePages.length > 0) {
      return [document.body];
    }
    const gdrivePdfRoot = document.querySelector(
      '.ndfHFb-c4YZDc-cYSp0e-DARUcf-gSKZZ, .ndfHFb-c4YZDc-cYSp0e-s2gQvd'
    );
    if (gdrivePdfRoot && isElementVisible(gdrivePdfRoot)) {
      return [document.body];
    }

    // Dedicated embedded rendered-cell containers (e.g. Jupyter / Notebook outputs)
    const cells = Array.from(document.querySelectorAll(LESSON_CELL_SELECTOR)).filter(
      (node) => isElementVisible(node) && !node.closest('[data-testid="notebook-editor-render-tid"]')
    );
    if (cells.length > 0) {
      const dedupedCells = dedupeTopmost(cells);
      const h1 = document.querySelector('main h1');
      if (h1 && isElementVisible(h1) && !dedupedCells.some((c) => c.contains(h1))) {
        return [h1, ...dedupedCells];
      }
      return dedupedCells;
    }

    // Universal main-content detection via semantic containers + Readability scoring
    const semanticNodes = Array.from(document.querySelectorAll(SEMANTIC_ROOT_SELECTOR)).filter(
      (node) =>
        isElementVisible(node) &&
        !node.closest('[data-kct-ui], [data-testid="notebook-editor-render-tid"], nav, footer, aside, [role="navigation"], [role="complementary"]')
    );

    if (semanticNodes.length > 0) {
      const scored = semanticNodes
        .map((node) => ({ node, ...scoreReadabilityContainer(node) }))
        .filter((item) => item.score >= 30);

      if (scored.length > 0) {
        // Prefer tighter inner semantic containers (e.g. <article> inside <main>) when they capture main content cleanly
        const refined = scored.filter((outer) => {
          const betterInner = scored.some((inner) => (
            inner !== outer &&
            outer.node.contains(inner.node) &&
            inner.textLen >= outer.textLen * 0.65 &&
            inner.linkRatio <= outer.linkRatio + 0.08
          ));
          return !betterInner;
        });

        const maxScore = Math.max(...refined.map((x) => x.score));
        const winners = refined
          .filter((x) => x.score >= Math.max(40, maxScore * 0.25))
          .map((x) => x.node);

        const dedupedWinners = dedupeTopmost(winners);
        if (dedupedWinners.length > 0) {
          const topH1 = document.querySelector('#firstHeading, main h1, article h1, [role="main"] h1');
          if (topH1 && isElementVisible(topH1) && !dedupedWinners.some((w) => w.contains(topH1))) {
            return [topH1, ...dedupedWinners];
          }
          return dedupedWinners;
        }
      }
    }

    // Readability fallback on div/section containers for non-semantic layouts
    if (document.body) {
      const rawCandidates = [];
      const seenParents = new Set();
      const paragraphs = document.querySelectorAll('p, blockquote');
      for (const p of paragraphs) {
        if (p.closest('[data-kct-ui], nav, header, footer, aside, [role="navigation"], [role="banner"], [role="complementary"]')) {
          continue;
        }
        const parent = p.parentElement;
        if (!parent || parent === document.body || seenParents.has(parent)) continue;
        seenParents.add(parent);
        rawCandidates.push(parent);
        if (rawCandidates.length >= 60) break;
      }

      if (rawCandidates.length > 0) {
        const scoredFallback = rawCandidates
          .map((node) => ({ node, ...scoreReadabilityContainer(node) }))
          .filter((x) => x.score >= 120 && x.linkRatio <= 0.55)
          .sort((a, b) => b.score - a.score);

        if (scoredFallback.length > 0) {
          const topScore = scoredFallback[0].score;
          const selected = scoredFallback
            .filter((x) => x.score >= topScore * 0.35)
            .slice(0, 6)
            .map((x) => x.node);
          const deduped = dedupeTopmost(selected);
          if (deduped.length > 0) return deduped;
        }
      }

      return [document.body];
    }

    return [];
  }

  function queryAllDeep(root, selector, depth = 0) {
    const results = [];
    if (!root || depth > 5) return results;

    if (root.nodeType === Node.ELEMENT_NODE) {
      if (root.matches(SHADOW_SKIP_SELECTOR)) return results;
      if (root.matches(selector)) {
        results.push(root);
      }
    }

    try {
      const directMatches = root.querySelectorAll(selector);
      for (const el of directMatches) {
        results.push(el);
      }
    } catch (_) {
      return results;
    }

    if (depth >= 5) return results;

    // Traverse open shadowRoot hosts without entering skipped subtrees
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node.matches && node.matches(SHADOW_SKIP_SELECTOR)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let current;
    while ((current = walker.nextNode())) {
      if (current.shadowRoot) {
        const nested = queryAllDeep(current.shadowRoot, selector, depth + 1);
        for (const item of nested) {
          results.push(item);
        }
      }
    }

    return results;
  }

  function shouldTranslateText(text, targetLangId = 'zh-TW') {
    const clean = String(text || '').replace(/\[\[\s*[CM]\d+\s*\]\]/g, '').trim();
    if (clean.length < 2) return false;

    // Skip URLs, emails, file paths, and Jupyter cell prompts
    if (/^(?:https?:\/\/|mailto:|ftp:\/\/)\S+$/i.test(clean)) return false;
    if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(clean)) return false;
    if (/^(?:\/[\w.@+-]+){2,}\/?$/.test(clean)) return false;
    if (/^[a-zA-Z]:\\[\w\\.-]+$/.test(clean)) return false;
    if (/^(In|Out)\s*\[\s*\d*\s*\]:?$/i.test(clean)) return false;

    // Skip ASCII single-token code identifiers like train_test_split or model.fit(X, y)
    const isAsciiOnly = /^[\x00-\x7F]+$/.test(clean);
    if (isAsciiOnly) {
      if (clean.length < 3) return false;
      if (!/[a-zA-Z]{2,}/.test(clean)) return false;
      if (!/\s/.test(clean) && /[_().=<>[\]{}:/\\]/.test(clean)) return false;
    }

    const letters = clean.match(/\p{L}/gu) || [];
    if (letters.length < 2) return false;

    const letterTotal = letters.length;
    const hanCount = (clean.match(/\p{Script=Han}/gu) || []).length;
    const kanaCount = (clean.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
    const hangulCount = (clean.match(/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/g) || []).length;

    const target = String(targetLangId || 'zh-TW');

    if (target === 'zh-TW' || target === 'zh-CN') {
      // If text has meaningful Hiragana/Katakana, it is Japanese -> DO translate into Chinese
      if (kanaCount / letterTotal >= 0.12) {
        return true;
      }
      const cjkRatio = hanCount / letterTotal;
      if (cjkRatio >= 0.55) {
        // Check if there is still a substantial foreign sentence mixed in (e.g. >= 6 Latin words)
        const latinWords = clean.match(/[a-zA-Z]{2,}/g) || [];
        if (latinWords.length < 6) {
          return false;
        }
      }
    } else if (target === 'ja') {
      const kanaRatio = kanaCount / letterTotal;
      const jpRatio = (hanCount + kanaCount) / letterTotal;
      if (kanaRatio >= 0.15 && jpRatio >= 0.45) {
        return false;
      }
    } else if (target === 'ko') {
      if (hangulCount / letterTotal >= 0.45) {
        return false;
      }
    }

    return true;
  }

  function probeTypography(el) {
    const style = getComputedStyle(el);
    const origFontFamily = style.fontFamily || '';
    const ffLower = origFontFamily.toLowerCase();

    let archetype = 'sans';
    if (/(?:^|[\s,'"])(?:mono|monospace|consolas|menlo|monaco|courier|fira\s*code|jetbrains|sfmono|inconsolata|source\s*code|roboto\s*mono|ibm\s*plex\s*mono)/i.test(ffLower)) {
      archetype = 'mono';
    } else {
      const withoutSans = ffLower.replace(/sans-serif/g, '');
      if (/(?:serif|georgia|times|garamond|palatino|charter|merriweather|newsreader|playfair|libre\s*baskerville|baskerville|cambria|minion|source\s*serif|noto\s*serif|pt\s*serif|lora|eb\s*garamond|crimson|mincho|songti|mingliu|pmingliu|simsun)/i.test(withoutSans)) {
        archetype = 'serif';
      }
    }

    let needsLineHeightLift = false;
    if (PROSE_TAGS.has(el.tagName)) {
      const lineClamp = style.webkitLineClamp || style.getPropertyValue('-webkit-line-clamp');
      const isClamped = Boolean(lineClamp && lineClamp !== 'none' && lineClamp !== '0');
      if (!isClamped) {
        const fs = parseFloat(style.fontSize);
        const lh = parseFloat(style.lineHeight);
        if (Number.isFinite(fs) && fs > 0 && Number.isFinite(lh) && (lh / fs) < 1.62) {
          needsLineHeightLift = true;
        }
      }
    }

    return {
      archetype,
      needsLineHeightLift,
      origFontFamily
    };
  }

  function extractBlockContent(el) {
    const placeholders = new Map();
    let codeIdx = 0;
    let mathIdx = 0;
    let linkIdx = 0;
    let nestedListEl = null;
    const parts = [];

    function walk(node, insideLiRoot) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.nodeValue);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      if (node.matches('[data-kct-ui]')) return;

      // For <li>, stop before nested <ul>/<ol> so we only translate the parent bullet's own text
      if (insideLiRoot && (node.tagName === 'UL' || node.tagName === 'OL')) {
        if (!nestedListEl) nestedListEl = node;
        return;
      }

      if (node.matches(INLINE_PROTECT_SELECTOR)) {
        const isMath = node.matches('.katex, .MathJax, mjx-container, math, .mwe-math-element, sup.reference');
        const token = isMath ? `[[M${mathIdx++}]]` : `[[C${codeIdx++}]]`;
        placeholders.set(token, node);
        parts.push(token);
        return;
      }

      if (node.tagName === 'A' && node !== el && node.hasAttribute('href')) {
        const aText = String(node.textContent || '').replace(/\s+/g, ' ').trim();
        if (aText && (aText.length <= 28 || !shouldTranslateText(aText))) {
          const token = `[[L${linkIdx++}]]`;
          placeholders.set(token, node);
          parts.push(token);
          return;
        }
      }

      if (node.tagName === 'BR') {
        parts.push('\n');
        return;
      }

      if (node.matches('script, style, noscript, svg, canvas, textarea, input, select, .anchor-link, .jp-InternalAnchorLink, .material-icons, .material-symbols-outlined, .material-symbols-rounded, .google-symbols, [aria-hidden="true"]')) {
        return;
      }

      for (const child of node.childNodes) {
        walk(child, insideLiRoot);
      }
    }

    const isLi = el.tagName === 'LI';
    for (const child of el.childNodes) {
      walk(child, isLi);
    }

    let text = parts.join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (/^H[1-6]$/.test(el.tagName)) {
      text = text.replace(/\s*¶\s*$/g, '').trim();
    }
    return { text, placeholders, nestedListEl };
  }

  function parsePctBoxStyle(styleStr) {
    if (!styleStr) return null;
    const get = (k) => {
      const m = styleStr.match(new RegExp(`(?:^|;|\\s)${k}\\s*:\\s*([\\d.]+)%`, 'i'));
      return m ? parseFloat(m[1]) : null;
    };
    const left = get('left');
    const top = get('top');
    const width = get('width');
    const height = get('height');
    if (left === null || top === null || width === null || height === null) return null;
    return { left, top, width, height };
  }

  const PDF_TOC_LINE_REGEX = /^(.*\p{L}.*?)[\s.·•…_\-–—]+(\d{1,4}|[ivxlcdm]{1,7})$/iu;

  // Table-of-contents rows ("Title ........ 12") are single lines whose page numbers share one right edge.
  // Require >= 3 aligned rows on the same page so body lines that merely end in a number are never caught.
  function detectPdfTocEntries(groups) {
    const result = new Map();
    const candidates = [];
    for (const g of groups) {
      if (g.lineCount !== 1) continue;
      const m = g.text.match(PDF_TOC_LINE_REGEX);
      if (!m) continue;
      const title = m[1].replace(/[\s.·•…_]+$/u, '').trim();
      if (title.length < 2) continue;
      candidates.push({ g, title, num: m[2], right: g.left + g.width });
    }
    if (candidates.length < 3) return result;

    const rights = candidates.map((c) => c.right).sort((a, b) => a - b);
    const medianRight = rights[Math.floor(rights.length / 2)];
    const aligned = candidates.filter((c) => Math.abs(c.right - medianRight) <= 1.2);
    if (aligned.length < 3) return result;

    for (const c of aligned) {
      result.set(c.g, { title: c.title, num: c.num });
    }
    return result;
  }

  function preparePdfOverlayLayers(roots) {
    const searchRoots = Array.isArray(roots) && roots.length > 0 ? roots : [document.body];
    const layerSelector = '.ndfHFb-c4YZDc-cYSp0e-DARUcf-Df1ZY-bN97Pc-haAclf';
    const layers = new Set();

    for (const r of searchRoots) {
      if (!r || r.nodeType !== Node.ELEMENT_NODE) continue;
      if (r.matches && r.matches(layerSelector)) layers.add(r);
      const found = r.querySelectorAll ? r.querySelectorAll(layerSelector) : [];
      for (const l of found) layers.add(l);
    }

    for (const layer of layers) {
      layer.setAttribute('data-kct-pdf-layer', '1');
      const ps = Array.from(layer.querySelectorAll('p'));
      if (ps.length === 0) continue;

      if (
        layer.getAttribute('data-kct-pdf-merged-count') === String(ps.length) &&
        layer.querySelector('p[data-kct-pdf-block="1"]')
      ) {
        continue;
      }

      // Skip if any <p> in this layer is already wrapped with active translation spans
      if (layer.querySelector('p[data-kct-has-trans="1"]')) {
        continue;
      }

      const items = [];
      for (const p of ps) {
        if (!p.hasAttribute('data-kct-orig-style')) {
          p.setAttribute('data-kct-orig-style', p.getAttribute('style') || '');
        }
        if (!p.hasAttribute('data-kct-orig-text')) {
          p.setAttribute('data-kct-orig-text', p.textContent || '');
        }
        p.removeAttribute('data-kct-pdf-merged');
        p.removeAttribute('data-kct-pdf-block');

        const origStyle = p.getAttribute('data-kct-orig-style') || '';
        const box = parsePctBoxStyle(origStyle);
        const origText = (p.getAttribute('data-kct-orig-text') || '').replace(/\s+/g, ' ').trim();
        if (!box || !origText) continue;

        items.push({
          el: p,
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          text: origText
        });
      }

      if (items.length === 0) continue;

      items.sort((a, b) => (Math.abs(a.top - b.top) > 0.55 ? a.top - b.top : a.left - b.left));

      const groups = [];
      for (const item of items) {
        let matchedGroup = null;
        for (let gi = groups.length - 1; gi >= 0; gi--) {
          const candidate = groups[gi];
          const prevBottom = candidate.top + candidate.height;
          const vGap = item.top - prevBottom;
          if (vGap > 1.2 * Math.max(candidate.avgLineH, item.height, 1)) {
            continue;
          }
          const hRatio = Math.abs(item.height - candidate.avgLineH) / Math.max(item.height, candidate.avgLineH, 0.1);
          const leftDiff = Math.abs(item.left - candidate.left);
          const isTocLine = /\s+\d{1,3}$/.test(candidate.lastLineText) || /\s+\d{1,3}$/.test(item.text);
          const colEndThreshold = candidate.width > 50 ? 44 : candidate.width * 0.72;
          const prevEndedShort = candidate.lastWidth < colEndThreshold && /[.!?。！？]$/.test(candidate.text);

          if (
            !isTocLine &&
            !prevEndedShort &&
            hRatio <= 0.36 &&
            leftDiff <= 3.6 &&
            vGap >= -0.45 * candidate.avgLineH &&
            vGap <= 0.88 * candidate.avgLineH
          ) {
            matchedGroup = candidate;
            break;
          }
        }

        if (matchedGroup) {
          const prevBottom = matchedGroup.top + matchedGroup.height;
          const newLeft = Math.min(matchedGroup.left, item.left);
          const newRight = Math.max(matchedGroup.left + matchedGroup.width, item.left + item.width);
          const newBottom = Math.max(prevBottom, item.top + item.height);
          matchedGroup.left = newLeft;
          matchedGroup.width = newRight - newLeft;
          matchedGroup.height = newBottom - matchedGroup.top;
          matchedGroup.avgLineH = (matchedGroup.avgLineH * matchedGroup.lineCount + item.height) / (matchedGroup.lineCount + 1);
          matchedGroup.lineCount += 1;
          matchedGroup.lastWidth = item.width;
          matchedGroup.lastLineText = item.text;
          matchedGroup.lastTop = item.top;
          matchedGroup.text = matchedGroup.text.endsWith('-') && /^[a-z]/.test(item.text)
            ? matchedGroup.text.slice(0, -1) + item.text
            : `${matchedGroup.text} ${item.text}`;
          matchedGroup.members.push(item);
          continue;
        }

        groups.push({
          left: item.left,
          top: item.top,
          width: item.width,
          height: item.height,
          avgLineH: item.height,
          lineCount: 1,
          lastWidth: item.width,
          lastLineText: item.text,
          lastTop: item.top,
          text: item.text,
          members: [item]
        });
      }

      const tocEntries = detectPdfTocEntries(groups);

      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        let nearestBelowTop = 98.5;
        for (let oj = 0; oj < groups.length; oj++) {
          if (gi === oj) continue;
          const other = groups[oj];
          if (other.top < g.top + g.height - 0.4) continue;
          const xOverlap = Math.min(g.left + g.width, other.left + other.width) - Math.max(g.left, other.left);
          if (xOverlap > 1.5 && other.top < nearestBelowTop) {
            nearestBelowTop = other.top;
          }
        }
        const safeHeight = Math.max(g.height, Math.min(g.height + g.avgLineH * 0.45, nearestBelowTop - g.top - 0.25));
        const primary = g.members[0].el;
        primary.setAttribute(
          'style',
          `left: ${g.left.toFixed(4)}%; top: ${g.top.toFixed(4)}%; width: ${g.width.toFixed(4)}%; height: ${safeHeight.toFixed(4)}%;`
        );
        primary.setAttribute('data-kct-pdf-block', '1');
        primary.setAttribute('data-kct-pdf-lines', String(g.lineCount));
        primary.setAttribute('data-kct-pdf-line-h', g.avgLineH.toFixed(4));
        primary.setAttribute(
          'data-kct-pdf-box',
          `${g.left.toFixed(3)},${g.top.toFixed(3)},${g.width.toFixed(3)},${g.height.toFixed(3)}`
        );
        const pitch = g.lineCount > 1 ? (g.lastTop - g.top) / (g.lineCount - 1) : 0;
        if (pitch > 0) {
          primary.setAttribute('data-kct-pdf-pitch', pitch.toFixed(4));
        } else {
          primary.removeAttribute('data-kct-pdf-pitch');
        }

        const toc = tocEntries.get(g);
        if (toc) {
          // Translate only the entry title; the page number + dot leader are re-drawn natively by the renderer
          primary.setAttribute('data-kct-pdf-toc', '1');
          primary.setAttribute('data-kct-pdf-toc-num', toc.num);
          primary.textContent = toc.title;
        } else {
          primary.removeAttribute('data-kct-pdf-toc');
          primary.removeAttribute('data-kct-pdf-toc-num');
          primary.textContent = g.text;
        }

        for (let i = 1; i < g.members.length; i++) {
          const absorbed = g.members[i].el;
          absorbed.setAttribute('data-kct-pdf-merged', 'absorbed');
        }
      }

      layer.setAttribute('data-kct-pdf-merged-count', String(ps.length));
      delete layer._kctTypoKey; // blocks changed: re-measure native glyph sizes on next fit
    }
  }

  function restorePdfOverlayLayers(root = document) {
    const layers = root.querySelectorAll ? root.querySelectorAll('[data-kct-pdf-layer="1"]') : [];
    for (const layer of layers) {
      layer.removeAttribute('data-kct-pdf-merged-count');
      const ps = layer.querySelectorAll('p[data-kct-orig-style], p[data-kct-orig-text]');
      for (const p of ps) {
        if (p.hasAttribute('data-kct-orig-style')) {
          p.setAttribute('style', p.getAttribute('data-kct-orig-style') || '');
          p.removeAttribute('data-kct-orig-style');
        }
        if (p.hasAttribute('data-kct-orig-text')) {
          p.textContent = p.getAttribute('data-kct-orig-text') || '';
          p.removeAttribute('data-kct-orig-text');
        }
        p.removeAttribute('data-kct-pdf-block');
        p.removeAttribute('data-kct-pdf-lines');
        p.removeAttribute('data-kct-pdf-line-h');
        p.removeAttribute('data-kct-pdf-box');
        p.removeAttribute('data-kct-pdf-merged');
        p.removeAttribute('data-kct-pdf-pitch');
        p.removeAttribute('data-kct-pdf-toc');
        p.removeAttribute('data-kct-pdf-toc-num');
        p.removeAttribute('data-kct-pdf-typo-key');
        p.removeAttribute('data-kct-pdf-fs-pct');
        p.removeAttribute('data-kct-pdf-bold');
        p.removeAttribute('data-kct-pdf-toc-leader');
        p.style.removeProperty('--kct-pdf-bg');
        p.style.removeProperty('--kct-pdf-fg');
      }
      layer.removeAttribute('data-kct-pdf-layer');
      delete layer._kctTypoKey;
    }
  }

  function shouldSkipBlock(el, scope, elementState) {
    if (!el || !el.isConnected) return true;
    if (el.getAttribute('data-kct-pdf-merged') === 'absorbed') return true;
    if (el.classList && el.classList.contains('ndfHFb-c4YZDc-cYSp0e-DARUcf-Df1ZY-tJHJj')) return true;
    if (elementState && elementState.has(el)) return true;
    if (el.closest(SKIP_ANCESTOR_SELECTOR)) return true;
    if (scope !== 'all' && isInsideExcludedChrome(el)) return true;
    if (!isElementVisible(el)) return true;

    if (el.hasAttribute('data-kct-has-trans') || el.querySelector('[data-kct-ui="trans"]')) return true;

    // Leaf-block check: if element contains child block elements (other than nested ul/ol in li), let child blocks handle it
    const nestedSelector = el.tagName === 'LI'
      ? 'p, h1, h2, h3, h4, h5, h6, blockquote, td, th'
      : 'p, h1, h2, h3, h4, h5, h6, blockquote, td, th, li, dt, dd';
    const childBlock = el.querySelector(nestedSelector);
    if (childBlock && childBlock !== el) {
      return true;
    }

    return false;
  }

  function hasClaimedAncestor(el, claimedSet) {
    let cur = el.parentElement;
    if (!cur && el.getRootNode) {
      const root = el.getRootNode();
      if (root instanceof ShadowRoot) cur = root.host;
    }
    while (cur) {
      if (claimedSet.has(cur)) return true;
      if (cur.parentElement) {
        cur = cur.parentElement;
      } else if (cur.getRootNode) {
        const root = cur.getRootNode();
        cur = root instanceof ShadowRoot ? root.host : null;
      } else {
        cur = null;
      }
    }
    return false;
  }

  function isMeaningfulLeafText(text) {
    const clean = String(text || '')
      .replace(/\[\[\s*[CM]\d+\s*\]\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return false;
    if (PURE_METADATA_REGEX.test(clean)) return false;

    if (clean.length >= 12) return true;
    const asciiWords = clean.match(/[a-zA-Z]{2,}/g) || [];
    if (asciiWords.length >= 3) return true;
    const cjkLetters = clean.match(/[\p{Script=Han}\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/gu) || [];
    if (cjkLetters.length >= 4) return true;

    return false;
  }

  function collectUniversalCandidateElements(roots, scope, elementState) {
    if (!Array.isArray(roots) || roots.length === 0) return [];

    preparePdfOverlayLayers(roots);

    const claimedSet = new Set();
    const pass1 = [];
    const pass2 = [];

    // Pass 1: Semantic prose & structure blocks
    for (const root of roots) {
      if (!root) continue;
      const semanticCandidates = queryAllDeep(root, BLOCK_SELECTOR);
      for (const el of semanticCandidates) {
        if (claimedSet.has(el)) continue;
        if (shouldSkipBlock(el, scope, elementState)) continue;
        claimedSet.add(el);
        pass1.push(el);
      }
    }

    // Pass 2: Universal div / span / a / label leaf text blocks for modern SPAs (ordered cheapest-first)
    const tryClaimLeaf = (el) => {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
      if (!LEAF_CANDIDATE_TAGS.has(el.tagName)) return false;
      if (el.shadowRoot) return false; // Never wrap a Shadow DOM host or its slotted projection breaks
      if (claimedSet.has(el) || hasClaimedAncestor(el, claimedSet)) return false;
      if (elementState && elementState.has(el)) return false;
      if (el.hasAttribute('data-kct-has-trans')) return false;

      const rawText = String(el.textContent || '').trim();
      if (rawText.length < 4) return false;

      if (el.querySelector(CHILD_BLOCK_SELECTOR)) return false;
      if (el.querySelector(LEAF_FORBIDDEN_DESCENDANT_SELECTOR)) return false;
      if (el.querySelector('[data-kct-ui="trans"]')) return false;
      if (el.closest(SKIP_ANCESTOR_SELECTOR)) return false;
      if (scope !== 'all' && (isInsideExcludedChrome(el) || el.closest(LEAF_UI_CONTROL_SELECTOR))) {
        return false;
      }

      // If a <div> or <span> only wraps <a> link(s) with no own substantial text outside links,
      // defer to the <a> element(s) so hyperlinks remain clickable in replace mode
      if ((el.tagName === 'DIV' || el.tagName === 'SPAN') && el.querySelector('a[href]')) {
        let ownTextLen = 0;
        for (const cn of el.childNodes) {
          if (cn.nodeType === Node.TEXT_NODE) {
            ownTextLen += cn.nodeValue.trim().length;
          }
        }
        if (ownTextLen < 4) return false;
      }

      if (!isElementVisible(el)) return false;

      const { text } = extractBlockContent(el);
      if (!isMeaningfulLeafText(text)) return false;

      claimedSet.add(el);
      pass2.push(el);
      return true;
    };

    const walkLeafCandidates = (rootNode, depth = 0) => {
      if (!rootNode || depth > 5) return;

      if (rootNode.nodeType === Node.ELEMENT_NODE) {
        if (
          claimedSet.has(rootNode) ||
          (elementState && elementState.has(rootNode)) ||
          rootNode.matches('[data-kct-ui], [data-kct-has-trans]') ||
          rootNode.matches(SKIP_ANCESTOR_SELECTOR)
        ) {
          return;
        }
        if (tryClaimLeaf(rootNode)) {
          return;
        }
      }

      const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
          if (claimedSet.has(node)) return NodeFilter.FILTER_REJECT;
          if (elementState && elementState.has(node)) return NodeFilter.FILTER_REJECT;
          if (node.matches && (
            node.matches('[data-kct-ui], [data-kct-has-trans]') ||
            node.matches(SKIP_ANCESTOR_SELECTOR)
          )) {
            return NodeFilter.FILTER_REJECT;
          }
          if (scope !== 'all' && node.matches && node.matches(NAV_EXCLUDE_SELECTOR)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      let current;
      while ((current = walker.nextNode())) {
        if (current.shadowRoot && depth < 5) {
          walkLeafCandidates(current.shadowRoot, depth + 1);
        }
        tryClaimLeaf(current);
      }
    };

    for (const root of roots) {
      if (!root) continue;
      walkLeafCandidates(root, 0);
    }

    if (pass2.length === 0) return pass1;
    if (pass1.length === 0) return pass2;

    const combined = [...pass1, ...pass2];
    combined.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return combined;
  }

  globalThis.KCTSiteAnalyzer = {
    BLOCK_SELECTOR,
    SKIP_ANCESTOR_SELECTOR,
    NAV_EXCLUDE_SELECTOR,
    LESSON_CELL_SELECTOR,
    COURSE_CONTAINER_SELECTOR,
    INLINE_PROTECT_SELECTOR,
    isTopFrame,
    isElementVisible,
    classifyPage,
    findContentRoots,
    queryAllDeep,
    shouldTranslateText,
    probeTypography,
    extractBlockContent,
    shouldSkipBlock,
    preparePdfOverlayLayers,
    restorePdfOverlayLayers,
    collectUniversalCandidateElements
  };
})();

(() => {
  if (globalThis.KCTCodeOverlay) return;

  const { hashText } = globalThis.KCTConfig;
  const { isElementVisible, shouldTranslateText } = globalThis.KCTSiteAnalyzer;

  const STATIC_COMMENT_SELECTOR = [
    'span.c1',
    'span.c',
    'span.cm',
    'span.cs',
    'span.ch',
    'span.token.comment',
    'span.hljs-comment',
    'span.pl-c'
  ].join(', ');

  const PRAGMA_COMMENT_REGEX = /^(?:type:\s*ignore|noqa\b|pylint:|pyright:|mypy:|eslint-|@ts-|prettier-ignore|noinspection|-\*-|coding[:=]|!\/|In\s*\[|Out\s*\[|%%\w+|%%|[-=*#_~]{3,}$)/i;

  function ensureAdapterState(state) {
    if (!state.commentState) state.commentState = new WeakMap();
    if (!state.cmOverlayBySpan) state.cmOverlayBySpan = new WeakMap();
    if (!state.cmSpanByOverlay) state.cmSpanByOverlay = new WeakMap();
    if (!state.commentCacheByBody) state.commentCacheByBody = new Map();
    return state;
  }

  function getTextOffsetInParent(parent, targetNode) {
    let offset = 0;
    const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (targetNode === node || targetNode.contains(node)) {
        return offset;
      }
      offset += node.nodeValue ? node.nodeValue.length : 0;
    }
    return -1;
  }

  function isCommentOffsetInPythonLine(lineText, targetOffset) {
    if (targetOffset < 0) return false;
    let quote = null;
    for (let i = 0; i < targetOffset; i++) {
      const ch = lineText[i];
      if (quote) {
        if (ch === '\\') {
          i += 1;
          continue;
        }
        if (quote.length === 3) {
          if (lineText.slice(i, i + 3) === quote) {
            quote = null;
            i += 2;
          }
        } else if (ch === quote) {
          quote = null;
        }
      } else {
        if (ch === '#') {
          return i === targetOffset;
        }
        const tri = lineText.slice(i, i + 3);
        if (tri === "'''" || tri === '"""') {
          quote = tri;
          i += 2;
        } else if (ch === "'" || ch === '"') {
          quote = ch;
        }
      }
    }
    return quote === null;
  }

  function parseTranslatableComment(rawText, targetLangId = 'zh-TW', allowSlash = false) {
    const raw = String(rawText || '');
    if (!raw || raw.includes('\n')) return null;

    const match = allowSlash
      ? raw.match(/^(\s*)(#+|\/\/+)(\s*)(.*)$/)
      : raw.match(/^(\s*)(#+)(\s*)(.*)$/);
    if (!match) return null;

    const [, leadWs, prefix, midWs, body] = match;
    const trimmedBody = body.trim();
    if (trimmedBody.length < 3) return null;
    if (PRAGMA_COMMENT_REGEX.test(trimmedBody)) return null;
    if (!shouldTranslateText(trimmedBody, targetLangId)) return null;

    return {
      leadWs,
      hashes: prefix,
      midWs: midWs || ' ',
      body: trimmedBody
    };
  }

  function ensureCodeFontSizeVar(containerEl, sampleSpan) {
    if (!containerEl || containerEl.dataset.kctFontMeasured === '1') return;
    const fs = getComputedStyle(sampleSpan).fontSize;
    if (fs && fs !== '0px') {
      containerEl.style.setProperty('--kct-code-font-size', fs);
      containerEl.dataset.kctFontMeasured = '1';
    }
  }

  function resolveOpaqueBackground(el) {
    let cur = el;
    while (cur && cur.nodeType === Node.ELEMENT_NODE) {
      const bg = getComputedStyle(cur).backgroundColor;
      if (bg && bg !== 'transparent') {
        const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\)/i);
        if (!m || m[4] === undefined || parseFloat(m[4]) > 0.85) {
          return m ? `rgb(${m[1]}, ${m[2]}, ${m[3]})` : bg;
        }
      }
      cur = cur.parentElement;
    }
    return document.body?.dataset?.jpThemeLight === 'false' ? '#202124' : '#ffffff';
  }

  function renderCmCommentOverlay(ed, span, fullComment, state) {
    if (!ed || !span || !ed.isConnected || !span.isConnected) return;
    const scroller = ed.querySelector('.cm-scroller');
    if (!scroller) return;

    if (getComputedStyle(scroller).position === 'static') {
      scroller.style.position = 'relative';
    }

    let layer = scroller.querySelector(':scope > [data-kct-ui="cm-layer"]');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'kct-cm-layer';
      layer.setAttribute('data-kct-ui', 'cm-layer');
      layer.setAttribute('translate', 'no');
      scroller.appendChild(layer);
    }

    const scRect = scroller.getBoundingClientRect();
    const spRect = span.getBoundingClientRect();
    if (spRect.width === 0 || spRect.height === 0) return;

    let badge = state.cmOverlayBySpan.get(span);
    if (!badge || !badge.isConnected || badge.parentElement !== layer) {
      badge = document.createElement('div');
      badge.className = 'kct-cm-comment';
      badge.setAttribute('data-kct-ui', 'cm-comment');
      badge.setAttribute('translate', 'no');
      layer.appendChild(badge);
      state.cmOverlayBySpan.set(span, badge);
    }
    state.cmSpanByOverlay.set(badge, span);

    const spanStyle = getComputedStyle(span);
    const top = Math.round(spRect.top - scRect.top + scroller.scrollTop);
    const left = Math.floor(spRect.left - scRect.left + scroller.scrollLeft);
    const height = Math.ceil(spRect.height);
    const minWidth = Math.ceil(spRect.width + 6);
    const availWidth = Math.max(minWidth, Math.floor(scroller.clientWidth - left - 10));

    badge.textContent = fullComment;
    badge.style.top = `${top}px`;
    badge.style.left = `${left}px`;
    badge.style.height = `${height}px`;
    badge.style.minWidth = `${minWidth}px`;
    badge.style.maxWidth = `${availWidth}px`;
    badge.style.fontSize = spanStyle.fontSize || '14px';
    badge.style.lineHeight = `${height}px`;
    badge.style.fontStyle = spanStyle.fontStyle || 'italic';
    badge.style.color = spanStyle.color;
    badge.style.backgroundColor = resolveOpaqueBackground(ed);
  }

  function syncCmOverlays(state, settingsOverride) {
    if (!state) return;
    ensureAdapterState(state);
    const settings = settingsOverride || state.settings;
    if (!settings || settings.translateCodeComments === false || settings.displayMode === 'original') return;

    const targetLangId = settings.targetLang || 'zh-TW';
    const activeSpans = new Set();
    const editors = document.querySelectorAll('.cm-editor');
    for (const ed of editors) {
      if (ed.closest('.jp-MarkdownCell') || !isElementVisible(ed)) continue;
      const lines = ed.querySelectorAll('.cm-line');
      for (const line of lines) {
        const lineText = line.textContent || '';
        if (!lineText.includes('#')) continue;
        const leafSpans = Array.from(line.querySelectorAll('span')).filter((s) => s.children.length === 0);
        const targets = leafSpans.length > 0 ? leafSpans : [line];
        for (const t of targets) {
          const info = parseTranslatableComment(t.textContent, targetLangId, false);
          if (!info) continue;
          const spanOffset = t === line ? info.leadWs.length : getTextOffsetInParent(line, t) + info.leadWs.length;
          if (!isCommentOffsetInPythonLine(lineText, spanOffset)) continue;
          const cached = state.commentCacheByBody.get(info.body);
          if (cached) {
            activeSpans.add(t);
            renderCmCommentOverlay(ed, t, `${info.leadWs}${info.hashes}${info.midWs}${cached}`, state);
          }
        }
      }
    }

    const layers = document.querySelectorAll('.kct-cm-layer');
    for (const layer of layers) {
      for (const badge of Array.from(layer.children)) {
        const linkedSpan = state.cmSpanByOverlay.get(badge);
        if (!linkedSpan || !linkedSpan.isConnected || !activeSpans.has(linkedSpan)) {
          badge.remove();
        }
      }
    }
  }

  function collectCodeComments(force, settings, state) {
    if (!settings || (!settings.enabled && !force) || settings.translateCodeComments === false) return [];
    ensureAdapterState(state);

    const targetLangId = settings.targetLang || 'zh-TW';
    const items = [];
    const seen = new Set();

    // 1. Static <pre> code blocks (Pygments, Prism, Highlight.js, GitHub PrettyLights)
    const pres = document.querySelectorAll('pre');
    for (const pre of pres) {
      if (pre.closest('.cm-editor, .CodeMirror, .monaco-editor, [data-kct-ui]')) continue;
      if (!isElementVisible(pre)) continue;
      const commentSpans = pre.querySelectorAll(STATIC_COMMENT_SELECTOR);
      for (const span of commentSpans) {
        if (seen.has(span) || state.commentState.has(span)) continue;
        if (span.hasAttribute('data-kct-comment-trans')) continue;
        if (span.children.length > 0) continue;
        seen.add(span);

        const info = parseTranslatableComment(span.textContent, targetLangId, true);
        if (!info) continue;

        ensureCodeFontSizeVar(pre, span);
        const cachedTrans = state.commentCacheByBody.get(info.body);
        if (cachedTrans) {
          span.setAttribute('data-kct-comment-trans', `${info.leadWs}${info.hashes}${info.midWs}${cachedTrans}`);
          state.commentState.set(span, 'done');
          continue;
        }

        state.commentState.set(span, 'queued');
        items.push({
          kind: 'comment',
          el: span,
          key: hashText(`COMMENT::${info.body}`),
          text: `# ${info.body}`,
          commentInfo: info
        });
      }
    }

    // 2. Interactive JupyterLab v4 CodeMirror 6 code cells (non-intrusive overlay layer)
    const cmEditors = document.querySelectorAll('.cm-editor');
    for (const ed of cmEditors) {
      if (ed.closest('.jp-MarkdownCell')) continue;
      if (!isElementVisible(ed)) continue;
      const lines = ed.querySelectorAll('.cm-line');
      for (const line of lines) {
        const lineText = line.textContent || '';
        if (!lineText.includes('#')) continue;

        const leafSpans = Array.from(line.querySelectorAll('span')).filter((s) => s.children.length === 0);
        if (leafSpans.length > 0) {
          for (const span of leafSpans) {
            if (seen.has(span)) continue;
            const info = parseTranslatableComment(span.textContent, targetLangId, false);
            if (!info) continue;

            const spanOffset = getTextOffsetInParent(line, span);
            const hashOffset = spanOffset + info.leadWs.length;
            if (!isCommentOffsetInPythonLine(lineText, hashOffset)) continue;

            seen.add(span);
            const cachedTrans = state.commentCacheByBody.get(info.body);
            if (cachedTrans) {
              renderCmCommentOverlay(ed, span, `${info.leadWs}${info.hashes}${info.midWs}${cachedTrans}`, state);
              state.commentState.set(span, 'done');
              continue;
            }
            if (state.commentState.has(span)) continue;

            state.commentState.set(span, 'queued');
            items.push({
              kind: 'comment',
              cmEditor: ed,
              el: span,
              key: hashText(`COMMENT::${info.body}`),
              text: `# ${info.body}`,
              commentInfo: info
            });
          }
        } else if (!seen.has(line)) {
          const info = parseTranslatableComment(lineText, targetLangId, false);
          if (info) {
            seen.add(line);
            const cachedTrans = state.commentCacheByBody.get(info.body);
            if (cachedTrans) {
              renderCmCommentOverlay(ed, line, `${info.leadWs}${info.hashes}${info.midWs}${cachedTrans}`, state);
              state.commentState.set(line, 'done');
              continue;
            }
            if (state.commentState.has(line)) continue;

            state.commentState.set(line, 'queued');
            items.push({
              kind: 'comment',
              cmEditor: ed,
              el: line,
              key: hashText(`COMMENT::${info.body}`),
              text: `# ${info.body}`,
              commentInfo: info
            });
          }
        }
      }
    }

    return items;
  }

  function renderCommentTranslation(job, settings, state) {
    ensureAdapterState(state);
    const { el, zh, commentInfo, cmEditor } = job;
    const cleaned = String(zh || '').replace(/^\s*(?:#+|\/\/+)\s*/, '').trim();
    if (cleaned && commentInfo?.body) {
      state.commentCacheByBody.set(commentInfo.body, cleaned);
    }
    if (!el || !el.isConnected) {
      return 'disconnected';
    }
    if (!cleaned) {
      state.commentState.delete(el);
      return 'empty';
    }

    const fullComment = `${commentInfo.leadWs}${commentInfo.hashes}${commentInfo.midWs}${cleaned}`;
    if (cmEditor && cmEditor.isConnected) {
      renderCmCommentOverlay(cmEditor, el, fullComment, state);
    } else {
      el.setAttribute('data-kct-comment-trans', fullComment);
    }
    state.commentState.set(el, 'done');
    return 'rendered';
  }

  function injectOutputTranslateButtons(settings, pageContext) {
    if (!settings || settings.showOutputTranslateBtn === false) return;
    if (typeof chrome === 'undefined' || !chrome?.runtime?.sendMessage) return;
    const targetLangId = settings.targetLang || 'zh-TW';
    const outputAreas = document.querySelectorAll(
      '.jp-OutputArea-output .jp-RenderedText, .output_subarea.output_text, .output_subarea.output_stream, .output_subarea.output_error'
    );
    for (const area of outputAreas) {
      if (area.dataset.kctOutputBound === '1') continue;
      if (area.closest('.dataframe, table.dataframe')) continue;
      const rawText = (area.innerText || area.textContent || '').trim();
      if (rawText.length < 6 || !shouldTranslateText(rawText, targetLangId)) continue;

      area.dataset.kctOutputBound = '1';
      area.classList.add('kct-output-host');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'kct-output-btn';
      btn.setAttribute('data-kct-ui', 'output-btn');
      btn.setAttribute('translate', 'no');
      btn.textContent = '譯';
      btn.title = '翻譯此執行輸出（如 Hint 提示 / Check 驗證 / 錯誤訊息）';

      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const existing = area.querySelector('.kct-output-trans');
        if (existing) {
          existing.remove();
          btn.textContent = '譯';
          return;
        }
        const clone = area.cloneNode(true);
        for (const uiNode of clone.querySelectorAll('[data-kct-ui]')) {
          uiNode.remove();
        }
        const latestText = (clone.innerText || clone.textContent || '').trim();
        btn.textContent = '翻譯中...';
        btn.disabled = true;
        try {
          const res = await chrome.runtime.sendMessage({
            type: 'TRANSLATE_SINGLE',
            mode: 'output',
            text: latestText.slice(0, 3500),
            pageContext: pageContext || undefined
          });
          const box = document.createElement('div');
          box.className = 'kct-output-trans';
          box.setAttribute('data-kct-ui', 'output-trans');
          box.setAttribute('translate', 'no');
          box.textContent = res?.ok ? res.zh : (res?.error || '翻譯失敗');
          area.appendChild(box);
          btn.textContent = '收起譯文';
        } catch (_) {
          btn.textContent = '重試';
        } finally {
          btn.disabled = false;
        }
      });

      area.appendChild(btn);
    }
  }

  function clearNotebookOverlays(state) {
    ensureAdapterState(state);
    const commentedEls = document.querySelectorAll('[data-kct-comment-trans]');
    for (const cel of commentedEls) {
      cel.removeAttribute('data-kct-comment-trans');
    }
    const cmLayers = document.querySelectorAll('[data-kct-ui="cm-layer"]');
    for (const layer of cmLayers) {
      layer.remove();
    }
    const outputUIs = document.querySelectorAll('[data-kct-ui="output-btn"], [data-kct-ui="output-trans"]');
    for (const ui of outputUIs) {
      ui.remove();
    }
    const outputHosts = document.querySelectorAll('.kct-output-host');
    for (const host of outputHosts) {
      host.classList.remove('kct-output-host');
      delete host.dataset.kctOutputBound;
    }
    // Reset WeakMaps completely so CodeMirror 6 comments & queued spans can be re-translated
    state.commentState = new WeakMap();
    state.cmOverlayBySpan = new WeakMap();
    state.cmSpanByOverlay = new WeakMap();
    state.commentCacheByBody.clear();
  }

  const codeOverlayApi = {
    STATIC_COMMENT_SELECTOR,
    parseTranslatableComment,
    collectCodeComments,
    renderCommentTranslation,
    syncCmOverlays,
    injectOutputTranslateButtons,
    clearNotebookOverlays,
    clearCodeOverlays: clearNotebookOverlays
  };

  globalThis.KCTCodeOverlay = codeOverlayApi;
  globalThis.KCTNotebookAdapter = codeOverlayApi;
})();

(() => {
  if (globalThis.KCTRenderer) return;

  const { resolveTargetLanguage } = globalThis.KCTConfig;
  const KCTSiteAnalyzer = globalThis.KCTSiteAnalyzer;

  const SHADOW_MODE_CSS = [
    ':host-context(html.kct-mode-replace) .kct-orig-wrap { display: none !important; }',
    ':host-context(html.kct-mode-replace) .kct-trans-wrap { display: contents; }',
    ':host-context(html.kct-mode-original) .kct-trans-wrap { display: none !important; }',
    ':host-context(html.kct-mode-original) .kct-orig-wrap { display: contents; }',
    ':host-context(html.kct-mode-bilingual) .kct-orig-wrap { display: contents; }',
    ':host-context(html.kct-mode-bilingual) .kct-trans-wrap { display: block; margin-top: 0.35em; padding-left: 10px; border-left: 2px solid rgba(148,163,184,0.45); font-size: 0.94em; line-height: 1.7; opacity: 0.88; }'
  ].join('\n');

  const GENERIC_FONT_TOKENS = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'ui-rounded',
    '-apple-system',
    'blinkmacsystemfont',
    'emoji',
    'math',
    'fangsong'
  ]);

  function sanitizeFontFamily(rawFont) {
    if (!rawFont) return '';
    // Split on commas outside quotes so we can strip generic catch-all families
    // (which would otherwise intercept CJK fallback before --kct-font-* is reached)
    // and avoid slicing mid-quote.
    const tokens = [];
    let buf = '';
    let quote = null;
    for (let i = 0; i < rawFont.length; i++) {
      const ch = rawFont[i];
      if (quote) {
        if (ch === '\\' && i + 1 < rawFont.length) {
          i += 1;
          continue;
        }
        if (ch === quote) quote = null;
        else buf += ch;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ',') {
        tokens.push(buf.trim());
        buf = '';
      } else {
        buf += ch;
      }
    }
    if (buf.trim()) tokens.push(buf.trim());

    const kept = [];
    for (const rawTok of tokens) {
      if (/[;:{}\\<>@`\r\n]/.test(rawTok)) continue;
      const clean = rawTok.replace(/["']/g, '').trim();
      if (!clean || clean.length > 60) continue;
      if (GENERIC_FONT_TOKENS.has(clean.toLowerCase())) continue;
      kept.push(/\s/.test(clean) ? `"${clean}"` : clean);
      if (kept.length >= 5) break;
    }
    return kept.join(', ');
  }

  function ensureShadowModeStyle(el) {
    const rootNode = el.getRootNode ? el.getRootNode() : null;
    if (!rootNode || !(rootNode instanceof ShadowRoot)) return;
    if (rootNode.querySelector('style[data-kct-ui="shadow-mode-style"]')) return;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-kct-ui', 'shadow-mode-style');
    styleEl.textContent = SHADOW_MODE_CSS;
    rootNode.appendChild(styleEl);
  }

  function detectPageDarkBackground() {
    if (
      document.body?.dataset?.jpThemeLight === 'false' ||
      document.documentElement?.getAttribute('data-theme') === 'dark' ||
      document.documentElement?.classList.contains('dark') ||
      document.body?.classList.contains('theme-dark')
    ) {
      return true;
    }
    const candidates = [document.body, document.documentElement].filter(Boolean);
    for (const el of candidates) {
      const bg = getComputedStyle(el).backgroundColor || '';
      const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
      if (m) {
        const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1;
        if (alpha < 0.15) continue;
        const r = Number(m[1]);
        const g = Number(m[2]);
        const b = Number(m[3]);
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return lum < 115;
      }
    }
    return false;
  }

  function applyDisplayModeClass(settings) {
    const root = document.documentElement;
    if (!root) return;

    root.classList.toggle('kct-active', settings?.enabled !== false);
    root.classList.toggle('kct-page-dark', detectPageDarkBackground());

    root.classList.remove('kct-mode-bilingual', 'kct-mode-replace', 'kct-mode-original');
    const resolvedMode = settings?.displayMode || 'replace';
    if (resolvedMode === 'original') {
      root.classList.add('kct-mode-original');
    } else if (resolvedMode === 'bilingual') {
      root.classList.add('kct-mode-bilingual');
    } else {
      root.classList.add('kct-mode-replace');
    }

    root.classList.toggle('kct-comments-on', settings?.translateCodeComments !== false);

    root.classList.remove('kct-lang-tc', 'kct-lang-sc', 'kct-lang-ja', 'kct-lang-ko', 'kct-lang-latin');
    const langInfo = resolveTargetLanguage(settings);
    root.classList.add(langInfo.fontClass || 'kct-lang-tc');

    root.classList.remove('kct-typo-native', 'kct-typo-system', 'kct-typo-preserve');
    const typoMode = settings?.typographyMatch || 'native';
    if (typoMode === 'system') {
      root.classList.add('kct-typo-system');
    } else if (typoMode === 'preserve') {
      root.classList.add('kct-typo-preserve');
    } else {
      root.classList.add('kct-typo-native');
    }
  }

  function buildTranslatedFragment(zhText, placeholders) {
    const frag = document.createDocumentFragment();
    const tokens = String(zhText || '').split(/(\[\[\s*[CML]\d+\s*\]\])/g);

    for (const part of tokens) {
      if (!part) continue;
      const m = part.match(/^\[\[\s*([CML]\d+)\s*\]\]$/);
      if (m && placeholders) {
        const canonical = `[[${m[1]}]]`;
        const origNode = placeholders.get(canonical);
        if (origNode) {
          frag.appendChild(origNode.cloneNode(true));
          continue;
        }
      }
      frag.appendChild(document.createTextNode(part));
    }
    return frag;
  }

  function needsInlineInjection(el) {
    const tag = el.tagName;
    if (tag === 'TD' || tag === 'TH' || tag === 'A' || tag === 'SPAN' || tag === 'BUTTON') {
      return true;
    }
    const display = getComputedStyle(el).display || '';
    if (display.includes('inline') || display.includes('flex') || display.includes('grid')) return true;
    const parent = el.parentElement;
    if (!parent) return false;
    const parentDisplay = getComputedStyle(parent).display || '';
    return parentDisplay.includes('flex') || parentDisplay.includes('grid');
  }

  function samplePdfImageColors(img, boxStr) {
    if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight || !boxStr) {
      return { bg: '#ffffff', fg: '#1e293b', ready: false };
    }
    const parts = boxStr.split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      return { bg: '#ffffff', fg: '#1e293b', ready: true };
    }
    const [leftPct, topPct, widthPct, heightPct] = parts;

    try {
      const W = 400;
      const H = 520;
      const srcKey = img.currentSrc || img.src || '';
      if (!img._kctSamplePixels || img._kctSampleSrc !== srcKey) {
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, W, H);
        img._kctSamplePixels = ctx.getImageData(0, 0, W, H).data;
        img._kctSampleSrc = srcKey;
      }
      const data = img._kctSamplePixels;
      const x0 = Math.max(0, Math.min(W - 1, Math.floor((leftPct / 100) * W)));
      const y0 = Math.max(0, Math.min(H - 1, Math.floor((topPct / 100) * H)));
      const x1 = Math.max(x0, Math.min(W - 1, Math.ceil(((leftPct + widthPct) / 100) * W)));
      const y1 = Math.max(y0, Math.min(H - 1, Math.ceil(((topPct + heightPct) / 100) * H)));

      const borderRs = [];
      const borderGs = [];
      const borderBs = [];
      const pushPixel = (px, py) => {
        const idx = (py * W + px) * 4;
        if (data[idx + 3] < 128) return;
        borderRs.push(data[idx]);
        borderGs.push(data[idx + 1]);
        borderBs.push(data[idx + 2]);
      };

      for (let x = x0; x <= x1; x += 2) {
        pushPixel(x, y0);
        pushPixel(x, y1);
      }
      for (let y = y0; y <= y1; y += 2) {
        pushPixel(x0, y);
        pushPixel(x1, y);
      }

      if (borderRs.length === 0) {
        return { bg: '#ffffff', fg: '#1e293b', ready: true };
      }
      borderRs.sort((a, b) => a - b);
      borderGs.sort((a, b) => a - b);
      borderBs.sort((a, b) => a - b);
      const mid = Math.floor(borderRs.length / 2);
      const bgR = borderRs[mid];
      const bgG = borderGs[mid];
      const bgB = borderBs[mid];
      const bgLum = 0.2126 * bgR + 0.7152 * bgG + 0.0722 * bgB;

      const contrastPixels = [];
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const idx = (y * W + x) * 4;
          if (data[idx + 3] < 128) continue;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const diff = Math.abs(lum - bgLum);
          if (diff >= 40) {
            contrastPixels.push({ r, g, b, lum, diff });
          }
        }
      }

      let fg = bgLum > 140 ? '#1e293b' : '#f8fafc';
      if (contrastPixels.length >= 3) {
        contrastPixels.sort((a, b) => b.diff - a.diff);
        const take = Math.max(2, Math.min(20, Math.ceil(contrastPixels.length * 0.08)));
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        for (let i = 0; i < take; i++) {
          sumR += contrastPixels[i].r;
          sumG += contrastPixels[i].g;
          sumB += contrastPixels[i].b;
        }
        let fgR = Math.round(sumR / take);
        let fgG = Math.round(sumG / take);
        let fgB = Math.round(sumB / take);
        const fgLum = 0.2126 * fgR + 0.7152 * fgG + 0.0722 * fgB;
        // Compensate for anti-aliased raster downsampling so body text stays crisp & readable
        if (bgLum > 160 && fgLum > 95) {
          const darken = fgLum > 135 ? 0.58 : 0.76;
          fgR = Math.round(fgR * darken);
          fgG = Math.round(fgG * darken);
          fgB = Math.round(fgB * darken);
        } else if (bgLum <= 95 && fgLum < 185) {
          fgR = Math.min(255, Math.round(fgR + (255 - fgR) * 0.45));
          fgG = Math.min(255, Math.round(fgG + (255 - fgG) * 0.45));
          fgB = Math.min(255, Math.round(fgB + (255 - fgB) * 0.45));
        }
        fg = `rgb(${fgR}, ${fgG}, ${fgB})`;
      }

      const bg = `rgb(${bgR}, ${bgG}, ${bgB})`;
      return { bg, fg, ready: true };
    } catch (_) {
      return { bg: '#ffffff', fg: '#1e293b', ready: true };
    }
  }

  // ---- Native glyph metrics measured from the rasterised PDF page image ----
  const PDF_LATIN_XHEIGHT_RATIO = 0.53; // x-height / em of typical Latin text faces
  const PDF_CJK_GLYPH_RATIO = 0.88;     // ink height / em of CJK source glyphs
  const PDF_TARGET_EM_SCALE = 0.94;     // CJK glyphs fill more of the em box than Latin, so step down slightly
  const PDF_SIZE_CLUSTER_TOLERANCE = 1.08;
  const PDF_BOLD_STROKE_RATIO = 1.3;

  function parsePdfBox(boxStr) {
    const parts = String(boxStr || '').split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
    return { left: parts[0], top: parts[1], width: parts[2], height: parts[3] };
  }

  function readInkGrid(ctx, canvas, img, sx, sy, sw, sh) {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    sx = Math.max(0, Math.min(nw - 1, Math.floor(sx)));
    sy = Math.max(0, Math.min(nh - 1, Math.floor(sy)));
    sw = Math.max(1, Math.min(nw - sx, Math.ceil(sw)));
    sh = Math.max(1, Math.min(nh - sy, Math.ceil(sh)));
    canvas.width = sw;
    canvas.height = sh;
    ctx.clearRect(0, 0, sw, sh);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    const lums = new Float32Array(sw * sh);
    const hist = new Uint32Array(256);
    for (let i = 0, j = 0; j < lums.length; i += 4, j += 1) {
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      lums[j] = lum;
      hist[Math.min(255, Math.round(lum))] += 1;
    }
    // Background = dominant luminance (the paper), robust to light-on-dark pages
    let bgLum = 255;
    let bgCount = -1;
    for (let v = 0; v < 256; v++) {
      if (hist[v] > bgCount) {
        bgCount = hist[v];
        bgLum = v;
      }
    }
    return { lums, sw, sh, bgLum };
  }

  function measurePdfBlockGlyphs(ctx, canvas, img, el) {
    const box = parsePdfBox(el.getAttribute('data-kct-pdf-box'));
    if (!box) return null;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const lineHPct = parseFloat(el.getAttribute('data-kct-pdf-line-h')) || box.height;
    const isToc = el.getAttribute('data-kct-pdf-toc') === '1';

    // Only the first line is needed; TOC rows only measure the title area so leader dots don't skew the result
    const widthFrac = isToc ? 0.3 : 1;
    const grid = readInkGrid(
      ctx,
      canvas,
      img,
      (box.left / 100) * nw,
      ((box.top - lineHPct * 0.2) / 100) * nh,
      Math.min((box.width * widthFrac / 100) * nw, 1400),
      (lineHPct * 1.4 / 100) * nh
    );
    const { lums, sw, sh, bgLum } = grid;
    const rowInk = new Uint32Array(sh);
    let runSum = 0;
    let runCount = 0;
    for (let y = 0; y < sh; y++) {
      let run = 0;
      for (let x = 0; x < sw; x++) {
        if (Math.abs(lums[y * sw + x] - bgLum) >= 70) {
          rowInk[y] += 1;
          run += 1;
        } else if (run) {
          runSum += run;
          runCount += 1;
          run = 0;
        }
      }
      if (run) {
        runSum += run;
        runCount += 1;
      }
    }

    let maxRow = 0;
    for (let y = 0; y < sh; y++) if (rowInk[y] > maxRow) maxRow = rowInk[y];
    if (maxRow < 3 || runCount < 6) return null;

    // x-height band = longest contiguous run of densely inked rows
    let best = 0;
    let cur = 0;
    for (let y = 0; y < sh; y++) {
      if (rowInk[y] >= maxRow * 0.4) {
        cur += 1;
        if (cur > best) best = cur;
      } else {
        cur = 0;
      }
    }
    if (best < 4) return null;

    const sourceText = el.getAttribute('data-kct-orig-text') || '';
    const cjk = (sourceText.match(/[\p{Script=Han}\u3040-\u30ff\uac00-\ud7af]/gu) || []).length;
    const glyphRatio = cjk > sourceText.length * 0.3 ? PDF_CJK_GLYPH_RATIO : PDF_LATIN_XHEIGHT_RATIO;

    const result = {
      fsPct: (best / glyphRatio / nh) * 100,
      strokeRatio: (runSum / runCount) / best,
      leader: null
    };

    if (isToc) {
      // Look for leader dots between the title and the page number (55%-85% of the row)
      const gap = readInkGrid(
        ctx,
        canvas,
        img,
        ((box.left + box.width * 0.55) / 100) * nw,
        (box.top / 100) * nh,
        (box.width * 0.3 / 100) * nw,
        (box.height / 100) * nh
      );
      let inkCols = 0;
      for (let x = 0; x < gap.sw; x++) {
        for (let y = 0; y < gap.sh; y++) {
          if (Math.abs(gap.lums[y * gap.sw + x] - gap.bgLum) >= 50) {
            inkCols += 1;
            break;
          }
        }
      }
      result.leader = inkCols >= gap.sw * 0.12 ? 'dots' : 'none';
    }
    return result;
  }

  function median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  // Measure every merged block of one page together, then snap near-equal sizes to one shared size so
  // sibling rows (TOC entries, body paragraphs) never drift apart just because Drive's text boxes differ.
  function ensurePdfLayerTypography(layer, img) {
    if (!layer || !img || !img.complete || !img.naturalWidth || !img.naturalHeight) return false;
    const blocks = Array.from(layer.querySelectorAll(':scope > p[data-kct-pdf-block="1"]'));
    const key = `${img.currentSrc || img.src}|${img.naturalWidth}x${img.naturalHeight}|${blocks.length}`;
    if (layer._kctTypoKey === key) return true;

    let canvas;
    let ctx;
    try {
      canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    } catch (_) {
      return false;
    }

    const measured = [];
    for (const el of blocks) {
      let m = null;
      try {
        m = measurePdfBlockGlyphs(ctx, canvas, img, el);
      } catch (_) {
        // Tainted or unreadable image: keep the geometric fallback for this layer
        layer._kctTypoKey = key;
        return false;
      }
      if (m) {
        measured.push({ el, ...m });
      } else {
        el.removeAttribute('data-kct-pdf-fs-pct');
        el.removeAttribute('data-kct-pdf-bold');
      }
    }

    // TOC entries always share one size
    const tocItems = measured.filter((m) => m.el.getAttribute('data-kct-pdf-toc') === '1');
    if (tocItems.length > 0) {
      const tocFs = median(tocItems.map((m) => m.fsPct));
      const dotted = tocItems.filter((m) => m.leader === 'dots').length;
      const sharedLeader = dotted * 2 >= tocItems.length ? 'dots' : 'none';
      for (const m of tocItems) {
        m.fsPct = tocFs;
        m.leader = sharedLeader; // one TOC = one leader style, even if a single row's sample was off
      }
    }

    // Cluster remaining sizes: consecutive values within ~8% collapse to their median
    const sorted = [...measured].sort((a, b) => a.fsPct - b.fsPct);
    let cluster = [];
    const flush = () => {
      if (cluster.length === 0) return;
      const shared = median(cluster.map((m) => m.fsPct));
      for (const m of cluster) m.fsPct = shared;
      cluster = [];
    };
    for (const m of sorted) {
      if (cluster.length > 0 && m.fsPct > cluster[0].fsPct * PDF_SIZE_CLUSTER_TOLERANCE) flush();
      cluster.push(m);
    }
    flush();

    const strokeBaseline = median(measured.map((m) => m.strokeRatio));
    for (const m of measured) {
      m.el.setAttribute('data-kct-pdf-fs-pct', m.fsPct.toFixed(4));
      if (strokeBaseline > 0 && m.strokeRatio >= strokeBaseline * PDF_BOLD_STROKE_RATIO) {
        m.el.setAttribute('data-kct-pdf-bold', '1');
      } else {
        m.el.removeAttribute('data-kct-pdf-bold');
      }
      if (m.leader) m.el.setAttribute('data-kct-pdf-toc-leader', m.leader);
    }

    layer._kctTypoKey = key;
    return true;
  }

  function appendPdfTocTail(el) {
    const num = el.getAttribute('data-kct-pdf-toc-num');
    const existing = el.querySelector(':scope > [data-kct-ui="toc"]');
    if (existing) existing.remove();
    if (!num) return;
    const tail = document.createElement('span');
    tail.className = 'kct-pdf-toc-tail';
    tail.setAttribute('data-kct-ui', 'toc');
    tail.setAttribute('translate', 'no');
    const leader = document.createElement('span');
    leader.className = 'kct-pdf-toc-leader';
    leader.setAttribute('aria-hidden', 'true');
    const numEl = document.createElement('span');
    numEl.className = 'kct-pdf-toc-num';
    numEl.textContent = num;
    tail.append(leader, numEl);
    el.appendChild(tail);
  }

  function styleAndFitPdfOverlayBlock(el) {
    if (!el || !el.isConnected || el.getAttribute('data-kct-pdf-block') !== '1') return;
    const layer = el.closest('[data-kct-pdf-layer="1"]');
    const pageContainer = layer?.parentElement || el.parentElement;
    const boxStr = el.getAttribute('data-kct-pdf-box') || '';

    const applyColorsFromImg = () => {
      if (!el.isConnected) return false;
      const img = pageContainer?.querySelector('img');
      const sampled = samplePdfImageColors(img, boxStr);
      el.style.setProperty('--kct-pdf-bg', sampled.bg);
      el.style.setProperty('--kct-pdf-fg', sampled.fg);
      if (!sampled.ready && img) {
        img.addEventListener('load', () => {
          const retry = samplePdfImageColors(img, boxStr);
          if (el.isConnected) {
            el.style.setProperty('--kct-pdf-bg', retry.bg);
            el.style.setProperty('--kct-pdf-fg', retry.fg);
          }
        }, { once: true });
      }
      return sampled.ready;
    };

    if (!applyColorsFromImg()) {
      setTimeout(applyColorsFromImg, 650);
    }

    const rectSource = layer || pageContainer;
    const pageH = rectSource?.getBoundingClientRect?.().height || 1035.5;
    const avgLineHPct = parseFloat(el.getAttribute('data-kct-pdf-line-h')) || 1.8;
    const lineCount = parseInt(el.getAttribute('data-kct-pdf-lines'), 10) || 1;
    const linePx = (avgLineHPct / 100) * pageH;
    const isToc = el.getAttribute('data-kct-pdf-toc') === '1';

    const img = pageContainer?.querySelector('img');
    const measuredReady = ensurePdfLayerTypography(layer, img);
    if (!measuredReady && img && !img.complete && !el._kctFitOnLoad) {
      el._kctFitOnLoad = true;
      img.addEventListener('load', () => {
        el._kctFitOnLoad = false;
        if (el.isConnected && el.hasAttribute('data-kct-has-trans')) styleAndFitPdfOverlayBlock(el);
      }, { once: true });
    }

    let fontSize;
    let lineHeight;
    let fontWeight = '400';
    const fsPct = parseFloat(el.getAttribute('data-kct-pdf-fs-pct'));

    if (Number.isFinite(fsPct) && fsPct > 0) {
      // Native size measured from the page raster
      fontSize = +((fsPct / 100) * pageH * PDF_TARGET_EM_SCALE).toFixed(2);
      fontWeight = el.getAttribute('data-kct-pdf-bold') === '1' ? '600' : '400';
      const pitchPct = parseFloat(el.getAttribute('data-kct-pdf-pitch'));
      if (lineCount > 1 && Number.isFinite(pitchPct) && pitchPct > 0) {
        // Keep the original line pitch so the paragraph occupies the same vertical rhythm
        lineHeight = Math.max(1.3, Math.min(1.9, ((pitchPct / 100) * pageH) / fontSize)).toFixed(2);
      } else {
        lineHeight = '1.3';
      }
    } else if (lineCount === 1 && avgLineHPct >= 2.2) {
      fontSize = Math.round(linePx * 0.80);
      lineHeight = '1.22';
      fontWeight = '600';
    } else if (avgLineHPct >= 2.8) {
      fontSize = Math.round(linePx * 0.74);
      lineHeight = '1.28';
    } else {
      fontSize = Math.round(linePx * 0.78);
      lineHeight = '1.42';
    }

    fontSize = Math.max(9, Math.min(48, fontSize));
    el.style.setProperty('--kct-pdf-fs', `${fontSize}px`);
    el.style.setProperty('--kct-pdf-lh', lineHeight);
    el.style.setProperty('--kct-pdf-fw', fontWeight);

    let fs = fontSize;
    let guard = 0;
    if (isToc) {
      // TOC rows never wrap: only shrink if the translated title cannot fit beside its page number
      const titleEl = el.querySelector(':scope > [data-kct-ui="trans"]');
      while (
        titleEl &&
        guard < 12 &&
        fs > 9.5 &&
        titleEl.scrollWidth > titleEl.clientWidth + 1
      ) {
        fs = Math.max(9.5, +(fs * 0.94).toFixed(2));
        el.style.setProperty('--kct-pdf-fs', `${fs}px`);
        guard += 1;
      }
      return;
    }

    // A single-line source block may overflow its (often too tight) text-layer box vertically,
    // as long as the translation itself still fits on one line; only wrapping should trigger shrinking.
    const targetH = lineCount === 1
      ? Math.max(el.clientHeight, fontSize * parseFloat(lineHeight) + 4)
      : el.clientHeight;
    const targetW = el.clientWidth;
    if (targetH > 8 && targetW > 12) {
      while (
        guard < 16 &&
        fs > 9.5 &&
        (el.scrollHeight > targetH + 3 || el.scrollWidth > targetW + 6)
      ) {
        fs = Math.max(9.5, +(fs - (fs > 18 ? 1.5 : 0.75)).toFixed(2));
        el.style.setProperty('--kct-pdf-fs', `${fs}px`);
        guard += 1;
      }
    }
  }

  function applyBlockTranslation(job, settings, state) {
    const { el, zh, placeholders, nestedListEl, typo } = job;
    if (!el || !el.isConnected) {
      return 'disconnected';
    }
    if (el.hasAttribute('data-kct-has-trans') || el.querySelector('[data-kct-ui="trans"]')) {
      if (state?.elementState) state.elementState.set(el, 'done');
      return 'already';
    }

    ensureShadowModeStyle(el);

    const origWrap = document.createElement('span');
    origWrap.className = 'kct-orig-wrap';
    origWrap.setAttribute('data-kct-ui', 'orig');

    const children = Array.from(el.childNodes);
    for (const child of children) {
      if (nestedListEl && child === nestedListEl) break;
      origWrap.appendChild(child);
    }

    const transWrap = document.createElement('span');
    transWrap.className = 'kct-trans-wrap';
    transWrap.setAttribute('data-kct-ui', 'trans');
    transWrap.setAttribute('translate', 'no');
    transWrap.appendChild(buildTranslatedFragment(zh, placeholders));

    if (needsInlineInjection(el)) {
      el.setAttribute('data-kct-inline-layout', '1');
    }

    const typoInfo = typo || KCTSiteAnalyzer?.probeTypography?.(el) || {
      archetype: 'sans',
      needsLineHeightLift: false,
      origFontFamily: ''
    };

    const archetype = typoInfo.archetype || 'sans';
    el.setAttribute('data-kct-typo', archetype);
    if (typoInfo.needsLineHeightLift) {
      el.setAttribute('data-kct-lh-lift', '1');
    }

    const safeFont = sanitizeFontFamily(typoInfo.origFontFamily);
    if (safeFont) {
      el.style.setProperty('--kct-orig-font', safeFont);
      el.setAttribute('data-kct-has-orig-font', '1');
    } else {
      el.style.removeProperty('--kct-orig-font');
      el.removeAttribute('data-kct-has-orig-font');
    }

    if (nestedListEl && nestedListEl.parentElement === el) {
      el.insertBefore(origWrap, nestedListEl);
      el.insertBefore(transWrap, nestedListEl);
    } else {
      el.append(origWrap, transWrap);
    }

    el.setAttribute('data-kct-has-trans', '1');
    if (el.getAttribute('data-kct-pdf-block') === '1') {
      if (el.getAttribute('data-kct-pdf-toc') === '1') appendPdfTocTail(el);
      styleAndFitPdfOverlayBlock(el);
    }
    if (state?.elementState) state.elementState.set(el, 'done');
    return 'rendered';
  }

  function nextFrameOrFallback() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const timer = setTimeout(finish, 600);
      requestAnimationFrame(() => {
        clearTimeout(timer);
        finish();
      });
    });
  }

  async function renderJobsWithRAF(jobs, settings, notebookAdapter, state) {
    if (!jobs || jobs.length === 0) return;
    const MAX_PER_FRAME = 15;

    for (let i = 0; i < jobs.length; i += MAX_PER_FRAME) {
      const slice = jobs.slice(i, i + MAX_PER_FRAME);
      await nextFrameOrFallback();

      for (const job of slice) {
        if (job.epoch !== undefined && state && job.epoch !== state.translationEpoch) {
          continue;
        }
        try {
          if (job.kind === 'comment') {
            const outcome = notebookAdapter.renderCommentTranslation(job, settings, state);
            if (outcome === 'rendered') {
              state.totalTranslated += 1;
            } else {
              state.totalDetected = Math.max(state.totalTranslated, state.totalDetected - 1);
            }
          } else {
            const outcome = applyBlockTranslation(job, settings, state);
            if (outcome === 'rendered') {
              state.totalTranslated += 1;
            } else {
              state.totalDetected = Math.max(state.totalTranslated, state.totalDetected - 1);
            }
          }
        } catch (jobErr) {
          console.warn('[KCT] render job error:', jobErr);
          if (state && !state.lastErrorMsg) {
            state.lastErrorMsg = `渲染錯誤: ${jobErr?.message || jobErr}`;
          }
        }
      }

      if (i + MAX_PER_FRAME < jobs.length && typeof globalThis.scheduler?.yield === 'function') {
        try {
          await globalThis.scheduler.yield();
        } catch (_) {}
      }
    }
  }

  function clearAllInjectedTranslations(state, notebookAdapter) {
    const wrappedHosts = KCTSiteAnalyzer?.queryAllDeep
      ? KCTSiteAnalyzer.queryAllDeep(document.body || document.documentElement, '[data-kct-has-trans="1"]')
      : Array.from(document.querySelectorAll('[data-kct-has-trans="1"]'));

    for (const el of wrappedHosts) {
      const origWrap = el.querySelector(':scope > [data-kct-ui="orig"]');
      const transWrap = el.querySelector(':scope > [data-kct-ui="trans"]');
      if (origWrap) {
        while (origWrap.firstChild) {
          el.insertBefore(origWrap.firstChild, origWrap);
        }
        origWrap.remove();
      }
      if (transWrap) {
        transWrap.remove();
      }
      const tocTail = el.querySelector(':scope > [data-kct-ui="toc"]');
      if (tocTail) tocTail.remove();
      el.removeAttribute('data-kct-has-trans');
      el.removeAttribute('data-kct-inline-layout');
      el.removeAttribute('data-kct-typo');
      el.removeAttribute('data-kct-lh-lift');
      el.removeAttribute('data-kct-has-orig-font');
      el.style.removeProperty('--kct-orig-font');
      el.style.removeProperty('--kct-pdf-bg');
      el.style.removeProperty('--kct-pdf-fg');
      el.style.removeProperty('--kct-pdf-fs');
      el.style.removeProperty('--kct-pdf-lh');
      el.style.removeProperty('--kct-pdf-fw');
    }

    if (KCTSiteAnalyzer?.restorePdfOverlayLayers) {
      KCTSiteAnalyzer.restorePdfOverlayLayers(document);
    }

    if (notebookAdapter?.clearNotebookOverlays) {
      notebookAdapter.clearNotebookOverlays(state);
    }

    clearAllImageVisionOverlays();

    if (state) {
      // Reset WeakMap completely so any previously 'queued' or 'observed' blocks can be re-scanned
      state.elementState = new WeakMap();
      state.translationEpoch += 1;
      if (Array.isArray(state.pendingItems)) {
        state.pendingItems.length = 0;
      }
      state.totalDetected = 0;
      state.totalTranslated = 0;
      state.lastErrorMsg = '';
    }
  }

  function refitAllPdfOverlayBlocks() {
    const blocks = document.querySelectorAll('p[data-kct-pdf-block="1"][data-kct-has-trans="1"]');
    for (const el of blocks) {
      styleAndFitPdfOverlayBlock(el);
    }
    refitAllImageVisionOverlays();
  }

  // =========================================================
  // R4: On-Demand Vision Image Overlay Renderer
  // =========================================================
  function fitVisionOverlayBlock(blockEl, role) {
    if (!blockEl || !blockEl.isConnected) return;
    const h = blockEl.clientHeight;
    const w = blockEl.clientWidth;
    if (h < 6 || w < 10) return;

    let fs = role === 'title'
      ? Math.min(24, Math.max(11, Math.round(h * 0.42)))
      : (role === 'badge'
        ? Math.min(15, Math.max(9.5, Math.round(h * 0.62)))
        : Math.min(16, Math.max(10, Math.round(h * 0.34))));

    blockEl.style.fontSize = `${fs}px`;
    let guard = 0;
    while (
      guard < 16 &&
      fs > 8.5 &&
      (blockEl.scrollHeight > h + 3 || blockEl.scrollWidth > w + 4)
    ) {
      fs = Math.max(8.5, +(fs - (fs > 15 ? 1.25 : 0.65)).toFixed(2));
      blockEl.style.fontSize = `${fs}px`;
      guard += 1;
    }
  }

  // Sibling labels of the same role (all card titles, all badges, all body lines) share one size,
  // like the original design; the smallest fitted size is used so every label still fits its box.
  function unifyVisionOverlayRoleSizes(layer) {
    if (!layer) return;
    const byRole = new Map();
    for (const blockEl of layer.querySelectorAll('.kct-img-overlay-block')) {
      const fs = parseFloat(blockEl.style.fontSize);
      if (!Number.isFinite(fs)) continue;
      const role = blockEl.getAttribute('data-kct-role') || 'body';
      if (!byRole.has(role)) byRole.set(role, []);
      byRole.get(role).push({ blockEl, fs });
    }
    for (const items of byRole.values()) {
      if (items.length < 2) continue;
      const shared = Math.min(...items.map((it) => it.fs));
      for (const it of items) it.blockEl.style.fontSize = `${shared}px`;
    }
  }

  function renderImageVisionOverlay(imgEl, blocks) {
    if (!imgEl || !imgEl.isConnected || !Array.isArray(blocks)) return null;
    const parent = imgEl.parentElement;
    if (!parent) return null;

    // Reuse or wrap inside a dedicated relative host so overlay tracks exact image geometry
    let host = imgEl.closest('.kct-img-overlay-host[data-kct-ui="img-host"]');
    if (!host) {
      host = document.createElement('span');
      host.className = 'kct-img-overlay-host';
      host.setAttribute('data-kct-ui', 'img-host');
      const imgCs = getComputedStyle(imgEl);
      host.style.display = imgCs.display === 'block' ? 'block' : 'inline-block';
      host.style.position = 'relative';
      host.style.maxWidth = '100%';
      parent.insertBefore(host, imgEl);
      host.appendChild(imgEl);
    }

    let layer = host.querySelector(':scope > .kct-img-overlay-layer[data-kct-ui="img-overlay"]');
    if (layer) layer.remove();

    layer = document.createElement('div');
    layer.className = 'kct-img-overlay-layer';
    layer.setAttribute('data-kct-ui', 'img-overlay');
    layer.setAttribute('translate', 'no');

    const syncLayerBounds = () => {
      if (!imgEl.isConnected || !layer.isConnected) return;
      layer.style.left = `${imgEl.offsetLeft}px`;
      layer.style.top = `${imgEl.offsetTop}px`;
      layer.style.width = `${imgEl.clientWidth || imgEl.offsetWidth}px`;
      layer.style.height = `${imgEl.clientHeight || imgEl.offsetHeight}px`;
    };
    syncLayerBounds();

    for (const b of blocks) {
      const item = document.createElement('div');
      item.className = `kct-img-overlay-block kct-img-role-${b.role || 'body'}`;
      item.setAttribute('data-kct-ui', 'img-block');
      item.setAttribute('data-kct-role', b.role || 'body');
      const leftPct = Math.max(0, Math.min(99, b.xmin / 10));
      const topPct = Math.max(0, Math.min(99, b.ymin / 10));
      const widthPct = Math.max(1, Math.min(100 - leftPct, (b.xmax - b.xmin) / 10));
      const heightPct = Math.max(1, Math.min(100 - topPct, (b.ymax - b.ymin) / 10));
      item.style.left = `${leftPct.toFixed(2)}%`;
      item.style.top = `${topPct.toFixed(2)}%`;
      item.style.width = `${widthPct.toFixed(2)}%`;
      item.style.height = `${heightPct.toFixed(2)}%`;
      item.style.setProperty('--kct-img-bg', b.bg || '#ffffff');
      item.style.setProperty('--kct-img-fg', b.fg || '#1e293b');
      // Vision output sometimes inserts spaces between CJK characters; drop them so the label reads naturally
      const labelText = String(b.text || '').replace(/([\p{Script=Han}\u3000-\u303f\uff00-\uffef])\s+(?=[\p{Script=Han}\u3000-\u303f\uff00-\uffef])/gu, '$1');
      item.appendChild(document.createTextNode(labelText));
      layer.appendChild(item);
    }

    host.appendChild(layer);
    imgEl.setAttribute('data-kct-img-translated', '1');
    imgEl.setAttribute('data-kct-img-mode', 'translated');

    requestAnimationFrame(() => {
      syncLayerBounds();
      for (const blockEl of layer.querySelectorAll('.kct-img-overlay-block')) {
        fitVisionOverlayBlock(blockEl, blockEl.getAttribute('data-kct-role') || 'body');
      }
      unifyVisionOverlayRoleSizes(layer);
    });

    return layer;
  }

  function refitAllImageVisionOverlays() {
    const hosts = document.querySelectorAll('.kct-img-overlay-host[data-kct-ui="img-host"]');
    for (const host of hosts) {
      const imgEl = host.querySelector('img');
      const layer = host.querySelector(':scope > .kct-img-overlay-layer[data-kct-ui="img-overlay"]');
      if (!imgEl || !layer) continue;
      layer.style.left = `${imgEl.offsetLeft}px`;
      layer.style.top = `${imgEl.offsetTop}px`;
      layer.style.width = `${imgEl.clientWidth || imgEl.offsetWidth}px`;
      layer.style.height = `${imgEl.clientHeight || imgEl.offsetHeight}px`;
      for (const blockEl of layer.querySelectorAll('.kct-img-overlay-block')) {
        fitVisionOverlayBlock(blockEl, blockEl.getAttribute('data-kct-role') || 'body');
      }
      unifyVisionOverlayRoleSizes(layer);
    }
  }

  function clearAllImageVisionOverlays() {
    const hosts = Array.from(document.querySelectorAll('.kct-img-overlay-host[data-kct-ui="img-host"]'));
    for (const host of hosts) {
      const img = host.querySelector('img');
      if (img && host.parentElement) {
        img.removeAttribute('data-kct-img-translated');
        img.removeAttribute('data-kct-img-mode');
        host.parentElement.insertBefore(img, host);
      }
      host.remove();
    }
  }

  globalThis.KCTRenderer = {
    applyDisplayModeClass,
    applyBlockTranslation,
    renderJobsWithRAF,
    clearAllInjectedTranslations,
    buildTranslatedFragment,
    sanitizeFontFamily,
    styleAndFitPdfOverlayBlock,
    refitAllPdfOverlayBlocks,
    renderImageVisionOverlay,
    refitAllImageVisionOverlays,
    clearAllImageVisionOverlays
  };
})();

(() => {
  if (globalThis.__NATIVEREAD_USERSCRIPT_BOOTED__) {
    if (typeof globalThis.__NATIVEREAD_OPEN_PILL__ === 'function') {
      globalThis.__NATIVEREAD_OPEN_PILL__();
    }
    return;
  }
  globalThis.__NATIVEREAD_USERSCRIPT_BOOTED__ = true;

  // Run only in top frame or main content frames
  const {
    PROVIDER_PRESETS,
    TARGET_LANGUAGES,
    DEFAULT_GLOSSARY,
    DEFAULT_SETTINGS,
    SETTINGS_KEY,
    resolveTargetLanguage,
    resolveEndpoint,
    resolveStreamEndpoint,
    resolveThinkingConfig,
    normalizeHostname,
    isHostWhitelisted,
    sanitizeApiKey,
    hashText
  } = globalThis.KCTConfig;

  const KCTSiteAnalyzer = globalThis.KCTSiteAnalyzer;
  const KCTRenderer = globalThis.KCTRenderer;
  const KCTCodeOverlay = globalThis.KCTCodeOverlay;

  const PAGE_STYLE_CSS = "/* Universal AI Web & Notebook Translator v2.0 - Page Typography & Mode Rules */\n/* Note: Floating control pill & selection popover are encapsulated in Shadow DOM. */\n\n:root {\n  --kct-accent: #0284c7;\n  --kct-accent-soft: rgba(2, 132, 199, 0.08);\n  --kct-hairline: rgba(148, 163, 184, 0.45);\n  --kct-border: rgba(15, 23, 42, 0.12);\n  --kct-text: #1e293b;\n  --kct-bilingual-ink: #475569;\n  --kct-bg: rgba(255, 255, 255, 0.9);\n\n  /* Default target language: Traditional Chinese (zh-TW) */\n  --kct-font-serif: \"Noto Serif TC\", \"Songti TC\", \"PMingLiU\", \"Source Han Serif TC\", Georgia, serif;\n  --kct-font-sans: \"PingFang TC\", \"Noto Sans TC\", \"Microsoft JhengHei\", \"Heiti TC\", -apple-system, BlinkMacSystemFont, sans-serif;\n  --kct-font-mono: \"JetBrains Mono\", \"SFMono-Regular\", Menlo, Monaco, Consolas, \"PingFang TC\", \"Noto Sans TC\", \"Microsoft JhengHei\", monospace;\n}\n\nhtml.kct-lang-sc {\n  --kct-font-serif: \"Noto Serif SC\", \"Songti SC\", \"STSong\", \"SimSun\", \"Source Han Serif SC\", Georgia, serif;\n  --kct-font-sans: \"PingFang SC\", \"Noto Sans SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", -apple-system, BlinkMacSystemFont, sans-serif;\n  --kct-font-mono: \"JetBrains Mono\", \"SFMono-Regular\", Menlo, Monaco, Consolas, \"PingFang SC\", \"Noto Sans SC\", \"Microsoft YaHei\", monospace;\n}\n\nhtml.kct-lang-ja {\n  --kct-font-serif: \"Hiragino Mincho ProN\", \"Yu Mincho\", \"Noto Serif JP\", \"MS PMincho\", Georgia, serif;\n  --kct-font-sans: \"Hiragino Sans\", \"Hiragino Kaku Gothic ProN\", \"Noto Sans JP\", \"Yu Gothic\", -apple-system, BlinkMacSystemFont, sans-serif;\n  --kct-font-mono: \"JetBrains Mono\", \"SFMono-Regular\", Menlo, Monaco, Consolas, \"Hiragino Sans\", \"Noto Sans JP\", monospace;\n}\n\nhtml.kct-lang-ko {\n  --kct-font-serif: \"Noto Serif KR\", \"AppleMyungjo\", \"Batang\", Georgia, serif;\n  --kct-font-sans: \"Apple SD Gothic Neo\", \"Noto Sans KR\", \"Malgun Gothic\", -apple-system, BlinkMacSystemFont, sans-serif;\n  --kct-font-mono: \"JetBrains Mono\", \"SFMono-Regular\", Menlo, Monaco, Consolas, \"Apple SD Gothic Neo\", \"Noto Sans KR\", monospace;\n}\n\nhtml.kct-lang-latin {\n  --kct-font-serif: Georgia, \"Charter\", \"Times New Roman\", serif;\n  --kct-font-sans: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Inter\", sans-serif;\n  --kct-font-mono: \"JetBrains Mono\", \"SFMono-Regular\", Menlo, Monaco, Consolas, monospace;\n}\n\nhtml.kct-page-dark,\nbody[data-jp-theme-light=\"false\"],\nhtml[data-theme=\"dark\"],\nhtml.dark,\nbody.theme-dark {\n  --kct-accent: #38bdf8;\n  --kct-accent-soft: rgba(56, 189, 248, 0.12);\n  --kct-hairline: rgba(148, 163, 184, 0.34);\n  --kct-border: rgba(255, 255, 255, 0.16);\n  --kct-text: #f1f5f9;\n  --kct-bilingual-ink: #cbd5e1;\n  --kct-bg: rgba(15, 23, 42, 0.9);\n}\n\n/* Preserve table & Infobox column widths when CJK labels sit next to long unbroken URLs */\nhtml.kct-active:not(.kct-mode-original) table th[data-kct-has-trans=\"1\"] {\n  min-width: 4.5em;\n  word-break: keep-all;\n  overflow-wrap: break-word;\n}\n\nhtml.kct-active:not(.kct-mode-original) table td[data-kct-has-trans=\"1\"],\nhtml.kct-active:not(.kct-mode-original) .infobox td {\n  overflow-wrap: anywhere;\n  word-break: break-word;\n}\n\n/* =========================================================\n   1. Replace Mode (Native-Feel Typography Matching)\n   ========================================================= */\nhtml.kct-mode-replace .kct-orig-wrap {\n  display: none !important;\n}\n\nhtml.kct-mode-replace .kct-trans-wrap {\n  display: contents;\n}\n\nhtml.kct-mode-replace [data-kct-has-trans=\"1\"] {\n  line-break: strict;\n  font-kerning: normal;\n  text-wrap: pretty;\n  text-autospace: normal;\n  text-rendering: optimizeLegibility;\n  -webkit-font-smoothing: antialiased;\n}\n\n/* Native mode: keep original site Latin font first (when non-generic), fall back to matched Serif/Sans/Mono CJK */\nhtml.kct-typo-native.kct-mode-replace [data-kct-has-trans=\"1\"][data-kct-typo=\"serif\"] {\n  font-family: var(--kct-font-serif) !important;\n}\n\nhtml.kct-typo-native.kct-mode-replace [data-kct-has-trans=\"1\"][data-kct-typo=\"sans\"] {\n  font-family: var(--kct-font-sans) !important;\n}\n\nhtml.kct-typo-native.kct-mode-replace [data-kct-has-trans=\"1\"][data-kct-typo=\"mono\"] {\n  font-family: var(--kct-font-mono) !important;\n}\n\nhtml.kct-typo-native.kct-mode-replace [data-kct-has-trans=\"1\"][data-kct-has-orig-font=\"1\"][data-kct-typo=\"serif\"] {\n  font-family: var(--kct-orig-font), var(--kct-font-serif) !important;\n}\n\nhtml.kct-typo-native.kct-mode-replace [data-kct-has-trans=\"1\"][data-kct-has-orig-font=\"1\"][data-kct-typo=\"sans\"] {\n  font-family: var(--kct-orig-font), var(--kct-font-sans) !important;\n}\n\nhtml.kct-typo-native.kct-mode-replace [data-kct-has-trans=\"1\"][data-kct-has-orig-font=\"1\"][data-kct-typo=\"mono\"] {\n  font-family: var(--kct-orig-font), var(--kct-font-mono) !important;\n}\n\n/* System mode: uniform clean sans font */\nhtml.kct-typo-system.kct-mode-replace [data-kct-has-trans=\"1\"] {\n  font-family: var(--kct-font-sans) !important;\n}\n\n/* Preserve mode: do not override font-family or line-height */\n\n/* Selective line-height lift ONLY on dense multi-line reading prose */\nhtml.kct-mode-replace:not(.kct-typo-preserve) [data-kct-has-trans=\"1\"][data-kct-lh-lift=\"1\"] {\n  line-height: 1.72 !important;\n}\n\n/* =========================================================\n   2. Original Mode (Instant Zero-Cost Compare)\n   ========================================================= */\nhtml.kct-mode-original .kct-trans-wrap {\n  display: none !important;\n}\n\nhtml.kct-mode-original .kct-orig-wrap {\n  display: contents;\n}\n\n/* =========================================================\n   3. Bilingual Mode (Clean Hairline Contrast)\n   ========================================================= */\nhtml.kct-mode-bilingual .kct-orig-wrap {\n  display: contents;\n}\n\nhtml.kct-mode-bilingual .kct-trans-wrap {\n  display: block;\n  color: var(--kct-bilingual-ink);\n  margin-top: 0.35em;\n  padding-left: 10px;\n  border-left: 2px solid var(--kct-hairline);\n  font-size: 0.94em;\n  line-height: 1.7;\n  font-weight: 400;\n  line-break: strict;\n  font-kerning: normal;\n  text-wrap: pretty;\n  text-autospace: normal;\n  text-rendering: optimizeLegibility;\n  -webkit-font-smoothing: antialiased;\n}\n\nhtml.kct-typo-native.kct-mode-bilingual [data-kct-has-trans=\"1\"][data-kct-typo=\"serif\"] > .kct-trans-wrap {\n  font-family: var(--kct-font-serif);\n}\n\nhtml.kct-typo-native.kct-mode-bilingual [data-kct-has-trans=\"1\"][data-kct-typo=\"sans\"] > .kct-trans-wrap {\n  font-family: var(--kct-font-sans);\n}\n\nhtml.kct-typo-native.kct-mode-bilingual [data-kct-has-trans=\"1\"][data-kct-typo=\"mono\"] > .kct-trans-wrap {\n  font-family: var(--kct-font-mono);\n}\n\nhtml.kct-typo-native.kct-mode-bilingual [data-kct-has-trans=\"1\"][data-kct-has-orig-font=\"1\"][data-kct-typo=\"serif\"] > .kct-trans-wrap {\n  font-family: var(--kct-orig-font), var(--kct-font-serif);\n}\n\nhtml.kct-typo-native.kct-mode-bilingual [data-kct-has-trans=\"1\"][data-kct-has-orig-font=\"1\"][data-kct-typo=\"sans\"] > .kct-trans-wrap {\n  font-family: var(--kct-orig-font), var(--kct-font-sans);\n}\n\nhtml.kct-typo-native.kct-mode-bilingual [data-kct-has-trans=\"1\"][data-kct-has-orig-font=\"1\"][data-kct-typo=\"mono\"] > .kct-trans-wrap {\n  font-family: var(--kct-orig-font), var(--kct-font-mono);\n}\n\nhtml.kct-typo-system.kct-mode-bilingual .kct-trans-wrap {\n  font-family: var(--kct-font-sans);\n}\n\nhtml.kct-mode-bilingual [data-kct-inline-layout=\"1\"] > .kct-trans-wrap {\n  display: inline;\n  margin-top: 0;\n  margin-left: 0.45em;\n  padding-left: 0.45em;\n  border-left: 1px solid var(--kct-hairline);\n}\n\n/* =========================================================\n   Non-destructive Code Comment Translation\n   - Static <pre>: CSS attr() + font-size:0 swap\n   - CodeMirror 6 (.cm-editor): non-intrusive .cm-scroller overlay layer\n   ========================================================= */\nhtml.kct-comments-on:not(.kct-mode-original) pre span[data-kct-comment-trans] {\n  font-size: 0 !important;\n  letter-spacing: 0 !important;\n}\n\nhtml.kct-comments-on:not(.kct-mode-original) pre span[data-kct-comment-trans]::after {\n  content: attr(data-kct-comment-trans);\n  font-size: var(--kct-code-font-size, 13px);\n  letter-spacing: normal;\n  font-family: var(--kct-font-mono);\n}\n\n.kct-cm-layer {\n  position: absolute;\n  inset: 0;\n  pointer-events: none;\n  z-index: 4;\n  overflow: visible;\n}\n\n.kct-cm-comment {\n  position: absolute;\n  display: flex;\n  align-items: center;\n  white-space: pre;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  font-family: var(--kct-font-mono);\n  pointer-events: none;\n  box-sizing: border-box;\n}\n\nhtml.kct-mode-original .kct-cm-layer,\nhtml:not(.kct-comments-on) .kct-cm-layer,\nhtml .cm-editor.cm-focused .kct-cm-layer {\n  display: none !important;\n}\n\n/* =========================================================\n   Jupyter Code Cell Output Quick Translate Button & Result\n   ========================================================= */\n.kct-output-host {\n  position: relative;\n}\n\n.kct-output-btn {\n  all: unset;\n  box-sizing: border-box;\n  position: absolute;\n  top: 6px;\n  right: 8px;\n  z-index: 10;\n  cursor: pointer;\n  font-family: var(--kct-font-sans);\n  font-size: 11px;\n  font-weight: 600;\n  padding: 2px 8px;\n  border-radius: 999px;\n  background: var(--kct-bg);\n  color: var(--kct-accent);\n  border: 1px solid var(--kct-border);\n  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08);\n  opacity: 0.85;\n  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;\n}\n\n.kct-output-btn:hover {\n  opacity: 1;\n  background: var(--kct-accent);\n  color: #ffffff;\n  border-color: transparent;\n}\n\n.kct-output-trans {\n  font-family: var(--kct-font-sans);\n  color: var(--kct-text);\n  background: var(--kct-accent-soft);\n  border-left: 2px solid var(--kct-accent);\n  border-radius: 0 6px 6px 0;\n  padding: 8px 12px;\n  margin-top: 8px;\n  font-size: 13px;\n  line-height: 1.65;\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n\n/* =========================================================\n   5. Image/Canvas-Backed PDF Text Layer Overlay (Google Drive PDF Viewer)\n   ========================================================= */\nhtml.kct-active:not(.kct-mode-original) [data-kct-pdf-layer=\"1\"] {\n  z-index: 2 !important;\n  opacity: 1 !important;\n  pointer-events: none !important;\n  overflow: visible !important;\n}\n\nhtml.kct-active:not(.kct-mode-original) [data-kct-pdf-layer=\"1\"] > :not([data-kct-has-trans=\"1\"]),\nhtml.kct-active:not(.kct-mode-original) [data-kct-pdf-layer=\"1\"] > [data-kct-pdf-merged=\"absorbed\"] {\n  opacity: 0 !important;\n  pointer-events: none !important;\n}\n\nhtml.kct-active:not(.kct-mode-original) [data-kct-pdf-layer=\"1\"] > p[data-kct-pdf-block=\"1\"][data-kct-has-trans=\"1\"] {\n  opacity: 1 !important;\n  pointer-events: auto !important;\n  background-color: var(--kct-pdf-bg, #ffffff) !important;\n  box-shadow: 0 0 0 2px var(--kct-pdf-bg, #ffffff) !important;\n  color: var(--kct-pdf-fg, #1e293b) !important;\n  font-size: var(--kct-pdf-fs, 13px) !important;\n  line-height: var(--kct-pdf-lh, 1.42) !important;\n  font-weight: var(--kct-pdf-fw, 400) !important;\n  box-sizing: border-box !important;\n  margin: 0 !important;\n  padding: 1px 4px !important;\n  border-radius: 2px !important;\n  display: block !important;\n  white-space: normal !important;\n  word-break: break-word !important;\n  overflow: hidden !important;\n  transition: box-shadow 0.14s ease;\n}\n\nhtml.kct-active:not(.kct-mode-original) [data-kct-pdf-layer=\"1\"] > p[data-kct-pdf-block=\"1\"][data-kct-has-trans=\"1\"]:hover {\n  z-index: 30 !important;\n  overflow: visible !important;\n  height: auto !important;\n}\n\n/* In fixed-coordinate PDF overlay layers, keep layout clean in Bilingual mode and expand full bilingual card on hover */\nhtml.kct-active.kct-mode-bilingual [data-kct-pdf-layer=\"1\"] > p[data-kct-pdf-block=\"1\"][data-kct-has-trans=\"1\"] > .kct-orig-wrap {\n  display: none !important;\n}\n\nhtml.kct-active.kct-mode-bilingual [data-kct-pdf-layer=\"1\"] > p[data-kct-pdf-block=\"1\"][data-kct-has-trans=\"1\"] > .kct-trans-wrap {\n  display: contents !important;\n  color: var(--kct-pdf-fg, #1e293b) !important;\n  margin: 0 !important;\n  padding: 0 !important;\n  border: none !important;\n  font-size: inherit !important;\n  line-height: inherit !important;\n  font-weight: inherit !important;\n}\n\nhtml.kct-active.kct-mode-bilingual [data-kct-pdf-layer=\"1\"] > p[data-kct-pdf-block=\"1\"][data-kct-has-trans=\"1\"]:hover {\n  z-index: 30 !important;\n  height: auto !important;\n  padding: 8px 10px !important;\n  border-radius: 6px !important;\n  border: 1px solid var(--kct-accent) !important;\n  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.25) !important;\n}\n\nhtml.kct-active.kct-mode-bilingual [data-kct-pdf-layer=\"1\"] > p[data-kct-pdf-block=\"1\"][data-kct-has-trans=\"1\"]:hover > .kct-orig-wrap {\n  display: block !important;\n  font-size: 0.86em !important;\n  line-height: 1.4 !important;\n  opacity: 0.76 !important;\n  margin-bottom: 6px !important;\n  padding-bottom: 6px !important;\n  border-bottom: 1px dashed rgba(148, 163, 184, 0.45) !important;\n}\n\n/* =========================================================\n   Google Drive PDF: table-of-contents rows\n   (translated title + native dot leader + right-aligned page number).\n   Placed last so it overrides the generic overlay / bilingual hover rules above.\n   ========================================================= */\nhtml.kct-active:not(.kct-mode-original) [data-kct-pdf-layer=\"1\"] > p[data-kct-pdf-block=\"1\"][data-kct-pdf-toc=\"1\"][data-kct-has-trans=\"1\"] {\n  display: flex !important;\n  align-items: baseline !important;\n  white-space: nowrap !important;\n  overflow: hidden !important;\n}\n\nhtml.kct-active:not(.kct-mode-original) [data-kct-pdf-layer=\"1\"] > p[data-kct-pdf-block=\"1\"][data-kct-pdf-toc=\"1\"][data-kct-has-trans=\"1\"] > .kct-orig-wrap,\nhtml.kct-active:not(.kct-mode-original) [data-kct-pdf-layer=\"1\"] > p[data-kct-pdf-block=\"1\"][data-kct-pdf-toc=\"1\"][data-kct-has-trans=\"1\"]:hover > .kct-orig-wrap {\n  display: none !important;\n}\n\nhtml.kct-active:not(.kct-mode-original) [data-kct-pdf-layer=\"1\"] > p[data-kct-pdf-block=\"1\"][data-kct-pdf-toc=\"1\"][data-kct-has-trans=\"1\"] > .kct-trans-wrap {\n  display: block !important;\n  flex: 0 1 auto !important;\n  min-width: 0 !important;\n  overflow: hidden !important;\n  text-overflow: ellipsis !important;\n  white-space: nowrap !important;\n}\n\nhtml.kct-active.kct-mode-bilingual [data-kct-pdf-layer=\"1\"] > p[data-kct-pdf-block=\"1\"][data-kct-pdf-toc=\"1\"][data-kct-has-trans=\"1\"]:hover {\n  height: auto !important;\n  padding: 1px 4px !important;\n}\n\n[data-kct-pdf-layer=\"1\"] > p > .kct-pdf-toc-tail {\n  display: none;\n}\n\nhtml.kct-active:not(.kct-mode-original) [data-kct-pdf-layer=\"1\"] > p[data-kct-pdf-block=\"1\"][data-kct-pdf-toc=\"1\"][data-kct-has-trans=\"1\"] > .kct-pdf-toc-tail {\n  display: flex !important;\n  flex: 1 1 auto !important;\n  align-items: baseline !important;\n  min-width: 2.2em !important;\n}\n\n[data-kct-pdf-layer=\"1\"] .kct-pdf-toc-leader {\n  flex: 1 1 auto;\n  height: 0;\n  margin: 0 0.5em;\n  border-bottom: 0.13em dotted currentColor;\n  opacity: 0.6;\n}\n\n[data-kct-pdf-layer=\"1\"] > p[data-kct-pdf-toc-leader=\"none\"] .kct-pdf-toc-leader {\n  border-bottom-color: transparent;\n}\n\n[data-kct-pdf-layer=\"1\"] .kct-pdf-toc-num {\n  flex: none;\n  font-variant-numeric: tabular-nums;\n}\n\n/* =========================================================\n   6. R4: On-Demand Vision Image Overlay Translation\n   ========================================================= */\n.kct-img-overlay-host {\n  position: relative;\n  line-height: 0;\n}\n\n.kct-img-overlay-layer {\n  position: absolute;\n  pointer-events: none;\n  z-index: 6;\n  overflow: hidden;\n  box-sizing: border-box;\n}\n\nhtml.kct-mode-original .kct-img-overlay-layer,\n.kct-img-overlay-host > img[data-kct-img-mode=\"original\"] ~ .kct-img-overlay-layer {\n  display: none !important;\n}\n\n.kct-img-overlay-block {\n  position: absolute;\n  box-sizing: border-box;\n  background-color: var(--kct-img-bg, #ffffff);\n  box-shadow: 0 0 0 2px var(--kct-img-bg, #ffffff);\n  color: var(--kct-img-fg, #1e293b);\n  font-family: var(--kct-font-sans);\n  line-height: 1.28;\n  padding: 1px 3px;\n  border-radius: 3px;\n  display: flex;\n  align-items: center;\n  white-space: normal;\n  word-break: break-word;\n  overflow: hidden;\n  pointer-events: auto;\n}\n\n.kct-img-overlay-block.kct-img-role-title {\n  font-weight: 700;\n  line-height: 1.22;\n}\n\n.kct-img-overlay-block.kct-img-role-badge {\n  font-weight: 600;\n  justify-content: center;\n  text-align: center;\n  border-radius: 999px;\n}\n\n.kct-img-overlay-block:hover {\n  z-index: 20;\n  overflow: visible;\n  height: auto !important;\n  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.18), 0 0 0 1px var(--kct-accent);\n}\n";

  // ============================================================
  // 1. Storage Adapter (GM_getValue / GM_setValue + localStorage)
  // ============================================================
  function readStoredSettings() {
    let raw = null;
    try {
      if (typeof GM_getValue === 'function') {
        raw = GM_getValue(SETTINGS_KEY, null);
      }
    } catch (_) {}
    if (!raw) {
      try {
        raw = localStorage.getItem(SETTINGS_KEY);
      } catch (_) {}
    }
    if (!raw) {
      return { ...DEFAULT_SETTINGS, providerId: 'gemini', protocol: 'gemini', baseUrl: PROVIDER_PRESETS.gemini.baseUrl, model: PROVIDER_PRESETS.gemini.defaultModel, autoTranslateHosts: [] };
    }
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        autoTranslateHosts: Array.isArray(parsed?.autoTranslateHosts)
          ? parsed.autoTranslateHosts.map(normalizeHostname).filter(Boolean)
          : []
      };
    } catch (_) {
      return { ...DEFAULT_SETTINGS, autoTranslateHosts: [] };
    }
  }

  function writeStoredSettings(partial) {
    const current = readStoredSettings();
    const next = {
      ...current,
      ...partial
    };
    if (Array.isArray(next.autoTranslateHosts)) {
      next.autoTranslateHosts = Array.from(new Set(next.autoTranslateHosts.map(normalizeHostname).filter(Boolean)));
    } else {
      next.autoTranslateHosts = [];
    }
    const serialized = JSON.stringify(next);
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(SETTINGS_KEY, serialized);
      }
    } catch (_) {}
    try {
      localStorage.setItem(SETTINGS_KEY, serialized);
    } catch (_) {}
    return next;
  }

  // Override KCTConfig.getSettings / saveSettings so shared modules work seamlessly
  globalThis.KCTConfig.getSettings = async () => readStoredSettings();
  globalThis.KCTConfig.saveSettings = async (partial) => writeStoredSettings(partial);

  // ============================================================
  // 2. #nr_sync Zero-Typing Sync Decoder
  // ============================================================
  function decodeBase64UrlJson(b64url) {
    const base64 = String(b64url || '').trim().replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '==='.slice((base64.length + 3) % 4);
    const binStr = atob(padded);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function checkAndApplyNrSyncHash() {
    const hash = String(window.location.hash || '');
    if (!hash.includes('nr_sync=')) return false;
    const match = hash.match(/(?:^|[#&])nr_sync=([^&]+)/);
    if (!match || !match[1]) return false;

    try {
      const payload = decodeBase64UrlJson(decodeURIComponent(match[1]));
      if (!payload || typeof payload !== 'object') return false;
      const providerId = payload.providerId || payload.p || 'gemini';
      const preset = PROVIDER_PRESETS[providerId] || PROVIDER_PRESETS.gemini;
      const protocol = payload.protocol || payload.r || preset.protocol || 'gemini';
      const baseUrl = payload.baseUrl || payload.u || preset.baseUrl;
      const apiKey = sanitizeApiKey(payload.apiKey ?? payload.k ?? '');
      const model = payload.model || payload.m || preset.defaultModel;
      const targetLang = payload.targetLang || payload.l || 'zh-TW';
      const customTargetLang = payload.customTargetLang ?? payload.c ?? '';
      const thinkingEffort = payload.thinkingEffort || payload.e || 'fastest';
      const typographyMatch = payload.typographyMatch || payload.t || 'native';

      writeStoredSettings({
        providerId,
        protocol,
        baseUrl,
        apiKey,
        model,
        targetLang,
        customTargetLang,
        thinkingEffort,
        typographyMatch
      });
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return true;
    } catch (_) {
      return false;
    }
  }

  // ============================================================
  // 3. Persistent Cache (IndexedDB + GM memory fallback)
  // ============================================================
  const DB_NAME = 'kct_cache_db_v2';
  const STORE_NAME = 'entries';
  let dbPromise = null;
  const memCache = new Map();

  function openCacheDB() {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('No IDB'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { dbPromise = null; reject(req.error); };
      } catch (e) {
        dbPromise = null;
        reject(e);
      }
    });
    return dbPromise;
  }

  async function cacheGetMany(keys) {
    const out = new Map();
    for (const k of keys) {
      if (memCache.has(k)) out.set(k, memCache.get(k));
    }
    try {
      const db = await openCacheDB();
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        for (const k of keys) {
          if (out.has(k)) continue;
          const r = store.get(k);
          r.onsuccess = () => {
            if (r.result?.zh) {
              out.set(k, r.result.zh);
              memCache.set(k, r.result.zh);
            }
          };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (_) {}
    return out;
  }

  async function cachePutMany(entries) {
    for (const e of entries) {
      if (e?.key && e?.zh) memCache.set(e.key, e.zh);
    }
    try {
      const db = await openCacheDB();
      const now = Date.now();
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        entries.forEach((e, idx) => {
          if (e?.key && e?.zh) store.put({ key: e.key, zh: e.zh, ts: now + idx });
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (_) {}
  }

  function buildCacheSignature(settings) {
    const lang = resolveTargetLanguage(settings);
    const customLang = lang.isCustom ? String(settings.customTargetLang || '').trim().toLowerCase() : '';
    const glossaryHash = hashText(String(settings.customGlossary || '').trim());
    return `${settings.protocol}:${settings.model}:${settings.thinkingEffort || 'fastest'}:${lang.id}:${customLang}:${glossaryHash}`;
  }

  // ============================================================
  // 4. LLM Request Engine (SSE fetch + GM_xmlhttpRequest CSP bypass fallback)
  // ============================================================
  function buildStreamSystemPrompt(settings, pageContext) {
    const lang = resolveTargetLanguage(settings);
    const langGuide = lang.id === 'zh-TW'
      ? '目標語言：繁體中文（台灣慣用語與台灣繁體字形，如資料、函式、迴圈、過度擬合、程式碼）。'
      : lang.id === 'zh-CN'
        ? '目标语言：简体中文（自然流利的中国大陆技术表达）。'
        : `Target language: ${lang.promptName}.`;
    const glossary = String(settings.customGlossary || '').trim();
    const glossaryPart = (glossary && (lang.id === 'zh-TW' || lang.id === 'zh-CN'))
      ? `\n參考術語表：\n${glossary}\n`
      : '';
    return [
      'Expert web & technical translator. Preserve original tone and structure.',
      pageContext?.title ? `Page topic: ${String(pageContext.title).slice(0, 120)}` : '',
      langGuide,
      'Rules:',
      '1. Keep ALL placeholders ([[C0]], [[C1]], [[M0]]) exact and untranslated in natural positions.',
      '2. Keep code identifiers, package/function names, URLs, and abbreviations intact.',
      '3. For "kind":"comment", keep the leading "# " prefix.',
      '4. Output STRICT NDJSON: one JSON object per line in the format {"i":0,"t":"..."} matching every input index i.',
      '5. NO markdown fences (no ```), NO surrounding array [...].',
      glossaryPart
    ].filter(Boolean).join('\n');
  }

  function parseNdjsonLine(rawLine) {
    let clean = String(rawLine || '').trim();
    if (!clean || clean.startsWith('```') || clean === '[' || clean === ']' || clean === '],') return [];
    if (clean.startsWith('[') && clean.includes('{')) clean = clean.slice(1).trim();
    if (clean.endsWith(',')) clean = clean.slice(0, -1).trim();
    if (clean.endsWith(']') && !clean.startsWith('[')) clean = clean.slice(0, -1).trim();
    if (!clean) return [];

    const extractObj = (obj) => {
      const out = [];
      if (!obj || typeof obj !== 'object') return out;
      const push = (e) => {
        if (!e || typeof e !== 'object') return;
        const idx = Number(e.i ?? e.id ?? e.index);
        const txt = e.t ?? e.zh ?? e.translation;
        if (Number.isInteger(idx) && idx >= 0 && typeof txt === 'string' && txt.trim()) {
          out.push({ idx, text: txt.trim() });
        }
      };
      if (Array.isArray(obj)) obj.forEach(push);
      else if (Array.isArray(obj.translations)) obj.translations.forEach(push);
      else push(obj);
      return out;
    };

    try {
      return extractObj(JSON.parse(clean));
    } catch (_) {
      const results = [];
      let start = clean.indexOf('{');
      while (start !== -1) {
        let depth = 0;
        let inStr = false;
        let esc = false;
        let end = -1;
        for (let i = start; i < clean.length; i++) {
          const ch = clean[i];
          if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
          } else if (ch === '"') inStr = true;
          else if (ch === '{') depth += 1;
          else if (ch === '}') {
            depth -= 1;
            if (depth === 0) { end = i; break; }
          }
        }
        if (end === -1) break;
        try {
          results.push(...extractObj(JSON.parse(clean.slice(start, end + 1))));
        } catch (_) {}
        start = clean.indexOf('{', end + 1);
      }
      return results;
    }
  }

  function extractDelta(protocol, chunkObj) {
    if (!chunkObj || typeof chunkObj !== 'object') return '';
    if (protocol === 'gemini') {
      const parts = chunkObj?.candidates?.[0]?.content?.parts || [];
      let out = '';
      for (const p of parts) {
        if (p && !p.thought && typeof p.text === 'string') out += p.text;
      }
      return out;
    }
    const c = chunkObj?.choices?.[0];
    return c?.delta?.content || c?.message?.content || '';
  }

  function buildRequestPayload(settings, messages, stream) {
    const cleanKey = sanitizeApiKey(settings.apiKey);
    const headers = { 'Content-Type': 'application/json' };
    if (settings.protocol === 'gemini') {
      if (cleanKey) headers['x-goog-api-key'] = cleanKey;
      const sys = messages.find((m) => m.role === 'system');
      const usr = messages.filter((m) => m.role !== 'system');
      const normModel = String(settings.model || '').replace(/^models\//i, '').trim().toLowerCase();
      const isG3Or4 = /^gemini-(?:3|4)(?:[.\-]|$)/.test(normModel);
      const generationConfig = {};
      if (!isG3Or4) generationConfig.temperature = Number(settings.temperature ?? 0.2);
      const tc = resolveThinkingConfig(settings.model, settings.thinkingEffort || 'fastest');
      if (tc) generationConfig.thinkingConfig = tc;
      const body = {
        contents: usr.map((m) => ({ role: 'user', parts: [{ text: m.content }] })),
        generationConfig
      };
      if (sys) body.systemInstruction = { parts: [{ text: sys.content }] };
      return {
        url: stream ? resolveStreamEndpoint(settings) : resolveEndpoint(settings),
        headers,
        body: JSON.stringify(body)
      };
    } else {
      if (cleanKey) headers['Authorization'] = `Bearer ${cleanKey}`;
      const model = String(settings.model || '').trim();
      const body = { model, messages, stream: Boolean(stream) };
      if (!/^o[134](?:-|$)|deepseek-reasoner|^r1\b/i.test(model)) {
        body.temperature = Number(settings.temperature ?? 0.2);
      }
      return {
        url: resolveEndpoint(settings),
        headers,
        body: JSON.stringify(body)
      };
    }
  }

  function callViaGmXhr(reqConfig) {
    const gmXhr = typeof GM_xmlhttpRequest === 'function'
      ? GM_xmlhttpRequest
      : (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);
    if (!gmXhr) {
      return Promise.reject(new Error('此頁面 CSP 阻擋了直接連線，請在 Tampermonkey / Stay Userscript 環境執行'));
    }
    return new Promise((resolve, reject) => {
      gmXhr({
        method: 'POST',
        url: reqConfig.url,
        headers: reqConfig.headers,
        data: reqConfig.body,
        timeout: 35000,
        onload(res) {
          if (res.status >= 200 && res.status < 300) {
            resolve(res.responseText || '');
          } else {
            reject(new Error(`HTTP ${res.status}: ${String(res.responseText || '').slice(0, 180)}`));
          }
        },
        onerror() {
          reject(new Error('GM_xmlhttpRequest 網路請求失敗'));
        },
        ontimeout() {
          reject(new Error('GM_xmlhttpRequest 請求逾時'));
        }
      });
    });
  }

  async function translateBatchItems(settings, items, pageContext, onItem) {
    if (!items || items.length === 0) return;
    const cleanKey = sanitizeApiKey(settings.apiKey);
    if (!cleanKey && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(settings.baseUrl || '')) {
      const err = new Error('請先點擊 ⚙ 設定 API Key');
      err.errorCode = 'NO_API_KEY';
      throw err;
    }

    const sig = buildCacheSignature(settings);
    const cacheKeys = items.map((it) => `${sig}::${it.key}`);
    const hits = await cacheGetMany(cacheKeys);
    const uncached = [];

    for (let i = 0; i < items.length; i++) {
      const hit = hits.get(cacheKeys[i]);
      if (hit) {
        onItem(items[i], hit, true);
      } else {
        uncached.push(items[i]);
      }
    }
    if (uncached.length === 0) return;

    const payload = uncached.map((it, idx) =>
      it.kind === 'comment' ? { i: idx, kind: 'comment', text: it.text } : { i: idx, text: it.text }
    );
    const messages = [
      { role: 'system', content: buildStreamSystemPrompt(settings, pageContext) },
      { role: 'user', content: JSON.stringify(payload) }
    ];

    const emitted = new Set();
    const toCache = [];
    const handleLine = (line) => {
      for (const entry of parseNdjsonLine(line)) {
        if (entry.idx >= 0 && entry.idx < uncached.length && !emitted.has(entry.idx)) {
          emitted.add(entry.idx);
          const item = uncached[entry.idx];
          onItem(item, entry.text, false);
          toCache.push({ key: `${sig}::${item.key}`, zh: entry.text });
        }
      }
    };

    try {
      const reqConfig = buildRequestPayload(settings, messages, true);
      const response = await fetch(reqConfig.url, {
        method: 'POST',
        headers: reqConfig.headers,
        body: reqConfig.body
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errText.slice(0, 180)}`);
      }

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuf = '';
        let ndjsonBuf = '';
        const processSse = (raw) => {
          const line = raw.trim();
          if (!line.startsWith('data:')) return;
          const d = line.slice(5).trim();
          if (!d || d === '[DONE]') return;
          try {
            const delta = extractDelta(settings.protocol, JSON.parse(d));
            if (delta) {
              ndjsonBuf += delta;
              let nl;
              while ((nl = ndjsonBuf.indexOf('\n')) !== -1) {
                const l = ndjsonBuf.slice(0, nl);
                ndjsonBuf = ndjsonBuf.slice(nl + 1);
                handleLine(l);
              }
            }
          } catch (_) {}
        };
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          sseBuf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = sseBuf.indexOf('\n')) !== -1) {
            const l = sseBuf.slice(0, nl);
            sseBuf = sseBuf.slice(nl + 1);
            processSse(l);
          }
        }
        if (sseBuf.trim()) processSse(sseBuf);
        if (ndjsonBuf.trim()) handleLine(ndjsonBuf);
      } else {
        const rawText = await response.text();
        for (const l of rawText.split('\n')) handleLine(l);
      }
    } catch (fetchErr) {
      // Automatic fallback to GM_xmlhttpRequest if page CSP blocks connect-src!
      const nonStreamConfig = buildRequestPayload(settings, messages, false);
      const rawResp = await callViaGmXhr(nonStreamConfig);
      try {
        const parsed = JSON.parse(rawResp);
        const fullText = extractDelta(settings.protocol, parsed);
        for (const l of String(fullText || '').split('\n')) handleLine(l);
      } catch (_) {
        for (const l of String(rawResp || '').split('\n')) handleLine(l);
      }
    }

    if (toCache.length > 0) {
      await cachePutMany(toCache);
    }
  }

  // ============================================================
  // 5. Page Translation Orchestrator + Lazy IntersectionObserver
  // ============================================================
  const state = {
    settings: readStoredSettings(),
    isPageActive: false,
    isTranslating: false,
    translationEpoch: 0,
    elementState: new WeakMap(),
    pendingItems: [],
    totalDetected: 0,
    totalTranslated: 0,
    lastErrorMsg: '',
    viewportObserver: null,
    flushTimer: null
  };

  function ensurePageStyleInjected() {
    if (document.querySelector('style[data-kct-ui="page-style"]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-kct-ui', 'page-style');
    style.textContent = PAGE_STYLE_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function enqueueItemForTranslation(item) {
    state.pendingItems.push(item);
    if (!state.flushTimer) {
      state.flushTimer = setTimeout(() => {
        state.flushTimer = null;
        flushTranslationQueue();
      }, 60);
    }
  }

  async function flushTranslationQueue() {
    if (state.isTranslating || state.pendingItems.length === 0) return;
    state.isTranslating = true;
    const epoch = state.translationEpoch;
    const pageContext = KCTSiteAnalyzer.classifyPage();
    updatePillStatus();

    try {
      while (state.pendingItems.length > 0 && epoch === state.translationEpoch) {
        const batchSize = Math.max(1, Number(state.settings.batchSize || 16));
        const batch = state.pendingItems.splice(0, batchSize);

        await translateBatchItems(state.settings, batch, pageContext, (item, zh) => {
          if (epoch !== state.translationEpoch) return;
          if (item.kind === 'comment') {
            KCTCodeOverlay.renderCommentTranslation({ ...item, zh }, state.settings, state);
          } else {
            KCTRenderer.applyBlockTranslation({ ...item, zh }, state.settings, state);
          }
          state.totalTranslated += 1;
          updatePillStatus();
        });
      }
    } catch (err) {
      state.lastErrorMsg = err?.message || '翻譯失敗';
      if (err?.errorCode === 'NO_API_KEY') {
        openSettingsModal();
      }
    } finally {
      state.isTranslating = false;
      updatePillStatus();
    }
  }

  function prepareBlockItem(el) {
    const { text, placeholders, nestedListEl } = KCTSiteAnalyzer.extractBlockContent(el);
    if (!KCTSiteAnalyzer.shouldTranslateText(text, state.settings.targetLang)) {
      state.elementState.set(el, 'skip');
      return null;
    }
    const typo = KCTSiteAnalyzer.probeTypography(el);
    return {
      kind: 'block',
      el,
      key: hashText(text),
      text,
      placeholders,
      nestedListEl,
      typo,
      epoch: state.translationEpoch
    };
  }

  function startPageTranslation() {
    ensurePageStyleInjected();
    state.isPageActive = true;
    state.lastErrorMsg = '';
    KCTRenderer.applyDisplayModeClass({ ...state.settings, enabled: true });

    if (!state.viewportObserver) {
      state.viewportObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target;
            state.viewportObserver.unobserve(el);
            if (state.elementState.get(el) !== 'observed') continue;
            const item = prepareBlockItem(el);
            if (item) {
              state.elementState.set(el, 'queued');
              state.totalDetected += 1;
              enqueueItemForTranslation(item);
            }
          }
        },
        { rootMargin: '360px 0px', threshold: 0.01 }
      );
    }

    const roots = KCTSiteAnalyzer.findContentRoots('course');
    const candidates = KCTSiteAnalyzer.collectUniversalCandidateElements(roots, 'course', state.elementState);
    const vh = window.innerHeight || 800;

    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const inView = rect.bottom >= -200 && rect.top <= vh + 280;
      if (inView) {
        const item = prepareBlockItem(el);
        if (item) {
          state.elementState.set(el, 'queued');
          state.totalDetected += 1;
          enqueueItemForTranslation(item);
        }
      } else {
        state.elementState.set(el, 'observed');
        state.viewportObserver.observe(el);
      }
    }

    const commentItems = KCTCodeOverlay.collectCodeComments(true, state.settings, state);
    for (const cItem of commentItems) {
      state.totalDetected += 1;
      enqueueItemForTranslation(cItem);
    }

    if (!state.domMutationObserver && document.body) {
      let mutTimer = null;
      state.domMutationObserver = new MutationObserver((mutations) => {
        if (!state.isPageActive) return;
        let hasNew = false;
        for (const m of mutations) {
          if (m.target?.closest?.('[data-kct-ui]')) continue;
          if (m.addedNodes && m.addedNodes.length > 0) {
            for (const n of m.addedNodes) {
              if (n.nodeType === 1 && !n.matches?.('[data-kct-ui]')) {
                hasNew = true;
                break;
              }
            }
          }
          if (hasNew) break;
        }
        if (hasNew) {
          if (mutTimer) clearTimeout(mutTimer);
          mutTimer = setTimeout(() => {
            if (state.isPageActive) startPageTranslation();
          }, 320);
        }
      });
      state.domMutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    updatePillStatus();
  }

  function revertPageTranslation() {
    if (state.viewportObserver) {
      state.viewportObserver.disconnect();
    }
    if (state.domMutationObserver) {
      state.domMutationObserver.disconnect();
      state.domMutationObserver = null;
    }
    KCTRenderer.clearAllInjectedTranslations(state, KCTCodeOverlay);
    state.isPageActive = false;
    state.isTranslating = false;
    updatePillStatus();
  }

  // ============================================================
  // 6. Shadow DOM Edge Tab ("NR") + Expandable Pill + Settings Modal
  // ============================================================
  let uiRefs = null;

  function buildShadowUI() {
    if (uiRefs || !document.body) return;
    const host = document.createElement('div');
    host.setAttribute('data-kct-ui', 'userscript-host');
    host.setAttribute('translate', 'no');
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        right: 12px;
        bottom: max(18px, env(safe-area-inset-bottom, 18px));
        z-index: 2147483646;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", sans-serif;
        color: #f8fafc;
      }
      .nr-edge-tab {
        appearance: none;
        border: 1px solid rgba(148, 163, 184, 0.32);
        background: rgba(15, 23, 42, 0.78);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        color: #38bdf8;
        font-weight: 800;
        font-size: 12px;
        letter-spacing: 0.03em;
        width: 38px;
        height: 38px;
        border-radius: 999px;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.78;
        transition: opacity 0.16s ease, transform 0.16s ease;
        touch-action: none;
      }
      .nr-edge-tab:hover {
        opacity: 1;
        transform: scale(1.05);
      }
      .nr-pill {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.92);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(148, 163, 184, 0.28);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
        font-size: 12px;
        max-width: calc(100vw - 24px);
        overflow-x: auto;
      }
      .nr-pill[hidden], .nr-edge-tab[hidden], .nr-modal-backdrop[hidden], .nr-toast[hidden] {
        display: none !important;
      }
      .nr-btn {
        appearance: none;
        border: 0;
        background: rgba(255, 255, 255, 0.1);
        color: #f1f5f9;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        padding: 5px 10px;
        border-radius: 999px;
        cursor: pointer;
        white-space: nowrap;
      }
      .nr-btn.is-primary {
        background: #0284c7;
        color: #ffffff;
      }
      .nr-btn.is-active {
        background: #38bdf8;
        color: #0f172a;
      }
      .nr-status {
        font-size: 11px;
        color: #94a3b8;
        white-space: nowrap;
        padding: 0 4px;
      }
      .nr-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(2, 6, 23, 0.65);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        z-index: 2147483647;
      }
      .nr-modal {
        width: 100%;
        max-width: 400px;
        background: #0f172a;
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 16px;
        padding: 18px;
        box-shadow: 0 24px 54px rgba(0, 0, 0, 0.6);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .nr-modal-title {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
        color: #f8fafc;
      }
      .nr-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .nr-field label {
        font-size: 11.5px;
        color: #cbd5e1;
        font-weight: 600;
      }
      .nr-field input, .nr-field select {
        font-family: inherit;
        font-size: 13px;
        padding: 7px 10px;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: #1e293b;
        color: #f8fafc;
      }
      .nr-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 4px;
      }
      .nr-toast {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        background: #0284c7;
        color: #fff;
        padding: 8px 16px;
        border-radius: 999px;
        font-size: 12.5px;
        font-weight: 600;
        box-shadow: 0 8px 24px rgba(2, 132, 199, 0.45);
      }
    `;

    // Edge Tab ("NR")
    const edgeTab = document.createElement('button');
    edgeTab.type = 'button';
    edgeTab.className = 'nr-edge-tab';
    edgeTab.textContent = 'NR';
    edgeTab.title = '展開 NativeRead 原版排版翻譯';

    // Expanded Control Pill
    const pill = document.createElement('div');
    pill.className = 'nr-pill';
    pill.hidden = true;

    const translateBtn = document.createElement('button');
    translateBtn.type = 'button';
    translateBtn.className = 'nr-btn is-primary';
    translateBtn.textContent = '立即翻譯';

    const modeReplaceBtn = document.createElement('button');
    modeReplaceBtn.type = 'button';
    modeReplaceBtn.className = 'nr-btn is-active';
    modeReplaceBtn.textContent = '譯文';

    const modeBilingualBtn = document.createElement('button');
    modeBilingualBtn.type = 'button';
    modeBilingualBtn.className = 'nr-btn';
    modeBilingualBtn.textContent = '雙語';

    const modeOrigBtn = document.createElement('button');
    modeOrigBtn.type = 'button';
    modeOrigBtn.className = 'nr-btn';
    modeOrigBtn.textContent = '原文';

    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = 'nr-btn';
    starBtn.textContent = '☆';
    starBtn.title = '將此網站加入自動翻譯白名單';

    const gearBtn = document.createElement('button');
    gearBtn.type = 'button';
    gearBtn.className = 'nr-btn';
    gearBtn.textContent = '⚙';
    gearBtn.title = '設定 API Key 與模型';

    const statusSpan = document.createElement('span');
    statusSpan.className = 'nr-status';
    statusSpan.textContent = '就緒';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'nr-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = '收起懸浮膠囊';

    pill.append(
      translateBtn,
      modeReplaceBtn,
      modeBilingualBtn,
      modeOrigBtn,
      starBtn,
      gearBtn,
      statusSpan,
      closeBtn
    );

    // Settings Modal inside Shadow DOM
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'nr-modal-backdrop';
    modalBackdrop.hidden = true;

    const modal = document.createElement('div');
    modal.className = 'nr-modal';

    const modalTitle = document.createElement('h3');
    modalTitle.className = 'nr-modal-title';
    modalTitle.textContent = '⚙ NativeRead 模型與 API Key 設定';

    const makeField = (labelText, inputEl) => {
      const wrap = document.createElement('div');
      wrap.className = 'nr-field';
      const lbl = document.createElement('label');
      lbl.textContent = labelText;
      wrap.append(lbl, inputEl);
      return wrap;
    };

    const providerSelect = document.createElement('select');
    for (const p of Object.values(PROVIDER_PRESETS)) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      providerSelect.appendChild(opt);
    }

    const apiKeyInput = document.createElement('input');
    apiKeyInput.type = 'password';
    apiKeyInput.placeholder = '填入 API Key...';

    const modelInput = document.createElement('input');
    modelInput.type = 'text';
    modelInput.placeholder = '模型名稱 (如 gemini-3.5-flash-lite)';

    const langSelect = document.createElement('select');
    for (const [id, info] of Object.entries(TARGET_LANGUAGES)) {
      if (id === 'custom' && state.settings?.targetLang !== 'custom' && !state.settings?.customTargetLang) continue;
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id === 'custom'
        ? String(state.settings?.customTargetLang || info.label)
        : info.label;
      langSelect.appendChild(opt);
    }

    providerSelect.addEventListener('change', () => {
      const preset = PROVIDER_PRESETS[providerSelect.value] || PROVIDER_PRESETS.gemini;
      modelInput.value = preset.defaultModel || '';
    });

    const modalActions = document.createElement('div');
    modalActions.className = 'nr-modal-actions';

    const cancelModalBtn = document.createElement('button');
    cancelModalBtn.type = 'button';
    cancelModalBtn.className = 'nr-btn';
    cancelModalBtn.textContent = '取消';

    const saveModalBtn = document.createElement('button');
    saveModalBtn.type = 'button';
    saveModalBtn.className = 'nr-btn is-primary';
    saveModalBtn.textContent = '儲存並翻譯';

    modalActions.append(cancelModalBtn, saveModalBtn);
    modal.append(
      modalTitle,
      makeField('AI 服務商', providerSelect),
      makeField('API Key 金鑰', apiKeyInput),
      makeField('模型 ID', modelInput),
      makeField('目標語言', langSelect),
      modalActions
    );
    modalBackdrop.appendChild(modal);

    const toast = document.createElement('div');
    toast.className = 'nr-toast';
    toast.hidden = true;

    shadow.append(style, edgeTab, pill, modalBackdrop, toast);
    document.body.appendChild(host);

    uiRefs = {
      host,
      edgeTab,
      pill,
      translateBtn,
      modeReplaceBtn,
      modeBilingualBtn,
      modeOrigBtn,
      starBtn,
      gearBtn,
      statusSpan,
      closeBtn,
      modalBackdrop,
      providerSelect,
      apiKeyInput,
      modelInput,
      langSelect,
      cancelModalBtn,
      saveModalBtn,
      toast
    };

    // Vertical drag along screen edge for NR tab
    let dragStartY = 0;
    let startBottom = 18;
    let moved = false;
    edgeTab.addEventListener('pointerdown', (e) => {
      dragStartY = e.clientY;
      const computedBottom = parseFloat(getComputedStyle(host).bottom) || 18;
      startBottom = computedBottom;
      moved = false;
      edgeTab.setPointerCapture(e.pointerId);
    });
    edgeTab.addEventListener('pointermove', (e) => {
      if (!edgeTab.hasPointerCapture(e.pointerId)) return;
      const dy = dragStartY - e.clientY;
      if (Math.abs(dy) > 6) moved = true;
      if (moved) {
        const nextBottom = Math.max(12, Math.min(window.innerHeight - 60, startBottom + dy));
        host.style.bottom = `${Math.round(nextBottom)}px`;
      }
    });
    edgeTab.addEventListener('pointerup', (e) => {
      if (edgeTab.hasPointerCapture(e.pointerId)) {
        edgeTab.releasePointerCapture(e.pointerId);
      }
      if (!moved) {
        edgeTab.hidden = true;
        pill.hidden = false;
      }
    });

    globalThis.__NATIVEREAD_OPEN_PILL__ = () => {
      edgeTab.hidden = true;
      pill.hidden = false;
      if (!state.isPageActive) {
        startPageTranslation();
      }
    };

    translateBtn.addEventListener('click', () => {
      if (state.isPageActive) {
        revertPageTranslation();
      }
      startPageTranslation();
    });

    const setDisplayMode = (mode) => {
      state.settings = writeStoredSettings({ displayMode: mode });
      KCTRenderer.applyDisplayModeClass({ ...state.settings, enabled: true });
      modeReplaceBtn.classList.toggle('is-active', mode === 'replace');
      modeBilingualBtn.classList.toggle('is-active', mode === 'bilingual');
      modeOrigBtn.classList.toggle('is-active', mode === 'original');
      if (!state.isPageActive && mode !== 'original') {
        startPageTranslation();
      }
    };

    modeReplaceBtn.addEventListener('click', () => setDisplayMode('replace'));
    modeBilingualBtn.addEventListener('click', () => setDisplayMode('bilingual'));
    modeOrigBtn.addEventListener('click', () => setDisplayMode('original'));

    starBtn.addEventListener('click', () => {
      const hostName = normalizeHostname(location.hostname);
      const cur = Array.isArray(state.settings.autoTranslateHosts) ? state.settings.autoTranslateHosts : [];
      const exists = isHostWhitelisted(hostName, state.settings);
      const nextHosts = exists
        ? cur.filter((h) => !(hostName === h || hostName.endsWith(`.${h}`)))
        : [...cur, hostName];
      state.settings = writeStoredSettings({ autoTranslateHosts: nextHosts });
      updatePillStatus();
    });

    gearBtn.addEventListener('click', () => openSettingsModal());
    cancelModalBtn.addEventListener('click', () => { modalBackdrop.hidden = true; });

    saveModalBtn.addEventListener('click', () => {
      const pid = providerSelect.value;
      const preset = PROVIDER_PRESETS[pid] || PROVIDER_PRESETS.gemini;
      state.settings = writeStoredSettings({
        providerId: pid,
        protocol: preset.protocol,
        baseUrl: preset.baseUrl,
        apiKey: sanitizeApiKey(apiKeyInput.value),
        model: modelInput.value.trim() || preset.defaultModel,
        targetLang: langSelect.value
      });
      modalBackdrop.hidden = true;
      if (state.isPageActive) {
        revertPageTranslation();
      }
      startPageTranslation();
    });

    closeBtn.addEventListener('click', () => {
      pill.hidden = true;
      edgeTab.hidden = false;
    });

    updatePillStatus();
  }

  function openSettingsModal() {
    if (!uiRefs) buildShadowUI();
    if (!uiRefs) return;
    uiRefs.edgeTab.hidden = true;
    uiRefs.pill.hidden = false;
    uiRefs.providerSelect.value = PROVIDER_PRESETS[state.settings.providerId] ? state.settings.providerId : 'gemini';
    uiRefs.apiKeyInput.value = state.settings.apiKey || '';
    uiRefs.modelInput.value = state.settings.model || '';
    uiRefs.langSelect.value = state.settings.targetLang || 'zh-TW';
    uiRefs.modalBackdrop.hidden = false;
  }

  function showToast(msg) {
    if (!uiRefs) buildShadowUI();
    if (!uiRefs) return;
    uiRefs.toast.textContent = msg;
    uiRefs.toast.hidden = false;
    setTimeout(() => {
      uiRefs.toast.hidden = true;
    }, 3500);
  }

  function updatePillStatus() {
    if (!uiRefs) return;
    const whitelisted = isHostWhitelisted(location.hostname, state.settings);
    uiRefs.starBtn.textContent = whitelisted ? '★' : '☆';
    uiRefs.starBtn.classList.toggle('is-active', whitelisted);

    if (state.lastErrorMsg) {
      uiRefs.statusSpan.textContent = state.lastErrorMsg;
      return;
    }
    if (state.isTranslating) {
      uiRefs.statusSpan.textContent = `翻譯中 ${state.totalTranslated}/${state.totalDetected}`;
    } else if (state.totalTranslated > 0) {
      uiRefs.statusSpan.textContent = `已譯 ${state.totalTranslated} 段`;
    } else {
      uiRefs.statusSpan.textContent = '就緒';
    }
  }

  // ============================================================
  // 7. Boot
  // ============================================================
  function boot() {
    if (!KCTSiteAnalyzer.isTopFrame()) return;
    const synced = checkAndApplyNrSyncHash();
    state.settings = readStoredSettings();
    buildShadowUI();
    if (synced) {
      showToast('✅ 已從電腦端同步 API Key 與偏好設定！');
    }
    if (isHostWhitelisted(location.hostname, state.settings)) {
      startPageTranslation();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
