// JRead — regression spec: 內文裝飾性大寫 / 加寬字距中和（v1.6.23 wired.com）
// -----------------------------------------------------------------------------
// Bug（Jimmy 2026-07-08 回報）：wired.com 翻譯後首段字距忽大忽小、「根本不是
// 靠左對齊」。probe 實證：站方對首段套整段 lead-in 裝飾 span
// （text-transform: uppercase + letter-spacing: 1.5px，class lead-in-text-callout），
// 閱讀模式沿用原站 CSS → 英文名字全大寫、字距拉開；疊上 CJK justify（v1.6.12）
// 後大寫長名字不可斷行，justify 把剩餘空間攤給整行字距 → 空隙爆炸。
//
// 修法（結構性通則，styler.js markDecorativeInlines）：內文段落載體與其 inline
// 後代 computed 命中 uppercase / font-variant-caps 非 normal / letter-spacing
// >= 0.05em 任一 → data-jread-decor-reset="1"，注入 CSS 重設回一般。
//
// 訊號層次：本檔驗「標記演算法選到哪些元素 + selector 進入注入 CSS + 還原」；
// 真實 Chrome 視覺（justify 空隙是否收斂）由 /harness-verify 驗。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'decor-reset-inline.html');
const ATTR = 'data-jread-decor-reset';

describe('styler — 內文裝飾性大寫 / 加寬字距中和（v1.6.23）', () => {
  let window, document, articleEl, snap;

  beforeEach(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['styler'],
      viewport: { width: 390, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    articleEl = document.getElementById('post');
    assert.ok(articleEl, 'fixture 應有 #post');
    snap = window.__JRead.styler.apply(articleEl, {
      theme: 'light', fontSize: 18, contentWidth: 720,
      fontFamily: '', lineHeight: 1.7
    });
  });

  it('uppercase + 裝飾級 letter-spacing 的 lead-in span 必須標記（wired 型）', () => {
    assert.strictEqual(document.getElementById('span-lead').getAttribute(ATTR), '1');
  });

  it('載體本身被設 uppercase 時載體必須標記', () => {
    assert.strictEqual(document.getElementById('p-carrier-caps').getAttribute(ATTR), '1');
  });

  it('small-caps（font-variant-caps）同家族裝飾必須標記', () => {
    assert.strictEqual(document.getElementById('span-smallcaps').getAttribute(ATTR), '1');
  });

  it('裝飾級 letter-spacing（>= 0.05em）無 uppercase 也必須標記', () => {
    assert.strictEqual(document.getElementById('span-ls').getAttribute(ATTR), '1');
  });

  it('正文微調級 letter-spacing（< 0.05em）不可標記', () => {
    assert.ok(!document.getElementById('span-fine').hasAttribute(ATTR),
      '0.1px/16px ≈ 0.006em 是易讀性微調，不可誤殺');
  });

  it('無裝飾的普通段落與 inline 不可標記', () => {
    assert.ok(!document.getElementById('p-plain').hasAttribute(ATTR));
    assert.ok(!document.getElementById('strong-plain').hasAttribute(ATTR));
  });

  it('標題（h1）不在載體清單、不可標記——正當的大寫標題樣式不受影響', () => {
    assert.ok(!document.getElementById('title').hasAttribute(ATTR));
  });

  it('byline 內的裝飾不可標記（meta 列有自己的樣式規則）', () => {
    assert.ok(!document.getElementById('byline-caps').hasAttribute(ATTR));
  });

  it('注入 CSS 必須有 decor-reset 重設規則', () => {
    const styleEl = document.getElementById('__jread-style');
    assert.ok(styleEl, '必須注入 __jread-style');
    const css = styleEl.textContent;
    const re = new RegExp(
      `\\[data-jread-active="1"\\] \\[${ATTR}="1"\\][^{]*\\{[^}]*text-transform:\\s*none\\s*!important[^}]*letter-spacing:\\s*normal\\s*!important`
    );
    assert.match(css, re, 'CSS 必須含 text-transform / letter-spacing 重設規則');
  });

  it('restore 後標記必須全部移除', () => {
    window.__JRead.styler.restore(articleEl, snap);
    assert.strictEqual(
      articleEl.querySelectorAll(`[${ATTR}]`).length, 0,
      'restore 後不可殘留 data-jread-decor-reset 標記'
    );
  });
});
