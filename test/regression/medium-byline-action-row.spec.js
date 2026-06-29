// JRead — Medium 作者列被 action-row 規則誤殺（v1.5.17）
//
// Bug（Jimmy 2026-06-29 真實 medium.com/ddsakura-blog cage probe + 忠實 fixture
// 在真擴充 hide() stack trace 釘出）：進閱讀模式後作者名「ddsakura」消失。
// 真兇＝hideInsideArticleActionRows，非 button-cluster：
//   Medium 把「作者名 + Follow 鈕」包成一層 text < 20 的內 wrapper（子樹無 img，
//   頭像在另一 sibling 分支）。internal wrapper textContent「ddsakuraFollowing」=17
//   觸發 action-row 的 shell short-circuit（繞過「直接子互動比例 < 50% = 內容
//   wrapper」保護），iconCount（Follow button + svg）>= 2 → 整塊被當動作圖示列砍。
//   既有 byline 保護（clusterContainsAuthorProfileLink）只在 button-cluster /
//   sidebar-column 兩條 rule，action-row 漏掛。
//
// 修法：hideInsideArticleActionRows 加同一個 clusterContainsAuthorProfileLink
// 保護（含 /@user 等作者頁連結 → byline 作者列，保留）。Follow 鈕另由
// hideInsideArticleAllButtons / hideInsideArticleByLinkText 個別清，不影響。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE = path.join(__dirname, 'fixtures', 'medium-byline-action-row.html');

describe('cleaner — Medium 作者列不可被 action-row 規則誤殺（v1.5.17）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true,
      url: 'https://medium.com/ddsakura-blog/npx-skills-1da29a86e1eb'
    });
    document = env.document;
    articleEl = document.querySelector('article#story');
    assert.ok(articleEl);
    articleEl.ownerDocument.defaultView.__JRead.cleaner.clean(articleEl);
  });

  it('內層作者列 wrapper（作者名 + Follow）不可被 action-row 整塊砍', () => {
    for (const id of ['bl-inner', 'bl-outer']) {
      const el = document.getElementById(id);
      assert.notStrictEqual(el.dataset.jreadHidden, '1',
        `#${id} 含作者個人頁連結（clusterContainsAuthorProfileLink）→ byline 作者列，不可當 action row 砍`);
    }
  });

  it('作者名「ddsakura」可見（不在任何 hidden 子樹）', () => {
    const author = document.querySelector('#author-link');
    assert.ok(!author.closest('[data-jread-hidden="1"]'),
      '作者名連結不可在 hidden 子樹內（Jimmy 報的作者消失）');
  });

  it('日期 / 閱讀時間 meta 保留', () => {
    for (const id of ['readtime', 'date']) {
      const el = document.getElementById(id);
      assert.ok(!el.closest('[data-jread-hidden="1"]'), `#${id} 不可被誤殺`);
    }
  });

  it('Follow 鈕仍被個別清除（不過度保留）', () => {
    const btn = document.querySelector('#act-btn');
    assert.ok(btn.closest('[data-jread-hidden="1"]') || btn.dataset.jreadHidden === '1',
      'Follow 鈕應由 all-buttons / by-link-text 個別清除（保留的是作者名、不是 Follow 鈕）');
  });

  it('負控制：文末真動作列（無作者連結）仍被 action-row 砍', () => {
    const bar = document.querySelector('#tail-bar');
    assert.strictEqual(bar.dataset.jreadHidden, '1',
      '真動作列（clap/respond/share/more，無 /@user 連結）→ 保護不適用，仍應被砍');
  });

  it('主文段落全保留', () => {
    for (const id of ['p1', 'p2', 'p3']) {
      const p = document.getElementById(id);
      assert.ok(!p.closest('[data-jread-hidden="1"]'), `#${id} 不可被誤殺`);
    }
  });
});
