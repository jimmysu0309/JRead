// JRead — noise heading 尾段清除 × div 段落站（v1.7.39 全面 review C2）
// -----------------------------------------------------------------------------
// 對應 fixture：test/regression/fixtures/heading-noise-tail-div-paragraph.html
//
// Bug（2026-08-05 全面 review 批次 1，真 Chromium probe 實證）：
// hideHeadingNoiseTail 的 before-check 與 after-check（hasMainContent）都只認
// <p>。div 段落站（cn.nytimes / archive 改寫頁 / upmedia 型，段落是 <div>
// direct text）的中段 noise heading 為 articleEl 直接子時：
// findSafeWrapperForHeading 回 null → tail path → tailApplies 直接成立 →
// hasMainContent 對 div 段落恆 false → heading 之後所有 sibling（後半篇正文）
// 一路 hide 到文末。v0.8.133 The Verge 截斷 bug（漏「自身是 <p>」）的 div 變體。
//
// 修法：siblingHasMainContent 統一判定——自身長 <p>、自身 direct text 長
// <div>（v0.7.190 同款訊號）、或內含長段（hasLongMainParagraph，已含 p +
// div direct text 雙軌）。before-check / after-check 共用同一判定保持對稱。
//
// 訊號層次：jsdom 驗 hide 標記；真實站視覺由 /harness-verify 驗。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'heading-noise-tail-div-paragraph.html');

describe('cleaner — noise heading 尾段 × div 段落站 (v1.7.39)', () => {
  let document;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner']
    });
    document = env.document;
    const articleEl = document.querySelector('article#art');
    assert.ok(articleEl);
    env.window.__JRead.cleaner.clean(articleEl);
  });

  const byTest = (t) => document.querySelector(`[data-test="${t}"]`);

  it('中段 noise heading（延伸閱讀）本身被 hide', () => {
    assert.strictEqual(byTest('noise-h-mid').dataset.jreadHidden, '1');
  });

  it('heading 之後的 div 段落不可被藏（div direct text >= 100 視為主文）', () => {
    assert.notStrictEqual(byTest('p3').dataset.jreadHidden, '1',
      'div 段落站的後半篇正文不可被當 widget 掃掉（v0.8.133 的 div 變體）');
    assert.notStrictEqual(byTest('p4').dataset.jreadHidden, '1');
  });

  it('heading 之前的 div 段落保留', () => {
    assert.notStrictEqual(byTest('p1').dataset.jreadHidden, '1');
    assert.notStrictEqual(byTest('p2').dataset.jreadHidden, '1');
  });

  it('文末 noise heading + 純連結 widget 仍藏到文末（尾段語意不退化）', () => {
    assert.strictEqual(byTest('noise-h-end').dataset.jreadHidden, '1');
    assert.strictEqual(byTest('end-widget').dataset.jreadHidden, '1',
      '文末整段 widget（無後續主文）必須照舊藏到底');
  });
});
