// JRead — responsive embed 的 abs-pos iframe pin 回填滿 wrapper（v0.8.86）
//
// Bug：thenewslens.com/article/975 兩支影片（TED + YouTube）進閱讀模式後被推到
// 偏右、超出版心破版。
//
// 根因：原站影片嵌入用 figure.video-responsive（position:relative + padding-bottom
// 16:9 hack）+ iframe position:absolute; left:0; width:100% 填滿。閱讀模式媒體置中
// 規則對 iframe 套 margin-left/right:auto——但對 abs-pos 元素，CSS 定位方程式會把
// margin auto 解出非零 left/right（實測 iframe left 跑到 wrapper 寬一半 304px），
// 把 iframe 推出 wrapper 偏右。
//
// 修法（結構性）：apply() 量到 computed position:absolute 的 article iframe 標
// [data-jread-fill-iframe]（keyed on 結構特徵非站點 class），CSS pin 回 inset:0 +
// width/height:100% 填滿 wrapper，wrapper 自身仍走 figure 置中規則對齊版心。restore
// 對稱移除標記。
//
// 註：jsdom 不 cascade stylesheet 的 position，故 fixture 用 inline position:absolute
// 讓 getComputedStyle 讀得到（驗「marking 邏輯 + CSS 規則 + restore」這層；實際填滿
// 視覺由 cage/harness 在真實 Chrome 驗——已於修法當輪 live probe 確認 x 對齊 wrapper）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'thenewslens-video-responsive-iframe.html');
const FILL_ATTR = 'data-jread-fill-iframe';

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler'],
    viewport: { width: 1280, height: 900 },
    pretendToBeVisual: true
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  const snapshot = env.NS.styler.apply(detected.el, DEFAULT_SETTINGS);
  return { env, detected, snapshot };
}

describe('styler — responsive embed abs-pos iframe 填滿（v0.8.86 thenewslens）', () => {
  it('abs-pos iframe（TED / YouTube）被標 data-jread-fill-iframe', () => {
    const { env } = setup();
    const ted = env.document.getElementById('ted-iframe');
    const yt = env.document.getElementById('yt-iframe');
    assert.strictEqual(ted.getAttribute(FILL_ATTR), '1',
      'TED abs-pos iframe 必須被標 fill');
    assert.strictEqual(yt.getAttribute(FILL_ATTR), '1',
      'YouTube abs-pos iframe 必須被標 fill');
  });

  it('一般 in-flow iframe（無 position:absolute）不被標', () => {
    const { env } = setup();
    const inflow = env.document.getElementById('inflow-iframe');
    assert.notStrictEqual(inflow.getAttribute(FILL_ATTR), '1',
      'in-flow iframe 不該被標 fill（仍走 margin:auto 置中）');
  });

  it('CSS 注入 iframe[fill] pin 規則：position:absolute + inset:0 + width/height:100% + margin:0', () => {
    const { env } = setup();
    const css = env.document.getElementById('__jread-style').textContent;
    // selector 重複 attribute 提高 specificity（見 styler 註解），match 雙 attr
    const m = css.match(/iframe\[data-jread-fill-iframe\]\[data-jread-fill-iframe\]\s*\{([^}]*)\}/);
    assert.ok(m, '必須注入 iframe[data-jread-fill-iframe] 規則');
    const body = m[1];
    assert.ok(/position\s*:\s*absolute\s*!important/.test(body), '須含 position: absolute !important');
    assert.ok(/left\s*:\s*0\s*!important/.test(body), '須含 left: 0 !important');
    assert.ok(/right\s*:\s*0\s*!important/.test(body), '須含 right: 0 !important');
    assert.ok(/top\s*:\s*0\s*!important/.test(body), '須含 top: 0 !important');
    assert.ok(/width\s*:\s*100%\s*!important/.test(body), '須含 width: 100% !important');
    assert.ok(/height\s*:\s*100%\s*!important/.test(body), '須含 height: 100% !important');
    assert.ok(/margin\s*:\s*0\s*!important/.test(body), '須含 margin: 0 !important（覆寫置中 margin:auto）');
  });

  it('pin 規則必須排在媒體置中規則之後（source order 覆寫 margin:auto）', () => {
    const { env } = setup();
    const css = env.document.getElementById('__jread-style').textContent;
    const centerIdx = css.indexOf('margin-left: auto !important;\n  margin-right: auto !important;');
    const fillIdx = css.indexOf('iframe[data-jread-fill-iframe]');
    assert.ok(centerIdx >= 0, '必須找到媒體置中規則');
    assert.ok(fillIdx >= 0, '必須找到 fill 規則');
    assert.ok(fillIdx > centerIdx,
      'fill 規則須排在置中規則之後（相同 specificity 靠後者覆寫 margin:auto）');
  });

  it('restore 移除 fill 標記', () => {
    const { env, detected, snapshot } = setup();
    env.NS.styler.restore(detected.el, snapshot);
    const ted = env.document.getElementById('ted-iframe');
    const yt = env.document.getElementById('yt-iframe');
    assert.ok(!ted.hasAttribute(FILL_ATTR), 'restore 後 TED iframe fill 標記必須移除');
    assert.ok(!yt.hasAttribute(FILL_ATTR), 'restore 後 YouTube iframe fill 標記必須移除');
  });
});
