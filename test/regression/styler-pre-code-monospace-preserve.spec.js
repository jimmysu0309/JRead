// JRead — regression spec: pre / code 後代 span monospace 保留 (v0.7.164)
// -----------------------------------------------------------------------------
// Forcing function for v0.7.164 修法。
// Trigger: Jimmy 2026-05-22 回報 Medium @ddsakura-blog M5 Max 評測文 v0.7.164
// 修好 pre 透明背景後「框內等寬字型被代換」截圖。
//
// Root cause: styler v0.7.152 為穿透 WYSIWYG 編輯器（vocus.cc 對 span 寫死
// font-family）加入 `SPAN_TEXT_SEL = [data-jread-active="1"] span:not(icon)...`，
// fontFamily override 套到 article 內所有 span。Medium WYSIWYG 把 <pre> 內
// 每行包成 <span class="...">，這條 SPAN_TEXT_SEL 也命中 pre 內 span → 蓋掉
// 站點 pre author CSS 的 monospace stack（source-code-pro, Menlo, Monaco...）
// → pre 框內字型被代換成使用者字型（sans-serif）。Probe 數值：Medium 文章
// 20 個 span / 12 個非 pre/code 後代 / 8 個 pre/code 後代——8 個是修法漏網。
//
// v0.7.164 修法：SPAN_TEXT_SEL 結尾加 `:not(pre *):not(code *)`（Selectors 4
// complex selector in :not()，Chrome 88+ 支援，Manifest V3 最低 88，全相容）。
// pre / code 後代的 span 不命中 SPAN_TEXT_SEL → font-family 不被覆寫 →
// inherit 父元素字型（站點 pre author CSS 的 monospace stack 仍生效）。
// 寫成兩個獨立 :not()（不用 :not(pre *, code *) selector list 形式）以避免
// selector 字串含 comma 干擾 split(',') 切 selector list 的程式邏輯。
//
// jsdom 不算 layout / 不解析 cascade，spec 驗 stylesheet 字串注入。
//
// 3 條 forcing function:
//   (a) 非預設 fontFamily 注入的 stylesheet selector 必須含 :not(pre *, code *)
//   (b) 非預設 fontSize 注入的 stylesheet 同（fontSize 也走 SPAN_TEXT_SEL）
//   (c) 預設 fontFamily + fontSize → 不注入 font-* override（無 SPAN_TEXT_SEL）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');

function setup(overrides) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected);
  const settings = Object.assign({
    theme: 'light',
    fontSize: 18,
    contentWidth: 720,
    fontFamily: 'system-ui',
    lineHeight: 1.7
  }, overrides);
  env.NS.styler.apply(detected.el, settings);
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl);
  return styleEl.textContent;
}

describe('styler — pre/code monospace preserve (v0.7.164)', () => {
  // 找 font-family rule selector list 的 helper
  function getFontFamilySelectorList(css) {
    const m = css.match(/([^}]*)\{[^}]*font-family\s*:/i);
    return m ? m[1] : null;
  }
  function getFontSizeSelectorList(css) {
    const m = css.match(/([^}]*)\{[^}]*font-size\s*:/i);
    return m ? m[1] : null;
  }

  it('(a) 非預設 fontFamily → SPAN_TEXT_SEL 含 :not(pre *, code *)', () => {
    const css = setup({ fontFamily: 'Georgia' });
    const sel = getFontFamilySelectorList(css);
    assert.ok(sel, 'CSS 必須注入 font-family rule');
    // SPAN_TEXT_SEL 注入的 span selector 必須含 :not(pre *, code *) 子句
    assert.ok(/span[^,{]*:not\(pre\s*\*\):not\(code\s*\*\)/i.test(sel),
      `font-family rule 的 selector list 必須含 \`span ... :not(pre *, code *)\`（v0.7.164 修法：保留 pre / code 框內字型不被使用者字型覆蓋；拿掉 → Medium / dev.to 等 WYSIWYG 站點 <pre><span>code</span></pre> 結構的 monospace 被代換成 sans-serif）`);
  });

  it('(b) 非預設 fontSize → SPAN_TEXT_SEL 含 :not(pre *, code *)', () => {
    // fontSize 也走同個 BODY_TEXT_SEL → SPAN_TEXT_SEL 必須一致排除
    const css = setup({ fontSize: 22 });
    const sel = getFontSizeSelectorList(css);
    assert.ok(sel, 'CSS 必須注入 font-size rule');
    assert.ok(/span[^,{]*:not\(pre\s*\*\):not\(code\s*\*\)/i.test(sel),
      `font-size rule 的 selector list 必須含 \`span ... :not(pre *, code *)\`（v0.7.164：fontSize override 也透過 SPAN_TEXT_SEL 套到 span，pre/code 內 span 必須一起排除避免字級被縮小到跟 body 同；同源 selector list 保證一致性）`);
  });

  it('(c) 預設 fontFamily + fontSize → 不注入 font-* override（SPAN_TEXT_SEL 不會出現）', () => {
    // 預設 fontFamily = 'system-ui'（DEFAULTS），不觸發 fontFamily override；
    // 預設 fontSize = 18（DEFAULTS），不觸發 fontSize override。SPAN_TEXT_SEL
    // 不會被注入 stylesheet，所以也無 :not(pre *, code *) 規則——這是 baseline
    // 「預設值不動原站」的正確行為。
    // 但 v0.7.140 之後預設 fontSize 仍會注入（為了連帶 line-height），所以這條
    // spec 改成驗：只要 font-size 或 font-family rule 存在，:not(pre *, code *)
    // 就必須在；不存在則 skip。
    const css = setup({ fontSize: 18, fontFamily: 'system-ui' });
    const fontFamilySel = getFontFamilySelectorList(css);
    const fontSizeSel = getFontSizeSelectorList(css);
    if (fontFamilySel) {
      assert.ok(/span[^,{]*:not\(pre\s*\*\):not\(code\s*\*\)/i.test(fontFamilySel),
        'font-family rule 若注入則必須含 :not(pre *, code *)');
    }
    if (fontSizeSel) {
      assert.ok(/span[^,{]*:not\(pre\s*\*\):not\(code\s*\*\)/i.test(fontSizeSel),
        'font-size rule 若注入則必須含 :not(pre *, code *)');
    }
  });
});
