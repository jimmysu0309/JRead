// JRead — eet-china 標題消失 regression（v0.7.141）
//
// 對應 bug：https://www.eet-china.com/news/202604299557.html 開閱讀模式標題消失
// （Jimmy 2026-05-19 chrome-in-chrome probe 確認）。
//
// 根因：站點**無 `<article>` 標籤**，標題 `<h1>` 與內文 `<div class="article-text-con">`
// 是 `<body>` 的 sibling。detector heuristic 選文字密度高的內文 div 為 articleEl，
// 不含 h1；ensureArticleContainsTitleH1 算 LCA 到 `<body>`，被 reject 不 promote
// （line 590 guard：避免吞整頁）。cleaner hideAncestorSiblings 從 articleEl walk
// parent，把 sibling（含 h1 那個 wrapper）當外部雜訊 hide → 標題消失。
//
// 修法：cleaner.js clean 末段 `promoteUniqueTitleH1Into(articleEl)`——把 page-wide
// unique h1 的 wrapper cloneNode(true) prepend 進 articleEl 開頭、清 inline
// display + data-jread-hidden、標記 `data-jread-title-clone="1"`。原 wrapper 仍
// 由 hideAncestorSiblings hide（避免重複顯示）。clone 進 articleEl 後吃 styler
// reader card 樣式 —— dark/sepia theme color 自動正確、layout 整合進卡片。
//
// Jimmy 2026-05-19 dark theme 截圖回報「B 路線（只保 visible）」雖讓標題未消失
// 但**標題在卡片外、黑色字 + 黑色 page bg 幾乎不可見**。clone 進卡片內後 styler
// `* { color: dark-text }` 自動套上、視覺整合。
//
// 通則性：page 唯一 h1（多數新聞站慣例）視為主文標題；跨站適用、不綁 eet-china。
//
// 本 spec 是 forcing function：
//   - detector 仍選 article-text-con div（heuristic 行為不變）
//   - articleEl 內必須出現 clone（含原 h1 文字）+ 標記 data-jread-title-clone="1"
//   - clone 必須是 articleEl 的第一個 child（標題在最上）
//   - 原 h1 wrapper 仍被 hideAncestorSiblings hide（避免雙重顯示）
//   - 其他 sibling（header / footer / 相關閱讀）仍被清

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'eet-china-title-sibling.html');

describe('cleaner — eet-china 標題與內文 sibling 結構（v0.7.141）', () => {
  let window, document, articleEl, hidden;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    // 實機 chrome-in-chrome probe 顯示 detector 選 .article-text-con 為 articleEl
    // （不含 h1）。jsdom 環境因無 layout / rect、detector promote 行為差異會升到
    // body —— 本 spec 直接指定 articleEl 模擬實機行為，focus 在 cleaner 修法。
    articleEl = document.querySelector('.article-text-con');
    assert.ok(articleEl, 'fixture 必須含 .article-text-con div');
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  it('articleEl（指定為 .article-text-con）應含內文 p', () => {
    assert.ok(articleEl.querySelector('[data-test="body-p-1"]'),
      'articleEl 應含主文 p 段落');
  });

  it('fixture 原始 DOM 含 1 個 <h1>（cleaner 跑後 clone 會再加 1，總 2 個——這是 promoteUniqueTitleH1Into 觸發條件）', () => {
    // cleaner.clean 跑完後 page 上 h1 數 = 原 1 + clone 1 = 2。驗證 clone 機制觸發
    assert.strictEqual(document.querySelectorAll('h1').length, 2,
      'cleaner.clean 跑完應有 2 個 h1：原 wrapper 內 + clone 內');
  });

  it('articleEl 內必須出現標題 clone（data-jread-title-clone="1"）', () => {
    const clones = articleEl.querySelectorAll('[data-jread-title-clone="1"]');
    assert.strictEqual(clones.length, 1,
      `articleEl 內必須恰好有 1 個 data-jread-title-clone="1" 元素，實際 ${clones.length}`);
    const clone = clones[0];
    assert.ok(clone.textContent.includes('苹果iPhone'),
      'title clone 必須含 h1 原文字（苹果iPhone "印度制造"遭遇扩产难题）');
  });

  it('title clone 必須是 articleEl 的第一個 child（標題在最上）', () => {
    const first = articleEl.firstElementChild;
    assert.ok(first, 'articleEl 必須有至少 1 個 child');
    assert.strictEqual(first.dataset.jreadTitleClone, '1',
      'title clone 必須是 articleEl 第一個 child，實際第一個 child: ' +
      `<${first.tagName.toLowerCase()}${first.className ? '.' + first.className : ''}>`);
  });

  it('title clone 自己未被 hide（inline display 清空、無 data-jread-hidden）', () => {
    const clone = articleEl.querySelector('[data-jread-title-clone="1"]');
    assert.ok(clone);
    assert.notStrictEqual(clone.dataset.jreadHidden, '1');
    assert.notStrictEqual(clone.style.display, 'none');
  });

  it('title clone 內 h1 仍 visible（沒繼承 hidden 狀態）', () => {
    const clone = articleEl.querySelector('[data-jread-title-clone="1"]');
    const h1 = clone.querySelector('h1');
    assert.ok(h1, 'title clone 內必須含 h1');
    assert.notStrictEqual(h1.dataset.jreadHidden, '1');
  });

  it('原 h1 wrapper（.rowPage.row-article-title）仍被 hide（避免重複顯示）', () => {
    // 用 querySelectorAll 第一個（原 wrapper）；clone 在 articleEl 內也命中 .rowPage.row-article-title
    const wrappers = document.querySelectorAll('.rowPage.row-article-title');
    assert.ok(wrappers.length >= 1);
    // 原 wrapper 是 body 的 child，clone 是 articleEl 後代
    const original = Array.from(wrappers).find(w => !articleEl.contains(w));
    assert.ok(original, '原 h1 wrapper（articleEl 外的那個）必須存在');
    assert.strictEqual(original.dataset.jreadHidden, '1',
      '原 h1 wrapper 必須被 hideAncestorSiblings hide（標題已 clone 進 articleEl，原位顯示會重複）');
  });

  it('主文 4 個 p 全部保留', () => {
    const ps = document.querySelectorAll('[data-test^="body-p-"]');
    assert.ok(ps.length >= 4);
    for (const p of ps) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 ${p.dataset.test} 不可被 hide`);
    }
  });
});
