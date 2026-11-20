const {
  PROVIDER_PRESETS,
  TARGET_LANGUAGES,
  DEFAULT_GLOSSARY,
  getSettings,
  saveSettings,
  resolveEndpoint,
  resolveStreamEndpoint,
  isLocalEndpoint,
  sanitizeApiKey
} = globalThis.KCTConfig;

let whitelistHosts = [];
let lastSyncUrl = '';

function normalizeHostInput(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  let host = trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch (_) {
      return '';
    }
  } else {
    host = host.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  }
  host = host.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!host) return '';
  if (host !== 'localhost' && (!host.includes('.') || !/^[a-z0-9.-]+$/i.test(host))) {
    return '';
  }
  return host;
}

function renderWhitelist() {
  const container = document.getElementById('whitelist-list');
  if (!container) return;
  container.textContent = '';

  if (!whitelistHosts.length) {
    const empty = document.createElement('span');
    empty.className = 'host-empty';
    empty.textContent = '目前尚未加入任何自動翻譯網站';
    container.appendChild(empty);
    return;
  }

  for (const host of whitelistHosts) {
    const chip = document.createElement('span');
    chip.className = 'host-chip';

    const text = document.createElement('span');
    text.textContent = host;
    chip.appendChild(text);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'host-chip-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `移除 ${host}`);
    removeBtn.title = `移除 ${host}`;
    removeBtn.addEventListener('click', async () => {
      whitelistHosts = whitelistHosts.filter((h) => h !== host);
      renderWhitelist();
      await saveSettings({ autoTranslateHosts: [...whitelistHosts] });
      const fb = document.getElementById('whitelist-feedback');
      if (fb) fb.textContent = `已移除 ${host}`;
    });

    chip.appendChild(removeBtn);
    container.appendChild(chip);
  }
}

async function handleAddHost() {
  const input = document.getElementById('whitelist-host-input');
  const fb = document.getElementById('whitelist-feedback');
  if (!input || !fb) return;
  const normalized = normalizeHostInput(input.value);

  if (!normalized) {
    fb.textContent = '請輸入有效網域名稱，例如 www.kaggle.com';
    return;
  }

  if (whitelistHosts.includes(normalized)) {
    fb.textContent = `${normalized} 已在白名單中`;
    input.value = '';
    return;
  }

  whitelistHosts = [...whitelistHosts, normalized];
  input.value = '';
  renderWhitelist();
  await saveSettings({ autoTranslateHosts: [...whitelistHosts] });
  fb.textContent = `已加入白名單：${normalized}`;
}

function normalizeApiKeyValue(raw) {
  if (typeof sanitizeApiKey === 'function') {
    return sanitizeApiKey(raw);
  }
  return String(raw || '').trim().replace(/^Bearer\s+/i, '').trim();
}

function checkLocalEndpoint(baseUrl) {
  if (typeof isLocalEndpoint === 'function') {
    return isLocalEndpoint(baseUrl);
  }
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(String(baseUrl || '').trim());
}

function readFormValues() {
  const maxCharsEl = document.getElementById('max-batch-chars');
  return {
    targetLang: document.getElementById('lang-select').value,
    customTargetLang: document.getElementById('custom-lang-input').value.trim(),
    displayMode: document.getElementById('mode-select').value,
    translateCodeComments: document.getElementById('translate-code-comments').checked,
    showOutputTranslateBtn: document.getElementById('show-output-btn').checked,
    checkForUpdates: document.getElementById('check-for-updates').checked,
    typographyMatch: document.getElementById('typography-match').value,
    thinkingEffort: document.getElementById('thinking-effort').value,
    lazyViewport: document.getElementById('lazy-viewport').checked,
    streamTranslation: document.getElementById('stream-translation').checked,
    autoTranslate: document.getElementById('global-auto-translate').checked,
    autoTranslateHosts: [...whitelistHosts],
    providerId: document.getElementById('provider-select').value,
    protocol: document.getElementById('protocol-select').value,
    baseUrl: document.getElementById('baseurl-input').value.trim(),
    apiKey: normalizeApiKeyValue(document.getElementById('apikey-input').value),
    model: document.getElementById('model-input').value.trim(),
    batchSize: Math.min(40, Math.max(1, Number(document.getElementById('batch-size').value) || 20)),
    ...(maxCharsEl ? {
      maxBatchChars: Math.min(20000, Math.max(800, Math.round(Number(maxCharsEl.value) || 5500)))
    } : {}),
    temperature: (() => {
      const raw = document.getElementById('temperature-input').value.trim();
      const t = raw === '' ? NaN : Number(raw);
      return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.2;
    })(),
    customGlossary: document.getElementById('glossary-input').value
  };
}

function updateEndpointPreview() {
  const previewEl = document.getElementById('endpoint-preview');
  if (!previewEl) return;
  const form = readFormValues();
  const resolved = (form.streamTranslation && typeof resolveStreamEndpoint === 'function')
    ? resolveStreamEndpoint(form)
    : resolveEndpoint(form);
  previewEl.textContent = resolved || '（未填寫）';
}

function updateCustomLangVisibility() {
  const isCustom = document.getElementById('lang-select')?.value === 'custom';
  const wrap = document.getElementById('custom-lang-wrap');
  if (!wrap) return;
  wrap.hidden = !isCustom;
  wrap.classList.toggle('hidden', !isCustom);
}

function updateModelSuggestions(preset) {
  const datalist = document.getElementById('model-suggestions');
  if (!datalist) return;
  datalist.textContent = '';
  const models = Array.isArray(preset?.suggestedModels) && preset.suggestedModels.length
    ? preset.suggestedModels
    : (preset?.defaultModel ? [preset.defaultModel] : []);
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m;
    datalist.appendChild(opt);
  }
}

function applyPreset(presetId) {
  const preset = PROVIDER_PRESETS[presetId];
  if (!preset) return;
  document.getElementById('protocol-select').value = preset.protocol;
  document.getElementById('baseurl-input').value = preset.baseUrl;
  const modelInput = document.getElementById('model-input');
  modelInput.value = preset.defaultModel || '';
  modelInput.placeholder = preset.defaultModel
    ? `例如 ${preset.defaultModel}`
    : '請按「取得模型清單」選擇，或直接輸入模型名稱';
  document.getElementById('apikey-input').placeholder = preset.placeholderKey;
  document.getElementById('provider-hint').textContent = preset.hint;
  updateModelSuggestions(preset);
  updateEndpointPreview();
}

async function ensureHostPermissionIfNeeded(baseUrl) {
  let originPattern = null;
  try {
    const u = new URL(baseUrl);
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      originPattern = `${u.origin}/*`;
    }
  } catch (_) {
    return;
  }
  if (!originPattern) return;

  try {
    const already = await chrome.permissions.contains({ origins: [originPattern] });
    if (!already) {
      await chrome.permissions.request({ origins: [originPattern] });
    }
  } catch (err) {
    console.warn('Permission request skipped/denied:', err.message);
  }
}

function formatCacheSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) {
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(n / 1024).toFixed(1)} KB`;
}

function encodeBase64UrlUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildMobileSyncUrl(form) {
  const preset = PROVIDER_PRESETS[form.providerId] || null;
  const payload = {
    p: form.providerId || 'deepseek',
    r: form.protocol || 'openai',
    k: form.apiKey || '',
    m: form.model || '',
    l: form.targetLang || 'zh-TW',
    e: form.thinkingEffort || 'fastest',
    t: form.typographyMatch || 'native'
  };
  if (form.baseUrl && (!preset || form.baseUrl !== preset.baseUrl)) {
    payload.u = form.baseUrl;
  }
  if (form.targetLang === 'custom' && form.customTargetLang) {
    payload.c = form.customTargetLang;
  }
  const encoded = encodeBase64UrlUtf8(JSON.stringify(payload));
  return `https://chih-kai-wang.github.io/native-read/#nr_sync=${encoded}`;
}

// ============================================================
// Self-Contained Pure-JS ISO/IEC 18004 QR Code Generator (V1-V14, Level L, Byte Mode)
// ============================================================
const QR_LEVEL_L_VERSIONS = [
  null,
  { v: 1, totalData: 19, ecPerBlock: 7, groups: [[1, 19]], align: [] },
  { v: 2, totalData: 34, ecPerBlock: 10, groups: [[1, 34]], align: [6, 18] },
  { v: 3, totalData: 55, ecPerBlock: 15, groups: [[1, 55]], align: [6, 22] },
  { v: 4, totalData: 80, ecPerBlock: 20, groups: [[1, 80]], align: [6, 26] },
  { v: 5, totalData: 108, ecPerBlock: 26, groups: [[1, 108]], align: [6, 30] },
  { v: 6, totalData: 136, ecPerBlock: 18, groups: [[2, 68]], align: [6, 34] },
  { v: 7, totalData: 156, ecPerBlock: 20, groups: [[2, 78]], align: [6, 22, 38] },
  { v: 8, totalData: 194, ecPerBlock: 24, groups: [[2, 97]], align: [6, 24, 42] },
  { v: 9, totalData: 232, ecPerBlock: 30, groups: [[2, 116]], align: [6, 26, 46] },
  { v: 10, totalData: 274, ecPerBlock: 18, groups: [[2, 68], [2, 69]], align: [6, 28, 50] },
  { v: 11, totalData: 324, ecPerBlock: 20, groups: [[4, 81]], align: [6, 30, 54] },
  { v: 12, totalData: 370, ecPerBlock: 24, groups: [[2, 92], [2, 93]], align: [6, 32, 58] },
  { v: 13, totalData: 428, ecPerBlock: 26, groups: [[4, 107]], align: [6, 34, 62] },
  { v: 14, totalData: 461, ecPerBlock: 30, groups: [[3, 115], [1, 116]], align: [6, 26, 46, 66] }
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  return (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEcBytes(dataBytes, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < dataBytes.length; i++) {
    const factor = dataBytes[i] ^ rem[0];
    for (let j = 0; j < ecLen - 1; j++) {
      rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], factor);
    }
    rem[ecLen - 1] = gfMul(gen[ecLen], factor);
  }
  return rem;
}

function pickQrVersion(byteLen) {
  for (let v = 1; v <= 14; v++) {
    const info = QR_LEVEL_L_VERSIONS[v];
    const countBits = v <= 9 ? 8 : 16;
    const maxBytes = Math.floor((info.totalData * 8 - 4 - countBits) / 8);
    if (byteLen <= maxBytes) return info;
  }
  throw new Error('同步連結長度超過 QR V14 容量上限');
}

function encodeQrCodewords(utf8Bytes, verInfo) {
  const bitBuf = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bitBuf.push((val >>> i) & 1);
    }
  };

  pushBits(0b0100, 4);
  pushBits(utf8Bytes.length, verInfo.v <= 9 ? 8 : 16);
  for (let i = 0; i < utf8Bytes.length; i++) {
    pushBits(utf8Bytes[i], 8);
  }

  const maxBits = verInfo.totalData * 8;
  const termLen = Math.min(4, Math.max(0, maxBits - bitBuf.length));
  pushBits(0, termLen);
  while (bitBuf.length % 8 !== 0) {
    bitBuf.push(0);
  }

  const dataCodewords = new Uint8Array(verInfo.totalData);
  const byteCount = bitBuf.length / 8;
  for (let i = 0; i < byteCount; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bitBuf[i * 8 + j];
    }
    dataCodewords[i] = b;
  }
  const pads = [0xec, 0x11];
  for (let i = byteCount; i < verInfo.totalData; i++) {
    dataCodewords[i] = pads[(i - byteCount) % 2];
  }

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  let maxBlockLen = 0;
  for (const [numBlocks, dataLen] of verInfo.groups) {
    for (let b = 0; b < numBlocks; b++) {
      const slice = dataCodewords.subarray(offset, offset + dataLen);
      offset += dataLen;
      dataBlocks.push(slice);
      ecBlocks.push(rsComputeEcBytes(slice, verInfo.ecPerBlock));
      if (dataLen > maxBlockLen) maxBlockLen = dataLen;
    }
  }

  const finalBytes = [];
  for (let i = 0; i < maxBlockLen; i++) {
    for (let b = 0; b < dataBlocks.length; b++) {
      if (i < dataBlocks[b].length) finalBytes.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < verInfo.ecPerBlock; i++) {
    for (let b = 0; b < ecBlocks.length; b++) {
      finalBytes.push(ecBlocks[b][i]);
    }
  }
  return finalBytes;
}

function computeFormatBits(mask) {
  const data = (0b01 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x537 << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function computeVersionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x1f25 << (i - 12);
    }
  }
  return (version << 12) | rem;
}

function buildBaseQrMatrix(verInfo) {
  const size = 17 + verInfo.v * 4;
  const grid = Array.from({ length: size }, () => new Uint8Array(size));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setFunctionModule = (r, c, dark) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    grid[r][c] = dark ? 1 : 0;
    reserved[r][c] = 1;
  };

  const drawFinder = (topR, leftC) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(topR + dr, leftC + dc, inOuter && (onBorder || inInner));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  const centers = verInfo.align;
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === centers.length - 1) || (i === centers.length - 1 && j === 0)) {
        continue;
      }
      const cr = centers[i];
      const cc = centers[j];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunctionModule(cr + dr, cc + dc, dark);
        }
      }
    }
  }

  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) setFunctionModule(6, i, i % 2 === 0);
    if (!reserved[i][6]) setFunctionModule(i, 6, i % 2 === 0);
  }

  setFunctionModule(size - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = 1;
    if (!reserved[i][8]) reserved[i][8] = 1;
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) reserved[8][size - 1 - i] = 1;
    if (!reserved[size - 1 - i][8]) reserved[size - 1 - i][8] = 1;
  }

  if (verInfo.v >= 7) {
    const vBits = computeVersionBits(verInfo.v);
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      setFunctionModule(b, a, bit);
      setFunctionModule(a, b, bit);
    }
  }

  return { size, grid, reserved };
}

function placeFormatBits(grid, size, mask) {
  const bits = computeFormatBits(mask);
  for (let i = 0; i <= 5; i++) grid[i][8] = (bits >>> i) & 1;
  grid[7][8] = (bits >>> 6) & 1;
  grid[8][8] = (bits >>> 7) & 1;
  grid[8][7] = (bits >>> 8) & 1;
  for (let i = 9; i < 15; i++) grid[8][14 - i] = (bits >>> i) & 1;

  for (let i = 0; i < 8; i++) grid[8][size - 1 - i] = (bits >>> i) & 1;
  for (let i = 8; i < 15; i++) grid[size - 15 + i][8] = (bits >>> i) & 1;
  grid[size - 8][8] = 1;
}

function maskCondition(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function scoreQrPenalty(grid, size) {
  let penalty = 0;
  for (let r = 0; r < size; r++) {
    let runColor = grid[r][0];
    let runLen = 1;
    for (let c = 1; c < size; c++) {
      if (grid[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = grid[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }
  for (let c = 0; c < size; c++) {
    let runColor = grid[0][c];
    let runLen = 1;
    for (let r = 1; r < size; r++) {
      if (grid[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = grid[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) {
        penalty += 3;
      }
    }
  }
  return penalty;
}

function generateQrMatrix(text) {
  const utf8Bytes = new TextEncoder().encode(text);
  const verInfo = pickQrVersion(utf8Bytes.length);
  const codewords = encodeQrCodewords(utf8Bytes, verInfo);
  const { size, grid: baseGrid, reserved } = buildBaseQrMatrix(verInfo);

  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let upward = true;
  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? (size - 1 - step) : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = rightCol - dx;
        if (reserved[r][c]) continue;
        let bit = 0;
        if (bitIdx < totalBits) {
          bit = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
          bitIdx++;
        }
        baseGrid[r][c] = bit;
      }
    }
    upward = !upward;
  }

  let bestGrid = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = baseGrid.map((row) => Uint8Array.from(row));
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!reserved[r][c] && maskCondition(mask, r, c)) {
          candidate[r][c] ^= 1;
        }
      }
    }
    placeFormatBits(candidate, size, mask);
    const p = scoreQrPenalty(candidate, size);
    if (p < bestPenalty) {
      bestPenalty = p;
      bestGrid = candidate;
    }
  }
  return { size, grid: bestGrid };
}

function renderQrToCanvas(canvas, text) {
  if (!canvas) return;
  const { size, grid } = generateQrMatrix(text);
  const quietZone = 4;
  const totalModules = size + quietZone * 2;
  const scale = Math.max(3, Math.floor(220 / totalModules));
  const pixelSize = totalModules * scale;

  canvas.width = pixelSize;
  canvas.height = pixelSize;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pixelSize, pixelSize);

  ctx.fillStyle = '#0f172a';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c]) {
        ctx.fillRect((c + quietZone) * scale, (r + quietZone) * scale, scale, scale);
      }
    }
  }
}

async function refreshCacheStats() {
  const statsEl = document.getElementById('cache-stats');
  if (!statsEl) return;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_CACHE_STATS' });
    if (res?.ok) {
      const sizeStr = formatCacheSize(res.bytes);
      statsEl.textContent = `已快取 ${res.entries} 筆譯文（約 ${sizeStr}）`;
    } else {
      statsEl.textContent = '無法讀取快取狀態';
    }
  } catch (_) {
    statsEl.textContent = '無法讀取快取狀態';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const langSelect = document.getElementById('lang-select');
  for (const lang of Object.values(TARGET_LANGUAGES)) {
    const opt = document.createElement('option');
    opt.value = lang.id;
    opt.textContent = lang.label;
    langSelect.appendChild(opt);
  }

  const providerSelect = document.getElementById('provider-select');
  const providerGroups = new Map();
  for (const preset of Object.values(PROVIDER_PRESETS)) {
    const groupLabel = preset.group || '其他';
    if (!providerGroups.has(groupLabel)) {
      const og = document.createElement('optgroup');
      og.label = groupLabel;
      providerGroups.set(groupLabel, og);
      providerSelect.appendChild(og);
    }
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = preset.label;
    providerGroups.get(groupLabel).appendChild(opt);
  }

  const settings = await getSettings();
  langSelect.value = settings.targetLang || 'zh-TW';
  document.getElementById('custom-lang-input').value = settings.customTargetLang || '';
  document.getElementById('mode-select').value = settings.displayMode || 'replace';
  document.getElementById('translate-code-comments').checked = settings.translateCodeComments !== false;
  document.getElementById('show-output-btn').checked = settings.showOutputTranslateBtn !== false;
  document.getElementById('check-for-updates').checked = settings.checkForUpdates !== false;
  document.getElementById('typography-match').value = settings.typographyMatch || 'native';
  document.getElementById('thinking-effort').value = settings.thinkingEffort || 'fastest';
  document.getElementById('lazy-viewport').checked = settings.lazyViewport !== false;
  document.getElementById('stream-translation').checked = settings.streamTranslation !== false;
  document.getElementById('global-auto-translate').checked = Boolean(settings.autoTranslate);
  whitelistHosts = Array.isArray(settings.autoTranslateHosts)
    ? [...new Set(settings.autoTranslateHosts.map((h) => normalizeHostInput(h)).filter(Boolean))]
    : [];
  renderWhitelist();
  updateCustomLangVisibility();

  providerSelect.value = settings.providerId || 'deepseek';
  document.getElementById('protocol-select').value = settings.protocol || 'openai';
  document.getElementById('baseurl-input').value = settings.baseUrl || '';
  document.getElementById('apikey-input').value = settings.apiKey || '';
  document.getElementById('model-input').value = settings.model || '';
  document.getElementById('batch-size').value = settings.batchSize ?? 20;
  const maxCharsEl = document.getElementById('max-batch-chars');
  if (maxCharsEl) {
    maxCharsEl.value = settings.maxBatchChars ?? 5500;
  }
  document.getElementById('temperature-input').value = settings.temperature ?? 0.2;
  document.getElementById('glossary-input').value = settings.customGlossary ?? DEFAULT_GLOSSARY;

  const activePreset = PROVIDER_PRESETS[providerSelect.value];
  if (activePreset) {
    document.getElementById('provider-hint').textContent = activePreset.hint;
    document.getElementById('apikey-input').placeholder = activePreset.placeholderKey;
    updateModelSuggestions(activePreset);
  }
  updateEndpointPreview();
  await refreshCacheStats();

  const btnGenSync = document.getElementById('btn-generate-mobile-sync');
  const btnCopySync = document.getElementById('btn-copy-mobile-sync');
  const syncStatus = document.getElementById('mobile-sync-status');
  const syncBox = document.getElementById('mobile-sync-box');
  const syncUrlInput = document.getElementById('mobile-sync-url');
  const syncQrCanvas = document.getElementById('mobile-sync-qr');

  const invalidateMobileSync = () => {
    lastSyncUrl = '';
    if (syncUrlInput) syncUrlInput.value = '';
    if (btnCopySync) btnCopySync.disabled = true;
    if (syncBox) {
      syncBox.hidden = true;
      syncBox.classList.add('hidden');
    }
    if (syncStatus) {
      syncStatus.textContent = '';
      syncStatus.className = 'inline-status';
    }
  };

  langSelect.addEventListener('change', () => {
    updateCustomLangVisibility();
    invalidateMobileSync();
  });
  document.getElementById('custom-lang-input')?.addEventListener('input', invalidateMobileSync);
  document.getElementById('typography-match')?.addEventListener('change', invalidateMobileSync);
  document.getElementById('thinking-effort')?.addEventListener('change', invalidateMobileSync);

  providerSelect.addEventListener('change', (e) => {
    applyPreset(e.target.value);
    invalidateMobileSync();
  });

  document.getElementById('protocol-select')?.addEventListener('change', () => {
    updateEndpointPreview();
    invalidateMobileSync();
  });
  document.getElementById('baseurl-input')?.addEventListener('input', () => {
    updateEndpointPreview();
    invalidateMobileSync();
  });
  document.getElementById('model-input')?.addEventListener('input', () => {
    updateEndpointPreview();
    invalidateMobileSync();
  });
  document.getElementById('apikey-input')?.addEventListener('input', invalidateMobileSync);
  document.getElementById('stream-translation')?.addEventListener('change', updateEndpointPreview);

  document.getElementById('btn-toggle-key')?.addEventListener('click', (e) => {
    const input = document.getElementById('apikey-input');
    if (!input) return;
    const isPwd = input.type === 'password';
    input.type = isPwd ? 'text' : 'password';
    e.target.textContent = isPwd ? '隱藏' : '顯示';
  });

  document.getElementById('btn-add-host')?.addEventListener('click', handleAddHost);
  document.getElementById('whitelist-host-input')?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await handleAddHost();
    }
  });

  document.getElementById('btn-reset-glossary')?.addEventListener('click', () => {
    const el = document.getElementById('glossary-input');
    if (el) el.value = DEFAULT_GLOSSARY;
  });

  async function handleSave(statusElId) {
    const form = readFormValues();
    const statusEl = document.getElementById(statusElId);
    if (!statusEl) return;
    statusEl.className = 'inline-status';
    statusEl.textContent = '儲存中...';

    await ensureHostPermissionIfNeeded(form.baseUrl);
    await saveSettings(form);

    statusEl.className = 'inline-status ok';
    statusEl.textContent = '✓ 設定已儲存';
    setTimeout(() => { statusEl.textContent = ''; }, 2500);
  }

  document.getElementById('btn-save')?.addEventListener('click', async () => {
    await handleSave('save-status');
  });

  document.getElementById('btn-list-models')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-list-models');
    const statusEl = document.getElementById('model-list-status');
    const datalist = document.getElementById('model-suggestions');
    const modelInput = document.getElementById('model-input');
    if (!btn || !statusEl || !datalist) return;

    const form = readFormValues();
    btn.disabled = true;
    statusEl.hidden = false;
    statusEl.textContent = '正在取得模型清單...';

    try {
      await ensureHostPermissionIfNeeded(form.baseUrl);
      const res = await chrome.runtime.sendMessage({
        type: 'LIST_MODELS',
        settings: form
      });

      if (res?.ok && Array.isArray(res.models)) {
        datalist.replaceChildren();
        for (const id of res.models) {
          const opt = document.createElement('option');
          opt.value = id;
          datalist.appendChild(opt);
        }

        let msg = `已取得 ${res.models.length} 個可用模型，點模型欄位即可選擇`;
        const currentModel = String(modelInput?.value || '').trim();
        if (currentModel && !res.models.includes(currentModel)) {
          msg += ` · 目前填寫的「${currentModel}」不在清單中，可能已停用`;
        }
        statusEl.textContent = msg;
      } else {
        statusEl.textContent = res?.error || '取得模型清單失敗';
      }
    } catch (err) {
      statusEl.textContent = `取得模型清單失敗：${err?.message || '無法連線至背景服務'}`;
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btn-test')?.addEventListener('click', async () => {
    const form = readFormValues();
    const box = document.getElementById('test-result');
    if (!box) return;
    box.hidden = false;
    box.className = 'test-box';
    box.textContent = '正在測試連線...';

    await ensureHostPermissionIfNeeded(form.baseUrl);
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'TEST_CONNECTION',
        settings: form
      });

      if (res?.ok) {
        box.className = 'test-box ok';
        box.textContent = `連線成功 (${res.latencyMs} ms) · 範例譯文：${res.reply}`;
      } else {
        box.className = 'test-box err';
        box.textContent = `連線失敗：${res?.error || '未知錯誤'}`;
      }
    } catch (err) {
      box.className = 'test-box err';
      box.textContent = `連線失敗：${err?.message || '無法連線至背景服務'}`;
    }
  });

  document.getElementById('btn-clear-cache')?.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
    } catch (_) {}
    await refreshCacheStats();
  });

  if (btnGenSync) {
    btnGenSync.addEventListener('click', async () => {
      const form = readFormValues();
      if (!form.apiKey && !checkLocalEndpoint(form.baseUrl)) {
        invalidateMobileSync();
        if (syncStatus) {
          syncStatus.className = 'inline-status err';
          syncStatus.textContent = '請先填寫 API Key 再產生同步 QR Code';
        }
        return;
      }

      await saveSettings(form);
      try {
        const url = buildMobileSyncUrl(form);
        lastSyncUrl = url;
        if (syncUrlInput) syncUrlInput.value = url;
        renderQrToCanvas(syncQrCanvas, url);
        if (syncBox) {
          syncBox.hidden = false;
          syncBox.classList.remove('hidden');
        }
        if (btnCopySync) btnCopySync.disabled = false;
        if (syncStatus) {
          syncStatus.className = 'inline-status ok';
          syncStatus.textContent = '✓ 已產生同步 QR Code';
        }
      } catch (err) {
        lastSyncUrl = '';
        if (syncUrlInput) syncUrlInput.value = '';
        if (btnCopySync) btnCopySync.disabled = true;
        if (syncBox) {
          syncBox.hidden = true;
          syncBox.classList.add('hidden');
        }
        if (syncStatus) {
          syncStatus.className = 'inline-status err';
          syncStatus.textContent = err?.message || '產生 QR Code 失敗';
        }
      }
    });
  }

  if (btnCopySync) {
    btnCopySync.addEventListener('click', async () => {
      const url = lastSyncUrl || syncUrlInput?.value || '';
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        if (syncStatus) {
          syncStatus.className = 'inline-status ok';
          syncStatus.textContent = '✓ 已複製同步連結';
          setTimeout(() => {
            if (syncStatus.textContent === '✓ 已複製同步連結') {
              syncStatus.textContent = '';
            }
          }, 2500);
        }
      } catch (_) {
        syncUrlInput?.select();
      }
    });
  }
});
