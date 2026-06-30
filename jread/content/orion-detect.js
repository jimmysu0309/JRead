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

  // 診斷橫幅：只在隔離世界（有 DOM + 較穩）渲染一次，讀各訊號
  function renderDiag(sig) {
    try {
      if (!ORION_DIAG) return;
      if (document.getElementById('__jread-orion-diag')) return;
      var de = document.documentElement;
      var mwRan = de.getAttribute('data-jread-orion-mw') === '1';
      var bar = document.createElement('div');
      bar.id = '__jread-orion-diag';
      bar.setAttribute('style',
        'position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
        'background:#111;color:#0f0;font:11px/1.45 ui-monospace,Menlo,monospace;' +
        'padding:6px 8px;white-space:normal;word-break:break-all;border-bottom:2px solid #0f0;');
      var ua = '';
      try { ua = navigator.userAgent || ''; } catch (e) {}
      var sh = 0;
      try { sh = (window.screen && window.screen.height) || 0; } catch (e) {}
      bar.textContent =
        'JR-ORION-DIAG  orion=' + (sig.orion ? 'YES' : 'no') +
        ' | direct=' + (sig.direct ? 'Y' : 'n') +
        ' wrapExists=' + (sig.wrapExists ? 'Y' : 'n') +
        ' wrap=' + (sig.wrap ? 'Y' : 'n') +
        ' inject=' + (sig.inject ? 'Y' : 'n') +
        ' | mainWorldEntryRan=' + (mwRan ? 'Y' : 'n') +
        ' | sh=' + sh +
        ' | UA=' + ua;
      var mount = function () {
        try { (document.body || document.documentElement).appendChild(bar); } catch (e) {}
      };
      if (document.body) mount();
      else document.addEventListener('DOMContentLoaded', mount, { once: true });
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
