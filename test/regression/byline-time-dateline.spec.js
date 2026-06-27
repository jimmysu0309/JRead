// JRead — regression: byline/dateline 含 <time> 元素保護（v1.5.6）
//
// 對應 bug：Page Rounds 2026-06-28
//   - dev.to 作者列「Abhijeet Bhale Posted on Jan 6」（頭像+作者+<time>）被
//     hideInsideArticleAuthorBioCards 當 bio 卡砍、作者+日期消失。
//   - bellingcat「April 9, 2026」(<time>) 與分類 taxonomy 連結同 div，被
//     hideInsideArticleHashtagClusters 當 tag bar 砍、發表日期消失。
//
// 修法：兩條規則都加「候選含 <time> → 放行」。<time> 是 HTML5 日期語意標記，
// author bio 卡 / 純 tag bar 合法情況不含，作 byline/dateline 結構訊號穩定（不受
// 日期格式 / 語言影響，補 ARTICLE_META_RE / BYLINE_TEXT_RE 對 CJK/無年日期的漏抓）。
//
// 同時驗保護「有效」+ 沒把規則「關掉」（無 <time> 的純 tag bar / bio 卡仍清）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'byline-time-dateline.html');

describe('cleaner — byline/dateline 含 <time> 保護（v1.5.6）', () => {
  let document;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true,
      url: 'https://dev.to/abhijeet/a-debugging-manifesto/'
    });
    document = env.document;
    // 頭像 rect 需 stub（jsdom 預設 0×0 → bio-card 規則的 avatar 偵測不觸發）
    stubRect(document.querySelector('[data-test="byline-avatar"]'), { top: 100, left: 0, width: 48, height: 48 });
    stubRect(document.querySelector('[data-test="bio-avatar"]'), { top: 900, left: 0, width: 64, height: 64 });
    const articleEl = document.querySelector('[data-test="article-root"]');
    env.window.__JRead.cleaner.clean(articleEl);
  });

  const hidden = sel => document.querySelector(`[data-test="${sel}"]`).dataset.jreadHidden === '1';

  it('(a) dev.to 作者列（頭像+作者+<time>）存活', () => {
    assert.strictEqual(hidden('byline-row'), false,
      '含 <time> 的作者列不可被 author-bio-card 規則誤殺');
  });

  it('(b) bellingcat dateline（<time>+分類連結）存活', () => {
    assert.strictEqual(hidden('dateline-meta'), false,
      '含 <time> 的發表日期 + tag meta 不可被 hashtag-cluster 規則誤殺');
  });

  it('(c) 負控：純 hashtag bar（無 <time>）仍被清', () => {
    assert.strictEqual(hidden('hashtag-bar'), true,
      '無 <time> 的純 tag bar 應照常被 hashtag-cluster 清');
  });

  it('(d) 負控：作者 bio 卡（頭像+bio 散文、無 <time>）仍被清', () => {
    assert.strictEqual(hidden('bio-card'), true,
      '無 <time> 的 author bio 卡應照常被 author-bio-card 清');
  });

  it('(e) 主文段落全保留', () => {
    for (const sel of ['main-1', 'main-2']) {
      assert.strictEqual(hidden(sel), false, `主文 ${sel} 不可被誤殺`);
    }
  });
});
