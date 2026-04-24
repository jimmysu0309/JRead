// JRead — Popup 核心函式層（可單獨測試）
// 不碰 DOM、不直接呼叫 chrome API，純邏輯 + 依賴注入。
// 同時支援 browser script（掛 window.__JReadPopup）與 Node require（module.exports）。

(function () {
  'use strict';

  // MV3 content_scripts 只自動注入「新載入的分頁」。extension 安裝/重新載入
  // 前已開著的分頁必須主動注入。**順序與完整清單必須與 manifest.json 的
  // content_scripts[0].js 完全一致**——test/regression/popup-inject-retry.spec.js
  // 有 forcing function 讀 manifest 比對，任一檔案漏掉或順序錯會 fail。
  // （歷史教訓：v0.4.0 新增 toast.js 後此清單漏補、inject fallback 後
  // NS.toast=null 使 toast 提示靜默失效；v0.7.19 補上並加 spec 防呆。）
  const CONTENT_SCRIPT_FILES = [
    'content/namespace.js',
    'content/toast.js',
    'content/detector.js',
    'content/cleaner.js',
    'content/styler.js',
    'content/main.js'
  ];

  /**
   * 對指定 tab 嘗試 toggle；sendMessage 失敗時主動注入 content scripts 後重試一次。
   * @param {number} tabId
   * @param {object} deps 依賴注入：
   *   - sendMessage(tabId, msg) → Promise
   *   - executeScript({ target:{tabId}, files }) → Promise
   * @returns {Promise<{ok:boolean, res?:any, injected?:boolean, error?:any}>}
   */
  async function toggleWithInjectionFallback(tabId, deps) {
    const msg = { type: 'TOGGLE_READER_MODE' };
    try {
      const res = await deps.sendMessage(tabId, msg);
      return { ok: true, res, injected: false };
    } catch (firstErr) {
      try {
        await deps.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES });
        const res = await deps.sendMessage(tabId, msg);
        return { ok: true, res, injected: true };
      } catch (secondErr) {
        return { ok: false, error: secondErr };
      }
    }
  }

  const api = { toggleWithInjectionFallback, CONTENT_SCRIPT_FILES };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    // 瀏覽器端 window / MV3 service worker 的 self 都可讀 globalThis
    const g = (typeof globalThis !== 'undefined') ? globalThis
            : (typeof window !== 'undefined') ? window
            : self;
    g.__JReadPopup = api;
  }
})();
