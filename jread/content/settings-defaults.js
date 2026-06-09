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
    // v0.7.254：字重三段。300 = 細 / 400 = 中（預設）/ 600 = 粗（Semibold）。用真正的
    // font-weight 全平台生效，取代 v0.7.157 boldText（-webkit-font-smoothing 只在
    // macOS 有差異）。三段一律注入（含 400，避免原站內文非 400 時中退回原站與細撞色）。
    // 舊 boldText 由 SW onInstalled 一次性遷移（boldText:true → 600）。詳見 styler.js。
    fontWeight: 400,
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

  // v0.8.16：字型 stack 單一資料源。原本 SW（service-worker.js）與 popup
  //（popup.js FONT_STACKS）各寫一份完整字面值、靠 serif-font-stack spec 人工
  // 校對防 drift（CLAUDE.md 工作流原則 5 點名）。現在收斂到本檔，兩邊都讀同
  // 一份。注意：popup.html 的 <option value> 是第三份**靜態 HTML 拷貝**（HTML
  // 無法引用 JS 常數），仍由 serif-font-stack spec 校對 HTML↔JS 一致。
  //
  // serif：各平台 CJK 襯線字體明寫（macOS Songti、iOS Hiragino Mincho），放在
  // 泛型 serif 之前、拉丁字型之後——iOS WebKit 對清單中段泛型 serif 只解析拉丁
  // 字型，CJK 會 fallback 到後綴 sans，需明寫才不會襯線/無襯線看起來一樣。
  // sans：系統 CJK 字型優先（-apple-system / PingFang TC / JhengHei），繞過部分
  // 站點對「Noto Sans TC」family 名的 @font-face 劫持（weight→檔案對映壞掉導致
  // 字重失效）；Noto Sans TC 留作末段 fallback。詳見各 stack 的演進註解歷史。
  const FONT_STACKS = {
    system: 'system-ui',
    serif: '"Noto Serif TC", Georgia, "Times New Roman", "Songti TC", "Songti SC", "Hiragino Mincho ProN", serif',
    sans: '-apple-system, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Helvetica Neue", sans-serif',
    mono: 'ui-monospace, Menlo, Consolas, monospace'
  };

  // 舊 stack 字面值（onInstalled 精準替換遷移用）。fontFamily 以整串字面值存進
  // storage，改 FONT_STACKS 常數不會自動更新既有使用者的存值——SW onInstalled
  // 比對舊值精準替換成新值。LEGACY_SERIF = v0.7.220 以前；LEGACY_SANS = v0.7.253 以前。
  const LEGACY_FONT_STACKS = {
    serif: '"Noto Serif TC", Georgia, "Times New Roman", serif',
    sans: '"Noto Sans TC", -apple-system, "Helvetica Neue", sans-serif'
  };

  // SW（globalThis）/ event page（window=globalThis）/ content script 都掛
  // globalThis；jsdom regression spec 走 module.exports。
  global.__JReadSettingsDefaults = DEFAULT_SETTINGS;
  global.__JReadFontStacks = FONT_STACKS;
  global.__JReadLegacyFontStacks = LEGACY_FONT_STACKS;
  // module.exports 維持 === DEFAULT_SETTINGS（既有呼叫端契約，不可附掛其他 key
  // 否則污染 Object.keys / 被當設定欄位寫進 storage）。jsdom spec 需要 font
  // stacks 時 require 本檔後讀 globalThis.__JReadFontStacks。
  if (typeof module !== 'undefined' && module.exports) module.exports = DEFAULT_SETTINGS;
})(typeof globalThis !== 'undefined' ? globalThis : self);
