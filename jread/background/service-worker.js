// JRead — Background Service Worker（Manifest V3）
// 注意：service worker 隨時可能被終止，不可用全域變數保存狀態，
// 所有需要跨請求保留的資料一律走 browser.storage。

// 共用 popup 端已測試過的注入 fallback 核心函式 + DEFAULT_SETTINGS 單一資料源。
// 注意：importScripts 的相對路徑是相對 service worker 自己的所在目錄
// （background/），而非 extension root。必須用絕對路徑（前置斜線）。
//
// Safari / Firefox 走 background.scripts（event page 模式），popup-core.js 與
// settings-defaults.js 由 manifest scripts 陣列預先 load（patch-safari-manifest.sh
// / firefox-build.sh 同列同序），importScripts 在該 context 不存在——typeof
// guard 跳過即可（v0.7.229 教訓：scripts 陣列漏列 = Safari 直接 TypeError）。
if (typeof importScripts === 'function') {
  // v1.6.0：Instapaper client + gitignored 金鑰。keys 那行用 try/catch 容忍缺檔
  //（fresh clone / CI / store build 未注入 → __JReadInstapaper 仍載入、
  // getInstapaperConsumerKeys 回 null、Instapaper 功能停用，Readwise 照常）。
  // 須在 popup-core 之前（dispatcher resolveInstapaper 讀 self.__JReadInstapaper）。
  try { importScripts('/lib/instapaper-keys.js'); } catch (_) { /* 無金鑰檔 */ }
  importScripts('/lib/instapaper.js');
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
// v0.8.167：iOS / iPadOS Safari 的「管理延伸功能」選單把 action badge 文字直接
// 當字形渲染，'✓'(U+2713) 在該情境無對應字形 → 顯示 tofu「◆?」（Jimmy 2026-06-23
// iPhone 截圖，閱讀模式啟動後 extension 選單出現怪符號）。badge 純裝飾、無功能
// 損失，故平台分流：iOS / iPadOS Safari 用空字串（無字形＝無 tofu＝等同無 badge），
// Chrome / macOS Safari 維持 '✓'（桌面正常渲染）。UA 結構訊號（iPhone/iPad/iPod），
// 非站點特判；event page / SW context 皆有 navigator.userAgent。
const IS_IOS_SAFARI = (() => {
  try {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    return /iPhone|iPad|iPod/.test(ua);
  } catch (e) { return false; }
})();
const BADGE_ACTIVE_COLOR = '#10b981';
const BADGE_ACTIVE_TEXT  = IS_IOS_SAFARI ? '' : '✓';

// v0.7.129：吞掉 browser.action.* / browser.tabs.sendMessage 在 tab 已關閉時的
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
browser.runtime.onInstalled.addListener(async () => {
  // v0.8.15：改為「只寫 diff」而非整包 get(null)+set(merged) 全量回寫。
  // 全量回寫的問題：(1) 每次版本 bump 都把所有欄位（含可能很長的
  // autoEnableDomains / customShortcuts）重寫一次，徒增 storage.sync 配額壓力
  //（QUOTA_BYTES_PER_ITEM 8KB / 整體 ~100KB）；(2) 整段 async 無 try/catch，
  // 任一 await reject（配額 / 暫時錯誤）變成 unhandled rejection。
  // 現在只把「真的需要補 / 遷移」的 key 收進 patch，其餘不動。
  try {
    const current = await browser.storage.sync.get(null);
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
      await browser.storage.sync.set(patch);
    }
    // 遷移後刪掉 boldText 殘留 key（已退役、不再有任何 path 讀它）
    if ('boldText' in current) {
      await browser.storage.sync.remove('boldText');
    }
  } catch (e) {
    console.warn('[JRead] onInstalled 設定遷移失敗:', e);
  }
});

// v0.8.36：debug bridge 訊息的共用 gate——只在 unpacked / development 安裝
// 執行（Claude 自主 debug / cage 場景）。browser.management.getSelf() 不需要
// "management" permission（自己 query 自己）。store / 正式安裝 silently
// reject（console.warn 留訊號、不彈 toast，避免網頁端探測 extension 存在）。
function runIfDevelopmentInstall(label, fn) {
  // v0.8.164：browser.management.getSelf 原生 Promise（reject 視為非 development、拒絕）。
  browser.management.getSelf().then((info) => {
    if (info && info.installType === 'development') {
      fn();
    } else {
      console.warn('[JRead]', label, 'rejected: installType=', info && info.installType);
    }
  }).catch(() => {
    console.warn('[JRead]', label, 'rejected: management.getSelf failed');
  });
}

// v1.7.44（X2）：功能浮層 clickjacking 防線。popup.html 對 <all_urls>
// web-accessible，任意網站可 iframe 嵌入 ?panel=1 蓋在誘餌 UI 上騙點擊。
// floating-icon 開 iframe 浮層前以 PANEL_OPENED 登記（sender.tab 由瀏覽器填、
// 頁面 JS 無法偽造）；popup(?panel=1) 載入時以 PANEL_HANDSHAKE 驗證同 tab
// 30s 內有登記、驗過即銷毀（單次有效）。未登記的嵌入握手失敗 → popup 互動
// no-op。狀態放 storage.session（SW 重啟不掉、不落磁碟）；不可用時退記憶體
// map（SW 存活期內有效；重啟後最壞情況 = 合法浮層驗證失敗、重開浮層即恢復）。
// 已知邊界：同 tab 內合法浮層開啟的 30s 窗口內，頁面若同時自行嵌入第二個
// popup iframe 可搭便車通過——該情境需先誘發合法開啟流程，防線層級足夠。
const PANEL_TOKEN_TTL_MS = 30 * 1000;
const panelOpenMem = new Map();
async function recordPanelOpen(tabId) {
  const key = 'panelOpen:' + tabId;
  const ts = Date.now();
  try {
    if (browser.storage && browser.storage.session) {
      await browser.storage.session.set({ [key]: ts });
      return;
    }
  } catch (_e) { /* storage.session 不可用 → 退記憶體 */ }
  panelOpenMem.set(tabId, ts);
}
async function consumePanelOpen(tabId) {
  const key = 'panelOpen:' + tabId;
  let ts = null;
  try {
    if (browser.storage && browser.storage.session) {
      const v = await browser.storage.session.get(key);
      if (v && typeof v[key] === 'number') ts = v[key];
      await browser.storage.session.remove(key);
    }
  } catch (_e) { /* 讀取失敗 → 試記憶體 fallback */ }
  if (ts == null && panelOpenMem.has(tabId)) {
    ts = panelOpenMem.get(tabId);
    panelOpenMem.delete(tabId);
  }
  return ts != null && (Date.now() - ts) <= PANEL_TOKEN_TTL_MS;
}

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
      // v0.8.36：get reject（storage 失效等罕見場景）時也要回應——sendResponse
      // 永不呼叫會讓 content fallback 軌的 callback 懸空。回 null 讓 caller
      // 走自己的 defaults fallback。
      // v1.6.26：回應前剔除憑證欄位（readwiseToken / instapaper* / geminiApiKey）
      // ——content 端只需要 UI 偏好、從不使用憑證，最小知情原則（單一資料源
      // settings-defaults.js stripCredentialSettings）。
      // v1.7.42：strip 缺席（importScripts 失敗等）時不可 identity fallback——那會
      // 把含憑證的整包設定送進 content（正是 v1.6.26 要擋的洩漏面）。改回 null，
      // content 端本就有 defaults fallback 軌，失效模式是「退回預設偏好」而非洩憑證。
      const strip = globalThis.__JReadStripCredentialSettings;
      if (typeof strip !== 'function') {
        sendResponse(null);
        return; // sync
      }
      browser.storage.sync.get(DEFAULT_SETTINGS)
        .then((s) => sendResponse(strip(s)))
        .catch(() => sendResponse(null));
      return true; // async
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
      // fire-and-forget：內部錯誤路徑多回錯誤物件而非 throw，但極端故障
      //（__JReadPopup 缺席等）會 reject——補 catch 免得堆 unhandled rejection
      dispatchCommand(command, tabId).catch(() => {});
      return;
    }
    case 'OPEN_FEATURE_MENU': {
      // v0.8.162：懸浮按鈕長按選單的「功能選單」（Safari path）。content script 不能
      // 在 https 網頁裡用 iframe 載入擴充頁（Safari 已知限制，iOS 上會整頁 refresh），
      // 改由 SW 開原生工具列 popup（browser.action.openPopup，Safari 16+ / Chrome 支援）。
      // openPopup 不支援 / 失敗（需手勢等）→ 退而開新分頁載 popup.html。皆無 iframe →
      // 不 refresh。非 Safari（Chrome / FF）走 content 端 iframe 浮層、不送本訊息。
      // iOS Safari 的 action API 可能缺 openPopup → 直接退新分頁（fall through）。
      const action = browser.action || browser.browserAction;
      (async () => {
        if (action && typeof action.openPopup === 'function') {
          try {
            await action.openPopup();
            return;
          } catch (_e) { /* 不支援 / 需手勢 → fall through 開新分頁 */ }
        }
        try { await browser.tabs.create({ url: browser.runtime.getURL('popup/popup.html') }); }
        catch (_e) {}
      })();
      return;
    }
    case 'OPEN_READER': {
      // v1.0.23：懸浮按鈕長按選單「進入 Reader」。content script 無 tabs 權限，
      // 由 SW 開 reader/reader.html（Readwise inbox feed）新分頁。與 popup「進入
      // Reader」按鈕同一個目標頁；reader.html 已列入 web_accessible_resources。
      (async () => {
        try { await browser.tabs.create({ url: browser.runtime.getURL('reader/reader.html') }); }
        catch (_e) {}
      })();
      return;
    }
    case 'PANEL_OPENED': {
      // v1.7.44（X2）：floating-icon 開頁內浮層前的登記（防 clickjacking，見
      // consumePanelOpen 註解）。sender.tab 由瀏覽器填、頁面 JS 無法偽造。
      const panelTabId = sender && sender.tab && sender.tab.id;
      if (typeof panelTabId === 'number') recordPanelOpen(panelTabId);
      return; // fire-and-forget
    }
    case 'PANEL_HANDSHAKE': {
      // v1.7.44（X2）：popup(?panel=1) 載入時驗證「本 tab 剛由 floating-icon
      // 合法開啟浮層」。iframe 內擴充頁的 sender.tab = 宿主 tab。
      const hsTabId = sender && sender.tab && sender.tab.id;
      if (typeof hsTabId !== 'number') { sendResponse({ ok: false }); return; }
      consumePanelOpen(hsTabId)
        .then((ok) => sendResponse({ ok }))
        .catch(() => sendResponse({ ok: false }));
      return true; // async
    }
    case 'SET_ACTIVE_ICON': {
      // content main.js 在 enter/exit reader mode 時呼叫，切 action icon 彩色/灰階
      // + 同步切換綠色 badge（active）/ 清空 badge（inactive）
      const tabId = sender && sender.tab && sender.tab.id;
      if (typeof tabId !== 'number') return;
      // v0.7.217 iOS Safari guard：iOS 的 action API 子集可能缺 setIcon /
      // badge 系列——缺就整段跳過（badge 純裝飾，無功能損失），避免 TypeError
      // 炸掉 onMessage listener。
      if (!browser.action || !browser.action.setIcon || !browser.action.setBadgeText) return;
      const active = !!(msg.payload && msg.payload.active);
      swallowTabGone(browser.action.setIcon({ tabId, path: active ? ICONS_ACTIVE : ICONS_IDLE }));
      if (active) {
        swallowTabGone(browser.action.setBadgeBackgroundColor({ color: BADGE_ACTIVE_COLOR, tabId }));
        // 某些舊版 Chrome 沒 setBadgeTextColor、ignore 即可
        if (browser.action.setBadgeTextColor) {
          swallowTabGone(browser.action.setBadgeTextColor({ color: '#ffffff', tabId }));
        }
        swallowTabGone(browser.action.setBadgeText({ text: BADGE_ACTIVE_TEXT, tabId }));
      } else {
        swallowTabGone(browser.action.setBadgeText({ text: '', tabId }));
      }
      return;
    }
    case 'JREAD_RELOAD': {
      // v0.7.126：content script bridge (`__jread_debug` type='reload')
      // 中繼觸發。browser.runtime.reload() 只能從 SW / popup / options 呼叫，
      // content script 直接呼會 TypeError。SW handler 收到後重啟 extension。
      // 設計給 Claude 自主 debug 用——dispatch event → bridge → sendMessage
      // → SW reload，整條 chain 無 popup / 鍵盤 shortcut 介入。
      //
      // v0.7.143 安全 hardening：page main world JS（含廣告 script、惡意網站）
      // 可任意 dispatch `__jread_debug` event 觸發 reload。雖然 reload 不洩漏
      // 資料、不權限提升，但會打斷使用者所有 tab 的 reader mode。Store 安裝的
      // 使用者不該被網頁端任意打擾——只允許 unpacked / development 安裝（Claude
      // 自主 debug 場景）執行 reload。browser.management.getSelf() 不需要
      // "management" permission（自己 query 自己）。
      // v0.7.217 iOS Safari guard：iOS 無 browser.management / runtime.reload，
      // 缺 API 直接 reject——debug bridge 只在桌面 unpacked（Claude 自主 debug）
      // 場景有意義，iOS 上不存在這個使用情境。
      if (!(browser.management && browser.management.getSelf) || !browser.runtime.reload) {
        console.warn('[JRead] JREAD_RELOAD rejected: management/reload API unavailable');
        return;
      }
      runIfDevelopmentInstall('JREAD_RELOAD', () => browser.runtime.reload());
      return;
    }
    case 'JREAD_DEBUG_SET_THEME': {
      // v0.8.36 安全 hardening：debug bridge 的 set-theme 原本由 content 直寫
      // browser.storage.sync——任意網頁 JS 可 dispatch `__jread_debug` 改使用者
      // theme（sync 同步到所有裝置）。改經 SW 中繼 + 與 JREAD_RELOAD 同款
      // development install gate：unpacked（Claude 自主 debug / cage Page
      // Rounds）照常可用，store / 正式安裝 silently reject。theme 白名單在
      // SW 端再驗一次（第二道防線，不信 content 端 payload）。
      if (!(browser.management && browser.management.getSelf)) {
        console.warn('[JRead] JREAD_DEBUG_SET_THEME rejected: management API unavailable');
        return;
      }
      const theme = msg.payload && msg.payload.theme;
      if (!['light', 'dark', 'sepia', 'gray'].includes(theme)) return;
      runIfDevelopmentInstall('JREAD_DEBUG_SET_THEME', () => {
        browser.storage.sync.set({ theme }).catch(() => {});
      });
      return;
    }
    case 'JREAD_DEBUG_SEND_READWISE': {
      // v1.7.3：debug bridge 觸發送儲存服務（content bridge type='send-readwise'
      // 中繼）。走與快速鍵完全同一條 sendToReadwiseFromCommand 軌（含未啟動先
      // toggle、EXTRACT_READER_HTML、dispatcher 分派、toast 回饋）。
      // 安全 hardening：任意網頁 JS 可 dispatch `__jread_debug`——若不 gate，
      // 惡意頁可把自己偷送進使用者的 Readwise / Instapaper 帳號。與 JREAD_RELOAD
      // 同款 development install gate：只在 unpacked（Claude 自主 debug / cage）
      // 執行，store / 正式安裝 silently reject。sender.tab 必須存在（來源必須
      // 是 content script，非 popup / options）。
      if (!(browser.management && browser.management.getSelf)) {
        console.warn('[JRead] JREAD_DEBUG_SEND_READWISE rejected: management API unavailable');
        return;
      }
      const senderTabId = sender && sender.tab && sender.tab.id;
      if (typeof senderTabId !== 'number') return;
      runIfDevelopmentInstall('JREAD_DEBUG_SEND_READWISE', () => {
        sendToReadwiseFromCommand(senderTabId).catch(() => {});
      });
      return;
    }
    case 'RESIZE_OWN_WINDOW': {
      // v0.7.134：YouTube 無邊模式 — content side 算完目標視窗高度後請 SW
      // 呼 browser.windows.update。失敗（PWA 限制 / windowId 不在 / 權限缺）
      // 沉默吞掉——CSS 已套上、影片以 object-fit:contain 顯示（會有黑邊但
      // 仍可看），不需要 escalate 給使用者。
      //
      // v0.7.143 安全 hardening：
      // (a) sender.tab.url 必須是 youtube.com 的影片頁 /watch 或 /live/<id>
      //     （防其他站點 content script 或 debug bridge 任意 resize 視窗）。
      //     這是 isYouTubeWatch 三方鏡像之外的第四份同義判定（此處比對 URL
      //     字串、非 URL 物件），content 端放寬路徑時必須一起改，否則無邊模式
      //     在 /live/ 頁 CSS 套得上但視窗高度調整被回 INVALID_ORIGIN。
      // (b) height 必須在合理範圍 [200, 4096]（content 端 calcTargetWindowHeight
      //     已 clamp，這裡是第二道防線）
      const wid = sender && sender.tab && sender.tab.windowId;
      const height = msg.payload && msg.payload.height;
      const senderUrl = sender && sender.tab && sender.tab.url;
      if (typeof wid !== 'number' || typeof height !== 'number') {
        sendResponse({ ok: false, reason: 'INVALID_ARGS' });
        return; // sync
      }
      if (!senderUrl || !/^https:\/\/(www\.|m\.)?youtube\.com\/(watch|live\/)/.test(senderUrl)) {
        sendResponse({ ok: false, reason: 'INVALID_ORIGIN' });
        return; // sync
      }
      if (height < 200 || height > 4096) {
        sendResponse({ ok: false, reason: 'INVALID_HEIGHT' });
        return; // sync
      }
      try {
        const p = browser.windows.update(wid, { height });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_) {}
      sendResponse({ ok: true });
      return; // sync
    }
    default:
      // v0.8.65：原 popup → SW 的 SAVE_TO_READWISE case 已移除——popup「送到
      // Readwise」改在 extension 頁直接 fetch（popup-core.sendDocument dispatcher，v1.6.0 起服務二擇一）。
      // iOS Safari 背景頁被掛起得太積極，popup → SW 非同步往返 + 背景 fetch 會
      // silently 失敗（純「送出失敗」無 HTTP 碼；macOS Chrome / Safari 正常）。
      // 快速鍵送出（無 popup）走 sendToReadwiseFromCommand，仍在 SW 內直送。
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
if (browser.runtime.onStartup && browser.runtime.onStartup.addListener) {
  browser.runtime.onStartup.addListener(() => {
    // 空 handler：喚起 background 本身就是目的。content/keepalive.js 的
    // port 會在頁面載入後接上、讓 background 維持存活（兩段式：onStartup
    // 拉起 → keep-alive 保活，缺一不可——WPA 不會 on-demand 重啟死掉的 appex）
  });
}

// v0.8.34：Safari 限定 wake alarm——macOS Safari WPA 的 background 啟動觸發器
// 第二發（onStartup / wake ping 實測都拉不起來）。
//
// 機制：alarm 是**持久化排程**（存在 extension 狀態、不隨 background 死亡消失）。
// WPA 啟動時若 alarm 已逾期，WebKit 必須喚 background 派送 onAlarm → background
// 被拉起 → content keep-alive port 接手保活整個 session → commands.onCommand
// 有人接。Shinkansen 在 WPA「多半能動、偶爾全滅」的間歇模式 = 它的 24h alarm
// 在「每天首開」時逾期（→ 能動）、「短時間重開」時未逾期（→ 全滅），實證
// alarm 是 WPA 唯一可靠的 background 啟動觸發器。JRead 用 5 分鐘週期把
// 「未逾期窗口」縮到最小。
//
// 雞生蛋注意：本段程式碼在 background 內執行——WPA 內 background 第一次跑
// 起來之前 alarm 不存在。bootstrap 路徑：extension 更新 / 設定頁啟用切換 /
// 一般 Safari 的任何 background 喚醒（alarm 狀態若 per-context 則需該 context
// 跑過一次）。same-name create 冪等（重複呼叫覆蓋、無重複註冊）。
// Chrome 不建 alarm（SW 事件喚醒可靠，省每 5 分鐘的無謂喚醒）；onAlarm
// listener 無條件註冊（Chrome 無 alarm 永不觸發，零行為差異）。
const IS_SAFARI_RUNTIME = (() => {
  try {
    return browser.runtime.getURL('').startsWith('safari-web-extension://');
  } catch (_) {
    return false;
  }
})();
if (browser.alarms && browser.alarms.onAlarm) {
  // 空 handler：被喚醒本身就是目的（喚醒後 keep-alive port 會在 content
  // 重連時接上、接手保活）
  browser.alarms.onAlarm.addListener(() => {});
  if (IS_SAFARI_RUNTIME) {
    try {
      browser.alarms.create('jread-bg-wake', { delayInMinutes: 5, periodInMinutes: 5 });
    } catch (_) { /* alarms 不可用環境（舊版 Safari）silently skip */ }
  }
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
browser.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== 'jread-keepalive') return;
  port.onMessage.addListener(() => {
    try { port.postMessage({ pong: true }); } catch (_) {}
  });
});

// 導航到新 URL 時重置 icon 回灰階——content script 會在新頁重新載入、預設
// state 也是 inactive，但 setIcon 的 per-tab 設定會跨 navigation 殘留，
// 需主動清空。監聽 tab.onUpdated 的 status === 'loading' 是新頁載入最早
// 的訊號點。
browser.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    // v0.8.36 iOS guard：與 SET_ACTIVE_ICON case 同款——iOS 的 action API
    // 子集可能缺 setIcon / badge 系列，缺就跳過（swallowTabGone 只吞 promise
    // rejection，API 不存在是同步 TypeError、會在每次任何 tab 進 loading 時
    // 炸一次 listener）。同一平台事實、兩條 path 防護必須對稱。
    if (!browser.action || !browser.action.setIcon || !browser.action.setBadgeText) return;
    swallowTabGone(browser.action.setIcon({ tabId, path: ICONS_IDLE }));
    // 同步清掉 reader-active badge（避免新頁面殘留前一頁的綠燈）
    swallowTabGone(browser.action.setBadgeText({ tabId, text: '' }));
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
      sendMessage: (id, m) => browser.tabs.sendMessage(id, m),
      executeScript: (opts) => browser.scripting.executeScript(opts)
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
if (browser.commands && browser.commands.onCommand) {
  browser.commands.onCommand.addListener(async (command) => {
    // async listener 的 rejection 沒人接（tabs.query 或 dispatch 極端故障）
    // 會變 unhandled rejection——整包 try/catch 吞掉（快速鍵失效已由 toast /
    // 使用者按鍵無反應呈現，不需要再堆 console 噪音）
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab || typeof tab.id !== 'number') return;
      await dispatchCommand(command, tab.id);
    } catch (_) { /* 見上方註解 */ }
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
//
// v1.7.36：按下去當下就要有反應（Jimmy 2026-08-04）。原本整條流程只在最後
// 吐一則結果 toast，抽 payload + Gemini 摘要 + 上傳可能跑好幾秒，中間完全無
// 回饋、使用者不知道有沒有按到。改成與 popup 狀態列同步的三段式：
//   送出中… → （有開摘要才有）產生摘要中… → 結果
// 三則共用同一個 toast id，後一則取代前一則（不疊成一排殘影）；文字取自
// popup-core SAVE_PROGRESS，與 popup 軌同一份事實。
async function sendToReadwiseFromCommand(tabId) {
  const sendMessage = (id, m) => browser.tabs.sendMessage(id, m);
  const { SAVE_PROGRESS, SAVE_PROGRESS_TOAST_ID, SAVE_PROGRESS_TOAST_MS } = self.__JReadPopup;
  // 結果 / 錯誤 toast：帶同一個 id 取代進行中那則，並用預設顯示時間
  const showToast = (message, kind) => {
    sendMessage(tabId, {
      type: 'SHOW_TOAST',
      payload: { message, kind, id: SAVE_PROGRESS_TOAST_ID }
    }).catch(() => {});
  };
  // 進行中 toast：同 id + 長顯示上限（結果一到就被取代）
  const showProgress = (message) => {
    sendMessage(tabId, {
      type: 'SHOW_TOAST',
      payload: {
        message, kind: 'info',
        id: SAVE_PROGRESS_TOAST_ID,
        duration: SAVE_PROGRESS_TOAST_MS
      }
    }).catch(() => {});
  };

  // 0. 立刻回饋——大宗情境（已在閱讀模式按快速鍵）content script 已注入，
  //    這則會馬上出現。未注入的頁面此則 silent fail，改由步驟 1 toggle 成功
  //    後補一則（那時 content script 才存在）。
  showProgress(SAVE_PROGRESS.sending);

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
      executeScript: (opts) => browser.scripting.executeScript(opts)
    });
    if (!toggleResult || !toggleResult.ok) {
      // 連注入 + toggle 都失敗，無法顯示 toast（content script 沒跑起來）
      return;
    }
    // 等 detector / cleaner / styler 跑完（content main.js enterReaderMode 是
    // async）。v1.7.42：原本固定等 800ms 是 race——慢站（重 SPA / 大量動態內容）
    // 可能還沒 ready 就抽 payload、抽到殘缺內容。改輪詢 GET_READER_STATE 直到
    // active（每 200ms、上限 4s）；就緒即早退，多數站（harness 實測 cleaner
    // 100-300ms）比固定 800ms 更快。逾時不中斷——繼續往下走，由步驟 2 的
    // extracted.ok 判定兜底（維持原本 800ms 到點就走的失效模式，不更差）。
    for (let waited = 0; waited < 4000; waited += 200) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const s = await sendMessage(tabId, { type: 'GET_READER_STATE' });
        if (s && s.active) break;
      } catch { /* content script 尚未就緒——繼續輪詢 */ }
    }
    // v1.7.36：步驟 0 那則多半送不到（當時 content script 還沒注入），
    // 此刻補一則——同 id，已顯示的話不會變兩則。
    showProgress(SAVE_PROGRESS.sending);
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

  // 3. 送出（v1.6.0：走 popup-core.sendDocument dispatcher，依儲存服務二擇一分派
  // 到 Readwise / Instapaper；與 popup 軌共用同一條抽象層）。
  // v0.8.36：storage 讀取與 fetch 都包 try/catch——保證任何路徑都有 toast 回饋。
  let settings;
  try {
    settings = await browser.storage.sync.get({
      storageService: (DEFAULT_SETTINGS && DEFAULT_SETTINGS.storageService) || 'readwise',
      readwiseToken: '', instapaperToken: '', instapaperTokenSecret: '',
      readwiseSummary: false, geminiApiKey: ''
    });
  } catch {
    showToast('無法讀取設定，請稍後再試', 'error');
    return;
  }
  const { resolveServiceCredentials, sendDocument, generateGeminiSummary, saveResultToast, serviceLabel } = self.__JReadPopup;
  const { service, creds, ok } = resolveServiceCredentials(settings);
  const label = serviceLabel(service);
  if (!ok) {
    // v1.7.43：與結果 toast 同走 saveResultToast 單一資料源（credsPlace 用預設「設定頁」）
    const t = saveResultToast({ ok: false, error: 'NO_CREDENTIALS' }, { serviceLabel: label });
    showToast(t.message, t.kind);
    return;
  }
  // v0.8.72：快速鍵軌同樣支援 Gemini 摘要（兩服務共用）。失敗 fallback 照送。
  const p = extracted.payload || {};
  if (settings.readwiseSummary && settings.geminiApiKey && p.text) {
    showProgress(SAVE_PROGRESS.summarizing);
    try {
      const sum = await generateGeminiSummary({
        apiKey: settings.geminiApiKey, title: p.title, author: p.author, domain: p.domain, text: p.text
      });
      if (sum && sum.ok) p.summary = sum.summary;
    } catch (_) { /* 摘要失敗不阻斷 */ }
    // 摘要階段結束、回到「送出中…」（與 popup 狀態列同序）
    showProgress(SAVE_PROGRESS.sending);
  }
  let result;
  try {
    result = await sendDocument({ service, creds, payload: p });
  } catch {
    showToast('網路錯誤，請稍後再試', 'error');
    return;
  }

  // 4. 結果 toast（v1.6.0：saveResultToast 服務感知——訊息文字單一資料源，
  // 與 popup 軌共用；Readwise 200=已存在、Instapaper 一律「已送到」）。
  const { message, kind } = saveResultToast(result, { serviceLabel: label, existsOn200: service === 'readwise' });
  showToast(message, kind);
}
