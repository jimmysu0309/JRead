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

  it('detectByHeuristic 必須開 cache（v0.8.38 起經 withAncestorCache helper）', () => {
    const match = DETECTOR_SRC.match(/function\s+detectByHeuristic\s*\(\)\s*\{([\s\S]*?)\n  \}/);
    assert.ok(match, '必須能抓到 detectByHeuristic body');
    assert.ok(/withAncestorCache\(/.test(match[1]),
      'detectByHeuristic 必須走 withAncestorCache（cache 開關單一資料源）');
    const helper = DETECTOR_SRC.match(/function\s+withAncestorCache[\s\S]*?\n  \}/);
    assert.ok(helper && /_excludedAncestorCache\s*=\s*new\s+WeakMap/.test(helper[0]),
      'withAncestorCache 必須開 new WeakMap cache');
    // v0.8.38：article-tag / schema-org 也必須 cache-scoped（scoredTextLen 不再裸跑）
    for (const fn of ["detectByArticleTag", "detectBySchemaOrg"]) {
      const m2 = DETECTOR_SRC.match(new RegExp("function\\s+" + fn + "\\s*\\(\\)\\s*\\{([\\s\\S]*?)\\n  \\}"));
      assert.ok(m2 && /withAncestorCache\(/.test(m2[1]), fn + " 必須走 withAncestorCache");
    }
  });

  it('withAncestorCache 必須用 try/finally 清 cache（即使內部 throw）', () => {
    const match = DETECTOR_SRC.match(/function\s+withAncestorCache\s*\(fn\)\s*\{([\s\S]*?)\n  \}/);
    const body = match[1];
    assert.ok(/try\s*\{[\s\S]*?finally\s*\{[\s\S]*?_excludedAncestorCache\s*=\s*null/.test(body),
      'detectByHeuristic 必須用 try/finally 清 _excludedAncestorCache = null（避免 throw 後 cache 殘留 stale state）');
  });

  // v0.8.19 C2：祖先鏈 hidden 的 cache walk 從 isSignalExcluded 抽到共用
  // isAncestorChainHidden（同時供 article-tag / schema-org / main-tag textLen
  // 計分用）。isSignalExcluded 改成 ARIA closest + 委派 isAncestorChainHidden。
  it('isAncestorChainHidden 必須 consult cache（cache.has / cache.set short-circuit）', () => {
    const match = DETECTOR_SRC.match(/function\s+isAncestorChainHidden[\s\S]*?\n  \}/);
    assert.ok(match, '必須能抓到 isAncestorChainHidden body');
    const body = match[0];
    assert.ok(/cache\.has\s*\(/.test(body),
      'isAncestorChainHidden 必須 check cache.has(p) 在祖先鏈 walk 中提早 short-circuit');
    assert.ok(/cache\.set\s*\(/.test(body),
      'isAncestorChainHidden 必須 cache.set 寫入結果（hidden / visible），給後續同祖先鏈 query 受惠');
  });

  it('isAncestorChainHidden 必須做 back-fill（把此次走過的祖先全標相同狀態）', () => {
    const match = DETECTOR_SRC.match(/function\s+isAncestorChainHidden[\s\S]*?\n  \}/);
    const body = match[0];
    // 必須含 `visited` array 累積走過的元素 + 結束時 set 給整個 visited
    assert.ok(/visited/.test(body),
      'isAncestorChainHidden 必須宣告 visited array 累積此次走過的祖先（傳遞性 back-fill）');
    assert.ok(/for\s*\(.+of\s+visited\)[\s\S]{0,80}cache\.set/.test(body),
      'isAncestorChainHidden 必須對 visited 內每個祖先做 cache.set（back-fill 傳遞性）');
  });

  it('isSignalExcluded 必須委派 isAncestorChainHidden（ARIA closest + 共用 hidden predicate）', () => {
    const match = DETECTOR_SRC.match(/function\s+isSignalExcluded[\s\S]*?\n  \}/);
    assert.ok(match, '必須能抓到 isSignalExcluded body');
    assert.ok(/isAncestorChainHidden\s*\(/.test(match[0]),
      'isSignalExcluded 必須委派 isAncestorChainHidden（hidden 判定單一資料源）');
  });
});
