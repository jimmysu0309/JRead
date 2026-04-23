// JRead — Background Service Worker（Manifest V3）
// 注意：service worker 隨時可能被終止，不可用全域變數保存狀態，
// 所有需要跨請求保留的資料一律走 chrome.storage。

// 共用 popup 端已測試過的注入 fallback 核心函式。
// 注意：importScripts 的相對路徑是相對 service worker 自己的所在目錄
// （background/），而非 extension root。必須用絕對路徑（前置斜線）。
importScripts('/popup/popup-core.js');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  autoEnableDomains: []
};

// Icon 路徑 map：閱讀模式 active = 彩色、待機 = 灰階。manifest `default_icon`
// 指向灰階版，content main.js 在 enter/exit reader mode 時發 SET_ACTIVE_ICON
// 訊息、SW 針對 sender tab 呼叫 chrome.action.setIcon 切換。
//
// 路徑**必須以 `/` 開頭**——SW 的 relative path 是相對 SW 所在目錄
// （`/background/`），不是 extension root。寫 `'assets/...'` 會被解析成
// `/background/assets/...` 不存在，reload extension 時 tabs.onUpdated
// handler 對每個既有 tab 呼叫 setIcon 全部 fail，Chrome 通知中心堆
// `Failed to set icon 'assets/icons/...' : Failed to fetch` 錯誤。
// 與 v0.4.1 importScripts 相對路徑 bug 同類型（SW 相對路徑陷阱）。
const ICONS_ACTIVE = {
  16:  '/assets/icons/icon-16.png',
  32:  '/assets/icons/icon-32.png',
  48:  '/assets/icons/icon-48.png',
  128: '/assets/icons/icon-128.png'
};
const ICONS_IDLE = {
  16:  '/assets/icons/icon-16-disabled.png',
  32:  '/assets/icons/icon-32-disabled.png',
  48:  '/assets/icons/icon-48-disabled.png',
  128: '/assets/icons/icon-128-disabled.png'
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
    case 'SET_ACTIVE_ICON': {
      // content main.js 在 enter/exit reader mode 時呼叫，切 action icon 彩色/灰階
      const tabId = sender && sender.tab && sender.tab.id;
      if (typeof tabId !== 'number') return;
      const active = !!(msg.payload && msg.payload.active);
      chrome.action.setIcon({ tabId, path: active ? ICONS_ACTIVE : ICONS_IDLE });
      return;
    }
    default:
      return;
  }
});

// 導航到新 URL 時重置 icon 回灰階——content script 會在新頁重新載入、預設
// state 也是 inactive，但 setIcon 的 per-tab 設定會跨 navigation 殘留，
// 需主動清空。監聽 tab.onUpdated 的 status === 'loading' 是新頁載入最早
// 的訊號點。
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    chrome.action.setIcon({ tabId, path: ICONS_IDLE });
  }
});

// 快速鍵：manifest 的 commands 觸發後走與 popup 相同的 toggle + inject fallback。
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
