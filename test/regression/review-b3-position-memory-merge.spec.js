// JRead — v1.7.41（review 批次 3 P2）：跨分頁 readingPositions 互抹修法
// -----------------------------------------------------------------------------
// 根因：persistNow 的同步路徑用「進場 seed 的 memMap 快照」整包覆蓋
// readingPositions。兩分頁同時可見（並排視窗 / Split View）時 visibilitychange
// 不觸發、v1.6.24 的可見時 re-seed 接不到——A 分頁關閉後，B 分頁持續以缺
// A entry 的 stale 快照整包寫回 → A 的閱讀位置永久遺失。
//
// 修法：session 期間掛 storage.onChanged，其他分頁的寫入即時以 mergeExternalMap
// 合併進 memMap（storage newValue 為基底、自己的 entry 取 ts 較新者保留）。
//
// 訊號層次：本 spec 驗合併邏輯（純函式）+ 交錯寫入情境模擬 + listener 掛載
// forcing；真實跨分頁 IPC 由 Chrome storage 事件保證、不在 jsdom 可驗範圍。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const pm = require(path.join(ROOT, 'jread', 'content', 'position-memory.js'));
const PM_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'position-memory.js'), 'utf8');

describe('position-memory v1.7.41 — mergeExternalMap（P2）', () => {
  it('其他分頁的 entry 全收、自己較新的 entry 不被蓋回', () => {
    const mem = { own: { ts: 100, mode: 'scroll', ratio: 0.5 }, stale: { ts: 1 } };
    const incoming = { other: { ts: 200, mode: 'paged', page: 3 }, own: { ts: 50, ratio: 0.1 } };
    const merged = pm.mergeExternalMap(mem, incoming, 'own');
    assert.deepStrictEqual(merged.other, { ts: 200, mode: 'paged', page: 3 },
      '其他分頁的 entry 必須進 memMap（下次整包寫回不再抹掉對方）');
    assert.strictEqual(merged.own.ts, 100,
      '自己較新的 entry（剛捲動、debounce 未 flush）不得被 storage 舊值蓋回');
    assert.ok(!('stale' in merged),
      '不在 incoming 的舊 memMap entry 不保留（以 storage 為基底，避免復活已被他方刪除的 entry）');
  });

  it('storage 端自己的 entry 較新（他分頁 merge 過的回寫）→ 用 storage 版', () => {
    const mem = { own: { ts: 100 } };
    const merged = pm.mergeExternalMap(mem, { own: { ts: 300, ratio: 0.9 } }, 'own');
    assert.strictEqual(merged.own.ts, 300);
  });

  it('incoming 缺席 / memMap 無自己 entry 的邊界不炸', () => {
    assert.deepStrictEqual(pm.mergeExternalMap({ a: { ts: 1 } }, null, 'a'), { a: { ts: 1 } });
    assert.deepStrictEqual(pm.mergeExternalMap(null, { b: { ts: 2 } }, 'x'), { b: { ts: 2 } });
  });

  it('情境模擬：A 分頁寫入 → B 分頁 merge 後整包寫回，A 的 entry 不遺失', () => {
    // A 分頁：寫入自己的位置（整包覆蓋語意）
    const rA = pm.computeNextMap({}, 'urlA', { mode: 'scroll', ratio: 0.4, blockIndex: 2, blockText: 'x' }, 1000, 3, 100);
    // B 分頁 stale 快照（進場時 seed、不含 A）
    let memB = {};
    // B 收到 A 寫入的 onChanged → merge
    memB = pm.mergeExternalMap(memB, rA.next, 'urlB');
    // B 自己寫位置（以 merge 後的 memMap 整包覆蓋）
    const rB = pm.computeNextMap(memB, 'urlB', { mode: 'scroll', ratio: 0.7, blockIndex: 5, blockText: 'y' }, 2000, 3, 100);
    assert.ok(rB.next.urlA, 'B 整包寫回後 A 的 entry 必須還在（舊行為：被 stale 快照抹掉）');
    assert.ok(rB.next.urlB, 'B 自己的 entry 也在');
  });
});

describe('position-memory v1.7.41 — onChanged 掛載 forcing（P2）', () => {
  it('installListeners 必須掛 storage.onChanged(onStorageChanged)、removeListeners 對稱移除', () => {
    assert.match(PM_SRC, /function onStorageChanged\(changes, area\)/,
      '必須宣告 onStorageChanged');
    const install = PM_SRC.match(/function installListeners\(\)[\s\S]*?\n  \}/)[0];
    assert.match(install, /onChanged\.addListener\(onStorageChanged\)/,
      'installListeners 必須掛 storage.onChanged');
    const remove = PM_SRC.match(/function removeListeners\(\)[\s\S]*?\n  \}/)[0];
    assert.match(remove, /onChanged\.removeListener\(onStorageChanged\)/,
      'removeListeners 必須對稱移除（session 外不合併）');
  });

  it('onStorageChanged 必須驗 area=local + session 有效 + 走 mergeExternalMap', () => {
    const m = PM_SRC.match(/function onStorageChanged[\s\S]*?\n  \}/)[0];
    assert.match(m, /area !== 'local'/, '必須過濾非 local area');
    assert.match(m, /!sessionKey \|\| !memMap/, 'session 未開始 / memMap 未 seed 時 no-op');
    assert.match(m, /mergeExternalMap\(memMap, changes\[STORAGE_KEY\]\.newValue, sessionKey\)/,
      '必須以 mergeExternalMap 合併（單一資料源）');
  });
});
