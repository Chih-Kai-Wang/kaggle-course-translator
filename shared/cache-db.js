(() => {
  if (globalThis.KCTCacheDB) return;

  const DB_NAME = 'kct_cache_db_v2';
  const DB_VERSION = 1;
  const STORE_NAME = 'entries';
  const MAX_ENTRIES = 20000;
  const LEGACY_CACHE_KEY = 'kct_translation_cache_v1';

  let dbPromise = null;
  let migrationPromise = null;

  function openDB() {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB unavailable'));
    }
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      let settled = false;
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          let store;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          } else {
            store = req.transaction.objectStore(STORE_NAME);
          }
          if (!store.indexNames.contains('ts')) {
            store.createIndex('ts', 'ts', { unique: false });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            try {
              db.close();
            } catch (_) {}
            dbPromise = null;
          };
          db.onclose = () => {
            dbPromise = null;
          };
          settled = true;
          resolve(db);
        };
        req.onerror = () => {
          dbPromise = null;
          if (!settled) {
            settled = true;
            reject(req.error || new Error('Failed to open IndexedDB'));
          }
        };
        req.onblocked = () => {
          dbPromise = null;
          if (!settled) {
            settled = true;
            reject(new Error('IndexedDB open blocked'));
          }
        };
      } catch (err) {
        dbPromise = null;
        reject(err);
      }
    });

    return dbPromise;
  }

  async function getMany(keys) {
    const result = new Map();
    if (!Array.isArray(keys) || keys.length === 0) return result;
    const uniqueKeys = Array.from(new Set(keys.filter((k) => typeof k === 'string' && k.length > 0)));
    if (uniqueKeys.length === 0) return result;

    try {
      const db = await openDB();
      return await new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);

          for (const key of uniqueKeys) {
            const req = store.get(key);
            req.onsuccess = () => {
              const rec = req.result;
              if (rec && typeof rec.zh === 'string' && rec.zh.trim()) {
                result.set(key, rec.zh);
              }
            };
          }

          tx.oncomplete = () => resolve(result);
          tx.onerror = () => resolve(result);
          tx.onabort = () => resolve(result);
        } catch (_) {
          resolve(result);
        }
      });
    } catch (_) {
      return result;
    }
  }

  async function putMany(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return false;
    const now = Date.now();
    const valid = [];
    for (let i = 0; i < entries.length; i++) {
      const item = entries[i];
      const key = typeof item?.key === 'string'
        ? item.key
        : typeof item?.cacheKey === 'string'
          ? item.cacheKey
          : '';
      const zh = typeof item?.zh === 'string' ? item.zh : '';
      if (key && zh.trim()) {
        const ts = Number.isFinite(item?.ts) ? item.ts : now + i;
        valid.push({ key, zh, ts });
      }
    }
    if (valid.length === 0) return true;

    try {
      const db = await openDB();
      return await new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);

          for (const rec of valid) {
            store.put(rec);
          }

          const countReq = store.count();
          countReq.onsuccess = () => {
            let overflow = (countReq.result || 0) - MAX_ENTRIES;
            if (overflow > 0) {
              const tsIndex = store.index('ts');
              const cursorReq = tsIndex.openCursor(null, 'next');
              cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (cursor && overflow > 0) {
                  cursor.delete();
                  overflow -= 1;
                  if (overflow > 0) {
                    cursor.continue();
                  }
                }
              };
            }
          };

          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        } catch (_) {
          resolve(false);
        }
      });
    } catch (_) {
      return false;
    }
  }

  async function clear() {
    try {
      const db = await openDB();
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch (_) {
          resolve();
        }
      });
    } catch (_) {
      // Graceful fallback
    }
    // Also remove any leftover legacy storage key if present
    try {
      if (chrome?.storage?.local) {
        await chrome.storage.local.remove(LEGACY_CACHE_KEY);
      }
    } catch (_) {}
  }

  async function stats() {
    try {
      const db = await openDB();
      return await new Promise((resolve) => {
        let entries = 0;
        let bytes = 0;
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const cursorReq = store.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
              const rec = cursor.value;
              entries += 1;
              if (rec) {
                const kLen = typeof rec.key === 'string' ? rec.key.length : 0;
                const zLen = typeof rec.zh === 'string' ? rec.zh.length : 0;
                bytes += kLen + zLen * 2 + 24;
              }
              cursor.continue();
            }
          };
          tx.oncomplete = () => resolve({ entries, bytes });
          tx.onerror = () => resolve({ entries, bytes });
          tx.onabort = () => resolve({ entries, bytes });
        } catch (_) {
          resolve({ entries: 0, bytes: 0 });
        }
      });
    } catch (_) {
      return { entries: 0, bytes: 0 };
    }
  }

  async function migrateFromLegacyStorage() {
    if (migrationPromise) return migrationPromise;
    migrationPromise = (async () => {
      try {
        if (!chrome?.storage?.local) return 0;
        const data = await chrome.storage.local.get(LEGACY_CACHE_KEY);
        const legacy = data?.[LEGACY_CACHE_KEY];
        if (!legacy || typeof legacy !== 'object') return 0;

        const entries = [];
        for (const [key, val] of Object.entries(legacy)) {
          if (key && val && typeof val.zh === 'string' && val.zh.trim()) {
            entries.push({
              key,
              zh: val.zh,
              ts: Number.isFinite(val.t) ? val.t : Date.now()
            });
          }
        }

        if (entries.length === 0) {
          await chrome.storage.local.remove(LEGACY_CACHE_KEY);
          return 0;
        }

        const ok = await putMany(entries);
        if (ok) {
          await chrome.storage.local.remove(LEGACY_CACHE_KEY);
        }
        return ok ? entries.length : 0;
      } catch (_) {
        return 0;
      }
    })();
    return migrationPromise;
  }

  globalThis.KCTCacheDB = {
    DB_NAME,
    STORE_NAME,
    MAX_ENTRIES,
    getMany,
    putMany,
    clear,
    stats,
    migrateFromLegacyStorage
  };
})();
