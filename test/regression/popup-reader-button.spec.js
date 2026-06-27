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
    const m = POPUP_JS.match(/function\s+refreshReaderButton[\s\S]{0,200}?\}/);
    assert.ok(m, '抓不到 refreshReaderButton body');
    assert.match(m[0], /readerBtn\.hidden\s*=\s*![\s\S]*hasReadwiseToken\(\)/,
      'refreshReaderButton 必須以 hasReadwiseToken() 結果設 readerBtn.hidden');
    assert.match(POPUP_JS, /refreshReaderButton\(\)\s*;/,
      'popup.js 必須在載入時呼叫 refreshReaderButton() 套用初始可見性');
  });
});
