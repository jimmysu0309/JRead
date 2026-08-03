// JRead — Content Script 命名空間初始化
// Manifest V3 的 content script 不能用 ES module import，
// 因此子模組透過 window.__JRead 共用狀態。此檔必須最先載入。

// ─── 跨瀏覽器 API shim（v0.8.164，比照姊妹專案 Shinkansen content-ns.js）───────
// content script 不能 import ES module → 用全域方式讓後續所有 content script
// （keepalive / detector / cleaner / styler / main 等）繼承同一個 `browser`。
// Chrome：globalThis.browser 不存在 → 退回 globalThis.chrome（MV3 無 callback
// 時 chrome.* 一樣回 Promise，行為零變化）。Safari / Firefox：用原生 browser.*
// （Promise，比 Safari 的 chrome 相容層可靠——iOS 訊息掉包修法的核心）。
// namespace.js 是 content_scripts 第一個檔，此行必須在任何 browser/chrome 使用前。
// 同款 shim 另兩份：content/settings-defaults.js 頂端（popup / options / SW
// 三個 context 的第一個載入檔）與 content/home-launcher.js（獨立注入、有自己的
// 防禦性理由註解）——三份單一語意、互為鏡像。
globalThis.browser = globalThis.browser ?? globalThis.chrome;

(function () {
  'use strict';

  if (window.__JRead) return; // 避免重複注入（SPA 導航、重新注入時保險）

  window.__JRead = {
    version: browser.runtime.getManifest().version,

    // 閱讀模式狀態
    state: {
      active: false,          // 目前是否處於閱讀模式 / 影院模式（任一）
      cinemaActive: false,    // v0.7.133：是否處於 cinema mode（YouTube 專用），與 active 連動
      articleEl: null,        // 偵測到的主文容器
      confidence: 0,          // 偵測信心分數（0–1）
      hiddenEls: [],          // 被隱藏的雜訊元素快照，還原用
      absorbedSiblings: [],   // v1.7.13：multi-block 文章移進 articleEl 的接續兄弟區塊，退出移回用
      originalStyles: null,   // 主文容器原始 inline style，還原用
      syncScrollOnExit: true, // v1.0.21：退出時把原網頁捲回閱讀段落（進場 stash settings）
      readerHostPage: false   // v1.0.22：本頁是否為 reader.html（擴充自有頁）——true 時退出走 NS.onReaderExit 導回 feed，不剝版型
    },

    // 子模組佔位，後續由各 script 自行掛載
    detector: null,
    cleaner: null,
    styler: null,
    toast: null,
    cinema: null,           // v0.7.133：YouTube cinema mode（cinema-mode.js 掛載）
    borderless: null,       // v0.7.134：YouTube borderless mode（youtube-borderless.js 掛載）
    xThread: null,          // v0.7.135：X / Twitter status thread reader（x-thread.js 掛載）
    fbPost: null,           // v0.7.157：Facebook permalink post reader（fb-post.js 掛載）
    editMode: null,         // v0.8.108：編輯模式手動移除雜訊（edit-mode.js 掛載）
    onReaderExit: null,     // v1.0.22：reader.html 退出 hook（reader-app.js 掛載；state.readerHostPage 為 true 時 exitReaderMode 呼叫它導回 feed）

    // v0.7.143：context-invalidated guard 統一 helper（v0.7.140 原本只在
    // main.js 內、youtube-borderless.js 等其他 content script 仍直接呼
    // chrome.runtime.sendMessage 沒 guard）。提到 namespace 後**所有** content
    // script 共用同一個 entry point。invalidated 時（extension reload 後既有
    // content script 仍在跑但 browser.runtime 失效，browser.runtime.id === undefined）
    // silently no-op；fire-and-forget call site 不影響使用體驗，callback 版本
    // invoke null 讓 caller 走「沒回應」分支。
    //
    // v0.8.164：改用 browser.runtime.sendMessage（原生 Promise，比 Safari 的
    // chrome 相容層可靠——iOS 訊息可靠度修法核心）。對外仍維持 (msg, cb) callback
    // 介面（call site 不必改）：內部把 Promise resolve → cb(res)、reject → cb(null)。
    // 一律 .then(onFulfilled, onRejected) 消費 Promise，fire-and-forget（無 cb）時
    // 也不會留下 unhandled rejection。
    safeSendMessage(msg, cb) {
      if (!browser || !browser.runtime || !browser.runtime.id) {
        if (cb) { try { cb(null); } catch (_) {} }
        return;
      }
      try {
        const p = browser.runtime.sendMessage(msg);
        if (p && typeof p.then === 'function') {
          p.then(
            (res) => { if (cb) { try { cb(res); } catch (_) {} } },
            () => { if (cb) { try { cb(null); } catch (_) {} } }
          );
        } else if (cb) {
          // 非 Promise 回傳（理論上 browser.* 一律回 Promise，保險分支）
          try { cb(null); } catch (_) {}
        }
      } catch (_) {
        // race condition：guard 通過後 context 才失效（極罕見，但保留安全網）
        if (cb) { try { cb(null); } catch (_) {} }
      }
    },

    // v0.8.37：「標題去站名尾綴」單一資料源（原本 detector ×2 / main Readwise
    // / cleaner ×3 共 6 份實作、分隔符集合各不相同——「Title - Site」某些 path
    // 切得掉、某些切不掉，修分隔 bug 要改六處）。語意：
    //   - 半形分隔符（| - — – ·）必須前後有空白才切——保護連字號複合詞
    //     （COVID-19、e-mail）不被誤切（舊 cleaner 版 `/[|｜\-—–]/` 無空白
    //     要求，「COVID-19 疫情」會被切成「COVID」）
    //   - 全形 ｜ 不要求空白——中文站慣例「標題｜站名」常不加空白
    // 回傳第一段 trim 後字串；無分隔符回傳原字串 trim。
    stripSiteSuffix(title) {
      return (title || '').split(/\s+[|\-—–·]\s+|｜/)[0].trim();
    },

    // v0.7.251：標題比對用的標點正規化（detector + cleaner 共用，單一資料源）。
    // 動機：站點的 og:title / document.title（meta 標籤、CMS 後台輸出）常用
    // ASCII 直引號 / 撇號（' " ...），但渲染出的 <h1> 經排版 JS/CSS 或編輯器
    // 智慧引號轉換成 typographic 變體（’ “ ” …）。CNBC 實證：og 撇號 U+0027
    // (39) vs h1 撇號 U+2019 (8217)，strict `===` 比對失敗 → cleaner 的
    // 「含 canonical title 容器 skip」guard 失效 → 整塊文章 header（含主標）
    // 被當 link-only block 砍掉、標題消失。折疊單/雙引號家族 + 刪節號到
    // ASCII 等價字，再 collapse 空白。**刻意不折破折號**——detector 的
    // getCanonicalTitle 用 `–—|` 當站名尾綴分隔符切首段，折了會破壞 split。
    foldTitlePunct(s) {
      return (s || '')
        .replace(/[‘’‚‛`´]/g, "'") // ' ' ‚ ‛ ` ´ → '
        .replace(/[“”„‟«»]/g, '"') // " " „ ‟ « » → "
        .replace(/…/g, '...')                               // … → ...
        .replace(/\s+/g, ' ')
        .trim();
    },

    // v0.8.74：送 Readwise 的「主標」單一資料源——從 reader card 找使用者實際
    // 看到的主標 heading 文字（main.js extractReaderTitle 呼叫）。
    //
    // 動機：v0.8.50 把 title 來源從靜態 document.title 改成 card 內可見 h1，解決
    // 「單語翻譯原地替換 h1 → 送 Readwise 卻是原文」。但部分站主標不是 h1——
    // Stratechery 用 wp-block `<h2>` post-title（Jimmy 2026-06-15 回報該站）。
    // 原本只查 h1 → card 內找不到 → fallback document.title（單語翻譯不改它）
    // → 送出原文、譯後 h2 主標又留在 body 重複出現（buildCleanHtml dedup 只比
    // 「與 title 同文的 heading」，title 是原文故比不中譯文 h2）。
    //
    // 結構性通則（與 detector articleIsSelfTitled 同款、tag-agnostic）：
    //   1. 優先取第一個可見 <h1>（多數文章主標、v0.8.50 行為延續）
    //   2. 無 h1 時 DOM order 走訪，取「第一個內文長段落（<p> 文字 > 80 字）之前
    //      出現的第一個可見 <h2>」當主標——post-header 主標必在內文之前，藉此
    //      避開文中 section <h2>
    // 隱藏節點（[data-jread-hidden] 自身或子孫，站名 logo / cleaner 標記的雜訊
    // heading）跳過；文字 > 300 字視為非主標（detector 誤圈整塊容器時的防線）。
    // innerText 取可見文字（display:none 子節點不入列）；jsdom 無 innerText 時退
    // textContent（僅測試環境會走到）。
    findCardTitleHeading(card) {
      if (!card || !card.querySelectorAll) return '';
      const visibleText = (el) => {
        if (el.closest && el.closest('[data-jread-hidden="1"]')) return null;
        const raw = el.innerText != null ? el.innerText : el.textContent;
        const text = (raw || '').replace(/\s+/g, ' ').trim();
        return (text && text.length <= 300) ? text : null;
      };
      // 1) 第一個可見 h1
      for (const h of card.querySelectorAll('h1')) {
        const t = visibleText(h);
        if (t) return t;
      }
      // 2) 無 h1：DOM order 取內文段落前的首個可見 h2
      const doc = card.ownerDocument;
      if (doc && doc.createTreeWalker) {
        const walker = doc.createTreeWalker(card, 0x1 /* SHOW_ELEMENT */);
        let n;
        while ((n = walker.nextNode())) {
          const tag = n.tagName;
          if (tag === 'H2') {
            const t = visibleText(n);
            if (t) return t;
          } else if (tag === 'P') {
            const raw = n.innerText != null ? n.innerText : n.textContent;
            if ((raw || '').replace(/\s+/g, ' ').trim().length > 80) break;
          }
        }
      }
      return '';
    },

    // v1.6.19：RSS reader（Miniflux / FreshRSS 等自架閱讀器）閱讀頁的「原始文章 URL」。
    // 動機：在 RSS reader 內對某篇文章開閱讀模式、送 Readwise / Instapaper 儲存時，
    // location.href 是 RSS reader 自己的 URL（如 https://miniflux.example/unread/entry/123），
    // 存進去之後點回連的是 reader、不是文章原始出處。使用者要的是原始位置。
    //
    // 結構性訊號（非站點 / class 特判，CLAUDE.md 硬規則 3）：RSS reader 一律把「文章
    // 主標」渲染成一個指向原文的超連結，且該連結必然**跨網域**（指向文章原始站，與
    // reader 自身 origin 不同）。Miniflux entry.html：
    //   <h1 id="page-header-title"><a href="{{ .entry.URL }}" target="_blank">標題</a></h1>
    // FreshRSS / Tiny Tiny RSS 等同款把 entry 標題包成外連 <a>。一般新聞 / 部落格文章
    // 頁的主標是純文字、不含連結；就算含連結也是**同 origin** 的自連結（self-link，見
    // wordpress-pretitle-selflink），被 cross-origin gate 濾掉——故不會誤觸。
    //
    // 判定條件（全部成立才回傳）：
    //   1. 目前頁面是 http(s)（擴充自有頁 chrome-extension:// 等直接不判）
    //   2. 存在一個 <h1>，其可見文字整段就是單一 <a href>（anchor 文字涵蓋 >= 60%
    //      標題文字——「整個標題是連結」，排除標題中夾帶一小段外連的情況）
    //   3. 該 anchor 解析為 http(s) 絕對 URL 且 origin ≠ 目前頁面 origin
    // 搜尋範圍先 articleEl（含 promote 進 card 的 title clone）、再退整份 document
    //（Miniflux detector 選 article.entry-content，主標 h1 在外層 header.entry-header）。
    // **不跳過 [data-jread-hidden]**：原始 header h1 在閱讀模式會被隱藏（改顯示 clone），
    // 但仍是 URL 的事實來源；cross-origin gate 已足以擋掉站名 logo 自連結那類雜訊。
    // 回傳原始文章 URL 字串，或 null（非 RSS reader / 找不到訊號 → 呼叫端退回 location.href）。
    findOriginalArticleUrl(articleEl, currentUrl) {
      let curOrigin;
      try {
        const cur = new URL(currentUrl);
        if (!/^https?:$/i.test(cur.protocol)) return null;
        curOrigin = cur.origin;
      } catch (_) { return null; }
      const roots = [];
      if (articleEl && articleEl.querySelectorAll) roots.push(articleEl);
      const doc = (articleEl && articleEl.ownerDocument) || (typeof document !== 'undefined' ? document : null);
      if (doc && doc.documentElement && doc.documentElement.querySelectorAll) roots.push(doc.documentElement);
      const seen = new Set();
      for (const root of roots) {
        for (const h of root.querySelectorAll('h1')) {
          if (seen.has(h)) continue;
          seen.add(h);
          const raw = h.innerText != null ? h.innerText : h.textContent;
          const hText = (raw || '').replace(/\s+/g, ' ').trim();
          if (!hText || hText.length > 300) continue;
          const anchors = h.querySelectorAll('a[href]');
          if (anchors.length !== 1) continue;
          const a = anchors[0];
          const aRaw = a.innerText != null ? a.innerText : a.textContent;
          const aText = (aRaw || '').replace(/\s+/g, ' ').trim();
          if (aText.length < hText.length * 0.6) continue;
          let abs;
          try { abs = new URL(a.getAttribute('href'), currentUrl); } catch (_) { continue; }
          if (!/^https?:$/i.test(abs.protocol)) continue;
          if (abs.origin === curOrigin) continue; // 同 origin = 自連結 / 站內連結，非 RSS reader 外連
          return abs.href;
        }
      }
      return null;
    },

    // v0.8.121：標記文首 byline / dateline meta block 供 Readwise 匯出移除，回傳
    // 被標記的 live 元素陣列（呼叫端 clone 後負責還原標記）。動機：Readwise Reader
    // metadata 已記錄作者 + 發表日期，body 內重複的作者名 +「Published: ...」+ 站方
    // 作者工具列 CTA（Add as a preferred source / 分享鈕）對 Readwise 而言是垃圾
    //（Jimmy 2026-06-19 autosport.com 回報）。結構訊號（非站點 / class 特判）：以
    // <time>（HTML5 發表日期語意）為錨——位於第一個內文 <p> 之前、且 <time> 不在
    // prose（p / li / figure / figcaption / blockquote）內的「純 meta 區塊」。從
    // <time> 往上爬，取「不含 heading / 不含 <p> / 不含內容圖」的最高祖先（= 作者
    // 工具列，天然停在含 h1 / hero 的 entity-header 之下、不誤殺標題或主圖；kicker
    // 分類標籤是 entity-header 直屬、不在此區塊、保留）標記。文章無 <p> 時不動
    //（避免誤殺整篇純 div 文章）。閱讀模式仍保留 byline 顯示——標記只加在 clone
    // 來源的 live DOM、clone 後即移除（buildCleanHtml 負責）。content-img 門檻用
    // natural / rect >= 內容圖尺寸，確保 hero 永不被併入移除範圍。
    markLeadingBylineForExport(rootEl) {
      const marked = [];
      if (!rootEl || !rootEl.querySelector) return marked;
      const firstP = rootEl.querySelector('p');
      if (!firstP) return marked;
      const hasContentImg = (el) => {
        for (const img of el.querySelectorAll('img')) {
          const nw = img.naturalWidth || 0, nh = img.naturalHeight || 0;
          if (nw >= 200 && nh >= 150) return true;
          let r; try { r = img.getBoundingClientRect(); } catch (_) { r = null; }
          if (r && r.width >= 200 && r.height >= 120) return true;
        }
        return false;
      };
      const FOLLOWING = (typeof Node !== 'undefined' && Node.DOCUMENT_POSITION_FOLLOWING) || 0x04;
      for (const time of Array.from(rootEl.querySelectorAll('time'))) {
        if (time.closest('p, li, figure, figcaption, blockquote')) continue;
        if (!(time.compareDocumentPosition(firstP) & FOLLOWING)) continue;
        let cand = time, top = null;
        while (cand && cand !== rootEl) {
          if (cand.querySelector('p, h1, h2, h3, h4, h5, h6')) break;
          if (hasContentImg(cand)) break;
          top = cand;
          cand = cand.parentElement;
        }
        if (top && top !== rootEl && !top.hasAttribute('data-jread-rw-strip')) {
          top.setAttribute('data-jread-rw-strip', '1');
          marked.push(top);
        }
      }
      return marked;
    },

    // v0.8.124：reader card 內第一張「可用主圖」img 元素（hero）+ 其 cover URL。
    // 單一資料源（CLAUDE.md 硬規則 5）：main.js extractHeroImage 取 .url 當 Readwise
    // image_url；markHeroImageForExport 標記 .img 供 buildCleanHtml 從 body 去重。
    // 兩者必須選到同一張圖，否則「送的 cover」與「body 去重的圖」會 drift。
    // 條件與舊 extractHeroImage path-1 一致：natural >= 200×200（或無 natural 時
    // rect >= 200×120）、不在 [data-jread-hidden] 子孫內、srcset 最大或 src 是可用
    // http(s) URL（非 data:/blob:）。回傳 { img, url } 或 null。
    findLeadingHeroImage(rootEl, base) {
      if (!rootEl || !rootEl.querySelectorAll) return null;
      const NS = window.__JRead;
      const isUsable = (raw) => {
        if (!raw || typeof raw !== 'string') return null;
        const s = raw.trim();
        if (!s || /^data:/i.test(s) || /^blob:/i.test(s)) return null;
        try { const abs = new URL(s, base).href; return /^https?:\/\//i.test(abs) ? abs : null; }
        catch (_) { return null; }
      };
      const pickCandidate = (img) => {
        const srcset = img.getAttribute('srcset');
        if (srcset && NS && NS.parseSrcset) {
          const entries = NS.parseSrcset(srcset).map(({ url, desc }) => {
            const m = desc.match(/^(\d+)w$/);
            return { url, w: m ? Number(m[1]) : 0 };
          });
          if (entries.length) { entries.sort((a, b) => b.w - a.w); return entries[0].url; }
        }
        return img.currentSrc || img.src || img.getAttribute('src') || '';
      };
      // v1.7.31：keep target 必須選「匯出後會存活」的副本。art-direction 站點
      // （The Verge 桌機 + 手機雙 <img>、media query 各顯其一）在窄 viewport 下
      // DOM 第一張是 display:none 的桌機副本——選到它當保留目標時，可見副本被
      // markHeroImageForExport 當重複剝除、隱藏副本又被 stripHiddenForExport
      // 剝除 → hero 兩張全滅、Readwise body 無 hero（雙規則共用同一盲點）。
      // 故優先選「不在 display:none 子樹內」的可見副本；全部隱藏（lazy 未顯示等）
      // 才退回 DOM 第一張可用副本（image_url 仍有值，維持原行為）。
      const win = rootEl.ownerDocument && rootEl.ownerDocument.defaultView;
      const inHiddenSubtree = (el) => {
        if (!win || !win.getComputedStyle) return false;
        let cur = el;
        while (cur && cur !== rootEl) {
          try { if (win.getComputedStyle(cur).display === 'none') return true; }
          catch (_) { return false; }
          cur = cur.parentElement;
        }
        return false;
      };
      let hiddenFallback = null;
      for (const img of rootEl.querySelectorAll('img')) {
        if (img.closest('[data-jread-hidden="1"]')) continue;
        const nw = img.naturalWidth || 0, nh = img.naturalHeight || 0;
        if (nw && nh) { if (nw < 200 || nh < 200) continue; }
        else { let r; try { r = img.getBoundingClientRect(); } catch (_) { r = null; } if (!r || r.width < 200 || r.height < 120) continue; }
        const url = isUsable(pickCandidate(img));
        if (!url) continue;
        if (!inHiddenSubtree(img)) return { img, url };
        if (!hiddenFallback) hiddenFallback = { img, url };
      }
      return hiddenFallback;
    },

    // v0.8.125：標記**多餘的重複** hero 主圖供 Readwise 匯出移除，回傳被標記的 live
    // 元素陣列（呼叫端 clone 後負責還原標記）。
    // 動機演進：
    //   v0.8.124 原以為 Readwise 用 image_url 另 render in-view cover、body 殘留
    //   同圖即重複，故移除 body 內**全部**同圖 → Jimmy 2026-06-19 回報「hero 不見了」。
    //   實證修正：Readwise **不在 reading view render image_url**（只當資料庫縮圖），
    //   reading view 的 hero 完全來自 body。theverge.com 原本「重複」的根因是
    //   art-direction 把 hero 渲染成**兩張** <img>（`duet--layout--entry-image` 內
    //   `_1044qizn` 桌機 + `_1044qizm` 手機，同圖、各自 media query 顯示）——Readwise
    //   端無 CSS 兩張都現 → 重複。
    // 正解（結構通則，非站點 / class 特判）：**保留第一張（findLeadingHeroImage 選到
    // 的最佳/可見那張），只移除其餘 pathname 相同的多餘副本**。單一 hero（無
    // art-direction）站點 → 只命中保留那張、不移除任何東西。比對用 URL **pathname**
    // （忽略 `?w=` / `crop=` query）——同檔不同尺寸變體 pathname 相同、能抓到所有副本；
    // pathname 含檔名故不同圖不誤中。標記 picture 祖先（若有）整支移除、避免空
    // <picture>（在 prune keep-list 內）殘留；裸 img 標 img。figcaption 不在標記範圍
    // → 圖說保留。與 markLeadingBylineForExport 共用 data-jread-rw-strip 標記、由
    // 同一段 clone 移除邏輯處理。
    markHeroImageForExport(rootEl) {
      const marked = [];
      if (!rootEl || !rootEl.querySelectorAll) return marked;
      const NS = window.__JRead;
      const doc = rootEl.ownerDocument;
      const base = (doc && doc.defaultView && doc.defaultView.location && doc.defaultView.location.href)
        || (typeof location !== 'undefined' ? location.href : '');
      const hero = NS && NS.findLeadingHeroImage ? NS.findLeadingHeroImage(rootEl, base) : null;
      if (!hero || !hero.url) return marked;
      const pathOf = (raw) => {
        if (!raw || typeof raw !== 'string') return null;
        const s = raw.trim();
        if (!s || /^data:/i.test(s) || /^blob:/i.test(s)) return null;
        try { return new URL(s, base).pathname; } catch (_) { return null; }
      };
      const heroPath = pathOf(hero.url);
      if (!heroPath) return marked;
      // img 的所有 candidate URL（src + currentSrc + srcset 各 entry）任一 pathname
      // 等於 heroPath → 與 hero 同一張圖
      const imgMatchesHero = (img) => {
        if (pathOf(img.currentSrc || img.src || img.getAttribute('src') || '') === heroPath) return true;
        const srcset = img.getAttribute('srcset');
        if (srcset && NS && NS.parseSrcset) {
          for (const { url } of NS.parseSrcset(srcset)) {
            if (pathOf(url) === heroPath) return true;
          }
        }
        return false;
      };
      // 保留的那張（findLeadingHeroImage 選到的可見最佳副本）——其本身或 picture 祖先
      // 不可被標記，否則 hero 整個消失。
      const keepTarget = (hero.img.closest && hero.img.closest('picture')) || hero.img;
      for (const img of rootEl.querySelectorAll('img')) {
        if (img.closest('[data-jread-hidden="1"]')) continue;
        if (!imgMatchesHero(img)) continue;
        const target = (img.closest && img.closest('picture')) || img;
        if (target === keepTarget) continue; // 保留一張 hero
        if (target && target.setAttribute && !target.hasAttribute('data-jread-rw-strip')) {
          target.setAttribute('data-jread-rw-strip', '1');
          marked.push(target);
        }
      }
      return marked;
    },

    // v0.8.127：標記 reader 內 display:none 的子樹供 Readwise 匯出移除，回傳被標記的
    // live 元素陣列（呼叫端 clone 後負責還原標記）。
    // 根因（Jimmy 2026-06-19 單語模式翻譯 theverge.com PopSockets 回報 dek 中英重複 +
    // 隱藏 byline 殘留——cage 真實 reader DOM probe 揪出）：站點用「響應式重複版本」把
    // 同一塊內容渲染成桌機 + 手機兩份、用 media query 顯示其一（The Verge lede 把標題
    // / dek / byline 各兩份）。reader 內非當前斷點那份是 display:none、使用者看不到，
    // 但 buildCleanHtml 的 outerHTML 仍序列化它 → Readwise 端無原站 CSS、把隱藏份也
    // render 出來。單語翻譯時更明顯：Shinkansen 只就地譯到可見那份（中文）、隱藏份留
    // 原文（英文）→ Readwise 同段中英重複。實測該頁 reader 內 10+ 個含文字的
    // display:none 子樹（dek / byline / 其他重複變體）。
    // 通則（結構性、非站點 / class 特判）：reader 顯示時 display:none 的子樹 = 使用者
    // 不可見 = 不屬於閱讀內容，整棵不送 Readwise。標記在 live DOM（clone 已 detach、
    // 無 layout、getComputedStyle 量不到 display）、clone 後由共用 data-jread-rw-strip
    // 移除邏輯處理、再還原 live（不影響閱讀模式顯示）。找到 display:none 即標記、不再
    // 遞迴其子樹（整棵移除）。排除 <noscript>（display:none 但 textContent 是 lazy
    // image 原始 HTML、是 Readwise 端圖片來源、buildCleanHtml 刻意保留）+ script/style。
    stripHiddenForExport(rootEl) {
      const marked = [];
      if (!rootEl || !rootEl.querySelectorAll) return marked;
      const win = rootEl.ownerDocument && rootEl.ownerDocument.defaultView;
      if (!win || !win.getComputedStyle) return marked;
      const walk = (el) => {
        for (const c of el.children) {
          const tag = c.tagName;
          if (tag === 'NOSCRIPT' || tag === 'SCRIPT' || tag === 'STYLE') continue;
          const cs = win.getComputedStyle(c);
          if (cs.display === 'none') {
            if (c.setAttribute && !c.hasAttribute('data-jread-rw-strip')) {
              c.setAttribute('data-jread-rw-strip', '1');
              marked.push(c);
            }
            // 整棵 display:none 子樹一併移除、不遞迴
          } else {
            walk(c);
          }
        }
      };
      walk(rootEl);
      return marked;
    },

    // v0.8.138：偵測當前頁是否已被翻譯擴充（Shinkansen 等）翻譯。單一資料源——
    // cleaner.js 的 translationGuardActive（標題 promote 位置決策）與 main.js 的
    // extractReaderPayload（Readwise gate 決策）共用。訊號：Shinkansen 翻譯後在
    // 被翻譯節點留下 data-shinkansen-translated（就地譯文）或 data-shinkansen-dual-
    // source（雙語原文）。任一存在即視為翻譯頁。
    isTranslatedPage() {
      return !!document.querySelector('[data-shinkansen-translated], [data-shinkansen-dual-source]');
    },

    // v0.8.126：Shinkansen 雙語（dual）模式送 Readwise 時只留中文譯文、移除原文。
    // 在**傳入的 clone** 上就地操作（呼叫端 buildCleanHtml 的 clone，不動 live reader
    // ——閱讀模式仍維持雙語顯示）。動機：Shinkansen dual 模式對每段保留原文
    // element（標 data-shinkansen-dual-source）+ 注入 <shinkansen-translation> wrapper
    // （內含 inner = 真實 block tag 的譯文）。JRead 送 Readwise 的 outerHTML 把兩份
    // 都帶上 → 同段原文 + 譯文重複（Jimmy 2026-06-19 theverge.com PopSockets 翻譯後
    // 回報）。Jimmy 選「只留中文譯文」。
    // Shinkansen 注入結構（content-inject.js injectDual，已對源碼核實）：
    //   - block（P/BLOCKQUOTE 等）：wrapper 為 original 的 afterend sibling
    //   - LI/TD/TH：wrapper 為 original 的 appendChild（在 original 內）
    //   - inline（被當段落的 SPAN/A 等）：wrapper 插在 block 祖先 afterend
    // 演算法（結構通則，非站點 / class 特判）：
    //   1. 每個 [data-shinkansen-dual-source] 原文 O——若 O **內含** wrapper（LI/TD/TH
    //      append 模式），把 O 自身內容換成 wrapper 的 inner（只留譯文、保留 O 的 tag）；
    //      否則（sibling 模式）整個移除 O（其 wrapper 為獨立 sibling、下一步 unwrap）。
    //   2. 剩餘所有 <shinkansen-translation> wrapper → unwrap（用其子節點 inner 取代
    //      wrapper 本身，inner 已是 p/div 等 block tag、Readwise 直接 render）。
    // 未翻譯段落（無 dual-source / 無 wrapper）與 nodevalue-mutated 就地譯文（標題等，
    // 原文已不在 DOM）不受影響。未翻譯頁面（無相關節點）為 no-op。data-shinkansen* /
    // data-sk* 殘留 attribute 由 buildCleanHtml 的 stripDataAttrs 一併清除。
    collapseShinkansenDual(root) {
      if (!root || !root.querySelectorAll) return;
      const WRAP = 'shinkansen-translation';
      const doc = root.ownerDocument;
      // 1. 處理 dual-source 原文
      for (const orig of Array.from(root.querySelectorAll('[data-shinkansen-dual-source]'))) {
        const innerWrap = orig.querySelector ? orig.querySelector(WRAP) : null;
        if (innerWrap) {
          // LI/TD/TH append 模式：wrapper 在 original 內——把 original 內容換成譯文
          const frag = doc.createDocumentFragment();
          while (innerWrap.firstChild) frag.appendChild(innerWrap.firstChild);
          while (orig.firstChild) orig.removeChild(orig.firstChild);
          orig.appendChild(frag);
        } else {
          // sibling 模式：整個移除原文（wrapper 為獨立 sibling、下一步 unwrap）
          if (orig.remove) orig.remove();
          else if (orig.parentNode) orig.parentNode.removeChild(orig);
        }
      }
      // 2. unwrap 剩餘 wrapper（sibling 模式留下的）
      for (const w of Array.from(root.querySelectorAll(WRAP))) {
        const parent = w.parentNode;
        if (!parent) continue;
        while (w.firstChild) parent.insertBefore(w.firstChild, w);
        parent.removeChild(w);
      }
    },

    // v0.8.96：srcset candidate 解析（單一資料源，namespace.js absSrcset /
    // main.js extractHeroImage / cleaner.js lazy-hydrate 共用）。
    // 動機：原本三處都用 naive `val.split(',')` 拆 candidate——但 srcset 的 URL
    // 本身可以含字面逗號（Condé Nast / Cloudinary 變形參數 `w_2240,c_limit`），
    // 逗號切會把一個 URL 從中剖成兩段，後半 `c_limit/x.jpg` 再被當相對路徑以
    // 頁面 base 解析成破 URL（GQ Taiwan hero 圖送 Readwise 全破，Jimmy 2026-06-17）。
    // 改用 WHATWG srcset parsing algorithm 的精神：URL 是「一段非空白字元」、
    // candidate 分隔逗號只認「URL 尾端逗號」或「descriptor 之後的逗號」，URL 內
    // 部逗號一律保留。回傳 [{ url, desc }] 依原順序。
    parseSrcset(val) {
      if (!val || typeof val !== 'string') return [];
      const out = [];
      const len = val.length;
      const isWS = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
      let pos = 0;
      while (pos < len) {
        // 跳過前導空白與分隔逗號
        while (pos < len && (isWS(val[pos]) || val[pos] === ',')) pos++;
        if (pos >= len) break;
        // URL：一段非空白字元（含內部逗號）
        const urlStart = pos;
        while (pos < len && !isWS(val[pos])) pos++;
        let url = val.slice(urlStart, pos);
        let desc = '';
        if (url.endsWith(',')) {
          // URL 以逗號結尾 → 該逗號是 candidate 分隔、此 candidate 無 descriptor
          url = url.replace(/,+$/, '');
        } else {
          // URL 後接 descriptor（1x / 2x / 640w），收到下一個 top-level 逗號為止
          while (pos < len && isWS(val[pos])) pos++;
          const descStart = pos;
          while (pos < len && val[pos] !== ',') pos++;
          desc = val.slice(descStart, pos).trim();
        }
        if (url) out.push({ url, desc });
      }
      return out;
    },

    // v1.7.3：把 embed-proxy iframe（embedly 代理殼）解包成殼內真正的 embed URL。
    // 動機：Medium 等站的 YouTube / Vimeo embed 實際 iframe src 是
    // `cdn.embedly.com/widgets/media.html?src=<URL-encoded 直連 embed URL>&...`
    // 代理頁。本地閱讀模式 embedly 照常 render；但送 Readwise Reader 後對方前端
    // 只 render 直連 embed host（youtube.com/embed 等）、代理殼 iframe 整顆不顯示
    // （Jimmy 2026-07-10 medium.com Bonnie Tyler 悼文實證：Readwise html_content
    // 內 5 個 embedly iframe 全在、Reader 端播放器全消失）。
    // 通則層級：embedly 是跨站 embed proxy「服務」（Medium 只是其中一個用戶），
    // 與 cleaner 的 KNOWN_MEDIA_IFRAME_SEL whitelist 同級的服務規則、非站點特判。
    // 解包目標取 proxy 自己宣告的 `src` query param——embedly 契約它就是「可直接
    // iframe 嵌入」的 URL，非我們自行拼裝；缺 src param 或非 http(s) 時保守不動。
    // 只在匯出 clone 上呼叫（buildCleanHtml），不動 live reader 的 embedly 顯示。
    unwrapEmbedProxyIframes(rootEl) {
      if (!rootEl || !rootEl.querySelectorAll) return;
      for (const f of rootEl.querySelectorAll('iframe[src]')) {
        let u;
        try { u = new URL(f.getAttribute('src')); } catch (_) { continue; }
        const host = u.hostname.toLowerCase();
        if (host !== 'embedly.com' && !host.endsWith('.embedly.com')) continue;
        if (!/\/widgets\/media\.html$/.test(u.pathname)) continue;
        const inner = u.searchParams.get('src');
        if (!inner) continue;
        let innerUrl;
        try { innerUrl = new URL(inner); } catch (_) { continue; }
        if (innerUrl.protocol !== 'https:' && innerUrl.protocol !== 'http:') continue;
        f.setAttribute('src', innerUrl.href);
      }
    },

    // v1.7.3：影片 embed iframe → 可點縮圖連結（翻譯頁匯出限定，呼叫端 gate）。
    // 動機：翻譯頁送 Readwise 走 should_clean_html=false（v0.8.138 gate，護譯文
    // 逐字），Readwise Reader 對「原樣 HTML」的前端 render 會剝掉**所有** iframe
    // ——連直連 youtube.com/embed 都不顯示（2026-07-10 Bonnie Tyler 悼文兩輪實測：
    // embedly 殼解包成直連後 html_content 內 iframe 完整、Reader 端仍無播放器）。
    // 非翻譯頁走 should_clean_html=true，Readwise 自家 pipeline 會把 YouTube iframe
    // 轉成內嵌播放器元件，不需也不可做本轉換（做了反而失去內嵌播放器）。
    // 結構性通則：raw-HTML 模式下 iframe 必被 sanitizer 剝除，影片 embed 的可攜
    // 形態是「縮圖 + 連結」（img / a 是 raw 模式必 render 的基本元素）。YouTube
    // 家族縮圖可由 video id 組出（i.ytimg.com 公開縮圖端點）；其他平台（vimeo 等）
    // 縮圖需打 API，保守不動、留待實案再擴充。
    replaceVideoEmbedsForRawHtml(rootEl) {
      if (!rootEl || !rootEl.querySelectorAll) return;
      const doc = rootEl.ownerDocument;
      for (const f of Array.from(rootEl.querySelectorAll('iframe[src]'))) {
        let u;
        try { u = new URL(f.getAttribute('src')); } catch (_) { continue; }
        const host = u.hostname.toLowerCase();
        let videoId = null;
        const isYtHost = host === 'youtube.com' || host.endsWith('.youtube.com')
          || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com');
        if (isYtHost) {
          const m = u.pathname.match(/^\/embed\/([A-Za-z0-9_-]{6,})/);
          if (m) videoId = m[1];
        } else if (host === 'youtu.be') {
          const m = u.pathname.match(/^\/([A-Za-z0-9_-]{6,})/);
          if (m) videoId = m[1];
        }
        if (!videoId) continue;
        const title = (f.getAttribute('title') || '').trim();
        const watch = 'https://www.youtube.com/watch?v=' + videoId;
        const a = doc.createElement('a');
        a.setAttribute('href', watch);
        const img = doc.createElement('img');
        img.setAttribute('src', 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg');
        img.setAttribute('alt', title || 'YouTube 影片');
        a.appendChild(img);
        if (title) {
          a.appendChild(doc.createElement('br'));
          a.appendChild(doc.createTextNode('▶ ' + title));
        }
        f.replaceWith(a);
      }
    },

    // v0.8.76：把 rootEl 子樹內媒體載體（img/source/video/audio/iframe）的
    // src / poster / srcset 以 base 為基準轉成絕對 URL（就地改 attribute）。
    // 動機：buildCleanHtml 送 Readwise 的是 `outerHTML`——序列化的是 src 的
    // 「屬性原值」、非瀏覽器解析後的絕對 URL。原站用根相對（`/assets/x.png`）
    // 或文件相對路徑寫圖時，Readwise 伺服器端收到相對 URL 無原站 base 可解析 →
    // 全部破圖（0xkato.xyz Ghost 站實證，Jimmy 2026-06-15）。抽成 NS 純函式
    // （單一資料源 + jsdom 可測，比對 main.js source-string forcing function
    // 強）。已是絕對 URL（含 data:/blob:/http(s)）的 new URL(s, base) 回原值不變。
    absolutizeResourceUrls(rootEl, base) {
      if (!rootEl || !rootEl.querySelectorAll || !base) return;
      const toAbs = (raw) => {
        if (!raw || typeof raw !== 'string') return null;
        const s = raw.trim();
        if (!s) return null;
        try { return new URL(s, base).href; } catch (_) { return null; }
      };
      // srcset：用共用 parseSrcset 拆 candidate（URL 可含字面逗號，見上），
      // 只轉 URL 段、保留 descriptor。
      const absSrcset = (val) => this.parseSrcset(val).map(({ url, desc }) => {
        const abs = toAbs(url);
        if (!abs) return null;
        return desc ? `${abs} ${desc}` : abs;
      }).filter(Boolean).join(', ');
      rootEl.querySelectorAll('img, source, video, audio, iframe').forEach((el) => {
        for (const attr of ['src', 'poster']) {
          if (el.hasAttribute(attr)) {
            const abs = toAbs(el.getAttribute(attr));
            if (abs) el.setAttribute(attr, abs);
          }
        }
        if (el.hasAttribute('srcset')) {
          const abs = absSrcset(el.getAttribute('srcset'));
          if (abs) el.setAttribute('srcset', abs);
        }
      });
    },

    // v0.8.17：編輯/互動類 element focus 判定（paged-mode 翻頁鍵 + space-scroll
    // 共用，單一資料源）。原本兩處各寫一份且 paged 版漏了 BUTTON——按鈕 focus 時
    // 方向鍵 / Space 被翻頁攔截、吃掉按鈕的鍵盤啟用（同一份事實雙實作的 drift，
    // CLAUDE.md 工作流原則 5）。傳入要判定的 element：keydown 時 paged 用
    // document.activeElement、space 用 e.target，兩者對 keydown 等價。
    isEditableTarget(el) {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return true;
      if (el.isContentEditable) return true;
      const ce = el.getAttribute && el.getAttribute('contenteditable');
      return ce === 'true' || ce === '';
    },

    // v0.8.130：CSP-safe 樣式注入（單一資料源，CLAUDE.md 硬規則 5）。styler /
    // edit-mode / cinema / youtube-borderless 原本各自 `document.createElement('style')`
    // → 4 份相同實作、同一個潛在 bug 各踩各的。
    //
    // 根因：頁面若下嚴格 `style-src 'nonce-...'`（無 unsafe-inline，例如 Miniflux
    // 自架閱讀頁）會擋掉「沒帶 nonce 的注入 <style>」。Chrome 對 content-script 注入
    // 的 <style> 有豁免（照樣生效），**WebKit / Safari 不豁免**——套頁面 CSP 把它擋掉，
    // 所以同一頁在 iPhone 沒版型、在 Chrome 正常（Jimmy 2026-06-19 Miniflux 回報）。
    // cleaner 用 el.style.setProperty（CSSOM 賦值不受 style-src 管轄）故雜訊照清，
    // 只有 styler 的版型 CSS 被擋。
    //
    // 結構性通則（非站點特判）：注入 <style> 後若 `styleEl.sheet === null`（非空 CSS
    // 卻沒產生 CSSOM sheet＝被 CSP 擋的訊號），退回 constructable stylesheet 經
    // `document.adoptedStyleSheets` 套用——adoptedStyleSheets 不受 style-src 管轄、
    // cascade 排在作者樣式之後（與晚注入 <style> 同序，配合既有 !important 不影響勝負）。
    // 一般站 sheet 非 null → 完全不走 fallback、行為與舊版一致（零回歸風險）。
    // <style id> element 全程保留當 marker，既有 `getElementById(id)` 的「已注入?」
    // guard 與還原 remove 不變。WebKit 16.4+ 支援 adoptedStyleSheets + replaceSync。
    _adoptedStyles: (typeof Map !== 'undefined') ? new Map() : null,

    _canAdoptStyles() {
      return typeof CSSStyleSheet === 'function'
        && typeof Document !== 'undefined'
        && Document.prototype
        && 'adoptedStyleSheets' in Document.prototype
        && typeof (new CSSStyleSheet()).replaceSync === 'function';
    },

    // injectCssText 注入過的 id 登記簿——withInjectedCssDisabled 用它找出所有
    // JRead 注入的 stylesheet（v1.6.25）
    _injectedCssIds: (typeof Set !== 'undefined') ? new Set() : null,

    // 注入 / 更新 id 的樣式（css 為完整 CSS 字串）。回傳 marker <style> 元素。
    injectCssText(id, css) {
      if (this._injectedCssIds) this._injectedCssIds.add(id);
      let styleEl = document.getElementById(id);
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = id;
        (document.head || document.documentElement).appendChild(styleEl);
      }
      styleEl.textContent = css;

      const map = this._adoptedStyles;
      if (!map) return styleEl;
      let sheet = map.get(id);

      // 已在 fallback 模式 → 直接更新 adopted sheet（styleEl 仍被擋、無作用）
      if (sheet) {
        try { sheet.replaceSync(css); } catch (_) {}
        return styleEl;
      }

      // 偵測本次注入是否被 CSP 擋（非空 CSS 卻無 sheet）
      if (css && !styleEl.sheet) {
        let canAdopt = false;
        try { canAdopt = this._canAdoptStyles(); } catch (_) { canAdopt = false; }
        if (canAdopt) {
          try {
            sheet = new CSSStyleSheet();
            sheet.replaceSync(css);
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
            map.set(id, sheet);
          } catch (_) { /* fallback 失敗就維持原 <style>（最壞回到 bug 前狀態） */ }
        }
      }
      return styleEl;
    },

    // 移除 id 的樣式（marker <style> + 可能的 adopted sheet 一起清）。
    removeCssText(id) {
      if (this._injectedCssIds) this._injectedCssIds.delete(id);
      const styleEl = document.getElementById(id);
      if (styleEl) styleEl.remove();
      const map = this._adoptedStyles;
      if (map && map.has(id)) {
        const sheet = map.get(id);
        try {
          document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
        } catch (_) {}
        map.delete(id);
      }
    },

    // 暫時停用所有 injectCssText 注入的 stylesheet、同步執行 fn 後復原（v1.6.25）。
    // 用途：量測「原站 cascade 下」的 computed style——styler 的持久規則（例
    // article img display:block !important）注入後，直接 getComputedStyle 讀到的
    // 是 JRead 覆寫後的值，看不到站方原意（如 embed fallback img 的 stylesheet
    // display:none）。停用→量測→復原全程在同一個 JS task 內，瀏覽器不會在中間
    // paint，無閃爍；代價是每次呼叫觸發兩次 style recalc，呼叫端自行節制
    // （只在候選存在時才呼叫）。<style> 走 sheet.disabled、CSP fallback 的
    // adopted sheet 同步停用。
    withInjectedCssDisabled(fn) {
      const toggled = [];
      if (this._injectedCssIds) {
        for (const id of this._injectedCssIds) {
          const styleEl = document.getElementById(id);
          if (styleEl && styleEl.sheet && !styleEl.sheet.disabled) {
            try { styleEl.sheet.disabled = true; toggled.push(styleEl.sheet); } catch (_) {}
          }
          const adopted = this._adoptedStyles && this._adoptedStyles.get(id);
          if (adopted && !adopted.disabled) {
            try { adopted.disabled = true; toggled.push(adopted); } catch (_) {}
          }
        }
      }
      try {
        return fn();
      } finally {
        for (const s of toggled) {
          try { s.disabled = false; } catch (_) {}
        }
      }
    },

    // CSP-safe：把 css 注入指定 ShadowRoot（floating-icon / toast 這類獨立 Shadow
    // DOM host）。與 injectCssText 同根因：嚴格 `style-src 'nonce-...'`（自架 Miniflux
    // 閱讀頁）在 WebKit 連 shadow 內的 <style> 都擋掉 → styleEl.sheet === null → 同一
    // shadow 在 iPhone 套不到內部 CSS（懸浮按鈕 .fab 拿不到 var(--fab-hit) 寬高、退回
    // <img> 原生 32px，使用者設定的尺寸被無視；Jimmy 2026-06-22 Miniflux 回報），在
    // Chrome 正常（Chrome 對注入 <style> 有豁免）。被擋時退回 shadow.adoptedStyleSheets
    // （constructable stylesheet，不受 style-src 管轄）。一般站 sheet 非 null → 不走
    // fallback、行為與舊版一致（零回歸）。
    //
    // 注意：<style> 被擋時 CSS 內的 `:host { --var: ... }` 預設值也一起失效，故呼叫端
    // 的動態值（尺寸 / 顏色 / 位置）務必另走 host 元素的 inline style——custom property
    // 會繼承進 shadow tree——不可只仰賴 CSS 裡的 :host 預設。
    injectShadowCss(shadow, css) {
      let styleEl;
      try {
        styleEl = document.createElement('style');
        styleEl.textContent = css;
        shadow.prepend(styleEl);
      } catch (_) { return null; }

      if (css && !styleEl.sheet) {
        let canAdopt = false;
        try {
          canAdopt = this._canAdoptStyles()
            && typeof ShadowRoot !== 'undefined'
            && ShadowRoot.prototype
            && 'adoptedStyleSheets' in ShadowRoot.prototype;
        } catch (_) { canAdopt = false; }
        if (canAdopt) {
          try {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(css);
            shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
          } catch (_) { /* fallback 失敗就維持原 <style>（最壞回到 bug 前狀態） */ }
        }
      }
      return styleEl;
    },

    // 訊息常數（與 popup / background 對齊）。
    // v0.8.37：REPORT_DETECTION_RESULT（7 處發送、全 repo 零接收、每次偵測
    // 白喚醒 SW 一次）與 UPDATE_SETTINGS（SW 有 case、零發送端——popup /
    // options 都直寫 storage.sync）兩個死協定移除；BG_WAKE_PING / JREAD_RELOAD
    // / JREAD_DEBUG_SET_THEME 原本是 inline 字面值、收進本表（單一詞彙源）。
    // message-protocol-consistency.spec 是三方一致（MSG ↔ content 發送 ↔ SW
    // case）的 forcing function。
    MSG: {
      TOGGLE_READER_MODE: 'TOGGLE_READER_MODE',
      GET_SETTINGS: 'GET_SETTINGS',
      SET_ACTIVE_ICON: 'SET_ACTIVE_ICON',
      // Readwise integration（v0.7.33）
      GET_READER_STATE: 'GET_READER_STATE',         // popup → content：reader mode 是否啟動，決定 popup 按鈕 disable 狀態
      EXTRACT_READER_HTML: 'EXTRACT_READER_HTML',   // popup → content：抽 reader card outerHTML + url + title
      // v0.8.148：popup → content「設定已改、請即時重套」。為什麼需要：iOS Safari
      // popup 開啟時底層頁面被掛起，storage.onChanged 廣播被丟掉（桌機 Chrome 頁面
      // 在 popup 後仍存活故照收）→ 改設定閱讀模式不即時生效、要重整。popup 每次
      // commitSave 後額外送本訊息主動觸發重套（runtime 訊息在 iOS 仍會送達——toggle
      // 走同路徑可用為證）。桌機與 onChanged 經 scheduleReapply 200ms debounce 合併。
      REAPPLY_SETTINGS: 'REAPPLY_SETTINGS',          // popup → content：設定已改、即時重套（iOS onChanged 丟事件的兜底）
      // v0.8.108：編輯模式（手動移除雜訊段落）
      EDIT_MODE_TOGGLE: 'EDIT_MODE_TOGGLE',         // popup → content：切換編輯模式（僅閱讀模式啟動時可用）
      // v0.8.65：SAVE_TO_READWISE 訊息已移除——popup 改在 extension 頁直接 fetch
      // （popup-core.sendDocument dispatcher），不再 popup → SW（iOS 背景頁掛起會 silently
      // 失敗）。快速鍵送出走 SW sendToReadwiseFromCommand，不經訊息。
      // v0.7.89：SW 透過快速鍵觸發送 Readwise 後，需要在頁面顯示結果 toast
      SHOW_TOAST: 'SHOW_TOAST',                     // SW → content：顯示 toast（payload: { message, kind }）
      // v0.7.134：YouTube borderless mode
      TOGGLE_YT_BORDERLESS: 'TOGGLE_YT_BORDERLESS', // SW / popup → content：toggle 無邊模式
      RESIZE_OWN_WINDOW: 'RESIZE_OWN_WINDOW',       // content → SW：把瀏覽器視窗高度 resize 成匹配影片比例
      // v0.7.218：自訂快速鍵——custom-shortcuts.js 命中後請 SW 走 manifest
      // commands 同一條 dispatch（payload: { command }，與 commands key 同字彙）
      CUSTOM_COMMAND: 'CUSTOM_COMMAND',             // content → SW：自訂快速鍵觸發指令
      // v0.8.162：懸浮按鈕長按選單「功能選單」（Safari path）——content 不能在 https
      // 頁 iframe 載擴充頁（Safari 限制），交 SW 開原生 popup（openPopup）/ 退新分頁
      OPEN_FEATURE_MENU: 'OPEN_FEATURE_MENU',       // content → SW：開工具列圖示選單 popup（Safari）
      // v1.0.23：懸浮按鈕長按選單「進入 Reader」——content 無 tabs 權限，交 SW 開
      OPEN_READER: 'OPEN_READER',                   // content → SW：開 reader/reader.html（Readwise feed）新分頁
      // v0.7.228：統一指令 dispatch 落地 content 端（iOS SW 終止後手勢/自訂鍵
      // 仍可本地觸發）；SW 只在 manifest 預設鍵（browser 層事件）時委派此訊息
      DISPATCH_COMMAND: 'DISPATCH_COMMAND',         // SW → content：dispatchLocalCommand(payload.command)
      // v0.8.33：Safari 限定 content 載入喚醒 ping（keepalive.js 發送）
      BG_WAKE_PING: 'BG_WAKE_PING',                 // content → SW：喚醒 background（Safari）
      // debug bridge（development install 限定，SW 端 runIfDevelopmentInstall gate）
      JREAD_RELOAD: 'JREAD_RELOAD',                 // content → SW：reload extension
      JREAD_DEBUG_SET_THEME: 'JREAD_DEBUG_SET_THEME', // content → SW：代寫 theme（cage Page Rounds 用）
      JREAD_DEBUG_SEND_READWISE: 'JREAD_DEBUG_SEND_READWISE' // content → SW：debug bridge 觸發送儲存服務（Claude 自主驗匯出用）
    }
  };
})();
