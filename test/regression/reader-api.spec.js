// JRead — Readwise Reader 整合 API（v1.0.22）
// popup-core.listReaderDocuments / archiveReaderDocument 純函式行為：
// URL / method / Authorization header / archive body、錯誤分類（NO_TOKEN /
// NO_ID / AUTH 401·403 / NETWORK / HTTP / NO_FETCH）、results 解析。
// 比照 readwise-save.spec.js 的 fake fetchImpl 風格。

const path = require('path');
const assert = require('assert');

const { listReaderDocuments, archiveReaderDocument } = require(
  path.join(__dirname, '..', '..', 'jread', 'popup', 'popup-core.js')
);

function makeFetch(impl) {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    return impl(...args);
  };
  return { fetchImpl: fn, calls };
}

describe('reader-api: listReaderDocuments', () => {
  it('帶 location=new：GET /v3/list/?location=new + Authorization Token', async () => {
    const { fetchImpl, calls } = makeFetch(async () => ({
      ok: true, status: 200,
      json: async () => ({ results: [{ id: 'a' }, { id: 'b' }], nextPageCursor: 'cur1' })
    }));
    const r = await listReaderDocuments({ token: 'xyz', location: 'new', fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.results.map(d => d.id), ['a', 'b']);
    assert.strictEqual(r.nextPageCursor, 'cur1');
    const [url, opts] = calls[0];
    assert.match(url, /^https:\/\/readwise\.io\/api\/v3\/list\/\?/);
    assert.match(url, /location=new/);
    assert.strictEqual(opts.method, 'GET');
    assert.strictEqual(opts.headers.Authorization, 'Token xyz');
  });

  it('帶 tag：query 帶 tag=jread（JRead 分頁撈 jread tag）', async () => {
    const { fetchImpl, calls } = makeFetch(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }));
    await listReaderDocuments({ token: 'xyz', tag: 'jread', fetchImpl });
    assert.match(calls[0][0], /[?&]tag=jread/);
  });

  it('帶 id + withHtmlContent：query 帶 id 與 withHtmlContent=true（單篇取主文）', async () => {
    const { fetchImpl, calls } = makeFetch(async () => ({
      ok: true, status: 200,
      json: async () => ({ results: [{ id: 'x', html_content: '<p>hi</p>' }] })
    }));
    const r = await listReaderDocuments({ token: 'xyz', id: 'x', withHtmlContent: true, fetchImpl });
    assert.strictEqual(r.results[0].html_content, '<p>hi</p>');
    const [url] = calls[0];
    assert.match(url, /id=x/);
    assert.match(url, /withHtmlContent=true/);
  });

  it('token trim：header 用 trim 後的值', async () => {
    const { fetchImpl, calls } = makeFetch(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }));
    await listReaderDocuments({ token: '  tok  ', location: 'new', fetchImpl });
    assert.strictEqual(calls[0][1].headers.Authorization, 'Token tok');
  });

  it('沒 token：回 NO_TOKEN，不打 API', async () => {
    const { fetchImpl, calls } = makeFetch(() => { throw new Error('should not be called'); });
    const r = await listReaderDocuments({ token: '', location: 'new', fetchImpl });
    assert.strictEqual(r.error, 'NO_TOKEN');
    assert.strictEqual(calls.length, 0);
  });

  it('401：回 AUTH', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const r = await listReaderDocuments({ token: 'bad', location: 'new', fetchImpl });
    assert.strictEqual(r.error, 'AUTH');
    assert.strictEqual(r.status, 401);
  });

  it('403：回 AUTH', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    const r = await listReaderDocuments({ token: 'bad', location: 'new', fetchImpl });
    assert.strictEqual(r.error, 'AUTH');
  });

  it('500：回 HTTP', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const r = await listReaderDocuments({ token: 'xyz', location: 'new', fetchImpl });
    assert.strictEqual(r.error, 'HTTP');
    assert.strictEqual(r.status, 500);
  });

  it('網路錯誤：回 NETWORK', async () => {
    const fetchImpl = async () => { throw new Error('Failed to fetch'); };
    const r = await listReaderDocuments({ token: 'xyz', location: 'new', fetchImpl });
    assert.strictEqual(r.error, 'NETWORK');
  });

  it('沒 fetchImpl 也沒 global fetch：回 NO_FETCH', async () => {
    const originalFetch = global.fetch;
    delete global.fetch;
    try {
      const r = await listReaderDocuments({ token: 'xyz', location: 'new' });
      assert.strictEqual(r.error, 'NO_FETCH');
    } finally {
      if (originalFetch) global.fetch = originalFetch;
    }
  });

  it('results 非陣列（畸形回應）：回空陣列不炸', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const r = await listReaderDocuments({ token: 'xyz', location: 'new', fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.results, []);
  });
});

describe('reader-api: archiveReaderDocument', () => {
  it('PATCH /v3/update/<id>/ body {location:"archive"} + Authorization Token', async () => {
    const { fetchImpl, calls } = makeFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const r = await archiveReaderDocument({ token: 'xyz', id: '01abc', fetchImpl });
    assert.strictEqual(r.ok, true);
    const [url, opts] = calls[0];
    assert.strictEqual(url, 'https://readwise.io/api/v3/update/01abc/');
    assert.strictEqual(opts.method, 'PATCH');
    assert.strictEqual(opts.headers.Authorization, 'Token xyz');
    assert.strictEqual(opts.headers['Content-Type'], 'application/json');
    assert.deepStrictEqual(JSON.parse(opts.body), { location: 'archive' });
  });

  it('沒 token：回 NO_TOKEN', async () => {
    const { fetchImpl, calls } = makeFetch(() => { throw new Error('nope'); });
    const r = await archiveReaderDocument({ token: '', id: 'x', fetchImpl });
    assert.strictEqual(r.error, 'NO_TOKEN');
    assert.strictEqual(calls.length, 0);
  });

  it('沒 id：回 NO_ID', async () => {
    const { fetchImpl, calls } = makeFetch(() => { throw new Error('nope'); });
    const r = await archiveReaderDocument({ token: 'xyz', id: '', fetchImpl });
    assert.strictEqual(r.error, 'NO_ID');
    assert.strictEqual(calls.length, 0);
  });

  it('401：回 AUTH', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const r = await archiveReaderDocument({ token: 'bad', id: 'x', fetchImpl });
    assert.strictEqual(r.error, 'AUTH');
  });

  it('500：回 HTTP', async () => {
    const { fetchImpl } = makeFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const r = await archiveReaderDocument({ token: 'xyz', id: 'x', fetchImpl });
    assert.strictEqual(r.error, 'HTTP');
  });

  it('網路錯誤：回 NETWORK', async () => {
    const fetchImpl = async () => { throw new Error('Failed to fetch'); };
    const r = await archiveReaderDocument({ token: 'xyz', id: 'x', fetchImpl });
    assert.strictEqual(r.error, 'NETWORK');
  });

  it('id 含特殊字元：encodeURIComponent', async () => {
    const { fetchImpl, calls } = makeFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    await archiveReaderDocument({ token: 'xyz', id: 'a/b c', fetchImpl });
    assert.strictEqual(calls[0][0], 'https://readwise.io/api/v3/update/a%2Fb%20c/');
  });
});
