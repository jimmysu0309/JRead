// JRead — regression spec: X longform（Articles）文章標題（v1.7.37）
// -----------------------------------------------------------------------------
// Bug（Jimmy 2026-08-04 回報 x.com/thedankoe/status/2081415714636996844）：
// X longform 貼文「進閱讀模式抓不到標題，送 Readwise 也沒送對標題」。
//
// 根因（cage 在登入態真實 DOM 實測，非 fixture 推論）：X longform 的文章標題是
//   div[data-testid="twitter-article-title"] > span   （34px / weight 800）
// 它在 article[role="article"] 內、有被 clone 進合成容器、也沒被 cleaner 標隱藏
// ——但它**不是 heading tag**，於是兩件事同時壞掉：
//   1. 視覺：styler 的 typography override 把它當內文渲染（實測 17px / 400 /
//      display:inline，與段落無異）→ 使用者眼中「沒有標題」
//   2. 匯出：合成容器內零個 <h1>，而 longform 的 <h2> 是**內文章節**標題 →
//      NS.findCardTitleHeading 退到第 2 步「內文前首個 h2」，抓到章節標題
//      「How to actually learn anything fast」送去 Readwise
// 且登入態的 document.title 是**空字串**，fallback 也救不了。
//
// 修法：x-thread.js enter() clone 後把標題 div 提升成真 <h1>（promoteArticleTitle）。
// 一次解決兩邊——styler 的 titleFontSize 規則自然套上、findCardTitleHeading
// 第 1 步就命中。site module 內用 data-testid 合規（CLAUDE.md 硬規則 3 允許站點
// 特判放在明確隔離的模組；X 的 class 全是 hash，testid 是唯一穩定語意載體）。
//
// 訊號層次（CLAUDE.md 工作流原則 3）：本檔驗「DOM 結構轉換 + 標題選取結果」。
// **不驗**真實瀏覽器裡 h1 的實際字級（那要 harness/cage 看 computed style）、
// 也不驗 Readwise API 端收到什麼（那是 buildReadwisePayload 的守備範圍）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const XTHREAD_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'x-thread.js'), 'utf8');
const NAMESPACE_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'namespace.js'), 'utf8');
const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'x-longform-title.html'), 'utf8');

function setup(html) {
  const dom = new JSDOM(html || FIXTURE, {
    url: 'https://x.com/thedankoe/status/2081415714636996844',
    runScripts: 'outside-only'
  });
  const { window } = dom;
  window.chrome = { runtime: { getManifest: () => ({ version: '1.7.37' }) } };
  window.eval(NAMESPACE_SRC);
  window.eval(XTHREAD_SRC);
  return { window, document: window.document, NS: window.__JRead };
}

describe('X longform 文章標題（v1.7.37）', () => {

  describe('promoteArticleTitle：標題 div → <h1>', () => {
    it('longform 標題 div 轉成 <h1> 並保留文字', () => {
      const { document, NS } = setup();
      const art = document.querySelector('article[role="article"]');
      const clone = art.cloneNode(true);
      assert.strictEqual(NS.xThread.promoteArticleTitle(clone), true);

      const h1s = clone.querySelectorAll('h1');
      assert.strictEqual(h1s.length, 1, '必須產生剛好一個 h1');
      assert.strictEqual(h1s[0].textContent.trim(),
        'How to remember everything you read (stop trying)');
      assert.strictEqual(h1s[0].getAttribute('data-jread-x-title'), '1');
    });

    it('原標題 div 必須被取代（不可留下重複的標題節點）', () => {
      const { document, NS } = setup();
      const clone = document.querySelector('article[role="article"]').cloneNode(true);
      NS.xThread.promoteArticleTitle(clone);
      assert.strictEqual(
        clone.querySelectorAll('[data-testid="twitter-article-title"]').length, 0,
        '標題 div 應被 h1 取代，殘留會讓標題在 card 內出現兩次');
    });

    it('保留標題內的 inline 結構（span / emoji img 不被壓成純文字）', () => {
      const { document, NS } = setup();
      const clone = document.querySelector('article[role="article"]').cloneNode(true);
      NS.xThread.promoteArticleTitle(clone);
      assert.ok(clone.querySelector('h1 span'),
        '搬 childNodes 而非 textContent，inline 子節點必須還在');
    });

    it('h1 必須落在原標題的位置（內文之前）', () => {
      const { document, NS } = setup();
      const clone = document.querySelector('article[role="article"]').cloneNode(true);
      NS.xThread.promoteArticleTitle(clone);
      const h1 = clone.querySelector('h1');
      const firstH2 = clone.querySelector('h2');
      assert.ok(h1.compareDocumentPosition(firstH2) & 4 /* DOCUMENT_POSITION_FOLLOWING */,
        'h1 必須在章節 h2 之前');
    });

    it('非 longform 推文（無該 testid）→ no-op，不動 DOM', () => {
      const { document, NS } = setup(`<!doctype html><html><body>
        <article role="article" data-testid="tweet">
          <div data-testid="tweetText"><span>just a normal tweet</span></div>
        </article></body></html>`);
      const clone = document.querySelector('article[role="article"]').cloneNode(true);
      const before = clone.innerHTML;
      assert.strictEqual(NS.xThread.promoteArticleTitle(clone), false);
      assert.strictEqual(clone.innerHTML, before, '普通推文不可被改動');
      assert.strictEqual(clone.querySelectorAll('h1').length, 0);
    });

    it('空標題 div → no-op（轉了會讓標題變空字串，比 fallback 更糟）', () => {
      const { document, NS } = setup(`<!doctype html><html><body>
        <article role="article" data-testid="tweet">
          <div data-testid="twitter-article-title"><span>   </span></div>
        </article></body></html>`);
      const clone = document.querySelector('article[role="article"]').cloneNode(true);
      assert.strictEqual(NS.xThread.promoteArticleTitle(clone), false);
      assert.strictEqual(clone.querySelectorAll('h1').length, 0);
    });

    it('已經是 h1 → no-op（重入安全）', () => {
      const { document, NS } = setup(`<!doctype html><html><body>
        <article role="article" data-testid="tweet">
          <h1 data-testid="twitter-article-title"><span>已經是標題</span></h1>
        </article></body></html>`);
      const clone = document.querySelector('article[role="article"]').cloneNode(true);
      assert.strictEqual(NS.xThread.promoteArticleTitle(clone), false);
      assert.strictEqual(clone.querySelectorAll('h1').length, 1);
    });
  });

  describe('enter() 產出的合成容器', () => {
    it('合成容器內含提升後的 h1', () => {
      const { document, NS } = setup();
      const container = NS.xThread.enter();
      assert.ok(container, 'enter() 必須建出合成容器');
      const h1 = container.querySelector('h1[data-jread-x-title]');
      assert.ok(h1, '合成容器必須有提升後的 h1');
      assert.strictEqual(h1.textContent.trim(),
        'How to remember everything you read (stop trying)');
    });
  });

  describe('標題選取結果（修法的實際目的）', () => {
    // 這組是 bug 的直接復現：沒有 h1 時 findCardTitleHeading 會抓到章節 h2。
    it('修法前的失敗模式：無 h1 時會選到章節 h2（本 assert 記錄該行為）', () => {
      const { document, NS } = setup();
      // 不跑 promoteArticleTitle，模擬修法前的合成容器
      const raw = document.querySelector('article[role="article"]').cloneNode(true);
      assert.strictEqual(NS.findCardTitleHeading(raw),
        'How to actually learn anything fast',
        '這就是 Jimmy 收到錯標題的機制——章節 h2 被當主標');
    });

    it('修法後 findCardTitleHeading 取得正確的文章標題', () => {
      const { document, NS } = setup();
      const container = NS.xThread.enter();
      assert.strictEqual(NS.findCardTitleHeading(container),
        'How to remember everything you read (stop trying)');
    });

    it('document.title 為空也不影響（不依賴 fallback）', () => {
      const { document, NS } = setup();
      assert.strictEqual(document.title, '',
        'fixture 必須複現登入態 x.com 的空 document.title');
      const container = NS.xThread.enter();
      assert.ok(NS.findCardTitleHeading(container).length > 0,
        '標題必須來自 DOM，不可依賴 document.title');
    });
  });
});
