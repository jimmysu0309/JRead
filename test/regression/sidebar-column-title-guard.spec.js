// JRead — hideInsideArticleSidebarColumns 對含 canonical title 的 sibling 保護
// （v0.7.142）
//
// 對應 bug：substack reader hub `https://substack.com/home/post/p-188798414`
// reader mode 開啟後標題仍消失（Jimmy 2026-05-19 二次回報，v0.7.140 button-text
// guard 修法後 hideInsideArticleByHeadingText 已擋掉 Subscribe span 走 walk-up
// fallback hide wrapper，但**另一條 rule hideInsideArticleSidebarColumns 仍命中**：
//
//   - main wrapper = 主文 content（textLen=2074、linkDensity 接近 0）
//   - sibling wrapper = 標題 wrapper（textLen=51、linkDensity=0.61 含 subscribe
//     button / share / avatar links / publication link 等）
//   - 條件 A: sibling.textLen 51 < main × 10% 207 AND linkDensity 0.61 > 0.5
//   - → hide 整個標題 wrapper（含 page-wide unique title link 與 byline）
//
// 修法：cleaner hideInsideArticleSidebarColumns 對 sibling 加 canonical title
// guard——sibling 內含 element 的 direct text **strict equals** og:title /
// document.title 第一段（split `[|｜\-—–]`）→ 視為文章 header 區、skip hide。
//
// 通則性：「sibling 含 page-wide canonical title 字串」是「該 sibling 是文章
// header wrapper」最強訊號，跨站適用、不綁 substack hostname / class。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'sidebar-column-title-wrapper-misclassify.html');

describe('cleaner — hideInsideArticleSidebarColumns 不可砍含 canonical title 的 sibling（v0.7.142）', () => {
  let window, document, articleEl, hidden;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('article');
    assert.ok(articleEl);
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  it('fixture 結構：title-wrapper textLen << main × 10% + linkDensity > 0.5（觸發 sidebar-column 條件 A）', () => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const titleWrapper = document.querySelector('[data-test="title-wrapper"]');
    const contentWrapper = document.querySelector('[data-test="content-wrapper"]');
    const titleText = norm(titleWrapper.textContent);
    let titleLink = 0;
    for (const a of titleWrapper.querySelectorAll('a')) titleLink += norm(a.textContent).length;
    const contentText = norm(contentWrapper.textContent);
    assert.ok(contentText.length >= 500, 'content textLen >= MIN_MAIN_TEXT 500');
    assert.ok(titleText.length < contentText.length * 0.1, 'title textLen < main × 10%');
    assert.ok(titleLink / titleText.length > 0.5, 'title linkDensity > 0.5');
  });

  it('title-wrapper（含 canonical title link）不可被 hideInsideArticleSidebarColumns hide（v0.7.142 核心保護點）', () => {
    const titleWrapper = document.querySelector('[data-test="title-wrapper"]');
    assert.notStrictEqual(titleWrapper.dataset.jreadHidden, '1',
      'sibling 內含 textContent strict equals og:title 的 element（本 fixture <a data-test="title-link">），' +
      '必須被 canonical-title guard 保護不被 sidebar-column rule hide。' +
      '否則 substack 等「無 article tag / 標題 a + 主文 content 並列為 direct children」站點主標題消失。');
  });

  it('title-link <a> 自己未被 hide', () => {
    const titleLink = document.querySelector('[data-test="title-link"]');
    assert.notStrictEqual(titleLink.dataset.jreadHidden, '1');
  });

  it('主文 content-wrapper 保留（main 不可被誤殺）', () => {
    const content = document.querySelector('[data-test="content-wrapper"]');
    assert.notStrictEqual(content.dataset.jreadHidden, '1');
  });
});
