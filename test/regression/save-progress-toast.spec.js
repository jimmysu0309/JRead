// JRead — regression spec: 快速鍵送出的進行中回饋（v1.7.36）
//
// Trigger: Jimmy 2026-08-04——「按快速鍵送出文章到 Readwise Reader 時，按下就要
// 有反應（和 popup 顯示相同訊息），而非只有提供最終結果」。
//
// 原行為：sendToReadwiseFromCommand 整條流程（確認閱讀模式 → 抽 payload →
// Gemini 摘要 → 上傳）只在最後吐一則結果 toast，中間好幾秒完全無回饋。
//
// 修法：
//   1. toast.show() 支援 opts.id——同 id 的前一則被本次取代（三段式進度不疊成
//      一排殘影）
//   2. content SHOW_TOAST handler 把 id / duration 從訊息轉給 toast
//   3. SW 在流程起點 / 摘要階段送進度 toast，文字取自 popup-core SAVE_PROGRESS
//   4. popup 狀態列與 SW toast 共用 SAVE_PROGRESS（單一資料源，防兩軌文字 drift）

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const TOAST_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'toast.js'), 'utf8');
const MAIN_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'main.js'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'background', 'service-worker.js'), 'utf8');
const POPUP_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'popup', 'popup.js'), 'utf8');
const popupCore = require(path.join(ROOT, 'jread', 'popup', 'popup-core.js'));

function setupToast() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.chrome = {
    runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p }
  };
  window.eval(require('../helpers').SRC.namespace);
  window.eval(TOAST_SRC);
  return { document: window.document, NS: window.__JRead };
}

function toastsOf(document) {
  return Array.from(
    document.getElementById('__jread-toast-host').shadowRoot.querySelectorAll('.toast')
  );
}

describe('送出進度回饋（v1.7.36）', () => {
  it('(A) toast 同 id 取代前一則，不疊成多則', () => {
    const { document, NS } = setupToast();
    NS.toast.show('送出中…', { kind: 'info', id: 'jread-save', duration: 5000 });
    NS.toast.show('產生摘要中…', { kind: 'info', id: 'jread-save', duration: 5000 });
    NS.toast.show('已送到 Readwise Reader', { kind: 'success', id: 'jread-save', duration: 5000 });

    const toasts = toastsOf(document);
    assert.strictEqual(toasts.length, 1, '同 id 的三則只該留最後一則');
    assert.strictEqual(toasts[0].textContent, '已送到 Readwise Reader');
    assert.ok(toasts[0].classList.contains('success'), 'kind 要跟著最後一則');
  });

  it('(B) 不同 id / 無 id 的 toast 不互相取代（原疊加行為不變）', () => {
    const { document, NS } = setupToast();
    NS.toast.show('a', { id: 'jread-save', duration: 5000 });
    NS.toast.show('b', { id: 'other', duration: 5000 });
    NS.toast.show('c', { duration: 5000 });
    assert.deepStrictEqual(toastsOf(document).map(t => t.textContent), ['a', 'b', 'c']);
  });

  it('(C) id 含 CSS 特殊字元也不會炸（不用 selector 拼接）', () => {
    const { document, NS } = setupToast();
    const weird = '1 save"]:x';
    NS.toast.show('first', { id: weird, duration: 5000 });
    NS.toast.show('second', { id: weird, duration: 5000 });
    assert.deepStrictEqual(toastsOf(document).map(t => t.textContent), ['second']);
  });

  it('(D) 進度文字是 popup 與 SW 共用的單一資料源', () => {
    assert.strictEqual(typeof popupCore.SAVE_PROGRESS.sending, 'string');
    assert.strictEqual(typeof popupCore.SAVE_PROGRESS.summarizing, 'string');
    assert.ok(popupCore.SAVE_PROGRESS.sending.length > 0);
    assert.ok(popupCore.SAVE_PROGRESS_TOAST_ID, '進度 toast 必須有共用 id');
    assert.ok(popupCore.SAVE_PROGRESS_TOAST_MS > 3000,
      '進度 toast 顯示上限要夠長（跨得過抽 payload + 摘要 + 上傳）');

    // popup 不可再寫死字面值（寫死 = 兩軌 drift 的入口）
    assert.doesNotMatch(POPUP_SRC, /setReadwiseStatus\('送出中/,
      'popup.js 必須改用 SAVE_PROGRESS.sending，不可寫死字串');
    assert.match(POPUP_SRC, /SAVE_PROGRESS\.sending/);
    assert.match(POPUP_SRC, /SAVE_PROGRESS\.summarizing/);
  });

  it('(E) forcing：SW 快速鍵軌必須在第一個 await 之前就送進度 toast', () => {
    const fnStart = SW_SRC.indexOf('async function sendToReadwiseFromCommand');
    assert.ok(fnStart > -1, 'sendToReadwiseFromCommand 必須存在');
    const body = SW_SRC.slice(fnStart);

    const firstProgress = body.indexOf('showProgress(SAVE_PROGRESS.sending)');
    // 用「第一步 GET_READER_STATE」當錨：進度 toast 必須排在整條流程的第一個
    // await 之前，才是「按下當下就有反應」。拿 EXTRACT_READER_HTML 當錨太寬鬆
    // ——toggle 分支內那則也在它之前，刪掉開頭那則仍會過（sanity 實測）。
    const firstAwait = body.indexOf("type: 'GET_READER_STATE'");
    assert.ok(firstProgress > -1, 'SW 必須送「送出中…」進度 toast');
    assert.ok(firstAwait > -1);
    assert.ok(firstProgress < firstAwait,
      '進度 toast 必須排在第一個 await（GET_READER_STATE）之前——按下當下就要有反應');

    assert.ok(body.indexOf('showProgress(SAVE_PROGRESS.summarizing)') > -1,
      'Gemini 摘要階段必須有「產生摘要中…」進度 toast');
    // 結果 / 錯誤 toast 必須帶同一個 id 才能取代進行中那則
    assert.match(body, /payload:\s*\{\s*message,\s*kind,\s*id:\s*SAVE_PROGRESS_TOAST_ID\s*\}/,
      '結果 toast 必須帶 SAVE_PROGRESS_TOAST_ID 取代進度 toast，否則進度那則會殘留');
  });

  it('(F) forcing：content SHOW_TOAST handler 必須把 id / duration 轉給 toast', () => {
    const idx = MAIN_SRC.indexOf('NS.MSG.SHOW_TOAST');
    assert.ok(idx > -1);
    const seg = MAIN_SRC.slice(idx, idx + 600);
    assert.match(seg, /p\.id/, 'SHOW_TOAST handler 必須讀 payload.id');
    assert.match(seg, /p\.duration/, 'SHOW_TOAST handler 必須讀 payload.duration');
  });
});
