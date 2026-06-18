// JRead — popup toggle 失敗訊息 regression（v0.8.115）
//
// Jimmy 2026-06-18：iPhone 上偶發「三指能切換閱讀模式、但 popup 狀態對不上、
// 按 popup 按鈕也無法切換，只能完全關閉 Safari 才復原」。根因是 iOS Safari 把
// 擴充訊息層（SW / WebKit 擴充基礎設施程序）回收後不再喚醒（Apple Forums
// 758346）：sendMessage / executeScript 都石沉大海，但 content script 仍活、
// 三指手勢（content 本地派送、零訊息）仍可切換。訊息層本身救不回來（同 macOS
// WPA 鍵盤軌 WONTFIX 家族），但 popup 失敗時的訊息可以誠實——區分「真的不支援
// 的頁面」vs「可注入頁但連不上」，後者導向可靠逃生口（三指手勢 / 重新整理），
// 不再誤報「此頁無法啟動」害使用者誤判頁面壞掉。
//
// 純函式 toggleFailureMessage 住 popup-core.js（可 require 單元測試）；另以
// string-match forcing function 鎖住 popup.js 確實有 wire（避免變死 code）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const core = require('../../jread/popup/popup-core.js');
const POPUP_JS = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.js'),
  'utf8'
);

describe('popup v0.8.115 — toggle 失敗訊息區分「不支援」vs「連不上」', () => {
  it('toggleFailureMessage 已 export', () => {
    assert.strictEqual(typeof core.toggleFailureMessage, 'function');
  });

  it('非可注入頁（injectable=false）→ 真的不支援的訊息', () => {
    assert.strictEqual(
      core.toggleFailureMessage({ injectable: false, touch: true }),
      '此頁面無法啟動閱讀模式');
    // touch 與否都一樣（非 http(s) 頁不存在三指逃生口）
    assert.strictEqual(
      core.toggleFailureMessage({ injectable: false, touch: false }),
      '此頁面無法啟動閱讀模式');
  });

  it('可注入 + 觸控裝置 → 導向三指手勢（iOS 偶發卡死的逃生口）', () => {
    const msg = core.toggleFailureMessage({ injectable: true, touch: true });
    assert.match(msg, /無法連線/, '須點出是連線問題、不是頁面不支援');
    assert.match(msg, /三指/, '觸控裝置須導向三指手勢——卡死時唯一可靠的切換通道');
  });

  it('可注入 + 非觸控（桌面）→ 不提三指、只導向重新整理', () => {
    const msg = core.toggleFailureMessage({ injectable: true, touch: false });
    assert.match(msg, /無法連線/);
    assert.match(msg, /重新整理/);
    assert.ok(!/三指/.test(msg), '桌面無三指手勢，提三指會誤導');
  });

  it('段末不留句號（CLAUDE.md 硬規則 7）', () => {
    for (const opts of [
      { injectable: false, touch: true },
      { injectable: true, touch: true },
      { injectable: true, touch: false }
    ]) {
      const msg = core.toggleFailureMessage(opts);
      assert.ok(!/。$/.test(msg), `「${msg}」段末不可留句號`);
    }
  });

  it('popup.js toggle 失敗路徑必須呼叫 toggleFailureMessage（forcing：不可退回固定文字）', () => {
    assert.match(POPUP_JS, /toggleFailureMessage\s*\(/,
      'popup.js 須呼叫 __JReadPopup.toggleFailureMessage');
    assert.match(POPUP_JS, /injectable:\s*!!urlInfo/,
      'injectable 須由 getActiveTabUrlInfo（只認 http(s)）決定');
    assert.match(POPUP_JS, /touch:\s*\(navigator\.maxTouchPoints/,
      '三指提示須 gate 在 popup 自身觸控能力');
  });
});
