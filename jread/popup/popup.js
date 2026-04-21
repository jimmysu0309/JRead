// JRead — Popup entry
// 綁 DOM 事件、呼叫 chrome API、委派核心邏輯給 popup-core.js。
// 狀態提示主要走頁面 toast（content script 負責渲染）；popup 本身僅在
// toast 進不去的禁止注入頁面（例如 chrome://）顯示錯誤。

const versionEl = document.getElementById('version');
const statusEl = document.getElementById('status');
const toggleBtn = document.getElementById('toggle-btn');
const openOptionsLink = document.getElementById('open-options');
const shortcutEl = document.getElementById('shortcut-hint');

versionEl.textContent = chrome.runtime.getManifest().version;

// 顯示目前 command 的實際快捷鍵；若 Chrome 因衝突未指派則顯示「未設定」並
// 引導至 chrome://extensions/shortcuts
chrome.commands.getAll((commands) => {
  if (!shortcutEl) return;
  const cmd = (commands || []).find(c => c.name === 'toggle-reader-mode');
  const shortcut = cmd && cmd.shortcut;
  if (shortcut) {
    shortcutEl.textContent = `快捷鍵：${shortcut}`;
  } else {
    shortcutEl.innerHTML = '快捷鍵未設定，請到 <code>chrome://extensions/shortcuts</code> 指派';
  }
});

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
    // 成功：結果由頁面 toast 顯示，關閉 popup
    window.close();
  } else {
    // 失敗：通常是 chrome:// / 應用商店 / PDF 檢視器這類禁止注入頁面，
    // 頁面 toast 也進不去，只能在 popup 內顯示
    statusEl.textContent = '此頁面無法啟動閱讀模式';
    statusEl.hidden = false;
  }
});

openOptionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
