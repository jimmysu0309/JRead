// JRead — regression spec: eet-china translate-first 標題重複修法 (v1.6.7)
// -----------------------------------------------------------------------------
// Trigger: Jimmy 2026-07-02 回報 https://www.eet-china.com/news/202606304222.html
// 「Shinkansen 翻譯後變得亂七八糟」——閱讀模式出現兩張相同的標題卡。
//
// 根因：eet-china 類站的 h1 同時滿足兩條 promote path 的觸發條件（page-wide
// unique + article-title class）。翻譯優先（translate-first）時 promoteUniqueTitleH1Into
// 把標題 clone 放 articleEl「外」（前一 sibling、data-jread-promoted-outside，避開
// 翻譯擴充 content guard reconcile）；promoteArticleTitleClassHeadingInto 的舊去重
// guard 只查 `articleEl.querySelector('[data-jread-title-clone]')`——查不到外置的
// clone → 再 promote 一份 → 兩個 promoted-outside clone → 兩張標題卡。
//
// 修法：改用 articleHasPromotedTitle helper，同時涵蓋 in-article（clone / injected-title）
// 與翻譯頁外置（articleEl 前一 sibling 帶 promoted-outside + title-clone）兩種位置。
//
// forcing function:
//   (a) fixture 結構：h1 帶 shinkansen 標記、isTranslatedPage() 為 true
//   (b) 全頁 title clone 恰好 1 個（核心——修前為 2）
//   (c) 該 clone 放 articleEl「外」（data-jread-promoted-outside）
//   (d) 主文段落全部保留

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'eet-china-translated-dup-title.html');

describe('cleaner — eet-china translate-first 標題重複修法 (v1.6.7)', () => {
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

  // -------- (a) fixture 結構：翻譯優先狀態 --------
  it('(a) isTranslatedPage() 為 true（fixture 帶 shinkansen 標記）', () => {
    assert.strictEqual(window.__JRead.isTranslatedPage(), true,
      'fixture 必須模擬翻譯優先（否則不會走外置放置路徑、測不到重複）');
    const h1 = document.querySelector('[data-test="h1"]');
    assert.ok(h1 && h1.className === 'article-title',
      'h1 必須帶 article-title class（同時觸發兩條 promote path 的前提）');
  });

  // -------- (b) 全頁 title clone 恰好 1 個（核心）--------
  it('(b) 全頁 data-jread-title-clone 恰好 1 個（修前為 2、重複標題）', () => {
    const clones = document.querySelectorAll('[data-jread-title-clone="1"]');
    assert.strictEqual(clones.length, 1,
      `翻譯優先下標題 clone 必須恰好 1 個，實際 ${clones.length}（>1 代表重複標題 bug 復發）`);
    const outside = document.querySelectorAll('[data-jread-promoted-outside="1"]');
    assert.strictEqual(outside.length, 1,
      `promoted-outside clone 必須恰好 1 個，實際 ${outside.length}`);
  });

  // -------- (c) clone 放 articleEl 外（翻譯頁契約）--------
  it('(c) 唯一 clone 放 articleEl 外（前一個 sibling、帶 promoted-outside）', () => {
    const clone = document.querySelector('[data-jread-title-clone="1"]');
    assert.ok(clone, 'title clone 必須存在');
    assert.strictEqual(clone.getAttribute('data-jread-promoted-outside'), '1',
      'clone 必須標 data-jread-promoted-outside（翻譯頁避開 content guard 的放置位置）');
    assert.ok(!articleEl.contains(clone),
      'clone 必須在 articleEl 外');
    assert.ok(/立訊精密赴港上市/.test(clone.textContent),
      `clone 必須含標題文字，實際：${clone.textContent}`);
  });

  // -------- (d) 主文段落全部保留 --------
  it('(d) 主文 body-p-1 ~ p-3 全部保留', () => {
    for (let i = 1; i <= 3; i++) {
      const p = articleEl.querySelector(`[data-test="body-p-${i}"]`);
      assert.ok(p, `主文 body-p-${i} 必須存在`);
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 body-p-${i} 不可被 hide`);
    }
  });
});
