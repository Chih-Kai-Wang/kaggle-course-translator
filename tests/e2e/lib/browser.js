import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { withBrowserLock } from './lock.js';
import { redactSecrets } from './assertions.js';

// NATIVEREAD_EGO_BIN lets the harness's own control flow be exercised against a
// fake ego-browser (offline, never touching the user's real profile).
export const EGO_BIN = process.env.NATIVEREAD_EGO_BIN || '/Users/wangzhikai/.local/bin/ego-browser';
export const EXTENSION_ID = 'ckeknfhpandgmippabbfkndmndainpff';
export const EXT_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

export class HarnessError extends Error {
  constructor(message) {
    super(redactSecrets(message));
    this.name = 'HarnessError';
    this.isInfraError = true;
    this.exitCode = 2;
  }
}

// ---------------------------------------------------------------------------
// Settings-guard plumbing (see lib/settings-guard.js).
//
// runEgoScript() refuses to touch the browser unless the harness has taken a
// snapshot of the user's real kct_settings_v1 first ("armed"). Every test runs
// inside testContext; when the harness abandons a test (hard timeout / signal)
// it sets store.aborted so the abandoned promise can never open another
// browser session after the harness has restored the user's settings.
// ---------------------------------------------------------------------------
export const testContext = new AsyncLocalStorage();

let settingsGuardArmed = false;
let globalBrowserAbort = false;
let egoScriptRunCount = 0;
const activeEgoChildren = new Set();

export function setSettingsGuardArmed(value) {
  settingsGuardArmed = Boolean(value);
}

export function isSettingsGuardArmed() {
  return settingsGuardArmed;
}

/** Blocks every future runEgoScript() call in this process (used on SIGINT/SIGTERM). */
export function abortAllBrowserScripts() {
  globalBrowserAbort = true;
}

/** Monotonic count of runEgoScript() sessions started; lets the guard skip no-op restores. */
export function getEgoScriptRunCount() {
  return egoScriptRunCount;
}

/** Sends SIGTERM (then SIGKILL) to every in-flight ego-browser child. */
export function killActiveEgoChildren() {
  for (const child of activeEgoChildren) {
    try {
      child.kill('SIGTERM');
    } catch (_) {}
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (_) {}
    }, 2000).unref();
  }
}

function assertBrowserAccessAllowed() {
  if (globalBrowserAbort) {
    throw new HarnessError('Browser access aborted: harness is shutting down');
  }
  if (testContext.getStore()?.aborted) {
    throw new HarnessError('Browser access refused: this test was abandoned by the harness (timeout)');
  }
  if (!settingsGuardArmed) {
    throw new HarnessError(
      'Browser access refused: settings guard is not armed. Run suites through tests/e2e/run.js so kct_settings_v1 is snapshotted first.'
    );
  }
}

export function runEgoStdin(driverSource, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(EGO_BIN, ['nodejs'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    activeEgoChildren.add(child);

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let killTimer = null;
    let giveUpTimer = null;

    // On timeout we do NOT reject immediately: the caller holds the browser lock
    // and must not release it while the child may still be writing settings.
    // We reject on 'close' (child really gone), or after SIGKILL + grace period.
    const hardTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch (_) {}
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (_) {}
        giveUpTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          activeEgoChildren.delete(child);
          reject(new HarnessError(`ego-browser timed out after ${timeoutMs}ms (child did not exit after SIGKILL)`));
        }, 5000);
      }, 3000);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    const clearTimers = () => {
      clearTimeout(hardTimer);
      if (killTimer) clearTimeout(killTimer);
      if (giveUpTimer) clearTimeout(giveUpTimer);
    };

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimers();
      activeEgoChildren.delete(child);
      reject(new HarnessError(`Failed to spawn ego-browser: ${err?.message || err}`));
    });

    child.on('close', (code, signal) => {
      activeEgoChildren.delete(child);
      if (settled) return;
      settled = true;
      clearTimers();
      if (timedOut) {
        reject(new HarnessError(`ego-browser timed out after ${timeoutMs}ms`));
        return;
      }
      resolve({ code, signal, stdout, stderr });
    });

    child.stdin.on('error', () => {
      // Child may close stdin early on syntax/startup failure; close event handles it
    });
    child.stdin.end(driverSource, 'utf8');
  });
}

function buildDriverHelpersSource() {
  return `
const EXTENSION_ID = ${JSON.stringify(EXTENSION_ID)};
const EXT_ORIGIN = ${JSON.stringify(EXT_ORIGIN)};

const __HELPERS__ = {
  EXTENSION_ID,
  EXT_ORIGIN,

  async setPopupViewport(page) {
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width: 380,
      height: 600,
      deviceScaleFactor: 2,
      mobile: false
    });
    await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  },

  async setDesktopViewport(page, width = 1280, height = 800) {
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    });
    await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  },

  async setMobileViewport(page, width = 390, height = 844) {
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: width,
      screenHeight: height
    });
    await page.cdp('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 5
    });
  },

  async clearViewportOverride(page) {
    await page.cdp('Emulation.clearDeviceMetricsOverride');
    await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  },

  async setColorScheme(page, scheme) {
    const features = scheme ? [{ name: 'prefers-color-scheme', value: scheme }] : [];
    await page.cdp('Emulation.setEmulatedMedia', { features });
  },

  async enableEventCapture(page) {
    await page.cdp('egoAutomated.disable');
    await page.cdp('Runtime.enable');
    await page.cdp('Network.enable');
    await page.events();
  },

  async collectEvents(page) {
    const events = await page.events();
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    for (const ev of events) {
      if (ev.method === 'Runtime.consoleAPICalled' && ev.params?.type === 'error') {
        const text = (ev.params.args || [])
          .map((a) => a.value ?? a.description ?? '')
          .join(' ')
          .trim();
        consoleErrors.push({ text, timestamp: ev.params.timestamp });
      } else if (ev.method === 'Runtime.exceptionThrown') {
        const d = ev.params?.exceptionDetails || {};
        pageErrors.push({
          text: d.exception?.description || d.text || 'Uncaught exception',
          url: d.url || ''
        });
      } else if (ev.method === 'Network.loadingFailed') {
        failedRequests.push({
          errorText: ev.params?.errorText || '',
          type: ev.params?.type || '',
          canceled: Boolean(ev.params?.canceled)
        });
      }
    }
    return { consoleErrors, pageErrors, failedRequests, rawCount: events.length };
  },

  async triggerExtensionOnTab(task, targetUrlPrefix, action = 'TRANSLATE_NOW', payload = null) {
    const beforeTabs = await task.tabs();
    const knownTargetIds = new Set(beforeTabs.map((t) => t.targetId));
    const pExt = await task.newPage();
    try {
      await pExt.goto(EXT_ORIGIN + '/popup/popup.html', { waitUntil: 'domcontentloaded' });
      const res = await pExt.evaluate(
        async ({ prefix, cmdAction, cmdPayload }) => {
          const tabs = await chrome.tabs.query({});
          const candidates = tabs.filter((t) => typeof t.url === 'string' && t.url.startsWith(prefix));
          const target = candidates.find((t) => t.active) || candidates[candidates.length - 1];
          if (!target || typeof target.id !== 'number') {
            return { ok: false, errorCode: 'TAB_NOT_FOUND', error: 'Target tab not found for prefix: ' + prefix };
          }
          const msg = { type: 'ENSURE_AND_COMMAND', tabId: target.id, action: cmdAction };
          if (cmdPayload && typeof cmdPayload === 'object') {
            msg.payload = cmdPayload;
          }
          return await chrome.runtime.sendMessage(msg);
        },
        { prefix: targetUrlPrefix, cmdAction: action, cmdPayload: payload }
      );
      let adoptedPdfPage = null;
      if (res?.openedPdfViewer) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const afterTabs = await task.tabs();
          const newPdfTab = afterTabs.find(
            (t) =>
              !knownTargetIds.has(t.targetId) &&
              typeof t.url === 'string' &&
              t.url.startsWith(EXT_ORIGIN + '/viewer/pdf-viewer.html')
          );
          if (newPdfTab) {
            adoptedPdfPage = newPdfTab.label
              ? task.page(newPdfTab.label)
              : await task.adopt(newPdfTab.page);
            break;
          }
          await pExt.waitForTimeout(150);
        }
      }
      return { response: res, pdfViewerLabel: adoptedPdfPage ? adoptedPdfPage.label : null };
    } finally {
      try {
        await pExt.close();
      } catch (_) {}
    }
  },

  async getStorageSafe(pExt) {
    return await pExt.evaluate(async () => {
      const data = await chrome.storage.local.get('kct_settings_v1');
      const s = data?.kct_settings_v1 || null;
      if (!s) return null;
      const trimmedKey = typeof s.apiKey === 'string' ? s.apiKey.trim() : '';
      return {
        settingsSchemaVersion: s.settingsSchemaVersion ?? null,
        enabled: Boolean(s.enabled),
        autoTranslate: Boolean(s.autoTranslate),
        autoTranslateHosts: Array.isArray(s.autoTranslateHosts) ? [...s.autoTranslateHosts] : [],
        providerId: s.providerId || '',
        protocol: s.protocol || '',
        baseUrl: s.baseUrl || '',
        model: s.model || '',
        targetLang: s.targetLang || '',
        customTargetLang: s.customTargetLang || '',
        displayMode: s.displayMode || '',
        scope: s.scope || '',
        thinkingEffort: s.thinkingEffort || '',
        typographyMatch: s.typographyMatch || '',
        streamTranslation: s.streamTranslation !== false,
        lazyViewport: s.lazyViewport !== false,
        hasApiKey: trimmedKey.length > 0,
        apiKeyLength: trimmedKey.length
      };
    });
  }
};
`;
}

export async function runEgoScript(
  bodyFnOrSource,
  {
    args = {},
    namePrefix = 'nativeread-e2e',
    timeoutMs = 120000,
    lockTimeoutMs = 180000
  } = {}
) {
  assertBrowserAccessAllowed();
  egoScriptRunCount++;
  return await withBrowserLock(
    async () => {
      // Re-check after waiting for the lock: the harness may have abandoned this
      // test (and restored settings) while we were queued.
      assertBrowserAccessAllowed();
      const rand = Math.random().toString(36).slice(2, 8);
      const resultPath = path.join(
        os.tmpdir(),
        `nr_ego_res_${process.pid}_${Date.now()}_${rand}.json`
      );
      const spaceName = `${namePrefix}-${Date.now()}-${rand}`;
      const fnSource =
        typeof bodyFnOrSource === 'function'
          ? bodyFnOrSource.toString()
          : `async ({ task, page, args, helpers }) => {\n${bodyFnOrSource}\n}`;

      const driverSource = `
const __fs = await import('node:fs/promises');
const __ARGS__ = ${JSON.stringify(args)};
const __RESULT_PATH__ = ${JSON.stringify(resultPath)};
const __SPACE_NAME__ = ${JSON.stringify(spaceName)};
${buildDriverHelpersSource()}

const task = await taskSpace(__SPACE_NAME__);
let __out = { ok: false, error: { name: 'Error', message: 'Driver did not complete' } };
try {
  const page = task.page('p1');
  const __fn = (${fnSource});
  const data = await __fn({ task, page, args: __ARGS__, helpers: __HELPERS__ });
  __out = { ok: true, data: data ?? null };
} catch (err) {
  __out = {
    ok: false,
    error: {
      name: err?.name || 'Error',
      message: err?.message || String(err),
      stack: err?.stack || ''
    }
  };
} finally {
  try {
    await task.finish({ keep: [] });
  } catch (finErr) {
    if (__out.ok) {
      __out = {
        ok: false,
        error: {
          name: 'FinishError',
          message: finErr?.message || String(finErr),
          stack: finErr?.stack || ''
        }
      };
    }
  }
  await __fs.writeFile(__RESULT_PATH__, JSON.stringify(__out), 'utf8');
}
`;

      try {
        const { code, signal, stdout, stderr } = await runEgoStdin(driverSource, { timeoutMs });

        for (const line of `${stdout}\n${stderr}`.split('\n')) {
          if (line.includes('[ego-browser:notice]')) {
            console.warn(redactSecrets(line.trim()));
          }
        }

        let parsed = null;
        if (fs.existsSync(resultPath)) {
          const raw = fs.readFileSync(resultPath, 'utf8');
          parsed = JSON.parse(raw);
        }

        if (!parsed) {
          const tail = redactSecrets(`${stderr}\n${stdout}`.trim().slice(-800));
          throw new HarnessError(
            `ego-browser exited (${code ?? signal}) without writing resultPath. Output: ${tail}`
          );
        }

        if (!parsed.ok) {
          const msg = redactSecrets(parsed.error?.message || 'ego-browser script failed');
          const err = new Error(msg);
          err.name = parsed.error?.name || 'EgoScriptError';
          if (parsed.error?.stack) {
            err.remoteStack = redactSecrets(parsed.error.stack);
          }
          throw err;
        }

        return parsed.data;
      } finally {
        try {
          fs.rmSync(resultPath, { force: true });
        } catch (_) {}
      }
    },
    { timeoutMs: lockTimeoutMs }
  );
}

export async function listAgentTaskSpaces({ timeoutMs = 30000, lockTimeoutMs = 180000 } = {}) {
  return await withBrowserLock(
    async () => {
      const rand = Math.random().toString(36).slice(2, 8);
      const resultPath = path.join(os.tmpdir(), `nr_ego_list_${process.pid}_${Date.now()}_${rand}.json`);
      const src = `
const __fs = await import('node:fs/promises');
const spaces = await listTaskSpaces();
await __fs.writeFile(${JSON.stringify(resultPath)}, JSON.stringify(spaces), 'utf8');
`;
      try {
        const { code, signal, stderr } = await runEgoStdin(src, { timeoutMs });
        if (!fs.existsSync(resultPath)) {
          throw new HarnessError(
            `listTaskSpaces exited (${code ?? signal}) without result: ${redactSecrets(stderr)}`
          );
        }
        return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      } finally {
        try {
          fs.rmSync(resultPath, { force: true });
        } catch (_) {}
      }
    },
    { timeoutMs: lockTimeoutMs }
  );
}

export async function cleanupStaleTaskSpaces(
  prefix = 'nativeread-e2e',
  { timeoutMs = 30000, lockTimeoutMs = 180000 } = {}
) {
  return await withBrowserLock(
    async () => {
      const rand = Math.random().toString(36).slice(2, 8);
      const resultPath = path.join(os.tmpdir(), `nr_ego_clean_${process.pid}_${Date.now()}_${rand}.json`);
      const src = `
const __fs = await import('node:fs/promises');
const prefix = ${JSON.stringify(prefix)};
const spaces = await listTaskSpaces();
const closed = [];
for (const sp of spaces) {
  if (sp.ownership !== 'user' && typeof sp.name === 'string' && sp.name.startsWith(prefix)) {
    try {
      const t = await taskSpace(sp.id);
      await t.finish({ keep: [] });
      closed.push({ id: sp.id, name: sp.name });
    } catch (_) {}
  }
}
await __fs.writeFile(${JSON.stringify(resultPath)}, JSON.stringify(closed), 'utf8');
`;
      try {
        const { code, signal, stderr } = await runEgoStdin(src, { timeoutMs });
        if (!fs.existsSync(resultPath)) {
          throw new HarnessError(
            `cleanupStaleTaskSpaces exited (${code ?? signal}) without result: ${redactSecrets(stderr)}`
          );
        }
        return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      } finally {
        try {
          fs.rmSync(resultPath, { force: true });
        } catch (_) {}
      }
    },
    { timeoutMs: lockTimeoutMs }
  );
}
