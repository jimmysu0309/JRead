// JRead — 退出路徑逐段容錯（v1.7.39 全面 review M1）
// -----------------------------------------------------------------------------
// Bug（2026-08-05 全面 review 批次 1）：enter pipeline 在 v0.8.36 已整段
// try/catch（中途 throw 留半套 artifacts），exit 沒有同等防護——styler.restore
// / cleaner.restore 裸跑，任一 throw 時：(a) state.active 卡 true、hiddenEls
// 未還原；(b) ESC listener 已拆、再 toggle 又走 exit 再炸成 wedge（使用者只能
// reload 自救）；(c) TOGGLE 的 async IIFE 無 catch → sendResponse 永不被呼叫、
// popup callback 懸空。
//
// 修法：exitReaderModeImpl 內 safeStep 逐段容錯（單段失敗 warn + 跳過、其餘
// 還原照跑、結尾 state 清理無條件執行）；TOGGLE handler 補最後保險 catch
//（回報當下真實 state）。
//
// 驗證分兩層（main.js 包 IIFE + 依賴 browser API，無法直接 require——比照
// cinema-borderless-mutex / exit-scroll-sync 的 source-extraction 慣例）：
//   (1) 行為級：抽出 exitReaderModeImpl 函式本體、以 stub 依賴執行，讓
//       styler.restore throw → 斷言 cleaner.restore 仍被呼叫、state.active
//       仍被清成 false（wedge 防護的直接 forcing）
//   (2) source 級：TOGGLE handler 的 try/catch + catch 內 sendResponse 接線存在
//
// 訊號層次：本 spec 驗容錯序與接線；真實 restore 內容的正確性由各模組自己的
// spec 與 /harness-verify 驗。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MAIN_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8');

function extractExitImpl() {
  const match = MAIN_SRC.match(/function exitReaderModeImpl\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(match, 'main.js 應有 exitReaderModeImpl（重構改名時同步更新本 spec）');
  return match[1];
}

// 以 stub 依賴執行抽出的函式本體。free identifiers 清單與 main.js 同步——
// exitReaderModeImpl 新增外部依賴時這裡會 ReferenceError（可見的 forcing，
// 同步補 stub 即可）。
function runExitImpl({ stylerThrows }) {
  const body = extractExitImpl();
  const calls = [];
  const NS = {
    editMode: null,
    positionMemory: { endSession: () => calls.push('endSession') },
    spaceScroll: { uninstall: () => calls.push('spaceScroll') },
    pagedMode: { uninstall: () => calls.push('paged'), resetPosition: () => {} },
    cinema: null,
    xThread: null,
    fbPost: null,
    detector: { restoreAbsorbedSiblings: () => calls.push('absorbed') },
    styler: { restore: () => {
      calls.push('styler');
      if (stylerThrows) throw new Error('styler restore boom');
    } },
    cleaner: { restore: () => calls.push('cleaner') },
    state: {
      cinemaActive: false, active: true, articleEl: {}, hiddenEls: [{}],
      originalStyles: {}, confidence: 1, absorbedSiblings: []
    },
    MSG: { SET_ACTIVE_ICON: 'SET_ACTIVE_ICON' }
  };
  const fn = new Function(
    'NS', 'window', 'document',
    'signalReaderModeToTranslator', 'captureExitScrollAnchor', 'applyExitScrollAnchor',
    'uninstallKeyguard', 'onEscKey', 'safeSendMessage',
    body
  );
  fn(
    NS,
    { removeEventListener: () => {} },
    { querySelectorAll: () => [] },
    () => {}, () => null, () => calls.push('scrollAnchor'),
    () => {}, () => {}, () => {}
  );
  return { NS, calls };
}

describe('main — 退出路徑逐段容錯 (v1.7.39)', () => {

  it('styler.restore throw：cleaner.restore 仍執行、state.active 仍清成 false（wedge 防護）', () => {
    const { NS, calls } = runExitImpl({ stylerThrows: true });
    assert.ok(calls.includes('styler'), 'styler.restore 有被呼叫（前提 sanity）');
    assert.ok(calls.includes('cleaner'),
      'styler throw 不得阻斷 cleaner.restore——hiddenEls 還原是使用者頁面能否復原的關鍵');
    assert.ok(calls.includes('absorbed'), '後續還原步驟照跑');
    assert.strictEqual(NS.state.active, false,
      'state 清理必須無條件執行，否則 active 卡 true → 再 toggle 再炸 = wedge');
    assert.deepStrictEqual(NS.state.hiddenEls, [], 'hiddenEls 清空');
  });

  it('正常路徑（無 throw）：還原序完整、state 清乾淨（容錯不改變正常行為）', () => {
    const { NS, calls } = runExitImpl({ stylerThrows: false });
    for (const step of ['endSession', 'spaceScroll', 'paged', 'styler', 'cleaner', 'absorbed', 'scrollAnchor']) {
      assert.ok(calls.includes(step), `${step} 必須在正常退出序內`);
    }
    assert.strictEqual(NS.state.active, false);
  });

  it('exitReaderModeImpl 內有 safeStep 容錯（source forcing）', () => {
    const body = extractExitImpl();
    assert.ok(/const safeStep = /.test(body), 'safeStep helper 必須存在');
    assert.ok(/safeStep\(\(\) => \{ if \(NS\.styler\)/.test(body), 'styler.restore 必須包 safeStep');
    assert.ok(/safeStep\(\(\) => \{ if \(NS\.cleaner\)/.test(body), 'cleaner.restore 必須包 safeStep');
  });

  it('TOGGLE handler 有最後保險 catch + catch 內 sendResponse（popup callback 不懸空）', () => {
    const idx = MAIN_SRC.search(/msg\.type\s*===\s*NS\.MSG\.TOGGLE_READER_MODE/);
    assert.ok(idx >= 0, 'TOGGLE_READER_MODE handler 應存在');
    const slice = MAIN_SRC.slice(idx, idx + 700);
    assert.ok(/try\s*\{[\s\S]*sendResponse\(await toggleReader\(\)\)/.test(slice),
      'toggle 主體必須在 try 內');
    assert.ok(/catch\s*\(err\)\s*\{[\s\S]*sendResponse\(/.test(slice),
      'catch 內必須仍呼叫 sendResponse——toggle 中途 throw 時 popup 端 callback 不得懸空');
  });
});
