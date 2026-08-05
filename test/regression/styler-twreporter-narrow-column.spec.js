// JRead — twreporter sidebar-style 雙欄 layout 縮窄修法（v0.7.209）
//
// Bug：twreporter.org 進 reader mode 後：
// 1. 圖說（figcaption）被擠成 180px 窄欄（25% of cardW），每行 1-2 字
// 2. 內文 <p> 被固定成 480px（67% of cardW）+ 左偏，造成右側大片空白
//
// 根因：原站 layout 是主文 480px + 圖說 sidebar 180px 的雙欄設計。
// reader mode 下圖文回到單欄，但原站對 figcaption / p 設的 explicit width
// 殘留。現有 p rule 只有 max-width: 100%，擋上限但擋不掉 width: 480px 的
// 固定值；figcaption 完全沒有 width override。
//
// 修法：
// 1. p / h1-h6 / header / footer / nav rule 加 width: auto !important
// 2. 新增 figcaption rule: width: auto + max-width: 100%
//
// 通則安全：reader card single column 下這些 block-level content 都應跟容器
// 同寬。不碰 background/color/font，typography hierarchy 保留。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'twreporter-narrow-column.html');

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

describe('styler — twreporter sidebar-style 雙欄 layout 縮窄修法（v0.7.209）', () => {
  it('p / h1-h6 / header / footer / nav 共用 rule 必須含 width: auto !important', () => {
    const css = getInjectedCss();
    // 找含 max-width: 100% 與 min-width: 0 的 rule block（這是已知的共用 rule）
    const matches = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    let pRule = null;
    for (const m of matches) {
      const selectors = m[1];
      const body = m[2];
      // 命中含 p 且 max-width: 100% 且 min-width: 0 的 rule
      if (/\bp\s*,/.test(selectors) && /max-width\s*:\s*100%\s*!important/.test(body)
          && /min-width\s*:\s*0\s*!important/.test(body)) {
        pRule = body;
        break;
      }
    }
    assert.ok(pRule, '必須找到含 p, max-width: 100%, min-width: 0 的共用 rule');
    assert.ok(/\bwidth\s*:\s*auto\s*!important/.test(pRule),
      '共用 rule 必須含 width: auto !important（破原站 styled-components width: 480px）');
  });

  it('CSS 必須含 figcaption width: auto + max-width: 100% rule', () => {
    const css = getInjectedCss();
    // v1.7.43 T11：width: auto 由 v1.6.20 position hack 規則（figcaption 與後代
    // 全蓋）統一注入；本 rule 專責 max-width。此處驗兩條合起來仍覆蓋
    // 「width: auto + max-width: 100%」的完整語意（缺一即 twreporter 180px
    // sidebar caption 破版回歸）。
    const combo = css.match(/figcaption,\s*\n?\[data-jread-active="1"\]\s+figcaption \*\s*\{([^}]*)\}/);
    assert.ok(combo, '必須找到 figcaption + figcaption * 共用 rule（v1.6.20 position hack）');
    assert.ok(/\bwidth\s*:\s*auto\s*!important/.test(combo[1]),
      'figcaption 共用 rule 必須含 width: auto !important（破原站 width: 180px sidebar caption）');
    const m = css.match(/\[data-jread-active="1"\]\s+figcaption\s*\{([^}]*)\}/);
    assert.ok(m, '必須找到 [data-jread-active="1"] figcaption rule');
    assert.ok(/max-width\s*:\s*100%\s*!important/.test(m[1]),
      'figcaption rule 必須含 max-width: 100% !important');
  });
});
