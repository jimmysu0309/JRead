// JRead — popup「進入 Reader」按鈕（v1.0.22）
//
// 開新分頁載 reader/reader.html（Readwise inbox feed）。全域入口，不依賴當前分頁
// 閱讀狀態；僅在已設 readwiseToken 時顯示（比照 readwise-btn 的 token gate）。
//
// popup.js 在載入時跑 refreshPopupForActiveTab() 等 top-level 邏輯、引用大量
// getElementById，jsdom 難乾淨 eval——本 spec 是 forcing function：掃 popup.html /
// popup.js source 結構。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'jread', 'popup', 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'jread', 'popup', 'popup.js'), 'utf8');
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'main.js'), 'utf8');

describe('popup v1.0.22 — 進入 Reader 按鈕', () => {
  it('popup.html 必須有 <button id="reader-btn">，初始 hidden（token gate 前不閃現）', () => {
    const m = POPUP_HTML.match(/<button\s+id=["']reader-btn["'][^>]*>/);
    assert.ok(m, '能在 popup.html 找到 <button id="reader-btn">');
    assert.match(m[0], /\bhidden\b/,
      'reader-btn 初始必須 hidden——refreshReaderButton 依 token 解除隱藏前不該閃現');
  });

  it('reader-btn 文字為「進入 Reader」', () => {
    assert.match(POPUP_HTML, /<button\s+id=["']reader-btn["'][^>]*>\s*進入 Reader\s*<\/button>/,
      'reader-btn 文字必須是「進入 Reader」');
  });

  it('popup.js 必須取得 reader-btn 元素參照', () => {
    assert.match(POPUP_JS, /readerBtn\s*=\s*document\.getElementById\(['"]reader-btn['"]\)/,
      'popup.js 必須 const readerBtn = document.getElementById("reader-btn")');
  });

  it('reader-btn click 必須 browser.tabs.create 開 reader/reader.html（runtime.getURL）', () => {
    const m = POPUP_JS.match(/readerBtn\.addEventListener\(['"]click['"][\s\S]*?window\.close\(\)[\s\S]*?\}\);/);
    assert.ok(m, '抓不到 readerBtn click handler');
    const body = m[0];
    assert.match(body, /browser\.tabs\.create\(\s*\{\s*url:\s*browser\.runtime\.getURL\(['"]reader\/reader\.html['"]\)/,
      'reader-btn 必須 tabs.create 開 reader/reader.html（用 runtime.getURL 取擴充頁 URL）');
    assert.match(body, /window\.close\(\)/,
      'reader-btn 點擊後必須關閉 popup');
  });

  it('reader-btn 可見性必須由 token gate（refreshReaderButton 走 hasReadwiseToken）', () => {
    assert.match(POPUP_JS, /function\s+refreshReaderButton/,
      'popup.js 必須有 refreshReaderButton——依 token 決定 reader-btn 顯隱');
    // refreshReaderButton body 取到下一個 top-level async function 之前（v1.5.1 起內含
    // reader-host 短路 + token gate 兩段，不再是單一行）。
    const m = POPUP_JS.match(/function\s+refreshReaderButton\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    assert.ok(m, '抓不到 refreshReaderButton body');
    assert.match(m[0], /readerBtn\.hidden\s*=\s*!\s*\(?\s*await\s+hasReadwiseToken\(\)/,
      'refreshReaderButton 必須以 hasReadwiseToken() 結果設 readerBtn.hidden');
    assert.match(POPUP_JS, /refreshReaderButton\(\)\s*;/,
      'popup.js 必須在載入時呼叫 refreshReaderButton() 套用初始可見性');
  });

  // v1.5.1：在 reader 自有頁（reader/ 下 feed／article 閱讀）三顆按鈕（進入 Reader /
  // 送到 Readwise / 編輯模式）都是雜訊，整批隱藏（Jimmy 2026-06-27）。
  it('refreshReaderButton 必須先以 reader-host 判定短路隱藏 reader-btn', () => {
    const m = POPUP_JS.match(/function\s+refreshReaderButton\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    assert.ok(m, '抓不到 refreshReaderButton body');
    assert.match(m[0], /isReaderHostTab\(\)[\s\S]*?readerBtn\.hidden\s*=\s*true[\s\S]*?return/,
      'refreshReaderButton 必須在 token gate 前先判 isReaderHostTab()→隱藏並 return——forcing：少了這段，reader 自有頁仍露出「進入 Reader」');
  });

  it('isReaderHostTab 必須以 runtime.getURL("reader/") 前綴判定當前分頁', () => {
    const m = POPUP_JS.match(/function\s+isReaderHostTab\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    assert.ok(m, 'popup.js 必須定義 isReaderHostTab');
    assert.match(m[0], /startsWith\(\s*browser\.runtime\.getURL\(['"]reader\/['"]\)\s*\)/,
      'isReaderHostTab 必須用 tab.url.startsWith(runtime.getURL("reader/")) 結構判定，不可硬編 hostname');
  });

  it('refreshPopupForActiveTab 在 readerHostPage 時整批隱藏三顆按鈕並 return', () => {
    const m = POPUP_JS.match(/async\s+function\s+refreshPopupForActiveTab\s*\(\s*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(m, '抓不到 refreshPopupForActiveTab body');
    const body = m[1];
    assert.match(body, /readerHostPage/,
      'refreshPopupForActiveTab 必須讀 GET_READER_STATE 回傳的 readerHostPage');
    // readerHostPage 分支須隱藏三顆並提前 return
    const branch = body.match(/if\s*\(\s*readerHostPage\s*\)\s*\{[\s\S]*?return;[\s\S]*?\n\s*\}/);
    assert.ok(branch, 'refreshPopupForActiveTab 必須有 if (readerHostPage) 分支');
    assert.match(branch[0], /readerBtn\.hidden\s*=\s*true/, 'readerHostPage 分支須隱藏 readerBtn');
    assert.match(branch[0], /readwiseBtn\.hidden\s*=\s*true/, 'readerHostPage 分支須隱藏 readwiseBtn');
    assert.match(branch[0], /editBtn\.hidden\s*=\s*true/, 'readerHostPage 分支須隱藏 editBtn');
    assert.match(branch[0], /return/, 'readerHostPage 分支須提前 return，不跑下方一般可見性邏輯');
  });

  it('main.js GET_READER_STATE 回應必須含 readerHostPage 欄位（取自 NS.state.readerHostPage）', () => {
    const m = MAIN_JS.match(/msg\.type\s*===\s*NS\.MSG\.GET_READER_STATE[\s\S]*?sendResponse\(\{([\s\S]*?)\n\s*\}\);/);
    assert.ok(m, '抓不到 GET_READER_STATE 的 sendResponse payload');
    assert.match(m[1], /readerHostPage:\s*!!\s*NS\.state\.readerHostPage/,
      'GET_READER_STATE 回應須帶 readerHostPage: !!NS.state.readerHostPage——forcing：少了它，popup 在 reader 自有頁無法判定該隱藏三顆按鈕');
  });

  // v1.5.4：reader feed 列表頁（reader/reader.html）「啟動閱讀模式」無意義（feed 是
  // 文章清單、非內容頁）——整顆 toggle 隱藏（Jimmy 2026-06-27）。
  it('isReaderFeedTab 必須以 runtime.getURL("reader/reader.html") 前綴判定（feed 專屬，不含 article.html）', () => {
    const m = POPUP_JS.match(/function\s+isReaderFeedTab\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    assert.ok(m, 'popup.js 必須定義 isReaderFeedTab');
    assert.match(m[0], /startsWith\(\s*browser\.runtime\.getURL\(['"]reader\/reader\.html['"]\)\s*\)/,
      'isReaderFeedTab 必須用 tab.url.startsWith(runtime.getURL("reader/reader.html")) 判定——只命中 feed 列表頁、不含 article.html');
  });

  it('refreshPopupForActiveTab 在 feed 頁隱藏 toggle 按鈕並提前 return', () => {
    const m = POPUP_JS.match(/async\s+function\s+refreshPopupForActiveTab\s*\(\s*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(m, '抓不到 refreshPopupForActiveTab body');
    const body = m[1];
    // feed 分支：isReaderFeedTab() 為真時隱藏 toggleBtn 並 return
    const branch = body.match(/if\s*\(\s*await\s+isReaderFeedTab\(\)\s*\)\s*\{[\s\S]*?return;[\s\S]*?\n\s*\}/);
    assert.ok(branch, 'refreshPopupForActiveTab 必須有 if (await isReaderFeedTab()) 分支');
    assert.match(branch[0], /toggleBtn\.hidden\s*=\s*true/,
      'feed 分支必須隱藏 toggleBtn——forcing：feed 頁露出「啟動閱讀模式」= 無意義按鈕');
    assert.match(branch[0], /return/, 'feed 分支須提前 return');
  });
});
