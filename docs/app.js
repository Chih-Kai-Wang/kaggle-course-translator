import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';

// ============================================================
// 1. Shared Configuration, Provider Presets & Typography Stacks
// ============================================================
const SETTINGS_KEY = 'kct_settings_v1';
const DB_NAME = 'kct_cache_db_v2';
const DB_VERSION = 1;
const STORE_NAME = 'entries';
const MAX_CACHE_ENTRIES = 20000;

const PROVIDER_PRESETS = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek（推薦 · 高性價比）',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    suggestedModels: ['deepseek-chat'],
    placeholderKey: 'sk-...',
    hint: '支援 deepseek-chat (V3)，機器學習與資料科學術語翻譯準確、速度快、成本極低。'
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
  openai: {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'],
    placeholderKey: 'sk-...',
    hint: '建議使用 gpt-4o-mini 或 gpt-4.1-mini。'
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
  qwen: {
    id: 'qwen',
    label: '通義千問 Qwen（阿里雲百煉）',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    suggestedModels: ['qwen-plus', 'qwen-turbo-latest'],
    placeholderKey: 'sk-...',
    hint: '建議使用 qwen-plus 或 qwen-turbo-latest。'
  },
  siliconflow: {
    id: 'siliconflow',
    label: 'SiliconFlow 矽基流動',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    suggestedModels: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
    placeholderKey: 'sk-...',
    hint: '可呼叫 DeepSeek-V3、Qwen2.5 等多種開源模型。'
  },
  zhipu: {
    id: 'zhipu',
    label: '智譜 GLM',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    suggestedModels: ['glm-4-flash', 'glm-4-plus'],
    placeholderKey: '...',
    hint: 'glm-4-flash 提供免費額度。'
  },
  moonshot: {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    suggestedModels: ['moonshot-v1-8k', 'moonshot-v1-32k'],
    placeholderKey: 'sk-...',
    hint: '中文語意理解流暢。'
  },
  custom: {
    id: 'custom',
    label: '自訂 OpenAI 相容介面',
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5:7b',
    suggestedModels: [],
    placeholderKey: '可留空或填金鑰',
    hint: '支援任何 OpenAI 相容中轉站或本機端點。'
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
    serifFontStack: '"Songti TC", "Noto Serif TC", "PMingLiU", serif',
    sansFontStack: '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif',
    monoFontStack: '"PingFang TC", "Noto Sans TC", monospace'
  },
  'zh-CN': {
    id: 'zh-CN',
    label: '简体中文',
    shortLabel: '简中',
    promptName: 'Simplified Chinese (Mainland China phrasing)',
    serifFontStack: '"Songti SC", "Noto Serif SC", "SimSun", serif',
    sansFontStack: '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
    monoFontStack: '"PingFang SC", "Noto Sans SC", monospace'
  },
  ja: {
    id: 'ja',
    label: '日本語',
    shortLabel: '日本語',
    promptName: 'Japanese (natural technical Japanese)',
    serifFontStack: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif',
    sansFontStack: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif',
    monoFontStack: '"Hiragino Sans", "Noto Sans JP", monospace'
  },
  ko: {
    id: 'ko',
    label: '한국어',
    shortLabel: '한국어',
    promptName: 'Korean (natural technical Korean)',
    serifFontStack: '"AppleMyungjo", "Batang", "Noto Serif KR", serif',
    sansFontStack: '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif',
    monoFontStack: '"Apple SD Gothic Neo", "Noto Sans KR", monospace'
  },
  es: {
    id: 'es',
    label: 'Español',
    shortLabel: 'ES',
    promptName: 'Spanish (neutral technical Spanish)',
    ...LATIN_FONTS
  },
  fr: {
    id: 'fr',
    label: 'Français',
    shortLabel: 'FR',
    promptName: 'French (natural technical French)',
    ...LATIN_FONTS
  },
  de: {
    id: 'de',
    label: 'Deutsch',
    shortLabel: 'DE',
    promptName: 'German (natural technical German)',
    ...LATIN_FONTS
  },
  vi: {
    id: 'vi',
    label: 'Tiếng Việt',
    shortLabel: 'VI',
    promptName: 'Vietnamese (natural technical Vietnamese)',
    ...LATIN_FONTS
  },
  pt: {
    id: 'pt',
    label: 'Português',
    shortLabel: 'PT',
    promptName: 'Portuguese (natural technical Portuguese)',
    ...LATIN_FONTS
  },
  custom: {
    id: 'custom',
    label: '自訂語言...',
    shortLabel: '自訂',
    promptName: '',
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

const DEFAULT_SETTINGS = {
  settingsSchemaVersion: 5,
  targetLang: 'zh-TW',
  customTargetLang: '',
  thinkingEffort: 'fastest',
  typographyMatch: 'native',
  providerId: 'gemini',
  protocol: 'gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: '',
  model: 'gemini-3.5-flash-lite',
  temperature: 0.2,
  batchSize: 18,
  maxBatchChars: 5000,
  customGlossary: DEFAULT_GLOSSARY
};

const ZOOM_STEPS = [0.75, 0.85, 1.0, 1.15, 1.25, 1.5, 1.75];
const SERIF_FONT_REGEX = /serif|times|garamond|georgia|mincho|cambria|palatino|cmr|charter|merriweather|baskerville|book|roman|caslon|minion|nimbusrom|computer\s*modern/i;
const SANS_FONT_REGEX = /sans|arial|helvetica|calibri|roboto|inter|lato|open\s*sans|verdana|tahoma|gothic|cmss|nimbus\s*sans/i;
const MONO_FONT_REGEX = /mono|courier|consolas|menlo|code|cmtt|inconsolata|fira\s*code|dejavusansmono/i;
const BOLD_FONT_REGEX = /bold|black|heavy|semibold|demi|medi|bx\d/i;
const BULLET_PREFIX_REGEX = /^(?:[•●▪▸►‣⁃◦–—\-*]|(?:\(?\d{1,3}[.)])|(?:[a-zA-Z][.)]\s))(?:\s|$)/;

function hashText(str) {
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

function resolveTargetLanguage(settings) {
  const id = settings?.targetLang || 'zh-TW';
  if (id === 'custom') {
    const customName = String(settings?.customTargetLang || '').trim();
    return {
      id: 'custom',
      label: customName || '自訂語言',
      shortLabel: customName ? customName.slice(0, 4) : '自訂',
      promptName: customName || 'Traditional Chinese (Taiwan)',
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
  const m = String(model || 'gemini-3.5-flash-lite').trim().replace(/^models\//, '');
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

// ============================================================
// 2. Settings Storage & #nr_sync Zero-Typing Sync Decoder
// ============================================================
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(partial) {
  const current = loadSettings();
  const next = { ...current, ...partial };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch (_) {}
  return next;
}

function decodeBase64UrlJson(b64url) {
  const base64 = String(b64url || '')
    .trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = base64 + '==='.slice((base64.length + 3) % 4);
  const binStr = atob(padded);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  const jsonStr = new TextDecoder().decode(bytes);
  return JSON.parse(jsonStr);
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

    saveSettings({
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

    // Scrub sensitive hash from address bar and browser history
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return true;
  } catch (err) {
    console.warn('[NativeRead] Failed to decode #nr_sync payload:', err);
    return false;
  }
}

// ============================================================
// 3. IndexedDB Persistent Cache (kct_cache_db_v2)
// ============================================================
let dbPromise = null;

function openCacheDB() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const store = db.objectStoreNames.contains(STORE_NAME)
          ? req.transaction.objectStore(STORE_NAME)
          : db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        if (!store.indexNames.contains('ts')) {
          store.createIndex('ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    } catch (err) {
      dbPromise = null;
      reject(err);
    }
  });
  return dbPromise;
}

async function cacheGetMany(keys) {
  const out = new Map();
  if (!Array.isArray(keys) || keys.length === 0) return out;
  try {
    const db = await openCacheDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      for (const k of keys) {
        const req = store.get(k);
        req.onsuccess = () => {
          if (req.result && typeof req.result.zh === 'string' && req.result.zh.trim()) {
            out.set(k, req.result.zh);
          }
        };
      }
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => resolve(out);
    });
  } catch (_) {
    return out;
  }
}

async function cachePutMany(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  try {
    const db = await openCacheDB();
    const now = Date.now();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      entries.forEach((entry, idx) => {
        if (entry?.key && entry?.zh) {
          store.put({ key: entry.key, zh: entry.zh, ts: now + idx });
        }
      });
      const countReq = store.count();
      countReq.onsuccess = () => {
        let overflow = (countReq.result || 0) - MAX_CACHE_ENTRIES;
        if (overflow > 0) {
          const curReq = store.index('ts').openCursor(null, 'next');
          curReq.onsuccess = () => {
            const cursor = curReq.result;
            if (cursor && overflow > 0) {
              cursor.delete();
              overflow -= 1;
              if (overflow > 0) cursor.continue();
            }
          };
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (_) {}
}

async function cacheCount() {
  try {
    const db = await openCacheDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
  } catch (_) {
    return 0;
  }
}

async function cacheClear() {
  try {
    const db = await openCacheDB();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (_) {}
}

function buildCacheSignature(settings) {
  const lang = resolveTargetLanguage(settings);
  const glossaryHash = hashText(String(settings.customGlossary || '').trim());
  const customLang = lang.id === 'custom' ? String(settings.customTargetLang || '').trim() : '';
  const effort = settings.thinkingEffort || 'fastest';
  return `${settings.protocol}:${settings.model}:${effort}:${lang.id}:${customLang}:${glossaryHash}`;
}

// ============================================================
// 4. Direct Browser-to-LLM SSE Streaming & NDJSON Parser
// ============================================================
function buildLanguageGuidance(lang) {
  if (lang.id === 'zh-TW') {
    return [
      '目標語言：繁體中文（台灣慣用語與台灣繁體字形）。',
      '用語規範：請使用自然道地的台灣用語（例如：資料、欄位、函式、參數、迴圈、模型、特徵、驗證集、過度擬合、管線、程式碼、執行、錯誤訊息），切勿混用簡體字或中國大陸慣用語。'
    ].join('\n');
  }
  if (lang.id === 'zh-CN') {
    return '目标语言：简体中文（自然流利的中国大陆表达与技术术语）。';
  }
  return `Target language: ${lang.promptName}. Translate accurately using natural, idiomatic phrasing in that language.`;
}

function buildStreamSystemPrompt(settings, title = '') {
  const lang = resolveTargetLanguage(settings);
  const glossary = String(settings.customGlossary || '').trim();
  const glossarySection = (glossary && (lang.id === 'zh-TW' || lang.id === 'zh-CN'))
    ? `\n參考術語表：\n${glossary}\n`
    : '';
  return [
    'Expert technical & academic translator for whitepapers, AI/ML papers, software documentation, and web articles.',
    title ? `Document topic: ${String(title).slice(0, 120)}` : '',
    buildLanguageGuidance(lang),
    'Rules:',
    '1. Keep code identifiers, math formulas, variables, URLs, and standard abbreviations (MAE, RMSE, AUC, LLM, API, Transformer) intact.',
    '2. Output STRICT NDJSON: exactly ONE JSON object per line in the format {"i":0,"t":"..."} matching every input index `i`, in order.',
    '3. NO markdown code fences (no ```), NO surrounding array [...], NO extra commentary.',
    glossarySection
  ].filter(Boolean).join('\n');
}

function extractNdjsonEntriesFromObject(obj) {
  const results = [];
  if (!obj || typeof obj !== 'object') return results;
  const pushEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const rawIdx = entry.i ?? entry.id ?? entry.index;
    const rawText = typeof entry.t === 'string'
      ? entry.t
      : typeof entry.zh === 'string'
        ? entry.zh
        : typeof entry.translation === 'string'
          ? entry.translation
          : null;
    if (rawIdx !== undefined && rawText !== null) {
      const idx = Number(rawIdx);
      if (Number.isInteger(idx) && idx >= 0 && rawText.trim()) {
        results.push({ idx, text: rawText.trim() });
      }
    }
  };
  if (Array.isArray(obj)) {
    for (const it of obj) pushEntry(it);
  } else if (Array.isArray(obj.translations)) {
    for (const it of obj.translations) pushEntry(it);
  } else {
    pushEntry(obj);
  }
  return results;
}

function parseNdjsonLine(rawLine) {
  let clean = String(rawLine || '').trim();
  if (!clean || clean.startsWith('```') || clean === '[' || clean === ']' || clean === '],') {
    return [];
  }
  if (clean.startsWith('[') && clean.includes('{')) clean = clean.slice(1).trim();
  if (clean.endsWith(',')) clean = clean.slice(0, -1).trim();
  if (clean.endsWith(']') && !clean.startsWith('[')) clean = clean.slice(0, -1).trim();
  if (!clean) return [];

  try {
    return extractNdjsonEntriesFromObject(JSON.parse(clean));
  } catch (_) {
    const results = [];
    let start = clean.indexOf('{');
    while (start !== -1) {
      let depth = 0;
      let inStr = false;
      let escaped = false;
      let end = -1;
      for (let i = start; i < clean.length; i++) {
        const ch = clean[i];
        if (inStr) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') {
          inStr = true;
        } else if (ch === '{') {
          depth += 1;
        } else if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end === -1) break;
      try {
        results.push(...extractNdjsonEntriesFromObject(JSON.parse(clean.slice(start, end + 1))));
      } catch (_) {}
      start = clean.indexOf('{', end + 1);
    }
    return results;
  }
}

function extractStreamTextDelta(protocol, chunkObj) {
  if (!chunkObj || typeof chunkObj !== 'object') return '';
  if (protocol === 'gemini') {
    const parts = chunkObj?.candidates?.[0]?.content?.parts || [];
    let out = '';
    for (const part of parts) {
      if (part && !part.thought && typeof part.text === 'string') {
        out += part.text;
      }
    }
    return out;
  }
  const choice = chunkObj?.choices?.[0];
  if (!choice) return '';
  if (typeof choice?.delta?.content === 'string') return choice.delta.content;
  if (typeof choice?.message?.content === 'string') return choice.message.content;
  return '';
}

function buildGeminiRequestBody(settings, messages) {
  const systemMsg = messages.find((m) => m.role === 'system');
  const userMsgs = messages.filter((m) => m.role !== 'system');
  const normModel = String(settings.model || '').replace(/^models\//i, '').trim().toLowerCase();
  const isGemini3Or4 = /^gemini-(?:3|4)(?:[.\-]|$)/.test(normModel);

  const generationConfig = {};
  if (!isGemini3Or4) {
    generationConfig.temperature = Number(settings.temperature ?? 0.2);
  }
  const thinkingConfig = resolveThinkingConfig(settings.model, settings.thinkingEffort || 'fastest');
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }

  const body = {
    contents: userMsgs.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    })),
    generationConfig
  };
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }
  return body;
}

function buildOpenAIRequestBody(settings, endpoint, messages, stream = true) {
  const model = String(settings.model || '').trim();
  const isReasoning = /^o[134](?:-|$)|deepseek-reasoner|^r1\b/i.test(model);
  const body = {
    model,
    messages,
    stream: Boolean(stream)
  };
  if (!isReasoning) {
    body.temperature = Number(settings.temperature ?? 0.2);
  }
  if ((settings.thinkingEffort || 'fastest') === 'fastest' && /^qwen3/i.test(model) && /dashscope/i.test(endpoint)) {
    body.enable_thinking = false;
  }
  return body;
}

async function streamTranslateBatchWithCache(settings, items, docTitle, onItem, signal) {
  if (!items || items.length === 0) return;

  const cleanKey = sanitizeApiKey(settings.apiKey);
  if (!cleanKey && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(settings.baseUrl || '')) {
    const err = new Error('請先在「⚙ 模型與 API 設定」填入 API Key（或從電腦端掃描 QR Code 同步）');
    err.errorCode = 'NO_API_KEY';
    throw err;
  }

  const sig = buildCacheSignature(settings);
  const cacheKeys = items.map((it) => `${sig}::${it.key}`);
  const cachedHits = await cacheGetMany(cacheKeys);

  const uncachedItems = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const hit = cachedHits.get(cacheKeys[i]);
    if (hit) {
      onItem(item.key, hit, true);
    } else {
      uncachedItems.push(item);
    }
  }

  if (uncachedItems.length === 0) return;

  const endpoint = resolveStreamEndpoint(settings);
  const payload = uncachedItems.map((it, idx) => ({ i: idx, text: it.text }));
  const messages = [
    { role: 'system', content: buildStreamSystemPrompt(settings, docTitle) },
    { role: 'user', content: JSON.stringify(payload) }
  ];

  const headers = { 'Content-Type': 'application/json' };
  let bodyObj;
  if (settings.protocol === 'gemini') {
    if (cleanKey) headers['x-goog-api-key'] = cleanKey;
    bodyObj = buildGeminiRequestBody(settings, messages);
  } else {
    if (cleanKey) headers['Authorization'] = `Bearer ${cleanKey}`;
    bodyObj = buildOpenAIRequestBody(settings, endpoint, messages, true);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyObj),
    signal
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200) || response.statusText}`);
  }

  const emittedIndices = new Set();
  const toCache = [];

  const handleDecodedLine = (line) => {
    const entries = parseNdjsonLine(line);
    for (const entry of entries) {
      if (entry.idx >= 0 && entry.idx < uncachedItems.length && !emittedIndices.has(entry.idx)) {
        emittedIndices.add(entry.idx);
        const item = uncachedItems[entry.idx];
        onItem(item.key, entry.text, false);
        toCache.push({ key: `${sig}::${item.key}`, zh: entry.text });
      }
    }
  };

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!response.body || (contentType.includes('application/json') && !contentType.includes('event-stream'))) {
    const data = await response.json();
    const fullText = Array.isArray(data)
      ? data.map((c) => extractStreamTextDelta(settings.protocol, c)).join('')
      : extractStreamTextDelta(settings.protocol, data);
    for (const line of String(fullText || '').split('\n')) {
      handleDecodedLine(line);
    }
    if (toCache.length > 0) await cachePutMany(toCache);
    updateCacheCountUI();
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  let ndjsonBuffer = '';

  const processSseLine = (rawSseLine) => {
    const line = rawSseLine.trim();
    if (!line.startsWith('data:')) return;
    const dataStr = line.slice(5).trim();
    if (!dataStr || dataStr === '[DONE]') return;
    try {
      const chunkObj = JSON.parse(dataStr);
      const delta = extractStreamTextDelta(settings.protocol, chunkObj);
      if (delta) {
        ndjsonBuffer += delta;
        let nlIdx;
        while ((nlIdx = ndjsonBuffer.indexOf('\n')) !== -1) {
          const completeLine = ndjsonBuffer.slice(0, nlIdx);
          ndjsonBuffer = ndjsonBuffer.slice(nlIdx + 1);
          handleDecodedLine(completeLine);
        }
      }
    } catch (_) {}
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = sseBuffer.indexOf('\n')) !== -1) {
      const sseLine = sseBuffer.slice(0, nl);
      sseBuffer = sseBuffer.slice(nl + 1);
      processSseLine(sseLine);
    }
  }
  if (sseBuffer.trim()) processSseLine(sseBuffer);
  if (ndjsonBuffer.trim()) handleDecodedLine(ndjsonBuffer);

  if (toCache.length > 0) {
    await cachePutMany(toCache);
    updateCacheCountUI();
  }
}

// ============================================================
// 5. DOM References & App State
// ============================================================
const dom = {
  syncBanner: document.getElementById('syncBanner'),
  syncBannerText: document.getElementById('syncBannerText'),
  syncBannerClose: document.getElementById('syncBannerClose'),

  globalStatusBadge: document.getElementById('globalStatusBadge'),
  globalStatusText: document.getElementById('globalStatusText'),
  globalLangSelect: document.getElementById('globalLangSelect'),

  tabPanels: {
    pdf: document.getElementById('tab-pdf'),
    web: document.getElementById('tab-web'),
    install: document.getElementById('tab-install'),
    settings: document.getElementById('tab-settings')
  },
  navButtons: Array.from(document.querySelectorAll('.nr-nav-tab')),

  // PDF Tab
  pdfModeSegmented: document.getElementById('pdfModeSegmented'),
  pdfPageIndicator: document.getElementById('pdfPageIndicator'),
  pdfZoomOutBtn: document.getElementById('pdfZoomOutBtn'),
  pdfZoomResetBtn: document.getElementById('pdfZoomResetBtn'),
  pdfZoomInBtn: document.getElementById('pdfZoomInBtn'),
  pdfOpenFileTopBtn: document.getElementById('pdfOpenFileTopBtn'),
  pdfFileInput: document.getElementById('pdfFileInput'),
  pdfEmptyState: document.getElementById('pdfEmptyState'),
  pdfEmptyOpenBtn: document.getElementById('pdfEmptyOpenBtn'),
  pdfUrlForm: document.getElementById('pdfUrlForm'),
  pdfUrlInput: document.getElementById('pdfUrlInput'),
  pdfLoadingState: document.getElementById('pdfLoadingState'),
  pdfLoadingTitle: document.getElementById('pdfLoadingTitle'),
  pdfLoadingSub: document.getElementById('pdfLoadingSub'),
  pdfErrorState: document.getElementById('pdfErrorState'),
  pdfErrorTitle: document.getElementById('pdfErrorTitle'),
  pdfErrorDetail: document.getElementById('pdfErrorDetail'),
  pdfRetryUrlBtn: document.getElementById('pdfRetryUrlBtn'),
  pdfErrorOpenFileBtn: document.getElementById('pdfErrorOpenFileBtn'),
  pdfPagesContainer: document.getElementById('pdfPagesContainer'),

  // Web Tab
  webModeSegmented: document.getElementById('webModeSegmented'),
  webFontSegmented: document.getElementById('webFontSegmented'),
  webUrlForm: document.getElementById('webUrlForm'),
  webUrlInput: document.getElementById('webUrlInput'),
  webRawInput: document.getElementById('webRawInput'),
  webClearRawBtn: document.getElementById('webClearRawBtn'),
  webTranslateRawBtn: document.getElementById('webTranslateRawBtn'),
  webArticleCard: document.getElementById('webArticleCard'),
  webArticleSource: document.getElementById('webArticleSource'),
  webArticleProgress: document.getElementById('webArticleProgress'),
  webArticleTitle: document.getElementById('webArticleTitle'),
  webArticleBody: document.getElementById('webArticleBody'),

  // Install Tab
  bookmarkletCodeBox: document.getElementById('bookmarkletCodeBox'),
  copyBookmarkletBtn: document.getElementById('copyBookmarkletBtn'),

  // Settings Tab
  settingsForm: document.getElementById('settingsForm'),
  setProvider: document.getElementById('setProvider'),
  setProviderHint: document.getElementById('setProviderHint'),
  setApiKey: document.getElementById('setApiKey'),
  toggleApiKeyVisBtn: document.getElementById('toggleApiKeyVisBtn'),
  setModel: document.getElementById('setModel'),
  modelChipsRow: document.getElementById('modelChipsRow'),
  setBaseUrl: document.getElementById('setBaseUrl'),
  setTargetLang: document.getElementById('setTargetLang'),
  customLangField: document.getElementById('customLangField'),
  setCustomTargetLang: document.getElementById('setCustomTargetLang'),
  setThinkingEffort: document.getElementById('setThinkingEffort'),
  setTypographyMatch: document.getElementById('setTypographyMatch'),
  setGlossary: document.getElementById('setGlossary'),
  testApiBtn: document.getElementById('testApiBtn'),
  clearCacheBtn: document.getElementById('clearCacheBtn'),
  cacheCountLabel: document.getElementById('cacheCountLabel'),
  settingsTestResult: document.getElementById('settingsTestResult'),

  // Compare Sheet
  comparePopover: document.getElementById('comparePopover'),
  compareOrigText: document.getElementById('compareOrigText'),
  compareTransText: document.getElementById('compareTransText'),
  copyOrigBtn: document.getElementById('copyOrigBtn'),
  copyTransBtn: document.getElementById('copyTransBtn'),
  compareCloseBtn: document.getElementById('compareCloseBtn')
};

const state = {
  settings: loadSettings(),
  activeTab: 'pdf',
  pdfMode: 'overlay',
  zoom: 1.0,
  baseFitScale: 1.0,
  docLoadToken: 0,
  translationEpoch: 0,

  pdfDoc: null,
  numPages: 0,
  currentPage: 1,
  docTitle: '',
  sourceUrl: '',
  defaultPageWidth: 612,
  defaultPageHeight: 792,

  pages: new Map(),
  translations: new Map(),
  cachedKeys: new Set(),
  lastError: '',
  lastErrorCode: '',

  renderObserver: null,
  pageTrackObserver: null,
  activeAbortControllers: new Set(),

  activeCompareAnchor: null,
  activeComparePara: null,

  webAbortController: null
};

// ============================================================
// 6. Navigation, Banner & Global Status UI
// ============================================================
function showSyncBanner(message) {
  dom.syncBannerText.textContent = message;
  dom.syncBanner.hidden = false;
}

function switchTab(tabId) {
  if (!dom.tabPanels[tabId]) return;
  state.activeTab = tabId;
  for (const [id, panel] of Object.entries(dom.tabPanels)) {
    const active = id === tabId;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  }
  for (const btn of dom.navButtons) {
    btn.classList.toggle('is-active', btn.dataset.tab === tabId);
  }
  closeComparePopover();
}

function setGlobalStatus(statusState, text) {
  dom.globalStatusBadge.dataset.state = statusState;
  dom.globalStatusText.textContent = text;
  dom.globalStatusText.title = text;
}

function applyRootLanguageFonts(settings) {
  const lang = resolveTargetLanguage(settings);
  document.documentElement.style.setProperty('--nr-font-serif', lang.serifFontStack);
  document.documentElement.style.setProperty('--nr-font-sans', lang.sansFontStack);
  document.documentElement.style.setProperty('--nr-font-mono', lang.monoFontStack);
}

function populateLanguageDropdowns() {
  const currentLang = state.settings.targetLang || 'zh-TW';
  for (const selectEl of [dom.globalLangSelect, dom.setTargetLang]) {
    selectEl.replaceChildren();
    for (const [id, info] of Object.entries(TARGET_LANGUAGES)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id === 'custom' && state.settings.customTargetLang
        ? `自訂 (${state.settings.customTargetLang})`
        : info.label;
      selectEl.appendChild(opt);
    }
    selectEl.value = TARGET_LANGUAGES[currentLang] ? currentLang : 'zh-TW';
  }
}

// ============================================================
// 7. PDF Reader & Geometric Paragraph Engine (Tab 1)
// ============================================================
function showPdfStage(stage) {
  dom.pdfEmptyState.hidden = stage !== 'empty';
  dom.pdfLoadingState.hidden = stage !== 'loading';
  dom.pdfErrorState.hidden = stage !== 'error';
  dom.pdfPagesContainer.hidden = stage !== 'pages';
}

function updatePdfStatusBadge() {
  if (state.lastError) {
    setGlobalStatus('error', state.lastError);
    return;
  }
  if (!state.pdfDoc) {
    setGlobalStatus('idle', '就緒');
    return;
  }
  let total = 0;
  let translated = 0;
  let active = 0;
  for (const pageRec of state.pages.values()) {
    if (pageRec.translationInFlight) active += 1;
    for (const para of pageRec.translatableParagraphs || []) {
      total += 1;
      if (state.translations.has(para.key)) translated += 1;
    }
  }
  if (active > 0) {
    setGlobalStatus('streaming', total > 0 ? `翻譯中 ${translated}/${total}` : '串流翻譯中...');
  } else if (translated > 0) {
    setGlobalStatus('done', `已譯 ${translated} 段`);
  } else {
    setGlobalStatus('idle', `共 ${state.numPages} 頁`);
  }
}

function setPdfMode(nextMode) {
  if (!['overlay', 'split', 'original'].includes(nextMode)) return;
  state.pdfMode = nextMode;
  dom.tabPanels.pdf.dataset.mode = nextMode;
  closeComparePopover();

  for (const btn of dom.pdfModeSegmented.querySelectorAll('.nr-seg-btn')) {
    const active = btn.dataset.mode === nextMode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  }

  if (nextMode === 'overlay') {
    requestAnimationFrame(() => {
      for (const pageRec of state.pages.values()) {
        if (!pageRec.needsOverlayRefit || !pageRec.viewport) continue;
        pageRec.needsOverlayRefit = false;
        for (const para of pageRec.translatableParagraphs || []) {
          const el = pageRec.overlayById.get(para.id);
          if (!el) continue;
          const padX = 2.5;
          const padY = 1.5;
          const left = Math.max(0, para.x - padX);
          const width = Math.min(pageRec.viewport.width - left, para.w + padX * 2);
          const minHeight = para.h + padY * 2;
          const maxHeight = Math.max(minHeight, para.maxAllowedHeight + padY);
          fitOverlayTypography(el, para, maxHeight, width);
        }
      }
    });
  }
}

function shouldTranslatePdfText(text, targetLangId, meta = {}) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 4) return false;
  if (/^(?:https?:\/\/|www\.|mailto:|ftp:\/\/)\S+$/i.test(clean)) return false;
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(clean)) return false;
  if (/^(?:doi:|arxiv:)\S+$/i.test(clean)) return false;
  if (/^[\d\s.,:%+\-–—/()[\]$€£¥°×]+$/.test(clean)) return false;
  if (/^(?:page|p\.?|pp\.?)\s*\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(clean)) return false;
  if (/^\d+\s*\/\s*\d+$/.test(clean)) return false;

  const letters = clean.match(/\p{L}/gu) || [];
  if (letters.length < 2) return false;

  if (meta.isMono && /[=(){}[\];<>]|^\s*(?:def|class|import|from|return|const|let|var|for|while|if)\b/.test(clean)) {
    return false;
  }

  const words = clean.match(/[a-zA-Z\p{L}]{2,}/gu) || [];
  const mathSymbols = (clean.match(/[=≈≠≤≥<>±×÷∑∏∫√∞∂∇∈∉⊂⊃∪∩∀∃^_{}\\|]/g) || []).length;
  if (mathSymbols >= 3 && mathSymbols / clean.length > 0.16 && words.length < 6) {
    return false;
  }

  if (
    !meta.isHeading &&
    meta.lineCount === 1 &&
    meta.widthRatio !== undefined &&
    meta.widthRatio < 0.14 &&
    words.length <= 2 &&
    clean.length < 16
  ) {
    return false;
  }

  const letterTotal = letters.length;
  const hanCount = (clean.match(/\p{Script=Han}/gu) || []).length;
  const kanaCount = (clean.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
  const hangulCount = (clean.match(/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/g) || []).length;
  const target = String(targetLangId || 'zh-TW');

  if (target === 'zh-TW' || target === 'zh-CN') {
    if (kanaCount / letterTotal >= 0.12) return true;
    if (hanCount / letterTotal >= 0.55) {
      const latinWords = clean.match(/[a-zA-Z]{2,}/g) || [];
      if (latinWords.length < 6) return false;
    }
  } else if (target === 'ja') {
    if ((kanaCount + hanCount) / letterTotal >= 0.55 && kanaCount >= 2) return false;
  } else if (target === 'ko') {
    if (hangulCount / letterTotal >= 0.5) return false;
  }

  return true;
}

function detectFontMeta(fontName, styles) {
  const style = styles?.[fontName] || null;
  const combined = `${style?.fontFamily || ''} ${fontName || ''}`;
  const isMono = MONO_FONT_REGEX.test(combined);
  const isSerif = !isMono && SERIF_FONT_REGEX.test(combined) && !SANS_FONT_REGEX.test(combined);
  const isBold = BOLD_FONT_REGEX.test(combined);
  return { isSerif, isMono, isBold };
}

function joinLineSpans(spans) {
  let out = '';
  let prev = null;
  for (const sp of spans) {
    const str = sp.str;
    if (!str) continue;
    if (!prev) {
      out = str;
    } else {
      const gap = sp.x - prev.right;
      const avgFs = (sp.fontSize + prev.fontSize) * 0.5;
      const prevEndsSpace = /\s$/.test(out);
      const currStartsSpace = /^\s/.test(str);
      const prevLastChar = out.trimEnd().slice(-1);
      const currFirstChar = str.trimStart().slice(0, 1);
      const bothCjk = /[\p{Script=Han}\u3040-\u30ff]/u.test(prevLastChar) &&
        /[\p{Script=Han}\u3040-\u30ff]/u.test(currFirstChar);

      if (prevEndsSpace || currStartsSpace) {
        out = `${out.trimEnd()} ${str.trimStart()}`;
      } else if (!bothCjk && gap > avgFs * 0.16) {
        out = `${out} ${str}`;
      } else {
        out += str;
      }
    }
    prev = sp;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function joinParagraphLines(lines) {
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const seg = lines[i].text.trim();
    if (!seg) continue;
    if (!out) {
      out = seg;
      continue;
    }
    if (/[a-zA-Z]-$/.test(out) && /^[a-z]/.test(seg)) {
      out = out.slice(0, -1) + seg;
    } else {
      const prevLast = out.slice(-1);
      const nextFirst = seg.slice(0, 1);
      const bothCjk = /[\p{Script=Han}\u3040-\u30ff]/u.test(prevLast) &&
        /[\p{Script=Han}\u3040-\u30ff]/u.test(nextFirst);
      out = bothCjk ? out + seg : `${out} ${seg}`;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

function computeMedianFontSize(paragraphs) {
  const weighted = paragraphs
    .filter((p) => p.text.length >= 20)
    .map((p) => ({ fs: p.fontSize, weight: p.text.length }));
  const source = weighted.length > 0
    ? weighted
    : paragraphs.map((p) => ({ fs: p.fontSize, weight: Math.max(1, p.text.length) }));
  if (source.length === 0) return 12;
  source.sort((a, b) => a.fs - b.fs);
  const totalWeight = source.reduce((acc, s) => acc + s.weight, 0);
  let acc = 0;
  for (const s of source) {
    acc += s.weight;
    if (acc >= totalWeight * 0.5) return s.fs;
  }
  return source[Math.floor(source.length / 2)].fs;
}

function orderParagraphsReadingOrder(paragraphs, pageWidth) {
  if (paragraphs.length <= 1) return paragraphs;
  const midX = pageWidth * 0.5;
  const margin = Math.max(14, pageWidth * 0.03);
  const byTop = [...paragraphs].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const bands = [];
  let currentBand = [];
  const isSpanning = (p) => p.x < midX - margin && p.right > midX + margin && p.w > pageWidth * 0.52;

  for (const p of byTop) {
    if (isSpanning(p)) {
      if (currentBand.length > 0) {
        bands.push({ spanning: false, items: currentBand });
        currentBand = [];
      }
      bands.push({ spanning: true, items: [p] });
    } else {
      currentBand.push(p);
    }
  }
  if (currentBand.length > 0) bands.push({ spanning: false, items: currentBand });

  const ordered = [];
  for (const band of bands) {
    if (band.spanning || band.items.length <= 1) {
      ordered.push(...band.items);
      continue;
    }
    const leftCol = [];
    const rightCol = [];
    const other = [];
    for (const p of band.items) {
      if (p.right <= midX + margin) leftCol.push(p);
      else if (p.x >= midX - margin) rightCol.push(p);
      else other.push(p);
    }
    if (leftCol.length > 0 && rightCol.length > 0 && other.length === 0) {
      leftCol.sort((a, b) => a.y - b.y);
      rightCol.sort((a, b) => a.y - b.y);
      ordered.push(...leftCol, ...rightCol);
    } else {
      band.items.sort((a, b) => (a.y - b.y) || (a.x - b.x));
      ordered.push(...band.items);
    }
  }
  return ordered;
}

function extractPdfParagraphs(textContent, viewport) {
  const rawItems = textContent?.items || [];
  const styles = textContent?.styles || {};
  if (rawItems.length === 0) return [];

  const spans = [];
  for (const item of rawItems) {
    if (!item || typeof item.str !== 'string') continue;
    const trimmed = item.str.trim();
    if (!trimmed) continue;
    if (!Array.isArray(item.transform) || item.transform.length < 6) continue;

    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const angle = Math.atan2(tx[1], tx[0]);
    if (Math.abs(angle) > 0.25) continue;

    const fontSize = Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]) || (item.height * viewport.scale) || 12;
    if (!Number.isFinite(fontSize) || fontSize < 4.5 * viewport.scale) continue;

    const x = tx[4];
    const baselineY = tx[5];
    let w = (item.width || 0) * viewport.scale;
    if (!Number.isFinite(w) || w <= 0) {
      w = trimmed.length * fontSize * 0.52;
    }
    const h = Math.max(fontSize * 1.14, (item.height || 0) * viewport.scale);
    const top = baselineY - fontSize * 0.88;
    const bottom = baselineY + fontSize * 0.24;

    if (x + w < 0 || x > viewport.width || bottom < 0 || top > viewport.height) continue;

    const fontMeta = detectFontMeta(item.fontName, styles);
    spans.push({
      str: item.str,
      charLen: trimmed.length,
      x,
      right: x + w,
      w,
      top,
      bottom,
      h,
      baselineY,
      fontSize,
      ...fontMeta
    });
  }

  if (spans.length === 0) return [];

  spans.sort((a, b) => (a.baselineY - b.baselineY) || (a.x - b.x));
  const rows = [];
  for (const sp of spans) {
    let matchedRow = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      const tol = 0.45 * Math.min(row.avgFontSize, sp.fontSize);
      if (Math.abs(sp.baselineY - row.baselineY) <= tol) {
        matchedRow = row;
        break;
      }
      if (sp.baselineY - row.baselineY > Math.max(row.avgFontSize, sp.fontSize) * 1.2) break;
    }
    if (matchedRow) {
      const prevW = matchedRow.weight;
      const nextW = prevW + sp.charLen;
      matchedRow.baselineY = (matchedRow.baselineY * prevW + sp.baselineY * sp.charLen) / nextW;
      matchedRow.avgFontSize = (matchedRow.avgFontSize * prevW + sp.fontSize * sp.charLen) / nextW;
      matchedRow.weight = nextW;
      matchedRow.spans.push(sp);
    } else {
      rows.push({
        baselineY: sp.baselineY,
        avgFontSize: sp.fontSize,
        weight: sp.charLen,
        spans: [sp]
      });
    }
  }

  const lines = [];
  for (const row of rows) {
    row.spans.sort((a, b) => a.x - b.x);
    let segSpans = [row.spans[0]];

    const flushSegment = (group) => {
      const text = joinLineSpans(group);
      if (!text) return;
      let minX = Infinity;
      let maxRight = -Infinity;
      let minTop = Infinity;
      let maxBottom = -Infinity;
      let totalWeight = 0;
      let fsSum = 0;
      let baselineSum = 0;
      let serifWeight = 0;
      let boldWeight = 0;
      let monoWeight = 0;

      for (const s of group) {
        if (s.x < minX) minX = s.x;
        if (s.right > maxRight) maxRight = s.right;
        if (s.top < minTop) minTop = s.top;
        if (s.bottom > maxBottom) maxBottom = s.bottom;
        totalWeight += s.charLen;
        fsSum += s.fontSize * s.charLen;
        baselineSum += s.baselineY * s.charLen;
        if (s.isSerif) serifWeight += s.charLen;
        if (s.isBold) boldWeight += s.charLen;
        if (s.isMono) monoWeight += s.charLen;
      }

      lines.push({
        text,
        x: minX,
        right: maxRight,
        w: Math.max(1, maxRight - minX),
        top: minTop,
        bottom: maxBottom,
        h: Math.max(1, maxBottom - minTop),
        baselineY: baselineSum / totalWeight,
        fontSize: fsSum / totalWeight,
        weight: totalWeight,
        isSerif: serifWeight > totalWeight * 0.5,
        isBold: boldWeight > totalWeight * 0.5,
        isMono: monoWeight > totalWeight * 0.6
      });
    };

    for (let i = 1; i < row.spans.length; i++) {
      const prev = segSpans[segSpans.length - 1];
      const curr = row.spans[i];
      const gap = curr.x - prev.right;
      const maxFs = Math.max(prev.fontSize, curr.fontSize);
      const fsRatioDiff = Math.abs(prev.fontSize - curr.fontSize) / maxFs;
      const shouldSplit =
        gap > 1.5 * maxFs ||
        (gap > 1.15 * maxFs && fsRatioDiff > 0.25);

      if (shouldSplit) {
        flushSegment(segSpans);
        segSpans = [curr];
      } else {
        segSpans.push(curr);
      }
    }
    flushSegment(segSpans);
  }

  lines.sort((a, b) => (a.top - b.top) || (a.x - b.x));
  const rawParagraphs = [];

  for (const line of lines) {
    let bestPara = null;
    let bestGap = Infinity;

    for (let i = rawParagraphs.length - 1; i >= 0; i--) {
      const p = rawParagraphs[i];
      const avgFs = (p.fontSize + line.fontSize) * 0.5;
      const vGap = line.top - p.bottom;
      if (vGap > 1.65 * avgFs || vGap < -0.55 * avgFs) continue;
      if (line.baselineY - p.lastBaselineY < 0.45 * avgFs) continue;

      const fsDiff = Math.abs(line.fontSize - p.fontSize) / Math.max(line.fontSize, p.fontSize);
      if (fsDiff > 0.20) continue;

      const overlap = Math.min(line.right, p.right) - Math.max(line.x, p.x);
      const minW = Math.min(line.w, p.w);
      const leftDiff = Math.abs(line.x - p.x);
      const centerDiff = Math.abs((line.x + line.right) * 0.5 - (p.x + p.right) * 0.5);
      const sameColumn =
        (overlap > 0 && (overlap >= 0.22 * minW || leftDiff <= 2.4 * avgFs)) ||
        centerDiff <= 2.2 * avgFs;
      if (!sameColumn) continue;

      const widthRatio = Math.max(line.w, p.w) / Math.max(1, minW);
      if (widthRatio > 2.2 && leftDiff > 4.0 * avgFs && centerDiff > 2.5 * avgFs) continue;
      if (BULLET_PREFIX_REGEX.test(line.text)) continue;
      if (p.isMono !== line.isMono) continue;
      if (p.isBold !== line.isBold && p.lines.length === 1 && p.w < viewport.width * 0.65) continue;

      const lastLine = p.lines[p.lines.length - 1];
      if (line.x - p.x > 1.25 * avgFs && lastLine.right < p.right - 1.8 * avgFs) continue;
      if (
        p.lines.length >= 2 &&
        lastLine.w < p.w * 0.72 &&
        /[.?!。？！:]$/.test(lastLine.text) &&
        vGap > 0.35 * avgFs
      ) {
        continue;
      }

      let blocked = false;
      for (let j = i + 1; j < rawParagraphs.length; j++) {
        const other = rawParagraphs[j];
        const xOver = Math.min(other.right, Math.max(line.right, p.right)) - Math.max(other.x, Math.min(line.x, p.x));
        if (xOver > avgFs && other.y >= p.bottom - 2 && other.bottom <= line.top + 2) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      if (vGap < bestGap) {
        bestGap = vGap;
        bestPara = p;
      }
    }

    if (bestPara) {
      bestPara.lines.push(line);
      bestPara.x = Math.min(bestPara.x, line.x);
      bestPara.right = Math.max(bestPara.right, line.right);
      bestPara.w = bestPara.right - bestPara.x;
      bestPara.y = Math.min(bestPara.y, line.top);
      bestPara.bottom = Math.max(bestPara.bottom, line.bottom);
      bestPara.h = bestPara.bottom - bestPara.y;
      bestPara.lastBaselineY = line.baselineY;

      const nextW = bestPara.weight + line.weight;
      bestPara.fontSize = (bestPara.fontSize * bestPara.weight + line.fontSize * line.weight) / nextW;
      bestPara.serifWeight += line.isSerif ? line.weight : 0;
      bestPara.boldWeight += line.isBold ? line.weight : 0;
      bestPara.monoWeight += line.isMono ? line.weight : 0;
      bestPara.weight = nextW;
      bestPara.isSerif = bestPara.serifWeight > nextW * 0.5;
      bestPara.isBold = bestPara.boldWeight > nextW * 0.5;
      bestPara.isMono = bestPara.monoWeight > nextW * 0.6;
    } else {
      rawParagraphs.push({
        lines: [line],
        x: line.x,
        right: line.right,
        w: line.w,
        y: line.top,
        bottom: line.bottom,
        h: line.h,
        lastBaselineY: line.baselineY,
        fontSize: line.fontSize,
        weight: line.weight,
        serifWeight: line.isSerif ? line.weight : 0,
        boldWeight: line.isBold ? line.weight : 0,
        monoWeight: line.isMono ? line.weight : 0,
        isSerif: line.isSerif,
        isBold: line.isBold,
        isMono: line.isMono
      });
    }
  }

  const finalized = rawParagraphs.map((p) => {
    const text = joinParagraphLines(p.lines);
    let avgLineHeightRatio = 1.32;
    if (p.lines.length >= 2) {
      let deltaSum = 0;
      for (let i = 1; i < p.lines.length; i++) {
        deltaSum += Math.max(p.fontSize, p.lines[i].baselineY - p.lines[i - 1].baselineY);
      }
      avgLineHeightRatio = (deltaSum / (p.lines.length - 1)) / Math.max(1, p.fontSize);
      avgLineHeightRatio = Math.max(1.18, Math.min(1.55, avgLineHeightRatio));
    }
    return {
      text,
      key: hashText(text),
      x: p.x,
      y: p.y,
      right: p.right,
      bottom: p.bottom,
      w: p.w,
      h: p.h,
      fontSize: p.fontSize,
      avgLineHeightRatio,
      lineCount: p.lines.length,
      isSerif: p.isSerif,
      isBold: p.isBold,
      isMono: p.isMono,
      isHeading: false,
      maxAllowedHeight: p.h + 4
    };
  });

  const medianFs = computeMedianFontSize(finalized);
  const ordered = orderParagraphsReadingOrder(finalized, viewport.width);

  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i];
    p.isHeading =
      (p.fontSize >= 1.22 * medianFs && p.lineCount <= 3 && p.text.length <= 220) ||
      (p.isBold && p.fontSize >= 1.08 * medianFs && p.lineCount <= 2 && p.text.length <= 120 && !/[.,;]$/.test(p.text));

    let nearestBelowY = viewport.height - 6;
    for (let j = 0; j < ordered.length; j++) {
      if (i === j) continue;
      const other = ordered[j];
      if (other.y < p.bottom - 2) continue;
      const xOverlap = Math.min(p.right, other.right) - Math.max(p.x, other.x);
      if (xOverlap > 4 && other.y < nearestBelowY) {
        nearestBelowY = other.y;
      }
    }
    const availableGap = Math.max(0, nearestBelowY - p.bottom);
    const extraAllowance = Math.min(availableGap * 0.72, Math.max(4, p.fontSize * 0.85));
    p.maxAllowedHeight = p.h + 3 + extraAllowance;
  }

  return ordered;
}

// Single ctx.getImageData per page perimeter color sampling
function computeLuminance(r, g, b) {
  const srgb = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(lumA, lumB) {
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function medianValue(arr) {
  if (!arr.length) return 255;
  const sorted = arr.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function sampleParagraphColors(pageImageData, para, cssWidth, cssHeight, canvasWidth, canvasHeight) {
  if (!pageImageData || !pageImageData.data) {
    return { bg: '#ffffff', fg: '#111827', isDarkBg: false };
  }
  const data = pageImageData.data;
  const scaleX = canvasWidth / Math.max(1, cssWidth);
  const scaleY = canvasHeight / Math.max(1, cssHeight);
  const clampX = (px) => Math.max(0, Math.min(canvasWidth - 1, Math.round(px)));
  const clampY = (py) => Math.max(0, Math.min(canvasHeight - 1, Math.round(py)));

  const leftPx = para.x * scaleX;
  const rightPx = para.right * scaleX;
  const topPx = para.y * scaleY;
  const bottomPx = para.bottom * scaleY;
  const pad = Math.max(2, Math.round(2.5 * scaleX));

  const points = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const px = leftPx + (rightPx - leftPx) * t;
    points.push([clampX(px), clampY(topPx - pad)]);
    points.push([clampX(px), clampY(bottomPx + pad)]);
  }
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    const py = topPx + (bottomPx - topPx) * t;
    points.push([clampX(leftPx - pad), clampY(py)]);
    points.push([clampX(rightPx + pad), clampY(py)]);
  }

  const rs = [];
  const gs = [];
  const bs = [];
  for (const [px, py] of points) {
    const offset = (py * canvasWidth + px) * 4;
    if (data[offset + 3] < 20) continue;
    rs.push(data[offset]);
    gs.push(data[offset + 1]);
    bs.push(data[offset + 2]);
  }
  if (rs.length === 0) return { bg: '#ffffff', fg: '#111827', isDarkBg: false };

  const r = medianValue(rs);
  const g = medianValue(gs);
  const b = medianValue(bs);
  const bgLum = computeLuminance(r, g, b);
  const isDarkBg = contrastRatio(bgLum, computeLuminance(248, 250, 252)) > contrastRatio(bgLum, computeLuminance(17, 24, 39));
  return {
    bg: `rgb(${r}, ${g}, ${b})`,
    fg: isDarkBg ? '#f8fafc' : '#111827',
    isDarkBg
  };
}

function fitOverlayTypography(el, para, maxHeight, boxWidth) {
  const startScale = para.isHeading ? 0.96 : 0.94;
  const minFs = Math.max(7.5, para.fontSize * 0.58);
  let fs = Math.max(minFs, para.fontSize * startScale);
  let lh = para.lineCount === 1 ? 1.24 : Math.max(1.22, Math.min(1.46, para.avgLineHeightRatio));

  el.style.fontSize = `${fs.toFixed(2)}px`;
  el.style.lineHeight = lh.toFixed(2);
  el.style.maxHeight = '';
  el.classList.remove('is-clipped');

  const fits = () => el.scrollHeight <= maxHeight + 1 && el.scrollWidth <= boxWidth + 2;
  let guard = 0;
  while (!fits() && fs > minFs + 0.15 && guard < 18) {
    fs = Math.max(minFs, fs * 0.92);
    if (lh > 1.18) lh = Math.max(1.18, lh - 0.03);
    el.style.fontSize = `${fs.toFixed(2)}px`;
    el.style.lineHeight = lh.toFixed(2);
    guard += 1;
  }
  if (el.scrollHeight > maxHeight + 2) {
    el.style.maxHeight = `${Math.ceil(maxHeight)}px`;
    el.classList.add('is-clipped');
  }
}

function renderParagraphOverlay(pageRec, para, zh) {
  if (!pageRec.overlayLayer || !pageRec.viewport) return;
  const langInfo = resolveTargetLanguage(state.settings);
  const padX = 2.0;
  const padY = 1.2;
  const left = Math.max(0, para.x - padX);
  const top = Math.max(0, para.y - padY);
  const width = Math.min(pageRec.viewport.width - left, para.w + padX * 2);
  const minHeight = para.h + padY * 2;
  const maxHeight = Math.max(minHeight, para.maxAllowedHeight + padY);

  let el = pageRec.overlayById.get(para.id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'nr-pdf-para';
    el.dataset.paraId = String(para.id);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleComparePopover(el, para, state.translations.get(para.key) || zh);
    });
    pageRec.overlayLayer.appendChild(el);
    pageRec.overlayById.set(para.id, el);
  }

  const colors = para.colors || { bg: '#ffffff', fg: '#111827', isDarkBg: false };
  el.textContent = zh;
  el.style.left = `${left.toFixed(1)}px`;
  el.style.top = `${top.toFixed(1)}px`;
  el.style.width = `${width.toFixed(1)}px`;
  el.style.minHeight = `${minHeight.toFixed(1)}px`;
  el.style.backgroundColor = colors.bg;
  el.style.color = colors.fg;
  el.style.fontFamily = para.isSerif ? langInfo.serifFontStack : langInfo.sansFontStack;
  el.style.fontWeight = (para.isBold || para.isHeading) ? '700' : '400';

  if (state.pdfMode !== 'overlay') {
    pageRec.needsOverlayRefit = true;
  } else {
    fitOverlayTypography(el, para, maxHeight, width);
  }
}

function buildSplitCardSkeleton(pageRec) {
  const body = pageRec.splitBody;
  if (!body) return;
  body.replaceChildren();
  pageRec.splitElById.clear();

  const langInfo = resolveTargetLanguage(state.settings);
  if (pageRec.translatableParagraphs.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'nr-split-empty';
    empty.textContent = '此頁無可翻譯正文段落。';
    body.appendChild(empty);
    pageRec.splitStatusEl.textContent = '無需翻譯';
    return;
  }

  for (const para of pageRec.translatableParagraphs) {
    const pEl = document.createElement(para.isHeading ? 'h3' : 'p');
    pEl.className = 'nr-split-para is-pending';
    if (para.isHeading) pEl.classList.add('is-heading');
    pEl.style.fontFamily = para.isSerif ? langInfo.serifFontStack : langInfo.sansFontStack;
    pEl.textContent = para.text;
    pEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const translated = state.translations.get(para.key);
      if (translated) toggleComparePopover(pEl, para, translated);
    });
    body.appendChild(pEl);
    pageRec.splitElById.set(para.id, pEl);
  }

  pageRec.splitStatusEl.textContent = `待翻譯 0 / ${pageRec.translatableParagraphs.length}`;
}

function updateSplitParagraph(pageRec, para, zh) {
  const pEl = pageRec.splitElById.get(para.id);
  if (!pEl) return;
  const langInfo = resolveTargetLanguage(state.settings);
  pEl.textContent = zh;
  pEl.classList.remove('is-pending');
  pEl.style.fontFamily = para.isSerif ? langInfo.serifFontStack : langInfo.sansFontStack;

  const doneCount = pageRec.translatableParagraphs.reduce(
    (acc, item) => acc + (state.translations.has(item.key) ? 1 : 0),
    0
  );
  const total = pageRec.translatableParagraphs.length;
  pageRec.splitStatusEl.textContent = doneCount >= total
    ? `已完成 ${total} 段`
    : `翻譯中 ${doneCount} / ${total}`;
}

function applyTranslationToPage(pageRec, key, zh) {
  const matched = pageRec.paragraphsByKey.get(key);
  if (!matched) return;
  for (const para of matched) {
    renderParagraphOverlay(pageRec, para, zh);
    updateSplitParagraph(pageRec, para, zh);
  }
}

function closeComparePopover() {
  dom.comparePopover.hidden = true;
  if (state.activeCompareAnchor) {
    state.activeCompareAnchor.classList.remove('is-active-compare');
    state.activeCompareAnchor = null;
  }
  state.activeComparePara = null;
}

function toggleComparePopover(anchorEl, para, translatedText) {
  if (state.activeCompareAnchor === anchorEl && !dom.comparePopover.hidden) {
    closeComparePopover();
    return;
  }
  if (state.activeCompareAnchor) {
    state.activeCompareAnchor.classList.remove('is-active-compare');
  }
  state.activeCompareAnchor = anchorEl;
  state.activeComparePara = { orig: para.text, trans: translatedText };
  anchorEl.classList.add('is-active-compare');

  const langInfo = resolveTargetLanguage(state.settings);
  dom.compareOrigText.textContent = para.text;
  dom.compareTransText.textContent = translatedText;
  dom.compareTransText.style.fontFamily = para.isSerif ? langInfo.serifFontStack : langInfo.sansFontStack;
  dom.comparePopover.hidden = false;
}

function buildPageBatches(items) {
  const maxCount = Math.max(1, Number(state.settings?.batchSize || 18));
  const maxChars = Math.max(800, Number(state.settings?.maxBatchChars || 5000));
  const batches = [];
  let current = [];
  let chars = 0;
  for (const item of items) {
    if (current.length >= maxCount || (current.length > 0 && chars + item.text.length > maxChars)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += item.text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function translatePageParagraphs(pageRec, epoch) {
  if (epoch !== state.translationEpoch) return;
  if (pageRec.translationInFlight || pageRec.translatedEpoch === epoch) return;

  const targetLangId = state.settings?.targetLang || 'zh-TW';
  const viewportWidth = pageRec.viewport?.width || 600;
  const translatable = pageRec.allParagraphs.filter((para) =>
    shouldTranslatePdfText(para.text, targetLangId, {
      isHeading: para.isHeading,
      isMono: para.isMono,
      lineCount: para.lineCount,
      widthRatio: para.w / Math.max(1, viewportWidth)
    })
  );

  pageRec.translatableParagraphs = translatable;
  pageRec.paragraphsByKey.clear();
  for (const para of translatable) {
    if (!pageRec.paragraphsByKey.has(para.key)) {
      pageRec.paragraphsByKey.set(para.key, []);
    }
    pageRec.paragraphsByKey.get(para.key).push(para);
  }

  buildSplitCardSkeleton(pageRec);

  if (translatable.length === 0) {
    pageRec.translatedEpoch = epoch;
    updatePdfStatusBadge();
    return;
  }

  const uncachedByKey = new Map();
  for (const para of translatable) {
    const existing = state.translations.get(para.key);
    if (existing) {
      applyTranslationToPage(pageRec, para.key, existing);
    } else if (!uncachedByKey.has(para.key)) {
      uncachedByKey.set(para.key, { key: para.key, text: para.text });
    }
  }

  const toRequest = Array.from(uncachedByKey.values());
  if (toRequest.length === 0) {
    pageRec.translatedEpoch = epoch;
    updatePdfStatusBadge();
    return;
  }

  pageRec.translationInFlight = true;
  state.lastError = '';
  updatePdfStatusBadge();

  const controller = new AbortController();
  state.activeAbortControllers.add(controller);

  const onItemArrived = (key, zh, cached) => {
    if (epoch !== state.translationEpoch) return;
    state.translations.set(key, zh);
    if (cached) state.cachedKeys.add(key);
    applyTranslationToPage(pageRec, key, zh);
    for (const other of state.pages.values()) {
      if (other !== pageRec && other.paragraphsByKey.has(key)) {
        applyTranslationToPage(other, key, zh);
      }
    }
    updatePdfStatusBadge();
  };

  try {
    const batches = buildPageBatches(toRequest);
    for (const batch of batches) {
      if (epoch !== state.translationEpoch) return;
      await streamTranslateBatchWithCache(
        state.settings,
        batch,
        state.docTitle,
        onItemArrived,
        controller.signal
      );
    }
    if (epoch === state.translationEpoch) {
      pageRec.translatedEpoch = epoch;
    }
  } catch (err) {
    if (controller.signal.aborted || epoch !== state.translationEpoch) return;
    state.lastError = err?.message || '翻譯失敗';
    state.lastErrorCode = err?.errorCode || '';
  } finally {
    state.activeAbortControllers.delete(controller);
    pageRec.translationInFlight = false;
    updatePdfStatusBadge();
  }
}

async function renderAndTranslatePage(pageNum, { forceCanvas = false } = {}) {
  const pageRec = state.pages.get(pageNum);
  const pdfDoc = state.pdfDoc;
  if (!pageRec || !pdfDoc) return;

  const loadToken = state.docLoadToken;
  const targetScale = state.baseFitScale * state.zoom;
  const needsCanvas = forceCanvas || !pageRec.rendered || Math.abs(pageRec.renderedScale - targetScale) > 0.005;

  if (needsCanvas) {
    const renderSeq = (pageRec.renderSeq || 0) + 1;
    pageRec.renderSeq = renderSeq;

    if (pageRec.renderTask) {
      try {
        pageRec.renderTask.cancel();
        await pageRec.renderTask.promise.catch(() => {});
      } catch (_) {}
      pageRec.renderTask = null;
      if (renderSeq !== pageRec.renderSeq || loadToken !== state.docLoadToken) return;
    }

    try {
      const pdfPage = await pdfDoc.getPage(pageNum);
      if (renderSeq !== pageRec.renderSeq || loadToken !== state.docLoadToken) return;

      const viewport = pdfPage.getViewport({ scale: targetScale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.25);

      pageRec.sheetEl.style.width = `${viewport.width}px`;
      pageRec.sheetEl.style.height = `${viewport.height}px`;

      const canvas = pageRec.canvasEl;
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const renderTask = pdfPage.render({ canvasContext: ctx, viewport });
      pageRec.renderTask = renderTask;
      await renderTask.promise;
      if (renderSeq !== pageRec.renderSeq || loadToken !== state.docLoadToken) return;

      pageRec.renderTask = null;
      pageRec.rendered = true;
      pageRec.renderedScale = targetScale;
      pageRec.viewport = viewport;
      pageRec.loaderEl.hidden = true;

      let pageImageData = null;
      try {
        pageImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch (_) {}

      const textContent = await pdfPage.getTextContent();
      if (renderSeq !== pageRec.renderSeq || loadToken !== state.docLoadToken) return;

      const paragraphs = extractPdfParagraphs(textContent, viewport);
      for (let i = 0; i < paragraphs.length; i++) {
        paragraphs[i].id = `p${pageNum}_${i}`;
        paragraphs[i].colors = sampleParagraphColors(
          pageImageData,
          paragraphs[i],
          viewport.width,
          viewport.height,
          canvas.width,
          canvas.height
        );
      }

      pageRec.allParagraphs = paragraphs;
      pageRec.overlayLayer.replaceChildren();
      pageRec.overlayById.clear();

      if (pageRec.translatedEpoch === state.translationEpoch || pageRec.translationInFlight) {
        const targetLangId = state.settings?.targetLang || 'zh-TW';
        pageRec.translatableParagraphs = paragraphs.filter((para) =>
          shouldTranslatePdfText(para.text, targetLangId, {
            isHeading: para.isHeading,
            isMono: para.isMono,
            lineCount: para.lineCount,
            widthRatio: para.w / Math.max(1, viewport.width)
          })
        );
        pageRec.paragraphsByKey.clear();
        for (const para of pageRec.translatableParagraphs) {
          if (!pageRec.paragraphsByKey.has(para.key)) {
            pageRec.paragraphsByKey.set(para.key, []);
          }
          pageRec.paragraphsByKey.get(para.key).push(para);
          const zh = state.translations.get(para.key);
          if (zh) renderParagraphOverlay(pageRec, para, zh);
        }
        return;
      }
    } catch (err) {
      if (err?.name === 'RenderingCancelledException') return;
      console.warn(`[NativeRead PWA PDF] Page ${pageNum} render error:`, err);
      return;
    }
  }

  await translatePageParagraphs(pageRec, state.translationEpoch);
}

function buildPdfPageShells(numPages, defaultWidth, defaultHeight) {
  dom.pdfPagesContainer.replaceChildren();
  state.pages.clear();

  const cssW = Math.round(defaultWidth * state.baseFitScale * state.zoom);
  const cssH = Math.round(defaultHeight * state.baseFitScale * state.zoom);
  const frag = document.createDocumentFragment();

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const row = document.createElement('section');
    row.className = 'nr-page-row';
    row.dataset.pageNum = String(pageNum);

    const canvasCol = document.createElement('div');
    canvasCol.className = 'nr-page-canvas-col';

    const sheet = document.createElement('div');
    sheet.className = 'nr-page-sheet';
    sheet.style.width = `${cssW}px`;
    sheet.style.height = `${cssH}px`;

    const canvas = document.createElement('canvas');
    canvas.className = 'nr-pdf-canvas';

    const overlayLayer = document.createElement('div');
    overlayLayer.className = 'nr-overlay-layer';

    const loader = document.createElement('div');
    loader.className = 'nr-page-loader';
    loader.textContent = `第 ${pageNum} 頁載入中...`;

    const badge = document.createElement('div');
    badge.className = 'nr-page-num-badge';
    badge.textContent = `P. ${pageNum}`;

    sheet.append(canvas, overlayLayer, loader, badge);
    canvasCol.appendChild(sheet);

    const splitCol = document.createElement('div');
    splitCol.className = 'nr-page-split-col';

    const splitCard = document.createElement('article');
    splitCard.className = 'nr-split-card';

    const splitHeader = document.createElement('div');
    splitHeader.className = 'nr-split-card-header';

    const splitTitle = document.createElement('span');
    splitTitle.textContent = `第 ${pageNum} 頁 · 譯文`;

    const splitStatus = document.createElement('span');
    splitStatus.className = 'nr-split-page-status';
    splitStatus.textContent = '等待捲動至此頁...';

    splitHeader.append(splitTitle, splitStatus);

    const splitBody = document.createElement('div');
    splitBody.className = 'nr-split-card-body';

    splitCard.append(splitHeader, splitBody);
    splitCol.appendChild(splitCard);

    row.append(canvasCol, splitCol);
    frag.appendChild(row);

    state.pages.set(pageNum, {
      pageNum,
      rowEl: row,
      sheetEl: sheet,
      canvasEl: canvas,
      overlayLayer,
      loaderEl: loader,
      splitBody,
      splitStatusEl: splitStatus,
      rendered: false,
      renderedScale: 0,
      renderTask: null,
      viewport: null,
      allParagraphs: [],
      translatableParagraphs: [],
      paragraphsByKey: new Map(),
      overlayById: new Map(),
      splitElById: new Map(),
      translatedEpoch: -1,
      translationInFlight: false,
      isVisible: false
    });
  }

  dom.pdfPagesContainer.appendChild(frag);
}

function setupPdfObservers() {
  if (state.renderObserver) state.renderObserver.disconnect();
  if (state.pageTrackObserver) state.pageTrackObserver.disconnect();

  state.renderObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const pageNum = Number(entry.target.dataset.pageNum);
        const pageRec = state.pages.get(pageNum);
        if (!pageRec) continue;
        pageRec.isVisible = entry.isIntersecting;
        if (entry.isIntersecting) {
          renderAndTranslatePage(pageNum);
        }
      }
    },
    { rootMargin: '450px 0px', threshold: 0.01 }
  );

  state.pageTrackObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const p = Number(entry.target.dataset.pageNum);
          dom.pdfPageIndicator.hidden = false;
          dom.pdfPageIndicator.textContent = `${p} / ${state.numPages}`;
        }
      }
    },
    { rootMargin: '-20% 0px -60% 0px', threshold: 0.1 }
  );

  for (const pageRec of state.pages.values()) {
    state.renderObserver.observe(pageRec.rowEl);
    state.pageTrackObserver.observe(pageRec.rowEl);
  }
}

function hasPdfMagicHeader(uint8) {
  const limit = Math.min(uint8.length, 1024);
  for (let i = 0; i <= limit - 5; i++) {
    if (
      uint8[i] === 0x25 &&
      uint8[i + 1] === 0x50 &&
      uint8[i + 2] === 0x44 &&
      uint8[i + 3] === 0x46 &&
      uint8[i + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}

async function openPdfFromArrayBuffer(arrayBuffer, { title, sourceUrl = '' }) {
  const loadToken = ++state.docLoadToken;
  state.translationEpoch += 1;
  for (const c of state.activeAbortControllers) c.abort();
  state.activeAbortControllers.clear();
  closeComparePopover();

  if (state.pdfDoc) {
    try {
      await state.pdfDoc.destroy();
    } catch (_) {}
    state.pdfDoc = null;
  }

  state.translations.clear();
  state.cachedKeys.clear();
  state.lastError = '';
  state.docTitle = title || 'PDF Document';
  state.sourceUrl = sourceUrl;

  showPdfStage('loading');
  dom.pdfLoadingTitle.textContent = '正在解析 PDF 文件...';
  dom.pdfLoadingSub.textContent = state.docTitle;

  try {
    const bytes = new Uint8Array(arrayBuffer);
    if (!hasPdfMagicHeader(bytes)) {
      throw new Error('所載入的資料不是有效的 PDF 檔案。');
    }

    const loadingTask = pdfjsLib.getDocument({ data: bytes, isEvalSupported: false });
    const pdfDoc = await loadingTask.promise;
    if (loadToken !== state.docLoadToken) {
      pdfDoc.destroy().catch(() => {});
      return;
    }

    state.pdfDoc = pdfDoc;
    state.numPages = pdfDoc.numPages;

    const firstPage = await pdfDoc.getPage(1);
    if (loadToken !== state.docLoadToken) return;

    const baseViewport = firstPage.getViewport({ scale: 1.0 });
    state.defaultPageWidth = baseViewport.width;
    state.defaultPageHeight = baseViewport.height;

    const availW = Math.min(840, Math.max(310, window.innerWidth - 28));
    state.baseFitScale = Math.max(0.48, Math.min(1.55, availW / Math.max(200, baseViewport.width)));
    state.zoom = 1.0;
    dom.pdfZoomResetBtn.textContent = '100%';

    buildPdfPageShells(pdfDoc.numPages, baseViewport.width, baseViewport.height);
    showPdfStage('pages');
    dom.pdfPageIndicator.hidden = false;
    dom.pdfPageIndicator.textContent = `1 / ${pdfDoc.numPages}`;
    updatePdfStatusBadge();
    setupPdfObservers();
  } catch (err) {
    if (loadToken !== state.docLoadToken) return;
    showPdfError('無法解析此 PDF 文件', err?.message || 'PDF 檔案可能已損毀或受密碼保護。', Boolean(sourceUrl));
  }
}

function showPdfError(title, detail, canRetry) {
  showPdfStage('error');
  dom.pdfErrorTitle.textContent = title;
  dom.pdfErrorDetail.textContent = detail;
  dom.pdfRetryUrlBtn.hidden = !canRetry;
}

async function loadPdfFromUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    showPdfError('PDF 連結無效', `無法辨識網址：${rawUrl}`, false);
    return;
  }

  state.sourceUrl = parsed.toString();
  showPdfStage('loading');
  dom.pdfLoadingTitle.textContent = '正在下載 PDF 白皮書...';
  dom.pdfLoadingSub.textContent = parsed.toString();

  try {
    let res;
    try {
      res = await fetch(parsed.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (_) {
      // Fallback to AllOrigins CORS proxy for public arXiv / whitepaper PDFs
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(parsed.toString())}`;
      res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`CORS Proxy HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    const fileName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname);
    await openPdfFromArrayBuffer(buf, { title: fileName, sourceUrl: parsed.toString() });
  } catch (err) {
    showPdfError(
      '無法直接從此網址下載 PDF（受網站 CORS 限制）',
      `瀏覽器跨域限制阻擋了直接抓取 (${err?.message || 'CORS'})。\n請先將 PDF 下載至手機，再點擊下方「改選本機 PDF 檔案」即可完美原位翻譯！`,
      true
    );
  }
}

async function loadPdfFromFile(file) {
  if (!file) return;
  showPdfStage('loading');
  dom.pdfLoadingTitle.textContent = '正在讀取手機 PDF 檔案...';
  dom.pdfLoadingSub.textContent = file.name;
  try {
    const buf = await file.arrayBuffer();
    await openPdfFromArrayBuffer(buf, { title: file.name.replace(/\.pdf$/i, '') });
  } catch (err) {
    showPdfError('無法讀取 PDF 檔案', err?.message || '讀取失敗', false);
  }
}

function stepPdfZoom(dir) {
  let idx = ZOOM_STEPS.findIndex((v) => Math.abs(v - state.zoom) < 0.02);
  if (idx === -1) idx = 2;
  const nextIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + dir));
  applyPdfZoom(ZOOM_STEPS[nextIdx]);
}

function applyPdfZoom(nextZoom) {
  state.zoom = nextZoom;
  dom.pdfZoomResetBtn.textContent = `${Math.round(state.zoom * 100)}%`;
  dom.pdfZoomOutBtn.disabled = state.zoom <= ZOOM_STEPS[0] + 0.001;
  dom.pdfZoomInBtn.disabled = state.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.001;
  closeComparePopover();
  if (!state.pdfDoc) return;
  const nextScale = state.baseFitScale * state.zoom;
  const vh = window.innerHeight || 800;
  for (const pageRec of state.pages.values()) {
    pageRec.sheetEl.style.width = `${Math.round(state.defaultPageWidth * nextScale)}px`;
    pageRec.sheetEl.style.height = `${Math.round(state.defaultPageHeight * nextScale)}px`;
    const rect = pageRec.rowEl.getBoundingClientRect();
    const nearViewport = pageRec.isVisible || (rect.bottom >= -500 && rect.top <= vh + 500);
    if (nearViewport) {
      renderAndTranslatePage(pageRec.pageNum, { forceCanvas: true });
    } else {
      pageRec.rendered = false;
    }
  }
}

function resetAndRetranslatePdf() {
  if (!state.pdfDoc) return;
  state.translationEpoch += 1;
  abortAllActiveRequests();
  closeComparePopover();
  state.translations.clear();
  state.cachedKeys.clear();
  state.totalParagraphs = 0;
  state.translatedParagraphs = 0;
  state.lastError = '';
  state.lastErrorCode = '';

  for (const pageRec of state.pages.values()) {
    pageRec.translatedEpoch = -1;
    pageRec.translationRunSeq = (pageRec.translationRunSeq || 0) + 1;
    pageRec.translationInFlight = false;
    pageRec.overlayLayer.replaceChildren();
    pageRec.overlayById.clear();
    pageRec.splitBody.replaceChildren();
    pageRec.splitElById.clear();
    if (pageRec.splitStatusEl) pageRec.splitStatusEl.textContent = '重新翻譯中...';
  }
  updatePdfStatusBadge();

  const vh = window.innerHeight || 800;
  for (const pageRec of state.pages.values()) {
    const rect = pageRec.rowEl.getBoundingClientRect();
    const nearViewport = pageRec.isVisible || (rect.bottom >= -500 && rect.top <= vh + 500);
    if (nearViewport) {
      renderAndTranslatePage(pageRec.pageNum, { forceCanvas: false });
    }
  }
}

// ============================================================
// 8. Web URL & Raw Article Reader (Tab 2)
// ============================================================
function parseMarkdownOrTextBlocks(rawText, fallbackTitle = '外文文章翻譯') {
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n');
  let title = fallbackTitle;
  const blocks = [];
  let inCode = false;
  let codeLines = [];
  let paraLines = [];

  const flushPara = () => {
    if (paraLines.length === 0) return;
    const joined = paraLines.join(' ').replace(/\s+/g, ' ').trim();
    paraLines = [];
    if (!joined) return;
    blocks.push({ kind: 'p', text: joined, key: hashText(joined) });
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('```')) {
      if (inCode) {
        blocks.push({ kind: 'code', text: codeLines.join('\n') });
        codeLines = [];
        inCode = false;
      } else {
        flushPara();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }
    if (!trimmed) {
      flushPara();
      continue;
    }
    if (/^Title:\s+/i.test(trimmed) && title === fallbackTitle) {
      title = trimmed.replace(/^Title:\s+/i, '').trim();
      continue;
    }
    if (/^(?:URL Source|Markdown Content|Published Time):/i.test(trimmed)) {
      continue;
    }
    const hMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (hMatch) {
      flushPara();
      const hText = hMatch[2].trim();
      if (hMatch[1].length === 1 && title === fallbackTitle) {
        title = hText;
      } else if (hText) {
        blocks.push({ kind: 'heading', text: hText, key: hashText(hText) });
      }
      continue;
    }
    paraLines.push(trimmed);
  }
  flushPara();
  if (codeLines.length > 0) {
    blocks.push({ kind: 'code', text: codeLines.join('\n') });
  }
  return { title, blocks };
}

async function fetchReadableArticleFromUrl(targetUrl) {
  // 1. Try r.jina.ai clean reader first
  try {
    const jinaRes = await fetch(`https://r.jina.ai/${targetUrl}`, {
      headers: { Accept: 'text/plain' }
    });
    if (jinaRes.ok) {
      const txt = await jinaRes.text();
      if (txt && txt.trim().length > 80) {
        return parseMarkdownOrTextBlocks(txt, new URL(targetUrl).hostname);
      }
    }
  } catch (_) {}

  // 2. Fallback to AllOrigins HTML + DOMParser
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
  const htmlRes = await fetch(proxyUrl);
  if (!htmlRes.ok) {
    throw new Error(`無法擷取網頁 (HTTP ${htmlRes.status})`);
  }
  const html = await htmlRes.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = (doc.querySelector('h1')?.textContent || doc.title || new URL(targetUrl).hostname).trim();
  const root = doc.querySelector('article, main, [role="main"]') || doc.body;
  const blocks = [];

  for (const node of root.querySelectorAll('h1, h2, h3, h4, p, li, blockquote, pre')) {
    if (node.closest('nav, footer, aside, script, style, noscript')) continue;
    if (node.tagName === 'PRE') {
      const codeTxt = (node.textContent || '').trim();
      if (codeTxt) blocks.push({ kind: 'code', text: codeTxt });
      continue;
    }
    const txt = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (txt.length < 8) continue;
    const isH = /^H[1-4]$/.test(node.tagName);
    blocks.push({
      kind: isH ? 'heading' : 'p',
      text: txt,
      key: hashText(txt)
    });
  }

  return { title, blocks };
}

async function renderAndStreamWebArticle({ title, sourceLabel, blocks }) {
  if (state.webAbortController) {
    state.webAbortController.abort();
  }
  const controller = new AbortController();
  state.webAbortController = controller;

  dom.webArticleCard.hidden = false;
  dom.webArticleSource.textContent = sourceLabel || 'Reader';
  dom.webArticleTitle.textContent = title || '文章翻譯';
  dom.webArticleBody.replaceChildren();

  const translatableItems = [];
  const transNodesByKey = new Map();

  for (const blk of blocks) {
    if (blk.kind === 'code') {
      const pre = document.createElement('pre');
      pre.className = 'nr-web-code';
      pre.textContent = blk.text;
      dom.webArticleBody.appendChild(pre);
      continue;
    }

    const wrap = document.createElement(blk.kind === 'heading' ? 'h2' : 'div');
    wrap.className = `nr-web-block${blk.kind === 'heading' ? ' is-heading' : ''}`;

    const origSpan = document.createElement('div');
    origSpan.className = 'nr-web-orig';
    origSpan.textContent = blk.text;

    const transSpan = document.createElement('div');
    transSpan.className = 'nr-web-trans';
    transSpan.textContent = blk.text;

    wrap.append(origSpan, transSpan);
    dom.webArticleBody.appendChild(wrap);

    if (shouldTranslatePdfText(blk.text, state.settings.targetLang || 'zh-TW', { isHeading: blk.kind === 'heading' })) {
      if (!transNodesByKey.has(blk.key)) {
        transNodesByKey.set(blk.key, []);
        translatableItems.push({ key: blk.key, text: blk.text });
      }
      transNodesByKey.get(blk.key).push(transSpan);
    }
  }

  if (translatableItems.length === 0) {
    dom.webArticleProgress.textContent = '無需翻譯';
    return;
  }

  let doneCount = 0;
  dom.webArticleProgress.textContent = `串流翻譯中 0 / ${translatableItems.length}`;
  setGlobalStatus('streaming', `文章翻譯 0/${translatableItems.length}`);

  const onItem = (key, zh) => {
    const targets = transNodesByKey.get(key) || [];
    for (const node of targets) {
      node.textContent = zh;
    }
    doneCount += 1;
    dom.webArticleProgress.textContent = doneCount >= translatableItems.length
      ? `已完成 ${translatableItems.length} 段`
      : `串流翻譯中 ${doneCount} / ${translatableItems.length}`;
    setGlobalStatus(
      doneCount >= translatableItems.length ? 'done' : 'streaming',
      `已譯 ${doneCount}/${translatableItems.length}`
    );
  };

  try {
    const batches = buildPageBatches(translatableItems);
    for (const batch of batches) {
      if (controller.signal.aborted) return;
      await streamTranslateBatchWithCache(state.settings, batch, title, onItem, controller.signal);
    }
    setGlobalStatus('done', `已完成 ${doneCount} 段`);
  } catch (err) {
    if (controller.signal.aborted) return;
    dom.webArticleProgress.textContent = err?.message || '翻譯失敗';
    setGlobalStatus('error', err?.message || '翻譯失敗');
  }
}

// ============================================================
// 9. Settings Tab & Install Tab Helpers (Tabs 3 & 4)
// ============================================================
const BOOKMARKLET_SNIPPET = `javascript:(function(){var s=document.createElement('script');s.src='https://chih-kai-wang.github.io/native-read/nativeread.user.js?t='+Date.now();document.head.appendChild(s);})();`;

function populateSettingsForm() {
  const s = state.settings;
  dom.setProvider.replaceChildren();
  for (const preset of Object.values(PROVIDER_PRESETS)) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = preset.label;
    dom.setProvider.appendChild(opt);
  }
  dom.setProvider.value = PROVIDER_PRESETS[s.providerId] ? s.providerId : 'custom';
  dom.setApiKey.value = s.apiKey || '';
  dom.setModel.value = s.model || '';
  dom.setBaseUrl.value = s.baseUrl || '';
  dom.setTargetLang.value = TARGET_LANGUAGES[s.targetLang] ? s.targetLang : 'zh-TW';
  dom.customLangField.hidden = dom.setTargetLang.value !== 'custom';
  dom.setCustomTargetLang.value = s.customTargetLang || '';
  dom.setThinkingEffort.value = s.thinkingEffort || 'fastest';
  dom.setTypographyMatch.value = s.typographyMatch || 'native';
  dom.setGlossary.value = s.customGlossary ?? DEFAULT_GLOSSARY;

  updateProviderPresetUI(dom.setProvider.value, false);
}

function updateProviderPresetUI(providerId, overwriteFields = true) {
  const preset = PROVIDER_PRESETS[providerId] || PROVIDER_PRESETS.custom;
  dom.setProviderHint.textContent = preset.hint || '';
  dom.setApiKey.placeholder = preset.placeholderKey || '填入 API Key...';

  if (overwriteFields) {
    dom.setModel.value = preset.defaultModel || '';
    dom.setBaseUrl.value = preset.baseUrl || '';
  }

  dom.modelChipsRow.replaceChildren();
  for (const m of preset.suggestedModels || []) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'nr-chip';
    chip.textContent = m;
    chip.addEventListener('click', () => {
      dom.setModel.value = m;
    });
    dom.modelChipsRow.appendChild(chip);
  }
}

async function updateCacheCountUI() {
  const cnt = await cacheCount();
  dom.cacheCountLabel.textContent = String(cnt);
}

// ============================================================
// 10. Event Bindings & Startup
// ============================================================
function bindEvents() {
  dom.syncBannerClose.addEventListener('click', () => {
    dom.syncBanner.hidden = true;
  });

  for (const btn of dom.navButtons) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }

  // Global target language change
  dom.globalLangSelect.addEventListener('change', () => {
    const nextLang = dom.globalLangSelect.value;
    state.settings = saveSettings({ targetLang: nextLang });
    dom.setTargetLang.value = nextLang;
    applyRootLanguageFonts(state.settings);
    if (state.pdfDoc) {
      resetAndRetranslatePdf();
    }
    if (state.currentWebArticle) {
      renderAndStreamWebArticle(state.currentWebArticle);
    }
  });

  // Re-fit PDF pages on mobile rotation / window resize
  let pdfResizeTimer = null;
  let lastResizeWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (!state.pdfDoc) return;
    if (Math.abs(window.innerWidth - lastResizeWidth) < 24) return;
    lastResizeWidth = window.innerWidth;
    if (pdfResizeTimer) clearTimeout(pdfResizeTimer);
    pdfResizeTimer = setTimeout(() => {
      if (!state.pdfDoc) return;
      const availW = Math.min(840, Math.max(310, window.innerWidth - 28));
      state.baseFitScale = Math.max(0.48, Math.min(1.55, availW / Math.max(200, state.defaultPageWidth)));
      applyPdfZoom(state.zoom);
    }, 220);
  });

  // PDF Tab events
  dom.pdfModeSegmented.addEventListener('click', (e) => {
    const btn = e.target.closest('.nr-seg-btn');
    if (btn?.dataset.mode) setPdfMode(btn.dataset.mode);
  });

  dom.pdfZoomOutBtn.addEventListener('click', () => stepPdfZoom(-1));
  dom.pdfZoomInBtn.addEventListener('click', () => stepPdfZoom(1));
  dom.pdfZoomResetBtn.addEventListener('click', () => applyPdfZoom(1.0));

  const openFilePicker = () => {
    dom.pdfFileInput.value = '';
    dom.pdfFileInput.click();
  };
  dom.pdfOpenFileTopBtn.addEventListener('click', openFilePicker);
  dom.pdfEmptyOpenBtn.addEventListener('click', openFilePicker);
  dom.pdfErrorOpenFileBtn.addEventListener('click', openFilePicker);

  dom.pdfFileInput.addEventListener('change', () => {
    const file = dom.pdfFileInput.files?.[0];
    if (file) loadPdfFromFile(file);
  });

  dom.pdfUrlForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = dom.pdfUrlInput.value.trim();
    if (val) loadPdfFromUrl(val);
  });

  dom.pdfRetryUrlBtn.addEventListener('click', () => {
    if (state.sourceUrl) loadPdfFromUrl(state.sourceUrl);
  });

  // Compare Sheet events
  dom.compareCloseBtn.addEventListener('click', closeComparePopover);
  const copyFeedback = async (btn, text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const prev = btn.textContent;
      btn.textContent = '已複製';
      setTimeout(() => { btn.textContent = prev; }, 1200);
    } catch (_) {}
  };
  dom.copyOrigBtn.addEventListener('click', () => copyFeedback(dom.copyOrigBtn, state.activeComparePara?.orig));
  dom.copyTransBtn.addEventListener('click', () => copyFeedback(dom.copyTransBtn, state.activeComparePara?.trans));

  // Web Tab events
  dom.webModeSegmented.addEventListener('click', (e) => {
    const btn = e.target.closest('.nr-seg-btn');
    if (!btn?.dataset.webmode) return;
    dom.webArticleCard.dataset.webmode = btn.dataset.webmode;
    for (const b of dom.webModeSegmented.querySelectorAll('.nr-seg-btn')) {
      b.classList.toggle('is-active', b === btn);
    }
  });

  dom.webFontSegmented.addEventListener('click', (e) => {
    const btn = e.target.closest('.nr-seg-btn');
    if (!btn?.dataset.webfont) return;
    dom.webArticleCard.dataset.webfont = btn.dataset.webfont;
    for (const b of dom.webFontSegmented.querySelectorAll('.nr-seg-btn')) {
      b.classList.toggle('is-active', b === btn);
    }
  });

  dom.webUrlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = dom.webUrlInput.value.trim();
    if (!url) return;
    // If user pasted a direct PDF link into Web tab, automatically route to PDF tab!
    if (/\.pdf(?:$|\?)/i.test(url) || /arxiv\.org\/pdf\//i.test(url)) {
      switchTab('pdf');
      dom.pdfUrlInput.value = url;
      loadPdfFromUrl(url);
      return;
    }
    dom.webArticleCard.hidden = false;
    dom.webArticleTitle.textContent = '正在擷取網頁正文...';
    dom.webArticleProgress.textContent = url;
    dom.webArticleBody.replaceChildren();
    try {
      const parsed = await fetchReadableArticleFromUrl(url);
      await renderAndStreamWebArticle({
        title: parsed.title,
        sourceLabel: new URL(url).hostname,
        blocks: parsed.blocks
      });
    } catch (err) {
      dom.webArticleTitle.textContent = '無法直接擷取該網址';
      dom.webArticleProgress.textContent = err?.message || '請改展開上方「直接貼上外文段落」進行翻譯';
    }
  });

  dom.webTranslateRawBtn.addEventListener('click', () => {
    const raw = dom.webRawInput.value.trim();
    if (!raw) return;
    const parsed = parseMarkdownOrTextBlocks(raw, '自訂外文段落翻譯');
    renderAndStreamWebArticle({
      title: parsed.title,
      sourceLabel: 'Direct Paste',
      blocks: parsed.blocks
    });
  });

  dom.webClearRawBtn.addEventListener('click', () => {
    dom.webRawInput.value = '';
  });

  // Install Tab bookmarklet
  dom.bookmarkletCodeBox.textContent = BOOKMARKLET_SNIPPET;
  dom.copyBookmarkletBtn.addEventListener('click', () => {
    copyFeedback(dom.copyBookmarkletBtn, BOOKMARKLET_SNIPPET);
  });

  // Settings Tab events
  dom.setProvider.addEventListener('change', () => {
    updateProviderPresetUI(dom.setProvider.value, true);
  });

  dom.setTargetLang.addEventListener('change', () => {
    dom.customLangField.hidden = dom.setTargetLang.value !== 'custom';
  });

  dom.toggleApiKeyVisBtn.addEventListener('click', () => {
    const isPw = dom.setApiKey.type === 'password';
    dom.setApiKey.type = isPw ? 'text' : 'password';
    dom.toggleApiKeyVisBtn.textContent = isPw ? '隱藏' : '顯示';
  });

  const collectFormSettings = () => {
    const providerId = dom.setProvider.value;
    const preset = PROVIDER_PRESETS[providerId] || PROVIDER_PRESETS.custom;
    return {
      providerId,
      protocol: preset.protocol || 'openai',
      apiKey: sanitizeApiKey(dom.setApiKey.value),
      model: dom.setModel.value.trim() || preset.defaultModel,
      baseUrl: dom.setBaseUrl.value.trim() || preset.baseUrl,
      targetLang: dom.setTargetLang.value,
      customTargetLang: dom.setCustomTargetLang.value.trim(),
      thinkingEffort: dom.setThinkingEffort.value,
      typographyMatch: dom.setTypographyMatch.value,
      customGlossary: dom.setGlossary.value
    };
  };

  dom.settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const prev = state.settings;
    state.settings = saveSettings(collectFormSettings());
    populateLanguageDropdowns();
    applyRootLanguageFonts(state.settings);
    showSyncBanner('✅ 設定已儲存至本機！');
    if (
      state.pdfDoc &&
      prev &&
      (
        state.settings.targetLang !== prev.targetLang ||
        state.settings.customTargetLang !== prev.customTargetLang ||
        state.settings.model !== prev.model ||
        state.settings.protocol !== prev.protocol
      )
    ) {
      resetAndRetranslatePdf();
    }
  });

  dom.testApiBtn.addEventListener('click', async () => {
    const candidate = { ...state.settings, ...collectFormSettings() };
    state.settings = saveSettings(candidate);
    dom.settingsTestResult.hidden = false;
    dom.settingsTestResult.dataset.status = '';
    dom.settingsTestResult.textContent = `正在測試連線 (${candidate.protocol} · ${candidate.model})...`;
    const t0 = performance.now();
    try {
      let translated = '';
      await streamTranslateBatchWithCache(
        candidate,
        [{ key: `test_${Date.now()}`, text: 'Machine learning models prevent overfitting using cross-validation.' }],
        'API Connection Test',
        (_k, zh) => { translated = zh; },
        null
      );
      const ms = Math.round(performance.now() - t0);
      dom.settingsTestResult.dataset.status = 'ok';
      dom.settingsTestResult.textContent = `✅ 連線成功 (${ms} ms)\n測試譯文：${translated}`;
    } catch (err) {
      dom.settingsTestResult.dataset.status = 'error';
      dom.settingsTestResult.textContent = `❌ 連線失敗：${err?.message || err}`;
    }
  });

  dom.clearCacheBtn.addEventListener('click', async () => {
    await cacheClear();
    await updateCacheCountUI();
    showSyncBanner('🧹 已清除所有 IndexedDB 翻譯快取');
  });
}

async function init() {
  const syncedFromDesktop = checkAndApplyNrSyncHash();
  state.settings = loadSettings();
  populateLanguageDropdowns();
  populateSettingsForm();
  applyRootLanguageFonts(state.settings);
  bindEvents();
  updateCacheCountUI();

  if (syncedFromDesktop) {
    showSyncBanner('✅ 已從電腦端同步 API Key 與偏好設定！');
  }

  // Register PWA Service Worker
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Handle query parameters (?src= for PDF, ?url= / ?text= for Web Share Target)
  const params = new URLSearchParams(window.location.search);
  const srcPdf = params.get('src');
  const shareUrl = params.get('url') || params.get('text');

  if (srcPdf && srcPdf.trim()) {
    switchTab('pdf');
    dom.pdfUrlInput.value = srcPdf.trim();
    await loadPdfFromUrl(srcPdf.trim());
  } else if (shareUrl && /^https?:\/\/\S+/i.test(shareUrl.trim())) {
    const cleanUrl = shareUrl.trim().match(/https?:\/\/\S+/i)[0];
    if (/\.pdf(?:$|\?)/i.test(cleanUrl) || /arxiv\.org\/pdf\//i.test(cleanUrl)) {
      switchTab('pdf');
      dom.pdfUrlInput.value = cleanUrl;
      await loadPdfFromUrl(cleanUrl);
    } else {
      switchTab('web');
      dom.webUrlInput.value = cleanUrl;
      dom.webUrlForm.requestSubmit();
    }
  } else {
    showPdfStage('empty');
  }
}

init();
