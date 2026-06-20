// JRead — drop cap（::first-letter）顏色跟隨主文文字色（v0.8.137）
//
// Bug：theverge.com/column/... 進 reader mode 後首段「段落首字不見了」
// （Jimmy 2026-06-20 截圖回報，"Another" 變 "nother"、"On" 變 "n"）。
//
// 根因（cage probe 實證）：The Verge 暗色站對首段 ::first-letter 設顯式
// color: white + -webkit-text-fill-color: white 做 96px float drop cap。reader mode
// 把段落文字色覆寫成 theme.text（深色），但 ::first-letter 是獨立 pseudo-element、
// 不繼承我們對段落的 color override → 站點白字殘留 → 淺底白字 drop cap 隱形
// （float 仍占位 → 首字位置空一格，看似首字消失）。
//
// 通則修法（結構訊號、非 class/hostname 特判，符合硬規則 3）：對主文所有
// ::first-letter 注入 color: inherit + -webkit-text-fill-color: currentColor，跟隨
// 已被 reader 覆寫的段落色，蓋過站點顯式 drop cap 色。
//
// 訊號層次：本 spec 驗 styler 注入的 CSS 字串含該 ::first-letter rule（jsdom 不
// 計算 pseudo-element 顏色）；實際 white→dark 視覺由 cage probe 實證
// （flColor rgb(255,255,255) → rgb(26,26,26)）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'flex-text-column-decollapse.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function getInjectedCss(settings) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  env.NS.styler.apply(detected.el, settings || DEFAULT_SETTINGS);
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl, '必須注入 __jread-style');
  // 先剝掉 CSS 註解——否則註解內提到的 ::first-letter / color 字串會讓 spec 變偽綠
  // （驗到註解而非真 rule selector）。
  return styleEl.textContent.replace(/\/\*[\s\S]*?\*\//g, '');
}

// 抓含 ::first-letter 的 rule 區塊
function getFirstLetterRule(css) {
  const m = css.match(/([^{}]*::first-letter[^{]*)\{([^}]*)\}/);
  return m ? { sel: m[1].trim(), body: m[2] } : null;
}

describe('styler — drop cap ::first-letter 顏色跟隨主文（v0.8.137 The Verge）', () => {
  it('CSS 必須含主文 ::first-letter rule（核心修法）', () => {
    const css = getInjectedCss();
    assert.ok(/::first-letter/.test(css), 'CSS 必須注入 ::first-letter rule');
    const rule = getFirstLetterRule(css);
    assert.ok(rule, '必須找到 ::first-letter rule 區塊');
    assert.ok(/\[data-jread-active="1"\]/.test(rule.sel),
      '::first-letter rule 必須 gate 在主文容器 [data-jread-active="1"]');
  });

  it('rule body 必須含 color: inherit + -webkit-text-fill-color: currentColor', () => {
    const rule = getFirstLetterRule(getInjectedCss());
    assert.ok(/color\s*:\s*inherit\s*!important/.test(rule.body),
      'rule body 必須含 color: inherit !important（drop cap 跟隨段落色）');
    assert.ok(/-webkit-text-fill-color\s*:\s*currentColor\s*!important/.test(rule.body),
      'rule body 必須含 -webkit-text-fill-color: currentColor !important（蓋過站點 text-fill）');
  });

  it('::first-letter rule 三個 theme 都注入（不分主題）', () => {
    for (const theme of ['light', 'dark', 'sepia']) {
      const css = getInjectedCss({ ...DEFAULT_SETTINGS, theme });
      assert.ok(/::first-letter/.test(css),
        `${theme} theme 也必須注入 ::first-letter rule（pseudo-element 不被 * { color } 選到）`);
    }
  });
});
