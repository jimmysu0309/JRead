// JRead — Popup entry
// 綁 DOM 事件、呼叫 chrome API、委派核心邏輯給 popup-core.js。
// 狀態提示主要走頁面 toast（content script 負責渲染）；popup 本身僅在
// toast 進不去的禁止注入頁面（例如 chrome://）顯示錯誤。
// 頁面設定直接寫入 chrome.storage.sync，content script 透過
// chrome.storage.onChanged 即時套用（不需要額外訊息協定）。

const versionEl = document.getElementById('version');
const statusEl = document.getElementById('status');
const toggleBtn = document.getElementById('toggle-btn');
const borderlessBtn = document.getElementById('borderless-btn');
const readwiseBtn = document.getElementById('readwise-btn');
const readwiseStatusEl = document.getElementById('readwise-status');
const openOptionsLink = document.getElementById('open-options');
const shortcutEl = document.getElementById('shortcut-hint');
const fontSizeValEl = document.getElementById('font-size-val');
const fontAutoBtn = document.getElementById('font-auto-btn');
const contentWidthValEl = document.getElementById('content-width-val');
const fontFamilySelect = document.getElementById('font-family-select');
const themeBtns = document.querySelectorAll('.theme-btn');

// ---- 設定範圍常數（對齊 SPEC 預設值）----------------------------------
// fontSize 特殊值 0 = "Auto / 原站字級"（styler 不注入任何 font-size override）
const FONT_SIZE = { min: 12, max: 32, step: 1, default: 18, auto: 0 };
const CONTENT_WIDTH = { min: 480, max: 1200, step: 40, default: 720 };
// v0.7.140：popup 字型 select 的 4 個內建 stack。預設 'system-ui' 對齊 styler
// DEFAULTS.fontFamily —— 選「系統預設」== 不注入 font-family override，保留各
// 站原本字體。其他三組故意把 generic family（serif / sans-serif / monospace）
// 放在 stack 末尾，確保即使 stack 內具名字型都沒裝，瀏覽器仍能 fall back 到
// 一個合理的通用 family。styler 注入時會再串接自己的 fallback chain，重複沒關
// 係（CSS 解析正確、第一個能命中的字型即勝出）。HTML 內 option value 必須與
// 此處字面值逐字一致（forcing function spec 會校對）。
const FONT_STACKS = {
  system: 'system-ui',
  serif: '"Noto Serif TC", Georgia, "Times New Roman", serif',
  sans: '"Noto Sans TC", -apple-system, "Helvetica Neue", sans-serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace'
};
const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: FONT_SIZE.default,
  contentWidth: CONTENT_WIDTH.default,
  fontFamily: FONT_STACKS.system,
  // v0.7.131：reader mode 攔截原站快速鍵；popup 不放 toggle（options 有），這裡
  // 僅作 storage.get 的 default fallback，避免讀回 undefined。
  blockPageShortcuts: true,
  // Pangu spacing（中英文間自動補空白）；popup 不放 toggle（options 有），這裡
  // 僅作 storage.get 的 default fallback，避免讀回 undefined。
  pangu: true
};

versionEl.textContent = chrome.runtime.getManifest().version;

// ---- 快速鍵提示 --------------------------------------------------------
chrome.commands.getAll((commands) => {
  if (!shortcutEl) return;
  const cmd = (commands || []).find(c => c.name === 'toggle-reader-mode');
  const shortcut = cmd && cmd.shortcut;
  if (shortcut) {
    shortcutEl.textContent = `快速鍵：${shortcut}`;
  } else {
    shortcutEl.innerHTML = '快速鍵未設定，請到 <code>chrome://extensions/shortcuts</code> 指派';
  }
});

// ---- 設定面板 ----------------------------------------------------------
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function render(settings) {
  const isAuto = settings.fontSize === FONT_SIZE.auto;
  fontSizeValEl.textContent = isAuto ? 'Auto' : String(settings.fontSize);
  contentWidthValEl.textContent = String(settings.contentWidth);
  for (const btn of themeBtns) {
    btn.classList.toggle('active', btn.dataset.theme === settings.theme);
  }
  // 邊界 disable
  // 字級 Auto 模式下 - 按鈕 disable、+ 按鈕從 Auto 跳到 DEFAULT
  document.querySelector('[data-action="font-dec"]').disabled =
    isAuto || settings.fontSize <= FONT_SIZE.min;
  document.querySelector('[data-action="font-inc"]').disabled =
    !isAuto && settings.fontSize >= FONT_SIZE.max;
  document.querySelector('[data-action="width-dec"]').disabled = settings.contentWidth <= CONTENT_WIDTH.min;
  document.querySelector('[data-action="width-inc"]').disabled = settings.contentWidth >= CONTENT_WIDTH.max;
  // Auto 按鈕 active 狀態
  if (fontAutoBtn) fontAutoBtn.classList.toggle('active', isAuto);
  // 字型 select：value 對 4 個 option match 不到（例如外部直接 storage.set
  // 自訂 stack）時 fall back 顯示「系統預設」但不寫回 storage，避免默默改動
  // 使用者外部設定。
  if (fontFamilySelect) {
    fontFamilySelect.value = settings.fontFamily;
    if (fontFamilySelect.value === '') fontFamilySelect.value = FONT_STACKS.system;
  }
}

let current = { ...DEFAULT_SETTINGS };

// v0.7.143：debounce storage.sync.set 防 chrome.storage.sync quota 踩線。
// 連點 stepper（fontSize 12-32 跨 20 step、contentWidth 480-1200 跨 18 step）
// 每 click 觸發一次 set，加上 storage.onChanged broadcast 到所有 tab 的 content
// script、各自跑 styler restore+apply，連環 cost。chrome.storage.sync quota：
// MAX_WRITE_OPERATIONS_PER_MINUTE = 120、MAX_WRITE_OPERATIONS_PER_HOUR = 1800。
// 200ms debounce 對人類連點足夠合併、單次調整無感。
//
// 設計：render 在 click 同步跑（UI 立刻反映、popup 內按鈕狀態跟著刷新），但
// storage.sync.set 透過 debounce 合併。pendingPatch 累積所有未 commit 的欄位。
let saveTimer = null;
let pendingPatch = {};
function commitSave() {
  if (!Object.keys(pendingPatch).length) return;
  const patch = pendingPatch;
  pendingPatch = {};
  saveTimer = null;
  try {
    chrome.storage.sync.set(patch);
  } catch (_) { /* QuotaExceeded 等 silently 吞——current 已有最新值，下次 popup 開啟仍會走 storage.get */ }
}

function save(patch) {
  Object.assign(current, patch);
  Object.assign(pendingPatch, patch);
  render(current);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(commitSave, 200);
  // content script 透過 storage.onChanged 即時重新套用（若閱讀模式開啟）
}

// popup 即將關閉時強制 flush pending patch（不然連點後立刻關 popup 會丟失最後幾次變更）
window.addEventListener('beforeunload', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    commitSave();
  }
});

chrome.storage.sync.get(DEFAULT_SETTINGS, (values) => {
  current = { ...DEFAULT_SETTINGS, ...values };
  render(current);
});

for (const btn of themeBtns) {
  btn.addEventListener('click', () => save({ theme: btn.dataset.theme }));
}

document.querySelector('[data-action="font-dec"]').addEventListener('click', () => {
  // Auto 模式下 - 不做事（按鈕 disabled，這裡只是 fallback）
  if (current.fontSize === FONT_SIZE.auto) return;
  save({ fontSize: clamp(current.fontSize - FONT_SIZE.step, FONT_SIZE.min, FONT_SIZE.max) });
});
document.querySelector('[data-action="font-inc"]').addEventListener('click', () => {
  // 從 Auto 按 + 直接跳到 DEFAULT（使用者從「保留原站」想回到手動控制）
  if (current.fontSize === FONT_SIZE.auto) {
    save({ fontSize: FONT_SIZE.default });
    return;
  }
  save({ fontSize: clamp(current.fontSize + FONT_SIZE.step, FONT_SIZE.min, FONT_SIZE.max) });
});
if (fontAutoBtn) {
  fontAutoBtn.addEventListener('click', () => {
    // toggle：Auto ↔ DEFAULT。按 "自動" 切到 Auto（0）；已在 Auto 再按切回 DEFAULT
    const next = current.fontSize === FONT_SIZE.auto
      ? FONT_SIZE.default
      : FONT_SIZE.auto;
    save({ fontSize: next });
  });
}
document.querySelector('[data-action="width-dec"]').addEventListener('click', () => {
  save({ contentWidth: clamp(current.contentWidth - CONTENT_WIDTH.step, CONTENT_WIDTH.min, CONTENT_WIDTH.max) });
});
document.querySelector('[data-action="width-inc"]').addEventListener('click', () => {
  save({ contentWidth: clamp(current.contentWidth + CONTENT_WIDTH.step, CONTENT_WIDTH.min, CONTENT_WIDTH.max) });
});
if (fontFamilySelect) {
  fontFamilySelect.addEventListener('change', (e) => {
    save({ fontFamily: e.target.value });
  });
}

// ---- 切換閱讀模式 ------------------------------------------------------
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

toggleBtn.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (!tabId) {
    statusEl.textContent = '無法取得當前分頁';
    statusEl.hidden = false;
    return;
  }

  const { toggleWithInjectionFallback } = window.__JReadPopup;
  const result = await toggleWithInjectionFallback(tabId, {
    sendMessage: (id, msg) => chrome.tabs.sendMessage(id, msg),
    executeScript: (opts) => chrome.scripting.executeScript(opts)
  });

  if (result.ok) {
    window.close();
  } else {
    statusEl.textContent = '此頁面無法啟動閱讀模式';
    statusEl.hidden = false;
  }
});

openOptionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ---- Readwise Reader 整合 ----------------------------------------------
// popup 開啟時查 reader mode 是否啟動，沒啟動就把按鈕 disable。
// 沒注入 content script 的頁面（chrome://、Web Store 等）sendMessage 會 reject，
// 同樣 disable。
function setReadwiseStatus(text, kind) {
  if (!text) {
    readwiseStatusEl.hidden = true;
    readwiseStatusEl.textContent = '';
    readwiseStatusEl.className = '';
    return;
  }
  readwiseStatusEl.hidden = false;
  readwiseStatusEl.textContent = text;
  readwiseStatusEl.className = kind || 'info';
}

// v0.7.130：非閱讀模式時整顆按鈕隱藏（不只 disabled）。 reader mode 才是
// 「送到 Readwise」有意義的入口；非閱讀模式露出灰色 disabled 按鈕只是雜訊。
// 用 `hidden` 屬性（瀏覽器原生 display:none），保留 `disabled` 給「送出中
// 防連點」用——hidden 與 disabled 是兩個獨立軸：hidden=「現在不該看到」、
// disabled=「看得到但暫時不能按」。
//
// v0.7.133：擴增為 refreshPopupForActiveTab，同時依 siteMode 切換 toggle 按鈕
// 文字（YouTube watch → 影院模式）。Readwise 按鈕在 cinema mode 下強制 hidden
// （cinema mode 沒主文 outerHTML 可送，按鈕露出無意義）。
async function refreshPopupForActiveTab() {
  const tabId = await getActiveTabId();
  if (!tabId) {
    readwiseBtn.hidden = true;
    borderlessBtn.hidden = true;
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_READER_STATE' });
    const siteMode = res && res.siteMode;
    const active = !!(res && res.active);
    const cinemaActive = !!(res && res.cinemaActive);
    const borderlessActive = !!(res && res.borderlessActive);
    // YouTube watch 頁：toggle 按鈕文字改「啟動 / 退出影院模式」；其他站維持
    // popup.html 的 default「切換閱讀模式」。
    if (siteMode === 'youtube-cinema') {
      toggleBtn.textContent = cinemaActive ? '退出影院模式' : '啟動影院模式';
    }
    // v0.7.134：無邊模式按鈕——YouTube watch 頁才露出（與 cinema 完全獨立、
    // 兩者可同時 toggle）。按鈕文字依 borderless 自己的 active 狀態切換。
    if (siteMode === 'youtube-cinema') {
      borderlessBtn.hidden = false;
      borderlessBtn.textContent = borderlessActive ? '退出無邊模式' : '啟動無邊模式';
    } else {
      borderlessBtn.hidden = true;
    }
    // Readwise 按鈕：active=true 且 非 cinema 才露出（cinema 沒主文可送）
    readwiseBtn.hidden = !active || cinemaActive;
  } catch (_) {
    readwiseBtn.hidden = true;
    borderlessBtn.hidden = true;
  }
}

// v0.7.134：點按鈕 → sendMessage TOGGLE_YT_BORDERLESS。content script 端
// 委派給 NS.borderless.toggle()；無 inject fallback（YouTube watch 頁本身
// 一定載過 jread content script，不會發生 receiving end does not exist）。
borderlessBtn.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_YT_BORDERLESS' });
  } catch (_) { /* content script 沒注入時 silently fail */ }
  window.close();
});

readwiseBtn.addEventListener('click', async () => {
  readwiseBtn.disabled = true;
  setReadwiseStatus('送出中…', 'info');

  const tabId = await getActiveTabId();
  if (!tabId) {
    setReadwiseStatus('無法取得當前分頁', 'err');
    readwiseBtn.disabled = false;
    return;
  }

  let extracted;
  try {
    extracted = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_READER_HTML' });
  } catch (e) {
    setReadwiseStatus('無法取得頁面內容（請重新啟動閱讀模式）', 'err');
    readwiseBtn.disabled = false;
    return;
  }
  if (!extracted || !extracted.ok) {
    setReadwiseStatus('閱讀模式未啟動', 'err');
    readwiseBtn.disabled = false;
    return;
  }

  const result = await chrome.runtime.sendMessage({
    type: 'SAVE_TO_READWISE',
    payload: extracted.payload
  });

  if (result && result.ok) {
    setReadwiseStatus(result.status === 200 ? '已存在於 Readwise Reader' : '已送到 Readwise Reader', 'ok');
  } else if (result && result.error === 'NO_TOKEN') {
    setReadwiseStatus('尚未設定 Readwise token，請到「進階設定」填入', 'err');
  } else if (result && result.error === 'AUTH') {
    setReadwiseStatus('Readwise token 無效或已過期', 'err');
  } else if (result && result.error === 'NETWORK') {
    setReadwiseStatus('網路錯誤，請稍後再試', 'err');
  } else {
    const detail = result && result.status ? `（HTTP ${result.status}）` : '';
    setReadwiseStatus(`送出失敗${detail}`, 'err');
  }
  readwiseBtn.disabled = false;
});

refreshPopupForActiveTab();
