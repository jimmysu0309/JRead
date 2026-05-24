// JRead — styler 清掉 *::before / *::after 的 background-color / background-image
// （v0.7.169）
//
// Bug：CNBC blob 文章 (cnbc.com/2019/10/23/.../blob.html) 進 reader mode 後，
// article header 左側出現一塊 520x480px 的大白盒，跟 article card 並排。
//
// 根因：CNBC `ArticleHeader-styles-makeit-wrapperHeroNoImage::before` pseudo
// 為「side-bleed 裝飾」——`position: absolute` + `background-color: white` +
// `width: ~520px` + `transform: matrix(1, 0, 0, 1, -522.578, 0)`（往左 522px 位移）。
// 原站 layout：用 pseudo 把卡片底色「溢出」到左側，營造 hero-less header 的
// 視覺寬度。reader mode 下 pageWrapper 已有自己的 bg，這 pseudo 反而在版心
// 外漏出大塊白色（看起來像「左邊多了一個空白卡」）。
//
// 通則修法：reader card 內 *::before / *::after 一律清掉 background-color +
// background-image。content / color / size 不動，list marker / drop cap / 文字
// pseudo 仍工作（這些不用 bg-color 渲染）。
//
// 路徑 B 驗證（jsdom 不算 CSS）：只驗 styler 注入的 CSS 含此規則字串；
// 真實 Chrome 視覺由 harness 跑 CNBC URL 驗。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function getInjectedCss() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  env.NS.styler.apply(detected.el, DEFAULT_SETTINGS);
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl, '必須注入 __jread-style');
  return styleEl.textContent;
}

describe('styler — pseudo-element 側 bg 強制清掉（v0.7.169 CNBC side-bleed）', () => {
  it('CSS 必須含 [data-jread-active="1"] *::before / *::after 規則', () => {
    const css = getInjectedCss();
    // selector：[data-jread-active="1"] *::before, [data-jread-active="1"] *::after
    assert.ok(/\[data-jread-active="1"\]\s*\*[^{]*::before/.test(css),
      'CSS 必須含 [data-jread-active="1"] *...::before selector（覆蓋所有 reader card 內 pseudo）');
    assert.ok(/\[data-jread-active="1"\]\s*\*[^{]*::after/.test(css),
      'CSS 必須含 [data-jread-active="1"] *...::after selector');
  });

  it('該 rule 必須同時清 background-color 與 background-image（用 !important）', () => {
    const css = getInjectedCss();
    // 找出 *::before / *::after rule 區塊，內部須含 background-color / image
    // 兩條 declaration、都用 !important。容許前後額外 declaration、空白。
    const m = css.match(
      /\[data-jread-active="1"\]\s*\*[^{]*::before\s*,\s*\[data-jread-active="1"\]\s*\*[^{]*::after\s*\{([^}]+)\}/
    );
    assert.ok(m, '必須找到 *...::before, *...::after 合併規則區塊');
    const body = m[1];
    assert.ok(/background-color\s*:\s*transparent\s*!important/.test(body),
      'rule body 必須含 background-color: transparent !important');
    assert.ok(/background-image\s*:\s*none\s*!important/.test(body),
      'rule body 必須含 background-image: none !important');
  });

});

// Body wrapper margin reset：CNBC ArticleBody 內 div.group margin-left:91px
// 把內文 p 整段推向版心右側 91px。reader card 單欄版心、這些 wrapper margin
// 失意義。修法：div:has(> p / > h1-h6 / > ul / > ol / > blockquote) 清 margin-
// left/right。
//
// 注意：comment 內絕對不可有 backtick 字元（會 terminate styler.js 的 JS
// template literal、整個 CSS 注入 corrupt → reader mode 不啟動，v0.7.169
// 開發中踩到一次）。中文引號用「」、英文引號用 ' " 都安全。

describe('styler — body wrapper margin reset（v0.7.169 CNBC div.group indent）', () => {
  it('CSS 必須含 div:has(> p) margin reset selector', () => {
    const css = getInjectedCss();
    assert.ok(/\[data-jread-active="1"\]\s*div:has\(>\s*p\)/.test(css),
      'CSS 必須含 [data-jread-active="1"] div:has(> p) selector');
  });

  it('CSS 必須含 div:has(> h1, > h2, ...) margin reset selector', () => {
    const css = getInjectedCss();
    assert.ok(/\[data-jread-active="1"\]\s*div:has\(>\s*h1\s*,\s*>\s*h2[^)]*\)/.test(css),
      'CSS 必須含 div:has(> h1, > h2, ...) heading wrapper selector');
  });

  it('CSS 必須含 div:has(> ul, > ol) margin reset selector', () => {
    const css = getInjectedCss();
    assert.ok(/\[data-jread-active="1"\]\s*div:has\(>\s*ul\s*,\s*>\s*ol\)/.test(css),
      'CSS 必須含 div:has(> ul, > ol) list wrapper selector');
  });

  it('該 rule 必須清 margin-left + margin-right（用 !important）', () => {
    const css = getInjectedCss();
    const m = css.match(
      /\[data-jread-active="1"\]\s*div:has\(>\s*p\)[\s\S]*?\{([^}]+)\}/
    );
    assert.ok(m, '必須找到 div:has(> p) ... rule 區塊');
    const body = m[1];
    assert.ok(/margin-left\s*:\s*0\s*!important/.test(body),
      'rule body 必須含 margin-left: 0 !important');
    assert.ok(/margin-right\s*:\s*0\s*!important/.test(body),
      'rule body 必須含 margin-right: 0 !important');
  });
});
