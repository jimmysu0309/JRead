// JRead — ESC 鍵退出閱讀模式 regression（v0.7.101）
// 對應功能：reader mode 啟動期間按下 ESC 鍵 → 退出閱讀模式
//
// main.js 包在 IIFE 且依賴 chrome.runtime API（無法直接 require），這裡採
// 雙層測試策略：
//   (1) Source-level forcing function：grep main.js 確認 onEscKey listener
//       的關鍵邏輯（key 判斷、修飾鍵排除、focus 元素白名單、install/uninstall
//       時機）都存在。任一檢查失敗 → 修法被誤刪 / 退化。
//   (2) Behavior-level 重現：把 onEscKey 邏輯抽出重寫一份等價函式，jsdom
//       模擬 keydown event + focus 元素，驗演算法效果（ESC + 無 focus 觸發
//       exit / 有 input focus 不觸發 / 修飾鍵不觸發）。
// 兩層互補：(1) 抓「實作存在 + 用對 API」、(2) 抓「演算法效果正確」。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const MAIN_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8'
);

describe('main.js — ESC 退出閱讀模式 source-level forcing', () => {
  it('main.js 必須含 onEscKey 函式（v0.7.101 ESC 退出快速鍵核心）', () => {
    assert.match(MAIN_SRC, /function\s+onEscKey\s*\(/,
      'main.js 必須定義 onEscKey 函式——forcing：函式被誤刪 / 改名 → spec fail');
  });

  it('onEscKey 必須檢查 e.key === "Escape" 或 e.code === "Escape"', () => {
    assert.ok(
      /e\.key\s*!==\s*['"]Escape['"]/.test(MAIN_SRC) ||
      /e\.code\s*!==\s*['"]Escape['"]/.test(MAIN_SRC),
      'onEscKey 必須檢查 ESC 鍵；forcing：拿掉判斷 → 任意 key 都會觸發退出');
  });

  it('onEscKey 必須排除 alt/ctrl/meta/shift 修飾鍵（避免誤觸 Cmd+Esc 等系統快速鍵）', () => {
    assert.match(MAIN_SRC, /e\.altKey/);
    assert.match(MAIN_SRC, /e\.ctrlKey/);
    assert.match(MAIN_SRC, /e\.metaKey/);
    assert.match(MAIN_SRC, /e\.shiftKey/);
  });

  it('onEscKey 必須排除 INPUT / TEXTAREA / SELECT focus（使用者輸入時 ESC 是取消輸入）', () => {
    assert.match(MAIN_SRC, /['"]INPUT['"]/);
    assert.match(MAIN_SRC, /['"]TEXTAREA['"]/);
    assert.match(MAIN_SRC, /['"]SELECT['"]/);
  });

  it('onEscKey 必須排除 contenteditable focus（Notion / Google Docs 類編輯場景）', () => {
    assert.ok(
      /isContentEditable/.test(MAIN_SRC) || /contenteditable/.test(MAIN_SRC),
      'onEscKey 必須檢查 contenteditable，避免在 WYSIWYG 編輯區誤觸退出');
  });

  it('onEscKey 必須 preventDefault + stopPropagation + 呼叫 exitReaderMode', () => {
    // 抓 onEscKey 函式起始位置以後的 src，驗關鍵呼叫存在於後段（避免 nested
    // brace 影響 body 切割）。配合上面「onEscKey 函式存在」forcing 已限定範圍。
    const startIdx = MAIN_SRC.search(/function\s+onEscKey\s*\(/);
    assert.ok(startIdx >= 0, '能找到 onEscKey 函式起始');
    // 抓接下來 1500 chars 範圍當函式 body 上限驗（main.js onEscKey 約 600 chars）
    const region = MAIN_SRC.slice(startIdx, startIdx + 1500);
    assert.match(region, /preventDefault\(\)/, 'onEscKey 必呼叫 preventDefault');
    assert.match(region, /stopPropagation\(\)/, 'onEscKey 必呼叫 stopPropagation');
    assert.match(region, /exitReaderMode\(\)/, 'onEscKey 必呼叫 exitReaderMode');
  });

  it('enterReaderMode 成功後必須 install onEscKey listener（capture phase: true）', () => {
    // capture phase 才能比原站 bubble listener 先收到
    assert.match(MAIN_SRC, /addEventListener\(\s*['"]keydown['"]\s*,\s*onEscKey\s*,\s*true\s*\)/,
      'enterReaderMode 必須以 capture phase（第三引數 true）addEventListener keydown onEscKey；forcing：bubble phase 會被原站 stopPropagation 截掉');
  });

  it('exitReaderMode 必須 remove onEscKey listener（避免關閉後仍攔 ESC）', () => {
    assert.match(MAIN_SRC, /removeEventListener\(\s*['"]keydown['"]\s*,\s*onEscKey\s*,\s*true\s*\)/,
      'exitReaderMode 必須 removeEventListener；forcing：listener 殘留 → reader mode 關閉後 ESC 仍被攔');
  });
});

// Behavior-level 重現：複製 onEscKey 邏輯，jsdom 模擬 keydown 驗演算法效果。
function makeEscHandler(exitFn) {
  return function onEscKey(e) {
    if (e.key !== 'Escape' && e.code !== 'Escape') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const ae = e.target && e.target.ownerDocument && e.target.ownerDocument.activeElement;
    if (ae) {
      const tag = ae.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (ae.isContentEditable) return;
      const ce = ae.getAttribute && ae.getAttribute('contenteditable');
      if (ce === 'true' || ce === '') return;
    }
    e.preventDefault();
    e.stopPropagation();
    exitFn();
  };
}

describe('main.js — ESC 退出 behavior-level（jsdom 模擬 keydown）', () => {
  let dom, document, window, exitCalled, handler;

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body><input id="search" /><div id="ce" contenteditable="true"></div><button id="b">B</button></body></html>');
    document = dom.window.document;
    window = dom.window;
    exitCalled = 0;
    handler = makeEscHandler(() => exitCalled++);
  });

  function fire(opts) {
    const evt = new window.KeyboardEvent('keydown', Object.assign({
      key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
    }, opts));
    Object.defineProperty(evt, 'target', { value: opts.target || document.body });
    handler(evt);
    return evt;
  }

  it('ESC 無 focus + 無修飾鍵 → 觸發 exitReaderMode', () => {
    document.body.focus();
    const evt = fire({});
    assert.strictEqual(exitCalled, 1, 'exit 必被呼叫一次');
    assert.strictEqual(evt.defaultPrevented, true, 'preventDefault 必被呼叫');
  });

  it('非 ESC 鍵不觸發', () => {
    fire({ key: 'a', code: 'KeyA' });
    assert.strictEqual(exitCalled, 0);
  });

  it('Alt+ESC 不觸發（避免誤觸系統快速鍵）', () => {
    fire({ altKey: true });
    assert.strictEqual(exitCalled, 0);
  });

  it('Cmd+ESC 不觸發', () => {
    fire({ metaKey: true });
    assert.strictEqual(exitCalled, 0);
  });

  it('Shift+ESC 不觸發', () => {
    fire({ shiftKey: true });
    assert.strictEqual(exitCalled, 0);
  });

  it('INPUT focus 時不觸發（使用者輸入中 ESC 是取消輸入）', () => {
    const input = document.getElementById('search');
    input.focus();
    fire({ target: input });
    assert.strictEqual(exitCalled, 0);
  });

  it('TEXTAREA focus 時不觸發', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    fire({ target: ta });
    assert.strictEqual(exitCalled, 0);
  });

  it('contenteditable focus 時不觸發（Notion / Google Docs 類）', () => {
    const ce = document.getElementById('ce');
    ce.focus();
    fire({ target: ce });
    assert.strictEqual(exitCalled, 0);
  });

  it('button focus 不算輸入 → ESC 仍觸發退出', () => {
    const b = document.getElementById('b');
    b.focus();
    fire({ target: b });
    assert.strictEqual(exitCalled, 1, 'button focus 不該擋 ESC（不是輸入元素）');
  });
});
