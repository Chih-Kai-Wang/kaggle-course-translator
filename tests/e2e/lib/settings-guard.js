// Harness-level guard for the user's REAL extension settings.
//
// Why: on 2026-11-21 an e2e run left chrome.storage.local.kct_settings_v1 of the
// user's live Ego Lite profile pointing at a fake OpenAI endpoint/key, and the
// user's Gemini key was lost. This module makes that impossible to repeat:
//
//   * armSettingsGuard() snapshots kct_settings_v1 BEFORE any test touches the
//     browser. runEgoScript() refuses to run until the guard is armed.
//   * restoreSettingsSnapshot() writes the snapshot back, waits, reads it back
//     and compares SHA-256 hashes; any mismatch is a hard HarnessError.
//   * finalizeSettingsGuard() restores one last time and deletes the snapshot.
//
// Secret handling: the raw settings (including apiKey) never pass through this
// Node process, the driver source sent over stdin, stdout/stderr or any log.
// The ego-browser driver itself writes them straight to SNAPSHOT_PATH
// (mode 0600, inside a 0700 directory /tmp/nativeread-e2e-guard-<uid>, outside the repo) and
// reads them back from there on restore. Node only ever sees hashes and
// non-secret metadata (providerId, whether a key is present).
import fs from 'node:fs';
import path from 'node:path';
import { withBrowserLock } from './lock.js';
import { redactSecrets } from './assertions.js';
import {
  runEgoStdin,
  HarnessError,
  EXT_ORIGIN,
  cleanupStaleTaskSpaces,
  setSettingsGuardArmed,
  isSettingsGuardArmed,
  getEgoScriptRunCount
} from './browser.js';

export const SETTINGS_KEY = 'kct_settings_v1';
const UID = typeof process.getuid === 'function' ? process.getuid() : 'user';
// Fixed location (next to the browser lock in /tmp), deliberately NOT
// os.tmpdir(): that follows $TMPDIR, and a crashed run and the next run seeing
// different $TMPDIR values would miss the leftover snapshot and capture the
// poisoned settings as the "original". The override is honoured only together
// with NATIVEREAD_EGO_BIN (offline fake-driver testing).
const GUARD_DIR_OVERRIDE = process.env.NATIVEREAD_EGO_BIN ? process.env.NATIVEREAD_E2E_GUARD_DIR : '';
export const GUARD_DIR = GUARD_DIR_OVERRIDE || path.join('/tmp', `nativeread-e2e-guard-${UID}`);
export const SNAPSHOT_PATH = path.join(GUARD_DIR, 'settings-snapshot.json');
export const OWNER_PATH = path.join(GUARD_DIR, 'owner.json');

// A leftover snapshot younger than this (from a crashed run) is restored
// automatically; an older one needs an explicit --restore-settings /
// --discard-settings-snapshot so we never silently revert newer user changes.
const AUTO_RECOVER_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SETTLE_MS = 400;

let expectedHash = null;
let lastRestoredRunCount = -1;
let restoreChain = Promise.resolve();

// ---------------------------------------------------------------------------
// Driver (runs inside `ego-browser nodejs`). Written as a real function so that
// `node --check` parses it; it is serialised with toString() and must only use
// its parameters (no closures over this module).
// ---------------------------------------------------------------------------
async function guardDriverMain(cfg, { fs: dfs, crypto, taskSpace: openTaskSpace }) {
  const stable = (v) => {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') {
      return (
        '{' +
        Object.keys(v)
          .sort()
          .filter((k) => v[k] !== undefined)
          .map((k) => JSON.stringify(k) + ':' + stable(v[k]))
          .join(',') +
        '}'
      );
    }
    return JSON.stringify(v === undefined ? null : v);
  };
  const hashOf = (present, value) =>
    crypto
      .createHash('sha256')
      .update(present ? stable(value) : '<absent>')
      .digest('hex');
  const metaOf = (present, value) => ({
    present,
    providerId: present && value && typeof value.providerId === 'string' ? value.providerId : '',
    hasApiKey: Boolean(present && value && typeof value.apiKey === 'string' && value.apiKey.trim())
  });

  const out = { ok: false };
  let task = null;
  // Only a stage label + error NAME ever leaves the driver: exception messages
  // (e.g. a JSON.parse error on the snapshot) could quote secret material.
  let stage = 'open-taskspace';
  try {
    task = await openTaskSpace(cfg.spaceName);
    const page = task.page('p1');
    stage = 'open-options-page';
    await page.goto(cfg.extOrigin + '/options/options.html', { waitUntil: 'domcontentloaded' });
    // Let options.js finish its own load-time getSettings()/migration first.
    await page.waitForTimeout(cfg.settleMs);
    const read = () =>
      page.evaluate(async (key) => {
        const d = await chrome.storage.local.get(key);
        const present = Object.prototype.hasOwnProperty.call(d, key) && d[key] != null;
        return { present, value: present ? d[key] : null };
      }, cfg.key);

    if (cfg.mode === 'snapshot') {
      stage = 'snapshot-read';
      const cur = await read();
      stage = 'snapshot-write-file';
      const doc = { version: 1, key: cfg.key, present: cur.present, value: cur.value };
      // 'wx' => fail if a snapshot already exists (never overwrite the original).
      await dfs.writeFile(cfg.snapshotPath, JSON.stringify(doc), { flag: 'wx', mode: 0o600 });
      out.ok = true;
      out.hash = hashOf(cur.present, cur.value);
      out.meta = metaOf(cur.present, cur.value);
    } else if (cfg.mode === 'restore') {
      stage = 'restore-read-file';
      const doc = JSON.parse(await dfs.readFile(cfg.snapshotPath, 'utf8'));
      stage = 'restore-write-storage';
      const want = hashOf(doc.present, doc.value);
      let cur = null;
      let got = null;
      let attempts = 0;
      while (attempts < 3) {
        attempts++;
        await page.evaluate(
          async ({ key, present, value }) => {
            if (present) await chrome.storage.local.set({ [key]: value });
            else await chrome.storage.local.remove(key);
          },
          { key: cfg.key, present: doc.present, value: doc.value }
        );
        // Settle, then read back: a late async writer (e.g. a #nr_sync import
        // from tabs.onUpdated) would show up here and trigger another attempt.
        await page.waitForTimeout(cfg.settleMs);
        cur = await read();
        got = hashOf(cur.present, cur.value);
        if (got === want) break;
      }
      out.attempts = attempts;
      out.hash = want;
      out.ok = got === want;
      out.meta = metaOf(doc.present, doc.value);
      if (!out.ok) {
        // Report only the NAMES of differing fields, never values.
        const a = doc.present && doc.value && typeof doc.value === 'object' ? doc.value : {};
        const b = cur?.present && cur.value && typeof cur.value === 'object' ? cur.value : {};
        out.diffKeys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
          .filter((k) => stable(a[k]) !== stable(b[k]))
          .sort();
        out.error = 'read-back mismatch after restore';
      }
    } else {
      out.error = 'unknown guard mode';
    }
  } catch (err) {
    out.ok = false;
    out.error = `driver failed at stage "${stage}" (${String(err?.name || 'Error').slice(0, 40)})`;
  } finally {
    if (task) {
      try {
        await task.finish({ keep: [] });
      } catch (_) {}
    }
    await dfs.writeFile(cfg.resultPath, JSON.stringify(out), { mode: 0o600 });
  }
}

export function buildGuardDriverSource(cfg) {
  // cfg holds only paths/flags — never settings values.
  return `
const __fs = await import('node:fs/promises');
const __crypto = await import('node:crypto');
await (${guardDriverMain.toString()})(${JSON.stringify(cfg)}, { fs: __fs, crypto: __crypto, taskSpace });
`;
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------
function ensurePrivateGuardDir() {
  try {
    fs.mkdirSync(GUARD_DIR, { mode: 0o700 });
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
  }
  const st = fs.lstatSync(GUARD_DIR);
  if (!st.isDirectory() || st.isSymbolicLink()) {
    throw new HarnessError(`Settings guard dir is not a plain directory: ${GUARD_DIR}`);
  }
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    throw new HarnessError(`Settings guard dir is owned by another user: ${GUARD_DIR}`);
  }
  fs.chmodSync(GUARD_DIR, 0o700);
}

function snapshotExists() {
  return fs.existsSync(SNAPSHOT_PATH);
}

function readOwner() {
  try {
    return JSON.parse(fs.readFileSync(OWNER_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeOwner() {
  fs.writeFileSync(OWNER_PATH, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), {
    encoding: 'utf8',
    mode: 0o600
  });
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function snapshotAgeMs() {
  const owner = readOwner();
  if (owner && Number.isFinite(owner.createdAt)) return Date.now() - owner.createdAt;
  try {
    return Date.now() - fs.statSync(SNAPSHOT_PATH).mtimeMs;
  } catch (_) {
    return Infinity;
  }
}

function deleteSnapshotFiles() {
  for (const p of [SNAPSHOT_PATH, OWNER_PATH]) {
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
}

function recoveryHint() {
  return (
    `Snapshot kept at ${SNAPSHOT_PATH}. Recover with: node tests/e2e/run.js --restore-settings ` +
    `(or discard it with --discard-settings-snapshot).`
  );
}

// ---------------------------------------------------------------------------
// Driver runner (bypasses runEgoScript's armed/abort checks on purpose: the
// guard itself must always be able to restore).
// ---------------------------------------------------------------------------
async function runGuardDriver(mode, { lockTimeoutMs = 180000, timeoutMs = 60000 } = {}) {
  ensurePrivateGuardDir();
  return await withBrowserLock(
    async () => {
      const rand = Math.random().toString(36).slice(2, 8);
      const resultPath = path.join(GUARD_DIR, `result_${process.pid}_${Date.now()}_${rand}.json`);
      const cfg = {
        mode,
        key: SETTINGS_KEY,
        snapshotPath: SNAPSHOT_PATH,
        resultPath,
        extOrigin: EXT_ORIGIN,
        settleMs: SETTLE_MS,
        spaceName: `nativeread-e2e-guard-${mode}-${Date.now()}-${rand}`
      };
      try {
        const { code, signal } = await runEgoStdin(buildGuardDriverSource(cfg), { timeoutMs });
        if (!fs.existsSync(resultPath)) {
          // Deliberately do not echo driver stdout/stderr here.
          throw new HarnessError(`Settings guard ${mode} driver exited (${code ?? signal}) without a result`);
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

function describeMeta(meta) {
  if (!meta?.present) return 'no kct_settings_v1 stored';
  return `provider=${meta.providerId || '(none)'}, apiKey ${meta.hasApiKey ? 'present' : 'absent'}`;
}

async function doRestore(reason, { lockTimeoutMs }) {
  if (!snapshotExists()) {
    throw new HarnessError(`Settings restore (${reason}) impossible: snapshot file is missing at ${SNAPSHOT_PATH}`);
  }
  // Close leaked test TaskSpaces first: a tab left open on a #nr_sync URL could
  // re-import a payload after we restore.
  try {
    await cleanupStaleTaskSpaces('nativeread-e2e', { lockTimeoutMs });
  } catch (_) {}
  const runCountAtStart = getEgoScriptRunCount();
  const res = await runGuardDriver('restore', { lockTimeoutMs });
  if (!res?.ok) {
    const diff = Array.isArray(res?.diffKeys) && res.diffKeys.length ? ` differing fields: ${res.diffKeys.join(', ')};` : '';
    throw new HarnessError(
      `Settings restore (${reason}) FAILED: ${redactSecrets(res?.error || 'unknown error')};${diff} ${recoveryHint()}`
    );
  }
  if (expectedHash && res.hash !== expectedHash) {
    throw new HarnessError(`Settings snapshot file changed during the run (${reason}). ${recoveryHint()}`);
  }
  lastRestoredRunCount = runCountAtStart;
  return res;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Snapshot the user's settings before any test runs. Fails closed: if this
 * throws, no test may touch the browser (runEgoScript stays disarmed).
 */
export async function armSettingsGuard({ log = console.log } = {}) {
  ensurePrivateGuardDir();

  if (snapshotExists()) {
    const owner = readOwner();
    if (owner && owner.pid !== process.pid && pidAlive(owner.pid)) {
      throw new HarnessError(
        `Another e2e run (pid ${owner.pid}) holds the settings snapshot at ${SNAPSHOT_PATH}; refusing to start.`
      );
    }
    const ageMs = snapshotAgeMs();
    if (!(ageMs <= AUTO_RECOVER_MAX_AGE_MS)) {
      throw new HarnessError(
        `Found a leftover settings snapshot older than 24h from a crashed run. ${recoveryHint()}`
      );
    }
    // A previous run crashed: the browser may still hold test values. Restore
    // the ORIGINAL from the leftover snapshot and keep using it — never
    // snapshot over it, or test values would become the "original".
    log(`[GUARD] Leftover settings snapshot found (crashed run, ${Math.round(ageMs / 1000)}s old); restoring it first.`);
    writeOwner();
    const res = await doRestore('recover-leftover', { lockTimeoutMs: 180000 });
    expectedHash = res.hash;
    setSettingsGuardArmed(true);
    log(`[GUARD] Recovered and armed (${describeMeta(res.meta)}).`);
    return { recovered: true };
  }

  const res = await runGuardDriver('snapshot');
  if (!res?.ok) {
    // The driver uses flag 'wx', so a concurrent run's snapshot is never clobbered.
    throw new HarnessError(
      `Settings snapshot FAILED; refusing to run browser tests: ${redactSecrets(res?.error || 'unknown error')}`
    );
  }
  writeOwner();
  expectedHash = res.hash;
  // Self-test: prove the restore path works on the REAL driver (set the same
  // value back, settle, read back, hash compare) while nothing has been
  // altered yet. If it fails we never arm, so no test can write settings.
  await doRestore('arm-selftest', { lockTimeoutMs: 180000 });
  lastRestoredRunCount = getEgoScriptRunCount();
  setSettingsGuardArmed(true);
  log(`[GUARD] Settings snapshot taken (${describeMeta(res.meta)}); will restore after every suite.`);
  return { recovered: false };
}

/**
 * Restore the snapshot. Serialised (never two restores at once) and skipped
 * when no browser session ran since the last verified restore, unless force.
 */
export function restoreSettingsSnapshot({ reason = 'restore', force = false, lockTimeoutMs = 180000 } = {}) {
  const job = restoreChain.then(async () => {
    if (!isSettingsGuardArmed() && !snapshotExists()) return { skipped: true };
    if (!force && lastRestoredRunCount === getEgoScriptRunCount()) return { skipped: true };
    return await doRestore(reason, { lockTimeoutMs });
  });
  restoreChain = job.catch(() => {});
  return job;
}

/** Final restore + delete the snapshot (only after a verified match). Idempotent. */
export async function finalizeSettingsGuard({ reason = 'final', lockTimeoutMs = 180000, log = console.log } = {}) {
  const job = restoreChain.then(async () => {
    if (!snapshotExists()) {
      setSettingsGuardArmed(false);
      return { skipped: true };
    }
    const owner = readOwner();
    if (owner && owner.pid !== process.pid && pidAlive(owner.pid)) {
      // Not ours; never touch another live run's snapshot.
      return { skipped: true };
    }
    const res = await doRestore(reason, { lockTimeoutMs });
    deleteSnapshotFiles();
    setSettingsGuardArmed(false);
    expectedHash = null;
    log(`[GUARD] Settings restored and verified (${describeMeta(res.meta)}); snapshot deleted.`);
    return res;
  });
  restoreChain = job.catch(() => {});
  return await job;
}

/** CLI: --restore-settings (recover after a crash without running tests). */
export async function recoverLeftoverSnapshot({ log = console.log } = {}) {
  if (!snapshotExists()) {
    log(`[GUARD] No leftover settings snapshot at ${SNAPSHOT_PATH}; nothing to restore.`);
    return { skipped: true };
  }
  const owner = readOwner();
  if (owner && owner.pid !== process.pid && pidAlive(owner.pid)) {
    throw new HarnessError(`Snapshot belongs to a running e2e process (pid ${owner.pid}); refusing.`);
  }
  writeOwner();
  return await finalizeSettingsGuard({ reason: 'manual-recover', log });
}

export function hasLeftoverSnapshot() {
  return snapshotExists();
}

/** CLI: --discard-settings-snapshot. */
export function discardLeftoverSnapshot({ log = console.log } = {}) {
  const owner = readOwner();
  if (owner && owner.pid !== process.pid && pidAlive(owner.pid)) {
    throw new HarnessError(`Snapshot belongs to a running e2e process (pid ${owner.pid}); refusing.`);
  }
  deleteSnapshotFiles();
  log(`[GUARD] Discarded settings snapshot at ${SNAPSHOT_PATH}.`);
}
