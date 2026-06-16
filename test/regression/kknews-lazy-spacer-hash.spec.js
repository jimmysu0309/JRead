// JRead — kknews.cc 圖片全部消失 regression spec（v0.8.89）
// -----------------------------------------------------------------------------
// Jimmy 2026-06-16 回報 kknews.cc 文章進閱讀模式後圖片全部消失。
//
// 兩層根因（probe 實證，見 fixture 註解）：
//   1) cleaner hydration miss：lazy placeholder 是「帶 hash 後綴的 spacer gif」
//      （//a.kknews.cc/blank-ad4b0f60.gif），舊 SPACER_SRC_RE 要求 spacer token
//      緊接 .gif，被中間 -ad4b0f60 擋掉 → 真圖（data-src）永遠補不上。
//   2) styler 誤分類 + 凍結 width：apply() 當下 lazy 圖 naturalWidth=1（blank
//      gif），被當 inline emoji 誤標；站點凍 width:1px、原 media 規則只設
//      max-width:100% 蓋不掉 → 內容圖縮成 1×1。
//
// 本 spec 驗的訊號層：cleaner src hydration 結果 + styler inline 分類正確性 +
// media 規則 CSS 含 width:auto。不驗實際視覺尺寸（jsdom 不算 layout；視覺由
// Playwright harness 驗——已用 tools/probe-kknews-img.js 確認 1×1 → 640×640）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'kknews-lazy-spacer-hash.html');
const SETTINGS = {
  theme: 'light', fontSize: 18, contentWidth: 720,
  fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0
};

function stubNatural(img, w, h) {
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
}

describe('kknews 圖片全部消失 — hash 後綴 spacer hydration（v0.8.89）', () => {
  let document, articleEl;
  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.getElementById('post');
    articleEl.setAttribute('data-jread-active', '1');
    env.NS.cleaner.clean(articleEl, []);
  });

  it('hash 後綴 spacer（blank-ad4b0f60.gif）+ data-src 必須被 hydrate 成真圖', () => {
    const img = document.getElementById('lazy-hash-spacer');
    assert.strictEqual(img.getAttribute('src'),
      'https://i1.kknews.cc/Wlh50bt3r3mm0pb9Z8Frx7YqmpT69wkvfA/0.jpg',
      'src 必須換成 data-src 真圖（forcing：spacer token 後帶 hash 後綴也要認得）');
  });

  it('同結構第二張圖也必須 hydrate（通則、非單張特判）', () => {
    const img = document.getElementById('lazy-hash-spacer-2');
    assert.strictEqual(img.getAttribute('src'),
      'https://i2.kknews.cc/Eu6xGVJwSs2IRW5EqblJ_p46U_qkbolxVA/0.jpg');
  });
});

describe('kknews 圖片全部消失 — styler 不誤分類 1×1 lazy 圖 + width:auto（v0.8.89）', () => {
  function setup() {
    const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
    const articleEl = env.document.getElementById('post');
    articleEl.setAttribute('data-jread-active', '1');
    // 模擬 apply() 當下 lazy 圖尚未 hydrate：naturalWidth=1（blank gif）。
    // 站點 padding-bottom sizer 預留了 reserved 尺寸 → rect 非 0（用 width 屬性
    // 充當；jsdom 無 layout，img.width 反映 width 屬性 640）。
    return { ...env, articleEl };
  }

  it('natural 1×1（blank gif placeholder）+ 已 reserved 尺寸的內容圖不可被誤標 inline-img', () => {
    const { NS, articleEl, document } = setup();
    const img = document.getElementById('lazy-hash-spacer');
    stubNatural(img, 1, 1); // blank gif placeholder
    // 站點 padding-bottom sizer 已預留 reserved 尺寸 → rect 非 0（真實 kknews
    // 路徑：classifyImg 走 rect fallback 判定。rect 0×0 走 deferred load 路徑、
    // 是另一層；此 case 鎖定 classifyImg 的 natPlaceholder guard）。
    stubRect(img, { top: 200, left: 0, width: 640, height: 640 });
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(img.getAttribute('data-jread-inline-img'), null,
      'natural 1×1 是 lazy placeholder 簽名、不可當 inline emoji（rect 640 → 內容圖）；' +
      'forcing：誤標 inline → 載入後維持 inline 不被 media block 規則撐開（全圖 1×1 消失）');
  });

  it('media 規則必須含 width: auto（蓋掉站點凍結的 width:1px）', () => {
    const { NS, articleEl, document } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    // 先剝掉 CSS 註解——buildCss 把 /* ... */ 當字面文字注入，註解內也有
    // 「width: auto !important」字樣，不剝會讓「規則被註解掉」的破壞通過檢查。
    const css = document.getElementById('__jread-style').textContent.replace(/\/\*[\s\S]*?\*\//g, '');
    const m = css.match(/img:not\(a > img\),[^{]*video,[^{]*picture\s*\{([^}]*)\}/);
    assert.ok(m, 'CSS 必須含 img:not(a > img) / video / picture media 規則');
    assert.ok(/width\s*:\s*auto\s*!important/.test(m[1]),
      'media 規則必須含 width: auto !important（forcing：只設 max-width:100% 蓋不掉站點 width:1px → 圖 1×1）');
  });
});
