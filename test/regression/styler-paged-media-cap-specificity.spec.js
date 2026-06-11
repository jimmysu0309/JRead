// JRead — 翻頁模式媒體單頁 cap 必須贏過 base 90vh cap（v0.8.35）
//
// Bug：base 媒體 cap selector `[data-jread-active] img:not(a > img):not([player])
// :not([inline-img])` specificity (0,3,3)（:not(a > img) 依 Selectors 4 取引數
// 最高 specificity 計 2 個 type），翻頁模式媒體規則用 html 前綴只有 (0,2,2)。
// 兩邊都 !important、同一張 stylesheet → specificity 高者勝，base 的 90vh 蓋掉
// 翻頁的單頁 cap（calc(100dvh − gutter×2 − 120px)）。任何 viewport 高 < 2160px
// 下 90vh > 欄高 → 裸 img（非 a 包）的直式長圖超出 fragmentainer、break-inside:
// avoid 失效、圖被跨頁切割。a-wrapped 大圖走 content-img rule (0,2,1) 不受影響
// ——Substack 類測試站（a 包圖）全綠、裸 img 站才現形，是「harness 綠 ≠ 全綠」
// 的典型訊號層次漏洞。
//
// 修法：MEDIA_CAP_SEL 抽常數（base 與翻頁共用同一份 selector 文字），翻頁模式
// 末端以「逐字相同 selector、同 specificity、stylesheet 後注入者勝」覆寫
// max-height。本 spec 驗 CSS 字串的 cascade 結構（同 selector + 出現順序）；
// 不驗真實 multicol 渲染（Chromium 軌 harness --paged / WebKit 軌見 debug 文件）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'paged-mode.html');

const BASE_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

// base 媒體 cap 的裸 img selector（MEDIA_CAP_SEL 第一行）——逐字比對，
// 任何一邊改 selector 沒同步另一邊，本 spec 會抓到
const BARE_IMG_SEL = '[data-jread-active="1"] img:not(a > img):not([data-jread-player="1"]):not([data-jread-inline-img])';

function applyAndGetCss(settings) {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  env.NS.styler.apply(articleEl, settings);
  return env.document.getElementById('__jread-style').textContent;
}

describe('styler — 翻頁模式媒體 cap specificity（v0.8.35）', () => {
  it('pagedMode: true → base 90vh 之後必須有「逐字同 selector」的單頁 cap 覆寫', () => {
    const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });

    const idx90 = css.indexOf('max-height: 90vh');
    assert.ok(idx90 >= 0, 'base 媒體 90vh cap 必須存在');
    assert.ok(css.lastIndexOf(BARE_IMG_SEL, idx90) >= 0,
      '90vh cap 的 selector 必須是裸 img 完整排除鏈（base 規則形狀變了，同步檢查本 spec 與 MEDIA_CAP_SEL）');

    // 90vh 之後必須再出現同一份 selector 的覆寫（同 specificity、後注入勝）
    const selAfter = css.indexOf(BARE_IMG_SEL, idx90);
    assert.ok(selAfter > idx90,
      '翻頁模式必須以與 base 逐字相同的 selector 在 90vh 規則之後覆寫（html 前綴版 specificity (0,2,2) 打不過 base (0,3,3)）');
    const block = css.slice(selAfter, css.indexOf('}', selAfter));
    assert.ok(/max-height:\s*calc\(100dvh/.test(block),
      '覆寫規則必須含單頁 cap（calc(100dvh − gutter×2 − 120px)）');
    assert.ok(/!important/.test(block), '覆寫必須 !important（與 base 同層才比 specificity / 順序）');
  });

  it('pagedMode: false → 不得注入單頁 cap 覆寫（垂直模式一行都不受影響）', () => {
    const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: false });
    const idx90 = css.indexOf('max-height: 90vh');
    assert.ok(idx90 >= 0, 'base 90vh cap 必須存在');
    assert.strictEqual(css.indexOf(BARE_IMG_SEL, idx90 + 1), -1,
      '垂直模式不可出現翻頁覆寫規則');
  });
});
