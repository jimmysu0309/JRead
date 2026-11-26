// JRead — 懸浮按鈕（floating action button，v0.8.154）
//
// 設計（參考 Shinkansen content-floating-icon.js）：
// - 頁面左／右緣常駐的浮動 icon，用工具列方形 icon（assets/icons/icon-32.png 經
//   chrome.runtime.getURL 載入；assets/* 已列入 manifest web_accessible_resources）。
//   尺寸由 floatingIconSize 設定切換（v0.8.156，v0.8.166 加 medium）：'small' = 視覺
//   16×16 / footprint 32×32、'medium' = 視覺 24×24 / footprint 40×40（**預設**，
//   v0.8.166 起——原 small 部分使用者覺得太小）、'large' = 視覺 32×32 / footprint
//   48×48（觸控嫌小者放大）。
//   尺寸走 CSS 變數（--fab-hit / --fab-icon）讓 storage.onChanged 即時生效。
// - 短按（放開前長按計時器未觸發、未拖移）= 切換閱讀模式，走
//   NS.dispatchLocalCommand('toggle-reader-mode')（與 3 指輕點 / 快速鍵同一條
//   content 端本地 dispatch，含 YouTube 模式重導、不 round-trip SW）。
//   例外：iOS App 內建 JReader 短按＝開選單（v3.2.6，見 handleShortPress）。
// - 長按（壓住達 LONGPRESS_MS、未拖移）= 跳出選單：送到儲存服務（Readwise Reader /
//   Instapaper，標籤依 storageService 動態）、切換分頁模式、進入 Reader、功能選單
//   （叫出工具列圖示選單 popup）。點任一列執行後收選單；點選單外 / 捲動 = 收選單。
//   「送到 …」在 v0.8.165 加入、v0.8.166 因 iOS toast 不顯示撤掉，v1.7.79 依 Jimmy
//   2026-08-20 需求回歸（當年的 toast 消失多半是 toast host 掛 body 被 cleaner 藏掉，
//   v1.6.24 改掛 documentElement 後已無此結構；送出流程見 main.js
//   sendCurrentPageToService）。
// - 長按選單彈出後手勢即定案（v1.7.79）：後續 pointermove 一律忽略，不再改判成拖移。
//   舊行為是手指自然抖動超過門檻就收選單（「一抖就消失」）；觸控的拖移門檻也另外
//   放寬到 DRAG_THRESHOLD_TOUCH_PX。
// - v1.5.13：在 YouTube watch 頁（/watch）長按選單改顯示 YouTube 專屬兩列——
//   「啟動/關閉影院模式」「啟動/關閉無邊模式」（標籤依目前是否 active 動態切換），
//   最下方仍保留「功能選單」。一般閱讀頁的「切換分頁模式 / 進入 Reader」對 YouTube
//   watch 無意義（無主文可閱讀），故換成 YouTube 兩功能的入口。選單於每次長按重建
//   （buildMenu），故標籤每次都反映當下 active 狀態。
// - 拖移（pointermove 超過 DRAG_THRESHOLD_PX）= 進入拖移模式，放開時吸附最近的
//   左／右緣，垂直位置存比例（floatingIconPos = { edge, offsetY }），視窗縮放後
//   按比例還原。預設貼**左下角**（左緣 + offsetY=1，v0.8.160；原置中）。
// - **只有 iPadOS** 渲染時把 top 夾離上下角落 CORNER_DEADZONE_PX（v0.8.161；v0.8.166 起
//   改為僅 iPadOS、原本套到所有觸控裝置）：iPadOS 視窗下方角落是縮放拖曳把手、上方角落是
//   系統手勢區，按鈕停太靠近會被 OS 攔走觸控而拖不出來。iPhone（無視窗縮放角）與桌面瀏覽器
//   不設禁制區。比照 Shinkansen content-floating-icon.js。
// - disable → 重新 enable 時按鈕回到預設位置（v0.8.161，applyEnabled 偵測 false→true
//   轉移時 applyPos(null)+persist；初始載入不重置，尊重 storage 存的位置）。
// - enable / 透明度 / 位置走 storage.sync，onChanged 即時生效（比照 toast.js）。
//   floatingIcon 啟用旗標未設過（非 boolean）時一律預設開（v0.8.158，原平台分流
//   取消，__JReadResolveFloatingIconEnabled，settings-defaults.js 單一資料源）。
// - 比照 toast 用獨立 Shadow DOM host，掛在 documentElement（**不掛 body**——body
//   children 會被 cleaner 動態 observer 當雜訊隱藏，injected UI 一律 append
//   documentElement，CLAUDE.md / memory feedback_reader_injected_ui_append_html）。
// - 只在 top frame 放一顆（window === window.top）；iframe / 非 HTML 文件
//   （XMLDocument，attachShadow 會 throw）一律早退。
// - v3.5.0 齒輪模式（Jimmy 2026-11-26「沿用 extension icon 和極簡風 UI 不相容」）：JRead 自己的
//   閱讀頁（列表頁 reader.html、文章頁 article.html；App、網頁版、擴充的 Reader）不放 J 圖示，改放
//   齒輪圓鈕——外觀照列表頁右下角的搜尋圓鈕（reader.html 的 .jr-fab），固定左下角、不能拖、不吃
//   懸浮按鈕的尺寸 / 透明度 / 位置 / 開關設定（那些是一般網站的 J 用的）。點一下＝開選單。
//   列表頁：往下捲淡出（reader-library.js 的捲動判斷呼叫 NS.floating.setScrollHidden，跟搜尋圓鈕
//   同一份判斷）、搜尋工具列展開 / 多選時藏。文章頁：沉浸閱讀，平常藏、點一下畫面才出現
//   （reader/reader-immersive.js）。選單多一項「JReader 總覽」（儲存服務是 JReader 時）。
//   一般網站上擴充的 J 圖示完全不變。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;
  if (window !== window.top) return;     // 只在主 frame 放一顆
  if (NS.floating) return;               // 重複注入保險
  // v3.4.9：JReader 公開分享頁（web core 公開唯讀模式，host 替身 readOnly）原本不放（當時是 J 圖示，
  // Jimmy 2026-11-25「其他人不應該看到有這個 icon」）。v3.5.1（Jimmy 2026-11-26「將齒輪按鈕加到分享文章，
  // 讓訪客使用者也能調整顯示方式」）：v3.5.0 起閱讀頁是齒輪，分享頁也放——選單只剩「切換分頁模式」
  //「功能選單」（字級、主題…存在訪客自己瀏覽器的 localStorage）；沒有回到列表、文章資訊、總覽
  //（readerNoExit、不掛 onReaderInfo、沒有 JReader 網址，見 generalMenuItems / dashboardUrl）
  const PUBLIC_PAGE = !!(window.__jreadHost && window.__jreadHost.readOnly);
  // v3.4.5：App 的文章列表頁（reader/reader.html）也放一顆（Jimmy 2026-11-25「iOS App 文章列表沒有
  // J 圖示，加在版面最左下方」）。列表頁只在 App 放：Safari 擴充 / 網頁版的列表頁維持沒有。
  // 列表頁固定貼左下角、不能拖（位置設定跟 Safari 擴充同步，那邊拖到哪不該搬動列表頁的入口），
  // 選單只有「功能選單」「設定」——文章頁那幾項（回列表、分頁模式、文章資訊）在列表頁沒有對象
  // 判定讀 reader.html 自己標的 <html data-jread-page="feed">——本檔也是每個網站都注入的 content script，
  // 不能只看路徑（任何網站都可能有 /reader/reader.html）
  // v3.5.0：頁面標記只在 JRead 自己的頁面才算數——沒有 background 的 host（App / 網頁版）整個頁面都是
  // JRead 的；擴充則要是擴充自己的 reader/ 頁面（一般網站自己標 data-jread-page 不算）
  const PAGE_KIND = document.documentElement ? document.documentElement.getAttribute('data-jread-page') : null;
  const OWN_PAGE = (() => {
    try {
      if (NS.isHostedRuntime && NS.isHostedRuntime()) return true;
      const base = browser.runtime.getURL('reader/');
      return !!base && location.href.indexOf(base) === 0;
    } catch (_e) { return false; }
  })();
  const FEED_PAGE = OWN_PAGE && PAGE_KIND === 'feed';
  const GEAR = OWN_PAGE && (PAGE_KIND === 'feed' || PAGE_KIND === 'article');
  // v3.7.0：一般網站上的 J 改成齒輪那一套外觀與位置（Jimmy 2026-11-26「icon style 和互動行為改為與齒輪 icon 相同，
  // 位置固定在左下角相同位置，按鈕中間的圖示改為類似原本 icon 圖案的 J」）：36px 圓、細框、線條圖示（Georgia 粗體 J）、
  // 固定左下角（離邊＝articleFabEdges）、不能拖、不吃尺寸 / 透明度 / 位置設定（設定 UI 一併拿掉）。
  // 互動保留 J 的：點一下切換閱讀模式、長按開選單（Jimmy 選「點一下切換閱讀模式」）。
  // 一般網站的配色各不相同：不讀頁面的 --line / --muted（那是網站自己的變數），用固定的半透明白底＋細框
  const SITE_FAB = !GEAR;
  // v3.7.1：一般網站 J 的大小（Jimmy 2026-11-26「加入能設定 extension icon 大小的選項」，沿用 floatingIconSize）。
  // 中＝齒輪（GEAR_HIT / GEAR_ICON）；J 文字在 SVG viewBox 裡，跟著圖示尺寸等比縮放
  const SITE_SIZE_MAP = { small: { hit: 30, icon: 14 }, medium: { hit: 36, icon: 17 }, large: { hit: 44, icon: 21 } };
  // 齒輪尺寸＝搜尋圓鈕（reader.html .jr-fab：36px 圓、圖示 17px）。同一份外觀的兩份實作（那邊是頁面 CSS、
  // 這裡在 shadow DOM 裡碰不到），改一邊要改另一邊；forcing：v350-gear.spec.js 比對兩邊的數值
  const GEAR_HIT = 36;
  const GEAR_ICON = 17;
  // v3.5.1：文章頁齒輪離底（不含安全區域）。原本 20px（同列表頁），翻頁模式的內文末行停在頁碼上方
  //（iPhone 離底 10＋19＋12＝41px，桌面卡片下緣 48px），36px 高的齒輪佔 20–56px 蓋到末行（Jimmy
  // 2026-11-26 App 截圖）。降到 4px：齒輪佔 4–40px，在末行之下、跟頁碼同一條帶（頁碼置中、齒輪靠左，
  // 不重疊）。等式由 v351.spec 對 styler 的頁碼常數鎖住
  const GEAR_ARTICLE_BOTTOM = 4;
  // v3.5.1：網頁版文章頁右上角的「文章資訊」圓鈕（Jimmy 2026-11-26「用同樣設計方式放到右上角」），
  // 外觀＝齒輪（同一組 .fab.gear 樣式），跟齒輪一起被沉浸閱讀藏 / 顯示（在同一個 host 裡）。
  // v3.5.2：App 文章頁也有，放右下角（Jimmy 2026-11-26「閱讀文章頁面，請在右下角加入文章資訊按鈕」），
  // 跟左下角齒輪左右對稱
  // v3.5.2：文章頁圓鈕離視窗邊的距離（Jimmy 2026-11-26「齒輪與文章資訊按鈕（以及其他按鈕），距離頂部
  // 及底部和側面的距離都必須相等」）。網頁版與擴充的 Reader（非 App）所有圓鈕上下左右一律同一個值：
  //   - 滑鼠裝置 12px：桌面翻頁卡片下緣留白 48px（styler V_GUTTER 上限），齒輪 12＋36＝48 不蓋末行
  //   - 觸控裝置＝GEAR_ARTICLE_BOTTOM（4px）：手機翻頁末行離底只有 41px，齒輪離底最多 5px
  // App 維持 v3.5.1：左右 20px、離底 GEAR_ARTICLE_BOTTOM（Jimmy 那條規則只講網頁版；App 沒有上方的圓鈕）
  const ARTICLE_FAB_EDGE_FINE = 12;
  const APP_FAB_SIDE = 20;

  const LONGPRESS_MS = 500;              // 壓住達此毫秒 = 長按 → 開選單；之前放開 = 短按
  // pointer 位移超過此距離 = 進入拖移（取消短按 / 長按）。滑鼠與觸控分開設門檻
  // （v1.7.79）：手指接觸面大、壓在螢幕上沒有支撐，靜止「長按」期間的自然抖動遠
  // 大於滑鼠——8px 對觸控太窄，長按還沒滿 500ms 就常被判成拖移。
  const DRAG_THRESHOLD_PX = 8;           // 滑鼠 / 觸控筆
  const DRAG_THRESHOLD_TOUCH_PX = 16;    // 觸控（手指）
  // 尺寸對照（v0.8.156；v0.8.166 加 medium）：透明 padding 維持每側 8px（icon + 16 = footprint）。
  // 視覺尺寸走 CSS 變數即時切換；hitSize（footprint）同步進 JS 給貼邊 / 拖移夾擠用。
  const SIZE_MAP = {
    small: { icon: 16, hit: 32 },        // v0.8.154 以來的原始尺寸（v0.8.166 起預設改 medium）
    medium: { icon: 24, hit: 40 },       // 中（v0.8.166）
    large: { icon: 32, hit: 48 }         // 觸控嫌小者放大
  };
  let hitSize = SIZE_MAP.medium.hit;     // 目前 footprint（預設 medium，v0.8.166；applyPos / 拖移用，applySize 更新）
  const EDGE_MARGIN = 6;                 // 吸附邊緣時與視窗邊的間距
  // iPadOS 角落 OS 保留區邊長（v0.8.161）。iPadOS 視窗下方角落是縮放拖曳把手、上方角落
  // 是系統手勢區：按鈕停太靠近角落會被 OS 攔走觸控，使用者再也按不到 / 拖不出來。按鈕 x
  // 永遠貼左／右緣，故只需把 y 夾離上下角落這段距離（比照 Shinkansen content-floating-icon.js
  // cornerClampTop）。
  const CORNER_DEADZONE_PX = 44;
  // 角落禁制區**只針對 iPadOS**（v0.8.166，Jimmy 2026-06-23；原 v0.8.161 套到所有觸控裝置
  // 含 iPhone）。判斷：真觸控（maxTouchPoints ≥ 1）+ iPad UA 訊號。iPadOS 13+ 桌面模式把 UA
  // 偽裝成 Macintosh，但 maxTouchPoints 仍 ≥ 1（桌面 Mac = 0、iPad app on Mac = 0），故
  // 「Macintosh + 觸控」視為 iPad。iPhone / iPod 先排除（它們 UA 也帶「like Mac OS X」，只認
  // Macintosh 不比對 Mac OS X）。iPhone / Android / 桌面（含 iPad app on Mac，maxTouchPoints=0）
  // 皆不設禁制區——它們沒有 iPad 的視窗縮放角／系統手勢角問題。純函式吃 (ua, touchPoints) 方便
  // regression 驗各平台 UA 分支；可被 NS.floating.setIPadOSForTest 覆寫驗夾邊路徑（實機 Chromium
  // / jsdom maxTouchPoints = 0、UA 非 iPad）。
  // 2026-11-15 review C-01：判定本體搬到 settings-defaults.js __JReadPlatform.isIPadOSEnv
  //（裝置判定單一資料源，manifest 載入順序保證先於本檔）；這裡留同名轉呼給 spec 與匯出用。
  function isIPadOSEnv(ua, touchPoints) {
    const P = (typeof window !== 'undefined' && window.__JReadPlatform) || null;
    return !!(P && P.isIPadOSEnv(ua, touchPoints));
  }
  let isIPadOS = isIPadOSEnv(
    (typeof navigator !== 'undefined' && navigator.userAgent) || '',
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0
  );
  // v1.7.43 T8：預設值改讀 settings-defaults 單一資料源（manifest 載入順序保證
  // 先載）；fallback 字面值由 defaults-sync.spec 校對與正典一致
  const SETTINGS_DEF = (typeof window !== 'undefined' && window.__JReadSettingsDefaults) || {};
  const DEFAULT_OPACITY = SETTINGS_DEF.floatingIconOpacity ?? 0.7;
  // v0.8.158：長按開選單時把整顆 host（含選單）調到全不透明，避免使用者設的
  // 淡透明度（預設 0.7）讓選單文字看不清；收選單時還原使用者設定的透明度。
  let currentOpacity = DEFAULT_OPACITY;  // 使用者設定的透明度（選單收合時的還原值）
  const HOST_ID = '__jread-floating-host';

  // ─── Shadow DOM host（掛 documentElement，CSP-safe）─────────────────────
  let host, shadow, btn, menuEl;
  try {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483600; display: none; transition: opacity .15s ease;';
    shadow = host.attachShadow({ mode: 'open' }); // open：regression spec 可驗內部結構
  } catch (_e) {
    // 非 HTML 文件（XMLDocument 等）attachShadow / style 會 throw → 不放 icon
    return;
  }

  const iconUrl = (() => {
    try { return browser.runtime.getURL('assets/icons/icon-32.png'); }
    catch (_e) { return ''; }
  })();

  const CSS = `
    :host, * { box-sizing: border-box; }
    :host { --fab-hit: ${SIZE_MAP.medium.hit}px; --fab-icon: ${SIZE_MAP.medium.icon}px; }
    .fab {
      position: relative;
      width: var(--fab-hit);
      height: var(--fab-hit);
      border: none;
      padding: 0;
      background: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      touch-action: none;          /* 自行處理拖移，禁瀏覽器捲動 / 手勢介入 */
      user-select: none;
      -webkit-user-select: none;
      -webkit-tap-highlight-color: transparent;
      transition: transform .15s ease;
    }
    .fab:active { transform: scale(.92); }
    .fab img {
      width: var(--fab-icon);
      height: var(--fab-icon);
      display: block;
      border-radius: 4px;
      /* drop-shadow 讓 icon 在淺色 / 同色頁面也看得見 */
      filter: drop-shadow(0 1px 3px rgba(0,0,0,.4));
      pointer-events: none;
      -webkit-user-drag: none;
      user-drag: none;
    }
    .fab.dragging img { filter: drop-shadow(0 4px 10px rgba(0,0,0,.45)); }
    /* v3.5.0 齒輪：外觀照 reader.html 的 .jr-fab（搜尋圓鈕）——透明底、細框、淡灰線條圖示，
       滑鼠移上 / 鍵盤聚焦 / 選單開著才清楚。顏色讀頁面的主題變數（自訂屬性會穿進 shadow DOM）；
       文章頁沒有 --line / --card，退回中性灰框與 --bg */
    .fab.gear {
      width: ${GEAR_HIT}px; height: ${GEAR_HIT}px;
      border: 1px solid var(--line, rgba(128,128,128,0.28)); border-radius: ${GEAR_HIT / 2}px;
      background: transparent; color: var(--muted, #6b6b6b); opacity: .7;
      transition: opacity .15s ease, color .15s ease, background-color .15s ease;
    }
    .fab.gear:active { transform: none; }
    .fab.gear svg { width: ${GEAR_ICON}px; height: ${GEAR_ICON}px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    .fab.gear:hover, .fab.gear:focus-visible, .fab.gear[aria-expanded="true"] {
      opacity: 1; color: var(--text, #1a1a1a); background: var(--card, var(--bg, #ffffff)); border-color: var(--muted, #6b6b6b); outline: none;
    }
    .fab.gear svg .dot { fill: currentColor; stroke: none; }
    .fab.gear.is-scroll-hidden { opacity: 0; pointer-events: none; }
    /* v3.7.0 一般網站的 J：齒輪外觀、固定配色（不吃網站的 CSS 變數）。白底半透明＋細框＋淡陰影，
       淺色 / 深色網站都看得到；J 用 Georgia 粗體（同 App 圖示的 J） */
    .fab.gear.site { background: rgba(255, 255, 255, 0.92); color: #4a4a4a; border-color: rgba(0, 0, 0, 0.18);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18); opacity: .85; }
    .fab.gear.site:hover, .fab.gear.site:focus-visible, .fab.gear.site[aria-expanded="true"] {
      opacity: 1; color: #1a1a1a; background: #ffffff; border-color: rgba(0, 0, 0, 0.35); }
    .fab.gear.site svg text { fill: currentColor; stroke: none; }
    /* v3.7.1：大小設定（applySize 寫 --fab-hit / --fab-icon） */
    .fab.gear.site { width: var(--fab-hit); height: var(--fab-hit); border-radius: calc(var(--fab-hit) / 2); }
    .fab.gear.site svg { width: var(--fab-icon); height: var(--fab-icon); }
    /* 文章頁：齒輪疊在內文上，透明底會跟字混在一起（截圖驗證）——用頁面底色當實心底、不淡化。
       平常本來就藏（沉浸閱讀），出現時要一眼看得到 */
    .fab.gear.solid { opacity: 1; background: var(--bg, #ececec); border-color: var(--fab-ring, var(--muted, #6b6b6b)); }
    /* v3.5.1 網頁版文章頁右上角的「文章資訊」圓鈕：同一組齒輪樣式，fixed 到視窗右上（host 沒有
       transform / filter，fixed 子元素以視窗為準）。文章資訊面板掛上（NS.onReaderInfo）才出現 */
    .fab.info-fab, .fab.back-fab { position: fixed; display: none; }   /* 位置在 applyGearPos 設 */
    .fab.info-fab.ready, .fab.back-fab.ready { display: flex; }
    @media (prefers-reduced-motion: reduce) { .fab.gear { transition: none; } }
    /* 長按選單（v0.8.161 比照 Shinkansen content-floating-icon.js 重繪：藍色圓角
       badge icon、13px 字、緊湊間距、label 過長 ellipsis） */
    .menu {
      position: absolute;
      bottom: 0;
      min-width: 168px;
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0,0,0,.22);
      padding: 6px;
      display: none;
      flex-direction: column;
      gap: 2px;
      font: 13px -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
    }
    .menu.show { display: flex; }
    .menu.side-left  { left: calc(var(--fab-hit) + 8px); }
    .menu.side-right { right: calc(var(--fab-hit) + 8px); }
    /* v1.7.42：fab 在畫面上半部時選單改由 top:0 往下長——預設 bottom:0（往上長）
       在 fab 貼近頂部時會超出畫面頂、選單項目點不到（openMenu 依 pos.offsetY 切換） */
    .menu.anchor-top { top: 0; bottom: auto; }
    .menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 12px;
      border-radius: 8px;
      background: none;
      border: none;
      width: 100%;
      text-align: left;
      color: #1d1d1f;
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    .menu-item:hover { background: #f0f0f3; }
    /* 分隔線 +「功能選單」項（v0.8.162，比照 Shinkansen content-floating-icon.js） */
    .menu-divider { height: 1px; background: #e5e5ea; margin: 4px 8px; }
    /* v3.3.0：圖示改單色線條 SVG（Jimmy 2026-11-25「選單 icon 與極簡風不合」）——原本是藍底
       圓角 badge 裝 emoji / 符號（📖 ⇄ ⓘ ☰），各平台字形不一、與 JReader 其他線條圖示（搜尋圓鈕）
       風格不一致。改成 24 格線框、圓角線頭、跟文字色走；套用中的設定檔勾用藍色（選取語意） */
    .menu-item .ico {
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
      color: #48484a;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .menu-item .ico svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .menu-item .ico.accent { color: #0071e3; }
    .menu-item .ico .dot { fill: currentColor; stroke: none; }
    .menu-item .label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
    /* v3.4.5：觸控裝置字級放大到 17px、列高與圖示跟著加（Jimmy 2026-11-25「點 J 圖示的功能表字體
       太小」）。13px 是桌面滑鼠的緊湊尺寸；手指點的選單比照 iOS 系統選單內文 17pt */
    @media (pointer: coarse) {
      .menu { min-width: 200px; font-size: 17px; padding: 6px; }
      .menu-item { padding: 11px 14px; gap: 10px; }
      .menu-item .ico, .menu-item .ico svg { width: 22px; height: 22px; }
    }
  `;

  shadow.innerHTML = `
    <button class="fab" id="fab" type="button" aria-label="JRead">
      ${iconUrl ? `<img src="${iconUrl}" alt="">` : ''}
    </button>
    <div class="menu" id="menu" role="menu"></div>
  `;
  // v0.8.159：改走 NS.injectShadowCss（CSP-safe）——嚴格 style-src nonce-only 站
  // （自架 Miniflux 閱讀頁）在 WebKit 會擋掉 shadow 內注入的 <style>，使 .fab 拿不到
  // var(--fab-hit) 寬高、icon 退回 <img> 原生 32px 無視尺寸設定。退回
  // shadow.adoptedStyleSheets。詳見 namespace.js injectShadowCss 註解。
  NS.injectShadowCss(shadow, CSS);
  btn = shadow.getElementById('fab');
  menuEl = shadow.getElementById('menu');
  if (SITE_FAB) {
    btn.classList.add('gear', 'site');
    btn.setAttribute('aria-label', 'JRead');
    btn.title = 'JRead：點一下切換閱讀模式，長按開選單';
  }
  if (GEAR) {
    btn.classList.add('gear');
    btn.setAttribute('aria-label', '選單');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.title = '選單';
    if (!FEED_PAGE) btn.classList.add('solid');
  }
  // v3.5.1：網頁版文章頁（非公開分享頁）把「文章資訊」從選單搬到右上角圓鈕；v3.5.2 App 也搬（右下角）
  const ARTICLE_GEAR = GEAR && PAGE_KIND === 'article';
  const APP_PAGE = !!(NS.isAppRuntime && NS.isAppRuntime());
  const INFO_FAB = ARTICLE_GEAR && !PUBLIC_PAGE && (APP_PAGE || !!(NS.isWebRuntime && NS.isWebRuntime()));
  // v3.5.2：左上角「回到文章列表」圓鈕（v3.4.4 的「← 列表」膠囊鈕原本在 reader-article.js、滑鼠一動才浮現；
  // Jimmy 2026-11-26「設計語彙與齒輪及文章資訊對齊，出現和消失的行為也要一致」）。搬進同一個 host：同一組
  // .fab.gear 樣式、跟齒輪一起被沉浸閱讀藏 / 顯示。出現條件沿用 v3.4.4：有滑鼠的裝置（手機 / App 用選單
  // 與左緣右滑）、有出口（NS.onReaderExit 掛上且不是 readerNoExit）
  const FINE_POINTER = (() => {
    try { return !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches); } catch (_e) { return false; }
  })();
  const BACK_FAB = ARTICLE_GEAR && !APP_PAGE && FINE_POINTER;
  // v3.5.3：設定「滑鼠移動浮現按鈕」（mouseRevealButtons）。只在有滑鼠的非 App 文章頁生效——觸控裝置點按時
  // 瀏覽器會補送相容的 mousemove，不擋的話設定從電腦同步過來後手機一點就浮現又自己收。顯示 / 收起的判定在
  // reader-immersive.js（setMouseReveal），這裡只讀設定、轉交；immersive 比本檔晚載入，裝好時會來問 mouseRevealPref
  let mouseRevealRaw = false;
  function mouseRevealPref() { return ARTICLE_GEAR && !APP_PAGE && FINE_POINTER && mouseRevealRaw === true; }
  function applyMouseReveal(v) {
    mouseRevealRaw = v === true;
    const I = window.__JReadImmersive;
    if (I && I.instance && typeof I.instance.setMouseReveal === 'function') I.instance.setMouseReveal(mouseRevealPref());
  }
  function makeCornerFab(cls, label, title, onClick) {
    const b = document.createElement('button');
    b.className = 'fab gear solid ' + cls;
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = title;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      try { onClick(); } catch (_err) {}
    });
    shadow.appendChild(b);
    return b;
  }
  const infoBtn = INFO_FAB
    ? makeCornerFab('info-fab', '文章資訊', '文章資訊', () => { if (typeof NS.onReaderInfo === 'function') NS.onReaderInfo(); })
    : null;
  const backBtn = BACK_FAB
    ? makeCornerFab('back-fab', '回到文章列表', '回到文章列表（Esc）', () => backToFeed())
    : null;
  // 文章資訊面板、退出 hook 都是 reader-article 載入文章後才掛（NS.onReaderInfo / onReaderExit）；圓鈕平常
  // 被沉浸閱讀藏著，每次畫面切換（jread:chrome）與開選單時對一次
  function refreshInfoFab() {
    if (infoBtn) infoBtn.classList.toggle('ready', typeof NS.onReaderInfo === 'function');
    if (backBtn) backBtn.classList.toggle('ready', typeof NS.onReaderExit === 'function' && !(NS.state && NS.state.readerNoExit));
    applyFabTheme();
  }
  // v3.5.3：文章頁圓鈕跟著閱讀主題配色（Jimmy 2026-11-26「按鈕顯示在夜間模式太刺眼，請為各主題設計對應對比度的
  // 按鈕」）。文章頁沒有列表頁那組 --bg / --muted 變數，原本一律退回淺灰底 #ececec，夜間主題上像一顆亮燈。
  // 改讀閱讀卡實際的底色與字色（reader-cache pageThemeColors，文章資訊面板同一份）：
  //   底＝卡片底色、圖示＝字色 62%、外框＝字色 30%（--fab-ring）；滑鼠移上 / 選單開著：圖示＝字色、外框＝字色 62%
  // 每次顯示（jread:chrome）與開選單時重讀，閱讀中切主題也對。列表頁照舊吃頁面自己的變數
  function applyFabTheme() {
    if (!ARTICLE_GEAR) return;
    const RC = window.__JReadReaderCache;
    if (!RC || typeof RC.pageThemeColors !== 'function') return;
    let c;
    try { c = RC.pageThemeColors(window, document); } catch (_e) { return; }
    if (!c) return;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(c.fg || ''));
    const vars = { '--bg': c.bg, '--card': c.bg, '--text': c.fg, '--muted': c.muted, '--line': c.line,
      '--fab-ring': m ? 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',0.3)' : c.line };
    for (const k of Object.keys(vars)) if (vars[k]) host.style.setProperty(k, vars[k]);
  }
  if (ARTICLE_GEAR) window.addEventListener('jread:chrome', refreshInfoFab);
  document.documentElement.appendChild(host);

  // ─── 選單動作（長按彈出，spec 點 7）──────────────────────────────────────
  // v0.8.166：長按選單移除「送到 Readwise Reader」項——content script 直送（v0.8.165）
  // 在 iOS 雖可送達但 toast 視覺提示不顯示（Jimmy 2026-06-23 實機），無回饋的一鍵
  // 送出體感不確定。Readwise 送出改走唯一可靠且有狀態回饋的入口：長按選單最下方
  // 「功能選單」叫出工具列圖示選單（popup），使用者在 popup 按「送到 Readwise Reader」
  // 送出（popup 是 extension 頁、直接 fetch 在 iOS 可靠，且有「送出中…/已送到…」
  // 狀態文字回饋）。

  // 切換分頁模式：翻轉 storage.sync.pagedMode；閱讀模式啟動時 content 端
  // onChanged → reapply 即時生效，未啟動時下次進閱讀模式生效（與 popup 切換
  // 同一份事實）。本地動作、不依賴 SW。
  // v1.6.28：讀改寫串進 promise 佇列（TOCTOU 修法）——舊寫法「讀目前值 → 寫
  // 相反值」兩段非同步之間有時間差，快速連點時第二下的讀搶在第一下的寫落地
  // 前執行，兩下讀到同一舊值、寫入同一新值＝第二下看起來沒反應。佇列讓每次
  // toggle 的讀保證等前一次的寫完成，連點 N 下＝正確翻轉 N 次。單次失敗
  // （reject）由尾端 catch 吞掉、佇列回到 resolved 態，不會卡死後續點擊。
  let togglePagedQueue = Promise.resolve();
  function togglePaged() {
    // v0.8.164：browser.storage.sync get/set 原生 Promise（reject 即 no-op）。
    try {
      togglePagedQueue = togglePagedQueue.then(() => {
        // v1.9.14：讀有效值（套用中設定檔的快照 / 草稿會蓋過 sync flat）、寫入經
        // PROFILES.writeLayout 分流（套用中 → local 草稿；自訂 → sync）
        const def = { pagedMode: SETTINGS_DEF.pagedMode ?? false };
        const read = PROFILES ? PROFILES.readEffective(def) : browser.storage.sync.get(def);
        return read.then((s) => {
          const next = !(s && s.pagedMode);
          const patch = { pagedMode: next };
          const write = PROFILES ? PROFILES.writeLayout(patch) : browser.storage.sync.set(patch);
          return write.then(() => {
            if (NS.toast) NS.toast.show('分頁模式：' + (next ? '開' : '關'), { kind: 'info' });
          });
        });
      }).catch(() => {});
    } catch (_e) {}
  }

  // v1.0.23：進入 Reader——開 reader/reader.html（Readwise inbox feed）。content
  // script 無 tabs 權限，交 SW 開新分頁（與 popup「進入 Reader」按鈕同一目標頁）。
  // iOS SW 被回收時訊息可能掉包（與「功能選單」同款限制）——popup 按鈕仍是可靠入口。
  function openReader() {
    NS.safeSendMessage({ type: NS.MSG.OPEN_READER });
  }

  function isAppRuntime() {
    return !!(NS.isAppRuntime && NS.isAppRuntime());
  }
  // v2.6.0：沒有 background 的 host（App 內建 JReader / 網頁版，NS.isHostedRuntime）
  function isHostedRuntime() {
    return !!(NS.isHostedRuntime ? NS.isHostedRuntime() : isAppRuntime());
  }

  function backToFeed() {
    if (typeof NS.onReaderExit === 'function') { try { NS.onReaderExit(); } catch (_e) {} return; }
    try { location.href = browser.runtime.getURL('reader/reader.html'); } catch (_e) {}
  }

  // ─── 送到儲存服務（v1.7.79，Jimmy 2026-08-20 需求回歸）────────────────────
  // 兩條 path，依 runtime 分流（與 v0.8.165 同款）：
  //   - Safari（iOS / iPadOS / macOS）：content script 直送（NS.sendCurrentPageToService，
  //     main.js）。iOS Safari 的 SW 背景 fetch 不可靠，content script 在前景分頁不會
  //     被掛起、且帶 host_permissions 的跨來源 fetch 權限，可靠送達；進度與結果
  //     toast 由該函式自行接手。
  //   - Chrome / Firefox：content fetch 受頁面來源 CORS 擋，轉 SW
  //     sendToReadwiseFromCommand（與快速鍵送出同一條，Chrome SW 可靠），SW 端顯示
  //     進度 / 結果 toast。
  // 兩軌都在點下當刻先彈一則「送出中…」（同 SAVE_PROGRESS_TOAST_ID，後續訊息取代
  // 同一則、不疊成一排）——SW 軌在 iOS 掛起時連結果都回不來，至少讓使用者知道有按到。
  function sendToService() {
    const P = (typeof window !== 'undefined' && window.__JReadPopup) || null;
    if (NS.toast) {
      NS.toast.show(P ? P.SAVE_PROGRESS.sending : '送出中…', {
        kind: 'info',
        id: P ? P.SAVE_PROGRESS_TOAST_ID : 'jread-save',
        duration: P ? P.SAVE_PROGRESS_TOAST_MS : 15000
      });
    }
    if (isSafariRuntime() && typeof NS.sendCurrentPageToService === 'function') {
      try { NS.sendCurrentPageToService(); } catch (_e) {}
      return;
    }
    NS.safeSendMessage({ type: NS.MSG.CUSTOM_COMMAND, payload: { command: 'send-to-readwise' } });
  }

  // 當前儲存服務的顯示名（'Readwise Reader' / 'Instapaper'）——選單標籤用。
  // storage.sync.storageService 於初始化讀入、onChanged 即時更新（比照 popup 的
  // 送出按鈕標籤，服務名不寫死）。popup-core 未載入時退回 Readwise 字面（該情境
  // 送出本來就會走 SW 軌）。
  let serviceLabelText = 'Readwise Reader';
  // v3.1.0：目前儲存服務是否提供擴充內的 Reader（JReader 使用者不提供，popup-core.supportsExtensionReader）
  let extensionReader = true;
  function applyJreaderUrl(v) { jreaderUrlRaw = typeof v === 'string' ? v : ''; }
  function applyStorageService(v) {
    serviceRaw = typeof v === 'string' ? v : null;
    const P = (typeof window !== 'undefined' && window.__JReadPopup) || null;
    extensionReader = P && typeof P.supportsExtensionReader === 'function' ? P.supportsExtensionReader(v) : true;
    serviceLabelText = P && typeof P.serviceLabel === 'function'
      ? P.serviceLabel(P.normalizeStorageService(v))
      : (v === 'instapaper' ? 'Instapaper' : 'Readwise Reader');
  }

  // 一般頁選單列（每次長按重建 → 服務名跟著設定即時反映）。
  // 「送到 …」不做憑證 gate（popup 的送出按鈕沒憑證時整顆隱藏，那是常駐面板的
  // 減噪考量）——長按選單是暫現的，缺憑證時直接送出並由 toast 說「尚未設定 …
  // 憑證，請到設定頁填入」比「選項神秘消失」好懂。
  // v3.1.0：Article View 掛了文章資訊面板（reader-info.js 設 NS.onReaderInfo）才列這一項
  // ─── 選單圖示（v3.3.0）─────────────────────────────────────────────────
  // 每個圖示是 [標籤, 屬性] 清單，用 createElementNS 組（不走 innerHTML：Trusted Types 站會擋）。
  // 'dot' class 的元素實心填色（清單的圓點、資訊的 i 點）
  const MENU_ICONS = {
    list: [['path', { d: 'M9 6h11M9 12h11M9 18h11' }], ['circle', { cx: 4.5, cy: 6, r: 1.3, class: 'dot' }],
      ['circle', { cx: 4.5, cy: 12, r: 1.3, class: 'dot' }], ['circle', { cx: 4.5, cy: 18, r: 1.3, class: 'dot' }]],
    book: [['path', { d: 'M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3z' }], ['path', { d: 'M21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z' }]],
    info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 11v5.5' }], ['circle', { cx: 12, cy: 7.8, r: 1.2, class: 'dot' }]],
    send: [['path', { d: 'M12 15V4M7.5 8.5L12 4l4.5 4.5' }], ['path', { d: 'M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5' }]],
    sliders: [['path', { d: 'M4 7h9M18 7h2M4 17h3M12 17h8' }], ['circle', { cx: 15.5, cy: 7, r: 2.5 }], ['circle', { cx: 9.5, cy: 17, r: 2.5 }]],
    gear: [['path', { d: 'M19.06 10.57 L21.42 10.77 L21.42 13.23 L19.06 13.43 L18.00 15.98 L19.53 17.79 L17.79 19.53 L15.98 18.00 L13.43 19.06 L13.23 21.42 L10.77 21.42 L10.57 19.06 L8.02 18.00 L6.21 19.53 L4.47 17.79 L6.00 15.98 L4.94 13.43 L2.58 13.23 L2.58 10.77 L4.94 10.57 L6.00 8.02 L4.47 6.21 L6.21 4.47 L8.02 6.00 L10.57 4.94 L10.77 2.58 L13.23 2.58 L13.43 4.94 L15.98 6.00 L17.79 4.47 L19.53 6.21 L18.00 8.02Z' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
    layers: [['path', { d: 'M12 4l9 5-9 5-9-5z' }], ['path', { d: 'M3 14l9 5 9-5' }]],
    check: [['path', { d: 'M5 12.5l4.5 4.5L19 7' }]],
    screen: [['rect', { x: 3, y: 5, width: 18, height: 12, rx: 2 }], ['path', { d: 'M8 21h8M12 17v4' }]],
    expand: [['path', { d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' }]],
    // v3.4.0：重新抓取（順時針箭頭繞圈，與其他圖示同 24 格線條）
    refresh: [['path', { d: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3' }], ['path', { d: 'M19.5 4v4h-4' }]],
    // v3.5.0：JReader 總覽（四格儀表板）
    // v3.7.0：一般網站的 J（Georgia 粗體，同 App 圖示；第三個元素是文字內容）
    jread: [['text', { x: 12.4, y: 20, 'text-anchor': 'middle', 'font-family': 'Georgia, "Times New Roman", serif', 'font-weight': 700, 'font-size': 24 }, 'J']],
    dashboard: [['rect', { x: 4, y: 4, width: 7, height: 9, rx: 1.5 }], ['rect', { x: 13, y: 4, width: 7, height: 5, rx: 1.5 }],
      ['rect', { x: 13, y: 11, width: 7, height: 9, rx: 1.5 }], ['rect', { x: 4, y: 15, width: 7, height: 5, rx: 1.5 }]]
  };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function buildIcon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const [tag, attrs, text] of MENU_ICONS[name] || []) {
      const el = document.createElementNS(SVG_NS, tag);
      for (const k of Object.keys(attrs)) el.setAttribute(k, String(attrs[k]));
      if (text) el.textContent = text;
      svg.appendChild(el);
    }
    return svg;
  }
  if (GEAR) { btn.textContent = ''; btn.appendChild(buildIcon('gear')); }
  if (SITE_FAB) { btn.textContent = ''; btn.appendChild(buildIcon('jread')); }
  if (infoBtn) infoBtn.appendChild(buildIcon('info'));
  if (backBtn) backBtn.appendChild(buildIcon('list'));

  // v3.4.0：Article View（reader-article.js 設 NS.onReaderRefetch）多一項「重新抓取文章」，
  // 排在「文章資訊」後面；所有儲存服務都有、App / 網頁版也有（公開分享頁不掛 hook）
  function infoMenuItems() {
    const items = [];
    if (typeof NS.onReaderInfo === 'function' && !INFO_FAB) {   // v3.5.1：網頁版在右上角圓鈕
      items.push({ id: 'info', icon: 'info', label: '文章資訊', action: () => { try { NS.onReaderInfo(); } catch (_e) {} } });
    }
    if (typeof NS.onReaderRefetch === 'function') {
      items.push({ id: 'refetch', icon: 'refresh', label: '重新抓取文章', action: () => { try { NS.onReaderRefetch(); } catch (_e) {} } });
    }
    return items;
  }

  function generalMenuItems() {
    if (FEED_PAGE) return [];   // v3.4.5：App 列表頁只有分隔線下的「功能選單」「設定」
    // v2.2.0：iOS App 內建 JReader（NS.isAppRuntime）沒有 background——文章本來就來自
    // 儲存服務、不必再送；「進入 Reader」換成回文章列表（與 ESC 同一個 NS.onReaderExit；v3.2.6 起 App 短按改開選單）
    // v2.6.0：網頁版（NS.isWebRuntime，同樣沒有 background）比照 App。公開分享頁（Article
    // View 唯讀模式）沒給離開網址時沒有文章列表可回（NS.state.readerNoExit），不列那一項。
    // v3.5.0：擴充的 Reader 文章頁（齒輪模式）也用這份——文章來自儲存服務，「送到…」「進入 Reader」沒有意義
    if (isAppRuntime() || isHostedRuntime() || GEAR) {
      // v3.3.0：「回到文章列表」排第一，與 App 一致
      const items = [];
      if (!(NS.state && NS.state.readerNoExit)) {
        items.push({ id: 'reader', icon: 'list', label: '回到文章列表', action: backToFeed });
      }
      items.push({ id: 'paged', icon: 'book', label: '切換分頁模式', action: togglePaged });
      return items.concat(infoMenuItems(), profileMenuItems());
    }
    return [
      { id: 'save', icon: 'send', label: '送到 ' + serviceLabelText, action: sendToService },
      { id: 'paged', icon: 'book', label: '切換分頁模式', action: togglePaged },
      // v3.1.0：JReader 使用者不列（改用網頁版，popup-core.supportsExtensionReader）
      ...(extensionReader ? [{ id: 'reader', icon: 'list', label: '進入 Reader', action: openReader }] : [])
    ].concat(infoMenuItems(), profileMenuItems());
  }

  // ─── 設定檔切換（v1.9.0；v1.9.14 改每台裝置各自套用）────────────────────
  // popup 存的設定檔（storage.sync.profiles）每組一列「設定檔：<名稱>」，這台裝置
  // 套用中的那組 icon 換成 ✓。清單（sync）、本機套用狀態（storage.local
  // profileState）與舊欄位 sync.activeProfile（本機從未選過時的初值）於初始化
  // 讀入、onChanged 即時更新（選單每次長按重建，標籤永遠反映當下）。沒有設定檔時
  // 不多任何列。套用 = 讀最新清單（不信快取，popup 可能剛改過）→ 只寫 local
  // profileState（草稿清空；不碰 sync，其他裝置不受影響）→ content 端 onChanged
  // reapply（與 popup 套用同一份事實）。純 content 本地動作、不依賴 SW。YouTube
  // watch 專屬選單不列（無主文可套版面）。
  const PROFILES = (typeof window !== 'undefined' && window.__JReadProfiles) || null;
  let profilesCache = [];
  let legacyActiveCache = null;   // sync.activeProfile（v1.9.13 以前的欄位）
  let profileStateCache;          // storage.local profileState 原始值（undefined = 從未選過）
  function applyProfiles(v) {
    profilesCache = PROFILES ? PROFILES.sanitize(v) : [];
  }
  function applyActiveProfile(v) {
    legacyActiveCache = typeof v === 'string' ? v : null;
  }
  function applyProfileState(v) {
    profileStateCache = v;
  }
  function activeProfileName() {
    if (!PROFILES) return null;
    return PROFILES.resolveState(
      { profiles: profilesCache, activeProfile: legacyActiveCache }, profileStateCache
    ).name;
  }
  function profileMenuItems() {
    const active = activeProfileName();
    return profilesCache.map((p) => ({
      id: 'profile:' + p.name,
      icon: p.name === active ? 'check' : 'layers',
      label: '設定檔：' + p.name,
      action: () => applyProfile(p.name)
    }));
  }
  function applyProfile(name) {
    if (!PROFILES) return;
    try {
      browser.storage.sync.get({ profiles: [] }).then((s) => {
        const p = PROFILES.find(s && s.profiles, name);
        if (!p) {
          if (NS.toast) NS.toast.show('找不到設定檔：' + name, { kind: 'error' });
          return;
        }
        const state = {};
        state[PROFILES.STATE_KEY] = { name: p.name, draft: {} };
        return browser.storage.local.set(state).then(() => {
          if (NS.toast) NS.toast.show('設定檔：' + p.name, { kind: 'info' });
        });
      }).catch(() => {});
    } catch (_e) {}
  }

  // ─── YouTube watch 專屬選單（v1.5.13）────────────────────────────────────
  // 在 YouTube /watch 頁，一般選單的「分頁模式 / 進入 Reader」無意義（YouTube
  // watch 沒主文可閱讀，detector no-op）；改顯示 YouTube 兩功能入口：影院模式 +
  // 無邊模式。判定走 NS.cinema.isYouTubeWatch（cinema-mode.js 載入後即可用）；
  // 該模組尚未載入時用同款 URL fallback——此 fallback 與 cinema-mode.js /
  // youtube-borderless.js 的 isYouTubeWatch 三方互為鏡像（v1.7.43 標記），改
  // 判定時三處必須同步，forcing 見 youtube-watch-detect-mirror.spec.js。
  function isYouTubeWatchPage() {
    try {
      if (NS.cinema && typeof NS.cinema.isYouTubeWatch === 'function') {
        return NS.cinema.isYouTubeWatch();
      }
    } catch (_e) {}
    try {
      const u = new URL(location.href);
      if (!/^(www\.|m\.)?youtube\.com$/.test(u.hostname)) return false;
      return /^\/watch$|^\/live\/[^/]+$/.test(u.pathname);
    } catch (_e) { return false; }
  }

  function cinemaIsOn() {
    return !!(NS.state && NS.state.cinemaActive);
  }
  function borderlessIsOn() {
    return !!(NS.borderless && typeof NS.borderless.isActive === 'function' && NS.borderless.isActive());
  }

  // YouTube 兩功能 toggle：優先呼 main.js 暴露的明確語意 toggle（不走快速鍵跨模式
  // 重導，讓選單標籤與動作一致）；main.js 尚未載入（SPA 注入競態）時退回
  // dispatchLocalCommand（含跨模式重導，仍能切換）。
  function toggleYtCinema() {
    if (typeof NS.toggleYouTubeCinema === 'function') { try { NS.toggleYouTubeCinema(); } catch (_e) {} return; }
    if (typeof NS.dispatchLocalCommand === 'function') NS.dispatchLocalCommand('toggle-reader-mode');
  }
  function toggleYtBorderless() {
    if (typeof NS.toggleYouTubeBorderless === 'function') { try { NS.toggleYouTubeBorderless(); } catch (_e) {} return; }
    if (typeof NS.dispatchLocalCommand === 'function') NS.dispatchLocalCommand('toggle-youtube-borderless');
  }

  // 動態建構 YouTube 選單列（標籤依目前 active 狀態切「啟動 / 關閉」前綴）
  function youtubeMenuItems() {
    return [
      { id: 'yt-cinema', icon: 'screen', label: (cinemaIsOn() ? '關閉' : '啟動') + '影院模式', action: toggleYtCinema },
      { id: 'yt-borderless', icon: 'expand', label: (borderlessIsOn() ? '關閉' : '啟動') + '無邊模式', action: toggleYtBorderless }
    ];
  }

  // ─── 功能選單入口（v0.8.162，比照 Shinkansen content-floating-icon.js）──────
  // 長按選單最下方「功能選單」叫出工具列圖示選單（popup）當頁內浮層。兩條 path：
  //   - Safari（macOS / iOS）：不能在 https 網頁裡用 iframe 載入擴充頁
  //     （safari-web-extension:// 在 https 頁的 iframe 是 Safari 已知限制，iOS 上
  //     會整頁 refresh）→ 交給 background 開原生工具列 popup（chrome.action.openPopup，
  //     Safari 16+ 支援），失敗則 background 退而開新分頁載入 popup.html。
  //   - 非 Safari（Chrome / Firefox）：頁內 iframe 浮層載 popup.html?panel=1，維持
  //     單一資料源（popup 邏輯不複製一份）。iframe 在當前分頁內、popup 的
  //     chrome.tabs.query({active:true}) 仍取得底層內容頁，分頁耦合不斷。
  // runtime 偵測依 getURL scheme，非 OS flag。2026-10-07 review C-18(b)：實作上提
  // NS.isSafariRuntime（namespace.js 單一資料源，keepalive / main.js 同用），本檔
  // 保留同名 wrapper 給既有呼叫端與 NS.floating 匯出。
  function isSafariRuntime() {
    return !!(NS.isSafariRuntime && NS.isSafariRuntime());
  }

  function openFeaturePanel() {
    if (isSafariRuntime()) {
      NS.safeSendMessage({ type: NS.MSG.OPEN_FEATURE_MENU });
      return;
    }
    openFeaturePanelIframe();
  }

  const PANEL_CSS = `
    :host, * { box-sizing: border-box; }
    .backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,.4);
      display: flex; align-items: flex-start; justify-content: center;
      padding: 24px 16px;
      overflow: auto;
      -webkit-tap-highlight-color: transparent;
    }
    .frame {
      border: none;
      width: min(94vw, 360px);
      height: min(86vh, 640px);
      max-height: 86vh;
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 18px 56px rgba(0,0,0,.4);
      overflow: hidden;
    }
  `;

  let panelHost = null, panelFrame = null, panelMsgHandler = null, panelKeyHandler = null;

  function closeFeaturePanel() {
    if (!panelHost) return;
    try { panelHost.remove(); } catch (_e) {}
    panelHost = null;
    panelFrame = null;
    if (panelMsgHandler) { window.removeEventListener('message', panelMsgHandler); panelMsgHandler = null; }
    if (panelKeyHandler) { window.removeEventListener('keydown', panelKeyHandler, true); panelKeyHandler = null; }
  }

  function openFeaturePanelIframe() {
    if (panelHost) return;   // 已開著不重複開
    let popupUrl = '';
    // v3.7.0：從列表頁打開帶 page=feed（功能選單多顯示「列表字級 / 標題行數 / 摘要行數」）
    try { popupUrl = browser.runtime.getURL('popup/popup.html') + '?panel=1' + (FEED_PAGE ? '&page=feed' : ''); } catch (_e) { return; }
    // v1.7.44（X2）：先向 SW 登記本 tab 合法開啟浮層——popup(?panel=1) 載入時
    // 憑 sender.tab 向 SW 驗證（單次有效 + 30s TTL）。任意網站自行 iframe 嵌
    // popup.html?panel=1 沒有這筆登記 → 握手失敗 → popup 互動 no-op（clickjacking
    // 防線；登記走擴充訊息通道，頁面 JS 無法偽造）
    try { browser.runtime.sendMessage({ type: NS.MSG.PANEL_OPENED }).catch(() => {}); } catch (_e) {}
    let pHost, pShadow;
    try {
      pHost = document.createElement('div');
      pHost.id = '__jread-panel-host';
      pHost.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483640;';
      pShadow = pHost.attachShadow({ mode: 'open' });
    } catch (_e) { return; }
    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    const frame = document.createElement('iframe');
    frame.className = 'frame';
    frame.setAttribute('title', 'JRead');
    frame.src = popupUrl;
    // v2.2.15：先隱形、等 popup 回報第一次內容尺寸收緊後才顯示。iOS WebKit 先以預設高度
    // （min(86vh, 640px)）畫出 iframe、縮到內容高度後，舊範圍底部殘留一塊白色沒重繪
    // （Jimmy 2026-10-29 回報 App 功能選單下方多一塊白；模擬器重現）。回報沒來（舊版 popup
    // / 訊息失敗）時保底顯示，不讓選單打不開
    frame.style.visibility = 'hidden';
    const revealFrame = () => { frame.style.visibility = ''; };
    setTimeout(revealFrame, 1000);
    backdrop.appendChild(frame);
    // 點浮層外圍（backdrop 本體、非 iframe）→ 收
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) closeFeaturePanel();
    });
    // CSP-safe：嚴格 style-src 站用 adoptedStyleSheets，比照 NS.injectShadowCss
    NS.injectShadowCss(pShadow, PANEL_CSS);
    pShadow.appendChild(backdrop);
    document.documentElement.appendChild(pHost);
    panelHost = pHost;
    panelFrame = frame;
    // popup.js（?panel=1）postMessage（驗 source 為本 iframe）：
    //   jread-close-panel → 收浮層；jread-panel-size → 依 popup 內容高/寬收緊 iframe。
    panelMsgHandler = (ev) => {
      if (!panelFrame || ev.source !== panelFrame.contentWindow || !ev.data) return;
      if (ev.data.type === 'jread-close-panel') {
        closeFeaturePanel();
      } else if (ev.data.type === 'jread-panel-size') {
        if (typeof ev.data.height === 'number') {
          const capH = Math.round(window.innerHeight * 0.86);
          panelFrame.style.height = Math.max(200, Math.min(ev.data.height, capH)) + 'px';
        }
        if (typeof ev.data.width === 'number' && ev.data.width > 0) {
          const capW = Math.round(window.innerWidth * 0.94);
          panelFrame.style.width = Math.max(240, Math.min(ev.data.width, capW)) + 'px';
        }
        revealFrame();
      }
    };
    window.addEventListener('message', panelMsgHandler);
    panelKeyHandler = (ev) => { if (ev.key === 'Escape') closeFeaturePanel(); };
    window.addEventListener('keydown', panelKeyHandler, true);
  }

  // ─── App 設定頁浮層（v3.3.0）────────────────────────────────────────────
  // 全螢幕 sheet：頂端標題列＋「完成」、下方 iframe 載 options.html（擴充同一份設定頁，App 不適用
  // 的區塊由 options 頁依 runtime 隱藏）。文章不離開；設定頁寫 storage 後 shim 跨 frame 廣播
  // onChanged，文章頁即時重套、並經 App Group 同步回 Safari 擴充
  const SETTINGS_CSS = `
    :host, * { box-sizing: border-box; }
    .sheet {
      position: fixed; inset: 0;
      display: flex; flex-direction: column;
      background: #f5f5f7;
      padding-bottom: var(--__jread-app-safe-bottom, 0px);
      animation: jr-sheet-in .22s ease-out;
    }
    .bar {
      flex: 0 0 auto;
      display: flex; align-items: center; justify-content: center;
      position: relative;
      height: 48px;
      padding-top: env(safe-area-inset-top, 0px);
      box-sizing: content-box;
      background: #f5f5f7;
      border-bottom: 1px solid #e5e5ea;
      font: 600 16px -apple-system, "PingFang TC", sans-serif;
      color: #1d1d1f;
    }
    .done {
      position: absolute; right: 8px; bottom: 6px;
      height: 36px; padding: 0 12px;
      border: none; background: none;
      font: 600 16px -apple-system, "PingFang TC", sans-serif;
      color: #0071e3;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .frame { flex: 1 1 auto; width: 100%; border: none; background: #fff; }
    @keyframes jr-sheet-in { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
    @media (prefers-color-scheme: dark) {
      .sheet, .bar { background: #1c1c1e; }
      .bar { color: #f5f5f7; border-bottom-color: #38383a; }
      .done { color: #0a84ff; }
      .frame { background: #1c1c1e; }
    }
    @media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }
  `;
  let settingsHost = null, settingsKeyHandler = null;
  function closeSettingsSheet() {
    if (!settingsHost) return;
    try { settingsHost.remove(); } catch (_e) {}
    settingsHost = null;
    if (settingsKeyHandler) { window.removeEventListener('keydown', settingsKeyHandler, true); settingsKeyHandler = null; }
  }
  function openSettingsSheet() {
    if (settingsHost) return;
    let url = '';
    try { url = browser.runtime.getURL('options/options.html'); } catch (_e) { return; }
    let sHost, sShadow;
    try {
      sHost = document.createElement('div');
      sHost.id = '__jread-settings-host';
      sHost.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483641;';
      sShadow = sHost.attachShadow({ mode: 'open' });
    } catch (_e) { return; }
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', '設定');
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.textContent = '設定';
    const done = document.createElement('button');
    done.className = 'done';
    done.type = 'button';
    done.textContent = '完成';
    done.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeSettingsSheet(); });
    bar.appendChild(done);
    const frame = document.createElement('iframe');
    frame.className = 'frame';
    frame.setAttribute('title', '設定');
    frame.src = url;
    sheet.appendChild(bar);
    sheet.appendChild(frame);
    NS.injectShadowCss(sShadow, SETTINGS_CSS);
    sShadow.appendChild(sheet);
    document.documentElement.appendChild(sHost);
    settingsHost = sHost;
    settingsKeyHandler = (ev) => { if (ev.key === 'Escape') closeSettingsSheet(); };
    window.addEventListener('keydown', settingsKeyHandler, true);
  }

  // ─── JReader 總覽（v3.5.0）──────────────────────────────────────────────
  // Jimmy 2026-11-26：從 JReader 的介面進入 dashboard（JReader 伺服器 /dashboard，每個帳號看自己的）。
  // 儲存服務是 JReader、網址合法才列。網頁版與擴充開新分頁（v3.5.1 起網頁版也是）；App 的 window.open
  // 由 ViewController 交給 Safari 開（http(s) 一律 openExternally）。dashboard 在 Cloudflare Access 後面，
  // 擴充與 App 第一次開要在瀏覽器登入（token 進不了網頁）
  let serviceRaw = null;
  let jreaderUrlRaw = '';
  function dashboardUrl() {
    const P = (typeof window !== 'undefined' && window.__JReadPopup) || null;
    const service = P && typeof P.normalizeStorageService === 'function' ? P.normalizeStorageService(serviceRaw) : serviceRaw;
    if (service !== 'jreader') return null;
    const base = P && typeof P.normalizeApiBase === 'function' ? P.normalizeApiBase(jreaderUrlRaw) : '';
    return base ? base + '/dashboard' : null;
  }
  function openDashboard() {
    const url = dashboardUrl();
    if (!url) return;
    // v3.5.1：網頁版也開新分頁（Jimmy 2026-11-26「點 JReader 總覽時，請用新標籤頁開啟」；原本同分頁）
    try { window.open(url, '_blank', 'noopener'); } catch (_e) {}
  }

  // ─── 設定狀態 ───────────────────────────────────────────────────────────
  let pos = { edge: 'left', offsetY: 1 };     // 預設左下角（v0.8.160，offsetY=1=底）

  // disable → 重新 enable 時按鈕回到預設位置（v0.8.161）：使用者把按鈕拖到不順手的角落後，
  // 關掉再開即重置。初始載入（lastEnabled = null）不重置，尊重 storage 存的位置。
  let lastEnabled = null;
  function applyEnabled(enabled) {
    // v3.3.0：iOS App 內一律顯示——J 圖示是 App 裡設定頁、切換分頁模式、文章資訊的唯一入口，
    // 而 floatingIcon 會從 Safari 擴充同步過來：在 Safari 為一般網站關掉懸浮按鈕，不能讓 App
    // 的入口跟著消失（App 設定頁也不顯示這個開關）
    if (isAppRuntime()) enabled = true;
    // v3.5.0：齒輪是 JRead 閱讀頁的選單入口，不受一般網站懸浮按鈕的開關影響
    if (GEAR) enabled = true;
    if (lastEnabled === false && enabled === true) {
      applyPos(null);     // sanitizePos(null) → 預設左下角
      persistPos();
    }
    lastEnabled = enabled;
    const show = enabled && !feedBottomBusy();
    host.style.display = show ? 'block' : 'none';
    if (!show) closeMenu();
  }

  // v3.4.5：App 列表頁的底部被搜尋工具列（body.jr-tools-open，reader-library.js）或多選動作列
  //（body.jr-selecting，reader-select.js）佔用時先藏起來——J 圖示固定左下角，會壓在搜尋框上
  //（模擬器實測）。工具列收起就回來
  const FEED_BUSY_CLASSES = ['jr-tools-open', 'jr-selecting'];
  function feedBottomBusy() {
    if (!FEED_PAGE || !document.body) return false;
    return FEED_BUSY_CLASSES.some((c) => document.body.classList.contains(c));
  }
  if (FEED_PAGE) {
    const watchBody = () => {
      try {
        new MutationObserver(() => { if (lastEnabled !== null) applyEnabled(lastEnabled); })
          .observe(document.body, { attributes: true, attributeFilter: ['class'] });
      } catch (_e) {}
    };
    if (document.body) watchBody();
    else document.addEventListener('DOMContentLoaded', watchBody, { once: true });
  }

  function applyOpacity(v) {
    const o = typeof v === 'number' ? v : DEFAULT_OPACITY;
    // v3.5.0：齒輪自己有淡化樣式（.fab.gear opacity .7），host 不再疊一層使用者設的透明度
    // v3.7.0：一般網站的 J 也是齒輪樣式，透明度設定拿掉
    currentOpacity = (GEAR || SITE_FAB) ? 1 : Math.max(0.1, Math.min(1, o));
    // 選單開著時 host 維持全不透明（見 openMenu）；新設定值記在 currentOpacity，
    // 等 closeMenu 還原。沒開選單時直接套用。
    if (!menuOpen) host.style.opacity = String(currentOpacity);
  }

  // 尺寸切換：寫 CSS 變數（視覺即時生效）+ 同步 hitSize（貼邊 / 拖移夾擠用），
  // 再依新 footprint 重貼一次（offsetY 比例對 vh−hit 重算）。合法值（small/medium/large）
  // 取對應，其餘（含未設過 / 非法值）退回**預設 medium**（v0.8.166，與 settings-defaults
  // 的 floatingIconSize 預設一致）。
  function applySize(v) {
    const s = GEAR ? { hit: GEAR_HIT, icon: GEAR_ICON }
      : SITE_FAB ? (SITE_SIZE_MAP[v] || SITE_SIZE_MAP.medium)
        : (SIZE_MAP[v] || SIZE_MAP.medium);
    hitSize = s.hit;
    host.style.setProperty('--fab-hit', s.hit + 'px');
    host.style.setProperty('--fab-icon', s.icon + 'px');
    applyPos(pos);
  }

  function appSafeBottom() {
    try {
      const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--__jread-app-safe-bottom'));
      return v > 0 ? v : 0;
    } catch (_e) { return 0; }
  }

  function sanitizePos(p) {
    const edge = (p && (p.edge === 'left' || p.edge === 'right')) ? p.edge : 'left';
    // 預設左下角（v0.8.160）：未設過 / 非法值一律退回 offsetY=1（底）
    let offsetY = p && typeof p.offsetY === 'number' ? p.offsetY : 1;
    if (!(offsetY >= 0 && offsetY <= 1)) offsetY = 1;
    return { edge, offsetY };
  }

  // iPadOS：把 top 夾到「按鈕 hit 區不碰上下角落 OS 保留區」範圍，避免停進 iPadOS 視窗
  // 縮放把手 / 系統手勢角落而再也拖不出來。純函式（吃 viewportH / hit / ipad）方便
  // regression 直接驗，不依賴實機平台。非 iPadOS（iPhone / 桌面）只夾在可視範圍、不留角落間距。
  function cornerClampTop(top, viewportH, hit, ipad) {
    const maxFree = Math.max(0, viewportH - hit);          // 不夾角落時 top 的合法上限
    if (!ipad) return Math.max(0, Math.min(maxFree, top));
    const minTop = CORNER_DEADZONE_PX;                     // 離頂部角落安全距
    const maxTop = viewportH - hit - CORNER_DEADZONE_PX;   // 離底部角落安全距
    // 視窗太矮（maxTop < minTop）夾不出安全區 → 置中，至少不卡在角落極端
    if (maxTop < minTop) return Math.max(0, Math.min(maxFree, Math.round(maxFree / 2)));
    return Math.max(minTop, Math.min(maxTop, top));
  }

  // 依 pos 把 host 貼到邊緣（offsetY 比例 → top px）
  // v3.5.0 齒輪：固定左下角，跟搜尋圓鈕左右對稱——列表頁對齊卡片欄左緣（同 .jr-fab 的
  // right: max(20px, calc(50% − 320px))）、離底 20px＋底部安全區域（列表頁 --jr-safe-bottom；
  // 文章頁取 env() 與 App 傳來的 --__jread-app-safe-bottom 較大者）。用 CSS 定位，視窗縮放自己跟著
  // v3.5.2：文章頁圓鈕離邊距離（見 ARTICLE_FAB_EDGE_FINE 註解）。回傳 { side, bottom, top }（px 數字）
  function articleFabEdges() {
    if (APP_PAGE) return { side: APP_FAB_SIDE, bottom: GEAR_ARTICLE_BOTTOM, top: GEAR_ARTICLE_BOTTOM };
    let coarse = false;
    try { coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (_e) { coarse = false; }
    const e = coarse ? GEAR_ARTICLE_BOTTOM : ARTICLE_FAB_EDGE_FINE;
    return { side: e, bottom: e, top: e };
  }
  // v3.6.7：列表頁的齒輪（左下）與搜尋圓鈕（右下）在視窗夠寬時貼螢幕角落、離邊距離比照文章頁（articleFabEdges）
  //（Jimmy 2026-11-26「如果瀏覽器空間足夠，請將齒輪和搜尋兩個按鈕擺到螢幕下方左右角落，比照文章閱讀的按鈕安排」）。
  // 「夠寬」＝卡片欄（640 置中）兩側各放得下一顆圓鈕＋間隔：(寬 − 640) / 2 ≥ 圓鈕 36＋邊距＋留白 → 取 760。
  // 不夠寬維持 v3.5.0：對齊卡片欄左右緣、離底 20px。搜尋圓鈕（reader-library.js）讀這支，兩顆同一份判斷
  const FEED_CORNER_MIN_WIDTH = 760;
  function feedFabPos() {
    const w = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;
    if (w < FEED_CORNER_MIN_WIDTH) return { corner: false, side: null, bottom: null };
    const ed = articleFabEdges();
    return { corner: true, side: ed.side, bottom: ed.bottom };
  }
  const SAFE_BOTTOM_CSS = 'max(env(safe-area-inset-bottom, 0px), var(--__jread-app-safe-bottom, 0px))';
  const SAFE_TOP_CSS = 'env(safe-area-inset-top, 0px)';
  function applyGearPos() {
    pos = { edge: 'left', offsetY: 1 };
    host.style.top = 'auto';
    host.style.right = 'auto';
    if (FEED_PAGE) {
      const fp = feedFabPos();
      host.style.left = fp.corner ? fp.side + 'px' : 'max(20px, calc(50% - 320px))';
      host.style.bottom = fp.corner ? `calc(${fp.bottom}px + var(--jr-safe-bottom, 0px))` : 'calc(20px + var(--jr-safe-bottom, 0px))';
    } else {
      const ed = articleFabEdges();
      host.style.left = ed.side + 'px';
      host.style.bottom = `calc(${ed.bottom}px + ${SAFE_BOTTOM_CSS})`;
      // 文章資訊：App 右下角（跟齒輪同一條底線），網頁版右上角；回到列表：左上角
      if (infoBtn) {
        const st = infoBtn.style;
        st.right = ed.side + 'px';
        st.left = 'auto';
        if (APP_PAGE) { st.top = 'auto'; st.bottom = `calc(${ed.bottom}px + ${SAFE_BOTTOM_CSS})`; } else { st.bottom = 'auto'; st.top = `calc(${ed.top}px + ${SAFE_TOP_CSS})`; }
      }
      if (backBtn) {
        const st = backBtn.style;
        st.left = ed.side + 'px';
        st.right = 'auto';
        st.bottom = 'auto';
        st.top = `calc(${ed.top}px + ${SAFE_TOP_CSS})`;
      }
    }
    menuEl.classList.add('side-left');
    menuEl.classList.remove('side-right');
  }

  function applyPos(p) {
    if (GEAR || SITE_FAB) { applyGearPos(); return; }   // v3.7.0：一般網站的 J 也固定左下角
    pos = FEED_PAGE ? sanitizePos(null) : sanitizePos(p);   // v3.4.5：列表頁固定左下角
    const vh = window.innerHeight || 0;
    // v3.4.5：App 列表頁避開底部安全區域（Home 指示條；App 的 WebView 畫到螢幕底，
    // ViewController 把高度經 shim 寫成 --__jread-app-safe-bottom）
    const safeBottom = FEED_PAGE ? appSafeBottom() : 0;
    const rawTop = Math.round(pos.offsetY * Math.max(0, vh - hitSize - safeBottom));
    const top = cornerClampTop(rawTop, vh, hitSize, isIPadOS);
    host.style.top = top + 'px';
    host.style.bottom = 'auto';
    if (pos.edge === 'left') {
      host.style.left = EDGE_MARGIN + 'px';
      host.style.right = 'auto';
    } else {
      host.style.right = EDGE_MARGIN + 'px';
      host.style.left = 'auto';
    }
    menuEl.classList.toggle('side-left', pos.edge === 'left');
    menuEl.classList.toggle('side-right', pos.edge === 'right');
  }

  function persistPos() {
    if (FEED_PAGE || GEAR || SITE_FAB) return;   // v3.4.5：列表頁的固定位置不寫回同步設定；v3.7.0 J 也不能拖、不寫
    try { browser.storage.sync.set({ floatingIconPos: pos }); } catch (_e) {}
  }

  // ─── 長按選單 ───────────────────────────────────────────────────────────
  let menuOpen = false;
  let outsideHandler = null;

  function buildMenu() {
    menuEl.textContent = '';
    // YouTube watch 頁顯示 YouTube 兩功能（影院 / 無邊）；其餘頁顯示一般動作。
    // 每次長按重建 → YouTube 標籤每次都反映當下 active 狀態。
    const items = isYouTubeWatchPage() ? youtubeMenuItems() : generalMenuItems();
    for (const it of items) {
      const item = document.createElement('button');
      item.className = 'menu-item';
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.dataset.action = it.id;
      const ico = document.createElement('span');
      ico.className = 'ico' + (it.icon === 'check' ? ' accent' : '');
      ico.appendChild(buildIcon(it.icon));
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = it.label;
      item.appendChild(ico);
      item.appendChild(label);
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        try { it.action(); } catch (_err) {}
      });
      menuEl.appendChild(item);
    }
    // 分隔線 +「功能選單」：叫出工具列圖示選單（popup）當頁內浮層（v0.8.162）。
    // v2.2.5：App 內 JReader 也列——這是 App 裡唯一能改設定的入口（Jimmy 2026-10-28 回報
    // 「JReader 中無法更改設定」）。App 不是 Safari runtime → 走 iframe 浮層；popup 端在
    // App 內免 SW 握手（popup.js IS_APP，見該處理由）
    if (items.length) {
      const divider = document.createElement('div');
      divider.className = 'menu-divider';
      menuEl.appendChild(divider);
    }
    const featureItem = document.createElement('button');
    featureItem.className = 'menu-item feature';
    featureItem.type = 'button';
    featureItem.setAttribute('role', 'menuitem');
    featureItem.dataset.action = 'feature-menu';
    const fIco = document.createElement('span');
    fIco.className = 'ico';
    fIco.appendChild(buildIcon('sliders'));
    const fLabel = document.createElement('span');
    fLabel.className = 'label';
    fLabel.textContent = '功能選單';
    featureItem.appendChild(fIco);
    featureItem.appendChild(fLabel);
    featureItem.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      try { openFeaturePanel(); } catch (_err) {}
    });
    menuEl.appendChild(featureItem);
    // v3.3.0：App 內加「設定」——完整設定頁（options.html）的唯一入口（Jimmy 2026-11-25
    // 「App 沒有進入設定頁面的路徑」；入口只放這裡，Jimmy 裁定）
    if (isAppRuntime()) {
      const sItem = document.createElement('button');
      sItem.className = 'menu-item settings';
      sItem.type = 'button';
      sItem.setAttribute('role', 'menuitem');
      sItem.dataset.action = 'settings';
      const sIco = document.createElement('span');
      sIco.className = 'ico';
      sIco.appendChild(buildIcon('gear'));
      const sLabel = document.createElement('span');
      sLabel.className = 'label';
      sLabel.textContent = '設定';
      sItem.appendChild(sIco);
      sItem.appendChild(sLabel);
      sItem.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        try { openSettingsSheet(); } catch (_err) {}
      });
      menuEl.appendChild(sItem);
    }
    // v3.5.0：JReader 總覽（只在齒輪＝JRead 閱讀頁，且儲存服務是 JReader 才列；一般網站的 J 不放）
    if (GEAR && dashboardUrl()) {
      const dItem = document.createElement('button');
      dItem.className = 'menu-item dashboard';
      dItem.type = 'button';
      dItem.setAttribute('role', 'menuitem');
      dItem.dataset.action = 'dashboard';
      const dIco = document.createElement('span');
      dIco.className = 'ico';
      dIco.appendChild(buildIcon('dashboard'));
      const dLabel = document.createElement('span');
      dLabel.className = 'label';
      dLabel.textContent = 'JReader 總覽';
      dItem.appendChild(dIco);
      dItem.appendChild(dLabel);
      dItem.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        try { openDashboard(); } catch (_err) {}
      });
      menuEl.appendChild(dItem);
    }
  }

  function openMenu() {
    if (host.style.display === 'none') return;
    refreshInfoFab();
    buildMenu();
    // v1.7.42：依 fab 垂直位置切換選單錨定——上半部（offsetY < 0.5）往下長、
    // 下半部維持 bottom:0 往上長，兩側都不會超出畫面
    menuEl.classList.toggle('anchor-top', pos.offsetY < 0.5);
    menuEl.classList.add('show');
    menuOpen = true;
    if (GEAR || SITE_FAB) btn.setAttribute('aria-expanded', 'true');
    // 選單開著時整顆 host 全不透明，讓選單文字清楚可讀（不受使用者淡透明度影響）
    host.style.opacity = '1';
    outsideHandler = (ev) => {
      const path = ev.composedPath ? ev.composedPath() : [];
      if (path.includes(host)) return;
      closeMenu();
    };
    document.addEventListener('pointerdown', outsideHandler, true);
    window.addEventListener('scroll', closeMenu, { passive: true, capture: true });
  }

  function closeMenu() {
    if (!menuOpen) return;
    menuEl.classList.remove('show');
    menuOpen = false;
    if (GEAR || SITE_FAB) btn.setAttribute('aria-expanded', 'false');
    // 還原使用者設定的透明度（選單期間被調成全不透明）
    host.style.opacity = String(currentOpacity);
    if (outsideHandler) {
      document.removeEventListener('pointerdown', outsideHandler, true);
      outsideHandler = null;
    }
    window.removeEventListener('scroll', closeMenu, true);
  }

  // ─── 短按：切換閱讀模式 ──────────────────────────────────────────────────
  // v3.2.6：iOS App 內建 JReader（isAppRuntime）短按＝開選單（Jimmy 2026-11-25 需求）。
  // App 的文章頁短按原本是「回文章列表」，最常用的是選單裡的設定與切換，回列表另有左緣
  // 右滑、選單裡也有「回到文章列表」。menuWasOpen＝按下前選單已開著 → 這次短按只是收起
  // （pointerdown 已先 closeMenu），不再重開。Safari 擴充與網頁版維持短按切換閱讀模式
  function handleShortPress(menuWasOpen) {
    // v3.5.0：齒輪（JRead 閱讀頁）一律點一下開選單、再點收起
    if (isAppRuntime() || GEAR) {
      if (!menuWasOpen) openMenu();
      return;
    }
    if (typeof NS.dispatchLocalCommand === 'function') {
      NS.dispatchLocalCommand('toggle-reader-mode');
      return;
    }
    // dispatchLocalCommand 缺席（SPA 注入競態）→ fallback 走 SW 路徑
    NS.safeSendMessage({ type: NS.MSG.CUSTOM_COMMAND, payload: { command: 'toggle-reader-mode' } });
  }

  // ─── pointer 狀態機（短按 / 拖移吸附 / 長按）─────────────────────────────
  let press = null;  // { id, startX, startY, timer, moved, longFired, menuWasOpen, dragThreshold }

  function clearPressTimer() {
    if (press && press.timer) { clearTimeout(press.timer); press.timer = null; }
  }

  btn.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;  // 只認主鍵
    e.preventDefault();
    const menuWasOpen = menuOpen;
    closeMenu();
    try { btn.setPointerCapture(e.pointerId); } catch (_e) {}
    press = {
      id: e.pointerId, startX: e.clientX, startY: e.clientY, timer: null, moved: false, longFired: false, menuWasOpen,
      // 觸控（手指）用較寬的拖移門檻；滑鼠 / 觸控筆維持 8px
      dragThreshold: (FEED_PAGE || GEAR || SITE_FAB) ? Infinity   // v3.4.5：列表頁不能拖；v3.5.0 齒輪不能拖；v3.7.0 J 不能拖
        : (e.pointerType === 'touch' ? DRAG_THRESHOLD_TOUCH_PX : DRAG_THRESHOLD_PX)
    };
    press.timer = setTimeout(() => {
      if (!press || press.moved) return;
      press.longFired = true;
      press.timer = null;
      openMenu();
    }, LONGPRESS_MS);
  });

  btn.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    // v1.7.79：長按已觸發（選單開著）→ 手勢**定案為長按**，之後的位移一律忽略，
    // 不再改判成拖移。原本沒有這條 guard：手指還壓在按鈕上時的自然抖動只要超過
    // 門檻就 press.moved = true → closeMenu()，症狀就是 Jimmy 2026-08-20 回報的
    // 「長按選單一抖就消失」。想拖按鈕的人本來就會在長按滿 500ms 之前就開始移動
    // （那條路徑不受影響）；選單已經彈出來之後才移動，語意上絕不是要拖按鈕。
    if (press.longFired) return;
    const dx = e.clientX - press.startX;
    const dy = e.clientY - press.startY;
    if (!press.moved && Math.hypot(dx, dy) > press.dragThreshold) {
      press.moved = true;
      clearPressTimer();
      closeMenu();
      btn.classList.add('dragging');
    }
    if (press.moved) {
      // 自由跟手（拖移期間），放開再吸附
      const half = hitSize / 2;
      const left = Math.max(0, Math.min(window.innerWidth - hitSize, e.clientX - half));
      const top = Math.max(0, Math.min(window.innerHeight - hitSize, e.clientY - half));
      host.style.left = left + 'px';
      host.style.right = 'auto';
      host.style.top = top + 'px';
      host.style.bottom = 'auto';
    }
  });

  function endPress(e) {
    if (!press || e.pointerId !== press.id) return;
    clearPressTimer();
    try { btn.releasePointerCapture(e.pointerId); } catch (_e) {}
    const { moved, longFired, menuWasOpen } = press;
    press = null;
    btn.classList.remove('dragging');
    if (moved) {
      // 吸附最近邊緣：pointer 在視窗左半 → 左緣，右半 → 右緣
      const edge = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
      const offsetY = Math.max(0, Math.min(1,
        (e.clientY - hitSize / 2) / Math.max(1, window.innerHeight - hitSize)));
      applyPos({ edge, offsetY });
      persistPos();
      return;
    }
    if (longFired) return;        // 長按已開選單，放開不再短按
    handleShortPress(menuWasOpen);
  }

  btn.addEventListener('pointerup', endPress);
  btn.addEventListener('pointercancel', (e) => {
    if (!press || e.pointerId !== press.id) return;
    clearPressTimer();
    press = null;
    btn.classList.remove('dragging');
  });

  // 視窗縮放：按既有比例重新貼邊（拖移中不干擾）
  window.addEventListener('resize', () => {
    if (press && press.moved) return;
    applyPos(pos);
  }, { passive: true });

  // ─── 初始化：讀 storage + onChanged 即時生效 ─────────────────────────────
  // v1.7.43 T9：fallback 語意必須與正典 resolveFloatingIconEnabled 一致——
  // 「未設過（非 boolean）一律預設開」（v0.8.158）。舊 fallback `v === true`
  // 語意相反：settings-defaults 缺席時未設過的使用者會看不到懸浮按鈕。
  const RESOLVE = window.__JReadResolveFloatingIconEnabled ||
    ((v) => typeof v === 'boolean' ? v : true);

  // v0.8.164：browser.storage.sync.get 原生 Promise（reject → 全套 undefined fallback，
  // 與舊 lastError 分支同語意）。
  const applyDefaults = () => {
    applySize(undefined); applyOpacity(undefined); applyPos(undefined); applyEnabled(RESOLVE(undefined));
    applyStorageService(undefined); applyJreaderUrl(undefined);
    applyProfiles(undefined); applyActiveProfile(undefined);
  };
  // v1.9.14：本機套用狀態另讀 storage.local（readLocalState 永不 reject）
  if (PROFILES) PROFILES.readLocalState().then(applyProfileState);
  try {
    browser.storage.sync.get(['floatingIcon', 'floatingIconOpacity', 'floatingIconPos', 'floatingIconSize', 'storageService', 'jreaderUrl', 'profiles', 'activeProfile', 'mouseRevealButtons']).then((s) => {
      if (!s) { applyDefaults(); return; }
      applyMouseReveal(s.mouseRevealButtons);
      applySize(s.floatingIconSize);
      applyOpacity(s.floatingIconOpacity);
      applyPos(s.floatingIconPos);
      applyEnabled(RESOLVE(s.floatingIcon));
      applyStorageService(s.storageService);
      applyJreaderUrl(s.jreaderUrl);
      applyProfiles(s.profiles);
      applyActiveProfile(s.activeProfile);
    }).catch(applyDefaults);
  } catch (_e) {
    applyDefaults();
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (PROFILES && changes[PROFILES.STATE_KEY]) applyProfileState(changes[PROFILES.STATE_KEY].newValue);
      return;
    }
    if (area !== 'sync') return;
    if (changes.floatingIcon) applyEnabled(RESOLVE(changes.floatingIcon.newValue));
    if (changes.floatingIconOpacity) applyOpacity(changes.floatingIconOpacity.newValue);
    if (changes.floatingIconPos) applyPos(changes.floatingIconPos.newValue);
    if (changes.floatingIconSize) applySize(changes.floatingIconSize.newValue);
    if (changes.mouseRevealButtons) applyMouseReveal(changes.mouseRevealButtons.newValue);
    if (changes.storageService) applyStorageService(changes.storageService.newValue);
    if (changes.jreaderUrl) applyJreaderUrl(changes.jreaderUrl.newValue);
    if (changes.profiles) applyProfiles(changes.profiles.newValue);
    if (changes.activeProfile) applyActiveProfile(changes.activeProfile.newValue);
  });

  // v3.5.0：列表頁往下捲時淡出齒輪（reader-library.js 的捲動判斷呼叫，與搜尋圓鈕同步）
  function setScrollHidden(v) {
    if (!GEAR) return;
    btn.classList.toggle('is-scroll-hidden', !!v);
    if (v) closeMenu();
  }

  // regression spec（isolated world）用：暴露內部 handler 與狀態
  NS.floating = {
    isGear: GEAR, isSiteFab: SITE_FAB, setScrollHidden, dashboardUrl, openDashboard, applyJreaderUrl,
    infoBtn, backBtn, refreshInfoFab, applyFabTheme, isPublicPage: PUBLIC_PAGE, articleFabEdges, feedFabPos, FEED_CORNER_MIN_WIDTH, SITE_SIZE_MAP, mouseRevealPref, applyMouseReveal,
    host, btn, menuEl, generalMenuItems,
    openMenu, closeMenu, buildMenu,
    isYouTubeWatchPage, youtubeMenuItems, toggleYtCinema, toggleYtBorderless,
    handleShortPress, togglePaged, openReader, sendToService, applyStorageService,
    profileMenuItems, applyProfile, applyProfiles, applyActiveProfile, applyProfileState,
    openFeaturePanel, openFeaturePanelIframe, closeFeaturePanel, isSafariRuntime,
    openSettingsSheet, closeSettingsSheet, isSettingsOpen: () => !!settingsHost, MENU_ICONS,
    isPanelOpen: () => !!panelHost,
    applyEnabled, applyOpacity, applyPos, applySize, sanitizePos,
    cornerClampTop, CORNER_DEADZONE_PX, isIPadOSEnv,
    isMenuOpen: () => menuOpen,
    isFeedPage: FEED_PAGE,
    getPos: () => ({ ...pos }),
    getHitSize: () => hitSize,
    getTop: () => host.style.top,
    // regression 用：覆寫 iPadOS 旗標以驗角落夾邊路徑（實機 Chromium / jsdom 非 iPadOS）
    setIPadOSForTest: (v) => { isIPadOS = !!v; applyPos(pos); }
  };
})();
