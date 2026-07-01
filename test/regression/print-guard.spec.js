// JRead — 列印防護（print guard）regression spec（v1.5.27）
//
// 背景：JRead 注入頁面的常駐 / 浮動 UI（懸浮按鈕、閱讀進度條、翻頁頁碼、toast、
// 編輯工具列等）都是高 z-index 的 fixed / absolute 元素，掛在 documentElement。
// 使用者列印頁面（Ctrl+P 或站點自身列印，如 Google Docs）時瀏覽器會把這些浮動
// UI 一起印進去（Jimmy 2026-07-01 回報，姊妹專案 Shinkansen 同款 bug）。修法：
// main.js 在 top frame 注入一條 @media print 規則，把所有 JRead 注入 UI 的 host
// id 隱藏。
//
// 訊號層次：本檔驗「main.js 的 print guard CSS 涵蓋所有已知注入 UI host id」
// （forcing function：新增注入 UI 卻忘了加進 print guard 會 fail）+「NS.injectCssText
// 真的把這段 CSS 注入成 <style>」（功能性）。**不驗**「@media print 真的隱藏元素」
// ——jsdom 無 layout / 不套 print media，那層由 Playwright harness emulateMedia('print')
// 驗（見 /harness-verify）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const JREAD = path.join(ROOT, 'jread');
const NS_SRC = fs.readFileSync(path.join(JREAD, 'content', 'namespace.js'), 'utf8');
const MAIN_SRC = fs.readFileSync(path.join(JREAD, 'content', 'main.js'), 'utf8');

const GUARD_ID = '__jread-print-guard';

// 所有「列印時必須隱藏」的注入 UI host / 元素 id。每個 id 的單一資料源在對應
// content script（見右側檔名）——新增常駐 / 浮動注入 UI 時，必須同步把它的 host id
// 加進 main.js 的 print guard **與**此清單，否則本 spec fail。
// （scrub-fill 是 scrub-track 的子節點、haptic 本身 display:none，故不需個別列。）
const REQUIRED_IDS = [
  '__jread-floating-host',   // floating-icon.js 懸浮按鈕（回報主兇）
  '__jread-panel-host',      // floating-icon.js 長按選單面板
  '__jread-toast-host',      // toast.js
  '__jread-editmode-host',   // edit-mode.js 編輯工具列
  '__jread-page-indicator',  // paged-mode.js 翻頁頁碼
  '__jread-scrub-track',     // paged-mode.js 翻頁進度條
  '__jread-focus-bar',       // space-scroll.js 空白鍵捲動焦點條
  '__jread-progress'         // styler.js 閱讀進度條
];

// 從 main.js 抽出 print guard 那段 CSS 字串（injectCssText 的第二個 template 引數）。
function extractGuardCss() {
  const m = MAIN_SRC.match(/injectCssText\('__jread-print-guard',\s*`([\s\S]*?)`\)/);
  assert.ok(m, 'main.js 必須以 NS.injectCssText 注入 __jread-print-guard');
  return m[1];
}

describe('print guard — 列印時隱藏所有 JRead 注入 UI（v1.5.27）', () => {
  it('print guard CSS 是 @media print + display:none !important', () => {
    const css = extractGuardCss();
    assert.ok(/@media\s+print\s*\{/.test(css), 'print guard 必須包在 @media print 區塊內');
    assert.ok(/display:\s*none\s*!important/.test(css), 'print guard 必須用 display: none !important');
  });

  it('forcing function：涵蓋所有已知注入 UI host id', () => {
    const css = extractGuardCss();
    for (const id of REQUIRED_IDS) {
      assert.ok(css.includes('#' + id), `print guard 漏了注入 UI host：#${id}`);
    }
  });

  it('只在 top frame 注入（避免每個 iframe 各注一份）', () => {
    assert.ok(
      /injectPrintGuard[\s\S]{0,240}window\.top\s*!==\s*window\.self/.test(MAIN_SRC),
      'injectPrintGuard 必須有 window.top !== window.self 的 top-frame guard'
    );
  });

  it('NS.injectCssText 真的把 guard CSS 注入成 <style>', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'https://example.com/' });
    const { window } = dom;
    const browserMock = { runtime: { getManifest: () => ({ version: '0.0.0' }) } };
    window.browser = browserMock;

    // 載入 namespace.js 建立 window.__JRead（含 injectCssText）
    vm.runInNewContext(NS_SRC, {
      window, document: window.document, globalThis: window,
      browser: browserMock, chrome: browserMock,
      CSSStyleSheet: window.CSSStyleSheet, Document: window.Document, ShadowRoot: window.ShadowRoot,
      Map, Node: window.Node
    });

    const NS = window.__JRead;
    assert.ok(NS && typeof NS.injectCssText === 'function', 'namespace.js 須提供 NS.injectCssText');

    NS.injectCssText(GUARD_ID, extractGuardCss());

    const styleEl = window.document.getElementById(GUARD_ID);
    assert.ok(styleEl && styleEl.tagName === 'STYLE', 'injectCssText 須建立 <style id="__jread-print-guard">');
    assert.ok(styleEl.textContent.includes('@media print'), '注入的 <style> 須含 @media print');
    for (const id of REQUIRED_IDS) {
      assert.ok(styleEl.textContent.includes('#' + id), `注入的 <style> 應含 #${id}`);
    }
  });
});
