// JRead — byline 頭像 <picture> margin reset（v1.0.19）
// -----------------------------------------------------------------------------
// Jimmy 2026-06-26 culpium.com 回報：頭像、作者及日期的排版散開。
//
// 根因（debug-harness probe 實證）：Substack post-header byline 的頭像是
// <picture> 包 <img>、flex item 是 picture。reader mode 的 hero 媒體置中通則
// （[ARTICLE] picture:not([player]) { margin-left/right: auto }，specificity
// (0,2,1)）會把 byline 頭像 picture 也當區塊媒體置中。在 byline flex 一行內，
// auto margin 解析成「吃光自由空間」（實測頭像 margin 兩側各 190px），
// justify-content:flex-start 因無自由空間可分配而失效，頭像被推到列中央、
// 作者/日期散開。
//
// 修法（結構訊號、非站點特判）：byline 媒體（picture/img/video）用 doubled
// [byline] attr 把 specificity 提到 (0,3,1) 壓過置中通則 (0,2,1)、鎖 margin:0
// + flex:0 0 auto，靠 root 的 flex-start 把頭像 + 作者 + 日期左排成一行。
//
// 訊號層次：jsdom 無 layout engine——本 spec 驗「picture 被標 byline item」+
// 「注入 CSS 含 byline 媒體 margin-reset 規則（doubled-attr specificity 簽名 +
// 排在置中通則之後）」。真實左排幾何由 debug-harness 在 culpium.com 驗
// （頭像 margin 190px→0、avatar x 從 528 歸位到 markedRoot 左緣 336）。
//
// forcing：移除 doubled-[byline] media margin-reset 規則 → 本 spec fail。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'byline-avatar-picture-margin.html');
const SETTINGS = { theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0 };

function setup() {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 應有 <article>');
  const snapshot = env.NS.styler.apply(articleEl, SETTINGS);
  return { env, articleEl, snapshot };
}
const q = (env, t) => env.document.querySelector(`[data-test="${t}"]`);

describe('styler — byline 頭像 <picture> margin reset (v1.0.19)', () => {

  it('byline root 偵測 + 頭像 picture 藏掉（v1.7.25 頭像不顯示）', () => {
    const { env } = setup();
    const root = q(env, 'byline-root');
    assert.strictEqual(root.getAttribute('data-jread-byline'), '1',
      'post-header（含日期訊號、不含第一段內文）必須被標 byline root');
    // v1.7.25（Jimmy 2026-07-30）：byline 頭像一律不顯示——`[data-jread-byline]
    // picture { display: none }` 藏掉整個頭像 picture，item 掃描跳過不標。
    // v1.0.19 的 margin reset 議題（頭像被 hero 置中通則推到列中央）隨頭像
    // 隱藏而不復存在；margin-reset 規則仍保留給 byline 內 video（見 styler）
    const pic = q(env, 'avatar-picture');
    assert.strictEqual(env.window.getComputedStyle(pic).display, 'none',
      '頭像 <picture> computed display 必須是 none（byline 頭像不顯示的 forcing）');
    assert.notStrictEqual(pic.getAttribute('data-jread-byline-item'), '1',
      '頭像 picture 不標 item（display:none leaf 不進 item 掃描）');
  });

  it('注入 CSS 含 byline 媒體 margin-reset 規則（doubled-attr specificity 壓過 hero 置中通則）', () => {
    const { env } = setup();
    const styleEl = env.document.getElementById('__jread-style');
    assert.ok(styleEl, '必須注入 __jread-style');
    const css = styleEl.textContent;

    // 1) byline 媒體 margin-reset 規則：doubled [data-jread-byline] attr + picture，
    //    rule body 含 margin:0。doubled attr 是 specificity 簽名（壓過置中通則
    //    [ARTICLE] picture 的 0,2,1）——移除任一 attr 即 fail。
    const re = /\[data-jread-byline\]\[data-jread-byline\]\s+picture[^{]*\{([^}]*)\}/;
    const m = css.match(re);
    assert.ok(m, '必須有 [data-jread-byline][data-jread-byline] picture 規則（doubled-attr 提 specificity）');
    assert.ok(/margin\s*:\s*0\s*!important/.test(m[1]),
      'byline 媒體規則必須鎖 margin:0 !important（抵銷 hero 置中通則的 margin:auto）');

    // 2) hero 媒體置中通則確實存在（前提：byline 規則要壓的對象）。doubled-attr
    //    specificity (0,3,1) 決定性壓過置中通則 (0,2,1)——與兩條規則的 source
    //    order 無關（probe 實證：byline 規則在置中通則之前、仍因 specificity 勝、
    //    頭像 margin 190px→0）。
    const centerIdx = css.search(/\[data-jread-active="1"\]\s+picture[^{]*\{[^}]*margin-left\s*:\s*auto/);
    assert.ok(centerIdx >= 0, '前提：必須有 hero 媒體置中通則（picture margin-left:auto）');
  });

  it('restore 移除 byline 標記', () => {
    const { env, articleEl, snapshot } = setup();
    env.NS.styler.restore(articleEl, snapshot);
    assert.strictEqual(q(env, 'byline-root').getAttribute('data-jread-byline'), null,
      'restore 移除 byline root 標記');
    assert.strictEqual(q(env, 'avatar-picture').getAttribute('data-jread-byline-item'), null,
      'restore 移除頭像 picture 的 byline item 標記');
  });
});
