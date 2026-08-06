// JRead — Cinema Mode（YouTube watch page 專用）
// YouTube watch page 沒主文可閱讀（detector 預設 no-op）；改提供「影院模式」：
// 隱藏 masthead / 推薦 / 留言 / 描述、把 player 釘 viewport 中央、黑底鋪滿。
//
// 設計選擇（probe Step 1 驗證過，2026-05-18）：
// 1. 不動 player DOM，只用 CSS 釘 #movie_player 位置——避免 YouTube 內部 resize
//    observer / web component lifecycle 反噬
// 2. position: fixed + transform: translate(-50%, -50%) 直接釘中央，繞過 ytd-watch-
//    flexy 的 #columns flex layout（從上層 flex-center 會跟 player 自己的絕對定位
//    打架，video 跑到 left=-336）
// 3. 不 override <video> tag 的 width/height——YouTube 內部會自己根據 player 容器
//    sizing 計算 inline style；只要 enter() 結尾 dispatch window resize 觸發重算
// 4. min(100vw, 177.78vh) / min(56.25vw, 100vh) 雙軸 clamp 16:9，寬高任一觸到
//    viewport 都不溢出
//
// SPA navigation：YouTube 切影片不 reload，需 listen yt-navigate-finish；切到非
// 影片路徑（首頁 / 頻道 / search）必須 exit（main.js 觸發、本檔負責拆 style）。
// 影片路徑含 /watch 與直播的 /live/<id>（v1.7.50，判定見 isYouTubeWatch）。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  const STYLE_ID = '__jread_cinema_style';
  const ACTIVE_ATTR = 'data-jread-cinema-active';

  // 注意：本函式與 youtube-borderless.js 的 isYouTubeWatch、floating-icon.js
  // isYouTubeWatchPage 的 URL fallback **三方互為鏡像**（v0.8.37 標記兩處、
  // v1.7.43 盤點補第三處）——各模組獨立載入、各自持有一份。改 hostname /
  // pathname 判定時三處必須同步（例如未來要加 music.youtube.com 排除）；
  // youtube-watch-detect-mirror.spec.js 逐字校對三份、drift 即 fail。不抽
  // 共用的原因：模組間無載入順序依賴關係，為 10 行 util 建立跨模組依賴不划算。
  // 註：service-worker.js 無邊模式 resize 的 INVALID_ORIGIN 閘是第四份同義判定
  //（sender.tab.url 字串比對、非 URL 物件），放寬路徑時一併改。
  //
  // v1.7.50：路徑除 /watch 外再收 /live/<id>——YouTube 直播（含直播結束後的存檔）
  // 的正規網址是 /live/<id> 且不轉址，但 probe 實測 DOM 與 /watch 完全同構
  //（ytd-watch-flexy / #movie_player / #secondary / ytd-comments 全部命中、
  // player 尺寸位置一致），cinema CSS 原封不動即適用。/shorts/ 仍排除（9:16
  // 直式播放器，套 16:9 clamp 會破版）。
  function isYouTubeWatch(url) {
    const target = url || (typeof location !== 'undefined' ? location.href : '');
    try {
      const u = new URL(target);
      // 接受 www.youtube.com / m.youtube.com / youtube.com；排除 youtube-nocookie
      if (!/^(www\.|m\.)?youtube\.com$/.test(u.hostname)) return false;
      return /^\/watch$|^\/live\/[^/]+$/.test(u.pathname);
    } catch (_) {
      return false;
    }
  }

  function buildCss() {
    return [
      'html, body { background: #000 !important; overflow: hidden !important; }',
      // 頂部 masthead / popup overlay
      'ytd-masthead, #masthead-container, ytd-popup-container { display: none !important; }',
      // 主文資訊 / 推薦 / 留言 / 描述
      'ytd-watch-flexy #secondary, ytd-watch-flexy #below, ytd-watch-flexy #related,',
      'ytd-watch-grid, ytd-comments, ytd-merch-shelf-renderer, ytd-watch-metadata,',
      '#meta, #info, #top-row, #bottom-row,',
      'ytd-engagement-panel-section-list-renderer { display: none !important; }',
      // 容器鏈塗黑（避免白色背景透出）
      'ytd-page-manager, ytd-watch-flexy, #columns, #primary, #primary-inner,',
      '#player-container, #player-container-outer, #player-full-bleed-container,',
      '#player-theater-container { background: #000 !important; }',
      // Player 內部會在影片結束 / 中段 transient 浮出的 endscreen / autoplay card /
      // suggested action / mealbar promo——cinema mode 一律壓掉保持純黑沉浸感
      '.ytp-ce-element, .ytp-cards-teaser, .ytp-suggested-action,',
      '.ytp-mealbar-promo-renderer, .ytp-paid-content-overlay { display: none !important; }',
      // 核心：把 movie_player 釘 viewport 中央、雙軸 clamp 16:9
      '#movie_player {',
      '  position: fixed !important;',
      '  top: 50% !important;',
      '  left: 50% !important;',
      '  transform: translate(-50%, -50%) !important;',
      '  width: min(100vw, 177.78vh) !important;',
      '  height: min(56.25vw, 100vh) !important;',
      '  max-width: 100vw !important;',
      '  max-height: 100vh !important;',
      '  z-index: 9999 !important;',
      '  background: #000 !important;',
      '}'
    ].join('\n');
  }

  function onYtNavigate() {
    // SPA 切影片後 player container 可能短暫 re-mount；dispatch resize 讓 YouTube
    // 內部 layout 重算把 video tag 的 inline width/height 算對。若使用者切到非
    // /watch 路徑（首頁 / 搜尋）由 main.js 監聽決定要不要 exit。
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('resize'));
    }
  }

  let navListenerInstalled = false;
  function installNavListener() {
    if (navListenerInstalled) return;
    window.addEventListener('yt-navigate-finish', onYtNavigate);
    navListenerInstalled = true;
  }
  function uninstallNavListener() {
    if (!navListenerInstalled) return;
    window.removeEventListener('yt-navigate-finish', onYtNavigate);
    navListenerInstalled = false;
  }

  function enter() {
    if (document.getElementById(STYLE_ID)) return false; // 已啟用
    NS.injectCssText(STYLE_ID, buildCss()); // v0.8.130：CSP-safe（見 namespace.js）
    document.documentElement.setAttribute(ACTIVE_ATTR, '1');
    // YouTube 的 video 元素 inline width/height 由內部 resize handler 算；CSS 釘
    // 容器後必須 dispatch resize 觸發 YouTube 把 video tag size 重算進 1040x585
    // 之類；否則 video.height=0、畫面全黑（Step 1 probe v2 踩過此坑）。
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('resize'));
    }
    installNavListener();
    return true;
  }

  function exit() {
    NS.removeCssText(STYLE_ID);
    document.documentElement.removeAttribute(ACTIVE_ATTR);
    uninstallNavListener();
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('resize'));
    }
  }

  function isActive() {
    return !!document.getElementById(STYLE_ID);
  }

  NS.cinema = {
    enter,
    exit,
    isActive,
    isYouTubeWatch,
    STYLE_ID,
    ACTIVE_ATTR
  };
})();
