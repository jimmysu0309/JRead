// JRead — 媒體直接容器不可塌陷修法（v0.8.11）
//
// Bug：cnbc.com 進 reader mode 後 inline 影片縮圖疊在內文上（Jimmy 2026-06-09 截圖）。
//
// 根因：CNBC inline 影片嵌入結構 InlineVideo-wrapper > InlineVideo-inlineThumbnailContainer
// （height:0）> IMG（342px）。原站靠 JS 注入播放器撐高度，reader mode JS 不跑、容器維持
// height:0，img overflow:visible 溢出蓋住後續段落。既有 height:auto reset 只綁
// placeholder/ratio/object-fit/picture class，InlineVideo-* 無語意 class 全 miss。
//
// 通則修法：任何「直接子為 img/picture/video」的容器強制 height:auto + min-height:0
// （:has 通則、不綁 class）；排除 inline emoji img 與已標記 player 的容器。
//
// 註：jsdom 不計算 :has() layout，本 spec 只驗 CSS 字串注入（CLAUDE.md「驗哪層訊號」
// 說明）；實際撐高度視覺結果由 page-rounds harness probe 驗（容器 height 0→342）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'cnbc-inline-video-collapse.html');

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

describe('styler — 媒體直接容器不可塌陷（v0.8.11 cnbc inline video）', () => {
  it('CSS 必須含 :has(> img...) / :has(> picture) / :has(> video) 容器 reset selector', () => {
    const css = getInjectedCss();
    assert.ok(/:has\(>\s*img:not\(\[data-jread-inline-img\]\)\)/.test(css),
      'CSS 必須含 :has(> img:not([data-jread-inline-img])) selector（排除 inline emoji）');
    assert.ok(/:has\(>\s*picture\)/.test(css),
      'CSS 必須含 :has(> picture) selector');
    assert.ok(/:has\(>\s*video\)/.test(css),
      'CSS 必須含 :has(> video) selector');
  });

  it('該 rule body 必須含 height: auto + min-height: 0 + max-height: none', () => {
    const css = getInjectedCss();
    const m = css.match(/:has\(>\s*video\)\s*\{([^}]*)\}/);
    assert.ok(m, '必須找到媒體容器 :has rule 區塊');
    const body = m[1];
    assert.ok(/height\s*:\s*auto\s*!important/.test(body),
      'rule body 必須含 height: auto !important（容器撐到媒體實際高度）');
    assert.ok(/min-height\s*:\s*0\s*!important/.test(body),
      'rule body 必須含 min-height: 0 !important');
    // v0.8.59：myartbroker MagazineImage_imageWrap 用 height + max-height:460px +
    // object-fit:cover 把圖裁成 banner。reader 改 object-fit:contain 顯示全圖
    // （607 > 460），height:auto 被殘留 max-height 頂死、img 溢出蓋住圖說。
    // 必須連 max-height 一起解除，容器才撐到 img 實際高度。
    assert.ok(/max-height\s*:\s*none\s*!important/.test(body),
      'rule body 必須含 max-height: none !important（解除原站固定 banner 高、容器撐到全圖）');
  });

  it('媒體容器 selector 必須排除 player 容器（:not([data-jread-player="1"]))', () => {
    const css = getInjectedCss();
    // 三條媒體塌陷 :has selector 每條都應帶 :not([data-jread-player])。
    // 排除 v0.8.59 hidden-hero min-height reset 規則（:has(> img[data-jread-hidden]))
    // ——那條 keyed on 隱藏 marker、形狀不同、不在本 rule 範圍。
    const hasLines = css.split(',').filter(s =>
      /:has\(>\s*(img|picture|video)/.test(s) && !/data-jread-hidden/.test(s));
    assert.ok(hasLines.length >= 3, `應有 3 條媒體 :has selector（實際 ${hasLines.length}）`);
    for (const line of hasLines) {
      assert.ok(/:not\(\[data-jread-player="1"\]\)/.test(line),
        `媒體 :has selector 必須排除 player 容器：${line.trim()}`);
    }
  });
});
