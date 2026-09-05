// JRead — DEFAULT_SETTINGS 單一資料源（v0.7.235）
//
// ─── 跨瀏覽器 API shim（v0.8.164）───────────────────────────────────────────
// 本檔是 popup.html / options.html 的第一個 <script>，也是 SW（Chrome
// importScripts 在 service-worker.js 頂端 / Safari·Firefox event page 的
// background.scripts 第三筆（v1.8.0 起 lib/logger.js 排第一），皆早於
// service-worker.js）的早期載入檔——三個
// context 共用此處設好的全域 `browser`。Chrome：退回 chrome（MV3 回 Promise，
// 行為零變化）；Safari / Firefox：原生 browser.*（Promise，iOS 訊息可靠度修法）。
// content script 軌另有一份同款 shim 在 content/namespace.js 頂端（content_scripts
// 第一個檔）；兩處單一語意、互為鏡像（CLAUDE.md 硬規則 5 的受控雙寫，改一處要同步）。
globalThis.browser = globalThis.browser ?? globalThis.chrome;
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

  // v0.8.16：字型 stack 單一資料源。原本 SW（service-worker.js）與 popup
  //（popup.js FONT_STACKS）各寫一份完整字面值、靠 serif-font-stack spec 人工
  // 校對防 drift（CLAUDE.md 工作流原則 5 點名）。現在收斂到本檔，兩邊都讀同
  // 一份。注意：popup.html 的 <option value> 是第三份**靜態 HTML 拷貝**（HTML
  // 無法引用 JS 常數），仍由 serif-font-stack spec 校對 HTML↔JS 一致。
  // v1.7.33：宣告位置移到 DEFAULT_SETTINGS 之前——預設字型改為無襯線 stack，
  // DEFAULT_SETTINGS.fontFamily 直接引用 FONT_STACKS.sans（const TDZ 需先宣告）。
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

  // v1.7.33（Jimmy 2026-08-03）：預設值改為 Jimmy 慣用組合——theme gray、
  // fontSize 17、titleFontSize 32、lineHeight 1.5、中文字型無襯線 + 英文
  // Source Serif。「預設 = 不注入」的 sentinel 自此與預設值脫鉤：不注入的
  // 明確訊號是 fontSize/titleFontSize 0、lineHeight 0、paragraphSpacing -1、
  // fontFamily 'system-ui'（見 styler.js overrides 計算）。
  const DEFAULT_SETTINGS = {
    theme: 'gray',
    fontSize: 17,
    contentWidth: 720,
    fontFamily: FONT_STACKS.sans,
    // v0.8.144：英文（拉丁）fallback 字型。襯線 / 無襯線各自記一個英文字型選擇
    //（latinSerif / latinSans）；'auto' = 沿用該 stack 內建的西文字型（襯線 = Georgia、
    // 無襯線 = -apple-system）。只在 fontFamily 為襯線 / 無襯線 stack 時生效——
    // 系統預設（不覆寫）與等寬無此維度。實際組合（前接到 base stack 前面）由
    // composeFontStack() 在讀取邊界（main.js getSettings）執行，fontFamily 仍存
    // base stack 字面值不變（既有契約不動、不需遷移既有使用者）。
    // v0.8.158（Jimmy 2026-06-22）：預設改用內嵌可變字型 Source Serif / Source Sans
    //（取代原本 'auto'）——選襯線 / 無襯線時英文 / 數字直接走自帶 woff2、iOS 也生效。
    // v1.7.33：latinSans 預設改 sourceserif（Jimmy 慣用：中文無襯線 + 英文襯線混排）。
    latinSerif: 'sourceserif',
    latinSans: 'sourceserif',
    // v0.7.254：字重三段。300 = 細 / 400 = 中（預設）/ 600 = 粗（Semibold）。用真正的
    // font-weight 全平台生效，取代 v0.7.157 boldText（-webkit-font-smoothing 只在
    // macOS 有差異）。三段一律注入（含 400，避免原站內文非 400 時中退回原站與細撞色）。
    // 舊 boldText 由 SW onInstalled 一次性遷移（boldText:true → 600）。詳見 styler.js。
    fontWeight: 400,
    lineHeight: 1.5,
    // v0.7.162：段落間距（em）。1.0 對應 v0.7.102 baseline。
    paragraphSpacing: 1.0,
    autoEnableDomains: [],
    // v1.6.0：儲存服務二擇一——'readwise'（預設，維持既有行為）| 'instapaper'。
    // 決定「送出儲存」與「讀入 feed/文章」走哪個服務的憑證與 API。摘要（readwiseSummary
    // + geminiApiKey）兩服務共用。
    storageService: 'readwise',
    // Readwise Reader integration（v0.7.33）。空字串 = 未設定。
    readwiseToken: '',
    // v1.6.0：Instapaper Full API 憑證（xAuth 換得的 OAuth token + secret）。空字串
    // = 未連結。username 僅供 options UI 顯示「已連結：<帳號>」，密碼用完即丟不存。
    instapaperToken: '',
    instapaperTokenSecret: '',
    instapaperUsername: '',
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
    // v1.6.14：閱讀模式下點文內連結時，目標頁（原分頁 / 新分頁）自動延續閱讀模式。
    // 預設 true = 開；false = 只有原頁進閱讀模式、點連結後的目標頁維持原站。判定與
    // intent list 讀寫在 content/link-follow.js，只認 http(s) 整頁導航（SPA 內部路由由
    // main.js wasActive 路徑處理、不重複）。
    linkFollowReader: true,
    // v0.8.109：編輯模式（閱讀模式下手動點掉雜訊段落）。預設 true = popup 顯示
    // 「編輯模式：移除雜訊」按鈕；false = 整顆隱藏（不需要此功能者可關掉）。
    editModeEnabled: true,
    // v1.7.33：預設 32（原 0 = Auto 保留原站標題大小；0 仍是合法 sentinel，
    // popup 自動鈕可切回）。
    titleFontSize: 32,
    // v0.7.215：Space 平滑卷動比例（% of viewport）；0 = 停用。
    spaceScrollRatio: 50,
    // v1.7.62（Jimmy 2026-08-08）：閱讀模式下滑鼠停著不動 2 秒就隱藏游標，
    // 移動 / 點擊立刻回來。預設 true。捲動刻意不算「動了」（閱讀中最常做的
    // 動作，算進去等於功能失效）。只在有真實指標裝置時生效——觸控裝置沒有
    // 游標可藏，content/idle-cursor.js 的 hasFinePointer 直接不掛 listener。
    idleCursorHide: true,
    // v0.8.157：3 指輕點切換閱讀模式。預設 false = 停用（Jimmy 2026-06-22 改預設關
    // ——三指輕點易誤觸、且懸浮 icon 已是觸控主入口）；true = 啟用辨識器。觸控裝置
    // 才有意義（桌面滑鼠 maxTouchPoints < 3 自然不裝）。
    threeFingerTap: false,
    // v0.8.154：懸浮按鈕（頁面邊緣常駐按鈕）的透明度（0.1–1.0）。
    // floatingIcon 啟用旗標本身是三態（未設過一律預設開，v0.8.158），由
    // __JReadResolveFloatingIconEnabled 在讀取邊界解析，不放此固定值；
    // 位置 floatingIconPos 為 runtime 拖移狀態，由 floating-icon.js 直讀 storage。
    floatingIconOpacity: 0.7,
    // v0.8.156：懸浮按鈕尺寸。'small' = 視覺 16px / footprint 32px；'medium' = 視覺
    // 24px / footprint 40px（v0.8.166 新增、並改為**預設**，Jimmy 2026-06-23——原 small
    // 部分使用者覺得太小）；'large' = 視覺 32px / footprint 48px。content 端
    // floating-icon.js applySize 的 fallback 與此預設一致（未設過 / 損壞 → medium）。
    floatingIconSize: 'medium',
    // v1.8.0：除錯記錄開關。關閉（預設）時仍記錄 save / system 分類與所有
    // warn·error（低頻、真機 bug 回查的主要證據），但不印 console、也不記錄
    // detect / clean / style / paged 這類高頻分類。開啟後全分類都記並印 console，
    // 供偏好設定頁「除錯記錄」逐筆檢視（見 lib/logger.js 檔頭的記錄策略）
    debugLog: false,
    // v0.7.227：翻頁模式（電子書式水平翻頁）。預設 false = 垂直卷動。
    pagedMode: false,
    // v1.5.4：原 showPageNumber 開關已移除——翻頁模式底部頁碼指示（「3 / 43」）
    // 一律顯示（拿掉頂端進度條後它是唯一進度載體）。
    // v0.8.40：閱讀位置記憶效期（天）。文章看到一半離開時記住閱讀位置
    //（捲動模式記段落、翻頁模式記頁數，存 storage.local），效期內重進
    // 閱讀模式自動回到上次位置。0 = 停用、上限 7（position-memory.js clamp）。
    positionMemoryDays: 3,
    // v1.0.21：退出閱讀模式時把原網頁捲到「剛剛讀到的段落」。預設 true。
    // v1.6.9：options 開關已移除，此行為固定啟用（保留 default 供 content 端讀取，
    // 舊 storage 若殘留 false 仍尊重，但不再有 UI 可切換）。
    // 捲動模式下主文 card 留在原文件流、雜訊只是被隱藏；退出還原雜訊後版面整個
    // 變高，原本的 scrollTop 對到的內容偏移（看起來像回到開頭）。開啟時退出前
    // 抓目前閱讀段落的真實 DOM 節點（NS.spaceScroll.currentAnchor，與閱讀位置
    // 記憶同一份「正在讀哪段」事實），還原後捲回該節點。只作用於捲動模式（翻頁
    // 模式退出仍還原進場前的文件位置，見 paged-mode.js savedScrollY）。
    syncScrollOnExit: true,
    // v1.7.37：頂端閱讀進度條的樣式。
    //   'gradient'（v1.7.53 起的預設）3px 亮青 → 深靛的漸層條
    //   'hairline' 3px 純色實心條，無描邊無軌道（v1.7.52 以前的預設 = 歷代行為）
    //   'outline'  3px + 雙通道描邊（下緣半透明黑 + 再下一層半透明白）
    //   'track'    outline 再加一條常駐軌道（未讀段也有底色）
    //   'thick'    5px + 右端圓角 + drop-shadow
    // 為什麼需要這個維度：進度條是 position: fixed; top: 0 且 z-index 拉到最高，
    // 底下的背景**不是主題色**，是當下捲到畫面頂端的任何內容（hero 大圖、深色引言
    // 區、程式碼黑塊）。所以「把 theme.progressBar 調成更好的顏色」救不了——任何
    // 單一顏色都會在某段背景上被吃掉（Jimmy 2026-08-04 回報：深色背景旁難辨識）。
    // 三種背景無關機制，各有代價：outline / track 靠「深底靠白邊、淺底靠黑邊」的
    // 雙通道描邊；gradient 靠「條子自己同時含亮端與暗端」——任何底色都吃不掉整條，
    // 且不需要在細條旁再加兩圈輪廓（見 styler PROGRESS_GRADIENT 註解的量測）。
    // v1.7.53 預設改 gradient（Jimmy 2026-08-06 裁定，參考 Readwise Reader）——
    // 這會改變既有使用者升級後的外觀，要回舊樣式選 'hairline'。
    // 只作用於捲動模式：翻頁模式沒有頂端進度條，進度載體是底部頁碼（見 v1.5.4）。
    progressBarStyle: 'gradient',
    // v1.9.0：設定檔（profile）——把 popup 那組外觀設定（PROFILE_KEYS）存成具名
    // 快照，一鍵切換。profiles 為陣列（建立順序即 popup select / 長按選單的排列
    // 順序）：[{ name, fields }]，fields 只含 PROFILE_KEYS 白名單欄位、上限
    // MAX_PROFILES 組。activeProfile = 目前套用中的設定檔名稱，null = 「自訂」
    //（沒有套用任何設定檔，或套用後又手動改過任一欄位——popup save() 遇到
    // PROFILE_KEYS 內欄位變動就寫回 null）。兩個 key 都住 storage.sync；options
    // 「回復預設」刻意不清（使用者資產，比照憑證）。
    profiles: [],
    activeProfile: null,
    // v0.7.218：自訂快速鍵。null = 未自訂。
    customShortcuts: {
      'toggle-reader-mode': null,
      'send-to-readwise': null,
      'toggle-youtube-borderless': null
    }
  };

  // v1.7.37：progressBarStyle 合法值白名單（單一資料源）。styler.js opts 驗證與
  // options.js 讀 DOM 的回退共用同一份——兩端各自手寫清單是已知的 drift 型態。
  // 順序即 options UI 的排列順序（漸層 → 細線 → 描邊 → 描邊＋軌道 → 加高）。
  const PROGRESS_BAR_STYLES = ['gradient', 'hairline', 'outline', 'track', 'thick'];

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
  // v0.8.146：內嵌拉丁可變字型（Source Serif / Piazzolla 襯線、Public Sans /
  // Source Sans 無襯線）——family 名對齊 styler 的 BUNDLED_LATIN_FACES @font-face。
  // 為什麼要自帶：Palatino 等是系統字、iOS 仍可點名，但這幾支非系統字必須內嵌
  // woff2 才能在 iOS Safari 網頁路徑生效（同 Noto Serif TC 內嵌理由）。
  // v0.8.158（Jimmy 2026-06-22）：移除 charter / literata 兩支字型選項。
  const LATIN_FONTS = {
    auto: '',
    georgia: 'Georgia',
    palatino: 'Palatino, "Palatino Linotype", "Book Antiqua"',
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

  // v0.8.154：懸浮按鈕啟用旗標的解析（單一資料源，content floating-icon.js +
  // options.js 共用）。floatingIcon 存進 storage.sync 的是三態：boolean（使用者
  // 在 options 明確設過）或 undefined（未設過）。
  // v0.8.158（Jimmy 2026-06-22）：未設過時一律預設開——原本平台分流（Safari 開、
  // 桌面關）取消，懸浮按鈕在所有平台都是預設入口；使用者明確設 false 仍尊重關閉。
  function resolveFloatingIconEnabled(raw) {
    return typeof raw === 'boolean' ? raw : true;
  }

  // v1.6.26：憑證欄位清單 + 裁剪（最小知情原則）。SW 的 GET_SETTINGS 是
  // content script 直讀 storage 失效時的 fallback 通道，content 端只需要 UI
  // 偏好欄位、從不使用任何憑證（grep 實證零呼叫端）——回應前把憑證欄位剔除，
  // 敏感資料不流經用不到的路徑。isolated world 下頁面 JS 本就摸不到（非漏洞
  // 修補），純防禦深度。popup / options / SW 內部送出流程自己直讀 storage，
  // 不走本通道、不受影響。
  const CREDENTIAL_SETTINGS_KEYS = [
    'readwiseToken',
    'instapaperToken',
    'instapaperTokenSecret',
    'instapaperUsername',
    'geminiApiKey'
  ];
  function stripCredentialSettings(settings) {
    if (!settings || typeof settings !== 'object') return settings;
    const out = {};
    for (const k of Object.keys(settings)) {
      if (CREDENTIAL_SETTINGS_KEYS.indexOf(k) !== -1) continue;
      out[k] = settings[k];
    }
    return out;
  }

  // ─── 設定檔（profile，v1.9.0）────────────────────────────────────────────
  // 白名單 = popup 面板上會影響閱讀版面的欄位（含翻頁模式）。刻意排除
  // autoEnableDomains（網域專屬、不是外觀）與 options 頁所有欄位。popup（存 /
  // 套用）與 content floating-icon（長按選單切換）共用同一份，兩端不得各自手寫。
  const PROFILE_KEYS = [
    'theme', 'fontSize', 'titleFontSize', 'lineHeight', 'paragraphSpacing',
    'contentWidth', 'fontWeight', 'fontFamily', 'latinSerif', 'latinSans', 'pagedMode'
  ];
  const MAX_PROFILES = 5;
  const MAX_PROFILE_NAME_LEN = 24;

  // 名稱正規化：去頭尾空白、壓成單一空白、截長。回 '' 代表不合法。
  function normalizeProfileName(name) {
    if (typeof name !== 'string') return '';
    return name.replace(/\s+/g, ' ').trim().slice(0, MAX_PROFILE_NAME_LEN);
  }

  // 從一份 settings 抽出 PROFILE_KEYS 快照（只帶存在的欄位，未定義者略過）。
  function snapshotProfileFields(settings) {
    const out = {};
    if (!settings || typeof settings !== 'object') return out;
    for (const k of PROFILE_KEYS) {
      if (settings[k] !== undefined) out[k] = settings[k];
    }
    return out;
  }

  // storage 讀回的 profiles 消毒：非陣列 / 元素損壞 / 名稱重複（首見者留）/
  // 超過上限一律修剪，回傳新陣列（不動原物件）。fields 只留白名單欄位。
  function sanitizeProfiles(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const p of raw) {
      if (!p || typeof p !== 'object') continue;
      const name = normalizeProfileName(p.name);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, fields: snapshotProfileFields(p.fields) });
      if (out.length >= MAX_PROFILES) break;
    }
    return out;
  }

  function findProfile(list, name) {
    const n = normalizeProfileName(name);
    if (!n) return null;
    for (const p of sanitizeProfiles(list)) if (p.name === n) return p;
    return null;
  }

  // 新增或覆寫（同名即覆寫、位置不變；新名稱附加在尾端）。超過上限回 null
  //（呼叫端據此 disable 儲存鈕），其餘回新陣列。
  function upsertProfile(list, name, fields) {
    const n = normalizeProfileName(name);
    if (!n) return null;
    const cur = sanitizeProfiles(list);
    const snap = snapshotProfileFields(fields);
    const idx = cur.findIndex((p) => p.name === n);
    if (idx !== -1) {
      cur[idx] = { name: n, fields: snap };
      return cur;
    }
    if (cur.length >= MAX_PROFILES) return null;
    cur.push({ name: n, fields: snap });
    return cur;
  }

  function removeProfile(list, name) {
    const n = normalizeProfileName(name);
    return sanitizeProfiles(list).filter((p) => p.name !== n);
  }

  const PROFILES = {
    KEYS: PROFILE_KEYS,
    MAX: MAX_PROFILES,
    MAX_NAME_LEN: MAX_PROFILE_NAME_LEN,
    normalizeName: normalizeProfileName,
    snapshot: snapshotProfileFields,
    sanitize: sanitizeProfiles,
    find: findProfile,
    upsert: upsertProfile,
    remove: removeProfile
  };

  // SW（globalThis）/ event page（window=globalThis）/ content script 都掛
  // globalThis；jsdom regression spec 走 module.exports。
  global.__JReadSettingsDefaults = DEFAULT_SETTINGS;
  global.__JReadCredentialSettingsKeys = CREDENTIAL_SETTINGS_KEYS;
  global.__JReadStripCredentialSettings = stripCredentialSettings;
  global.__JReadResolveFloatingIconEnabled = resolveFloatingIconEnabled;
  global.__JReadFontStacks = FONT_STACKS;
  global.__JReadProgressBarStyles = PROGRESS_BAR_STYLES;
  global.__JReadLegacyFontStacks = LEGACY_FONT_STACKS;
  global.__JReadLatinFonts = LATIN_FONTS;
  global.__JReadComposeFontStack = composeFontStack;
  global.__JReadProfiles = PROFILES;
  // module.exports 維持 === DEFAULT_SETTINGS（既有呼叫端契約，不可附掛其他 key
  // 否則污染 Object.keys / 被當設定欄位寫進 storage）。jsdom spec 需要 font
  // stacks 時 require 本檔後讀 globalThis.__JReadFontStacks。
  if (typeof module !== 'undefined' && module.exports) module.exports = DEFAULT_SETTINGS;
})(typeof globalThis !== 'undefined' ? globalThis : self);
