// JRead — regression spec: dark/sepia 前景背景成對覆寫 + contrast 兜底層 (v0.8.45)
// -----------------------------------------------------------------------------
// Forcing function for v0.8.45 修法（2026-06-11 page rounds 第四輪 dark E1
// 12 站整治）。
//
// Root cause 兩個互補半邊（都在 styler dark theme）：
//   A 群（暗底暗字）：dark 字色覆寫 `*:not(figcaption)` 排除 figcaption
//     （v0.7.195 light 成對保留邏輯誤用在 dark）→ 原站白底設計的深灰圖說
//     疊暗卡 ratio 1.7-2.7；另有站點高 specificity !important rule（twz
//     (0,3,0)）cascade 上贏過 jread，stylesheet 軍備競賽無解。
//   B 群（亮底亮字）：BG_PRESERVE 保留 figure/figcaption/table 系自帶亮底，
//     dark 把字覆寫成亮灰 → ratio 1.3-1.5（wikipedia thumb/mbox、sspai TH）。
//
// v0.8.45 修法三件組：
//   1. dark 字色覆寫移除 :not(figcaption)（成對保留 → 成對覆寫）
//   2. 背景中和規則由 blockquote/pre/code 擴到 figure/figcaption/summary/
//      table 系（群組常數生成防 drift）
//   3. apply() phase 3 兜底層：直接文字載體對 effective bg 對比 < 3:1 時
//      inline !important 修字色（終結 cascade 輸局）；effective bg 按
//      「中和後目標狀態」算、不照當下 computed（SPA hydration 期 cascade
//      會翻轉，sspai TH instrument 實證）
//
// jsdom 不解析 stylesheet cascade——fixture 用 inline style 模擬「站點贏局」
// 的 computed 值；CSS 注入部分驗 stylesheet 字串、runtime 部分驗 inline 修色。
//
// 訊號層次：本 spec 驗「CSS 規則存在 + 兜底層 inline 修色行為 + 還原」，
// 不驗真實 cascade 勝負與視覺（那層走 page-rounds harness dark contrast audit）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'dark-contrast-pairs.html');

function setup(themeName) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須在 fixture 上選到 article');
  const settings = {
    theme: themeName,
    fontSize: 18,
    contentWidth: 720,
    fontFamily: 'system-ui',
    lineHeight: 1.7
  };
  const snapshot = env.NS.styler.apply(detected.el, settings);
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl);
  return { env, detected, snapshot, css: styleEl.textContent };
}

describe('styler — dark/sepia 前景背景成對覆寫 + contrast 兜底層 (v0.8.45)', () => {
  // 中和規則：selector 含 figcaption / th 且 body 是 background transparent。
  // `[^{]*` 容忍 comma list（figure, figcaption, ..., td 共用 rule body）。
  const FIGCAPTION_BG_RULE = /html\.__jread-active\s+\[data-jread-active="1"\]\s+figcaption\b[^{]*\{[^}]*background-color:\s*transparent\s*!important/i;
  const TH_BG_RULE = /html\.__jread-active\s+\[data-jread-active="1"\]\s+th\b[^{]*\{[^}]*background-color:\s*transparent\s*!important/i;

  it('(a) dark theme: figcaption / th 背景中和規則存在', () => {
    const { css } = setup('dark');
    assert.ok(FIGCAPTION_BG_RULE.test(css),
      'dark stylesheet 必須含 figcaption background transparent 規則（B 群亮底中和）');
    assert.ok(TH_BG_RULE.test(css),
      'dark stylesheet 必須含 th background transparent 規則（sspai 表頭亮底）');
  });

  it('(b) dark theme: 字色覆寫不再排除 figcaption（成對覆寫）', () => {
    const { css } = setup('dark');
    // v0.7.195 的排除寫法是 `[data-jread-active="1"] *:not(figcaption)`；
    // v0.8.45 起 dark 字色覆寫對全元素生效。只檢查「color 覆寫那條 rule」
    // 不再帶 :not(figcaption)——背景中和規則之後 figcaption 沒有理由保留
    // 原站深灰字。
    const darkColorRule = css.match(/\[data-jread-active="1"\],\s*\[data-jread-active="1"\]\s+\*([^{]*)\{[^}]*color:/);
    assert.ok(darkColorRule, 'dark theme 必須有全元素字色覆寫 rule');
    assert.ok(!/:not\(figcaption\)/.test(darkColorRule[1]),
      'dark 字色覆寫不可排除 figcaption——排除會讓原站深灰圖說留在暗卡上（A 群 6 站實證）');
  });

  it('(c) light theme: 不注入 dark 中和規則群、兜底層不跑（圖說正規化改走 v0.8.169 light rule）', () => {
    const { css, env } = setup('light');
    // FIGCAPTION_BG_RULE 比對的是 dark 的 html.__jread-active 前綴中和規則群——
    // 那組 light 不該有。light theme 的 figcaption 背景正規化改由
    // `[data-jread-active="1"] figcaption` rule 承載（v0.8.169，配 v0.8.123 #333
    // 字色成對），見 styler-light-figcaption-bg-normalize.spec.js。
    assert.ok(!FIGCAPTION_BG_RULE.test(css),
      'light theme 不該注入 dark 的 html.__jread-active 中和規則群');
    // 兜底層（apply phase 3）在 light 不跑（theme.text 為 null）——inline 色不被動，
    // light 的圖說正規化是靜態 CSS 規則、不是 runtime inline 修色
    const cap = env.document.getElementById('cap');
    assert.strictEqual(cap.style.getPropertyValue('color'), 'rgb(84, 86, 88)',
      'light theme 兜底層不可動 figcaption inline 原站色');
  });

  it('(d) dark 兜底層: 站點 cascade 贏局的深灰文字被 inline !important 修色', () => {
    const { env } = setup('dark');
    // jsdom 不套 stylesheet → computed color 停在 inline 深灰 = 模擬站點
    // !important 贏局（twz author-bio 實案）。兜底層必須 inline 修掉。
    const bio = env.document.getElementById('bio-span');
    assert.strictEqual(bio.style.getPropertyValue('color'), 'rgb(236, 235, 241)',
      '深灰 on 暗卡 ratio 2.55 < 3 的文字載體必須被兜底層 inline 修成 theme.text');
    assert.strictEqual(bio.style.getPropertyPriority('color'), 'important',
      '修色必須帶 !important（inline important 是 author origin 最高優先級）');
  });

  it('(e) dark 兜底層: 連結內文字用 link 色變體（雙通道辨識）', () => {
    const { env } = setup('dark');
    const linkSpan = env.document.getElementById('bio-link-span');
    assert.strictEqual(linkSpan.style.getPropertyValue('color'), 'rgb(127, 181, 230)',
      '低對比的連結文字要修成 theme.link（不是正文色），維持連結與正文的辨識');
  });

  it('(f) dark 兜底層: 亮底 th 的 effective bg 按中和後目標狀態算', () => {
    const { env } = setup('dark');
    // sspai instrument 實證：phase 3 跑的當下 th 自帶亮底還在（SPA cascade
    // 時序），照當下值會修出「亮底深字」、之後中和生效變「暗底深字」ratio 1。
    // 正解：th 是中和清單成員，effective bg 跳過它的亮底 → 以暗卡為底 →
    // 站點深字 rgb(51,51,51) ratio < 3 → 修成 theme.text（亮字），不是深字。
    const th = env.document.getElementById('th-cell');
    assert.strictEqual(th.style.getPropertyValue('color'), 'rgb(236, 235, 241)',
      'th 的修色必須配「中和後的暗卡底」（theme.text 亮字），不可配當下還亮著的底選深字');
  });

  it('(g) restore: 兜底層 inline 修色完整還原', () => {
    const { env, detected, snapshot } = setup('dark');
    const bio = env.document.getElementById('bio-span');
    assert.strictEqual(bio.style.getPropertyValue('color'), 'rgb(236, 235, 241)');
    env.NS.styler.restore(detected.el, snapshot);
    assert.strictEqual(bio.style.getPropertyValue('color'), 'rgb(84, 92, 96)',
      'restore 後 inline color 必須回到站點原值');
    const th = env.document.getElementById('th-cell');
    assert.strictEqual(th.style.getPropertyValue('color'), 'rgb(51, 51, 51)',
      'restore 後 th inline color 必須回到站點原值');
  });
});
