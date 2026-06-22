// JRead — options 儲存狀態提示條（v0.8.162，參考姊妹專案 Shinkansen save-bar）
//
// 任一欄位變更 → 固定頂端提示條亮「存檔中…」（紅，.saving）→ chrome.storage.sync.set
// callback → 轉「已存檔」（綠，.saved、3s 後 hidden）；set 失敗（lastError）→
// 「儲存失敗…」（紅，.error）不可閃假的「已存檔」。
//
// 訊號層次：jsdom 真 options.html + options.js（stub chrome）驗 DOM class / 文字
// 狀態轉換與寫入 path wiring；視覺呈現（固定頂端、顏色）由實機 / 截圖驗。
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

// set 可同步或延後回 callback（驗存檔中→已存檔的中間態）
function buildOptionsEnv({ deferCallback = false, lastError } = {}) {
  const dom = new JSDOM(OPTIONS_HTML, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const pendingCallbacks = [];
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.0.0-test' }),
      id: 'test-ext',
      getURL: () => 'chrome-extension://test-ext/',
      get lastError() { return lastError; }
    },
    storage: {
      sync: {
        get: (defaults, cb) => cb({ ...defaults }),
        set: (patch, cb) => {
          if (!cb) return;
          if (deferCallback) pendingCallbacks.push(cb);
          else cb();
        }
      },
      onChanged: { addListener: () => {} }
    }
  };
  window.eval(SRC_DEFAULTS);
  window.eval(SRC_DOMAIN);
  window.eval(SRC_SHORTCUTS);
  window.eval(SRC_OPTIONS);
  const flushCallbacks = () => { while (pendingCallbacks.length) pendingCallbacks.shift()(); };
  return { window, document: window.document, flushCallbacks };
}

function fireChange(window, document, id, value, isCheckbox) {
  const el = document.getElementById(id);
  if (isCheckbox) el.checked = value; else el.value = value;
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

describe('options — 儲存狀態提示條（v0.8.162）', () => {
  it('save-bar 元素存在、初始 hidden（不佔空間）', () => {
    const { document } = buildOptionsEnv();
    const bar = document.getElementById('save-bar');
    assert.ok(bar, '缺 #save-bar 元素');
    assert.ok(bar.classList.contains('save-bar'), 'save-bar 必須有 .save-bar class');
    assert.strictEqual(bar.hidden, true, '初始必須 hidden');
  });

  it('欄位變更：寫入前亮「存檔中…」（.saving），callback 後轉「已存檔」（.saved）', () => {
    const { window, document, flushCallbacks } = buildOptionsEnv({ deferCallback: true });
    const bar = document.getElementById('save-bar');

    fireChange(window, document, 'pangu', false, true);
    // callback 尚未觸發 → 停在「存檔中」
    assert.strictEqual(bar.hidden, false, '存檔中必須顯示');
    assert.ok(bar.classList.contains('saving'), '寫入中必須是 .saving 狀態');
    assert.strictEqual(bar.textContent, '存檔中…');

    flushCallbacks();
    assert.ok(bar.classList.contains('saved'), 'set 完成後必須轉 .saved');
    assert.strictEqual(bar.textContent, '已存檔');
    assert.strictEqual(bar.hidden, false, '已存檔當下仍顯示（3s 後才淡出）');
  });

  it('快速鍵清除 path 也走 save-bar（saveShortcuts）', () => {
    const { window, document } = buildOptionsEnv();
    const bar = document.getElementById('save-bar');
    // 清除鍵呼 saveShortcuts() → showSaving + flashSaved
    const clearBtn = document.getElementById('sc-clear-toggle-reader-mode');
    clearBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    // 同步 callback → 直接到「已存檔」
    assert.ok(bar.classList.contains('saved'), '快速鍵變更必須觸發 save-bar');
    assert.strictEqual(bar.textContent, '已存檔');
  });

  it('自動啟動網域變更也走 save-bar', () => {
    const { window, document } = buildOptionsEnv();
    const bar = document.getElementById('save-bar');
    fireChange(window, document, 'autoEnableDomains', 'abc.com', false);
    assert.ok(bar.classList.contains('saved'), 'autoEnableDomains 變更必須觸發 save-bar');
  });

  it('set 失敗（lastError）顯示「儲存失敗…」（.error），不可閃假的「已存檔」', () => {
    const { window, document } = buildOptionsEnv({ lastError: { message: 'QUOTA' } });
    const bar = document.getElementById('save-bar');
    fireChange(window, document, 'pangu', false, true);
    assert.ok(bar.classList.contains('error'), 'lastError 時必須是 .error 狀態');
    assert.ok(/失敗/.test(bar.textContent), '必須顯示失敗訊息');
    assert.ok(!bar.classList.contains('saved'), '失敗時不可誤標 .saved');
  });

  it('save-bar 文字段末不留句號（UI 文字規則）', () => {
    assert.ok(!/儲存失敗，請稍後再試。/.test(SRC_OPTIONS), '錯誤訊息段末不可加句號');
    assert.ok(/showSaveBar\('saved', '已存檔'\)/.test(SRC_OPTIONS), '「已存檔」段末不可加句號');
  });
});
