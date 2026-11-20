const {
  TARGET_LANGUAGES,
  getSettings,
  saveSettings,
  isHostWhitelisted,
  toggleHostWhitelist,
  isInjectableUrl,
  isPdfUrl
} = globalThis.KCTConfig;

const IDLE_STATUS_TEXT = '待命（按上方按鈕或 Alt+T 開始翻譯）';
const PDF_READY_STATUS_TEXT = '偵測到 PDF 文件（點擊上方開啟閱讀器）';
const PDF_OPENED_STATUS_TEXT = '已開啟 PDF 原版翻譯閱讀器';
const UNSUPPORTED_STATUS_TEXT = '此系統頁面不支援翻譯';

let currentSettings = null;
let activeTab = null;
let activeHost = '';
let activeTabInjectable = false;
let activeTabIsPdf = false;
let lastKnownTranslated = 0;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function extractHostname(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname || '';
  } catch (_) {
    return '';
  }
}

function setStatusText(text) {
  const statusEl = document.getElementById('status-text');
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.title = text;
}

function setActionButtonsDisabled(disabled) {
  for (const id of ['btn-translate-now', 'btn-retranslate', 'btn-clear-page']) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = disabled;
  }
}

function updateActionButtonsForTab() {
  const primaryBtn = document.getElementById('btn-translate-now');
  const retranslateBtn = document.getElementById('btn-retranslate');
  const clearBtn = document.getElementById('btn-clear-page');

  if (activeTabIsPdf) {
    if (primaryBtn) {
      primaryBtn.disabled = false;
      primaryBtn.textContent = '翻譯此 PDF（原版排版閱讀器）';
    }
    if (retranslateBtn) retranslateBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    return;
  }

  if (primaryBtn) {
    primaryBtn.textContent = '立即翻譯此頁面 (Alt+T)';
  }
  setActionButtonsDisabled(!activeTabInjectable);
}

function renderSiteBar(settings) {
  const siteBar = document.getElementById('site-bar');
  const hostEl = document.getElementById('site-host');
  const dotEl = document.getElementById('site-dot');
  const autoCheck = document.getElementById('toggle-site-auto');
  const autoLabel = document.getElementById('site-auto-label');

  if (activeTabIsPdf) {
    siteBar.classList.add('disabled');
    hostEl.textContent = activeHost ? `${activeHost} · PDF` : '本機 PDF 文件';
    hostEl.title = activeTab?.url || '';
    dotEl.classList.add('active');
    autoCheck.checked = false;
    autoCheck.disabled = true;
    autoLabel.classList.remove('is-checked');
    return;
  }

  if (!activeTabInjectable || !activeHost) {
    siteBar.classList.add('disabled');
    hostEl.textContent = '系統內部頁面';
    hostEl.title = activeTab?.url || '';
    dotEl.classList.remove('active');
    autoCheck.checked = false;
    autoCheck.disabled = true;
    autoLabel.classList.remove('is-checked');
    return;
  }

  siteBar.classList.remove('disabled');
  hostEl.textContent = activeHost;
  hostEl.title = activeHost;
  autoCheck.disabled = false;

  const whitelisted = isHostWhitelisted(activeHost, settings);
  autoCheck.checked = Boolean(whitelisted);
  dotEl.classList.toggle('active', Boolean(whitelisted));
  autoLabel.classList.toggle('is-checked', Boolean(whitelisted));
}

function renderUI(settings) {
  document.getElementById('toggle-enabled').checked = Boolean(settings.enabled);
  document.getElementById('toggle-code-comments').checked = settings.translateCodeComments !== false;
  document.getElementById('toggle-lazy-viewport').checked = settings.lazyViewport !== false;
  document.getElementById('toggle-stream').checked = settings.streamTranslation !== false;
  document.getElementById('toggle-selection').checked = settings.selectionTranslate !== false;
  document.getElementById('toggle-ball').checked = settings.showFloatingBall !== false;

  const langSel = document.getElementById('lang-select');
  langSel.value = settings.targetLang || 'zh-TW';
  const customInput = document.getElementById('custom-lang-input');
  customInput.value = settings.customTargetLang || '';
  customInput.classList.toggle('hidden', langSel.value !== 'custom');

  const isLocal = typeof globalThis.KCTConfig?.isLocalEndpoint === 'function'
    ? globalThis.KCTConfig.isLocalEndpoint(settings.baseUrl)
    : /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(settings.baseUrl || '');
  const hasKey = Boolean(settings.apiKey?.trim()) || isLocal;
  document.getElementById('api-alert').classList.toggle('hidden', hasKey);
  document.getElementById('model-badge').textContent = `${settings.model || '未選擇模型'}`;

  for (const btn of document.querySelectorAll('#mode-group button')) {
    btn.classList.toggle('active', btn.dataset.mode === settings.displayMode);
  }
  for (const btn of document.querySelectorAll('#scope-group button')) {
    btn.classList.toggle('active', btn.dataset.scope === settings.scope);
  }

  renderSiteBar(settings);
}

async function queryActiveTabStatus() {
  if (!activeTab || !activeTabInjectable) {
    setStatusText(UNSUPPORTED_STATUS_TEXT);
    return null;
  }
  try {
    const res = await chrome.tabs.sendMessage(
      activeTab.id,
      { type: 'KCT_GET_STATUS' },
      { frameId: 0 }
    );
    if (!res?.ok) {
      lastKnownTranslated = 0;
      setStatusText(IDLE_STATUS_TEXT);
      return null;
    }
    lastKnownTranslated = Number(res.totalTranslated) || 0;
    if (res.lastErrorMsg) {
      setStatusText(res.lastErrorMsg);
    } else if (res.isBusy) {
      setStatusText(`翻譯中 ${res.totalTranslated}/${res.totalDetected}`);
    } else if (!currentSettings?.enabled) {
      setStatusText('已暫停（點擊上方按鈕或開啟開關）');
    } else if (res.totalTranslated > 0) {
      setStatusText(`已譯 ${res.totalTranslated} 項`);
    } else {
      setStatusText(IDLE_STATUS_TEXT);
    }
    return res;
  } catch (_) {
    // Uninjected tab is normal in v2.0.0 on-demand mode
    lastKnownTranslated = 0;
    setStatusText(IDLE_STATUS_TEXT);
    return null;
  }
}

async function openPdfViewerFromPopup(pdfUrl = '') {
  try {
    const payload = { type: 'OPEN_PDF_VIEWER' };
    if (pdfUrl) payload.url = pdfUrl;
    if (typeof activeTab?.id === 'number') payload.tabId = activeTab.id;
    const res = await chrome.runtime.sendMessage(payload);
    if (res?.ok) {
      setStatusText(PDF_OPENED_STATUS_TEXT);
      window.close();
    } else {
      setStatusText(res?.error || '無法開啟 PDF 閱讀器');
    }
  } catch (err) {
    setStatusText(err?.message || '無法開啟 PDF 閱讀器');
  }
}

async function sendCommandToActiveTab(action) {
  const tab = await getActiveTab();
  activeTab = tab;
  activeTabIsPdf = Boolean(tab && isPdfUrl(tab.url));
  activeTabInjectable = Boolean(tab && isInjectableUrl(tab.url));
  activeHost = activeTabInjectable ? extractHostname(tab.url) : '';
  updateActionButtonsForTab();

  if (activeTabIsPdf) {
    if (action !== 'CLEAR_PAGE') {
      await openPdfViewerFromPopup(tab.url);
    }
    return;
  }

  if (!tab || !activeTabInjectable) {
    setActionButtonsDisabled(true);
    setStatusText(UNSUPPORTED_STATUS_TEXT);
    return;
  }

  if ((action === 'TRANSLATE_NOW' || action === 'RETRANSLATE') && currentSettings && !currentSettings.enabled) {
    currentSettings = await saveSettings({ enabled: true });
    renderUI(currentSettings);
  }

  if (action === 'CLEAR_PAGE') {
    setStatusText('正在還原原文...');
  } else {
    setStatusText('正在啟動翻譯...');
  }

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'ENSURE_AND_COMMAND',
      tabId: tab.id,
      action
    });

    if (!res?.ok) {
      setStatusText(res?.error || '無法執行翻譯指令');
      return;
    }

    if (res.openedPdfViewer) {
      setStatusText(PDF_OPENED_STATUS_TEXT);
      window.close();
      return;
    }

    if (action === 'CLEAR_PAGE') {
      lastKnownTranslated = 0;
      setStatusText('已還原原文');
      return;
    }

    setStatusText('已啟動翻譯，掃描中...');

    const pollStatus = async (isSecondPoll) => {
      try {
        const st = await chrome.tabs.sendMessage(
          tab.id,
          { type: 'KCT_GET_STATUS' },
          { frameId: 0 }
        );
        if (!st?.ok) return;
        lastKnownTranslated = Number(st.totalTranslated) || 0;
        if (st.lastErrorMsg) {
          setStatusText(st.lastErrorMsg);
        } else if (st.isBusy) {
          setStatusText(`翻譯中 ${st.totalTranslated}/${st.totalDetected}`);
          if (!isSecondPoll) {
            setTimeout(() => { pollStatus(true); }, 900);
          }
        } else if (st.totalTranslated > 0) {
          setStatusText(`已譯 ${st.totalTranslated} 項`);
        } else if (st.totalDetected === 0 && currentSettings?.scope === 'course') {
          setStatusText('未偵測到主文（可切換「整頁可讀文字」）');
        } else {
          setStatusText('目前頁面無新增可譯段落');
        }
      } catch (_) {}
    };

    setTimeout(() => { pollStatus(false); }, 320);
  } catch (err) {
    setStatusText(err?.message || '無法連線至背景服務，請稍後重試');
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

  activeTab = await getActiveTab();
  activeTabIsPdf = Boolean(activeTab && isPdfUrl(activeTab.url));
  activeTabInjectable = Boolean(activeTab && isInjectableUrl(activeTab.url));
  activeHost = activeTabInjectable ? extractHostname(activeTab.url) : '';

  let settings = await getSettings();
  currentSettings = settings;
  renderUI(settings);
  updateActionButtonsForTab();

  if (activeTabIsPdf) {
    setStatusText(PDF_READY_STATUS_TEXT);
  } else if (!activeTabInjectable) {
    setStatusText(UNSUPPORTED_STATUS_TEXT);
  } else {
    await queryActiveTabStatus();
  }

  const updateSavedSettings = (next) => {
    settings = next;
    currentSettings = next;
    renderUI(next);
  };

  document.getElementById('toggle-site-auto').addEventListener('change', async () => {
    if (!activeTabInjectable || !activeHost) return;
    await toggleHostWhitelist(activeHost);
    const next = await getSettings();
    updateSavedSettings(next);

    const nowWhitelisted = isHostWhitelisted(activeHost, next);
    if (nowWhitelisted) {
      setStatusText(`已加入白名單：${activeHost}`);
      if (lastKnownTranslated === 0) {
        await sendCommandToActiveTab('TRANSLATE_NOW');
      }
    } else {
      setStatusText(`已移出自動翻譯白名單`);
    }
  });

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

  document.getElementById('toggle-lazy-viewport').addEventListener('change', async (e) => {
    updateSavedSettings(await saveSettings({ lazyViewport: e.target.checked }));
  });

  document.getElementById('toggle-stream').addEventListener('change', async (e) => {
    updateSavedSettings(await saveSettings({ streamTranslation: e.target.checked }));
  });

  document.getElementById('toggle-selection').addEventListener('change', async (e) => {
    updateSavedSettings(await saveSettings({ selectionTranslate: e.target.checked }));
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
    if (activeTabIsPdf && activeTab?.url) {
      await openPdfViewerFromPopup(activeTab.url);
      return;
    }
    await sendCommandToActiveTab('TRANSLATE_NOW');
  });

  document.getElementById('btn-retranslate').addEventListener('click', async () => {
    await sendCommandToActiveTab('RETRANSLATE');
  });

  document.getElementById('btn-clear-page').addEventListener('click', async () => {
    await sendCommandToActiveTab('CLEAR_PAGE');
  });

  document.getElementById('btn-open-pdf').addEventListener('click', async () => {
    await openPdfViewerFromPopup('');
  });

  const openOptions = async () => {
    await chrome.runtime.openOptionsPage();
  };
  document.getElementById('btn-open-options').addEventListener('click', openOptions);
  document.getElementById('btn-go-config').addEventListener('click', openOptions);
});
