// JRead — regression spec: shadow-host web component 不被 empty-wrapper collapse（v0.8.79）
// -----------------------------------------------------------------------------
// Trigger: Page Rounds 2026-06-15 — MDN 程式碼塊 <mdn-code-example> 連在「保留下來的」
// Examples section 內也消失。probe 確認 collapseEmptyWrappersAfterClean 把它當空殼
// collapse：light DOM 的 textContent / querySelector('img') 看不到 shadow DOM 內的
// <pre>，rect 又有高度 → 三條 collapse 條件全中。
//
// 修法（v0.8.79）：collapseEmptyWrappersAfterClean / collapseEmptyBlockSpacers 在
// rect 判定前 `if (el.shadowRoot) continue;`——元素 host 了 shadow root = 渲染內容
// 在 shadow DOM 內、非空殼。結構通則，任何 shadow-DOM web component 適用。
//
// 隔離設計：<mdn-code-example> 不在 CONTAINER_SEL（div/section/aside/...），故
// spacer / sidebar / keyword rule 不處理它；只有 collapse（遍歷全元素）會 hit ——
// 本 spec 純驗 collapse 的 shadowRoot skip。
// forcing：拿掉 `if (el.shadowRoot) continue;` → #code-host 被 collapse hide（實證）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE = path.join(__dirname, 'fixtures', 'shadow-host-empty-collapse.html');

describe('cleaner — shadow-host web component 不被 empty collapse（v0.8.79）', () => {
  let document, codeHost;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true,
      url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/at'
    });
    document = env.document;
    codeHost = document.getElementById('code-host');
    // shadow DOM 內放 <pre>（light DOM 維持空——這正是誤判成空殼的成因）
    codeHost.attachShadow({ mode: 'open' }).innerHTML = '<pre>const x = arr.at(-1);</pre>';
    // jsdom rect 全 0；stub 成「有高度的空殼形狀」才會落入 collapse 條件
    stubRect(codeHost, { top: 300, left: 0, width: 600, height: 160 });
    env.window.__JRead.cleaner.clean(document.getElementById('story'));
  });

  it('forcing: <mdn-code-example> 確實 host shadow root 且 light DOM 文字為空', () => {
    assert.ok(codeHost.shadowRoot, 'fixture forcing: code-host 須 host shadow root');
    assert.strictEqual((codeHost.textContent || '').trim(), '',
      'fixture forcing: light DOM textContent 須為空（否則非 empty-collapse 場景）');
  });

  it('shadow-host 程式碼元件不被 collapse hide', () => {
    assert.notStrictEqual(codeHost.dataset.jreadHidden, '1',
      'host 了 shadow root 的程式碼元件其內容在 shadow DOM、非空殼，不可被 empty-wrapper collapse；' +
      '拿掉 collapseEmptyWrappersAfterClean 的 `if (el.shadowRoot) continue;` → 此 assertion fail');
    assert.ok(!codeHost.closest('[data-jread-hidden="1"]'), 'code-host 不可在 hidden 子樹內');
  });

  it('主文段落保留（sanity：clean 正常運作、非整篇沒清）', () => {
    assert.notStrictEqual(document.getElementById('prose').dataset.jreadHidden, '1');
    assert.notStrictEqual(document.getElementById('prose2').dataset.jreadHidden, '1');
  });
});
