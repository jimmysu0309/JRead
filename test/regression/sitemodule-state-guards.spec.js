// JRead — 站點模組狀態還原 guard（v0.8.36，code review batch 2）
//
// 兩條站點模組（明確隔離的 site-specific 檔，特判合法）的狀態還原 bug：
//
// 1. youtube-borderless：SPA 導航離開 /watch 時舊版只丟棄 theater snapshot
//    （prevTheaterValue = null）、不 removeAttribute——ytd-watch-flexy 在 SPA
//    導航中持續存在，apply 時設的 theater attribute 殘留；切回 watch 後
//    snapshotAndSetTheater 把殘留讀成「使用者原本就在劇院」→ toggle off 不
//    移除 → 原本非劇院模式的使用者被永久留在 theater。
//
// 2. fb-post：自製「hide body 直系子」只排除 reader/script/style，漏了 JRead
//    自家掛在 body 的 host（#__jread-toast-host 等）——toast host 若在 enter
//    前已存在會被 inline !important 蓋掉，FB reader 下送 Readwise 的結果
//    toast 不可見（styler 同款 ancestor 規則有 :not(#__jread-toast-host)，
//    此處是同一事實的第二實作、排除清單 drift）。
//
// 兩個模組依賴站點 DOM（ytd-watch-flexy / FB data-ad-* 結構），jsdom 難以
// 端到端重現——走 source 結構 forcing。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const YT_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'youtube-borderless.js'), 'utf8');
const FB_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'fb-post.js'), 'utf8');

describe('youtube-borderless — SPA 離開 watch 必須還原 theater（v0.8.36）', () => {
  it('reapplyOnNavigation 的非 watch 分支必須呼叫 restoreTheater()，不可只清 snapshot', () => {
    const m = YT_SRC.match(/function reapplyOnNavigation[\s\S]*?\n  \}/);
    assert.ok(m, '抓得到 reapplyOnNavigation');
    // 排除註解行（修法註解內會引用舊寫法字面）
    const elseBranch = (m[0].split('} else {')[1] || '')
      .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(/restoreTheater\(\)/.test(elseBranch),
      '非 watch 分支必須 restoreTheater()（含 removeAttribute）——只設 prevTheaterValue=null 會把自己設的 theater 殘留變成下次 snapshot 的「使用者原狀」');
    assert.ok(!/prevTheaterValue = null/.test(elseBranch),
      '非 watch 分支不可直接 prevTheaterValue = null（restoreTheater 內部會清）');
  });
});

describe('fb-post — hide body 直系子必須豁免 JRead 自家 host（v0.8.36）', () => {
  // v1.7.43 T7：兩個 hide 迴圈收斂到共用 hideBodySiblingsExcept——豁免只需一份，
  // 但 enter() 與 enterPhotoMode() 都必須走共用函式（雙實作時代漏補其中一份
  // 正是 v0.8.36 的事故根因）
  it('hideBodySiblingsExcept 帶 __jread 豁免、enter() 與 enterPhotoMode() 都走它', () => {
    const fn = FB_SRC.match(/function hideBodySiblingsExcept\([\s\S]*?\n  \}/);
    assert.ok(fn, 'fb-post.js 必須有 hideBodySiblingsExcept 共用函式');
    assert.ok(/child\.id && child\.id\.indexOf\('__jread'\) === 0/.test(fn[0]),
      'hideBodySiblingsExcept 必須以 __jread id 前綴豁免 JRead 自家 host');
    const calls = (FB_SRC.match(/hideBodySiblingsExcept\(reader\);/g) || []).length;
    assert.strictEqual(calls, 2,
      `enter() 與 enterPhotoMode() 都必須呼叫 hideBodySiblingsExcept（實際 ${calls}/2）`);
  });
});
