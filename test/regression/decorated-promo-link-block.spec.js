// JRead — regression spec: 裝飾框推廣連結群清除 (v0.8.46 tvbs)
// -----------------------------------------------------------------------------
// Jimmy 2026-06-11 cage 回報 tvbs 文末殘留：「◤黴菌毒素與日常健康◢」裝飾框
// heading + 「👉」前綴推廣連結段。結構（probe 實證）：P 群在
// DIV.widely_declared wrapper 內，class 是站方自家命名不可綁。
// 通則（文字 heuristic）：NOISE_HEADING_TEXT_RE 加
//   ^◤.+◢$ —— 全形裝飾框包裹的推廣 heading（台灣新聞站編輯慣例）
//   ^(?:👉|►|▶|➤|⏩)+$ —— direct text 只剩指標 emoji 的段落（連結文字在
//     子 <a> 內、不進 direct text）
// 內文句中的 ◤ 符號討論或「點這裡👉看詳情」指路寫法不命中（非錨定全句）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'decorated-promo-link-block.html');

describe('cleaner — 裝飾框推廣連結群清除（v0.8.46）', () => {
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

  it('「◤...◢」裝飾框推廣 heading 必須被 hide', () => {
    assert.ok(isHidden(document.querySelector('.promo-head-1')), '◤黴菌毒素與日常健康◢ 必須被清');
    assert.ok(isHidden(document.querySelector('.promo-head-2')), '◤飯店住宿券免費抽◢ 必須被清');
  });

  it('「👉」前綴推廣連結段必須被 hide', () => {
    for (const cls of ['promo-link-1', 'promo-link-2', 'promo-link-3']) {
      assert.ok(isHidden(document.querySelector('.' + cls)), `${cls}（👉 指標段）必須被清`);
    }
  });

  it('內文段落（含句中 ◤ 符號與 👉 指路寫法）不可被誤殺', () => {
    let visible = 0;
    for (const p of articleEl.querySelectorAll('p')) {
      if (p.closest('.widely_declared')) continue;
      if (!isHidden(p)) visible++;
    }
    assert.strictEqual(visible, 3, '三段主文（含收尾段的符號討論）全保留');
  });
});
