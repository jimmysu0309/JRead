// JRead — safeSendMessage 統一到 namespace（v0.7.143，原 v0.7.140 spec 擴充）
//
// v0.7.140 原 bug：「Uncaught TypeError: Cannot read properties of undefined
// (reading 'sendMessage')」extension context invalidated 後直接呼 runtime
// .sendMessage TypeError。原修法把 helper 加在 main.js，但 youtube-borderless.js
// 等其他 content script 仍直接呼 sendMessage 沒 guard。
//
// v0.7.143 修法：safeSendMessage 提到 namespace.js（NS.safeSendMessage），
// **所有** content script 共用同一個 entry point。runtime.sendMessage
// 直接呼叫**只能**出現在 namespace.js helper body 內。
// 任何其他 content script 內出現直接 call 就違反 spec。
//
// v0.8.164：全擴充 chrome.* → browser.*（原生 Promise）。safeSendMessage 內部
// 改用 browser.runtime.sendMessage（單一呼叫、Promise then/catch 分流），故
// namespace.js 內直接呼叫從 2 次（callback if/else 兩分支）收斂為 1 次。
//
// 本 spec 是 forcing function：
//   - namespace.js 必須宣告 safeSendMessage method（NS.safeSendMessage）
//   - namespace.js helper body 必須 guard browser.runtime.id
//   - namespace.js 內 browser.runtime.sendMessage 出現恰 1 次
//   - 全 content script 不可殘留任何 chrome.runtime.sendMessage（舊 API）
//   - main.js / youtube-borderless.js / cinema-mode.js / x-thread.js
//     等其他 content script 內 runtime.sendMessage 直接呼叫恰 0 次
//   - main.js 必須有 `const safeSendMessage = NS.safeSendMessage` 短名 alias

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const CONTENT_DIR = path.join(__dirname, '..', '..', 'jread', 'content');
const NAMESPACE_SRC = fs.readFileSync(path.join(CONTENT_DIR, 'namespace.js'), 'utf8');
const MAIN_SRC = fs.readFileSync(path.join(CONTENT_DIR, 'main.js'), 'utf8');
const BORDERLESS_SRC = fs.readFileSync(path.join(CONTENT_DIR, 'youtube-borderless.js'), 'utf8');

// 數某 source 內非 comment 行裡 <api>.runtime.sendMessage 出現次數
function countSendMessage(src, api) {
  const re = new RegExp(api + '\\.runtime\\.sendMessage\\s*\\(');
  const lines = src.split('\n');
  let count = 0;
  for (const line of lines) {
    if (/^\s*\/\//.test(line)) continue;          // 單行 comment 排除
    if (/^\s*\*/.test(line)) continue;             // block comment 行排除
    if (re.test(line)) count++;
  }
  return count;
}

describe('namespace.js — NS.safeSendMessage helper（v0.7.143 統一到 namespace，v0.8.164 browser.* 遷移）', () => {
  it('namespace.js 必須宣告 safeSendMessage method', () => {
    assert.ok(/safeSendMessage\s*\(/.test(NAMESPACE_SRC),
      'namespace.js 必須在 NS 物件上宣告 safeSendMessage(msg, cb) method');
  });

  it('NS.safeSendMessage 必須 guard browser.runtime.id（context-invalidated detect）', () => {
    assert.ok(/browser\.runtime\.id/.test(NAMESPACE_SRC),
      'namespace.js safeSendMessage 必須 guard browser.runtime.id（invalidated 後此值 undefined）');
  });

  it('namespace.js 內 browser.runtime.sendMessage 直接呼叫恰好 1 次（safeSendMessage helper body）', () => {
    const count = countSendMessage(NAMESPACE_SRC, 'browser');
    assert.strictEqual(count, 1,
      `namespace.js 內 browser.runtime.sendMessage 直接呼叫應該恰好 1 次（safeSendMessage 內單一 Promise 呼叫），實際 ${count} 次`);
  });

  it('namespace.js 不可殘留 chrome.runtime.sendMessage（舊 callback API）', () => {
    const count = countSendMessage(NAMESPACE_SRC, 'chrome');
    assert.strictEqual(count, 0,
      `namespace.js 不可再有 chrome.runtime.sendMessage（v0.8.164 已全改 browser.*），實際 ${count} 次`);
  });
});

describe('main.js — 全走 NS.safeSendMessage（v0.7.143）', () => {
  it('main.js 必須宣告 const safeSendMessage = NS.safeSendMessage（短名 alias）', () => {
    assert.ok(/const\s+safeSendMessage\s*=\s*NS\.safeSendMessage/.test(MAIN_SRC),
      'main.js 必須含 `const safeSendMessage = NS.safeSendMessage` 短名 alias，避免每處寫長名');
  });

  it('main.js 內 runtime.sendMessage 直接呼叫恰好 0 次（全部走 safeSendMessage）', () => {
    const count = countSendMessage(MAIN_SRC, 'browser') + countSendMessage(MAIN_SRC, 'chrome');
    assert.strictEqual(count, 0,
      `main.js 不可直接呼 runtime.sendMessage（必須走 safeSendMessage helper guard context-invalidated），實際 ${count} 次`);
  });

  it('main.js 至少 5 處外部呼叫 safeSendMessage（驗證 helper 真的被使用）', () => {
    const lines = MAIN_SRC.split('\n');
    let externalCalls = 0;
    for (const line of lines) {
      if (/^\s*\/\//.test(line)) continue;
      if (/^\s*\*/.test(line)) continue;
      // 排除宣告 alias 那行
      if (/const\s+safeSendMessage\s*=/.test(line)) continue;
      if (/safeSendMessage\s*\(/.test(line)) externalCalls++;
    }
    assert.ok(externalCalls >= 5,
      `預期 main.js 內至少有 5 處 safeSendMessage call（v0.7.140 替換 11 處 browser.runtime.sendMessage），實際 ${externalCalls}`);
  });
});

describe('youtube-borderless.js — 必須走 NS.safeSendMessage（v0.7.143 修法）', () => {
  it('youtube-borderless.js 內 runtime.sendMessage 直接呼叫恰好 0 次', () => {
    const count = countSendMessage(BORDERLESS_SRC, 'browser') + countSendMessage(BORDERLESS_SRC, 'chrome');
    assert.strictEqual(count, 0,
      `youtube-borderless.js 不可直接呼 runtime.sendMessage（必須走 NS.safeSendMessage），實際 ${count} 次。原 v0.7.140 spec 漏蓋此檔，extension reload 後使用者在 borderless mode 切影片觸發 SPA nav → reapplyOnNavigation → requestResize → TypeError`);
  });

  it('youtube-borderless.js 必須含 NS.safeSendMessage 呼叫（驗證走 namespace helper）', () => {
    assert.ok(/NS\.safeSendMessage\s*\(/.test(BORDERLESS_SRC),
      'youtube-borderless.js 必須走 NS.safeSendMessage（reapplyOnNavigation → requestResize 的 sendMessage 呼叫點）');
  });
});

describe('全 content script — browser.runtime.sendMessage 直接呼叫只可出現在 namespace.js（v0.7.143）', () => {
  const SCRIPTS = [
    'cinema-mode.js',
    'cleaner.js',
    'detector.js',
    'main.js',
    'styler.js',
    'toast.js',
    'x-thread.js',
    'youtube-borderless.js'
  ];

  for (const filename of SCRIPTS) {
    it(`${filename} 內 runtime.sendMessage 直接呼叫恰好 0 次（chrome 或 browser 都不可）`, () => {
      const src = fs.readFileSync(path.join(CONTENT_DIR, filename), 'utf8');
      const count = countSendMessage(src, 'browser') + countSendMessage(src, 'chrome');
      assert.strictEqual(count, 0,
        `${filename} 不可直接呼 runtime.sendMessage —— 必須走 NS.safeSendMessage（namespace 共用 helper）以 guard extension context invalidated。實際 ${count} 次`);
    });
  }
});
