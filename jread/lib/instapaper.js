// JRead — Instapaper Full API（OAuth 1.0a + xAuth）封裝
//
// 「儲存服務二擇一」的 Instapaper 端核心。Instapaper 沒有 Readwise 式單一 access
// token，要送「完整內容」只有 Full API（/api/1/...）做得到——bookmarks/add 的
// content 參數可吃整頁 HTML，Instapaper 端跑自己的 readability 抽正文；讀入端
// bookmarks/list + get_text 讓 JReader 直接讀 Instapaper 帳號裡的文章。
//
// 認證走 xAuth（x_auth_mode=client_auth）：使用者在 options 填一次 Instapaper
// email + 密碼，換一組 OAuth token + token secret，之後只存 token、密碼用完即丟。
//
// 移植自姊妹專案 Shinkansen lib/instapaper.js（OAuth 簽章 + 送出逐字照搬、已在
// Shinkansen 有簽章 spec 與 iOS 實測驗過），另新增讀取端（list / get_text / archive）
// 與「正規化成 JRead 共同文件契約」的 adapter。
//
// 架構：純函式 + 依賴注入（fetchImpl / signImpl / 金鑰皆可注入），IIFE dual export
//   - popup.html / options.html / reader.html / article.html 以 <script> 載入（掛
//     window.__JReadInstapaper）；service-worker 以 importScripts 載入（掛 self）
//   - content script 不載此檔（避免把 consumer secret 注入每個網頁）
//   - 測試走注入，不依賴 gitignored 的 instapaper-keys.js，fresh clone / CI 不報錯
//
// 簽章遵循 RFC 5849（OAuth 1.0a）：
//   base string = METHOD&pctEncode(URL)&pctEncode(排序後所有參數)
//   signing key = pctEncode(consumerSecret)&pctEncode(tokenSecret)
//   HMAC-SHA1 → base64
// content / folder_id / limit 等 form 參數都納入 base string（base string 會很大，
// 但這是 Full API client 的標準作法，無功能問題）。

(function () {
  'use strict';

  // ─── 端點常數 ──────────────────────────────────────────────
  const INSTAPAPER_ACCESS_TOKEN_URL = 'https://www.instapaper.com/api/1/oauth/access_token';
  const INSTAPAPER_ADD_URL = 'https://www.instapaper.com/api/1/bookmarks/add';
  const INSTAPAPER_LIST_URL = 'https://www.instapaper.com/api/1/bookmarks/list';
  const INSTAPAPER_GET_TEXT_URL = 'https://www.instapaper.com/api/1/bookmarks/get_text';
  const INSTAPAPER_ARCHIVE_URL = 'https://www.instapaper.com/api/1/bookmarks/archive';

  // ─── consumer 金鑰讀取 ────────────────────────────────────
  // instapaper-keys.js（gitignored）載入後掛在 globalThis.__JReadKeys.INSTAPAPER。
  // 讀不到（fresh clone / CI / 未申請 / store build 未注入）→ 回 null，呼叫端據此
  // 停用 Instapaper 功能（不報錯，Readwise 照常）。
  function getInstapaperConsumerKeys() {
    const root = (typeof globalThis !== 'undefined') ? globalThis
      : (typeof self !== 'undefined') ? self
        : (typeof window !== 'undefined') ? window : {};
    const keys = root && root.__JReadKeys && root.__JReadKeys.INSTAPAPER;
    if (keys && keys.consumerKey && keys.consumerSecret) {
      return { consumerKey: keys.consumerKey, consumerSecret: keys.consumerSecret };
    }
    return null;
  }

  // consumer 金鑰是否就緒（options / popup 用來決定要不要顯示 Instapaper 入口）。
  function hasInstapaperConsumerKeys() {
    return getInstapaperConsumerKeys() !== null;
  }

  // ─── OAuth 工具（純函式）──────────────────────────────────

  // RFC 3986 percent-encode。encodeURIComponent 不編碼 - _ . ! ~ * ' ( )；
  // 其中 unreserved 只保留 - _ . ~，所以還要把 ! * ' ( ) 補編成 %XX。
  function oauthPercentEncode(str) {
    return encodeURIComponent(String(str)).replace(/[!*'()]/g, (c) =>
      '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }

  // 排序 + 編碼所有參數成 RFC 5849 §3.4.1.3.2 的 normalized parameter string。
  // params:{ k: v } 或 { k: [v1, v2] }（同 key 多值）。先各自 pctEncode，
  // 再依「編碼後的 key，key 相同則編碼後的 value」字典序排序，組 key=value 以 & 連接。
  function normalizeOAuthParams(params) {
    const pairs = [];
    for (const key of Object.keys(params)) {
      const value = params[key];
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        pairs.push([oauthPercentEncode(key), oauthPercentEncode(v)]);
      }
    }
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)));
    return pairs.map(([k, v]) => `${k}=${v}`).join('&');
  }

  // base string = METHOD & pctEncode(URL) & pctEncode(normalized params)。
  function buildOAuthBaseString({ method, url, params }) {
    return [
      String(method).toUpperCase(),
      oauthPercentEncode(url),
      oauthPercentEncode(normalizeOAuthParams(params)),
    ].join('&');
  }

  // signing key = pctEncode(consumerSecret) & pctEncode(tokenSecret)。
  function buildOAuthSigningKey({ consumerSecret, tokenSecret }) {
    return `${oauthPercentEncode(consumerSecret || '')}&${oauthPercentEncode(tokenSecret || '')}`;
  }

  // 預設簽章實作：crypto.subtle HMAC-SHA1 → base64。瀏覽器（popup / options / reader）
  // 與 service worker（background）都有 crypto.subtle。測試環境注入 Node crypto。
  async function defaultSign(signingKey, baseString) {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw', enc.encode(signingKey), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(baseString));
    const bytes = new Uint8Array(sig);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  // crypto.getRandomValues 產生 nonce（hex）。SW / 瀏覽器皆有 crypto。
  function generateNonce() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    let s = '';
    for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
    return s;
  }

  // 簽一個請求，回 { authHeader, oauthParams, signature, baseString }。
  // bodyParams 是非 oauth_ 的 form 參數（x_auth_* / url / title / content /
  // bookmark_id / folder_id / limit），一併納入 base string，但 authHeader 只列
  // oauth_ 參數。nonce / timestamp 可注入（測試固定值）。
  async function signRequest({
    method, url, consumerKey, consumerSecret, token, tokenSecret,
    bodyParams = {}, nonce, timestamp, signImpl = defaultSign,
  }) {
    const oauthParams = {
      oauth_consumer_key: consumerKey,
      oauth_nonce: nonce || generateNonce(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
      oauth_version: '1.0',
    };
    if (token) oauthParams.oauth_token = token;

    const allParams = { ...bodyParams, ...oauthParams };
    const baseString = buildOAuthBaseString({ method, url, params: allParams });
    const signingKey = buildOAuthSigningKey({ consumerSecret, tokenSecret });
    const signature = await signImpl(signingKey, baseString);

    const headerParams = { ...oauthParams, oauth_signature: signature };
    const authHeader = 'OAuth ' + Object.keys(headerParams)
      .sort()
      .map((k) => `${oauthPercentEncode(k)}="${oauthPercentEncode(headerParams[k])}"`)
      .join(', ');

    return { authHeader, oauthParams, signature, baseString };
  }

  // 把 form 參數編碼成 application/x-www-form-urlencoded body。
  // 刻意用 oauthPercentEncode（而非 URLSearchParams 的 space→+）讓 body 的編碼與
  // 簽章 base string 的參數編碼完全一致，伺服器解出來的值才會跟我們簽的一致。
  function encodeFormBody(params) {
    return Object.keys(params)
      .map((k) => `${oauthPercentEncode(k)}=${oauthPercentEncode(params[k])}`)
      .join('&');
  }

  // 解析 access_token 回應：`oauth_token=xxx&oauth_token_secret=yyy`。
  // 缺欄位回 null（呼叫端轉成 error）。
  function parseTokenResponse(text) {
    if (!text || typeof text !== 'string') return null;
    const sp = new URLSearchParams(text.trim());
    const token = sp.get('oauth_token');
    const tokenSecret = sp.get('oauth_token_secret');
    if (!token || !tokenSecret) return null;
    return { token, tokenSecret };
  }

  // 組 bookmarks/add 的 payload。url 必填；title / content 空值不帶。
  // content=完整 HTML（Instapaper 端跑 readability）；description=文章摘要（Gemini
  // 產出，best-effort，空值不帶）。不設 is_private_from_source（Shinkansen 實測結論：
  // 帶 content + 不設此旗標即可存乾淨內容且保留原始 source URL 連結）。
  function buildInstapaperPayload({ url, html, title, description }) {
    if (!url || typeof url !== 'string') {
      throw new Error('buildInstapaperPayload: url is required');
    }
    const payload = { url };
    if (title && typeof title === 'string') payload.title = title;
    if (html && typeof html === 'string') payload.content = html;
    if (description && typeof description === 'string') {
      const trimmed = description.trim();
      if (trimmed) payload.description = trimmed;
    }
    return payload;
  }

  // ─── 讀取端正規化 ─────────────────────────────────────────
  // 把 Instapaper bookmark 物件映射成 JRead 共同文件契約（沿用 Readwise 欄位命名，
  // reader-feed / reader-article 只吃這個 shape，服務無關）：
  //   { id, title, author, site_name, published_date, source_url, image_url, html_content }
  // Instapaper list 無 author、無縮圖 → author/image_url 留空，UI 端既有 falsy guard
  // 自動降級（無縮圖不畫 <img>、無作者只顯示來源網域）。
  function hostnameFromUrl(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
  }

  function epochToIso(time) {
    // Instapaper time 為 epoch 秒（整數或數字字串）。轉 ISO 8601；無效值回 ''。
    const n = Number(time);
    if (!n || !isFinite(n)) return '';
    try { return new Date(n * 1000).toISOString(); } catch (_) { return ''; }
  }

  function normalizeInstapaperBookmark(bm) {
    if (!bm || bm.bookmark_id == null) return null;
    const source_url = typeof bm.url === 'string' ? bm.url : '';
    return {
      id: String(bm.bookmark_id),
      title: (typeof bm.title === 'string' && bm.title.trim()) ? bm.title.trim() : source_url,
      author: '',                              // Instapaper list 不回作者
      site_name: hostnameFromUrl(source_url),
      published_date: epochToIso(bm.time),
      source_url,
      image_url: '',                           // Instapaper list 不回縮圖
      html_content: undefined                  // 需 get_text 另抓
    };
  }

  // ─── 高階呼叫 ──────────────────────────────────────────────

  function resolveKeys(consumerKey, consumerSecret) {
    if (consumerKey && consumerSecret) return { consumerKey, consumerSecret };
    const keys = getInstapaperConsumerKeys();
    if (keys) return keys;
    return null;
  }

  // 共用：簽章 + POST 一個 Full API 端點。回 raw Response（或 throw）。
  async function signedPost({
    url, token, tokenSecret, bodyParams, fetchImpl, signImpl, keys, nonce, timestamp,
  }) {
    const { authHeader } = await signRequest({
      method: 'POST', url,
      consumerKey: keys.consumerKey, consumerSecret: keys.consumerSecret,
      token, tokenSecret, bodyParams, nonce, timestamp, signImpl,
    });
    return fetchImpl(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: encodeFormBody(bodyParams),
    });
  }

  // xAuth：email + 密碼 → { ok:true, token, tokenSecret }。兼任「測試連結」
  //（xAuth 成功 = 憑證有效）。失敗回 { ok:false, error:'CONFIG'|'AUTH'|'HTTP'|'NETWORK' }。
  async function instapaperXAuth({
    email, password, fetchImpl = fetch, signImpl = defaultSign,
    consumerKey, consumerSecret, nonce, timestamp,
  }) {
    const keys = resolveKeys(consumerKey, consumerSecret);
    if (!keys) return { ok: false, error: 'CONFIG' };
    if (!email || !password) return { ok: false, error: 'AUTH' };

    const bodyParams = {
      x_auth_username: email,
      x_auth_password: password,
      x_auth_mode: 'client_auth',
    };
    try {
      const res = await signedPost({
        url: INSTAPAPER_ACCESS_TOKEN_URL, token: null, tokenSecret: null,
        bodyParams, fetchImpl, signImpl, keys, nonce, timestamp,
      });
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'AUTH' };
      if (!res.ok) return { ok: false, error: 'HTTP', status: res.status };
      const text = await res.text();
      const parsed = parseTokenResponse(text);
      if (!parsed) return { ok: false, error: 'AUTH' };
      return { ok: true, token: parsed.token, tokenSecret: parsed.tokenSecret };
    } catch (err) {
      return { ok: false, error: 'NETWORK', message: err && err.message };
    }
  }

  // 送一篇 bookmark。payload 由 buildInstapaperPayload 產出。
  // 回 { ok:true, status, data } 或 { ok:false, error:'CONFIG'|'AUTH'|'HTTP'|'NETWORK', status? }。
  async function saveToInstapaper({
    token, tokenSecret, payload, fetchImpl = fetch, signImpl = defaultSign,
    consumerKey, consumerSecret, nonce, timestamp,
  }) {
    const keys = resolveKeys(consumerKey, consumerSecret);
    if (!keys) return { ok: false, error: 'CONFIG' };
    if (!token || !tokenSecret) return { ok: false, error: 'AUTH' };
    if (!payload || !payload.url) return { ok: false, error: 'HTTP', status: 0 };

    try {
      const res = await signedPost({
        url: INSTAPAPER_ADD_URL, token, tokenSecret,
        bodyParams: payload, fetchImpl, signImpl, keys, nonce, timestamp,
      });
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'AUTH', status: res.status };
      if (!res.ok) return { ok: false, error: 'HTTP', status: res.status };
      let data = null;
      try { data = await res.json(); } catch (_) { /* 非 JSON 也算成功，data 留 null */ }
      return { ok: true, status: res.status, data };
    } catch (err) {
      return { ok: false, error: 'NETWORK', message: err && err.message };
    }
  }

  // 列文件。folderId='unread'（預設）| 'starred' | 'archive' | 數字 folder id。
  // 回 { ok:true, results:[normalizedDoc], nextPageCursor:null } 或 { ok:false, error, status }。
  // Instapaper list 回 JSON 陣列（元素含 type: meta|user|bookmark|error），只取
  // type==='bookmark' 正規化。results 依 API 回傳順序，取「最新 N 篇」由呼叫端 slice。
  async function listInstapaper({
    token, tokenSecret, folderId, limit, fetchImpl = fetch, signImpl = defaultSign,
    consumerKey, consumerSecret, nonce, timestamp,
  }) {
    const keys = resolveKeys(consumerKey, consumerSecret);
    if (!keys) return { ok: false, error: 'CONFIG' };
    if (!token || !tokenSecret) return { ok: false, error: 'AUTH' };

    const bodyParams = {};
    if (folderId) bodyParams.folder_id = folderId;
    if (limit) bodyParams.limit = String(limit);
    try {
      const res = await signedPost({
        url: INSTAPAPER_LIST_URL, token, tokenSecret,
        bodyParams, fetchImpl, signImpl, keys, nonce, timestamp,
      });
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'AUTH', status: res.status };
      if (!res.ok) return { ok: false, error: 'HTTP', status: res.status };
      let data = null;
      try { data = await res.json(); } catch (_) { /* 非 JSON → 空清單 */ }
      const arr = Array.isArray(data) ? data : [];
      const results = arr
        .filter((x) => x && x.type === 'bookmark')
        .map(normalizeInstapaperBookmark)
        .filter(Boolean);
      return { ok: true, status: res.status, results, nextPageCursor: null };
    } catch (err) {
      return { ok: false, error: 'NETWORK', message: err && err.message };
    }
  }

  // 取單篇全文。get_text 回文章 HTML body（非 JSON、無 metadata）。
  // 回 { ok:true, status, html } 或 { ok:false, error, status }。metadata 由呼叫端
  // 用 feed 帶入的 meta 補（Instapaper 無「憑 id 便宜取單篇 metadata」的端點）。
  async function getInstapaperText({
    token, tokenSecret, id, fetchImpl = fetch, signImpl = defaultSign,
    consumerKey, consumerSecret, nonce, timestamp,
  }) {
    const keys = resolveKeys(consumerKey, consumerSecret);
    if (!keys) return { ok: false, error: 'CONFIG' };
    if (!token || !tokenSecret) return { ok: false, error: 'AUTH' };
    if (!id) return { ok: false, error: 'NO_ID' };

    try {
      const res = await signedPost({
        url: INSTAPAPER_GET_TEXT_URL, token, tokenSecret,
        bodyParams: { bookmark_id: String(id) }, fetchImpl, signImpl, keys, nonce, timestamp,
      });
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'AUTH', status: res.status };
      if (!res.ok) return { ok: false, error: 'HTTP', status: res.status };
      const html = await res.text();
      return { ok: true, status: res.status, html };
    } catch (err) {
      return { ok: false, error: 'NETWORK', message: err && err.message };
    }
  }

  // 歸檔一篇 bookmark。回 { ok:true, status } 或 { ok:false, error, status }。
  async function archiveInstapaper({
    token, tokenSecret, id, fetchImpl = fetch, signImpl = defaultSign,
    consumerKey, consumerSecret, nonce, timestamp,
  }) {
    const keys = resolveKeys(consumerKey, consumerSecret);
    if (!keys) return { ok: false, error: 'CONFIG' };
    if (!token || !tokenSecret) return { ok: false, error: 'AUTH' };
    if (!id) return { ok: false, error: 'NO_ID' };

    try {
      const res = await signedPost({
        url: INSTAPAPER_ARCHIVE_URL, token, tokenSecret,
        bodyParams: { bookmark_id: String(id) }, fetchImpl, signImpl, keys, nonce, timestamp,
      });
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'AUTH', status: res.status };
      if (!res.ok) return { ok: false, error: 'HTTP', status: res.status };
      return { ok: true, status: res.status };
    } catch (err) {
      return { ok: false, error: 'NETWORK', message: err && err.message };
    }
  }

  const api = {
    // 常數
    INSTAPAPER_ACCESS_TOKEN_URL,
    INSTAPAPER_ADD_URL,
    INSTAPAPER_LIST_URL,
    INSTAPAPER_GET_TEXT_URL,
    INSTAPAPER_ARCHIVE_URL,
    // 金鑰
    getInstapaperConsumerKeys,
    hasInstapaperConsumerKeys,
    // OAuth 純函式
    oauthPercentEncode,
    normalizeOAuthParams,
    buildOAuthBaseString,
    buildOAuthSigningKey,
    defaultSign,
    signRequest,
    encodeFormBody,
    parseTokenResponse,
    buildInstapaperPayload,
    normalizeInstapaperBookmark,
    // 高階呼叫
    instapaperXAuth,
    saveToInstapaper,
    listInstapaper,
    getInstapaperText,
    archiveInstapaper,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    const g = (typeof globalThis !== 'undefined') ? globalThis
      : (typeof window !== 'undefined') ? window
        : self;
    g.__JReadInstapaper = api;
  }
})();
