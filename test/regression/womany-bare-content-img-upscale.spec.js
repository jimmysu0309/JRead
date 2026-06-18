// JRead — bare 內容圖放大填滿欄寬 regression spec（v0.8.112）
//
// 根因（2026-06-18 Jimmy 回報 womany.net article/2823 卡蘿配圖「尺寸太小」）：
// 站點配圖是裸 <img>（非 a 包），來源解析度小（natural 285/304px portrait），
// 原站以小幅放大顯示（352px）。reader 的 img:not(a>img){ width:auto } 退回
// naturalWidth 285 → 在 720 版心（內容寬 ~608）裡只佔約半寬，與 a 包大圖
// （填滿欄寬）視覺不一致（probe 實證 reader rect 285 vs 其他圖 608）。
//
// 通則修法（結構性、不綁站點 class）：apply() 對「裸 img（非 a 包）+ 非 inline
// + 非 capIcon + content-size（>= CONTENT_IMG_MIN 一維）」標 data-jread-upscale-img，
// CSS width:100% 撐滿欄寬。Safari / Firefox 閱讀模式同款「內容圖一律填欄寬」。
// 門檻排除 icon/logo（< 200px 維持原尺寸），capIcon（作者刻意縮小的大圖）已在
// 分類前攔截、不落到這支被反向放大。
//
// 本 spec 驗的訊號層：apply() 後 data-jread-upscale-img 標記的命中/排除正確性 +
// restore() 可逆性。不驗實際 width:100% 視覺寬度（jsdom 不算 layout；視覺由
// Playwright harness + probe-womany 驗、已實證 reader rect 285→608）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'womany-bare-content-img-upscale.html');
const ATTR = 'data-jread-upscale-img';

const SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function stubNatural(img, w, h) {
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
}
function stubComplete(img) {
  Object.defineProperty(img, 'complete', { value: true, configurable: true });
}

function setup() {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 應有 <article>');

  // 裸小來源配圖：natural 285×365、原站顯示 352px → 應標 upscale 撐滿欄寬
  const small = env.document.getElementById('bare-small-photo');
  stubNatural(small, 285, 365); stubComplete(small);
  stubRect(small, { top: 100, left: 0, width: 352, height: 450 });

  // 裸大來源圖：natural 1200×800 → 也標 upscale（width:100% 對它=cap、無害）
  const large = env.document.getElementById('bare-large-photo');
  stubNatural(large, 1200, 800); stubComplete(large);
  stubRect(large, { top: 600, left: 0, width: 608, height: 405 });

  // 裸小圖（natural 100×100 < CONTENT_IMG_MIN）→ logo/badge、不標 upscale
  const icon = env.document.getElementById('bare-icon');
  stubNatural(icon, 100, 100); stubComplete(icon);
  stubRect(icon, { top: 1100, left: 0, width: 100, height: 100 });

  // a 包大內容圖 → 走 content-img 路徑、不走 upscale 支
  const linked = env.document.getElementById('linked-photo');
  stubNatural(linked, 650, 512); stubComplete(linked);
  stubRect(linked, { top: 1300, left: 0, width: 608, height: 479 });

  // 內嵌 emoji（natural 32×32）→ inline、不標 upscale
  const emoji = env.document.getElementById('inline-emoji');
  stubNatural(emoji, 32, 32); stubComplete(emoji);
  stubRect(emoji, { top: 1900, left: 0, width: 32, height: 32 });

  return { ...env, articleEl, small, large, icon, linked, emoji };
}

describe('womany-bare-content-img-upscale — 裸內容圖放大填滿欄寬（v0.8.112）', () => {
  it('裸小來源配圖（natural 285、content-size）標 data-jread-upscale-img', () => {
    const { NS, articleEl, small } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(small.getAttribute(ATTR), '1',
      '低解析裸配圖必須被標 upscale（否則 width:auto 退回 natural 顯得特別小）');
  });

  it('裸大來源圖也標 upscale（width:100% 對它是 cap、無害）', () => {
    const { NS, articleEl, large } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(large.getAttribute(ATTR), '1',
      '裸大內容圖 width:100% = 填滿欄寬（與既有 max-width:100% cap 等效）');
  });

  it('裸小圖（natural 100 < CONTENT_IMG_MIN）不標 upscale（維持原尺寸、不反向放大）', () => {
    const { NS, articleEl, icon } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(icon.getAttribute(ATTR), null,
      'logo/badge 類小圖不該被放大成滿欄（避免無謂副作用）');
  });

  it('a 包內容圖不走 upscale 支（交給既有 content-img 路徑）', () => {
    const { NS, articleEl, linked } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(linked.getAttribute(ATTR), null,
      'a > img 是 lightbox 結構、走 content-img 規則、不走 bare upscale 支');
  });

  it('內嵌 emoji 不標 upscale', () => {
    const { NS, articleEl, emoji } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(emoji.getAttribute(ATTR), null,
      'inline emoji 已先排除、不該被放大');
  });

  it('restore() 移除 upscale 標記（可逆性）', () => {
    const { NS, articleEl, small } = setup();
    const snapshot = NS.styler.apply(articleEl, SETTINGS);
    NS.styler.restore(articleEl, snapshot);
    assert.strictEqual(small.getAttribute(ATTR), null,
      'restore 必須移除 data-jread-upscale-img');
  });
});
