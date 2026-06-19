// JRead — translate-first byline 裸 CJK 前綴詞作者名保護（v0.8.128 theverge）
//
// 對應 bug：theverge.com translate-first 後，英文 byline 前綴 "by" 被翻成
// 「作者」（無冒號 + 空格），作者名 chip（role=button "Andrew Liszewski"）被
// all-buttons 規則清掉——byline 只剩「作者」+ 日期、名字消失。
// 根因：BYLINE_TEXT_RE 的中文 byline pattern `作者[:：]` 強制冒號，翻譯產出的
// 裸「作者 Name」全 miss → isBylineNameChip 找不到 byline 語境 → chip 失保護。
// 修法：新增「行首裸 CJK byline 前綴詞」alternative（作者/撰文/編輯/整理/報導/
// 編譯 後接空白 / 冒號 / 拉丁字母即命中，不強制冒號）。
// 控制組：CTA 字樣 chip（Share）仍被清；正文段保留。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'theverge-translated-byline.html');

describe('cleaner — 翻譯後裸 CJK byline 前綴作者名保護（v0.8.128 theverge）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.querySelector('article#story');
    assert.ok(articleEl);
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('byline 內作者名 chip（「作者」裸前綴語境）保留', () => {
    const chip = document.querySelector('#author-chip');
    assert.ok(chip);
    assert.notStrictEqual(chip.dataset.jreadHidden, '1',
      '翻譯後 byline 開頭「作者 Name」（無冒號）的 role=button 作者名不可被 all-buttons 規則清掉');
  });

  it('byline 區塊本身保留', () => {
    const byline = document.querySelector('#byline-block');
    assert.ok(byline);
    assert.notStrictEqual(byline.dataset.jreadHidden, '1');
  });

  it('byline 內 Share chip（CTA 字樣）仍被清（控制組）', () => {
    const chip = document.querySelector('#share-chip');
    assert.ok(chip);
    assert.strictEqual(chip.dataset.jreadHidden, '1',
      'CTA 字樣 chip 不享作者名豁免');
  });

  it('主文 p 全保留', () => {
    for (const p of document.querySelectorAll('article > p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });
});
