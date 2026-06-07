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
  const INLINE_IMG_ATTR = 'data-jread-inline-img';
  const INLINE_IMG_MAX = 48;
  const PLAYER_ATTR = 'data-jread-player';

  // 預設值：等於「未設定」——對應的 CSS 不會注入（保留原站樣式）
  const DEFAULTS = {
    theme: 'light',
    fontSize: 18,
    contentWidth: 720,
    fontFamily: 'system-ui',
    // 字粗外觀。false = 細（antialiased / grayscale）= 預設;true = 粗（auto =
    // subpixel-antialiased）。用 smoothing 切換而非 font-weight—— CJK 字型在
    // macOS 上不同 weight 視覺差異不穩定，smoothing 模式差異明顯且跨字型穩定。
    boldText: false,
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
  //   sepia #2c5282（JRead primary-700）：在 #f4ecd8 底對比 > 6:1
  //   scrollThumb：v0.7.90 auto-hide scrollbar 顯色用，配 page bg 對比夠辨識
  //   又不過度搶眼。dark theme 用淺色 thumb、light/sepia 用深色 thumb。
  const THEMES = {
    light: { pageBg: '#ececec', articleBg: '#ffffff', text: null, link: '#1a73e8', scrollThumb: 'rgba(0, 0, 0, 0.3)', inlineCodeBg: 'rgba(0,0,0,0.06)', progressBar: '#4A90D9' },
    dark:  { pageBg: '#0b0b0b', articleBg: '#1a1a1a', text: '#d4d4d4', link: '#7fb5e6', scrollThumb: 'rgba(255, 255, 255, 0.3)', inlineCodeBg: 'rgba(255,255,255,0.1)', progressBar: '#7fb5e6' },
    sepia: { pageBg: '#cdb891', articleBg: '#f4ecd8', text: '#5b4636', link: '#2c5282', scrollThumb: 'rgba(91, 70, 54, 0.45)', inlineCodeBg: 'rgba(91,70,54,0.08)', progressBar: '#2c5282' }
  };

  function themeOf(name) {
    return THEMES[name] || THEMES.light;
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
  //   內部內容（jread 摸不到）、不驗 dark / sepia theme（`* { color: theme.text }`
  //   已蓋掉 token 色 + v0.7.164 已把 pre/code/blockquote bg 清 transparent，
  //   此 bug 結構上不存在）。
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
  function compositeBgOver(el, stopEl, baseColor, win) {
    const layers = [];
    let opaqueFound = false;
    let cur = el;
    while (cur && cur !== stopEl && cur.nodeType === 1) {
      const c = parseCssColor(win.getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 0.999) { opaqueFound = true; break; }
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
   下，必須排除。 */
[${ANCESTOR_ATTR}="1"] > *:not([${ANCESTOR_ATTR}="1"]):not([${ARTICLE_ATTR}="1"]):not(#__jread-toast-host) {
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
     v0.7.226：垂直 padding 48px → min(48px, 6vw)。同水平邏輯——手機上
     固定 48px 頂部白 + 40px margin 灰條合計 88px 才見第一行字（430pt probe
     實測）。6vw 與水平 padding 同係數：窄 viewport 下四邊 padding 等寬
     （430pt → ~26px），viewport >= 800px 維持 48px 桌面不變。 */
  padding: min(48px, 6vw) min(56px, 6vw) !important;
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
  color: ${theme.text || '#1a1a1a'} !important;
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
[${ARTICLE_ATTR}="1"] img:not(a > img):not([${PLAYER_ATTR}="1"]):not([${INLINE_IMG_ATTR}]),
[${ARTICLE_ATTR}="1"] video:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] picture:not([${PLAYER_ATTR}="1"]) {
  display: block !important;
  margin-bottom: 24px !important;
}
/* v0.7.88：媒體 max-height 限制——避免站把主圖原始尺寸塞到 reader card
   後 height: auto 計算出超大值（newtalk.tw 實機主圖 height=891 / cna 等
   類似結構），佔滿整屏甚至蓋住 promoted-title。90vh 留給標題與下方文字
   一些縫隙、又不過度限縮（90% viewport 高仍是大圖視覺）。 */
[${ARTICLE_ATTR}="1"] img:not(a > img):not([${PLAYER_ATTR}="1"]):not([${INLINE_IMG_ATTR}]),
[${ARTICLE_ATTR}="1"] video:not([${PLAYER_ATTR}="1"]),
[${ARTICLE_ATTR}="1"] picture:not([${PLAYER_ATTR}="1"]) {
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
[${ARTICLE_ATTR}="1"] [class*="ratio" i],
[${ARTICLE_ATTR}="1"] [class*="placeholder" i] {
  aspect-ratio: auto !important;
  padding-bottom: 0 !important;
  padding-top: 0 !important;
  height: auto !important;
  min-height: 0 !important;
}
/* placeholder 內部 wrapper 一併拉回 static flow：padding-bottom hack 的配套
   結構是「placeholder position:relative + 子層 position:absolute 填滿 padding
   區域」。styler 已把 img/video 強制 static（line ~303），但 img 與 placeholder
   之間若有中間 wrapper div 仍保持 absolute，該 div 不佔 flow 高度→文字疊在
   圖片上（CNBC DIV.imageContainer 結構實測）。清 padding hack 時一併清所有
   後代的 absolute positioning，讓圖片容器自然撐高度。 */
[${ARTICLE_ATTR}="1"] [class*="placeholder" i]:not([${PLAYER_ATTR}="1"]) * {
  position: static !important;
  top: auto !important;
  left: auto !important;
  right: auto !important;
  bottom: auto !important;
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
[${ARTICLE_ATTR}="1"] [class*="object-fit"]::after,
[${ARTICLE_ATTR}="1"] [class*="ratio" i]::before,
[${ARTICLE_ATTR}="1"] [class*="ratio" i]::after {
  content: none !important;
  display: none !important;
  padding-bottom: 0 !important;
  height: 0 !important;
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
}
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
[${ARTICLE_ATTR}="1"] *:not(figure):not(figcaption):not(summary):not(blockquote):not(code):not(pre):not(table):not(thead):not(tbody):not(tr):not(th):not(td):not(mark):not(kbd):not([${PLAYER_ATTR}="1"]) {
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
[${ARTICLE_ATTR}="1"] *:not(a):not(code):not(pre):not(table):not(thead):not(tbody):not(tr):not(th):not(td):not(mark):not(kbd):not(figcaption):not([${PLAYER_ATTR}="1"]) {
  color: inherit !important;
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
[${ARTICLE_ATTR}="1"] *:not(figure):not(figcaption):not(summary):not(blockquote):not(code):not(pre):not(table):not(thead):not(tbody):not(tr):not(th):not(td):not(mark):not(kbd):not(hr):not([${PLAYER_ATTR}="1"]) {
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
    const SPAN_TEXT_SEL = `[${ARTICLE_ATTR}="1"] span` +
      `:not([class*="icon"])` +
      `:not([class*="material-"])` +
      `:not([class^="fa-"])` +
      `:not([class*=" fa-"])` +
      `:not([class*="emoji"])` +
      `:not([class*="badge"])` +
      `:not(pre *)` +
      `:not(code *)` +
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
    if (opts.boldText) {
      // 使用者選「粗」—— 反轉 reader card 預設的 antialiased，回到 macOS Chrome
      // 預設 auto = subpixel-antialiased，視覺較粗。CJK 字型 weight 視覺差異
      // 不可靠，smoothing 模式差異反而明顯且穩定（macOS 限定，其他 OS 無效）。
      userOverrides += `
html [${ARTICLE_ATTR}="1"] {
  -webkit-font-smoothing: auto !important;
  -moz-osx-font-smoothing: auto !important;
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
      userOverrides += `
[${ARTICLE_ATTR}="1"] p,
[${ARTICLE_ATTR}="1"] ul,
[${ARTICLE_ATTR}="1"] ol,
[${ARTICLE_ATTR}="1"] blockquote {
  margin-bottom: ${opts.paragraphSpacing}em !important;
}
[${ARTICLE_ATTR}="1"] [data-jread-fb-para="1"] {
  margin-top: ${opts.paragraphSpacing}em !important;
  margin-bottom: ${opts.paragraphSpacing}em !important;
}`;
    }
    if (overrides.theme && theme.text) {
      // dark / sepia：覆蓋文字色（light 的 text 是 null，不注入）
      userOverrides += `
html.${HTML_CLASS} body {
  color: ${theme.text} !important;
}
[${ARTICLE_ATTR}="1"],
[${ARTICLE_ATTR}="1"] *:not(figcaption) {
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
      userOverrides += `
html.${HTML_CLASS} [${ARTICLE_ATTR}="1"] blockquote,
html.${HTML_CLASS} [${ARTICLE_ATTR}="1"] pre,
html.${HTML_CLASS} [${ARTICLE_ATTR}="1"] code {
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
    if (opts.pagedMode) {
      userOverrides += `
/* 翻頁模式：鎖住文件垂直卷動（內容全在 fixed 容器內水平分頁）。
   overscroll-behavior 擋 macOS 觸控板水平 swipe 的歷史導航誤觸。 */
html.${HTML_CLASS}, html.${HTML_CLASS} body {
  overflow: hidden !important;
  height: 100% !important;
  overscroll-behavior: none !important;
}
/* 滿版固定容器：left/right 0 + margin auto + max-width 讓桌面寬視窗時
   頁面寬度 cap 在版心 + padding（置中書頁感），手機窄視窗自然滿版。
   top/bottom 0 錨定取代 height: 100vh——iOS Safari 網址列收合時 fixed
   元素隨 layout viewport 調整，不吃 vh 單位的動態視窗誤差。
   padding 與卡片模式同公式（min(48px,6vw) / min(56px,6vw)），column-gap
   = 水平 padding × 2，維持「stride = clientWidth」恆等式。 */
html [${ARTICLE_ATTR}="1"] {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: auto !important;
  height: auto !important;
  max-width: calc(${contentWidth}px + min(56px, 6vw) * 2) !important;
  margin: 0 auto !important;
  padding: min(48px, 6vw) min(56px, 6vw) !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  column-width: ${contentWidth}px !important;
  column-count: auto !important;
  column-gap: calc(min(56px, 6vw) * 2) !important;
  column-fill: auto !important;
  overflow: hidden !important;
}
/* 媒體單頁化：高度 cap 在「頁面內容高 − caption 餘裕 120px」、等比縮放，
   搭配 break-inside: avoid 整塊不跨頁切割（高於一頁的元素 spec fallback
   仍會切，但 max-height 已保證 img/video 本體不超頁）。120px ≈ 3 行圖說
   + margin——56px 實測不夠（chinatalk 直式書封圖 + 圖說的 figure 總高
   818 > 頁 796，break-inside 對「高於 fragmentainer 的元素」失效強制切割）。
   100vh 與 100dvh 雙宣告：支援 dvh 的引擎（iOS 16.4+）用動態視窗高，
   舊引擎 fallback vh。 */
html [${ARTICLE_ATTR}="1"] img,
html [${ARTICLE_ATTR}="1"] video,
html [${ARTICLE_ATTR}="1"] svg,
html [${ARTICLE_ATTR}="1"] iframe {
  max-height: calc(100vh - min(48px, 6vw) * 2 - 120px) !important;
  max-height: calc(100dvh - min(48px, 6vw) * 2 - 120px) !important;
  width: auto !important;
  max-width: 100% !important;
  object-fit: contain !important;
}
html [${ARTICLE_ATTR}="1"] figure,
html [${ARTICLE_ATTR}="1"] picture,
html [${ARTICLE_ATTR}="1"] img,
html [${ARTICLE_ATTR}="1"] video,
html [${ARTICLE_ATTR}="1"] iframe {
  break-inside: avoid;
}
/* 頁碼指示（paged-mode.js 建立 / 更新文字）：固定底部置中、不擋互動。
   色用中性灰——白卡 / 黑卡 / 米卡上都可讀，不依賴 theme 欄位。 */
#__jread-page-indicator {
  position: fixed;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  font: 11px/1 ui-monospace, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  color: rgba(128, 128, 128, 0.95);
  z-index: 2147483647;
  pointer-events: none;
  user-select: none;
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

  const PROGRESS_ID = '__jread-progress';
  let progressEl = null;
  function onScrollProgress() {
    if (!progressEl) return;
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
        // boldText boolean — true = 粗 (subpixel-antialiased) / false = 細
        // (antialiased)。預設 false（細）。
        boldText: s.boldText === true,
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
        pagedMode: s.pagedMode === true
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

      let styleEl = document.getElementById(STYLE_ID);
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(styleEl);
      }
      styleEl.textContent = buildCss(theme, opts, overrides);

      articleEl.setAttribute(ARTICLE_ATTR, '1');

      const inlineImgs = [];
      for (const img of articleEl.querySelectorAll('img')) {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        let isInline = w > 0 && w <= INLINE_IMG_MAX && h > 0 && h <= INLINE_IMG_MAX;
        // v0.7.214：natural 尺寸對「無 intrinsic size 的 SVG」不可靠——Chrome
        // 對只有 viewBox 的 SVG 回報 CSS replaced element 預設 150×150（X/
        // Twitter 的 Twemoji emoji SVG 實測命中），高解析 emoji PNG（Twemoji
        // PNG 原檔 72×72）也會超過上限。rendered 尺寸才是「這張圖在文中是
        // icon / emoji」的視覺事實：natural 判定 miss 時 fallback 量 rect，
        // 兩維皆 > 0 且 <= INLINE_IMG_MAX 即標 inline。只在 miss 時量、
        // 避免對每張內容圖都 force layout。
        if (!isInline) {
          const r = img.getBoundingClientRect();
          isInline = r.width > 0 && r.width <= INLINE_IMG_MAX &&
                     r.height > 0 && r.height <= INLINE_IMG_MAX;
        }
        if (isInline) {
          img.setAttribute(INLINE_IMG_ATTR, '1');
          inlineImgs.push(img);
        }
      }

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
        container.setAttribute(PLAYER_ATTR, '1');
        playerMarked.push(container);
        for (const el of container.querySelectorAll('*')) {
          el.setAttribute(PLAYER_ATTR, '1');
          playerMarked.push(el);
        }
      }

      const ancestors = markAncestors(articleEl);

      const htmlHadClass = document.documentElement.classList.contains(HTML_CLASS);
      document.documentElement.classList.add(HTML_CLASS);

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

      // v0.7.90：install scroll listener（auto-hide scrollbar）。passive 確保
      // 不卡 scroll 效能；window 層級捕捉文件捲動事件。重複 apply 時 remove
      // 後 add 防止 listener 累積（瀏覽器 dedupe 但保險，restore 也對稱乾淨）。
      window.removeEventListener('scroll', onScrollFlash, { passive: true });
      window.addEventListener('scroll', onScrollFlash, { passive: true });

      // 閱讀進度條
      progressEl = document.getElementById(PROGRESS_ID);
      if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.id = PROGRESS_ID;
        (document.head?.parentElement || document.documentElement).appendChild(progressEl);
      }
      window.removeEventListener('scroll', onScrollProgress, { passive: true });
      window.addEventListener('scroll', onScrollProgress, { passive: true });
      onScrollProgress();

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

      // Pangu spacing：CJK ↔ 英數字之間自動補空白。設定預設 true，使用者可
      // 到 options 取消。一次性掃完整 articleEl + 起 MutationObserver 接後續
      // 動態注入內容（SPA / lazy-load 留言、推薦、晚到段落等）。
      const panguEnabled = s.pangu !== false;
      const panguSnap = panguEnabled ? panguInstall(articleEl) : null;

      return { articleEl, ancestors, htmlHadClass, firstInk, firstInkPriorMt, firstInkPriorMtPriority, ancestorPaddingSnap, negMarginSnap, titleFsSnap, galleryFlex, wpConstrained, panguSnap, inlineImgs, playerMarked, contrastBgSnap };
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
      if (Array.isArray(snapshot.playerMarked)) {
        for (const el of snapshot.playerMarked) {
          if (el && el.removeAttribute) el.removeAttribute(PLAYER_ATTR);
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

      // v0.7.179：還原 title font-size inline override
      if (snapshot.titleFsSnap) {
        const t = snapshot.titleFsSnap;
        if (t.fs) t.el.style.setProperty('font-size', t.fs, t.fsP || '');
        else t.el.style.removeProperty('font-size');
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
    }
  };

  NS.styler = styler;
})();
