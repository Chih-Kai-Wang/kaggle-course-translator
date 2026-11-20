import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_LOCK_PATH = '/tmp/nativeread_ego_browser.lock';

export class LockTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LockTimeoutError';
    this.isInfraError = true;
    this.exitCode = 2;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// True when owner.json names a pid that no longer exists (e.g. the previous
// run was SIGKILLed while holding the lock), so waiters need not sit out staleMs.
function isLockOwnerDead(lockPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
    if (!parsed || !Number.isInteger(parsed.pid) || parsed.pid <= 0 || parsed.pid === process.pid) return false;
    try {
      process.kill(parsed.pid, 0);
      return false;
    } catch (err) {
      return err?.code === 'ESRCH';
    }
  } catch (_) {
    return false;
  }
}

function getLockAgeMs(lockPath) {
  try {
    const ownerFile = path.join(lockPath, 'owner.json');
    if (fs.existsSync(ownerFile)) {
      const raw = fs.readFileSync(ownerFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Number.isFinite(parsed.createdAt)) {
        return Date.now() - parsed.createdAt;
      }
    }
  } catch (_) {
    // Fall back to directory mtime
  }
  try {
    const st = fs.statSync(lockPath);
    return Date.now() - st.mtimeMs;
  } catch (_) {
    return 0;
  }
}

export async function withBrowserLock(
  fn,
  {
    lockPath = DEFAULT_LOCK_PATH,
    timeoutMs = 180000,
    staleMs = 240000,
    pollMs = 150
  } = {}
) {
  const start = Date.now();
  let acquired = false;

  while (!acquired) {
    try {
      fs.mkdirSync(lockPath);
      acquired = true;
      try {
        fs.writeFileSync(
          path.join(lockPath, 'owner.json'),
          JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
          'utf8'
        );
      } catch (_) {
        // Non-fatal if metadata write races
      }
    } catch (err) {
      if (err?.code !== 'EEXIST') {
        throw err;
      }
      const ageMs = getLockAgeMs(lockPath);
      if ((Number.isFinite(ageMs) && ageMs > staleMs) || isLockOwnerDead(lockPath)) {
        try {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        } catch (_) {
          // Another waiter may have cleared it concurrently
        }
      }
      if (Date.now() - start >= timeoutMs) {
        throw new LockTimeoutError(
          `Timed out after ${timeoutMs}ms waiting for browser lock at ${lockPath} (age=${Math.round(ageMs)}ms)`
        );
      }
      await sleep(pollMs);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      fs.rmSync(lockPath, { recursive: true, force: true });
    } catch (_) {
      // Ignore cleanup errors
    }
  }
}
