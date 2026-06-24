// JRead — regression spec: 裝飾性 hero 背景影片清除（NYT cinemagraph, v1.0.3）
// -----------------------------------------------------------------------------
// Forcing function for cleaner rule `hideInsideArticleDecorativeHeroVideos`.
//
// Trigger: Jimmy 2026-06-24 用 page-rounds harness 檢查 NYT china-robots-humanoid
// 文章，第一屏整片全白。cage DevTools probe 確認：文章開頭 <header> 內一支
// position:absolute 的 cinemagraph <video class="cinemagraph_video">（341×606、
// paused、無 controls）撐在固定高度 wrapper（687px）裡，閱讀模式變窄後 absolute
// 影片不 reflow 回填 → wrapper 剩 ~600px 全白。
//
// 為何 harness/cage 都驗不到真站：nytimes.com 對 Playwright 回 bot challenge、
// 對 cage 整站 safety-block；假設驗證靠 Jimmy 在 cage DevTools 跑 probe 取真實
// DOM（getBoundingClientRect / getComputedStyle / 巢狀 contains）完成。
//
// 規則設計（結構通則，不綁站，硬規則 3）：<video> computed position:absolute|fixed
// + 無 controls = 脫離 flow 的裝飾背景影片 → 從 video 往上爬到「父層含 heading 或
// 碰語意邊界（HEADER/ARTICLE/MAIN/BODY）前的最後一層」當 hide 目標。NYT header
// 含 h1 → 停在 header 下一層的 media-block，連影片 + 說明整塊清掉、保住標題與內文。
//
// ★ 雙保險 forcing：編輯性 <figure><video controls>（有 controls + position static）
//   必須保留——破壞 controls / position 任一 guard 即會誤殺它而 fail。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'nyt-cinemagraph-hero-video.html');

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

describe('cleaner — 裝飾性 hero 背景影片（NYT cinemagraph, v1.0.3）', () => {
  let articleEl;
  before(() => {
    const s = setup();
    articleEl = s.articleEl;
    s.env.window.__JRead.cleaner.clean(articleEl);
  });

  it('(a) fixture: hero video 為 position:absolute、無 controls，且在 header 內', () => {
    const v = articleEl.querySelector('[data-test="hero-video"]');
    assert.ok(v, 'fixture 必須含 hero video');
    assert.strictEqual(v.style.position, 'absolute', 'hero video 必須 position:absolute');
    assert.strictEqual(v.hasAttribute('controls'), false, 'hero video 不可有 controls（裝飾背景影片）');
    assert.ok(v.closest('header'), 'hero video 必須在 <header> 內');
  });

  it('(b) hero media wrapper（影片 + 說明）整塊被 hide', () => {
    const media = articleEl.querySelector('[data-test="hero-media"]');
    assert.strictEqual(media.dataset.jreadHidden, '1', 'media wrapper 必須標記 data-jread-hidden="1"');
    assert.strictEqual(media.style.display, 'none', 'media wrapper 必須 inline display:none');
  });

  it('(b2) hero video 與其說明文字隨 wrapper 一起被帶走（落在 hidden 子樹內）', () => {
    const v = articleEl.querySelector('[data-test="hero-video"]');
    const cap = articleEl.querySelector('[data-test="hero-caption"]');
    assert.ok(v.closest('[data-jread-hidden="1"]'), 'hero video 必須落在被 hide 的 wrapper 子樹內');
    assert.ok(cap.closest('[data-jread-hidden="1"]'), '影片說明文字必須落在被 hide 的 wrapper 子樹內');
  });

  it('(c) 標題 h1 必須保留（walk-up 停在 header 下一層，不吞標題）', () => {
    const h1 = articleEl.querySelector('[data-test="title"]');
    assert.notStrictEqual(h1.dataset.jreadHidden, '1', '標題 h1 不可被 hide');
    assert.ok(!h1.closest('[data-jread-hidden="1"]'), '標題 h1 不可落在被 hide 的子樹內');
  });

  it('(c2) 摘要與 header 本身保留', () => {
    const summary = articleEl.querySelector('[data-test="summary"]');
    const header = articleEl.querySelector('[data-test="hero-header"]');
    assert.ok(!summary.closest('[data-jread-hidden="1"]'), '摘要不可被 hide');
    assert.notStrictEqual(header.dataset.jreadHidden, '1', '<header> 本身不可被 hide（含標題）');
  });

  it('(d) 主文段落 body-p-1~4 全部保留', () => {
    for (let i = 1; i <= 4; i++) {
      const p = articleEl.querySelector(`[data-test="body-p-${i}"]`);
      assert.ok(p, `主文 body-p-${i} 必須存在`);
      assert.ok(!p.closest('[data-jread-hidden="1"]'), `主文 body-p-${i} 不可被 hide`);
    }
  });

  it('(e) 編輯性 <figure><video controls> 必須保留（controls + static 雙保險）', () => {
    const fig = articleEl.querySelector('[data-test="legit-figure"]');
    const vid = articleEl.querySelector('[data-test="legit-video"]');
    assert.notStrictEqual(fig.dataset.jreadHidden, '1', '編輯性影片 figure 不可被誤 hide');
    assert.ok(!vid.closest('[data-jread-hidden="1"]'), '編輯性影片不可落在被 hide 的子樹內');
  });
});
