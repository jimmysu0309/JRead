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

  // v1.5.5：The Atlantic ArticleLeadArt hero「縮成小方塊」forcing function。
  // 根因（Jimmy 2026-06-27 回報 theatlantic.com/.../683884）：hero img 因 width/
  // height 屬性自帶 aspect-ratio auto 960/540，站點 stylesheet 用一條 (0,2,1)
  // specificity 的 height 規則把它釘成 36px → 寬度反推成 64px（width:100% 只解析成
  // picture flex item 的 64px）。修法：UPSCALE 規則補 height:auto（解除釘高、寬度由
  // 版心 width:100% 主導）+ attribute 加倍把 specificity 拉到 (0,3,1) 壓過站點那條
  // 後注入的 (0,2,1) height 規則（real-Chrome probe 實證 64×36 → 608×342）。
  // 本層驗注入 CSS 字串的結構（jsdom 無 layout、實際幾何由 probe-atlantic-hero +
  // debug-harness 截圖實證）。
  it('注入 CSS 的 upscale 規則同時含 width:100% 與 height:auto', () => {
    const { NS, articleEl, document } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    // 抓 upscale 規則 block（選擇器含 upscale-img attr、到下一個 } 為止）
    const m = css.match(/\[data-jread-upscale-img\][^{]*\{[^}]*\}/);
    assert.ok(m, '必須有 upscale-img CSS 規則');
    const block = m[0];
    assert.ok(/width:\s*100%\s*!important/.test(block),
      'upscale 規則必須保留 width:100%（撐滿欄寬）');
    assert.ok(/height:\s*auto\s*!important/.test(block),
      'upscale 規則必須含 height:auto——否則站點釘死的 height + aspect-ratio 會反推壓垮寬度（Atlantic hero 64×36 bug）');
  });

  it('upscale 規則選擇器把 [upscale-img] 寫兩次拉高 specificity（壓過站點同級 height 規則）', () => {
    const { NS, articleEl, document } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    // doubled attribute：選擇器內 [data-jread-upscale-img] 連續出現兩次
    assert.ok(
      /\[data-jread-upscale-img\]\[data-jread-upscale-img\]\s*\{/.test(css),
      'upscale 選擇器必須 doubled attr（(0,3,1) 壓過站點後注入的 (0,2,1) height 規則）；' +
      '降回單一 attr 會在 cascade tie 輸給站點 → Atlantic hero 退回 64×36');
  });
});
