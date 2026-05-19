// JRead — detector isSignalExcluded 祖先鏈 cache（v0.7.144 #12）
//
// Audit：detectByHeuristic 對 500+ signals 逐一沿祖先鏈跑 closest +
// getComputedStyle，500 × 平均 10 層 = 5K 次 getComputedStyle，每次 trigger
// layout flush。許多 signals 共用同一條祖先鏈、cache 後 hit 直接 short-circuit。
//
// 修法：加 _excludedAncestorCache（WeakMap<element, boolean>），
// detectByHeuristic 入口開 cache、出口清。isSignalExcluded 沿祖先鏈遇到
// cached 祖先直接 short-circuit + back-fill 此次走過的祖先（傳遞性）。
//
// 本 spec 是 forcing function：
//   - detector.js 必須宣告 _excludedAncestorCache
//   - detectByHeuristic 必須開 cache（new WeakMap）+ try/finally 清
//   - isSignalExcluded 必須 consult cache（cache.has / cache.get）

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DETECTOR_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'), 'utf8'
);

describe('detector isSignalExcluded ancestor cache（v0.7.144 #12）', () => {
  it('detector.js 必須宣告 _excludedAncestorCache module variable', () => {
    assert.ok(/let\s+_excludedAncestorCache/.test(DETECTOR_SRC),
      'detector.js 必須宣告 let _excludedAncestorCache（祖先鏈狀態 cache）');
  });

  it('detectByHeuristic 必須開 cache（new WeakMap）', () => {
    const match = DETECTOR_SRC.match(/function\s+detectByHeuristic\s*\(\)\s*\{([\s\S]*?)\n  \}/);
    assert.ok(match, '必須能抓到 detectByHeuristic body');
    assert.ok(/_excludedAncestorCache\s*=\s*new\s+WeakMap/.test(match[1]),
      'detectByHeuristic 入口必須 `_excludedAncestorCache = new WeakMap()` 開 cache');
  });

  it('detectByHeuristic 必須用 try/finally 清 cache（即使內部 throw）', () => {
    const match = DETECTOR_SRC.match(/function\s+detectByHeuristic\s*\(\)\s*\{([\s\S]*?)\n  \}/);
    const body = match[1];
    assert.ok(/try\s*\{[\s\S]*?finally\s*\{[\s\S]*?_excludedAncestorCache\s*=\s*null/.test(body),
      'detectByHeuristic 必須用 try/finally 清 _excludedAncestorCache = null（避免 throw 後 cache 殘留 stale state）');
  });

  it('isSignalExcluded 必須 consult cache（cache.has / cache.get short-circuit）', () => {
    const match = DETECTOR_SRC.match(/function\s+isSignalExcluded[\s\S]*?\n  \}/);
    assert.ok(match, '必須能抓到 isSignalExcluded body');
    const body = match[0];
    assert.ok(/cache\.has\s*\(/.test(body),
      'isSignalExcluded 必須 check cache.has(p) 在祖先鏈 walk 中提早 short-circuit');
    assert.ok(/cache\.set\s*\(/.test(body),
      'isSignalExcluded 必須 cache.set 寫入結果（hidden / visible），給後續同祖先鏈 query 受惠');
  });

  it('isSignalExcluded 必須做 back-fill（把此次走過的祖先全標相同狀態）', () => {
    const match = DETECTOR_SRC.match(/function\s+isSignalExcluded[\s\S]*?\n  \}/);
    const body = match[0];
    // 必須含 `visited` array 累積走過的元素 + 結束時 set 給整個 visited
    assert.ok(/visited/.test(body),
      'isSignalExcluded 必須宣告 visited array 累積此次走過的祖先（傳遞性 back-fill）');
    assert.ok(/for\s*\(.+of\s+visited\)[\s\S]{0,80}cache\.set/.test(body),
      'isSignalExcluded 必須對 visited 內每個祖先做 cache.set（back-fill 傳遞性）');
  });
});
