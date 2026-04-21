// JRead — 主文偵測
// 偵測策略優先序（SPEC.md）：
//   1. <article> / <main> 內含 <article>          → confidence 0.90
//   2. Schema.org itemtype="Article" / NewsArticle / BlogPosting → 0.85
//   3. OpenGraph og:type="article" + 啟發式（本輪未實作）
//   4. 內容密度啟發式（Readability.js 風格）      → 0.30–0.70
//   5. 分數低於閾值 → no-op，回傳 null（不硬套排版）
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  // ---- 常數 -----------------------------------------------------------
  // 主文最少字數門檻。商周付費文章約 540 字、Medium 列表頁摘要約 200–500
  // 字，設 200 能兼顧付費文章又不易誤認列表頁的單張卡片為主文。
  const MIN_TEXT_LEN = 200;
  // 低於此 confidence 視為偵測失敗，回傳 null。
  const MIN_CONFIDENCE = 0.30;

  // class/id 權重用的 regex（Readability.js 的經典名單）
  const POSITIVE_RE = /article|content|body|post|entry|main|story|text/i;
  const NEGATIVE_RE = /comment|sidebar|footer|nav|menu|header|promo|banner|ad[-_]|[-_]ad|combx|disqus|foot|masthead|popup|share|social/i;

  // ---- 工具 -----------------------------------------------------------
  function getText(el) {
    // innerText 只取可見文字，較準確；失敗才退回 textContent
    return ((el.innerText || el.textContent) || '').trim();
  }

  function linkDensity(el, textLen) {
    if (textLen <= 0) return 0;
    let linkLen = 0;
    el.querySelectorAll('a').forEach(a => {
      linkLen += (a.innerText || a.textContent || '').length;
    });
    return linkLen / textLen;
  }

  // ---- 策略 1：語意標籤 ----------------------------------------------
  function detectByArticleTag() {
    const main = document.querySelector('main');
    let articles = main ? Array.from(main.querySelectorAll('article')) : [];
    if (articles.length === 0) {
      articles = Array.from(document.querySelectorAll('article'));
    }

    if (articles.length === 0) {
      // 沒有 <article>，但若 <main> 本身文字夠多也可作為備援。
      if (main && getText(main).length >= MIN_TEXT_LEN) {
        return { el: main, confidence: 0.75, strategy: 'main-tag' };
      }
      return null;
    }

    // 單一 <article>：直接採用（需過字數門檻）
    if (articles.length === 1) {
      const el = articles[0];
      if (getText(el).length < MIN_TEXT_LEN) return null;
      return { el, confidence: 0.9, strategy: 'article-tag' };
    }

    // 多個 <article>：通常是列表頁（首頁、部落格首頁、Medium 的 for you 等）
    // 策略：挑最長者；但若前幾篇長度相近，認定為列表頁而降級到策略 4
    const sorted = articles
      .map(el => ({ el, len: getText(el).length }))
      .sort((a, b) => b.len - a.len);

    const top = sorted[0];
    if (top.len < MIN_TEXT_LEN) return null;

    // 列表頁偵測：有第 3 篇且其長度 > 門檻、且 top 沒比第 3 篇長 1.5 倍以上
    // → 三篇長度相近，視為列表頁，降級
    const looksLikeListPage = sorted.length >= 3 &&
      sorted[2].len >= MIN_TEXT_LEN &&
      top.len < sorted[2].len * 1.5;

    if (looksLikeListPage) return null;

    return { el: top.el, confidence: 0.9, strategy: 'article-tag' };
  }

  // ---- 策略 2：Schema.org --------------------------------------------
  function detectBySchemaOrg() {
    const selectors = [
      '[itemtype*="NewsArticle" i]',
      '[itemtype*="BlogPosting" i]',
      '[itemtype*="Article" i]'
    ];
    for (const sel of selectors) {
      const candidates = Array.from(document.querySelectorAll(sel));
      // 頁面可能多個（例如相關文章 list 也標 Article），取最長
      const best = candidates
        .map(el => ({ el, len: getText(el).length }))
        .filter(x => x.len >= MIN_TEXT_LEN)
        .sort((a, b) => b.len - a.len)[0];
      if (best) {
        return { el: best.el, confidence: 0.85, strategy: 'schema-org' };
      }
    }
    return null;
  }

  // ---- 策略 4：內容密度啟發式 ----------------------------------------
  // Readability.js 的核心想法：以段落為訊號，對所有 block 容器打分，
  // 挑「段落數多、文字密度高、連結密度低、class/id 正向」者。
  function detectByHeuristic() {
    const candidates = document.querySelectorAll('div, section, main, article');

    let best = null;
    let bestScore = 0;

    for (const el of candidates) {
      const textLen = getText(el).length;
      if (textLen < MIN_TEXT_LEN) continue;

      const paragraphs = el.querySelectorAll('p');
      if (paragraphs.length < 2) continue;

      // 基礎分：段落數 + log2(textLen)（log 避免 nav 文字多贏過內文）
      let score = paragraphs.length + Math.log2(textLen);

      // 連結密度懲罰：內文段落的連結密度應該低
      const ld = linkDensity(el, textLen);
      if (ld > 0.5) score *= 0.5;
      else if (ld > 0.3) score *= 0.75;

      // class/id 正負向權重
      const marker = ((el.className || '') + ' ' + (el.id || '')).toLowerCase();
      if (POSITIVE_RE.test(marker)) score *= 1.25;
      if (NEGATIVE_RE.test(marker)) score *= 0.5;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (!best) return null;

    // 分數 → confidence 線性縮放：10 分以下 0.30，40 分以上 0.70
    const raw = (bestScore - 10) / 30 * 0.4 + 0.30;
    const confidence = Math.max(0.30, Math.min(0.70, raw));

    if (confidence < MIN_CONFIDENCE) return null;

    return { el: best, confidence, strategy: 'heuristic' };
  }

  // ---- 主函式 ---------------------------------------------------------
  const detector = {
    /**
     * 偵測主文，回傳 { el, confidence, strategy }；未達門檻時回傳 null。
     * strategy 可能值：'article-tag' | 'main-tag' | 'schema-org' | 'heuristic'
     */
    detect() {
      return (
        detectByArticleTag() ||
        detectBySchemaOrg() ||
        // 策略 3（OpenGraph）本輪未實作
        detectByHeuristic() ||
        null
      );
    }
  };

  NS.detector = detector;
})();
