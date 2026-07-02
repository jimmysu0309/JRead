// JRead — byline 時刻/節目隱藏在 Shinkansen 譯後 DOM 仍生效（v1.5.28）
// -----------------------------------------------------------------------------
// Jimmy 2026-07-02 實測：英文 NPR byline 修好（作者→日期、清時刻/節目），但
// Shinkansen 翻成中文後又壞——「節錄自《MORNING EDITION》」「東岸時間下午 1:59」
// 都殘留、日期掉到第二行。根因：時刻/節目隱藏原本靠英文文字 regex（BYLINE_TIME_RE
// 的 HH:MM、BYLINE_PROGRAM_RE 的「Heard on」），Shinkansen 就地譯文後這些 regex
// 全失效。
//
// 修法（翻譯無關的純結構訊號）：
//   - 時刻：日期 item（<time>）內若有子元素文字符合 BYLINE_DATE_RE（此 regex 含
//     中文「2026 年 6 月 1 日」），把不符日期的兄弟子元素（時刻）隱藏。
//   - 節目：byline item 內連結 href 命中 /programs|shows|podcasts|episodes/
//     （href 不被翻譯）。
//
// 此 fixture 是 Shinkansen 譯後 DOM（中文文字 + data-shinkansen-translated），
// 英文 pattern 皆不命中 → forcing「結構訊號在譯後 DOM 接住」。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'byline-time-translated.html');
const SETTINGS = { theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0 };

function setup() {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 應有 <article>');
  const snapshot = env.NS.styler.apply(articleEl, SETTINGS);
  return { env, articleEl, snapshot };
}
const q = (env, t) => env.document.querySelector(`[data-test="${t}"]`);

describe('styler — byline 譯後結構訊號（v1.5.28 translate-first）', () => {

  it('中文時刻「下午 1:59（美國東部時間）」靠結構訊號隱藏（英文 HH:MM regex 不命中）', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'time-part').getAttribute('data-jread-byline-time'), '1',
      '日期 item 內不符 BYLINE_DATE_RE 的兄弟子元素（中文時刻）必須標 byline-time');
  });

  it('中文日期「2026 年 6 月 1 日」保留（BYLINE_DATE_RE 含中文日期）', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'date-part').getAttribute('data-jread-byline-time'), null,
      '中文日期符合 BYLINE_DATE_RE，不可被當時刻隱藏');
  });

  it('中文節目「聽過…」靠連結 href /programs/ 隱藏（英文 Heard on regex 不命中）', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'program').getAttribute('data-jread-byline-program'), '1',
      'item 內連結 href 命中 /programs/ → 標 program（href 不被翻譯）');
  });

  it('作者不被誤標 program（href 為 /people/ 非節目 URL）', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'author').getAttribute('data-jread-byline-program'), null,
      '作者連結 /people/ 不命中節目 URL pattern，不可被隱藏');
    assert.strictEqual(q(env, 'author').getAttribute('data-jread-byline-time'), null,
      '作者不是時刻');
  });

  it('日期 item 標 date-item（order:1）→ 作者排在日期前', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'date').getAttribute('data-jread-byline-date-item'), '1',
      '<time>（翻譯無關的日期錨）必須標 date-item 推到最後');
  });

  it('中文分類 kicker「商業」靠連結 href /sections/ 隱藏（翻譯無關）', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'kicker').getAttribute('data-jread-kicker'), '1',
      'H1 之前、連 /sections/ 的短連結（譯文「商業」）必須標 kicker——href 不被翻譯');
  });

  it('restore 移除所有譯後標記（可逆）', () => {
    const { env, articleEl, snapshot } = setup();
    env.NS.styler.restore(articleEl, snapshot);
    assert.strictEqual(q(env, 'time-part').getAttribute('data-jread-byline-time'), null);
    assert.strictEqual(q(env, 'program').getAttribute('data-jread-byline-program'), null);
    assert.strictEqual(q(env, 'date').getAttribute('data-jread-byline-date-item'), null);
    assert.strictEqual(q(env, 'kicker').getAttribute('data-jread-kicker'), null);
  });
});
