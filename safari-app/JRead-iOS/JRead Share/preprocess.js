// preprocess.js — JRead 分享擴充的前置 JS（v3.2.0，NSExtensionJavaScriptPreprocessingFile）
//
// Safari 在使用者於分享面板點 JRead 時，於目前頁面執行本檔的 run()。本檔不自己抽內容，
// 也不等內容：Safari 只等前置 JS 約 1～2.5 秒（模擬器實測：延遲 1 秒正常、2.5 秒起交出空值），
// 長文光進閱讀模式就超過。所以只向頁面上的 JRead content script 送出請求、等它回 ack 就帶著
// 請求 id 結束；內容由 content script 抽完後經 background → 原生 handler 寫進 App Group 收件匣，
// 分享擴充依 id 取件（content/main.js handleShareExtractRequest、Shared/ShareInbox.swift）。
// 抽的是與懸浮按鈕「送到…」同一份 extractReaderPayload（清過雜訊、已翻譯、含編輯模式移除的段落）。
//
// 協定（字串 detail，跨 isolated world 最保險）：
//   請求 window event 'jread-share-extract-request'，detail＝本次 id
//   回應 window event 'jread-share-extract-response'，detail＝JSON {id, stage:'ack', ok, reason?}
// ACK_MS 內沒有 ack＝這頁沒有 JRead（未允許存取此網站 / 非 http 頁面）。ACK_MS 必須遠小於 Safari 的上限
var ExtensionPreprocessingJS = {
  run: function (args) {
    var ACK_MS = 800;
    var id = 'jrs' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    var done = false;
    var timer = null;
    function finish(obj) {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('jread-share-extract-response', onResponse);
      obj.pageUrl = String(location.href || '');
      args.completionFunction(obj);
    }
    function onResponse(e) {
      var d = null;
      try { d = JSON.parse(e.detail); } catch (_) { return; }
      if (!d || d.id !== id || d.stage !== 'ack') return;
      if (d.ok) finish({ requestId: id });
      else finish({ error: String(d.reason || 'ERROR') });
    }
    window.addEventListener('jread-share-extract-response', onResponse);
    timer = setTimeout(function () { finish({ error: 'NO_JREAD' }); }, ACK_MS);
    window.dispatchEvent(new CustomEvent('jread-share-extract-request', { detail: id }));
  },
  finalize: function () {}
};
