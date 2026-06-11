// JRead — fontWeight 注入不可抹平 strong/b 內的 span 粗體（v0.8.36）
//
// Bug：v0.7.254 起 fontWeight 三段一律注入（含預設 400），套在 BODY_TEXT_SEL
// ——其中 SPAN_TEXT_SEL 的排除清單有 pre/code/h1-h6 但沒有 strong/b。WYSIWYG
// 編輯器（Lexical / TipTap，vocus 類站）普遍輸出 `<strong><span style="...">
// 粗體</span></strong>`：span 自己直接命中規則（不是 inherit）、被設
// font-weight: 400 !important → 內文粗體全部變細。預設設定就觸發。
//
// 修法：font-weight 規則改用 BODY_WEIGHT_SEL（= BODY_TEXT_CORE + SPAN_TEXT_SEL
// + :not(strong *):not(b *)）。注意只動 font-weight——字級 / 字型注入對 strong
// 內 span 仍要生效（粗體文字也要跟使用者字級字型），所以不能直接改 SPAN_TEXT_SEL。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'paged-mode.html');

function applyAndGetCss(settings) {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  env.NS.styler.apply(articleEl, settings);
  return env.document.getElementById('__jread-style').textContent;
}

const BASE = { theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0 };

describe('styler — fontWeight 與 strong/b 內 span（v0.8.36）', () => {
  it('font-weight 規則的 span selector 必須排除 strong / b 後代', () => {
    const css = applyAndGetCss({ ...BASE, fontWeight: 400 });
    // 抓 font-weight 規則的 selector 區塊
    const m = css.match(/([^{}]+)\{\s*font-weight:\s*400 !important;\s*\}/);
    assert.ok(m, '必須有 font-weight 注入規則（v0.7.254 起預設 400 也注入）');
    assert.ok(/:not\(strong \*\)/.test(m[1]) && /:not\(b \*\)/.test(m[1]),
      'font-weight 規則的 span selector 必須含 :not(strong *):not(b *)——span 直接命中規則會抹平 WYSIWYG 粗體');
  });

  it('字級 / 字型注入的 span selector 不可排除 strong / b（粗體文字也要跟使用者字級字型）', () => {
    const css = applyAndGetCss({ ...BASE, fontSize: 20, fontFamily: '"Noto Serif TC"' });
    const sizeRule = css.match(/([^{}]+)\{\s*font-size:\s*20px !important;[^}]*\}/);
    assert.ok(sizeRule, '必須有 font-size 注入規則');
    assert.ok(!/:not\(strong \*\)/.test(sizeRule[1]),
      'font-size 規則不可排除 strong 後代——粗體文字也要套使用者字級');
  });
});
