// JRead — 儲存服務二擇一 dispatcher（v1.6.0）
// popup-core.js：resolveServiceCredentials / sendDocument / listDocuments /
// getArticle / archiveDocument / saveResultToast。驗「service 二值 × 各 dispatcher
// 路由到正確底層」——readwise 走既有 saveToReadwise/listReaderDocuments（不回歸）、
// instapaper 走注入的 __JReadInstapaper mock。全走依賴注入，不需真金鑰 / 網路。

const path = require('path');
const assert = require('assert');

const PC = require(path.join(__dirname, '..', '..', 'jread', 'popup', 'popup-core.js'));

function fakeRes({ ok = true, status = 200, json, text } = {}) {
  return {
    ok, status,
    json: async () => (json === undefined ? {} : json),
    text: async () => (text === undefined ? '' : text)
  };
}

// Instapaper mock：記錄每個呼叫的參數，回可控結果
function makeInstapaperMock() {
  const calls = {};
  return {
    calls,
    buildInstapaperPayload: ({ url, html, title, description }) => {
      calls.build = { url, html, title, description };
      return { url, content: html, title, description };
    },
    saveToInstapaper: async (a) => { calls.save = a; return { ok: true, status: 200 }; },
    listInstapaper: async (a) => { calls.list = a; return { ok: true, results: [{ id: 'i1' }], nextPageCursor: null }; },
    getInstapaperText: async (a) => { calls.getText = a; return { ok: true, html: '<div>ip</div>' }; },
    archiveInstapaper: async (a) => { calls.archive = a; return { ok: true, status: 200 }; }
  };
}

describe('dispatch: resolveServiceCredentials', () => {
  it('readwise：creds={token}、ok 依 readwiseToken', () => {
    assert.deepStrictEqual(PC.resolveServiceCredentials({ storageService: 'readwise', readwiseToken: 'RW' }),
      { service: 'readwise', creds: { token: 'RW' }, ok: true });
    assert.strictEqual(PC.resolveServiceCredentials({ storageService: 'readwise', readwiseToken: '' }).ok, false);
  });
  it('instapaper：creds={token,tokenSecret}、ok 需兩者齊備', () => {
    assert.deepStrictEqual(PC.resolveServiceCredentials({ storageService: 'instapaper', instapaperToken: 'T', instapaperTokenSecret: 'S' }),
      { service: 'instapaper', creds: { token: 'T', tokenSecret: 'S' }, ok: true });
    assert.strictEqual(PC.resolveServiceCredentials({ storageService: 'instapaper', instapaperToken: 'T', instapaperTokenSecret: '' }).ok, false);
  });
  it('未知 / 未設 storageService → 預設 readwise', () => {
    assert.strictEqual(PC.resolveServiceCredentials({}).service, 'readwise');
    assert.strictEqual(PC.resolveServiceCredentials({ storageService: 'xxx' }).service, 'readwise');
  });
});

describe('dispatch: sendDocument 路由', () => {
  it('readwise → POST readwise.io/api/v3/save/（既有 saveToReadwise，不回歸）', async () => {
    let url = null;
    const fetchImpl = async (u) => { url = u; return fakeRes({ status: 201, text: '{}' }); };
    const r = await PC.sendDocument({ service: 'readwise', creds: { token: 'RW' }, payload: { url: 'https://x.com', html: '<p>a</p>' }, fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(url, PC.READWISE_API_URL);
  });
  it('instapaper → buildInstapaperPayload(description=summary) + saveToInstapaper', async () => {
    const ip = makeInstapaperMock();
    const r = await PC.sendDocument({
      service: 'instapaper', creds: { token: 'T', tokenSecret: 'S' },
      payload: { url: 'https://x.com', html: '<p>a</p>', title: 'Ti', summary: 'SUM' },
      instapaper: ip
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(ip.calls.build.description, 'SUM', 'summary 對映 Instapaper description');
    assert.strictEqual(ip.calls.build.html, '<p>a</p>');
    assert.strictEqual(ip.calls.save.token, 'T');
    assert.strictEqual(ip.calls.save.tokenSecret, 'S');
  });
  it('缺憑證 → NO_CREDENTIALS；instapaper 無 client → CONFIG', async () => {
    assert.strictEqual((await PC.sendDocument({ service: 'readwise', creds: { token: '' }, payload: { url: 'https://x.com' } })).error, 'NO_CREDENTIALS');
    assert.strictEqual((await PC.sendDocument({ service: 'instapaper', creds: { token: '', tokenSecret: '' }, payload: { url: 'https://x.com' }, instapaper: makeInstapaperMock() })).error, 'NO_CREDENTIALS');
    assert.strictEqual((await PC.sendDocument({ service: 'instapaper', creds: { token: 'T', tokenSecret: 'S' }, payload: { url: 'https://x.com' }, instapaper: null })).error, 'CONFIG');
  });
});

describe('dispatch: listDocuments 路由', () => {
  it('readwise → listReaderDocuments（query location/tag 展開）', async () => {
    let url = null;
    const fetchImpl = async (u) => { url = u; return fakeRes({ status: 200, json: { results: [{ id: 'r1' }] } }); };
    const r = await PC.listDocuments({ service: 'readwise', creds: { token: 'RW' }, query: { location: 'new' }, fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.match(url, /\/api\/v3\/list\/\?location=new/);
  });
  it('instapaper → listInstapaper（query folderId）', async () => {
    const ip = makeInstapaperMock();
    const r = await PC.listDocuments({ service: 'instapaper', creds: { token: 'T', tokenSecret: 'S' }, query: { folderId: 'starred' }, instapaper: ip });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(ip.calls.list.folderId, 'starred');
    assert.strictEqual(ip.calls.list.token, 'T');
  });
});

describe('dispatch: getArticle 路由', () => {
  it('readwise → list?id&withHtmlContent，取 results[0]', async () => {
    let url = null;
    const fetchImpl = async (u) => { url = u; return fakeRes({ status: 200, json: { results: [{ id: 'r1', html_content: '<p>rw</p>' }] } }); };
    const r = await PC.getArticle({ service: 'readwise', creds: { token: 'RW' }, id: 'r1', fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.doc.html_content, '<p>rw</p>');
    assert.match(url, /withHtmlContent=true/);
  });
  it('instapaper → get_text，metadata 用 meta 補', async () => {
    const ip = makeInstapaperMock();
    const meta = { title: 'MT', author: 'MA', site_name: 'ms.com', published_date: '2026-01-01', source_url: 'https://s.com' };
    const r = await PC.getArticle({ service: 'instapaper', creds: { token: 'T', tokenSecret: 'S' }, id: 'i9', meta, instapaper: ip });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.doc.html_content, '<div>ip</div>');
    assert.strictEqual(r.doc.title, 'MT');
    assert.strictEqual(r.doc.author, 'MA');
    assert.strictEqual(ip.calls.getText.id, 'i9');
  });
  it('readwise 無 html_content → EMPTY', async () => {
    const fetchImpl = async () => fakeRes({ status: 200, json: { results: [{ id: 'r1' }] } });
    assert.strictEqual((await PC.getArticle({ service: 'readwise', creds: { token: 'RW' }, id: 'r1', fetchImpl })).error, 'EMPTY');
  });
});

describe('dispatch: archiveDocument 路由', () => {
  it('readwise → PATCH update location:archive', async () => {
    let opts = null;
    const fetchImpl = async (u, o) => { opts = o; return fakeRes({ status: 200 }); };
    const r = await PC.archiveDocument({ service: 'readwise', creds: { token: 'RW' }, id: 'r1', fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(opts.method, 'PATCH');
    assert.match(opts.body, /archive/);
  });
  it('instapaper → archiveInstapaper', async () => {
    const ip = makeInstapaperMock();
    const r = await PC.archiveDocument({ service: 'instapaper', creds: { token: 'T', tokenSecret: 'S' }, id: 'i1', instapaper: ip });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(ip.calls.archive.id, 'i1');
  });
});

describe('dispatch: saveResultToast（服務感知）', () => {
  it('readwise 200=已存在、201=已送到；existsOn200 控制', () => {
    assert.deepStrictEqual(PC.saveResultToast({ ok: true, status: 200 }, { serviceLabel: 'Readwise Reader', existsOn200: true }),
      { message: '已存在於 Readwise Reader', kind: 'success' });
    assert.deepStrictEqual(PC.saveResultToast({ ok: true, status: 201 }, { serviceLabel: 'Readwise Reader', existsOn200: true }),
      { message: '已送到 Readwise Reader', kind: 'success' });
  });
  it('instapaper 一律「已送到」（existsOn200 false）', () => {
    assert.deepStrictEqual(PC.saveResultToast({ ok: true, status: 200 }, { serviceLabel: 'Instapaper', existsOn200: false }),
      { message: '已送到 Instapaper', kind: 'success' });
  });
  it('錯誤分類：NO_CREDENTIALS / CONFIG / AUTH / NETWORK', () => {
    assert.match(PC.saveResultToast({ ok: false, error: 'NO_CREDENTIALS' }, { serviceLabel: 'Instapaper' }).message, /尚未設定 Instapaper 憑證/);
    assert.match(PC.saveResultToast({ ok: false, error: 'CONFIG' }, { serviceLabel: 'Instapaper' }).message, /未內建 Instapaper 金鑰/);
    assert.match(PC.saveResultToast({ ok: false, error: 'AUTH' }, { serviceLabel: 'Instapaper' }).message, /Instapaper 憑證無效/);
    assert.match(PC.saveResultToast({ ok: false, error: 'NETWORK' }, {}).message, /網路錯誤/);
  });
  // v1.7.43 T1：popup 軌與快速鍵 toast 軌收斂到同一份 saveResultToast
  it('credsPlace 參數：預設「設定頁」、popup 軌可指「進階設定」', () => {
    assert.match(PC.saveResultToast({ ok: false, error: 'NO_CREDENTIALS' }, {}).message, /請到設定頁填入/);
    assert.match(
      PC.saveResultToast({ ok: false, error: 'NO_CREDENTIALS' }, { credsPlace: '「進階設定」' }).message,
      /請到「進階設定」填入/);
  });
  it('generic 分支：無 HTTP status 時帶 error code、有 status 時帶 HTTP 碼', () => {
    assert.strictEqual(PC.saveResultToast({ ok: false, error: 'INVALID_PAYLOAD' }, {}).message, '送出失敗（INVALID_PAYLOAD）');
    assert.strictEqual(PC.saveResultToast({ ok: false, status: 500, detail: 'boom' }, {}).message, '送出失敗（HTTP 500）：boom');
  });
  // forcing：popup.js 不得再手寫送出結果文案（v1.7.43 前雙實作已 drift 過——
  // 「進階設定」vs「設定頁」、'ok'/'err' vs 'success'/'error' 兩套 kind）
  it('popup.js 送出結果文案不得繞過 saveResultToast 手寫', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../jread/popup/popup.js'), 'utf8');
    assert.ok(src.includes('saveResultToast('), 'popup.js 應呼叫 saveResultToast');
    assert.ok(!src.includes('尚未設定 ${label} 憑證'), 'NO_CREDENTIALS 文案不得手寫');
    assert.ok(!src.includes('已存在於 ${label}'), '成功文案不得手寫');
    const sw = fs.readFileSync(path.join(__dirname, '../../jread/background/service-worker.js'), 'utf8');
    assert.ok(!sw.includes('尚未設定 ${label} 憑證'), 'SW 的 NO_CREDENTIALS 文案不得手寫');
  });
});
