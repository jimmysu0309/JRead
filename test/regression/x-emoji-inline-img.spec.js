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

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const STYLER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'styler.js'), 'utf8');

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

  it('viewBox-only SVG emoji 釘上原站 rendered width/height（v0.8.98 防 width:auto 撐滿欄）', () => {
    // 根因（2026-06-17 Jimmy 截圖回報 itsmicracing.xyz WordPress 站）：wp-emoji 的
    // 國旗 SVG natural 回報 150×150 不可靠，通用 width:auto 規則對「無 intrinsic
    // size 的 SVG」解析成容器寬 → emoji 17px 撐成 603px 滿欄。inline-img CSS 規則
    // 只設 display:inline、未約束 width，救不了。修法：rect fallback 標 inline 時釘
    // 量到的 rendered px（分類在 ARTICLE_ATTR 前跑、rect 仍是原站 1em ≈ 20px）。
    const { NS, articleEl, emojiSvg } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(emojiSvg.style.getPropertyValue('width'), '20px',
      'viewBox-only SVG emoji 必須釘 rendered width，否則 width:auto 把它撐成容器寬');
    assert.strictEqual(emojiSvg.style.getPropertyValue('height'), '20px',
      'viewBox-only SVG emoji 必須釘 rendered height');
    assert.strictEqual(emojiSvg.style.getPropertyPriority('width'), 'important',
      '釘寬須 !important 才壓得過通用圖片規則的 width:auto !important');
  });

  it('natural 可靠的小圖 emoji（natural <= INLINE_IMG_MAX）不釘 width（width:auto 已正確退回 natural）', () => {
    // 反向 forcing：natural ≈ rendered 的真實小圖不命中 rect fallback、不該被釘。
    const { NS, articleEl, document } = setup();
    const tiny = document.createElement('img');
    tiny.id = 'tiny-png-emoji';
    stubNatural(tiny, 24, 24); // natural 24 <= INLINE_IMG_MAX(48) → natural 路徑判 inline
    stubRect(tiny, { top: 100, left: 700, width: 24, height: 24 });
    articleEl.appendChild(tiny);
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(tiny.getAttribute('data-jread-inline-img'), '1',
      'natural 24×24 仍應標 inline');
    assert.strictEqual(tiny.style.getPropertyValue('width'), '',
      'natural 可靠的小圖不需釘 width（width:auto 已正確）');
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

  it('inline-img 標記必須在 setAttribute(ARTICLE_ATTR) 之前（v0.8.10 翻頁模式 chicken-egg）', () => {
    // Jimmy 2026-06-09 翻頁模式 X Twemoji 實機回報：emoji 被撐成滿欄。根因是
    // 順序——ARTICLE_ATTR 一設定，翻頁模式 reader 規則（img { width:auto !important }）
    // 立即生效，把 viewBox-only SVG emoji 撐成 608px → rect fallback 量到 608 >
    // INLINE_IMG_MAX → 永遠標不到 inline。標記必須在 ARTICLE_ATTR **前**跑，量到
    // 原站 inline 尺寸才標得對。jsdom 無 CSS cascade、stubRect 固定值，重現不了
    // 此時序 bug——故以 source 順序為 forcing function。
    const tagIdx = STYLER_SRC.indexOf("setAttribute(INLINE_IMG_ATTR, '1')");
    const artIdx = STYLER_SRC.indexOf("setAttribute(ARTICLE_ATTR, '1')");
    assert.ok(tagIdx >= 0, 'styler.js 必須有 setAttribute(INLINE_IMG_ATTR) 標記');
    assert.ok(artIdx >= 0, 'styler.js 必須有 setAttribute(ARTICLE_ATTR, "1")');
    assert.ok(tagIdx < artIdx,
      'inline-img 標記必須在 setAttribute(ARTICLE_ATTR) 之前——forcing：順序反了則 reader 規則先生效、emoji rect 被撐大、標不到 inline（翻頁模式滿版 emoji）');
  });

  it('restore() 移除 emoji 的 data-jread-inline-img（可逆性）', () => {
    const { NS, articleEl, emojiSvg, emojiPng } = setup();
    const snapshot = NS.styler.apply(articleEl, SETTINGS);
    NS.styler.restore(articleEl, snapshot);
    assert.strictEqual(emojiSvg.getAttribute('data-jread-inline-img'), null);
    assert.strictEqual(emojiPng.getAttribute('data-jread-inline-img'), null);
    // v0.8.98：釘的 width/height 也要還原（原站無 inline style → 清空）
    assert.strictEqual(emojiSvg.style.getPropertyValue('width'), '',
      'restore 必須移除釘上的 inline width');
    assert.strictEqual(emojiSvg.style.getPropertyValue('height'), '',
      'restore 必須移除釘上的 inline height');
  });
});
