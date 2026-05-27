// JRead — regression spec: TVBS comment-panel false positive（text-ratio guard, v0.7.201）
//
// Trigger: TVBS news.tvbs.com.tw 進閱讀模式後整頁空白。
// Root cause: hideInsideArticleCommentPanels 把唯一子元素 DIV.article_new 當
// 留言面板 hide。原因：
//   1. 後代「相關報導」區含 3+ 相對時間戳命中 RELATIVE_TIME_RE
//   2. 所有 <p> 都很短（< 300 chars / < 4 個 >= 50 chars）→ layer 1/2 guard 不觸發
//   3. 整個 article 內容消失
//
// 修法：text-ratio guard（layer 0）——候選元素文字量 > article 總文字 50% 就跳過。
// 留言面板是子區塊，不可能佔 article 多數內容。
//
// 3 條 forcing function：
//   (a) DIV.article_new 未被 hide（text-ratio guard 生效）
//   (b) 主文 <p> 內容保留（article 非空白）
//   (c) sanity forcing: fixture 確實觸發 RELATIVE_TIME_RE（3+ 時間戳存在）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'tvbs-comment-panel-false-positive.html');

// 與 cleaner.js 內部 RELATIVE_TIME_RE 相同
const RELATIVE_TIME_RE = /\d+\s*(分鐘前|小時前|天前|週前|個月前|年前|hours?\s*ago|minutes?\s*ago|days?\s*ago|weeks?\s*ago)/g;

describe('cleaner — TVBS comment-panel false positive（text-ratio guard）', () => {
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
    articleEl = document.querySelector('article');
    assert.ok(articleEl, 'fixture 須含 <article>');
    window.__JRead.cleaner.clean(articleEl);
  });

  it('(a) DIV.article_new 未被 hide（text-ratio guard 保護）', () => {
    const articleMain = document.getElementById('article-main');
    assert.ok(articleMain, 'fixture 須含 #article-main (DIV.article_new)');
    assert.notStrictEqual(articleMain.dataset.jreadHidden, '1',
      'DIV.article_new 佔 article 全部內容（text ratio > 50%），' +
      '不該被 hideInsideArticleCommentPanels hide；' +
      '拿掉 text-ratio guard → 此 assertion fail');
  });

  it('(b) 主文 <p> 內容保留（article 非空白）', () => {
    const items = ['item-1', 'item-2', 'item-3'];
    for (const id of items) {
      const p = document.getElementById(id);
      assert.ok(p, `fixture 須含 #${id}`);
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `#${id} 是主文內容，不該被 hide`);
      // 確認祖先鏈無 hidden（避免整棵子樹被砍）
      let parent = p.parentElement;
      while (parent) {
        assert.notStrictEqual(parent.dataset.jreadHidden, '1',
          `#${id} 祖先 ${parent.tagName}#${parent.id || ''} 不該 hide`);
        parent = parent.parentElement;
      }
    }
  });

  it('(c) sanity forcing: fixture 確實含 3+ 相對時間戳（觸發 RELATIVE_TIME_RE）', () => {
    const articleMain = document.getElementById('article-main');
    const text = articleMain.textContent || '';
    const matches = text.match(RELATIVE_TIME_RE);
    assert.ok(matches && matches.length >= 3,
      `fixture 必須含 >= 3 個相對時間戳以觸發 comment-panel 偵測；` +
      `實際命中 ${matches ? matches.length : 0} 個`);
  });
});
