// JRead — Instapaper Full API 高階呼叫 + payload + 讀取端正規化（v1.6.0）
// lib/instapaper.js：buildInstapaperPayload / normalizeInstapaperBookmark /
// saveToInstapaper / listInstapaper / getInstapaperText / archiveInstapaper /
// instapaperXAuth。全走依賴注入（consumerKey/consumerSecret/signImpl/fetchImpl），
// 不需真金鑰。驗端點、header、form body、正規化 shape、錯誤分類。

const path = require('path');
const assert = require('assert');

const IP = require(path.join(__dirname, '..', '..', 'jread', 'lib', 'instapaper.js'));

// 共用注入：固定簽章 + 假金鑰（繞過 getInstapaperConsumerKeys 的 gitignored keys 檔）
const KEYS = { consumerKey: 'ck', consumerSecret: 'cs' };
const SIGN = async () => 'SIG';
function fakeRes({ ok = true, status = 200, json, text } = {}) {
  return {
    ok, status,
    json: async () => { if (json === undefined) throw new Error('no json'); return json; },
    text: async () => (text === undefined ? '' : text)
  };
}

describe('instapaper-api: buildInstapaperPayload', () => {
  it('url 必填、html→content、description trim、空值不帶', () => {
    const p = IP.buildInstapaperPayload({ url: 'https://x.com', html: '<p>hi</p>', title: 'T', description: '  摘要  ' });
    assert.deepStrictEqual(p, { url: 'https://x.com', title: 'T', content: '<p>hi</p>', description: '摘要' });
  });
  it('缺 url 拋錯', () => {
    assert.throws(() => IP.buildInstapaperPayload({ html: 'x' }), /url is required/);
  });
  it('空 description / 空 title 不帶進 payload', () => {
    const p = IP.buildInstapaperPayload({ url: 'https://x.com', title: '', description: '   ' });
    assert.deepStrictEqual(p, { url: 'https://x.com' });
  });
});

describe('instapaper-api: normalizeInstapaperBookmark（→ 共同文件契約）', () => {
  it('bookmark_id→id、url→source_url、time(epoch)→published_date ISO、hostname→site_name', () => {
    const d = IP.normalizeInstapaperBookmark({ bookmark_id: 123, title: 'T', url: 'https://www.example.com/a', time: 1700000000 });
    assert.strictEqual(d.id, '123');
    assert.strictEqual(d.source_url, 'https://www.example.com/a');
    assert.strictEqual(d.site_name, 'example.com');
    assert.strictEqual(d.author, '');       // Instapaper list 無作者
    assert.strictEqual(d.image_url, '');     // Instapaper list 無縮圖
    assert.strictEqual(d.published_date, new Date(1700000000 * 1000).toISOString());
    assert.strictEqual(d.html_content, undefined);
  });
  it('無 title 退回 source_url；無 bookmark_id 回 null', () => {
    assert.strictEqual(IP.normalizeInstapaperBookmark({ bookmark_id: 1, url: 'https://x.com' }).title, 'https://x.com');
    assert.strictEqual(IP.normalizeInstapaperBookmark({ title: 'no id' }), null);
    assert.strictEqual(IP.normalizeInstapaperBookmark(null), null);
  });
});

describe('instapaper-api: saveToInstapaper', () => {
  it('POST bookmarks/add，帶 Authorization + form body，回 ok', async () => {
    let captured = null;
    const fetchImpl = async (url, opts) => { captured = { url, opts }; return fakeRes({ status: 200, json: { bookmark_id: 9 } }); };
    const r = await IP.saveToInstapaper({
      token: 'tok', tokenSecret: 'ts', payload: { url: 'https://x.com', content: '<p>hi</p>' },
      fetchImpl, signImpl: SIGN, ...KEYS, nonce: 'N', timestamp: 1
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(captured.url, IP.INSTAPAPER_ADD_URL);
    assert.strictEqual(captured.opts.method, 'POST');
    assert.match(captured.opts.headers.Authorization, /^OAuth /);
    assert.strictEqual(captured.opts.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.match(captured.opts.body, /url=https%3A%2F%2Fx.com/);
  });
  it('401 → AUTH；缺 token → AUTH；缺 consumer key → CONFIG', async () => {
    const f401 = async () => fakeRes({ ok: false, status: 401 });
    assert.strictEqual((await IP.saveToInstapaper({ token: 't', tokenSecret: 's', payload: { url: 'https://x.com' }, fetchImpl: f401, signImpl: SIGN, ...KEYS })).error, 'AUTH');
    assert.strictEqual((await IP.saveToInstapaper({ token: '', tokenSecret: '', payload: { url: 'https://x.com' }, fetchImpl: f401, signImpl: SIGN, ...KEYS })).error, 'AUTH');
    // 不帶 consumerKey 且無 keys 檔 → CONFIG
    assert.strictEqual((await IP.saveToInstapaper({ token: 't', tokenSecret: 's', payload: { url: 'https://x.com' }, fetchImpl: f401, signImpl: SIGN })).error, 'CONFIG');
  });
});

describe('instapaper-api: listInstapaper（→ results 正規化）', () => {
  it('過濾 type!=bookmark、映射成共同 shape', async () => {
    let captured = null;
    const arr = [
      { type: 'meta' },
      { type: 'user', user_id: 1 },
      { type: 'bookmark', bookmark_id: 1, title: 'A', url: 'https://a.com/x', time: 1700000000 },
      { type: 'bookmark', bookmark_id: 2, title: 'B', url: 'https://b.com/y', time: 1700000001 }
    ];
    const fetchImpl = async (url, opts) => { captured = { url, opts }; return fakeRes({ status: 200, json: arr }); };
    const r = await IP.listInstapaper({ token: 't', tokenSecret: 's', folderId: 'unread', limit: 20, fetchImpl, signImpl: SIGN, ...KEYS });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.results.length, 2, '只取 type=bookmark');
    assert.strictEqual(r.results[0].id, '1');
    assert.strictEqual(r.results[1].source_url, 'https://b.com/y');
    assert.strictEqual(captured.url, IP.INSTAPAPER_LIST_URL);
    assert.match(captured.opts.body, /folder_id=unread/);
    assert.match(captured.opts.body, /limit=20/);
  });
  it('非陣列回應 → results 空清單', async () => {
    const r = await IP.listInstapaper({ token: 't', tokenSecret: 's', fetchImpl: async () => fakeRes({ json: { error: 'x' } }), signImpl: SIGN, ...KEYS });
    assert.deepStrictEqual(r.results, []);
  });
});

describe('instapaper-api: getInstapaperText', () => {
  it('POST get_text，回文章 HTML body', async () => {
    let captured = null;
    const fetchImpl = async (url, opts) => { captured = { url, opts }; return fakeRes({ status: 200, text: '<div>full</div>' }); };
    const r = await IP.getInstapaperText({ token: 't', tokenSecret: 's', id: '42', fetchImpl, signImpl: SIGN, ...KEYS });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.html, '<div>full</div>');
    assert.strictEqual(captured.url, IP.INSTAPAPER_GET_TEXT_URL);
    assert.match(captured.opts.body, /bookmark_id=42/);
  });
  it('缺 id → NO_ID', async () => {
    const r = await IP.getInstapaperText({ token: 't', tokenSecret: 's', fetchImpl: async () => fakeRes({}), signImpl: SIGN, ...KEYS });
    assert.strictEqual(r.error, 'NO_ID');
  });
});

describe('instapaper-api: archiveInstapaper', () => {
  it('POST bookmarks/archive，200 → ok', async () => {
    let captured = null;
    const fetchImpl = async (url, opts) => { captured = { url, opts }; return fakeRes({ status: 200, json: [] }); };
    const r = await IP.archiveInstapaper({ token: 't', tokenSecret: 's', id: '7', fetchImpl, signImpl: SIGN, ...KEYS });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(captured.url, IP.INSTAPAPER_ARCHIVE_URL);
    assert.match(captured.opts.body, /bookmark_id=7/);
  });
});

describe('instapaper-api: instapaperXAuth', () => {
  it('email+密碼 → token/tokenSecret', async () => {
    let captured = null;
    const fetchImpl = async (url, opts) => { captured = { url, opts }; return fakeRes({ status: 200, text: 'oauth_token=TOK&oauth_token_secret=SEC' }); };
    const r = await IP.instapaperXAuth({ email: 'a@b.c', password: 'pw', fetchImpl, signImpl: SIGN, ...KEYS });
    assert.deepStrictEqual({ ok: r.ok, token: r.token, tokenSecret: r.tokenSecret }, { ok: true, token: 'TOK', tokenSecret: 'SEC' });
    assert.strictEqual(captured.url, IP.INSTAPAPER_ACCESS_TOKEN_URL);
    assert.match(captured.opts.body, /x_auth_mode=client_auth/);
  });
  it('401 → AUTH；缺帳密 → AUTH；缺 consumer key → CONFIG', async () => {
    assert.strictEqual((await IP.instapaperXAuth({ email: 'a', password: 'p', fetchImpl: async () => fakeRes({ ok: false, status: 401 }), signImpl: SIGN, ...KEYS })).error, 'AUTH');
    assert.strictEqual((await IP.instapaperXAuth({ email: '', password: '', fetchImpl: async () => fakeRes({}), signImpl: SIGN, ...KEYS })).error, 'AUTH');
    assert.strictEqual((await IP.instapaperXAuth({ email: 'a', password: 'p', fetchImpl: async () => fakeRes({}), signImpl: SIGN })).error, 'CONFIG');
  });
});
