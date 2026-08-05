// JRead — regression spec: CJK 權重門檻半套收斂（v1.7.40，批次 2 review D2）
// -----------------------------------------------------------------------------
// Forcing function for：
//   1. detector isLinkDirectory 段落門檻（原 raw 80——中文 50 字導言不被認作
//      段落，配高連結密度整頁誤 no-op）
//   2. detector looksLikeContinuationBlock 的 MIN_TEXT_LEN gate（原 raw 200 與
//      段落權重門檻並存——兩段各 55 字中文總 raw < 200 整塊被擋、段落權重白做）
//   3. detector articleIsSelfTitled 的 substantial 段落門檻（原 raw 80——中文
//      41-79 字段落全篇不計，誤判 self-titled 跳過 LCA promote、hero 標題掉出主文）
//   4. NS.findCardTitleHeading 的內文長段落門檻（原 raw 80 且是無權重雙實作——
//      中文段落之後的 section h2 被誤取為主標）
//
// 假設驗證（2026-08-05 probe，tools/probe-cjk-gates.js 真實站）：zh.wikipedia
// 「珍珠奶茶」條目 440 段中 raw>=80 僅 45 段、權重>=80 有 62 段（56 字中文完整
// 段落被 raw 門檻誤擋）；udn 404 頁權重版仍 reject（護欄不破）；BBC 拉丁對照組
// 零翻轉（權重 1 行為嚴格不變）。
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

function load(fixture) {
  return loadFixtureWithScripts({
    fixturePath: path.join(__dirname, 'fixtures', fixture),
    scripts: ['detector']
  });
}

describe('detector — CJK 權重門檻收斂（v1.7.40）', () => {

  describe('isLinkDirectory：中文導言段落（raw < 80、權重 >= 80）', () => {
    it('(a) 中文 link roundup（高連結密度 + 中文導言段）必須照常偵測、不可 no-op', () => {
      const env = load('cjk-link-roundup-intro.html');
      const detected = env.NS.detector.detect();
      assert.ok(detected && detected.el, '中文導言段是實質段落，不可被 isLinkDirectory 誤 reject');
      const intro = env.document.querySelector('[data-test="intro"]');
      assert.ok(detected.el.contains(intro), '偵測結果必須涵蓋導言段');
    });

    it('(b) fixture 前提：導言段 raw < 80、CJK 權重 >= 80（驗的是門檻本身）', () => {
      const env = load('cjk-link-roundup-intro.html');
      const t = env.document.querySelector('[data-test="intro"]')
        .textContent.replace(/\s+/g, ' ').trim();
      assert.ok(t.length < 80, `導言 raw 必須 < 80（目前 ${t.length}），否則修前也過、驗不到權重`);
      assert.ok(env.NS.cjkWeightedLen(t) >= 80,
        `導言權重必須 >= 80（目前 ${env.NS.cjkWeightedLen(t)}）`);
    });
  });

  describe('looksLikeContinuationBlock：中文接續區塊（總 raw < 200、總權重 >= 200）', () => {
    it('(a) 兩段 55 字中文的接續兄弟區塊必須被吸收進 continuationEls', () => {
      const env = load('cjk-continuation-blocks.html');
      const detected = env.NS.detector.detect();
      assert.ok(detected && detected.el, 'detect 必須有結果');
      const cont = env.document.querySelector('[data-test="continuation"]');
      assert.ok(Array.isArray(detected.continuationEls) && detected.continuationEls.includes(cont),
        '中文接續區塊（段落權重過門檻但總 raw < 200）必須被吸收');
    });

    it('(b) 反例：related class 的兄弟即使段落字數過門檻也不可吸收（NEGATIVE_RE 護欄）', () => {
      const env = load('cjk-continuation-blocks.html');
      const detected = env.NS.detector.detect();
      const related = env.document.querySelector('[data-test="related"]');
      assert.ok(!(detected.continuationEls || []).includes(related),
        'related-news 類兄弟必須被 class 檢查擋下（權重 gate 放寬後的護欄，udn probe 實證）');
    });

    it('(c) fixture 前提：接續區塊總 raw < 200、總權重 >= 200、每段權重 >= 80', () => {
      const env = load('cjk-continuation-blocks.html');
      const cont = env.document.querySelector('[data-test="continuation"]');
      const total = cont.textContent.replace(/\s+/g, ' ').trim();
      assert.ok(total.length < 200, `總 raw 必須 < 200（目前 ${total.length}），否則修前也過`);
      assert.ok(env.NS.cjkWeightedLen(total) >= 200,
        `總權重必須 >= 200（目前 ${env.NS.cjkWeightedLen(total)}）`);
      for (const p of cont.querySelectorAll('p')) {
        const t = p.textContent.replace(/\s+/g, ' ').trim();
        assert.ok(env.NS.cjkWeightedLen(t) >= 80, `每段權重須 >= 80（目前 ${env.NS.cjkWeightedLen(t)}）`);
      }
    });
  });

  describe('articleIsSelfTitled：中文首段（raw < 80、權重 > 80）先於 section H1', () => {
    it('(a) hero H1 在 article 外時必須升 LCA 括進 hero（修前誤判 self-titled 被擋）', () => {
      const env = load('cjk-selftitled-hero-outside.html');
      const detected = env.NS.detector.detect();
      assert.ok(detected && detected.el, 'detect 必須有結果');
      const hero = env.document.querySelector('[data-test="hero"]');
      assert.ok(detected.el.contains(hero),
        'article 開頭是中文內文段落（非自帶標題）→ 必須 LCA promote 把兄弟層 hero H1 括進主文');
    });

    it('(b) fixture 前提：首段 raw < 80、權重 > 80，且其後才有 section H1', () => {
      const env = load('cjk-selftitled-hero-outside.html');
      const lead = env.document.querySelector('[data-test="lead-p"]');
      const t = lead.textContent.replace(/\s+/g, ' ').trim();
      assert.ok(t.length < 80, `首段 raw 必須 < 80（目前 ${t.length}）`);
      assert.ok(env.NS.cjkWeightedLen(t) > 80, `首段權重必須 > 80（目前 ${env.NS.cjkWeightedLen(t)}）`);
      const art = env.document.querySelector('[data-test="article"]');
      assert.ok(art.querySelectorAll('h1').length >= 2,
        'article 內須有多個 section H1（單一 H1 會走「恰 1 個 H1」guard、驗不到 selfTitled）');
    });
  });

  describe('NS.findCardTitleHeading：中文長段落之後的 section h2 不可誤取為主標', () => {
    it('(a) card 無 h1、55 字中文段落之後的 h2 → 回空字串（段落即內文邊界）', () => {
      const env = load('cjk-link-roundup-intro.html');
      const card = env.document.createElement('div');
      card.innerHTML =
        '<p>科考船離港那天清晨的濃霧至今仍讓人印象深刻，甲板上的儀器箱堆得比人還高，所有人都知道這趟任務不會輕鬆。</p>' +
        '<h2>第一章：起航與適應</h2><p>後續內文。</p>';
      env.document.body.appendChild(card);
      const p = card.querySelector('p').textContent.replace(/\s+/g, ' ').trim();
      assert.ok(p.length < 80 && env.NS.cjkWeightedLen(p) > 80,
        `前提：段落 raw < 80 且權重 > 80（目前 raw ${p.length} / 權重 ${env.NS.cjkWeightedLen(p)}）`);
      assert.strictEqual(env.NS.findCardTitleHeading(card), '',
        '中文內文段落之後的 h2 是章節標題、不是主標——必須在段落處 break');
    });

    it('(b) 正控制：h2 在中文段落之前仍照常取為主標', () => {
      const env = load('cjk-link-roundup-intro.html');
      const card = env.document.createElement('div');
      card.innerHTML =
        '<h2>真正的文章主標</h2>' +
        '<p>科考船離港那天清晨的濃霧至今仍讓人印象深刻，甲板上的儀器箱堆得比人還高，所有人都知道這趟任務不會輕鬆。</p>';
      env.document.body.appendChild(card);
      assert.strictEqual(env.NS.findCardTitleHeading(card), '真正的文章主標');
    });
  });
});
