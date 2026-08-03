// JRead — regression spec: content getSettings 直讀 storage（v0.7.235）
//
// 根因（Jimmy 2026-06-07 回報「翻頁模式 iOS 沒功能」）：content 端 getSettings
// 透過 GET_SETTINGS round-trip 找 background 拿設定，但 iOS Safari 的
// background 訊息會無聲掉包（SW 回收後不再喚醒 Apple thread 758346；
// iOS 18.4+ sendMessage 掉包 regression thread 787958）。掉包時 callback 收到
// undefined → 下游所有設定 fallback 預設值：theme / fontSize 靜默退化難察覺，
// pagedMode 永遠 false。iOS simulator instrument 實證：round-trip 回 undefined、
// content 直讀 browser.storage.sync 正常回 pagedMode=true。
//
// 修法：getSettings 直讀 browser.storage.sync（defaults 來自單一資料源
// content/settings-defaults.js），round-trip 降為 storage 失效（context
// invalidated）時的 fallback。
//
// 訊號層次（本 spec 驗 X、不驗 Y）：
//   驗：settings-defaults.js 單一資料源的值與匯出形式、getSettings 函式的
//       行為（直讀優先 / lastError 與 throw 走 fallback——以 main.js 原始碼
//       切片 + stub chrome 執行）、SW / manifest / 預載清單的結構性 wiring。
//   不驗：真實 iOS Safari 的訊息掉包行為（只能 simulator / 實機驗）；
//       Safari event page scripts 預載的實際載入順序（patch script 的 jq
//       輸出由 ios-build.spec.js 驗、實機由 TestFlight 驗收）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JREAD_DIR } = require('../helpers');

const DEFAULTS_PATH = path.join(JREAD_DIR, 'content', 'settings-defaults.js');
const MAIN_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'main.js'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(JREAD_DIR, 'background', 'service-worker.js'), 'utf8');
const POPUP_SRC = fs.readFileSync(path.join(JREAD_DIR, 'popup', 'popup.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(JREAD_DIR, 'manifest.json'), 'utf8'));

const sharedDefaults = require(DEFAULTS_PATH);

// main.js 的 getSettings 函式切片（brace counting，避免 regex 吃不到巢狀大括號）
function sliceGetSettings(src) {
  const start = src.indexOf('async function getSettings()');
  assert.ok(start >= 0, 'main.js 找不到 getSettings');
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  assert.fail('getSettings 大括號不平衡');
}
const GET_SETTINGS_FN = sliceGetSettings(MAIN_SRC);

// 以 stub 執行 getSettings 切片，回傳 promise
// v0.8.164：getSettings 改用 browser.storage.sync.get（原生 Promise），factory
// 注入 browser（= 傳入的 stub）。stub 的 storage.sync.get 回 Promise（resolve 值
// 或 reject）模擬真實 browser.* 行為。
function runGetSettings({ chromeStub, sharedDefaultsObj, onBackgroundCall }) {
  const factory = new Function('window', 'browser', 'NS', 'safeSendMessage',
    GET_SETTINGS_FN + '\nreturn getSettings;');
  const NS = { MSG: { GET_SETTINGS: 'GET_SETTINGS' } };
  const safeSendMessage = (msg, cb) => {
    if (onBackgroundCall) onBackgroundCall(msg);
    // 模擬 iOS 掉包降級：cb(null)
    cb(null);
  };
  const windowStub = { __JReadSettingsDefaults: sharedDefaultsObj };
  return factory(windowStub, chromeStub, NS, safeSendMessage)();
}

describe('settings-defaults.js 單一資料源', () => {
  it('module.exports 是完整 defaults 物件（關鍵欄位 + 型別）', () => {
    // v1.7.33：預設值改為 Jimmy 慣用組合（gray / 17 / 無襯線 / 1.5 / 標題 32）
    assert.strictEqual(sharedDefaults.pagedMode, false);
    assert.strictEqual(sharedDefaults.theme, 'gray');
    assert.strictEqual(sharedDefaults.fontSize, 17);
    assert.strictEqual(sharedDefaults.contentWidth, 720);
    assert.strictEqual(sharedDefaults.fontFamily, globalThis.__JReadFontStacks.sans);
    assert.strictEqual(sharedDefaults.lineHeight, 1.5);
    assert.strictEqual(sharedDefaults.paragraphSpacing, 1.0);
    assert.strictEqual(sharedDefaults.blockPageShortcuts, true);
    assert.strictEqual(sharedDefaults.pangu, true);
    assert.strictEqual(sharedDefaults.spaceScrollRatio, 50);
    assert.strictEqual(sharedDefaults.titleFontSize, 32);
    assert.strictEqual(sharedDefaults.readwiseToken, '');
    assert.strictEqual(sharedDefaults.readwiseSummary, false);
    assert.strictEqual(sharedDefaults.geminiApiKey, '');
    assert.deepStrictEqual(sharedDefaults.autoEnableDomains, []);
    assert.deepStrictEqual(Object.keys(sharedDefaults.customShortcuts).sort(), [
      'send-to-readwise', 'toggle-reader-mode', 'toggle-youtube-borderless'
    ]);
  });

  it('掛 globalThis.__JReadSettingsDefaults（SW / event page / content 取用點）', () => {
    assert.strictEqual(globalThis.__JReadSettingsDefaults, sharedDefaults);
  });

  it('popup.js DEFAULT_SETTINGS 直接 reference shared（不再有自己的 literal）', () => {
    // v0.8.16：popup 原本自帶 DEFAULT_SETTINGS literal，本 spec 舊版只做「popup
    // 欄位 ⊆ shared」單向子集檢查（漏掉 shared 多出欄位的反向 drift）。整併後
    // popup 改 `const DEFAULT_SETTINGS = window.__JReadSettingsDefaults`——兩邊
    // 同一個物件、欄位 100% 一致，反向 drift 結構上不可能。改成驗 reference 形式
    //（仿同檔 SW 的「importScripts 並 globalThis 取用、不再有 literal」檢查風格）。
    assert.match(POPUP_SRC, /const DEFAULT_SETTINGS = window\.__JReadSettingsDefaults\b/,
      'popup.js 的 DEFAULT_SETTINGS 必須取自 window.__JReadSettingsDefaults（單一資料源）');
    assert.ok(!/const DEFAULT_SETTINGS = \{/.test(POPUP_SRC),
      'popup.js 不得再有 DEFAULT_SETTINGS literal（單一資料源在 settings-defaults.js）');
  });

  it('options.js DEFAULTS 直接 reference shared（不再有自己的 literal）', () => {
    // v0.8.16 同理：options.js 也收斂到單一資料源，反向 drift 結構上不可能。
    const OPTIONS_SRC = fs.readFileSync(path.join(JREAD_DIR, 'options', 'options.js'), 'utf8');
    assert.match(OPTIONS_SRC, /const DEFAULTS = window\.__JReadSettingsDefaults\b/,
      'options.js 的 DEFAULTS 必須取自 window.__JReadSettingsDefaults（單一資料源）');
    assert.ok(!/const DEFAULTS = \{/.test(OPTIONS_SRC),
      'options.js 不得再有 DEFAULTS literal（單一資料源在 settings-defaults.js）');
  });
});

describe('main.js getSettings 直讀 storage', () => {
  it('storage 正常 → 直接回 storage 值，不打 background', async () => {
    let backgroundCalled = false;
    const res = await runGetSettings({
      sharedDefaultsObj: sharedDefaults,
      chromeStub: {
        runtime: { id: 'test' },
        storage: { sync: { get: (defaults) => Promise.resolve({ ...defaults, pagedMode: true, theme: 'dark' }) } }
      },
      onBackgroundCall: () => { backgroundCalled = true; }
    });
    assert.strictEqual(res.pagedMode, true, '必須拿到 storage 的 pagedMode=true（iOS 根因場景）');
    assert.strictEqual(res.theme, 'dark');
    assert.strictEqual(backgroundCalled, false, 'storage 正常時不得 round-trip background');
  });

  it('storage.get 以 shared defaults 為 merge 基底', async () => {
    let passedDefaults = null;
    await runGetSettings({
      sharedDefaultsObj: sharedDefaults,
      chromeStub: {
        runtime: { id: 'test' },
        storage: { sync: { get: (defaults) => { passedDefaults = defaults; return Promise.resolve(defaults); } } }
      }
    });
    assert.strictEqual(passedDefaults, sharedDefaults,
      'storage.sync.get 的 defaults 參數必須是 window.__JReadSettingsDefaults（單一資料源）');
  });

  it('storage.get throw（context invalidated）→ 走 background fallback', async () => {
    let backgroundCalled = false;
    const res = await runGetSettings({
      sharedDefaultsObj: sharedDefaults,
      chromeStub: {
        runtime: { lastError: null },
        storage: { sync: { get: () => { throw new Error('Extension context invalidated'); } } }
      },
      onBackgroundCall: () => { backgroundCalled = true; }
    });
    assert.strictEqual(backgroundCalled, true, 'storage throw 必須退回 GET_SETTINGS round-trip');
    assert.strictEqual(res, null, '兩邊都死時 resolve(null)（與舊降級行為一致）');
  });

  it('storage.get resolve 空值（undefined）→ 走 background fallback', async () => {
    let backgroundCalled = false;
    await runGetSettings({
      sharedDefaultsObj: sharedDefaults,
      chromeStub: {
        runtime: { id: 'test' },
        storage: { sync: { get: () => Promise.resolve(undefined) } }
      },
      onBackgroundCall: () => { backgroundCalled = true; }
    });
    assert.strictEqual(backgroundCalled, true, 'resolve 空值必須退回 GET_SETTINGS round-trip');
  });

  it('storage.get reject（Promise 失敗）→ 走 background fallback（v0.8.164 browser.* reject 路徑）', async () => {
    let backgroundCalled = false;
    const res = await runGetSettings({
      sharedDefaultsObj: sharedDefaults,
      chromeStub: {
        runtime: { id: 'test' },
        storage: { sync: { get: () => Promise.reject(new Error('boom')) } }
      },
      onBackgroundCall: () => { backgroundCalled = true; }
    });
    assert.strictEqual(backgroundCalled, true, 'Promise reject 必須退回 GET_SETTINGS round-trip');
    assert.strictEqual(res, null, '兩邊都死時 resolve(null)（與舊降級行為一致）');
  });
});

describe('wiring（manifest / SW / 預載清單）', () => {
  it('manifest content_scripts 含 settings-defaults.js 且在 main.js 之前', () => {
    const files = MANIFEST.content_scripts[0].js;
    const iDefaults = files.indexOf('content/settings-defaults.js');
    const iMain = files.indexOf('content/main.js');
    assert.ok(iDefaults >= 0, 'manifest content_scripts 必須含 content/settings-defaults.js');
    assert.ok(iDefaults < iMain, 'settings-defaults.js 必須在 main.js 之前載入');
  });

  it('SW importScripts 預載 settings-defaults 並以 globalThis 取用（不再有 literal）', () => {
    assert.ok(SW_SRC.includes("importScripts('/content/settings-defaults.js')"),
      'SW 必須 importScripts settings-defaults');
    assert.ok(/const DEFAULT_SETTINGS = globalThis\.__JReadSettingsDefaults/.test(SW_SRC),
      'SW 的 DEFAULT_SETTINGS 必須取自 __JReadSettingsDefaults');
    assert.ok(!/DEFAULT_SETTINGS = \{/.test(SW_SRC),
      'SW 不得再有 DEFAULT_SETTINGS literal（單一資料源在 settings-defaults.js）');
  });
});
