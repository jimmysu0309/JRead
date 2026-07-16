// JRead — regression spec: overlay-headline 祖先鏈 viewport 高度佔位 flatten（v1.7.7）
// -----------------------------------------------------------------------------
// Forcing function for cleaner helper `flattenViewportHeightReserveChain`
//（hideInsideArticleAbsoluteOverlays 的 v0.8.87 title-overlay 分支掛載點）。
//
// Trigger: Jimmy 2026-07-16 回報 NYT mike-d-new-album 文章 reader mode 摘要與
// byline 之間一整頁空白。cage live probe 實證根因：overlay-headline 模板變體
// ——absolute 媒體層「自身」同時裝 hero <video> 與一份重複 h1（full-bleed 寬度
// 疊在圖上的標題；窄版另 render 可見 h1 在兄弟欄）。層含 h1 → 命中 v0.8.87
// title-overlay 分支（只還原 position:static、無高度處理）；v1.7.6 hero-media
// 分支（有 cb 高度 reset）走不到；層內 h1 也讓 v1.0.3 cinemagraph wrapper 爬升
// 提前 break。且佔位不只一層：三層 wrapper 各自 stylesheet height:100vh，
// v1.0.4 掛 collapse 軌需 hidden child——全部接不住。
//
// 規則（結構通則，不綁站點 / class）：absolute overlay 層被還原回 flow 時
//（title-overlay 與 hero-media 兩分支共用），從層的 parent 沿祖先鏈走到
// articleEl（不含），rect 高度 >= 80% viewport 的祖先 reset height:auto /
// min-height:0（player 子樹跳過；heightSeen 全域去重防雙 snapshot）。
//
// 驗證層次：本 spec 驗「規則命中對象 + inline style 寫入/還原 + 幾何門檻」
//（jsdom 層，rect 用 stubRect 注入）。不驗真實 Chrome 視覺 rect 分離——該層
// 由 cage live probe 完成（2026-07-16 實測 reset 後 header 1052→261、byline
// top 1107→365、標題→摘要→byline→內文正常 flow）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'nyt-overlay-headline-viewport-reserve.html');
const VH = 1000; // 模擬 viewport 高度（實測三層 wrapper 各 100vh = 1003px）

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
  // 模擬 full-bleed 幾何：三層 wrapper 各撐滿 viewport（100vh）。media-col
  // 不 stub（rect 0）＝負控制：非 viewport-scale 祖先不可被碰。
  stubRect(q('[data-test="hero-header"]'), { left: 0, top: 0, width: 1024, height: VH });
  stubRect(q('[data-test="size-full"]'), { left: 0, top: 0, width: 512, height: VH });
  stubRect(q('[data-test="reserve-box"]'), { left: 0, top: 0, width: 512, height: VH });
  return { env, articleEl };
}

describe('cleaner — overlay-headline 祖先鏈 viewport 高度佔位 flatten（v1.7.7）', () => {
  let env, articleEl, hidden;
  before(() => {
    const s = setup();
    env = s.env;
    articleEl = s.articleEl;
    hidden = env.window.__JRead.cleaner.clean(articleEl);
  });

  it('(a) fixture 前提：媒體層 absolute、自身同時含重複 h1 與 video', () => {
    const layer = articleEl.querySelector('[data-test="overlay-layer"]');
    const visibleTitle = articleEl.querySelector('[data-test="title"]');
    assert.ok(layer.querySelector('h1'), '媒體層必須含重複 h1（走 title-overlay 分支的前提）');
    assert.ok(layer.querySelector('video'), '媒體層必須含 video');
    assert.ok(!layer.contains(visibleTitle), '可見 h1 必須在媒體層之外的兄弟欄');
  });

  it('(b) 媒體層走 title-overlay 分支：position:static !important、不寫 order', () => {
    const layer = articleEl.querySelector('[data-test="overlay-layer"]');
    assert.strictEqual(layer.style.getPropertyValue('position'), 'static',
      '媒體層必須被還原 position:static');
    assert.strictEqual(layer.style.getPropertyPriority('position'), 'important',
      'position 必須帶 !important');
    assert.strictEqual(layer.style.getPropertyValue('order'), '',
      'title-overlay 分支不寫 order（order 是 hero-media 分支的簽名）');
    assert.notStrictEqual(layer.dataset.jreadHidden, '1', '媒體層不可被 hide');
  });

  it('(c) 祖先鏈三層 viewport-scale 佔位全部 reset height:auto / min-height:0', () => {
    for (const key of ['reserve-box', 'size-full', 'hero-header']) {
      const el = articleEl.querySelector(`[data-test="${key}"]`);
      assert.strictEqual(el.style.getPropertyValue('height'), 'auto',
        `${key} 必須被 reset height:auto（stylesheet 100vh 佔位）`);
      assert.strictEqual(el.style.getPropertyPriority('height'), 'important',
        `${key} height reset 必須帶 !important`);
      const mh = el.style.getPropertyValue('min-height');
      assert.ok(['0', '0px'].includes(mh),
        `${key} min-height 必須被 reset 為 0（讀到 "${mh}"）`);
    }
  });

  it('(d) 負控制：非 viewport-scale 祖先（media-col，rect 0）不可被碰', () => {
    const col = articleEl.querySelector('[data-test="media-col"]');
    assert.strictEqual(col.style.getPropertyValue('height'), '',
      'media-col rect 高度未達 80% viewport，不該被寫 height');
    assert.strictEqual(col.style.getPropertyValue('min-height'), '',
      'media-col 不該被寫 min-height');
  });

  it('(e) 標題 / 摘要 / byline / 主文段落全部保留', () => {
    for (const key of ['title', 'summary', 'byline', 'body-p-1', 'body-p-2', 'body-p-3']) {
      const el = articleEl.querySelector(`[data-test="${key}"]`);
      assert.ok(el && !el.closest('[data-jread-hidden="1"]'), `${key} 不可被 hide`);
    }
  });

  it('(f) restore：退出 reader mode 後 inline style 完整還原', () => {
    env.window.__JRead.cleaner.restore(hidden);
    const layer = articleEl.querySelector('[data-test="overlay-layer"]');
    assert.strictEqual(layer.style.getPropertyValue('position'), 'absolute',
      '媒體層必須還原原 inline position:absolute');
    for (const key of ['reserve-box', 'size-full', 'hero-header']) {
      const el = articleEl.querySelector(`[data-test="${key}"]`);
      assert.strictEqual(el.style.getPropertyValue('height'), '',
        `${key} 的 inline height 必須清空（原本無 inline height，佔位來自 stylesheet）`);
      assert.strictEqual(el.style.getPropertyValue('min-height'), '',
        `${key} 的 inline min-height 必須清空`);
    }
  });
});
