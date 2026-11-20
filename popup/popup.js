const {
  TARGET_LANGUAGES,
  getSettings,
  saveSettings,
  isHostWhitelisted,
  toggleHostWhitelist,
  isInjectableUrl,
  isPdfUrl
} = globalThis.KCTConfig;

const IDLE_STATUS_TEXT = '待命 · Alt+T 翻譯';
const PDF_READY_STATUS_TEXT = '偵測到 PDF 文件';
const PDF_OPENED_STATUS_TEXT = '已開啟 PDF 閱讀器';
const UNSUPPORTED_STATUS_TEXT = '此頁面不支援翻譯';

let currentSettings = null;
let activeTab = null;
let activeHost = '';
let activeTabInjectable = false;
let activeTabIsPdf = false;
let lastKnownTranslated = 0;

let saveQueue = Promise.resolve();
let customTimer = null;
let customLangDirty = false;
let pendingCustomFlushCount = 0;

function enqueueSave(taskFn) {
  const run = saveQueue.then(() => taskFn());
  saveQueue = run.catch(() => {});
  return run;
}

function hasPendingCustomLangEdit(customInput) {
  return Boolean(
    customInput && (
      document.activeElement === customInput ||
      customLangDirty ||
      customTimer !== null ||
      pendingCustomFlushCount > 0
    )
  );
}

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
      primaryBtn.textContent = '開啟 PDF 原版翻譯';
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
  if (!siteBar || !hostEl || !dotEl || !autoCheck || !autoLabel) return;

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
  const codeCommentsEl = document.getElementById('toggle-code-comments');
  if (codeCommentsEl) codeCommentsEl.checked = settings.translateCodeComments !== false;
  const selectionEl = document.getElementById('toggle-selection');
  if (selectionEl) selectionEl.checked = settings.selectionTranslate !== false;
  const ballEl = document.getElementById('toggle-ball');
  if (ballEl) ballEl.checked = settings.showFloatingBall !== false;

  const langSel = document.getElementById('lang-select');
  if (langSel) langSel.value = settings.targetLang || 'zh-TW';
  const customInput = document.getElementById('custom-lang-input');
  if (customInput) {
    if (!hasPendingCustomLangEdit(customInput)) {
      customInput.value = settings.customTargetLang || '';
    }
    customInput.classList.toggle('hidden', langSel?.value !== 'custom');
  }

  const isLocal = typeof globalThis.KCTConfig?.isLocalEndpoint === 'function'
    ? globalThis.KCTConfig.isLocalEndpoint(settings.baseUrl)
    : /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(settings.baseUrl || '');
  const hasKey = Boolean(settings.apiKey?.trim()) || isLocal;
  document.getElementById('api-alert')?.classList.toggle('hidden', hasKey);
  const modelBadge = document.getElementById('model-badge');
  if (modelBadge) modelBadge.textContent = `${settings.model || '未選擇模型'}`;

  for (const btn of document.querySelectorAll('#mode-group button')) {
    const active = btn.dataset.mode === settings.displayMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  }
  for (const btn of document.querySelectorAll('#scope-group button')) {
    const active = btn.dataset.scope === settings.scope;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
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
      setStatusText('已暫停，點擊上方按鈕即可翻譯');
    } else if (res.totalTranslated > 0) {
      setStatusText(`已譯 ${res.totalTranslated} 項`);
    } else {
      setStatusText(IDLE_STATUS_TEXT);
    }
    return res;
  } catch (_) {
    // Uninjected tab is normal in on-demand mode
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
    await enqueueSave(async () => {
      if (currentSettings && !currentSettings.enabled) {
        const next = await saveSettings({ enabled: true });
        currentSettings = next;
        renderUI(next);
      }
    });
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
          setStatusText('無主文，可試「整頁文字」');
        } else {
          setStatusText('目前頁面無新增可譯段落');
        }
      } catch (_) {}
    };

    setTimeout(() => { pollStatus(false); }, 320);
  } catch (err) {
    setStatusText(err?.message || '無法連線背景服務，請重試');
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

  let settings = await enqueueSave(async () => {
    const initial = await getSettings();
    if (initial.enabled === false) {
      return saveSettings({ enabled: true });
    }
    return initial;
  });
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

  const customLangEl = document.getElementById('custom-lang-input');
  const flushCustomLang = async () => {
    if (customTimer) {
      clearTimeout(customTimer);
      customTimer = null;
    }
    if (!customLangEl) return;
    pendingCustomFlushCount += 1;
    try {
      await enqueueSave(async () => {
        const trimmed = customLangEl.value.trim();
        if (trimmed !== (currentSettings?.customTargetLang || '')) {
          const next = await saveSettings({ customTargetLang: trimmed });
          settings = next;
          currentSettings = next;
        }
        if (customLangEl.value.trim() === (currentSettings?.customTargetLang || '')) {
          customLangDirty = false;
        }
      });
    } finally {
      pendingCustomFlushCount = Math.max(0, pendingCustomFlushCount - 1);
    }
  };

  document.getElementById('toggle-site-auto')?.addEventListener('change', async () => {
    if (!activeTabInjectable || !activeHost) return;
    await flushCustomLang();
    const next = await enqueueSave(async () => {
      const res = await toggleHostWhitelist(activeHost);
      const saved = res?.settings || await getSettings();
      updateSavedSettings(saved);
      return saved;
    });

    const nowWhitelisted = isHostWhitelisted(activeHost, next);
    if (nowWhitelisted) {
      setStatusText(`已自動翻譯：${activeHost}`);
      if (lastKnownTranslated === 0) {
        await flushCustomLang();
        await sendCommandToActiveTab('TRANSLATE_NOW');
      }
    } else {
      setStatusText('已移出白名單');
    }
  });

  langSel?.addEventListener('change', async (e) => {
    const targetLang = e.target.value;
    await enqueueSave(async () => {
      updateSavedSettings(await saveSettings({ targetLang }));
    });
  });

  customLangEl?.addEventListener('input', () => {
    customLangDirty = true;
    if (customTimer) clearTimeout(customTimer);
    customTimer = setTimeout(() => {
      customTimer = null;
      void flushCustomLang();
    }, 350);
  });
  customLangEl?.addEventListener('change', flushCustomLang);
  customLangEl?.addEventListener('blur', flushCustomLang);

  document.getElementById('toggle-code-comments')?.addEventListener('change', async (e) => {
    const translateCodeComments = e.target.checked;
    await enqueueSave(async () => {
      updateSavedSettings(await saveSettings({ translateCodeComments }));
    });
  });

  document.getElementById('toggle-selection')?.addEventListener('change', async (e) => {
    const selectionTranslate = e.target.checked;
    await enqueueSave(async () => {
      updateSavedSettings(await saveSettings({ selectionTranslate }));
    });
  });

  document.getElementById('toggle-ball')?.addEventListener('change', async (e) => {
    const showFloatingBall = e.target.checked;
    await enqueueSave(async () => {
      updateSavedSettings(await saveSettings({ showFloatingBall }));
    });
  });

  for (const btn of document.querySelectorAll('#mode-group button')) {
    btn.addEventListener('click', async () => {
      const displayMode = btn.dataset.mode;
      await enqueueSave(async () => {
        updateSavedSettings(await saveSettings({ displayMode }));
      });
    });
  }

  for (const btn of document.querySelectorAll('#scope-group button')) {
    btn.addEventListener('click', async () => {
      const scope = btn.dataset.scope;
      await enqueueSave(async () => {
        updateSavedSettings(await saveSettings({ scope }));
      });
    });
  }

  document.getElementById('btn-translate-now')?.addEventListener('click', async () => {
    await flushCustomLang();
    if (activeTabIsPdf && activeTab?.url) {
      await openPdfViewerFromPopup(activeTab.url);
      return;
    }
    await sendCommandToActiveTab('TRANSLATE_NOW');
  });

  document.getElementById('btn-retranslate')?.addEventListener('click', async () => {
    await flushCustomLang();
    await sendCommandToActiveTab('RETRANSLATE');
  });

  document.getElementById('btn-clear-page')?.addEventListener('click', async () => {
    await sendCommandToActiveTab('CLEAR_PAGE');
  });

  document.getElementById('btn-open-pdf')?.addEventListener('click', async () => {
    const resolvedPdfUrl = typeof globalThis.KCTConfig?.resolvePdfSourceUrl === 'function'
      ? globalThis.KCTConfig.resolvePdfSourceUrl(activeTab?.url || '')
      : '';
    await openPdfViewerFromPopup(resolvedPdfUrl);
  });

  const openOptions = async () => {
    await chrome.runtime.openOptionsPage();
  };
  document.getElementById('btn-open-options')?.addEventListener('click', openOptions);
  document.getElementById('btn-go-config')?.addEventListener('click', openOptions);
});
