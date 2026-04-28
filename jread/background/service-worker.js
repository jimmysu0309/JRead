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
  autoEnableDomains: [],
  // Readwise Reader integration（v0.7.33）。空字串 = 未設定，popup 會擋下送出。
  readwiseToken: ''
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
    case 'SAVE_TO_READWISE': {
      // popup → SW：把 reader card 內容 POST 到 Readwise Reader API。
      // payload 由 content script 的 EXTRACT_READER_HTML 產生（{ url, html, title }）。
      // 在 SW fetch 而非 popup fetch 的理由：popup 關閉後 fetch 會中斷；SW 即便 popup 關了
      // 也能跑完並透過 sendResponse 回給 popup（若 popup 已關則 silently drop，但 fetch
      // 已成功觸發）。
      (async () => {
        const { readwiseToken } = await chrome.storage.sync.get({ readwiseToken: '' });
        const { buildReadwisePayload, saveToReadwise } = self.__JReadPopup;
        let body;
        try {
          body = buildReadwisePayload(msg.payload || {});
        } catch (e) {
          sendResponse({ ok: false, error: 'INVALID_PAYLOAD', message: String(e && e.message || e) });
          return;
        }
        const result = await saveToReadwise({ token: readwiseToken, payload: body });
        sendResponse(result);
      })();
      return true; // async sendResponse
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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || typeof tab.id !== 'number') return;

  if (command === 'toggle-reader-mode') {
    const { toggleWithInjectionFallback } = self.__JReadPopup;
    await toggleWithInjectionFallback(tab.id, {
      sendMessage: (id, m) => chrome.tabs.sendMessage(id, m),
      executeScript: (opts) => chrome.scripting.executeScript(opts)
    });
    return;
  }

  if (command === 'send-to-readwise') {
    await sendToReadwiseFromCommand(tab.id);
    return;
  }
});

// v0.7.89：快速鍵 Alt+Shift+R 觸發送 Readwise 流程。
// 流程：
//   1. 先確認 reader mode 啟動；未啟動則先 toggle 開（含 inject fallback），
//      等 cleaner / styler 跑完
//   2. 抽 reader card payload（EXTRACT_READER_HTML）
//   3. 走與 popup SAVE_TO_READWISE 同樣的 buildReadwisePayload + saveToReadwise
//   4. 結果透過 SHOW_TOAST 訊息回傳 content script，由 toast 顯示
// SW 沒 UI、結果只能靠 toast 反饋；toast 失敗（chrome:// 等禁止注入頁）silent
// fail——使用者按快速鍵沒反應就是限制。
async function sendToReadwiseFromCommand(tabId) {
  const sendMessage = (id, m) => chrome.tabs.sendMessage(id, m);
  const showToast = (message, kind) => {
    sendMessage(tabId, { type: 'SHOW_TOAST', payload: { message, kind } }).catch(() => {});
  };

  // 1. 確認 reader mode 啟動；未啟動則先 toggle
  let state;
  try {
    state = await sendMessage(tabId, { type: 'GET_READER_STATE' });
  } catch {
    // content script 未注入（chrome:// / Web Store 等）→ 嘗試 inject + toggle
    state = null;
  }

  if (!state || !state.active) {
    const { toggleWithInjectionFallback } = self.__JReadPopup;
    const toggleResult = await toggleWithInjectionFallback(tabId, {
      sendMessage,
      executeScript: (opts) => chrome.scripting.executeScript(opts)
    });
    if (!toggleResult || !toggleResult.ok) {
      // 連注入 + toggle 都失敗，無法顯示 toast（content script 沒跑起來）
      return;
    }
    // 等 detector / cleaner / styler 跑完（content main.js enterReaderMode 是
    // async）。800ms 對多數站夠；harness 實測 cleaner 跑 100-300ms + styler
    // 立即注入 + 安全 buffer。
    await new Promise(r => setTimeout(r, 800));
  }

  // 2. 抽 reader card payload
  let extracted;
  try {
    extracted = await sendMessage(tabId, { type: 'EXTRACT_READER_HTML' });
  } catch {
    showToast('無法取得頁面內容', 'error');
    return;
  }
  if (!extracted || !extracted.ok) {
    showToast('閱讀模式未啟動', 'error');
    return;
  }

  // 3. 送 Readwise（重用 popup-core 既有 buildReadwisePayload + saveToReadwise）
  const { readwiseToken } = await chrome.storage.sync.get({ readwiseToken: '' });
  const { buildReadwisePayload, saveToReadwise } = self.__JReadPopup;
  let body;
  try {
    body = buildReadwisePayload(extracted.payload || {});
  } catch (e) {
    showToast('送出失敗：payload 無效', 'error');
    return;
  }
  const result = await saveToReadwise({ token: readwiseToken, payload: body });

  // 4. 結果 toast
  if (result && result.ok) {
    const msg = result.status === 200 ? '已存在於 Readwise Reader' : '已送到 Readwise Reader';
    showToast(msg, 'success');
  } else if (result && result.error === 'NO_TOKEN') {
    showToast('尚未設定 Readwise token，請到設定頁填入', 'error');
  } else if (result && result.error === 'AUTH') {
    showToast('Readwise token 無效或已過期', 'error');
  } else if (result && result.error === 'NETWORK') {
    showToast('網路錯誤，請稍後再試', 'error');
  } else {
    const detail = result && result.status ? `（HTTP ${result.status}）` : '';
    showToast(`送出失敗${detail}`, 'error');
  }
}
