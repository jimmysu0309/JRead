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
    const articles = Array.from(document.querySelectorAll('article'));
    if (articles.length === 0) return null;

    // 單一 <article>：直接採用（需過字數門檻）
    if (articles.length === 1) {
      const el = articles[0];
      if (getText(el).length < MIN_TEXT_LEN) return null;
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
        .map(el => ({ el, len: getText(el).length }))
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
      .map(el => ({ el, len: getText(el).length }))
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

    // 收集所有「過基本門檻」的候選（容器型 tag + textLen > MIN_TEXT_LEN）
    // 後統一計分，改走 top-N 競爭分析取代舊「只挑 top 1」邏輯。
    const candidates = [];

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
    // 若比值 <  1.25：模糊區，confidence 打折（×0.85），讓下游 detect() 知道
    //   此 heuristic 結果不穩，必要時降到 MIN_CONFIDENCE 以下回傳 null、
    //   改走 detectByMainTag 兜底。不直接選 top2——top1 仍是高分者，只是
    //   告訴上層「這個 pick 的確定性不高、別硬 promote」。
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
    // 10 分以下 → 0.30（門檻邊緣），50 分以上 → 0.70（高信心上限）
    const raw = (bestScore - 10) / 40 * 0.4 + 0.30;
    const confidence = Math.max(0.30, Math.min(0.70, raw));

    if (confidence < MIN_CONFIDENCE) return null;

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
  function ensureArticleContainsTitleH1(articleEl, promotedTitleHead) {
    if (!articleEl) return null;
    // promote 已升 + 命中的是真 heading（H1-H4）→ 視為堅實 promote、不需再升。
    // 商周 v0.7.44 實測：detect 時序變動下 heuristic 命中 DIV.Single-article →
    // promote sibling-walk 把 articleEl 升到 SECTION.row 但 promotedTitleHead=DIV
    // （某個含主標題文字的 div 包覆，TITLE_TAG_SEL 含 div/span 寬鬆命中），
    // articleEl 仍不含真 <h1>。此時要繼續跑 LCA 升 main 含真 H1。
    // Stratechery wp-block-column promotedTitleHead=H2 post-title（堅實）→ skip ✓。
    if (promotedTitleHead && /^H[1-4]$/.test(promotedTitleHead.tagName)) return null;
    // articleEl 已含真 <h1> → 不需升（雙保險）
    if (articleEl.querySelector('h1')) return null;
    for (const h of document.querySelectorAll('h1')) {
      const lca = findLCA(articleEl, h);
      if (!lca) continue;
      if (lca === document.body || lca === document.documentElement) continue;
      if (!lca.contains(articleEl)) continue;
      let dist = 0;
      let cur = articleEl;
      while (cur && cur !== lca && dist <= 5) { cur = cur.parentElement; dist++; }
      if (cur !== lca) continue;
      return { el: lca, titleHead: h };
    }
    return null;
  }

  function promoteForTitle(articleEl, maxHops) {
    const target = getCanonicalTitle();
    if (!target) return { el: articleEl, titleHead: null };
    const limit = typeof maxHops === 'number' ? maxHops : PROMOTE_MAX_HOPS;

    let cur = articleEl;
    let hops = 0;
    while (cur && cur.parentElement && cur !== document.body && hops < limit) {
      const parent = cur.parentElement;
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
    for (const h of document.querySelectorAll('h1, h2')) {
      if (articleEl.contains(h)) continue;
      const text = normalizeTitle(h.innerText || h.textContent || '');
      if (text.length > TITLE_TEXT_MAX) continue;
      if (!titleMatches(target, text)) continue;
      const lca = findLCA(articleEl, h);
      if (!lca) continue;
      if (lca === document.body || lca === document.documentElement) continue;
      if (!lca.contains(articleEl)) continue;
      return { el: lca, titleHead: h };
    }

    // structural guard layer 移到 detect() 結尾的 ensureArticleContainsTitleH1
    // ——同邏輯但繞開 strategy === 'main-tag' 條件、所有路徑都會跑到。
    return { el: articleEl, titleHead: null };
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

  NS.detector = detector;
})();
