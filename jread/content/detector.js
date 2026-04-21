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

  // ---- 策略 1：語意標籤 <article> ------------------------------------
  // 注意：<main> 本身作為兜底由 detectByMainTag() 處理，且排在 heuristic
  // 之後。理由：若頁面有 <main> 但無 <article>，且 <main> 內用 CSS grid /
  // flex 做多欄 layout（例如 WordPress wp-block-columns），直接採用 <main>
  // 會把 sidebar 吞進主文。應該讓 heuristic 有機會在 <main> 內部找到更精準
  // 的內容容器，找不到再退回整個 <main>。
  function detectByArticleTag() {
    const articles = Array.from(document.querySelectorAll('article'));
    if (articles.length === 0) return null;

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

  // ---- 兜底：<main> 元素 --------------------------------------------
  // 順序擺在 heuristic 之後的兜底。只有當 article/schema.org/heuristic 三者
  // 都沒命中時才採用整個 <main>。
  function detectByMainTag() {
    const main = document.querySelector('main');
    if (!main) return null;
    if (getText(main).length < MIN_TEXT_LEN) return null;
    return { el: main, confidence: 0.75, strategy: 'main-tag' };
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

  // ---- 策略 4：內容密度啟發式（Readability-style bubble-up）-------------
  // 為何不用「計 el 後代 p 總數」：這會讓站體外殼（例如 body-level
  // wrapper、<main>、WordPress wp-site-blocks）因為「後代所有 p」累計贏
  // 過真正的主文容器——典型案例是 Stratechery 頁面，真主文 entry-content
  // 內 <p> 只有 5 個（其他內容包在 ol/ul/h3/figure），整站外殼 p 數 32、
  // 直接搶走第一名。
  //
  // 改走 Readability.js 的 bubble-up：對每個「訊號元素」(p / li / h2-4 /
  // blockquote / pre) 算基礎 contentScore（文字長度 + 逗號數），把分數往上
  // 累加——parent 拿 100%、grandparent 拿 50%。這樣「主文直系容器」拿到
  // 最高的累積分，而遠祖外殼只拿到很淺的折扣分，自然選對層級。
  const SIGNAL_SEL = 'p, pre, blockquote, h2, h3, h4, li';
  const SIGNAL_MIN_TEXT = 25;

  function seedScore(text) {
    let s = 1;
    // 逗號數（中英文都算）— 長句有逗號 = 內文特徵
    s += (text.match(/[,，、]/g) || []).length;
    // 文字長度 → 每 100 字 +1，上限 3
    s += Math.min(Math.floor(text.length / 100), 3);
    return s;
  }

  function detectByHeuristic() {
    const scoreMap = new Map();
    const signals = document.querySelectorAll(SIGNAL_SEL);
    for (const el of signals) {
      const text = (el.innerText || el.textContent || '').trim();
      if (text.length < SIGNAL_MIN_TEXT) continue;
      const base = seedScore(text);
      const p = el.parentElement;
      if (p) scoreMap.set(p, (scoreMap.get(p) || 0) + base);
      const gp = p && p.parentElement;
      if (gp) scoreMap.set(gp, (scoreMap.get(gp) || 0) + base / 2);
    }

    let best = null;
    let bestScore = 0;

    for (const [el, raw] of scoreMap.entries()) {
      // 限定「容器型」元素（避免 li / p 自己也被選為主文）
      const tag = el.tagName;
      if (tag !== 'DIV' && tag !== 'SECTION' && tag !== 'MAIN' && tag !== 'ARTICLE') continue;

      const textLen = getText(el).length;
      if (textLen < MIN_TEXT_LEN) continue;

      // 連結密度懲罰：主文的連結密度應低；sidebar / 相關文章列表的連結密度高
      const ld = linkDensity(el, textLen);
      let score = raw * (1 - Math.min(ld, 0.95));

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

    // 分數 → confidence 線性縮放：bubble-up 的典型主文分數在 20–60 範圍。
    // 10 分以下 → 0.30（門檻邊緣），50 分以上 → 0.70（高信心上限）
    const raw = (bestScore - 10) / 40 * 0.4 + 0.30;
    const confidence = Math.max(0.30, Math.min(0.70, raw));

    if (confidence < MIN_CONFIDENCE) return null;

    return { el: promoteForTitle(best), confidence, strategy: 'heuristic' };
  }

  // ---- 主文容器 promote：保留文章標題 -----------------------------------
  // 場景：WordPress（Stratechery）/ Medium / Substack 等 CMS 把 post-title
  // 放在 content 的兄弟層（post-title + post-content 同級），heuristic
  // bubble-up 會選中 post-content 但 title 被漏在外面——cleaner 走祖先兄弟
  // 規則時連同標題一起隱藏，閱讀模式畫面上就沒有標題。
  //
  // 通則（非站點特判）：沿 articleEl 的祖先鏈往上走，若任一層兄弟（或其
  // 後代）裡有 h1/h2 文字與 document.title 或 og:title 高度相符，代表該
  // h1/h2 就是本文標題——把主文容器升級到它與 articleEl 的共同 parent，
  // 使標題納入主文 scope。
  function normalizeTitle(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function getCanonicalTitle() {
    const og = normalizeTitle(
      document.querySelector('meta[property="og:title"]')?.content || ''
    );
    if (og.length >= 4) return og;
    // document.title 常含站名尾綴（"文章 – 站名"），只取首段
    const t = normalizeTitle(document.title || '');
    const head = t.split(/\s+[–—|]\s+/)[0];
    return head.length >= 4 ? head : t;
  }

  function titleMatches(target, text) {
    // 雙向包含，避免 og:title / document.title / h1 互有冗餘前後綴的差異
    if (!target || !text) return false;
    if (target === text) return true;
    if (target.length >= 8 && target.includes(text) && text.length >= target.length * 0.6) return true;
    if (text.length >= 8 && text.includes(target) && target.length >= text.length * 0.6) return true;
    return false;
  }

  function promoteForTitle(articleEl) {
    const target = getCanonicalTitle();
    if (!target) return articleEl;

    let cur = articleEl;
    while (cur && cur.parentElement && cur !== document.body) {
      const parent = cur.parentElement;
      for (const sib of parent.children) {
        if (sib === cur) continue;
        // 直接是 h1/h2
        const heads = (sib.matches && sib.matches('h1, h2'))
          ? [sib]
          : Array.from(sib.querySelectorAll ? sib.querySelectorAll('h1, h2') : []);
        for (const h of heads) {
          const text = normalizeTitle(h.innerText || h.textContent || '');
          if (titleMatches(target, text)) {
            // 升級到 articleEl 與 h 的共同 parent = 當前 parent
            return parent;
          }
        }
      }
      cur = parent;
    }
    return articleEl;
  }

  // ---- 主函式 ---------------------------------------------------------
  const detector = {
    /**
     * 偵測主文，回傳 { el, confidence, strategy }；未達門檻時回傳 null。
     * strategy 可能值：'article-tag' | 'schema-org' | 'heuristic' | 'main-tag'
     *
     * 順序原則：語意明確者優先。main-tag 放最後兜底，避免在多欄 layout 的
     * <main> 上吞 sidebar（WordPress wp-block-columns 這類結構）。
     */
    detect() {
      return (
        detectByArticleTag() ||
        detectBySchemaOrg() ||
        // 策略 3（OpenGraph）本輪未實作
        detectByHeuristic() ||
        detectByMainTag() ||
        null
      );
    }
  };

  NS.detector = detector;
})();
