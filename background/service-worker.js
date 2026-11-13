importScripts('../shared/config.js');

const {
  CACHE_KEY,
  getSettings,
  resolveEndpoint,
  resolveTargetLanguage,
  sanitizeApiKey
} = globalThis.KCTConfig;

const MAX_CACHE_ENTRIES = 4000;
let cacheMutex = Promise.resolve();
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

function runWithCacheLock(task) {
  const execute = async () => {
    try {
      await cacheMutex;
    } catch (_) {
      // Ignore prior failed task in mutex chain
    }
    return await task();
  };
  const promise = execute();
  cacheMutex = promise;
  return promise;
}

function isLocalEndpoint(baseUrl) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(String(baseUrl || '').trim());
}

function buildCacheSignature(settings) {
  const lang = resolveTargetLanguage(settings);
  return `${settings.protocol}:${settings.model}:${lang.id}:${lang.promptName}`;
}

async function readCacheMap() {
  const data = await chrome.storage.local.get(CACHE_KEY);
  const raw = data[CACHE_KEY];
  return raw && typeof raw === 'object' ? raw : {};
}

async function writeCacheEntries(entries) {
  if (!entries || entries.length === 0) return;
  await runWithCacheLock(async () => {
    const cache = await readCacheMap();
    const now = Date.now();
    for (const { cacheKey, zh } of entries) {
      if (typeof zh === 'string' && zh.trim()) {
        // Delete and re-insert to keep recent entries at the end (simple LRU)
        delete cache[cacheKey];
        cache[cacheKey] = { zh, t: now };
      }
    }
    const keys = Object.keys(cache);
    if (keys.length > MAX_CACHE_ENTRIES) {
      const overflow = keys.length - MAX_CACHE_ENTRIES;
      for (let i = 0; i < overflow; i++) {
        delete cache[keys[i]];
      }
    }
    await chrome.storage.local.set({ [CACHE_KEY]: cache });
  });
}

function buildLanguageGuidance(lang) {
  if (lang.id === 'zh-TW') {
    return [
      '目標語言：繁體中文（台灣慣用語與台灣繁體字形）。',
      '用語規範：請使用自然道地的台灣資訊與機器學習用語（例如：資料、欄位、函式、參數、迴圈、模型、特徵、驗證集、過度擬合、管線、程式碼、執行、錯誤訊息），切勿混用簡體字或中國大陸慣用語（如「数据、函数、过拟合、循环、代码、报错」）。'
    ].join('\n');
  }
  if (lang.id === 'zh-CN') {
    return '目标语言：简体中文（自然流利的中国大陆技术与机器学习表达）。';
  }
  return `Target language: ${lang.promptName}. Translate accurately using natural, idiomatic technical phrasing in that language.`;
}

function buildSystemPrompt(settings) {
  const lang = resolveTargetLanguage(settings);
  const glossary = String(settings.customGlossary || '').trim();
  const glossarySection = (lang.id === 'zh-TW' || lang.id === 'zh-CN') && glossary
    ? `\n參考術語表（若語意符合請優先採用一致譯法）：\n${glossary}\n`
    : '';

  return [
    'You are an expert technical translator specializing in Machine Learning, Data Science, Python, and Kaggle courses/notebooks.',
    buildLanguageGuidance(lang),
    'Task: Translate the English texts inside the user JSON array accurately and naturally while preserving formatting clarity.',
    'Strict Rules:',
    '1. Keep ALL placeholders formatted like [[C0]], [[C1]], [[M0]] completely unchanged in the appropriate grammatical position of the target language. Never translate, remove, alter, or split bracket placeholders.',
    '2. Keep Python identifiers, function/class/library names (e.g. pandas, scikit-learn, XGBoost, DataFrame, train_test_split) and standard abbreviations (MAE, RMSE, AUC, CV, SQL) intact.',
    '3. If an input item has `"kind":"comment"`, it is a single-line Python `#` comment inside code. Keep the leading `# ` prefix (matching the original `# ` style) and output only a concise, natural translation of the comment text—do not add quotes, markdown, or extra code.',
    '4. Return ONLY a valid JSON object strictly matching: {"translations":[{"id":0,"zh":"..."},...]} with identical ids and count as the input array. No extra commentary or markdown fences.',
    glossarySection
  ].join('\n');
}

function extractJsonObject(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) throw new Error('模型返回内容为空');

  // Strip ```json ... ``` fences if present
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch (_) {
    // Try extracting the outermost JSON object or array
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

async function callLLMChat(settings, messages, expectJson = true) {
  const endpoint = resolveEndpoint(settings);
  if (!endpoint) {
    throw new Error('API 地址无效，请检查设置中的 Base URL');
  }

  const maxAttempts = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
      let response;
      if (settings.protocol === 'gemini') {
        const systemMsg = messages.find((m) => m.role === 'system');
        const userMsgs = messages.filter((m) => m.role !== 'system');
        const body = {
          contents: userMsgs.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          generationConfig: {
            temperature: Number(settings.temperature ?? 0.2)
          }
        };
        if (systemMsg) {
          body.systemInstruction = { parts: [{ text: systemMsg.content }] };
        }
        if (expectJson) {
          body.generationConfig.responseMimeType = 'application/json';
        }
        const url = new URL(endpoint);
        const cleanKey = sanitizeApiKey(settings.apiKey);
        if (cleanKey) {
          url.searchParams.set('key', cleanKey);
        }
        response = await fetch(url.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } else {
        const headers = { 'Content-Type': 'application/json' };
        const cleanKey = sanitizeApiKey(settings.apiKey);
        if (cleanKey) {
          headers['Authorization'] = `Bearer ${cleanKey}`;
        }
        const body = {
          model: String(settings.model || '').trim(),
          messages,
          temperature: Number(settings.temperature ?? 0.2)
        };
        if (expectJson) {
          body.response_format = { type: 'json_object' };
        }
        response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });

        // Some OpenAI-compatible relays reject response_format
        if (!response.ok && expectJson && response.status === 400) {
          const errText = await response.text();
          if (/response_format|json_object/i.test(errText)) {
            delete body.response_format;
            response = await fetch(endpoint, {
              method: 'POST',
              headers,
              body: JSON.stringify(body),
              signal: controller.signal
            });
          } else {
            throw new Error(`HTTP 400: ${errText.slice(0, 260)}`);
          }
        }
      }

      if (!response.ok) {
        const errBody = await response.text();
        const status = response.status;
        if ((status === 429 || status >= 500) && attempt < maxAttempts) {
          await sleep(800 * attempt * attempt);
          continue;
        }
        throw new Error(`HTTP ${status}: ${errBody.slice(0, 280) || response.statusText}`);
      }

      const data = await response.json();
      if (settings.protocol === 'gemini') {
        const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        if (!text) {
          throw new Error(data?.error?.message || 'Gemini 未返回文本内容');
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
      lastError = err;
      if (err.name === 'AbortError') {
        lastError = new Error('請求逾時 (25s)，請檢查網路或 API 服務狀態');
      }
      if (attempt < maxAttempts && /timeout|network|failed to fetch|429|5\d\d/i.test(String(lastError.message))) {
        await sleep(700 * attempt);
        continue;
      }
      break;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error('翻译请求失败');
}

async function translateItemsWithFallback(settings, items) {
  if (!items || items.length === 0) return {};

  const lang = resolveTargetLanguage(settings);
  const payload = items.map((item, idx) =>
    item.kind === 'comment'
      ? { id: idx, kind: 'comment', text: item.text }
      : { id: idx, text: item.text }
  );
  const systemPrompt = buildSystemPrompt(settings);
  const userPrompt = JSON.stringify(payload);

  try {
    const raw = await callLLMChat(
      settings,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      true
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
      const val = typeof entry?.zh === 'string'
        ? entry.zh
        : typeof entry?.translation === 'string'
          ? entry.translation
          : null;
      if (entry && entry.id !== undefined && val !== null) {
        byId.set(Number(entry.id), val.trim());
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
      const rest = await translateItemsWithFallback(settings, missing);
      Object.assign(mapped, rest);
    } else if (missing.length === items.length) {
      throw new Error('回傳結果未匹配任何輸入段落');
    }

    return mapped;
  } catch (err) {
    if (items.length > 1) {
      const mid = Math.ceil(items.length / 2);
      const [left, right] = await Promise.all([
        translateItemsWithFallback(settings, items.slice(0, mid)),
        translateItemsWithFallback(settings, items.slice(mid))
      ]);
      return { ...left, ...right };
    }

    // Single item fallback: plain text prompt (more tolerant than strict JSON)
    const single = items[0];
    const singleRule = single.kind === 'comment'
      ? `You are a Kaggle & Python technical translator. Translate this single-line Python # comment into ${lang.promptName}. Preserve the leading "# " prefix and output only the translated comment line.`
      : `You are a Kaggle & Machine Learning technical translator. Translate the user text into ${lang.promptName}. Strictly preserve placeholders like [[C0]], [[M0]] and output only the translation.`;
    const plain = await callLLMChat(
      settings,
      [
        {
          role: 'system',
          content: `${singleRule}\n${buildLanguageGuidance(lang)}`
        },
        { role: 'user', content: single.text }
      ],
      false
    );
    return { [single.key]: String(plain || '').trim() };
  }
}

async function handleTranslateBatch(items) {
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

  const sig = buildCacheSignature(settings);
  const cache = await readCacheMap();
  const results = {};
  const uncached = [];

  for (const item of items) {
    const cacheKey = `${sig}::${item.key}`;
    if (cache[cacheKey] && typeof cache[cacheKey].zh === 'string') {
      results[item.key] = { zh: cache[cacheKey].zh, cached: true };
    } else {
      uncached.push({ ...item, cacheKey });
    }
  }

  recordBatchEvent(bid, { stage: 'calling_llm', uncached: uncached.length, cached: items.length - uncached.length });
  if (uncached.length > 0) {
    try {
      const translatedMap = await translateItemsWithFallback(settings, uncached);
      const toPersist = [];
      for (const item of uncached) {
        const zh = translatedMap[item.key];
        if (zh) {
          results[item.key] = { zh, cached: false };
          toPersist.push({ cacheKey: item.cacheKey, zh });
        }
      }
      await writeCacheEntries(toPersist);
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

async function handleTranslateSingle(text, mode = 'selection') {
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
  const systemContent = mode === 'output'
    ? `You are a Kaggle & Python teaching assistant. The user provided Notebook code cell output (Hints, check() feedback, or a Python traceback). Translate it accurately into ${lang.promptName}, keeping code/variable names intact; if it is an error, add one concise sentence explaining the likely cause. ${langGuide}`
    : `You are an expert Python, Machine Learning, and Kaggle teaching assistant. Translate the selected English text accurately into ${lang.promptName}, preserving technical identifiers naturally. Output only the concise translation. ${langGuide}`;

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'TRANSLATE_BATCH': {
          const res = await handleTranslateBatch(message.items || []);
          sendResponse(res);
          break;
        }
        case 'TRANSLATE_SINGLE': {
          const res = await handleTranslateSingle(message.text || '', message.mode || 'selection');
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
          const res = await handleTestConnection(message.settings);
          sendResponse(res);
          break;
        }
        case 'OPEN_OPTIONS': {
          await chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          break;
        }
        case 'GET_CACHE_STATS': {
          const cache = await readCacheMap();
          const entries = Object.keys(cache).length;
          const bytes = JSON.stringify(cache).length;
          sendResponse({ ok: true, entries, bytes });
          break;
        }
        case 'GET_SW_DEBUG': {
          sendResponse({
            ok: true,
            now: Date.now(),
            active: Array.from(activeBatchDebug.values()),
            recent: recentBatchDebug
          });
          break;
        }
        case 'CLEAR_CACHE': {
          await runWithCacheLock(async () => {
            await chrome.storage.local.remove(CACHE_KEY);
          });
          sendResponse({ ok: true });
          break;
        }
        case 'BROADCAST_TO_TAB': {
          const tabId = message.tabId || sender?.tab?.id;
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
        error: err?.message || '未知错误'
      });
    }
  })();
  return true;
});
