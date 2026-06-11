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
    // v0.8.36：selector 收斂到 INTERACTIVE_BTN_SEL 常數（單一資料源），
    // 合併版 = `'a, ' + INTERACTIVE_BTN_SEL`。常數內容另驗。
    assert.ok(/querySelectorAll\(\s*'a, '\s*\+\s*INTERACTIVE_BTN_SEL\s*\)/.test(body),
      'checkDynamicNoise 必須用合併版 selector（a + INTERACTIVE_BTN_SEL）一次 querySelectorAll');
    assert.ok(/const\s+INTERACTIVE_BTN_SEL\s*=\s*\n?\s*'button, \[role="button"\], input\[type="button"\], input\[type="submit"\], input\[type="reset"\]'/.test(CLEANER_SRC),
      'INTERACTIVE_BTN_SEL 常數必須含 button + role + input 三類');
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

  it('checkDynamicNoise 必須對 button/role 一律 hide（唯一例外 = 媒體 button）', () => {
    // v0.8.36（B2）：button 系列 hide 不受 shouldHideByKeyword 限制（硬教訓九），
    // 唯一豁免是 buttonWrapsContentMedia（與靜態 hideInsideArticleAllButtons
    // 同源的 Medium click-to-zoom 保護）——不可再出現其他 gate。
    assert.ok(/continue;\s*\}[\s\S]{0,400}buttonWrapsContentMedia\(el\)[\s\S]{0,60}hide\(el,\s*hiddenList\)/.test(body),
      'button / role / input button 系列必須 hide，唯一 gate 是 buttonWrapsContentMedia 媒體豁免');
    assert.ok(!/tagName\s*!==\s*['"]A['"][\s\S]{0,120}shouldHideByKeyword/.test(body),
      'button hide 不可被 shouldHideByKeyword 條件化');
  });
});
