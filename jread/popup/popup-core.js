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
    'content/edit-mode.js',
    'content/styler.js',
    'content/space-scroll.js',
    'content/paged-mode.js',
    'content/position-memory.js',
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
  // v0.8.64：token 驗證端點。官方 GET /api/v2/auth/ 帶 Authorization: Token <token>，
  // 有效回 204 No Content、無效回 401——比 POST /save/ 輕量（不建任何文件、不需 payload），
  // 是 options 頁「測試 token」按鈕的正解。
  const READWISE_AUTH_URL = 'https://readwise.io/api/v2/auth/';

  function buildReadwisePayload({ url, html, title, imageUrl, author, publishedDate, summary } = {}) {
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
    // v0.8.72：summary 由 Gemini Flash Lite 端產生（繁中三句）後帶入。提供 summary
    // 會覆蓋 Readwise server 端自動生成的英文摘要（官方 API 有 summary 欄位）。
    if (summary && typeof summary === 'string') {
      const t = summary.trim();
      if (t) body.summary = t;
    }
    return body;
  }

  // ---- Gemini Flash Lite 摘要（v0.8.72）---------------------------------
  // 送 Readwise 前用 Gemini 產生繁中三句摘要，取代 Readwise server 端的英文自動
  // 摘要。Prompt 移植自 Readwise Reader 網站內建 summarize prompt（Jimmy 提供），
  // 去掉 Jinja num_tokens 分支（central_paragraphs / central_sentences 是 Readwise
  // server 端 filter，client 無法重現）——改為 client 端把內文 head-truncate 到
  // GEMINI_MAX_CHARS 內直接送，三句摘要靠開頭段落已足夠（長文末段對 big idea
  // 貢獻低）。model 用 -latest 別名自動指向最新 flash-lite。
  const GEMINI_MODEL = 'gemini-flash-lite-latest';
  const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
  // 內文上限（字元）。Flash Lite context 很大，但限長控制 latency / 成本——超過
  // 部分截掉（head truncate）。約 40K 字元 ≈ 一般長文全文，極長文取開頭。
  const GEMINI_MAX_CHARS = 40000;

  function buildGeminiSummaryUrl(apiKey) {
    return `${GEMINI_API_BASE}${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  }

  // 組 summarize prompt。text 為主文純文字（呼叫端已 head-truncate；此處再防呆截一次）。
  function buildSummaryPrompt({ title, author, domain, text } = {}) {
    const body = (text || '').slice(0, GEMINI_MAX_CHARS);
    return [
      'Write three easy-to-read sentences summarizing the following text in Taiwanese Traditional Chinese:',
      '',
      '===',
      `Title: ${title || ''}`,
      `Author: ${author || ''}`,
      `Domain: ${domain || ''}`,
      '',
      body,
      '',
      'DO NOT translate names of people, emoji symbols, and abbreviations',
      'DO NOT translate company/organization name',
      'IMPORTANT: Write no more than THREE sentences. Each sentence should be short and easy-to-read. Use words sparingly and please capture the big idea.'
    ].join('\n');
  }

  // 從 Gemini generateContent 回應抽出文字（candidates[0].content.parts[*].text 串接）。
  function extractGeminiText(data) {
    if (!data || !Array.isArray(data.candidates) || !data.candidates.length) return '';
    const cand = data.candidates[0];
    const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
    return parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
  }

  // 呼叫 Gemini 產生摘要。回 { ok:true, summary } 或 { ok:false, error }。
  // 任何失敗（無 key / 無內文 / 網路 / 非 2xx / 空回應）都回 ok:false，呼叫端據此
  // 決定 fallback（不帶 summary 照送，讓 Readwise 自行處理）。
  async function generateGeminiSummary({ apiKey, title, author, domain, text, fetchImpl } = {}) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return { ok: false, error: 'NO_FETCH' };
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return { ok: false, error: 'NO_KEY' };
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
      return { ok: false, error: 'NO_TEXT' };
    }
    const prompt = buildSummaryPrompt({ title, author, domain, text });
    let res;
    try {
      res = await f(buildGeminiSummaryUrl(apiKey.trim()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
    } catch (networkErr) {
      return { ok: false, error: 'NETWORK', message: String(networkErr && networkErr.message || networkErr) };
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* 非 JSON 忽略 */ }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, error: 'AUTH', data };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: 'HTTP', data };
    }
    const summary = extractGeminiText(data);
    if (!summary) return { ok: false, error: 'EMPTY', data };
    return { ok: true, summary };
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

  // v0.8.64：驗證 Readwise token 是否有效。打官方 auth 端點（GET），不送任何內容。
  // 回傳值與 saveToReadwise 對齊（ok / error / status），讓 options / popup 共用同一套
  // 分支判斷。NO_TOKEN（空）/ AUTH（401·403 → token 無效或過期）/ NETWORK（連不上）/
  // HTTP（其他非 2xx）/ NO_FETCH（環境無 fetch）。
  async function validateReadwiseToken({ token, fetchImpl } = {}) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return { ok: false, error: 'NO_FETCH' };
    if (!token || typeof token !== 'string' || !token.trim()) {
      return { ok: false, error: 'NO_TOKEN' };
    }
    let res;
    try {
      res = await f(READWISE_AUTH_URL, {
        method: 'GET',
        headers: { 'Authorization': `Token ${token.trim()}` }
      });
    } catch (networkErr) {
      return { ok: false, error: 'NETWORK', message: String(networkErr && networkErr.message || networkErr) };
    }
    // 有效：204 No Content（也容忍其他 2xx，保險）
    if (res.status === 204 || res.ok) return { ok: true, status: res.status };
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, error: 'AUTH' };
    return { ok: false, status: res.status, error: 'HTTP' };
  }

  // v0.8.74：驗證 Gemini API key 是否有效。打 models list 端點（GET，不送內文、
  // 零 token 成本），key 無效時 Google 回 400/401/403。回傳值與 validateReadwiseToken
  // 對齊（ok / error / status），讓 options 共用同一套分支判斷。NO_KEY（空）/
  // AUTH（400·401·403 → key 無效）/ NETWORK（連不上）/ HTTP（其他非 2xx）/
  // NO_FETCH（環境無 fetch）。
  async function validateGeminiKey({ apiKey, fetchImpl } = {}) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return { ok: false, error: 'NO_FETCH' };
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return { ok: false, error: 'NO_KEY' };
    }
    let res;
    try {
      res = await f(`${GEMINI_API_BASE.replace(/\/$/, '')}?key=${encodeURIComponent(apiKey.trim())}`, { method: 'GET' });
    } catch (networkErr) {
      return { ok: false, error: 'NETWORK', message: String(networkErr && networkErr.message || networkErr) };
    }
    if (res.ok) return { ok: true, status: res.status };
    // Google 對無效 key 回 400 INVALID_ARGUMENT 或 403 PERMISSION_DENIED
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, error: 'AUTH' };
    }
    return { ok: false, status: res.status, error: 'HTTP' };
  }

  // v0.8.65：popup 端「送 Readwise」整段流程（讀 token → build payload → save），
  // 走 extension 頁自己的 fetch，**不繞 background**。
  // 理由：iOS Safari Web Extension 的背景頁（event page、persistent:false）被系統
  // 掛起得遠比 macOS 積極——popup → background 的 SAVE_TO_READWISE 非同步往返
  // （async sendResponse）與背景頁 fetch 在 iOS 上會 silently 失敗（popup 端 await
  // 拿到 undefined → 顯示無 HTTP 碼的純「送出失敗」；macOS Chrome / Safari 全正常）。
  // options 頁「測試 token」的 GET 從 extension 頁直接發、iOS 實測可行，save 改走
  // 同一條 extension-page fetch 路徑。getToken / fetchImpl 依賴注入便於單測。
  // 註：鍵盤快速鍵送出（無 popup）仍走 background sendToReadwiseFromCommand。
  async function saveReaderPayload({ payload, getToken, fetchImpl } = {}) {
    let token;
    try {
      token = await getToken();
    } catch (e) {
      return { ok: false, error: 'INTERNAL', message: String(e && e.message || e) };
    }
    let body;
    try {
      body = buildReadwisePayload(payload || {});
    } catch (e) {
      return { ok: false, error: 'INVALID_PAYLOAD', message: String(e && e.message || e) };
    }
    return saveToReadwise({ token, payload: body, fetchImpl });
  }

  const api = {
    sendWithInjectionFallback,
    toggleWithInjectionFallback,
    CONTENT_SCRIPT_FILES,
    buildReadwisePayload,
    saveToReadwise,
    saveReaderPayload,
    validateReadwiseToken,
    validateGeminiKey,
    buildSummaryPrompt,
    extractGeminiText,
    generateGeminiSummary,
    READWISE_API_URL,
    READWISE_AUTH_URL,
    GEMINI_MODEL,
    GEMINI_MAX_CHARS
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
