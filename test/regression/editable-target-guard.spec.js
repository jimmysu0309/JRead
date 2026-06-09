// JRead — NS.isEditableTarget 共用 guard forcing function（v0.8.17）
//
// 2026-06-09 code review C7：paged-mode.js（翻頁鍵）與 space-scroll.js（Space
// 卷動）各自寫一份「編輯/互動類 element focus 放行」判定，且 paged 版**漏了
// BUTTON**——按鈕 focus 時方向鍵 / Space 被翻頁攔截、吃掉按鈕的鍵盤啟用（同一份
// 事實雙實作的 drift）。修法：收斂成 NS.isEditableTarget（namespace.js）單一資料源。
//
// 本 spec：(A) 行為驗證 isEditableTarget（slice 函式 + stub element 實跑）含
// BUTTON；(B) 結構驗證兩處 call site 都改用共用 helper（drift 不能再復現）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const NS_SRC = fs.readFileSync(path.join(ROOT, 'content', 'namespace.js'), 'utf8');
const PAGED_SRC = fs.readFileSync(path.join(ROOT, 'content', 'paged-mode.js'), 'utf8');
const SPACE_SRC = fs.readFileSync(path.join(ROOT, 'content', 'space-scroll.js'), 'utf8');

// 從 namespace.js 切出 isEditableTarget(el) {...}（物件 method shorthand），
// 包成可呼叫的 function。brace counting 找對應 close brace。
function sliceIsEditableTarget(src) {
  const m = src.match(/isEditableTarget\s*\(el\)\s*\{/);
  assert.ok(m, 'namespace.js 找不到 isEditableTarget');
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = src.slice(start, i);
  return new Function('el', body);
}
const isEditableTarget = sliceIsEditableTarget(NS_SRC);

// 最小 element stub（只實作 isEditableTarget 會讀的介面）
function el(tag, { contentEditable = null, isContentEditable = false } = {}) {
  return {
    tagName: tag,
    isContentEditable,
    getAttribute: (name) => (name === 'contenteditable' ? contentEditable : null)
  };
}

describe('(A) NS.isEditableTarget 行為（v0.8.17）', () => {
  it('INPUT / TEXTAREA / SELECT → true（編輯框放行）', () => {
    assert.strictEqual(isEditableTarget(el('INPUT')), true);
    assert.strictEqual(isEditableTarget(el('TEXTAREA')), true);
    assert.strictEqual(isEditableTarget(el('SELECT')), true);
  });
  it('BUTTON → true（C7 核心：paged 舊版漏這個 → 按鈕被翻頁攔）', () => {
    assert.strictEqual(isEditableTarget(el('BUTTON')), true);
  });
  it('contenteditable="" / "true" → true', () => {
    assert.strictEqual(isEditableTarget(el('DIV', { contentEditable: '' })), true);
    assert.strictEqual(isEditableTarget(el('DIV', { contentEditable: 'true' })), true);
  });
  it('isContentEditable=true → true', () => {
    assert.strictEqual(isEditableTarget(el('DIV', { isContentEditable: true })), true);
  });
  it('一般 DIV / P → false（內文段落不放行、照常翻頁/卷動）', () => {
    assert.strictEqual(isEditableTarget(el('DIV')), false);
    assert.strictEqual(isEditableTarget(el('P')), false);
  });
  it('null / undefined → false', () => {
    assert.strictEqual(isEditableTarget(null), false);
    assert.strictEqual(isEditableTarget(undefined), false);
  });
});

describe('(B) 兩處 call site 共用 helper（drift 不可復現）', () => {
  it('namespace.js 定義 isEditableTarget 且含 BUTTON', () => {
    assert.match(NS_SRC, /isEditableTarget\s*\(el\)\s*\{/, 'namespace.js 必須定義 isEditableTarget');
    const m = NS_SRC.match(/isEditableTarget\s*\(el\)\s*\{([\s\S]*?)\n {4}\}/);
    assert.ok(m, '抓不到 isEditableTarget body');
    assert.match(m[1], /'BUTTON'/, 'isEditableTarget 必須含 BUTTON');
  });
  it('paged-mode.js isEditableFocus 委派 NS.isEditableTarget（不再本地寫一份）', () => {
    assert.match(PAGED_SRC, /isEditableTarget\(document\.activeElement\)/,
      'paged-mode 必須呼叫共用 isEditableTarget；本地重寫會再 drift（漏 BUTTON）');
    assert.ok(!/tag === 'INPUT' \|\| tag === 'TEXTAREA' \|\| tag === 'SELECT'\)/.test(PAGED_SRC),
      'paged-mode 不該再殘留本地 INPUT/TEXTAREA/SELECT 判定（已合一到 NS）');
  });
  it('space-scroll.js shouldHandle 改用 NS.isEditableTarget', () => {
    assert.match(SPACE_SRC, /NS\.isEditableTarget\(e\.target\)/,
      'space-scroll 必須呼叫共用 NS.isEditableTarget');
  });
});
