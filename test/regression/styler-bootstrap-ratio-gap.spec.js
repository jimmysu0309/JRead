// JRead — Bootstrap .ratio aspect-ratio hack 撐空白修法（v0.7.206）
//
// Bug：thenewslens.com 進 reader mode 後標題與 hero image 之間出現 305px 空白。
//
// 根因：Bootstrap 5 的 .ratio class 用 ::before pseudo-element + padding-top 撐
// aspect ratio 空間，子 img 用 position:absolute 疊在 ::before 上方。JRead styler
// 強制 img { position: static !important } 破壞了這個 pattern，img 變成 flow layout
// 排在 ::before 下方，::before 的 padding-top 高度就變成空白。
//
// 通則修法：把 [class*="ratio" i] 加進既有的 aspect-ratio reset selector（跟
// picture / [class*="object-fit"] / [class*="placeholder"] 同等對待），reset
// aspect-ratio / padding / height，並用 ::before/::after content:none 殺掉 spacer。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'bootstrap-ratio-gap.html');

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

describe('styler — Bootstrap .ratio aspect-ratio hack 撐空白（v0.7.206 thenewslens）', () => {
  it('CSS 必須含 [class*="ratio" i] selector 在 aspect-ratio reset rule', () => {
    const css = getInjectedCss();
    assert.ok(/\[class\*="ratio"\s*i\]/.test(css),
      'CSS 必須含 [class*="ratio" i] selector');
  });

  it('ratio selector 的 rule 必須含 aspect-ratio: auto + height: auto + padding reset', () => {
    const css = getInjectedCss();
    const m = css.match(/\[class\*="ratio"\s*i\][^{]*\{([^}]*)\}/);
    assert.ok(m, '必須找到 [class*="ratio" i] rule 區塊');
    const body = m[1];
    assert.ok(/aspect-ratio\s*:\s*auto\s*!important/.test(body),
      'rule body 必須含 aspect-ratio: auto !important');
    assert.ok(/height\s*:\s*auto\s*!important/.test(body),
      'rule body 必須含 height: auto !important');
    assert.ok(/padding-bottom\s*:\s*0\s*!important/.test(body),
      'rule body 必須含 padding-bottom: 0 !important');
    assert.ok(/padding-top\s*:\s*0\s*!important/.test(body),
      'rule body 必須含 padding-top: 0 !important');
  });

  it('CSS 必須含 [class*="ratio" i]::before / ::after pseudo kill rule', () => {
    const css = getInjectedCss();
    assert.ok(/\[class\*="ratio"\s*i\]::before/.test(css),
      'CSS 必須含 [class*="ratio" i]::before selector');
    assert.ok(/\[class\*="ratio"\s*i\]::after/.test(css),
      'CSS 必須含 [class*="ratio" i]::after selector');
  });

  it('::before/::after pseudo rule 必須含 content: none + display: none + height: 0', () => {
    const css = getInjectedCss();
    const m = css.match(/\[class\*="ratio"\s*i\]::before[\s\S]*?\{([^}]*)\}/);
    assert.ok(m, '必須找到 ratio::before rule 區塊');
    const body = m[1];
    assert.ok(/content\s*:\s*none\s*!important/.test(body),
      'pseudo rule 必須含 content: none !important');
    assert.ok(/display\s*:\s*none\s*!important/.test(body),
      'pseudo rule 必須含 display: none !important');
    assert.ok(/height\s*:\s*0\s*!important/.test(body),
      'pseudo rule 必須含 height: 0 !important');
  });
});
