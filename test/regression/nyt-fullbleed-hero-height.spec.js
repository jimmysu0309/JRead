// JRead — regression spec: full-bleed hero header 殘留 viewport 高度空白（v1.0.4）
// -----------------------------------------------------------------------------
// Forcing function for collapseGridWithHiddenCell 的 viewport-blank-reserve 分支。
//
// Trigger: 接續 v1.0.3。cinemagraph 影片被 decorative-hero rule hide 後，Jimmy
// 2026-06-25 回報標題下方仍有「一整頁」空白（縮放到 80/50/30% 都恰好占一整頁 =
// 100vh 簽名；只在桌面寬度出現）。cage DevTools probe 實證：full-bleed
// <header class="css-2fao3f"> stylesheet `height: 100vh`（讓 cinemagraph 填滿
// 整個螢幕），影片被 hide 後 header 仍 1167px 高、內容（標題容器）僅 179px →
// 988px 純空白。collapse 既有 decls 只清 display/grid/width/margin/padding、不含
// height → 空白殘留。
//
// 為何 harness/cage 都驗不到真站：nytimes.com 對 Playwright 回 bot challenge、
// 對 cage 整站 safety-block。假設驗證靠 Jimmy 在 cage DevTools 跑 probe：先量
// 祖先鏈 computed height（找到 header height 1167=100vh、min-height 0），再「模擬
// 修法」把 header/min-height 設 auto → 量得 header 1167→179、畫面空白消失。
//
// 規則設計（結構通則，不綁站，硬規則 3）：collapse 容器自身 rect 高度 >= 80%
// viewport，且最後一個 visible child rect 底距容器底 > 30% viewport（= 容器
// height 在 reserve 一大片空白、非內容撐出）→ 連 height/min-height 一起 reset
// 為 auto，linearize 後高度由內容決定。jsdom 無 layout engine（rect 全 0）→ 用
// stubRect + viewport 注入模擬 full-bleed 幾何才驗得到。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'nyt-fullbleed-hero-height.html');
const VH = 1167; // 模擬桌面 viewport 高度（≈ NYT 實測 header 100vh）

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1024, height: VH },
    pretendToBeVisual: true
  });
  const doc = env.document;
  const articleEl = doc.querySelector('article');
  assert.ok(articleEl, 'fixture 必須含 <article>');
  const q = (sel) => doc.querySelector(sel);
  // 模擬 full-bleed 幾何：header 撐滿 viewport（100vh），標題容器只占 ~179px
  // → header 底下 ~988px 純空白 = viewport blank reserve。
  stubRect(q('[data-test="hero-header"]'), { left: 0, top: 0, width: 1024, height: VH });
  stubRect(q('[data-test="title-block"]'), { left: 0, top: 0, width: 1024, height: 179 });
  return { env, articleEl };
}

describe('cleaner — full-bleed hero header viewport 高度空白 reset（v1.0.4）', () => {
  let articleEl;
  before(() => {
    const s = setup();
    articleEl = s.articleEl;
    s.env.window.__JRead.cleaner.clean(articleEl);
  });

  it('(a) hero media wrapper（含 cinemagraph 影片）被 hide（v1.0.3 前置）', () => {
    const media = articleEl.querySelector('[data-test="hero-media"]');
    assert.strictEqual(media.dataset.jreadHidden, '1', 'media wrapper 必須被 hide（collapse 條件 A 的 hidden child）');
  });

  it('(b) header 被 collapse（flex-row + hidden child → 條件 A）', () => {
    const header = articleEl.querySelector('[data-test="hero-header"]');
    assert.strictEqual(header.dataset.jreadCollapsed, '1', 'header 必須被標記 data-jread-collapsed="1"');
  });

  it('(c) header 的 height / min-height 被 reset 為 auto（消除 100vh 空白）', () => {
    const header = articleEl.querySelector('[data-test="hero-header"]');
    assert.strictEqual(
      header.style.getPropertyValue('height'), 'auto',
      'header inline height 必須被 reset 為 auto（原 stylesheet height:100vh 撐出整頁空白）'
    );
    assert.strictEqual(
      header.style.getPropertyPriority('height'), 'important',
      'header height:auto 必須帶 !important（贏過站點 stylesheet 的 height:100vh）'
    );
    const mh = header.style.getPropertyValue('min-height');
    assert.ok(['0', '0px'].includes(mh),
      `header inline min-height 必須被 reset 為 0（讀到 "${mh}"）`);
  });

  it('(d) 標題 / 摘要 / 主文段落全部保留', () => {
    const title = articleEl.querySelector('[data-test="title"]');
    const summary = articleEl.querySelector('[data-test="summary"]');
    assert.ok(!title.closest('[data-jread-hidden="1"]'), '標題不可被 hide');
    assert.ok(!summary.closest('[data-jread-hidden="1"]'), '摘要不可被 hide');
    for (let i = 1; i <= 3; i++) {
      const p = articleEl.querySelector(`[data-test="body-p-${i}"]`);
      assert.ok(p && !p.closest('[data-jread-hidden="1"]'), `主文 body-p-${i} 不可被 hide`);
    }
  });

  it('(e) sanity：非 viewport-scale 的一般 collapse 容器不應被加 height reset', () => {
    // 用同份 fixture 但 header rect 改成「內容剛好填滿、無大片空白」的矮高度，
    // 確認 height reset 是被 viewport-blank-reserve 幾何條件閘住、非無條件套用。
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1024, height: VH },
      pretendToBeVisual: true
    });
    const doc = env.document;
    const art = doc.querySelector('article');
    // header 高度 = 標題容器高度（無 trailing 空白）→ 不該觸發 height reset
    stubRect(doc.querySelector('[data-test="hero-header"]'), { left: 0, top: 0, width: 1024, height: 179 });
    stubRect(doc.querySelector('[data-test="title-block"]'), { left: 0, top: 0, width: 1024, height: 179 });
    env.window.__JRead.cleaner.clean(art);
    const header = doc.querySelector('[data-test="hero-header"]');
    assert.strictEqual(header.dataset.jreadCollapsed, '1', 'header 仍應被 collapse（hidden child 存在）');
    assert.notStrictEqual(
      header.style.getPropertyValue('height'), 'auto',
      '無 viewport blank reserve 時 header 不該被加 height:auto（避免無條件套用）'
    );
  });
});
