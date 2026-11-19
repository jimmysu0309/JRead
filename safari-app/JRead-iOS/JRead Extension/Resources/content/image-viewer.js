// JRead — 閱讀模式圖片預覽（v2.5.27，第一階段）
//
// 需求（Jimmy 2026-11-19）：閱讀模式中點內文圖片，開全螢幕預覽層。大圖縮到螢幕內、
// 小圖用原尺寸不放大；點背景 / Esc / 下滑關閉；右鍵與長按用瀏覽器原生選單。
// 這一輪不做：雙指縮放與拖移、自訂分享鈕、手機瀏覽器「返回」關閉預覽。
//
// 結構：
//   - 宿主 <div id="__jread-image-viewer"> 掛 <html>（掛 body 會被 cleaner 動態
//     observer 藏掉）、shadow DOM、樣式走 NS.injectShadowCss（嚴格 CSP 站可用）。
//     id 以 `__jread-` 開頭 → NS.isInjectedUiTarget 認得：翻頁模式的觸控起點判定、
//     編輯模式的點擊攔截都會自動略過預覽層。
//   - 預覽層內是真的 <img>（從頁面本身載入，referrer / 快取與原圖相同），不攔
//     contextmenu 與長按，瀏覽器原生選單（儲存 / 複製）照常出現。
//   - 不寫主文 DOM 的任何 inline style、不動捲動位置；關閉＝移除宿主＋拆 listener。
//
// 與底下文章的輸入隔離：
//   - 滾輪 / 觸控：宿主蓋滿畫面，事件 target 都是宿主；宿主上 preventDefault ＋
//     stopPropagation，到不了 window 的翻頁 / 捲動 listener。
//   - 鍵盤：鍵盤事件的 target 是 activeElement、不經過宿主，而翻頁 / 空白鍵 / 自訂
//     快速鍵 / Esc 的 window capture listener 註冊得比本模組早。所以那幾支 handler
//     開頭各查一次 NS.imageViewer.isOpen() 讓位（與 Esc 對懸浮面板讓位同一個做法），
//     本模組自己的 keydown listener 處理 Esc 關閉並吃掉其餘按鍵。
//
// 點擊決策（decideClick）與來源挑選（pickHiResSource）是純函式，spec 直接 require。
// IMG_HREF_RE 與 link-follow.js 的同名 regex 是同一份事實的雙實作（Reader 文章頁
// article.html 不載 link-follow.js，本模組要能獨立運作）——由
// test/regression/image-viewer.spec.js 校對兩邊 source 相同。
(function (global) {
  'use strict';

  var HOST_ID = '__jread-image-viewer';
  var MIN_SIDE = 100;          // 任一邊小於此值不觸發（頭像、圖示）
  var FADE_MS = 150;
  var SWIPE_CLOSE_PX = 80;     // 下滑放手時位移超過此值就關閉
  var SWIPE_SLOP_PX = 10;      // 位移超過此值才判定方向

  var IMG_HREF_RE = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg|jfif)(?:[?#].*)?$/i;

  function isImageHref(href) {
    var s = String(href || '');
    if (!/^https?:/i.test(s)) return false;
    var path;
    try { path = new URL(s).pathname; } catch (e) { return false; }
    return IMG_HREF_RE.test(path);
  }

  // 一次 click 該不該開預覽。回傳 'preview' | 'pass'。
  // info 欄位：
  //   button / metaKey / ctrlKey / shiftKey / altKey   滑鼠事實（只認純左鍵）
  //   isImg        target 是 <img>
  //   inArticle    在主文內、且不在已隱藏的區塊內
  //   width/height 當下渲染尺寸（兩邊都要 >= MIN_SIDE）
  //   anchorHref   包住它的 <a> 的絕對 href（沒有連結給 null）
  //   editActive   編輯模式中（點擊是「隱藏這個元素」）
  // 'pass' 的後續由呼叫端決定（連到文章的圖片連結照常導航；連到圖檔的小圖交給
  // link-follow 的 shouldSwallowImageLinkClick 維持吞掉）。
  function decideClick(info) {
    if (!info) return 'pass';
    if (info.button !== 0) return 'pass';
    if (info.metaKey || info.ctrlKey || info.shiftKey || info.altKey) return 'pass';
    if (!info.isImg || !info.inArticle) return 'pass';
    if (info.editActive) return 'pass';
    if (!(info.width >= MIN_SIDE && info.height >= MIN_SIDE)) return 'pass';
    if (info.anchorHref) return isImageHref(info.anchorHref) ? 'preview' : 'pass';
    return 'preview';
  }

  // srcset 字串 → 最大那張的 URL（w 描述子比寬度、x 描述子比倍率；沒有描述子當 1x）。
  // 回傳 { url, score } 或 null。照 HTML 規格的切法：URL 是一段非空白字元（裡面可以有
  // 逗號，CDN 參數常見），URL 尾端的逗號才是分隔；之後到下一個逗號為止是描述子。
  function pickLargestSrcset(srcset) {
    var s = String(srcset || '');
    var n = s.length;
    var pos = 0;
    var best = null;
    while (pos < n) {
      while (pos < n && /[\s,]/.test(s.charAt(pos))) pos++;
      if (pos >= n) break;
      var start = pos;
      while (pos < n && !/\s/.test(s.charAt(pos))) pos++;
      var url = s.slice(start, pos);
      var desc = '';
      if (/,+$/.test(url)) {
        url = url.replace(/,+$/, '');
      } else {
        var dStart = pos;
        while (pos < n && s.charAt(pos) !== ',') pos++;
        desc = s.slice(dStart, pos).trim();
      }
      if (!url) continue;
      var m = /^(\d+(?:\.\d+)?)([wx])$/.exec(desc);
      var num = m ? parseFloat(m[1]) : 1;
      // w 與 x 不會混用；混到時 w 一律大於 x，等於優先信 w
      var score = m && m[2] === 'w' ? num : num / 1000;
      if (!best || score > best.score) best = { url: url, score: score };
    }
    return best;
  }

  // 預覽要載的大圖。info：{ currentSrc, anchorHref, srcsets: [字串…], baseHref }
  // 優先序：連結指向的原圖 → 所有 srcset（img 自己的＋<picture> 的 <source>）裡最大張。
  // 沒有比頁面上那張更好的候選回 null。回傳絕對 URL。
  function pickHiResSource(info) {
    if (!info) return null;
    var abs = function (u) {
      try { return new URL(u, info.baseHref || undefined).href; } catch (e) { return null; }
    };
    var cur = info.currentSrc ? abs(info.currentSrc) : null;
    var cand = null;
    if (info.anchorHref && isImageHref(info.anchorHref)) {
      cand = abs(info.anchorHref);
    } else {
      var best = null;
      var list = info.srcsets || [];
      for (var i = 0; i < list.length; i++) {
        var b = pickLargestSrcset(list[i]);
        if (b && (!best || b.score > best.score)) best = b;
      }
      if (best) cand = abs(best.url);
    }
    if (!cand || cand === cur) return null;
    if (!/^https?:/i.test(cand)) return null;
    return cand;
  }

  // 下滑關閉的放手判定（純函式）：垂直位移往下、超過門檻、且垂直為主。
  function shouldCloseOnRelease(dx, dy) {
    return dy >= SWIPE_CLOSE_PX && Math.abs(dy) > Math.abs(dx);
  }

  var api = {
    HOST_ID: HOST_ID,
    MIN_SIDE: MIN_SIDE,
    IMG_HREF_RE: IMG_HREF_RE,
    isImageHref: isImageHref,
    decideClick: decideClick,
    pickLargestSrcset: pickLargestSrcset,
    pickHiResSource: pickHiResSource,
    shouldCloseOnRelease: shouldCloseOnRelease
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined') return;
  window.__JReadImageViewer = api;

  var NS = window.__JRead;
  if (!NS) return;
  if (NS.imageViewer) return; // 防重複注入

  // 背景近黑半透明、不分主題；不放關閉鈕；點圖片本身不動作；淡入淡出
  //（Jimmy 2026-11-19 選定）。prefers-reduced-motion 時不做轉場。
  var CSS = [
    '.stage {',
    '  position: fixed; inset: 0;',
    '  display: flex; align-items: center; justify-content: center;',
    '  box-sizing: border-box; padding: 24px;',
    '  background: rgba(0, 0, 0, 0.9);',
    '  opacity: 0; transition: opacity ' + FADE_MS + 'ms ease;',
    '  pointer-events: auto; cursor: default;',
    '  overscroll-behavior: contain;',
    '}',
    '.stage.show { opacity: 1; }',
    '.stage.dragging { transition: none; }',
    'img {',
    '  display: block; flex: 0 0 auto;',
    '  width: auto; height: auto;',
    '  max-width: 100%; max-height: 100%;',
    '  object-fit: contain;',
    '  -webkit-touch-callout: default;',
    '  -webkit-user-select: auto; user-select: auto;',
    '  transition: transform ' + FADE_MS + 'ms ease;',
    '}',
    '.stage.dragging img { transition: none; }',
    '@media (max-width: 600px) { .stage { padding: 0; } }',
    '@media (prefers-reduced-motion: reduce) {',
    '  .stage, img { transition: none; }',
    '}'
  ].join('\n');

  var host = null;
  var stage = null;
  var imgEl = null;
  var preloader = null;
  var closeTimer = null;
  var savedScroll = null;
  var touch = null; // { x, y, dx, dy, vertical: null|true|false }

  function isSvgSrc(src) {
    var s = String(src || '');
    return /\.svg(\?|#|$)/i.test(s) || /^data:image\/svg/i.test(s);
  }

  function isOpen() { return !!host; }

  function onKeydown(e) {
    if (!host) return;
    // 帶 Cmd / Ctrl 的組合（複製、關分頁、瀏覽器縮放）留給瀏覽器
    if (e.metaKey || e.ctrlKey) return;
    if ((e.key === 'Escape' || e.code === 'Escape') && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
      return;
    }
    // 其餘按鍵：不捲底下的文章（Space / 方向鍵 / PageUp / PageDown / Home / End 的
    // 原生捲動）、也不給頁面 JS。Tab 一併擋，焦點不跑到預覽層底下的連結。
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function onKeyOther(e) {
    if (!host) return;
    if (e.metaKey || e.ctrlKey) return;
    e.stopImmediatePropagation();
  }

  function onWheel(e) {
    // ctrl + wheel＝瀏覽器縮放（觸控板捏合也是），不攔
    if (e.ctrlKey) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  }

  function pageZoomed() {
    var vv = window.visualViewport;
    return !!(vv && vv.scale > 1.01);
  }

  function setDrag(dy) {
    if (!stage || !imgEl) return;
    var d = Math.max(0, dy);
    imgEl.style.transform = d ? 'translateY(' + d + 'px)' : '';
    stage.style.opacity = d ? String(Math.max(0.3, 1 - d / 400)) : '';
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1 || pageZoomed()) { touch = null; return; }
    var t = e.touches[0];
    touch = { x: t.clientX, y: t.clientY, dx: 0, dy: 0, vertical: null };
  }
  function onTouchMove(e) {
    // 多指（瀏覽器原生捏合縮放）與已放大時的單指平移都留給瀏覽器
    if (e.touches.length !== 1 || pageZoomed()) { touch = null; if (stage) { stage.classList.remove('dragging'); setDrag(0); } return; }
    // 單指：一律不讓底下的文章捲
    if (e.cancelable) e.preventDefault();
    if (!touch) return;
    var t = e.touches[0];
    touch.dx = t.clientX - touch.x;
    touch.dy = t.clientY - touch.y;
    if (touch.vertical === null &&
        (Math.abs(touch.dx) > SWIPE_SLOP_PX || Math.abs(touch.dy) > SWIPE_SLOP_PX)) {
      touch.vertical = Math.abs(touch.dy) > Math.abs(touch.dx) && touch.dy > 0;
      if (touch.vertical && stage) stage.classList.add('dragging');
    }
    if (touch.vertical) setDrag(touch.dy);
  }
  function onTouchEnd(e) {
    if (e.touches.length > 0) return;
    var st = touch;
    touch = null;
    if (stage) stage.classList.remove('dragging');
    if (st && st.vertical && shouldCloseOnRelease(st.dx, st.dy)) { close(); return; }
    setDrag(0);
  }
  function onTouchCancel() {
    touch = null;
    if (stage) stage.classList.remove('dragging');
    setDrag(0);
  }

  function onStageClick(e) {
    // 事件不外流到頁面的委派 handler
    e.stopPropagation();
    // 點圖片本身不動作（留給第二階段的雙擊縮放）；點背景關閉
    if (e.target === imgEl) return;
    close();
  }

  function stopBubble(e) { e.stopPropagation(); }

  function open(srcImg, opts) {
    if (!srcImg || srcImg.tagName !== 'IMG') return false;
    if (host) close(true);
    var o = opts || {};
    var current = srcImg.currentSrc || srcImg.src || '';
    if (!current) return false;

    host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', '圖片預覽');
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'inset: 0',
      'z-index: 2147483646', // toast（2147483647）之下
      'display: block'
    ].join(';');
    var shadow = host.attachShadow({ mode: 'open' });
    NS.injectShadowCss(shadow, CSS);

    stage = document.createElement('div');
    stage.className = 'stage';
    imgEl = document.createElement('img');
    imgEl.alt = srcImg.alt || '';
    // 與原圖相同的載入條件 → 命中同一份快取、防盜連的站也拿得到
    if (srcImg.referrerPolicy) imgEl.referrerPolicy = srcImg.referrerPolicy;
    if (srcImg.crossOrigin) imgEl.crossOrigin = srcImg.crossOrigin;
    // SVG 沒有可靠的原尺寸（width:auto 會落到瀏覽器預設值）→ 用頁面上的顯示寬
    if (isSvgSrc(current)) {
      var r = srcImg.getBoundingClientRect();
      if (r.width > 0) imgEl.style.width = Math.round(r.width) + 'px';
    }
    imgEl.src = current;
    stage.appendChild(imgEl);
    shadow.appendChild(stage);

    stage.addEventListener('click', onStageClick);
    host.addEventListener('mousedown', stopBubble);
    host.addEventListener('pointerdown', stopBubble);
    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('touchstart', onTouchStart, { passive: true });
    host.addEventListener('touchmove', onTouchMove, { passive: false });
    host.addEventListener('touchend', onTouchEnd, { passive: true });
    host.addEventListener('touchcancel', onTouchCancel, { passive: true });
    window.addEventListener('keydown', onKeydown, true);
    window.addEventListener('keypress', onKeyOther, true);
    window.addEventListener('keyup', onKeyOther, true);

    savedScroll = { x: window.scrollX, y: window.scrollY };
    document.documentElement.appendChild(host);
    // 下一個 frame 才加 .show 讓 opacity 轉場生效；背景分頁 rAF 被節流時用 timer 兜底
    var shown = false;
    var show = function () { if (shown || !stage) return; shown = true; stage.classList.add('show'); };
    try { requestAnimationFrame(show); } catch (_) { /* noop */ }
    setTimeout(show, 50);

    // 背景載入最大可用來源，載完才換（載入失敗就留頁面上那張）
    var hi = o.hiResUrl || null;
    if (hi && !isSvgSrc(current)) {
      var forImg = imgEl;
      preloader = new Image();
      if (srcImg.referrerPolicy) preloader.referrerPolicy = srcImg.referrerPolicy;
      if (srcImg.crossOrigin) preloader.crossOrigin = srcImg.crossOrigin;
      preloader.onload = function () {
        if (imgEl !== forImg || !this.naturalWidth) return;
        // 候選反而比較小（連結指向縮圖）就不換
        if (forImg.naturalWidth && this.naturalWidth < forImg.naturalWidth) return;
        forImg.src = hi;
      };
      preloader.onerror = function () { /* 留原本那張 */ };
      preloader.src = hi;
    }
    return true;
  }

  function teardown(h) {
    if (h && h.parentNode) h.parentNode.removeChild(h);
  }

  // immediate＝不做淡出（退出閱讀模式、切換模式時）
  function close(immediate) {
    if (!host) return;
    var h = host;
    var st = stage;
    window.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('keypress', onKeyOther, true);
    window.removeEventListener('keyup', onKeyOther, true);
    if (preloader) { preloader.onload = null; preloader.onerror = null; preloader.src = ''; preloader = null; }
    host = null; stage = null; imgEl = null; touch = null;
    // 預覽期間底下不該捲動；真的被動到（瀏覽器原生行為漏網）就放回原位
    var sv = savedScroll;
    savedScroll = null;
    if (sv && (window.scrollX !== sv.x || window.scrollY !== sv.y)) {
      try { window.scrollTo(sv.x, sv.y); } catch (_) { /* noop */ }
    }
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { /* noop */ }
    if (immediate || reduce || !st) { teardown(h); return; }
    // 淡出期間不再接事件（否則連點會落在正在消失的層上）
    h.style.pointerEvents = 'none';
    st.style.opacity = '';
    st.classList.remove('show');
    setTimeout(function () { teardown(h); }, FADE_MS + 30);
  }

  // main.js 的 click handler 用：收集 DOM 事實 → 決策 → 開預覽。回傳是否已開。
  function handleClick(e, articleEl) {
    var t = e.target;
    if (!t || t.tagName !== 'IMG' || !articleEl) return false;
    var a = t.closest ? t.closest('a[href]') : null;
    var r = t.getBoundingClientRect();
    var decision = decideClick({
      button: e.button,
      metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey,
      isImg: true,
      inArticle: articleEl.contains(t) && !(t.closest && t.closest('[data-jread-hidden="1"]')),
      width: r.width,
      height: r.height,
      anchorHref: a ? a.href : null,
      editActive: !!(NS.editMode && typeof NS.editMode.isActive === 'function' && NS.editMode.isActive())
    });
    if (decision !== 'preview') return false;
    var srcsets = [];
    if (t.getAttribute('srcset')) srcsets.push(t.getAttribute('srcset'));
    var pic = t.parentElement && t.parentElement.tagName === 'PICTURE' ? t.parentElement : null;
    if (pic) {
      var sources = pic.querySelectorAll('source[srcset]');
      for (var i = 0; i < sources.length; i++) {
        // 有 media 條件且當下不符合的來源不算（那是別的版面用的裁切）
        var media = sources[i].getAttribute('media');
        var ok = true;
        if (media) { try { ok = window.matchMedia(media).matches; } catch (_) { ok = false; } }
        // 當下圖是哪種格式瀏覽器已經選好；不同 type 的 <source> 不一定解得開，
        // 只收沒有 type 或與 currentSrc 同一個 <source> 的
        var type = sources[i].getAttribute('type');
        if (ok && (!type || sources[i].getAttribute('srcset').indexOf(lastPathSeg(t.currentSrc)) !== -1)) {
          srcsets.push(sources[i].getAttribute('srcset'));
        }
      }
    }
    var hi = pickHiResSource({
      currentSrc: t.currentSrc || t.src,
      anchorHref: a ? a.href : null,
      srcsets: srcsets,
      baseHref: document.baseURI
    });
    return open(t, { hiResUrl: hi });
  }

  function lastPathSeg(u) {
    try { return new URL(u, document.baseURI).pathname.split('/').pop() || '\u0000'; } catch (_) { return '\u0000'; }
  }

  NS.imageViewer = {
    isOpen: isOpen,
    open: open,
    close: close,
    handleClick: handleClick
  };
})(typeof window !== 'undefined' ? window : this);
