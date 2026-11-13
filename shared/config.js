(() => {
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
      label: 'Google Gemini（原生介面）',
      protocol: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      defaultModel: 'gemini-2.5-flash',
      placeholderKey: 'AIza...',
      hint: '使用 Google AI Studio API Key，支援 gemini-2.5-flash / gemini-2.0-flash。'
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
      defaultModel: 'google/gemini-2.0-flash-001',
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

  const TARGET_LANGUAGES = {
    'zh-TW': {
      id: 'zh-TW',
      label: '繁體中文（台灣）',
      shortLabel: '繁中',
      promptName: 'Traditional Chinese (Taiwanese Mandarin phrasing and terminology)',
      fontClass: 'kct-lang-tc',
      testSampleHint: '繁體中文（台灣用語）'
    },
    'zh-CN': {
      id: 'zh-CN',
      label: '简体中文',
      shortLabel: '简中',
      promptName: 'Simplified Chinese (Mainland China phrasing)',
      fontClass: 'kct-lang-sc',
      testSampleHint: '简体中文'
    },
    ja: {
      id: 'ja',
      label: '日本語',
      shortLabel: '日本語',
      promptName: 'Japanese (natural technical Japanese)',
      fontClass: 'kct-lang-ja',
      testSampleHint: '日本語'
    },
    ko: {
      id: 'ko',
      label: '한국어',
      shortLabel: '한국어',
      promptName: 'Korean (natural technical Korean)',
      fontClass: 'kct-lang-ko',
      testSampleHint: '한국어'
    },
    es: {
      id: 'es',
      label: 'Español',
      shortLabel: 'ES',
      promptName: 'Spanish (neutral technical Spanish)',
      fontClass: 'kct-lang-latin',
      testSampleHint: 'Español'
    },
    fr: {
      id: 'fr',
      label: 'Français',
      shortLabel: 'FR',
      promptName: 'French (natural technical French)',
      fontClass: 'kct-lang-latin',
      testSampleHint: 'Français'
    },
    de: {
      id: 'de',
      label: 'Deutsch',
      shortLabel: 'DE',
      promptName: 'German (natural technical German)',
      fontClass: 'kct-lang-latin',
      testSampleHint: 'Deutsch'
    },
    vi: {
      id: 'vi',
      label: 'Tiếng Việt',
      shortLabel: 'VI',
      promptName: 'Vietnamese (natural technical Vietnamese)',
      fontClass: 'kct-lang-latin',
      testSampleHint: 'Tiếng Việt'
    },
    pt: {
      id: 'pt',
      label: 'Português',
      shortLabel: 'PT',
      promptName: 'Portuguese (natural technical Portuguese)',
      fontClass: 'kct-lang-latin',
      testSampleHint: 'Português'
    },
    custom: {
      id: 'custom',
      label: '自訂語言...',
      shortLabel: '自訂',
      promptName: '',
      fontClass: 'kct-lang-latin',
      testSampleHint: 'Custom'
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

  const DEFAULT_SETTINGS = {
    settingsSchemaVersion: 2,
    enabled: true,
    autoTranslate: true,
    targetLang: 'zh-TW',
    customTargetLang: '',
    displayMode: 'replace', // 'replace' | 'original' | 'bilingual'
    scope: 'course', // 'course' | 'all'
    translateCodeComments: true,
    selectionTranslate: true,
    showFloatingBall: true,
    showOutputTranslateBtn: true,
    providerId: 'deepseek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.2,
    batchSize: 8,
    maxBatchChars: 1800,
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
        isCustom: true
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
    if (clean.includes(':generateContent')) return clean;
    if (/\/v1(beta)?$/i.test(clean)) {
      return `${clean}/models/${encodeURIComponent(m)}:generateContent`;
    }
    return `${clean}/v1beta/models/${encodeURIComponent(m)}:generateContent`;
  }

  function resolveEndpoint(settings) {
    if (settings.protocol === 'gemini') {
      return normalizeGeminiEndpoint(settings.baseUrl, settings.model);
    }
    return normalizeOpenAIEndpoint(settings.baseUrl);
  }

  async function getSettings() {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    const raw = data[SETTINGS_KEY];
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    if ((raw.settingsSchemaVersion || 1) < 2) {
      const migrated = {
        ...DEFAULT_SETTINGS,
        ...raw,
        targetLang: raw.targetLang || 'zh-TW',
        displayMode: raw.displayMode === 'bilingual' ? 'replace' : (raw.displayMode || 'replace'),
        translateCodeComments: raw.translateCodeComments ?? true,
        customGlossary: (!raw.customGlossary || raw.customGlossary.includes('过拟合'))
          ? DEFAULT_GLOSSARY
          : raw.customGlossary,
        settingsSchemaVersion: 2
      };
      await chrome.storage.local.set({ [SETTINGS_KEY]: migrated });
      return migrated;
    }
    return { ...DEFAULT_SETTINGS, ...raw };
  }

  async function saveSettings(partial) {
    const current = await getSettings();
    const next = { ...current, ...partial, settingsSchemaVersion: 2 };
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
    sanitizeApiKey,
    getSettings,
    saveSettings,
    hashText
  };
})();
