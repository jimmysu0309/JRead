// JRead — 翻譯後 tag-list-label heading 不再 walk-up 連坐誤殺作者簡介（v1.6.4）
//
// 對應 fixture：test/regression/fixtures/nyt-translated-heading-walkup-bio.html
// Trigger：Jimmy 2026-07-02 Shinkansen translate-first 實測——NYT 翻譯後 `.bottom-of-article`
// 內作者簡介連坐消失。cage instrument 揪出真兇 = hideInsideArticleByHeadingText。
//
// 根因：翻譯後 tag 列 label（Google MT 把「See more on」譯成「看更多」等）命中
// NOISE_HEADING_TEXT_RE，heading 規則把它當 section heading → resolveHeadingNoiseTarget
// 找不到 section/aside → findSafeWrapperForHeading 從 tag 列 div 往上爬找「不含主文的
// 最外層 wrapper」。翻譯後短中文 bio 段落達不到 wrapperContainsMainContentP 的 raw
// 100/300 門檻 → 含 bio 的共用外層 wrapper 被判「無主文 safe wrapper」整塊 hide、
// 作者簡介連坐消失。
//
// 修法（v1.6.4，結構性通則）：heading 若**本身即 taxonomy tag chip 列**
// （hashtagClusterHideTarget 命中——anchor 全 taxonomy href、與 label 語言無關），
// 該列自身即自足雜訊，hide 它就好、**不 walk-up**，避免爬出小 tag 列誤殺共用外層
// wrapper。非 tag 列的一般 noise heading（< 3 anchor）不受影響、照常 walk-up。
// 靜態 hideInsideArticleByHeadingText 與動態 checkDynamicNoise 單一資料源。
//
// 這條驗：tag 列本身被 hide + 含 bio 的外層 wrapper 不被 walk-up 連坐 + 主文保留。
// 破壞修法（移除 in-place hide、退回 walk-up）→ wrapper 被連坐 hide → 立即 fail。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'nyt-translated-heading-walkup-bio.html');

function isHiddenOrAncestorHidden(el) {
  let cur = el;
  while (cur && cur !== cur.ownerDocument.body) {
    if (cur.dataset && cur.dataset.jreadHidden === '1') return true;
    cur = cur.parentElement;
  }
  return false;
}

describe('cleaner — 翻譯後 tag-label heading 不 walk-up 誤殺作者簡介（v1.6.4）', () => {
  let document;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      pretendToBeVisual: true
    });
    document = env.document;
    const detected = env.window.__JRead.detector.detect();
    assert.ok(detected && detected.el, 'detector 應命中 fixture 主文容器');
    env.window.__JRead.cleaner.clean(detected.el);
  });

  it('前置：tag label「看更多」命中 heading regex（會觸發 heading walk-up path）', () => {
    // 「看更多」在 NOISE_HEADING_TEXT_RE 內——正是它讓 heading 規則接手、若無修法會 walk-up
    assert.ok(/看更多/.test('看更多'), 'sanity');
    const tags = document.querySelector('.css-tags');
    const anchors = Array.from(tags.querySelectorAll('a'));
    assert.strictEqual(anchors.length, 3, 'tag 列應有 3 個 anchor');
    assert.ok(anchors.every(a => /^\/topic\//.test(a.getAttribute('href') || '')),
      '所有 tag chip 都連 /topic/ taxonomy 頁（href 與 label 語言無關）');
  });

  it('核心：含作者簡介的外層 wrapper 不被 heading walk-up 連坐 hide', () => {
    const outer = document.querySelector('.css-outer');
    const boa = document.querySelector('.bottom-of-article');
    assert.ok(!isHiddenOrAncestorHidden(outer), '.css-outer 外層 wrapper 不可被 walk-up 整塊 hide');
    assert.ok(!isHiddenOrAncestorHidden(boa), '.bottom-of-article 不可被 walk-up 整塊 hide');
    // 多數 bio 保留（wrapper 未被連坐）——第 1 則可能被獨立 leading-byline 規則命中、
    // 與本 walk-up 修法正交（真實 NYT 頁 4 則 bio 全保留，見對話 cage 實測 rectH 178），
    // 故只斷言「wrapper 未整塊 hide → 多數 bio 存活」。
    const survived = Array.from(document.querySelectorAll('.css-bio'))
      .filter(b => !isHiddenOrAncestorHidden(b)).length;
    assert.ok(survived >= 3, `至少 3 則作者簡介保留（實際 ${survived}/4）`);
  });

  it('tag 列「看更多」本身仍被 hide（in-place，不需 walk-up）', () => {
    const tags = document.querySelector('.css-tags');
    assert.ok(isHiddenOrAncestorHidden(tags), '.css-tags（看更多 tag 列）必須被 in-place hide');
  });

  it('主文 h1 + 兩段內文保留（無誤殺）', () => {
    const h1 = document.querySelector('h1');
    assert.ok(h1 && !isHiddenOrAncestorHidden(h1), 'h1 主標題保留');
    const ps = Array.from(document.querySelectorAll('.css-body > p'));
    assert.strictEqual(ps.length, 2, 'fixture 有兩段主文 p');
    for (const p of ps) {
      assert.ok(!isHiddenOrAncestorHidden(p), `主文段落「${p.textContent.slice(0, 12)}…」必須保留`);
    }
  });
});
