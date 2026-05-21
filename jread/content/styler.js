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
    lineHeight: 1.7,
    // 中英文字之間自動補空白（盤古之白）。預設 true—— 大部分台灣 / 港澳 / 中文
    // 讀者習慣這種視覺節奏，原始網站常缺空格（特別是 CMS / SPA 編輯器寫入時）。
    // 使用者可到 options 取消。詳見下方 pangu module。
    pangu: true
  };

  // 主題配色：僅 dark / sepia 會注入文字 + 卡片底色覆寫；light 不碰原站色
  //   link：dark / sepia 下因 `* { color: X }` 吞掉原站 link 顏色，導致內文連結
  //   跟正文完全同色無法辨識。必須回補一個在該 theme 下夠對比的 link 色。
  //   light 不注入（light 連文字色都不注入，保留原站 link 色）。
  //   dark #7fb5e6：在 #1a1a1a 底對比 > 7:1
  //   sepia #2c5282（JRead primary-700）：在 #f4ecd8 底對比 > 6:1
  //   scrollThumb：v0.7.90 auto-hide scrollbar 顯色用，配 page bg 對比夠辨識
  //   又不過度搶眼。dark theme 用淺色 thumb、light/sepia 用深色 thumb。
  const THEMES = {
    light: { pageBg: '#ececec', articleBg: '#ffffff', text: null, link: null, scrollThumb: 'rgba(0, 0, 0, 0.3)' },
    dark:  { pageBg: '#0b0b0b', articleBg: '#1a1a1a', text: '#d4d4d4', link: '#7fb5e6', scrollThumb: 'rgba(255, 255, 255, 0.3)' },
    sepia: { pageBg: '#cdb891', articleBg: '#f4ecd8', text: '#5b4636', link: '#2c5282', scrollThumb: 'rgba(91, 70, 54, 0.45)' }
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
[${ARTICLE_ATTR}="1"] img,
[${ARTICLE_ATTR}="1"] video {
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
   本身已是 block container、img 在內部 block 只是視覺正確、不影響原 layout。 */
[${ARTICLE_ATTR}="1"] img:not(a > img),
[${ARTICLE_ATTR}="1"] video,
[${ARTICLE_ATTR}="1"] picture {
  display: block !important;
}
/* v0.7.88：媒體 max-height 限制——避免站把主圖原始尺寸塞到 reader card
   後 height: auto 計算出超大值（newtalk.tw 實機主圖 height=891 / cna 等
   類似結構），佔滿整屏甚至蓋住 promoted-title。90vh 留給標題與下方文字
   一些縫隙、又不過度限縮（90% viewport 高仍是大圖視覺）。 */
[${ARTICLE_ATTR}="1"] img:not(a > img),
[${ARTICLE_ATTR}="1"] video,
[${ARTICLE_ATTR}="1"] picture {
  max-height: 90vh !important;
  object-fit: contain !important;
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
  /* v0.7.99：figure 與下方主文內容拉開間距。BBC Culture 類站點原站 CSS
     '.bOanuU' 之類 styled-components hash class 把 figure margin 砍光，
     reader mode 下 figcaption 正下方緊貼下一段 p、視覺壓在一起。
     1.5em 相對字級縮放（讓使用者調字級時間距同步），不寫死 px 避免
     「字小時間距過寬 / 字大時間距太擠」。 v0.7.100 加 margin-top 同樣
     1.5em，解 figure 上方緊貼前一段 p 的對稱問題。 */
  margin-top: 1.5em !important;
  margin-bottom: 1.5em !important;
}
/* v0.7.100：h1-h6 上下 margin。BBC Culture 類站點原站 CSS 把 heading 的
   margin 全砍光（styled-components hash class 預設 margin: 0），reader mode 下
   段落 p 結束 → h2 標題 → 下一段 p 三者直接接壤、無視覺斷層、難辨章節。
   通則：h2-h6 加大 margin-top（章節分隔）+ 較小 margin-bottom（標題與其
   描述 / 首段較緊密）。h1 主標題已由 first-child rule 強制 margin-top: 0
   不衝突，這條對 h1 加 margin-top 也不傷（first-child rule specificity 較高）。
   1.5em / 0.5em 用相對字級單位，使用者調字級時間距同步縮放。 */
[${ARTICLE_ATTR}="1"] h1,
[${ARTICLE_ATTR}="1"] h2,
[${ARTICLE_ATTR}="1"] h3,
[${ARTICLE_ATTR}="1"] h4,
[${ARTICLE_ATTR}="1"] h5,
[${ARTICLE_ATTR}="1"] h6 {
  margin-top: 1.5em !important;
  margin-bottom: 0.5em !important;
}
/* v0.7.102：p / ul / ol / blockquote 段落間距。BBC styled-components 同樣把
   p / list / quote 的 margin 砍光（hash class margin: 0），三段 p 緊貼。
   通則：block-level 內容元素加 margin-bottom 1em（相對字級縮放），與 v0.6.0
   baseline 「不動 typography」精神一致——只動 spacing 不動字型 / 顏色 / 行高。
   1em 是各家瀏覽器 user-agent stylesheet 對 p 的預設 margin，貼近大眾預期；
   多數新聞站本來就有此 margin、覆寫差別極小，BBC 從 0 變 1em 是明顯改善。 */
[${ARTICLE_ATTR}="1"] p,
[${ARTICLE_ATTR}="1"] ul,
[${ARTICLE_ATTR}="1"] ol,
[${ARTICLE_ATTR}="1"] blockquote {
  margin-bottom: 1em !important;
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
[${ARTICLE_ATTR}="1"] * {
  float: none !important;
}
[${ARTICLE_ATTR}="1"] img,
[${ARTICLE_ATTR}="1"] picture,
[${ARTICLE_ATTR}="1"] video,
[${ARTICLE_ATTR}="1"] figure,
[${ARTICLE_ATTR}="1"] iframe,
[${ARTICLE_ATTR}="1"] table,
[${ARTICLE_ATTR}="1"] blockquote,
[${ARTICLE_ATTR}="1"] pre {
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
    const SPAN_TEXT_SEL = `[${ARTICLE_ATTR}="1"] span` +
      `:not([class*="icon"])` +
      `:not([class*="material-"])` +
      `:not([class^="fa-"])` +
      `:not([class*=" fa-"])` +
      `:not([class*="emoji"])` +
      `:not([class*="badge"])`;
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
    const BODY_TEXT_SEL =
      `[${ARTICLE_ATTR}="1"],` +
      `[${ARTICLE_ATTR}="1"] p,` +
      `[${ARTICLE_ATTR}="1"] li,` +
      `[${ARTICLE_ATTR}="1"] blockquote,` +
      `[${ARTICLE_ATTR}="1"] dd,` +
      `[${ARTICLE_ATTR}="1"] dt,` +
      `[${ARTICLE_ATTR}="1"] td,` +
      `[${ARTICLE_ATTR}="1"] th,` +
      `[${ARTICLE_ATTR}="1"] caption,` +
      SPAN_TEXT_SEL;
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
      // Probe 數值：站點 blockquote.blockquote 套 bg #f5f5f5、styler 覆寫 color
      // #d4d4d4 → 對比 1.38:1（WCAG AA 需 4.5:1）；inject 修法 transparent 後
      // 透出 reader card #1a1a1a → 對比 11.74:1（AAA 通過）。
      // 副作用：light theme 不注入（既有 preserve 設計仍有效）。dark / sepia
      // 下 blockquote 失去「淺底突顯」視覺、但 border-left / padding / ::before
      // 引號圖示 contrast 都 >= 13:1 仍可辨識為引文。
      // selector specificity (0,2,1) > 站點常見 `blockquote.blockquote` (0,1,1)
      // / `.quote-block` (0,1,0) 等 rule。
      userOverrides += `
html.${HTML_CLASS} [${ARTICLE_ATTR}="1"] blockquote {
  background-color: transparent !important;
  background-image: none !important;
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

  // v0.7.90 auto-hide scrollbar：scroll 事件觸發後立刻 set
  // [data-jread-scrolling="1"] on html、800ms 無新事件後清除。CSS 端用此
  // attr 切換 thumb 色，搭配 0.3s transition 達到 fade-in/out。
  // 模組層級 timer + listener function，apply 時 install / restore 時 remove。
  // 同個 function reference 才能正確 add/remove，所以不能用 closure 重新建構。
  const SCROLLING_ATTR = 'data-jread-scrolling';
  const SCROLL_HIDE_DELAY = 800;
  let scrollHideTimer = null;
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
    const stop = document.body || document.documentElement;
    while (p && p !== stop) {
      p.setAttribute(ANCESTOR_ATTR, '1');
      ancestors.push(p);
      p = p.parentElement;
    }
    return ancestors;
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

  function panguize(s) {
    return s.replace(PANGU_RE_CJK_ALNUM, '$1 $2').replace(PANGU_RE_ALNUM_CJK, '$1 $2');
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
        // lineHeight：clamp [1.0, 3.0]（unitless ratio；< 1 字會重疊、> 3 段落破碎）
        lineHeight: Number.isFinite(rawLh) && rawLh > 0
          ? Math.min(3.0, Math.max(1.0, rawLh))
          : DEFAULTS.lineHeight
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

      // v0.7.90：install scroll listener（auto-hide scrollbar）。passive 確保
      // 不卡 scroll 效能；window 層級捕捉文件捲動事件。重複 apply 時 remove
      // 後 add 防止 listener 累積（瀏覽器 dedupe 但保險，restore 也對稱乾淨）。
      window.removeEventListener('scroll', onScrollFlash, { passive: true });
      window.addEventListener('scroll', onScrollFlash, { passive: true });

      // v0.7.91：install SPACE keydown listener（capture phase 比原站 bubble
      // listener 早攔，比原站 keydown 攔截先收到 SPACE）。重複 apply 時保險先 remove。
      window.removeEventListener('keydown', onSpaceScroll, true);
      window.addEventListener('keydown', onSpaceScroll, true);

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

      // Pangu spacing：CJK ↔ 英數字之間自動補空白。設定預設 true，使用者可
      // 到 options 取消。一次性掃完整 articleEl + 起 MutationObserver 接後續
      // 動態注入內容（SPA / lazy-load 留言、推薦、晚到段落等）。
      const panguEnabled = s.pangu !== false;
      const panguSnap = panguEnabled ? panguInstall(articleEl) : null;

      return { articleEl, ancestors, htmlHadClass, firstInk, firstInkPriorMt, firstInkPriorMtPriority, galleryFlex, panguSnap };
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

      // v0.7.90：移除 scroll listener、清 timer 與 scrolling attr，避免閱讀
      // 模式關閉後仍在 html 留下 [data-jread-scrolling] / 殘留 timer 觸發 attr 設定。
      window.removeEventListener('scroll', onScrollFlash, { passive: true });
      if (scrollHideTimer) {
        clearTimeout(scrollHideTimer);
        scrollHideTimer = null;
      }
      document.documentElement.removeAttribute(SCROLLING_ATTR);

      // v0.7.91：移除 SPACE keydown listener（避免關閉 reader mode 後 SPACE
      // 仍被 jread 攔截）。capture phase listener 第三個參數須為 true 才能正確 dedup。
      window.removeEventListener('keydown', onSpaceScroll, true);

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

      // Pangu spacing 還原：停 MutationObserver、把改過的 text node 還回原值
      // 必須在移除 ARTICLE_ATTR 之後（restore 順序對 DOM 副作用沒有依賴，但
      // panguRestore 內部只看 snapshot.changes，不依賴 reader mode attr）
      if (snapshot.panguSnap) {
        panguRestore(snapshot.panguSnap);
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
    }
  };

  NS.styler = styler;
})();
