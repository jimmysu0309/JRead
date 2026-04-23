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

// v0.7.2 修法：heuristic skip modal signal + textLen bonus + promote MAX_HOPS
// 對應 fixture：upmedia-intl-modal-signals.html（場景說明見 fixture 檔頭）
describe('detector — upmedia-intl-modal-signals（modal 偽信號 + 深層主文 + promote 防失控）', () => {
  let result, window;
  before(() => {
    const loaded = loadFixtureAndRunDetector('upmedia-intl-modal-signals.html');
    result = loaded.result;
    window = loaded.window;
  });

  it('偵測成功，不得 no-op', () => {
    assert.ok(result, 'detector 應命中（heuristic）');
  });

  it('選到真主文 .news-box（或其後代），不得選到 #wrapper 整頁容器', () => {
    assert.ok(result.el);
    const tag = result.el.tagName;
    const id = result.el.id || '';
    const cls = (result.el.className || '').toString();
    assert.notStrictEqual(id, 'wrapper',
      `主文不得是 #wrapper 整頁外殼（id="${id}" cls="${cls}" tag=${tag}）`);
    // 主文 scope 應該包含 h1
    const h1 = result.el.querySelector('h1');
    assert.ok(h1, '主文 scope 內必須含 h1');
    assert.ok(/艦砲|伊朗/.test(h1.textContent),
      `h1 應為文章標題，實際 text="${h1.textContent.slice(0, 40)}"`);
  });

  it('主文 scope 不得含 modal 雜訊文字（modal signals 已被 skip）', () => {
    const txt = (result.el.textContent || '').toString();
    assert.ok(!/氣象預報|今日氣象|台積電造晶片|射程破2000/.test(txt),
      `主文不得含 modal 裡的天氣/推薦文字，表示 isSignalExcluded 沒生效或 promote 升太多`);
  });

  it('主文 scope 不得含 top-level header / footer（promote hops 限制生效）', () => {
    const txt = (result.el.textContent || '').toString();
    assert.ok(!/歡迎來信提供新聞|版權所有 上報/.test(txt),
      `主文不得含 header/footer——表示 promote 一路升到 #wrapper、把站體 chrome 吃進來`);
  });

  it('strategy = heuristic（有 signal bubble-up + textLen bonus 後才選到主文）', () => {
    assert.strictEqual(result.strategy, 'heuristic');
  });
});

describe('detector — linetoday-ogtitle-suffix（og:title 帶三段尾綴的 promote 修法）', () => {
  let result, window;
  before(() => {
    const out = loadFixtureAndRunDetector('linetoday-ogtitle-suffix.html');
    result = out.result;
    window = out.window;
  });

  it('偵測成功', () => {
    assert.ok(result, '偵測應成功');
  });

  it('article 命中後 promoteForTitle 應升級到含 h1 的共同祖先（不能卡在 `<article>` 本身）', () => {
    // forcing function：若 getCanonicalTitle 沒對 og:title 取首段，target 47
    // chars / h1 27 chars 比值 57% < titleMatches 60% 門檻 → match 失敗、
    // promote 不升級。spec 要求 detected.el 內必須含 h1，等同驗 promote
    // 確實升級了。
    const h1 = result.el.querySelector('h1');
    assert.ok(h1, 'detected.el 必須含 h1 — og:title 取首段後 titleMatches 命中 → promote 升級');
    assert.ok(h1.textContent.includes('台鐵新左營車站'),
      'h1 內文必須是原站主文標題');
  });

  it('promote 升級後主文仍含 LINETODAY_MAIN_MARK 段落（沒被升級範圍遺漏）', () => {
    assert.ok(result.el.textContent.includes('LINETODAY_MAIN_MARK'),
      '升級後的 detected.el 必須仍包含原主文段落');
  });

  it('promote 不會升過頭到 body（PROMOTE_MAX_HOPS 限制 3 跳內合理升級）', () => {
    assert.notStrictEqual(result.el.tagName, 'BODY',
      'promote 不得直接升級到 body（那意味著 MAX_HOPS 失控）');
  });
});

// -----------------------------------------------------------------------------
// v0.7.5 Readability.js 借鑑：POSITIVE_RE / NEGATIVE_RE 擴充 forcing
// POSITIVE 新增 `blog|hentry|h-entry`（microformats + 部落格 CMS 常見）
// NEGATIVE 新增 `gdpr|outbrain|related|sponsor|shoutbox|widget|skyscraper`
//   （跨 CMS 廣告 / 相關推薦 / 側欄元件慣用命名）
// -----------------------------------------------------------------------------
describe('detector — readability-class-weights（POSITIVE/NEGATIVE regex 擴充 forcing）', () => {
  let result;
  before(() => {
    result = loadFixtureAndRunDetector('readability-class-weights.html').result;
  });

  it('偵測成功，回傳 heuristic 結果', () => {
    assert.ok(result, '偵測應成功（不得 no-op）');
    assert.strictEqual(result.strategy, 'heuristic');
  });

  it('選到真主文 .blog-entry-hentry，不得選到 .outbrain-related-widget', () => {
    assert.ok(result.el);
    const cls = (result.el.className || '').toString();
    assert.ok(
      cls.includes('blog-entry-hentry'),
      `主文應為 .blog-entry-hentry，實際 class="${cls}"`
    );
    assert.ok(
      !cls.includes('outbrain-related-widget'),
      `不得選到 sidebar widget—— NEGATIVE_RE 應對 outbrain/related/widget 三詞任一命中 ×0.5`
    );
  });

  it('主文 scope 含 READABILITY_MAIN_MARK 段落', () => {
    const txt = (result.el.textContent || '').toString();
    assert.ok(txt.includes('READABILITY_MAIN_MARK'),
      '主文必須含 READABILITY_MAIN_MARK 段落');
  });

  it('POSITIVE_RE 必須涵蓋 `blog` 與 `hentry` 詞根（forcing：退回舊名單 → spec fail）', () => {
    // 此條為「字面 regex」的 forcing function，避免未來有人誤改回舊名單
    const detectorSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'),
      'utf8'
    );
    const m = detectorSrc.match(/const POSITIVE_RE = \/([^\/]+)\/i;/);
    assert.ok(m, '必須能抓到 POSITIVE_RE');
    const pattern = m[1];
    assert.ok(/\bblog\b/.test(pattern), `POSITIVE_RE 必須含 \`blog\`；實際 pattern=${pattern}`);
    assert.ok(/hentry/.test(pattern), `POSITIVE_RE 必須含 \`hentry\`；實際 pattern=${pattern}`);
  });

  it('NEGATIVE_RE 必須涵蓋 `outbrain` / `related` / `widget` / `gdpr` / `sponsor` / `shoutbox` / `skyscraper` 詞', () => {
    const detectorSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'),
      'utf8'
    );
    const m = detectorSrc.match(/const NEGATIVE_RE = \/([^\/]+)\/i;/);
    assert.ok(m, '必須能抓到 NEGATIVE_RE');
    const pattern = m[1];
    for (const word of ['outbrain', 'related', 'widget', 'gdpr', 'sponsor', 'shoutbox', 'skyscraper']) {
      assert.ok(new RegExp(`\\b${word}\\b`).test(pattern),
        `NEGATIVE_RE 必須含 \`${word}\`；實際 pattern=${pattern}`);
    }
  });
});

// -----------------------------------------------------------------------------
// v0.7.5 Readability.js 借鑑：nbTopCandidates 競爭分析
// detector 從「只挑 top 1」改為「收前 5 名、比較 top1/top2 分數」，膠著
// 區（比值 < 1.25）→ result.ambiguous=true + confidence 打折 + promote
// hops 收緊到 1，避免 top1 是誤選 anchor 時 promote 升到 common ancestor
// 把兩個候選都吞進主文。
// -----------------------------------------------------------------------------
describe('detector — readability-ambiguous-candidates（nbTopCandidates 競爭分析）', () => {
  let result;
  before(() => {
    result = loadFixtureAndRunDetector('readability-ambiguous-candidates.html').result;
  });

  it('偵測成功，命中 heuristic 策略', () => {
    assert.ok(result, '偵測應成功');
    assert.strictEqual(result.strategy, 'heuristic');
  });

  it('result.ambiguous === true（top1/top2 分數比值 < 1.25 → 膠著區）', () => {
    assert.strictEqual(result.ambiguous, true,
      '兩個候選分數接近時必須回報 ambiguous=true，forcing：拿掉 `const ambiguous = ...` 判定 → fail');
  });

  it('ambiguous 時 confidence 應被打折（×0.85），不應達到非模糊時的高信心', () => {
    // confidence 打折後仍應 >= MIN_CONFIDENCE（0.30），否則會回 null
    assert.ok(result.confidence >= 0.30,
      `confidence (${result.confidence}) 應 >= 0.30 才不會被回 null`);
    // 打折上限：0.70 × 0.85 = 0.595
    assert.ok(result.confidence <= 0.60,
      `confidence (${result.confidence}) 應 <= 0.60——模糊區打折後的上限`);
  });
});

// -----------------------------------------------------------------------------
// v0.7.6 Postlight Parser 借鑑：Schema.org microdata `itemprop="articleBody"`
// 策略。detectBySchemaOrg 雙層：Layer A itemtype（原邏輯）→ Layer B itemprop
// fallback（新增）。NYT / CNN / Ars Technica 等新聞站 Postlight parser 都走
// itemprop selector，說明許多站即便沒在容器掛 itemtype，內層仍標了
// itemprop="articleBody"（SEO 慣例）。
// -----------------------------------------------------------------------------
describe('detector — schema-org-articlebody（itemprop="articleBody" Layer B fallback）', () => {
  let result;
  before(() => {
    result = loadFixtureAndRunDetector('schema-org-articlebody.html').result;
  });

  it('偵測成功', () => {
    assert.ok(result, '偵測應成功（Layer B 命中 itemprop="articleBody"）');
  });

  it('strategy === "schema-org-body"（走 Layer B，非 heuristic 或 article-tag）', () => {
    assert.strictEqual(result.strategy, 'schema-org-body',
      'fixture 無 <article> tag + 無 itemtype，必須走 itemprop fallback—— forcing：拿掉 Layer B，detector 會退回 heuristic 策略，此 assertion fail');
  });

  it('confidence === 0.85（與 itemtype 策略同等信心）', () => {
    assert.strictEqual(result.confidence, 0.85);
  });

  it('選中 itemprop="articleBody" 元素、主文 SCHEMA_BODY_MARK 保留', () => {
    assert.ok(result.el);
    assert.strictEqual(result.el.getAttribute('itemprop'), 'articleBody',
      '選中的 el 必須掛 itemprop="articleBody"');
    const txt = (result.el.textContent || '').toString();
    assert.ok(txt.includes('SCHEMA_BODY_MARK'),
      '主文必須保留所有 SCHEMA_BODY_MARK 段落');
    // sidebar 不得被選進（itemprop 容器僅包主文，不含 sidebar）
    assert.ok(!txt.includes('Sidebar'),
      'sidebar 文字不得進入 detected.el（itemprop 容器是 sidebar 的兄弟，範圍精準）');
  });
});

describe('cleaner — linetoday tail noise sections（heading text heuristic）', () => {
  // 把 cleaner 接起來驗 heading-text rule 能清 line today 文末推薦 sections。
  // line today SPA 站 class 全是 emotion-style hash（css-xxx），NOISE_KEYWORD_RE
  // 無法命中；靠新 heading-text rule 找 h2/h3/h4 文字 match 跨站通用文末
  // 推薦 section 標題字樣（延伸閱讀 / 更多相關文章 / 其他人也看 / 查看更多 /
  // 最新消息 等），hide heading closest `<section>`。
  const CLEANER_SRC = fs.readFileSync(
    path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'),
    'utf8'
  );

  let window, detected, hidden;
  before(() => {
    const html = fs.readFileSync(
      path.join(FIXTURE_DIR, 'linetoday-ogtitle-suffix.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    window = dom.window;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    detected = window.__JRead.detector.detect();
    hidden = window.__JRead.cleaner.clean(detected.el);
  });

  after(() => {
    if (window && window.__JRead && window.__JRead.cleaner) {
      window.__JRead.cleaner.restore(hidden);
    }
  });

  const tailIds = [
    ['tail-more-related', '更多國內相關文章'],
    ['tail-also-read', '其他人也看了'],
    ['tail-latest-news', '最新消息'],
    ['tail-see-more', '查看更多自由電子報'],
    ['tail-ai-summary', '網友貼文AI摘要']
  ];

  for (const [id, heading] of tailIds) {
    it(`文末 section #${id}（heading「${heading}」）必須被 heading text heuristic hide`, () => {
      const sec = window.document.getElementById(id);
      assert.ok(sec, `fixture 應含 section#${id}`);
      assert.strictEqual(sec.dataset.jreadHidden, '1',
        `heading「${heading}」符合 NOISE_HEADING_TEXT_RE、其 closest('section, aside') 必須被 hide`);
    });
  }

  it('「查看原始文章」link（class ltcp-link，無 heading）必須被 link-text heuristic hide', () => {
    // text「查看原始文章」6 chars，match NOISE_LINK_TEXT_RE。該 <a> 是
    // swipe-back 的 direct descendant、沒被 <p> / <div> 包住，target 只
    // hide a 本身。
    const a = window.document.getElementById('tail-view-original');
    assert.ok(a, 'fixture 應含 #tail-view-original 連結');
    assert.strictEqual(a.dataset.jreadHidden, '1',
      'a text「查看原始文章」符合 NOISE_LINK_TEXT_RE 應被 hide');
  });

  it('主文內 LINE 官方帳號訂閱 CTA（<p><a>）必須被 link-text heuristic hide 整段 p', () => {
    // text「點開加入自由電子報LINE官方帳號，新聞脈動隨時掌握！」命中
    // `加入.{0,10}(LINE|官方帳號)` alternation。a 文字占 p 文字 100%
    // → 應 hide 整個 <p>。
    const p = window.document.getElementById('cta-line-subscribe');
    assert.ok(p, 'fixture 應含 #cta-line-subscribe CTA 段落');
    assert.strictEqual(p.dataset.jreadHidden, '1',
      'a 文字占 <p> 100%，命中 NOISE_LINK_TEXT_RE 應 hide 整個 <p>');
  });

  it('主文段落（LINETODAY_MAIN_MARK）保留不被 hide', () => {
    const mainP = Array.from(window.document.querySelectorAll('p')).find(
      p => p.textContent.includes('LINETODAY_MAIN_MARK'));
    assert.ok(mainP, 'fixture 應含 LINETODAY_MAIN_MARK 段落');
    assert.notStrictEqual(mainP.dataset.jreadHidden, '1',
      '主文段落不得被 heading-text rule 誤殺');
  });

  it('動態 append 到 articleEl 內的「其他人也看了」section 會被 MutationObserver 攔截 hide（SPA lazy-load 場景）', async () => {
    // 模擬 LINE Today 類 SPA：clean() 跑完之後，站點 JS 才 lazy-load 注入
    // 推薦 section 到 articleEl 內（div.swipe-back）。舊 observer 只看主文
    // 祖先鏈、articleEl 內部新 append 被 isRelated 當 legit 跳過——漏網。
    // 新 observer 對 articleEl 內部 append 跑雜訊特徵檢查（heading text /
    // keyword），命中才 hide。
    const lazyInject = window.document.createElement('section');
    lazyInject.id = 'lazy-injected-suggest';
    lazyInject.className = 'moduleContainer css-abc123'; // emotion-hash class
    lazyInject.innerHTML = '<h2>其他人也看了</h2><ul><li><a href="/x">測試連結</a></li></ul>';
    detected.el.appendChild(lazyInject);

    // 等 MutationObserver callback 跑完（microtask）
    await new Promise(r => setTimeout(r, 0));

    const sec = window.document.getElementById('lazy-injected-suggest');
    assert.strictEqual(sec.dataset.jreadHidden, '1',
      '動態 append 的「其他人也看了」section 必須被 observer 攔截 hide');
  });
});
