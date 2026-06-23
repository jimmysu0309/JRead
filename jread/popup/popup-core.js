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
    'content/floating-icon.js',
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

  /**
   * v0.8.115：toggle 按鈕失敗時的狀態訊息。toggleWithInjectionFallback 已先試
   * sendMessage、再 executeScript 重注入後重送——在「可注入頁」上仍回 ok:false，
   * 代表 content script 連不上。最常見成因是 iOS Safari 偶發把擴充訊息層（SW /
   * WebKit 擴充基礎設施程序）回收後不再喚醒（Apple Forums 758346）：此時
   * sendMessage / executeScript 都石沉大海，但 content script 仍活、三指手勢
   * （content 本地派送、零訊息）仍可切換閱讀模式，只能重啟 Safari 才復原訊息層。
   *
   * 區分兩種失敗，避免把「暫時連不上」誤報成「這頁不支援」害使用者誤判：
   *  - injectable=false（chrome:// / about: 等非 http(s) 頁）→ 真的不支援
   *  - injectable=true（http(s) 頁卻連不上）→ 連線中斷，導向可靠逃生口：
   *    touch 裝置給三指手勢；否則給重新整理
   * @param {{injectable:boolean, touch:boolean}} opts
   */
  function toggleFailureMessage(opts) {
    const o = opts || {};
    if (!o.injectable) return '此頁面無法啟動閱讀模式';
    return o.touch
      ? '無法連線到此頁面，請改用三指手勢切換或重新整理頁面'
      : '無法連線到此頁面，請重新整理頁面後再試';
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

  function buildReadwisePayload({ url, html, title, imageUrl, author, publishedDate, summary, isTranslated } = {}) {
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
    // v0.8.134：should_clean_html=true——讓 Readwise server 端跑它自己的解析 pipeline。
    // 根因：部分 CDN 對內文圖開防盜連（hotlink protection），無 `Referer: <來源站>`
    // 時回 403（sspai cdnfile.sspai.com 實證：有 referer→200、無→403）。送 html 但
    // 不開 should_clean_html 時 Readwise 原樣存我們的 HTML、不改寫圖片 URL，於是 reader
    // 端載入裸 CDN URL（無來源 referer）→ 內文圖全破。封面圖（image_url）因 Readwise
    // 存檔時 server 端先抓下自存而倖存，造成「封面有、內文破」。
    //   開 should_clean_html 後 Readwise 把每個 <img src> 改寫成自家簽章代理
    // `imgproxy.readwise.io/?url=…&hash=…&referer=<來源站>`——帶上來源 referer 繞過防盜連
    // （hash 用 Readwise 私鑰簽，client 無法自行偽造，故只能讓它自己跑 pipeline）。
    // 副作用評估（cage 真實 Readwise 帳號實測 sspai WWDC26 文，2026-06-20）：Readwise
    // 重清 JRead 已清好的 HTML 後內文 15 段逐段一致（無內容流失）、Gemini 繁中摘要保留、
    // 標題單一無重複、內文圖 0 破圖（對照不開時 7 破圖）。通則修法、非站點特判。
    //   v0.8.138 翻譯頁例外（Jimmy 2026-06-20 The Verge 譯文回報）：should_clean_html
    // 開啟時 Readwise 的 readability pipeline 會把 Shinkansen 注入的譯文當外來節點
    // 清掉、reader 端只剩英文原文（熱門站如 The Verge 還會被導去 server 端快取原文、
    // 完全略過上傳 body）。翻譯頁改關 should_clean_html、原樣保留譯文逐字。代價：翻譯
    // 頁的內文圖不再經 Readwise imgproxy 改寫（若該站防盜連會破圖）——但翻譯頁本來
    // 在 v0.8.134 之前就是這行為，非新退步，且 The Verge 等實測圖正常。非翻譯頁維持
    // should_clean_html=true 保住 sspai 防盜連修法。
    body.should_clean_html = !isTranslated;
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
  // v0.8.165：把 saveToReadwise 的結果（ok / error / status）對映成 toast 文字 + kind，
  // 供快速鍵送出（SW sendToReadwiseFromCommand，無 popup UI、結果只能靠 toast）使用，
  // 集中訊息文字單一資料源（CLAUDE.md）。kind 對齊 toast.js 的 'info' | 'success' |
  // 'error'。註：popup 軌用自己的 setReadwiseStatus 文字（含「進階設定」字樣），不走這條。
  function readwiseResultToast(result) {
    if (result && result.ok) {
      return {
        message: result.status === 200 ? '已存在於 Readwise Reader' : '已送到 Readwise Reader',
        kind: 'success'
      };
    }
    if (result && result.error === 'NO_TOKEN') {
      return { message: '尚未設定 Readwise token，請到設定頁填入', kind: 'error' };
    }
    if (result && result.error === 'AUTH') {
      return { message: 'Readwise token 無效或已過期', kind: 'error' };
    }
    if (result && result.error === 'NETWORK') {
      return { message: '網路錯誤，請稍後再試', kind: 'error' };
    }
    const detail = result && result.status ? `（HTTP ${result.status}）` : '';
    return { message: `送出失敗${detail}`, kind: 'error' };
  }

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
    toggleFailureMessage,
    CONTENT_SCRIPT_FILES,
    buildReadwisePayload,
    saveToReadwise,
    saveReaderPayload,
    readwiseResultToast,
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
