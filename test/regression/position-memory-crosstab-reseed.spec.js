// JRead — position-memory v1.6.24：跨分頁 memMap re-seed
//
// 根因：iOS 背景凍結防護的同步寫入路徑（v1.5.9）用「進場 restore 時 seed 的
// memMap 快照 + 本分頁 entry」整包覆蓋 readingPositions，seed 之後整個 session
// 不再重讀 storage。分頁 A（seed 於 t0）與分頁 B 同時在閱讀時：B 在 t1 存了
// 位置，A 在 t2 任一次 save 都用 t0 快照整包寫回 → B 的 entry 被抹掉；B 再寫回
// 又抹掉 A（跨分頁 last-writer-wins）。
//
// 修法：visibilitychange → visible 時重新 localGet seed memMap。可見時 event
// loop 未凍結、async 讀取安全（凍結防護只影響 hidden 路徑）；本分頁最後位置已
// 在轉 hidden 時 flush 落盤，重讀不掉自己的資料。
//
// 訊號層次：jsdom 驗「visible 重 seed 後，flush 寫出的整包 map 保留其他分頁的
// entry」；真實多分頁時序 / iOS 凍結行為由真機驗。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const PM_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'position-memory.js'), 'utf8'
);

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><article>x</article></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const store = {}; // 模擬 chrome.storage.local 的 readingPositions
  const writes = [];
  window.browser = {
    runtime: { id: 'test-ext' },
    storage: {
      local: {
        get: async () => ({ readingPositions: { ...store } }),
        set: async (obj) => {
          writes.push(obj);
          if (obj.readingPositions) {
            for (const k of Object.keys(store)) delete store[k];
            Object.assign(store, obj.readingPositions);
          }
        }
      }
    }
  };
  window.__JRead = {}; // position-memory 掛 NS 用（無 pagedMode / spaceScroll → capture 走 scroll 路徑）
  let visState = 'visible';
  Object.defineProperty(window.document, 'visibilityState', { configurable: true, get: () => visState });
  window.eval(PM_SRC);
  return {
    window, store, writes,
    pm: window.__JRead.positionMemory,
    setVisibility(v) {
      visState = v;
      window.document.dispatchEvent(new window.Event('visibilitychange'));
    }
  };
}
const tick = () => new Promise(r => setTimeout(r, 0));

describe('position-memory v1.6.24 — 跨分頁 memMap re-seed', () => {
  it('可見時其他分頁寫入的 entry，flush 整包寫回時必須保留', async () => {
    const { store, writes, pm, setVisibility } = setup();
    pm.beginSession('tab-a-key', { positionMemoryDays: 3 }, null);
    await tick(); // restore 的 localGet 回來、seed memMap（此刻 store 為空）

    // 模擬分頁 B 存了位置（seed 之後才寫入——舊版 memMap 快照看不到它）
    store['tab-b-key'] = { ts: Date.now(), mode: 'scroll', ratio: 0.5, blockIndex: 3, blockText: '第二分頁段落' };

    // 本分頁切走再切回（或 popup 收合）→ visible re-seed
    setVisibility('visible');
    await tick();

    // 轉 hidden → flushNow → 同步路徑用 memMap 整包寫回
    setVisibility('hidden');
    await tick();

    const last = writes.filter(w => w.readingPositions).pop();
    assert.ok(last, 'flush 必須有整包寫出');
    assert.ok(last.readingPositions['tab-b-key'],
      '其他分頁的 entry 被整包覆蓋抹掉——memMap 沒有在 visible 時重新 seed（跨分頁 last-writer-wins）');
  });

  it('endSession 後 memMap 清空、visible 事件不再 re-seed（無 session 不動作）', async () => {
    const { writes, pm, setVisibility } = setup();
    pm.beginSession('tab-a-key', { positionMemoryDays: 3 }, null);
    await tick();
    pm.endSession();
    const n = writes.length;
    setVisibility('visible');
    await tick();
    setVisibility('hidden');
    await tick();
    assert.strictEqual(writes.length, n,
      'session 結束後 visibilitychange 不得再觸發任何寫入（listener 已移除）');
  });
});
