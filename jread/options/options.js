// JRead — Options
// 使用者可調欄位：theme / fontSize / contentWidth（對齊 SPEC.md）。

// v0.8.16：DEFAULTS 改讀 settings-defaults.js 單一資料源（由 options.html
// `<script src="../content/settings-defaults.js">` 在 options.js 之前載入）。
// 原本 options 自宣告一份預設值 literal、靠 forcing spec 校對防 drift（CLAUDE.md
// 工作流原則 5）。shared 是 superset；options 實際只儲存 `fields` 列出的 9 欄
// + customShortcuts + autoEnableDomains，多出的預設 key 僅作 storage.get fallback、
// 不影響儲存範圍。titleFontSize 等欄位自動齊備（修掉 popup 缺 titleFontSize 的舊 drift）。
const DEFAULTS = window.__JReadSettingsDefaults;

const fields = ['theme', 'fontSize', 'titleFontSize', 'contentWidth', 'fontWeight', 'readwiseToken', 'blockPageShortcuts', 'pangu', 'spaceScrollRatio'];

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

function load() {
  chrome.storage.sync.get(DEFAULTS, (values) => {
    document.getElementById('theme').value = values.theme;
    document.getElementById('fontSize').value = values.fontSize;
    document.getElementById('titleFontSize').value = values.titleFontSize;
    document.getElementById('contentWidth').value = values.contentWidth;
    // 字重 select：值非 300/400/600（舊資料 / 損壞）時顯示「中」（400）
    document.getElementById('fontWeight').value =
      [300, 400, 600].includes(Number(values.fontWeight)) ? String(Number(values.fontWeight)) : '400';
    document.getElementById('readwiseToken').value = values.readwiseToken || '';
    document.getElementById('blockPageShortcuts').checked = values.blockPageShortcuts !== false;
    document.getElementById('pangu').checked = values.pangu !== false;
    document.getElementById('spaceScrollRatio').value = values.spaceScrollRatio;
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
  s.textContent = '已儲存';
  setTimeout(() => { s.textContent = ''; }, 1500);
}

function save() {
  const patch = {
    theme: document.getElementById('theme').value,
    fontSize: Number(document.getElementById('fontSize').value),
    titleFontSize: Number(document.getElementById('titleFontSize').value),
    contentWidth: Number(document.getElementById('contentWidth').value),
    fontWeight: Number(document.getElementById('fontWeight').value),
    readwiseToken: document.getElementById('readwiseToken').value.trim(),
    blockPageShortcuts: document.getElementById('blockPageShortcuts').checked,
    pangu: document.getElementById('pangu').checked,
    spaceScrollRatio: Number(document.getElementById('spaceScrollRatio').value)
  };
  chrome.storage.sync.set(patch, flashSaved);
}

// 任何欄位變更即存檔
fields.forEach((id) => {
  document.getElementById(id).addEventListener('change', save);
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

// popup 端 toggle 會即時更新 sync.autoEnableDomains；options 開著時跟著刷新
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !('autoEnableDomains' in changes)) return;
    const helper = window.__JReadDomainMatch;
    const next = changes.autoEnableDomains.newValue;
    const list = Array.isArray(next) ? next : [];
    document.getElementById('autoEnableDomains').value =
      helper ? helper.serializeList(list) : list.join('\n');
  });
}

load();
