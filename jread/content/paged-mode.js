// JRead — 翻頁模式（v0.7.227）
//
// 電子書式水平翻頁：CSS 端（styler.js pagedMode 區塊）把 reader card 變成
// fixed 滿版 multi-column 容器（column-width: 版心寬 + column-fill: auto +
// 高度約束 → 溢出內容自動長出等寬水平 overflow column = 頁；v0.7.230 起
// 不可用 column-count: 1——WebKit 對 count=1 不建 fragmentation context、
// scrollWidth 不含 overflow columns，翻頁全滅，詳見 styler.js 註解）；
// 本模組負責行為層：
//
//   - 左右滑動翻頁（touch swipe；起點避開螢幕左右邊緣 EDGE_GUARD_PX，
//     防 iOS Safari 邊緣滑動 = 瀏覽歷史手勢的誤觸）
//   - 鍵盤翻頁：← / PageUp / Shift+Space = 上一頁；→ / PageDown / Space =
//     下一頁；Home / End = 首頁 / 末頁
//   - 滾輪 / 觸控板翻頁（水平或垂直 delta 累積過門檻，含慣性尾巴鎖定）
//   - 頁碼指示（#__jread-page-indicator，底部置中「3 / 43」）+ 復用
//     styler 的 #__jread-progress 進度條（寬度 = 已讀頁比例）
//   - resize / 旋轉時重算頁數、保持目前閱讀比例位置
//
// stride 恆等式：styler CSS 設 column-gap = 左右 padding 和，因此
// 「column 寬 + gap = 元素 clientWidth」——翻到第 n 頁 = scrollLeft 跳
// n × clientWidth。頁數 = round(scrollWidth / stride)（Playwright probe 於
// chinatalk 43 頁 / udn 4 頁實測恆等式零偏移）。
//
// 與既有機能的相容（main.js 端 wiring）：
//   - Space 段落卷動（space-scroll.js）在翻頁模式下停用——文件不可垂直卷動，
//     Space 改為翻下一頁（行為由本模組 keydown 接手）
//   - keydown listener 必須先於 keyguard 註冊（keyguard 對非 ESC 鍵
//     stopImmediatePropagation；同 phase listener 按註冊順序執行），
//     main.js 的 syncPagedModeFromSettings 比照 space-scroll 處理重掛順序
//   - ESC 退出不受影響（本模組不攔 Escape；onEscKey 註冊更早）
//   - 3 指輕點 toggle 不受影響（本模組只認單指 swipe）
//
// 跨環境匯出：content script 走 NS.pagedMode；純邏輯（swipe 判定 / 鍵盤
// 對映 / 頁數計算）走 module.exports 給 jsdom regression spec（spec 餵純
// 物件，不碰 TouchEvent / layout）。
(function (global) {
  'use strict';

  const INDICATOR_ID = '__jread-page-indicator';
  // styler.js PROGRESS_ID 的鏡像字面值（兩檔是同一事實的雙實作，regression
  // spec paged-mode.spec.js 會校對兩邊字面值一致）
  const PROGRESS_ID = '__jread-progress';

  // swipe 判定參數（結構性，不綁平台）
  const SWIPE_MIN_DX = 48;          // 水平位移門檻（px）
  const SWIPE_AXIS_RATIO = 1.4;     // |dx| 必須 > |dy| × ratio（軸向支配）
  const EDGE_GUARD_PX = 28;         // 起點離螢幕左右邊緣 < 此值不認（瀏覽器歷史手勢區）
  const WHEEL_THRESHOLD = 90;       // 滾輪 delta 累積門檻
  const WHEEL_LOCKOUT_MS = 550;     // 翻頁後滾輪鎖定（吃掉觸控板慣性尾巴）
  const TURN_ANIM_MS = 260;         // 翻頁動畫時長

  // ---- 純邏輯（jsdom spec 直接測）----

  // 頁數：stride 恆等式下 scrollWidth 是 stride 整數倍（probe 實測），round
  // 兜浮點誤差；guard 退化輸入回 1。
  function computePageCount(scrollWidth, stride) {
    if (!(stride > 0) || !(scrollWidth > 0)) return 1;
    return Math.max(1, Math.round(scrollWidth / stride));
  }

  // swipe 手勢分類。輸入純物件 { dx, dy, startX, viewportW }：
  //   dx/dy = touchend − touchstart 位移；startX = 起點 clientX。
  // 回傳 'next'（往左滑 = 翻下一頁）/ 'prev' / null。
  function classifySwipe(g, opts) {
    const o = opts || {};
    const minDx = o.minDx || SWIPE_MIN_DX;
    const axisRatio = o.axisRatio || SWIPE_AXIS_RATIO;
    const edgeGuard = o.edgeGuardPx !== undefined ? o.edgeGuardPx : EDGE_GUARD_PX;
    if (!g) return null;
    // 邊緣起手 = 可能是瀏覽器歷史手勢，讓位
    if (g.startX < edgeGuard || g.startX > g.viewportW - edgeGuard) return null;
    if (Math.abs(g.dx) < minDx) return null;
    if (Math.abs(g.dx) < Math.abs(g.dy) * axisRatio) return null;
    return g.dx < 0 ? 'next' : 'prev';
  }

  // 鍵盤對映。輸入 event-like { key, code, shiftKey, altKey, ctrlKey, metaKey }。
  // 回傳 'next' / 'prev' / 'first' / 'last' / null。
  function classifyKey(e) {
    if (!e || e.altKey || e.ctrlKey || e.metaKey) return null;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown') return 'next';
    if (k === 'ArrowLeft' || k === 'PageUp') return 'prev';
    if (k === ' ' || e.code === 'Space') return e.shiftKey ? 'prev' : 'next';
    if (k === 'Home') return 'first';
    if (k === 'End') return 'last';
    return null;
  }

  // ---- DOM 模組 ----

  let installed = false;
  let art = null;
  let idx = 0;
  let lastRatio = 0;        // uninstall 後保留，styler reapply 重掛時回到原比例
  let savedScrollY = 0;     // 進翻頁模式前的文件卷動位置，退出還原
  let indicatorEl = null;
  let animFrame = null;
  let wheelAccum = 0;
  let wheelLockUntil = 0;
  let touchState = null;    // { startX, startY, multi }
  let remeasureTimers = [];

  function stride() {
    return art ? art.clientWidth : 0;
  }

  function pageCount() {
    return art ? computePageCount(art.scrollWidth, stride()) : 1;
  }

  function renderIndicator() {
    const total = pageCount();
    if (indicatorEl) indicatorEl.textContent = (idx + 1) + ' / ' + total;
    // 復用 styler 進度條：翻頁模式下文件不卷動、onScrollProgress 收不到事件，
    // 由本模組直接驅動寬度 = 已讀頁比例
    const bar = document.getElementById(PROGRESS_ID);
    if (bar) bar.style.width = (total <= 1 ? 100 : ((idx + 1) / total) * 100) + '%';
  }

  // rAF ease-out 動畫跳頁。jsdom 無 layout，spec 不測本函式。
  function goTo(n, animate) {
    if (!art) return;
    const total = pageCount();
    idx = Math.max(0, Math.min(total - 1, n));
    lastRatio = total > 1 ? idx / (total - 1) : 0;
    const target = idx * stride();
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    if (!animate) {
      art.scrollLeft = target;
      renderIndicator();
      return;
    }
    const from = art.scrollLeft;
    const delta = target - from;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / TURN_ANIM_MS);
      const ease = 1 - Math.pow(1 - p, 3); // ease-out cubic
      art.scrollLeft = from + delta * ease;
      if (p < 1) animFrame = requestAnimationFrame(step);
      else animFrame = null;
    };
    animFrame = requestAnimationFrame(step);
    renderIndicator();
  }

  function turn(dir) {
    if (dir === 'next') goTo(idx + 1, true);
    else if (dir === 'prev') goTo(idx - 1, true);
    else if (dir === 'first') goTo(0, true);
    else if (dir === 'last') goTo(pageCount() - 1, true);
  }

  // 編輯類 element focus 時放行（與 onEscKey / onSpaceScroll 同準則）
  function isEditableFocus() {
    const ae = document.activeElement;
    if (!ae) return false;
    const tag = ae.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (ae.isContentEditable) return true;
    const ce = ae.getAttribute && ae.getAttribute('contenteditable');
    return ce === 'true' || ce === '';
  }

  function onKeydown(e) {
    if (e.isComposing || e.keyCode === 229) return; // IME
    if (isEditableFocus()) return;
    const dir = classifyKey(e);
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    turn(dir);
  }

  // 滾輪 / 觸控板：水平或垂直 delta 都映射成翻頁（文件不可垂直卷動，垂直
  // 滾輪閒置不用反而違反直覺）。翻頁後鎖定一段時間吃掉慣性尾巴。
  function onWheel(e) {
    e.preventDefault(); // 文件鎖卷動下無原生用途；防 macOS 觸控板水平 swipe 觸發歷史導航
    const now = performance.now();
    if (now < wheelLockUntil) return;
    const d = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    wheelAccum += d;
    if (Math.abs(wheelAccum) < WHEEL_THRESHOLD) return;
    turn(wheelAccum > 0 ? 'next' : 'prev');
    wheelAccum = 0;
    wheelLockUntil = now + WHEEL_LOCKOUT_MS;
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) { touchState = null; return; } // 多指讓位（3 指 toggle 等）
    const t = e.touches[0];
    touchState = { startX: t.clientX, startY: t.clientY };
  }

  function onTouchMove(e) {
    if (touchState && e.touches.length !== 1) touchState = null;
  }

  function onTouchEnd(e) {
    if (!touchState || e.touches.length > 0) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) { touchState = null; return; }
    const dir = classifySwipe({
      dx: t.clientX - touchState.startX,
      dy: t.clientY - touchState.startY,
      startX: touchState.startX,
      viewportW: window.innerWidth
    });
    touchState = null;
    if (dir) turn(dir);
  }

  function onTouchCancel() { touchState = null; }

  // resize / 旋轉：stride 變了、頁界全部重排——按 lastRatio 回到對應頁
  function onResize() {
    if (!art) return;
    requestAnimationFrame(() => {
      if (!art) return;
      const total = pageCount();
      goTo(Math.round(lastRatio * (total - 1)), false);
    });
  }

  function install(articleEl) {
    if (installed && art === articleEl) {
      // styler reapply 後重掛：重算頁數、回到原比例位置
      onResize();
      return;
    }
    if (installed) uninstall();
    if (!articleEl) return;
    art = articleEl;

    indicatorEl = document.getElementById(INDICATOR_ID);
    if (!indicatorEl) {
      indicatorEl = document.createElement('div');
      indicatorEl.id = INDICATOR_ID;
      // 必須掛在 <html> 下（與 styler progressEl 同層），不能掛 body——
      // body 帶 data-jread-ancestor，styler 的 sibling 隱藏規則
      // `[ancestor] > *:not(...)` 會把 body 下的非主文子元素全部 display:none，
      // 指示器掛 body 下 rect 量出 0×0（udn probe 實證）。html 沒被
      // markAncestors 標記，不受該規則影響。
      (document.head?.parentElement || document.documentElement).appendChild(indicatorEl);
    }

    // keydown 必須 capture（先於原站 listener）；touch passive（不阻塞原生
    // 行為，swipe 判定在 touchend 才做）；wheel passive: false（要 preventDefault）。
    window.addEventListener('keydown', onKeydown, true);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    window.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    window.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    window.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: true });
    window.addEventListener('resize', onResize);

    installed = true;
    // 進場回到上次比例（同一篇 reapply 場景）；首次進入 lastRatio = 0 = 第一頁
    const total = pageCount();
    goTo(Math.round(lastRatio * (total - 1)), false);

    // lazy-load 圖片 / 晚到內容會讓 scrollWidth 變動——延遲重算頁數
    // （只刷指示文字與 clamp，不跳頁）
    remeasureTimers = [1000, 3000].map(ms => setTimeout(() => {
      if (installed) renderIndicator();
    }, ms));
  }

  function uninstall() {
    if (!installed && !indicatorEl) return;
    window.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('wheel', onWheel, { passive: false });
    window.removeEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    window.removeEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    window.removeEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    window.removeEventListener('touchcancel', onTouchCancel, { capture: true, passive: true });
    window.removeEventListener('resize', onResize);
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    for (const t of remeasureTimers) clearTimeout(t);
    remeasureTimers = [];
    if (indicatorEl) { indicatorEl.remove(); indicatorEl = null; }
    if (art) art.scrollLeft = 0;
    // 還原進場前的文件卷動位置（overflow hidden 期間 scrollTop 歸零，
    // CSS 移除後不還原會讓使用者掉回頁首）。styler restore 在本 uninstall
    // 之後才移除 overflow hidden——延後一個 frame 等文件恢復可卷動。
    const y = savedScrollY;
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
    art = null;
    installed = false;
    touchState = null;
    wheelAccum = 0;
    idx = 0;
    // lastRatio 刻意保留：settings reapply 的 uninstall→install 要回原位；
    // exitReaderMode 後 main.js 會呼叫 resetPosition() 歸零
  }

  function resetPosition() { lastRatio = 0; }

  // 文件卷動位置捕捉：必須在 styler 注入 overflow hidden **之前**呼叫——
  // 注入後文件不可卷動、window.scrollY 已被 clamp 成 0，事後讀必丟失。
  // main.js 在 enterReaderMode / scheduleReapply 的 styler.apply 前呼叫；
  // 已 installed 時不覆寫（此刻 scrollY 是被鎖定的 0，不是真位置）。
  function captureScrollY() {
    if (!installed) savedScrollY = window.scrollY || 0;
  }

  // settings → 模組狀態同步（與 space-scroll.sync 同形）：pagedMode = true
  // 且有 articleEl 才 install。
  function sync(settings, articleEl) {
    const on = !!(settings && settings.pagedMode === true);
    if (on && articleEl) install(articleEl);
    else uninstall();
  }

  const api = {
    computePageCount,
    classifySwipe,
    classifyKey,
    sync,
    install,
    uninstall,
    resetPosition,
    captureScrollY,
    isInstalled: () => installed,
    SWIPE_MIN_DX, SWIPE_AXIS_RATIO, EDGE_GUARD_PX, WHEEL_THRESHOLD,
    INDICATOR_ID, PROGRESS_ID
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // content script 環境：掛上 NS（namespace.js 先載入）
  if (typeof window !== 'undefined' && global === window && window.__JRead) {
    window.__JRead.pagedMode = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
