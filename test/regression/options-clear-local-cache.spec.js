// JRead — options「清除閱讀位置記憶（本機快取除錯）」按鈕（v1.0.13）
//
// 行為：設定頁加一個除錯區塊，顯示 storage.local（只存 readingPositions）的
// 筆數 / 用量，並提供一顆「清除快取」按鈕清掉 storage.local。清 local 不動任何
// 偏好（偏好全在 storage.sync）。danger 雙態同 resetDefaults：第一次點只進入確認
// 狀態（不清），第二次點才真正 clear。
//
// 本 spec 用真 options.html + 真 options.js 在 jsdom 跑（stub chrome）。
// 訊號層次：驗按鈕只打 storage.local.clear、不碰 storage.sync.set、雙態確認流；
// 不驗真實 browser.storage 行為，也不驗 getBytesInUse 數值正確性。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { JREAD_DIR } = require('../helpers');

const OPTIONS_HTML = fs.readFileSync(path.join(JREAD_DIR, 'options', 'options.html'), 'utf8');
const SRC_DEFAULTS = fs.readFileSync(path.join(JREAD_DIR, 'content', 'settings-defaults.js'), 'utf8');
const SRC_DOMAIN = fs.readFileSync(path.join(JREAD_DIR, 'content', 'domain-match.js'), 'utf8');
const SRC_SHORTCUTS = fs.readFileSync(path.join(JREAD_DIR, 'content', 'shortcut-utils.js'), 'utf8');
const SRC_OPTIONS = fs.readFileSync(path.join(JREAD_DIR, 'options', 'options.js'), 'utf8');

function _resolved(value) {
  return {
    then(onF) {
      if (typeof onF !== 'function') return _resolved(value);
      let r; try { r = onF(value); } catch (e) { return _resolved(undefined); }
      return (r && typeof r.then === 'function') ? r : _resolved(r);
    },
    catch() { return this; }
  };
}

function buildOptionsEnv() {
  const dom = new JSDOM(OPTIONS_HTML, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const syncSetCalls = [];
  const localClearCalls = [];
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.0.0-test' }),
      id: 'test-ext',
      getURL: () => 'chrome-extension://test-ext/'
    },
    storage: {
      sync: {
        get: (defaults) => _resolved({ ...defaults }),
        set: (patch) => { syncSetCalls.push(patch); return _resolved(undefined); }
      },
      local: {
        get: (defaults) => _resolved({ ...defaults, readingPositions: { 'https://a': { ts: 1 } } }),
        clear: () => { localClearCalls.push(true); return _resolved(undefined); }
        // getBytesInUse 故意不提供 → 驗 Safari/iOS 不支援時不炸（退 JSON 估算）
      },
      onChanged: { addListener: () => {} }
    }
  };
  window.eval(SRC_DEFAULTS);
  window.eval(SRC_DOMAIN);
  window.eval(SRC_SHORTCUTS);
  window.eval(SRC_OPTIONS);
  return { window, document: window.document, syncSetCalls, localClearCalls };
}

describe('options — 清除閱讀位置記憶（v1.0.13）', () => {
  it('options.html 含 storage-info 與 clearLocalCache 按鈕（reset 之前）', () => {
    assert.match(OPTIONS_HTML, /<button[^>]+id=["']clearLocalCache["']/, '缺清除快取按鈕');
    assert.match(OPTIONS_HTML, /id=["']storage-info["']/, '缺 storage-info 顯示區');
    const clearIdx = OPTIONS_HTML.indexOf('id="clearLocalCache"');
    const resetIdx = OPTIONS_HTML.indexOf('id="resetDefaults"');
    assert.ok(clearIdx !== -1 && resetIdx !== -1 && clearIdx < resetIdx,
      '清除快取按鈕應在回復預設按鈕之前');
  });

  it('第一次點只進入確認狀態，不清 storage', () => {
    const { window, document, localClearCalls } = buildOptionsEnv();
    localClearCalls.length = 0;
    const btn = document.getElementById('clearLocalCache');
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.strictEqual(localClearCalls.length, 0, '第一次點不可清 storage');
    assert.ok(btn.classList.contains('confirming'), '第一次點必須進入 confirming 視覺狀態');
  });

  it('第二次點清 storage.local，且完全不碰 storage.sync', () => {
    const { window, document, syncSetCalls, localClearCalls } = buildOptionsEnv();
    syncSetCalls.length = 0;
    localClearCalls.length = 0;
    const btn = document.getElementById('clearLocalCache');
    btn.dispatchEvent(new window.Event('click', { bubbles: true })); // 進入確認
    btn.dispatchEvent(new window.Event('click', { bubbles: true })); // 執行清除
    assert.strictEqual(localClearCalls.length, 1, '第二次點必須清一次 storage.local');
    assert.strictEqual(syncSetCalls.length, 0, '清快取不可動到 storage.sync（偏好）');
  });

  it('載入時讀 storage.local 顯示筆數（getBytesInUse 不存在也不炸）', () => {
    const { document } = buildOptionsEnv();
    const info = document.getElementById('storage-info');
    assert.match(info.textContent, /閱讀位置記憶：1 筆/, 'storage-info 應顯示筆數');
  });
});
