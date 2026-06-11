// JRead — enter pipeline 容錯 + 半套狀態還原（v0.8.36，code review batch 2）
//
// Bug 群（main.js / detector.js）：
//   1. detect 成功後 cleaner/styler 中途 throw → NS.state.active 停在 false →
//      exitReaderMode() 開頭 !active guard 直接 no-op——已 hide 元素 / shadow
//      replica（已 appendChild 進 body、可見的文章複本）/ injected H1 全部
//      永遠無法還原；rejection 沿 onMessage async IIFE 上傳、sendResponse 懸空
//   2. detect() 自己 throw 時同樣留下半套 detector artifacts
//   3. scheduleReapply 的 guard 全在 await getSettings() 之前——await 期間按
//      ESC 退出（exit 是同步的）→ continuation 對 articleEl=null 重套 styler
//   4. silent flag 沒傳進 x-thread / fb-post 分支（v0.7.155 漏網）——x.com 是
//      SPA，路由變化 silent 重進在偵測失敗時彈不該彈的錯誤 toast
//   5. detector promoteForTitle sibling-walk 可回傳 body（LCA 路徑有 body
//      guard、sibling-walk 沒有；shadow replica 是 body 直接子、必定命中）
//
// main.js 包在 IIFE 且依賴 chrome runtime，無法 require——走 source 結構
// forcing（同 spa-navigation-watch 等既有 main.js spec 慣例）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MAIN_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8');
const DETECTOR_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'), 'utf8');

function fnBody(src, name) {
  const idx = src.search(new RegExp(`(?:async )?function\\s+${name}\\b`));
  assert.ok(idx >= 0, `缺 ${name}`);
  const next = src.slice(idx + 10).search(/\n  (?:async )?function /);
  return next >= 0 ? src.slice(idx, idx + 10 + next) : src.slice(idx);
}

describe('main.js — enter pipeline 容錯（v0.8.36）', () => {
  const impl = fnBody(MAIN_SRC, 'enterReaderModeImpl');

  it('detect() 必須包 try/catch、失敗走 exitReaderModeImpl 清 artifacts', () => {
    assert.match(impl, /try\s*\{\s*\n?\s*result = NS\.detector && NS\.detector\.detect\(\);/,
      'detect() 呼叫必須在 try 內（detect 會做 DOM mutation，throw 留半套 replica）');
    const detectCatch = impl.match(/catch \(err\) \{[\s\S]{0,400}?DETECT_ERROR/);
    assert.ok(detectCatch && /exitReaderModeImpl\(\)/.test(detectCatch[0]),
      'detect 失敗的 catch 必須呼叫 exitReaderModeImpl 清理');
  });

  it('enter 分支（cinema / x-thread / fb-post / generic）必須整段包 try/catch、失敗還原', () => {
    const enterCatch = impl.match(/catch \(err\) \{[\s\S]{0,600}?ENTER_FAILED[\s\S]{0,200}?return false/);
    assert.ok(enterCatch, 'enter pipeline 必須有 catch + ENTER_FAILED 回報 + return false（讓 sendResponse 有回應、不懸空）');
    assert.ok(/exitReaderModeImpl\(\)/.test(enterCatch[0]),
      'enter 失敗的 catch 必須走 exitReaderModeImpl 完整還原（半套 hide / replica / state）');
  });

  it('exitReaderModeImpl 本身不可有 active guard（rollback 對半套狀態也要能跑）', () => {
    const exitImpl = fnBody(MAIN_SRC, 'exitReaderModeImpl');
    assert.ok(!/if\s*\(\s*!NS\.state\.active\s*\)\s*return/.test(exitImpl),
      'active guard 屬於 exitReaderMode wrapper，exitReaderModeImpl 必須可對部分設定的 state 跑');
  });

  it('silent flag 必須傳進 x-thread / fb-post 分支（v0.7.155 漏網修補）', () => {
    assert.match(impl, /enterXThreadMode\(opts\)/, 'x-thread 分支必須帶 opts');
    assert.match(impl, /enterFbPostMode\(opts\)/, 'fb-post 分支必須帶 opts');
    const xt = fnBody(MAIN_SRC, 'enterXThreadMode');
    assert.match(xt, /const silent = !!\(opts && opts\.silent\);/, 'enterXThreadMode 必須解析 silent');
    assert.match(xt, /if \(!silent\) showToast\('此頁無法偵測主推文'/, 'x-thread 失敗 toast 必須受 silent gate');
    const fb = fnBody(MAIN_SRC, 'enterFbPostMode');
    assert.match(fb, /if \(!silent\) showToast\('此頁無法偵測主貼文'/, 'fb-post 失敗 toast 必須受 silent gate');
  });

  it('scheduleReapply 在 await getSettings() 之後必須重跑 state guard', () => {
    const m = MAIN_SRC.match(/const scheduleReapply = [\s\S]*?\n    \};/);
    assert.ok(m, '抓得到 scheduleReapply');
    const afterAwait = m[0].split('await getSettings()')[1] || '';
    assert.ok(/if \(!NS\.state\.active \|\| NS\.state\.cinemaActive\) return;/.test(afterAwait) &&
              /if \(!NS\.state\.articleEl \|\| !NS\.styler\) return;/.test(afterAwait),
      'await 之後必須重跑同組 guard——await 期間 ESC 退出 / SPA 拆卡會把 articleEl 清成 null');
  });
});

describe('detector.js — promoteForTitle sibling-walk body guard（v0.8.36）', () => {
  it('sibling-walk 的 parent 為 body / documentElement 時必須 break（不可吞整頁）', () => {
    const m = DETECTOR_SRC.match(/function promoteForTitle[\s\S]*?\n  \}/);
    assert.ok(m, '抓得到 promoteForTitle');
    assert.ok(/if \(parent === document\.body \|\| parent === document\.documentElement\) break;/.test(m[0]),
      'sibling-walk 必須有 body/html guard——shadow replica 是 body 直接子、第一圈 parent 就是 body，' +
      '任一 body-level sibling 含 og:title 相符文字就會把 articleEl 升級成整個 <body>');
  });
});
