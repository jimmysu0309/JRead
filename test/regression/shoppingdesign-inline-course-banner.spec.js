// JRead — shoppingdesign 內文嵌入課程廣告 banner 整塊清除 regression（v0.7.236）
//
// 對應 bug：https://www.shoppingdesign.com.tw/post/view/13485 閱讀模式內文中段
// 殘留站方課程廣告 banner（「週三開課！…設計裡的 AI 提案力」+「策略思維 ╳
// 企劃力 ╳ 設計力…」+「立即報名」鈕）（Jimmy 2026-06-08 回報）。
//
// 根因：該 banner class 無語意 noise keyword（`pumpkinbanner` 連寫、
// `bnextmeida-banner` 品牌詞、`support-box` / `support-pumpkin`——NOISE_KEYWORD_RE
// 的 banner 相關 token 都是複合詞如 `app-banner` / `cookie-banner`，bare banner
// 不在、且連寫詞 token 邊界不命中），且標題 / 描述 / 報名鈕拆成多個 sibling
// `div`（`div.title2` + `div.info2` + `div.link2 > a.btn-only2`）。既有
// hideInsideArticleByLinkText 對 strict CTA「立即報名」只 hide `<a>` 或其直接
// parent，留下標題 + 描述殘留。
//
// 修法（結構性通則）：strict CTA（立即報名 / 立即下載 等，主文不會自己叫讀者
// 報名）是「活動 / 課程推廣 block」最強訊號。新增 hideStrictCtaPromoBlock——從
// CTA 往上找「不含主文的最外層 wrapper」（重用 findSafeWrapperForHeading 的
// walk-up + 三道主文保護）整塊 hide。靜態 hideInsideArticleByLinkText（strict
// 命中）與動態 checkDynamicNoise（delayed lazy-inject 的 banner）兩路徑共用。
// 主文受 wrapperContainsArticleAnchor 保護；CTA parent 即含主文（esmchina 單一
// <a> 直掛主文流）時 walk-up 回 null、退回只 hide CTA 自己。不綁 hostname / class。
//
// 本 spec 是 forcing function：
//   - 整個 banner block（含標題 / 描述 / 報名鈕）必須被 hide
//   - 主文段落必須完整保留

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'shoppingdesign-inline-course-banner.html');

describe('cleaner — shoppingdesign 內文課程廣告 banner 整塊清除（v0.7.236）', () => {
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
    articleEl = document.querySelector('[data-test="article"]');
    assert.ok(articleEl);
    window.__JRead.cleaner.clean(articleEl);
  });

  function isHidden(el) {
    return !!(el && el.closest('[data-jread-hidden="1"]'));
  }

  it('整個課程廣告 banner block 必須被 hide', () => {
    const banner = document.querySelector('[data-test="course-banner"]');
    assert.strictEqual(banner.dataset.jreadHidden, '1',
      'banner block（support-box）本身應被 hide；strict CTA「立即報名」應觸發整塊 promo block 清除');
  });

  it('廣告標題（週三開課）不可殘留', () => {
    assert.ok(isHidden(document.querySelector('[data-test="ad-title"]')),
      '廣告標題 div.title2 應落在被 hide 的 banner 內');
  });

  it('廣告描述（策略思維…）不可殘留', () => {
    assert.ok(isHidden(document.querySelector('[data-test="ad-desc"]')),
      '廣告描述 div.info2 應落在被 hide 的 banner 內');
  });

  it('立即報名 CTA 鈕不可殘留', () => {
    assert.ok(isHidden(document.querySelector('[data-test="ad-cta"]')),
      '報名鈕 a.btn-only2 應落在被 hide 的 banner 內');
  });

  it('主文段落必須完整保留（banner 是主文 sibling、不可連累）', () => {
    for (const sel of ['[data-test="body-p-1"]', '[data-test="body-p-2"]', '[data-test="body-p-3"]']) {
      const p = document.querySelector(sel);
      assert.ok(p && !isHidden(p), `主文段落 ${sel} 不可被 hide`);
    }
  });
});
