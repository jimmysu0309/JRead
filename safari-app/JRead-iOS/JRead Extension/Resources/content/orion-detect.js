// content/orion-detect.js — 偵測 Orion（Kagi）瀏覽器，替 <html> 蓋 .jread-orion +
// 設 --jread-orion-top，交給 styler 用 CSS gating 補頂端 safe-area（標題不被 Dynamic
// Island 蓋）。Orion 實機驗證生效（Jimmy 2026-06-30，titleTop 0→94、padding 套上 59px）。
//
// 【掛在哪】此檔掛兩處 content_scripts entry：
//   - content_scripts[0] 主清單（隔離世界，document_idle）—— **主力**。Orion 疑似只跑
//     content_scripts[0]、忽略額外 entry（v1.5.18→19 用「分開的 entry」在 Orion 完全沒
//     生效，移進主清單 + document_idle 後才成功）；且 Orion 隔離世界讀得到頁面 window.kagi
//     （direct=Y 實證），不需 world:MAIN。
//   - 獨立 world:MAIN entry（document_start）—— 保留，引擎支援時直接讀（無害備援）。
//
// 【偵測法】Orion 把專屬指紋（window.kagi / window.__kagi_native_*）注入「頁面 main
// world」。兩法輪試命中即套（實機 direct=Y）：
//   1. 直接 window.kagi（Orion 隔離世界讀得到）—— 主力，實機實證命中
//   2. window.wrappedJSObject.kagi（Gecko content script 穿 main world idiom）
//
// 【為何拿掉「注入 inline <script>」第三法】（Jimmy 2026-06-30，Chrome console 實證）
//   早期第三法注入 inline <script> 到頁面讀 window.kagi、stamp DOM 屬性回傳。但：
//   - Orion 實機 direct=Y，短路求值第一法就命中，注入法在 Orion 永遠走不到。
//   - 在 Chrome / Safari（非 Orion）前兩法必 false → 一定 fall through 到注入法；
//     遇嚴格 CSP 站（script-src 無 'unsafe-inline'，如 upmedia.mg）inline script 執行
//     被瀏覽器層擋下，狂噴 CSP 違規 console error。且該 error 是非同步瀏覽器層阻擋、
//     try/catch 抓不掉。
//   => 注入法對 Orion 冗餘、對其他瀏覽器是純 console 噪音，移除。零功能損失。
//
// 【為何偵測 Orion 而非 env()/UA】（docs/orion-probe 實機探針實證）
//   - UA 死：Orion 把 navigator.userAgent 完全偽裝成 Safari（無 "Orion"）；連 content
//     script 的 UA 都被報成 Chrome 桌面、與頁面 UA 不同。
//   - env() 死：Orion 不回報 env(safe-area-inset-*)，四向全 0、即使 viewport-fit=cover。
//   - 只有 window.kagi 乾淨。Safari 無此 global → 不蓋 class、零回歸。
// 結構性條件（瀏覽器注入專屬 global + edge-to-edge 不保留 top safe area），偵測隔離在本檔。
//
// 【top inset 為何用常數】Orion 不吐 env，依 screen.height 分檔：>=812 長螢幕（瀏海 /
// Dynamic Island）59px、其餘舊機 20px。
(function () {
  'use strict';

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
  function wrappedKagi() {
    try {
      var w = window.wrappedJSObject;
      return !!(w && (w.kagi || w.KAGI || w.__kagi_native_fetch));
    } catch (e) { return false; }
  }
  function isOrion() {
    return directKagi() || wrappedKagi();
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

  // kagi 暴露時機未知——先試一次，沒中再在 DOMContentLoaded / load 補試
  // （wrappedJSObject 需 DOM ready）。
  if (!mark()) {
    try {
      document.addEventListener('DOMContentLoaded', mark, { once: true });
      window.addEventListener('load', mark, { once: true });
    } catch (e) {}
  }
})();
