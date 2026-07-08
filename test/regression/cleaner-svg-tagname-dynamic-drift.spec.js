// JRead — cleaner v1.6.24：SVG tagName 大小寫 + 動態/靜態 drift 補齊
//
// 三組修法（2026-07-08 全面 code review 產出，probe 於真實 Chromium 實證）：
//
// 1. SVG tagName 大小寫：SVG namespace 元素 tagName 保留小寫 'svg'（probe 實證
//    svg.tagName === 'svg'、大寫 Set.has('svg') === false），兩處死比對修正：
//    - collapseEmptyWrappersAfterClean 的 EMPTY_COLLAPSE_SKIP_TAGS.has(el.tagName)
//      永遠 miss → 獨立內容 SVG（不在 figure 內的圖表 / 插畫，無文字節點）被當
//      空殼 wrapper 藏掉
//    - collapseInnerGridFlex 後代 reset 的 tag === 'SVG' 永遠 false → 置中 svg
//      被套 width:100% 撐滿欄寬
//
// 2. 動態 heading 掃描 drift：靜態 hideInsideArticleByHeadingText 掃 h2-h6（v0.8.4
//    roomie H5 CTA）+ div/span/p/strong/em/b（v0.7.190 upmedia），動態
//    checkDynamicNoise 的 DYN_TITLE_TAG_SEL 舊版只有 h2-h4 + p/div/span——lazy
//    注入的 h5/h6 CTA 與 strong「（延伸閱讀）」完全接不到。
//
// 3. 動態 keyword-<a> 缺 isInPreserved：靜態 keyword path 有 preserved guard，
//    動態迴圈舊版沒有——figure 內 lazy 注入、class 帶 keyword 的 <a> 靜態保留、
//    動態被砍。
//
// 訊號層次：jsdom 驗「規則命中 / 豁免」的邏輯正確（rect 用 stub）；真實 layout
// 由 harness 驗。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
);

function setupDom(bodyHtml) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><main>${bodyHtml}</main></body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
  window.eval(SRC.namespace);
  window.eval(SRC.cleaner);
  return window;
}

function stubRect(el, w, h) {
  el.getBoundingClientRect = () => ({
    width: w, height: h, top: 100, bottom: 100 + h, left: 0, right: w, x: 0, y: 100
  });
}

describe('cleaner v1.6.24 — 獨立內容 SVG 不被空殼 collapse（大小寫修正）', () => {
  it('無文字、rect 400x200 的 standalone <svg> 不得被 hide', () => {
    const window = setupDom(`
      <article id="art"><h1>標題</h1>
      <p>這是第一段夠長的主文內容，包含逗號、句號等標點，足夠通過字數門檻與主文保護判定。</p>
      <svg id="chart" viewBox="0 0 400 200"><g><rect x="1" y="1" width="10" height="10"></rect></g></svg>
      <p>這是第二段主文內容，持續描述補充，維持足夠長度避免整個容器被當成空殼處理。</p>
      </article>`);
    const doc = window.document;
    const art = doc.getElementById('art');
    const svg = doc.getElementById('chart');
    // jsdom 無 layout：stub 尺寸讓它通過 EMPTY_COLLAPSE 的 8x80 門檻
    stubRect(svg, 400, 200);
    window.__JRead.cleaner.clean(art);
    assert.notStrictEqual(svg.getAttribute('data-jread-hidden'), '1',
      '獨立內容 SVG 被 collapseEmptyWrappersAfterClean 誤藏——EMPTY_COLLAPSE_SKIP_TAGS 大小寫比對退化');
    assert.ok(!/display:\s*none/.test(svg.getAttribute('style') || ''),
      'SVG 不得被 inline display:none');
  });

  it('collapseInnerGridFlex 後代 skip 名單必須以 toUpperCase 比對（含 SVG）', () => {
    const m = CLEANER_SRC.match(/掃 descendants[\s\S]{0,700}/);
    assert.ok(m, '抓不到 collapseInnerGridFlex 後代掃描段');
    assert.match(m[0], /tagName\.toUpperCase\(\)/,
      '後代 tag 判定必須 toUpperCase——svg 小寫 tagName 直比 "SVG" 永遠 false');
  });

  it('collapseEmptyBlockSpacers 的兩個 tag Set 比對也必須 toUpperCase', () => {
    const m = CLEANER_SRC.match(/function collapseEmptyBlockSpacers[\s\S]*?\n  \}/);
    assert.ok(m, '抓不到 collapseEmptyBlockSpacers');
    assert.match(m[0], /EMPTY_COLLAPSE_SKIP_TAGS\.has\(el\.tagName\.toUpperCase\(\)\)/);
    assert.match(m[0], /MEDIA_SELF_TAGS\.has\(el\.tagName\.toUpperCase\(\)\)/);
  });
});

describe('cleaner v1.6.24 — 動態 heading 掃描補齊 h5/h6 + strong/em/b', () => {
  it('lazy 注入的 <h5>延伸閱讀</h5> 必須被動態 path 清掉', async () => {
    const window = setupDom(`
      <article id="art"><h1>主標題</h1>
      <p>這是第一段夠長的主文內容，包含逗號、句號等標點，足夠通過字數門檻與主文保護判定不被誤砍。</p>
      <p>這是第二段主文內容，持續描述補充，維持足夠長度避免整個容器被當成空殼或雜訊處理。</p>
      </article>`);
    const doc = window.document;
    const art = doc.getElementById('art');
    window.__JRead.cleaner.clean(art);

    const heading = doc.createElement('h5');
    heading.textContent = '延伸閱讀';
    art.appendChild(heading);
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(heading.getAttribute('data-jread-hidden'), '1',
      '動態注入的 h5 雜訊 heading 沒被清——DYN_TITLE_TAG_SEL 與靜態側（h2-h6）drift');
  });

  it('DYN_TITLE_TAG_SEL 必須含 h5/h6/strong/em/b、isHeading 必須認 H2-H6', () => {
    const m = CLEANER_SRC.match(/DYN_TITLE_TAG_SEL = '([^']+)'/);
    assert.ok(m, '抓不到 DYN_TITLE_TAG_SEL');
    for (const tag of ['h5', 'h6', 'strong', 'em', 'b']) {
      assert.ok(m[1].split(/,\s*/).includes(tag), `DYN_TITLE_TAG_SEL 缺 ${tag}（與靜態側 drift）`);
    }
    const dynFn = CLEANER_SRC.match(/function\s+checkDynamicNoise[\s\S]*?\n  \}/)[0];
    assert.match(dynFn, /\^H\[23456\]\$/,
      '動態 isHeading 必須認 H2-H6（與靜態 isSemanticHeading 同款）');
    assert.match(dynFn, /closest\s*&&\s*h\.closest\('h2, h3, h4'\)/,
      'strong/em/b 在 h2-h4 內必須跳過（與靜態 filter 同款，防 direct text 繞過 max_len）');
  });
});

describe('cleaner v1.6.24 — 動態 keyword-<a> 補 isInPreserved', () => {
  it('figure 內 lazy 注入、class 帶 keyword 的 <a> 不得被動態 path 砍', async () => {
    const window = setupDom(`
      <article id="art"><h1>主標題</h1>
      <p>這是第一段夠長的主文內容，包含逗號、句號等標點，足夠通過字數門檻與主文保護判定不被誤砍。</p>
      <figure id="fig"><img src="https://x/a.jpg" width="600" height="400"><figcaption>圖說</figcaption></figure>
      <p>這是第二段主文內容，持續描述補充，維持足夠長度避免整個容器被當成空殼或雜訊處理。</p>
      </article>`);
    const doc = window.document;
    const art = doc.getElementById('art');
    window.__JRead.cleaner.clean(art);

    // lazy 注入 wrapper（含 keyword <a>）到 figure 內——靜態 keyword path 會因
    // isInPreserved 跳過，動態 path 也必須同源豁免
    const wrap = doc.createElement('div');
    const a = doc.createElement('a');
    a.className = 'share-buttons';
    a.href = 'https://example.com/source';
    a.textContent = '圖片出處連結';
    wrap.appendChild(a);
    doc.getElementById('fig').appendChild(wrap);
    await new Promise(r => setTimeout(r, 0));

    assert.notStrictEqual(a.getAttribute('data-jread-hidden'), '1',
      'figure（PRESERVE_SEL）內 lazy 注入的 keyword <a> 被動態 path 誤砍——缺 isInPreserved guard');
  });

  it('對照組：figure 外 lazy 注入的同款 keyword <a> 仍要被清（豁免不過寬）', async () => {
    const window = setupDom(`
      <article id="art"><h1>主標題</h1>
      <p>這是第一段夠長的主文內容，包含逗號、句號等標點，足夠通過字數門檻與主文保護判定不被誤砍。</p>
      <p>這是第二段主文內容，持續描述補充，維持足夠長度避免整個容器被當成空殼或雜訊處理。</p>
      </article>`);
    const doc = window.document;
    const art = doc.getElementById('art');
    window.__JRead.cleaner.clean(art);

    const wrap = doc.createElement('div');
    const a = doc.createElement('a');
    a.className = 'share-buttons';
    a.href = '#';
    a.textContent = '分享';
    wrap.appendChild(a);
    art.appendChild(wrap);
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(a.getAttribute('data-jread-hidden'), '1',
      'figure 外的動態 keyword <a> 必須照清——preserved 豁免不可外溢');
  });
});
