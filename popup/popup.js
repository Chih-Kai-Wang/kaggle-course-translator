const { TARGET_LANGUAGES, getSettings, saveSettings } = globalThis.KCTConfig;

function isKaggleTab(url) {
  if (!url) return false;
  return /^https:\/\/([a-z0-9-]+\.)?(kaggle\.com|kaggle\.net|kaggleusercontent\.com)\//i.test(url);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function sendCommandToActiveTab(action) {
  const statusEl = document.getElementById('status-text');
  const tab = await getActiveTab();
  if (!tab || !isKaggleTab(tab.url)) {
    statusEl.textContent = '請先開啟 Kaggle 頁面';
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'KCT_COMMAND',
      action
    });
    statusEl.textContent = action === 'CLEAR_PAGE' ? '已還原原文' : '已發送翻譯指令';
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
            : res.totalTranslated > 0
              ? `已譯 ${res.totalTranslated} 項`
              : '頁面已就緒';
      }
    } catch (_) {
      statusEl.textContent = '就緒（若剛更新請重新整理頁面）';
    }
  }

  langSel.addEventListener('change', async (e) => {
    settings = await saveSettings({ targetLang: e.target.value });
    renderUI(settings);
  });

  let customTimer = null;
  document.getElementById('custom-lang-input').addEventListener('input', (e) => {
    const val = e.target.value;
    if (customTimer) clearTimeout(customTimer);
    customTimer = setTimeout(async () => {
      settings = await saveSettings({ customTargetLang: val.trim() });
    }, 350);
  });

  document.getElementById('toggle-enabled').addEventListener('change', async (e) => {
    settings = await saveSettings({ enabled: e.target.checked });
    renderUI(settings);
  });

  document.getElementById('toggle-code-comments').addEventListener('change', async (e) => {
    settings = await saveSettings({ translateCodeComments: e.target.checked });
    renderUI(settings);
  });

  document.getElementById('toggle-auto').addEventListener('change', async (e) => {
    settings = await saveSettings({ autoTranslate: e.target.checked });
    renderUI(settings);
  });

  document.getElementById('toggle-selection').addEventListener('change', async (e) => {
    settings = await saveSettings({ selectionTranslate: e.target.checked });
    renderUI(settings);
  });

  document.getElementById('toggle-output-btn').addEventListener('change', async (e) => {
    settings = await saveSettings({ showOutputTranslateBtn: e.target.checked });
    renderUI(settings);
  });

  document.getElementById('toggle-ball').addEventListener('change', async (e) => {
    settings = await saveSettings({ showFloatingBall: e.target.checked });
    renderUI(settings);
  });

  for (const btn of document.querySelectorAll('#mode-group button')) {
    btn.addEventListener('click', async () => {
      settings = await saveSettings({ displayMode: btn.dataset.mode });
      renderUI(settings);
    });
  }

  for (const btn of document.querySelectorAll('#scope-group button')) {
    btn.addEventListener('click', async () => {
      settings = await saveSettings({ scope: btn.dataset.scope });
      renderUI(settings);
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
