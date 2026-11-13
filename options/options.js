const {
  PROVIDER_PRESETS,
  TARGET_LANGUAGES,
  DEFAULT_GLOSSARY,
  getSettings,
  saveSettings,
  resolveEndpoint
} = globalThis.KCTConfig;

function readFormValues() {
  return {
    targetLang: document.getElementById('lang-select').value,
    customTargetLang: document.getElementById('custom-lang-input').value.trim(),
    displayMode: document.getElementById('mode-select').value,
    translateCodeComments: document.getElementById('translate-code-comments').checked,
    providerId: document.getElementById('provider-select').value,
    protocol: document.getElementById('protocol-select').value,
    baseUrl: document.getElementById('baseurl-input').value.trim(),
    apiKey: document.getElementById('apikey-input').value.trim(),
    model: document.getElementById('model-input').value.trim(),
    batchSize: Math.min(20, Math.max(1, Number(document.getElementById('batch-size').value) || 8)),
    temperature: Math.min(1, Math.max(0, Number(document.getElementById('temperature-input').value) || 0.2)),
    customGlossary: document.getElementById('glossary-input').value
  };
}

function updateEndpointPreview() {
  const form = readFormValues();
  const resolved = resolveEndpoint(form);
  document.getElementById('endpoint-preview').textContent = resolved || '（未填寫）';
}

function updateCustomLangVisibility() {
  const isCustom = document.getElementById('lang-select').value === 'custom';
  document.getElementById('custom-lang-wrap').classList.toggle('hidden', !isCustom);
}

function updateModelSuggestions(preset) {
  const datalist = document.getElementById('model-suggestions');
  if (!datalist) return;
  datalist.textContent = '';
  const models = Array.isArray(preset?.suggestedModels) && preset.suggestedModels.length
    ? preset.suggestedModels
    : (preset?.defaultModel ? [preset.defaultModel] : []);
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m;
    datalist.appendChild(opt);
  }
}

function applyPreset(presetId) {
  const preset = PROVIDER_PRESETS[presetId];
  if (!preset) return;
  document.getElementById('protocol-select').value = preset.protocol;
  document.getElementById('baseurl-input').value = preset.baseUrl;
  document.getElementById('model-input').value = preset.defaultModel;
  document.getElementById('apikey-input').placeholder = preset.placeholderKey;
  document.getElementById('provider-hint').textContent = preset.hint;
  updateModelSuggestions(preset);
  updateEndpointPreview();
}

async function ensureHostPermissionIfNeeded(baseUrl) {
  let originPattern = null;
  try {
    const u = new URL(baseUrl);
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      originPattern = `${u.origin}/*`;
    }
  } catch (_) {
    return;
  }
  if (!originPattern) return;

  try {
    const already = await chrome.permissions.contains({ origins: [originPattern] });
    if (!already) {
      await chrome.permissions.request({ origins: [originPattern] });
    }
  } catch (err) {
    console.warn('Permission request skipped/denied:', err.message);
  }
}

async function refreshCacheStats() {
  const statsEl = document.getElementById('cache-stats');
  const res = await chrome.runtime.sendMessage({ type: 'GET_CACHE_STATS' });
  if (res?.ok) {
    const kb = (res.bytes / 1024).toFixed(1);
    statsEl.textContent = `目前已快取 ${res.entries} 筆段落／註解譯文（約 ${kb} KB）`;
  } else {
    statsEl.textContent = '無法讀取快取狀態';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const langSelect = document.getElementById('lang-select');
  for (const lang of Object.values(TARGET_LANGUAGES)) {
    const opt = document.createElement('option');
    opt.value = lang.id;
    opt.textContent = lang.label;
    langSelect.appendChild(opt);
  }

  const providerSelect = document.getElementById('provider-select');
  for (const preset of Object.values(PROVIDER_PRESETS)) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = preset.label;
    providerSelect.appendChild(opt);
  }

  const settings = await getSettings();
  langSelect.value = settings.targetLang || 'zh-TW';
  document.getElementById('custom-lang-input').value = settings.customTargetLang || '';
  document.getElementById('mode-select').value = settings.displayMode || 'replace';
  document.getElementById('translate-code-comments').checked = settings.translateCodeComments !== false;
  updateCustomLangVisibility();

  providerSelect.value = settings.providerId || 'deepseek';
  document.getElementById('protocol-select').value = settings.protocol || 'openai';
  document.getElementById('baseurl-input').value = settings.baseUrl || '';
  document.getElementById('apikey-input').value = settings.apiKey || '';
  document.getElementById('model-input').value = settings.model || '';
  document.getElementById('batch-size').value = settings.batchSize ?? 8;
  document.getElementById('temperature-input').value = settings.temperature ?? 0.2;
  document.getElementById('glossary-input').value = settings.customGlossary ?? DEFAULT_GLOSSARY;

  const activePreset = PROVIDER_PRESETS[providerSelect.value];
  if (activePreset) {
    document.getElementById('provider-hint').textContent = activePreset.hint;
    document.getElementById('apikey-input').placeholder = activePreset.placeholderKey;
    updateModelSuggestions(activePreset);
  }
  updateEndpointPreview();
  await refreshCacheStats();

  langSelect.addEventListener('change', updateCustomLangVisibility);

  providerSelect.addEventListener('change', (e) => {
    applyPreset(e.target.value);
  });

  document.getElementById('protocol-select').addEventListener('change', updateEndpointPreview);
  document.getElementById('baseurl-input').addEventListener('input', updateEndpointPreview);
  document.getElementById('model-input').addEventListener('input', updateEndpointPreview);

  document.getElementById('btn-toggle-key').addEventListener('click', (e) => {
    const input = document.getElementById('apikey-input');
    const isPwd = input.type === 'password';
    input.type = isPwd ? 'text' : 'password';
    e.target.textContent = isPwd ? '隱藏' : '顯示';
  });

  document.getElementById('btn-reset-glossary').addEventListener('click', () => {
    document.getElementById('glossary-input').value = DEFAULT_GLOSSARY;
  });

  async function handleSave(statusElId) {
    const form = readFormValues();
    const statusEl = document.getElementById(statusElId);
    statusEl.className = 'inline-status';
    statusEl.textContent = '儲存中...';

    await ensureHostPermissionIfNeeded(form.baseUrl);
    await saveSettings(form);

    statusEl.className = 'inline-status ok';
    statusEl.textContent = '✓ 設定已儲存';
    setTimeout(() => { statusEl.textContent = ''; }, 2500);
  }

  document.getElementById('btn-save').addEventListener('click', async () => {
    await handleSave('save-status');
  });

  document.getElementById('btn-save-bottom').addEventListener('click', async () => {
    await handleSave('save-status-bottom');
  });

  document.getElementById('btn-test').addEventListener('click', async () => {
    const form = readFormValues();
    const box = document.getElementById('test-result');
    box.className = 'test-box';
    box.textContent = '正在測試連線...';

    await ensureHostPermissionIfNeeded(form.baseUrl);
    const res = await chrome.runtime.sendMessage({
      type: 'TEST_CONNECTION',
      settings: form
    });

    if (res?.ok) {
      box.className = 'test-box ok';
      box.textContent = `連線成功 (${res.latencyMs} ms) · 範例譯文：${res.reply}`;
    } else {
      box.className = 'test-box err';
      box.textContent = `連線失敗：${res?.error || '未知錯誤'}`;
    }
  });

  document.getElementById('btn-clear-cache').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
    await refreshCacheStats();
  });
});
