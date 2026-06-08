// JRead — 雜訊 heading 不可壓掉真標題注入 regression（v0.8.3）
//
// 對應 bug（Jimmy 2026-06-09 回報 roomie.tw/posts/73403）：
//   - Chrome 閱讀模式「標題完全沒出現」
//   - iOS 閱讀模式「標題字體相當小」
//
// 根因：站方把真標題做成「sr-only H1（視覺隱藏）+ 非 heading span.title」，
// 而文章末尾有一個 cleaner 漏網的雜訊 H3（「現在就追蹤…看更多」）。
// 舊 markPromotedTitleIfMissing guard「articleEl 內有任何 non-hidden h1-h4
// 就放棄注入」被這個雜訊 H3 誤觸 → 真標題從不注入 → Chrome 整個沒標題、
// iOS 退回站方 23px 小 span。
//
// 修法：guard 只在「可見 h1-h4 文字等同 og:title」時才放棄注入；雜訊 heading
// 不等同 og:title，不再壓掉注入。注入後並把其餘 leaf 標題載體去重 hide
// （避免 responsive 站 desktop/mobile 雙份 span 殘留第二個標題）。
//
// 本 spec 是 forcing function：
//   - 雜訊 H3 存在時，真標題仍必須被注入（[data-jread-injected-title]）
//   - 反向 sanity：可見 heading 等同 og:title（真標題已是 heading）時不得注入

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'roomie-noise-heading-blocks-title.html');

describe('detector — cleaner 漏網的雜訊 heading 不可壓掉真標題注入（v0.8.3）', () => {
  let document, articleEl, NS;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    NS = env.NS;
    articleEl = document.querySelector('main');
    articleEl.setAttribute('data-jread-active', '1');
    // 模擬 main.js 流程：cleaner 跑完後才 markPromotedTitleIfMissing
    NS.cleaner.clean(articleEl, []);
    NS.detector.markPromotedTitleIfMissing(articleEl);
  });

  it('真標題必須被注入成 H1（雜訊 H3 不得壓掉注入）', () => {
    const injected = document.querySelector('[data-jread-injected-title="1"]');
    assert.ok(injected, '真標題必須被注入（[data-jread-injected-title]），但沒有');
    assert.ok(injected.textContent.includes('帶我去遠得要命的城市盡頭'),
      `注入標題文字不對: "${injected.textContent.slice(0, 30)}"`);
  });

  it('注入標題在 articleEl 開頭（hero 位置）', () => {
    const injected = document.querySelector('[data-jread-injected-title="1"]');
    assert.strictEqual(articleEl.firstElementChild, injected,
      '注入的 H1 必須是 articleEl 第一個子元素');
  });

  it('不得殘留第二個可見的標題載體（responsive 雙份 span 去重）', () => {
    // 所有含完整標題文字的 leaf 載體（除了注入 H1）都應被 hide
    let visibleDup = 0;
    for (const el of articleEl.querySelectorAll('span, p, h1, h2, h3, h4, h5, h6')) {
      if (el.hasAttribute('data-jread-injected-title')) continue;
      if (el.querySelectorAll('*').length > 2) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t.includes('帶我去遠得要命的城市盡頭')) continue;
      const hiddenInline = el.style && el.style.getPropertyValue('display') === 'none';
      const hiddenAttr = el.closest('[data-jread-hidden="1"]');
      if (!hiddenInline && !hiddenAttr) visibleDup++;
    }
    assert.strictEqual(visibleDup, 0,
      `注入後不應殘留可見的重複標題載體，實際 ${visibleDup} 個`);
  });
});

describe('detector — 可見 heading 等同 og:title 時不得重複注入（反向 sanity，v0.8.3）', () => {
  it('真標題已是可見 h1 時 markPromotedTitleIfMissing 不注入', () => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    const { document, NS } = env;
    const articleEl = document.querySelector('main');
    articleEl.setAttribute('data-jread-active', '1');
    // 把 sr-only H1 變成可見真標題（移除 hide），模擬「站方標題本就是可見 h1」
    const srH1 = document.querySelector('h1.sr-only');
    srH1.removeAttribute('data-jread-hidden');
    srH1.style.removeProperty('display');
    NS.detector.markPromotedTitleIfMissing(articleEl);
    const injected = document.querySelector('[data-jread-injected-title="1"]');
    assert.strictEqual(injected, null,
      '真標題已是可見 h1，不該再注入重複標題');
  });
});
