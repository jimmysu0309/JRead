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
