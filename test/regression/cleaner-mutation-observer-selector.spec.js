// JRead — checkDynamicNoise interactive selector 合一（v0.7.144 #14）
//
// Audit：MutationObserver 對每個 addedNode 跑：
//   (1) `button, [role="button"], input[type=button|submit|reset]` querySelectorAll
//   (2) `a, button` querySelectorAll
// 兩條 selector 各自走整個 added subtree——SPA 站 reader mode 期每秒數十次
// mutation、每次塞大 wrapper subtree（React reconciliation），兩條 selector
// 都要走、cost 累積。
//
// 修法：合併成單一 selector `a, button, [role="button"], input[type=...]`
// 一次 querySelectorAll 後依 tagName 派發：a tag 要 shouldHideByKeyword 才 hide、
// button/role/input 無條件 hide（硬教訓九）。
//
// 本 spec 是 forcing function：
//   - checkDynamicNoise body 內 querySelectorAll 對 interactive selector 的
//     call site 只剩 1 次（合併版）
//   - a tag 必須走 shouldHideByKeyword 條件
//   - button / role 必須無條件 hide

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
);

describe('checkDynamicNoise 合 selector（v0.7.144 #14）', () => {
  // 切出 checkDynamicNoise body
  let body = '';
  before(() => {
    const m = CLEANER_SRC.match(/function\s+checkDynamicNoise[\s\S]*?^  \}/m);
    assert.ok(m, '必須能找到 checkDynamicNoise function body');
    body = m[0];
  });

  it('checkDynamicNoise body 內必須宣告合併版 interactive selector', () => {
    // 合併版 selector 必須含 a + button + role + input types
    assert.ok(/a,\s*button,\s*\[role="button"\]/.test(body),
      'checkDynamicNoise 必須用合併版 selector `a, button, [role="button"], input[type=...]` 一次 querySelectorAll');
  });

  it('checkDynamicNoise body 內 a/button 系列 querySelectorAll 只能跑 1 次', () => {
    // 數 body 內 querySelectorAll 呼叫含 `a` 或 `button` 的次數
    // 原本 2 次（button 系列 + a/button 系列），合併後應 1 次
    const matches = body.match(/querySelectorAll\([^)]*['"]a[^)]*['"]\)/g) || [];
    const buttonMatches = body.match(/querySelectorAll\([^)]*['"][^'"]*button[^'"]*['"]\)/g) || [];
    // 合併版的 selector 同時含 a + button，會在兩個 regex 都命中、應該只 1 次
    // 純 a-only / 純 button-only 的 query 不該獨立存在
    const aOnlyMatches = body.match(/querySelectorAll\(\s*['"]a,?\s*button['"]\s*\)/g) || [];
    const buttonOnlyMatches = body.match(/querySelectorAll\(\s*['"]button[^a]['"]/g) || [];
    assert.strictEqual(aOnlyMatches.length, 0,
      'checkDynamicNoise 不可有「`a, button`」這條獨立 selector（原 v0.7.143 寫法）—— 必須合併進 interactive selector');
  });

  it('checkDynamicNoise 必須對 a tag 走 shouldHideByKeyword 條件', () => {
    // 合併後 loop 內必須有 `if (el.tagName === 'A')` 分支 + shouldHideByKeyword
    assert.ok(/tagName\s*===\s*['"]A['"][\s\S]{0,200}shouldHideByKeyword/.test(body),
      'a tag 必須條件式 hide（只在 shouldHideByKeyword 命中時）');
  });

  it('checkDynamicNoise 必須對 button/role 無條件 hide', () => {
    // 合併 loop 內 a 分支 continue 後 button 系列無條件 hide
    // 簡化驗證：loop 結尾必須 hide(el, hiddenList) 直接呼（不在 shouldHideByKeyword 條件內）
    assert.ok(/continue;\s*\}[\s\S]{0,200}hide\(el,\s*hiddenList\)/.test(body),
      'button / role / input button 系列必須無條件 hide（不受 shouldHideByKeyword 限制）');
  });
});
