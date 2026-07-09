// JRead — styler v1.6.24：全面 code review 修法批次
//
// 四組修法（2026-07-08 review，probe 於真實 Chromium 實證）：
//
// 1. CJK justify / decor 標記順序：markCjkParagraphs / markDecorativeInlines 的
//    `closest([BYLINE_ATTR], [KICKER_ATTR])` 排除 guard 需要 byline 標記已存在，
//    舊順序跑在 byline 標記之前 → guard 死的 → 中文 byline（「文／王小明」漢字
//    >= 4、CJK 佔比 >= 0.3）被標 cjk-justify 而 justify（justify 規則在
//    userOverrides、byline text-align:left 在 base，同 specificity 後注入者勝）。
//
// 2. 翻頁模式 cardRight 幾何 gate：v0.8.136 overflow de-column 與 v0.8.101
//    wideScroll 都以 articleEl rect.right 判「溢出右緣」——翻頁 multicol card
//    （position:fixed + column-width）第 2 欄起所有元素 rect.right 天然超過
//    card 右緣（probe 實證正常 flex-row / 窄 table 全被誤判），兩 pass 必須
//    gate 在 !opts.pagedMode。
//
// 3. BYLINE_DATE_RE 第二 alternative 補 \b（"Demar 3, 2024" 內的 "mar 3, 2024"
//    子字串不可命中）。
//
// 4. base skeleton cache key 補 readerHostPage（卡片上緣 padding 依它分流、
//    住在被 cache 的 base 模板內——key 沒帶會回 stale padding）。
//    ——key 結構由 styler-base-skeleton-memoize.spec.js 驗，此處驗行為。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const STYLER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'styler.js'), 'utf8'
);
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'styler-cjk-byline-order.html');
const SETTINGS = { theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0 };

describe('styler v1.6.24 — CJK 標記在 byline 標記之後（排除 guard 生效）', () => {
  function setup() {
    const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
    const articleEl = env.document.querySelector('article');
    env.NS.styler.apply(articleEl, SETTINGS);
    return env;
  }
  const q = (env, t) => env.document.querySelector(`[data-test="${t}"]`);

  it('前提：byline root 有被標記（fixture 結構有效）', () => {
    const env = setup();
    assert.strictEqual(q(env, 'byline-root').getAttribute('data-jread-byline'), '1',
      'fixture 的 meta 區必須被偵測為 byline root（前提不成立則本組 spec 無效）');
  });

  it('byline 內的中文作者列不得被標 cjk-justify', () => {
    const env = setup();
    assert.notStrictEqual(q(env, 'byline-author').getAttribute('data-jread-cjk-justify'), '1',
      '中文 byline 被標 cjk-justify——mark 執行順序回到 byline 標記之前（guard 死了）');
  });

  it('對照組：主文中文段落仍要被標 cjk-justify（guard 不過寬）', () => {
    const env = setup();
    assert.strictEqual(q(env, 'body-cjk').getAttribute('data-jread-cjk-justify'), '1',
      '一般中文內文段落必須照常標 cjk-justify');
  });

  it('source 順序 forcing：markCjkParagraphs / markDecorativeInlines 呼叫必須在 bylineMarks 區塊之後', () => {
    // v1.6.27：bylineMarks 宣告提升到 apply 開頭，順序 forcing 改錨「填入點」
    const bylineIdx = STYLER_SRC.indexOf('bylineMarks.push({ el, attr })');
    const cjkIdx = STYLER_SRC.indexOf('cjkJustifyMarked = markCjkParagraphs(articleEl)');
    const decorIdx = STYLER_SRC.indexOf('decorResetMarked = markDecorativeInlines(articleEl)');
    assert.ok(bylineIdx > 0 && cjkIdx > 0 && decorIdx > 0, '三個錨點都必須存在');
    assert.ok(cjkIdx > bylineIdx, 'markCjkParagraphs 必須在 byline 標記之後呼叫');
    assert.ok(decorIdx > bylineIdx, 'markDecorativeInlines 必須在 byline 標記之後呼叫');
  });
});

describe('styler v1.6.24 — 翻頁模式 cardRight 幾何 pass gate', () => {
  it('v0.8.136 overflow de-column 區塊必須 gate 在 !opts.pagedMode', () => {
    // 錨在該區塊特徵字（overflowAncestors）往前 600 字內必須出現 gate
    const idx = STYLER_SRC.indexOf('const overflowAncestors = new Set()');
    assert.ok(idx > 0, '找不到 v0.8.136 overflow de-column 區塊');
    const before = STYLER_SRC.slice(Math.max(0, idx - 600), idx);
    assert.match(before, /if\s*\(!opts\.pagedMode\)/,
      'v0.8.136 pass 缺 pagedMode gate——multicol 第 2 欄起全被誤判溢出');
  });

  it('v0.8.101 wideScroll 區塊必須 gate 在 !opts.pagedMode', () => {
    // v1.6.27：wideScroll 宣告提升到 apply 開頭，gate forcing 改錨填入點往前找
    const idx = STYLER_SRC.indexOf('wideScroll.push({');
    assert.ok(idx > 0, '找不到 wideScroll 區塊');
    // gate 在填入點之前（區塊註解 + 掃描迴圈約 2K 字），往前窗找
    const before = STYLER_SRC.slice(Math.max(0, idx - 2500), idx);
    assert.match(before, /if\s*\(!opts\.pagedMode\)/,
      'wideScroll pass 缺 pagedMode gate——multicol 第 2 欄起的 table/pre 全被誤套');
  });
});

describe('styler v1.6.24 — BYLINE_DATE_RE 第二 alternative 補 \\b', () => {
  it('"mar 3, 2024" 在單字內不得命中；正常 "Mar 3, 2024" 照常命中', () => {
    const m = STYLER_SRC.match(/const BYLINE_DATE_RE = (\/.+\/i);/);
    assert.ok(m, '抓不到 BYLINE_DATE_RE');
    const re = eval(m[1]);
    assert.strictEqual(re.test('Demar 3, 2024 是人名不是日期'), false,
      '"Demar 3, 2024" 的 "mar 3, 2024" 子字串誤命中——第二 alternative 缺 \\b');
    assert.strictEqual(re.test('Mar 3, 2024'), true, '正常 Mon DD, YYYY 必須命中');
    assert.strictEqual(re.test('13 June 2026'), true, 'DD Mon YYYY 必須命中');
    assert.strictEqual(re.test('2026-07-08'), true, 'ISO 日期必須命中');
    assert.strictEqual(re.test('2026 年 7 月 8 日'), true, '中文日期必須命中');
  });
});

describe('styler v1.6.24 — readerHostPage 進 base cache key（行為）', () => {
  it('同 (theme, contentWidth) 下 readerHostPage true/false 產生不同上緣 padding', () => {
    const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
    const articleEl = env.document.querySelector('article');
    const cssOf = (readerHostPage) => {
      env.NS.state.readerHostPage = readerHostPage;
      env.NS.styler.apply(articleEl, SETTINGS);
      const css = env.document.getElementById('__jread-style').textContent;
      env.NS.styler.restore(articleEl);
      return css;
    };
    const normal = cssOf(false);
    const reader = cssOf(true);
    assert.notStrictEqual(normal, reader,
      'readerHostPage 變化必須產生不同 base（cache key 沒帶 readerHostPage 會回 stale padding）');
  });
});
