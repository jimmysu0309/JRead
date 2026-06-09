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

    // 訊息常數（與 popup / background 對齊）
    MSG: {
      TOGGLE_READER_MODE: 'TOGGLE_READER_MODE',
      REPORT_DETECTION_RESULT: 'REPORT_DETECTION_RESULT',
      GET_SETTINGS: 'GET_SETTINGS',
      UPDATE_SETTINGS: 'UPDATE_SETTINGS',
      SET_ACTIVE_ICON: 'SET_ACTIVE_ICON',
      // Readwise integration（v0.7.33）
      GET_READER_STATE: 'GET_READER_STATE',         // popup → content：reader mode 是否啟動，決定 popup 按鈕 disable 狀態
      EXTRACT_READER_HTML: 'EXTRACT_READER_HTML',   // popup → content：抽 reader card outerHTML + url + title
      SAVE_TO_READWISE: 'SAVE_TO_READWISE',         // popup → SW：把抽出的內容送 Readwise Reader API
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
      DISPATCH_COMMAND: 'DISPATCH_COMMAND'          // SW → content：dispatchLocalCommand(payload.command)
    }
  };
})();
