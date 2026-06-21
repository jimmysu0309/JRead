// JRead — storage.onChanged debounce + cinema guard（v0.7.143）
//
// Bug：popup 連點 + - 觸發多次 storage.sync.set → storage.onChanged listener
// 多次 restore + await getSettings + apply 並發纏繞——originalStyles 可能 snapshot
// 已套樣式的中間狀態、最後 exit 還原不回原貌。另外 cinema mode 期間 articleEl=null，
// styler.restore null 可能 throw。
//
// 修法：
// 1. 加 debounce timer（200ms）合併連續 setting 變更
// 2. handler 入口加 cinemaActive guard，cinema 時不走 styler reapply 路徑
//
// 本 spec 是 forcing function：
//   - main.js 必須宣告 scheduleReapply helper / reapplyTimer var
//   - scheduleReapply executor body 必須含 cinemaActive guard
//   - debounce 延遲必須 100-500ms 範圍內（不可瞬間執行）
//
// v0.8.148：scheduleReapply 從 storage.onChanged 閉包內搬到模組層（onMessage 的
// REAPPLY_SETTINGS handler——iOS onChanged 丟事件的兜底——也要呼叫同一個）。本 spec
// 改從 scheduleReapply 定義處切片，並另驗 onChanged listener 仍引用它 + cinema guard。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MAIN_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8'
);

describe('main.js storage.onChanged debounce + cinema guard（v0.7.143 / v0.8.148 hoist）', () => {
  // 切出 scheduleReapply 定義區塊（v0.8.148 起在模組層，含 reapplyTimer + setTimeout body）
  let listenerBlock = '';
  before(() => {
    const idx = MAIN_SRC.search(/let\s+reapplyTimer/);
    assert.ok(idx >= 0, '必須找到 reapplyTimer 宣告（scheduleReapply 定義處）');
    // 取後 3000 字（足以涵蓋 reapplyTimer + scheduleReapply setTimeout body）
    listenerBlock = MAIN_SRC.slice(idx, idx + 3000);
  });

  it('scheduleReapply 必須在模組層（onMessage REAPPLY_SETTINGS handler 之前、可共用）', () => {
    const reapplyIdx = MAIN_SRC.search(/function\s+scheduleReapply/);
    const onMsgIdx = MAIN_SRC.search(/REAPPLY_SETTINGS\s*\)\s*\{[\s\S]{0,200}scheduleReapply\(\)/);
    assert.ok(reapplyIdx >= 0, 'scheduleReapply 必須是模組層 function 宣告');
    assert.ok(onMsgIdx >= 0, 'onMessage 必須有 REAPPLY_SETTINGS 分支呼叫 scheduleReapply()');
    assert.ok(reapplyIdx < onMsgIdx, 'scheduleReapply 必須宣告在 onMessage handler 之前（hoist 或順序皆可，此處驗順序可讀性）');
  });

  it('onChanged listener 仍引用 scheduleReapply + cinema guard（hoist 後不可斷線）', () => {
    const idx = MAIN_SRC.search(/if\s*\(\s*chrome\.storage\s*&&\s*chrome\.storage\.onChanged\s*\)/);
    assert.ok(idx >= 0, '必須找到 chrome.storage.onChanged 包裝區塊');
    const block = MAIN_SRC.slice(idx, idx + 2000);
    assert.ok(/scheduleReapply\(\)/.test(block), 'onChanged listener 必須呼叫 scheduleReapply()');
    assert.ok(/cinemaActive/.test(block), 'onChanged listener 必須仍有 cinemaActive guard');
  });

  it('storage.onChanged 包裝區塊必須宣告 reapplyTimer 變數（debounce state）', () => {
    assert.ok(/let\s+reapplyTimer/.test(listenerBlock),
      '必須宣告 `let reapplyTimer` 作為 debounce timer state');
  });

  it('必須宣告 scheduleReapply helper（封裝 debounce 邏輯）', () => {
    assert.ok(/scheduleReapply/.test(listenerBlock),
      '必須宣告 scheduleReapply helper 統一管理 debounce timer');
  });

  it('scheduleReapply 必須用 setTimeout debounce（不可同步執行）', () => {
    assert.ok(/scheduleReapply[\s\S]{0,400}setTimeout/.test(listenerBlock),
      'scheduleReapply 內必須用 setTimeout 延後執行（debounce）');
  });

  it('scheduleReapply 必須先 clearTimeout（清舊 timer 才合併連續事件）', () => {
    assert.ok(/clearTimeout\s*\(\s*reapplyTimer\s*\)/.test(listenerBlock),
      '必須含 clearTimeout(reapplyTimer)，否則無法合併連續 setting 變更');
  });

  it('debounce 延遲必須在 100-500ms 範圍內（合理區間）', () => {
    // setTimeout(async () => { ... }, 200) — callback body 含逗號（function arg list）
    // 用 non-greedy + 結尾 `}, NNN)` 收尾
    const match = listenerBlock.match(/setTimeout\s*\([\s\S]+?\},\s*(\d+)\s*\)/);
    assert.ok(match, '必須能抓到 setTimeout 延遲值');
    const delay = parseInt(match[1], 10);
    assert.ok(delay >= 100 && delay <= 500,
      `debounce 延遲應在 100-500ms 範圍內（人類連點合併但單次仍即時感），實際 ${delay}ms`);
  });

  it('storage.onChanged listener 必須 guard cinemaActive（cinema 期間 articleEl=null）', () => {
    // listener body 或 reapply executor 內必須有 cinemaActive check
    assert.ok(/cinemaActive/.test(listenerBlock),
      'storage.onChanged 區塊必須 check NS.state.cinemaActive，避免 cinema 期間（articleEl=null）跑 styler.restore null');
  });

  it('reapply executor body 必須含 cinemaActive return guard（執行前阻擋 cinema 場景）', () => {
    // 切 setTimeout callback body
    const setTimeoutMatch = listenerBlock.match(/setTimeout\s*\(\s*async[^)]*?\)\s*=>\s*\{([\s\S]*?)\},\s*\d+\s*\)/);
    assert.ok(setTimeoutMatch, '必須能抓到 setTimeout async callback');
    const callbackBody = setTimeoutMatch[1];
    // 移除註解後找 cinemaActive return
    const codeOnly = callbackBody.split('\n')
      .filter(l => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l))
      .join('\n');
    assert.ok(/cinemaActive[\s\S]{0,30}return/.test(codeOnly),
      `setTimeout callback 必須含 cinemaActive 短路 return（執行前 guard cinema 場景，articleEl=null 時 styler.restore 會出問題）。實際 codeOnly:\n${codeOnly}`);
  });
});
