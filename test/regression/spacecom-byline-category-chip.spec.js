// JRead — byline 起首分類 chip 去除（v1.0.17 space.com）
//
// 對應回報：Jimmy 2026-06-26「News 這種分類示意請去掉」。space.com byline
// 起首有一個連到 /news 版塊頁的「News」chip，排在 "By 作者" 前綴之前。byline-social
// wrapper 整支已由 keywordWrapperIsByline 保護（v1.0.16），但 chip 對閱讀是分類
// 示意雜訊。
// 修法 hideBylineCategoryChips：byline wrapper（class/id 帶 byline/dateline token）
// 內、文字排在 author prefix（by/作者…）之前、且短（<= CATEGORY_LABEL_MAX_LEN）的
// <a> = 版塊 eyebrow → hide。author 連結排在 prefix 之後不受影響。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'spacecom-byline-category-chip.html');

describe('cleaner — byline 起首分類 chip 去除（v1.0.17 space.com）', () => {
  let document;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    document = env.document;
    const articleEl = document.querySelector('article#story');
    assert.ok(articleEl);
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('byline 起首的「News」分類 chip 被隱藏', () => {
    const chip = document.querySelector('#section-chip');
    assert.ok(chip);
    assert.strictEqual(chip.dataset.jreadHidden, '1',
      '排在 "By" 前綴之前的短版塊連結 chip 應被當分類示意雜訊清除');
  });

  it('byline-social wrapper 整支不被 hide（v1.0.16 保護不回歸）', () => {
    const wrapper = document.querySelector('#byline-social');
    assert.ok(wrapper);
    assert.notStrictEqual(wrapper.dataset.jreadHidden, '1');
  });

  it('作者連結 + 日期文字保留（排在 prefix 之後不被當 chip 誤殺）', () => {
    const author = document.querySelector('#author-chip');
    assert.ok(author);
    assert.notStrictEqual(author.dataset.jreadHidden, '1',
      '"By" 之後的作者連結不可被分類 chip 規則誤殺');
    assert.ok(!author.closest('[data-jread-hidden="1"]'),
      '作者連結不可被任何隱藏祖先吃掉');
    const bylineText = document.querySelector('#byline-text');
    assert.ok(!bylineText.closest('[data-jread-hidden="1"]'),
      '作者 + 日期文字列保留');
  });

  it('主文段落保留', () => {
    for (const p of document.querySelectorAll('article > p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });
});
