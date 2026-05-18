// JRead — Popup entry
// 綁 DOM 事件、呼叫 chrome API、委派核心邏輯給 popup-core.js。
// 狀態提示主要走頁面 toast（content script 負責渲染）；popup 本身僅在
// toast 進不去的禁止注入頁面（例如 chrome://）顯示錯誤。
// 頁面設定直接寫入 chrome.storage.sync，content script 透過
// chrome.storage.onChanged 即時套用（不需要額外訊息協定）。

const versionEl = document.getElementById('version');
const statusEl = document.getElementById('status');
const toggleBtn = document.getElementById('toggle-btn');
const readwiseBtn = document.getElementById('readwise-btn');
const readwiseStatusEl = document.getElementById('readwise-status');
const openOptionsLink = document.getElementById('open-options');
const shortcutEl = document.getElementById('shortcut-hint');
const fontSizeValEl = document.getElementById('font-size-val');
const fontAutoBtn = document.getElementById('font-auto-btn');
const contentWidthValEl = document.getElementById('content-width-val');
const themeBtns = document.querySelectorAll('.theme-btn');

// ---- 設定範圍常數（對齊 SPEC 預設值）----------------------------------
// fontSize 特殊值 0 = "Auto / 原站字級"（styler 不注入任何 font-size override）
const FONT_SIZE = { min: 12, max: 32, step: 1, default: 18, auto: 0 };
const CONTENT_WIDTH = { min: 480, max: 1200, step: 40, default: 720 };
const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: FONT_SIZE.default,
  contentWidth: CONTENT_WIDTH.default,
  // v0.7.131：reader mode 攔截原站快速鍵；popup 不放 toggle（options 有），這裡
  // 僅作 storage.get 的 default fallback，避免讀回 undefined。
  blockPageShortcuts: true
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
}

let current = { ...DEFAULT_SETTINGS };

function save(patch) {
  Object.assign(current, patch);
  render(current);
  chrome.storage.sync.set(patch);
  // content script 透過 storage.onChanged 即時重新套用（若閱讀模式開啟）
}

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
async function refreshReadwiseButton() {
  const tabId = await getActiveTabId();
  if (!tabId) {
    readwiseBtn.hidden = true;
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_READER_STATE' });
    readwiseBtn.hidden = !(res && res.active);
  } catch (_) {
    readwiseBtn.hidden = true;
  }
}

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

refreshReadwiseButton();
