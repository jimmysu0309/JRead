// JRead — 閱讀進度條 regression spec（v0.7.191）
// 驗證 progress bar DOM 元素的建立、CSS 注入、scroll handler 安裝、restore 清除。
// 視覺效果（顏色、位置）由 harness 截圖驗。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');
const PROGRESS_ID = '__jread-progress';

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中主文');
  return { window: env.window, document: env.document, NS: env.NS, articleEl: detected.el };
}

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

describe('styler — 閱讀進度條', () => {
  it('apply() 注入 #__jread-progress 元素', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const bar = document.getElementById(PROGRESS_ID);
    assert.ok(bar, '必須注入 progress bar 元素');
    assert.strictEqual(bar.tagName.toLowerCase(), 'div');
  });

  it('CSS 包含 progress bar 定位規則', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const styleEl = document.getElementById('__jread-style');
    const css = styleEl.textContent;
    assert.ok(css.includes(`#${PROGRESS_ID}`), 'CSS 必須包含 progress bar selector');
    assert.ok(css.includes('position: fixed'), 'progress bar 必須 fixed 定位');
    assert.ok(css.includes('height: 3px'), 'progress bar 高度 3px');
    assert.ok(css.includes('z-index: 2147483647'), 'z-index 最高');
    assert.ok(css.includes('pointer-events: none'), '不擋滑鼠事件');
  });

  it('light 主題 progress bar 色為 #4A90D9', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, theme: 'light' });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(css.includes('#4A90D9'), 'light 主題進度條色');
  });

  it('dark 主題 progress bar 色為 #7fb5e6', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, theme: 'dark' });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(css.includes('#7fb5e6'), 'dark 主題進度條色');
  });

  it('sepia 主題 progress bar 色為 #2c5282', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, theme: 'sepia' });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(css.includes('#2c5282'), 'sepia 主題進度條色');
  });

  it('restore() 移除 progress bar 元素', () => {
    const { document, NS, articleEl } = setup();
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.ok(document.getElementById(PROGRESS_ID), 'apply 後必須存在');
    NS.styler.restore(articleEl, snap);
    assert.strictEqual(document.getElementById(PROGRESS_ID), null, 'restore 後必須移除');
  });

  it('重複 apply() 不會產生多個 progress bar', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const bars = document.querySelectorAll(`#${PROGRESS_ID}`);
    assert.strictEqual(bars.length, 1, '只能有一個 progress bar');
  });
});
