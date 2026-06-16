// JRead — hidePreTitleDecorativeImages：標題前裝飾性縮小圖（v0.8.91）
//
// 對應 bug（washingtonpost Opinion 文章，Jimmy 2026-06-16 截圖回報「這個燈泡
// 是雜訊，請清除」）：Opinion 區橘底電燈泡 badge 是裸 <img>（HTML width=160 /
// CSS 顯示 56×56 / 來源 naturalWidth 1200），作者把大來源圖顯示縮小成標題上方
// 的版面裝飾。hideInsideArticlePreTitleNoise 因 badge 被當 content media、整個
// 同分支（含 Opinion / Editorial Board kicker）被保護而漏清。
//
// 修法（結構通則，非站點特判，硬規則 3）：位於第一個 h1 之前、非 a 包、顯示
// 尺寸兩維皆 <= 200 但 naturalWidth >= 1.5× 顯示寬（作者刻意縮小）→ 單獨 hide
// 該 img，保留同分支的 kicker / byline。放在 pre-title walker 之後，避免 walker
// 失去 badge 保護後誤殺 kicker。
//
// 本 spec 驗 clean() 後的 DOM 標記（jsdom 層）；不驗真實 Chrome 視覺（那層由
// /harness-verify 的 RESIDUAL/GAP audit + fullpage 截圖覆蓋）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'wapo-pre-title-decor-badge.html');

function stubNatural(img, w, h) {
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
}

function loadEnv() {
  return loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1000, height: 800 },
    pretendToBeVisual: true
  });
}

describe('cleaner — hidePreTitleDecorativeImages 標題前裝飾 badge（v0.8.91）', () => {
  let document;

  before(() => {
    const env = loadEnv();
    document = env.document;
    // 主 case：badge 作者縮小（natural 1200 / 顯示 56）
    const badge = document.querySelector('[data-test="badge"]');
    stubNatural(badge, 1200, 1200);
    stubRect(badge, { top: 10, left: 360, width: 56, height: 56 });
    env.window.__JRead.cleaner.clean(document.querySelector('[data-test="article-root"]'));
  });

  it('裝飾 badge img 被 hide（inline !important）', () => {
    const badge = document.querySelector('[data-test="badge"]');
    assert.strictEqual(badge.dataset.jreadHidden, '1',
      'lightbulb badge 必須被清（作者把 1200px 來源縮成 56px 放在標題上方）');
    assert.strictEqual(badge.style.getPropertyValue('display'), 'none');
    assert.strictEqual(badge.style.getPropertyPriority('display'), 'important',
      'hide() 必須 inline !important（硬教訓：stylesheet 軌輸給原站高 specificity）');
  });

  it('同分支的 kicker（Opinion / Editorial Board byline）保留', () => {
    assert.notStrictEqual(
      document.querySelector('[data-test="kicker-section"]').dataset.jreadHidden, '1',
      'Opinion section link 不可被連帶清掉');
    assert.notStrictEqual(
      document.querySelector('[data-test="kicker-byline"]').dataset.jreadHidden, '1',
      'Editorial Board byline 不可被連帶清掉');
    assert.notStrictEqual(
      document.querySelector('[data-test="badge-branch"]').dataset.jreadHidden, '1',
      'kicker 所在分支不可整支被 hide（只清 img）');
  });

  it('標題 / 副標 / 主文段落保留', () => {
    assert.notStrictEqual(document.querySelector('[data-test="main-h1"]').dataset.jreadHidden, '1');
    assert.notStrictEqual(document.querySelector('[data-test="subtitle"]').dataset.jreadHidden, '1');
    const main = document.querySelector('[data-test="main-content"]');
    assert.notStrictEqual(main.dataset.jreadHidden, '1');
    for (const p of main.querySelectorAll('p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });

  it('控制組 A：標題前的真 hero 圖（顯示 600px）不可被清', () => {
    const env = loadEnv();
    const hero = env.document.querySelector('[data-test="hero-img"]');
    stubNatural(hero, 1600, 1067);
    stubRect(hero, { top: 0, left: 0, width: 600, height: 400 });
    env.window.__JRead.cleaner.clean(env.document.querySelector('[data-test="article-root-hero"]'));
    assert.notStrictEqual(hero.dataset.jreadHidden, '1',
      '顯示 >= 200px 的 pre-title hero 不是裝飾 badge、不可被清');
  });

  it('控制組 B：natural ≈ displayed 的真小圖（無放大）不可被清', () => {
    const env = loadEnv();
    const small = env.document.querySelector('[data-test="small-img"]');
    stubNatural(small, 60, 60);
    stubRect(small, { top: 0, left: 360, width: 56, height: 56 });
    env.window.__JRead.cleaner.clean(env.document.querySelector('[data-test="article-root-small"]'));
    assert.notStrictEqual(small.dataset.jreadHidden, '1',
      'natural ≈ displayed 的小圖非作者刻意縮小、不命中裝飾 badge 訊號');
  });

  it('restore 可逆：clean snapshot 還原後 badge 不再 hidden', () => {
    const env = loadEnv();
    const badge = env.document.querySelector('[data-test="badge"]');
    stubNatural(badge, 1200, 1200);
    stubRect(badge, { top: 10, left: 360, width: 56, height: 56 });
    const articleEl = env.document.querySelector('[data-test="article-root"]');
    const snapshot = env.window.__JRead.cleaner.clean(articleEl);
    assert.strictEqual(badge.dataset.jreadHidden, '1');
    env.window.__JRead.cleaner.restore(snapshot);
    assert.notStrictEqual(badge.dataset.jreadHidden, '1',
      'restore 後 badge 應回復可見（可逆性）');
  });
});
