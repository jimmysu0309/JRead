// JRead — Readwise Reader 整合 regression（v0.7.33）
// 對應功能：popup「送到 Readwise」按鈕走 popup-core.buildReadwisePayload + saveToReadwise。
// 測試純函式行為：payload 結構、token 缺漏 / 401 / 網路錯誤 / 成功。

const path = require('path');
const assert = require('assert');

const { buildReadwisePayload, saveToReadwise, saveReaderPayload, validateReadwiseToken, validateGeminiKey, buildSummaryPrompt, extractGeminiText, generateGeminiSummary, GEMINI_MAX_CHARS, READWISE_API_URL, READWISE_AUTH_URL } = require(
  path.join(__dirname, '..', '..', 'jread', 'popup', 'popup-core.js')
);

describe('readwise: buildReadwisePayload', () => {
  it('完整 payload：保留 url / html / title 三欄', () => {
    const body = buildReadwisePayload({
      url: 'https://example.com/post/1',
      html: '<article><h1>Hi</h1><p>Body</p></article>',
      title: 'Hi'
    });
    assert.deepStrictEqual(body, {
      url: 'https://example.com/post/1',
      html: '<article><h1>Hi</h1><p>Body</p></article>',
      title: 'Hi'
    });
  });

  it('只給 url：可送（Readwise 容許僅 url，會自抓）', () => {
    const body = buildReadwisePayload({ url: 'https://example.com/post/1' });
    assert.deepStrictEqual(body, { url: 'https://example.com/post/1' });
  });

  it('沒給 url：必拋（Readwise API 強制要求）', () => {
    assert.throws(() => buildReadwisePayload({ html: '<p>x</p>' }), /url 必填/);
    assert.throws(() => buildReadwisePayload({}), /url 必填/);
    assert.throws(() => buildReadwisePayload({ url: 123 }), /url 必填/);
  });

  it('html / title 是空字串或非 string：略過該欄', () => {
    const body = buildReadwisePayload({ url: 'https://x.com', html: '', title: null });
    assert.deepStrictEqual(body, { url: 'https://x.com' });
  });

  // v0.7.166：image_url 主圖
  it('imageUrl 是 http(s) absolute URL：送 image_url', () => {
    const body = buildReadwisePayload({
      url: 'https://example.com/post/1',
      imageUrl: 'https://cdn.example.com/hero.jpg'
    });
    assert.strictEqual(body.image_url, 'https://cdn.example.com/hero.jpg');
  });

  it('imageUrl 是 data: / blob: / 相對路徑 / 空字串：略過 image_url（避免送無效 URL）', () => {
    const bases = { url: 'https://example.com/post/1' };
    assert.strictEqual(buildReadwisePayload({ ...bases, imageUrl: '' }).image_url, undefined);
    assert.strictEqual(buildReadwisePayload({ ...bases, imageUrl: null }).image_url, undefined);
    assert.strictEqual(buildReadwisePayload({ ...bases, imageUrl: '/relative.jpg' }).image_url, undefined);
    assert.strictEqual(buildReadwisePayload({ ...bases, imageUrl: 'data:image/png;base64,iVBORw0KG' }).image_url, undefined);
    assert.strictEqual(buildReadwisePayload({ ...bases, imageUrl: 'blob:https://example.com/abc' }).image_url, undefined);
  });

  // v0.7.167：author 欄位（FB vanity / X handle / 一般站 byline name）
  it('author 是非空字串：trim 後送 author', () => {
    const body = buildReadwisePayload({ url: 'https://x.com', author: '  Jane Doe  ' });
    assert.strictEqual(body.author, 'Jane Doe');
  });

  it('author 是 FB vanity username：原樣送', () => {
    const body = buildReadwisePayload({ url: 'https://facebook.com/u/posts/1', author: 'drdavidchen' });
    assert.strictEqual(body.author, 'drdavidchen');
  });

  it('author 是 X handle（含 @）：原樣送', () => {
    const body = buildReadwisePayload({ url: 'https://x.com/u/status/1', author: '@elonmusk' });
    assert.strictEqual(body.author, '@elonmusk');
  });

  it('author 空字串 / null / 非 string：略過 author', () => {
    const bases = { url: 'https://x.com' };
    assert.strictEqual(buildReadwisePayload({ ...bases, author: '' }).author, undefined);
    assert.strictEqual(buildReadwisePayload({ ...bases, author: '   ' }).author, undefined);
    assert.strictEqual(buildReadwisePayload({ ...bases, author: null }).author, undefined);
    assert.strictEqual(buildReadwisePayload({ ...bases, author: 123 }).author, undefined);
  });

  // v0.7.167：published_date 欄位（ISO 8601 字串，content script 端 normalize）
  it('publishedDate 是 ISO 8601 字串：trim 後送 published_date', () => {
    const body = buildReadwisePayload({
      url: 'https://x.com',
      publishedDate: '  2026-05-22T10:00:00Z  '
    });
    assert.strictEqual(body.published_date, '2026-05-22T10:00:00Z');
  });

  it('publishedDate 空字串 / null / 非 string：略過', () => {
    const bases = { url: 'https://x.com' };
    assert.strictEqual(buildReadwisePayload({ ...bases, publishedDate: '' }).published_date, undefined);
    assert.strictEqual(buildReadwisePayload({ ...bases, publishedDate: null }).published_date, undefined);
    assert.strictEqual(buildReadwisePayload({ ...bases, publishedDate: 123 }).published_date, undefined);
  });

  // v0.8.72：summary 欄位（Gemini Flash Lite 產生的繁中三句摘要）
  it('summary 是非空字串：trim 後送 summary', () => {
    const body = buildReadwisePayload({ url: 'https://x.com', summary: '  三句摘要。  ' });
    assert.strictEqual(body.summary, '三句摘要。');
  });

  it('summary 空字串 / null / 非 string：略過 summary', () => {
    const bases = { url: 'https://x.com' };
    assert.strictEqual(buildReadwisePayload({ ...bases, summary: '' }).summary, undefined);
    assert.strictEqual(buildReadwisePayload({ ...bases, summary: '   ' }).summary, undefined);
    assert.strictEqual(buildReadwisePayload({ ...bases, summary: null }).summary, undefined);
    assert.strictEqual(buildReadwisePayload({ ...bases, summary: 123 }).summary, undefined);
  });

  // v0.7.167：language 欄位不存在於 Readwise Reader API,buildReadwisePayload
  // 絕對不可在 body 內輸出 language key(避免使用者 / 上游誤以為有支援)。
  it('絕對不送 language 欄位（Readwise API 不接受）', () => {
    const body = buildReadwisePayload({
      url: 'https://x.com',
      html: '<p>x</p>',
      title: 'T',
      author: 'A',
      publishedDate: '2026-05-22T00:00:00Z',
      imageUrl: 'https://x.com/i.jpg',
      language: 'zh-TW'
    });
    assert.strictEqual(body.language, undefined, 'body 不可含 language');
  });
});

function makeFetch(impl) {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    return impl(...args);
  };
  return { fetchImpl: fn, calls };
}

describe('readwise: saveToReadwise', () => {
  const goodPayload = { url: 'https://example.com/post/1', html: '<p>x</p>' };

  it('沒 token：回 NO_TOKEN，不打 API', async () => {
    const { fetchImpl, calls } = makeFetch(() => { throw new Error('should not be called'); });
    const r = await saveToReadwise({ token: '', payload: goodPayload, fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'NO_TOKEN');
    assert.strictEqual(calls.length, 0);
  });

  it('token 全空白：回 NO_TOKEN', async () => {
    const r = await saveToReadwise({ token: '   ', payload: goodPayload, fetchImpl: async () => ({}) });
    assert.strictEqual(r.error, 'NO_TOKEN');
  });

  it('成功（201 新建）：回 ok=true + status=201', async () => {
    const { fetchImpl, calls } = makeFetch(async (url, opts) => ({
      ok: true,
      status: 201,
      json: async () => ({ id: 'abc', url: 'https://readwise.io/r/abc' })
    }));
    const r = await saveToReadwise({ token: 'xyz', payload: goodPayload, fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.data.id, 'abc');
    // 驗證打對 endpoint + 對 header + body 帶 token
    assert.strictEqual(calls[0][0], READWISE_API_URL);
    assert.strictEqual(calls[0][1].method, 'POST');
    assert.strictEqual(calls[0][1].headers['Authorization'], 'Token xyz');
    assert.strictEqual(calls[0][1].headers['Content-Type'], 'application/json');
    assert.deepStrictEqual(JSON.parse(calls[0][1].body), goodPayload);
  });

  it('已存在（200）：回 ok=true + status=200', async () => {
    const { fetchImpl } = makeFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'abc' })
    }));
    const r = await saveToReadwise({ token: 'xyz', payload: goodPayload, fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.status, 200);
  });

  it('401：回 AUTH（token 無效）', async () => {
    const { fetchImpl } = makeFetch(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Invalid token' })
    }));
    const r = await saveToReadwise({ token: 'bad', payload: goodPayload, fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'AUTH');
    assert.strictEqual(r.status, 401);
  });

  it('500：回 HTTP', async () => {
    const { fetchImpl } = makeFetch(async () => ({
      ok: false,
      status: 500,
      json: async () => ({})
    }));
    const r = await saveToReadwise({ token: 'xyz', payload: goodPayload, fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'HTTP');
    assert.strictEqual(r.status, 500);
  });

  it('網路錯誤：回 NETWORK', async () => {
    const fetchImpl = async () => { throw new Error('Failed to fetch'); };
    const r = await saveToReadwise({ token: 'xyz', payload: goodPayload, fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'NETWORK');
    assert.match(r.message, /Failed to fetch/);
  });

  it('沒 fetchImpl 也沒 global fetch：回 NO_FETCH', async () => {
    const originalFetch = global.fetch;
    delete global.fetch;
    try {
      const r = await saveToReadwise({ token: 'xyz', payload: goodPayload });
      assert.strictEqual(r.error, 'NO_FETCH');
    } finally {
      if (originalFetch) global.fetch = originalFetch;
    }
  });
});

// v0.8.65：popup「送到 Readwise」改走 popup-core.saveReaderPayload，在 extension
// 頁直接 fetch（不繞 background）。iOS Safari 背景頁掛起讓 SAVE_TO_READWISE 往返 /
// 背景 fetch silently 失敗（macOS Chrome/Safari 正常）；options「測試 token」GET 從
// extension 頁直接發 iOS 實測可行，save 改走同一路徑。
describe('readwise: saveReaderPayload（popup extension-page 直送，v0.8.65）', () => {
  const goodPayload = { url: 'https://example.com/post/1', html: '<p>x</p>' };

  it('成功：讀 token → build → POST /save/，回 ok=true + 帶對 token', async () => {
    const { fetchImpl, calls } = makeFetch(async () => ({
      ok: true, status: 201, json: async () => ({ id: 'abc' })
    }));
    const r = await saveReaderPayload({
      payload: goodPayload,
      getToken: async () => 'tok-123',
      fetchImpl
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.status, 201);
    assert.strictEqual(calls[0][0], READWISE_API_URL);
    assert.strictEqual(calls[0][1].method, 'POST');
    assert.strictEqual(calls[0][1].headers['Authorization'], 'Token tok-123');
    assert.deepStrictEqual(JSON.parse(calls[0][1].body), goodPayload);
  });

  it('getToken 回空字串：saveToReadwise 端回 NO_TOKEN，不打 API', async () => {
    const { fetchImpl, calls } = makeFetch(() => { throw new Error('should not be called'); });
    const r = await saveReaderPayload({ payload: goodPayload, getToken: async () => '', fetchImpl });
    assert.strictEqual(r.error, 'NO_TOKEN');
    assert.strictEqual(calls.length, 0);
  });

  it('getToken throw（storage 讀取失敗）：回 INTERNAL、不打 API', async () => {
    const { fetchImpl, calls } = makeFetch(() => { throw new Error('should not be called'); });
    const r = await saveReaderPayload({
      payload: goodPayload,
      getToken: async () => { throw new Error('storage boom'); },
      fetchImpl
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'INTERNAL');
    assert.match(r.message, /storage boom/);
    assert.strictEqual(calls.length, 0);
  });

  it('payload 缺 url：回 INVALID_PAYLOAD、不打 API', async () => {
    const { fetchImpl, calls } = makeFetch(() => { throw new Error('should not be called'); });
    const r = await saveReaderPayload({
      payload: { html: '<p>x</p>' },
      getToken: async () => 'tok-123',
      fetchImpl
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'INVALID_PAYLOAD');
    assert.strictEqual(calls.length, 0);
  });

  it('401：透傳 saveToReadwise 的 AUTH', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const r = await saveReaderPayload({ payload: goodPayload, getToken: async () => 'bad', fetchImpl });
    assert.strictEqual(r.error, 'AUTH');
    assert.strictEqual(r.status, 401);
  });

  // forcing function：popup 按鈕必須走 extension-page 直送、不可回退到繞 background
  it('popup.js 必須用 saveReaderPayload 直送、不得用 runtime.sendMessage 送 SAVE_TO_READWISE', () => {
    const fs = require('fs');
    const js = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.js'), 'utf8'
    );
    assert.match(js, /saveReaderPayload/,
      'popup.js 必須呼叫 window.__JReadPopup.saveReaderPayload（extension 頁直送）');
    assert.ok(
      !/sendMessage\(\s*\{\s*[^}]*SAVE_TO_READWISE/.test(js),
      'popup.js 不可用 runtime.sendMessage 送 SAVE_TO_READWISE（iOS 背景頁掛起會 silently 失敗）'
    );
  });
});

// v0.8.64：options 頁「測試 token」按鈕走 validateReadwiseToken（純函式 +
// 注入 fetch）。驗 token 缺漏 / 有效（204）/ 無效（401·403）/ 其他 HTTP /
// 網路錯誤 / 無 fetch，以及打對 GET 端點 + Authorization header。
describe('readwise: validateReadwiseToken', () => {
  it('沒 token：回 NO_TOKEN，不打 API', async () => {
    const { fetchImpl, calls } = makeFetch(() => { throw new Error('should not be called'); });
    const r = await validateReadwiseToken({ token: '', fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'NO_TOKEN');
    assert.strictEqual(calls.length, 0);
  });

  it('token 全空白：回 NO_TOKEN', async () => {
    const r = await validateReadwiseToken({ token: '   ', fetchImpl: async () => ({}) });
    assert.strictEqual(r.error, 'NO_TOKEN');
  });

  it('有效（204 No Content）：回 ok=true，且打對 GET 端點 + Authorization header', async () => {
    const { fetchImpl, calls } = makeFetch(async () => ({ ok: false, status: 204 }));
    const r = await validateReadwiseToken({ token: '  good-token  ', fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.status, 204);
    assert.strictEqual(calls[0][0], READWISE_AUTH_URL);
    assert.strictEqual(calls[0][1].method, 'GET');
    // token 前後空白須 trim
    assert.strictEqual(calls[0][1].headers['Authorization'], 'Token good-token');
  });

  it('有效（200 OK 其他 2xx）：也回 ok=true', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: true, status: 200 }));
    const r = await validateReadwiseToken({ token: 'xyz', fetchImpl });
    assert.strictEqual(r.ok, true);
  });

  it('401：回 AUTH（token 無效或過期）', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: false, status: 401 }));
    const r = await validateReadwiseToken({ token: 'bad', fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'AUTH');
    assert.strictEqual(r.status, 401);
  });

  it('403：回 AUTH', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: false, status: 403 }));
    const r = await validateReadwiseToken({ token: 'bad', fetchImpl });
    assert.strictEqual(r.error, 'AUTH');
  });

  it('500：回 HTTP', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: false, status: 500 }));
    const r = await validateReadwiseToken({ token: 'xyz', fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'HTTP');
    assert.strictEqual(r.status, 500);
  });

  it('網路錯誤：回 NETWORK', async () => {
    const fetchImpl = async () => { throw new Error('Failed to fetch'); };
    const r = await validateReadwiseToken({ token: 'xyz', fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'NETWORK');
    assert.match(r.message, /Failed to fetch/);
  });

  it('沒 fetchImpl 也沒 global fetch：回 NO_FETCH', async () => {
    const originalFetch = global.fetch;
    delete global.fetch;
    try {
      const r = await validateReadwiseToken({ token: 'xyz' });
      assert.strictEqual(r.error, 'NO_FETCH');
    } finally {
      if (originalFetch) global.fetch = originalFetch;
    }
  });

  // forcing function：options 頁的測試按鈕 wiring 不可斷
  it('options.html 必須載入 popup-core.js 並含測試按鈕 + 結果列', () => {
    const fs = require('fs');
    const html = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'options', 'options.html'), 'utf8'
    );
    assert.match(html, /src="\.\.\/popup\/popup-core\.js"/, 'options.html 必須載入 popup-core.js（validateReadwiseToken 來源）');
    assert.match(html, /id="readwiseTest"/, 'options.html 必須有測試按鈕 #readwiseTest');
    assert.match(html, /id="readwiseTestResult"/, 'options.html 必須有結果列 #readwiseTestResult');
  });

  it('options.js 必須呼叫 validateReadwiseToken 並 wire 測試按鈕', () => {
    const fs = require('fs');
    const js = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'options', 'options.js'), 'utf8'
    );
    assert.match(js, /validateReadwiseToken/, 'options.js 必須呼叫 validateReadwiseToken');
    assert.match(js, /getElementById\(['"]readwiseTest['"]\)/, 'options.js 必須抓 #readwiseTest 按鈕');
  });
});

describe('readwise: validateGeminiKey (v0.8.74)', () => {
  it('沒 key：回 NO_KEY，不打 API', async () => {
    const { fetchImpl, calls } = makeFetch(() => { throw new Error('should not be called'); });
    const r = await validateGeminiKey({ apiKey: '', fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'NO_KEY');
    assert.strictEqual(calls.length, 0);
  });

  it('key 全空白：回 NO_KEY', async () => {
    const r = await validateGeminiKey({ apiKey: '   ', fetchImpl: async () => ({}) });
    assert.strictEqual(r.error, 'NO_KEY');
  });

  it('有效（200）：回 ok=true，打對 models list GET 端點（無尾斜線）+ key 已 trim/encode', async () => {
    const { fetchImpl, calls } = makeFetch(async () => ({ ok: true, status: 200 }));
    const r = await validateGeminiKey({ apiKey: '  good key  ', fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(calls[0][1].method, 'GET');
    // models 端點不可有尾斜線（.../models?key= 而非 .../models/?key=）
    assert.match(calls[0][0], /\/v1beta\/models\?key=/);
    assert.ok(!/\/models\/\?key=/.test(calls[0][0]), 'models 端點不可有尾斜線');
    // 前後空白 trim、含空白的 key URL-encode（不會破壞 query）
    assert.match(calls[0][0], /key=good%20key$/);
  });

  it('400 INVALID_ARGUMENT：回 AUTH（key 無效）', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: false, status: 400 }));
    const r = await validateGeminiKey({ apiKey: 'bad', fetchImpl });
    assert.strictEqual(r.error, 'AUTH');
    assert.strictEqual(r.status, 400);
  });

  it('403 PERMISSION_DENIED：回 AUTH', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: false, status: 403 }));
    const r = await validateGeminiKey({ apiKey: 'bad', fetchImpl });
    assert.strictEqual(r.error, 'AUTH');
  });

  it('500：回 HTTP', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: false, status: 500 }));
    const r = await validateGeminiKey({ apiKey: 'xyz', fetchImpl });
    assert.strictEqual(r.error, 'HTTP');
    assert.strictEqual(r.status, 500);
  });

  it('網路錯誤：回 NETWORK', async () => {
    const fetchImpl = async () => { throw new Error('Failed to fetch'); };
    const r = await validateGeminiKey({ apiKey: 'xyz', fetchImpl });
    assert.strictEqual(r.error, 'NETWORK');
    assert.match(r.message, /Failed to fetch/);
  });

  it('沒 fetchImpl 也沒 global fetch：回 NO_FETCH', async () => {
    const originalFetch = global.fetch;
    delete global.fetch;
    try {
      const r = await validateGeminiKey({ apiKey: 'xyz' });
      assert.strictEqual(r.error, 'NO_FETCH');
    } finally {
      if (originalFetch) global.fetch = originalFetch;
    }
  });

  // forcing function：Gemini 測試按鈕 wiring + 三設定不分隔線編排不可斷
  it('options.html 必須含 Gemini 測試按鈕 + 結果列 + .field-group 包三設定', () => {
    const fs = require('fs');
    const html = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'options', 'options.html'), 'utf8'
    );
    assert.match(html, /id="geminiTest"/, 'options.html 必須有 Gemini 測試按鈕 #geminiTest');
    assert.match(html, /id="geminiTestResult"/, 'options.html 必須有 Gemini 結果列 #geminiTestResult');
    // 三設定（readwiseToken / readwiseSummary / geminiApiKey）必須包在同一個
    // .field-group 內（同一功能不放分隔線，Jimmy 2026-06-15 編排要求）
    assert.match(html, /class="field-group"/, 'options.html 必須有 .field-group 包住 Readwise 整合三設定');
    const m = html.match(/<div class="field-group">[\s\S]*?<\/div>\s*<section class="license"/);
    assert.ok(m, '.field-group 必須緊鄰 license section（區塊邊界正確）');
    assert.ok(/id="readwiseToken"/.test(m[0]) && /id="readwiseSummary"/.test(m[0]) && /id="geminiApiKey"/.test(m[0]),
      '.field-group 內必須含 readwiseToken + readwiseSummary + geminiApiKey 三設定');
  });

  it('options.html CSS 必須移除 .field-group 內 .field 的分隔線', () => {
    const fs = require('fs');
    const html = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'options', 'options.html'), 'utf8'
    );
    assert.match(html, /\.field-group\s+\.field\s*\{[^}]*border-bottom:\s*none/,
      '.field-group .field 必須 border-bottom: none（同一功能子設定不分隔）');
  });

  it('options.html CSS：token-control 欄位必須頂對齊（label 與 input 同高）', () => {
    const fs = require('fs');
    const html = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'options', 'options.html'), 'utf8'
    );
    // 控制群（input 列 + 結果列）比 label 高，.field 預設 align-items:center 會把
    // input 推得比 label 高 6px（Jimmy 2026-06-15 截圖）；必須對含 .readwise-token-
    // control 的 field 改 flex-start，讓 input 列與 label 名稱頂端對齊。
    assert.match(html, /\.field:has\(\.readwise-token-control\)\s*\{[^}]*align-items:\s*flex-start/,
      '.field:has(.readwise-token-control) 必須 align-items: flex-start（label 與 input 頂對齊）');
  });

  it('options.js 必須呼叫 validateGeminiKey 並 wire Gemini 測試按鈕', () => {
    const fs = require('fs');
    const js = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'options', 'options.js'), 'utf8'
    );
    assert.match(js, /validateGeminiKey/, 'options.js 必須呼叫 validateGeminiKey');
    assert.match(js, /getElementById\(['"]geminiTest['"]\)/, 'options.js 必須抓 #geminiTest 按鈕');
  });

  it('popup-core 必須 export validateGeminiKey', () => {
    assert.strictEqual(typeof validateGeminiKey, 'function', 'validateGeminiKey 必須被 export');
  });
});

describe('readwise: 訊息協定常數同步', () => {
  it('namespace.js MSG 必須含 Readwise 用兩條 popup→content 訊息（forcing function）', () => {
    const fs = require('fs');
    const nsSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'namespace.js'), 'utf8'
    );
    assert.match(nsSrc, /GET_READER_STATE:/);
    assert.match(nsSrc, /EXTRACT_READER_HTML:/);
  });

  // v0.8.65：SAVE_TO_READWISE 訊息 + SW handler 已移除（popup 改 extension 頁直送）。
  // 守住「不得復活成 popup → SW 死往返」：SW 不可再有 SAVE_TO_READWISE case，
  // namespace 不可再宣告為 live 常數（只允許出現在移除說明註解）。
  it('SW 不得再有 SAVE_TO_READWISE message handler（已改 popup 直送，v0.8.65）', () => {
    const fs = require('fs');
    const swSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'background', 'service-worker.js'), 'utf8'
    );
    assert.ok(!/case\s+['"]SAVE_TO_READWISE['"]/.test(swSrc),
      'SW 不可再有 SAVE_TO_READWISE case（iOS 背景頁掛起會 silently 失敗，已改 popup-core.saveReaderPayload 直送）');
  });

  it('namespace.js 不得再把 SAVE_TO_READWISE 宣告為 live MSG 常數（v0.8.65）', () => {
    const fs = require('fs');
    const nsSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'namespace.js'), 'utf8'
    );
    assert.ok(!/SAVE_TO_READWISE\s*:\s*['"]SAVE_TO_READWISE['"]/.test(nsSrc),
      'namespace.js 不可再宣告 SAVE_TO_READWISE MSG 常數（已移除 popup→SW 訊息）');
  });

  it('main.js 抽 reader payload 時必須移除 hidden 節點 + 剝掉 jread data-* attr（forcing function）', () => {
    const fs = require('fs');
    const mainSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8'
    );
    // 此邏輯保證送 Readwise 的 HTML 不帶 cleaner 已隱藏的雜訊（cleaner 只 inline display:none、
    // 不刪節點，Readwise parser 重新渲染會把雜訊全帶回來），也不帶 jread 內部 data-* attr
    assert.match(mainSrc, /buildCleanHtml/, 'main.js 必須有 buildCleanHtml 函式（送 Readwise 前清 DOM）');
    assert.match(mainSrc, /data-jread-hidden/, 'main.js 必須處理 data-jread-hidden 隱藏節點');
    assert.match(mainSrc, /data-jread/, 'main.js 必須剝掉 data-jread-* attribute');
    assert.match(mainSrc, /extractReaderPayload/, 'main.js 必須有 extractReaderPayload 函式');
    // v0.8.53：空殼 prune——hidden 節點刪掉後留下的「無文字、無媒體」殼（空 li /
    // 空 ul）必須整個移除，否則 Readwise 端渲染成一排空 bullet（theverge 頂端
    // topic chips + 文末 follow widget 實證）。anchor：pruneEmptyHusks 定義 +
    // 在 buildCleanHtml 內被呼叫。
    assert.match(mainSrc, /function\s+pruneEmptyHusks\s*\(/,
      'main.js buildCleanHtml 必須定義 pruneEmptyHusks（空殼 prune，防 Readwise 空 bullet）');
    // ^\s* + m flag：呼叫行必須是程式碼行開頭（被註解掉 `// pruneEmptyHusks(clone)`
    // 時不可通過——sanity check 實證鬆 regex 會被註解行騙過）
    assert.match(mainSrc, /^\s*pruneEmptyHusks\(clone\);/m,
      'main.js buildCleanHtml 必須對 clone 執行 pruneEmptyHusks（不可是註解）');
    // v0.8.121：文首 byline / dateline meta 移除——buildCleanHtml 必須呼叫
    // NS.markLeadingBylineForExport（live DOM 標記）+ 在 clone 上移除標記節點。
    // 拆兩條 assert 各指向 call site / removal，任一被移除都會 fail（^\s* + m flag
    // 確保 removal 行不可被註解掉騙過）。
    assert.match(mainSrc, /NS\.markLeadingBylineForExport\(rootEl\)/,
      'main.js buildCleanHtml 必須呼叫 NS.markLeadingBylineForExport(rootEl) 標記文首 byline');
    assert.match(mainSrc, /^\s*clone\.querySelectorAll\(['"]\[data-jread-rw-strip="1"\]['"]\)\.forEach\(n => n\.remove\(\)\);/m,
      'main.js buildCleanHtml 必須在 clone 上移除 [data-jread-rw-strip] 標記節點（不可是註解）');
    // v0.8.124：重複 hero 主圖移除——buildCleanHtml 必須呼叫 NS.markHeroImageForExport
    // （標記 body 內與 cover 同圖的 hero）+ 在還原步驟 unmark heroMarked。與 byline
    // 共用同一段 clone 移除邏輯（上面那條 removal assert 同時保護 hero）。
    assert.match(mainSrc, /NS\.markHeroImageForExport\(rootEl\)/,
      'main.js buildCleanHtml 必須呼叫 NS.markHeroImageForExport(rootEl) 標記重複 hero 主圖');
    assert.match(mainSrc, /^\s*heroMarked\.forEach\(el => el\.removeAttribute\(['"]data-jread-rw-strip['"]\)\);/m,
      'main.js buildCleanHtml 必須在 live DOM 還原 heroMarked 的標記（不可是註解）');
    // extractHeroImage 與 markHeroImageForExport 共用 NS.findLeadingHeroImage 選同一張
    // hero（杜絕 cover 與去重圖 drift，硬規則 5）
    assert.match(mainSrc, /NS\.findLeadingHeroImage\s*\(\s*articleEl\s*,/,
      'extractHeroImage 必須透過 NS.findLeadingHeroImage 選 hero（與去重共用單一資料源）');
    // v0.7.165：FB permalink 段落（div + data-jread-fb-para）送 Readwise 前必須
    // 改寫成 <p>，否則對方 sanitizer 砍 inline style 後段落擠成一團（Jimmy
    // 2026-05-22 回報）。anchor 在 querySelectorAll('[data-jread-fb-para...]') 之後
    // 不久必須出現 createElement('p')——同一個轉換 block 內，不容易因註解誤通過。
    assert.match(
      mainSrc,
      /querySelectorAll\(['"]\[data-jread-fb-para[^)]+\)[\s\S]{0,500}createElement\(['"]p['"]\)/,
      'main.js buildCleanHtml 必須把 [data-jread-fb-para] div 轉成 <p>（送 Readwise 時段落結構保留）'
    );
    // v0.7.166：hero image URL 抽取——extractHeroImage helper 定義 + extractReaderPayload
    // 把結果放進 payload.imageUrl（buildReadwisePayload 端再轉成 image_url 送 API）。
    // 拆兩條 assert 各自指向 definition / call site，避免單一 regex 在某邊被移除時還能
    // 命中另一邊（sanity：本輪靠這分離抓出單側 rename 的 bug）。
    assert.match(
      mainSrc,
      /function\s+extractHeroImage\s*\(/,
      'main.js 必須定義 extractHeroImage 函式（抽 cover image URL）'
    );
    assert.match(
      mainSrc,
      /=\s*extractHeroImage\s*\(\s*NS\.state\.articleEl\s*\)/,
      'extractReaderPayload 必須呼叫 extractHeroImage(NS.state.articleEl)'
    );
    assert.match(mainSrc, /og:image/, 'extractHeroImage 必須處理 og:image meta fallback');
    assert.match(
      mainSrc,
      /payload:\s*{[^}]*imageUrl/,
      'extractReaderPayload payload 必須含 imageUrl 欄位（給 buildReadwisePayload 轉 image_url）'
    );
    // v0.7.167：author / publishedDate 抽取——extractAuthor / extractPublishedDate
    // helper 定義 + extractReaderPayload payload 帶上兩欄位。
    assert.match(
      mainSrc,
      /function\s+extractAuthor\s*\(/,
      'main.js 必須定義 extractAuthor 函式（v0.7.167）'
    );
    // v0.8.73：og:site_name「刊物名 by 作者」最低優先序 fallback——definition +
    // 走對 selector。與 readwise-author-date-extract.spec 的等價 helper 雙保防 drift。
    assert.match(
      mainSrc,
      /function\s+extractAuthorFromSiteName\s*\(/,
      'main.js 必須定義 extractAuthorFromSiteName 函式（v0.8.73 og:site_name fallback）'
    );
    assert.match(
      mainSrc,
      /meta\[property="og:site_name"\]/,
      'extractAuthorFromSiteName 必須讀 og:site_name'
    );
    assert.match(
      mainSrc,
      /function\s+extractPublishedDate\s*\(/,
      'main.js 必須定義 extractPublishedDate 函式（v0.7.167）'
    );
    assert.match(
      mainSrc,
      /payload:\s*{[^}]*author/,
      'extractReaderPayload payload 必須含 author 欄位'
    );
    assert.match(
      mainSrc,
      /payload:\s*{[^}]*publishedDate/,
      'extractReaderPayload payload 必須含 publishedDate 欄位'
    );
    // FB / X 短路必須早於一般站抽取
    assert.match(
      mainSrc,
      /data-jread-fb-reader[\s\S]{0,800}extractAuthorVanityFromUrl/,
      'extractAuthor 必須先處理 FB 合成 reader 分支（用 NS.fbPost.extractAuthorVanityFromUrl）'
    );
    assert.match(
      mainSrc,
      /data-jread-x-reader[\s\S]{0,300}extractXAuthorHandle/,
      'extractAuthor 必須處理 X / Twitter 合成 reader 分支（extractXAuthorHandle from URL）'
    );
    // 一般站 byline 多層 fallback
    assert.match(mainSrc, /application\/ld\+json/, 'extractAuthor 必須讀 JSON-LD');
    assert.match(mainSrc, /meta\[name="author"\]/, 'extractAuthor 必須讀 meta[name="author"]');
    assert.match(mainSrc, /article:published_time/, 'extractPublishedDate 必須讀 article:published_time');
    assert.match(mainSrc, /datePublished/, 'extractPublishedDate 必須讀 JSON-LD datePublished');
    assert.match(mainSrc, /time\[datetime\]/, 'extractPublishedDate 必須 fallback 到 <time datetime>');
    // v0.7.168:extractPublishedDate FB / X 分流——FB 結構性沒絕對日期、明
    // 確不送;X 取合成容器主推文 article 內最後一個 time(避免抓到 reply)。
    // 抽 extractPublishedDate body 確認 FB / X 分支在 fallback 之前。
    assert.match(
      mainSrc,
      /function\s+extractPublishedDate\s*\(\s*\)\s*\{[\s\S]{0,400}data-jread-fb-reader/,
      'extractPublishedDate 必須在 fallback 前對 [data-jread-fb-reader] 短路 return ""'
    );
    assert.match(
      mainSrc,
      /function\s+extractPublishedDate\s*\(\s*\)\s*\{[\s\S]{0,400}data-jread-x-reader[\s\S]{0,200}extractXPublishedDate/,
      'extractPublishedDate 必須在 fallback 前對 [data-jread-x-reader] 走 extractXPublishedDate'
    );
    assert.match(
      mainSrc,
      /function\s+extractXPublishedDate\s*\(/,
      'main.js 必須定義 extractXPublishedDate helper'
    );
    // extractXPublishedDate 必須抓「合成容器內第一個 article 的最後一個 time」
    // ——這個 heuristic 是 X 主推文 timestamp 在 quoted tweet 之後的結構慣
    // 例(cage probe 2026-05-22 實證)。
    assert.match(
      mainSrc,
      /:scope\s*>\s*article/,
      'extractXPublishedDate 必須用 :scope > article 鎖定合成容器第一個 article(主推文 clone)'
    );
    assert.match(
      mainSrc,
      /times\[times\.length\s*-\s*1\]/,
      'extractXPublishedDate 必須取最後一個 time(主推文 timestamp 在 quoted tweet 之後)'
    );
    // v0.8.18 C8：JSON-LD 共用單次 parse——author / date 不可各自重跑
    // querySelectorAll('script[type="application/ld+json"]')。forcing:整份
    // main.js 只能有一處 LD querySelectorAll（在 getJsonLd helper 內）。
    assert.match(mainSrc, /function\s+getJsonLd\s*\(/, 'main.js 必須定義 getJsonLd 共用 LD parse helper（C8）');
    assert.match(mainSrc, /function\s+resetJsonLdCache\s*\(/, 'main.js 必須定義 resetJsonLdCache（C8 memoize 重置）');
    const ldQueryCount = (mainSrc.match(/querySelectorAll\(\s*['"]script\[type="application\/ld\+json"\]['"]\s*\)/g) || []).length;
    assert.strictEqual(ldQueryCount, 1,
      `JSON-LD querySelectorAll 只能在 getJsonLd 出現一次（C8 共用單次 parse），實際 ${ldQueryCount} 處`);
    assert.match(mainSrc, /resetJsonLdCache\(\)[\s\S]{0,200}buildCleanHtml/,
      'extractReaderPayload 必須在抽取前 resetJsonLdCache()（換頁後重新解析 LD）');
    // v0.8.50：title 來源改以 reader card 內可見 heading 為主（document.title 是
    // 載入時靜態 metadata，翻譯擴充改寫 DOM 後不會跟著變——送出去的是原文
    // 標題，Jimmy 2026-06-12 回報）。
    // v0.8.74：選主標 heading 的邏輯收斂到 NS.findCardTitleHeading（單一資料源
    // + jsdom 可測，h1 優先、無 h1 取內文前首個 h2——Stratechery post-title 是
    // h2，Jimmy 2026-06-15 回報）。hidden-skip 行為移到 namespace.js，行為層
    // spec 見 readwise-h2-title.spec.js。
    assert.match(mainSrc, /function\s+extractReaderTitle\s*\(/,
      'main.js 必須定義 extractReaderTitle');
    assert.match(mainSrc, /=\s*extractReaderTitle\s*\(\s*\)/,
      'extractReaderPayload 的 title 必須來自 extractReaderTitle()——forcing：直接讀 document.title 會回退到「譯後標題送原文」bug');
    assert.match(mainSrc, /function\s+extractReaderTitle[\s\S]{0,600}NS\.findCardTitleHeading\s*\(/,
      'extractReaderTitle 必須走 NS.findCardTitleHeading 單一資料源（v0.8.74）');
    assert.match(mainSrc, /function\s+extractReaderTitle[\s\S]{0,800}stripSiteSuffix/,
      'extractReaderTitle 的 document.title fallback 必須沿用 NS.stripSiteSuffix 去站名尾綴');
    // findCardTitleHeading 必須跳過 [data-jread-hidden]（站名 logo / cleaner 標記
    // 的雜訊 heading）+ 涵蓋 h1 與 h2 兩種主標 tag。
    const nsSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'namespace.js'), 'utf8');
    assert.match(nsSrc, /findCardTitleHeading\s*\(/,
      'namespace.js 必須定義 findCardTitleHeading（選主標 heading 單一資料源）');
    assert.match(nsSrc, /findCardTitleHeading[\s\S]{0,1200}data-jread-hidden/,
      'findCardTitleHeading 必須跳過 [data-jread-hidden] 內的 heading（站名 logo 類雜訊）');
    // v0.8.62：title 去重——buildCleanHtml 必須收 title 參數並移除 body 內同名
    // heading（Readwise 用 title 欄位另渲染主標，body 殘留同名 heading 會重複）。
    assert.match(mainSrc, /function\s+buildCleanHtml\s*\(\s*rootEl\s*,\s*title\s*\)/,
      'buildCleanHtml 必須收 title 參數（用來去重 body 內同名主標 heading）');
    assert.match(mainSrc, /=\s*buildCleanHtml\s*\(\s*NS\.state\.articleEl\s*,\s*title\s*\)/,
      'extractReaderPayload 必須把 title 傳給 buildCleanHtml');
    assert.match(mainSrc, /foldTitlePunct[\s\S]{0,400}querySelectorAll\(\s*['"]h1, h2, h3, h4, h5, h6['"]\s*\)/,
      'buildCleanHtml 必須折疊標點後比對、移除與 title 同文的 h1-h6（防 Readwise 重複主標）');
  });
});

// 行為層 spec：jsdom 重現 buildCleanHtml 預期效果。
// 因 main.js 包在 IIFE 且依賴 chrome.runtime，無法直接 require；改在這裡
// 重寫一份等價函式，確保「漏掉 hidden = 雜訊重現」這條核心契約有具體 spec 護住。
// 上面 forcing function 抓「實作存在 + 用對 attribute」、這裡 spec 抓「演算法效果正確」。
const { JSDOM } = require('jsdom');

// fold：與 NS.foldTitlePunct 等價（折引號家族 + 刪節號 + collapse 空白）後再
// lowercase，給 title 去重比對用。
function foldTitleImpl(s) {
  return (s || '')
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildCleanHtmlImpl(rootEl, title) {
  const clone = rootEl.cloneNode(true);
  clone.querySelectorAll('[data-jread-hidden="1"]').forEach(n => n.remove());
  clone.querySelectorAll('style#__jread-style, style[data-jread]').forEach(n => n.remove());
  const doc = clone.ownerDocument;
  clone.querySelectorAll('[data-jread-fb-para="1"]').forEach(div => {
    const p = doc.createElement('p');
    for (const attr of Array.from(div.attributes)) {
      p.setAttribute(attr.name, attr.value);
    }
    while (div.firstChild) p.appendChild(div.firstChild);
    div.replaceWith(p);
  });
  // v0.8.53 空殼 prune（與 main.js pruneEmptyHusks 等價）
  const PRUNE_KEEP_TAGS = new Set([
    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION',
    'COLGROUP', 'COL', 'BR', 'HR', 'WBR',
    'IMG', 'PICTURE', 'SOURCE', 'TRACK', 'VIDEO', 'AUDIO', 'IFRAME',
    'SVG', 'EMBED', 'OBJECT', 'CANVAS'
  ]);
  const PRUNE_MEDIA_SEL = 'img, picture, video, audio, iframe, svg, embed, object, canvas';
  function pruneEmptyHusks(node) {
    for (const child of Array.from(node.children)) pruneEmptyHusks(child);
    if (node === clone) return;
    if (PRUNE_KEEP_TAGS.has(node.tagName.toUpperCase())) return;
    if ((node.textContent || '').trim()) return;
    if (node.querySelector(PRUNE_MEDIA_SEL)) return;
    node.remove();
  }
  pruneEmptyHusks(clone);
  function strip(node) {
    if (node.attributes) {
      const toRemove = [];
      for (const attr of node.attributes) {
        if (attr.name.startsWith('data-jread')) toRemove.push(attr.name);
      }
      toRemove.forEach(name => node.removeAttribute(name));
    }
    for (const child of node.children) strip(child);
  }
  strip(clone);
  // v0.8.62 title 去重（與 main.js buildCleanHtml 步驟 4 等價）
  if (title) {
    const foldedTitle = foldTitleImpl(title);
    if (foldedTitle) {
      clone.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
        const t = foldTitleImpl(h.textContent || '');
        if (t && t === foldedTitle) h.remove();
      });
    }
  }
  return clone.outerHTML;
}

describe('readwise: buildCleanHtml 行為契約', () => {
  function makeDoc(innerHTML) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="root">${innerHTML}</div></body></html>`);
    return dom.window.document.getElementById('root');
  }

  it('移除 [data-jread-hidden="1"] 節點', () => {
    const root = makeDoc(`
      <article>
        <h1>標題</h1>
        <p>主文段落</p>
        <aside data-jread-hidden="1">廣告區</aside>
        <p>另一段主文</p>
      </article>
    `);
    const html = buildCleanHtmlImpl(root);
    assert.ok(!html.includes('廣告區'), 'hidden 雜訊節點必須被移除');
    assert.ok(html.includes('主文段落'), '主文必須保留');
    assert.ok(html.includes('另一段主文'), '主文必須保留');
  });

  it('移除 jread 注入的 style 元素', () => {
    const root = makeDoc(`
      <article>
        <style id="__jread-style">body { background: #fff }</style>
        <p>主文</p>
      </article>
    `);
    const html = buildCleanHtmlImpl(root);
    assert.ok(!html.includes('__jread-style'), 'jread 注入的 style 必須被移除');
    assert.ok(!html.includes('body { background'), 'style 內容也必須消失');
    assert.ok(html.includes('主文'));
  });

  it('剝掉所有 data-jread-* attribute（active / ancestor / hidden 等都清）', () => {
    const root = makeDoc(`
      <article data-jread-active="1" data-jread-ancestor="0">
        <p data-jread-firstink="1">主文</p>
      </article>
    `);
    const html = buildCleanHtmlImpl(root);
    assert.ok(!/data-jread/.test(html), '所有 data-jread-* attribute 必須被剝掉');
    assert.ok(html.includes('主文'));
  });

  it('FB permalink 段落 div（data-jread-fb-para="1"）改寫成 <p>', () => {
    // 背景：fb-post.js markParagraphDivs 把 FB 主貼文的「直接含文字 leaf div」
    // 標 data-jread-fb-para="1" + 設 inline margin '1.2em 0'，本地 reader card
    // 靠 inline margin 顯示段落間距。送 Readwise Reader 時對方 sanitizer 會砍
    // inline style，段落全擠成一團（Jimmy 2026-05-22 回報）。改寫成 <p> 讓
    // Readwise 用語意辨識段落結構。
    const root = makeDoc(`
      <article data-jread-active="1" data-jread-fb-reader="1">
        <header><strong>作者</strong></header>
        <div>
          <div data-jread-fb-para="1" style="margin: 1.2em 0;">第一段內容很重要</div>
          <div data-jread-fb-para="1" style="margin: 1.2em 0;">第二段內容也很重要 <a href="https://x.com">連結</a></div>
          <div>媒體 wrapper 不該被轉</div>
        </div>
      </article>
    `);
    const html = buildCleanHtmlImpl(root);
    // 段落必須是 <p>（Readwise 才會識別為段落）
    assert.match(html, /<p[^>]*>第一段內容很重要<\/p>/, 'FB 段落 div 必須改寫成 <p>');
    assert.match(html, /<p[^>]*>第二段內容也很重要/, 'FB 段落 div 必須改寫成 <p>（含 inline 連結也保留）');
    assert.ok(html.includes('<a href="https://x.com">連結</a>'), '段落內的 inline 連結必須保留');
    // 非 fb-para div 不可被誤轉
    assert.ok(html.includes('<div>媒體 wrapper 不該被轉</div>'), '非 fb-para div 必須維持 <div>');
    // 改寫後不可留下 fb-para 標的舊 div
    assert.ok(!/<div[^>]*data-jread-fb-para/.test(html), '改寫後不可留下 data-jread-fb-para 的 div');
  });

  // v0.8.62 title 去重：Readwise 端用 payload title 欄位另渲染一條主標 header，
  // body 內若殘留同名 heading 會被重複渲染（theatlantic 實證：detector 注入的
  // 可見主標 h1 + 站方原生 ArticleTitle h1（display:none 但未標 data-jread-hidden）
  // 兩份都進了 outerHTML → 加上 title 欄位共 3 條標題，Jimmy 2026-06-14 截圖回報）。
  it('與 payload title 同文的 heading 必須移除（防 Readwise 重複渲染主標）', () => {
    const root = makeDoc(`
      <article data-jread-active="1">
        <h1 style="font-size: 2em">How Britain Became as Poor as Mississippi</h1>
        <header>
          <div style="display: none"><h1 class="ArticleTitle_root">How Britain Became as Poor as Mississippi</h1></div>
          <p>A case study in self-sabotage</p>
        </header>
        <p>主文第一段</p>
        <h2>An actual section heading</h2>
        <p>主文第二段</p>
      </article>
    `);
    const html = buildCleanHtmlImpl(root, 'How Britain Became as Poor as Mississippi');
    // 兩份主標 h1 都必須消失
    assert.ok(!/<h1[^>]*>How Britain Became as Poor as Mississippi<\/h1>/.test(html),
      'body 內與 title 同文的 h1 必須全部移除');
    assert.ok(!html.includes('How Britain Became as Poor as Mississippi'),
      '主標文字不可殘留在 body（title 欄位已承擔）');
    // 副標 / 主文 / 真正的 section heading 必須保留
    assert.ok(html.includes('A case study in self-sabotage'), '副標（dek）必須保留');
    assert.ok(html.includes('主文第一段') && html.includes('主文第二段'), '主文必須保留');
    assert.ok(html.includes('An actual section heading'),
      '與 title 不同文的 section heading 不可被誤殺');
  });

  it('title 比對折疊標點 + 大小寫（smart quote vs ASCII 不影響去重）', () => {
    const root = makeDoc(`
      <article data-jread-active="1">
        <h1>It’s a Trap, Britain’s Economy</h1>
        <p>主文</p>
      </article>
    `);
    // title 欄位來源用 ASCII 直引號、body h1 用 smart quote，折疊後須視為相等
    const html = buildCleanHtmlImpl(root, "It's a Trap, Britain's Economy");
    assert.ok(!/It’s a Trap/.test(html), 'smart quote 與 ASCII 折疊後同文的 h1 必須移除');
    assert.ok(html.includes('主文'));
  });

  it('title 為空時不去重（X / 無標題頁不誤殺 heading）', () => {
    const root = makeDoc(`
      <article data-jread-active="1">
        <h1>唯一的標題</h1>
        <p>主文</p>
      </article>
    `);
    const html = buildCleanHtmlImpl(root, '');
    assert.ok(html.includes('唯一的標題'), 'title 空字串時 heading 必須原樣保留');
  });

  it('保留非 jread 的 data-* attribute（不誤殺站點原有資料屬性）', () => {
    const root = makeDoc(`
      <article data-jread-active="1" data-article-id="123">
        <p data-tracking="ignore">主文</p>
      </article>
    `);
    const html = buildCleanHtmlImpl(root);
    assert.ok(html.includes('data-article-id="123"'), '原站 data-* 必須保留');
    assert.ok(html.includes('data-tracking="ignore"'), '原站 data-* 必須保留');
    assert.ok(!html.includes('data-jread-active'), 'jread data-* 必須剝掉');
  });

  // v0.8.53 空殼 prune：cleaner 把 li 內部的 interactive 元素標 hidden（follow /
  // share / topic 按鈕群），移除後殘留的空 li / ul 在 Readwise 端渲染成一排空
  // bullet（theverge 頂端 topic chips + 文末 follow widget，Jimmy 2026-06-12
  // 截圖回報；本地 reader card 殼高 0 看不見、偽陰性）。
  it('hidden 內容移除後的空 li / ul 殼必須整個 prune（防 Readwise 空 bullet）', () => {
    const root = makeDoc(`
      <article data-jread-active="1">
        <h1>標題</h1>
        <ul class="topic-chips">
          <li><span role="button" data-jread-hidden="1">Tech 追蹤按鈕</span></li>
          <li><span role="button" data-jread-hidden="1">Gadgets 追蹤按鈕</span></li>
          <li><span role="button" data-jread-hidden="1">Apps 追蹤按鈕</span></li>
        </ul>
        <p>主文段落</p>
      </article>
    `);
    const html = buildCleanHtmlImpl(root);
    assert.ok(!html.includes('<li'), '內容全被 hidden 清掉的 li 殼必須移除');
    assert.ok(!html.includes('topic-chips'), '殼鏈必須逐層塌掉（li 清空後 ul 也移除）');
    assert.ok(html.includes('主文段落'), '主文必須保留');
  });

  it('有可見文字或媒體的 li 不可被 prune（合法清單內容保留）', () => {
    const root = makeDoc(`
      <article data-jread-active="1">
        <ul>
          <li>有文字的清單項</li>
          <li><img src="https://cdn.example.com/pic.jpg"></li>
          <li><span data-jread-hidden="1">按鈕</span></li>
        </ul>
      </article>
    `);
    const html = buildCleanHtmlImpl(root);
    assert.ok(html.includes('有文字的清單項'), '有文字的 li 必須保留');
    assert.ok(html.includes('cdn.example.com/pic.jpg'), '含媒體的 li 必須保留');
    assert.ok(!/(<li[^>]*>\s*<\/li>)/.test(html), '清空的 li 殼必須移除');
  });

  it('表格結構元素不 prune（空 td 撐欄位對齊是合法結構）', () => {
    const root = makeDoc(`
      <article data-jread-active="1">
        <table><tbody><tr><td></td><td>值</td></tr></tbody></table>
      </article>
    `);
    const html = buildCleanHtmlImpl(root);
    assert.ok(html.includes('<td></td>'), '空 td 必須保留（表格對齊結構）');
    assert.ok(html.includes('<td>值</td>'));
  });

  it('空 div / span 殼也 prune；含媒體子孫的容器保留', () => {
    const root = makeDoc(`
      <article data-jread-active="1">
        <div class="empty-wrap"><span></span></div>
        <figure><div><img src="https://cdn.example.com/hero.jpg"></div></figure>
        <p>內文</p>
      </article>
    `);
    const html = buildCleanHtmlImpl(root);
    assert.ok(!html.includes('empty-wrap'), '無文字無媒體的 div 殼必須移除');
    assert.ok(html.includes('cdn.example.com/hero.jpg'), '含 img 子孫的容器必須保留');
  });
});

// v0.8.50 行為層 spec：extractReaderTitle 的等價實作（main.js 包在 IIFE 內無法
// require，比照 buildCleanHtmlImpl 模式重寫；上面 forcing function 抓「實作存在
// + 結構正確」、這裡抓「演算法效果正確」）。
//
// 背景：document.title 是載入時靜態 metadata。翻譯擴充（Shinkansen single 模式）
// 原地替換 h1 內文後，使用者在 reader card 看到譯後標題、document.title 仍是
// 原文——舊版直接讀 document.title 導致 Readwise 收到未翻譯標題。修法：card 內
// 第一個可見 h1 是「使用者看到的主標」單一資料源，優先取用。
function stripSiteSuffixImpl(title) {
  return (title || '').split(/\s+[|\-—–·]\s+|｜/)[0].trim();
}

function extractReaderTitleImpl(card, doc) {
  if (card) {
    const headings = card.querySelectorAll('h1');
    for (const h of headings) {
      if (h.closest('[data-jread-hidden="1"]')) continue;
      const raw = h.innerText != null ? h.innerText : h.textContent;
      const text = (raw || '').replace(/\s+/g, ' ').trim();
      if (text && text.length <= 300) return text;
    }
  }
  const rawTitle = (doc.title || '').trim();
  return stripSiteSuffixImpl(rawTitle) || rawTitle;
}

describe('readwise: extractReaderTitle 行為契約（v0.8.50）', () => {
  function makeCase(bodyHTML, docTitle) {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><head><title>${docTitle}</title></head><body>${bodyHTML}</body></html>`
    );
    const doc = dom.window.document;
    return { card: doc.querySelector('[data-jread-active="1"]'), doc };
  }

  it('card 內 h1 與 document.title 不同（翻譯後場景）：送 h1 文字', () => {
    // 模擬 Shinkansen single 模式：h1 內文已被原地替換成譯文，document.title 仍是原文
    const { card, doc } = makeCase(
      `<article data-jread-active="1"><h1>了解 MCP 的十個關鍵</h1><p>內文</p></article>`,
      'Ten Things About MCP | Example Blog'
    );
    assert.strictEqual(extractReaderTitleImpl(card, doc), '了解 MCP 的十個關鍵');
  });

  it('card 內沒 h1（X / FB 合成 reader 類）：fallback document.title 並去站名尾綴', () => {
    const { card, doc } = makeCase(
      `<div data-jread-active="1"><p>推文內容</p></div>`,
      '文章標題 | 中央社 CNA'
    );
    assert.strictEqual(extractReaderTitleImpl(card, doc), '文章標題');
  });

  it('h1 在 [data-jread-hidden] 雜訊區內（站名 logo h1）：跳過、取下一個可見 h1', () => {
    const { card, doc } = makeCase(
      `<article data-jread-active="1">
        <header data-jread-hidden="1"><h1>站名 Logo</h1></header>
        <h1>真正的文章標題</h1><p>內文</p>
      </article>`,
      '真正的文章標題 - 站名'
    );
    assert.strictEqual(extractReaderTitleImpl(card, doc), '真正的文章標題');
  });

  it('h1 自身標 data-jread-hidden 且無其他 h1：fallback document.title', () => {
    const { card, doc } = makeCase(
      `<article data-jread-active="1"><h1 data-jread-hidden="1">Logo</h1><p>內文</p></article>`,
      '標題 - 站名'
    );
    assert.strictEqual(extractReaderTitleImpl(card, doc), '標題');
  });

  it('h1 文字為空白：fallback document.title', () => {
    const { card, doc } = makeCase(
      `<article data-jread-active="1"><h1>   </h1><p>內文</p></article>`,
      '標題 - 站名'
    );
    assert.strictEqual(extractReaderTitleImpl(card, doc), '標題');
  });

  it('h1 文字超過 300 字（detector 誤圈容器的防線）：fallback document.title', () => {
    const long = '長'.repeat(301);
    const { card, doc } = makeCase(
      `<article data-jread-active="1"><h1>${long}</h1><p>內文</p></article>`,
      '標題 - 站名'
    );
    assert.strictEqual(extractReaderTitleImpl(card, doc), '標題');
  });

  it('h1 路徑不做站名尾綴切割（標題本文含「 — 」不可被截斷）', () => {
    const { card, doc } = makeCase(
      `<article data-jread-active="1"><h1>AI 浪潮 — 十年後的回望</h1></article>`,
      'AI 浪潮 — 十年後的回望 | 站名'
    );
    assert.strictEqual(extractReaderTitleImpl(card, doc), 'AI 浪潮 — 十年後的回望');
  });

  it('h1 內多重空白 / 換行：collapse 成單一空白', () => {
    const { card, doc } = makeCase(
      `<article data-jread-active="1"><h1>標題
        分兩行   多空白</h1></article>`,
      'whatever'
    );
    assert.strictEqual(extractReaderTitleImpl(card, doc), '標題 分兩行 多空白');
  });
});

// ---- Gemini Flash Lite 摘要（v0.8.72）---------------------------------
describe('readwise: buildSummaryPrompt', () => {
  it('帶入 title / author / domain / 內文 + 繁中三句指令', () => {
    const p = buildSummaryPrompt({
      title: '標題T', author: '作者A', domain: 'example.com', text: '這是內文。'
    });
    assert.match(p, /Taiwanese Traditional Chinese/);
    assert.match(p, /Title: 標題T/);
    assert.match(p, /Author: 作者A/);
    assert.match(p, /Domain: example\.com/);
    assert.match(p, /這是內文。/);
    assert.match(p, /no more than THREE sentences/);
  });

  it('內文超過 GEMINI_MAX_CHARS：head-truncate（超出部分截掉）', () => {
    const long = 'A'.repeat(GEMINI_MAX_CHARS) + 'ZZZ_PAST_LIMIT_MARKER';
    const p = buildSummaryPrompt({ title: 'T', author: '', domain: '', text: long });
    assert.ok(!p.includes('ZZZ_PAST_LIMIT_MARKER'), '超過上限的內文段必須被截掉');
    assert.ok(p.includes('A'.repeat(100)), '上限內的內文必須保留');
  });

  it('缺欄位不炸（空字串安全）', () => {
    const p = buildSummaryPrompt({});
    assert.match(p, /Title: /);
    assert.match(p, /Taiwanese Traditional Chinese/);
  });
});

describe('readwise: extractGeminiText', () => {
  it('正常回應：串接 parts[*].text', () => {
    const data = { candidates: [{ content: { parts: [{ text: '第一句。' }, { text: '第二句。' }] } }] };
    assert.strictEqual(extractGeminiText(data), '第一句。第二句。');
  });
  it('無 candidates / 結構缺漏：回空字串', () => {
    assert.strictEqual(extractGeminiText(null), '');
    assert.strictEqual(extractGeminiText({}), '');
    assert.strictEqual(extractGeminiText({ candidates: [] }), '');
    assert.strictEqual(extractGeminiText({ candidates: [{}] }), '');
    assert.strictEqual(extractGeminiText({ candidates: [{ content: {} }] }), '');
  });
});

describe('readwise: generateGeminiSummary', () => {
  const base = { title: 'T', author: 'A', domain: 'd.com', text: '內文內容' };

  it('沒 apiKey：回 NO_KEY，不打 API', async () => {
    const { fetchImpl, calls } = makeFetch(() => { throw new Error('should not be called'); });
    const r = await generateGeminiSummary({ ...base, apiKey: '', fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'NO_KEY');
    assert.strictEqual(calls.length, 0);
  });

  it('apiKey 全空白：回 NO_KEY', async () => {
    const r = await generateGeminiSummary({ ...base, apiKey: '   ', fetchImpl: async () => ({}) });
    assert.strictEqual(r.error, 'NO_KEY');
  });

  it('沒內文：回 NO_TEXT，不打 API', async () => {
    const { fetchImpl, calls } = makeFetch(() => { throw new Error('nope'); });
    const r = await generateGeminiSummary({ ...base, text: '', apiKey: 'k', fetchImpl });
    assert.strictEqual(r.error, 'NO_TEXT');
    assert.strictEqual(calls.length, 0);
  });

  it('成功：回 ok=true + summary；打對 endpoint（key 在 query）+ body 帶 prompt', async () => {
    const { fetchImpl, calls } = makeFetch(async () => ({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '三句繁中摘要。' }] } }] })
    }));
    const r = await generateGeminiSummary({ ...base, apiKey: 'mykey', fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.summary, '三句繁中摘要。');
    assert.match(calls[0][0], /generativelanguage\.googleapis\.com\/v1beta\/models\/.*:generateContent\?key=mykey/);
    assert.strictEqual(calls[0][1].method, 'POST');
    const body = JSON.parse(calls[0][1].body);
    assert.match(body.contents[0].parts[0].text, /Taiwanese Traditional Chinese/);
    assert.match(body.contents[0].parts[0].text, /內文內容/);
  });

  it('apiKey 含特殊字元：URL-encode 進 query', async () => {
    const { fetchImpl, calls } = makeFetch(async () => ({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'x' }] } }] })
    }));
    await generateGeminiSummary({ ...base, apiKey: 'a/b+c', fetchImpl });
    assert.match(calls[0][0], /key=a%2Fb%2Bc/);
  });

  it('401 / 403：回 AUTH', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    const r = await generateGeminiSummary({ ...base, apiKey: 'bad', fetchImpl });
    assert.strictEqual(r.error, 'AUTH');
    assert.strictEqual(r.status, 403);
  });

  it('500：回 HTTP', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const r = await generateGeminiSummary({ ...base, apiKey: 'k', fetchImpl });
    assert.strictEqual(r.error, 'HTTP');
    assert.strictEqual(r.status, 500);
  });

  it('回應空摘要：回 EMPTY', async () => {
    const { fetchImpl } = makeFetch(async () => ({
      ok: true, status: 200, json: async () => ({ candidates: [] })
    }));
    const r = await generateGeminiSummary({ ...base, apiKey: 'k', fetchImpl });
    assert.strictEqual(r.error, 'EMPTY');
  });

  it('網路錯誤：回 NETWORK', async () => {
    const fetchImpl = async () => { throw new Error('Failed to fetch'); };
    const r = await generateGeminiSummary({ ...base, apiKey: 'k', fetchImpl });
    assert.strictEqual(r.error, 'NETWORK');
    assert.match(r.message, /Failed to fetch/);
  });
});
