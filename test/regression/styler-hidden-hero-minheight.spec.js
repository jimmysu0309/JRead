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
// 通則修法：任何「直接子是被隱藏媒體（img/picture）」的容器，其自身與後代都不再
// 為那張不存在的圖保留 min-height。
//
// v1.6.30（#13 insertion invalidation）：訊號載體從 CSS :has 改為 marker attr——
// 原「*:has(> img[data-jread-hidden="1"]) *」是 probe 實測最重的整頁 recalc
// 放大器（見 insertion-invalidation.spec.js 與 styler.js 檔頭 v1.6.30 不變式
// 註解）。現為 cleaner hide() 在隱藏 img / picture 當下對 parent 標
// data-jread-hiddenmedia-wrap（該行為的 forcing 在 insertion-invalidation.spec），
// 本 spec 驗 CSS 端：marker 規則存在、涵蓋自身 + 後代、body 是 min-height: 0。
//
// 註：jsdom 不計算 layout，本 spec 驗 CSS 字串注入（CLAUDE.md「驗哪層訊號」
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
  it('CSS 必須含 hiddenmedia-wrap marker 的 min-height reset selector（自身 + 後代 *）', () => {
    const css = getInjectedCss();
    assert.ok(css.includes('[data-jread-hiddenmedia-wrap="1"]'),
      'CSS 必須含 [data-jread-hiddenmedia-wrap="1"] selector（keyed on cleaner hide() 標記）');
    assert.ok(/\[data-jread-hiddenmedia-wrap="1"\]\s*\*/.test(css),
      'CSS 必須含 [data-jread-hiddenmedia-wrap="1"] * （min-height 可能掛在後代，必須 reach）');
  });

  it('該 rule body 必須含 min-height: 0', () => {
    const css = getInjectedCss();
    const m = css.match(/\[data-jread-hiddenmedia-wrap="1"\]\s*\*\s*\{([^}]*)\}/);
    assert.ok(m, '必須找到 hiddenmedia-wrap min-height reset rule 區塊');
    assert.ok(/min-height\s*:\s*0\s*!important/.test(m[1]),
      'rule body 必須含 min-height: 0 !important（collapse 為不存在的 hero 保留的空間）');
  });

  it('舊 :has(> img[data-jread-hidden]) 放大器選擇器不得回歸（#13）', () => {
    // 剝 CSS 註解再比對——註解會提到歷史寫法
    const css = getInjectedCss().replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/:has\(>\s*img\[data-jread-hidden="1"\]\)/.test(css),
      '此語意的載體已改 marker attr——:has 版是整頁 recalc 放大器，不得回歸');
  });
});
