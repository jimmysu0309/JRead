// JRead — findTitleViaLca helper 合一 forcing function（v0.7.143）
//
// 動機：detector ensureArticleContainsTitleH1 與 promoteForTitle 的 LCA fallback
// 邏輯幾乎完全重複——都 query 全頁 h1/h2 → titleMatches → findLCA → guard
// body/html → return。CLAUDE.md 工作流原則 5「單一資料源」要求合一。
//
// v0.7.143 修法：抽 findTitleViaLca(articleEl, h, maxDist) helper，兩處共用。
// maxDist=5（ensureArticleContainsTitleH1 用、避免 site chrome 吞進）；
// maxDist=Infinity（promoteForTitle 用、依賴 og-match guard 不需 dist 限制）。
//
// 本 spec 是 forcing function：
//   - detector.js 必須宣告 findTitleViaLca function
//   - helper 必須含 LCA + body/html guard + dist guard 三道 check
//   - ensureArticleContainsTitleH1 與 promoteForTitle 兩處都 call 此 helper

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DETECTOR_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'), 'utf8'
);

describe('detector.js findTitleViaLca helper（v0.7.143）', () => {
  it('必須宣告 function findTitleViaLca', () => {
    assert.ok(/function\s+findTitleViaLca\s*\(/.test(DETECTOR_SRC),
      'detector.js 必須宣告 findTitleViaLca helper（單一資料源、避免兩處 LCA 邏輯 drift）');
  });

  it('findTitleViaLca body 必須含 body/html guard', () => {
    const match = DETECTOR_SRC.match(/function\s+findTitleViaLca[\s\S]*?\n  \}/);
    assert.ok(match, '必須能抓到 findTitleViaLca body');
    assert.ok(/document\.body/.test(match[0]) && /documentElement/.test(match[0]),
      'helper 必須 guard LCA 不可為 document.body / documentElement（避免吞整頁）');
  });

  it('findTitleViaLca body 必須含 dist guard（maxDist 參數支援）', () => {
    const match = DETECTOR_SRC.match(/function\s+findTitleViaLca[\s\S]*?\n  \}/);
    assert.ok(/maxDist/.test(match[0]),
      'helper 必須含 maxDist 參數（不同 caller 有不同距離容忍：5 / Infinity）');
  });

  it('ensureArticleContainsTitleH1 必須 call findTitleViaLca（取代原 LCA 重複實作）', () => {
    const fnMatch = DETECTOR_SRC.match(/function\s+ensureArticleContainsTitleH1[\s\S]*?\n  \}/);
    assert.ok(fnMatch, '必須能抓到 ensureArticleContainsTitleH1 body');
    assert.ok(/findTitleViaLca/.test(fnMatch[0]),
      'ensureArticleContainsTitleH1 必須走 findTitleViaLca helper（不可保留獨立 LCA 實作）');
  });

  it('promoteForTitle LCA fallback 區段必須 call findTitleViaLca', () => {
    const fnMatch = DETECTOR_SRC.match(/function\s+promoteForTitle[\s\S]*?\n  \}/);
    assert.ok(fnMatch, '必須能抓到 promoteForTitle body');
    assert.ok(/findTitleViaLca/.test(fnMatch[0]),
      'promoteForTitle LCA fallback 區段必須走 findTitleViaLca helper');
  });

  it('findLCA 直接呼叫只可出現在 findTitleViaLca 內部（其他兩處應走 helper）', () => {
    // 數 detector.js 內 findLCA( 出現次數（非 comment 行）
    const lines = DETECTOR_SRC.split('\n');
    let callLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\/\//.test(line)) continue;
      if (/^\s*\*/.test(line)) continue;
      if (/findLCA\s*\(/.test(line) && !/function\s+findLCA/.test(line)) {
        callLines.push({ lineNo: i + 1, line: line.trim() });
      }
    }
    // 預期：findTitleViaLca body 內呼一次。如果有兩處或更多直接呼叫，代表還有 caller 沒走 helper
    assert.strictEqual(callLines.length, 1,
      `detector.js 內 findLCA() 直接呼叫應只在 findTitleViaLca helper 內出現 1 次，實際 ${callLines.length} 次。所有其他 LCA 用法必須走 helper，避免再次 drift。命中行：${JSON.stringify(callLines)}`);
  });
});
