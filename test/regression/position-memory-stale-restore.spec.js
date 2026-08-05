// JRead — position-memory 過期 restore 回呼 guard（v1.7.39 全面 review P1）
// -----------------------------------------------------------------------------
// Bug（2026-08-05 全面 review 批次 1）：restore() 的 localGet 回呼沒驗
// session 仍有效。storage 讀取往返期間退出閱讀模式（快速 ESC / SPA 導航——
// exit 是同步的）時，過期回呼仍會：(a) memMap 被復活成殘留快照；(b) 對已
// 還原的原站頁面執行捲動；(c) 經 spaceScroll.getBlocks →
// ensureBlocksCacheInvalidators 在 uninstall 之後重掛 MutationObserver /
// ResizeObserver / resize listener（洩漏到下次進 reader 才拆）；(d) not-fresh
// 分支的 prune + rawSet 在退出後仍寫 storage。同函式的 reassert timer 本就有
// `sessionKey === key` guard，主路徑缺同款 guard（不對稱即漏洞證據）。
//
// 修法：localGet 回呼開頭 `if (sessionKey !== key) return;`。
//
// 可觀察通道：not-fresh 分支的 prune 寫入——過期 entry 存在時，restore 回呼
// 會 rawSet 整包 map。endSession 之後才 resolve 的 restore 讀取不得產生寫入。
//
// 測試設計註記：endSession → flushNow 在 memMap 未 seed 時會另開一個
// localGet（read-merge-write 的最終 flush，**刻意的**、不在本 guard 範圍——
// flush 的職責就是把退出前位置寫完）。stub 的 get 逐 index resolve，把
// restore 的 get 與 flush 的 get 分開，只驗 restore 回呼的 guard。
//
// 訊號層次：jsdom 驗 guard 邏輯（寫入通道）；真實 SPA 導航時序、observer
// 洩漏的實際影響由真機 / harness 驗。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const PM_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'position-memory.js'), 'utf8');

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><article>x</article></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const writes = [];
  const gets = []; // 依呼叫序保存 resolver，測試端逐 index resolve
  window.browser = {
    runtime: { id: 'test-ext' },
    storage: {
      local: {
        get: () => new Promise((resolve) => { gets.push(resolve); }),
        set: async (obj) => { writes.push(obj); }
      }
    }
  };
  window.__JRead = {};
  window.eval(PM_SRC);
  return {
    window, writes, gets,
    pm: window.__JRead.positionMemory,
    resolveGetAt(i, value) {
      assert.ok(typeof gets[i] === 'function', `第 ${i} 個 storage.get 應存在`);
      gets[i](value);
    }
  };
}
const tick = () => new Promise(r => setTimeout(r, 0));

// 過期 entry：ts 遠早於保存天數 → restore 回呼走 not-fresh 分支（prune + rawSet）
const staleMap = (key) => ({
  readingPositions: {
    [key]: { ts: Date.now() - 30 * 24 * 3600 * 1000, mode: 'scroll', ratio: 0.5 }
  }
});

describe('position-memory — 過期 restore 回呼 guard (v1.7.39)', () => {

  it('控制組：session 存活時 not-fresh 回呼會 prune 寫入（觀察通道有效的 sanity）', async () => {
    const { pm, writes, resolveGetAt } = setup();
    pm.beginSession('key-live', { positionMemoryDays: 3 }, null); // restore get = #0
    resolveGetAt(0, staleMap('key-live'));
    await tick();
    assert.ok(writes.some(w => w.readingPositions),
      'session 存活時過期 entry 應觸發 prune + rawSet——此通道若失效，下一個斷言是 vacuous truth');
  });

  it('endSession 之後才 resolve 的 restore 讀取：回呼必須完全 no-op（不寫 storage）', async () => {
    const { pm, writes, resolveGetAt } = setup();
    pm.beginSession('key-stale', { positionMemoryDays: 3 }, null); // restore get = #0
    pm.endSession(); // 期間使用者已退出（exit 同步；flush 另開 get = #1，不 resolve）
    const before = writes.length;
    resolveGetAt(0, staleMap('key-stale'));
    await tick();
    assert.strictEqual(writes.length, before,
      '過期 restore 回呼不得寫 storage——guard 在回呼最上方，一道擋 memMap 復活 / ' +
      '對已還原頁面捲動 / blocksCache observer 重掛三個副作用');
  });

  it('endSession 後再開新 session：新 key 的回呼照常運作（guard 不誤傷新 session）', async () => {
    const { pm, writes, resolveGetAt } = setup();
    pm.beginSession('key-a', { positionMemoryDays: 3 }, null); // restore get = #0
    pm.endSession();                                           // flush get = #1
    pm.beginSession('key-b', { positionMemoryDays: 3 }, null); // restore get = #2
    const before = writes.length;
    // 舊 session 的 restore 回呼晚到：guard 擋下、不寫
    resolveGetAt(0, staleMap('key-a'));
    await tick();
    assert.strictEqual(writes.length, before, '舊 session（key-a）的晚到回呼必須被 guard 擋下');
    // 現行 session 的回呼照常走 not-fresh prune 寫入
    resolveGetAt(2, staleMap('key-b'));
    await tick();
    assert.ok(writes.length > before, '現行 session（key-b）的回呼必須照常運作');
    pm.endSession();
  });
});
