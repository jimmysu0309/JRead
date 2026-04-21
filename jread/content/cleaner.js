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
  const NOISE_KEYWORD_RE = /(^|[^a-z0-9])(paywall|subscribe|newsletter|signup|promo|promotion|advertisement|sponsored|call-to-action|cta|related-articles|recommended|read-more|share|social|comment|comments|discussion|disqus)([^a-z0-9]|$)/i;
  // ad- / -ad 邊界特例（不可直接放進上面 alternation，否則 2 字母太短會大量誤殺）
  const AD_BOUNDARY_RE = /(^|[-_\s])ad([-_\s]|$)/i;

  // 永不隱藏的保留元素 selector（即使命中 keyword 也跳過，避免 Unclutter 把 <summary> 外移的坑）
  const PRESERVE_SEL = 'summary, figure, figcaption, blockquote';

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

  function isInPreserved(el) {
    return !!(el.closest && el.closest(PRESERVE_SEL));
  }

  function isRelated(articleEl, el) {
    // el 在主文內 / 是主文 / 是主文祖先 → 不能動
    return el === articleEl || articleEl.contains(el) || el.contains(articleEl);
  }

  function hide(el, hidden) {
    if (!el || el.nodeType !== 1) return;
    if (el.dataset && el.dataset.jreadHidden === '1') return; // 已處理過
    hidden.push({ el, prevDisplay: el.style.display });
    if (el.dataset) el.dataset.jreadHidden = '1';
    el.style.display = 'none';
  }

  // ---- 任何位置：ARIA dialog / modal -------------------------------------
  // 結構性通則：W3C ARIA 定義 role="dialog" / "alertdialog" 與 aria-modal="true"
  // 是「對話框/彈窗」的語意標記，依規範**絕不會**出現在正文流程裡——凡帶此語意
  // 都是訂閱彈窗、登入提示、cookie 同意、付費牆 overlay 等雜訊。
  // Substack 的 .subscribeDialog 就是帶 role="dialog" 的 position:absolute 元素，
  // 嵌在 <article> 內部，傳統 fixed/ancestor-sibling 規則都漏掉。
  const DIALOG_SEL = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';

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

  // ---- 主文內：action toolbar（拍手/回應/收藏/分享等互動列）----------------
  // 結構特徵：容器本身無 <p> 直接子、自身文字短、含多個按鈕/圖示元素。
  // Medium / Substack / 部分新聞站的 post footer 互動列都命中此 pattern。
  // 為何限制「自身文字短」：避免誤殺正當的 CTA 卡片（有較長說明文字）。
  // 為何不含 <p> 直接子：避免誤殺內文段落容器。
  const ACTION_TEXT_MAX = 80;
  const ACTION_MIN_ICONS = 2;

  function hideInsideArticleActionRows(articleEl, hidden) {
    const containers = articleEl.querySelectorAll(CONTAINER_SEL);
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

  // ---- 主文內：視覺性空白 spacer ------------------------------------------
  // 結構特徵：容器型元素 + 高度 > 60px + 文字 < 10 字 + 不含任何媒體/互動圖示
  // （img/picture/video/iframe/svg/button）。通常是 Substack / 現代 CSS-in-JS
  // layout 的 visual separator / spacer div，會造成段落與圖片間不自然留白。
  // jsdom 沒 layout，此規則不在 jsdom 測試中生效；真實 Chrome 才命中。
  const SPACER_MIN_HEIGHT = 60;
  const SPACER_TEXT_MAX = 10;

  function hideInsideArticleEmptySpacers(articleEl, hidden) {
    const containers = articleEl.querySelectorAll(CONTAINER_SEL);
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
  function hideInsideArticleByKeyword(articleEl, hidden) {
    // 限定容器型元素；避免誤殺內文標題/段落/圖片
    const candidates = articleEl.querySelectorAll(CONTAINER_SEL);
    for (const el of candidates) {
      if (el === articleEl) continue;
      if (isInPreserved(el)) continue;           // 保留元素內部/本身跳過
      if (!shouldHideByKeyword(el)) continue;
      hide(el, hidden);
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

  function hideInsideArticleSidebarColumns(articleEl, hidden) {
    // whitespace-normalize：真實 Chrome 的 innerText 會 collapse 排版空白，
    // 但 jsdom 的 textContent 把 HTML 縮排/換行全算進去；為了讓 testfixture
    // 與真實頁面量測到同一個 textLen（與 linkDensity 的分母），兩端統一
    // collapse `\s+` 再比對。
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const containers = articleEl.querySelectorAll(CONTAINER_SEL);
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
        if (s.textLen < main.textLen * SIDEBAR_COLUMN_TEXT_RATIO &&
            s.ld > SIDEBAR_COLUMN_MIN_LINK_DENSITY) {
          hide(s.el, hidden);
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
      if (!isGrid && !isFlexRow) continue;
      const children = Array.from(el.children);
      if (children.length < 2) continue;
      // 檢查是否有 direct child 被 hide（我們或 AdBlocker）
      let hasHiddenChild = false;
      for (const c of children) {
        if (c.dataset && c.dataset.jreadHidden === '1') { hasHiddenChild = true; break; }
        const ccs = window.getComputedStyle(c);
        if (ccs.display === 'none' || ccs.visibility === 'hidden') { hasHiddenChild = true; break; }
      }
      if (!hasHiddenChild) continue;
      // 記下 container 的原 inline style 以便 restore
      const containerSnap = {
        el,
        kind: 'container',
        prevDisplay: el.style.display,
        prevDisplayPriority: (el.style.getPropertyPriority && el.style.getPropertyPriority('display')) || '',
        prevGridTemplateColumns: el.style.gridTemplateColumns,
        prevGridTemplateColumnsPriority: (el.style.getPropertyPriority && el.style.getPropertyPriority('grid-template-columns')) || '',
        prevGridTemplateRows: el.style.gridTemplateRows,
        prevGridTemplateRowsPriority: (el.style.getPropertyPriority && el.style.getPropertyPriority('grid-template-rows')) || '',
        prevGridTemplateAreas: el.style.gridTemplateAreas,
        prevGridTemplateAreasPriority: (el.style.getPropertyPriority && el.style.getPropertyPriority('grid-template-areas')) || '',
        prevFlexDirection: el.style.flexDirection,
        prevFlexDirectionPriority: (el.style.getPropertyPriority && el.style.getPropertyPriority('flex-direction')) || ''
      };
      collapsed.push(containerSnap);
      // 用 !important 確保贏過原站的 grid rule（Tailwind 的 `md:grid-cols-*`
      // 等 class 本身 specificity 不是 !important，但多欄定義 rule 可能
      // 有 utility 特殊 priority；保險起見用 important）
      el.style.setProperty('display', 'block', 'important');
      el.style.setProperty('grid-template-columns', 'none', 'important');
      el.style.setProperty('grid-template-rows', 'none', 'important');
      el.style.setProperty('grid-template-areas', 'none', 'important');
      if (isFlexRow) {
        el.style.setProperty('flex-direction', 'column', 'important');
      }
      if (el.dataset) el.dataset.jreadCollapsed = '1';

      // 關鍵：collapse container 只改了父的 display，但 children 身上的
      // Bootstrap `col-md-8` 類 class（`flex: 0 0 66.67%; max-width: 66.67%`）
      // 或 Tailwind `col-span-*` 等 utility 寬度定義**仍會生效**——child 會
      // 維持原來的 N/12 欄寬度，collapse 等於沒做。Lawfaremedia 實測：
      // `.row` 被 collapse 後 `.col-md-8` 仍 405px wide（608 × 66.67%），
      // 主文被擠在左 2/3、右邊 200px 空白。
      // 修法：對 visible 的 direct children 強制 `flex: initial` + `max-width:
      // none` + `width: auto`，讓 children 恢復 block 預設「撐滿父寬度」。
      for (const c of children) {
        if (c.dataset && c.dataset.jreadHidden === '1') continue;
        if (!c.style) continue;
        collapsed.push({
          el: c,
          kind: 'child',
          prevFlexGrow: c.style.flexGrow,
          prevFlexGrowPriority: (c.style.getPropertyPriority && c.style.getPropertyPriority('flex-grow')) || '',
          prevFlexShrink: c.style.flexShrink,
          prevFlexShrinkPriority: (c.style.getPropertyPriority && c.style.getPropertyPriority('flex-shrink')) || '',
          prevFlexBasis: c.style.flexBasis,
          prevFlexBasisPriority: (c.style.getPropertyPriority && c.style.getPropertyPriority('flex-basis')) || '',
          prevWidth: c.style.width,
          prevWidthPriority: (c.style.getPropertyPriority && c.style.getPropertyPriority('width')) || '',
          prevMaxWidth: c.style.maxWidth,
          prevMaxWidthPriority: (c.style.getPropertyPriority && c.style.getPropertyPriority('max-width')) || '',
          prevGridColumn: c.style.gridColumn,
          prevGridColumnPriority: (c.style.getPropertyPriority && c.style.getPropertyPriority('grid-column')) || ''
        });
        // 只用 longhand，避免 shorthand serialization 在不同瀏覽器 / jsdom
        // 不一致。longhand !important inline 能贏過 Bootstrap 的
        // `flex: 0 0 66.67%` shorthand stylesheet rule。
        c.style.setProperty('flex-grow', '0', 'important');
        c.style.setProperty('flex-shrink', '0', 'important');
        c.style.setProperty('flex-basis', 'auto', 'important');
        c.style.setProperty('width', 'auto', 'important');
        c.style.setProperty('max-width', 'none', 'important');
        c.style.setProperty('grid-column', 'auto', 'important');
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
      const { el, kind } = item;
      let props;
      if (kind === 'child') {
        props = [
          ['flex-grow', item.prevFlexGrow, item.prevFlexGrowPriority],
          ['flex-shrink', item.prevFlexShrink, item.prevFlexShrinkPriority],
          ['flex-basis', item.prevFlexBasis, item.prevFlexBasisPriority],
          ['width', item.prevWidth, item.prevWidthPriority],
          ['max-width', item.prevMaxWidth, item.prevMaxWidthPriority],
          ['grid-column', item.prevGridColumn, item.prevGridColumnPriority]
        ];
      } else {
        props = [
          ['display', item.prevDisplay, item.prevDisplayPriority],
          ['grid-template-columns', item.prevGridTemplateColumns, item.prevGridTemplateColumnsPriority],
          ['grid-template-rows', item.prevGridTemplateRows, item.prevGridTemplateRowsPriority],
          ['grid-template-areas', item.prevGridTemplateAreas, item.prevGridTemplateAreasPriority],
          ['flex-direction', item.prevFlexDirection, item.prevFlexDirectionPriority]
        ];
      }
      for (const [name, value, priority] of props) {
        el.style.removeProperty(name);
        if (value) el.style.setProperty(name, value, priority || '');
      }
      if (kind === 'container' && el.dataset) delete el.dataset.jreadCollapsed;
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
        prevPaddingBottom: parent.style.paddingBottom,
        prevPaddingBottomPriority: (parent.style.getPropertyPriority && parent.style.getPropertyPriority('padding-bottom')) || ''
      });
      parent.style.setProperty('padding-bottom', '0', 'important');

      resets.push({
        kind: 'placeholder-media',
        el: media,
        prevPosition: media.style.position,
        prevPositionPriority: (media.style.getPropertyPriority && media.style.getPropertyPriority('position')) || '',
        prevTop: media.style.top,
        prevLeft: media.style.left,
        prevRight: media.style.right,
        prevBottom: media.style.bottom
      });
      // 把 media 從 absolute 解放，讓它照自己的 intrinsic 尺寸流在原位
      // （styler 那邊會套 max-width:100% + height:auto）
      media.style.setProperty('position', 'static', 'important');
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
      const { el, kind } = item;
      if (!el || !el.style) continue;
      if (kind === 'placeholder-parent') {
        el.style.removeProperty('padding-bottom');
        if (item.prevPaddingBottom) {
          el.style.setProperty('padding-bottom', item.prevPaddingBottom, item.prevPaddingBottomPriority || '');
        }
      } else if (kind === 'placeholder-media') {
        el.style.removeProperty('position');
        if (item.prevPosition) el.style.setProperty('position', item.prevPosition, item.prevPositionPriority || '');
        if (item.prevTop) el.style.top = item.prevTop;
        if (item.prevLeft) el.style.left = item.prevLeft;
        if (item.prevRight) el.style.right = item.prevRight;
        if (item.prevBottom) el.style.bottom = item.prevBottom;
      }
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

  function startWatchingDynamicAppends(articleEl) {
    if (activeObserver) { activeObserver.disconnect(); activeObserver = null; }
    if (!articleEl || !articleEl.parentElement) return;

    const mo = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (isRelated(articleEl, node)) continue;
          if (STRUCTURAL_TAGS.has(node.tagName.toLowerCase())) continue;
          if (isInPreserved(node)) continue;
          if (node.parentNode) node.parentNode.removeChild(node);
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
     * @returns {Array<{el: Element, prevDisplay: string}>} 被隱藏的元素清單
     */
    clean(articleEl) {
      const hidden = [];
      if (!articleEl || articleEl.nodeType !== 1) return hidden;
      // dialog 放最前：語意最明確，先標掉避免後續規則把它的內部誤判
      hideDialogs(articleEl, hidden);
      hideOutsideArticleSemantic(articleEl, hidden);
      hideFixedOutsideArticle(articleEl, hidden);
      hideSocialShareClusters(articleEl, hidden);
      hideInsideArticleByKeyword(articleEl, hidden);
      hideInsideArticleActionRows(articleEl, hidden);
      hideInsideArticleEmptySpacers(articleEl, hidden);
      hideInsideArticleSidebarColumns(articleEl, hidden);
      // 放最後：先讓精細規則標記，ancestor sibling 才跳過已隱藏者
      hideAncestorSiblings(articleEl, hidden);
      // grid/flex 殘留空欄 collapse：所有前置規則標記完 hidden 後再掃，才能
      // 偵測到「某 child 已被 hide」的條件
      collapseGridWithHiddenCell(articleEl, hidden);
      // 媒體 placeholder：padding-bottom hack vs 純 aspect-ratio 的區分
      resetMediaPlaceholderPadding(articleEl, hidden);
      // reader mode 進行中持續攔截主文祖先鏈的 dynamic append
      startWatchingDynamicAppends(articleEl);
      return hidden;
    },

    /**
     * 還原 clean() 所隱藏的元素。
     * @param {Array<{el: Element, prevDisplay: string}>} hiddenEls
     */
    restore(hiddenEls) {
      stopWatchingDynamicAppends();
      restoreMediaResets(hiddenEls);
      restoreCollapsed(hiddenEls);
      if (!Array.isArray(hiddenEls)) return;
      for (const item of hiddenEls) {
        if (!item || !item.el) continue;
        const { el, prevDisplay } = item;
        // 寫回原始 inline display（原本是空字串代表走 CSS 預設，維持空字串即可）
        el.style.display = prevDisplay || '';
        if (el.dataset) delete el.dataset.jreadHidden;
      }
    }
  };

  NS.cleaner = cleaner;
})();
