// JRead — article-others widget 文末「建議閱讀」相關文章列表（v0.7.208）
//
// Bug：thenewslens.com 文章底部 5 個 multiline-ellipsis 連結（日期 + 相關文章標題
// 列表）殘留在 reader card。每個連結是真實文章標題（非 noise keyword 字樣）、
// 沒有「延伸閱讀」heading 在前，舊 cleaner 機制全部漏接。
//
// 結構（probe 揭穿）：
//   <DIV class="article-others-wrapper item pt-3">     ← 命名清楚的「其他文章」widget
//     <SECTION class="mt-6">
//       <UL class="timeline-items-wrapper">
//         <LI><TIME>日期</TIME><A class="multiline-ellipsis">文章標題</A></LI>
//         ... (5 LI)
//
// 修法：article[-_]?others? 加進 NOISE_KEYWORD_RE 與 STRONG_NOISE_KEYWORD_RE。
// 跟既有 `article-sidebar` / `related-articles` / `more-news` 同家族——CMS
// 慣用「文末其他文章」widget 命名。STRONG 版本確保即使內部有 100+ chars 摘要
// 也跳過 anchor guard 直接 hide。
//
// 通則安全：主文 wrapper 絕不會命名為 article-others / article_others。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'article-others-related.html');

describe('cleaner — article-others widget 文末相關文章列表（v0.7.208 thenewslens）', () => {
  let window, document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('article.article-content');
    assert.ok(articleEl, 'fixture 必須有 article.article-content');
    window.__JRead.cleaner.clean(articleEl);
  });

  it('fixture 結構：article-others-wrapper 內含 5 個 multiline-ellipsis 連結', () => {
    const wrapper = document.querySelector('.article-others-wrapper');
    assert.ok(wrapper, 'fixture 必須有 .article-others-wrapper');
    const links = wrapper.querySelectorAll('a.multiline-ellipsis');
    assert.strictEqual(links.length, 5, 'wrapper 內必須有 5 個 multiline-ellipsis 連結');
  });

  it('.article-others-wrapper 必須命中 NOISE_KEYWORD_RE 被 hide', () => {
    const wrapper = document.querySelector('.article-others-wrapper');
    assert.strictEqual(wrapper.dataset.jreadHidden, '1',
      '.article-others-wrapper 必須被 cleaner hide（命中 article[-_]?others? token）');
  });

  it('文末 5 個相關文章連結都不可見（祖先 wrapper 已 hide）', () => {
    const links = document.querySelectorAll('a.multiline-ellipsis');
    for (const link of links) {
      const hiddenAncestor = link.closest('[data-jread-hidden="1"]');
      assert.ok(hiddenAncestor,
        `multiline-ellipsis 連結「${link.textContent.slice(0, 20)}...」必須有 hidden 祖先`);
    }
  });

  it('主文段落必須保留（cleaner 不可誤殺主文）', () => {
    const mainParas = articleEl.querySelectorAll(':scope > p');
    assert.ok(mainParas.length >= 4, '主文 4 個 p 必須全部保留');
    for (const p of mainParas) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 p「${p.textContent.slice(0, 20)}...」不可被 hide`);
    }
  });
});
