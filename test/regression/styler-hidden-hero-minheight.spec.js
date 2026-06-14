// JRead — 被隱藏 hero 圖殘留 min-height → 標題上方一大截空白（v0.8.59）
//
// Bug：myartbroker.com 文章進 reader mode 後，標題上方一大截空白（Jimmy 2026-06-14 截圖）。
//
// 根因：原站「標題疊在 hero 圖上」的 header 容器（ArticleHeader_base）設
// min-height = hero 圖高（240px），撐到等高再 flex 把標題靠底對齊。cleaner 隱藏
// hero img（data-jread-hidden）後，那層 min-height 還在 → 標題被頂到 240px 框底、
// 上方留 ~146px 空白。既有 :has(> img) reset 只 reset「直接含媒體的容器」自身，
// min-height 卻掛在標題疊圖層這個 sibling 子樹的 descendant 上、漏網。
//
// 通則修法：任何「直接子是被隱藏媒體（img/picture[data-jread-hidden]）」的容器，
// 其自身與後代都不再為那張不存在的圖保留 min-height。keyed on JRead 自己的
// data-jread-hidden marker——只在 hero 真被隱藏時觸發，不誤傷可見圖容器。
//
// 註：jsdom 不計算 :has() layout，本 spec 驗 CSS 字串注入（CLAUDE.md「驗哪層訊號」
// 說明）；標題上移的視覺結果由 harness probe 驗（titleGap 188→42）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'myartbroker-hidden-hero-title-gap.html');

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

describe('styler — 被隱藏 hero 圖容器不保留 min-height（v0.8.59 myartbroker 標題空白）', () => {
  it('CSS 必須含 :has(> img[data-jread-hidden]) min-height reset selector', () => {
    const css = getInjectedCss();
    assert.ok(/:has\(>\s*img\[data-jread-hidden="1"\]\)/.test(css),
      'CSS 必須含 :has(> img[data-jread-hidden="1"]) selector（keyed on cleaner 隱藏 marker）');
  });

  it('selector 必須同時涵蓋「容器自身」與「後代 *」', () => {
    const css = getInjectedCss();
    // 容器自身（min-height 可能掛在 sibling 子樹 descendant 上，必須 reach 後代）
    assert.ok(/:has\(>\s*img\[data-jread-hidden="1"\]\)\s*\*/.test(css),
      'CSS 必須含 :has(> img[data-jread-hidden="1"]) * （reset 後代 min-height）');
  });

  it('該 rule body 必須含 min-height: 0', () => {
    const css = getInjectedCss();
    // selector 是 4 條 list（img / img *, picture / picture *），body 接在最後一條
    // picture descendant 之後——anchor 在 picture[...] * 才抓得到 rule body。
    const m = css.match(/:has\(>\s*picture\[data-jread-hidden="1"\]\)\s*\*\s*\{([^}]*)\}/);
    assert.ok(m, '必須找到 hidden-hero min-height reset rule 區塊');
    assert.ok(/min-height\s*:\s*0\s*!important/.test(m[1]),
      'rule body 必須含 min-height: 0 !important（collapse 為不存在的 hero 保留的空間）');
  });

  it('picture 版本 hero 也涵蓋（hero 可能是 picture）', () => {
    const css = getInjectedCss();
    assert.ok(/:has\(>\s*picture\[data-jread-hidden="1"\]\)/.test(css),
      'CSS 必須含 :has(> picture[data-jread-hidden="1"]) selector');
  });
});
