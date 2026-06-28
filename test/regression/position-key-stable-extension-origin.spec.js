// JRead — regression spec: 位置記憶 key 對擴充自有頁去揮發性 origin（v1.5.11）
//
// 根因（2026-06-28 模擬器實證）：iOS Safari 的擴充自有頁 origin
// `safari-web-extension://<UUID>/` 每次 Safari 重啟換一組新 UUID
// （terminate→relaunch base URL 由 2F7E8BA1… 變 F78F88DC…）。JReader Article
// View 在 `safari-web-extension://<UUID>/reader/article.html?id=<docId>`，
// 舊版 spaRouteKey 用完整 href（含揮發 UUID）當位置記憶 key → 強制關閉重開後
// 同一篇變新 key、上次存的記錄變孤兒（磁碟筆數沒少、但 key 對不上 → found=否
// → 回第 1 頁）。修法：對擴充自有頁 scheme 去掉 origin、用 path+search(+hash)
// 當穩定身分（docId 在 search、跨 UUID 不變）；http(s) origin 保留（區分站點）。
//
// 訊號層次（本 spec 驗 X、不驗 Y）：
//   驗：spaRouteKey 的純邏輯（同 path 不同 UUID → 同 key、http origin 保留、
//       hash-router 保留、錨點 hash 剝除）+ spaRouteKey 確實呼叫
//       stripVolatileExtensionOrigin（wiring 不可被移除）。
//   不驗：iOS 真機 origin rotation 本身（平台行為，模擬器已實證）、強關後實際
//       回到正確頁碼（端到端需真機 / TestFlight）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MAIN_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8');

// 從 source 抽出兩個純函式 eval（node 有 global URL，函式只依賴它）
function loadSpaRouteKey() {
  const m1 = MAIN_SRC.match(/function stripVolatileExtensionOrigin[\s\S]*?\n  \}/);
  const m2 = MAIN_SRC.match(/function spaRouteKey[\s\S]*?\n  \}/);
  assert.ok(m1, 'main.js 必須有 stripVolatileExtensionOrigin');
  assert.ok(m2, 'main.js 必須有 spaRouteKey');
  // eslint-disable-next-line no-new-func
  return new Function(m1[0] + '\n' + m2[0] + '\nreturn spaRouteKey;')();
}

describe('position key — 擴充自有頁去揮發性 origin（v1.5.11 iOS UUID rotation 修法）', () => {
  const spaRouteKey = loadSpaRouteKey();

  it('同一篇 Article View 不同 safari-web-extension UUID → 同一把 key', () => {
    const a = 'safari-web-extension://2F7E8BA1-AAF1-4DC6-8492-A62D74A0CDE6/reader/article.html?id=01kw3rdq86';
    const b = 'safari-web-extension://F78F88DC-35A1-43FF-9E91-366312FC0F5C/reader/article.html?id=01kw3rdq86';
    assert.strictEqual(spaRouteKey(a), spaRouteKey(b),
      'UUID host 揮發、同篇 docId 必須對到同一把 key（否則重啟後記錄變孤兒）');
    assert.strictEqual(spaRouteKey(a), '/reader/article.html?id=01kw3rdq86',
      'key = path+search（去掉 origin）');
  });

  it('不同 docId → 不同 key（不可全部塌成同一把）', () => {
    const a = 'safari-web-extension://2F7E8BA1-AAF1-4DC6-8492-A62D74A0CDE6/reader/article.html?id=AAA';
    const b = 'safari-web-extension://2F7E8BA1-AAF1-4DC6-8492-A62D74A0CDE6/reader/article.html?id=BBB';
    assert.notStrictEqual(spaRouteKey(a), spaRouteKey(b));
  });

  it('chrome-extension / moz-extension 同樣去 origin（跨瀏覽器一致）', () => {
    assert.strictEqual(
      spaRouteKey('chrome-extension://abcdefghijklmnop/reader/article.html?id=X'),
      '/reader/article.html?id=X');
    assert.strictEqual(
      spaRouteKey('moz-extension://11111111-2222/reader/article.html?id=X'),
      '/reader/article.html?id=X');
  });

  it('http(s) 一般網頁 origin 必須保留（不同站點不可撞 key）', () => {
    const a = 'https://a.example.com/article/1';
    const b = 'https://b.example.com/article/1';
    assert.strictEqual(spaRouteKey(a), a, 'http origin 保留原樣');
    assert.notStrictEqual(spaRouteKey(a), spaRouteKey(b), '不同網域不可塌成同 key');
  });

  it('既有 hash 規則不變：hash-router 保留、錨點 hash 剝除', () => {
    // 擴充頁去 origin 後 hash 規則照舊套用
    assert.strictEqual(
      spaRouteKey('safari-web-extension://U/reader/x.html#/route'),
      '/reader/x.html#/route', 'hash-router(#/) 保留');
    assert.strictEqual(
      spaRouteKey('https://site.com/a#footnote'),
      'https://site.com/a', '錨點 hash 剝除（一般網頁）');
    assert.strictEqual(
      spaRouteKey('https://site.com/a#/route'),
      'https://site.com/a#/route', 'hash-router(#/) 保留（一般網頁）');
  });

  it('spaRouteKey 必須呼叫 stripVolatileExtensionOrigin（wiring 不可被移除）', () => {
    const body = MAIN_SRC.match(/function spaRouteKey[\s\S]*?\n  \}/)[0];
    assert.ok(/stripVolatileExtensionOrigin\(href\)/.test(body),
      'spaRouteKey 開頭必須先過 stripVolatileExtensionOrigin（去揮發 origin）');
    assert.ok(/safari-web-extension:/.test(MAIN_SRC),
      'stripVolatileExtensionOrigin 必須涵蓋 safari-web-extension: scheme');
  });
});
