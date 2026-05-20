// JRead — regression spec: Stratechery / WordPress block theme h2 主標題 promote (v0.7.149)
// -----------------------------------------------------------------------------
// Forcing function for promoteArticleTitleClassHeadingInto v0.7.149。
// Trigger: Jimmy 2026-05-20 回報 Stratechery 自動翻譯後標題消失。
//
// 自動翻譯改 h2 textContent → detector 評分變、選內層 entry-content 為
// articleEl → 主標題 h2.wp-block-post-title 在外層 sibling 被 hideAncestorSiblings
// hide → reader card 內無標題。
//
// v0.7.149：cleaner 末段加 promoteArticleTitleClassHeadingInto——articleEl
// 內無 visible h1 時、page-wide 找 DOM order 第一個 article-title class
// signal h1/h2/h3、clone 進 articleEl 開頭。
//
// 6 條 forcing function:
//   (a) fixture 結構驗證
//   (b) articleEl 內必須含 title clone（核心保護點）
//   (c) clone text 含 main h2 內容
//   (d) sidebar related-article-h2（DOM order 在主標題之後）不被 promote（不重複）
//   (e) 主文段落保留 + section heading 保留
//   (f) 不在 articleEl 內有 visible h1 時、新 fn skip 不重複 promote（保護點）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'stratechery-translated-h2-title.html');

describe('cleaner — Stratechery translated h2 main title promote (v0.7.149)', function() {
  this.timeout(10000);
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
    articleEl = document.querySelector('.entry-content');
    assert.ok(articleEl, 'fixture 必須含 .entry-content articleEl');
    window.__JRead.cleaner.clean(articleEl);
  });

  // -------- (a) fixture 結構驗證 --------
  it('(a) fixture: main h2 + sidebar h2 都存在且 class 命中 article-title token', () => {
    const main = document.querySelector('[data-test="main-h2"]');
    const sidebar = document.querySelector('[data-test="related-article-h2"]');
    assert.ok(main, 'main h2 必須存在');
    assert.ok(sidebar, 'sidebar h2 必須存在');
    assert.ok(/wp-block-post-title/.test(main.className), 'main h2 含 wp-block-post-title class');
    assert.ok(/wp-block-post-title/.test(sidebar.className), 'sidebar h2 也含 wp-block-post-title class');
    // articleEl 內無 h1（v0.7.149 觸發條件）
    assert.strictEqual(articleEl.querySelectorAll('h1').length, 0,
      'articleEl 內必須無 h1（v0.7.149 觸發條件）');
    // articleEl 內 main h2 不在 articleEl 內
    assert.ok(!articleEl.contains(main), 'main h2 必須在 articleEl 外（觸發條件）');
  });

  // -------- (b) articleEl 必須含 title clone（核心保護點）--------
  it('(b) articleEl 必須含 1 個 data-jread-title-clone="1"（核心保護點）', () => {
    const clones = articleEl.querySelectorAll('[data-jread-title-clone="1"]');
    assert.strictEqual(clones.length, 1,
      `articleEl 內必須恰好 1 個 title clone（v0.7.149 修法觸發），實際 ${clones.length}`);
  });

  // -------- (c) clone text 含 main h2 內容 --------
  it('(c) title clone text 含 main h2 翻譯後內容（"請聽聽我的 Podcast"）', () => {
    const clone = articleEl.querySelector('[data-jread-title-clone="1"]');
    assert.ok(clone);
    assert.ok(/請聽聽我的\s*Podcast/.test(clone.textContent),
      `clone 必須含繁體「請聽聽我的 Podcast」（翻譯後標題），實際：${clone.textContent.slice(0, 100)}`);
    // clone 不應含「個人休假日」（sidebar widget 的 related article 標題）
    assert.ok(!/個人休假日/.test(clone.textContent),
      `clone 不可含 sidebar related-article 的「個人休假日」`);
  });

  // -------- (d) clone 是 articleEl 第一個 child --------
  it('(d) clone 是 articleEl 第一個 child（標題在最上）', () => {
    const first = articleEl.firstElementChild;
    assert.ok(first, 'articleEl 必須有 child');
    assert.strictEqual(first.dataset.jreadTitleClone, '1',
      `articleEl 第一個 child 必須是 title clone，實際 ${first.tagName}.${first.className || '(none)'}`);
  });

  // -------- (e) 主文段落 + section heading 全保留 --------
  it('(e) 主文 body-p-1, body-p-2, section heading 全部保留（cleaner 不誤殺）', () => {
    for (const sel of ['body-p-1', 'body-p-2', 'section-h2']) {
      const el = articleEl.querySelector(`[data-test="${sel}"]`);
      assert.ok(el, `${sel} 必須存在`);
      assert.notStrictEqual(el.dataset.jreadHidden, '1',
        `${sel} 不可被 hide`);
    }
  });
});

describe('cleaner — v0.7.149 不誤觸發保護（articleEl 已有 h1）', function() {
  this.timeout(10000);
  it('articleEl 內含 visible h1 時、v0.7.149 fn early return 不重複 promote sidebar h2', () => {
    const env = loadFixtureWithScripts({
      fixturePath: path.join(__dirname, 'fixtures', 'stratechery-h1-already-present.html'),
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    const { window, document } = env;
    const articleEl = document.querySelector('article');
    assert.ok(articleEl);
    window.__JRead.cleaner.clean(articleEl);
    // articleEl 已有 h1 → 新 fn early return、不該 promote sidebar h2 進來
    const clones = articleEl.querySelectorAll('[data-jread-title-clone="1"]');
    assert.strictEqual(clones.length, 0,
      `articleEl 已有 h1 時不該重複 promote（實際 ${clones.length} 個 clone）`);
    // 既有 h1 仍存在且未被 hide
    const h1 = articleEl.querySelector('[data-test="main-h1"]');
    assert.ok(h1);
    assert.notStrictEqual(h1.dataset.jreadHidden, '1',
      '既有主 h1 不可被 hide');
  });
});
