// JRead — styler 關掉 reader card / ancestor「自身」的 ::before / ::after
// （v0.8.41）
//
// Bug：foreignaffairs.com 文章進 reader mode 後，文章約第一頁位置出現一個
// viewport 大小的框（dark mode 黑框 / light mode 灰框，2026-06-11 Jimmy 截圖）。
//
// 根因：站方在整頁 wrapper `.base::before` 掛整頁裝飾框——`position: absolute`
// + `inset: 0` + `border: 15px solid var(...)`（邊框色跟 color-scheme 走）。
// 該 wrapper 被 detector 選為 reader card 後，styler 把 position reset 成
// static，pseudo 的 inset: 0 改以 viewport 大小的 initial containing block
// 定位，於是渲染成「第一頁位置一個 viewport 大小的框」。
//
// 既有規則（v0.7.169 CNBC side-bleed）只蓋 card「後代」的 pseudo、且只清
// background——這次的框 (a) 掛在 card 元素自身、(b) 用 border 畫，兩個維度
// 都漏。
//
// 通則修法：card 與 ancestor「自身」的 ::before / ::after 一律 content: none。
// 兩者在 reader mode 下是主文容器 / 純 layout 通道，自身 pseudo 只可能是站方
// 版面裝飾（frame / side-bleed / overlay）；drop cap / list marker / 引號等
// 合法文字 pseudo 都掛在後代元素上，不受影響。
//
// 路徑 B 驗證（jsdom 不算 pseudo layout）：只驗 styler 注入的 CSS 含此規則
// 字串；真實 Chrome 視覺由 harness 跑 foreignaffairs URL 驗。

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

describe('styler — card / ancestor 自身 pseudo 關閉（v0.8.41 foreignaffairs 整頁框）', () => {
  it('CSS 必須含 card 自身 ::before / ::after selector（非後代）', () => {
    const css = getInjectedCss();
    // selector 必須是 [data-jread-active="1"]::before（attr 與 ::before 之間
    // 不得有後代 combinator / *，否則蓋不到 card 自身）
    assert.ok(/\[data-jread-active="1"\]::before/.test(css),
      'CSS 必須含 [data-jread-active="1"]::before（card 自身、非後代）');
    assert.ok(/\[data-jread-active="1"\]::after/.test(css),
      'CSS 必須含 [data-jread-active="1"]::after（card 自身、非後代）');
  });

  it('CSS 必須含 ancestor 自身 ::before / ::after selector', () => {
    const css = getInjectedCss();
    assert.ok(/\[data-jread-ancestor="1"\]::before/.test(css),
      'CSS 必須含 [data-jread-ancestor="1"]::before（detector 選更內層時整頁框會落在 ancestor 鏈）');
    assert.ok(/\[data-jread-ancestor="1"\]::after/.test(css),
      'CSS 必須含 [data-jread-ancestor="1"]::after');
  });

  it('該 rule 必須用 content: none !important（border / bg / shadow 畫的裝飾一律失效）', () => {
    const css = getInjectedCss();
    const m = css.match(
      /\[data-jread-active="1"\]::before\s*,\s*\[data-jread-active="1"\]::after\s*,\s*\[data-jread-ancestor="1"\]::before\s*,\s*\[data-jread-ancestor="1"\]::after\s*\{([^}]+)\}/
    );
    assert.ok(m, '必須找到 card / ancestor 自身 pseudo 合併規則區塊');
    assert.ok(/content\s*:\s*none\s*!important/.test(m[1]),
      'rule body 必須含 content: none !important');
  });
});
