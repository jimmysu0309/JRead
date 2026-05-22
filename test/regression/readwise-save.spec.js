// JRead — Readwise Reader 整合 regression（v0.7.33）
// 對應功能：popup「送到 Readwise」按鈕走 popup-core.buildReadwisePayload + saveToReadwise。
// 測試純函式行為：payload 結構、token 缺漏 / 401 / 網路錯誤 / 成功。

const path = require('path');
const assert = require('assert');

const { buildReadwisePayload, saveToReadwise, READWISE_API_URL } = require(
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

describe('readwise: 訊息協定常數同步', () => {
  it('namespace.js MSG 必須含 Readwise 用三條訊息（forcing function）', () => {
    const fs = require('fs');
    const nsSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'namespace.js'), 'utf8'
    );
    assert.match(nsSrc, /GET_READER_STATE/);
    assert.match(nsSrc, /EXTRACT_READER_HTML/);
    assert.match(nsSrc, /SAVE_TO_READWISE/);
  });

  it('SW 必須含 SAVE_TO_READWISE handler（forcing function）', () => {
    const fs = require('fs');
    const swSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'background', 'service-worker.js'), 'utf8'
    );
    assert.match(swSrc, /case 'SAVE_TO_READWISE'/);
    assert.match(swSrc, /readwiseToken/);
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
  });
});

// 行為層 spec：jsdom 重現 buildCleanHtml 預期效果。
// 因 main.js 包在 IIFE 且依賴 chrome.runtime，無法直接 require；改在這裡
// 重寫一份等價函式，確保「漏掉 hidden = 雜訊重現」這條核心契約有具體 spec 護住。
// 上面 forcing function 抓「實作存在 + 用對 attribute」、這裡 spec 抓「演算法效果正確」。
const { JSDOM } = require('jsdom');

function buildCleanHtmlImpl(rootEl) {
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
});
