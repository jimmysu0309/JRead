// JRead — 圖片式廣告 banner（strong keyword 內容圖連結）清除 regression spec（v0.8.112）
//
// 根因（2026-06-18 Jimmy 回報 womany.net article/2823 文末殘留塔羅 app banner）：
// banner 是 `<a class="related-block" href="/redirects/23222?ref=wa-all">` 包一張
// 608px 促銷圖（文字烤進圖片、a 無文字）。`related-block` 原本不在 related 雜訊 token
// 的 suffix list（articles/news/posts/stories/content），且即使命中、`anchorIsContentImageLink`
// 對 608px 圖回 true → 被當 lightbox 大圖豁免 → 殘留。
//
// 通則修法（結構性、不綁站點）：(1) related token suffix 補 `block`（CMS「相關/推薦
// 內容區塊」通用命名，boundary 後置不誤中 related-blockquote）；(2) strong keyword
// （related / sponsored / 品牌 widget）命中時不套內容圖豁免——正當內容照片的 lightbox
// 連結絕不會命名 related/sponsored。weak keyword（popup 等）內容圖連結仍受豁免保護。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'promo-image-link-banner.html');

function stubNatural(img, w, h) {
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
}

describe('cleaner — 圖片式廣告 banner（strong keyword 內容圖連結，v0.8.112）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.querySelector('article#story');
    assert.ok(articleEl);
    // 三張圖都 stub 成內容尺寸（>= 200×100）→ anchorIsContentImageLink 對三者皆 true
    stubNatural(document.getElementById('content-img'), 600, 400);
    stubNatural(document.getElementById('weak-img'), 600, 400);
    stubNatural(document.getElementById('promo-img'), 608, 304);
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('related-block 促銷 banner 被 hide（strong keyword 跳過內容圖豁免）', () => {
    const banner = document.getElementById('promo-banner');
    assert.strictEqual(banner.dataset.jreadHidden, '1',
      '圖片式廣告 banner（related-block + 608px 圖）必須被 hide');
  });

  it('正當 lightbox 內容圖連結（無 keyword class）保留', () => {
    const link = document.getElementById('lightbox-link');
    assert.notStrictEqual(link.dataset.jreadHidden, '1',
      'photoswipe lightbox 連結不可被誤殺（無雜訊 keyword）');
  });

  it('weak keyword（popup）內容圖連結仍受豁免保護', () => {
    const link = document.getElementById('weak-keyword-link');
    assert.notStrictEqual(link.dataset.jreadHidden, '1',
      'weak keyword（image-popup）的內容圖 lightbox 連結維持豁免、不被誤殺');
  });
});
