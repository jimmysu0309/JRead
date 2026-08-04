// JRead — 翻譯後「句子裡嵌多個連結」的內文段落被 sidebar-column 條件 C 誤殺（v1.7.38）
//
// 對應 bug（Jimmy 2026-08-04 回報）：
//   https://www.theverge.com/tech/967544/best-apps-gadgets-reading-installer
// Shinkansen 翻譯後進閱讀模式，文首第二段（作者列舉本週看了什麼、句子裡嵌 10 個
// 連結）整段消失。cage instrument（hide() 記 stack 進 data attr）實證兇手 =
// hideInsideArticleSidebarColumns。
//
// 根因：條件 C（main >= sibling × 3 + sibling ld > 0.5 + sibling textLen >= 200）
// 的前提是「兩欄 layout 的側欄」，但 theverge 文章 body 是 33 個扁平 block 的
// 垂直流，main 只是最長的那個 block（1035 chars），與該段（304 chars）根本不是
// 主欄 / 側欄關係。翻譯前 ld 0.34 不觸發；翻成中文後散文字數壓到 ~40%、錨文字
// （專有名詞）維持拉丁字母幾乎不縮 → ld 0.53 越線。
//
// 修法：條件 A / C 共用 sidebarSiblingIsProse guard——sibling 內存在「非連結長句」
// （某元素 direct text node 累計 >= 50 chars，沿用既有 subtreeHasLongNonAnchorText）
// ＝ 內文散文，不是 link widget cluster。widget（錨文字佔滿全文、錨間只有分隔符）
// 不受影響，本 spec 的 widget-block 斷言守住這條界線。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'theverge-translated-inline-link-paragraph.html');

describe('cleaner — 翻譯後內文散文段落不可被 sidebar-column 條件 C 誤殺（v1.7.38）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.querySelector('article');
    assert.ok(articleEl);
    env.window.__JRead.cleaner.clean(articleEl);
  });

  const norm = s => (s || '').replace(/\s+/g, ' ').trim();

  function isHiddenWithin(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function stat(el) {
    const text = norm(el.textContent);
    let linkLen = 0;
    for (const a of el.querySelectorAll('a')) linkLen += norm(a.textContent).length;
    return { textLen: text.length, ld: text.length ? linkLen / text.length : 0 };
  }

  it('fixture 結構：散文段落 block 滿足條件 C 三條件（main × 3 + ld > 0.5 + len >= 200）', () => {
    const main = stat(document.querySelector('[data-test="main-block"]'));
    const prose = stat(document.querySelector('[data-test="prose-block"]'));
    assert.ok(main.textLen >= 500, `main textLen >= 500（實測 ${main.textLen}）`);
    assert.ok(main.textLen >= prose.textLen * 3,
      `main >= prose × 3（實測 ${main.textLen} vs ${prose.textLen}）`);
    assert.ok(prose.ld > 0.5, `prose block linkDensity > 0.5（實測 ${prose.ld.toFixed(3)}）`);
    assert.ok(prose.textLen >= 200, `prose block textLen >= 200（實測 ${prose.textLen}）`);
  });

  it('內文散文段落（句子裡嵌連結）必須保留（核心保護點）', () => {
    const prose = document.querySelector('[data-test="prose-block"]');
    assert.ok(!isHiddenWithin(prose),
      '段落內存在非連結長句（句子中嵌連結）＝ 內文散文，不是 link widget cluster，' +
      '必須被 sidebarSiblingIsProse guard 保護不被條件 C 誤殺');
  });

  it('真雜訊推薦連結 widget 仍須被 hide（guard 不可過度保護）', () => {
    const widget = document.querySelector('[data-test="widget-block"]');
    const w = stat(widget);
    assert.ok(w.ld > 0.5 && w.textLen >= 200,
      `widget block 同樣滿足條件 C 的 ld / textLen（實測 ld ${w.ld.toFixed(3)}、len ${w.textLen}）`);
    assert.ok(isHiddenWithin(widget),
      'widget 錨文字佔滿全文、錨間只有分隔符、無非連結長句 → guard 不放行，須照砍');
  });

  it('主文 block 保留（main 不可被誤殺）', () => {
    const main = document.querySelector('[data-test="main-block"]');
    assert.notStrictEqual(main.dataset.jreadHidden, '1');
  });
});
