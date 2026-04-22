// JRead — Popup entry
// 綁 DOM 事件、呼叫 chrome API、委派核心邏輯給 popup-core.js。
// 狀態提示主要走頁面 toast（content script 負責渲染）；popup 本身僅在
// toast 進不去的禁止注入頁面（例如 chrome://）顯示錯誤。
// 頁面設定直接寫入 chrome.storage.sync，content script 透過
// chrome.storage.onChanged 即時套用（不需要額外訊息協定）。

const versionEl = document.getElementById('version');
const statusEl = document.getElementById('status');
const toggleBtn = document.getElementById('toggle-btn');
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
  contentWidth: CONTENT_WIDTH.default
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
