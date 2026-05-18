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

  function enter() {
    const existing = document.querySelector('[' + READER_ATTR + ']');
    if (existing) return existing;

    const statusId = extractStatusId();
    const mainArticle = findMainTweet(statusId);
    if (!mainArticle) return null;

    const threadArticles = collectThreadArticles(mainArticle);

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
      const clone = art.cloneNode(true);
      container.appendChild(clone);
    }

    document.body.insertBefore(container, document.body.firstChild);
    return container;
  }

  function exit() {
    const containers = document.querySelectorAll('[' + READER_ATTR + ']');
    containers.forEach(c => c.remove());
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
    enter,
    exit,
    isActive,
    READER_ATTR
  };
})();
