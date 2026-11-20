import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startFixtureServer, REPO_ROOT } from './lib/http-server.js';
import {
  runEgoScript,
  listAgentTaskSpaces,
  cleanupStaleTaskSpaces,
  HarnessError,
  testContext,
  abortAllBrowserScripts,
  killActiveEgoChildren
} from './lib/browser.js';
import {
  armSettingsGuard,
  restoreSettingsSnapshot,
  finalizeSettingsGuard,
  hasLeftoverSnapshot,
  recoverLeftoverSnapshot,
  discardLeftoverSnapshot
} from './lib/settings-guard.js';
import { LockTimeoutError, DEFAULT_LOCK_PATH } from './lib/lock.js';
import { redactSecrets, assert, assertEqual, assertMatch } from './lib/assertions.js';
import { evalOverflowCheck } from './lib/geom-checks.js';
import { generateAllPdfFixtures } from './fixtures/generate-pdfs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SUITES_DIR = path.join(__dirname, 'suites');

const SUITE_FILE_MAP = {
  'invariants-docs': 'invariants-docs.test.js',
  invariants: 'invariants-docs.test.js',
  'extension-ui': 'extension-ui.test.js',
  'webpage-spa': 'webpage-spa.test.js',
  'pdf-desktop': 'pdf-desktop.test.js',
  'mobile-pwa': 'mobile-pwa.test.js',
  'userscript-parity': 'userscript-parity.test.js',
  userscript: 'userscript-parity.test.js'
};

const CANONICAL_SUITES = [
  'invariants-docs',
  'extension-ui',
  'webpage-spa',
  'pdf-desktop',
  'mobile-pwa',
  'userscript-parity'
];

function parseArgs(argv) {
  const opts = {
    tier: 'all',
    suite: 'all',
    skipRemote: false,
    jsonPath: null,
    timeoutMs: null,
    smoke: false,
    restoreSettings: false,
    discardSettingsSnapshot: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tier') {
      const val = argv[++i];
      if (!val || !['1', '2', '3', '4', 'all'].includes(val)) {
        throw new HarnessError(`Invalid --tier value: ${val}`);
      }
      opts.tier = val;
    } else if (arg === '--suite') {
      const val = argv[++i];
      if (!val || (val !== 'all' && !SUITE_FILE_MAP[val])) {
        throw new HarnessError(`Invalid --suite value: ${val}`);
      }
      opts.suite = val;
    } else if (arg === '--skip-remote') {
      opts.skipRemote = true;
    } else if (arg === '--json') {
      const val = argv[++i];
      if (!val) throw new HarnessError('--json requires a file path');
      opts.jsonPath = path.resolve(val);
    } else if (arg === '--timeout-ms') {
      const val = Number(argv[++i]);
      if (!Number.isFinite(val) || val <= 0) {
        throw new HarnessError(`Invalid --timeout-ms value: ${val}`);
      }
      opts.timeoutMs = val;
    } else if (arg === '--smoke') {
      opts.smoke = true;
    } else if (arg === '--restore-settings') {
      opts.restoreSettings = true;
    } else if (arg === '--discard-settings-snapshot') {
      opts.discardSettingsSnapshot = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node tests/e2e/run.js [--tier 1|2|3|4|all] [--suite <name|all>] [--skip-remote] [--json <path>] [--timeout-ms <ms>] [--smoke] [--restore-settings] [--discard-settings-snapshot]'
      );
      process.exit(0);
    } else {
      throw new HarnessError(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function isInfraError(err) {
  return Boolean(
    err &&
      (err instanceof LockTimeoutError ||
        err instanceof HarnessError ||
        err.isInfraError === true ||
        err.exitCode === 2)
  );
}

async function withHardTimeout(promise, ms, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`Test "${label}" timed out after ${ms}ms`);
          err.name = 'TestTimeoutError';
          reject(err);
        }, ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runSmokeTest(fixtureServer) {
  const startedAt = Date.now();
  const res = await runEgoScript(
    async ({ page, args, helpers }) => {
      await helpers.setDesktopViewport(page, 1280, 800);
      await helpers.enableEventCapture(page);
      await page.goto(args.visionUrl, { waitUntil: 'load' });
      const title = await page.title();
      const overflow = await page.evaluate(args.evalOverflowExpr);
      const events = await helpers.collectEvents(page);
      return { title, overflow, events };
    },
    {
      namePrefix: 'nativeread-e2e-smoke',
      timeoutMs: 60000,
      args: {
        visionUrl: `${fixtureServer.fixturesUrl}html/vision-article.html`,
        evalOverflowExpr: `(${evalOverflowCheck.toString()})()`
      }
    }
  );

  assertMatch(res.title, /R4 Vision Fixture/i, 'Smoke page title');
  assertEqual(res.overflow.horizOverflow, false, 'Smoke horizontal overflow');
  assertEqual(res.events.pageErrors.length, 0, 'Smoke pageErrors');

  const spaces = await listAgentTaskSpaces();
  const leaked = spaces.filter(
    (s) => s.ownership !== 'user' && typeof s.name === 'string' && s.name.startsWith('nativeread-e2e')
  );
  assertEqual(leaked.length, 0, 'Zero leaked nativeread-e2e TaskSpaces');
  assert(!fs.existsSync(DEFAULT_LOCK_PATH), 'Browser lock file removed after smoke run');

  return {
    ok: true,
    durationMs: Date.now() - startedAt,
    title: res.title,
    leakedSpaces: leaked.length
  };
}

// The test currently running (its AsyncLocalStorage store), so a signal or a
// hard timeout can mark it aborted and block any further browser access.
let currentTestStore = null;
let shuttingDown = false;

function installSignalGuards() {
  const handler = (sig) => {
    if (shuttingDown) {
      console.error(`[GUARD] ${sig} again; exiting without waiting (snapshot, if any, is kept for --restore-settings).`);
      process.exit(sig === 'SIGINT' ? 130 : 143);
    }
    shuttingDown = true;
    if (currentTestStore) currentTestStore.aborted = true;
    abortAllBrowserScripts();
    killActiveEgoChildren();
    console.error(`[GUARD] ${sig} received; restoring kct_settings_v1 before exit...`);
    finalizeSettingsGuard({ reason: sig, lockTimeoutMs: 60000 })
      .catch((err) => {
        console.error(`[GUARD] ${redactSecrets(err?.message || String(err))}`);
      })
      .finally(() => process.exit(sig === 'SIGINT' ? 130 : 143));
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => handler(sig));
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const runStart = Date.now();

  if (opts.restoreSettings) {
    await recoverLeftoverSnapshot();
    return 0;
  }
  if (opts.discardSettingsSnapshot) {
    discardLeftoverSnapshot();
    return 0;
  }

  installSignalGuards();
  generateAllPdfFixtures();
  const fixtureServer = await startFixtureServer();

  const report = {
    startedAt: new Date(runStart).toISOString(),
    options: opts,
    results: [],
    summary: { total: 0, passed: 0, failed: 0, skipped: 0, infraErrors: 0, durationMs: 0 }
  };

  let exitCode = 0;

  try {
    if (opts.smoke) {
      // Fail closed: if the snapshot cannot be taken, nothing touches the browser.
      await armSettingsGuard();
      const smokeRes = await runSmokeTest(fixtureServer);
      console.log(`[SMOKE PASS] (${smokeRes.durationMs}ms) title="${smokeRes.title}" leaked=${smokeRes.leakedSpaces}`);
      report.smoke = smokeRes;
      report.summary.total = 1;
      report.summary.passed = 1;
      report.summary.durationMs = Date.now() - runStart;
      if (opts.jsonPath) {
        fs.mkdirSync(path.dirname(opts.jsonPath), { recursive: true });
        fs.writeFileSync(opts.jsonPath, JSON.stringify(report, null, 2), 'utf8');
      }
      return 0;
    }

    const suiteNames = opts.suite === 'all' ? CANONICAL_SUITES : [opts.suite];
    const seenFiles = new Set();
    const collectedTests = [];

    for (const suiteName of suiteNames) {
      const fileName = SUITE_FILE_MAP[suiteName];
      const fullPath = path.join(SUITES_DIR, fileName);
      if (!fs.existsSync(fullPath)) {
        if (opts.suite === 'all') {
          console.log(`[SUITE SKIP] ${suiteName} (${fileName} not created yet)`);
          continue;
        }
        throw new HarnessError(`Requested suite "${suiteName}" does not exist at ${fullPath}`);
      }
      if (seenFiles.has(fullPath)) continue;
      seenFiles.add(fullPath);

      const mod = await import(pathToFileURL(fullPath).href);
      if (typeof mod.registerTests !== 'function') {
        throw new HarnessError(`Suite ${fileName} does not export registerTests(ctx)`);
      }

      const ctx = {
        suite: suiteName.replace(/^invariants$/, 'invariants-docs'),
        repoRoot: REPO_ROOT,
        fixtureServer,
        addTest(testDef) {
          collectedTests.push({
            ...testDef,
            suite: testDef.suite || suiteName
          });
        }
      };
      await mod.registerTests(ctx);
    }

    const tierFilter = opts.tier === 'all' ? null : Number(opts.tier);
    const activeTests = collectedTests.filter((t) => {
      if (tierFilter !== null && t.tier !== tierFilter) return false;
      if (opts.skipRemote && t.remote) return false;
      return true;
    });

    const skippedRemoteCount = opts.skipRemote
      ? collectedTests.filter((t) => (tierFilter === null || t.tier === tierFilter) && t.remote).length
      : 0;
    report.summary.skipped = skippedRemoteCount;

    // Arm (snapshot the user's real settings) only when a browser test is
    // selected; static-only runs never open the live browser. Fail closed: if
    // arming fails, the run aborts before any test. Tests mislabelled
    // usesBrowser:false that still call runEgoScript are refused (unarmed).
    if (activeTests.some((t) => t.usesBrowser)) {
      await armSettingsGuard();
    } else if (hasLeftoverSnapshot()) {
      console.warn('[GUARD] A leftover settings snapshot from a crashed run exists; run: node tests/e2e/run.js --restore-settings');
    }

    for (let idx = 0; idx < activeTests.length; idx++) {
      const test = activeTests[idx];
      if (shuttingDown) break;
      const tStart = Date.now();
      const perTestTimeout =
        opts.timeoutMs || test.timeoutMs || (test.usesBrowser ? 120000 : 30000);
      const store = { testId: test.id, aborted: false };
      currentTestStore = store;
      let passed = false;
      let timedOut = false;
      try {
        await withHardTimeout(
          testContext.run(store, () =>
            Promise.resolve().then(() =>
              test.run({
                repoRoot: REPO_ROOT,
                fixtureServer,
                skipRemote: opts.skipRemote,
                timeoutMs: perTestTimeout
              })
            )
          ),
          perTestTimeout,
          test.id || test.name
        );
        passed = true;
        const durationMs = Date.now() - tStart;
        report.summary.passed++;
        report.results.push({
          id: test.id,
          suite: test.suite,
          feature: test.feature,
          tier: test.tier,
          name: test.name,
          status: 'pass',
          durationMs
        });
        console.log(`[PASS] ${test.id} (T${test.tier}/${test.feature}) ${test.name} (${durationMs}ms)`);
      } catch (err) {
        if (err?.name === 'TestTimeoutError') {
          // The test promise keeps running in the background; forbid it from
          // opening any further browser session (checked in runEgoScript).
          timedOut = true;
          store.aborted = true;
          // Kill its in-flight ego child now so the lock frees promptly and the
          // restore below runs only after that child is really gone.
          killActiveEgoChildren();
        }
        const durationMs = Date.now() - tStart;
        const safeMsg = redactSecrets(err?.message || String(err));
        const infra = isInfraError(err);
        if (infra) {
          report.summary.infraErrors++;
          exitCode = 2;
        } else {
          report.summary.failed++;
          if (exitCode === 0) exitCode = 1;
        }
        report.results.push({
          id: test.id,
          suite: test.suite,
          feature: test.feature,
          tier: test.tier,
          name: test.name,
          status: infra ? 'infra_error' : 'fail',
          durationMs,
          error: safeMsg
        });
        console.error(
          `[${infra ? 'INFRA' : 'FAIL'}] ${test.id} (T${test.tier}/${test.feature}) ${test.name}: ${safeMsg}`
        );
      } finally {
        currentTestStore = null;
      }

      // Harness-level restore (so the next test never captures poisoned
      // settings as its "original"); forced after a timeout (the abandoned test
      // may have been mid-write). A failed restore aborts the run.
      // Runs after EVERY test (suites without the per-test wrapper included);
      // it is a no-op unless a browser session ran since the last verified restore.
      const lastOfSuite = idx === activeTests.length - 1 || activeTests[idx + 1].suite !== test.suite;
      {
        await restoreSettingsSnapshot({
          reason: timedOut
            ? `timeout:${test.id}`
            : !passed
              ? `failed:${test.id}`
              : lastOfSuite
                ? `suite-end:${test.suite}`
                : `after:${test.id}`,
          force: timedOut
        });
      }
    }

    report.summary.total = activeTests.length;
    report.summary.durationMs = Date.now() - runStart;

    try {
      await cleanupStaleTaskSpaces('nativeread-e2e');
    } catch (_) {}

    if (opts.jsonPath) {
      fs.mkdirSync(path.dirname(opts.jsonPath), { recursive: true });
      fs.writeFileSync(opts.jsonPath, JSON.stringify(report, null, 2), 'utf8');
    }

    console.log(
      `\nSummary: total=${report.summary.total} passed=${report.summary.passed} failed=${report.summary.failed} skipped=${report.summary.skipped} infra=${report.summary.infraErrors} (${report.summary.durationMs}ms)`
    );
    return exitCode;
  } finally {
    // Final restore on EVERY path (pass, fail, throw, --smoke). On failure the
    // snapshot file is kept and the run exits 2 with recovery instructions.
    try {
      await finalizeSettingsGuard({ reason: 'final' });
    } catch (err) {
      console.error(`[GUARD] ${redactSecrets(err?.message || String(err))}`);
      process.exitCode = 2;
      exitCode = 2;
    }
    // server.close() waits for idle keep-alive sockets; never let that keep the
    // process alive (settings are already restored above).
    await Promise.race([fixtureServer.close(), new Promise((r) => setTimeout(r, 3000).unref())]);
  }
}

main()
  .then((code) => {
    process.exit(process.exitCode === 2 ? 2 : code);
  })
  .catch((err) => {
    console.error(`[HARNESS ERROR] ${redactSecrets(err?.message || String(err))}`);
    process.exit(2);
  });
