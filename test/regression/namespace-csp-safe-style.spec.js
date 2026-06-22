// JRead — NS.injectCssText / removeCssText：CSP-safe 樣式注入（v0.8.130）
//
// 對應 bug：自架 Miniflux 閱讀頁下嚴格 `style-src 'nonce-...'`（無 unsafe-inline）。
// Chrome 對 content-script 注入的 <style> 有豁免、照樣生效；WebKit / Safari 不豁免，
// 套頁面 CSP 把注入 <style> 擋掉 → 同一頁在 iPhone 沒套到 JRead 版型 CSS、在 Chrome
// 正常（Jimmy 2026-06-19 回報）。styler / edit-mode / cinema / youtube-borderless
// 原本各自 createElement('style') 共 4 份相同實作，抽成 NS.injectCssText 單一資料源
// （CLAUDE.md 硬規則 5），被 CSP 擋（styleEl.sheet === null）時退回 constructable
// stylesheet 經 document.adoptedStyleSheets 套用（不受 style-src 管轄）。
//
// 驗哪一層：本 spec 驗「注入 fallback 的邏輯與生命週期」（被擋偵測 → adopted 退回
// → 還原清乾淨 → 不可退回時 graceful degrade）。**不驗** WebKit 真的會擋 <style>
// （jsdom / Chromium 都不會）——那一層由 iOS 真機 / 模擬器驗。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'csp-safe-style.html');
const STYLE_ID = '__jread-test-style';
const CSS = 'body{color:red}';

describe('namespace — NS.injectCssText / removeCssText（v0.8.130 CSP-safe 注入）', () => {
  let window, document, NS;
  let sheetGetter;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: [],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    NS = window.__JRead;
    // 用可切換的 getter 控制注入 <style> 的 .sheet（模擬 CSP 擋 / 不擋），不依賴
    // jsdom 原生 CSSOM 行為。預設「不擋」（回傳 truthy 物件）。
    sheetGetter = { value: {} };
    Object.defineProperty(window.HTMLStyleElement.prototype, 'sheet', {
      get() { return sheetGetter.value; },
      configurable: true
    });
  });

  afterEach(() => {
    NS.removeCssText(STYLE_ID);
    sheetGetter.value = {}; // 還原成「不擋」
    delete window.CSSStyleSheet;
    if (window.Document && window.Document.prototype) {
      delete window.Document.prototype.adoptedStyleSheets;
    }
    if (window.ShadowRoot && window.ShadowRoot.prototype) {
      delete window.ShadowRoot.prototype.adoptedStyleSheets;
    }
    delete document.adoptedStyleSheets;
  });

  // 安裝 constructable-stylesheet 支援的假環境（jsdom 原生不支援）
  function stubAdoptable() {
    const replaceCalls = [];
    window.CSSStyleSheet = class {
      replaceSync(css) { this.cssText = css; replaceCalls.push(css); }
    };
    // _canAdoptStyles 檢查 'adoptedStyleSheets' in Document.prototype
    window.Document.prototype.adoptedStyleSheets = [];
    document.adoptedStyleSheets = [];
    return replaceCalls;
  }

  it('一般站（<style> 未被擋）：只注入 marker <style>，不走 adopted fallback', () => {
    sheetGetter.value = {}; // sheet 非 null = 沒被 CSP 擋
    NS.injectCssText(STYLE_ID, CSS);

    const el = document.getElementById(STYLE_ID);
    assert.ok(el, 'marker <style> 應存在');
    assert.strictEqual(el.tagName, 'STYLE');
    assert.strictEqual(el.textContent, CSS);
    assert.ok(!NS._adoptedStyles.has(STYLE_ID), '未被擋不可建立 adopted sheet');
  });

  it('被 CSP 擋（sheet=null）且環境支援 adopted：退回 constructable stylesheet', () => {
    const replaceCalls = stubAdoptable();
    sheetGetter.value = null; // 模擬注入 <style> 被 CSP 擋

    NS.injectCssText(STYLE_ID, CSS);

    assert.ok(document.getElementById(STYLE_ID), 'marker <style> 仍保留供 guard / 還原');
    assert.ok(NS._adoptedStyles.has(STYLE_ID), '應建立 adopted sheet 條目');
    const sheet = NS._adoptedStyles.get(STYLE_ID);
    assert.strictEqual(sheet.cssText, CSS, 'adopted sheet 應帶正確 CSS');
    assert.ok(document.adoptedStyleSheets.includes(sheet), 'sheet 應掛進 document.adoptedStyleSheets');
    assert.deepStrictEqual(replaceCalls, [CSS]);
  });

  it('fallback 模式下再次 inject：更新既有 adopted sheet，不重複掛載', () => {
    const replaceCalls = stubAdoptable();
    sheetGetter.value = null;

    NS.injectCssText(STYLE_ID, CSS);
    NS.injectCssText(STYLE_ID, 'body{color:blue}');

    const sheets = document.adoptedStyleSheets.filter((s) => s === NS._adoptedStyles.get(STYLE_ID));
    assert.strictEqual(sheets.length, 1, 'adopted sheet 只能掛一份');
    assert.strictEqual(NS._adoptedStyles.get(STYLE_ID).cssText, 'body{color:blue}');
    assert.deepStrictEqual(replaceCalls, [CSS, 'body{color:blue}']);
  });

  it('removeCssText：marker <style> 與 adopted sheet 都清乾淨（對稱還原）', () => {
    stubAdoptable();
    sheetGetter.value = null;
    NS.injectCssText(STYLE_ID, CSS);
    const sheet = NS._adoptedStyles.get(STYLE_ID);

    NS.removeCssText(STYLE_ID);

    assert.ok(!document.getElementById(STYLE_ID), 'marker <style> 應移除');
    assert.ok(!NS._adoptedStyles.has(STYLE_ID), 'adopted 條目應移除');
    assert.ok(!document.adoptedStyleSheets.includes(sheet), 'sheet 應從 adoptedStyleSheets 移除');
  });

  it('被擋但環境不支援 adopted（舊 WebKit）：graceful degrade，不丟例外', () => {
    sheetGetter.value = null; // 被擋
    // 不 stubAdoptable → 無 CSSStyleSheet / adoptedStyleSheets
    assert.doesNotThrow(() => NS.injectCssText(STYLE_ID, CSS));
    const el = document.getElementById(STYLE_ID);
    assert.ok(el, 'marker <style> 仍存在（最壞回到 bug 前狀態）');
    assert.strictEqual(el.textContent, CSS);
    assert.ok(!NS._adoptedStyles.has(STYLE_ID));
  });

  // NS.injectShadowCss：同根因的 Shadow DOM 版（v0.8.159 懸浮按鈕尺寸修復）。
  // 懸浮按鈕 / toast 用獨立 Shadow DOM host，CSS 注入 shadow 內的 <style>；自架
  // Miniflux 嚴格 style-src 在 WebKit 連 shadow <style> 都擋 → .fab 拿不到
  // var(--fab-hit) 寬高、icon 退回 <img> 原生 32px 無視尺寸設定 → 退回
  // shadow.adoptedStyleSheets。本段驗 fallback 邏輯；WebKit 真會擋那層靠 iOS 真機。
  describe('NS.injectShadowCss — Shadow DOM 內的 CSP-safe 注入', () => {
    function makeShadow() {
      const hostEl = document.createElement('div');
      document.body.appendChild(hostEl);
      const shadow = hostEl.attachShadow({ mode: 'open' });
      // jsdom 的 ShadowRoot 沒有 adoptedStyleSheets，用實例屬性模擬可讀寫
      let adopted = [];
      Object.defineProperty(shadow, 'adoptedStyleSheets', {
        get() { return adopted; },
        set(v) { adopted = v; },
        configurable: true
      });
      return shadow;
    }

    it('一般站（sheet 非 null）：只注入 <style>，不掛 adoptedStyleSheets', () => {
      sheetGetter.value = {};
      const shadow = makeShadow();
      const el = NS.injectShadowCss(shadow, CSS);
      assert.ok(el && el.tagName === 'STYLE', '回傳 marker <style>');
      assert.strictEqual(shadow.querySelector('style').textContent, CSS);
      assert.strictEqual(shadow.adoptedStyleSheets.length, 0, '未被擋不可走 fallback');
    });

    it('被 CSP 擋（sheet=null）+ 環境支援：退回 shadow.adoptedStyleSheets', () => {
      const replaceCalls = stubAdoptable();
      window.ShadowRoot.prototype.adoptedStyleSheets = []; // canAdopt 檢查需要
      sheetGetter.value = null;
      const shadow = makeShadow();
      NS.injectShadowCss(shadow, CSS);
      assert.ok(shadow.querySelector('style'), 'marker <style> 仍保留');
      assert.strictEqual(shadow.adoptedStyleSheets.length, 1, '應掛一份 adopted sheet');
      assert.strictEqual(shadow.adoptedStyleSheets[0].cssText, CSS, 'adopted sheet 帶正確 CSS');
      assert.deepStrictEqual(replaceCalls, [CSS]);
    });

    it('被擋但環境不支援 adopted：graceful，不丟例外、保留 <style>', () => {
      sheetGetter.value = null;
      const shadow = makeShadow();
      assert.doesNotThrow(() => NS.injectShadowCss(shadow, CSS));
      assert.ok(shadow.querySelector('style'), 'marker <style> 仍存在');
      assert.strictEqual(shadow.adoptedStyleSheets.length, 0, '不支援時不掛 adopted');
    });
  });
});
