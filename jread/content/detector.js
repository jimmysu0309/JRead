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

  // class/id 權重用的 regex（Readability.js 的經典名單，安全子集）
  //
  // 正向：對標 Readability.js 的 POSITIVE_RE，補 `hentry|h-entry`（microformats
  // 標記）+ `blog`（部落格 CMS 類 class `.blog-post` / `#blog-content`）。
  // 刻意不收 Readability 原版的 `page|pagination` —— `#page-wrapper` 是整站
  // wrapper 的常見命名，命中會讓 detector 把 top bar + nav + footer 全當主文；
  // `pagination` 本身在 Readability 的 unlikelyCandidates 也是負面訊號（內部
  // 矛盾，歷史包袱），我們一併略。
  //
  // 負向：對標 Readability.js 的 NEGATIVE_RE，補 `gdpr|outbrain|related|sponsor|
  // shoutbox|widget|skyscraper|combx` —— 都是跨 CMS 廣告 / 相關推薦 / 側欄元件
  // 的慣用命名。刻意不收 `hidden|hid|contact|scroll|shopping|tags|media|meta`
  // —— 這些詞在正文結構裡也常出現（`.article-meta` / `.category-tags` /
  // `.media-object` 這類），命中會讓真主文的 multiplier 被砍半、detector 誤判。
  const POSITIVE_RE = /article|content|body|post|entry|hentry|h-entry|main|story|text|blog/i;
  const NEGATIVE_RE = /comment|sidebar|footer|nav|menu|header|promo|banner|ad[-_]|[-_]ad|combx|disqus|foot|masthead|popup|share|social|gdpr|outbrain|related|sponsor|shoutbox|widget|skyscraper/i;

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
    // v0.8.38：策略期間共用祖先鏈 cache（理由見 withAncestorCache 註解）
    return withAncestorCache(_detectByArticleTagImpl);
  }
  function _detectByArticleTagImpl() {
    const articles = Array.from(document.querySelectorAll('article'));
    if (articles.length === 0) return null;

    // 單一 <article>：直接採用（需過字數門檻）
    if (articles.length === 1) {
      const el = articles[0];
      if (scoredTextLen(el) < MIN_TEXT_LEN) return null;
      // 商業周刊修法（v0.7.43，Jimmy 2026-04-27）：article 不含 H1 且跟 <main> 是
      // sibling（article 不在 main 內、main 含 H1）→ article 是輔助列表（archive
      // 圖列 / 推薦清單），真主文在 main 內。降級到下一策略 schema-org / heuristic
      // / main-tag，配合 promote/ensure 升到 main 含 H1。
      // 安全保證：anthropic 類「article 在 main 內、article 不含 h1、h1 在 main
      // 之 article 兄弟」的場景，article 在 main 內、main.contains(el)=true、
      // 不命中此降級條件、仍走 article-tag 策略。
      if (!el.querySelector('h1')) {
        const main = document.querySelector('main');
        if (main && !main.contains(el) && main.querySelector('h1')) {
          return null;
        }
      }
      return { el, confidence: 0.9, strategy: 'article-tag' };
    }

    // 多個 <article>：通常是列表頁（首頁、部落格首頁、Medium 的 for you 等）
    // 策略：挑最長者；但若前幾篇長度相近，認定為列表頁而降級到策略 4
    //
    // v0.8.45：挑之前先用視口相交過濾。無限捲動站（thenewslens cage 實證）
    // 把「下一篇」preload 成同文件的第二個 <article>，preload 篇比本文長時
    // 「挑最長」會選到使用者根本沒在看的那篇（reader card 開出來是下一篇）。
    // 結構性訊號：使用者觸發閱讀模式的當下，要讀的是「與視口相交」的那篇
    // ——preload 篇在視口外的下方。有相交者只在相交者中挑；全部不相交
    // （極端捲動位置）或 rect 不可用（jsdom / 隱藏候選）→ 退回全集合，
    // 行為與舊版一致。列表頁多篇同時相交，looksLikeListPage 判定不受影響。
    const vh = window.innerHeight || 0;
    const intersecting = vh > 0 ? articles.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.bottom > 0 && r.top < vh;
    }) : [];
    const pool = intersecting.length > 0 ? intersecting : articles;
    const sorted = pool
      .map(el => ({ el, len: scoredTextLen(el) }))
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
    if (scoredTextLen(main) < MIN_TEXT_LEN) return null;
    return { el: main, confidence: 0.75, strategy: 'main-tag' };
  }

  // ---- 策略 5：Shadow DOM fallback（v0.7.86）-----------------------------
  // 場景：MSN.com 類站點用 Web Components（custom elements + open shadow root）
  // 包主文，普通 `document.querySelectorAll` 看不到 shadow 內元素。所有上述
  // 策略全部會落空（h1=0、main=0、article 空殼、無 textLen 大的 wrapper）。
  //
  // 通則處理：detect() 主流程全失敗後，掃所有 open shadow root，找含 most p
  // 的 shadow（主文）+ 含 h1 的 shadow（標題），把 children 深拷貝（cloneNode
  // (true)）到一個 light DOM `<article data-jread-shadow-replica="1">` 替身、
  // 掛到 `<body>` 末尾，回傳此替身。後續 cleaner / styler 對替身操作即可。
  //
  // 副作用 scoped to shadow-DOM 站：lazy-load src 可能未填、影音 event handler
  // 失效、shadow scope CSS 不跟著 clone（樣式可能跑掉，但 styler 會套 reader
  // card 預設樣式）。對既有 light DOM 站零影響——主流程命中時 fallback 不啟動。
  //
  // restore：reader exit 時 styler.restore 後若有 `[data-jread-shadow-replica]`
  // 元素，main.js 流程要連帶移除（避免原站殘留替身）。
  const SHADOW_REPLICA_ATTR = 'data-jread-shadow-replica';
  const SHADOW_FALLBACK_MIN_P = 5;

  function collectAllOpenShadowRoots() {
    const roots = [];
    const visit = (root) => {
      if (!root || !root.querySelectorAll) return;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          roots.push(el.shadowRoot);
          visit(el.shadowRoot);
        }
      }
    };
    visit(document);
    return roots;
  }

  function detectByShadowDomFallback() {
    // 已有替身（同 toggle 重入）：直接回傳，不重複建立
    const existingReplica = document.querySelector(`[${SHADOW_REPLICA_ATTR}="1"]`);
    if (existingReplica) {
      return { el: existingReplica, confidence: 0.5, strategy: 'shadow-dom-fallback' };
    }

    const roots = collectAllOpenShadowRoots();
    if (roots.length === 0) return null;

    // 找含 most p 的 shadow root（主文）
    let mainShadow = null;
    let mainPCount = 0;
    for (const root of roots) {
      const pCount = root.querySelectorAll('p').length;
      if (pCount > mainPCount) {
        mainPCount = pCount;
        mainShadow = root;
      }
    }

    // 主文 shadow 必須有 >= SHADOW_FALLBACK_MIN_P 個 p（避免雜訊 widget shadow）
    if (!mainShadow || mainPCount < SHADOW_FALLBACK_MIN_P) return null;

    // 找對應的 h1 shadow——MSN 類站同頁 render 多篇推薦（多個 VIEWS-HEADER-
    // WC + CP-ARTICLE），不能直接抓「第一個有 h1 的 shadow」（可能是別篇文章
    // 的 h1）。從主文 shadow 的 host element 往上爬，在每層祖先 subtree 內
    // 找最近的「含 h1 的 shadow root（且不是主文 shadow 自己）」——這個就是
    // 跟主文同 article block 的對應 h1。
    let h1Shadow = null;
    if (mainShadow.host) {
      let cur = mainShadow.host.parentElement;
      while (cur && !h1Shadow) {
        for (const el of cur.querySelectorAll('*')) {
          if (el === mainShadow.host) continue;
          if (el.shadowRoot && el.shadowRoot.querySelector('h1')) {
            h1Shadow = el.shadowRoot;
            break;
          }
        }
        cur = cur.parentElement;
      }
    }
    // 若主文 shadow 本身就含 h1，h1Shadow = mainShadow（避免重複 clone）
    if (mainShadow.querySelector('h1')) {
      h1Shadow = mainShadow;
    }

    // 建立 light DOM 替身
    const replica = document.createElement('article');
    replica.setAttribute(SHADOW_REPLICA_ATTR, '1');

    // 先放 h1（若 h1 在另一個 shadow root）
    if (h1Shadow && h1Shadow !== mainShadow) {
      const h1 = h1Shadow.querySelector('h1');
      if (h1) replica.appendChild(h1.cloneNode(true));
    }

    // clone 主文 shadow root 所有 children
    for (const child of mainShadow.children) {
      replica.appendChild(child.cloneNode(true));
    }

    // 掛到 body 末尾，避開原 shadow 結構不動原站
    document.body.appendChild(replica);

    return { el: replica, confidence: 0.5, strategy: 'shadow-dom-fallback' };
  }

  // ---- 策略 2：Schema.org --------------------------------------------
  // 雙層：先看 `[itemtype]`（整個 article 容器），fallback 到 `[itemprop="articleBody"]`
  //（內層 content element）。兩者是 Schema.org microdata 同族語意：
  //   - itemtype：整個 Article/NewsArticle/BlogPosting 容器
  //   - itemprop="articleBody"：該容器內「內文正體」的 property 標記
  //
  // Postlight Parser 的 NYT / CNN / Ars Technica 等大型新聞站 parser 都用
  // `div[itemprop="articleBody"]` / `section[name="articleBody"]` 當主文
  // selector—— 許多站即便沒在容器掛 `itemtype="Article"`，內層仍標了
  // `itemprop="articleBody"`（SEO 慣例、Google 結構化資料爬取依據）。
  //
  // 通則依據：Schema.org 的 itemprop 是 W3C 規範的 microdata property 標記，
  // 跨站通用，非站點特判（硬規則 3）。itemprop 元素的 textLen 通常較緊湊
  // （僅 content 主體、不含 byline / meta），命中即主文。
  function detectBySchemaOrg() {
    // v0.8.38：策略期間共用祖先鏈 cache（理由見 withAncestorCache 註解）
    return withAncestorCache(_detectBySchemaOrgImpl);
  }
  function _detectBySchemaOrgImpl() {
    // Layer A：容器型 itemtype（最精確）
    const typeSelectors = [
      '[itemtype*="NewsArticle" i]',
      '[itemtype*="BlogPosting" i]',
      '[itemtype*="Article" i]'
    ];
    for (const sel of typeSelectors) {
      const candidates = Array.from(document.querySelectorAll(sel));
      // 頁面可能多個（例如相關文章 list 也標 Article），取最長
      const best = candidates
        .map(el => ({ el, len: scoredTextLen(el) }))
        .filter(x => x.len >= MIN_TEXT_LEN)
        .sort((a, b) => b.len - a.len)[0];
      if (best) {
        return { el: best.el, confidence: 0.85, strategy: 'schema-org' };
      }
    }

    // Layer B：itemprop="articleBody" fallback（多家站點未掛 itemtype、
    // 但內層 content element 掛了 itemprop）
    const bodyCandidates = Array.from(document.querySelectorAll('[itemprop="articleBody"]'));
    const bestBody = bodyCandidates
      .map(el => ({ el, len: scoredTextLen(el) }))
      .filter(x => x.len >= MIN_TEXT_LEN)
      .sort((a, b) => b.len - a.len)[0];
    if (bestBody) {
      return { el: bestBody.el, confidence: 0.85, strategy: 'schema-org-body' };
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

  // v0.7.144：祖先鏈狀態 cache。每次 detectByHeuristic 跑時對 500+ signals
  // 逐一沿祖先鏈跑 closest + getComputedStyle，500 signals × 平均 10 層祖先 =
  // 5K 次 getComputedStyle，每次 trigger layout flush。許多 signals 共用同一
  // 條祖先鏈、cache 後 hit 直接回答。
  //
  // Cache 結構：WeakMap<element, boolean> —— 已 confirmed hidden 的祖先標 true、
  // 確認可見的標 false。沿祖先鏈往上時遇到已 cached 的祖先直接 short-circuit。
  // WeakMap 在 detectByHeuristic 內 caller 站清 + 重建（避免 SPA 多 detect run
  // 拿 stale state，但其實 hidden 狀態跨 detect run 改變的機率低）。
  let _excludedAncestorCache = null;

  // v0.8.19 C2：祖先鏈 hidden 共用 predicate——沿 el 自身 + 祖先鏈檢查 inline
  // display:none / computed display:none。原本只內嵌在 isSignalExcluded 給
  // heuristic signal 用，但 article-tag / schema-org / main-tag / 候選容器的
  // textLen 門檻都走 getText(el).length，而 getText 對隱藏元素（innerText 在
  // display:none 下回 ''）fallback 到 textContent → 隱藏容器的全部文字（modal
  // 2700 字）被計入字數、通過 MIN_TEXT_LEN 甚至贏過真主文（upmedia.mg modal
  // 實案）。抽成共用 predicate 後套到所有 textLen 計分（scoredTextLen），隱藏
  // 元素一律計 0。
  // 效能（v0.7.144）：祖先鏈 cache（_excludedAncestorCache，heuristic run 期間
  // 共用）邏輯原樣保留——多 signal 共用同一條祖先鏈時 cache hit 直接
  // short-circuit，省 getComputedStyle layout flush。cache 未開（article-tag /
  // schema-org / main-tag 等 caller）時直接逐次計算、仍正確。
  // 真 Chrome 能 resolve 整條 cascade；jsdom 不 resolve stylesheet 但讀 inline
  // ——fixture 測試走 inline style 即可驗覆蓋面。
  function isAncestorChainHidden(el) {
    const cache = _excludedAncestorCache;
    const visited = [];
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      // cache hit：祖先已被 confirmed hidden / visible
      if (cache && cache.has(p)) {
        const cached = cache.get(p);
        // back-fill：把這次走過的祖先全標相同狀態（傳遞性）
        for (const v of visited) cache.set(v, cached);
        return cached;
      }
      visited.push(p);
      if (p.style && p.style.display === 'none') {
        if (cache) for (const v of visited) cache.set(v, true);
        return true;
      }
      try {
        const cs = window.getComputedStyle && window.getComputedStyle(p);
        if (cs && cs.display === 'none') {
          if (cache) for (const v of visited) cache.set(v, true);
          return true;
        }
      } catch (_) { /* jsdom 等環境部分節點 getComputedStyle 可能拋，忽略 */ }
    }
    // 走完祖先鏈無 hidden：全標 false（傳遞性）
    if (cache) for (const v of visited) cache.set(v, false);
    return false;
  }

  function isSignalExcluded(el) {
    // closest() 會把 el 自身也算進去，所以祖先鏈檢查等同 self + ancestors
    // ARIA UI-chrome（dialog / alertdialog / tooltip / aria-modal / aria-hidden）
    // 是 signal 計分專用的排除；祖先鏈 hidden 走共用 predicate。
    if (el.closest && el.closest(HEURISTIC_SKIP_SEL)) return true;
    return isAncestorChainHidden(el);
  }

  // textLen 計分共用：祖先鏈 hidden 的元素一律計 0，避免 getText 對隱藏節點
  // fallback textContent 灌水通過字數門檻。可見元素照常用 getText——innerText
  // 在真實瀏覽器已排除內部隱藏子樹，jsdom 退回 textContent（fixture 知情）。
  function scoredTextLen(el) {
    return isAncestorChainHidden(el) ? 0 : getText(el).length;
  }

  function seedScore(text) {
    let s = 1;
    // 逗號數（中英文都算）— 長句有逗號 = 內文特徵
    s += (text.match(/[,，、]/g) || []).length;
    // 文字長度 → 每 100 字 +1，上限 3
    s += Math.min(Math.floor(text.length / 100), 3);
    return s;
  }

  // v0.8.38（perf）：祖先鏈 cache 的開關抽成共用 helper。原本只有 heuristic
  // 開 cache，article-tag / schema-org 的 scoredTextLen 裸跑——多 article 排序
  // 與四個 selector 的候選 map 對同一條祖先鏈重複 getComputedStyle（巨頁實測
  // detect 首跑 122ms 的主要成分）。巢狀呼叫（已有外層 cache）沿用、不重建
  // 不提早清。
  function withAncestorCache(fn) {
    if (_excludedAncestorCache) return fn();
    _excludedAncestorCache = new WeakMap();
    try {
      return fn();
    } finally {
      _excludedAncestorCache = null;
    }
  }

  function detectByHeuristic() {
    // v0.7.144：開 cache、整個 heuristic run 期間 isSignalExcluded 共用
    return withAncestorCache(_detectByHeuristicImpl);
  }

  function _detectByHeuristicImpl() {
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

    // 收集所有「過基本門檻」的候選（容器型 tag + textLen > MIN_TEXT_LEN）
    // 後統一計分，改走 top-N 競爭分析取代舊「只挑 top 1」邏輯。
    const candidates = [];

    for (const [el, raw] of scoreMap.entries()) {
      // 限定「容器型」元素（避免 li / p 自己也被選為主文）
      const tag = el.tagName;
      if (tag !== 'DIV' && tag !== 'SECTION' && tag !== 'MAIN' && tag !== 'ARTICLE') continue;

      const textLen = scoredTextLen(el);
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
      const posHit = POSITIVE_RE.test(marker);
      const negHit = NEGATIVE_RE.test(marker);
      if (posHit) score *= 1.25;
      if (negHit) score *= 0.5;

      candidates.push({ el, score, textLen, ld, posHit, negHit });
    }

    if (candidates.length === 0) return null;

    // top-N 競爭分析（Readability.js `nbTopCandidates` 精神）：
    // 只挑 top 1 在「top1 vs top2 分數差距小」的場景很危險——舊 heuristic
    // 的 scoring 有時把主文跟 UI chrome 算得太接近（例：主文 28 分、sidebar
    // 26 分），top 1 可能是 sidebar，而 top 2 才是真主文。
    //
    // 通則：收前 N 名（N=5，與 Readability 一致），比較 top1.score/top2.score。
    // 若比值 >= 1.25：top1 明顯勝出，confidence 照舊線性縮放。
    // 若比值 <  1.25：模糊區——改從 top-5 挑 class weight 最好者（見下方
    //   v0.7.7 修法註解）。注意：v0.7.5 的「confidence ×0.85 打折 → 低於
    //   MIN_CONFIDENCE 回 null → main-tag 兜底」機制已在 v0.7.7 回滾移除，
    //   heuristic 現在**不會**因低信心讓位（clamp 下限 = MIN_CONFIDENCE，
    //   門檻必過）；ambiguous flag 仍回傳給上層當「別硬 promote」訊號。
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, 5);
    const runnerUpScore = top[1] ? top[1].score : 0;
    // 比值界定「模糊區」：top1 不足 top2 的 1.25 倍視為膠著
    const ambiguous = runnerUpScore > 0 && (top[0].score / runnerUpScore) < 1.25;

    // 模糊區 → 優先從 top-5 裡挑「POSITIVE 命中 + NEGATIVE 沒命中」者，
    // 貼近 Readability.js `nbTopCandidates` 精神：top-N 裡 class weight 最好
    // 的勝出。v0.7.5 → v0.7.7 修法：回滾原本 `confidence *= 0.85` 的打折，
    // 改動「選哪個」而非「打折」。打折在 score 10~10.5 邊界會把剛通過
    // 0.30 門檻的 confidence 打到 0.25~0.28，讓整個 detector 回 null。
    // upmedia.mg /tw/focus/comprehensive/256956 實測：真主文 `.news-box-text`
    // score 10.17（POSITIVE 命中）vs wrapper DIV score 10.26（無命中），
    // 新邏輯挑 `.news-box-text` = 主文，舊邏輯 top1 是 wrapper DIV + 打折
    // → 回 null 無法進閱讀模式。
    let chosen = top[0];
    if (ambiguous) {
      const preferred = top.find(c => c.posHit && !c.negHit);
      if (preferred) chosen = preferred;
    }
    const best = chosen.el;
    const bestScore = chosen.score;

    // 分數 → confidence 線性縮放：bubble-up 的典型主文分數在 20–60 範圍。
    // 10 分以下 → 0.30（門檻邊緣），50 分以上 → 0.70（高信心上限）。
    // v0.8.37：移除舊 `if (confidence < MIN_CONFIDENCE) return null;` 死碼——
    // clamp 下限就是 MIN_CONFIDENCE（0.30），條件永 false（v0.7.7 回滾打折
    // 機制後殘留）。heuristic 有任何候選即拍板，低信心降級路徑不存在。
    const raw = (bestScore - 10) / 40 * 0.4 + 0.30;
    const confidence = Math.max(0.30, Math.min(0.70, raw));

    // title promote 由 detect() 統一處理，不在此重複
    return { el: best, confidence, strategy: 'heuristic', ambiguous };
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
    // v0.7.251：折疊 typographic 引號/撇號/刪節號到 ASCII（og:title 常 ASCII、
    // 渲染 h1 常 smart-quote，strict 比對需同折疊）。getCanonicalTitle 折疊後
    // 才切 `–—|` 站名尾綴——foldTitlePunct 刻意不折破折號，split 仍有效。
    return (NS && NS.foldTitlePunct
      ? NS.foldTitlePunct(s)
      : (s || '').replace(/\s+/g, ' ').trim());
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
    // v0.8.37：站名尾綴切法收斂到 NS.stripSiteSuffix（原本全 codebase 6 份
    // 實作、分隔符集合各不相同）。首段過短（< 4）退回整串的 guard 保留。
    if (og.length >= 4) {
      const ogHead = NS.stripSiteSuffix(og);
      return ogHead.length >= 4 ? ogHead : og;
    }
    const t = normalizeTitle(document.title || '');
    const head = NS.stripSiteSuffix(t);
    return head.length >= 4 ? head : t;
  }

  // 卡片連結式標題判別：heading 的祖先含 <a> = 整顆標題被包成可點連結，
  // 屬於推薦 / 相關 / 側欄文章卡（連向其他文章、常重複當前頁標題文字），
  // 不是本文自身的 hero 標題。本文 hero 標題慣例為裸 heading（其內可含
  // 連結，但 heading 本身不會是某個 <a> 的後代）。用 closest('a') 判祖先方向，
  // 不會誤殺「<h1> 內含 <a>」的自連標題（那種 a 是 heading 的後代、非祖先）。
  function isHeadingInsideAnchor(h) {
    return !!(h && h.closest && h.closest('a'));
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
  // v0.7.13 放寬到 5 跳：esmchina.com /news/14116.html 實測 article_text
  // 到共同祖先 container 需 5 hops（article_text > article-words-ar >
  // article-cnt > unnamed div > col-md-9 > container）。
  //
  // 演進紀錄：
  //   v0.7.3 2→3：修 line today 標題漏掉
  //   v0.7.8 嘗試 3→4 修 ebc 後回滾：#main_content sibling chrome 殘留
  //   v0.7.12 3→4 + promote+narrow 聯動：detect() 記錄 promotedFrom、
  //     cleaner narrowPromotedSiblings 沿祖先鏈清 sibling chrome
  //   v0.7.13 4→5：esmchina 需要；narrow 兜底保證 scope 擴大不殘留
  //
  // 配合 ambiguous hopLimit=1 保護（v0.7.2），5 hops 只在 non-ambiguous
  // 高信心場景發生、有 narrow 兜底不會吞 page chrome。
  const PROMOTE_MAX_HOPS = 5;

  // maxHops 可由呼叫端覆寫（例：heuristic ambiguous 時走更嚴 limit，
  // 避免 heuristic 選錯 anchor 時 promote 沿祖先一路升把整頁吞進主文）。
  // 返回 { el, titleHead }：el 是升級後容器（若無命中則原 articleEl），
  // titleHead 是 promote 實際 match 到的 heading element（給 cleaner
  // narrowPromotedSiblings 做白名單保護；不分 h1/h2/h3/h4）。
  //
  // 為何回傳 titleHead：WordPress block theme（Stratechery 實測）post-title
  // 是 <h2>（class `wp-block-post-title` 預設是 h2、h1 是站名）。narrow 的
  // sibling guard 之前只寫 `sib.tagName === 'H1'` + `querySelector('h1')`，
  // 對 h2 的 post-title 漏防、整塊主標題被當 sibling chrome 連帶 hide
  // （2026-04-24 Jimmy 回報、v0.7.12 引入 narrow 機制時留的坑）。修法改為
  // 讓 cleaner 拿到 promote 實際命中的那個 heading、精準白名單保護——不
  // 放寬成「所有 H2」避免 sidebar 每個 article card 的 H2 都被當主標題。
  // title head tag 白名單：
  //   heading：h1-h4 無 text 長度限制（傳統 semantic title 慣例）
  //   非 heading（p / div / span）：v0.7.22 newtalk.tw 修法——少數新聞站
  //     不用 heading tag 包標題（newtalk 用 `<p class="name">` 在 `div.title`
  //     裡；聯合新聞、中時等早期 CMS 也見過用 div/span），擴展 tag 白名單
  //     但加 text 長度上限（TITLE_TEXT_MAX），避免把含標題字樣的內文段落
  //     或長區塊誤認成 title。titleMatches 本身已是嚴格字串比對，配長度
  //     上限雙重保護。
  const TITLE_TAG_SEL = 'h1, h2, h3, h4, p, div, span';
  const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4']);
  const TITLE_TEXT_MAX = 120;  // og:title 典型 20-50 字（中）或 60-120 字（英）

  // 找 a 與 b 的 lowest common ancestor（jread fallback promote 用）
  function findLCA(a, b) {
    if (!a || !b) return null;
    const ancestors = new Set();
    for (let cur = a; cur; cur = cur.parentElement) ancestors.add(cur);
    for (let cur = b; cur; cur = cur.parentElement) {
      if (ancestors.has(cur)) return cur;
    }
    return null;
  }

  // 最終保護（v0.7.42 商周修法）：detect() 結尾條件呼叫。
  // 不管 detector 走哪條策略（含 main-tag 兜底，promoteForTitle 不會被觸發）
  // 或 promoteForTitle 為何 silently 失敗（實機跟 jsdom 行為差異），都做最後一道
  // 結構性保護——若 promoteForTitle 沒升過（promotedTitleHead 未設），找全頁 H1
  // 與 articleEl 求 LCA、距離 ≤ 5 hops 就升到 LCA。不依賴文字比對。
  //
  // Guard 用 promotedTitleHead 而非「articleEl 含任何 heading」：
  // - Stratechery articleEl=wp-block-column 含 h2 post-title（promoteForTitle 已升、
  //   promotedTitleHead 設） → skip 不再升、避免誤升到 wp-site-blocks
  // - 商周 articleEl=row 含 h2 sub-heading（promoteForTitle 失敗、promotedTitleHead
  //   未設）→ 跑兜底升到 MAIN.Single（H1.Single-title-main 的 LCA）
  // 兩個都 articleEl 內含 h2，但 promote 是否成功才是真正的決定因素。
  // v0.7.143：共用 LCA helper（原本 ensureArticleContainsTitleH1 與 promoteForTitle
  // 的 LCA fallback 兩處各有一份重複實作；CLAUDE.md 工作流原則 5「單一資料源」要求
  // 合一）。
  //
  // 通用語意：算 articleEl 與 candidate heading h 的最近共同祖先 LCA，安全 guard：
  // (1) LCA 不可為 body / html（避免吞整頁）；(2) LCA 必須真的 contains articleEl
  // （trivial）；(3) maxDist：articleEl 沿 parent 鏈到 LCA 步數上限（避免遠距 LCA
  // 把不相關 chrome 一起吃進來）。傳 maxDist=Infinity 跳過此 guard。
  function findTitleViaLca(articleEl, h, maxDist) {
    if (!articleEl || !h) return null;
    const lca = findLCA(articleEl, h);
    if (!lca) return null;
    if (lca === document.body || lca === document.documentElement) return null;
    if (!lca.contains(articleEl)) return null;
    if (typeof maxDist === 'number' && Number.isFinite(maxDist)) {
      let dist = 0;
      let cur = articleEl;
      while (cur && cur !== lca && dist <= maxDist) { cur = cur.parentElement; dist++; }
      if (cur !== lca) return null;
    }
    return { el: lca, titleHead: h };
  }

  // v0.8.12 ChinaTalk translate-first 修法：articleEl 是否「自帶標題」。
  //
  // 結構訊號（純 DOM 位置、與文字無關 → 翻譯擴充把標題換成中文也不失效）：
  // articleEl 內 DOM-order 第一個 heading（h1-h4）若出現在第一個 substantial
  // <p>（內文段落）之前，代表 article 開頭就是自己的標題區（post-header），
  // 文章自帶 hero——不需要向外層借 H1。
  //
  // 動機：chinatalk.media 長文經 Shinkansen translate-first 後，article 內含
  // post-title H1 +多個 section H1（header-anchor-post），既有「article 內恰 1
  // 個 H1」guard（line 703）不觸發；article 內 H1 全變中文、og:title 維持英文
  // → line 684-698 文字比對 guard 也失效 → path 1 把頁面 DOM-first H1（站名
  // masthead「ChinaTalk」logo H1）當 hero 升 LCA 到 div#main，把留言區
  // (#discussion) + 推薦列表 (portable-archive-list) 整塊括進主文 → 清不掉。
  //
  // 區分 wya（wheresyoured.at）案例：wya article 開頭是內文 <p>（hero 在
  // articleEl 兄弟層 .post-hero、article 不自帶標題），第一個 heading 是 section
  // header、在內文之後 → self-titled=false → path 1 照常升 LCA 取 hero。
  function articleIsSelfTitled(articleEl) {
    if (!articleEl || !articleEl.ownerDocument) return false;
    const walker = articleEl.ownerDocument.createTreeWalker(articleEl, NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = walker.nextNode())) {
      const tag = n.tagName;
      if (/^H[1-4]$/.test(tag)) return true;                      // heading 先出現 → 自帶標題
      if (tag === 'P' && getText(n).length > 80) return false;    // 內文先出現 → 不自帶標題
    }
    return false;
  }

  // articleEl 內「自帶的 og-match 標題 heading」查找（共用 helper）。
  // 規則：h1-h4、不被 <a> 包住（排除推薦 / 側欄文章卡的重複標題）、文字
  // titleMatches og:title / docTitle。命中回傳該 heading、否則 null。
  //
  // v0.8.42 抽出動機：這條「articleEl 已含標題 → 不需升級」的事實原本只在
  // ensureArticleContainsTitleH1 有 guard，promoteForTitle 沒有——兩條 path
  // 處理同一份事實但不對稱。foreignaffairs 實證：ARTICLE.article 自含 H1
  // hero，但 sticky 導覽列有 SPAN.site-nav__current-article 顯示「目前文章
  // 標題」（跨站慣例：閱讀進度列 / sticky header 常複寫當前標題），
  // promoteForTitle sibling-walk 在 hop 1 命中該 span → articleEl 被升到
  // 接近整頁的 wrapper，MAIN 內 ARTICLE 的兄弟（related / most-read section
  // 數千 px）全部括進主文，文章尾巴整串推薦雜訊清不掉。
  function findSelfTitleHead(articleEl, target) {
    if (!articleEl || !target || !articleEl.querySelectorAll) return null;
    for (const h of articleEl.querySelectorAll('h1, h2, h3, h4')) {
      if (isHeadingInsideAnchor(h)) continue;
      const text = normalizeTitle(h.innerText || h.textContent || '');
      if (text.length > TITLE_TEXT_MAX) continue;
      if (titleMatches(target, text)) return h;
    }
    return null;
  }

  function ensureArticleContainsTitleH1(articleEl, promotedTitleHead) {
    if (!articleEl) return null;
    // promote 已升 + 命中的是真 heading（H1-H4）→ 視為堅實 promote、不需再升。
    // 商周 v0.7.44 實測：detect 時序變動下 heuristic 命中 DIV.Single-article →
    // promote sibling-walk 把 articleEl 升到 SECTION.row 但 promotedTitleHead=DIV
    // （某個含主標題文字的 div 包覆，TITLE_TAG_SEL 含 div/span 寬鬆命中），
    // articleEl 仍不含真 <h1>。此時要繼續跑 LCA 升 main 含真 H1。
    // Stratechery wp-block-column promotedTitleHead=H2 post-title（堅實）→ skip ✓。
    if (promotedTitleHead && /^H[1-4]$/.test(promotedTitleHead.tagName)) return null;

    // 本層走 maxDist=5（避免 articleEl 與 LCA 距離太遠把 site chrome 吞進）。
    const tryLcaPromote = (h) => findTitleViaLca(articleEl, h, 5);

    // v0.7.92 wya 修法（含 ChinaTalk 防回歸）：
    //
    // 動機：wheresyoured.at 用 `<h1>` 做小節 heading（一頁 12 個 H1）、真 hero H1
    // 在 articleEl 兄弟層 `.post-hero`；翻譯擴充（Shinkansen / 沉浸式翻譯）single
    // (replace) 模式把 H1 textContent 換成中文後 promoteForTitle 的 titleMatches
    // (og:title, h1.textContent) 失敗、不升 → articleEl 留在 ARTICLE.post 不含
    // hero → 舊 ensureArticleContainsTitleH1 邏輯「articleEl 含任何 H1 就 skip」
    // 過早收手 → cleaner 把 .post-hero 砍 → hero H1 不見。
    //
    // 修法用結構訊號「DOM-order 第一個 H1」(hero 慣例在頁面開頭) 不依賴文字比對，
    // 但有 ChinaTalk Substack 類站點的 logo H1 假信號風險（site title H1 慣例
    // 在頁面開頭但不是 post hero）。
    //
    // 觸發前 guard：articleEl 內若已含「跟 og:title / docTitle match 的 heading
    // (h1/h2/h3/h4)」→ 視為 articleEl 已有 hero、不需升。
    // 利用 og:title (meta 標籤) 不被翻譯擴充改動的穩定性——ChinaTalk articleEl
    // 含 H1.post-title「Media Diet Q1 2026」matches og:title 同字 → skip ✓。
    // wya 翻譯後 articleEl 內 12 個中文 H1 沒一個 match 英文 og:title → 走升 ✓。
    // 跳過「被 <a> 包住」的 heading 的理由（findSelfTitleHead 內建）：卡片連結
    // 式標題（推薦 / 相關 / 側欄文章卡）慣例整顆 heading 包在 <a> 裡連向該文，
    // 常重複當前頁標題文字（shoppingdesign 側欄推薦卡 <a><h2>本文標題</h2></a>
    // 實證）。本文自身的 hero 標題幾乎不會整顆被 <a> 包成可點卡片——以此排除
    // 假標題訊號，避免 articleEl 內的側欄重複標題誤判「scope 已含標題」而放棄升級。
    const target = getCanonicalTitle();
    if (target && findSelfTitleHead(articleEl, target)) return null;

    // 翻譯擴充（Shinkansen / 沉浸式翻譯）把 H1 text 換成中文後 og:title
    // 比對失敗，但若 articleEl 內恰有 1 個 H1，結構上幾乎確定就是文章
    // 標題——不需升。wya 案例 12 H1 = section heading 不受影響。
    if (articleEl.querySelectorAll('h1').length === 1) return null;

    // 路徑 1：頁面 DOM-order 第一個 H1 不在 articleEl 內 → 升 LCA。
    // self-titled guard：article 開頭已是自己的標題區時，頁面 DOM-first H1 是
    // 站名 masthead logo（非 post hero），升上去會把留言/推薦括進主文。
    const firstH1 = document.querySelector('h1');
    if (firstH1 && !articleEl.contains(firstH1) && !articleIsSelfTitled(articleEl)) {
      const r = tryLcaPromote(firstH1);
      if (r) return r;
    }

    // 路徑 2（原邏輯）：articleEl 完全不含 H1 → 遍歷所有 H1 找 valid LCA。
    // 商周 case（articleEl=SECTION.row 不含 H1，H1.Single-title 在兄弟層）兜底。
    if (!articleEl.querySelector('h1')) {
      for (const h of document.querySelectorAll('h1')) {
        const r = tryLcaPromote(h);
        if (r) return r;
      }
    }
    return null;
  }

  function promoteForTitle(articleEl, maxHops) {
    const target = getCanonicalTitle();
    if (!target) return { el: articleEl, titleHead: null };

    // self-titled guard（v0.8.42）：articleEl 已自含 og-match 的 hero heading
    // → promote 的存在理由（把 article 外的標題括進 scope）不成立，直接收手。
    // 不加這條時，頁面上任何「複寫當前文章標題的 site chrome」（sticky 導覽列
    // 的閱讀進度標題、breadcrumb 末節、aside 的本文卡）都可能讓 sibling-walk
    // 誤升——foreignaffairs SPAN.site-nav__current-article 實證把 articleEl
    // 升到近整頁 wrapper、文章尾巴推薦雜訊全進主文。回傳命中的 heading 當
    // titleHead（語意同「promote 已有堅實標題」，呼叫端只在 el 變動時使用）。
    const selfHead = findSelfTitleHead(articleEl, target);
    if (selfHead) return { el: articleEl, titleHead: selfHead };

    const limit = typeof maxHops === 'number' ? maxHops : PROMOTE_MAX_HOPS;

    let cur = articleEl;
    let hops = 0;
    while (cur && cur.parentElement && cur !== document.body && hops < limit) {
      const parent = cur.parentElement;
      // v0.8.36 body/html guard：articleEl 是 body 直接子（shadow replica 正是
      // document.body.appendChild、必定命中此形狀）時第一圈 parent 就是 body
      // ——任一 body-level sibling 子樹含 og:title 相符文字就會把 articleEl
      // 升級成整個 <body>、styler 套全頁。LCA 路徑有同款 guard（lca ===
      // document.body reject），sibling-walk 漏了——同一條「不可吞整頁」事實
      // 兩 path 必須對稱。
      if (parent === document.body || parent === document.documentElement) break;
      for (const sib of parent.children) {
        if (sib === cur) continue;
        // heads 同時包含 sib 自己（若 match）+ 所有子孫。不能只二選一
        // ——當 sib 是 `<div class="news_info">` 這類 wrapper（match p/div/span
        // 白名單），舊邏輯「sib match → 只看 sib 自己」會吃下整塊 wrapper
        // textContent，長度超過 TITLE_TEXT_MAX 被 skip，錯過內部真 title node。
        const heads = [];
        if (sib.matches && sib.matches(TITLE_TAG_SEL)) heads.push(sib);
        if (sib.querySelectorAll) heads.push(...sib.querySelectorAll(TITLE_TAG_SEL));
        for (const h of heads) {
          // 跳過卡片連結式標題（推薦 / 相關 / 側欄文章卡 <a> 包住的標題）——
          // 否則側欄重複標題會讓 promote 停在「含主文 + 側欄」的共同祖先、
          // 把真 hero 標題與 hero 圖排除在 scope 外（shoppingdesign 實證）。
          if (isHeadingInsideAnchor(h)) continue;
          const text = normalizeTitle(h.innerText || h.textContent || '');
          // 非 heading tag 加 120 char 上限：防止含標題字串的正文段落（例：
          // 「根據 og:title，...」這類引用）或整塊 wrapper textContent 被當
          // titleHead。heading tag 維持原行為（無上限），避免某些站長標題被擋。
          if (!HEADING_TAGS.has(h.tagName) && text.length > TITLE_TEXT_MAX) continue;
          if (titleMatches(target, text)) {
            // 升級到 articleEl 與 h 的共同 parent = 當前 parent
            return { el: parent, titleHead: h };
          }
        }
      }
      cur = parent;
      hops++;
    }

    // LCA fallback：sibling-walk 沒命中、掃全頁 h1/h2 找 og-match、跟 articleEl
    // 求 LCA、若 LCA 在 body 之內就升到 LCA。動機：商業周刊 blog 路由實測——
    // detector heuristic 命中 SECTION.row.no-gutters（含 hero + 段落、文字密
    // 度極高），sibling-walk 演算法跑 row → parent=MAIN.Single → main 的
    // sibling 含 SECTION.Single-title 內 H1，理論上應該命中、但 Jimmy 實機
    // Chrome 與 Playwright Chromium 之間 detect 結果不一致（probe 顯示
    // articleEl=main、實機 articleEl=row）。LCA fallback 對「articleEl 不含
    // 主標題」的所有變體場景都能補洞，不依賴 sibling-walk 哪一層命中。
    // 安全 guard：(1) H1/H2 必須 og-match；(2) LCA 不能升到 body / html
    // （太外層、會吞 site chrome）；(3) LCA 必須包含 articleEl（trivial）。
    // ---- LCA fallback layer 1：og-match LCA ----
    // sibling-walk 沒命中（hops 限制 / 嵌套太深）但 og-match 還能成立的場景。
    // 比 layer 2 安全（依賴 og-match guard），優先嘗試。
    //
    // v0.7.143：走共用 findTitleViaLca helper（dist 無上限——og-match guard 已是
    // 強訊號，dist 過遠也仍是真標題、不需 dist 限制）。
    for (const h of document.querySelectorAll('h1, h2')) {
      if (articleEl.contains(h)) continue;
      if (isHeadingInsideAnchor(h)) continue;
      const text = normalizeTitle(h.innerText || h.textContent || '');
      if (text.length > TITLE_TEXT_MAX) continue;
      if (!titleMatches(target, text)) continue;
      const r = findTitleViaLca(articleEl, h, Infinity);
      if (r) return r;
    }

    // structural guard layer 移到 detect() 結尾的 ensureArticleContainsTitleH1
    // ——同邏輯但繞開 strategy === 'main-tag' 條件、所有路徑都會跑到。
    return { el: articleEl, titleHead: null };
  }

  // ---- 主函式 ---------------------------------------------------------
  const detector = {
    /**
     * v0.7.143：輕量探測，只回 siteMode，不 mutate DOM。
     *
     * 動機（v0.7.143 audit #5）：popup GET_READER_STATE 開啟時呼 detect() 拿
     * siteMode 三選一 flag，但 detect() 會跑 promote / narrow / ensureH1 + 走到
     * detectByShadowDomFallback **會 `document.body.appendChild(replica)` 注入
     * shadow DOM 替身**。光是打開 popup 就在頁面注入 article replica = 副作用。
     *
     * probe() 跳過 promote / narrow / shadow replica appendChild，只跑 article-tag
     * / schema-org / heuristic / main-tag 四個 read-only 策略決定 siteMode。
     * heuristic 仍跑——避免純啟發式偵測站（沒 <article> tag 的新聞站）popup 拿不到
     * 'article' siteMode → Readwise 按鈕誤判隱藏。
     *
     * 回傳 { siteMode } — 'youtube-cinema' / 'x-thread' / 'article' / null。
     */
    probe() {
      if (NS.cinema && typeof NS.cinema.isYouTubeWatch === 'function' && NS.cinema.isYouTubeWatch()) {
        return { siteMode: 'youtube-cinema' };
      }
      if (NS.xThread && typeof NS.xThread.isXStatusPage === 'function' && NS.xThread.isXStatusPage()) {
        return { siteMode: 'x-thread' };
      }
      if (NS.fbPost && typeof NS.fbPost.isFacebookPost === 'function' && NS.fbPost.isFacebookPost()) {
        return { siteMode: 'fb-post' };
      }
      // 跑 4 個 read-only 策略；故意不走 detectByShadowDomFallback（會 appendChild
      // 替身、有副作用），shadow DOM 站走 enter reader mode 時才建替身。
      const result = (
        detectByArticleTag() ||
        detectBySchemaOrg() ||
        detectByHeuristic() ||
        detectByMainTag()
      );
      if (result && result.el) return { siteMode: 'article' };
      return { siteMode: null };
    },

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
      // v0.7.133：YouTube watch page 走 cinema mode（不偵測主文、改釘 player 中央
      // 黑底鋪滿）。短路在最前面：YouTube watch page 沒主文可分析，下面任何
      // strategy 跑下去都是 no-op + 浪費效能。回傳特殊 result，main.js 看
      // isYouTubeCinema flag 走 NS.cinema.enter() 而非 cleaner/styler。
      if (NS.cinema && typeof NS.cinema.isYouTubeWatch === 'function' && NS.cinema.isYouTubeWatch()) {
        return {
          el: null,
          confidence: 1,
          strategy: 'youtube-cinema',
          isYouTubeCinema: true
        };
      }
      // v0.7.135：X / Twitter status 頁短路。timeline 結構（cellInnerDiv 平鋪）
      // 沒單一 <article> 容器可選，既有 strategy 會把主推文 + reply 視為列表頁
      // 降級 no-op。改由 NS.xThread.enter() 合成 reader 容器（main.js 走獨立
      // enterXThreadMode 分支建容器、再對容器跑既有 cleaner / styler 流程）。
      if (NS.xThread && typeof NS.xThread.isXStatusPage === 'function' && NS.xThread.isXStatusPage()) {
        return {
          el: null,
          confidence: 1,
          strategy: 'x-thread',
          isXThread: true
        };
      }
      // v0.7.157：Facebook permalink 短路。permalink post（/<user>/posts/pfbid*
      // 等）沒 article/main/schema 也沒 <p> signal，detector 四層全 null。改由
      // NS.fbPost.enter() 合成 reader 容器（main.js 走獨立 enterFbPostMode 分支
      // 建容器、再對容器跑既有 cleaner / styler 流程）。
      if (NS.fbPost && typeof NS.fbPost.isFacebookPost === 'function' && NS.fbPost.isFacebookPost()) {
        return {
          el: null,
          confidence: 1,
          strategy: 'fb-post',
          isFbPost: true
        };
      }
      const result = (
        detectByArticleTag() ||
        detectBySchemaOrg() ||
        // 策略 3（OpenGraph）本輪未實作
        detectByHeuristic() ||
        detectByMainTag() ||
        detectByShadowDomFallback() ||
        null
      );
      if (result && result.strategy !== 'main-tag') {
        // heuristic 在 top-N 競爭膠著時（top1/top2 < 1.25 倍）傳回
        // ambiguous=true；promote 收緊 hops 上限到 1，避免 top1 是誤選 anchor
        // 時一路升到 body/#wrapper 吞整頁。非 ambiguous 走預設 5 hops
        // （line today 類多層 styled-component wrapper、ebc 類深層 single-
        // child wrapper 需要的上限，配 narrowPromotedSiblings 兜底）。
        const hopLimit = result.ambiguous ? 1 : undefined;
        const originalEl = result.el;
        const promoted = promoteForTitle(result.el, hopLimit);
        result.el = promoted.el;
        // 若 promote 真的升級、紀錄升級前 el 給 cleaner narrowPromotedSiblings
        // 用來「只保留 content 分支 + title heading 分支」、hide 其他 sibling chrome。
        if (result.el !== originalEl) {
          result.promotedFrom = originalEl;
          // promoted.titleHead = promote 實際命中的 heading（h1/h2/h3/h4 任一）
          // 傳給 cleaner 做 sibling guard 的白名單；不分 tagName 精準保留該
          // heading 及含該 heading 的 sibling（Stratechery 的 h2 post-title 會
          // 落在這個 guard 裡、不再被 narrow 連帶 hide）。
          result.promotedTitleHead = promoted.titleHead;
        }
      }
      if (result) {
        result.el = narrowToFirstArticleBlock(result.el);
      }
      // 最終保護：無條件再做一次「articleEl 必須含 H1」的結構性升級。
      // 動機：商業周刊 blog 路由實測（Jimmy 2026-04-27）reload v0.7.41 後 console
      // 證實 og.text === h1.text、LCA(article, h1)=MAIN.Single、distance=1、layer 2
      // 邏輯應升 — 但 articleEl 仍是 SECTION.row。代表 promoteForTitle 整段被某個
      // path 跳過或 silently 失敗。把 LCA 結構性 guard 抽到 detect() 結尾無條件
      // 跑一次，繞開所有 strategy / ambiguous / 流程條件分支。
      if (result && result.el) {
        const finalPromoted = ensureArticleContainsTitleH1(result.el, result.promotedTitleHead);
        if (finalPromoted) {
          if (!result.promotedFrom) result.promotedFrom = result.el;
          result.el = finalPromoted.el;
          result.promotedTitleHead = finalPromoted.titleHead;
        }
      }
      return result;
    }
  };

  // v0.7.87：把「articleEl 內等同 og:title / docTitle 的 text 元素」標 promoted
  // -title attribute，讓 styler 套大字體標題樣式。通則：站若把標題寫在非
  // h1-h4 tag（newtalk `<p class="name">` / 其他站可能用 `<div class="title">`
  // / `<span class="post-title">` 等），styler 不會自動視覺突顯，需此 promote。
  function markPromotedTitleIfMissing(articleEl) {
    if (!articleEl || !articleEl.querySelectorAll) return;

    // 取 og:title / docTitle 作為比對基準
    function normalizeTitle(s) {
      // v0.7.251：先去 `[...]` site prefix，再折疊 typographic 標點（見上方
      // 同名函式註解）——markPromotedTitleIfMissing 同樣比對 og:title vs
      // 可見 text element，smart-quote 不折疊會漏 match。
      const stripped = (s || '').replace(/\[.*?\]/g, '');
      return (NS && NS.foldTitlePunct
        ? NS.foldTitlePunct(stripped)
        : stripped.replace(/\s+/g, ' ').trim());
    }
    const og = document.querySelector('meta[property="og:title"]')?.content || '';
    const docT = document.title || '';
    // v0.8.48：og:title 也必須過 stripSiteSuffix——Wikipedia 類站點 og:title
    // 含站名尾綴（「珍珠奶茶 - 維基百科，自由的百科全書」），未去尾綴時
    // baseTitle 整串含站名 → bestCand 掃描命中「站台標語」元素（#siteSub）
    // → 注入錯誤 H1「維基百科，自由的百科全書」、真標題降級成小字（第五輪
    // page rounds B1）。去尾綴後最壞情況是 baseTitle 變短導致不注入（no-op
    // 降級），不會再注入錯誤標題。
    const baseTitle = normalizeTitle(NS.stripSiteSuffix(og)) || normalizeTitle(NS.stripSiteSuffix(docT));
    if (!baseTitle || baseTitle.length < 5) return;

    // 文字是否等同 baseTitle（精確或雙向 60% 包含）
    function matchesBaseTitle(t) {
      if (!t || t.length < 5) return false;
      if (t === baseTitle) return true;
      if (t.includes(baseTitle) && baseTitle.length >= t.length * 0.6) return true;
      if (baseTitle.includes(t) && t.length >= baseTitle.length * 0.6) return true;
      return false;
    }

    // v0.8.3：guard 只在「可見 h1-h4 文字等同 baseTitle」時才放棄注入——代表
    // 真標題已以 heading 呈現。舊邏輯「articleEl 內有任何 non-hidden h1-h4 就
    // return」會被 cleaner 漏網的雜訊 heading 誤觸（roomie.tw 實證：footer
    // 「現在就追蹤 Roomie IG」H3 未被 cleaner hide → 舊 guard 誤判已有標題 →
    // 真標題（sr-only H1 + 非 heading span.title）從不注入 → Chrome 整個沒標題、
    // iOS 退回站方 23px 小 span）。雜訊 heading 不等同 og:title，不再讓它壓掉注入。
    // jsdom 環境 rect=0 無法用 rect 判 visible；用「不在 cleaner hide 樹內」當
    // visible proxy（與 v0.7.87 同款）。翻譯擴充把 h1 換成中文時不 match 英文
    // og:title，guard 不 bail、bestCand 搜尋同樣 miss → no-op，不產重複標題。
    const headings = articleEl.querySelectorAll('h1, h2, h3, h4');
    for (const h of headings) {
      if (h.closest && h.closest('[data-jread-hidden="1"]')) continue;
      if (isHeadingInsideAnchor(h)) continue; // 卡片連結式重複標題不算數
      const text = normalizeTitle(h.innerText || h.textContent || '');
      if (text.length > TITLE_TEXT_MAX) continue;
      if (matchesBaseTitle(text)) return; // 真標題已以可見 heading 呈現
    }

    // 找 articleEl 內含等同 baseTitle 的 text element（精確或包含關係）
    // 限制 textLen 接近 baseTitle，避免命中包含主文整段的大 wrapper
    let bestCand = null;
    let bestScore = 0;
    for (const el of articleEl.querySelectorAll('p, div, span, h5, h6')) {
      const t = normalizeTitle(el.textContent || '');
      if (t.length < 10 || t.length > baseTitle.length * 1.5) continue;
      // 包含 baseTitle 60%+ 字元
      let overlap = 0;
      if (t === baseTitle) overlap = 1.0;
      else if (t.includes(baseTitle)) overlap = 0.9;
      else if (baseTitle.includes(t)) overlap = 0.85;
      if (overlap < 0.85) continue;
      // 偏好 text-only 元素（沒巢狀子元素過多 → 確保是純標題、非 wrapper）
      const childTagCount = el.querySelectorAll('*').length;
      const score = overlap - childTagCount * 0.05;
      if (score > bestScore) {
        bestScore = score;
        bestCand = el;
      }
    }

    if (bestCand) {
      // v0.7.88：改用「inject 新 H1 在 articleEl 開頭 + hide 原元素」路線。
      // 原本的「移動原元素 + 加 attribute / style」對 newtalk.tw 失效——原
      // 元素移到 articleEl first child 後仍跟原 sibling IMG 重疊（IMG 因
      // 父層 CSS quirk 浮到 articleEl 之外的負 y 位置覆蓋頂部）。
      // inject 新 H1 是獨立 DOM 節點，flow 不受原元素 sibling 影響；原元素
      // 設 data-jread-hidden + display:none 避免重複文字。
      const injected = document.createElement('h1');
      injected.setAttribute('data-jread-injected-title', '1');
      injected.textContent = normalizeTitle(bestCand.textContent);
      // inject 新 H1 自身 inline 大字 style（保險，不依賴 styler base CSS）
      // background: inherit + padding：原站 IMG 因 layout quirk 浮到 article
      // 之外覆蓋第一屏（newtalk.tw 實測 IMG rect_y=31 vs article rect_y=40），
      // 透明 inject H1 仍被視覺覆蓋。inherit 繼承 articleEl 的 articleBg、
      // padding 給標題視覺呼吸 + 不透明 box 把後方所有覆蓋元素遮住。
      // z-index: 10 + position: relative 雙保險浮在最上層。
      if (injected.style && typeof injected.style.setProperty === 'function') {
        injected.style.setProperty('font-size', '2em', 'important');
        injected.style.setProperty('font-weight', '700', 'important');
        injected.style.setProperty('line-height', '1.3', 'important');
        injected.style.setProperty('display', 'block', 'important');
        injected.style.setProperty('margin-top', '0', 'important');
        injected.style.setProperty('margin-bottom', '0.6em', 'important');
        injected.style.setProperty('padding', '8px 0', 'important');
        injected.style.setProperty('background', 'inherit', 'important');
        injected.style.setProperty('position', 'relative', 'important');
        injected.style.setProperty('z-index', '10', 'important');
      }
      articleEl.insertBefore(injected, articleEl.firstChild);
      // hide 原元素，避免標題重複出現
      bestCand.setAttribute('data-jread-promoted-title-source', '1');
      if (bestCand.style && typeof bestCand.style.setProperty === 'function') {
        bestCand.style.setProperty('display', 'none', 'important');
      }
      // backward-compat：保留 data-jread-promoted-title attribute 在原元素，
      // 既有 spec 仍找得到（fixture 標題比對等）。
      bestCand.setAttribute('data-jread-promoted-title', '1');

      // v0.8.3：去重——把 articleEl 內其餘「等同 baseTitle 的 leaf 標題載體」
      // 一併 hide，避免 responsive 站把標題做成「desktop / mobile 雙份 span」時
      // inject 後仍殘留另一份可見標題（roomie.tw 實證：mobile-info > span.title
      // 在窄視窗顯示、bestCand 卻挑到 breadcrumb span，iOS 上 inject H1 + mobile
      // span 變成兩個標題）。只清 leaf-ish（後代 element ≤ 2）且文字長度近 baseTitle
      // 的節點——不碰含主文/meta 的大 wrapper，也不碰 inject H1 自己。
      for (const el of articleEl.querySelectorAll('h1, h2, h3, h4, h5, h6, p, div, span')) {
        if (el === bestCand) continue;
        if (el.hasAttribute('data-jread-injected-title')) continue;
        // 已被 cleaner hide 的不必再碰（不可見、且避免與 cleaner.restore 互踩）
        if (el.closest && el.closest('[data-jread-hidden="1"]')) continue;
        if (el.querySelectorAll('*').length > 2) continue;
        const t = normalizeTitle(el.textContent || '');
        if (t.length > baseTitle.length * 1.5) continue;
        if (!matchesBaseTitle(t)) continue;
        el.setAttribute('data-jread-promoted-title-source', '1');
        if (el.style && typeof el.style.setProperty === 'function') {
          el.style.setProperty('display', 'none', 'important');
        }
      }
    }
  }


  NS.detector = detector;
  // v0.7.87：暴露 markPromotedTitleIfMissing 給 main.js 在 cleaner 跑完後 call
  // （cleaner 已 hide chrome 內的 hidden h1-h4 後，articleEl 內若仍無 visible
  // heading，才 promote 主標）。在 detect() 結尾呼叫時序錯誤——cleaner 還沒
  // 跑、被 hide 的 heading 仍視為 visible，guard 誤觸不 promote。
  NS.detector.markPromotedTitleIfMissing = markPromotedTitleIfMissing;
})();
