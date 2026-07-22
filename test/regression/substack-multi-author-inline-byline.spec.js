// JRead — 多作者 byline inline 文字流（v1.7.12）
// -----------------------------------------------------------------------------
// Jimmy 2026-07-22 chinatalk.media（Substack）translate-first 回報：作者列被拆成
// 多欄、每個名字折成兩行、分隔符「以及」直排。probe 實測根因：作者容器是單一
// byline-item（直含 4 條 <a> + 頓號文字分隔符），v1.0.18 的 inline-flex 讓它成
// nowrap flex row——translate-first 常保留英文人名不翻、內容變寬超出 root 後，
// 每條連結被 flex shrink 擠到 min-content（"JORDAN SCHNEIDER" 折成兩行、
// 以及→以/及直排）。
//
// 修法（結構訊號）：item 含 >= 2 條 <a> + 直接文字（分隔符）+ 無媒體（img/picture/
// svg/video——無頭像對齊需求）→ 標 data-jread-byline-inline，CSS 以 doubled attr
// (0,3,0) 壓過 byline-item inline-flex，回歸 block + 子連結 inline 自然文字換行。
//
// 訊號層次：本 spec 驗「標記邏輯 + CSS 規則字串」（jsdom 無 layout engine，
// flex 擠壓 / 折行的視覺結果由 debug-harness --translate-first 在真實站驗）。
//
// forcing：多作者 item 標 inline attr + CSS 規則存在 + 單連結／含媒體 item 不誤標
// + restore 移除標記。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'substack-multi-author-inline-byline.html');
const ONELINE_FIXTURE = path.join(__dirname, 'fixtures', 'byline-oneline-normalize.html');
const SETTINGS = { theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0 };

function setup(fixturePath) {
  const env = loadFixtureWithScripts({ fixturePath, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 應有 <article>');
  const snapshot = env.NS.styler.apply(articleEl, SETTINGS);
  return { env, articleEl, snapshot };
}
const q = (env, t) => env.document.querySelector(`[data-test="${t}"]`);

describe('styler — 多作者 byline inline 文字流 (v1.7.12)', () => {

  it('多連結 + 分隔文字的作者容器標 byline-item + byline-inline', () => {
    const { env } = setup(FIXTURE_PATH);
    assert.ok(env.document.querySelector('[data-jread-byline]'),
      '前提：byline root 必須被偵測（中文日期訊號）');
    const authors = q(env, 'authors');
    assert.strictEqual(authors.getAttribute('data-jread-byline-item'), '1',
      '作者容器（直含頓號文字）是 byline item');
    assert.strictEqual(authors.getAttribute('data-jread-byline-inline'), '1',
      '4 條 <a> + 直接分隔文字 + 無媒體 → 必須標 byline-inline（回歸自然文字流）');
  });

  it('CSS 有 doubled-attr block 規則 + 子連結 inline 規則', () => {
    const { env } = setup(FIXTURE_PATH);
    const css = env.document.getElementById('__jread-style').textContent;
    const dbl = css.match(/\[data-jread-byline-inline\]\[data-jread-byline-inline\]\s*\{([^}]*)\}/);
    assert.ok(dbl, '必須有 doubled [data-jread-byline-inline] 規則（壓過 byline-item inline-flex）');
    assert.ok(/display:\s*block\s*!important/.test(dbl[1]),
      'doubled 規則必須 display:block !important');
    const anchor = css.match(/\[data-jread-byline-inline\]\s+a\s*\{([^}]*)\}/);
    assert.ok(anchor, '必須有 [data-jread-byline-inline] a 規則');
    assert.ok(/display:\s*inline\s*!important/.test(anchor[1]),
      '子連結必須 display:inline !important（防站點 block 連結逐行堆疊）');
  });

  it('日期 / 付費 chip（單一文字 item）不誤標 byline-inline', () => {
    const { env } = setup(FIXTURE_PATH);
    for (const t of ['date', 'paid']) {
      const el = q(env, t);
      assert.strictEqual(el.getAttribute('data-jread-byline-inline'), null,
        `${t} item 無多連結，不可標 byline-inline`);
    }
  });

  it('單連結 author（"by <a>Matt Prior</a>"）與含媒體 avatar item 不誤標（v1.0.18 行為保留）', () => {
    const { env } = setup(ONELINE_FIXTURE);
    const author = q(env, 'author');
    assert.strictEqual(author.getAttribute('data-jread-byline-item'), '1',
      '前提：author 是 byline item');
    assert.strictEqual(author.getAttribute('data-jread-byline-inline'), null,
      '單連結 item 維持 inline-flex 軌（column-gap 詞距修法），不標 inline');
    assert.strictEqual(env.document.querySelector('[data-jread-byline-inline]'), null,
      'oneline fixture 全樹不應有任何 byline-inline 標記');
  });

  it('restore 移除 byline-inline 標記', () => {
    const { env, articleEl, snapshot } = setup(FIXTURE_PATH);
    assert.ok(env.document.querySelector('[data-jread-byline-inline]'), '前提：apply 後有標記');
    env.NS.styler.restore(articleEl, snapshot);
    assert.strictEqual(env.document.querySelector('[data-jread-byline-inline]'), null,
      'restore 後不可殘留 byline-inline 標記');
  });

});
