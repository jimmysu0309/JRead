// JRead — Background Service Worker（Manifest V3）
// 注意：service worker 隨時可能被終止，不可用全域變數保存狀態，
// 所有需要跨請求保留的資料一律走 chrome.storage。

// 共用 popup 端已測試過的注入 fallback 核心函式 + DEFAULT_SETTINGS 單一資料源。
// 注意：importScripts 的相對路徑是相對 service worker 自己的所在目錄
// （background/），而非 extension root。必須用絕對路徑（前置斜線）。
//
// Safari / Firefox 走 background.scripts（event page 模式），popup-core.js 與
// settings-defaults.js 由 manifest scripts 陣列預先 load（patch-safari-manifest.sh
// / firefox-build.sh 同列同序），importScripts 在該 context 不存在——typeof
// guard 跳過即可（v0.7.229 教訓：scripts 陣列漏列 = Safari 直接 TypeError）。
if (typeof importScripts === 'function') {
  importScripts('/popup/popup-core.js');
  importScripts('/content/settings-defaults.js');
}

// v0.7.235：DEFAULT_SETTINGS 搬到 content/settings-defaults.js 單一資料源
// （content getSettings 直讀 storage 也要同一份 defaults，iOS background
// 掉包修法），SW 端由 importScripts / event page scripts 預載後取用。
const DEFAULT_SETTINGS = globalThis.__JReadSettingsDefaults;

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

// v0.8.16：font stack 常數從 settings-defaults.js 單一資料源取用（原本 SW
// 與 popup.js 各寫一份完整字面值、靠 spec 人工校對防 drift）。fontFamily 以
// 「整串 stack 字面值」存進 storage，改 FONT_STACKS 常數不會自動更新既有使用者
// 的舊存值——onInstalled 比對舊值（LEGACY_*）精準替換成新值（SERIF/SANS_STACK）。
// settings-defaults.js 由 importScripts（line 15）/ event page scripts 預載，
// 取用點在這些常數初始化前已執行。
// v0.8.25：LEGACY serif 為陣列（歷代舊值各一筆），命中任一即遷移到新值。
const LEGACY_SERIF_STACKS = globalThis.__JReadLegacyFontStacks.serif;
const SERIF_STACK = globalThis.__JReadFontStacks.serif;
const LEGACY_SANS_STACK = globalThis.__JReadLegacyFontStacks.sans;
const SANS_STACK = globalThis.__JReadFontStacks.sans;

// 首次安裝時寫入預設值，已存在的欄位不覆蓋
chrome.runtime.onInstalled.addListener(async () => {
  // v0.8.15：改為「只寫 diff」而非整包 get(null)+set(merged) 全量回寫。
  // 全量回寫的問題：(1) 每次版本 bump 都把所有欄位（含可能很長的
  // autoEnableDomains / customShortcuts）重寫一次，徒增 storage.sync 配額壓力
  //（QUOTA_BYTES_PER_ITEM 8KB / 整體 ~100KB）；(2) 整段 async 無 try/catch，
  // 任一 await reject（配額 / 暫時錯誤）變成 unhandled rejection。
  // 現在只把「真的需要補 / 遷移」的 key 收進 patch，其餘不動。
  try {
    const current = await chrome.storage.sync.get(null);
    const patch = {};
    // 補上 current 缺漏的預設 key（已存在的欄位不覆蓋）
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!(key in current)) patch[key] = DEFAULT_SETTINGS[key];
    }
    // 舊 stack 字面值精準遷移（popup 常數改了不會自動跟動既有使用者的存值）
    if (LEGACY_SERIF_STACKS.includes(current.fontFamily)) patch.fontFamily = SERIF_STACK;
    if (current.fontFamily === LEGACY_SANS_STACK) patch.fontFamily = SANS_STACK;
    // v0.7.254：舊 boldText（布林、macOS-only smoothing）→ fontWeight（三段
    // 300/400/600）一次性遷移。只在使用者「尚未有 fontWeight 值」時換算（current
    // 沒這 key），避免覆寫使用者後來設的字重。boldText:true（粗）→ 600；
    // false / 未設 → 預設 400（由上面「補缺漏 key」迴圈帶入 DEFAULT_SETTINGS.fontWeight）。
    if (current.fontWeight === undefined && current.boldText === true) {
      patch.fontWeight = 600;
    }
    if (Object.keys(patch).length > 0) {
      await chrome.storage.sync.set(patch);
    }
    // 遷移後刪掉 boldText 殘留 key（已退役、不再有任何 path 讀它）
    if ('boldText' in current) {
      await chrome.storage.sync.remove('boldText');
    }
  } catch (e) {
    console.warn('[JRead] onInstalled 設定遷移失敗:', e);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case 'BG_WAKE_PING': {
      // v0.8.33：content/keepalive.js 在 Safari 載入時發的一發喚醒訊息。
      // 訊息的「送達」本身就是目的（把 macOS WPA 內從不自行啟動的 background
      // 拉起來——Shinkansen 的 content 每頁都 sendMessage、其 commands 在 WPA
      // 可用的疑似關鍵）。回 ok 讓 content callback 收到回應、不留 lastError。
      sendResponse({ ok: true });
      return; // sync
    }
    case 'GET_SETTINGS': {
      chrome.storage.sync.get(DEFAULT_SETTINGS).then(sendResponse);
      return true; // async
    }
    case 'UPDATE_SETTINGS': {
      const patch = msg.payload || {};
      chrome.storage.sync.set(patch).then(() => sendResponse({ ok: true }));
      return true;
    }
    case 'CUSTOM_COMMAND': {
      // v0.7.218：content/custom-shortcuts.js 的自訂快速鍵命中後送來。
      // 走與 manifest commands.onCommand 同一條 dispatchCommand（含 YouTube
      // 模式重導），單一資料源。command 白名單擋掉 page 端偽造的任意字串；
      // tabId 取 sender.tab（按鍵發生的 tab，比 active-tab query 更準——
      // 背景 tab 透過巨集鍵盤等送鍵時不會誤殺前景 tab）。
      const command = msg.payload && msg.payload.command;
      const allowed = ['toggle-reader-mode', 'send-to-readwise', 'toggle-youtube-borderless'];
      const tabId = sender && sender.tab && sender.tab.id;
      if (typeof tabId !== 'number' || !allowed.includes(command)) return;
      dispatchCommand(command, tabId);
      return;
    }
    case 'SET_ACTIVE_ICON': {
      // content main.js 在 enter/exit reader mode 時呼叫，切 action icon 彩色/灰階
      // + 同步切換綠色 badge（active）/ 清空 badge（inactive）
      const tabId = sender && sender.tab && sender.tab.id;
      if (typeof tabId !== 'number') return;
      // v0.7.217 iOS Safari guard：iOS 的 action API 子集可能缺 setIcon /
      // badge 系列——缺就整段跳過（badge 純裝飾，無功能損失），避免 TypeError
      // 炸掉 onMessage listener。
      if (!chrome.action || !chrome.action.setIcon || !chrome.action.setBadgeText) return;
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
      // v0.7.217 iOS Safari guard：iOS 無 chrome.management / runtime.reload，
      // 缺 API 直接 reject——debug bridge 只在桌面 unpacked（Claude 自主 debug）
      // 場景有意義，iOS 上不存在這個使用情境。
      if (!(chrome.management && chrome.management.getSelf) || !chrome.runtime.reload) {
        console.warn('[JRead] JREAD_RELOAD rejected: management/reload API unavailable');
        return;
      }
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
      // v0.8.15：整個 async IIFE 包 try/catch。原本只有 buildReadwisePayload
      // 被包住，storage.sync.get / saveToReadwise 若 throw 會讓 IIFE rejection
      // 無人接、sendResponse 永不被呼叫 → popup 端 await 拿到 undefined、卡在
      // 「送出中…」。現在保證任何路徑都會回 sendResponse。
      (async () => {
        try {
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
        } catch (e) {
          sendResponse({ ok: false, error: 'INTERNAL', message: String(e && e.message || e) });
        }
      })();
      return true; // async sendResponse
    }
    default:
      return;
  }
});

// v0.8.32：runtime.onStartup 空 listener——macOS Safari WPA（加入 Dock 的
// web app）的 background 啟動觸發器。
//
// 2026-06-10 程序層實證（ps 監看 appex）：WPA 內「on-demand 啟動 extension
// appex」全面故障——menu「延伸功能動作」點擊、popup 開啟、content script
// runtime.connect / sendMessage 都**不會** spawn appex 程序 → background 永遠
// 沒跑 → commands.onCommand 無人接 → ⌥ 預設鍵與 menu 動作「從來不會動」
// （v0.8.30 keep-alive、v0.8.31 改鍵都救不了：保活保的是從沒活過的程序）。
// Shinkansen 同場景可用的真正差異：它註冊了 runtime.onStartup listener，
// WPA session 啟動 2s 內 appex 就被拉起（ps 實證），之後 keep-alive port
// 保活。listener 的**存在本身**就是啟動觸發器，handler 不需做事。
// Chrome 軌也有 onStartup（瀏覽器啟動時喚 SW 一次）、無副作用。
// iOS guard：API 缺席就跳過（與 commands guard 同款，缺了也只是 WPA 軌沒救）。
if (chrome.runtime.onStartup && chrome.runtime.onStartup.addListener) {
  chrome.runtime.onStartup.addListener(() => {
    // 空 handler：喚起 background 本身就是目的。content/keepalive.js 的
    // port 會在頁面載入後接上、讓 background 維持存活（兩段式：onStartup
    // 拉起 → keep-alive 保活，缺一不可——WPA 不會 on-demand 重啟死掉的 appex）
  });
}

// v0.8.30：Safari keep-alive port（content/keepalive.js 開，Safari 限定）。
// macOS Safari WPA（加入 Dock 的 web app）/ iOS Safari 會把閒置 background
// 永久回收且 onCommand 喚不醒（Apple Forums 758346）→ manifest 預設鍵
// ⌥3 / ⌥4 與 Safari menu「延伸功能動作」全滅。content 端每 20s ping 讓
// background 維持非閒置；「持續有 port 連著 + 收訊息」這個事實本身就是
// keep-alive，handler 只回 pong 供 content / 自動化偵測背景存活。
// 無條件註冊（不以平台 gate）：Chrome 軌 content 端 gate 在
// safari-web-extension:// scheme、永不開這條 port → 此 listener 在 Chrome
// 不觸發，零行為差異；無條件註冊讓 Chromium harness 能驗 port 接線。
chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== 'jread-keepalive') return;
  port.onMessage.addListener(() => {
    try { port.postMessage({ pong: true }); } catch (_) {}
  });
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
//
// v0.7.218：dispatch 主體抽成 dispatchCommand(command, tabId)——manifest 預設
// 鍵（commands.onCommand，browser 層）與自訂快速鍵（content script keydown →
// CUSTOM_COMMAND 訊息）共用同一條 dispatch，YouTube 模式重導等邏輯單一資料源。
async function dispatchCommand(command, tabId) {
  // v0.7.228：cross-mode 重導（v0.7.134「任一模式快速鍵都當退出當前 active 模式」）
  // 整段搬進 content 端 main.js dispatchLocalCommand——重導需要的 cinema /
  // borderless 狀態本來就在 content 端（舊版 SW 還得先 round-trip 查詢 reader
  // state 來問）。動機：iOS Safari SW 被系統回收後不再喚醒（Apple Forums thread
  // 758346），3 指手勢 / 自訂快速鍵改走 content 本地 dispatch 才能在 SW 死亡後
  // 存活；SW 這裡只剩 manifest 預設鍵（browser 層事件）的委派 + content script
  // 未注入頁面的 injection fallback。重導決策單一資料源在 main.js，這裡不可
  // 重新長出狀態查詢 / 重導分支（youtube-borderless.spec 有 forcing function 釘著）。
  if (command === 'toggle-reader-mode' || command === 'toggle-youtube-borderless') {
    const { sendWithInjectionFallback } = self.__JReadPopup;
    await sendWithInjectionFallback(tabId, {
      type: 'DISPATCH_COMMAND',
      payload: { command }
    }, {
      sendMessage: (id, m) => chrome.tabs.sendMessage(id, m),
      executeScript: (opts) => chrome.scripting.executeScript(opts)
    });
    return;
  }

  if (command === 'send-to-readwise') {
    await sendToReadwiseFromCommand(tabId);
    return;
  }
}

// manifest 預設鍵（browser 層）→ dispatchCommand。
// v0.7.218 iOS Safari guard：iOS 的 commands API 殘缺（v0.7.217 已知 getAll
// 缺席）——top-level 直呼 onCommand.addListener 若 API 整個缺席會 TypeError
// 炸掉 SW 註冊階段，連 onMessage listener 都掛。guard 後 iOS 上預設鍵不可用
// 也沒關係：自訂快速鍵（content keydown → CUSTOM_COMMAND）是 iOS 的主通道。
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id !== 'number') return;
    await dispatchCommand(command, tab.id);
  });
}

// v0.7.89：快速鍵送 Readwise 流程（v0.8.31 起預設鍵 Alt+Shift+R）。
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
