// JRead — Shinkansen content guard 暫停握手（JRead 端）forcing function（v0.8.149）
//
// Bug（Jimmy 2026-06-21 iPhone 回報）：Shinkansen 翻譯後再進 JRead 閱讀模式，畫面
// 每秒閃一下、像在重排版；未翻譯則無。
//
// 根因（已知家族，cleaner.js:1293 / memory project_translate_reader_ghost）：Shinkansen
// 每秒跑 content guard sweep，把 JRead 重排成閱讀卡片的 articleEl 誤判成「譯文被 SPA
// 覆蓋」而重建子節點 → 每秒 reflow 閃動。閱讀卡片即 articleEl 本身、在 guard 管轄區內，
// 無法像 v0.8.131 標題那樣挪到 articleEl 外閃避。
//
// 修法（握手，非站點特判）：JRead 進 / 出閱讀模式時 dispatch 'jread-reader-mode'
// CustomEvent（跨 extension content script、同 shinkansen-debug-request 機制），Shinkansen
// 收到就暫停 / 恢復 content guard。Shinkansen 端的暫停邏輯在 Shinkansen repo。
//
// 訊號層次：本檔驗 JRead 端「進閱讀模式送 active:true、退出送 active:false」的接線。
//   不驗：Shinkansen 端是否真的暫停（Shinkansen repo 的 spec）、真實每秒閃動消除
//   （兩 extension 並載的 real Chrome probe 已實證 guardPaused 進 true 出 false；
//   iPhone 視覺由 Jimmy 實機）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MAIN_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8'
);

// 抓某個 function 的 body（粗略，到下一個同縮排 `\n  }`）
function fnBody(src, name) {
  const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = src.match(re);
  if (!m) return '';
  const start = m.index + m[0].length;
  const slice = src.slice(start);
  const end = slice.search(/\n  \}/);
  return end >= 0 ? slice.slice(0, end) : slice;
}

describe('Shinkansen content guard 暫停握手（JRead 端，v0.8.149）', () => {
  it('定義 signalReaderModeToTranslator——dispatch jread-reader-mode CustomEvent（含 detail.active）', () => {
    const body = fnBody(MAIN_SRC, 'signalReaderModeToTranslator');
    assert.ok(body, '必須定義 signalReaderModeToTranslator');
    assert.match(body, /dispatchEvent/, '必須 dispatchEvent');
    assert.match(body, /['"]jread-reader-mode['"]/, "事件名必須是 'jread-reader-mode'（與 Shinkansen 端 listener 對齊）");
    assert.match(body, /detail:\s*\{\s*active:/, 'detail 必須帶 active 旗標');
    assert.match(body, /try\s*\{[\s\S]*catch/, 'dispatch 必須 try/catch（不阻斷 reader 流程）');
  });

  it('finalizeEnter（共用 enter 收尾）必須送 active:true', () => {
    const body = fnBody(MAIN_SRC, 'finalizeEnter');
    assert.ok(body, '必須有 finalizeEnter');
    assert.match(body, /signalReaderModeToTranslator\(true\)/,
      'finalizeEnter 必須呼叫 signalReaderModeToTranslator(true)——閱讀模式就緒即叫 Shinkansen 暫停 guard');
  });

  it('exitReaderModeImpl 必須送 active:false（任一退出路徑都恢復）', () => {
    const body = fnBody(MAIN_SRC, 'exitReaderModeImpl');
    assert.ok(body, '必須有 exitReaderModeImpl');
    assert.match(body, /signalReaderModeToTranslator\(false\)/,
      'exitReaderModeImpl 必須呼叫 signalReaderModeToTranslator(false)——恢復 Shinkansen guard');
  });

  it('active:false 必須在 exit 函式開頭（cinema / article 任一路徑都送、不漏）', () => {
    const body = fnBody(MAIN_SRC, 'exitReaderModeImpl');
    // signal(false) 應在 cinema early-return（NS.state.cinemaActive 分支）之前
    const sigIdx = body.indexOf('signalReaderModeToTranslator(false)');
    const cinemaIdx = body.indexOf('cinemaActive');
    assert.ok(sigIdx >= 0 && (cinemaIdx < 0 || sigIdx < cinemaIdx),
      'signalReaderModeToTranslator(false) 必須在 cinema early-return 之前——否則 cinema 退出路徑漏送恢復');
  });
});
