// JRead — regression spec: 縮圖卡推薦軌延伸（hideTailCuratedLinkLists，v1.7.15）
// -----------------------------------------------------------------------------
// Trigger: v1.7.15 article 殼卡 guard 修好 Netflix Tudum 主文截斷後，harness
// 揪出文末「Discover More Interview / Documentary」推薦卡軌殘留。probe 實證
// 結構：<section> 內 h2 + <ul>，8 張卡 li = img 縮圖 + span 標題 + 站內連結、
// **無任何 <p>**，外加 2 個空 li（carousel 分頁圓點）。原
// hideTailCuratedLinkLists 兩處漏接：(1) teaser 形狀要求每 li 必含 <p>；
// (2)「全 li teaser 形狀」嚴格版被空 li 打破。
//
// 延伸（結構通則）：teaser 內容形狀放寬為「<p> 摘要**或**縮圖 img/picture」；
// 空 li（無文字無連結）容忍跳過、teaser 計數 >= 2 才 hide。新增 gallery
// 界線：li 含 figcaption 不 hide、站內連結為圖檔直連（lightbox）不算。
//
// 驗證層次：本 spec 驗 jsdom 端規則命中與負控制；真實 Chrome 端由 harness
// RESIDUAL / GAP audit 驗收（見 CHANGELOG v1.7.15）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'tudum-discover-rail.html');

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1024, height: 800 },
    pretendToBeVisual: true,
    // 站內連結判定需要 origin；current = 本頁 pathname
    url: 'https://www.example.com/tudum/articles/current'
  });
  const articleEl = env.document.querySelector('[data-test="article"]');
  assert.ok(articleEl);
  const hidden = env.window.__JRead.cleaner.clean(articleEl);
  return { env, articleEl, hidden };
}

describe('cleaner — 縮圖卡推薦軌（hideTailCuratedLinkLists 延伸，v1.7.15）', () => {
  let env, articleEl;
  before(() => {
    const s = setup();
    env = s.env;
    articleEl = s.articleEl;
  });

  it('(a) 縮圖卡推薦軌整個 section 被 hide（li 無 <p>、含空 li 圓點也不影響）', () => {
    const rail = articleEl.querySelector('[data-test="discover-rail"]');
    assert.strictEqual(rail.dataset.jreadHidden, '1',
      '縮圖卡軌（img + span + 站內連結、無 p、含 2 空 li）必須被 hide');
  });

  it('(b) 負控制：gallery（li 含 figcaption）不可 hide', () => {
    const g = articleEl.querySelector('[data-test="gallery-section"]');
    assert.notStrictEqual(g.dataset.jreadHidden, '1',
      'li 含 figcaption 是圖輯語意，必須保留');
  });

  it('(c) 負控制：references 形（li 無 p 無縮圖）不可 hide', () => {
    const r = articleEl.querySelector('[data-test="refs-section"]');
    assert.notStrictEqual(r.dataset.jreadHidden, '1',
      '裸 <a> citation list 不是 teaser 卡，必須保留');
  });

  it('(d) 負控制：站內連結為圖檔直連（lightbox）不算 teaser 卡', () => {
    const l = articleEl.querySelector('[data-test="lightbox-section"]');
    assert.notStrictEqual(l.dataset.jreadHidden, '1',
      '圖檔直連 li 是 lightbox / gallery，必須保留');
  });

  it('(e) 主文段落全數保留', () => {
    for (const key of ['main-p-1', 'main-p-2', 'main-p-3']) {
      const p = articleEl.querySelector(`[data-test="${key}"]`);
      assert.ok(p && !p.closest('[data-jread-hidden="1"]'), `${key} 不可被 hide`);
    }
  });

  it('(f) 主文內 promo banner：「Discover Now」strict CTA 整塊清（含背景圖殼）', () => {
    const banner = articleEl.querySelector('[data-test="promo-banner"]');
    const cta = articleEl.querySelector('[data-test="promo-cta"]');
    assert.ok(
      banner.dataset.jreadHidden === '1' || !!cta.closest('[data-jread-hidden="1"]'),
      'promo banner 必須整塊被 hide（不可只清 CTA 連結留圖卡殘殼）');
    const inner = articleEl.querySelector('[data-test="promo-inner"]');
    assert.ok(!!inner.closest('[data-jread-hidden="1"]'),
      '圖 + CTA 的 inner 容器必須在被 hide 的子樹內');
  });

  it('(g) 負控制：句中含 discover now 片語的敘述連結不可 hide（錨定全文比對）', () => {
    const link = articleEl.querySelector('[data-test="narrative-link"]');
    assert.ok(!link.closest('[data-jread-hidden="1"]'),
      '敘述性連結文字包含 discover now 片語但非完整 CTA 文字，不可誤殺');
    const p = articleEl.querySelector('[data-test="narrative-p"]');
    assert.notStrictEqual(p.dataset.jreadHidden, '1', '所在段落也不可被 hide');
  });
});
