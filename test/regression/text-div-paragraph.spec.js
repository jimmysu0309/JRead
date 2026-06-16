// JRead — regression spec: CMS「div 當段落」字級設定失效（v0.8.49 upmedia）
// -----------------------------------------------------------------------------
// Bug（Jimmy 2026-06-12 回報）：upmedia.mg 進閱讀模式後文字特別大、不遵從
// JRead 字級設定。probe 實證：upmedia CMS 把主文段落輸出成無 class 的裸
// <div>（站點 22px），BODY_TEXT_SEL 列舉的段落 tag（p/li/blockquote/td…）
// 都不命中 → fontSize / fontFamily / lineHeight / fontWeight 四項設定整段失效。
//
// 修法（結構性通則，styler.js）：
//   1. markTextDivs()：apply() 在 ARTICLE_ATTR 設定前標記 leaf paragraph div
//      （直接 text node >= 4 字 + 無 block 子元素；訊號同 fb-post.js
//      markParagraphDivs）為 data-jread-text-div="1"
//   2. caption 防護：以「文字量加權最重的字級」為主文主流字級，字級比主流小
//      的 div（圖說類，upmedia div.mbt-text 17px）不標記——對應 figcaption
//      原則（v0.7.120 caption 保留站點小字階層）
//   3. BODY_TEXT_CORE 納入 [data-jread-text-div="1"]，restore 對稱移除標記
//
// 訊號層次：本檔驗「標記演算法選到哪些元素 + selector 進入注入 CSS + 還原」；
// 真實 Chrome cascade 勝負（!important vs 站點 rule）由 /harness-verify 驗。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'text-div-paragraph.html');
const ATTR = 'data-jread-text-div';

describe('styler — CMS「div 當段落」標記與字級覆寫（v0.8.49）', () => {
  let window, document, articleEl, snap;

  beforeEach(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['styler'],
      viewport: { width: 1200, height: 800 },
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

  it('裸 div 主文段落必須標記 data-jread-text-div', () => {
    const marked = articleEl.querySelectorAll(`[${ATTR}="1"]`);
    // 3 段裸 div（直接 text node）+ 1 段 Draft.js span-wrapped div = 4
    assert.strictEqual(marked.length, 4, '三段裸 div + 一段 span-wrapped div 都必須標記');
    for (const el of marked) {
      assert.strictEqual(el.tagName, 'DIV');
      assert.ok(el.textContent.length >= 40, '標記到的應是長段落 div');
    }
  });

  it('WYSIWYG（Draft.js）span-wrapped 段落 div 必須標記（v0.8.80 mirrormedia）', () => {
    const block = articleEl.querySelector('.draft-block');
    assert.ok(block, 'fixture 應有 .draft-block');
    // div 無直接 text node、文字全在 inline span 內——只看 direct text 會漏標
    assert.strictEqual(block.getAttribute(ATTR), '1',
      'span-wrapped 段落 div 必須標記，否則 line-height 只套到 span、block strut 壓過設定');
  });

  it('字級比主流小的圖說 div 不可標記（caption 階層保留）', () => {
    const cap = articleEl.querySelector('.mbt-text');
    assert.ok(cap, 'fixture 應有 .mbt-text 圖說');
    assert.ok(!cap.hasAttribute(ATTR), '17px 圖說 div 比主流 22px 小，不可標記');
  });

  it('figure 內的圖說 div 不可標記', () => {
    const figCap = articleEl.querySelector('.fig-caption');
    assert.ok(figCap, 'fixture 應有 figure 內圖說');
    assert.ok(!figCap.hasAttribute(ATTR), 'figure 後代 div 不可標記');
  });

  it('含 block 子元素的 wrapper div 不可標記', () => {
    const wrap = articleEl.querySelector('.img-wrap');
    assert.ok(wrap, 'fixture 應有 .img-wrap wrapper');
    assert.ok(!wrap.hasAttribute(ATTR), 'wrapper div（含 img/div 子元素）不可標記');
  });

  it('注入 CSS 的 font-size 規則 selector 必須涵蓋 text-div marker', () => {
    const styleEl = document.getElementById('__jread-style');
    assert.ok(styleEl, '必須注入 __jread-style');
    const css = styleEl.textContent;
    // fontSize=18 非 Auto → font-size 規則必須存在且 selector 含 marker
    const fsRuleRe = new RegExp(
      `\\[data-jread-active="1"\\] \\[${ATTR}="1"\\][^{]*\\{[^}]*font-size:\\s*18px\\s*!important`
    );
    assert.match(css, fsRuleRe,
      `font-size 規則 selector 必須含 [${ATTR}="1"]（裸 div 段落要吃使用者字級）`);
  });

  it('restore 後標記必須全部移除', () => {
    window.__JRead.styler.restore(articleEl, snap);
    assert.strictEqual(
      articleEl.querySelectorAll(`[${ATTR}]`).length, 0,
      'restore 後不可殘留 data-jread-text-div 標記'
    );
  });
});
