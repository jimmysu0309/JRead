// JRead — regression spec: Stratechery 翻譯後標題消失（空 logo h1 擋 promote, v1.0.1）
// -----------------------------------------------------------------------------
// Forcing function for promoteArticleTitleClassHeadingInto 的 inner-h1 guard
// titleTextWeight >= 1 門檻（v1.0.1）。
//
// Trigger: Jimmy 2026-06-23 回報 Stratechery（memory-chips-and-china...）Shinkansen
// 翻譯後進閱讀模式標題消失。cage probe + cleaner instrument 實證：翻譯改字後
// detector 把付費牆 div.passport-marketing-page 選成 articleEl，其內 STRATECHERY
// PLUS logo 被包成 textContent 空的 <h1>。舊 guard「articleEl 內有 visible h1
// → skip promote」把這個空 h1 誤判成已有主標題早退 → 真標題沒 promote 進來。
//
// v1.0.1：inner h1 guard 加 titleTextWeight(text) >= 1——無文字的 logo/裝飾 h1
// 不算「已有標題」，不可擋 promote。
//
// 4 條 forcing function:
//   (a) fixture 結構驗證（articleEl 內含空 h1 + 真標題在 articleEl 外）
//   (b) articleEl 內必須含 title clone（核心保護點——空 h1 不再擋 promote）
//   (c) clone text 是真標題、非 logo 空字串
//   (d) 空 logo h1 仍保留（不被誤殺）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'stratechery-empty-h1-paywall.html');

describe('cleaner — Stratechery empty logo h1 must not block title promote (v1.0.1)', function() {
  this.timeout(10000);
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.querySelector('.passport-marketing-page');
    assert.ok(articleEl, 'fixture 必須含 .passport-marketing-page articleEl');
    env.window.__JRead.cleaner.clean(articleEl);
  });

  // -------- (a) fixture 結構驗證 --------
  it('(a) fixture: articleEl 內含 textContent 空的 h1，真標題 h2 在 articleEl 外', () => {
    const emptyH1 = document.querySelector('[data-test="empty-logo-h1"]');
    const mainH2 = document.querySelector('[data-test="main-h2"]');
    assert.ok(emptyH1, '空 logo h1 必須存在');
    assert.ok(articleEl.contains(emptyH1), '空 h1 必須在 articleEl 內（觸發條件）');
    assert.strictEqual(emptyH1.textContent.trim(), '', '空 h1 的 textContent 必須為空（logo 圖）');
    assert.ok(mainH2, '真標題 h2 必須存在');
    assert.ok(!articleEl.contains(mainH2), '真標題 h2 必須在 articleEl 外（觸發條件）');
  });

  // -------- (b) articleEl 必須含 title clone（核心保護點）--------
  it('(b) articleEl 必須含恰好 1 個 data-jread-title-clone="1"（空 h1 不擋 promote）', () => {
    const clones = articleEl.querySelectorAll('[data-jread-title-clone="1"]');
    assert.strictEqual(clones.length, 1,
      `空 logo h1 不該擋 promote，articleEl 內必須有 1 個 title clone，實際 ${clones.length}`);
  });

  // -------- (c) clone text 是真標題、非空字串 --------
  it('(c) title clone text 含真標題「記憶體晶片與中國、微軟與中國模式」', () => {
    const clone = articleEl.querySelector('[data-jread-title-clone="1"]');
    assert.ok(clone);
    assert.ok(/記憶體晶片與中國/.test(clone.textContent),
      `clone 必須含真標題，實際：${clone.textContent.slice(0, 80)}`);
  });

  // -------- (d) 空 logo h1 仍保留 --------
  it('(d) 空 logo h1 仍存在（promote 邏輯不誤殺）', () => {
    const emptyH1 = document.querySelector('[data-test="empty-logo-h1"]');
    assert.ok(emptyH1, '空 logo h1 不可被移除');
  });
});
