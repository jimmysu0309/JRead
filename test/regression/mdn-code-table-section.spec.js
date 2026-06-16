// JRead — regression spec: MDN 程式碼塊 / 資料表 section 保留（v0.8.79 實測）
// -----------------------------------------------------------------------------
// Trigger: Page Rounds 2026-06-15 第六輪 — developer.mozilla.org/.../Array/at 進閱讀
// 模式後 reader card 在「Comparing methods」截斷：Examples 的程式碼範例（<pre> 在
// <mdn-code-example> web component 的 shadow DOM）+ Specifications / Browser
// compatibility 表格整段消失。harness 誤判 PASS（retention 只算 <p>，抓不到 code/table
// 被丟），靠肉眼看截圖才發現。
//
// Root cause（probe 確認，3 條 rule 共同誤殺）：這些 section 無 <p>、內容在 shadow
// DOM / custom element / table，cleaner 的「有長 p / media / h1」白名單全 miss：
//   - narrowPromotedSiblings 把 promotedFrom 兄弟 section 當 chrome 砍
//   - hideInsideArticleEmptySpacers 把 <h2>+空殼 section 當 spacer
//   - hideInsideArticleSidebarColumns 把低文字 section 當 sidebar column
//
// 修法（v0.8.79）：共用 helper hasCodeOrDataTableContent（單一資料源，三 rule 共用）
// 放行含主文級非段落內容的 section：
//   - light DOM <pre>（不在 <a> 內）
//   - 程式碼 / 表格 web component：custom element（tag 含 '-'）tag 名含 CODE / TABLE
//     （race-free，不 peek shadow——避開 hydration 競態）
//   - 資料表 <table>（>= 2 列 <tr>，不在 <a>/<li> 卡片內）
// + collapseEmptyWrappersAfterClean / collapseEmptyBlockSpacers 跳過 shadowRoot host
//   （內容在 shadow DOM、light textContent 空，非空殼——見 shadow-host spec）
//
// 本 spec 走 narrowPromotedSiblings 路徑（rect-independent，jsdom 可重現）：detector
// 落在最長 prose 的 Description、promote 到 #root，narrow 砍 promotedFrom 兄弟 section。
// forcing：拿掉 hasCodeOrDataTableContent guard → code/table section 全被 hide（實證）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const DETECTOR_SRC = fs.readFileSync(path.join(ROOT, 'content', 'detector.js'), 'utf8');
const CLEANER_SRC = fs.readFileSync(path.join(ROOT, 'content', 'cleaner.js'), 'utf8');

describe('cleaner — MDN 程式碼塊 / 資料表 section 保留（v0.8.79）', () => {
  let document, result;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'mdn-code-table-section.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    const window = dom.window;
    document = window.document;
    window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
    window.eval(require('../helpers').SRC.namespace);
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中');
    window.__JRead.cleaner.clean(result.el, { promotedFrom: result.promotedFrom });
  });

  it('forcing: detector 必須 promote（promotedFrom 為 Description section、articleEl 為 #root）', () => {
    // narrow 路徑只在 promotedFrom 為 articleEl 後代時才走——此 forcing 確保
    // 將來改 fixture 不會讓 detector 改走 article-tag 策略（promotedFrom 消失）導致
    // narrow 不執行、spec 變成空轉假綠。
    assert.strictEqual(result.el.id, 'root', 'articleEl 應 promote 到 #root');
    assert.ok(result.promotedFrom, 'detector 應有 promotedFrom（否則 narrow 不執行）');
    assert.strictEqual(result.promotedFrom.id, 'sec-description',
      'promotedFrom 應為最長 prose 的 Description section');
  });

  it('Syntax section（<mdn-code-example>，程式碼在 shadow DOM）保留', () => {
    const el = document.getElementById('sec-syntax');
    assert.notStrictEqual(el.dataset.jreadHidden, '1');
    assert.ok(!el.closest('[data-jread-hidden="1"]'),
      'Syntax section 含 <mdn-code-example>（tag 名含 CODE），須由 code guard 保留');
  });

  it('Examples section（light DOM <pre>）保留 + <pre> 可見', () => {
    const sec = document.getElementById('sec-example');
    const pre = document.getElementById('example-pre');
    assert.notStrictEqual(sec.dataset.jreadHidden, '1');
    assert.ok(!pre.closest('[data-jread-hidden="1"]'), '<pre> 程式碼塊不可在 hidden 子樹內');
  });

  it('Specifications section（資料 <table> >= 2 tr）保留 + table 可見', () => {
    const sec = document.getElementById('sec-spec');
    const tbl = document.getElementById('spec-table');
    assert.notStrictEqual(sec.dataset.jreadHidden, '1');
    assert.ok(!tbl.closest('[data-jread-hidden="1"]'), '資料表不可在 hidden 子樹內');
  });

  it('Browser compatibility section（<mdn-compat-table-lazy>，tag 含 TABLE）保留', () => {
    const el = document.getElementById('sec-compat');
    assert.notStrictEqual(el.dataset.jreadHidden, '1');
    assert.ok(!el.closest('[data-jread-hidden="1"]'),
      'Browser compatibility section 含 <mdn-compat-table-lazy>（tag 名含 TABLE），須由 guard 保留');
  });

  it('See also（純連結列、無程式碼 / 表格）仍被 hide（guard 不過度放行）', () => {
    const el = document.getElementById('sec-seealso');
    assert.strictEqual(el.dataset.jreadHidden, '1',
      'See also 只是連結列、非程式碼 / 表格內容，須仍被清；guard 只認 pre/code/table widget，不誤放連結列');
  });

  it('sidebar nav（連結 chrome）仍被 hide', () => {
    const el = document.getElementById('sidebar');
    assert.strictEqual(el.dataset.jreadHidden, '1', 'sidebar nav 連結列須仍被清');
  });

  it('導覽表（<table role="navigation">，Wikipedia navbox 型）仍被 hide——table guard 排除 nav', () => {
    const el = document.getElementById('sec-navbox');
    assert.strictEqual(el.dataset.jreadHidden, '1',
      'role=navigation 內的 <table> 是導覽 chrome、非資料表，須仍被清；' +
      '若 table guard 不排除 [role="navigation"]/nav → navbox 被誤保留（zh.wikipedia contrast regression）');
  });

  it('Description 主文 section 保留', () => {
    const el = document.getElementById('sec-description');
    assert.notStrictEqual(el.dataset.jreadHidden, '1');
  });
});
