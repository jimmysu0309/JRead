// JRead — regression spec: full-bleed「圖疊標題」hero 媒體層還原 flow（NYT, v1.7.6）
// -----------------------------------------------------------------------------
// Forcing function for cleaner helper `maybeRestoreHeroMediaOverlayFlow`
// （hideInsideArticleAbsoluteOverlays 的 media-wrapper 分支）。
//
// Trigger: Jimmy 2026-07-16 回報 NYT too-many-books 文章 reader mode 標題與
// hero 圖重疊。根因：header（relative + flex + height:100vh）內 absolute 媒體
// 層（含 hero <picture>）與 static 標題塊同容器——原站桌寬 full-bleed 設計對
// 位，reader card 縮窄後 absolute 層蓋在標題上、100vh 佔位殘留空白。既有
// media-wrapper guard（v0.7.170）保住媒體層不被 hide，但 position:absolute
// 原樣留下；v1.0.4 高度 reset 掛 collapse 軌需 hidden child 觸發、本場景不跑。
//
// 規則（結構通則，不綁站點 / class、無 rect 條件、翻譯無關）：absolute/fixed
// 媒體層的最近 positioned 祖先（articleEl 為界）內、層外存在 <h1> ＝
// overlay-headline template → 媒體層 position:static + order:1（標題先、圖後，
// 同 NYT 自家 mobileBelowLede 窄版序）；positioned 祖先 flex/grid → flex
// column、stylesheet 高度 > 100px → reset auto。
//
// ★ 雙保險 forcing：CNBC aspect-ratio 專屬媒體 wrapper（positioned 祖先無 h1，
//   v0.7.170 保護對象）必須保持 absolute 不被碰——破壞 h1 條件即誤傷它而 fail。
//
// 驗證層次：本 spec 驗「規則命中對象 + inline style 寫入/還原」（jsdom 層）。
// 不驗真實 Chrome 的視覺 rect 分離（jsdom 無 layout engine）——該層由 cage
// live probe 完成（2026-07-16 實測 title 32-81 / summary 94-145 / fig 203-686
// 完全分離）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'nyt-fullbleed-hero-media-overlay.html');

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1000, height: 800 },
    pretendToBeVisual: true
  });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 必須含 <article>');
  return { env, articleEl };
}

describe('cleaner — full-bleed hero 媒體層還原 flow（NYT overlay-headline, v1.7.6）', () => {
  let env, articleEl, hidden;
  before(() => {
    const s = setup();
    env = s.env;
    articleEl = s.articleEl;
    hidden = env.window.__JRead.cleaner.clean(articleEl);
  });

  it('(a) fixture 前提：媒體層 absolute 含 picture、h1 在層外同 header 內', () => {
    const layer = articleEl.querySelector('[data-test="hero-media-layer"]');
    const header = articleEl.querySelector('[data-test="hero-header"]');
    const h1 = articleEl.querySelector('[data-test="title"]');
    assert.ok(layer.querySelector('picture'), '媒體層必須含 <picture>');
    assert.ok(header.contains(h1), 'h1 必須在 header 內');
    assert.ok(!layer.contains(h1), 'h1 必須在媒體層之外');
  });

  it('(b) 媒體層還原 flow：inline position:static !important + order:1', () => {
    const layer = articleEl.querySelector('[data-test="hero-media-layer"]');
    assert.strictEqual(layer.style.getPropertyValue('position'), 'static',
      '媒體層必須被寫入 position:static');
    assert.strictEqual(layer.style.getPropertyPriority('position'), 'important',
      'position 必須帶 !important（贏過原站 stylesheet）');
    assert.strictEqual(layer.style.getPropertyValue('order'), '1',
      '媒體層必須 order:1（排到標題塊之後）');
  });

  it('(b2) 媒體層與圖說不可被 hide（是主文 hero，不是雜訊）', () => {
    const layer = articleEl.querySelector('[data-test="hero-media-layer"]');
    const cap = articleEl.querySelector('[data-test="hero-caption"]');
    assert.notStrictEqual(layer.dataset.jreadHidden, '1', '媒體層不可被 hide');
    assert.ok(!cap.closest('[data-jread-hidden="1"]'), '圖說不可落在 hidden 子樹內');
  });

  it('(c) header（containing block）：flex column + 高度 reset', () => {
    const header = articleEl.querySelector('[data-test="hero-header"]');
    assert.strictEqual(header.style.getPropertyValue('flex-direction'), 'column',
      'flex header 必須被強制 column（原 flex-row 會讓兩層並排）');
    assert.strictEqual(header.style.getPropertyValue('height'), 'auto',
      '100vh 類 stylesheet 高度佔位必須 reset 為 auto');
    assert.strictEqual(header.style.getPropertyPriority('height'), 'important',
      'height reset 必須帶 !important');
  });

  it('(c2) 標題塊不可被 hide、不寫 order（預設 0 排在媒體層前）', () => {
    const block = articleEl.querySelector('[data-test="headline-block"]');
    assert.notStrictEqual(block.dataset.jreadHidden, '1', '標題塊不可被 hide');
    assert.strictEqual(block.style.getPropertyValue('order'), '',
      '標題塊不寫 order（預設 0 即排前）');
  });

  it('(d) 負控制：CNBC aspect-ratio 專屬媒體 wrapper（無 h1）完全不被碰', () => {
    const dedicated = articleEl.querySelector('[data-test="dedicated-media-layer"]');
    const wrapper = articleEl.querySelector('[data-test="aspect-wrapper"]');
    assert.strictEqual(dedicated.style.getPropertyValue('position'), 'absolute',
      '專屬媒體層必須保持原 inline position:absolute');
    assert.strictEqual(dedicated.style.getPropertyPriority('position'), '',
      '專屬媒體層 position 不可被加上 !important（未被規則改寫）');
    assert.strictEqual(dedicated.style.getPropertyValue('order'), '',
      '專屬媒體層不可被寫 order');
    assert.notStrictEqual(dedicated.dataset.jreadHidden, '1',
      '專屬媒體層不可被 hide（v0.7.170 保護不退步）');
    assert.strictEqual(wrapper.style.getPropertyValue('flex-direction'), '',
      'aspect wrapper 不可被強制 flex column');
  });

  it('(e) restore：退出 reader mode 後 inline style 完整還原', () => {
    env.window.__JRead.cleaner.restore(hidden);
    const layer = articleEl.querySelector('[data-test="hero-media-layer"]');
    const header = articleEl.querySelector('[data-test="hero-header"]');
    assert.strictEqual(layer.style.getPropertyValue('position'), 'absolute',
      '媒體層必須還原原 inline position:absolute');
    assert.strictEqual(layer.style.getPropertyValue('order'), '',
      'order 必須清除');
    assert.strictEqual(header.style.getPropertyValue('height'), '900px',
      'header 高度必須還原 900px');
    assert.strictEqual(header.style.getPropertyValue('flex-direction'), '',
      'flex-direction 必須清除');
    assert.strictEqual(header.style.getPropertyValue('display'), 'flex',
      'header 原 inline display:flex 必須還原');
  });
});
