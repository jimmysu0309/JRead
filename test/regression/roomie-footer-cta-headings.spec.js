// JRead — 文末 subscribe / follow CTA heading 清除 regression（v0.8.4）
//
// 對應 bug（Jimmy 2026-06-09 回報 roomie.tw/posts/73403 文末殘留）：
//   - H5「訂閱 every little d.電子報，看更多生活細節」
//   - H3「現在就追蹤 Roomie IG，看更多來自室友們的生活觀察」
//
// 根因：
//   1. hideInsideArticleByHeadingText 的 semanticHeadings 只掃 h2-h4 → H5 漏掃
//   2. 兩者 textContent 21-40 字超過 NOISE_HEADING_MAX_LEN(20)、EXT regex 原本
//      無「訂閱…電子報 / 現在就追蹤 / 追蹤…看更多」CTA pattern → 兩條 max_len
//      皆不命中
//
// 修法：
//   - semanticHeadings 加 h5/h6（hide 仍由 NOISE regex 把關）
//   - NOISE_HEADING_TEXT_EXT_RE 加 subscribe/follow CTA pattern（max_len 40 內）
//
// forcing function：
//   - 兩個 CTA heading 必須被 hide
//   - 真副標 H5「帶我去世界的盡頭」+ 主文長 p 必須保留（h5/h6 進掃不誤殺）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'roomie-footer-cta-headings.html');

describe('cleaner — 文末 subscribe / follow CTA heading 清除（v0.8.4）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.querySelector('main');
    articleEl.setAttribute('data-jread-active', '1');
    env.NS.cleaner.clean(articleEl, []);
  });

  function isHidden(el) {
    return !!(el && el.closest('[data-jread-hidden="1"]'));
  }

  it('雜訊 H5「訂閱…電子報，看更多」必須被 hide', () => {
    const h = document.querySelector('h5.noise-subscribe');
    assert.ok(h, 'fixture 應有 noise-subscribe H5');
    assert.ok(isHidden(h), '訂閱 CTA H5 必須被 hide');
  });

  it('雜訊 H3「現在就追蹤 X，看更多」必須被 hide', () => {
    const h = document.querySelector('h3.noise-follow');
    assert.ok(h, 'fixture 應有 noise-follow H3');
    assert.ok(isHidden(h), '追蹤 CTA H3 必須被 hide');
  });

  it('真副標 H5「帶我去世界的盡頭」不可被誤殺', () => {
    const h = document.querySelector('h5.real-subhead');
    assert.ok(h, 'fixture 應有 real-subhead H5');
    assert.ok(!isHidden(h),
      'h5/h6 進掃後，不含雜訊詞的真副標仍須保留（NOISE regex 把關）');
  });

  it('主文長 p 必須完整保留', () => {
    let visible = 0;
    for (const p of articleEl.querySelectorAll('p')) {
      if (p.textContent.replace(/\s+/g, '').length >= 50 && !isHidden(p)) visible++;
    }
    assert.ok(visible >= 2, `主文長 p 應保留 >= 2 段，實際 ${visible}`);
  });
});
