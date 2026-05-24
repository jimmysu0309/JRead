// JRead — Background Service Worker（Manifest V3）
// 注意：service worker 隨時可能被終止，不可用全域變數保存狀態，
// 所有需要跨請求保留的資料一律走 chrome.storage。

// 共用 popup 端已測試過的注入 fallback 核心函式。
// 注意：importScripts 的相對路徑是相對 service worker 自己的所在目錄
// （background/），而非 extension root。必須用絕對路徑（前置斜線）。
//
// Firefox 走 background.scripts（event page 模式），popup-core.js 由 manifest
// scripts 陣列預先 load，importScripts 在該 context 不存在——typeof guard 跳過即可。
if (typeof importScripts === 'function') {
  importScripts('/popup/popup-core.js');
}

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  // 字粗外觀。false = 細（-webkit-font-smoothing: antialiased，macOS grayscale
  // anti-aliasing，視覺較細）= 預設;true = 粗（auto = subpixel-antialiased，
  // macOS 預設 = 視覺較粗）。用 smoothing 切換而非 font-weight—— CJK 字型
  // 在 macOS 上不同 weight (400/500/600/700) 視覺差異不穩定（不同 font face
  // 涵蓋範圍不一），smoothing 模式差異明顯且跨字型穩定。Linux / Windows 上
  // -webkit-font-smoothing 無效，此 setting 在那些 OS 上無視覺差異。
  boldText: false,
  lineHeight: 1.7,
  // v0.7.162：段落間距（p / ul / ol / blockquote margin-bottom，em）。預設 1.0
  // 對應 v0.7.102 baseline 行為；popup 可調 0~3.0、-1 = Auto sentinel（不注入規則）。
  paragraphSpacing: 1.0,
  autoEnableDomains: [],
  // Readwise Reader integration（v0.7.33）。空字串 = 未設定，popup 會擋下送出。
  readwiseToken: '',
  // v0.7.131：閱讀模式啟動時攔截原站快速鍵（Gmail j/k/e、YouTube k 等）。
  // 預設 true——使用者進閱讀模式就是想專心讀、不希望按錯鍵觸發 Gmail
  // archive / send 等破壞性操作。要關可到 options 取消。
  blockPageShortcuts: true,
  // 中英文字之間自動補空白（盤古之白）。reader mode 啟動時掃 articleEl 所有
  // text node、套規則「CJK ↔ 英數字 / % / °」→ 之間插空白。詳見 styler.js
  // pangu module。預設 true，使用者可到 options 取消。
  pangu: true,
  titleFontSize: 0
};

// Icon 路徑 map：閱讀模式 active / idle 都用彩色版本（v0.7.134，Jimmy 2026-05-18
// 要求 toolbar 預設藍色——不再用 -disabled 灰階版本）。active / idle 之間的視覺
// 區隔改全部交給 badge ✓（active 時露出綠色對勾、idle 時 badge 空）。
//
// `setIcon` 切換邏輯仍保留（兩個 map 雖然 path 相同、setIcon 跑了無視覺差異），
// 是為了：(1) 結構保留，未來若要再加 active/idle 視覺區隔（例如 idle 變淺藍）
// 只需改 ICONS_IDLE path；(2) 跟 v0.7.129 tabs.onUpdated `setIcon 回 IDLE` 兜底
// 邏輯相容。
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
  16:  '/assets/icons/icon-16.png',
  32:  '/assets/icons/icon-32.png',
  48:  '/assets/icons/icon-48.png',
  128: '/assets/icons/icon-128.png'
};

// v0.7.125：reader mode 啟動時在 toolbar icon 右下角顯示綠色 badge 作為視覺
// 輔助訊號。配色 #10b981（tailwind emerald-500，低飽和綠、無壓迫）+ 彩色
// icon 切換構成雙通道指示。
// v0.7.127：BADGE_ACTIVE_TEXT 從 '●' (U+25CF) → ' '（單空格）—— ● 字面 chrome
// macOS 渲染巨大、整個 badge 區被綠色背景填滿、視覺上蓋住 J icon、看起來像
// 獨立綠圓 icon 而非小角標。改空格後 badge 變純色塊。
// v0.7.128：' ' → '✓' (U+2713 CHECK MARK) —— Jimmy 反映純色塊「不太好看」，
// 加對勾既保留純色塊的合理寬度（✓ 是窄字元、不會撐 badge background）又
// 帶語意「閱讀模式已啟用」。
const BADGE_ACTIVE_COLOR = '#10b981';
const BADGE_ACTIVE_TEXT  = '✓';

// v0.7.129：吞掉 chrome.action.* / chrome.tabs.sendMessage 在 tab 已關閉時的
// promise rejection。MV3 API 是 async：事件入隊→實際執行之間若 tab 被使用者
// 關掉，會 reject `No tab with id: <id>`，預設變成 uncaught (in promise) 堆進
// chrome 通知中心。對 SW handler 而言這是 benign race（tab 都沒了，setIcon /
// setBadgeText 也無意義），統一吞 silently。
const swallowTabGone = (p) => {
  if (p && typeof p.catch === 'function') p.catch(() => {});
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
      // + 同步切換綠色 badge（active）/ 清空 badge（inactive）
      const tabId = sender && sender.tab && sender.tab.id;
      if (typeof tabId !== 'number') return;
      const active = !!(msg.payload && msg.payload.active);
      swallowTabGone(chrome.action.setIcon({ tabId, path: active ? ICONS_ACTIVE : ICONS_IDLE }));
      if (active) {
        swallowTabGone(chrome.action.setBadgeBackgroundColor({ color: BADGE_ACTIVE_COLOR, tabId }));
        // 某些舊版 Chrome 沒 setBadgeTextColor、ignore 即可
        if (chrome.action.setBadgeTextColor) {
          swallowTabGone(chrome.action.setBadgeTextColor({ color: '#ffffff', tabId }));
        }
        swallowTabGone(chrome.action.setBadgeText({ text: BADGE_ACTIVE_TEXT, tabId }));
      } else {
        swallowTabGone(chrome.action.setBadgeText({ text: '', tabId }));
      }
      return;
    }
    case 'JREAD_RELOAD': {
      // v0.7.126：content script bridge (`__jread_debug` type='reload')
      // 中繼觸發。chrome.runtime.reload() 只能從 SW / popup / options 呼叫，
      // content script 直接呼會 TypeError。SW handler 收到後重啟 extension。
      // 設計給 Claude 自主 debug 用——dispatch event → bridge → sendMessage
      // → SW reload，整條 chain 無 popup / 鍵盤 shortcut 介入。
      //
      // v0.7.143 安全 hardening：page main world JS（含廣告 script、惡意網站）
      // 可任意 dispatch `__jread_debug` event 觸發 reload。雖然 reload 不洩漏
      // 資料、不權限提升，但會打斷使用者所有 tab 的 reader mode。Store 安裝的
      // 使用者不該被網頁端任意打擾——只允許 unpacked / development 安裝（Claude
      // 自主 debug 場景）執行 reload。chrome.management.getSelf() 不需要
      // "management" permission（自己 query 自己）。
      chrome.management.getSelf((info) => {
        if (info && info.installType === 'development') {
          chrome.runtime.reload();
        } else {
          // store / normal install：silently reject（不送 toast、不通知，避免
          // 攻擊者透過 console error 探測 extension 是否裝）
          console.warn('[JRead] JREAD_RELOAD rejected: installType=', info && info.installType);
        }
      });
      return;
    }
    case 'RESIZE_OWN_WINDOW': {
      // v0.7.134：YouTube 無邊模式 — content side 算完目標視窗高度後請 SW
      // 呼 chrome.windows.update。失敗（PWA 限制 / windowId 不在 / 權限缺）
      // 沉默吞掉——CSS 已套上、影片以 object-fit:contain 顯示（會有黑邊但
      // 仍可看），不需要 escalate 給使用者。
      //
      // v0.7.143 安全 hardening：
      // (a) sender.tab.url 必須是 youtube.com/watch（防其他站點 content
      //     script 或 debug bridge 任意 resize 視窗）
      // (b) height 必須在合理範圍 [200, 4096]（content 端 calcTargetWindowHeight
      //     已 clamp，這裡是第二道防線）
      const wid = sender && sender.tab && sender.tab.windowId;
      const height = msg.payload && msg.payload.height;
      const senderUrl = sender && sender.tab && sender.tab.url;
      if (typeof wid !== 'number' || typeof height !== 'number') {
        sendResponse({ ok: false, reason: 'INVALID_ARGS' });
        return; // sync
      }
      if (!senderUrl || !/^https:\/\/(www\.|m\.)?youtube\.com\/watch/.test(senderUrl)) {
        sendResponse({ ok: false, reason: 'INVALID_ORIGIN' });
        return; // sync
      }
      if (height < 200 || height > 4096) {
        sendResponse({ ok: false, reason: 'INVALID_HEIGHT' });
        return; // sync
      }
      try {
        const p = chrome.windows.update(wid, { height });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_) {}
      sendResponse({ ok: true });
      return; // sync
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
    swallowTabGone(chrome.action.setIcon({ tabId, path: ICONS_IDLE }));
    // 同步清掉 reader-active badge（避免新頁面殘留前一頁的綠燈）
    swallowTabGone(chrome.action.setBadgeText({ tabId, text: '' }));
  }
});

// 快速鍵：manifest 的 commands 觸發後走與 popup 相同的 toggle + inject fallback。
// 失敗時（chrome:// / 禁止注入頁面）回傳 ok=false，但 service worker 無 UI 可以
// 提示；使用者會發現頁面沒反應，這是 MV3 的侷限。
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || typeof tab.id !== 'number') return;

  // v0.7.134：YouTube 影院 / 無邊模式 active 時，**任一**模式快速鍵都當作退出當前
  // active 模式（= 按 ESC 的效果）。動機：使用者忘記目前在哪個模式時、不用記哪
  // 個快速鍵對應哪個退出方向。實作上 SW 先 GET_READER_STATE 拿當前狀態、依此
  // 重導 command。
  //   - toggle-reader-mode 觸發但 borderlessActive=true → 改送 TOGGLE_YT_BORDERLESS
  //     退出無邊模式
  //   - toggle-youtube-borderless 觸發但 cinemaActive=true → 改走 toggleWithInjectionFallback
  //     送 TOGGLE_READER_MODE 退出影院模式
  // 兩者同時 active 時（CSS 會打架但邏輯獨立可同開）以 borderless 優先退出
  // （borderless 動了 OS 視窗、先退出回正常 chrome 視窗較安全）。
  // 非 YouTube watch 頁或無模式 active 時走原邏輯。
  if (command === 'toggle-reader-mode' || command === 'toggle-youtube-borderless') {
    let state = null;
    try {
      state = await chrome.tabs.sendMessage(tab.id, { type: 'GET_READER_STATE' });
    } catch (_) { /* content script 沒注入：state=null、走 default */ }
    const cinemaActive = !!(state && state.cinemaActive);
    const borderlessActive = !!(state && state.borderlessActive);

    if (command === 'toggle-reader-mode' && borderlessActive) {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_YT_BORDERLESS' }).catch(() => {});
      return;
    }
    if (command === 'toggle-youtube-borderless' && cinemaActive) {
      const { toggleWithInjectionFallback } = self.__JReadPopup;
      await toggleWithInjectionFallback(tab.id, {
        sendMessage: (id, m) => chrome.tabs.sendMessage(id, m),
        executeScript: (opts) => chrome.scripting.executeScript(opts)
      });
      return;
    }
  }

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

  if (command === 'toggle-youtube-borderless') {
    // v0.7.134：YouTube 無邊模式快速鍵（manifest 沒給 suggested_key，使用者
    // 自己到 chrome://extensions/shortcuts 綁）。content script 沒注入的頁面
    // sendMessage 會 reject — 靜默吞掉（chrome:// / Web Store 等本來就不該
    // 在這些頁面切影片）。
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_YT_BORDERLESS' }).catch(() => {});
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
