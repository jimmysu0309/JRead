// JRead — cleaner 統一 style-reset restore（v0.8.18 C3）
//
// 對應 code review C3：原本 10 條「快照 inline style → 套 !important override」的
// reset 規則各存自己的 sidecar（hidden.__negativeZIndexResets / __collapsed /
// __innerGridFlex(+Desc) / __cappedWrapperSpacing / ...）+ 各自一個 restoreXxx，
// 新增規則要對稱維護三處（producer 存 sidecar + 寫 restoreXxx + restore() 呼叫），
// 漏一處退出 reader mode 就殘留 inline 樣式。
//
// 修法：統一成單一 hidden.__styleResets + restoreAllStyleResets 一個 loop。
//
// 本 spec 驗：
//   1. clean() 對 negative z-index 後代套 override + 接入 hidden.__styleResets
//   2. 不再產生 legacy sidecar（__negativeZIndexResets 等）
//   3. restore() 透過統一 loop 還原原始 inline 值（round-trip）

const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

function buildEnv(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'chrome-extension://t/' + p } };
  window.eval(SRC.namespace);
  window.eval(SRC.cleaner);
  return { window, document: window.document, NS: window.__JRead };
}

describe('cleaner — 統一 style-reset restore（C3）', () => {
  it('clean() 把 negative z-index reset 接入 hidden.__styleResets，restore() round-trip 還原', () => {
    const { document, NS } = buildEnv(`<!DOCTYPE html><html><body>
      <article id="art">
        <h1>標題</h1>
        <div id="hero" style="position:relative; z-index:-1">hero 區塊</div>
        <p>這是一段夠長的主文內容，用來讓 reader 卡片有實際內容可呈現，避免被視為空容器。</p>
      </article></body></html>`);
    const art = document.getElementById('art');
    const hero = document.getElementById('hero');

    // 進場前：hero z-index = -1（inline）
    assert.strictEqual(document.defaultView.getComputedStyle(hero).zIndex, '-1');

    const hidden = NS.cleaner.clean(art);

    // 1. override 已套（z-index auto !important）
    assert.strictEqual(hero.style.getPropertyValue('z-index'), 'auto');
    assert.strictEqual(hero.style.getPropertyPriority('z-index'), 'important');

    // 2. 接入統一陣列、無 legacy sidecar
    assert.ok(Array.isArray(hidden.__styleResets), 'clean() 必須產生統一 hidden.__styleResets');
    assert.ok(hidden.__styleResets.some(it => it.el === hero), 'hero 的 reset 必須在 __styleResets 內');
    assert.strictEqual(hidden.__negativeZIndexResets, undefined, '不可再產生 legacy __negativeZIndexResets sidecar');
    assert.strictEqual(hidden.__collapsed, undefined, '不可再產生 legacy __collapsed sidecar');
    assert.strictEqual(hidden.__cappedWrapperSpacing, undefined, '不可再產生 legacy __cappedWrapperSpacing sidecar');

    // 3. restore round-trip：還原原始 inline z-index = -1（無 important）
    NS.cleaner.restore(hidden);
    assert.strictEqual(hero.style.getPropertyValue('z-index'), '-1', 'restore 後 z-index 應還原為原始 -1');
    assert.strictEqual(hero.style.getPropertyPriority('z-index'), '', 'restore 後不應殘留 important priority');
  });
});
