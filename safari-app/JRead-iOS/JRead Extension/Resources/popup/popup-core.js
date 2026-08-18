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
    'content/home-launcher.js',
    'content/orion-detect.js',
    'content/keepalive.js',
    'content/settings-defaults.js',
    'content/domain-match.js',
    'content/link-follow.js',
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
  //            published_date?, location?, category?, tags?, notes?, language? }
  // 200 = 已存在、201 = 新建。
  // 註：v0.7.167 曾記「API 沒 language 欄位」——已證實為誤（Shinkansen 專案
  // 2026-07-31 實測：欄位存在且有效）。繁中內容必須帶 language，見
  // detectHanLanguage 註解。
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
      res = await f(buildGeminiSummaryUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
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

  // ---- Readwise Reader 整合（v1.0.22）----------------------------------
  // reader.html（擴充自有頁）用這兩支讀 Reader 文章清單 + 歸檔。重用 saveToReadwise
  // 同款 `Authorization: Token <token>` header + 錯誤分類（NO_TOKEN / AUTH 401·403 /
  // NETWORK / HTTP / NO_FETCH），fetchImpl 依賴注入便於 jsdom 純測。host 權限
  // <all_urls> 覆蓋 readwise.io，擴充頁直接 fetch 不卡 CORS。
  //   List：GET https://readwise.io/api/v3/list/ —— 公開 API **無 limit 參數**，回整頁
  // （上限 100，依 updated 由新到舊）+ nextPageCursor，取「最新十篇」由呼叫端 slice。
  // html_content 只在 withHtmlContent=true 時回（該模式 server 端重度 rate-limit、較慢），
  // 故 feed 列表不帶、點開單篇文章才帶（兩段式抓取，分散限流）。
  const READER_LIST_URL = 'https://readwise.io/api/v3/list/';
  const READER_UPDATE_URL = 'https://readwise.io/api/v3/update/'; // + <id>/

  // 列文件。location='new'=inbox 收件匣；帶 id 取單篇；withHtmlContent=true 取主文 HTML。
  // 回 { ok:true, results, nextPageCursor } 或 { ok:false, error, status }。
  async function listReaderDocuments({ token, location, id, tag, withHtmlContent, pageCursor, fetchImpl } = {}) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return { ok: false, error: 'NO_FETCH' };
    if (!token || typeof token !== 'string' || !token.trim()) {
      return { ok: false, error: 'NO_TOKEN' };
    }
    const params = new URLSearchParams();
    if (location) params.set('location', location);
    if (id) params.set('id', id);
    if (tag) params.set('tag', tag);  // v1.0.25：依 tag 過濾（JRead 分頁撈 jread tag）
    if (withHtmlContent) params.set('withHtmlContent', 'true');
    if (pageCursor) params.set('pageCursor', pageCursor);
    const qs = params.toString();
    const url = qs ? `${READER_LIST_URL}?${qs}` : READER_LIST_URL;
    let res;
    try {
      res = await f(url, {
        method: 'GET',
        headers: { 'Authorization': `Token ${token.trim()}` }
      });
    } catch (networkErr) {
      return { ok: false, error: 'NETWORK', message: String(networkErr && networkErr.message || networkErr) };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, error: 'AUTH' };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: 'HTTP' };
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* 非 JSON */ }
    const results = data && Array.isArray(data.results) ? data.results : [];
    return { ok: true, status: res.status, results, nextPageCursor: data && data.nextPageCursor || null };
  }

  // 歸檔文件：PATCH https://readwise.io/api/v3/update/<id>/ body { location:'archive' }。
  // Reader API 沒有獨立 archive 端點，改 location 即歸檔。回 { ok, status } / 錯誤分類。
  async function archiveReaderDocument({ token, id, fetchImpl } = {}) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return { ok: false, error: 'NO_FETCH' };
    if (!token || typeof token !== 'string' || !token.trim()) {
      return { ok: false, error: 'NO_TOKEN' };
    }
    if (!id || typeof id !== 'string' || !id.trim()) {
      return { ok: false, error: 'NO_ID' };
    }
    let res;
    try {
      res = await f(`${READER_UPDATE_URL}${encodeURIComponent(id.trim())}/`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Token ${token.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ location: 'archive' })
      });
    } catch (networkErr) {
      return { ok: false, error: 'NETWORK', message: String(networkErr && networkErr.message || networkErr) };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, error: 'AUTH' };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: 'HTTP' };
    }
    return { ok: true, status: res.status };
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
      // key 走 header 不放 query（同 generateGeminiSummary，v1.6.25）
      res = await f(GEMINI_API_BASE.replace(/\/$/, ''), {
        method: 'GET',
        headers: { 'x-goog-api-key': apiKey.trim() }
      });
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

  function serviceLabel(service) {
    return service === 'instapaper' ? 'Instapaper' : 'Readwise Reader';
  }

  // settings → { service, creds, ok }。單一憑證解析，popup / reader / SW 共用。
  // readwise：creds={token}；instapaper：creds={token,tokenSecret}。ok=憑證齊備。
  function resolveServiceCredentials(settings) {
    const s = settings || {};
    const service = s.storageService === 'instapaper' ? 'instapaper' : 'readwise';
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
  async function sendDocument({ service, creds, payload, fetchImpl, instapaper } = {}) {
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
      return IP.saveToInstapaper({ token: c.token, tokenSecret: c.tokenSecret, payload: body, fetchImpl });
    }
    if (!c.token) return { ok: false, error: 'NO_CREDENTIALS' };
    // v1.7.74：翻譯頁（should_clean_html=false 的 raw HTML 模式）送出前把內文圖
    // 內嵌成 data: URI——Readwise 端不會替 raw HTML 改寫 imgproxy，防盜連 CDN 的
    // 圖在 reader 端會被導成 1×1（見 inlineRawHtmlImages 註解）。非翻譯頁不做：
    // 那條走 Readwise 自家 imgproxy，內嵌只會白白撐大 payload。
    let sendPayload = payload || {};
    let inlineInfo = null;
    if (sendPayload.isTranslated && sendPayload.html) {
      try {
        const r = await inlineRawHtmlImages(sendPayload.html, { fetchImpl });
        if (r && r.inlined > 0) {
          inlineInfo = r;
          sendPayload = Object.assign({}, sendPayload, { html: r.html });
        }
      } catch (_) { /* 內嵌是加分項，失敗就照原樣送 */ }
    }
    let body;
    try {
      body = buildReadwisePayload(sendPayload);
    } catch (e) {
      return { ok: false, error: 'INVALID_PAYLOAD', message: String(e && e.message || e) };
    }
    const res = await saveToReadwise({ token: c.token, payload: body, fetchImpl });
    // payload 過大（413）時退回未內嵌的原版重送一次：圖會破，但至少譯文存得進去。
    // Readwise 對 html 大小的上限未公開，這條是「預算估錯」的唯一防線。
    if (!res.ok && res.status === 413 && inlineInfo) {
      let plain;
      try {
        plain = buildReadwisePayload(payload || {});
      } catch (_) {
        return res;
      }
      return saveToReadwise({ token: c.token, payload: plain, fetchImpl });
    }
    return res;
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
      return IP.listInstapaper({ token: c.token, tokenSecret: c.tokenSecret, folderId: q.folderId, limit: limit || 20, fetchImpl });
    }
    if (!c.token) return { ok: false, error: 'NO_CREDENTIALS' };
    return listReaderDocuments({ token: c.token, location: q.location, tag: q.tag, fetchImpl });
  }

  // 取單篇全文。readwise 憑 id 一次拿齊 metadata+html_content；instapaper get_text
  // 只回 html、metadata 用 feed 帶入的 meta 補。回 { ok, doc:共同 shape(含 html_content) }。
  async function getArticle({ service, creds, id, meta, fetchImpl, instapaper } = {}) {
    const c = creds || {};
    if (service === 'instapaper') {
      const IP = resolveInstapaper(instapaper);
      if (!IP) return { ok: false, error: 'CONFIG' };
      if (!c.token || !c.tokenSecret) return { ok: false, error: 'NO_CREDENTIALS' };
      const r = await IP.getInstapaperText({ token: c.token, tokenSecret: c.tokenSecret, id, fetchImpl });
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
    const r = await listReaderDocuments({ token: c.token, id, withHtmlContent: true, fetchImpl });
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
      return IP.archiveInstapaper({ token: c.token, tokenSecret: c.tokenSecret, id, fetchImpl });
    }
    if (!c.token) return { ok: false, error: 'NO_CREDENTIALS' };
    return archiveReaderDocument({ token: c.token, id, fetchImpl });
  }

  // v1.7.36：送出流程的「進行中」文字。popup 狀態列與快速鍵 toast 共用同一份
  // 事實——Jimmy 2026-08-04 回報快速鍵按下去只有最終結果、按當下沒反應；兩軌
  // 各自寫死字串會 drift（結果文字已由 saveResultToast 收斂，進度文字同理）。
  // SAVE_PROGRESS_TOAST_ID：快速鍵軌三則進度 toast 共用的 id，後一則取代前一則
  // 而不是往下疊。SAVE_PROGRESS_TOAST_MS：進度 toast 的顯示上限——結果一到就被
  // 同 id 取代，這個上限只是「流程中途死掉（SW 被回收 / 例外）不留孤兒 toast」
  // 的保險。
  const SAVE_PROGRESS = { sending: '送出中…', summarizing: '產生摘要中…' };
  const SAVE_PROGRESS_TOAST_ID = 'jread-save';
  const SAVE_PROGRESS_TOAST_MS = 15000;

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
    if (result && result.error === 'NETWORK') {
      return { message: '網路錯誤，請稍後再試', kind: 'error' };
    }
    // generic 分支帶上 error code（INVALID_PAYLOAD / HTTP 碼）方便真機回報看出失敗層次
    const detail = result && result.status ? `（HTTP ${result.status}）`
                 : result && result.error ? `（${result.error}）` : '';
    const reason = result && result.detail ? `：${result.detail}` : '';
    return { message: `送出失敗${detail}${reason}`, kind: 'error' };
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
    parseSrcsetCandidates,
    pickInlineImageUrl,
    pickInlineImageUrls,
    collectPictureSources,
    stripPictureSources,
    saveToReadwise,
    readwiseErrorDetail,
    validateReadwiseToken,
    listReaderDocuments,
    archiveReaderDocument,
    // v1.6.0：儲存服務 dispatcher（服務無關抽象層）
    resolveServiceCredentials,
    serviceLabel,
    sendDocument,
    listDocuments,
    getArticle,
    archiveDocument,
    saveResultToast,
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
