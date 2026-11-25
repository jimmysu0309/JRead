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
    // v1.8.0：除錯記錄（lib/logger.js）必須第一個載入——後面每支模組都可能寫 log
    'lib/logger.js',
    'content/namespace.js',
    'content/home-launcher.js',
    'content/orion-detect.js',
    // 2026-11-15 review C-01：settings-defaults 先於 keepalive（它載入當下就問
    // NS.isSafariRuntime，判定本體在 settings-defaults 的 __JReadPlatform）
    'content/settings-defaults.js',
    // v3.1.0：擴充設定橋（只在使用者自己的 JRead 網頁版頁面啟動）
    'content/host-bridge.js',
    'content/keepalive.js',
    'content/domain-match.js',
    'content/link-follow.js',
    'content/site-overrides.js',
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
    'content/idle-cursor.js',
    'content/paged-mode.js',
    'content/image-viewer.js',
    'content/position-memory.js',
    // v1.7.79：popup-core 自己也進 content_scripts——懸浮按鈕長按選單的「送到 …」
    // 在 Safari 走 content 端直送（main.js sendCurrentPageToService），需要本檔的
    // saveDocumentFlow / SAVE_PROGRESS / serviceLabel。載在 main.js 之前。
    // 註：lib/instapaper*.js **不**注入一般網頁（consumer key 只進擴充自有頁 / SW），
    // 故 content 直送軌只涵蓋 Readwise，Instapaper 由 main.js 轉回 SW 軌。
    'popup/popup-core.js',
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
  //            published_date?, location?, category?, tags?, notes?, language? }
  // 200 = 已存在、201 = 新建。
  // 註：v0.7.167 曾記「API 沒 language 欄位」——已證實為誤（Shinkansen 專案
  // 2026-07-31 實測：欄位存在且有效）。繁中內容必須帶 language，見
  // detectHanLanguage 註解。
  // ---- 除錯記錄捷徑（v1.8.0）----------------------------------------------
  // 本檔在 SW / content script / 擴充頁三種 context 都會載入，lib/logger.js 在
  // 三邊都先載（manifest content_scripts 第一筆 / importScripts / event page
  // scripts 第一筆）。jsdom spec 走 require 時沒有 logger → 退化成 no-op。
  function jlog(message, data, level) {
    const L = (typeof globalThis !== 'undefined') && globalThis.__JReadLogger;
    if (!L) return;
    try { L.log(level || 'info', 'save', message, data); } catch (_) { /* log 不可影響主流程 */ }
  }

  // ---- fetch 逾時（v1.8.0）-----------------------------------------------
  // 根因（Jimmy 2026-08-20 wheresyoured.at 譯文回報「翻譯後送出去沒反應」）：送出
  // 流程的每一支 fetch 都沒有時限。對端只要不回應（連線掛著不 RST、被其他擴充的
  // 網路攔截器吃掉、系統網路層卡住），await 就是一個**永遠 pending 的 promise**——
  // 呼叫端沒有 reject 可接、沒有結果可顯示，「送出中…」toast 15 秒後自己淡掉，
  // 使用者看到的就是「按了沒反應、連失敗提示都沒有」。
  //   通則性：與站點 / 服務無關，任何一支對外 fetch 都適用同一條「必須有時限」規則。
  //   這條驗 X、不驗 Y：驗「逾時一定有出口（回 TIMEOUT → 有 toast）」；**不驗**
  // 對端為什麼慢、也不保證重送會成功。
  // 90s 是量出來的、不是猜的：Readwise 處理翻譯頁的 raw HTML（should_clean_html
  // =false，內文圖已內嵌成 data: URI）實測要 39–45s（wheresyoured.at 譯文 727K、
  // 同一份 payload 連送兩次分別 45s+ 與 38.9s）。原本訂 45s 剛好卡在對端的正常
  // 耗時邊緣——會不穩定地把「只是慢」誤判成逾時、退回未內嵌版把圖丟掉。
  const SAVE_FETCH_TIMEOUT_MS = 90000;      // 送出（Readwise / Instapaper）
  const SUMMARY_FETCH_TIMEOUT_MS = 30000;   // Gemini 摘要（加分項，逾時照送）
  const AUTH_FETCH_TIMEOUT_MS = 15000;      // token / key 驗證、Instapaper xAuth（options 頁按鈕，要快回）
  // v1.9.22（review E-3）：讀入端（JReader feed / 單篇 / 歸檔；Readwise list·update、
  // Instapaper list·get_text·archive）。v1.8.0「每一支對外 fetch 必須有時限」只套到
  // save / summary / auth 三支，這六支仍是「對端不回應 = 永遠 pending」——reader 頁
  // 無限轉圈、options「連結」鈕卡「連結中…」且永久 disabled。30s：withHtmlContent
  // 的 list 在 Readwise 端重度 rate-limit、比一般 GET 慢，但遠不到送出那種 40s 級。
  const READ_FETCH_TIMEOUT_MS = 30000;

  // 包一層 AbortController 逾時。逾時丟出帶 jreadTimeout 標記的 Error，呼叫端
  // 據此與一般網路錯誤分流（TIMEOUT 有專屬 toast 文案 + 降級重送策略）。
  // AbortController 不存在（極舊環境 / 測試替身）或 ms 非正數時退化成裸 fetch。
  async function fetchWithTimeout(f, url, opts, ms) {
    if (typeof AbortController === 'undefined' || !(ms > 0)) return f(url, opts);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { controller.abort(); } catch (_) {} }, ms);
    try {
      return await f(url, Object.assign({}, opts || {}, { signal: controller.signal }));
    } catch (err) {
      if (timedOut) {
        const e = new Error('TIMEOUT');
        e.jreadTimeout = true;
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // 給「fetch 由第三方 lib 內部呼叫」的路徑用（instapaper.js 只收 fetchImpl、
  // 不認識逾時參數）——把時限包進 fetchImpl 本身，lib 端無需改動。
  function withFetchTimeout(f, ms) {
    return (url, opts) => fetchWithTimeout(f, url, opts, ms);
  }

  // v2.6.0：Readwise 相容 API 的 base。JReader（自架後端）提供同形的讀取 / 搬移 /
  // 重點 / 進度端點，差別只在網址前段——Readwise 各支收選用的 base（沒給＝Readwise），
  // jreader 服務帶使用者設定的網址。下方各 *_URL 常數維持 Readwise 的完整網址（既有
  // spec 與呼叫端讀），實際請求一律經 apiUrl(base, path) 組出
  const READWISE_BASE = 'https://readwise.io';
  // 網址正規化：去頭尾空白與結尾斜線；只收 https（本機開發另收 http://localhost /
  // 127.0.0.1）。不合法回 ''（呼叫端視為未設定）
  function normalizeApiBase(raw) {
    const t = typeof raw === 'string' ? raw.trim() : '';
    if (!t) return '';
    let u;
    try { u = new URL(t); } catch (_) { return ''; }
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return '';
    if (u.search || u.hash || u.username || u.password) return '';
    return (u.origin + u.pathname).replace(/\/+$/, '');
  }
  function apiUrl(base, path) {
    return (normalizeApiBase(base) || READWISE_BASE) + path;
  }
  // v2.6.0：「憑證由 host 提供」的 sentinel token。JReader 網頁版走同源 cookie session，
  // token 不進 localStorage——web shim 讓 jreaderToken 讀到這個值，readwiseRequest 見到
  // 它就不帶 Authorization、改 credentials:'include'（cookie 由瀏覽器帶）。字面值刻意
  // 不像真 token；擴充端使用者不可能貼出這串
  const HOST_SESSION_TOKEN = '__jread_host_session__';

  const READWISE_API_URL = 'https://readwise.io/api/v3/save/';
  // v0.8.64：token 驗證端點。官方 GET /api/v2/auth/ 帶 Authorization: Token <token>，
  // 有效回 204 No Content、無效回 401——比 POST /save/ 輕量（不建任何文件、不需 payload），
  // 是 options 頁「測試 token」按鈕的正解。
  const READWISE_AUTH_URL = 'https://readwise.io/api/v2/auth/';

  // v1.7.28：內容語言判斷（決定 save payload 是否帶 language 欄位）。
  // 為什麼要帶：Reader 沒收到 language 時會對內容跑自動語言偵測，該偵測器有
  // 兩個實測重現的 bug（Shinkansen 專案 2026-07-31 確認）：
  //   1. 純繁體中文內容被誤判成韓文（ko）→ reader 端用韓文字體渲染漢字，
  //      缺字的字（如「為」「麼」）逐字 fallback 到中文字體 → 同一句字體混排、
  //      標點變韓式窄標點
  //   2. 提交 HTML 內的 <html lang="zh-TW"> 被完全無視，救不了
  // 唯一可靠解法＝save 時明確帶 language，Reader 就跳過自動偵測。
  //   判斷邏輯（結構性、非站點特判）：取主文純文字前 2000 字，漢字
  // （一-鿿）佔非空白字元比 >= 15% 且假名（぀-ヿ）佔比 < 5%
  // 才回 'zh-TW'——假名門檻排除日文（日文假名佔比通常 30% 以上，漢字比也高、
  // 單看漢字會誤標）；韓文諺文、拉丁文內容漢字比遠低於門檻，不受影響。
  // 判不出來回 ''（不帶欄位，維持 Reader 自動偵測，不誤標非中文內容）。
  function detectHanLanguage(text) {
    const sample = (typeof text === 'string' ? text : '').slice(0, 2000);
    let han = 0;
    let kana = 0;
    let total = 0;
    for (const ch of sample) {
      if (/\s/.test(ch)) continue;
      total++;
      const code = ch.codePointAt(0);
      if (code >= 0x4E00 && code <= 0x9FFF) han++;
      else if (code >= 0x3040 && code <= 0x30FF) kana++;
    }
    if (!total) return '';
    return (han / total >= 0.15 && kana / total < 0.05) ? 'zh-TW' : '';
  }

  function buildReadwisePayload({ url, html, title, imageUrl, author, publishedDate, summary, isTranslated, text } = {}) {
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
    // v1.5.8：should_clean_html=false 時 Readwise 強制要求 author + title 兩欄都在
    //（缺則回 400 `non_field_errors: The fields 'author' and 'title' are required
    // when you don't use should_clean_html`，Jimmy 2026-06-28 macstories 譯文頁實證）。
    // 翻譯頁（isTranslated → should_clean_html false）若該站抽不到作者名（如 JSON-LD
    // author 只有 @id 參照、無 name 字串，extractGenericAuthor 回 ''）就缺 author →
    // 整包被退。補保底確保兩欄必存在：缺 author 用來源網域（hostname 去 www）、缺
    // title 退回 url（title 幾乎一定有，此為極端缺漏的防線）。should_clean_html=true
    // 時 Readwise 自抓 metadata、不受此限，不補（避免污染非翻譯頁送出的 author）。
    if (body.should_clean_html === false) {
      if (!body.author) {
        let host = '';
        try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
        body.author = host || '未知作者';
      }
      if (!body.title) body.title = url;
    }
    // v1.7.28：language 欄位——擋 Reader 自動語言偵測把繁中誤判成 ko
    //（根因與門檻見 detectHanLanguage 註解）。翻譯頁（Shinkansen 譯文）
    // 匯出的 html 經 dual collapse 後必為繁中、直接標 zh-TW（live 頁
    // innerText 可能雙語混排、漢字比會被原文稀釋，不走文字判斷）；
    // 其他頁面用主文純文字判斷，判不出來不帶欄位（維持自動偵測）。
    const language = isTranslated ? 'zh-TW' : detectHanLanguage(text);
    if (language) body.language = language;
    return body;
  }

  // ---- 翻譯頁匯出：內文圖 inline 成 data: URI（v1.7.74）-------------------
  // 根因（latimes.com 實證，Jimmy 2026-08-18 回報「翻譯後送 Readwise 圖都沒顯示」）：
  // 部分圖片 CDN 的防盜連是「看 Sec-Fetch-Dest: image ＋ cross-site ＋ referer 不是
  // 來源站 → 302 導去 1×1 placeholder」（ca-times.brightspotcdn.com 實測矩陣：
  // referer=latimes → 200；referer=readwise.io / 無 referer → 302 placeholder-1x1.png）。
  // Readwise Reader 端 render 我們原樣存的 HTML 時就是 cross-site 的 <img> 載入，
  // 每張圖都吃 1×1，畫面上等於整篇沒圖。前端手段救不了——referrerpolicy 只能「減少」
  // referer，改不出來源站的 referer（四種 policy cage 實測全 1×1）。
  //
  // Readwise 自家的解法是 should_clean_html=true 時把 <img> 改寫成簽章代理
  // imgproxy.readwise.io（帶 referer=<來源站>），但翻譯頁不能開那個旗標——它會連帶
  // 觸發 Readwise 的 readability pipeline 把 Shinkansen 譯文清掉（v0.8.138 教訓）。
  //
  // 修法：翻譯頁（raw HTML 模式）送出前，由擴充自己把內文圖抓下來內嵌成 data: URI。
  // 關鍵訊號：**fetch() 的 Sec-Fetch-Dest 是 empty、不是 image**，同一組防盜連規則
  // 因此放行（實測 200 / 完整 bytes）；擴充端 fetch 又有 host_permissions 不受 CORS
  // 限制，content script 做不到（MV3 content script fetch 仍受頁面 CORS 規範）。
  // 通則性：不綁站點——所有翻譯頁一律走同一條路，防盜連站被救到，沒防盜連的站也只是
  // 換成內嵌（Readwise 端不再需要外連圖）。
  //
  // 這條驗 X、不驗 Y：驗「送出的 HTML 內文圖是否自帶 bytes」；不驗 Readwise 端的
  // render 結果（遠端行為，需真機 spot-check）、也不驗非翻譯頁（那條走 imgproxy）。
  //
  // 預算與上限（避免 payload 爆掉；latimes 該篇實測 8 張 768w webp 共 148K、
  // base64 後約 202K，payload 從 72K 變約 275K）：
  const RAW_IMG_TARGET_WIDTH = 1024;          // srcset 候選挑「>= 這個寬」的最小張
  const RAW_IMG_MAX_BYTES = 500 * 1024;       // 單張上限，超過就維持外連
  const RAW_IMG_TOTAL_BUDGET = 1500 * 1024;   // 全篇原始 bytes 預算（base64 後約 ×1.37）
  const RAW_IMG_MIN_BYTES = 1024;             // 小於此視為 placeholder（防盜連 1×1）→ 不內嵌
  const RAW_IMG_TIMEOUT_MS = 10000;
  const RAW_IMG_CONCURRENCY = 4;

  // srcset 解析：不可用 split(',')——CDN URL 本身常含逗號（cloudinary
  // `w_1456,c_limit` / substack fetch URL）。改走「以空白切 token、descriptor
  // （123w / 2x）跟在 URL 後面」的掃描，URL 內的逗號因此不影響切分。
  function parseSrcsetCandidates(srcset) {
    const out = [];
    const parts = String(srcset || '').trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const tok = parts[i];
      if (/^\d+(\.\d+)?[wx],?$/.test(tok)) continue; // 落單 descriptor（已配對過）
      const url = tok.replace(/,+$/, '');
      let width = 0;
      const next = parts[i + 1];
      if (next && /^\d+[wx],?$/.test(next)) {
        if (/w,?$/.test(next)) width = parseInt(next, 10) || 0;
        i++;
      }
      if (url) out.push({ url, width });
    }
    return out;
  }

  // 挑一張要內嵌的。兩條偏好疊在一起：
  //   1. 格式：同一張圖若站方同時提供 webp / avif（<picture> 的 <source type=…>）
  //      就優先拿——同尺寸下 bytes 常只有 jpeg 的 1/3，直接反映成 payload 大小
  //      （latimes 該篇實測：2000w jpeg 9 張共 532K vs 768w webp 8 張共 148K）
  //   2. 尺寸：寬度 >= 目標寬的最小張（畫質夠又不浪費），全部比目標小就取最大張
  // extraSources = 外層 <picture> 的 [{ type, srcset }]，沒有就只看 <img> 自己。
  function pickInlineImageUrls(tag, extraSources) {
    const pools = [];
    const addPool = (srcset, type) => {
      if (!srcset) return;
      const cands = parseSrcsetCandidates(srcset).filter((c) => /^https?:\/\//i.test(c.url));
      if (cands.length) pools.push({ type: (type || '').toLowerCase(), cands });
    };
    for (const src of (extraSources || [])) addPool(src && src.srcset, src && src.type);
    const srcsetM = tag.match(/\ssrcset\s*=\s*"([^"]*)"/i) || tag.match(/\ssrcset\s*=\s*'([^']*)'/i);
    if (srcsetM) addPool(srcsetM[1], '');
    const rank = (t) => (t.indexOf('avif') >= 0 ? 0 : t.indexOf('webp') >= 0 ? 1 : 2);
    pools.sort((a, b) => rank(a.type) - rank(b.type));
    const urls = [];
    const push = (u) => { if (u && urls.indexOf(u) < 0) urls.push(u); };
    for (const pool of pools) {
      const sized = pool.cands.filter((c) => c.width > 0).sort((a, b) => a.width - b.width);
      if (sized.length) {
        const big = sized.find((c) => c.width >= RAW_IMG_TARGET_WIDTH);
        push((big || sized[sized.length - 1]).url);
      } else if (pool.cands.length) {
        push(pool.cands[0].url);
      }
    }
    const srcM = tag.match(/\ssrc\s*=\s*"([^"]*)"/i) || tag.match(/\ssrc\s*=\s*'([^']*)'/i);
    const src = srcM ? srcM[1].trim() : '';
    if (/^https?:\/\//i.test(src)) push(src);
    return urls;
  }

  // 單一候選（第一順位）。回退鏈由 pickInlineImageUrls 給，呼叫端逐個試——
  // 站方宣告的 webp / avif source 不保證存在（YouTube 縮圖 vi_webp/maxresdefault
  // 對沒有 maxres 的影片回 404 實證），第一順位失敗要能退回下一個而不是整張放棄。
  function pickInlineImageUrl(tag, extraSources) {
    return pickInlineImageUrls(tag, extraSources)[0] || '';
  }

  // 一段 <picture> 內的 <source>：抽出 { type, srcset } 供候選挑選用。
  function collectPictureSources(block) {
    const out = [];
    const re = /<source\b[^>]*>/gi;
    let m;
    while ((m = re.exec(block)) !== null) {
      const tag = m[0];
      const ss = tag.match(/\ssrcset\s*=\s*"([^"]*)"/i) || tag.match(/\ssrcset\s*=\s*'([^']*)'/i);
      if (!ss) continue;
      const ty = tag.match(/\stype\s*=\s*"([^"]*)"/i) || tag.match(/\stype\s*=\s*'([^']*)'/i);
      out.push({ type: ty ? ty[1] : '', srcset: ss[1] });
    }
    return out;
  }

  // <picture> 內的 <source> 必須拿掉：source 的優先序高於 <img src>，留著等於
  // 內嵌白做（瀏覽器仍去載外連 webp）。只清 <picture> 內的，<video>/<audio>
  // 的 <source> 不動。
  function stripPictureSources(html) {
    return String(html).replace(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi,
      (block) => block.replace(/<source\b[^>]*>/gi, ''));
  }

  // 內嵌成功後改寫 <img>：src 換成 data:，srcset / sizes / loading 一併移除
  // （srcset 留著會蓋掉 src）。width / height 保留——它們定義長寬比，與實際
  // 內嵌解析度不同不影響 Readwise 端排版。
  function rewriteImgTagWithDataUri(tag, dataUri) {
    let t = tag
      .replace(/\ssrcset\s*=\s*"[^"]*"/gi, '')
      .replace(/\ssrcset\s*=\s*'[^']*'/gi, '')
      .replace(/\ssizes\s*=\s*"[^"]*"/gi, '')
      .replace(/\ssizes\s*=\s*'[^']*'/gi, '')
      .replace(/\sloading\s*=\s*"[^"]*"/gi, '')
      .replace(/\sloading\s*=\s*'[^']*'/gi, '');
    const put = () => ` src="${dataUri}"`;
    if (/\ssrc\s*=\s*"[^"]*"/i.test(t)) return t.replace(/\ssrc\s*=\s*"[^"]*"/i, put);
    if (/\ssrc\s*=\s*'[^']*'/i.test(t)) return t.replace(/\ssrc\s*=\s*'[^']*'/i, put);
    return t.replace(/^<img/i, () => `<img src="${dataUri}"`);
  }

  function bytesToBase64(bytes) {
    let bin = '';
    const CHUNK = 0x8000; // 一次 32K，避免 apply 參數過多爆 stack
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  // 抓一張圖回 { dataUri, bytes }；任何失敗（網路 / 非 2xx / 非圖片 / 過大 /
  // 疑似 placeholder）回 null，呼叫端維持原外連（不比現況差）。
  async function fetchImageAsDataUri(url, f) {
    let controller = null;
    let timer = null;
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      timer = setTimeout(() => { try { controller.abort(); } catch (_) {} }, RAW_IMG_TIMEOUT_MS);
    }
    let res;
    try {
      res = await f(url, controller ? { credentials: 'omit', signal: controller.signal }
                                    : { credentials: 'omit' });
    } catch (_) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res || !res.ok) return null;
    let type = '';
    try {
      type = ((res.headers && res.headers.get && res.headers.get('content-type')) || '').split(';')[0].trim();
    } catch (_) { type = ''; }
    if (!/^image\//i.test(type)) return null;
    let buf;
    try { buf = await res.arrayBuffer(); } catch (_) { return null; }
    if (!buf || !buf.byteLength) return null;
    if (buf.byteLength > RAW_IMG_MAX_BYTES) return null;
    // 防盜連站被擋時回的是 1×1 placeholder（數十 bytes）——內嵌它等於把破圖
    // 固化進 payload，寧可留外連讓 Readwise / 使用者端還有機會載到
    if (buf.byteLength < RAW_IMG_MIN_BYTES) return null;
    return { dataUri: `data:${type};base64,${bytesToBase64(new Uint8Array(buf))}`, bytes: buf.byteLength };
  }

  // 主流程：回 { html, inlined, bytes, skipped }。html 一定可用（失敗就是原字串）。
  async function inlineRawHtmlImages(html, { fetchImpl } = {}) {
    const src = (typeof html === 'string') ? html : '';
    const empty = { html: src, inlined: 0, bytes: 0, skipped: 0 };
    if (!src) return empty;
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f || typeof btoa !== 'function') return empty;
    // 候選挑選要看得到 <picture> 的 <source>（webp / avif 通常只掛在那裡），
    // 所以先在原字串上把「每個 <img> 屬於哪個 picture」對起來，再統一 strip。
    const sourcesByImgUrl = new Map();
    const picRe = /<picture\b[^>]*>[\s\S]*?<\/picture>/gi;
    let pm;
    while ((pm = picRe.exec(src)) !== null) {
      const block = pm[0];
      const imgM = block.match(/<img\b[^>]*>/i);
      if (!imgM) continue;
      sourcesByImgUrl.set(imgM[0], collectPictureSources(block));
    }
    const stripped = stripPictureSources(src);
    const tags = [];
    const re = /<img\b[^>]*>/gi;
    let m;
    while ((m = re.exec(stripped)) !== null) {
      const urls = pickInlineImageUrls(m[0], sourcesByImgUrl.get(m[0]));
      if (urls.length) {
        tags.push({ tag: m[0], key: urls.join('|'), urls, start: m.index, end: m.index + m[0].length });
      }
    }
    if (!tags.length) return { html: stripped, inlined: 0, bytes: 0, skipped: 0 };
    // 同一張圖可能重複出現，抓一次共用
    const cache = new Map();
    let used = 0;
    let cursor = 0;
    const queue = tags.slice();
    async function worker() {
      while (queue.length) {
        const item = queue.shift();
        if (cache.has(item.key)) continue;
        if (used >= RAW_IMG_TOTAL_BUDGET) { cache.set(item.key, null); continue; }
        cache.set(item.key, 'pending');
        let done = null;
        // 候選鏈逐個試（webp / avif 優先，失敗退回原格式）
        for (const url of item.urls) {
          const got = await fetchImageAsDataUri(url, f);
          if (!got) continue;
          if (used + got.bytes > RAW_IMG_TOTAL_BUDGET) break;
          used += got.bytes;
          done = got.dataUri;
          break;
        }
        cache.set(item.key, done);
      }
    }
    const workers = [];
    for (let i = 0; i < RAW_IMG_CONCURRENCY; i++) workers.push(worker());
    await Promise.all(workers);
    let out = '';
    let inlined = 0;
    let skipped = 0;
    for (const item of tags) {
      const dataUri = cache.get(item.key);
      out += stripped.slice(cursor, item.start);
      if (dataUri && dataUri !== 'pending') {
        out += rewriteImgTagWithDataUri(item.tag, dataUri);
        inlined++;
      } else {
        out += item.tag;
        skipped++;
      }
      cursor = item.end;
    }
    out += stripped.slice(cursor);
    return { html: out, inlined, bytes: used, skipped };
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

  // v1.6.25：API key 改走 x-goog-api-key header、不放 URL query——URL 會被
  // proxy / server log / DevTools 記錄，query 帶金鑰等於到處留明文副本。
  // Google 官方兩種驗證方式等價，header 版不進 URL 紀錄面。
  function buildGeminiSummaryUrl() {
    return `${GEMINI_API_BASE}${GEMINI_MODEL}:generateContent`;
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
  async function generateGeminiSummary({ apiKey, title, author, domain, text, fetchImpl, timeoutMs } = {}) {
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
      res = await fetchWithTimeout(f, buildGeminiSummaryUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }, typeof timeoutMs === 'number' ? timeoutMs : SUMMARY_FETCH_TIMEOUT_MS);
    } catch (networkErr) {
      // v1.8.0：摘要是加分項，逾時回 TIMEOUT 讓呼叫端照原樣送出（不阻斷送出）
      if (networkErr && networkErr.jreadTimeout) return { ok: false, error: 'TIMEOUT' };
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

  // v1.5.7：把 Readwise 非 2xx 回應內容萃成一句可讀原因（送 toast / status / log）。
  // Readwise 的 4xx body 形態不固定，三種都吃：
  //   { detail: "..." }                          → DRF 風格單句錯誤
  //   { url: ["This field is required."], ... }   → DRF 欄位錯誤物件（值為字串或字串陣列）
  //   "<plain text / html>"                       → 非 JSON（JSON.parse 失敗時的原字串）
  // 回傳已 collapse 空白 + 截斷（避免灌爆 toast）；無可萃內容回 ''。純診斷字串、
  // 不參與任何控制流（呼叫端仍以 status / error code 判斷分支）。
  function readwiseErrorDetail(data, rawText) {
    const clip = (s) => {
      const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
      return t.length > 200 ? t.slice(0, 197) + '…' : t;
    };
    if (data && typeof data === 'object') {
      if (typeof data.detail === 'string' && data.detail.trim()) return clip(data.detail);
      // 欄位錯誤物件：{ field: ["msg"] | "msg" } → "field: msg" 串接
      const parts = [];
      for (const [k, v] of Object.entries(data)) {
        const msg = Array.isArray(v) ? v.join(' ') : (typeof v === 'string' ? v : '');
        if (msg && msg.trim()) parts.push(`${k}: ${msg.trim()}`);
      }
      if (parts.length) return clip(parts.join('；'));
    }
    if (typeof rawText === 'string' && rawText.trim()) return clip(rawText);
    return '';
  }

  // v2.5.1（2026-11-15 review E-07）：Readwise 各支呼叫共用的請求樣板——原本八支各抄
  // 一份「resolve fetch → 驗 token → fetchWithTimeout → TIMEOUT / NETWORK → 401·403 →
  // 429」，E-06（move 漏 429 分類）就是抄漏的結果。各支只留差異段：
  //   precheck()：token 驗過之後、送出之前的參數檢查（NO_ID / NO_LOCATION / EMPTY…），
  //     回錯誤 result 或 null。順序固定 NO_FETCH → NO_TOKEN → precheck，與收斂前相同
  //   url：字串或函式（函式在 precheck 通過後才呼叫——網址常要用到已驗過的 id）
  //   body：函式，回要送的物件；有給就帶 Content-Type 並 JSON.stringify（同樣在 precheck
  //     通過後才呼叫）
  //   classify：true＝401·403 → AUTH、429 → RATE_LIMIT 在這裡分類；false＝只送請求，
  //     狀態碼由呼叫端自己判（saveToReadwise 要先讀 body 才回 AUTH / HTTP 且 429 維持
  //     HTTP；validateReadwiseToken 沒有 429 分類——都是收斂前的既有行為，刻意不統一）
  // 回 { result }（已分類的錯誤，呼叫端直接 return）或 { res }（交給呼叫端判讀）。
  // rateLimitResult 是 function declaration（定義在下方），hoist 後可用。
  async function readwiseRequest({ token, fetchImpl, precheck, url, method, body, keepalive, timeoutMs, defaultTimeoutMs, classify } = {}) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return { result: { ok: false, error: 'NO_FETCH' } };
    if (!token || typeof token !== 'string' || !token.trim()) {
      return { result: { ok: false, error: 'NO_TOKEN' } };
    }
    const pre = typeof precheck === 'function' ? precheck() : null;
    if (pre) return { result: pre };
    const opts = { method };
    if (keepalive) opts.keepalive = true;
    // v2.6.0：host session（見 HOST_SESSION_TOKEN）不帶 Authorization、讓瀏覽器帶 cookie
    if (token === HOST_SESSION_TOKEN) {
      opts.headers = {};
      opts.credentials = 'include';
    } else {
      opts.headers = { 'Authorization': `Token ${token.trim()}` };
    }
    if (typeof body === 'function') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body());
    }
    let res;
    try {
      res = await fetchWithTimeout(f, typeof url === 'function' ? url() : url, opts,
        typeof timeoutMs === 'number' ? timeoutMs : defaultTimeoutMs);
    } catch (networkErr) {
      // v1.8.0：逾時與一般網路錯誤分流——逾時代表「送出去了但沒回音」，
      // 使用者需要的訊息是「再試一次」而不是「檢查網路」
      if (networkErr && networkErr.jreadTimeout) return { result: { ok: false, error: 'TIMEOUT' } };
      return { result: { ok: false, error: 'NETWORK', message: String(networkErr && networkErr.message || networkErr) } };
    }
    if (classify !== false) {
      if (res.status === 401 || res.status === 403) {
        return { result: { ok: false, status: res.status, error: 'AUTH' } };
      }
      if (res.status === 429) return { result: rateLimitResult(res) };
    }
    return { res };
  }

  async function saveToReadwise({ token, payload, fetchImpl, timeoutMs } = {}) {
    const r = await readwiseRequest({
      token, fetchImpl, timeoutMs, defaultTimeoutMs: SAVE_FETCH_TIMEOUT_MS,
      url: READWISE_API_URL, method: 'POST', body: () => payload, classify: false
    });
    if (r.result) return r.result;
    const res = r.res;
    // v1.5.7：先讀原始 text 再嘗試 JSON.parse——Readwise 4xx 的 body 未必是 JSON
    //（曾見純文字 / HTML 錯誤頁），原本只 res.json() 失敗就把唯一的失敗原因整個
    // 丟掉、toast 只剩不透明的「送出失敗（HTTP 400）」無從定位。真實 Response 一定
    // 有 .text()；舊測試替身只實作 .json()，故 fallback 到 json() 保相容。一個
    // body 只能讀一次，兩者擇一不可並用。
    let rawText = '';
    let data = null;
    if (typeof res.text === 'function') {
      try { rawText = await res.text(); } catch (_) { /* 無 body / 已被讀走 */ }
      if (rawText) { try { data = JSON.parse(rawText); } catch (_) { /* 非 JSON，留 rawText */ } }
    } else if (typeof res.json === 'function') {
      try { data = await res.json(); } catch (_) { /* 非 JSON response 忽略 */ }
    }
    if (!res.ok) {
      const detail = readwiseErrorDetail(data, rawText);
      // 診斷：非 2xx 一律印完整 body（popup / SW console 都看得到，供真機回報）
      try { console.warn('[JRead] Readwise save 失敗', res.status, rawText || data); } catch (_) {}
      const error = (res.status === 401 || res.status === 403) ? 'AUTH' : 'HTTP';
      return { ok: false, status: res.status, error, data, detail };
    }
    return { ok: true, status: res.status, data };
  }

  // v0.8.64：驗證 Readwise token 是否有效。打官方 auth 端點（GET），不送任何內容。
  // 回傳值與 saveToReadwise 對齊（ok / error / status），讓 options / popup 共用同一套
  // 分支判斷。NO_TOKEN（空）/ AUTH（401·403 → token 無效或過期）/ NETWORK（連不上）/
  // HTTP（其他非 2xx）/ NO_FETCH（環境無 fetch）。
  async function validateReadwiseToken({ token, base, fetchImpl, timeoutMs } = {}) {
    const r = await readwiseRequest({
      token, fetchImpl, timeoutMs, defaultTimeoutMs: AUTH_FETCH_TIMEOUT_MS,
      url: apiUrl(base, '/api/v2/auth/'), method: 'GET', classify: false
    });
    if (r.result) return r.result;
    const res = r.res;
    // 有效：204 No Content（也容忍其他 2xx，保險）
    if (res.status === 204 || res.ok) return { ok: true, status: res.status };
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, error: 'AUTH' };
    return { ok: false, status: res.status, error: 'HTTP' };
  }

  // ---- JReader 存文章（v2.6.0）-------------------------------------------
  // JReader（自架的 Readwise 相容後端）的存文章端點是獨立的 POST <base>/api/v1/save
  //（規格在 JReader repo 的 docs/api-save.md）：JRead 抽出的 HTML 就是最終內容、伺服器
  // 自己鏡像圖片，所以 Readwise 那三條繞路都不做——不送 should_clean_html、翻譯頁不內嵌
  // data: 圖片、不強制補 author / title。照舊帶 Gemini 摘要、language、原文網址（翻譯頁
  // 的 url 由 extractReaderPayload 換成原文網址）。
  // 回應：201 新建 / 200 已存在（同 Readwise，existsOn200）/ 400 INVALID_PAYLOAD /
  // 401·403 AUTH / 413 HTTP（TOO_LARGE）/ 429 RATE_LIMIT。
  const JREADER_SAVE_SOURCE = 'jread-extension';
  function buildJReaderPayload({ url, html, title, imageUrl, author, publishedDate, summary, isTranslated, text } = {}) {
    if (!url || typeof url !== 'string') {
      throw new Error('buildJReaderPayload: url 必填');
    }
    const body = { url };
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    if (html && typeof html === 'string') body.html = html;
    if (str(title)) body.title = str(title);
    if (str(author)) body.author = str(author);
    if (str(publishedDate)) body.published_date = str(publishedDate);
    if (imageUrl && typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl)) body.image_url = imageUrl;
    if (str(summary)) body.summary = str(summary);
    // language 判斷與 Readwise 同一份（翻譯頁必為繁中，見 buildReadwisePayload）
    const language = isTranslated ? 'zh-TW' : detectHanLanguage(text);
    if (language) body.language = language;
    if (isTranslated) body.is_translated = true;
    body.source = JREADER_SAVE_SOURCE;
    return body;
  }

  async function saveToJReader({ token, base, payload, fetchImpl, timeoutMs } = {}) {
    if (!normalizeApiBase(base)) return { ok: false, error: 'NO_CREDENTIALS' };
    const r = await readwiseRequest({
      token, fetchImpl, timeoutMs, defaultTimeoutMs: SAVE_FETCH_TIMEOUT_MS,
      url: apiUrl(base, '/api/v1/save'), method: 'POST', body: () => payload
    });
    if (r.result) return r.result;
    const res = r.res;
    let rawText = '';
    let data = null;
    if (typeof res.text === 'function') {
      try { rawText = await res.text(); } catch (_) { /* 無 body */ }
      if (rawText) { try { data = JSON.parse(rawText); } catch (_) { /* 非 JSON */ } }
    } else if (typeof res.json === 'function') {
      try { data = await res.json(); } catch (_) { /* 非 JSON */ }
    }
    if (!res.ok) {
      const code = data && typeof data.error === 'string' ? data.error : '';
      const error = (res.status === 400 && code === 'INVALID_PAYLOAD') ? 'INVALID_PAYLOAD' : 'HTTP';
      return { ok: false, status: res.status, error, data, detail: code || readwiseErrorDetail(data, rawText) };
    }
    return { ok: true, status: res.status, data };
  }

  // JReader token 驗證：GET <base>/api/v1/auth → 204 有效 / 401 無效（與 Readwise v2/auth 同形）
  async function validateJReaderToken({ token, base, fetchImpl, timeoutMs } = {}) {
    if (!normalizeApiBase(base)) return { ok: false, error: 'NO_BASE' };
    const r = await readwiseRequest({
      token, fetchImpl, timeoutMs, defaultTimeoutMs: AUTH_FETCH_TIMEOUT_MS,
      url: apiUrl(base, '/api/v1/auth'), method: 'GET', classify: false
    });
    if (r.result) return r.result;
    const res = r.res;
    if (res.status === 204 || res.ok) return { ok: true, status: res.status };
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, error: 'AUTH' };
    return { ok: false, status: res.status, error: 'HTTP' };
  }

  // ---- JReader 書庫工具（v3.1.0）---------------------------------------
  // 搜尋、貼網址存文章、標籤清單 / 改標籤、查單篇處理狀態。只有 JReader 有這些
  // 端點（規格在 JReader repo docs/prompt-for-jread-search-and-info.md），能力判斷
  // supportsLibraryTools 是單一判準：Feed 工具列與文章資訊面板都經它決定要不要出現。
  // 請求一律走 readwiseRequest（token / HOST_SESSION_TOKEN 規則同其他 JReader 端點）。
  function supportsLibraryTools(service) {
    return service === 'jreader';
  }

  async function readJsonBody(res) {
    try { return await res.json(); } catch (_) { return null; }
  }

  // GET <base>/api/v1/search?q=&location=&tag=&sort=&limit=&offset= → { ok, count, results }
  // results 與 v3 list 的 document 同形，另帶 snippet（字串或 null）
  // sort：'relevance'（預設，相關程度）/ 'newest' / 'oldest'（存入日期）
  // q 空白但有 tag＝只用標籤瀏覽（v3.2.5，Jimmy 2026-11-25「只選 tag 也要有資料夾和排序」）；兩者都沒有才擋
  async function searchJReader({ token, base, q, location, tag, sort, limit, offset, fetchImpl, timeoutMs } = {}) {
    if (!normalizeApiBase(base)) return { ok: false, error: 'NO_BASE' };
    const query = typeof q === 'string' ? q.trim() : '';
    const r = await readwiseRequest({
      token, fetchImpl, timeoutMs, defaultTimeoutMs: READ_FETCH_TIMEOUT_MS, method: 'GET',
      precheck: () => (query || tag ? null : { ok: false, error: 'EMPTY' }),
      url: () => {
        const params = new URLSearchParams({ q: query });
        if (location) params.set('location', location);
        if (tag) params.set('tag', tag); // v3.2.3：標籤篩選與搜尋並存（伺服器不分大小寫比對標籤名）
        if (sort && sort !== 'relevance') params.set('sort', sort);
        if (limit) params.set('limit', String(limit));
        if (offset) params.set('offset', String(offset));
        return `${apiUrl(base, '/api/v1/search')}?${params}`;
      }
    });
    if (r.result) return r.result;
    if (!r.res.ok) {
      // code＝伺服器回的錯誤碼（{ error: 'INVALID_QUERY' } 等）：搜尋工具列只把 INVALID_QUERY 當「只有排除的詞」
      const body = await readJsonBody(r.res);
      const code = body && typeof body.error === 'string' ? body.error : '';
      return { ok: false, status: r.res.status, error: 'HTTP', code };
    }
    const data = await readJsonBody(r.res);
    return {
      ok: true, status: r.res.status,
      count: data && typeof data.count === 'number' ? data.count : 0,
      results: data && Array.isArray(data.results) ? data.results : [],
      // 摘錄要標粗的字（伺服器依查詢語法算好；reader-library highlightTerms 直接用）
      terms: data && Array.isArray(data.terms) ? data.terms.filter((t) => typeof t === 'string') : []
    };
  }

  // GET <base>/api/v1/tags → { ok, tags: [{ name, count }] }
  async function listJReaderTags({ token, base, fetchImpl, timeoutMs } = {}) {
    if (!normalizeApiBase(base)) return { ok: false, error: 'NO_BASE' };
    const r = await readwiseRequest({
      token, fetchImpl, timeoutMs, defaultTimeoutMs: READ_FETCH_TIMEOUT_MS, method: 'GET',
      url: apiUrl(base, '/api/v1/tags')
    });
    if (r.result) return r.result;
    if (!r.res.ok) return { ok: false, status: r.res.status, error: 'HTTP' };
    const data = await readJsonBody(r.res);
    return { ok: true, status: r.res.status, tags: data && Array.isArray(data.tags) ? data.tags : [] };
  }

  // PUT <base>/api/v1/documents/<id>/tags { tags } → { ok, tags }（整組覆蓋）
  async function setJReaderTags({ token, base, id, tags, fetchImpl, timeoutMs } = {}) {
    if (!normalizeApiBase(base)) return { ok: false, error: 'NO_BASE' };
    const r = await readwiseRequest({
      token, fetchImpl, timeoutMs, defaultTimeoutMs: READ_FETCH_TIMEOUT_MS, method: 'PUT',
      precheck: () => {
        if (!id || typeof id !== 'string' || !id.trim()) return { ok: false, error: 'NO_ID' };
        if (!Array.isArray(tags)) return { ok: false, error: 'NO_TAGS' };
        return null;
      },
      url: () => `${apiUrl(base, '/api/v1/documents/')}${encodeURIComponent(id.trim())}/tags`,
      body: () => ({ tags: tags.map((t) => String(t)) })
    });
    if (r.result) return r.result;
    if (!r.res.ok) return { ok: false, status: r.res.status, error: 'HTTP' };
    const data = await readJsonBody(r.res);
    return { ok: true, status: r.res.status, tags: data && Array.isArray(data.tags) ? data.tags : tags };
  }

  // 貼網址存文章：POST <base>/api/v1/save { url, source: 'web' }（不帶 html，伺服器自己抓）
  // 回 saveToJReader 的結果：status 202＝新建處理中、200＝已存在（data.existed）
  const JREADER_URL_SAVE_SOURCE = 'web';
  function saveUrlToJReader({ token, base, url, fetchImpl, timeoutMs } = {}) {
    const u = typeof url === 'string' ? url.trim() : '';
    if (!/^https?:\/\/\S+$/i.test(u)) return Promise.resolve({ ok: false, error: 'INVALID_URL' });
    return saveToJReader({ token, base, payload: { url: u, source: JREADER_URL_SAVE_SOURCE }, fetchImpl, timeoutMs });
  }

  // 「剛打開這篇」：PATCH <base>/api/v3/update/<id>/ { opened: true }。JReader 只記最後閱讀時間
  //（Progress 分頁排序），不動 updated_at。只開沒捲動時進度不會寫回，靠這個讓 Progress 排到最前
  async function markJReaderOpened({ token, base, id, fetchImpl, timeoutMs } = {}) {
    if (!normalizeApiBase(base)) return { ok: false, error: 'NO_BASE' };
    const r = await readwiseRequest({
      token, fetchImpl, timeoutMs, defaultTimeoutMs: READ_FETCH_TIMEOUT_MS, method: 'PATCH',
      precheck: () => (!id || typeof id !== 'string' || !id.trim()) ? { ok: false, error: 'NO_ID' } : null,
      url: () => `${apiUrl(base, '/api/v3/update/')}${encodeURIComponent(id.trim())}/`,
      body: () => ({ opened: true })
    });
    if (r.result) return r.result;
    return r.res.ok ? { ok: true, status: r.res.status } : { ok: false, status: r.res.status, error: 'HTTP' };
  }

  // 文章筆記：PATCH <base>/api/v3/update/<id>/ { notes }（空字串＝清掉；JReader 不動 updated_at）
  async function setJReaderNotes({ token, base, id, notes, fetchImpl, timeoutMs } = {}) {
    if (!normalizeApiBase(base)) return { ok: false, error: 'NO_BASE' };
    const r = await readwiseRequest({
      token, fetchImpl, timeoutMs, defaultTimeoutMs: READ_FETCH_TIMEOUT_MS, method: 'PATCH', keepalive: true,
      precheck: () => {
        if (!id || typeof id !== 'string' || !id.trim()) return { ok: false, error: 'NO_ID' };
        if (typeof notes !== 'string') return { ok: false, error: 'NO_NOTES' };
        return null;
      },
      url: () => `${apiUrl(base, '/api/v3/update/')}${encodeURIComponent(id.trim())}/`,
      body: () => ({ notes })
    });
    if (r.result) return r.result;
    return r.res.ok ? { ok: true, status: r.res.status } : { ok: false, status: r.res.status, error: 'HTTP' };
  }

  // 垃圾桶（JReader 原生端點）：移到垃圾桶 / 還原 / 永久刪除 / 清空。回 { ok, status, data } 或錯誤分類
  async function jreaderAction({ token, base, method, path, body, fetchImpl, timeoutMs }) {
    if (!normalizeApiBase(base)) return { ok: false, error: 'NO_BASE' };
    const r = await readwiseRequest({
      token, fetchImpl, timeoutMs, defaultTimeoutMs: READ_FETCH_TIMEOUT_MS, method,
      url: () => apiUrl(base, path),
      body: body ? () => body : undefined
    });
    if (r.result) return r.result;
    if (!r.res.ok) return { ok: false, status: r.res.status, error: r.res.status === 404 ? 'NOT_FOUND' : 'HTTP' };
    let data = null;
    try { data = r.res.status === 204 ? null : await r.res.json(); } catch (_) { data = null; }
    return { ok: true, status: r.res.status, data };
  }
  const docPath = (id, tail) => '/api/v1/documents/' + encodeURIComponent(String(id || '').trim()) + (tail || '');
  function trashJReaderDocument({ token, base, id, fetchImpl } = {}) {
    if (!id) return Promise.resolve({ ok: false, error: 'NO_ID' });
    return jreaderAction({ token, base, fetchImpl, method: 'POST', path: docPath(id, '/trash') });
  }
  function restoreJReaderDocument({ token, base, id, fetchImpl } = {}) {
    if (!id) return Promise.resolve({ ok: false, error: 'NO_ID' });
    return jreaderAction({ token, base, fetchImpl, method: 'POST', path: docPath(id, '/restore') });
  }
  function purgeJReaderDocument({ token, base, id, fetchImpl } = {}) {
    if (!id) return Promise.resolve({ ok: false, error: 'NO_ID' });
    return jreaderAction({ token, base, fetchImpl, method: 'DELETE', path: docPath(id) });
  }
  function emptyJReaderTrash({ token, base, fetchImpl } = {}) {
    return jreaderAction({ token, base, fetchImpl, method: 'POST', path: '/api/v1/trash/empty' });
  }
  // 公開分享連結（JReader POST / DELETE /api/v1/documents/:id/share）。建立成功回 { ok, data: { url, slug, created } }
  function shareJReaderDocument({ token, base, id, fetchImpl } = {}) {
    if (!id) return Promise.resolve({ ok: false, error: 'NO_ID' });
    return jreaderAction({ token, base, fetchImpl, method: 'POST', path: docPath(id, '/share') });
  }
  function unshareJReaderDocument({ token, base, id, fetchImpl } = {}) {
    if (!id) return Promise.resolve({ ok: false, error: 'NO_ID' });
    return jreaderAction({ token, base, fetchImpl, method: 'DELETE', path: docPath(id, '/share') });
  }

  // 多選批次（JReader POST /api/v1/documents/batch）：action＝move（帶 location）/ trash / restore / purge / tag（帶 tag）。
  // 成功回 { ok, data: { action, updated } }
  function batchJReaderDocuments({ token, base, ids, action, location, tag, fetchImpl } = {}) {
    if (!Array.isArray(ids) || !ids.length) return Promise.resolve({ ok: false, error: 'NO_ID' });
    const body = { ids: ids.map(String), action };
    if (location) body.location = location;
    if (tag) body.tag = tag;
    return jreaderAction({ token, base, fetchImpl, method: 'POST', path: '/api/v1/documents/batch', body });
  }

  // 查單篇（不帶全文）：給貼網址後輪詢 status（processing → ready / failed）
  async function getJReaderDocument({ token, base, id, fetchImpl, timeoutMs } = {}) {
    if (!normalizeApiBase(base)) return { ok: false, error: 'NO_BASE' };
    if (!id) return { ok: false, error: 'NO_ID' };
    const r = await listReaderDocuments({ token, base, id, fetchImpl, timeoutMs });
    if (!r || !r.ok) return r || { ok: false, error: 'HTTP' };
    const doc = (r.results || [])[0];
    return doc ? { ok: true, doc } : { ok: false, error: 'NOT_FOUND' };
  }

  // ---- Readwise Reader 整合（v1.0.22）----------------------------------
  // reader.html（擴充自有頁）用這兩支讀 Reader 文章清單 + 歸檔。重用 saveToReadwise
  // 同款 `Authorization: Token <token>` header + 錯誤分類（NO_TOKEN / AUTH 401·403 /
  // NETWORK / HTTP / NO_FETCH），fetchImpl 依賴注入便於 jsdom 純測。host 權限
  // <all_urls> 覆蓋 readwise.io，擴充頁直接 fetch 不卡 CORS。
  //   List：GET https://readwise.io/api/v3/list/ —— 公開 API **無 limit 參數**，回整頁
  // （上限 100，依 updated 由新到舊）+ nextPageCursor，取「最新十篇」由呼叫端 slice。
  // html_content 只在 withHtmlContent=true 時回（該模式 server 端重度 rate-limit、較慢），
  // 故 feed 列表不帶、點開單篇文章才帶（兩段式抓取，分散限流）。
  // 端點：<base>/api/v3/list/、<base>/api/v3/update/<id>/（v2.6.0 起經 apiUrl 組出）

  // 列文件。location='new'=inbox 收件匣；帶 id 取單篇；withHtmlContent=true 取主文 HTML。
  // 回 { ok:true, results, nextPageCursor } 或 { ok:false, error, status }。
  async function listReaderDocuments({ token, base, location, id, tag, withHtmlContent, pageCursor, inProgress, author, domain, fetchImpl, timeoutMs } = {}) {
    // v1.10.0：429 獨立分類（list 限流 20/min，文章 / feed 載入撞到時給「稍候再試」文案）
    const r = await readwiseRequest({
      token, fetchImpl, timeoutMs, defaultTimeoutMs: READ_FETCH_TIMEOUT_MS,
      method: 'GET',
      url: () => {
        const params = new URLSearchParams();
        if (location) params.set('location', location);
        if (id) params.set('id', id);
        if (tag) params.set('tag', tag);  // v1.0.25：依 tag 過濾（JRead 分頁撈 jread tag）
        if (withHtmlContent) params.set('withHtmlContent', 'true');
        if (pageCursor) params.set('pageCursor', pageCursor);
        // v3.1.0：JReader 擴充參數——Progress 分頁（讀到一半、依最後閱讀時間排序）
        if (inProgress) params.set('in_progress', 'true');
        // v3.1.0：JReader 擴充參數——同作者 / 同網域（文章資訊面板點作者、網域）
        if (author) params.set('author', author);
        if (domain) params.set('domain', domain);
        const qs = params.toString();
        const listUrl = apiUrl(base, '/api/v3/list/');
        return qs ? `${listUrl}?${qs}` : listUrl;
      }
    });
    if (r.result) return r.result;
    const res = r.res;
    if (!res.ok) {
      return { ok: false, status: res.status, error: 'HTTP' };
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* 非 JSON */ }
    const results = data && Array.isArray(data.results) ? data.results : [];
    const out = { ok: true, status: res.status, results, nextPageCursor: data && data.nextPageCursor || null };
    // count：符合條件的總篇數（同作者 / 同網域清單的標題列顯示）。只有伺服器有給才加——回傳形狀其餘不變
    //（review-1115-b5 E-07 逐案比對收斂前的回傳值）
    if (data && typeof data.count === 'number') out.count = data.count;
    return out;
  }

  // 搬移文件：PATCH https://readwise.io/api/v3/update/<id>/ body { location }。
  // Reader API 沒有獨立 archive / later 端點，改 location 即歸檔（'archive'）或移到
  // Later（'later'，v2.4.0 feed 右滑）。回 { ok, status } / 錯誤分類。
  const READER_MOVE_LOCATIONS = ['new', 'later', 'shortlist', 'archive'];
  async function moveReaderDocument({ token, base, id, location, fetchImpl, timeoutMs } = {}) {
    // v2.4.11（2026-11-15 review E-06）：限流要分類——v2.4.0 的連續左滑封存 / 右滑
    // Later 是最容易連打的操作，原本 429 落到 HTTP 顯示「封存失敗（HTTP 429）」
    //（v2.5.1 起 429 分類住在 readwiseRequest，不會再抄漏）
    const r = await readwiseRequest({
      token, fetchImpl, timeoutMs, defaultTimeoutMs: READ_FETCH_TIMEOUT_MS,
      precheck: () => {
        if (!id || typeof id !== 'string' || !id.trim()) return { ok: false, error: 'NO_ID' };
        if (!READER_MOVE_LOCATIONS.includes(location)) return { ok: false, error: 'NO_LOCATION' };
        return null;
      },
      url: () => `${apiUrl(base, '/api/v3/update/')}${encodeURIComponent(id.trim())}/`,
      method: 'PATCH', body: () => ({ location })
    });
    if (r.result) return r.result;
    const res = r.res;
    if (!res.ok) {
      return { ok: false, status: res.status, error: 'HTTP' };
    }
    return { ok: true, status: res.status };
  }

  function archiveReaderDocument(args = {}) {
    return moveReaderDocument({ ...args, location: 'archive' });
  }

  // v2.5.0：寫入閱讀進度：PATCH /api/v3/update/<id>/ body { reading_progress }（0–1）。
  // 2026-10-27 實測時這個欄位被默默忽略（回 200 值不變）；2026-11-15 官方文件的
  // update 欄位表已列出，實測寫入後 list 讀回新值、可以往回寫（0.03 → 0.02）、
  // updated_at 會前進、回應 body 只有 { id, url }（拿不到伺服器時間）。PDF 尚未支援。
  // keepalive：這支多半在頁面退出 / 背景化當下送（位置記憶的 flush 路徑），沒有它
  // 請求會跟著頁面一起被取消。回 { ok, status } / 錯誤分類（同 moveReaderDocument）。
  async function updateReaderProgress({ token, base, id, progress, fetchImpl, timeoutMs } = {}) {
    let p;
    const r = await readwiseRequest({
      token, fetchImpl, timeoutMs, defaultTimeoutMs: READ_FETCH_TIMEOUT_MS,
      precheck: () => {
        if (!id || typeof id !== 'string' || !id.trim()) return { ok: false, error: 'NO_ID' };
        p = Number(progress);
        if (progress == null || !Number.isFinite(p) || p < 0 || p > 1) return { ok: false, error: 'NO_PROGRESS' };
        return null;
      },
      url: () => `${apiUrl(base, '/api/v3/update/')}${encodeURIComponent(id.trim())}/`,
      method: 'PATCH', keepalive: true,
      body: () => ({ reading_progress: Math.round(p * 10000) / 10000 })
    });
    if (r.result) return r.result;
    const res = r.res;
    if (!res.ok) {
      return { ok: false, status: res.status, error: 'HTTP' };
    }
    return { ok: true, status: res.status };
  }

  // ---- JReader 畫重點（v1.10.0）--------------------------------------
  // 建立 / 刪除走 Reader API v3——重點是帶 parent_id 的文件：
  //   建立：POST /api/v3/save/ { parent_id, content }。content 必須逐字對得上 parent
  //        的文字（空白可不同），對不上回 400「Text not found」、什麼都不建。跨段落
  //        要用換行分隔（2026-10-27 實測：直接接起來 400、"\n" / "\n\n" 都 201）。
  //        同一段重送會再建一筆新的（實測 201 + 新 id，與官方文件說的 200 不符）
  //        ——防重複由呼叫端負責。
  //   刪除：DELETE /api/v3/delete/<id>/ → 204；已不存在回 404，對呼叫端等同成功。
  // 讀取既有重點走 Readwise v2 export（exportReaderHighlights），不走 v3 list：
  //   v3 list 的 category=highlight 沒有 parent_id 過濾、updatedAfter 看不到刪除，
  //   要對帳刪除只能整批重抓（577 筆＝6 頁），還跟文章載入共用 20/min 額度——實測
  //   兩輪就把文章載入擠成 429。v2 export 的 book.external_id＝Reader 文件 id、
  //   highlight.external_id＝Reader 重點 id，includeDeleted=true 帶 is_deleted，
  //   增量就看得到刪除（建立 / 刪除後約 6 秒反映到 export，2026-10-27 實測）。
  // 限流：v3 save 50/min、delete 20/min；超過回 429 + Retry-After。
  // 端點：<base>/api/v3/save/、<base>/api/v3/delete/<id>/（v2.6.0 起經 apiUrl 組出）

  function rateLimitResult(res) {
    let retryAfter = null;
    try {
      const v = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
      if (v != null && v !== '' && !isNaN(Number(v))) retryAfter = Number(v);
    } catch (_) { /* headers 不可讀 */ }
    return { ok: false, status: 429, error: 'RATE_LIMIT', retryAfter };
  }

  // 建立重點。回 { ok:true, id } / { ok:false, error }：NOT_FOUND（400，文字對不上
  // 原文）/ AUTH / RATE_LIMIT / TIMEOUT / NETWORK / HTTP / NO_TOKEN / NO_ID / EMPTY
  async function createReaderHighlight({ token, base, parentId, content, fetchImpl, timeoutMs } = {}) {
    const r = await readwiseRequest({
      token, fetchImpl, timeoutMs, defaultTimeoutMs: READ_FETCH_TIMEOUT_MS,
      precheck: () => {
        if (!parentId || typeof parentId !== 'string' || !parentId.trim()) return { ok: false, error: 'NO_ID' };
        if (!content || typeof content !== 'string' || !content.trim()) return { ok: false, error: 'EMPTY' };
        return null;
      },
      url: apiUrl(base, '/api/v3/save/'), method: 'POST',
      body: () => ({ parent_id: parentId.trim(), content, saved_using: 'JRead' })
    });
    if (r.result) return r.result;
    const res = r.res;
    if (res.status === 400) return { ok: false, status: 400, error: 'NOT_FOUND' };
    if (!res.ok) return { ok: false, status: res.status, error: 'HTTP' };
    let data = null;
    try { data = await res.json(); } catch (_) { /* 非 JSON */ }
    if (!data || !data.id) return { ok: false, status: res.status, error: 'HTTP' };
    return { ok: true, status: res.status, id: String(data.id) };
  }

  // 刪除重點（也適用一般文件，JReader 只拿來刪重點）。404 = 已經不在（別處刪過 /
  // 快取過期）→ 當成功，gone:true 讓呼叫端知道
  async function deleteReaderDocument({ token, base, id, fetchImpl, timeoutMs } = {}) {
    const r = await readwiseRequest({
      token, fetchImpl, timeoutMs, defaultTimeoutMs: READ_FETCH_TIMEOUT_MS,
      precheck: () => (!id || typeof id !== 'string' || !id.trim()) ? { ok: false, error: 'NO_ID' } : null,
      url: () => `${apiUrl(base, '/api/v3/delete/')}${encodeURIComponent(id.trim())}/`,
      method: 'DELETE'
    });
    if (r.result) return r.result;
    const res = r.res;
    if (res.status === 404) return { ok: true, status: 404, gone: true };
    if (!res.ok) return { ok: false, status: res.status, error: 'HTTP' };
    return { ok: true, status: res.status };
  }

  // 端點：<base>/api/v2/export/（v2.6.0 起經 apiUrl 組出）

  // 讀 Reader 文章的重點（v2 export，自動翻完所有頁）。updatedAfter 給 ISO 字串＝
  // 增量：回「這段時間有變動的文章」底下的**全部**重點（含已刪除、is_deleted=true），
  // 呼叫端可整篇替換；不給＝全量（不帶已刪除）。只收 Reader 來源（book 有
  // external_id）的文章。回 { ok:true, docs: { <Reader 文件 id>: [{ id, content,
  // offset, deleted }] } }。中途任何一頁失敗就整批回失敗（半套結果不能拿來整篇替換）。
  async function exportReaderHighlights({ token, base, updatedAfter, fetchImpl, timeoutMs, maxPages } = {}) {
    const limitPages = typeof maxPages === 'number' && maxPages > 0 ? maxPages : 50;
    const docs = {};
    let cursor = null;
    for (let page = 0; page < limitPages; page++) {
      const r = await readwiseRequest({
        token, fetchImpl, timeoutMs, defaultTimeoutMs: READ_FETCH_TIMEOUT_MS,
        method: 'GET',
        url: () => {
          const params = new URLSearchParams();
          if (updatedAfter) {
            params.set('updatedAfter', updatedAfter);
            params.set('includeDeleted', 'true');
          }
          if (cursor) params.set('pageCursor', cursor);
          const qs = params.toString();
          const exportUrl = apiUrl(base, '/api/v2/export/');
          return qs ? `${exportUrl}?${qs}` : exportUrl;
        }
      });
      if (r.result) return r.result;
      const res = r.res;
      if (!res.ok) return { ok: false, status: res.status, error: 'HTTP' };
      let data = null;
      try { data = await res.json(); } catch (_) { /* 非 JSON */ }
      const books = data && Array.isArray(data.results) ? data.results : null;
      if (!books) return { ok: false, status: res.status, error: 'HTTP' };
      for (const b of books) {
        if (!b || !b.external_id) continue;
        const list = docs[b.external_id] || (docs[b.external_id] = []);
        for (const h of Array.isArray(b.highlights) ? b.highlights : []) {
          if (!h || !h.external_id) continue;
          list.push({
            id: String(h.external_id),
            content: typeof h.text === 'string' ? h.text : '',
            offset: h.location_type === 'offset' && typeof h.location === 'number' ? h.location : null,
            deleted: !!(h.is_deleted || b.is_deleted)
          });
        }
      }
      if (!data.nextPageCursor) return { ok: true, docs };
      cursor = data.nextPageCursor;
    }
    return { ok: false, error: 'TOO_MANY_PAGES' };
  }

  // v0.8.74：驗證 Gemini API key 是否有效。打 models list 端點（GET，不送內文、
  // 零 token 成本），key 無效時 Google 回 400/401/403。回傳值與 validateReadwiseToken
  // 對齊（ok / error / status），讓 options 共用同一套分支判斷。NO_KEY（空）/
  // AUTH（400·401·403 → key 無效）/ NETWORK（連不上）/ HTTP（其他非 2xx）/
  // NO_FETCH（環境無 fetch）。
  async function validateGeminiKey({ apiKey, fetchImpl, timeoutMs } = {}) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return { ok: false, error: 'NO_FETCH' };
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return { ok: false, error: 'NO_KEY' };
    }
    let res;
    try {
      // key 走 header 不放 query（同 generateGeminiSummary，v1.6.25）
      res = await fetchWithTimeout(f, GEMINI_API_BASE.replace(/\/$/, ''), {
        method: 'GET',
        headers: { 'x-goog-api-key': apiKey.trim() }
      }, typeof timeoutMs === 'number' ? timeoutMs : AUTH_FETCH_TIMEOUT_MS);
    } catch (networkErr) {
      if (networkErr && networkErr.jreadTimeout) return { ok: false, error: 'TIMEOUT' };
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
  // v1.6.24：移除死 code readwiseResultToast / saveReaderPayload——v1.6.0 服務
  // 二擇一後 SW 改用 saveResultToast、popup 改用 sendDocument dispatcher，兩函式
  // runtime 呼叫端歸零（訊息文字已由 saveResultToast 單一資料源承接）。

  // ---- 儲存服務二擇一 dispatcher（v1.6.0）------------------------------
  // 讓「送出」與「讀入 feed/文章」服務無關：呼叫端只給 service（'readwise' |
  // 'instapaper'）+ creds + 資料，dispatcher 內部分派到對應底層函式（Readwise 走
  // 本檔既有 saveToReadwise / listReaderDocuments / archiveReaderDocument；Instapaper
  // 走 lib/instapaper.js 的 __JReadInstapaper）。回傳一律正規化成 JRead 共同文件
  // 契約（沿用 Readwise 欄位命名，reader-feed / reader-article 只吃這個 shape）。
  // instapaper 依賴以參數注入（測試用），預設抓全域 __JReadInstapaper（頁面 <script>
  // / SW importScripts 已先載）。
  function resolveInstapaper(dep) {
    if (dep) return dep;
    const g = (typeof globalThis !== 'undefined') ? globalThis
      : (typeof self !== 'undefined') ? self
        : (typeof window !== 'undefined') ? window : {};
    return g && g.__JReadInstapaper;
  }

  // v2.6.0：儲存服務三選一（readwise / instapaper / jreader）的單一資料源。
  // normalizeStorageService：未知 / 損壞值退回 'readwise'（v1.6.0 以來的既有行為）。
  // isReadwiseCompatible：走 Readwise 相容 API 的服務（jreader 只差 base）——讀取、搬移、
  // 重點、進度都共用 Readwise 那幾支函式，能力判斷（supports*）一律經過它。
  const STORAGE_SERVICES = ['readwise', 'instapaper', 'jreader'];
  function normalizeStorageService(v) {
    return STORAGE_SERVICES.indexOf(v) !== -1 ? v : 'readwise';
  }
  function isReadwiseCompatible(service) {
    return service === 'readwise' || service === 'jreader';
  }
  // 讀設定時三個服務的憑證欄位與預設值（popup / options / reader / SW / content 直送軌
  // 讀 storage 時展開這份，加欄位只改這裡）
  const SERVICE_SETTINGS_DEFAULTS = {
    storageService: 'readwise',
    readwiseToken: '',
    instapaperToken: '',
    instapaperTokenSecret: '',
    jreaderUrl: '',
    jreaderToken: ''
  };
  function serviceSettingsQuery(extra) {
    return Object.assign({}, SERVICE_SETTINGS_DEFAULTS, extra || {});
  }
  // creds → Readwise 系函式的 { token, base }（readwise 的 base 是 undefined＝readwise.io）
  function rwArgs(creds) {
    const c = creds || {};
    return { token: c.token, base: c.base };
  }

  function serviceLabel(service) {
    if (service === 'instapaper') return 'Instapaper';
    if (service === 'jreader') return 'JReader';
    return 'Readwise Reader';
  }

  // settings → { service, creds, ok }。單一憑證解析，popup / reader / SW 共用。
  // readwise：creds={token}；instapaper：creds={token,tokenSecret}；jreader（v2.6.0）：
  // creds={token,base}（base＝正規化後的 jreaderUrl）。ok=憑證齊備。
  function resolveServiceCredentials(settings) {
    const s = settings || {};
    const service = normalizeStorageService(s.storageService);
    if (service === 'jreader') {
      const token = typeof s.jreaderToken === 'string' ? s.jreaderToken.trim() : '';
      const base = normalizeApiBase(s.jreaderUrl);
      return { service, creds: { token, base }, ok: !!(token && base) };
    }
    if (service === 'instapaper') {
      const token = typeof s.instapaperToken === 'string' ? s.instapaperToken.trim() : '';
      const tokenSecret = typeof s.instapaperTokenSecret === 'string' ? s.instapaperTokenSecret.trim() : '';
      return { service, creds: { token, tokenSecret }, ok: !!(token && tokenSecret) };
    }
    const token = typeof s.readwiseToken === 'string' ? s.readwiseToken.trim() : '';
    return { service, creds: { token }, ok: !!token };
  }

  // 送出一篇。payload = extractReaderPayload 的 {url,html,title,summary,...}。
  // 回正規化 result（ok / status / error:NO_CREDENTIALS|CONFIG|AUTH|NETWORK|HTTP|
  // INVALID_PAYLOAD / detail?）。
  async function sendDocument({ service, creds, payload, fetchImpl, instapaper, timeoutMs, onProgress } = {}) {
    const c = creds || {};
    if (service === 'instapaper') {
      const IP = resolveInstapaper(instapaper);
      if (!IP) return { ok: false, error: 'CONFIG' };
      if (!c.token || !c.tokenSecret) return { ok: false, error: 'NO_CREDENTIALS' };
      let body;
      try {
        body = IP.buildInstapaperPayload({
          url: payload && payload.url,
          html: payload && payload.html,
          title: payload && payload.title,
          description: payload && payload.summary
        });
      } catch (e) {
        return { ok: false, error: 'INVALID_PAYLOAD', message: String(e && e.message || e) };
      }
      // v1.8.0：instapaper.js 只收 fetchImpl、不認識逾時參數——把時限包進
      // fetchImpl 本身（lib 端零改動），逾時的 abort 會被它歸類成網路錯誤，
      // 至少不再是永遠 pending 的 promise
      const ipFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
      return IP.saveToInstapaper({
        token: c.token, tokenSecret: c.tokenSecret, payload: body,
        fetchImpl: ipFetch ? withFetchTimeout(ipFetch, SAVE_FETCH_TIMEOUT_MS) : ipFetch
      });
    }
    if (service === 'jreader') {
      if (!c.token || !c.base) return { ok: false, error: 'NO_CREDENTIALS' };
      let body;
      try {
        body = buildJReaderPayload(payload || {});
      } catch (e) {
        return { ok: false, error: 'INVALID_PAYLOAD', message: String(e && e.message || e) };
      }
      const sendT0 = Date.now();
      jlog('POST JReader', { bytes: JSON.stringify(body).length, hasSummary: !!body.summary, isTranslated: !!body.is_translated });
      const res = await saveToJReader({ token: c.token, base: c.base, payload: body, fetchImpl, timeoutMs });
      jlog('POST JReader 回應', { ok: !!res.ok, status: res.status, error: res.error, ms: Date.now() - sendT0 },
        res.ok ? 'info' : 'error');
      return res;
    }
    if (!c.token) return { ok: false, error: 'NO_CREDENTIALS' };
    // v1.7.74：翻譯頁（should_clean_html=false 的 raw HTML 模式）送出前把內文圖
    // 內嵌成 data: URI——Readwise 端不會替 raw HTML 改寫 imgproxy，防盜連 CDN 的
    // 圖在 reader 端會被導成 1×1（見 inlineRawHtmlImages 註解）。非翻譯頁不做：
    // 那條走 Readwise 自家 imgproxy，內嵌只會白白撐大 payload。
    let sendPayload = payload || {};
    let inlineInfo = null;
    if (sendPayload.isTranslated && sendPayload.html) {
      const t0 = Date.now();
      try {
        const r = await inlineRawHtmlImages(sendPayload.html, { fetchImpl });
        jlog('翻譯頁內文圖內嵌', {
          inlined: r && r.inlined, skipped: r && r.skipped, bytes: r && r.bytes,
          htmlLen: r && r.html ? r.html.length : (sendPayload.html || '').length,
          ms: Date.now() - t0
        });
        if (r && r.inlined > 0) {
          inlineInfo = r;
          sendPayload = Object.assign({}, sendPayload, { html: r.html });
        }
      } catch (err) {
        jlog('內文圖內嵌失敗（照原樣送）', { reason: String(err && err.message || err).slice(0, 60) }, 'warn');
      }
    }
    let body;
    try {
      body = buildReadwisePayload(sendPayload);
    } catch (e) {
      return { ok: false, error: 'INVALID_PAYLOAD', message: String(e && e.message || e) };
    }
    const sendT0 = Date.now();
    const bodyBytes = JSON.stringify(body).length;
    // 大 payload 換一句進度文案：Readwise 端處理 700K raw HTML 實測要 40s 上下
    // （偶發，同一份 payload 也量過 1.3s——對端不穩定），同一句「送出中…」掛著
    // 不動 40 秒與當掉無法分辨。門檻取 300K：翻譯頁內嵌後普遍在這之上，一般頁
    // （should_clean_html=true、不內嵌）普遍在這之下
    const LARGE_PAYLOAD_BYTES = 300 * 1024;
    if (bodyBytes > LARGE_PAYLOAD_BYTES && typeof onProgress === 'function') onProgress('sendingLarge');
    jlog('POST Readwise', { bytes: bodyBytes, shouldCleanHtml: body.should_clean_html, hasSummary: !!body.summary });
    const res = await saveToReadwise({ token: c.token, payload: body, fetchImpl, timeoutMs });
    jlog('POST Readwise 回應', { ok: !!res.ok, status: res.status, error: res.error, ms: Date.now() - sendT0 },
      res.ok ? 'info' : 'error');
    // 退回未內嵌的原版重送一次：圖會破，但至少譯文存得進去。兩種觸發條件：
    //   - 413：payload 過大（Readwise 對 html 大小的上限未公開，這條是「預算估錯」
    //     的唯一防線）
    //   - TIMEOUT（v1.8.0）：內嵌後的 payload 比原版大一個量級（實測翻譯頁 48K →
    //     727K），送出沒回音時「先把小的那份送成功」比整篇丟失有價值
    if (!res.ok && (res.status === 413 || res.error === 'TIMEOUT') && inlineInfo) {
      let plain;
      try {
        plain = buildReadwisePayload(payload || {});
      } catch (_) {
        return res;
      }
      jlog('降級重送（退回未內嵌版）', { trigger: res.status === 413 ? 413 : 'TIMEOUT', bytes: JSON.stringify(plain).length }, 'warn');
      // v1.9.22（E-4）：重送是另一段最長 90s 的等待，進度 toast 要重新 arm（同 id 取代
      // 即重新計時），否則第 95s 淡掉後重送期間畫面全靜默
      if (typeof onProgress === 'function') onProgress(res.status === 413 ? 'retryingLarge' : 'retryingTimeout');
      const retry = await saveToReadwise({ token: c.token, payload: plain, fetchImpl, timeoutMs });
      jlog('降級重送結果', { ok: !!retry.ok, status: retry.status, error: retry.error }, retry.ok ? 'info' : 'error');
      return retry;
    }
    return res;
  }

  // 讀入端給 Instapaper lib 的 fetchImpl：把 READ_FETCH_TIMEOUT_MS 包進去（lib 端
  // 零改動；逾時的 abort 會被 lib 歸類成 NETWORK，至少不再是永遠 pending）。
  // fetchImpl 缺席且環境無 fetch → 回 undefined，讓 lib 走自己的 `= fetch` 預設值炸出
  // 原本的錯誤（不改變失敗型態）
  function readFetch(fetchImpl) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    return f ? withFetchTimeout(f, READ_FETCH_TIMEOUT_MS) : undefined;
  }

  // 列 feed 文件。query 為 feedTab 描述的 query 物件——readwise:{location|tag}、
  // instapaper:{folderId}。回 { ok, results:[共同 shape], nextPageCursor }。
  async function listDocuments({ service, creds, query, limit, fetchImpl, instapaper } = {}) {
    const c = creds || {};
    const q = query || {};
    if (service === 'instapaper') {
      const IP = resolveInstapaper(instapaper);
      if (!IP) return { ok: false, error: 'CONFIG' };
      if (!c.token || !c.tokenSecret) return { ok: false, error: 'NO_CREDENTIALS' };
      // v1.9.22（E-3）：instapaper.js 只收 fetchImpl——時限包進 fetchImpl 本身（同 sendDocument）
      return IP.listInstapaper({ token: c.token, tokenSecret: c.tokenSecret, folderId: q.folderId, limit: limit || 20, fetchImpl: readFetch(fetchImpl) });
    }
    if (!c.token) return { ok: false, error: 'NO_CREDENTIALS' };
    // v3.1.0：pageCursor＝「載入更多」翻下一頁（Readwise 相容 API 的 nextPageCursor）
    return listReaderDocuments(Object.assign(rwArgs(c), { location: q.location, tag: q.tag, pageCursor: q.pageCursor, inProgress: q.inProgress, author: q.author, domain: q.domain, fetchImpl }));
  }

  // 取單篇全文。readwise 憑 id 一次拿齊 metadata+html_content；instapaper get_text
  // 只回 html、metadata 用 feed 帶入的 meta 補。回 { ok, doc:共同 shape(含 html_content) }。
  async function getArticle({ service, creds, id, meta, fetchImpl, instapaper } = {}) {
    const c = creds || {};
    if (service === 'instapaper') {
      const IP = resolveInstapaper(instapaper);
      if (!IP) return { ok: false, error: 'CONFIG' };
      if (!c.token || !c.tokenSecret) return { ok: false, error: 'NO_CREDENTIALS' };
      const r = await IP.getInstapaperText({ token: c.token, tokenSecret: c.tokenSecret, id, fetchImpl: readFetch(fetchImpl) });
      if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'HTTP', status: r && r.status };
      const m = meta || {};
      const doc = {
        id: String(id),
        title: m.title || '',
        author: m.author || '',
        site_name: m.site_name || '',
        published_date: m.published_date || '',
        source_url: m.source_url || '',
        image_url: '',
        html_content: r.html || ''
      };
      if (!doc.html_content) return { ok: false, error: 'EMPTY' };
      return { ok: true, doc };
    }
    if (!c.token) return { ok: false, error: 'NO_CREDENTIALS' };
    const r = await listReaderDocuments(Object.assign(rwArgs(c), { id, withHtmlContent: true, fetchImpl }));
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'HTTP', status: r && r.status };
    const doc = (r.results || [])[0];
    if (!doc || !doc.html_content) return { ok: false, error: 'EMPTY' };
    return { ok: true, doc };
  }

  // 歸檔一篇。回 { ok, status } / 錯誤分類。
  async function archiveDocument({ service, creds, id, fetchImpl, instapaper } = {}) {
    const c = creds || {};
    if (service === 'instapaper') {
      const IP = resolveInstapaper(instapaper);
      if (!IP) return { ok: false, error: 'CONFIG' };
      if (!c.token || !c.tokenSecret) return { ok: false, error: 'NO_CREDENTIALS' };
      return IP.archiveInstapaper({ token: c.token, tokenSecret: c.tokenSecret, id, fetchImpl: readFetch(fetchImpl) });
    }
    if (!c.token) return { ok: false, error: 'NO_CREDENTIALS' };
    return archiveReaderDocument(Object.assign(rwArgs(c), { id, fetchImpl }));
  }

  // v2.5.0：把閱讀進度寫回儲存服務（0–1）。只有 Readwise 支援；Instapaper 回
  // UNSUPPORTED（它的 API 能不能寫進度還沒查證，先不做）。v2.6.0：jreader 走同一支
  // Readwise 相容端點，能力與 Readwise 相同
  function supportsProgressWrite(service) {
    return isReadwiseCompatible(service);
  }
  // v2.6.0：Article View 畫重點 / 顯示既有重點（reader-highlights.js 的 API 同步）
  function supportsHighlights(service) {
    return isReadwiseCompatible(service);
  }
  async function updateReadingProgress({ service, creds, id, progress, fetchImpl } = {}) {
    if (!supportsProgressWrite(service)) return { ok: false, error: 'UNSUPPORTED' };
    const c = creds || {};
    if (!c.token) return { ok: false, error: 'NO_CREDENTIALS' };
    return updateReaderProgress(Object.assign(rwArgs(c), { id, progress, fetchImpl }));
  }

  // v2.4.0：feed 右滑「稍後讀」。readwise → 移到 Later（location:'later'）；instapaper
  // 沒有 Later，改加星（Jimmy 2026-11-07 裁定）。回 { ok, status } / 錯誤分類。
  async function laterDocument({ service, creds, id, fetchImpl, instapaper } = {}) {
    const c = creds || {};
    if (service === 'instapaper') {
      const IP = resolveInstapaper(instapaper);
      if (!IP || typeof IP.starInstapaper !== 'function') return { ok: false, error: 'CONFIG' };
      if (!c.token || !c.tokenSecret) return { ok: false, error: 'NO_CREDENTIALS' };
      return IP.starInstapaper({ token: c.token, tokenSecret: c.tokenSecret, id, fetchImpl: readFetch(fetchImpl) });
    }
    if (!c.token) return { ok: false, error: 'NO_CREDENTIALS' };
    return moveReaderDocument(Object.assign(rwArgs(c), { id, location: 'later', fetchImpl }));
  }

  // v3.1.0：擴充內的「進入 Reader」（popup 按鈕、懸浮按鈕選單項）要不要出現。JReader 使用者改用
  // JReader 網頁版，不需要擴充內的 Reader（Jimmy 2026-11-24：「只對使用 JReader 的人生效」）；
  // Readwise / Instapaper 照舊。popup 與 floating-icon 都經這裡判斷
  function supportsExtensionReader(service) {
    return normalizeStorageService(service) !== 'jreader';
  }

  // v3.1.0：移回 Inbox（Later / 封存區右鍵、右滑）。Readwise 相容服務改 location:'new'；
  // Instapaper 沒有對應的資料夾操作，回 UNSUPPORTED
  async function inboxDocument({ service, creds, id, fetchImpl } = {}) {
    if (!isReadwiseCompatible(service)) return { ok: false, error: 'UNSUPPORTED' };
    const c = creds || {};
    if (!c.token) return { ok: false, error: 'NO_CREDENTIALS' };
    return moveReaderDocument(Object.assign(rwArgs(c), { id, location: 'new', fetchImpl }));
  }

  // v1.7.36：送出流程的「進行中」文字。popup 狀態列與快速鍵 toast 共用同一份
  // 事實——Jimmy 2026-08-04 回報快速鍵按下去只有最終結果、按當下沒反應；兩軌
  // 各自寫死字串會 drift（結果文字已由 saveResultToast 收斂，進度文字同理）。
  // SAVE_PROGRESS_TOAST_ID：快速鍵軌三則進度 toast 共用的 id，後一則取代前一則
  // 而不是往下疊。SAVE_PROGRESS_TOAST_MS：進度 toast 的顯示上限——結果一到就被
  // 同 id 取代，這個上限只是「流程中途死掉（SW 被回收 / 例外）不留孤兒 toast」
  // 的保險。
  // v1.8.0 sendingLarge：翻譯頁把內文圖內嵌成 data: URI 後 payload 可達 700K+，
  // Readwise 端要跑 40s 上下（見 SAVE_FETCH_TIMEOUT_MS 註解）。同一句「送出中…」
  // 掛著不動 40 秒，使用者只會覺得當掉了——大 payload 換一句說明等待是正常的
  // v1.9.22 retrying*（review E-4）：降級重送（413 / 逾時後退回未內嵌版）前重新 arm
  // 進度 toast。原本第一次 POST 跑滿 90s 逾時後直接重送、進度 toast 第 95s 淡掉，
  // 之後最長 85s 畫面全靜默才突然冒結果——正是「失敗沒提示」同一個體感。同 id 的
  // toast 被取代即重新計時，所以 SAVE_PROGRESS_TOAST_MS 的不變式是「> 單一階段的
  // 最長等待」而非「> 整條流程」——每個階段（摘要 / 送出 / 重送）開始都回報一次
  const SAVE_PROGRESS = {
    sending: '送出中…',
    sendingLarge: '送出中…（內容較大，需要久一點）',
    summarizing: '產生摘要中…',
    retryingTimeout: '送出沒回音，改送精簡版…',
    retryingLarge: '內容過大，改送精簡版…'
  };
  const SAVE_PROGRESS_TOAST_ID = 'jread-save';
  // 進度 toast 的顯示上限必須覆蓋**單一階段**的最長等待（> SAVE_FETCH_TIMEOUT_MS；
  // 每個階段開始都重新回報一次 onProgress → 同 id 取代 → 重新計時，見 SAVE_PROGRESS
  // 的 retrying 註解）——原本 15s 到點就淡掉，對端還在跑的那 40 秒使用者眼前一片
  // 安靜，與「失敗了沒提示」完全同一個體感（Jimmy 2026-08-20 回報的另一半）。
  // 結果 toast 一到就取代它，所以設長不會留下殘影
  const SAVE_PROGRESS_TOAST_MS = 95000;

  // 送出結果 → toast 文字 + kind（服務感知；快速鍵 toast 軌與 popup 狀態列軌的
  // 訊息文字單一資料源——popup 端用 kind 轉換層對映 success/error → ok/err）。
  // serviceLabel 帶入服務名。existsOn200：Readwise 200=已存在、201=新建
  // （Instapaper 無此區分，一律「已送到」）。credsPlace：NO_CREDENTIALS 指引
  // 使用者去填憑證的位置——快速鍵 toast 沒有 popup 可指，預設「設定頁」；popup
  // 軌傳「『進階設定』」指向自己的 footer 連結。
  function saveResultToast(result, opts) {
    const o = opts || {};
    const label = o.serviceLabel || 'Readwise Reader';
    if (result && result.ok) {
      return {
        message: (o.existsOn200 && result.status === 200) ? `已存在於 ${label}` : `已送到 ${label}`,
        kind: 'success'
      };
    }
    if (result && result.error === 'NO_CREDENTIALS') {
      return { message: `尚未設定 ${label} 憑證，請到${o.credsPlace || '設定頁'}填入`, kind: 'error' };
    }
    if (result && result.error === 'CONFIG') {
      return { message: `此版本未內建 ${label} 金鑰`, kind: 'error' };
    }
    if (result && result.error === 'AUTH') {
      return { message: `${label} 憑證無效或已過期`, kind: 'error' };
    }
    if (isTimeoutResult(result)) {
      // v1.8.0：與 NETWORK 分開——逾時是「送出去了但對方沒回音」，使用者該做的是
      // 再試一次，不是去檢查網路
      return { message: `${label} 沒有回應，請再試一次`, kind: 'error' };
    }
    if (result && result.error === 'NETWORK') {
      return { message: '網路錯誤，請稍後再試', kind: 'error' };
    }
    // generic 分支帶上 error code（INVALID_PAYLOAD / HTTP 碼）方便真機回報看出失敗層次
    const detail = result && result.status ? `（HTTP ${result.status}）`
                 : result && result.error ? `（${result.error}）` : '';
    const reason = result && result.detail ? `：${result.detail}` : '';
    return { message: `送出失敗${detail}${reason}`, kind: 'error' };
  }

  // 2026-10-07 review F-10：讀入端（JReader feed 封存 / 文章載入）錯誤碼 → 文案的
  // 單一資料源。action 帶動作名（'封存' / '載入'），reader-feed / reader-article
  // 不再各抄一張表（舊版載入端靠 `.replace('封存','載入')` 借用封存端的表，加
  // 新錯誤碼只會改到一邊）。CONFIG = Instapaper client / 金鑰缺檔（E-1）。
  // v2.4.11（2026-11-15 review E-05）：「這個結果是逾時嗎」的單一資料源。Readwise
  // 各支回 error:'TIMEOUT'；Instapaper lib 把 readFetch 的逾時 abort 歸成
  // error:'NETWORK' + message:'TIMEOUT'（lib 端零改動的代價，見 readFetch）。舊版
  // serviceErrorMessage 只認前者 → 同一種逾時 Instapaper 顯示「網路錯誤」，
  // options 連結流程另外自己補認一份。
  function isTimeoutResult(result) {
    return !!result && (result.error === 'TIMEOUT' ||
      (result.error === 'NETWORK' && result.message === 'TIMEOUT'));
  }
  function serviceErrorMessage(result, opts) {
    const action = (opts && opts.action) || '載入';
    if (result && (result.error === 'AUTH' || result.error === 'NO_CREDENTIALS')) return '登入憑證無效或已過期';
    if (result && result.error === 'CONFIG') return `此版本未內建 Instapaper 金鑰，無法${action}`;
    if (isTimeoutResult(result)) return `伺服器沒有回應，${action}失敗，請再試一次`;
    if (result && result.error === 'NETWORK') return `網路錯誤，${action}失敗，請稍後再試`;
    if (result && result.error === 'RATE_LIMIT') return `${(opts && opts.service === 'jreader') ? 'JReader' : 'Readwise'} 請求太頻繁，${action}失敗，請稍候一分鐘再試`;
    const detail = result && result.status ? `（HTTP ${result.status}）` : '';
    return `${action}失敗${detail}`;
  }

  // v1.7.79：送出一篇的完整流程（憑證解析 → 選用 Gemini 摘要 → 送出 → 結果訊息）
  // 的單一資料源。呼叫端只給「已讀好的 settings」+ payload + onProgress 回呼，拿回
  // { result, toast, service, label }；差別只在 fetch 執行環境與進度呈現方式：
  //   - SW 軌（快速鍵送出）：onProgress → SHOW_TOAST 訊息回 content
  //   - content 直送軌（懸浮按鈕長按選單，Safari / iOS）：onProgress → NS.toast
  // onProgress 收 'sending' | 'summarizing'（對映 SAVE_PROGRESS 的 key，文字仍由
  // SAVE_PROGRESS 單一資料源提供）。摘要階段結束會再回報一次 'sending'，與 popup
  // 狀態列同序。credsPlace 透傳給 saveResultToast（NO_CREDENTIALS 指引位置）。
  async function saveDocumentFlow({ settings, payload, onProgress, fetchImpl, instapaper, credsPlace, timeoutMs } = {}) {
    const progress = typeof onProgress === 'function' ? onProgress : () => {};
    const s = settings || {};
    const { service, creds, ok } = resolveServiceCredentials(s);
    const label = serviceLabel(service);
    // v2.6.0：JReader 的 save 與 Readwise 同語意（200＝網址已存在、201＝新建）
    const toastOpts = { serviceLabel: label, existsOn200: isReadwiseCompatible(service), credsPlace };
    if (!ok) {
      const result = { ok: false, error: 'NO_CREDENTIALS' };
      return { result, toast: saveResultToast(result, toastOpts), service, label };
    }
    const p = payload || {};
    // 選用：Gemini 三句摘要（兩服務共用——Readwise 對映 summary、Instapaper 對映
    // description）。失敗不阻斷送出，照原樣送。
    if (s.readwiseSummary && s.geminiApiKey && p.text) {
      progress('summarizing');
      const sumT0 = Date.now();
      try {
        const sum = await generateGeminiSummary({
          apiKey: s.geminiApiKey, title: p.title, author: p.author, domain: p.domain, text: p.text, fetchImpl,
          timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined
        });
        jlog('Gemini 摘要', { ok: !!(sum && sum.ok), error: sum && sum.error, ms: Date.now() - sumT0 },
          (sum && sum.ok) ? 'info' : 'warn');
        if (sum && sum.ok) p.summary = sum.summary;
      } catch (_) { /* 摘要失敗不阻斷送出 */ }
      progress('sending');
    }
    let result;
    try {
      // onProgress 透傳：payload 大小要等 sendDocument 內的圖片內嵌跑完才算得準
      //（翻譯頁 48K → 727K 全在那一步發生），大小相關的進度回報因此住在那裡
      result = await sendDocument({ service, creds, payload: p, fetchImpl, instapaper, timeoutMs, onProgress: progress });
    } catch (_) {
      // fetch 本身炸掉（離線 / DNS）→ 與 sendDocument 內部的網路錯誤同一則訊息
      result = { ok: false, error: 'NETWORK' };
    }
    return { result, toast: saveResultToast(result, toastOpts), service, label };
  }

  const api = {
    sendWithInjectionFallback,
    toggleWithInjectionFallback,
    toggleFailureMessage,
    CONTENT_SCRIPT_FILES,
    buildReadwisePayload,
    detectHanLanguage,
    // v1.7.74：翻譯頁匯出的內文圖內嵌（防盜連 CDN 修法）
    inlineRawHtmlImages,
    // v1.8.0：對外 fetch 一律有時限（送出流程靜默卡死的根治）
    fetchWithTimeout,
    withFetchTimeout,
    SAVE_FETCH_TIMEOUT_MS,
    SUMMARY_FETCH_TIMEOUT_MS,
    AUTH_FETCH_TIMEOUT_MS,
    READ_FETCH_TIMEOUT_MS,
    parseSrcsetCandidates,
    pickInlineImageUrl,
    pickInlineImageUrls,
    collectPictureSources,
    stripPictureSources,
    saveToReadwise,
    // v2.5.1（review E-07）：Readwise 請求樣板（各支共用；匯出供 spec 驗）
    readwiseRequest,
    readwiseErrorDetail,
    validateReadwiseToken,
    // v2.6.0：JReader（自架 Readwise 相容後端）
    READWISE_BASE,
    HOST_SESSION_TOKEN,
    normalizeApiBase,
    STORAGE_SERVICES,
    normalizeStorageService,
    isReadwiseCompatible,
    SERVICE_SETTINGS_DEFAULTS,
    serviceSettingsQuery,
    buildJReaderPayload,
    saveToJReader,
    validateJReaderToken,
    supportsHighlights,
    // v3.1.0：JReader 書庫工具（搜尋 / 貼網址 / 標籤）
    supportsLibraryTools,
    supportsExtensionReader,
    searchJReader,
    listJReaderTags,
    setJReaderTags,
    saveUrlToJReader,
    getJReaderDocument,
    markJReaderOpened,
    setJReaderNotes,
    trashJReaderDocument,
    restoreJReaderDocument,
    purgeJReaderDocument,
    emptyJReaderTrash,
    batchJReaderDocuments,
    shareJReaderDocument,
    unshareJReaderDocument,
    listReaderDocuments,
    archiveReaderDocument,
    moveReaderDocument,
    // v1.10.0：JReader 畫重點
    createReaderHighlight,
    deleteReaderDocument,
    exportReaderHighlights,
    // v1.6.0：儲存服務 dispatcher（服務無關抽象層）
    resolveServiceCredentials,
    serviceLabel,
    sendDocument,
    listDocuments,
    getArticle,
    archiveDocument,
    laterDocument,
    inboxDocument,
    updateReadingProgress,
    supportsProgressWrite,
    updateReaderProgress,
    saveResultToast,
    serviceErrorMessage,
    isTimeoutResult,
    saveDocumentFlow,
    SAVE_PROGRESS,
    SAVE_PROGRESS_TOAST_ID,
    SAVE_PROGRESS_TOAST_MS,
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
