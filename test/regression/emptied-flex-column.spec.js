// JRead — regression spec: flex-row 殘殼欄 hide (v0.8.45 theverge 窄欄)
// -----------------------------------------------------------------------------
// theverge 實測：flex 兩欄的推薦 rail 在 clean 當下有完整內容（instrument
// 2123 chars，sidebar 各條件不命中），之後內部被其他 rule 清空剩 54 chars
// 殘殼——wrapper 仍 visible、flexGrow:1 占走 50% 寬，主文壓到卡片 42%
// （body-width-narrow 21/21 段）。
// hideEmptiedFlexColumns（跑在所有 hide 規則後、collapse 前）：flex-row 內
// 非主欄 + 可見文字 < 100 + 含被 jread hide 的後代 + 無大媒體 → hide。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'emptied-flex-column.html');

describe('cleaner — flex-row 殘殼欄 hide（v0.8.45）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.getElementById('post');
    articleEl.setAttribute('data-jread-active', '1');
    env.NS.cleaner.clean(articleEl, []);
  });

  function isHidden(el) {
    return !!(el && el.closest('[data-jread-hidden="1"]'));
  }

  it('內部推薦區被清空後，殘殼 rail 欄整個必須被 hide', () => {
    const rail = document.querySelector('.side-rail');
    assert.ok(rail, 'fixture 應有 side-rail');
    const inner = document.querySelector('.recommended-articles');
    assert.ok(isHidden(inner), '前置條件：推薦區（recommended token）必須先被 keyword rule 清掉');
    assert.ok(isHidden(rail), '殘殼 rail（可見文字 < 100 + 含 hidden 後代）必須被 hide，flexGrow 才不會占走主欄寬度');
  });

  it('主欄與主文段落必須完整保留', () => {
    const body = document.querySelector('.entry-body');
    assert.ok(!isHidden(body), '主欄不可被誤殺');
    let visible = 0;
    for (const p of body.querySelectorAll('p')) {
      if (!isHidden(p)) visible++;
    }
    assert.strictEqual(visible, 6, '主文六段全保留');
  });
});
