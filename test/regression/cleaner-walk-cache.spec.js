// JRead — cleaner.js articleEl.querySelectorAll('*') 共用 cache（v0.7.144）
//
// Audit #11：cleaner 內原 8 處（rule 各自）跑 articleEl.querySelectorAll('*')。
// 對 5K element 主文 = 8 趟 tree walk + 8 份 NodeList allocation、啟動延遲拖累。
//
// 修法：加 _cachedArticleAll + _getArticleAllElements helper。clean() 開頭設 null
// 強制重建（避免 SPA 多 articleEl 拿 stale array）、結尾清 null（釋放 GC root）。
// 8 處 rule 全改走 _getArticleAllElements(articleEl) cache。
//
// 本 spec 是 forcing function：
//   - cleaner.js 必須宣告 _cachedArticleAll + _getArticleAllElements
//   - articleEl.querySelectorAll('*') 直接呼叫剩 0（不含 cache helper 內 1 次）
//   - clean() 入口必須 reset cache（_cachedArticleAll = null）
//   - clean() 結束必須清 cache（避免 array refs 被 hold）

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
);

describe('cleaner.js walk cache（v0.7.144 #11）', () => {
  it('必須宣告 _cachedArticleAll module-internal cache', () => {
    assert.ok(/let\s+_cachedArticleAll/.test(CLEANER_SRC),
      'cleaner.js 必須宣告 let _cachedArticleAll 作為 module-internal cache');
  });

  it('必須宣告 _getArticleAllElements helper', () => {
    assert.ok(/function\s+_getArticleAllElements\s*\(/.test(CLEANER_SRC),
      'cleaner.js 必須宣告 _getArticleAllElements helper');
  });

  it('_getArticleAllElements 必須做 cache check（hit 時不重 build）', () => {
    const m = CLEANER_SRC.match(/function\s+_getArticleAllElements\s*\([\s\S]*?\n  \}/);
    assert.ok(m, '必須能抓到 _getArticleAllElements body');
    assert.ok(/if\s*\(\s*_cachedArticleAll\s*\)/.test(m[0]),
      'helper 必須先 check cache 是否存在（避免每次 call 都重 build）');
  });

  it('clean() 入口必須 reset cache 為 null（避免 stale array）', () => {
    const m = CLEANER_SRC.match(/clean\s*\(\s*articleEl[\s\S]{0,500}/);
    assert.ok(m, '必須能抓到 clean() body 開頭');
    assert.ok(/_cachedArticleAll\s*=\s*null/.test(m[0]),
      'clean() 開頭必須 reset _cachedArticleAll = null（避免 SPA 多 articleEl 拿 stale array）');
  });

  it('clean() 結束區段必須清 cache（GC 友好）', () => {
    // 找到 watchHiddenInlineRestyle(hidden) 之後到 return 之間
    // （v0.8.36 起該呼叫包在 safeRun 內，regex 同時吃兩種形狀）
    const m = CLEANER_SRC.match(/(?:safeRun\()?watchHiddenInlineRestyle,?\s*\(?hidden\);[\s\S]{0,300}return\s+hidden;/);
    assert.ok(m, '必須能抓到 clean() 結束區段');
    assert.ok(/_cachedArticleAll\s*=\s*null/.test(m[0]),
      'clean() 結束區段（watchHiddenInlineRestyle 與 return 之間）必須清 _cachedArticleAll = null');
  });

  it('articleEl.querySelectorAll(\'*\') 直接呼叫（非註解）剩 1 次（cache helper 內 build）', () => {
    const lines = CLEANER_SRC.split('\n');
    let directCalls = 0;
    const callLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\/\//.test(line)) continue;
      if (/^\s*\*/.test(line)) continue;
      if (/articleEl\.querySelectorAll\(['"]\*['"]\)/.test(line)) {
        directCalls++;
        callLines.push({ lineNo: i + 1, line: line.trim() });
      }
    }
    assert.strictEqual(directCalls, 1,
      `articleEl.querySelectorAll('*') 直接呼叫應該恰好 1 次（cache helper _getArticleAllElements 內 Array.from(articleEl.querySelectorAll('*')) build）。實際 ${directCalls} 次。命中行：${JSON.stringify(callLines)}。新增的 rule 必須走 _getArticleAllElements(articleEl) cache、不可直接呼。`);
  });

  it('_getArticleAllElements call site >= 5 次（驗證 cache 真的被用）', () => {
    const matches = CLEANER_SRC.match(/_getArticleAllElements\s*\(/g) || [];
    // helper 自己宣告 1 次 + cache check 用 _cachedArticleAll 1 次（不算 _getArticleAllElements call）
    // 所以 _getArticleAllElements 應出現 = 1 宣告 + N call sites
    assert.ok(matches.length >= 6,
      `_getArticleAllElements 應該至少出現 6 次（1 宣告 + 5+ 個 rule 內 call），實際 ${matches.length}`);
  });
});
