// JRead — regression spec: 站點 flex/grid 容器 row-gap 與 reader 段落 margin
// 疊加的雙倍段距（v0.8.120 autosport.com）
//
// Trigger: autosport.com（Motorsport CMS）的 .ms-article-content 是
//   display:flex; flex-direction:column; gap:32px
// flex 的 row-gap(32px) 與 reader 注入的段落 margin-bottom 1em(~17px) 疊成 49px
// 段距。使用者調 paragraphSpacing 只改 margin、改不動 flex gap → Jimmy 回報
// 「段落間距變很寬、沒尊重設定」。
//
// 修法：paragraphSpacing >= 0（非 Auto）分支注入
//   [data-jread-active="1"], [data-jread-active="1"] * { row-gap: 0 !important; }
// 段落垂直間距改由 reader margin 單一決定。row-gap 僅對 flex/grid/multicol 容器
// 生效，一般 block 元素零副作用；只清 row-gap、不清 column-gap（翻頁版心需保留）。
//
// 3 條 forcing function：
//   (a) paragraphSpacing >= 0 時注入 CSS 含 row-gap: 0 !important（article scope）
//   (b) 只清 row-gap、不出現 column-gap: 0（避免清掉翻頁 column-gap）
//   (c) Auto 模式（paragraphSpacing = -1）不注入 row-gap reset（保留原站 typography）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'register-paragraph-padding.html');

const BASE_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7
};

function injectAndGetCss(paragraphSpacing) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 須含 <article>');
  env.NS.styler.apply(articleEl, Object.assign({}, BASE_SETTINGS, { paragraphSpacing }));
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl, 'styler 必須注入 __jread-style');
  return styleEl.textContent;
}

describe('styler — flex/grid row-gap 與段落 margin 疊加（v0.8.120）', () => {
  it('(a) paragraphSpacing >= 0 時注入 row-gap: 0（article scope）', () => {
    const css = injectAndGetCss(1.0);
    assert.ok(css.includes('row-gap: 0 !important'),
      'CSS 必須包含 row-gap: 0 !important（中和站點 flex/grid gap）');
    const ruleMatch = css.match(/\[data-jread-active="1"\][^{]*\{[^}]*row-gap:\s*0\s*!important/);
    assert.ok(ruleMatch,
      'row-gap: 0 規則必須在 [data-jread-active="1"] scope 內');
  });

  it('(b) 不得出現 column-gap: 0（翻頁版心 column-gap 必須保留）', () => {
    const css = injectAndGetCss(1.0);
    assert.ok(!/column-gap:\s*0\s*!important/.test(css),
      '不可清 column-gap（flex-column 不貢獻垂直空間、翻頁模式需保留）');
  });

  it('(c) Auto 模式（-1）不注入 row-gap reset', () => {
    const css = injectAndGetCss(-1);
    assert.ok(!css.includes('row-gap: 0 !important'),
      'Auto sentinel 應保留原站 flex gap typography、不注入 row-gap reset');
  });
});
