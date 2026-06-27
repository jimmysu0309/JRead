// JRead — regression: 裸 author-page 連結作者署名保護（v1.5.6）
//
// 對應 bug：Page Rounds 2026-06-28 techcrunch 作者名「Anthony Ha」消失。作者署名
// 是裸 author-page 連結（無「By」前綴、無日期 → BYLINE_TEXT_RE 漏抓），被當成：
//   (1) link-dense sidebar widget（hideInsideArticleSidebarColumns 條件 A）
//   (2) 標題前導雜訊（hideInsideArticlePreTitleNoise，byline 位於 h1 之前）
// 兩條規則整塊砍掉作者名。
//
// 修法：兩條規則的 byline guard 都加 clusterContainsAuthorProfileLink——短小元素
// 含 author-page 連結（/author/、/authors/、/@user 等）= byline 作者 chip → 放行。
// 與既有 button-cluster 的 v1.5 byline 保護同源、跨 rule 一致。
//
// 本 spec 同時驗 byline 保護「有效」+ 沒把規則「關掉」（taxonomy link rail 仍清）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'byline-author-chip.html');

describe('cleaner — 裸 author-page 連結 byline 保護（v1.5.6）', () => {
  let document, bylineChip, relatedRail, bodyCol;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true,
      url: 'https://techcrunch.com/2026/05/10/anthropic-evil-portrayals/'
    });
    document = env.document;
    const articleEl = document.querySelector('[data-test="article-root"]');
    assert.ok(articleEl);
    env.window.__JRead.cleaner.clean(articleEl);
    bylineChip = document.querySelector('[data-test="byline-chip"]');
    relatedRail = document.querySelector('[data-test="related-rail"]');
  });

  it('(a) 作者署名 chip（含 author-page 連結）存活', () => {
    assert.ok(bylineChip);
    assert.notStrictEqual(bylineChip.dataset.jreadHidden, '1',
      '裸 author-page 連結作者署名不可被 sidebar-column / pre-title 規則誤殺');
    const a = bylineChip.querySelector('a');
    assert.notStrictEqual(a.closest('[data-jread-hidden="1"]'), bylineChip,
      '作者連結本身不可在已 hide 的祖先內');
  });

  it('(b) 主文段落全保留', () => {
    for (const sel of ['main-1', 'main-2', 'main-3', 'main-4']) {
      const p = document.querySelector(`[data-test="${sel}"]`);
      assert.ok(p, `${sel} 必須存在`);
      assert.notStrictEqual(p.dataset.jreadHidden, '1', `主文段落 ${sel} 不可被誤殺`);
    }
  });

  it('(c) 負控：taxonomy 連結 rail（非 author）仍被清——證明保護沒把規則關掉', () => {
    assert.strictEqual(relatedRail.dataset.jreadHidden, '1',
      '非 author 的 link-dense rail 應照常被清（byline 保護只豁免 author-page 連結）');
  });
});
