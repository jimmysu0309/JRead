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
  // v0.8.158：theme / fontSize / titleFontSize / contentWidth / fontWeight 已移到
  // popup，options 改用剩餘的 number 欄位（spaceScrollRatio / positionMemoryDays）驗 diff write。
  it('改單一欄位只寫該欄，不可整包重寫（防 stale overwrite）', () => {
    const { window, document, setCalls } = buildOptionsEnv();
    setCalls.length = 0; // 清掉 load 階段（若有）的呼叫

    const el = document.getElementById('spaceScrollRatio');
    el.value = '40';
    el.dispatchEvent(new window.Event('change', { bubbles: true }));

    assert.strictEqual(setCalls.length, 1, 'change 一次只該觸發一次 set');
    assert.deepStrictEqual(Object.keys(setCalls[0]), ['spaceScrollRatio'],
      `patch 只能含變更欄位 spaceScrollRatio，實際：${JSON.stringify(setCalls[0])}`);
    assert.strictEqual(setCalls[0].spaceScrollRatio, 40, '數值欄位必須 Number 轉型');
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

    fireOnChanged({ floatingIconSize: { newValue: 'large' } });
    assert.strictEqual(document.getElementById('floatingIconSize').value, 'large',
      '其他 context 改 floatingIconSize 後 options DOM 必須跟著刷新');

    fireOnChanged({ spaceScrollRatio: { newValue: 30 } });
    assert.strictEqual(document.getElementById('spaceScrollRatio').value, '30');

    fireOnChanged({ pangu: { newValue: false } });
    assert.strictEqual(document.getElementById('pangu').checked, false);
  });

  it('數值欄位超界 / 留空必須 clamp 到 input min/max、退回預設（v0.8.36）', () => {
    const { window, document, setCalls } = buildOptionsEnv();
    setCalls.length = 0;

    // 超界：spaceScrollRatio max=90
    const ssr = document.getElementById('spaceScrollRatio');
    ssr.value = '999';
    ssr.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.strictEqual(setCalls.pop().spaceScrollRatio, 90, '超過 max 必須 clamp 到 input max（90）');

    // 留空：Number('') = 0；必須退回預設（positionMemoryDays 預設 3）再 clamp，不可存成空帶來的 0
    const pmd = document.getElementById('positionMemoryDays');
    pmd.value = '';
    pmd.dispatchEvent(new window.Event('change', { bubbles: true }));
    const v = setCalls.pop().positionMemoryDays;
    assert.strictEqual(v, 3, `留空必須退回預設 3（實際 ${v}），不可因空字串存成 0`);
  });

  it('onChanged 同步後再改欄位，寫回的是 storage 最新值（端到端防互蓋）', () => {
    const { window, document, setCalls, fireOnChanged } = buildOptionsEnv();

    // 模擬其他 context 改 floatingIconSize
    fireOnChanged({ floatingIconSize: { newValue: 'large' } });
    setCalls.length = 0;

    // 使用者在 options 改 spaceScrollRatio——舊版這裡會把殘留欄位一起蓋回
    const ssr = document.getElementById('spaceScrollRatio');
    ssr.value = '35';
    ssr.dispatchEvent(new window.Event('change', { bubbles: true }));

    assert.ok(setCalls.every((p) => !('floatingIconSize' in p)),
      '改 spaceScrollRatio 不可夾帶 floatingIconSize 寫回（其他 context 的 large 不可被無聲還原）');
  });
});
