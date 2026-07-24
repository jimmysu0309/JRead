// JRead — regression spec: article 殼卡 guard（v1.7.15）
// -----------------------------------------------------------------------------
// Forcing function for detector `articleIsBodylessCard`（detectByArticleTag
// 單一 / 多 article 兩出口的讓位 gate）。
//
// Trigger: Jimmy 2026-07-24 回報 netflix.com/tudum/articles/... 文章大部分被
// 截斷。Playwright probe 實證：Tudum 把 header 卡與 41 張推薦卡全做成
// `<article class="content-card">`（各 0-236 字、無任何 <p>），真正的 16 段
// 主文全在 <article> 之外的 SECTION.articleHtmlContent 裡。article-tag 策略
// 選中 header 卡（236 字剛好過 MIN_TEXT_LEN 200）；列表頁降級接不住（其餘卡
// < 200 字、不構成三篇長度相近）→ reader 只剩標題卡。
//
// 規則（結構通則，不綁站點 / class）：選中的 <article> 內無任何**可見**實質
// 段落（p / blockquote / dd，CJK 權重 >= 80）、頁面其他可見位置有 >= 4 段 →
// 殼卡讓位（return null → schema-org / heuristic 接手）。probe 模擬實證讓位
// 後 heuristic 選到含全部主文段落的 page 容器（10K 字、11 段）。
//
// 驗證層次：本 spec 驗 jsdom 端 detect() 策略讓位與 guard 條件（可見性 rect
// 用 stubRect 注入；jsdom 無 stub 全 0 = guard 恆不觸發，(e) 驗此安全預設）。
// 真實 Chrome 端由 harness 驗收（見 CHANGELOG v1.7.15）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'tudum-bodyless-article-card.html');

// 把主文段落 stub 成可見（cookie 面板刻意不 stub = rect 0 = 不可見）
function setupVisible() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector'],
    viewport: { width: 1024, height: 800 },
    pretendToBeVisual: true
  });
  const doc = env.document;
  for (let i = 1; i <= 5; i++) {
    stubRect(doc.querySelector(`[data-test="body-p-${i}"]`), { left: 0, top: 900 + i * 60, width: 600, height: 50 });
  }
  return env;
}

describe('detector — article 殼卡 guard（v1.7.15）', () => {
  it('(a) 多 article 殼卡頁：article-tag 讓位、偵測結果必須涵蓋全部主文段落', () => {
    const env = setupVisible();
    const detected = env.NS.detector.detect();
    assert.ok(detected && detected.el, '讓位後 heuristic / 後續策略必須接手（不可 no-op）');
    assert.notStrictEqual(detected.strategy, 'article-tag',
      `殼卡不可由 article-tag 策略勝出（實際 strategy=${detected.strategy}）`);
    for (let i = 1; i <= 5; i++) {
      const p = env.document.querySelector(`[data-test="body-p-${i}"]`);
      assert.ok(detected.el.contains(p), `偵測結果必須涵蓋 body-p-${i}`);
    }
  });

  it('(b) 單一 article 殼卡：同樣讓位（單 article 出口也掛 guard）', () => {
    const env = setupVisible();
    env.document.querySelector('[data-test="teaser-1"]').remove();
    env.document.querySelector('[data-test="teaser-2"]').remove();
    const detected = env.NS.detector.detect();
    assert.ok(detected && detected.el, '讓位後必須有後續策略接手');
    assert.notStrictEqual(detected.strategy, 'article-tag',
      '單一殼卡 article 也不可由 article-tag 勝出');
    const p1 = env.document.querySelector('[data-test="body-p-1"]');
    assert.ok(detected.el.contains(p1), '偵測結果必須涵蓋主文段落');
  });

  it('(c) 負控制：article 內有可見實質段落 → article-tag 照舊勝出（留言長文 / 付費牆 teaser 不誤傷）', () => {
    const env = setupVisible();
    const card = env.document.querySelector('[data-test="header-card"]');
    const p = env.document.createElement('p');
    p.textContent = 'A substantial preview paragraph inside the article element itself, long enough to clear the weighted threshold so the guard must not fire on this page at all.';
    card.appendChild(p);
    stubRect(p, { left: 0, top: 100, width: 600, height: 50 });
    const detected = env.NS.detector.detect();
    assert.ok(detected && detected.el, '必須偵測成功');
    assert.strictEqual(detected.strategy, 'article-tag',
      'article 內有實質段落（inCount >= 1）→ guard 不觸發、article-tag 維持');
  });

  it('(d) 負控制：外部可見段落 < 4 段 → guard 不觸發（老站裸 div 內文場景）', () => {
    const env = setupVisible();
    // 只留 3 段可見（其餘 stub 回 0 = 不可見）
    for (let i = 4; i <= 5; i++) {
      stubRect(env.document.querySelector(`[data-test="body-p-${i}"]`), { left: 0, top: 0, width: 0, height: 0 });
    }
    const detected = env.NS.detector.detect();
    assert.ok(detected && detected.el, '必須偵測成功');
    assert.strictEqual(detected.strategy, 'article-tag',
      '外部可見段落不足 4 段時 guard 不可觸發（避免過度讓位）');
  });

  it('(e) jsdom 安全預設：不 stub rect（全 0）→ guard 恆不觸發、article-tag 行為不變', () => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector'],
      viewport: { width: 1024, height: 800 },
      pretendToBeVisual: true
    });
    const detected = env.NS.detector.detect();
    assert.ok(detected && detected.el, '必須偵測成功');
    assert.strictEqual(detected.strategy, 'article-tag',
      'rect 全 0（可見段落數 0）→ guard 不觸發，既有 jsdom 行為不可變');
  });

  it('(f) 隱藏面板長文不計入 outCount（cookie 面板 rect 0）', () => {
    // (a) 已隱含驗證：cookie-p-1/2 未 stub = rect 0，若被計入則 outCount
    // 門檻語意失真。此處驗 fixture 前提本身，防未來 fixture 改動破壞語意
    const env = setupVisible();
    const cookieP = env.document.querySelector('[data-test="cookie-p-1"]');
    const r = cookieP.getBoundingClientRect();
    assert.strictEqual(r.width * r.height, 0, 'cookie 面板段落必須維持 rect 0（不可見）');
  });
});
