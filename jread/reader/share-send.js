// share-send.js — iOS / iPadOS 分享擴充的送出頁（v3.2.0）
//
// 分享擴充（safari-app/JRead-iOS/JRead Share）流程：
//   1. Safari 執行前置 JS（JRead Share/preprocess.js），請頁面上的 JRead content script
//      交出 extractReaderPayload 的結果（content/main.js handleShareExtractRequest）
//   2. 分享擴充在看不見的 WKWebView 載入本頁，呼叫 __jreadShareSend(payload)
//   3. 本頁走 popup-core.saveDocumentFlow 送出——與懸浮按鈕「送到…」、快速鍵、popup 同一條
//      流程（憑證解析 → 選用 Gemini 摘要 → sendDocument → 結果文案），不另寫一份
// 進度用 webkit.messageHandlers.jreadShare 回報給原生卡片（文字取 SAVE_PROGRESS 單一資料源）
(function () {
  'use strict';

  function postProgress(text) {
    try {
      const h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.jreadShare;
      if (h) h.postMessage({ type: 'progress', text: String(text || '') });
    } catch (_) { /* 進度回報失敗不影響送出 */ }
  }

  async function send(payload) {
    const P = window.__JReadPopup;
    if (!P) return { ok: false, message: '送出失敗：模組未載入', kind: 'error' };
    let settings;
    try {
      settings = await browser.storage.sync.get(P.serviceSettingsQuery({ readwiseSummary: false, geminiApiKey: '' }));
    } catch (_) {
      return { ok: false, message: '無法讀取設定，請稍後再試', kind: 'error' };
    }
    try {
      const { toast, result } = await P.saveDocumentFlow({
        settings,
        payload: payload || {},
        credsPlace: ' Safari 的 JRead 設定頁',
        onProgress: (stage) => postProgress(P.SAVE_PROGRESS[stage] || P.SAVE_PROGRESS.sending)
      });
      return { ok: !!(result && result.ok), message: toast.message, kind: toast.kind };
    } catch (err) {
      const reason = String((err && err.message) || err || '').slice(0, 60);
      return { ok: false, message: `送出失敗（${reason || '內部錯誤'}）`, kind: 'error' };
    }
  }

  window.__jreadShareSend = send;
})();
