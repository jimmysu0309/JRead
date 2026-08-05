// JRead — 全面 review 批次 4：service worker 防護（v1.7.42）
//
// W1：快速鍵送 Readwise 的 toggle 後固定等 800ms 是 race——慢站（重 SPA / 大量
//     動態內容）可能還沒 ready 就抽 payload、抽到殘缺內容。修法：改輪詢
//     GET_READER_STATE 直到 active（每 200ms、上限 4s），就緒即早退。
// W2：GET_SETTINGS 的 strip fallback `|| ((s) => s)` 在 strip 缺席（importScripts
//     失敗等）時 identity 回傳——把含憑證（readwiseToken / instapaper* /
//     geminiApiKey）的整包設定送進 content，正是 v1.6.26 要擋的洩漏面。修法：
//     strip 缺席回 null（content 端有 defaults fallback 軌）。
//
// 本 spec 是 forcing function（靜態原始碼斷言）：SW 訊息時序需真 Chrome 才能
// 完整重現，這裡守住「防護程式碼存在且未被改回舊寫法」這層。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SW_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'background', 'service-worker.js'), 'utf8'
);

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, `找不到 startMarker: ${startMarker}`);
  const e = src.indexOf(endMarker, s + startMarker.length);
  assert.ok(e >= 0, `找不到 endMarker: ${endMarker}`);
  return src.slice(s, e);
}

describe('review-b4 W1 — 快速鍵送 Readwise 輪詢就緒（v1.7.42）', () => {
  const fn = sliceBetween(SW_SRC,
    'async function sendToReadwiseFromCommand', '// 2. 抽 reader card payload');

  it('toggle 後不可再固定 setTimeout 800ms 等待', () => {
    assert.ok(!/setTimeout\(\s*r\s*,\s*800\s*\)/.test(fn),
      'sendToReadwiseFromCommand 不可再用固定 800ms 等待（race——慢站抽到殘缺內容）');
  });

  it('必須輪詢 GET_READER_STATE 直到 active（有上限）', () => {
    const loopStart = fn.search(/for\s*\(\s*let\s+waited/);
    assert.ok(loopStart >= 0, 'toggle 後必須有輪詢迴圈（for let waited ...）');
    const loop = fn.slice(loopStart, loopStart + 500);
    assert.match(loop, /GET_READER_STATE/,
      '輪詢必須查 GET_READER_STATE');
    assert.match(loop, /s\s*&&\s*s\.active/,
      '輪詢必須以 state.active 為就緒條件、就緒即 break 早退');
    assert.match(loop, /waited\s*<\s*4000/,
      '輪詢必須有上限（4s）——content script 死掉時不可無限等');
    assert.match(loop, /break/,
      '就緒必須 break 早退（不可傻等滿上限）');
  });
});

describe('review-b4 W2 — GET_SETTINGS strip 缺席不洩憑證（v1.7.42）', () => {
  const seg = sliceBetween(SW_SRC, "case 'GET_SETTINGS'", "case 'CUSTOM_COMMAND'");

  it('strip 不可有 identity fallback（|| ((s) => s)）', () => {
    assert.ok(!/\|\|\s*\(\(\s*s\s*\)\s*=>\s*s\s*\)/.test(seg),
      'strip 缺席時 identity fallback 會把含憑證的整包設定送進 content——已知洩漏面，不可改回');
  });

  it('strip 非 function 時必須 sendResponse(null)', () => {
    assert.match(seg, /typeof\s+strip\s*!==\s*'function'/,
      '必須檢查 strip 是否存在');
    const m = seg.match(/typeof\s+strip\s*!==\s*'function'[\s\S]{0,120}/);
    assert.match(m[0], /sendResponse\(null\)/,
      'strip 缺席必須回 null（content 端走 defaults fallback），不可回整包設定');
  });
});
