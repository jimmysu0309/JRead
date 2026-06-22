// JRead — Options
// 進階設定欄位（主題 / 字級 / 標題字級 / 版心寬度 / 字重 已移到 popup 即時調整）。

// v0.8.16：DEFAULTS 改讀 settings-defaults.js 單一資料源（由 options.html
// `<script src="../content/settings-defaults.js">` 在 options.js 之前載入）。
// 原本 options 自宣告一份預設值 literal、靠 forcing spec 校對防 drift（CLAUDE.md
// 工作流原則 5）。shared 是 superset；options 實際只儲存 `fields` 列出的 9 欄
// + customShortcuts + autoEnableDomains，多出的預設 key 僅作 storage.get fallback、
// 不影響儲存範圍。titleFontSize 等欄位自動齊備（修掉 popup 缺 titleFontSize 的舊 drift）。
const DEFAULTS = window.__JReadSettingsDefaults;

// v0.8.158：theme / fontSize / titleFontSize / contentWidth / fontWeight 已移到
// popup（工具列圖示選單）即時調整，options 不再列出這幾欄（避免雙入口 drift）。
const fields = ['readwiseToken', 'readwiseSummary', 'geminiApiKey', 'blockPageShortcuts', 'pangu', 'editModeEnabled', 'spaceScrollRatio', 'positionMemoryDays', 'threeFingerTap', 'floatingIcon', 'floatingIconOpacity', 'floatingIconSize'];

// v0.8.154：懸浮按鈕啟用旗標的解析（settings-defaults.js 單一資料源）。
// 未設過（非 boolean）時一律預設勾（v0.8.158）——checkbox 顯示初值與
// content/floating-icon.js 走同一個 resolver，不在 options 另寫一份判定。
const resolveFloatingIconEnabled = window.__JReadResolveFloatingIconEnabled || ((v) => v === true);

document.getElementById('version').textContent = chrome.runtime.getManifest().version;

// ---- 快速鍵 recorder（v0.7.218）--------------------------------------
// 點 recorder 進入錄製狀態 → window keydown capture 抓組合 → validate →
// 寫回 storage.sync.customShortcuts 整張表。比對 / 驗證 / 格式化邏輯共用
// content/shortcut-utils.js（window.__JReadShortcuts），與 content script
// 的 keydown 比對單一資料源。
const SC = window.__JReadShortcuts;
let shortcutTable = SC.sanitizeTable(null); // 三 key 全 null
let recordingCmd = null;                    // 錄製中的 command（null = 沒在錄）

// runtime 偵測（依 extension URL 前綴，非 OS / build flag）：
//   chrome-extension:// → Chrome、moz-extension:// → Firefox、其餘 → Safari
//   （safari-web-extension:// 涵蓋 macOS / iPadOS / iOS Safari）。
// body class 讓「說明文字依引擎切換」純 CSS 完成（不需額外 JS）；
// isSafariRuntime 餵給 validate 的 requireCtrl——Safari 自訂鍵必含 ⌃ Control。
const extUrl = chrome.runtime.getURL('');
let runtime = 'safari';
if (extUrl.startsWith('chrome-extension://')) runtime = 'chrome';
else if (extUrl.startsWith('moz-extension://')) runtime = 'firefox';
document.body.classList.add('runtime-' + runtime);
const isSafariRuntime = (runtime === 'safari');

// hint 文字加 ⚠ 前綴（空字串不撐空間，CSS :not(:empty) 才上 amber 底框）
function shortcutHint(msg) {
  document.getElementById('shortcut-hint').textContent = msg ? '⚠ ' + msg : '';
}

// 錄製被拒時讓該 recorder 紅框 + 抖動閃一下（~1.2s 後移除）
function flashRecorderInvalid(cmd) {
  const btn = document.getElementById('sc-' + cmd);
  if (!btn) return;
  btn.classList.remove('invalid'); // 連續被拒時重啟動畫
  // 強制 reflow 讓 animation 重新觸發
  void btn.offsetWidth;
  btn.classList.add('invalid');
  setTimeout(() => btn.classList.remove('invalid'), 1200);
}

function renderShortcuts() {
  SC.COMMANDS.forEach((cmd) => {
    const btn = document.getElementById('sc-' + cmd);
    const clearBtn = document.getElementById('sc-clear-' + cmd);
    if (!btn) return;
    const custom = shortcutTable[cmd];
    const def = SC.MANIFEST_DEFAULTS[cmd];
    if (recordingCmd === cmd) {
      btn.textContent = '按下組合鍵…';
    } else if (custom) {
      btn.textContent = SC.format(custom);
    } else {
      btn.textContent = def ? SC.format(def) + '（預設）' : '未設定';
    }
    btn.classList.toggle('recording', recordingCmd === cmd);
    btn.classList.toggle('is-default', !custom && recordingCmd !== cmd);
    if (clearBtn) clearBtn.disabled = !custom;
  });
}

function saveShortcuts() {
  chrome.storage.sync.set({ customShortcuts: shortcutTable }, flashSaved);
}

SC.COMMANDS.forEach((cmd) => {
  document.getElementById('sc-' + cmd).addEventListener('click', () => {
    // 再點同一顆 = 取消錄製
    recordingCmd = recordingCmd === cmd ? null : cmd;
    shortcutHint('');
    renderShortcuts();
  });
  document.getElementById('sc-clear-' + cmd).addEventListener('click', () => {
    shortcutTable[cmd] = null;
    recordingCmd = null;
    shortcutHint('');
    saveShortcuts();
    renderShortcuts();
  });
});

// 錄製用 keydown：capture phase 搶在頁面其他 handler 前
window.addEventListener('keydown', (e) => {
  if (!recordingCmd) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.code === 'Escape') { // 取消錄製
    recordingCmd = null;
    renderShortcuts();
    return;
  }
  const s = SC.eventToShortcut(e);
  if (!s) return; // 純 modifier 鍵——組合未完成，等下一鍵
  const rejectedCmd = recordingCmd; // flash 用——下面會把 recordingCmd 清掉
  const v = SC.validate(s, { requireCtrl: isSafariRuntime });
  if (!v.ok) {
    shortcutHint(v.reason);
    recordingCmd = null;
    renderShortcuts();
    flashRecorderInvalid(rejectedCmd);
    return;
  }
  // 與其他指令的「生效鍵」（自訂值 || 內建預設）衝突檢查
  for (const other of SC.COMMANDS) {
    if (other === recordingCmd) continue;
    const effective = shortcutTable[other] || SC.MANIFEST_DEFAULTS[other];
    if (effective && SC.shortcutEquals(s, effective)) {
      shortcutHint(SC.format(s) + ' 已指派給其他指令');
      recordingCmd = null;
      renderShortcuts();
      flashRecorderInvalid(rejectedCmd);
      return;
    }
  }
  shortcutTable[recordingCmd] = s;
  recordingCmd = null;
  shortcutHint('');
  saveShortcuts();
  renderShortcuts();
}, true);

// ---- 欄位 ↔ DOM 雙向轉換（單一資料源，load 與 storage.onChanged 共用）------
// v0.8.35：原本 save() 把 9 欄全部從 DOM 讀回整包重寫——options 分頁開著時，
// popup（或另一個 options 分頁）寫入的變更會被本頁 DOM 殘留值無聲蓋回（stale
// overwrite，CLAUDE.md 工作流原則 5 的雙 path drift）。改成：
//   1. 每欄 change 只寫該欄（diff write）
//   2. storage.onChanged 把其他 context 的變更同步回本頁 DOM（全欄位，不只
//      autoEnableDomains）
function readFieldFromDom(id) {
  const el = document.getElementById(id);
  switch (id) {
    case 'spaceScrollRatio': case 'positionMemoryDays':
    case 'floatingIconOpacity': {
      // v0.8.36：number input 的 min/max 屬性不阻止手動輸入超界值或留空
      // （Number('') = 0 → contentWidth 存 0）。以 input 自身的 min/max 為
      // clamp 範圍（單一資料源在 HTML），空值 / NaN 退回 shared 預設值——
      // 與 popup 端 clamp() 防護對齊（原本兩條寫入 path 驗證不一致）
      let n = Number(el.value);
      if (el.value === '' || !Number.isFinite(n)) n = Number(DEFAULTS[id]);
      if (typeof el.min === 'string' && el.min !== '') n = Math.max(Number(el.min), n);
      if (typeof el.max === 'string' && el.max !== '') n = Math.min(Number(el.max), n);
      return n;
    }
    case 'threeFingerTap': case 'floatingIcon':
    case 'blockPageShortcuts': case 'pangu': case 'editModeEnabled': case 'readwiseSummary':
      return el.checked;
    case 'readwiseToken': case 'geminiApiKey':
      return el.value.trim();
    default:
      return el.value;
  }
}

// 透明度 % 讀數（input 拖動即時更新，與 storage 無關）
function updateOpacityReadout(frac) {
  const out = document.getElementById('floatingIconOpacityVal');
  if (out) out.textContent = Math.round(Number(frac) * 100) + '%';
}

function applyFieldToDom(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  // 使用者正在編輯的欄位不回寫（避免打字途中被外部變更清掉）
  if (el === document.activeElement) return;
  if (id === 'blockPageShortcuts' || id === 'pangu' || id === 'editModeEnabled') {
    el.checked = value !== false;
  } else if (id === 'threeFingerTap') {
    // v0.8.157：預設 false——只有明確為 true 才勾選
    el.checked = value === true;
  } else if (id === 'floatingIcon') {
    // 三態：boolean 尊重使用者設定；未設過（null / undefined）一律預設勾（v0.8.158）
    el.checked = resolveFloatingIconEnabled(value);
  } else if (id === 'floatingIconOpacity') {
    const n = typeof value === 'number' && isFinite(value) ? value : Number(DEFAULTS.floatingIconOpacity);
    el.value = String(n);
    updateOpacityReadout(n);
  } else if (id === 'floatingIconSize') {
    // 'small' / 'large' 兩值；舊資料 / 損壞退回預設 'small'
    el.value = value === 'large' ? 'large' : 'small';
  } else if (id === 'readwiseSummary') {
    // 預設 false——只有明確為 true 才勾選
    el.checked = value === true;
  } else if (id === 'readwiseToken' || id === 'geminiApiKey') {
    el.value = value || '';
  } else {
    el.value = value;
  }
}

function load() {
  // floatingIcon 不在 DEFAULTS（三態）——以 null fallback 一併請求，
  // applyFieldToDom 收到 null 時走 resolveFloatingIconEnabled 解析（未設過預設開）。
  chrome.storage.sync.get(Object.assign({ floatingIcon: null }, DEFAULTS), (values) => {
    fields.forEach((id) => applyFieldToDom(id, values[id]));
    // autoEnableDomains：array → textarea 多行字串（每行一個正規化過的網域）
    const helper = window.__JReadDomainMatch;
    const list = Array.isArray(values.autoEnableDomains) ? values.autoEnableDomains : [];
    document.getElementById('autoEnableDomains').value =
      helper ? helper.serializeList(list) : list.join('\n');
    // v0.7.218：自訂快速鍵——storage 讀回值消毒後渲染 recorder 顯示
    shortcutTable = SC.sanitizeTable(values.customShortcuts);
    renderShortcuts();
  });
}

function flashSaved() {
  const s = document.getElementById('save-status');
  // v0.8.35：set 失敗（quota / 寫入頻率超限）不可閃「已儲存」假訊號
  if (chrome.runtime.lastError) {
    s.textContent = '儲存失敗，請稍後再試';
    setTimeout(() => { s.textContent = ''; }, 3000);
    return;
  }
  s.textContent = '已儲存';
  setTimeout(() => { s.textContent = ''; }, 1500);
}

// 任何欄位變更即存檔——只寫該欄（diff write，見上方 v0.8.35 註解）
fields.forEach((id) => {
  document.getElementById(id).addEventListener('change', () => {
    chrome.storage.sync.set({ [id]: readFieldFromDom(id) }, flashSaved);
  });
});

// 透明度滑桿拖動途中即時更新 % 讀數（change 才存檔；input 只更新顯示）
const opacityRange = document.getElementById('floatingIconOpacity');
if (opacityRange) {
  opacityRange.addEventListener('input', () => updateOpacityReadout(opacityRange.value));
}

// ---- Readwise token 測試（v0.8.64）-----------------------------------
// 讀 input 目前值（含尚未 blur 存檔的輸入）→ 走 popup-core.validateReadwiseToken
// 打官方 auth 端點驗證。fetch 在 options 頁直接發（extension 頁有 <all_urls>
// host_permission，免 CORS）。結果雙通道呈現（色 + ✓ / ✗ 符號）。
const readwiseTestBtn = document.getElementById('readwiseTest');
const readwiseTestResultEl = document.getElementById('readwiseTestResult');

function setReadwiseTestResult(kind, text) {
  readwiseTestResultEl.textContent = text;
  readwiseTestResultEl.className = 'token-test-result is-' + kind;
}

if (readwiseTestBtn && readwiseTestResultEl) {
  readwiseTestBtn.addEventListener('click', async () => {
    const token = document.getElementById('readwiseToken').value.trim();
    if (!token) {
      setReadwiseTestResult('error', '✗ 請先貼上 token');
      return;
    }
    const PopupAPI = window.__JReadPopup;
    if (!PopupAPI || typeof PopupAPI.validateReadwiseToken !== 'function') {
      setReadwiseTestResult('error', '✗ 無法載入驗證模組');
      return;
    }
    setReadwiseTestResult('pending', '測試中…');
    readwiseTestBtn.disabled = true;
    let result;
    try {
      result = await PopupAPI.validateReadwiseToken({ token });
    } catch (_) {
      result = { ok: false, error: 'NETWORK' };
    }
    readwiseTestBtn.disabled = false;
    if (result.ok) {
      setReadwiseTestResult('ok', '✓ Token 有效');
    } else if (result.error === 'AUTH') {
      setReadwiseTestResult('error', '✗ Token 無效或已過期');
    } else if (result.error === 'NETWORK') {
      setReadwiseTestResult('error', '✗ 無法連線，請檢查網路');
    } else {
      setReadwiseTestResult('error', '✗ 測試失敗（' + (result.status || result.error || '未知') + '）');
    }
  });

  // 使用者重新編輯 token 時清掉上次測試結果（避免舊結果誤導）
  document.getElementById('readwiseToken').addEventListener('input', () => {
    setReadwiseTestResult('', '');
  });
}

// ---- Gemini API key 測試（v0.8.74）---------------------------------
// 讀 input 目前值 → 走 popup-core.validateGeminiKey 打 models list 端點（GET、
// 零 token 成本）。與 Readwise 測試同一套呈現（色 + ✓ / ✗ 雙通道）。
const geminiTestBtn = document.getElementById('geminiTest');
const geminiTestResultEl = document.getElementById('geminiTestResult');

function setGeminiTestResult(kind, text) {
  geminiTestResultEl.textContent = text;
  geminiTestResultEl.className = 'token-test-result is-' + kind;
}

if (geminiTestBtn && geminiTestResultEl) {
  geminiTestBtn.addEventListener('click', async () => {
    const apiKey = document.getElementById('geminiApiKey').value.trim();
    if (!apiKey) {
      setGeminiTestResult('error', '✗ 請先貼上 API key');
      return;
    }
    const PopupAPI = window.__JReadPopup;
    if (!PopupAPI || typeof PopupAPI.validateGeminiKey !== 'function') {
      setGeminiTestResult('error', '✗ 無法載入驗證模組');
      return;
    }
    setGeminiTestResult('pending', '測試中…');
    geminiTestBtn.disabled = true;
    let result;
    try {
      result = await PopupAPI.validateGeminiKey({ apiKey });
    } catch (_) {
      result = { ok: false, error: 'NETWORK' };
    }
    geminiTestBtn.disabled = false;
    if (result.ok) {
      setGeminiTestResult('ok', '✓ API key 有效');
    } else if (result.error === 'AUTH') {
      setGeminiTestResult('error', '✗ API key 無效');
    } else if (result.error === 'NETWORK') {
      setGeminiTestResult('error', '✗ 無法連線，請檢查網路');
    } else {
      setGeminiTestResult('error', '✗ 測試失敗（' + (result.status || result.error || '未知') + '）');
    }
  });

  // 使用者重新編輯 key 時清掉上次測試結果
  document.getElementById('geminiApiKey').addEventListener('input', () => {
    setGeminiTestResult('', '');
  });
}

// autoEnableDomains 走獨立路徑：textarea 多行字串 → parseList → 寫回 sync。
// 用 'change'（blur 觸發）而非 'input'，避免使用者打字途中每按一鍵就 set
// 觸發 chrome.storage.sync 寫入配額 + 跨 tab broadcast。
document.getElementById('autoEnableDomains').addEventListener('change', (e) => {
  const helper = window.__JReadDomainMatch;
  const raw = e.target.value;
  const list = helper ? helper.parseList(raw) : raw.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
  chrome.storage.sync.set({ autoEnableDomains: list }, () => {
    // 把正規化結果寫回 textarea（含 lowercase / 去 scheme / 去 path / 去重），
    // 讓使用者立刻看到實際生效的清單
    if (helper) e.target.value = helper.serializeList(list);
    flashSaved();
  });
});

// 其他 context（popup / 另一個 options 分頁）寫入時，options 開著要跟著刷新。
// v0.8.35：從只同步 autoEnableDomains 擴成全欄位 + customShortcuts——這是
// diff-write 修法的另一半（DOM 永遠反映 storage 最新值，殘留 stale 值的面消失）
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const id of fields) {
      if (id in changes) applyFieldToDom(id, changes[id].newValue);
    }
    if ('customShortcuts' in changes && !recordingCmd) {
      shortcutTable = SC.sanitizeTable(changes.customShortcuts.newValue);
      renderShortcuts();
    }
    if ('autoEnableDomains' in changes) {
      const helper = window.__JReadDomainMatch;
      const next = changes.autoEnableDomains.newValue;
      const list = Array.isArray(next) ? next : [];
      const ta = document.getElementById('autoEnableDomains');
      if (ta !== document.activeElement) {
        ta.value = helper ? helper.serializeList(list) : list.join('\n');
      }
    }
  });
}

// ---- 回復預設設定（v0.8.157）-----------------------------------------
// 把所有設定複寫回 settings-defaults.js 的預設值，但保留兩個 API key
//（readwiseToken / geminiApiKey——使用者貼過的憑證，重 reset 不該被洗掉）。
// floatingIcon 三態回復為「未設過」（null → resolveFloatingIconEnabled 走預設開）、
// floatingIconPos 拖移位置一併清掉。danger 雙態：第一次點進入確認狀態，
// 4s 未再點自動還原，避免誤觸。
const resetBtn = document.getElementById('resetDefaults');
const resetStatusEl = document.getElementById('reset-status');
let resetConfirming = false;
let resetConfirmTimer = null;

function exitResetConfirm() {
  resetConfirming = false;
  if (resetConfirmTimer) { clearTimeout(resetConfirmTimer); resetConfirmTimer = null; }
  if (resetBtn) {
    resetBtn.classList.remove('confirming');
    resetBtn.textContent = '回復預設';
  }
}

if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    if (!resetConfirming) {
      // 第一次點：進入確認狀態
      resetConfirming = true;
      resetBtn.classList.add('confirming');
      resetBtn.textContent = '再按一次確認';
      resetConfirmTimer = setTimeout(exitResetConfirm, 4000);
      return;
    }
    // 第二次點：執行回復
    exitResetConfirm();
    const payload = Object.assign({}, DEFAULTS);
    delete payload.readwiseToken; // 保留使用者憑證
    delete payload.geminiApiKey;  // 保留使用者憑證
    payload.floatingIcon = null;  // 回復三態（未設過 → 預設開）
    payload.floatingIconPos = null; // 清掉拖移位置
    chrome.storage.sync.set(payload, () => {
      if (chrome.runtime.lastError) {
        resetStatusEl.textContent = '回復失敗，請稍後再試';
        setTimeout(() => { resetStatusEl.textContent = ''; }, 3000);
        return;
      }
      load(); // 重讀 storage 刷新整個表單顯示
      resetStatusEl.textContent = '已回復預設設定';
      setTimeout(() => { resetStatusEl.textContent = ''; }, 2000);
    });
  });
}

load();
