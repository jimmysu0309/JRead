// content/orion-detect.js — 偵測 Orion（Kagi）瀏覽器，替 <html> 蓋 .jread-orion +
// 設 --jread-orion-top，交給 styler 用 CSS gating 補頂端 safe-area。
//
// 【為什麼三種偵測 + 兩個 world 都掛】
// Orion 雖跑 WebExtension（Jimmy 實機用的是 Firefox build），但底層是 WebKit + 相容層、
// 非真 Gecko，且 Orion 把專屬指紋（window.kagi / window.KAGI / window.__kagi_native_*）
// 注入「頁面 main world」。從擴充偵測它要跨越 isolated↔main world，各引擎做法不同：
//   1. 直接 window.kagi —— 若 Orion 的 isolated world 隔離不完全（相容層常見）即可讀到。
//   2. window.wrappedJSObject.kagi —— Gecko 從 content script 讀頁面 main world 的 idiom。
//   3. 注入 inline <script> 到頁面 —— 該 script 在 page main world 執行讀 window.kagi、
//      stamp 一個 shared DOM 屬性回傳。最通用、不依賴 world:MAIN 支援，幾乎所有擴充環境
//      都 work（唯一例外：頁面嚴格 CSP script-src 擋 inline → 該站偵測失敗、優雅降級）。
// 本檔同時掛兩個 content_scripts entry：world:MAIN（若引擎支援，直接讀 window.kagi）+
// 隔離世界（必跑，走上面三法）。兩世界同檔、idempotent，命中一個即蓋 class。
//
// 【為什麼偵測 Orion 而非用 env() / UA】（docs/orion-probe 實機探針實證）
//   - UA 死：Orion 把 navigator.userAgent 完全偽裝成 Safari（無 "Orion"）。
//   - env() 死：Orion 不回報 env(safe-area-inset-*)，四向全 0、即使 viewport-fit=cover。
//   - 只有 window.kagi 乾淨。Safari 完全沒有這些 global → 本檔在 Safari 不蓋 class、零回歸。
// 結構性條件（瀏覽器注入專屬 global + edge-to-edge 不保留 top safe area），偵測隔離在本檔。
//
// 【top inset 為何用常數】Orion 不吐 env，沒 API 拿真實 inset；依 screen.height 分檔：
// >=812 長螢幕（瀏海 / Dynamic Island）59px、其餘舊機 20px（瀏海機多 ~12px 上緣留白、可接受）。
(function () {
  'use strict';

  function topInset() {
    var h = 0;
    try { h = (window.screen && window.screen.height) || 0; } catch (e) {}
    return h >= 812 ? 59 : 20;
  }

  // 法 1：直接讀（main world，或隔離不完全的相容層）
  function directKagi() {
    try {
      return !!(window.kagi || window.KAGI ||
                window.__kagi_native_fetch || window.__kagi_native_XHR_open);
    } catch (e) { return false; }
  }

  // 法 2：Gecko wrappedJSObject —— 從 content script 隔離世界穿到頁面 main world
  function wrappedKagi() {
    try {
      var w = window.wrappedJSObject;
      return !!(w && (w.kagi || w.KAGI || w.__kagi_native_fetch));
    } catch (e) { return false; }
  }

  // 法 3：注入 inline <script> 到頁面 main world 讀 window.kagi、stamp shared DOM 屬性
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

  function isOrion() {
    return directKagi() || wrappedKagi() || injectedKagi();
  }

  function mark() {
    try {
      if (!isOrion()) return false;
      var de = document.documentElement;
      if (!de) return false;
      de.classList.add('jread-orion');
      de.style.setProperty('--jread-orion-top', topInset() + 'px');
      return true;
    } catch (e) {
      return false;
    }
  }

  // window.kagi 的注入時機相對本 script 未知——先試一次，沒中再在
  // DOMContentLoaded / load 補試（注入頁面腳本與 wrappedJSObject 都要 DOM ready）。
  if (!mark()) {
    try {
      document.addEventListener('DOMContentLoaded', mark, { once: true });
      window.addEventListener('load', mark, { once: true });
    } catch (e) {}
  }
})();
