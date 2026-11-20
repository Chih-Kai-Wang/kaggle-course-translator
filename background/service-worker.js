importScripts('../shared/config.js', '../shared/cache-db.js');

const {
  DEFAULT_GLOSSARY,
  getSettings,
  resolveEndpoint,
  resolveStreamEndpoint,
  resolveThinkingConfig,
  resolveTargetLanguage,
  sanitizeApiKey,
  hashText,
  isHostWhitelisted,
  isInjectableUrl,
  isPdfUrl
} = globalThis.KCTConfig;

const CacheDB = globalThis.KCTCacheDB;

const CONTENT_CSS_FILES = ['content/content.css'];
const CONTENT_JS_FILES = [
  'shared/config.js',
  'content/site-analyzer.js',
  'content/code-overlay.js',
  'content/renderer.js',
  'content/content.js'
];

let nextBatchSeq = 1;
const activeBatchDebug = new Map();
const recentBatchDebug = [];

function recordBatchEvent(id, patch) {
  const cur = activeBatchDebug.get(id);
  if (cur) {
    Object.assign(cur, patch);
  }
}

function finishBatchEvent(id, patch) {
  const cur = activeBatchDebug.get(id);
  if (!cur) return;
  Object.assign(cur, patch, { endedAt: Date.now(), elapsedMs: Date.now() - cur.startedAt });
  activeBatchDebug.delete(id);
  recentBatchDebug.push(cur);
  if (recentBatchDebug.length > 20) recentBatchDebug.shift();
}

function isLocalEndpoint(baseUrl) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(String(baseUrl || '').trim());
}

function shouldUseGlossary(settings, pageContext) {
  const lang = resolveTargetLanguage(settings);
  if (lang.id !== 'zh-TW' && lang.id !== 'zh-CN') return false;
  const glossary = String(settings.customGlossary || '').trim();
  if (!glossary) return false;
  const isUserModified = glossary !== String(DEFAULT_GLOSSARY || '').trim();
  if (isUserModified) return true;
  if (!pageContext) return true;
  return Boolean(pageContext.useTechGlossary);
}

function buildCacheSignature(settings, pageContext) {
  const lang = resolveTargetLanguage(settings);
  const useGlossary = shouldUseGlossary(settings, pageContext);
  const glossaryHash = useGlossary
    ? hashText(String(settings.customGlossary || '').trim())
    : 'gen';
  const customLang = lang.id === 'custom' ? String(settings.customTargetLang || '').trim() : '';
  const effort = settings.thinkingEffort || 'fastest';
  return `${settings.protocol}:${settings.model}:${effort}:${lang.id}:${customLang}:${glossaryHash}`;
}

function buildLanguageGuidance(lang) {
  if (lang.id === 'zh-TW') {
    return [
      '目標語言：繁體中文（台灣慣用語與台灣繁體字形）。',
      '用語規範：請使用自然道地的台灣用語（例如：資料、欄位、函式、參數、迴圈、模型、特徵、驗證集、過度擬合、管線、程式碼、執行、錯誤訊息），切勿混用簡體字或中國大陸慣用語（如「数据、函数、过拟合、循环、代码、报错」）。'
    ].join('\n');
  }
  if (lang.id === 'zh-CN') {
    return '目标语言：简体中文（自然流利的中国大陆表达与技术术语）。';
  }
  return `Target language: ${lang.promptName}. Translate accurately using natural, idiomatic phrasing in that language.`;
}

function buildGlossarySection(settings, pageContext) {
  if (!shouldUseGlossary(settings, pageContext)) return '';
  const lang = resolveTargetLanguage(settings);
  const glossary = String(settings.customGlossary || '').trim();
  if (!glossary) return '';
  const glossaryNote = lang.id === 'zh-CN'
    ? '參考術語表（若術語表為繁體寫法，輸出時請自動轉為對應簡體字形與中國大陸技術用語）：'
    : '參考術語表（若語意符合請優先採用一致譯法）：';
  return `\n${glossaryNote}\n${glossary}\n`;
}

function buildRoleAndTopicLines(pageContext) {
  const isTech = !pageContext || Boolean(pageContext.useTechGlossary);
  const roleLine = isTech
    ? 'Expert technical translator for software engineering, ML, Data Science, Python, Kaggle & documentation.'
    : 'Expert web translator. Translate accurately with natural, idiomatic phrasing preserving the original tone and structure.';
  const cleanTitle = String(pageContext?.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const topicLine = cleanTitle ? `Page topic: ${cleanTitle}` : '';
  return { roleLine, topicLine };
}

function buildSystemPrompt(settings, pageContext) {
  const lang = resolveTargetLanguage(settings);
  const { roleLine, topicLine } = buildRoleAndTopicLines(pageContext);
  const glossarySection = buildGlossarySection(settings, pageContext);

  return [
    roleLine,
    topicLine,
    buildLanguageGuidance(lang),
    'Rules:',
    '1. Keep ALL placeholders ([[C0]], [[C1]], [[M0]], [[L0]]) exact and untranslated in natural positions.',
    '2. Keep code identifiers, package/class/function names, URLs, and standard abbreviations (MAE, RMSE, AUC, CV, SQL, API) intact.',
    '3. For `"kind":"comment"`, keep the leading `# ` prefix and return only the concise translated comment text.',
    '4. Output ONLY valid JSON: {"translations":[{"id":0,"zh":"..."},...]} matching all input ids.',
    glossarySection
  ].filter(Boolean).join('\n');
}

function buildStreamSystemPrompt(settings, pageContext) {
  const lang = resolveTargetLanguage(settings);
  const { roleLine, topicLine } = buildRoleAndTopicLines(pageContext);
  const glossarySection = buildGlossarySection(settings, pageContext);

  return [
    roleLine,
    topicLine,
    buildLanguageGuidance(lang),
    'Rules:',
    '1. Keep ALL placeholders ([[C0]], [[C1]], [[M0]], [[L0]]) exact and untranslated in natural positions.',
    '2. Keep code identifiers, package/class/function names, URLs, and standard abbreviations intact.',
    '3. For `"kind":"comment"`, keep the leading `# ` prefix and return only the concise translated comment text.',
    '4. Output STRICT NDJSON: exactly ONE JSON object per line in the format {"i":0,"t":"..."} matching every input index `i`, in order.',
    '5. NO markdown code fences (no ```), NO surrounding array [...], NO wrapper object, NO extra text.',
    glossarySection
  ].filter(Boolean).join('\n');
}

function extractJsonObject(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) throw new Error('模型返回內容為空');

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch (_) {
    const objStart = candidate.indexOf('{');
    const objEnd = candidate.lastIndexOf('}');
    if (objStart !== -1 && objEnd > objStart) {
      try {
        return JSON.parse(candidate.slice(objStart, objEnd + 1));
      } catch (_) {}
    }
    const arrStart = candidate.indexOf('[');
    const arrEnd = candidate.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
      return JSON.parse(candidate.slice(arrStart, arrEnd + 1));
    }
    throw new Error('模型返回格式不是有效 JSON');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeAbortError(message = '請求已取消') {
  const err = new Error(message);
  err.name = 'AbortError';
  err.isExternalAbort = true;
  err.noSplit = true;
  err.noRetry = true;
  return err;
}

// Cross-frame global scheduler + adaptive cooldown after HTTP 429 (protects Free Tier 5-15 RPM)
const NORMAL_MAX_CONCURRENT = 3;
let inFlightRequests = 0;
const slotWaiters = [];
let globalCooldownUntil = 0;
let adaptivePacingUntil = 0;
let lastRequestStartAt = 0;
let pacingTail = Promise.resolve();

function getEffectiveMaxConcurrent() {
  return Date.now() < adaptivePacingUntil ? 1 : NORMAL_MAX_CONCURRENT;
}

function abortableSleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(makeAbortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(makeAbortError());
    };
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function acquireRequestSlot(externalSignal) {
  if (externalSignal?.aborted) {
    throw makeAbortError();
  }
  while (inFlightRequests >= getEffectiveMaxConcurrent()) {
    await new Promise((resolve, reject) => {
      const waiter = () => {
        if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        const idx = slotWaiters.indexOf(waiter);
        if (idx !== -1) slotWaiters.splice(idx, 1);
        reject(makeAbortError());
      };
      if (externalSignal) {
        if (externalSignal.aborted) {
          reject(makeAbortError());
          return;
        }
        externalSignal.addEventListener('abort', onAbort, { once: true });
      }
      slotWaiters.push(waiter);
    });
  }
  inFlightRequests += 1;

  const gate = pacingTail.then(async () => {
    if (externalSignal?.aborted) return;
    const cooldownWait = globalCooldownUntil - Date.now();
    if (cooldownWait > 0) {
      await abortableSleep(cooldownWait, externalSignal);
    }
    if (externalSignal?.aborted) return;
    if (Date.now() < adaptivePacingUntil) {
      const gapWait = lastRequestStartAt + 4300 - Date.now();
      if (gapWait > 0) {
        await abortableSleep(gapWait, externalSignal);
      }
    }
    if (!externalSignal?.aborted) {
      lastRequestStartAt = Date.now();
    }
  });
  pacingTail = gate.catch(() => {});
  try {
    await gate;
  } catch (err) {
    releaseRequestSlot();
    throw err;
  }

  if (externalSignal?.aborted) {
    releaseRequestSlot();
    throw makeAbortError();
  }
}

function releaseRequestSlot() {
  inFlightRequests = Math.max(0, inFlightRequests - 1);
  if (slotWaiters.length > 0 && inFlightRequests < getEffectiveMaxConcurrent()) {
    const wake = slotWaiters.shift();
    wake();
  }
}

function parseRetryDelayMs(errBody, response) {
  const retryAfter = response?.headers?.get?.('Retry-After');
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) {
      return Math.ceil(secs * 1000);
    }
  }
  const text = String(errBody || '');
  const jsonMatch = text.match(/"retryDelay"\s*:\s*"([0-9.]+)s"/i);
  if (jsonMatch) {
    const secs = Number(jsonMatch[1]);
    if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
  }
  const proseMatch = text.match(/retry in\s+([0-9.]+)s/i);
  if (proseMatch) {
    const secs = Number(proseMatch[1]);
    if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
  }
  return 0;
}

function handleRateLimitResponse(errBody, response, attempt, maxAttempts) {
  const isDailyOrZeroQuota = /PerDay|RequestsPerDay|GenerateRequestsPerDay|"quotaValue"\s*:\s*"0"|limit:\s*0/i.test(errBody);
  const retryDelayMs = parseRetryDelayMs(errBody, response);
  if (!isDailyOrZeroQuota && attempt < maxAttempts && retryDelayMs <= 28000) {
    const waitMs = Math.min(26000, retryDelayMs > 0 ? retryDelayMs + 400 : 4500 * attempt);
    const now = Date.now();
    adaptivePacingUntil = Math.max(adaptivePacingUntil, now + 90000);
    globalCooldownUntil = Math.max(globalCooldownUntil, now + waitMs);
    return { shouldRetry: true };
  }
  const waitSec = retryDelayMs > 0 ? Math.ceil(retryDelayMs / 1000) : null;
  const rateHint = isDailyOrZeroQuota
    ? 'HTTP 429：已達每日免費額度上限（或模型配額為 0），建議切換 Tier 1 Key、更換模型或改用 DeepSeek'
    : waitSec
      ? `HTTP 429：請求頻率達上限，需等待約 ${waitSec}s（免費版限 5–15 RPM）`
      : `HTTP 429：請求頻率達上限 (${errBody.slice(0, 160) || response.statusText})`;
  const httpErr = new Error(rateHint);
  httpErr.httpStatus = 429;
  httpErr.errorCode = isDailyOrZeroQuota ? 'QUOTA_EXCEEDED' : 'RATE_LIMITED';
  httpErr.noSplit = true;
  httpErr.noRetry = true;
  return { shouldRetry: false, error: httpErr };
}

function normalizeGeminiModelId(model) {
  return String(model || '').replace(/^models\//i, '').trim().toLowerCase();
}

function buildGeminiRequestBody(settings, messages, expectJson) {
  const systemMsg = messages.find((m) => m.role === 'system');
  const userMsgs = messages.filter((m) => m.role !== 'system');
  const normModel = normalizeGeminiModelId(settings.model);
  const isGemini3Or4 = /^gemini-(?:3|4)(?:[.\-]|$)/.test(normModel);

  const generationConfig = {};
  if (!isGemini3Or4) {
    generationConfig.temperature = Number(settings.temperature ?? 0.2);
  }
  const thinkingConfig = resolveThinkingConfig(settings.model, settings.thinkingEffort || 'fastest');
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }
  if (expectJson) {
    generationConfig.responseMimeType = 'application/json';
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

function buildOpenAIRequestBody(settings, endpoint, messages, { expectJson = false, stream = false } = {}) {
  const model = String(settings.model || '').trim();
  const effort = settings.thinkingEffort || 'fastest';
  const isOpenAIReasoning = /^o[134](?:-|$)/i.test(model);
  const isDeepSeekReasoner = /deepseek-reasoner|^r1\b/i.test(model);

  const body = {
    model,
    messages
  };

  if (!isOpenAIReasoning && !isDeepSeekReasoner) {
    body.temperature = Number(settings.temperature ?? 0.2);
  }

  if (stream) {
    body.stream = true;
  }
  if (expectJson && !stream) {
    body.response_format = { type: 'json_object' };
  }

  // Avoid requesting reasoning tokens in fastest mode on known reasoning endpoints
  if (effort === 'fastest') {
    if (isOpenAIReasoning && /api\.openai\.com/i.test(endpoint)) {
      body.reasoning_effort = 'low';
    } else if (/^qwen3/i.test(model) && /dashscope\.aliyuncs\.com/i.test(endpoint)) {
      body.enable_thinking = false;
    }
  }

  return body;
}

async function callLLMChat(settings, messages, expectJson = true, externalSignal = null) {
  const endpoint = resolveEndpoint(settings);
  if (!endpoint) {
    throw new Error('API 地址無效，請檢查設定中的 Base URL');
  }

  const maxAttempts = 4;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (externalSignal?.aborted) {
      throw makeAbortError();
    }
    let sleepAfterAttemptMs = 0;
    await acquireRequestSlot(externalSignal);
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 25000);

    try {
      let response;
      if (settings.protocol === 'gemini') {
        const body = buildGeminiRequestBody(settings, messages, expectJson);
        const headers = { 'Content-Type': 'application/json' };
        const cleanKey = sanitizeApiKey(settings.apiKey);
        if (cleanKey) {
          headers['x-goog-api-key'] = cleanKey;
        }
        response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } else {
        const headers = { 'Content-Type': 'application/json' };
        const cleanKey = sanitizeApiKey(settings.apiKey);
        if (cleanKey) {
          headers['Authorization'] = `Bearer ${cleanKey}`;
        }
        const body = buildOpenAIRequestBody(settings, endpoint, messages, { expectJson, stream: false });
        response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });

        // Some OpenAI-compatible relays reject response_format or optional reasoning fields
        if (!response.ok && response.status === 400) {
          const errText = await response.text();
          if (/response_format|json_object|reasoning_effort|enable_thinking|temperature/i.test(errText)) {
            delete body.response_format;
            delete body.reasoning_effort;
            delete body.enable_thinking;
            if (/temperature/i.test(errText)) delete body.temperature;
            response = await fetch(endpoint, {
              method: 'POST',
              headers,
              body: JSON.stringify(body),
              signal: controller.signal
            });
          } else {
            const badReq = new Error(`HTTP 400: ${errText.slice(0, 260)}`);
            badReq.httpStatus = 400;
            badReq.noSplit = true;
            throw badReq;
          }
        }
      }

      if (!response.ok) {
        const errBody = await response.text();
        const status = response.status;
        if (status === 429) {
          const rl = handleRateLimitResponse(errBody, response, attempt, maxAttempts);
          if (rl.shouldRetry) continue;
          throw rl.error;
        }
        if (status >= 500 && attempt < maxAttempts) {
          sleepAfterAttemptMs = 700 * attempt;
          continue;
        }
        const httpErr = new Error(`HTTP ${status}: ${errBody.slice(0, 280) || response.statusText}`);
        httpErr.httpStatus = status;
        httpErr.errorCode = `HTTP_${status}`;
        httpErr.noSplit = status === 400 || status === 401 || status === 403 || status === 404;
        throw httpErr;
      }

      const data = await response.json();
      if (settings.protocol === 'gemini') {
        const candidate = data?.candidates?.[0];
        const parts = candidate?.content?.parts || [];
        const answerParts = parts.filter((p) => !p.thought && p.text);
        const text = (answerParts.length ? answerParts : parts).map((p) => p.text || '').join('');
        if (!text) {
          const reason = candidate?.finishReason ? ` (${candidate.finishReason})` : '';
          throw new Error(data?.error?.message || `Gemini 未返回文本內容${reason}`);
        }
        return text;
      } else {
        const text = data?.choices?.[0]?.message?.content || '';
        if (!text) {
          throw new Error(data?.error?.message || '模型未返回有效文本');
        }
        return text;
      }
    } catch (err) {
      if (externalSignal?.aborted || err?.isExternalAbort) {
        throw makeAbortError();
      }
      lastError = err;
      if (err.name === 'AbortError' || timedOut) {
        lastError = new Error('請求逾時 (25s)，請檢查網路或 API 服務狀態');
        lastError.noSplit = true;
      }
      if (lastError.noRetry) {
        break;
      }
      if (attempt < maxAttempts && /timeout|逾時|network|failed to fetch|5\d\d/i.test(String(lastError.message))) {
        sleepAfterAttemptMs = 700 * attempt;
        continue;
      }
      break;
    } finally {
      clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
      releaseRequestSlot();
      if (sleepAfterAttemptMs > 0 && !externalSignal?.aborted) {
        await sleep(sleepAfterAttemptMs);
      }
    }
  }

  throw lastError || new Error('翻譯請求失敗');
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
    for (const item of obj) pushEntry(item);
  } else if (Array.isArray(obj.translations)) {
    for (const item of obj.translations) pushEntry(item);
  } else if (Array.isArray(obj.data)) {
    for (const item of obj.data) pushEntry(item);
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
  // Strip leading array bracket or trailing comma if model emitted JSON-array style lines
  if (clean.startsWith('[') && clean.includes('{')) {
    clean = clean.slice(1).trim();
  }
  if (clean.endsWith(',')) {
    clean = clean.slice(0, -1).trim();
  }
  if (clean.endsWith(']') && !clean.startsWith('[')) {
    clean = clean.slice(0, -1).trim();
  }
  if (!clean) return [];

  try {
    return extractNdjsonEntriesFromObject(JSON.parse(clean));
  } catch (_) {
    // Try extracting a single {...} slice or multiple concatenated {...}{...} objects on the same line
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
          if (escaped) {
            escaped = false;
          } else if (ch === '\\') {
            escaped = true;
          } else if (ch === '"') {
            inStr = false;
          }
        } else {
          if (ch === '"') inStr = true;
          else if (ch === '{') depth += 1;
          else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
              end = i;
              break;
            }
          }
        }
      }
      if (end === -1) break;
      try {
        const parsed = JSON.parse(clean.slice(start, end + 1));
        results.push(...extractNdjsonEntriesFromObject(parsed));
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
  if (typeof choice?.delta?.content === 'string') {
    return choice.delta.content;
  }
  if (typeof choice?.message?.content === 'string') {
    return choice.message.content;
  }
  return '';
}

async function streamTranslateItems(settings, items, pageContext, onItem, externalSignal = null) {
  if (!items || items.length === 0) return 0;

  const endpoint = resolveStreamEndpoint(settings);
  if (!endpoint) {
    throw new Error('API 地址無效，請檢查設定中的 Base URL');
  }

  const payload = items.map((item, idx) =>
    item.kind === 'comment'
      ? { i: idx, kind: 'comment', text: item.text }
      : { i: idx, text: item.text }
  );
  const messages = [
    { role: 'system', content: buildStreamSystemPrompt(settings, pageContext) },
    { role: 'user', content: JSON.stringify(payload) }
  ];

  const maxAttempts = 4;
  let lastError = null;
  let emittedCount = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (externalSignal?.aborted) {
      throw makeAbortError();
    }
    let sleepAfterAttemptMs = 0;
    await acquireRequestSlot(externalSignal);

    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    let idleTimeoutId = null;
    const resetIdleTimeout = () => {
      if (idleTimeoutId) clearTimeout(idleTimeoutId);
      idleTimeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 28000);
    };
    resetIdleTimeout();

    try {
      let response;
      const cleanKey = sanitizeApiKey(settings.apiKey);
      if (settings.protocol === 'gemini') {
        // Note: expectJson = false because NDJSON stream is multiple JSON objects, not a single JSON doc
        const body = buildGeminiRequestBody(settings, messages, false);
        const headers = { 'Content-Type': 'application/json' };
        if (cleanKey) {
          headers['x-goog-api-key'] = cleanKey;
        }
        response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } else {
        const headers = { 'Content-Type': 'application/json' };
        if (cleanKey) {
          headers['Authorization'] = `Bearer ${cleanKey}`;
        }
        const body = buildOpenAIRequestBody(settings, endpoint, messages, { expectJson: false, stream: true });
        response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });

        if (!response.ok && response.status === 400) {
          const errText = await response.text();
          if (/reasoning_effort|enable_thinking|temperature/i.test(errText)) {
            delete body.reasoning_effort;
            delete body.enable_thinking;
            if (/temperature/i.test(errText)) delete body.temperature;
            response = await fetch(endpoint, {
              method: 'POST',
              headers,
              body: JSON.stringify(body),
              signal: controller.signal
            });
          } else {
            const badReq = new Error(`HTTP 400: ${errText.slice(0, 260)}`);
            badReq.httpStatus = 400;
            badReq.noSplit = true;
            throw badReq;
          }
        }
      }

      if (!response.ok) {
        const errBody = await response.text();
        const status = response.status;
        if (status === 429) {
          const rl = handleRateLimitResponse(errBody, response, attempt, maxAttempts);
          if (rl.shouldRetry) continue;
          throw rl.error;
        }
        if (status >= 500 && attempt < maxAttempts) {
          sleepAfterAttemptMs = 700 * attempt;
          continue;
        }
        const httpErr = new Error(`HTTP ${status}: ${errBody.slice(0, 280) || response.statusText}`);
        httpErr.httpStatus = status;
        httpErr.errorCode = `HTTP_${status}`;
        httpErr.noSplit = status === 400 || status === 401 || status === 403 || status === 404;
        throw httpErr;
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!response.body || (contentType.includes('application/json') && !contentType.includes('event-stream'))) {
        // Relay returned a non-SSE JSON payload (or Gemini chunk array); extract text and parse as NDJSON/JSON
        const data = await response.json();
        const fullText = Array.isArray(data)
          ? data.map((chunk) => extractStreamTextDelta(settings.protocol, chunk)).join('')
          : extractStreamTextDelta(settings.protocol, data);
        let parsedAny = false;
        for (const line of String(fullText || '').split('\n')) {
          const entries = parseNdjsonLine(line);
          for (const entry of entries) {
            onItem(entry.idx, entry.text);
            emittedCount += 1;
            parsedAny = true;
          }
        }
        if (!parsedAny && fullText.trim()) {
          try {
            const parsed = extractJsonObject(fullText);
            for (const entry of extractNdjsonEntriesFromObject(parsed)) {
              onItem(entry.idx, entry.text);
              emittedCount += 1;
            }
          } catch (_) {}
        }
        return emittedCount;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let sseBuffer = '';
      let textBuffer = '';
      let fullAccumulatedText = '';

      const drainNdjson = (flush) => {
        const normalized = textBuffer.replace(/\r\n/g, '\n');
        const lines = normalized.split('\n');
        if (!flush) {
          textBuffer = lines.pop() || '';
        } else {
          textBuffer = '';
        }
        for (const line of lines) {
          const entries = parseNdjsonLine(line);
          for (const entry of entries) {
            onItem(entry.idx, entry.text);
            emittedCount += 1;
          }
        }
      };

      const handleSseLine = (rawLine) => {
        const line = rawLine.replace(/\r$/, '');
        if (!line || line.startsWith(':')) return;
        const trimmedStart = line.trimStart();
        if (!trimmedStart.startsWith('data:')) return;
        const dataStr = trimmedStart.slice(5).trim();
        if (!dataStr || dataStr === '[DONE]') return;

        let parsedChunk;
        try {
          parsedChunk = JSON.parse(dataStr);
        } catch (_) {
          return;
        }
        const deltaText = extractStreamTextDelta(settings.protocol, parsedChunk);
        if (deltaText) {
          textBuffer += deltaText;
          fullAccumulatedText += deltaText;
          drainNdjson(false);
        }
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          resetIdleTimeout();
          if (externalSignal?.aborted) {
            throw makeAbortError();
          }
          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || '';
          for (const line of lines) {
            handleSseLine(line);
          }
        }
      } finally {
        try {
          reader.releaseLock();
        } catch (_) {}
      }

      // Final flush
      sseBuffer += decoder.decode();
      if (sseBuffer) {
        for (const line of sseBuffer.split('\n')) {
          handleSseLine(line);
        }
      }
      drainNdjson(true);

      // Defensive fallback if model output a multi-line JSON document instead of NDJSON
      if (emittedCount === 0 && fullAccumulatedText.trim()) {
        try {
          const parsed = extractJsonObject(fullAccumulatedText);
          for (const entry of extractNdjsonEntriesFromObject(parsed)) {
            onItem(entry.idx, entry.text);
            emittedCount += 1;
          }
        } catch (_) {}
      }

      return emittedCount;
    } catch (err) {
      if (externalSignal?.aborted || err?.isExternalAbort) {
        throw makeAbortError();
      }
      lastError = err;
      if (err.name === 'AbortError' || timedOut) {
        lastError = new Error('串流請求逾時，請檢查網路或 API 服務狀態');
        lastError.noSplit = false;
      }
      if (lastError.noRetry || emittedCount > 0) {
        break;
      }
      if (attempt < maxAttempts && /timeout|逾時|network|failed to fetch|5\d\d/i.test(String(lastError.message))) {
        sleepAfterAttemptMs = 700 * attempt;
        continue;
      }
      break;
    } finally {
      if (idleTimeoutId) clearTimeout(idleTimeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
      releaseRequestSlot();
      if (sleepAfterAttemptMs > 0 && !externalSignal?.aborted) {
        await sleep(sleepAfterAttemptMs);
      }
    }
  }

  throw lastError || new Error('串流翻譯失敗');
}

async function translateItemsWithFallback(settings, items, pageContext = null, externalSignal = null) {
  if (!items || items.length === 0) return {};
  if (externalSignal?.aborted) throw makeAbortError();

  const lang = resolveTargetLanguage(settings);
  const payload = items.map((item, idx) =>
    item.kind === 'comment'
      ? { id: idx, kind: 'comment', text: item.text }
      : { id: idx, text: item.text }
  );
  const systemPrompt = buildSystemPrompt(settings, pageContext);
  const userPrompt = JSON.stringify(payload);

  try {
    const raw = await callLLMChat(
      settings,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      true,
      externalSignal
    );

    const parsed = extractJsonObject(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.translations)
        ? parsed.translations
        : Array.isArray(parsed?.data)
          ? parsed.data
          : null;

    if (!list) {
      throw new Error('JSON 中缺少 translations 陣列');
    }

    const mapped = {};
    const missing = [];
    const byId = new Map();
    for (const entry of list) {
      const rawId = entry?.id ?? entry?.i ?? entry?.index;
      const val = typeof entry?.zh === 'string'
        ? entry.zh
        : typeof entry?.t === 'string'
          ? entry.t
          : typeof entry?.translation === 'string'
            ? entry.translation
            : null;
      if (entry && rawId !== undefined && val !== null) {
        byId.set(Number(rawId), val.trim());
      }
    }

    for (let idx = 0; idx < items.length; idx++) {
      const zh = byId.get(idx);
      if (zh) {
        mapped[items[idx].key] = zh;
      } else {
        missing.push(items[idx]);
      }
    }

    if (missing.length > 0 && missing.length < items.length) {
      const rest = await translateItemsWithFallback(settings, missing, pageContext, externalSignal);
      Object.assign(mapped, rest);
    } else if (missing.length === items.length) {
      throw new Error('回傳結果未匹配任何輸入段落');
    }

    return mapped;
  } catch (err) {
    if (err?.noSplit || err?.isExternalAbort || externalSignal?.aborted) {
      throw err;
    }
    if (items.length > 1) {
      const mid = Math.ceil(items.length / 2);
      const [left, right] = await Promise.all([
        translateItemsWithFallback(settings, items.slice(0, mid), pageContext, externalSignal),
        translateItemsWithFallback(settings, items.slice(mid), pageContext, externalSignal)
      ]);
      return { ...left, ...right };
    }

    // Single item fallback: plain text prompt (more tolerant than strict JSON)
    const single = items[0];
    const singleRule = single.kind === 'comment'
      ? `You are a Python & technical translator. Translate this single-line # comment into ${lang.promptName}. Preserve the leading "# " prefix and output only the translated comment line.`
      : `You are a web & technical translator. Translate the user text into ${lang.promptName}. Strictly preserve placeholders like [[C0]], [[M0]] and output only the translation.`;
    const plain = await callLLMChat(
      settings,
      [
        {
          role: 'system',
          content: `${singleRule}\n${buildLanguageGuidance(lang)}`
        },
        { role: 'user', content: single.text }
      ],
      false,
      externalSignal
    );
    return { [single.key]: String(plain || '').trim() };
  }
}

async function handleTranslateBatch(items, pageContext = null) {
  const bid = nextBatchSeq++;
  activeBatchDebug.set(bid, {
    id: bid,
    total: items.length,
    sample: items.slice(0, 2).map((x) => String(x.text || '').slice(0, 40)),
    startedAt: Date.now(),
    stage: 'start'
  });

  const settings = await getSettings();
  if (!sanitizeApiKey(settings.apiKey) && !isLocalEndpoint(settings.baseUrl)) {
    finishBatchEvent(bid, { stage: 'no_key' });
    return {
      ok: false,
      errorCode: 'NO_API_KEY',
      error: '尚未設定大模型 API Key，請點選擴充功能圖示或前往設定頁填寫。'
    };
  }

  const sig = buildCacheSignature(settings, pageContext);
  const cacheKeys = items.map((item) => `${sig}::${item.key}`);
  const cachedMap = await CacheDB.getMany(cacheKeys);

  const results = {};
  const uncached = [];

  for (const item of items) {
    const cacheKey = `${sig}::${item.key}`;
    const cachedZh = cachedMap.get(cacheKey);
    if (typeof cachedZh === 'string' && cachedZh.trim()) {
      results[item.key] = { zh: cachedZh, cached: true };
    } else {
      uncached.push({ ...item, cacheKey });
    }
  }

  recordBatchEvent(bid, { stage: 'calling_llm', uncached: uncached.length, cached: items.length - uncached.length });
  if (uncached.length > 0) {
    try {
      const translatedMap = await translateItemsWithFallback(settings, uncached, pageContext);
      const toPersist = [];
      for (const item of uncached) {
        const zh = translatedMap[item.key];
        if (zh) {
          results[item.key] = { zh, cached: false };
          toPersist.push({ key: item.cacheKey, zh });
        }
      }
      if (toPersist.length > 0) {
        await CacheDB.putMany(toPersist);
      }
      finishBatchEvent(bid, { stage: 'done', translated: toPersist.length });
    } catch (err) {
      finishBatchEvent(bid, { stage: 'error', error: err?.message || String(err) });
      throw err;
    }
  } else {
    finishBatchEvent(bid, { stage: 'done_cached', translated: 0 });
  }

  return { ok: true, results };
}

async function handleTranslateSingle(text, mode = 'selection', pageContext = null) {
  const settings = await getSettings();
  if (!sanitizeApiKey(settings.apiKey) && !isLocalEndpoint(settings.baseUrl)) {
    return {
      ok: false,
      errorCode: 'NO_API_KEY',
      error: '尚未設定大模型 API Key，請先開啟設定頁面填寫。'
    };
  }

  const lang = resolveTargetLanguage(settings);
  const langGuide = buildLanguageGuidance(lang);
  const cleanTitle = String(pageContext?.title || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const topicHint = cleanTitle ? ` Page context: "${cleanTitle}".` : '';
  const systemContent = mode === 'output'
    ? `You are a Notebook & Python teaching assistant. The user provided code cell output (Hints, check() feedback, or a Python traceback). Translate it accurately into ${lang.promptName}, keeping code/variable names intact; if it is an error, add one concise sentence explaining the likely cause.${topicHint} ${langGuide}`
    : `You are an expert web and technical translator. Translate the selected text accurately into ${lang.promptName}, preserving technical identifiers naturally. Output only the concise translation.${topicHint} ${langGuide}`;

  const zh = await callLLMChat(
    settings,
    [
      {
        role: 'system',
        content: systemContent
      },
      { role: 'user', content: String(text || '') }
    ],
    false
  );

  return { ok: true, zh: String(zh || '').trim() };
}

async function handleTestConnection(settingsOverride) {
  const saved = await getSettings();
  const merged = { ...saved, ...(settingsOverride || {}) };
  if (!sanitizeApiKey(merged.apiKey) && !isLocalEndpoint(merged.baseUrl)) {
    return { ok: false, error: '請先填寫 API Key' };
  }

  const lang = resolveTargetLanguage(merged);
  const start = Date.now();
  const reply = await callLLMChat(
    merged,
    [
      {
        role: 'system',
        content: `Translate English to ${lang.promptName}. Output only the translation. ${buildLanguageGuidance(lang)}`
      },
      { role: 'user', content: 'Cross-validation helps prevent overfitting.' }
    ],
    false
  );
  const latencyMs = Date.now() - start;
  return { ok: true, reply: String(reply || '').trim(), latencyMs };
}

// ============================================================
// Dynamic On-Demand Injection & Seamless PDF Reader Launcher
// ============================================================

function isExtensionSender(sender) {
  if (!sender) return false;
  const extOrigin = chrome.runtime.getURL('');
  if (sender.url && sender.url.startsWith(extOrigin)) return true;
  return !sender.tab && sender.id === chrome.runtime.id;
}

async function openPdfViewer(pdfUrl, sourceTab = null) {
  const baseUrl = chrome.runtime.getURL('viewer/pdf-viewer.html');
  let cleanUrl = typeof pdfUrl === 'string' ? pdfUrl.trim() : '';
  if (cleanUrl) {
    try {
      const parsed = new URL(cleanUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'file:') {
        cleanUrl = '';
      }
    } catch (_) {
      cleanUrl = '';
    }
  }
  const targetUrl = cleanUrl ? `${baseUrl}?src=${encodeURIComponent(cleanUrl)}` : baseUrl;
  const createProps = { url: targetUrl, active: true };
  if (sourceTab && typeof sourceTab.index === 'number') {
    createProps.index = sourceTab.index + 1;
  }
  if (sourceTab && typeof sourceTab.windowId === 'number') {
    createProps.windowId = sourceTab.windowId;
  }
  await chrome.tabs.create(createProps);
}

async function ensureInjected(tabId) {
  if (typeof tabId !== 'number') {
    throw new Error('無效的分頁 ID');
  }

  // Probe frames for initialization status and extensionless PDF content-type detection
  let uninjectedFrameIds = null;
  try {
    const probeResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => ({
        initialized: Boolean(globalThis.__KCT_INITIALIZED__),
        isPdf: document.contentType === 'application/pdf'
      })
    });
    if (Array.isArray(probeResults) && probeResults.length > 0) {
      const topFrameProbe = probeResults.find((r) => r.frameId === 0);
      if (topFrameProbe?.result?.isPdf) {
        return { isPdf: true };
      }
      uninjectedFrameIds = probeResults
        .filter((r) => !r.result?.initialized && typeof r.frameId === 'number')
        .map((r) => r.frameId);
      if (uninjectedFrameIds.length === 0) {
        return { isPdf: false }; // All accessible frames are already injected
      }
    }
  } catch (_) {
    uninjectedFrameIds = null;
  }

  const target = uninjectedFrameIds ? { tabId, frameIds: uninjectedFrameIds } : { tabId, allFrames: true };

  // Inject CSS only into frames not yet initialized; fall back to top frame if a restricted subframe rejects
  try {
    await chrome.scripting.insertCSS({
      target,
      files: CONTENT_CSS_FILES
    });
  } catch (_) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId, allFrames: false },
        files: CONTENT_CSS_FILES
      });
    } catch (cssErr) {
      console.warn('[KCT] insertCSS failed:', cssErr?.message);
    }
  }

  // Inject content scripts in strict dependency order
  try {
    await chrome.scripting.executeScript({
      target,
      files: CONTENT_JS_FILES
    });
  } catch (_) {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: CONTENT_JS_FILES
    });
  }

  return { isPdf: false };
}

async function injectAndCommandTab(tabId, action, payload = null) {
  const tab = await chrome.tabs.get(tabId);
  if (isPdfUrl(tab?.url)) {
    if (action === 'CLEAR_PAGE') {
      return { ok: true };
    }
    await openPdfViewer(tab.url, tab);
    return { ok: true, openedPdfViewer: true };
  }
  if (!isInjectableUrl(tab?.url)) {
    return {
      ok: false,
      errorCode: 'UNSUPPORTED_URL',
      error: '此頁面不支援翻譯（僅支援一般 http/https 網頁或 PDF 文件）'
    };
  }
  // Never inject scripts onto an untouched tab just to run CLEAR_PAGE
  if (action === 'CLEAR_PAGE') {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'KCT_COMMAND',
        action: 'CLEAR_PAGE'
      });
    } catch (_) {
      // Tab had no injected content script; already clean
    }
    return { ok: true };
  }
  const inj = await ensureInjected(tabId);
  if (inj?.isPdf) {
    await openPdfViewer(tab.url, tab);
    return { ok: true, openedPdfViewer: true };
  }
  try {
    const resp = await chrome.tabs.sendMessage(tabId, {
      type: 'KCT_COMMAND',
      action,
      ...(payload && typeof payload === 'object' ? payload : {})
    });
    return { ok: true, ...(resp && typeof resp === 'object' ? { data: resp } : {}) };
  } catch (err) {
    // Content script may have just initialized or navigated; report clearly
    return {
      ok: false,
      error: err?.message || '無法傳送指令至頁面'
    };
  }
}

// ============================================================
// Lifecycle, Context Menus, Keyboard Shortcuts & Auto-Whitelist
// ============================================================

function setupContextMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      chrome.contextMenus.create(
        {
          id: 'kct-translate-page',
          title: '翻譯此頁面（NativeRead）',
          contexts: ['page', 'frame']
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
      chrome.contextMenus.create(
        {
          id: 'kct-translate-selection',
          title: 'NativeRead 翻譯選取文字：「%s」',
          contexts: ['selection']
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    });
  } catch (err) {
    console.warn('[KCT] setupContextMenus error:', err?.message);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
  CacheDB.migrateFromLegacyStorage().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
  CacheDB.migrateFromLegacyStorage().catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  try {
    if (info.menuItemId === 'kct-translate-page') {
      if (isPdfUrl(tab.url)) {
        await openPdfViewer(tab.url, tab);
        return;
      }
      if (!isInjectableUrl(tab.url)) return;
      const inj = await ensureInjected(tab.id);
      if (inj?.isPdf) {
        await openPdfViewer(tab.url, tab);
        return;
      }
      await chrome.tabs.sendMessage(tab.id, {
        type: 'KCT_COMMAND',
        action: 'TRANSLATE_NOW'
      });
    } else if (info.menuItemId === 'kct-translate-selection') {
      if (!isInjectableUrl(tab.url)) return;
      const inj = await ensureInjected(tab.id);
      if (inj?.isPdf) {
        await openPdfViewer(tab.url, tab);
        return;
      }
      const sendOpts = typeof info.frameId === 'number' ? { frameId: info.frameId } : undefined;
      await chrome.tabs.sendMessage(
        tab.id,
        {
          type: 'KCT_COMMAND',
          action: 'TRANSLATE_SELECTION',
          selectionText: info.selectionText || ''
        },
        sendOpts
      );
    }
  } catch (err) {
    console.warn('[KCT] contextMenus action failed:', err?.message);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-translate-page') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    if (isPdfUrl(tab.url)) {
      await openPdfViewer(tab.url, tab);
      return;
    }
    if (!isInjectableUrl(tab.url)) return;
    const inj = await ensureInjected(tab.id);
    if (inj?.isPdf) {
      await openPdfViewer(tab.url, tab);
      return;
    }
    await chrome.tabs.sendMessage(tab.id, {
      type: 'KCT_COMMAND',
      action: 'TOGGLE_OR_TRANSLATE'
    });
  } catch (err) {
    console.warn('[KCT] command toggle-translate-page failed:', err?.message);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !isInjectableUrl(tab?.url) || isPdfUrl(tab?.url)) return;
  try {
    const settings = await getSettings();
    if (!settings.enabled) return;
    let host = '';
    try {
      host = new URL(tab.url).hostname;
    } catch (_) {
      return;
    }
    if (settings.autoTranslate || isHostWhitelisted(host, settings)) {
      const inj = await ensureInjected(tabId);
      if (inj?.isPdf) return;
      await chrome.tabs.sendMessage(tabId, {
        type: 'KCT_COMMAND',
        action: 'TRANSLATE_NOW',
        trigger: 'auto'
      });
    }
  } catch (_) {
    // Tab may have navigated away or closed
  }
});

// ============================================================
// SSE Streaming Port ('kct-stream')
// ============================================================

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'kct-stream') return;

  let portDisconnected = false;
  const activeControllers = new Map();

  const safePost = (msg) => {
    if (portDisconnected) return false;
    try {
      port.postMessage(msg);
      return true;
    } catch (_) {
      portDisconnected = true;
      return false;
    }
  };

  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    portDisconnected = true;
    for (const ctrl of activeControllers.values()) {
      try {
        ctrl.abort();
      } catch (_) {}
    }
    activeControllers.clear();
  });

  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'CANCEL_STREAM' && msg.requestId) {
      const ctrl = activeControllers.get(msg.requestId);
      if (ctrl) {
        try {
          ctrl.abort();
        } catch (_) {}
        activeControllers.delete(msg.requestId);
      }
      return;
    }

    if (msg.type !== 'TRANSLATE_STREAM') return;

    (async () => {
      const requestId = msg.requestId || `req_${Date.now()}`;
      const items = Array.isArray(msg.items) ? msg.items : [];
      const pageContext = msg.pageContext || null;

      if (items.length === 0) {
        safePost({ type: 'DONE', requestId, translatedCount: 0 });
        return;
      }

      const bid = nextBatchSeq++;
      activeBatchDebug.set(bid, {
        id: bid,
        mode: 'stream',
        total: items.length,
        sample: items.slice(0, 2).map((x) => String(x.text || '').slice(0, 40)),
        startedAt: Date.now(),
        stage: 'start'
      });

      const controller = new AbortController();
      activeControllers.set(requestId, controller);
      const toPersist = [];
      let translatedCount = 0;

      try {
        const settings = await getSettings();
        if (!sanitizeApiKey(settings.apiKey) && !isLocalEndpoint(settings.baseUrl)) {
          finishBatchEvent(bid, { stage: 'no_key' });
          safePost({
            type: 'ERROR',
            requestId,
            errorCode: 'NO_API_KEY',
            error: '尚未設定大模型 API Key，請點選擴充功能圖示或前往設定頁填寫。'
          });
          return;
        }

        const sig = buildCacheSignature(settings, pageContext);
        const cacheKeys = items.map((item) => `${sig}::${item.key}`);
        const cachedMap = await CacheDB.getMany(cacheKeys);

        if (portDisconnected || controller.signal.aborted) {
          finishBatchEvent(bid, { stage: 'aborted' });
          return;
        }

        const uncached = [];
        for (const item of items) {
          const cacheKey = `${sig}::${item.key}`;
          const cachedZh = cachedMap.get(cacheKey);
          if (typeof cachedZh === 'string' && cachedZh.trim()) {
            translatedCount += 1;
            safePost({
              type: 'ITEM',
              requestId,
              key: item.key,
              zh: cachedZh,
              cached: true
            });
          } else {
            uncached.push({ ...item, cacheKey });
          }
        }

        if (uncached.length === 0) {
          finishBatchEvent(bid, { stage: 'done_cached', translated: 0 });
          safePost({ type: 'DONE', requestId, translatedCount });
          return;
        }

        recordBatchEvent(bid, {
          stage: 'streaming_llm',
          uncached: uncached.length,
          cached: items.length - uncached.length
        });

        const emittedKeys = new Set();
        const emitItem = (item, text) => {
          const cleanZh = String(text || '').trim();
          if (!cleanZh || emittedKeys.has(item.key)) return;
          emittedKeys.add(item.key);
          translatedCount += 1;
          toPersist.push({ key: item.cacheKey, zh: cleanZh });
          safePost({
            type: 'ITEM',
            requestId,
            key: item.key,
            zh: cleanZh,
            cached: false
          });
        };

        if (settings.streamTranslation !== false) {
          try {
            await streamTranslateItems(
              settings,
              uncached,
              pageContext,
              (idx, text) => {
                const target = uncached[idx];
                if (target) {
                  emitItem(target, text);
                }
              },
              controller.signal
            );
          } catch (streamErr) {
            if (portDisconnected || controller.signal.aborted || streamErr?.isExternalAbort) {
              finishBatchEvent(bid, { stage: 'aborted' });
              return;
            }
            const isFatal =
              streamErr?.httpStatus === 401 ||
              streamErr?.httpStatus === 403 ||
              streamErr?.httpStatus === 404 ||
              streamErr?.httpStatus === 429 ||
              streamErr?.noSplit === true;
            if (isFatal) {
              throw streamErr;
            }
            console.warn('[KCT] SSE stream failed, falling back to batch JSON:', streamErr?.message);
          }
        }

        // Fallback for any missed items (or when streamTranslation is disabled)
        const remaining = uncached.filter((it) => !emittedKeys.has(it.key));
        if (remaining.length > 0 && !portDisconnected && !controller.signal.aborted) {
          recordBatchEvent(bid, { stage: 'fallback_batch', remaining: remaining.length });
          const fallbackMap = await translateItemsWithFallback(
            settings,
            remaining,
            pageContext,
            controller.signal
          );
          for (const item of remaining) {
            const zh = fallbackMap[item.key];
            if (zh) {
              emitItem(item, zh);
            }
          }
        }

        if (toPersist.length > 0) {
          await CacheDB.putMany(toPersist);
        }
        finishBatchEvent(bid, { stage: 'done', translated: toPersist.length });
        safePost({ type: 'DONE', requestId, translatedCount });
      } catch (err) {
        if (toPersist.length > 0) {
          CacheDB.putMany(toPersist).catch(() => {});
        }
        if (portDisconnected || controller.signal.aborted || err?.isExternalAbort) {
          finishBatchEvent(bid, { stage: 'aborted' });
          return;
        }
        finishBatchEvent(bid, { stage: 'error', error: err?.message || String(err) });
        safePost({
          type: 'ERROR',
          requestId,
          error: err?.message || '串流翻譯失敗',
          errorCode: err?.errorCode || (err?.httpStatus ? `HTTP_${err.httpStatus}` : 'STREAM_ERROR')
        });
      } finally {
        activeControllers.delete(requestId);
      }
    })();
  });
});

// ============================================================
// Runtime Message Router
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'ENSURE_AND_COMMAND': {
          if (!isExtensionSender(sender)) {
            sendResponse({ ok: false, error: '拒絕未授權來源呼叫' });
            break;
          }
          const tabId = typeof message.tabId === 'number' ? message.tabId : sender?.tab?.id;
          if (typeof tabId !== 'number') {
            sendResponse({ ok: false, error: '找不到目標分頁' });
            break;
          }
          const res = await injectAndCommandTab(tabId, message.action, message.payload || null);
          sendResponse(res);
          break;
        }
        case 'TRANSLATE_BATCH': {
          const res = await handleTranslateBatch(message.items || [], message.pageContext || null);
          sendResponse(res);
          break;
        }
        case 'TRANSLATE_SINGLE': {
          const res = await handleTranslateSingle(
            message.text || '',
            message.mode || 'selection',
            message.pageContext || null
          );
          sendResponse(res);
          break;
        }
        case 'FRAME_STATUS': {
          const tabId = sender?.tab?.id;
          if (tabId) {
            try {
              await chrome.tabs.sendMessage(
                tabId,
                {
                  type: 'KCT_FRAME_STATUS',
                  frameId: sender.frameId ?? -1,
                  stats: message.stats
                },
                { frameId: 0 }
              );
            } catch (_) {
              // Top frame might not be ready yet
            }
          }
          sendResponse({ ok: true });
          break;
        }
        case 'TEST_CONNECTION': {
          if (!isExtensionSender(sender)) {
            sendResponse({ ok: false, error: '拒絕未授權來源呼叫' });
            break;
          }
          const res = await handleTestConnection(message.settings);
          sendResponse(res);
          break;
        }
        case 'OPEN_OPTIONS': {
          await chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          break;
        }
        case 'OPEN_PDF_VIEWER': {
          if (!isExtensionSender(sender)) {
            sendResponse({ ok: false, error: '拒絕未授權來源呼叫' });
            break;
          }
          let sourceTab = sender?.tab || null;
          if (!sourceTab && typeof message.tabId === 'number') {
            try {
              sourceTab = await chrome.tabs.get(message.tabId);
            } catch (_) {}
          }
          const pdfUrl = typeof message.url === 'string' && message.url.trim() ? message.url.trim() : '';
          await openPdfViewer(pdfUrl, sourceTab);
          sendResponse({ ok: true });
          break;
        }
        case 'GET_CACHE_STATS': {
          const { entries, bytes } = await CacheDB.stats();
          sendResponse({ ok: true, entries, bytes });
          break;
        }
        case 'GET_SW_DEBUG': {
          if (!isExtensionSender(sender)) {
            sendResponse({ ok: false, error: '拒絕未授權來源呼叫' });
            break;
          }
          sendResponse({
            ok: true,
            now: Date.now(),
            active: Array.from(activeBatchDebug.values()),
            recent: recentBatchDebug
          });
          break;
        }
        case 'CLEAR_CACHE': {
          if (!isExtensionSender(sender)) {
            sendResponse({ ok: false, error: '拒絕未授權來源呼叫' });
            break;
          }
          await CacheDB.clear();
          sendResponse({ ok: true });
          break;
        }
        case 'BROADCAST_TO_TAB': {
          const tabId = isExtensionSender(sender)
            ? (message.tabId || sender?.tab?.id)
            : sender?.tab?.id;
          if (tabId) {
            try {
              await chrome.tabs.sendMessage(tabId, message.payload);
            } catch (err) {
              console.warn('Broadcast to tab failed:', err.message);
            }
          }
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({
        ok: false,
        error: err?.message || '未知錯誤',
        errorCode: err?.errorCode || (err?.httpStatus ? `HTTP_${err.httpStatus}` : undefined)
      });
    }
  })();
  return true;
});
