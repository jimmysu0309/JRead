// JRead — X / Twitter status thread reader（v0.7.135）
// X status 頁面（x.com / twitter.com 的 /<user>/status/<digits>）沒主文 article
// 可閱讀：DOM 是 timeline 結構（cellInnerDiv 平鋪：主推文 + 一堆別人 reply +
// 推薦 follow 卡），detector 既有策略會把 8 篇 `<article role="article">` 視為
// 列表頁降級 no-op。
//
// 這個模組短路 detector：站點命中時呼叫 enter() 找主推文 + 同作者連續 thread
// member（往前往後 walk sibling cellInnerDiv，遇到不同作者 / 非 article cell
// 即停止），把這些 article clone 進**合成容器** `<article data-jread-x-reader>`
// 注入 body 開頭，讓 cleaner 的 hideAncestorSiblings 自然清掉所有原 X UI（masthead
// / sidebar / 留言 / 推薦），styler 套讀者卡片排版。
//
// 為什麼用合成容器而不是「以共同祖先為 articleEl + cleaner hide 非 thread cell」：
// 1. thread 跨多個 cellInnerDiv，共同祖先是 timeline section 但裡面混雜 reply /
//    推薦 / ad，靠通用 cleaner 規則無法精準保留 thread member（NS.detector 的
//    article-strategy 已驗證會誤判為列表頁）
// 2. 合成容器讓既有 cleaner / styler / Readwise 流程完全沿用，沒有 X-specific
//    fork：hideInsideArticleAllButtons 砍 reply/retweet/like 按鈕，
//    hideInsideArticleByKeyword 砍 share/social 等子元素，自然乾淨
// 3. 不動原 React 樹，X 的 SPA reconciler 不會反噬；退出時把合成容器 remove 即可
//
// SPA navigation：X 切貼文不 reload，跟 cinema-mode 一樣需要 listener（這版先
// punt——使用者切到別則狀態時手動 toggle off / on 即可，文件註明）。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  const READER_ATTR = 'data-jread-x-reader';
  const AUTHOR_ATTR = 'data-jread-x-author';
  // v1.7.37：longform 標題提升出來的 <h1> 標記（spec forcing / 除錯辨識用）
  const TITLE_ATTR = 'data-jread-x-title';

  // 模組內保留主推文 thread member 的「原 article」參照——enter() 之後 cleaner
  // 會跑過合成容器（會 hide 原 article header 的 wrapper，連帶 avatar / display
  // name / handle 全 rect=0），後續 injectAuthorHeaders() 用此參照重抽 author
  // 資訊建合成 header 插在 cleaner 後（cleaner 看不到 = 不會 hide）。
  let _lastThreadArticles = [];

  function isXStatusPage(url) {
    const target = url || (typeof location !== 'undefined' ? location.href : '');
    try {
      const u = new URL(target);
      // 接受 x.com / twitter.com（含 www. / mobile. / m. 前綴）
      if (!/^(www\.|mobile\.|m\.)?(x|twitter)\.com$/.test(u.hostname)) return false;
      // path: /<username>/status/<digits>（後面可能還接 /photo/1 / /analytics 等）
      return /^\/[A-Za-z0-9_]+\/status\/\d+/.test(u.pathname);
    } catch (_) {
      return false;
    }
  }

  function extractStatusId(url) {
    const target = url || (typeof location !== 'undefined' ? location.href : '');
    const m = target.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  // 取作者 handle（小寫、不含 @ 與斜線）。X article 內第一個 User-Name 區的
  // a[href="/<handle>"] 是作者連結；href 含 /status/ 的 link 是時間戳 / quote
  // indicator 不算。
  function getAuthorHandle(article) {
    if (!article || !article.querySelector) return null;
    const links = article.querySelectorAll('[data-testid="User-Name"] a[href^="/"]');
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      if (href.indexOf('/status/') !== -1) continue;
      const handle = href.replace(/^\//, '').split('/')[0];
      if (handle) return handle.toLowerCase();
    }
    return null;
  }

  function findMainTweet(statusId) {
    if (!statusId) return null;
    const articles = document.querySelectorAll('article[role="article"]');
    for (const a of articles) {
      // 主推文 article 必定含 link 指向 /status/<ID>（時間戳）。其他 reply / 推薦
      // 不含此 status ID 的連結。
      if (a.querySelector(`a[href*="/status/${statusId}"]`)) return a;
    }
    return null;
  }

  // 從主推文 cellInnerDiv 往前往後 walk sibling，同作者連續 cellInnerDiv 視為
  // thread member。遇到「非 cellInnerDiv 兄弟」「無 article」「不同作者」其中
  // 任一就停止那個方向的擴張。
  //
  // 設計理由：X 把 thread 起點以前的同作者推文也 render 在主推文上方（reply
  // chain context），thread 起點以後的同作者推文 render 在下方。中間穿插別人
  // reply / 推薦時，「同作者連續」的條件會在第一個非作者 cell 自然斷掉，避免把
  // 後段同作者但不屬本 thread 的推文（i=7 case）誤納入。
  function collectThreadArticles(mainArticle) {
    if (!mainArticle) return [];
    const mainCell = mainArticle.closest && mainArticle.closest('[data-testid="cellInnerDiv"]');
    if (!mainCell) return [mainArticle];

    const mainAuthor = getAuthorHandle(mainArticle);
    if (!mainAuthor) return [mainArticle];

    const articles = [mainArticle];

    // 往前 walk：thread 起點以前的同作者推文
    let prev = mainCell.previousElementSibling;
    while (prev && prev.getAttribute && prev.getAttribute('data-testid') === 'cellInnerDiv') {
      const art = prev.querySelector('article[role="article"]');
      if (!art) break;
      if (getAuthorHandle(art) !== mainAuthor) break;
      articles.unshift(art);
      prev = prev.previousElementSibling;
    }

    // 往後 walk：thread 主推文以後的同作者連續推文
    let next = mainCell.nextElementSibling;
    while (next && next.getAttribute && next.getAttribute('data-testid') === 'cellInnerDiv') {
      const art = next.querySelector('article[role="article"]');
      if (!art) break;
      if (getAuthorHandle(art) !== mainAuthor) break;
      articles.push(art);
      next = next.nextElementSibling;
    }

    return articles;
  }

  // 從原 article 抽 author 顯示資訊：display name / handle / avatar src。
  // 在 enter() 拿到原 article 時抽（cloneNode 後的 DOM 也能抽，但保持一致性
  // 從原 article 取——src 可能含 React-managed lazy 屬性）。
  function extractAuthorInfo(article) {
    if (!article || !article.querySelector) return null;
    let displayName = null;
    let handle = null;
    const userName = article.querySelector('[data-testid="User-Name"]');
    if (userName) {
      // User-Name 內所有 span：第一個非 "@" 開頭文字當 displayName，
      // 第一個 "@" 開頭當 handle。textContent 短於 60 才接受（避開誤抓推文本文）。
      const spans = userName.querySelectorAll('span');
      for (const s of spans) {
        const t = (s.textContent || '').trim();
        if (!t || t.length > 60) continue;
        if (!handle && /^@\S+$/.test(t)) {
          handle = t;
        } else if (!displayName && !t.startsWith('@')) {
          displayName = t;
        }
        if (displayName && handle) break;
      }
    }
    let avatarSrc = null;
    const avatarEl = article.querySelector('div[data-testid^="UserAvatar-"]');
    if (avatarEl) {
      const img = avatarEl.querySelector('img');
      if (img) avatarSrc = img.getAttribute('src') || img.src || null;
    }
    return { displayName, handle, avatarSrc };
  }

  // 建合成 author header：用 data-attr 不用 class（避開 cleaner 的 class-based
  // keyword rule，雖然此函式在 cleaner 跑完才呼叫不會被 hide，但 styler /
  // 未來規則仍可能掃 class——data-attr 從根本繞過所有 class 命中路徑）。
  // 結構單純（header > img + div(strong/span)）：避開 hideInsideArticleAllButtons
  // （無 button）、hideInsideArticleAbsoluteOverlays（無 position absolute）、
  // hideInsideArticleCommentPanels（無時間戳，不會觸發相對時間配額）。
  function createAuthorHeader(info) {
    const h = document.createElement('header');
    h.setAttribute(AUTHOR_ATTR, '1');
    h.style.cssText = 'display:flex;align-items:center;gap:12px;margin:1.4em 0 0.6em;';

    if (info.avatarSrc) {
      const img = document.createElement('img');
      img.setAttribute('data-jread-x-avatar', '1');
      img.src = info.avatarSrc;
      img.alt = '';
      img.style.cssText = 'width:48px;height:48px;border-radius:50%;flex:0 0 auto;display:block;';
      h.appendChild(img);
    }

    const meta = document.createElement('div');
    meta.style.cssText = 'display:flex;flex-direction:column;line-height:1.3;min-width:0;';
    if (info.displayName) {
      const strong = document.createElement('strong');
      strong.textContent = info.displayName;
      strong.style.cssText = 'font-size:1.05em;';
      meta.appendChild(strong);
    }
    if (info.handle) {
      const span = document.createElement('span');
      span.setAttribute('data-jread-x-handle', '1');
      span.textContent = info.handle;
      span.style.cssText = 'opacity:0.65;font-size:0.92em;';
      meta.appendChild(span);
    }
    if (meta.children.length) h.appendChild(meta);

    return h;
  }

  // v0.7.160：X 推文 / Article 內圖片多層 wrapper 解纏。
  //
  // X 把圖片包在多層 emotion-styled wrapper 裡（padding-bottom 比例 hack +
  // absolute 子 + overflow:hidden）。普通推文是 `<div data-testid="tweetPhoto">`
  // 為最外層 wrapper；X Article（twitterArticleReadView）則 tweetPhoto 是
  // 內層、外層另有 `r-1p0dtai` / `r-1adg3ll` 等比例 wrapper。
  //
  // 兩種結構的共通點：**每張圖被一個 `<a href="/photo/N">` link 包圍**（X 點圖
  // 開大圖的 anchor），這個 a 是「最接近 img 且唯一識別 photo 的祖先」。
  //
  // 修法：找 article 內每個 `a[href*="/photo/"]`，把它整段 replaceWith
  // `<figure><img></figure>`。figure 是 PRESERVE_SEL 內 tag，cleaner 對 figure
  // 內部 hide rule 自動 skip；styler 對 figure / img 已有現成排版規則
  // （max-width: 100%、height: auto、置中）。同時 removeAttribute('style')
  // 清原站 inline position:absolute / top / left / filter:blur 等 lazy-load
  // placeholder 樣式。
  //
  // cleaner 副作用避免：figure 插入後其外層仍是 X 的 absolute / aspect-ratio
  // wrapper（emotion class），若被 hideInsideArticleAbsoluteOverlays 命中會
  // 連帶 hide figure。X article 主文流是 `<div[twitterArticleReadView]>` 直接
  // child（文字段落 / 圖片 wrapper 平鋪），圖片 wrapper 自身 position:absolute
  // 配 padding-bottom 比例撐 h；hide 後 figure 雖 preserve 但 ancestor display:
  // none 仍會 0×0 不可見。額外處理：圖片 wrapper 往上 walk 找 article direct
  // child 祖先，整段 replace 成 figure，避免任何中介 wrapper 殘留。
  function unwrapTweetMedia(clone) {
    if (!clone || !clone.querySelectorAll) return 0;
    let unwrapped = 0;
    // 對每個 tweetPhoto 找最近的「a + img wrapper」當 unwrap 對象：
    //   普通 X 推文：a[href*="/photo/"] 直接包 img、tweetPhoto 在更外層
    //   X Article：a[href*="/article/"] 是「圖片可點擊版」、tweetPhoto 在更內層
    // 共通：從 tweetPhoto 開始 bidirectional walk —— 內找 img、外找最近祖先 a
    // （該 a 含此 img、不含 tweetText、不含 UserAvatar），用該 a 當 unwrap
    // 起點。若沒外層 a，直接拿 tweetPhoto 做 unwrap target。
    const tweetPhotos = clone.querySelectorAll('[data-testid="tweetPhoto"]');
    for (const tp of tweetPhotos) {
      const img = tp.querySelector('img');
      if (!img) continue;
      // 從 tp 往外找最近的 a（停在 clone 邊界）
      let target = tp;
      let cur = tp.parentElement;
      while (cur && cur !== clone) {
        if (cur.tagName === 'A') {
          // 確認 a 不含 tweetText（不跨段落）
          if (!cur.querySelector('[data-testid="tweetText"]')) {
            target = cur;
          }
          break;
        }
        cur = cur.parentElement;
      }
      // 抽 img、清 inline style（含 position:absolute / top / left / blur）
      img.removeAttribute('style');
      // v0.7.161：X stylesheet 對 `img.css-9pa8cd` 套 `opacity: 0` 當 lazy-load
      // placeholder，由 React 在實際載入完成後 fade-in 到 1。cloneNode 不複製
      // React event handler、fade-in 永不觸發、img 永遠透明（DOM 完美但視覺空白）。
      // 用 inline !important 直接覆寫 stylesheet rule（specificity 必勝）。
      img.style.setProperty('opacity', '1', 'important');
      img.setAttribute('data-jread-x-tweet-photo', '1');
      const fig = clone.ownerDocument.createElement('figure');
      fig.setAttribute('data-jread-x-media', '1');
      fig.appendChild(img);
      target.replaceWith(fig);
      unwrapped++;
    }
    // v0.7.174：hoist figures out of X's aspect-ratio hack wrapper chain.
    // replaceWith 後 figure 仍卡在多層 wrapper（height:0 + overflow:hidden +
    // position:absolute）裡被裁切不可見。X article 結構是單一大 wrapper 包所有
    // 內容（header / tweetText / media / buttons / timestamp），media 跟 tweetText
    // 是同級兄弟。找到 media 所在的 branch（跟 tweetText 同層級的 div），把
    // figure 搬到該 branch 之前、移除空殼。
    const figs = clone.querySelectorAll('figure[data-jread-x-media]');
    if (figs.length) {
      let mediaRoot = null;
      let cur = figs[0];
      while (cur && cur !== clone) {
        const parent = cur.parentElement;
        if (!parent) break;
        const siblings = parent.children;
        let hasTweetTextSibling = false;
        for (let i = 0; i < siblings.length; i++) {
          const sib = siblings[i];
          if (sib === cur) continue;
          if (sib.getAttribute('data-testid') === 'tweetText' ||
              sib.querySelector('[data-testid="tweetText"]')) {
            hasTweetTextSibling = true;
            break;
          }
        }
        if (hasTweetTextSibling) { mediaRoot = cur; break; }
        cur = cur.parentElement;
      }
      if (mediaRoot && mediaRoot.parentElement &&
          !mediaRoot.hasAttribute('data-jread-x-media')) {
        const parent = mediaRoot.parentElement;
        for (const fig of figs) {
          parent.insertBefore(fig, mediaRoot);
        }
        mediaRoot.remove();
      }
    }
    return unwrapped;
  }

  // v1.0.0：X 推文 clone 為翻頁模式正規化 layout。
  // X 把推文內容包在多層 flex 容器、最外層 <article> 還帶 overflow:hidden。
  // styler 翻頁模式（pagedMode）用 CSS 多欄（column-width）切頁，兩種 X 結構特性
  // 都會破壞跨欄分頁：
  //   (1) flex / grid 容器不會把子內容跨欄分裂（整塊當一個 fragmentation box）
  //   (2) overflow 非 visible 的元素是 monolithic box，CSS columns 規範上不可被
  //       欄邊界分裂——X 的推文 <article overflow:hidden> 即此類
  // 結果：「內容高於單欄」的長推文（長文 + 多圖）整塊被推到第 2 欄，page 1 只剩
  // 合成作者頭 + 一大片空白，且該塊寬度不受欄寬約束、右側溢出被 card overflow-x
  // hidden 裁掉（cage rect 實證：reader card 可視 x160–880，內容卻整塊落在
  // x936–1544 被切；overflow:hidden 的 X <article> 是主因）。
  // 修法：把 clone 內所有容器中和為 display:block + overflow:visible，讓推文內容
  // 像一般 article 散文流自然跨欄分頁、受欄寬約束（cage 驗證：text 回 column 1、
  // 圖各自分到後續頁、page 1 恢復「作者頭 + 全文」可讀）。img / figure 不動——
  // 媒體排版交給 styler（max-width:100% / height:auto / 置中）、img 自身
  // overflow:clip 是 leaf 不影響分欄。clone 退出時整個合成容器 remove、無 restore
  // 顧慮（exit() 直接 c.remove()）。結構性訊號（computed display / overflow），
  // 非站點 class 特判——此檔本就是 X 專屬模組。
  function normalizeCloneForPaging(container) {
    if (!container || !container.querySelectorAll) return 0;
    const win = container.ownerDocument && container.ownerDocument.defaultView;
    if (!win || !win.getComputedStyle) return 0;
    let n = 0;
    for (const el of container.querySelectorAll('*')) {
      if (el.tagName === 'IMG' || el.tagName === 'FIGURE') continue;
      const cs = win.getComputedStyle(el);
      const d = cs.display;
      if (d === 'flex' || d === 'inline-flex' || d === 'grid' || d === 'inline-grid') {
        el.style.setProperty('display', 'block', 'important');
        n++;
      }
      if (cs.overflow !== 'visible') {
        el.style.setProperty('overflow', 'visible', 'important');
        n++;
      }
    }
    return n;
  }

  // v1.7.37：X longform（Articles）文章標題提升成真 <h1>。
  //
  // Bug（Jimmy 2026-08-04 回報 x.com/thedankoe/status/2081415714636996844）：
  // longform 貼文「進閱讀模式抓不到標題，送 Readwise 也沒送對標題」。cage 實測
  // 登入態 DOM：
  //   - 標題是 div[data-testid="twitter-article-title"] > span，34px/800 由 X
  //     自家 stylesheet 給，**不是 heading tag**
  //   - 它在 article[role="article"] 內，所以 clone 有帶進合成容器、也沒被
  //     cleaner 標隱藏——但 styler 的 typography override 把它當內文渲染
  //     （實測 17px / 400 / display:inline，與段落無異）＝ 使用者眼中「沒有標題」
  //   - 合成容器內零個 <h1>，而 longform 的 <h2> 是**內文章節**標題 →
  //     NS.findCardTitleHeading 退到第 2 步「取內文前首個 h2」，抓到章節標題
  //     「How to actually learn anything fast」送去 Readwise
  //   - document.title 在登入態是**空字串**，fallback 也救不了
  //
  // 兩個症狀是同一根因：文章標題沒有 heading 語意。轉成真 <h1> 一次解決兩邊
  // ——styler 的 titleFontSize 規則自然套上（視覺回來），findCardTitleHeading
  // 第 1 步就命中（Readwise 拿到正確標題），不必在通用邏輯裡開 X 分支。
  //
  // 為什麼可以用 data-testid：本檔是 site module（CLAUDE.md 硬規則 3 允許站點
  // 特判放在明確隔離的模組），且 X 的 class 全是 hash、testid 是唯一穩定的語意
  // 載體（同 Substack recommendation 的判例）。非 longform 推文沒有這個 testid，
  // 整段 no-op、對既有推文 thread 行為零影響。
  function promoteArticleTitle(clone) {
    if (!clone || !clone.querySelector) return false;
    const el = clone.querySelector('[data-testid="twitter-article-title"]');
    if (!el || el.tagName === 'H1') return false;
    // 只認有文字的標題——空殼 div 轉 h1 會讓 findCardTitleHeading 拿到空字串，
    // 反而比 fallback 更糟
    if (!(el.textContent || '').trim()) return false;
    const doc = clone.ownerDocument || document;
    const h1 = doc.createElement('h1');
    h1.setAttribute(TITLE_ATTR, '1');
    // 搬 childNodes 而非 textContent：保留 X 標題內的 inline 結構（span /
    // emoji img），與 styler 對 h1 子樹的處理相容
    while (el.firstChild) h1.appendChild(el.firstChild);
    if (el.parentNode) el.parentNode.replaceChild(h1, el);
    return true;
  }

  function enter() {
    const existing = document.querySelector('[' + READER_ATTR + ']');
    if (existing) return existing;

    const statusId = extractStatusId();
    const mainArticle = findMainTweet(statusId);
    if (!mainArticle) return null;

    const threadArticles = collectThreadArticles(mainArticle);
    _lastThreadArticles = threadArticles;

    // 合成 reader card：直接用 <article> tag 讓 detector 既有「article-tag」
    // 偵測語意一致；放 body 開頭，下方所有原 X DOM 變成兄弟，自然被
    // hideAncestorSiblings 清掉。
    const container = document.createElement('article');
    container.setAttribute(READER_ATTR, '1');
    const lang = document.documentElement.getAttribute('lang');
    if (lang) container.setAttribute('lang', lang);

    for (const art of threadArticles) {
      // cloneNode(true)：深 clone 含 tweetText / 圖片 src / User-Name / 時間戳。
      // React event 不會 clone 過來，但純閱讀模式不需要互動（reply / retweet
      // / like 按鈕被 cleaner 的 hideInsideArticleAllButtons 砍掉）。
      // 原 X header（avatar + name + handle）clone 進來後會被 cleaner 的祖先
      // wrapper hide rule 連帶 hide（rect=0）——此檔的 injectAuthorHeaders()
      // 在 cleaner 跑完後重建合成 header 補回 author 顯示。
      const clone = art.cloneNode(true);
      unwrapTweetMedia(clone);
      // v1.7.37：longform 標題轉 <h1>（見 promoteArticleTitle 註解）。必須在
      // normalizeCloneForPaging 之前——後者用 getComputedStyle 中和 display，
      // 換過 tag 才不會把舊 div 的 computed 值套到已消失的節點上
      promoteArticleTitle(clone);
      container.appendChild(clone);
    }

    document.body.insertBefore(container, document.body.firstChild);
    // 插入後（live DOM、X stylesheet 已對 clone 的 class 生效）才能 getComputedStyle
    // 偵測 flex / overflow → 中和成可跨欄分頁的 block。在 cleaner / styler 之前跑、
    // inline !important 持續整個 reader 生命週期。
    normalizeCloneForPaging(container);
    return container;
  }

  // 在 cleaner 跑完後呼叫（main.js enterXThreadMode 流程）——cleaner 看不到
  // 此函式注入的 synthetic header，不會被它的 rule 命中。styler 之後跑時
  // header 仍是合成容器的 direct child，typography 正常繼承。
  function injectAuthorHeaders() {
    const container = document.querySelector('[' + READER_ATTR + ']');
    if (!container) return 0;
    const articleClones = container.querySelectorAll(':scope > article');
    let injected = 0;
    for (let i = 0; i < articleClones.length && i < _lastThreadArticles.length; i++) {
      const source = _lastThreadArticles[i];
      const info = extractAuthorInfo(source);
      if (!info || (!info.displayName && !info.handle && !info.avatarSrc)) continue;
      const header = createAuthorHeader(info);
      container.insertBefore(header, articleClones[i]);
      injected++;
    }
    return injected;
  }

  function exit() {
    const containers = document.querySelectorAll('[' + READER_ATTR + ']');
    containers.forEach(c => c.remove());
    _lastThreadArticles = [];
  }

  function isActive() {
    return !!document.querySelector('[' + READER_ATTR + ']');
  }

  NS.xThread = {
    isXStatusPage,
    extractStatusId,
    getAuthorHandle,
    findMainTweet,
    collectThreadArticles,
    extractAuthorInfo,
    createAuthorHeader,
    unwrapTweetMedia,
    normalizeCloneForPaging,
    promoteArticleTitle,
    enter,
    injectAuthorHeaders,
    exit,
    isActive,
    READER_ATTR,
    AUTHOR_ATTR,
    TITLE_ATTR
  };
})();
