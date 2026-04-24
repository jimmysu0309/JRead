// JRead — 雜訊隱藏
// 規則來源：SPEC.md「雜訊隱藏規則」章節。
// 所有規則皆為 DOM / CSS 結構特徵通則，不綁站點 hostname 或特定 class。
// 站點特判一律放 site-overrides/，不得混入此檔。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  // ---- Keyword 名單（主文內雜訊 heuristic） -----------------------------
  // 邊界檢查：class/id 通常是 kebab-case 或 snake_case，用非字母數字作邊界，
  // 避免 sharepoint / headset 這類誤殺。
  // 跨 CMS 命名慣例的雜訊 class/id keyword 名單。每組為語意 family：
  //   paywall / subscribe / newsletter / signup：訂閱 / 付費牆
  //   promo / promotion / advertisement / sponsor(ed) / cta / call-to-action：廣告 / 贊助
  //     - sponsored（形容詞，覆蓋 sponsored-content 類）+ sponsor（動詞詞根，
  //       覆蓋 udn `.sponsor-ads` / `.sponsor-links` 類——實測）
  //   related-(articles|news|posts|stories)：相關閱讀 section family
  //   more-(news|stories|posts|articles)：「延伸閱讀」section family（udn
  //     `section.more-news` 實測，跨聯合 / 中時 / 各種新聞 CMS 的慣例命名）
  //   recommend(ed) / read-more：推薦 / 更多（popIn / dable / Taboola widget 命名）
  //   taboola：Taboola 第三方推薦 widget 的 id / class 前綴
  //     （`taboola-below-article-thumbnails` 等跨站 embed 命名）
  //   share / social：分享按鈕
  //   comment(s) / discuss(ion) / disqus：留言 / 討論（udn `.discuss-board`
  //     實測——`discussion` 名詞不 match `discuss-board`；加 `discuss` 動詞
  //     詞根覆蓋 board / form 類 CMS module）
  // alternation 順序不影響：regex 會依 boundary `(^|[^a-z0-9])...([^a-z0-9]|$)`
  // 逐一 try。動詞詞根不會誤殺既有的形容詞 `recommended` / `sponsored` /
  // `discussion`——後者各自有自己的 alternation 先行。
  const NOISE_KEYWORD_RE = /(^|[^a-z0-9])(paywall|subscribe|subscription|newsletter|signup|sign-up|signin|sign-in|login|register|promo|promotion|promote|advertisement|sponsored|sponsor|donation|donate|call-to-action|cta|callout|related-(?:articles|news|posts|stories)|more-(?:news|stories|posts|articles)|recommended|recommend|recommendation|read-more|read-next|up-next|taboola|trc_[a-z_]+|outbrain|zergnet|revcontent|popin|share|social|social-(?:bar|links|icons|share|media)|comment|comments|comment-form|discussion|discuss|disqus|livefyre|hyvor|breadcrumb|breadcrumbs|audio-player|audio-widget|controls|partner|postlisting|post-listing|thread|threads|reposted|repost|follow|follow-us|following|cookie-(?:banner|notice|consent|bar|message)|gdpr|consent|privacy-(?:banner|notice)|newsletter-(?:signup|form|cta)|email-(?:signup|capture|subscribe)|pagination|page-nav|pager|page-navigation|author-(?:bio|card|info|box|meta|widget)|about-(?:author|the-author)|popup|overlay|modal-(?:content|dialog|box|wrapper)|floating-(?:bar|cta|widget)|sticky-(?:bar|cta|banner|subscribe)|toast|snackbar|notification-(?:bar|banner)|marker)([^a-z0-9]|$)/i;
  // ad- / -ad 邊界特例（不可直接放進上面 alternation，否則 2 字母太短會大量誤殺）
  const AD_BOUNDARY_RE = /(^|[-_\s])ad([-_\s]|$)/i;

  // 永不隱藏的保留元素 selector（即使命中 keyword 也跳過，避免 Unclutter 把 <summary> 外移的坑）
  const PRESERVE_SEL = 'summary, figure, figcaption, blockquote';

  // Heading 文字 heuristic：跨站點文末列表 / 推薦 / 延伸閱讀 section 的 h2/h3
  // 標題字樣命名極固定（中文新聞站、部落格、Medium 中文化等通用）。SPA
  // 框架站點（LINE Today / Next.js emotion-style hash class）的 class 全無
  // 語意命名、NOISE_KEYWORD_RE 無法命中，只能靠 heading content 匹配。
  // 字詞 family：
  //   延伸閱讀 / 相關新聞 / 相關文章 / 相關報導 / 推薦閱讀 / 推薦文章
  //   熱門新聞 / 熱門文章 / 最新消息 / 最新新聞
  //   更多相關 / 更多...文章 / 更多...新聞 / 查看更多 / 看更多
  //   其他人也看 / 你可能也喜歡 / 也許您(會|也會)(感興趣|喜歡)
  // 為避免誤殺主文的正當副標題（例如「案情分析」「後續發展」），要求：
  //   - heading text 長度 <= 20 chars（推薦 section 標題通常短）
  //   - 命中的是 h2 / h3 / h4（h5/h6 罕用為推薦 section heading）
  // 命中後 hide「heading 所在、articleEl 之下的 direct child 容器」——通常
  // 是 section wrapper，整塊清掉。
  const NOISE_HEADING_TEXT_RE = /(延伸閱讀|相關新聞|相關文章|相關報導|推薦閱讀|推薦文章|最新消息|最新新聞|更多相關|更多.{0,4}(文章|新聞|報導)|看更多|查看更多|其他人也看|你可能(也)?(喜歡|感興趣)|也許您?(會|也會)?(感興趣|喜歡)|網友貼文.{0,4}AI|AI.{0,4}(摘要|總結|整理|生成)|.{0,6}AI摘要|繼續看下去|^貼文(\s*\(\d+\))?$|^(熱門|最新)$|^(related|recommended|popular|trending|latest|featured)(\s+\S+){0,3}$|^top\s+stories?$|^more\s+(from|stories|articles|news|posts|like\s+this)(\s+\S+){0,3}$|^you\s+(may|might)\s+(also\s+)?(like|enjoy|be\s+interested)|^read\s+(more|next|also)|^up\s+next$|^continue\s+reading|^see\s+also|^further\s+reading|editor['’]?s\s+picks?|^sponsored\s+(content|stories|posts)|^comments?(\s*\(\d+\))?$|^discussion(\s*\(\d+\))?$|^responses?(\s*\(\d+\))?$|^replies(\s*\(\d+\))?$|^newsletter$|^subscribe$|^follow\s+us|^join\s+us|^sign\s+up$|^support\s+us|^(hot|new|top)$|AI\s+(summary|digest|overview|takeaways?))/i;
  const NOISE_HEADING_MAX_LEN = 20;

  // 主文內「CTA / 外連 / 訂閱推廣」連結 text heuristic：LINE Today / 新聞聚合
  // 站在文末常塞「查看原始文章」（連回發布站）、主文中段塞「點開加入…LINE
  // 官方帳號」（訂閱推廣）—— class 都是 emotion-style hash / 跨 SPA 命名，
  // keyword / heading rule 都攔不到。走 `<a>` text 跨站通用慣用語匹配 hide。
  // 字詞 family：
  //   查看原始文章 / 看原文 / 回到原文 / 閱讀原文 / 原文連結
  //   加入.{0,10}(LINE|官方帳號|好友|粉絲專頁)
  //   (LINE|官方帳號).{0,10}(加入|訂閱)
  //   訂閱(我們|本報|電子報)
  // 命中後 hide 的目標：a → 若 parent 是 p/div 且只含這個 a（或 a 的文字占
  // parent text 80%+）則 hide parent，否則 hide a 本身。避免把含有少量 a
  // 的 legit p 誤殺。
  const NOISE_LINK_TEXT_RE = /(查看原始文章|看原文|回到原文|閱讀原文|原文連結|原始文章|加入.{0,10}(LINE|官方帳號|好友|粉絲專頁)|(LINE|官方帳號).{0,10}(加入|訂閱)|訂閱.{0,4}(電子報|本報|我們|粉絲團)|^(訂閱|已訂閱|追蹤|已追蹤|關注|已關注|訂閱中|追蹤中|建立貼文|發佈貼文|發表貼文|轉發|轉貼|留言|分享|收藏|更多選項|檢舉|舉報|回覆|讚|喜歡|已讚)$|^轉發\s*\(\d+\)$|^貼文\s*\(\d+\)$|^(view\s+(original|source)|read\s+(the\s+)?(original|full\s+article|more|next|on\s+\w+)|back\s+to\s+(top|article|original)|visit\s+(original|source|site)|show\s+(more|less)|load\s+more|see\s+more|learn\s+more|get\s+(started|the\s+app)|download\s+(the\s+)?app|open\s+(in\s+)?app|subscribe|subscribed|follow|following|unfollow|like|liked|dislike|share|repost|retweet|reply|comment|save|saved|bookmark|bookmarked|report|flag|join|joined|sign\s+(in|up|out)|log\s+(in|out)|register|create\s+(an\s+)?account|new\s+post|post|reblog|upvote|downvote|clap|applaud)(\s*\(\d+\))?$|join\s+(our\s+)?(newsletter|mailing\s+list|community|telegram|discord|slack|line|whatsapp)|follow\s+(us\s+)?on\s+(twitter|x|facebook|instagram|tiktok|youtube|linkedin|threads|line|google\s+news)|subscribe\s+(to\s+)?(our\s+)?(newsletter|channel|podcast|feed|email)|(\d+\s+)?(min(ute)?s?|hour?s?|day?s?|week?s?|month?s?|year?s?)\s+ago)/i;
  const NOISE_LINK_TEXT_MAX_LEN = 60;

  // 主文中段「廣告插播」inline 文字 heuristic：自由時報 / 聯合 / ETtoday 等
  // 台灣新聞站在主文段落中段插播「廣告（請繼續閱讀本文）」類 placeholder
  // 文字——單獨 span 內文、無可識別 class。keyword / heading rule 都攔不到，
  // 走 inline text 匹配：
  //   廣告 / AD / 業配 + 各種變體括號 + 「請繼續 / 接下來 / 以下內容」等
  //   續文指示字樣
  const NOISE_INLINE_AD_TEXT_RE = /^(廣告|AD|業配|促銷|贊助|廣編|advertisement|sponsored|promotion|advertorial)\s*[（(:：\-]\s*.{0,40}?(請繼續|繼續|接下來|以下內容|下方|continue|please|below|article\s+continues|story\s+continues|more\s+below)/i;
  const NOISE_INLINE_AD_MAX_LEN = 40;

  // 主文內 keyword heuristic 只作用於「容器型」元素。
  // 理由：真實世界的廣告/paywall/subscribe 區塊都是容器包裝，
  // 不會是單一 <h1-6> / <p> / <img> / <a>。
  // Wikipedia 曾出現 h4 id="_ad_blocking" / h3 id="Market_share" 這類
  // 內容標題被 keyword 誤殺，限定容器型元素可解此問題。
  const CONTAINER_SEL = 'div, section, aside, iframe, form, nav, header, footer';

  // Fixed/sticky 結構判斷門檻
  const TOP_BAR_WIDTH_RATIO = 0.8;   // 寬度 ≥ viewport 80% 視為 top bar
  const TOP_BAR_MAX_HEIGHT = 100;    // 高度 < 100px
  const SIDE_TOOL_MAX_WIDTH = 100;   // 寬度 < 100px 視為側邊浮動工具列
  const SIDE_TOOL_MIN_HEIGHT = 200;  // 高度 > 200px

  // 社群分享 cluster 門檻：同 parent 下 3+ 個社群連結
  const SHARE_CLUSTER_MIN = 3;
  const SHARE_LINK_SEL = [
    'a[href*="twitter.com"]',
    'a[href*="x.com"]',
    'a[href*="facebook.com"]',
    'a[href*="linkedin.com"]',
    'a[href*="line.me"]',
    'a[href*="weibo.com"]',
    'a[href*="reddit.com"]',
    'a[href*="pinterest.com"]',
    'a[href*="t.me"]',
    'a[href*="wa.me"]'
  ].join(', ');

  // ---- 工具 -------------------------------------------------------------
  function markerOf(el) {
    // el.className 在 SVG 是 SVGAnimatedString，不是 string；用 classList 保險
    const classList = Array.from(el.classList || []).join(' ');
    const id = el.id || '';
    return (classList + ' ' + id).toLowerCase();
  }

  function shouldHideByKeyword(el) {
    const m = markerOf(el);
    if (!m.trim()) return false;
    return NOISE_KEYWORD_RE.test(m) || AD_BOUNDARY_RE.test(m);
  }

  // whitespace-normalize：jsdom textContent 保留 HTML 縮排 `\n    `，真實
  // Chrome innerText 會 collapse——兩端統一 collapse `\s+` → 單一空格並 trim，
  // 讓 fixture 與真實站點量到同一個 textLen。sidebar / button-cluster 規則共用。
  function norm(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function isInPreserved(el) {
    return !!(el.closest && el.closest(PRESERVE_SEL));
  }

  function isRelated(articleEl, el) {
    // el 在主文內 / 是主文 / 是主文祖先 → 不能動
    return el === articleEl || articleEl.contains(el) || el.contains(articleEl);
  }

  // ---- style snapshot / restore helper ----------------------------------
  // cleaner 內多條 rule 需要改 inline style 後 restore（collapse grid/flex /
  // innerGridFlex / media placeholder）。每個 prop 都要記 value + priority 才能
  // round-trip 還原原站的 `!important` 寫法——若原站 inline 有 `!important`、
  // 我們 remove 後忘了加回 priority，reader mode 退出後等於移除了站點自己的
  // priority 宣告。把 snapshot / apply / restore 的三步驟抽成共用 helper，避免
  // 每個規則重複寫 `prevXxx` + `prevXxxPriority` boilerplate。
  function snapshotStyles(el, propNames) {
    const prev = {};
    if (!el || !el.style) return prev;
    for (const name of propNames) {
      const value = el.style.getPropertyValue ? el.style.getPropertyValue(name) : '';
      const priority = (el.style.getPropertyPriority && el.style.getPropertyPriority(name)) || '';
      prev[name] = { value, priority };
    }
    return prev;
  }

  // apply: 對一批 prop 以 !important 寫 inline style。declarations 為 {name: value}
  // 格式；priority 固定 'important'（cleaner 的 layout 類 rule 都需贏過原站
  // stylesheet `!important`——見硬教訓十）。
  function applyImportant(el, declarations) {
    if (!el || !el.style) return;
    for (const [name, value] of Object.entries(declarations)) {
      el.style.setProperty(name, value, 'important');
    }
  }

  function restoreStyles(el, prev) {
    if (!el || !el.style || !prev) return;
    for (const [name, entry] of Object.entries(prev)) {
      el.style.removeProperty(name);
      if (entry && entry.value) {
        el.style.setProperty(name, entry.value, entry.priority || '');
      }
    }
  }

  function hide(el, hidden) {
    if (!el || el.nodeType !== 1) return;
    if (el.dataset && el.dataset.jreadHidden === '1') return; // 已處理過
    const prevDisplay = el.style.display;
    const prevDisplayPriority = (el.style.getPropertyPriority &&
      el.style.getPropertyPriority('display')) || '';
    hidden.push({ el, prevDisplay, prevDisplayPriority });
    if (el.dataset) el.dataset.jreadHidden = '1';
    // inline `!important` —— 勝過任何 stylesheet rule（包括原站自己的
    // `display: flex !important`）。原本 `el.style.display = 'none'`（inline
    // 無 priority）在 stylesheet !important 戰中會輸 — udn LINE 分享按鈕
    // 的 `aside.article-content__social` 原站規則 specificity 高於 jread
    // 的 `[data-jread-hidden="1"] { display: none !important }`，戰勝後
    // 按鈕重新顯示。改用 inline !important 後就完全贏過任何 stylesheet。
    el.style.setProperty('display', 'none', 'important');
  }

  // ---- 任何位置：ARIA UI-chrome roles ------------------------------------
  // 結構性通則：W3C ARIA 定義的 UI chrome 語意標記，依規範**絕不會**出現在
  // 正文流程裡——凡帶此語意都是對話框/彈窗/懸停提示等 UI chrome 雜訊。
  //   - role="dialog" / "alertdialog" / aria-modal="true"：訂閱彈窗、登入
  //     提示、cookie 同意、付費牆 overlay。Substack 的 .subscribeDialog 就是
  //     嵌在 <article> 內部的 role="dialog"，傳統 fixed/ancestor-sibling 漏掉。
  //   - role="tooltip"：ARIA 規範語意為「懸停/聚焦時顯示的輔助說明」，純
  //     UI chrome、非正文。Medium 的「Member-only story」付費徽章就包在
  //     `<div role="tooltip">` 裡，外觀是 inline-flex 雙 border 徽章——
  //     在 reader mode 下屬於不提供閱讀價值的訂閱提示，hide 之。若有站點
  //     把正文縮寫/術語說明包在 role=tooltip（ARIA 允許但少見），閱讀模式
  //     下損失僅輔助說明、主文仍完整，可接受。
  const DIALOG_SEL =
    '[role="dialog"], [role="alertdialog"], [role="tooltip"], [aria-modal="true"]';

  function hideDialogs(articleEl, hidden) {
    const dialogs = document.querySelectorAll(DIALOG_SEL);
    for (const el of dialogs) {
      if (el === articleEl) continue;
      if (el.contains(articleEl)) continue; // 不砍到主文祖先
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      hide(el, hidden);
    }
  }

  // ---- 主文內：<hr> 分隔線 ------------------------------------------------
  // 結構特徵（非站點特判）：HTML5 `<hr>` 是「thematic break」——站點常用於
  // post-header 與內文之間的分隔線、或正文節段分隔。reader mode 卡片式
  // 排版下段落 margin 已提供足夠分節視覺，殘留 hr 通常造成多餘橫線
  // （Medium 類實測：post-meta（作者/日期）下方接 1-2 條 hr 再接首圖，
  // 在 reader mode 版面看起來就是「照片上方多出橫線」artifact）。
  //
  // 通則：hide 主文內的所有 `<hr>`。正文作者刻意插入的節段分隔也一併清
  // ——reader mode 本就重排版面、卡片 margin 取代分隔線的視覺功能，
  // 損失極小。已驗證 baseline fixture（businessweekly / stratechery /
  // chinatalk / anthropic / ltn / engadget / dwarkesh / bbc 等）無一含 hr，
  // 零 regression 風險。
  function hideInsideArticleHorizontalRules(articleEl, hidden) {
    for (const el of articleEl.querySelectorAll('hr')) {
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      hide(el, hidden);
    }
  }

  // ---- 主文外：語意標籤 --------------------------------------------------
  function hideOutsideArticleSemantic(articleEl, hidden) {
    const els = document.querySelectorAll('header, nav, footer, aside');
    for (const el of els) {
      if (isRelated(articleEl, el)) continue;
      hide(el, hidden);
    }
  }

  // ---- 主文外：fixed / sticky 元素 --------------------------------------
  function hideFixedOutsideArticle(articleEl, hidden) {
    const all = document.body ? document.body.querySelectorAll('*') : [];
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    for (const el of all) {
      if (isRelated(articleEl, el)) continue;
      const cs = window.getComputedStyle(el);
      const pos = cs.position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;

      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // 隱形元素（display:none 不會跑到這，但保險）

      const isTopBar = r.width >= vw * TOP_BAR_WIDTH_RATIO && r.height < TOP_BAR_MAX_HEIGHT;
      const isSideTool = r.width < SIDE_TOOL_MAX_WIDTH && r.height > SIDE_TOOL_MIN_HEIGHT;
      const isBottomPopup = r.top > vh / 2;

      if (isTopBar || isSideTool || isBottomPopup) {
        hide(el, hidden);
      }
    }
  }

  // ---- 主文外/內：社群分享 cluster --------------------------------------
  function hideSocialShareClusters(articleEl, hidden) {
    const anchors = document.querySelectorAll(SHARE_LINK_SEL);
    const parentCount = new Map();
    for (const a of anchors) {
      const p = a.parentElement;
      if (!p) continue;
      parentCount.set(p, (parentCount.get(p) || 0) + 1);
    }
    for (const [p, count] of parentCount) {
      if (count < SHARE_CLUSTER_MIN) continue;
      if (isInPreserved(p)) continue;
      if (p.contains(articleEl)) continue; // 不砍到主文祖先
      hide(p, hidden);
    }
  }

  // ---- 主文外：祖先兄弟（lift article out） ------------------------------
  // 通則：從主文容器沿 parent 鏈往 body 走，每一層把「當前元素的兄弟」
  // 全部隱藏（style/script 等無視覺元素、保留元素、已隱藏者除外）。
  // 效果等同於把主文從複雜的 layout 容器中「拔出來」，解決以下 pattern：
  //   - Medium / Substack 的上方 brand header（非 <header>、非 fixed、
  //     class 不含 keyword，舊規則都漏掉）
  //   - 文章外的相關閱讀 rail、推薦文章、作者卡片
  //   - 版心左右的空白占位容器
  // 前提是 detector 有信心分數門檻，選錯主文的風險可控。
  const STRUCTURAL_TAGS = new Set(['style', 'script', 'link', 'noscript', 'meta', 'title']);

  function hideAncestorSiblings(articleEl, hidden) {
    let cur = articleEl;
    while (cur && cur.parentElement && cur !== document.body) {
      const parent = cur.parentElement;
      for (const sib of parent.children) {
        if (sib === cur) continue;
        if (STRUCTURAL_TAGS.has(sib.tagName.toLowerCase())) continue;
        if (sib.dataset && sib.dataset.jreadHidden === '1') continue;
        if (isInPreserved(sib)) continue;
        hide(sib, hidden);
      }
      cur = parent;
    }
  }

  // ---- promote+narrow 聯動：sibling chrome 全清 ------------------------
  //
  // 場景：detector heuristic 選到深層 content container（例：ebc 的
  // `article_content`，DOM 4-5 層深），promoteForTitle 爬多 hops 升到含
  // h1 的共同祖先（例：`#main_content`）。從 promotedFrom 沿祖先鏈到
  // articleEl 的每一層、除 content 分支外的 sibling 都是 page-level
  // chrome（ebc: 相關新聞 article_relevant、聽新聞 article_controls、
  // 更多 link、article_cover 圖片 overlay、share_box 分享列 etc.），
  // 都不該留在 scope 內。
  //
  // 演算法（與 `hideAncestorSiblings` 方向相反——那條從 articleEl 往 body
  // 走、這條從 promotedFrom 往 articleEl 走）：
  //   cur = promotedFrom
  //   while cur !== articleEl:
  //     parent = cur.parentElement
  //     for sib of parent.children:
  //       if sib === cur: 保留 (content 分支)
  //       if sib 含 h1: 保留 (h1 分支)
  //       else: hide
  //     cur = parent
  //
  // 不動深層後代（各 rule 由 hideInsideArticle* 處理）。isInPreserved
  // 保護仍生效（figure/figcaption/blockquote/summary 內部不動）。
  function narrowPromotedSiblings(articleEl, promotedFrom, hidden, promotedTitleHead) {
    if (!articleEl || !promotedFrom) return;
    if (!articleEl.contains || !articleEl.contains(promotedFrom)) return;
    let cur = promotedFrom;
    // 最多走 10 hops，防萬一 DOM 詭異
    for (let hops = 0; hops < 10 && cur && cur !== articleEl; hops++) {
      const parent = cur.parentElement;
      if (!parent) break;
      for (const sib of parent.children) {
        if (sib === cur) continue;
        if (sib.contains && sib.contains(promotedFrom)) continue;  // content 分支
        // promoted title heading 分支（v0.7.21 Stratechery 修法）：detector
        // promote 實際命中的那個 heading，可能是 h1/h2/h3/h4 任一 tag；
        // 精準白名單保護，不放寬成「所有 H2」避免 sidebar card 的 H2 被誤保。
        if (promotedTitleHead) {
          if (sib === promotedTitleHead) continue;
          if (sib.contains && sib.contains(promotedTitleHead)) continue;
        }
        // 回落 h1 分支（v0.7.14 udn 修法）：沒 promotedTitleHead 資訊時
        // 仍保留「sibling 自己是 H1 或含 h1 後代」作為 fallback——某些站點
        // 走策略 1（article-tag）時沒 promote、但 article 內可能已含 h1。
        if (sib.tagName === 'H1') continue;
        if (sib.querySelector && sib.querySelector('h1')) continue;
        // 媒體分支（v0.7.22 newtalk.tw 修法）：sibling 含 `<img>` / `<picture>` /
        // `<video>` 視為主文媒體分支保留（跨 CMS 慣例：hero image / 內嵌多媒體
        // 跟文字內容常在兄弟 div 不同層，舊站沒把主圖包進 figure 時尤其如此）。
        // 若該 sibling 其實是廣告／chrome／推薦縮圖（含 img 但也含 noise keyword），
        // 後續 hideInsideArticleByKeyword / hideInsideArticleThirdPartyAds 會補抓；
        // 反之錯殺主圖沒辦法回收。通則依據非站點特判——凡是 narrow scope 內含視
        // 覺媒體的 sibling，保留比砍安全（figure 走 isInPreserved、這條補非 figure
        // 情境）。
        if (sib.querySelector && sib.querySelector('img, picture, video')) continue;
        if (sib.dataset && sib.dataset.jreadHidden === '1') continue;
        if (isInPreserved(sib)) continue;
        hide(sib, hidden);
      }
      if (parent === articleEl) break;
      cur = parent;
    }
  }

  // ---- 主文內：action toolbar（拍手/回應/收藏/分享等互動列）----------------
  // 結構特徵：容器本身無 <p> 直接子、自身文字短、含多個按鈕/圖示元素。
  // Medium / Substack / 部分新聞站的 post footer 互動列都命中此 pattern。
  // 為何限制「自身文字短」：避免誤殺正當的 CTA 卡片（有較長說明文字）。
  // 為何不含 <p> 直接子：避免誤殺內文段落容器。
  const ACTION_TEXT_MAX = 80;
  const ACTION_MIN_ICONS = 2;

  function hideInsideArticleActionRows(articleEl, hidden, containers) {
    containers = containers || articleEl.querySelectorAll(CONTAINER_SEL);
    for (const el of containers) {
      if (el === articleEl) continue;
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      // iframe / video / audio 本身是媒體內容，不是互動列——即使 cross-origin
      // iframe 讀不到 textContent 與內部 DOM，也絕對不能當 action-row 候選。
      if (el.tagName === 'IFRAME' || el.tagName === 'VIDEO' || el.tagName === 'AUDIO') continue;

      // 排除：含圖片/影片/嵌入內容的容器（是內容容器，不是互動列）
      // 理由：Substack 的 captioned-image-container 含 <img> + 2 個以上
      // 的 zoom / loading svg，會誤觸 iconCount 門檻被隱藏
      if (el.querySelector('img, picture, video, audio')) continue;

      // 排除：含 heading 直接子（h1-h6）的容器
      // 理由：action row 本質上是圖示互動列，絕不會包含文章 heading。
      // ChinaTalk/Substack 的 div.post-header 包 <h1 post-title> + 作者/
      // 日期 meta + like/comment/share/more buttons——特徵剛好命中 action
      // -row 條件（無 p、無媒體、短文字、多 icon），若不排除 heading 就
      // 會砍掉整個標題區塊（quantum-101 實測觸發）。
      const hasHeadingChild = Array.from(el.children).some(c => /^H[1-6]$/.test(c.tagName));
      if (hasHeadingChild) continue;

      const hasParagraphChild = Array.from(el.children).some(c => c.tagName === 'P');
      if (hasParagraphChild) continue;

      // 排除：直接子中「互動元素」（button / [role=button] / svg）比例 < 50%
      // 的容器。理由：action row 本質是多個互動元素排成一列。若直接子主要
      // 是 sub-container（div），代表這是「內容 wrapper」不是 row。
      // ChinaTalk 作者列外層：直接子是 2 個 DIV（meta group + button group），
      // 0% 互動比例——若不排除會整塊 hide、把作者/日期一起藏掉；加此排除後
      // 外層不 hide，內層 button group（直接子多為 button）仍會被正確命中
      // 單獨 hide，作者/日期保留。
      //
      // Shell short-circuit（v0.6.7）：若自身 textContent < 20 chars，仍視為
      // 空殼 action-bar、不跳過。理由：Medium 把 clap / comment / bookmark /
      // more 各包一層 div，外層 action-bar direct children 全是 0% interactive
      // 的 wrapper，但 textContent 幾乎空（純 icon、clap count 可能 0 / 未
      // 登入不顯示）；這類「border-top + border-bottom 的空殼」在閱讀模式下
      // 遺留兩條橫線夾圖示的 artifact（2026-04-21 ddsakura medium 實測）。
      // 差異點：ChinaTalk byline wrapper 含 author+date 文字 ~30 chars ≥ 20，
      // 走原排除保留不動；Medium outer shell textContent 短，放行走後續 hide
      // 邏輯（iconCount、textLen 等仍會把關）。
      const directChildren = Array.from(el.children);
      if (directChildren.length > 0) {
        const interactiveCount = directChildren.filter(c =>
          c.tagName === 'BUTTON' || c.tagName === 'SVG' ||
          (c.getAttribute && c.getAttribute('role') === 'button')
        ).length;
        if (interactiveCount / directChildren.length < 0.5) {
          const selfText = (el.textContent || '').trim();
          if (selfText.length >= 20) continue;
          // 文字極短：shell short-circuit，繼續走後面 iconCount/textLen 檢查
        }
      }

      const text = (el.textContent || '').trim();
      if (text.length > ACTION_TEXT_MAX) continue;

      const iconCount =
        el.querySelectorAll('button').length +
        el.querySelectorAll('[role="button"]').length +
        el.querySelectorAll('svg').length;
      if (iconCount < ACTION_MIN_ICONS) continue;

      hide(el, hidden);
    }
  }

  // ---- 主文內：button cluster（byline 區塊裡的 Share/Save/Add-as-preferred）
  // 結構特徵（非站點特判）：container 自身短文字（≤ 80 chars）+ 遞迴含 ≥ 2 個
  // `<button>` 或 `a[role="button"]` + 不含任何 p/h1-h6/媒體元素。專門對付
  // 現代 CSS-in-JS（styled-components、BBC kKqaMX/cSUzvu 類）把 button 用
  // `display: contents` 層層包 div 的 pattern——
  //   <div class="cSUzvu"> (textLen 35)
  //     <div class="dkgDie" display:contents>  ← 每個 direct child 都是 div
  //       <div><a><button>Share</button></a></div>
  //     </div>
  //     <div class="dkgDie" display:contents>
  //       <div><a><button>Save</button></a></div>
  //     </div>
  //     <div class="dkgDie" display:contents>
  //       <div><a><button>Add as preferred on Google</button></a></div>
  //     </div>
  //   </div>
  //
  // 現有 `hideInsideArticleActionRows` 對此失靈：direct children 全是 div
  // → interactive ratio = 0% → 觸發排除條件 1「ratio < 50% 且 selfText ≥ 20」
  // → continue 跳過。那個排除條件是用來保護 ChinaTalk byline+actions wrapper
  // 不被整塊誤殺（v0.6.2 baseline）——不能放寬。所以用獨立規則遞迴找 button
  // 數量，補 action-row 規則的盲點。
  //
  // 保護設計（避免誤殺 byline row 本身或 post-header）：
  // - 自身 textLen ≤ 80：BBC cSUzvu 僅 35（Share/Save/Add），jXywqM 整個
  //   byline row 96（含作者+日期）→ 不命中，只動按鈕 cluster 這層。
  //   ChinaTalk byline+actions wrapper 含作者+日期+meta 遠 > 80 → 不命中
  // - 排除含 `<p>` / h1-h6：post-header 含 `<h1>` 必跳過（同 action-row）
  // - 排除含媒體：figure / picture / video / iframe 跳過
  // - 排除主文祖先（contains articleEl）：不砍到卡片層
  //
  // 為何最小 button 數 = 2：單一 button（例如 toggle 按鈕）可能是合法 CTA，
  // 多個才是 cluster 特徵。
  //
  // 為何再加「interactive 外文字 < 10」保護：
  // ChinaTalk byline-actions-wrapper fixture 實測：
  //   <div.meta-group><a>Jordan Schneider</a><span>Apr 21, 2026</span></div>
  //   <div.btn-group><button>like</button><span>41</span><button>comment</button>...</div>
  // textLen 只有 ~31（< 80）、button >= 3（>= 2）、無 p/h/媒體 → 上列 3 條件
  // 全中！會整塊砍掉作者+日期（v0.6.2 baseline 保護面）。差別在 ChinaTalk
  // 的 meta-group 把作者/日期文字放在 interactive **之外**（span 日期），
  // BBC cSUzvu 的所有文字全部在 `<button>` 或 `<a>` **裡面**。
  //
  // Interactive 定義（v0.6.19 擴展）：button + [role=button] + a[href]。
  // a[href] 也算是因為 Engadget 類站點把 "Add Engadget on Google" 做成
  // 純 `<a href="google.com/preferences">` 沒 button tag、沒 role=button——
  // 視覺上是按鈕但 DOM 是 link，舊定義（只含 button / role=button）漏算。
  // 擴展後 Engadget cluster 3 direct children 的全部文字都在 interactive
  // 裡（Add link + 2 button），outsideText = 0 → 命中。ChinaTalk meta-group
  // 只有 1 個 a[href]（作者）——buttonCount < 2 跳過保留；byline-actions-
  // wrapper 外層有 a[href]+button 共 4 個 interactive（滿足 >= 2），但作者
  // 在 a 內（算 interactive）+ 日期在 span 外 12 chars > 10 → outsideText 仍
  // 滿足保護（12 > 10），跳過保留。
  //
  // 為何要過濾 nested interactive：若 a > button（或 button > a），原始
  // querySelectorAll 兩個都收，其 textContent 在累加時會重複計到、outside
  // 被壓負。改成只取最外層 interactive 節點（祖先非 interactive），避免重疊。
  const BUTTON_CLUSTER_TEXT_MAX = 80;
  const BUTTON_CLUSTER_MIN_BUTTONS = 2;
  const BUTTON_CLUSTER_MAX_OUTSIDE_TEXT = 10;

  function isInteractiveLeaf(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.tagName === 'BUTTON') return true;
    if (node.tagName === 'A' && node.hasAttribute('href')) return true;
    const role = node.getAttribute && node.getAttribute('role');
    if (role === 'button') return true;
    return false;
  }

  function hideInsideArticleButtonClusters(articleEl, hidden, containers) {
    containers = containers || articleEl.querySelectorAll(CONTAINER_SEL);
    for (const el of containers) {
      if (el === articleEl) continue;
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (el.tagName === 'IFRAME' || el.tagName === 'VIDEO' || el.tagName === 'AUDIO') continue;
      if (el.contains(articleEl)) continue; // 不砍主文祖先

      // 排除內容元素：含 p / h1-h6 / 媒體 → 不是純按鈕 cluster
      // 但 **button / a[href] / [role=button] 內部**的 p/h1-h6 不算——
      // Medium 類站點把 button label 包成 `<p>Listen</p>`、`<p>Share</p>`
      // 等，遞迴 querySelector 找到這些深層 p 會誤觸發內文保護、讓
      // action bar 本體逃過規則。只要 p/heading 從 el 到它的路徑上「不經過」
      // interactive 或 **已 jread hide 的祖先**，才算真正的內文。
      //
      // v0.6.23 加「已 hide 祖先」條件：Medium 的 clap count "442" 包在
      // `<p>` 外層是 `<div class="bi" role="tooltip">`（同 Member-only
      // badge pattern）——v0.6.22 hideDialogs 已 hide tooltip，但此 p 仍
      // 被 querySelector 抓到；path-check 沿祖先鏈只到 tooltip 就停（不是
      // interactive、但已 hide）→ 過去會把此 p 當真內文、action bar 被誤
      // 跳過。修法：路徑經過 `data-jread-hidden="1"` 的祖先也視為「已
      // 處理、不算真內文」，繼續掃下一個候選。
      const contentCandidates = el.querySelectorAll(
        'p, h1, h2, h3, h4, h5, h6, img, picture, video, iframe');
      let hasContentOutsideInteractive = false;
      for (const n of contentCandidates) {
        let p = n.parentElement;
        let wrappedByInteractiveOrHidden = false;
        while (p && p !== el) {
          if (isInteractiveLeaf(p)) { wrappedByInteractiveOrHidden = true; break; }
          if (p.dataset && p.dataset.jreadHidden === '1') {
            wrappedByInteractiveOrHidden = true; break;
          }
          p = p.parentElement;
        }
        if (!wrappedByInteractiveOrHidden) {
          hasContentOutsideInteractive = true;
          break;
        }
      }
      if (hasContentOutsideInteractive) continue;

      const text = norm(el.textContent);
      if (text.length > BUTTON_CLUSTER_TEXT_MAX) continue;

      // 遞迴收集所有 interactive 節點（button / [role=button] / a[href]），
      // 過濾掉「被另一個 interactive 祖先覆蓋」的 nested 節點——只取最外層，
      // 避免 textContent 在累加時重複計（例如 `<a><button>X</button></a>`
      // 會把 X 算兩次、outsideText 被壓成負值失去保護作用）。
      const allInteractive = el.querySelectorAll('button, [role="button"], a[href]');
      const topInteractive = [];
      for (const n of allInteractive) {
        let nested = false;
        let p = n.parentElement;
        while (p && p !== el) {
          if (isInteractiveLeaf(p)) { nested = true; break; }
          p = p.parentElement;
        }
        if (!nested) topInteractive.push(n);
      }
      if (topInteractive.length < BUTTON_CLUSTER_MIN_BUTTONS) continue;

      // 至少 1 個真正的 button / role=button（遞迴查、不限 topInteractive）：
      // 排除純 link cluster（3 條 a[href] 堆在一起的導覽 rail）——那類由
      // ancestor-sibling / share cluster / keyword 規則處理。BBC 類
      // `<a href><button></button></a>` 因 button 被 a[href] 覆蓋而不在
      // topInteractive 裡，但仍存在於 DOM descendant 中，這裡遞迴查保留命中。
      if (!el.querySelector('button, [role="button"]')) continue;

      // interactive 外的文字量：總文字 - 最外層 interactive 節點文字之和
      let interactiveText = 0;
      for (const n of topInteractive) interactiveText += norm(n.textContent).length;
      const outsideText = text.length - interactiveText;
      if (outsideText > BUTTON_CLUSTER_MAX_OUTSIDE_TEXT) continue;

      hide(el, hidden);
    }
  }

  // ---- 主文內：視覺性空白 spacer ------------------------------------------
  // 結構特徵：容器型元素 + 高度 > 60px + 文字 < 10 字 + 不含任何媒體/互動圖示
  // （img/picture/video/iframe/svg/button）。通常是 Substack / 現代 CSS-in-JS
  // layout 的 visual separator / spacer div，會造成段落與圖片間不自然留白。
  // jsdom 沒 layout，此規則不在 jsdom 測試中生效；真實 Chrome 才命中。
  const SPACER_MIN_HEIGHT = 60;
  const SPACER_TEXT_MAX = 10;

  function hideInsideArticleEmptySpacers(articleEl, hidden, containers) {
    containers = containers || articleEl.querySelectorAll(CONTAINER_SEL);
    for (const el of containers) {
      if (el === articleEl) continue;
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      // iframe / video / audio 本身是媒體，不是 spacer。cross-origin iframe
      // 的 textContent 空、querySelector 讀不到內部 DOM，rect 又有高度——三條
      // spacer 條件全命中，會被誤殺（2026-04-21 Dwarkesh YouTube embed 實測）。
      if (el.tagName === 'IFRAME' || el.tagName === 'VIDEO' || el.tagName === 'AUDIO') continue;
      if (el.querySelector('img, picture, video, iframe, svg, button, input, select, textarea')) continue;

      const text = (el.textContent || '').trim();
      if (text.length > SPACER_TEXT_MAX) continue;

      const rect = el.getBoundingClientRect();
      if (rect.height < SPACER_MIN_HEIGHT) continue;

      hide(el, hidden);
    }
  }

  // ---- 主文內：keyword heuristic ----------------------------------------
  function hideInsideArticleByKeyword(articleEl, hidden, containers) {
    // 限定容器型元素；避免誤殺內文標題/段落/圖片
    const candidates = containers || articleEl.querySelectorAll(CONTAINER_SEL);
    for (const el of candidates) {
      if (el === articleEl) continue;
      if (isInPreserved(el)) continue;           // 保留元素內部/本身跳過
      if (!shouldHideByKeyword(el)) continue;
      // 保護含 h1 的 wrapper（`article_header` / `post-header` / `entry-header`
      // 類 CMS 命名，class 含 `header` keyword 但實際包主文 h1 標題）。
      // 場景：ebc news.ebc.net.tw /news/society/548318 實測——detector promote
      // 升到 `#main_content` 含 `article_header` 為 scope 內子元素，但
      // `article_header` class 命中 NOISE_KEYWORD_RE 的 `header` 詞被 hide，
      // 連帶 h1 主標題消失。通則：article 內含 h1 的 wrapper 一律保留。
      // 內部的 controls / nav / share（article_header 內的 article_nav /
      // 聽新聞 button 等）由其他 rule（hideInsideArticleByKeyword 對子層
      // article_nav、hideInsideArticleAllButtons 對 buttons）各自處理。
      if (el.querySelector && el.querySelector('h1')) continue;
      hide(el, hidden);
    }
    // 另外掃 `<button>` + `<a>`：CTA / 訂閱 / 追蹤 / 分享 / 社群等類型常在
    // class 命名帶 subscribe / follow / share / social / comment / sponsor 等
    // keyword。button / a 不在 CONTAINER_SEL（會影響 action-row / button-
    // cluster 等規則判定），但 class keyword 命中的 button / a 就是雜訊、
    // 直接 hide。
    //
    // 實測場景：
    //   - line today `button.subscribe-button`（class 含 subscribe）
    //   - udn `a.btn btn-social btn-social--line`（LINE 分享連結，href="#"
    //     不含 social platform URL；class 含 social 才命中）
    //   - 各種 `a.share-facebook` / `a.social-link` / `a.comment-btn` 等
    //
    // 風險：主文連結（超連結 / wiki / 引用 / 人名）class 命名極少用 noise
    // keyword，實際會命中的 `<a>` 幾乎都是雜訊。
    for (const el of articleEl.querySelectorAll('button, a')) {
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (!shouldHideByKeyword(el)) continue;
      hide(el, hidden);
    }
  }

  // ---- 主文內：heading text heuristic ----------------------------------
  // 跨站 SPA 類站點（LINE Today / Next.js 類 emotion-style css-hash class）
  // 的 class 無語意，NOISE_KEYWORD_RE 無法命中文末推薦 / 相關列表 section。
  // 靠 heading 文字 match 跨站通用的 section 標題字樣（延伸閱讀 / 相關新聞 /
  // 更多文章 / 其他人也看 / 查看更多 等），hide 其所在的 `<section>` / `<aside>`
  // 容器。
  //
  // 為何 hide `closest('section, aside')` 而非 articleEl 的 direct child：
  // 前者精確命中「heading 所在的 section-level 容器」，只清該 section；
  // 後者會把 articleEl 下整個 direct child（如 column-wrapper）連同主文
  // 一起砍（chinatimes fixture 有「也許您會感興趣」h4 在 column-wrapper 的
  // 深層後代，direct-child 式 hide 會誤殺 column-wrapper 整個主文）。
  //
  // 保護：
  //   - heading text 長度 <= 20（主文副標不會這麼短剛好命中規則字）
  //   - 只 match h2/h3/h4（h1 是主標、h5/h6 罕用為推薦 section heading）
  //   - closest 結果為 null 時放棄 hide（conservative）
  //   - 不 hide 主文本身、主文祖先、PRESERVE_SEL 內部
  function hideInsideArticleByHeadingText(articleEl, hidden) {
    // 擴掃 h2-h4 + div/span（SPA 站如 LINE Today 用 div/span 做 header
    // 而非 semantic heading tag——「貼文 (166)」「熱門」「最新」「繼續看
    // 下去」都是 div/span）。對 div/span 只看 direct text（不抓子孫），
    // 且長度要 <= NOISE_HEADING_MAX_LEN，避免誤殺主文段落。
    const semanticHeadings = Array.from(articleEl.querySelectorAll('h2, h3, h4'));
    const divSpanCandidates = Array.from(articleEl.querySelectorAll('div, span'))
      .filter(el => {
        const direct = Array.from(el.childNodes)
          .filter(n => n.nodeType === 3)
          .map(n => n.textContent).join('');
        const text = norm(direct);
        return text && text.length <= NOISE_HEADING_MAX_LEN;
      });
    const headings = semanticHeadings.concat(divSpanCandidates);
    for (const h of headings) {
      // 對 div/span 只用 direct text（heading tag 用 textContent）
      const isSemanticHeading = /^H[234]$/.test(h.tagName);
      const text = isSemanticHeading
        ? norm(h.textContent)
        : norm(Array.from(h.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(''));
      if (!text || text.length > NOISE_HEADING_MAX_LEN) continue;
      if (!NOISE_HEADING_TEXT_RE.test(text)) continue;
      if (isInPreserved(h)) continue;
      let target = h.closest('section, aside');
      // Fallback：若沒 section/aside 祖先（SPA 類 div-only 結構），改升級到
      // heading 所在 articleEl 的 direct child sub-branch——但僅當該 sub-
      // branch **不含主文長段落**（無 p 的 textLen > 100）才動，避免誤殺
      // 主文（chinatimes「也許您會感興趣」h4 在 column-wrapper 深層後代，
      // column-wrapper 自身含主文 p > 100，保護成立）。
      if (!target || target === articleEl || target.contains(articleEl)) {
        let cur = h;
        while (cur.parentElement && cur.parentElement !== articleEl) {
          cur = cur.parentElement;
        }
        if (!cur.parentElement || cur === articleEl) continue;
        // 檢查此 sub-branch 是否含主文長段落——有即跳過（保護主文）
        let hasLongParagraph = false;
        for (const p of cur.querySelectorAll('p')) {
          const pText = norm(p.textContent);
          if (pText.length >= 100) { hasLongParagraph = true; break; }
        }
        if (hasLongParagraph) continue;
        target = cur;
      }
      if (!target) continue;
      if (target === articleEl) continue;
      if (!articleEl.contains(target)) continue;
      if (target.contains(articleEl)) continue;
      if (target.dataset && target.dataset.jreadHidden === '1') continue;
      hide(target, hidden);
    }
  }

  // ---- 主文內：link text heuristic（CTA / 外連 / 訂閱推廣）-----------------
  // 對主文內 `<a>` 元素：text 命中 NOISE_LINK_TEXT_RE 則 hide。若 `<a>` 的
  // parent 是 `<p>` / `<div>` 且 a 文字占 parent 文字 80% 以上，hide parent
  // 整個段落；否則只 hide a 本身。
  function hideInsideArticleByLinkText(articleEl, hidden) {
    // 掃 `<a>` + `<button>`——CTA 按鈕類（訂閱 / 追蹤 / 關注）通常是 button
    // 而非 a，舊版只掃 a 漏網
    const links = articleEl.querySelectorAll('a, button');
    for (const a of links) {
      const text = norm(a.textContent);
      if (!text || text.length > NOISE_LINK_TEXT_MAX_LEN) continue;
      if (!NOISE_LINK_TEXT_RE.test(text)) continue;
      if (isInPreserved(a)) continue;
      if (a.dataset && a.dataset.jreadHidden === '1') continue;
      // 嘗試 hide parent p / div 若 a 文字占 parent 文字 80% 以上（整個段
      // 落都是 CTA）
      const parent = a.parentElement;
      let target = a;
      if (parent && (parent.tagName === 'P' || parent.tagName === 'DIV')) {
        if (parent === articleEl) { /* 不升級 */ }
        else if (parent.contains(articleEl)) { /* 不 hide 主文祖先 */ }
        else {
          const parentText = norm(parent.textContent);
          if (parentText.length > 0 && text.length / parentText.length >= 0.8) {
            target = parent;
          }
        }
      }
      if (target.dataset && target.dataset.jreadHidden === '1') continue;
      if (target === articleEl) continue;
      if (target.contains && target.contains(articleEl)) continue;
      hide(target, hidden);
    }
  }

  // ---- 主文內：sidebar column（高 linkDensity + 低文字量 vs 兄弟）--------
  // 結構特徵（非站點特判）：主文容器內任一 container，其 direct children
  // 中某個 child Cs 滿足：
  //   - Cs.textLen < 主要 sibling 的 10%
  //   - Cs linkDensity > 0.5
  // → Cs 為 sidebar column（導覽/相關列表/訂閱/Listen-on 卡片等），隱藏之。
  //
  // 場景（Substack podcast-post / Dwarkesh）：`<article>` tag 把整個
  // main-content-and-sidebar flex 2-col 包進來，sidebar 身為 article 後代
  // 躲過 outside-article / ancestor-sibling 所有規則。單欄文章不觸發（主欄
  // 本身還沒 500 字就 continue）。
  //
  // 為何不檢查 display: flex / grid：
  //   - 判斷重心是「content ratio + link density」，layout 方式不影響是否該清
  //   - 省去 jsdom 對 computed style display / flex-direction 的相容性麻煩
  //
  // 為何保留元素 scope：article 內自帶 <figure><figcaption> 時，figcaption
  // 若 linkDensity 高也不該砍——PRESERVE_SEL closest() 已擋掉。
  const SIDEBAR_COLUMN_TEXT_RATIO = 0.1;
  const SIDEBAR_COLUMN_MIN_LINK_DENSITY = 0.5;
  const SIDEBAR_COLUMN_MIN_MAIN_TEXT = 500;
  // 條件 B（<aside> tag）——sidebar column 的 `<aside>` tag 特判閾值：
  // `<aside>` 是 HTML5 語意「次要內容」tag。article 內 aside 只要
  // rectH > 400 即視為 sidebar（導覽 / 廣告 / 相關列表）hide——rectH 門檻
  // 已排除 pull-quote（通常 < 300px 簡單結構）。不做 textLen 相對比值：
  // chinatimes 實測 aside 含 10 條熱門新聞 ~1389 chars vs 主文當下 2457
  // chars（時序 race：推薦閱讀未 lazy-load 完時 main 偏低）打在 0.5
  // ratio 上漏網；Engadget 過往靠此條 B 命中也不依賴 ratio，因為 aside
  // 本來就被廣告 placeholder 稀釋 textLen 接近 0。
  const SIDEBAR_ASIDE_MIN_HEIGHT = 400;

  function hideInsideArticleSidebarColumns(articleEl, hidden, containers) {
    containers = containers || articleEl.querySelectorAll(CONTAINER_SEL);
    for (const el of containers) {
      if (el === articleEl) continue;
      if (isInPreserved(el)) continue;
      const children = Array.from(el.children);
      if (children.length < 2) continue;

      const stats = children.map(c => {
        const text = norm(c.textContent);
        let linkLen = 0;
        if (c.querySelectorAll) {
          for (const a of c.querySelectorAll('a')) {
            linkLen += norm(a.textContent).length;
          }
        }
        return { el: c, textLen: text.length, ld: text.length ? linkLen / text.length : 0 };
      });

      // 找主欄：文字量最大者
      let main = stats[0];
      for (const s of stats) if (s.textLen > main.textLen) main = s;
      if (main.textLen < SIDEBAR_COLUMN_MIN_MAIN_TEXT) continue;

      for (const s of stats) {
        if (s === main) continue;
        if (isInPreserved(s.el)) continue;
        // 條件 A：textLen < main × 10% AND linkDensity > 0.5
        // （Substack Dwarkesh 高 link-density 卡片命中路徑）
        if (s.textLen < main.textLen * SIDEBAR_COLUMN_TEXT_RATIO &&
            s.ld > SIDEBAR_COLUMN_MIN_LINK_DENSITY) {
          hide(s.el, hidden);
          continue;
        }
        // 條件 B：child 是 <aside> tag + rectH > 400
        // `<aside>` 是 HTML5 語意「次要內容」tag；若 rectH > 400 已排除
        // pull-quote（通常簡單結構 < 300px）。不再檢查 textLen 比值——
        // chinatimes 實測 aside 含 10 條熱門新聞 + section header 約 1389
        // chars，主文當下 2457 chars（時序 race：相關閱讀還沒 lazy-load 完
        // 時 main 文字量偏低），aside/main = 0.565 打在保守 0.5 ratio 上
        // 漏網。aside tag + rectH > 400 的**絕對結構特徵**夠強，textLen
        // 相對比值只會把這類邊緣場景當 false negative 放過。
        // Wikipedia 類 infobox 多用 `<table class="infobox">` 非 <aside>；
        // NYT pull-quote 用 <aside> 但 rectH < 300——通則安全。
        if (s.el.tagName === 'ASIDE') {
          const r = s.el.getBoundingClientRect &&
            s.el.getBoundingClientRect();
          if (r && r.height > SIDEBAR_ASIDE_MIN_HEIGHT) {
            hide(s.el, hidden);
          }
        }
      }
    }
  }

  // ---- 主文內：廣告位 grid / flex cell 被 AdBlocker 清後殘留的欄位寬度 ----
  // 結構特徵（非站點特判）：原站用 CSS Grid / Flex 做「主文 + 廣告側欄」多
  // 欄 layout，AdBlocker（或站點自身）把廣告元素 hide 後，**grid cell / flex
  // child 佔的寬度還在**——grid-template-columns 仍定義 300px 給右欄，主文
  // 被擠成窄欄。Engadget 實測：article 內 grid-template-columns = `[main-
  // start] 196px [main-end right-start] 300px [right-end]`，右欄 ad 被擋、
  // 但 300px 硬性保留，主文只剩 196px。
  //
  // 通則：若 display: grid / flex 的 container 有「某個 direct child 被隱藏
  // （data-jread-hidden="1" 或 rect 0×0）」，代表原設計中的某一欄空了——
  // 把 container 退化成 block + 清 grid-template-columns，讓主文回到自然
  // block 寬度。
  //
  // 為何必須走 JS 而非 CSS：
  // - CSS selector 無法條件性判斷 computed display:grid（沒有 pseudo-class
  //   on computed style）
  // - `*:has(> [data-jread-hidden="1"])` 太廣（所有 container 都中），且 CSS
  //   無法分辨那是「側欄被清」還是「有意 hide 的 inline decoration」
  //
  // 邊界保護（避免誤殺 intentional 多欄）：
  // - 只處理 grid 或 flex-row container（flex-column / inline 不動）
  // - 要求 hidden child 的 rect.width / rect.height 反映它「曾佔 layout 空間」
  //   （rect.width > 0 或者 dataset.jreadHidden="1"）
  // - 保留 container 原 inline display / grid-template 讓 restore 還原
  const COLLAPSE_ATTR = 'data-jread-collapsed';

  function collapseGridWithHiddenCell(articleEl, hidden) {
    if (!articleEl || !articleEl.querySelectorAll) return;
    const collapsed = [];
    // 掃 article 內所有可能的 grid / flex-row container
    for (const el of articleEl.querySelectorAll('*')) {
      if (el === articleEl) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (isInPreserved(el)) continue;
      const cs = window.getComputedStyle(el);
      const isGrid = cs.display === 'grid' || cs.display === 'inline-grid';
      const isFlexRow = (cs.display === 'flex' || cs.display === 'inline-flex') &&
        (cs.flexDirection === 'row' || cs.flexDirection === 'row-reverse');
      const children = Array.from(el.children);
      if (children.length < 1) continue;
      // 分類 children：hidden vs visible；同時記下是否有 visible float child
      // （判斷是否為傳統 float 多欄 layout）
      let hasHiddenChild = false;
      let hasVisibleFloatChild = false;
      const visibleChildren = [];
      for (const c of children) {
        const ccs = window.getComputedStyle(c);
        const isHidden = (c.dataset && c.dataset.jreadHidden === '1') ||
          ccs.display === 'none' || ccs.visibility === 'hidden';
        if (isHidden) { hasHiddenChild = true; continue; }
        visibleChildren.push(c);
        if (ccs.float && ccs.float !== 'none') hasVisibleFloatChild = true;
      }
      // 條件 C（新，傳統 float layout + hidden sibling）：container 不是
      // grid / flex-row 但 direct children 用 `float: left/right` + 固定
      // width 做多欄 layout（chinatimes `.column-wrapper.clear-fix` 實測：
      // column-left float:left width:308px + aside.column-right float:right
      // width:300px）。aside 被 cleaner hide 後 column-left 仍鎖寬、右側
      // 空白殘留。通則：float + hidden sibling 代表原設計某欄已空、剩下
      // visible float child 該撐滿 container——清 float + width 讓它回到
      // 自然 block 流。
      const isFloatLayout = !isGrid && !isFlexRow && hasVisibleFloatChild;
      if (!isGrid && !isFlexRow && !isFloatLayout) continue;
      // 條件 A（既有 v0.6.12）：有 hidden sibling → 退化
      //   要求 children.length >= 2，避免「單 child 的 container 正好 display:none」
      //   這種無意義情境誤動
      //   條件 C 的 float 場景也走這條：hidden sibling + visible child 就退化
      const triggerHiddenSibling = hasHiddenChild && children.length >= 2 &&
        visibleChildren.length >= 1;
      // 條件 B（新）：grid underfill——visible children 全在同一 row 但寬度
      // 總和 < container 70%，代表 grid 保留大片空白欄位壓擠主文
      // （BBC 24-col design system 場景：container 用 repeat(24, ...) grid，
      //  child 明確 `grid-column: 6 / span 12` 只佔中間 12 欄，沒 sibling
      //  佔剩餘 12 欄——原站設計預期右側放東西但這篇沒放，導致主文被壓窄）
      //
      // 僅對 grid 做、不對 flex-row 做：flex-row child 寬度未撐滿 container
      // 通常是 `justify-content: center/flex-start` 的自然寬度流，不是被
      // layout 鎖死；grid 則是被 grid-template-columns 明確分配 track。
      //
      // 額外保護：
      // - 只處理單 row grid（visible children top 都相同）——2D grid（gallery
      //   等）child 跨多 row 時 sum < container 是正常的，不該 collapse
      // - container 寬度 >= 100 才處理——jsdom 等無 layout engine 環境 rect 全 0
      //   會自動 skip；極窄 container 也避免雜訊
      let triggerGridUnderfill = false;
      if (!triggerHiddenSibling && isGrid && visibleChildren.length >= 1) {
        const containerRect = el.getBoundingClientRect();
        if (containerRect.width >= 100) {
          const firstTop = visibleChildren[0].getBoundingClientRect().top;
          const allSameRow = visibleChildren.every(c =>
            Math.abs(c.getBoundingClientRect().top - firstTop) < 5);
          if (allSameRow) {
            let sumWidth = 0;
            for (const c of visibleChildren) sumWidth += c.getBoundingClientRect().width;
            if (sumWidth < containerRect.width * 0.7) triggerGridUnderfill = true;
          }
        }
      }
      if (!triggerHiddenSibling && !triggerGridUnderfill) continue;
      // 記下 container 的原 inline style 以便 restore
      const CONTAINER_PROPS = [
        'display', 'grid-template-columns', 'grid-template-rows',
        'grid-template-areas', 'flex-direction'
      ];
      collapsed.push({ el, kind: 'container', prev: snapshotStyles(el, CONTAINER_PROPS) });
      // 用 !important 確保贏過原站的 grid rule（Tailwind 的 `md:grid-cols-*`
      // 等 class 本身 specificity 不是 !important，但多欄定義 rule 可能
      // 有 utility 特殊 priority；保險起見用 important）
      const containerDecls = {
        'display': 'block',
        'grid-template-columns': 'none',
        'grid-template-rows': 'none',
        'grid-template-areas': 'none'
      };
      if (isFlexRow) containerDecls['flex-direction'] = 'column';
      applyImportant(el, containerDecls);
      if (el.dataset) el.dataset.jreadCollapsed = '1';

      // 關鍵：collapse container 只改了父的 display，但 children 身上的
      // Bootstrap `col-md-8` 類 class（`flex: 0 0 66.67%; max-width: 66.67%`）
      // 或 Tailwind `col-span-*` 等 utility 寬度定義**仍會生效**——child 會
      // 維持原來的 N/12 欄寬度，collapse 等於沒做。Lawfaremedia 實測：
      // `.row` 被 collapse 後 `.col-md-8` 仍 405px wide（608 × 66.67%），
      // 主文被擠在左 2/3、右邊 200px 空白。
      // 修法：對 visible 的 direct children 強制 `flex: initial` + `max-width:
      // none` + `width: auto`，讓 children 恢復 block 預設「撐滿父寬度」。
      // 只用 longhand，避免 shorthand serialization 在不同瀏覽器 / jsdom
      // 不一致。longhand !important inline 能贏過 Bootstrap 的
      // `flex: 0 0 66.67%` shorthand stylesheet rule。float 清零：chinatimes
      // 類傳統多欄 float layout，aside 被 hide 後剩下 float: left 的
      // column-left 仍會維持 308px 固定寬、不撐滿 container。
      const CHILD_PROPS = [
        'flex-grow', 'flex-shrink', 'flex-basis',
        'width', 'max-width', 'grid-column', 'float'
      ];
      const CHILD_DECLS = {
        'flex-grow': '0', 'flex-shrink': '0', 'flex-basis': 'auto',
        'width': 'auto', 'max-width': 'none', 'grid-column': 'auto', 'float': 'none'
      };
      for (const c of visibleChildren) {
        if (!c.style) continue;
        collapsed.push({ el: c, kind: 'child', prev: snapshotStyles(c, CHILD_PROPS) });
        applyImportant(c, CHILD_DECLS);
      }
    }
    // 把 collapsed 紀錄接到 hidden 陣列尾（共享 restore）——但格式不同，
    // restore 流程要能識別。為了不動 restore 簽章，存到 hidden.__collapsed
    // （sidecar array，不是正常 item）。
    hidden.__collapsed = collapsed;
  }

  function restoreCollapsed(hiddenEls) {
    const collapsed = hiddenEls && hiddenEls.__collapsed;
    if (!Array.isArray(collapsed)) return;
    for (const item of collapsed) {
      if (!item || !item.el) continue;
      restoreStyles(item.el, item.prev);
      if (item.kind === 'container' && item.el.dataset) delete item.el.dataset.jreadCollapsed;
    }
  }

  // ---- articleEl 內部 grid/flex container 強制 block ---------------------
  //
  // 場景：BBC /news/articles/clyepyy82kxo 實測——即便廣告 wrapper 已 hide、
  // 主文 `<p>` 仍被鎖在 386px 欄位（grid-template-columns: 386px 的單欄
  // 固定寬 grid container）。祖先鏈 reset（`data-jread-ancestor`）只處理
  // articleEl **外部**祖先、沒管內部；`collapseGridWithHiddenCell` 只在
  // grid/flex container 有 hidden child 時 collapse。兩者都漏掉「內部
  // 沒 hidden sibling 但 grid-template 固定鎖寬」的 container。
  //
  // 通則：reader mode 精神是「內文撐滿 card」，articleEl 內的任何 grid/
  // flex layout container（除保留元素 figure/figcaption/summary/blockquote
  // 內部）都強制 `display: block` + 清 `grid-template-columns/rows`。
  // children 回歸 block flow、繼承 parent 寬度。
  //
  // 排除保留範圍：
  // (1) preserved 元素（summary/figure/figcaption/blockquote）內部不動
  // (2) grid-template-columns 非 hard-coded px 值（`1fr 1fr` / `auto` /
  //     `minmax(0, 1fr)` 等彈性單位）保留——這類通常是 intentional 多欄
  //     設計（主文內雙欄引述 / 圖片並列），reader mode 下仍合理
  // (3) flex container 不動——Bootstrap row/col 類 layout 由
  //     `collapseGridWithHiddenCell` 針對 hidden child 場景處理，
  //     無 hidden 的 flex 保留（避免誤殺主文內設計的 flex 排版）
  //
  // 只處理 `display: grid|inline-grid` + `grid-template-columns` 含 `\d+px`
  // —— hard-coded 固定寬度是 pathological case（BBC styled-components
  // 把主文鎖在 386px 單欄），reader mode 下明確該 reset。
  const INNER_GRID_PROPS = ['display', 'grid-template-columns', 'grid-template-rows'];
  const INNER_GRID_DECLS = {
    'display': 'block',
    'grid-template-columns': 'none',
    'grid-template-rows': 'none'
  };

  function collapseInnerGridFlex(articleEl, hidden) {
    if (!articleEl || !articleEl.querySelectorAll) return;
    const resets = [];
    for (const el of articleEl.querySelectorAll('*')) {
      if (el === articleEl) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (isInPreserved(el)) continue;
      let cs;
      try { cs = window.getComputedStyle(el); } catch (_) { continue; }
      if (!cs) continue;
      if (!/^(grid|inline-grid)$/.test(cs.display)) continue;
      // 只 collapse hard-coded px 的 grid（固定欄寬）；彈性單位保留
      if (!/\d+px/.test(cs.gridTemplateColumns || '')) continue;
      resets.push({ el, prev: snapshotStyles(el, INNER_GRID_PROPS) });
      applyImportant(el, INNER_GRID_DECLS);
    }
    hidden.__innerGridFlex = resets;
  }

  function restoreInnerGridFlex(hiddenEls) {
    const arr = hiddenEls && hiddenEls.__innerGridFlex;
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item || !item.el) continue;
      restoreStyles(item.el, item.prev);
    }
  }

  // ---- 媒體 placeholder pattern：區分 padding-hack vs 正規 aspect-ratio ---
  // 兩種常見媒體容器模式：
  //   A) padding-hack（Substack / Medium）：
  //      `<div style="position:relative; padding-bottom: 56.25%;">
  //         <img style="position:absolute; inset:0; width:100%; height:100%;">`
  //      用 padding-bottom 撐 16:9 空間，img 絕對覆蓋。閱讀模式下我們重排版、
  //      img 可能脫離原本的布局邏輯，padding 留著 = 主圖下方一大片空白。
  //   B) 純 aspect-ratio（Engadget / 新世代 CSS）：
  //      `<div style="aspect-ratio: 16/9;"><img style="position:absolute; inset:0; w/h:100%">`
  //      容器 padding-bottom 為 0，完全靠 `aspect-ratio` 撐高度，img 一樣
  //      絕對覆蓋。閱讀模式下若強行 reset `aspect-ratio: auto`，容器高度
  //      歸零、img 雖然仍 absolute 渲染但 flow 內看不到 → 主圖消失（v0.6.13
  //      在 Engadget 實測到）。
  //
  // v0.6.13 之前 styler 有一條 `*:has(> img) { padding-bottom: 0; aspect-ratio: auto }`
  // 對 A 沒問題、對 B 會破。CSS :has() 看不到 computed padding 值，無法在樣式
  // 層區分兩者——搬到 cleaner runtime：
  //   - 計算 parent 的 computed padding-bottom 與 width 比例
  //   - 比例 > 20% 才視為 hack、reset padding-bottom 並把 media 從 absolute
  //     解放為 static
  //   - 否則（包含純 aspect-ratio 容器）完全不碰
  //
  // 通則性：僅以「padding-bottom / width 比例」為結構特徵，不綁任何 hostname
  // 或 class。
  function resetMediaPlaceholderPadding(articleEl, hidden) {
    if (!articleEl || !articleEl.querySelectorAll) return;
    const resets = [];
    const visited = new WeakSet();
    for (const media of articleEl.querySelectorAll('img, picture, video')) {
      const parent = media.parentElement;
      if (!parent || parent === articleEl) continue;
      if (visited.has(parent)) continue;
      visited.add(parent);
      if (isInPreserved(parent) && parent.matches && parent.matches('figcaption')) continue;

      const mediaCs = window.getComputedStyle(media);
      if (mediaCs.position !== 'absolute') continue;

      const pCs = window.getComputedStyle(parent);
      // 先讀 inline string（jsdom 不解析 % → px，但原站多半走 stylesheet、
      // 少數 hack 寫在 inline）。real Chrome 下 computed 已 resolve 成 px。
      let isHack = false;
      const inlinePb = parent.style && parent.style.paddingBottom;
      if (inlinePb && /%$/.test(inlinePb) && parseFloat(inlinePb) > 20) isHack = true;
      if (!isHack) {
        const pbPx = parseFloat(pCs.paddingBottom) || 0;
        const wPx = parseFloat(pCs.width) || 0;
        if (pbPx > 0 && wPx > 0 && pbPx / wPx > 0.2) isHack = true;
      }
      if (!isHack) continue;

      resets.push({
        kind: 'placeholder-parent',
        el: parent,
        prev: snapshotStyles(parent, ['padding-bottom'])
      });
      applyImportant(parent, { 'padding-bottom': '0' });

      // 把 media 從 absolute 解放，讓它照自己的 intrinsic 尺寸流在原位
      // （styler 那邊會套 max-width:100% + height:auto）
      resets.push({
        kind: 'placeholder-media',
        el: media,
        prev: snapshotStyles(media, ['position', 'top', 'left', 'right', 'bottom'])
      });
      applyImportant(media, { 'position': 'static' });
      media.style.removeProperty('top');
      media.style.removeProperty('left');
      media.style.removeProperty('right');
      media.style.removeProperty('bottom');
    }
    hidden.__mediaResets = resets;
  }

  function restoreMediaResets(hiddenEls) {
    const resets = hiddenEls && hiddenEls.__mediaResets;
    if (!Array.isArray(resets)) return;
    for (const item of resets) {
      if (!item || !item.el) continue;
      restoreStyles(item.el, item.prev);
    }
  }

  // ---- 主文內：lazy-load 圖片 src 補正 ------------------------------------
  // 場景：Medium / WordPress / CMS 類站點常用 IntersectionObserver 做 lazy
  // image load，未進視窗的 <img> 的 `src` 是 1x1 透明 gif、base64 placeholder
  // 或空字串，真圖 URL 存在 `data-src` / `data-original` / `data-lazy-src`。
  // 進 reader mode 時整個 DOM 被標 active + 套排版，**使用者捲動時不會觸發
  // 原站的 lazy-load observer**（可能是原 observer 被 style 變動影響、可能
  // 是原本的 root margin 以 viewport 為基準跟不上新排版），導致圖片一片空白。
  //
  // 修法：進 reader mode 時主動把 `data-src` / `data-original` / `data-lazy-src`
  // / `data-lazy` / `data-srcset` / `srcset` 的 URL 補到 `src`，瀏覽器就會正
  // 常載入。restore 時把 src 還原成原值，不破壞原站的 lazy-load 邏輯。
  //
  // 通則依據：對標 Readability.js 的 `_fixLazyImages`——Readability 是「parse
  // HTML 後修」情境、我們是「瀏覽器已載但 observer 沒跑」情境，attribute 名單
  // 與補救邏輯一樣，記 prevSrc 做還原是 JRead 架構的延伸。
  const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy'];
  // placeholder 判定：empty / about:blank / data:image URL 視為「未 hydrate」
  // 常見 placeholder：`data:image/gif;base64,R0lGOD...`（1x1 透明 gif）、
  // `data:image/svg+xml;base64,...`（低解析度佔位 svg）
  const LAZY_PLACEHOLDER_RE = /^\s*$|^about:blank$|^data:image\//i;

  function hydrateLazyImages(articleEl, hidden) {
    if (!articleEl || !articleEl.querySelectorAll) return;
    const hydrations = [];
    for (const img of articleEl.querySelectorAll('img')) {
      // 區分「沒有 src attribute」 vs 「src 空字串」——restore 要 round-trip
      // 回原狀態，兩者不同（原站若 `<img>` 沒 src attribute，我們補完後要
      // removeAttribute 才能還原；若原站 `src=""` 則要 setAttribute('src','')）
      const hadSrcAttr = img.hasAttribute('src');
      const prevSrc = hadSrcAttr ? img.getAttribute('src') : '';
      if (!LAZY_PLACEHOLDER_RE.test(prevSrc)) continue;

      let newSrc = null;
      for (const attr of LAZY_SRC_ATTRS) {
        const v = img.getAttribute(attr);
        if (v && !LAZY_PLACEHOLDER_RE.test(v)) { newSrc = v; break; }
      }
      // srcset fallback：取第一個 URL（忽略後面的 `1x` / `300w` descriptor）
      if (!newSrc) {
        const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
        if (srcset) {
          const first = srcset.split(',')[0].trim().split(/\s+/)[0];
          if (first && !LAZY_PLACEHOLDER_RE.test(first)) newSrc = first;
        }
      }
      if (!newSrc) continue;

      hydrations.push({ el: img, prevSrc, hadSrcAttr });
      img.setAttribute('src', newSrc);
    }
    hidden.__lazyImages = hydrations;
  }

  function restoreLazyImages(hiddenEls) {
    const arr = hiddenEls && hiddenEls.__lazyImages;
    if (!Array.isArray(arr)) return;
    for (const { el, prevSrc, hadSrcAttr } of arr) {
      if (!el || !el.setAttribute) continue;
      if (hadSrcAttr) el.setAttribute('src', prevSrc);
      else el.removeAttribute('src');
    }
  }

  // ---- 主文內：所有 interactive button 一律 hide --------------------------
  // Jimmy 2026-04-23 明確要求：reader mode 下不需要任何按鈕（分享 / 訂閱 /
  // 追蹤 / 讚 / 收藏 / 播放 / 展開 / 任何 CTA / 任何 interactive）。
  // reader mode 的定位是「純閱讀」——所有 button 類 interactive 都是雜訊。
  //
  // 範圍：`<button>` + `[role="button"]` + `<input type="button|submit|reset">`。
  // 不受 `PRESERVE_SEL`（summary/figure/figcaption/blockquote）保護影響——
  // figure 內的 expand/zoom 按鈕、figcaption 內的展開按鈕也一律清掉。
  //
  // 風險評估：極低。reader mode 下使用者只閱讀、不會操作按鈕；主文正文
  // 從不用 `<button>` 排版文字。極少數 code demo / interactive widget 會
  // 被誤殺，但 reader mode 本就不適合跑 interactive demo（應該回原站）。
  function hideInsideArticleAllButtons(articleEl, hidden) {
    const sel = 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]';
    for (const btn of articleEl.querySelectorAll(sel)) {
      if (btn === articleEl) continue;
      if (btn.contains && btn.contains(articleEl)) continue;
      if (btn.dataset && btn.dataset.jreadHidden === '1') continue;
      // 保護含主文媒體的 button wrapper（v0.7.11 Medium click-to-zoom 修法）：
      // Medium 把主文 <picture>/<img> 嵌在 <div role="button" tabindex="0">
      // 的 wrapper 裡、點擊看大圖（a11y 同時有 span「Press enter or click
      // to view image in full size」）。btn 內含 img/picture/video 時保留
      // 整個 wrapper——這是 v0.7.3「所有 button 無條件清」rule 的例外：
      // button wrapper 雙重角色（click-to-zoom + 主文媒體容器），hide 掉
      // 連圖片都看不見。通則依據：button 內含媒體元素 = 主文載體、非純
      // CTA。share / subscribe / follow button 一般用 svg（不在保護範圍內）
      // 或完全無圖、保留判定不影響。
      if (btn.querySelector && btn.querySelector('img, picture, video')) continue;
      hide(btn, hidden);
    }
  }

  // ---- 主文內：<font> tag heuristic ------------------------------------
  // `<font>` 是 HTML4 老式樣式 tag，HTML5 已 deprecated。現代網站幾乎只在
  // **inline 廣告 / PR 推廣**插播時用它（改字色 / 加 emoji 吸睛），正文排
  // 版都改走 CSS class。udn 實測：主文段落中插入 `<font><a>🎮想成為超強
  // 飼主？玩問答遊戲拿課程金</a></font>` PR 連結，無 class / id、沒祖先
  // section，既有 rule 全攔不到。直接 hide 主文內所有 `<font>` tag——損失
  // 風險極低（現代主文不該有 font tag）。
  function hideInsideArticleFontTags(articleEl, hidden) {
    for (const el of articleEl.querySelectorAll('font')) {
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      hide(el, hidden);
    }
  }

  // ---- 主文內：留言 / 社群面板 structural rule ---------------------------
  // 跨站通用的結構特徵：comment / social widget 必含多個「N 分鐘/小時/天前」
  // 相對時間戳（每則留言一個）。主文作者資訊最多 1 個相對時間戳（發布
  // 時間），超過 3 個就是留言面板或社群 feed。
  //
  // LINE Today 實測：留言面板跟主文在同一個 swipe-back direct child
  // wrapper 下（heading rule 升級會誤殺主文），但留言 cluster 本身是
  // 獨立 sub-tree，可透過「relative time marker count」定位。
  //
  // 掃 articleEl 的 descendants（div / section），若其 textContent 含
  // >=3 個相對時間戳 pattern 且「自身 textLen < 父 textLen 的 80%」
  // （避免命中主文容器），hide 之。
  const RELATIVE_TIME_RE = /\d+\s*(分鐘前|小時前|天前|週前|個月前|年前|hours?\s*ago|minutes?\s*ago|days?\s*ago|weeks?\s*ago)/g;
  const COMMENT_PANEL_MIN_TIMESTAMPS = 3;

  function hideInsideArticleCommentPanels(articleEl, hidden) {
    for (const el of articleEl.querySelectorAll('div, section, aside, ul, ol')) {
      if (el === articleEl) continue;
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (el.contains(articleEl)) continue;
      const text = el.textContent || '';
      const matches = text.match(RELATIVE_TIME_RE);
      if (!matches || matches.length < COMMENT_PANEL_MIN_TIMESTAMPS) continue;
      // 保護主文：若此 el 含主文長段落（>= 300 chars 的 p），跳過
      let hasMainParagraph = false;
      for (const p of el.querySelectorAll('p')) {
        const pText = norm(p.textContent);
        if (pText.length >= 300) { hasMainParagraph = true; break; }
      }
      if (hasMainParagraph) continue;
      hide(el, hidden);
    }
  }

  // ---- 主文內：第三方廣告服務標識符 ------------------------------------
  // v0.7.4 EasyList spike 結論：Jimmy 四站實測（line today / udn /
  // chinatimes / upmedia）在 reader mode 內的廣告殘留，幾乎都指向**第三
  // 方廣告服務的標準標識符**，而非站點自訂 class。這些標識符是跨站業界
  // 慣例（Google Ad Manager 的 `div-gpt-ad-*` 是 GAM 官方推薦命名、
  // Taboola 的 `trc_*` 是 Taboola 官方 widget prefix、popIn 的
  // `_popIn_*` 是 popIn recommendation 官方 class），屬結構性通則，
  // 不是站點特判（硬規則 3）。
  //
  // 為何仍要加：NOISE_KEYWORD_RE 的 markerOf 只看 class/id 是否含關鍵詞
  // 片段，對「`div` 只有 id / 無 class」（`div-gpt-ad` 是 id prefix）
  // 或 iframe 的 name 屬性（`google_ads_iframe_*`）無法命中；加精確
  // selector 作為保險絲。實測命中不多（reader mode 架構已代理大部分），
  // 但成本是 8 個 CSS selector 的 `querySelectorAll`，效能可忽略。
  const THIRD_PARTY_AD_SEL = [
    // Google Ad Manager / GPT（業界最大 ad server，標準命名）
    '[id^="div-gpt-ad"]',
    '[id^="google_ads_"]',
    'iframe[name^="google_ads_iframe"]',
    'iframe[id^="google_ads_iframe"]',
    'iframe[src*="googlesyndication.com"]',
    'iframe[src*="doubleclick.net"]',
    // Taboola（跨站「推薦 / 相關內容」廣告平台）
    '[class*="trc_"]',
    '[id*="taboola"]',
    '[class*="taboola"]',
    // popIn Discovery（日系廣告平台，台灣新聞站常用）
    '[class*="_popIn_"]',
    '[id*="_popIn_"]',
    // Outbrain（Taboola 同類競品）
    '[class*="OUTBRAIN"]',
    '[data-widget-id*="outbrain"]',
    // 通用 ad container class/id prefix（跨站命名慣例，非站點特判）
    '[id^="ad-"]', '[id^="ads-"]', '[id^="ad_"]', '[id^="ads_"]',
    '[class^="ad-"]', '[class^="ads-"]',
    // React component data attribute（跨站標準，BBC / Vox / React 新聞站慣例）
    // class 是 styled-components hash（`sc-XXXXXX`）無 keyword 可命中，但
    // React 廣告 component 統一用 data-testid / data-component 標記：
    //   <div data-testid="ad-unit" data-component="ad-slot" class="sc-...">
    // BBC 實測 /news/articles/clyepyy82kxo 右側廣告占位——內層 dotcom-ad
    // 已被 AD_BOUNDARY_RE hide、但外層 styled-components wrapper 有 min-height
    // CSS 仍撐 540×1100 灰色占位，必須靠 data attribute 才能識別。
    '[data-testid="ad-unit"]',
    '[data-testid="ad-slot"]',
    '[data-component="ad-slot"]',
    '[data-component="ad-unit"]',
  ].join(', ');

  function hideInsideArticleByThirdPartyAds(articleEl, hidden) {
    for (const el of articleEl.querySelectorAll(THIRD_PARTY_AD_SEL)) {
      if (el === articleEl) continue;
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      if (el.contains(articleEl)) continue;
      hide(el, hidden);
    }
  }

  // ---- 主文內：inline 廣告插播文字 heuristic ---------------------------
  // 自由時報 / 聯合 / ETtoday 等台灣新聞站在主文段落中段插播「廣告（請
  // 繼續閱讀本文）」類 placeholder 短文字，無可識別 class、不成 section
  // —— keyword / heading / link 規則都攔不到。走 inline text 匹配：對
  // 主文內 span / p / div 的 direct textNode 內容，若 text 整體命中
  // NOISE_INLINE_AD_TEXT_RE 則 hide 該 element。
  //
  // 為何用 direct textNode 而非 textContent：textContent 會把子孫文字全
  // 算進來，「廣告」字樣的主文段落（如「政府廣告預算」）會被誤殺。
  // direct textNode 確保只 match「element 自己直接的文字」，span/p 本
  // 身就是 placeholder 插播 leaf（無子 element）才命中。
  function hideInsideArticleByInlineAdText(articleEl, hidden) {
    for (const el of articleEl.querySelectorAll('span, p, div')) {
      if (isInPreserved(el)) continue;
      if (el.dataset && el.dataset.jreadHidden === '1') continue;
      const direct = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent).join('');
      const text = norm(direct);
      if (!text || text.length > NOISE_INLINE_AD_MAX_LEN) continue;
      if (!NOISE_INLINE_AD_TEXT_RE.test(text)) continue;
      if (el === articleEl) continue;
      if (el.contains && el.contains(articleEl)) continue;
      hide(el, hidden);
    }
  }

  // ---- Reader mode 下凍結主文祖先鏈：攔截 dynamic append ----------------
  // 場景：infinite-scroll 站點（news.ltn.com.tw 自由時報 popIn Discovery /
  // 相似 CMS）、延遲 lazy-load 側邊欄、動態 inject 的廣告 / 推薦列表。
  // cleaner.clean() 是 one-shot snapshot——只 hide 當下存在的節點。reader
  // mode 下若使用者捲動觸發新內容 append（例如 popIn template clone 塞新篇
  // 到主文 parent），新節點沒經過 cleaner 流程 → 混入使用者視野。
  //
  // 通則（非站點特判）：reader mode 的不變量是「進入當下的 DOM snapshot 凍
  // 結」，主文祖先鏈（articleEl.parentElement → ... → body）上任何新 append
  // 的節點都是雜訊（真正的主文不會在 reader mode 途中突然擴張）。用
  // MutationObserver 觀察每一層祖先的 childList，新 addedNodes 直接
  // remove。restore 時 disconnect；dynamic 節點不還原（使用者退出 reader
  // mode 重捲會觸發 site 自己的 lazy-load 邏輯重新 inject）。
  //
  // 為何 remove 而非 hide：popIn 從 cleaner 已經 hide 過的 .template 元素
  // clone 時，新節點繼承舊 `data-jread-hidden="1"` attribute，cleaner.hide
  // 的 early-return 會 skip；且 popIn 之後會主動設 display:block 覆蓋任何
  // inline `display: none`。直接 remove 最徹底、最小狀態管理、不跟 popIn
  // 搶 style property。
  let activeObserver = null;

  // articleEl 內部動態 inject 的檢查：只對命中「雜訊特徵」的 node hide，
  // 不動 legit 主文 update（SPA 段落追加 / typo 修正 / lazy 圖片 load）。
  // 雜訊特徵判定：
  //   - class/id 命中 NOISE_KEYWORD_RE（CMS 命名慣例）
  //   - 含 h2/h3/h4 文字命中 NOISE_HEADING_TEXT_RE（跨站 section 標題慣用語）
  function checkDynamicNoise(articleEl, node, hiddenList) {
    if (isInPreserved(node)) return;
    // 雜訊 class/id 直接 hide 整個 node
    if (shouldHideByKeyword(node)) {
      if (node.dataset && node.dataset.jreadHidden === '1') return;
      hide(node, hiddenList);
      return;
    }
    // **所有** interactive button 一律 hide（Jimmy 要求：reader mode 下
    // 任何按鈕都不需要）。delayed lazy-inject 的按鈕走這條。
    if (node.matches && node.matches(
        'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]')) {
      if (node.dataset && node.dataset.jreadHidden === '1') return;
      hide(node, hiddenList);
      return;
    }
    // 遞迴檢查 node 內的 button / a / role=button——new node 可能是包了
    // 雜訊的 wrapper，其內部的 button/a 才帶 class keyword。udn LINE
    // 分享按鈕是 reader mode toggle 後約 3s lazy-inject 的 `<a class=
    // "btn-social--line">`，包在某個 wrapper div 內、wrapper 自己 class
    // 沒命中 keyword，但內部 a 命中——要遞迴檢查。
    if (node.querySelectorAll) {
      for (const btn of node.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]')) {
        if (btn.dataset && btn.dataset.jreadHidden === '1') continue;
        hide(btn, hiddenList);
      }
      for (const a of node.querySelectorAll('a, button')) {
        if (a.dataset && a.dataset.jreadHidden === '1') continue;
        if (!shouldHideByKeyword(a)) continue;
        hide(a, hiddenList);
      }
    }
    // heading text 命中：hide closest section/aside
    const headings = node.matches && node.matches('h2, h3, h4')
      ? [node]
      : (node.querySelectorAll ? Array.from(node.querySelectorAll('h2, h3, h4')) : []);
    for (const h of headings) {
      const text = norm(h.textContent);
      if (!text || text.length > NOISE_HEADING_MAX_LEN) continue;
      if (!NOISE_HEADING_TEXT_RE.test(text)) continue;
      if (isInPreserved(h)) continue;
      const section = h.closest('section, aside');
      if (!section) continue;
      if (section === articleEl) continue;
      if (!articleEl.contains(section)) continue;
      if (section.contains(articleEl)) continue;
      if (section.dataset && section.dataset.jreadHidden === '1') continue;
      hide(section, hiddenList);
      return;
    }
  }

  function startWatchingDynamicAppends(articleEl, hiddenList) {
    if (activeObserver) { activeObserver.disconnect(); activeObserver = null; }
    if (!articleEl || !articleEl.parentElement) return;

    const mo = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (STRUCTURAL_TAGS.has(node.tagName.toLowerCase())) continue;
          if (isInPreserved(node)) continue;

          // 祖先鏈上 append 的 node（articleEl scope 外）：直接 remove 整塊
          // ——那裡不該有任何新內容，全是雜訊（popIn 相似文章 / lazy header
          // / cookie banner 等）。
          if (!articleEl.contains(node)) {
            if (node === articleEl) continue;
            if (node.contains && node.contains(articleEl)) continue;
            if (node.parentNode) node.parentNode.removeChild(node);
            continue;
          }

          // articleEl 內部 append：只對雜訊特徵 node hide，legit 主文 update
          // 保留。場景：LINE Today「其他人也看了」section 在 clean() 之後
          // 才 lazy-load inject 進 swipe-back 內、被 isRelated 放行漏網——
          // 現改成 heading / keyword 特徵判定 hide。
          checkDynamicNoise(articleEl, node, hiddenList);
        }
      }
    });

    // 觀察主文祖先鏈上每一層 parent 的 childList（到 body 為止，含 body）
    let cur = articleEl.parentElement;
    while (cur) {
      mo.observe(cur, { childList: true });
      if (cur === document.body) break;
      cur = cur.parentElement;
    }
    // 新增：觀察 articleEl 本身的 subtree——接 SPA 站晚到的 lazy-load 推薦
    // widget。subtree 涵蓋整棵內部樹；只對新 addedNodes 走雜訊判定不遞迴
    // scan 全樹，效能可控。
    mo.observe(articleEl, { childList: true, subtree: true });
    activeObserver = mo;
  }

  function stopWatchingDynamicAppends() {
    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }
  }

  // ---- 對外介面 ---------------------------------------------------------
  const cleaner = {
    /**
     * 隱藏主文外與主文內的雜訊，回傳還原用的清單。
     * 規則順序：語意標籤 → fixed/sticky → 社群分享 cluster → 主文內 keyword。
     * @param {Element} articleEl 主文容器（必要）
     * @param {Object} [opts] 可選參數
     * @param {Element} [opts.promotedFrom] detector promote 升級前的 el；
     *   若有、跑 narrowPromotedSiblings 把 articleEl 直接子中「不含 content
     *   分支 + 不含 h1 分支」的 sibling chrome hide（ebc 類深層 single-child
     *   wrapper + 橫向 sibling chrome 結構修法）
     * @returns {Array<{el: Element, prevDisplay: string}>} 被隱藏的元素清單
     */
    clean(articleEl, opts) {
      const hidden = [];
      if (!articleEl || articleEl.nodeType !== 1) return hidden;
      // narrow 放最前：promote 升級後 articleEl 變大、需要先把 sibling chrome
      // 清掉、再跑其他 rule。否則後續 hideInsideArticle* 會對 chrome 子樹做
      // 全套檢查、浪費且產生誤殺風險（chrome 裡的 nav / button / list 等 UI
      // 元件可能命中各種 keyword rule、標成 hidden，但本該整塊清掉）。
      // opts.promotedTitleHead（v0.7.21）：detector promote 實際命中的 title
      // heading element（跨 tag h1-h4），narrow guard 會精準保留它的 sibling
      // 分支——Stratechery WordPress block theme 的 h2.wp-block-post-title
      // 在此獲得保護、不被誤認 sibling chrome 清掉。
      if (opts && opts.promotedFrom && opts.promotedFrom !== articleEl) {
        narrowPromotedSiblings(articleEl, opts.promotedFrom, hidden, opts.promotedTitleHead);
      }
      // dialog 放最前：語意最明確，先標掉避免後續規則把它的內部誤判
      hideDialogs(articleEl, hidden);
      hideOutsideArticleSemantic(articleEl, hidden);
      hideFixedOutsideArticle(articleEl, hidden);
      hideSocialShareClusters(articleEl, hidden);
      // 5 條 CONTAINER_SEL 規則共用同一次掃描結果（v0.6.26 效能重構）——
      // 原本各 rule 獨立 querySelectorAll 5 次 article descendant，合併成 1 次。
      // 規則內仍有 `continue` 排除 & `if (dataset.jreadHidden === '1') continue;`
      // 共享 hidden 標記，等同前後鏈接。
      const containers = articleEl.querySelectorAll(CONTAINER_SEL);
      hideInsideArticleByKeyword(articleEl, hidden, containers);
      hideInsideArticleByThirdPartyAds(articleEl, hidden);
      hideInsideArticleByHeadingText(articleEl, hidden);
      hideInsideArticleByLinkText(articleEl, hidden);
      hideInsideArticleByInlineAdText(articleEl, hidden);
      hideInsideArticleFontTags(articleEl, hidden);
      hideInsideArticleCommentPanels(articleEl, hidden);
      hideInsideArticleAllButtons(articleEl, hidden);
      hideInsideArticleActionRows(articleEl, hidden, containers);
      hideInsideArticleButtonClusters(articleEl, hidden, containers);
      hideInsideArticleHorizontalRules(articleEl, hidden);
      hideInsideArticleEmptySpacers(articleEl, hidden, containers);
      hideInsideArticleSidebarColumns(articleEl, hidden, containers);
      // 放最後：先讓精細規則標記，ancestor sibling 才跳過已隱藏者
      hideAncestorSiblings(articleEl, hidden);
      // grid/flex 殘留空欄 collapse：所有前置規則標記完 hidden 後再掃，才能
      // 偵測到「某 child 已被 hide」的條件
      collapseGridWithHiddenCell(articleEl, hidden);
      // articleEl 內部所有 grid/flex container 強制 block + 清 grid-template
      // （BBC 類 styled-components 主文被鎖在固定寬 grid 欄位內）
      collapseInnerGridFlex(articleEl, hidden);
      // 媒體 placeholder：padding-bottom hack vs 純 aspect-ratio 的區分
      resetMediaPlaceholderPadding(articleEl, hidden);
      // Lazy-load 圖片 src 補正：data-src / data-original / srcset → src
      // 放在 reset / collapse 之後，以防前置規則把 img 的 parent hide 掉
      // （被 hide 的 img 不用補、浪費 network 還有 decode 成本）
      hydrateLazyImages(articleEl, hidden);
      // reader mode 進行中持續攔截主文祖先鏈的 dynamic append
      startWatchingDynamicAppends(articleEl, hidden);
      return hidden;
    },

    /**
     * 還原 clean() 所隱藏的元素。
     * @param {Array<{el: Element, prevDisplay: string}>} hiddenEls
     */
    restore(hiddenEls) {
      stopWatchingDynamicAppends();
      restoreLazyImages(hiddenEls);
      restoreMediaResets(hiddenEls);
      restoreInnerGridFlex(hiddenEls);
      restoreCollapsed(hiddenEls);
      if (!Array.isArray(hiddenEls)) return;
      for (const item of hiddenEls) {
        if (!item || !item.el) continue;
        const { el, prevDisplay, prevDisplayPriority } = item;
        // 還原原始 inline display + priority（`!important` 也要還原，
        // 否則原站的 `display: flex !important` 若原本寫在 inline，
        // reader mode 退出後會變成無 priority）。
        el.style.removeProperty('display');
        if (prevDisplay) {
          el.style.setProperty('display', prevDisplay, prevDisplayPriority || '');
        }
        if (el.dataset) delete el.dataset.jreadHidden;
      }
    }
  };

  NS.cleaner = cleaner;
})();
