// JRead — Substack 文末訂閱 widget 含長 preamble p 不得因 anchor guard 豁免（v1.6.31）
//
// 對應 bug（Jimmy 2026-07-09 culpium.com/p/what-sk-hynixs-ipo-prospectus-doesnt
// 回報「頁面尾端有許多雜訊」）：文末 `subscription-widget-wrap` 內 `preamble > p`
// 是 113 chars 招攬文案（「Join Fortune 500 CEOs, … Subscribe now.」）→ 觸發
// wrapperContainsMainContentP 的「>= 100 chars 單一 p」guard。bare `subscription`
// 是 weak token，keyword rule 命中卻被 anchor guard 誤豁免 → 訂閱 widget 殘留。
//
// 根因：subscription / subscribe 原本不在 STRONG_NOISE_KEYWORD_RE——anchor guard
// 只對 non-strong keyword 生效。與 related-news / more-news（v0.7.184）、discuss
// （v1.6.17）家族同因：widget 內招攬 / 摘要 p 過長，anchor guard 誤以為主文 wrapper。
//
// 修法：subscription[-_]?widget 加入 STRONG set。「subscription widget」定義上就是
// 訂閱元件、絕非主文容器，safe to force-hide 即使內含長 p。非 hostname / 單站 class
// 特判（任何 subscription-widget 命名的站都清）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'culpium-subscription-widget.html');

describe('cleaner — subscription-widget 含長 preamble p 不得因 anchor guard 豁免（v1.6.31）', () => {
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
    articleEl = document.getElementById('art');
    assert.ok(articleEl, 'fixture 必須有 #art');
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  it('fixture 結構：preamble p >= 100 chars（觸發 anchor guard 前提）', () => {
    const subp = document.getElementById('subp');
    assert.ok(subp, 'fixture 必須含 preamble p');
    assert.ok(subp.textContent.trim().length >= 100,
      'preamble p 必須 >= 100 chars（重現 wrapperContainsMainContentP 豁免條件）');
  });

  it('subscription-widget-wrap 必須被 hide（核心：strong keyword 跳過 anchor guard）', () => {
    const wrap = document.getElementById('subwrap');
    assert.strictEqual(wrap.dataset.jreadHidden, '1',
      'subscription-widget-wrap 命中 STRONG_NOISE_KEYWORD_RE 後必須跳過 wrapperContainsMainContentP guard 直接 hide');
  });

  it('主文段落 b1 / b2 / b3 全部保留', () => {
    for (const id of ['b1', 'b2', 'b3']) {
      assert.notStrictEqual(document.getElementById(id).dataset.jreadHidden, '1',
        `主文段 ${id} 不可被 hide`);
    }
  });

  it('可逆：restore 後 wrap 的 inline display + jreadHidden 標記還原', () => {
    const wrap = document.getElementById('subwrap');
    assert.strictEqual(wrap.style.display, 'none');
    window.__JRead.cleaner.restore(hidden);
    assert.notStrictEqual(wrap.dataset.jreadHidden, '1', 'restore 後 jreadHidden 標記應清除');
    assert.notStrictEqual(wrap.style.display, 'none', 'restore 後 display 不應殘留 none');
  });
});
