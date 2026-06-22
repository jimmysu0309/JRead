// JRead — 懸浮按鈕「功能選單」叫出 popup 的 SW / popup 端 wiring（v0.8.162）
//
// content 端（floating-icon.js：Safari 送 OPEN_FEATURE_MENU / 非 Safari 開頁內
// iframe 浮層）已由 floating-icon.spec.js 驗。本檔守住另兩端的 forcing function：
//   - service-worker.js：OPEN_FEATURE_MENU case → chrome.action.openPopup()，
//     失敗 / 不支援退而 chrome.tabs.create 開 popup.html（Safari path）
//   - popup.js：?panel=1 浮層模式偵測 + 回報內容尺寸 + close-panel postMessage
//     （非 Safari iframe 浮層用）
// SW / popup 行為需 Jimmy 本機 Chrome / iOS 才完整重現，這裡鎖「程式碼存在且
// 未被改回舊寫法」這層（同 sw-async-listener-guards / popup-toggle-state 測法）。
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'background', 'service-worker.js'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup', 'popup.js'), 'utf8');
const NS_SRC = fs.readFileSync(path.join(ROOT, 'content', 'namespace.js'), 'utf8');

describe('功能選單 → popup wiring（v0.8.162）', () => {
  describe('namespace MSG', () => {
    it('MSG 含 OPEN_FEATURE_MENU', () => {
      assert.match(NS_SRC, /OPEN_FEATURE_MENU:\s*'OPEN_FEATURE_MENU'/,
        'namespace MSG 必須宣告 OPEN_FEATURE_MENU（三方一致詞彙源）');
    });
  });

  describe('service-worker OPEN_FEATURE_MENU handler', () => {
    it('有 OPEN_FEATURE_MENU case', () => {
      assert.match(SW_SRC, /case\s*'OPEN_FEATURE_MENU'\s*:/,
        'SW 必須處理 OPEN_FEATURE_MENU');
    });

    it('優先 chrome.action.openPopup()，失敗退而 tabs.create 開 popup.html', () => {
      const m = SW_SRC.match(/case\s*'OPEN_FEATURE_MENU'\s*:\s*\{([\s\S]*?)\n\s{4}\}/);
      assert.ok(m, '找得到 OPEN_FEATURE_MENU case body');
      const body = m[1];
      assert.match(body, /openPopup\s*\(/, '必須嘗試 action.openPopup()');
      assert.match(body, /tabs\.create\(\s*\{\s*url:\s*chrome\.runtime\.getURL\('popup\/popup\.html'\)/,
        'openPopup 失敗必須退而開新分頁載 popup.html');
    });
  });

  describe('popup.js 浮層模式（?panel=1）', () => {
    it('偵測 ?panel=1（IS_PANEL）', () => {
      assert.match(POPUP_JS, /URLSearchParams\(location\.search\)\.get\('panel'\)\s*===\s*'1'/,
        'popup 必須用 ?panel=1 判定頁內浮層模式');
    });

    it('panel 模式回報內容尺寸（jread-panel-size）給外層 content', () => {
      assert.match(POPUP_JS, /jread-panel-size/,
        '必須 postMessage jread-panel-size 讓外層 iframe 收緊到內容尺寸');
      assert.match(POPUP_JS, /ResizeObserver/,
        '內容變動時用 ResizeObserver 重報尺寸');
    });

    it('closePanel 走 postMessage jread-close-panel（iframe 無法自關）', () => {
      assert.match(POPUP_JS, /jread-close-panel/,
        'panel 模式關閉必須 postMessage jread-close-panel（window.close 在 iframe 無效）');
    });

    it('開啟設定頁後在 panel 模式收掉浮層（closePanel）', () => {
      const m = POPUP_JS.match(/openOptionsLink\.addEventListener\([\s\S]*?\}\);/);
      assert.ok(m, '找得到 openOptionsLink click handler');
      assert.match(m[0], /closePanel\(\)/,
        '開設定頁後須 closePanel——否則浮層殘留在底層頁上');
    });
  });
});
