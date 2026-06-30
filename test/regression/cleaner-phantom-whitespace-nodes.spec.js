// JRead — cleaner 清除「不可 collapse 空白」游離文字節點（v1.5.24）
//
// Bug（Jimmy 2026-06-30 upmedia.mg 回報「(中科院官網) 底下出現一段空白」）：
// WYSIWYG / CMS 在 block 容器內留下純空白文字節點，內含 nbsp(U+00A0) 等「不會被
// HTML 空白 collapse 規則消除」的字元。upmedia 圖說後、章節 h2 前各有一個
// nbsp+換行游離節點 → 渲染成幽靈空行 box，且阻止 h2 的 margin-top 與容器
// collapse，撐出約 40px 多餘垂直空白。
//
// 修法：clean() 末段 stripPhantomWhitespaceTextNodes 清空這類節點（snapshot 可逆）。
// 通則（非站點特判）：節點「只有空白、且含至少一個不可 collapse 空白字元」+
// 父為 block 級 + 非「兩側都是 inline 可見內容」的字間間隔 → 清空。純一般空白
// （space/tab/newline）節點不動（本就 collapse），figure/figcaption/blockquote/
// pre/code 內保留。
//
// jsdom 限制：無 layout（rect 全 0），但本 pass 不依賴 rect、純走 DOM 結構 +
// getComputedStyle(display)，可在 jsdom end-to-end 經 clean()/restore() 驗證。

const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

const NBSP = String.fromCharCode(0xA0);
const hasNbsp = (s) => s.indexOf(NBSP) >= 0;

function buildEnv(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'chrome-extension://t/' + p } };
  window.eval(SRC.namespace);
  window.eval(SRC.cleaner);
  return { window, document: window.document, NS: window.__JRead };
}

// 取某容器內第一個文字節點
function firstText(el) {
  for (const n of el.childNodes) if (n.nodeType === 3) return n;
  return null;
}

describe('cleaner — 清除不可 collapse 空白游離文字節點（v1.5.24 upmedia 段距空白）', () => {
  it('block 容器內「nbsp + 換行」純空白游離節點 → clean() 清空、restore() 還原', () => {
    const { document, NS } = buildEnv(`<!DOCTYPE html><html><body>
      <article id="art"><div id="box">${NBSP}\n<p id="p1">段落一</p></div></article>
    </body></html>`);
    const box = document.getElementById('box');
    const phantom = firstText(box);
    assert.ok(phantom && hasNbsp(phantom.textContent), 'fixture：box 開頭應有 nbsp 游離節點');

    const hidden = NS.cleaner.clean(document.getElementById('art'));
    assert.strictEqual(phantom.textContent, '', 'clean() 必須清空 nbsp 游離節點');

    NS.cleaner.restore(hidden);
    assert.ok(hasNbsp(phantom.textContent), 'restore() 必須還原原始 nbsp 內容（可逆性）');
  });

  it('純一般空白（space/newline，無 nbsp）游離節點不動（本就 collapse、避免 churn）', () => {
    const { document, NS } = buildEnv(`<!DOCTYPE html><html><body>
      <article id="art"><div id="box">  \n  <p id="p1">段落一</p></div></article>
    </body></html>`);
    const box = document.getElementById('box');
    const ws = firstText(box);
    const orig = ws.textContent;
    NS.cleaner.clean(document.getElementById('art'));
    assert.strictEqual(ws.textContent, orig, '純一般空白節點不得被清空');
  });

  it('字間間隔守則：兩側都是 inline 可見內容的 nbsp 保留（不破壞字間間隔）', () => {
    const { document, NS } = buildEnv(`<!DOCTYPE html><html><body>
      <article id="art"><div id="box"><span id="s1" style="display:inline">甲</span>${NBSP}<span id="s2" style="display:inline">乙</span></div></article>
    </body></html>`);
    const box = document.getElementById('box');
    let between = null;
    for (const n of box.childNodes) if (n.nodeType === 3 && hasNbsp(n.textContent)) between = n;
    assert.ok(between, 'fixture：兩 span 之間應有 nbsp 節點');
    NS.cleaner.clean(document.getElementById('art'));
    assert.ok(hasNbsp(between.textContent), '兩側 inline 內容夾住的 nbsp 必須保留');
  });

  it('figure 內 nbsp 游離節點保留（語意空白可能有意義）', () => {
    const { document, NS } = buildEnv(`<!DOCTYPE html><html><body>
      <article id="art"><figure id="fig"><img src="x.jpg">${NBSP}\n<figcaption>圖說</figcaption></figure></article>
    </body></html>`);
    const fig = document.getElementById('fig');
    const phantom = firstText(fig);
    assert.ok(phantom && hasNbsp(phantom.textContent), 'fixture：figure 內應有 nbsp 節點');
    NS.cleaner.clean(document.getElementById('art'));
    assert.ok(hasNbsp(phantom.textContent), 'figure 內 nbsp 節點必須保留（PRESERVE_SEL 豁免）');
  });
});
