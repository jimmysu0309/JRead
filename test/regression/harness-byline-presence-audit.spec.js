// JRead — harness byline-presence audit（作者+日期進 reader card，v1.5.1）
// -----------------------------------------------------------------------------
// Forcing function for audit-lib.js tagOriginalByline / collectDroppedByline。
//
// Trigger（v1.5 Medium it-chronicles）：進閱讀模式後文章頭部作者+日期被兩條 cleaner
// 規則（author-bio-card / button-cluster）各自誤殺整塊砍，Page Rounds 卻全綠漏抓——
// 既有 audit 只覆蓋標題（auditTitlePresence）與長散文（droppedProse >= 80 chars），
// byline 是短文字、兩層都不驗。命中 CLAUDE.md 工作流原則 3「綠燈 ≠ 品質沒問題，
// 補 missing 那層 check」。本 audit 補「masthead 作者+日期 carrier 是否存活」。
//
// 訊號層次：本 spec 驗 jsdom 可驗的部分——（1）ground truth 抽取（JSON-LD/meta 作者+
// 發表日期）、（2）masthead 邊界（首個長段落之前才標記，排除文末 bio 卡）、（3）最深
// carrier 標記、（4）掉失判定（data-jread-hidden 祖先 → 該維度全 hide → missing）。
// 不驗：真實 layout 的 getClientRects 隱藏路徑（jsdom 無 layout、rect 全空）——以
// stubRect 模擬「存活」；真實站點由 page-rounds harness 實跑驗。

const assert = require('assert');
const path = require('path');
const { JSDOM } = require('jsdom');

const auditLib = require(path.join(__dirname, '..', '..', 'tools', 'audit-lib.js'));

// 在 jsdom window 內重建 pageFn（等價 page.evaluate 序列化），確保自包含、無閉包外引。
const rebuildTag = (window) => window.eval(`(${auditLib.pageFns.tagOriginalByline.toString()})`);
const rebuildCollect = (window) => window.eval(`(${auditLib.pageFns.collectDroppedByline.toString()})`);

// 200+ char lead paragraph（masthead 邊界錨）
const LEAD = 'In January 1998 a personal computer company announced it would buy the company that had spent forty years explaining to the world what a serious computer was supposed to be, and the irony of that acquisition still echoes through the industry to this day.';

function makeDom(opts = {}) {
  const ld = opts.noLd ? '' :
    `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Article',
      author: { '@type': 'Person', name: 'huizhou92' },
      datePublished: '2026-06-03'
    })}</script>`;
  const dom = new JSDOM(`<!DOCTYPE html><html><head>${ld}</head><body>
    <article>
      <h1 id="title">The Computer Company That Was Right About Everything</h1>
      <div id="masthead">
        <a id="author" href="/@huizhou92">huizhou92</a>
        <span id="readtime">11 min read</span>
        <span id="date">Jun 3, 2026</span>
      </div>
      <p id="lead">${LEAD}</p>
      <p id="body2">Digital Equipment Corporation built machines that engineers revered and a culture that prized engineering excellence above marketing, a philosophy that would ultimately prove both its greatest strength and its fatal weakness in the end.</p>
      <div id="bottom-bio">
        <a id="bio-author" href="/@huizhou92">huizhou92</a>
        <p id="bio-text">huizhou92 writes about computing history and the technology industry for a living.</p>
      </div>
    </article>
  </body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  return dom;
}

// jsdom 無 layout → getClientRects 預設空；給「應存活」的元素掛非空 rect。
function stubVisible(el) {
  el.getClientRects = () => [{ width: 80, height: 18, top: 0, left: 0, right: 80, bottom: 18 }];
}

describe('harness byline-presence audit — tag（masthead carrier 標記，v1.5.1）', () => {
  it('JSON-LD 作者名 carrier 被標記（最深、緊貼）', () => {
    const dom = makeDom();
    const res = rebuildTag(dom.window)();
    assert.strictEqual(res.author, 'huizhou92', 'ground truth 應從 JSON-LD 抽到作者');
    const author = dom.window.document.getElementById('author');
    assert.strictEqual(author.getAttribute('data-pr-byline'), 'author',
      '緊貼作者名的最深元素應被標記為 author carrier');
  });

  it('發表日期 carrier 被標記（顯示字面 Jun 3, 2026 對上 ISO datePublished）', () => {
    const dom = makeDom();
    rebuildTag(dom.window)();
    const date = dom.window.document.getElementById('date');
    assert.strictEqual(date.getAttribute('data-pr-byline'), 'date',
      'ISO 2026-06-03 → 顯示字面「Jun 3, 2026」的 carrier 應被標記');
  });

  it('masthead 大 wrapper 不被標記（最深限定，讓子元素 carrier 接）', () => {
    const dom = makeDom();
    rebuildTag(dom.window)();
    const masthead = dom.window.document.getElementById('masthead');
    assert.ok(!masthead.hasAttribute('data-pr-byline'),
      'masthead 含更深的 author/date carrier → 不應標記 wrapper 本身');
  });

  it('負控制：文末 bio 卡的同名作者連結不被標記（在 body 之後、非 masthead）', () => {
    const dom = makeDom();
    rebuildTag(dom.window)();
    const bioAuthor = dom.window.document.getElementById('bio-author');
    assert.ok(!bioAuthor.hasAttribute('data-pr-byline'),
      '文末 bio 卡同名連結在首個長段落之後 → 不在 masthead，不可標記（否則被正常清除會誤判掉失）');
  });

  it('無 JSON-LD/meta 作者+日期基準 → 不標記、回 tagged 0', () => {
    const dom = makeDom({ noLd: true });
    const res = rebuildTag(dom.window)();
    assert.strictEqual(res.tagged, 0, '無 ground truth 應安全跳過');
  });
});

describe('harness byline-presence audit — collect（掉失判定，v1.5.1）', () => {
  it('masthead byline 整塊被 hide（data-jread-hidden 祖先）→ 作者+日期皆掉失、missing', () => {
    const dom = makeDom();
    rebuildTag(dom.window)();
    // 模擬 cleaner 整塊砍 masthead（Medium 真實 bug：header-block 整支 hide）
    dom.window.document.getElementById('masthead').setAttribute('data-jread-hidden', '1');
    const res = rebuildCollect(dom.window)();
    assert.strictEqual(res.checked, true);
    assert.ok(res.authorDropped, '作者 carrier 在 hidden 子樹 → authorDropped');
    assert.ok(res.dateDropped, '日期 carrier 在 hidden 子樹 → dateDropped');
    assert.ok(res.missing, 'missing 應為 true（review-tier 觸發）');
  });

  it('byline carrier 存活（無 hidden 祖先、有 rect）→ 不掉失', () => {
    const dom = makeDom();
    rebuildTag(dom.window)();
    stubVisible(dom.window.document.getElementById('author'));
    stubVisible(dom.window.document.getElementById('date'));
    const res = rebuildCollect(dom.window)();
    assert.strictEqual(res.checked, true);
    assert.strictEqual(res.missing, false, 'carrier 全存活 → 不應誤報掉失');
    assert.strictEqual(res.authorDropped, false);
    assert.strictEqual(res.dateDropped, false);
  });

  it('只有日期被 hide → 僅 dateDropped（維度獨立判定）', () => {
    const dom = makeDom();
    rebuildTag(dom.window)();
    stubVisible(dom.window.document.getElementById('author'));
    dom.window.document.getElementById('date').setAttribute('data-jread-hidden', '1');
    const res = rebuildCollect(dom.window)();
    assert.strictEqual(res.authorDropped, false, '作者存活 → 不掉失');
    assert.ok(res.dateDropped, '只有日期 carrier 被 hide → dateDropped');
    assert.ok(res.missing);
  });

  it('負控制：文末 bio 卡被正常清除不觸發 byline 掉失（未標記 → 不計入）', () => {
    const dom = makeDom();
    rebuildTag(dom.window)();
    stubVisible(dom.window.document.getElementById('author'));
    stubVisible(dom.window.document.getElementById('date'));
    // bio 卡被 cleaner 正常清掉（應該的）——但它不是 tagged carrier，不可影響判定
    dom.window.document.getElementById('bottom-bio').setAttribute('data-jread-hidden', '1');
    const res = rebuildCollect(dom.window)();
    assert.strictEqual(res.missing, false,
      '正常清除文末 bio 不可被誤判成 byline 掉失（masthead carrier 仍存活）');
  });

  it('無 tagged carrier → checked:false（harness 跳過、不進 review）', () => {
    const dom = makeDom({ noLd: true });
    rebuildTag(dom.window)();
    const res = rebuildCollect(dom.window)();
    assert.strictEqual(res.checked, false);
    assert.strictEqual(res.missing, false);
  });
});
