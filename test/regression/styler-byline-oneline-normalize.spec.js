// JRead — byline meta 區一行正規化（v1.0.8）
// -----------------------------------------------------------------------------
// Jimmy 2026-06-25 autocar 作者欄要求：reader mode 下站點 byline（kicker / 作者 /
// 日期 / 閱讀時間 / 小頭像）各自 block 散成多行、字級不一、頭像縮排。三要求：
//   1. 作者及日期整理成一行、字體格式一致
//   2. 不需要閱讀時間
//   3. 頭像與內容對齊
//
// 修法（結構訊號、非站點 class 特判）：偵測「標題與第一段內文（>= 120 chars 的 p）
// 之間、含日期訊號（<time> 或 date-regex 短文）」的 meta 區，往上爬到「不含第一段
// 內文、visible 文字 <= 200」的最高祖先 = byline root。標 BYLINE_ATTR=root（flex
// 一行）、WRAP=純 wrapper（display:contents 打平巢狀）、ITEM=可見 leaf（flex item）、
// RT=閱讀時間（CSS 隱藏）。只標 visible 元素（避免把站點隱藏的作者 hover card 重新
// 顯示）。多站驗證 autocar / npr / techcrunch / bbc / cna / newtalk。
//
// 訊號層次：偵測 + 標記不依賴 layout（textContent + compareDocumentPosition +
// visibility），jsdom 可驗。CSS flex 一行 / 頭像對齊的視覺結果由 page-rounds /
// debug-harness 在真實站驗（jsdom 無 layout engine）。
//
// forcing：byline root / wrap / item / rt 標記正確 + 閱讀時間命中 + 內文不被誤標
// + restore 移除標記與還原 inline display + 無日期訊號時不誤偵測。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'byline-oneline-normalize.html');
const SETTINGS = { theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0 };

function setup() {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 應有 <article>');
  const snapshot = env.NS.styler.apply(articleEl, SETTINGS);
  return { env, articleEl, snapshot };
}
const q = (env, t) => env.document.querySelector(`[data-test="${t}"]`);

describe('styler — byline 一行正規化 (v1.0.8)', () => {

  it('byline root 偵測 + 標 data-jread-byline + inline display:flex/row', () => {
    const { env } = setup();
    const root = q(env, 'byline-root');
    assert.strictEqual(root.getAttribute('data-jread-byline'), '1',
      'meta 區（含日期訊號、不含第一段內文的最高祖先）必須被標 byline root');
    assert.strictEqual(root.style.getPropertyValue('display'), 'flex',
      'root 必須 inline display:flex（覆蓋 cleaner collapse 的 block）');
    assert.strictEqual(root.style.getPropertyValue('flex-direction'), 'row',
      'root 必須 inline flex-direction:row（覆蓋站點/collapse 的 column → 一行）');
  });

  it('閱讀時間 item 標 data-jread-byline-rt（CSS 隱藏）', () => {
    const { env } = setup();
    const rt = q(env, 'readtime');
    assert.strictEqual(rt.getAttribute('data-jread-byline-rt'), '1',
      '「4 mins read」必須標 rt（CSS display:none 移除閱讀時間）');
    assert.strictEqual(rt.getAttribute('data-jread-byline-item'), '1',
      'rt 同時是 byline item');
  });

  it('kicker / 作者 / 日期 標 byline item；頭像不標（v1.7.25 頭像不顯示）', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'kicker').getAttribute('data-jread-byline-item'), '1', 'kicker 是 item');
    assert.strictEqual(q(env, 'author').getAttribute('data-jread-byline-item'), '1', '作者（有直接文字 by）是 item');
    // v1.7.25（Jimmy 2026-07-30）：byline 頭像一律不顯示——注入 CSS
    // `[data-jread-byline] img { display: none }` 讓頭像成為不可見 leaf、
    // item 掃描跳過不標（jsdom 會 resolve 注入 stylesheet 的 attr selector）
    assert.notStrictEqual(q(env, 'avatar').getAttribute('data-jread-byline-item'), '1',
      '頭像 img 不標 item（新政策：byline 頭像 display:none 藏掉）');
    assert.strictEqual(env.window.getComputedStyle(q(env, 'avatar')).display, 'none',
      '頭像 img computed display 必須是 none（byline 頭像不顯示的 forcing）');
    // 日期包在 <time>：pdate 是 wrap、time 是 item
    assert.strictEqual(q(env, 'date').getAttribute('data-jread-byline-item'), '1', '<time> 日期是 item');
  });

  it('byline item 內含直接文字 + 子元素時 CSS 補 column-gap 還原詞距（v1.0.18 space.com "ByTereza" 黏字）', () => {
    const { env } = setup();
    // author item = 「by <a>Matt Prior</a>」（直接文字 + 子連結），inline-flex 會
    // 把文字與連結變相鄰 flex item、吃掉空白；byline-item rule 必須帶 column-gap。
    const author = q(env, 'author');
    assert.strictEqual(author.getAttribute('data-jread-byline-item'), '1',
      '前提：含直接文字 + 子元素的 author 是 byline item');
    const styleEl = env.document.getElementById('__jread-style');
    assert.ok(styleEl, '必須注入 __jread-style');
    const m = styleEl.textContent.match(/\[data-jread-byline-item\][^{]*\{([^}]*)\}/);
    assert.ok(m, '必須找到 data-jread-byline-item rule 區塊');
    assert.ok(/column-gap\s*:\s*[0-9.]+em\s*!important/.test(m[1]),
      'byline-item rule 必須含 column-gap（還原 "By 作者" / "published 日期" 內部詞距）');
  });

  it('byline 子樹 font 統一 inherit（v1.0.20 culpium 作者 vs 日期字體/字級不同）', () => {
    // 站點常對作者連結與日期各設不同 font-family / font-size（culpium 實證：作者
    // 18px、日期 11px，且都非 reader 內文字體）。byline 正規化須把整條 byline 字體
    // 收斂到 root 的 reader 字體與字級。用 `font: inherit` shorthand 完整繼承
    // （family/size/weight/style/line-height），同時避開多站 typography spec 守的
    // 「預設不注入 font-family/font-size longhand override」不變式。jsdom 無字體
    // cascade resolution——驗注入 CSS 含 [byline] 子樹 font:inherit 規則；視覺一致
    // 由 debug-harness 在真實 culpium 驗（作者/日期由 SF Compact/11px → reader 字體/
    // 18px、translate-first 下 CJK 日期與作者同字體）。
    const { env } = setup();
    const styleEl = env.document.getElementById('__jread-style');
    assert.ok(styleEl, '必須注入 __jread-style');
    const m = styleEl.textContent.match(/\[data-jread-byline\]\s+\*\s*\{([^}]*)\}/);
    assert.ok(m, '必須有 [data-jread-byline] * 子樹字體統一規則');
    assert.ok(/(?:^|[;{\s])font\s*:\s*inherit\s*!important/.test(m[1]),
      'byline 子樹規則必須 font: inherit（shorthand 完整繼承 root reader 字體 + 字級，消除作者/日期字體與日期 11px 不一致）');
  });

  it('純 wrapper 標 byline wrap + inline display:contents（打平巢狀）', () => {
    const { env } = setup();
    const details = env.document.querySelector('.author-details');
    assert.strictEqual(details.getAttribute('data-jread-byline-wrap'), '1',
      '無直接文字、有子元素的 wrapper 必須標 wrap');
    assert.strictEqual(details.style.getPropertyValue('display'), 'contents',
      'wrap 必須 inline display:contents（讓 leaf 升為 root 的 flex item、一行排列）');
  });

  it('第一段內文不被誤標 byline（root 不含 body）', () => {
    const { env } = setup();
    const body = q(env, 'body');
    assert.strictEqual(body.getAttribute('data-jread-byline'), null, '內文 p 不可被標 byline root');
    assert.strictEqual(body.getAttribute('data-jread-byline-item'), null, '內文 p 不可被標 byline item');
    assert.ok(!body.closest('[data-jread-byline="1"]'), '內文 p 不可落在 byline root 子樹內');
  });

  it('restore 移除所有 byline 標記 + 還原 inline display', () => {
    const { env, articleEl, snapshot } = setup();
    env.NS.styler.restore(articleEl, snapshot);
    const root = q(env, 'byline-root');
    assert.strictEqual(root.getAttribute('data-jread-byline'), null, 'restore 移除 byline root 標記');
    assert.strictEqual(root.style.getPropertyValue('display'), '', 'restore 還原 root inline display（fixture 原無）');
    assert.strictEqual(root.style.getPropertyValue('flex-direction'), '', 'restore 還原 root inline flex-direction');
    assert.strictEqual(q(env, 'readtime').getAttribute('data-jread-byline-rt'), null, 'restore 移除 rt 標記');
    const details = env.document.querySelector('.author-details');
    assert.strictEqual(details.style.getPropertyValue('display'), '', 'restore 還原 wrap inline display:contents');
  });
});
