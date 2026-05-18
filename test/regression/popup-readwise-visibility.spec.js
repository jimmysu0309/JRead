// JRead — popup 「送到 Readwise Reader」按鈕可見性 regression
//
// v0.7.130：非閱讀模式時整顆按鈕隱藏（不只 disabled 變灰）。
// 動機：reader mode 才是「送到 Readwise」有意義的入口；非閱讀模式露出灰色
// disabled 按鈕只是雜訊（Jimmy 2026-05-18 明確要求）。
//
// 修法：HTML 初始 `hidden` 屬性 + popup.js refreshPopupForActiveTab 根據 reader
// state 切 `readwiseBtn.hidden`。`disabled` 軸保留給 click handler 的「送出中
// 防連點」—— hidden 與 disabled 兩個獨立軸。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const POPUP_HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.html'),
  'utf8'
);
const POPUP_JS = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.js'),
  'utf8'
);

describe('popup v0.7.130 — 送到 Readwise Reader 按鈕可見性', () => {
  it('popup.html readwise-btn 初始必須有 hidden 屬性（popup 開啟瞬間不該閃現按鈕）', () => {
    // 抓 <button id="readwise-btn" ...> 整段 open tag
    const m = POPUP_HTML.match(/<button\s+id=["']readwise-btn["'][^>]*>/);
    assert.ok(m, '能在 popup.html 找到 <button id="readwise-btn">');
    const tag = m[0];
    assert.match(tag, /\bhidden\b/,
      'readwise-btn 初始必須有 hidden 屬性——forcing：移除 hidden 會讓 popup 開啟瞬間（GET_READER_STATE 還沒回）整顆按鈕閃現一下');
  });

  it('popup.html readwise-btn 初始不可有 disabled 屬性（hidden 取代了 disabled 的角色）', () => {
    const m = POPUP_HTML.match(/<button\s+id=["']readwise-btn["'][^>]*>/);
    assert.ok(m);
    const tag = m[0];
    // disabled 是 boolean attribute，可能寫成 `disabled` / `disabled=""` / `disabled="disabled"`，
    // 用 `\bdisabled\b` 匹配（前後 word boundary）避免誤撞其他屬性子字串。
    assert.doesNotMatch(tag, /\bdisabled\b/,
      'readwise-btn 初始不該有 disabled——forcing：disabled 是「送出中」狀態用的軸，hidden 才是「非閱讀模式不顯示」用的軸，混用會讓 popup 開啟時按鈕灰色露出（非預期）');
  });

  it('popup.js refreshPopupForActiveTab 必須對 readwiseBtn.hidden 賦值（不能只動 disabled）', () => {
    // 抓 refreshPopupForActiveTab function body
    const m = POPUP_JS.match(/async\s+function\s+refreshPopupForActiveTab\s*\(\s*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(m, '能在 popup.js 找到 async function refreshPopupForActiveTab');
    const body = m[1];
    // 至少要有一處 readwiseBtn.hidden = ... 賦值
    assert.match(body, /readwiseBtn\.hidden\s*=/,
      'refreshPopupForActiveTab 必須對 readwiseBtn.hidden 賦值——forcing：只改 disabled 會回退到 v0.7.129 之前的「按鈕灰色露出」行為');
    // 不可只靠 disabled——若 body 完全沒 hidden 賦值（上一條 assertion 已涵蓋）；
    // 加一條：所有早期 return 路徑（!tabId / catch）都該設 hidden=true，不可只設
    // disabled=true。
    const hiddenAssignmentCount = (body.match(/readwiseBtn\.hidden\s*=/g) || []).length;
    assert.ok(hiddenAssignmentCount >= 2,
      `refreshPopupForActiveTab 至少應有 2 處 readwiseBtn.hidden 賦值（早期 return + 主路徑），實測 ${hiddenAssignmentCount}——forcing：漏掉早期 return 路徑會讓「無 tab / 無 content script」情境按鈕仍露出`);
  });
});
