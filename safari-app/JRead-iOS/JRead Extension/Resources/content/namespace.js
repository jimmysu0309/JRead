// JRead — Content Script 命名空間初始化
// Manifest V3 的 content script 不能用 ES module import，
// 因此子模組透過 window.__JRead 共用狀態。此檔必須最先載入。
(function () {
  'use strict';

  if (window.__JRead) return; // 避免重複注入（SPA 導航、重新注入時保險）

  window.__JRead = {
    version: chrome.runtime.getManifest().version,

    // 閱讀模式狀態
    state: {
      active: false,          // 目前是否處於閱讀模式 / 影院模式（任一）
      cinemaActive: false,    // v0.7.133：是否處於 cinema mode（YouTube 專用），與 active 連動
      articleEl: null,        // 偵測到的主文容器
      confidence: 0,          // 偵測信心分數（0–1）
      hiddenEls: [],          // 被隱藏的雜訊元素快照，還原用
      originalStyles: null    // 主文容器原始 inline style，還原用
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

    // v0.7.143：context-invalidated guard 統一 helper（v0.7.140 原本只在
    // main.js 內、youtube-borderless.js 等其他 content script 仍直接呼
    // chrome.runtime.sendMessage 沒 guard）。提到 namespace 後**所有** content
    // script 共用同一個 entry point。invalidated 時（extension reload 後既有
    // content script 仍在跑但 chrome.runtime 失效，chrome.runtime.id === undefined）
    // silently no-op；fire-and-forget call site 不影響使用體驗，callback 版本
    // invoke null 讓 caller 走「沒回應」分支。
    safeSendMessage(msg, cb) {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) {
        if (cb) { try { cb(null); } catch (_) {} }
        return;
      }
      try {
        if (cb) chrome.runtime.sendMessage(msg, cb);
        else chrome.runtime.sendMessage(msg);
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
      // v0.8.65：SAVE_TO_READWISE 訊息已移除——popup 改在 extension 頁直接 fetch
      // （popup-core.saveReaderPayload），不再 popup → SW（iOS 背景頁掛起會 silently
      // 失敗）。快速鍵送出走 SW sendToReadwiseFromCommand，不經訊息。
      // v0.7.89：SW 透過快速鍵觸發送 Readwise 後，需要在頁面顯示結果 toast
      SHOW_TOAST: 'SHOW_TOAST',                     // SW → content：顯示 toast（payload: { message, kind }）
      // v0.7.134：YouTube borderless mode
      TOGGLE_YT_BORDERLESS: 'TOGGLE_YT_BORDERLESS', // SW / popup → content：toggle 無邊模式
      RESIZE_OWN_WINDOW: 'RESIZE_OWN_WINDOW',       // content → SW：把瀏覽器視窗高度 resize 成匹配影片比例
      // v0.7.218：自訂快速鍵——custom-shortcuts.js 命中後請 SW 走 manifest
      // commands 同一條 dispatch（payload: { command }，與 commands key 同字彙）
      CUSTOM_COMMAND: 'CUSTOM_COMMAND',             // content → SW：自訂快速鍵觸發指令
      // v0.7.228：統一指令 dispatch 落地 content 端（iOS SW 終止後手勢/自訂鍵
      // 仍可本地觸發）；SW 只在 manifest 預設鍵（browser 層事件）時委派此訊息
      DISPATCH_COMMAND: 'DISPATCH_COMMAND',         // SW → content：dispatchLocalCommand(payload.command)
      // v0.8.33：Safari 限定 content 載入喚醒 ping（keepalive.js 發送）
      BG_WAKE_PING: 'BG_WAKE_PING',                 // content → SW：喚醒 background（Safari）
      // debug bridge（development install 限定，SW 端 runIfDevelopmentInstall gate）
      JREAD_RELOAD: 'JREAD_RELOAD',                 // content → SW：reload extension
      JREAD_DEBUG_SET_THEME: 'JREAD_DEBUG_SET_THEME' // content → SW：代寫 theme（cage Page Rounds 用）
    }
  };
})();
