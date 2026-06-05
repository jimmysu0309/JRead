// JRead — X / Twitter emoji inline-img 標記 regression spec（v0.7.214）
//
// 根因（2026-06-05 Jimmy 截圖回報 x.com status 頁 emoji 位置不對）：
// X 的 Twemoji 是「無 intrinsic size 的 SVG」（只有 viewBox），Chrome 對這種
// SVG 的 naturalWidth/naturalHeight 回報 CSS replaced element 預設 150×150。
// styler 的 inline-img 判定只看 natural <= INLINE_IMG_MAX(48) → miss →
// 沒標 data-jread-inline-img → 通用圖片規則 forced block + margin auto，
// emoji 變成獨立置中區塊（脫離文字行）。
//
// 修法（結構性通則）：natural 判定 miss 時 fallback 量 getBoundingClientRect，
// rendered 兩維皆 > 0 且 <= INLINE_IMG_MAX 即視為 inline icon/emoji——
// rendered 尺寸才是「這張圖在文中是 icon」的視覺事實，與 src/站點無關。
//
// 本 spec 驗的訊號層：apply() 後 img 的 data-jread-inline-img 標記正確性 +
// restore() 可逆性。不驗實際視覺 layout（jsdom 不算 layout；視覺由
// Playwright harness 驗）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'x-emoji-inline-img.html');

const SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

// jsdom 的 naturalWidth/naturalHeight 永遠回 0，用 defineProperty 模擬
// Chrome 對各類圖片的回報值。
function stubNatural(img, w, h) {
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
}

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['styler']
  });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 應有 <article>');

  // Twemoji SVG：natural 是 Chrome 預設 150×150（不可靠）、rendered 20×20
  const emojiSvg = env.document.getElementById('emoji-svg');
  stubNatural(emojiSvg, 150, 150);
  stubRect(emojiSvg, { top: 100, left: 50, width: 20, height: 20 });

  // Twemoji PNG 高解析原檔：natural 72×72（> 48）、rendered 20×20
  const emojiPng = env.document.getElementById('emoji-png');
  stubNatural(emojiPng, 72, 72);
  stubRect(emojiPng, { top: 100, left: 500, width: 20, height: 20 });

  // 內容照片：natural 與 rendered 都大，不可被標 inline
  const photo = env.document.getElementById('content-photo');
  stubNatural(photo, 800, 600);
  stubRect(photo, { top: 300, left: 0, width: 576, height: 432 });

  return { ...env, articleEl, emojiSvg, emojiPng, photo };
}

describe('x-emoji-inline-img — natural 尺寸不可靠時以 rendered 尺寸標 inline', () => {
  it('無 intrinsic size 的 SVG emoji（natural 150×150、rendered 20×20）標上 data-jread-inline-img', () => {
    const { NS, articleEl, emojiSvg } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(emojiSvg.getAttribute('data-jread-inline-img'), '1',
      'Twemoji SVG 必須被標 inline-img（否則 forced block 置中、脫離文字行）');
  });

  it('高解析 emoji PNG（natural 72×72、rendered 20×20）也標上 data-jread-inline-img', () => {
    const { NS, articleEl, emojiPng } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(emojiPng.getAttribute('data-jread-inline-img'), '1',
      '72×72 高解析 emoji PNG 必須被標 inline-img');
  });

  it('內容照片（natural / rendered 都大）不可被標 inline-img', () => {
    const { NS, articleEl, photo } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(photo.getAttribute('data-jread-inline-img'), null,
      '正常內容圖不可誤標 inline（會失去置中與 figure 排版）');
  });

  it('rect 為 0（隱藏 / 未 layout）且 natural 超標的圖不標 inline-img', () => {
    const { NS, articleEl, document } = setup();
    // 新增一張 natural 150×150 但 rect 全 0 的圖（jsdom 預設 rect 即全 0）
    const hidden = document.createElement('img');
    hidden.id = 'hidden-img';
    Object.defineProperty(hidden, 'naturalWidth', { value: 150, configurable: true });
    Object.defineProperty(hidden, 'naturalHeight', { value: 150, configurable: true });
    articleEl.appendChild(hidden);
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(hidden.getAttribute('data-jread-inline-img'), null,
      'rect 0 不可觸發 rendered fallback（w > 0 guard）');
  });

  it('restore() 移除 emoji 的 data-jread-inline-img（可逆性）', () => {
    const { NS, articleEl, emojiSvg, emojiPng } = setup();
    const snapshot = NS.styler.apply(articleEl, SETTINGS);
    NS.styler.restore(articleEl, snapshot);
    assert.strictEqual(emojiSvg.getAttribute('data-jread-inline-img'), null);
    assert.strictEqual(emojiPng.getAttribute('data-jread-inline-img'), null);
  });
});
