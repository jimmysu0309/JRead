// JRead — main.js safeSendMessage helper forcing function（v0.7.140）
//
// 對應 bug：「Uncaught TypeError: Cannot read properties of undefined (reading
// 'sendMessage')」at content/main.js:270 chrome.runtime.sendMessage——extension
// context invalidated（jread reload 後 content script 仍跑舊代碼但 chrome.
// runtime 失效）。Jimmy 2026-05-19 substack reader hub reader mode exit 時實機
// 截圖回報。
//
// 修法：main.js 加 `safeSendMessage(msg, cb?)` helper，內部 guard `chrome.
// runtime.id` 是否仍存在（invalidated 後變 undefined），失效時 silently
// no-op（fire-and-forget call site 不影響使用體驗）。main.js 內**所有** sendMessage
// call 統一走此 helper，不可直接呼 chrome.runtime.sendMessage。
//
// 本 spec 是 forcing function：
//   - main.js 必須宣告 safeSendMessage
//   - helper body 必須 guard chrome.runtime.id
//   - main.js 內 chrome.runtime.sendMessage 直接呼叫**只能**出現在 helper body
//     的 try-catch 內（恰好 2 處：if cb 分支 + else 分支）。任何外部新呼叫
//     會讓 count 變 3+，spec 立刻 fail。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MAIN_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8'
);

describe('main.js safeSendMessage helper（v0.7.140）', () => {
  it('必須宣告 function safeSendMessage', () => {
    assert.ok(/function safeSendMessage\s*\(/.test(MAIN_SRC),
      'main.js 必須宣告 function safeSendMessage(msg, cb)');
  });

  it('helper 必須 guard chrome.runtime.id（context-invalidated detect）', () => {
    // 抓 helper body：從 `function safeSendMessage(` 起到匹配的 `  }`
    const m = MAIN_SRC.match(/function safeSendMessage\s*\([^)]*\)\s*\{[\s\S]*?^  \}/m);
    assert.ok(m, 'safeSendMessage helper body 必須能匹配到');
    assert.match(m[0], /chrome\.runtime\.id/,
      'safeSendMessage 必須 guard chrome.runtime.id —— extension context invalidated 時此值會變 undefined');
  });

  it('chrome.runtime.sendMessage 直接呼叫只可出現在 helper 內 2 處（其他 call 必須走 safeSendMessage）', () => {
    // 數 main.js 內所有 `chrome.runtime.sendMessage(` 出現次數（排除 comment）
    const lines = MAIN_SRC.split('\n');
    const callLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 排除單行 comment 內的字面字串（line 19 文件 / line 451 「v0.7.126：chrome.runtime.reload() 在...」等）
      if (/^\s*\/\//.test(line)) continue;
      if (/chrome\.runtime\.sendMessage\s*\(/.test(line)) {
        callLines.push({ lineNo: i + 1, line: line.trim() });
      }
    }
    assert.strictEqual(callLines.length, 2,
      `main.js 內 chrome.runtime.sendMessage 直接呼叫只該在 safeSendMessage helper try 區塊內出現 2 次（if cb 分支 + else 分支），實際出現 ${callLines.length} 次。新增的 chrome.runtime.sendMessage call 必須改走 safeSendMessage helper。實際命中行：${JSON.stringify(callLines)}`);
  });

  it('main.js 至少有 1 處外部呼叫 safeSendMessage（驗證 helper 真的被使用）', () => {
    const lines = MAIN_SRC.split('\n');
    let externalCalls = 0;
    for (const line of lines) {
      if (/^\s*\/\//.test(line)) continue;
      // 外部 call = safeSendMessage 呼叫且不在 helper 宣告行
      if (/safeSendMessage\s*\(/.test(line) && !/function safeSendMessage/.test(line)) {
        externalCalls++;
      }
    }
    assert.ok(externalCalls >= 5,
      `預期 main.js 內至少有 5 處外部 safeSendMessage 呼叫（v0.7.140 替換 11 處 chrome.runtime.sendMessage call sites），實際 ${externalCalls} 處`);
  });
});
