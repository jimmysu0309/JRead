// JRead — 相對日期 byline 偵測 + 孤兒分隔符隱藏（v1.7.4）
// -----------------------------------------------------------------------------
// Bug（Jimmy 2026-07-10 levelup.gitconnected.com 截圖回報）：Medium 近期文章
// byline「15 min read·5 days ago」下方多一段空白。根因：byline 只顯示相對日期
// （無 <time>、無絕對日期），BYLINE_DATE_RE 不命中 → byline root 偵測整套 miss →
// 正規化（wrapper display:contents 打平、root margin 歸一）沒跑 → Medium 閱讀
// 時間列自帶的 margin-bottom:18px 留下 = byline 下方比正常段距多 18px。
//
// 修法（結構訊號、非站點特判）：
//   1. BYLINE_REL_DATE_RE 相對日期錨（"5 days ago" / "3 小時前"）——全字串比對
//      套在 direct text 上（比絕對日期的子字串比對嚴，內文敘述句不誤標）
//   2. 孤兒分隔符：純分隔符 item 的相鄰非分隔符 item 任一側缺席或已被隱藏
//      （rt / time / program）→ 標 data-jread-byline-sep 隱藏（否則藏掉閱讀
//      時間後殘留「· 5 days ago」）
//
// 訊號層次：本 spec 驗「偵測 + 標記」（textContent + attr，jsdom 可驗）；
// 不驗 CSS 視覺結果（flex 一行 / margin 塌掉 / display:none 的 rendered 效果
// 由 debug-harness 在真實站驗——jsdom 無 layout engine）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'medium-relative-date-byline.html');
const SETTINGS = { theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0 };

function setup() {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 應有 <article>');
  const snapshot = env.NS.styler.apply(articleEl, SETTINGS);
  return { env, articleEl, snapshot };
}
const q = (env, t) => env.document.querySelector(`[data-test="${t}"]`);

describe('styler — 相對日期 byline 偵測 + 孤兒分隔符（v1.7.4）', () => {

  it('相對日期「5 days ago」當日期錨 → byline root 被標記', () => {
    const { env } = setup();
    const root = q(env, 'byline-root');
    assert.strictEqual(root.getAttribute('data-jread-byline'), '1',
      '相對日期訊號必須觸發 byline root 偵測（Medium 近期文章無絕對日期）');
  });

  it('climb 停在 byline 容器，不吃進含 subtitle h2 的 header-block', () => {
    const { env } = setup();
    const header = q(env, 'header-block');
    assert.notStrictEqual(header.getAttribute('data-jread-byline'), '1',
      'heading guard：含 h2 副標的 header-block 不可被當 byline root');
  });

  it('帶站點 margin 的 rt-row 被標 wrap（display:contents 打平 → 18px margin 失效）', () => {
    const { env } = setup();
    const rtRow = q(env, 'rt-row');
    assert.strictEqual(rtRow.getAttribute('data-jread-byline-wrap'), '1',
      '閱讀時間列 wrapper 必須標 wrap（此列站點 margin-bottom:18px 即空白根因）');
    assert.strictEqual(rtRow.style.getPropertyValue('display'), 'contents',
      'wrap 必須 inline display:contents（打平後 margin 不再產生盒）');
  });

  it('「15 min read」標 rt 隱藏；孤兒分隔符「·」標 sep 隱藏', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'readtime').getAttribute('data-jread-byline-rt'), '1',
      '閱讀時間必須標 rt（CSS 隱藏）');
    assert.strictEqual(q(env, 'sep').getAttribute('data-jread-byline-sep'), '1',
      '相鄰 readtime 被隱藏後，分隔符「·」變孤兒必須標 sep 隱藏（否則殘留「· 5 days ago」）');
  });

  it('相對日期 item 標 date-item（order 推到 byline 最後）', () => {
    const { env } = setup();
    const rel = q(env, 'reldate');
    assert.strictEqual(rel.getAttribute('data-jread-byline-item'), '1',
      '「5 days ago」必須是 byline item');
    assert.strictEqual(rel.getAttribute('data-jread-byline-date-item'), '1',
      '相對日期必須標 date-item');
  });

  it('負控制：內文敘述句的「3 days ago」子字串不被誤標', () => {
    const { env } = setup();
    const p2 = q(env, 'p2');
    assert.strictEqual(p2.getAttribute('data-jread-byline'), null,
      '含「3 days ago」子字串的內文段落不可被當日期錨（相對日期是全字串比對）');
    assert.ok(!p2.closest('[data-jread-byline]'),
      '內文不可落在任何 byline root 內');
  });

  it('restore 移除全部標記（含新 sep attr）', () => {
    const { env, articleEl, snapshot } = setup();
    env.NS.styler.restore(articleEl, snapshot);
    for (const t of ['byline-root', 'rt-row', 'readtime', 'sep', 'reldate']) {
      const el = q(env, t);
      for (const a of ['data-jread-byline', 'data-jread-byline-wrap', 'data-jread-byline-item',
        'data-jread-byline-rt', 'data-jread-byline-sep', 'data-jread-byline-date-item']) {
        assert.strictEqual(el.getAttribute(a), null, `restore 後 ${t} 不可殘留 ${a}`);
      }
    }
  });
});

// 真實 Medium DOM 第二形態（probe #4 實測）：日期是 item 的 direct text、閱讀
// 時間與分隔符是同 item 的子元素。第一版修法整顆標 rt → 日期陪葬（byline 全空）。
describe('styler — 混合 date+readtime item 不可整顆隱藏（v1.7.4）', () => {
  const MIXED_FIXTURE = path.join(__dirname, 'fixtures', 'medium-mixed-date-readtime-item.html');

  function setupMixed() {
    const env = loadFixtureWithScripts({ fixturePath: MIXED_FIXTURE, scripts: ['styler'] });
    const articleEl = env.document.querySelector('article');
    const snapshot = env.NS.styler.apply(articleEl, SETTINGS);
    return { env, articleEl, snapshot };
  }

  it('混合 item 標 item + date-item，但不可標 rt（否則日期陪葬）', () => {
    const { env } = setupMixed();
    const mixed = q(env, 'mixed-item');
    assert.strictEqual(mixed.getAttribute('data-jread-byline-item'), '1',
      '混合 item 必須是 byline item');
    assert.strictEqual(mixed.getAttribute('data-jread-byline-date-item'), '1',
      '混合 item（direct text 是日期）必須標 date-item');
    assert.strictEqual(mixed.getAttribute('data-jread-byline-rt'), null,
      '含日期訊號的 item 不可整顆標 rt——日期「5 days ago」會陪葬');
    assert.strictEqual(mixed.getAttribute('data-jread-byline-sep'), null,
      '含日期訊號的 item 不可被標 sep');
  });

  it('rt 下沉到「命中閱讀時間、不含日期」的子元素；相鄰純分隔符連帶標 sep', () => {
    const { env } = setupMixed();
    assert.strictEqual(q(env, 'readtime').getAttribute('data-jread-byline-rt'), '1',
      '閱讀時間必須下沉標在「15 min read」子元素上');
    assert.strictEqual(q(env, 'sep').getAttribute('data-jread-byline-sep'), '1',
      'rt 的相鄰純分隔符「·」必須連帶標 sep（否則殘留「·5 days ago」）');
  });

  it('帶站點 margin 的 rt-row 仍被標 wrap 打平', () => {
    const { env } = setupMixed();
    const rtRow = q(env, 'rt-row');
    assert.strictEqual(rtRow.getAttribute('data-jread-byline-wrap'), '1');
    assert.strictEqual(rtRow.style.getPropertyValue('display'), 'contents');
  });

  it('restore 移除混合 item 全部標記', () => {
    const { env, articleEl, snapshot } = setupMixed();
    env.NS.styler.restore(articleEl, snapshot);
    for (const t of ['byline-root', 'rt-row', 'mixed-item', 'readtime', 'sep']) {
      const el = q(env, t);
      for (const a of ['data-jread-byline', 'data-jread-byline-wrap', 'data-jread-byline-item',
        'data-jread-byline-rt', 'data-jread-byline-sep', 'data-jread-byline-date-item']) {
        assert.strictEqual(el.getAttribute(a), null, `restore 後 ${t} 不可殘留 ${a}`);
      }
    }
  });
});
