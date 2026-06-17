// JRead — 送 Readwise 的圖片相對 URL 未轉絕對 → 破圖（v0.8.76）
//
// Trigger：Jimmy 2026-06-15 回報 0xkato.xyz/how-llms-actually-work 送到 Readwise
// Reader 後文章內圖片全破（broken image icon）。
//
// 根因：buildCleanHtml 送 Readwise 的是 `clone.outerHTML`——序列化的是 img 的
// src「屬性原值」（這站是根相對 `/assets/transformer-pipeline.png`），而非瀏覽器
// 解析後的絕對 URL。Readwise 伺服器端收到相對 URL 無原站 base 可解析 → 破圖。
// 多數站用絕對 CDN 網址故一直正常，相對路徑站（Ghost `/assets/...`）才現形；
// hero image 走 extractHeroImage 早有 new URL 轉法、body 圖片這條漏網。
//
// 修法：buildCleanHtml 序列化前呼叫 NS.absolutizeResourceUrls（媒體載體 src /
// poster / srcset 以 location.href 為 base 轉絕對）。本 spec 驗該純函式的轉換
// 行為（單一資料源 + jsdom 可測）；真實送出 outerHTML 含絕對 URL 的端到端結果
// 由 harness 驗。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'readwise-absolutize-img-url.html');
const BASE = 'https://www.0xkato.xyz/how-llms-actually-work/';

describe('readwise — NS.absolutizeResourceUrls 圖片相對 URL 轉絕對 (v0.8.76)', () => {
  let NS, document;
  before(() => {
    const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: [], url: BASE });
    NS = env.NS;
    document = env.document;
    assert.ok(NS && typeof NS.absolutizeResourceUrls === 'function',
      'NS.absolutizeResourceUrls 必須存在（namespace.js 單一資料源）');
  });

  function build(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    NS.absolutizeResourceUrls(div, BASE);
    return div;
  }

  it('NS.absolutizeResourceUrls 必須存在', () => {
    assert.strictEqual(typeof NS.absolutizeResourceUrls, 'function');
  });

  it('(A) 根相對 img src（/assets/x.png）→ 絕對 URL', () => {
    const div = build('<p><img src="/assets/transformer-pipeline.png"></p>');
    assert.strictEqual(div.querySelector('img').getAttribute('src'),
      'https://www.0xkato.xyz/assets/transformer-pipeline.png');
  });

  it('(B) 文件相對 img src（x.png）→ 以當前頁路徑為 base 解析', () => {
    const div = build('<img src="pic.png">');
    assert.strictEqual(div.querySelector('img').getAttribute('src'),
      'https://www.0xkato.xyz/how-llms-actually-work/pic.png');
  });

  it('(C) 已是絕對 URL → 原值不變', () => {
    const div = build('<img src="https://cdn.example.com/a.jpg">');
    assert.strictEqual(div.querySelector('img').getAttribute('src'),
      'https://cdn.example.com/a.jpg');
  });

  it('(D) srcset 多 candidate：只轉 URL 段、保留 descriptor（1x/2x/640w）', () => {
    const div = build('<img srcset="/a.png 1x, /b.png 2x, /c.png 640w">');
    assert.strictEqual(div.querySelector('img').getAttribute('srcset'),
      'https://www.0xkato.xyz/a.png 1x, https://www.0xkato.xyz/b.png 2x, https://www.0xkato.xyz/c.png 640w');
  });

  it('(E) <picture><source srcset> 與 video poster 一併轉', () => {
    const div = build('<picture><source srcset="/s.webp"><img src="/s.png"></picture><video poster="/v.jpg" src="/v.mp4"></video>');
    assert.strictEqual(div.querySelector('source').getAttribute('srcset'), 'https://www.0xkato.xyz/s.webp');
    assert.strictEqual(div.querySelector('video').getAttribute('poster'), 'https://www.0xkato.xyz/v.jpg');
    assert.strictEqual(div.querySelector('video').getAttribute('src'), 'https://www.0xkato.xyz/v.mp4');
  });

  it('(F) data: URL 不誤改（new URL 回原值）', () => {
    const data = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    const div = build(`<img src="${data}">`);
    assert.strictEqual(div.querySelector('img').getAttribute('src'), data);
  });

  it('(G) main.js buildCleanHtml 必須呼叫 NS.absolutizeResourceUrls（forcing function）', () => {
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8');
    assert.match(mainSrc, /absolutizeResourceUrls\(clone,\s*location\.href\)/,
      'buildCleanHtml 必須對 clone 以 location.href 為 base 呼叫 absolutizeResourceUrls');
  });

  // v0.8.96：Condé Nast / Cloudinary URL 含字面逗號（`w_2240,c_limit`）。
  // naive split(',') 會把一個 URL 從中剖兩段，後半 `c_limit/x.jpg` 再被當相對
  // 路徑以頁面 base 解析成破 URL（GQ Taiwan hero 圖送 Readwise 全破）。
  it('(H) srcset URL 含字面逗號（Condé Nast w_,c_limit）→ 不剖破、逗號保留在 URL 內', () => {
    const ss = 'https://media.gq.com.tw/photos/abc/16:9/w_120,c_limit/img.jpg 120w, '
             + 'https://media.gq.com.tw/photos/abc/16:9/w_240,c_limit/img.jpg 240w';
    const div = build(`<picture><source srcset="${ss}"><img src="/x.jpg"></picture>`);
    assert.strictEqual(div.querySelector('source').getAttribute('srcset'),
      'https://media.gq.com.tw/photos/abc/16:9/w_120,c_limit/img.jpg 120w, '
      + 'https://media.gq.com.tw/photos/abc/16:9/w_240,c_limit/img.jpg 240w');
  });

  it('(I) parseSrcset 直接驗：含逗號 URL 不剖破、descriptor 正確分離', () => {
    assert.ok(typeof NS.parseSrcset === 'function', 'NS.parseSrcset 必須存在（單一資料源）');
    const ss = 'https://cdn/x/w_120,c_limit/a.jpg 120w, https://cdn/x/w_240,c_limit/a.jpg 240w';
    const cands = JSON.parse(JSON.stringify(NS.parseSrcset(ss)));
    assert.deepStrictEqual(cands, [
      { url: 'https://cdn/x/w_120,c_limit/a.jpg', desc: '120w' },
      { url: 'https://cdn/x/w_240,c_limit/a.jpg', desc: '240w' }
    ]);
  });

  it('(J) parseSrcset：無 descriptor 的 URL（含 URL 尾端逗號分隔）', () => {
    const cands = JSON.parse(JSON.stringify(NS.parseSrcset("https://cdn/a.jpg, https://cdn/b.jpg 2x")));
    assert.deepStrictEqual(cands, [
      { url: 'https://cdn/a.jpg', desc: '' },
      { url: 'https://cdn/b.jpg', desc: '2x' }
    ]);
  });
});
