// JRead — tag[-_]?list keyword hide（v0.7.185）
//
// 對應 bug：ctee.com.tw 標題下方 div.taglist 內含 hashtag 連結殘留。
// hashtag 的 # 由 CSS ::before 加、a.textContent 不含 #，
// hideInsideArticleHashtagClusters（要求 startsWith('#')）漏掉。
// div.taglist 的 class 也不在 NOISE_KEYWORD_RE 裡。
//
// 修法：tag[-_]?list 加入 NOISE_KEYWORD_RE，由 keyword rule 命中 hide。
// CMS 慣例：taglist / tag-list / tag_list 是文章標籤列表的通用命名。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'ctee-taglist-before-pseudo.html');

describe('cleaner — div.taglist（CSS ::before #）被 keyword rule hide（v0.7.185）', () => {
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
    articleEl = document.querySelector('main.main-container');
    assert.ok(articleEl, 'fixture 必須有 main.main-container');
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  it('div.taglist 被 hide（核心驗證：tag[-_]?list keyword 命中）', () => {
    const taglist = document.querySelector('div.taglist');
    assert.ok(taglist);
    assert.strictEqual(taglist.dataset.jreadHidden, '1',
      'div.taglist 命中 NOISE_KEYWORD_RE 的 tag[-_]?list 必須被 hide');
  });

  it('h1 主標題保留', () => {
    const h1 = document.querySelector('h1.main-title');
    assert.ok(h1);
    assert.notStrictEqual(h1.dataset.jreadHidden, '1');
  });

  it('主文 article 內 p 保留', () => {
    const paras = document.querySelectorAll('article p');
    assert.ok(paras.length >= 3);
    for (const p of paras) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 p 不可被 hide: "${p.textContent.slice(0, 30)}…"`);
    }
  });

  it('figcaption 保留', () => {
    const fc = document.querySelector('figcaption');
    assert.ok(fc);
    assert.notStrictEqual(fc.dataset.jreadHidden, '1');
  });

  it('news-credit（作者/日期）保留', () => {
    const credit = document.querySelector('ul.news-credit');
    assert.ok(credit);
    assert.notStrictEqual(credit.dataset.jreadHidden, '1');
  });
});
