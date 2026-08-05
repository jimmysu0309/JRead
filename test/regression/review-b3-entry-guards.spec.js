// JRead — v1.7.41（review 批次 3）：M2 / M3 / G1 / R1 / R2 五條 guard 修法
// -----------------------------------------------------------------------------
// M2：enterGenericReaderMode 的 await getSettings 空窗遇 SPA 真導航——await 回來
//     後對 disconnected 的舊 el 完成整套 enter（active=true 但畫面無卡片、800ms
//     輪詢因 _spaLastUrl 已更新不會修正）。修法：await 後補 isConnected guard。
// M3：懸浮圖示面板開啟時按 ESC——onEscKey（早註冊、capture 先執行）
//     stopPropagation + 退出閱讀模式，與 floating-icon panelKeyHandler 關面板
//     互撞。修法：panel 開啟時 onEscKey 讓位。
// G1：touch-gestures 缺重複注入 guard（touchstart/touchend 掛兩份 → 3 指輕點
//     toggle 兩次＝沒反應）；且 `window.__JRead || {}` 與「!NS 即 bail」慣例
//     相反（namespace 缺席時 fallback 路徑在 NS.MSG 上 TypeError）。
// R1：reader-article getArticle 無 rejection handler——非預期 reject 永遠卡
//     「載入中」（對照組 reader-feed.js 雙 handler 教訓沒套到 article 頁）。
// R2：popup panel 模式（?panel=1 iframe）四條按鈕路徑只呼 window.close()
//     （iframe 內 no-op）——按完浮層收不掉、backdrop 蓋住剛進入的閱讀模式。
//     修法：close 前先 closePanel()（postMessage 收浮層；非 panel no-op）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const MAIN_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'main.js'), 'utf8');
const TOUCH_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'touch-gestures.js'), 'utf8');
const NAMESPACE_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'namespace.js'), 'utf8');
const READER_ARTICLE_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'reader', 'reader-article.js'), 'utf8');
const POPUP_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'popup', 'popup.js'), 'utf8');

describe('main.js v1.7.41 — enter await 空窗 disconnected guard（M2）', () => {
  it('enterGenericReaderMode 在 await getSettings 之後必須驗 result.el.isConnected', () => {
    const m = MAIN_SRC.match(/async function enterGenericReaderMode[\s\S]*?\n  \}/);
    assert.ok(m, '抓不到 enterGenericReaderMode');
    const body = m[0];
    const awaitIdx = body.indexOf('await getSettings()');
    const guardIdx = body.indexOf('result.el.isConnected');
    const assignIdx = body.indexOf('NS.state.articleEl = result.el');
    assert.ok(awaitIdx !== -1 && guardIdx !== -1 && assignIdx !== -1,
      '必須有 await getSettings + isConnected guard + articleEl 賦值');
    assert.ok(awaitIdx < guardIdx && guardIdx < assignIdx,
      'isConnected guard 必須在 await 之後、掛 state 之前（SPA 導航空窗對 disconnected el 完成 enter）');
  });
});

describe('main.js v1.7.41 — ESC 讓位懸浮面板（M3）', () => {
  it('onEscKey 開頭必須查 NS.floating.isPanelOpen() 讓位', () => {
    const m = MAIN_SRC.match(/function onEscKey[\s\S]*?\n  \}/);
    assert.ok(m, '抓不到 onEscKey');
    const body = m[0];
    const panelIdx = body.indexOf('isPanelOpen');
    const exitIdx = body.indexOf('exitReaderMode()');
    assert.ok(panelIdx !== -1, 'onEscKey 必須查 floating panel 開啟狀態');
    assert.ok(panelIdx < exitIdx,
      'panel guard 必須在 exitReaderMode 之前（讓 panelKeyHandler 關面板、不同時退出閱讀模式）');
  });
});

describe('touch-gestures v1.7.41 — 重複注入 guard + !NS bail（G1）', () => {
  function buildWin() {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
    const { window } = dom;
    Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 5, configurable: true });
    window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't' } };
    window.browser = {
      runtime: { id: 't', getManifest: () => ({ version: '0.0.0-test' }) },
      storage: {
        sync: { get: () => Promise.resolve({ threeFingerTap: false }) },
        onChanged: { addListener: () => {} }
      }
    };
    // 攔 document.addEventListener 計數 touch listener 掛載次數
    const counts = { touchstart: 0, touchend: 0 };
    const origAdd = window.document.addEventListener.bind(window.document);
    window.document.addEventListener = (type, fn, opts) => {
      if (type in counts) counts[type]++;
      return origAdd(type, fn, opts);
    };
    return { window, counts };
  }

  it('重複 eval 不得疊 touch listener（3 指輕點 toggle 兩次＝沒反應）', () => {
    const { window, counts } = buildWin();
    window.eval(NAMESPACE_SRC);
    window.eval(TOUCH_SRC);
    assert.strictEqual(counts.touchstart, 1, '首次注入掛 1 份 touchstart');
    window.eval(TOUCH_SRC);  // SPA 導航重複注入
    assert.strictEqual(counts.touchstart, 1, '重複注入不得再掛 touchstart（installed guard）');
    assert.strictEqual(counts.touchend, 1, '重複注入不得再掛 touchend');
    assert.strictEqual(window.__JRead._touchGesturesInstalled, true, 'guard 旗標必須掛在 NS 上');
  });

  it('namespace 缺席時 bail、不安裝（fallback 路徑用 NS.MSG 會 TypeError）', () => {
    const { window, counts } = buildWin();
    window.eval(TOUCH_SRC);  // 不載 namespace
    assert.strictEqual(counts.touchstart, 0, '無 NS 時不得安裝 listener');
    assert.ok(!/window\.__JRead = window\.__JRead \|\| \{\}/.test(TOUCH_SRC),
      '不得殘留「|| {} 造空 namespace」寫法（與 !NS 即 bail 慣例相反）');
  });
});

describe('reader-article v1.7.41 — getArticle rejection handler（R1）', () => {
  it('PC.getArticle 的 then 必須帶第二個 handler surface 錯誤（不卡「載入中」）', () => {
    assert.ok(
      /PC\.getArticle\(\{[^}]*\}\)\.then\(\(r\) => \{[\s\S]*?\}, \(err\) => \{[\s\S]*?載入失敗/.test(READER_ARTICLE_SRC),
      'getArticle 必須有 rejection handler 並 setStatus 載入失敗（與 reader-feed listDocuments 同款雙 handler）');
  });
});

describe('popup v1.7.41 — panel 模式四條 close 路徑收浮層（R2）', () => {
  it('每個 window.close() 前都必須先 closePanel()', () => {
    const closeCalls = POPUP_SRC.match(/window\.close\(\)/g) || [];
    assert.ok(closeCalls.length >= 4, `popup 至少 4 條 close 路徑（目前 ${closeCalls.length}）`);
    const paired = POPUP_SRC.match(/closePanel\(\);[^\n]*\n[^\n]*\n\s*window\.close\(\)/g) || [];
    assert.strictEqual(paired.length, closeCalls.length,
      `每個 window.close() 前都必須 closePanel()（${paired.length}/${closeCalls.length}）——panel 模式自關無效、浮層 backdrop 會蓋住頁面`);
  });
});
