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
// v0.8.16 起 popup / options / SW 都直接 reference 本檔的 global（popup.js 讀
// window.__JReadSettingsDefaults、SW 讀 globalThis.__JReadSettingsDefaults），
// 預設值單一資料源已收斂（v0.8.37 勘誤：上一版註解仍寫 popup 有自己一份
// literal，已過時）；styler.js 的 DEFAULTS literal 是唯一受控第二份（讓 jsdom
// spec 可獨立載 styler 的取捨），由 defaults-sync.spec.js 逐欄字面值校對防 drift。
(function (global) {
  'use strict';

  const DEFAULT_SETTINGS = {
    theme: 'light',
    fontSize: 18,
    contentWidth: 720,
    fontFamily: 'system-ui',
    // v0.8.144：英文（拉丁）fallback 字型。襯線 / 無襯線各自記一個英文字型選擇
    //（latinSerif / latinSans），'auto' = 沿用該 stack 內建的西文字型（襯線 = Georgia、
    // 無襯線 = -apple-system）。只在 fontFamily 為襯線 / 無襯線 stack 時生效——
    // 系統預設（不覆寫）與等寬無此維度。實際組合（前接到 base stack 前面）由
    // composeFontStack() 在讀取邊界（main.js getSettings）執行，fontFamily 仍存
    // base stack 字面值不變（既有契約不動、不需遷移既有使用者）。
    latinSerif: 'auto',
    latinSans: 'auto',
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
    // v0.8.72：送 Readwise 時用 Gemini Flash Lite 先產生摘要（繁中三句）一起送出，
    // 取代 Readwise server 端自動生成的英文摘要。預設 false = 不產生（仍可送，由
    // Readwise 自動處理）。需同時設 geminiApiKey 才會實際呼叫。
    readwiseSummary: false,
    // v0.8.72：Gemini API key（從 Google AI Studio 取得）。空字串 = 未設定 = 即使
    // readwiseSummary 開著也不產生摘要。僅存本機 storage.sync，不上傳 JRead 伺服器。
    geminiApiKey: '',
    // v0.7.131：閱讀模式啟動時攔截原站快速鍵。
    blockPageShortcuts: true,
    // 中英文字之間自動補空白（盤古之白）。
    pangu: true,
    // v0.8.109：編輯模式（閱讀模式下手動點掉雜訊段落）。預設 true = popup 顯示
    // 「編輯模式：移除雜訊」按鈕；false = 整顆隱藏（不需要此功能者可關掉）。
    editModeEnabled: true,
    titleFontSize: 0,
    // v0.7.215：Space 平滑卷動比例（% of viewport）；0 = 停用。
    spaceScrollRatio: 50,
    // v0.7.227：翻頁模式（電子書式水平翻頁）。預設 false = 垂直卷動。
    pagedMode: false,
    // v0.7.237：翻頁模式底部頁碼指示（「3 / 43」）。預設 true = 顯示；
    // false = 隱藏（Jimmy 回報頁碼佔用顯示空間）。只在 pagedMode 時有意義。
    showPageNumber: true,
    // v0.8.40：閱讀位置記憶效期（天）。文章看到一半離開時記住閱讀位置
    //（捲動模式記段落、翻頁模式記頁數，存 storage.local），效期內重進
    // 閱讀模式自動回到上次位置。0 = 停用、上限 7（position-memory.js clamp）。
    positionMemoryDays: 3,
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
  // serif：v0.8.25 起西文襯線（Georgia / Times）排在 CJK 字體之前——CSS 逐字
  // fallback 下英文/數字命中 Georgia（西文襯線比 Noto Serif TC 拉丁字形更適合
  // 螢幕閱讀），中文穿到後面的內嵌 "Noto Serif TC"（zero 缺字保證不變）。CJK
  // 字體（內嵌 Noto Serif TC + macOS Songti + iOS Hiragino Mincho）仍放在泛型
  // serif 之前——iOS WebKit 對清單中段泛型 serif 只解析拉丁字型，CJK 會 fallback
  // 到後綴 sans，需明寫才不會襯線/無襯線看起來一樣。
  // sans：系統 CJK 字型優先（-apple-system / PingFang TC / JhengHei），繞過部分
  // 站點對「Noto Sans TC」family 名的 @font-face 劫持（weight→檔案對映壞掉導致
  // 字重失效）；Noto Sans TC 留作末段 fallback。詳見各 stack 的演進註解歷史。
  const FONT_STACKS = {
    system: 'system-ui',
    serif: 'Georgia, "Times New Roman", "Noto Serif TC", "Songti TC", "Songti SC", "Hiragino Mincho ProN", serif',
    sans: '-apple-system, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Helvetica Neue", sans-serif',
    mono: 'ui-monospace, Menlo, Consolas, monospace'
  };

  // 舊 stack 字面值（onInstalled 精準替換遷移用）。fontFamily 以整串字面值存進
  // storage，改 FONT_STACKS 常數不會自動更新既有使用者的存值——SW onInstalled
  // 比對舊值精準替換成新值。
  // serif 為**陣列**（歷代舊值各一筆，命中任一即遷移到新值）：
  //   [0] v0.7.220 以前（無明寫 CJK 字體）
  //   [1] v0.7.221–v0.8.24（Noto Serif TC 領頭，英文吃 Noto 拉丁字形）
  // sans 為單一字面值（v0.7.253 以前）。
  const LEGACY_FONT_STACKS = {
    serif: [
      '"Noto Serif TC", Georgia, "Times New Roman", serif',
      '"Noto Serif TC", Georgia, "Times New Roman", "Songti TC", "Songti SC", "Hiragino Mincho ProN", serif'
    ],
    sans: '"Noto Sans TC", -apple-system, "Helvetica Neue", sans-serif'
  };

  // v0.8.144：英文（拉丁）fallback 字型可選清單。value（key）存進 latinSerif /
  // latinSans，composeFontStack() 把對應字面值「前接」到 fontFamily base stack 前面
  //——CSS 逐字 fallback 下英文 / 數字先命中前接的拉丁字型，中文穿到 base stack 後段
  // 的 CJK 字體。前接值只放**具名**字型（不含泛型 serif / sans-serif）：泛型放中段
  // 會被 iOS WebKit 當「只解析拉丁」攔截、CJK 反而 fallback 到後綴 sans（詳見上方
  // FONT_STACKS 註解）；具名字型缺字時自然往後落到 base stack 原有的 Georgia /
  // -apple-system / 泛型，安全。'auto' = 不前接（沿用 base stack 內建西文字型）。
  // v0.8.146：內嵌拉丁可變字型（Literata / Source Serif / Piazzolla 襯線、
  // Public Sans / Source Sans 無襯線）——family 名對齊 styler 的 BUNDLED_LATIN_FACES
  // @font-face。為什麼要自帶：Charter / Palatino 等是系統字、iOS 仍可點名，但這幾支
  // 非系統字必須內嵌 woff2 才能在 iOS Safari 網頁路徑生效（同 Noto Serif TC 內嵌理由）。
  const LATIN_FONTS = {
    auto: '',
    georgia: 'Georgia',
    times: '"Times New Roman"',
    charter: 'Charter',
    palatino: 'Palatino, "Palatino Linotype", "Book Antiqua"',
    literata: '"Literata"',
    sourceserif: '"Source Serif"',
    piazzolla: '"Piazzolla"',
    helvetica: '"Helvetica Neue"',
    arial: 'Arial',
    verdana: 'Verdana',
    publicsans: '"Public Sans"',
    sourcesans: '"Source Sans"',
    sfmono: '"SF Mono"',
    consolas: 'Consolas'
  };

  // settings → 最終 font-family stack 字面值。base stack（fontFamily）維持不變，
  // 依 latinSerif / latinSans 在前面接上選定的拉丁字型。fontFamily 仍存 base stack
  // 字面值（system-ui / 襯線 / 無襯線 / 等寬整串）——既有儲存契約不變，無需遷移。
  // 只有襯線 / 無襯線兩個 base stack 開放自訂英文字型（Jimmy：跟著襯線 / 無襯線各自選）。
  function composeFontStack(s) {
    if (!s || !s.fontFamily) return s ? s.fontFamily : undefined;
    const base = s.fontFamily;
    let choice = null;
    if (base === FONT_STACKS.serif) choice = s.latinSerif;
    else if (base === FONT_STACKS.sans) choice = s.latinSans;
    if (choice && choice !== 'auto' && LATIN_FONTS[choice]) {
      return LATIN_FONTS[choice] + ', ' + base;
    }
    return base;
  }

  // SW（globalThis）/ event page（window=globalThis）/ content script 都掛
  // globalThis；jsdom regression spec 走 module.exports。
  global.__JReadSettingsDefaults = DEFAULT_SETTINGS;
  global.__JReadFontStacks = FONT_STACKS;
  global.__JReadLegacyFontStacks = LEGACY_FONT_STACKS;
  global.__JReadLatinFonts = LATIN_FONTS;
  global.__JReadComposeFontStack = composeFontStack;
  // module.exports 維持 === DEFAULT_SETTINGS（既有呼叫端契約，不可附掛其他 key
  // 否則污染 Object.keys / 被當設定欄位寫進 storage）。jsdom spec 需要 font
  // stacks 時 require 本檔後讀 globalThis.__JReadFontStacks。
  if (typeof module !== 'undefined' && module.exports) module.exports = DEFAULT_SETTINGS;
})(typeof globalThis !== 'undefined' ? globalThis : self);
