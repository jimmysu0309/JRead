// JRead — 懸浮按鈕長按選單「送到 Readwise Reader」content 端直送（v0.8.165）
//
// 背景：原本長按選單送 Readwise 走 CUSTOM_COMMAND → SW sendToReadwiseFromCommand
// 由 SW fetch。iOS / iPadOS Safari 的背景頁（SW）被系統積極掛起、背景 fetch silently
// 失敗（Chrome / macOS 正常）→ 使用者點了沒反應、連結果 toast 都回不來。
//
// 修法：Safari runtime 改由 content script（前景分頁不被掛起 + host_permissions CORS
// 豁免）直接 fetch（NS.sendCurrentPageToReadwise）；Chrome 仍走 SW（content fetch 受
// 頁面來源 CORS 擋）。送出當下先彈 info toast 當視覺提示。
//
// 本 spec 兩層：
//   (1) 路由與視覺提示：functional（floating-icon.spec 已驗，這裡補 source forcing function）
//   (2) main.js sendCurrentPageToReadwise orchestration：source-level forcing function
//       ——main.js 倚賴整個 content script 堆疊（detector/cleaner/styler），無法在 jsdom
//       單獨 eval；比照 main-safe-send-message.spec / cinema-mode.spec 用 source 斷言。
//       送出邏輯本身（buildReadwisePayload / saveToReadwise / readwiseResultToast）的
//       functional 行為由 readwise-save.spec 覆蓋；真實 Safari CORS / 送達由 iOS
//       模擬器 + TestFlight 自驗（harness 測不到跨來源 fetch 與 iOS 掛起時序）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const JREAD_DIR = path.join(__dirname, '..', '..', 'jread');
const MAIN_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'main.js'), 'utf8');
const FLOATING_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'floating-icon.js'), 'utf8');
const POPUP_CORE_SRC = fs.readFileSync(path.join(JREAD_DIR, 'popup', 'popup-core.js'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(JREAD_DIR, 'background', 'service-worker.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(JREAD_DIR, 'manifest.json'), 'utf8'));

describe('懸浮按鈕送 Readwise — content 直送（v0.8.165）', () => {
  describe('wiring：popup-core 當 content script 載入', () => {
    it('manifest content_scripts 含 popup/popup-core.js，在 namespace.js 之後、main.js 之前', () => {
      const js = manifest.content_scripts[0].js;
      const idx = js.indexOf('popup/popup-core.js');
      assert.ok(idx !== -1, 'manifest content_scripts 必須含 popup/popup-core.js（content 端共用送出邏輯）');
      assert.ok(idx > js.indexOf('content/namespace.js'), '必須在 namespace.js 之後');
      assert.ok(idx < js.indexOf('content/main.js'), '必須在 main.js 之前（main.js 用 window.__JReadPopup）');
    });

    it('popup-core CONTENT_SCRIPT_FILES 也含 popup/popup-core.js（SPA inject fallback 不漏）', () => {
      assert.ok(/['"]popup\/popup-core\.js['"]/.test(POPUP_CORE_SRC),
        'popup-core CONTENT_SCRIPT_FILES 缺自己 → 既有分頁 inject fallback 會漏注入、Safari 直送會 NoModule');
    });

    it('popup-core 掛 globalThis.__JReadPopup（content isolated world 可讀 window.__JReadPopup）', () => {
      assert.ok(/g\.__JReadPopup\s*=\s*api/.test(POPUP_CORE_SRC));
    });
  });

  describe('floating-icon.sendToReadwise 路由（source forcing function）', () => {
    it('送出當下先彈 toast（視覺提示）', () => {
      assert.ok(/NS\.toast\.show\(\s*['"]送出到 Readwise Reader…['"]/.test(FLOATING_SRC),
        'sendToReadwise 必須先彈「送出到 Readwise Reader…」info toast');
    });

    it('Safari runtime → NS.sendCurrentPageToReadwise（content 直送）', () => {
      assert.ok(/isSafariRuntime\(\)\s*&&\s*typeof NS\.sendCurrentPageToReadwise === ['"]function['"]/.test(FLOATING_SRC),
        'Safari 分流必須呼叫 NS.sendCurrentPageToReadwise');
      assert.ok(/NS\.sendCurrentPageToReadwise\(\)/.test(FLOATING_SRC));
    });

    it('非 Safari / 函式缺席 → fallback 走 SW CUSTOM_COMMAND send-to-readwise', () => {
      assert.ok(/CUSTOM_COMMAND[\s\S]*command:\s*['"]send-to-readwise['"]/.test(FLOATING_SRC),
        'Chrome / fallback 仍轉 SW CUSTOM_COMMAND');
    });
  });

  describe('main.js sendCurrentPageToReadwise orchestration（source forcing function）', () => {
    it('暴露為 NS.sendCurrentPageToReadwise', () => {
      assert.ok(/NS\.sendCurrentPageToReadwise\s*=\s*sendCurrentPageToReadwise/.test(MAIN_SRC));
    });

    it('未啟動閱讀模式時先 await enterReaderMode', () => {
      const fn = MAIN_SRC.slice(MAIN_SRC.indexOf('async function sendCurrentPageToReadwise'));
      assert.ok(/!NS\.state\.active[\s\S]*await enterReaderMode\(\)/.test(fn),
        'reader 未啟動時必須先進入閱讀模式才有主文可抽');
    });

    it('content 端抽 payload（extractReaderPayload），不經訊息往返', () => {
      const fn = MAIN_SRC.slice(MAIN_SRC.indexOf('async function sendCurrentPageToReadwise'));
      assert.ok(/extractReaderPayload\(\)/.test(fn));
    });

    it('共用 popup-core 送出邏輯：saveReaderPayload + readwiseResultToast（不雙實作 fetch / 訊息）', () => {
      const fn = MAIN_SRC.slice(MAIN_SRC.indexOf('async function sendCurrentPageToReadwise'),
        MAIN_SRC.indexOf('NS.sendCurrentPageToReadwise = sendCurrentPageToReadwise'));
      assert.ok(/\.saveReaderPayload\(/.test(fn), '送出必須走 popup-core.saveReaderPayload（content fetch）');
      assert.ok(/\.readwiseResultToast\(/.test(fn), '結果 toast 必須走 popup-core.readwiseResultToast（共用文字）');
      assert.ok(!/READWISE_API_URL|api\/v3\/save/.test(fn),
        'content 端不可自己硬寫 Readwise endpoint / fetch（避免與 popup-core 雙實作 drift）');
    });

    it('結果透過 showToast 顯示（視覺提示閉環）', () => {
      const fn = MAIN_SRC.slice(MAIN_SRC.indexOf('async function sendCurrentPageToReadwise'),
        MAIN_SRC.indexOf('NS.sendCurrentPageToReadwise = sendCurrentPageToReadwise'));
      assert.ok(/showToast\(message, kind\)/.test(fn));
    });
  });

  describe('SW 軌也共用 readwiseResultToast（單一資料源，不雙實作訊息文字）', () => {
    it('service-worker 結果 toast 走 readwiseResultToast', () => {
      assert.ok(/readwiseResultToast\(result\)/.test(SW_SRC),
        'SW sendToReadwiseFromCommand 結果 toast 必須走共用 readwiseResultToast');
    });

    it('SW 不再內聯硬寫「已送到 Readwise Reader」字串（已抽到 popup-core）', () => {
      // 結果訊息文字已集中在 popup-core.readwiseResultToast；SW 內聯字串會 drift
      assert.ok(!/showToast\(\s*['"]已送到 Readwise Reader['"]/.test(SW_SRC),
        'SW 不可再內聯結果文字——單一資料源在 popup-core.readwiseResultToast');
    });
  });
});
