// JRead — regression spec: eet-china translated title fallback (v0.7.147)
// -----------------------------------------------------------------------------
// Forcing function for promoteUniqueTitleH1Into v0.7.147 fallback：翻譯擴展
// （Shinkansen / Google Translate 等）翻 body h1 從簡 → 繁、但 `<title>` tag
// 仍是簡體，造成 v0.7.141 strict equality check（h1Text !== docT）失敗、
// promote skip、標題被 hideAncestorSiblings hide 後消失。
//
// Trigger: Jimmy 2026-05-20 回報 https://www.eet-china.com/news/202604299557.html
// 「這篇簡體中文的文章使用 Shinkansen 翻譯為繁體中文時，文章標題就會不見」。
//
// 修法：strict eq fail 時走 fallback `looksLikeArticleTitleH1` ——h1 自身或
// parent class / id 含明確「主文標題」訊號（TITLE_CLASS_HIT_RE 命中 article-
// title / post-title / entry-title / headline 等慣用 token、排除 subtitle）
// 則仍 promote。
//
// 5 條 forcing function:
//   (a) fixture 結構驗證（doc title 簡體 / h1 text 繁體 / 結構吻合）
//   (b) cleaner 跑完後 articleEl 內必須有 title clone（核心保護點）
//   (c) clone text 必須含繁體 h1 內容
//   (d) 原 wrapper 被 hideAncestorSiblings hide（v0.7.141 行為延續）
//   (e) 主文 body-p-1 ~ p-3 全部保留

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'eet-china-translated-title.html');

describe('cleaner — eet-china translated title fallback (v0.7.147)', () => {
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
    articleEl = document.querySelector('.article-text-con');
    assert.ok(articleEl, 'fixture 必須含 .article-text-con div');
    window.__JRead.cleaner.clean(articleEl);
  });

  // -------- (a) fixture 結構數值驗證 --------
  it('(a) fixture: doc title 簡體、h1 text 繁體、article class 命中', () => {
    assert.ok(/苹果iPhone/.test(document.title), `doc title 必須含簡體「苹果」，實際：${document.title}`);
    const h1 = document.querySelector('[data-test="h1"]');
    assert.ok(h1, 'h1 必須存在');
    assert.ok(/蘋果iPhone/.test(h1.textContent),
      `h1 text 必須含繁體「蘋果」（翻譯後狀態），實際：${h1.textContent}`);
    assert.strictEqual(h1.className, 'article-title',
      'h1 class 必須是 article-title（fallback 觸發訊號）');
    // strict equality 必然 fail（簡 vs 繁）
    assert.notStrictEqual(
      h1.textContent.trim(),
      (document.title || '').split(/[|｜\-—–]/)[0].trim(),
      'h1 text vs docT 必須 strict eq fail（否則此 spec 沒測到 fallback）'
    );
  });

  // -------- (b) articleEl 必須含 title clone（v0.7.147 修法核心）--------
  it('(b) articleEl 必須含 data-jread-title-clone="1" 元素', () => {
    const clones = articleEl.querySelectorAll('[data-jread-title-clone="1"]');
    assert.strictEqual(clones.length, 1,
      `articleEl 內必須恰好 1 個 title clone（v0.7.147 fallback 觸發點），實際 ${clones.length}`);
  });

  // -------- (c) clone text 必須含繁體 h1 內容 --------
  it('(c) title clone 必須含繁體 h1 內容（翻譯結果）', () => {
    const clone = articleEl.querySelector('[data-jread-title-clone="1"]');
    assert.ok(clone, 'title clone 必須存在');
    assert.ok(/蘋果iPhone/.test(clone.textContent),
      `clone 必須含繁體「蘋果」，實際：${clone.textContent}`);
    assert.ok(/印度製造/.test(clone.textContent),
      `clone 必須含繁體「製造」，實際：${clone.textContent}`);
  });

  // -------- (d) 原 wrapper 被 hideAncestorSiblings hide --------
  it('(d) 原 h1 wrapper（.rowPage.row-article-title）必須被 hide（避免重複顯示）', () => {
    const wrappers = Array.from(document.querySelectorAll('.rowPage.row-article-title'));
    // articleEl 外的原 wrapper
    const original = wrappers.find(w => !articleEl.contains(w));
    assert.ok(original, '原 h1 wrapper（articleEl 外）必須存在');
    assert.strictEqual(original.dataset.jreadHidden, '1',
      '原 wrapper 必須被 hideAncestorSiblings hide（避免標題重複顯示）');
  });

  // -------- (e) 主文段落全部保留 --------
  it('(e) 主文 body-p-1 ~ p-3 全部保留', () => {
    for (let i = 1; i <= 3; i++) {
      const p = articleEl.querySelector(`[data-test="body-p-${i}"]`);
      assert.ok(p, `主文 body-p-${i} 必須存在`);
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 body-p-${i} 不可被 hide`);
    }
  });
});
