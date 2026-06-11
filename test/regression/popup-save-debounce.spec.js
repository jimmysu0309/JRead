// JRead — popup save() debounce（v0.7.143）
//
// Bug：popup 連點 stepper 字級/版心每次 click 觸發 chrome.storage.sync.set。
// chrome.storage.sync quota：MAX_WRITE_OPERATIONS_PER_MINUTE = 120、
// MAX_WRITE_OPERATIONS_PER_HOUR = 1800。連點 fontSize 跨 20 step + contentWidth
// 跨 18 step + 觸發 storage.onChanged 廣播 → 多 tab content script 連環 reapply。
// 一分鐘內可踩 quota。
//
// 修法：save() 加 200ms debounce 合併連續 setting 變更。render 在 click 同步跑
// （UI 立刻反映）但 storage.sync.set 透過 setTimeout 延後。pendingPatch 累積
// 未 commit 欄位。pagehide + visibilitychange 強制 flush 防 popup 關閉丟失最後
// 變更（v0.8.35 起，原 beforeunload 在 action popup / iOS Safari 都不觸發）。
//
// 本 spec 是 forcing function：
//   - popup.js 必須宣告 saveTimer / pendingPatch / commitSave
//   - save() 必須用 setTimeout debounce（不可同步呼 storage.sync.set）
//   - debounce 延遲 100-500ms
//   - beforeunload listener 必須 flush pending patch

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const POPUP_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.js'), 'utf8'
);

describe('popup.js save() debounce（v0.7.143）', () => {
  it('必須宣告 saveTimer state（debounce timer）', () => {
    assert.ok(/let\s+saveTimer/.test(POPUP_SRC),
      'popup.js 必須宣告 `let saveTimer` 作為 debounce timer state');
  });

  it('必須宣告 pendingPatch（累積未 commit 欄位）', () => {
    assert.ok(/(let|const)\s+pendingPatch/.test(POPUP_SRC),
      '必須宣告 pendingPatch 物件累積連續 save 的欄位變更（合併後一次 set）');
  });

  it('必須宣告 commitSave helper（實際呼 storage.sync.set）', () => {
    assert.ok(/function\s+commitSave|commitSave\s*=/.test(POPUP_SRC),
      '必須宣告 commitSave function 封裝實際 storage.sync.set');
  });

  it('save() 必須用 setTimeout debounce（不可同步呼 storage.sync.set）', () => {
    // 抓 save() body
    const match = POPUP_SRC.match(/function\s+save\s*\(\s*patch\s*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(match, '必須能抓到 save() body');
    const body = match[1];
    assert.ok(/setTimeout/.test(body),
      'save() body 必須含 setTimeout（debounce 延後 storage.sync.set）');
    // save() body 不可直接呼 storage.sync.set（必須透過 commitSave 延後）
    assert.ok(!/chrome\.storage\.sync\.set/.test(body),
      `save() 不可直接呼 chrome.storage.sync.set —— 必須走 debounce + commitSave。實際 body:\n${body}`);
  });

  it('save() 必須先 clearTimeout（合併連續事件）', () => {
    const match = POPUP_SRC.match(/function\s+save\s*\(\s*patch\s*\)\s*\{([\s\S]*?)\n\}/);
    const body = match[1];
    assert.ok(/clearTimeout/.test(body),
      'save() 必須先 clearTimeout 舊 timer，否則無法合併連續 setting 變更');
  });

  it('debounce 延遲在 100-500ms 範圍內', () => {
    const match = POPUP_SRC.match(/setTimeout\s*\(\s*commitSave\s*,\s*(\d+)\s*\)/);
    assert.ok(match, '必須找到 setTimeout(commitSave, NNN)');
    const delay = parseInt(match[1], 10);
    assert.ok(delay >= 100 && delay <= 500,
      `debounce 延遲應在 100-500ms 範圍，實際 ${delay}ms`);
  });

  // v0.8.35：flush 改聽 pagehide + visibilitychange。Chrome action popup 關閉
  // 不走一般 navigation path、beforeunload 長期不可靠；iOS Safari 完全不支援
  // beforeunload。實際丟失場景：調完設定 200ms 內點頁面外關 popup → debounce
  // 中的 patch 靜默丟失。
  it('必須宣告 flushPendingSave 並掛 pagehide + visibilitychange（不可再用 beforeunload）', () => {
    assert.ok(/function\s+flushPendingSave/.test(POPUP_SRC),
      '必須宣告 flushPendingSave（清 timer + commitSave）');
    assert.ok(/addEventListener\s*\(\s*['"]pagehide['"]\s*,\s*flushPendingSave/.test(POPUP_SRC),
      '必須掛 pagehide → flushPendingSave');
    assert.ok(/visibilitychange[\s\S]{0,200}flushPendingSave/.test(POPUP_SRC),
      '必須掛 visibilitychange(hidden) → flushPendingSave');
    assert.ok(!/addEventListener\s*\(\s*['"]beforeunload['"]/.test(POPUP_SRC),
      'beforeunload 在 action popup / iOS Safari 都不可靠，不可再依賴');
  });

  it('自家 window.close() 路徑必須先明確 flushPendingSave（不賭 pagehide 時序）', () => {
    // toggle 按鈕與無邊模式按鈕兩條 close 路徑
    const closeCalls = POPUP_SRC.match(/window\.close\(\)/g) || [];
    const flushedCloseCalls = POPUP_SRC.match(/flushPendingSave\(\);[^\n]*\n\s*window\.close\(\)/g) || [];
    assert.strictEqual(flushedCloseCalls.length, closeCalls.length,
      `每個 window.close() 前都必須 flushPendingSave（${flushedCloseCalls.length}/${closeCalls.length}）`);
  });

  it('commitSave 必須 .catch promise rejection（MV3 set 失敗是 rejection，同步 try/catch 接不到）', () => {
    const fn = POPUP_SRC.match(/function\s+commitSave[\s\S]*?\n\}/);
    assert.ok(fn, '抓得到 commitSave body');
    assert.ok(/\.catch\s*\(/.test(fn[0]),
      'commitSave 必須對 storage.sync.set 的回傳 promise 掛 .catch（quota 失敗防 unhandled rejection）');
  });
});
