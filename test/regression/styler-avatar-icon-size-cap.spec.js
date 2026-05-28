// JRead — Avatar icon 尺寸保護（v0.7.207）
//
// Bug：thenewslens.com 文章底部的「中央通訊社」author-avatar 圖示在 reader mode
// 下被撐到 496×496，幾乎佔滿整個版面。
//
// 根因：
// 1. 原站結構 `<a><div class="avatar-wrapper ratio ratio-"><img class="author-avatar"></div></a>`
//    img 設 `width:100%; height:100%` 填滿 wrapper
// 2. v0.7.206 把 `[class*="ratio" i]` 加進 aspect-ratio reset，wrapper 失去
//    aspect-ratio 約束，被外層 flex 容器撐到 496px
// 3. 既有 icon-size-cap rule 涵蓋 wrapper-icon / media-icon / app-icon / thumb-icon
//    但未涵蓋 avatar——avatar 在 Medium / Substack / WordPress / 一般 CMS
//    都是常見「作者頭像」命名 token
//
// 通則修法：把 [class*="avatar" i] 加進 icon-size-cap selector，命中時套
// max-width/max-height: 200px、width/height: auto。同時覆蓋 wrapper class
// 含 avatar 與 img class 含 avatar 兩種命名。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'avatar-icon-oversize.html');

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

describe('styler — Avatar icon 尺寸保護（v0.7.207 thenewslens 中央社 logo 撐版面）', () => {
  it('CSS 必須含 [class*="avatar" i] selector 套 max-width/max-height', () => {
    const css = getInjectedCss();
    assert.ok(/\[class\*="avatar"\s*i\]\s+img/.test(css),
      'CSS 必須含 [class*="avatar" i] img selector（wrapper class 含 avatar）');
    assert.ok(/img\[class\*="avatar"\s*i\]/.test(css),
      'CSS 必須含 img[class*="avatar" i] selector（img class 含 avatar）');
  });

  it('avatar rule 必須含 max-width / max-height: 200px + width / height: auto', () => {
    const css = getInjectedCss();
    // 找含 avatar 的 rule block
    const m = css.match(/\[class\*="avatar"\s*i\][^{]*\{([^}]*)\}/);
    assert.ok(m, '必須找到 avatar rule 區塊');
    const body = m[1];
    assert.ok(/max-width\s*:\s*200px\s*!important/.test(body),
      'avatar rule body 必須含 max-width: 200px !important');
    assert.ok(/max-height\s*:\s*200px\s*!important/.test(body),
      'avatar rule body 必須含 max-height: 200px !important');
    assert.ok(/\bwidth\s*:\s*auto\s*!important/.test(body),
      'avatar rule body 必須含 width: auto !important（破原站 width:100%）');
    assert.ok(/\bheight\s*:\s*auto\s*!important/.test(body),
      'avatar rule body 必須含 height: auto !important');
  });
});
