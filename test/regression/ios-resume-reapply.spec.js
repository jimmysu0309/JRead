// JRead — 頁面恢復重讀 storage 重套設定 forcing function（v0.8.164）
//
// Bug（Jimmy 2026-06-22 iPhone 回報，與 [[project_jread_messaging_less_reliable_chrome_vs_browser]]
// 同家族）：popup 內套設定（字體 +/-、主題）常沒反應、要重整網頁才生效。
//
// 根因（memory project_ios_popup_suspends_page_onchanged_dropped）：iOS Safari popup
// 開啟時底層頁面 JS 被掛起，期間 storage.onChanged 廣播被丟掉（不排隊不補送）；改的
// 設定其實已 storage.sync.set 持久化，但 content 收不到變更→不重套。popup 主動送的
// REAPPLY_SETTINGS（v0.8.148）是第一道兜底，但 iOS 偶發回收整個擴充訊息層時連那發也掉。
//
// 修法（結構性、不依賴訊息送達）：content 在「頁面恢復可見」時自己重讀 storage 重套
//   - window pageshow（含 bfcache restore）
//   - document visibilitychange → visibilityState === 'visible'（popup 收合主訊號）
// 兩者都呼叫 reapplyFromStorageOnResume()，內部 guard 閱讀模式 active / 非 cinema /
// articleEl / styler 後呼 scheduleReapply()——scheduleReapply 內 await getSettings()
// 直讀 browser.storage.sync 拿最新值，故「只要 popup 改過設定（已落 storage），回到
// 頁面就重套」。與 browser.* Promise 遷移（v0.8.164）互補：訊息層更可靠 + 恢復時自我修正。
//
// 訊號層次：本檔驗「listener 存在 + guard + 走 scheduleReapply」的接線（source 結構）。
//   不驗：iOS 真實「popup 掛起頁面 / pageshow / visibility 時序」行為——屬 popup 互動 +
//   平台掛起時序，harness 模擬不到，只能 Jimmy iPhone / TestFlight 實機驗。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MAIN_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8');

describe('頁面恢復重讀 storage 重套設定（v0.8.164 iOS 訊息不可靠兜底）', () => {
  it('main.js 必須宣告 reapplyFromStorageOnResume，guard active/cinema/articleEl/styler 後呼 scheduleReapply', () => {
    const idx = MAIN_SRC.indexOf('function reapplyFromStorageOnResume');
    assert.ok(idx >= 0, 'main.js 必須定義 reapplyFromStorageOnResume');
    const block = MAIN_SRC.slice(idx, idx + 300);
    assert.ok(/NS\.state\.active/.test(block), '必須 guard NS.state.active（非閱讀模式 no-op）');
    assert.ok(/cinemaActive/.test(block), '必須 guard cinemaActive（cinema 期間 articleEl=null）');
    assert.ok(/NS\.state\.articleEl/.test(block), '必須 guard articleEl');
    assert.ok(/scheduleReapply\(\)/.test(block), '必須呼叫 scheduleReapply()（內部 await getSettings 重讀 storage）');
  });

  it('main.js 必須掛 window pageshow listener 觸發 reapplyFromStorageOnResume', () => {
    const re = /addEventListener\(\s*['"]pageshow['"][\s\S]{0,80}?reapplyFromStorageOnResume/;
    assert.ok(re.test(MAIN_SRC),
      'window pageshow（含 bfcache restore）必須呼叫 reapplyFromStorageOnResume');
  });

  it('main.js 必須掛 visibilitychange listener、在 visible 時觸發 reapplyFromStorageOnResume', () => {
    const idx = MAIN_SRC.indexOf("addEventListener('visibilitychange'");
    // 找「呼叫 reapplyFromStorageOnResume 的那個 visibilitychange」（與 pagehide flush 等其他用途區分）
    const matches = [...MAIN_SRC.matchAll(/addEventListener\(\s*['"]visibilitychange['"][\s\S]{0,160}?\}\s*\)/g)];
    const resumeOne = matches.find(m => /reapplyFromStorageOnResume/.test(m[0]));
    assert.ok(resumeOne, 'visibilitychange listener 必須有一個呼叫 reapplyFromStorageOnResume');
    assert.ok(/visibilityState\s*===\s*['"]visible['"]/.test(resumeOne[0]),
      'visibilitychange 必須 gate visibilityState === "visible"（只在恢復可見時重套）');
  });

  it('scheduleReapply 透過 getSettings 重讀 storage（不沿用 stale 設定）', () => {
    const idx = MAIN_SRC.indexOf('function scheduleReapply');
    assert.ok(idx >= 0, 'main.js 必須有 scheduleReapply');
    const block = MAIN_SRC.slice(idx, idx + 900);
    assert.ok(/await\s+getSettings\(\)/.test(block),
      'scheduleReapply 必須 await getSettings()——直讀 browser.storage.sync 拿最新值，恢復重套才會反映 popup 的變更');
  });
});
