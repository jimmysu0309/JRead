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
      // v1.7.39：隱藏子樹的 <a> 不計入分子。分母 textLen 來自 innerText（真
      // 瀏覽器排除 display:none 子樹），但依 spec「非 render 元素的 innerText
      // 直接回傳 textContent」——候選容器內藏一個 display:none 的下拉導覽選單
      //（mobile nav 常態）時，選單連結文字全進分子、不在分母，density 被灌爆
      //（可 > 1）誤觸 isLinkDirectory 0.5 reject / CONT_MAX_LD 0.3 / heuristic
      // 乘法懲罰（真 Chromium probe 實證 a.innerText 在隱藏子樹非 0）。
      // isAncestorChainHidden 在 withAncestorCache 內成本可控、裸跑亦正確。
      if (isAncestorChainHidden(a)) return;
      linkLen += (a.innerText || a.textContent || '').length;
    });
    return linkLen / textLen;
  }

  // ---- 連結目錄 reject gate（v1.7.8：404 / error 頁 no-op）-----------------
  // 場景（udn「找不到網頁」404 頁實測）：頁面沒有任何文章內容，唯一過
  // MIN_TEXT_LEN 的候選是站台產品選單（8 個 section、h4 標題 + 純連結、無任何
  // 段落）。heuristic 的 linkDensity 懲罰只是乘法折扣——沒有競爭者時選單照樣
  // 勝出、confidence clamp 到門檻必過 → 閱讀模式把整個站台選單當主文渲染
  // （違反「偵測失敗 → no-op、不誤傷原頁面」的降級政策）。
  // 結構訊號（硬規則 3，雙條件必須同時成立才 reject）：
  //   1. 候選內不存在任何 >= 80 chars 的段落載體（p / li / blockquote / dd）
  //      ——文章內文必有段落級文字；導覽選單 / 連結目錄只有短連結文字
  //   2. linkDensity >= 0.5——可見文字一半以上是連結文字（udn 404 選單實測
  //      0.727、真實文章 articleEl 實測 0.24）
  // 只滿足其一不 reject，避免誤殺兩類合法文章：無段落但低連結密度（Paul
  // Graham 型 font+br 純文字老頁，ld≈0）、有段落但連結多（link roundup 文摘，
  // 通常至少有一段 >= 80 chars 的導言 / 註解）。
  const LINK_DIR_MIN_PARA_LEN = 80;
  const LINK_DIR_LD_REJECT = 0.5;
  function isLinkDirectory(el, textLen) {
    if (linkDensity(el, textLen) < LINK_DIR_LD_REJECT) return false;
    for (const p of el.querySelectorAll('p, li, blockquote, dd')) {
      const t = (p.innerText || p.textContent || '').replace(/\s+/g, ' ').trim();
      // v1.7.40：段落門檻改 CJK 權重（批次 2 review D2——raw 80 讓中文 40-79 字
      // 導言不被認作段落，配高連結密度整頁誤 no-op；404 護欄不受影響：選單
      // 連結文字短、權重後仍遠低於門檻，udn 404 頁 probe 實證兩版都 reject）
      if (NS.cjkWeightedLen(t) >= LINK_DIR_MIN_PARA_LEN) return false;
    }
    return true;
  }

  // ---- 接續兄弟區塊（multi-block article）-------------------------------
  // 場景（city.gvm.com.tw 實測，2026-07-23）：CMS 把一篇文章切成多個同層兄弟
  // 容器、中間插廣告區塊（body > 主文塊1 > ad > 主文塊2 > ad > 主文塊3），
  // 唯一共同祖先是 body。detector 任一策略都只選單一容器（第一塊），後續
  // 區塊整段掉出閱讀模式 →「文章被截斷」。對齊 Readability.js 原作的
  // sibling-merge 精神：top candidate 選定後掃描同層兄弟，把「像文章內文」
  // 的區塊併入輸出。判斷全部走 DOM / 文字結構特徵，不綁站點 / class
  // （硬規則 3）。
  //
  // 段落門檻用 CJK 權重 2（對齊 cleaner titleTextWeight 的教訓：raw length
  // 門檻按拉丁校準會誤殺中文——44 字中文段落是完整段落，×2 = 88 過 80）。
  const CONT_MIN_PARA_WEIGHT = 80; // 實質段落的最低權重字數（拉丁 80 字 / CJK 40 字）
  const CONT_MIN_PARAS = 2;        // 至少兩段實質段落才視為文章接續
  const CONT_MAX_LD = 0.3;         // 連結密度上限（真主文實測 ~0.24；相關文章列表 > 0.5）
  const CONT_MAX_HOPS = 2;         // 從 articleEl 沿祖先鏈找「有接續兄弟的層級」的上限
  const CONT_MAX_BLOCKS = 10;      // 吸收數量保險上限
  // v1.8.6：接續區塊的容器 tag 白名單。FONT / CENTER 是老式排版（FrontPage /
  // 純手寫 HTML）包裝內容段落的通用載體——同一份主文常被拆成「body 直屬
  // <font> 包住前半（hero 圖 + 前幾段）」+「<table><td> 包住後半」，heuristic
  // 選 TD 完全正確，前半整塊留在外面被當雜訊清掉。納入 FONT / CENTER 的理由
  // 與 v0.8.82 把 TD 納入 heuristic 候選白名單同源：都是通用 HTML 元素、非
  // 站點特判（硬規則 3），且本函式其餘 gate（>= 2 段實質段落 + 低連結密度 +
  // 總權重門檻 + 負向 class）才是真正的把關者，tag 只是粗篩。
  const CONT_BLOCK_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'FONT', 'CENTER']);

  // v1.7.40：實作上提到 NS.cjkWeightedLen（批次 2 review D2——單一資料源，
  // namespace.js findCardTitleHeading 原本的無權重雙實作一併收斂）。
  const cjkWeightedLen = NS.cjkWeightedLen;

  // v1.7.30 theatlantic 實測：regwall 晚注入的「newsletter 訂閱 + 訂閱雜誌
  // leaflet」aside（含 4 個 p、其中 2 個 >= 100 chars 的說明/法務文字）被本
  // 函式誤認成文章接續區塊吸進 articleEl，之後 cleaner 的 keyword hide 又被
  // 長 p guard（說明 p 130 chars）與 standalone-image guard（雜誌封面圖）
  // 各自豁免 → 訂閱區整包殘留文末。結構性修法：計算實質段落時，落在
  // (a) <aside> 子樹（HTML 語意即「非主文附屬內容」）或 (b) 祖先 class/id
  // 帶雜訊 token（NEGATIVE_RE + 訂閱 CTA 家族）的 p 不計入——這些子樹的
  // 文字不構成「文章接續」證據。祖先鏈只走到候選塊為止。
  const CONT_PARA_EXCLUDE_RE = /newsletter|subscri|signup|sign-up/i;
  function contParaInExcludedSubtree(p, candidate) {
    for (let cur = p; cur && cur !== candidate.parentElement; cur = cur.parentElement) {
      if (cur.tagName === 'ASIDE') return true;
      const m = ((cur.className || '') + ' ' + (cur.id || '')).toLowerCase();
      if (m && (NEGATIVE_RE.test(m) || CONT_PARA_EXCLUDE_RE.test(m))) return true;
      if (cur === candidate) break;
    }
    return false;
  }

  function looksLikeContinuationBlock(el) {
    if (!CONT_BLOCK_TAGS.has(el.tagName)) return false;
    // 負向 class / id（comment / related / sponsor / widget…）直接排除
    const marker = ((el.className || '') + ' ' + (el.id || '')).toLowerCase();
    if (NEGATIVE_RE.test(marker)) return false;
    // 留言區結構特徵：含回覆輸入框
    if (el.querySelector && el.querySelector('textarea')) return false;
    // v1.7.40：總字數 gate 改 CJK 權重（批次 2 review D2——原 raw 200 與下方
    // 段落權重門檻並存：兩段各 45 字中文（權重各 90 過段落門檻）總 raw ~120
    // < 200 整塊被此 gate 擋掉，段落權重白做）。linkDensity 分母維持 raw
    // （分子 <a> 文字也是 raw，同單位相除才有意義）。權重 >= raw 恆成立，
    // 拉丁頁行為不變。
    const text = scoredText(el);
    const textLen = text.length;
    if (cjkWeightedLen(text) < MIN_TEXT_LEN) return false;
    // 高連結密度 = 導覽 / 推薦列表，不是內文接續
    if (linkDensity(el, textLen) > CONT_MAX_LD) return false;
    // 至少 N 段實質段落（p / blockquote / dd）——排除純連結目錄與 UI chrome；
    // aside / 雜訊子樹內的段落不計入（v1.7.30，見 contParaInExcludedSubtree）
    let paras = 0;
    for (const p of el.querySelectorAll('p, blockquote, dd')) {
      const t = ((p.innerText || p.textContent) || '').replace(/\s+/g, ' ').trim();
      if (cjkWeightedLen(t) >= CONT_MIN_PARA_WEIGHT) {
        if (contParaInExcludedSubtree(p, el)) continue;
        paras += 1;
        if (paras >= CONT_MIN_PARAS) return true;
      }
    }
    return false;
  }

  // v1.8.7：裸內容流版型的「群組」路徑。逐個評估（looksLikeContinuationBlock）
  // 整層落空時才跑，判定基礎與前者不同、不共用盲點。
  //
  // 場景（Jimmy 2026-09-03 回報 mdc.idv.tw/mdc/navy/usanavy/E-antiair-SM1.htm
  // 「前半段的圖片都無法顯示」）：同站另一頁把主文前半寫成 **body 直屬的一長
  // 串裸 `<p>`**——圖各一個 `<p>`、圖說各一個 `<p>`，沒有任何容器包住。v1.8.6
  // 的雙向掃描仍是「逐個候選各自過 gate」，單一 `<p>` 永遠湊不出「>= 2 段實質
  // 段落 + 總權重 200」，6 張圖與圖說整批留在 articleEl 外被當雜訊清掉。
  //
  // 通則：這種版型的「一段主文」不是某個容器，而是**同層的一串裸內容元素**。
  // 收成一群、對整群套與逐個評估**同一組** gate（總權重 / 實質段落數 / 連結
  // 密度），語意一致，只是把「容器」換成「兄弟群」。
  //
  // 暴露面限縮在「沒有 wrapper 的老式裸內容流」：成員 tag 只收裸段落載體，
  // **不收 DIV / SECTION / ARTICLE / MAIN 等容器**——容器型兄弟本來就由逐個
  // 評估負責（收進來只是把同一件事做兩次），而現代站的 body-level 兄弟一定是
  // 容器（header / nav / main / footer），本路徑對它們結構性不命中。
  const CONT_FLOW_TAGS = new Set(['P', 'FONT', 'CENTER', 'BLOCKQUOTE', 'PRE']);
  const CONT_MAX_FLOW_MEMBERS = 80; // 群組成員數保險上限（老頁前半實測 14）

  function contMemberLinkLen(el) {
    let n = 0;
    for (const a of el.querySelectorAll('a')) {
      n += ((a.innerText || a.textContent) || '').replace(/\s+/g, ' ').trim().length;
    }
    return n;
  }

  // 群組成員：裸段落載體、非雜訊、有內容（文字或圖）、自身不是導覽 / CTA
  function looksLikeBareFlowMember(el) {
    if (!CONT_FLOW_TAGS.has(el.tagName)) return false;
    const marker = ((el.className || '') + ' ' + (el.id || '')).toLowerCase();
    if (NEGATIVE_RE.test(marker)) return false;
    if (el.querySelector && el.querySelector('textarea')) return false;
    const text = scoredText(el);
    // 空殼 <p>（老頁排版用的間隔）不收——收了也沒內容，只是讓群組變雜
    if (!text.length && !(el.querySelector && el.querySelector('img, picture, video'))) return false;
    // 自身高連結密度 = 頁內導覽列（「（1）（2）（3）」這類），不是內文
    if (text.length && linkDensity(el, text.length) > CONT_MAX_LD) return false;
    return true;
  }

  // 對一群裸內容成員套 looksLikeContinuationBlock 的同一組 gate：整群的總權重、
  // 整群的連結密度、群內「本身就是實質段落」的成員數（每個成員即一段）。
  function bareFlowGroupQualifies(els) {
    if (!els.length) return false;
    let combined = '';
    let linkLen = 0;
    let paras = 0;
    for (const el of els) {
      const t = scoredText(el);
      combined += t + ' ';
      linkLen += contMemberLinkLen(el);
      if (cjkWeightedLen(t) >= CONT_MIN_PARA_WEIGHT) paras += 1;
    }
    const rawLen = combined.replace(/\s+/g, ' ').trim().length;
    if (cjkWeightedLen(combined) < MIN_TEXT_LEN) return false;
    if (rawLen && linkLen / rawLen > CONT_MAX_LD) return false;
    return paras >= CONT_MIN_PARAS;
  }

  // 唯讀識別：不動 DOM。從 articleEl 所在層級開始**雙向**掃 siblings（前後
  // 都掃），該層沒有合格接續區塊才往上一層（articleEl 可能是巢狀 content
  // div、接續區塊在其 wrapper 的兄弟層），上限 CONT_MAX_HOPS。
  //
  // 雙向的理由（v1.8.6）：同一篇主文被站方拆成多個 body-level 區塊時，
  // heuristic 只會選中「文字量最大的那塊」，被漏掉的另一半可能在它**前面**
  // ——mdc.idv.tw 老式 FrontPage 頁實證：hero 圖 + 圖說 + 前 515 字（8 張圖）
  // 在 body 直屬 <font>，主文後半在 <table><td>，detector 選 TD、前半整塊被
  // 當雜訊清掉。單向（只 following）掃描對這種版型結構性失明。雙向也正是
  // Readability.js grabArticle 的 sibling loop 語意（遍歷 topCandidate
  // parent 的所有 children，不分前後）。
  //
  // 掃描遇到「含 h1 的兄弟」即終止：following 方向擋的是瀑布流站 preload 的
  // 下一篇文章（自帶 h1 主標，其後內容屬別篇，不可吸收，對齊
  // narrowToFirstArticleBlock 的邊界語意）；preceding 方向同一條邊界語意
  // ——本文標題 h1 之上是 site chrome（masthead / nav），h1 就是天花板。
  //
  // hop 預算只計「該層真的有兄弟」的層級（v1.8.6）：獨生子 wrapper 層沒有
  // 任何兄弟可掃，往上爬並不擴大語意範圍（wrapper 與其子節點語意等同），
  // 消耗預算只會讓老式深巢套版型（td → tr → tbody → table → center → div
  // 五層獨生鏈，實測 mdc.idv.tw）在真正有兄弟的那層之前就用完預算。
  function findContinuationSiblings(articleEl) {
    return withAncestorCache(() => {
      let base = articleEl;
      let hop = 0;
      while (base && base !== document.body && base !== document.documentElement && hop <= CONT_MAX_HOPS) {
        const parent = base.parentElement;
        // 獨生子層：無兄弟可掃，直接往上且不計 hop（理由見上方註解）
        if (parent && parent.children.length === 1) {
          base = parent;
          continue;
        }
        const picked = new Set();
        // 兩個方向各自獨立評估：一邊的成員湊得出主文，不代表另一邊也是。
        for (const dir of ['prev', 'next']) {
          const sibs = [];
          for (let sib = dir === 'prev' ? base.previousElementSibling : base.nextElementSibling;
               sib;
               sib = dir === 'prev' ? sib.previousElementSibling : sib.nextElementSibling) {
            if (sib.tagName === 'H1' || (sib.querySelector && sib.querySelector('h1'))) break;
            sibs.push(sib);
          }
          // (a) 容器型接續區塊：逐個各自過 gate
          const blocks = [];
          for (const sib of sibs) {
            if (looksLikeContinuationBlock(sib)) {
              blocks.push(sib);
              if (blocks.length >= CONT_MAX_BLOCKS) break;
            }
          }
          // (b) 裸內容流成員：整群一起過同一組 gate（v1.8.7）
          const blockSet = new Set(blocks);
          const flow = [];
          for (const sib of sibs) {
            if (blockSet.has(sib)) continue;
            if (looksLikeBareFlowMember(sib)) {
              flow.push(sib);
              if (flow.length >= CONT_MAX_FLOW_MEMBERS) break;
            }
          }
          for (const el of blocks) picked.add(el);
          // v1.8.7b：(a) 命中不可讓 (b) 短路。同一層裡「容器型接續區塊」與
          // 「散落的裸內容元素」可以並存——mdc.idv.tw/E-antiair-SM2.htm 實證：
          // 前半 26 個裸 <p>（含 8 張圖）之間夾了一個自身就過 gate 的 <center>
          // （含 4 圖 + 737 權重字），舊的「(a) 有命中就 return」讓群組路徑
          // 整個不跑、那 26 個 <p> 全被丟掉（Jimmy 回報「前半截的圖都無法
          // 顯示」，同站第三頁）。兩條路徑收集的是同一層的不同形狀，合併才
          // 是完整的主文；各自仍要過自己那組 gate，不互相放寬。
          if (bareFlowGroupQualifies(flow)) {
            for (const el of flow) picked.add(el);
          }
        }
        if (picked.size > 0) {
          // 依文件序輸出（absorb 依此順序 prepend / append，維持原始閱讀順序）
          const out = [];
          for (const child of parent.children) {
            if (picked.has(child)) out.push(child);
          }
          return out;
        }
        base = parent;
        hop++;
      }
      return [];
    });
  }

  // 進場時由 main.js 呼叫：把接續區塊實際移進 articleEl（文件序不變——原本
  // 排在 articleEl 之後的接到尾端、之前的插到開頭，v1.8.6 雙向掃描後兩種
  // 都可能出現）。els 依文件序傳入，preceding 群逐一 insertBefore 同一個
  // 錨點（articleEl 原本的 firstChild）即自然保持彼此順序。out 累加器逐筆
  // 先記錄再移動：中途 throw 時已移動的每一筆都有紀錄，exit 流程照樣逐筆
  // 移回（對齊 v1.6.27 hiddenEls 累加器教訓）。
  function absorbContinuationSiblings(articleEl, els, out) {
    if (!articleEl || !Array.isArray(els) || !Array.isArray(out)) return;
    const headAnchor = articleEl.firstChild;
    for (const el of els) {
      if (!el || el === articleEl || articleEl.contains(el) || !el.parentElement) continue;
      // el.contains(articleEl) 防護：理論上不該發生（候選是兄弟不是祖先），
      // 但站方腳本可能在 detect 與 absorb 之間搬過 DOM，移進去會斷開 articleEl
      if (el.contains && el.contains(articleEl)) continue;
      const precedes = !!(articleEl.compareDocumentPosition(el) & 2 /* PRECEDING */);
      out.push({ el, parent: el.parentElement, next: el.nextSibling });
      el.setAttribute('data-jread-absorbed-sibling', '1');
      if (precedes && headAnchor && headAnchor.parentNode === articleEl) {
        articleEl.insertBefore(el, headAnchor);
      } else if (precedes) {
        articleEl.insertBefore(el, articleEl.firstChild);
      } else {
        articleEl.appendChild(el);
      }
    }
  }

  // 退出時移回原位。逆序還原：相鄰兩塊都被吸收時（block2.next === block3），
  // 先把 block3 放回、block2 的 insertBefore 錨點才存在。錨點已不在原 parent
  // （站方腳本改過 DOM）時退回 append 至 parent 尾端。
  function restoreAbsorbedSiblings(records) {
    if (!Array.isArray(records)) return;
    for (let i = records.length - 1; i >= 0; i--) {
      const rec = records[i];
      try {
        rec.el.removeAttribute('data-jread-absorbed-sibling');
        const anchor = (rec.next && rec.next.parentNode === rec.parent) ? rec.next : null;
        rec.parent.insertBefore(rec.el, anchor);
      } catch (_) { /* 原位已不存在：節點留在 articleEl 內，不阻斷其餘還原 */ }
    }
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

  // v1.7.15：article 殼卡 guard（Netflix Tudum 實證）。CMS 把「推薦卡片 /
  // header 卡」做成一堆 `<article class="content-card">`（各 0-236 字、無任何
  // <p>），真正的主文段落全在 <article> 之外的 section 裡——article-tag 策略
  // 選中殼卡（header 卡 236 字剛好過 MIN_TEXT_LEN 200）、reader 只剩標題卡＝
  // 「文章大部分被截斷」。列表頁降級（sorted[2] 比較）接不住：其餘卡片都
  // < 200 字、不構成「三篇長度相近」。
  // 結構訊號（不綁站點 / class）：選中的 <article> 內**沒有任何**可見實質
  // 段落（p / blockquote / dd，CJK 權重字數 >= CONT_MIN_PARA_WEIGHT），而
  // 頁面其他可見位置有 >= BODYLESS_MIN_OUT 段 → 該 article 是 teaser 卡、
  // 真主文在別處 → 策略讓位（fall through 到 schema-org / heuristic；Tudum
  // 實測 heuristic 會選到含全部主文段落的 page 容器）。
  // guard 不誤傷的場景：
  //   - 留言比正文長的部落格：article 內有正文段落 → inCount >= 1 直接放行
  //   - 付費牆 teaser（article 內 1-2 段預覽）：同上放行（維持現行為）
  //   - 老站 body 文字在裸 div（無 p）：in/out 都數不到段落 → outCount < 4
  //     不觸發，article-tag 照舊
  //   - cookie / consent 面板長文：display:none → rect 0 → 可見性過濾排除
  // jsdom rect 全 0 → outCount 0 → 恆不觸發（spec 用 stubRect 驗，見
  // tudum-bodyless-article-card.spec.js）。
  const BODYLESS_MIN_OUT = 4;
  function articleIsBodylessCard(el) {
    let outCount = 0;
    for (const p of document.querySelectorAll('p, blockquote, dd')) {
      const t = ((p.innerText || p.textContent) || '').replace(/\s+/g, ' ').trim();
      if (cjkWeightedLen(t) < CONT_MIN_PARA_WEIGHT) continue;
      let r = null;
      try { r = p.getBoundingClientRect(); } catch (_) { r = null; }
      if (!r || r.width <= 0 || r.height <= 0) continue;
      if (el.contains(p)) return false; // 內有實質段落 → 不是殼卡
      outCount += 1;
    }
    return outCount >= BODYLESS_MIN_OUT;
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
      // v1.7.15：殼卡讓位（見 articleIsBodylessCard 註解）
      if (articleIsBodylessCard(el)) return null;
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

    // v1.7.15：殼卡讓位（見 articleIsBodylessCard 註解）——Tudum 場景走的是
    // 本多 article 路徑（41 張 content-card，top = header 卡 236 字）
    if (articleIsBodylessCard(top.el)) return null;

    return { el: top.el, confidence: 0.9, strategy: 'article-tag' };
  }

  // ---- 兜底：<main> 元素 --------------------------------------------
  // 順序擺在 heuristic 之後的兜底。只有當 article/schema.org/heuristic 三者
  // 都沒命中時才採用整個 <main>。
  function detectByMainTag() {
    const main = document.querySelector('main');
    if (!main) return null;
    const textLen = scoredTextLen(main);
    if (textLen < MIN_TEXT_LEN) return null;
    // v1.7.8：<main> 只包導覽選單 / 連結目錄（404 頁常見）→ no-op（見
    // isLinkDirectory 註解）
    if (isLinkDirectory(main, textLen)) return null;
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
  // v1.8.10：schema 標記落在文件根（`<html>` / `<body>`）時不可當主文容器。
  // 場景（forum.ettoday.net /news/1781154 實測）：站點把
  // `<html itemscope itemtype="http://schema.org/NewsArticle">` 掛在根元素
  // 宣告「這份文件是一篇新聞」，Layer A 取最長候選 → `<html>` 必然最長、
  // 永遠勝出 → articleEl = documentElement。後果不是偵測失敗（cleaner 仍
  // 隱藏 chrome、看起來像進了閱讀模式），而是**版心整個失效**：styler 的
  // `html [data-jread-active="1"]` 卡片規則套在 `<html>` 上，max-width /
  // margin auto / padding / 圓角 / 陰影對 root element 都無視覺意義，內文
  // 直接鋪滿 viewport（Jimmy 回報「無法控制版面寬度」）。
  //
  // 通則：itemtype 掛在 root 是「文件層級」宣告（Schema.org 允許、SEO 常見
  // 作法），語意上不指向任何「內容容器」；只有非 root 元素上的 itemtype 才
  // 是容器型標記。排除後自然往下走 Layer B（itemprop="articleBody"）或
  // heuristic，兩者都會選到真正的內層主文容器。與既有 promote / LCA guard
  // 的「不可升到 body / html」是同一條結構性紅線（第 1096、1322 行）。
  function isDocumentRootEl(el) {
    return el === document.documentElement || el === document.body;
  }

  function _detectBySchemaOrgImpl() {
    // Layer A：容器型 itemtype（最精確）
    const typeSelectors = [
      '[itemtype*="NewsArticle" i]',
      '[itemtype*="BlogPosting" i]',
      '[itemtype*="Article" i]'
    ];
    for (const sel of typeSelectors) {
      const candidates = Array.from(document.querySelectorAll(sel))
        .filter(el => !isDocumentRootEl(el));
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
    const bodyCandidates = Array.from(document.querySelectorAll('[itemprop="articleBody"]'))
      .filter(el => !isDocumentRootEl(el));
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
  // blockquote / pre / section) 算基礎 contentScore（文字長度 + 逗號數），把
  // 分數往上累加——parent 拿 100%、grandparent 拿 50%。這樣「主文直系容器」
  // 拿到最高的累積分，而遠祖外殼只拿到很淺的折扣分，自然選對層級。
  //
  // `section` 納入 signal（v0.8.132）：對標 Readability.js 的
  // DEFAULT_TAGS_TO_SCORE = "section,h2,h3,h4,h5,h6,p,td,pre"——它把 <section>
  // 當內文段落計分。場景：微信公眾號文章（mp.weixin.qq.com）整篇內文段落用
  // <section>（外加 <span>）排版、幾乎不用 <p>，`#js_content` 主文容器下只有
  // 個位數 <p>。舊 signal 名單漏掉 <section> → 收不到任何 signal → candidates
  // 空 → heuristic 回 null →「此頁無法偵測本文」。加入後 `#js_content` 以
  // 大幅分差勝出（probe 實證 238.8 vs 第二名 147）。<section> 是 HTML5 通用
  // 語意容器、非站點特判（硬規則 3）；section/p 並存的站點雖會雙重計分，但
  // linkDensity penalty + textLen bonus 仍讓真主文勝出，與 Readability 一致。
  const SIGNAL_SEL = 'p, pre, blockquote, section, h2, h3, h4, li, div';
  const SIGNAL_MIN_TEXT = 25;

  // ---- 裸 div 段落 signal（v1.7.22）---------------------------------------
  // 場景（upmedia.mg /tw/commentary/columnists/262918 實測）：整篇主文的段落
  // 載體是無 class 裸 <div>（.news-box-text 內 42 段、0 個 <p>）。SIGNAL_SEL
  // 原本只認 p / heading / li 等語意標籤 → 主文容器一分都拿不到、根本不進
  // 候選；唯一過 MIN_TEXT_LEN 的候選是含 <p> 的 footer 公司簡介（396 字），
  // heuristic 拍板 footer 後 promoteForTitle 再把容器升到與標題的 LCA =
  // #wrapper，整頁 chrome（header / modal / 廣告 / footer）全被當主文。
  //
  // 通則（Readability.js 原作 div-to-p 同精神）：div 若不含任何 block-level
  // 子元素（只有文字 + inline 標記），結構上就是「拿 div 當 <p> 用」的段落
  // ——納入 signal 計分。含 block 子元素的 div 是容器、不是段落，維持不算
  // signal（否則巢狀 wrapper 會層層自我灌分）。與 v1.7.21 Readwise 匯出端
  // 「通用裸 div 段落 → <p>」同族根因：CMS 拿 div 當段落是跨站慣用結構。
  const SIGNAL_BLOCK_CHILD_RE = /^(DIV|P|SECTION|ARTICLE|UL|OL|LI|TABLE|BLOCKQUOTE|PRE|H[1-6]|FIGURE|ASIDE|HEADER|FOOTER|FORM|DL|HR|NAV|VIDEO|IFRAME)$/;
  function isParagraphLikeDiv(el) {
    for (const c of el.children) {
      if (SIGNAL_BLOCK_CHILD_RE.test(c.tagName)) return false;
    }
    return true;
  }

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
  function scoredText(el) {
    return isAncestorChainHidden(el) ? '' : getText(el);
  }
  function scoredTextLen(el) {
    return scoredText(el).length;
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
      // DIV 只有「段落型」（無 block 子元素）才算 signal——先跑便宜的
      // children 掃再進 isSignalExcluded（後者沿祖先鏈 getComputedStyle 較貴）
      if (el.tagName === 'DIV' && !isParagraphLikeDiv(el)) continue;
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
      // 限定「容器型」元素（避免 li / p 自己也被選為主文）。
      // TD 納入白名單（v0.8.82）：老式 table 排版的內容頁（Paul Graham essays、
      // 早期 blog / newsletter / 純手寫 HTML）把整篇主文放在一個 <td> 裡，內文
      // 段落用 <p> 或 <font>+<br> 呈現。signal 的 bubble-up 會把分數記到 parent
      // /grandparent，這類頁面的 signal <p> 祖先鏈是 P → FONT → TD，grandparent
      // 是 TD——舊白名單只收 DIV/SECTION/MAIN/ARTICLE，TD 被排除 → candidates
      // 為空 → heuristic 回 null → 整頁無法偵測（paulgraham.com/boss.html 實證）。
      // TD 是通用 HTML 容器、非站點特判（硬規則 3）；linkDensity penalty + textLen
      // bonus + class 權重仍會讓真正的內容容器勝出，資料表 / infobox 的高連結密度
      // 小 TD 不會搶贏低連結密度的長文 TD。
      const tag = el.tagName;
      if (tag !== 'DIV' && tag !== 'SECTION' && tag !== 'MAIN' && tag !== 'ARTICLE' && tag !== 'TD') continue;

      const textLen = scoredTextLen(el);
      if (textLen < MIN_TEXT_LEN) continue;

      // v1.7.8：連結目錄候選直接 reject（404 頁站台選單，見 isLinkDirectory
      // 註解）——linkDensity 乘法懲罰在「無競爭者」時擋不住
      if (isLinkDirectory(el, textLen)) continue;

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
  // v1.7.40：實作合一到 NS.normalizeTitle（批次 2 review D3——原本本檔兩份
  // 同名實作已 drift：此處只折標點、markPromotedTitleIfMissing 版多剝 `[...]`）。
  // 折疊語意見 namespace.js；foldTitlePunct 刻意不折破折號，getCanonicalTitle
  // 的站名尾綴 split 仍有效。
  function normalizeTitle(s) {
    return NS.normalizeTitle(s);
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

  // v1.7.40：titleMatches 實作合一到 NS.titleSimilar（批次 2 review D3/D4——
  // 與 markPromotedTitleIfMissing 的 matchesBaseTitle 原是同一份事實的雙實作、
  // 閾值已 drift（8 vs 5）；合一版 containment gate 改 CJK 權重，短中文標題
  // 不再只剩 exact-match 一條路）。
  const titleMatches = NS.titleSimilar;

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
  // （trivial）；(3) maxDist：articleEl 沿 parent 鏈到 LCA 的 hop 數上限（避免遠距
  // LCA 把不相關 chrome 一起吃進來）。傳 maxDist=Infinity 跳過此 guard。
  // v1.6.27 語意明確化：maxDist = 「最多允許幾個 parent hop」。歷史上迴圈寫
  // `dist <= maxDist`、傳 5 實際允許 6 hops（off-by-one），而 6 hops 才是被
  // 幾十版真實站點校準過的行為——改寫為 `dist < maxDist` + 呼叫端傳
  // LCA_PROMOTE_MAX_HOPS = 6，行為逐位元不變、只把「6」寫成明文。
  function findTitleViaLca(articleEl, h, maxDist) {
    if (!articleEl || !h) return null;
    const lca = findLCA(articleEl, h);
    if (!lca) return null;
    if (lca === document.body || lca === document.documentElement) return null;
    if (!lca.contains(articleEl)) return null;
    if (typeof maxDist === 'number' && Number.isFinite(maxDist)) {
      let dist = 0;
      let cur = articleEl;
      while (cur && cur !== lca && dist < maxDist) { cur = cur.parentElement; dist++; }
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
      // v1.7.40：substantial 段落門檻改 CJK 權重（批次 2 review D2——raw 80
      // 讓中文 41-79 字段落全篇不計，誤判 self-titled 跳過 LCA promote）
      if (tag === 'P' && cjkWeightedLen(getText(n)) > 80) return false; // 內文先出現 → 不自帶標題
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

  // v1.7.64：articleEl 外的 H1 候選，依「LCA 與 articleEl 的 parent hop 距離」
  // 由近到遠排序（距離相同時維持 DOM 順序）。
  //
  // 結構通則（與文字 / 語言無關）：文章 hero 標題與主文同屬一個 post 容器
  // ——兩者的 LCA 就在文章自己的殼上，距離近；站名 masthead logo H1 在 page
  // 層 header 內，與主文的 LCA 是整頁 wrapper，距離遠。頁面 DOM 順序則是
  // 「masthead 先於主文」的站佔多數，所以「DOM-order 第一個 H1」在有站名 H1
  // 的站上系統性地指向錯的那顆——原文頁靠 promoteForTitle 的 og-match 文字
  // 比對先接住沒暴露，翻譯擴充把文章標題換成中文後文字比對失效才炸出來
  // （raptitude.com 實證：站名 H1 dist=4 → LCA=DIV#page 把 header + 側欄 +
  // footer 全括進主文；文章 H1 dist=1 → LCA=post 容器正解）。
  //
  // 一併排除「被 <a> 包住的 heading」——卡片連結式標題（推薦 / 相關 / 側欄
  // 文章卡）慣例整顆包在 <a> 裡，與 findSelfTitleHead / promoteForTitle
  // sibling-walk 的既有判準對稱。
  // LCA 一律走 findTitleViaLca helper（單一資料源不變式，forcing spec
  // detector-lca-helper.spec.js）——順帶沿用它的 body/html guard：LCA 落在
  // body 的候選本來就會被 tryLcaPromote 拒絕，這裡先濾掉不影響結果。
  function h1sByLcaDistance(articleEl) {
    const out = [];
    for (const h of document.querySelectorAll('h1')) {
      if (articleEl.contains(h)) continue;
      if (isHeadingInsideAnchor(h)) continue;
      const r = findTitleViaLca(articleEl, h, Infinity);
      if (!r) continue;
      let dist = 0;
      let cur = articleEl;
      while (cur && cur !== r.el) { cur = cur.parentElement; dist++; }
      out.push({ h, dist });
    }
    // Array.prototype.sort 穩定（ES2019 起規範保證）→ 同距離維持 DOM 順序
    out.sort((a, b) => a.dist - b.dist);
    return out.map(o => o.h);
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

    // 本層限制 articleEl 到 LCA 最多 LCA_PROMOTE_MAX_HOPS 個 parent hop（避免
    // articleEl 與 LCA 距離太遠把 site chrome 吞進）。
    // v1.6.27：6 = 歷史校準值（舊寫法 maxDist=5 + off-by-one 迴圈實允許 6 hops，
    // 商周等真實站多版校準以此為前提）。改動此值形同重新校準 detector，必須
    // 全站 probe 重驗；forcing spec 鎖 6（lca-promote-hop-budget.spec.js）。
    const LCA_PROMOTE_MAX_HOPS = 6;
    const tryLcaPromote = (h) => findTitleViaLca(articleEl, h, LCA_PROMOTE_MAX_HOPS);

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

    // 路徑 0（v0.8.58 myartbroker translate-first 修法）：全頁恰好 1 個 H1 且
    // 不在 articleEl 內 → 該 H1 必是文章 hero 標題，升到 LCA（不靠文字比對）。
    //
    // 結構訊號：整頁唯一的 H1 不可能是某一節的副標——section 副標慣例用 H2+，
    // 唯一 H1 = 文章主標。場景：myartbroker「5 幅畫作」這類多節長文，每節是一個
    // 獨立 textblock 容器，heuristic bubble-up（只給 parent/grandparent 2 層分數）
    // 搆不到「裝所有節的文章 body 容器」、只選中第一節的容器。英文原文靠
    // promoteForTitle 的 og-match LCA fallback（dist Infinity、line 896）爬回含 H1
    // 的文章容器；但翻譯擴充把 H1 換中文後 og:title 比對失效 → 卡在單一 section
    // （只剩第一幅畫）。改用「唯一 H1」純結構訊號補這條 translate-first 缺口。
    //
    // 與 path 1 的差異：(a) 不受 articleIsSelfTitled 擋——section 開頭的 H2 副標
    // 會讓 articleIsSelfTitled 誤判 self-titled；(b) dist 放寬到 Infinity（og-match
    // fallback 同樣 Infinity，「全頁唯一 H1」已是強訊號、不需 dist 限制）。
    // 安全保證：findTitleViaLca 仍拒絕 LCA===body/html——唯一 H1 與 articleEl 必須
    // 共享非 body 容器才升，masthead logo H1 在 <header>、主文在 <main> 時 LCA=body
    // 被拒。ChinaTalk（多 H1）/ wya（12 H1）allH1.length !== 1 不觸發此路徑。
    const allH1 = document.querySelectorAll('h1');
    if (allH1.length === 1 && !articleEl.contains(allH1[0])) {
      const r = findTitleViaLca(articleEl, allH1[0], Infinity);
      if (r) return r;
    }

    // 路徑 1：頁面 DOM-order 第一個 H1 不在 articleEl 內 → 升 LCA。
    // self-titled guard：article 開頭已是自己的標題區時，頁面 DOM-first H1 是
    // 站名 masthead logo（非 post hero），升上去會把留言/推薦括進主文。
    //
    // v1.7.64：觸發條件維持「DOM-order 第一個 H1 不在 articleEl 內」（歷史校準
    // 的入口不動），但**升級對象改挑 LCA 距離最近的 H1**——見 h1sByLcaDistance
    // 註解。站名 masthead H1 幾乎必是 DOM-first，照 DOM 順序升等於把整頁
    // wrapper 當主文。
    const firstH1 = document.querySelector('h1');
    if (firstH1 && !articleEl.contains(firstH1) && !articleIsSelfTitled(articleEl)) {
      for (const h of h1sByLcaDistance(articleEl)) {
        const r = tryLcaPromote(h);
        if (r) return r;
      }
    }

    // 路徑 2（原邏輯）：articleEl 完全不含 H1 → 遍歷所有 H1 找 valid LCA。
    // 商周 case（articleEl=SECTION.row 不含 H1，H1.Single-title 在兄弟層）兜底。
    // v1.7.64：同樣改成「距離近的先試」（與 path 1 共用同一份排序事實）。
    if (!articleEl.querySelector('h1')) {
      for (const h of h1sByLcaDistance(articleEl)) {
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
      // v1.6.29 記憶化（#12 效能）：heuristic 策略對候選跑 innerText（強制
      // layout），大頁面單次 probe Chromium 實測 ~35ms。popup 開啟 / SW Readwise
      // 快速鍵流程會在短時間內重複 GET_READER_STATE → 同 href 且 TTL 內直接回
      // 快取。key 含 href（SPA 路由切換即失效）；TTL 短（3s）換取「同 href 下
      // 內容 hydration 改變偵測結果」的暴露窗上限——popup siteMode 最多晚 3s。
      const now = Date.now();
      if (this._probeCache && this._probeCache.href === location.href &&
          (now - this._probeCache.ts) < 3000) {
        return this._probeCache.result;
      }
      let result;
      if (NS.cinema && typeof NS.cinema.isYouTubeWatch === 'function' && NS.cinema.isYouTubeWatch()) {
        result = { siteMode: 'youtube-cinema' };
      } else if (NS.xThread && typeof NS.xThread.isXStatusPage === 'function' && NS.xThread.isXStatusPage()) {
        result = { siteMode: 'x-thread' };
      } else if (NS.fbPost && typeof NS.fbPost.isFacebookPost === 'function' && NS.fbPost.isFacebookPost()) {
        result = { siteMode: 'fb-post' };
      } else {
        // 跑 4 個 read-only 策略；故意不走 detectByShadowDomFallback（會 appendChild
        // 替身、有副作用），shadow DOM 站走 enter reader mode 時才建替身。
        // 已知 UX 不一致（v1.7.42 記錄，刻意取捨不修）：MSN 類 shadow-DOM 站
        // probe 因此回 null → popup 顯示「無法偵測主文」，但實際按 toggle 走
        // 完整 detect()（含 shadow fallback）會成功。popup 開啟不可注入替身
        // 是硬約束，寧可顯示保守於實際能力。
        // v1.7.44 E12：probe 的四策略同樣共用一份祖先鏈 cache（理由同 detect）
        const hit = withAncestorCache(() => (
          detectByArticleTag() ||
          detectBySchemaOrg() ||
          detectByHeuristic() ||
          detectByMainTag()
        ));
        result = { siteMode: (hit && hit.el) ? 'article' : null };
      }
      this._probeCache = { href: location.href, ts: now, result };
      return result;
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
      // v1.7.44 E12：detect 全程共用祖先鏈 cache（withAncestorCache 支援巢狀
      // 沿用——各策略內部的同名包裝直接吃外層 cache）。原本四策略各開各的
      // cache、策略間 + promote / narrow / ensureH1 對同一條祖先鏈重複
      // getComputedStyle。detect 過程唯一 DOM mutation 是 shadow replica
      // appendChild（新節點必 cache miss、既有節點 hidden 狀態不變），cache
      // 正確性不受影響。
      return withAncestorCache(() => this._detectStrategiesAndRefine());
    },

    _detectStrategiesAndRefine() {
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
      // v1.7.13：multi-block 文章的接續兄弟區塊識別（唯讀；main.js 進場時才
      // 真正移動 DOM、退出時移回）。shadow replica 是合成複本、兄弟掃描無
      // 意義，跳過。
      if (result && result.el && result.strategy !== 'shadow-dom-fallback') {
        result.continuationEls = findContinuationSiblings(result.el);
      }
      return result;
    }
  };

  // v0.7.87：把「articleEl 內等同 og:title / docTitle 的 text 元素」標 promoted
  // -title attribute，讓 styler 套大字體標題樣式。通則：站若把標題寫在非
  // h1-h4 tag（newtalk `<p class="name">` / 其他站可能用 `<div class="title">`
  // / `<span class="post-title">` 等），styler 不會自動視覺突顯，需此 promote。
  // v1.7.41（D5）：promote 標題時 hide 原元素——先 snapshot 原 inline display
  //（站方 JS 可能設過 style="display:flex" 之類），存進 data attribute 讓
  // main.js 退出還原時寫回原值；原本無 inline display 的 restore 走
  // removeProperty。舊版一律 setProperty 後 removeProperty 會把站方 inline 值
  // 洗掉、退出後原頁被永久改變——cleaner hide() 一直有 snapshot，這條 path
  // 是「退出完全還原」不變式的缺口。兩個 hide 呼叫點共用（單一資料源）。
  function hidePromotedTitleSource(el) {
    el.setAttribute('data-jread-promoted-title-source', '1');
    if (!el.style || typeof el.style.setProperty !== 'function') return;
    const prev = el.style.getPropertyValue('display');
    if (prev) {
      el.setAttribute('data-jread-prev-display', prev);
      const pri = el.style.getPropertyPriority('display');
      if (pri) el.setAttribute('data-jread-prev-display-priority', pri);
    }
    el.style.setProperty('display', 'none', 'important');
  }

  function markPromotedTitleIfMissing(articleEl) {
    if (!articleEl || !articleEl.querySelectorAll) return;

    // 取 og:title / docTitle 作為比對基準。
    // v1.7.40：實作合一到 NS.normalizeTitle（批次 2 review D3）——本函式比對
    // og:title vs 可見 text element，需先剝 `[...]` site prefix 再折標點
    // （v0.7.251），用 stripBrackets 參數與主 detect path 版區分。
    function normalizeTitle(s) {
      return NS.normalizeTitle(s, { stripBrackets: true });
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
    // v1.7.40：入口 gate 改 CJK 權重（批次 2 review D2/D4 同族——raw 5 讓
    // 4 字中文標題整支函式 bail；權重後 3 字中文（6）即過、2 字（4）仍擋）
    if (!baseTitle || NS.cjkWeightedLen(baseTitle) < 5) return;

    // 文字是否等同 baseTitle。v1.7.40：實作合一到 NS.titleSimilar（批次 2
    // review D3——與 titleMatches 原是雙實作、閾值 drift 8 vs 5；合一後
    // containment gate 統一為 CJK 權重 8，超短 fragment 由 60% 長度比擋）
    const matchesBaseTitle = (t) => NS.titleSimilar(baseTitle, t);

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

    // v0.8.55 nytimes translate-first 修法：bestCand 候選必須「視覺上有呈現」
    // （自身 + 祖先鏈無 display:none / visibility:hidden|collapse / opacity≈0）。
    //
    // 動機：站點常在 site chrome 留「當前文章標題」的隱形副本（NYT sticky
    // masthead `visibility:hidden` + `opacity:1e-09`，捲動後才顯示）。翻譯擴充
    // 只翻可見文字 → 隱形副本維持英文 → 真 h1 已是中文不 match 英文 og:title
    // （上方 heading guard 不收手）、bestCand 卻命中這顆英文隱形副本 → 注入
    // 英文 H1，翻譯擴充的 content guard 再把它譯成另一版中文 → 重複標題。
    //
    // 本 guard 同時閉環 translate-first 兩側：可見的標題副本必然已被翻譯
    // （不會 match 英文 baseTitle、自然落選），不可見的副本被本 guard 排除。
    // 未翻譯頁不受影響——真標題若可見照常入選；只擋「使用者根本看不到的
    // 文字」被拿來當注入來源（注入的存在理由是「站方以非 heading 呈現標題」，
    // 隱形元素不構成呈現）。
    //
    // 不用 getBoundingClientRect 判可見：jsdom fixture rect 全 0 會誤殺；
    // 逐祖先檢查各自的 computed style 即可（不依賴 visibility 繼承解析，
    // jsdom 讀 inline style 也能驗）。display:none 沿用既有共用 predicate。
    function isCandidateVisiblyPresented(el) {
      if (isAncestorChainHidden(el)) return false;
      for (let p = el; p && p !== document.body; p = p.parentElement) {
        if (p.style && (p.style.visibility === 'hidden' || p.style.visibility === 'collapse')) return false;
        try {
          const cs = window.getComputedStyle && window.getComputedStyle(p);
          if (cs) {
            if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
            const op = parseFloat(cs.opacity);
            if (!Number.isNaN(op) && op < 0.05) return false;
          }
        } catch (_) { /* jsdom 等環境部分節點 getComputedStyle 可能拋，忽略 */ }
      }
      return true;
    }

    // 找 articleEl 內含等同 baseTitle 的 text element（精確或包含關係）
    // 限制 textLen 接近 baseTitle，避免命中包含主文整段的大 wrapper
    let bestCand = null;
    let bestScore = 0;
    // v1.7.44 E14 效能：raw textContent 長度粗篩在 normalizeTitle 之前——
    // normalize（多段 regex）對主文級大 wrapper 的整段文字是本函式最大成本。
    // normalize 只會刪字元（折標點 / 收空白），raw < 10 ⇒ normalized < 10；
    // raw 超過 baseTitle×4+40 的元素 normalize 後仍不可能落在 ≤ ×1.5 門檻內
    // （標題載體不會有 60%+ 是可刪空白標點），直接跳過
    const RAW_LEN_CAP = baseTitle.length * 4 + 40;
    for (const el of articleEl.querySelectorAll('p, div, span, h5, h6')) {
      const rawT = el.textContent || '';
      if (rawT.length < 10 || rawT.length > RAW_LEN_CAP) continue;
      const t = normalizeTitle(rawT);
      if (t.length < 10 || t.length > baseTitle.length * 1.5) continue;
      // 包含 baseTitle 60%+ 字元
      let overlap = 0;
      if (t === baseTitle) overlap = 1.0;
      else if (t.includes(baseTitle)) overlap = 0.9;
      else if (baseTitle.includes(t)) overlap = 0.85;
      if (overlap < 0.85) continue;
      // 視覺呈現 guard 放在 overlap 之後（命中才查祖先鏈，省 getComputedStyle）
      if (!isCandidateVisiblyPresented(el)) continue;
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
      // hide 原元素，避免標題重複出現（v1.7.41：snapshot 原 inline display，見 helper）
      hidePromotedTitleSource(bestCand);
      // backward-compat：保留 data-jread-promoted-title attribute 在原元素，
      // 既有 spec 仍找得到（fixture 標題比對等）。
      bestCand.setAttribute('data-jread-promoted-title', '1');

      // v0.8.3：去重——把 articleEl 內其餘「等同 baseTitle 的 leaf 標題載體」
      // 一併 hide，避免 responsive 站把標題做成「desktop / mobile 雙份 span」時
      // inject 後仍殘留另一份可見標題（roomie.tw 實證：mobile-info > span.title
      // 在窄視窗顯示、bestCand 卻挑到 breadcrumb span，iOS 上 inject H1 + mobile
      // span 變成兩個標題）。只清 leaf-ish（後代 element ≤ 2）且文字長度近 baseTitle
      // 的節點——不碰含主文/meta 的大 wrapper，也不碰 inject H1 自己。
      // v1.7.44 E14 效能：後代數 ≤ 2 的判定改 bounded 淺走訪（最多數 3 個
      // 元素即定案），取代對每個元素 materialize 整包 querySelectorAll('*')
      // NodeList 再取 length（大 wrapper 白付整棵掃描）
      const hasAtMostNDescendants = (root, max) => {
        let count = 0;
        const stack = [root];
        while (stack.length) {
          const n = stack.pop();
          for (let c = n.firstElementChild; c; c = c.nextElementSibling) {
            if (++count > max) return false;
            stack.push(c);
          }
        }
        return true;
      };
      for (const el of articleEl.querySelectorAll('h1, h2, h3, h4, h5, h6, p, div, span')) {
        if (el === bestCand) continue;
        if (el.hasAttribute('data-jread-injected-title')) continue;
        if (!hasAtMostNDescendants(el, 2)) continue;
        // 已被 cleaner hide 的不必再碰（不可見、且避免與 cleaner.restore 互踩）
        if (el.closest && el.closest('[data-jread-hidden="1"]')) continue;
        const rawT = el.textContent || '';
        if (rawT.length > RAW_LEN_CAP) continue; // raw 粗篩（理由同上方候選掃描）
        const t = normalizeTitle(rawT);
        if (t.length > baseTitle.length * 1.5) continue;
        if (!matchesBaseTitle(t)) continue;
        hidePromotedTitleSource(el);
      }
    }
  }


  NS.detector = detector;
  // v0.7.87：暴露 markPromotedTitleIfMissing 給 main.js 在 cleaner 跑完後 call
  // （cleaner 已 hide chrome 內的 hidden h1-h4 後，articleEl 內若仍無 visible
  // heading，才 promote 主標）。在 detect() 結尾呼叫時序錯誤——cleaner 還沒
  // 跑、被 hide 的 heading 仍視為 visible，guard 誤觸不 promote。
  NS.detector.markPromotedTitleIfMissing = markPromotedTitleIfMissing;
  // v1.6.27：暴露給 regression spec 行為驗證 hop 預算語意（dist < maxDist）；
  // runtime 無其他呼叫端
  NS.detector.findTitleViaLca = findTitleViaLca;
  // v1.7.13：multi-block 文章接續區塊的移入 / 移回，由 main.js 在 enter /
  // exit 時呼叫（識別本身在 detect() 內唯讀完成、掛 result.continuationEls）
  NS.detector.absorbContinuationSiblings = absorbContinuationSiblings;
  NS.detector.restoreAbsorbedSiblings = restoreAbsorbedSiblings;
})();
