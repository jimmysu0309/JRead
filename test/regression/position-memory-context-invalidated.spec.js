// JRead — 擴充 context 失效時閱讀位置寫入安靜略過（v1.5.28）
// -----------------------------------------------------------------------------
// Jimmy 2026-07-02 Instapaper 舊分頁實測：reload 擴充後（測 byline 修法），已開
// 分頁的舊 content script 變孤兒——`browser.storage`（Chrome 下 = chrome.storage）
// 被剝離。position-memory 寫入閱讀位置時丟「Cannot read properties of undefined
// (reading 'local')」，經 recordWriteError → console.warn 冒出誤導性錯誤通知
// 「[JRead] 閱讀位置寫入失敗」。
//
// 這是擴充 reload / 自動更新後的預期情況（非真正寫入失敗），且擴充每次自動更新
// 時所有開著的分頁都會遇到。修法：contextValid() 偵測 context 失效（browser
// .runtime.id / browser.storage 任一缺），rawSet / localGet / persistNow /
// recordWriteError 全在失效時安靜 no-op——不丟錯、不 warn。context 有效時的真正
// 寫入失敗（iOS Safari 偶發 set reject）仍照常 self-heal + warn。
//
// 訊號層次（本 spec 驗 X、不驗 Y）：
//   驗：contextValid 對 browser.storage / runtime.id 缺失的判定；context 失效時
//       recordWriteError 安靜略過（不 warn）；context 有效時真正錯誤仍 warn。
//   不驗：真實瀏覽器 context invalidation 的實際時序、iOS 回收層行為——真機驗。

const path = require('path');
const assert = require('assert');

const PM_PATH = path.join(__dirname, '..', '..', 'jread', 'content', 'position-memory.js');
const pm = require(PM_PATH);

// position-memory 內 `browser` 為自由變數 → 解析到 global.browser。用它模擬
// context 有效 / 失效。每個 case 前後清乾淨避免污染其他 spec。
function withBrowser(browserObj, fn) {
  const had = Object.prototype.hasOwnProperty.call(global, 'browser');
  const prev = global.browser;
  if (browserObj === undefined) delete global.browser;
  else global.browser = browserObj;
  try { return fn(); }
  finally { if (had) global.browser = prev; else delete global.browser; }
}
const VALID = { runtime: { id: 'test-ext' }, storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } } };

describe('position-memory — context 失效寫入安靜略過 (v1.5.28)', () => {

  it('browser 不存在（node / 孤兒）→ contextValid() false', () => {
    withBrowser(undefined, () => assert.strictEqual(pm.contextValid(), false));
  });

  it('browser.storage 被剝離（context 失效）→ contextValid() false', () => {
    withBrowser({ runtime: { id: 'test-ext' } }, () =>
      assert.strictEqual(pm.contextValid(), false,
        'runtime 在但 storage 被剝離（reload 後孤兒）必須判失效'));
  });

  it('runtime.id 變 undefined（context 失效）→ contextValid() false', () => {
    withBrowser({ runtime: {}, storage: { local: {} } }, () =>
      assert.strictEqual(pm.contextValid(), false,
        'runtime.id undefined 是 context invalidation 訊號'));
  });

  it('runtime.id + storage.local 齊備 → contextValid() true', () => {
    withBrowser(VALID, () => assert.strictEqual(pm.contextValid(), true));
  });

  it('context 失效時 recordWriteError 安靜略過（不 warn）', () => {
    const warns = [];
    const orig = console.warn; console.warn = (...a) => warns.push(a.join(' '));
    try {
      withBrowser({ runtime: { id: 'x' } }, () =>
        pm.recordWriteError(new TypeError("Cannot read properties of undefined (reading 'local')")));
    } finally { console.warn = orig; }
    assert.strictEqual(warns.length, 0,
      'context 失效造成的寫入失敗不可 warn（否則使用者看到誤導性錯誤通知）');
  });

  it('context 有效時真正寫入失敗仍 warn（正常錯誤路徑不受影響）', () => {
    const warns = [];
    const orig = console.warn; console.warn = (...a) => warns.push(a.join(' '));
    try {
      withBrowser(VALID, () => pm.recordWriteError(new Error('iOS set reject')));
    } finally { console.warn = orig; }
    assert.ok(warns.some(w => /閱讀位置寫入失敗/.test(w)),
      'context 有效時的真正寫入失敗仍須 warn（iOS self-heal 路徑不受影響）');
  });
});
