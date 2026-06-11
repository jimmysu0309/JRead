// JRead — options 設定寫入必須是 diff write（v0.8.35）
//
// Bug：舊版 save() 把 9 欄全部從 DOM 讀回、整包 chrome.storage.sync.set。
// options 分頁開著時：popup 改 theme（直寫 sync）→ 回 options 分頁改任一欄
// （例如字級）→ save() 把 options DOM 殘留的舊 theme 一起寫回 → popup 的變更
// 被無聲還原（stale overwrite，CLAUDE.md 工作流原則 5「同一份事實多條 path
// 各自處理」的實例）。
//
// 修法兩半：
//   1. 每欄 change 只寫該欄（{ [id]: value } 單 key patch）
//   2. storage.onChanged 把其他 context 的變更同步回 DOM（全欄位 +
//      customShortcuts，不再只有 autoEnableDomains）——DOM 永遠反映 storage
//      最新值，stale 值的面消失
//
// 本 spec 用真 options.html + 真 options.js 在 jsdom 跑功能驗證（stub chrome）。
// 訊號層次：驗 set 呼叫的 patch key 集合與 onChanged → DOM 回寫；不驗真實
// chrome.storage 的跨 context broadcast 時序（只能實機）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { JREAD_DIR } = require('../helpers');

const OPTIONS_HTML = fs.readFileSync(path.join(JREAD_DIR, 'options', 'options.html'), 'utf8');
const SRC_DEFAULTS = fs.readFileSync(path.join(JREAD_DIR, 'content', 'settings-defaults.js'), 'utf8');
const SRC_DOMAIN = fs.readFileSync(path.join(JREAD_DIR, 'content', 'domain-match.js'), 'utf8');
const SRC_SHORTCUTS = fs.readFileSync(path.join(JREAD_DIR, 'content', 'shortcut-utils.js'), 'utf8');
const SRC_OPTIONS = fs.readFileSync(path.join(JREAD_DIR, 'options', 'options.js'), 'utf8');

function buildOptionsEnv() {
  const dom = new JSDOM(OPTIONS_HTML, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const setCalls = [];
  const onChangedListeners = [];
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.0.0-test' }),
      id: 'test-ext',
      getURL: () => 'chrome-extension://test-ext/',
      lastError: undefined
    },
    storage: {
      sync: {
        get: (defaults, cb) => cb({ ...defaults }),
        set: (patch, cb) => { setCalls.push(patch); if (cb) cb(); }
      },
      onChanged: { addListener: (fn) => onChangedListeners.push(fn) }
    }
  };
  window.eval(SRC_DEFAULTS);
  window.eval(SRC_DOMAIN);
  window.eval(SRC_SHORTCUTS);
  window.eval(SRC_OPTIONS);
  const fireOnChanged = (changes) => onChangedListeners.forEach((fn) => fn(changes, 'sync'));
  return { window, document: window.document, setCalls, fireOnChanged };
}

describe('options — 設定 diff write（v0.8.35）', () => {
  it('改單一欄位只寫該欄，不可整包 9 欄重寫（防 stale overwrite）', () => {
    const { window, document, setCalls } = buildOptionsEnv();
    setCalls.length = 0; // 清掉 load 階段（若有）的呼叫

    const fontSize = document.getElementById('fontSize');
    fontSize.value = '20';
    fontSize.dispatchEvent(new window.Event('change', { bubbles: true }));

    assert.strictEqual(setCalls.length, 1, 'change 一次只該觸發一次 set');
    assert.deepStrictEqual(Object.keys(setCalls[0]), ['fontSize'],
      `patch 只能含變更欄位 fontSize，實際：${JSON.stringify(setCalls[0])}`);
    assert.strictEqual(setCalls[0].fontSize, 20, '數值欄位必須 Number 轉型');
  });

  it('checkbox 與字串欄位同樣只寫單 key', () => {
    const { window, document, setCalls } = buildOptionsEnv();
    setCalls.length = 0;

    const pangu = document.getElementById('pangu');
    pangu.checked = false;
    pangu.dispatchEvent(new window.Event('change', { bubbles: true }));
    let patch = setCalls.pop();
    assert.deepStrictEqual(Object.keys(patch), ['pangu']);
    assert.strictEqual(patch.pangu, false);

    const token = document.getElementById('readwiseToken');
    token.value = '  tok-123  ';
    token.dispatchEvent(new window.Event('change', { bubbles: true }));
    patch = setCalls.pop();
    assert.deepStrictEqual(Object.keys(patch), ['readwiseToken']);
    assert.strictEqual(patch.readwiseToken, 'tok-123', 'token 必須 trim');
  });

  it('storage.onChanged 必須把其他 context 的欄位變更同步回 DOM（不只 autoEnableDomains）', () => {
    const { document, fireOnChanged } = buildOptionsEnv();

    fireOnChanged({ theme: { newValue: 'dark' } });
    assert.strictEqual(document.getElementById('theme').value, 'dark',
      'popup 改 theme 後 options DOM 必須跟著刷新');

    fireOnChanged({ fontSize: { newValue: 22 } });
    assert.strictEqual(document.getElementById('fontSize').value, '22');

    fireOnChanged({ pangu: { newValue: false } });
    assert.strictEqual(document.getElementById('pangu').checked, false);

    // 損壞的 fontWeight 值顯示退回 400（與 load 同一條 applyFieldToDom path）
    fireOnChanged({ fontWeight: { newValue: 999 } });
    assert.strictEqual(document.getElementById('fontWeight').value, '400');
  });

  it('數值欄位超界 / 留空必須 clamp 到 input min/max、退回預設（v0.8.36）', () => {
    const { window, document, setCalls } = buildOptionsEnv();
    setCalls.length = 0;

    // 超界：fontSize max=32
    const fontSize = document.getElementById('fontSize');
    fontSize.value = '999';
    fontSize.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.strictEqual(setCalls.pop().fontSize, 32, '超過 max 必須 clamp 到 input max（32）');

    // 留空：Number('') = 0 舊版會把 contentWidth 存 0；必須退回預設再 clamp
    const cw = document.getElementById('contentWidth');
    cw.value = '';
    cw.dispatchEvent(new window.Event('change', { bubbles: true }));
    const v = setCalls.pop().contentWidth;
    assert.ok(v >= 480, `留空不可存 0（實際 ${v}，必須 >= input min 480）`);
  });

  it('onChanged 同步後再改欄位，寫回的是 storage 最新值（端到端防互蓋）', () => {
    const { window, document, setCalls, fireOnChanged } = buildOptionsEnv();

    // 模擬 popup 在另一 context 改 theme
    fireOnChanged({ theme: { newValue: 'dark' } });
    setCalls.length = 0;

    // 使用者在 options 改字級——舊版這裡會把 theme:'light'（DOM 殘留）一起蓋回
    const fontSize = document.getElementById('fontSize');
    fontSize.value = '21';
    fontSize.dispatchEvent(new window.Event('change', { bubbles: true }));

    assert.ok(setCalls.every((p) => !('theme' in p)),
      '改字級不可夾帶 theme 寫回（popup 的 dark 不可被無聲還原）');
  });
});
