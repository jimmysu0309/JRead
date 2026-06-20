// JRead — Miniflux 兩字中文標題被最小長度門檻誤殺 regression（v0.8.142）
//
// 對應 bug：Miniflux「微光」entry 進入閱讀模式後主文標題整個消失
// （Jimmy 2026-06-20 回報 /unread/category/2/entry/2018）。
//
// 根因：v0.8.141 已把門檻改 titleTextWeight（CJK 字權重 2、門檻維持 5），但
// 2 字中文標題「微光」= weight 4 仍 < 5 被擋 → promoteUniqueTitleH1Into 不
// promote → reader card 內無標題。
//
// 修法：CJK 字權重 2 → 3——2 字標題「微光」= weight 6 過關；單一 CJK 字
// （weight 3）仍被擋，保留單字 site-logo junk 防線。拉丁行為不變。
//
// 本 spec 是 forcing function（比 4 字版更緊的下界）：
//   - title clone 必須存在且含「微光」
//   - 把 CJK 權重改回 2 → 微光 weight 4 < 5 → 無 clone → spec fail

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'miniflux-short-cjk-title-2char.html');

describe('cleaner — Miniflux 兩字中文標題（「微光」）仍被 promote 進 reader card（v0.8.142）', () => {
  let document, articleEl, hidden;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.querySelector('article.entry-content');
    hidden = [];
    env.window.__JRead.cleaner.clean(articleEl, hidden);
  });

  it('title clone 必須存在（2 字中文標題仍被 promote）', () => {
    const clone = articleEl.querySelector('[data-jread-title-clone="1"]');
    assert.ok(clone, '2 字中文標題「微光」應仍被 promote 進 reader card，不可被最小長度門檻誤殺');
    assert.ok(clone.textContent.includes('微光'),
      `title clone 應含主標題「微光」，實際: "${clone.textContent.trim().slice(0, 40)}"`);
  });

  it('title clone 不可帶入 entry-actions / byline chrome', () => {
    const clone = articleEl.querySelector('[data-jread-title-clone="1"]');
    const txt = clone ? clone.textContent : '';
    for (const label of ['標記為未讀', '昨天', 'Take', 'take.surf']) {
      assert.ok(!txt.includes(label),
        `title clone 不應含 chrome 文字「${label}」，實際: "${txt.replace(/\s+/g, ' ').trim().slice(0, 60)}"`);
    }
  });

  it('主文段落完整保留', () => {
    let visible = 0;
    for (const p of articleEl.querySelectorAll(':scope > p')) {
      if (p.getAttribute('data-jread-hidden') !== '1') visible++;
    }
    assert.ok(visible >= 4, `entry-content 內應有 >= 4 個 visible <p>，實際 ${visible}`);
  });
});
