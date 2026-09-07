// JRead — 連結延續閱讀模式 helper（v1.6.14）
// 共用於 content script（main.js click wire-up + 目標頁載入比對）、regression spec（直接 require）。
//
// 需求（Jimmy 2026-07-07）：在閱讀模式下點文內連結，目標頁——不論在原分頁還是新分頁——
// 自動進入閱讀模式。
//
// 機制（結構性、非站點特判，符合 CLAUDE.md 硬規則 3）：
//   1. 閱讀模式下點 <a href>（真導航、非 SPA 攔截）→ 記一筆「link intent」（目標 URL + 時戳）
//      到 storage.local。同分頁換頁與新分頁（cmd/ctrl/中鍵/target=_blank）都會落在**同一個
//      目標 URL**，故不需區分開哪種，共用同一條 token path。
//   2. 目標頁 content script 載入（document_idle）時比對 location.href 是否命中一筆 fresh intent，
//      命中就消費該筆並 silent 進閱讀模式（偵測失敗 no-op，不彈 toast）。
//
// 純決策 / intent list 讀寫抽此模組（forcing spec：test/regression/link-follow.spec.js）；
// storage 副作用與 DOM 事件綁定留在 main.js。
//
// 為何只認整頁導航、不含 SPA 內部路由：SPA router 會對連結 click preventDefault，main.js 在
// bubble phase 讀 e.defaultPrevented=true 即跳過記錄——SPA 路由變化由 main.js 既有 wasActive
// 路徑（跨路由保留閱讀意圖）處理，不重複。
//
// 為何只認 http(s)：javascript: / mailto: / tel: / blob: / 擴充自有頁（reader/article.html）
// 都不是「跳到另一篇文章」的導航，一律不記。
//
// 跨環境匯出：content script 走 window 全域、Node require 走 module.exports。
(function (global) {
  'use strict';

  // intent 效期：90s（點完連結到目標頁 content script 載入完成的合理上限；過期即剪掉，
  // 避免殘留 intent 讓「很久之後剛好導到同 URL」誤觸發）。
  var MAX_AGE_MS = 90 * 1000;
  // list 上限：連續 cmd-click 開多分頁會累積多筆；cap 防 storage.local 無限膨脹
  //（memory：iOS storage.local 滿會讓閱讀位置記憶靜默失效——本 list 短效期 + cap 自剪、不長存）。
  var MAX_ENTRIES = 20;

  // 正規化比對 key：origin + pathname + search，去 hash（錨點不影響「是哪一頁」）、
  // 去 pathname 結尾多餘斜線（'/a/' 與 '/a' 視為同頁）。解析失敗回原字串（best-effort）。
  function normalizeIntentUrl(url) {
    try {
      var u = new URL(url);
      var path = u.pathname.replace(/\/+$/, '') || '/';
      return u.origin + path + u.search;
    } catch (_) {
      return String(url == null ? '' : url);
    }
  }

  // 判斷一次 click 是否該記錄成 link intent。回傳 { record: bool, url: normalizedUrl|null }。
  // info 欄位：
  //   button           e.button（0 = 左鍵 / 1 = 中鍵；其餘不記）
  //   altKey           alt-click 慣例為下載連結，不記
  //   defaultPrevented 站點 JS 已接手（SPA router 等）→ 不記
  //   href             <a> 的絕對 href（a.href）
  //   currentHref      location.href（判同頁錨點用）
  //   hasDownload      <a download> 存在（檔案下載，非導航文章）
  function shouldRecord(info) {
    var no = { record: false, url: null };
    if (!info) return no;
    if (info.defaultPrevented) return no;
    if (info.hasDownload) return no;
    if (info.button !== 0 && info.button !== 1) return no; // 只認左 / 中鍵導航
    if (info.altKey) return no;
    var href = info.href;
    if (!href) return no;
    var proto;
    try { proto = new URL(href).protocol; } catch (_) { return no; }
    if (proto !== 'http:' && proto !== 'https:') return no;
    // 同頁錨點（只差 hash）不算導航
    if (normalizeIntentUrl(href) === normalizeIntentUrl(info.currentHref || '')) return no;
    return { record: true, url: normalizeIntentUrl(href) };
  }

  // 剪掉過期 / 壞掉的 entry
  function pruneList(list, now) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (e) {
      return e && typeof e.url === 'string' && typeof e.ts === 'number' && (now - e.ts) <= MAX_AGE_MS;
    });
  }

  // 把一筆 url 加進 intent list（先剪過期 → 去重同 url → append → cap 上限）。回傳 next list。
  function addIntent(list, url, now) {
    var arr = pruneList(list, now);
    arr = arr.filter(function (e) { return e.url !== url; }); // 去重（同 url 更新為最新 ts）
    arr.push({ url: url, ts: now });
    if (arr.length > MAX_ENTRIES) arr = arr.slice(arr.length - MAX_ENTRIES);
    return arr;
  }

  // 目標頁載入時比對：currentHref 是否命中一筆 fresh intent。
  // 回傳 { matched, nextList }——nextList 已消費命中 entry + 剪過期（呼叫端寫回 storage）。
  function consumeMatch(list, currentHref, now) {
    var arr = pruneList(list, now);
    var key = normalizeIntentUrl(currentHref);
    var idx = -1;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].url === key) { idx = i; break; }
    }
    if (idx === -1) return { matched: false, nextList: arr };
    var next = arr.slice(0, idx).concat(arr.slice(idx + 1));
    return { matched: true, nextList: next };
  }

  // ---- 內容圖連結（lightbox 觸發器）點擊吞掉（v1.9.2）------------------------
  // 需求（Jimmy 2026-09-07，culpium.com / Substack）：閱讀模式下點內文圖片 → 滑鼠滾輪捲頁
  // 失效；退出閱讀模式後才看到那張圖被放大成全螢幕。
  //
  // 根因（real DOM probe）：站方 lightbox 是 click 時往 <body> 追加的 portal（overlay div +
  // 兩個 focus-guard span），落在 articleEl 外 → cleaner 動態 observer 照規則把它藏掉；但站方
  // 同時裝上的 scroll lock（document 層 wheel preventDefault）與 focus trap 沒有人解——使用者
  // 看不到 lightbox、關不掉、也捲不動。退出閱讀模式 restore 後 lightbox 才露出來。
  //
  // 結構性通則：閱讀模式下「主文內、包住圖片、href 指向圖檔」的 <a> 點擊不交給站方——
  //   - 站方 JS lightbox 的產物一律掛在主文外、閱讀模式下永遠看不見，只剩副作用
  //   - 沒有 JS 時原生導航到圖檔 URL 也不是閱讀動作（離開文章、原分頁被整張圖取代）
  // 兩條路徑都沒有正向價值，故直接吞掉（preventDefault + stopImmediatePropagation，在
  // window capture 階段、早於站方 root 委派 handler）。只吞**純左鍵**：cmd / ctrl / shift /
  // 中鍵是使用者明確要在新分頁看原圖的意圖，放行。
  //
  // 範圍刻意收窄：href 指向非圖檔的圖片連結（縮圖連到另一篇文章）是正常導航，不吞；
  // <button> 包圖（Medium click-to-zoom）未 probe 驗證、不納入。
  // 圖檔副檔名判定與 cleaner IMG_URL_RE 同款（cleaner 的住 IIFE 內未匯出）。
  var IMG_HREF_RE = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg|jfif)(?:[?#].*)?$/i;

  function shouldSwallowImageLinkClick(info) {
    if (!info) return false;
    if (info.button !== 0) return false;
    if (info.metaKey || info.ctrlKey || info.shiftKey || info.altKey) return false;
    if (!info.inArticle) return false;
    if (!info.wrapsMedia) return false;
    var href = String(info.href || '');
    if (!/^https?:/i.test(href)) return false;
    var path;
    try { path = new URL(href).pathname; } catch (e) { return false; }
    return IMG_HREF_RE.test(path);
  }

  var api = {
    STORAGE_KEY: 'readerLinkIntent',
    shouldSwallowImageLinkClick: shouldSwallowImageLinkClick,
    MAX_AGE_MS: MAX_AGE_MS,
    MAX_ENTRIES: MAX_ENTRIES,
    normalizeIntentUrl: normalizeIntentUrl,
    shouldRecord: shouldRecord,
    pruneList: pruneList,
    addIntent: addIntent,
    consumeMatch: consumeMatch
  };
  if (typeof window !== 'undefined') window.__JReadLinkFollow = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
