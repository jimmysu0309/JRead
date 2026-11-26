// JRead — Article View 沉浸閱讀：齒輪預設隱藏、點一下畫面切換（v3.5.0）
//
// 原本是 iOS App 專屬（v2.2.2，App shim installImmersive）：進文章時狀態列與 J 圖示一起藏，
// 點一下畫面兩者一起出現、再點一下一起藏。v3.5.0（Jimmy 2026-11-26「文章頁用齒輪代替 J，行為一樣」
//「網頁版和擴充也一起改」）搬到這裡，三種環境（App、網頁版、擴充的 Reader）共用同一份判定：
//   - 本模組：判定「乾淨的點一下」→ 切換 <html data-jread-chrome="shown|hidden">，樣式把懸浮按鈕
//     （floating-icon 的齒輪）藏起來，並在 window 發 'jread:chrome' 事件（detail.shown）
//   - App shim（safari-app/JRead-iOS/shim-src/app-backend.js）只聽事件、轉給原生藏 / 顯示狀態列
//
// 什麼算「點一下」：
//   - 觸控：單指、沒拖移（TAP_SLOP_PX）、沒長按（TAP_MAX_MS）、起手前沒有選取（畫重點中）。
//     v3.2.6：切換等 click 送出之後才做（touch 只負責判定）。在 touchend 當下切換的話，齒輪從透明
//     變可見，WebKit 把「點擊瞬間頁面有東西出現」當成 hover、不送 click——點圖片 / 連結要點兩次
//     （Jimmy 2026-11-25 回報，模擬器重現）。等 click 還有一個好處：click 的 target 是 WebKit
//     吸附後的元素，手指點偏到連結旁邊也判得出是點連結
//   - 滑鼠 / 觸控筆（v3.5.0 新增，電腦版）：pointerdown 到 click 之間沒拖移、按下前與 click 當下都沒有
//     選取（拖曳選字、雙擊選詞不切換）
//   - 點到連結、表單、頁碼指示器、自有 UI（懸浮按鈕、面板、重點工具列…）交給它們，不切換；
//     click 在 window 冒泡階段收：圖片預覽等自己處理掉（preventDefault / stopPropagation）的點擊不切換
//
// 左緣返回（App installEdgeBack）在 document-start 先掛、會 stopImmediatePropagation，同一段觸控不會再切換。
//
// dual export：module.exports 給 jsdom spec、window.__JReadImmersive 給頁面。頁面載入時自己裝
//（只在 top frame、非公開分享頁——分享頁沒有齒輪）
(function (global) {
  'use strict';

  const CHROME_ATTR = 'data-jread-chrome';
  const EVENT = 'jread:chrome';
  const TAP_SLOP_PX = 10;
  const TAP_MAX_MS = 350;
  // touchend / pointerup 之後等 click 的上限（單指點按 click 通常在幾十毫秒內送出）
  const TAP_CLICK_WAIT_MS = 1000;
  const TAP_SKIP = 'a, button, input, textarea, select, label, summary, video, audio, iframe, [contenteditable], ' +
    '#__jread-floating-host, #__jread-panel-host, #__jread-settings-host, #__jread-hl-host, #__jread-toast-host, ' +
    '#__jread-info-host, #__jread-back-host, #__jread-page-indicator, #__jread-scrub-track';
  const HIDE_CSS = 'html[' + CHROME_ATTR + '="hidden"] #__jread-floating-host' +
    ' { opacity: 0 !important; pointer-events: none !important; }';

  function hasSelection(win) {
    const sel = win.getSelection && win.getSelection();
    return !!(sel && !sel.isCollapsed);
  }

  function install(win) {
    const doc = win.document;
    if (!doc || !doc.documentElement || doc.documentElement.hasAttribute(CHROME_ATTR)) return null;
    let shown = false;
    const apply = () => {
      doc.documentElement.setAttribute(CHROME_ATTR, shown ? 'shown' : 'hidden');
      try { win.dispatchEvent(new win.CustomEvent(EVENT, { detail: { shown } })); } catch (_e) { /* */ }
    };
    const style = doc.createElement('style');
    style.id = '__jread-immersive-style';
    style.textContent = HIDE_CSS;
    doc.documentElement.appendChild(style);

    let tap = null;
    let tapAt = 0;   // 乾淨點按結束的時刻；等對應的 click 來才切換
    const far = (x, y) => !tap || Math.abs(x - tap.x) > TAP_SLOP_PX || Math.abs(y - tap.y) > TAP_SLOP_PX;

    // ---- 觸控（v3.2.6 的判定原樣搬過來）----
    win.addEventListener('touchstart', (e) => {
      tap = null;
      tapAt = 0;
      if (!e.touches || e.touches.length !== 1) return;
      if (hasSelection(win)) return;
      const t = e.touches[0];
      tap = { x: t.clientX, y: t.clientY, at: Date.now(), touch: true };
    }, { capture: true, passive: true });
    win.addEventListener('touchmove', (e) => {
      if (!tap) return;
      const t = e.touches && e.touches[0];
      if (!t || far(t.clientX, t.clientY)) tap = null;
    }, { capture: true, passive: true });
    win.addEventListener('touchend', (e) => {
      const start = tap;
      if (!start || !start.touch || (e.touches && e.touches.length)) { tap = null; return; }
      const t = e.changedTouches && e.changedTouches[0];
      const bad = !t || far(t.clientX, t.clientY) || Date.now() - start.at > TAP_MAX_MS;
      tap = null;
      if (!bad) tapAt = Date.now();
    }, { capture: true, passive: true });
    win.addEventListener('touchcancel', () => { tap = null; tapAt = 0; }, { capture: true, passive: true });

    // ---- 滑鼠 / 觸控筆（觸控的 pointer 事件交給上面那套，不重複判定）----
    win.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      tap = null;
      tapAt = 0;
      if (e.button != null && e.button !== 0) return;
      if (hasSelection(win)) return;
      tap = { x: e.clientX, y: e.clientY, at: Date.now(), touch: false };
    }, { capture: true, passive: true });
    win.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      const start = tap;
      if (!start || start.touch) return;
      const bad = far(e.clientX, e.clientY);
      tap = null;
      if (!bad) tapAt = Date.now();
    }, { capture: true, passive: true });

    win.addEventListener('click', (e) => {
      const at = tapAt;
      tapAt = 0;
      if (!at || Date.now() - at > TAP_CLICK_WAIT_MS || e.defaultPrevented) return;
      if (hasSelection(win)) return;   // 滑鼠拖曳選字 / 雙擊選詞
      const tg = e.target;
      const el = tg && tg.nodeType === 1 ? tg : (tg && tg.parentElement);
      if (el && el.closest && el.closest(TAP_SKIP)) return;
      shown = !shown;
      apply();
    });
    // bfcache 回來（從外部 / 列表再前進）原生狀態列可能已被別頁改過，重報一次
    win.addEventListener('pageshow', apply);
    apply();
    return {
      isShown: () => shown,
      setShown: (v) => { shown = !!v; apply(); }
    };
  }

  const api = { install, CHROME_ATTR, EVENT, TAP_SKIP, TAP_SLOP_PX, TAP_MAX_MS, HIDE_CSS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && global === window) {
    window.__JReadImmersive = api;
    const host = window.__jreadHost;
    if (window === window.top && !(host && host.readOnly)) {
      api.instance = install(window);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
