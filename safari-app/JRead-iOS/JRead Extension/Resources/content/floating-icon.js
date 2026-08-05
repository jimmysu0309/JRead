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
// - 長按（壓住達 LONGPRESS_MS、未拖移）= 跳出選單：切換分頁模式、進入 Reader、
//   功能選單（叫出工具列圖示選單 popup；Readwise 送出走 popup 內按鈕，v0.8.166 移除
//   選單直送項，因 content 直送在 iOS toast 不顯示、無回饋）。點任一列執行後收選單；
//   點選單外 / 捲動 = 收選單。
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
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;
  if (window !== window.top) return;     // 只在主 frame 放一顆
  if (NS.floating) return;               // 重複注入保險

  const LONGPRESS_MS = 500;              // 壓住達此毫秒 = 長按 → 開選單；之前放開 = 短按
  const DRAG_THRESHOLD_PX = 8;           // pointer 位移超過此距離 = 進入拖移（取消短按 / 長按）
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
  function isIPadOSEnv(ua, touchPoints) {
    if (!((touchPoints || 0) >= 1)) return false;
    ua = ua || '';
    if (/iPhone|iPod/.test(ua)) return false;
    return /iPad/.test(ua) || /Macintosh/.test(ua);
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
    .menu-item .ico {
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
      border-radius: 5px;
      background: #0071e3;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .menu-item .label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
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
        return browser.storage.sync.get({ pagedMode: SETTINGS_DEF.pagedMode ?? false }).then((s) => {
          const next = !(s && s.pagedMode);
          return browser.storage.sync.set({ pagedMode: next }).then(() => {
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

  const MENU_ITEMS = [
    { id: 'paged', icon: '⇄', label: '切換分頁模式', action: togglePaged },
    { id: 'reader', icon: '📖', label: '進入 Reader', action: openReader }
  ];

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
      return u.pathname === '/watch';
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
      { id: 'yt-cinema', icon: '🎬', label: (cinemaIsOn() ? '關閉' : '啟動') + '影院模式', action: toggleYtCinema },
      { id: 'yt-borderless', icon: '⛶', label: (borderlessIsOn() ? '關閉' : '啟動') + '無邊模式', action: toggleYtBorderless }
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
  // runtime 偵測依 getURL scheme（與 options.js / namespace 同款），非 OS flag。
  function isSafariRuntime() {
    try { return (browser.runtime.getURL('') || '').startsWith('safari-web-extension://'); }
    catch (_e) { return false; }
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
    try { popupUrl = browser.runtime.getURL('popup/popup.html') + '?panel=1'; } catch (_e) { return; }
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
      }
    };
    window.addEventListener('message', panelMsgHandler);
    panelKeyHandler = (ev) => { if (ev.key === 'Escape') closeFeaturePanel(); };
    window.addEventListener('keydown', panelKeyHandler, true);
  }

  // ─── 設定狀態 ───────────────────────────────────────────────────────────
  let pos = { edge: 'left', offsetY: 1 };     // 預設左下角（v0.8.160，offsetY=1=底）

  // disable → 重新 enable 時按鈕回到預設位置（v0.8.161）：使用者把按鈕拖到不順手的角落後，
  // 關掉再開即重置。初始載入（lastEnabled = null）不重置，尊重 storage 存的位置。
  let lastEnabled = null;
  function applyEnabled(enabled) {
    if (lastEnabled === false && enabled === true) {
      applyPos(null);     // sanitizePos(null) → 預設左下角
      persistPos();
    }
    lastEnabled = enabled;
    host.style.display = enabled ? 'block' : 'none';
    if (!enabled) closeMenu();
  }

  function applyOpacity(v) {
    const o = typeof v === 'number' ? v : DEFAULT_OPACITY;
    currentOpacity = Math.max(0.1, Math.min(1, o));
    // 選單開著時 host 維持全不透明（見 openMenu）；新設定值記在 currentOpacity，
    // 等 closeMenu 還原。沒開選單時直接套用。
    if (!menuOpen) host.style.opacity = String(currentOpacity);
  }

  // 尺寸切換：寫 CSS 變數（視覺即時生效）+ 同步 hitSize（貼邊 / 拖移夾擠用），
  // 再依新 footprint 重貼一次（offsetY 比例對 vh−hit 重算）。合法值（small/medium/large）
  // 取對應，其餘（含未設過 / 非法值）退回**預設 medium**（v0.8.166，與 settings-defaults
  // 的 floatingIconSize 預設一致）。
  function applySize(v) {
    const s = SIZE_MAP[v] || SIZE_MAP.medium;
    hitSize = s.hit;
    host.style.setProperty('--fab-hit', s.hit + 'px');
    host.style.setProperty('--fab-icon', s.icon + 'px');
    applyPos(pos);
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
  function applyPos(p) {
    pos = sanitizePos(p);
    const vh = window.innerHeight || 0;
    const rawTop = Math.round(pos.offsetY * Math.max(0, vh - hitSize));
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
    try { browser.storage.sync.set({ floatingIconPos: pos }); } catch (_e) {}
  }

  // ─── 長按選單 ───────────────────────────────────────────────────────────
  let menuOpen = false;
  let outsideHandler = null;

  function buildMenu() {
    menuEl.textContent = '';
    // YouTube watch 頁顯示 YouTube 兩功能（影院 / 無邊）；其餘頁顯示一般動作。
    // 每次長按重建 → YouTube 標籤每次都反映當下 active 狀態。
    const items = isYouTubeWatchPage() ? youtubeMenuItems() : MENU_ITEMS;
    for (const it of items) {
      const item = document.createElement('button');
      item.className = 'menu-item';
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.dataset.action = it.id;
      const ico = document.createElement('span');
      ico.className = 'ico';
      ico.textContent = it.icon;
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
    // 分隔線 +「功能選單」：叫出工具列圖示選單（popup）當頁內浮層（v0.8.162）
    const divider = document.createElement('div');
    divider.className = 'menu-divider';
    menuEl.appendChild(divider);
    const featureItem = document.createElement('button');
    featureItem.className = 'menu-item feature';
    featureItem.type = 'button';
    featureItem.setAttribute('role', 'menuitem');
    featureItem.dataset.action = 'feature-menu';
    const fIco = document.createElement('span');
    fIco.className = 'ico';
    fIco.textContent = '☰';
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
  }

  function openMenu() {
    if (host.style.display === 'none') return;
    buildMenu();
    // v1.7.42：依 fab 垂直位置切換選單錨定——上半部（offsetY < 0.5）往下長、
    // 下半部維持 bottom:0 往上長，兩側都不會超出畫面
    menuEl.classList.toggle('anchor-top', pos.offsetY < 0.5);
    menuEl.classList.add('show');
    menuOpen = true;
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
    // 還原使用者設定的透明度（選單期間被調成全不透明）
    host.style.opacity = String(currentOpacity);
    if (outsideHandler) {
      document.removeEventListener('pointerdown', outsideHandler, true);
      outsideHandler = null;
    }
    window.removeEventListener('scroll', closeMenu, true);
  }

  // ─── 短按：切換閱讀模式 ──────────────────────────────────────────────────
  function handleShortPress() {
    if (typeof NS.dispatchLocalCommand === 'function') {
      NS.dispatchLocalCommand('toggle-reader-mode');
      return;
    }
    // dispatchLocalCommand 缺席（SPA 注入競態）→ fallback 走 SW 路徑
    NS.safeSendMessage({ type: NS.MSG.CUSTOM_COMMAND, payload: { command: 'toggle-reader-mode' } });
  }

  // ─── pointer 狀態機（短按 / 拖移吸附 / 長按）─────────────────────────────
  let press = null;  // { id, startX, startY, timer, moved, longFired }

  function clearPressTimer() {
    if (press && press.timer) { clearTimeout(press.timer); press.timer = null; }
  }

  btn.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;  // 只認主鍵
    e.preventDefault();
    closeMenu();
    try { btn.setPointerCapture(e.pointerId); } catch (_e) {}
    press = { id: e.pointerId, startX: e.clientX, startY: e.clientY, timer: null, moved: false, longFired: false };
    press.timer = setTimeout(() => {
      if (!press || press.moved) return;
      press.longFired = true;
      press.timer = null;
      openMenu();
    }, LONGPRESS_MS);
  });

  btn.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.startX;
    const dy = e.clientY - press.startY;
    if (!press.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
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
    const { moved, longFired } = press;
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
    handleShortPress();
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
  };
  try {
    browser.storage.sync.get(['floatingIcon', 'floatingIconOpacity', 'floatingIconPos', 'floatingIconSize']).then((s) => {
      if (!s) { applyDefaults(); return; }
      applySize(s.floatingIconSize);
      applyOpacity(s.floatingIconOpacity);
      applyPos(s.floatingIconPos);
      applyEnabled(RESOLVE(s.floatingIcon));
    }).catch(applyDefaults);
  } catch (_e) {
    applyDefaults();
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.floatingIcon) applyEnabled(RESOLVE(changes.floatingIcon.newValue));
    if (changes.floatingIconOpacity) applyOpacity(changes.floatingIconOpacity.newValue);
    if (changes.floatingIconPos) applyPos(changes.floatingIconPos.newValue);
    if (changes.floatingIconSize) applySize(changes.floatingIconSize.newValue);
  });

  // regression spec（isolated world）用：暴露內部 handler 與狀態
  NS.floating = {
    host, btn, menuEl, MENU_ITEMS,
    openMenu, closeMenu, buildMenu,
    isYouTubeWatchPage, youtubeMenuItems, toggleYtCinema, toggleYtBorderless,
    handleShortPress, togglePaged, openReader,
    openFeaturePanel, openFeaturePanelIframe, closeFeaturePanel, isSafariRuntime,
    isPanelOpen: () => !!panelHost,
    applyEnabled, applyOpacity, applyPos, applySize, sanitizePos,
    cornerClampTop, CORNER_DEADZONE_PX, isIPadOSEnv,
    isMenuOpen: () => menuOpen,
    getPos: () => ({ ...pos }),
    getHitSize: () => hitSize,
    getTop: () => host.style.top,
    // regression 用：覆寫 iPadOS 旗標以驗角落夾邊路徑（實機 Chromium / jsdom 非 iPadOS）
    setIPadOSForTest: (v) => { isIPadOS = !!v; applyPos(pos); }
  };
})();
