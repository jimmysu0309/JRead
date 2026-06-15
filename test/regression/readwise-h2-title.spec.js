// JRead — regression spec: Readwise 主標 heading 選取（v0.8.74）
// -----------------------------------------------------------------------------
// Trigger: Jimmy 2026-06-15 回報 https://stratechery.com/2026/anthropics-safety-superpower
// 用 Shinkansen 單語模式翻譯後送 Readwise，標題送的是英文原文、譯後中文標題
// 卻出現在內容裡。
//
// 根因：Stratechery wp-block post-title 是 <h2> 不是 <h1>。extractReaderTitle
// 原本只查 h1 → card 內找不到 → fallback document.title（單語翻譯不會改
// document.title）→ 送出英文原文；而譯後的 h2 主標仍在 body，buildCleanHtml
// 的 dedup 只移除「與 title 同文的 heading」，title 是原文比不中譯文 h2 → 殘留。
//
// 修法：選主標邏輯收斂到 NS.findCardTitleHeading（單一資料源 + jsdom 可測）。
// h1 優先；無 h1 時取「內文長段落之前的首個可見 h2」當主標。title 改抓譯文 h2
// 後，既有 dedup（涵蓋 h1-h6）自然把 body 內同文 h2 移除，兩個症狀一併解決。
//
// 本 spec 驗 NS.findCardTitleHeading 的選取邏輯（不驗真實 Chrome 行為，
// 那一層在 tools/probe-readwise-title.js 跑過：Stratechery title→譯文 h2、
// body 殘留 0；Wikipedia h1 不退化）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'readwise-h2-title.html');

describe('readwise — 主標 heading 選取 NS.findCardTitleHeading (v0.8.74)', () => {
  let document, NS;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: [], // 只需 namespace（helper 載入時必載）
      pretendToBeVisual: true
    });
    document = env.document;
    NS = env.NS;
    assert.ok(NS && typeof NS.findCardTitleHeading === 'function',
      'NS.findCardTitleHeading 必須存在（namespace.js 單一資料源）');
  });

  it('(A) 主標是 h2（post-title，內文之前）→ 回 h2 文字', () => {
    const card = document.getElementById('card-h2-title');
    assert.strictEqual(NS.findCardTitleHeading(card), 'Anthropic的安全超能力');
  });

  it('(B) 有 h1 時優先回 h1（v0.8.50 行為延續，不被 h2 fallback 取代）', () => {
    const card = document.getElementById('card-h1-title');
    assert.strictEqual(NS.findCardTitleHeading(card), '網頁瀏覽器');
  });

  it('(C) 無 h1、首個 h2 在內文長段落之後（section heading）→ 回空字串（main 才會 fallback document.title）', () => {
    const card = document.getElementById('card-section-h2-only');
    assert.strictEqual(NS.findCardTitleHeading(card), '');
  });

  it('(D) h2 主標被 [data-jread-hidden] 標記隱藏 → 跳過、回空字串', () => {
    const card = document.getElementById('card-hidden-h2');
    assert.strictEqual(NS.findCardTitleHeading(card), '');
  });

  it('(E) card 為 null / 無 querySelectorAll → 回空字串（不丟例外）', () => {
    assert.strictEqual(NS.findCardTitleHeading(null), '');
    assert.strictEqual(NS.findCardTitleHeading({}), '');
  });

  // forcing function：main.js extractReaderTitle 必須走 NS.findCardTitleHeading
  // 單一資料源（不可在 main.js 內各自重寫 h1 掃描邏輯而 drift）。
  it('(F) main.js extractReaderTitle 必須呼叫 NS.findCardTitleHeading', () => {
    const fs = require('fs');
    const mainSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8');
    assert.match(mainSrc, /function\s+extractReaderTitle\s*\(/,
      'main.js 必須有 extractReaderTitle');
    assert.match(mainSrc, /NS\.findCardTitleHeading\s*\(/,
      'extractReaderTitle 必須呼叫 NS.findCardTitleHeading（單一資料源）');
  });
});
