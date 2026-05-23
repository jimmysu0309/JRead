// JRead — regression spec: absolute overlay picture/img/video guard (v0.7.170)
// -----------------------------------------------------------------------------
// Forcing function for hideInsideArticleAbsoluteOverlays v0.7.170 guard：
// 含 picture / img / video 後代的 absolute wrapper 視為「aspect-ratio 媒體
// wrapper」設計（lazy-load padding-bottom hack + 內層 absolute container 包
// picture/img），skip 不 hide（hide 後內含 picture / img 被 ancestor
// display:none 連帶完全消失）。
//
// Trigger: Jimmy 2026-05-23 回報 CNBC blob 文章 dark mode 圖片完全沒出來。
// probe outerHTML 顯示 InlineImage `imageContainer` div（position:absolute、
// 包 picture）+ `imagePlaceholder` 都被 v0.7.111 absolute overlay rule hide
// → 主圖整塊消失只剩 caption + body 文字。
//
// 5 條 forcing function:
//   (a) fixture 結構驗證
//   (b) absolute-picture-wrapper（imageContainer）不可被 hide（核心保護點）
//   (c) picture / img 自身 + visible（沒 ancestor hidden 連帶 0×0）
//   (d) overlay-no-media-aside / overlay-no-media-div 仍被 hide（v0.7.111 行為不退步）
//   (e) 主文 body-p-1, body-p-2 全保留

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'cnbc-absolute-picture-wrapper.html');

describe('cleaner — absolute overlay picture/img guard (CNBC, v0.7.170)', () => {
  let window, document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('article');
    assert.ok(articleEl, 'fixture 必須含 <article>');
    window.__JRead.cleaner.clean(articleEl);
  });

  // -------- (a) fixture 結構數值驗證 --------
  it('(a) fixture: imageContainer 結構符合最小重現條件', () => {
    const container = articleEl.querySelector('[data-test="image-container"]');
    assert.ok(container, 'imageContainer 必須存在');
    const cs = window.getComputedStyle(container);
    assert.strictEqual(cs.position, 'absolute',
      'imageContainer 必須 position:absolute（v0.7.111 absolute rule 觸發條件）');
    assert.ok(container.querySelector('picture'),
      'imageContainer 必須含 picture（v0.7.170 guard 觸發條件）');
    assert.ok(container.querySelector('img'),
      'imageContainer 必須含 img');
  });

  // -------- (b) absolute-picture-wrapper 不可被 hide（核心保護點）--------
  it('(b) absolute picture wrapper（imageContainer）必須未被 hideInsideArticleAbsoluteOverlays hide', () => {
    const container = articleEl.querySelector('[data-test="image-container"]');
    assert.notStrictEqual(container.dataset.jreadHidden, '1',
      'imageContainer 不可被 hide（核心保護點：含 picture/img 的 absolute wrapper = media aspect-ratio wrapper）');
    assert.notStrictEqual(container.style.display, 'none',
      'imageContainer inline display 不可為 none');
  });

  // -------- (c) picture / img 自身保留 + 未被 ancestor hide 連帶 --------
  it('(c) picture / img 自身未被 hide、所有祖先到 article 也未被 hide（連帶保證）', () => {
    const pic = articleEl.querySelector('[data-test="image-picture"]');
    const img = articleEl.querySelector('[data-test="image-img"]');
    assert.ok(pic && img, 'picture / img 必須存在');
    assert.notStrictEqual(pic.dataset.jreadHidden, '1');
    assert.notStrictEqual(img.dataset.jreadHidden, '1');
    // 沿祖先鏈到 articleEl 確認都沒 hidden
    for (const start of [pic, img]) {
      let cur = start;
      while (cur && cur !== articleEl) {
        assert.notStrictEqual(cur.dataset.jreadHidden, '1',
          `${start.tagName} 祖先 ${cur.tagName}.${(cur.className || '').toString().slice(0, 40)} 不可被 hide（連帶會讓圖 0×0 消失）`);
        cur = cur.parentElement;
      }
    }
  });

  // -------- (d) 無 media 的 absolute overlay 仍被 hide（v0.7.111 行為不退步）--------
  it('(d) overlay-no-media-aside / overlay-no-media-div 仍被 hide（v0.7.111 行為延續）', () => {
    const aside = articleEl.querySelector('[data-test="overlay-no-media-aside"]');
    const div = articleEl.querySelector('[data-test="overlay-no-media-div"]');
    assert.ok(aside && div, 'overlay-no-media 元素必須存在');
    assert.strictEqual(aside.dataset.jreadHidden, '1',
      'overlay-no-media-aside（position:absolute 無 picture/img）仍應被 v0.7.111 hide（互補不退步）');
    assert.strictEqual(div.dataset.jreadHidden, '1',
      'overlay-no-media-div（position:absolute 無 picture/img）仍應被 v0.7.111 hide（互補不退步）');
  });

  // -------- (e) 主文 body-p 保留 --------
  it('(e) 主文 body-p-1, body-p-2 全保留（修法不破壞主文）', () => {
    for (const sel of ['body-p-1', 'body-p-2']) {
      const p = articleEl.querySelector(`[data-test="${sel}"]`);
      assert.ok(p, `${sel} 必須存在`);
      assert.notStrictEqual(p.dataset.jreadHidden, '1', `${sel} 不可被 hide`);
    }
  });
});
