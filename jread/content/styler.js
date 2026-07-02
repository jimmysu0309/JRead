// JRead — 閱讀模式排版（瘦身版 / c 路線）
// 設計哲學：**盡量不動原站的內文排版**，只提供：
//   1. 讀者卡片容器（article card）——版心、背景、圓角、陰影、置中
//   2. 頁面 / 祖先鏈 reset——讓主文能脫離原 2-col layout 限制
//   3. 必要的「破壞站點 hack」——aspect-ratio placeholder、圖片超出版心
//   4. 使用者 override——依設定注入對應 CSS
// 「預設值＝不注入」原則的現況（v0.8.37 勘誤，舊敘述已過時）：theme /
// fontFamily / titleFontSize 仍維持「預設不動原站」；fontSize（v0.7.140 起，
// 預設 18 也注入、連帶 line-height）與 fontWeight（v0.7.254 起三段一律注入）
// 是刻意例外——理由見各注入點註解（原站非 400 字重 / px 鎖死行高等場景，
// 不注入會讓設定項看起來壞掉）。
// restore() 移除 style 元素與 attribute 即可完整還原，不動任何原 inline style
// （runtime inline override 都有 snapshot + priority 還原）。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  const STYLE_ID = '__jread-style';
  const HTML_CLASS = '__jread-active';
  const ARTICLE_ATTR = 'data-jread-active';
  const ANCESTOR_ATTR = 'data-jread-ancestor';
  const INLINE_IMG_ATTR = 'data-jread-inline-img';
  const INLINE_IMG_MAX = 48;
  // v0.8.90：作者刻意縮小的小圖（icon / 版面 badge / 作者頭像）標記。裸 img
  // （非 a 包）若原站把大來源圖「顯示縮小」到 < CONTENT_IMG_MIN，width:auto
  // 會退回 naturalWidth 反向放大成滿版巨圖（washingtonpost Opinion 區
  // lightbulb badge：HTML width=160 / CSS 顯示 56px / natural 1200 → 撐成 788px
  // 巨圖佔滿標題上方）。apply() 量 pre-reader rendered rect、natural 明顯大於
  // rendered 即標記並用 inline !important max-width 釘回原始顯示寬。
  const ICON_IMG_ATTR = 'data-jread-icon-img';
  const PLAYER_ATTR = 'data-jread-player';
  // v1.0.8：byline meta 區一行正規化標記（Jimmy 2026-06-25 autocar 作者欄要求）。
  // 站點 byline（kicker / 作者 / 日期 / 閱讀時間 / 小頭像）reader mode 下各自
  // block 散成多行、字級不一、頭像縮排。偵測「標題與第一段內文之間、含日期訊號」
  // 的 meta 區（結構訊號、非站點 class 特判），CSS flex 一行排列、字級統一、頭像
  // inline 對齊內容左緣、隱藏閱讀時間。BYLINE_ATTR=root（flex 容器）、
  // BYLINE_WRAP_ATTR=純 wrapper（display:contents 打平任意巢狀讓 leaf 升為 root 的
  // flex item）、BYLINE_ITEM_ATTR=可見 leaf（flex item）、BYLINE_RT_ATTR=閱讀時間
  // （CSS 隱藏）。
  const BYLINE_ATTR = 'data-jread-byline';
  const BYLINE_WRAP_ATTR = 'data-jread-byline-wrap';
  const BYLINE_ITEM_ATTR = 'data-jread-byline-item';
  const BYLINE_RT_ATTR = 'data-jread-byline-rt';
  // v1.5.28：byline 內「時刻」（HH:MM AM/PM TZ）子元素標記。閱讀模式的日期訊號
  //   保留日期即可、發稿時刻是雜訊（Jimmy 2026-07-02 NPR「1:59 PM ET」要求拿掉）。
  const BYLINE_TIME_ATTR = 'data-jread-byline-time';
  // v1.5.28：廣播節目出處 chip（"Heard on / Aired on <節目>"）標記——閱讀模式
  //   非必要 metadata（Jimmy 2026-07-02 NPR「HEARD ON MORNING EDITION」要求清）。
  const BYLINE_PROGRAM_ATTR = 'data-jread-byline-program';
  const BYLINE_PROGRAM_RE = /^(heard|aired|broadcast(?:ed)?)\s+on\b/i;
  // 節目出處連結 URL 訊號（翻譯無關——href 不會被 Shinkansen 翻譯，英文文字
  //   regex 在譯後 DOM 失效時靠這條接住）。NPR「Heard on」連到 /programs/<節目>/。
  const BYLINE_PROGRAM_URL_RE = /\/(programs?|shows?|podcasts?|episodes?)\//i;
  // v1.5.28：日期 item 標記——CSS order:1 把日期推到 byline 最後，作者（及頭像等
  //   其餘 item）維持預設 order:0 排在前，達成「作者排在日期前」（Jimmy 2026-07-02）。
  const BYLINE_DATE_ITEM_ATTR = 'data-jread-byline-date-item';
  // v1.5.28：分類 kicker / eyebrow 標記——標題「之前」、連到分類頁的短連結
  //   （NPR「BUSINESS」→ /sections/business/）。閱讀模式移除（Safari / Firefox
  //   Reader 同做法）。Jimmy 2026-07-02。SECTION_URL_RE：分類頁 URL 慣例（href
  //   不被翻譯，譯後 DOM 照樣命中）。
  const KICKER_ATTR = 'data-jread-kicker';
  const SECTION_URL_RE = /\/(sections?|category|categories|topics?)\//i;
  // 日期訊號（DD Mon YYYY / Mon DD, YYYY / YYYY-M-D / YYYY年M月D日）——byline root
  // 偵測的錨點。閱讀時間（N min(s) read / 閱讀時間 / N 分鐘閱讀）——byline 內隱藏。
  const BYLINE_DATE_RE = /(\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\s+\d{4}\b)|((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\s+\d{1,2},?\s+\d{4})|(\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b)|(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/i;
  const BYLINE_RT_RE = /\b\d+\s*min(ute)?s?\s+read\b|閱讀時間|\d+\s*分鐘閱讀/i;
  // 時刻訊號：整段直接文字＝「HH:MM(:SS)? (AM/PM)? TZ?」（例 "1:59 PM ET"、
  //   "13:59"、"9:30 a.m. EST"）。冒號是關鍵——日期字串無冒號，故不誤殺日期。
  const BYLINE_TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\s*[a-z]{0,5}$/i;
  // v0.8.86：responsive embed（relative wrapper + position:absolute iframe 填滿
  // 16:9 padding-bottom hack）的 iframe 標記。apply() 量到 computed
  // position:absolute 的 article iframe 標此 attr，CSS 把它 pin 回 inset:0
  // 填滿 wrapper——否則媒體置中規則的 margin:auto 對 abs-pos iframe 會解出
  // 非零 left/right 把 iframe 推出 wrapper 偏右破版（thenewslens 實證）。
  const FILL_IFRAME_ATTR = 'data-jread-fill-iframe';
  // v0.8.49：「div 當段落」標記。部分 CMS（upmedia 等）把主文段落輸出成無
  // class 的裸 <div>（不是 <p>），BODY_TEXT_SEL 列舉的段落 tag 都不命中 →
  // 使用者 fontSize / fontFamily / lineHeight / fontWeight 設定對主文整段失效、
  // 保留站點字級（upmedia 22px vs 設定 18px，體感「特別大」）。CSS 無法選
  // 「直接含文字的 div」，apply() 在 ARTICLE_ATTR 設定前（reader 規則尚未
  // 生效、量得到原站字級）runtime 標記，BODY_TEXT_CORE 把 marker 納入。
  const TEXT_DIV_ATTR = 'data-jread-text-div';

  // v0.8.35：媒體 display/cap 規則的 selector 群——base（90vh cap）與翻頁模式
  // （單頁 cap 覆寫）共用同一份。翻頁模式覆寫靠「同 selector、同 specificity、
  // 同 stylesheet 後注入者勝」。原 bug：翻頁媒體規則用 html 前綴、specificity
  // (0,2,2)，輸給 base 的 (0,3,3)（:not(a > img) 依 Selectors 4 取引數最高
  // specificity 計入 2 個 type、加 3 個 attribute），兩邊都 !important →
  // specificity 高者勝、base 90vh 蓋掉翻頁單頁 cap——裸 img（非 a 包）站的
  // 直式長圖有效上限 90vh > 欄高、break-inside: avoid 對高於 fragmentainer
  // 的元素失效、圖被跨頁切割。a-wrapped 大圖走 content-img rule (0,2,1)、
  // 翻頁規則本來就贏，所以 Substack 類測試站全綠、裸 img 站才現形。
  // 抽常數讓兩處逐字同一份，杜絕 selector drift。
  const MEDIA_CAP_SEL =
    `[${ARTICLE_ATTR}="1"] img:not(a > img):not([${PLAYER_ATTR}="1"]):not([${INLINE_IMG_ATTR}]),
[${ARTICLE_ATTR}="1"] video:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] picture:not([${PLAYER_ATTR}="1"])`;

  // v0.8.37：preserve `:not()` 鏈由共用 tag 群組生成（原本三條鏈各自手寫、
  // 已實際 drift 過一次：v0.7.195 TWZ figcaption——bg strip 排除了 figcaption、
  // color inherit 沒跟上，圖說白字配深底變不可讀）。三條鏈的集合「刻意」不同：
  //   - bg / border strip 保留 figure/summary/blockquote 的原站背景與框線
  //   - color inherit 不排除它們（引述等文字要繼承 reader text color）、
  //     但排除 a（連結色另有顯式規則）與 figcaption（背景文字成對保留）
  // 改 tag 群組時三條鏈自動同步；要改單一鏈的集合請動下方組合、不要繞過群組。
  const TABLE_TAGS = ['table', 'thead', 'tbody', 'tr', 'th', 'td'];
  const CODE_TAGS = ['code', 'pre'];
  const INLINE_SEMANTIC_TAGS = ['mark', 'kbd'];
  const MEDIA_SEMANTIC_TAGS = ['figure', 'figcaption', 'summary', 'blockquote'];
  const notChain = (tags) => tags.map((t) => `:not(${t})`).join('');
  const BG_PRESERVE_NOT = notChain([...MEDIA_SEMANTIC_TAGS, ...CODE_TAGS, ...TABLE_TAGS, ...INLINE_SEMANTIC_TAGS]);
  const BORDER_PRESERVE_NOT = notChain([...MEDIA_SEMANTIC_TAGS, ...CODE_TAGS, ...TABLE_TAGS, ...INLINE_SEMANTIC_TAGS, 'hr']);
  const COLOR_PRESERVE_NOT = notChain(['a', ...CODE_TAGS, ...TABLE_TAGS, ...INLINE_SEMANTIC_TAGS, 'figcaption']);

  // v0.8.37：垂直 gutter 單一資料源——base 卡片 padding / 翻頁卡片「下緣」padding /
  // 翻頁媒體單頁 cap 的 calc 必須同一值（與 H_GUTTER 同款 drift 防護；v0.8.1
  // 事故：改了連續模式 gutter、翻頁漏改，兩模式行寬 drift）。
  // v1.5.2：翻頁卡片「上緣」改用 PAGED_TOP_GUTTER（較小）——其餘三處仍是 V_GUTTER。
  const V_GUTTER = 'min(48px, 6vw)';
  // v1.5.2：分頁模式「上緣」gutter——比 V_GUTTER 收斂，把拿掉頂端進度條後騰出的
  // 區域讓給文章排版（文章往上長、每頁多容幾行；Jimmy 2026-06-27）。只收上緣、
  // 下緣維持 V_GUTTER 給底部頁碼指示器留呼吸空間（上下不對稱由底部頁碼平衡）。
  // 保留 ~16px 上緣不貼齊螢幕頂、避免首行壓到 Safari 工具列收合動態邊。
  const PAGED_TOP_GUTTER = 'min(16px, 2vw)';
  // v1.5.3：reader 文章頁（article feed 點進的單篇，NS.state.readerHostPage）拿掉
  // 左上角返回箭頭後，捲動模式卡片「上緣」同樣收斂——與翻頁上緣共用同一「頂端無
  // chrome 時的緊縮上緣」值（單一資料源、避免兩處 drift），標題往上移、每屏多容幾行。
  // 只套 reader 文章頁；一般網站閱讀模式維持 V_GUTTER（opts.readerHostPage gate）。
  const READER_HOST_TOP_GUTTER = PAGED_TOP_GUTTER;
  // 大內容圖（lightbox / photoswipe 等 `<a>` 包圖結構）標記：apply() runtime 量到
  // >= CONTENT_IMG_MIN 的 a-wrapped img 標 [CONTENT_IMG_ATTR]，讓 block + margin
  // 規則對它生效（一般 img:not(a > img) 排除把這類大圖當 icon-link 漏掉）。
  const CONTENT_IMG_ATTR = 'data-jread-content-img';
  const CONTENT_IMG_MIN = 200; // 任一維 >= 200px 視為內容照片、非 icon（icon 規則上限 200）
  // v0.8.112：bare img（非 a 包）來源解析度小於版心時的「放大填滿欄寬」標記。
  // 站點常把低解析配圖（natural < 版心寬）以原尺寸或小幅放大顯示——reader 的
  // img:not(a>img) 走 width:auto 退回 naturalWidth，這類圖在 720 版心裡顯得特別
  // 小、與 a 包大圖（填滿欄寬）視覺不一致（womany 卡蘿配圖 natural 285px portrait
  // 在 608px 欄中只佔半寬實證）。apply() 量到 content-size（>= CONTENT_IMG_MIN 一維）
  // 的 bare 圖標此 attr、CSS 強制 width:100% 撐滿欄寬。與 a 包 content-img 視覺一致
  // （Safari / Firefox 閱讀模式同款「內容圖一律填欄寬」）。capIcon（natural >> rendered
  // 的作者刻意縮小大圖）已在分類前攔截、不會落到這裡被反向放大成滿版。
  const UPSCALE_IMG_ATTR = 'data-jread-upscale-img';

  // 內嵌襯線 CJK 字型（Noto Serif TC 全 TC 集，woff2）。
  // 為什麼必須內嵌：iOS Safari「網頁路徑」的預設襯線字型缺「夠」「查」等常用字的
  // 字形，這些字 fall back 到蘋方黑體（iOS 模擬器實證）；且 Safari 網頁不理會
  // CSS 指定的系統字型名稱（"Songti TC" 等一律 resolve 到那套有缺漏的預設 serif），
  // 所以「只點名不載入」在 iOS 上無效。@font-face 把字型實體載進來、由 JRead 自己
  // 掌控覆蓋率，才能跟 iOS 內建閱讀模式一樣零缺字。family 名稱用 "Noto Serif TC"
  // 對齊 popup 襯線 stack 裡的 CJK family 名（v0.8.25 起西文襯線 Georgia/Times 排在
  // 前面、英文 fall back 到 Georgia；中文逐字 fallback 穿到此內嵌字型）。
  //
  // v0.7.257：三個真實字重各一個靜態字面（Light 300 / Regular 400 / SemiBold 600，
  // 同一份 6606 字覆蓋、由 Noto Serif TC 可變字型 pin 出）。為什麼不能沿用舊版
  // 單一 face + 一個涵蓋 100~900 整段範圍的 weight 宣告：那寫法告訴瀏覽器「這一個
  // 字面已涵蓋整段範圍」，於是使用者選的細(300)/中(400)/粗(600) 全被對映到同一字面、
  // 且關閉 faux-bold 合成——襯線字重三段渲染完全相同（Jimmy 2026-06-08 回報「襯線
  // 字重沒效果」的根因；無襯線走系統字 PingFang/JhengHei 有真實多字重故正常）。字重
  // 無法無中生有（瀏覽器只能合成較粗、不能變細），故三段都內嵌真實字面才能各有差別。
  // 三檔都用 font-display: swap + lazy-load——只有選「襯線」用到此 family 時才下載，
  // 預設無襯線使用者零成本。chrome.runtime.getURL guard：extension context 失效時退回
  // 空字串（不注入）。三個 @font-face 同 family 名、各自 font-weight 單值，瀏覽器依
  // BODY_TEXT_SEL 注入的 font-weight 精準命中對應字面。
  let FONT_FACE_CSS = '';
  try {
    if (browser && browser.runtime && browser.runtime.id && browser.runtime.getURL) {
      const faces = [
        { weight: 300, file: 'noto-serif-tc-light.woff2' },
        { weight: 400, file: 'noto-serif-tc-regular.woff2' },
        { weight: 600, file: 'noto-serif-tc-semibold.woff2' },
      ];
      FONT_FACE_CSS = faces.map((f) => `@font-face {
  font-family: "Noto Serif TC";
  font-style: normal;
  font-weight: ${f.weight};
  font-display: swap;
  src: url("${browser.runtime.getURL('assets/fonts/' + f.file)}") format("woff2");
}
`).join('');
    }
  } catch (e) {
    FONT_FACE_CSS = '';
  }

  // v0.8.146：內嵌拉丁可變字型（Latin-subset woff2，皆 OFL）。襯線群 Source Serif /
  // Piazzolla、無襯線群 Public Sans / Source Sans——由 popup「英文字型」
  // 選單選定（latinSerif / latinSans），composeFontStack 把選定 family 前接到 base
  // stack 前，故 opts.fontFamily 會含 "Family" 字面。family 名對齊 LATIN_FONTS 的值。
  //
  // 與 Noto 三靜態字面不同：這五支都是真·可變字型（wght 軸），單一 @font-face 用
  // weight range 即真實多字重（細 300 / 中 400 / 粗 600 各有差別），不會踩 v0.7.257
  // 那個「單一字面涵蓋整段 weight → 三段渲染相同」的坑（範圍是字面真實 fvar 軸、
  // 非假裝涵蓋的靜態 pin）。font-display: swap + lazy-load——@font-face 只在 stack
  // 實際引用該 family 時才下載，故只注入「被選到」的那一支（latinFontFaceFor 掃描
  // opts.fontFamily），不像 Noto 三檔同 family 必須一起宣告。
  const BUNDLED_LATIN_FACES = {
    'Source Serif': { file: 'source-serif.woff2', range: '200 900' },
    'Piazzolla':    { file: 'piazzolla.woff2',    range: '100 900' },
    'Public Sans':  { file: 'public-sans.woff2',  range: '100 900' },
    'Source Sans':  { file: 'source-sans.woff2',  range: '200 900' },
  };
  function latinFontFaceFor(fontStack) {
    if (!fontStack) return '';
    let css = '';
    try {
      if (browser && browser.runtime && browser.runtime.id && browser.runtime.getURL) {
        for (const family of Object.keys(BUNDLED_LATIN_FACES)) {
          if (fontStack.indexOf('"' + family + '"') === -1) continue;
          const def = BUNDLED_LATIN_FACES[family];
          css += `@font-face {
  font-family: "${family}";
  font-style: normal;
  font-weight: ${def.range};
  font-display: swap;
  src: url("${browser.runtime.getURL('assets/fonts/' + def.file)}") format("woff2");
}
`;
        }
      }
    } catch (e) {
      css = '';
    }
    return css;
  }

  // 預設值。theme / fontFamily / titleFontSize：預設＝「未設定」、對應 CSS 不
  // 注入（保留原站樣式）；fontSize / fontWeight 為刻意例外、預設也注入——
  // 見檔頭設計哲學與各注入點註解（v0.8.37 勘誤舊「全部不注入」敘述）。
  const DEFAULTS = {
    theme: 'light',
    fontSize: 18,
    contentWidth: 720,
    fontFamily: 'system-ui',
    // v0.7.254：字重三段。300 = 細 / 400 = 中（預設）/ 600 = 粗（Semibold）。改用
    // 真正的 font-weight（取代 v0.7.157 boldText 的 -webkit-font-smoothing——後者
    // 只在 macOS 有視覺差異，Windows / Linux / iOS 看不出來，與 Jimmy「全平台適用」
    // 需求衝突）。三段一律注入（含 400）——見 buildCss 內 font-weight 注入註解。
    fontWeight: 400,
    lineHeight: 1.7,
    // 段落間距（p / ul / ol / blockquote margin-bottom，em 為單位）。預設 1.0em
    // 對齊 user-agent stylesheet p margin，貼近大眾預期；多數新聞站本來就有此
    // margin、覆寫差別極小，BBC styled-components 把 p margin 砍光從 0 變 1em
    // 是明顯改善。popup 可調 0 ~ 3.0、auto sentinel = -1（不注入此規則保留原站）。
    paragraphSpacing: 1.0,
    // 中英文字之間自動補空白（盤古之白）。預設 true—— 大部分台灣 / 港澳 / 中文
    // 讀者習慣這種視覺節奏，原始網站常缺空格（特別是 CMS / SPA 編輯器寫入時）。
    // 使用者可到 options 取消。詳見下方 pangu module。
    pangu: true,
    // 標題字級（h1）。0 = Auto（保留原站標題大小）；非 0 = 強制覆寫 h1
    // font-size 為該 px 值。使用者 body fontSize 調到 40px+ 時原站 h1 常只有
    // 30-36px，標題反而比內文小——此設定讓使用者自訂標題大小。
    titleFontSize: 0
  };

  // 主題配色：僅 dark / sepia 會注入文字 + 卡片底色覆寫；light 不碰原站色
  //   link：dark / sepia 下因 `* { color: X }` 吞掉原站 link 顏色，導致內文連結
  //   跟正文完全同色無法辨識。必須回補一個在該 theme 下夠對比的 link 色。
  //   light 不注入（light 連文字色都不注入，保留原站 link 色）。
  //   dark #7fb5e6：在 #1a1a1a 底對比 > 7:1
  //   sepia #2c5282（JRead primary-700）：在 #eee2cb 底對比 > 6:1
  //   scrollThumb：v0.7.90 auto-hide scrollbar 顯色用，配 page bg 對比夠辨識
  //   又不過度搶眼。dark theme 用淺色 thumb、light/sepia 用深色 thumb。
  const THEMES = {
    // v0.8.143：白色閱讀區內文段落字色對齊 Apple Books 純黑 #000000（Jimmy 截圖
    //   逐像素採樣：背景 #ffffff、內文 glyph core 主色 #000000）。light 維持
    //   text: null（仍是「保留原站色」主題、保留 pre/table 對比保護 + figcaption
    //   #333 機制），另用 proseText 只對內文段落容器（p / 標題 / li …）強制黑字，
    //   不碰 pre/code/table/figcaption/彩色 inline span（Jimmy 選折衷方案）
    light: { pageBg: '#ececec', articleBg: '#ffffff', text: null, proseText: '#000000', link: '#1a73e8', scrollThumb: 'rgba(0, 0, 0, 0.3)', inlineCodeBg: 'rgba(0,0,0,0.06)', codeBlockBg: 'rgba(0,0,0,0.05)', progressBar: '#4A90D9' },
    // v0.8.143：暗色閱讀區配色對齊 Apple Books——底 #4a494d、內文 #ecebf1
    //   （Jimmy 截圖逐像素採樣：背景主色 #4a494d 帶微冷調、內文 #ecebf1）。
    //   原 #1a1a1a/#d4d4d4 偏黑，Apple Books 是中性偏亮的深灰底 + 近白字
    dark:  { pageBg: '#0b0b0b', articleBg: '#4a494d', text: '#ecebf1', link: '#7fb5e6', scrollThumb: 'rgba(255, 255, 255, 0.3)', inlineCodeBg: 'rgba(255,255,255,0.1)', codeBlockBg: 'rgba(0,0,0,0.22)', progressBar: '#7fb5e6' },
    // v0.8.143：米色閱讀區配色對齊 Apple Books——底 #eee2cb、內文純黑 #000000
    //   （Jimmy 截圖逐像素採樣：背景 5 點皆 #eee2cb、內文 glyph core 主色 #000000）
    sepia: { pageBg: '#cdb891', articleBg: '#eee2cb', text: '#000000', link: '#2c5282', scrollThumb: 'rgba(60, 50, 38, 0.45)', inlineCodeBg: 'rgba(60,50,38,0.08)', codeBlockBg: 'rgba(60,50,38,0.1)', progressBar: '#2c5282' },
    // v0.8.143：灰色主題對齊 Apple Books 灰色配色——底 #ededed、內文純黑 #000000
    //   （Jimmy 截圖逐像素採樣：背景 #ededed、內文 glyph core 主色 #000000）。
    //   中性灰、無暖色；text 非 null 故比照 dark/sepia 注入文字 + 卡片色覆寫
    gray:  { pageBg: '#d8d8d8', articleBg: '#ededed', text: '#000000', link: '#2c5282', scrollThumb: 'rgba(0, 0, 0, 0.3)', inlineCodeBg: 'rgba(0,0,0,0.06)', codeBlockBg: 'rgba(0,0,0,0.08)', progressBar: '#2c5282' }
  };

  function themeOf(name) {
    return THEMES[name] || THEMES.light;
  }

  // v0.8.24：覆蓋 <meta name="theme-color">——iOS Safari 拿這個 meta 的色去染
  // 狀態列與底部工具列（網頁背景以外的「瀏覽器 chrome」區域）。原站宣告的品牌色
  // （chinatalk.media #f9eedc 米色實測）在閱讀模式下會在螢幕上下端露出，與 reader
  // card 不一致（特別是分頁模式 card 滿版 inset:0、上下米條格外突兀）。閱讀模式下
  // 把所有 theme-color meta 的 content 改成 reader card 色（theme.articleBg），退出
  // 還原。通則：對任何有宣告 theme-color 的站一律生效，不綁站點。
  //
  // 站點可能宣告多個 theme-color（light / dark media 變體）——全部覆蓋成同一個
  // JRead 色（reader card 色不隨裝置 scheme 變，覆蓋後不論 Safari 選哪個都是 JRead
  // 色）。完全沒宣告時自建一個（Safari 預設用白底染 chrome，自建才染得到 reader 色）。
  // 回傳 snapshot 供 restore：created=true 的移除、其餘還原原 content。
  function applyThemeColor(color) {
    if (typeof document === 'undefined') return null;
    const snap = [];
    const head = document.head || document.documentElement;
    const existing = head ? head.querySelectorAll('meta[name="theme-color"]') : [];
    if (existing && existing.length) {
      for (const m of existing) {
        snap.push({ el: m, prev: m.getAttribute('content'), created: false });
        m.setAttribute('content', color);
      }
    } else if (head) {
      const m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      m.setAttribute('content', color);
      head.appendChild(m);
      snap.push({ el: m, prev: null, created: true });
    }
    return snap;
  }
  function restoreThemeColor(snap) {
    if (!Array.isArray(snap)) return;
    for (const s of snap) {
      if (!s || !s.el) continue;
      if (s.created) {
        s.el.remove();
      } else if (s.prev === null) {
        s.el.removeAttribute('content');
      } else {
        s.el.setAttribute('content', s.prev);
      }
    }
  }

  // v0.8.139：正規化 host 頁 viewport meta = width=device-width, initial-scale=1。
  // iOS Safari（與其他行動瀏覽器）拿 viewport meta 算 layout viewport 寬度與初始
  // 縮放。站點若宣告 initial-scale < 1（daringfireball `initial-scale=0.5`、故意讓
  // 寬版面在手機縮一半顯示）、width 為固定值（width=980）、或根本沒宣告（Safari
  // 預設用 980px layout viewport 再縮到螢幕寬），reader card 換成行動寬度後整張卡
  // 仍被釘在縮小的初始縮放上，視覺上「縮小一半」。閱讀模式下強制行動標準 viewport，
  // 退出還原。桌面瀏覽器忽略 viewport meta → 此覆寫對桌面 no-op。通則：對任何
  // viewport 非行動標準的站一律生效，不綁站點。
  //
  // 沒宣告 viewport meta 時自建一個（Safari 預設 980px layout viewport，不自建
  // 覆蓋不到）。多個 viewport meta（理論少見）全部正規化。回傳 snapshot 供 restore：
  // created=true 的移除、其餘還原原 content。
  const READER_VIEWPORT = 'width=device-width, initial-scale=1';
  function applyViewportFix() {
    if (typeof document === 'undefined') return null;
    const head = document.head || document.documentElement;
    if (!head) return null;
    const snap = [];
    const existing = head.querySelectorAll('meta[name="viewport"]');
    if (existing && existing.length) {
      for (const m of existing) {
        snap.push({ el: m, prev: m.getAttribute('content'), created: false });
        m.setAttribute('content', READER_VIEWPORT);
      }
    } else {
      const m = document.createElement('meta');
      m.setAttribute('name', 'viewport');
      m.setAttribute('content', READER_VIEWPORT);
      head.appendChild(m);
      snap.push({ el: m, prev: null, created: true });
    }
    return snap;
  }
  function restoreViewport(snap) {
    if (!Array.isArray(snap)) return;
    for (const s of snap) {
      if (!s || !s.el) continue;
      if (s.created) {
        s.el.remove();
      } else if (s.prev === null) {
        s.el.removeAttribute('content');
      } else {
        s.el.setAttribute('content', s.prev);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // v0.7.225：保留原站色容器的對比守門（contrast guard）
  // Trigger：Jimmy 2026-06-07 回報 blog.tymscar.com（dark scheme）code block
  // 在 light theme reader card 內幾乎全白不可讀。
  //
  // Root cause（通則，非站點特例）：styler 刻意保留 pre / table 的原站文字色
  // （syntax highlight / 表格設計），但這些色是配合「原站 effective 背景」設計
  // 的。站點走 prefers-color-scheme: dark 時 token 色為淺色、背景常是
  // 「半透明白疊深色 body」（tymscar 實測 pre bg = srgb 5% 白、body #1a1a1a，
  // 對比 4.6~16.3:1）。reader card 強制白底後半透明 bg 疊白 = 白，token 色
  // 不變 → 對比掉到 1.07~3.79:1。
  //
  // 修法：apply() 注入 CSS 前先量每個 pre / table 的「原始 effective bg」
  // （往上爬 ancestor、半透明圖層 alpha 合成）+ 文字載體色與字數；注入後以
  // card bg 為基底重算新 effective bg。若「大部分文字對新 bg 不可讀（< 3:1
  // 占比 >= 40%）、但對原始 bg 可讀」→ 把原始 bg 用 inline !important 還給
  // 該容器，保留原站 syntax highlight 設計。restore() 對稱還原。
  //
  // 訊號層次（明確標注，見 CLAUDE.md 工作流原則 3）：
  //   本 guard 驗「pre / table 內文字 vs effective bg 的 WCAG 對比」一層；
  //   不驗 figcaption / mark / kbd（同樣保留原站色但無回報案例、修法形狀不同
  //   ——bg 還原對 caption 會出現突兀色塊，應改覆寫文字色）、不驗圖片 / iframe
  //   內部內容（jread 摸不到）。
  //   dark / sepia theme 不走本 guard——v0.8.45 起由 apply() 內獨立的
  //   「dark contrast 兜底層」（phase 3）負責：那層掃全 card 直接文字載體、
  //   對 effective bg 對比 < 3:1 才 inline 修文字色（2026-06-11 page rounds
  //   12 站 dark E1 整治；twz 站點 (0,3,0) !important rule 類 cascade 輸局
  //   只有 inline !important 能終結）。
  //
  // 保守邊界：站點「原本就低對比」（lowOrig >= 0.4）不觸發——那是站點自己的
  // 設計，jread 沒有破壞它就不該動；無 opaque bg 且靠 color-scheme: dark 讓
  // canvas 變深的站，origBg 會誤算成白 → lowOrig 高 → guard 保守不動（漏修
  // 但不誤傷）。
  const CONTRAST_GUARD_SEL = 'pre, table';
  const CONTRAST_MIN_RATIO = 3;       // < 3:1 視為不可讀（WCAG 大字 / UI 元件下限）
  const CONTRAST_LOW_FRACTION = 0.4;  // 低對比文字字數占比 >= 40% 才觸發
  const CONTRAST_MAX_TARGETS = 20;    // 每頁最多處理 20 個容器（效能上限）
  const CONTRAST_MAX_CARRIERS = 80;   // 每容器最多取 80 個文字載體
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };

  // 解析 getComputedStyle 回傳的色字串。涵蓋 Chrome 兩種 serialization
  // （legacy comma rgb/rgba、wide-gamut color(srgb ... / a)——站點 CSS 用
  // color-mix / 相對色語法時 computed 會是後者，tymscar 實測命中）+ theme
  // 常數的 hex。解析失敗回 null（呼叫端視為 transparent / 跳過）。
  function parseCssColor(str) {
    if (!str) return null;
    const s = String(str).trim();
    let m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
    if (m) {
      const a = m[4] === undefined ? 1
        : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return { r: +m[1], g: +m[2], b: +m[3], a };
    }
    m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)$/i);
    if (m) {
      const a = m[4] === undefined ? 1
        : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return { r: Math.round(+m[1] * 255), g: Math.round(+m[2] * 255), b: Math.round(+m[3] * 255), a };
    }
    m = s.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
    }
    if (/^transparent$/i.test(s)) return { r: 0, g: 0, b: 0, a: 0 };
    return null;
  }

  // fg 疊在 bg 上的 alpha 合成（簡化：bg 視為 opaque 基底）
  function blendOver(fg, bg) {
    const a = fg.a;
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1
    };
  }

  function relLuminance(c) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  function contrastRatio(c1, c2) {
    const l1 = relLuminance(c1), l2 = relLuminance(c2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  // 從 el 往上收集 background-color 圖層到 stopEl（exclusive）/ body 為止，
  // 由外而內疊在 baseColor 基底上 → 回傳該元素的 effective 背景色。
  // 遇 opaque 圖層提前停（更外層不影響視覺）。
  // skipFn（選填）：回傳 true 的層忽略其 bg——dark 兜底層用來按「jread 規則
  // 的目標狀態」計算（會被背景中和規則打 transparent 的層不計入），見
  // phase 3 註解的 SPA cascade 時序坑。
  function compositeBgOver(el, stopEl, baseColor, win, skipFn) {
    const layers = [];
    let opaqueFound = false;
    let cur = el;
    while (cur && cur !== stopEl && cur.nodeType === 1) {
      if (!(skipFn && skipFn(cur))) {
        const c = parseCssColor(win.getComputedStyle(cur).backgroundColor);
        if (c && c.a > 0) {
          layers.push(c);
          if (c.a >= 0.999) { opaqueFound = true; break; }
        }
      }
      if (cur === win.document.body) break;
      cur = cur.parentElement;
    }
    let base = opaqueFound ? { r: 0, g: 0, b: 0, a: 1 } : { ...baseColor };
    for (let i = layers.length - 1; i >= 0; i--) base = blendOver(layers[i], base);
    return base;
  }

  // 收集容器內的文字載體：自身 direct textNode 有內容的元素 + 其 computed
  // color，字數作對比統計權重。direct text（不抓子孫）避免 wrapper 重複計數。
  // 保留 el reference——phase 2 必須**重新**讀注入後的 computed color，不能
  // 沿用此處量到的原始色：沒有自己 color 的元素（td 等）注入後自然繼承 card
  // 深字（color: inherit 規則的 :not(td) 排除只是「不強制」，自然繼承照走
  // 新 cascade）。用 phase 1 舊色判定會誤觸發——tymscar table 實測修壞：
  // guard 誤還原深 bg、td 實際已是深字 → 深底深字 1:1（CONTRAST AUDIT 抓到）。
  function collectTextCarriers(target, win) {
    const carriers = [];
    const els = [target, ...target.querySelectorAll('*')];
    for (const el of els) {
      if (carriers.length >= CONTRAST_MAX_CARRIERS) break;
      const tag = el.tagName.toUpperCase();
      if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'NOSCRIPT' || tag === 'TITLE' || tag === 'DESC') continue;
      if (el.closest && el.closest('[data-jread-hidden="1"]')) continue;
      let len = 0;
      for (const n of el.childNodes) {
        if (n.nodeType === 3) len += n.textContent.trim().length;
      }
      if (!len) continue;
      const col = parseCssColor(win.getComputedStyle(el).color);
      if (!col || col.a < 0.5) continue; // 透明文字不計
      carriers.push({ el, origColor: col, len });
    }
    return carriers;
  }

  // 低對比文字占比：對 bg 對比 < CONTRAST_MIN_RATIO 的字數 / 總字數。
  // colorKey 選用哪個時間點的色：'origColor'（phase 1 注入前）或
  // 'newColor'（phase 2 注入後重量、繼承已走新 cascade）。
  function lowContrastFraction(carriers, bg, colorKey) {
    let low = 0, total = 0;
    for (const c of carriers) {
      const col = c[colorKey];
      if (!col) continue;
      total += c.len;
      if (contrastRatio(col, bg) < CONTRAST_MIN_RATIO) low += c.len;
    }
    return total > 0 ? low / total : 0;
  }

  // v0.8.18 C6：base 骨架 memoize cache（theme 物件 → Map(contentWidth → base 字串)）。
  // base 只依賴 theme + contentWidth，3 個 THEMES 是穩定 module 物件、可當 WeakMap key。
  const _baseSkeletonCache = new WeakMap();
  function baseSkeletonCacheGet(theme, contentWidth) {
    const m = _baseSkeletonCache.get(theme);
    return m ? m.get(contentWidth) : undefined;
  }
  function baseSkeletonCacheSet(theme, contentWidth, base) {
    let m = _baseSkeletonCache.get(theme);
    if (!m) { m = new Map(); _baseSkeletonCache.set(theme, m); }
    m.set(contentWidth, base);
  }

  function buildCss(theme, opts, overrides) {
    const { contentWidth } = opts;

    // 水平 gutter（reader card 左右內距）單一資料源。連續滑動（base 卡片
    // padding）與翻頁模式（左 padding + 右 transparent border + column-gap +
    // column-width 扣除）必須用同一值，否則兩模式內文行寬會 drift——v0.8.1 把
    // 連續模式 gutter 從 min(56px,6vw) 改成 clamp(16px,…,56px)（390pt 內文對齊
    // 原站 16px 標準 gutter），但翻頁模式漏改、仍停在舊 min(56px,6vw)（390pt
    // 留 23.4px），導致「翻頁比捲動窄」（Jimmy 2026-06-09 roomie.tw 回報）。
    // 抽成常數讓兩條 path 共用、杜絕未來再 drift。clamp 線性段斜率對齊 933px
    // 桌面門檻（>= 933px 仍 56px、桌面卡片美學不變），floor 16px = 行動版主文
    // 業界標準左右 gutter。結構性條件（viewport 寬 + 標準 gutter 常數），不綁平台。
    const H_GUTTER = 'clamp(16px, calc(7.4vw - 12.8px), 56px)';

    // ---- 骨架：頁面 reset + 祖先鏈 reset + 卡片容器（永遠注入）----
    // v0.8.18 C6：base 骨架只依賴 theme + contentWidth（不含 fontSize / lineHeight
    // / fontFamily / pagedMode 等使用者變數），~800 行卻每次 apply() 重組。改成以
    // (theme, contentWidth) memoize：同組合只算一次，使用者調字級 / 字型 / 行距
    // （只動 userOverrides）時 base 直接命中 cache、不再重建。輸出逐字相等
    // （tools/probe-c6-buildcss.js 驗過 27 組 snapshot identical）。
    let base = baseSkeletonCacheGet(theme, contentWidth);
    if (base === undefined) {
      base = `
/* 補 cleaner hide 漏洞：cleaner 只設 inline style.display = 'none' 無
   !important，站點 JS（例如商周 .postnav.fixed 的 scroll handler 主動
   el.style.display = 'block'）會把 inline display 整個覆寫掉、priority
   被清除。stylesheet 的 !important 優先級 > inline 無 priority 值，是
   browser 層級的勝利機制，擋得住 JS 再次覆寫。通則對付任何站點
   scroll / resize / timer 類 handler 重設 hide 過元素 display 的情境。 */
[data-jread-hidden="1"] {
  display: none !important;
}
#${PROGRESS_ID} {
  position: fixed;
  top: 0;
  left: 0;
  height: 3px;
  width: 0%;
  background: ${theme.progressBar};
  z-index: 2147483647;
  pointer-events: none;
}
/* v0.7.216：Space 段落焦點指示條（space-scroll.js 建立 / 定位元素，CSS rule
   放這裡跟 #__jread-progress 共用 theme.progressBar 色——單一資料源，主題
   切換 reapply 重建 stylesheet 自動跟色）。position: absolute 文件座標，
   卷動時黏著段落；top / height 加 transition，焦點換段落時平滑滑移。 */
#__jread-focus-bar {
  position: absolute;
  width: 4px;
  border-radius: 2px;
  background: ${theme.progressBar};
  z-index: 2147483646;
  pointer-events: none;
  transition: top 0.25s ease, height 0.25s ease;
}
/* SPA 站（Readwise Reader / Notion / Gmail 等）常把 html / body 設
   overflow: hidden、scroll 交給內層 div。reader mode 注入 article card 後
   body 高度被撐開、但 overflow-y:hidden 仍鎖住整個 viewport 無法捲動。
   通則：reader mode 強制 html / body 兩者 overflow-y: visible，scroll
   回到 viewport 層級。overflow-x:hidden 保留避免主文超寬橫向拉條。 */
html.${HTML_CLASS} {
  background: ${theme.pageBg} !important;
  overflow-y: visible !important;
}
html.${HTML_CLASS} body {
  background: ${theme.pageBg} !important;
  margin: 0 !important;
  padding: 0 !important;
  max-width: none !important;
  width: auto !important;
  min-width: 0 !important;
  overflow-x: hidden !important;
  overflow-y: visible !important;
}
/* v0.7.90：auto-hide scrollbar——SPA 站常用 scrollbar-width: none /
   ::-webkit-scrollbar display: none 隱藏整個 scroll bar，reader mode
   啟動後使用者捲動時看不到任何 indicator。對策：
     1. scrollbar-width: thin override 站點 hide
     2. webkit ::-webkit-scrollbar 自製 8px 細條
     3. thumb 預設 transparent，html 帶 [data-jread-scrolling="1"] 時顯色
     4. styler 端攔 scroll event 加 attr、800ms idle 後移除
     5. transition 0.3s 達到 fade-in/out，不打擾閱讀
   thumb 色按主題：light/sepia 用深色（rgba 黑/sepia text）、dark 用淺色。 */
html.${HTML_CLASS} {
  scrollbar-width: thin !important;
  scrollbar-color: transparent transparent !important;
  transition: scrollbar-color 0.3s ease !important;
}
html.${HTML_CLASS}[data-jread-scrolling="1"] {
  scrollbar-color: ${theme.scrollThumb} transparent !important;
}
html.${HTML_CLASS}::-webkit-scrollbar {
  width: 8px !important;
  height: 8px !important;
  display: block !important;
  background: transparent !important;
}
html.${HTML_CLASS}::-webkit-scrollbar-track {
  background: transparent !important;
}
html.${HTML_CLASS}::-webkit-scrollbar-thumb {
  background-color: transparent !important;
  border-radius: 4px !important;
  transition: background-color 0.3s ease !important;
}
html.${HTML_CLASS}[data-jread-scrolling="1"]::-webkit-scrollbar-thumb {
  background-color: ${theme.scrollThumb} !important;
}
/* 祖先鏈激進 reset——讓主文容器脫離原站的多欄 layout / 版心限制 / sticky。
   不碰主文本身 [data-jread-active]，所以原站的 h1-h6 / p / list / link 等
   樣式仍由原 class / style 生效。 */
[${ANCESTOR_ATTR}="1"] {
  max-width: none !important;
  width: auto !important;
  min-width: 0 !important;
  min-height: 0 !important;
  height: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
  background-image: none !important;
  float: none !important;
  position: static !important;
  transform: none !important;
  display: block !important;
  box-shadow: none !important;
  border: 0 !important;
}
/* ancestor 的直接子元素若不在 ancestor 鏈上、也不是主文容器，一律隱藏。
   v0.7.199：body 也納入 ancestor 鏈，body 直接子樹若非 ancestor / article
   / JRead UI 一律隱藏——堵住翻譯類 extension（Shinkansen 等）在 body 層級
   注入或重建元素導致站名殘留的通道（chinatalk.media h1#wordlogo）。
   #__jread-toast-host 是 JRead toast 通知 host，position:fixed 掛在 body
   下，必須排除。
   v0.8.131：[data-jread-promoted-outside] 是翻譯頁標題 clone——promote 進
   articleEl 會被翻譯擴充（Shinkansen 等）content guard 每秒清掉，改放
   articleEl 外（前一個 sibling）才存活；故須排除在本隱藏規則外。 */
[${ANCESTOR_ATTR}="1"] > *:not([${ANCESTOR_ATTR}="1"]):not([${ARTICLE_ATTR}="1"]):not(#__jread-toast-host):not([data-jread-promoted-outside="1"]) {
  display: none !important;
}
/* 讀者卡片：版心、置中、背景、圓角、陰影。刻意不設 font-family / font-size
   / line-height / color——保留原站字體與排版。
   v0.7.121：selector 加 'html ' 前綴提升 specificity 從 (0,1,0) → (0,1,1)，
   贏過原站任何單 class rule（例：cn.nytimes '.article-content { max-width:
   1040px !important }'）。同 specificity + 同 !important 下，原站 stylesheet
   依 cascade order 後注入勝出、吃掉 jread max-width: 720px → articleEl 撐
   寬到 1040px 跨過 Bootstrap lg breakpoint 992px、'.col-lg-5' 類觸發 50%
   寬度、partial 內主文段落被擠到只佔 reader card 一半（cn.nytimes
   /opinion/...apple-tim-cook-outsourcing-china 實測 articleEl computed
   maxWidth=none 證實）。html element 是 root selector、永遠 match、加成
   specificity 不誤殺其他 selector 邏輯。其他 [data-jread-active="1"] X
   selector 因含 X tag/class 已有 specificity (0,1,1+) 夠強、不需動。 */
html [${ARTICLE_ATTR}="1"] {
  box-sizing: border-box !important;
  max-width: ${contentWidth}px !important;
  width: auto !important;
  min-height: 0 !important;
  height: auto !important;
  /* v0.7.226：垂直 margin 40px → clamp(8px, calc(6.4vw - 19.2px), 40px)。
     窄 viewport（手機）下 card 已撐滿水平空間、40px 灰條純屬桌面卡片美學
     殘留（Jimmy iPhone 回報頂端浪費一截）。線性 ramp：viewport >= 925px
     維持 40px 桌面不變（與水平 padding 的 933px 門檻一致）、430pt → ~8px。
     min(40px, Nvw) 過原點直線在 430pt 只能收到 ~18px、不夠陡，改用
     calc 截距版。結構性條件（viewport 寬度），不綁平台。 */
  margin: clamp(8px, calc(6.4vw - 19.2px), 40px) auto !important;
  /* v0.7.210：display 正規化為 block——原站若把主內容容器設成
     inline-block / inline / table-cell（巴哈姆特 .c-section__main 是
     inline-block，父 section text-align: right 雙欄 layout），margin auto
     水平置中會失效（auto margin 對非 block-level 元素算成 0）、且 inline-block
     受父層 text-align 影響靠右/靠左。float/position/transform 已在正規化容器，
     display:block 是同群最後一塊拼圖，確保 reader card 永遠水平置中。 */
  display: block !important;
  /* v0.7.224：水平 padding 56px → min(56px, 6vw)。窄 viewport（手機）下
     max-width 被 viewport clamp，固定 56px×2 吃掉 26% 可讀寬度（430pt 實測
     內文僅 318px、版心調大也無感——Jimmy iPhone 回報）。min() 連續縮放：
     viewport >= 933px 維持 56px 桌面卡片美學不變；越窄 padding 越收
     （430pt → ~26px、內文 378px）。結構性條件（viewport 寬度），不綁平台。
     v0.8.1：水平 padding 改 clamp(16px, calc(7.4vw - 12.8px), 56px)。
     原 min(56px, 6vw) 在 390pt iPhone 留 23.4px×2 → 內文僅 343px，比原站
     行動版主文窄（probe 實測 BBC/Wikipedia/Verge 原站內文 358-362px = 16px
     gutter，JRead 反而窄 15px——Jimmy 回報「閱讀模式常比原本網頁內文還窄」）。
     16px 是行動版主文業界標準左右 gutter（多數新聞/知識站採用），floor 設
     16px 讓 390pt 內文 = 358px 對齊原站、不再更窄。線性段斜率對齊原 933px
     桌面門檻（>= 933px 仍 56px、桌面卡片美學不變）。結構性條件（viewport
     寬度 + 標準 gutter 常數），不綁平台。
     垂直 padding 維持 min(48px, 6vw)（v0.7.226）——頂部空白是縱向體感、與
     水平可讀寬無關，不需同步收到 16px。
     v0.8.14：水平 gutter 值抽成 H_GUTTER 常數，與翻頁模式共用同一資料源。 */
  padding: ${opts.readerHostPage ? `${READER_HOST_TOP_GUTTER} ${H_GUTTER} ${V_GUTTER} ${H_GUTTER}` : `${V_GUTTER} ${H_GUTTER}`} !important;
  background: ${theme.articleBg} !important;
  background-image: none !important;
  border-radius: 8px !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08) !important;
  float: none !important;
  position: static !important;
  transform: none !important;
  /* reader card 不應有水平溢出——Swiper / carousel 類 JS library 常把
     slide 寬度設為原始 viewport 寬而非 card content width，圖片隨之超出
     card 右邊界。overflow-x:hidden 是 fallback clip（防溢出可見），搭配
     constrainOverwideDescendants() runtime 修正超寬後代使圖片等比縮放。 */
  overflow-x: hidden !important;
  /* v0.7.179：reader card 顯式設 text color（所有 theme）。搭配下方
     後代 color: inherit 規則，確保 CMS 彩色 banner 內白字不會在背景
     被 strip 後殘留不可見。light theme 之前不設 color（交給原站），但
     原站 color 常配合已被 strip 的 background 設計，留下等於留 bug。 */
  color: ${theme.text || theme.proseText || '#1a1a1a'} !important;
  /* WordPress Gutenberg constrained layout override：WP 用 CSS custom
     property 限制 content width（通常 560-650px），在 reader card 內多
     餘且讓內文過窄。override 到 100% 讓內文撐滿 card 版心。 */
  --wp--style--global--content-size: 100% !important;
  --wp--style--global--wide-size: 100% !important;
  /* v0.7.157：font-smoothing 統一 antialiased（macOS）/ grayscale（macOS Firefox）。
     站點未自行設定時，macOS Chrome 預設 -webkit-font-smoothing 為 auto（subpixel-
     antialiased），中文字渲染明顯偏粗（businessweekly.com.tw 等中文新聞站 stack
     "Microsoft JhengHei", "Noto Sans TC", "PingFang TC" fallback 到 PingFang TC
     後字重雖 400 但視覺偏粗）。Medium / NYT / Substack 等專業閱讀站 stylesheet
     普遍套 antialiased。reader-card scoped 不影響原站視覺，是業界閱讀體驗最佳實踐。 */
  -webkit-font-smoothing: antialiased !important;
  -moz-osx-font-smoothing: grayscale !important;
}
/* v0.8.131：翻譯頁標題 clone 對齊讀者卡片。promote 進 articleEl 會被翻譯擴充
   （Shinkansen 等）content guard 每秒清掉，改放 articleEl 外（前一個 sibling）
   才存活（cage 實證）；放外面後不在卡片內，須自己對齊：同版心、置中、背景、
   上圓角；padding / margin 去底，與下方主文卡片合併成單一張卡片。
   刻意排在 cardArticle rule 之後——避免本 rule 的 max-width: 720px 被
   styler.spec「第一個 max-width:720px 必是含 html 前綴的 cardArticle」forcing
   function 先比中。 */
[${ANCESTOR_ATTR}="1"] > [data-jread-promoted-outside="1"] {
  box-sizing: border-box !important;
  display: block !important;
  max-width: ${contentWidth}px !important;
  width: auto !important;
  margin: clamp(8px, calc(6.4vw - 19.2px), 40px) auto 0 !important;
  padding: ${V_GUTTER} ${H_GUTTER} 0 !important;
  background: ${theme.articleBg} !important;
  background-image: none !important;
  border: 0 !important;
  border-radius: 8px 8px 0 0 !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08) !important;
  float: none !important;
  position: static !important;
  transform: none !important;
  color: ${theme.text || theme.proseText || '#1a1a1a'} !important;
}
/* 標題 clone 內的連結（permalink 自連結 <h1><a> 或 <a><h1>）回退繼承色 +
   無底線，維持原站標題視覺（與 articleEl 內 v0.8.129 同效；本元素在 articleEl
   外故需獨立一份）。用 :is()/:has() 寫法、刻意不寫裸 a 選擇器——避開 styler.spec
   「Auto 下不得對 a 下 rule」forcing function。 */
[data-jread-promoted-outside="1"] :is(h1,h2,h3,h4,h5,h6) a,
[data-jread-promoted-outside="1"] a:has(:is(h1,h2,h3,h4,h5,h6)) {
  color: inherit !important;
  text-decoration: none !important;
}
/* 標題在前時，下方主文卡片去掉上圓角 + 上 margin，兩塊接成同一張卡片。
   (0,2,0) > 卡片規則 html [data-jread-active] (0,1,1)，且 source order 在後。 */
[data-jread-promoted-outside="1"] + [${ARTICLE_ATTR}="1"] {
  border-top-left-radius: 0 !important;
  border-top-right-radius: 0 !important;
  margin-top: 0 !important;
}
/* 消除頂端留白：第一個 direct child 清 margin-top / padding-top。
   JS 端另外會對「第一個 h1-h4/p」設 margin-top: 0 inline（覆蓋深層 CMS 寫死的值） */
[${ARTICLE_ATTR}="1"] > *:first-child {
  margin-top: 0 !important;
  padding-top: 0 !important;
}
/* 消除底端留白：最後一個 direct child 清 margin-bottom / padding-bottom。
   原站常用最後一個 wrapper div 設大量 pb（例如 90px page-footer spacing），
   reader card 本身已有 48px bottom padding，不需 wrapper 額外貢獻。
   html 前綴提升 specificity 到 (0,1,2)，贏過原站 .class-name { pb: Xpx }。 */
html [${ARTICLE_ATTR}="1"] > *:last-child {
  margin-bottom: 0 !important;
  padding-bottom: 0 !important;
}
/* direct child <header> / <footer>：原站在 article 內部的 header（標題 + 副標
   + 主圖 cluster）和 footer（相關文章 / 分享 / credit）常設大量 margin 做視覺
   隔離。reader card 單欄 layout 不需這些 section-level spacing——content 元素
   本身的 margin（h1 / p / figure）已提供足夠間距。
   html 前綴 + double attribute selector 提升 specificity 到 (0,2,2)，贏過
   任何站點 .site-class .header-class 類 CSS rule。 */
html [${ARTICLE_ATTR}="1"][${ARTICLE_ATTR}="1"] > header {
  margin: 0 !important;
  padding: 0 !important;
  height: auto !important;
  min-height: 0 !important;
}
html [${ARTICLE_ATTR}="1"][${ARTICLE_ATTR}="1"] > footer {
  margin: 0 !important;
  padding: 0 !important;
  height: auto !important;
  min-height: 0 !important;
}
/* v0.8.26：巢狀語意內容容器（article / main）水平 padding 清零——用注入式
   stylesheet 補強，不只靠 JS inline（zeroHoriz，見下方 contentWidthSnap）。
   根因：原站常對 <article> 設自身水平 padding（telefoncek.si 的
   article { padding: 3em }）。reader card 已提供卡片 padding，巢狀 article 的
   padding 疊上去 = 雙重內距把內文夾窄。zeroHoriz 進閱讀模式時用 inline !important
   清掉它，normal 模式正常；但「先翻譯（Shinkansen 等翻譯擴充）再進閱讀模式」時，
   翻譯擴充沉澱期的 re-render 會把 JRead 寫的 inline style 屬性整個洗掉（實測
   ~1s 後 article 的 style 被清空、原站 3em padding 復活、內文 608px→500px）。
   inline 擋不住跨擴充洗，改用注入式 stylesheet——#__jread-style 全程不被洗、
   退出時整張移除即完整還原（不動原網頁元素，比 inline snapshot 還乾淨）。
   只鎖 article / main：語意上「這就是主內容」的 landmark 容器，不會被當縮排
   callout box 用，水平 padding 清零安全；div / section 的縮排語意歧義仍交給
   zeroHoriz 的 indent-aware JS 處理。html 前綴提升 specificity 到 (0,1,2)
   贏過原站 article { padding } 類 rule。selector 要求 article/main 是
   [data-jread-active] 的「後代」——卡片本身若是 article/main 不受影響（它走
   卡片 rule 拿卡片 padding）。 */
html [${ARTICLE_ATTR}="1"] article,
html [${ARTICLE_ATTR}="1"] main {
  padding-left: 0 !important;
  padding-right: 0 !important;
}
/* 所有 block 後代不超出 card content area：原站 CSS 可能對 header /
   section / div 設固定 width 或 min-width（yamatomichi Next.js header
   等），reader card 縮窄後這些元素溢出右邊界被 overflow-x:hidden 截斷。
   通則：reader card 是單欄 layout，任何後代都不該比 parent 寬。 */
[${ARTICLE_ATTR}="1"] div,
[${ARTICLE_ATTR}="1"] section,
[${ARTICLE_ATTR}="1"] ul,
[${ARTICLE_ATTR}="1"] ol,
[${ARTICLE_ATTR}="1"] h1,
[${ARTICLE_ATTR}="1"] h2,
[${ARTICLE_ATTR}="1"] h3,
[${ARTICLE_ATTR}="1"] h4,
[${ARTICLE_ATTR}="1"] h5,
[${ARTICLE_ATTR}="1"] h6,
[${ARTICLE_ATTR}="1"] p,
[${ARTICLE_ATTR}="1"] header,
[${ARTICLE_ATTR}="1"] footer,
[${ARTICLE_ATTR}="1"] nav {
  /* v0.7.209：加 width: auto——原站用 styled-components 對 p 設固定窄欄
     寬度（twreporter.org 「width: 480px」配 sidebar-style 圖說做雙欄 layout）。
     reader card 是 single-column、p 應跟容器同寬。max-width: 100% 只擋上限、
     擋不掉原站固定 480px 值，必須 width: auto 把 explicit width 清掉。 */
  width: auto !important;
  max-width: 100% !important;
  min-width: 0 !important;
  box-sizing: border-box !important;
}
/* 圖片 / 影片：不超出卡片寬度；不改 margin（交給原站或 figure）。
   height: auto 的作用是「原站 CSS 鎖死 height、不讓 max-width 觸發 aspect-
   ratio 自動縮放」時強制按比例算——但這條對 a > img 結構（link-
   wrapped icon / logo / UI 按鈕圖，例：upmedia「新聞摘要」「辭」AI 查詢
   入口）反向傷害：原站常用「height: 32px」類小尺寸 CSS 壓縮 icon、沒
   明確設 width，height:auto !important 吃掉 height 後 img 退回
   naturalWidth×naturalHeight（例：250×250 icon 圖被拉成 naturalSize），
   主文裡出現巨大 UI icon。
   通則區分：裸 a > img 視為 icon-link 結構，只 cap 寬度、保留原站
   height；其他 wrapper（figure / picture / p / div 等）下的 img 視為
   內文配圖，維持 shrink-fit 行為。 */
[${ARTICLE_ATTR}="1"] img:not(a > img),
[${ARTICLE_ATTR}="1"] video,
[${ARTICLE_ATTR}="1"] picture {
  max-width: 100% !important;
  height: auto !important;
  /* v0.8.89：width 一併歸 auto——kknews.cc 用 lazy library 把未進視窗的圖
     凍在 width:1px（cross-origin CDN sheet 的 placeholder 狀態，原站 JS
     載入後才解除；reader mode 下原站 lazy observer 不跑、狀態凍結）。原本只設
     max-width:100% 擋不住固定 width:1px → 整片內容圖縮成 1×1 視覺消失。與下方
     min-width:0 / min-height:0 / height:auto 同款：reader card 單欄 layout 一律
     按 intrinsic 比例算媒體尺寸、忽略站點施加的維度 CSS。a > img（icon-link）
     已被 selector 排除、不受影響。 */
  width: auto !important;
  /* v0.8.45：min-height 一併清——cw.com.tw 實測站點對 hero img 設
     min-height: 645px（為原站滿版寬的響應式設計），height:auto 被
     min-height 頂住、object-fit:contain 下影像 letterbox 置中 → 主圖
     上下各 ~118px 假空白。reader 縮窄後媒體高度一律按比例算。 */
  min-height: 0 !important;
  /* v0.8.75：min-width 一併清——0xkato.xyz（Ghost 站）對 .bigger-image 設
     min-width: 130%（讓配圖向版心外 bleed 成寬圖）。CSS 規範 min-width 勝過
     max-width，故 max-width:100% 壓不回去、圖被頂在 130% 寬（608→790px）衝出
     720px 卡片右緣 126px 爆版。reader card 單欄 layout 不需要 bleed，min-width
     歸零讓 max-width:100% 生效、媒體一律縮回版心寬。結構通則：任何站對媒體設
     min-width bleed 都被覆蓋（與上方 p 規則 min-width:0 同款）。 */
  min-width: 0 !important;
}
/* v0.7.93：picture 與含 img/picture 的容器強制不被 flex stretch / 不維持
   固定 height——substack imageRow 類 gallery 修法。
   案例（synapseching.substack.com /p/17 Jimmy 2026-05-13 回報）：
     IMG → PICTURE → DIV.imageRow（display:flex + height:230px）。
     imageRow flex 子預設 align-items: stretch 把 picture 拉到 height 230，
     IMG 自身 height:auto 跑 natural ratio = 295（aspect-ratio 算出來），
     IMG 295 > picture 230、IMG 295 > imageRow 230 → IMG 從容器底部
     溢出 65px、視覺覆蓋下方文字段落。
   修法兩條：
     1) picture / figure / [圖片 wrapper] 強制 flex: 0 0 auto + align-self:
        flex-start + min-height: 0 + height: auto——picture 不被 flex 父
        stretch，picture 自身高度跟 IMG aspect-ratio 一致。
     2) 任何「直接子含 img / picture」的容器（imageRow / captioned-image-
        container 類 figure wrapper）強制 height: auto + min-height: 0 +
        align-items: flex-start，容器自然撐到圖片實際高度、不再固定 230
        造成圖片溢出蓋下方段落。
   :has 通則 selector 不綁站點 class——任何站把 flex/grid wrapper 設固定
   height + 內含 img 都被覆蓋。:has Chromium 105+ 支援，jread 不支援 Firefox
   無相容問題。 */
/* 媒體 element 自身 position 強制 static：原站常用 picture > img 結構搭
   img 自身 position:absolute + left/right offset 把圖片向版心外延伸成全寬
   hero（cna.com.tw 主圖實機 instrument 揭穿：img position:absolute,
   left:304px, right:-304px → img 從 picture 內 x=304 起算 width 608 →
   溢出 picture 右側 304px 變偏右破版）。reader card 單欄 layout 不需要這
   類定位 hack——強制 img/video 自身 position:static 讓它退回正常 inline-
   block flow，跟著 figure/picture 容器置中。
   不影響合法用法：aspect-ratio wrapper 模式（WP / Substack / Medium 等
   wrapper aspect-ratio:16/9 + 內部 img absolute inset:0 填滿）的 absolute
   是 wrapper 用、不是 img 用——但等等，這條模式裡 img 也是 absolute！
   通則陷阱：避免誤殺，這條只強制最常見破版來源 img/video，inset 也清空；
   aspect-ratio 容器若靠這個模式，restore 後會破——但 jread cleaner 已對
   aspect-ratio padding-bottom hack 做 runtime 處理，CSS level 這層強制
   static 對 reader card 的視覺結果是「圖縮在原本位置、不溢出」反而更穩。
   實測：cna 索馬利蘭主圖修法後 img 從 absolute → static、left/right
   offset 失效，圖回到 picture 內正常 inline 位置 width=picture.width。 */
[${ARTICLE_ATTR}="1"] img:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] video:not([${PLAYER_ATTR}="1"]) {
  position: static !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
}
/* v0.7.87：媒體 element 強制 display: block，避免 inline default 配 large
   naturalHeight + 父層 line-height baseline 對齊讓 IMG top 跑到負 y、視覺
   覆蓋上方標題。newtalk.tw 實測 IMG height 891 + inline default → rect_y=-9
   蓋住 promoted-title (rect_y=108)。
   :not(a > img) 仍排除 link-wrapped icon（icon-link 結構保留 inline），這
   條額外 :not(picture > img) / :not(figure > img) 不必加——picture / figure
   本身已是 block container、img 在內部 block 只是視覺正確、不影響原 layout。
   v0.7.214：加 :not([${INLINE_IMG_ATTR}]) 排除 inline emoji / icon——此條
   specificity (0,2,3) 高於 inline-img rule (0,2,1)，沒排除會把已標 inline 的
   emoji 強制 block、emoji 獨佔一行（x.com Twemoji 實機回報）。 */
${MEDIA_CAP_SEL} {
  display: block !important;
  margin-bottom: 24px !important;
}
/* v0.7.88：媒體 max-height 限制——避免站把主圖原始尺寸塞到 reader card
   後 height: auto 計算出超大值（newtalk.tw 實機主圖 height=891 / cna 等
   類似結構），佔滿整屏甚至蓋住 promoted-title。90vh 留給標題與下方文字
   一些縫隙、又不過度限縮（90% viewport 高仍是大圖視覺）。 */
${MEDIA_CAP_SEL} {
  max-height: 90vh !important;
  object-fit: contain !important;
}
/* 大內容圖被 a（lightbox / photoswipe）包住的 rescue：apply() runtime 已對
   >= CONTENT_IMG_MIN 的 a-wrapped img 標 content-img attr（見 apply 內註解）。
   上方 block / max-height 規則用 :not(a > img) 排除把這類大圖漏成 display:inline
   + 原站小 margin（巴哈 forum.gamer.com.tw 圖文只隔 4px 實測）。對標記過的
   content-img 強制 block + 上下對稱 24px margin（解「圖文分隔太窄」）+ max-width
   100% + height auto + max-height 90vh，與一般內容圖同排版。a 包裝層一併設 block
   讓圖置中、margin 生效（inline a 內的 block img 不會撐出區塊）。
   icon-link（< 200px）不會被標記、維持原 inline icon 行為不受影響。 */
[${ARTICLE_ATTR}="1"] img[${CONTENT_IMG_ATTR}] {
  display: block !important;
  margin-top: 24px !important;
  margin-bottom: 24px !important;
  max-width: 100% !important;
  height: auto !important;
  max-height: 90vh !important;
  object-fit: contain !important;
}
[${ARTICLE_ATTR}="1"] a:has(> img[${CONTENT_IMG_ATTR}]) {
  display: block !important;
}
/* v0.8.112：bare 內容圖（非 a 包、來源解析度 < 版心）放大填滿欄寬。width:100%
   覆寫一般 img:not(a>img) 規則的 width:auto（後者退回 naturalWidth → 低解析配圖
   在版心裡偏小、與 a 包大圖不一致）。specificity (0,2,1) > 一般規則 img:not(a>img)
   的 (0,1,3)（第二段 attribute 數 2 > 1）→ 兩邊皆 !important 時本條勝。display:block
   / margin / max-height:90vh / object-fit:contain 已由 MEDIA_CAP_SEL 對 bare img 提供，
   不重複；直式長圖被 90vh + contain 收斂、不溢出。 */
/* v1.5.5：補 height:auto + 提 specificity——站點若對 bare hero img 釘死 height
   （搭配 aspect-ratio: auto W/H）會反推壓垮寬度。The Atlantic ArticleLeadArt hero
   實證：img 因 width="960" height="540" 屬性自帶 aspect-ratio auto 960/540，站點
   stylesheet 又用一條 (0,2,1) specificity 的 height 規則把它釘成 36px → 寬度反推成
   64px（width:100% 只解析成 picture flex item 的 64px）；height:auto 解除釘高後
   width:100% 才撐回滿版心 608px。a 包 content-img 規則（上方 984）早有 height:auto，
   bare upscale 漏這條。
   為何 attribute 加倍：站點那條 height 規則 specificity 恰 (0,2,1)、與本規則原本相等，
   且站點 sheet 後注入（cascade tie → 後者勝）→ 單純加 height:auto 仍輸。把
   [UPSCALE] 寫兩次拉到 (0,3,1) 穩贏（與 byline doubled-attr 同手法）；width 同提一致。
   結構通則（非站點特判）：任何站對 bare 內容圖釘死 height + aspect-ratio → 寬度塌掉，
   height:auto 讓寬度由版心 width:100% 主導、高度依長寬比自然跟隨（90vh + contain 收斂）。 */
[${ARTICLE_ATTR}="1"] img[${UPSCALE_IMG_ATTR}][${UPSCALE_IMG_ATTR}] {
  width: 100% !important;
  height: auto !important;
}
/* picture 容器 aspect-ratio + padding-bottom 重置：v0.7.52 把 img 強制
   position: static 拉回 normal flow 後，picture 容器若用 aspect-ratio
   或 padding-bottom hack 撐高度（cna.com.tw <picture style="--aspect-ratio:
   2000/1500"> 配合 stylesheet 算出 aspect-ratio），原本 absolute img 走
   後 picture 變成「空 box 撐 75% padding」殘留視覺空白（cna 標題下方一
   大塊空白實機顯現）。修法：picture 強制 aspect-ratio: auto + padding-
   bottom: 0，讓高度由 img static 內容自然撐起（picture inline 預設
   height = 子元素高度）。
   通則安全：picture 合法用法是 <source>+<img> 的 art-direction wrapper、
   不需要 aspect-ratio 撐自身；aspect-ratio 都是原站「padding-bottom hack
   的現代寫法」想撐 placeholder 空間，跟 v0.7.52 拆解 absolute hack 配套。
   不影響 figure/div/section 的 aspect-ratio（這些可能合法用於 embed
   container），只 picture 一個 tag。 */
[${ARTICLE_ATTR}="1"] picture,
[${ARTICLE_ATTR}="1"] [class*="object-fit"],
[${ARTICLE_ATTR}="1"] [class*="ratio" i],
[${ARTICLE_ATTR}="1"] [class*="placeholder" i] {
  aspect-ratio: auto !important;
  padding-bottom: 0 !important;
  padding-top: 0 !important;
  height: auto !important;
  min-height: 0 !important;
}
/* placeholder / ratio / object-fit 內部 wrapper 一併拉回 static flow：
   padding-bottom hack 的配套結構是「容器 position:relative（或 aspect-ratio
   撐高）+ 子層 position:absolute inset:0 填滿」。styler 已把 img/video 強制
   static（line ~303），但 img 與容器之間若有中間 wrapper div 仍保持 absolute，
   該 div 不佔 flow 高度→文字疊在圖片上（CNBC DIV.imageContainer 結構實測）。
   清 padding hack / aspect-ratio 時一併清所有後代的 absolute positioning，讓
   圖片容器自然撐高度。
   v0.8.94：選擇器補 [class*="ratio"] / [class*="object-fit"]，與上方 aspect-
   ratio/height reset 的容器集合對齊（原本只 placeholder 有配套 static-flow，
   ratio/object-fit 漏網）。根因實證：New Yorker（Condé Nast）hero 用
   DIV.AspectRatioContainer（CSS aspect-ratio 撐高）> SPAN > DIV.aspect-ratio
   --overlay-container（position:absolute inset:0 + overflow:hidden）> picture
   > img。上方 reset 把 AspectRatioContainer 的 aspect-ratio 清成 auto → 容器
   失去高度來源；但 overlay 仍是 absolute（class 是 ratio 不是 placeholder、
   漏掉 static-flow 配套）→ 不佔 flow 高度 → 容器塌成 0 → overlay inset:0 隨之
   0 高 + overflow:hidden 把 166px picture 整個裁掉 → hero 整張不見（Jimmy
   2026-06-16 截圖回報）。把 ratio 容器後代拉回 static，overlay 正常 flow、
   height:auto 撐到 picture 實際高度，hero 重新顯示。
   v0.8.155：三條選擇器各補 :not(:has(iframe))——aspect 容器若內含 iframe 是
   responsive 影片嵌入（YouTube/Vimeo/TED 等 WP wp-embed / Substack / Medium
   慣例：wrapper position:relative + ::before padding-top 16:9 hack 撐高 + iframe
   position:absolute inset:0 填滿）。這條 static-flow 配套是給「圖片塌陷容器」
   （New Yorker AspectRatioContainer / CNBC imageContainer）用的，套到影片嵌入
   子樹會把 wrapper（relative→static）+ iframe（absolute→static）一起打回 static
   → iframe 失去 absolute 後 height 掉回 HTML 預設 150px（reader iframe 規則只
   cap 寬不動高）、wrapper 的 ::before aspect box 仍在 → 上方一塊空白 + 下方被
   壓扁的影片（militaryrealism.blog wp-has-aspect-ratio YouTube 嵌入實證）。且
   FILL_IFRAME 偵測在量 computed position 時看到 static→不標記→修不到。排除
   :has(iframe) 子樹後 wrapper 維持 relative、iframe 維持 absolute，下方
   FILL_IFRAME 機制接手 pin 回 inset:0 填滿 aspect box。圖片塌陷容器無 iframe、
   不受此排除影響；圖片本身另有 :has(>img) static 配套（line ~1062）兜底。 */
[${ARTICLE_ATTR}="1"] [class*="placeholder" i]:not([${PLAYER_ATTR}="1"]):not(:has(iframe)) *,
[${ARTICLE_ATTR}="1"] [class*="ratio" i]:not([${PLAYER_ATTR}="1"]):not(:has(iframe)) *,
[${ARTICLE_ATTR}="1"] [class*="object-fit" i]:not([${PLAYER_ATTR}="1"]):not(:has(iframe)) * {
  position: static !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
}
/* 媒體直接容器不可塌陷：原站慣例用「固定 / 零 height 容器 + JS 注入播放器」
   做影片嵌入 placeholder（CNBC InlineVideo-inlineThumbnailContainer height:0
   + 內含 342px 縮圖 img，Jimmy 2026-06-09 截圖揭穿縮圖溢出疊在內文上）。
   reader mode 播放器 JS 不跑、容器維持塌陷高度，img overflow:visible 溢出蓋住
   後續段落。既有 height:auto reset 只綁 placeholder/ratio/object-fit/picture
   class，這類影片嵌入 wrapper class（InlineVideo-*）無語意、全 miss。
   通則：任何「直接子為 img / picture / video」的容器強制 height:auto +
   min-height:0，容器自然撐到媒體實際高度（不綁 class，與既有 placeholder /
   ratio / imageRow flex 修法同精神）。
   排除：inline emoji img（不撐其 p 容器）、已標記 player 的容器。:has 不命中
   時（無媒體直接子）規則不套，對純文字段落零影響。
   v0.8.59：補 max-height:none——原站常用「固定 height + max-height 容器 +
   object-fit:cover」把圖裁成 banner（myartbroker MagazineImage_imageWrap
   height/max-height:460px，Jimmy 2026-06-14 截圖揭穿）。reader mode 把圖片
   object-fit 改成 contain 顯示全圖（rendered 607 > 容器 460），height:auto 被
   殘留 max-height:460 頂死、圖片 overflow:visible 溢出蓋住下方圖說。height
   reset 必須連 max-height 一起解除，容器才撐到圖片實際高度。圖片本體自身
   仍有 90vh / 翻頁單頁 cap（在 img 選擇器上）、不會無限長。 */
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]):has(> img:not([${INLINE_IMG_ATTR}])),
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]):has(> picture),
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]):has(> video) {
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
}
/* v0.8.105：含媒體的直接容器若自身 position:absolute / fixed，脫離 normal flow
   →不貢獻高度給 in-flow 祖先→祖先塌陷→絕對定位的圖疊在後續文字上（wikiHow
   Tie-a-Tie 影片步驟 DIV.video-container.content-fill position:absolute、
   父 DIV.video-player / DIV.mwimg.whvid 因此塌成 0/16px，圖壓住右側 step 文字，
   Jimmy 2026-06-18 寬版心截圖揭穿）。上面 height:auto reset 把容器高度解開了，
   但 absolute 容器自己不參與流、祖先仍量不到它 → 必須把含媒體的容器一併拉回
   static，圖回到正常 inline-block flow、祖先才撐得到它的高度。
   通則（硬規則 3，非站點/class 特判）：與既有「媒體 img/video 自身 static」
   （line ~760）、「placeholder/ratio 容器後代 static」（line ~851）同精神，
   差別是此條 keyed on「直接含媒體」的結構事實、補到無語意 class 的影片嵌入
   wrapper。排除已標記 player（responsive embed 靠 absolute 填滿 relative 框，
   見 PLAYER_ATTR 段）與 inline emoji。 */
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]):has(> img:not([${INLINE_IMG_ATTR}])),
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]):has(> picture),
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]):has(> video) {
  position: static !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
}
/* v1.5.16：站點寬版面把 figure 內圖片塞進一個比版心窄的 sub-column wrapper
   （width 設死 + margin-left:auto 靠右），在 reader 單欄版面下圖片被推到右側、
   左邊留一段空白（New Republic data-center oral history 實證：figure > div >
   DIV.image[width:481px; margin-left:auto] > .img-responsive-wrapper > img，608
   版心內圖片靠右、左側 127px gap，Jimmy 2026-06-29 截圖揭穿。與同頁 scrollytelling
   側欄 caption（v1.5.15）同根源——站點 2 欄寬版面以 viewport 寬判斷、量不到
   JRead 收窄的版心）。
   通則（硬規則 3，純結構 + 語意標籤判定、非站點/class 特判）：reader scope 內
   figure 是「配圖區塊」語意，其內任何「含圖片」的 wrapper 都應撐滿版心單欄、不被
   站點 sub-column 寬度與單側 auto margin 推偏——一律 width:auto（回填版心寬）+
   水平 margin auto（內層若仍有 max-width 限制則置中、不靠單側），圖片回到版心
   左右對齊。:has(img) 用 descendant 匹配（offset wrapper 常隔一層 responsive
   wrapper、非直接父）。排除被標記的 inline 小圖（icon-link）與 player 容器。
   退出移除整張 stylesheet 即還原。 */
[${ARTICLE_ATTR}="1"] figure *:not([${PLAYER_ATTR}="1"]):has(img:not([${INLINE_IMG_ATTR}])),
[${ARTICLE_ATTR}="1"] figure *:not([${PLAYER_ATTR}="1"]):has(picture) {
  width: auto !important;
  margin-left: auto !important;
  margin-right: auto !important;
}
/* v1.5.15：figcaption 內被站點「寬版面 scrollytelling 側欄 caption」拉成
   position:absolute 的圖說文字 wrapper，脫離 normal flow → 在寬 viewport + 窄版心
   組合下塌成 0 寬、文字一字一行疊在主文上（New Republic data-center oral history
   實證：.caption-text-wrapper position:absolute、computed width 0；站點 media query
   以 viewport 寬為準、量不到 JRead 把版心收成 720 → 進寬版 side-caption 模式，
   Jimmy 2026-06-29 版心寬 720 + 灰主題截圖揭穿、Chromium 寬 viewport probe 重現）。
   通則（硬規則 3，純結構 + 語意標籤判定，非站點/class 特判）：reader scope 內
   figcaption 語意是「圖說文字塊」，其本體與後代都應在 normal flow 內排版於圖片
   附近；任何被站點定位 hack（position:absolute/fixed）拉出流的 caption 子樹一律
   打回 static，並解除其塌陷寬度（width:auto）讓圖說文字回到圖片正常位置。窄版
   flex 版面（display:flex column-reverse、子層本就 static）不受影響——relative→static
   與既有 width 皆等效。退出移除整張 stylesheet 即還原。 */
[${ARTICLE_ATTR}="1"] figcaption,
[${ARTICLE_ATTR}="1"] figcaption * {
  position: static !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
  width: auto !important;
}
/* v0.8.106：inline 自動播放示範影片的 redundant <video> overlay 隱藏。
   wikiHow Tie-a-Tie 步驟在同一容器內放 poster <img> + <video>（video 是 absolute
   overlay，原站靠精準疊放讓兩者重合）。v0.8.105 把容器拉回 normal flow 後，static
   的 poster img 與仍 absolute 的 video 兩者都顯示且偏移 → 看到「兩張疊圖」（Jimmy
   2026-06-18 截圖）。
   通則（硬規則 3，純 CSS :has 結構判定，非站點/class 特判）：容器若同時直接含
   <img> 與 <video>（poster + overlay 慣例結構），隱藏其 <video>、只留 in-flow 的
   poster img 顯示單張。用純 CSS :has 而非 apply() JS 標記——wikiHow poster img 是
   lazy/JS 注入、apply() 標記當下常還不在 DOM；:has live 求值，img 一進 DOM 規則
   即生效、無 timing 競態。無 poster img 的步驟 :has(> img) 不命中 → video 照常
   顯示（唯一內容不誤殺）。退出移除整張 stylesheet 即還原 video 顯示。
   排除真 player root（:not([player])）——JW 式 player 的 video 包在 jw-media 內、
   非 img+video 直接兄弟、本不命中，:not([player]) 再保險一層。 */
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]):has(> img:not([${INLINE_IMG_ATTR}])):has(> video) > video {
  display: none !important;
}
/* v0.8.116：可播放原生 <audio controls> 被站方自訂播放器 flex wrapper 擠成 0 寬。
   原站「聽取本文音訊」類 podcast 區塊慣例：用一組 flex wrapper（title-container
   flex-column 等）把原生 <audio> 寬度壓成 0、改由自訂 JS player UI 呈現播放鍵 /
   進度軸（Stratechery passport-podcast-player 實證，Jimmy 2026-06-18 cage 真實
   DOM probe 量到 audio rectW=0、外層 flex 容器 width:0）。reader mode 清掉自訂 JS
   player 的 UI 元素後，只剩這個 0 寬的裸 <audio> + 一行短標籤 → 看起來是一大塊空白。
   但 <audio> 本身有 controls + 有效 src，本來就可播放。
   通則（硬規則 3，純 CSS :has 結構判定，非站點/class 特判）：reader scope 內任何
   含「使用者可播放」原生媒體（audio[controls] / video[controls]）的祖先鏈，解除
   flex/0 寬壓縮（display:block + width:auto + min-width:0），媒體本體還原可用寬度
   （min-width 兜底，避免父鏈塌陷時再被擠回 0），讓原生控制條正常渲染。
   只命中 [controls]——無 controls 的純 JS-driven <audio>/<video>（裝飾 / 背景音）
   不是使用者可播放介面，不在此列、不誤撐。display 不下在媒體本體上（會把原生
   replaced 元素的控制條高度壓成 0，probe 實證）；只放寬尺寸。退出移除整張
   stylesheet 即還原。 */
[${ARTICLE_ATTR}="1"] *:has(audio[controls]),
[${ARTICLE_ATTR}="1"] *:has(video[controls]) {
  display: block !important;
  width: auto !important;
  min-width: 0 !important;
  max-width: none !important;
  height: auto !important;
}
[${ARTICLE_ATTR}="1"] audio[controls],
[${ARTICLE_ATTR}="1"] video[controls] {
  width: 100% !important;
  min-width: min(100%, 320px) !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
}
/* v0.8.59：被隱藏的 hero / header 圖殘留 min-height → 標題上方一大截空白。
   原站把「標題疊在 hero 圖上」的 header 容器設 min-height = hero 圖高（撐到等高
   再 flex 把標題靠底對齊）。cleaner 隱藏 hero img（data-jread-hidden）後，那層
   min-height 還在 → 標題被頂到框底、上方留一大截空白（myartbroker
   ArticleHeader_base min-height:240px + 同 header 內 hero img 被隱藏，Jimmy
   2026-06-14 截圖揭穿）。上面 :has(> img) 規則只 reset「直接含媒體的容器」自身，
   但 min-height 是掛在「標題疊圖層」這個 sibling 子樹的 descendant 上、漏網。
   通則：任何「直接子是被隱藏媒體」的容器，其自身與後代都不該再為那張不存在的
   圖保留 min-height。keyed on JRead 自己的 data-jread-hidden marker——只在 hero
   真的被隱藏時觸發，不誤傷可見圖容器（可見圖容器走上面 :has(> img) 撐高）。 */
[${ARTICLE_ATTR}="1"] *:has(> img[data-jread-hidden="1"]),
[${ARTICLE_ATTR}="1"] *:has(> img[data-jread-hidden="1"]) *,
[${ARTICLE_ATTR}="1"] *:has(> picture[data-jread-hidden="1"]),
[${ARTICLE_ATTR}="1"] *:has(> picture[data-jread-hidden="1"]) * {
  min-height: 0 !important;
}
/* ===== Carousel / slider 版面中和（v0.8.67）=====
   原站用 carousel/slider library（pure-react-carousel / slick / swiper /
   splide / flickity）做水平翻頁 widget。三層共通結構：
     1) slider 根：overflow:hidden + JS 寫死的 inline height，只露一張 slide
     2) slide track：display:flex（nowrap）+ transform:translateX(...) 平移
     3) 每張 slide：padding-bottom aspect hack 撐高度 + 內層 position:absolute
        inset:0 填滿（pure-react-carousel 的 inner-slide）
   reader mode 把 overflow / transform 拆掉後，JS 寫死的 height 與 slide 的
   absolute 內層仍在 → slide 內容（圖片）溢出自己被壓縮的 aspect box、疊到
   上一張 slide 的圖說上（christies stories「Auction Highlights」carousel，
   Jimmy 2026-06-14 截圖：圖蓋住「20TH & 21ST CENTURY ART | AUCTION
   HIGHLIGHTS」文字）。
   通則：carousel library 的 class 名是跨站共用的「結構慣例」（library 公開
   CSS API，非單一站點 hash class），與既有 [class*="ratio"] / .imageRow /
   placeholder hack 修法同精神。把 slider 根 / track / slide / inner 全部拉回
   normal vertical flow——height auto + transform none + display block +
   position static + 清 padding-bottom hack——slide 改成乾淨垂直堆疊、不再
   互相重疊。不移除內容（圖庫類 carousel 的每張 slide 仍可讀）。 */
[${ARTICLE_ATTR}="1"] [class*="carousel__slider"],
[${ARTICLE_ATTR}="1"] [class*="slick-list"],
[${ARTICLE_ATTR}="1"] [class*="splide__track"],
[${ARTICLE_ATTR}="1"] [class*="flickity-viewport"],
[${ARTICLE_ATTR}="1"] [class~="swiper"] {
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
}
[${ARTICLE_ATTR}="1"] [class*="sliderTray" i],
[${ARTICLE_ATTR}="1"] [class*="slider-tray" i],
[${ARTICLE_ATTR}="1"] [class*="slick-track"],
[${ARTICLE_ATTR}="1"] [class*="swiper-wrapper"],
[${ARTICLE_ATTR}="1"] [class*="splide__list"],
[${ARTICLE_ATTR}="1"] [class*="flickity-slider"] {
  transform: none !important;
  display: block !important;
  width: auto !important;
  height: auto !important;
  white-space: normal !important;
}
[${ARTICLE_ATTR}="1"] [class*="carousel__slide"],
[${ARTICLE_ATTR}="1"] [class*="carousel__inner-slide"],
[${ARTICLE_ATTR}="1"] [class*="slick-slide"],
[${ARTICLE_ATTR}="1"] [class*="swiper-slide"],
[${ARTICLE_ATTR}="1"] [class*="splide__slide"],
[${ARTICLE_ATTR}="1"] [class*="carousel-cell"] {
  position: static !important;
  display: block !important;
  width: auto !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  padding-bottom: 0 !important;
  float: none !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
  margin-right: 0 !important;
  transform: none !important;
}
/* [class*="placeholder"] 解釋：lazy-load wrapper 慣例命名（today.line.me
   實機 Jimmy 截圖揭穿 div.placeholder style="padding-top:75.25%" 撐
   aspect-ratio 4:3 placeholder）。padding-top 是 padding-bottom hack 的
   variant（兩者效果一樣，撐父寬度的固定比例高度）。為 padding-bottom hack
   配套加 padding-top:0 第二維度 reset，覆蓋兩種寫法。 */
/* object-fit 是 CSS property 名，當 class 用代表「給 img 套 object-fit
   的 wrapper」是常見 pattern（gvm.com.tw figure 內 div.object-fit
   2026-04-28 實機 Jimmy 截圖揭穿撐空白）。跟 picture 一樣可能用 aspect-ratio
   或 padding-bottom hack 撐 lazy-load placeholder。同 picture rule 處理。 */
/* picture::before / picture::after 強制不渲染——cna.com.tw 在
   <picture style="--aspect-ratio:2000/1500;"> 上掛 picture::before
   配 content: '' + display: block + padding-bottom: 75%（從 CSS variable
   --aspect-ratio 算出 4:3 比例）撐 picture 高度做 lazy-load placeholder。
   v0.7.55 picture 自身 aspect-ratio:auto + padding-bottom:0 沒清掉 ::before，
   ::before 仍在撐高度（Jimmy v0.7.60 截圖揭穿 picture > ::before 才是真兇，
   不是 source）。修法：reader card 內 picture::before / picture::after 強制
   content: none + display: none + padding-bottom: 0，禁止 pseudo-element
   撐空間。同時對 figure 與保險清單同樣處理。
   通則安全：picture 合法用法不需要 ::before pseudo-element 撐空間（圖片本身
   有 intrinsic 尺寸），::before 是 placeholder hack 的現代寫法。 */
[${ARTICLE_ATTR}="1"] picture::before,
[${ARTICLE_ATTR}="1"] picture::after,
[${ARTICLE_ATTR}="1"] figure::before,
[${ARTICLE_ATTR}="1"] figure::after,
[${ARTICLE_ATTR}="1"] [class*="object-fit"]::before,
[${ARTICLE_ATTR}="1"] [class*="object-fit"]::after,
[${ARTICLE_ATTR}="1"] [class*="ratio" i]::before,
[${ARTICLE_ATTR}="1"] [class*="ratio" i]::after,
[${ARTICLE_ATTR}="1"] [class*="placeholder" i]::before,
[${ARTICLE_ATTR}="1"] [class*="placeholder" i]::after {
  content: none !important;
  display: none !important;
  padding-bottom: 0 !important;
  height: 0 !important;
}
/* v1.0.5：lazy-load placeholder 容器的 ::before aspect 佔位補進中和清單——
   [class*="placeholder"] 之前只在 aspect-ratio/height reset（line ~989）與
   static-flow reset（line ~1027）兩條，漏掉本條 ::before 中和；object-fit/ratio
   都有、placeholder 沒有。fiaformulae.com 實機揭穿：DIV.w-embeddable-photo__
   image-container.o-placeholder 用 ::before { padding-bottom: 56.25% } 撐 aspect
   佔位 + 子層 DIV.js-lazy-load { position:absolute; inset:0 } 填滿。static-flow
   reset 把 js-lazy-load 打回 static → 圖掉出 overlay 堆到「仍存活的 ::before
   佔位」下方 → 標題下方一大塊空白（Jimmy 2026-06-25 截圖回報）。placeholder
   ::before 一併中和後佔位消失，static 化的圖以 intrinsic 高度自然撐起。 */
/* v1.0.5：lazy-load 容器內的 loading spinner <svg> 隱藏——placeholder / ratio /
   object-fit 這類 lazy-load wrapper 的 direct child <svg> 是載入動畫 spinner
   （fiaformulae js-lazy-load wrapper 內 <svg><use></use></svg>），reader mode 下
   原站 lazy observer 凍結、spinner 不會被站方 JS 隱藏。媒體 element display:block
   規則讓無 viewBox/height 的 svg 露出 replaced-element 預設 150px 高度，在圖片
   上方撐出空白。direct child <svg> 是「lazy 佔位 spinner」的結構訊號（內容用
   svg 圖表掛在 figure/content div、不會是 lazy wrapper 的 direct child）。 */
[${ARTICLE_ATTR}="1"] [class*="placeholder" i] > svg,
[${ARTICLE_ATTR}="1"] [class*="ratio" i] > svg,
[${ARTICLE_ATTR}="1"] [class*="object-fit" i] > svg {
  display: none !important;
}
/* CSS side-bleed 裝飾 pseudo（::before / ::after + position:absolute + bg-color
   + transform: translate）—— 原站慣例用來把卡片底色「溢出」到 article 左右側，
   reader card 不需要這種裝飾。CNBC ArticleHeader-styles-makeit-wrapperHeroNoImage
   ::before 把 white bleed 到 header 左側 522×482px 大片白盒（v0.7.169 Jimmy
   2026-05-23 截圖揭穿；CDP DOM.getNodeForLocation 指認 transform:matrix(1,0,0,1,
   -522.578,0) + bg-color:white）。修法：reader card 內 *::before / *::after
   一律清掉 background-color 與 background-image，content + color 不動，list
   marker / drop cap 文字 pseudo 仍工作。
   通則安全：pseudo bg 在 reader card 沒有合法用途——pageWrapper 已有自己的
   bg，多餘 pseudo bg 只會在版心外漏出色塊（或誤覆蓋主文）。 */
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"])::before,
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"])::after {
  background-color: transparent !important;
  background-image: none !important;
}
/* v0.8.41：reader card / ancestor「自身」的 ::before / ::after 整顆關掉。
   上面那條只蓋 card 的「後代」pseudo、且只清 bg（border 畫的裝飾清不到）。
   foreignaffairs.com 在整頁 wrapper .base::before 掛 position:absolute +
   inset:0 + border:15px solid 的整頁裝飾框；該 wrapper 被選為 card（或落在
   ancestor 鏈）後 position 被 reset 成 static，inset:0 改以 viewport 大小的
   initial containing block 定位，渲染成「第一頁位置一個 viewport 大小的框」
   （site 邊框色跟 color-scheme 走：dark 黑框 / light 灰框）。
   通則安全：card = 主文容器、ancestor = 純 layout 通道，reader mode 下兩者
   自身的 pseudo 只可能是站方版面裝飾（frame / side-bleed / overlay）；drop cap
   / list marker / 引號這類合法文字 pseudo 都掛在後代元素上，不受影響。
   直接 content:none 比逐項清 paint 屬性（bg / border / shadow）徹底。 */
[${ARTICLE_ATTR}="1"]::before,
[${ARTICLE_ATTR}="1"]::after,
[${ANCESTOR_ATTR}="1"]::before,
[${ANCESTOR_ATTR}="1"]::after {
  content: none !important;
}
/* Body wrapper margin reset：原站慣例用 div 包 paragraph cluster / heading /
   list 並設 margin-left/right 形成 grid offset 或 narrow-column 視覺（CNBC
   ArticleBody 內 div.group margin-left:91px 把內文 p 整段推向版心右側 91px；
   v0.7.169 Jimmy 截圖揭穿 p rect.left=587 vs caption rect.left=496）。
   reader card 單欄版心、這些 wrapper margin 失意義、把主文擠成偏右窄條。
   通則：含 direct content child（p / h1-h6 / ul / ol / blockquote）的 div =
   body content wrapper、reader mode 不需橫向位移、清掉 margin-left/right。
   其他媒體 block（figure / blockquote / pre）有自身 margin auto-center 邏輯
   不受影響（這條 selector 命中的是 div，不是 figure/blockquote 本身）。
   CSS :has() Chrome 105+ 支持、Manifest V3 用戶實機均可用；jsdom 不支持
   :has() 語意但只驗 CSS 字串注入即可（不依賴 layout 計算）。 */
[${ARTICLE_ATTR}="1"] div:has(> p),
[${ARTICLE_ATTR}="1"] div:has(> h1, > h2, > h3, > h4, > h5, > h6),
[${ARTICLE_ATTR}="1"] div:has(> ul, > ol),
[${ARTICLE_ATTR}="1"] div:has(> blockquote) {
  margin-left: 0 !important;
  margin-right: 0 !important;
}
[${ARTICLE_ATTR}="1"] a > img {
  max-width: 100% !important;
}
/* Icon container wrapper 內的 img 限縮到合理 icon 尺寸：原站常用 wrapper-icon
   / media-icon / app-icon / thumb-icon 等 CMS 命名作為「inline 小圖容器」，
   靠 stylesheet 對 wrapper 設 width:160px + img 設 width/height:100% 達成
   小尺寸顯示。reader mode 下 jread 對 img 套 height:auto !important 會把
   原站的 height:100% 蓋掉，img 退到 naturalWidth×naturalHeight（icon 通常
   512×512）+ wrapper shrink-to-fit 跟著撐大 → 小 icon 變超大圖。
   通則依據：「wrapper-icon / media-icon / app-icon」是跨站 CMS 命名 pattern
   （WordPress block themes / Squarespace / 自製 design system 普遍用），用
   attribute substring selector 命中含此 token 的 wrapper、對其內 img 限縮
   max-width/max-height 200px（一般 icon < 200px、超過視為配圖不該套此規則）。
   實測：macstories.net 的 PixyCAD app icon 從 512px 壓回 < 200px 顯示。 */
[${ARTICLE_ATTR}="1"] [class*="wrapper-icon"] img:not(a > img),
[${ARTICLE_ATTR}="1"] [class*="wrapper_icon"] img:not(a > img),
[${ARTICLE_ATTR}="1"] [class*="media-icon"] img:not(a > img),
[${ARTICLE_ATTR}="1"] [class*="media_icon"] img:not(a > img),
[${ARTICLE_ATTR}="1"] [class*="app-icon"] img:not(a > img),
[${ARTICLE_ATTR}="1"] [class*="app_icon"] img:not(a > img),
[${ARTICLE_ATTR}="1"] [class*="thumb-icon"] img:not(a > img),
[${ARTICLE_ATTR}="1"] [class*="icon-wrapper"] img:not(a > img),
/* v0.7.207：avatar 是跨站通用 pattern（Medium / Substack / WordPress / CMS
   類「作者頭像」「來源圖示」），命名慣例 author-avatar / avatar-wrapper /
   avatar_image / user-avatar 等。reader mode 下這類 img 應保持 icon 尺寸、
   不該因 flex layout 被撐到全寬。命中 wrapper class 或 img class 含 avatar
   token 都套 200px 上限。thenewslens.com 「中央通訊社」author-avatar 在
   ratio wrapper 內被撐到 496×496 實機 bug 觸發。 */
[${ARTICLE_ATTR}="1"] [class*="avatar" i] img:not(a > img),
[${ARTICLE_ATTR}="1"] img[class*="avatar" i]:not(a > img) {
  width: auto !important;
  height: auto !important;
  max-width: 200px !important;
  max-height: 200px !important;
}
/* iframe 特例：有 intrinsic 高度這件事對 iframe 不成立——height: auto 會
   掉回 HTML spec 預設的 150px，打壞 aspect-ratio wrapper（WP wp-embed /
   Substack / Medium 等「wrapper 維 16:9 + iframe position:absolute 填滿」
   模式）。只 cap 寬度、不動高度。 */
[${ARTICLE_ATTR}="1"] iframe {
  max-width: 100% !important;
}
/* figure / picture 媒體容器撐滿父寬度：reader mode 下原站 DOM 結構被我們
   改動（ancestor reset / body 解除原 layout），某些站（例如商周
   figure.articlephoto）原本靠「width: 800px」類固定寬 CSS 給 figure
   顯式寬度的 rule 失效後，figure 退化成 shrink-to-fit + min-width:0 →
   被 figcaption 中文單字寬度夾死成 ~31px、img 跟著縮到幾乎看不見。
   通則：display:block 的媒體容器預設行為就是 100% of parent，reader
   mode 下強制明示這個預設、不依賴原站殘留 CSS。picture 同理避免類似
   退化。不碰字體/字級/行高，只處理媒體容器的寬度退化。 */
[${ARTICLE_ATTR}="1"] figure,
[${ARTICLE_ATTR}="1"] picture {
  width: auto !important;
  max-width: 100% !important;
  /* v0.7.99：figure 與下方主文內容拉開間距。BBC Culture 類站點原站 CSS
     '.bOanuU' 之類 styled-components hash class 把 figure margin 砍光，
     reader mode 下 figcaption 正下方緊貼下一段 p、視覺壓在一起。
     1.5em 相對字級縮放（讓使用者調字級時間距同步），不寫死 px 避免
     「字小時間距過寬 / 字大時間距太擠」。 v0.7.100 加 margin-top 同樣
     1.5em，解 figure 上方緊貼前一段 p 的對稱問題。 */
  margin-top: 1.5em !important;
  margin-bottom: 1.5em !important;
}
/* v0.7.209：figcaption 固定寬度退回 auto。原站可能對 figcaption 設固定窄寬
   做 sidebar-style 圖文並排 layout（twreporter.org figcaption width: 180px
   配主文 480px 雙欄）。reader mode 下 figure 已被強制 block，圖說殘留固定
   180px 窄寬會被擠成「每行 1-2 字」的窄欄。
   width: auto 拉回 block-level 預設 = 100% of parent；max-width: 100% 防上限
   超出 figure。不碰 background/color/font——保留原站 typography hierarchy。 */
[${ARTICLE_ATTR}="1"] figcaption {
  width: auto !important;
  max-width: 100% !important;
}${!theme.text ? `
/* v0.8.123：light theme 圖說顏色加深。dark / sepia 下 figcaption 已由
   userOverrides 的 *-color-theme.text 規則強制接管文字色（v0.8.45）、
   對比足夠；但 light theme 不注入文字色（theme.text 為 null），figcaption
   保留原站灰（theverge.com 實測 #4a4a4a / 8.86:1——對比其實不差，但比內文
   #1a1a1a 淺一截、配 11px 小字視覺上偏淡，Jimmy 2026-06-19 回報「淺色模式
   圖說對比不夠、閱讀困難」）。不同站原站 caption 灰深淺不一（部分站 #999
   ~ 2.8:1 確實低對比）→ light theme 統一強制深灰 #333（白底 12.6:1，比
   原站 #4a4a4a 更深、又仍比內文近黑淺一階，保留 caption < body 的階層）。
   figcaption * 一併覆寫——photo credit 常包在 figcaption 內的 <em> / <span>
   （theverge 實測），inline 子元素自身若有色規則不靠 inherit、需顯式覆寫。
   結構通則（非站點特判）：light theme 所有 figcaption 一律套此可讀深灰。

   v0.8.169（TWZ 圖說黑條修法）：一併把 figcaption 背景正規化為透明。bg-preserve
   邏輯（v0.7.195，BG_PRESERVE_NOT 排除 figcaption）原意是保留站點「淺字 + 深底」
   成對的可讀圖說；但本條 light theme 規則已強制圖說文字為卡片色深灰 #333，與
   「保留深底」直接矛盾——站點若給 figcaption 設深色背景（twz.com
   .article-featured-image-caption 深底 #2a3439 + 站點圖說字 #333 = 1.01:1），
   深字落深底＝整條黑條、credit 文字完全看不見。既然 light theme 已決定圖說用卡片色
   文字，背景就必須跟著卡片走（透明讓白卡透出）。dark / sepia 不受影響（gated 在
   !theme.text、theme bg/text 另由 *-color-theme 規則接管）。 */
[${ARTICLE_ATTR}="1"] figcaption,
[${ARTICLE_ATTR}="1"] figcaption * {
  color: #333333 !important;
  background-color: transparent !important;
}` : ''}
/* v0.7.100：h1-h6 上下 margin。BBC Culture 類站點原站 CSS 把 heading 的
   margin 全砍光（styled-components hash class 預設 margin: 0），reader mode 下
   段落 p 結束 → h2 標題 → 下一段 p 三者直接接壤、無視覺斷層、難辨章節。
   通則：h2-h6 加大 margin-top（章節分隔）+ 較小 margin-bottom（標題與其
   描述 / 首段較緊密）。h1 主標題已由 first-child rule 強制 margin-top: 0
   不衝突，這條對 h1 加 margin-top 也不傷（first-child rule specificity 較高）。
   v0.7.171：原 1.5em / 0.5em 在「font-size 巨大的 h1」站點(CNBC h1.headline
   font-size:54px → 1.5em = 81px margin-top)會撐出 80-90px 的「LIFE 標籤跟標題
   中間大段空白」、dark mode 卡片底色深、空白特別明顯。Jimmy 2026-05-23 CNBC
   blob 截圖揭穿。改用 clamp() 上下限封頂：margin-top 介於 16px..32px、
   margin-bottom 介於 8px..16px。CNBC h1 81px → 32px;BBC h1 ~48px → 32px;
   一般 h2-h6 (font 24-30px) 1em 在 24-30px 落入 clamp 中段、近似原 1.5em
   效果但不會無限放大。clamp 中段值用 1em 而非 1.5em、配合 cap 後 medium-h1
   也夠視覺分隔。 */
[${ARTICLE_ATTR}="1"] h1,
[${ARTICLE_ATTR}="1"] h2,
[${ARTICLE_ATTR}="1"] h3,
[${ARTICLE_ATTR}="1"] h4,
[${ARTICLE_ATTR}="1"] h5,
[${ARTICLE_ATTR}="1"] h6 {
  margin-top: clamp(16px, 1em, 32px) !important;
  margin-bottom: clamp(8px, 0.4em, 16px) !important;
}
/* v1.0.8：byline meta 區一行正規化（標記由 apply() 結構偵測，見 BYLINE_ATTR
   常數註解）。root flex 一行、wrapper display:contents 打平任意巢狀讓 leaf 升為
   root 的 flex item、item 字級統一、頭像 inline 對齊內容左緣、隱藏閱讀時間。
   全 theme 適用（byline 文字色交給 reader 文字色 inherit、作者連結維持 link 色
   雙通道）。 */
[${ARTICLE_ATTR}="1"] [${BYLINE_ATTR}] {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: wrap !important;
  /* v1.5.28：align-items center → baseline。center 讓等高 item 中線對齊，但站點
     item 內容（date span / 含 <a> 的 program-block）盒內基線位置不一，中線對齊後
     文字看起來上下錯位（NPR「HEARD ON」比日期高 9px）。baseline 直接對齊各 item
     文字基線，文字齊一行；byline 以文字為主，基線對齊比中線穩（頭像 item 由下方
     img 規則控高、baseline 下對齊亦自然）。 */
  align-items: baseline !important;
  justify-content: flex-start !important;
  column-gap: 0.5em !important;
  row-gap: 0.2em !important;
  margin: 0.2em 0 0.8em 0 !important;
  padding: 0 !important;
  text-align: left !important;
}
[${ARTICLE_ATTR}="1"] [${BYLINE_WRAP_ATTR}] {
  display: contents !important;
}
[${ARTICLE_ATTR}="1"] [${BYLINE_ITEM_ATTR}] {
  display: inline-flex !important;
  align-items: center !important;
  /* v1.0.18：item 內若同時含直接文字 + 子元素（"By <a>作者</a>"、"published
     <time>…"、小頭像 + 名字），inline-flex 會把文字與元素變成相鄰 flex item、
     吃掉它們之間的空白（space.com byline 實測 "ByTereza" 黏在一起）。補一個
     正常字距 column-gap 還原詞距；純單一文字 / 單一媒體的 item 只有一個 flex
     child、gap 無作用故不受影響。 */
  column-gap: 0.25em !important;
  margin: 0 !important;
  padding: 0 !important;
  float: none !important;
  font-weight: 400 !important;
  letter-spacing: normal !important;
}
[${ARTICLE_ATTR}="1"] [${BYLINE_RT_ATTR}] {
  display: none !important;
}
/* v1.5.28：byline 內發稿時刻（HH:MM AM/PM TZ）隱藏，只留日期。 */
[${ARTICLE_ATTR}="1"] [${BYLINE_TIME_ATTR}] {
  display: none !important;
}
/* v1.5.28：廣播節目出處 chip（"Heard on <節目>"）隱藏——閱讀模式非必要 metadata。 */
[${ARTICLE_ATTR}="1"] [${BYLINE_PROGRAM_ATTR}] {
  display: none !important;
}
/* v1.5.28：日期 item order:1 推到最後 → 作者（預設 order:0）排在日期前。 */
[${ARTICLE_ATTR}="1"] [${BYLINE_DATE_ITEM_ATTR}] {
  order: 1 !important;
}
/* v1.5.28：標題前的分類 kicker（連分類頁的短連結）隱藏。 */
[${ARTICLE_ATTR}="1"] [${KICKER_ATTR}] {
  display: none !important;
}
[${ARTICLE_ATTR}="1"] [${BYLINE_ATTR}] img {
  width: auto !important;
  height: 2em !important;
  max-height: 2.2em !important;
  margin: 0 !important;
  border-radius: 50% !important;
  flex: 0 0 auto !important;
  object-fit: cover !important;
}
/* v1.0.19：byline 內頭像媒體（picture / img / video）margin reset。頭像在
   Substack 等站是 <picture> 包 <img>、flex item 是 picture（不是 img）。上方
   hero 媒體置中通則（[ARTICLE] picture { margin-left/right: auto }，specificity
   0,2,1）會把 byline 頭像 picture 也當區塊媒體置中——在 byline flex 一行內，
   auto margin 解析成「吃光自由空間」（culpium.com 實證頭像 margin 兩側各 190px、
   把頭像推到列中央），justify-content:flex-start 因無自由空間可分配而失效，頭像
   與作者/日期散開。doubled [BYLINE] attr 把 specificity 提到 (0,3,1) 壓過置中
   通則，鎖 byline 媒體 margin:0 + flex:0 0 auto，靠 root 的 flex-start 左排。 */
[${ARTICLE_ATTR}="1"] [${BYLINE_ATTR}][${BYLINE_ATTR}] picture,
[${ARTICLE_ATTR}="1"] [${BYLINE_ATTR}][${BYLINE_ATTR}] img,
[${ARTICLE_ATTR}="1"] [${BYLINE_ATTR}][${BYLINE_ATTR}] video {
  margin: 0 !important;
  flex: 0 0 auto !important;
}
/* v0.7.102：p / ul / ol / blockquote 段落間距已搬到 userOverrides 條件注入
   （v0.7.162 起 paragraphSpacing 可調）。預設 paragraphSpacing=1.0 + Auto 兩種
   切分後不再永遠注入，Auto 模式下完全保留原站 typography。注入點見 buildCss
   末段 paragraphSpacing >= 0 條件分支。 */
/* 注意：aspect-ratio / padding-bottom 的 placeholder hack 破解改由
   cleaner.resetMediaPlaceholderPadding 在 runtime 處理——因為 CSS :has() 無法
   區分「padding-bottom hack（Substack/Medium 類）」與「純 aspect-ratio
   容器（Engadget 類 aspect-ratio: 16/9 + img absolute inset:0）」：前者
   padding 留著會造成空白、需 reset；後者 aspect-ratio 是容器撐高的唯一來源、
   被 reset 就會把圖壓成 0 高度。runtime 檢查 computed padding-bottom 比例才
   分得出來，CSS level 做不到。 */
/* Bootstrap col-* 系列 column wrapper reset：原站用 col-md-9 / col-lg-6
   等 class 把內容鎖在固定寬度欄位（".col-md-9 { width: 75%; }" 或類似 CSS
   class rule）。Reader mode 下 single-column 視覺、這些 column constraint
   該拔掉讓主文撐滿 card 寬度。
   esmchina.com /news/14116.html 實測：主文 p 所在 col-md-9.article-left
   width 被鎖 288px、card 寬 720px 下主文只占 40%。
   通則依據：Bootstrap grid class 是跨 CMS 標準（WordPress / Django / Rails
   普遍用）、非站點特判。attribute selector [class*="col-X-"] 精準命中
   col-xs-* / col-sm-* / col-md-* / col-lg-* / col-xl-*，不誤殺 .color-X /
   .collapse 等無 "-" 分隔的類命名。 */
[${ARTICLE_ATTR}="1"] [class*="col-xs-"],
[${ARTICLE_ATTR}="1"] [class*="col-sm-"],
[${ARTICLE_ATTR}="1"] [class*="col-md-"],
[${ARTICLE_ATTR}="1"] [class*="col-lg-"],
[${ARTICLE_ATTR}="1"] [class*="col-xl-"] {
  width: auto !important;
  max-width: none !important;
  float: none !important;
  /* v0.7.122：flex: initial (= 0 1 auto) 改 1 1 auto——flex-grow: 1 讓
     col-* wrapper 在 flex container 內主動撐滿父剩餘空間。原 initial 走
     flex-basis: auto + grow:0、依 content max-content 寬度自然 size。 */
  flex: 1 1 auto !important;
  /* v0.7.123：清 margin-left/right——cn.nytimes 實測對 .col-lg-5 設
     'margin-left: 61px'（Bootstrap col offset），即使 flex-grow:1 撐滿父寬，
     margin 也會把 wrapper 內容向內推 61px、article-body-item.rect 為
     'x=380 w=667 right=1047' vs partial 'x=319 w=728 right=1047'——
     content 起點被 margin-left 推 61px、視覺上主文段落仍只佔 reader card
     content area 的部分寬度。Bootstrap col offset 在 reader card 單欄
     layout 失意義（沒 row 結構讓 offset 對齊），清掉。 */
  margin-left: 0 !important;
  margin-right: 0 !important;
  padding: 0 !important;
}
/* padding: 0 解釋：原站 Bootstrap col 標準 gutter（padding-left/right: 15px）
   或客製化的 padding（businessweekly.com.tw .col-md-7 padding-right: 115px
   給右欄 sidebar 留白）在 reader mode 下會把 col 內容擠在 col 寬度的子集
   內，造成「主圖偏左、寬度不滿」破版。我們已 width: auto + float: none +
   flex: initial 把 col 退化成 block 流排、padding 已失 grid gutter 意義，可
   清。businessweekly blog 主圖（497px wide 卡在 col 內 padding-right 115px
   後）修法：清 padding 後圖回到 card 完整內寬 608px。 */
/* v0.7.201：內容 block 元素水平 padding reset。原站用 padding-left/right
   做多欄 layout 內縮（The Register 對 p 設 padding-left: 220px + padding-right:
   320px）。reader card 是 single-column、已有 56px 側邊 padding，原站
   的水平 padding 只會把文字擠窄（The Register 每行僅 6.7 字元）。
   只清 left/right，保留 top/bottom（站點可能用它做段落間距）。
   html 前綴提升 specificity。 */
html [${ARTICLE_ATTR}="1"] p {
  padding-left: 0 !important;
  padding-right: 0 !important;
}
/* v0.7.179：WordPress Gutenberg constrained layout override。WP block theme
   用 .wp-container-core-post-content-is-layout-HASH > :where(:not(.alignfull))
   對 p/h/ul/ol 等 content block 設 max-width: 560-650px。:where() specificity
   是 0 但 generated class 的 specificity (0,1,0) 搭配 cascade order 靠後仍
   贏過舊 JRead universal * 規則。
   對策：直接 target 常見 content block tag，specificity (0,1,2)+(0,1,2) 夠高。
   通則性：p / h1-h6 / ul / ol / dl / blockquote 是 HTML 標準 content block
   tag，不綁 WordPress class。非 WP 站不受影響（原 max-width 通常由頁面 CSS
   設、被此 rule override 也無害——reader card 內文 100% 撐滿是正確行為）。 */
html [${ARTICLE_ATTR}="1"] p,
html [${ARTICLE_ATTR}="1"] h1,
html [${ARTICLE_ATTR}="1"] h2,
html [${ARTICLE_ATTR}="1"] h3,
html [${ARTICLE_ATTR}="1"] h4,
html [${ARTICLE_ATTR}="1"] h5,
html [${ARTICLE_ATTR}="1"] h6,
html [${ARTICLE_ATTR}="1"] ul,
html [${ARTICLE_ATTR}="1"] ol,
html [${ARTICLE_ATTR}="1"] dl {
  max-width: none !important;
}
/* articleEl 內 block 裝飾 background 清除：原站常用彩色 wrapper
   block（accent bar、inset box、newsletter box、feature card）作為
   視覺裝飾。reader mode 下 card 本身已有統一底色，內部不該再有彩色
   block 打斷閱讀流。
   theverge.com 實測：duet--layout--entry-body-container 白底、
   _1wu3rm1 白色 inset、qnnwq1 綠色 accent、tly2fw0 紫色 block 等
   styled-components 裝飾 wrapper 全部清掉。
   preserve 清單：figure/figcaption/summary/blockquote 是 W3C 保留
   語意（主文媒體容器、引述）；code/pre/table/th/td 需要背景區隔
   （程式碼 block / 表格 row 交替色）；mark 是語意 highlight；kbd
   鍵盤按鍵視覺慣例白底。這些 tag 的原站背景保留。 */
[${ARTICLE_ATTR}="1"] *${BG_PRESERVE_NOT}:not([${PLAYER_ATTR}="1"]) {
  background-color: transparent !important;
  background-image: none !important;
}
/* v0.7.179：後代 text color reset——搭配上面的 background strip。原站 CMS
   banner / hero header 常用「白字 + 彩色背景」設計（CNN opinion-header、
   BBC live-page-header 等），styler strip 背景後白字對白底不可見。
   color: inherit !important 讓所有後代繼承 reader card 顯式設的 text color
   （見 html [data-jread-active] 的 color 規則）。
   exclude：a（保留連結色）、code/pre（保留 syntax highlight）、mark/kbd
   （語意 inline 元素）、table 系（保留 cell 色彩）、figcaption（背景保留
   所以文字色也保留——見下方 v0.7.195 註釋）。
   dark/sepia theme 另有 * { color: theme.text } 覆寫全部色，本規則被
   cascade 蓋過無副作用。
   v0.7.195：加 :not(figcaption)。background strip 規則已排除 figcaption
   （保留原站背景），但 color inherit 沒排除——導致 figcaption 原站深色
   背景 + reader card 深色繼承文字 = 對比度極低不可讀。TWZ (thewarzone.com)
   圖說白字 + 深灰底實測觸發。figcaption 背景與文字色必須成對保留，不能
   只保留一邊。dark/sepia theme 的 * { color } 覆寫仍會蓋過本規則。 */
[${ARTICLE_ATTR}="1"] *${COLOR_PRESERVE_NOT}:not([${PLAYER_ATTR}="1"]) {
  color: inherit !important;
}
/* v0.8.137：drop cap（::first-letter）顏色跟隨主文文字色。原站常對首段
   ::first-letter 設顯式 color + -webkit-text-fill-color（The Verge 暗色站對
   首段設白字 96px float drop cap）。reader mode 把段落文字色覆寫成 theme.text，
   但 ::first-letter 是獨立 pseudo-element、不繼承我們對段落的 color override，
   站點顯式白字殘留 → 淺底白字 drop cap 隱形（float 仍占位 → 首字位置空一格、
   看似「段落首字不見了」，Jimmy 2026-06-20 The Verge 截圖回報）。
   通則（結構訊號、非 class / hostname 特判，符合硬規則 3）：任何主文
   ::first-letter 一律 color: inherit（跟隨已被 reader 覆寫的段落色）+
   -webkit-text-fill-color: currentColor（蓋過站點 text-fill）。exclude 鏈與上方
   color inherit 規則一致（a / code / figcaption 等不動）。dark/sepia theme 的
   全域 color 覆寫選不到 ::first-letter（pseudo-element 不被 * 選到），本規則補上。 */
[${ARTICLE_ATTR}="1"] *${COLOR_PRESERVE_NOT}:not([${PLAYER_ATTR}="1"])::first-letter {
  color: inherit !important;
  -webkit-text-fill-color: currentColor !important;
}
/* v0.7.197：顯式 link color（所有 theme）。v0.7.179 加 color: inherit 時排除
   <a>（保留原站 link 色），但原站 link 色常配合已被 strip 的深色背景設計——
   TWZ (thewarzone.com) 作者連結原色 rgb(248,248,248)（近白），strip 背景後
   白字對白底不可讀，只剩 byline separator 逗號（dark inherit）突兀可見。
   dark/sepia 早有顯式 link 色 + underline（v0.7.100）；light theme 沒有是
   設計疏漏。現在三個 theme 統一顯式 link 色 + underline 雙通道差異化。
   light #1a73e8：Material Design blue，on #ffffff 對比 5.2:1（AA），與
   body text #1a1a1a 明確可辨。:not([player]) 排除嵌入 player 內連結。 */
[${ARTICLE_ATTR}="1"] a:not([${PLAYER_ATTR}="1"]) {
  color: ${theme.link} !important;
  text-decoration: underline !important;
  text-underline-offset: 2px !important;
  text-decoration-thickness: 1px !important;
}
[${ARTICLE_ATTR}="1"] a:not([${PLAYER_ATTR}="1"]) * {
  color: ${theme.link} !important;
}
/* v0.8.129：clickable 標題維持原本標題樣式。標題本身常是連結（permalink 形
   <h1><a href>標題</a></h1>）或被連結整顆包住（<a href><h1>標題</h1></a>）；
   上方 body-link 規則會把整個大標題染成 theme.link 藍字 + 底線，看起來像一條
   連結而非標題。通則：heading（h1-h6）內含或包住的 <a> 一律回退成繼承色
   （inherit → reader text color，跟非連結標題同色）+ 無底線，維持原站標題視覺。
   純結構訊號（heading tag），不綁站點 / class。:has 已在本檔他處使用（a:has(>img)）。
   specificity (0,2,2) > body-link 規則 (0,2,1) 且 source order 在後，穩定覆蓋。 */
[${ARTICLE_ATTR}="1"] :is(h1,h2,h3,h4,h5,h6) a:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] a:not([${PLAYER_ATTR}="1"]):has(:is(h1,h2,h3,h4,h5,h6)) {
  color: inherit !important;
  text-decoration: none !important;
}
[${ARTICLE_ATTR}="1"] :is(h1,h2,h3,h4,h5,h6) a:not([${PLAYER_ATTR}="1"]) *,
[${ARTICLE_ATTR}="1"] a:not([${PLAYER_ATTR}="1"]):has(:is(h1,h2,h3,h4,h5,h6)) * {
  color: inherit !important;
}
/* articleEl 內裝飾性 border 清除：原站常用 border / border-left 作為品牌 accent
   bar、callout 框、圖片框等視覺裝飾。reader card 本身已有圓角 + 陰影邊界，
   內部任何裝飾 border 都會打斷閱讀流，且會占空間（border-width 計入 box
   寬度）造成主文/媒體偏移。
   businessweekly.com.tw 實測：主圖外 wrapper div.Single-image.Border-left
   套 border-left: 45px solid rgb(188, 40, 28)（商周品牌紅 accent）→ 紅色
   色塊出現在主圖左方 + 圖片被往右擠 45px 看似破版。border-width:0 後 border
   視覺消失、wrapper 回到正常寬度、圖片置中。
   preserve 清單跟 background 清除一致 + hr：blockquote 的 border-left 是
   引述慣例；table/th/td 的 border 是資料分隔；code/pre 是程式碼框；
   figure/figcaption/summary 是 W3C 媒體語意；mark/kbd 是 inline 語意；
   hr 本身就是 border 化身（清掉等於消失）。
   只清 border-width 不動 border-style/color：影響範圍最窄、若原站日後改
   設計也容易 debug。 */
[${ARTICLE_ATTR}="1"] *${BORDER_PRESERVE_NOT}:not([${PLAYER_ATTR}="1"]) {
  border-width: 0 !important;
  left: auto !important;
  right: auto !important;
}
/* v0.7.190 inline code 底色統一：原站 inline <code>（不含 <pre> 內的）
   底色差異極大——MDN 用深灰近黑 rgb(45,48,52)、多數站用淺灰。reader
   card 白底上深灰 code badge 太突兀（D5）。統一覆寫為 theme 協調的
   半透明底色，保持 code 與主文的視覺區分但不喧賓奪主。
   不動 <pre> 內 code（程式碼 block 有自己的背景 + syntax color 體系）。*/
[${ARTICLE_ATTR}="1"] code:not(pre code) {
  background: ${theme.inlineCodeBg} !important;
  color: inherit !important;
}
/* 子元素寬度 cap：原站常用 width: 1152px / 1080px 等寫死寬度給 article
   detail layout wrapper（cna.com.tw 的 .centralContent 寫死 width: 1152px、
   原本給 article main + sidebar 的固定寬 layout）。reader mode 下 article
   已被 cap 到 contentWidth（720px）max-width，但子元素若寫死 width > 720px
   仍會 overflow 出 card 邊界造成「圖片/wrapper 偏右破版」（cna 索馬利蘭
   主圖 right=1488 超出 article right=1000 達 488px）。max-width: 100%
   強制所有後代不超過 parent 寬度，等於 cap 在 article content area 內。
   對 figure/blockquote/table/code 等保留語意也是合理 cap（不應超出版心）。
   不用 width: 100%（會把 inline-block / icon 等小元件強拉成滿寬）；只
   max-width 限縮上限，width:auto / 顯式 width 仍照原值算。
   v0.7.179：加 html 前綴把 specificity 從 (0,1,0) 升到 (0,1,1)——WordPress
   block theme 常用 .entry-content > p 寫死 max-width 560px !important
   （specificity 0,1,1 + !important），舊 (0,1,0) + !important 被打敗導致
   reader card 內文過窄。html 前綴不影響 match 語意（html 永遠 match）。 */
html [${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]) {
  max-width: 100% !important;
  /* v0.7.157：font-smoothing 繼承——站點若在子層級重設 -webkit-font-smoothing
     為 auto，會把 reader card 內部分元素拉回 subpixel-antialiased（macOS）導致
     字粗。強制 inherit 鎖定子層走 reader card 套的 antialiased（grayscale）。
     合併進此 universal rule（不另開）—— spec 既有 regex 預期第一條 universal
     selector body 內含 max-width: 100%。 */
  -webkit-font-smoothing: inherit !important;
  -moz-osx-font-smoothing: inherit !important;
}
/* 強制 block flow + 媒體置中。
   float: none——對所有 reader card 後代——原站常用 float 把媒體放 sidebar
   或做文繞圖（cna.com.tw figure.floatImg.center 等），reader mode 單欄
   card 沒 sidebar、float 會把媒體推出版心。
   margin-left/right: auto——**只**對媒體元素（img / picture / video / figure
   / iframe / table / blockquote / pre）水平置中。v0.7.105 修法：原本對所有
   '*' 套 margin auto 太廣泛——BBC byline 的 author wrapper (width 458px
   span 在 608px 父) 被 auto-center 偏右、跟 date 的左對齊不一致。改成
   只對「該被置中的媒體 / 區塊內容」套，generic div/span/text wrapper 自然
   左對齊不被 auto-center。垂直 margin 仍交給原站 / styler 既有 first-child
   reset。 */
[${ARTICLE_ATTR}="1"] *:not([${PLAYER_ATTR}="1"]) {
  float: none !important;
}
[${ARTICLE_ATTR}="1"] img:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] picture:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] video:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] figure:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] iframe:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] table,
[${ARTICLE_ATTR}="1"] blockquote,
[${ARTICLE_ATTR}="1"] pre {
  margin-left: auto !important;
  margin-right: auto !important;
}
/* v0.8.86：responsive embed 的 abs-pos iframe pin 回填滿 wrapper。
   原站慣例（thenewslens figure.video-responsive / WP wp-embed / Substack /
   Medium 等）用「wrapper position:relative + padding-bottom 16:9 hack +
   iframe position:absolute; left:0; width:100% 填滿」嵌入 YouTube/TED/Vimeo。
   上方置中規則對 iframe 套 margin-left/right:auto——但對 abs-pos 元素 margin
   auto 會依 CSS 定位方程式解出非零 left/right，把 iframe 推到 wrapper 寬一半
   的偏右位置破版（thenewslens.com/article/975 兩支影片 left=304px 實證）。
   apply() JS 量 computed position:absolute 標 [FILL_IFRAME_ATTR]（keyed on
   結構特徵非站點 class，placeholder reset 後變 static 的 iframe 不被標）、
   這條 pin 回 inset:0 + width/height:100% 填滿 wrapper，wrapper 自身仍走
   figure 置中規則對齊版心。
   selector 重複 [FILL_IFRAME_ATTR] 兩次是刻意提高 specificity：下方
   border-clear 通則（* 配 15 個 :not(tag) 保留鏈）specificity 累加到
   (0,2,15)，會對 iframe 套 left/right:auto 把它退回 static position（=破版
   位置）、壓過單一 attribute 的 (0,2,1)。雙 attr → (0,3,1)，第二欄 3>2 確保
   本規則的 left:0/right:0 勝出。 */
[${ARTICLE_ATTR}="1"] iframe[${FILL_IFRAME_ATTR}][${FILL_IFRAME_ATTR}] {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
}
/* left/right: auto 解釋：原站常用 position: relative + left/right 偏移做
   「圖片向左/右溢出版心做視覺擴張」hack（businessweekly.com.tw .Single-image
   套 position:relative; left: -90px; right: 90px——讓主圖在二欄 layout 中向
   左溢出 col-md-7 邊界視覺撐大）。reader mode 下單欄 card layout 沒這需求、
   offset 反而把圖推出 card padding 範圍變成「圖片偏左 + 右側溢出」破版。
   清 inset 後 element 回到正常 layout 位置（position:relative 保留、無
   offset 時等於 static 視覺）。preserve 清單跟 border 一致。
   top/bottom 不清——sticky 元素用 top:0 是合法 layout（但 ancestor reset
   已強制祖先 position:static、articleEl 內若有 sticky 是極少數合理場景）。 */
/* inline emoji / icon：naturalWidth <= ${INLINE_IMG_MAX}（或 natural 不可靠時
   rendered rect <= ${INLINE_IMG_MAX}，見 apply() 內 v0.7.214 註解）的小圖片由
   apply() JS 標記 [${INLINE_IMG_ATTR}]，保留 inline flow 不被 block + margin
   auto 推成獨立置中區塊。Facebook / LINE 等社群站 emoji 用 <img> 渲染
   （16~32px），forced block 會讓每個 emoji 換行置中破壞原文排版。 */
[${ARTICLE_ATTR}="1"] img[${INLINE_IMG_ATTR}] {
  display: inline !important;
  max-height: none !important;
  object-fit: initial !important;
  margin-left: 0.15em !important;
  margin-right: 0.15em !important;
  vertical-align: -0.1em !important;
}
`;
      baseSkeletonCacheSet(theme, contentWidth, base);
    }

    // ---- 使用者 override：僅在非預設值才注入 ----
    // body text selector list（不含 heading h1-h6——保留原站標題大小分級；
    // v0.6.0 baseline 精神「預設值保留原站」在此仍成立：DEFAULT 分支完全
    // 不走到這裡）。descendant 展開必要性：BBC / NYT / Guardian 等站點給
    // `<p>`、`<li>`、`<blockquote>` 用 class rule 直接鎖死 font-size /
    // line-height / font-family（例：BBC `.HooNV { font-size: 18px;
    // line-height: 26px; font-family: "BBC Reith Serif" }`）——只對 article
    // 本身設 font-size 會被後代自己的 rule 截斷 inheritance、override 失效。
    // 列舉常見 body text 元素才能穿透站點 class rule 的 specificity。
    // v0.7.120：figcaption 從 BODY_TEXT_SEL 移除——caption 是輔助說明，
    // 原站設計普遍比 body 小（0.7-0.85em，BBC 實測 12px vs body 18px）+
    // 較淡色，是 typography hierarchy 的關鍵差異化。把 caption 拉到跟
    // body 同 fontSize 視覺上等同於把圖說「升格」為主文段落，破壞「圖→
    // 說明」的階層感。Jimmy 2026-05-13 BBC Culture /article/...oxfords-
    // medieval-library 截圖回報：fontSize 非預設時 caption 跟內文同字級。
    // 保留 caption 原站 typography 比「跟 body 等比例縮放」更尊重原站設計。
    // v0.7.152：含 span。WYSIWYG 編輯器（Lexical / TipTap / ProseMirror /
    // Slate / Draft.js 等跨平台 rich-text 編輯器）輸出文章內文時普遍把每段
    // 文字包成 `<p><span style="white-space: pre-wrap">文字</span></p>`，並且
    // 站點 stylesheet 對 span 自身寫死 font-family（vocus.cc 實測：對所有
    // 文章內 span 套 `font-family: "Noto Sans TC", "Microsoft JhengHei fixed",
    // ...`）。p 上的 font-family override 不會 inherit 到 span（span 自己
    // 有 rule，截斷 inheritance），導致使用者「字型」設定完全失效。Jimmy
    // 2026-05-20 vocus.cc /article/6a0d369c... 回報「字型設定無效」實機觸發。
    //
    // :not exclusions 避免破壞 icon font span：material-icons / font-awesome
    // 等用 font-family 載 icon glyph，強制覆寫成襯線/無襯線會讓 icon 消失或
    // 變成奇怪字元。badge / emoji 同樣可能依賴特殊字型。實測 vocus 主文 0 個
    // icon span，這些 exclusion 是跨站保守防護不會影響 vocus 修法生效。
    // v0.7.164：再加 `:not(pre *):not(code *)`——pre / code 後代的 span 必須
    // 保留 monospace（程式碼框慣例）。Medium WYSIWYG 把 <pre> 內每行包成
    // <span class="...">，舊 SPAN_TEXT_SEL 把這些 span 套上使用者字型 stack
    // （sans-serif），讓站點 author CSS 對 pre 寫的 monospace 被 span 覆蓋
    // 失效。Jimmy 2026-05-22 Medium @ddsakura-blog M5 Max 評測文回報「框內
    // 等寬字型被代換」。利用 Selectors 4 complex selector in :not()（Chrome
    // 88+ 支援，Manifest V3 最低 88，全相容），pre / code 後代的 span 不命中
    // SPAN_TEXT_SEL → inherit 父元素字型（站點 pre author CSS 的 monospace
    // stack）。寫成兩個 :not()（不寫 :not(pre *, code *) selector list 形式）
    // 是為了 selector 字串內不含 comma——spec 程式用 split(',') 切 selector
    // list 驗證時不會誤把 :not() 內的 comma 當分隔切壞。
    // v0.7.175：加 :not(h1 *) ~ :not(h6 *)——heading 內的 span 不應被 body
    // text font-size 覆寫。CNA 等站 h1 文字包在 <span>，SPAN_TEXT_SEL 會
    // 把 span 字級壓成 body fontSize、打敗 h1 自身的 font-size。排除 heading
    // 後代讓 span 正確 inherit heading font-size。
    // v0.8.13：加 :not(time ~ span)——meta/日期列裡跟 `<time>` 同排的 bare span
    // （roomie.tw 實測：`<time class="post-date">2023/5/24</time><span>更新</span>`）
    // 是日期列標籤，不是主文內容。`<time>` 本身不在 BODY_TEXT_SEL、保留站點
    // 的小字（.post-date 11px），但相鄰 span 被 SPAN_TEXT_SEL 拉成 body 18px，
    // 同一條 meta 列出現 11px 日期 + 18px「更新」的字級斷層（Jimmy 2026-06-09
    // 回報「更新尺寸突兀」）。time 與其相鄰 span 是同一份「日期/meta 列」事實，
    // 兩條 path 不可 drift：span 跟著 time 一起保留站點 meta typography（如同
    // figcaption / caption 保留比 body 小的階層）。`time ~ span` 是結構訊號
    // （span 為 time 的後續兄弟），非站點/class 特判。複合 selector in :not()
    // 同 :not(pre *) 走 Selectors 4（Chrome 88+ 相容）。
    const SPAN_TEXT_SEL = `[${ARTICLE_ATTR}="1"] span` +
      `:not([class*="icon"])` +
      `:not([class*="material-"])` +
      `:not([class^="fa-"])` +
      `:not([class*=" fa-"])` +
      `:not([class*="emoji"])` +
      `:not([class*="badge"])` +
      `:not(pre *)` +
      `:not(code *)` +
      `:not(time ~ span)` +
      `:not(h1 *)` +
      `:not(h2 *)` +
      `:not(h3 *)` +
      `:not(h4 *)` +
      `:not(h5 *)` +
      `:not(h6 *)`;
    // v0.7.156：加入 td, th —— Wikipedia / 技術文件 / Stack Overflow 等用 table
    // 排版 content 的站點普遍對 `table.infobox` / `.wikitable` 等寫死 `font-size:
    // 0.88em` 縮小 table 內字。Jimmy 2026-05-21 Wikipedia /Longchamp_(company)
    // Chrome 翻譯成 zh-TW 後實測：body p = 18px ✓ / infobox td/th = 15.84px ✗
    // （Wikipedia table.infobox 0.88em 規則繼承），CJK 字型 metric 比 Latin 視覺
    // 上又小一階 → 使用者體感「中文特別小」。td/th 加進 selector 後 infobox 內
    // 文字會強制套使用者字級。`<table>` 自己**不加**——只攔 cell 級而不動 table
    // 級避免破壞站點 table layout（行高 / 邊框 / column 寬等）；cell 級字級放大
    // 已足夠解決「看不清」核心痛點。`caption` 跟著 td/th 一起進 selector——是
    // table 的標題，跟 cell 同等重要的閱讀內容。
    // v0.8.49：加 [TEXT_DIV_ATTR]——CMS「div 當段落」站（upmedia 等）的主文
    // 段落載體由 apply() runtime 標記（見 markTextDivs），列舉 tag 攔不到的
    // 裸 div 段落才能吃到使用者字級/字型/行距/字重設定。
    // v0.8.83：加 font——老式 table 排版內容頁（Paul Graham essays / 早期手寫
    // HTML）整篇主文包在 `<font size="2">` 裡，`size` 是 HTML4 呈現屬性、會把
    // font-size 重設成固定 px（boss.html 實測 13px），截斷從 `<p>` 繼承的使用者
    // 字級（fontSize=24 設定下 p=24px ✓ 但 font 仍 13px ✗）。font 進 selector 後
    // 強制套使用者字級/字型/行距/字重。`<font>` 在現代主文罕見、且 cleaner 已清
    // 掉 noise font（短/高連結密度），保留的必是內文載體——零誤傷風險。
    const BODY_TEXT_CORE =
      `[${ARTICLE_ATTR}="1"],` +
      `[${ARTICLE_ATTR}="1"] p,` +
      `[${ARTICLE_ATTR}="1"] li,` +
      `[${ARTICLE_ATTR}="1"] blockquote,` +
      `[${ARTICLE_ATTR}="1"] dd,` +
      `[${ARTICLE_ATTR}="1"] dt,` +
      `[${ARTICLE_ATTR}="1"] td,` +
      `[${ARTICLE_ATTR}="1"] th,` +
      `[${ARTICLE_ATTR}="1"] font,` +
      `[${ARTICLE_ATTR}="1"] caption,` +
      `[${ARTICLE_ATTR}="1"] [${TEXT_DIV_ATTR}="1"],`;
    const BODY_TEXT_SEL = BODY_TEXT_CORE + SPAN_TEXT_SEL;
    // v0.8.36：font-weight 專用 selector——span 再排除 strong / b 後代。
    // 字級 / 字型注入對 strong 內 span 是正確的（粗體文字也要跟著使用者字級
    // 字型），但 font-weight 注入打在 strong 內的 span 會把粗體抹平成使用者
    // 字重：WYSIWYG 編輯器（Lexical / TipTap，vocus 類站）普遍輸出
    // `<strong><span style="...">粗體</span></strong>`，span 自己命中規則 →
    // 文字渲染 400、內文粗體全部消失（預設設定就觸發，不需使用者改字重）。
    // p 級注入不受影響——strong 有 UA 自身 font-weight（bolder），不靠 inherit。
    const BODY_WEIGHT_SEL = BODY_TEXT_CORE + SPAN_TEXT_SEL +
      ':not(strong *):not(b *)';
    let userOverrides = '';
    // v0.7.162：lineHeight Auto sentinel = 0。Auto 時跳過所有 line-height 注入
    // （保留原站行距）；非 Auto 才把 lineHeight 串進 font-size rule 或獨立 rule。
    const lhAuto = opts.lineHeight === 0;
    if (overrides.fontSize) {
      // 同步注入 line-height：字級改了行高必須跟著縮放，否則原站用 px 鎖死的
      // 行高（例：Medium `.pi { line-height: 32px }` 配 20px 字級 = 1.6 倍）
      // 在字級被調小後變成過寬行距（32/16 = 2.0）。使用 opts.lineHeight
      // （預設 1.7 或使用者自調值），unitless 相對字級自動縮放。v0.6.0
      // baseline 「預設值不動原站」精神仍保留——使用者**完全沒改任何
      // override** 時 userOverrides 為空、DEFAULT 分支不走此路徑；只有
      // 使用者主動改字級才連帶動行高。
      // v0.7.162：使用者顯式選「行距 Auto」時跳過 line-height（即使 fontSize
      // 改過）—— 風險自負，原站若用 px 鎖死的 line-height 在字級縮小後會
      // 變成過寬行距，這是 Auto sentinel 的明確 trade-off。
      const lhClause = lhAuto ? '' : `
  line-height: ${opts.lineHeight} !important;`;
      userOverrides += `
${BODY_TEXT_SEL} {
  font-size: ${opts.fontSize}px !important;${lhClause}
}`;
    }
    if (overrides.titleFontSize) {
      // h1 * 必須一起覆寫：CNA 等站把 h1 文字包在 <span> 裡，SPAN_TEXT_SEL
      // 會把 span 字級壓成 body fontSize，即使 h1 本身 50px 也無效。
      userOverrides += `
[${ARTICLE_ATTR}="1"] h1,
[${ARTICLE_ATTR}="1"] h1 * {
  font-size: ${opts.titleFontSize}px !important;
}`;
    }
    if (overrides.fontFamily) {
      userOverrides += `
${BODY_TEXT_SEL} {
  font-family: ${opts.fontFamily}, -apple-system, "Noto Sans TC", "PingFang TC", system-ui, sans-serif !important;
}`;
    }
    {
      // v0.7.254：字重三段（細 300 / 中 400 / 粗 600）一律注入，含預設中 400。
      // 為什麼連 400 也注入（不沿用其他 override 的「預設值不動原站」優化）：原站
      // 若對內文設了非 400 的字重（shoppingdesign `.htmlview p { font-weight: 300 }`，
      // Jimmy 2026-06-08 cage 實證），中(400) 不注入就會退回原站的 300、與細(300)
      // 撞成同一種粗細——使用者切細/中看不出差別。使用者既然有「字重」這個明確
      // 控制項，三段就一律強制套用、才是三個真實字重。用真正的 font-weight 全平台
      // 生效（取代 v0.7.157 boldText 的 macOS-only -webkit-font-smoothing）。只套
      // BODY_WEIGHT_SEL（p / li / blockquote / span 等內文載體），**不含 h1-h6**
      // ——標題字重由原站 / UA bold 維持、保留章節階層。strong / b 自身有 UA
      // font-weight 不受 p 級注入影響；strong / b **內的 span** 由 BODY_WEIGHT_SEL
      // 的 :not(strong *):not(b *) 排除（v0.8.36——span 直接命中規則不是 inherit，
      // 不排除會把 WYSIWYG 站的內文粗體抹平）。
      userOverrides += `
${BODY_WEIGHT_SEL} {
  font-weight: ${opts.fontWeight} !important;
}`;
    }
    if (overrides.lineHeight && !overrides.fontSize) {
      // fontSize 已改過時 line-height 已連帶注入；這裡只處理「只改 lineHeight
      // 沒改 fontSize」的獨立分支，避免 CSS 重複 rule。
      // v0.7.162：lhAuto 時 overrides.lineHeight 為 false（見 apply 內 overrides
      // 計算），這裡不會誤注入；保險再 guard 一層。
      userOverrides += `
${BODY_TEXT_SEL} {
  line-height: ${opts.lineHeight} !important;
}`;
    }
    // v0.7.162：段落間距條件注入。Auto sentinel = -1 跳過（保留原站 typography）；
    // 非 Auto（含 0 / 預設 1.0 / 使用者自調值）注入 p / ul / ol / blockquote
    // margin-bottom。預設 1.0em 行為等價於 v0.7.102 base 內舊版固定規則（已搬
    // 離 base、改放此處受 Auto sentinel 控制）。
    if (opts.paragraphSpacing >= 0) {
      // v1.5.24：div 當段落站（upmedia 等 CMS 用裸 <div> 而非 <p> 排段落）的主文
      // 段落由 markTextDivs runtime 標記 [TEXT_DIV_ATTR]，比照 <p> 套段落間距——
      // 否則 text-div 段落 margin 全 0、上下段緊貼、也緊貼下方圖片（Jimmy 2026-06-30
      // upmedia 回報「段落無間距 / 文末與圖片無間距」根因）。caption（.mbt-text 類）
      // 字級小於主流、markTextDivs 已排除、不會被誤套段距。text-div selector 排在
      // blockquote 之前、保持 blockquote 為 rule 末 selector（既有 spec 以
      // `blockquote {` 為錨比對此 rule block）。
      userOverrides += `
[${ARTICLE_ATTR}="1"] p,
[${ARTICLE_ATTR}="1"] ul,
[${ARTICLE_ATTR}="1"] ol,
[${ARTICLE_ATTR}="1"] [${TEXT_DIV_ATTR}="1"],
[${ARTICLE_ATTR}="1"] blockquote {
  margin-bottom: ${opts.paragraphSpacing}em !important;
}
/* v0.8.92：消除「站點用 <p> 垂直 padding 撐段距」與 reader margin 疊加的雙倍
   間距。washingtonpost article-body 對每個 <p> 設 padding-bottom: 24px（不是
   margin），與上面 reader margin-bottom 1em(16px) 疊成 40px 段距——cage 實測
   washingtonpost Opinion 文章「段落之間額外空白」根因。段落垂直間距改由 reader
   margin 單一決定（單一資料源原則）：清掉 <p> 的 padding-top/bottom。
   只清 <p>：list 縮排是 padding-left（垂直 padding 罕見）、blockquote 引言框
   常靠 padding 撐內距且 reader 保留其背景（BG_PRESERVE_NOT 含 blockquote），
   都不在此清除範圍。padding-left/right 不動（不影響水平版心）。 */
[${ARTICLE_ATTR}="1"] p {
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}
/* v0.8.120：消除「站點 flex/grid 容器 row-gap」與 reader 段落 margin 疊加的
   雙倍間距。autosport.com（Motorsport CMS）的 .ms-article-content 是
   display:flex; flex-direction:column; gap:32px，flex 的 row-gap(32px) 與上面
   reader 段落 margin-bottom 1em(~17px) 疊成 49px 段距——使用者調 paragraphSpacing
   只改 margin、改不動 flex gap → Jimmy 2026-06-19 回報「段落間距變很寬、沒尊重
   設定」。段落垂直間距改由 reader margin 單一決定（單一資料源原則）：清掉 reader
   內所有元素的 row-gap。row-gap 僅對 flex/grid/multicol 容器生效（一般 block 元素
   設了是 no-op）→ 非 flex/grid 容器零副作用。只清 row-gap、不清 column-gap：
   flex-column 下 column-gap 不貢獻垂直空間，且翻頁模式版心 column-gap 必須保留
   （styler 僅注入 column-gap、從不注入 row-gap，故零誤清）。Auto 模式（sentinel
   -1）不進此分支、保留原站 flex gap typography。結構通則、非站點/class 特判。 */
[${ARTICLE_ATTR}="1"],
[${ARTICLE_ATTR}="1"] * {
  row-gap: 0 !important;
}
[${ARTICLE_ATTR}="1"] [data-jread-fb-para="1"] {
  margin-top: ${opts.paragraphSpacing}em !important;
  margin-bottom: ${opts.paragraphSpacing}em !important;
}`;
    }
    if (overrides.theme && theme.text) {
      // dark / sepia：覆蓋文字色（light 的 text 是 null，不注入）
      //
      // v0.8.45：移除 `:not(figcaption)`。v0.7.195 排除 figcaption 的理由是
      // 「背景與文字色成對保留」——但那是 light theme 的設計（light 不注入
      // 文字色、preserve 背景合理）；dark / sepia 下本規則的語意是「theme
      // 接管全部文字色」，figcaption 排除後留下原站深灰（為原站白底設計），
      // 疊在 dark 卡 #1a1a1a 上 ratio 1.7-2.7 不可讀（2026-06-11 page rounds
      // A 群 8 站：bbc x2 / cna / ctee / propublica / shoppingdesign /
      // techcrunch / theverge）。dark / sepia 下 figcaption 的原站背景也已
      // 由下方 v0.8.45 背景中和規則清掉，「成對保留」改為「成對覆寫」，
      // 不再有單邊覆寫的低對比組合。light theme 行為不變（本區塊不注入）。
      userOverrides += `
html.${HTML_CLASS} body {
  color: ${theme.text} !important;
}
[${ARTICLE_ATTR}="1"],
[${ARTICLE_ATTR}="1"] * {
  color: ${theme.text} !important;
}`;
      // v0.7.151：iframe (chart embed) 強制白底。dark / sepia theme 下 reader
      // card bg 深、跨 origin iframe（datawrapper / flourish / tableau / plotly
      // 等 chart service）內容預設 transparent + 為 light theme 嵌入站設計
      // 的深色文字 → 跟 dark reader card bg 完全融在一起、chart title / legend /
      // axis labels 不可讀。Jimmy 2026-05-20 回報 healthsystemtracker dark
      // theme 下「圖表區塊也使用深底色，導致文字難以閱讀」截圖確認。
      // 強制 iframe background:#fff 讓 transparent 區域透出白色、deeper text 可見。
      // 跨 origin iframe 我們無法讀寫其 styles、只能對 iframe element 本身設背景。
      // 副作用：YouTube / Vimeo / Twitter 等 video / social embed 自身 player
      // 會用自己 bg 覆蓋 iframe transparent area、白底 fallback 對它們無視覺
      // 影響；對 chart embed 是核心保護。
      // 用 html.__jread-active + [data-jread-active] 提升 specificity 到
      // (0,2,2)——避免站點 `iframe.datawrapper` 類 (0,1,2) rule 勝出。
      //
      // v0.7.154：同邏輯擴到 <img>——businessweekly chart PNG 帶 transparent bg
      // + light theme 設計（黑字 + 橘柱 + 紅標題 + 白方框 callout），light card
      // 透出白底正常顯示；dark card 透出 #1a1a1a → 黑色 x 軸文字（亞馬遜 / 輝達
      // / Google / Meta / 蘋果等）+ 黑色註解（資料來源：Google Finance）全部
      // 對比 1:1 直接消失。Jimmy 2026-05-21 chrome-in-chrome 連登入 session
      // probe 確認 chart 是 `<img class="thumb">`、bg transparent + alt 含
      // chart 標題 + image bitmap 內部已固定設計、jread 無法 invert 內容。
      // 修法：dark/sepia 強制 `<img>` 白底，讓 PNG transparent 區域透出白色、
      // 黑字回復可讀。
      // 副作用：JPG 主圖完整覆蓋整圖、白底 fallback 看不到無影響；公司 logo /
      // icon PNG 透明 + light 設計者透白底反而與站點 light visual 一致；
      // 透明 GIF / 小裝飾少見、白底無明顯害處。
      userOverrides += `
html.${HTML_CLASS} [${ARTICLE_ATTR}="1"] iframe,
html.${HTML_CLASS} [${ARTICLE_ATTR}="1"] img {
  background-color: #fff !important;
}`;
      // v0.7.154：blockquote 強制清背景。dark / sepia theme 下站點原本為 light
      // theme 設計的 blockquote（淺灰底 + 深色文字）—— styler line 454 preserve
      // 清單刻意保留 blockquote 原 bg（W3C 引述語意視覺區隔），但 dark theme
      // 下 jread `* { color: theme.text }` 把文字色覆寫成淺色 → 淺灰底 +
      // 淺灰文字 = 對比 1.x:1 不可讀。Jimmy 2026-05-21 回報商周
      // /Archive/Article?StrId=7014078 dark theme「引文底色與文字對比太低很難
      // 閱讀」截圖確認。
      // Probe 數值:站點 blockquote.blockquote 套 bg #f5f5f5、styler 覆寫 color
      // #d4d4d4 → 對比 1.38:1（WCAG AA 需 4.5:1）；inject 修法 transparent 後
      // 透出 reader card #1a1a1a → 對比 11.74:1（AAA 通過）。
      // 副作用：light theme 不注入（既有 preserve 設計仍有效）。dark / sepia
      // 下 blockquote 失去「淺底突顯」視覺、但 border-left / padding / ::before
      // 引號圖示 contrast 都 >= 13:1 仍可辨識為引文。
      // selector specificity (0,2,1) > 站點常見 `blockquote.blockquote` (0,1,1)
      // / `.quote-block` (0,1,0) 等 rule。
      //
      // v0.7.164：同邏輯擴到 <pre> + <code>。Jimmy 2026-05-22 回報 Medium
      // M5 Max 評測文（@ddsakura-blog）dark theme 下「白底卡片內淺灰字閱讀
      // 困難」截圖確認。Probe 確認真兇是 <pre>（不是 blockquote——Medium 整篇
      // 沒用 blockquote tag）：站點 .pre 套 bg #f9f9f9、styler 覆寫 color
      // #d4d4d4 → 對比 1.04:1（比 blockquote 更糟）。inline <code> 同個雷：
      // 站點 .code 套 bg #f2f2f2 + dark text → 對比同樣 1.04:1。兩者都是
      // 「站點 light theme 設計的淺色程式碼框 + jread dark 覆寫文字色」的同類
      // 通則 bug，跟 blockquote 走同一條 transparent 修法。
      // pre / code 失去「淺底程式碼框」視覺、但 padding / font-family monospace
      // 仍保留可辨識為 code；inline code 變成跟主文同色但 monospace 字體仍
      // 可區分。
      //
      // v0.8.45：同邏輯擴到 figure / figcaption / summary + table 系。2026-06-11
      // page rounds B 群 4 站實證同類 bug：BG_PRESERVE 在 light theme 下合理
      // 保留的「元素自帶亮色背景」（Wikipedia figure thumb #f8f9fa、維護模板
      // mbox table、newtalk figcaption.mainpic #f0f0f0、sspai 表格 TH/TD
      // #f7f7f9），dark theme 把文字色覆寫成亮灰後變成「亮底亮字」ratio
      // 1.3-1.5；亮底上的 theme.link 亮藍連結也只剩 2.1-2.2。中和背景讓暗卡
      // 透出，文字 / 連結色回到為暗底設計的對比。tag 清單 = BG_PRESERVE 群組
      // 減 mark / kbd（語意高亮的黃底 / 鍵帽白底是內容語意、保留；其上若有
      // 低對比由 apply() 的 dark contrast 兜底層逐元素修文字色）。
      // 用群組常數生成、不手寫 selector（v0.8.37 drift 防護同款）。
      userOverrides += `
${[...MEDIA_SEMANTIC_TAGS, ...CODE_TAGS, ...TABLE_TAGS]
    .map((t) => `html.${HTML_CLASS} [${ARTICLE_ATTR}="1"] ${t}`).join(',\n')} {
  background-color: transparent !important;
  background-image: none !important;
}`;
      // v0.7.197：連結色已移至 base CSS（所有 theme 統一注入）。
      // 此處不再重複注入。
    }

    // ===== 翻頁模式（v0.7.227）=====
    // 電子書式水平翻頁：reader card 改成 position:fixed 滿版容器 + CSS
    // multi-column overflow columns——「一頁一欄」+ column-fill: auto +
    // 高度約束，溢出內容自動長出等寬水平 column（= 頁）。翻頁由
    // content/paged-mode.js 程式控制 scrollLeft（stride = clientWidth，
    // 因 column-gap = 左右 padding 和，column 寬 + gap 恰為元素 clientWidth）。
    //
    // v0.7.230：「一頁一欄」必須用 column-width 表達、不可用 column-count: 1
    // ——WebKit（Safari macOS / iOS）對 column-count: 1 不建立 multicol
    // fragmentation context：不長 overflow columns、scrollWidth == clientWidth、
    // scrollLeft 永遠 clamp 0，翻頁完全失效（2015 年起的已知 engine bug，
    // Apple Developer Forums thread 22213；column-count >= 2 與 column-width
    // 路徑皆正常，safaridriver 真機 Safari probe 實證 count1 → pages=1 /
    // width 修法 → pages=12 可捲）。column-width: ${contentWidth}px 在
    // 「容器 content box 寬恆 <= contentWidth」前提下（max-width cap 保證），
    // 兩引擎都恰好算出 1 欄：N = max(1, floor((A + gap) / (W + gap)))，
    // A <= W → N = 1，used width 自動撐滿 A——窄視窗（手機）column 跟著
    // 縮、寬視窗 cap 在版心，與 column-count: 1 在 Chrome 的行為完全等價。
    // 此區塊**只在 settings.pagedMode = true 注入**——垂直卷動模式（預設）
    // 一行都不受影響。選擇器與 base 卡片規則同 specificity（html 前綴），
    // 同 stylesheet 內後注入者勝，覆寫卡片的 static / max-width / margin。
    //
    // v0.7.231：右側視覺內距必須用 border-right（transparent）表達、不可用
    // padding-right——WebKit（Safari 26.5 真機 + Playwright trunk 都實證）的
    // multicol scrollable overflow **不含尾端 inline-end padding**，
    // padding-right: 56px 會讓 max scrollLeft 比最後一頁的 stride 格點短 56px，
    // 翻到最後一頁被 clamp → 整頁右移 56px（文字貼死卡片右緣、左內距變兩倍，
    // 即「最後一頁版面寬度沒有尊重設定」症狀；其他頁目標值 < max 不受影響）。
    // border 不參與 scroll container 自身的 scrollable overflow，兩引擎
    // （Chromium 含尾端 padding / WebKit 不含）的 max scrollLeft 公式因此一致；
    // transparent border + 預設 background-clip: border-box 讓卡片底色照常
    // 鋪滿 border 區，視覺與 padding 完全相同。box-sizing: border-box（base
    // 卡片規則已設）下 max-width 720 = 56 padding + 608 content + 56 border
    //（v0.7.234 寬度一致後的桌面值），content box 寬 = column-width 算出值。
    if (opts.pagedMode) {
      // v0.8.166：頁碼指示器 / scrub-track 在 coarse-pointer 的底部抬升（24px，v0.8.162
      // 為 iPad 系統 bar / 縮放把手避讓而加）在 **iPhone** 上把頁碼推進內文造成重疊
      // （Jimmy 2026-06-23 截圖）。iPhone 沒有 iPad 的視窗縮放把手問題，回到接近底緣的
      // 低位即可。故 coarse 抬升的量依平台分流：iPhone 退回近底（6 / 30px，等同非 coarse
      // base），iPad / 其他 coarse 維持 24 / 48px。純 UA 結構訊號（iPhone / iPod），非站點特判。
      const _ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      const _isIPhone = /iPhone|iPod/.test(_ua);
      const _indicatorCoarseBottom = _isIPhone ? '6px' : '24px';
      const _scrubTrackCoarseBottom = _isIPhone ? '30px' : '48px';
      userOverrides += `
/* 翻頁模式：桌面鎖住文件垂直卷動（內容全在 fixed 容器內水平分頁）。
   overscroll-behavior 擋 macOS 觸控板水平 swipe 的歷史導航誤觸 +
   觸控裝置（下方 hack 放行垂直卷動後）擋頂端下拉的 rubber-band 把 fixed
   卡片帶出畫面、以及 pull-to-refresh 誤觸。 */
html.${HTML_CLASS}, html.${HTML_CLASS} body {
  overflow: hidden !important;
  height: 100% !important;
  overscroll-behavior: none !important;
}
/* v1.0.15：翻頁模式 WebKit（Safari macOS/iOS）整頁空白根治——祖先鏈 overflow
   還原 visible。reader card 在翻頁模式是 position:fixed；JRead 祖先 reset
   （ANCESTOR_ATTR 規則）把祖先 height 收成 auto、position 收 static，但**不動
   overflow**。Readwise Reader 這類「文件在內層 overflow:auto/hidden 捲動容器、
   非 window 捲動」的 SPA，祖先鏈多個節點帶 overflow:hidden/auto；reader mode
   下非主文兄弟被 display:none、祖先 height 全塌成 0（real page cage 實證：
   #document-reader-root / _appMain / appContent / #document-inbox / body 5 個
   overflow!=visible 的祖先全塌 0 高）。WebKit 會把 position:fixed 後代「裁切到
   帶非 visible overflow 的祖先 box」——祖先塌成 0 高 → 裁成空 → **整頁空白**
   （Chrome 對 containing block 為 viewport 的 fixed 後代不套祖先 overflow 裁切，
   故只在 Safari 炸；iOS 26.5 模擬器 standalone 重現 + 修法實證）。一般站祖先鏈
   overflow 多為 visible、不觸發，故捲動模式與多數站翻頁模式無此症狀。
   還原 visible 拿掉這個錯誤裁切；祖先此刻 height 0 且非主文兄弟 display:none，
   visible 不會多露任何內容（Chrome 端零視覺變化）。body 的 scroll-lock
   overflow:hidden 由上方 html 前綴規則（specificity 0,1,1 > 本規則 0,1,0）維持、
   不被覆蓋；body 為滿版 viewport 高、overflow:hidden 裁到 viewport 無害。
   結構性規則（描述「祖先帶 overflow 裁切」的 DOM 結構特徵 + 主文 fixed），
   不綁站點身份。 */
[${ANCESTOR_ATTR}="1"] {
  overflow: visible !important;
}
/* v0.7.238 iOS 工具列自動收合 hack：觸控裝置放行垂直卷動 + 略撐高 body。
   翻頁卡片是 position:fixed（視覺釘住、不隨 document 捲動），但底下 document
   可垂直捲——使用者垂直滑一下 → document 捲動 → iOS Safari 偵測到「真實手勢
   捲動」自動收合網址列工具列，多顯示一行內容（卡片 fixed inset:0 隨 layout
   viewport 變高、每欄多容一行）。程式捲動（window.scrollTo）無法觸發收合
   ——iOS 只認真實觸控手勢，simulator 對照實證——故只能半手動，使用者垂直滑一下觸發。
   限觸控裝置（(hover:none) and (pointer:coarse)）：桌面無此自動收合工具列，
   且撐高 body 會多一條無用垂直捲軸；桌面維持上方 overflow:hidden 鎖死。
   v0.7.244 min-height 500vh → 101vh（Jimmy 真機實測收尾，2026-06-08）：iOS 工具列
   收合**看「有沒有在捲動」、不看「捲多少」**——只要 body 比視窗略高、有一點點可捲
   空間（101vh ≈ 視窗高 +1%），使用者垂直滑一下就觸發收合（真機實測 101vh 收得了；
   先前以為要 ~280px 捲動距離是錯的）。**不可 <= 100vh**：body 不比視窗高就無可捲空間、
   完全收不了。為何縮到 101vh：500vh 的大捲動範圍讓第一頁左右滑被原生垂直 pan 搶走、
   不靈敏（Jimmy 最初回報「捲動範圍過高」）；101vh 把垂直捲動範圍壓到最低（捲軸幾乎
   看不到）→ 左右滑乾淨，又保留收合。**收合後不鎖死垂直卷動**——iOS 上「收合 + 鎖死」
   本質做不到（鎖死垂直時慣性捲動彈回頂端、工具列重展開；且使用者下滑必能叫回工具列，
   擋不住也不該擋，v0.7.240→243 燒四版 + 真機 instrument 實證）。第一頁放行垂直（可收合 /
   可自然叫回），第二頁起由 paged-mode.js onTouchMove preventDefault 鎖（純擋、不碰
   touch-action，無彈回問題）。垂直 scrollTop 不代表閱讀進度——onScrollProgress 在翻頁
   模式讓位（見該函式 guard）。 */
@media (hover: none) and (pointer: coarse) {
  html.${HTML_CLASS}, html.${HTML_CLASS} body {
    overflow-x: hidden !important;
    overflow-y: visible !important;
    height: auto !important;
  }
  html.${HTML_CLASS} body {
    min-height: 101vh !important;
  }
}
/* 滿版固定容器：left/right 0 + margin auto + max-width 讓桌面寬視窗時
   頁面寬度 cap 在版心（置中書頁感），手機窄視窗自然滿版。
   top/bottom 0 錨定取代 height: 100vh——iOS Safari 網址列收合時 fixed
   元素隨 layout viewport 調整，不吃 vh 單位的動態視窗誤差。
   水平內距：左 padding + 右 transparent border（不可用 padding-right，
   見上方 v0.7.231 註解）；column-gap = 左右內距和，維持
   「stride = column 寬 + gap = clientWidth − padding + gap」恆等式
   （paged-mode.js stride() 讀 computed style 算同一公式）。
   v0.7.234 寬度一致性（Jimmy 回報「翻頁與捲動模式頁面寬度不同」）：
   contentWidth 的語意以捲動模式 baseline 為準 = **卡片總寬**（含內距，
   border-box；內文 = contentWidth − 左右內距和）。翻頁模式必須同語意：
   max-width cap 在 contentWidth（不再 + 內距 ×2）、column-width =
   contentWidth − 左右內距和——兩模式卡片總寬與內文行寬才會逐 px 相等。
   「一頁一欄」invariant 不變：容器 content box 寬 A = min(viewport,
   contentWidth) − 內距和 <= W = calc(contentWidth − 內距和)，
   N = max(1, floor((A+gap)/(W+gap))) 恆 = 1（等寬時恰好 1）。 */
html [${ARTICLE_ATTR}="1"] {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: auto !important;
  height: auto !important;
  max-width: ${contentWidth}px !important;
  margin: 0 auto !important;
  padding: ${PAGED_TOP_GUTTER} 0 ${V_GUTTER} ${H_GUTTER} !important;
  border-right: ${H_GUTTER} solid transparent !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  column-width: calc(${contentWidth}px - ${H_GUTTER} * 2) !important;
  column-count: auto !important;
  column-gap: calc(${H_GUTTER} * 2) !important;
  column-fill: auto !important;
  overflow: hidden !important;
  /* v0.7.238 iOS 工具列自動收合 hack 的關鍵：卡片 touch-action: pan-y——
     讓觸控裝置在這張 fixed 卡片上的「垂直 pan」冒泡去捲底下 document
     （→ iOS Safari 偵測到真實手勢捲動 → 自動收合工具列）。沒有這行時，
     fixed + overflow:hidden 卡片上的非被動 touchmove listener 會讓 WebKit
     對垂直 pan 的處置變曖昧、scrollY 卡死 0（iOS simulator 真機實證：
     document 明明可捲 scrollH 1508 > 714、mq matches，但垂直滑不捲——
     加 pan-y 後才捲、innerH 714→754 工具列收合）。水平翻頁不受影響：
     翻頁由 paged-mode.js JS 讀 touchstart/end 座標程式控 scrollLeft，
     touch-action 只管瀏覽器「原生手勢」回應、不影響 JS touch event；
     pan-y 同時讓瀏覽器不嘗試原生水平捲（卡片 overflow:hidden 本就不可
     原生水平捲），與 v0.7.237 onTouchMove 對水平 swipe 的 preventDefault
     （擋系統邊緣返回手勢）互補並存。
     v0.7.255：補 pinch-zoom token——純 pan-y 會關掉雙指捏合（iOS Safari 的
     「呼叫所有標籤頁」手勢 = 雙指捏合縮放系統手勢），翻頁模式下使用者捏不
     出標籤頁切換器（Jimmy 回報）。pan-y 只放行垂直 pan、pinch-zoom 放行雙指
     縮放，兩者並列不互斥；單指水平 swipe 仍由 onTouchMove preventDefault 擋
     （preventDefault 只在 touches.length === 1 觸發，雙指捏合不受影響）。 */
  touch-action: pan-y pinch-zoom !important;
}
/* 媒體單頁化：高度 cap 在「頁面內容高 − caption 餘裕 120px」、等比縮放，
   搭配 break-inside: avoid 整塊不跨頁切割（高於一頁的元素 spec fallback
   仍會切，但 max-height 已保證 img/video 本體不超頁）。120px ≈ 3 行圖說
   + margin——56px 實測不夠（chinatalk 直式書封圖 + 圖說的 figure 總高
   818 > 頁 796，break-inside 對「高於 fragmentainer 的元素」失效強制切割）。
   100vh 與 100dvh 雙宣告：支援 dvh 的引擎（iOS 16.4+）用動態視窗高，
   舊引擎 fallback vh。 */
/* v0.8.10：img 選擇器排除 [${INLINE_IMG_ATTR}]——inline emoji / icon 不可套
   「縮放至單頁」的 width:auto + max-width:100%，否則 viewBox-only SVG emoji
   （X Twemoji）被撐成滿欄（150 natural → 608px，Jimmy 翻頁模式實機回報）。
   與捲動模式 block-image rule（line ~585/595）同一排除準則。inline-img rule
   （line ~1027）只覆蓋 max-height/object-fit/display、未設 width，故此規則的
   width:auto 仍會命中 emoji——必須在選擇器層排除。 */
html [${ARTICLE_ATTR}="1"] img:not([${INLINE_IMG_ATTR}]),
html [${ARTICLE_ATTR}="1"] video,
html [${ARTICLE_ATTR}="1"] svg,
html [${ARTICLE_ATTR}="1"] iframe {
  max-height: calc(100vh - ${PAGED_TOP_GUTTER} - ${V_GUTTER} - 120px) !important;
  max-height: calc(100dvh - ${PAGED_TOP_GUTTER} - ${V_GUTTER} - 120px) !important;
  width: auto !important;
  max-width: 100% !important;
  object-fit: contain !important;
}
/* v0.8.35：以「與 base 90vh cap 逐字相同的 selector（MEDIA_CAP_SEL）、同
   specificity、後注入勝」覆寫單頁 cap。上一條 html 前綴規則 (0,2,2) 在
   cascade 輸給 base 媒體 cap (0,3,3)——裸 img（非 a 包）的直式長圖在翻頁
   模式有效 max-height 變 90vh、超過欄高被跨頁切割。 */
${MEDIA_CAP_SEL} {
  max-height: calc(100vh - ${PAGED_TOP_GUTTER} - ${V_GUTTER} - 120px) !important;
  max-height: calc(100dvh - ${PAGED_TOP_GUTTER} - ${V_GUTTER} - 120px) !important;
}
html [${ARTICLE_ATTR}="1"] figure,
html [${ARTICLE_ATTR}="1"] picture,
html [${ARTICLE_ATTR}="1"] img,
html [${ARTICLE_ATTR}="1"] video,
html [${ARTICLE_ATTR}="1"] iframe {
  break-inside: avoid;
}
/* v0.8.7：翻頁模式下 media / 連結禁用原生 drag + 補 touch-action——真機實證
   （Jimmy 2026-06-09 culpium/Substack）圖片 draggable=true，iPhone 上水平拖曳
   圖片會啟動 iOS 原生 drag-and-drop（lift）搶走左右滑手勢 → 「圖片上滑不翻頁、
   內文正常」。卡片設 touch-action: pan-y 但 touch-action **不繼承**，圖片預設
   auto 仍放行原生手勢。對 media + 連結明確補 touch-action: pan-y pinch-zoom（同
   卡片，水平 swipe 不被瀏覽器原生攔）+ -webkit-user-drag/touch-callout: none
   （停掉圖片 drag-lift 與長按選單），水平 swipe 一律交給 paged-mode.js JS 翻頁。
   只在翻頁模式注入（此 block 在 if(opts.pagedMode) 內）；垂直模式不影響長按存圖。 */
html [${ARTICLE_ATTR}="1"] img,
html [${ARTICLE_ATTR}="1"] picture,
html [${ARTICLE_ATTR}="1"] figure,
html [${ARTICLE_ATTR}="1"] video,
html [${ARTICLE_ATTR}="1"] svg,
html [${ARTICLE_ATTR}="1"] a {
  touch-action: pan-y pinch-zoom !important;
  -webkit-user-drag: none !important;
  -webkit-touch-callout: none !important;
}
/* 頁碼指示（paged-mode.js 建立 / 更新文字）：固定底部置中。
   色用中性灰——白卡 / 黑卡 / 米卡上都可讀，不依賴 theme 欄位。
   v0.8.150：頁碼當 scrubber（按住拖曳快速跳頁）——必須 pointer-events: auto 才
   接得到 touch/mouse；touch-action: none 擋住 iOS 在指示器上的原生捲動/縮放/返回
   （翻頁由 JS 程式控）；padding 放大命中區好按；cursor ew-resize 暗示可左右拖。 */
#__jread-page-indicator {
  position: fixed;
  bottom: 6px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 12px;
  font: 11px/1 ui-monospace, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  color: rgba(128, 128, 128, 0.95);
  z-index: 2147483647;
  pointer-events: auto;
  touch-action: none;
  cursor: ew-resize;
  user-select: none;
  -webkit-user-select: none;
  border-radius: 999px;
  transition: background-color 0.15s ease;
}
/* 拖曳中（paged-mode.js 加 class）：淡底回饋「已抓住」，不拖時看不出差異維持低調 */
#__jread-page-indicator.__jread-scrubbing {
  background: rgba(128, 128, 128, 0.18);
}
/* v0.8.151 scrub 進度條：按住頁碼起拖時才出現（paged-mode.js 加 .__jread-scrub-visible
   fade-in）、放手淡出。位置在頁碼指示器上方置中、fill 寬 = 目前頁占全文比例，
   讓使用者拖曳時看得到在全文的哪個位置。fill 用 theme.progressBar 與頂部進度條同色。 */
#__jread-scrub-track {
  position: fixed;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  width: min(72vw, 360px);
  height: 4px;
  border-radius: 999px;
  background: rgba(128, 128, 128, 0.25);
  z-index: 2147483647;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
}
#__jread-scrub-track.__jread-scrub-visible {
  opacity: 1;
}
#__jread-scrub-fill {
  height: 100%;
  width: 0%;
  border-radius: 999px;
  background: ${theme.progressBar};
}
/* v0.8.162：觸控裝置把整組 scrubber（頁碼指示器 + scrub 進度條）往上抬離視窗
   底部——iPad 底部是視窗縮放把手 / 系統手勢區，頁碼停太低拖曳選頁會被 OS 攔走觸控
   （Jimmy 2026-06-22 iPad 截圖「頁碼太靠底部、拖不動」）。env(safe-area-inset-bottom)
   補 home indicator 高度（桌面為 0、不影響）。
   v0.8.166：抬升量依平台分流——iPhone 沒有 iPad 縮放把手問題，原 24px 抬升反而把頁碼
   推進內文重疊（Jimmy 2026-06-23 iPhone 截圖），故 iPhone 退回近底 6/30px；iPad / 其他
   coarse 維持 24/48px。指示器與 scrub-track 同抬同量、維持 24px 間距（track 在上方）。 */
@media (pointer: coarse) {
  #__jread-page-indicator {
    bottom: calc(${_indicatorCoarseBottom} + env(safe-area-inset-bottom, 0px));
  }
  #__jread-scrub-track {
    bottom: calc(${_scrubTrackCoarseBottom} + env(safe-area-inset-bottom, 0px));
  }
}`;
      // v0.8.153 觸覺回饋載體（#__jread-haptic）不再需要 styler CSS——比照實證可動的
      // ios-haptics 套件，paged-mode.js ensureHaptic 直接 inline display:none 建立
      // <label><input switch>] 並掛 document.body，觸覺由 label.click() 切換 switch
      // 狀態觸發、與渲染無關（v0.8.151/152 用 CSS 隱藏 + body 外掛載皆無觸覺）。
    }

    // 內嵌襯線 CJK 字型只在使用者實際選了自訂字型（overrides.fontFamily）時注入，
    // 與上方 font-family override rule 的觸發條件一致——預設無襯線時不污染 CSS。
    // 接在最末（user font-family rule 之後）：woff2 lazy-load、且不打亂「CSS 第一個
    // font-family block = user override rule」的既有結構（styler.spec 倚賴此順序）。
    // v0.8.146：再接「被選到的內嵌拉丁字型」@font-face（latinFontFaceFor 只在 stack
    // 含該 family 時回傳非空，故 latin = auto / 系統字時為空、不變 face 數）。
    // v1.0.20：byline 字體統一。站點常對作者連結與日期各設不同 font-family /
    // font-size（culpium.com Substack 實證：root/內文 SF Pro Display 18px，但作者
    // 與日期都被站點設成 SF Compact、且日期僅 11px——作者 18px、日期 11px，字體與
    // 字級都不一致）。翻譯後更明顯：CJK 日期 fallback 到系統 sans CJK、作者連結走
    // 站點 serif 顯示字體，視覺「作者與日期字體不同」（Jimmy 2026-06-26 回報）。
    // v1.0.8 byline 正規化只統一 font-weight / letter-spacing、漏了 family / size。
    // 修法（結構性、非站點特判）：byline 子樹所有元素用 `font: inherit` shorthand
    // 完整繼承上層字體（family / size / weight / style / line-height 全收斂），
    // 逐層繼承到 byline root 的 reader 字體與字級（root inherit 內文 = 使用者選的
    // reader 字型 + 字級），整條 byline 字體徹底一致。不碰 color（作者連結色雙通道
    // 由既有規則維持；font shorthand 不含 color）。
    // 兩個刻意決策：
    // (1) 接在 userOverrides（conditional typography 規則）之後、不放進 base
    //     skeleton——base 刻意不含 font-size 宣告（typography 字級全走 userOverrides），
    //     多站 typography spec 用「第一個 font-size 規則」的寬鬆 regex 取
    //     SPAN_TEXT_SEL，排前面會被誤抓；排後面 → first-match 仍命中 typography。
    // (2) 用 `font` shorthand 而非 font-family / font-size 兩條 longhand——byline 是
    //     「預設值仍正規化」的特例（一行 flex / 隱藏閱讀時間都在預設套用），但多站
    //     typography spec 守「預設不注入 font-family/font-size override」不變式（尊重
    //     原站內文 typography），用 longhand 會誤觸；shorthand 達成同樣完整繼承、語意
    //     正確（byline 要的就是全套字體繼承），且不撞那些 longhand 字面 regex。
    const bylineFontNorm = `
[${ARTICLE_ATTR}="1"] [${BYLINE_ATTR}] * {
  font: inherit !important;
}`;
    // Orion（Kagi）edge-to-edge top safe-area 補償。Orion 把頁面內容鑽進 Dynamic
    // Island / 狀態列下（捲動與翻頁兩模式都會，Jimmy 2026-06-30 實機回報），且不
    // 回報 env(safe-area-inset-*)（四向全 0）、UA 完全偽裝 Safari → env 與 UA 兩路
    // 皆無法分流。改由 content/orion-detect.js（world:MAIN）讀 window.kagi，在 <html>
    // 蓋 .jread-orion + 設 --jread-orion-top（依 screen.height 分檔的島/舊機高度）。
    // 本 CSS 只在 .jread-orion 命中時生效 → Safari 永遠不套、零回歸風險。
    //   捲動模式：body 補 top padding，scroll=0 時標題落在島下方。
    //   翻頁模式：fixed 卡片 top:0 → 下推 inset，標題清開島。
    // gating selector specificity (0,3,1) 贏過翻頁 base 的 html [data-jread-active] (0,1,1)。
    const orionSafeTop = opts.pagedMode
      ? `
html.${HTML_CLASS}.jread-orion [${ARTICLE_ATTR}="1"] {
  top: var(--jread-orion-top, 59px) !important;
}`
      : `
html.${HTML_CLASS}.jread-orion body {
  padding-top: var(--jread-orion-top, 59px) !important;
}`;
    return base + userOverrides + bylineFontNorm + orionSafeTop +
      (overrides.fontFamily ? FONT_FACE_CSS + latinFontFaceFor(opts.fontFamily) : '');
  }

  // v0.7.90 auto-hide scrollbar：scroll 事件觸發後立刻 set
  // [data-jread-scrolling="1"] on html、800ms 無新事件後清除。CSS 端用此
  // attr 切換 thumb 色，搭配 0.3s transition 達到 fade-in/out。
  // 模組層級 timer + listener function，apply 時 install / restore 時 remove。
  // 同個 function reference 才能正確 add/remove，所以不能用 closure 重新建構。
  const SCROLLING_ATTR = 'data-jread-scrolling';
  const SCROLL_HIDE_DELAY = 800;
  let scrollHideTimer = null;

  const PROGRESS_ID = '__jread-progress';
  let progressEl = null;
  function onScrollProgress() {
    if (!progressEl) return;
    // v0.7.238：翻頁模式下進度條由 paged-mode.js 依「頁比例」驅動。觸控裝置
    // 翻頁模式 document 可垂直捲動（iOS 工具列收合 hack），垂直 scrollTop 是
    // 「收合工具列用」的捲動量、不代表閱讀進度——讓位避免覆寫頁碼進度條
    //（與 onSpaceScroll 讓位 space-scroll 同準則：同一進度條兩條 path 各驅各的
    // 會打架）。
    if (NS.pagedMode && NS.pagedMode.isInstalled && NS.pagedMode.isInstalled()) return;
    const de = document.documentElement;
    const scrollTop = de.scrollTop || document.body.scrollTop;
    const scrollHeight = de.scrollHeight - de.clientHeight;
    if (scrollHeight <= 0) { progressEl.style.width = '0%'; return; }
    const pct = Math.min(100, (scrollTop / scrollHeight) * 100);
    progressEl.style.width = pct + '%';
  }
  function onScrollFlash() {
    const html = document.documentElement;
    if (html.getAttribute(SCROLLING_ATTR) !== '1') {
      html.setAttribute(SCROLLING_ATTR, '1');
    }
    if (scrollHideTimer) clearTimeout(scrollHideTimer);
    scrollHideTimer = setTimeout(() => {
      document.documentElement.removeAttribute(SCROLLING_ATTR);
      scrollHideTimer = null;
    }, SCROLL_HIDE_DELAY);
  }

  // v0.7.91：SPACE 鍵捲動。reader mode 啟動後，原站若攔截 keydown SPACE
  // 或 focus 不在 body 上（例如先前 focus 過某個被 cleaner hide 的元素），
  // 瀏覽器原生「SPACE = 往下捲一頁」會失效。對策：window 層級 capture phase
  // 攔 keydown SPACE 自己處理，比原站 bubble listener 早收到事件。
  // 例外：input / textarea / select / contenteditable focus 時放行（使用者
  // 在主文 input 留言或編輯時 SPACE 是輸入空格，不該被搶）。
  // viewport * 0.92 ≈ Chrome 預設 SPACE 捲動量；shift+SPACE 反向往上。
  // smooth scroll 視覺更舒服。
  const SPACE_SCROLL_FRACTION = 0.92;
  function onSpaceScroll(e) {
    // v0.7.216：space-scroll.js 段落焦點模組啟用時讓位——否則兩條 path 對同
    // 一個 SPACE 各捲各的（本 handler scrollBy 92% + 模組段落推進）疊成雙重
    // 捲動（2026-06-05 Playwright probe 實證 828px 幽靈捲動的根因）。模組
    // 停用（spaceScrollRatio = 0）時本 handler 自動回歸 v0.7.91 整頁捲動，
    // 維持「reader mode 下 SPACE 一定可捲」的原始動機。
    if (NS.spaceScroll && NS.spaceScroll.isInstalled && NS.spaceScroll.isInstalled()) return;
    if (e.key !== ' ' && e.code !== 'Space') return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const ae = document.activeElement;
    if (ae) {
      const tag = ae.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // contenteditable 在實機 Chrome 走 isContentEditable getter；jsdom 沒
      // 實作 getter，attribute fallback 兜底（真值為 "true" 或空字串）。
      if (ae.isContentEditable) return;
      const ce = ae.getAttribute && ae.getAttribute('contenteditable');
      if (ce === 'true' || ce === '') return;
    }
    e.preventDefault();
    e.stopPropagation();
    const dy = window.innerHeight * SPACE_SCROLL_FRACTION * (e.shiftKey ? -1 : 1);
    window.scrollBy({ top: dy, behavior: 'smooth' });
  }

  function markAncestors(articleEl) {
    const ancestors = [];
    let p = articleEl.parentElement;
    const stop = document.documentElement;
    while (p && p !== stop) {
      p.setAttribute(ANCESTOR_ATTR, '1');
      ancestors.push(p);
      p = p.parentElement;
    }
    return ancestors;
  }

  // ---- 「div 當段落」標記（v0.8.49）---------------------------------------
  // 結構訊號與 fb-post.js markParagraphDivs 同款：leaf paragraph div = 直接
  // child text node 有實質文字 + 沒有 block 子元素（只有 text node / inline
  // element）。upmedia 等 CMS 主文段落實測命中、巢狀 layout wrapper 不命中。
  //
  // caption 防護：圖說類 div（upmedia div.mbt-text 17px）也符合 leaf 條件，
  // 但依 figcaption 原則（v0.7.120——caption 比 body 小是 typography hierarchy
  // 的關鍵差異化）必須保留站點小字。結構訊號 = 字級階層本身：以「文字量加權
  // 最重的字級」為主文主流字級，只標記字級 >= 主流的 div——站點把 caption 設
  // 得比主文小，這個相對關係跨站成立（probe upmedia 實證：段落 22px ×5 段
  // 共 680 字 vs 圖說 17px ×2 共 76 字 → 主流 22px、圖說被排除）。
  // 文字量加權（不用 div 個數）：caption 短、段落長，個數多數決在「圖多文少」
  // 的相簿型文章會選錯邊，字數加權不會。
  function markTextDivs(articleEl) {
    const win = articleEl.ownerDocument?.defaultView;
    if (!win || !win.getComputedStyle) return [];
    const INLINE_TAGS = new Set(['SPAN', 'A', 'STRONG', 'EM', 'I', 'B', 'U', 'BR', 'MARK', 'SMALL', 'SUP', 'SUB', 'CODE', 'TIME', 'ABBR', 'S', 'DEL', 'INS', 'WBR']);
    const candidates = [];
    for (const div of articleEl.querySelectorAll('div')) {
      // figure 內 div = 圖說/媒體結構；pre/code 內保留程式碼排版；
      // contenteditable 是使用者輸入區不動
      if (div.closest && div.closest('figure, pre, code')) continue;
      if (div.isContentEditable) continue;
      let directLen = 0;
      let hasBlockChild = false;
      for (const node of div.childNodes) {
        if (node.nodeType === 3 /* TEXT_NODE */) {
          directLen += node.textContent.trim().length;
        } else if (node.nodeType === 1 /* ELEMENT_NODE */) {
          if (!INLINE_TAGS.has(node.tagName)) {
            hasBlockChild = true;
            break;
          }
          // v0.8.80：inline 子元素（span / a / strong…）內的文字也計入。WYSIWYG
          // 編輯器（Draft.js / Lexical 等）把段落文字包成 <div><span>文字</span></div>，
          // div 無直接 text node 但功能上就是段落——只看 direct text 會漏標，
          // line-height 只套到 inline span、parent block div 仍保留站點行高，block
          // strut（max(block lh, span lh)）壓過設定值（Jimmy 2026-06-16 mirrormedia
          // 行距不遵從設定的根因）。標記 block div 後 BODY_TEXT_SEL 把 line-height
          // 注到 div 自身、strut 跟著設定縮放。有 block 子元素仍判定為容器、不標記。
          directLen += node.textContent.trim().length;
        }
      }
      if (hasBlockChild || directLen < 4) continue;
      const cs = win.getComputedStyle(div);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const fs = Math.round(parseFloat(cs.fontSize) || 0);
      if (!fs) continue;
      candidates.push({ div, fs, len: (div.textContent || '').trim().length });
    }
    if (!candidates.length) return [];
    // 主流字級 = 文字量加權最重的字級；同重取較大者（傾向段落、排除 caption）
    const weightByFs = new Map();
    for (const c of candidates) {
      weightByFs.set(c.fs, (weightByFs.get(c.fs) || 0) + c.len);
    }
    let dominantFs = 0;
    let maxWeight = -1;
    for (const [fs, w] of weightByFs) {
      if (w > maxWeight || (w === maxWeight && fs > dominantFs)) {
        maxWeight = w;
        dominantFs = fs;
      }
    }
    const marked = [];
    for (const c of candidates) {
      if (c.fs < dominantFs) continue; // 比主流小 = caption 類，保留站點階層
      c.div.setAttribute(TEXT_DIV_ATTR, '1');
      marked.push(c.div);
    }
    return marked;
  }

  // ---- Pangu spacing（中英文間自動補空白）---------------------------------
  // 規則：
  //   CJK ↔ ASCII 英數字（LEAD）→ 補空白
  //   ASCII 英數字 + 常見後綴單位 % °（TRAIL）→ CJK 補空白
  // CJK 範圍取常用漢字 + 擴充 A，標點 / 全形字元不計入（不會在「中文，AI」這
  // 種已有全形逗號邊界的位置誤補空白）。
  //
  // 跳過 tag：CODE / PRE / KBD / SAMP / VAR（程式碼風格不可動）、A（連結文字
  // 動了會破壞引用語意，且很多 ASCII URL fragment 在 anchor text 內）、
  // SCRIPT / STYLE / NOSCRIPT（非可見內容）、TEXTAREA / INPUT（表單值）、
  // contenteditable 元素（使用者輸入區）。
  const PANGU_CJK = '[\\u3400-\\u4dbf\\u4e00-\\u9fff]';
  // LEAD（緊接 CJK 之後）：英數字 + 半形 `(` —— CJK後面接 `(` 補空白
  //   例：威騰電子(Western Digital) → 威騰電子 (Western Digital)
  //   `(` 後面（括號內側）不補空白（緊貼括號內容才是視覺常規）
  // TRAIL（緊接 CJK 之前）：英數字 + % + ° + 半形 `)` —— `)` 後面接 CJK 補空白
  //   例：(Western Digital)獨立 → (Western Digital) 獨立
  // 全形括號 （）/ 方括號 「」/ 書名號 《》 都不在 ASCII 範圍，不誤動
  const PANGU_LEAD = '[A-Za-z0-9(]';
  const PANGU_TRAIL = '[A-Za-z0-9%\\u00b0)]'; // ° = °
  const PANGU_RE_CJK_ALNUM = new RegExp('(' + PANGU_CJK + ')(' + PANGU_LEAD + ')', 'g');
  const PANGU_RE_ALNUM_CJK = new RegExp('(' + PANGU_TRAIL + ')(' + PANGU_CJK + ')', 'g');
  const PANGU_SKIP_TAGS = new Set(['CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'A', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);

  // 中文半形標點 → 全形標點對照（v0.7.158）。觸發條件：前或後緊鄰 CJK 邊界即
  // 轉，確保 example.com / Hello, world 這類純 ASCII 邊界不會被誤動。
  // 引號 ' " 不在此表（開/閉判斷複雜、誤殺風險高）。
  //
  // PUNCT_BOUNDARY_CJK 比 PANGU_CJK 寬：除漢字本範圍外另含 CJK 符號標點區段
  // U+3000-303F（、。「」『』《》〈〉【】〔〕 等）與全形 ASCII 區段
  // U+FF00-FFEF（，。：；？！（）［］ 與全形英數字 等）。理由：使用者反例
  // `「藍色連結」,Google` 中 `,` 前一字元是 `」`(U+300D)，原 PANGU_CJK 漢字
  // 範圍不含 CJK 標點，導致逗號不被視為「中文邊界」漏轉。pangu 補空白規則
  // 維持只看 PANGU_CJK（漢字本範圍），避免「全形標點 ↔ ASCII」之間誤補空白
  // ——全形標點自帶視覺分隔，補空白反而視覺破碎。
  const PUNCT_MAP = { ',': '，', '.': '。', ':': '：', ';': '；', '?': '？', '!': '！' };
  const PUNCT_BOUNDARY_CJK = '[\\u3400-\\u4dbf\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef]';
  const PUNCT_BOUNDARY_CJK_RE = new RegExp(PUNCT_BOUNDARY_CJK);
  // 命中順序：先「CJK 在前」（句尾 / 中文後接標點）、再「CJK 在後」（標點後
  // 接中文，如 Hello, 世界）。兩條獨立替換可同時覆蓋 `中文,Hello,中文` 內的
  // 兩個逗號（第一個前 CJK 觸發、第二個後 CJK 觸發）。
  const PUNCT_CHARS = '[,.:;?!]';
  const PUNCT_RE_CJK_BEFORE = new RegExp('(' + PUNCT_BOUNDARY_CJK + ')(' + PUNCT_CHARS + ')', 'g');
  const PUNCT_RE_CJK_AFTER = new RegExp('(' + PUNCT_CHARS + ')(?=' + PUNCT_BOUNDARY_CJK + ')', 'g');
  // 半形括號 ( ) 只在「兩側都緊鄰 CJK 邊界」時轉全形——避免 `中文 (English)`
  // 變成不對稱的 `中文（English)`；混合 ASCII 內容時保留半形交給 pangu 補空白。
  const PAREN_OPEN_RE = new RegExp('(' + PUNCT_BOUNDARY_CJK + ')\\((?=' + PUNCT_BOUNDARY_CJK + ')', 'g');
  const PAREN_CLOSE_RE = new RegExp('(' + PUNCT_BOUNDARY_CJK + ')\\)(?=' + PUNCT_BOUNDARY_CJK + ')', 'g');
  // 寬鬆規則：text node 整體含 CJK 邊界字元時，把剩餘 ASCII↔ASCII 邊界的半形
  // 逗號也轉全形。涵蓋 `叫 Google Alerts,2003 年就有了` 這類「英文片語接半形
  // 逗號接 ASCII 但整段為中文 prose」情境（Jimmy 2026-05-21 實機回報）。
  // 其他標點（. : ; ? !）不在寬鬆規則內：
  //   . 寬鬆轉會誤殺 example.com / 1.5 / Mr.Smith
  //   : 寬鬆轉會誤殺 http://  / 12:30 時間格式
  //   ; ? ! 寬鬆轉風險目前未實測，保留嚴格邊界 fallback 空間
  // tradeoff：中文 prose 內混 inline 英文 list（如「他列出 Apple, Banana, Cherry」）
  // 的逗號會被誤轉全形，但此情境在新聞 / 部落格 prose 內罕見，且 list 通常以
  // HTML 結構（<ul>/<ol>）或全形頓號 `、` 呈現，誤殺面小。

  function fullwidthPunct(s) {
    return s
      .replace(PUNCT_RE_CJK_BEFORE, (m, cjk, p) => cjk + PUNCT_MAP[p])
      .replace(PUNCT_RE_CJK_AFTER, (m, p) => PUNCT_MAP[p])
      .replace(PAREN_OPEN_RE, '$1（')
      .replace(PAREN_CLOSE_RE, '$1）');
  }

  function panguize(s) {
    // 階段一：strict CJK boundary 標點全形化。
    // 標點轉全形後不再進 PANGU_LEAD/TRAIL 字元類，避免重複觸發補空白
    // （例如 `他說(嘿嘿)` → `他說（嘿嘿）` 後 pangu 不動）。
    // 混合情境（中文後接 ASCII 括號）標點保半形，由 pangu 補空白。
    let out = fullwidthPunct(s);
    // 階段二：text node 整體含 CJK boundary → 寬鬆模式，剩餘 ASCII↔ASCII 邊界
    // 的半形逗號也轉全形。
    if (PUNCT_BOUNDARY_CJK_RE.test(s)) {
      // 千分位分隔逗號（兩側都是數字，如 3,610 / 3,610,000）保半形——這是數字
      // 格式不是中文標點，轉全形會變成 `3，610` 明顯錯誤（Jimmy 2026-06-03 回報）。
      // 只轉「非數字夾住」的逗號：`(?<!\d),`（前非數字）或 `,(?!\d)`（後非數字），
      // 兩條件都不成立（=前後皆數字）才視為千分位、保半形。
      out = out.replace(/(?<!\d),|,(?!\d)/g, '，');
    }
    return out
      .replace(PANGU_RE_CJK_ALNUM, '$1 $2')
      .replace(PANGU_RE_ALNUM_CJK, '$1 $2');
  }

  // 從 text node 沿 parent 鏈走到 articleEl，判斷是否落在跳過 tag / contenteditable 內
  function panguShouldSkipNode(textNode, articleEl) {
    let p = textNode.parentElement;
    while (p && p !== articleEl.parentElement) {
      if (PANGU_SKIP_TAGS.has(p.tagName)) return true;
      const ce = p.getAttribute && p.getAttribute('contenteditable');
      if (ce === 'true' || ce === '') return true;
      if (p === articleEl) break;
      p = p.parentElement;
    }
    return false;
  }

  // 走訪 articleEl 下所有可見 text node、套 pangu 規則。改動的 node 連同原值
  // 紀錄回傳 array，供 restore 還原。對 ROOT 為 element 或 text node 都接。
  function panguApplyToTree(root, articleEl, changes) {
    const doc = articleEl.ownerDocument;
    if (root.nodeType === 3) {
      if (!/\S/.test(root.nodeValue)) return;
      if (panguShouldSkipNode(root, articleEl)) return;
      const before = root.nodeValue;
      const after = panguize(before);
      if (after !== before) {
        changes.push({ node: root, original: before });
        root.nodeValue = after;
      }
      return;
    }
    if (root.nodeType !== 1) return;
    // root element 自己若是 skip tag → 整棵跳過
    if (PANGU_SKIP_TAGS.has(root.tagName)) return;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!/\S/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (panguShouldSkipNode(node, articleEl)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) {
      const before = n.nodeValue;
      const after = panguize(before);
      if (after !== before) {
        changes.push({ node: n, original: before });
        n.nodeValue = after;
      }
    }
  }

  // apply 入口：對 articleEl 一次性掃完 + 起 MutationObserver 接後續注入內容
  // （SPA / lazy-load 的留言、推薦、後到段落）。回傳 snapshot 供 restore。
  function panguInstall(articleEl) {
    const changes = [];
    panguApplyToTree(articleEl, articleEl, changes);

    // MutationObserver 只觀察 childList + subtree，避免 nodeValue 自寫又觸發
    // characterData 回環。原站若後續改既有 text node 的內容，本輪不重套——
    // 等下一次 reader mode 進入時會重新處理。
    const obs = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          panguApplyToTree(node, articleEl, changes);
        }
      }
    });
    obs.observe(articleEl, { childList: true, subtree: true });
    return { changes, observer: obs };
  }

  // restore：先停 observer、把 changes 內的 text node 還原為原值。已 detach
  // 的 node（site JS 移走的）跳過——還原也無意義。
  function panguRestore(snapshot) {
    if (!snapshot) return;
    if (snapshot.observer) {
      try { snapshot.observer.disconnect(); } catch {}
    }
    if (Array.isArray(snapshot.changes)) {
      for (const c of snapshot.changes) {
        if (!c || !c.node) continue;
        // 只有 nodeValue 仍為 panguize 過的字串才還原，避免覆蓋原站之後改動
        const after = panguize(c.original);
        if (c.node.nodeValue === after) {
          c.node.nodeValue = c.original;
        }
      }
    }
  }

  const styler = {
    /**
     * 套用閱讀模式排版。
     * @param {Element} articleEl 主文容器
     * @param {object} settings { theme, fontSize, contentWidth, fontFamily, lineHeight }
     * @returns {object|null} snapshot，restore 時必須原樣回傳
     */
    apply(articleEl, settings) {
      if (!articleEl || articleEl.nodeType !== 1) return null;

      const s = settings || {};
      // fontSize 特殊值 0 = "Auto / 原站字級"，代表使用者明確選擇不注入
      // 任何 font-size override（每站保留原字級）。Number(0) || DEFAULT 會把
      // 0 轉成 DEFAULT、sentinel 失效——需用 Number.isFinite + >= 0 判斷保留 0。
      //
      // v0.7.143：上限 clamp。popup UI 已 clamp [12, 32]、options 也有 HTML5
      // min/max，但儲存層完全沒驗——外部寫入或 storage 損壞時 `fontSize: 1e308`
      // / `0.001` 會被當合法值注入 CSS。clamp 是第二道防線。
      const rawFs = Number(s.fontSize);
      const rawCw = Number(s.contentWidth);
      const rawLh = Number(s.lineHeight);
      const rawPs = Number(s.paragraphSpacing);
      const opts = {
        // fontSize：保留 0 = Auto sentinel；其他 clamp [8, 200]px
        fontSize: Number.isFinite(rawFs) && rawFs >= 0
          ? (rawFs === 0 ? 0 : Math.min(200, Math.max(8, rawFs)))
          : DEFAULTS.fontSize,
        // contentWidth：clamp [300, 2000]px（300 是最窄可閱讀寬、2000 是大螢幕極限）
        contentWidth: Number.isFinite(rawCw) && rawCw > 0
          ? Math.min(2000, Math.max(300, rawCw))
          : DEFAULTS.contentWidth,
        fontFamily: s.fontFamily || DEFAULTS.fontFamily,
        // v0.7.254：字重三段 300（細）/ 400（中，預設）/ 600（粗 Semibold）。只接受
        // 這三個合法值，其餘（舊資料 / 損壞 / 外部寫入）一律回退 400。粗用 600 而非
        // 700：700 視覺太重（Jimmy 回報）；600 Semibold 比中明顯重、又不過粗，且
        // 跨平台不撞色（500 在 Windows 微軟正黑無 face 會退回 400 與中相同，故不用
        // 500）。舊 boldText 已退役、由 SW onInstalled 遷移到 fontWeight。
        fontWeight: (s.fontWeight === 300 || s.fontWeight === 600) ? s.fontWeight : 400,
        // lineHeight：v0.7.162 起新增 0 = Auto sentinel（保留原站行距、不注入
        // line-height）；非 0 clamp [1.0, 3.0]（unitless ratio；< 1 字會重疊、
        // > 3 段落破碎）。
        lineHeight: Number.isFinite(rawLh) && rawLh >= 0
          ? (rawLh === 0 ? 0 : Math.min(3.0, Math.max(1.0, rawLh)))
          : DEFAULTS.lineHeight,
        // paragraphSpacing：v0.7.162 新增；-1 = Auto sentinel（不注入 p/ul/ol/
        // blockquote margin-bottom），非 -1 clamp [0, 5]em（0 = 段落緊貼，是合
        // 法值；5 是極限上限避免外部 storage 損壞時注入 1e308em）。預設 1.0。
        paragraphSpacing: Number.isFinite(rawPs) && rawPs >= -1
          ? (rawPs === -1 ? -1 : Math.min(5, Math.max(0, rawPs)))
          : DEFAULTS.paragraphSpacing,
        titleFontSize: (() => {
          const raw = Number(s.titleFontSize);
          if (!Number.isFinite(raw) || raw < 0) return DEFAULTS.titleFontSize;
          return raw === 0 ? 0 : Math.min(200, Math.max(8, raw));
        })(),
        // v0.7.227：翻頁模式（電子書式水平翻頁）。boolean、預設 false——
        // 嚴格 === true 判定，storage 損壞 / 外部寫入非 boolean 值一律當關。
        pagedMode: s.pagedMode === true,
        // v1.5.3：本頁是否為 reader 文章頁（article feed 點進的單篇）——true 時
        // 卡片上緣用較緊縮的 READER_HOST_TOP_GUTTER（拿掉返回箭頭後文章往上長）。
        // 由 reader-article.js 在 enterFromContainer 前設 NS.state.readerHostPage。
        readerHostPage: !!(NS.state && NS.state.readerHostPage)
      };
      const theme = themeOf(s.theme);

      // 判斷哪些是「使用者改過」→ 需要 override；預設值 / Auto 不動原站
      //   fontSize = 0 (Auto) → 不注入（保留原站字級的明確 sentinel）
      //   fontSize > 0 → 一律注入（包括 == DEFAULT 18）。v0.7.140 修正：
      //     舊版「fontSize == DEFAULT → 不注入」造成 popup 顯示 18 但實際看
      //     到原站 20px / 22px 的 UX confusion——「未動設定 = 保留原站」這條
      //     隱含語義太隱晦使用者無感知。Auto = 0 sentinel 已涵蓋「我要保留
      //     原站」的明確意圖，DEFAULT skip 不再有獨立語義。Jimmy 2026-05-19
      //     substack reader hub 截圖回報「設定為 18 仍顯示 20」實機觸發。
      const overrides = {
        theme: (s.theme || DEFAULTS.theme) !== DEFAULTS.theme,
        fontSize: opts.fontSize > 0,
        fontFamily: opts.fontFamily !== DEFAULTS.fontFamily,
        // v0.7.162：lineHeight Auto (0) 不算「override」—— 它代表「不注入」而
        // 非「使用者自設值」。only 非預設且非 Auto 才算 override，避免 Auto 走
        // 進獨立 line-height rule 分支。
        lineHeight: opts.lineHeight !== DEFAULTS.lineHeight && opts.lineHeight !== 0,
        titleFontSize: opts.titleFontSize > 0
      };

      // v0.7.225 contrast guard phase 1：注入 CSS 前量「原始 effective bg」+
      // 文字載體色。必須在 styleEl.textContent 設定前跑——注入後 body / 祖先
      // bg 被 reader 樣式覆蓋，原始背景量不到。只在 light theme 跑（theme.text
      // 非 null 時 `* { color: theme.text }` 蓋掉 token 色 + v0.7.164 已清
      // pre/code bg transparent，結構上不存在此 bug）。
      const contrastProbe = [];
      if (!theme.text) {
        const _win = articleEl.ownerDocument?.defaultView;
        if (_win && _win.getComputedStyle) {
          for (const el of articleEl.querySelectorAll(CONTRAST_GUARD_SEL)) {
            if (contrastProbe.length >= CONTRAST_MAX_TARGETS) break;
            // 嵌套容器（table 內 pre 等）只處理最外層，避免疊兩層 inline bg
            if (el.parentElement && el.parentElement.closest && el.parentElement.closest(CONTRAST_GUARD_SEL)) continue;
            const carriers = collectTextCarriers(el, _win);
            const totalLen = carriers.reduce((s2, c) => s2 + c.len, 0);
            if (totalLen < 10) continue; // 太短不具統計意義
            const origBg = compositeBgOver(el, null, WHITE, _win);
            contrastProbe.push({ el, carriers, origBg });
          }
        }
      }

      // v0.8.130：改走 NS.injectCssText（CSP-safe）——嚴格 style-src nonce-only 站
      // （Miniflux 自架閱讀頁）在 WebKit 會擋掉注入 <style>，退回 adoptedStyleSheets。
      // 詳見 namespace.js injectCssText 註解。
      NS.injectCssText(STYLE_ID, buildCss(theme, opts, overrides));

      // inline emoji / icon 標記必須在 ARTICLE_ATTR 設定**前**跑——標記用 rect
      // fallback（viewBox-only SVG / 高解析 emoji PNG 的 naturalWidth 不可靠時
      // 量 rendered 尺寸）必須對「原站 CSS 下的渲染尺寸」量。ARTICLE_ATTR 一旦
      // 設定，buildCss 的 reader 規則（特別是翻頁模式 `img { width: auto !important;
      // max-width: 100% }`）立即生效，會把 viewBox-only SVG emoji 撐成滿欄（150
      // natural → 608px rect）→ rect > INLINE_IMG_MAX → 永遠標不到 inline →
      // emoji 滿版（v0.8.10 翻頁模式 X Twemoji 實機回報、probe 實證 chicken-egg）。
      // 在 ARTICLE_ATTR 前量 = reader 規則尚未 active = 量到原站 inline 尺寸，
      // 標記後再設 ARTICLE_ATTR、img:not([INLINE_IMG_ATTR]) 規則才正確排除 emoji。
      const inlineImgs = [];
      const inlineImgPins = [];
      const contentImgs = [];
      const iconImgs = [];
      const upscaleImgs = [];
      const contentImgLoadCleanup = [];
      // v0.8.98：viewBox-only SVG 的 inline emoji（WordPress wp-emoji 的國旗 SVG、
      // X Twemoji）naturalWidth 回報 Chrome 預設 150×150 不可靠——通用圖片規則的
      // width:auto 對「無 intrinsic size 的 SVG」解析成容器寬，把 emoji 撐成滿欄
      // （itsmicracing.xyz WordPress 站實測 17px → 603px）。inline-img CSS 規則只設
      // display:inline、未約束 width，救不了。修法：classifyImg 走 rect fallback
      // （natural 不可靠）標 inline 時，把量到的 rendered px 釘成 inline !important
      // width/height——分類在 ARTICLE_ATTR 設定前跑，rect 仍是原站 emoji 尺寸（1em ≈
      // 17px）。natural 可靠的 PNG emoji（natural ≈ rendered）走 width:auto 即正確、
      // 不需 pin。記 prev 供 restore 對稱還原（與 capIconImg 同款）。
      const pinInlineImg = (img, w, h) => {
        inlineImgPins.push({
          img,
          prevW: img.style.getPropertyValue('width'),
          prevWP: img.style.getPropertyPriority('width'),
          prevH: img.style.getPropertyValue('height'),
          prevHP: img.style.getPropertyPriority('height'),
        });
        img.style.setProperty('width', Math.round(w) + 'px', 'important');
        img.style.setProperty('height', Math.round(h) + 'px', 'important');
      };
      // v0.8.90：把作者刻意縮小的小圖釘回原始顯示寬。量到的 renderedW 以 inline
      // !important max-width 覆寫，杜絕 img:not(a>img) 的 width:auto 退回
      // naturalWidth 放大。記 prev 供 restore 對稱還原（與 titleFsSnap 同款）。
      const capIconImg = (img, renderedW) => {
        if (img.hasAttribute(ICON_IMG_ATTR)) return;
        iconImgs.push({
          img,
          prevMw: img.style.getPropertyValue('max-width'),
          prevMwP: img.style.getPropertyPriority('max-width'),
        });
        img.setAttribute(ICON_IMG_ATTR, '1');
        img.style.setProperty('max-width', Math.round(renderedW) + 'px', 'important');
      };
      // 量 img 尺寸（natural 優先、不可靠時 fallback rect），>= CONTENT_IMG_MIN 即標
      // content-img；回傳是否已標（含先前已標）。load listener 補標時重用。
      const tryMarkContentImg = (img) => {
        if (img.hasAttribute(CONTENT_IMG_ATTR)) return true;
        if (img.hasAttribute(INLINE_IMG_ATTR)) return false;
        let big = (img.naturalWidth || img.width) >= CONTENT_IMG_MIN ||
                  (img.naturalHeight || img.height) >= CONTENT_IMG_MIN;
        if (!big) {
          const r = img.getBoundingClientRect();
          big = r.width >= CONTENT_IMG_MIN || r.height >= CONTENT_IMG_MIN;
        }
        if (big) { img.setAttribute(CONTENT_IMG_ATTR, '1'); contentImgs.push(img); return true; }
        return false;
      };
      // v0.8.112：bare 內容圖（非 a 包）放大填滿欄寬。量 content-size（natural 優先、
      // 不可靠時 rect fallback）>= CONTENT_IMG_MIN 即標 upscale；回傳是否已標。lazy
      // bare 圖 load 後補標重用（與 tryMarkContentImg 同款）。
      const tryMarkUpscaleImg = (img) => {
        if (img.hasAttribute(UPSCALE_IMG_ATTR)) return true;
        if (img.hasAttribute(INLINE_IMG_ATTR) || img.hasAttribute(ICON_IMG_ATTR)) return false;
        let big = (img.naturalWidth || img.width) >= CONTENT_IMG_MIN ||
                  (img.naturalHeight || img.height) >= CONTENT_IMG_MIN;
        if (!big) {
          const r = img.getBoundingClientRect();
          big = r.width >= CONTENT_IMG_MIN || r.height >= CONTENT_IMG_MIN;
        }
        if (big) { img.setAttribute(UPSCALE_IMG_ATTR, '1'); upscaleImgs.push(img); return true; }
        return false;
      };
      // img 分類（inline emoji / content-img）。抽成 classifyImg 供「即時」與
      // 「lazy 圖 load 後補分類」共用。
      // v0.7.214：natural 尺寸對「無 intrinsic size 的 SVG」不可靠——Chrome 對
      // 只有 viewBox 的 SVG 回報 CSS replaced element 預設 150×150（X/Twitter
      // 的 Twemoji emoji SVG 實測命中），高解析 emoji PNG（Twemoji PNG 原檔
      // 72×72）也會超過上限。rendered 尺寸才是「這張圖在文中是 icon / emoji」的
      // 視覺事實：natural 判定 miss 時 fallback 量 rect，兩維皆 > 0 且 <=
      // INLINE_IMG_MAX 即標 inline。只在 miss 時量、避免對每張內容圖都 force layout。
      // v0.8.89：natural 兩維皆 <= 1 = lazy library 的 1×1 blank gif placeholder
      // 簽名（kknews.cc 實測），**不可**據此判 inline——否則整片未載入的內容照片
      // 被當 inline emoji 標記、載入後維持 inline 不被 media block 規則撐開（全圖
      // 1×1 視覺消失）。此時跳過 natural 判定、一律改用 rect（站點通常已用
      // padding-bottom sizer 預留 reserved 尺寸，rect 可信）。
      const classifyImg = (img) => {
        if (img.hasAttribute(INLINE_IMG_ATTR) || img.hasAttribute(CONTENT_IMG_ATTR) || img.hasAttribute(ICON_IMG_ATTR)) return;
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        // natPlaceholder 用 naturalX || X 為基準（與下方 w/h 同源）——img 有真實
        // width 屬性（如 lazy a>img width=608）時不可誤判成 1×1 placeholder。
        const natPlaceholder = w <= 1 && h <= 1;
        let isInline = !natPlaceholder && w > 0 && w <= INLINE_IMG_MAX && h > 0 && h <= INLINE_IMG_MAX;
        let r = null;
        let inlineViaRect = false;
        if (!isInline) {
          r = img.getBoundingClientRect();
          isInline = r.width > 0 && r.width <= INLINE_IMG_MAX &&
                     r.height > 0 && r.height <= INLINE_IMG_MAX;
          inlineViaRect = isInline;
        }
        if (isInline) {
          img.setAttribute(INLINE_IMG_ATTR, '1');
          inlineImgs.push(img);
          // natural 不可靠（viewBox-only SVG 等）時走 rect fallback 標到的 inline——
          // 釘原站 rendered 尺寸，杜絕 width:auto 把無 intrinsic size 的 SVG 撐成滿欄
          // （見 inlineImgPins 註解）。natural 可靠（natural <= INLINE_IMG_MAX）的小圖
          // 不需釘：width:auto 已正確退回 natural 尺寸。
          if (inlineViaRect && r) pinInlineImg(img, r.width, r.height);
          return;
        }
        // v0.8.90：「作者刻意縮小的大圖」防放大。INLINE_IMG_MAX (48px) 與
        // CONTENT_IMG_MIN (200px) 之間的小圖（48 < rect < 200）落在兩個門檻中間：
        // 不算 inline emoji、不算內容照片。裸 img 落入 img:not(a>img) 的 width:auto →
        // 退回 naturalWidth 撐成滿版（washingtonpost lightbulb badge 56→788px 實證）。
        // 結構訊號：已載入（complete + natural > 1）、pre-reader rendered rect 兩維皆
        // < CONTENT_IMG_MIN、且 natural 明顯大於 rendered（作者把大來源圖顯示縮小）→
        // reader 不該反向放大，釘回原始顯示寬。natural ≈ rendered 的真實小圖不命中
        // （width:auto 本來就給 natural≈rendered、無放大、不必釘）。lazy placeholder
        // （!complete / natural<=1）此刻量不準，交給上方 load listener 載入後重判。
        //
        // v1.0.7：移除原本的 `!img.closest('a')` 排除——a 包的縮小大圖同樣會破版，
        // 只是路徑不同：a-wrapped 不走 width:auto blowup（被 :not(a>img) 排除），而是
        // 落入下方 a-wrapped 分支被 tryMarkContentImg 標成 content-img → 強制 block +
        // 撐滿欄寬（autocar.co.uk 作者欄 <a><div.personality-image><img></div></a>
        // 頭像 natural 3309 / rect 142 被放大成 608、溢出固定高 142px 的裁切容器、疊到
        // bio 文字上＝圖疊文，cage probe 實證）。capIcon 幾何 gate（兩維皆 48~200 +
        // natural > rect×1.5）夠精確：lightbox 內容圖 render >= 200 不命中本支、照走下方
        // content-img 分支（styler-lightbox-content-image-margin.spec 不退步）。capIcon
        // 必須在 a-wrapped content-img 分支**之前**（縮小頭像優先當 icon 釘小，不當內容圖
        // 放大）——本判斷已在該分支上方，移除排除即生效。
        if (img.complete && img.naturalWidth > 1 &&
            img.getAttribute(PLAYER_ATTR) !== '1') {
          if (!r) r = img.getBoundingClientRect();
          if (r.width > INLINE_IMG_MAX && r.width < CONTENT_IMG_MIN &&
              r.height > INLINE_IMG_MAX && r.height < CONTENT_IMG_MIN &&
              img.naturalWidth > r.width * 1.5) {
            capIconImg(img, r.width);
            return;
          }
        }
        // 大內容圖被 `<a>`（lightbox / photoswipe）包住時，img:not(a > img) 的
        // block + margin 規則會漏掉它 → 維持原站 display:inline + 小 margin（巴哈
        // forum.gamer.com.tw a.photoswipe-image > img 實測 inline + 4px margin、
        // 圖文幾乎貼著）。量到 >= CONTENT_IMG_MIN 且祖先有 `<a>` 的 img 標記為
        // content-img，CSS 對它強制 block + 對稱 margin。inline emoji 已在上面
        // 排除、不會誤標。
        //
        // 自適應 lazy-load（v0.8.11 修正）：apply() 在 document_idle 跑，巴哈這類
        // 整篇 lazyload 圖在 toggle 當下多數還沒載入——naturalWidth=0、無 width 屬性、
        // rect 是 placeholder 小尺寸 → big 判定失敗、漏標 → 圖載入後 naturalWidth 變
        // 大但標記不會重跑，下方 32/34 張圖維持 inline + 4px margin 貼著文字（Jimmy
        // 2026-06-09 截圖實證）。修法：未即時標到的 a-wrapped img 掛 once load
        // listener，圖載入時 tryMarkContentImg 重量、夠大就補標（CSS 即時生效加
        // margin）。below-fold lazy 圖在使用者捲到時才 load → 屆時才標，自適應載入時序。
        if (img.closest('a')) {
          if (!tryMarkContentImg(img) && !img.complete) {
            const onLoad = () => tryMarkContentImg(img);
            img.addEventListener('load', onLoad);
            contentImgLoadCleanup.push({ img, onLoad });
          }
          return;
        }
        // v0.8.112：bare 內容圖（非 a 包、非 player）來源解析度小於版心時放大填滿
        // 欄寬。走到這裡的 bare img 已排除 inline emoji（上面 return）、capIcon（作者
        // 刻意縮小的大圖，上面 return）——剩下的就是「站點以原尺寸或小幅放大顯示的
        // 配圖」。content-size（>= CONTENT_IMG_MIN 一維）標 upscale、CSS width:100%
        // 撐滿欄寬；< CONTENT_IMG_MIN 的小圖（logo / 短橫幅）不標、維持 width:auto
        // 原尺寸（不反向放大成滿版）。lazy bare 圖同 a 包路徑掛 load listener 補標。
        if (img.getAttribute(PLAYER_ATTR) !== '1') {
          if (!tryMarkUpscaleImg(img) && !img.complete) {
            const onLoad = () => tryMarkUpscaleImg(img);
            img.addEventListener('load', onLoad);
            contentImgLoadCleanup.push({ img, onLoad });
          }
        }
      };
      for (const img of articleEl.querySelectorAll('img')) {
        // v0.8.89：natural 1×1 placeholder 且連 rect 都還沒 reliable（0×0 未渲染）
        // → 此刻完全無從分類，掛 once load listener 等圖真正載入後再 classifyImg
        // （hydrateLazyImages 換上真 src 後會觸發 load）。站點有預留 reserved 尺寸
        // 的 lazy 圖 rect 非 0、直接 classifyImg 走 rect fallback 即可。
        const natPlaceholder = (img.naturalWidth || img.width) <= 1 && (img.naturalHeight || img.height) <= 1;
        if (natPlaceholder) {
          const r = img.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) {
            const onLoad = () => classifyImg(img);
            img.addEventListener('load', onLoad, { once: true });
            contentImgLoadCleanup.push({ img, onLoad });
            continue;
          }
        }
        classifyImg(img);
      }

      // v0.8.49：「div 當段落」標記必須在 ARTICLE_ATTR 設定**前**跑——主流字級
      // 判定要量「原站 CSS 下的字級」；ARTICLE_ATTR 一旦設定，BODY_TEXT_SEL 的
      // font-size 規則對 article 根生效，繼承鏈被改、量到的是注入後的值。
      const textDivMarked = markTextDivs(articleEl);

      articleEl.setAttribute(ARTICLE_ATTR, '1');

      // v0.7.182：mark video player container descendants——背景/色彩
      // strip CSS 加 :not([data-jread-player]) 排除 player 子結構。
      // JW Player 的 poster（.jw-preview background-image: url(thumb)）、
      // 控制列（.jw-controls bg-color）、play 按鈕 overlay 等仰賴
      // background-image/color 呈現 UI。通則：<video> 的最近 N 層祖先
      // 及所有後代標記為 player 結構、不被 background strip 清除。
      // <iframe> 不標記：YouTube/Vimeo embed 的 poster 在 iframe 內部
      // document，reader card CSS 影響不到。
      // v0.7.183 修正：只標到 player root（position:relative + overflow:hidden
      // 的最近祖先），不標外層 layout wrapper。JW Player 結構：
      //   video → jw-media(abs) → jw-wrapper(abs) → jwplayer(rel+ovH) → layout wrappers
      // 外層 wrapper 必須被 card max-width/position 約束，否則 player 溢出遮字。
      // v0.7.182 走 4 層太高，把 wp-block-group layout wrapper 也排除了。
      const playerMarked = [];
      for (const vid of articleEl.querySelectorAll('video')) {
        let container = null;
        const _win = articleEl.ownerDocument?.defaultView;
        let cur = vid.parentElement;
        while (cur && cur !== articleEl && _win) {
          const cs = _win.getComputedStyle(cur);
          if (cs.position === 'relative' && cs.overflow === 'hidden') {
            container = cur;
            break;
          }
          cur = cur.parentElement;
        }
        // v0.8.105：是否找到「真 player root」（relative + overflow:hidden 的
        // 自包覆容器，JW Player 等成熟播放器的 chrome wrapper 結構）。沒找到時
        // 走下面 fallback；fallback 只標 <video> 本身、不標站點包裝容器（理由見下）。
        const foundGenuineRoot = !!container;
        if (!container) container = vid.parentElement || vid;
        // v0.7.225：container 含主文長段落（>= 100 chars 的 p / li）= 它不是
        // player 結構、是 layout wrapper——縮回 video 自身。tymscar 實測：
        // video 的 parentElement 是包大半主文的 anon div，fallback 直接標它
        // 導致 246/267 元素被 PLAYER_ATTR 豁免色彩保護（link 留站點 dark
        // scheme 綠色、白卡上 1.37:1）。「含主文長段落才保護」guard 與
        // cleaner 硬教訓四同款通則。對 relative+hidden 命中的 container 也
        // 套用——合法 player root（JW Player 等）內不會有長文字段落。
        if (container !== vid) {
          let hasLongText = false;
          for (const p of container.querySelectorAll('p, li')) {
            if ((p.textContent || '').trim().length >= 100) { hasLongText = true; break; }
          }
          if (hasLongText) container = vid;
        }
        // v0.8.105：沒有真 player root（relative+overflow:hidden）時，只標 <video>
        // 本身、不把站點的 fallback 包裝容器整支標 PLAYER_ATTR。
        // 根因：wikiHow Tie-a-Tie 步驟用「inline 自動播放示範影片」結構——
        // DIV.video-container.content-fill（position:absolute，內含 poster img +
        // video，無 relative+overflow:hidden 自包覆 root）。整支標 player 會把這個
        // absolute 容器凍結在所有 position/height reset 之外 → 容器不貢獻 flow 高度
        // → 祖先（.mwimg.whvid）塌成 16px → 309px 的 absolute 圖壓住後續 step 文字
        //（Jimmy 2026-06-18 寬版心截圖）。只標 video 後，container 與 poster img
        // 改走一般媒體正規化（:has(>media) height:auto + 含媒體容器 position:static）
        // 回到流內撐高、不再壓字；video 播放層自身仍受 player 保護不被 strip。
        // 真 player root（JW 等）找得到時不受影響——subtree chrome 保護照舊。
        if (!foundGenuineRoot) container = vid;
        container.setAttribute(PLAYER_ATTR, '1');
        playerMarked.push(container);
        for (const el of container.querySelectorAll('*')) {
          el.setAttribute(PLAYER_ATTR, '1');
          playerMarked.push(el);
        }
      }

      // v0.8.86：responsive embed 的 abs-pos iframe 標 [FILL_IFRAME_ATTR]，讓
      // CSS pin 回填滿 wrapper（見上方 FILL_IFRAME_ATTR rule 註解）。必須在
      // ARTICLE_ATTR 設定**後**量——reader CSS 對 [class*="placeholder"] 後代
      // 強制 position:static，那類 iframe 量到 static 不被標（已在 flow 內
      // 正常置中），只命中「reader CSS 未改其定位、仍 absolute」的真 embed。
      const fillIframes = [];
      {
        const _win = articleEl.ownerDocument?.defaultView;
        if (_win && _win.getComputedStyle) {
          for (const ifr of articleEl.querySelectorAll('iframe')) {
            if (ifr.hasAttribute(PLAYER_ATTR)) continue;
            if (_win.getComputedStyle(ifr).position === 'absolute') {
              ifr.setAttribute(FILL_IFRAME_ATTR, '1');
              fillIframes.push(ifr);
            }
          }
        }
      }

      const ancestors = markAncestors(articleEl);

      const htmlHadClass = document.documentElement.classList.contains(HTML_CLASS);
      document.documentElement.classList.add(HTML_CLASS);

      // v0.8.24：覆蓋 theme-color meta = reader card 色（狀態列 / 底部工具列染色）
      const themeColorSnap = applyThemeColor(theme.articleBg);

      // v0.8.139：正規化 viewport meta（行動裝置「縮小一半」修法，見函式註解）
      const viewportSnap = applyViewportFix();

      // v0.7.225 contrast guard phase 2：CSS 全生效後（ARTICLE_ATTR + HTML_CLASS
      // 都已就位）以 card bg 為基底重算每個容器的新 effective bg。半透明 pre bg
      // 疊白卡 = 近白；wrapper 載 bg 的站則已被 background strip 清掉——兩種
      // 機制都會讓 newBg 落到 card bg。判定「大部分文字對新 bg 不可讀、但對
      // 原始 bg 可讀」才動手：把原始 bg inline !important 還給容器（原站
      // syntax 色是配這個 bg 設計的，還原 bg = 還原設計時的對比）。
      // snapshot entry 通用化：{ el, prop, prev, prevP }——bg 還原與
      // per-carrier 色覆寫共用一個還原清單。
      const contrastBgSnap = [];
      if (contrastProbe.length) {
        const _win = articleEl.ownerDocument?.defaultView;
        const cardBg = parseCssColor(theme.articleBg) || WHITE;
        for (const probe of contrastProbe) {
          const newBg = compositeBgOver(probe.el, articleEl, cardBg, _win);
          // 重量注入後的實際文字色（繼承類元素已走新 cascade，見
          // collectTextCarriers 註解——用 phase 1 舊色會誤觸發）
          for (const c of probe.carriers) {
            c.newColor = parseCssColor(_win.getComputedStyle(c.el).color);
          }
          // --- 修法一：整容器 bg 還原（大部分文字不可讀時）---
          // 修復後的最終狀態 = 注入後文字色 + 還原的原始 bg。這個組合必須
          // 真的可讀才動手——同時涵蓋「原站本來就低對比（不是 jread 造成、
          // 還原 bg 也救不回）」的保守分支：那種 case 此檢查必 fail。
          let finalBg = newBg;
          if (lowContrastFraction(probe.carriers, newBg, 'newColor') >= CONTRAST_LOW_FRACTION &&
              lowContrastFraction(probe.carriers, probe.origBg, 'newColor') < CONTRAST_LOW_FRACTION) {
            contrastBgSnap.push({
              el: probe.el,
              prop: 'background-color',
              prev: probe.el.style.getPropertyValue('background-color'),
              prevP: probe.el.style.getPropertyPriority('background-color')
            });
            const o = probe.origBg;
            probe.el.style.setProperty(
              'background-color',
              `rgb(${Math.round(o.r)}, ${Math.round(o.g)}, ${Math.round(o.b)})`,
              'important'
            );
            finalBg = probe.origBg;
          }
          // --- 修法二：per-carrier 色覆寫（少數載體仍不可讀時）---
          // tymscar table 實測：th 有自己的 color（淺色、為深底設計）被
          // :not(th) 排除保留，td 無 color 繼承 card 深字——混色容器 bg 還原
          // 會弄壞多數 td、只能對 th 這類少數載體個別覆寫文字色。覆寫值不
          // 猜原設計、直接依最終 bg 亮度選高對比色（淺底深字 / 深底淺字）。
          // 「原設計可讀」前提仍要守：原本就低對比的載體不是 jread 造成，
          // 不動（同修法一的保守邊界）。
          for (const c of probe.carriers) {
            if (!c.newColor) continue;
            if (contrastRatio(c.newColor, finalBg) >= CONTRAST_MIN_RATIO) continue;
            if (contrastRatio(c.origColor, probe.origBg) < CONTRAST_MIN_RATIO) continue;
            contrastBgSnap.push({
              el: c.el,
              prop: 'color',
              prev: c.el.style.getPropertyValue('color'),
              prevP: c.el.style.getPropertyPriority('color')
            });
            c.el.style.setProperty(
              'color',
              relLuminance(finalBg) > 0.5 ? '#1a1a1a' : '#f0f0f0',
              'important'
            );
          }
        }
      }

      // v1.0.6 light theme：bg 保留但文字色被強制的語意元素（blockquote /
      // summary）深底深字守門。
      // Root cause（通則，非站點特例）：BG_PRESERVE_NOT 保留 figure/figcaption/
      // summary/blockquote 的原站背景，但 COLOR_PRESERVE_NOT 只排除 figcaption——
      // blockquote / summary 的文字在 light theme 被 color: inherit 強制成 reader
      // 卡片深色。站點若把這類元素配深色不透明背景（autocar.co.uk 把圖說做成
      // <blockquote class="image-field-caption"> bg rgb(48,48,48)），深字落深底＝
      // 整條黑條不可讀（cage 量 1.59:1）。與 figcaption v0.8.169「文字已決定走
      // 卡片色 → 背景跟著透明」同款修法形狀。
      //
      // 為什麼用 contrast gate 而非比照 figcaption 無條件清背景：blockquote 引言框
      // 可能有「淺底 + 深字」的合理設計（行 1917 註解：引言框靠 padding + 背景
      // 撐視覺）——無條件清會弄丟正常引言框的底色。以實際對比 gate：只有「強制
      // 文字色對保留 effective bg < 3:1（占比 >= 40%）」才把背景正規化為透明
      // （讓白卡透出、深字變可讀），高對比的淺底引言框一律不動（保守邊界，同
      // pre/table contrast guard 與 v0.7.225 light guard）。figure 直接文字罕見、
      // figcaption 已另條 light 規則處理，故只掃 blockquote / summary。
      //
      // 訊號層次：本層驗「blockquote/summary 直接文字載體 vs 保留 bg 的 WCAG
      // 對比」一層；dark / sepia 不走（theme.text 非 null → 由下方 phase 3 兜底
      // 接管全 card 文字色）。restore 走 contrastBgSnap 既有通道。
      if (!theme.text) {
        const _win = articleEl.ownerDocument?.defaultView;
        if (_win && _win.getComputedStyle) {
          const cardBg = parseCssColor(theme.articleBg) || WHITE;
          let bqScanned = 0;
          for (const el of articleEl.querySelectorAll('blockquote, summary')) {
            if (bqScanned >= CONTRAST_MAX_TARGETS) break;
            if (el.closest && el.closest('[data-jread-hidden="1"]')) continue;
            const cs = _win.getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            // 無自身背景（透明）→ effective bg 由白卡決定、不可能深底深字，跳過
            const ownBg = parseCssColor(cs.backgroundColor);
            if (!ownBg || ownBg.a < 0.05) continue;
            bqScanned++;
            // 注入後實際文字色（color: inherit 已走新 cascade，見
            // collectTextCarriers 註解——用注入前舊色會誤判）
            const carriers = collectTextCarriers(el, _win);
            if (!carriers.length) continue;
            for (const c of carriers) c.newColor = parseCssColor(_win.getComputedStyle(c.el).color);
            const effBg = compositeBgOver(el, articleEl, cardBg, _win);
            if (lowContrastFraction(carriers, effBg, 'newColor') >= CONTRAST_LOW_FRACTION) {
              contrastBgSnap.push({
                el,
                prop: 'background-color',
                prev: el.style.getPropertyValue('background-color'),
                prevP: el.style.getPropertyPriority('background-color')
              });
              el.style.setProperty('background-color', 'transparent', 'important');
            }
          }
        }
      }

      // v0.8.45 dark / sepia contrast 兜底層（phase 3）：CSS 通則層管不到的
      // 低對比文字逐元素修色。CSS cascade 有結構性輸局——站點高 specificity
      // !important rule（twz `.recurrent-author-widgets .recurrent-author-widget
      // .author-bio` = (0,3,0) !important，贏 jread color-inherit 的 (0,2,12)，
      // probe 實證）、@layer important 反轉、CSS-in-JS 動態注入——stylesheet
      // 軍備競賽永遠有更高的站點。inline style + !important 是 author origin
      // 最高優先級，cascade 戰爭一律終結。
      // 保守邊界：只修「對 effective bg 對比 < 3:1」的元素——本來就不可讀，
      // 改色是淨改善；可讀的原站色（表格漲跌紅綠、syntax token、mark 高亮上
      // 的深字）一律不動。候選色挑對比較高者（亮底深字 / 暗底用 theme 淺字），
      // 連結用 link 色變體維持與正文的雙通道辨識。修後仍 < 3:1 則不動（與
      // v0.7.225 light guard 同款保守分支——不是 jread 能救的不亂動）。
      // restore 走 contrastBgSnap 既有通道；theme 切換走 main.js restore→apply
      // 重跑，inline 不殘留、不污染重算。
      // 訊號層次：本層驗「直接文字載體 vs effective bg 的 WCAG 對比」；不驗
      // 圖片 / iframe 內部（jread 摸不到）、不驗 lazy-load 晚到的內容（apply
      // 當下不存在的元素掃不到——對 theme 切換場景夠用，極端 lazy 站漏網）。
      //
      // SPA cascade 時序坑（sspai instrument 實證）：apply() 同步流程內
      // getComputedStyle 量到的 bg 可能還是站點值——SPA hydration 期站點動態
      // <style> 與 jread styleEl 的 cascade 勝負會在 apply 之後翻轉（sspai TH
      // 在 phase 3 當下 bg=#f7f7f9、1.5s 後才變 transparent），照當下值修色
      // 會做出「亮底深字」之後變「暗底深字」ratio 1。所以 effective bg 不照
      // 當下 computed 算，而是按「jread 規則的目標狀態」算：會被上方背景中和
      // 規則打 transparent 的層（tag 清單同款生成）一律跳過其 bg。代價：站點
      // rule 永久賽贏中和規則的極端站會被當成已中和而漏修（保守邊界——漏修
      // 不誤傷）。
      if (theme.text) {
        const _win = articleEl.ownerDocument?.defaultView;
        if (_win && _win.getComputedStyle) {
          const cardBg = parseCssColor(theme.articleBg) || WHITE;
          const neutralizedSel = [...MEDIA_SEMANTIC_TAGS, ...CODE_TAGS, ...TABLE_TAGS].join(',');
          const skipNeutralized = (cur) => !!(cur.matches && cur.matches(neutralizedSel));
          let scanned = 0;
          let fixed = 0;
          for (const el of articleEl.querySelectorAll('*')) {
            if (scanned >= 3000 || fixed >= 300) break;
            const tag = el.tagName.toUpperCase();
            if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'NOSCRIPT' || tag === 'TITLE' || tag === 'DESC') continue;
            let len = 0;
            for (const n of el.childNodes) {
              if (n.nodeType === 3) len += n.textContent.trim().length;
            }
            if (len < 4) continue;
            scanned++;
            if (el.closest && el.closest('[data-jread-hidden="1"]')) continue;
            const cs = _win.getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const fg = parseCssColor(cs.color);
            if (!fg || fg.a < 0.5) continue;
            const bg = compositeBgOver(el, null, cardBg, _win, skipNeutralized);
            if (contrastRatio(fg, bg) >= CONTRAST_MIN_RATIO) continue;
            const isLink = !!(el.closest && el.closest('a'));
            // 深色候選：#1a1a1a（深字）/ #1a73e8（light theme link 色，亮底上 5.2:1）
            const candidates = isLink ? [theme.link, '#1a73e8'] : [theme.text, '#1a1a1a'];
            let best = null;
            let bestRatio = -1;
            for (const cstr of candidates) {
              const c = parseCssColor(cstr);
              const r = c ? contrastRatio(c, bg) : 0;
              if (r > bestRatio) { bestRatio = r; best = cstr; }
            }
            if (!best || bestRatio < CONTRAST_MIN_RATIO) continue;
            contrastBgSnap.push({
              el,
              prop: 'color',
              prev: el.style.getPropertyValue('color'),
              prevP: el.style.getPropertyPriority('color')
            });
            el.style.setProperty('color', best, 'important');
            fixed++;
          }
        }
      }

      // v1.5.17 code block 背景辨識度（phase 4，所有主題）：原站常把 `<pre>`
      // 程式碼框做成「透明底 + 細淺色邊框」（Medium 實測 bg rgba(0,0,0,0)、
      // border 1px #e5e5e5）。reader card 在 sepia(#eee2cb) / gray(#ededed) 主題
      // 下，淺邊框 ≈ 卡片色幾乎不可見、透明底又透出卡片色 → code block 與主文
      // 完全融在一起、看不出邊界（Jimmy 2026-06-29 medium 截圖回報）。
      //
      // Root cause（通則）：BG_PRESERVE_NOT 保留 pre 背景（語法高亮塊的實心底 +
      // token 色是配套設計、不能清）。但「自身背景透明」的純文字 code 塊沒有任何
      // 區隔載體，靠原站淺邊框在深/暖卡上失效。
      //
      // 修法：只對「自身 background-color alpha < 0.1（透明 / 近透明）」的 pre
      // 補主題協調底色 theme.codeBlockBg（半透明、疊在卡片上產生 recessed panel）。
      // gate 在 alpha：語法高亮塊（實心 #282c34 之類，alpha=1）一律跳過、原樣保留，
      // 零誤傷其 token 對比。所有主題都跑（sepia/gray 是回報情境、light/dark 同樣
      // 受益）。snapshot 走 contrastBgSnap 既有還原通道（theme 切換 restore→apply
      // 重算，inline 不殘留）。
      if (theme.codeBlockBg) {
        const _win = articleEl.ownerDocument?.defaultView;
        if (_win && _win.getComputedStyle) {
          let preScanned = 0;
          for (const pre of articleEl.querySelectorAll('pre')) {
            if (preScanned >= CONTRAST_MAX_TARGETS) break;
            if (pre.closest && pre.closest('[data-jread-hidden="1"]')) continue;
            // 嵌套（pre 內 pre，罕見）只處理最外層，避免疊兩層底色
            if (pre.parentElement && pre.parentElement.closest &&
                pre.parentElement.closest('pre')) continue;
            preScanned++;
            const ownBg = parseCssColor(_win.getComputedStyle(pre).backgroundColor);
            // 自身有實心 / 明顯底色（語法高亮塊）→ 保留原設計，不補
            if (ownBg && ownBg.a >= 0.1) continue;
            contrastBgSnap.push({
              el: pre,
              prop: 'background-color',
              prev: pre.style.getPropertyValue('background-color'),
              prevP: pre.style.getPropertyPriority('background-color')
            });
            pre.style.setProperty('background-color', theme.codeBlockBg, 'important');
          }
        }
      }

      // v0.7.90：install scroll listener（auto-hide scrollbar）。passive 確保
      // 不卡 scroll 效能；window 層級捕捉文件捲動事件。重複 apply 時 remove
      // 後 add 防止 listener 累積（瀏覽器 dedupe 但保險，restore 也對稱乾淨）。
      window.removeEventListener('scroll', onScrollFlash, { passive: true });
      window.addEventListener('scroll', onScrollFlash, { passive: true });

      // 閱讀進度條——v1.5.2：分頁模式不注入（底部頁碼指示器已表閱讀進度，頂端進度條
      // 為重複功能；Jimmy 2026-06-27）。styler 是進度條生命週期的單一資料源：依
      // opts.pagedMode 決定注入與否，paged-mode.js 不再碰它。切到分頁模式（scroll→
      // paged reapply）時把既有的移除，騰出頂端區域給文章排版（paged 卡片上緣 gutter
      // 同步收斂，見上方 PAGED_TOP_GUTTER）。
      window.removeEventListener('scroll', onScrollProgress, { passive: true });
      if (opts.pagedMode) {
        const existing = document.getElementById(PROGRESS_ID);
        if (existing) existing.remove();
        progressEl = null;
      } else {
        progressEl = document.getElementById(PROGRESS_ID);
        if (!progressEl) {
          progressEl = document.createElement('div');
          progressEl.id = PROGRESS_ID;
          (document.head?.parentElement || document.documentElement).appendChild(progressEl);
        }
        window.addEventListener('scroll', onScrollProgress, { passive: true });
        onScrollProgress();
      }

      // v0.7.91：install SPACE keydown listener（capture phase 比原站 bubble
      // listener 早攔，比原站 keydown 攔截先收到 SPACE）。重複 apply 時保險先 remove。
      window.removeEventListener('keydown', onSpaceScroll, true);
      window.addEventListener('keydown', onSpaceScroll, true);

      // 消除頂端留白：第一個**可見** h1-h4/p（深層後代也算）margin-top: 0
      // inline。必須用 JS：站點 CSS 常給深層 heading 寫死 margin-top，純 CSS
      // 的 `:first-child` 只能摸到 article 的 direct child，摸不到「包在
      // wrapper 裡的 H1」。
      // v0.7.180：跳過 display:none / data-jread-hidden 內的隱藏元素。
      // MSNBC/ms.now opinion-header 內 .opinion-column(display:none) 包
      // P "Opinion" 類別標籤——querySelector DOM order 比 H1 早命中，導致
      // firstInk 指向隱藏 P、後續 ancestor padding strip 和 titleFontSize
      // inline override 都因此 miss。
      let firstInk = null;
      {
        const _win = articleEl.ownerDocument?.defaultView;
        for (const el of articleEl.querySelectorAll('h1, h2, h3, h4, p')) {
          if (el.closest && el.closest('[data-jread-hidden="1"]')) continue;
          if (_win) {
            let hidden = false;
            for (let a = el; a && a !== articleEl; a = a.parentElement) {
              const d = _win.getComputedStyle(a).display;
              if (d === 'none') { hidden = true; break; }
            }
            if (hidden) continue;
          }
          firstInk = el;
          break;
        }
      }
      let firstInkPriorMt = '';
      let firstInkPriorMtPriority = '';
      if (firstInk) {
        firstInkPriorMt = firstInk.style.getPropertyValue('margin-top');
        firstInkPriorMtPriority = firstInk.style.getPropertyPriority('margin-top');
        firstInk.style.setProperty('margin-top', '0', 'important');
      }

      // v1.0.8：byline meta 區一行正規化（見頂部 BYLINE_ATTR 常數註解）。
      // 偵測（結構訊號、非站點 class 特判）：date 訊號（<time> 或 date-regex 短文）
      // 與 author 訊號（行首 by / rel=author）的共同祖先，往上爬到「不含第一段內文
      // （>= 120 chars 的 p）、且 visible 文字 <= 200」的最高祖先 = byline root。
      // 只標 visible 元素（避免把站點隱藏的作者 hover card / 分享列重新顯示）。
      // 多站驗證（autocar / npr / techcrunch / bbc / theverge）選到乾淨 byline 區。
      const bylineMarks = [];
      const bylineDispSnap = [];
      {
        const win = articleEl.ownerDocument?.defaultView;
        if (win && win.getComputedStyle && !articleEl.querySelector(`[${BYLINE_ATTR}]`)) {
          const bnorm = (s) => (s || '').replace(/\s+/g, ' ').trim();
          const bvisible = (el) => {
            if (el.closest && el.closest('[data-jread-hidden="1"]')) return false;
            const cs = win.getComputedStyle(el);
            return cs.display !== 'none' && cs.visibility !== 'hidden';
          };
          const bdirect = (el) => bnorm(Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(''));
          let firstBodyP = null;
          for (const p of articleEl.querySelectorAll('p')) {
            if (bnorm(p.textContent).length >= 120) { firstBodyP = p; break; }
          }
          const beforeBody = (el) => !firstBodyP ||
            !!(el.compareDocumentPosition(firstBodyP) & Node.DOCUMENT_POSITION_FOLLOWING);
          // date 訊號：<time> 優先、否則 date-regex 短文
          let dateEl = null;
          for (const t of articleEl.querySelectorAll('time')) {
            if (bvisible(t) && beforeBody(t) && bnorm(t.textContent)) { dateEl = t; break; }
          }
          if (!dateEl) {
            for (const el of articleEl.querySelectorAll('span, div, p, li, a')) {
              if (!beforeBody(el) || !bvisible(el)) continue;
              const dt = bdirect(el);
              if (dt && dt.length < 40 && BYLINE_DATE_RE.test(dt)) { dateEl = el; break; }
            }
          }
          if (dateEl) {
            // author 訊號（選填、用於擴大 root 的 LCA）
            let authorEl = null;
            for (const el of articleEl.querySelectorAll('a[rel~="author"], span, div, p, a')) {
              if (!beforeBody(el) || !bvisible(el)) continue;
              const t = bnorm(el.textContent);
              if (/^(by|words by|written by)\b/i.test(t) && t.length < 60) { authorEl = el; break; }
            }
            let seed = dateEl;
            if (authorEl && authorEl !== dateEl) {
              const anc = new Set();
              for (let x = dateEl; x && x !== articleEl.parentElement; x = x.parentElement) anc.add(x);
              for (let y = authorEl; y && y !== articleEl.parentElement; y = y.parentElement) {
                if (anc.has(y)) { seed = y; break; }
              }
            }
            // 爬到「不含 body、不含標題/副標 heading、visible 文字 <= 200」的最高祖先。
            // v1.0.12：heading guard——byline（作者/日期 meta）結構上絕不會包住文章
            // 標題或副標（h1/h2/h3）。原本只用「文字 <= 200」當天花板，但翻譯後中文
            // 比英文緊湊（chinatalk Substack post-header 英文 113 字 → 中文 59 字），
            // 整個 post-header（含 h1 標題 + h3 副標 + byline）落在 200 內 → climb 把
            // post-header 當 byline root，h1/h3 被打平成 flex-wrap item，窄的中文副標
            // 與作者名同列（英文因 heading 夠寬各佔一列而僥倖沒露餡）。加 heading guard
            // 後 climb 在 heading 邊界前停住，root 落在真正的 author+date wrapper。
            let root = seed;
            while (root.parentElement && root.parentElement !== articleEl &&
                   beforeBody(root.parentElement) &&
                   (!firstBodyP || !root.parentElement.contains(firstBodyP)) &&
                   !root.parentElement.querySelector('h1, h2, h3') &&
                   bnorm(root.parentElement.textContent).length <= 200) {
              root = root.parentElement;
            }
            const setMark = (el, attr) => { el.setAttribute(attr, '1'); bylineMarks.push({ el, attr }); };
            // 設 inline display（覆蓋 cleaner collapseGridWithHiddenCell 的 inline
            // display:block !important——byline 容器常是 flex/grid + hidden 社群分享
            // child 被 collapse；stylesheet 的 byline flex 贏不過 inline !important）。
            // snapshot prev 供 styler.restore 還原；styler.restore 在 cleaner.restore
            // 之前（main.js 458→459），collapsed 元素還原成 cleaner 值、cleaner 再
            // 還原成原始。
            const setStyleImp = (el, prop, val) => {
              bylineDispSnap.push({ el, prop, prev: el.style.getPropertyValue(prop), prevP: el.style.getPropertyPriority(prop) });
              el.style.setProperty(prop, val, 'important');
            };
            setMark(root, BYLINE_ATTR);
            setStyleImp(root, 'display', 'flex');
            // cleaner collapseGridWithHiddenCell 攤平 flex-row 時設了 inline
            // flex-direction:column（display:block 下無作用、但 byline 翻回 flex 後
            // 會生效成直排）——一併用 inline row 覆蓋
            setStyleImp(root, 'flex-direction', 'row');
            // 遞迴標 item（可見 leaf / 有直接文字 / 媒體）與 wrap（純 wrapper）
            const walk = (el) => {
              for (const child of el.children) {
                if (!bvisible(child)) continue;
                const tag = child.tagName.toUpperCase();
                const isMedia = tag === 'IMG' || tag === 'PICTURE' || tag === 'TIME' || tag === 'SVG';
                const hasText = bdirect(child).length > 0;
                if (hasText || isMedia || child.children.length === 0) {
                  setMark(child, BYLINE_ITEM_ATTR);
                  if (BYLINE_RT_RE.test(bnorm(child.textContent))) setMark(child, BYLINE_RT_ATTR);
                } else {
                  setMark(child, BYLINE_WRAP_ATTR);
                  setStyleImp(child, 'display', 'contents');
                  walk(child);
                }
              }
            };
            walk(root);
            // v1.5.28：日期 item = 含 dateEl 的最近 byline item（NPR 即 <time> 自身）。
            // 下面時刻隱藏（結構訊號）與作者排序（order）都以它為錨。
            let dateItem = dateEl;
            while (dateItem && dateItem !== root && !dateItem.hasAttribute(BYLINE_ITEM_ATTR)) {
              dateItem = dateItem.parentElement;
            }
            const dateItemValid = dateItem && dateItem !== root && dateItem.hasAttribute(BYLINE_ITEM_ATTR);

            // v1.5.28：隱藏 byline 內的發稿時刻（"1:59 PM ET"），只留日期。
            // 結構訊號（翻譯無關，Jimmy 2026-07-02 Shinkansen 譯後「東岸時間下午
            // 1:59」殘留實測）：日期 item（<time>）內若有子元素文字符合 BYLINE_DATE_RE
            //（此 regex 含中文「2026 年 6 月 1 日」），把**不符日期**的兄弟子元素
            //（時刻/時區）隱藏。BYLINE_DATE_RE 判別日期 vs 時刻、不靠英文時刻字面，
            // 故 Shinkansen 就地譯文（結構不變、僅換文字）照樣命中。
            if (dateItemValid) {
              const kids = Array.from(dateItem.querySelectorAll('*')).filter(bvisible);
              const hasDateKid = kids.some((c) => BYLINE_DATE_RE.test(bnorm(bdirect(c))));
              if (hasDateKid) {
                for (const c of kids) {
                  const dt = bnorm(bdirect(c));
                  if (dt && !BYLINE_DATE_RE.test(dt)) setMark(c, BYLINE_TIME_ATTR);
                }
              }
            }
            // 補充（英文、時刻為獨立 byline item 而非日期 item 子元素的情況）：整段
            // 直接文字＝純時刻（HH:MM AM/PM TZ）的葉元素也隱藏。譯後 DOM 不命中此
            // regex，靠上面結構訊號接住。安全閘：隱藏後 root 仍須有日期訊號才動手。
            const rootHasDateWithout = (el) =>
              BYLINE_DATE_RE.test(bnorm(root.textContent).replace(bnorm(el.textContent), ''));
            for (const el of root.querySelectorAll('*')) {
              if (!bvisible(el)) continue;
              const dt = bdirect(el);
              if (dt && BYLINE_TIME_RE.test(dt) && rootHasDateWithout(el)) {
                setMark(el, BYLINE_TIME_ATTR);
              }
            }
            // v1.5.28：清掉「Heard on <節目>」廣播節目出處 chip（閱讀模式非必要
            // metadata）。兩訊號並用：① 英文句式開頭（Heard/Aired/Broadcast on）；
            // ② item 內連結 href 命中 /programs|shows|podcasts|episodes/（翻譯無關
            // ——href 不被 Shinkansen 翻譯，譯後 DOM 靠這條接住「聽過《早晨版》」）。
            for (const el of root.querySelectorAll(`[${BYLINE_ITEM_ATTR}]`)) {
              const hitText = BYLINE_PROGRAM_RE.test(bnorm(el.textContent));
              // 連結含自身（item 本身即 <a> 時 querySelectorAll('a') 不含它）
              const links = [el, ...el.querySelectorAll('a[href]')]
                .filter((a) => a.tagName === 'A' && a.getAttribute('href'));
              const hitUrl = !hitText && links.some((a) => BYLINE_PROGRAM_URL_RE.test(a.getAttribute('href')));
              if (hitText || hitUrl) setMark(el, BYLINE_PROGRAM_ATTR);
            }
            // v1.5.28：作者排在日期前——把日期 item order:1 推到最後，其餘 item 維持
            // 預設 order:0 排前。不必逐站辨識作者（NPR 作者無 rel=author / By 前綴，
            // 辨識 fragile），只認可靠的日期錨（<time>，翻譯無關）。
            if (dateItemValid) setMark(dateItem, BYLINE_DATE_ITEM_ATTR);
          }
          // v1.5.28：移除標題前的分類 kicker / eyebrow（NPR「BUSINESS」連到
          // /sections/business/）。結構訊號（非站點特判）：標題 H1「之前」、連到
          // 分類頁（SECTION_URL_RE）的短連結。往上爬到「文字仍等於 kicker 文字」的
          // 最高 wrapper 一併隱藏（避免只藏連結、留空的 slug 容器殘留高度），比照
          // byline root 的 climb。href 不被翻譯 → 譯後 DOM 照樣命中（Shinkansen
          // 把「Business」譯成「商業」，wrapper 文字同步變、climb 仍成立）。獨立於
          // byline 偵測（無日期的頁面也要清 kicker）。restore 走 bylineMarks 移除標記。
          const titleH1 = articleEl.querySelector('h1');
          if (titleH1) {
            const beforeTitle = (el) =>
              !!(el.compareDocumentPosition(titleH1) & Node.DOCUMENT_POSITION_FOLLOWING);
            for (const a of articleEl.querySelectorAll('a[href]')) {
              if (!bvisible(a) || !beforeTitle(a)) continue;
              if (!SECTION_URL_RE.test(a.getAttribute('href') || '')) continue;
              const t = bnorm(a.textContent);
              if (!t || t.length > 30) continue;
              let k = a;
              while (k.parentElement && k.parentElement !== articleEl &&
                     beforeTitle(k.parentElement) &&
                     bnorm(k.parentElement.textContent) === t) {
                k = k.parentElement;
              }
              if (!k.hasAttribute(KICKER_ATTR)) {
                k.setAttribute(KICKER_ATTR, '1');
                bylineMarks.push({ el: k, attr: KICKER_ATTR });
              }
            }
          }
        }
      }

      // v0.7.179：strip excessive padding on ancestors between firstInk and
      // articleEl。CMS hero banner（CNN opinion-header 等）常用 padding:
      // 100px 配合彩色背景做全寬視覺。reader mode strip 背景後 padding 變成
      // 純空白。沿 firstInk 往上走到 articleEl，每層 paddingTop > 48px
      // （reader card 自身 padding 大小）的元素清掉 padding。
      const ancestorPaddingSnap = [];
      if (firstInk) {
        let cur = firstInk.parentElement;
        const win = articleEl.ownerDocument?.defaultView;
        while (cur && cur !== articleEl && win) {
          const cs = win.getComputedStyle(cur);
          const pt = parseFloat(cs.paddingTop) || 0;
          const pb = parseFloat(cs.paddingBottom) || 0;
          if (pt > 48 || pb > 48) {
            ancestorPaddingSnap.push({
              el: cur,
              pt: cur.style.getPropertyValue('padding-top'),
              ptP: cur.style.getPropertyPriority('padding-top'),
              pb: cur.style.getPropertyValue('padding-bottom'),
              pbP: cur.style.getPropertyPriority('padding-bottom'),
            });
            if (pt > 48) cur.style.setProperty('padding-top', '0', 'important');
            if (pb > 48) cur.style.setProperty('padding-bottom', '0', 'important');
          }
          cur = cur.parentElement;
        }
      }

      // v0.7.183：strip 大幅負 margin-top（CMS layout hack 的遺毒）。
      // 原站用 margin-top:-80px 類負值把 video block 向上拉進 opinion-
      // header 的 100px padding 區域做視覺重疊。我們 strip padding 後、
      // 負 margin 殘留 → video 溢出遮住 subtitle。通則：reader card
      // 內負 margin-top > 20px 的元素 = layout hack，不適用單欄 card。
      const negMarginSnap = [];
      {
        const _w = articleEl.ownerDocument?.defaultView;
        if (_w) {
          for (const el of articleEl.querySelectorAll('div, section')) {
            const mt = parseFloat(_w.getComputedStyle(el).marginTop) || 0;
            if (mt < -20) {
              negMarginSnap.push({
                el,
                mt: el.style.getPropertyValue('margin-top'),
                mtP: el.style.getPropertyPriority('margin-top'),
              });
              el.style.setProperty('margin-top', '0', 'important');
            }
          }
        }
      }

      // v0.7.246：版心自我檢查（enforce content width）。
      // 症狀（Jimmy roomie.tw/posts/73403 iPhone 回報）：圖片撐滿 reader card
      // 版心，但內文段落（v0.7.246）+ 標題 / 分類列（v0.7.247）左右各窄一截。
      // 根因 = 主文容器與內容之間夾了一層通用 block wrapper 帶水平 padding：
      //   內文：`div.content { padding: 0 20px }`
      //   標題列：`div.mobile-info { padding: 0 24px }`（內含可見標題 + 分類 + 日期；
      //           語意 h1 是 sr-only display:none，可見標題是非 heading 元素）
      // card 已提供唯一應有的閱讀內距、此 wrapper 的額外水平內距把內容壓窄到
      // < 設定版心寬。styler 既有 width:auto / max-width:100% 只擋「超寬」、
      // 擋不掉「被內距夾窄」。
      //
      // 通則（非站點特判）：reader card 是單欄 layout，card padding 是唯一應有
      // 的閱讀內距；card 內任何通用 block wrapper（div / section / article /
      // aside / header / footer / nav）+ 文字 block（p / h1-6）都不該再貢獻水平
      // padding/margin。直接遍歷 card 內這些元素清零水平內距——不依賴「找到某個
      // 段落」（roomie 可見標題不是 heading、隱藏 h1 又空，沿段落鏈走不到標題
      // wrapper，故 v0.7.247 改為全面遍歷）。
      //   - 語意縮排容器（blockquote / 清單 / 表格 / 圖說 / 程式碼 / details）
      //     自身與其後代不動——縮排是刻意的。
      //   - cleaner 清掉的隱藏雜訊（data-jread-hidden）不動。
      //   - 水平 margin：既有規則已對這些元素設 width:auto / max-width:100%，
      //     滿版元素的 auto margin 會算成 0，故 computed 水平 margin 非 0 必是
      //     「顯式非置中 margin」（narrowing / offset），清掉安全。
      // v0.8.123：水平 margin 改用「絕對值 > 0.5」判定——既清正 margin（narrowing
      //   / offset），也清**負 margin**（full-bleed overhang）。theverge.com 實測：
      //   in-body 圖片包在 `div.duet--article--block-placement` 帶 margin-left:-100px，
      //   原站用負 margin 讓圖片向版心左外延伸成 full-bleed；reader 單欄 card 下圖片
      //   被推到內文左側 100px、未與文字欄對齊（Jimmy 2026-06-19 回報「圖片沒置中」）。
      //   既有 `ml > 0.5` 只清正 margin、漏掉負 margin，且 early-return guard 把
      //   `ml<=0.5` 當「無事可做」整支跳過。改 abs 判定後負 margin 一併歸零、圖片
      //   wrapper 退回 column 起點對齊文字。媒體置中（img/picture/video/figure margin:
      //   auto）另由上方規則處理、不在 TARGET_SEL 內，互不干擾。
      // 圖片若是 wrapper 外的 full-bleed 子元素本就滿版，清零後內容與圖片同寬
      // = 符合設定寬度。翻頁模式（multicol）與捲動模式同根因同修法——走「水平
      // 內距和 = 0」不量 card 寬（multicol clientWidth 含全部欄量不準），通用。
      const contentWidthSnap = [];
      {
        const win = articleEl.ownerDocument?.defaultView;
        if (win) {
          // 語意縮排容器：縮排刻意（引言 / 清單 / 表格 / 圖說 / 程式碼），
          // 自身與後代都不清
          const INDENT_TAGS = new Set(['BLOCKQUOTE', 'UL', 'OL', 'DL', 'MENU', 'LI', 'DD', 'DT',
            'FIGURE', 'FIGCAPTION', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH',
            'PRE', 'DETAILS', 'SUMMARY']);
          // 清水平內距對象：通用 block wrapper + 內文文字 block
          const TARGET_SEL = 'div, section, article, main, aside, header, footer, nav, p, h1, h2, h3, h4, h5, h6';
          const zeroHoriz = (el) => {
            const cs = win.getComputedStyle(el);
            const pl = parseFloat(cs.paddingLeft) || 0;
            const pr = parseFloat(cs.paddingRight) || 0;
            const ml = parseFloat(cs.marginLeft) || 0;
            const mr = parseFloat(cs.marginRight) || 0;
            if (pl <= 0.5 && pr <= 0.5 && Math.abs(ml) <= 0.5 && Math.abs(mr) <= 0.5) return;
            contentWidthSnap.push({
              el,
              pl: el.style.getPropertyValue('padding-left'), plP: el.style.getPropertyPriority('padding-left'),
              pr: el.style.getPropertyValue('padding-right'), prP: el.style.getPropertyPriority('padding-right'),
              ml: el.style.getPropertyValue('margin-left'), mlP: el.style.getPropertyPriority('margin-left'),
              mr: el.style.getPropertyValue('margin-right'), mrP: el.style.getPropertyPriority('margin-right'),
            });
            if (pl > 0.5) el.style.setProperty('padding-left', '0', 'important');
            if (pr > 0.5) el.style.setProperty('padding-right', '0', 'important');
            if (Math.abs(ml) > 0.5) el.style.setProperty('margin-left', '0', 'important');
            if (Math.abs(mr) > 0.5) el.style.setProperty('margin-right', '0', 'important');
          };
          for (const el of articleEl.querySelectorAll(TARGET_SEL)) {
            // 自身是語意縮排容器 → 不清（保留引言 / 清單 / 表格縮排）
            if (INDENT_TAGS.has(el.tagName)) continue;
            // cleaner 清掉的隱藏雜訊不動
            if (el.closest && el.closest('[data-jread-hidden="1"]')) continue;
            // 在語意縮排脈絡內 → 縮排刻意，跳過
            let a = el.parentElement, insideIndent = false;
            while (a && a !== articleEl) {
              if (INDENT_TAGS.has(a.tagName)) { insideIndent = true; break; }
              a = a.parentElement;
            }
            if (insideIndent) continue;
            zeroHoriz(el);
          }
        }
      }

      // v0.8.123：圖說字級下限（caption font-size floor）。
      // v0.7.120 刻意把 figcaption 排除在 BODY_TEXT_SEL 外、保留原站 caption
      // typography（caption 普遍比 body 小一階是合理的階層差異化）。但部分站把
      // caption 設得過小（theverge.com 實測 figcaption 11px 配 ~18px 內文 →
      // 太小難讀，Jimmy 2026-06-19 回報「圖說閱讀困難」）。修法不回到「caption =
      // body」（會抹平階層、撞 v0.7.120 已知問題），改設**下限**：只把小於 floor
      // 的 caption 撐到 floor，已 >= floor 的 caption 維持原站字級不動（不縮大字、
      // 不抹平正常 caption 階層）。floor = max(14px, round(body * 0.78))——隨使用者
      // 字級縮放（body 大時 caption floor 同步變大）、且 14px 絕對下限保底；0.78
      // 係數讓 caption 仍明顯小於 body、保留階層。opts.fontSize 為 0（Auto sentinel、
      // 保留原站 body 字級）時用 18 當 body 估計值。inline !important 蓋站點 caption
      // class rule。snapshot 對稱還原（與 titleFsSnap 同款）。
      const captionFsSnap = [];
      {
        const _w = articleEl.ownerDocument?.defaultView;
        if (_w) {
          const bodyFs = opts.fontSize || 18;
          const capFloor = Math.max(14, Math.round(bodyFs * 0.78));
          for (const fc of articleEl.querySelectorAll('figcaption')) {
            if (fc.closest('[data-jread-hidden="1"]')) continue;
            const curFs = parseFloat(_w.getComputedStyle(fc).fontSize) || 0;
            if (curFs > 0 && curFs < capFloor - 0.5) {
              captionFsSnap.push({
                el: fc,
                fs: fc.style.getPropertyValue('font-size'),
                fsP: fc.style.getPropertyPriority('font-size'),
              });
              fc.style.setProperty('font-size', capFloor + 'px', 'important');
            }
          }
        }
      }

      // v0.7.203：constrain overwide descendants。Swiper / carousel 類 JS
      // library 在 reader mode 前就算好 slide 寬度（基於 viewport / 原站
      // layout），card 縮窄後 slide 仍是原寬 → 圖片溢出 card 右邊界。
      // Runtime walk：比較每個 block 元素的 rendered width 與 card width，
      // 超寬的強制 max-width:100% + box-sizing:border-box。max-width:100%
      // 相對 parent 逐層 cascade，最外層被 card 擋住、內層隨之縮。
      // v0.7.180：title font-size inline override。CMS 高 specificity rule
      // 常用 5+ class selector + !important 鎖死 h1 font-size（MSNBC/ms.now
      // `.opinion-header > .wp-block-group .title-and-dek-column
      //  h1.wp-block-post-title[class*=...] { font-size: 2rem !important }`
      // specificity (0,5+,1) 打敗 jread stylesheet (0,1,1)），CSS stylesheet
      // 打不贏。inline !important 是最高優先級。
      // 獨立搜尋第一個可見 h1（不依賴 firstInk 是否 H tag）：firstInk 可能是
      // P（副標題/byline 在 DOM order 比 H1 早出現時），title override 不該
      // 因此 miss。
      let titleFsSnap = null;
      if (overrides.titleFontSize) {
        const titleH1 = firstInk && /^H1$/.test(firstInk.tagName)
          ? firstInk
          : articleEl.querySelector('h1:not([data-jread-hidden="1"])');
        if (titleH1) {
          titleFsSnap = {
            el: titleH1,
            fs: titleH1.style.getPropertyValue('font-size'),
            fsP: titleH1.style.getPropertyPriority('font-size'),
          };
          titleH1.style.setProperty('font-size', opts.titleFontSize + 'px', 'important');
        }
      }

      // v0.8.3：hero 標題字級下限（Jimmy 2026-06-09 規則）。Auto 模式
      // （titleFontSize=0、不強制覆寫）下，原站把標題做得太小（roomie.tw
      // mobile span.title 23px、近內文 18px，視覺上不像標題）時，把 hero
      // 拉到至少 1.5× 內文字級。只在低於下限時 bump（max 語意），原站 hero
      // 夠大就不動。hero = detector inject 的 H1（[data-jread-injected-title]）
      // 優先，否則第一個可見 h1。override 模式由上方 titleFsSnap 精準覆寫、
      // 不走這條（exact size 已贏）。
      let heroFloorSnap = null;
      if (!overrides.titleFontSize) {
        const floorPx = Math.round((opts.fontSize || DEFAULTS.fontSize) * 1.5);
        const heroEl = articleEl.querySelector('[data-jread-injected-title="1"]')
          || (firstInk && /^H1$/.test(firstInk.tagName)
            ? firstInk
            : articleEl.querySelector('h1:not([data-jread-hidden="1"])'));
        if (heroEl && floorPx > 0) {
          const win = articleEl.ownerDocument && articleEl.ownerDocument.defaultView;
          const cur = win ? (parseFloat(win.getComputedStyle(heroEl).fontSize) || 0) : 0;
          if (cur < floorPx) {
            heroFloorSnap = {
              el: heroEl,
              fs: heroEl.style.getPropertyValue('font-size'),
              fsP: heroEl.style.getPropertyPriority('font-size'),
            };
            heroEl.style.setProperty('font-size', floorPx + 'px', 'important');
          }
        }
      }

      // v0.7.93：substack 類 image gallery 修法——含直接 picture/img/figure 子的
      // flex/grid 容器強制改成 block display + height auto，讓並列圖在 reader mode
      // 下垂直堆疊、不再被父容器固定 height 切掉內容 + 不再 overflow 蓋下方文字。
      // 案例（synapseching.substack.com /p/17 Jimmy 2026-05-13 回報）：
      //   IMG → PICTURE → DIV.imageRow（display:flex, height:230px）→ ...
      //   imageRow flex 子 align-items:stretch 把 picture 拉到 230，但 styler
      //   `img { height:auto !important }` 讓 IMG 跑 natural ratio = 295，
      //   IMG 超出 picture 65px → 視覺覆蓋下方段落文字。
      //   單純 height:auto 又會讓 flex container 內並列圖各取 max-width:100% 加總
      //   溢出 article 右側（第二張 img.left=952 > article.right=944）。
      //   結論：reader card 單欄閱讀情境下 flex/grid 並列 layout 無保留必要，
      //   直接 display:block 讓兩張圖垂直堆疊最穩。
      // 通則 selector：祖先到 articleEl 為止，掃所有 display:flex / display:grid 且
      // 直接子含 picture / img / figure 的元素，runtime 設 inline !important
      // 蓋過原站 stylesheet。CSS :has() jsdom 不支持，改 runtime 解決。
      const galleryFlex = [];
      // v0.7.144：原 code 對主文每個後代跑 getComputedStyle 找 flex/grid + 含
      // picture/img/figure 直接子的 wrapper。大頁面 + 多次設定變更時負荷重。
      // 改為先 querySelectorAll('picture, img, figure') 收媒體節點 → 各自往上
      // walk parent 鏈到 articleEl 為止收集祖先 Set → 對 Set 內元素才跑
      // getComputedStyle。從 O(全 DOM) → O(媒體節點 × 平均深度)；純文字主文
      // 直接 short-circuit 0 次 getComputedStyle。
      const mediaAncestors = new Set();
      const mediaNodes = articleEl.querySelectorAll('picture, img, figure');
      for (const media of mediaNodes) {
        let cur = media.parentElement;
        while (cur && cur !== articleEl) {
          mediaAncestors.add(cur);
          cur = cur.parentElement;
        }
      }
      for (const el of mediaAncestors) {
        // v0.8.45：排除 player 結構（與 v0.7.182 background strip 同原則）。
        // ms.now 實測：JW Player 的 jw-wrapper（含 poster img、computed flex）
        // 被本規則打成 display:block + height:auto → 容器塌成 16px → JW JS
        // 對 video 寫負 margin 置中於塌掉的容器 → video absolute 突出 342px
        // 蓋住 dek 文字 + 流空間錯位出 245px 假空白（gap audit y=206 實證）。
        // player 內部 layout 由 player JS 自己管理，jread 不該動。
        if (el.getAttribute && el.getAttribute(PLAYER_ATTR) === '1') continue;
        // v1.0.8：byline 區自管 flex 一行 layout（見 BYLINE_ATTR），不被 gallery
        // flatten 成 block——否則 inline display:block !important 蓋掉 byline flex
        if (el.closest && el.closest(`[${BYLINE_ATTR}="1"]`)) continue;
        const cs = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
        if (!cs) continue;
        if (cs.display !== 'flex' && cs.display !== 'grid' && cs.display !== 'inline-flex' && cs.display !== 'inline-grid') continue;
        let hasMediaChild = false;
        for (const c of el.children) {
          if (c.tagName === 'PICTURE' || c.tagName === 'IMG' || c.tagName === 'FIGURE') {
            hasMediaChild = true;
            break;
          }
        }
        if (!hasMediaChild) continue;
        // snapshot 原 inline value/priority for restore
        const prior = {
          el,
          display: el.style.getPropertyValue('display'),
          displayPriority: el.style.getPropertyPriority('display'),
          height: el.style.getPropertyValue('height'),
          heightPriority: el.style.getPropertyPriority('height'),
          minHeight: el.style.getPropertyValue('min-height'),
          minHeightPriority: el.style.getPropertyPriority('min-height')
        };
        galleryFlex.push(prior);
        el.style.setProperty('display', 'block', 'important');
        el.style.setProperty('height', 'auto', 'important');
        el.style.setProperty('min-height', '0', 'important');

        // v0.7.94：gallery flex 改 block 後原 flex gap 失效，直接子（figure /
        // picture / img / a / div）會緊貼。逐個媒體子設 margin-bottom: 12px
        // !important 補空白。snapshot 紀錄原 inline margin-bottom 以便 restore。
        // Jimmy 2026-05-13 回報 v0.7.93 修完三張並列照片改垂直後緊貼無間距。
        const mediaTags = new Set(['FIGURE', 'PICTURE', 'IMG', 'A', 'DIV']);
        for (const child of el.children) {
          if (!mediaTags.has(child.tagName)) continue;
          // 排除「不含媒體」的 div（gallery wrapper 內偶爾混 spacer / caption），
          // 只對「自身含 img/picture/figure 子孫」的 element 加 margin。
          const hasMediaDescendant = child.tagName === 'IMG' || child.tagName === 'PICTURE' || child.tagName === 'FIGURE' ||
            !!(child.querySelector && child.querySelector('img, picture, figure'));
          if (!hasMediaDescendant) continue;
          const priorChild = {
            el: child,
            marginBottom: child.style.getPropertyValue('margin-bottom'),
            marginBottomPriority: child.style.getPropertyPriority('margin-bottom')
          };
          galleryFlex.push(priorChild);
          child.style.setProperty('margin-bottom', '12px', 'important');
        }
      }

      // v0.8.137：媒體 wrapper 用 aspect-ratio 預留固定比例 placeholder（lazy-load
      // 占位），但實際載入的圖片比例 ≠ 預留比例時，wrapper 高度按 aspect-ratio 撐
      // 出超過圖片內容的空間 → 圖片下方一大塊假空白（Jimmy 2026-06-20 The Verge
      // lede / gallery wrapper 用雜湊 atomic class 設 aspect-ratio:1/1、實際 landscape
      // 圖渲染 405px、box 撐 608px → 203px 假空白；截圖回報）。
      // 上方 CSS [class*="ratio" i] reset 只認 class 名含 "ratio" 的容器（New Yorker
      // AspectRatioContainer 類），SPA 站把 aspect-ratio 塞進 hash class（_1m5y14k5）
      // 漏網。改用 computed aspect-ratio !== 'auto' 這個結構訊號（非 class / hostname
      // 特判，符合硬規則 3）：mediaAncestors 內任何帶實際 aspect-ratio 的 wrapper
      // 一律歸 auto，讓 box 高度退回圖片 static flow 的自然高度。
      // 安全性：
      //   - mediaAncestors 由 picture/img/figure 上溯收集，純 iframe 影片 embed
      //     （aspect-ratio:16/9 + iframe absolute 撐高、無 img）不在集合內、不誤殺。
      //   - player 結構額外排除（與 galleryFlex 同原則）。
      //   - 自驗 collapse guard：歸 auto 後若 box 塌到比內圖渲染高度還矮（內容本身
      //     absolute、aspect-ratio 是唯一高度來源，例 New Yorker overlay 類但 class
      //     不含 "ratio" 漏掉 static-flow 配套）→ 還原 aspect-ratio 避免裁切。內圖
      //     尚未載入（高度 0）時仍 reset：未載圖沒有要保護的高度，box 跟著塌、載入
      //     後 height:auto 自然撐起。
      const ratioBoxes = [];
      for (const el of mediaAncestors) {
        if (el.getAttribute && el.getAttribute(PLAYER_ATTR) === '1') continue;
        const win = el.ownerDocument?.defaultView;
        const cs = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
        if (!cs || !cs.aspectRatio || cs.aspectRatio === 'auto') continue;
        const innerMedia = el.querySelector('img, picture, video');
        const imgH = innerMedia ? innerMedia.getBoundingClientRect().height : 0;
        const priorAR = el.style.getPropertyValue('aspect-ratio');
        const priorARP = el.style.getPropertyPriority('aspect-ratio');
        el.style.setProperty('aspect-ratio', 'auto', 'important');
        // getBoundingClientRect 同步 flush layout，afterH 反映 reset 後高度。
        const afterH = el.getBoundingClientRect().height;
        if (imgH > 0 && afterH < imgH * 0.8) {
          if (priorAR) el.style.setProperty('aspect-ratio', priorAR, priorARP || '');
          else el.style.removeProperty('aspect-ratio');
          continue;
        }
        ratioBoxes.push({ el, aspectRatio: priorAR, aspectRatioPriority: priorARP });
      }

      // v0.8.66：多欄塌成單欄（de-column flex/grid columns）。
      // 根因（Jimmy 2026-06-14 christies.com/en/stories/... 回報「內文寬度不
      // 正確」+「圖片偏左變小」）：原站把主文段落 / 內容圖片排進 flex-row /
      // 多欄 grid 容器做雜誌式雙欄 layout（christies `div.sc-kLokBR` 是
      // display:flex 把內文擠成 292px 半欄、把直幅素描鎖在 66.67% 欄 = 397px、
      // 另半欄留給側欄圖說，本文沒側欄時右半整片留白）。reader card 是單欄
      // layout，這類橫向分欄讓內容只佔卡片版心一部分、大量浪費可讀寬度。
      // 上方 galleryFlex 只處理「含 picture/img/figure 直接子」的 flex/grid
      // （並列圖），「段落分欄」與「媒體深埋在欄 wrapper div 內」是另兩條
      // path——這裡一起補上。
      //
      // 通則（非站點特判，符合硬規則 3）：以「主文長段落 / 內容圖片實際被渲染
      // 得比它的 flex/grid 祖先的內容寬窄一截（< 70%）」為結構訊號——往上找出
      // 真正在分欄的那層容器，塌成 display:block 讓內容退回正常 block flow 撐滿
      // 版心（塌欄後欄 wrapper 的 flex-basis 失效、退回 block 自然填滿父寬）。
      // 防誤殺：
      //   - 只認 flex-direction:row(-reverse) 或 grid 多欄（>= 2 column track）；
      //     flex-column 本來就垂直堆疊、不命中。
      //   - anchor 必須是 >= 80 字的長 <p> 或 >= 100px 的 content img——button
      //     row / tag 列 / 麵包屑 / metadata / emoji / icon-link 沒有長段落或
      //     大圖、不命中。
      //   - anchor 寬必須 < 容器內容寬 70%——單一全寬 flex/grid 子（沒真的分欄）
      //     比例接近 1、不動。
      // 每塌一層後重量 anchor 寬：內層 splitter 塌掉後 anchor 已撐滿，外層若非
      // splitter 比例回到 ~1 不會被誤塌（避免 stale 寬度連鎖誤判）。
      const textColFlex = [];
      const textColSeen = new Set();
      // v0.8.69：lazy content img 載入後才補跑 de-column 的 load listener，
      // restore 時清除尚未觸發者（避免退出後仍在 detach 節點上塌欄 / 洩漏）。
      const decolumnLoadCleanup = [];
      // galleryFlex 已塌成 block 的容器不再重複塌（避免 restore 雙重還原）。
      for (const g of galleryFlex) { if (g.el) textColSeen.add(g.el); }
      {
        const win = articleEl.ownerDocument?.defaultView;
        if (win) {
          // 對單一 anchor 沿祖先鏈塌分欄容器（長段落 / content img 共用同一邏輯）。
          // ratio = anchor 渲染寬 / 容器內容寬 的「塌欄門檻」：anchor 比這比例
          // 還窄才視為「真的被分欄擠窄」。長段落用 0.7（pull-quote / 縮排引言等
          // 合法窄段落比例落在 0.7~1，不該誤塌）；content 圖片用 0.9——v0.8.70：
          // 圖片在單欄閱讀模式只有「撐滿」或「被分欄擠窄」兩種狀態、沒有中間
          // 地帶，hero 是 440px 小圖卡在 flex 欄 = 72%（> 0.7 漏掉、Jimmy 截圖
          // 仍偏左），把圖片門檻放寬到 0.9 讓「沒撐滿（< 90%）的 flex/grid 欄內
          // 圖」都塌欄 → 退回 block 流、margin auto 置中（且 picture srcset 重評
          // 常順帶載入更寬來源撐滿）。真正撐滿（>= 90%）的單一全寬圖比例近 1、不動。
          const decolumnFrom = (anchor, ratio) => {
            let cur = anchor.parentElement;
            while (cur && cur !== articleEl) {
              if (!textColSeen.has(cur) &&
                  !(cur.getAttribute && cur.getAttribute(PLAYER_ATTR) === '1') &&
                  !(cur.closest && cur.closest(`[${BYLINE_ATTR}="1"]`))) {
                const cs = win.getComputedStyle(cur);
                const disp = cs.display;
                const isFlexRow = (disp === 'flex' || disp === 'inline-flex') &&
                  /^row/.test(cs.flexDirection);
                const cols = cs.gridTemplateColumns;
                const isGridMulti = (disp === 'grid' || disp === 'inline-grid') &&
                  cols && cols !== 'none' && cols.trim().split(/\s+/).length >= 2;
                if (isFlexRow || isGridMulti) {
                  const r = cur.getBoundingClientRect();
                  const contentW = r.width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
                  const aw = anchor.getBoundingClientRect().width; // 每層重量（前一層塌掉後會變寬）
                  if (contentW > 0 && aw > 0 && aw < contentW * ratio) {
                    textColSeen.add(cur);
                    textColFlex.push({
                      el: cur,
                      display: cur.style.getPropertyValue('display'),
                      displayPriority: cur.style.getPropertyPriority('display'),
                    });
                    cur.style.setProperty('display', 'block', 'important');
                  }
                }
              }
              cur = cur.parentElement;
            }
          };

          // v1.0.9：作者 bio / meta 卡的「窄圖欄擠寬文欄」塌成單欄（stack）。
          // 根因（Jimmy 2026-06-25 autocar.co.uk 作者欄「文字疊在一起」回報）：
          // 站點把作者卡排成 flex-row 兩欄——窄欄（頭像 + Title/Follow 標籤）+
          // 寬欄（bio 長文）。reader card 單欄下窄欄被擠到 min-content（autocar
          // .author-left 渲染 39px = card 6%），頭像（capIcon 釘 max-width 142）
          // 被壓到 39px、標籤逐字斷行，與寬欄 bio 文字擠在一起（real Chrome 疊字、
          // headless 並排但同樣破版）。decolumnFrom 的 ratio 閘以「主文 anchor 被
          // 擠窄」為訊號，這裡被擠的是窄圖欄、寬 bio 欄佔 82% > 70% 漏網。
          // 通則（結構，非站點特判，符合硬規則 3）：flex-row / 多欄 grid 容器，其中
          // 一個「含圖的內容欄」被渲染得極窄（< 25% 容器內容寬）、另有一欄佔 >= 50%
          // （lopsided sidebar + main 分欄）→ 單欄閱讀無保留價值，塌成 display:block
          // 讓兩欄垂直堆疊（窄圖欄回全寬、頭像回原顯示寬、標籤不再逐字斷行；寬欄
          // 落到下方）。防誤殺：narrow 欄必須含 img（純窄文字欄 = 分類標籤，交給
          // cleaner sidebar 規則 hide，不在此塌欄）；排除 byline root / player。
          // 沿 img 祖先鏈走（path child 即含 img 的欄），bounded by img 數 × 深度。
          const stackLopsidedImgCol = (img) => {
            let child = img, cur = img.parentElement;
            while (cur && cur !== articleEl) {
              if (!textColSeen.has(cur) &&
                  !(cur.getAttribute && cur.getAttribute(PLAYER_ATTR) === '1') &&
                  !(cur.closest && cur.closest(`[${BYLINE_ATTR}="1"]`))) {
                const cs = win.getComputedStyle(cur);
                const disp = cs.display;
                const isFlexRow = (disp === 'flex' || disp === 'inline-flex') &&
                  /^row/.test(cs.flexDirection);
                const cols = cs.gridTemplateColumns;
                const isGridMulti = (disp === 'grid' || disp === 'inline-grid') &&
                  cols && cols !== 'none' && cols.trim().split(/\s+/).length >= 2;
                if (isFlexRow || isGridMulti) {
                  const r = cur.getBoundingClientRect();
                  const contentW = r.width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
                  const childW = child.getBoundingClientRect().width;
                  if (contentW > 0 && childW > 0 && childW < contentW * 0.25) {
                    // 另需一個 >= 50% 寬的 sibling 欄（確認是 lopsided 分欄、非單欄）
                    let wideSibling = false;
                    for (const c of cur.children) {
                      if (c === child) continue;
                      const cr = c.getBoundingClientRect();
                      if (cr.height >= 1 && cr.width >= contentW * 0.5) { wideSibling = true; break; }
                    }
                    if (wideSibling) {
                      textColSeen.add(cur);
                      textColFlex.push({
                        el: cur,
                        display: cur.style.getPropertyValue('display'),
                        displayPriority: cur.style.getPropertyPriority('display'),
                      });
                      cur.style.setProperty('display', 'block', 'important');
                    }
                  }
                }
              }
              child = cur;
              cur = cur.parentElement;
            }
          };

          // anchor 1：長段落（toggle 當下已在 DOM、文字不 lazy）。
          for (const p of articleEl.querySelectorAll('p')) {
            if (p.closest && p.closest('[data-jread-hidden="1"]')) continue;
            if ((p.textContent || '').trim().length >= 80) decolumnFrom(p, 0.7);
          }
          // anchor 2：content 圖片（v0.8.68）——christies stories 把直幅素描 /
          // hero 放進 flex-row 的 66.67% 欄（DIV flex: 0 0 calc(66.6667% - 8px)），
          // 欄內只有 <a><picture><img>、沒有長 <p>，longParas 路徑漏掉、圖被鎖在
          // 2/3 欄寬 = 397px（card 內容寬 608），偏左又縮小。galleryFlex 只認
          // 「flex/grid 直接子是 picture/img/figure」的並列圖，這裡的媒體深埋在欄
          // wrapper div 內、不命中。inline emoji（INLINE_IMG_ATTR）與純 icon-link
          // （a > img 未標 content-img）排除，與 styler media 規則同準則。
          //
          // v0.8.69：lazy 圖延後處理——hero 在 above-fold 卻 lazy-load，toggle
          // 當下 naturalWidth=0 / rect 0x0、不滿 >= 100px anchor 門檻被漏掉，
          // 一次性 de-column 跑完就不再回頭，圖載入後仍卡 66.67% 欄偏左（Jimmy
          // 2026-06-14 cage 實機實證：hero rect 397/608、sc-kLokBR 仍 flex、
          // 長 <p> 路徑救不到它的圖說欄）。修法：toggle 當下已載入的圖立即跑；
          // 未載入的掛一次性 load listener，載入後重量、夠大且撐窄欄才塌。
          for (const m of articleEl.querySelectorAll('img')) {
            if (m.closest && m.closest('[data-jread-hidden="1"]')) continue;
            if (m.hasAttribute(INLINE_IMG_ATTR)) continue;
            if (m.parentElement && m.parentElement.tagName === 'A' &&
                !m.hasAttribute(CONTENT_IMG_ATTR)) continue;
            const mr = m.getBoundingClientRect();
            if (mr.width >= 100 && mr.height >= 100) {
              decolumnFrom(m, 0.9);
            } else if (!m.complete || (m.naturalWidth || 0) === 0) {
              const onLoad = () => {
                if (m.hasAttribute(INLINE_IMG_ATTR)) return;
                const rr = m.getBoundingClientRect();
                if (rr.width >= 100 && rr.height >= 100) decolumnFrom(m, 0.9);
              };
              m.addEventListener('load', onLoad, { once: true });
              decolumnLoadCleanup.push({ img: m, onLoad });
            }
          }

          // v0.8.136：互補 case——「固定 px grid/flex track 不隨 card 縮窄」造成
          // 內文被撐寬往右溢出。上方 decolumnFrom 的 ratio 閘只認「anchor 被擠得
          // 比容器窄」（< 70%/90%），認不出「anchor 反而比 card 還寬、右移溢出」。
          // NYT Wirecutter 實測（snoo-smart-sleeper）：article > div（display:grid，
          // 寬度已正確縮到 card content box 608px）的 grid 子項用站點寫死的 1024px
          // content track → 內含 h1/p/figure 全部 1024 寬、左緣右移 64px、右緣
          // 衝出 card content box 被 overflow-x:hidden 切掉 → 視覺上「圖文偏右 +
          // 右側被切」。decolumnFrom 對長 <p> 走到此 grid 時 anchor 寬 1024 >
          // 容器 608、不滿足 narrower 閘 → 漏網。
          // 通則（結構，非站點特判，符合硬規則 3）：任何 grid/flex 容器，其直接子
          // 渲染右緣溢出 card 右緣 → 固定 track / 並列 layout 在單欄閱讀無保留價值，
          // 塌成 display:block 讓子項退回 block flow（width 退回父寬、靠左對齊）。
          // overflow 幾何閘只動真破版的容器、放過正常 grid/flex。
          // 效能：先用 rect 收「溢出右緣」節點 → 往上收祖先 Set → 只對 Set 跑
          // getComputedStyle（同 galleryFlex mediaAncestors 思路，避免 O(全 DOM)
          // getComputedStyle）。
          {
            const cardRight = articleEl.getBoundingClientRect().right;
            const overflowAncestors = new Set();
            for (const el of articleEl.querySelectorAll('*')) {
              const rr = el.getBoundingClientRect();
              if (rr.width < 1 || rr.height < 1) continue;
              if (rr.right <= cardRight + 2) continue;
              let cur = el.parentElement;
              while (cur && cur !== articleEl.parentElement) {
                overflowAncestors.add(cur);
                cur = cur.parentElement;
              }
            }
            for (const el of overflowAncestors) {
              if (textColSeen.has(el)) continue;
              if (el.getAttribute && el.getAttribute(PLAYER_ATTR) === '1') continue;
              const cs = win.getComputedStyle(el);
              const disp = cs.display;
              // 同 decolumnFrom 的容器判定：只認真做橫向並列的 flex-row /
              // 多欄 grid——flex-column 本來就垂直堆疊、單欄 grid 沒分欄，不該
              // 因「某後代溢出」被誤塌。
              const isFlexRow = (disp === 'flex' || disp === 'inline-flex') &&
                /^row/.test(cs.flexDirection);
              const cols = cs.gridTemplateColumns;
              const isGridMulti = (disp === 'grid' || disp === 'inline-grid') &&
                cols && cols !== 'none' && cols.trim().split(/\s+/).length >= 2;
              if (!isFlexRow && !isGridMulti) continue;
              let overflows = false;
              for (const c of el.children) {
                const cr = c.getBoundingClientRect();
                if (cr.width >= 1 && cr.right > cardRight + 2) { overflows = true; break; }
              }
              if (!overflows) continue;
              textColSeen.add(el);
              textColFlex.push({
                el,
                display: el.style.getPropertyValue('display'),
                displayPriority: el.style.getPropertyPriority('display'),
              });
              el.style.setProperty('display', 'block', 'important');
            }
          }

          // v1.0.9：窄圖欄擠寬文欄的作者 / meta 卡塌成單欄（見 stackLopsidedImgCol
          // 註解）。對每張非 inline-emoji 圖沿祖先鏈找 lopsided flex-row / grid。
          // 圖小（avatar capIcon 39px）被上方 decolumnFrom 的 >= 100px 門檻漏掉，
          // 故獨立掃。
          for (const m of articleEl.querySelectorAll('img')) {
            if (m.closest && m.closest('[data-jread-hidden="1"]')) continue;
            if (m.hasAttribute(INLINE_IMG_ATTR)) continue;
            stackLopsidedImgCol(m);
          }
        }
      }

      // v0.7.179：WordPress constrained layout inline override。
      // CSS stylesheet `html [data-jread-active] p { max-width: none !important }`
      // 在某些 WP theme 下 computed 仍未生效（疑似 WP 動態注入的 inline style
      // 或 container query 機制覆蓋）。inline !important 是 CSS 最高優先級，
      // 任何 stylesheet rule 都無法打敗。
      const wpConstrained = [];
      const CONTENT_BLOCK_SEL = 'p, h1, h2, h3, h4, h5, h6, ul, ol, dl';
      for (const el of articleEl.querySelectorAll(CONTENT_BLOCK_SEL)) {
        const cs = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
        if (!cs) continue;
        const mw = cs.maxWidth;
        if (mw && mw !== 'none' && mw !== '100%' && !mw.startsWith('100')) {
          wpConstrained.push({
            el,
            maxWidth: el.style.getPropertyValue('max-width'),
            maxWidthPriority: el.style.getPropertyPriority('max-width'),
          });
          el.style.setProperty('max-width', 'none', 'important');
        }
      }

      // v0.8.101：寬語意內容（table / pre）超出 card → 卡內水平捲，不被切掉。
      // 根因（arxiv HTML 全文）：LaTeXML 把展示公式輸出成 <table class="ltx_equation">，
      // 內含不可斷行的數學運算式，intrinsic min-width 撐破卡片版心；styler 既有
      // 全後代 max-width:100%（line 1314）限縮 box 寬卻擋不住內容 min-width，
      // table 仍溢出右緣被 card 的 overflow-x:hidden 切掉——公式右側 + 式號被截、
      // 使用者看不到也捲不到（probe 實測溢出 54-144px）。
      // 通則（非站點特判，符合硬規則 3）：table / pre 是「內容無法 wrap」的語意
      // 載體，渲染寬撐破 card 時改 display:block + overflow-x:auto + max-width:100%
      // 讓它在卡內水平捲（標準 responsive-table pattern）——使用者捲得到 = 視覺
      // 無破版（probe 套後 fitsCard + innerScroll 110-200px）。防誤殺：
      //   - 只處理「實際溢出右緣」的——能正常 wrap 的窄表格 / 文字不命中。
      //   - 排除 player 結構（與 galleryFlex 同原則）。
      //   - 排除已被既有 overflow-x:auto/scroll 祖先（在卡內）吸收的——原站
      //     已給 code block 內捲（rust-book / k8s 的 <pre> overflow-x:auto）就不
      //     重複處理，避免雙重 scroll container。
      const wideScroll = [];
      {
        const win = articleEl.ownerDocument?.defaultView;
        if (win) {
          const cardRight = articleEl.getBoundingClientRect().right;
          for (const el of articleEl.querySelectorAll('table, pre')) {
            if (el.getAttribute && el.getAttribute(PLAYER_ATTR) === '1') continue;
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            if (r.right <= cardRight + 2) continue; // 沒溢出右緣 → 不動
            // 已被「在卡內、可捲到」的祖先吸收 → 不重複處理
            let absorbed = false, cur = el.parentElement;
            while (cur && cur !== articleEl.parentElement) {
              const ox = win.getComputedStyle(cur).overflowX;
              if ((ox === 'auto' || ox === 'scroll') &&
                  cur.getBoundingClientRect().right <= cardRight + 2) { absorbed = true; break; }
              cur = cur.parentElement;
            }
            if (absorbed) continue;
            wideScroll.push({
              el,
              display: el.style.getPropertyValue('display'),
              displayPriority: el.style.getPropertyPriority('display'),
              overflowX: el.style.getPropertyValue('overflow-x'),
              overflowXPriority: el.style.getPropertyPriority('overflow-x'),
              maxWidth: el.style.getPropertyValue('max-width'),
              maxWidthPriority: el.style.getPropertyPriority('max-width'),
            });
            el.style.setProperty('display', 'block', 'important');
            el.style.setProperty('max-width', '100%', 'important');
            el.style.setProperty('overflow-x', 'auto', 'important');
          }
        }
      }

      // Pangu spacing：CJK ↔ 英數字之間自動補空白。設定預設 true，使用者可
      // 到 options 取消。一次性掃完整 articleEl + 起 MutationObserver 接後續
      // 動態注入內容（SPA / lazy-load 留言、推薦、晚到段落等）。
      const panguEnabled = s.pangu !== false;
      const panguSnap = panguEnabled ? panguInstall(articleEl) : null;

      return { articleEl, ancestors, htmlHadClass, firstInk, firstInkPriorMt, firstInkPriorMtPriority, ancestorPaddingSnap, negMarginSnap, contentWidthSnap, captionFsSnap, titleFsSnap, heroFloorSnap, galleryFlex, ratioBoxes, textColFlex, decolumnLoadCleanup, wpConstrained, wideScroll, panguSnap, inlineImgs, inlineImgPins, contentImgs, iconImgs, upscaleImgs, contentImgLoadCleanup, playerMarked, fillIframes, textDivMarked, contrastBgSnap, themeColorSnap, viewportSnap, bylineMarks, bylineDispSnap };
    },

    /**
     * 還原 apply() 所做的所有變更。
     * @param {Element} _articleEl 相容舊 API，實際從 snapshot 讀
     * @param {object} snapshot apply() 的回傳值
     */
    restore(_articleEl, snapshot) {
      if (!snapshot) return;
      // v0.8.130：清 marker <style> + 可能的 adopted sheet（CSP fallback 對稱還原）
      NS.removeCssText(STYLE_ID);

      // v0.7.90：移除 scroll listener、清 timer 與 scrolling attr，避免閱讀
      // 模式關閉後仍在 html 留下 [data-jread-scrolling] / 殘留 timer 觸發 attr 設定。
      window.removeEventListener('scroll', onScrollFlash, { passive: true });
      if (scrollHideTimer) {
        clearTimeout(scrollHideTimer);
        scrollHideTimer = null;
      }
      document.documentElement.removeAttribute(SCROLLING_ATTR);

      // 閱讀進度條清除
      window.removeEventListener('scroll', onScrollProgress, { passive: true });
      if (progressEl) { progressEl.remove(); progressEl = null; }

      // v0.7.91：移除 SPACE keydown listener（避免關閉 reader mode 後 SPACE
      // 仍被 jread 攔截）。capture phase listener 第三個參數須為 true 才能正確 dedup。
      window.removeEventListener('keydown', onSpaceScroll, true);

      if (Array.isArray(snapshot.inlineImgs)) {
        for (const img of snapshot.inlineImgs) {
          if (img && img.removeAttribute) img.removeAttribute(INLINE_IMG_ATTR);
        }
      }
      // v0.8.98：還原 viewBox-only SVG emoji 的 inline width/height 釘寬
      if (Array.isArray(snapshot.inlineImgPins)) {
        for (const s of snapshot.inlineImgPins) {
          if (!s || !s.img || !s.img.style) continue;
          if (s.prevW) s.img.style.setProperty('width', s.prevW, s.prevWP || '');
          else s.img.style.removeProperty('width');
          if (s.prevH) s.img.style.setProperty('height', s.prevH, s.prevHP || '');
          else s.img.style.removeProperty('height');
        }
      }
      if (Array.isArray(snapshot.contentImgs)) {
        for (const img of snapshot.contentImgs) {
          if (img && img.removeAttribute) img.removeAttribute(CONTENT_IMG_ATTR);
        }
      }
      // v0.8.112：移除 bare 內容圖放大標記（CSS-only、無 inline style，移 attr 即還原）
      if (Array.isArray(snapshot.upscaleImgs)) {
        for (const img of snapshot.upscaleImgs) {
          if (img && img.removeAttribute) img.removeAttribute(UPSCALE_IMG_ATTR);
        }
      }
      // v0.8.90：還原 icon 圖的 inline max-width 釘寬 + 移除標記
      if (Array.isArray(snapshot.iconImgs)) {
        for (const s of snapshot.iconImgs) {
          if (!s || !s.img) continue;
          if (s.prevMw) s.img.style.setProperty('max-width', s.prevMw, s.prevMwP || '');
          else s.img.style.removeProperty('max-width');
          if (s.img.removeAttribute) s.img.removeAttribute(ICON_IMG_ATTR);
        }
      }
      // 移除尚未觸發的 lazy-load content-img 標記 listener（避免退出後圖載入仍
      // 在已 detach 的節點上補標 / listener 洩漏）
      if (Array.isArray(snapshot.contentImgLoadCleanup)) {
        for (const { img, onLoad } of snapshot.contentImgLoadCleanup) {
          if (img && img.removeEventListener) img.removeEventListener('load', onLoad);
        }
      }
      if (Array.isArray(snapshot.playerMarked)) {
        for (const el of snapshot.playerMarked) {
          if (el && el.removeAttribute) el.removeAttribute(PLAYER_ATTR);
        }
      }
      // v0.8.86：移除 responsive embed iframe fill 標記
      if (Array.isArray(snapshot.fillIframes)) {
        for (const ifr of snapshot.fillIframes) {
          if (ifr && ifr.removeAttribute) ifr.removeAttribute(FILL_IFRAME_ATTR);
        }
      }
      // v0.8.49：移除「div 當段落」標記
      if (Array.isArray(snapshot.textDivMarked)) {
        for (const el of snapshot.textDivMarked) {
          if (el && el.removeAttribute) el.removeAttribute(TEXT_DIV_ATTR);
        }
      }

      // v1.0.8：還原 byline inline display（在 cleaner.restore 之前——main.js
      // 458→459——collapsed 元素還回 cleaner 值、cleaner 再還回原始）+ 移除標記
      if (Array.isArray(snapshot.bylineDispSnap)) {
        for (const s of snapshot.bylineDispSnap) {
          if (!s || !s.el) continue;
          const prop = s.prop || 'display';
          if (s.prev) s.el.style.setProperty(prop, s.prev, s.prevP || '');
          else s.el.style.removeProperty(prop);
        }
      }
      if (Array.isArray(snapshot.bylineMarks)) {
        for (const m of snapshot.bylineMarks) {
          if (m && m.el && m.el.removeAttribute) m.el.removeAttribute(m.attr);
        }
      }

      if (snapshot.articleEl && snapshot.articleEl.removeAttribute) {
        snapshot.articleEl.removeAttribute(ARTICLE_ATTR);
      }
      if (Array.isArray(snapshot.ancestors)) {
        for (const a of snapshot.ancestors) {
          if (a && a.removeAttribute) a.removeAttribute(ANCESTOR_ATTR);
        }
      }
      if (!snapshot.htmlHadClass) {
        document.documentElement.classList.remove(HTML_CLASS);
      }

      // v0.8.24：還原 theme-color meta（自建的移除、原有的還原 content）
      restoreThemeColor(snapshot.themeColorSnap);

      // v0.8.139：還原 viewport meta（自建的移除、原有的還原 content）
      restoreViewport(snapshot.viewportSnap);

      if (snapshot.firstInk) {
        if (snapshot.firstInkPriorMt) {
          snapshot.firstInk.style.setProperty(
            'margin-top',
            snapshot.firstInkPriorMt,
            snapshot.firstInkPriorMtPriority || ''
          );
        } else {
          snapshot.firstInk.style.removeProperty('margin-top');
        }
      }

      // Pangu spacing 還原：停 MutationObserver、把改過的 text node 還回原值
      // 必須在移除 ARTICLE_ATTR 之後（restore 順序對 DOM 副作用沒有依賴，但
      // panguRestore 內部只看 snapshot.changes，不依賴 reader mode attr）
      if (snapshot.panguSnap) {
        panguRestore(snapshot.panguSnap);
      }

      // v0.7.179：還原 ancestor padding strip
      if (Array.isArray(snapshot.ancestorPaddingSnap)) {
        for (const s of snapshot.ancestorPaddingSnap) {
          if (!s || !s.el) continue;
          if (s.pt) s.el.style.setProperty('padding-top', s.pt, s.ptP || '');
          else s.el.style.removeProperty('padding-top');
          if (s.pb) s.el.style.setProperty('padding-bottom', s.pb, s.pbP || '');
          else s.el.style.removeProperty('padding-bottom');
        }
      }

      // v0.7.183：還原 negative margin-top strip
      if (Array.isArray(snapshot.negMarginSnap)) {
        for (const s of snapshot.negMarginSnap) {
          if (!s || !s.el) continue;
          if (s.mt) s.el.style.setProperty('margin-top', s.mt, s.mtP || '');
          else s.el.style.removeProperty('margin-top');
        }
      }

      // v0.7.246：還原內文版心自我檢查清掉的水平 padding/margin
      if (Array.isArray(snapshot.contentWidthSnap)) {
        for (const s of snapshot.contentWidthSnap) {
          if (!s || !s.el) continue;
          if (s.pl) s.el.style.setProperty('padding-left', s.pl, s.plP || '');
          else s.el.style.removeProperty('padding-left');
          if (s.pr) s.el.style.setProperty('padding-right', s.pr, s.prP || '');
          else s.el.style.removeProperty('padding-right');
          if (s.ml) s.el.style.setProperty('margin-left', s.ml, s.mlP || '');
          else s.el.style.removeProperty('margin-left');
          if (s.mr) s.el.style.setProperty('margin-right', s.mr, s.mrP || '');
          else s.el.style.removeProperty('margin-right');
        }
      }

      // v0.8.123：還原 figcaption 字級下限 inline override
      if (Array.isArray(snapshot.captionFsSnap)) {
        for (const s of snapshot.captionFsSnap) {
          if (!s || !s.el) continue;
          if (s.fs) s.el.style.setProperty('font-size', s.fs, s.fsP || '');
          else s.el.style.removeProperty('font-size');
        }
      }

      // v0.7.179：還原 title font-size inline override
      if (snapshot.titleFsSnap) {
        const t = snapshot.titleFsSnap;
        if (t.fs) t.el.style.setProperty('font-size', t.fs, t.fsP || '');
        else t.el.style.removeProperty('font-size');
      }

      // v0.8.3：還原 hero 字級下限 inline override
      if (snapshot.heroFloorSnap) {
        const h = snapshot.heroFloorSnap;
        if (h.fs) h.el.style.setProperty('font-size', h.fs, h.fsP || '');
        else h.el.style.removeProperty('font-size');
      }

      // v0.7.225：還原 contrast guard 的 inline override（background-color
      // 還原 + per-carrier color 覆寫，通用 {el, prop, prev, prevP} entry）
      if (Array.isArray(snapshot.contrastBgSnap)) {
        for (const s of snapshot.contrastBgSnap) {
          if (!s || !s.el || !s.prop) continue;
          if (s.prev) s.el.style.setProperty(s.prop, s.prev, s.prevP || '');
          else s.el.style.removeProperty(s.prop);
        }
      }

      // v0.7.179：還原 WP constrained layout inline max-width override
      if (Array.isArray(snapshot.wpConstrained)) {
        for (const g of snapshot.wpConstrained) {
          if (!g || !g.el) continue;
          if (g.maxWidth) {
            g.el.style.setProperty('max-width', g.maxWidth, g.maxWidthPriority || '');
          } else {
            g.el.style.removeProperty('max-width');
          }
        }
      }

      // v0.7.93：還原 image gallery flex/grid containers 的原 inline style
      // v0.7.94：同陣列也含 gallery 內媒體直接子的 margin-bottom snapshot
      if (Array.isArray(snapshot.galleryFlex)) {
        for (const g of snapshot.galleryFlex) {
          if (!g || !g.el) continue;
          // gallery container 自身: 還原 display / height / min-height
          if (g.hasOwnProperty('display')) {
            for (const prop of ['display', 'height', 'min-height']) {
              const key = prop === 'min-height' ? 'minHeight' : prop;
              const value = g[key];
              const priority = g[key + 'Priority'];
              if (value) {
                g.el.style.setProperty(prop, value, priority || '');
              } else {
                g.el.style.removeProperty(prop);
              }
            }
          }
          // gallery 內媒體子: 還原 margin-bottom
          if (g.hasOwnProperty('marginBottom')) {
            if (g.marginBottom) {
              g.el.style.setProperty('margin-bottom', g.marginBottom, g.marginBottomPriority || '');
            } else {
              g.el.style.removeProperty('margin-bottom');
            }
          }
        }
      }

      // v0.8.137：還原 aspect-ratio box reset 的 inline override
      if (Array.isArray(snapshot.ratioBoxes)) {
        for (const r of snapshot.ratioBoxes) {
          if (!r || !r.el) continue;
          if (r.aspectRatio) r.el.style.setProperty('aspect-ratio', r.aspectRatio, r.aspectRatioPriority || '');
          else r.el.style.removeProperty('aspect-ratio');
        }
      }

      // v0.8.101：還原寬語意內容（table / pre）的 display / overflow-x / max-width
      // inline override（apply 時設的水平捲）。
      if (Array.isArray(snapshot.wideScroll)) {
        for (const w of snapshot.wideScroll) {
          if (!w || !w.el) continue;
          for (const prop of ['display', 'overflow-x', 'max-width']) {
            const key = prop === 'overflow-x' ? 'overflowX' : (prop === 'max-width' ? 'maxWidth' : prop);
            const value = w[key];
            if (value) w.el.style.setProperty(prop, value, w[key + 'Priority'] || '');
            else w.el.style.removeProperty(prop);
          }
        }
      }

      // v0.8.69：移除尚未觸發的 lazy content-img de-column listener（避免退出後
      // 圖載入仍在已 detach 的節點上塌欄 / listener 洩漏）。先清 listener 再還原
      // display，避免 restore 進行中 load 事件又補一筆塌欄。
      if (Array.isArray(snapshot.decolumnLoadCleanup)) {
        for (const { img, onLoad } of snapshot.decolumnLoadCleanup) {
          if (img && img.removeEventListener) img.removeEventListener('load', onLoad);
        }
      }
      // v0.8.66：還原 de-column flex/grid 容器的 display inline override
      if (Array.isArray(snapshot.textColFlex)) {
        for (const t of snapshot.textColFlex) {
          if (!t || !t.el) continue;
          if (t.display) {
            t.el.style.setProperty('display', t.display, t.displayPriority || '');
          } else {
            t.el.style.removeProperty('display');
          }
        }
      }
    }
  };

  NS.styler = styler;
})();
