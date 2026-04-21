// JRead — Background Service Worker（Manifest V3）
// 注意：service worker 隨時可能被終止，不可用全域變數保存狀態，
// 所有需要跨請求保留的資料一律走 chrome.storage。

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
