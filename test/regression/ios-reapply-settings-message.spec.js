// JRead — iOS 設定即時重套（REAPPLY_SETTINGS 訊息）forcing function（v0.8.148）
//
// Bug（Jimmy 2026-06-21 iPhone 回報）：在 popup 改主題 / 字級等設定，閱讀模式不即時
// 生效、要重整網頁再進閱讀模式才看得到；桌機 Chrome 即時生效。
//
// 根因（症狀 anchor：主題 / 字級 / 行距全部要重整 → 共用同一條 path）：設定即時重套
// 走 content script 的 chrome.storage.onChanged 廣播。iOS Safari popup 開啟時底層頁面
// 被掛起，storage.onChanged 事件被丟掉（不排隊、不補送）；桌機 Chrome 頁面在 popup
// 後仍存活故照收。→ iOS 改設定 content 收不到、不重套。
//
// 修法（結構性、非站點特判）：popup 每次 commitSave 後額外送 REAPPLY_SETTINGS 訊息給
// 當前分頁，content onMessage 收到就 scheduleReapply。runtime 訊息在 iOS 仍會送達
// （toggle reader mode 走同路徑、iPhone 可用為證），補上 onChanged 丟事件的缺口。
// scheduleReapply 從 onChanged 閉包搬到模組層、與訊息 handler 共用（單一資料源）。
//
// 訊號層次：本檔驗「訊息常數 + content handler guard + popup 送訊息」的接線。
//   不驗：iOS 真實「popup 掛起頁面 / 訊息送達」行為（靠 Jimmy iPhone 實機——屬
//   popup 互動類，harness 模擬不到）。桌機重套邏輯本身由 main-storage-debounce.spec 驗。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const NS_SRC = fs.readFileSync(path.join(ROOT, 'content', 'namespace.js'), 'utf8');
const MAIN_SRC = fs.readFileSync(path.join(ROOT, 'content', 'main.js'), 'utf8');
const POPUP_SRC = fs.readFileSync(path.join(ROOT, 'popup', 'popup.js'), 'utf8');

describe('iOS 設定即時重套 REAPPLY_SETTINGS 訊息（v0.8.148）', () => {
  it('namespace.js MSG 必須含 REAPPLY_SETTINGS', () => {
    assert.match(NS_SRC, /REAPPLY_SETTINGS:\s*'REAPPLY_SETTINGS'/,
      'namespace.js MSG 必須宣告 REAPPLY_SETTINGS 常數');
  });

  it('main.js onMessage 必須處理 REAPPLY_SETTINGS → scheduleReapply（含 active/cinema/articleEl guard）', () => {
    const idx = MAIN_SRC.indexOf('msg.type === NS.MSG.REAPPLY_SETTINGS');
    assert.ok(idx >= 0, 'onMessage 必須有 REAPPLY_SETTINGS 分支');
    const block = MAIN_SRC.slice(idx, idx + 400);
    assert.ok(/NS\.state\.active/.test(block), 'REAPPLY 分支必須 guard NS.state.active（非閱讀模式 no-op）');
    assert.ok(/cinemaActive/.test(block), 'REAPPLY 分支必須 guard cinemaActive（cinema 期間 articleEl=null）');
    assert.ok(/NS\.state\.articleEl/.test(block), 'REAPPLY 分支必須 guard articleEl');
    assert.ok(/scheduleReapply\(\)/.test(block), 'REAPPLY 分支必須呼叫 scheduleReapply()');
  });

  it('popup.js commitSave 後必須送 REAPPLY_SETTINGS 給當前分頁（onChanged 丟事件兜底）', () => {
    // commitSave 內呼叫 notifyContentReapply
    const commitIdx = POPUP_SRC.indexOf('function commitSave');
    assert.ok(commitIdx >= 0, '抓不到 commitSave');
    const commitBlock = POPUP_SRC.slice(commitIdx, commitIdx + 600);
    assert.ok(/notifyContentReapply\(\)/.test(commitBlock),
      'commitSave 必須呼叫 notifyContentReapply()（storage.set 後主動通知 content）');
    // notifyContentReapply 用 getActiveTabId + sendMessage REAPPLY_SETTINGS
    const notifyIdx = POPUP_SRC.indexOf('function notifyContentReapply');
    assert.ok(notifyIdx >= 0, '必須定義 notifyContentReapply');
    const notifyBlock = POPUP_SRC.slice(notifyIdx, notifyIdx + 400);
    assert.ok(/getActiveTabId\(\)/.test(notifyBlock), 'notifyContentReapply 必須取當前分頁 id');
    assert.ok(/sendMessage\([^)]*['"]REAPPLY_SETTINGS['"]/.test(notifyBlock.replace(/\s+/g, ' ')) ||
      /type:\s*'REAPPLY_SETTINGS'/.test(notifyBlock),
      'notifyContentReapply 必須 sendMessage type REAPPLY_SETTINGS');
    assert.ok(/catch\(/.test(notifyBlock),
      'sendMessage 必須 .catch 吞掉 reject（非注入頁 / 連不上不可拋 unhandled rejection）');
  });
});
