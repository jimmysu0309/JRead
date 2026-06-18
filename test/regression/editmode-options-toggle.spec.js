// JRead — 編輯模式 options 開關（editModeEnabled，v0.8.109）
//
// 關閉時 popup 不顯示「編輯模式：移除雜訊」按鈕。四處 wire-up 的 forcing
// function（settings-defaults 預設值 + options.html checkbox + options.js
// fields/讀寫 + popup gate）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const JREAD = path.join(__dirname, '..', '..', 'jread');
const read = (p) => fs.readFileSync(path.join(JREAD, p), 'utf8');

describe('編輯模式 options 開關 editModeEnabled（v0.8.109）', () => {
  it('settings-defaults.js 預設 editModeEnabled: true（預設顯示按鈕）', () => {
    const defaults = require(path.join(JREAD, 'content', 'settings-defaults.js'));
    assert.strictEqual(defaults.editModeEnabled, true);
  });

  it('options.html 有 #editModeEnabled checkbox + label', () => {
    const html = read('options/options.html');
    assert.ok(/id="editModeEnabled"/.test(html), 'options.html 須有 #editModeEnabled');
    assert.ok(/type="checkbox"[^>]*id="editModeEnabled"|id="editModeEnabled"[^>]*type="checkbox"|<input type="checkbox" id="editModeEnabled">/.test(html),
      '#editModeEnabled 須為 checkbox');
  });

  it('options.js fields 含 editModeEnabled 且讀 el.checked、套用預設 ON（value !== false）', () => {
    const js = read('options/options.js');
    assert.ok(/fields = \[[^\]]*'editModeEnabled'/.test(js), 'fields 陣列須含 editModeEnabled');
    assert.ok(/case 'editModeEnabled'/.test(js), 'readFieldFromDom 須處理 editModeEnabled（el.checked）');
    assert.ok(/id === 'editModeEnabled'/.test(js) && /value !== false/.test(js),
      'applyFieldToDom 須對 editModeEnabled 用 value !== false（預設勾選）');
  });

  it('popup.js 依 editModeEnabled gate 編輯按鈕顯隱', () => {
    const js = read('popup/popup.js');
    assert.ok(/isEditModeEnabled/.test(js), 'popup.js 須有 isEditModeEnabled 讀取');
    assert.ok(/editModeEnabled/.test(js), 'popup.js 須讀 editModeEnabled 設定');
    assert.ok(/await isEditModeEnabled\(\)/.test(js), 'editBtn 顯隱條件須含 await isEditModeEnabled()');
  });
});
