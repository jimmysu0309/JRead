// content/orion-detect.js — 偵測 Orion（Kagi）瀏覽器，替 <html> 蓋 .jread-orion +
// 設 --jread-orion-top，交給 styler 用 CSS gating 補頂端 safe-area。
//
// 【掛在哪】此檔掛兩處 content_scripts entry：
//   - content_scripts[0] 主清單（隔離世界，document_idle）—— JReader 其他功能在 Orion
//     能跑＝此 entry 必執行（v1.5.18→19 用「分開的 entry」在 Orion 完全沒生效，疑似
//     Orion 只跑 content_scripts[0]、忽略額外 entry；故移進主清單）。
//   - 獨立 world:MAIN entry（document_start）—— 引擎支援時直接讀頁面 window.kagi。
//
// 【偵測法】Orion 把專屬指紋（window.kagi / window.__kagi_native_*）注入「頁面 main
// world」；從擴充跨 isolated↔main world 各引擎做法不同，三法輪試命中即套：
//   1. 直接 window.kagi（隔離不完全的相容層）
//   2. window.wrappedJSObject.kagi（Gecko content script 穿 main world idiom）
//   3. 注入 inline <script> 到頁面讀 window.kagi → stamp shared DOM 屬性回傳（最通用）
//
// 【為何偵測 Orion 而非 env()/UA】UA 偽裝 Safari、env(safe-area) 全 0（docs/orion-probe
// 實機探針），只有 window.kagi 乾淨；Safari 無此 global → 不蓋 class、零回歸。
//
// 【ORION_DIAG 診斷橫幅】Orion 是黑盒（模擬器裝不了、無法本機重現），三法在 Orion 全
// 失效時無從得知哪一法該調。開 ORION_DIAG 時每頁頂端顯示偵測結果（哪一法讀到 kagi、
// world:MAIN entry 有沒有跑、UA、screen.height），Jimmy 截一張圖即可定位。確認修法生效
// 後把 ORION_DIAG 設 false（或移除本診斷段）。
(function () {
  'use strict';

  var ORION_DIAG = true; // ← 確認 Orion 修法生效後設 false

  // world 判定：隔離世界有擴充 API（browser/chrome.runtime.id），main world 沒有
  function inMainWorld() {
    try {
      if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.id) return false;
    } catch (e) {}
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) return false;
    } catch (e) {}
    return true;
  }

  function topInset() {
    var h = 0;
    try { h = (window.screen && window.screen.height) || 0; } catch (e) {}
    return h >= 812 ? 59 : 20;
  }

  function directKagi() {
    try {
      return !!(window.kagi || window.KAGI ||
                window.__kagi_native_fetch || window.__kagi_native_XHR_open);
    } catch (e) { return false; }
  }
  function wrappedExists() {
    try { return typeof window.wrappedJSObject !== 'undefined' && !!window.wrappedJSObject; }
    catch (e) { return false; }
  }
  function wrappedKagi() {
    try {
      var w = window.wrappedJSObject;
      return !!(w && (w.kagi || w.KAGI || w.__kagi_native_fetch));
    } catch (e) { return false; }
  }
  function injectedKagi() {
    try {
      var FLAG = 'data-jread-orion-probe';
      var s = document.createElement('script');
      s.textContent =
        "try{if(window.kagi||window.KAGI||window.__kagi_native_fetch||window.__kagi_native_XHR_open)" +
        "{document.documentElement.setAttribute('" + FLAG + "','1')}}catch(e){}";
      (document.head || document.documentElement || document).appendChild(s);
      s.remove();
      var hit = document.documentElement.getAttribute(FLAG) === '1';
      if (hit) document.documentElement.removeAttribute(FLAG);
      return hit;
    } catch (e) { return false; }
  }

  function applyOrion() {
    try {
      var de = document.documentElement;
      if (!de) return false;
      de.classList.add('jread-orion');
      de.style.setProperty('--jread-orion-top', topInset() + 'px');
      return true;
    } catch (e) { return false; }
  }

  // 診斷橫幅：靜態偵測結果 + 即時（interval）閱讀模式 computed 值，定位卡在哪一層
  function renderDiag(sig) {
    try {
      if (!ORION_DIAG) return;
      if (document.getElementById('__jread-orion-diag')) return;
      var bar = document.createElement('div');
      bar.id = '__jread-orion-diag';
      bar.setAttribute('style',
        'position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
        'background:#111;color:#0f0;font:10px/1.4 ui-monospace,Menlo,monospace;' +
        'padding:5px 8px;white-space:normal;word-break:break-all;border-bottom:2px solid #0f0;');
      var sh = 0;
      try { sh = (window.screen && window.screen.height) || 0; } catch (e) {}
      var staticLine =
        'JR-ORION-DIAG orion=' + (sig.orion ? 'YES' : 'no') +
        ' direct=' + (sig.direct ? 'Y' : 'n') +
        ' inject=' + (sig.inject ? 'Y' : 'n') +
        ' sh=' + sh;
      function liveLine() {
        try {
          var de = document.documentElement;
          var orionCls = de.classList.contains('jread-orion');
          var activeCls = de.classList.contains('__jread-active');
          var cssVar = '';
          try { cssVar = getComputedStyle(de).getPropertyValue('--jread-orion-top').trim(); } catch (e) {}
          var bodyPad = '';
          try { bodyPad = getComputedStyle(document.body).paddingTop; } catch (e) {}
          var art = document.querySelector('[data-jread-active="1"]');
          var artInfo = 'noCard';
          if (art) {
            var acs = getComputedStyle(art);
            var titleEl = art.querySelector('h1,h2,h3,p,[data-jread-byline]') || art;
            var tTop = Math.round(titleEl.getBoundingClientRect().top);
            artInfo = 'cardPos=' + acs.position + ' cardTop=' + acs.top + ' titleTop=' + tTop;
          }
          return 'RM orionCls=' + (orionCls ? 'Y' : 'n') +
            ' activeCls=' + (activeCls ? 'Y' : 'n') +
            ' var=' + (cssVar || '∅') +
            ' bodyPadTop=' + (bodyPad || '?') +
            ' ' + artInfo;
        } catch (e) { return 'RM err'; }
      }
      var BAR_STYLE =
        'position:fixed !important;top:0 !important;left:0 !important;right:0 !important;' +
        'z-index:2147483647 !important;display:block !important;visibility:visible !important;' +
        'opacity:1 !important;background:#111 !important;color:#0f0 !important;' +
        'font:10px/1.4 ui-monospace,Menlo,monospace !important;padding:5px 8px !important;' +
        'white-space:normal !important;word-break:break-all !important;border-bottom:2px solid #0f0 !important;';
      function refresh() {
        try {
          // cleaner 動態 observer 在閱讀模式會藏掉非主文元素 / 設 display:none——
          // 每次刷新都重掛到 <html>（不掛 body）+ 強制重設 inline !important 樣式蓋回。
          if (!bar.isConnected) { try { document.documentElement.appendChild(bar); } catch (e) {} }
          bar.setAttribute('style', BAR_STYLE);
          bar.textContent = staticLine + '  ||  ' + liveLine();
        } catch (e) {}
      }
      var mount = function () {
        try {
          document.documentElement.appendChild(bar); // 掛 <html> 不掛 body，避開 cleaner observer
          refresh();
          // 閱讀模式在進場後才套——每 700ms 刷新即時值 + 重掛，捕捉 reader-mode 後的 computed 狀態
          setInterval(refresh, 700);
        } catch (e) {}
      };
      mount();
    } catch (e) {}
  }

  function run() {
    var main = inMainWorld();
    if (main) {
      // world:MAIN entry：標記「我跑了」+ 直接讀 kagi（main world 看得到就設 class）
      try { document.documentElement.setAttribute('data-jread-orion-mw', '1'); } catch (e) {}
      if (directKagi()) applyOrion();
      return true; // main world 不渲染橫幅（避免雙重）
    }
    // 隔離世界：三法輪試
    var sig = {
      direct: directKagi(),
      wrapExists: wrappedExists(),
      wrap: wrappedKagi(),
      inject: injectedKagi(),
    };
    sig.orion = sig.direct || sig.wrap || sig.inject;
    if (sig.orion) applyOrion();
    renderDiag(sig);
    return sig.orion;
  }

  // kagi 注入時機未知——先試一次，沒中再在 DOMContentLoaded / load 補試。
  if (!run()) {
    try {
      document.addEventListener('DOMContentLoaded', run, { once: true });
      window.addEventListener('load', run, { once: true });
    } catch (e) {}
  }
})();
