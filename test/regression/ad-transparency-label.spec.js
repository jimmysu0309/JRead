// JRead — 「為什麼會看到廣告」ad-transparency label（v0.8.48，page rounds
// 第五輪 vocus C4）
//
// 對應 bug：vocus.cc 廣告本體清掉後，hash class SPAN 殘留「為什麼會看到廣告❓」
// label 置中卡在段落間。class 無語意（emotion hash），僅 direct text 可辨識。
//
// 修法：NOISE_INLINE_AD_TEXT_RE 新增「為什麼(會)看到(這則)廣告」alternation
// （Facebook / Google / vocus 通用 ad-transparency 句式）。
// 控制組：主文段落句中含同字樣（非開頭 + 超過 40 chars）不誤殺。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'ad-transparency-label.html');

describe('cleaner — ad-transparency label（v0.8.48 vocus）', () => {
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
    articleEl = document.querySelector('article#story');
    assert.ok(articleEl);
    window.__JRead.cleaner.clean(articleEl);
  });

  it('「為什麼會看到廣告」label span 被 hide', () => {
    const label = document.querySelector('#transparency-label');
    assert.ok(label);
    assert.strictEqual(label.dataset.jreadHidden, '1');
  });

  it('句中含同字樣的主文段落保留', () => {
    const p = document.querySelector('#legit-para');
    assert.ok(p);
    assert.notStrictEqual(p.dataset.jreadHidden, '1',
      '主文段落句中提及「為什麼會看到廣告」不可被誤殺');
  });

  it('其餘主文 p 全保留', () => {
    for (const p of document.querySelectorAll('article#story > p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });
});
