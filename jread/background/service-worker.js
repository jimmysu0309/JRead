// JRead — Background Service Worker（Manifest V3）
// 注意：service worker 隨時可能被終止，不可用全域變數保存狀態，
// 所有需要跨請求保留的資料一律走 chrome.storage。

// 共用 popup 端已測試過的注入 fallback 核心函式。
// 路徑相對 extension root。
importScripts('popup/popup-core.js');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  autoEnableDomains: []
};

// 首次安裝時寫入預設值，已存在的欄位不覆蓋
chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(null);
  const merged = { ...DEFAULT_SETTINGS, ...current };
  await chrome.storage.sync.set(merged);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case 'GET_SETTINGS': {
      chrome.storage.sync.get(DEFAULT_SETTINGS).then(sendResponse);
      return true; // async
    }
    case 'UPDATE_SETTINGS': {
      const patch = msg.payload || {};
      chrome.storage.sync.set(patch).then(() => sendResponse({ ok: true }));
      return true;
    }
    default:
      return;
  }
});

// 快捷鍵：manifest 的 commands 觸發後走與 popup 相同的 toggle + inject fallback。
// 失敗時（chrome:// / 禁止注入頁面）回傳 ok=false，但 service worker 無 UI 可以
// 提示；使用者會發現頁面沒反應，這是 MV3 的侷限。
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-reader-mode') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || typeof tab.id !== 'number') return;

  const { toggleWithInjectionFallback } = self.__JReadPopup;
  await toggleWithInjectionFallback(tab.id, {
    sendMessage: (id, m) => chrome.tabs.sendMessage(id, m),
    executeScript: (opts) => chrome.scripting.executeScript(opts)
  });
});
