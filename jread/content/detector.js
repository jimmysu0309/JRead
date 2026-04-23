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

  // Signal 元素排除規則：祖先鏈含 ARIA UI-chrome 語意（dialog / alertdialog /
  // tooltip / aria-modal）或明確隱藏標記（inline display:none / aria-hidden）
  // 的 signal 不算數。這些是對話框 / 彈窗 / 提示面板，結構上絕不是主文。
  //
  // 場景（upmedia.mg 國際版 /tw/international/headlines/256941 實測）：
  // Bootstrap `<div class="modal fade" id="myModal">` 搭配 `.modal-dialog >
  // .modal-content > .modal-box` 結構，模板裡塞了 2700+ 字的推薦文章列表
  // 純文字；modal 預設 CSS `display: none`、jsdom / 真 Chrome 都讀得到
  // textContent。innerText 在 display:none 下返回空字串、但 detector 的
  // getText 會 fallback 到 textContent——於是 modal 吃下全部 signal 分數、
  // 以 finalScore 11.9 擊敗真主文 .news-box-text（2.4）。promoteForTitle
  // 再把錯的 articleEl 升到 modal 與主文的共同 parent #wrapper，整頁 chrome
  // 全被當主文。
  //
  // 通則：ARIA role=dialog / alertdialog / tooltip、aria-modal=true 是 W3C
  // 規範「不在正文流程」的語意；inline display:none / aria-hidden=true 是
  // 「明確不渲染」的 author-declared 狀態。兩者任一命中 = 該 signal 不該
  // 進 Readability 計分。為何不走 computed style 檢查：jsdom 無 layout、
  // computed display:none 抓不到；檢查 inline + ARIA 能跨 jsdom / browser。
  //
  // Bootstrap `.modal` class 不列入判斷——非 ARIA 通則；使用 `.modal` 的站
  // 若正確掛 aria-hidden="true" 或 style="display:none"（Bootstrap 預設
  // markup 兩者都有）會被這條 guard 擋到，不掛的話代表該站把 modal 當常駐
  // 區塊用、不該把它當 UI chrome 排除。
  const HEURISTIC_SKIP_SEL =
    '[role="dialog"], [role="alertdialog"], [role="tooltip"], [aria-modal="true"], [aria-hidden="true"]';

  function isSignalExcluded(el) {
    // closest() 會把 el 自身也算進去，所以祖先鏈檢查等同 self + ancestors
    if (el.closest && el.closest(HEURISTIC_SKIP_SEL)) return true;
    // 沿祖先鏈檢查「被隱藏」——inline display:none 是最直接的 marker；
    // upmedia 等非標準 Bootstrap markup 的 modal 則沒 inline / ARIA，只靠
    // stylesheet `.modal { display: none }`，需要 getComputedStyle 才能
    // resolve。真 Chrome 能 resolve 整條 cascade；jsdom 不 resolve stylesheet
    // 但會讀 inline——fixture 測試走 inline style 即可驗覆蓋面。
    //
    // 效能：每 signal 最多走 ~10 層 parent + getComputedStyle 一次，500
    // signals 實測 Reader mode 進入仍 < 1s，可接受。
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      if (p.style && p.style.display === 'none') return true;
      try {
        const cs = window.getComputedStyle && window.getComputedStyle(p);
        if (cs && cs.display === 'none') return true;
      } catch (_) { /* jsdom 等環境部分節點 getComputedStyle 可能拋，忽略 */ }
    }
    return false;
  }

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
      if (isSignalExcluded(el)) continue;
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

      // 文字量獎勵（含 linkDensity 過濾）：2000 字的主文 container 應該贏過
      // 400 字的 UI chrome。舊 scoring 只靠 signal bubble-up 累積，對
      // 「signal 埋深層」的主文（.news-box-text > various divs > p）不利
      // ——parent/gp bubble 只能拿 50% 折扣，raw 壓得很低。
      //
      // 場景：upmedia.mg 國際版實測，bubble-up 讓 .news-box-text（2000
      // 字、ld 0.04）raw 2 finalScore 2.4，輸給 .row（396 字、ld 0.33）
      // raw 7 finalScore 4.7。加入 textLen bonus（`textLen/200` cap 10）
      // 配合 ld penalty，讓「低連結密度的長文字」拿到實質獎勵——1987 字
      // 主文 +9.9 bonus、linkDensity 0.04 幾乎不扣；397 字 UI chrome
      // +1.98 bonus、linkDensity 0.33 扣不少。
      //
      // 通則依據：文章內文容器的特徵就是「大量有意義文字 + 低連結密度」
      // ——這是 Readability.js 原作的 scoring 核心精神，textLen 獎勵
      // 只是把這個特徵明確化、避免 bubble-up 對深層主文不公。
      score += Math.min(textLen / 200, 10) * (1 - Math.min(ld, 0.95));

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

    // title promote 由 detect() 統一處理，不在此重複
    return { el: best, confidence, strategy: 'heuristic' };
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
    // og:title 與 document.title 都常含站名尾綴（「文章 | 作者 | 站名」或
    // 「文章 – 站名」）；取 `|` / `–` / `—` 加空格分隔後的首段。避免 h1
    // 僅寫純標題、而 og 加了站名尾綴，使 titleMatches 的 60% 長度比較
    // 誤判 false（line today 實測：og 47 chars / h1 27 chars，比值 57% <
    // 60% 門檻漏網——改取 og 首段後 og 等於 h1，直接 match）。
    const og = normalizeTitle(
      document.querySelector('meta[property="og:title"]')?.content || ''
    );
    if (og.length >= 4) {
      const ogHead = og.split(/\s+[–—|]\s+/)[0];
      return ogHead.length >= 4 ? ogHead : og;
    }
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

  // ---- 邊界修正：多篇 article 兄弟時限縮到第一個 ----------------------
  // 場景：infinite-scroll 新聞站（news.ltn.com.tw 自由時報）、部分 archive
  // / tag 列表頁、少數把多篇 article 塞進同一個 container 的 CMS。Heuristic
  // bubble-up 或 main-tag 兜底容易選到「多篇 article 的共同 parent」，讀者
  // 進閱讀模式時會看到第一篇 + 第二篇 + ... 全部混在一起。
  //
  // 通則（非站點特判）：h1 每頁慣例唯一；若主文容器的直系子中有 ≥ 2 個
  // 獨立子樹各含 h1，即認定為「多篇 article 兄弟」結構，限縮到第一個
  // 含 h1 的直系子。單篇文章（0 或 1 個 h1）不動。
  //
  // 放在 promoteForTitle 之後：promote 負責「往外升級包住標題」，narrow
  // 負責「往內收縮到第一篇」——兩者方向相反，先 promote 後 narrow 能處理
  // 「promote 選到的 parent 裡其實有多篇」的邊界情況。
  function narrowToFirstArticleBlock(articleEl) {
    if (!articleEl || !articleEl.children || articleEl.children.length < 2) {
      return articleEl;
    }
    const blocksWithH1 = [];
    for (const child of articleEl.children) {
      const hasH1 = (child.matches && child.matches('h1')) ||
        (child.querySelector && !!child.querySelector('h1'));
      if (hasH1) blocksWithH1.push(child);
    }
    if (blocksWithH1.length < 2) return articleEl;

    const first = blocksWithH1[0];
    const firstText = (first.innerText || first.textContent || '').trim();
    if (firstText.length < MIN_TEXT_LEN) return articleEl;
    return first;
  }

  // promoteForTitle hop 上限：合理場景中 post-title 是 articleEl 的兄弟
  // （WordPress post-title + post-content 同級）、祖父的兄弟（WordPress 的
  // section > article 結構）或 SPA 框架多層 styled-component wrapper 分隔
  // article 與 h1（line today Next.js 實測：article / h1 common ancestor
  // 需從 article 爬 3 hops 到達 `div.swipe-back`），不超過 3 跳。不加上限時
  // 若 heuristic 選錯 anchor（例如 upmedia 國際版 heuristic 誤選 `.row`），
  // promote 會一路往上找到含 h1 的共同 parent、最慘升到 body/#wrapper，
  // 把整頁 chrome 納入主文 scope。v0.7.3 放寬 2→3：對 line today 修標題漏掉；
  // upmedia 的 heuristic 誤選已由 modal signal 排除 + textLen bonus 前置
  // 防止（不再進 promote 路徑），3 hops 仍比到 body/#wrapper 安全。
  const PROMOTE_MAX_HOPS = 3;

  function promoteForTitle(articleEl) {
    const target = getCanonicalTitle();
    if (!target) return articleEl;

    let cur = articleEl;
    let hops = 0;
    while (cur && cur.parentElement && cur !== document.body && hops < PROMOTE_MAX_HOPS) {
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
      hops++;
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
     *
     * Title promote：對所有「非兜底」策略結果（article-tag / schema-org /
     * heuristic）統一呼叫 promoteForTitle。必要場景：某些站點（anthropic
     * engineering blog）有 <article> 但文章 <h1> 放在 article 的兄弟
     * <section> 裡，策略 1 命中 article 後，若不 promote 標題就會被
     * hideAncestorSiblings 當 chrome 清掉。main-tag 是兜底，本身已經是
     * 最外層不需 promote。
     */
    detect() {
      const result = (
        detectByArticleTag() ||
        detectBySchemaOrg() ||
        // 策略 3（OpenGraph）本輪未實作
        detectByHeuristic() ||
        detectByMainTag() ||
        null
      );
      if (result && result.strategy !== 'main-tag') {
        result.el = promoteForTitle(result.el);
      }
      if (result) {
        result.el = narrowToFirstArticleBlock(result.el);
      }
      return result;
    }
  };

  NS.detector = detector;
})();
