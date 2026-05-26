// JRead — ancestor 非 ancestor 子元素隱藏 regression spec（v0.7.192）
// chinatalk.media site header "ChinaTalk" 殘留在 reader card 頂端——ancestor
// reset 只清自身樣式、不隱藏子元素。通則：ancestor 直接子非 ancestor 非 article
// 一律 display:none。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected);
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

describe('styler — ancestor 非 ancestor 子元素隱藏', () => {
  it('CSS 包含 ancestor > non-ancestor 隱藏規則', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(
      css.includes('[data-jread-ancestor="1"] > *:not([data-jread-ancestor="1"]):not([data-jread-active="1"])'),
      'CSS 必須包含 ancestor 子元素隱藏 selector'
    );
    assert.ok(
      css.includes('display: none !important'),
      'ancestor 非 ancestor 子必須 display:none'
    );
  });

  it('ancestor 的非 ancestor 子元素在 jsdom 下被 CSS rule 覆蓋（結構驗證）', () => {
    const { document, NS, articleEl } = setup();
    // 在 ancestor 內插入模擬 site header（非 ancestor、非 article）
    const ancestor = articleEl.parentElement;
    assert.ok(ancestor, 'article 必須有 parent');
    const fakeHeader = document.createElement('div');
    fakeHeader.id = 'fake-site-header';
    fakeHeader.textContent = 'SiteName';
    ancestor.insertBefore(fakeHeader, articleEl);

    NS.styler.apply(articleEl, DEFAULT_SETTINGS);

    assert.strictEqual(ancestor.getAttribute('data-jread-ancestor'), '1',
      'parent 必須是 ancestor');
    assert.strictEqual(fakeHeader.getAttribute('data-jread-ancestor'), null,
      'fakeHeader 不是 ancestor');
    assert.strictEqual(fakeHeader.getAttribute('data-jread-active'), null,
      'fakeHeader 不是 article');
    // CSS selector [data-jread-ancestor] > *:not(...) 會命中 fakeHeader
    // jsdom 不算 computed style，但 CSS 結構正確即保證瀏覽器行為
  });

  it('restore() 後 ancestor 標記全清、CSS 規則移除', () => {
    const { document, NS, articleEl } = setup();
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.restore(articleEl, snap);
    const css = document.getElementById('__jread-style');
    assert.strictEqual(css, null, 'style 元素必須移除');
    const ancestor = articleEl.parentElement;
    assert.strictEqual(ancestor.getAttribute('data-jread-ancestor'), null,
      'ancestor 標記必須清除');
  });
});
