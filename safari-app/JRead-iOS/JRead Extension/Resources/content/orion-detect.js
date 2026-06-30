// content/orion-detect.js — 在「頁面 main world」偵測 Orion（Kagi）瀏覽器，
// 替 <html> 蓋 .jread-orion + 設 --jread-orion-top，交給隔離世界的 styler 用 CSS gating。
//
// 【為什麼需要這支 main-world script】
// Orion 把專屬 global（window.kagi / window.KAGI / window.__kagi_native_fetch /
// __kagi_native_XHR_open …）注入「頁面」world。JReader 其餘 content script 跑在
// 隔離世界（isolated world），讀不到頁面 world 的 window——這跟 harness 那條
// `page.evaluate(()=>window.__JRead)` 永遠 false 是同一個隔離世界限制。故本檔在
// manifest 宣告 `world: "MAIN"`，於頁面 world 讀到 Orion 指紋後，透過 shared DOM
// （<html> 的 class / CSS 變數）把訊號傳給隔離世界的 styler。
//
// 【為什麼用 window.kagi 而非 UA / env()】（實機探針 docs/orion-probe 實證）
//   - UA 死：Orion 把 navigator.userAgent 完全偽裝成 Safari（…Version/26.4 Safari/604.1），
//     無 "Orion" 字樣。
//   - env() 死：Orion 不回報 env(safe-area-inset-*)，四向全 0、即使 viewport-fit=cover。
//   - 只有 window.kagi 這條乾淨——Safari 完全沒有這些 global。
// 結構性條件（瀏覽器注入專屬 global + 不保留 top safe area），偵測隔離在本檔，
// 非主偵測/排版邏輯的站點特判。
//
// 【為什麼補 top inset = 常數而非 env()】
// Orion 不吐 env，且 UA 偽裝 Safari，沒有任何 API 拿得到真實 inset。改依
// screen.height 分檔取「長螢幕（瀏海 / Dynamic Island）59px」或「舊機狀態列 20px」。
// 瀏海機真實 inset ~47、島 ~59，統一取 59 涵蓋（瀏海機多 ~12px 上緣留白、可接受、
// 永不裁切標題）。
(function () {
  'use strict';

  function isOrion() {
    try {
      return !!(window.kagi || window.KAGI ||
                window.__kagi_native_fetch || window.__kagi_native_XHR_open);
    } catch (e) {
      return false;
    }
  }

  function topInset() {
    var h = 0;
    try { h = (window.screen && window.screen.height) || 0; } catch (e) {}
    // CSS px 螢幕高分檔：>=812 = X 系以上長螢幕（瀏海 / Dynamic Island）→ 59px；
    // 其餘（home button / 矮螢幕）→ 20px 狀態列。
    return h >= 812 ? 59 : 20;
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

  // window.kagi 的注入時機相對本 script（document_start）未知——先試一次，
  // 沒中再在 DOMContentLoaded / load 補試，確保最終蓋上。
  if (!mark()) {
    try {
      document.addEventListener('DOMContentLoaded', mark, { once: true });
      window.addEventListener('load', mark, { once: true });
    } catch (e) {}
  }
})();
