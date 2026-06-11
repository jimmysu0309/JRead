// JRead — YouTube Borderless Mode（v0.7.134）
//
// 從 Shinkansen `SK.YT.Borderless` 移植過來的隱藏功能：把 YouTube watch page
// 的所有 UI（masthead / secondary / 留言 / 描述 / chat / 推薦）整批藏掉、強制
// theater 模式、影片以 100vw × 100vh 撐滿視窗，並透過 SW `RESIZE_OWN_WINDOW`
// 訊息呼叫 `chrome.windows.update` 把瀏覽器視窗本身的高度 resize 成匹配影片
// 寬高比。功能默認沒 suggested_key，使用者自己到 chrome://extensions/shortcuts
// 綁；popup 在 YouTube watch 頁也多一顆「切換無邊模式」按鈕。
//
// 與 `cinema-mode.js` 的差別（兩者**完全獨立、可同時 toggle**，CSS 會搶
// `#movie_player` rule，使用者該自己決定要哪個）：
//   - cinema-mode：player 釘 viewport 中央 + 16:9 雙軸 clamp、不動視窗大小
//   - borderless：影片完全填滿視窗 + RESIZE 視窗高度匹配影片比例 + 強制 theater
//
// SPA navigation：YouTube 切影片不 reload。`apply()` 時掛 `yt-navigate-finish`
// listener，切影片時重套；切到非 /watch 路徑撤掉 CSS 但保留 active flag、切回
// watch 時自動重套。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  const STYLE_ID = '__jread_borderless_style';
  const CSS_TEXT = `
    #masthead-container,ytd-masthead,#secondary,#secondary-inner,
    ytd-watch-metadata,#below,#comments,#related,#chat,
    ytd-merch-shelf-renderer,ytd-engagement-panel-section-list-renderer{display:none!important}
    html,body{margin:0!important;padding:0!important;background:#000!important;overflow:hidden!important;height:100%!important;width:100%!important}
    ytd-app,#content,ytd-page-manager,ytd-watch-flexy,#primary,#primary-inner,#columns{
      height:100%!important;width:100%!important;margin:0!important;padding:0!important;max-width:none!important
    }
    ytd-watch-flexy[theater] #full-bleed-container,
    #full-bleed-container,#player-theater-container,#player-full-bleed-container,
    #player-container-outer,#player-container,#player-container-inner,
    #movie_player,#ytd-player,ytd-player,.html5-video-player,
    .html5-video-container{
      width:100vw!important;max-width:none!important;
      height:100vh!important;max-height:none!important;
      min-height:100vh!important;
      position:relative!important;top:0!important;left:0!important
    }
    video.html5-main-video,video.video-stream{
      width:100vw!important;height:100vh!important;
      max-width:none!important;max-height:none!important;
      object-fit:contain!important;
      top:0!important;left:0!important
    }
  `;

  function isYouTubeWatch(url) {
    const target = url || (typeof location !== 'undefined' ? location.href : '');
    try {
      const u = new URL(target);
      if (!/^(www\.|m\.)?youtube\.com$/.test(u.hostname)) return false;
      return u.pathname === '/watch';
    } catch (_) {
      return false;
    }
  }

  let active = false;
  // null = 尚未 snapshot；true/false = apply 前 ytd-watch-flexy 是否已有 theater
  // attribute。只有「原本沒 theater」才在 unapply removeAttribute，避免使用者
  // 本來就在劇院模式被誤關。
  let prevTheaterValue = null;
  let pendingLoadedHandler = null;
  let navListenerInstalled = false;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS_TEXT;
    (document.head || document.documentElement).appendChild(s);
  }

  function removeStyle() {
    const el = document.getElementById(STYLE_ID);
    if (el) el.remove();
  }

  function snapshotAndSetTheater() {
    const wf = document.querySelector('ytd-watch-flexy');
    if (!wf) return;
    if (prevTheaterValue === null) prevTheaterValue = wf.hasAttribute('theater');
    if (!wf.hasAttribute('theater')) wf.setAttribute('theater', '');
  }

  function restoreTheater() {
    const wf = document.querySelector('ytd-watch-flexy');
    if (wf && prevTheaterValue === false) wf.removeAttribute('theater');
    prevTheaterValue = null;
  }

  function applyVideoInline() {
    const v = document.querySelector('video.html5-main-video');
    if (!v) return;
    v.style.setProperty('width', '100vw', 'important');
    v.style.setProperty('height', '100vh', 'important');
    v.style.setProperty('top', '0', 'important');
    v.style.setProperty('left', '0', 'important');
    v.style.setProperty('object-fit', 'contain', 'important');
  }

  function clearVideoInline() {
    const v = document.querySelector('video.html5-main-video');
    if (!v) return;
    ['width', 'height', 'top', 'left', 'object-fit'].forEach(p => v.style.removeProperty(p));
  }

  // 純函式：算出目標瀏覽器視窗 outer height（chrome 含 menu bar / tab bar），
  // 讓 viewport 高度 = innerWidth / videoAspect。
  // bound 在 [minOuter=200, screen.availHeight * 0.8]，避免 PWA 環境算出 0 或
  // 超出螢幕。spec 透過 _calcTargetWindowHeight 驗算式正確。
  function calcTargetWindowHeight(videoW, videoH, innerW, outerH, innerH) {
    const ratio = videoW / videoH;
    const targetInner = Math.round(innerW / ratio);
    const chromeH = Math.max(0, outerH - innerH);
    const minOuter = 200;
    const maxOuter = Math.round((screen.availHeight || 1080) * 0.8);
    return Math.max(minOuter, Math.min(maxOuter, targetInner + chromeH));
  }

  function requestResize() {
    const v = document.querySelector('video.html5-main-video');
    if (!v) return;
    // videoWidth/Height 在 metadata 載入前是 0；掛 loadedmetadata 等再算
    if (!v.videoWidth || !v.videoHeight) {
      if (pendingLoadedHandler) v.removeEventListener('loadedmetadata', pendingLoadedHandler);
      pendingLoadedHandler = () => {
        pendingLoadedHandler = null;
        if (active) requestResize();
      };
      v.addEventListener('loadedmetadata', pendingLoadedHandler, { once: true });
      return;
    }
    const target = calcTargetWindowHeight(
      v.videoWidth, v.videoHeight,
      window.innerWidth, window.outerHeight, window.innerHeight
    );
    // v0.7.143：走 NS.safeSendMessage（namespace 共用 helper），guard
    // chrome.runtime.id 防 extension reload 後 context invalidated TypeError。
    NS.safeSendMessage({
      type: NS.MSG.RESIZE_OWN_WINDOW,
      payload: { height: target }
    });
  }

  function onYtNavigate() {
    reapplyOnNavigation();
  }

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

  function apply() {
    injectStyle();
    snapshotAndSetTheater();
    applyVideoInline();
    installNavListener();
    // YouTube player JS 監聽 resize 重算 video inline width/height；三個時機
    // 確保 settle（player 載入時序視網路 / device 而定）。
    window.dispatchEvent(new Event('resize'));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
    setTimeout(() => window.dispatchEvent(new Event('resize')), 600);
    setTimeout(() => requestResize(), 300);
  }

  function unapply() {
    removeStyle();
    restoreTheater();
    clearVideoInline();
    uninstallNavListener();
    if (pendingLoadedHandler) {
      const v = document.querySelector('video.html5-main-video');
      if (v) v.removeEventListener('loadedmetadata', pendingLoadedHandler);
      pendingLoadedHandler = null;
    }
    window.dispatchEvent(new Event('resize'));
  }

  function toggle() {
    if (!isYouTubeWatch()) return; // 非 watch 頁 → 沉默 no-op
    active = !active;
    if (active) apply();
    else unapply();
  }

  function reapplyOnNavigation() {
    if (!active) return;
    if (isYouTubeWatch()) {
      // SPA 切影片：等 500ms 讓 YouTube 內部把新 player DOM 建好再重套
      setTimeout(() => { if (active) apply(); }, 500);
    } else {
      // 切到非 /watch（首頁 / 頻道 / search）：撤掉 CSS 但保留 active flag，
      // 切回 watch 時自動重套。
      // v0.8.36：必須走 restoreTheater()（含 removeAttribute）——舊版只丟棄
      // snapshot（prevTheaterValue = null），但 ytd-watch-flexy 在 SPA 導航中
      // 持續存在、我們 apply 時設的 theater attribute 殘留；切回 watch 後
      // snapshotAndSetTheater 在 prevTheaterValue === null 下重新 snapshot、
      // 把自己設的殘留讀成「使用者原本就在劇院」→ 之後 toggle off 不移除，
      // 原本非劇院模式的使用者被永久留在 theater。
      removeStyle();
      clearVideoInline();
      restoreTheater();
    }
  }

  function isActive() { return active; }

  NS.borderless = {
    toggle,
    reapplyOnNavigation,
    isActive,
    isYouTubeWatch,
    STYLE_ID,
    // 給 spec 驗 aspect 計算純函式
    _calcTargetWindowHeight: calcTargetWindowHeight
  };
})();
