// JRead — byline root climb 不可吸收標題/副標 heading（v1.0.12）
// -----------------------------------------------------------------------------
// Jimmy 2026-06-26 回報：chinatalk Substack 文章用 Shinkansen 翻譯成中文後，作者與
// 日期跑到副標那一行。根因：byline root 偵測往上爬的天花板原本只有「visible 文字
// <= 200」一條，而 Substack post-header 同時包住 h1 標題 + h3 副標 + byline，整塊
// 文字翻成中文後更緊湊（英文 113 字 → 中文 59 字）落在 200 內 → climb 把整個
// post-header 當 byline root，h1/h3 被打平成 flex-wrap item。英文版因 heading 夠寬
// 各自佔一列而僥倖沒露餡、中文窄副標與作者名擠同列才暴露。
//
// 修法（結構訊號、非站點特判）：climb 條件加 heading guard——
// `!parent.querySelector('h1, h2, h3')`。byline 是作者/日期 meta、結構上絕不會包住
// 文章標題或副標，遇到含 heading 的祖先就停。fix 後 root 落在真正的 author+date
// wrapper、h1/h3 留在 byline 子樹外。
//
// 訊號層次：偵測 + 標記不依賴 layout（textContent + compareDocumentPosition +
// querySelector），jsdom 可驗。CSS flex 一行的視覺結果由 debug-harness 在真實站驗。
//
// forcing：byline root 不含 h1/h3、post-header 不被標 root、標題/副標不被標 item、
// 作者+日期仍被正確標 item。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'byline-root-skip-heading.html');
const SETTINGS = { theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0 };

function setup() {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 應有 <article>');
  const snapshot = env.NS.styler.apply(articleEl, SETTINGS);
  return { env, articleEl, snapshot };
}
const q = (env, t) => env.document.querySelector(`[data-test="${t}"]`);

describe('styler — byline root 不吸收標題/副標 heading (v1.0.12)', () => {

  it('byline root 偵測到 author+date wrapper、不爬到含 heading 的 post-header', () => {
    const { env } = setup();
    const root = env.document.querySelector('[data-jread-byline="1"]');
    assert.ok(root, 'author+date 區應被偵測為 byline root');
    // root 必須包住作者與日期
    assert.ok(root.contains(q(env, 'author')), 'byline root 必須包含作者');
    assert.ok(root.contains(q(env, 'date')), 'byline root 必須包含日期');
    // root 絕不可包住標題 / 副標 heading
    assert.ok(!root.contains(q(env, 'title')), 'byline root 不可吸收 h1 標題');
    assert.ok(!root.contains(q(env, 'subtitle')), 'byline root 不可吸收 h3 副標');
    assert.ok(!root.querySelector('h1, h2, h3'), 'byline root 子樹不可含任何 h1/h2/h3');
  });

  it('post-header（含 h1/h3）不被標為 byline root', () => {
    const { env } = setup();
    const ph = q(env, 'post-header');
    assert.strictEqual(ph.getAttribute('data-jread-byline'), null,
      '同時含標題與副標的 post-header 不可被當 byline root');
  });

  it('標題 / 副標不被誤標 byline item', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'title').getAttribute('data-jread-byline-item'), null, 'h1 標題不可被標 byline item');
    assert.strictEqual(q(env, 'subtitle').getAttribute('data-jread-byline-item'), null, 'h3 副標不可被標 byline item');
  });

  it('作者 + 日期仍被正確標 byline item（作者葉節點為連結）', () => {
    const { env } = setup();
    // 作者文字巢在 span>a，leaf item 是 <a>（與真實 Substack 結構一致）
    assert.strictEqual(q(env, 'author-link').getAttribute('data-jread-byline-item'), '1', '作者連結必須是 byline item');
    assert.strictEqual(q(env, 'date').getAttribute('data-jread-byline-item'), '1', '日期必須是 byline item');
  });

  it('restore 移除所有 byline 標記', () => {
    const { env, articleEl, snapshot } = setup();
    env.NS.styler.restore(articleEl, snapshot);
    assert.ok(!env.document.querySelector('[data-jread-byline]'), 'restore 應移除 byline root 標記');
    assert.ok(!env.document.querySelector('[data-jread-byline-item]'), 'restore 應移除所有 byline item 標記');
  });
});
