// JRead — 閱讀模式排版（瘦身版 / c 路線）
// 設計哲學：**盡量不動原站的內文排版**（font-family / font-size / heading margin /
// p margin / list style / link color / blockquote / code 等一律不覆寫），只提供：
//   1. 讀者卡片容器（article card）——版心、背景、圓角、陰影、置中
//   2. 頁面 / 祖先鏈 reset——讓主文能脫離原 2-col layout 限制
//   3. 必要的「破壞站點 hack」——aspect-ratio placeholder、圖片超出版心
//   4. 使用者 override——只在使用者**改過**預設設定（theme/fontSize/fontFamily/
//      lineHeight）時注入對應 CSS，預設值不動
// restore() 移除 style 元素與 attribute 即可完整還原，不動任何原 inline style。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  const STYLE_ID = '__jread-style';
  const HTML_CLASS = '__jread-active';
  const ARTICLE_ATTR = 'data-jread-active';
  const ANCESTOR_ATTR = 'data-jread-ancestor';

  // 預設值：等於「未設定」——對應的 CSS 不會注入（保留原站樣式）
  const DEFAULTS = {
    theme: 'light',
    fontSize: 18,
    contentWidth: 720,
    fontFamily: 'system-ui',
    lineHeight: 1.7
  };

  // 主題配色：僅 dark / sepia 會注入文字 + 卡片底色覆寫；light 不碰原站色
  //   link：dark / sepia 下因 `* { color: X }` 吞掉原站 link 顏色，導致內文連結
  //   跟正文完全同色無法辨識。必須回補一個在該 theme 下夠對比的 link 色。
  //   light 不注入（light 連文字色都不注入，保留原站 link 色）。
  //   dark #7fb5e6：在 #1a1a1a 底對比 > 7:1
  //   sepia #2c5282（JRead primary-700）：在 #f4ecd8 底對比 > 6:1
  const THEMES = {
    light: { pageBg: '#ececec', articleBg: '#ffffff', text: null, link: null },
    dark:  { pageBg: '#0b0b0b', articleBg: '#1a1a1a', text: '#d4d4d4', link: '#7fb5e6' },
    sepia: { pageBg: '#cdb891', articleBg: '#f4ecd8', text: '#5b4636', link: '#2c5282' }
  };

  function themeOf(name) {
    return THEMES[name] || THEMES.light;
  }

  function buildCss(theme, opts, overrides) {
    const { contentWidth } = opts;

    // ---- 骨架：頁面 reset + 祖先鏈 reset + 卡片容器（永遠注入）----
    const base = `
/* 補 cleaner hide 漏洞：cleaner 只設 inline style.display = 'none' 無
   !important，站點 JS（例如商周 .postnav.fixed 的 scroll handler 主動
   el.style.display = 'block'）會把 inline display 整個覆寫掉、priority
   被清除。stylesheet 的 !important 優先級 > inline 無 priority 值，是
   browser 層級的勝利機制，擋得住 JS 再次覆寫。通則對付任何站點
   scroll / resize / timer 類 handler 重設 hide 過元素 display 的情境。 */
[data-jread-hidden="1"] {
  display: none !important;
}
html.${HTML_CLASS} {
  background: ${theme.pageBg} !important;
}
html.${HTML_CLASS} body {
  background: ${theme.pageBg} !important;
  margin: 0 !important;
  padding: 0 !important;
  max-width: none !important;
  width: auto !important;
  min-width: 0 !important;
  overflow-x: hidden !important;
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
/* 讀者卡片：版心、置中、背景、圓角、陰影。刻意不設 font-family / font-size
   / line-height / color——保留原站字體與排版。 */
[${ARTICLE_ATTR}="1"] {
  box-sizing: border-box !important;
  max-width: ${contentWidth}px !important;
  width: auto !important;
  min-height: 0 !important;
  height: auto !important;
  margin: 40px auto !important;
  padding: 48px 56px !important;
  background: ${theme.articleBg} !important;
  background-image: none !important;
  border-radius: 8px !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08) !important;
  float: none !important;
  position: static !important;
  transform: none !important;
}
/* 消除頂端留白：第一個 direct child 清 margin-top / padding-top。
   JS 端另外會對「第一個 h1-h4/p」設 margin-top: 0 inline（覆蓋深層 CMS 寫死的值） */
[${ARTICLE_ATTR}="1"] > *:first-child {
  margin-top: 0 !important;
  padding-top: 0 !important;
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
}
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
[${ARTICLE_ATTR}="1"] img,
[${ARTICLE_ATTR}="1"] video {
  position: static !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
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
[${ARTICLE_ATTR}="1"] [class*="placeholder"] {
  aspect-ratio: auto !important;
  padding-bottom: 0 !important;
  padding-top: 0 !important;
  height: auto !important;
  min-height: 0 !important;
}
/* [class*="placeholder"] 解釋：lazy-load wrapper 慣例命名（today.line.me
   實機 Jimmy 截圖揭穿 div.placeholder style="padding-top:75.25%" 撐
   aspect-ratio 4:3 placeholder）。padding-top 是 padding-bottom hack 的
   variant（兩者效果一樣，撐父寬度的固定比例高度）。為 padding-bottom hack
   配套加 padding-top:0 第二維度 reset，覆蓋兩種寫法。 */
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
[${ARTICLE_ATTR}="1"] [class*="object-fit"]::after {
  content: none !important;
  display: none !important;
  padding-bottom: 0 !important;
  height: 0 !important;
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
[${ARTICLE_ATTR}="1"] [class*="icon-wrapper"] img:not(a > img) {
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
}
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
  flex: initial !important;
  padding: 0 !important;
}
/* padding: 0 解釋：原站 Bootstrap col 標準 gutter（padding-left/right: 15px）
   或客製化的 padding（businessweekly.com.tw .col-md-7 padding-right: 115px
   給右欄 sidebar 留白）在 reader mode 下會把 col 內容擠在 col 寬度的子集
   內，造成「主圖偏左、寬度不滿」破版。我們已 width: auto + float: none +
   flex: initial 把 col 退化成 block 流排、padding 已失 grid gutter 意義，可
   清。businessweekly blog 主圖（497px wide 卡在 col 內 padding-right 115px
   後）修法：清 padding 後圖回到 card 完整內寬 608px。 */
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
[${ARTICLE_ATTR}="1"] *:not(figure):not(figcaption):not(summary):not(blockquote):not(code):not(pre):not(table):not(thead):not(tbody):not(tr):not(th):not(td):not(mark):not(kbd) {
  background-color: transparent !important;
  background-image: none !important;
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
[${ARTICLE_ATTR}="1"] *:not(figure):not(figcaption):not(summary):not(blockquote):not(code):not(pre):not(table):not(thead):not(tbody):not(tr):not(th):not(td):not(mark):not(kbd):not(hr) {
  border-width: 0 !important;
  left: auto !important;
  right: auto !important;
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
   max-width 限縮上限，width:auto / 顯式 width 仍照原值算。 */
[${ARTICLE_ATTR}="1"] * {
  max-width: 100% !important;
}
/* 強制 block flow 置中：原站常用 float / 負 margin / 偏移把媒體放到
   sidebar 區或文繞圖（cna.com.tw figure.floatImg.center class 名字面上是
   「float image」，原站 CSS 給 float: right 等讓主圖偏右配合左側 sidebar
   layout）。reader mode 單欄 card 沒有 sidebar 區、float / 不對稱 margin
   會把媒體推出版心造成偏移破版。對 reader card 內所有後代強制：
     float: none——禁止文繞圖類偏移；
     margin-left/right: auto——若元素 width 小於 parent 自動水平置中。
   注意只強制 left/right margin，top/bottom 保留原值（垂直節奏交給原站 /
   styler 既有 first-child margin reset 處理）。對 inline / inline-block
   元素 margin auto 是 no-op；對 block 元素是水平置中。對保留語意 figure /
   blockquote 等也合理（這些本來就應該置中或無 float）。 */
[${ARTICLE_ATTR}="1"] * {
  float: none !important;
  margin-left: auto !important;
  margin-right: auto !important;
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
`;

    // ---- 使用者 override：僅在非預設值才注入 ----
    // body text selector list（不含 heading h1-h6——保留原站標題大小分級；
    // v0.6.0 baseline 精神「預設值保留原站」在此仍成立：DEFAULT 分支完全
    // 不走到這裡）。descendant 展開必要性：BBC / NYT / Guardian 等站點給
    // `<p>`、`<li>`、`<blockquote>` 用 class rule 直接鎖死 font-size /
    // line-height / font-family（例：BBC `.HooNV { font-size: 18px;
    // line-height: 26px; font-family: "BBC Reith Serif" }`）——只對 article
    // 本身設 font-size 會被後代自己的 rule 截斷 inheritance、override 失效。
    // 列舉常見 body text 元素才能穿透站點 class rule 的 specificity。
    const BODY_TEXT_SEL =
      `[${ARTICLE_ATTR}="1"],` +
      `[${ARTICLE_ATTR}="1"] p,` +
      `[${ARTICLE_ATTR}="1"] li,` +
      `[${ARTICLE_ATTR}="1"] blockquote,` +
      `[${ARTICLE_ATTR}="1"] figcaption,` +
      `[${ARTICLE_ATTR}="1"] dd,` +
      `[${ARTICLE_ATTR}="1"] dt`;
    let userOverrides = '';
    if (overrides.fontSize) {
      // 同步注入 line-height：字級改了行高必須跟著縮放，否則原站用 px 鎖死的
      // 行高（例：Medium `.pi { line-height: 32px }` 配 20px 字級 = 1.6 倍）
      // 在字級被調小後變成過寬行距（32/16 = 2.0）。使用 opts.lineHeight
      // （預設 1.7 或使用者自調值），unitless 相對字級自動縮放。v0.6.0
      // baseline 「預設值不動原站」精神仍保留——使用者**完全沒改任何
      // override** 時 userOverrides 為空、DEFAULT 分支不走此路徑；只有
      // 使用者主動改字級才連帶動行高。
      userOverrides += `
${BODY_TEXT_SEL} {
  font-size: ${opts.fontSize}px !important;
  line-height: ${opts.lineHeight} !important;
}`;
    }
    if (overrides.fontFamily) {
      userOverrides += `
${BODY_TEXT_SEL} {
  font-family: ${opts.fontFamily}, -apple-system, "Noto Sans TC", "PingFang TC", system-ui, sans-serif !important;
}`;
    }
    if (overrides.lineHeight && !overrides.fontSize) {
      // fontSize 已改過時 line-height 已連帶注入；這裡只處理「只改 lineHeight
      // 沒改 fontSize」的獨立分支，避免 CSS 重複 rule。
      userOverrides += `
${BODY_TEXT_SEL} {
  line-height: ${opts.lineHeight} !important;
}`;
    }
    if (overrides.theme && theme.text) {
      // dark / sepia：覆蓋文字色（light 的 text 是 null，不注入）
      userOverrides += `
html.${HTML_CLASS} body {
  color: ${theme.text} !important;
}
[${ARTICLE_ATTR}="1"],
[${ARTICLE_ATTR}="1"] * {
  color: ${theme.text} !important;
}`;
      // 連結色回補：上面 `* { color: X }` 會吞掉原站 link 色。在 dark / sepia
      // 底下若沒有針對性 a 規則，連結跟正文完全同色無法辨識。加粗底線做雙通道
      // 差異化（顏色 + underline），連 a 內包的 <em>/<strong>/<code> 也要補。
      userOverrides += `
[${ARTICLE_ATTR}="1"] a,
[${ARTICLE_ATTR}="1"] a * {
  color: ${theme.link} !important;
}
[${ARTICLE_ATTR}="1"] a {
  text-decoration: underline !important;
  text-underline-offset: 2px !important;
  text-decoration-thickness: 1px !important;
}`;
    }

    return base + userOverrides;
  }

  function markAncestors(articleEl) {
    const ancestors = [];
    let p = articleEl.parentElement;
    const stop = document.body || document.documentElement;
    while (p && p !== stop) {
      p.setAttribute(ANCESTOR_ATTR, '1');
      ancestors.push(p);
      p = p.parentElement;
    }
    return ancestors;
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
      const rawFs = Number(s.fontSize);
      const opts = {
        fontSize: Number.isFinite(rawFs) && rawFs >= 0 ? rawFs : DEFAULTS.fontSize,
        contentWidth: Number(s.contentWidth) || DEFAULTS.contentWidth,
        fontFamily: s.fontFamily || DEFAULTS.fontFamily,
        lineHeight: Number(s.lineHeight) || DEFAULTS.lineHeight
      };
      const theme = themeOf(s.theme);

      // 判斷哪些是「使用者改過」→ 需要 override；預設值 / Auto 不動原站
      //   fontSize = 0 (Auto) → 不注入（跟 DEFAULT 行為一致，都保留原站）
      //   fontSize = DEFAULT (18) → 不注入
      //   fontSize = 其他數字（12~32） → 注入 px 值
      const overrides = {
        theme: (s.theme || DEFAULTS.theme) !== DEFAULTS.theme,
        fontSize: opts.fontSize > 0 && opts.fontSize !== DEFAULTS.fontSize,
        fontFamily: opts.fontFamily !== DEFAULTS.fontFamily,
        lineHeight: opts.lineHeight !== DEFAULTS.lineHeight
      };

      let styleEl = document.getElementById(STYLE_ID);
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(styleEl);
      }
      styleEl.textContent = buildCss(theme, opts, overrides);

      articleEl.setAttribute(ARTICLE_ATTR, '1');
      const ancestors = markAncestors(articleEl);

      const htmlHadClass = document.documentElement.classList.contains(HTML_CLASS);
      document.documentElement.classList.add(HTML_CLASS);

      // 消除頂端留白：第一個 h1-h4/p（深層後代也算）margin-top: 0 inline。
      // 必須用 JS：站點 CSS 常給深層 heading 寫死 margin-top，純 CSS 的
      // `:first-child` 只能摸到 article 的 direct child，摸不到「包在 wrapper
      // 裡的 H1」。
      let firstInk = articleEl.querySelector('h1, h2, h3, h4, p');
      let firstInkPriorMt = '';
      let firstInkPriorMtPriority = '';
      if (firstInk) {
        firstInkPriorMt = firstInk.style.getPropertyValue('margin-top');
        firstInkPriorMtPriority = firstInk.style.getPropertyPriority('margin-top');
        firstInk.style.setProperty('margin-top', '0', 'important');
      }

      return { articleEl, ancestors, htmlHadClass, firstInk, firstInkPriorMt, firstInkPriorMtPriority };
    },

    /**
     * 還原 apply() 所做的所有變更。
     * @param {Element} _articleEl 相容舊 API，實際從 snapshot 讀
     * @param {object} snapshot apply() 的回傳值
     */
    restore(_articleEl, snapshot) {
      if (!snapshot) return;
      const styleEl = document.getElementById(STYLE_ID);
      if (styleEl) styleEl.remove();

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
    }
  };

  NS.styler = styler;
})();
