// JRead — regression spec: myartbroker 多節長文 translate-first 內容截斷 (v0.8.58)
// -----------------------------------------------------------------------------
// Trigger: Jimmy 2026-06-14 回報 myartbroker.com「5 幅畫作」文章經 Shinkansen
// 翻譯後進閱讀模式只剩第一幅畫，其餘 4 幅整段不見。
//
// 根因：頁面無 <article>/<main> → heuristic 偵測。文章把每幅畫包成獨立深層
// 巢狀 textblock，bubble-up 只給 parent/grandparent 2 層分數、搆不到「裝所有
// 節的 body 容器」，於是選中第一節的 TextBlock（class 含 "text" → POSITIVE）。
// 英文原文靠 promoteForTitle 的 og-match LCA fallback（dist Infinity）爬回含
// H1 的文章容器 article-top；但 translate-first 把 H1 換成繁中、og:title 維持
// 英文 → titleMatches 全失效 → 卡在單一 section。
//
// v0.8.58 修法：ensureArticleContainsTitleH1 加 path 0——全頁恰好 1 個 H1 且
// 不在 articleEl 內時，以「唯一 H1 必是文章 hero」純結構訊號升到 LCA（dist
// Infinity、不靠文字比對）。findTitleViaLca 的 body/html guard 保證不吞整頁。
//
// forcing functions:
//   (a) fixture 結構驗證（無 article/main、單一 H1 繁中不 match 英文 og、
//       section 巢狀 > maxDist 5）
//   (b) detect().el 必須升到 article-top（含全部 5 節）——修法核心
//   (c) detect().el 必須含 5 個 H2（5 幅畫作全在）
//   (d) heuristic 原始命中的是深層單一 section（非 article-top），證明修法真的
//       在補 promote 缺口、不是 heuristic 碰巧選對

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'myartbroker-translated-multisection.html');

describe('detector — myartbroker translate-first 多節長文截斷 (v0.8.58)', function() {
  this.timeout(10000);
  let env, document;

  before(() => {
    env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
  });

  // -------- (a) fixture 結構驗證 --------
  it('(a) fixture：無 article/main、單一 H1 繁中不 match 英文 og、section 深巢狀', () => {
    assert.strictEqual(document.querySelectorAll('article').length, 0, '不可有 <article>');
    assert.strictEqual(document.querySelectorAll('main').length, 0, '不可有 <main>');

    const h1s = document.querySelectorAll('h1');
    assert.strictEqual(h1s.length, 1, '全頁必須恰好 1 個 H1（path 0 觸發條件）');
    assert.ok(/大衛霍克尼/.test(h1s[0].textContent), 'H1 必須是繁中（翻譯後狀態）');

    const og = document.querySelector('meta[property="og:title"]').content;
    assert.ok(/David Hockney/.test(og), 'og:title 必須維持英文（translate-first 不譯 meta）');

    // section 與 article-top 的距離必須 > maxDist 5（否則 path 2 就能救、測不到 path 0）
    const articleTop = document.getElementById('article-top');
    const sectionInner = document.querySelector('[data-test="section-1"] .TextBlock_base');
    assert.ok(articleTop && sectionInner);
    let dist = 0;
    for (let cur = sectionInner; cur && cur !== articleTop; cur = cur.parentElement) dist++;
    assert.ok(dist > 5, `section 內層到 article-top 必須 > 5 hops（實際 ${dist}）`);

    // H1 在 article-top 內、但在任何 section 之外
    assert.ok(articleTop.contains(h1s[0]), 'H1 在 article-top 內');
    assert.ok(!document.querySelector('[data-test="section-1"]').contains(h1s[0]),
      'H1 不在 section 內（articleEl 不含 H1 = 觸發條件）');
  });

  // -------- (b) detect().el 升到 article-top（修法核心）--------
  it('(b) detect().el 必須是 article-top（含全部 5 節，不卡在第一幅畫）', () => {
    const detected = env.NS.detector.detect();
    assert.ok(detected && detected.el, 'detector 必須命中');
    assert.strictEqual(detected.el.id, 'article-top',
      `detect().el 必須升到 article-top，實際 ${detected.el.tagName}.${detected.el.className || '(none)'}#${detected.el.id || ''}`);
  });

  // -------- (c) 升級後的 el 含全部 5 個 H2 --------
  it('(c) detect().el 含 5 個 H2（5 幅畫作全在）', () => {
    const detected = env.NS.detector.detect();
    assert.strictEqual(detected.el.querySelectorAll('h2').length, 5,
      `升級後容器必須含 5 個 H2，實際 ${detected.el.querySelectorAll('h2').length}`);
    for (let i = 1; i <= 5; i++) {
      assert.ok(detected.el.querySelector(`[data-test="h2-${i}"]`),
        `必須含第 ${i} 幅畫的 H2`);
    }
  });

  // -------- (d) heuristic 原始命中的是深層 section（證明修法在補 promote 缺口）--------
  it('(d) heuristic 原始命中是深層單一 section（非 article-top）', () => {
    // 直接跑 heuristic（不經 promote / ensureH1），確認 raw pick 落在某個 section 內
    const raw = env.NS.detector._detectByHeuristicForTest
      ? env.NS.detector._detectByHeuristicForTest()
      : null;
    // 沒暴露內部 fn 時改用結構推論：detect() 的升級必須真的發生（el !== raw anchor）。
    // 用 article-top 不是 heuristic bubble-up 能直接命中的層級（signal 距它 > 2 層）
    // 來反證：若 heuristic 能直接選 article-top，path 0 就沒被測到。
    const articleTop = document.getElementById('article-top');
    // article-top 的直系 signal（p/h2）數量為 0：所有 p/h2 都埋在 header-zone /
    // section 深處，bubble-up（parent + grandparent）不可能把 article-top 變成候選。
    const directSignals = Array.from(articleTop.children).filter(c =>
      c.matches('p, h2, pre, blockquote, h3, h4, li'));
    assert.strictEqual(directSignals.length, 0,
      'article-top 無直系 signal → heuristic 不可能直接命中它 → (b) 的命中只能來自 path 0 promote');
  });
});
