// JRead — 送 Readwise 的 embedly 代理殼 iframe 解包成直連 embed URL（v1.7.3）
//
// Trigger：Jimmy 2026-07-10 回報 medium.com Bonnie Tyler 悼文翻譯後送 Readwise
// Reader，YouTube 播放器全消失。
//
// 根因（cage 真實站 probe + Readwise MCP 讀回 html_content 實證）：Medium 的
// YouTube embed 實際 iframe src 是 `cdn.embedly.com/widgets/media.html?src=
// https%3A%2F%2Fwww.youtube.com%2Fembed%2F<id>...` 代理頁。匯出 payload 內
// 5 個 iframe 全數存活（figure isInPreserved 保護 + whitelist 命中），Readwise
// 也原樣存下——但 Reader 前端只 render 直連 embed host（youtube.com/embed 等），
// 代理殼 iframe 整顆不顯示。
//
// 修法：buildCleanHtml 序列化前呼叫 NS.unwrapEmbedProxyIframes（embedly 殼 →
// 取其 src query param 的直連 embed URL 就地換掉 iframe src）。本 spec 驗該
// 純函式的解包行為（單一資料源 + jsdom 可測）；端到端結果由 harness + Jimmy
// 重送實測驗。
//
// 第二層（同輪第二次實測釘出）：解包成直連 youtube.com/embed 後 Readwise 仍不
// 顯示——Reader 前端對 raw HTML（should_clean_html=false，翻譯頁模式）剝掉所有
// iframe。修法：翻譯頁匯出把影片 embed iframe 換成「可點縮圖 + 標題連結」
// （NS.replaceVideoEmbedsForRawHtml，img / a 是 raw 模式必 render 的基本元素）；
// 非翻譯頁不轉（Readwise clean pipeline 自己會轉內嵌播放器）。
//
// 另註：同輪發現的另一層（lazy embed 未 mount 時送出 → 空殼 placeholder 被
// pruneEmptyHusks 修掉）是站方 JS mount 時機問題，DOM 內無可回收的 embed 資訊、
// 無結構性修法，不在本 spec 範圍。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'readwise-embed-proxy-unwrap.html');
const BASE = 'https://medium.com/three-imaginary-girls/its-a-heartache-rip-bonnie-tyler-3b8b3f82ce0f';

// Medium 實站抓回的 embedly src 形態（query param 順序、oembed 尾綴照實）
const EMBEDLY_SRC = 'https://cdn.embedly.com/widgets/media.html'
  + '?src=https%3A%2F%2Fwww.youtube.com%2Fembed%2FgK-SVR86ThY%3Ffeature%3Doembed'
  + '&display_name=YouTube'
  + '&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DgK-SVR86ThY'
  + '&image=https%3A%2F%2Fi.ytimg.com%2Fvi%2FgK-SVR86ThY%2Fhqdefault.jpg'
  + '&type=text%2Fhtml&schema=youtube';

describe('readwise — NS.unwrapEmbedProxyIframes embedly 代理殼解包 (v1.7.3)', () => {
  let NS, document;
  before(() => {
    const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: [], url: BASE });
    NS = env.NS;
    document = env.document;
    assert.ok(NS && typeof NS.unwrapEmbedProxyIframes === 'function',
      'NS.unwrapEmbedProxyIframes 必須存在（namespace.js 單一資料源）');
  });

  function build(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    NS.unwrapEmbedProxyIframes(div);
    return div;
  }

  it('(A) Medium 實站形態的 embedly 殼 → 解包成 youtube.com/embed 直連 src', () => {
    const div = build(`<figure><div><div><iframe src="${EMBEDLY_SRC.replace(/&/g, '&amp;')}" allowfullscreen frameborder="0" height="480" width="854" title="Bonnie Tyler - Lost In France"></iframe></div></div></figure>`);
    const f = div.querySelector('iframe');
    assert.strictEqual(f.getAttribute('src'),
      'https://www.youtube.com/embed/gK-SVR86ThY?feature=oembed');
    // 其餘屬性不動（尺寸 / title / allowfullscreen 是 Readwise 端 render 依據）
    assert.strictEqual(f.getAttribute('width'), '854');
    assert.strictEqual(f.getAttribute('title'), 'Bonnie Tyler - Lost In France');
    assert.ok(f.hasAttribute('allowfullscreen'));
  });

  it('(B) 非 embedly 的 iframe（youtube 直連 / vimeo / 一般站）→ 原值不動', () => {
    const cases = [
      'https://www.youtube.com/embed/abc123',
      'https://player.vimeo.com/video/12345',
      'https://example.com/widgets/media.html?src=https%3A%2F%2Fevil.test%2Fx'
    ];
    for (const src of cases) {
      const div = build(`<iframe src="${src}"></iframe>`);
      assert.strictEqual(div.querySelector('iframe').getAttribute('src'), src,
        `非 embedly host 不可被解包：${src}`);
    }
  });

  it('(C) embedly host 但非 widgets/media.html 路徑 → 不動', () => {
    const src = 'https://cdn.embedly.com/other/page.html?src=https%3A%2F%2Fwww.youtube.com%2Fembed%2Fx';
    const div = build(`<iframe src="${src}"></iframe>`);
    assert.strictEqual(div.querySelector('iframe').getAttribute('src'), src);
  });

  it('(D) embedly 殼缺 src param（只有 url）→ 保守不動', () => {
    const src = 'https://cdn.embedly.com/widgets/media.html?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dx&schema=youtube';
    const div = build(`<iframe src="${src}"></iframe>`);
    assert.strictEqual(div.querySelector('iframe').getAttribute('src'), src);
  });

  it('(E) src param 非 http(s)（javascript: / data:）→ 拒絕解包', () => {
    for (const inner of ['javascript%3Aalert(1)', 'data%3Atext%2Fhtml%2Cx']) {
      const src = `https://cdn.embedly.com/widgets/media.html?src=${inner}`;
      const div = build(`<iframe src="${src}"></iframe>`);
      assert.strictEqual(div.querySelector('iframe').getAttribute('src'), src,
        `非 http(s) 的 src param 不可寫進 iframe：${inner}`);
    }
  });

  it('(F) hostname 必須全段比對：notembedly.com 這類尾綴仿冒 → 不動', () => {
    const src = 'https://cdn.notembedly.com/widgets/media.html?src=https%3A%2F%2Fwww.youtube.com%2Fembed%2Fx';
    const div = build(`<iframe src="${src}"></iframe>`);
    assert.strictEqual(div.querySelector('iframe').getAttribute('src'), src);
  });

  it('(G) 無 src / 相對 src 的 iframe → 安靜跳過不丟例外', () => {
    const div = build('<iframe></iframe><iframe src="/relative/path"></iframe>');
    assert.strictEqual(div.querySelectorAll('iframe').length, 2);
  });

  it('(H) main.js buildCleanHtml 必須呼叫 NS.unwrapEmbedProxyIframes（forcing function）', () => {
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8');
    assert.match(mainSrc, /unwrapEmbedProxyIframes\(clone\)/,
      'buildCleanHtml 必須對 clone 呼叫 unwrapEmbedProxyIframes');
  });
});

describe('readwise — NS.replaceVideoEmbedsForRawHtml 翻譯頁影片 embed 轉縮圖連結 (v1.7.3)', () => {
  let NS, document;
  before(() => {
    const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: [], url: BASE });
    NS = env.NS;
    document = env.document;
    assert.ok(NS && typeof NS.replaceVideoEmbedsForRawHtml === 'function',
      'NS.replaceVideoEmbedsForRawHtml 必須存在（namespace.js 單一資料源）');
  });

  function build(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    NS.replaceVideoEmbedsForRawHtml(div);
    return div;
  }

  it('(A) youtube.com/embed iframe → 縮圖連結（watch URL + i.ytimg 縮圖 + ▶ 標題）', () => {
    const div = build('<figure><iframe src="https://www.youtube.com/embed/gK-SVR86ThY?feature=oembed" title="Bonnie Tyler - Lost In France"></iframe></figure>');
    assert.strictEqual(div.querySelector('iframe'), null, 'iframe 必須被換掉');
    const a = div.querySelector('figure > a');
    assert.ok(a, '必須產生 figure 內的連結');
    assert.strictEqual(a.getAttribute('href'), 'https://www.youtube.com/watch?v=gK-SVR86ThY');
    assert.strictEqual(a.querySelector('img').getAttribute('src'),
      'https://i.ytimg.com/vi/gK-SVR86ThY/hqdefault.jpg');
    assert.ok(a.textContent.includes('▶ Bonnie Tyler - Lost In France'), '標題文字必須進連結');
  });

  it('(B) 無 title 的 embed → 只有縮圖、alt 用預設文字', () => {
    const div = build('<iframe src="https://www.youtube.com/embed/abc123XYZ"></iframe>');
    const a = div.querySelector('a');
    assert.ok(a);
    assert.strictEqual(a.querySelector('img').getAttribute('alt'), 'YouTube 影片');
    assert.ok(!a.textContent.includes('▶'), '無標題不加標題行');
  });

  it('(C) youtube-nocookie.com 與 youtu.be 形態也轉', () => {
    const div = build('<iframe src="https://www.youtube-nocookie.com/embed/abc123XYZ"></iframe><iframe src="https://youtu.be/def456UVW"></iframe>');
    const hrefs = [...div.querySelectorAll('a')].map(a => a.getAttribute('href'));
    assert.deepStrictEqual(hrefs, [
      'https://www.youtube.com/watch?v=abc123XYZ',
      'https://www.youtube.com/watch?v=def456UVW'
    ]);
  });

  it('(D) 非影片 iframe（spotify / datawrapper / 一般站）→ 不動', () => {
    const cases = [
      'https://open.spotify.com/embed/track/xyz',
      'https://datawrapper.dwcdn.net/abc/1/',
      'https://example.com/embed/notyoutube'
    ];
    for (const src of cases) {
      const div = build(`<iframe src="${src}"></iframe>`);
      assert.ok(div.querySelector('iframe'), `非 YouTube 家族不可轉：${src}`);
      assert.strictEqual(div.querySelector('iframe').getAttribute('src'), src);
    }
  });

  it('(E) 仿冒 host（notyoutube.com / youtube.com.evil.test）→ 不動', () => {
    for (const src of [
      'https://notyoutube.com/embed/abc123XYZ',
      'https://youtube.com.evil.test/embed/abc123XYZ'
    ]) {
      const div = build(`<iframe src="${src}"></iframe>`);
      assert.ok(div.querySelector('iframe'), `仿冒 host 不可轉：${src}`);
    }
  });

  it('(F) 與 unwrapEmbedProxyIframes 組合：embedly 殼 → 直連 → 縮圖連結', () => {
    const div = document.createElement('div');
    div.innerHTML = `<figure><iframe src="${EMBEDLY_SRC.replace(/&/g, '&amp;')}" title="Bonnie Tyler - Lost In France"></iframe></figure>`;
    NS.unwrapEmbedProxyIframes(div);
    NS.replaceVideoEmbedsForRawHtml(div);
    const a = div.querySelector('figure > a');
    assert.ok(a, 'embedly 殼經兩段轉換後必須是縮圖連結');
    assert.strictEqual(a.getAttribute('href'), 'https://www.youtube.com/watch?v=gK-SVR86ThY');
  });

  it('(G) main.js buildCleanHtml 必須以 isTranslated gate 呼叫（forcing function）', () => {
    const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8');
    assert.match(mainSrc, /if \(isTranslated && NS && NS\.replaceVideoEmbedsForRawHtml\) NS\.replaceVideoEmbedsForRawHtml\(clone\)/,
      'buildCleanHtml 必須在 isTranslated 時（且僅在此時）對 clone 呼叫 replaceVideoEmbedsForRawHtml');
    assert.match(mainSrc, /const html = buildCleanHtml\(NS\.state\.articleEl, title, isTranslated\)/,
      'extractReaderPayload 必須把 isTranslated 傳進 buildCleanHtml');
  });
});
