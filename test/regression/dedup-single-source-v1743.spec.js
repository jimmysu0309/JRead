// v1.7.43 批次 5（T3-T6）：drift 家族收斂的結構 forcing spec
// -----------------------------------------------------------------------------
// 2026-08-05 全面 review 盤出多組「同一份事實多份逐字拷貝」。收斂成共用函式後，
// 本 spec 掃原始碼確保：共用函式存在、call site 數量正確、舊拷貝 pattern 不得
// 回流（有人 copy-paste 舊寫法回來即 fail）。行為由既有各站 fixture spec 覆蓋，
// 此處只守結構。
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '../../jread/content', p), 'utf8');
const count = (src, re) => (src.match(re) || []).length;

describe('v1.7.43 dedup 單一資料源（結構 forcing）', () => {
  const STYLER = read('styler.js');
  const CLEANER = read('cleaner.js');

  it('T3：styler isMultiColumnContainer 一份定義、三處使用、舊拷貝不得回流', () => {
    assert.strictEqual(count(STYLER, /const isMultiColumnContainer = /g), 1);
    assert.ok(count(STYLER, /isMultiColumnContainer\(cs\)/g) >= 3,
      'decolumnFrom / stackLopsidedImgCol / overflow-right 三處都應走 isMultiColumnContainer');
    assert.strictEqual(count(STYLER, /const isGridMulti = /g), 0,
      '舊 isFlexRow/isGridMulti 逐字拷貝不得回流');
  });

  it('T4：styler firstVisibleH1 一份定義、可見性判定不得再各自實作', () => {
    assert.strictEqual(count(STYLER, /function firstVisibleH1\(/g), 1);
    assert.ok(count(STYLER, /firstVisibleH1\(articleEl\)/g) >= 3,
      'firstInk fallback（titleFontSize / hero floor）與 kicker 錨點都應走 firstVisibleH1');
    assert.strictEqual(count(STYLER, /querySelector\('h1:not\(\[data-jread-hidden/g), 0,
      '「只查 attribute」的舊弱化判定不得回流');
  });

  it('T5：cleaner makeSanitizedTitleClone 一份定義、兩條 promote path 都走它', () => {
    assert.strictEqual(count(CLEANER, /function makeSanitizedTitleClone\(/g), 1);
    assert.strictEqual(count(CLEANER, /= makeSanitizedTitleClone\(wrapper\);/g), 2,
      'promoteUniqueTitleH1Into 與 promoteArticleTitleClassHeadingInto 都應走共用函式');
    // sanitizeTitleClone 只該在共用函式內被呼叫一次（promote path 不得繞過）
    assert.strictEqual(count(CLEANER, /sanitizeTitleClone\(clone\);/g), 1);
  });

  it('T6：cleaner siblingHasMediaEmbed 一份定義、三處 guard 都走它', () => {
    assert.strictEqual(count(CLEANER, /function siblingHasMediaEmbed\(/g), 1);
    assert.strictEqual(count(CLEANER, /siblingHasMediaEmbed\(el\)\) continue;/g), 3,
      'empty-spacer / empty-wrapper collapse / padding cap 三處 guard 都應走共用函式');
    assert.strictEqual(count(CLEANER, /let siblingHasMedia = false/g), 0,
      '舊逐字拷貝不得回流');
  });

  it('T11：cleaner classStrOf 統一 class 讀取、SVG-unsafe 舊寫法不得回流', () => {
    assert.strictEqual(count(CLEANER, /function classStrOf\(/g), 1);
    // 排除註解行（classStrOf 上方註解引用了舊寫法字面做說明）
    const codeOnly = CLEANER.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.strictEqual(count(codeOnly, /\.className \|\| ''\)\.toString\(\)/g), 0,
      '`(el.className || \'\').toString()` 對 SVG 得垃圾字串，一律走 classStrOf');
  });
});
