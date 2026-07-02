// JRead — regression spec: CJK 內文段落兩端對齊（v1.6.12 om.co WebKit 內縮）
// -----------------------------------------------------------------------------
// Bug（Jimmy 2026-07-03 回報）：om.co 在 iPhone Safari 用 Shinkansen 翻譯後，
// 第二段起內容變窄、desktop 正常。probe 實證（Playwright WebKit 對照 Chromium、
// 同一份 reader HTML / 同 390px / 同 18px / 同 fallback 字型）：WebKit 對 CJK 內文
// 在 text-align: left 下每行少填約 4 字、留 30-88px 尾空間，Chromium 會填滿。
// word-break / line-break / overflow-wrap / 去斜體全部無效，唯一有效解 = justify。
//
// 修法（結構性通則，styler.js）：
//   1. markCjkParagraphs()：apply() 逐段落載體（p/li/blockquote/dd/dt/text-div）
//      算 CJK 佔比，>= 4 漢字且 CJK/(CJK+拉丁) >= 0.3 → data-jread-cjk-justify="1"
//   2. byline / kicker 排除（meta 列有自己的對齊規則）
//   3. 注入 CSS：[data-jread-active="1"] [data-jread-cjk-justify="1"] { text-align: justify }
//   4. restore 對稱移除標記
//
// 訊號層次：本檔驗「標記演算法選到哪些段落 + selector 進入注入 CSS + 還原」；
// 真實 WebKit 排版是否確實撐回滿版由 /harness-verify（Playwright WebKit）驗。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'cjk-justify-paragraph.html');
const ATTR = 'data-jread-cjk-justify';

describe('styler — CJK 內文段落兩端對齊（v1.6.12）', () => {
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

  it('純 CJK 長段落必須標記', () => {
    assert.strictEqual(document.getElementById('p-pure-cjk').getAttribute(ATTR), '1');
  });

  it('含 inline 元素（strong/em）的 CJK 段落必須標記（翻譯後典型結構）', () => {
    assert.strictEqual(document.getElementById('p-inline').getAttribute(ATTR), '1');
  });

  it('CJK 為主 + 少量拉丁（品牌名/數字）段落必須標記', () => {
    assert.strictEqual(document.getElementById('p-mixed').getAttribute(ATTR), '1');
  });

  it('CJK 的 <li> 必須標記', () => {
    assert.strictEqual(document.getElementById('li-cjk').getAttribute(ATTR), '1');
  });

  it('純英文段落不可標記（英文 justify 產生 rivers、可讀性差）', () => {
    assert.ok(!document.getElementById('p-english').hasAttribute(ATTR),
      '純英文段落 ratio≈0，不可 justify');
  });

  it('短 CJK 標籤（< 4 漢字）不可標記', () => {
    assert.ok(!document.getElementById('p-short').hasAttribute(ATTR),
      '「大局觀」3 字 < 門檻，不套 justify');
  });

  it('byline（meta 列）內的 CJK 不可標記', () => {
    assert.ok(!document.getElementById('byline').hasAttribute(ATTR),
      'byline 有自己的對齊規則，不 justify');
  });

  it('注入 CSS 必須有 CJK 段落 text-align: justify 規則', () => {
    const styleEl = document.getElementById('__jread-style');
    assert.ok(styleEl, '必須注入 __jread-style');
    const css = styleEl.textContent;
    const re = new RegExp(
      `\\[data-jread-active="1"\\] \\[${ATTR}="1"\\][^{]*\\{[^}]*text-align:\\s*justify\\s*!important`
    );
    assert.match(css, re, 'CSS 必須含 CJK 段落 justify 規則');
  });

  it('restore 後標記必須全部移除', () => {
    window.__JRead.styler.restore(articleEl, snap);
    assert.strictEqual(
      articleEl.querySelectorAll(`[${ATTR}]`).length, 0,
      'restore 後不可殘留 data-jread-cjk-justify 標記'
    );
  });
});
