// JRead — Options
// 使用者可調欄位：theme / fontSize / contentWidth（對齊 SPEC.md）。

// v0.8.16：DEFAULTS 改讀 settings-defaults.js 單一資料源（由 options.html
// `<script src="../content/settings-defaults.js">` 在 options.js 之前載入）。
// 原本 options 自宣告一份預設值 literal、靠 forcing spec 校對防 drift（CLAUDE.md
// 工作流原則 5）。shared 是 superset；options 實際只儲存 `fields` 列出的 9 欄
// + customShortcuts + autoEnableDomains，多出的預設 key 僅作 storage.get fallback、
// 不影響儲存範圍。titleFontSize 等欄位自動齊備（修掉 popup 缺 titleFontSize 的舊 drift）。
const DEFAULTS = window.__JReadSettingsDefaults;

const fields = ['theme', 'fontSize', 'titleFontSize', 'contentWidth', 'fontWeight', 'readwiseToken', 'blockPageShortcuts', 'pangu', 'spaceScrollRatio', 'positionMemoryDays'];

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
    case 'fontSize': case 'titleFontSize': case 'contentWidth':
    case 'fontWeight': case 'spaceScrollRatio': case 'positionMemoryDays': {
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
    case 'blockPageShortcuts': case 'pangu':
      return el.checked;
    case 'readwiseToken':
      return el.value.trim();
    default:
      return el.value;
  }
}

function applyFieldToDom(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  // 使用者正在編輯的欄位不回寫（避免打字途中被外部變更清掉）
  if (el === document.activeElement) return;
  if (id === 'fontWeight') {
    // 字重 select：值非 300/400/600（舊資料 / 損壞）時顯示「中」（400）
    el.value = [300, 400, 600].includes(Number(value)) ? String(Number(value)) : '400';
  } else if (id === 'blockPageShortcuts' || id === 'pangu') {
    el.checked = value !== false;
  } else if (id === 'readwiseToken') {
    el.value = value || '';
  } else {
    el.value = value;
  }
}

function load() {
  chrome.storage.sync.get(DEFAULTS, (values) => {
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

load();
