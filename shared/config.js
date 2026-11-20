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

  function isPdfUrl(url) {
    if (!url || typeof url !== 'string') return false;
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'file:') {
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
