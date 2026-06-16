// JRead — regression spec: The Register paragraph padding reset（v0.7.201）
//
// Trigger: The Register 站 CSS 對 <p> 設 padding-left: 220px + padding-right: 320px。
// Reader card 內寬 720px、側邊 padding 56px，原站 padding 把文字擠到 68px 寬
// （每行約 6.7 字元）——幾乎無法閱讀。
//
// 修法：styler 注入
//   html [data-jread-active="1"] p { padding-left: 0 !important; padding-right: 0 !important; }
//
// 通則特徵：reader card 是 single-column layout，原站的水平 padding（通常用於多欄
// layout 內縮）在 reader card 內失去意義，只會擠窄文字。本條只清 left/right。
// （v0.8.92 補記：top/bottom 的歸零移到 paragraphSpacing 注入分支處理——站點用
// padding-bottom 撐段距會與 reader margin 疊成雙倍間距，見
// wapo-paragraph-padding-stack.spec.js。Auto 模式不注入 margin、也不清垂直
// padding，本條原「保留 top/bottom 給原站段距」的語意在 Auto 下仍成立。）
//
// 2 條 forcing function：
//   (a) 注入 CSS 含 p 的 padding-left: 0 !important 規則
//   (b) 注入 CSS 含 p 的 padding-right: 0 !important 規則

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'register-paragraph-padding.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

describe('styler — The Register paragraph padding reset', () => {
  let window, document, css;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'styler']
    });
    window = env.window;
    document = env.document;
    const articleEl = document.querySelector('article');
    assert.ok(articleEl, 'fixture 須含 <article>');
    env.NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const styleEl = document.getElementById('__jread-style');
    assert.ok(styleEl, 'styler 必須注入 __jread-style');
    css = styleEl.textContent;
  });

  it('(a) 注入 CSS 含 [data-jread-active="1"] p padding-left: 0 規則', () => {
    // 驗證 CSS 包含對 p 的 padding-left reset（在 data-jread-active scope 內）
    assert.ok(
      css.includes('padding-left: 0 !important'),
      'CSS 必須包含 padding-left: 0 !important（清除原站水平 padding）'
    );
    // 確認規則是針對 [data-jread-active] 內的 p
    const ruleMatch = css.match(/\[data-jread-active="1"\]\s*p\s*\{[^}]*padding-left:\s*0\s*!important/);
    assert.ok(ruleMatch,
      'padding-left: 0 規則必須在 [data-jread-active="1"] p selector 內');
  });

  it('(b) 注入 CSS 含 [data-jread-active="1"] p padding-right: 0 規則', () => {
    assert.ok(
      css.includes('padding-right: 0 !important'),
      'CSS 必須包含 padding-right: 0 !important（清除原站水平 padding）'
    );
    const ruleMatch = css.match(/\[data-jread-active="1"\]\s*p\s*\{[^}]*padding-right:\s*0\s*!important/);
    assert.ok(ruleMatch,
      'padding-right: 0 規則必須在 [data-jread-active="1"] p selector 內');
  });
});
