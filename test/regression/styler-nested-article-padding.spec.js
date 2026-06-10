// JRead — 巢狀語意 article / main 水平 padding 清零（v0.8.26）
//
// Bug：telefoncek.si「先用 Shinkansen 翻譯 → 再進閱讀模式」後內文變窄
// （608px → 500px，左右大片空白）。
//
// 根因鏈：
// 1. 原站對 <article class="post"> 設自身 padding: 3em（≈54px）。
// 2. JRead 偵測到的閱讀卡是外層 div.wrapper，卡片已提供卡片 padding。
//    巢狀 article 的 3em padding 疊在卡片 padding 上 = 雙重內距把內文夾窄。
// 3. JRead 的 zeroHoriz（styler.js contentWidthSnap）進閱讀模式時用 inline
//    !important 把 article 水平 padding 清成 0——normal 模式正常（內文 608px）。
// 4. 但「先翻譯再進閱讀模式」時，翻譯擴充（Shinkansen）沉澱期的 re-render 會把
//    JRead 寫的 inline style 屬性整個洗掉（時序 probe 實測：~600ms padding=0、
//    ~1500ms 之後 style 被清空、原站 3em padding 復活、內文夾回 500px）。
//
// 修法：把 article / main 的水平 padding 清零從「只靠 JS inline」補強成
// 「注入式 stylesheet rule」。#__jread-style 全程不被翻譯擴充洗掉、退出閱讀
// 模式時整張移除即完整還原（不動原網頁元素）。只鎖 article / main（語意
// landmark、不會被當縮排 callout box），div / section 的縮排歧義仍交給
// zeroHoriz 的 indent-aware JS。
//
// 本 spec 驗注入 CSS 字串含對應 rule（jsdom 不做 layout，驗 stylesheet 內容
// 是這層修法的正確訊號層；真實視覺寬度由 translate-first harness 另驗）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'nested-article-padding.html');

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

// 從 CSS 字串找含某 selector 的 rule body
function findRuleBody(css, selectorNeedle) {
  const matches = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  for (const m of matches) {
    if (m[1].includes(selectorNeedle)) return m[2];
  }
  return null;
}

describe('styler — 巢狀語意 article / main 水平 padding 清零（v0.8.26）', () => {
  it('注入 CSS 必須含「[data-jread-active] article」水平 padding 清零 rule', () => {
    const css = getInjectedCss();
    const body = findRuleBody(css, '[data-jread-active="1"] article');
    assert.ok(body, '必須找到含 [data-jread-active="1"] article 的 rule');
    assert.ok(/padding-left\s*:\s*0\s*!important/.test(body),
      'article rule 必須含 padding-left: 0 !important');
    assert.ok(/padding-right\s*:\s*0\s*!important/.test(body),
      'article rule 必須含 padding-right: 0 !important');
  });

  it('注入 CSS 必須同時涵蓋巢狀 <main>（語意內容 landmark）', () => {
    const css = getInjectedCss();
    // article / main 共用同一 rule block，selector 內須出現 main
    const matches = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    let mainRule = null;
    for (const m of matches) {
      if (/\[data-jread-active="1"\]\s+main\b/.test(m[1])
          && /padding-left\s*:\s*0\s*!important/.test(m[2])) {
        mainRule = m[2];
        break;
      }
    }
    assert.ok(mainRule, '必須找到 [data-jread-active="1"] main + padding-left: 0 的 rule');
    assert.ok(/padding-right\s*:\s*0\s*!important/.test(mainRule),
      'main rule 必須含 padding-right: 0 !important');
  });

  it('html 前綴提升 specificity（贏過原站 article { padding } 類 rule）', () => {
    const css = getInjectedCss();
    // selector 須以 html 前綴出現，specificity (0,1,2) > 原站 article (0,0,1)
    assert.ok(/html\s+\[data-jread-active="1"\]\s+article/.test(css),
      'article rule selector 必須含 html 前綴（提升 specificity）');
  });
});
