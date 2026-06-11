// JRead — SPA 導航偵測（v0.8.21 C1）
//
// 對應 code review C1：main.js 的 SPA 導航偵測原本是零實作的 TODO。SPA 站路由
// 切換不重載 content script，舊版只在 document_idle 跑一次 auto-enable，且 reader
// card 綁的是舊路由 DOM——使用者在 SPA reader mode 下點下一篇時舊卡片殘留、
// auto-enable 也不對新路由重觸發。
//
// 修法：偵測路由變化 → 先 exitReaderMode → 視情況重觸發（使用者原本就在 reader
// mode、或新路由命中 auto-enable 網域 → silent 重進）。
//
// main.js 包在 IIFE 且依賴 chrome.runtime 訊息傳遞，無法 require（同 readwise-save
// 等既有 main.js spec 慣例）——本 spec 走 source 結構 forcing，鎖住關鍵 wiring。
// 真實 Chrome 上的「live SPA 路由重觸發」行為見 PENDING_REGRESSION（harness 載
// 靜態頁、模擬不到 SPA 換路由）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8'
);

describe('main.js — SPA 導航偵測 wiring（C1）', () => {
  it('不得殘留零實作 TODO', () => {
    assert.ok(!/TODO:\s*SPA\s*導航偵測/.test(SRC), 'SPA 導航偵測 TODO 必須已實作、不得殘留');
  });

  it('必須有 installSpaNavigationWatch 並在入口呼叫', () => {
    assert.match(SRC, /function\s+installSpaNavigationWatch\s*\(/, '必須宣告 installSpaNavigationWatch');
    assert.match(SRC, /\n\s*installSpaNavigationWatch\(\);/, '必須呼叫 installSpaNavigationWatch()');
  });

  it('watch 必須 top-level frame 才裝（不在 iframe 重複跑）', () => {
    const fn = SRC.match(/function\s+installSpaNavigationWatch[\s\S]*?\n  \}/);
    assert.ok(fn, '抓得到 installSpaNavigationWatch body');
    assert.match(fn[0], /window\.top\s*!==\s*window\.self/, 'top-level frame guard 必須在');
  });

  it('必須掛 popstate + <title> MutationObserver + href 輪詢三個訊號', () => {
    const fn = SRC.match(/function\s+installSpaNavigationWatch[\s\S]*?\n  \}/)[0];
    assert.match(fn, /addEventListener\(\s*['"]popstate['"]\s*,\s*onSpaRouteChange/, '必須掛 popstate → onSpaRouteChange');
    assert.match(fn, /MutationObserver\(onSpaRouteChange\)[\s\S]{0,80}childList:\s*true/, '必須對 <title> 掛 childList MutationObserver');
    assert.match(fn, /setInterval\(onSpaRouteChange/, '必須有 href 輪詢 catch-all');
  });

  it('onSpaRouteChange 必須以 location.href 變化去重、變化時 exitReaderMode + 排重觸發', () => {
    const fn = SRC.match(/function\s+onSpaRouteChange[\s\S]*?\n  \}/);
    assert.ok(fn, '抓得到 onSpaRouteChange body');
    const body = fn[0];
    assert.match(body, /location\.href/, '必須讀 location.href');
    assert.match(body, /===\s*_spaLastUrl[\s\S]{0,40}return/, 'href 沒變必須 early-return（去重，避免 title 雜訊變動誤判）');
    assert.match(body, /exitReaderMode\(\)/, '路由變化必須先 exitReaderMode（拆掉綁舊 DOM 的卡片）');
    assert.match(body, /setTimeout\(/, '必須 debounce 排重觸發（等新內容渲染）');
    assert.match(body, /enterReaderMode\(\s*\{\s*silent:\s*true\s*\}\s*\)/, '重觸發必須 silent enterReaderMode');
  });

  it('重觸發條件：wasActive（保留閱讀意圖）或新路由命中 auto-enable 網域', () => {
    const fn = SRC.match(/function\s+onSpaRouteChange[\s\S]*?\n  \}/)[0];
    assert.match(fn, /wasActive/, '必須記錄 wasActive（路由變化前是否在 reader mode）');
    assert.match(fn, /autoEnableMatchesCurrentRoute\(\)/, '必須用共用 autoEnableMatchesCurrentRoute 判定新路由');
    assert.match(fn, /if\s*\(\s*!wasActive\s*&&\s*!autoMatch\s*\)\s*return/, 'wasActive 與 autoMatch 皆否則不重進');
  });

  it('auto-enable 判定抽成共用 autoEnableMatchesCurrentRoute（load + SPA 重觸發單一資料源）', () => {
    assert.match(SRC, /async\s+function\s+autoEnableMatchesCurrentRoute\s*\(/, '必須有共用 autoEnableMatchesCurrentRoute');
    // load-time 與 SPA 重觸發都呼叫它（>= 2 處）
    const calls = (SRC.match(/autoEnableMatchesCurrentRoute\(\)/g) || []).length;
    assert.ok(calls >= 2, `autoEnableMatchesCurrentRoute 應被 load + SPA 兩處共用，實際 ${calls} 處`);
  });
});

describe('main.js — spaRouteKey 錨點 hash 不算導航（v0.8.35）', () => {
  // bug：舊版以完整 location.href 比對，閱讀模式下點文內註腳 / TOC 錨點
  // （href="#fn1"）→ 輪詢誤判換頁 → 強制退出再 silent 重進（畫面閃回原站、
  // 捲動位置全失）。spaRouteKey 是純函式，抽出 source 直接功能驗證。
  const fnMatch = SRC.match(/function\s+spaRouteKey\s*\(href\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'main.js 必須有 spaRouteKey（路由比對 key 單一資料源）');
  // eslint-disable-next-line no-eval
  const spaRouteKey = eval('(' + fnMatch[0] + ')');

  it('錨點型 hash 變化不改變路由 key（點註腳不退出閱讀模式）', () => {
    assert.strictEqual(
      spaRouteKey('https://a.com/article#fn1'),
      spaRouteKey('https://a.com/article'),
      '#fn1 錨點不可被當成導航');
    assert.strictEqual(
      spaRouteKey('https://a.com/article#fn1'),
      spaRouteKey('https://a.com/article#section-2'),
      '錨點之間切換不可被當成導航');
  });

  it('hash-router（#/、#!）的 hash 是真路由，必須保留進比對 key', () => {
    assert.notStrictEqual(
      spaRouteKey('https://a.com/#/post/1'),
      spaRouteKey('https://a.com/#/post/2'),
      'hash-router 換頁必須被視為導航');
    assert.notStrictEqual(
      spaRouteKey('https://a.com/#!/post/1'),
      spaRouteKey('https://a.com/#!/post/2'),
      'hashbang router 換頁必須被視為導航');
  });

  it('pathname / query 變化仍視為導航', () => {
    assert.notStrictEqual(spaRouteKey('https://a.com/p/1'), spaRouteKey('https://a.com/p/2'));
    assert.notStrictEqual(spaRouteKey('https://a.com/p?id=1'), spaRouteKey('https://a.com/p?id=2'));
  });

  it('onSpaRouteChange 與初始 _spaLastUrl 都必須經過 spaRouteKey（同一比對基準）', () => {
    assert.match(SRC, /_spaLastUrl\s*=\s*spaRouteKey\(location\.href\)/, '初始值必須走 spaRouteKey');
    const fn = SRC.match(/function\s+onSpaRouteChange[\s\S]*?\n  \}/)[0];
    assert.match(fn, /spaRouteKey\(location\.href\)/, 'onSpaRouteChange 必須走 spaRouteKey');
  });
});
