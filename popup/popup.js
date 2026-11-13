const { TARGET_LANGUAGES, getSettings, saveSettings } = globalThis.KCTConfig;

function isKaggleTab(url) {
  if (!url) return false;
  return /^https:\/\/([a-z0-9-]+\.)?(kaggle\.com|kaggle\.net|kaggleusercontent\.com)\//i.test(url);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

let currentSettings = null;

async function sendCommandToActiveTab(action) {
  const statusEl = document.getElementById('status-text');
  const tab = await getActiveTab();
  if (!tab || !isKaggleTab(tab.url)) {
    statusEl.textContent = '請先開啟 Kaggle 頁面';
    return;
  }
  if ((action === 'TRANSLATE_NOW' || action === 'RETRANSLATE') && currentSettings && !currentSettings.enabled) {
    currentSettings = await saveSettings({ enabled: true });
    renderUI(currentSettings);
  }
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'KCT_COMMAND',
      action
    });
    if (action === 'CLEAR_PAGE') {
      statusEl.textContent = '已還原原文';
      return;
    }
    statusEl.textContent = '已發送翻譯指令，掃描中...';
    setTimeout(async () => {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'KCT_GET_STATUS' }, { frameId: 0 });
        if (!res?.ok) return;
        if (res.lastErrorMsg) {
          statusEl.textContent = res.lastErrorMsg;
        } else if (res.isBusy) {
          statusEl.textContent = `翻譯中 ${res.totalTranslated}/${res.totalDetected}`;
        } else if (res.totalTranslated > 0) {
          statusEl.textContent = `已譯 ${res.totalTranslated} 項`;
        } else if (res.totalDetected === 0 && currentSettings?.scope === 'course') {
          statusEl.textContent = '未偵測到課程本文（可試「整頁可讀文字」）';
        } else {
          statusEl.textContent = '目前頁面無新增可譯段落';
        }
      } catch (_) {}
    }, 220);
  } catch (_) {
    statusEl.textContent = '請重新整理目前 Kaggle 頁面後重試';
  }
}

function renderUI(settings) {
  document.getElementById('toggle-enabled').checked = Boolean(settings.enabled);
  document.getElementById('toggle-code-comments').checked = settings.translateCodeComments !== false;
  document.getElementById('toggle-auto').checked = Boolean(settings.autoTranslate);
  document.getElementById('toggle-selection').checked = Boolean(settings.selectionTranslate);
  document.getElementById('toggle-output-btn').checked = settings.showOutputTranslateBtn !== false;
  document.getElementById('toggle-ball').checked = settings.showFloatingBall !== false;

  const langSel = document.getElementById('lang-select');
  langSel.value = settings.targetLang || 'zh-TW';
  const customInput = document.getElementById('custom-lang-input');
  customInput.value = settings.customTargetLang || '';
  customInput.classList.toggle('hidden', langSel.value !== 'custom');

  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(settings.baseUrl || '');
  const hasKey = Boolean(settings.apiKey?.trim()) || isLocal;
  document.getElementById('api-alert').classList.toggle('hidden', hasKey);
  document.getElementById('model-badge').textContent = `${settings.model || '未選擇模型'}`;

  for (const btn of document.querySelectorAll('#mode-group button')) {
    btn.classList.toggle('active', btn.dataset.mode === settings.displayMode);
  }
  for (const btn of document.querySelectorAll('#scope-group button')) {
    btn.classList.toggle('active', btn.dataset.scope === settings.scope);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const langSel = document.getElementById('lang-select');
  for (const lang of Object.values(TARGET_LANGUAGES)) {
    const opt = document.createElement('option');
    opt.value = lang.id;
    opt.textContent = lang.label;
    langSel.appendChild(opt);
  }

  let settings = await getSettings();
  currentSettings = settings;
  renderUI(settings);

  const tab = await getActiveTab();
  const statusEl = document.getElementById('status-text');
  if (!tab || !isKaggleTab(tab.url)) {
    statusEl.textContent = '目前非 Kaggle 頁面';
  } else {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'KCT_GET_STATUS' }, { frameId: 0 });
      if (res?.ok) {
        statusEl.textContent = res.lastErrorMsg
          ? res.lastErrorMsg
          : res.isBusy
            ? `翻譯中 ${res.totalTranslated}/${res.totalDetected}`
            : !settings.enabled
              ? '已暫停（點右上角開啟或直接點「立即翻譯」）'
              : res.totalTranslated > 0
                ? `已譯 ${res.totalTranslated} 項`
                : '頁面已就緒';
      }
    } catch (_) {
      statusEl.textContent = '就緒（若剛更新請重新整理頁面）';
    }
  }

  const updateSavedSettings = (next) => {
    settings = next;
    currentSettings = next;
    renderUI(next);
  };

  langSel.addEventListener('change', async (e) => {
    updateSavedSettings(await saveSettings({ targetLang: e.target.value }));
  });

  let customTimer = null;
  document.getElementById('custom-lang-input').addEventListener('input', (e) => {
    const val = e.target.value;
    if (customTimer) clearTimeout(customTimer);
    customTimer = setTimeout(async () => {
      settings = await saveSettings({ customTargetLang: val.trim() });
      currentSettings = settings;
    }, 350);
  });

  document.getElementById('toggle-enabled').addEventListener('change', async (e) => {
    updateSavedSettings(await saveSettings({ enabled: e.target.checked }));
  });

  document.getElementById('toggle-code-comments').addEventListener('change', async (e) => {
    updateSavedSettings(await saveSettings({ translateCodeComments: e.target.checked }));
  });

  document.getElementById('toggle-auto').addEventListener('change', async (e) => {
    updateSavedSettings(await saveSettings({ autoTranslate: e.target.checked }));
  });

  document.getElementById('toggle-selection').addEventListener('change', async (e) => {
    updateSavedSettings(await saveSettings({ selectionTranslate: e.target.checked }));
  });

  document.getElementById('toggle-output-btn').addEventListener('change', async (e) => {
    updateSavedSettings(await saveSettings({ showOutputTranslateBtn: e.target.checked }));
  });

  document.getElementById('toggle-ball').addEventListener('change', async (e) => {
    updateSavedSettings(await saveSettings({ showFloatingBall: e.target.checked }));
  });

  for (const btn of document.querySelectorAll('#mode-group button')) {
    btn.addEventListener('click', async () => {
      updateSavedSettings(await saveSettings({ displayMode: btn.dataset.mode }));
    });
  }

  for (const btn of document.querySelectorAll('#scope-group button')) {
    btn.addEventListener('click', async () => {
      updateSavedSettings(await saveSettings({ scope: btn.dataset.scope }));
    });
  }

  document.getElementById('btn-translate-now').addEventListener('click', async () => {
    await sendCommandToActiveTab('TRANSLATE_NOW');
  });

  document.getElementById('btn-retranslate').addEventListener('click', async () => {
    await sendCommandToActiveTab('RETRANSLATE');
  });

  document.getElementById('btn-clear-page').addEventListener('click', async () => {
    await sendCommandToActiveTab('CLEAR_PAGE');
  });

  const openOptions = async () => {
    await chrome.runtime.openOptionsPage();
  };
  document.getElementById('btn-open-options').addEventListener('click', openOptions);
  document.getElementById('btn-go-config').addEventListener('click', openOptions);
});
