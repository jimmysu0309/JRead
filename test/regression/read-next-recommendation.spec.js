// JRead — regression: 文中「What to read next」推薦區塊整塊清除（v1.5.6）
//
// 對應 bug：Page Rounds 2026-06-28 space.com 文章**中段**插入「WHAT TO READ
// NEXT」推薦卡片區塊，整塊洩漏進 reader（C2 推薦區塊殘留）。
//   - heading 是 <span>（非 h2），用 flex + after:content 畫左右橫線
//   - 整塊推薦卡片包在 <aside class="clear-both">
//
// 修法：NOISE_HEADING_TEXT_RE 加 `^what\s+to\s+read\s+next$` pattern。span 直接
// 子文字命中後，resolveHeadingNoiseTarget 走 closest('section, aside') 命中
// aside、整塊清除（aside 是 link-feed 容器，isLinkFeedContainer 豁免 tooWide）。
//
// 本 spec 驗「clean() 後 DOM 標記」（jsdom 層，純文字訊號不依賴 rect）；不驗真實
// Chrome 視覺（那層由 /harness-verify RESIDUAL AUDIT + 截圖覆蓋，已實測 pass）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'read-next-recommendation.html');

describe('cleaner — 文中「What to read next」推薦區塊清除（v1.5.6）', () => {
  let document, aside;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    const articleEl = document.querySelector('[data-test="article-root"]');
    assert.ok(articleEl, 'fixture 必須有 article-root');
    env.window.__JRead.cleaner.clean(articleEl);
    aside = document.querySelector('[data-test="read-next-aside"]');
  });

  it('(a) 「What to read next」推薦 aside 被整塊 hide', () => {
    assert.ok(aside, 'read-next-aside 必須存在');
    assert.strictEqual(aside.dataset.jreadHidden, '1',
      '文中 What to read next 推薦區塊應整塊清除（span heading → closest aside）');
    assert.strictEqual(aside.style.getPropertyPriority('display'), 'important',
      'hide() 必須用 inline !important');
  });

  it('(b) aside 前後主文段落全保留', () => {
    for (const sel of ['main-1', 'main-2', 'main-3']) {
      const p = document.querySelector(`[data-test="${sel}"]`);
      assert.ok(p, `${sel} 必須存在`);
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文段落 ${sel} 不可被誤殺（aside 清除不可波及前後正文）`);
    }
  });
});
