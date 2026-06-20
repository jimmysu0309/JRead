// JRead — regression spec: Shinkansen 雙語模式送 Readwise 只留中文譯文（v0.8.126）
//
// Trigger: Jimmy 2026-06-19 theverge.com PopSockets 翻譯後回報——送到 Readwise Reader
// 的文章每段同時出現英文原文 +「它的譯文」（"The Low-Pro is about as thick as two
// stacked dimes when collapsed." + 中譯）。Jimmy 選「只留中文譯文」。
//
// 根因：Shinkansen dual 模式對每段保留原文 element（標 data-shinkansen-dual-source）
// + 注入 <shinkansen-translation> wrapper（內含 inner = 真實 block tag 的譯文）。JRead
// buildCleanHtml 的 outerHTML 把兩份都帶上。
//
// 修法（NS.collapseShinkansenDual，結構通則、非站點/class 特判，對源碼核實結構）：
//   1. 每個 [data-shinkansen-dual-source]：內含 wrapper（LI/TD/TH append 模式）→ 把
//      自身內容換成 wrapper 的譯文 inner；否則（block/inline sibling 模式）整個移除。
//   2. 剩餘 <shinkansen-translation> wrapper → unwrap 成 inner（p/div 等 block）。
// 在 clone 上操作、不動 live reader 雙語顯示。
//
// 真實 Chrome 端到端（注入 dual 結構 → EXTRACT_READER_HTML → payload 只剩中文、無
// shinkansen tag/attr）在 Playwright probe 驗過；本 spec 驗 NS 純函式（jsdom）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'readwise-shinkansen-dual.html');

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: [], // 只需 namespace
    pretendToBeVisual: true
  });
  return env;
}

describe('readwise — Shinkansen 雙語只留中文譯文（v0.8.126）', () => {
  it('NS.collapseShinkansenDual 存在（namespace.js 單一資料源）', () => {
    const { NS } = setup();
    assert.strictEqual(typeof NS.collapseShinkansenDual, 'function');
  });

  // v0.8.138：翻譯偵測單一資料源——cleaner translationGuardActive（標題 promote 位置）
  // 與 main extractReaderPayload（Readwise should_clean_html gate）共用。本 fixture 含
  // data-shinkansen-dual-source 元素 → 視為翻譯頁。
  it('NS.isTranslatedPage：含 data-shinkansen-dual-source → true', () => {
    const { NS } = setup();
    assert.strictEqual(typeof NS.isTranslatedPage, 'function');
    assert.strictEqual(NS.isTranslatedPage(), true);
  });

  it('NS.isTranslatedPage：清掉翻譯標記 → false（非翻譯頁）', () => {
    const { document, NS } = setup();
    document.querySelectorAll('[data-shinkansen-dual-source]').forEach(el => el.removeAttribute('data-shinkansen-dual-source'));
    document.querySelectorAll('[data-shinkansen-translated]').forEach(el => el.removeAttribute('data-shinkansen-translated'));
    assert.strictEqual(NS.isTranslatedPage(), false);
  });

  it('(block) 原文 <p> 移除、譯文保留', () => {
    const { document, NS } = setup();
    const root = document.getElementById('story');
    NS.collapseShinkansenDual(root);
    assert.strictEqual(document.getElementById('orig-block'), null, '原文 <p> 必須移除');
    assert.ok(!root.querySelector('shinkansen-translation'), 'wrapper 必須 unwrap 掉');
    assert.ok(/兩枚 10 分錢硬幣/.test(root.textContent), '中文譯文必須保留');
    assert.ok(!/two stacked dimes/.test(root.textContent), '英文原文必須消失');
  });

  it('(block) unwrap 後譯文是真實 block tag（inner <p>，非 custom element）', () => {
    const { document, NS } = setup();
    NS.collapseShinkansenDual(document.getElementById('story'));
    const inner = document.getElementById('inner-block');
    assert.ok(inner, 'inner <p> 譯文節點保留');
    assert.strictEqual(inner.tagName, 'P');
    assert.strictEqual(inner.closest('shinkansen-translation'), null, 'inner 不再被 wrapper 包住');
  });

  it('(blockquote) 同 sibling 模式：原文移除、譯文 blockquote 保留', () => {
    const { document, NS } = setup();
    const root = document.getElementById('story');
    NS.collapseShinkansenDual(root);
    assert.strictEqual(document.getElementById('orig-bq'), null);
    assert.ok(/難以置信/.test(root.textContent));
    assert.ok(!/incredibly thin/.test(root.textContent));
  });

  it('(LI append) wrapper 在 original 內：li 保留、內容換成譯文', () => {
    const { document, NS } = setup();
    const root = document.getElementById('story');
    NS.collapseShinkansenDual(root);
    const li = document.getElementById('orig-li');
    assert.ok(li, 'li 容器本身保留（append 模式不可整個移除、否則連譯文一起沒）');
    assert.ok(!li.querySelector('shinkansen-translation'), 'li 內 wrapper 已 unwrap');
    assert.ok(/磁吸式安裝系統/.test(li.textContent), 'li 內譯文保留');
    assert.ok(!/Magnetic mounting/.test(li.textContent), 'li 內英文原文消失');
  });

  it('未翻譯段落（無 dual-source / 無 wrapper）原樣保留', () => {
    const { document, NS } = setup();
    NS.collapseShinkansenDual(document.getElementById('story'));
    const u = document.getElementById('untranslated');
    assert.ok(u, '未翻譯段落保留');
    assert.ok(/Pricing has not been announced/.test(u.textContent));
  });

  it('就地翻譯標題（nodevalue-mutated、無 dual-source）不受影響', () => {
    const { document, NS } = setup();
    NS.collapseShinkansenDual(document.getElementById('story'));
    const t = document.getElementById('title');
    assert.ok(t, '標題保留');
    assert.ok(/PopSockets 全新支架超薄登場/.test(t.textContent), '標題中文不變');
  });

  it('未翻譯頁面為 no-op（無 dual-source / 無 wrapper 時不丟例外、不改動）', () => {
    const { document, NS } = setup();
    const plain = document.createElement('div');
    plain.innerHTML = '<p>Just plain English content.</p>';
    NS.collapseShinkansenDual(plain);
    assert.strictEqual(plain.querySelectorAll('p').length, 1, '一般內容不受影響');
    assert.ok(/Just plain English/.test(plain.textContent));
  });
});
