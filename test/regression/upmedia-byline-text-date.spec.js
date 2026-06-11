// JRead — narrowPromotedSiblings byline 文字分支（v0.8.48，page rounds 第五輪
// upmedia B 誤殺）
//
// 對應 bug：upmedia.mg 原頁「上報快訊 / 徐瑋璐　2026年04月22日 18:20:00」
// 整列消失。byline 的日期是純文字 SPAN.pub-date（無 <time> tag），
// narrowPromotedSiblings 的 time-tag byline 分支 miss → DIV.publish 被當
// sibling chrome 砍。
//
// 修法：BYLINE_TEXT_RE 補中文年月日 + slash 日期 pattern；narrow 加 byline
// 文字分支（短小 + BYLINE_TEXT_RE 命中 → 保留）。
// 控制組：相關新聞 list sibling（>200 chars）仍被 narrow 清。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'upmedia-byline-text-date.html');

describe('cleaner — narrow byline 文字分支（v0.8.48 upmedia）', () => {
  let window, document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('#news-box');
    const promotedFrom = document.querySelector('#content-root');
    assert.ok(articleEl && promotedFrom);
    window.__JRead.cleaner.clean(articleEl, { promotedFrom });
  });

  it('byline 列（作者 + 純文字中文日期）保留', () => {
    const byline = document.querySelector('#byline-row');
    assert.ok(byline);
    assert.notStrictEqual(byline.dataset.jreadHidden, '1',
      '短小 + BYLINE_TEXT_RE（中文年月日）命中的 sibling 不可被 narrow 砍');
  });

  it('相關新聞 list sibling 仍被清（控制組：>200 chars 不享 byline 保護）', () => {
    const related = document.querySelector('#related-list');
    assert.ok(related);
    assert.strictEqual(related.dataset.jreadHidden, '1');
  });

  it('主文 p 全保留', () => {
    for (const p of document.querySelectorAll('#content-root > p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });
});
