(() => {
  if (globalThis.__KCT_INITIALIZED__) return;
  globalThis.__KCT_INITIALIZED__ = true;

  const {
    TARGET_LANGUAGES,
    getSettings,
    saveSettings,
    hashText,
    SETTINGS_KEY,
    isHostWhitelisted,
    toggleHostWhitelist
  } = globalThis.KCTConfig;

  const SiteAnalyzer = globalThis.KCTSiteAnalyzer;
  const NotebookAdapter = globalThis.KCTNotebookAdapter;
  const Renderer = globalThis.KCTRenderer;

  const {
    BLOCK_SELECTOR,
    SKIP_ANCESTOR_SELECTOR,
    NAV_EXCLUDE_SELECTOR,
    isTopFrame,
    isElementVisible,
    classifyPage,
    findContentRoots,
    queryAllDeep,
    shouldTranslateText,
    probeTypography,
    extractBlockContent,
    shouldSkipBlock
  } = SiteAnalyzer;

  const MAX_CONCURRENT_BATCHES = 3;

  // Shared mutable runtime state passed to renderer & notebook adapter
  const state = {
    settings: null,
    elementState: new WeakMap(), // el -> 'observed' | 'queued' | 'done' | 'error'
    commentState: new WeakMap(), // span/line -> 'queued' | 'done'
    cmOverlayBySpan: new WeakMap(),
    cmSpanByOverlay: new WeakMap(),
    commentCacheByBody: new Map(),
    pendingItems: [],
    totalDetected: 0,
    totalTranslated: 0,
    translationEpoch: 0,
    lastErrorMsg: ''
  };

  let pageActive = false;
  let pageInfo = classifyPage();
  let lastPageKey = location.origin + location.pathname;
  let scanTimer = null;
  let hydrationTimers = [];
  let isProcessingQueue = false;
  let activeRequests = 0;

  const subframeStats = new Map(); // frameId -> { totalDetected, totalTranslated, isBusy, lastErrorMsg }

  // Viewport-first IntersectionObserver state
  let lazyObserver = null;
  const observedJobs = new Map(); // el -> job

  // Streaming Port ('kct-stream') state
  let streamPort = null;
  let streamReqSeq = 0;
  const activeStreamRequests = new Map(); // requestId -> { epoch, itemsByKey, receivedKeys, resolve, reject, timer }
  const streamRenderBuffer = [];
  let streamFlushScheduled = false;
  let pendingFlushPromise = Promise.resolve();
  let renderChain = Promise.resolve();
  let cmSyncScheduled = false;

  // Shadow DOM UI refs
  let widgetHostEl = null;
  let widgetShadow = null;
  let widgetCollapsed = false;

  let selHostEl = null;
  let selShadow = null;
  let selBtnEl = null;
  let selPopoverEl = null;
  let currentSelectionText = '';

  function getPageContext() {
    return {
      pageType: pageInfo.pageType,
      title: pageInfo.title,
      host: pageInfo.host,
      useTechGlossary: pageInfo.useTechGlossary
    };
  }

  function isDarkPageHint() {
    if (document.body?.dataset?.jpThemeLight === 'false') return true;
    const html = document.documentElement;
    if (html?.getAttribute('data-theme') === 'dark' || html?.classList.contains('dark')) return true;
    if (document.body?.classList.contains('theme-dark')) return true;
    return false;
  }

  function clearHydrationTimers() {
    for (const id of hydrationTimers) {
      clearTimeout(id);
    }
    hydrationTimers = [];
  }

  function cancelAllActiveStreams() {
    for (const [requestId, req] of activeStreamRequests.entries()) {
      if (req.timer) clearTimeout(req.timer);
      if (streamPort) {
        try {
          streamPort.postMessage({ type: 'CANCEL_STREAM', requestId });
        } catch (_) {}
      }
      req.resolve({ cancelled: true });
    }
    activeStreamRequests.clear();
    streamRenderBuffer.length = 0;
  }

  // =========================================================
  // Viewport-First Lazy IntersectionObserver
  // =========================================================
  function resetLazyObserver() {
    if (lazyObserver) {
      try {
        lazyObserver.disconnect();
      } catch (_) {}
      lazyObserver = null;
    }
    for (const el of observedJobs.keys()) {
      if (state.elementState.get(el) === 'observed') {
        state.elementState.delete(el);
      }
    }
    observedJobs.clear();
  }

  function ensureLazyObserver() {
    if (lazyObserver) return lazyObserver;
    lazyObserver = new IntersectionObserver(
      (entries) => {
        if (!pageActive) return;
        const newlyVisible = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target;
          lazyObserver.unobserve(el);
          const job = observedJobs.get(el);
          observedJobs.delete(el);
          if (!job) continue;
          if (!el.isConnected || el.hasAttribute('data-kct-has-trans')) {
            if (state.elementState.get(el) === 'observed') {
              state.elementState.delete(el);
            }
            continue;
          }
          state.elementState.set(el, 'queued');
          newlyVisible.push(job);
        }

        if (newlyVisible.length > 0) {
          state.totalDetected += newlyVisible.length;
          state.pendingItems.push(...newlyVisible);
          sortViewportFirst(state.pendingItems);
          updateWidgetUI();
          processQueue();
        }
      },
      { rootMargin: '600px 0px', threshold: 0 }
    );
    return lazyObserver;
  }

  function collectCandidateBlocks(force = false) {
    const settings = state.settings;
    if (!settings || (!settings.enabled && !force)) return [];

    const roots = findContentRoots(settings.scope, pageInfo);
    const targetLangId = settings.targetLang || 'zh-TW';
    const useLazy = settings.lazyViewport !== false;
    const vh = window.innerHeight || 800;

    const immediate = [];
    const seen = new Set();

    for (const root of roots) {
      const candidates = queryAllDeep(root, BLOCK_SELECTOR);
      for (const el of candidates) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (shouldSkipBlock(el, settings.scope, state.elementState)) continue;

        const { text, placeholders, nestedListEl } = extractBlockContent(el);
        if (!shouldTranslateText(text, targetLangId)) continue;

        const typo = probeTypography(el);
        const key = hashText(text);
        const job = { kind: 'block', el, key, text, placeholders, nestedListEl, typo };

        if (useLazy) {
          const rect = el.getBoundingClientRect();
          const nearViewport = rect.bottom >= -200 && rect.top <= vh + 600;
          if (nearViewport) {
            state.elementState.set(el, 'queued');
            immediate.push(job);
          } else {
            state.elementState.set(el, 'observed');
            observedJobs.set(el, job);
            ensureLazyObserver().observe(el);
          }
        } else {
          state.elementState.set(el, 'queued');
          immediate.push(job);
        }
      }
    }

    return immediate;
  }

  function sortViewportFirst(items) {
    const vh = window.innerHeight || 800;
    return items.sort((a, b) => {
      const ra = a.el.getBoundingClientRect();
      const rb = b.el.getBoundingClientRect();
      const aVis = ra.bottom >= -200 && ra.top <= vh + 500;
      const bVis = rb.bottom >= -200 && rb.top <= vh + 500;
      if (aVis !== bVis) return aVis ? -1 : 1;
      return ra.top - rb.top;
    });
  }

  // =========================================================
  // Streaming Micro-Batch RAF Flusher & Port Management
  // =========================================================
  function scheduleCmSync() {
    if (cmSyncScheduled || !document.querySelector('.cm-editor')) return;
    cmSyncScheduled = true;
    requestAnimationFrame(() => {
      cmSyncScheduled = false;
      if (pageActive) {
        NotebookAdapter.syncCmOverlays(state);
      }
    });
  }

  function scheduleStreamRenderFlush() {
    if (streamFlushScheduled) return;
    streamFlushScheduled = true;

    let resolveFlush;
    const flushGate = new Promise((r) => {
      resolveFlush = r;
    });
    pendingFlushPromise = flushGate;

    let fired = false;
    const runFlush = () => {
      if (fired) return;
      fired = true;
      streamFlushScheduled = false;
      if (streamRenderBuffer.length === 0) {
        resolveFlush();
        return;
      }

      const jobs = streamRenderBuffer.splice(0, streamRenderBuffer.length);
      renderChain = renderChain
        .then(async () => {
          await Renderer.renderJobsWithRAF(jobs, state.settings, NotebookAdapter, state);
          updateWidgetUI();
        })
        .catch(() => {})
        .finally(resolveFlush);
    };

    const fallbackTimer = setTimeout(runFlush, 300);
    requestAnimationFrame(() => {
      clearTimeout(fallbackTimer);
      runFlush();
    });
  }

  async function waitForAllRenders() {
    await pendingFlushPromise;
    await renderChain;
  }

  function cancelRemoteStream(requestId) {
    if (!streamPort || !requestId) return;
    try {
      streamPort.postMessage({ type: 'CANCEL_STREAM', requestId });
    } catch (_) {}
  }

  function handleStreamMessage(msg) {
    if (!msg || typeof msg !== 'object' || !msg.requestId) return;
    const req = activeStreamRequests.get(msg.requestId);
    if (!req) return;

    if (req.timer) {
      clearTimeout(req.timer);
      req.timer = setTimeout(() => {
        activeStreamRequests.delete(msg.requestId);
        cancelRemoteStream(msg.requestId);
        req.reject({ error: '串流回應逾時', portFallback: true });
      }, 60000);
    }

    if (msg.type === 'ITEM') {
      if (req.epoch !== state.translationEpoch) return;
      const matchedItems = req.itemsByKey.get(msg.key);
      if (matchedItems && msg.zh) {
        req.receivedKeys.add(msg.key);
        for (const item of matchedItems) {
          streamRenderBuffer.push({
            kind: item.kind || 'block',
            cmEditor: item.cmEditor,
            el: item.el,
            zh: msg.zh,
            placeholders: item.placeholders,
            nestedListEl: item.nestedListEl,
            commentInfo: item.commentInfo,
            typo: item.typo,
            epoch: req.epoch
          });
        }
        scheduleStreamRenderFlush();
      }
      return;
    }

    if (msg.type === 'DONE') {
      if (req.timer) clearTimeout(req.timer);
      activeStreamRequests.delete(msg.requestId);
      req.resolve({ ok: true, translatedCount: msg.translatedCount || 0 });
      return;
    }

    if (msg.type === 'ERROR') {
      if (req.timer) clearTimeout(req.timer);
      activeStreamRequests.delete(msg.requestId);
      req.reject({
        error: msg.error || '翻譯失敗',
        errorCode: msg.errorCode || ''
      });
    }
  }

  function ensureStreamPort() {
    if (streamPort) return streamPort;
    const port = chrome.runtime.connect({ name: 'kct-stream' });
    port.onMessage.addListener(handleStreamMessage);
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (streamPort === port) {
        streamPort = null;
      }
      for (const [reqId, req] of activeStreamRequests.entries()) {
        if (req.timer) clearTimeout(req.timer);
        activeStreamRequests.delete(reqId);
        req.reject({
          portFallback: true,
          error: '串流連線中斷'
        });
      }
    });
    streamPort = port;
    return port;
  }

  function sendBatchOverStreamPort(itemsByKey, uniqueItems, pageContext, batchEpoch, receivedKeys) {
    return new Promise((resolve, reject) => {
      let port;
      try {
        port = ensureStreamPort();
      } catch (err) {
        reject({ portFallback: true, error: err?.message || '無法建立串流連線' });
        return;
      }

      const requestId = `kct_${Date.now()}_${++streamReqSeq}`;
      const req = {
        epoch: batchEpoch,
        itemsByKey,
        receivedKeys: receivedKeys || new Set(),
        resolve,
        reject,
        timer: setTimeout(() => {
          activeStreamRequests.delete(requestId);
          cancelRemoteStream(requestId);
          reject({ portFallback: true, error: '串流連線逾時' });
        }, 60000)
      };
      activeStreamRequests.set(requestId, req);

      try {
        port.postMessage({
          type: 'TRANSLATE_STREAM',
          requestId,
          items: uniqueItems,
          pageContext
        });
      } catch (err) {
        if (req.timer) clearTimeout(req.timer);
        activeStreamRequests.delete(requestId);
        streamPort = null;
        reject({ portFallback: true, error: err?.message || '傳送串流訊息失敗' });
      }
    });
  }

  function releaseUnreceivedItems(batch, receivedKeys) {
    let missingCount = 0;
    for (const item of batch) {
      if (receivedKeys && receivedKeys.has(item.key)) continue;
      if (item.kind === 'comment') state.commentState.delete(item.el);
      else state.elementState.delete(item.el);
      missingCount += 1;
    }
    if (missingCount > 0) {
      state.totalDetected = Math.max(state.totalTranslated, state.totalDetected - missingCount);
    }
  }

  async function translateBatchViaFallback(batch, uniqueItems, pageContext, batchEpoch) {
    const response = await chrome.runtime.sendMessage({
      type: 'TRANSLATE_BATCH',
      items: uniqueItems,
      pageContext
    });

    if (batchEpoch !== state.translationEpoch) return;

    if (!response?.ok) {
      state.lastErrorMsg = response?.error || '翻譯失敗';
      releaseUnreceivedItems(batch, null);
      if (response?.errorCode === 'NO_API_KEY') {
        state.pendingItems.length = 0;
      }
      return;
    }

    const results = response.results || {};
    const jobs = [];
    const matchedKeys = new Set();
    for (const item of batch) {
      const hit = results[item.key];
      if (hit?.zh) {
        matchedKeys.add(item.key);
        jobs.push({
          kind: item.kind || 'block',
          cmEditor: item.cmEditor,
          el: item.el,
          zh: hit.zh,
          placeholders: item.placeholders,
          nestedListEl: item.nestedListEl,
          commentInfo: item.commentInfo,
          typo: item.typo,
          epoch: batchEpoch
        });
      }
    }
    releaseUnreceivedItems(batch, matchedKeys);

    if (jobs.length > 0 && batchEpoch === state.translationEpoch) {
      renderChain = renderChain
        .then(async () => {
          await Renderer.renderJobsWithRAF(jobs, state.settings, NotebookAdapter, state);
          updateWidgetUI();
        })
        .catch(() => {});
      await renderChain;
    }
  }

  function takeNextBatch() {
    const maxCount = Number(state.settings?.batchSize || 20);
    const maxChars = Number(state.settings?.maxBatchChars || 5500);
    const batch = [];
    let chars = 0;

    while (state.pendingItems.length > 0 && batch.length < maxCount) {
      const next = state.pendingItems[0];
      if (!next.el || !next.el.isConnected) {
        state.pendingItems.shift();
        state.totalDetected = Math.max(state.totalTranslated, state.totalDetected - 1);
        continue;
      }
      if (batch.length > 0 && chars + next.text.length > maxChars) {
        break;
      }
      state.pendingItems.shift();
      batch.push(next);
      chars += next.text.length;
    }
    return batch;
  }

  async function processQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    state.lastErrorMsg = '';
    updateWidgetUI();

    try {
      const workers = [];
      const spawnWorker = async () => {
        while (state.pendingItems.length > 0 && pageActive) {
          const batch = takeNextBatch();
          if (batch.length === 0) break;

          const uniqueMap = new Map();
          const itemsByKey = new Map();
          for (const item of batch) {
            if (!uniqueMap.has(item.key)) {
              uniqueMap.set(item.key, {
                key: item.key,
                text: item.text,
                kind: item.kind || 'block'
              });
              itemsByKey.set(item.key, []);
            }
            itemsByKey.get(item.key).push(item);
          }

          const uniqueItems = Array.from(uniqueMap.values());
          const pageContext = getPageContext();
          const batchEpoch = state.translationEpoch;
          const useStream = state.settings?.streamTranslation !== false;

          activeRequests += 1;
          updateWidgetUI();

          try {
            if (useStream) {
              const receivedKeys = new Set();
              let needFallback = false;
              let streamErrObj = null;

              try {
                const res = await sendBatchOverStreamPort(
                  itemsByKey,
                  uniqueItems,
                  pageContext,
                  batchEpoch,
                  receivedKeys
                );
                if (res?.cancelled || batchEpoch !== state.translationEpoch) {
                  continue;
                }
                // Wait for any buffered rAF renders to complete before counting missing keys
                await waitForAllRenders();
                releaseUnreceivedItems(batch, receivedKeys);
              } catch (errObj) {
                streamErrObj = errObj;
                if (batchEpoch !== state.translationEpoch) continue;
                await waitForAllRenders();
                if (errObj?.portFallback) {
                  needFallback = true;
                } else {
                  state.lastErrorMsg = errObj?.error || '翻譯失敗';
                  releaseUnreceivedItems(batch, receivedKeys);
                  if (errObj?.errorCode === 'NO_API_KEY') {
                    state.pendingItems.length = 0;
                    break;
                  }
                }
              }

              if (needFallback && batchEpoch === state.translationEpoch) {
                const remainingBatch = batch.filter((it) => !receivedKeys.has(it.key));
                const remainingUnique = uniqueItems.filter((it) => !receivedKeys.has(it.key));
                if (remainingUnique.length > 0) {
                  try {
                    await translateBatchViaFallback(remainingBatch, remainingUnique, pageContext, batchEpoch);
                  } catch (fbErr) {
                    if (batchEpoch !== state.translationEpoch) continue;
                    state.lastErrorMsg = fbErr?.message || streamErrObj?.error || '通訊失敗';
                    releaseUnreceivedItems(remainingBatch, null);
                  }
                }
              }
            } else {
              await translateBatchViaFallback(batch, uniqueItems, pageContext, batchEpoch);
            }
          } catch (err) {
            if (batchEpoch !== state.translationEpoch) continue;
            state.lastErrorMsg = err?.message || '通訊失敗';
            releaseUnreceivedItems(batch, null);
          } finally {
            activeRequests -= 1;
            updateWidgetUI();
          }
        }
      };

      const batchTarget = Math.max(1, Number(state.settings?.batchSize || 20));
      const concurrency = Math.min(
        MAX_CONCURRENT_BATCHES,
        Math.max(1, Math.ceil(state.pendingItems.length / batchTarget))
      );
      for (let i = 0; i < concurrency; i++) {
        workers.push(spawnWorker());
      }
      await Promise.all(workers);
      await waitForAllRenders();
    } finally {
      isProcessingQueue = false;
      updateWidgetUI();
      // If IntersectionObserver enqueued new items while winding down, continue seamlessly
      if (pageActive && state.pendingItems.length > 0 && !state.lastErrorMsg) {
        processQueue();
      }
    }
  }

  function scanAndTranslate(force = false) {
    if (!state.settings || !pageActive) return;
    NotebookAdapter.injectOutputTranslateButtons(state.settings, getPageContext());
    if (!state.settings.enabled && !force) return;

    const newBlocks = collectCandidateBlocks(force);
    const newComments = NotebookAdapter.collectCodeComments(force, state.settings, state);
    const newItems = [...newBlocks, ...newComments];

    if (newItems.length > 0) {
      state.totalDetected += newItems.length;
      state.pendingItems.push(...newItems);
      sortViewportFirst(state.pendingItems);
      updateWidgetUI();
      processQueue();
    } else {
      updateWidgetUI();
    }
  }

  function scheduleScan(delay = 300) {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      const curKey = location.origin + location.pathname;
      if (curKey !== lastPageKey) {
        lastPageKey = curKey;
        pageInfo = classifyPage();
        cancelAllActiveStreams();
        resetLazyObserver();
        state.translationEpoch += 1;
        state.totalDetected = 0;
        state.totalTranslated = 0;
        state.pendingItems.length = 0;
        state.lastErrorMsg = '';
        if (isTopFrame()) subframeStats.clear();
      }
      if (!pageActive) return;
      scanAndTranslate(false);
    }, delay);
  }

  function resetAndClearPage(deactivate = false) {
    clearHydrationTimers();
    cancelAllActiveStreams();
    resetLazyObserver();
    Renderer.clearAllInjectedTranslations(state, NotebookAdapter);
    if (isTopFrame()) {
      subframeStats.clear();
    }
    if (deactivate) {
      pageActive = false;
      removeFloatingWidget();
    } else {
      updateWidgetUI();
    }
  }

  // =========================================================
  // Aggregated Cross-Frame Status
  // =========================================================
  function getAggregatedStats() {
    let detected = state.totalDetected;
    let translated = state.totalTranslated;
    let isBusy = isProcessingQueue || activeRequests > 0;
    let err = state.lastErrorMsg;

    for (const s of subframeStats.values()) {
      detected += Number(s.totalDetected || 0);
      translated += Number(s.totalTranslated || 0);
      if (s.isBusy) isBusy = true;
      if (!err && s.lastErrorMsg) err = s.lastErrorMsg;
    }

    return {
      totalDetected: detected,
      totalTranslated: translated,
      isBusy,
      lastErrorMsg: err
    };
  }

  async function reportStatusToTop() {
    if (isTopFrame()) return;
    try {
      await chrome.runtime.sendMessage({
        type: 'FRAME_STATUS',
        stats: {
          totalDetected: state.totalDetected,
          totalTranslated: state.totalTranslated,
          isBusy: isProcessingQueue || activeRequests > 0,
          lastErrorMsg: state.lastErrorMsg
        }
      });
    } catch (_) {}
  }

  // =========================================================
  // Shadow DOM Floating Control Pill (Top Frame Only)
  // =========================================================
  const WIDGET_SHADOW_CSS = `
    :host {
      all: initial;
      color-scheme: light dark;
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483000;
      pointer-events: none;
      --kct-accent: #0284c7;
      --kct-accent-soft: rgba(2, 132, 199, 0.12);
      --kct-star: #f59e0b;
      --kct-border: rgba(15, 23, 42, 0.12);
      --kct-text: #0f172a;
      --kct-muted: #64748b;
      --kct-bg: rgba(255, 255, 255, 0.88);
      --kct-pill-bg: rgba(15, 23, 42, 0.06);
      --kct-pill-active: #ffffff;
      --kct-shadow: 0 10px 30px rgba(15, 23, 42, 0.14), 0 1px 3px rgba(15, 23, 42, 0.08);
      --kct-font: -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", "Segoe UI", sans-serif;
    }

    @media (prefers-color-scheme: dark) {
      :host {
        --kct-accent: #38bdf8;
        --kct-accent-soft: rgba(56, 189, 248, 0.16);
        --kct-border: rgba(255, 255, 255, 0.15);
        --kct-text: #f1f5f9;
        --kct-muted: #94a3b8;
        --kct-bg: rgba(15, 23, 42, 0.88);
        --kct-pill-bg: rgba(255, 255, 255, 0.1);
        --kct-pill-active: rgba(255, 255, 255, 0.18);
        --kct-shadow: 0 10px 32px rgba(0, 0, 0, 0.45), 0 1px 3px rgba(0, 0, 0, 0.3);
      }
    }

    :host(.kct-dark) {
      color-scheme: dark;
      --kct-accent: #38bdf8;
      --kct-accent-soft: rgba(56, 189, 248, 0.16);
      --kct-border: rgba(255, 255, 255, 0.15);
      --kct-text: #f1f5f9;
      --kct-muted: #94a3b8;
      --kct-bg: rgba(15, 23, 42, 0.88);
      --kct-pill-bg: rgba(255, 255, 255, 0.1);
      --kct-pill-active: rgba(255, 255, 255, 0.18);
      --kct-shadow: 0 10px 32px rgba(0, 0, 0, 0.45), 0 1px 3px rgba(0, 0, 0, 0.3);
    }

    .kct-pill {
      pointer-events: auto;
      font-family: var(--kct-font);
      color: var(--kct-text);
      background: var(--kct-bg);
      backdrop-filter: blur(18px) saturate(165%);
      -webkit-backdrop-filter: blur(18px) saturate(165%);
      border: 1px solid var(--kct-border);
      border-radius: 999px;
      box-shadow: var(--kct-shadow);
      padding: 5px 8px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      line-height: 1.2;
      user-select: none;
      box-sizing: border-box;
      transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
    }

    .kct-pill.kct-collapsed {
      padding: 5px 10px;
    }

    .kct-brand {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-weight: 700;
      color: var(--kct-text);
      cursor: pointer;
      padding: 3px 6px;
      border-radius: 999px;
      border: none;
      background: transparent;
      font-family: inherit;
      font-size: 12px;
    }

    .kct-brand:hover {
      background: var(--kct-pill-bg);
    }

    .kct-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #0ea5e9;
      flex-shrink: 0;
    }

    .kct-dot.kct-busy {
      background: #f59e0b;
      animation: kct-pulse 1.1s infinite ease-in-out;
    }

    .kct-dot.kct-err {
      background: #ef4444;
    }

    @keyframes kct-pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.38); opacity: 0.55; }
    }

    .kct-status {
      color: var(--kct-muted);
      font-size: 11px;
      max-width: 118px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .kct-controls {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .kct-pill.kct-collapsed .kct-controls,
    .kct-pill.kct-collapsed .kct-status {
      display: none;
    }

    .kct-seg {
      display: inline-flex;
      background: var(--kct-pill-bg);
      border-radius: 999px;
      padding: 2px;
      gap: 2px;
    }

    button {
      all: unset;
      box-sizing: border-box;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 999px;
      font-family: var(--kct-font);
      font-size: 12px;
      line-height: 1.2;
      color: var(--kct-muted);
      transition: background 0.15s ease, color 0.15s ease;
    }

    button:hover {
      background: var(--kct-pill-bg);
      color: var(--kct-text);
    }

    .kct-seg button {
      background: transparent;
      padding: 4px 9px;
      font-weight: 500;
    }

    .kct-seg button.kct-active {
      background: var(--kct-pill-active);
      color: var(--kct-accent);
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.14);
    }

    .kct-lang-select {
      appearance: none;
      -webkit-appearance: none;
      border: 1px solid transparent;
      background: var(--kct-pill-bg);
      color: var(--kct-text);
      font-family: var(--kct-font);
      font-size: 11px;
      font-weight: 500;
      padding: 4px 8px;
      border-radius: 999px;
      cursor: pointer;
      outline: none;
      max-width: 92px;
    }

    .kct-lang-select:hover,
    .kct-lang-select:focus {
      border-color: var(--kct-border);
    }

    .kct-icon-btn {
      padding: 4px 7px;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .kct-star-btn.kct-starred {
      color: var(--kct-star);
    }

    .kct-close-btn:hover {
      color: #ef4444;
    }
  `;

  function removeFloatingWidget() {
    if (widgetHostEl) {
      widgetHostEl.remove();
      widgetHostEl = null;
      widgetShadow = null;
    }
  }

  function createFloatingWidget() {
    if (!isTopFrame() || widgetHostEl) return;
    if (state.settings && state.settings.showFloatingBall === false) return;
    if (!document.body) return;

    const host = document.createElement('div');
    host.id = 'kct-widget-host';
    host.setAttribute('data-kct-ui', 'widget');
    host.setAttribute('translate', 'no');
    if (isDarkPageHint()) {
      host.classList.add('kct-dark');
    }

    const shadow = host.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.textContent = WIDGET_SHADOW_CSS;

    const pill = document.createElement('div');
    pill.className = widgetCollapsed ? 'kct-pill kct-collapsed' : 'kct-pill';

    // Brand / collapse toggle
    const brand = document.createElement('button');
    brand.type = 'button';
    brand.className = 'kct-brand';
    brand.title = '點擊展開或收起翻譯控制列';

    const dot = document.createElement('span');
    dot.className = 'kct-dot';
    const brandText = document.createElement('span');
    brandText.textContent = '譯';
    brand.append(dot, brandText);

    brand.addEventListener('click', () => {
      widgetCollapsed = !widgetCollapsed;
      pill.classList.toggle('kct-collapsed', widgetCollapsed);
    });

    const status = document.createElement('span');
    status.className = 'kct-status';
    status.textContent = '就緒';

    const controls = document.createElement('div');
    controls.className = 'kct-controls';

    // Mode segmented control
    const seg = document.createElement('div');
    seg.className = 'kct-seg';
    const modes = [
      { id: 'replace', label: '譯文', title: '以原版排版風格呈現譯文' },
      { id: 'original', label: '原文', title: '瞬間切回網頁原文' },
      { id: 'bilingual', label: '雙語', title: '簡潔雙語對照模式' }
    ];
    for (const m of modes) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.mode = m.id;
      btn.textContent = m.label;
      btn.title = m.title;
      btn.addEventListener('click', async () => {
        state.settings = await saveSettings({ displayMode: m.id });
        Renderer.applyDisplayModeClass(state.settings);
        updateWidgetUI();
      });
      seg.appendChild(btn);
    }

    // Target language selector
    const langSelect = document.createElement('select');
    langSelect.className = 'kct-lang-select';
    langSelect.title = '切換目標翻譯語言';
    for (const lang of Object.values(TARGET_LANGUAGES)) {
      const opt = document.createElement('option');
      opt.value = lang.id;
      opt.textContent = lang.shortLabel;
      langSelect.appendChild(opt);
    }
    langSelect.value = state.settings?.targetLang || 'zh-TW';
    langSelect.addEventListener('change', async (e) => {
      const val = e.target.value;
      if (val === 'custom' && !state.settings?.customTargetLang) {
        await chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
        langSelect.value = state.settings?.targetLang || 'zh-TW';
        return;
      }
      // Do NOT overwrite state.settings before storage.onChanged fires so prev.targetLang diff triggers re-translation
      await saveSettings({ targetLang: val });
    });

    // Per-site auto-translate whitelist star button
    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = 'kct-icon-btn kct-star-btn';
    starBtn.textContent = '☆';
    starBtn.addEventListener('click', async () => {
      if (typeof toggleHostWhitelist !== 'function') return;
      try {
        const res = await toggleHostWhitelist(location.hostname);
        if (res?.settings) {
          state.settings = res.settings;
        }
        updateWidgetUI();
      } catch (_) {}
    });

    // Re-scan button
    const rescanBtn = document.createElement('button');
    rescanBtn.type = 'button';
    rescanBtn.className = 'kct-icon-btn';
    rescanBtn.textContent = '↻';
    rescanBtn.title = '重新掃描並翻譯目前頁面（含程式碼註解與內嵌框架）';
    rescanBtn.addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({
          type: 'BROADCAST_TO_TAB',
          payload: { type: 'KCT_COMMAND', action: 'TRANSLATE_NOW' }
        });
      } catch (_) {
        scanAndTranslate(true);
      }
    });

    // Options button
    const optBtn = document.createElement('button');
    optBtn.type = 'button';
    optBtn.className = 'kct-icon-btn';
    optBtn.textContent = '⚙';
    optBtn.title = '開啟翻譯引擎、API Key、排版與白名單設定';
    optBtn.addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
      } catch (_) {}
    });

    // Close & revert button
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'kct-icon-btn kct-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = '還原網頁原文並關閉翻譯工具列';
    closeBtn.addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({
          type: 'BROADCAST_TO_TAB',
          payload: { type: 'KCT_COMMAND', action: 'CLEAR_PAGE' }
        });
      } catch (_) {}
      resetAndClearPage(true);
    });

    controls.append(seg, langSelect, starBtn, rescanBtn, optBtn, closeBtn);
    pill.append(brand, status, controls);
    shadow.append(styleEl, pill);
    document.body.appendChild(host);

    widgetHostEl = host;
    widgetShadow = shadow;
    updateWidgetUI();
  }

  function updateWidgetUI() {
    if (!isTopFrame()) {
      reportStatusToTop();
      return;
    }
    if (!widgetShadow) return;

    const dot = widgetShadow.querySelector('.kct-dot');
    const status = widgetShadow.querySelector('.kct-status');
    const modeBtns = widgetShadow.querySelectorAll('.kct-seg button');
    const langSel = widgetShadow.querySelector('.kct-lang-select');
    const starBtn = widgetShadow.querySelector('.kct-star-btn');
    const agg = getAggregatedStats();

    if (widgetHostEl) {
      widgetHostEl.classList.toggle('kct-dark', isDarkPageHint());
    }

    dot.classList.remove('kct-busy', 'kct-err');
    const hasKey =
      Boolean(state.settings?.apiKey?.trim()) ||
      /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(state.settings?.baseUrl || '');

    if (agg.lastErrorMsg) {
      dot.classList.add('kct-err');
      status.textContent = agg.lastErrorMsg;
      status.title = agg.lastErrorMsg;
    } else if (agg.isBusy) {
      dot.classList.add('kct-busy');
      const label = state.settings?.streamTranslation !== false ? '串流中' : '翻譯中';
      status.textContent = `${label} ${agg.totalTranslated}/${agg.totalDetected}`;
      status.title = status.textContent;
    } else if (!hasKey) {
      dot.classList.add('kct-err');
      status.textContent = '未設定 API Key';
      status.title = '請點選「⚙」填寫大模型 API Key';
    } else if (!state.settings?.enabled) {
      status.textContent = agg.totalTranslated > 0 ? `已譯 ${agg.totalTranslated} 項（已暫停）` : '已暫停';
      status.title = '全域翻譯開關已關閉，點擊「↻」可啟用並翻譯';
    } else if (agg.totalTranslated > 0) {
      status.textContent = `已譯 ${agg.totalTranslated} 項`;
      status.title = status.textContent;
    } else {
      status.textContent = '就緒';
      status.title = status.textContent;
    }

    const curMode = state.settings?.displayMode || 'replace';
    for (const btn of modeBtns) {
      btn.classList.toggle('kct-active', btn.dataset.mode === curMode);
    }

    if (langSel && state.settings?.targetLang) {
      langSel.value = state.settings.targetLang;
    }

    if (starBtn) {
      const whitelisted = typeof isHostWhitelisted === 'function'
        ? isHostWhitelisted(location.hostname, state.settings)
        : false;
      starBtn.textContent = whitelisted ? '★' : '☆';
      starBtn.classList.toggle('kct-starred', whitelisted);
      starBtn.title = whitelisted
        ? `已加入自動翻譯白名單（${location.hostname}），點擊移除`
        : `將 ${location.hostname} 加入自動翻譯白名單`;
    }
  }

  // =========================================================
  // Shadow DOM Selection Trigger & Popover
  // =========================================================
  const SELECTION_SHADOW_CSS = `
    :host {
      all: initial;
      color-scheme: light dark;
      position: fixed;
      inset: 0;
      z-index: 2147483002;
      pointer-events: none;
      --kct-accent: #0284c7;
      --kct-accent-hover: #0369a1;
      --kct-border: rgba(15, 23, 42, 0.12);
      --kct-text: #0f172a;
      --kct-muted: #64748b;
      --kct-bg: rgba(255, 255, 255, 0.92);
      --kct-pill-bg: rgba(15, 23, 42, 0.06);
      --kct-font: -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", "Segoe UI", sans-serif;
    }

    @media (prefers-color-scheme: dark) {
      :host {
        --kct-accent: #38bdf8;
        --kct-accent-hover: #0ea5e9;
        --kct-border: rgba(255, 255, 255, 0.16);
        --kct-text: #f1f5f9;
        --kct-muted: #94a3b8;
        --kct-bg: rgba(15, 23, 42, 0.92);
        --kct-pill-bg: rgba(255, 255, 255, 0.1);
      }
    }

    :host(.kct-dark) {
      color-scheme: dark;
      --kct-accent: #38bdf8;
      --kct-accent-hover: #0ea5e9;
      --kct-border: rgba(255, 255, 255, 0.16);
      --kct-text: #f1f5f9;
      --kct-muted: #94a3b8;
      --kct-bg: rgba(15, 23, 42, 0.92);
      --kct-pill-bg: rgba(255, 255, 255, 0.1);
    }

    .kct-sel-btn {
      pointer-events: auto;
      position: fixed;
      font-family: var(--kct-font);
      background: var(--kct-accent);
      color: #ffffff;
      border: none;
      border-radius: 999px;
      padding: 4px 11px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 6px 18px rgba(2, 132, 199, 0.36);
      transition: background 0.15s ease, transform 0.15s ease;
    }

    .kct-sel-btn:hover {
      background: var(--kct-accent-hover);
      transform: translateY(-1px);
    }

    .kct-sel-popover {
      pointer-events: auto;
      position: fixed;
      width: min(390px, calc(100vw - 24px));
      max-height: 300px;
      overflow-y: auto;
      font-family: var(--kct-font);
      background: var(--kct-bg);
      backdrop-filter: blur(16px) saturate(160%);
      -webkit-backdrop-filter: blur(16px) saturate(160%);
      color: var(--kct-text);
      border: 1px solid var(--kct-border);
      border-radius: 12px;
      padding: 10px 13px;
      box-shadow: 0 14px 36px rgba(15, 23, 42, 0.22);
      font-size: 13px;
      line-height: 1.68;
      box-sizing: border-box;
    }

    .kct-pop-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
      font-size: 12px;
      color: var(--kct-accent);
      font-weight: 600;
    }

    .kct-pop-actions {
      display: flex;
      gap: 6px;
    }

    .kct-pop-actions button {
      all: unset;
      cursor: pointer;
      color: var(--kct-muted);
      font-size: 12px;
      padding: 2px 7px;
      border-radius: 6px;
      font-family: var(--kct-font);
    }

    .kct-pop-actions button:hover {
      background: var(--kct-pill-bg);
      color: var(--kct-text);
    }

    .kct-pop-body {
      white-space: pre-wrap;
      word-break: break-word;
    }
  `;

  function ensureSelectionHost() {
    if (selHostEl && selHostEl.isConnected && selShadow) {
      selHostEl.classList.toggle('kct-dark', isDarkPageHint());
      return selShadow;
    }
    const host = document.createElement('div');
    host.id = 'kct-selection-host';
    host.setAttribute('data-kct-ui', 'selection');
    host.setAttribute('translate', 'no');
    if (isDarkPageHint()) {
      host.classList.add('kct-dark');
    }

    const shadow = host.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.textContent = SELECTION_SHADOW_CSS;
    shadow.appendChild(styleEl);

    (document.body || document.documentElement).appendChild(host);
    selHostEl = host;
    selShadow = shadow;
    return shadow;
  }

  function removeSelectionUI() {
    if (selBtnEl) {
      selBtnEl.remove();
      selBtnEl = null;
    }
    if (selPopoverEl) {
      selPopoverEl.remove();
      selPopoverEl = null;
    }
    if (selHostEl) {
      selHostEl.remove();
      selHostEl = null;
      selShadow = null;
    }
  }

  function clampPosition(x, y, width, height) {
    const maxX = Math.max(12, window.innerWidth - width - 12);
    const maxY = Math.max(12, window.innerHeight - height - 12);
    return {
      left: Math.min(Math.max(12, x), maxX),
      top: Math.min(Math.max(12, y), maxY)
    };
  }

  function showSelectionPopover(x, y, text) {
    const cleanText = String(text || '').trim();
    if (!cleanText) return;
    removeSelectionUI();

    const shadow = ensureSelectionHost();

    const pop = document.createElement('div');
    pop.className = 'kct-sel-popover';

    const head = document.createElement('div');
    head.className = 'kct-pop-head';
    const title = document.createElement('span');
    title.textContent = 'AI 劃詞翻譯';

    const actions = document.createElement('div');
    actions.className = 'kct-pop-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = '複製';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', removeSelectionUI);

    actions.append(copyBtn, closeBtn);
    head.append(title, actions);

    const body = document.createElement('div');
    body.className = 'kct-pop-body';
    body.textContent = '正在翻譯...';

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(body.textContent || '');
        copyBtn.textContent = '已複製';
        setTimeout(() => {
          copyBtn.textContent = '複製';
        }, 1200);
      } catch (_) {}
    });

    pop.append(head, body);
    shadow.appendChild(pop);

    const pos = clampPosition(x, y + 10, 390, 220);
    pop.style.left = `${pos.left}px`;
    pop.style.top = `${pos.top}px`;
    selPopoverEl = pop;

    (async () => {
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'TRANSLATE_SINGLE',
          text: cleanText.slice(0, 3000),
          pageContext: getPageContext()
        });
        if (!pop.isConnected) return;
        body.textContent = res?.ok ? res.zh : (res?.error || '翻譯失敗');
      } catch (err) {
        if (!pop.isConnected) return;
        body.textContent = err?.message || '翻譯失敗';
      }
    })();
  }

  function getSelectionAnchorCoords() {
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect && (rect.width > 0 || rect.height > 0)) {
          return { x: rect.left, y: rect.bottom };
        }
      }
    } catch (_) {}
    return {
      x: Math.max(24, Math.floor((window.innerWidth - 390) / 2)),
      y: Math.min(120, Math.floor(window.innerHeight * 0.2))
    };
  }

  function setupSelectionListener() {
    document.addEventListener('mouseup', (e) => {
      if (!state.settings?.selectionTranslate) return;
      const path = e.composedPath ? e.composedPath() : [];
      if (path.some((n) => n === widgetHostEl || n === selHostEl)) return;
      if (e.target && e.target.closest && e.target.closest('[data-kct-ui]')) return;

      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel ? sel.toString().trim() : '';
        const targetLangId = state.settings?.targetLang || 'zh-TW';
        if (!text || text.length < 2 || text.length > 2500 || !shouldTranslateText(text, targetLangId)) {
          if (!selPopoverEl) removeSelectionUI();
          return;
        }
        currentSelectionText = text;
        if (selBtnEl) {
          selBtnEl.remove();
          selBtnEl = null;
        }

        const shadow = ensureSelectionHost();
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kct-sel-btn';
        btn.textContent = '譯';
        const pos = clampPosition(e.clientX + 8, e.clientY + 10, 44, 28);
        btn.style.left = `${pos.left}px`;
        btn.style.top = `${pos.top}px`;
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          showSelectionPopover(pos.left, pos.top, currentSelectionText);
        });
        shadow.appendChild(btn);
        selBtnEl = btn;
      }, 20);
    });

    document.addEventListener('mousedown', (e) => {
      const path = e.composedPath ? e.composedPath() : [];
      if (path.some((n) => n === selHostEl)) return;
      removeSelectionUI();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') removeSelectionUI();
    });
  }

  // =========================================================
  // Observers & SPA Lifecycle
  // =========================================================
  function setupObservers() {
    const observer = new MutationObserver((mutations) => {
      if (!pageActive) return;
      let hasExternalNodes = false;
      for (const m of mutations) {
        if (m.target && m.target.closest && m.target.closest('[data-kct-ui]')) continue;
        if (m.addedNodes && m.addedNodes.length > 0) {
          for (const n of m.addedNodes) {
            if (n.nodeType === Node.ELEMENT_NODE && !n.matches('[data-kct-ui]')) {
              hasExternalNodes = true;
              break;
            }
          }
        }
        if (hasExternalNodes) break;
      }
      if (hasExternalNodes) {
        scheduleScan(300);
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener('resize', () => {
      if (!pageActive) return;
      scheduleCmSync();
    });

    window.addEventListener('popstate', () => scheduleScan(400));
    window.addEventListener('hashchange', () => scheduleScan(400));
    window.addEventListener('pagehide', () => {
      cancelAllActiveStreams();
      if (streamPort) {
        try {
          streamPort.disconnect();
        } catch (_) {}
        streamPort = null;
      }
    });

    let scrollTimer = null;
    const onScrollOrBlur = () => {
      if (!pageActive) return;
      scheduleCmSync();
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        if (!pageActive) return;
        if (state.pendingItems.length > 0) {
          sortViewportFirst(state.pendingItems);
        }
        // Only trigger DOM rescan on scroll for notebook/virtualized editors or when lazyViewport is off
        if (pageInfo.pageType === 'notebook' || state.settings?.lazyViewport === false) {
          scheduleScan(280);
        }
      }, 280);
    };
    document.addEventListener('scroll', onScrollOrBlur, { passive: true, capture: true });
    document.addEventListener('focusout', () => {
      if (!pageActive) return;
      scheduleCmSync();
      if (pageInfo.pageType === 'notebook') {
        scheduleScan(220);
      }
    });
  }

  // =========================================================
  // Activation Helper & Runtime Message Router
  // =========================================================
  async function activateAndTranslate() {
    state.settings = await getSettings();
    const patch = {};
    if (!state.settings.enabled) patch.enabled = true;
    if (state.settings.displayMode === 'original') patch.displayMode = 'replace';
    if (Object.keys(patch).length > 0) {
      state.settings = { ...state.settings, ...patch };
      if (isTopFrame()) {
        state.settings = await saveSettings(patch);
      }
    }
    pageActive = true;
    pageInfo = classifyPage();
    Renderer.applyDisplayModeClass(state.settings);
    if (isTopFrame() && state.settings.showFloatingBall !== false) {
      createFloatingWidget();
    }
    scanAndTranslate(true);

    // Staggered hydration follow-ups for async React / Jupyter / SPA renders
    clearHydrationTimers();
    for (const delay of [900, 2400]) {
      const id = setTimeout(() => {
        if (pageActive) scanAndTranslate(false);
      }, delay);
      hydrationTimers.push(id);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'KCT_GET_STATUS') {
      if (!isTopFrame()) return false;
      const agg = getAggregatedStats();
      sendResponse({
        ok: true,
        isTop: true,
        totalDetected: agg.totalDetected,
        totalTranslated: agg.totalTranslated,
        isBusy: agg.isBusy,
        lastErrorMsg: agg.lastErrorMsg,
        pageType: pageInfo.pageType,
        host: pageInfo.host
      });
      return false;
    }

    if (message?.type === 'KCT_DIAG') {
      const roots = findContentRoots(state.settings?.scope || 'course', pageInfo);
      const allPs = Array.from(document.querySelectorAll('p, h1, h2, h3, li')).slice(0, 8);
      const samples = allPs.map((el) => ({
        tag: el.tagName,
        text: (el.innerText || '').slice(0, 50),
        state: state.elementState.get(el) || null,
        skipAncestor: Boolean(el.closest(SKIP_ANCESTOR_SELECTOR)),
        navExclude: Boolean(el.closest(NAV_EXCLUDE_SELECTOR)),
        visible: isElementVisible(el),
        inRoots: roots.some((r) => r.contains(el))
      }));
      sendResponse({
        ok: true,
        href: location.href.slice(0, 120),
        isTop: isTopFrame(),
        pageActive,
        pageInfo,
        htmlClass: document.documentElement.className,
        roots: roots.map((r) => `${r.tagName}#${r.id}.${String(r.className || '').slice(0, 40)}`),
        totalPs: document.querySelectorAll('p').length,
        cmEditors: document.querySelectorAll('.cm-editor').length,
        transComments: document.querySelectorAll('[data-kct-comment-trans]').length,
        lazyObservedCount: observedJobs.size,
        totalTranslated: state.totalTranslated,
        totalDetected: state.totalDetected,
        lastErrorMsg: state.lastErrorMsg,
        subframes: Array.from(subframeStats.entries()),
        samples
      });
      return false;
    }

    if (message?.type === 'KCT_FRAME_STATUS') {
      if (!isTopFrame()) return false;
      if (message.frameId !== undefined && message.stats) {
        subframeStats.set(message.frameId, message.stats);
        updateWidgetUI();
      }
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === 'KCT_COMMAND') {
      (async () => {
        await initPromise;
        switch (message.action) {
          case 'TRANSLATE_NOW':
            await activateAndTranslate();
            break;

          case 'RETRANSLATE':
            resetAndClearPage(false);
            await activateAndTranslate();
            break;

          case 'CLEAR_PAGE':
            resetAndClearPage(true);
            break;

          case 'TOGGLE_OR_TRANSLATE': {
            if (!isTopFrame()) break;
            const agg = getAggregatedStats();
            if (agg.totalTranslated > 0) {
              const nextMode = state.settings.displayMode === 'original' ? 'replace' : 'original';
              state.settings = await saveSettings({ displayMode: nextMode });
              Renderer.applyDisplayModeClass(state.settings);
              updateWidgetUI();
            } else {
              // Broadcast TRANSLATE_NOW once to all frames (including top frame + Notebook iframes)
              try {
                await chrome.runtime.sendMessage({
                  type: 'BROADCAST_TO_TAB',
                  payload: { type: 'KCT_COMMAND', action: 'TRANSLATE_NOW' }
                });
              } catch (_) {
                await activateAndTranslate();
              }
            }
            break;
          }

          case 'TRANSLATE_SELECTION': {
            const text = String(message.selectionText || window.getSelection()?.toString() || '').trim();
            if (!text) break;
            const localSelection = window.getSelection()?.toString().trim() || '';
            // If selection lives inside a focused iframe, let that subframe open the popover
            if (!isTopFrame() && !localSelection) break;
            if (isTopFrame() && !localSelection && document.activeElement?.tagName === 'IFRAME') break;
            const coords = getSelectionAnchorCoords();
            showSelectionPopover(coords.x, coords.y, text);
            break;
          }
        }
        sendResponse({ ok: true });
      })();
      return true;
    }

    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
    const nextSettings = changes[SETTINGS_KEY].newValue;
    if (!nextSettings) return;
    const prev = state.settings;
    state.settings = nextSettings;
    Renderer.applyDisplayModeClass(state.settings);

    if (isTopFrame()) {
      if (state.settings.showFloatingBall === false && widgetHostEl) {
        removeFloatingWidget();
      } else if (pageActive && state.settings.showFloatingBall !== false && !widgetHostEl) {
        createFloatingWidget();
      }
    }

    if (pageActive) {
      if (prev && prev.enabled && !state.settings.enabled) {
        resetAndClearPage(false);
      } else if (
        prev &&
        state.settings.enabled &&
        (
          prev.scope !== state.settings.scope ||
          prev.targetLang !== state.settings.targetLang ||
          prev.customTargetLang !== state.settings.customTargetLang ||
          prev.translateCodeComments !== state.settings.translateCodeComments ||
          prev.customGlossary !== state.settings.customGlossary ||
          prev.model !== state.settings.model ||
          prev.protocol !== state.settings.protocol ||
          prev.lazyViewport !== state.settings.lazyViewport ||
          !prev.enabled
        )
      ) {
        resetAndClearPage(false);
        scanAndTranslate(true);
      }
    }

    updateWidgetUI();
  });

  async function init() {
    state.settings = await getSettings();
    pageInfo = classifyPage();
    Renderer.applyDisplayModeClass(state.settings);
    setupSelectionListener();
    setupObservers();
    // Stay silent until activated by KCT_COMMAND (TRANSLATE_NOW / RETRANSLATE / TOGGLE_OR_TRANSLATE)
  }

  const initPromise = init();
})();
