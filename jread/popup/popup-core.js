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
    'content/keepalive.js',
    'content/settings-defaults.js',
    'content/domain-match.js',
    'content/shortcut-utils.js',
    'content/custom-shortcuts.js',
    'content/touch-gestures.js',
    'content/toast.js',
    'content/cinema-mode.js',
    'content/youtube-borderless.js',
    'content/x-thread.js',
    'content/fb-post.js',
    'content/detector.js',
    'content/cleaner.js',
    'content/styler.js',
    'content/space-scroll.js',
    'content/paged-mode.js',
    'content/main.js'
  ];

  /**
   * 對指定 tab 送任意訊息；sendMessage 失敗時主動注入 content scripts 後重試一次。
   * v0.7.228：從 toggleWithInjectionFallback 抽出泛用版——SW dispatchCommand
   * 委派 DISPATCH_COMMAND 給 content 端時共用同一條 injection fallback。
   * @param {number} tabId
   * @param {object} msg 要送的訊息物件
   * @param {object} deps 依賴注入：
   *   - sendMessage(tabId, msg) → Promise
   *   - executeScript({ target:{tabId}, files }) → Promise
   * @returns {Promise<{ok:boolean, res?:any, injected?:boolean, error?:any}>}
   */
  async function sendWithInjectionFallback(tabId, msg, deps) {
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

  /** 對指定 tab 嘗試 toggle 閱讀模式（popup 主按鈕 / SW cinema 退出路徑用）。 */
  async function toggleWithInjectionFallback(tabId, deps) {
    return sendWithInjectionFallback(tabId, { type: 'TOGGLE_READER_MODE' }, deps);
  }

  // ---- Readwise Reader integration（v0.7.33）-----------------------------
  // 依官方 API（https://readwise.io/reader_api）：
  //   POST https://readwise.io/api/v3/save/
  //   Header: Authorization: Token <access_token>
  //   Body:   { url, html?, title?, image_url?, author?, summary?,
  //            published_date?, location?, category?, tags?, notes? }
  // 200 = 已存在、201 = 新建。
  // 註：Readwise Reader API 沒 `language` 欄位（送了會被忽略）——所以 JRead
  // 不抽 / 不送 language。
  const READWISE_API_URL = 'https://readwise.io/api/v3/save/';

  function buildReadwisePayload({ url, html, title, imageUrl, author, publishedDate } = {}) {
    if (!url || typeof url !== 'string') {
      throw new Error('buildReadwisePayload: url 必填');
    }
    const body = { url };
    if (html && typeof html === 'string') body.html = html;
    if (title && typeof title === 'string') body.title = title;
    // v0.7.166：image_url 帶主圖 URL（Readwise Reader 用為 cover image）。
    // 必須是 http/https absolute URL——data:/blob: 已在 extractReaderPayload
    // 端 normalize 過、這裡再防呆一層，避免直接送 throw 整個 payload。
    if (imageUrl && typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl)) {
      body.image_url = imageUrl;
    }
    // v0.7.167：author 單一字串（一般站抽 byline / JSON-LD;FB 送 vanity
    // username 或 displayName fallback;X / Twitter 送 @handle）。
    if (author && typeof author === 'string') {
      const t = author.trim();
      if (t) body.author = t;
    }
    // v0.7.167：published_date ISO 8601 字串（content script 端 normalize 過,
    // 此處只防呆 trim）。
    if (publishedDate && typeof publishedDate === 'string') {
      const t = publishedDate.trim();
      if (t) body.published_date = t;
    }
    return body;
  }

  async function saveToReadwise({ token, payload, fetchImpl } = {}) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return { ok: false, error: 'NO_FETCH' };
    if (!token || typeof token !== 'string' || !token.trim()) {
      return { ok: false, error: 'NO_TOKEN' };
    }
    let res;
    try {
      res = await f(READWISE_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${token.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (networkErr) {
      return { ok: false, error: 'NETWORK', message: String(networkErr && networkErr.message || networkErr) };
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* 非 JSON response 忽略 */ }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, error: 'AUTH', data };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: 'HTTP', data };
    }
    return { ok: true, status: res.status, data };
  }

  const api = {
    sendWithInjectionFallback,
    toggleWithInjectionFallback,
    CONTENT_SCRIPT_FILES,
    buildReadwisePayload,
    saveToReadwise,
    READWISE_API_URL
  };

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
