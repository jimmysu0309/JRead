// JRead — Readwise Reader 整合 regression（v0.7.33）
// 對應功能：popup「送到 Readwise」按鈕走 popup-core.buildReadwisePayload + saveToReadwise。
// 測試純函式行為：payload 結構、token 缺漏 / 401 / 網路錯誤 / 成功。

const path = require('path');
const assert = require('assert');

const { buildReadwisePayload, saveToReadwise, sendDocument, saveResultToast, validateReadwiseToken, validateGeminiKey, buildSummaryPrompt, extractGeminiText, generateGeminiSummary, GEMINI_MAX_CHARS, READWISE_API_URL, READWISE_AUTH_URL } = require(
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
      title: 'Hi',
      should_clean_html: true
    });
  });

  it('只給 url：可送（Readwise 容許僅 url，會自抓）', () => {
    const body = buildReadwisePayload({ url: 'https://example.com/post/1' });
    assert.deepStrictEqual(body, { url: 'https://example.com/post/1', should_clean_html: true });
  });

  it('沒給 url：必拋（Readwise API 強制要求）', () => {
    assert.throws(() => buildReadwisePayload({ html: '<p>x</p>' }), /url 必填/);
    assert.throws(() => buildReadwisePayload({}), /url 必填/);
    assert.throws(() => buildReadwisePayload({ url: 123 }), /url 必填/);
  });

  it('html / title 是空字串或非 string：略過該欄', () => {
    const body = buildReadwisePayload({ url: 'https://x.com', html: '', title: null });
    assert.deepStrictEqual(body, { url: 'https://x.com', should_clean_html: true });
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

  // v0.8.134：非翻譯頁 should_clean_html=true——讓 Readwise server 端跑解析 pipeline，
  // 把內文 <img> 改寫成自家簽章代理（imgproxy.readwise.io，帶來源 referer）以繞過防盜連
  // CDN 的 403（sspai cdnfile 實證：無 referer→403）。不開時內文圖在 reader 端裸載 → 全破。
  it('非翻譯頁 should_clean_html=true（繞過防盜連 CDN 的內文圖代理）', () => {
    assert.strictEqual(buildReadwisePayload({ url: 'https://x.com' }).should_clean_html, true);
    assert.strictEqual(
      buildReadwisePayload({ url: 'https://x.com', html: '<p>x</p>', title: 'T' }).should_clean_html,
      true
    );
    // isTranslated 明確為 false 或 falsy → 仍走 true
    assert.strictEqual(buildReadwisePayload({ url: 'https://x.com', isTranslated: false }).should_clean_html, true);
  });

  // v0.8.138：翻譯頁（Shinkansen 譯文）should_clean_html=false——關掉 Readwise readability
  // pipeline 原樣保留注入的譯文。開啟時 Readwise 會把譯文當外來節點清掉（reader 端只剩
  // 英文原文）、熱門站如 The Verge 還會被導去 server 端快取原文完全略過上傳 body
  //（Jimmy 2026-06-20 The Verge 譯文回報，v0.8.134 加 should_clean_html 後退步）。
  it('翻譯頁 should_clean_html=false（原樣保留 Shinkansen 譯文）', () => {
    assert.strictEqual(
      buildReadwisePayload({ url: 'https://theverge.com/x', html: '<p>譯文</p>', isTranslated: true }).should_clean_html,
      false
    );
  });

  // v1.5.8：should_clean_html=false 時 Readwise 強制要求 author + title（缺則回 400
  // non_field_errors，Jimmy 2026-06-28 macstories 譯文頁實證）。翻譯頁抽不到作者名
  // 時補來源網域、缺 title 補 url，確保兩欄必存在。
  it('翻譯頁缺 author：補來源網域（hostname 去 www）', () => {
    const body = buildReadwisePayload({ url: 'https://www.macstories.net/club/x', html: '<p>譯文</p>', isTranslated: true });
    assert.strictEqual(body.should_clean_html, false);
    assert.strictEqual(body.author, 'macstories.net', 'author 必須補成去 www 的 hostname');
  });

  it('翻譯頁有 author：原樣保留、不被網域覆蓋', () => {
    const body = buildReadwisePayload({ url: 'https://www.macstories.net/x', html: '<p>譯文</p>', author: 'Federico Viticci', isTranslated: true });
    assert.strictEqual(body.author, 'Federico Viticci');
  });

  it('翻譯頁缺 title：補 url（極端缺漏防線）', () => {
    const body = buildReadwisePayload({ url: 'https://example.com/translated', html: '<p>譯文</p>', isTranslated: true });
    assert.strictEqual(body.title, 'https://example.com/translated');
  });

  it('翻譯頁 url 無法 parse hostname：author 退回「未知作者」', () => {
    const body = buildReadwisePayload({ url: 'not-a-valid-url', html: '<p>譯文</p>', isTranslated: true });
    assert.strictEqual(body.author, '未知作者');
  });

  it('非翻譯頁（should_clean_html=true）缺 author：不補（讓 Readwise 自抓 metadata）', () => {
    const body = buildReadwisePayload({ url: 'https://www.macstories.net/x', html: '<p>x</p>' });
    assert.strictEqual(body.should_clean_html, true);
    assert.strictEqual(body.author, undefined, 'should_clean_html=true 時不可硬補 author（避免污染、Readwise 會自抓真作者）');
    assert.strictEqual(body.title, undefined, 'should_clean_html=true 時不可硬補 title');
  });

  // v1.7.28：language 欄位——v0.7.167 曾斷言「API 沒此欄位、絕不可送」，已證實
  // 為誤（Shinkansen 專案 2026-07-31 實測：欄位存在且有效）。不帶時 Reader 對內容
  // 跑自動語言偵測，會把純繁中誤判成 ko（韓文字體渲染漢字 → 缺字逐字 fallback
  // 中文字體 → 同句字體混排），且完全無視提交 HTML 的 <html lang>。唯一可靠解
  // 法＝save 時明確帶 language 讓 Reader 跳過偵測。
  const ZH_TEXT = '這是一段繁體中文的測試內文，用來驗證漢字佔比門檻。閱讀模式會把主文抽出來送到儲存服務。';
  const EN_TEXT = 'This is a plain English article body used to verify that Latin text never gets tagged as Chinese by the heuristic.';
  const JA_TEXT = 'これは日本語のテスト本文です。漢字も含まれていますが、仮名が主導しているので中国語と誤判定してはいけません。';

  it('翻譯頁（isTranslated）：無條件帶 language=zh-TW（譯文必為繁中，不走文字判斷）', () => {
    const body = buildReadwisePayload({ url: 'https://x.com', html: '<p>譯文</p>', isTranslated: true });
    assert.strictEqual(body.language, 'zh-TW');
  });

  it('非翻譯頁 + 繁中內文（漢字比 >= 15%、無假名）：帶 language=zh-TW', () => {
    const body = buildReadwisePayload({ url: 'https://x.com', html: '<p>x</p>', text: ZH_TEXT });
    assert.strictEqual(body.language, 'zh-TW');
  });

  it('非翻譯頁 + 英文內文：不帶 language（維持 Reader 自動偵測）', () => {
    const body = buildReadwisePayload({ url: 'https://x.com', html: '<p>x</p>', text: EN_TEXT });
    assert.strictEqual(body.language, undefined);
  });

  it('非翻譯頁 + 日文內文（假名主導）：不帶 language（漢字比高但不可誤標 zh-TW）', () => {
    const body = buildReadwisePayload({ url: 'https://x.com', html: '<p>x</p>', text: JA_TEXT });
    assert.strictEqual(body.language, undefined);
  });

  it('沒 text 也非翻譯頁：不帶 language', () => {
    const body = buildReadwisePayload({ url: 'https://x.com', html: '<p>x</p>' });
    assert.strictEqual(body.language, undefined);
  });

  it('上游硬塞 language 參數：忽略（language 只能由 isTranslated / 內容判斷導出）', () => {
    const body = buildReadwisePayload({ url: 'https://x.com', html: '<p>x</p>', text: EN_TEXT, language: 'ko' });
    assert.strictEqual(body.language, undefined);
  });
});

describe('readwise: detectHanLanguage（內容語言判斷，v1.7.28）', () => {
  const { detectHanLanguage } = require(
    path.join(__dirname, '..', '..', 'jread', 'popup', 'popup-core.js')
  );

  it('純繁中：zh-TW', () => {
    assert.strictEqual(detectHanLanguage('繁體中文內容測試，漢字佔比極高。'), 'zh-TW');
  });

  it('中英夾雜（漢字比仍 >= 15%）：zh-TW', () => {
    assert.strictEqual(
      detectHanLanguage('這篇文章介紹 Chrome Extension 的 Manifest V3 架構，內容以繁體中文為主，夾雜英文術語 service worker 與 content script。'),
      'zh-TW'
    );
  });

  it('英文為主、只點綴少量漢字（比 < 15%）：空字串', () => {
    assert.strictEqual(
      detectHanLanguage('This is a long English paragraph that only mentions the word 中文 once in passing while everything else is Latin text, so the han ratio stays far below the threshold.'),
      ''
    );
  });

  it('日文（假名佔比 >= 5%）：空字串', () => {
    assert.strictEqual(
      detectHanLanguage('日本語の記事本文です。漢字と仮名が混在していますが、仮名の割合が高いので中国語ではありません。'),
      ''
    );
  });

  it('韓文諺文：空字串（漢字比為零，不在誤標範圍）', () => {
    assert.strictEqual(detectHanLanguage('한국어 기사 본문입니다. 한자가 없는 순수 한글 텍스트입니다.'), '');
  });

  it('空字串 / null / 非 string / 純空白：空字串', () => {
    assert.strictEqual(detectHanLanguage(''), '');
    assert.strictEqual(detectHanLanguage(null), '');
    assert.strictEqual(detectHanLanguage(undefined), '');
    assert.strictEqual(detectHanLanguage(12345), '');
    assert.strictEqual(detectHanLanguage('   \n\t  '), '');
  });

  it('只取前 2000 字判斷：後段大量漢字不影響（前段純英文 → 空字串）', () => {
    const longEn = 'english text '.repeat(160); // > 2000 字元
    assert.strictEqual(detectHanLanguage(longEn + '中文'.repeat(500)), '');
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

// v1.5.7：Readwise 非 2xx 回應原因浮出（Jimmy 2026-06-28 macstories club 付費牆頁
// 送出 HTTP 400 回報）。原本 saveToReadwise 只 res.json()，非 JSON body 失敗就把
// 唯一的失敗原因丟掉、toast 只剩不透明的「HTTP 400」無從定位。改先讀 text 再 parse、
// 萃出 detail 帶回 result，saveResultToast / popup status 顯示具體原因。
const { readwiseErrorDetail } = require(
  path.join(__dirname, '..', '..', 'jread', 'popup', 'popup-core.js')
);

// 真實 Response 一定有 .text()；此 helper 產出忠實替身（body 為原始字串）。
function makeFetchText(impl) {
  const calls = [];
  const fn = async (...args) => { calls.push(args); return impl(...args); };
  return { fetchImpl: fn, calls };
}

describe('readwise: readwiseErrorDetail（萃 4xx 原因）', () => {
  it('DRF 風格 { detail }：回 detail 句', () => {
    assert.strictEqual(readwiseErrorDetail({ detail: 'Invalid input.' }, ''), 'Invalid input.');
  });

  it('欄位錯誤物件 { field: [msg] }：串成「field: msg」', () => {
    const d = readwiseErrorDetail({ url: ['This field is required.'], html: ['Too large.'] }, '');
    assert.match(d, /url: This field is required\./);
    assert.match(d, /html: Too large\./);
  });

  it('欄位值為字串（非陣列）：照樣萃出', () => {
    assert.strictEqual(readwiseErrorDetail({ published_date: 'wrong format' }, ''), 'published_date: wrong format');
  });

  it('非 JSON（data=null）：回原始 text', () => {
    assert.strictEqual(readwiseErrorDetail(null, '  Bad Request  '), 'Bad Request');
  });

  it('detail 優先於泛欄位掃描', () => {
    assert.strictEqual(readwiseErrorDetail({ detail: '主因', url: ['次要'] }, 'raw'), '主因');
  });

  it('空物件 + 無 text：回空字串', () => {
    assert.strictEqual(readwiseErrorDetail({}, ''), '');
    assert.strictEqual(readwiseErrorDetail(null, ''), '');
  });

  it('過長內容截斷到 200 字以內（避免灌爆 toast）', () => {
    const long = 'x'.repeat(500);
    const d = readwiseErrorDetail(null, long);
    assert.ok(d.length <= 200, `截斷後長度應 <= 200，實際 ${d.length}`);
    assert.ok(d.endsWith('…'), '截斷應以刪節號收尾');
  });
});

describe('readwise: saveToReadwise 帶 detail（v1.5.7）', () => {
  const goodPayload = { url: 'https://example.com/post/1', html: '<p>x</p>' };

  it('400 + JSON body { detail }：回 HTTP + status=400 + detail 萃出', async () => {
    const { fetchImpl } = makeFetchText(async () => ({
      ok: false, status: 400, text: async () => JSON.stringify({ detail: 'Document too large.' })
    }));
    const r = await saveToReadwise({ token: 'xyz', payload: goodPayload, fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'HTTP');
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.detail, 'Document too large.');
  });

  it('400 + 非 JSON body（純文字）：detail = 原始 text', async () => {
    const { fetchImpl } = makeFetchText(async () => ({
      ok: false, status: 400, text: async () => 'Bad Request'
    }));
    const r = await saveToReadwise({ token: 'xyz', payload: goodPayload, fetchImpl });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.detail, 'Bad Request');
  });

  it('401 + body：error=AUTH 仍帶 detail（診斷用）', async () => {
    const { fetchImpl } = makeFetchText(async () => ({
      ok: false, status: 401, text: async () => JSON.stringify({ detail: 'Invalid token.' })
    }));
    const r = await saveToReadwise({ token: 'bad', payload: goodPayload, fetchImpl });
    assert.strictEqual(r.error, 'AUTH');
    assert.strictEqual(r.detail, 'Invalid token.');
  });

  it('成功（201）走 text()：仍能 JSON.parse 出 data', async () => {
    const { fetchImpl } = makeFetchText(async () => ({
      ok: true, status: 201, text: async () => JSON.stringify({ id: 'abc' })
    }));
    const r = await saveToReadwise({ token: 'xyz', payload: goodPayload, fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.data.id, 'abc');
  });

  it('向後相容：只實作 json() 的舊替身仍回 ok + data（不取 detail）', async () => {
    const { fetchImpl } = makeFetch(async () => ({
      ok: true, status: 201, json: async () => ({ id: 'legacy' })
    }));
    const r = await saveToReadwise({ token: 'xyz', payload: goodPayload, fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.data.id, 'legacy');
  });
});

// v1.6.24：readwiseResultToast 已移除（死 code，v1.6.0 起 SW 用 saveResultToast、
// popup 用自己的 setReadwiseStatus 文字）——v1.5.7 的 detail 行為由 saveResultToast 承接
describe('readwise: saveResultToast 帶 detail（v1.5.7 行為承接）', () => {
  it('HTTP 400 + detail：toast 文字含 HTTP 碼與具體原因', () => {
    const t = saveResultToast({ ok: false, status: 400, error: 'HTTP', detail: 'Document too large.' });
    assert.strictEqual(t.kind, 'error');
    assert.match(t.message, /送出失敗/);
    assert.match(t.message, /HTTP 400/);
    assert.match(t.message, /Document too large\./);
  });

  it('無 detail：退回原本「送出失敗（HTTP 碼）」', () => {
    const t = saveResultToast({ ok: false, status: 500, error: 'HTTP' });
    assert.strictEqual(t.message, '送出失敗（HTTP 500）');
  });

  // forcing function：popup status 與 SW toast 兩條送出回饋都必須帶上 detail
  it('popup.js generic 分支必須引用 result.detail（狀態列顯示具體原因）', () => {
    const fs = require('fs');
    const js = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.js'), 'utf8'
    );
    assert.match(js, /result\s*&&\s*result\.detail/,
      'popup.js 送出失敗分支必須引用 result.detail（不可回退到只顯示 HTTP 碼）');
  });
});

// v0.8.65：popup「送到 Readwise」在 extension 頁直接 fetch（不繞 background）。
// iOS Safari 背景頁掛起讓 SAVE_TO_READWISE 往返 / 背景 fetch silently 失敗
//（macOS Chrome/Safari 正常）；options「測試 token」GET 從 extension 頁直接發
// iOS 實測可行，save 走同一路徑。v1.6.0 起入口泛化為 sendDocument dispatcher
//（saveReaderPayload 死 code 已於 v1.6.24 移除），直送語意不變——本組 spec 驗
// dispatcher 的 readwise 軌行為。
describe('readwise: sendDocument readwise 軌（extension-page 直送）', () => {
  const goodPayload = { url: 'https://example.com/post/1', html: '<p>x</p>' };

  it('成功：creds.token → build → POST /save/，回 ok=true + 帶對 token', async () => {
    const { fetchImpl, calls } = makeFetch(async () => ({
      ok: true, status: 201, json: async () => ({ id: 'abc' })
    }));
    const r = await sendDocument({
      service: 'readwise',
      creds: { token: 'tok-123' },
      payload: goodPayload,
      fetchImpl
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.status, 201);
    assert.strictEqual(calls[0][0], READWISE_API_URL);
    assert.strictEqual(calls[0][1].method, 'POST');
    assert.strictEqual(calls[0][1].headers['Authorization'], 'Token tok-123');
    // 內部經 buildReadwisePayload → 必帶 should_clean_html:true（v0.8.134）
    assert.deepStrictEqual(JSON.parse(calls[0][1].body), { ...goodPayload, should_clean_html: true });
  });

  it('token 空字串：回 NO_CREDENTIALS，不打 API', async () => {
    const { fetchImpl, calls } = makeFetch(() => { throw new Error('should not be called'); });
    const r = await sendDocument({ service: 'readwise', creds: { token: '' }, payload: goodPayload, fetchImpl });
    assert.strictEqual(r.error, 'NO_CREDENTIALS');
    assert.strictEqual(calls.length, 0);
  });

  it('payload 缺 url：回 INVALID_PAYLOAD、不打 API', async () => {
    const { fetchImpl, calls } = makeFetch(() => { throw new Error('should not be called'); });
    const r = await sendDocument({
      service: 'readwise',
      creds: { token: 'tok-123' },
      payload: { html: '<p>x</p>' },
      fetchImpl
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'INVALID_PAYLOAD');
    assert.strictEqual(calls.length, 0);
  });

  it('401：透傳 saveToReadwise 的 AUTH', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const r = await sendDocument({ service: 'readwise', creds: { token: 'bad' }, payload: goodPayload, fetchImpl });
    assert.strictEqual(r.error, 'AUTH');
    assert.strictEqual(r.status, 401);
  });

  // forcing function：popup 按鈕必須走 extension-page 直送、不可回退到繞 background
  it('popup.js 必須用 sendDocument 直送、不得用 runtime.sendMessage 送 SAVE_TO_READWISE', () => {
    const fs = require('fs');
    const js = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.js'), 'utf8'
    );
    // v1.6.0：saveReaderPayload 泛化為 sendDocument dispatcher（服務二擇一），
    // 仍是「extension 頁自己 fetch、不繞 background」的直送語意。
    assert.match(js, /sendDocument/,
      'popup.js 必須呼叫 window.__JReadPopup.sendDocument（extension 頁直送 dispatcher）');
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

  it('有效（200）：回 ok=true，打對 models list GET 端點（無尾斜線）+ key 走 header 已 trim', async () => {
    const { fetchImpl, calls } = makeFetch(async () => ({ ok: true, status: 200 }));
    const r = await validateGeminiKey({ apiKey: '  good key  ', fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(calls[0][1].method, 'GET');
    // models 端點不可有尾斜線
    assert.match(calls[0][0], /\/v1beta\/models$/);
    // v1.6.25：key 走 x-goog-api-key header、不得出現在 URL query
    // （URL 會進 proxy / server log，query 帶金鑰＝到處留明文副本）
    assert.ok(!/key=/.test(calls[0][0]), 'API key 不得放 URL query');
    assert.strictEqual(calls[0][1].headers['x-goog-api-key'], 'good key');
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

  it('options.html CSS：.field 不畫 per-field 分隔線（block 版面靠間距分區）', () => {
    // v0.8.158：改 Shinkansen block 版面後，欄位之間一律靠 margin 間距分區、
    // 不畫 border-bottom 分隔線（原本兩欄版用分隔線、Readwise 子設定群還得特地
    // 移除）。forcing：若有人替 .field 加回 per-field border-bottom，同功能子設定
    // （Readwise Token + 摘要 + Gemini key）又會被線切開誤以為是獨立功能。
    const fs = require('fs');
    const html = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'options', 'options.html'), 'utf8'
    );
    const m = html.match(/\.field\s*\{([\s\S]*?)\}/);
    assert.ok(m, '能在 options.html 找到 .field rule');
    assert.ok(!/border-bottom/.test(m[1]),
      '.field base rule 不可含 border-bottom——block 版面靠間距分區，加分隔線會切開同功能子設定');
  });

  it('options.html CSS：token-control 整寬直向堆疊（input 列 + 結果列）', () => {
    // v0.8.158：block 版面下 label 在上、控制群整寬在下，token-control 為直向
    // flex（input 列 + 測試結果列）。forcing：改回 row / 拿掉 column 會讓結果文字
    // 擠到 input 同列、整寬排版破版。
    const fs = require('fs');
    const html = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'options', 'options.html'), 'utf8'
    );
    assert.match(html, /\.readwise-token-control\s*\{[^}]*flex-direction:\s*column/,
      '.readwise-token-control 必須 flex-direction: column（整寬直向堆疊）');
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
      'SW 不可再有 SAVE_TO_READWISE case（iOS 背景頁掛起會 silently 失敗，已改 popup-core.sendDocument 直送）');
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
    // v0.8.126：Shinkansen 雙語只留中文——buildCleanHtml 必須對 clone 呼叫
    // NS.collapseShinkansenDual（移除原文、留譯文）+ stripDataAttrs 一併剝 shinkansen 標記
    assert.match(mainSrc, /^\s*if \(NS && NS\.collapseShinkansenDual\) NS\.collapseShinkansenDual\(clone\);/m,
      'main.js buildCleanHtml 必須對 clone 呼叫 NS.collapseShinkansenDual（不可是註解）');
    // v0.8.127：移除 reader 內 display:none 子樹（站點響應式重複版本、隱藏 byline）——
    // buildCleanHtml 必須呼叫 NS.stripHiddenForExport（標記 live）+ 在還原步驟 unmark
    assert.match(mainSrc, /NS\.stripHiddenForExport\(rootEl\)/,
      'main.js buildCleanHtml 必須呼叫 NS.stripHiddenForExport(rootEl) 標記 display:none 子樹');
    assert.match(mainSrc, /^\s*hiddenMarked\.forEach\(el => el\.removeAttribute\(['"]data-jread-rw-strip['"]\)\);/m,
      'main.js buildCleanHtml 必須在 live DOM 還原 hiddenMarked 標記（不可是註解）');
    assert.match(mainSrc, /startsWith\(['"]data-shinkansen['"]\)/,
      'stripDataAttrs 必須剝掉 data-shinkansen* attribute（dual collapse 後殘留標記）');
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
    // v1.7.3：第三參數 isTranslated——翻譯頁匯出把影片 embed 轉縮圖連結
    //（raw 模式 Readwise 剝 iframe），gate 的 forcing 在 readwise-embed-proxy-unwrap.spec.js。
    assert.match(mainSrc, /function\s+buildCleanHtml\s*\(\s*rootEl\s*,\s*title\s*,\s*isTranslated\s*\)/,
      'buildCleanHtml 必須收 title 參數（用來去重 body 內同名主標 heading）+ isTranslated（影片 embed 轉縮圖 gate）');
    assert.match(mainSrc, /=\s*buildCleanHtml\s*\(\s*NS\.state\.articleEl\s*,\s*title\s*,\s*isTranslated\s*\)/,
      'extractReaderPayload 必須把 title + isTranslated 傳給 buildCleanHtml');
    assert.match(mainSrc, /foldTitlePunct[\s\S]{0,400}querySelectorAll\(\s*['"]h1, h2, h3, h4, h5, h6['"]\s*\)/,
      'buildCleanHtml 必須折疊標點後比對、移除與 title 同文的 h1-h6（防 Readwise 重複主標）');
  });
});

// 行為層 spec：jsdom 重現 buildCleanHtml 預期效果。
// 因 main.js 包在 IIFE 且依賴 browser.runtime，無法直接 require；改在這裡
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

  it('成功：回 ok=true + summary；打對 endpoint（key 走 header）+ body 帶 prompt', async () => {
    const { fetchImpl, calls } = makeFetch(async () => ({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '三句繁中摘要。' }] } }] })
    }));
    const r = await generateGeminiSummary({ ...base, apiKey: 'mykey', fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.summary, '三句繁中摘要。');
    assert.match(calls[0][0], /generativelanguage\.googleapis\.com\/v1beta\/models\/.*:generateContent$/);
    // v1.6.25：key 走 x-goog-api-key header、不得出現在 URL query
    assert.ok(!/key=/.test(calls[0][0]), 'API key 不得放 URL query');
    assert.strictEqual(calls[0][1].headers['x-goog-api-key'], 'mykey');
    assert.strictEqual(calls[0][1].method, 'POST');
    const body = JSON.parse(calls[0][1].body);
    assert.match(body.contents[0].parts[0].text, /Taiwanese Traditional Chinese/);
    assert.match(body.contents[0].parts[0].text, /內文內容/);
  });

  it('apiKey 前後空白 trim 後進 header、特殊字元原樣（header 不需 URL-encode）', async () => {
    const { fetchImpl, calls } = makeFetch(async () => ({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'x' }] } }] })
    }));
    await generateGeminiSummary({ ...base, apiKey: '  a/b+c  ', fetchImpl });
    assert.strictEqual(calls[0][1].headers['x-goog-api-key'], 'a/b+c');
    assert.ok(!/key=/.test(calls[0][0]), 'API key 不得放 URL query');
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

// v0.8.165：結果 toast 訊息對映（SW 快速鍵軌用）。v1.6.24：Readwise 專屬
// readwiseResultToast 死 code 移除，訊息文字單一資料源 = saveResultToast
//（Readwise 語境 = serviceLabel 預設 'Readwise Reader' + existsOn200:true）。
describe('readwise: saveResultToast Readwise 語境（結果 → toast 文字/kind 單一資料源）', () => {
  const RW = { serviceLabel: 'Readwise Reader', existsOn200: true };

  it('成功 201（新存）→ 已送到 Readwise Reader / success', () => {
    assert.deepStrictEqual(saveResultToast({ ok: true, status: 201 }, RW),
      { message: '已送到 Readwise Reader', kind: 'success' });
  });

  it('成功 200（已存在）→ 已存在於 Readwise Reader / success', () => {
    assert.deepStrictEqual(saveResultToast({ ok: true, status: 200 }, RW),
      { message: '已存在於 Readwise Reader', kind: 'success' });
  });

  it('NO_CREDENTIALS → 提示去設定頁填憑證 / error', () => {
    const r = saveResultToast({ ok: false, error: 'NO_CREDENTIALS' }, RW);
    assert.strictEqual(r.kind, 'error');
    assert.match(r.message, /尚未設定 Readwise Reader 憑證/);
  });

  it('AUTH → 憑證無效或已過期 / error', () => {
    assert.deepStrictEqual(saveResultToast({ ok: false, error: 'AUTH', status: 401 }, RW),
      { message: 'Readwise Reader 憑證無效或已過期', kind: 'error' });
  });

  it('NETWORK → 網路錯誤 / error', () => {
    assert.deepStrictEqual(saveResultToast({ ok: false, error: 'NETWORK' }, RW),
      { message: '網路錯誤，請稍後再試', kind: 'error' });
  });

  it('其他 HTTP 錯誤帶 status → 送出失敗（HTTP nnn）/ error', () => {
    assert.deepStrictEqual(saveResultToast({ ok: false, error: 'HTTP', status: 500 }, RW),
      { message: '送出失敗（HTTP 500）', kind: 'error' });
  });

  it('undefined / 無 status 的泛用失敗 → 送出失敗（不帶 HTTP）/ error', () => {
    assert.deepStrictEqual(saveResultToast(undefined, RW),
      { message: '送出失敗', kind: 'error' });
    assert.deepStrictEqual(saveResultToast({ ok: false }, RW),
      { message: '送出失敗', kind: 'error' });
  });

  it('popup-core 不得再有 readwiseResultToast / saveReaderPayload 死 code', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'popup', 'popup-core.js'), 'utf8'
    );
    assert.ok(!/function\s+readwiseResultToast/.test(src),
      'readwiseResultToast 已於 v1.6.24 移除，不可回歸');
    assert.ok(!/function\s+saveReaderPayload/.test(src),
      'saveReaderPayload 已於 v1.6.24 移除，不可回歸');
  });
});
