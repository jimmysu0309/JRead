// JRead — absolute/fixed 錨定元素豁免全域 left/right:auto inset 清除（v1.7.45）
//
// Bug：washingtonpost.com 文章進閱讀模式後「發稿日期」整個消失（Jimmy 2026-08-05
// 回報）。cage 實機 probe 釘出機制：WaPo 日期輪播結構 = 裁切窗（relative +
// overflow:hidden、高一行）內兩個日期 span 疊放——長版 in-flow span 被站方
// transform: translateY(-110%) 移出窗外、短版 span position:absolute + left:0
// 錨在窗左上（唯一可見）。v0.7.48 的全域 `left/right: auto !important`（原為清
// 商周 .Single-image 類 position:relative + left:-90px 視覺擴張 hack）把 absolute
// span 的 left 錨點拔掉 → span 跳回 static position（nowrap 下排在長版 span 右側、
// 超出窗寬被 overflow:hidden 水平裁掉）→ 兩個 span 都不可見 = 日期空白。
//
// 通則修法（結構訊號、非站點特判）：v0.7.48 的設計前提「清了 offset 等於 static
// 視覺」只對 position:relative 成立；absolute/fixed 元素的 left/right 是錨點、
// 語意完全不同。apply() 期 markAbsAnchors 掃 computed position 為 absolute/fixed
// 的元素標 [data-jread-abs-anchor]，inset 清除規則拆出獨立條並加 :not() 豁免。
// 在 ARTICLE_ATTR 設定後量（與 FILL_IFRAME 同精神）：已被媒體類規則打回 static
// 的子樹量到 static、不標、照舊清，只豁免「reader CSS 未動其定位」的真錨定元素。
//
// 註：jsdom 不算 layout（span 是否被裁窗裁掉量不到），本 spec 驗「標記行為 +
// CSS 注入結構 + 可逆性」三層；真實視覺（日期重新顯示）由 cage 於 WaPo 實機驗證
// （2026-08-05 模擬修法截圖已實證）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'timestamp-rotator-abs-anchor.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  const snapshot = env.NS.styler.apply(detected.el, DEFAULT_SETTINGS);
  return { env, document: env.document, NS: env.NS, articleEl: detected.el, snapshot };
}

describe('styler — absolute 錨定豁免 inset 清除（v1.7.45 WaPo 日期消失）', () => {
  it('apply() 對 computed absolute 元素標 data-jread-abs-anchor="1"', () => {
    const { document } = setup();
    const shortSpan = document.querySelector('.stamp-short');
    assert.ok(shortSpan, 'fixture 應有 absolute 短日期 span');
    assert.strictEqual(shortSpan.getAttribute('data-jread-abs-anchor'), '1',
      'absolute（left:0 錨定）span 必須被標 abs-anchor 豁免');
  });

  it('relative 裁切窗與一般段落不被標（豁免只給 absolute/fixed）', () => {
    const { document } = setup();
    const win = document.querySelector('.stamp-window');
    assert.strictEqual(win.getAttribute('data-jread-abs-anchor'), null,
      'position:relative 裁切窗不可被標——relative offset hack（v0.7.48 商周場景）必須照舊被清');
    const p = document.querySelector('article p');
    assert.strictEqual(p.getAttribute('data-jread-abs-anchor'), null,
      'static 段落不可被標');
  });

  it('注入 CSS：inset 清除規則帶 :not([data-jread-abs-anchor="1"])、border 規則不夾帶 left/right', () => {
    const { document } = setup();
    // 先剝 CSS 註解——rule 區塊 regex 的 selector 段會把前一條規則後的註解吃進來
    const css = document.getElementById('__jread-style').textContent.replace(/\/\*[\s\S]*?\*\//g, '');
    // 抓所有 rule 區塊
    const blocks = [];
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css)) !== null) blocks.push({ sel: m[1].trim(), body: m[2] });
    // (1) 全域 inset 清除規則：`*:not(...)` 萬用 + left/right auto + abs-anchor 豁免
    // body 排除 position:static——媒體 static-flow 配套規則也含 left/right:auto,
    // 但那組成套打回 static、語意不同;本規則特徵是「只清 left/right」
    const insetRule = blocks.find((b) =>
      /\[data-jread-active="1"\]\s+\*:not\(/.test(b.sel) &&
      /left\s*:\s*auto\s*!important/.test(b.body) &&
      /right\s*:\s*auto\s*!important/.test(b.body) &&
      !/position\s*:/.test(b.body));
    assert.ok(insetRule, '必須有萬用 inset 清除規則（v0.7.48 商周場景不回歸）');
    assert.ok(insetRule.sel.includes(':not([data-jread-abs-anchor="1"])'),
      'inset 清除規則 selector 必須含 :not([data-jread-abs-anchor="1"]) 豁免');
    // (2) border-width 規則不可夾帶 left/right（回歸 = 豁免失效）
    const borderRule = blocks.find((b) =>
      /\[data-jread-active="1"\]\s+\*:not\(/.test(b.sel) &&
      /border-width\s*:\s*0\s*!important/.test(b.body));
    assert.ok(borderRule, 'border-width 清除規則必須存在');
    assert.ok(!/left\s*:\s*auto/.test(borderRule.body),
      'border-width 規則不可夾帶 left: auto（必須走帶豁免的獨立規則）');
  });

  it('restore() 移除 abs-anchor 標記（可逆性）', () => {
    const { document, NS, articleEl, snapshot } = setup();
    NS.styler.restore(articleEl, snapshot);
    assert.strictEqual(document.querySelectorAll('[data-jread-abs-anchor]').length, 0,
      'restore 後不得殘留 abs-anchor 標記');
  });

  it('remarkDynamicMarkers 對晚 mount 的 absolute 元素補標', () => {
    const { document, NS, articleEl } = setup();
    const late = document.createElement('div');
    late.setAttribute('style', 'position: absolute; left: 0; top: 0;');
    late.textContent = 'late mounted overlay';
    articleEl.appendChild(late);
    NS.styler.remarkDynamicMarkers(late);
    assert.strictEqual(late.getAttribute('data-jread-abs-anchor'), '1',
      '晚 mount absolute 元素必須被動態補標');
  });
});
