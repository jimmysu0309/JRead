// JRead — detector regression spec
// 對應 fixture：test/regression/fixtures/businessweekly-7014035.html
// 依 CLAUDE.md 硬規則 4，每修一個 bug 必須補一條對應 spec。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const DETECTOR_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'),
  'utf8'
);

function loadFixtureAndRunDetector(fileName) {
  const html = fs.readFileSync(path.join(FIXTURE_DIR, fileName), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const { window } = dom;
  // 最小 NS 環境（detector.js 只依賴 window.__JRead 的存在）
  window.__JRead = { state: {}, MSG: {} };
  window.eval(DETECTOR_SRC);
  return { window, result: window.__JRead.detector.detect() };
}

describe('detector — businessweekly-7014035', () => {
  let result;
  before(() => {
    result = loadFixtureAndRunDetector('businessweekly-7014035.html').result;
  });

  it('偵測成功，回傳物件而非 null', () => {
    assert.ok(result, '偵測應成功（不得 no-op）');
  });

  it('策略命中 article-tag（單一 <article> 直接採用）', () => {
    assert.strictEqual(result.strategy, 'article-tag');
  });

  it('信心分數等於 0.9', () => {
    assert.strictEqual(result.confidence, 0.9);
  });

  it('選到 article.article 主文容器', () => {
    assert.ok(result.el);
    assert.strictEqual(result.el.tagName.toLowerCase(), 'article');
    assert.ok(
      result.el.classList.contains('article'),
      `應命中 article.article，實際 className="${result.el.className}"`
    );
  });

  it('主文範圍內必須包含 <summary>（SPEC 內文保留特例）', () => {
    // Unclutter 在商周踩過這坑：<summary> 是 editor bullets，不可外移。
    // 偵測階段 <summary> 必須仍在 el 的子樹中。
    const summary = result.el.querySelector('summary');
    assert.ok(summary, '<summary> 必須留在主文容器內');
    assert.ok(
      summary.textContent.includes('editor bullet'),
      'summary 內的 editor bullets 文字必須保留'
    );
  });
});

// -----------------------------------------------------------------------------
// 對應 fixture：test/regression/fixtures/stratechery-columns-layout.html
// Bug 來源：Stratechery 文章頁在 <main> 內用 WordPress wp-block-columns 做
// 左右 2 欄 layout，整頁完全沒有 <article> tag、沒有 schema.org itemtype。
// 原 detector 走到 main-tag fallback 直接把整個 <main> 當主文，導致右邊
// sidebar column（Strategy Plus / TSMC Earnings 等）被當成主文一部分，
// cleaner 的 ancestor-sibling 只能處理 <main> 的兄弟，動不到 <main> 內部
// 的多欄 sidebar。
// 修法為結構性通則（不綁站點）：
//   1. detect() 策略順序改為 article → schema.org → heuristic → main-tag
//      （main-tag 從 article-tag 策略內抽出、降為最後兜底）
//   2. heuristic 加「多個大型子分支」懲罰：當一個候選的直接子中有 2+ 個
//      textLen >= 500 的分支，視為多欄 layout 容器，score × 0.6，讓更深
//      的內容容器勝出
// -----------------------------------------------------------------------------
describe('detector — stratechery-columns-layout（多欄 layout，無 <article> 標籤）', () => {
  let window, result;
  before(() => {
    const loaded = loadFixtureAndRunDetector('stratechery-columns-layout.html');
    window = loaded.window;
    result = loaded.result;
  });

  it('偵測成功，回傳物件而非 null', () => {
    assert.ok(result, '偵測應成功（不得 no-op）');
  });

  it('策略不可是 main-tag（否則 sidebar 會被吞進主文）', () => {
    assert.notStrictEqual(
      result.strategy,
      'main-tag',
      `不可走 main-tag fallback，否則 sidebar 會被吞。實際 strategy=${result.strategy}`
    );
  });

  it('策略命中 heuristic（沒 <article>、沒 schema.org 時，應由 heuristic 找內容容器）', () => {
    assert.strictEqual(result.strategy, 'heuristic');
  });

  it('主文容器必須包含主內容標記（MAINTEXT_MARK）', () => {
    assert.ok(
      (result.el.textContent || '').includes('MAINTEXT_MARK'),
      '主文容器應包含 MAINTEXT_MARK（左欄 entry-content 內）'
    );
  });

  it('主文容器不可包含 sidebar 標記（SIDEBAR_MARK）', () => {
    // 核心斷言：sidebar 不得被當成主文一部分，否則 cleaner 清不掉、
    // 閱讀模式下畫面右側殘留一整欄雜訊。
    assert.ok(
      !(result.el.textContent || '').includes('SIDEBAR_MARK'),
      '主文容器不可含 SIDEBAR_MARK（表示 detector 吞到右欄 sidebar）'
    );
  });

  it('主文容器不可是 <main> 本身（<main> 包含整個 2-col layout）', () => {
    assert.notStrictEqual(
      result.el.tagName.toLowerCase(),
      'main',
      '不可把整個 <main> 當主文容器'
    );
  });

  it('主文容器不可是多欄 wrapper（wp-block-columns 整個）', () => {
    const cls = (result.el.className || '').toString().toLowerCase();
    assert.ok(
      !cls.includes('wp-block-columns'),
      `不可選到多欄 wrapper；實際 className="${result.el.className}"`
    );
  });

  // ---- title promote ------------------------------------------------------
  // Stratechery / WordPress / Medium 許多 CMS 把 post-title 跟 post-content
  // 放在兄弟層。bubble-up 只會選中 content，title 被漏在外面——cleaner 走
  // ancestor-sibling 會把 title 當 sidebar 清掉。detector 必須在 heuristic
  // 結果回傳前 promote：若祖兄有 h1/h2 文字與 og:title / document.title
  // 匹配，把主文升級到共同 parent，讓 title 進入主文 scope。
  it('主文容器必須包含文章標題 H2（og:title 匹配時應 promote 到共同 parent）', () => {
    const h2 = result.el.querySelector('h2');
    assert.ok(h2, '主文容器內應有 H2 標題元素');
    assert.ok(
      (h2.textContent || '').includes('Please Listen to My Podcast'),
      `主文容器內應含文章標題，實際 h2 text="${h2?.textContent || ''}"`
    );
  });
});

// -----------------------------------------------------------------------------
// 對應 fixture：test/regression/fixtures/anthropic-hero-sibling.html
// Bug 來源：anthropic.com/engineering/advanced-tool-use 有 <article> 但文章
// <h1> 放在 article 的**兄弟** <section> 裡。detector 策略 1（article-tag）
// 會直接選中 <article>，若 title promote 僅作用於 heuristic（v0.5.1 行為），
// 則 article-tag 結果的祖兄 h1 不會被救起——hideAncestorSiblings 會把整個
// hero section 當 chrome 清掉，標題消失。
// 修法為結構性通則：對所有「非兜底」策略結果（article-tag / schema-org /
// heuristic）統一在 detect() 出口套 promoteForTitle，不分策略。
// -----------------------------------------------------------------------------
describe('detector — anthropic-hero-sibling（article-tag 策略下的 title promote）', () => {
  let result;
  before(() => {
    result = loadFixtureAndRunDetector('anthropic-hero-sibling.html').result;
  });

  it('偵測成功，回傳物件而非 null', () => {
    assert.ok(result, '偵測應成功（不得 no-op）');
  });

  it('策略從 article-tag 起步', () => {
    // fixture 中有單一 <article>，策略 1 首先命中
    assert.strictEqual(result.strategy, 'article-tag');
  });

  it('主文容器被 promote 到 <main>（共同 parent，包住 hero + article）', () => {
    // article 的祖兄 section.hero 裡的 h1 文字匹配 og:title → 升級到共同
    // parent = <main>
    assert.strictEqual(
      result.el.tagName.toLowerCase(), 'main',
      `article-tag 遇祖兄 h1 匹配 og:title 時應 promote 到 main，實際 tag=${result.el.tagName}`
    );
  });

  it('主文容器必須包含文章標題 H1', () => {
    const h1 = result.el.querySelector('h1');
    assert.ok(h1, '主文容器內應有 H1');
    assert.ok(
      (h1.textContent || '').includes('Introducing advanced tool use'),
      `H1 應含標題文字，實際="${h1?.textContent || ''}"`
    );
  });

  it('主文容器必須包含內文（ANTHROPIC_MAINTEXT_MARK）', () => {
    assert.ok(
      (result.el.textContent || '').includes('ANTHROPIC_MAINTEXT_MARK'),
      '主文容器應包含 article 內文'
    );
  });
});

// -----------------------------------------------------------------------------
// 對應 fixture：test/regression/fixtures/ltn-multi-article-siblings.html
// Bug 來源：news.ltn.com.tw 自由時報類「infinite-scroll archive」頁把多篇
// article 塞進同一個 `<section>` 裡（每篇是 section 的直系子），popIn
// Discovery 再 scroll 時 append 新一篇。detector heuristic bubble-up 因
// section 是所有 p 的 grandparent、拿到最高累積分，選中 section 作主文；
// 若不做 narrow，讀者閱讀模式下會同時看到第一篇 + 第二篇 + 第三篇的標題
// 與內文混雜。
// 修法為結構性通則（非站點特判）：detect() 出口對選中的容器做
// narrowToFirstArticleBlock——若容器的直系子中有 ≥ 2 個獨立子樹各含 h1，
// 認定為多篇 article 兄弟，限縮到第一個含 h1 的直系子。h1 每頁慣例唯一，
// 多 h1 兄弟即為 multi-article 特徵。
// -----------------------------------------------------------------------------
describe('detector — ltn-multi-article-siblings（infinite-scroll 多篇 article 兄弟）', () => {
  let result;
  before(() => {
    result = loadFixtureAndRunDetector('ltn-multi-article-siblings.html').result;
  });

  it('偵測成功，回傳物件而非 null', () => {
    assert.ok(result, '偵測應成功（不得 no-op）');
  });

  it('主文容器必須包含第一篇標題 + 內文（FIRST_ARTICLE_MARK / FIRST_BODY_MARK）', () => {
    const txt = result.el.textContent || '';
    assert.ok(txt.includes('FIRST_ARTICLE_MARK'),
      '主文必須含第一篇標題（FIRST_ARTICLE_MARK）');
    assert.ok(txt.includes('FIRST_BODY_MARK'),
      '主文必須含第一篇內文（FIRST_BODY_MARK）');
  });

  it('主文容器絕不可包含第二篇（NEXT_ARTICLE_MARK / NEXT_BODY_MARK）', () => {
    // 核心斷言：narrow 必須把主文限縮到第一篇；infinite-scroll append 的
    // 下一篇若被混入，讀者閱讀模式會看到「第一篇 + 第二篇 + ...」。
    const txt = result.el.textContent || '';
    assert.ok(!txt.includes('NEXT_ARTICLE_MARK'),
      `主文不得含下一篇標題（NEXT_ARTICLE_MARK）；表示 narrow 未觸發`);
    assert.ok(!txt.includes('NEXT_BODY_MARK'),
      `主文不得含下一篇內文（NEXT_BODY_MARK）`);
  });

  it('主文容器必須是第一篇 article wrapper，不是含多篇的 section', () => {
    // narrow 把主文從 section.content-list 限縮到第一個 article.first-article。
    // 以 class 驗證結構：縮完的容器必須有 first-article class（fixture 明標），
    // 且不是 section.content-list。
    const cls = (result.el.className || '').toString();
    assert.ok(!cls.includes('content-list'),
      `主文不得仍是含多篇的 section.content-list，實際 className="${cls}"`);
    assert.ok(cls.includes('first-article'),
      `主文應限縮到第一篇 wrapper（first-article），實際 className="${cls}"`);
  });

  it('主文容器內只剩一個 h1（下一篇的 h1 已被切掉）', () => {
    const h1s = result.el.querySelectorAll('h1');
    assert.strictEqual(h1s.length, 1,
      `主文內應只剩 1 個 h1（narrow 後），實際 ${h1s.length} 個`);
  });
});
