// JRead — byline 發稿時刻隱藏 + 節目出處清除 + 作者排序（v1.5.28）
// -----------------------------------------------------------------------------
// Jimmy 2026-07-02 NPR 回報三輪：
//   1. 閱讀模式 byline 顯示「June 1, 2026 · 1:59 PM ET」，發稿時刻是雜訊要拿掉
//   2.「HEARD ON MORNING EDITION」高度沒對齊、且要清掉（廣播節目出處非必要）
//   3. 作者應排在日期前面
// 最終 byline = 「作者 → 日期」一行、baseline 對齊（root align-items:baseline 由
//   styler-byline-oneline-normalize 生效，視覺對齊由 debug-harness 在真實 NPR 驗）。
//
// 修法（結構訊號、非站點 class 特判）：byline root 偵測後掃 root 全部後代，找
// 「整段直接文字＝純時刻（HH:MM(:SS)? AM/PM? TZ?）」的葉元素標
// data-jread-byline-time（CSS display:none）。用 bdirect（只看直接文字）鎖定葉
// 元素、避免誤中含日期的父層（<time> 直接文字為空白不命中）；BYLINE_TIME_RE 以
// 冒號為關鍵區分時刻與日期（日期無冒號）。安全閘：隱藏後 root 仍須有日期訊號才
// 動手，不誤刪唯一時間錨。
//
// 訊號層次：偵測 + 標記不依賴 layout（textContent + visibility），jsdom 可驗。
// CSS display:none 的視覺結果由 debug-harness 在真實 NPR 驗（jsdom 無 layout）。
//
// forcing：時刻 span 標 byline-time + 日期 span 不被誤標 + restore 移除標記 +
// CSS 含隱藏規則。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'byline-time-of-day.html');
const SETTINGS = { theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0 };

function setup() {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 應有 <article>');
  const snapshot = env.NS.styler.apply(articleEl, SETTINGS);
  return { env, articleEl, snapshot };
}
const q = (env, t) => env.document.querySelector(`[data-test="${t}"]`);

describe('styler — byline 發稿時刻隱藏 (v1.5.28)', () => {

  it('前提：byline root 被偵測（含日期訊號的 meta 區）', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'byline-root').getAttribute('data-jread-byline'), '1',
      '#story-meta（含 <time> 日期訊號、不含第一段內文）必須被標 byline root');
  });

  it('時刻 span「1:59 PM ET」標 data-jread-byline-time（CSS 隱藏）', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'time-part').getAttribute('data-jread-byline-time'), '1',
      '純時刻子元素必須標 byline-time（CSS display:none 移除發稿時刻）');
  });

  it('日期 span「June 1, 2026」不被誤標（保留日期）', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'date-part').getAttribute('data-jread-byline-time'), null,
      '日期字串無冒號、不匹配時刻 regex，不可被隱藏');
  });

  it('外層 <time>（直接文字為空白）不被誤標', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'date').getAttribute('data-jread-byline-time'), null,
      '<time> 直接文字為空白（子 span 才有文字），bdirect 不命中、不可整支隱藏');
  });

  it('作者不被誤標時刻', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'author').getAttribute('data-jread-byline-time'), null,
      '作者名不是時刻字串');
  });

  it('注入 CSS 含 byline-time 隱藏規則', () => {
    const { env } = setup();
    const styleEl = env.document.getElementById('__jread-style');
    assert.ok(styleEl, '必須注入 __jread-style');
    const m = styleEl.textContent.match(/\[data-jread-byline-time\][^{]*\{([^}]*)\}/);
    assert.ok(m, '必須有 data-jread-byline-time rule 區塊');
    assert.ok(/display\s*:\s*none\s*!important/.test(m[1]),
      'byline-time rule 必須 display:none（隱藏發稿時刻）');
  });

  it('廣播節目出處 chip「Heard on …」標 data-jread-byline-program（CSS 隱藏）', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'program').getAttribute('data-jread-byline-program'), '1',
      '「Heard on Morning Edition」以節目出處句式開頭，必須標 program（CSS display:none）');
  });

  it('注入 CSS 含 byline-program 隱藏規則', () => {
    const { env } = setup();
    const css = env.document.getElementById('__jread-style').textContent;
    const m = css.match(/\[data-jread-byline-program\][^{]*\{([^}]*)\}/);
    assert.ok(m && /display\s*:\s*none\s*!important/.test(m[1]),
      'byline-program rule 必須 display:none');
  });

  it('日期 item 標 data-jread-byline-date-item + CSS order:1（作者排日期前）', () => {
    const { env } = setup();
    // 日期 item = 含 <time> 的 byline item（本 fixture 即 <time> 自身）
    const dateItem = q(env, 'date');
    assert.strictEqual(dateItem.getAttribute('data-jread-byline-date-item'), '1',
      '日期 item 必須標 date-item（CSS order:1 推到最後）');
    const css = env.document.getElementById('__jread-style').textContent;
    const m = css.match(/\[data-jread-byline-date-item\][^{]*\{([^}]*)\}/);
    assert.ok(m && /order\s*:\s*1\s*!important/.test(m[1]),
      'date-item rule 必須 order:1（日期排最後 → 作者等 order:0 item 在前）');
  });

  it('作者不被標 date-item（維持預設 order:0 排前）', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'author').getAttribute('data-jread-byline-date-item'), null,
      '作者不是日期 item，維持預設 order:0 排在日期前');
  });

  it('標題前的分類 kicker「Business」（連 /sections/）標 data-jread-kicker（CSS 隱藏）', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'kicker').getAttribute('data-jread-kicker'), '1',
      'H1 之前、連 /sections/business/ 的短連結 wrapper 必須標 kicker（往上爬到 slug-wrap）');
    const css = env.document.getElementById('__jread-style').textContent;
    const m = css.match(/\[data-jread-kicker\][^{]*\{([^}]*)\}/);
    assert.ok(m && /display\s*:\s*none\s*!important/.test(m[1]), 'kicker rule 必須 display:none');
  });

  it('標題 H1 不被 kicker 規則誤標（保留標題）', () => {
    const { env } = setup();
    const h1 = env.document.querySelector('article h1');
    assert.strictEqual(h1.getAttribute('data-jread-kicker'), null, '標題不可被當 kicker 隱藏');
  });

  it('restore 移除時刻 / program / date-item / kicker 標記（可逆）', () => {
    const { env, articleEl, snapshot } = setup();
    env.NS.styler.restore(articleEl, snapshot);
    assert.strictEqual(q(env, 'time-part').getAttribute('data-jread-byline-time'), null,
      'restore 移除 byline-time 標記');
    assert.strictEqual(q(env, 'program').getAttribute('data-jread-byline-program'), null,
      'restore 移除 byline-program 標記');
    assert.strictEqual(q(env, 'date').getAttribute('data-jread-byline-date-item'), null,
      'restore 移除 date-item 標記');
    assert.strictEqual(q(env, 'kicker').getAttribute('data-jread-kicker'), null,
      'restore 移除 kicker 標記');
  });

  it('sanity：時刻 regex 匹配時刻、排除日期', () => {
    // 不變式守 BYLINE_TIME_RE 的判別邊界（冒號為關鍵）。regex 常數不外露，這裡
    // 用等價 pattern 驗設計意圖：時刻含冒號命中、日期無冒號不命中。
    const RE = /^\d{1,2}:\d{2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\s*[a-z]{0,5}$/i;
    ['1:59 PM ET', '13:59', '9:30 a.m. EST', '11:05 PM'].forEach(s =>
      assert.ok(RE.test(s), `時刻應命中：${s}`));
    ['June 1, 2026', '2026-06-01', '13 June 2026', 'Andrea Hsu'].forEach(s =>
      assert.ok(!RE.test(s), `日期/作者不應命中：${s}`));
  });
});
