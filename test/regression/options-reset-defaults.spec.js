// JRead — options「回復預設設定」按鈕（v0.8.157）
//
// 行為：頁面最下方一顆「回復預設」按鈕，把所有設定複寫回 settings-defaults.js
// 的預設值，但**保留兩個 API key**（readwiseToken / geminiApiKey——使用者貼過的
// 憑證，reset 不該被洗掉）。floatingIcon 三態回復為「未設過」（null）、
// floatingIconPos 拖移位置一併清掉。danger 雙態：第一次點進入確認狀態（不寫
// storage），第二次點才真正寫入。
//
// 本 spec 用真 options.html + 真 options.js 在 jsdom 跑（stub chrome）。
// 訊號層次：驗 set 呼叫的 payload 內容與雙態確認流；不驗真實 chrome.storage 行為。

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

function buildOptionsEnv() {
  const dom = new JSDOM(OPTIONS_HTML, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const setCalls = [];
  const onChangedListeners = [];
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.0.0-test' }),
      id: 'test-ext',
      getURL: () => 'chrome-extension://test-ext/',
      lastError: undefined
    },
    storage: {
      sync: {
        get: (defaults, cb) => cb({ ...defaults }),
        set: (patch, cb) => { setCalls.push(patch); if (cb) cb(); }
      },
      onChanged: { addListener: (fn) => onChangedListeners.push(fn) }
    }
  };
  window.eval(SRC_DEFAULTS);
  window.eval(SRC_DOMAIN);
  window.eval(SRC_SHORTCUTS);
  window.eval(SRC_OPTIONS);
  return { window, document: window.document, setCalls };
}

describe('options — 回復預設設定（v0.8.157）', () => {
  it('options.html 含 resetDefaults 按鈕（頁面最下方、license 之前）', () => {
    assert.match(OPTIONS_HTML, /<button[^>]+id=["']resetDefaults["']/,
      '缺回復預設按鈕');
    const btnIdx = OPTIONS_HTML.indexOf('id="resetDefaults"');
    const licenseIdx = OPTIONS_HTML.indexOf('class="license"');
    assert.ok(btnIdx !== -1 && licenseIdx !== -1 && btnIdx < licenseIdx,
      '回復預設按鈕必須在 license 區段之前（設定區最下方）');
  });

  it('第一次點只進入確認狀態，不寫 storage', () => {
    const { window, document, setCalls } = buildOptionsEnv();
    setCalls.length = 0;
    const btn = document.getElementById('resetDefaults');
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.strictEqual(setCalls.length, 0, '第一次點不可寫 storage');
    assert.ok(btn.classList.contains('confirming'), '第一次點必須進入 confirming 視覺狀態');
  });

  it('第二次點寫入預設值，但保留 readwiseToken / geminiApiKey', () => {
    const { window, document, setCalls } = buildOptionsEnv();
    setCalls.length = 0;
    const btn = document.getElementById('resetDefaults');
    btn.dispatchEvent(new window.Event('click', { bubbles: true })); // 進入確認
    btn.dispatchEvent(new window.Event('click', { bubbles: true })); // 執行回復

    assert.strictEqual(setCalls.length, 1, '第二次點必須寫一次 storage');
    const payload = setCalls[0];
    assert.ok(!('readwiseToken' in payload), 'payload 不可含 readwiseToken（保留使用者憑證）');
    assert.ok(!('geminiApiKey' in payload), 'payload 不可含 geminiApiKey（保留使用者憑證）');
  });

  it('回復 payload：threeFingerTap=false、floatingIcon/Pos=null、其餘回預設', () => {
    const { window, document, setCalls } = buildOptionsEnv();
    setCalls.length = 0;
    const btn = document.getElementById('resetDefaults');
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    const payload = setCalls[0];
    const DEFAULTS = window.__JReadSettingsDefaults;

    assert.strictEqual(payload.threeFingerTap, false, 'threeFingerTap 回預設 false');
    assert.strictEqual(payload.theme, DEFAULTS.theme);
    assert.strictEqual(payload.fontSize, DEFAULTS.fontSize);
    assert.strictEqual(payload.blockPageShortcuts, DEFAULTS.blockPageShortcuts);
    assert.ok(Array.isArray(payload.autoEnableDomains) && payload.autoEnableDomains.length === 0,
      'autoEnableDomains 回復為空陣列');
    assert.strictEqual(payload.floatingIcon, null, 'floatingIcon 回復為未設過（null → 平台預設）');
    assert.strictEqual(payload.floatingIconPos, null, 'floatingIconPos 拖移位置一併清掉');
  });
});
