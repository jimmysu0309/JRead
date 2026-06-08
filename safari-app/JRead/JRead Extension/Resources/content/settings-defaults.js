// JRead — DEFAULT_SETTINGS 單一資料源（v0.7.235）
//
// 四個 context 共用同一份預設值：
//   1. content script（manifest content_scripts；main.js getSettings 直讀
//      chrome.storage.sync 時的 merge defaults）
//   2. Chrome MV3 service worker（importScripts('/content/settings-defaults.js')）
//   3. Safari event page（patch-safari-manifest.sh 把本檔列進
//      background.scripts 預載——event page 沒有 importScripts，v0.7.229 教訓）
//   4. Firefox event page（tools/firefox-build.sh 同列同序）
//
// 歷史（為什麼從 service-worker.js 搬出來）：v0.7.235 之前 DEFAULT_SETTINGS
// 只住在 SW，content 端透過 GET_SETTINGS round-trip 拿 merge 結果。iOS Safari
// 的 background 訊息會無聲掉包（service worker 被回收後不再喚醒，Apple
// Developer Forums thread 758346；iOS 18.4+ 另有 sendMessage 掉包 regression
// thread 787958），掉包時 content 拿到 undefined → 所有設定 fallback 預設值：
// theme / fontSize / autoEnableDomains 靜默退化（接近預設值所以難察覺）、
// pagedMode 永遠 false（= Jimmy 2026-06-07 回報「翻頁模式 iOS 沒功能」根因，
// iOS simulator instrument 實證：SW round-trip 回 undefined、content 直讀
// storage.sync 正常回 pagedMode=true）。修法：getSettings 直讀 storage、
// defaults 由本檔提供，徹底去除 background 依賴。
//
// popup/popup.js 另有 popup 專用 DEFAULT_SETTINGS（值綁 popup UI 常數
// FONT_SIZE.default 等）——兩份是同一事實的雙實作，由
// test/regression/settings-direct-read.spec.js 校對欄位一致防 drift。
(function (global) {
  'use strict';

  const DEFAULT_SETTINGS = {
    theme: 'light',
    fontSize: 18,
    contentWidth: 720,
    fontFamily: 'system-ui',
    // 字粗外觀。false = 細（-webkit-font-smoothing: antialiased）= 預設；
    // true = 粗（subpixel-antialiased）。詳見 styler.js。
    boldText: false,
    lineHeight: 1.7,
    // v0.7.162：段落間距（em）。1.0 對應 v0.7.102 baseline。
    paragraphSpacing: 1.0,
    autoEnableDomains: [],
    // Readwise Reader integration（v0.7.33）。空字串 = 未設定。
    readwiseToken: '',
    // v0.7.131：閱讀模式啟動時攔截原站快速鍵。
    blockPageShortcuts: true,
    // 中英文字之間自動補空白（盤古之白）。
    pangu: true,
    titleFontSize: 0,
    // v0.7.215：Space 平滑卷動比例（% of viewport）；0 = 停用。
    spaceScrollRatio: 50,
    // v0.7.227：翻頁模式（電子書式水平翻頁）。預設 false = 垂直卷動。
    pagedMode: false,
    // v0.7.237：翻頁模式底部頁碼指示（「3 / 43」）。預設 true = 顯示；
    // false = 隱藏（Jimmy 回報頁碼佔用顯示空間）。只在 pagedMode 時有意義。
    showPageNumber: true,
    // v0.7.218：自訂快速鍵。null = 未自訂。
    customShortcuts: {
      'toggle-reader-mode': null,
      'send-to-readwise': null,
      'toggle-youtube-borderless': null
    }
  };

  // SW（globalThis）/ event page（window=globalThis）/ content script 都掛
  // globalThis；jsdom regression spec 走 module.exports。
  global.__JReadSettingsDefaults = DEFAULT_SETTINGS;
  if (typeof module !== 'undefined' && module.exports) module.exports = DEFAULT_SETTINGS;
})(typeof globalThis !== 'undefined' ? globalThis : self);
