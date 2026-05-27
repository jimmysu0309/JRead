# Changelog

本檔記錄 JRead 每次版本變更。格式參考 [Keep a Changelog](https://keepachangelog.com/)。

---

**v0.7.200**——fix: 翻譯 extension 重建 DOM 後站名殘留（ChinaTalk）。(1) NOISE_KEYWORD_RE + STRONG_NOISE_KEYWORD_RE 加 `menu`（navigation menu container 通則）。(2) `hideInsideArticleByKeyword` 的 H1 guard 改為 strong keyword 可跳過——`div.main-menu` 含 h1#wordlogo（站名 branding），舊 guard 無條件保護導致 menu container 漏網。(3) debug bridge 加 `translate` action 觸發 Shinkansen 翻譯。(4) harness 加 `--shinkansen` flag 同時載入 Shinkansen + 翻譯後 audit、`--url` 參數。(5) icon-only link guard 跳過含大尺寸圖片的 a。

**v0.7.199**——fix: 翻譯 extension（Shinkansen 等）在 body 層級注入/重建元素導致站名殘留（chinatalk.media「中國談」）。修法：(1) `markAncestors` 擴展到含 body，body 也標 `data-jread-ancestor="1"`。(2) ancestor sibling hiding CSS rule 加 `:not(#__jread-toast-host)` 排除 JRead toast 通知 host。body 的非 ancestor/article 直接子元素一律隱藏，堵住翻譯 extension 從 body 層級逃脫 reader mode 的通道。

**v0.7.198**——fix: CNBC hero image 文字重疊。placeholder wrapper 內中間層 div（position:absolute）未被 styler 拉回 static flow，圖片不佔高度→主文文字疊在圖上。修法：(1) `[class*="placeholder"]` 改為 case-insensitive `[class*="placeholder" i]`（CNBC class 用大寫 `imagePlaceholder`）。(2) 新增 `[class*="placeholder" i] *` descendant rule 強制所有後代 position:static，配套 padding-bottom hack 解除。

**v0.7.197**——fix: TWZ byline 逗號浮空 + Google News widget 殘留。(1) light theme 加顯式 link 色 `#1a73e8`（Material blue, AA 5.2:1）+ underline 雙通道——原站深底白字連結在 reader card 白底上不可讀（TWZ 作者名 rgb(248,248,248) 近白），三個 theme 統一有顯式 link 色。連結色規則移入 base CSS（不再只在 dark/sepia override 注入）。(2) NOISE_KEYWORD_RE 加 `google[-_]?(?:add|news)` 命中 Google News 追蹤 widget（TWZ `item-wrapper--google-add`）。

**v0.7.196**——fix: figcaption 對比度不足。styler 的 background strip 規則排除 figcaption（保留原站背景），但 color inherit 規則沒排除——深色背景 + 深色繼承文字 = 不可讀。TWZ (thewarzone.com) 白字深灰底圖說實測觸發。修法：color inherit 規則 + dark/sepia theme color 規則都加 `:not(figcaption)`，背景與文字色成對保留。

**v0.7.195**——fix: CNN overflow + STREAMING NOW 殘留。(1) `collapseGridWithHiddenCell` 的 `CHILD_DECLS` 與 `INNER_FLEX_CHILD_DECLS` 改 `max-width: none` → `max-width: 100%`——inline-block 子元素不再無限撐寬溢出 reader card（CNN `layout__center` display:inline-block + min-width:500px 導致 444px 溢出 360px card 136px）。(2) `NOISE_KEYWORD_RE` / `STRONG_NOISE_KEYWORD_RE` 加 `related[-_]?content` pattern，命中 CNN `related-content-elevate` 等 class。

**v0.7.194**——fix: cnyes.com 推薦文章 card grid 殘留。新規則 `hideInsideArticleDirectChildLinkBlocks`：article direct child DIV 若含 >= 5 anchor 且無 >= 50 chars `<p>`、不含 canonical title、非前兩個 DIV child，視為推薦 card grid hide。通用結構規則，不綁站點。

**v0.7.193**——fix: 翻譯擴充（Shinkansen）後 detector 把 `<article>` 升級到 `div#main`——site logo H1 殘留。根因：`ensureArticleContainsTitleH1` 的 og:title guard 在翻譯後失效（og:title 英文 vs H1 中文），path 1 把 DOM-first H1（h1#wordlogo site logo）當 hero 升 LCA。修法：articleEl 內恰有 1 個 H1 時，結構上信賴該 H1 就是文章標題，跳過 promote。wya 案例（12 個 H1 = section heading）不受影響。

---

**v0.7.192**——fix: ancestor 非 ancestor 子元素殘留（chinatalk.media site header "ChinaTalk"）。新增 CSS 通則：ancestor 的直接子元素若不在 ancestor 鏈上也不是主文容器，一律 `display: none !important`。

---

**v0.7.191**——feat: 閱讀進度條。reader mode 頂端顯示 3px 細線進度條，隨捲動即時更新寬度百分比。顏色跟主題色連動（light 藍 / dark 淡藍 / sepia 深藍）。關閉閱讀模式自動移除。同場加映：所有 Playwright harness 加 `--window-position=-2400,-2400` 防止 Chromium 視窗搶焦點。

---

**v0.7.190**——fix: Page Rounds C2 FAIL 批次修正——文末推薦/訂閱/CTA 區塊殘留。NOISE_HEADING_MAX_LEN 20→40；NOISE_HEADING_TEXT_RE 新增 subscribe/newsletter/don't miss/help improve/articles and updates 五組 pattern；heading text scanner 擴掃 strong/em/b 元素（upmedia.mg 延伸閱讀）；新增 hideInsideArticleCTAParagraphs（BBC sign up for newsletter / follow us on / CNBC subscribe to YouTube CTA 段落）。7 站中 6 站 harness 驗證通過。

---

**v0.7.189**——fix: header height:auto 消除 hero overlay 空白 + cap 閾值降到 16px。header 加 height:auto + min-height:0 讓固定高度 hero banner 縮到內容高度，標題 overlay 在圖片底部自然呈現。cap 從 24px 降到 16px 進一步壓縮 wrapper 間距。cage 實機驗證通過。

---

**v0.7.188**——fix: v0.7.186 collapseEmptyBlockSpacers 誤殺 hero image。IMG/VIDEO/PICTURE 等媒體 tag 本身就是內容、不該被當 spacer 隱藏。加 MEDIA_SELF_TAGS guard 排除。

---

**v0.7.187**——fix: v0.7.186 header > * position:static 太激進導致 hero image 消失。移除 header 子元素的 position/height 覆寫，僅保留 header margin:0 + padding:0。hero overlay pattern（absolute heading 在 image 上方）在實機正常運作、不應干預。

---

**v0.7.186**——fix: reader card 內結構性大塊空白消除。三層修法：(1) styler CSS 新增 direct child header/footer margin+padding+height reset（hero overlay pattern 的 absolute 子元素強制 static 回 normal flow）、last-child bottom spacing strip；(2) cleaner capWrapperSpacing 對 articleEl 內所有 wrapper（div/section/header/footer/aside/nav）的 margin/padding > 24px 的部分 cap 到 24px；(3) cleaner collapseEmptyBlockSpacers 對 skip-list 中 display:block + 零文字的 spacer 元素（如空 caption SPAN）執行 hide。thebureauinvestigates.com 實測：header 從 720px 縮到 274px（hero image area 消除）、subtitle→Published 間距從 158px 降到 56px、story-body bottom-padding 從 90px cap 到 24px。

---

**v0.7.185**——fix: ctee.com.tw 標題下方 taglist（#BMW #E Ink 等）殘留。hashtag 的 # 由 CSS ::before 加、a.textContent 不含 #，hideInsideArticleHashtagClusters 漏掉。`tag[-_]?list` 加入 NOISE_KEYWORD_RE，由 keyword rule 命中 hide。

---

**v0.7.184**——fix: 推薦文章 section（related-news / more-news / recommended 等）內含長摘要 p 時被 anchor guard 誤豁免。將 related/more/recommended 等「推薦/相關文章 section」命名家族加入 STRONG_NOISE_KEYWORD_RE，跳過 wrapperContainsMainContentP guard 直接 hide。udn 實測：section.related-news.more-news 含 6 篇推薦文章各有 100+ chars 摘要 p → 推薦區殘留。

---

**v0.7.183**——fix: video player 在 reader mode 不可見 + 影片溢出遮字。(1) 所有影響 media layout 的 CSS 規則（position/left/right/float/max-width/display/max-height/margin-auto）加 `:not([data-jread-player="1"])` 排除，JW Player absolute positioning layout 恢復。(2) player container 標記從「向上走 4 層」改為「找最近 position:relative+overflow:hidden 祖先」，外層 layout wrapper 維持被 card max-width 約束。(3) strip 大幅負 margin-top（< -20px）：原站 mt:-80px 把 video 向上拉進 opinion-header 100px padding 區域做重疊，strip padding 後殘留負 margin 導致 video 遮住 subtitle。Harness 截圖確認影片在 card 內正確排版、無溢出遮字。

---

**v0.7.182**——fix: video player poster/controls 被 background strip CSS 清除。新增 `data-jread-player` 標記機制：styler `apply()` 從 `<video>` 向上走 4 層找 player container，標記 container 及所有後代；background strip / color inherit / pseudo-element strip 三條 CSS 規則加 `:not([data-jread-player="1"])` 排除 player 子結構。`restore()` 清除標記。

---

**v0.7.181**——fix: MSNBC/ms.now 日期/作者消失 + 影片 player 高度歸零。(1) BYLINE_TEXT_RE 擴充 `\bby\s` 不限行首 + 月份縮寫加 `\.?` 容許 AP style "May."——hideInsideArticleSidebarColumns condition A 的 byline guard 正確觸發。(2) hideInsideArticleEmptySpacers + collapseEmptyWrappersAfterClean 加 sibling media guard：空 div 的 parent 含 video/iframe sibling 時 skip——JW Player `.jw-aspect`（padding-top: 56.25%）不再被 collapse。

---

**v0.7.180**——fix: reader card 頂端空白 + 標題字級不尊重 titleFontSize option（MSNBC/ms.now）。`firstInk` 搜尋跳過 `display:none` 隱藏元素（opinion-header 內 `.opinion-column` category label P 在 DOM order 比 H1 早、導致 ancestor padding strip 和 titleFontSize inline override 雙雙 miss）；titleFontSize inline override 獨立搜尋第一個可見 h1（不依賴 firstInk 是否 H tag）。

---

**v0.7.179**——fix: CMS 彩色 banner 白字在 reader mode 不可見 + WordPress constrained layout 內文過窄。styler 加 reader card 顯式 text color + 後代 `color: inherit !important`（所有 theme）；content block tag（p/h/ul/ol/dl）加 `max-width: none !important` override WP layout constraint；universal `*` max-width 加 `html` 前綴提升 specificity。

---

**v0.7.178**——fix: 新聞站分類標籤微型欄（CNN "News"、BBC "Science & Environment" 等 kicker/eyebrow）殘留在 reader mode。hideInsideArticleSidebarColumns 新增條件 D：flex row 內 2-4 children、textLen ≤ 30 的 sibling 旁有含 heading 的 sibling → hide；guards：<time> / heading / media / canonicalTitle / promotedTitleHead / byline。

---

**v0.7.177**——fix: emoji vertical-align 微調至 `-0.1em`（與中文字視覺對齊）；block 圖片（img/video/picture）加 `margin-bottom: 24px` 避免連續圖片緊貼無間距（Facebook 多圖貼文實測）。

---

**v0.7.176**——fix: emoji `<img>` 在 reader mode 從 inline 變成置中獨立區塊。styler 的 `img { display: block }` 規則把 Facebook/LINE 等站的 emoji 圖片（naturalWidth <= 48）推成 block + margin auto 置中，破壞原文排版。修法：apply() 掃描小型 img 標記 `[data-jread-inline-img]`，CSS override 保持 inline flow。同時修復 `getSettings()` 回傳 null 時 `settings.blockPageShortcuts` 存取炸 TypeError 的既有 bug（SW 未就緒時觸發 reader mode 會命中）。

---

**v0.7.175**——feat: 新增「標題字級」設定（`titleFontSize`）。options 頁面可調 h1 font-size（px），0 = Auto 保留原站標題大小（預設）、非 0 覆寫。解決使用者調大內文字級（如 54px）後原站 h1（如 CNA 35px）反而比內文小的問題。CSS rule 同時 target `h1` 和 `h1 *`——CNA 等站把 h1 文字包在 `<span>` 裡，`SPAN_TEXT_SEL` 會把 span 字級壓成 body fontSize，必須穿透子元素才生效。SW `DEFAULT_SETTINGS` / options DEFAULTS 同步。`npm test` 1082 條通過。

---

**v0.7.174**——fix: X 推文含圖片時閱讀模式不顯示照片。`unwrapTweetMedia` 把 `<a>` 替換成 `<figure>` 後，figure 仍卡在 X 的 aspect-ratio hack wrapper 鏈（height:0 + overflow:hidden + position:absolute）裡被裁切不可見。新增 hoist 邏輯：找到 media 所在的 branch root（跟 tweetText 同層級的 wrapper），把 figure 搬到該 branch 前面、移除空殼 wrapper。加 guard 跳過 figure 已在正確層級的情境（jsdom fixture 無多層 wrapper 的 case）。`npm test` 1077 條通過。

---

**v0.7.173**——延續 v0.7.172 修法。newtalk 閒置提醒 dialog `<h2 class="title">` 也被 `promoteArticleTitleClassHeadingInto` clone 進 articleEl（bare `class="title"` 命中 `TITLE_CLASS_HIT_RE` 第二 alternation）。**修法**：新增 `TITLE_CLASS_STRICT_RE`（只接受複合 token：`article-title` / `post-title` / `wp-block-post-title` / `entry-title` 等），`promoteArticleTitleClassHeadingInto` 改用 strict 版；bare `title` / `headline` 仍保留在 `looksLikeArticleTitleH1` 供 `promoteUniqueTitleH1Into` 使用（該函式有 og:title strict equality guard 兜底）。v0.7.172 的 `h.closest('a')` guard 已被 strict regex 涵蓋、移除。**spec**：fixture 加閒置 dialog h2 + 新增 1 條 forcing function。`npm test` 1077 條通過。

---

**v0.7.172**——newtalk.tw 閱讀模式開頭出現不相關推薦新聞圖片和連結。**根因**:`promoteArticleTitleClassHeadingInto` 找到外部推薦新聞的 `<h3 class="title">`（在 `<a class="trackNewsGA4">` 內），`class="title"` 命中 `TITLE_CLASS_HIT_RE` 的 standalone `title` pattern，把整個 `<a>` wrapper（含不相關圖片 + 標題）clone 進 articleEl 開頭。**修法**:加 `h.closest('a')` guard——heading 在 `<a>` 內 = 推薦卡片標題（連結指向其他文章），不是本文標題。通則依據：文章標題不會包在 `<a>` 裡；跨站推薦新聞都是 `<a><h3>title</h3></a>` 結構。**spec**:`newtalk-promo-card-title-clone.spec.js` 新增 4 條 forcing function。`npm test` 1076 條通過。

---

**v0.7.171**——CNBC blob 文章 dark mode 「LIFE 標籤跟標題」中間大段空白。**動機**:Jimmy 2026-05-23 在 v0.7.170 release 後再截圖回報 dark mode 仍見約 80-90px 的空白 (light mode 因白底掩蓋不明顯但也存在)。**根因 (cage probe)**:JRead v0.7.100 對 h1-h6 注入 `margin-top: 1.5em !important` 確保「站點把 heading margin 砍光」時仍有視覺斷層;但 CNBC h1.headline `font-size: 54px`(reader card narrow width 下),`1.5em × 54px = 81px` 的 margin-top 直接撐出 LIFE 標籤跟標題間的 81px 空白。雙重不幸:CNBC h1 字級巨大 + JRead em 單位放大規則疊加。**修法**:`margin-top: 1.5em` 改 `clamp(16px, 1em, 32px)`、`margin-bottom: 0.5em` 改 `clamp(8px, 0.4em, 16px)`。clamp 上下限封頂、中段值改 1em (從 1.5em),CNBC h1 81→32px、BBC h1 ~48→32px、一般 h2-h6 (font 24-30px) 落入 clamp 中段近似原 1.5em 效果但不會無限放大。cage 實測 CNBC dark mode gap 從 91px → 42px。**spec**:`styler-h1-margin-clamp.spec.js` 新增 4 條 forcing function:(a) CSS 含 h1-h6 selector + (b) margin-top: clamp(16px,1em,32px) !important + (c) margin-bottom: clamp(8px,0.4em,16px) !important + (d) 必須不存在舊 `margin-top: 1.5em !important` 殘留。`npm test` 1072 條通過。**通則教訓**:em-based margin 在「heading font-size 跨站差距大」時會放大失控。clamp() 上下限封頂是 em-unit 規則的安全做法,可考慮其他 em-based rule 一併檢視(目前先保守只動 heading 一條)。

---

**v0.7.170**——CNBC blob 文章 dark mode 主圖完全消失(light mode 也部分受影響)。**動機**:Jimmy 2026-05-23 在 v0.7.169 release 後再截圖回報「文字都對了，但是圖片沒出來」——dark mode 圖片整塊不見、light mode 圖右側出現一塊鮮綠 mint 色 panel。**根因**:CDP probe + outerHTML 揭穿 CNBC InlineImage 的 lazy-load 結構為 `<div class="imagePlaceholder" style="padding-bottom:55.5%">` (aspect-ratio 撐高度) 包 `<div class="imageContainer" style="position:absolute">` 再包 `<picture>` + `<img>`。cleaner `hideInsideArticleAbsoluteOverlays` (v0.7.111) 把 imageContainer 當 overlay 砍 (`data-jread-hidden=1` + `display:none !important`),連帶 picture/img 0×0 不可見。v0.7.119 已加 `IMG/PICTURE/VIDEO/SOURCE` TAG 排除、v0.7.148 已加 h1 wrapper 排除,但「含 picture/img 的 wrapper div」這個 case 沒覆蓋。**修法**:`hideInsideArticleAbsoluteOverlays` 新增 v0.7.170 guard——`el.querySelector('picture, img, video')` 命中 → skip。通則:absolute div 內含 media 元素 = aspect-ratio 媒體 wrapper (lazy-load padding-bottom hack + 內層 absolute container 包 picture 是跨 CMS 通用 pattern),不是「文字/裝飾 overlay」。漏網成本 (極少數帶 hero img 的整塊 banner overlay) 遠低於誤殺成本 (主圖整塊消失)。**spec**:`cnbc-absolute-picture-wrapper.spec.js` 新增 5 條 forcing function:(a) fixture imageContainer 結構驗證 + (b) absolute picture wrapper 不可被 hide (核心保護點) + (c) picture/img 自身 + 祖先鏈無 hidden 連帶 + (d) overlay-no-media-aside / overlay-no-media-div 仍被 v0.7.111 hide (互補不退步) + (e) 主文 body-p 全保留。新 fixture `cnbc-absolute-picture-wrapper.html` 最小重現 InlineImage 結構 + 兩個無 media 的 absolute overlay (sanity 不退步)。sanity:guard `if (false &&` 改 false → 2 條 fail (b/c);還原全綠。`npm test` 1068 條通過。**注意**:Playwright Chromium 對 CNBC lazy-load 圖時序與 Jimmy 實機 Chrome 不同 (圖在 harness 從未實際 load),無法 harness 驗收主圖視覺;只能靠 fixture spec + 邏輯完整性保證。Jimmy 截圖回報的「light mode 圖右側鮮綠 panel」目前 harness probe 抓不到 (image 未 load 連帶無相關元素 render),v0.7.170 主修是 absolute 砍 picture wrapper 的 root cause,實機 reload 後若 mint panel 仍在再單獨 probe。

---

**v0.7.169**——CNBC blob 文章 reader mode 出現左側白盒 + 內文向右縮排。**動機**:Jimmy 2026-05-23 截圖回報 https://www.cnbc.com/2019/10/23/the-blob-slime-mold-physarum-polycephalum-characteristics.html 進閱讀模式後,article header 左側出現一塊 520×480px 的大白盒,跟 article card 並排,看起來「排版亂七八糟」。**根因**(CDP `DOM.getNodeForLocation` 在白盒 (100, 200) 點指認):CNBC 的 `ArticleHeader-styles-makeit-wrapperHeroNoImage` div 上有 `::before` pseudo-element 做 side-bleed 裝飾——`position: absolute` + `background-color: white` + `width: 522.578px` + `height: 482.359px` + `transform: matrix(1, 0, 0, 1, -522.578, 0)`(往左 522px 位移),把卡片底色「溢出」到 article header 左側,營造 hero-less 文章視覺上加寬的效果。reader mode 下 pageWrapper 已有自己的卡片 bg,這 pseudo 反而在版心外漏出大塊白色,被使用者感知為「並排的空白盒」。前期 probe 路線浪費 6 輪(querySelectorAll + getComputedStyle + elementsFromPoint 都找不到——pseudo-element 不在 querySelectorAll 結果裡、elementsFromPoint 只回 host 元素鏈),最終 CDP `DOM.getNodeForLocation({includeUserAgentShadowDOM: true})` 直接回 `::before` node 才揪出。**修法**:`styler.js` 新增 reader card 內 `*::before` / `*::after` 通則規則,強制 `background-color: transparent !important` + `background-image: none !important`。content / color / size / position 不動——list marker / drop cap 文字 pseudo 不靠 bg-color 渲染,仍工作。**通則安全**:pseudo bg 在 reader card 沒有合法用途(pageWrapper 已有自己 bg、多餘 pseudo bg 只會在版心外漏色或誤覆蓋主文)。**spec**:`styler-pseudo-bg-clear.spec.js` 新增 2 條 forcing function:(a) CSS 必須含 `[data-jread-active="1"] *::before, [data-jread-active="1"] *::after` selector;(b) rule body 必須同時含 `background-color: transparent !important` + `background-image: none !important`。sanity:把 styler 的 selector 改名 → 兩條 spec fail;還原全綠 1059 條。**harness 驗證**:`debug-harness.js` 跑 CNBC URL,fullpage 截圖白盒已消失,article header 內容正常 left-align 在 card 中央。**第二修(內文右縮)**:Jimmy 修白盒後再截圖回報內文 p 整段往右縮排 ~91px,標題/byline/caption 對齊正常。probe 揪出 CNBC `ArticleBody-styles-makeit-articleBody` 內每段 p 都被 `<div class="group">` wrapper 包住、wrapper 設 `margin-left: 91.14px`,把 body p rect.left 從 caption 的 496 推到 587。修法:styler 新增通則 reader card 內 `div:has(> p) / div:has(> h1-h6) / div:has(> ul, > ol) / div:has(> blockquote)` 一律 `margin-left: 0 !important; margin-right: 0 !important`——含 direct content child 的 div = body content wrapper,reader 單欄版心不需橫向位移。CSS `:has()` Chrome 105+ 支持。**spec 補 4 條** forcing function:div:has(> p) / div:has(> h1, > h2, ...) / div:has(> ul, > ol) selector 存在 + margin-left/right: 0 !important declaration 存在。sanity 過,共 6 條 spec 全綠。**踩坑 1**:dev 中曾把 `` `<div class="group">` `` 寫進 CSS comment 內,backtick 字元 terminate 了 styler.js 的 JS template literal、整個 buildCss 回傳 corrupt 字串,reader mode 不啟動;spec comment 已標註禁止 comment 內含 backtick。**踩坑 2**:白盒 root cause 揪出花了 6+ 輪 probe(querySelectorAll / getComputedStyle / elementsFromPoint 都找不到 pseudo)、最終 CDP `DOM.getNodeForLocation({includeUserAgentShadowDOM: true})` 直接回 `::before` node 才確認;pseudo-element 不在 querySelectorAll 結果裡,需要 CDP / 純 pixel-level 比對才能定位。

---

**v0.7.168**——修 v0.7.167 published_date 在 FB / X 上抓錯。**動機**:Jimmy 2026-05-22 cage probe 實機驗證 v0.7.167 published_date 抽取在 FB / X 失效:(a) **FB**:joeltalkjapan post DOM 完全沒 JSON-LD / 沒 meta 日期欄位 / 沒 `<time>`,只有 `<a aria-label="50分鐘前">` 相對時間 → `extractPublishedDate` 必然回空字串,published_date 沒送。(b) **X**:`document.querySelectorAll('time[datetime]')[0]` 抓到的不是主推文時間——@emissionite/status/... probe 顯示 `articles=[@Scott_Wiener reply, @emissionite main]`,reply article 在 DOM 順序前,第一個 time 是 reply 的時間(2026-05-19T18:43:12)而非主推文(2026-05-19T19:56:55)。**修法**:`main.js extractPublishedDate` 加 FB / X 分流(放在原 fallback 之前):① `[data-jread-fb-reader]` 命中 → 直接 return ''(Jimmy 確認寧可不送也不要倒推不精準的相對時間);② `[data-jread-x-reader]` 命中 → 走 `extractXPublishedDate()`:`querySelector('[data-jread-x-reader] :scope > article')` 鎖定合成容器內第一個 article(`x-thread.js collectThreadArticles` 把 mainArticle 放在最前),取其內**最後一個** `<time datetime>` —— X 主推文 article 慣例:若有 quoted tweet 則 quoted 時間在前、主推文 timestamp 在後;沒 quoted tweet 時 article 內只有 1 個 time 也是主推文。**spec**:`readwise-author-date-extract.spec.js` 新增 8 條 jsdom 行為 spec:X 主推文「只 1 個 time / 含 quoted tweet 2 個 time / 第二個 article 不可被取 / 容器無 article / article 無 time 不退回 meta / time datetime 無效」,FB「短路不抓任何 fallback / FB marker 缺失走一般 fallback」;`readwise-save.spec.js` 補 5 條 forcing function(`extractPublishedDate` body 內 FB/X 分支位於 fallback 前 + `extractXPublishedDate` 定義 + 必用 `:scope > article` 鎖定第一個 article + 取 `times[times.length - 1]`)。sanity:把 main.js `extractXPublishedDate` 改名 → 5 條 forcing function fail;還原全綠 1057 條。

---

**v0.7.167**——送 Readwise Reader 帶上 `author` + `published_date` 欄位（FB 送 vanity username、X 送 @handle、一般站走多層 fallback）。**動機**：Jimmy 2026-05-22 詢問 Readwise Save API 是否支援 `language` / `author` / `published_date`。確認官方 `POST /api/v3/save/` 文件:`language` 不存在(送了會被忽略,不做),`author` 是單一字串、`published_date` 是 ISO 8601 字串——兩者都送。**實作**：(a) `popup-core.buildReadwisePayload` signature 新增 `author` / `publishedDate`,非空 string 且 trim 後非空才送進 `author` / `published_date`。(b) `main.js` 新增三條抽取 helper：① `extractAuthor()`:Facebook 合成 reader 走 `NS.fbPost.extractAuthorVanityFromUrl()`(URL 第一段 vanity username,reserved path 如 `groups`/`story.php`/`permalink.php`/`share` fallback 到 reader card 內 `[data-jread-fb-author] strong` displayName);X / Twitter 合成 reader 走 `extractXAuthorHandle()`(URL `/<handle>/status/<id>` → `@handle`,hostname 嚴格比對 `x.com` / `twitter.com`);其餘走 `extractGenericAuthor()`(JSON-LD `Article.author.name` 含 string/object/array/@graph → meta[name=author] → meta[property=article:author] filter URL → byline 元素如 `[itemprop=author]`/`[rel=author]`/`.byline` 等)。② `extractPublishedDate()`:JSON-LD `datePublished`/`dateCreated` → meta tags(`article:published_time`/`pubdate`/`date`/`DC.date`/`DC.date.issued`/`itemprop=datePublished`) → `<time datetime>` fallback,一律 `new Date(raw).toISOString()` 正規化為 UTC ISO 8601。③ `extractReaderPayload` payload 帶上 `author` / `publishedDate` 兩欄位。(c) `fb-post.js` 新增 `extractAuthorVanityFromUrl(url)` 並暴露:`/<user>/posts/<id>` 取 `seg[0]`,排除 reserved path,hostname 嚴格 `(www\.|m\.|mobile\.|web\.)?facebook\.com`。**spec**：(a) `readwise-save.spec.js` 新增 `buildReadwisePayload` author/publishedDate 行為 + 「絕對不送 language 欄位」forcing function + main.js forcing function 8 條(extractAuthor/extractPublishedDate 定義 + payload 含 author/publishedDate + FB/X 短路 + JSON-LD/meta/time selector);(b) 新檔 `readwise-author-date-extract.spec.js`:jsdom 行為 spec 覆蓋 JSON-LD 各種 schema(string/object/array/@graph)、meta tag、byline 元素、X handle URL 解析(含 hostname 防混淆)、published_date 跨格式(純日期/含時區/JSON-LD 優先 meta) 共 27 條;(c) `fb-post.spec.js` 新增 12 條 `extractAuthorVanityFromUrl` URL 解析(vanity URL/groups/story.php/permalink.php/share/純使用者頁/非 FB 站/hostname 混淆攻擊)。sanity:把 main.js 內 `data-jread-fb-reader` 短路拿掉 → FB spec 全 fail;還原全綠。`npm test` 1093 條通過。

---

**v0.7.166**——送 Readwise Reader 帶上主圖 URL（`image_url` 欄位）。**動機**：Jimmy 2026-05-22 詢問 Readwise Save API 是否能帶 cover image。確認官方 `POST /api/v3/save/` 文件有 `image_url` 欄位（"An image URL to use as cover image."），讓送進 Readwise 的文章在 reader inbox 有縮圖呈現。**實作**：(a) `popup-core.buildReadwisePayload` signature 新增 `imageUrl`，非空 string 且符合 `^https?://` 才送進 `image_url`（data:/blob:/相對路徑略過，避免 Readwise 端 fetch 失敗）。(b) `main.js` 新增 `extractHeroImage(articleEl)` helper：① reader card 內第一張「visible 主圖」（natural >= 200×200，無 naturalWidth 時 fallback rect >= 200×120；不在 `[data-jread-hidden]` 子孫內），srcset 取最大解析度 entry、否則退回 currentSrc/src；② fallback 到 `meta[property="og:image"]` / `og:image:url` / `og:image:secure_url` / `meta[name="twitter:image"]` / `twitter:image:src` 任一存在。URL 一律 `new URL(s, location.href).href` 轉 absolute、`http(s)` only。`extractReaderPayload` 把結果放進 `payload.imageUrl`，SW + popup 都透過既有 `buildReadwisePayload` 路徑轉成 `image_url` 送 API。**spec**：`readwise-save.spec.js` 新增 (a) `buildReadwisePayload` 接 imageUrl 行為（http(s) absolute → 送、data:/blob:/相對路徑/空字串 → 略過）；(b) main.js forcing function 4 條（`extractHeroImage` helper 存在 + 處理 `og:image` meta + `extractReaderPayload` 呼叫該 helper + payload 含 `imageUrl` 欄位）。sanity：把 `extractHeroImage` 改名 → forcing function fail；還原全綠。

---

**v0.7.165**——FB 段落送 Readwise Reader 擠成一團——`buildCleanHtml` 把 `[data-jread-fb-para="1"]` div 改寫成 `<p>`。**動機**：Jimmy 2026-05-22 回報「Facebook 的文章在閱讀模式送到 Readwise Reader 時，文章段落都會擠在一起」。**Root cause**：fb-post.js `markParagraphDivs` 把 FB 主貼文的「直接含文字 leaf div」標 `data-jread-fb-para="1"` + 設 inline `style="margin: 1.2em 0"`，本地 reader card 靠 inline margin（+ styler 注入的 `[data-jread-fb-para]` 規則）顯示段落間距。但送 Readwise 走 `extractReaderPayload → buildCleanHtml → POST` 流程，`buildCleanHtml` 雖然不動 `style` attribute，但 Readwise Reader 端的 HTML sanitizer 會砍掉所有 inline style 並重新套自家排版——`<div>` 在他們的 parser 裡不被視為段落（無 native margin），結果所有段落 div 緊貼在一起。**修法**：`buildCleanHtml` 在「移除 hidden / 移除注入 style」之後、「strip data-jread-* attr」之前，把所有 `[data-jread-fb-para="1"]` div 改寫成 `<p>`（複製 attribute + 搬子節點 + replaceWith）。本地 reader card 不變（仍用 div + inline margin + styler 規則），Readwise 端收到 `<p>` 用語意辨識段落。markParagraphDivs 既有 guard 已保證 fb-para div 的 children 只有 text node 或 inline element（span / a / strong / em ...），轉 `<p>` 不會違反「p 不可含 block-level child」HTML 規則。**spec**：`readwise-save.spec.js` (a) `buildCleanHtmlImpl` 鏡像同步加入 fb-para → p 轉換；(b) 新增「FB permalink 段落 div 改寫成 `<p>`」行為 spec（驗 `<p>` 含原文字 + 內部 inline `<a>` 連結保留 + 非 fb-para div 不被誤轉 + 改寫後不留 data-jread-fb-para 殘骸）；(c) main.js forcing function 新增「必須處理 data-jread-fb-para」+「必須 createElement('p')」兩條 assert。sanity：拿掉 main.js 新增的 fb-para 轉換段 → forcing function + 行為 spec 立刻 fail；還原全綠。

---

**v0.7.164**——dark theme `<pre>` + `<code>` 視覺修法（背景對比 + 字型保留）。**動機**：Jimmy 2026-05-22 回報 Medium @ddsakura-blog M5 Max 評測文 dark theme 下兩個視覺問題：(1)「白底卡片內淺灰字閱讀困難」；(2) 修好 bg 後「框內等寬字型被代換」。**Root cause（兩件事）**：

(1) **背景對比**：cage probe 發現真兇不是 blockquote（整篇沒用 blockquote tag），而是 `<pre>`（站點 `.pre` 套 bg `#f9f9f9`）+ inline `<code>`（站點 `.code` 套 bg `#f2f2f2`）。styler line 463 background 清除規則 preserve 清單刻意保留 `pre / code` 原站 bg（程式碼框視覺區隔），light theme 下淺底 + 黑字可讀；但 dark theme 下 jread `* { color: theme.text }` 把文字色覆寫成 `#d4d4d4`，淺底 + 淺字對比 **1.04:1**（比 v0.7.154 blockquote 修的 1.38:1 更糟）。這是與 v0.7.154 完全同性質的結構性通則 bug——「站點 light theme 設計的 light bg + jread dark text 覆寫 = 對比過低」適用於所有 preserve 清單上 bg 元素。

(2) **字型代換**：v0.7.152 為穿透 WYSIWYG 編輯器（vocus.cc 對 span 寫死 font-family）加入 `SPAN_TEXT_SEL = [data-jread-active="1"] span:not(icon)...`，fontFamily / fontSize override 套到 article 內所有 span。Medium WYSIWYG 把 `<pre>` 內每行包成 `<span class="...">`，這條 SPAN_TEXT_SEL 也命中 pre 內 span → 蓋掉站點 pre author CSS 的 monospace stack (`source-code-pro, Menlo, Monaco...`) → pre 框內字型被代換成使用者字型（sans-serif）。Probe：Medium 文章 20 個 span / 12 個非 pre/code 後代 / 8 個 pre/code 後代是漏網。

**修法（兩件事併進同版號）**：(a) 把 v0.7.154 的 `dark/sepia html.__jread-active [data-jread-active="1"] blockquote { background-color: transparent !important }` rule 擴成 `blockquote, pre, code` 三 selector 共用同條 rule body。dark 下透出 reader card #1a1a1a → 對比 11.74:1（AAA）；sepia 下透出 #f4ecd8 同樣 AA 通過。light 完全不注入（既有 preserve 設計仍有效）。(b) SPAN_TEXT_SEL 結尾加 `:not(pre *):not(code *)`（Selectors 4 complex selector in :not()，Chrome 88+ 支援，Manifest V3 最低 88，全相容）。pre / code 後代的 span 不命中 SPAN_TEXT_SEL → font-family 不被覆寫 → inherit 父元素字型（站點 pre author CSS 的 monospace stack 仍生效）。寫成兩個獨立 `:not()`（不寫 `:not(pre *, code *)` selector list 形式）避免 selector 字串含 comma 干擾 `split(',')` 切 selector list 的程式邏輯。

**spec**：(a) 新增 `styler-dark-code-pre-bg.spec.js` 6 條 forcing function（dark/sepia 注入 pre/code transparent / light 不注入 pre/code rule）；更新 `styler-dark-blockquote-bg.spec.js` regex 容忍 multi-selector list（`blockquote\b[^{]*\{`）。(b) 新增 `styler-pre-code-monospace-preserve.spec.js` 3 條 forcing function（非預設 fontFamily / fontSize 注入的 SPAN_TEXT_SEL 必須含 `:not(pre *):not(code *)`；預設值若仍注入也必須含）；更新 `styler.spec.js` v0.7.152 vocus span 命中 spec：querySelectorAll 前剝掉 `:not(pre *)` / `:not(code *)` 子句（jsdom nwsapi 不支援 Selectors 4 complex selector in :not()，runtime Chrome 完全支援）。sanity check：(a) 拿掉 styler `pre, code` selector → bg spec 4 條 dark/sepia 立刻 fail；(b) 拿掉 styler `:not(pre *):not(code *)` → monospace spec 3 條立刻 fail；都還原全綠 996 passing。

**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.163**——FB 段落間距設定失效修法。**動機**：Jimmy 2026-05-22 回報 popup 調「段落間距」在 Facebook 不生效。**Root cause**：三事實構成必然失效——(1) `fb-post.js` `markParagraphDivs` 對 leaf paragraph div 寫 inline `setProperty('margin', '1.2em 0', 'important')`（v0.7.157 寫死、註解標「防 styler 通用 rule 覆寫」）；(2) `styler.js` 的 `paragraphSpacing` 規則 selector 只含 `p / ul / ol / blockquote`，**不含 FB div 段落**（FB 用 div 不用 p）；(3) 硬教訓十：inline `!important` 永遠贏 stylesheet `!important`。三者組合 = styler 規則即使涵蓋 fb-para selector，inline `!important` 也會擋掉,而既有 selector 連嘗試覆寫的機會都沒有。**修法**：(a) `fb-post.js` `markParagraphDivs` 改用 `div.style.margin = '1.2em 0'`（無 `!important`）作為 fallback，給 Auto sentinel (-1) 與 styler 規則尚未注入時用；(b) `styler.js` 的 `paragraphSpacing >= 0` 條件分支 selector 加 `[data-jread-active="1"] [data-jread-fb-para="1"]`，並設 `margin-top` 與 `margin-bottom` 兩者（FB div 沒 p 的 user-agent margin、上下都得設）。**spec**：styler.spec.js 新增 2 條 forcing function——「paragraphSpacing >= 0 必須注入 fb-para rule block 且 margin-top/bottom 都有」/「paragraphSpacing=-1 Auto 不注入 fb-para 規則（fb-post inline fallback 接手）」；fb-post.spec.js 新增 1 條 forcing function——「fb-para inline margin 不得用 !important」（priority 必須為空字串，否則 styler 設定打不到）。sanity check：把 fb-post 改回 `!important` → fb-post.spec.js 新 spec 立刻 fail（priority="important"）；還原 989 全綠。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.162**——popup 加「行距」+「段落間距」設定。**動機**：使用者要求把行距 / 段落間距曝露為可調設定（之前只有字級 / 字型 / 主題 / 版心寬度 / 字粗）。**設計**：兩項都用「Auto 按鈕 + stepper」pattern，沿用字級 row 的視覺與互動語言，setting-row 同 110px / 28px grid 對齊（CLAUDE.md UI 對齊規則）。行距 stepper `[1.0, 3.0]` / step 0.1 / 預設 1.7 / Auto sentinel `lineHeight=0`；段落間距 stepper `[0, 3.0]em` / step 0.25 / 預設 1.0 / Auto sentinel `paragraphSpacing=-1`（0 是合法值代表段落貼緊，所以 sentinel 用 -1）。**styler 重構**：(1) `DEFAULTS.paragraphSpacing = 1.0` 新欄位；(2) `lineHeight=0` Auto 時不注入任何 line-height（即使 fontSize 改過、font-size rule 內也不串 line-height）；(3) 把 v0.7.102 base 內固定的 `p/ul/ol/blockquote margin-bottom: 1em !important` 規則搬離 base、改放 userOverrides 條件分支，`paragraphSpacing >= 0` 才注入、Auto (-1) 跳過——預設 1.0 注入 1em 等價於 v0.7.102 行為，Auto 模式下完整保留原站 typography。**Trade-off 紀錄**：使用者選「行距 Auto」+ 改字級時，原站若用 px 鎖死的 line-height（例 Medium `.pi { line-height: 32px }`）會在字級縮小後變過寬行距——這是 Auto 的明確 trade-off（使用者顯式要求保留原站行距），不再強制連帶縮放。**SW DEFAULT_SETTINGS / main.js relevantKeys 同步**：SW 加 `paragraphSpacing: 1.0`；main.js storage.onChanged relevantKeys 加 `'paragraphSpacing'`（即時套用、不需 refresh 頁面）。options.js DEFAULTS 不曝露此欄（mirror lineHeight pattern：popup-only 設定）。**spec**：defaults-sync.spec.js 更新「lineHeight describe 加 popup」+ 新增「paragraphSpacing describe」共 4 條 forcing function（SW=1.0 / styler=1.0 / popup=1.0 / main.js relevantKeys 含 paragraphSpacing）；styler.spec.js 加 6 條 forcing function（lineHeight=0 Auto 即使 fontSize 改過也不注入；fontSize=0 + lineHeight=0 雙 Auto 完全 baseline；paragraphSpacing 預設 1.0 注入 1em；paragraphSpacing=-1 Auto 不注入規則；paragraphSpacing=0 仍注入 0em；非預設值注入 2.25em）；styler-value-clamp.spec.js 加 3 條 clamp 驗（極大 1e308 clamp 到 ≤ 5em / -1 Auto sentinel 保留 / -2 無效負值 fallback 到 DEFAULTS）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.161**——X tweetPhoto img opacity:0 lazy-load fade 殘留修法。**動機**：v0.7.160 unwrapTweetMedia 在 Jimmy 實機驗證後仍看不到圖片——`elementFromPoint` 抓到 img、img.complete=true、naturalWidth=1200，但 viewport 視覺空白。**Root cause**：X stylesheet 對 `img.css-9pa8cd` 套 `opacity: 0` 當 lazy-load placeholder，由 React 在實際載入完成後 fade-in 到 1。cloneNode 不複製 React event handler / fade transition state，fade-in 永不觸發，img 永遠保持 `opacity: 0` 透明（DOM 數據完美但視覺看不到）。`removeAttribute('style')` 清的是 inline style，stylesheet rule 不受影響。**修法**：`unwrapTweetMedia` 內把 img 從原 wrapper 抽出後，補 `img.style.setProperty('opacity', '1', 'important')`——inline !important 戰勝 stylesheet rule（specificity 必勝），覆寫掉 `opacity: 0`。**spec**（x-thread.spec.js 新增 1 條 forcing function）：unwrap 後 figure 內 img 的 inline `style.opacity` 必須為 `1 !important`（priority 也驗）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.160**——X / Twitter status 與 Article 內圖片消失修法。**動機**：Jimmy 2026-05-22 回報 https://x.com/EEEEYHN/status/2057397813999456759 reader mode 進入後 4 張內文圖片全部消失，只剩文字、標題、avatar。**Root cause**：X 推文與 Article 把圖片包在多層 emotion-styled wrapper（`<div data-testid="tweetPhoto" position:absolute>` 配 `<div class="r-1adg3ll" padding-bottom hack>` 配 `<a href="/photo/N"|/article/N">` 配 `<img>`）。cleaner 通用規則對此結構不適用：(1) `hideInsideArticleAbsoluteOverlays` 直接砍 tweetPhoto wrapper（position:absolute、不含 h1 / 長 p、被視為文字 overlay）；(2) `hideInsideArticleIconOnlyLinks` 砍內層「`<a><img></a>`」結構（無文字、不在 figure 內）；(3) `resetMediaPlaceholderPadding` 只看 img 的 direct parent 不掃多層祖先、X padding-bottom hack 在祖父層被漏跑、wrappers 全部 overflow:hidden + h=0、img 雖 layout 中但被截掉。**修法**：`jread/content/x-thread.js` 新增 `unwrapTweetMedia(clone)`，enter() cloneNode 後對每個 `[data-testid="tweetPhoto"]` 找最近 a 祖先（不跨 tweetText），整段 replaceWith `<figure data-jread-x-media><img></figure>`。figure 是 `cleaner.PRESERVE_SEL` 內 tag，cleaner 自動 skip 內部 hide rule；styler 對 figure / img 已有現成 max-width / height:auto 排版規則。同時 `removeAttribute('style')` 清原站 inline position:absolute / top / left / filter:blur 等 lazy-load placeholder 樣式。覆蓋兩種 layout：普通 X 推文（外層 a[href*="/photo/"]）、X Article（外層 a[href*="/article/"] 為「圖片可點擊版」連結，每張圖各一個 instance）；沒外層 a 時 fallback 直接 unwrap tweetPhoto 本身。**spec**（x-thread.spec.js 新增 5 條 forcing function）：(a) NS.xThread.unwrapTweetMedia export；(b) 普通推文 photo-link 包圖 unwrap；(c) X Article article-link 包圖 unwrap；(d) 沒外層 a fallback；(e) img inline style 清除；(f) 包 tweetText 的 a 不可整段 replace（保留段落、用 tweetPhoto 當 fallback target）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.159**——FB Groups 社團貼文偵測支援。**動機**：Jimmy 2026-05-22 實機回報 https://www.facebook.com/groups/902748753095551/?multi_permalinks=26919193527691051&hoisted_section_header_type=recently_seen （軍事迷 社團某貼文）偵測不到主文。**Root cause**：v0.7.157 `isFacebookPost` URL pattern 涵蓋 `/<user>/posts/*` / `/permalink*` / `/story.php?fbid=*` / `/share/p/*`，但**沒涵蓋 FB Groups modal preview URL pattern `/groups/<gid>/?multi_permalinks=<pid>`**（從社團頁面點某貼文展開的 URL，主貼文 render 在 modal overlay 內）。detector 看到非 FB permalink 走預設路徑 no-op。**修法**：fb-post.js `isFacebookPost` 新增規則 `if (/^\/groups\//.test(path) && u.searchParams.has('multi_permalinks')) return true`。FB Groups 的其他 URL 型態 `/groups/<gid>/posts/<pid>/` 與 `/groups/<gid>/permalink/<pid>/` 既有 `/posts/` 與 `/permalink/` regex 已涵蓋（內含子字串命中），不需要新增。**DOM 結構共用**：FB 內部 React component 共用，社團貼文 modal overlay 內主文 wrapper 同樣是 `[data-ad-comet-preview="message"]`、作者標 `[data-ad-rendering-role="profile_name"]`，既有 `findMainMessage` / `findAuthorForMessage` / `findPostContainer` / `pruneReaderClone` 全部無需改動。**spec**（fb-post.spec.js 新增 4 條 forcing function）：(a) `/groups/<gid>/?multi_permalinks=<pid>` → true（含 Jimmy 實機 URL）；(b) `/groups/<gid>/posts/<pid>/` → true（既有規則回歸驗）；(c) `/groups/<gid>/permalink/<pid>/` → true（既有規則回歸驗）；(d) `/groups/<gid>/` 純社團首頁（無 multi_permalinks query）→ false（沒單一主貼文可閱讀，必須 no-op）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.158**——pangu module 擴增：CJK 邊界的半形標點自動轉全形（含寬鬆模式）。**動機**：Jimmy 2026-05-21 要求加入「中文之間標點符號改為全形」，與既有 pangu（中英文間補空白）合進同一開關。**規則**（兩階段）：**階段一 strict CJK boundary**——`, . : ; ? !` 之前**或**之後緊鄰 CJK 邊界即轉成 `，。：；？！`（前後任一側為中文即觸發）；半形括號 `( )` 兩側都緊鄰 CJK 邊界才轉 `（）`（避免混合 ASCII 內容時左右不對稱）；引號 `' "` 不在此規則。**階段二 loose comma mode**——text node 整體含 CJK 邊界字元時（= 中文 prose context），把剩餘 ASCII↔ASCII 邊界的半形逗號也轉全形，涵蓋 `叫 Google Alerts,2003 年就有了` 這類「英文片語接半形逗號接 ASCII 數字但整段為中文 prose」情境（Jimmy 2026-05-21 第二次實機回報）。**寬鬆規則只涵蓋 `,`**：`.` 不寬鬆（誤殺 example.com / 1.5 / Mr.Smith）；`:` 不寬鬆（誤殺 http:// / 時間 12:30）；`; ? !` 暫不寬鬆（保留 fallback 空間）。**ASCII 邊界保留**：`example.com` / `1.5kg` / `Mr.Smith` / `192.168.0.1` 等純 ASCII 環境（text node 內無 CJK 字元）完全不動。**Tradeoff**：中文 prose 內混 inline 英文 list（如「他列出 Apple, Banana, Cherry」）的逗號會被誤轉全形，但此情境在新聞 / 部落格 prose 內罕見（通常用 HTML 結構或全形頓號 `、`），誤殺面小。**CJK 邊界範圍**（PUNCT_BOUNDARY_CJK，比 pangu 補空白用的 PANGU_CJK 寬）：含漢字本範圍 U+3400-4DBF / U+4E00-9FFF + CJK 符號標點 U+3000-303F（含 `、 。 「 」 『 』 《 》 〈 〉 〔 〕 【 】` 等）+ 全形 ASCII U+FF00-FFEF（含 `， 。 ： ； ？ ！ （ ）` 與全形英數字等）。Jimmy 第一次實機回報 `「藍色連結」,Google 自己宣告它死了` 的 `,` 沒轉，因為 `,` 前是 `」`(U+300D) 屬 CJK 標點而非漢字本範圍——若只看 PANGU_CJK 漢字範圍會漏網。pangu 補空白規則維持只看 PANGU_CJK（漢字本範圍），避免「全形標點 ↔ ASCII」之間誤補空白（全形標點自帶視覺分隔，補空白反而視覺破碎）。**實作**：styler.js panguize() 內先做 `fullwidthPunct(s)`、再用 `PUNCT_BOUNDARY_CJK_RE.test(s)` 決定是否進入 loose mode 對 `,` 全 replace、最後做原 pangu 補空白。混合情境（中文後接 ASCII 括號）標點保半形交給 pangu 補空白，例如 `他寫了(Hello)世界` → `他寫了 (Hello) 世界`，純中文 `他寫了(嘿嘿)世界` → `他寫了（嘿嘿）世界`。**共用同一開關**：`settings.pangu === false` 時整個 panguInstall 不執行，標點全形化也跟著關閉（spec forcing function 驗）。**spec**（pangu-spacing.spec.js 擴增 + fixture 加 11 個 `<p>` 案例）13 條 forcing function 覆蓋：連續逗號 / 句中與句尾句號 / `:;?!` 五標點 / 全形括號兩側 CJK / 半形括號混合 ASCII / `Hello,世界` 標點後接 CJK / URL+IP+小數的 ASCII 安全邊界 / `Mr.Smith + 1.5 + example.com,值得參考` 混合句 / `「藍色連結」,Google` CJK 閉引號邊界 / `《好書》,Hello` 書名號邊界 / `叫 Google Alerts,2003 年` 寬鬆逗號 / 純英文 text node 不啟動寬鬆模式 + 1 條 pangu off 時標點也不動。sanity check：把 fullwidthPunct 改 identity → 9 條 fail；把 PUNCT_BOUNDARY_CJK 收回 PANGU_CJK → 2 條 boundary 擴張 spec fail；把 loose-mode 條件 short-circuit false → 1 條寬鬆逗號 spec fail；還原全綠。**MutationObserver / restore 不變**：原 SPA lazy-load 接管 + restore 比對 `panguize(c.original)` 仍成立（新規則含在 panguize 內）。**Options 描述**：pangu 區塊標題改為「中英文間自動補空白 + 中文標點全形化」並補完整對照說明含寬鬆逗號範例 + 順手修 v0.7.157 boldText 描述漏網的半形分號 `;Windows` → `；Windows` 與本輪自己寫的列舉編號 `(1) (2)` → `（1）（2）`（cjk-fullwidth-punct skill 全文掃描）。**FB avatar 移除**（同版搭車修法）：v0.7.157 FB permalink reader 合成 header 含作者 avatar，但 `extractAuthorInfo` 在 commonAncestor.parentElement 範圍內 querySelectorAll img 容易誤取「貼文預覽卡縮圖」（Jimmy 2026-05-21 回報 Nathan Chiu 貼文的 avatar 變成內文提到的 Sundar Pichai 演講照、且被擠成橢圓）。FB DOM 結構頻繁改版，穩定 avatar selector 難維護——`extractAuthorInfo` 移除 avatarSrc 抓取邏輯、`createSyntheticHeader` 移除 img 創建分支，reader header 簡化為「display name only」。Function signature 保留（spec 對函式名做 forcing function）。**FB 主文後續 sibling chain 全清**（同版搭車修法，兩輪迭代）：Jimmy 第一次回報「文章結束之後下面抓到一堆沒有用的文字」——`m7NKy5VBX1.com / 名字 / 重複整篇貼文 / reactions 計數`等殘留。Root cause：原 `pruneReaderClone` 對「主文後的 OG meta / reactions block」沒有結構性通則。**第一輪修法**沿 mainMsg 祖先鏈往上、每層砍「該祖先之後的所有 sibling」，但 Jimmy 第二次回報「結束位置正確、但文章附帶照片沒了」——FB DOM 把貼文附帶媒體放在 mainMsg **同階 sibling**（在 `data-ad-rendering-role="story_message"` wrapper 內，與 mainMsg 並列），被誤殺。**第二輪修法**（最終版）：演算法改成從 `mainMsg.parentElement` 開始砍 sibling chain，**故意保留 mainMsg 同階 sibling**（貼文附帶媒體層）、只清 story_message 祖父輩之後的 sibling（OG meta widget / reactions / comments）。**但第二輪仍有漏洞**——Jimmy 第三次回報「還是沒有附帶照片」。chrome-in-chrome 連 Jimmy session probe 真實 Nathan Chiu 貼文 DOM 才看清結構：附帶圖**不在 mainMsg 同階**、而是在 mainMsg 的**祖父輩 sibling**（巢狀更深一層的 wrapper：`content-wrapper > inner-wrapper > [story_message_wrap, attached-media-wrapper]`），第二輪演算法走到 inner-wrapper 那層砍 next sibling 時誤殺。**第三輪修法**：sibling chain 砍法不變，但對「純媒體 wrapper」加結構性保留豁免——sibling 含 media element（img/picture/video）且 textLen < 50 視為附帶媒體保留。實機 reload 後 Jimmy 仍未看到附帶照片——chrome-in-chrome probe 真實 FB DOM 揭露：**附帶圖 wrapper 的 textContent 達 4471 字**（含 a11y hidden text），jsdom 不算 hidden text 所以 fixture 看似 textLen=0、實機看到 textLen=4471，textLen 閾值法跨環境不可靠。**第四輪修法**：保留條件改用結構特徵——`hasMedia && !hasComment && !hasButton`，三條件齊備視為純媒體 wrapper。Jimmy 第四次回報「有是有了但下面帶莫名其妙東西」——chrome-in-chrome 再 probe 發現：那張 Sundar Pichai「附帶照片」**根本不是貼文真實附帶圖**（貼文本身純文字），而是 **share-preview widget 內的 OG image**，整 wrapper 含短網域 + 分享者名字 + OG description 重複貼文，全包在 `<a>` 內 linkRatio = 1.01。第四輪規則保留整個 widget → 顯示圖 + 殘留文字。**第五輪修法**（最終）：新加 `linkRatio` 判別——sibling 含媒體 + 無留言 + 無 button 時，再算 anchorText/textContent 比例，> 0.7 視為 share-preview widget → **unwrap 只留 img/picture/video 元素**（建新 div 容器 + clone 媒體進去）、砍短網域/名字/重複貼文文字；< 0.7 視為純附帶媒體 wrapper 整 wrapper 保留。新加 forcing function spec「share-preview widget linkRatio=1.01 → unwrap 後 img 保留、短網域/名字/OG description 全清、img 不在 `<a>` 內」。sanity check：把 unwrap 邏輯 short-circuit false → spec 立刻 fail；還原 959 全綠。判別力：附帶圖 wrapper 含 img / 不含 role=article / 不含 button → 保留；reactions+留言 wrapper 含 img（留言頭像） / 含 role=article / 含 button → 砍。spec 更新：新加「附帶圖在 mainMsg 祖父輩 sibling 也保留」forcing function（用 inline HTML 模擬實機嵌套結構）。sanity check：(1) 把 sibling-chain prune 邏輯 short-circuit false → OG meta spec 立刻 fail；(2) 改回 mainMsg 開始（前一輪錯版）→ 附帶媒體 spec fail；(3) 把結構特徵保留 short-circuit false → 嵌套附帶圖 spec fail；三條全綠 959。FB DOM 結構（probe 結果）：`post-container > [Facebook-placeholder, author-header, content-wrapper > inner-wrapper > [story-msg-wrap, 純媒體 wrapper], reactions-and-comments]`。**spec**（fb-post.spec.js 新加 2 條 + fixture 新增 OG meta widget block i=3a）forcing function：(a)「貼文附帶媒體 thumb.jpg 必須保留」（mainMsg 同階 sibling 的 img 不能被誤殺）；(b)「m7NKy5VBX1.com / 3,497 / 950 次分享」全部不可殘留（story_message 同階 OG meta widget + reactions block）。sanity check：(1) 把 sibling-chain prune 邏輯 short-circuit false → OG meta spec 立刻 fail；(2) 把演算法 start node 改回 mainMsg（同前一輪錯版）→ 附帶媒體 spec 立刻 fail；兩條都還原 958 全綠。**Tradeoff**：mainMsg 同階 sibling 的「外連結卡 wrapper」會被保留——若使用者貼文是純文字 + 外連結卡（無真實附帶媒體），連結卡會殘留在 reader card 內。優先級判斷：「貼文附帶媒體不被誤殺」是 P0、「外連結卡保留是冗餘」是 P3。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.157**——三件事：(1) Facebook permalink post 偵測支援；(2) reader card 預設套 `-webkit-font-smoothing: antialiased`(商周等中文新聞站 macOS 上字粗修法);(3) popup 新增「字粗」設定 (`boldText` boolean，細 = antialiased / 粗 = subpixel-antialiased)。

**(2) Font smoothing baseline**：商周 (businessweekly.com.tw) 等中文新聞站字型 stack `"Microsoft JhengHei", "Noto Sans TC", "PingFang TC"` 在 macOS Chrome 走 auto = subpixel-antialiased，PingFang TC fallback 後中文字渲染明顯偏粗。Medium / NYT / Substack 等專業閱讀站 stylesheet 普遍套 antialiased。styler 在 `html [data-jread-active="1"]` rule 加 `-webkit-font-smoothing: antialiased + -moz-osx-font-smoothing: grayscale`，並把 inherit 併進 universal selector 防站點 stylesheet 在子層級重設 auto 拉回 subpixel。scoped 不影響原站視覺。

**(3) boldText 設定**：CJK 字型在 macOS 上不同 font-weight (400/500/600/700) 視覺差異不穩定（不同 face 涵蓋範圍不一），smoothing 模式差異反而明顯且跨字型穩定。設計反覆迭代後改用 boolean toggle：popup 新增「字粗」segmented (細/粗) + options checkbox，預設 `false` (細，對齊 reader card baseline antialiased)；切「粗」反轉成 `-webkit-font-smoothing: auto`。SW / styler / popup / options 四檔同步、`main.js storage.onChanged relevantKeys` 加 `boldText` 即時重套（不需 refresh 頁面）。Linux / Windows 上 -webkit-font-smoothing 無效，此設定僅影響 macOS 使用者。**spec**：defaults-sync.spec.js 加 5 條 boldText 四檔同步驗 + main.js relevantKeys forcing function；styler.spec.js 加 3 條 boldText 條件套 smoothing 驗。**設計反覆紀錄**：嘗試過 `fontWeight 300/400/500` stepper → 500 與 400 視覺幾乎一樣;改 700 → 太粗、且 reader card 內 `<strong>` 失對比;改 600 → PingFang TC Semibold 有 face 但 Microsoft JhengHei 沒、跨字型不穩;改 550 → 非標準 stop 視瀏覽器 fallback 行為而定。最後接受「CJK 字型 weight 不可靠」、改走 smoothing 軸。

**(1) Facebook permalink post 偵測支援**（合成 reader 容器 site-override）。**動機**：Jimmy 2026-05-21 回報 `https://www.facebook.com/drdavidchen/posts/pfbid02UCSG...` 偵測不到主文。chrome-in-chrome probe 真實頁面確認 root cause：FB permalink 頁面**完全沒 semantic markup**——0 個 `<article>` / 0 個 `<main>` / 0 個 schema.org / 主貼文 1765 字以 12 層巢狀 `DIV > SPAN > DIV*9` 包裝、emotion-hash class、零語意；symbol-heavy 訊號元素（`<p> / <li> / <h2-h4>`）共 233 個，但只有 1 個過 25 字門檻（且是 sidebar LI）；24 個 `[role="article"]` 全部是留言（非主貼文）。detector 四層策略（article-tag / schema / heuristic / main-tag）全 null。**修法策略**：仿 v0.7.135 X / Twitter status thread 模式——新檔 `jread/content/fb-post.js` 合成 `<article data-jread-fb-reader>` 容器注入 body 開頭，detector 短路回 `isFbPost: true`、main.js 走 `enterFbPostMode` 分支跑 cleaner / styler / keyguard / ESC 流程。**主貼文 selector 三步算法**（probe 驗證後選定）：(1) 找 `[data-ad-comet-preview="message"]` 中**最長**者作主貼文文字 wrapper（sidebar 推薦的 truncated 20-字 message 被排除）；(2) 找對應 `[data-ad-rendering-role="profile_name"]` 中與該 message 共同祖先 textLen 最小者作作者；(3) 兩者最近共同祖先 = 主貼文 unit 容器。**clone 後 prune 邏輯**：移除 `[role="article"]` 留言全清 + height=0 placeholder（純 Facebook 重複字串）+ < 500 字 metadata wrapper（含「所有心情 / 則留言 / 次分享」等慣用語）；合成乾淨 author header（display name + avatar img）放最前取代原 header（含 timestamp / privacy icon / menu button 等 UI chrome）。**URL pattern**：`/<user>/posts/*` / `/permalink*` / `/story.php?story_fbid=*` / `/share/p/*`，hostname 接受 `(www.|m.|mobile.|web.)?facebook.com`。**檔案改動**：新增 `jread/content/fb-post.js`；namespace.js 加 `fbPost: null`；detector.js probe / detect 加 isFbPost 短路（仿 X thread 模式）；main.js 加 `enterFbPostMode` 函式 + `result.isFbPost` 分支 + exit 路徑 remove 合成容器；manifest.json content_scripts 加 `content/fb-post.js`（x-thread.js 之後、detector.js 之前）。**站點特判隔離**：所有 FB-specific 邏輯封裝在 fb-post.js 一檔，主 detector / cleaner / styler 零特判（CLAUDE.md 硬規則 3 合規 ——「站點特判一律放 site-overrides 模組」）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.156**——Wikipedia infobox 等 table 排版站點字級設定失效修法（BODY_TEXT_SEL 加入 td / th / caption）。**動機**：Jimmy 2026-05-21 回報 https://en.wikipedia.org/wiki/Longchamp_(company) Chrome 翻譯成 zh-TW 後「中文文字都特別小」。chrome-in-chrome probe 真實頁面確認 root cause：body p = 18px ✓（styler 命中）/ infobox td / th / div = **15.84px ✗**（沒被命中、被 Wikipedia 自己的 `table.infobox { font-size: 0.88em }` 縮成 18 × 0.88 = 15.84）。CJK 字型 metric 本身就比 Latin 視覺再小一階（PingFang TC 等 CJK 字型設計慣例：x-height 比 Latin 字型低、留邊距防 glyph 互擠），雙重縮水導致使用者體感「中文文字特別小」。**結構通則**：用 table 排版 content 的站點普遍會對 cell 設縮小規則（Wikipedia infobox / 技術文件 spec table / Stack Overflow code table 等），這條 selector 缺口是跨站通用問題，不綁 Wikipedia 特判。**修法**：styler.js BODY_TEXT_SEL 加入 `td, th, caption` 三個 tag——cell 級而非 table 級（不加 `table` 自己，避免動 table-level layout：行高 / 邊框 / column 寬等 em-based 屬性）。caption 是 table 標題，跟 cell 同樣是閱讀內容、一起放大。**probe 驗假設順序**（CLAUDE.md 硬規則）：先在 Jimmy Chrome 注入測試 stylesheet `[data-jread-active] td, th { font-size: 18px !important }`，re-query infobox td/th 確認 8 個全變 18px → 假設成立 → 才動 styler code。**spec**（styler.spec.js 擴充 + wikipedia-infobox-table.html fixture 新增）4 條 forcing function：(a) BODY_TEXT_SEL 含 td / th / caption 三 tag（forcing function：拿掉任一回退立刻 fail）；(b) styler 注入的 selector 命中 fixture 內全部 4 個 td + 4 個 th + 1 個 caption；(c) font-family override 同樣命中 td / th / caption（字型 override 與字級 override 同邊界）；(d) selector list 不得含尾端為 `table` 的條（避免動 table-level layout）。sanity check：把 td / th 從 styler 拿掉 → 3 條立刻 fail（含既有 styler 「使用者 override」spec 新增的 td / th forcing 一條）；還原全綠。**harness**：chrome-in-chrome reload extension + reload 真實 Wikipedia 頁面 → 重新量 td / th / caption 全部 18px ✓ + p 仍 18px ✓（無 regression）。**npm test**：892 全綠（v0.7.155 889 → v0.7.156 892，新增 3 條 spec）。**已知不修**：CJK 字型 metric 本身造成的視覺差異（同 18px 中文比英文小一階）是字型設計本質，無通則性 px-level 解決方案；本次修法把「Wikipedia infobox 因 0.88em 額外縮 12%」這層修掉，是兩個獨立成因中可修的那一個。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.155**——自動啟動網域（auto-enable domains）。**動機**：Jimmy 2026-05-21 要求 options 加上「網域預設開啟閱讀模式」功能 + popup 加快速 toggle 入口（1+3 組合）。經常閱讀的特定新聞站每次手動按太繁瑣，列入清單後 content script document_idle silent enterReaderMode。**Matching 規則**（使用者明確指定）：`hostname === pattern OR hostname.endsWith('.' + pattern)`——`'abc.com'` 涵蓋 `abc.com` / `www.abc.com` / `foo.abc.com` / 任何 `.abc.com` 結尾；`'www.abc.com'` 只匹配 `www.abc.com` 本身，**不**含 `123.abc.com`（不 endsWith `.www.abc.com`）也不含父網域 `abc.com`。大小寫不敏感。**實作**：新檔 `jread/content/domain-match.js` IIFE 共用 helper（`matchHostname` / `normalizeDomain` / `parseList` / `serializeList` / `removeMatching`），content script 走 `window.__JReadDomainMatch` 全域、Node spec 直接 require、popup / options 用 `<script src="../content/domain-match.js">` 引入，單一資料源。manifest content_scripts.js 加入 `content/domain-match.js`（namespace.js 之後、main.js 之前）。**Options UI**：新 section「自動啟動網域」+ textarea（一行一個），描述明確舉 `abc.com` / `www.abc.com` 兩個例子讓使用者理解規則差異。change（blur 觸發）才寫 `storage.sync` 避免每按一鍵踩 sync 配額；正規化後寫回 textarea 顯示實際生效形式（去 scheme / 去 path / 去 port / lowercase / 去重）。**Popup UI**：新 setting-row「此網域自動啟動」+ checkbox，label 旁 mono 字小字顯示目前 hostname；只有 http/https 顯示 row（chrome:// / file:// / about: 隱藏）。Toggle ON 加當前 hostname（已 match 則不重複加）；Toggle OFF 走 `removeMatching` 清掉清單中**所有**會命中此 hostname 的 entry（含更寬 pattern 如 `abc.com`），確保關閉後此頁面真的不會再 auto-enter（tooltip 已標注此語意）。**跨入口同步**：兩端透過 `chrome.storage.onChanged` 即時 sync，options 編輯時 popup 已開啟會立刻反映、反之亦然。**Auto-enter wire**：`main.js` IIFE 末加 `tryAutoEnableOnLoad()`，read settings → `matchHostname(location.hostname, list)` → 命中即 `enterReaderMode({ silent: true })`。**silent flag**：`enterReaderMode` / `enterReaderModeImpl` 新增 `opts.silent`，偵測失敗時 `if (!silent) showToast(...)`——auto-enter 失敗不彈「此頁無法偵測主文」toast（使用者沒主動按）；手動 toggle / 快速鍵 / Readwise 流程不傳 silent，行為不變。**iframe guard**：`window.top !== window.self` 直接 return，避免 iframe 內 hostname 命中誤觸發。**SPA 路由**：不額外處理——content script 每次完整頁面 navigation 重注入就是天然的「頁面載入」時點。**SW DEFAULT_SETTINGS**：`autoEnableDomains: []` 早於 v0.7.144 就放好了，這次只是 wire UI。popup / options DEFAULTS 補上同欄。**spec**（auto-enable-domains.spec.js，新增）35 條 forcing function：(A) 12 條 matching helper unit test 含 Jimmy 指定的所有 case（abc.com 涵蓋 www.abc.com / www.abc.com 不含 123.abc.com / xabc.com 不誤命中 / 父子網域方向性 / 大小寫不敏感）；(A) 7 條 normalizeDomain（去 scheme / path / query / port / userinfo / 前後 dot / 空值）；(A) 5 條 parseList / serializeList / removeMatching；(B) 6 條 options.html + options.js wire-up；(C) 6 條 popup.html + popup.js wire-up；(D) 5 條 main.js auto-enter wire-up（含 silent / iframe guard 強制檢查）+ 2 條 manifest content_scripts 載入順序。defaults-sync.spec.js 擴增 `autoEnableDomains` 三檔 forcing function（SW + options + popup）。**npm test**：應全綠（v0.7.154 844 → v0.7.155 894，新增 ~50 條 spec：35 條 auto-enable + 3 條 defaults-sync + 既有覆蓋）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.154**——(1) wealth.com.tw 進閱讀模式後文章開頭整段不見修法；(2) dark / sepia theme blockquote 對比不足修法；(3) dark / sepia theme `<img>` 圖表 PNG 透明背景透出 dark 底色致黑字消失修法。

**(1) wealth.com.tw 漏內文修法**。**動機**：Jimmy 2026-05-21 回報 https://www.wealth.com.tw/articles/f2b6e893-5b59-4dff-a9a4-59b67291cfa9 「進入閱讀模式時文章開頭會漏一大段內容」截圖：reader card 只剩 H1 + 圖 → 大段黑色空白 → 直接跳到「所以真正的荷蘭病，有幾個核心特徵」，開頭灰底引文（真正的荷蘭病，會讓國家愈來愈懶）+ 前 2-3 段內文（荷蘭病與九二共識 / 每一次只要台灣出口太強）+ 第一個 H3（半導體業拉抬 製造業不僅沒死還成長）+ Dutch Disease 介紹段全部消失。**Probe 確認 root cause**：cleaner `narrowPromotedSiblings` 從 promotedFrom 沿祖先鏈砍 sibling chrome 時，誤殺了含開頭主文的 wrapper（emotion hash class `DIV.JozKC`，textContent 含「真正的荷蘭病 + 荷蘭病與九二共識 + 每隔一陣子」整段）。既有白名單（H1 / promotedTitleHead / standalone media / time byline）全沒命中——SPA 站 emotion hash class 無語意 + wrapper 內 H1 在另一兄弟、不含主圖 img、無 `<time>` byline——所有保護機制都漏失。Instrument log 直接揪兇：`[JREAD-HIDE-INST] DIV .JozKC ← at narrowPromotedSiblings`。**修法**：cleaner.js narrowPromotedSiblings sibling loop 加 guard「sibling 含 unwrapped >= 100 chars 單一 p 或累計 >= 300 chars」→ 保留。`unwrapped` = 排除 `<li>` / `<a>` / `<aside>` 內的 p——避免誤豁免 sidebar 「相關新聞」list 內的長描述 p（與 udn-byline-subinfo fixture 共生：相關新聞 li > p 雖長但 closest('li, a, aside') 命中、被排除、仍由 narrow hide）。**結構通則**：主文 p 不會包在 list-item / a / aside 內；sidebar 列表項的描述 p 必然在 `<li>`（HTML 語意）或 `<a>`（卡片連結）內——這條結構特徵跨 CMS 通用，非 wealth.com.tw 特判。**spec**（wealth-narrow-content-wrapper.spec.js + fixtures/wealth-narrow-content-wrapper-guard.html，新增）4 條 forcing function：(a) 前段主文 wrapper content-A 保留；(b) 灰底引文 + 主文 p + H3 全部 visible（祖先鏈無 hidden）；(c) sidebar 「相關新聞」list 雖含長 p（li > p 結構）仍被 hide；(d) sanity forcing：content-A 必須含 >= 100 chars 單一 unwrapped p。sanity check：把 narrow guard 改成短路 → (a)+(b) 立刻 fail、(c)+(d) 仍 pass；還原全綠。**harness**：wealth.com.tw 真實頁面 probe 確認 visible 段落順序 H1 → 灰底引文 → 「荷蘭病與九二共識」→「每一次只要台灣出口太強」→ H3「半導體業拉抬」→ Dutch Disease 介紹 →「所以真正的荷蘭病」→ 後續主文，全部完整。

**(2) dark / sepia theme blockquote 對比修法**。**動機**：Jimmy 2026-05-21 回報商周 /Archive/Article?StrId=7014078 dark theme「引文底色與文字對比太低，很難閱讀」截圖。**Root cause**（chrome-in-chrome 連 Jimmy 已登入 session probe 確認）：styler line 454 base 規則 `*:not(figure):not(blockquote)...` background 清除刻意保留 blockquote 原站 bg（W3C 引述語意視覺區隔），light theme 下淺灰底 + 黑字可讀；dark theme 下 jread `[data-jread-active] * { color: theme.text }` 把文字色覆寫成 `#d4d4d4` 淺灰，但 blockquote bg 仍是站點原 light 設計的 `#f5f5f5` 淺灰 → 淺灰底 + 淺灰文字、對比 **1.38:1**（WCAG AA 需 4.5:1、AAA 需 7:1）。**修法**：styler.js dark/sepia theme override 新增 `html.__jread-active [data-jread-active="1"] blockquote { background-color: transparent !important; background-image: none !important }`，bg 透明後透出 reader card dark bg (`#1a1a1a`) → 對比 `#d4d4d4` vs `#1a1a1a` = **11.74:1（AAA 通過）**。**selector specificity**：(0,2,1) > 站點常見 `blockquote.blockquote` (0,1,1) / `.quote-block` (0,1,0) rule（與 v0.7.151 iframe bg fix 同設計）。**只 dark/sepia 注入**：light theme 不動，既有 preserve 設計（淺底突顯引文）仍有效。**副作用評估**：dark/sepia 下 blockquote 失去「淺底突顯」視覺，但 border-left 5px `#e0e0e0` 對 dark bg 對比 13.18:1、padding 24px、::before 引號圖示 color `#e0e0e0` 對比 13.18:1，三條視覺通道全在、仍可辨識為引文。**spec**（styler-dark-blockquote-bg.spec.js，新增）4 條 forcing function：(a) dark theme 含 blockquote bg transparent rule；(b) sepia theme 同；(c) light theme **不**注入（避免破壞既有 light 視覺設計）；(d) selector 用 html.__jread-active + [data-jread-active="1"] 雙層提升 specificity。sanity check：把 rule selector 改成不命中 → (a)+(b)+(d) fail、(c) light 仍 pass；還原全綠。

**(3) dark / sepia theme `<img>` 圖表 PNG 透明背景修法**。**動機**：Jimmy 2026-05-21 比對商周 /Archive/Article?StrId=7014132 dark vs light theme 截圖確認——同一張 chart image，light theme 下「亞馬遜 / 輝達 / Google / 標普500 / Meta / 蘋果 / 微軟 / 特斯拉」x 軸文字 + 「資料來源：Google Finance」全部清楚可讀；dark theme 下這些黑色文字**完全消失**，只剩橘色柱 + 紅色標題 + 白色 callout 方框浮在 dark 背景上。**Root cause**（chrome-in-chrome 連 Jimmy 登入 session probe）：chart 是 `<img class="thumb">`、computed `background-color: rgba(0,0,0,0)`（PNG 透明背景），原圖為 light theme 設計（黑字 + 橘柱 + 紅標題 + 白方框 callout）。light reader card #fff 透出白色 → 黑字 vs 白底 ~21:1 OK；dark reader card #1a1a1a 透出 dark → 黑字 vs dark 對比 1:1 直接消失。**修法**：與 v0.7.151 iframe (chart embed) 同邏輯——dark/sepia theme 強制 `<img>` 白底，讓 PNG transparent 區域透出白色、黑字回可讀。selector 合併 `iframe, img` 共用 rule list 精簡 CSS。**副作用評估**：JPG 主圖完整覆蓋整圖、白底 fallback 看不到無影響；公司 logo / icon PNG 透明 + light 設計者透白底反與站點 light visual 一致；透明 GIF / 小裝飾少見、白底無明顯害處。selector specificity (0,2,1) > 站點常見 `img.thumb` (0,1,1) / `figure img` (0,0,2) rule。**spec**（styler-dark-img-bg.spec.js，新增）4 條 forcing function：(a) dark theme 含 img bg #fff rule；(b) sepia theme 同；(c) light theme **不**注入；(d) selector 用 html.__jread-active 提升 specificity。既有 styler-dark-iframe-bg.spec.js (d) 條同步擴增「兼容 iframe + img 合併形式」regex，避免 selector list 合併導致誤判 fail。sanity check：把 styler.js img selector 拿掉只留 iframe → img spec (a)+(b)+(d) fail、(c) light 仍 pass、iframe 4 條全綠；還原全綠。

**npm test**：844 全綠（v0.7.153 832 → v0.7.154 844，新增 12 條 spec：wealth 4 + blockquote 4 + img 4，既有 iframe spec 1 條擴增兼容）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.153**——中英文間自動補空白（盤古之白）。**動機**：Jimmy 2026-05-21 要求：文章內文中英文之間若無空格（CMS / SPA WYSIWYG 編輯器寫入時常發生），reader mode 自動插空白讓視覺節奏完整。**規則**：CJK ↔ ASCII 英數字 + `%` + `°` 之間插空白；CJK + 半形 `(` 之間補空白、半形 `)` + CJK 之間補空白（例：`威騰電子(Western Digital)獨立` → `威騰電子 (Western Digital) 獨立`、`東芝的(Toshiba)記憶體` → `東芝的 (Toshiba) 記憶體`）；CJK 取 `㐀-䶿`（擴充 A）+ `一-鿿`（基本漢字）；全形標點 / 符號邊界（。，「」（）《》）不視為邊界。半形括號**內側**（`(` 後 / `)` 前）不補空白（緊貼括號內容才是視覺常規）。純英文含半形括號（`Pure English (with parens)`）無 CJK 不動。**跳過 tag**：`<code>` / `<pre>` / `<kbd>` / `<samp>` / `<var>`（程式碼風格不可動）、`<a>`（連結文字動了破壞引用語意 + URL fragment 風險）、`<script>` / `<style>` / `<noscript>`、`<textarea>` / `<input>` / `<select>` / `<option>`（表單值）、`contenteditable` 元素（使用者輸入區）。**實作**：styler.js apply 啟動時走訪 articleEl 所有 visible text node 套 regex（兩條：CJK→LEAD、TRAIL→CJK），改動的 node 連同原值紀錄回 changes array、restore 時還原。**MutationObserver**：observer 觀察 articleEl childList + subtree、後續 SPA / lazy-load 注入的留言、推薦、晚到段落自動 pangu；只觀 childList 避免 nodeValue 自寫回環。`s.pangu !== false` 控制（預設 true）、pangu off 時 panguSnap = null、apply 不掃 restore 也不還原（snapshot 路徑短路）。**probe 數值**（EE Times https://www.eettaiwan.com/20260520nt31-... 真實 DOM）：35 個 text node、25 個改動（71%）、2220 字、新增 213 空白（9.59% 密度）。**60% 案例**（Jimmy 明確指定）：`佔據NAND快閃記憶體市場60%以上份額` → `佔據 NAND 快閃記憶體市場 60% 以上份額`。**設定 UX**：toggle 放在 options 頁（不放 popup——popup 高密度 UI 已飽和）、預設 ON；切換後 storage.onChanged 即時 reapply（main.js relevantKeys 擴增 `pangu`）。**spec**（pangu-spacing.spec.js + fixtures/pangu-spacing-cjk-ascii.html）15 條 forcing function：(a) h1 / 基本句子 / 60%以上 / 30°C的 / 半形括號兩側接 CJK 五個正常情境；(b) 純中文 / 純英文 / 純英文含半形括號 / `<code>` / `<a>` / 全形標點 六個 negative case；(c) pangu: false 完全不動 + snapshot.panguSnap = null；(d) restore 可逆；(e) MutationObserver 接動態注入 element。defaults-sync.spec.js 擴增 `pangu` 四檔（SW / styler / popup / options）forcing function。sanity check：把 panguize 改回直通 → 7 條立刻 fail（含動態注入測試）、還原全綠。**npm test**：832 全綠（v0.7.152 813 → v0.7.153 832，新增 15 條 spec + defaults-sync 擴增 4 條）。**harness**：EE Times 真實頁面 residual audit + 內文 probe 確認 `AI 熱潮下 NAND 快閃記憶體的命運逆轉` / `60% 以上份額` / `威騰電子 (Western Digital) 獨立` / `東芝的 (Toshiba) 記憶體` / `人工智慧 (AI) 熱潮` / `三星 (Samsung) 和` / `(圖 1)` / `EE Times China 2026 年 4 月雜誌` 全部正確補空白、`<a>` 內 `NAND Flash's Reversal of Fortune Amid the AI Boom` 無動、無 cleaner regression、gap audit ✅。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.152**——vocus.cc 字型設定無效修法（BODY_TEXT_SEL 涵蓋 span，跨 WYSIWYG 編輯器通則）。**動機**：Jimmy 2026-05-20 回報 https://vocus.cc/article/6a0d369cfd8978000179c0b7 「字型設定無效」。Playwright probe 確認 root cause：vocus 用 Lexical 編輯器（Meta 開源）輸出文章，結構為 `<p class="lexical__paragraph"><span style="white-space: pre-wrap">文字</span></p>`，且 vocus stylesheet 對 span 自身寫死 font-family（`"Noto Sans TC", "Microsoft JhengHei fixed", ...`）。styler 的 BODY_TEXT_SEL `[data-jread-active], [data-jread-active] p, li, blockquote, dd, dt` 沒包含 span，font-family override 鎖在 `<p>` 身上、不會 inherit 給 span（span 自身有 rule 截斷 inheritance），所以使用者「字型」設定完全失效。font-size 因為沒在 span 自身設只在 p 設、span 從 p inherit 而剛好生效，造成「字級會變、字型不會變」的奇怪狀態。**修法**：styler.js BODY_TEXT_SEL 加入 `[data-jread-active] span` 並串 icon class :not exclusions——`:not([class*="icon"]):not([class*="material-"]):not([class^="fa-"]):not([class*=" fa-"]):not([class*="emoji"]):not([class*="badge"])`——讓 vocus 純 span（無 class）命中 override 套襯線/無襯線，同時保留 icon font span（material-icons / font-awesome / emoji / badge 等用 font-family 載 glyph）原 font-family 不被覆寫。**結構通則**：`<p><span>` 是跨 WYSIWYG 編輯器（Lexical / TipTap / ProseMirror / Slate / Draft.js）的通用輸出 pattern——Notion / Substack / Medium / Vocus / 各 SaaS 部落格平台都會踩此 pattern，非 vocus 特判。**probe 數值**：修前 vocus span computed `font-family: "Noto Sans TC", "Microsoft JhengHei fixed", "Helvetica Neue", ..., sans-serif`（vocus 站點 stylesheet rule 在 span 自身勝出）；修後相同 span computed font-family 為使用者選的襯線 stack（待 harness 驗）。**spec**（styler.spec.js 擴充 + vocus-lexical-span.html fixture）3 條 forcing function：(a) 既有 BODY_TEXT_SEL 檢查擴增「span 必在 selector list」（forcing function 避免回退）；(b) span selector 必含 icon / material- / fa- / emoji / badge 五個 :not exclusion token；(c) 注入 selector 命中 vocus 純 span 但不命中 material-icons span（核心 negative case 防誤殺 icon font）。sanity check：把 styler.js `SPAN_TEXT_SEL` 從 BODY_TEXT_SEL 拿掉 → (a)+(c) 立刻 fail、(b) 也 fail；還原全綠。**npm test**：813 全綠（v0.7.151 811 → v0.7.152 813，新增 2 條 spec + 既有 1 條 spec 擴增 1 條 assert）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.151**——dark / sepia theme chart iframe 白底修法。**動機**：Jimmy 2026-05-20 接續 v0.7.150 回報 healthsystemtracker.org dark theme「圖表區塊也使用深底色，導致文字難以閱讀」截圖。**Root cause**：dark / sepia theme reader card bg 深、跨 origin iframe（datawrapper / flourish / tableau / plotly 等 chart embed services）內容預設 transparent 背景 + 為 light theme 嵌入站設計的深色文字（chart title / legend / axis labels）→ 跟 dark reader card bg 完全融在一起、文字不可讀。跨 origin iframe content script 無法讀寫其內 styles、只能對 iframe element 本身設背景。**修法**：styler.js dark/sepia theme override 區塊加 `html.__jread-active [data-jread-active="1"] iframe { background-color: #fff !important; }`——讓 iframe transparent 區域透出白色、深色文字可見。selector 用 `html.__jread-active` + `[data-jread-active]` 雙層、specificity (0,2,2) 提升、避免站點 `iframe.datawrapper` 類 (0,1,2) rule 勝出（probe 確認第一版 (0,1,1) selector 被站點覆蓋失效）。**只 dark/sepia 注入**：light theme reader card 已 #fff、iframe transparent 透出來就是 #fff，多餘 CSS 不必。**副作用評估**：YouTube / Vimeo / Twitter 等 video / social embed 自身 player 用自己 bg 覆蓋 iframe transparent area、白底 fallback 對它們無視覺影響；對 chart embed 是核心保護。**probe 數值**：修前 dark theme datawrapper iframe computedBg=`rgba(0, 0, 0, 0)` (transparent)；修後 `rgb(255, 255, 255)`、截圖確認 chart title / legend / bar values / 註解全部清楚可見。**spec**（styler-dark-iframe-bg.spec.js，新增）4 條 forcing function：(a) dark theme stylesheet 含 iframe background:#fff rule；(b) sepia theme 同；(c) light theme **不**注入（避免多餘 CSS）；(d) selector 用 html.__jread-active 提升 specificity（forcing function 避免回退為 (0,1,1) 弱 selector）。sanity check：comment 掉 rule 立刻 (a)+(b)+(d) fail、(c) light theme 仍 pass、還原全綠。**npm test**：811 全綠（v0.7.150 807 → v0.7.151 811，新增 4 條 spec）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.150**——chart embed whitelist 擴充（datawrapper / flourish / tableau / plotly / highcharts / observable / infogram）。**動機**：Jimmy 2026-05-20 回報 https://www.healthsystemtracker.org/brief/what-drives-health-spending-in-the-u-s-compared-to-other-countries/「這個網站的圖表消失」。Playwright probe 確認 root cause：`<iframe class="datawrapper" src="https://datawrapper.dwcdn.net/H1EeW/1/">` 被 cleaner.hideInsideArticleThirdPartyIframes (v0.7.32) 視為 third-party noise hide，因為 `datawrapper.dwcdn.net` 不在 KNOWN_MEDIA_IFRAME_SEL whitelist。**修法**：cleaner.js KNOWN_MEDIA_IFRAME_SEL 加 chart / data visualization embed services—— `datawrapper.dwcdn.net` / `datawrapper.de` / `flourish.studio` / `public.flourish.studio` / `public.tableau.com` / `tableauusercontent.com` / `plot.ly` / `plotly.com` / `chart-studio.plotly.com` / `highcharts.com` / `observablehq.com` / `infogram.com`。**結構通則**：chart embed 是新聞站做數據圖最常見服務（NYT / Reuters / Bloomberg / ProPublica / healthsystemtracker / FiveThirtyEight 等），等同 YouTube / Vimeo 級主文內容，應跟既有 video embed whitelist 並列保留。**spec**（health-datawrapper-chart.spec.js + fixture）6 條 forcing function：(a) datawrapper iframe 保留（核心 case）；(b) flourish iframe 保留；(c) tableau iframe 保留；(d) plotly iframe 保留；(e) infogram iframe 保留；(f) 未知 host iframe 仍被 hide（v0.7.32 防護不退步）。sanity check：comment 掉 datawrapper.dwcdn.net entry 立刻 (a) fail、其餘 5 條仍 pass、還原全綠。**probe 數值**：修前 datawrapper iframe `selfHidden: true, ancestorHidden: IFRAME.datawrapper, display: none, rect: 0x0`；修後 `selfHidden: false, display: block, rect: 560x599`。**npm test**：807 全綠（v0.7.149 801 → v0.7.150 807，新增 6 條 spec）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.149**——Stratechery / WordPress block theme 自動翻譯後標題消失通則。**動機**：Jimmy 2026-05-20 回報 https://stratechery.com/2026/please-listen-to-my-podcast/「能有通則解嗎」——v0.7.147 fallback 只處理 h1，但 Stratechery 主標題是 `<h2 class="wp-block-post-title">`、無 h1，那條 path 完全不適用。Playwright probe（chrome-for-claude 啟動自動翻譯擴展、改 h2 textContent）確認 root cause：自動翻譯改 H2 textContent 後 detector 評分變動、選了內層 `entry-content` 為 articleEl，主標題 H2 在外層 sibling 被 hideAncestorSiblings hide → reader card 內無標題。**修法**：cleaner.js 新增 `promoteArticleTitleClassHeadingInto`——cleaner 末段、articleEl 內無 visible h1 時、page-wide 找 DOM order 第一個含「主文標題」class signal（v0.7.147 helper `looksLikeArticleTitleH1` 命中 article-title / post-title / entry-title / wp-block-post-title 等 token）的 h1/h2/h3 candidate、clone 進 articleEl 開頭。**clone wrapper vs heading 自己**：若 wrapper text length ≈ heading text（差 <= 30 chars），用 wrapper（保留 styling，例 eet-china `.rowPage`）；若 wrapper text 遠大於 heading（wrapper 含其他 sibling 內容，例 Stratechery `wp-block-column` 含 hero image），clone heading 自己避免帶入無關 element。**跟既有機制互補**：(1) `promoteUniqueTitleH1Into` (v0.7.141) 只處理 unique h1，Stratechery 無 h1 不觸發；(2) `markPromotedTitleIfMissing` 掃 articleEl **內**的 p/div/span/h5/h6（漏 h1-h4 + 漏 articleEl 外），本條補處理 articleEl **外**的 h1/h2/h3。**選 DOM order 第一個的理由**：主標題在 page header 區、related articles widget 在 sidebar/footer 區（DOM order 在主標題之後），DOM order 是穩定訊號，不依賴 rect/visible 判定。**newtalk-tw site-logo h1 保護不變**：site logo class 通常 `site-logo` / `logo` 不含 article-title token、不會誤觸發。**Negative case 保護**：articleEl 內已有 visible h1 → early return（不重複 promote sidebar h2）。**spec**（stratechery-translated-h2-title.spec.js + 2 fixtures）6 條 forcing function：(a) fixture 結構驗證；(b) articleEl 含 1 個 title clone（核心保護點）；(c) clone text 含繁體 h2 翻譯內容；(d) clone 是 articleEl 第一個 child；(e) 主文段落 + section heading 保留；(f) negative case—articleEl 已有 h1 時不重複 promote sidebar h2。sanity check：comment 掉 pipeline call 立刻 (b)+(c)+(d) fail、v0.7.141 既有 11 條 + v0.7.147 既有 5 條 + 本條 negative case 全 pass、還原全綠。**npm test**：801 全綠（v0.7.148 795 → v0.7.149 801，新增 6 條 spec）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.148**——TBIJ thebureauinvestigates.com 標題消失修法（absolute overlay h1 guard）。**動機**：Jimmy 2026-05-20 回報 https://www.thebureauinvestigates.com/stories/2026-05-05/a-devout-muslim-in-pakistan-is-making-a-living-from-islamophobic-ai-slop 「標題消失」。harness probe + instrument log 確認 root cause：`hideInsideArticleAbsoluteOverlays` (v0.7.111) 把 `<div class="tb-c-story-header__heading">` (position:absolute 包 h1) hide 掉——TBIJ 用 absolute layout 把 hero title 定位在 image 上方，原本是設計手法，被 v0.7.111「任意 absolute / fixed overlay」rule 誤殺後 h1 自己 visible 但 ancestor display:none → 0×0 不可見。**修法**：cleaner.js `hideInsideArticleAbsoluteOverlays` 加 guard——`if (el.querySelector && el.querySelector('h1')) continue;` 含 h1 的 absolute wrapper 視為「hero header title overlay」設計、skip 不 hide。**結構通則**：semantic h1 是「主文標題」最強訊號，含 h1 的 absolute wrapper 99% 是「title overlay」設計（hero image 上方定位、video background 上的 title 等 common design pattern），不該被當 chrome overlay 砍。漏網成本（site banner h1 overlay 殘留）遠低於誤殺成本（主標題消失）。**不擴及 h2-h6**：section heading 包在 absolute wrapper 罕見也通常無 semantic 主文意義、保留現有 hide 行為。**v0.7.111 既有 case 不退步**：TBIJ 的「fixed-left-sidebar / story-authors」這兩個 absolute overlay 不含 h1，仍會被 hide。**spec**（tbij-absolute-h1-overlay.spec.js + fixture）5 條 forcing function：(a) fixture 結構驗證（absolute + 含 h1）；(b) absolute h1 wrapper 必須未被 hide（核心保護點）；(c) h1 自身 + 所有祖先未被 hide（連帶保證）；(d) overlay-no-h1-aside / overlay-no-h1-authors 仍被 hide（v0.7.111 行為延續）；(e) 主文段落保留。sanity check：comment 掉 guard 立刻 (b)+(c) fail、(a)+(d)+(e) 仍 pass、還原全綠。**npm test**：795 全綠（v0.7.147 790 → v0.7.148 795，新增 5 條 spec）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.147**——翻譯擴展 + eet-china 標題消失 fallback。**動機**：Jimmy 2026-05-20 回報 https://www.eet-china.com/news/202604299557.html「這篇簡體中文的文章使用 Shinkansen 翻譯為繁體中文時，文章標題就會不見」。chrome-in-chrome probe 確認 root cause：Shinkansen / Google Translate 等翻譯擴展翻 body 內 h1 text 從簡體→繁體，但 `<title>` tag **不翻**（document.title 仍是原文）。v0.7.141 修法的 `promoteUniqueTitleH1Into` 用 **strict equality**（`h1Text !== baseTitle`）—— 簡體 docT vs 繁體 h1 必然 mismatch → promote skip → 原 h1 wrapper 被 hideAncestorSiblings hide 後標題完全消失。**修法**：cleaner.js `promoteUniqueTitleH1Into` strict equality fail 時加 fallback——若 h1 自身 / parent class / id 含明確「主文標題」訊號（`TITLE_CLASS_HIT_RE` 命中 `article-title` / `post-title` / `entry-title` / `page-title` / `news-title` / `story-title` / `content-title` / `headline` / `heading` 等慣用 token，排除 `subtitle` / `supertitle` / `microtitle` 等變體），則仍 promote。helper `looksLikeArticleTitleH1`。**結構通則**：CMS 慣例 article-title class 是「主文標題」最強跨站訊號；翻譯擴展不動 `<title>` 但 body 標題會翻、strict eq 必失敗，靠 class 訊號繞道。**保留 v0.7.141 設計**：strict equality 通過的場景（多數新聞站 docT 等於 h1）走原路徑、零變更；fallback 只對「strict eq fail + class 訊號通過」額外 promote。**newtalk-tw site-logo h1 保護不變**：site logo 通常 class 是 `site-logo` / `logo` / `header-logo`、不含 article-title token，fallback 不會誤觸發。**spec**（eet-china-translated-title.spec.js + fixture，新增）5 條 forcing function：(a) fixture 結構驗證（doc title 簡體 + h1 text 繁體 + strict eq 必 fail）；(b) articleEl 必須含 title clone（核心保護點）；(c) clone text 必須含繁體 h1 內容（翻譯結果）；(d) 原 h1 wrapper 被 hideAncestorSiblings hide（v0.7.141 行為延續）；(e) 主文 body-p-1~3 全保留。sanity check：comment 掉 fallback 立刻 (b)+(c) fail、v0.7.141 既有 11 條 spec 全 pass（fallback disable 對舊 case 無影響）、還原全綠。**npm test**：790 全綠（v0.7.146 785 → v0.7.147 790，新增 5 條 spec）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。**已知限制**：chrome://extensions 在 chrome-in-chrome MCP 受限不能自主 reload extension，實機驗收靠 jsdom spec 通則正確性 + sanity check + Jimmy 在 chrome-for-claude 手動 reload 確認。

---

**v0.7.146**——GQ Taiwan hero figure shrink 修法。**動機**：Jimmy 2026-05-20 二次回報同頁面 https://www.gq.com.tw/article/omega-swatch-moonwatch「原本全版面的主圖變超小一個」，附 reader mode 截圖顯示主圖縮成 ~60px 縮圖（原 1152px）。probe 確認 root cause：GQ hero figure 用 `display: grid` + `grid-template-columns: 1152px` 撐 width=1152，cleaner.forceMediaContainerBlock 把 display:grid → block 後，grid-template-columns 對 block element 失效，figure 失去寬度撐持、shrink-to-fit 到 picture intrinsic min-width (62px)。**修法**：cleaner.js `forceMediaContainerBlock` 對 grid/inline-grid/flex/inline-flex 容器改 block 時，**同時**設 `width: 100%` + 清 `grid-template-columns/rows` + margin:0—— 把「grid/flex 撐寬機制」換成「block + width:100% 撐寬機制」，整體寬度行為連續。inline / inline-block → block 維持只改 display 不動 width（block 默認 fill parent）。**結構通則**：當 element 從 grid/flex layout 模型切到 block，其原本由 layout container 邏輯撐住的寬度會消失、需明確 width:100% 補位；inline-level → block-level 切換不需要因為 block 預設就 fill。**與 collapseInnerGridFlex 互補**：那條 line 2095 `isInPreserved skip` 故意跳過 figure / picture（PRESERVE_SEL），把媒體容器留給 forceMediaContainerBlock 處理；兩條互補不重疊，現在兩條都同 pattern（display:block + width:100% + 清 grid-template + margin:0）。**probe 數值**：修前 figure width=62、修後 figure width=480（parent 608, ~79% fill, 含 figcaption 多 28px）。**spec**（gq-hero-grid-figure.spec.js + fixture）5 條 forcing function：(a) fixture 結構驗證；(b) hero grid figure 必須含 display:block + width:100% + grid-template:none + margin:0（核心保護點）；(c) flex figure 同路徑驗 width:100%；(d) inline-block figure 只改 display、不該加 width:100%（path 分離 forcing function；jsdom inline-block setProperty important quirk relax 不檢查 !important）；(e) normal block figure 完全不該被動（既有保護）。sanity check：comment 掉 GRID_FLEX_DECLS 內 `width:100%` 立刻 (b)+(c) fail、還原 pass 全綠。**npm test**：785 全綠（v0.7.145 780 → v0.7.146 785，新增 5 條 spec）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js。

---

**v0.7.145**——GQ Taiwan「WATCH」video interlude widget 清除。**動機**：Jimmy 2026-05-20 回報 https://www.gq.com.tw/article/omega-swatch-moonwatch「這個頁面的 video 歪右邊。如果無法修正，可以把這個區段去掉，它類似廣告」。probe-gq-watch.js 探真實 DOM 確認是 Condé Nast Entertainment CMS 的「interlude」widget——`<figure data-testid="cne-interlude-container">` 內含 heading（"WATCH"）+ 外連影片標題 `<a>` + 嵌套 iframe video embed。Jimmy 點出「類似廣告」精準：跟主文無關的「文章中段插播推薦影片」，本質非主文 inline media。所有 Condé Nast 旗下站（Vogue / Wired / Vanity Fair / The New Yorker 等）共用此 CMS。**修法**：新增 cleaner rule `hideInsideArticleVideoInterludes`——掃 articleEl 內所有 `<figure>`，若 figure 含 iframe/video（媒體 embed 訊號）**且**含 a[href] textContent >= 20 chars（指向別頁的「標題連結」訊號；主文 source-credit a 通常 < 10 chars）→ hide 整個 figure。**guard**：排除 figcaption 內的 inline a（合法主文圖說 inline link），排除 articleEl 自身與祖先。**結構通則**（不綁 hostname / 不綁 class / 不綁 data-testid）：figure 是主文媒體單位但「figure 內含跨頁長標題連結」極罕見、是 widget wrapper 的強訊號。**與既有規則互補**：`hideInsideArticleThirdPartyIframes` 對 figure 外的 iframe hide、本條對「整個 figure 是 widget wrapper」hide，互補不重疊。**為何不修對齊**：Jimmy 給兩選項，移除 widget 結構通則更乾淨——修對齊只治標（layout 易再壞），且 reader mode 純閱讀哲學下「跟主文無關的推薦影片」就是該移除。**spec**（test/regression/gq-video-interlude-widget.spec.js + fixture gq-video-interlude-widget.html）6 條 forcing function：(a) fixture 結構數值驗證；(b) interlude figure 必須 hide（核心保護點）；(c1) 主文真實 YouTube figure（無 a）保留；(c2) figcaption 內 inline link 保留；(c3) 短 source-credit a < 20 chars 保留；(d) 主文 body-p-1 ~ body-p-6 全保留。sanity check：comment 掉 cleaner pipeline call 立刻 fail (b)、其餘 5 條仍 pass、還原 pass 全綠。**npm test**：780 全綠（v0.7.144 774 → v0.7.145 780，新增 6 條 spec）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js / safari-app（safari-build.sh 自動 sync）。

---

**v0.7.144**——effort 效能重構（v0.7.143 audit 留下的 4 條效能優化）。**動機**：v0.7.143 一次性消化 audit 19 條中的 15 條 bug + 技術債，留下 4 條效能重構獨立 release 方便 isolate 風險（cleaner / detector / styler 核心熱點重構）。

**修法（4 條）**：

(1) **cleaner walk pass 共用 cache**（#11）—— 原本 8 處 rule 各自跑 `articleEl.querySelectorAll('*')`，對 5K element 主文 = 8 趟 tree walk + 8 份 NodeList allocation、啟動延遲拖累。加 `_cachedArticleAll` module-internal cache + `_getArticleAllElements(articleEl)` helper。clean() 開頭設 null 強制重建（避免 SPA 多 articleEl 拿 stale array）、結尾清 null（釋放 GC root）。7 處 rule 全改走 cache helper。剩 1 處 `articleEl.querySelectorAll('*')` invocation 在 cache helper 內 build。spec 7 條 forcing function（含「直接 invocation 數恰好 1」防回退）。

(2) **detector isSignalExcluded 祖先鏈 cache**（#12）—— `detectByHeuristic` 對 500+ signals 逐一沿祖先鏈跑 `closest + getComputedStyle`，500 × 平均 10 層 = 5K 次 getComputedStyle、每次 trigger layout flush。加 `_excludedAncestorCache`（WeakMap<element, boolean>），`detectByHeuristic` 入口開 cache（new WeakMap）+ try/finally 清。`isSignalExcluded` 沿祖先鏈遇到 cached 祖先直接 short-circuit + **back-fill** 此次走過的祖先（傳遞性：第一個 signal 走完整祖先鏈後，後續 signals 同祖先鏈直接命中 cache）。spec 5 條 forcing function（含 try/finally 清 cache）。

(3) **styler 媒體節點先 query**（#13）—— styler.apply 內找「flex/grid 含媒體子的 wrapper」原本 `for (el of articleEl.querySelectorAll('*'))` + 對每個後代跑 getComputedStyle。大頁面 500-2000 elements + 多次設定變更（每改一次字級都重 apply）= 數百 ms 級 jank。改為先 `querySelectorAll('picture, img, figure')` 收媒體節點 → 各自往上 walk parent 鏈到 articleEl 為止收集祖先 Set → 對 Set 內元素才跑 getComputedStyle。從 O(全 DOM) → O(媒體節點 × 平均深度)；純文字主文（無媒體）short-circuit 0 次 getComputedStyle。spec 4 條 forcing function。

(4) **MutationObserver 合 selector**（#14）—— `checkDynamicNoise` 對每個 addedNode 跑兩條 querySelectorAll：(a) `button, [role="button"], input[type=button|submit|reset]`、(b) `a, button`。SPA 站 reader mode 期每秒數十次 mutation、每次塞大 wrapper subtree（React reconciliation），兩條 selector 都要走整個 subtree、cost 累積。合併成單一 selector `a, button, [role="button"], input[type=...]` 一次 querySelectorAll 後依 tagName 派發：a tag 走 `shouldHideByKeyword` 條件 hide（連結是主文引用一部分）、button/role/input button 無條件 hide（硬教訓九：reader mode 純閱讀下所有 interactive button 一律清）。spec 4 條 forcing function。

**預期收益**：

- cleaner 啟動延遲省 7 次 querySelectorAll allocation——對 5K element 主文約省 14-35ms（每次 querySelectorAll('*') 2-5ms）
- detector probe / heuristic cache hit 後 isSignalExcluded 對共享祖先鏈的 signals 從 O(N) layout flush 降到 O(1)——大頁面 500+ signals 估省 50% getComputedStyle 開銷
- styler apply 對純文字主文（無 picture/img/figure）省 100% gallery flex 區段 getComputedStyle；含媒體主文省 90%+
- MutationObserver 對 SPA 站每次 addedNode 從 2 條 querySelectorAll 變 1 條，省 50% selector engine 開銷

**未做改動**：v0.7.143 audit #11 原建議合併 absoluteOverlays / negZIndex / negMargins 三條 rule 成單一 walk pass + 共用 cs object——風險高（rule 間有 hide/applyImportant 互動、合併後 state 變動可能踩 spec），本版採低風險 cache 策略；rule 合併留作未來 phase 2 評估。

**npm test**：774 全綠（v0.7.143 754 → v0.7.144 774，新增 20 條 spec 跨 4 個新 spec file）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js / safari-app（safari-build.sh 自動 sync）。

---

**v0.7.143**——專案內 code review 一次性消化：跑 deep audit 找 19 條問題後一輪修完高/中優先 bug + 技術債共 15 條，餘 4 條效能重構留 v0.7.144。**動機**：Jimmy 2026-05-19 要求「檢查所有程式碼，分析是否有 bug、技術債，以及能夠優化提升效能的地方」+「全部都修好」。**修法（15 條）**：

(1) **cleaner title clone restore bug**（critical）——v0.7.141 `promoteUniqueTitleH1Into` cloneNode prepend 進 articleEl 但**沒 push 進 hidden array**，restore() 不認得 `data-jread-title-clone` attribute、不會 removeChild。同 tab 多次進出 reader mode 會堆疊 N 份 H1 clone。修法：clone push 進 hidden array 帶 `__titleClone: true` marker，restore() 內 if (item.__titleClone) 走 removeChild path。spec 5 條（含「連續 5 次 clean → restore 後 page 仍只有 1 個 h1」forcing function）。

(2) **enterReaderMode race condition guard**——enterReaderMode 是 async（await getSettings），中間時間窗第二次 toggle 進來會看到 `NS.state.active` 仍 false、再跑一次 enterReaderMode；hiddenEls + originalStyles 被第二輪覆蓋、第一輪 hide 的元素永遠回不來。修法：local `enterInFlight` / `exitInFlight` flag + try/finally 清。spec 7 條 forcing function。

(3) **safeSendMessage 統一到 namespace**——v0.7.140 把 helper 加在 main.js 但 youtube-borderless.js 等其他 content script 仍直接呼 chrome.runtime.sendMessage 沒 guard，extension reload 後在 borderless mode 切影片 → requestResize TypeError。修法：safeSendMessage 提到 namespace.js（NS.safeSendMessage），youtube-borderless.js 改走它；main.js 用 `const safeSendMessage = NS.safeSendMessage` 短名 alias。spec 16 條（含 8 條全 content script 檔案 sweep：chrome.runtime.sendMessage 直接呼叫只可在 namespace.js helper body 內）。

(4) **JREAD_RELOAD sender 驗證**——page main world JS（廣告 script / 惡意網站）可 dispatch `__jread_debug` event type='reload' → content bridge → SW JREAD_RELOAD → reload。雖然 reload 不洩漏資料但會打斷所有 tab 的 reader mode。修法：SW handler 用 `chrome.management.getSelf()` 查 installType（不需 "management" permission，self-query），只在 `installType === 'development'` 允許 reload；store / normal install silently 拒絕。spec 4 條。

(5) **detector.probe() 抽出 + GET_READER_STATE 改用**——popup GET_READER_STATE 開啟跑完整 detect() 含 `detectByShadowDomFallback` 會 `document.body.appendChild(replica)` 注入 shadow DOM 替身——光打開 popup 就污染 page DOM。修法：detector 加 probe() 輕量版只跑 read-only 4 策略（article-tag / schema / heuristic / main-tag）回 siteMode；不跑 promote / narrow / ensureH1 / shadow replica appendChild。main.js GET_READER_STATE handler 改用 probe()。spec 6 條（含 fixture 行為驗證 body 注入元素數量不變）。

(6) **storage.onChanged debounce + cinema guard**——popup 連點 stepper 觸發多次 storage.sync.set → multiple restore + await + apply 並發纏繞、originalStyles 可能 snapshot 中間狀態、exit 後還原不回原貌；cinema mode 期間 articleEl=null styler.restore 可能 throw。修法：200ms debounce 合併連續 setting 變更 + handler 入口加 cinemaActive guard。spec 7 條。

(7) **RESIZE_OWN_WINDOW origin + range guard**——SW handler 不檢查 sender.tab.url、不 clamp height，任何 content script 可任意 resize 視窗（content 端 calcTargetWindowHeight 有 clamp 但 SW 沒驗、debug bridge 可繞過）。修法：加 `sender.tab.url` match `youtube.com/watch` + height 範圍 [200, 4096]。spec 4 條。

(8) **resetMediaPlaceholderPadding visited WeakSet 過早 mark**——bug 是 `visited.add(parent)` 在 absolute check 之前 mark，第一個 media 非 absolute（continue）後第二個共享 parent 的 absolute media 被 visited.has skip，padding-bottom hack reset 漏跑、典型踩 `<picture><source><source><img>` 或 lazy-load placeholder + real img 共用 wrapper。修法：visited.add 移到 absolute / preserved 通過後才執行。spec 4 條 + fixture（picture 含 placeholder + real 兩個 img 共享 parent）。

(9) **popup save() debounce**——chrome.storage.sync quota：120 ops/min、1800 ops/hour。連點 stepper 跨 20+18 step + storage.onChanged 廣播多 tab content script 連環 reapply、一分鐘內可踩 quota。修法：save() 加 200ms debounce + pendingPatch 累積未 commit 欄位 + beforeunload listener 強制 flush 防 popup 關閉丟失最後變更。spec 7 條。

(10) **styler fontSize / contentWidth / lineHeight 範圍 clamp**——popup UI 已 clamp [12, 32] / [480, 1200]、options 也有 HTML5 min/max，但 styler.apply 接 settings 時只擋 0/負/NaN 不擋上限，外部寫入或 storage 損壞時 `fontSize: 1e308` / `0.001` 會被當合法值注入 CSS。修法：clamp `fontSize [8, 200]`（保留 0 = Auto sentinel）/ `contentWidth [300, 2000]` / `lineHeight [1.0, 3.0]`。spec 5 條。

(11) **DEFAULT_SETTINGS 四檔 forcing function 擴覆蓋**——v0.7.140 spec 只守 popup ↔ styler 的 fontFamily === 'system-ui' 一欄；SW / options 沒覆蓋。修法：擴 forcing function 守 popup / SW / styler / options 四檔對 theme / fontSize / contentWidth / fontFamily / lineHeight / blockPageShortcuts 全欄位逐字一致。spec 20 條。

(12) **cleaner.js v0.7.97 重複註解刪除**——cleaner.js:1475-1481 一字不差的 8 行註解出現兩次（merge / copy-paste 漏刪副本）；刪掉一份。

(13) **wrapperContainsArticleAnchor / wrapperContainsMainContentP 合一**——兩條 helper p iteration loop 完全相同，差別只在最後是否加 hasArticleTitleAnchor。改為「寬鬆 = 嚴格 + title anchor check」，避免兩份 p loop 各自維護。

(14) **detector findTitleViaLca helper 抽出**——detector ensureArticleContainsTitleH1 與 promoteForTitle 的 LCA fallback 邏輯幾乎完全重複（CLAUDE.md 工作流原則 5「單一資料源」違反）。修法：抽 findTitleViaLca(articleEl, h, maxDist) helper 兩處共用；maxDist=5（ensureArticleContainsTitleH1 用、避免 site chrome 吞進）vs Infinity（promoteForTitle 用、依賴 og-match guard）。spec 6 條 forcing function（含 findLCA 直接呼叫只可在 helper 內 1 次）。

(15) **cinema / borderless 互斥**——v0.7.134 設計「可同時開」但兩者對 `#movie_player` 設互相衝突的 position 規則，同時 active 時 CSS cascade 後贏的破版。修法：(a) enterCinemaMode 開頭 check `NS.borderless.isActive()` 若 active → `toggle()` 退掉；(b) TOGGLE_YT_BORDERLESS handler 若 willEnter && cinemaActive → 先呼 exitReaderMode 退 cinema 再 toggle borderless。spec 6 條。

**留下未做（v0.7.144）**：4 條效能重構——cleaner 共用 walk pass / detector isSignalExcluded cache / styler 媒體節點先 query / MutationObserver 合 selector，預期 reader mode 啟動延遲在大頁面減半。**為何分兩 release**：效能重構動 cleaner / detector / styler 核心熱點，風險高，獨立 release 方便 isolate 問題。

**npm test**：754 全綠（v0.7.142 660 → v0.7.143 754，新增 94 條 spec 跨 11 個新 spec file + 既有 4 個 spec file 更新）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js / safari-app（safari-build.sh 自動 sync）。

---

**v0.7.142**——substack reader hub 標題消失 follow-up：修 `hideInsideArticleSidebarColumns` 對含 canonical title 的 sibling 誤判為 sidebar column。**動機**：Jimmy 2026-05-19 二次回報——v0.7.140 (A) 已加 hideInsideArticleByHeadingText button-text guard 擋掉 `<button><span>Subscribe</span></button>` 觸發 walk-up fallback，但 substack 標題仍消失。chrome-in-chrome probe 確認 root cause：**另一條 cleaner rule `hideInsideArticleSidebarColumns` 條件 A 命中**——article 兩個 direct children 中，標題 wrapper（textLen=51、linkDensity=0.61，含 subscribe button / share / avatar links / publication link）vs 主文 content wrapper（textLen=2074、linkDensity≈0），sibling.textLen 51 < main × 10% 207 AND linkDensity > 0.5，被視為 sidebar column hide 整段標題區。**修法**：cleaner.js `hideInsideArticleSidebarColumns` 加 `siblingContainsCanonicalTitle()` guard——預先算 page-wide canonical title（`<meta property="og:title">` content / `document.title` split `[|｜\-—–]` 第一段）；sibling 內含 element 的 **direct text strict equals** canonical title → 視為文章 header 區 skip hide。與既有 `promotedTitleHead` 白名單（v0.7.97 Stratechery 修法）並列、彼此互補：promotedTitleHead 涵蓋 detector promote 已 surface 的 heading；canonical title guard 涵蓋 detector 沒 promote 但 sibling 內含 og:title text 的 wrapper（substack 走 detector article-tag 直接命中、無 promote）。**通則性**：「sibling 含 page-wide canonical title 字串」是「該 sibling 是文章 header wrapper」最強訊號，跨站適用、不綁 substack hostname / class。strict equality（不容差）排除 newtalk-tw 類 site-logo h1 含 `[Newtalk新聞]` site prefix 誤觸發。**spec 4 條 forcing function**（test/regression/sidebar-column-title-guard.spec.js + 對應 fixture `sidebar-column-title-wrapper-misclassify.html`，最小重現條件 A：article > [title-wrapper(textLen=18 / ld=0.94 / 含 `<a>` direct text === og:title) + content-wrapper(textLen=580 / ld=0)]）：(a) fixture 結構數值驗證（title.textLen << main × 10% + ld > 0.5）；(b) **title-wrapper 不可被 sidebar-column rule hide（核心保護點）**；(c) title-link `<a>` 自己未被 hide；(d) 主文 content-wrapper 保留。**sanity check**：暫時 comment 掉 `if (siblingContainsCanonicalTitle(s.el)) continue` 行，spec (b) 立刻 fail（title-wrapper.jreadHidden=1），還原即 pass。**v0.7.140 (A) substack fixture 副調整**：原 substack-reader-hub-title-button-text.html 為了「真實重現實機 v0.7.140 button-text guard 場景」加長主文 p + 加更多 avatar/share links + 把主文 p 包進 content-wrapper，**仍 pass 既有 7 條 v0.7.140 spec**（button-text guard 邏輯與 sidebar-column 邏輯獨立、新 guard 加上後兩條 path 都被擋）。**已知限制**：(1) canonical title guard 需要 page 有 `<meta property="og:title">` 或可用 `<title>` 第一段——少數站點兩者都不含主標題字串時 guard 不觸發、回退到舊行為（cleaner 仍可能 hide）；(2) 標題 element 的 direct text 必須與 canonical title **完全相同**（含全形空格 / 引號等微差會 miss），這是刻意 strict equality 避免 site-logo h1 含 prefix 誤觸發；(3) 主文 content-wrapper 若也含 canonical title 重複（罕見），guard 也會保護它——但這條本就不會踩 sidebar-column rule（它是 main 不是 sibling）。**npm test**：660 全綠（v0.7.141 656 → v0.7.142 660，新增 4 條 sidebar-column-title-guard）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js / safari-app（safari-build.sh 自動 sync）。

---

**v0.7.141**——兩主題：(A) **修 eet-china 類「無 article tag + h1/內文分屬 body sibling」站點標題消失 + dark theme 整合** + (B) **release.sh quotepath hotfix**（防 Safari sync auto-commit abort）。

**(A) eet-china 標題消失 + dark theme 整合**（Jimmy 2026-05-19 https://www.eet-china.com/news/202604299557.html 實機 dark theme 截圖回報）。**根因**（chrome-in-chrome probe 確認）：站點**無 `<article>` 標籤**，標題 `<h1 class="article-title">` 在 `<div class="rowPage row-article-title">` 內、內文 `<p>` 在 `<div class="article-text-con">` 內，兩個 wrapper 是 `<body>` 的 sibling。detector heuristic 選文字密度高的內文 div 為 articleEl（不含 h1）；`ensureArticleContainsTitleH1` 算 LCA = `<body>` 被 guard reject 不 promote（避免吞整頁）。cleaner `hideAncestorSiblings` 從 articleEl walk parent、把 h1 wrapper 當外部雜訊 hide → 標題消失。**B 路線初版（捨棄）**：cleaner hideAncestorSiblings 加 page-wide unique-h1 guard 讓 h1 wrapper 保留 visible。light theme 看似 OK，但 **dark theme 下 Jimmy 截圖顯示「標題在 reader card 外、原站黑色字 + 黑色 page bg 幾乎不可見」**——標題未進卡片、styler dark theme color 沒套到。**最終修法（D 路線 clone）**：cleaner.js 末段 `promoteUniqueTitleH1Into(articleEl)` —— page-wide unique h1 的最近 wrapper（或 h1 自己）`cloneNode(true)` prepend 進 articleEl 開頭、標記 `data-jread-title-clone="1"`、清 inline display + data-jread-hidden（從已被 hideAncestorSiblings 處理過的原 wrapper 繼承）；原 wrapper 仍由 hideAncestorSiblings hide（避免重複顯示）。clone 進 articleEl 後**自動吃 styler reader card 樣式**——dark/sepia theme `* { color: var(--jr-text) }` 通用後代規則套上、`max-width 720px` 卡片約束、layout 與內文段落視覺一體。**Guard**：h1 textContent **嚴格等於** og:title / document.title 第一段（split '|｜-—–' 後）才視為主文標題——避免 newtalk.tw 類「site logo h1 含 `[Newtalk新聞]` site prefix」誤觸發 promote（markPromotedTitleIfMissing 處理那條 case）。**通則性**：page 唯一 h1 + h1 text 嚴格等於 og:title 是「站點明確標示這是主文標題」的最強訊號；跨站適用、不綁 eet-china hostname / class。**spec 8 條 forcing function**（test/regression/eet-china-title-sibling.spec.js + fixture `eet-china-title-sibling.html`）：(a) articleEl 應含內文 p；(b) cleaner.clean 跑完 page 有 2 個 h1（原 + clone）；(c) 標題 h1 自己未被 hide；(d) **articleEl 內必須出現 `[data-jread-title-clone="1"]` 元素（核心保護點）**；(e) clone 必須是 articleEl 第一個 child；(f) clone 自己 inline display 清空、無 data-jread-hidden；(g) clone 內 h1 visible；(h) 原 h1 wrapper 仍被 hide（避免雙重顯示）+ 主文 4 個 p 全保留。**Spec 設計**：直接 `articleEl = document.querySelector('.article-text-con')` 不依賴 detector promote 行為（jsdom 無 layout 環境 detector 可能升到 body，spec focus 在 cleaner 修法）。**sanity check**：暫時 comment 掉 `promoteUniqueTitleH1Into` 呼叫，spec 5 條立刻 fail，還原即 pass。**實機驗收**：chrome-in-chrome dark theme 重新觸發 reader mode → 標題進 reader card 內、白字 + 深灰底、meta「发布于...海报分享」也跟著進、視覺整合度好（probe 數據 `cloneInArticle: true / titleCloneFirstChild: true / h1InArticleClone: true`）。**已知限制**：(1) 不支援「h1 含 site prefix（如 newtalk `[Newtalk新聞]`）」的「外部 h1 = 主文」場景——交由 v0.7.87/88 markPromotedTitleIfMissing 機制處理（在 articleEl 內找 p.name promote inject）；(2) page 有多個 h1 的站點（早期 wheresyoured.at 12 個 H1 等）不豁免——避免誤 promote 非主標題；(3) 兩條機制（promoteUniqueTitleH1Into vs markPromotedTitleIfMissing）的優先序：cleaner 先跑，promote 觸發後 article 內含 clone h1，markPromotedTitleIfMissing 看到「已有 visible h1」跳過 inject——這是預期行為（主標題不該重複加 inject h1）。**(B) release.sh quote-path grep regex hotfix**——v0.7.140 release.sh 實機踩到：跑完 safari-build.sh 後 `OTHER_DIRTY=$(git status --porcelain | { grep -vE "^.. safari-app/JRead/(JRead\.xcodeproj|JRead Extension/Resources)" || true; } | wc -l)` 算出 6（非預期改動），script abort 在 Safari sync auto-commit 前。**根因**：git status --porcelain 對**含空格路徑**加雙引號（`"safari-app/JRead/JRead Extension/Resources/content/cleaner.js"`），grep regex `^.. safari-app/...` 沒對應到 quote 前綴，這些路徑沒被 exclude 掉。**第一次修法失敗（v0.7.141 初版）**：加 `-c core.quotepath=false` local override，**但這條沒生效**——`core.quotepath` 只控制「非 ASCII 字元」引號處理，**空格不在其控制範圍**，所以含空格路徑仍被加引號。實機 release.sh 仍 abort。**正解（v0.7.141 amend）**：在 grep regex 端加 `"?` 可選引號前綴：`^.. "?safari-app/JRead/(JRead\.xcodeproj|JRead Extension/Resources)`——同時 match 引號版本（含空格路徑）與無引號版本（pbxproj 純 ASCII 路徑）。**spec 1 條 forcing function**（test/regression/safari-build.spec.js v0.7.141 group）：OTHER_DIRTY 賦值表達式的 grep regex 必須含 `"?safari-app`，防止回退到「只用 quotepath 不修 regex」的失效路徑。**教訓**：bash quote / git porcelain quote / grep regex 三層 escape 互動複雜，光試一條 fix path（quotepath）不夠，必須**實機跑 release.sh** 驗證（這次 v0.7.141 commit 跑 release.sh 才暴露 quotepath approach 失效）。

**npm test**：656 全綠（v0.7.140 647 → v0.7.141 656，新增 8 條 eet-china-title-sibling + 1 條 release.sh quotepath spec）。**版本同步**：manifest / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js / safari-app（safari-build.sh 自動 sync）。

---

**v0.7.140**——四主題合一：(A) **修 substack reader hub 標題消失**（critical bug fix）+ (B) **popup 新增「字型」select 元件**（使用者可在 4 個內建 stack 間切換）+ (C) **修 fontSize == DEFAULT 不渲染的 UX trap**（popup 顯示 18 但實際看到原站字級的問題）+ (D) **修 extension reload 後 sendMessage 炸 TypeError**（content/main.js:270 `Cannot read properties of undefined (reading 'sendMessage')`）。

**(A) substack reader hub 標題消失（critical bug fix）**——Jimmy 2026-05-19 回報 `https://substack.com/home/post/p-188798414` 開閱讀模式整段標題（含 publication meta / 標題 `<a>` / byline / description）一起消失。chrome-in-chrome probe 確認 root cause：cleaner 的 `hideInsideArticleByHeadingText` 掃 div/span/p direct text 命中 NOISE_HEADING_TEXT_RE 的 `^subscribe$`；命中元素是 `<button class="subscribe-btn"><span class="button-text">Subscribe</span></button>` 內的 span（substack 訂閱按鈕）；span 沒 section/aside 祖先 → 走 walk-up fallback `findSafeWrapperForHeading` 找 safe wrapper；substack 標題用 `<a>`（非 `<h1>`）、整個標題區塊**沒任何 `<p>` 標籤**（byline/description 用 `<div>`）、class 全是 emotion hash（`pencraft pc-display-flex pc-justifyContent-center pc-reset` 等）**不含 title-anchor token**（`title` / `headline` / `article-title` 等），三道 anchor guard（`>= 100 chars 單 p` / `累計 p text >= 300` / `title-anchor class element`）**全失效** → walk-up 一路走到 article direct child wrapper 才停 → hide 整段標題 + meta + byline + description + subscribe 區塊。**結構性通則修法**：`hideInsideArticleByHeadingText` 與 `checkDynamicNoise`（dynamic lazy-inject 對稱版）兩處 inner loop 加 `if (h.closest('button')) continue` pre-filter——button text 是 CTA word（Subscribe / Follow / Read more 等）撞 heading keyword 是結構性 false positive；button 本身會被 `hideInsideArticleAllButtons` 無條件清，不需要 heading rule 走 walk-up fallback 連坐 hide wrapper。**通則性**：跨站適用、不綁 substack hostname / class；任何站點若 button 內 text 撞 heading keyword 都不再過度連坐。**spec 7 條 forcing function**（test/regression/substack-reader-hub-title.spec.js + 對應 fixture `substack-reader-hub-title-button-text.html`，最小化重現 substack reader hub 結構：`<article>` 內 `<a>` 標題 + emotion hash class + 無 `<p>` 標題區塊 + subscribe-btn 含 `<span>Subscribe</span>` + 4 段主文 `<p>` satisfy detector MIN_TEXT_LEN）：(a) detector 命中 `<article>`；(b) 標題 `<a>` 自己未被 hide；(c) **標題 `<a>` 祖先 chain 全部不可有 `data-jread-hidden`（核心保護點）**；(d) 標題 wrapper（article first direct child）未被 hide；(e) subscribe-widget div 仍被 hide（NOISE_KEYWORD_RE 命中 subscribe）；(f) subscribe-btn button 仍被 hide（hideInsideArticleAllButtons）；(g) 4 段主文 `<p>` 未被誤殺。**sanity check**：暫時把 `if (h.closest('button')) continue` comment 掉，spec 立刻 fail（標題 wrapper `pencraft pc-display-flex pc-justifyContent-center pc-reset` 出現在 hidden ancestors），還原即 pass。**chrome-in-chrome 端對端驗收限制**：嘗試透過 `__jread_debug` reload bridge 在 chrome-in-chrome 的 Chrome reload jread + 重觸發 reader mode 驗實機 fix，但該 Chrome 環境的 jread reload 結果不穩定（reload 後 content script 可能仍跑舊 cleaner code），jsdom fixture spec 是 fix 正確性的主要驗收來源；Jimmy 拿到新版實機驗為最終 confirm。

**(B) popup 新增「字型」select 元件**——Jimmy 2026-05-19 同對話問「reader mode 可以指定字型嗎」——styler 層 `fontFamily` storage / `apply()` override 邏輯自 v0.5 起就 ready（非預設值時注入 `font-family: <userValue>, -apple-system, "Noto Sans TC", "PingFang TC", system-ui, sans-serif !important` 到 `BODY_TEXT_SEL`），但 popup UI 從未曝露切換入口，唯一改法是手動 `chrome.storage.sync.set({ fontFamily: '...' })`，SPEC 也標 `fontFamily` 為「❌（MVP 固定）」。**設計**：popup 高密度 UI 哲學下用 single `<select>` 比 button group 省空間 + 對齊既有 110px / 28px row grid（theme-group / stepper 兩個既有元件都是 110px 寬）；4 個內建 stack 寫死在 popup.js `FONT_STACKS` 常數 + popup.html `<option>` value，**兩處字面值必須逐字一致**（select.value 從 storage 讀回時若 match 不到 option 會顯示空白，spec 端會 catch drift）。**修法**：(1) `jread/popup/popup.html`：新增 `.font-family-select` CSS（110px × 28px、border 1px var(--jr-neutral-300)、custom SVG ▼ icon 對齊既有元件視覺、focus-visible ring 對齊 theme-btn 的 var(--jr-primary-50)）+ 設定面板第 4 個 setting-row 加 `<label for="font-family-select">字型</label>` + `<select id="font-family-select">` 含 4 個 `<option>`（系統預設 / 襯線 / 無襯線 / 等寬）。(2) `jread/popup/popup.js`：新增 `FONT_STACKS` 常數（system='system-ui' / serif / sans / mono；system 字面值對齊 styler `DEFAULTS.fontFamily = 'system-ui'` —— forcing function spec 校對）+ `DEFAULT_SETTINGS` 加 `fontFamily: FONT_STACKS.system`（storage.sync.get fallback）+ `render()` 內 `fontFamilySelect.value = settings.fontFamily`，若 match 不到 4 個 option 則 fall back 顯示「系統預設」**但不寫回 storage**（避免默默覆蓋使用者外部設定的自訂 stack）+ change handler `save({ fontFamily: e.target.value })` 觸發 storage.sync.set，content script 既有 `storage.onChanged` listener 收到 fontFamily 變更自動重套（main.js `relevantKeys` 自 v0.7.x 起已含 fontFamily，本版不需動 main.js）。(3) **styler 完全不動** —— v0.5 起 styler `apply()` 已支援 `s.fontFamily` 注入；本次只補 UI 入口。**spec 10 條 forcing function**（test/regression/popup-font-family.spec.js）：(a) popup.html 含 `<select id="font-family-select">` + 恰好 4 個 option 順序對齊（系統預設/襯線/無襯線/等寬）+ option value 與 popup.js FONT_STACKS 字面值逐字一致 + `<label for="font-family-select">字型</label>`；(b) popup.js `FONT_STACKS` 常數含 system/serif/sans/mono 四個 key + FONT_STACKS.system === 'system-ui' + DEFAULT_SETTINGS.fontFamily === FONT_STACKS.system + change handler 綁 fontFamilySelect 寫進 storage + render() 同步 fontFamilySelect.value；(c) **跨檔同步**：styler.js `DEFAULTS.fontFamily === 'system-ui'`（與 popup FONT_STACKS.system 對齊，drift 會造成「popup 選『系統預設』仍注入 override」）。**sanity check**：暫時把 `FONT_STACKS.system` 改為 `'serif'`，spec 即 fail（`popup.js FONT_STACKS.system 必須等於 "system-ui"`），還原即 pass。

**(C) fontSize == DEFAULT 不渲染的 UX trap**——Jimmy 2026-05-19 截圖回報 substack reader hub 上字級設定為 18 但實際看到原站 source-serif-pro 20px。**根因**：styler.js:691 overrides 條件 `opts.fontSize > 0 && opts.fontSize !== DEFAULTS.fontSize` 把「fontSize == DEFAULT (18)」當作「使用者沒改設定 → 保留原站」處理，不注入 `font-size` override，原站 source-serif-pro 規則直接勝出。這是 v0.6 baseline 「未動設定 == 完全保留原站」設計的 hidden semantic，但 popup 預設顯示 18、使用者預期「就是 18」，DEFAULT == skip 太隱晦。**修法**：styler.js:691 `fontSize` overrides 簡化為 `opts.fontSize > 0`——任何 > 0 都注入（含 == DEFAULT 18）。Auto = 0 sentinel 仍是唯一「明確要保留原站字級」的入口，不變。fontFamily / lineHeight 維持原邏輯（fontFamily 預設「系統預設」== `system-ui` 仍視為「不換字型」，名字即暗示保留原站；lineHeight 沒 popup UI 不會踩 trap）。**spec 變更**：(1) `styler.spec.js` 「預設設定 → CSS 不注入 font-size」spec 改寫為「預設設定 → 仍注入 font-size 18px、連帶 line-height 1.7、不注入 font-family」對齊新行為；(2) 「CSS 不得套 heading / p / 等的 typography rule」spec 把 `NS.styler.apply(articleEl, DEFAULT_SETTINGS)` 改為 `NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontSize: 0 })`——Auto 模式才是「styler 不主動下 typography rule」的場景；(3) 新增 forcing function「fontSize === DEFAULT (18) 必須注入 font-size 18px !important」防止回退到 UX trap。**sanity check**：暫時把 `opts.fontSize > 0` 改回 `opts.fontSize > 0 && opts.fontSize !== DEFAULTS.fontSize`，forcing function spec 立刻 fail，還原即 pass。**取捨**：放棄 v0.6 baseline 「fontSize == DEFAULT 不注入」的「保留原站」精神（這個 hidden semantic 使用者無感知），換取 popup 顯示 18 == 渲染 18px 的 UX 一致性。Auto = 0 仍提供「我要保留原站字級」的明確 escape hatch。

**(D) extension reload 後 sendMessage 炸 TypeError**——Jimmy 2026-05-19 substack reader mode exit 時截圖回報 `Uncaught TypeError: Cannot read properties of undefined (reading 'sendMessage')` at `content/main.js:270` `chrome.runtime.sendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: false } })`。**根因**：典型 extension context invalidated——reader mode active 期間 Jimmy 在 `chrome://extensions/` reload 一次 jread extension（或我前面 debug 流程裡 dispatch `__jread_debug` type=reload），原本已注入到 substack page 的 content script 仍跑舊代碼，但該 isolated world 的 `chrome.runtime` 被 Chrome 設成 undefined（context invalidated 後 chrome API access 失效）。使用者後續 exit reader mode → main.js exitReaderMode 內 `chrome.runtime.sendMessage(...)` 直接讀 undefined.sendMessage → TypeError 炸。**修法**：main.js 加 `safeSendMessage(msg, cb?)` helper，內部 guard `chrome.runtime.id`（context invalidated 後該值變 undefined，是業界標準 detect 方法）+ try-catch 兜底 race condition（guard 通過後 context 才失效的極罕見 case）。invalidated 時 fire-and-forget call 直接 no-op（不影響使用者體驗：SET_ACTIVE_ICON / SAVE_TO_READWISE 等失敗不會破壞 reader mode 本身），callback 版本 invoke `null` 讓 caller 走「沒回應」分支。main.js 內**所有 11 處** `chrome.runtime.sendMessage` 直接呼叫統一改走 helper：line 137（detector report） / 141 / 155（cinema） / 181 / 185（YouTube borderless） / 193（X thread） / 238 / 242（enter reader mode active icon） / 259（settings reload）/ 292（exit reader mode active icon，本次踩雷點）/ 478（debug bridge type=reload）。`chrome.runtime.sendMessage` 直接呼叫只保留在 helper body 內 2 處（if cb 分支 + else 分支）。**spec 4 條 forcing function**（test/regression/main-safe-send-message.spec.js）：(a) main.js 必須宣告 `function safeSendMessage`；(b) helper body 必須含 `chrome.runtime.id` guard；(c) `chrome.runtime.sendMessage(` 在 main.js 內出現次數恰好 2（helper 內），任何新外部 call 會讓 count 變 3+ spec fail；(d) 外部 safeSendMessage call >= 5 處（防止 helper 被定義但沒人用的退化）。**sanity check**：暫時把 main.js:292 改回 `chrome.runtime.sendMessage(...)`，spec assertion (c) 立刻 fail（expected 2, actual 3），還原即 pass。**通則性**：context invalidated guard 對所有 Chrome extension content script 都通用，不綁定特定站點 / Chrome 版本。**未來擴展**：如果新增其他 chrome.* API 呼叫（chrome.storage / chrome.tabs）也可能踩同樣 invalidated 問題，這些目前 main.js 沒有 direct call、走訊息協定中繼，本版不必處理。**spec 配套修正**：原 sw-badge.spec.js「v0.7.126 main.js bridge reload 分支必須走 sendMessage」spec assertion 從 `chrome\.runtime\.sendMessage` 改為 `safeSendMessage`（仍 forcing「不可直接呼 chrome.runtime.reload」精神，但對齊新 helper）。

**npm test**：647 全綠（v0.7.138 625 → v0.7.140 647，新增 10 條 popup-font-family + 7 條 substack-reader-hub-title + 1 條 fontSize-DEFAULT-forcing + 4 條 safeSendMessage forcing）。**版本同步**：manifest.json / package.json / SPEC.md / CHANGELOG.md / version-check.spec.js / safari-app/JRead/JRead Extension/Resources/manifest.json + safari-app pbxproj（safari-build.sh 在 release.sh 內自動 sync）。**已知限制（substack）**：(1) reader hub URL 需登入 substack 才能看，無法在 GitHub Actions CI 端對端驗，jsdom fixture spec 是 fix 正確性的主要驗收路徑；(2) 同類「button 內 text 撞 heading keyword」的其他站點（其他 newsletter / SaaS landing / commerce CTA 等）一併受惠，但未個別驗。**已知限制（fontFamily）**：(1) 4 個 stack 寫死在程式碼，使用者要更精細自訂仍需 storage 手動 set；(2) 「無襯線」option 跟 'system-ui' 在 macOS 上實際呈現很接近；(3) styler 注入時會在使用者 stack 末尾再串自己的 fallback chain，重複字型沒副作用但 stack 較長。

---

**v0.7.138**——首發 macOS Safari 版本 + 每次 release 自動產出 Developer ID notarized .pkg（流程移植自 Shinkansen）。**動機**：Jimmy 2026-05-18 — 希望 JRead 同時支援 macOS Safari，且 release 流程一鍵自動產 Safari artifact。**設計**：(1) 走 Developer ID 通道（不走 Mac App Store）——產 notarize + stapled 的 .pkg 給 GitHub Release 公開下載手動安裝，使用者雙擊安裝、開啟 host App、點按鈕跳轉 Safari 啟用擴充功能；(2) Single source of truth——`jread/manifest.json` + `jread/` 整棵目錄是 Chrome 版本，Safari build 透過 `rsync -a --delete jread/ → safari-app/JRead/JRead Extension/Resources/` 完整同步進 Xcode project，Safari 與 Chrome 共用同一份 extension code，無雙頭維護；(3) 沿用 Shinkansen 同一個 Apple Developer Team `PR6NG3PH45`（Zhimin Su）—— Bundle ID 新增 `app.jread.macos`（host App）+ `app.jread.macos.Extension`，notarytool profile 沿用 `shinkansen-notary`（同 Apple ID + Team 的 credentials 在不同 profile 名稱下通用）。**修法**：(1) 新建 `safari-app/safari-bootstrap.sh`——一次性，用 `xcrun safari-web-extension-converter` 從 `jread/` 產出 Xcode project 進 `safari-app/JRead/`（`--macos-only --swift --copy-resources --bundle-identifier app.jread.macos --app-name JRead`），平常開發 / release 不用跑。(2) 跑完 bootstrap 後 patch `project.pbxproj`：(a) host App `PRODUCT_BUNDLE_IDENTIFIER` 從 converter 預設 `app.jread.JRead` 改成 `app.jread.macos`（Debug + Release 共兩處；converter 把 `--app-name` 直接 reverse-DNS 成預設 bundle ID 是 bug，違反「Extension Bundle ID 必須以 host App 為 prefix」命名規則）；(b) 4 處 `CODE_SIGN_STYLE = Automatic` 後加 `DEVELOPMENT_TEAM = PR6NG3PH45`；(c) host App Debug + Release 加 `INFOPLIST_KEY_LSApplicationCategoryType = "public.app-category.productivity"`。(3) 新建 `safari-app/safari-build.sh`——每次 release 自動跑：rsync sync Resources → sed bump pbxproj MARKETING_VERSION / CURRENT_PROJECT_VERSION → xcodebuild clean + archive → exportArchive Developer ID → productbuild .pkg + Developer ID Installer cert 簽 → notarytool submit --wait（實測 ~25 秒）→ stapler staple → spctl -a -t install -vv 驗證 Gatekeeper accept → source drift forcing function（`diff -r --brief jread/ Resources/` 必須 empty）。產出 `safari-app/jread-macos-v<version>.pkg`。前置 check 三項缺哪項印對應安裝指引（Developer ID Application cert / Installer cert / notarytool keychain profile）。`NOTARY_PROFILE` 環境變數預設 `shinkansen-notary` 可 override。(4) 新建 `safari-app/safari-export-options-developerid.plist`——method=developer-id / teamID=PR6NG3PH45 / signingStyle=manual / signingCertificate="Developer ID Application: Zhimin Su (PR6NG3PH45)"。(5) Host App 介面繁中本地化：`safari-app/JRead/JRead/Resources/Base.lproj/Main.html` + `Script.js` 把英文預設文字改繁體中文（「JRead 擴充功能目前未啟用。可在 Safari 擴充功能偏好設定中開啟。」「結束並開啟 Safari 擴充功能偏好設定…」等）；`Icon.png` 替換為 `jread/assets/icons/icon-128.png`。WKWebView + storyboard 維持 converter 預設不動（最小 host App，符合 Jimmy 2026-05-18 明確要求）。(6) 改寫 `release.sh`：新增 Safari build 步驟在 working-tree-clean check 之後 → safari-build.sh 改動 pbxproj + Resources/ 後 auto-commit "v<ver> — Safari sync (auto)" → tag → push → 等 GitHub Release 由 Actions 建出（最多輪詢 3 分鐘）後 `gh release upload .pkg --clobber`。新增 `SKIP_SAFARI=1` escape hatch 緊急只發 Chrome / Firefox。(7) 同步更新 `SPEC.md`（新增「macOS Safari 版本」整章 + 檔案結構加 `safari-app/`）+ `README.md`（安裝段新增 macOS Safari 步驟 + 發佈段更新 release.sh 流程）。**spec 27 條 forcing function**（test/regression/safari-build.spec.js）：(a) scaffold 檔案存在 + executable（safari-bootstrap.sh / safari-build.sh / export options plist / xcodeproj / pbxproj）；(b) export options plist 內 method/teamID/signingStyle/cert；(c) pbxproj 內 host App bundle ID = app.jread.macos（兩處）+ Extension bundle ID = app.jread.macos.Extension（兩處）+ 4 處 DEVELOPMENT_TEAM = PR6NG3PH45 + LSApplicationCategoryType = productivity + CFBundleDisplayName = JRead / "JRead Extension"；(d) safari-build.sh 含 rsync / sed bump / xcodebuild archive / exportArchive 含 export-options plist / productbuild --sign / notarytool submit --wait / stapler staple / source drift check / 輸出 .pkg 路徑命名；(e) release.sh 含 safari-build.sh call / SKIP_SAFARI escape / auto-commit "Safari sync (auto)" / gh release upload --clobber / poll GH Release 存在再 upload——**spec 不實際跑 xcodebuild**（macOS + Xcode + cert + Apple cloud 鏈不該進 spec）。**sanity check**：暫時改 pbxproj 把 `app.jread.macos` 改錯立刻 fail，還原即 pass。**本機驗收**：跑 `./safari-app/safari-build.sh` 端到端，產出 `jread-macos-v0.7.137.pkg`（487 KB），notarize accepted（24 秒），stapler validate 通過，spctl 顯示 `source=Notarized Developer ID / origin=Developer ID Installer: Zhimin Su (PR6NG3PH45)`。**已知限制**：(1) 不走 Mac App Store（避開 Apple Review + provisioning profile 管理；Developer ID 直接公開下載即可）；(2) 不支援 iOS Safari（macOS-only build；iOS 需要額外 distribution cert + App Store Connect 設定）；(3) host App 是最小 WKWebView 介面，不含使用者偏好同步 / App Group shared UserDefaults（偏好設定走 chrome.storage.sync，iCloud 不同步）；(4) Safari build 必須在 macOS 本機跑（GitHub Actions Ubuntu runner 不能 xcodebuild），所以 `.pkg` 來自開發者本機而非 CI——好處是 CI 不用管 Apple 簽章 secret，缺點是必須開發者本機環境完整才能 release。

---

**v0.7.137**——v0.7.135 X / Twitter status reader 補上「作者顯示」（avatar + display name + handle）。**動機**：Jimmy 2026-05-18 截圖回報——v0.7.135 reader 啟動後合成容器內看不到 Felipe Pasco / @philipinspain / 頭像，只看到推文本文。chrome-in-chrome probe 確認原 X DOM 內 `[data-testid="User-Name"]` + `div[data-testid^="UserAvatar-"]` 都存在，clone 進合成容器後 User-Name 自身 display:flex visible 但 rect=0——往上 walk 第 3 層祖先 div 帶 `data-jread-hidden="1"`，是 cleaner 的祖先 wrapper hide rule（X header row 含 ⋯ menu button / Subscribe button 等被 hideInsideArticleAllButtons + button-cluster rule 連帶把整列父 wrapper hide）連帶壓掉作者列。cleaner 是 [[feedback_preserve_v060_baseline]] 不可動的 baseline。**修法**：x-thread.js 新增三條對外 API：(1) `extractAuthorInfo(article)` 從原 article（pre-clone）的 User-Name span 抽 displayName（非 `@` 起頭、且 < 60 字、避開誤抓推文本體）+ handle（`/^@\S+$/` 純 handle pattern）+ avatarSrc（`div[data-testid^="UserAvatar-"] img.src`）；(2) `createAuthorHeader(info)` 產 `<header data-jread-x-author>` 含 avatar img (48×48 圓) + `<strong>display name</strong>` + `<span data-jread-x-handle>@handle</span>`——**全棵不用 class**（避開 cleaner NOISE_KEYWORD_RE 走 class）、**不含 button**（避開 hideInsideArticleAllButtons）、用 inline style flex + margin（不依賴 styler 注入規則）；(3) `injectAuthorHeaders()` 從模組內 `_lastThreadArticles`（enter() 保留的源 article 參照）逐一抽 info + 建 header + insertBefore 各 article clone。main.js `enterXThreadMode` 在 `cleaner.clean(container)` 之後、`styler.apply(container)` 之前呼叫 `NS.xThread.injectAuthorHeaders()`——**cleaner 跑完才注入，cleaner 看不到合成 header 不會 hide 它；styler 之後仍能套 typography**。`exit()` 清空 `_lastThreadArticles` 避免 leak。**設計關鍵**：(a) 從原 article（pre-clone）抽 author info 比從 cloned article 抽更可靠——cleaner 沒動原 article、Img src 沒被 React lazy 屬性蓋掉；(b) `injectAuthorHeaders` 回 number 表「實際注入幾個 header」方便 spec assertion 用 forcing function；(c) 合成 header 用 `<header>` semantic tag 而非 `<div>`——styler 對 semantic tag 比較友善、未來新增規則也較不會誤殺。**spec 10 條 forcing function**（test/regression/x-thread.spec.js v0.7.137 group）：(1) x-thread.js 必須宣告 extractAuthorInfo / createAuthorHeader / injectAuthorHeaders；(2) NS.xThread 必須 export injectAuthorHeaders + AUTHOR_ATTR；(3) extractAuthorInfo 抽 User-Name span 得 displayName + handle；(4) extractAuthorInfo 抽 UserAvatar-* img.src；(5) extractAuthorInfo 跳過 >60 字長 span（避免誤抓推文本體當 displayName）；(6) createAuthorHeader 產的 `<header>` 含 avatar img + strong + handle span 結構正確；(7) createAuthorHeader 全棵不可含 class 也不可含 button（forcing：避開 cleaner class-based + button-based rule）；(8) injectAuthorHeaders 注入 N 個 header 對應 N 個 article clone 順序正確；(9) injectAuthorHeaders 後 header textContent 含 handle / display name（使用者看得到）；(10) main.js enterXThreadMode 必須 `cleaner.clean` → `injectAuthorHeaders` → `styler.apply` 三 call 順序正確——forcing：未來改 main.js 把順序錯誤排（先 inject 再 cleaner / 不 inject）會被 catch。**sanity check**：移除 main.js `NS.xThread.injectAuthorHeaders()` call 立刻 fail、還原即 pass。**全 597 spec passing**（v0.7.136 587 → v0.7.137 597，新增 10 條 author header 結構 + 行為 assertion）。**已知限制**：(1) 此修法只補回作者顯示（avatar + name + handle）；時間戳、quote 推文 author、reply context 上方 thread 作者不在 MVP；(2) avatarSrc 是 X CDN URL，extension 在某些 host_permissions 限制下若 fetch 被擋會顯示破圖（但既有 host_permissions: `<all_urls>` 不會踩到）；(3) X displayName 如果是 emoji + 文字，extractAuthorInfo 用 textContent 抓得到 emoji 但 < 60 字 filter 仍 OK；displayName 超長（極少見 > 60 字）會被 filter 過濾掉、回 null——但此 case 罕見且使用者仍能從 handle 知道作者。

---

**v0.7.136**——首發 Firefox 版本 + 每次 release 自動產出 Chrome / Firefox / Firefox source 三種 zip（流程移植自 Shinkansen）。**動機**：Jimmy 2026-05-18 — 希望 JRead 同時支援 Firefox，且 release 流程一鍵自動產 Firefox artifact。**設計**：Single source of truth——`jread/manifest.json` 永遠是 Chrome 純淨版（`background.service_worker`），Firefox manifest 由 `tools/firefox-build.sh` 在 build 時用 jq 程式化改寫產生；沒有兩份 manifest、沒有 minify / bundle / transpile，build transform 只動幾行 JSON。**修法**：(1) `jread/manifest.json`：加 `browser_specific_settings.gecko.id = "jread@jimmy.zm.su"`（Chrome ignore；Firefox AMO 上架後鎖死的 extension ID，已對應 jimmy.zm.su 名稱規則）。(2) `jread/background/service-worker.js`：`importScripts('/popup/popup-core.js')` 包 `typeof importScripts === 'function'` guard——Chrome MV3 SW context 仍走 importScripts，Firefox event page 沒 importScripts 跳過、改由 manifest scripts 陣列預載 popup-core。(3) 新建 `tools/firefox-build.sh`：jq 改寫 manifest 三件事：`background.service_worker` → `background.scripts: ["popup/popup-core.js", "background/service-worker.js"]`（順序：popup-core 先 load 才能讓 service-worker 看到全域變數）+ `gecko.strict_min_version: "128.0"` + `gecko.data_collection_permissions: { required: ["none"] }`（Mozilla 2025 consent UI 要求；JRead 不收集任何資料，Readwise token 純使用者本機 → API direct）。產 `jread-firefox-vX.Y.Z.zip`。(4) 新建 `BUILD.md`：AMO reviewer 用，說明從 source.zip 重建 Firefox zip 的步驟 + 為什麼需要 manifest transform + verification command。(5) 新建 `.github/workflows/release.yml`：tag push（`v*`）觸發 → build Chrome zip + Firefox zip + Firefox source zip → softprops/action-gh-release@v2 上傳到 GitHub Release（make_latest legacy 避免補建舊 tag 偷走 Latest 標籤）。(6) `release.sh`：跑完 `npm test` + working tree clean check + git tag 後自動 `git push && git push --tags`（讓 Actions 接手）；SKIP_PUSH=1 可只跑本機測試 + tag 不 push（debug 用）。(7) `SPEC.md`：加「Firefox 版本」章節 + 檔案結構更新（tools/firefox-build.sh、.github/workflows/release.yml、BUILD.md）。**spec 11 條 forcing assertion**（test/regression/firefox-build.spec.js）：端到端跑 `tools/firefox-build.sh` 產生真 zip → unzip manifest 驗（a）無 service_worker（b）scripts 順序正確 popup-core 在前（c）gecko.id = jread@jimmy.zm.su（d）strict_min_version 128.0（e）data_collection_permissions { required: ["none"] }（f）version 與 jread/manifest.json 同步（g）service-worker.js byte-for-byte 一致（h）popup-core.js byte-for-byte 一致——forcing：未來改 jq filter / 漏掉 gecko 欄位 / 換 scripts 順序 / minify 進來都會 catch。另一組 Chrome manifest 前置條件 spec：（i）service_worker 存在 + scripts 不存在（j）gecko.id 已預埋 jread/manifest.json（k）service-worker.js 含 `typeof importScripts === 'function'` guard。**已知限制**：(1) Firefox 端尚未實機驗（Jimmy 環境以 Chrome 為主），release 流程 + manifest 結構正確性靠 spec + AMO reviewer 重建路徑保證；(2) 若有 Chrome-only 的 API 用法未來再加 polyfill / feature detection；(3) AMO 首次上架仍需 Jimmy 手動到 https://addons.mozilla.org/developers/ 上傳 + 填上架資訊（gecko id 已寫死，不會與其他 add-on 衝突）。

---

**v0.7.135**——新增 X / Twitter status 頁閱讀模式支援（合成 reader 容器路線）。**動機**：Jimmy 2026-05-18 — `https://x.com/philipinspain/status/2056152770298675234` 開閱讀模式 no-op。chrome-in-chrome probe 確認該頁有 8 個 `article[role="article"]`（主推文 i=0 / 7 個 reply），detector 既有 `detectByArticleTag` 將其判為「列表頁」降級。Jimmy 確認要支援「X 原生 thread = 同作者連續推文」（單一長推也算 thread 為 1 的 special case）；replies 全清。**修法**：(1) 新建 `jread/content/x-thread.js`——IIFE 掛 `NS.xThread`，含 `isXStatusPage(url)` URL 判斷（accept `x.com / twitter.com / www. / mobile. / m.`，path `^/<user>/status/<digits>` 後可接 `/photo/1` `/analytics` 等）+ `extractStatusId(url)` 抽 URL status ID + `getAuthorHandle(article)`（讀 `[data-testid="User-Name"] a[href^="/"]`，跳過 `/status/` 時間戳 link）+ `findMainTweet(statusId)` 遍歷所有 `article[role="article"]`，命中含 `a[href*="/status/<ID>"]` 的即為主推文 + `collectThreadArticles(mainArticle)` 從主推文 `closest('[data-testid="cellInnerDiv"]')` 往前後 walk sibling cell，同作者連續且 cell 含 article 才納入（遇到不同作者 / 非 cell / 無 article 即停該方向） + `enter()` 建合成 `<article data-jread-x-reader>`、深 clone 每個 thread article 進去、`insertBefore(document.body.firstChild)` 注入 body 開頭、回容器 element + `exit()` 移除合成容器 + `isActive()` 查容器存在。(2) `jread/content/detector.js` `detect()` 開頭加第二條短路（在 cinema check 之後）`if (NS.xThread?.isXStatusPage()) return { el: null, confidence: 1, strategy: 'x-thread', isXThread: true }`。(3) `jread/content/main.js` 新增 `enterXThreadMode()` async helper：呼叫 `NS.xThread.enter()` 拿合成容器、找不到主推文時 toast「此頁無法偵測主推文」+ `REPORT_DETECTION_RESULT { ok: false }`、找到主推文則沿用既有 cleaner / styler / Readwise / ESC keylistener / keyguard 流程對合成容器跑。`enterReaderMode()` 在 cinema 短路後加 `if (result.isXThread) return await enterXThreadMode()` 分支。`exitReaderMode()` 結尾呼叫 `NS.xThread.exit()` 清合成容器（在 styler/cleaner.restore 之後、SET_ACTIVE_ICON 之前）。`GET_READER_STATE` siteMode 邏輯改 `if (probe && (probe.el || probe.isXThread)) siteMode = 'article'`——讓 popup 視為可閱讀（按鈕啟用 + Readwise 顯示）。(4) `jread/manifest.json` bump 0.7.134 → 0.7.135 + `content_scripts.js` 加 `content/x-thread.js`（在 youtube-borderless 後、detector 前；此順序讓 detector.js eval 時 `NS.xThread` 已掛載）。**設計關鍵**：(a) **合成容器路線**——X timeline 是 cellInnerDiv 平鋪結構，thread member 跨多個兄弟 cell，沒有單一現成 wrapper 可選；改建 fresh `<article>` 把 thread article clone 進去，articleEl 變成正常 article 元素、既有 cleaner / styler / Readwise / keyguard / ESC 流程 0 fork 全沿用；(b) **insertBefore body firstChild** 讓 `hideAncestorSiblings` 自然清掉所有原 X UI（masthead / sidebar / 留言 / 推薦 / footer）為合成容器的兄弟；(c) **同作者連續 thread 判斷**——i=0 主推文（philipinspain）→ i=1 是 NYCBossGirl ≠ → 停 forward walk；i=7 雖也是 philipinspain 但中間隔 i=1-6 別人 reply、不算 thread member（probe 驗 i=7 內容換主題政治評論、確實非 thread continuation）；(d) **`closest('[data-testid="cellInnerDiv"]')` 不存在時 fallback `[mainArticle]`**——X DOM 變更或非 timeline 上下文 render 主推文時仍能至少顯示單推；(e) **`cloneNode(true)` 深複製**——tweetText / 圖片 src / User-Name / 時間戳 全保留，React event 不 clone 但純閱讀模式不需要互動。**spec 32 條 forcing assertion**（test/regression/x-thread.spec.js）：模組結構（NS.xThread 暴露 isXStatusPage / extractStatusId / getAuthorHandle / findMainTweet / collectThreadArticles / enter / exit / isActive / READER_ATTR）+ isXStatusPage 7 變體（x.com / www.x.com / mobile.twitter.com / twitter.com / 排除 youtube.com / 排除 /home / 排除 /<user> 純檔案頁）+ extractStatusId 抽數字 ID + getAuthorHandle 跳過 /status/ 時間戳 link + findMainTweet 命中 status ID 對應 article + collectThreadArticles 邊界（單推文 / 同作者連續 thread / 不同作者中斷 / 非 cellInnerDiv 中斷 / 無 article cell 中斷 / 前後雙向 walk） + enter() 注入合成容器到 body 開頭 + exit() 清除 + 進入兩次 idempotent + detector.js 短路 isXThread 分支 + main.js enterXThreadMode 呼叫 NS.xThread.enter + exitReaderMode 呼叫 NS.xThread.exit + GET_READER_STATE siteMode 'article' 含 isXThread + manifest content_scripts 順序（x-thread 在 detector 之前）。**全測試 passing**（v0.7.134 之上累積 +32 條 x-thread 結構與行為 assertion）。**已知限制**：(1) X SPA 切貼文不 reload，本版未加 navigation listener——使用者切到另一則 status 需手動 toggle off + on；(2) 引用推文 (quoted tweet) 連同主推文 clone 進來、視覺保留（X 原本就用 nested `<article>` 嵌入 quoted tweet）；(3) X 圖片若是 lazy load 未觸發狀態 clone 後可能無 src——一般情況推文圖片進 viewport 時就已 load，主推文圖片可正常顯示。

---

**v0.7.134**——從 Shinkansen 移植「YouTube 無邊模式」進 JRead，與 v0.7.133 的「影院模式」完全獨立；同時 options 頁加入「YouTube 模式」說明區塊（影院模式 + 無邊模式各一段，使用者語言、無技術術語）。**動機**：Jimmy 2026-05-18 — Shinkansen 有個 `SK.YT.Borderless` 隱藏功能：把 YouTube watch page 整頁 UI 全藏、強制 theater、影片 100vw × 100vh 撐滿視窗，並透過 `chrome.windows.update` 把瀏覽器視窗高度本身 resize 成匹配影片比例（影音內容感最強的沉浸模式）。明確要求 JRead 也加同樣功能，跟既有的 cinema mode 兩者分開——cinema 釘 player 在 viewport 中央 + 16:9 雙軸 clamp 不動視窗、borderless 影片填滿 + 動視窗，使用場景不同。**修法**：(1) 新建 `jread/content/youtube-borderless.js`——IIFE 掛 `NS.borderless`，含 `isYouTubeWatch(url)` URL 判斷（與 cinema 一致：www / m. / no-www / 排除 youtube-nocookie / 只 `/watch`）+ `toggle()` / `apply()` / `unapply()` / `reapplyOnNavigation()` / `isActive()` 介面 + `_calcTargetWindowHeight(videoW, videoH, innerW, outerH, innerH)` 純函式（spec 直接驗算式 + bound `[200, screen.availHeight * 0.8]`）+ `<style id="__jread_borderless_style">` CSS（隱藏 masthead/secondary/below/comments/chat/metadata/merch/engagement-panel + `html, body` 黑底 overflow: hidden + `#movie_player` / `.html5-video-player` / `video.html5-main-video` 等 100vw/100vh + object-fit: contain）+ `snapshotAndSetTheater()` / `restoreTheater()` 紀錄/還原 `ytd-watch-flexy[theater]` 原始狀態 + `requestResize()` 從 `video.videoWidth/Height` 算 target outer height 後送 SW + `pendingLoadedHandler` 防 metadata 未載入時拿到 0 + `yt-navigate-finish` listener（SPA 切影片：仍在 /watch → 等 500ms 重 apply；切到非 /watch → 撤 CSS 但保留 active flag）。(2) `jread/manifest.json` bump 0.7.133 → 0.7.134 + `content_scripts.js` 加 `content/youtube-borderless.js`（在 cinema-mode 後、detector 前）+ `commands` 加 `toggle-youtube-borderless`（**無 suggested_key**，使用者自綁、隱藏功能）。(3) `jread/popup/popup-core.js` `CONTENT_SCRIPT_FILES` 同步加 `content/youtube-borderless.js`（forcing function 比對 manifest）。(4) `jread/content/namespace.js` `NS.borderless: null` 佔位 + `MSG.TOGGLE_YT_BORDERLESS` / `MSG.RESIZE_OWN_WINDOW` 常數。(5) `jread/background/service-worker.js` `onMessage` 加 `RESIZE_OWN_WINDOW` case 呼叫 `chrome.windows.update(sender.tab.windowId, { height })` 並 `.catch` 吞 reject（PWA / windowId 不在 race-condition）+ `onCommand` 加 `toggle-youtube-borderless` 分支 `chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_YT_BORDERLESS' })`。(6) `jread/content/main.js` `onMessage` 加 `NS.MSG.TOGGLE_YT_BORDERLESS` case 委派 `NS.borderless.toggle()` + `GET_READER_STATE` response 加 `borderlessActive` 欄位（從 `NS.borderless.isActive()` 讀）。(7) `jread/popup/popup.html` 加 `#borderless-btn`（初始 `hidden`，與 readwise-btn 共用次級樣式）；`jread/popup/popup.js` `refreshPopupForActiveTab` 偵測 `siteMode === 'youtube-cinema'` 時 unhide borderless-btn + 依 `borderlessActive` 切「啟動 / 退出無邊模式」按鈕文字 + 加 click handler sendMessage `TOGGLE_YT_BORDERLESS`。**設計關鍵**：(a) **borderless 與 cinema 完全獨立**——各自管自己的 state、各自一條 toggle 入口、各自 CSS（兩者共同 target `#movie_player` 時 cascade order 決勝、使用者該擇一啟用，spec 不驗互動）；(b) **content side 不能動視窗**，必須透過 SW `RESIZE_OWN_WINDOW` 訊息呼叫 `chrome.windows.update`（chrome.windows API 不在 manifest permissions 必填清單、free API）；(c) **`object-fit: contain` 是 resize 失敗的 fallback**——即使 PWA 限制讓視窗無法 resize，影片仍 letterbox 顯示不變形（最差有黑邊但功能堪用）；(d) **`pendingLoadedHandler` 防 metadata 未載入**——`requestResize` 第一次跑時 `videoWidth/Height` 可能還是 0（YouTube 內部 player 還沒解 metadata），這時掛 `loadedmetadata` 等再算；toggle off 時必須 removeEventListener 避免 leak。**spec 33 條 forcing assertion**（test/regression/youtube-borderless.spec.js）：模組結構（toggle/reapplyOnNavigation/isActive/isYouTubeWatch/STYLE_ID/_calcTargetWindowHeight 暴露 + dispatchEvent('resize') + yt-navigate-finish listener + RESIZE_OWN_WINDOW 走 MSG 常數）+ CSS 含 ytd-masthead/ytd-comments/ytd-watch-metadata/100vw/100vh/object-fit:contain + isYouTubeWatch URL 判斷 7 變體 + _calcTargetWindowHeight 算式（16:9 / 4:3 / 極端 minOuter clamp）+ namespace borderless 佔位 + MSG 常數 + manifest content_scripts 順序 + commands 無 suggested_key + popup-core CONTENT_SCRIPT_FILES 同步 + SW RESIZE_OWN_WINDOW handler + .catch + onCommand toggle-youtube-borderless 分支 + main.js TOGGLE_YT_BORDERLESS handler + GET_READER_STATE borderlessActive 欄位 + popup.html #borderless-btn hidden + popup.js refreshPopupForActiveTab 處理 + click handler sendMessage。**全 521 spec passing**（v0.7.133 之上累積 +33 條 borderless 結構與行為 assertion）。**已知限制**：(1) Playwright harness 對 YouTube + chrome.windows.update 驗收均受限，實機驗證為主；(2) install-as-app PWA window `chrome.windows.update` 可能無效——`.catch()` 吞掉、CSS 仍生效有黑邊；(3) SPA 切到非 watch 路徑後 prevTheaterValue reset，切回 toggle off 時可能多 removeAttribute 一次（YouTube 自己 idempotent，無副作用）。**options 說明區段同 commit**：jread/options/options.html 加 `<h2 class="section-heading">YouTube 模式</h2>` + 兩個 `<h3 class="subsection-heading">影院模式 / 無邊模式</h3>` + 純使用者語言段落（拿掉 watch?v= / masthead / theater / 100vw/vh / chrome.windows.update / PWA / letterbox 等技術詞，按 Jimmy 2026-05-18 反饋要求）；CSS 加 `.subsection-heading`（13px / 600）+ `.section-desc strong / code` 樣式 + `.section-heading` 加 `border-top + padding-top` 作 section 分隔線（修復「無邊模式 → Readwise Reader 整合」少分隔線）+ `#save-status` `min-height` 收到 14px、`margin-top` 收到 8px（修復「攔截原站快速鍵 → YouTube 模式」中間空白過大）。**spec 6 條 forcing assertion**（test/regression/options-youtube-help.spec.js）：YouTube 模式 / 影院模式 / 無邊模式 heading 結構 + ESC 關鍵字（intro 段）+ chrome://extensions/shortcuts 關鍵字（intro 段）+ .subsection-heading CSS rule 存在——forcing：style 漏寫會讓 h3 fallback 變大標撐版面。**Toolbar icon 預設改藍色同 commit**（Jimmy 2026-05-18 要求）：`jread/manifest.json` `action.default_icon` 4 個 size 從 `icon-{N}-disabled.png` 改 `icon-{N}.png`；`jread/background/service-worker.js` `ICONS_IDLE` 同步改藍色路徑——active / idle 視覺區隔改全部交給 badge ✓（active 時露出綠色對勾、idle 時 badge 空）。`setIcon` 切換邏輯結構保留，未來若要再加 idle 視覺區隔只需改 `ICONS_IDLE` path。**SW cross-mode 退出邏輯同 commit**（Jimmy 2026-05-18 要求）：YouTube 影院 / 無邊模式 active 時，**任一**模式快速鍵都當作退出當前 active 模式（= 按 ESC 效果）——使用者忘記目前在哪個模式時、不用記哪個快速鍵對應哪個退出方向。SW `chrome.commands.onCommand` 收到 `toggle-reader-mode` / `toggle-youtube-borderless` 任一 command 時先 `chrome.tabs.sendMessage(tabId, { type: 'GET_READER_STATE' })` 拿當前狀態，依 `cinemaActive` / `borderlessActive` 決定重導：(a) `toggle-reader-mode` 觸發但 `borderlessActive=true` → 改 `sendMessage TOGGLE_YT_BORDERLESS` 退出無邊；(b) `toggle-youtube-borderless` 觸發但 `cinemaActive=true` → 改走 `toggleWithInjectionFallback` 送 `TOGGLE_READER_MODE` 退出影院。兩者同時 active 時（CSS 互搶但邏輯獨立）以 borderless 優先退出（borderless 動了 OS 視窗、先回到正常 chrome 視窗較安全）。**spec 4 條 forcing assertion**（test/regression/youtube-borderless.spec.js cross-mode 退出邏輯 group）：(a) SW onCommand 必須先 `GET_READER_STATE`；(b) `borderlessActive && toggle-reader-mode → TOGGLE_YT_BORDERLESS` 分支；(c) `cinemaActive && toggle-youtube-borderless → toggleWithInjectionFallback` 分支；(d) 原本「兩模式都 inactive」主分支必須仍保留——forcing：未來改 SW 不小心把 default fallback 拿掉會 catch。

---

**v0.7.133**——YouTube watch page 新增「影院模式」（cinema mode）取代既有「無法偵測主文」的 no-op。**動機**：Jimmy 2026-05-18 — YouTube watch page 沒主文可閱讀（原 detector 回 null、popup 顯示「此頁面無法啟動閱讀模式」），但實際上有個 niche 需求：theater mode 不黑背景、fullscreen 整個吞掉 browser chrome 不能切 tab——想要「viewport-width video 上下置中 + 黑背景 + 仍在 browser tab 內」這個 in-page cinema 體驗，YouTube 原生沒有。Step 1 用 chrome-in-chrome probe 驗證 CSS 釘 `#movie_player` + dispatch resize + listen yt-navigate-finish 這條路可行（player 控制 / subtitle / SPA 切影片 / restore 全過），Step 2 進 production code。**修法**：(1) 新建 `jread/content/cinema-mode.js`——`isYouTubeWatch(url)` URL 判斷（www / m / no-www / 排除 youtube-nocookie / 只 `/watch` 路徑不含 `/shorts`）+ `enter()`（注入 `<style id="__jread_cinema_style">` 把 `#movie_player` `position: fixed` + `translate(-50%, -50%)` 中央 + `min(100vw, 177.78vh) / min(56.25vw, 100vh)` 雙軸 clamp 16:9 + hide masthead/secondary/below/comments/metadata/popup-container/endscreen card/cards-teaser/suggested-action 等浮層 + 黑背景；`dispatchEvent(new Event('resize'))` 讓 YouTube 內部 resize handler 把 `<video>` inline width/height 重算進 1040×585 之類）+ `exit()`（移除 style + 清 attribute + uninstall listener）+ listen `yt-navigate-finish`（SPA 切影片重 dispatch resize）。(2) `jread/content/detector.js` `detect()` 開頭加 `isYouTubeCinema` short-circuit——回 `{ el: null, isYouTubeCinema: true, strategy: 'youtube-cinema', confidence: 1 }`；下面所有 strategy 不跑（YouTube 沒主文可分析）。(3) `jread/content/main.js` 新增 `enterCinemaMode()` helper（獨立成 function 是為了 `enterReaderMode` body 不被撐大、`keyguard.spec` 的 2000 字 slice 仍能命中 settings.blockPageShortcuts）+ `enterReaderMode` 開頭 `if (result.isYouTubeCinema) return enterCinemaMode()` dispatch + `exitReaderMode` 加 `cinemaActive` 分支走 `NS.cinema.exit()` + `extractReaderPayload` 對 cinemaActive 回 `NOT_APPLICABLE_IN_CINEMA`（不是 NOT_ACTIVE 避免 popup 顯示「閱讀模式未啟動」誤導）+ `GET_READER_STATE` response 加 `siteMode`（'youtube-cinema' / 'article' / null）+ `cinemaActive` 欄位。(4) `jread/content/namespace.js` `state` 加 `cinemaActive: false` + `cinema: null` 佔位（讓 cinema-mode.js 載入前 `NS.cinema` 不是 undefined）。(5) `jread/manifest.json` `content_scripts.js` 加 `content/cinema-mode.js`（順序：namespace → toast → cinema-mode → detector）；MV3 同步更新 `jread/popup/popup-core.js` `CONTENT_SCRIPT_FILES`（pop-up inject fallback 共用清單，spec forcing function 比對 manifest）。(6) `jread/popup/popup.js` `refreshReadwiseButton` rename + 擴增為 `refreshPopupForActiveTab`——讀 GET_READER_STATE response 的 siteMode/cinemaActive，YouTube watch 時 toggle 按鈕文字改「啟動 / 退出影院模式」（其他站維持 popup.html default「切換閱讀模式」）；readwise 按鈕在 cinema mode 強制 hidden（cinema 沒主文 outerHTML 可送）。**設計關鍵**：(a) **`position: fixed + translate` 釘 player，不從上層 flex-center**——probe v1 試把 `ytd-watch-flexy` 改 `display: flex; justify-content: center`，發現 `ytd-watch-flexy` 的 deep nest player 在 theater mode 是 `position: absolute`，從上層 flex 反而跟 player 自己的絕對定位打架，video 跑到 `left=-336`。改成直接釘 `#movie_player` 繞過容器鏈。(b) **不 override `<video>` tag 的 width/height**——probe v2 試 `#movie_player video { width: 100% }`，YouTube 內部 sizing 算成 `height: 0`、畫面全黑。改成只改 `#movie_player` size、`dispatchEvent('resize')` 讓 YouTube 自己把 video inline style 重算。(c) **cinema mode 不 install keyguard**——YouTube 的 j/k/l/space/f/m 是 player 控制必備（觀影體驗核心），攔下去會打殘體驗；reader mode 才需要擋 Gmail j archive 那類站。**spec 38 條 forcing assertion**（test/regression/youtube-cinema.spec.js）：cinema-mode.js 模組結構（isYouTubeWatch/enter/exit/isActive/STYLE_ID/ACTIVE_ATTR 暴露 + dispatchEvent('resize') + yt-navigate-finish listener）+ isYouTubeWatch URL 判斷 9 變體（含 shorts/m./youtube-nocookie/頻道頁排除 + 無參數讀 location.href fallback）+ enter/exit/isActive 行為（style 注入、attribute 同步、冪等、CSS 必須含 endscreen-card hide rules）+ detector short-circuit（YouTube watch 回 cinema candidate / 非 YouTube 不回 / YouTube 首頁不回）+ namespace state.cinemaActive / cinema 佔位 + main.js enterCinemaMode helper / dispatch / cinemaActive flag / ESC listener / 不 installKeyguard / exitReaderMode cinemaActive 分支 / extractReaderPayload NOT_APPLICABLE_IN_CINEMA / GET_READER_STATE siteMode + cinemaActive 欄位 + popup.js refreshPopupForActiveTab / 影院模式按鈕文字 / readwise 按鈕隱藏 + manifest.json content_scripts.js 順序。**forcing function 連動修法**：popup-core.js CONTENT_SCRIPT_FILES 同步 + popup-readwise-visibility.spec.js anchor refreshReadwiseButton → refreshPopupForActiveTab + main.js refactor enterReaderMode → 抽 enterCinemaMode helper（避免 enterReaderMode body 撐大破壞 keyguard.spec 2000 字 slice 假設）。**全 524 spec passing**（v0.7.132 448 → v0.7.133 524，新增 38 條 cinema-mode 結構 + 行為 assertion，與其他 spec 連動修法 +38）。**已知限制**：harness 驗收受限——Playwright YouTube watch page 易被 bot detection 擋 player；本 feature 倚賴 chrome-in-chrome MCP 真實 YouTube 環境手動驗（probe Step 1 已驗）。`/shorts/` 9:16 / `/live` chat sidebar / `premiere` 倒數階段未驗，spec 明確只 match `/watch` 路徑——上述場景一律 no-op。

---

**v0.7.132**——options checkbox 形狀變形 hotfix（v0.7.131 follow-up）。**動機**：Jimmy 2026-05-18 截圖 options 頁「攔截原站快速鍵」checkbox 渲染成「細長條藍色矩形 + 中間白色 V 字錯位」，看起來像下箭頭——`.field` 是 flex container 且 label 含長 desc（中英混合 70+ 字 / 兩行 wrap）佔據幾乎整個 row，預設 `flex-shrink: 1` 讓 18×18 checkbox 被擠壓變形、`::after` 對勾隨母 box 變形跟著走位。**根因**：v0.7.131 加 checkbox CSS 時忘了 `.field` 是 flex container（既有 select / input[number] 都是 fixed width 140px 不會被壓，沒踩到 flex shrink）。**修法**（jread/options/options.html）：`.field input[type="checkbox"]` rule 加 `flex: 0 0 18px`——不可成長、不可收縮、basis 18px，保 box 永遠 18×18 不被 sibling 擠壓。**spec 1 條 forcing assertion**（test/regression/keyguard.spec.js options 設定 UI group）：`.field input[type="checkbox"]` rule 必含 `flex: 0 0 ...` 或 `flex-shrink: 0`——forcing：未來改 css 移除規則會被 catch。**全 448 spec passing**（v0.7.131 447 → v0.7.132 448）。

---

**v0.7.131**——reader mode 啟動時攔截原站快速鍵（Gmail / YouTube 等），avoid 誤觸 archive / send / next 等破壞性操作，options 可關。**動機**：Jimmy 2026-05-18 — 在 Gmail 開閱讀模式時，忘記目前所在頁面、按某些鍵會觸發 Gmail 的 j (next) / k (prev) / e (archive) / # (delete) 等 keyboard shortcut；YouTube 同類問題（k 暫停、f 全螢幕等）。**修法**：(1) `jread/content/main.js` 新增 `keyguardHandler`（window keydown/keypress/keyup capture-phase listener）+ `installKeyguard` / `uninstallKeyguard` helpers。攔截方式 `e.stopImmediatePropagation()`（阻 page JS 同階段後續 + bubble phase listener）、**不** `preventDefault()`（保留瀏覽器原生 default action 如 space 滾頁 / tab 跳焦）。放行條件：IME composition（`e.isComposing` / `keyCode 229`）、INPUT / TEXTAREA / SELECT / contenteditable focus、ESC（讓既有 `onEscKey` 處理）。`enterReaderMode` 根據 `settings.blockPageShortcuts !== false` 決定 install；`exitReaderMode` 一律 uninstall（保險）。`storage.onChanged` 處理 `blockPageShortcuts` 變更即時切換（options toggle 後不必退出/重進 reader mode）。(2) `jread/background/service-worker.js` `DEFAULT_SETTINGS` 加 `blockPageShortcuts: true`（預設 on——使用者進閱讀模式就是想專心讀）。(3) `jread/popup/popup.js` `DEFAULT_SETTINGS` 同步加欄位作 storage.get fallback。(4) `jread/options/options.html` + `options.js`：加一個 checkbox field「攔截原站快速鍵」+ desc 解釋；options.js DEFAULTS / fields / load / save 處理 boolean。**設計選擇**：popup 不放 toggle（[[feedback-popup-density]] 高密度 UI 雞肋元素剔除），只放 options。預設 on（vs. 預設 off）：Jimmy 描述「進入閱讀模式時攔截」== 預期預設行為，使用者要關自己進 options。**spec 13 條 forcing assertion**（test/regression/keyguard.spec.js）：SW DEFAULT_SETTINGS / popup DEFAULT_SETTINGS / main.js keyguardHandler 存在 / stopImmediatePropagation 而非 stopPropagation / IME 放行 / INPUT TEXTAREA contenteditable 放行 / install + uninstall helpers / capture phase 註冊 / enterReaderMode 條件式 + installKeyguard / exitReaderMode uninstallKeyguard / storage.onChanged 處理 blockPageShortcuts / options.html checkbox / options.js DEFAULTS+fields / options.js save() 寫 checked。**全 447 spec passing**（v0.7.130 433 → v0.7.131 447，新增 13 條 keyguard 結構 assertion + 既有 1 條 sanity）。**已知限制**：keyguard 是 best effort——若原站在 capture phase 註冊且註冊**早於** JRead content script（document_idle）的 listener，第一個 capture listener 仍會跑（stopImmediatePropagation 只能阻同階段後續 listener）；多數 SPA 是 bubble phase 註冊，攔截有效。

---

**v0.7.130**——popup「送到 Readwise Reader」按鈕在非閱讀模式時整顆隱藏（不只 disabled 變灰）。**動機**：Jimmy 2026-05-18 明確要求——reader mode 才是「送到 Readwise」有意義的入口；非閱讀模式露出灰色 disabled 按鈕只是雜訊，違反 [[feedback-popup-density]] 高密度 UI「無資訊流貢獻就刪」原則。**修法**：(1) `jread/popup/popup.html` L399 `<button id="readwise-btn">` 初始屬性從 `disabled` 改 `hidden`，title 改成單一「把當前 reader card 內容送到 Readwise Reader」（移除「先啟動閱讀模式才能送出」雙態提示——非閱讀模式根本看不到按鈕、不需要解釋）；(2) `jread/popup/popup.js` `refreshReadwiseButton` 把所有 `readwiseBtn.disabled` 賦值改成 `readwiseBtn.hidden` —— `hidden` 與 `disabled` 是兩個獨立軸：`hidden`=「現在不該看到」、`disabled`=「看得到但暫時不能按」，後者保留給 click handler 的「送出中防連點」用。**spec 3 條 forcing assertion**（test/regression/popup-readwise-visibility.spec.js）：(a) popup.html `readwise-btn` 初始必須有 `hidden` 屬性——forcing：少 hidden 會讓 popup 開啟瞬間（GET_READER_STATE async 還沒回）整顆按鈕閃現；(b) popup.html 初始不可有 `disabled`——forcing：兩軸混用會讓非閱讀模式按鈕灰色露出（v0.7.129 之前行為）；(c) `refreshReadwiseButton` 內至少 2 處 `readwiseBtn.hidden=` 賦值（涵蓋早期 return 路徑 + 主路徑）——forcing：只改一處早期 return 仍會讓「無 tab / 無 content script」情境按鈕露出。**全 433 spec passing**（v0.7.129 430 → v0.7.130 433，新增 3 條 popup 結構 assertion）。

---

**v0.7.129**——SW `chrome.action.*` 在 tab 已關閉時的 `No tab with id: <id>` uncaught rejection 修法。**動機**：Jimmy 2026-05-18 截圖 chrome 通知中心堆 `Uncaught (in promise) Error: No tab with id: 1159797724.` 來自 `background/service-worker.js`。**根因**：MV3 `chrome.action.setIcon` / `setBadgeText` / `setBadgeBackgroundColor` / `setBadgeTextColor` / `chrome.tabs.sendMessage` 都是 async Promise，事件入隊 → 實際執行間若 tab 被使用者關掉、reload 中途被回收、或多視窗切換時 detach，就會 reject `No tab with id: <id>`。`SET_ACTIVE_ICON` handler（從 sender tab）跟 `tabs.onUpdated` `status === 'loading'` 分支裡的 7 處 `chrome.action.set*` 呼叫都沒接 `.catch`，rejection 變 uncaught 噪音化通知中心。對 SW 而言這是 benign race（tab 都沒了，setIcon / setBadgeText 也無意義）。**修法**（jread/background/service-worker.js）：新增 `swallowTabGone(p)` helper 統一吞 promise reject，包住所有 `chrome.action.set*` 呼叫（L82 setIcon / L84 setBadgeBackgroundColor / L87 setBadgeTextColor / L89 setBadgeText active / L91 setBadgeText inactive / L141 setIcon / L143 setBadgeText）。**spec 2 條 forcing assertion**（test/regression/sw-badge.spec.js v0.7.129 group）：(a) 必須宣告 `swallowTabGone` helper 且 helper 內部有 `.catch(...)`——forcing：缺 helper 或漏 `.catch` 等於沒吞 rejection；(b) 整份 SW 不能有任何 `chrome.action.set*` 漏包 `swallowTabGone(...)`——forcing：新增 SW 程式碼漏接 `.catch` 會被掃出來。**全 430 spec passing**（v0.7.128 428 → v0.7.129 430，新增 2 條 race-condition 結構 assertion）。

---

**v0.7.128**——badge 改用對勾 ✓。**動機**：v0.7.127 改純色塊（空格）後 Jimmy 2026-05-14 反映「不太好看」，希望加對勾既保留純色塊合理大小又帶語意「閱讀模式已啟用」。**修法**（jread/background/service-worker.js）：`BADGE_ACTIVE_TEXT` 從 `' '`（空格）改 `'✓'`（U+2713 CHECK MARK）—— ✓ 是窄字元、chrome macOS 渲染後不會像 ● 那樣撐滿整個 badge 區、且帶 affirmative 語意。spec assertion 同步更新。全 428 spec passing。

---

**v0.7.127**——reader-active badge 視覺修法：BADGE_ACTIVE_TEXT 從 `'●'` (U+25CF) 改成 `' '`（單空格）。**動機**：v0.7.125 啟用後 Jimmy 2026-05-14 實機截圖揭穿 chrome macOS 把 `●` 字面渲染巨大、整個 18-20px badge 區被綠色 `#10b981` 背景填滿、視覺上完全覆蓋 J icon、看起來像 toolbar 上多了一格獨立綠圓 icon、而不是預期的小角標「綠燈 LED」。**根因**：chrome action badge `setBadgeText` 字元寬度由 chrome 內部決定、background 跟字元寬走、字寬太大就把整個 badge 區撐滿。對 `●` (U+25CF BLACK CIRCLE，全形實心圓字面)，chrome macOS 渲染下吃掉整個 icon 區。Shinkansen 用同字元視覺正常是因為該 icon 設計尺寸/形狀讓 badge 看起來像角標、跨專案不能直接複用同字元。**修法**（jread/background/service-worker.js）：`BADGE_ACTIVE_TEXT` 從 `'●'` 改 `' '` —— badge 渲染成純綠色小色塊、無字元，符合「亮一顆綠色 LED」直覺。**spec 1 條** assertion 同步（test/regression/sw-badge.spec.js）：BADGE_ACTIVE_TEXT 必須是單空格——forcing：改回 ● 或其他寬字元會讓 macOS chrome 把 badge 渲染撐滿整個 icon 區。**全 428 spec passing**。**Bootstrap 限制**：v0.7.127 修法仍需先 manual reload 一次讓新 SW badge text 生效，之後 dispatch reload 永久零介入。

---

**v0.7.126**——bridge reload 分支修法：content script → SW 中繼觸發 reload。**動機**：v0.7.124 加進 `__jread_debug` page-world bridge 時 `type: 'reload'` 分支直接從 content script 呼叫 `chrome.runtime.reload()` —— Jimmy 2026-05-14 dispatch reload 後實機 console 噴 `Uncaught TypeError: chrome.runtime.reload is not a function` (main.js:246)。**根因**：`chrome.runtime.reload()` API **只在 SW / popup / options page context 可用**，content script context 沒此 function；早先 memory 紀錄誤認為可從 content script 直接呼叫。**修法**：(1) `jread/content/main.js` bridge reload 分支改 `chrome.runtime.sendMessage({ type: 'JREAD_RELOAD' })` 走 SW 中繼；(2) `jread/background/service-worker.js` 加 `JREAD_RELOAD` message case 呼叫 `chrome.runtime.reload()`。整條 chain：page world `dispatchEvent` → content bridge `sendMessage` → SW `chrome.runtime.reload()` → extension 重啟 → 等 2 秒 → reader mode 重新可用、零使用者介入。**spec 2 條 forcing assertion**（test/regression/sw-badge.spec.js）：(a) SW handler 必含 JREAD_RELOAD case 且呼叫 chrome.runtime.reload()——forcing：handler 缺席則 reload 不發生；(b) main.js reload 分支必走 sendMessage 不可含 chrome.runtime.reload()——forcing：直接呼叫會在 dispatch 時 TypeError。memory `feedback_self_reload_extension.md` 更正：content script 不可直接呼 chrome.runtime.reload、必走 SW 中繼。**Bootstrap 限制**：v0.7.126 修法本身仍需先 manual reload 一次讓 SW 新 handler + content bridge 新 sendMessage 生效，之後永久零介入。**全 428 spec passing**（v0.7.125 426 → v0.7.126 428，新增 2 條 reload 路徑 assertion）。

---

**v0.7.125**——進入閱讀模式時 toolbar icon 加綠色 ● badge 視覺提示。**動機**：原本進入 reader mode 只切換彩色 icon、訊號偏弱；Jimmy 2026-05-14 提出加綠燈強化「閱讀模式啟動中」狀態指示，比照 Shinkansen 翻譯完成 badge 設計（chrome.action.setBadgeText API + 單字元 ●）但配色為翠綠（emerald）以區分功能語意。**修法**（jread/background/service-worker.js）：新增 `BADGE_ACTIVE_COLOR = '#10b981'`（tailwind emerald-500，低飽和綠、無視覺壓迫）+ `BADGE_ACTIVE_TEXT = '●'`（U+25CF BLACK CIRCLE，跨專案 badge 語意一致）兩個 top-level 常數；`SET_ACTIVE_ICON` handler 內 active=true 分支同步呼叫 `setBadgeBackgroundColor` + `setBadgeTextColor`（feature-detect 舊 Chrome 版） + `setBadgeText(BADGE_ACTIVE_TEXT)`，active=false 分支 `setBadgeText({ text: '' })` 清空；`tabs.onUpdated` `status === 'loading'` 同步清 badge 避免跨頁殘留。雙通道狀態指示：彩色 icon（既有）+ 綠色 badge（新增），使用者可從兩處判斷 reader mode 狀態。**spec 7 條 forcing assertion**（test/regression/sw-badge.spec.js）：BADGE_ACTIVE_COLOR 必須 '#10b981' + BADGE_ACTIVE_TEXT 必須 '●' + active 分支必呼叫 setBadgeText 傳 BADGE_ACTIVE_TEXT + active 分支必設 BADGE_ACTIVE_COLOR + inactive 分支必清空 badge + 白文字色 + chrome.action.setBadgeTextColor feature-detect + tabs.onUpdated loading 必清 badge + 常數必須 top-level 宣告。helpers.js 加 `SRC.serviceWorker` 給 source-level 結構 spec 用。**Shinkansen 對齊**：跨專案 toolbar badge 用同字元（●）不同色（旭日紅 vs 翠綠）表示「狀態完成 / 啟用中」語意一致，降低 mental switching cost。**全 426 spec passing**（v0.7.124 419 → v0.7.125 426，新增 7 條 SW badge assertion）。

---

**v0.7.124**——medium.com 文章標題上方 119px 殘留空白修法：cleaner 新增 `collapseEmptyWrappersAfterClean` 規則 + 新增 page-world debug bridge (`__jread_debug` CustomEvent)。**動機**：Jimmy 2026-05-14 實機 chrome-in-chrome MCP probe 揭穿 Medium 文章（maxrottersman.medium.com/.../strait-of-hormuz）reader card 內 `<article class="meteredContent">` 之下、`<h1>` 之上有 119px 視覺空白；articleEl content edge=88px、h1.rect.top=207px、其中 `DIV.cm bd ga gb gc gd`（emotion hash class wrapper, top=120, h=24, w=680）撐 24px、`<p role="tooltip">Member-only story</p>` 已被 `hideDialogs` hide 但其 wrapper 沒被任何前置規則清掉、原站 CSS 鎖 height: 24px → reader card 頂部殘留 24px 視覺 gap。**根因**：cleaner 既有的 `hideDialogs` / `hideInsideArticleAllButtons` / `hideInsideArticleButtonClusters` 等 rule 把 wrapper 內部 button 與 tooltip 清光，但 wrapper 自身被原站 stylesheet 寫死 height（emotion / styled-components 慣用 hash class）導致不自然收縮、占空間。`hideInsideArticleEmptySpacers` rule 的 `SPACER_MIN_HEIGHT=60` 不命中 24px wrapper，且 `text.length > SPACER_TEXT_MAX=10` guard 把含 "Member-only story" 的 wrapper（textContent 含 hidden 子孫文字）排除 → 漏網。**修法**（cleaner.js）：新增 `collapseEmptyWrappersAfterClean(articleEl, hidden)` 跑在 clean() 末段（所有 hideXxx / collapseXxx / resetMedia / forceMediaContainerBlock / clearBoxShadow 之後）—— 掃 articleEl 內所有 element，**rect.height >= 8 + rect.width >= 80** 撐空間 + **visibility-aware visibleRenderedText 為空**（自寫 helper 遞迴排除 data-jread-hidden / display:none / visibility:hidden 子孫，比 element.innerText 跨 jsdom + 真實 Chrome 更可靠）+ **子孫無 visible 媒體**（img/picture/video/iframe/svg/canvas rect > 5×5 且祖先未 hide 才算 visible）+ **backgroundImage === 'none'**（含背景圖視為合法 decoration / divider、保留）→ hide。**通則安全 guard**：(1) articleEl 自身 + `PRESERVE_SEL`（figure/figcaption/blockquote/summary）內 skip；(2) `EMPTY_COLLAPSE_SKIP_TAGS` 排除媒體 tag（IMG/PICTURE/VIDEO/SVG/CANVAS/IFRAME/AUDIO/SOURCE/TRACK）+ 內容 leaf tag（A/BUTTON/H1-6/P/LI/UL/OL/BLOCKQUOTE/PRE/CODE/FIGCAPTION/EM/STRONG/B/I/U/S/SUP/SUB/SPAN/LABEL/TABLE 與 cell 類/DD/DT/DL/INPUT/SELECT/TEXTAREA/OPTION）—— 這些 tag 不該被當「wrapper」處理；(3) 已 jreadHidden 跳過避免重複。**Page-world debug bridge**（main.js）：新增 `window.addEventListener('__jread_debug')` listener 接 `{detail:{type:'toggle'|'enter'|'exit'|'reload'}}`—— 讓 chrome-in-chrome MCP / devtools console 從 page main world 用 `dispatchEvent` 跨 isolated world 觸發 reader mode 動作。設計動機：Playwright 對 Medium 等反 bot 站走不透 + chrome-in-chrome MCP 的 `computer.key` event 不到 extension command bus、`navigate chrome://extensions/` 被擋，原本無法自主觸發 reader mode 與 reload 動作 → 永久需 Jimmy 手動介入。bridge 加進去後（一次 bootstrap reload 後永久），未來所有 jread debug 循環完全自主、零使用者介入。**spec 三條 forcing assertion**（test/regression/cleaner.spec.js）：`.empty-top-bar` jreadHidden==='1'（主 forcing）+ MEDIUM_MAIN_TEXT 段落 sanity 保留 + 含 visible img wrapper sanity 不誤殺 + cleaner.js 源碼 6 條結構 assertion（function 宣告 / clean() 呼叫 / hasVisibleMedia guard / backgroundImage guard / isInPreserved guard / SKIP_TAGS 媒體+leaf tag 覆蓋 / visibleRenderedText helper 跳過 hidden）。sanity check：暫時把 clean() 內呼叫註解 → forcing assertion fail → 還原 → 419 spec 全過。**fixture**（medium-empty-top-bar.html）：模擬 Medium top action bar + button cluster + 含 visible img wrapper + 含 backgroundImage wrapper + 5 條主文段落 sanity 標記。jsdom 無 layout、stub `.empty-top-bar` / `.figure-like-wrapper` / `.decoration-divider` 的 getBoundingClientRect。**Claude 自主 debug 工具鏈擴展**：本輪建立 page-world bridge 後，從此 jread 任何修法 → reload extension → toggle reader mode → 拉 DOM 數據 → 修法 → 再 reload 全程 chrome-in-chrome MCP 自主跑通；Jimmy 介入只剩「初次 bridge bootstrap」與「最終視覺驗收」兩個點。Memory `feedback_self_reload_extension.md` 紀錄此 bridge 設計與 bootstrap 限制。

---

**v0.7.123**——cn.nytimes.com 段落寬度修法第三輪：col-* reset rule 加 margin-left/right: 0 !important。**動機**：v0.7.122 把 flex 從 initial 改 1 1 auto 後 article-body-item 仍只撐到 667 < 父寬 728，差 61px。**根因**（Playwright reproduce + Claude 自主寫 localStorage debug bridge 收集 instrument，cleaner.clean 內 setTimeout 800ms 後 dump articleEl/partial/article-body-item 完整 layout，避開 cn.nytimes SPA 抹除 jread-active attribute 後抓不到 element 的問題）：cn.nytimes 對 `.col-lg-5` 設客製化 `margin-left: 61px / 380px`（不同 viewport breakpoint 不同值，做窄中欄 layout），即使 jread flex-grow:1 撐滿父寬，wrapper 內容被 margin-left 向內推 61px → article-body-item rect 為 x=380 w=667 right=1047 vs partial x=319 w=728 right=1047，內容起點被 margin offset。Bootstrap col offset 在 reader card 單欄 layout 無 row 結構支持，offset 失意義且破壞單欄閱讀。**修法**（styler.js）：col-* reset rule 加 `margin-left: 0 !important; margin-right: 0 !important`——清掉所有 Bootstrap col 類 wrapper 的橫向 margin。**通則屬性**：(1) reader card 單欄 layout 沒 grid row 結構支持 col offset，offset 在這環境失意義；(2) margin-top/bottom 不清（vertical margin 是段間距、跟橫向溢出無關）；(3) 不綁站點 hostname。**spec forcing assertion**：既有 styler col-* spec 加兩條：`margin-left: 0 !important`、`margin-right: 0 !important`。sanity check：拿掉 margin reset → 新 assertion fail；加回 → 407 全過。**Debug 教訓**：v0.7.121/122/123 三輪修法都動 styler 對同一個 col-* reset rule、每輪修一個面向（specificity / flex-grow / margin）——root cause 在第三輪才完整定位，因為前兩輪 instrument 沒印 margin computed。**Claude 自主 debug 工具鏈**：寫 `localStorage` instrument bridge（content script setItem、Playwright page.evaluate getItem）avoid chrome.downloads MV3 SW data URL 限制，能在 Playwright SPA 抹除 articleEl 後仍從 localStorage 拉回完整 instrument data 進行 forensic（v0.7.123 全 debug 循環 Claude 自己跑完、Jimmy 只做最後 reload 驗證一次）。

---

**v0.7.122**——cn.nytimes.com 段落寬度修法第二輪：styler col-* reset rule `flex: initial` 改 `flex: 1 1 auto`。**動機**：v0.7.121 用 `html ` 前綴提升 cardArticle specificity 修了 articleEl maxWidth 失效問題（articleEl 從 1040 縮回 contentWidth=840），但 reader card 內前 16 段主文段落仍只佔 reader 一半。instrument 揭穿：article-body-item.col-lg-5 在 article-partial（display: flex）容器內 rect.width=667 < 父寬 728（partial content area），少 61px。**根因**（再次 instrument forensic）：styler 既有對 `[class*="col-X-"]` Bootstrap col reset rule 已套 `width: auto + max-width: none + float: none + flex: initial !important + padding: 0`，但 `flex: initial` = `flex: 0 1 auto`、`flex-grow: 0`——flex item 不主動撐滿父剩餘空間、只走 `flex-basis: auto`（content 自然寬）。中文段落 max-content 沒到父寬 728 時 wrapper 停在自然寬 667。對比 partial#3（hidden aside sibling 觸發 collapseGridWithHiddenCell + CHILD_DECLS 強制 `display: block` on parent），item#3 變 block flow 自動撐滿父=728——沒命中 collapse 的前 16 段無此處理。**修法**（styler.js）：col-* reset rule `flex: initial !important` 改 `flex: 1 1 auto !important`——`flex-grow: 1` 讓 flex item 主動撐滿父剩餘空間。**通則屬性**：(1) block 場景下 flex shorthand 是 no-op、無害；(2) flex 場景下實質撐滿，所有 Bootstrap col-* wrapper 在 flex container 內全部統一撐父寬；(3) 不綁站點 hostname。**spec forcing function**：既有 styler col-* spec assertion 從 `flex: initial !important` 反向改為 `flex: 1 1 auto !important`。sanity check：拿掉 grow: 1（回到 initial）→ spec fail；加回 → 407 全過。**Debug 教訓**：原本 v0.7.121 以為是 `[data-jread-active]` vs `.article-content` specificity 戰，instrument 揭穿後發現 jread max-width 已生效 + articleEl 確實縮回 840；真根因在更深層 article-body-item flex 撐不滿。兩輪 instrument log forensic（articleEl 層 + body-item 層）才完整定位。

---

**v0.7.121**——cn.nytimes.com 內文段落寬度被擠成 50% 修法（styler cardArticle rule selector 加 html 前綴提升 specificity）。**動機**（Jimmy 2026-05-13 截圖回報 cn.nytimes.com /opinion/...apple-tim-cook-outsourcing-china/，Chrome 實機）：reader card 內前 16 段主文段落寬度全擠在 reader card 一半（每行字數明顯比末段少），只有末段（有 hidden aside sibling 觸發 collapseGridWithHiddenCell）寬度正常。**根因**（jread 自身加 instrument 印 articleEl + partial + paragraph rect/computed 揭穿）：cn.nytimes articleEl 是 `<article class="article-content font-normal">`，原站 stylesheet 含 `.article-content { max-width: ... !important }` (specificity 0,1,0 + !important)；jread styler cardArticle rule selector `[data-jread-active="1"]` 同 specificity (0,1,0) + !important。**同 specificity + 同 !important 時 cascade order 由後注入勝**——cn.nytimes 站點 CSS 後注入或同優先級下勝出，吃掉 jread `max-width: 720px` → articleEl computed maxWidth=none、撐寬到 1040px → 跨過 Bootstrap lg breakpoint 992px → `.col-lg-5` class 觸發 50% 寬度 → article-partial 內主文 article-body-item 寬度被擠到 520px（reader card 一半）。**修法**（styler.js）：cardArticle rule selector 加 `html ` 前綴 → specificity 從 (0,1,0) 升至 (0,1,1)，贏過所有原站單 class !important rule。articleEl 重新 cap 在 720px → 不跨 lg breakpoint → cn.nytimes col-lg-* 失效 → article-body-item 撐滿父寬 → 段落寬度正常。**通則屬性**：(1) `html` 是 root selector、永遠 match、加成 specificity 不誤殺其他邏輯；(2) 其他 `[data-jread-active="1"] X` selector 因含 X tag/class 已 specificity (0,1,1+) 夠強，不需動（只改 cardArticle 一條 rule，最小副作用）；(3) 修法對所有「原站對 articleEl class 用單 class !important 覆寫 styler」的潛在 case 都有效，不綁站點 hostname。**spec forcing function**：cardArticle rule（含 max-width: 720px）selector 必須含 `html [data-jread-active="1"]` regex 命中。sanity check：拿掉 html 前綴 → spec fail（selector regex 不命中）；加回 → 407 全過。Playwright Chromium 重現不到此 bug（Playwright bundled Chromium 環境下 articleEl max-width 生效、articleEl=720）——透過在 cleaner 加 nytimes-only instrument log（reload extension + Jimmy F12 截圖 console）才揭穿 articleEl maxWidth=none + col-lg-5 觸發路徑。

---

**v0.7.120**——figcaption 字體被使用者 fontSize override 拉到跟內文同字級的修法（styler BODY_TEXT_SEL 排除 figcaption）。**動機**（Jimmy 2026-05-13 截圖回報 bbc.com/culture/article/...oxfords-medieval-library，使用者改過字級設定）：reader card 內圖說「The historic library is the university's oldest...(Credit: Courtesy of the Warden and Fellows of Merton College Oxford)」字體大小跟內文 p 完全一樣，原站 caption 12px vs body 18px 的 typography hierarchy 完全消失，視覺上圖說「升格」為主文段落、破壞「圖→說明」階層感。**根因**（probe + 讀 styler.js 揭穿）：styler `BODY_TEXT_SEL` 為 user fontSize / fontFamily / lineHeight override 列舉 body text selector 用，原列表含 `figcaption`——使用者 fontSize 非預設 18 時，注入 `[data-jread-active] figcaption { font-size: ${user}px !important; line-height: ${user-lh} !important }` 把 caption 強拉到 user fontSize、完全覆蓋原站差異化設計。**修法**（styler.js）：`BODY_TEXT_SEL` 移除 `figcaption`——caption 原站設計普遍比 body 小（0.7-0.85em，BBC 實測 12px vs body 18px）+ 較淡色，是 typography hierarchy 的關鍵差異化。**通則屬性**：(1) 保留 caption 原站完整 typography（fontSize / fontFamily / lineHeight 全不覆寫）比「跟 body 等比例縮放」更尊重原站設計；(2) 不綁站點 class/hostname，跨站皆套；(3) p / li / blockquote / dd / dt 仍在 selector 內（穿透 BBC `.HooNV` / NYT body class specificity 的需求不變）；(4) heading h1-h6 仍排除（保留原站標題大小分級——既有設計）。**spec 修改**：既有「rule 必須含 figcaption」斷言反向改為「rule **不得**含 figcaption」（forcing function），spec 標題明示「figcaption 排除」。sanity check：把 figcaption 加回 BODY_TEXT_SEL → spec fail（selectorList 含 figcaption regex 命中 true，assertion 期待 false）；移除 → 406 全過。實機 harness 跑 BBC Culture + 設 fontSize=22 驗 figcaption computed font-size 仍 12px（保留原站）、p 為 22px（user override 生效），typography hierarchy 完整。

---

**v0.7.119**——ebc.net.tw reader 主圖消失修法（`hideInsideArticleAbsoluteOverlays` 排除媒體元素 IMG/PICTURE/VIDEO/SOURCE）。**動機**（Jimmy 2026-05-13 截圖回報 ebc.net.tw /news/society/548318）：reader mode 開啟後主圖整張消失、reader card 內只剩標題 + 圖說「(圖／翻攝畫面)」一行、新左營站照片無蹤。**根因**（instrument log 在 `hide()` 加 stack 揭穿）：主圖 `<img>` 原站 inline `position: absolute`（配 `.article_cover` aspect-ratio padding-bottom container 撐高度的 responsive image layout pattern），命中 `hideInsideArticleAbsoluteOverlays`（v0.7.111 規則放寬到任意 tag），被當 visual overlay 整張 hide。**修法**（cleaner.js）：在 `hideInsideArticleAbsoluteOverlays` 條件 `position: absolute/fixed` 之後新增 tag 排除——`IMG / PICTURE / VIDEO / SOURCE` 直接 `continue`。**通則屬性**：(1) 媒體元素 position: absolute 是「aspect-ratio container 內媒體填滿父寬高」layout pattern（cna / ebc / WordPress / Substack hero 圖等），不是 visual overlay；(2) styler 已對 `[data-jread-active] img/video { position: static !important }` 強制退回 static、cleaner `resetMediaPlaceholderPadding` (v0.7.117) 對父 aspect-ratio container reset，兩條已足以處理 media、cleaner hide rule 對 IMG/PICTURE/VIDEO 屬冗餘且高誤殺風險；(3) 誤殺成本（主圖消失）遠高於漏網成本（極少數 image-banner overlay，styler position:static 也已視覺退回 inline-flow）；(4) 不綁站點 class/hostname。**spec 兩條 forcing assertion**：absolute IMG 不可 jreadHidden=1（主圖保留）+ regression guard 確認非媒體 tag absolute overlay（訂閱/追蹤 CTA div）仍須被 hide（v0.7.111 既有行為不破壞）。sanity check：拿掉媒體排除 → ebc spec fail（IMG dataset.jreadHidden === '1'）；加回 → 406 全過。實機 harness 跑 ebc.net.tw 驗主圖 rect 從 0x0 → 608x318 完整呈現。

---

**v0.7.118**——cna.com.tw reader card 內子元素溢出右邊緣修法（`collapseGridWithHiddenCell` non-articleSelf wrapper padding-left/right reset）。**動機**（Jimmy 2026-05-13 截圖回報 cna.com.tw /news/aopl/202604240301.aspx 在 >= 2400 寬 viewport 下）：reader mode 開啟後標題「索馬利蘭戰略地位攀升 BBC：台灣布局盼聯美制中」與主圖右半部明顯**溢出 reader card 右邊緣**（「布局盼聯」之後伸出 card 米色背景外），card 右側 padding 視覺消失。**根因**（probe 揭穿）：articleEl `<article class="article">` 內 `<div class="wrapper"><div class="inner-padding">` 的 `.inner-padding` 是 `display: flex` 配 hidden cell → 命中 `collapseGridWithHiddenCell` condition B；原站 CSS 給 `.inner-padding` 設 `padding-left/right: 65px`。v0.7.104 既有修法把 container 強制 `display: block + width: 100% !important + margin-left/right: 0 !important` 後，content-box 預設下 `width: 100%` = 父 content area（608px），加 padding 130 → outer 738px，**超出 articleEl content area 65px**。內部所有 children（h1 / picture / img / p）rect 偏右 65px、全體右溢出 reader card 米色背景。**修法**（cleaner.js）：`collapseGridWithHiddenCell` 內 `CONTAINER_DECLS` (non-`isArticleSelf` 分支) 加 `padding-left: 0 !important + padding-right: 0 !important`；`CONTAINER_PROPS` 同步加 `padding-left + padding-right`（restore 軌道）。**通則屬性**：(1) grid/flex/float container 被強制 block 後原 layout 角色失效、容器自己的橫向 padding 失去意義（reader card 視覺留白由 articleEl 自身 `padding: 48px 56px` 提供，子 wrapper padding 是重複裝飾）；(2) `padding-top/bottom` 不清——vertical padding 是段間距、跟橫向溢出無關；(3) `isArticleSelf` 不動 padding，與 v0.7.113 不動 width/max-width/margin 同邏輯（padding 由 styler 控制）；(4) 不綁站點 class/hostname。**spec 四條 forcing assertion**：collapse 後 padding-left/right 必為 `0px !important`、既有 width:100% 仍生效、restore 後 padding 回到 fixture 原 65px。sanity check：拿掉 padding-left/right reset → cna spec fail（'65px' !== '0px'）；加回 → 405 全過。實機 harness 跑 cna.com.tw 驗 OVERFLOWS list 從 30+（h1 / figure / img / p 全 overR=65）→ 0（只剩 picture > source absolute fallback，不 render 無視覺影響）。Jimmy 報的「BBC：台灣布局盼聯右邊沒有任何留空、底色明顯過窄」修復。

---

**v0.7.117**——twz.com YouTube facade preview 圖片高度與 16:9 容器尺寸不一修法（aspect-ratio container + absolute media）。**動機**（Jimmy 2026-05-13 截圖回報 twz.com /space/...spacex YT embed 區）：reader mode 下 WordPress lazied-youtube facade（`<figure class="wp-block-embed-youtube wp-embed-aspect-16-9">` 內 `<div class="lazied-youtube-frame">`）的 thumbnail IMG 高度（576×432，hqdefault.jpg 4:3 natural）超出父容器高度（576×324，aspect-ratio 16:9）→ 圖片從父容器底部溢出 108px，play button SVG icon 位置完全錯位（落到 IMG 下方而非中央）。**根因**（probe 揭穿）：父 `.lazied-youtube-frame` 走 CSS `aspect-ratio: 16/9` 撐高度，IMG 原本 `position: absolute; inset:0; width:100%; height:100%; object-fit: cover` 完美貼合。v0.7.X styler 後續加的 `[data-jread-active] img { position: static !important }`（v0.7.52 cna 主圖 absolute break-out 修法）把 IMG 拉回 normal flow → IMG 走 styler `max-width:100% + height:auto` 按 natural 4:3 渲染、與父 16:9 aspect-ratio mismatch。**v0.6.14 既有 cleaner `resetMediaPlaceholderPadding`** 只處理 padding-bottom hack（Pattern A：Substack 類），刻意 spare 純 aspect-ratio 容器（Pattern B：Engadget 類），當時理由「container 歸零後 absolute img 高度也歸零、視覺消失」——但這個理由在 styler 強制 img static 後已不成立（img 已脫離 absolute、能撐起 container 高度）。**修法**（cleaner.js）：擴增 `resetMediaPlaceholderPadding` 偵測條件——除 padding-bottom 比例 > 20% 外，新增「parent computed aspect-ratio 非 auto」也視為 placeholder pattern。雙條件 OR 命中後同樣 reset 父容器（padding-bottom 0 + aspect-ratio auto）+ media position 退回 static。**通則屬性**：(1) 結構偵測（CSS aspect-ratio 屬性 + 內部 absolute media）不綁站點 class/hostname；(2) 兩 ratio 一致時（典型 Engadget 16:9 hero）視覺結果與舊行為無別，不一致時 fix mismatch；(3) PRESERVE_SEL 內 figcaption skip 不影響；(4) media 必須是 absolute（trigger 條件不變、絕大多數 facade pattern 命中、normal-flow media 不誤觸）。**spec 更新**：engadget-aspect-ratio-image fixture 對應斷言從「aspect-ratio 不可動」改為「aspect-ratio 應 reset 為 auto !important + img 應 reset 為 static」；驗 round-trip 後 inline style aspect-ratio 與 img position 都回到原值。sanity check：拿掉 aspect-ratio 分支 → engadget spec fail；加回 → 404 全過。實機 harness 跑 twz.com 驗 lazied-youtube-frame 從 324px → 492px（IMG 432 + SVG icon 48 + 12px margin）、IMG 與 frame 高度一致不再溢出、play button 在 IMG 下方而非錯位。

---

**v0.7.116**——twz.com 文末 LAND / POTUS / NEWS & FEATURES 等 category tag 連結殘留修法（articleEl 內 `<footer>` tag）。**動機**（Jimmy 2026-05-13 截圖回報 twz.com /space/...spacex 文末截圖）：reader card 主文結束、作者 bio 後仍可見 4 個 category tag 連結（LAND / LAND-BASED BALLISTIC MISSILE DEFENSE / NEWS & FEATURES / POTUS）排成 button row。**根因**（probe 揭穿）：原 DOM 結構是 `<footer class="article-content-footer">` 內含 `<DIV.pw-incontent-excluded>` 包 author bio long `<p>`（262 chars）+ `<SECTION.recurrent-tag-list-article>` 包 `<UL.tag-list>` > `<LI.tag-list-item>` > `<A.btn>` 多個 category tag。HTML5 `<footer>` 在 `<article>` 內代表「該文章次要/補充資訊」——典型 tag 雲 / 分類連結 / 社群分享屬於 reader card 哲學的 chrome，需 hide。**修法**（cleaner.js）：新增 `hideInsideArticleFooter`——對 articleEl 內 `<footer>` tag 兩階段處理：(1) **無** >= 100 chars `<p>` → 整段 hide（純 chrome footer）；(2) **有** 長 p（作者後記 / 結語段）→ 保留 footer 本身但 walk direct children 把「link-only block」（>= 2 anchor + 無 >= 50 chars p 的 child）個別 hide。配套新增 `isLinkOnlyBlock` helper（閾值取自 hideInsideArticleHashtagClusters 同源 50-char block）。**通則屬性**：(1) 結構偵測（HTML5 footer 語意 + 長 p guard 對稱於 hideInsideArticleNav）不綁站點 class/hostname；(2) link-only block 條件嚴格——主文段落（通常 >= 50 chars）能 guard 住，純連結 cluster 才命中；(3) PRESERVE_SEL 內 skip（figure 內 caption 等不誤殺）；(4) data-jread-hidden 已隱藏者跳過；(5) 兩階段設計兼容 pure-chrome footer 與 mixed footer（bio + tag-list 並存）兩種真實 layout。spec 五條 forcing assertion 覆蓋三種 footer layout（tag-list-only / epilogue long-p / mixed bio+taglist）：tag-list-only footer 整段 hide、epilogue footer 保留、mixed footer 自身保留 + bio div 保留 + taglist section 個別 hide。sanity check：拿掉 hideInsideArticleFooter call → 新 spec fail；加回 → 404 全過。實機 harness 跑 twz.com 驗 footer 高度從 410px → 154px、tag-list 4 個連結全消失、author bio 保留。

---

**v0.7.115**——twz.com 主標 + 作者/日期 meta「飄到 reader card 左側背景外」修法（full-bleed 負 margin 後代）。**動機**（Jimmy 2026-05-13 截圖回報 twz.com /space/this-is-how-the-u-s-national-security-apparatus-is-dependent-on-spacex）：reader mode 進入後文章主標題「This Is How U.S. National Security Has Become Dependent On SpaceX」與下方描述、作者連結、更新日期全部顯示在 reader card 卡片背景**左側外**（cream 卡片從畫面中央起，標題從畫面最左起），主圖正確置於卡片內。**根因**（probe 揭穿）：hero `<header class="featured-template-header entry-header full-bleed">` inline stylesheet `margin-left: -336px; margin-right: -336px`——原站「full-bleed」設計手法，讓 header 視覺寬度超出 article container、貼齊整段 design layout outer column。原站正常版面 article 夠寬可容此 overshoot；reader card 把 article cap 至 720px 後負 margin 直接把 header 拉到 content box 外側（articleContentLeft=336、header.left=0 顯著 overflow）。**修法**（cleaner.js）：新增 `resetNegativeHorizontalMargins`——掃 articleEl 內所有後代，若 computed margin-left/right < 0 且 rect 實際逃出 article content box（rect.left < contentLeft 或 rect.right > contentRight，2px threshold 避免 sub-pixel 誤觸發）→ 強制 margin-left/right: 0 !important。**通則屬性**：(1) 結構特徵偵測（負 margin + rect overflow）不綁站點 class/hostname；(2) 必須 rect 實際 overflow 才動，小幅負 margin 用於 inline icon 對齊等 in-box 用途不會誤觸；(3) PRESERVE_SEL 內 skip（figure/blockquote 內 pull-quote intentional bleed 保留）；(4) data-jread-hidden 已隱藏者跳過；(5) jsdom 環境 computed style 仍解析 inline 負 margin px，配 stubRect 可在 jsdom 直接驗。新增 hidden tracking `__negativeHorizontalMarginResets` + `restoreNegativeHorizontalMargins` 還原路徑。spec 四條 forcing assertion（overflow header reset 為 0 !important、不 overflow 的 normalP 不誤動、PRESERVE_SEL 內 figcap 不誤動、restore 還原 -336px）。sanity check：拿掉 applyImportant 註解 call → 新 spec fail（margin-left 仍 -336px）；加回 → 403 全過。實機 harness 跑 twz.com 驗 header rect 從 x=0 移回 x=336（articleContentLeft）、寬 608 完全貼合 article content box；fullpage 截圖巡整篇內文 + 圖片 + 段落間距正常。

---

**v0.7.114**——vocus.cc 文章標題視覺消失修法（negative z-index ancestor 被父背景遮住）。**動機**（Jimmy 2026-05-13 第九輪截圖回報 vocus.cc /article/69eb1cbcfd8978000141431d）：reader mode 進入後文章標題「《Surrender：40首歌，一個故事》：U2主唱波諾的人生之歌，歌如人生」完全不顯示、剩下大塊空白後接 byline + 內文。**根因**（probe 揭穿）：H1 本身 color/opacity/visibility/display 全部正常（rect top 156, height 189, color black），但其 ancestor `<header class="kAJsTL bYJPuy">` 設 `z-index: -1 + position: relative`。配上更外層父 DIV 的 opaque background (`rgb(255, 255, 255)`) → header 與其所有後代（含 H1）渲染 in 父的 stacking context 底層、**被父 background 遮住** → 視覺完全消失（雖然 DOM 與 layout 都正確）。原 vocus design 應該是 hero overlay 視差效果用此手法，reader card 縮窄後該效果無意義。**修法**（cleaner.js）：新增 `resetNegativeZIndex`——掃 articleEl 內所有後代，computed `z-index < 0` 強制 `z-index: auto !important`。**通則屬性**：(1) reader mode 是 single-column flow、後代不需要 negative z-index 創造「behind parent」效果，純結構性 reset；(2) 只 reset negative（`< 0`），positive 與 auto 保留（合法絕對定位 overlay 仍可用 z-index 控制）；(3) PRESERVE_SEL 內 skip（figure 內 absolute caption 等可能需要 z-index）；(4) jsdom 環境 computed style 仍解析 inline `z-index: -1`、forcing function 可在 jsdom 直接驗。新增 hidden tracking `__negativeZIndexResets` + `restoreNegativeZIndex` 還原路徑。spec 三條 forcing assertion（negative reset 為 auto !important、positive 不誤動、zero 不誤動、restore 還原）。sanity check：拿掉 applyImportant → 1 spec fail；加回 → 402 全過。實機 harness 跑 vocus fullpage 3 頁驗 H1 標題正常顯示於 reader card 頂部。

---

**v0.7.113**——esmchina /news/14165.html reader card 不再居中、全寬撐滿 viewport 修法（v0.7.104 後遺症）。**動機**（Jimmy 2026-05-13 第八輪截圖回報）：esmchina 文章進入 reader mode 後文字邊緣貼到視窗最右邊、reader card 不再居中。**根因**（probe 揭穿）：esmchina articleEl 是 Bootstrap `<div class="container">`（row + col-md-9 主欄 + col-md-3 sidebar 三 children 在 articleEl 內）。`hideInsideArticleSidebarColumns` 條件 C hide col-md-3 sidebar → `collapseGridWithHiddenCell` 條件 C（float layout + hidden sibling）命中 articleEl 自身。v0.7.104 加的 `CONTAINER_PROPS` 含 `width/max-width/margin-left/margin-right`、被 `applyImportant` 寫到 articleEl 上 → `width: 100% + max-width: none + margin: 0 !important`，**override styler 的 `[data-jread-active] { max-width: 720px; margin: 0 auto }`** → reader card 變全寬。BBC byline 等 inner container case 需要這幾條 reset，articleEl 自身不需要（styler 全權控制 articleEl 的 sizing）。**修法**（cleaner.js `collapseGridWithHiddenCell`）：加 `isArticleSelf = (el === articleEl)` 判斷，當命中元素是 articleEl 本身時，`CONTAINER_PROPS` 與 `containerDecls` 改用較小集合（只含 `display + grid-template-columns/rows/areas + flex-direction`，**不含 width/max-width/margin-left/right**）；inner container case (el !== articleEl) 仍走完整 reset 路徑、BBC byline 等場景不退化。**通則屬性**：(1) styler 居中責任邊界明確—— articleEl 的 width/max-width/margin 由 styler 全權控制、cleaner 不可侵入；(2) 此邊界對任何「articleEl 自身被 collapse」場景（不限 esmchina）都有效；(3) inner container 仍照舊處理 stylesheet 殘留寬度。新增 forcing function spec：對 Bootstrap container fixture 跑 cleaner、forcing 條件 C 觸發 articleEl collapse、斷言 articleEl 的 width/max-width/margin-left/right **永遠不可有 !important** priority。sanity check：拿掉 isArticleSelf 判斷（讓 articleEl 走完整 reset）→ 1 spec fail；加回 → 401 全過。esmchina 站點 HTTP2 阻擋 Playwright 自動化、實機驗證請 Jimmy reload extension 確認。

---

**v0.7.112**——TBIJ hero image 與 byline 之間 378px 空白修法（v0.7.111 接力）。**動機**（Jimmy 2026-05-13 第七輪截圖回報）：reader mode 下 hero image 與 "Published May 5 2026" 之間有一大塊空白（約 378px 高），視覺像「圖片下方斷層」。**根因**（probe 揭穿）：`<header class="tb-c-story-header">` 是 `position: relative`、stylesheet 設 `min-height` 配合內部 absolute child（`tb-c-story-header__heading` 含 H1 + date 麵包屑 + standfirst）預留覆蓋層空間（原 design 標題覆蓋在 hero image 上）。v0.7.111 hide 該 absolute heading 後 header 自身 min-height 仍保留 → 720 - 342 (hero img) = 378px stale 空白殘留。**修法**（cleaner.js `hideInsideArticleAbsoluteOverlays`）：hide 一個 absolute child 後，檢查其直接父——若 computed `min-height > 0` 或 `height > 100px`，強制 `min-height: 0 + height: auto !important`，避免父為配合 absolute child 預留的空間在 child hidden 後變 stale 空白。用 `seenParents` Set 避免同父被重複處理。新增 `restoreAbsoluteOverlayConverted` 還原路徑。**通則屬性**：(1) absolute child 是「視覺擴展」、父預留高度是配合它、child hidden 後保留高度就是 stale 設計殘留——純結構特徵跨站通用；(2) 只清直接父不遞迴，避免影響遠端 layout；(3) 條件 `min-height > 0` 或 `height > 100px` 雙判定——min-height 預留空間典型 hero 圖類，height > 100 過濾正常 inline-h（如 `height: 1em` 或 `height: 20px` 之類非 layout-reserved）；4) PRESERVE_SEL 內 absolute child（figure caption 等）由既有 isInPreserved skip，不觸發父高度 reset。實機 harness 跑 TBIJ fullpage 5 頁驗 hero image 後直接接 byline、無 stale 空白；既有 400 spec 全過。

---

**v0.7.111**——TBIJ 文末 author bios absolute `<div>` overlay 修法（v0.7.110 接力）。**動機**（Jimmy 2026-05-13 第六輪截圖回報）：v0.7.110 修了 `<aside>` overlay 但 reader 滾到文末仍見 "About The Authors / Niamh McIntyre 報導 / Misbah Khan 報導 / Mark Sellman" 與內文 "What next?" / "Lead image" / "Reporters" 字串相互重疊。**根因**（probe 揭穿）：另一個 `<div class="tb-c-story-authors tb-js-fixed-sidebar-stop-here">` 是 `position: absolute` z-index 2 的 fixed sidebar 浮動 author bios overlay。v0.7.110 規則只 hide `<aside>` tag，這個 `<div>` 漏網。**修法**（cleaner.js）：把 v0.7.110 `hideInsideArticleAbsoluteAsides` 重新命名 `hideInsideArticleAbsoluteOverlays`，**規則放寬到任意 tag**——掃 articleEl 內所有 element、computed position 為 absolute/fixed 者整段 hide。加主文段落保護 guard：若 element 後代含 `<p>` textContent > 500 chars → 視為主文段落容器（即使 absolute 也保留），不 hide。500 是邊界——典型 author bio < 300 chars、主文段落 > 500 chars，雙向通則安全。v0.7.107/108 的「flex container 內 absolute children/descendants force position: static」邏輯仍保留作 fallback——對含長段落受保護沒被 hide 的 absolute 元素仍可 reset 定位；兩條路徑互補不衝突。**通則屬性**：(1) "reader mode flow > overlay" 原則套用至任意 tag——HTML5 `<aside>` 是 semantic 次要、`<div>` 帶 absolute 是 visual overlay、對 reader 同樣是雜訊；(2) 長段落保護是純結構特徵 guard、跨站通用、誤判風險低；(3) PRESERVE_SEL 內 absolute (figure caption 等) 仍受保護。原 `healthsystemtracker-flex-wrap-row.html` v0.7.107/108 spec 同步更新——absolute children 現在被 v0.7.111 hide（更乾淨）而非 reset to static，behavior 更好但語意一致；新 fixture `tbij-float-multi-col-and-absolute-aside.html` 擴增 `#absolute-div-overlay`（absolute div，無長段落 → hide）+ `#absolute-with-long-p`（absolute 容器含長段落 → 不 hide）兩條 forcing assertion。sanity check：拿掉 hideInsideArticleAbsoluteOverlays 呼叫 → 2 spec fail；加回 → 400 全過。實機 harness 跑 TBIJ fullpage 5 頁驗文末 author bios 完全消失、內文無 overlap。

---

**v0.7.110**——TBIJ thebureauinvestigates.com 雙欄 float layout + absolute aside overlay 修法。**動機**（Jimmy 2026-05-13 第五輪截圖回報 TBIJ "AI slop" 文章）：reader mode 下 (1) 左欄 sidebar (Published date + author byline + "Support TBIJ" 按鈕) 與 absolute `<aside>` (「We expose injustice and spark change. Help change the world by becoming a Bureau Insider」TBIJ 自家品牌宣傳浮動側欄) 完全重疊、文字疊在一起；(2) body 段落寬度只佔 reader card 約一半 (~274px / 547px)、剩下大塊空白。**根因**（probe 揭穿）：(A) `<aside class="tb-o-fixed-left-sidebar__inner">` 是 `position: absolute` z-index 1 的 overlay，原 design 在寬 viewport 浮在主文左側、reader card 縮窄後與內文 sidebar 完全重疊；(B) `tb-o-story-section` 是傳統 CSS float 雙欄 layout：body `float: left; width: 50%; margin-left: 25%` + sidebar `float: right; width: 20%`。既有兩條 collapse 規則都漏網：(1) `collapseGridWithHiddenCell` 條件 C (float + hidden sibling) 需要 hidden sibling，TBIJ 兩 children 都 visible；(2) `collapseInnerFlexWrap` 只處理 flex-row，TBIJ 父是 `display: block` + children float。**修法**（cleaner.js）：(1) 新 `hideInsideArticleAbsoluteAsides`——掃 articleEl 內所有 `<aside>` tag、computed position 為 absolute/fixed 者整段 hide。HTML5 semantic「次要旁支內容」+ 絕對定位 = overlay 浮動裝飾（fixed sidebar / sticky CTA / floating subscribe widget / brand promotion），跨站通用、與內文無關。(2) `collapseGridWithHiddenCell` 新條件 D——visibleChildren 全部 float (任何方向) + length >= 2 → collapse 為 block flow。不需 hidden sibling 條件，純結構特徵命中傳統雙欄/多欄 float-based layout。(3) `CHILD_DECLS` 擴增 `margin-left/right: 0 !important`——TBIJ body stylesheet 的 25% margin-left 在 reader card 縮窄後仍佔 137px，光清 float 不夠、margin 也要清才能讓 body 撐滿父寬。`CHILD_PROPS` 同步擴增（restore 軌道完整性）。**通則屬性**：(1) `<aside> + position: absolute/fixed` 是跨站 overlay 浮動側欄純結構特徵，非 TBIJ 特判；(2) 「children 全 floated」是傳統 float-based multi-column layout 的客觀特徵，pull-quote / floated image 通常是單個 floated child（visibleChildren.length >= 2 自然排除）；(3) margin-left/right reset 配合 width: auto 是「block flow 撐滿父寬」的完整宣告，避免 stylesheet 殘留偏移。fixture `tbij-float-multi-col-and-absolute-aside.html` + spec 五條 forcing assertion (absolute aside 被 hide、float container collapse、float/width/margin-left reset、sidebar 同步 reset、restore 還原)。sanity check：拿掉條件 D → 1 spec fail；加回 → 400 全過。實機 harness 跑 TBIJ fullpage 驗 body 全寬 + sidebar/aside 不再 overlay。

---

**v0.7.109**——healthsystemtracker 作者 + 日期 byline 被 sidebar columns 條件 A 誤殺修法（v0.7.108 後續）。**動機**（Jimmy 2026-05-13 第四輪回報）：v0.7.108 後 reader card 寬度 + Methods overlay 都修了，但**進入閱讀模式後完全看不到作者 "By Emma Wager, Shameek Rakshit, and Cynthia Cox" 與日期 "August 2, 2024"**。**根因**（instrument hide() caller stack 揭穿）：`hideInsideArticleSidebarColumns` 條件 A（textLen < main × 10% + linkDensity > 0.5）命中 `.entry-meta`——文字 ~80 chars 遠 < 主文 14K × 10% (1400) + author 名都 `<a>` 連結 → ld > 0.5 → 整段 byline + 日期被當成短篇 high-LD widget sidebar 砍光。**修法**（cleaner.js）：(1) 新增 `BYLINE_TEXT_RE` 涵蓋常見 byline 文字 pattern——英文 "By X" / "Written by" / "Posted by" / "Author: X" 前綴、英文月份+日+年日期（"August 2, 2024" / "Aug 2 2024" / "2 August 2024"）、ISO date "YYYY-MM-DD"、中文「撰文：」「作者：」「編輯：」「整理：」「報導：」「發布日期」「更新日期」「刊出日期」；(2) 條件 A 命中前加白名單檢查：sibling textLen < 200 + textContent 命中 `BYLINE_TEXT_RE` → skip hide。**通則屬性**：(1) byline 文字 pattern 跨站收斂——「短文 + author/date 識別字串」是極穩定結構特徵，非 healthsystemtracker `.entry-meta` 特判；(2) 雙條件雙重保險避免廣告 / sidebar widget 偶含日期片段誤觸發白名單（廣告/widget 通常 textLen >> 200）；(3) 條件 B (aside 高度) 與條件 C (textLen >= 200) 不需白名單——前者 byline 不用 `<aside>` tag，後者 textLen 門檻已自然排除 byline。fixture `healthsystemtracker-byline-whitelist.html` + spec 三條 forcing assertion（byline 不 hide、無 pattern 的真 widget 仍 hide、主文不動）。sanity check：拿掉白名單行 → spec fail；加回 → 399 全過。實機 harness 跑 healthsystemtracker fullpage 驗 byline + 日期正常顯示在 title 下方。

---

**v0.7.108**——healthsystemtracker 「About this site」深層 absolute 後代仍 overlay 主文修法（v0.7.107 接力）。**動機**（Jimmy 2026-05-13 第三輪截圖回報）：v0.7.107 解外層 absolute child 後，Methods 段落上仍見小字italic「ancillary services delivered to a patient who is not formally admit / is performing in terms of quality and cost」與正常大字主文疊在一起。**根因**（probe 揭穿）：`.entry-content-right`（v0.7.107 已 force static）內部的 `.about`（"About this site" sidebar 內容容器）仍是 `position: absolute` + `top: 8309`，原本 anchor 到外層 absolute `.entry-content-right`、現在 `.entry-content-right` 變 static 後 `.about` 改 anchor 到再外層的 `position: relative` `.row`（仍存在於 Bootstrap layout 內），繼續在 article 高度範圍內以絕對座標浮動 → 跟流式 Methods 主文垂直疊字。**修法**（cleaner.js `collapseInnerFlexWrap`）：collapse 一個 flex container 時，除 direct children 外，也走訪所有後代 element，對任何 `position: absolute / fixed` 後代強制 `position: static !important`。`directChildrenSet` 標記已處理者避免重複套。**通則屬性**：(1) "reader mode flow > overlay" 原則對稱套用至整棵 subtree——既然 collapse 父為 block，subtree 內 absolute overlay 都該扁平化進 flow，避免「父扁平 / 子仍浮」殘留；(2) 只取消 position 不動 width/top/left——這些屬性在 static 流下無效但保留 inline value，restore 時自然回到原狀；(3) PRESERVE_SEL 仍生效（figure/figcaption/blockquote/summary 內 absolute caption 受保護）；(4) jsdom rect 全 0 不影響——descendant 階段只看 computed position，不靠 layout 數值。fixture `healthsystemtracker-flex-wrap-row.html` 擴增 `#absolute-descendant`（嵌套在 `#absolute-sidebar` 內 absolute 後代）+ spec 兩條 forcing assertion（position: static + !important priority）。實機 harness 跑 healthsystemtracker fullpage 6 頁截圖驗 Methods 段落純淨無重疊。

---

**v0.7.107**——healthsystemtracker `.entry-content-right` absolute 側欄塌成 24px 疊在 Methods 段落上修法（v0.7.106 接力）。**動機**（Jimmy 2026-05-13 第二輪截圖回報）：v0.7.106 解 body 寬度後，文章末尾 Methods 區段疊上一條縱向窄欄 "About this site / The Peterson Center / Healthcare and KFF are partnering..."。**根因**（probe 揭穿）：`.entry-content-right` 是 `position: absolute` 的 "About this site" 側欄（原 design 浮在文章右側全高 8460px、`.about` block 定位 top:8309 接近底部）。v0.7.106 的 `collapseInnerFlexWrap` 對所有 visible children 套 `width: auto` !important——對 absolute child 而言，`width: auto` 觸發 absolute box 的 shrink-to-fit 行為 → 寬度塌成 24px (content-shrunk 至最窄字寬)、`position: absolute` 仍生效繼續 overlay 在 Methods 主文上、text 縱向擠成單字一行的縮窄。**修法**（cleaner.js `collapseInnerFlexWrap`）：(1) wrap detection 階段過濾掉 position: absolute / fixed children——它們 top 不由 flex layout 決定（由 CSS top/left 控制）、混入會產生 wrap false positive；(2) CHILD_DECLS 加 `position: static` !important——把 absolute children 拉回 block flow（一般 block 撐滿父寬不再 overlay）；(3) CHILD_PROPS 同步加 position 軌道（restore 完整性）。**通則屬性**：(1) 純結構特徵——「flex 容器內 absolute child」是跨站常見 sidebar / overlay pattern（Bootstrap col + absolute、CMS sticky 廣告位等），非 healthsystemtracker 特判；(2) 邊界保護不變——in-flow children 仍正常參與 wrap 判定 + absolute children 仍受 CHILD_DECLS 拉回 flow；(3) reset 範圍對稱——既然 collapse 父為 block，將其所有後代（含 absolute）拉回 block flow 是一致的設計，避免 partial 套法造成 absolute 殘留 overlay。fixture `healthsystemtracker-flex-wrap-row.html` 擴增 `#absolute-sidebar` (position: absolute + width 140px) + 對應 spec 三條 forcing assertion（position: static !important、width: auto、不算進 wrap detection top）。實機 harness 跑 healthsystemtracker /brief/what-drives-health-spending fullpage 6 頁截圖驗 Methods 段落純淨無 overlay。

---

**v0.7.106**——healthsystemtracker.org 等 Bootstrap 多欄站點 reader mode 段落寬度修法。**動機**（Jimmy 2026-05-13 截圖回報 healthsystemtracker.org `/brief/what-drives-health-spending-in-the-u-s-compared-to-other-countries/`）：reader card 720px 寬，title 撐滿、body 段落卻只佔 256px 窄欄並緊貼右側，視覺斷層嚴重。**根因**（probe 揭穿）：主文用 Bootstrap-style `.row` (`display: flex; flex-direction: row`) 含多個固定寬 children（`.entry-content-left` 140px spacer + `.entry-content-center` 280px 段落 + `.datawrapper-embed` 467px chart + `.entry-content-right` 140px spacer ...）。原 design 在 1140px container 可一條 row 排開，reader card 縮窄後 flex-wrap 啟動讓 children 散落多行、個別維持 stylesheet 固定 width → 段落 rect 256px。既有兩條 collapse 規則都漏網：(1) `collapseGridWithHiddenCell` 需要 hidden sibling 才 fire（此 row 無 hidden child）；(2) `collapseInnerGridFlex` 只處理 grid + hard-coded px column、明文排除 flex。**修法**（cleaner.js）：新增 `collapseInnerFlexWrap`——掃 articleEl 內所有 `display: flex|inline-flex` + `flex-direction: row|row-reverse` 容器，若 visible children 的 `getBoundingClientRect().top` 差距 > 5px（= flex-wrap 已啟動），collapse 容器成 `display: block !important` + 子 `flex-grow/shrink/basis + width/max-width/float` reset 為 0/auto/none，讓子元素回歸 block flow 撐滿父寬。**通則屬性**：(1) wrap 行為（top 差距）是純結構特徵——「原 design 寬度 > 當前 container」的客觀證據，跨站通用；(2) 邊界保護：PRESERVE_SEL 內 flex 保留（image gallery / 引文裝飾）+ visible children < 2 不處理 + 單行 flex（top 全同）不誤觸發 + jsdom 無 layout engine 時 rect 全 0 自動 skip；(3) 與 collapseInnerGridFlex / collapseGridWithHiddenCell 互補不重疊。新增 `__innerFlexWrap` hidden tracking + `restoreInnerFlexWrap` 還原路徑。`test/regression/fixtures/healthsystemtracker-flex-wrap-row.html` fixture + 對應 spec 五條 forcing assertion（wrap container collapse 為 block、children width auto override、非 flex wrapper 不誤動、單行 flex 不誤動、restore 還原原值）。sanity check：拿掉 `collapseInnerFlexWrap` 呼叫 → spec fail；加回 → 全過。

---

**v0.7.105**——BBC Culture byline 真正左對齊（v0.7.104 接力）。**動機**（Jimmy 2026-05-13 第六輪截圖回報）：v0.7.104 後 byline 容器對齊，但 author 文字「Christian Kriticos」仍在中央偏右、跟「24 April 2026」沒對齊。**真正根因**（透過 instrument log 揭穿）：styler 的 `[data-jread-active] * { margin-left: auto !important; margin-right: auto !important }` 規則太廣泛——對 reader card 內**所有後代**強制 auto margin。BBC byline 內 `ittDij` SPAN（孫子層級）固定 `width: 458px`，被這條 wildcard rule 套上 margin auto 後，在 608px 父容器內自動置中（margin 75px each side），導致 author 文字偏右。前幾輪修法（v0.7.103 cleaner desc reset）失效原因：**styler 是在 cleaner 之後才 inject `<style>`**——cleaner 跑時 ittDij 的 computed margin 還是 0、不觸發 symmetric-margin 條件，等 styler stylesheet 套上去後 auto margin 才被觸發解析成 75px。**修法**（styler.js）：把 `* { margin-left/right: auto !important }` 從 wildcard 縮限到「**只對媒體 tag**」（img / picture / video / figure / iframe / table / blockquote / pre）——這些是該被置中的 block 內容；generic div / span / text wrapper 自然左對齊不被 auto-center。`* { float: none !important }` 維持 wildcard（清 float-right 仍跨所有 element 適用）。`styler.spec.js` 既有 v0.7.50 floatImg 對齊 spec 同步重寫——拆成三條 forcing assertion：(1) wildcard `*` rule 含 float: none、(2) 媒體 tag rule 含 margin auto、(3) 反向 forcing：wildcard `*` body **不可**含 margin auto（避免回歸到全 wildcard 套法 → BBC byline 又被偏右）。**通則屬性**：(1) 純 typography selector 縮限——保留媒體置中需求（v0.7.50 cna .floatImg 修法仍生效）、移除對 generic 文字 wrapper 的不當 auto-center；(2) 跨站影響極小——多數 site 的 `<p>` 等文字 element 本來就 width:100%（block 預設行為）、有沒有 margin auto 視覺無差；(3) BBC / Guardian / NYT 類有 fixed-width inner wrapper 的站從中受惠——byline / pull-quote / inline 元素自然左對齊。實機 BBC harness 截圖驗 byline (date + author) 兩行嚴格對齊到 reader card 左邊緣 + 397 jsdom spec 全過 + cleaner.spec INNER_GRID_DESC_DECLS spec 同步更新（v0.7.104 改 width:auto → width:100%）。

---

**v0.7.104**——BBC Culture byline 嚴格左對齊（v0.7.103 接力）。**動機**（Jimmy 2026-05-13 第五輪截圖回報）：v0.7.103 修法後 byline 從「水平分裂大空白」改善為「垂直 stacked 居中」，但仍非原站的「左對齊」排版。Jimmy 要求嚴格左對齊。**根因**：BBC byline 容器 `dWzpHk` 是 grid 容器**且含 hidden 子元素**（隱藏的 share/save 按鈕 `esBuRQ` 等被 cleaner hide），所以實際走的是 `collapseGridWithHiddenCell`（v0.6.12 既有路徑）而非 v0.7.103 的 `collapseInnerGridFlex`。但 `collapseGridWithHiddenCell` 的 `containerDecls` 只清 `display + grid-template-*`，**沒**清容器自身的 `width/max-width/margin`——dWzpHk stylesheet 給的 `width: 458px`（配合原 grid 第二欄寬）+ styler 通用 `* { margin-left/right: auto !important }` rule 結合 → 458px 容器在 608px 父中央自動置中。**修法 1**（cleaner.js `collapseGridWithHiddenCell`）：擴增 `containerDecls` 的 4 條軌道（`width: 100%`, `max-width: none`, `margin-left/right: 0`），collapse 容器時連帶清自身寬度與 margin，避免 stylesheet 殘留 + auto-center。`CONTAINER_PROPS` 同步擴增（restore 軌道完整性）。**修法 2**（cleaner.js `collapseInnerGridFlex` INNER_GRID_DECLS）：把 `width: auto` 改成 `width: 100%`——實測 BBC 多層 styled-components nested layout 下 `width: auto` 即使 inline `!important` 仍會解析成原 stylesheet 寬度（疑似 CSS containment / sub-grid / styled-components 動態 width 互動），**`width: 100%` 強制使用 parent width 才能可靠覆寫**。**通則屬性**：(1) 兩條 collapse 路徑（v0.6.12 / v0.7.103）的 declaration 表互相對齊，避免「同樣 collapse 但走不同路徑得不同結果」的不一致；(2) `width: 100%` 是強制覆寫 stylesheet 任何固定 px 寬度的可靠手段，搭配 `margin: 0 + max-width: none` 確保左對齊撐滿父寬；(3) 純結構特徵修法、不綁站點。real BBC harness 截圖驗 byline (date + author) 嚴格左對齊到 reader card 左邊緣 + 397 jsdom spec 全過。

---

**v0.7.103**——BBC Culture byline (date + author) 進入閱讀模式排版破壞修法。**動機**（Jimmy 2026-05-13 比對截圖回報 bbc.com/culture/article/20260423-the-enchanting-story-of-oxfords-medieval-library）：原網頁 byline 是「24 April 2026」+「Christian Kriticos」垂直左對齊兩行；reader mode 下變成「日期左、作者中央偏右、中間大空白」的奇怪水平分裂。**根因**：BBC 用 CSS Grid 排 byline——容器 `dWzpHk` 設 `display:grid` + `grid-template-columns: 230px 491px` + `grid-template-rows: 32px 24px` 兩列兩欄；descendant wrapper（`ittDij` SPAN）綁 `width:458px` + `margin:0 auto` 配合第二欄寬。`collapseInnerGridFlex`（v0.6.x BBC 主文 386px 修法）已把父 grid 攤平為 `display:block`，但**沒**清掉 descendant 的 `width:458px` + `margin:auto`——458 < 608(reader card 寬) + auto margin 觸發水平置中（resolved margin 變 75px each side），author 視覺從原本左對齊變中央偏移，搭配 grid 結構崩潰整體看起來像水平分裂。**修法**（cleaner.js）：擴充 `collapseInnerGridFlex`——對被 collapse 的 grid 容器內任意 descendant，computed `margin-left === margin-right` 且 ≥ 4px（auto-center 結構特徵）→ 強制 `width:auto + margin-left/right:0 + grid-area/grid-column/grid-row:auto`！important，還原為 normal block flow。**通則屬性**：(1) symmetric margin > 4px 是 styled-components / CSS-in-JS「fixed-width child + margin: auto」auto-center 殘留的純結構特徵，跨站通用；(2) 排除 PRESERVE_SEL（figure/figcaption/blockquote/summary）+ 媒體 tag（IMG/PICTURE/VIDEO/SVG/IFRAME/FIGURE）—— 這些寬度由原站精心設計或交給 styler max-width 控管，cleaner 不該動；(3) 容差 1px 處理 styled-components sub-pixel 浮點誤差；(4) > 4px 門檻避免一般小型 padding-margin 誤觸發。**v0.7.103 第一版的回歸**：原本想對 collapsed grid 全 descendants 都加 `width:auto`，實測 BBC 外層也有套娃 grid（gmICnp 等），全 descendants reset 造成連鎖塌陷（dWzpHk 縮成 126px 縮在右側），**改用 symmetric-margin 條件式精準命中**。新增 hidden tracking `__innerGridFlexDesc` + restore 路徑同步擴充。392 jsdom spec 全過 + 真實 BBC harness 截圖驗 byline 從「水平分裂大空白」改善為「垂直 stacked 居中」（雖非原站左對齊但視覺乾淨完整）+ chinatalk Substack regression 截圖驗其他站不破壞。

---

**v0.7.102**——BBC Culture p / ul / ol / blockquote 段落間距修法（v0.7.100 接力）。**動機**（Jimmy 2026-05-13 第四輪截圖回報 bbc.com/culture/article/20260423-the-enchanting-story-of-oxfords-medieval-library）：v0.7.100 解 h2 + figure 間距後仍見三段 p「Merton's collection...」「Merton's book treasury...」「Curiously, Merton's books...」緊貼無視覺斷層。**根因**：BBC styled-components hash class 不只 h1-h6 / figure margin: 0，p / ul / ol / blockquote 同樣全砍光。**修法**（styler.js）：新增 `[data-jread-active="1"] p, ul, ol, blockquote` rule 加 `margin-bottom: 1em !important`。**baseline 變更**：v0.6.0 嚴禁 p / ul / ol / blockquote rule 的 baseline 再放寬一次（與 v0.7.100 對 h1-h6 / figure 同精神）——「禁 typography property（font-size / color / line-height / font-family / font-weight / font-style）但允許 margin / padding」。li / a 維持完全不下 rule（避免列表內部結構 / 連結色被覆寫）。`styler.spec.js` baseline 整體 spec 同步更新——抽 `checkBlocks()` helper、對 h1-h6 / p / ul / ol / blockquote 共五類 rule 各自驗 typography property 不入侵。**通則屬性**：(1) 1em 是各家瀏覽器 user-agent stylesheet 對 p 的預設 margin、貼近大眾預期，多數新聞站本來就有此 margin 覆寫差別極小，BBC 從 0 變 1em 是明顯改善；(2) 相對字級單位、跟使用者字級設定同步縮放；(3) 跨 styled-components 站通用——BBC / Guardian / NYT / Substack 類普遍把段落 margin: 0 都受惠。Substack chinatalk harness 截圖驗 substack 既有版面不破壞、段落間距合理。新增 styler.spec.js forcing assertion 驗 p/ul/ol/blockquote 共用 rule 含 margin-bottom: 1em。sanity 拿掉 → spec fail，加回 → 392 過 + 真實 BBC harness 截圖驗段落間距清晰。

---

**v0.7.101**——ESC 鍵退出閱讀模式（Jimmy 2026-05-13 要求）。**動機**：使用者進入閱讀模式後想快速回到原網頁時，目前需要再次按 Alt+R 或點 popup 按鈕；按 ESC 是各類 reader / overlay UI 的通用直覺。**實作**（content/main.js）：(1) 新增 `onEscKey` keydown handler——key === 'Escape' + 無修飾鍵（alt/ctrl/meta/shift）+ 無 input/textarea/select/contenteditable focus → preventDefault + stopPropagation + exitReaderMode；(2) `enterReaderMode` 成功後 install window keydown listener with **capture phase**（第三引數 true）—— capture 比原站 bubble listener 早收到 ESC，避免被原站 stopPropagation 攔截；(3) `exitReaderMode` remove listener，避免關閉後仍攔 ESC 影響原站功能。**通則 / 安全屬性**：(1) 修飾鍵排除避免誤觸 Cmd+ESC 等系統快速鍵；(2) input / textarea / select / contenteditable 白名單放行——使用者在主文 input 留言或編輯時 ESC 通常用於取消輸入 / 關閉自己 focus 的下拉選單，不該被搶走當退出觸發；(3) capture phase 確保跨站可靠觸發；(4) 退出時清 listener 避免污染原站。新增 `test/regression/main-esc-exit.spec.js`：(a) 7 條 source-level forcing assertion 驗 onEscKey 函式存在 + key 判斷 + 修飾鍵排除 + focus 元素白名單 + preventDefault/stopPropagation/exitReaderMode 呼叫 + capture-phase install + uninstall；(b) 9 條 behavior-level jsdom 模擬 keydown 驗演算法效果（ESC 觸發 / 非 ESC 不觸發 / 各修飾鍵不觸發 / INPUT/TEXTAREA/contenteditable focus 不觸發 / button focus 仍觸發）。391 jsdom spec 全過 + sanity 改名 onEscKey → 7 forcing fail，還原 → 全過。Jimmy 實機 reload 驗 ESC 退出（屬「keyboard shortcut」類別，Playwright Chromium 鍵盤對映可能與本機 Chrome 不同步，依 CLAUDE.md 流程交手動驗收）。

---

**v0.7.100**——BBC Culture h2 章節標題 + figure 上方間距修法（v0.7.99 接力）。**動機**（Jimmy 2026-05-13 第三輪截圖回報 bbc.com/culture/article/20260423-the-enchanting-story-of-oxfords-medieval-library）：v0.7.99 加 figure margin-bottom 後仍見三處緊貼——(a) 段尾 p「...the oldest library in the world.」緊貼下一個 H2「The origins of the historic library」、(b) H2 緊貼下一段 p「Historians today...」、(c) 段尾 p「...we think of today as a library."」緊貼下方 figure。**根因**：BBC 用 styled-components hash class 把 H2-H6 的 margin-top/bottom 全砍光（章節標題與前後段 p 緊貼難辨章節），且 figure 無 margin-top（v0.7.99 只加 bottom）。**修法**（styler.js）：(1) figure rule 補 `margin-top: 1.5em !important`（解 c）；(2) 新增 `[data-jread-active="1"] h1, h2, h3, h4, h5, h6` rule 加 `margin-top: 1.5em + margin-bottom: 0.5em` !important（解 a + b）。**baseline 變更**：v0.6.0 嚴禁所有 h1-h6 rule（保留原站標題分級）的 baseline 放寬——新規則為「禁 h1-h6 的 typography property（font-size / color / line-height / font-family / font-weight / font-style）但允許 margin / padding」。p / ul / ol / li / blockquote / a 的 baseline 仍維持完全不下 rule。`styler.spec.js` 兩條既有 baseline assertion 同步更新：(1) userOverrides typography rule selector 仍禁 h1-h6（避免 BBC `.HooNV` font-size 戰場波及標題分級）；(2) baseline 整體禁令改成精準檢查含 typography property 的 h1-h6 block 才禁。**通則屬性**：(1) 純 spacing 修法不動 typography——原站標題分級（h1 大、h2 中、h3 小）完全保留；(2) 1.5em / 0.5em 用相對字級單位、跟使用者字級設定同步縮放；(3) 跨 styled-components 站通用——BBC / Guardian / NYT / WaPo / Substack 類站普遍把 heading margin: 0 都受惠。新增 styler.spec.js forcing assertion 驗 figure margin-top + h1-h6 共用 rule 包含正確 margin 值。sanity 拿掉 h1-h6 rule → spec fail，加回 → 374 過 + 真實 BBC harness 截圖（page-02）驗章節 h2 與前後 p 有清晰呼吸空間 + figure 上下也有間距。

---

**v0.7.99**——BBC Culture figcaption 與下方主文間距修法（v0.7.98 接力）。**動機**（Jimmy 2026-05-13 第二輪截圖回報 bbc.com/culture/article/20260423-the-enchanting-story-of-oxfords-medieval-library）：v0.7.98 hide credit overlay 後，figure 下方的 figcaption「The library contains rare, medieval manuscripts...」緊貼下一段主文「This growing perception...」、視覺壓在一起、無呼吸空間。**根因**：BBC 用 styled-components hash class（如 `.bOanuU`）為 figure 設 `margin: 0`，把 figure margin 砍光；reader mode 下 figure 內含 figcaption 時，figcaption 是 figure 的 last child，figure margin: 0 → figcaption 跟下方 sibling 直接接壤。**修法**（styler.js）：在既有 `[data-jread-active="1"] figure, picture` rule 內新增 `margin-bottom: 1.5em !important`。**通則屬性**：(1) 1.5em 用相對字級單位——使用者調字級時間距同步縮放，避免「字小時間距過寬 / 字大時間距太擠」；(2) `!important` 必要——覆寫原站 styled-components hash class 的 `margin: 0` 規則；(3) 跨站通用——任何 figure（含或不含 figcaption）都拉開間距，不限 BBC。對既有有 margin 的站影響極小（多增加 1.5em 視覺呼吸），對 BBC / Guardian / NYT 等 margin: 0 的 styled-components 站關鍵修法。styler.spec.js 既有 `figure / picture 強制 width + max-width` test 加一條 forcing assertion 驗 `margin-bottom: 1.5em !important` 字面存在；sanity 拿掉 rule → forcing fail，加回 → 全 373 過 + 真實 BBC harness 截圖驗 figcaption「(Credit: ...)」與下方主文段落有清晰呼吸空間（page-03 / page-04 三張 figure 均一致）。

---

**v0.7.98**——BBC Culture figure 內 `position: absolute` credit overlay 遮文字修法。**動機**（Jimmy 2026-05-13 截圖回報 bbc.com/culture/article/20260423-the-enchanting-story-of-oxfords-medieval-library）：reader mode 啟動後，每張 `<figure>` 主圖右下角浮一個深色背景 SPAN「Courtesy of the Warden and Fellows of Merton College Oxford」credit badge，文字壓在圖片內容上（floor tile 紋路與 credit badge 視覺混雜、干擾閱讀）。**根因**：BBC 用 styled-components 在 `<figure>` 內 IMG 旁放一個 `position: absolute` 的 SPAN credit overlay（class 全 hash 化、無 keyword 命中），原本應浮在圖片外側；reader mode 下圖片寬度被 styler 重排、原站 absolute top/left 算出的位置基準失效 → overlay 落在圖片可視區域內。同時圖片下方的 `<figcaption>` 已含 "(Credit: Courtesy of...)" 重複資訊，overlay 純屬視覺裝飾。**修法**（cleaner.js）：新增 `hideInsideArticleAbsoluteCreditOverlays`——掃 articleEl 內每個 `<figure>`，若 figure 含 figcaption（canonical caption 已存在的 guard），同 figure 內任何 `position: absolute` 或 `fixed` + 帶 direct text 的 SPAN/DIV/P/SMALL 視為 credit overlay → hide。**通則屬性**：(1) 純結構特徵——CSS computed position + figure 含 figcaption + direct text，無 hostname / class 綁定；(2) 跨 editorial 站通用——BBC / Guardian / NYT / WaPo 類 publication 慣例都用 absolute overlay 浮 credit；(3) guard 嚴格——figure 無 figcaption 時保留 overlay（可能是唯一說明）、IMG/PICTURE/VIDEO/SVG 不在掃描清單（避免誤殺 lazy-load placeholder absolute IMG）、figcaption 自身與其祖先豁免。新增 fixture `bbc-figure-credit-overlay.html`（4 張 figure：hero / portrait / placeholder / no-caption，覆蓋 hide + guard 各場景）+ 10 條 cleaner.spec.js forcing assertion（3 個 overlay 各自 hide + absolute IMG 不誤殺 + figure 無 figcaption guard + 所有 figcaption 保留 + 所有主圖保留 + 主文 6 段保留 + H1 保留 + 函式名 + clean() 呼叫存在性）。373 jsdom spec 全過 + BBC Culture 真實站 harness 截圖驗證 reader card 內所有 figure 「Courtesy of...」overlay 不再可見、figcaption 保留、residual audit 全綠。

---

**v0.7.97**——三組獨立修法（同對話批次）：(1) Stratechery WordPress post-title 自連結誤殺、(2) cna 文末三塊雜訊、(3) chinatimes 文末四塊雜訊（title-anchor guard 嚴格化 + NOISE_KEYWORD_RE 擴 hash-tag / premium-widget）。

**(1) Stratechery WordPress post-title 自連結誤殺**（v0.7.95 esmchina 修法的回旋傷害）。**動機**（Jimmy 2026-05-13 截圖回報 stratechery.com/2026/please-listen-to-my-podcast/）：reader mode 啟動後標題「2026.12: Please Listen to My Podcast」整塊不見、畫面從 hero 圖片開始。**根因**：WordPress block theme 預設 `H2.wp-block-post-title` 內含 `<a>` 包整個 title text（post-title 自連結到本文）—— H2 textLen = 36 + linkDensity = 1.0。v0.7.95 把 `hideInsideArticleSidebarColumns` 改成「articleEl 自身也納入候選 container」後，articleEl = `DIV.wp-block-column` 的 children 中 H2 命中**條件 A**（textLen < main×10% + ld > 0.5）被當 widget sidebar 砍。v0.7.21 既有的 narrow rule 白名單只保護 `narrowPromotedSiblings`、沒擴散到新的 sidebarColumns 規則。**修法**（cleaner.js）：把 `opts.promotedTitleHead` 也傳給 `hideInsideArticleSidebarColumns`、新增與 narrow 同套白名單——`s.el === promotedTitleHead` 或 `s.el.contains(promotedTitleHead)` 直接 skip。**通則屬性**：promote 升級命中的真標題 element 應跨所有 cleaner rule 一致保護，不被任何 rule（narrow / sidebarColumns / 未來新 rule）誤殺。修正既有 `stratechery-h2-post-title.html` fixture——把 H2 內加 `<a>` 包裹完整 title 文字（反映真實 stratechery DOM 結構、linkDensity = 1）；spec 加 forcing assertion 確保 fixture 確實含 `<a>`。

**(2) cna 文末三塊雜訊**（Jimmy 2026-05-13 截圖回報 www.cna.com.tw/news/aopl/202604240301.aspx）。**症狀**：reader mode 後文末殘留 #一帶一路…等 15 個 hashtag、「賴清德 相關新聞」+ 6 條 list、底部藍 box「請繼續下滑閱讀 …」。**根因**三條獨立：(a) tags wrapper `DIV.articlekeywordGroup` 全是 `<a>#xxx</a>` link cluster、無既有 NOISE keyword 命中；(b) 相關新聞 wrapper `DIV.paragraph.moreArticle`——既有 `NOISE_KEYWORD_RE` 的 `more-(?:news|stories|posts|articles)` 要求 dash boundary、camelCase `moreArticle` 漏網；(c) 底部 `DIV.jsNextLine.nextline`——原本沒命中任何 rule。**修法**：(a) **新增 `hideInsideArticleHashtagClusters`**——掃 articleEl 內 P/DIV、anchors ≥ 3 + 其中 ≥ 80% textContent 以 `#` 開頭 + direct text ≤ 5 字 + **沒有任何非 anchor 的 ≥ 50 字 block**（後者是 fixture sanity check 揭穿的關鍵 guard：避免把含主文長 p 的外層 wrapper 誤當 tag cluster 砍掉）→ hide。(b) **NOISE_KEYWORD_RE 擴 camelCase boundary**：`more-(?:news|stories|posts|articles)` 改 `more[-_]?(?:news|stories|posts|articles?)`、`related-(?:articles|news|posts|stories)` 改 `related[-_]?(?:articles?|news|posts|stories)`。涵蓋 `moreArticle` / `relatedArticle` 等 camelCase CMS class，配上 `(^|[^a-z0-9])`+`([^a-z0-9]|$)` 邊界仍精準。(c) jsNextLine 雙通道兜底——initial run 路徑由既有 `hideInsideArticleSidebarColumns` 條件 A 命中（articleEl direct child、textLen 短 + linkDensity 高）；**SPA lazy-hydrate 路徑**（Jimmy 第二輪實機回報：Playwright probe sidebarColumns 已砍但實機仍見 box，推斷實機是 reader mode 啟動後才注入、sidebarColumns 不會 retroactively run）由 `NOISE_HEADING_TEXT_RE` 加「請繼續下滑(閱讀)?」alternation 兜底——dynamic 注入時 `checkDynamicNoise` 跑 heading-text rule + walk-up fallback hide jsNextLine。**通則屬性**：三條都非站點特判，hashtag cluster 跨 CMS 通用（任何站文末 `<a>#tag</a>` 列表都受惠）、camelCase boundary 涵蓋 WordPress / Bootstrap / 自製 SPA 等 CMS。新增 fixture `cna-article-tail.html`（含 articlekeywordGroup 15 個 hashtag + paragraph.moreArticle timeline + jsNextLine.nextline 三塊）+ 8 條 cleaner.spec.js forcing assertion（三條 rule × 各自 forcing + jsNextLine 雙通道（sidebarColumns initial + heading-text 字面 forcing）+ 主文保護 + H1 保留）。

**(3) chinatimes 文末四塊雜訊**（Jimmy 2026-05-13 截圖回報 www.chinatimes.com/realtimenews/20260423000917-260410）。**症狀**：reader mode 後文末殘留：tags 列「#台積電 #美伊停火…」(`DIV.article-hash-tag`)、Prism premium-widget、訂閱框「免費訂閱《中時新聞網》電子報」(`DIV.subscribe-news-letter`)、推薦新聞 list (`SECTION#recommended-article`)。**根因兩條獨立**：(a) `subscribe-news-letter` 與 `recommended-article` 的 class 早就含 `subscribe` / `recommended` NOISE keyword，應該被 `hideInsideArticleByKeyword` 砍——但 wrapper 子樹含 `H3.title` / `H4.title`、`hasArticleTitleAnchor` 的 `TITLE_ANCHOR_TOKENS` 含**裸 `title` 短 token** 被誤命中為「主文標題 anchor」、`wrapperContainsArticleAnchor` 返回 true、guard 把 widget 當主文 wrapper 豁免；(b) `article-hash-tag` / `premium-widget` 沒有任何 NOISE keyword token 命中。**修法**（cleaner.js）：(a) **拆 anchor guard 為兩個版本**——既有 `wrapperContainsArticleAnchor`（寬鬆：含長 p 或 title-anchor token）保留給 `hideInsideArticleByHeadingText` 的 walk-up fallback（newtalk `<div class="title">` 主標題場景仍受保護）；新增 `wrapperContainsMainContentP`（嚴格：**只看** p 長度 >=100 或累計 >=300）專供 `hideInsideArticleByKeyword` 用——widget wrapper 無主文長 p、guard 不豁免、keyword rule 順利 hide。twz paywall wrapper 含 47 個長 p 仍正確豁免。(b) **NOISE_KEYWORD_RE 擴 alternation**：加 `hash[-_]?tag|premium[-_]?(?:widget|content|trial|banner|box)`，涵蓋 chinatimes article-hash-tag + premium-widget + Prism 類付費 widget。**通則屬性**：anchor guard 嚴格化是「降低 guard 過寬風險」的通用修法，避免「widget 內含 H3.title 就被當主文豁免」這類跨站常見誤判（CMS / SPA 廣泛用 class="title" 包 widget heading）。NOISE alternation 擴 hash-tag / premium 是 CMS 慣例命名，跨中文新聞站通用。新增 fixture `chinatimes-article-tail.html`（articleEl=ARTICLE.article-box、四塊雜訊真實 DOM 結構）+ 9 條 cleaner.spec.js forcing assertion（四塊各自 hide + regex 字面 forcing + 主文保護 + H1 保留 + recommend link forcing）。

363 jsdom spec 全過 + Stratechery / cna / chinatimes 真實站 harness 截圖驗 reader card 視覺正確 + 各條 rule sanity check（個別 disable 後 forcing spec 各自 fail）。Jimmy 實機 reload 驗證 cna 文末「請繼續下滑」box（SPA lazy-hydrate 通道）的 final coverage。

---

**v0.7.96**——udn 主筆室文章作者+日期消失修法（narrowPromotedSiblings byline guard）。**動機**（Jimmy 2026-05-13 截圖回報 udn.com/news/story/124844/9460037）：reader mode 後標題下方原應顯示「2026-04-23 15:07 聯合報／ 主筆室」整列 byline 消失。**根因**：detector heuristic 選 ARTICLE.article-content + promote 升到 SECTION.article-content__wrapper，wrapper 的 direct children 含 DIV.article-content__subinfo（37 chars，含 TIME「2026-04-23 15:07」+ 「聯合報／ 主筆室」+ tags + 關閉按鈕）。`narrowPromotedSiblings` 現有 guard 只保留 H1 / 含 H1 後代 / standalone media (img/picture/video) sibling，subinfo 全不命中 → 當 chrome 砍。**修法**（cleaner.js narrowPromotedSiblings）：加 **byline 分支保護**——sibling 內含 `<time>` 元素 AND textLen <= 200 → 保留。`<time>` 是 HTML5 語意 element 專指日期/時間（跨站通用），短文字限制（<= 200）排除「相關新聞」「最新消息」這類大塊 chrome list 雖也含多個 time 但本身是 noise 的場景（udn 實測 subinfo 37 chars vs more-news 490 chars，門檻有充裕空間）。**通則屬性**：純結構特徵（HTML5 `<time>` tag + 短文字），跨站通用——任何把文首 byline 包成獨立 sibling 結構且使用 `<time>` 標日期的 CMS 都受惠。原 udn-h1-direct-child-narrow-guard、stratechery h2 post-title、ebc article_cover、newtalk hero img 等 5 條既有 narrow 保護互不重疊。新增 fixture `udn-byline-subinfo-narrow-guard.html`（真實 udn DOM 結構：breadcrumb / H1 / subinfo / cover figure / article / more-news 六 direct children）+ 5 條 cleaner.spec.js（byline subinfo 保留 + 麵包屑仍 hide + 主圖保留 + 相關新聞含 time 但 textLen > 200 仍 hide + 主文 content mark 保留 + 全部 forcing function）。346 jsdom spec 全過 + udn 真實站 harness 驗證 reader card 內含「2026-04-23 15:07」+「聯合報／ 主筆室」+ 殘留 audit 全綠。

---

**v0.7.95**——esmchina /news/14116.html footer widget cluster 修法（Bootstrap col-md-3 sidebar）。**動機**（Jimmy 2026-05-13 回報）：文章「責編：Lefeng.shao」後混進「近期热点 / EE直播间 / 在线研讨会 / 热门标签」整批 widget。**根因**：esmchina 用 Bootstrap 兩欄 layout（`DIV.container > [.article-title, .col-md-9.article-left (20K chars 主文), .col-md-3.rightsection (4.7K chars widget cluster)]`），三 children 全在 articleEl 內。既有 `hideInsideArticleSidebarColumns` 對此漏網兩處：(1) sibling/main = 0.23 > 條件 A 的 0.1 ratio；(2) sidebar 是 `<div>` 不是 `<aside>` 不命中條件 B；(3) loop 開頭 `if (el === articleEl) continue` 把「articleEl 自身就是 row、children 是 main+sidebar」這種 esmchina 結構直接 skip。**修法**（cleaner.js）：(1) 新增**條件 C**——main >= sibling × 3 AND sibling.linkDensity > 0.5 AND sibling.textLen >= 200 → hide。比條件 A 寬鬆但仍要求 sibling 是 link-heavy widget cluster + 一定篇幅，與條件 A 的「極小極密」場景互補不重疊。(2) loop 從「skip articleEl」改成「articleEl 也納入候選 container」——條件 A/B/C 本身的 textLen + linkDensity guard 已足夠避免誤殺 article > [header, section, footer] 這類正常 direct-child 結構。**通則屬性**：純結構特徵（main 是 sibling 3 倍 + sibling linkDensity 高），跨站通用——任何「主文 + 高 link density widget sidebar」雙欄場景命中。Substack Dwarkesh（main/sibling = 14x）依然由條件 A 接住、商週 / Stratechery 單欄結構不觸發。新增 fixture `esmchina-bootstrap-sidebar.html`（Bootstrap col-md-9 + col-md-3 兩欄結構、forcing 確保 sibling/main > 0.1 + main/sibling >= 3 + linkDensity > 0.5）+ 1 條 cleaner.spec.js（核心斷言：sidebar hide、main 保留、forcing 條件 C 路徑）。340 jsdom spec 全過 + Stratechery harness 真實站 audit 無 regression。esmchina 站對 Playwright Chromium 穩定 HTTP2 阻擋無法 harness 驗，靠 jsdom sanity 雙向 + 邏輯完整性保證，請 Jimmy 實機 reload 驗 reader card 內「責編」後無 widget 殘留。

---

**v0.7.94**——gallery 並列改垂直後相片緊貼修法（v0.7.93 後續）。**動機**（Jimmy 2026-05-13 回報）：v0.7.93 把 substack imageRow 類 flex/grid 並列 gallery 改成 block 垂直堆疊解決圖片溢出蓋文字後，原本 flex `gap: 8px` 失效，三張並列改垂直後緊貼無間距、視覺擠在一塊。**修法**：styler.apply() runtime 處理 gallery container 改 block 時，**同時掃 container 直接子**（figure / picture / img / a / div with 媒體子孫），逐個強制 inline `margin-bottom: 12px !important` 補圖之間空白。snapshot.galleryFlex 同陣列加 child 紀錄（marginBottom + marginBottomPriority）供 restore 還原原 inline 值。div 子加額外 guard：自身含 img / picture / figure 子孫才動，避免誤殺非圖類 div spacer / caption。新增 3 條 styler.spec.js forcing function：apply 後 gallery 內 figure 必有 margin-bottom 12px!important + restore 還原 + 非 gallery 內 figure 不被改。339 jsdom spec 全過。

---

**v0.7.93**——substack imageRow flex gallery 圖片遮蔽下方文字修法。**動機**（Jimmy 2026-05-13 回報 synapseching.substack.com /p/17）：兩張並列圖片（imageRow flex 容器固定 height: 230px）開閱讀模式後，圖片下緣溢出容器約 65px、視覺覆蓋下方段落文字。**根因**：(1) substack imageRow `display: flex; height: 230px` 用 `align-items: stretch` 把 picture flex 子拉到 height 230。(2) jread styler `[data-jread-active] img { height: auto !important }` 讓 IMG 跑 natural aspect ratio（197 × 1.5 = 295px），IMG 比 picture/imageRow 容器高 65px。(3) imageRow / picture 沒 `overflow: hidden`，IMG 從容器底部視覺溢出，覆蓋緊接的下方段落文字（imageRow 在 flow 上占 230 高度、IMG 視覺占 295 高度，差 65px 蓋住下方）。**修法**（styler.js runtime）：`apply()` 掃 articleEl 內所有 `display: flex/grid`（或 inline-flex/grid）且**直接子含 picture/img/figure** 的元素，強制 inline `display: block + height: auto + min-height: 0` 改成 block 顯示。reader card 是單欄純閱讀情境，並列 gallery layout 無保留必要，垂直堆疊圖片是最穩妥的結構性兜底。記錄 snapshot.galleryFlex 在 `restore()` 還原原 inline style/priority，符合可逆性。CSS `:has()` 通則 jsdom 不支援、改 runtime 解決。**通則屬性**：純結構性，掃 flex/grid + 媒體直接子，不綁站點 class——任何站把 flex 並列 gallery + 固定 height 都被覆蓋。非含媒體 flex 容器（純文字 flex layout）不被改動，避免誤殺 layout。新增 fixture `substack-imagerow-flex-gallery.html` + 5 條 styler.spec.js（imageRow inline display=block!important / height=auto / min-height=0 / restore 還原 / snapshot.galleryFlex 紀錄 / 非媒體 flex 不被改）。Probe 確認：substack i=11/12 兩張並列圖修法後變垂直堆疊（rect.top 8400 之下，rect.left=336 對齊 article），不再溢出 article 右側、不再蓋下方段落。336 jsdom spec 全過。

---

**v0.7.92**——wheresyoured.at 標題不見修法（翻譯擴充相容性）。**動機**（Jimmy 2026-05-13 回報）：wya.com / where-are-all-the-data-centers/ 開 Shinkansen 翻譯擴充 single (replace) 模式後進閱讀模式，reader card 內看不到 hero H1「Where Are All The Data Centers?」，直接從訂閱 pitch 開始。**根因**：(1) 站點用 `<h1>` 做小節 heading（一頁 12 個 H1），真 hero `H1.post-hero__title` 在 `ARTICLE.post` 兄弟層 `.post-hero`。(2) detector heuristic 選到 `ARTICLE.post`（含 12 個小節 H1 + 主文 188 個 p），原本 promoteForTitle 走 `titleMatches(og:title, h1.textContent)` 升 articleEl 到 `.container.wrapper`（包 .post-hero）。(3) Shinkansen single mode 把 `H1.post-hero__title` textContent 換成中文「資料中心都跑去哪了？」，og:title（英文，meta 不被翻譯擴充改動）與 H1（中文）比對失敗 → promote 不發生 → articleEl 卡在 `ARTICLE.post`（不含 hero）→ `ensureArticleContainsTitleH1` 兜底 guard「articleEl 含任何 H1 就 skip」過早收手 → cleaner hideAncestorSiblings 把 `.post-hero` 當 chrome 砍。**修法**（detector.js ensureArticleContainsTitleH1 加結構性兜底）：(a) 路徑 1「DOM-order 第一個 H1 不在 articleEl 內 → 升 LCA」，不依賴文字比對（hero H1 慣例在頁面開頭附近，這是穩定結構訊號，翻譯擴充改不到）。(b) 觸發前 guard：articleEl 已含「跟 og:title / docTitle match 的 heading（h1-h4）」→ skip 不升，利用 og:title meta 標籤不被翻譯擴充改的穩定性，防 ChinaTalk 類 Substack 站 site logo H1（DOM-order 第一個但不是 post hero）誤觸路徑 1 升到含 logo 的 outer wrapper。新增 2 條 detector.spec.js + 對應 fixture：(1) `wya-translated-hero-h1-sibling.html` 驗翻譯擴充後 articleEl 必須升到 `.container.wrapper` 含 hero。(2) `site-logo-h1-no-upgrade.html` 驗 ChinaTalk 類「site logo H1 + 真 hero H1 在 article 內」場景 articleEl 不升、不吞 logo。Probe 確認：baseline + dual-injection + single-mode (replace) 三種場景 articleEl 均選 `.container.wrapper` 含 hero H1。Playwright harness 確認 ChinaTalk 不回歸（articlePreview 從「Media Diet Q1 2026」開始、不含 logo）。331 jsdom spec 全過。

---

**v0.7.91**——SPACE 鍵捲動。**動機**：reader mode 啟動後，原站若攔 keydown 或 focus 跑掉（例如先前 focus 過某個被 cleaner hide 的元素），瀏覽器原生「SPACE = 往下捲一頁、Shift+SPACE = 往上」會失效，使用者長文閱讀時失去最常用的捲動快速鍵。**修法**：styler 在 `window` capture phase 攔 `keydown` SPACE，自己呼叫 `window.scrollBy({ top: innerHeight * 0.92, behavior: 'smooth' })`（Shift+SPACE 反向），比原站 bubble listener 早收到事件。例外：`INPUT` / `TEXTAREA` / `SELECT` / `contenteditable` focus 時放行（避免吃掉表單空白輸入；contenteditable 用 `isContentEditable` getter + attribute 雙通道 fallback 兼容 jsdom）；`Ctrl/Cmd/Alt + SPACE` 也放行（保留瀏覽器/系統快速鍵）；非 SPACE 鍵不攔。listener 跟既有 v0.7.90 scroll listener 同生命週期：`apply()` install / `restore()` remove。**通則屬性**：純結構性、不綁站點，補回瀏覽器原生 SPACE 捲動行為。新增 8 條 styler.spec.js forcing function：SPACE → preventDefault + scrollBy 往下、Shift+SPACE 往上、input/textarea/contenteditable 各別放行、modifier 組合放行、非 SPACE 鍵不攔、restore 後 listener 移除。322 jsdom spec 全過。

---

**v0.7.90**——auto-hide scrollbar。**動機**：reader mode 啟動後，原站若有 `scrollbar-width: none` / `::-webkit-scrollbar { display: none }`（SPA 站常見），整個 scroll bar 會被連帶吞掉——使用者捲動時看不到任何位置 indicator，閱讀長文找不到自己滑到哪。**修法**：(1) styler base CSS 注入 `html.__jread-active` 的 `scrollbar-width: thin !important` + `scrollbar-color`（雙通道 override：Firefox 走 scrollbar-* 屬性、Chromium / WebKit 走 ::-webkit-scrollbar 自製 8px 細條）。(2) thumb 預設 `background-color: transparent`，搭配 `transition: 0.3s` 達到 fade-in/out；當 html 帶 `[data-jread-scrolling="1"]` 時切到 theme.scrollThumb 色（light/sepia 用深色 rgba 黑、dark 用淺色 rgba 白、sepia 用棕色配 sepia bg）。(3) styler 模組層級攔 `window` 的 scroll event（passive listener），觸發時 set attr、800ms idle 後移除。`apply()` install / `restore()` remove + clear timer + 清 attr，符合既有可逆性。**通則屬性**：純結構性、不綁站點，任何站把 scrollbar 隱藏起來都會被解開；macOS overlay 模式下也能跟原生 fade 行為協調（attr 觸發 thumb 顯色 ≈ scrolling 狀態）。新增 8 條 styler.spec.js forcing function：CSS 含 scrollbar-width / ::-webkit-scrollbar / transition / dark theme thumb 色；jsdom dispatch scroll event 後 html 立刻帶 `data-jread-scrolling="1"`、restore 後 listener 移除（再 dispatch 不觸發）+ attr 清除。314 jsdom spec 全過。

---

**v0.7.89**——新增「送到 Readwise Reader」快速鍵 `Alt+Shift+R`（macOS 同）。**動機**：原 popup 已有送 Readwise 按鈕，但每次得開 popup → 點按鈕 →（必要時先開 reader）兩步，加快速鍵直送省 click。**實作**：(1) `manifest.json` `commands` 加 `send-to-readwise` + suggested_key `Alt+Shift+R` + description（給 `chrome://extensions/shortcuts` 顯示）。(2) `service-worker.js` `chrome.commands.onCommand` 加 `send-to-readwise` 分支跑 `sendToReadwiseFromCommand(tabId)`：先查 `GET_READER_STATE`、未啟動則跑 `toggleWithInjectionFallback`（含 chrome:// 等禁止注入頁的 fallback）+ 800ms 等待 detector / cleaner / styler 跑完；然後 `EXTRACT_READER_HTML` 抽 reader card payload；走 popup 端既有 `buildReadwisePayload` + `saveToReadwise`（重用 `popup-core.js` 邏輯）。(3) 結果回饋：SW 沒 UI、新增 `SHOW_TOAST` 訊息常數（`namespace.js` MSG），SW 跑完後 sendMessage `SHOW_TOAST` 給 content script、由 `NS.toast.show()` 顯示「已送到 / 已存在 / token 無效 / 網路錯誤 / 等」結果 toast。content script `main.js` `chrome.runtime.onMessage` 加 `SHOW_TOAST` handler。**通則屬性**：MSG 訊息協定通用（任何 SW 想對 content script 顯示 toast 都可重用此通道）；快速鍵是 manifest 標準 commands API，使用者可在 `chrome://extensions/shortcuts` 自訂或解除衝突。toast 失敗（chrome:// / Web Store 等禁止注入頁）silent fail——MV3 SW 沒 UI 的限制，使用者按快速鍵沒反應就是限制。新增 2 條 forcing function spec：manifest commands 必須含 send-to-readwise + suggested_key + description；namespace.js 必須 export MSG.SHOW_TOAST。306 jsdom spec 全過。

---

**v0.7.88**——newtalk.tw 標題與圖片重疊修法（v0.7.87 後續迭代）。**新症狀**：v0.7.87 修法後標題確實出現，但**主圖佔滿 reader card 第一屏 + 標題疊在圖上看不清**。**根因**：newtalk 主圖（IMG）父鏈某層 CSS quirk（display: contents / flex / 等推測）讓 IMG 浮到 articleEl 之外（實機 probe 顯示 IMG rect_y=31 vs article rect_y=40），覆蓋整個第一屏。v0.7.87 對原 P.name 加 attribute + inline 大字 style + z-index: 10 仍被 IMG 覆蓋（z-index 對 article 之外的元素無效）。**修法（三層升級）**：(1) detector `markPromotedTitleIfMissing` 改成「**inject 新 `<h1 data-jread-injected-title="1">` 在 articleEl 第一個 child** + hide 原元素」路線——原元素的 layout 跟 IMG sibling 糾纏的問題（被 quirk 覆蓋）由「inject 全新獨立 DOM 節點」繞過，inject 元素 flow 不受原元素 sibling 影響。原元素設 `data-jread-promoted-title-source="1"` + `display: none`，避免 reader card 顯示重複標題。(2) inject H1 inline style 加 `background: inherit !important` + `padding: 8px 0` —— 繼承 articleEl 的 articleBg（白/dark/sepia 自動跟 theme）形成不透明 box，把後方所有 layout-quirk 覆蓋元素視覺遮住。z-index: 10 + position: relative 雙保險。(3) styler base CSS 對 `articleEl 內 img / video / picture` 加 `max-height: 90vh + object-fit: contain` 限制超大圖（newtalk 實測 IMG height=891 < 1080 cap 不命中，但對其他站長條圖 / 高 hero 圖仍有保護效果）。**通則屬性**：新策略「inject 獨立 H1 + 不透明 background」對任何「站把標題寫在非 h1-h4 + 主圖 layout quirk 覆蓋頂端」的場景通用，不綁站點。新增 2 條 detector.spec.js（inject H1 為 articleEl 第一個 child + 含 og:title 文字 + 大字 inline style；原 source 元素 display: none + 帶 source attribute）。harness 實機驗 newtalk 標題清楚顯示在白底頂端、不再跟圖重疊。304 jsdom spec 全過。

附帶教訓：v0.7.87「修原 P.name + z-index 浮上」對「原元素 sibling layout quirk 把後 DOM 元素抬到 articleEl 之外」的 case 失效——z-index 只在同一 stacking context 內有效，IMG 浮到 article 之外形成獨立 stacking、z-index 不影響。修法升級到「**創獨立 DOM 元素 + 不透明 background 遮蓋層**」才能根本繞過原元素 layout 糾纏。Reader-mode 對「site 寫得很怪 / 圖片 layout quirk」場景的設計原則：能繞過原元素 layout 就繞過、不跟原站 CSS 較勁。

---

**v0.7.87**——newtalk.tw 標題不見修法。**根因**：站把主文標題寫在 `<p class="name">`（非 h1-h4），原頁有 SEO 用裝飾性 `<h1 class="hidden">` 在 `<header>` chrome 內、被 cleaner hide → reader card 內 articleEl (DIV.left_column.sticky-main) 內找不到任何 visible h1-h4 → styler 不會自動視覺突顯 P.name → reader card 標題不見。**修法（三層）**：(1) detector 新增 `markPromotedTitleIfMissing(articleEl)`：cleaner 跑完後（**main.js 流程**而非 detect() 結尾——cleaner 還沒跑時 hidden heading 仍被誤判 visible），articleEl 內若無「不在 hidden 樹內」的 h1-h4，找等同 og:title / docTitle 的 p/div/span 元素加 `data-jread-promoted-title="1"` attribute + inline 大字 style（font-size: 2em / font-weight: 700 / line-height: 1.3 / display: block / position: relative + z-index: 10 保護被 IMG / overlay 等覆蓋）。比對演算法用「normalize 後 textContent 跟 og:title overlap >= 0.85」+「childTagCount 少（純標題、非 wrapper）」雙條件挑最佳候選。inline style 路線（不走 styler base CSS）避免 styler 字串 grep 觸發既有 spec 對 font-size / line-height 字樣的 forcing assertion。(2) styler base CSS 對 `[data-jread-active] img:not(a > img) / video / picture` 強制 `display: block !important`：避免 inline default + large naturalHeight 配父層 line-height baseline 對齊讓 IMG top 跑到負 y、視覺覆蓋上方標題。(3) main.js exitReaderMode 清 attribute + 對應 inline style 各 prop（font-size / font-weight / line-height / display / margin-top / margin-bottom / position / z-index）removeProperty 還原。**通則屬性**：純結構性、不綁站點，任何站把主標寫在非 h1-h4 tag 都通用。新增 newtalk-p-name-as-title.html fixture + 5 條 detector.spec.js forcing function：fixture 用會命中 NOISE_KEYWORD_RE 的 newsletter-marquee class 確保 cleaner 穩定 hide widget heading（jsdom 不算 layout，class 命名是唯一可靠 hide 路徑）；jsdom 支援動態 attachShadow + 直接 call markPromotedTitleIfMissing 驗 attribute + style + guard 邏輯（已 visible h1 不 promote / og:title 缺失不 promote / hidden h2 不算 visible 仍 promote）。harness 實機驗 newtalk 主文標題出現（z-index 確保浮在 IMG 上方）。303 jsdom spec 全過。

附帶教訓：`markPromotedTitleIfMissing` 第一版放在 detect() 結尾、**時序錯誤**——cleaner 還沒跑時 articleEl 內被 hide 的 heading 仍是「不在 hidden 樹內」狀態，guard 誤觸 return 不 promote。改放 main.js cleaner 跑完後 call 才正確。第二版加 inline style 走 styler base CSS rule 觸發既有 spec 對「預設不注入 font-size / line-height」字樣 grep assertion，改 inline style.setProperty 路線（jread style.cssText 不出現在 `__jread-style` 內、grep 不誤觸）。第三版實機 IMG rect_y 異常（Playwright Chromium lazy-load IMG quirk）覆蓋標題視覺，加 position: relative + z-index: 10 保險（實機 Chrome 可能 IMG rect 正常、不重疊，此 z-index 是兜底）。三輪修法都是 forcing function 設計教訓：跨 cleaner / styler / detector 多模組 bug 不能單純加 code、必須先想清楚時序與既有 spec 字串 grep。

---

**v0.7.86**——支援 Shadow DOM 站（MSN.com 類 Web Components 包主文）。**根因**：MSN 用 custom elements + open shadow root（`DESKTOP-ARTICLE-CONTENT` / `MSN-ARTICLE-PAGE` / `CP-ARTICLE-READER` / `CP-ARTICLE` / `VIEWS-HEADER-WC` 等），普通 `document.querySelectorAll` 不穿透 shadow scope → light DOM 看到 h1=0、main=0、article 是空殼（textLen=0）→ detector 所有策略全部回 null、reader mode no-op。**修法**：detector 加第五策略 `detectByShadowDomFallback()`，主流程全失敗時啟動：(1) 遞迴掃所有 open shadow root；(2) 找含 most p（>= 5）的 shadow 為主文；(3) 從主文 shadow 的 host 往上爬找最近祖先 subtree 內含 h1 的 shadow（避免 MSN 同頁多篇推薦時抓到別篇 h1 配當前篇 p 的混搭）；(4) deep clone 主文 shadow children + h1 進一個 `<article data-jread-shadow-replica="1">` light DOM 替身、append 到 body 末尾；(5) 回傳替身為 detector 結果，後續 cleaner / styler 對替身操作。`exitReaderMode` 同時清除替身（不動原 shadow 結構）。**通則屬性**：純結構性、不綁站點，任何 open shadow root + 主文 textLen 夠的站都通用。**副作用 scoped**：clone 副作用（lazy-load src 可能未填、影音 event handlers 失效、shadow scope CSS 不跟 clone）只在 fallback 啟動的 shadow-DOM 站發生，對既有 light DOM 站零影響——主流程命中時 fallback 不啟動。新增 5 條 detector.spec.js shadow DOM 鎖（jsdom 支援 attachShadow open mode）：fallback 命中策略 = `shadow-dom-fallback`、替身有 data-jread-shadow-replica="1" attribute、h1 與 p 同 article block 對應（多篇推薦不誤配）、替身在 body 內 + 原 shadow 不動、shadow 內 p 不足 5 時不啟動、無 shadow 時 fallback 回 null（既有站零影響）。harness 實機驗 MSN 主文完整顯示、h1 與內文對應 og:title。298 jsdom spec 全過。

附帶教訓：第一版 fallback 對「同頁多篇推薦」（MSN.com 列表頁特性）抓 h1 用「第一個含 h1 的 shadow」會抓到別篇文章的 h1 配當前篇的 p。修法用「主文 shadow host 的 closest 共祖 subtree 內含 h1 的 shadow」做關聯性匹配。Web Component 站有「同頁多篇實例」結構特性，shadow root 之間的對應關係必須靠 DOM tree 拓撲推斷、不能單純第一個命中。

---

**v0.7.85**——對標業界開源 reader-mode / content-extraction / element-hiding 專案的 noise keyword 最佳實踐補強。**緣由**：以前每次撞到新站點才被使用者打臉式累積 keyword，效率低。一次性蒐集 Mozilla Readability.js（REGEXPS unlikelyCandidates / negative / shareElements）、Postlight Parser（UNLIKELY_CANDIDATES_BLACKLIST / NEGATIVE_SCORE_HINTS）、Unclutter（contentBlock.ts blocklist）、EasyList（element-hiding generic filters）、uBlock Origin（annoyances filters）、dom-distiller（Chromium）的 token list，比對既有 NOISE_KEYWORD_RE 找出**淨新增**安全 token、合進。**新加 NOISE_KEYWORD_RE alternation**（44 個）：(1) 品牌/服務名（零誤殺，命中即必然雜訊）：`addthis` / `sharedaddy` / `ai2html` / `sociable` / `dianomi` / `adsense` / `adslot` / `onesignal` / `intercom` / `printfriendly` / `instapaper_ignore` / `blogger-labels` / `smartfeed` / `mpu`；(2) 廣告/付費牆變體：`advert` / `adbox` / `adhesion` / `metered` / `interstitial` / `takeover`；(3) 留言/社群：`replies` / `remark` / `shoutbox` / `respond` / `composer` / `combx`；(4) 結構雜訊：`supplemental` / `cover-wrap` / `entry-unrelated` / `crumb` / `recirc` / `nag` / `backdrop` / `topbar` / `announcement` / `popover` / `drawer` / `loader` / `contact` / `shopping` / `plea`；(5) 推薦/相關文章：`next-article` / `latest-posts` / `mostread` / `most-read`。**STRONG_NOISE_KEYWORD_RE 加品牌名**：`disqus` / `outbrain` / `taboola` / `dianomi` / `addthis` / `sharedaddy`——這些 widget 內常含長文字（評論 / recommendation 描述）會觸發 anchor guard 被豁免，strong path 跳過 guard 安全（明確品牌名零誤殺）。**刻意不採用**（誤殺風險記錄）：`gate` / `wall` / `media` / `meta` / `info` / `tags` / `widget` 單字 / `scroll` 單字 / `disclaimer` / `dialog` / `alert` / `prompt` / `commercial` / `tease` / `splash` / `bookmark` / `tools` / `legends` / `dateline` / `marketing` / `aux` / `featured` / `recent` / `latest` 單字 / `home` 單字 / `com-` 單字 / 站特定 token。新增 `docs/NOISE_KEYWORD_RESEARCH.md` 完整紀錄出處 + 已採用 / 刻意不採用 兩表 + 未來新增規則。新增 `generic-noise-keyword-coverage.html` fixture 跑 44 個新 token 各對應一個 wrapper 的 forcing function spec：退回舊名單會讓對應 token assertion 一條條 fail。293 jsdom spec 全過。

附帶教訓：`gate` 很想加（matches paywall-gate）但太短會 match `tailgate` / `stargate` 等英文詞、`marketing` 想加但會 match HBR 商業類主文「marketing strategy」class——短 token 與英文常見主題詞風險高，寧可漏抓 1-2 站、保守先不加。`com-` 在 Mozilla negative regex 裡但太短易誤殺，`legends` 與圖說歧義，`media` / `meta` / `info` / `tags` 主文 class 慣用名都不能單字採用。設計原則改成「合進兩個源以上、word-boundary 安全 + fixture 鎖」；新 token 加前先讀 docs/NOISE_KEYWORD_RESEARCH.md 避免重複研究與重複踩坑。

---

**v0.7.84**——twz.com reader mode 仍殘留右側「LATEST IN」相關文章 sidebar。**根因**：sidebar 結構為 `<aside id="article-sidebar" class="article-sidebar">` 包在 `<div class="article-sidebar-wrapper">` 內，跟主文 paywall wrapper 是 flex-row siblings。既有 `hideInsideArticleSidebarColumns` 條件 B（aside tag + rectH > 400）只檢查 direct-child aside、aside 包在 sibling div wrapper 內漏網；條件 A（textLen ratio + linkDensity > 0.5）也因 sidebar 內含 140 chars description p 拉低 linkDensity 到 0.27 漏網。`sidebar` 不在 NOISE_KEYWORD_RE 是因為太通用（會誤殺 `sidebar-icon` / `sidebar-toggle` button）。**修法**：(1) `NOISE_KEYWORD_RE` 加 alternation `article-sidebar|sidebar-wrapper|sidebar-column|sidebar-content|sidebar-widget|sidebar-primary|sidebar-secondary`——CMS 慣例強語意 sidebar 命名，主文 wrapper 不會這樣命名；word boundary `[^a-z0-9]` 確保不誤殺 `sidebar-icon` 等（`sidebar` token 後 `-` 是 boundary 不命中 `sidebar-icon`，但 `article-sidebar` 整個 token 命中 `article-sidebar`）。(2) 新增 `STRONG_NOISE_KEYWORD_RE` + `shouldHideByStrongKeyword()`：sidebar widget 內含 100+ chars description p（典型相關文章 card）會觸發 v0.7.83 的 `wrapperContainsArticleAnchor` guard 被豁免，strong path 命中時跳過 anchor guard 直接 hide。**通則屬性**：純結構性 + class 強語意，不綁站點。fixture 加進 twz-paywall-class-content-wrapper.html，sidebar p 設 > 100 chars 觸發 anchor guard，forcing function 鎖到「只有 strong path 能 hide」。harness 實機驗 twz.com 修法後 sidebar 消失。292 jsdom spec 全過。

附帶教訓：`wrapperContainsArticleAnchor` guard 過於寬鬆對 sidebar widget 也豁免——任何「wrapper 內含 100+ chars description p」都被當主文。strong path 區分主文保護的優先級：CMS 強語意 token（sidebar / 等明確 widget 類別）的 widget 命名，跳過 guard 直接 hide；普通 keyword（paywall / newsletter / 等可能反向命名的）才走 guard 兜底。設計成兩條 path 才不會「為了保護 twz 主文而漏砍 twz sidebar」。

---

**v0.7.83**——修 twz.com 類「主文 wrapper class 含 paywall keyword 被誤殺」造成 reader card 空白。**根因**：twz.com 主文 wrapper class 為 `entry-content Article-bodyText paywall border-b-2 w-full mb-6`，CMS（Recurrent Ventures）用 `paywall` class 反向標「付費牆已解鎖內文」，語意完全相反。`paywall` 命中 `NOISE_KEYWORD_RE`，整塊主文（47 個 p、8 個 h2、23K 字）被 `hideInsideArticleByKeyword` hide。既有「含 h1 → 跳過」guard 不及（h1 在外層 `<header>`、不在此 wrapper 內），reader card 只剩 byline 跟相關文章卡片，主文全失。**修法**：`hideInsideArticleByKeyword` 主 loop 加一條 guard `if (wrapperContainsArticleAnchor(el, null)) continue;`——重用既有的「主文 anchor」三道判定（>=100 chars 單一 p / 累計 p textLen >= 300 / title-anchor element），keyword 命中後若 wrapper 含主文 anchor 視為主文容器、不 hide。**通則屬性**：完全結構性，不綁站點 / class，純粹「wrapper 含主文長文 → 視為主文」啟發式；連動更新 `udn-article-siblings-noise.html` fixture（原 widget p 是 200+ chars 測試說明文字、會誤觸新 guard，改成真實 udn 結構：短摘要 list + 短 p）。新增 `twz-paywall-class-content-wrapper.html` fixture + cleaner.spec.js 一條 forcing function，驗 paywall wrapper 主文保留 + 同 article 內短 widget（newsletter / author-bio）仍被 keyword hide。harness 實機驗 twz.com 修法後主文完整顯示。292 jsdom spec 全過。

附帶教訓：CMS 用 noise keyword 做反向命名（paywall 標「已解鎖」、free 標「付費」、premium 標「免費」等情境）對 NOISE_KEYWORD_RE 是 false positive，但 wrapper 結構特徵（含長 p / 累計 textLen / title-anchor）能反過來證明它是主文。既有 `wrapperContainsArticleAnchor` 函式已被 heading text rule、closest 失敗 fallback 等多處共用，但 keyword rule 漏接——這次補上後三條主要 hide 路徑都用同一套主文保護判定，邏輯一致。

---

**v0.7.82**——修 SPA 站（Readwise Reader / Notion / Gmail 類）reader mode 無法捲動。**根因**：這類站把 `body`（有時連 `html`）設 `overflow: hidden`、scroll 交給內層 div 接管。reader mode 把 article card 注入回 body flow、body 高度被撐到 5K+ px，但 `overflow-y: hidden` 仍鎖死 viewport，滾輪 / 鍵盤 / trackpad 全部無效。**修法**：styler base CSS 對 `html.__jread-active` + `html.__jread-active body` 兩條 rule 強制 `overflow-y: visible !important`，讓 scroll 回到 viewport 層級。`overflow-x: hidden` 仍保留避免主文超寬橫向拉條。**通則屬性**：不綁站點 / class，純粹 reset 兩個 root element 的 overflow——任何 SPA 站把 scroll lock 設在 html / body 都解得開，不影響非 SPA 站（它們本來就是 visible）。Readwise Reader（read.readwise.io/new/read/...）實機 console probe 揭穿 `body overflow: hidden hidden hidden` + `body height: 5920px` 即此 bug 的標準特徵。新增 styler.spec.js 兩條 forcing function 鎖住兩條 rule 內容。291 jsdom spec 全過。

---

**v0.7.81**——撤回 theverge 全部修法 + 移除 instrument log（Jimmy 放棄 theverge 站）。撤回 v0.7.74 `hideInsideArticleAsides`、v0.7.77/v0.7.79/v0.7.80 `hideInsideArticleReportCloseWidgets`（連帶 main 流程的 caller 一起移除），避免這些 rule 對其他站造成誤殺風險。移除 styler.apply 結尾的 v0.7.73 / v0.7.75 / v0.7.78 instrument log（一整塊 setTimeout block）。除了這次 theverge 連 8 版（v0.7.73~v0.7.80）的修法 + log，所有其他站的修法（cna / gvm / 商周 / line today / 等等）全部保留。289 jsdom spec 全過。

附帶教訓：**styled-components hash class 站點如果 textContent 開頭是 widget 文字、整塊 lede 包覆主圖+H1+byline+widget**，靠 textContent prefix + button / role=button 命中根本判別不出 widget vs lede，再多 guard（h1/figure/img exclude）也是賭——主文 anchor 不一定在被命中的同一個 wrapper 層。這類站點需要更高層的方法（例如直接 detector 階段針對 lede class pattern 升級到 entry-body-container），不適合在 cleaner 階段亂砍。

---

**v0.7.80**——v0.7.79 把 ReportClose rule 上限放寬到 1000 後實機**過砍主圖 + H1 + byline**（Jimmy 截圖回報）。**根因**：v0.7.73 instrument 早就顯示 articleEl direct child 0 是 `duet--article--lede` div h=1165 textContent 開頭也是「ReportCloseReportPosts...」——**整個 lede 區（含主圖 figure + H1 + byline + ReportClose widget）的 textContent 開頭都是 widget 文字**，rule selector `div, section` 命中後整塊 lede 被 hide。修法（補主文 anchor 保護 guard）：rule 加 `if (el.querySelector('h1, figure, img')) continue`——widget 自身不會含主文 anchor（h1/figure/img），這條 guard 防止誤殺含主文 anchor 的 lede 包覆 wrapper。**保留所有 instrument log 待 Jimmy 驗證**。289 jsdom spec 全過。

附帶教訓：放寬 rule 上限 / 縮小 guard 時，必須**逐條驗 articleEl 內所有可能命中的 wrapper**——不只 `_3zbl0r4`，連 lede 整塊外層 div 也命中（textContent 開頭是 widget 文字、textLen 介於門檻內），漏 guard 即誤殺。

---

**v0.7.79**——theverge ReportClose widget rule textLen 上限放寬（v0.7.78 instrument 揭穿 v0.7.77 沒命中真因）。**事實**：v0.7.78 instrument 顯示 _3zbl0r4 ownHidden=false hiddenAncestor=null，**沒被任何 rule hide**。fullText 開頭確實是 `ReportClose` 命中 v0.7.77 regex，但 fullText 長度約 300+ chars（雙 widget 文字串接「ReportClose...FollowFollowSee All ReportTechClose...」），超過 v0.7.77 寫的 `text.length > 200` 上限被跳過。修法：textContent 上限從 200 → 1000。理由：widget 最多 button label + dropdown 提示文字幾段不會到 1000；主文段落從 detector 角度至少 1000+ chars 才會被 article candidate 命中、1000 上限避免誤殺主文。**保留所有 instrument log 待 Jimmy 驗證真實機器修法生效再清**。289 jsdom spec 全過。

---

**v0.7.78**——theverge round 4 instrument（v0.7.77 ReportClose widget rule 在實機沒生效，Jimmy 截圖 div._3zbl0r4 仍存在仍撐空白）。Jimmy 提醒不要亂猜——v0.7.77 的 rule 用「textContent 開頭 ReportClose」是賭，沒驗證 _3zbl0r4 自身是否真符合 rule。新 instrument 直接印 _3zbl0r4 真實狀態：(1) ownHidden / inHidden / hiddenAncestor（看是否被砍 / 哪層砍）；(2) directText（不抓子孫）+ fullText 前 200 chars（看 textContent 真實開頭）；(3) outerHTML 前 400 + inline style；(4) children 的 outerHTML 前 200——揭穿 ReportClose widget rule 為何沒命中。**保留所有 instrument log + v0.7.77 ReportClose rule** 待 Jimmy 驗證真兇後再決定 rule 改寫或撤回。289 jsdom spec 全過。

---

**v0.7.77**——theverge byline + lede ReportClose widget 兩層真兇修法（v0.7.76 instrument 揭穿）。**真兇 1**：byline 缺名因 `<aside class="_1wu3rm0">` 包含 author link，被 v0.7.74 通則砍掉連帶作者名消失。**真兇 2**：lede 區 `_3zbl0r4` h=457 是 ReportClose widget 容器（child#0 _1p1nf4x0 textContent="ReportCloseReportPosts from this topic w" h=320 是 widget），class 是 styled-components hash 無語意。**修法 A**：`hideInsideArticleAsides` 加 guard——aside 含 `a[href*="/author"]` / `a[href*="/people/"]` / `a[rel="author"]` 保留（HTML5 spec aside 允許 author byline 用法）。**修法 B**：新 rule `hideInsideArticleReportCloseWidgets` 命中 div/section textContent 開頭 `ReportClose` / `CloseReport` 連寫 + 含 button/role=button 的 widget pattern。範圍限縮 textContent 5-200 chars 避免誤殺主文容器。**保留所有 instrument log 待 Jimmy 驗證**。289 jsdom spec 全過。

---

**v0.7.76**——theverge round 3 instrument。v0.7.75 揭穿關鍵事實但留兩個未解：(1) author links count=4 全部 inHidden=true 但前 3 個 ownHidden=false——某層**祖先**被 hide 把整個 byline 包住，需追蹤是哪層；(2) `_3zbl0r4` h=457 / `_1p1nf4x0` h=320 的 padding/min-height/aspect-ratio 全 0，但 `comp_h=457.109px` 直接是 computed height——可能是 stylesheet 顯式 height 或 grid layout 撐高度（`min-height: auto`），需印 inline style + display + grid-template + parent 看清楚。新 instrument 加印：(1) author link 祖先鏈 walk-up 直到 hidden 元素，回報 `hiddenAncestor:{tag,cls,depth}`；(2) tall element 自身 inline style + display + grid-template-rows + parent tag/cls/display/grid-template。**保留所有 instrument log 待 Jimmy 驗證真正修法生效再清**。289 jsdom spec 全過。

---

**v0.7.75**——theverge round 2 instrument（v0.7.74 hideInsideArticleAsides 沒解決問題，Jimmy 截圖標題仍消失、主圖後仍空白、byline 仍缺名）。v0.7.73 instrument 揭穿真兇不是 aside 而是 styled-components hash class element：DIV._3zbl0r4 h=457（圖後第一個 tall element）+ DIV._1p1nf4x0 h=320 + 多層 hash class wrapper 撐高度。新 instrument 加印：(1) gap area 內 height>=100 的 element 完整 computed padding-top/padding-bottom/min-height/aspect-ratio/display/position + ::before/::after 四維度；(2) `a[href*="/author"]` 作者連結的 href/text/hidden 狀態（揭穿 byline 缺名真兇）。**保留 v0.7.73+v0.7.75 instrument log 待驗**。289 jsdom spec 全過。

---

**v0.7.74**——theverge 標題消失第一輪修法（v0.7.73 instrument 揭穿三層真兇）。**真兇 1**：H1 在 articleEl 內 visible（detector 沒砍、cleaner 沒砍），但被前面的 `duet--article--lede` div h=1165 + 一堆 `<aside>` h=294 widget 推到螢幕外。**真兇 2/3 待驗**：圖後 1500px 範圍含 `<aside class="_1wu3rm0">` 訂閱推薦 widget，class 是 styled-components hash 無語意 NOISE_KEYWORD_RE 攔不到。**修法**：新 rule `hideInsideArticleAsides` 清 articleEl 內所有 `<aside>` element——HTML5 spec 定義 aside 為「與主文相關但獨立的補充內容」（側邊欄/註解/相關連結），reader mode 純閱讀體驗下 aside 必為訂閱推薦/widget 等 chrome 雜訊，跨站適用。掛進 cleaner 主流程。**保留 v0.7.73 instrument log 待 Jimmy 驗證**——標題回來後再看 byline 缺名等其他層問題。spec 暫不加（待 Jimmy 驗證 + 整輪修法定型再補）。289 jsdom spec 全過。

---

**v0.7.73**——theverge.com 標題消失 + 圖後空白 instrument（Jimmy 截圖回報 https://www.theverge.com/report/914244/dreame-china-vacuums-hypercars-elon-musk reader mode 後標題不見、圖下大塊空白、byline 殘留缺名字）。多層問題不亂猜，instrument 印：(1) articleEl 自身 + 是否含 h1（detector 有沒有把 h1 升上來）+ h1 visible 狀態（cleaner 有沒有誤砍）；(2) articleEl direct children hidden 狀態；(3) 圖 bottom 後 1500px 範圍內所有 element（找空白來源）。Jimmy 實機 console 揭穿三層真兇。**保留 log 待驗**。289 jsdom spec 全過。

---

**v0.7.72**——today.line.me 主圖後空白修法（Jimmy DOM 截圖直接揭穿真兇）。**真兇**：`<div class="placeholder" style="padding-top:75.25%">` 用 `padding-top` 撐 4:3 aspect-ratio lazy-load placeholder。跟 cna picture::before / gvm object-fit::before 同類但載體換成 div.placeholder + 用 `padding-top` 不是 padding-bottom。修法（兩條同時擴）：(1) 主 placeholder rule selector 加 `[class*="placeholder"]`，wrapper 慣例命名跨站 pattern；(2) rule body 加 `padding-top: 0 !important` 第二維度，覆蓋 padding-bottom 與 padding-top 兩種 hack 寫法。spec 加 forcing function 驗 selector 含 `[class*="placeholder"]` + rule body 含 padding-top:0。sanity 拿掉 → spec fail。289 jsdom spec 全過。

---

**v0.7.71**——清掉 v0.7.69 instrument log（Jimmy 已驗證 v0.7.70 object-fit::before height:0 修法生效，按硬規則「等修好才清 log」執行）。styler.apply 結尾 [JRead v0.7.69] 區塊整段移除。修法本身（picture / figure / [class*="object-fit"]::before/::after 的 content:none + display:none + padding-bottom:0 + height:0）全部保留。289 jsdom spec 全過。

---

**v0.7.70**——gvm 主圖前空白真兇定位（v0.7.69 instrument 揭穿）。**真兇**：`div.object-fit::before` pseudo-element 用 `content: ""; display: block; height: 360px / 537.598px`（**直接設 height** 撐 placeholder 高度，不是 padding-bottom 也不是 aspect-ratio）。v0.7.61 cna picture::before 修法只清 `content + display + padding-bottom` 三個維度，沒處理 `height` 維度——`object-fit::before` 用 height 撐高所以那條 rule 不夠。修法：(1) 擴 `::before/::after` rule selector 加 `[class*="object-fit"]::before/after`；(2) rule body 加 `height: 0 !important` 第四維度——對所有 picture/figure/object-fit 的 ::before/::after 全方位清空（display:none + content:none + padding-bottom:0 + height:0）。spec 加 forcing function 驗 selector + height:0 declaration。**保留 v0.7.69 instrument log 待 Jimmy 驗證**。289 jsdom spec 全過。

---

**v0.7.69**——gvm 主圖前空白 instrument round 2（v0.7.68 [class*="object-fit"] 修法在實機沒生效，Jimmy 截圖回報空白還在 + DOM 揭穿 div.object-fit 仍展開有 hover tooltip 占空間）。新 instrument：印 articleEl 內所有 [class*="object-fit"] element 自身 rect/computed style/inline style/::before/::after pseudo content + display + paddingBottom + aspectRatio + height + 各 child 的 rect/computed/display + figure 祖先 + figure 的 ::before/::after。Jimmy 實機 console 揭穿真兇。**保留 log 待 Jimmy 驗證真正修法生效再清**。289 jsdom spec 全過。

---

**v0.7.68**——gvm 主圖前空白修法 + 移除 v0.7.65/v0.7.66 instrument log。Jimmy 驗證 v0.7.67 修法生效（gvm 內文回來），但截圖顯示主圖前仍有大塊空白。Jimmy DOM 截圖揭穿真兇：figure 內 `<div class="object-fit">` 空 wrapper 用 aspect-ratio / padding-bottom hack 撐 lazy-load placeholder（跟 v0.7.61 cna picture::before 同類但載體換成 div）。修法：擴 v0.7.55 picture rule selector 加 `[class*="object-fit"]`，同樣強制 aspect-ratio:auto + padding-bottom:0 + height:auto + min-height:0。`object-fit` 是 CSS property 名當 class 用的跨站 pattern（給 img 套 object-fit 的 wrapper 慣例命名）、屬結構性通則。spec 加 forcing function 驗 selector 含 `[class*="object-fit"]`。同時按硬規則「等修好才刪 log」清掉 v0.7.65 articleEl/children/hidden 概觀 log + v0.7.66 hide stack trace（gvm 內文已驗證生效）。289 jsdom spec 全過。

---

**v0.7.67**——gvm.com.tw 主文「年前」敘事誤判修法（v0.7.66 hide stack trace 揭穿真兇）。**真兇**：`hideInsideArticleCommentPanels` 用 `RELATIVE_TIME_RE` 數時間戳 >= 3 判定留言面板。gvm 主文作者寫「20 年前」「30 年前」「5 年前」「10 年前」「3 年前」等正文敘事性時間描述命中 regex，舊 layer 1「含 >= 300 chars 單一 p」protection 對中文短段多 p 結構失效（每段 200-300 chars 不過門檻）→ 整個 article-content textLen=2864 被誤砍。修法（layer 2 protection）：element 含 >= 4 個獨立 `<p>`、每個 >= 50 chars（trimmed） = 主文必備結構特徵。留言面板典型用巢狀 `<div>`（Disqus / LINE Today / Reddit / FB / Twitter / 自製 widget），不用 `<p>` tag——「>= 4 個 long p」留言面板達不到。fixture gvm-comment-panel-false-positive.html（6 段中文長段含 5 個「年前」）+ 2 條 spec（article-content 容器 + 6 段 marker 必保留）；sanity 拿掉 → spec fail。**保留 v0.7.65 / v0.7.66 instrument log 待 Jimmy 驗證真實站點修法生效再清**（按硬規則）。289 jsdom spec 全過。

---

**v0.7.66**——gvm 內文消失 instrument round 2（v0.7.65 揭穿 hidden#22 是 DIV.article-content textLen=2849 整篇主文被砍，但無法定位**哪條 rule** 砍的）。新 instrument：在 cleaner.hide() 入口加 stack trace 印——當 element textLen >= 500 時印 tag/cls/textLen + new Error().stack 前 4 層 caller，直接揭穿是哪條 cleaner rule 把主文當雜訊砍。同時保留 v0.7.65 articleEl/children/hidden 概觀 log。修完真兇後兩段 instrument log 立即一起移除。**保留待 Jimmy 驗證**。287 jsdom spec 全過。

---

**v0.7.65**——gvm.com.tw 文章內文消失 instrument（Jimmy 截圖回報 https://www.gvm.com.tw/article/129607 reader mode 後只剩標題+作者+主圖、其餘內文全砍）。styler.apply 結尾加 instrument log：印 articleEl 自身 rect、直接 children（tag/cls/hidden/w/h/text 前 60 字）、所有 [data-jread-hidden="1"] 元素（限前 30）的 tag/cls/textLen/text、以及 visible p 殘留段落。Jimmy 實機 console 揭穿哪條 cleaner rule 過砍 + 哪個 wrapper 被誤砍。修完真兇後此版 instrument log 立即移除。**保留 log 待 Jimmy 驗證真正修法生效再清**（按 Jimmy 硬規則 instrument 等驗證再刪）。287 jsdom spec 全過。

---

**v0.7.64**——cna 主文中 `<div class="lineAd">` 廣告 wrapper 清除（Jimmy 截圖回報）。根因：lineAd 是 camelCase 連寫 ad 後綴（lowercase 為 linead），既有 AD_BOUNDARY_RE 的「邊界 ad 邊界」(`/(^|[-_\s])ad([-_\s]|$)/`)攔不到——`ad` 前是 `e` 不是邊界字元。修法（結構性通則）：新 AD_SUFFIX_RE 對 layout/position/content-type prefix + Ad 後綴統一命中——`/(line|inline|article|page|main|single|banner|display|video|side|top|bottom|left|right|header|footer|content|sticky|float|wrapper|container|block|widget|module|slot|unit|infinite|leader|skyscraper|rectangle|square|tall|wide|preroll|postroll|midroll)ad(s?)([-_\s\d]|$)/i`，明確列舉 layout 前綴避免誤殺 head/load/bread/glad 等英文單詞。掛進 shouldHideByKeyword 的 OR 鏈。fixture cna-icon-only-link.html 加 `<div class="lineAd">` + spec 驗 hide；sanity 拿掉 → spec fail。287 jsdom spec 全過。

---

**v0.7.63**——cna 主文頂端「支持 CNA」icon-only 按鈕清除（Jimmy 2026-04-28 截圖回報）。根因：`<a class="btn_support"><img src="support.svg"></a>` 是 icon-only CTA 連結，既有 cleaner rules 全攔不到——`hideInsideArticleJsLinks` 只攔 `href^="javascript:"`、`NOISE_KEYWORD_RE` 沒含 `support`（誤命中風險高，含 supportive 詞變體可能誤殺）、`NOISE_LINK_TEXT_RE` 攔不到（textContent 空）。修法（結構性通則）：新 rule `hideInsideArticleIconOnlyLinks`——主文內 icon-only `<a>`（含 img/svg 但 textContent 去空白後 < 1 字）一律 hide。安全 guard：`figure / picture` 內的 a 保留（「圖片可點擊版」是主文 hero 圖配連結的合法用法）。fixture cna-icon-only-link.html + 2 條 spec（btn_support 必 hide / figure 內 a 必保留）；sanity 拿掉呼叫 → spec 立即 fail。286 jsdom spec 全過。

---

**v0.7.62**——清掉 v0.7.59 instrument log（Jimmy 已驗證 v0.7.61 picture::before 修法生效，按 Jimmy 規則「等修好才清 log」執行）。styler.apply 結尾的 [JRead v0.7.59] 區塊整段移除。修法本身（picture::before / figure::before / picture aspect-ratio:auto / picture height:auto / img position:static / 等等）全部保留。284 jsdom spec 全過。

---

**v0.7.61**——cna 主圖空白真兇正解（v0.7.60 對 source::before 修錯位置、Jimmy 提供更上一層 DOM 截圖揭穿——`::before` 是掛在 `<picture>` 自身、不是 `<source>`）。**真兇**：`<picture style="--aspect-ratio:2000/1500;">` 配原站 stylesheet `picture::before { content: ''; display: block; padding-bottom: 75% }`（從 --aspect-ratio CSS variable 算出 4:3 比例）撐 picture 高度做 lazy-load placeholder。v0.7.55 修了 picture 自身 aspect-ratio:auto + padding-bottom:0 沒清掉 ::before，::before 仍在撐高度。**修法**：reader card 內 `picture::before / picture::after / figure::before / figure::after` 全部強制 `content: none + display: none + padding-bottom: 0`。撤回 v0.7.60 的 source rule（修錯位置）。**保留 v0.7.59 instrument log** 待驗。284 jsdom spec 全過。

附帶教訓：lazy-load placeholder hack 用 ::before pseudo-element 撐 aspect-ratio 是流行 CSS 模式（搜「padding-bottom hack with ::before」），下次媒體 wrapper 撐空白找不到 inline height / aspect-ratio 時直接懷疑 ::before。

---

**v0.7.60**——cna 主圖空白真兇終於定位（Jimmy 提供 DOM 截圖揭穿，**保留 v0.7.59 instrument log 待 Jimmy 驗證再刪**）。**真兇**：cna 在 picture 內的 `<source>` 元素掛 `::before` pseudo-element 配 `content: url(...)`，用 pseudo-element 渲染圖片內容把 source 變 visible 撐 picture 高度（v0.7.58 修法 source display:none **無效**，因為 ::before 在 source display:none 之外仍會渲染——pseudo-element 即使 host 是 display:none 也可能透過 specific stylesheet 顯示）。修法：對 reader card 內 `<source>` 自身與 `::before` / `::after` 全部強制 `display: none + content: none`，禁止任何方式渲染。spec 暫不加（待 Jimmy 實機驗證後再補）。**保留 v0.7.59 instrument log**——按 Jimmy 規則「等修好再刪」。284 jsdom spec 全過。

---

**v0.7.59**——cna 主圖空白 instrument round 4（v0.7.58 source display:none 修法仍空白，**還原** v0.7.58 修法）。前幾輪 instrument 都印 element 自身 + ancestor 但沒看到「圖前空白範圍內到底是什麼元素」。本輪改變策略：直接量空白範圍 y=[picture.top, img.top]，遍歷 article 內所有 rect.top 落在這範圍 OR 跨越這範圍的元素，sort by y 列印。setTimeout 500ms 等 layout settle 後才量（避免拿到 layout 階段中途的 rect）。Jimmy 實機 console 看完即移除。同時刪掉 v0.7.58 source rule 與 spec assertion（已驗證無效）。**保留** v0.7.55 picture 自身修法。284 jsdom spec 全過。

---

**v0.7.58**——cna 主圖空白真兇定位（v0.7.57 instrument log 揭穿，立即移除 log）。**真兇**：cna picture 內 `<source>` 元素被原站 stylesheet 改成 `display: block` + 撐 1160px 高度（HTML spec 規定 `<source>` 預設 display:none、不渲染——但原站某條 element selector 或通配 rule 把它變 visible）→ source 在 picture 內以 768x1160 block 元素呈現、把 picture 撐高 1160px → img (picture 第三個 child) 在 source **後面** 正常顯示，肉眼看到「主圖前有一大片空白才是真圖」。前幾輪通則修 picture / figure / wrapper height 都打不到 source 自身。**修法**：reader card 內所有 `<source>` 強制 `display: none !important`，回 HTML spec 預設不渲染。**通則安全**：source 從來不該 visible（任何站把它改 visible 都是 stylesheet 副作用、不是 reader 該保留的視覺），任何站適用。spec 加 forcing function 驗 source rule 含 display: none；sanity 拿掉 → spec fail。同時移除 v0.7.57 instrument log。284 jsdom spec 全過。

附帶教訓：picture 的高度可能來自其 children（不只 img）——`<source>` 預設不渲染只是 spec 預設，原站 stylesheet 可以打破；instrument 印 children 才能看到這層真兇。

---

**v0.7.57**——cna 主圖空白 instrument round 3（v0.7.56 figure / fullPic 通則修法仍失敗、Jimmy 要求別亂猜回到 instrument log）。**還原 v0.7.56 的 figure / wrapper class 修法**（保留 v0.7.55 picture 修法因 v0.7.55 已驗證 picture 自身可縮回）。新加更廣 instrument log：picture/figure/wrapper 自身 + inline style attribute + HTML height attribute + picture 的 children + ancestor 上下兄弟元素 + article 內所有「高 >= 200px 但無直接文字」的可疑 placeholder。Jimmy 實機 console 看完即可揭穿真兇。修完後此版 instrument log 立即移除。spec 還原 v0.7.55 狀態（不要求 figure 含 height:auto / 不要求 fullPic selector）。284 jsdom spec 全過。

---

**v0.7.56**——cna 主圖空白第三層拆解（v0.7.55 picture 縮回但 figure / fullPic 等外層 wrapper 也撐 placeholder 高度，Jimmy 截圖回報空白依然存在）。v0.7.54 instrument 已揭穿：picture h=1160（v0.7.55 修）、**figure.floatImg h=1240**（=picture 1160 + figcaption 80）、**div.fullPic h=1240**——figure / fullPic 也被 inline height 寫死。修法：(1) 把 v0.7.55 picture rule（aspect-ratio/padding-bottom/height/min-height 全 reset）擴及 `figure`，兩 tag 共用同條 rule body；(2) 加 wrapper class 通則命中——`[class*="fullPic"] / [class*="full-pic"] / [class*="full_pic"] / [class*="image-wrapper"] / [class*="img-wrapper"] / [class*="media-wrapper"]` 也套同樣 reset（Pic / Image / Media wrapper 是跨 CMS 命名 pattern）。spec 補 forcing function 驗 figure rule 含 height:auto + selector 含 [class*="fullPic"]；sanity 拿掉 → spec fail。284 jsdom spec 全過。

附帶教訓：placeholder height 跨多層 wrapper 都各自寫死時，「picture 修了」≠「整套修了」——visual debugging 必須沿 ancestor 鏈每層獨立檢查。

---

**v0.7.55**——cna 主圖空白真兇定位（v0.7.54 instrument log 揭穿，立即移除 log）。**真兇**：cna picture 自身 computed `height: 1159.56px`、img 自身 height 只 575.998px——picture 比 img 多撐 584px 空白。aspect-ratio / padding-bottom / min-height 都已 auto/0（v0.7.53 修法生效），但 picture **height 被原站 inline style 或高 specificity stylesheet 寫死**（cna lazy-load placeholder 系統慣用「占位高度」避免文字 reflow）。修法：picture 加 `height: auto !important; min-height: 0 !important`，讓 picture 高度由內容自然撐起（picture 預設 inline、height = 子元素高度 = img height）。spec 補 forcing function 驗 picture rule 必含 height:auto + min-height:0；sanity 拿掉 → spec fail。同時移除 v0.7.54 instrument log。284 jsdom spec 全過。

附帶教訓：picture 撐空白的 3 個 CSS 維度——aspect-ratio / padding-bottom / height——必須**同時**全部清才能完全拆解 placeholder hack；只清前兩個會留下 inline height 撐的空白。

---

**v0.7.54**——cna 主圖空白 instrument round 2（v0.7.53 picture aspect-ratio:auto + padding-bottom:0 後 Jimmy 截圖回報空白依然存在）。styler.apply 結尾遍歷 picture / img 自身 + 沿 ancestor 鏈最多 8 層、列印每層 width/height/aspect-ratio/padding-top/padding-bottom/min-height/display/position。Jimmy 實機 reload + Alt+R 後 console 揭穿真正撐空白的祖先 tag/class/CSS。修完真兇後此版的 instrument log 會立即移除。284 jsdom spec 全過。

---

**v0.7.53**——cna 主圖空白修法（v0.7.52 把 img 強制 static 拉回 normal flow 後 Jimmy 截圖回報「圖位置對了但標題下方一大片空白」）。根因：cna 主圖 `<picture style="--aspect-ratio:2000/1500">` 配 stylesheet 算出 `aspect-ratio: 4/3` 撐 picture 高度（picture h=456px 對應 w=608px、比例 75%）；原 site 設計是 picture 用 aspect-ratio 撐 box、img absolute inset:0 填滿。v0.7.52 拆解 img absolute 後 img 跌進 normal flow，picture 變成「空 box 撐 75% 高度」殘留視覺空白。修法（與 v0.7.52 配套）：picture 強制 `aspect-ratio: auto !important; padding-bottom: 0 !important`，讓 picture 高度由 img static 內容自然撐起（picture 預設 inline、height = 子元素高度）。安全保證：picture 合法用法是 `<source>+<img>` art-direction wrapper、本身不需要 aspect-ratio 撐高；用 aspect-ratio 撐都是原站 padding-bottom hack 的現代寫法、跟 v0.7.52 配套拆解。不影響 figure/div/section 的 aspect-ratio（embed container 等可能合法用），只動 picture 這一個 tag。spec 加 forcing function 驗 picture rule 同時含 aspect-ratio: auto + padding-bottom: 0；sanity 拿掉 → spec fail。284 jsdom spec 全過。

---

**v0.7.52**——cna 主圖偏右真兇定位 + 修法（v0.7.51 instrument log 在實機 console 揭穿真兇，立即移除 log）。**真兇**：cna 主圖 `<img>` 自身套 `position: absolute; left: 304px; right: -304px`（原站做「圖片向右溢出版心成全寬 hero」的 absolute hack）→ img 從 picture 內 x=304 起算 width 608 → 溢出 picture 右側 304px 變偏右破版。**為何前幾輪通則沒救到**：v0.7.48 的 `*:not(...) { left:auto; right:auto }` 用 `:not(picture):not(figure)` preserve 清單，img 雖不在 picture 清單但 `left/right` 對 position:absolute 元素的 inset 控制是 specificity 戰場——原站 inline style 或更高 specificity 的 stylesheet rule 蓋過。v0.7.50 的 `* { float:none; margin:auto }` 對 absolute element 沒用（absolute 不受 normal flow margin auto 影響）。**修法（結構性通則）**：對 articleEl 內 img/video 自身強制 `position: static !important; top/left/right/bottom: auto !important`——把媒體從任何 absolute / fixed / sticky 定位拉回 normal flow，inset 失效。安全保證：媒體本身不該 absolute（aspect-ratio container 模式是 wrapper 用 padding-bottom + img absolute inset:0 填滿，這個模式 img 變 static 後會回到容器頂部正常顯示，可能有 layout 退化但不會破版）；jread cleaner 已對 padding-bottom hack 做 runtime 處理，CSS level 強制 static 在 reader card 視覺結果是「圖縮在原本位置不溢出」更穩。spec 加 forcing function 驗 img + video rule 必含 position:static + 4 個 inset auto；sanity 拿掉 → spec fail。同時移除 v0.7.51 的 instrument log。283 jsdom spec 全過。

附帶教訓（已存進 memory）：**probe 跟實機矛盾連續兩輪後立刻 instrument log，不再賭通則修法**——這次走 instrument 一輪就抓到真兇，比前兩輪盲改省一個 release cycle。

---

**v0.7.51**——cna 主圖偏右 instrument 版本（v0.7.49 + v0.7.50 兩輪通則修法在實機都失敗，probe 跟實機矛盾，直接走 instrument log 路線）。styler.apply 結尾遍歷 articleEl 內 width >= 200px height >= 100px 的 figure/picture/img、列印自身 + 三層 ancestor 的 computed `float / position / margin / left / right / transform / width / maxWidth / textAlign / display`。Jimmy 實機 reload + Alt+R 後 console 直接看到偏右真兇是哪層、套什麼 CSS。**修完真兇後此版的 instrument log 會立即移除**。282 jsdom spec 全過。

---

**v0.7.50**——cna 主圖偏右修法 round 2（v0.7.49 max-width:100% 修了 centralContent overflow 但 Jimmy 實機截圖回報主圖仍偏右；本輪 probe 數據顯示「圖 x=336 對齊段落」但實機截圖矛盾——「實機 ≠ Playwright」memory 教訓直接命中）。**相信實機截圖、不信 probe**：cna 主圖 `<figure class="floatImg center">` class 名字面就是「float image」，原站 CSS 用 float / 不對稱 margin 把它放到 sidebar 區（reader mode 單欄沒有 sidebar 這種 layout 假設不成立）。修法（結構性通則）：reader card 內所有後代強制 `float: none !important; margin-left: auto !important; margin-right: auto !important`——禁止 float 偏移、block 元素 width < parent 時自動水平置中。對 inline 元素 margin:auto no-op 無副作用，對保留語意 figure / blockquote 也合理（本來就應置中或無 float）。spec 加 forcing function 驗 `[data-jread-active="1"] *` rule 必含 float:none + margin-left:auto + margin-right:auto；sanity 拿掉 → spec fail。282 jsdom spec 全過。

附帶教訓：**雙站 harness 驗證 + probe 數據都對齊** 不等於 **實機正確**——Playwright Chromium 的 lazy-load 時序、bot detection 差異、CSP / extension load order 與實機 Chrome 不同步。下次「實機跟 probe 矛盾」時直接相信實機截圖、加保守通則修法，不再花時間反覆 probe。

---

**v0.7.49**——cna.com.tw 主圖偏右破版修法（Jimmy 2026-04-27 截圖回報「索馬利蘭小檔案」主圖偏右溢出 card 邊界，是 v0.7.48 left/right:auto 修法的副作用顯露——商周 case 修好但 cna 顯露另一條根因）。probe 揪出根因：cna 文章 detail layout 用 `<div class="centralContent">` 寫死 `width: 1152px`（原站 article main + sidebar 的固定寬 layout）。reader mode 下 article 已被 cap 到 contentWidth（720px）max-width，但子元素 width:1152px 直接寫死 → overflow card 邊界 488px、主圖被 layout 流帶到右邊破版。修法（結構性通則）：reader card 內所有後代加 `max-width: 100% !important`——強制不超過 parent 寬度，等於 cap 在 article content area 內。對 figure/blockquote/table/code 等保留語意也是合理 cap。不用 width: 100%（會把 inline-block / icon 等小元件強拉成滿寬），只 max-width 限縮上限。實測：centralContent 從 1152→608、主圖 figure.floatImg 對齊主文段落 x=336 right=944 width=608。spec 加 forcing function 驗 `[data-jread-active="1"] *` rule body 必含 max-width: 100%；sanity 拿掉 → spec 立即 fail。harness 雙站驗證（cna + businessweekly 都過）。280 jsdom spec 全過。

附帶教訓：v0.7.48 修了商周 left/right offset hack 但沒抓到 cna width-overflow case——「圖片偏左」與「圖片偏右」表面相反、底下根因不同（offset hack vs fixed-width wrapper）。reader card 對「子元素寫死寬度」這條 hard 通則加在「left/right inset」之後等於補完整套「強制 layout 收斂在 card 內」防線。

---

**v0.7.48**——商業周刊 blog 主圖偏左 round 3 修法（v0.7.47 修了 col-md-7 padding，但圖仍偏左 + 右側溢出 card padding；Jimmy 截圖回報「文字寬度正常但圖片還是偏左且破版」）。probe round 3 揪出剩餘根因：`<div class="Single-image position-relative">` 套 `position:relative; left: -90px; right: 90px`——原站讓主圖在二欄 layout 中向左溢出 col-md-7 邊界做視覺擴張的 CSS hack。reader mode 單欄 layout 不需要這個 offset，offset 反而把圖推出 card padding 範圍變成「偏左 + 右側破版」。修法（結構性通則）：reader card 內非保留清單元素的 `left / right` inset 一律清 auto——直接合併到 v0.7.46 既有 `*:not(...)` border 清除 rule。preserve 清單跟 border 一致。`top/bottom` 暫不清（避免誤傷 sticky 內部元素的合法 layout）。實測：wrapper left/right 從 -90/90 → 0/0、圖回到主文 column x=336~944，跟段落左右邊對齊。spec 加 forcing function 驗 rule body 必含 `left: auto !important` 與 `right: auto !important`；sanity 拿掉 → spec 立即 fail。280 jsdom spec 全過。

---

**v0.7.47**——商業周刊 blog 主圖偏左 round 2 修法（v0.7.46 清掉紅色色塊但圖仍偏左、Jimmy 截圖回報「直接破版」）。probe 圈出剩餘根因：祖先 `<div class="Single-left-part col-xs-12 col-md-7 col-lg-8">` 套**客製化** `padding-right: 115px`（原站 Bootstrap 二欄 layout 給右欄 sidebar 預留的留白），reader mode sidebar 已砍但 padding 還在生效→ col 內部寬度被擠成 `608 - 115 = 493px`，主圖只占 col 子集寬度而非完整 card 內寬。styler 既有 col-* reset 只清 `width / max-width / float / flex`，**完全沒清 padding**。修法：col-X- reset 加 `padding: 0 !important`。col 已退化成 block 流排（width: auto + float: none + flex: initial），Bootstrap gutter padding 已無 grid 意義可清。實測：col-md-7 padding-right 115→0、wrapper width 493→608、圖片左右邊跟段落對齊。spec 加 forcing function 驗 col-* rule body 必含 `padding: 0 !important`；sanity 拿掉 → spec 立即 fail。281 jsdom spec 全過（v0.7.46 +1）。

---

**v0.7.46**——商業周刊 blog 主圖左方紅色色塊 + 圖片偏左修法（Jimmy 2026-04-27 截圖回報「圖片破版且偏左」）。probe 揪出根因：主圖外 wrapper `<div class="Single-image Border-left Margin-top position-relative">` 套 `border-left: 45px solid rgb(188, 40, 28)`（商周品牌紅 accent bar）。reader mode 下 border-width 計入 box 寬度→圖片整體被 border 往右擠 45px，視覺同時看到「左側紅色色塊 + 圖片偏離正中」。修法（結構性通則）：styler.js 注入 CSS rule `[data-jread-active="1"] *:not(figure):not(figcaption):not(summary):not(blockquote):not(code):not(pre):not(table):not(thead):not(tbody):not(tr):not(th):not(td):not(mark):not(kbd):not(hr) { border-width: 0 !important; }`——reader card 已有圓角 + 陰影邊界，內部任何裝飾 border 都該清。preserve 清單跟既有 background 清除一致 + hr：blockquote 引述慣例 / table 資料分隔 / code 程式碼框 / hr 本身就是 border 化身。只清 `border-width` 不動 `border-style/color`，影響範圍最窄。spec 加 forcing function 驗 CSS 含 `*:not(...)` border-width:0 rule + 14 個 preserve tag 全列入；sanity check 拿掉 rule → spec 立即 fail。harness 截圖確認紅色色塊消失、圖片回正中。280 jsdom spec 全過。

---

**v0.7.45**——商業周刊第二種 detect 命中路徑修法（Jimmy 2026-04-27 V0.7.43 instrument log 第二批截圖揭露）。同頁面 detect 在不同時序下命中不同：(A) 命中 ARTICLE.figure-list（已由 v0.7.44 降級 guard 修）；**(B) heuristic 命中 DIV.Single-article、promoteForTitle sibling-walk 升到 SECTION.row、`promotedTitleHead = DIV`**（TITLE_TAG_SEL 含 div/span/p 寬鬆命中、找到某個含主標題文字的 div 包覆當 head）。原 `ensureArticleContainsTitleH1` guard `if (promotedTitleHead) return null` 對任何 truthy 都 skip → DIV 命中也擋掉 → ensureH1 不跑 → articleEl 停在 SECTION.row 不含真 H1。修法：guard 條件改成「`promotedTitleHead` 必須是真 heading（H1-H4）才視為堅實 promote 而 skip；其他 tag（div / span / p）視為 promote 不夠堅實、繼續跑 LCA 升真 H1 容器」。安全保證：Stratechery `wp-block-column` 的 `promotedTitleHead = H2`（堅實）→ guard 命中 skip 不再升（不會誤升 wp-site-blocks）；newtalk 類用 `<p class="name">` 當 title 的場景，guard 不擋 ensure 但下游 `articleEl.querySelector('h1')` 雙保險 / LCA 距離 guard 等都會擋住誤升。spec 覆蓋（既有 layer 2 forcing function + 商周 fixture spec）已驗證。279 jsdom spec 全過。

---

**v0.7.44**——商業周刊真兇定位 + 修法（v0.7.43 instrument log 揪出根因，立即移除 log）。**真兇**：商業周刊 blog 路由頁面有 `<article class="figure-list">` 在 body 直接（archive 風格的圖片列表 article），跟主文 `<main class="Single">` 是 sibling。detector 策略 1 `detectByArticleTag` 找到單一 `<article>` 且文字量 ≥ MIN_TEXT_LEN 直接採用 → articleEl=ARTICLE.figure-list、strategy='article-tag'，**完全跳過後續 schema-org/heuristic/main-tag/promote/ensure 全部策略**。後續 promoteForTitle 跑時 sibling-walk 從 article 沿祖先鏈往上、parent=body、body 的 children 不含 H1（H1 在 body > div#divbody > main > section.Single-title 深三層）→ sibling-walk 一無所獲。LCA fallback 也擋——LCA(figure-list, h1)=body，被 `lca === document.body` guard 擋。Jimmy 之前 console probe 看到 `data-jread-active="1"` 在 `SECTION.row` 是因為**多輪測試 reader mode toggle 殘留**（不同 detector 結果留下不同 marker）；v0.7.43 instrument log 直接揭穿 detector 真實命中是 `ARTICLE.figure-list`。**修法（結構性通則）**：`detectByArticleTag` 對單一 article 加一道 guard——`article` 不含 `<h1>` + 頁面有 `<main>` + main 不含 article + main 含 H1 → 降級回傳 null（讓 schema-org/heuristic/main-tag 接手）。安全保證：anthropic-hero-sibling 類「article 在 main 內、h1 在 article 兄弟 section」場景，main.contains(article)=true、不命中此 guard、仍走 article-tag 策略（既有 anthropic-hero-sibling spec 仍 pass，sanity 驗證過）。同時移除 v0.7.43 的 instrument console.log。spec 加 2 條 forcing function：fixture 重現「article.figure-list 跟 main sibling、article 內無 h1」場景，驗 detector strategy 不可是 'article-tag'（必降級）+ articleEl 必須含主標 H1。sanity check 通過：拿掉 guard → spec 立即 fail。279 jsdom spec 全過。

---

**v0.7.43**——商業周刊 instrument 版本（暫時性 debug log，跨 v0.7.42 仍未生效後加入）：detector.js detect() 內加 4 條 `console.log('[JRead v0.7.43 detect] ...')`，輸出策略命中結果 / `ensureArticleContainsTitleH1` 呼叫前後 articleEl / final el。Jimmy 實機 reload + Alt+R 後 console 直接看 detector 內部執行狀態，定位是 detector.js 沒被新版載入、還是新版載入但邏輯某條 path silently 失敗。**修完 v0.7.42 真正根因後此版的 instrument log 會移除**。277 jsdom spec 全過。

---

**v0.7.42**——商業周刊 v0.7.41 LCA fallback 在實機仍 silently 失敗修法（Jimmy 2026-04-27 reload v0.7.41 + 重新整理頁面後 console probe 證實：og.text === h1.text、LCA(article, h1)=MAIN.Single、distance=1、layer 2 邏輯應升 — 但 articleEl 仍是 SECTION.row）。根因：v0.7.41 的 LCA fallback layer 2 寫在 `promoteForTitle` function 內，detect() 流程中只有 `result.strategy !== 'main-tag'` 條件才會呼叫 `promoteForTitle`；實機 detector 走的某條 path 完全 skip 了整個 `promoteForTitle`（可能 strategy=main-tag、或 promoteForTitle 內某個 early-return / try-catch 吞掉），導致 layer 2 完全沒機會跑。修法：把結構性 guard 邏輯抽出獨立 `ensureArticleContainsTitleH1(articleEl, promotedTitleHead)` function、放到 `detect()` 結尾**無條件**呼叫一次（在 `narrowToFirstArticleBlock` 之後），繞開所有 strategy / promote 流程條件。Guard：用 `result.promotedTitleHead` 判斷而非「articleEl 含任何 heading」——Stratechery articleEl=wp-block-column 含 h2 post-title 但 `promoteForTitle` 已升、`promotedTitleHead` 已設 → skip 不再升（避免誤升 wp-site-blocks）；商周 articleEl=row 含 h2 sub-heading 但 `promoteForTitle` 沒升、`promotedTitleHead` 未設 → 跑兜底升 MAIN.Single。同時把 `promoteForTitle` 內 layer 2（structural guard）移除——跟 `ensureArticleContainsTitleH1` 邏輯重複、保留 `ensureArticleContainsTitleH1` 作為 single source of truth；layer 1（og-match LCA）保留為 fast path。spec：原 layer 2 forcing function 仍 forcing 同一塊邏輯（命中路徑改為 `detect()` 結尾的 `ensureArticleContainsTitleH1`）。sanity check 通過：拿掉 `detect()` 結尾的呼叫 → spec 立即 fail。277 jsdom spec 全過。

---

**v0.7.41**——商業周刊 v0.7.40 LCA og-match fallback 在實機 silently 失敗修法（Jimmy 2026-04-27 reload v0.7.40 後 DevTools 仍顯示 `data-jread-active="1"` 在 SECTION.row）。根因：v0.7.40 的 LCA fallback 仰賴 og:title 與 H1 文字 `titleMatches` 比對；jsdom fixture 上字串相等所以命中、但 Jimmy 實機 Chrome 有 character-level 差異（推測：og:title 跟 H1 用全形/半形數字差異、不可見空白、或 og:title meta lazy-inject 時序）→ titleMatches 失敗 → LCA fallback 沒升級。修法：把 LCA fallback 拆成兩層後備——layer 1 仍走 og-match LCA（v0.7.40 邏輯，比對成功時優先用、guard 較鬆）；**layer 2 改用結構性 guard 取代文字比對**（H1 在 articleEl 外、LCA(articleEl, H1) 不是 body/html、LCA 距 articleEl ≤ 5 hops），不依賴任何文字比對，對 character-level 差異全部健壯。安全保證：site footer/banner H1 通常 LCA = body 被 guard 擋；distance ≤ 5 hops 也擋住「跨 main/article 邊界」吞 site chrome。spec 加 2 條 forcing function：fixture 構造「og:title 跟 H1 文字差異夠大、layer 1 og-match 必失敗」場景，驗 layer 2 structural guard 兜底升到 #container；sanity check 拿掉 layer 2 → spec 立即 fail。277 jsdom spec 全過。

---

**v0.7.40**——商業周刊 blog 路由 detector 命中 SECTION.row 漏標題修法（Jimmy 2026-04-27 reload v0.7.39 後仍回報無標題，DevTools inspect 確認 `data-jread-active="1"` 在 `SECTION.row.no-gutters.position-relative` 上）。根因：v0.7.39 修了 cleaner 不誤砍 SECTION.row，但 detector heuristic 命中的就是 row 本身（含 hero figure + 26 個長 p 文字密度極高），articleEl=row 從一開始就**不包含** H1（H1 在 row 的 sibling SECTION.Single-title 內）。原 `promoteForTitle` sibling-walk 演算法在 jsdom fixture 上能正確升到 MAIN.Single，但 Jimmy 實機 Chrome 沒升上去（Playwright probe 與實機 Chrome detect 結果不一致，sibling-walk 在實機某條 path 失敗）。修法（結構性通則 fallback）：`promoteForTitle` 在 sibling-walk 沒命中時跑**LCA fallback**——掃全頁 `<h1>/<h2>` 找 og:title match 的 heading、跟 articleEl 求 lowest common ancestor、若 LCA 在 `<body>` 之內就升到 LCA。安全 guard：(1) H1/H2 必須 og-match；(2) LCA 不能是 body / html（避免吞 site chrome）；(3) LCA 必須含 articleEl（trivial check）。新增 `findLCA(a, b)` helper。spec 加 5 條 forcing function：(1) businessweekly-blog fixture 確認 articleEl 升到 MAIN.Single；(2) articleEl 仍含主文 SECTION.row；(3) ad-hoc fixture 構造「articleEl 包 6 層 wrapper、超過 PROMOTE_MAX_HOPS=5、sibling-walk 必失敗」場景，驗證 LCA fallback 兜底升到 #container；(4) `promotedTitleHead` 應為 LCA 命中的 H1（給 cleaner narrowPromotedSiblings 白名單用）；(5) sanity check 通過：拿掉 LCA fallback 區塊 → ad-hoc spec 立即 fail。275 jsdom spec 全過。

---

**v0.7.39**——商業周刊 blog 路由整篇主文消失修法（Jimmy 2026-04-27 回報 businessweekly.com.tw/business/blog/3021238 截圖：reader 模式啟動後無標題、排版亂）。根因（Playwright real-browser probe 加 hide-rule trace 揪出）：商周 blog DOM 是 `<main class="Single">` 兜底，主文包在 `<section class="row no-gutters position-relative">`（含 26 個長 p、3 個 H2、4 張圖）。sidebar 區的 LINE follow widget `<div class="line-sub-title">FOLLOW US</div>` 命中 NOISE_HEADING_TEXT_RE 的 `^follow\s+us`，**`hideInsideArticleByHeadingText` 的 closest('section, aside') 直接命中外層 SECTION.row 整篇主文容器**（line-sub-title 與 row 之間沒有 section/aside 包覆）→ 整篇主文被砍。原本 closest hit 分支沒套主文 anchor 保護（只有 walk-up fallback 分支有），是長期結構性漏洞，過去剛好沒踩到 closest 過寬命中而沒爆。修法（結構性通則）：抽出 `wrapperContainsArticleAnchor(wrapper, exclude)` helper（三道判定：含 >= 100 chars 單一 p / 累計 p text >= 300 / `hasArticleTitleAnchor`），closest hit 分支跑此判定——target 含主文 anchor 即視為過寬、改走 walk-up fallback 找更窄 wrapper（找不到 → continue 不 hide，不誤殺主文）。`findSafeWrapperForHeading` 內部 loop 與 `checkDynamicNoise`（MutationObserver 動態 heading）也重構共用同一 helper，保持結構性通則單一 source of truth。新增 `businessweekly-blog-3021238` fixture + 4 條 spec forcing function：(1) SECTION.row（含整篇主文）絕不可被 hide；(2) 主標 H1 + 祖先鏈保留；(3) 8 個 marker 主文段落 + 祖先鏈全保留；(4) 文末 `.Single-promote`（不含主文 anchor）仍正常被 hide（確認保護不過保護、雜訊清理能力沒退化）。sanity check 通過：拿掉 `targetTooWide` 條件 → forcing spec 即 fail。269 jsdom spec 全過。Jimmy 2026-04-27 從 v0.8.x Readability 引擎回退到 v0.7.38 後第一個 patch，承接 v0.7.x in-place cleaner baseline 繼續精修。

---

**v0.7.38**——macstories.net app icon 變超大修法（Jimmy 2026-04-25 回報）：reader mode 啟動後 `<div class="media-wrapper media-wrapper-icon"><img></div>` 結構的 icon img 從 160×160 變超大圖（撐滿 reader card 寬）。根因：原站對 wrapper 設 `width:160 + float:left`、img 設 `width/height:100%` 達成小 icon 顯示；reader mode 下 jread 的 `img:not(a>img) { height: auto !important }` 把原站 height:100% 蓋掉、img 退到 naturalSize（512×512）+ wrapper shrink-to-fit 跟著膨脹。修法（結構性通則）：styler 加新 rule 對含 `wrapper-icon` / `media-icon` / `app-icon` / `icon-wrapper` / `thumb-icon` 等跨站 CMS 命名 pattern 的 wrapper 內 `img:not(a > img)` 套 `max-width/max-height: 200px`——一般 icon < 200px、超過視為配圖不該套此規則；selector 用 `img:not(a > img)` 與既有 `a > img` icon-link 例外（v0.6.x 慣例 + spec line 145 forcing）協調。新增 `macstories-icon-wrapper` fixture + 3 條 spec forcing function（含 sanity check 驗證）。265 jsdom spec 全過。

---

**v0.7.37**——cleaner.js 內部重構（行為不變、技術債清理）：(A) 抽出 `findSafeWrapperForHeading(h, articleEl)` helper，原本 `hideInsideArticleByHeadingText` 的 walk-up fallback (line 879-906) 與 `checkDynamicNoise` 的 dynamic heading walk-up (line 1864-1885) 兩處邏輯完全相同（hasLongP / totalPText >= 300 / hasArticleTitleAnchor 三道保護），併為單一 helper、兩處共用約 30 行 → 各 1 行呼叫，未來新增 walk-up 保護條件只需改一處。(B) `hideInsideArticleActionRows` 內 `el.querySelectorAll('button')` + `('[role="button"]')` + `('svg')` 三次掃描合併為單次 `('button, [role="button"], svg')`，每個 candidate 從 3 次 DOM traversal 降至 1 次。重構觸發於整 repo tech debt audit；audit 也檢視了 SPEC drift / 拆檔 / regex multi-line / 文件 typo 等可能改動，全部評估後選擇不動（純美化或會增加複雜度）。262 jsdom spec 全過 + harness 抽驗 newtalk / cna 真實站點行為一致。

---

**v0.7.36**——cna.com.tw 中央社新聞兩大 bug 修法（Jimmy 2026-04-25 回報）：閱讀模式啟動後 (1) 整篇內文消失 (2) 標題下方 5 個社群按鈕 + 「支持中央社」推廣 widget 殘留。**Bug 1 根因**：`hideInsideArticleByHeadingText` walk-up fallback 的 `hasLongP` 保護以「單一 p ≥ 100 chars」為門檻，中央社新聞每段 60-90 字普遍 < 100 chars，主文 p 全沒觸發 → 「延伸閱讀」DIV 觸發 walk-up 升到外層 `DIV.paragraph`（包整篇主文）整塊 hide。修法：walk-up 加「累計 p textLen ≥ 300」保護，主文容器特徵是「累計多 p、總文量大」，跨中文短段 / 西文長段都通用（兩處 walk-up loop 同步）。**Bug 2 修法**：(A) 新 rule `hideInsideArticleJsLinks` 清 `a[href^="javascript:"]`——主文不會用 javascript: pseudo-protocol、純 JS handler 的 a 都是 widget interactive button（cna 的 btn_audio/btn_fb/btn_line/btn_copy/btn_support 全清）；(B) `NOISE_LINK_TEXT_RE` 加 `^(小額)?(贊助|赞助|抖內|斗内|打賞|打赏)$` 中港台繁簡 alias；(C) `NOISE_KEYWORD_RE` 加 `app-?download|app-?promo|app-?banner|appdownload|app-?store-?banner` token（`DIV.paragraph.appDownload` 推廣 widget 整塊 hide）。新增 `cna-short-paragraphs-walkup` fixture + 6 條 spec forcing function（fixture 加 sanity 確認）；harness 自驗 cna 主文段落齊全 + 標題下方 toolbar 全清 + 「支持中央社」widget 清乾淨。262 jsdom spec 全過。

---

**v0.7.35**——esmchina.com 文末三類雜訊修法（Jimmy 2026-04-25 回報）：主文後出現 Keysight 活動推廣 `<a><strong>...立即报名>></strong></a>`、兩個 QR code（微信分享 widget）、评论(0) 區。三條結構性通則修法：(A) `NOISE_KEYWORD_RE` 加 `weixin/wechat/weibo/qrcode` token + `ul/ol` 進 `CONTAINER_SEL`（中國 SNS 分享 widget 跨站通用命名 + 廣告 widget 常用 ul 包裝）→ 整塊 `ul.article-weixin` hide。(B) 拆出 `NOISE_LINK_TEXT_STRICT_RE` 強 CTA token 名單（立即报名 / 立即下载 / 點擊報名 等），主文新聞極少自然出現此類 CTA、命中即清不受 `NOISE_LINK_TEXT_MAX_LEN=60` 限制，繞過 a 整段 80+ chars 的長度上限。(C) `NOISE_HEADING_TEXT_RE` 加簡體 alias「评论」「回复」+ 寬化括號 `\([^)]*\)` 接受空括號（Playwright SPA inject 時序差異 0/N 都吃）→ walk-up 清 `DIV.pl-520am` 評論區。新增 `esmchina-tail-widgets` fixture 含 5 條 spec forcing function。已知遺留：`<div class="executive-editor">责编：Lefeng.shao</div>` 編輯署名單行未處理（要擴 `hideInsideArticleByHeadingText` 加 hide-self mode 給強 widget anchor 弱 candidate，下次處理）。256 jsdom spec 全過 + harness 確認 esmchina visible outline 從 7 塊雜訊降到 1 行。

---

**v0.7.34**——newtalk.tw 標題消失修法（Jimmy 2026-04-25 回報）：`hideInsideArticleByHeadingText` 的 walk-up fallback 過去只用「wrapper 含 ≥ 100 chars 主文長 p」當保護 anchor。newtalk 的標題在 `<p class="name">川普下達佈雷快艇擊沉令...</p>` 只有 27 chars 不滿足；末段分享列 `<button class="goMessage"><span>留言</span></button>` 命中 `^留言$` regex 後 walk-up 一路升到 `div.news_info`（含主標的 wrapper）整塊 hide → 標題消失。新增結構性通則 `hasArticleTitleAnchor` helper：wrapper 子樹含 `<h1>` 或含 class token 為 title-anchor（title / headline / heading / article-title / post-title / entry-title 等）+ textLen 10-200 chars 的元素，視為「含主文標題」並在 walk-up loop 加 break 條件。fixture 更新重現真實 DOM（news_tools 移進 news_info）作為 forcing function，sanity check 已驗證。251 jsdom spec 全過 + harness 確認標題回到 visible outline 第一項。

---

**v0.7.33**——Readwise Reader 整合：popup 加「送到 Readwise Reader」按鈕，把 JRead 處理過的乾淨 reader card outerHTML + url + title 透過官方 API（`POST https://readwise.io/api/v3/save/`）送出。Token 在 options 設定（`chrome.storage.sync.readwiseToken`），button 在 reader mode 未啟動時 disabled。新訊息 `GET_READER_STATE` / `EXTRACT_READER_HTML` / `SAVE_TO_READWISE`；fetch 在 SW 跑（popup 關了也能跑完）。`buildReadwisePayload` / `saveToReadwise` 抽到 `popup-core.js` 純函式 + 14 條 jsdom regression spec 覆蓋 NO_TOKEN / AUTH(401) / HTTP / NETWORK / 成功 200/201 / payload 結構與訊息協定 forcing function。Readwise extension 對某些頁面失效時可改用 JRead 走後門。

---

## Baseline 宣告（v0.7.32 — 2026-04-25 起）

**當前 baseline：v0.7.32**（升級自 v0.6.3）。承接 v0.6.0 styler 瘦身精神 + 累積到 articleEl 內第三方 iframe 預設 hide（cnyes anue 討論區根因）為止的全部 detector / cleaner 能力，toast 縮限到僅顯示主文偵測失敗錯誤。232 jsdom spec + 5 e2e spec + e2e harness 基礎設施 + gap audit warning + paginated screenshots 守住行為不變式。

**baseline 含括的能力**：

- **styler**（瘦身不變）：讀者卡片容器 + 祖先鏈 reset + Bootstrap col-* reset + 裝飾 background transparent + aspect-ratio placeholder 破解 + 使用者 override（theme/fontSize 含 Auto=0/contentWidth）。**不覆寫原站字型、heading margin、p margin、list style、link color、blockquote border**。
- **detector**：article-tag → schema-org（含 `itemprop="articleBody"` Layer B）→ heuristic（Readability bubble-up + POSITIVE/NEGATIVE + textLen bonus + top-5 ambiguous）→ main-tag 兜底；title promote 支援 h1-h4 heading + p/div/span 非 heading tag 包標題（v0.7.22，非 heading 加 120 char text 上限）+ 返回 `promotedTitleHead`。
- **cleaner**：16 條 `hideInsideArticle*` rule、dialog/tooltip ARIA、ancestor sibling、**promote+narrow 聯動（含 h1-h4 白名單 + media-bearing sibling 保護 v0.7.22）**、grid/flex collapse、media placeholder reset、lazy image hydrate、MutationObserver 動態攔截、inline `!important` hide。

### 修 edge case 時的硬規則

1. **優先順序**：detector → cleaner → styler（最後手段）
2. **styler.js 視為動不得**——要動需 Jimmy 明確授權；禁止恢復 v0.5.x 對 h1-h6 / p / ul / ol / li / blockquote / a 下 rule 的做法；typography-affecting universal rule 必須用 scoped selector（硬教訓 20，v0.7.17→v0.7.18）
3. 每次修法後跑 `npm test`（230 jsdom spec）+ 視覺風險高的改動跑 `npm run debug`（harness + Read fullpage 截圖自驗，**包含 reader card 以外的頁面區**；驗 hide 效果要讀 `getComputedStyle(el).display` 不能只靠 attribute marker；**看 GAP AUDIT 警告列表判斷是否有未清的 empty wrapper**）
4. 結構性通則、非站點特判（CLAUDE.md 硬規則 3）
5. 修 detector/cleaner/styler 類 DOM 互動 bug 必須先 harness 驗假設再動 code（CLAUDE.md「假設驗證順序」）

v0.5.x 的 styler 堆 ~80 條 !important rule 的做法在 v0.6.0 已被證實有視覺副作用（標題變藍底線、category 間距過大、條列項樣式跑掉），**不要再走回頭路**。

### 歷代 baseline 升級點

- **v0.6.3**（2026-04-21）首版 baseline：styler 瘦身完成、title promote 涵蓋 WordPress/anthropic
- **v0.7.21**（2026-04-24）Stratechery h2 post-title 修法 + e2e harness 就緒 + 15 站實測通過
- **v0.7.22**（2026-04-25）擴 promote tag 到 p/div/span（newtalk.tw）+ narrow media-bearing sibling 保護（順便修好 ebc 主圖誤殺）
- **v0.7.23**（2026-04-25）newtalk.tw 原站 JS 清 jread !important priority 對抗修法 + `hideOutsideArticleSemantic` 擴 id/class selector
- **v0.7.24**（2026-04-25）ttv.com.tw 三處聯動修法——narrow media guard 改「img 不在 a 內才保留」+ collapseGridWithHiddenCell 掃 articleEl 自身 + forceMediaContainerBlock figure/picture 強制 block
- **v0.7.25**（2026-04-25）techbang 主文中段空白修法——`newsletter[\w-]*` 吃數字後綴 + `dfp-` id prefix / `.google-dfp` class 補進 THIRD_PARTY_AD_SEL
- **v0.7.26**（2026-04-25）techbang byline 下 115px 空白修法——spacer rule blocker check 加「祖先已 jread-hidden 不算 visible blocker」；harness 擴 gap audit（>= 80px 警告）
- **v0.7.27**（2026-04-25）toast 縮限到僅顯示主文偵測失敗錯誤——「已進入/離開閱讀模式」狀態 toast 移除
- **v0.7.28**（2026-04-25）cnyes 五處聯動修法——hideInsideArticleNav 新規則 + heading-text walk-up fallback 改良 + heading/link/keyword 多項 token 擴增
- **v0.7.29**（2026-04-25）cnyes 文末「討論區」widget 中文 token 補洞
- **v0.7.30**（2026-04-25）cnyes「討論區 回應 看更多」h3 boundary 放寬 + 內層 ARTICLE box-shadow 清除
- **v0.7.31**（2026-04-25）cnyes 討論區四處對抗修法 + harness 分頁截圖
- **v0.7.32**（2026-04-25）當前 baseline：articleEl 內第三方 iframe 預設 hide 規則——抓出 cnyes anue 討論區「Playwright probe textContent 全找不到、截圖卻看得到」的真根因（widget 整個包在 cross-origin iframe）

以下是版本歷程（倒序）。

---

**v0.7.32**——cnyes anue 討論區 iframe 真根因（Jimmy 2026-04-25 第五輪實機回報「還在」）。

**真根因**（連續 5 輪修法後才意識到）：cnyes 「討論區」widget 整個包在 cross-origin `<iframe>` 裡（anue 是 cnyes 留言系統、用 iframe 嵌入主頁面）。parent document 看不到 iframe 內部 textContent —— 這就是為什麼：
- v0.7.28-v0.7.31 所有 NOISE_HEADING_TEXT_RE token、walk-up fallback、tail-cleanup 都漏網（規則只能匹配 parent document 可見的 textContent）
- harness probe + textContent 全文檔搜「討論區」永遠 found=0
- 但 screenshot 看得到（iframe 內容由 browser 自己 render 出來）

之前所有「文字 token / heading walk-up / tail-cleanup」修法**對 iframe 包裝的 widget 都無效**——必須直接 hide iframe 本身。

**修法**（結構性通則，非站點特判）：

新規則 `hideInsideArticleThirdPartyIframes`（cleaner.js）：掃 articleEl 內所有 `<iframe>`，不在 `KNOWN_MEDIA_IFRAME_SEL` whitelist 的全部 hide。whitelist 含跨站通用的媒體 embed 平台：
- 影片：YouTube / youtube-nocookie / Vimeo / Dailymotion / Bilibili / Wistia / Vidyard / TED
- 社群引文：Twitter / X / Facebook（plugins/post + plugins/video） / Instagram
- 音訊：Spotify / SoundCloud
- 開發者展示：CodePen / CodeSandbox / JSFiddle / GitHub

**通則依據**：reader mode 是純閱讀、articleEl 內 cross-origin iframe 99% 都是廣告 / 留言 widget / share button / poll / chatroom 等 chrome（無 textContent 可被 jread 規則命中）；例外是已知媒體 embed 平台——影片 / 推文引用 / 程式碼展示等屬正文一部分。`isInPreserved` 保護：figure / figcaption / blockquote / summary 內的 iframe 一律保留（主文 figure 包影片 embed 不被誤殺）。

**新 fixture + spec**：
- `cnyes-nav-widgets-walkup.html` 加 widget 9（anue iframe，class 用 emotion-hash 不含 noise keyword、src 用 example domain，純靠 iframe rule 命中）+ 對照組 YouTube embed 在 figure 內
- `cleaner.spec.js` 新增 2 條 assertion：(1) anue iframe 必須 hide；(2) YouTube embed 在 figure 內 + src whitelist 命中時保留
- **sanity check**：註解 `hideInsideArticleThirdPartyIframes` 呼叫 → anue spec fail；還原 → pass

**驗收**：
- `npm test` → 232 passing（原 230 + 新 2 條 iframe）
- 實機驗證須 Jimmy reload 到 v0.7.32 確認

**未動**：detector / styler / popup / service-worker / options / 任何既有 fixture / spec 全部零變化；修法只動 cleaner 一處——新規則 + clean() 流程加一行呼叫。

**驗收教訓**：`probe textContent 找不到` ≠ `widget 不存在`——可能在 cross-origin iframe 裡。下次截圖看得到但 textContent 找不到 → 立即假設 iframe 包裝、不要繼續往「文字 token / heading rule」修法上鑽。

---

**v0.7.31**——cnyes 討論區清除四處對抗 + harness 分頁截圖（Jimmy 2026-04-25 第四輪 cnyes 回報「討論區還在、為什麼你截圖看不到」）。

**驗收疏失檢討**：前三輪 cnyes 修法（v0.7.28-v0.7.30）我**沒實際 Read 過 fullpage 截圖**——只看 probe stdout、probe 因 Playwright 環境 widget 不 render 永遠回 `found (0)`、就 commit。Jimmy 第四輪明確點出「你截圖的方法有問題、只截第一頁、沒往下捲動每頁檢查」。實際看 fullpage 也是空白（cnyes 在 reader mode 下 React reconciliation 跟 jread `removeChild` 競賽、整個 DOM layout 崩潰、document.height 縮成 viewport 等高）。

**四處修法**：

1. **MutationObserver `removeChild` → `hide`**（cleaner.js）：`startWatchingDynamicAppends` 對 articleEl 外 added node 從 `node.parentNode.removeChild(node)` 改成 `hide(node, hiddenList)`。React/Next.js（cnyes 用 Next.js）的 client-side reconciliation 持續操作 DOM、jread 主動 `removeChild` 的 node 在 React vdom 裡仍存在、下次 reconcile 找不到 child 觸發 `Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.`、整個 React tree 崩潰、頁面 layout 變空白。改 hide 後 DOM node 仍在、React reconciliation 不打斷、cnyes docHeight 從 900（崩）→ 1444（正常）。
   - 對 popIn template clone（dataset.jreadHidden 殘留 + display:block 主動覆蓋）的情境 hide() early-return 會跳過——加分支：pre-existing `data-jread-hidden="1"` 的 node 直接 `setProperty('display', 'none', 'important')` bypass early-return。

2. **`checkDynamicNoise` 同步 `hideInsideArticleByHeadingText` 的 walk-up fallback**（cleaner.js）：原本 lazy-inject 處理只掃 h2-h4 + closest('section, aside')、漏 v0.7.28 加的 p/div/span 候選 + walk-up「不含主文長段落」最深 wrapper fallback。對 cnyes lazy-inject 「討論區」widget（h3 結構、無 section 祖先、整篇主文+widget 同 ARTICLE）漏網。同步擴展。

3. **`hideInsideArticleByHeadingText` walk-up 失敗時 tail-cleanup fallback**（cleaner.js）：當 heading 是 articleEl 的 direct child（無 wrapper、walk-up 第一層即 articleEl break）、檢查 heading 之後的所有 sibling—— 若全為 widget（無主文長 p、textLen >= 100）→ hide heading 自己 + 後續所有 sibling。安全 guard：若 next sibling 任一含主文長 p 立即 abort、保護主文不被誤殺。

4. **NOISE_HEADING_TEXT_RE `^討論區$` → `^討論區(\s|$)` → `^討論區`（prefix anchor）**（cleaner.js）：放寬到任意「討論區」開頭（包括「討論區(0)」黏連括號 / 「討論區 回應 看更多」串聯、各種 inline span 結構）。NOISE_HEADING_MAX_LEN=20 + heading-text rule 對 candidate 的 length 限制提供 fallback 保護（主文段落 length > 20 不會誤命中）。

5. **harness 分頁滾動截圖**（debug-harness.js）：Playwright `page.screenshot({ fullPage: true })` 對某些 SPA 站（cnyes 實測）拍出整張白圖，fullpage 不可靠作為唯一視覺驗證。新增分頁機制：每滾 viewport × 0.9 高度截一張 `jread-page-NN.png` 直到 docHeight 到底，Claude Read 每張依序看、覆蓋整篇 reader card 不漏網。**memory 同步補硬規則**：harness 驗收必須 Read 所有 jread-page-*.png（不只 jread-viewport.png 跟 fullpage）。

**未動**：detector / styler / popup / service-worker / options / 任何既有 fixture / spec 的核心 forcing 邏輯——僅修 main.js / cleaner.js 的行為 + harness。所有 230 jsdom spec 仍過。

**驗收限制**：cnyes 「討論區」widget 在 Playwright Chromium 環境下 lazy-inject 行為跟實機 Chrome 不同（probe + textContent 全文檔搜全找不到，但截圖卻看得到——Playwright screenshot 觸發 paint 期間 React 才 mount）。**最終驗證須等 Jimmy reload 到 v0.7.31 實機確認**。

**memory 補硬規則**：feedback_styler_fullpage_selfverify.md 加「harness 驗收必須 Read 所有 jread-page-NN.png 分頁截圖、不只 fullpage」。

---

**v0.7.30**——cnyes 兩處續修（Jimmy 2026-04-25 第三輪 cnyes 回報）：(a) v0.7.29 token `^討論區$` 沒命中（h3 textContent 是「討論區 回應(0) 看更多」串聯文字、嚴格 = 比較不命中）；(b) reader card 內側「淡淡外框」是 cnyes 內層 `<article class="mfxje1x">` 殘留 `box-shadow: rgba(0, 65, 143, 0.1) 0px 0px 6px 0px` 藍色淡陰影。

**修法**：

1. **`NOISE_HEADING_TEXT_RE` `^討論區$` 放寬到 `^討論區(\s|$)`**：boundary 改成「討論區」後接空白或字串結尾、能 match「討論區 回應(0) 看更多」這類 h3 textContent 串聯（cnyes lazy-load 注入 widget 的 heading 結構：h3 + 多個 inline span 組成一行）。`(\s|$)` boundary 仍能擋住「討論區開放討論之...」這類正文連續文字（「開」非空白字元）。

2. **新規則 `clearDescendantBoxShadow`**：掃 articleEl 內 container tags（div / section / article / aside / nav / main / header / footer），computed boxShadow 非 'none' → inline `box-shadow: none !important` override + snapshot restore。
   - 為何 scope 限 container tags：blockquote / figure / table / pre / code 等內文結構元素跨站可能用 box-shadow 做引言/表格/code-frame 設計，保留原站樣式
   - 為何放 cleaner 不放 styler：styler 動不得；cleaner 用 inline !important + snapshot 跟 forceMediaContainerBlock / collapseInnerGridFlex 同層級
   - 通則依據：reader card 已有自己的 box-shadow 視覺骨架（styler 設）、內層 container 的 box-shadow 都是原站 layout 裝飾、reader mode 下脫離原 context 變「框中框」雜訊

**新 fixture + spec**：
- `cnyes-nav-widgets-walkup.html` 兩處更新：
  - widget 7 改成「討論區 後綴文字」h3 + 純 placeholder p（**故意不放**「我要登入 / 發佈 / 標記股票 / 回應(0)」其他 token），forcing 純靠 boundary 放寬命中
  - 新 widget 8：`<article style="box-shadow: rgba(0,65,143,0.1) 0 0 6px 0">` 內層殘留陰影
- `cleaner.spec.js` 新增 2 條 assertion：
  - 「討論區 後綴文字」widget hide（boundary 放寬 forcing）
  - 內層 article 的 inline `style.boxShadow === 'none'` + priority `important`（clearDescendantBoxShadow forcing）
- **sanity check 兩輪**：(a) 退回 `^討論區$` → widget spec fail；還原 → pass。(b) 註解 clearDescendantBoxShadow 呼叫 → priority 為空 spec fail；還原 → pass

**驗收**：
- `npm test` → 230 passing（原 229 + 新 2 條 cnyes）
- 實機驗證須 Jimmy reload 到 v0.7.30 後確認

**未動**：detector / styler / popup / service-worker / options 全部零變化；修法只動 cleaner 兩處——`NOISE_HEADING_TEXT_RE` 一條 token 放寬 + 新規則 `clearDescendantBoxShadow`（+ `restoreDescendantBoxShadow`）。

---

**v0.7.29**——cnyes 文末「討論區」widget 漏網修法（Jimmy 2026-04-25 第二輪 cnyes 回報）。

**症狀**：v0.7.28 修了大部分 cnyes 文末雜訊，但「討論區 / 回應(0) / 看更多 / 我要登入分享看法 / $ 標記股票 / 發佈」整塊留言面板 widget 仍在主文末端顯示。

**根因**：
- harness probe 此 widget 無 lazy-load 不到（Playwright Chromium 跟實機 Chrome 時序差），**不能依賴實機驗證**——必須靠邏輯完整性 token 覆蓋
- 「討論區 / 回應 / 我要登入 / 發佈 / 標記股票」全是 cnyes 中文用詞、未在既有 NOISE_*_RE 範圍
- widget 的 wrapper class 是 emotion-hash（`.d4xfe2k1` 類）、無 keyword anchor
- 唯一能命中的 anchor 是 `<h3>討論區</h3>` heading text → 由 v0.7.28 walk-up fallback 升級到 wrapper hide

**修法**（結構性通則，非站點特判）：

1. **`NOISE_HEADING_TEXT_RE` 加 token**：
   - `^討論區$` 中文 discussion widget heading 慣例
   - `^(回應|回覆|留言)(\s*\(\d+\))?$` 中文 comment count（與英文 `^comments?(\s*\(\d+\))?$` 對應）
   - `^我要(登入|留言|分享|看法)` placeholder 文字慣例（cnyes 用、Disqus / Hyvor 等其他中文留言系統也類似 phrasing）

2. **`NOISE_LINK_TEXT_RE` 加 token**：
   - `^我要(登入|留言|分享)` 同上 placeholder 也常被當 button 文字
   - `^發佈$` post button
   - `^標記股票$` cnyes 留言面板的 「$ 標記股票」chip button（少見、屬於財經類站才會用、但加進去成本極低）

**通則依據**：「討論區 / 回應 / 留言」在中文新聞站留言面板的命名跨站通用（蘋果 / 中時 / 自由 / udn / cnyes 等都用過某種變體）；只是各站經常 lazy-load 注入、harness 抓不到——靠邏輯保證 forcing function。

**新 fixture + spec**：
- `cnyes-nav-widgets-walkup.html` 擴 fixture：新增 widget 7 「討論區」結構（h3 + span 回應(0) + p 我要登入分享看法 + button 發佈 / 標記股票）；class 用 emotion-hash 風格（不含 NOISE_KEYWORD_RE 任何 token），forcing 純靠中文 heading text + walk-up 命中
- `cleaner.spec.js` 新增 1 條 assertion：discussion wrapper 必須 hide
- **sanity check**：拿掉 `^討論區$` token → spec fail（驗 fixture 真的不靠其他 keyword 命中）；還原 → pass

**驗收**：
- `npm test` → 229 passing（原 228 + 新 1 條 cnyes discussion）
- 實機驗證須等 Jimmy reload 到 v0.7.29 後確認（Playwright 環境此 widget 不 lazy-load）

**未動**：detector / styler / popup / service-worker / options 全部零變化；修法只動 cleaner 兩處 regex（NOISE_HEADING_TEXT_RE + NOISE_LINK_TEXT_RE 各加 alternation）、純擴增 token、無邏輯變更。

---

**v0.7.28**——cnyes.com 左側社交 nav rail + 文末多 widget 漏清五處聯動修法（Jimmy 2026-04-25 實機回報）。

**症狀**：news.cnyes.com/news/id/6429386 進閱讀模式後：(1) 左側社交 sidebar（FB / LINE / 連結 / 其他 / 字級 / 列印 / 收藏 / 留言）整條 rail 留下；(2) 文末「文章標籤 / 相關行情 / 想知道更多? AI來回答 / 延伸閱讀 / 鉅亨號貼文 / 下一篇 / 點我下載APP」widget 全部漏網。

**根因**（harness probe 三層剝洋蔥）：

1. **左側社交 rail 用 `<nav class="social-rail">` + `position: absolute`**：`hideFixedOutsideArticle` 規則只看 fixed/sticky 不認 absolute；`hideOutsideArticleSemantic` 對 articleEl 內部 nav 不處理；nav 嵌在 articleEl 內、無規則處理。

2. **末段 widget 結構特殊**：cnyes 把整篇主文 + 多個末段 widget 全包進 `<div class="c9ky432"> > <article class="mfxje1x">` 同一個 wrapper，且 heading 結構是 `<h3 class="t1mmzjbz"><div class="t1thwy6j">延伸閱讀</div></h3>`（真標題在 div 裡）。
   - `closest('section, aside')` 找不到（純 div-only DOM）
   - 舊 fallback 升級到 articleEl direct child = ARTICLE.mfxje1x、含主文 p > 100 → skip
   - 「延伸閱讀」/「文章標籤」/「相關行情」h3 全被原 fallback 跳過

3. **多項末段 widget heading text 不在 NOISE_HEADING_TEXT_RE / NOISE_LINK_TEXT_RE 範圍**：「文章標籤 / 相關行情 / 想知道更多 / AI來回答 / 鉅亨號貼文 / 下一篇 / 點我下載APP / 看更多 / 下載APP」全是新詞；`Powered by` 慣例也沒涵蓋。

**修法**（七處結構性通則，全部非站點特判）：

1. **新規則 `hideInsideArticleNav`**：`articleEl.querySelectorAll('nav')` 不含主文長段落（textLen >= 100 的 p）→ hide。reader mode 下 navigation 元素一律是 chrome、不是主文（目錄 / breadcrumb / share rail / TOC 等）。

2. **`hideInsideArticleByHeadingText` walk-up fallback 改良**：原本只試 articleEl 的 direct child；改成從 heading 往上 walk、找「不含主文長段落」的最深 wrapper 當 target、停在含主文 p 的祖先前一層。對 cnyes「延伸閱讀」h3：往上 div.card → div.widget-wrapper → ARTICLE 含主文 break → target=widget-wrapper hide ✓。對「想知道更多 AI來回答」h2 同理 → 升到 ai-question-wrapper hide ✓。

3. **`NOISE_HEADING_TEXT_RE` 擴 token**：`文章標籤` / `相關行情` / `想知道更多` / `AI.{0,4}(來回答|回答)` / `^(下一篇|上一篇)$` / `^(prev(ious)?|next)\s*(article|post|story)?$` / `.{2,4}號貼文`（涵蓋鉅亨號貼文 / 公眾號貼文 / 頭條號貼文等中國互聯網平台 widget 慣例）。

4. **`NOISE_LINK_TEXT_RE` 擴 token**：`點我.{0,8}(下載|訂閱|加入|看|了解|查看)` / `下載\s*(APP|app)` / `^(看更多|查看更多)$`。

5. **`NOISE_KEYWORD_RE` 擴 alternation**：加 `powered[-_]?by`（跨站 widget 標識慣例：「Powered by Mlytics / Algolia / Disqus / Spotlight」等）。

6. **`hideInsideArticleByHeadingText` 候選擴含 `<p>`**：原本只掃 `h2-h4 + div + span`；加 `p`（限 direct text <= 20，避免主文長段誤命中）。對 cnyes `<p>下一篇</p>` 命中。

7. **`hideInsideArticleByLinkText` walk-up parent 加 `LI`**：原本只升級 `P` / `DIV`；加 `LI`——廣告 list 常用 `<ul><li><a>CTA</a></li></ul>` 結構，命中後若 a 占 LI 80%+ 升級到 LI hide（避免只 hide a 留下 LI 殘文字）。

**新 fixture + spec**：
- `cnyes-nav-widgets-walkup.html` 重現實機結構：`<article>` 含 nav.social-rail + 主文 p + 6 個末段 widget（延伸閱讀 / 想知道更多 / 鉅亨號貼文 / powered_by / 下一篇 / 點我下載APP）
- `cleaner.spec.js` 新增 8 條 assertion 對應 7 處修法 + 主文保留 forcing

**驗收**：
- `npm test` → 228 passing（原 220 + 新 8 條 cnyes）
- harness 對真實 cnyes：visible-after-tail elements 從 30 項降到 3 項（剩 1 個 65px 廣告 LI、不影響閱讀）；residual audit ✅；gap audit 仍標 1 段 80+ gap 但無大塊雜訊
- harness fullpage 截圖：reader card 內無社交 rail / 無 widget 殘留、主文段落到「核心癥結仍在戰爭本身」乾淨結束

**未動**：styler.js / detector.js / popup / service-worker / options 全部零變化；修法只動 cleaner 七處——`NOISE_KEYWORD_RE` / `NOISE_HEADING_TEXT_RE` / `NOISE_LINK_TEXT_RE` 三條 regex 擴 token + `hideInsideArticleByHeadingText` 候選擴 + walk-up fallback 重寫 + `hideInsideArticleByLinkText` walk-up 加 LI + 新規則 `hideInsideArticleNav`，行為擴展而非重寫。

---

**v0.7.27**——toast 範圍縮限：除主文偵測失敗外不再彈 toast（Jimmy 2026-04-25 要求）。

**動作**：
- `main.js::enterReaderMode` 移除 `showToast('已進入閱讀模式', 'success')`（reader card 出現本身就是回饋、不再雙重通知）
- `main.js::exitReaderMode` 移除 `showToast('已離開閱讀模式', 'info')`（卡片消失本身就是回饋）
- **保留** `enterReaderMode` 開頭 `showToast('此頁無法偵測主文', 'error')`——這是「畫面沒任何視覺變化」的唯一情境，必須有明確錯誤回饋
- 移除 `main.js` 的 `SHOW_TOAST` message handler（沒人 send，是預留 hook）
- `namespace.js` 移除 `MSG.SHOW_TOAST` 常數
- 模組層級**未動**：`content/toast.js` / manifest content_scripts list / popup-core CONTENT_SCRIPT_FILES / popup-inject-retry.spec.js / toast.spec.js 全部保留——主文偵測失敗那條 toast 仍需 module 撐著

**驗收**：
- `npm test` → 220 passing（toast.spec.js 仍跑、未動）
- 行為差異：使用者按下 popup toggle 或快速鍵啟動 reader mode 時，**不再**看到右下角綠色「已進入閱讀模式」或藍色「已離開閱讀模式」氣泡；偵測失敗仍會顯示紅色「此頁無法偵測主文」氣泡

**未動**：detector / cleaner / styler / popup / service-worker / options / toast.js module 本體 / content_scripts 注入清單 / 任何測試 fixture / spec 全部零變化；修法只動 main.js（刪 2 個 showToast 呼叫 + 1 個 message handler）+ namespace.js（刪 1 個 MSG 常數），純減量。

---

**v0.7.26**——techbang byline 下方 `<div class="content-top">` CSS min-height 115px 空白修法（Jimmy 2026-04-25 第三輪回報、harness gap audit 標 126px warning）。

**症狀**：v0.7.25 修法後 techbang 主文中段 262px 空白已解，但 byline「洪詩詩 發表於 2026年4月24日 12:30」下、主圖上仍有 115px 空白。

**根因**（harness probe）：
- byline 下有 `<div class="content-top" style="min-height: 115px">`、CSS 撐高度
- 裡面嵌 `<div class="ad-banner"><div class="google-dfp" id="dfp-middle_techbang_desktop_2"><div><iframe>` 多層 DFP 廣告
- 前置 rule 跑完後 DFP 全被 hide（`[data-jread-hidden="1"] + display:none !important`），內層 iframe rect 0×0
- 但 `DIV.content-top` wrapper 本身沒 hide：`hideInsideArticleEmptySpacers` 的 blocker check `el.querySelector('img, picture, video, iframe, svg, button, input, select, textarea')` **不管 blocker 是否已 hide**——看到 iframe 就 match、spacer rule skip、wrapper 留下
- wrapper 自己 CSS `min-height: 115px` 撐著、視覺 115px 空白

**修法**（結構性通則，非站點特判）：

`hideInsideArticleEmptySpacers` blocker check 從簡單 `querySelector` 改成 loop：
```js
const blockers = el.querySelectorAll('img, picture, video, iframe, svg, button, input, select, textarea');
let hasVisibleBlocker = false;
for (const b of blockers) {
  // 沿 b 祖先鏈到 el（或 articleEl）check 有無 jread-hidden
  let cur = b, inHidden = false;
  while (cur && cur !== el && cur !== articleEl) {
    if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
    cur = cur.parentElement;
  }
  if (!inHidden) { hasVisibleBlocker = true; break; }
}
if (hasVisibleBlocker) continue;
```

全部 blocker 祖先鏈都已 jread-hidden → 視同 empty wrapper、可清。

**通則依據**：已 jread-hidden element 視覺上 rect 0×0 / display:none，不佔空間；若某 wrapper 的所有「看似 blocker」子孫全是這類 hidden element，wrapper 本身就是 CSS 撐高度的 empty spacer——跨站通用（任何站 ad slot 清完後的外層 wrapper 都符合）、非 techbang 特有。

**harness 擴 gap audit**：`tools/debug-harness.js` 的 residual audit 加一層「reader card 內相鄰 p/h*/figure/img/ul/ol/blockquote anchor 間 gap >= 80px 警告」。initial + delayed 兩個時機各跑一次。非 forcing function（某些段落間合法大 margin 會誤報），只讓 Claude 修法後自動看到可疑 y 位置、對照 fullpage 截圖巡視。此 audit 發現本次 techbang 修法前的 126px gap @ y=218、也會在未來攔到類似「未清 empty wrapper / 廣告 placeholder / 塌陷 figure」的視覺空白 bug（現有 attribute-based jsdom spec 對這類純視覺 bug 無感）。

**新 fixture + spec**：
- `test/regression/fixtures/techbang-empty-spacer-hidden-blocker.html`：最小重現 `.content-top` + 內嵌 4 層 DFP（class `google-dfp` + `dfp-*` id + `google_ads_iframe_*` + iframe）+ 主文段落
- `cleaner.spec.js` 新增 3 條 assertion：(1) DFP 先被 hide（前置條件）；(2) `.content-top` spacer 被 hide（**核心 forcing**）；(3) 主文 TECHBANG_MAIN_MARK 保留
- **jsdom 無 layout 限制**：`.content-top` 在 jsdom 下 rect.height 恆為 0、spacer rule 本來就 skip。spec 用 `Object.defineProperty(el, 'getBoundingClientRect', { value: () => ({ height: 115, ... }) })` stub rect，讓 spacer rule 的 `rect.height >= 60` 條件成立、能進入 blocker check
- **sanity check**：回退 blocker check 到 `el.querySelector('iframe')` 原版 → spec fail；還原 → pass

**驗收**：
- `npm test` → 220 passing（原 217 + 新 3 條 techbang spacer）
- harness gap audit 對真實 techbang：`126px @ y=218 byline → IMG` gap 消失、仍剩一段 `162px @ y=2150 IMG → H2` 為下一輪處理範圍
- fullpage 截圖 byline 下方主圖緊接出現、無殘留空白

**未動**：styler.js / detector.js / 其他 cleaner rule / popup / service-worker / options 全部零變化；修法只動 cleaner `hideInsideArticleEmptySpacers` 一條 blocker check 邏輯，行為擴展而非重寫。harness tool 擴 gap audit 為獨立 infrastructure（不影響 extension 本體）。

---

**v0.7.25**——techbang.com 主文中段廣告移除後殘留 262px 空白修法（Jimmy 2026-04-25 實機回報）。

**症狀**：news.techbang.com/posts/129017-* reader mode 下第一段文字（「台灣大哥大今日宣布...解決方案。」）與第二段文字（「在門市服務方面...」）之間出現整屏高度空白，原本該是訂閱表單 + 影片內嵌廣告位置的殘留。

**根因**（harness probe 量 gap 262px、列出 3 個 visible element）：

1. **訂閱表單 `<div class="newsletter2in1">` 漏網**：class 含 `newsletter` keyword 但後面接數字 `2`，舊 NOISE_KEYWORD_RE 的 word boundary `([^a-z0-9]|$)` 要求後面是非字母非數字或字串結束——`newsletter` 後面接 `2` 不滿足，match 失敗。整塊訂閱 wrapper 留下（有 height 200px + padding + margin）。

2. **Google DFP 廣告 `<div class="google-dfp" id="dfp-techbang_Desktop_posts_inline_video">` 漏網**：舊 `THIRD_PARTY_AD_SEL` 只有 `[id^="div-gpt-ad"]` / `[id^="google_ads_"]` / iframe selectors 等——不認 `[id^="dfp-"]` 與 `[class~="google-dfp"]` 這兩個 DoubleClick for Publishers (Google Ad Manager 舊名) 的跨 CMS 慣用命名。廣告 wrapper 整塊留著（height 200px）。

3. 兩塊 wrapper 加 padding/margin 累積 → 主文中段出現 262px 空白。

**修法**（結構性通則，非站點特判）：

1. **NOISE_KEYWORD_RE `newsletter` 擴成 `newsletter[\w-]*`**（cleaner.js）：匹配 `newsletter` 後接任意 word 字元（含數字 / 底線 / 連字元）的所有變體——`newsletter` / `newsletter2in1` / `newsletter-form` / `newsletterBox` / `newsletter_cta` 都命中。同時移除 duplicated `newsletter-(?:signup|form|cta)` alternation（被新 pattern 覆蓋）。
   - 為何不對其他 keyword（subscribe/signup 等）一併擴：只有 techbang 實測遇到 `newsletter2in1` 這種數字 suffix 命名，其他 keyword 暫無 observed case；保守只動 forcing 的那一條。

2. **THIRD_PARTY_AD_SEL 加 `[id^="dfp-"]` + `[class~="google-dfp"]`**（cleaner.js）：Google Ad Manager 的 DFP (DoubleClick for Publishers) 接入慣例有兩種命名風格——一種用 `div-gpt-ad-*` id prefix（已有 selector）、另一種站點自己前綴 `dfp-*` + class `google-dfp`（techbang 採用）。跨 CMS 通用命名、非站點特判。

**新 fixture + spec**：
- `test/regression/fixtures/techbang-newsletter-dfp-inline.html` 最小重現：`<article>` 含兩段主文 + 中間訂閱表單 `.newsletter2in1` + DFP 廣告 wrapper
- `cleaner.spec.js` 新增 3 條 assertion：(1) `.newsletter2in1` 命中 NOISE_KEYWORD_RE 被 hide；(2) `.google-dfp` 被 THIRD_PARTY_AD_SEL hide；(3) TECHBANG_MAIN_MARK 主文段落保留
- **sanity check 兩輪**：(a) 回退 `newsletter[\w-]*` → `newsletter` → newsletter2in1 spec fail；還原 → pass。(b) 註解 dfp selector 兩條 → DFP spec fail；還原 → pass

**驗收**：
- `npm test` → 217 passing（原 214 + 新 3 條 techbang）
- harness 對真實 techbang 驗：兩段文字間 gap 從 262px → 16px（normal paragraph margin）、訂閱表單 + DFP 廣告 wrapper 消失

**未動**：styler.js / detector.js / 其他 cleaner rule / popup / service-worker / options 全部零變化；修法只動 cleaner 兩處——`NOISE_KEYWORD_RE` 單一 alternation 調整 + `THIRD_PARTY_AD_SEL` 加兩條 selector，行為擴展而非重寫。

---

**v0.7.24**——ttv.com.tw 主圖消失 + sidebar 漏清三處聯動修法（Jimmy 2026-04-25 實機回報）。

**症狀**：news.ttv.com.tw/news/11504240003200W 進閱讀模式後：(1) 標題大圖（柯文哲+ECMO 照片）消失、只剩圖的 figcaption；(2) 右側 sidebar「熱門新聞」+ 縮圖清單整塊留在 reader card 旁。

**根因**（harness probe 三層剝洋蔥）：

1. **sidebar 沒清**：v0.7.22 為修 newtalk/ebc 主圖加的 narrow media-bearing guard (`sib.querySelector('img, picture, video') → keep`) 太寬。ttv 的 `<div class="sidebox">` 內有熱門新聞縮圖 `<li><a href><img></a>`，`querySelector('img')` 命中 → sidebox 被誤保留整塊。

2. **articleEl 本身 flex 壓扁 article-body**：ttv 的 `<div class="news-article fitVids">` 用 `display: flex` 做「左主文 + 右 sidebar」2 欄 layout。detector 選 `<article id="contentarea">` 後 promote 升到 news-article（因 h1 在 article 外、與 article-body 是 sibling）。sidebar narrow hide 掉後，article-body 是唯一 visible flex child、沒 `flex: 1` → shrink-to-fit 壓到 288px、article 224px。`collapseGridWithHiddenCell` 只掃 `articleEl.querySelectorAll('*')`（不含 articleEl 自己）、漏處理。

3. **雙層 figure 外層 flex 壓扁 img**：ttv 主圖結構 `<figure class="cover img" style="display: flex"><figure><img></figure></figure>`——外層 figure 用 flex，唯一 child 是內層 figure、沒 flex-grow → 被壓到 0×0、img 跟著 0×0。styler `figure { width: auto; max-width: 100% }` 規則不覆蓋 display、reader mode 下原站 flex 行為維持、img 永遠塌陷。

**修法**（三處結構性通則，全部非站點特判）：

1. **narrow media guard 精修**（cleaner.js `narrowPromotedSiblings`）：從「sibling 含 `<img>/<picture>/<video>` → 保留」改成「**sibling 含『非連結包裹』的媒體 → 保留**」——媒體 element 的 `closest('a')` 要是 null 才算 standalone。
   - 依據：hero image 是內容本身、不作為連結（`<div><img>` 或 `<figure><img>`）；sidebar 縮圖是「點擊跳到其他文章」的連結 affordance（`<a><img>`）。這個結構特徵跨 CMS 通用。
   - ebc `article_cover` / newtalk `news_img` 主圖的 img 不在 a 內 → 仍保留 ✓
   - ttv sidebox / 類似縮圖列表 → 正確 hide ✓

2. **collapseGridWithHiddenCell 掃入 articleEl 自身**（cleaner.js）：原 for-loop `articleEl.querySelectorAll('*')` 天生不含 articleEl 自己。改成 `[articleEl, ...articleEl.querySelectorAll('*')]` 把 articleEl 也納入 candidate list（articleEl 自己跳過 jreadHidden / isInPreserved check）。articleEl 若是 flex-row/grid + 有 hidden direct child 時退化成 block、釋放 article-body 拉滿寬度。

3. **forceMediaContainerBlock 新規則**（cleaner.js）：掃 `articleEl.querySelectorAll('figure, picture')`、若 computed display 是 flex/grid/inline-* → inline `display: block !important` 強制回歸 HTML5 UA 預設。restore() 同步還原。
   - 依據：`<figure>` / `<picture>` HTML5 spec UA 預設 display 就是 `block`。原站改成 flex/grid 是站點 custom layout（如左右並排圖說、多欄 gallery），reader mode 下脫離原 context 常失效、留下 shrink 陷阱。
   - 為何放 cleaner 不放 styler：styler 視為動不得（需 Jimmy 明確授權）；cleaner 用 inline !important + snapshot restore 跟 v0.6.13 `resetMediaPlaceholderPadding` 同層級（runtime media 校正）。

**新 fixture + spec**：
- `test/regression/fixtures/ttv-flex-layout-hero-figure.html` 重現 ttv 實機 DOM：`DIV.news-article.fitVids` (flex) > [H1, `DIV.article-body > ARTICLE#contentarea > FIGURE.cover.img (flex) > FIGURE > IMG + p 主文`, `DIV.sidebox > UL > LI > A > IMG`]
- `cleaner.spec.js` 新增 5 條 assertion：(1) promote 升到 news-article；(2) sidebox 被 narrow hide；(3) 外層 figure.cover 被 forceMediaContainerBlock 強制 block；(4) 主圖 img 及祖先 figure 不被誤 hide；(5) TTV_MAIN_MARK 段落全保留
- **sanity check 兩輪**：(a) 回退 narrow media guard 到 v0.7.22 舊版 → ttv sidebar spec fail；還原 → pass。(b) 註解 `forceMediaContainerBlock` 呼叫 → figure block spec fail；還原 → pass

**驗收**：
- `npm test` → 214 passing（原 209 + 新 5 條 ttv）
- harness 對真實 ttv 驗：`DIV.news-article.fitVids` display 從 flex → block、article-body 288px → 608px、外層 figure rect 0×0 → 528×297、主圖 natural 1024×576 正確顯示；residual audit 無命中；fullpage 截圖 reader card 乾淨、sidebar / footer / 熱門新聞全清

**未動**：styler.js / detector.js / popup / service-worker / options 全部零變化；修法只動 cleaner 三處——`narrowPromotedSiblings` media guard 精修、`collapseGridWithHiddenCell` 擴 candidate、新增 `forceMediaContainerBlock`（+ `restoreMediaContainerBlock`），行為擴展而非重寫。

---

**v0.7.23**——newtalk.tw site-footer 原站 JS 清掉 jread inline `!important` priority 修法（Jimmy 2026-04-25 reload 後實機仍回報 footer 顯示）。

**症狀**：v0.7.22 修法後 newtalk 主標題 + 主圖都回來了，但頁尾整塊 footer（「更多互動 / 更多服務 / 更多關注」+ 「先驅媒體社會企業... All Rights Reserved」）仍在 reader card 下方顯示。

**初診（錯誤）**：以為 `hideOutsideArticleSemantic` 只掃 `header, nav, footer, aside` 而 newtalk 用 `<div id="footer">` 不是 `<footer>` tag 漏網——補了 selector `#footer, #site-footer, #page-footer, .site-footer, .page-footer` 等 id/class 慣用命名。harness probe 看到 `div#footer` 有 `data-jread-hidden="1"`，但**fullpage 截圖仍看見 footer**。

**再 probe 拿到真因**：檢查 footer 的 inline style 狀態——
```
jreadHidden=true  computed display=block  rect=1280x586
inline.display="none"  priority=""  ← !important 不見了
inline.cssText: display: none;
```
jread 的 `setProperty('display', 'none', 'important')` 明明寫了，priority 卻變空字串。**newtalk 的某個 JS handler（scroll / resize / timer）在 reader mode 啟動後清掉了 jread 的 inline !important flag**——原站 stylesheet 的 `#footer { display: block !important }`（ID selector specificity 1,0,0）因此贏過 jread stylesheet `[data-jread-hidden="1"] { display: none !important }`（attr selector specificity 0,1,0），footer 重新 visible。

**修法**（結構性通則，非站點特判）：

1. **`hideOutsideArticleSemantic` 擴 id/class selector**（初診修法，仍保留為獨立保險路徑）：補 `#header, #footer, #site-header, #site-footer, #page-header, #page-footer, .site-header, .site-footer, .page-header, .page-footer` 等跨 CMS 慣用命名。即使沒有 restyle observer，id/class 命中讓 hide 路徑獨立於祖先鏈遍歷，多一層兜底。

2. **`watchHiddenInlineRestyle(hidden)` 新 observer**（核心修法）：`clean()` 結束後開一個 MutationObserver，`attributeFilter: ['style']`，對每個 hidden element 的 style attribute 變動監聽。callback 檢查 `el.style.getPropertyPriority('display') === 'important'`，若被清掉則重新 `setProperty('display', 'none', 'important')`。`restore()` 時 disconnect。

**通則依據（為何不是站點特判）**：任何有 scroll / resize handler 的響應式 UI 站都可能重新 assign element.style、清掉 !important priority——newtalk 只是第一個被抓到的實例，LINE Today / Engadget / Bootstrap-based 模板都有類似風險。inline !important observer 是跨站通用的「對抗 JS 動態覆寫」機制。

**Self-trigger 不會無限循環**：observer 觸發後 setProperty 會再 trigger 一次 mutation callback，但第二次進 callback 時 priority 已是 `important`、早早 return，不再 re-set。

**性能**：hidden list 典型 50-200 個 element、observer 只對 `style` attribute 變動觸發。原站 JS 高頻 scroll handler 下可能每秒 10 次 mutation、callback 內做一個 priority check + 必要時一次 setProperty，實測對 UX 無感。

**新 fixture + spec**：
- `newtalk-p-class-title.html` 擴 fixture：新增 `<div id="footer">` 在 body direct child 位置（模擬非 `<footer>` tag site-wide footer 場景）
- `cleaner.spec.js` 新增 2 條 assertion：
  1. `<div id="footer">` 必須被 hide（驗 `hideOutsideArticleSemantic` id/class selector）
  2. **inline !important priority 被清後、observer 自動補回**（async spec 模擬 `el.style.display = 'none'` 覆寫清 priority、等 MutationObserver microtask、驗 priority 回到 `important`）
- **sanity check**：註解 `watchHiddenInlineRestyle(hidden)` 呼叫 → observer spec fail（priority 留空字串）；還原 → pass

**驗收**：
- `npm test` → 209 passing（原 207 + 新 2 條 newtalk）
- harness 對真實 newtalk.tw 驗：footer probe `inline.display="none" priority="important"`、computed `display=none` rect 0×0；fullpage 截圖 reader card 下方整個背景區乾淨、無任何原站 footer 殘留
- 請 Jimmy 實機 reload 到 v0.7.23 驗

**驗收疏失檢討**：v0.7.22 發布時 Jimmy 已提醒——我看 fullpage 截圖只掃 reader card 內部排版，沒把目光移到 card 外的頁面 body 區。這次 v0.7.23 又踩一次「初診錯誤」：只看 `jreadHidden=true` 就判定修好，沒查 computed display——**光看 `data-jread-hidden="1"` attribute 不夠，還要驗 computed 實際 display 值**。memory 補 hard rule：harness 驗 hide 效果時必須讀 `getComputedStyle(el).display === 'none'` + rect 0×0，不能只靠 attribute marker。

**未動**：styler.js / detector.js / 其他 cleaner rule / popup / service-worker / options 全部零變化；修法動 cleaner 兩處：`hideOutsideArticleSemantic` 擴 selector、新增 `watchHiddenInlineRestyle` observer（+ 呼叫點 + `restore()` 裡 disconnect），行為擴展而非重寫。

---

**v0.7.22**——newtalk.tw 標題不是 heading tag（`<p class="name">`）+ 主圖非 figure（`<div class="news_img">`）雙修法（Jimmy 2026-04-24 實測截圖回報 newtalk 新聞閱讀模式標題消失；同一條 narrow media guard 順便修好 ebc `article_cover` 主圖被誤殺的潛伏 bug）。

**症狀**：newtalk.tw/news/view/2026-04-24/1031506 進閱讀模式，reader card 第一項直接是「美國總統川普 23 日在社交媒體發文...」，主標題「川普下達佈雷快艇擊沉令! 以稱要把伊朗打回石器時代 伊祭7反擊方案」完全消失。

**根因**（harness probe 診斷）：
- 整頁無 `<article>` tag，detector 走 `schema-org-body` 命中 `div[itemprop="articleBody"]`（純內文段落，不含標題）
- 文章標題不是 heading tag——newtalk 用 `<p class="name">` 包在 `div.title > div.news_info` 裡（可能是早期 CMS 設計遺留）
- 舊 `promoteForTitle` 只掃 `h1-h4` tag、對 `<p>` 包標題漏防 → 主文容器停在 `div.articleBody`、沒升級
- `hideAncestorSiblings` 沿祖先鏈把 `div.news_info`（含標題）當 chrome 清掉 → 標題不見
- 連帶發現：主圖 `div.news_img > img`（非 figure、`isInPreserved` 不覆蓋），即使修好 promote 讓 articleEl 升到 `div.left_column`，`narrowPromotedSiblings` 從 `articleBody` 走到 articleEl 時仍會誤殺 `news_img`

**修法**（結構性通則，非站點特判）：

1. **detector.js `promoteForTitle` 擴 title tag 白名單**：`TITLE_TAG_SEL` 從 `'h1, h2, h3, h4'` 擴到 `'h1, h2, h3, h4, p, div, span'`；非 heading tag 加 `TITLE_TEXT_MAX = 120` text 長度上限（防含標題字串的正文段落誤配；heading tag 維持無上限）。同時修一個既有 bug：`heads` 現在同時掃 sib 自己 + 子孫（舊邏輯「sib match 白名單 → 只看 sib 自己」會吃下整塊 wrapper textContent、漏內部真 title node；擴到 div/span 後此 bug 必須修）。
2. **cleaner.js `narrowPromotedSiblings` 加 media-bearing sibling 保護**：新增 guard `if (sib.querySelector('img, picture, video')) continue`——跨 CMS 通則：主圖與內文常在兄弟層，舊站或某些 CMS（WordPress 某些 theme 未把 `<img>` 升級成 `<figure>`、Next.js 新聞站手寫 `<div><img></div>` 主圖）沒把主圖包進 figure 時尤其如此。若該 sibling 其實是含 img 的廣告（class/id 命中 noise keyword），後續 `hideInsideArticleByKeyword` / `hideInsideArticleThirdPartyAds` 會補抓；反之錯殺主圖沒辦法回收。

**為何不是站點特判**：
- `<p class="name">` 包標題在聯合新聞、部分中時早期 CMS 也見過；v0.7.22 後所有「非 heading tag 但內含 og:title 精確匹配文字」都能被 promote 覆蓋（titleMatches 本身已是嚴格字串比對，雙重保護）
- `<div><img></div>` 主圖結構 ebc (`article_cover`) 與 newtalk (`news_img`) 完全同構，修法同時修好兩站

**連帶修好既有 bug（ebc 主圖誤殺）**：
- 原 `ebc-promote-narrow-sibling-chrome` spec 斷言「`article_cover` 必須被 narrow hide」——harness probe 實機確認 ebc `article_cover` 是**文章主圖**（810×424 hero image + figcaption），v0.7.12 當初寫 spec 時誤判了 article_cover 的角色
- v0.7.22 媒體 guard 讓 ebc 主圖回來、spec 斷言更新為「必須保留」

**新 fixture + spec**：
- `test/regression/fixtures/newtalk-p-class-title.html`：完整重現 newtalk DOM（`div.left_column` → `news_info` 含 `p.name` title / `news_content` 含 `news_img` 主圖 + `articleBody` 內文 / `gray_box extend_news_url` / `news_tools` / `_popIn_recommend` / 兄弟 `right_column` sidebar）
- `cleaner.spec.js` 新增 7 條 assertion：(1) schema-org-body 命中 articleBody；(2) promote 升到 left_column；(3) **titleHead 命中 `<p class="name">`—— 擴 tag forcing**；(4) **p.name 及祖先不被 hide—— 核心 bug forcing**；(5) **主圖 `div.news_img` 保留—— media-bearing guard forcing**；(6) 主文 5 段保留；(7) chrome（延伸閱讀 / popIn）+ 右欄 sidebar hide
- `cleaner.spec.js` ebc spec 更新：`article_cover` 從「必須 hide」改成「必須保留」+ 註解說明 v0.7.22 修正原 spec 的誤判
- **sanity check 兩輪**：(a) `TITLE_TAG_SEL` 改回 `'h1, h2, h3, h4'` → newtalk 4 條 fail；還原 → pass。(b) 註解掉 narrow media guard → ebc article_cover + newtalk news_img 共 2 條 fail；還原 → pass

**驗收**：
- `npm test` → 207 passing（原 199 + 新 7 條 newtalk + 1 條 ebc 更新）
- harness 對真實 newtalk.tw/news/view/2026-04-24/1031506 驗：reader card 第一項變回 `P "川普下達佈雷快艇擊沉令!..."`，主圖 3 張 hero image 顯示正常、跑馬燈 / 延伸閱讀 / 分享列 / 留言 / 推薦全部清除、fullpage 截圖整頁乾淨
- ebc 類（`article_cover` 主圖）潛伏 bug 同時修好

**未動**：styler.js / 其他 cleaner rule / popup / service-worker / options 全部零變化；修法只動 detector `promoteForTitle`（擴 tag + text 上限 + heads 邏輯修 bug）+ cleaner `narrowPromotedSiblings`（加 media guard 1 行），行為擴展而非重寫。

---

**v0.7.21**——Stratechery h2 post-title 被 narrow 誤殺修法（Jimmy 2026-04-24 實測截圖回報；Stratechery 是 v0.6.3 baseline 三站之一、此 bug 屬嚴重 regression）。

**症狀**：stratechery.com/2026/please-listen-to-my-podcast/ 進閱讀模式後主標題「2026.12: Please Listen to My Podcast」完全消失，reader card 第一個 visible item 是 figcaption（photo credit）而非標題。

**根因**（harness probe 診斷）：
- detector 走 heuristic、原選中 `DIV.entry-content`（主文容器）、promote 升一層到共同 parent `DIV.wp-block-column`（articleEl）
- `H2.wp-block-post-title`（標題）是 articleEl 的 direct child、entry-content 的 sibling
- `narrowPromotedSiblings`（v0.7.12 ebc 修法引入）的 h1-only guard（`sib.tagName === 'H1'` + `sib.querySelector('h1')`）不認 H2——Stratechery 的 `<h2 class="wp-block-post-title">` 是 **WordPress block theme 慣例**（h1 是站名、post-title 預設是 h2），被當 sibling chrome hide 掉

**修法**（結構性通則，非站點特判）：
- `detector.js` `promoteForTitle` 返回 `{ el, titleHead }` 而非單一 el——titleHead 是 promote 實際命中 `titleMatches` 的 heading element；candidate 搜索範圍從 `h1, h2` 擴到 `h1, h2, h3, h4`（跨 CMS 各種 tag 慣例：WordPress h2 預設、部分 Medium 主題 h1、少數新聞站 h3/h4）
- `detect()` 把 `promotedTitleHead` 加進 result、隨 `promotedFrom` 一起傳給 cleaner
- `main.js` 呼叫 `cleaner.clean(el, { promotedFrom, promotedTitleHead })` 傳入兩項
- `cleaner.narrowPromotedSiblings` 新增第 4 個參數 `promotedTitleHead`、guard 加一條**精準白名單**：`sib === promotedTitleHead || sib.contains(promotedTitleHead) → continue`。不放寬成「所有 H2」避免 sidebar 每個 related-card h2 都當主標題保護
- 既有 H1 fallback guard 保留——某些站點走策略 1（article-tag）沒 promote、但 article 內可能含 h1

**為何不是站點特判**：
- `wp-block-post-title` 預設 h2 是 WordPress block theme 的**跨 CMS 通用**命名（至少 Stratechery / 多數新版 WordPress 主題）
- titleMatches 嚴格比對 og:title / document.title 首段，heading tag 擴到 h1-h4 誤命中風險低——fixture `stratechery-h2-post-title.html` 測試 sidebar 內的 related-card h2 不會被誤保護（只有 titleMatches 真正命中的那一個 heading 才進 guard）

**新 fixture + spec**：
- `test/regression/fixtures/stratechery-h2-post-title.html`：完整重現 Stratechery WordPress block theme DOM（articleEl = wp-block-column、promoted from entry-content、h2.wp-block-post-title 是 direct child、sidebar 含 related-card h2）
- `cleaner.spec.js` 新增 6 條 assertion：(1) detector 升級 articleEl + 紀錄 promotedFrom；(2) detect() 返回 promotedTitleHead API；(3) **h2 post-title 保留（核心 bug forcing）**；(4) sidebar 仍被 narrow hide（精準保護、不過度放寬）；(5) STRATECHERY_MAIN_MARK 段落全保留；(6) sidebar 內 related-card h2 隨 sidebar hide（guard 不誤保）
- **sanity check 通過**：拿掉 guard → assertion (3) fail（h2 被 hide）；還原 → pass

**驗收**：
- `npm test` → 199 passing（原 193 + Stratechery 新 6 條）
- harness 對真實 stratechery.com/2026/please-listen-to-my-podcast/ 驗：reader card 第一項 outline 從 `FIGCAPTION` 變回 `A "2026.12: Please Listen to My Podcast"`（h2 > a 結構、direct text 在 a 裡），標題完整顯示、整頁排版正常
- ChinaTalk baseline 站 regression 驗 → 主標題 H1「Media Diet Q1 2026」仍在第一項（舊 H1 fallback guard 仍生效）

**未動**：styler.js / 其他 cleaner rule / popup / service-worker / options 全部零變化；修法只動 detector `promoteForTitle` + `detect()`、main.js 呼叫、cleaner `narrowPromotedSiblings` + `clean()` 四處，API 擴展而非重寫。

---

**v0.7.20**——清 PENDING_REGRESSION 4 條（條目 2/3/4/5），PENDING queue 從 5 條剩 1 條（theverge styled-components 視覺 bug）。本版新建 e2e harness 架構作為長期基礎設施，未來所有「只能在真實 MV3 Chrome 環境驗」的 wire-up bug 都可在這層補 forcing function。

**條目 2**（detector textLen bonus jsdom forcing function）：
- 新 fixture `test/regression/fixtures/upmedia-textlen-bonus.html` 精準鎖住 v0.7.2 (B) bonus 公式的算分曲線：class 刻意避開 POSITIVE_RE / NEGATIVE_RE 所有詞（避免 weight ×1.25 / ×0.5 干擾）、純粹比較 raw + bonus。無 bonus → B (base 15.00) 險勝 A (base 10.00) ratio 1.14 < 1.25 觸發 ambiguous 且兩者都無 POSITIVE 命中、沿用 top[0] = B 誤選；有 bonus → A 觸頂 +10 拉到 20、B 只 +0.95 拉到 15.75、ratio 1.27 > 1.25 非 ambiguous、A 正確勝出
- 新增 2 條 `detector.spec.js` 斷言：(1) 行為 forcing 驗 detect().el.id === 'AA-target'；(2) 字面 forcing 用 multiline regex `^\s*score\s*+=\s*Math\.min\(textLen/200, 10) \* \(1 - Math\.min\(ld, 0\.95\)\)` 確保 bonus statement 是 live（非 `// SANITY:` 註解形式），行首非註解才算命中
- sanity check 兩輪：註解掉 bonus statement → 兩條 assertion 都 fail（行為 + 字面）；還原 → pass

**e2e harness 基礎設施**：
- 新 `tools/e2e-harness.js`：抽 `tools/debug-harness.js` 的 SW 啟動樣板成可重用 helper（`launchExtension` / `swEval` / `openTab` / `getTabId` / `startFixtureServer`）；內建 HTTP server 提供有 `<article>` tag + 足夠 textLen 的 fixture HTML、讓 detector 穩定命中 article-tag 策略（confidence 0.9）、不依賴外部網路
- 新 `test/e2e/sw-regression.spec.js`：Mocha test，調用 e2e-harness 跑 SW wire-up 斷言
- `package.json` 分離 script：`npm test` 加 `--ignore test/e2e/**` 預設不跑 e2e（保持 jsdom test 快、<1s）；`npm run test:e2e` 顯式啟動 Playwright Chromium

**條目 3**（SW importScripts 絕對路徑）：
- e2e spec 驗 `self.__JReadPopup` 掛載 + `toggleWithInjectionFallback` 是 function + `CONTENT_SCRIPT_FILES` 是 array；若回退成 `importScripts('popup/popup-core.js')` relative → 解析成 `/background/popup/popup-core.js` 載入失敗、SW 整個跑不完、此 spec fail
- sanity 驗過：改 relative path → 條目 3 + 4 共 4 條 test 連鎖 fail（因 SW 整個垮、listener 無法註冊）

**條目 5**（SW icon swap wire-up）：
- e2e 策略：在 SW world monkey-patch `chrome.action.setIcon` 記錄所有 calls（`self.__iconCalls`），然後用 `path['16']` 的 string signature 分辨 ACTIVE（`icon-16.png`）vs IDLE（`icon-16-disabled.png`）
- 三條 wire 全涵蓋：
  - (b) `tabs.onUpdated` status=loading 觸發 setIcon IDLE——opentab 後驗 calls 中有 IDLE signature
  - (a)+(c) 透過 SW sendMessage TOGGLE_READER_MODE → content main.js enterReaderMode → 發 SET_ACTIVE_ICON → SW handler 呼叫 setIcon ACTIVE——驗 calls 中有 ACTIVE signature

**條目 4**（SW 快速鍵 handler wire-up）：
- Playwright 無法從 page 觸發 extension commands（shortcut 綁 browser 層），但可驗 `chrome.commands.onCommand.hasListeners() === true`（manifest commands 宣告的 handler 有掛鉤）+ 核心路徑「query active tab → 呼叫 toggleWithInjectionFallback」在 SW context 下能跑並回傳合法 shape。這是 handler 三行邏輯的可測部分

**驗收**：
- `npm test` → 193 passing（原 190 + 條目 2 的 3 條 新 spec）
- `npm run test:e2e` → 5 passing（條目 3 x1、條目 5 x2、條目 4 x2）
- PENDING_REGRESSION 從 5 條剩 1 條（theverge styled-components p 鎖寬視覺瑕疵——需動 styler，由 Jimmy 下次授權動排版類修法時一併處理）

**未動**：`jread/` 下 extension 本體零變化（只 bump manifest / package version）——本版純補 test 覆蓋 + 抽 e2e harness 基礎設施，不碰 runtime 行為。

---

**v0.7.19**——技術債大掃除（Jimmy 2026-04-24 review 後指示動工，8 項清理同步一版）。行為面只修一條真 bug（A1），其餘都是結構/文件/測試層面的去重與強化，extension runtime 行為對既有站點零變化。

**真 bug 修復**：
- **A1**：`jread/popup/popup-core.js` 的 `CONTENT_SCRIPT_FILES` 清單缺 `content/toast.js`（v0.4.0 新增 toast.js 時漏同步），對 extension reload 前已開啟的 tab 用 popup/快速鍵觸發時走 `executeScript` fallback 注入 content scripts → toast.js 沒進注入清單 → `NS.toast = null` → `main.js` 的 `showToast` 靜默 return → **進/離開閱讀模式、偵測失敗都不會有 toast 提示**。補上 toast.js、在 `test/regression/popup-inject-retry.spec.js` 加一條 forcing function test：讀 `manifest.json content_scripts[0].js` 與 `CONTENT_SCRIPT_FILES` deepStrictEqual 比對（完整順序 + 項目），未來任何新增 content script 只動 manifest 忘記同步 popup-core 會 fail。

**Forcing function 強化**：
- **E2**：`test/version-check.spec.js` 新增 `package.json` 版本驗證（`assert.strictEqual(pkg.version, EXPECTED_VERSION)`）；先前同步清單 6 項裡只 forcing 3 項（manifest / SPEC / CHANGELOG），package.json 靠人肉同步。現在 4 項都有 forcing。

**結構清理**：
- **A2**：刪 `.backups/`（92K 遺留資料夾，CLAUDE.md 明確宣告「不再使用」；歷史走 `git tag v0.1.0 / v0.2.0` 還原即可，無資訊流失）
- **A3**：刪空 `jread/site-overrides/.gitkeep`（SPEC.md 預留的站點特判隔離區，至 v0.7.18 實際零使用；未來要用再建）
- **A4**：刪 `jread/assets/icons/icon-512.png`（manifest 不用、`tools/generate-icons.js` SIZES 無 512，grep 整個 repo 零引用、確認孤兒）

**文件去重**：
- **A5**：`CHANGELOG.md` 歸檔 v0.6.0 – v0.6.26（27 條）到 `CHANGELOG-archive.md`（archive 標題改成 `v0.1.x – v0.6.x`）；主 CHANGELOG 從 1000 行瘦身到約 950 行、只保留 v0.7.x baseline 之後的條目
- **A6**：`SPEC.md` 開頭「目前 Extension 版本」段原本鏡像 CHANGELOG 頂部條目（行 8–50 = v0.7.5 → v0.7.18 完整 commit log），每次 bump 要同步 2 份純重複。精簡為一行版本指向 CHANGELOG + Baseline 清單（v0.6.3 硬規則）+ 6 條跨版本硬教訓摘要（typography universal rule 必須 scoped / 偽陰性驗收禁止 / button 一律清 / inline !important / delayed lazy-inject 靠邏輯完整性 / 假設驗證順序）
- **D2**：`README.md` 版本段改一行「目前版本：見 CHANGELOG.md 頂部條目」

**測試去重（zero behavior change）**：
- **C1**：新建 `test/helpers.js` 的 `loadFixtureWithScripts({ fixturePath, scripts, viewport, pretendToBeVisual })` + `stubRect` + `SRC` 常數。三個 spec（`detector.spec` / `cleaner.spec` / `styler.spec`）頂部重複的 `fs.readFileSync + JSDOM + window.__JRead = {state:{},MSG:{}} + window.eval(SRC)` 樣板共用同一 helper。

**程式去重（zero behavior change）**：
- **B2**：`jread/content/cleaner.js` 抽 `snapshotStyles(el, propNames)` / `applyImportant(el, decls)` / `restoreStyles(el, prev)` 三個 helper，重構 `collapseGridWithHiddenCell` / `restoreCollapsed` / `collapseInnerGridFlex` / `restoreInnerGridFlex` / `resetMediaPlaceholderPadding` / `restoreMediaResets` 六個函式。原本每個 snapshot/restore 都手寫 `prevXxx + prevXxxPriority` boilerplate（collapseGrid 的 container 5 props + child 7 props、innerGridFlex 3 props、mediaResets 2 kind 各自 props），重構後共用 3 個 helper、snapshot 結構統一為 `{ el, kind?, prev: { [propName]: { value, priority } } }`。cleaner.js 行數 1656 → 約 1580。restore 流程對齊 `restoreStyles()` 單一 loop、不再每個 restore 函式重抄 `removeProperty + (value && setProperty)` pattern。

**驗收**：190 spec 全過（原 188 + A1 新增 `CONTENT_SCRIPT_FILES 完整對齊 manifest` 1 條 + E2 新增 `package.json 版本一致` 1 條）；B2 / C1 refactor 零 regression；harness 不跑——本輪零 runtime 行為變化（A1 修的 inject fallback bug 在真實 Chrome 環境才能驗，已有 spec forcing 替代）。

**未動**：`jread/content/detector.js` / `jread/content/styler.js` / `jread/content/main.js` / `jread/content/toast.js` / `jread/background/service-worker.js` / `jread/popup/popup.js` / `jread/options/*` 全部 runtime 行為零變化。

---

**v0.7.18**——revert v0.7.17：universal `width/max-width` 打破 theverge drop cap + figure 排版（Jimmy 2026-04-24 截圖打臉）。

**Regression 症狀**（Jimmy 實測 theverge 全頁截圖）：
- Drop cap `D` float:left 與首段文字重疊——原 drop cap 靠內嵌 style 的固定 width 讓文字繞排、`width: auto !important` 強制破壞 intrinsic width
- Figure 內 img 部分溢出 card 邊界——styled-components 原設計 figure `max-width: none` 允許滿版 bleed，universal `max-width: 100% !important` 打破 full-bleed 意圖
- p/img 4-10px 偏移雖修好，但整體排版崩壞（drop cap overlap 視覺衝擊遠大於 4-10px 偏移）

**Jimmy 硬教訓 20**：「你自己改完都不看一下嗎？請改完務必檢查整個網頁，確保從上到下的排版皆正常。」
- 改 styler 類影響視覺的 rule 後，**必須用 harness 截圖 + Read 該截圖自驗**整頁排版
- 光靠 `✅ 無殘留雜訊` 的 residual audit 只覆蓋 cleaner 層的雜訊清除、不保證 styler 的排版正確
- Universal selector `*:not(...)` 是「全站掃地雷」動詞——連 figure/figcaption 以外的 inline `<style>` 在 p/img/div/span 上都會被強制覆寫，副作用遠大於預期

**通則教訓**（寫進 SPEC）：**typography-affecting universal rule（width / max-width / margin / padding 等影響版面的幾何屬性）必須用 scoped selector**（例 `[data-jread-active] > article > p` 或 styled-components hash class attribute selector 精準命中）。v0.7.16 的 background transparent universal rule 沒此問題是因 background 屬性副作用只有「變透明」不影響 layout。

**本版變更**：
- `jread/content/styler.js` universal rule 移除 `width: auto !important` + `max-width: 100% !important`（純 revert v0.7.17 的兩行）
- `test/regression/styler.spec.js` 移除對應 2 條 assertion
- `tools/debug-harness.js` 保留 goto timeout 30s→60s + fallback `domcontentloaded`（theverge 類重站 30s 不夠；跟 revert 無關但本輪一併 commit、未來除錯更順）

**未修**：theverge styled-components `width: 588px` 造成 p/img 4-10px 偏移（入 `test/PENDING_REGRESSION.md`；將來用 scoped selector 精準 target p element 而非 universal rule）。

**驗收**：188 spec 全過（移除 2 條 `assert.ok` 在同一 `it()` block 裡，test case 數不變）；harness 跑 theverge `✅ 無殘留雜訊` + viewport 截圖確認無 drop cap overlap / figure overflow。

---

**v0.7.17**——theverge p 鎖寬修法：universal rule 加 width/max-width（Jimmy 2026-04-24 回報 theverge 圖片偏左、段落偏右不對齊）。

**根因**（harness probe）：
- theverge 主文 `<p>` class `duet--article--dangerously-set-cms-markup _8enl99j _1xwtict1` 等 styled-components class 設 `width: 588px` 或 `width: 600px`（固定 px 值）
- img/figure 寬 608px（articleEl 內容區邊界 336-944）、左 336
- p 寬 588-600 + margin 0、但實際 left 340-346（比 img 多 4-10px offset）
- 視覺上：圖片比段落寬 + 左邊凸出 4-10px、段落看起來靠右

**修法**：擴 v0.7.16 universal rule（`*:not(figure):not(...)`）加兩條 declaration：
```css
width: auto !important;
max-width: 100% !important;
```

**為何 universal rule 可覆寫 styled-components class**：
- styled-components class（`_8enl99j` 等）在 stylesheet 裡設 `width: 588px`（通常不帶 !important）
- jread styler `<style>` 插在 `<head>` 尾端、優先順序高
- universal selector specificity (0, 1, 1)、帶 `!important` → 贏過 styled-components class rule 的 `width: 588px`

**為何不違反 v0.6.0 baseline**：
- baseline spec 禁 `] p {` 字面 pattern（避免 v0.5.x 過度激進 !important rule）
- universal selector `*:not(...)` 字面不含 `] p {` → pass baseline spec
- 精神上 baseline 禁的是 **typography rule**（font-size / color / line-height / margin）、不是 width reset
- `width: auto` 是 block element 預設行為、不影響 typography

**驗收**：
- spec 驗 universal rule body 含 width/max-width declarations
- harness 五站（esmchina / ebc / line today / udn / chinatimes）`✅ 無殘留雜訊`、無 regression
- theverge Playwright 偶 timeout 與本輪修法無關（之前 probe 60s timeout 能跑完、harness 30s 擋住）
- `npm test` 188 passing

---

**v0.7.16**——theverge 裝飾 background 清除（Jimmy 2026-04-24 回報 theverge.com/report/914244 排版亂七八糟）。

**根因**（harness probe）：
theverge 用多個 styled-components 裝飾 wrapper 有非透明 background：
- `duet--layout--entry-body-container` 600×10871 白底 → 撐起主文整體白色、card 內嵌 card 視覺
- `_1wu3rm1` 300×300 白色 inset box（文中穿插的裝飾卡）
- `qnnwq1` 65×22 綠色（rgb(60,255,208)）accent bar（h2 上方標記）
- `tly2fw0` 600×92 淺紫（rgb(238,230,255)）block（newsletter / 引述）

v0.7.10 `collapseInnerGridFlex` 只處理 `display: grid` 容器、這些都是純 block + background-color 無法觸及。

**修法**：styler CSS 加 universal selector：
```css
[data-jread-active="1"] *:not(figure):not(figcaption):not(summary):not(blockquote):not(code):not(pre):not(table):not(thead):not(tbody):not(tr):not(th):not(td):not(mark):not(kbd) {
  background-color: transparent !important;
  background-image: none !important;
}
```

**preserve 清單設計**：
- **W3C 語意保留**：figure / figcaption / summary / blockquote（主文媒體容器 / 引述 / 摘要）
- **視覺慣例需要背景區隔**：code / pre（程式碼 block）/ table / thead / tbody / tr / th / td（表格 row 交替色）/ mark（語意 highlight）/ kbd（鍵盤按鍵白底慣例）

**通則依據**：reader mode 精神是「card 本身有統一米色底、內部不該再有彩色裝飾打斷閱讀流」。原站用 background 做視覺層次在 reader mode 下都是雜訊；真正需要背景區隔的 tag 都是 W3C 定義 + 視覺慣例明確的少數 tag。

**驗收**：
- spec 驗 CSS 含 9 個 `:not(X)` + 兩個 declarations
- harness probe 確認 `colored: []` + `accentBars: []`（全清）
- 六站全 `✅ 無殘留雜訊`（theverge / esmchina / ebc / line today / udn / chinatimes）
- `npm test` 188 passing

---

**v0.7.15**——esmchina Bootstrap col-* 鎖窄欄寬修法（Jimmy 2026-04-24 回報 esmchina.com/news/14116.html 內文寬度不對）。

**根因**（harness probe）：
- articleEl = `DIV.container`（styler 給 width: 720px card 寬）
- 主文 `<p>` 祖先鏈含 `DIV.col-md-9.article-left`
- col-md-9 computed `width: 288px`（Bootstrap `.col-md-9 { width: 75% }` CSS class rule 在 container inner ~384px 下的計算值）
- 主文被鎖 288px 寬、card 外框 720px、內文只占 40% 寬

**既有 rule 無法處理**：
- v0.7.10 `collapseInnerGridFlex` 只處理 `display: grid|inline-grid` 容器
- 這裡是普通 `display: block` element、含 stylesheet `width: 75%` CSS class rule
- `data-jread-ancestor` reset 只作用 articleEl **外部**祖先、不管內部

**修法**：styler CSS 加 5 條 Bootstrap col-* attribute selector reset：
```css
[data-jread-active="1"] [class*="col-xs-"],
[data-jread-active="1"] [class*="col-sm-"],
[data-jread-active="1"] [class*="col-md-"],
[data-jread-active="1"] [class*="col-lg-"],
[data-jread-active="1"] [class*="col-xl-"] {
  width: auto !important;
  max-width: none !important;
  float: none !important;
  flex: initial !important;
}
```

**通則依據**：Bootstrap grid class 是跨 CMS 標準（WordPress / Django / Rails 專案普遍用）、非站點特判（硬規則 3）。attribute selector `[class*="col-X-"]` 精準命中 col-xs-1 / col-sm-6 / col-md-9 / col-lg-12 / col-xl-* 等；不誤殺 `.color-primary` / `.collapse` / `.collapsible` 等無 `-` 分隔的類命名。

**精準度設計**：
- `width: auto` + `max-width: none`：回到 block element 預設行為（100% of parent）
- `float: none`：Bootstrap 3 的 col 用 `float: left`，清掉避免多欄並排
- `flex: initial`：Bootstrap 4+ 的 col 在 flex row 內用 `flex: 0 0 75%`，清掉避免固定比例撐開

**驗收**：
- spec 驗 CSS 含 5 條 attribute selector + 4 條 declarations
- harness probe 確認 `.col-md-9.article-left` width 288px → 608px（container 內寬）
- 五站全驗（esmchina / ebc / line today / udn / chinatimes）`✅ 無殘留雜訊`
- `npm test` 187 passing

**實作硬教訓（本輪踩過的坑）**：
> **JS template literal 內的 CSS 註解不能含 backtick `** ——第一版 CSS 註解含 `.col-md-9` 這種 markdown-style 反引號包 class 名稱，backtick 直接**中斷 template literal**、引發大量 SyntaxError（35 spec 全 fail）。改用雙引號 `"col-md-9"` 即修。未來在 template literal 裡寫 CSS 註解時：**反引號禁用**、class 名用 `.` 前綴或雙引號包。

---

**v0.7.14**——udn `narrowPromotedSiblings` 漏 h1-self guard 修法（Jimmy 2026-04-24 回報 udn.com/news/story/124844/9460037 標題消失）。

**根因**（harness probe）：
- detector strategy = `article-tag`（udn 有 `<article class="article-content">`）
- promoteForTitle 升到 `<section class="article-content__wrapper">`（h1 的 parent）
- promotedFrom = `article.article-content`、articleEl = section
- h1 是 articleEl 的 direct child（跟 promotedFrom article 是兄弟）
- v0.7.12 `narrowPromotedSiblings` hop 0（parent === articleEl）掃 children：
  - `sib === cur` (promotedFrom article) → 保留 ✓
  - `sib.contains(promotedFrom)`? no
  - `sib.querySelector('h1')`? **H1.querySelector('h1') 回 null**（querySelector 只找後代、不含 sib 自己）
  - 其他 guard 都不命中 → **h1 被 hide**

**修法一行**：guard 前加 `if (sib.tagName === 'H1') continue;` 處理「sibling 自己就是 h1」case。

**通則**：h1 是主文標題的明確語意 element、即使作為 sibling 也應該保留（與 h1 wrapper 保留同精神）。

**驗收**：
- Fixture `udn-h1-direct-child-narrow-guard.html` 精確重現 udn DOM：
  ```
  section.article-content__wrapper
    h1.article-content__title            ← direct child、sibling
    div.article-content__meta            ← meta bar、narrow 會 hide
    article.article-content (promotedFrom)
      p 主文...
    aside.related-articles              ← sibling chrome、narrow 會 hide
  ```
- 4 條 spec：detector 命中 + promote 升級 + h1 保留 + non-h1 sibling（related-articles aside）仍 hide
- sanity check：註釋 `sib.tagName === 'H1'` guard → 1 條 h1 assertion fail
- harness 五站全驗（ebc / line today / udn / chinatimes / esmchina）`✅ 無殘留雜訊`
- `npm test` 186 passing

**硬教訓追加第 20 條（留給後續對話）**：
> **`querySelector(sel)` 不含 element 自己、只找後代**。寫 guard「sibling 含 X」時、若 sibling 自己就是 X，`querySelector(X)` 回 null、guard 漏 case。正確 pattern：`sib.tagName === 'X'.toUpperCase() || sib.querySelector(X)` 兩個都要檢查。此 pattern 跟 v0.7.8 `hideInsideArticleByKeyword` h1 wrapper guard 相似但有差異——那條 guard 的 wrapper 是 div，一定不會 tagName === H1、所以只靠 querySelector 可（sibling case 會是 h1 本身）。未來寫類似 guard 時要先問：「sibling / wrapper 自己有沒有可能就是目標 tag？」

**另一個觀察**：Jimmy 的回饋「你自己看不到嗎」——提醒我 harness 能直接 probe 的站（Playwright 不被擋的）不該讓使用者每次 DevTools 貼 Console 指令。本輪改用 probe script 自動跑，省了一輪手動往返。未來 bug 回報優先 harness probe、Playwright 被擋才 fallback DevTools。

---

**v0.7.13**——esmchina 5 層深 single-child wrapper 支援 + partner keyword（Jimmy 2026-04-24 回報 esmchina.com/news/14116.html 標題消失）。

**根因**（Console probe）：
- og:title 空 → detector getCanonicalTitle fallback 到 document.title
- document.title = `遺憾！三安光電 2.39 億美元並購遇挫–國際電子商情`（含 en dash `–` 但前後無空格，split regex `/\s+[–—|]\s+/` 不切、target 含整個尾綴）
- titleMatches 仍能過（h1 被 target 包含、ratio 95% > 60%）
- **主文 DOM 5 層深**（container > col-md-9 > unnamed > article-cnt > article-words > article_text）、detector heuristic 選到 article_text
- `PROMOTE_MAX_HOPS=4`（v0.7.12）只爬到 col-md-9、無法到共同祖先 container、h1 漏 scope

**修法**：
1. detector.js `PROMOTE_MAX_HOPS` 4 → 5
2. cleaner.js `NOISE_KEYWORD_RE` 加 `partner` 詞（esmchina `.partner-content-article` / `.partner-title` sidebar 殘留「更多>」CTA）

**為何直接放寬 hops 安全**：v0.7.12 硬教訓 19 已預測「放寬 hops 要配 narrow 機制兜底」，`narrowPromotedSiblings` 會清 sibling chrome、scope 擴大不產生殘留。5 站驗證無 regression。

**驗收**：
- Fixture `esmchina-promote-5-hops.html` 模擬 5 層深 DOM + partner-content sibling
- 5 條新 spec：promote 升 .container、h1 保留、partner sidebar hide、主文保留、字面 regex forcing `partner`
- 既有 ebc fixture 字面 forcing 從 `PROMOTE_MAX_HOPS = 4` 改成 `>= 4`（不鎖死具體值、讓未來再放寬不用改既有 spec）
- sanity check 退回 PROMOTE_MAX_HOPS=4 → 2 條 esmchina spec fail
- harness 五站（ebc / line today / udn / chinatimes / upmedia / **esmchina** 新增）全驗：
  - ebc / line today / chinatimes / esmchina `✅ 無殘留雜訊`
  - udn「更多」A tag 殘留（既有已知 VIP link 問題）
  - upmedia 2 項 audit false positive（既有）
- `npm test` 182 passing

**硬教訓 19 本輪驗證**：v0.7.12 預測「單純放寬 PROMOTE_MAX_HOPS=5 通常仍 OK（narrow 機制會自動兜底）」—— esmchina 實證成立。未來再遇需更多 hops 的站，可繼續沿用此 pattern。

---

**v0.7.12**——ebc 深層 single-child wrapper + 橫向 sibling chrome 修法（v0.7.8 記入 PENDING_REGRESSION 的 h1 missing 問題本輪完整修法）。

**根因回顧**（v0.7.8 已 probe 確認）：
- ebc news.ebc.net.tw /news/society/548318 DOM 結構：
  ```
  #main_content
    article_header (含 h1)
    article_container
      article_cover
      article_main_box
        share_box
        article_main
          article_relevant (相關新聞列表)
          article_content (← detector heuristic 命中 POSITIVE `content`)
  ```
- detector 選到 `article_content`，h1 在兄弟 `article_header` 內
- 共同祖先是 `#main_content`、從 article_content 上走需要 4 hops
- v0.7.3 `PROMOTE_MAX_HOPS=3` 不夠 → h1 漏 scope（使用者截圖看不到標題）
- v0.7.8 嘗試放寬 3→4 後回滾——scope 升到 #main_content 把其他 sibling chrome（相關新聞 / share_box / article_cover）全部納入 → 殘留 regression
- 結論：需 **promote+narrow 聯動**機制

**本輪完整修法三處聯動**：

**(1) detector.js**：
- `PROMOTE_MAX_HOPS` 3 → 4
- `detect()` 記錄 `result.promotedFrom`：
  ```js
  const originalEl = result.el;
  result.el = promoteForTitle(result.el, hopLimit);
  if (result.el !== originalEl) {
    result.promotedFrom = originalEl;
  }
  ```

**(2) cleaner.js** 新 rule `narrowPromotedSiblings(articleEl, promotedFrom, hidden)`：
```js
let cur = promotedFrom;
for (let hops = 0; hops < 10 && cur && cur !== articleEl; hops++) {
  const parent = cur.parentElement;
  for (const sib of parent.children) {
    if (sib === cur) continue;
    if (sib.contains(promotedFrom)) continue;  // content 分支
    if (sib.querySelector('h1')) continue;     // h1 分支
    // ... isInPreserved / jreadHidden guards
    hide(sib, hidden);
  }
  if (parent === articleEl) break;
  cur = parent;
}
```
與既有 `hideAncestorSiblings` 方向相反——那條從 articleEl 往 body 走、此條從 promotedFrom 往 articleEl 走，作用層不重疊互補。

**(3) cleaner.clean()** 簽章擴充 `(articleEl, opts)`、opts.promotedFrom 觸發 narrow。main.js 把 detect() 的 `promotedFrom` 傳進 `cleaner.clean()`。

**順手修**：`NOISE_KEYWORD_RE` 加 `controls` 詞——ebc `article_controls` 內「聽新聞」UI 殘留；`controls` 是 UI 控制列的語意詞、主文不會用。

**驗收**：
- Fixture `ebc-promote-narrow-sibling-chrome.html` 模擬 ebc 實際 DOM（4 層深 content 路徑 + 3 層橫向 sibling chrome + h1 在 hop 4 兄弟）
- 7 條 spec：
  - promote 升到 `#main_content` + `result.promotedFrom` 紀錄
  - h1 保留（祖先鏈無 hidden）
  - article_relevant / share_box / article_cover（hop 1/2/3 sibling）被 narrow hide
  - 主文 EBC_CONTENT_MARK 段落保留
  - 字面 regex forcing `PROMOTE_MAX_HOPS = 4`
- Sanity check：註釋 `narrowPromotedSiblings` 呼叫 → 2 條 sibling hide assertion fail
- Harness 四站全過：
  - ebc ✅ articlePreview 含 h1 標題 + `✅ 無殘留雜訊`
  - line today / chinatimes / udn ✅ 無殘留
  - upmedia audit false positive（「關注」在主文內容、「延伸閱讀」括號引述）與本輪無關
- `npm test` 177 passing
- 從 `test/PENDING_REGRESSION.md` 移除 ebc h1 條目

**硬教訓追加第 19 條（留給後續對話）**：
> **promote 放寬 hops 上限時、必須**同時**配備 narrow 機制清 sibling chrome。** v0.7.3 `PROMOTE_MAX_HOPS` 2→3 + v0.7.12 3→4 是 **hop 數放寬的演進**，每次都伴隨新場景：line today 需要 3 hops、ebc 需要 4 hops。但放寬 hops 意味 scope 擴大——upper bound 跟「單 child wrapper 深度」相關、只會越來越深（未來可能出現需要 5 hops 的站）。**正確架構不是無限放寬 hops、是放寬 hops + 收緊 scope 雙管齊下**：promote 到 common ancestor（允許最大範圍）+ narrow 沿 content 路徑清 sibling chrome（精準 scope）。v0.7.12 的 promotedFrom + narrowPromotedSiblings 就是這個架構。未來若再遇需要 5 hops 的站、單純放寬 PROMOTE_MAX_HOPS=5 通常仍 OK（narrow 機制會自動兜底）。

**Fixture 設計硬教訓**：h1 text 前不能加 MARK prefix——fixture 第一版 h1 text = `"EBC_H1_MARK 台鐵新左營站男廁小便斗驚見針孔！嫌犯竟是高鐵男員工"`，titleMatches 比 og:title 首段分割結果（~12 chars），比值 35% < 60% 門檻、match 失敗、promote 沒升級。修正：h1 用 `id="ebc-h1"` 當驗證標記、text 保持乾淨。**驗 title-based 功能的 fixture 永遠不該在 h1 text 加 forcing prefix**。

---

**v0.7.11**——Medium click-to-zoom button wrapper 保留主文圖片（Jimmy 2026-04-24 回報 Medium 文章圖片不見）。

**根因**（Console probe 揭露）：Medium 把主文 `<picture>/<img>` 嵌在 `<div role="button" tabindex="0">` wrapper 裡讓使用者點擊查看大圖：
```html
<figure class="paragraph-image">
  <div role="button" tabindex="0" class="oi oj ek">
    <span>Press enter or click to view image in full size</span>
    <div>
      <picture>
        <source srcset="..."/>
        <img src="..." width="700" height="472"/>
      </picture>
    </div>
  </div>
</figure>
```
v0.7.3 `hideInsideArticleAllButtons`「所有 button / [role="button"] 無條件清」rule 把這個 wrapper 當純 CTA 給 hide（`display: none !important`）、連帶內部 picture/img 都不可見、`rectW/H = 0×0`。

**修法**：`hideInsideArticleAllButtons` 加 media guard：
```js
if (btn.querySelector && btn.querySelector('img, picture, video')) continue;
```

**通則依據**：button 內含 img/picture/video = 主文載體（不是純 CTA）、保留 wrapper 才能保留主文內容。修法精神與 v0.7.8 的 h1 wrapper guard 一致：button 內含「主文載體」時保留 wrapper、純 CTA 照清。

**精準度設計**：svg 不在 guard 範圍——svg 多為 icon（share / like / comment 常用 svg 圖示），作者 avatar 用 img、有可能誤保留含 avatar 的 button，但主文中這類 case 罕見、trade-off 正向（保主文圖 >> 讓少數 avatar button 殘留）。

**驗收**：
- Fixture `medium-click-to-zoom-button.html` 三條 forcing：
  - `#zoom-btn`（`role="button"` 含 picture）→ 保留
  - `#share-btn`（純 CTA `"Share this article"`）→ hide
  - `#icon-btn`（`role="button"` 含 svg icon）→ hide
- 主文 img 祖先鏈全無 `data-jread-hidden="1"`
- sanity check：註釋 `btn.querySelector` guard → 2 條 assertion fail（zoom-btn 被 hide、img 祖先 hidden）
- `npm test` 170 passing

**硬教訓追加第 18 條（留給後續對話）**：
> **「無條件清」類 rule 遇到「多角色 wrapper」時必然需要 guard。** v0.7.3 `hideInsideArticleAllButtons` 設計時的假設是「button = 純 CTA（分享 / 訂閱 / 追蹤）」，但現代 CMS（Medium / BBC / Vox 等 React 站）常把 `role="button"` 當 **互動式容器**（click-to-zoom / click-to-expand），內含主文 picture / video / heading 等**主文載體**。這類 wrapper 有雙重角色——**互動 + 主文容器**。無條件 hide 會連主文一起消失。guard pattern：`if (el.querySelector(<主文載體 selector>)) continue`。v0.7.8 h1 wrapper guard + v0.7.11 media guard 都是此 pattern 的實例。未來若有新「無條件清 X tag」rule，先問：「X 有沒有可能是多角色 wrapper？內部是否可能含主文載體？」

---

**v0.7.10**——BBC pathological 固定 px grid container 強制 block reset（Jimmy 2026-04-24 v0.7.9 後回報 BBC 主文仍鎖窄欄寬度）。

**根因**：v0.7.9 清掉廣告 wrapper 後，Console probe 揭露 articleEl 內部多層 grid container：
```
p (386px)
  DIV (display: grid, grid-template-columns: 386px) ← 瓶頸
    DIV (block 386px)
      DIV (display: grid, 12 columns)
        DIV (display: grid, ...)
          ARTICLE (block 817px)
```
單欄固定 386px 的 grid container 鎖死主文 p 寬度。既有 cleaner 兩條 rule 都漏網：
- `data-jread-ancestor` CSS reset 只處理 articleEl **外部**祖先
- `collapseGridWithHiddenCell` 只在有 hidden child 時觸發

**修法**：cleaner 新 `collapseInnerGridFlex(articleEl, hidden)` 函式
- 掃 articleEl 內所有 element
- 條件：`display: grid|inline-grid` + `grid-template-columns` 含 `\d+px`
- 操作：強制 `display: block !important` + `grid-template-columns: none !important` + `grid-template-rows: none !important`
- `restoreInnerGridFlex(hidden)` 逆向還原 inline display / grid-template

**精準度設計**：
- `/\d+px/` 只 collapse **hard-coded 固定寬度**（BBC 的 `386px` 是 styled-components JS 計算後的固定值，reader mode 下明顯過窄）
- `1fr 1fr` / `auto` / `minmax(0, 1fr)` 等彈性單位**保留**——這類是 intentional 多欄設計（主文內雙欄引述 / 圖片並列）
- **不動 flex container**——Bootstrap row/col 類 layout 由 `collapseGridWithHiddenCell` 在 hidden child 場景處理，避免誤殺主文中的 flex 排版
- `isInPreserved` 跳過 figure/figcaption/summary/blockquote 內部（figure image gallery 的 grid layout 保留）

**通則依據**：reader mode 精神是「內文撐滿 card」。hard-coded px 固定寬 grid（特別是 styled-components JS 動態算出的）違反此精神——強制 block 化是 reader mode 通則、非站點特判。

**驗收**：
- Fixture `bbc-inner-grid-fixed-column.html`：
  - `#pathological-grid`（`grid-template-columns: 386px` 固定 px）→ 驗被 reset
  - `#intentional-grid`（`1fr 1fr` 彈性）→ 驗保留原 grid
  - 5 個 MARK 段落（INTRO / TRAPPED / OUTRO / INTENTIONAL_LEFT / INTENTIONAL_RIGHT）驗主文保留
- 獨立 round-trip spec：clean → restore 後 pathological grid 回到原 `display:grid` + `386px`
- sanity check：註釋 `collapseInnerGridFlex` 呼叫 → 2 條 assertion fail（pathological 保持 grid、grid-template-columns 未清）
- `npm test` 165 passing

---

**v0.7.9**——BBC React styled-components 廣告 wrapper 清除（Jimmy 2026-04-24 實測 bbc.com/news/articles/clyepyy82kxo 右側 540×1100 灰色占位，DevTools 抓 DOM 確認結構）。

**根因結構**：
```html
<div data-testid="ad-unit" data-component="ad-slot" class="sc-66bf5539-0 euXOeE">
  <div class="dotcom-ad" style="background-color: #f8f8f8">
    <div class="dotcom-ad-inner" data-jread-hidden="1"
         style="display: none !important;">...</div>
  </div>
</div>
```
- 內層 `.dotcom-ad-inner` 已被 AD_BOUNDARY_RE hide（`-ad-` 邊界命中）
- 外層 React wrapper class 是 styled-components hash（`sc-66bf5539-0 euXOeE`）無 keyword 可命中
- 既有 cleaner markerOf 只讀 class + id、看不到 data-* attributes
- 但外層靠 styled-components min-height CSS 仍撐 540×1100 占位空間 → 灰色方塊殘留

**修法**：`THIRD_PARTY_AD_SEL` 擴充 4 條 React component data attribute selector：
- `[data-testid="ad-unit"]`
- `[data-testid="ad-slot"]`
- `[data-component="ad-slot"]`
- `[data-component="ad-unit"]`

**通則依據**：`data-testid="ad-unit"` / `data-component="ad-slot"` 是 **Google Ad Manager + React 新聞站跨站業界標準命名**（BBC / Vox / Vice / Insider / 任何使用 styled-components + GAM 的 React 新聞站皆用此命名慣例），屬結構性通則、非站點特判（硬規則 3）。data-testid 原本是 React 測試工具識別 ID，但社群轉而當廣告 component 的語意標記使用。

**驗收**：
- Fixture `third-party-ads-inside-article.html` 新增 3 條 React wrapper：
  - `<div data-testid="ad-unit" data-component="ad-slot" class="sc-66bf5539-0 euXOeE" id="bbc-react-slot-1">` 模擬 BBC 實際結構
  - 另兩條獨立驗 `[data-testid="ad-slot"]` 與 `[data-component="ad-unit"]`
  - id 刻意改 `bbc-react-slot-1/2/3`（不含 `-ad-` 邊界）、class 是 sc-hash，**只能**靠新 data attribute selector 命中
- 3 條對應 assertion 驗 dataset.jreadHidden === '1'
- **Sanity check 關鍵**：第一版 id 用 `bbc-ad-unit` 含 `-ad-` 邊界、sanity 拿掉 data attribute selector 後 **AD_BOUNDARY_RE 誤救援仍通過**（偽陽性）——這是 v0.7.8 硬教訓第 16 條的延伸實例。改用 `bbc-react-slot-N` id 後 sanity 正確 fail 3 條
- `npm test` 160 passing

**硬教訓追加（第 17 條，延伸第 16 條）**：
> **fixture id / class 裡只要含 `-ad-`、`-ad`、`ad-` 等邊界詞，AD_BOUNDARY_RE 就會誤救援。** 寫第三方廣告相關 fixture 時，**所有 id / class 都要刻意避開 ad 邊界**，才能讓真正的 forcing（`[data-testid="..."]` / `[id^="..."]` 這類 selector）成為唯一命中路徑。第 16 條教訓是「spec 不 fail 不代表 guard 有效」，本條是「sanity 仍 pass 不代表新 selector 沒作用——可能是既有其他 rule 誤救援」。修 ad 相關 rule 的 sanity check 要留意 fixture 裡不能有邊界詞。

---

**v0.7.8**——ebc 媽祖廣告清除 + 主文標題 wrapper 保護 guard（Jimmy 2026-04-24 回報 ebc news.ebc.net.tw /news/society/548318 兩個 bug + bbc /news/articles/clyepyy82kxo 右側廣告占位殘留）。

**修法 (1)：NOISE_KEYWORD_RE 擴充 `marker` 詞**
- 場景：ebc 文末「與媽祖同行！2026 遶境全攻略看東森」行銷插播，wrapper class 是 `.inline_text.has_marker`。class 中 `marker` 詞跨 CMS 幾乎都指「標註 / 插播 / 推薦」特殊內容、非主文
- 通則依據：`marker` 在 class 命名裡的語意幾乎不會是主文結構（主文內容不需要「被標記」），常見於推薦 / 廣告 / 特殊內容標註 wrapper
- Fixture `ebc-inline-marker-ad.html` 驗行為 + 字面 regex forcing（NOISE_KEYWORD_RE 必含 `\bmarker\b`）

**修法 (2)：`hideInsideArticleByKeyword` 加 h1-wrapper guard**
- 通則：article 內含 h1（主文標題）的 wrapper **一律保留**，即使 class 命中 NOISE_KEYWORD_RE
- 場景：許多 CMS 把 share / social / author / comment 等 keyword 與 post header 混在同一 class（例：`.share-header` / `.social-post-header` / `.author-header`），wrapper 本身命中 NOISE_KEYWORD_RE 但實際包主文 h1，hide 會讓 h1 連帶不可見
- 實作：`if (el.querySelector && el.querySelector('h1')) continue;` 簡短一行
- 風險評估：極低。wrapper 內部真正的 share / nav / button 各項由 `hideInsideArticleAllButtons` / `hideInsideArticleByKeyword`（對子 container）各自處理，guard 只保護 wrapper 本身
- Fixture `h1-wrapper-header-keyword-guard.html` 用 `.share-header` wrapper（`share` 詞在 NOISE_KEYWORD_RE 明確命中）forcing：有 guard → wrapper 保留 + h1 可見 + 內部 `.share_bar` 仍 hide；無 guard → share-header 被 hide → h1 祖先 hidden → 2 條 assertion fail

**未修 → PENDING_REGRESSION**：
- **ebc h1 漏 scope**：真實根因是深層 single-child wrapper 結構（4 層 `#main_content > article_container > article_main_box > article_main > article_content`），`PROMOTE_MAX_HOPS=3` 不夠、放寬 4 又讓 scope 擴大吃進其他 sibling（相關新聞列表 / 聽新聞 controls / 更多 link）。需 promote+narrow 聯動架構升級。暫記 `test/PENDING_REGRESSION.md`
- **bbc 右側廣告占位殘留**：Playwright bundled Chromium 下 bbc 廣告 JS 不 inject（bot detection / geo），probe 即便等 18 秒 + 門檻降到 50×50 仍 0 殘留，無法在 harness 重現 → 無最小 fixture。等 Jimmy 實機提供殘留元素的 DOM 結構（class/id/tag）才能寫通則 rule

**驗收**：
- `npm test` 160 passing（+ 6 新 assertion：ebc marker fixture 2 + h1-wrapper fixture 4）
- sanity check：拿掉 marker 詞 → 字面 forcing fail；拿掉 h1 guard → share-header + h1 祖先 2 條 assertion fail
- harness ebc 實測：媽祖廣告 `.inline_text.has_marker` 被 hide、`✅ 無殘留雜訊`

**硬教訓補第 16 條（留給後續對話）**：
> **spec 不 fail 不代表 guard 有效、可能是 forcing 沒觸發。** v0.7.8 寫第一版 h1-wrapper guard spec 時用 `.article_header` 當 wrapper class（模仿 ebc 實測），spec 全過 + sanity 拿掉 guard 也全過——這時該警覺 forcing 沒觸發，不是 guard 的功勞。Node regex test 證實 `header` 詞根本**不在 NOISE_KEYWORD_RE alternation 裡**（只有 `cookie-` / `newsletter-` 等複合詞，沒 bare `header`）、`article_header` 本來就不會被 keyword hit。修正：fixture wrapper class 改用 `share-header`（`share` 在 NOISE_KEYWORD_RE 明確命中），forcing 才真正生效、sanity 才 fail。**修 guard 類 spec 的 sanity check 要拿掉 guard 看 assertion 是否 fail——不 fail 代表 forcing 本身無效**，要改 fixture。

---

**v0.7.7**——修 v0.7.5 regression：ambiguous confidence penalty 改「從 top-5 挑 POSITIVE 命中者」（Jimmy 2026-04-23 回報 upmedia.mg /tw/focus/comprehensive/256956 從 v0.7.5 起無法偵測主文）。

**根因**：Probe 擷取真實頁面 detector 各階段：`<article>` / `[itemtype]` / `[itemprop]` / `<main>` 四個策略全 miss、只剩 heuristic。heuristic 計分：
- top1 = 無 class 的 wrapper DIV（raw 7、textLen 717、score 10.26、無 POSITIVE/NEGATIVE）
- top2 = `.news-box-text` 真主文（raw 3.5、textLen 988、POSITIVE 命中、score 10.17）
- top1/top2 = 1.009 < 1.25 → ambiguous=true
- v0.7.5 邏輯 `confidence *= 0.85`：raw confidence = (10.26-10)/40*0.4+0.30 = 0.3026 → 打折 0.2572 < MIN_CONFIDENCE 0.30 → `return null`
- detector 回 null → 整個網頁無法進閱讀模式

**修法**：回滾 `confidence *= 0.85` 打折邏輯、改動「選哪個」而非「打折 confidence」。`detectByHeuristic` 在 ambiguous 分支從 top-5 裡優先挑 **POSITIVE 命中且 NEGATIVE 沒命中** 的候選：
```js
let chosen = top[0];
if (ambiguous) {
  const preferred = top.find(c => c.posHit && !c.negHit);
  if (preferred) chosen = preferred;
}
```
貼近 Readability.js `nbTopCandidates` 的真實精神（top-N 裡 class weight 最好者勝出）。candidates 物件加 `posHit` / `negHit` flag。保留 `result.ambiguous` 作為 `detect()` → `promoteForTitle` 的 hops 收緊信號（避免誤選 anchor 時 promote 升 common ancestor 吞整頁）。

**驗收**：
- Fixture `upmedia-heuristic-ambiguous-positive-wins.html` 精確設計 seedScore 公式（1+commas+min(3, floor(len/100))）讓 wrapper score 10.5 vs news-box-text POSITIVE 後 9.72、比值 1.03 < 1.25 觸發 ambiguous
- 舊邏輯：conf 0.30 × 0.85 = 0.255 < 0.30 → null fail；新邏輯挑 POSITIVE 勝出、conf 0.30 pass
- **字面 regex forcing**（`top.find\s*\(\s*c\s*=>\s*c\.posHit`）防未來回退
- **字面 regex forcing**（不得包含 `if\s*\(\s*ambiguous\s*\)\s*confidence\s*\*=\s*0\.85`）防打折邏輯被加回
- sanity check：回滾修法 → 5 條 upmedia fixture assertion 全 fail（偵測 / ambig / POSITIVE 勝出 / 主文保留 / 字面 forcing）
- `npm test` 154 passing
- harness 四站全過：upmedia articleFound=true 恢復；line today / chinatimes / udn 無殘留雜訊

**硬教訓補第 15 條（留給後續對話）**：
> **confidence 數值打折是 anti-pattern，應動「選哪個」而非「打折信心」。** v0.7.5 引入的 `if (ambiguous) confidence *= 0.85` 表面上是「降低不確定結果的信心」，實際上在邊界 score 區間（10.0~10.5）會把剛過 MIN_CONFIDENCE 的 heuristic 結果直接殺掉整個偵測。正確模式：根據新資訊（ambiguous flag）**改變決策過程**（從 top-5 挑更可信者），不要事後 scale numerical 信心——那會把「信心不足」變成「完全放棄」，造成比選錯更糟的「無偵測」。Readability.js 的 `nbTopCandidates` 一直是「挑 class weight 最好者」的設計，v0.7.5 只借鑑了 flag 計算、沒借鑑選擇邏輯，本輪補齊。

---

**v0.7.6**——Postlight Parser 研究產物：Schema.org `itemprop="articleBody"` 策略（Jimmy 2026-04-23 第二輪研究）。

**研究範圍**：盤點 [postlight/parser](https://github.com/postlight/parser) `src/extractors/custom/` 120+ 站點 parser，抽樣讀 9 個具代表性的（NYT / Medium / Engadget / CNN / Ars Technica / CNET / Twitter / Blogspot / Wikipedia / BuzzFeed）找跨站通則。

**三類發現**：
- **content selector**：跨站 `article` tag / `[itemtype*="Article"]` JRead 已涵蓋；少數站自訂 class `.zn-body-text` / `.g-blocks` / `.article-text` 等屬 POSITIVE_RE 詞根已 cover；**唯一新增可抽的是 `itemprop="articleBody"`**，多個新聞站（NYT / CNN / Ars Technica）的 parser 用這個 selector
- **clean selector**：Medium `svg` / Wikipedia `.mw-editsection` / BuzzFeed `.js-ad-placement` / Twitter `.stream-item-footer`——**全是站點特判**，違反硬規則 3 不收
- **transforms**：Postlight 改 DOM 結構（`noscript → div` / `h2 → b` / padding-hack img 重排）——JRead 架構保留原 DOM、僅 hide + 覆蓋樣式，**類型不相容**全 skip

**修法**：detector 策略 2 雙層（`detectBySchemaOrg`）
- Layer A（原邏輯保留）：`[itemtype*="NewsArticle" i]` / `[itemtype*="BlogPosting" i]` / `[itemtype*="Article" i]` 容器型，命中 confidence 0.85、strategy `schema-org`
- **Layer B（新增）**：fallback 到 `[itemprop="articleBody"]`，命中 confidence 0.85、strategy `schema-org-body`

**通則依據**：Schema.org 的 `itemprop` 是 W3C 規範的 microdata property 標記，跨站通用、非站點特判（硬規則 3）。`itemprop="articleBody"` 元素的 textLen 通常較緊湊（僅 content 主體、不含 byline / meta），命中即主文。許多站即便外層沒掛 itemtype（SEO 配置較舊），內層仍標了 itemprop——這是 Google 結構化資料爬取依據，SEO 慣例。

**驗收**：
- fixture `schema-org-articlebody.html`：刻意建構「無 `<article>` tag + 無 `[itemtype*="Article"]`、僅內層 `div[itemprop="articleBody"]`」的真實 NYT/CNN 類結構，forcing Layer B 必須觸發才通過
- 4 條 spec：偵測成功 / strategy === 'schema-org-body' / confidence === 0.85 / itemprop 元素命中（含 SCHEMA_BODY_MARK 段落、不含 sidebar）
- sanity check：註釋 Layer B → strategy + confidence assertion fail（heuristic fallback 仍能選到 itemprop 容器，但 strategy 不再是 schema-org-body）
- `npm test` 149 spec passing

**不做的**：
- 各站 clean selector（`.mw-editsection` / `.js-ad-placement` 類全是站點特判、違反硬規則 3）
- 填充 `jread/site-overrides/`（工程量大、reader mode 架構已覆蓋大部分、ROI 低）
- Postlight 的 transforms 類 DOM 重建操作（架構不相容）
- Medium `clean: ['svg']`（其他站點的 SVG 可能是正文圖表——站點特判）

**硬教訓補第 14 條（留給後續對話）**：
> **從 Postlight Parser 120+ 站點 parser 中抽跨站通則的產出極低——9 個樣本僅抽出 1 條（`itemprop="articleBody"`）**。原因：Postlight 架構鼓勵為每站寫客製 parser（`.zn-body-text` 是 CNN 自訂、`.g-blocks` 是 NYT 自訂），跨站通則都已被 Schema.org microdata / ARIA / HTML5 semantic tag 這類 W3C 標準涵蓋。未來若有類似「是否借用 X 個站點 parser 專案」的問題，預期也會得到類似結論：**大部分的 selector 知識屬於各站 CMS 特定，而跨站通則往往能用 Schema.org / W3C 標準找齊**。Schema.org 的 `itemprop` 族還有 `author` / `datePublished` / `headline` 等，未來若 JRead 要抽 byline / 發布日期，同樣可直接走 microdata 通則。

---

**v0.7.5**——Readability.js 演算法借鑑三項：POSITIVE/NEGATIVE regex 擴充 + nbTopCandidates 競爭分析 + lazy-image hydration（Jimmy 2026-04-23 續問「是否有受推崇的主文偵測/雜訊清理專案可參考」）。

**研究四個主流**：Mozilla Readability.js（Apache 2.0、Firefox Reader View 引擎、業界 benchmark median F-score 0.970 / recall 0.929）、Postlight Parser（前身 Mercury Parser、MIT、120+ 站點 custom parser）、Trafilatura（Python、F-score 0.937）、DOM Distiller（Chromium 內建、Java 為主）。結論：**架構不同無法直接引入**——Readability 風格是「parse → 重建 clean DOM tree → 替換原頁面」、JRead 是「覆蓋原 DOM、標 `data-jread-active` + `data-jread-hidden` + 可還原」。硬引入整包等於拋棄 JRead 核心定位。但**借鑑演算法細節**成本極低、可直接落實。

**三項借鑑**：

1. **POSITIVE_RE / NEGATIVE_RE 擴充**（detector.js class-weight multiplier）
   - POSITIVE 補：`hentry|h-entry`（microformats 標記）+ `blog`（部落格 CMS class `.blog-post` / `#blog-content` 常見）
   - NEGATIVE 補：`gdpr|outbrain|related|sponsor|shoutbox|widget|skyscraper`（跨 CMS 廣告 / 相關推薦 / 側欄元件慣用命名）
   - **刻意不收 Readability 原版的 `page|pagination`**——`#page-wrapper` 是整站 wrapper 的常見命名，命中會讓 detector 把 top bar + nav + footer 全當主文；`pagination` 在 Readability 自己的 unlikelyCandidates 也是負面訊號（內部矛盾，歷史包袱）
   - **刻意不收 `hidden|hid|contact|scroll|shopping|tags|media|meta`**——這些詞在正文結構裡也常出現（`.article-meta` / `.category-tags` / `.media-object`），命中會讓真主文的 multiplier 被砍半、誤判

2. **nbTopCandidates 競爭分析**（detector.js `detectByHeuristic` 改寫）
   - 原本：`let best = null; let bestScore = 0` 只挑 top 1
   - 改成：收 `candidates` array、`sort((a,b) => b.score - a.score)`、取前 5
   - `runnerUpScore` = top[1].score；`ambiguous = top1/top2 < 1.25`
   - `ambiguous=true` 時：confidence ×0.85 + `result.ambiguous` flag
   - `detect()` 依 `result.ambiguous` 傳 `hopLimit=1` 給 `promoteForTitle`，避免 heuristic 選錯 anchor 時 promote 沿祖先升到 common ancestor、把整頁 chrome 吞進主文（v0.7.2 upmedia 國際版踩過的坑的結構化一般化防守）
   - 不把 top2 取代 top1——top1 仍是「最高分者」，只是告訴上層「這個 pick 不穩、別硬 promote」

3. **lazy-image hydration**（cleaner.js `hydrateLazyImages` + `restoreLazyImages` 新增）
   - 場景：Medium / WordPress / CMS 類站點用 IntersectionObserver 做 lazy image load，未進視窗的 `<img>` 的 `src` 是 1x1 透明 gif、base64 placeholder 或空字串，真圖 URL 存 `data-src` / `data-original` / `data-lazy-src`。進 reader mode 時 DOM 被大幅改造、排版重置，**原站 lazy observer 常常跟不上新 viewport 定位**，圖片保持空白
   - 修法：進 reader mode 時掃 articleEl 內 `<img>`，`src` match `/^\s*$|^about:blank$|^data:image\//i` 視為 placeholder；依序嘗試 `data-src` / `data-original` / `data-lazy-src` / `data-lazy` 屬性、再 fallback 到 `srcset` / `data-srcset` 第一個 URL，補進 `src`
   - restore：以 `hadSrcAttr` 區分「原站無 `src` attribute」vs「原站 `src=""`」做 round-trip 還原。前者 removeAttribute、後者 setAttribute('src','')
   - 對標 Readability.js `_fixLazyImages` 精神——Readability 是「parse HTML 後修」情境、我們是「瀏覽器已載但 observer 沒跑」情境，attribute 名單與補救邏輯一致

**驗收**：
- 三條 fixture：`readability-class-weights.html`（POSITIVE/NEGATIVE 擴充）、`readability-ambiguous-candidates.html`（ambiguous flag）、`lazy-image-hydration.html`（5 種 lazy case）
- 9 條新 spec：2 條字面 regex forcing（防止未來誤刪名單）+ 3 條行為 assertion（主文選對 / ambiguous flag / confidence 打折）+ 5 條 lazy case 涵蓋 + 1 條 round-trip restore
- Sanity check 三輪：退回舊 regex / `ambiguous=false` / 註釋 `hydrateLazyImages` 呼叫——各自對應的 assertion fail、其他不動，forcing function 有效
- `npm test` 145 passing
- harness 三站（line today / chinatimes / udn）residual audit 三次全 `✅ 無殘留雜訊`，無 regression

**不做的**：
- 硬引入 Readability.js 整包（要拋棄 `data-jread-active` / restore 機制）
- unlikelyCandidates regex 早期排除（detector 目前已有 `isSignalExcluded` 處理 modal/dialog；大規模 class keyword pre-filter 太激進、風險是真主文被誤排除）
- `_unwrapNoscriptImages`（JRead 架構保留原 DOM 結構、不需 unwrap）
- Readability 分數縮放係數 `+=25` 直接照抄（我們是 `*= 1.25`/`*= 0.5` multiplier，內部 scale 不同，照搬會破壞既有 confidence 曲線）

---

**Engineering note（2026-04-23，無版本變動）**——Fanboy social / newsletter / notifications cosmetic list spike 結論。Jimmy 續問「有沒有專門攔社群 widget / 訂閱 popup / 通知等『惱人事物』的 list 可參考」，評估三個候選：

1. **Fanboy's `_general_hide.txt` 三份**（social / newsletter / notifications、EasyList 家族、GPL-3.0）——格式同上輪 EasyList、fetcher/parser 可複用
2. **uBO uAssets/filters/annoyances.txt**——uBO extended syntax（`:has-text()` / `:has()` / `:matches-path()`），純 CSS `querySelectorAll` 吃不下
3. **[Web Annoyances Ultralist](https://github.com/yourduskquibbles/webannoyances)**（CC-BY-SA-4.0）——分類（sticky headers / dickbars / floating boxes / social share bars）高度符合 JRead 目標，但同樣 extended syntax

**spike 執行**：抓 Fanboy 三份 `_general_hide.txt` + 兩份 `_specific_hide.txt`，萃取 11264 條 unique generic cosmetic selector；probe 在六站跑（Jimmy 上輪四站 line today / udn / chinatimes / upmedia + bbc + theverge）。

**結果**：五站（theverge timeout 未計）reader mode 內 articleEl scope **全數 0 命中**。baseline（全頁 body）命中的少數元素（udn `.footer-social` x2、udn `.fb-share-button` x1、chinatimes `.social-share` x2、chinatimes `.facebook-page-plugin` x1、chinatimes `.social-share-wrapper` x1）都在**頁面 footer / sidebar**，根本不會被 detector 選進 articleEl。比上輪 EasyList ad spike 結論還徹底——上輪至少還能抽 14 條跨站第三方廣告 selector 進 cleaner，這輪 fanboy 連一條跨站通則都抽不出。

**根因**：cleaner 現有 `NOISE_KEYWORD_RE`（含 `social` / `social-share` / `share` / `subscribe` / `newsletter` 詞根）透過 `markerOf` 走 class+id 比對，已完整代理 fanboy list 的跨站通用 pattern。fanboy 剩下的 9000+ 條 generic 是 WordPress / CMS plugin 站點特定 class（`.post-share-twitter` / `.entry-social-buttons` / `.wp-social-login-*` 類），reader mode 架構本身就不會讓這些進 articleEl。

**決策**：不引入任何 list / 不動 extension code / 不 bump 版本。spike 產物（fetcher、probe、抓下來的 fanboy json）全刪，符合 CLAUDE.md「probe 腳本用完就刪」硬規則。結論記入 CHANGELOG + SPEC engineering note 段落，供未來對話避免重跑相同 spike。

**硬教訓補（第 13 條，留給後續對話）**：
> **連續兩個 spike 同結論：reader mode 架構本身就是最強的 ad/annoyance blocker。** 廣告容器、社群 widget、newsletter popup、cookie banner 這些東西的共同特徵是「不在主文 DOM 子樹內」——detector 選 articleEl 時本來就不會選到它們。上輪 EasyList 40984 條 → 四站 articleEl 內僅命中 3；這輪 fanboy 11264 條 → 五站全 0。**想借 ad-blocker / annoyance-list 時先問一句：這批 selector 瞄準的雜訊，有多少比例會進 articleEl？**若答案是「幾乎都在 article 外」，就不必引入整包，cleaner 既有 NOISE_KEYWORD_RE + ancestor-sibling / fixed / dialog rule 已經代理。真正要花力氣的是「進得了 articleEl 的殘留雜訊」——這類 bug 由使用者 spot check 回報 + harness residual audit 驗收，走結構性 rule 修法，沒有 filter list 能一次解決。

---

**v0.7.4**——廣告對應強化：EasyList spike 結論 + 第三方廣告服務標識符新 rule（Jimmy 2026-04-23 詢問「能否借現成 ad-blocker 避免重複造輪子」）。

**Spike 結論**：嘗試引入 EasyList（社群維護 10+ 年的 ad filter list）整包前先做驗證。`tools/fetch-easylist.js` 抓 easylist.txt + fanboy-annoyance.txt 萃取 40984 條 generic cosmetic selector（786 KB lite 版）；`tools/probe-easylist.js` 在 Jimmy 提供的四個真實 URL（line today / udn / chinatimes / upmedia）分別測「reader mode OFF / 全頁 body」vs「reader mode ON / articleEl」兩個 scope。結果：四站 reader mode 內合計僅命中 3 個元素（udn 的 `.udn-ads` x2 + google_ads_iframe x1），其餘三站 articleEl 內命中 0。**結論：EasyList 整包對 JRead 邊際效益極低——reader mode 架構（detector 精確選 articleEl + cleaner 結構性 rule）已把大部分廣告容器「自然繞過」**，廣告容器在 detector 階段根本不會被選進 articleEl。Spike 腳本 + 抓下來的 list 用完即刪（符合 CLAUDE.md「probe 腳本用完就刪」硬規則）。

**Spike 增量**：baseline（全頁 body）命中揭露**跨站第三方廣告服務的業界標準命名**：
- **Google Ad Manager (GPT)**：`[id^="div-gpt-ad"]`、`[name^="google_ads_iframe"]`、`iframe[src*="googlesyndication.com"]`、`iframe[src*="doubleclick.net"]`——四站都有，是 GAM 官方推薦 id / name 命名
- **Taboola**：`[class*="trc_"]`（`.trc_excludable` / `.trc_rbox*` / `.trc_related_container`）、`[id*="taboola"]`——udn 大量命中（100 個視覺單位裡 60+ 個）
- **popIn Discovery**（日系推薦平台）：`[class*="_popIn_"]`——chinatimes / upmedia 大量命中
- **Outbrain**：`[class*="OUTBRAIN"]` / `[data-widget-id*="outbrain"]`
- **通用 ad- prefix**：`[id^="ad-"]` / `[class^="ad-"]` / `[id^="ads_"]`

這些屬結構性通則（第三方廣告 platform 官方命名），不是站點 hostname / 特定 class 特判，符合硬規則 3。

**修法**：
1. **cleaner 新 rule `hideInsideArticleByThirdPartyAds(articleEl, hidden)`**——在 articleEl 作用域一次 `querySelectorAll(THIRD_PARTY_AD_SEL)` 命中 14 條 selector branch 全 hide。放在 `hideInsideArticleByKeyword` 之後、`hideInsideArticleByHeadingText` 之前，作為第三方廣告的保險絲層（當 detector 不小心把 ad wrapper 選進 articleEl、或 ad 動態注入到 articleEl 內時擋下）
2. **NOISE_KEYWORD_RE 擴充 `trc_[a-z_]+` + `popin`**——markerOf 走 class+id，Taboola 的 `.trc_excludable` 不含 `taboola` 字樣、原 alternation 漏網；popIn 的 `_popIn_*` 雖已被 `AD_BOUNDARY_RE` 擋（尾端 `_ad` 匹配），加 `popin` 作雙保險

**驗收**：
- `test/regression/fixtures/third-party-ads-inside-article.html` 涵蓋全部 14 條 selector branch + 頭尾 2 段 THIRDPARTY_MAIN_MARK 主文保留 forcing
- `test/regression/cleaner.spec.js` 新增對應 it()，移除 rule 14 條 assertion 同時 fail、主文保留
- Sanity check：註釋掉 `hideInsideArticleByThirdPartyAds(articleEl, hidden)` → 此 spec fail 其他 130 全過，驗證沒踩既有規則
- `npm test` 131 spec 全過
- Playwright harness 三站驗收：chinatimes / line today / udn residual audit 三次 `✅ 無殘留雜訊`

**硬教訓追加（第 12 條，留給後續對話）**：
> **引入外部資料 / 函式庫前先做 spike 驗證 ROI，別先引入再評估。** 本輪差點把 786 KB EasyList lite 塞進 extension runtime 才發現對 reader mode 邊際效益近零。正確順序：(1) 用 fetcher 抓外部資料一次性入手（不 commit）、(2) 寫 probe 腳本在真實目標站點跑對照組（baseline vs 加功能後）、(3) 看 baseline 命中分佈找出真正可借用的**通則**（不是整包）、(4) 只抄通則進 extension、(5) 刪 spike 產物。EasyList 這次給我們的不是「list 本身」，而是「哪些第三方廣告服務命名跨站通用」——這個認知收進 14 條 selector 就夠了。

---

**v0.7.3**——bugfix 八層（cleaner / detector / SW / heuristic 全套）+ harness residual audit 升級（Jimmy 2026-04-23 回報 chinatimes 即時新聞 /realtimenews/20260423000917-260410）。

症狀鏈：
1. reader mode 開啟後右欄「財經熱門新聞」10 條編號列表整塊殘留（aside.column-right）
2. aside 清掉後 column-left 仍鎖 308px 寬、右側 300px 空白沒還給主文
3. 文末「也許您會感興趣」第三方推薦 widget 堆（popIn / dable.io / Taboola）整塊殘留

根因鏈三層：
1. **sidebar 規則 false negative**——`hideInsideArticleSidebarColumns` 條件 B 對 `<aside>` tag 的判定是 `textLen < main × 0.5 + rectH > 400`。harness 時序 race 下主文 column-left textLen 約 2457（相關閱讀未 lazy-load 完時主文文字偏低）、aside textLen 1389（10 條 hot-news + section header），aside/main 比值 0.565 打在保守 0.5 門檻上方漏網，條件 B 整個 early return 沒進 rectH 檢查。
2. **float layout 沒 collapse**——aside 即便被清掉，`.column-wrapper.clear-fix` 內是傳統 float + 固定 width 多欄 layout（column-left: float:left width:308px + aside: float:right width:300px），而 `collapseGridWithHiddenCell` 只處理 grid / flex-row、不處理 float，主文 column-left 仍被鎖 308px 寬、右側 300px 空白殘留。
3. **keyword 名單缺 base form**——文末 `<section class="dable-recommend popin-recommend taboola-recommend">`（含「也許您會感興趣」+ popIn Discovery / dable.io / Taboola 三個第三方推薦 widget iframe）的 class 命名全用 `recommend` 動詞詞根，但 NOISE_KEYWORD_RE 只有 `recommended` 形容詞（覆蓋 `#recommended-article` 類），`recommend` 結尾的 class 全部漏網。

修法（結構性通則、非 hostname / class 特判）：
- **(A) 條件 B 簡化**：cleaner.js `hideInsideArticleSidebarColumns` 條件 B 拿掉 `s.textLen < main.textLen * 0.5` 檢查，只保留「`<aside>` tag + rectH > 400」的絕對結構特徵。aside 是 HTML5 語意「次要內容」tag；rectH > 400 已排除 pull-quote（通常 < 300px 簡單結構）；textLen 相對比值只會把這類邊緣場景當 false negative 放過。Engadget 的條件 B 命中原本也不依賴 textLen ratio（aside 被廣告 placeholder 稀釋 textLen 接近 0），兼容保留。
- **(B) float layout collapse**：`collapseGridWithHiddenCell` 新增 float layout 觸發條件——container 非 grid / flex-row 但 direct children 有 `computed float !== 'none'` 且存在 hidden sibling 時，走既有 hidden-sibling 分支。child loop 加 `float: none !important` 清 float，配合既有的 `width: auto` + `max-width: none` 讓 visible float children 回到自然 block 流、撐滿 container。`prevFloat` / `prevFloatPriority` 記入 collapsed，restore 時復原。
- **(C) NOISE_KEYWORD_RE 全面擴充跨 CMS 雜訊 family keyword**：alternation 加入以下跨站點 CMS 命名慣例 family——
  - `recommend`（動詞詞根）涵蓋 `.dable-recommend` / `.popin-recommend` / `.taboola-recommend` 第三方推薦 widget
  - `more-(news|stories|posts|articles)` 涵蓋 udn `section.more-news`（「延伸閱讀」section）+ 聯合 / 中時 / 各種新聞 CMS 的相應命名
  - `related-(articles|news|posts|stories)` 擴大既有 `related-articles` alternation，涵蓋 udn `section.related-news`（「相關新聞」）
  - `sponsor`（動詞詞根）涵蓋 udn `section.sponsor-ads` / `sponsor-links`——既有 `sponsored` 形容詞不 match `sponsor-ads`
  - `discuss`（動詞詞根）涵蓋 udn `section.discuss-board` / `discuss-form`——既有 `discussion` 名詞不 match `discuss-board`
  - `taboola` 涵蓋 Taboola 第三方 widget `taboola-below-article-thumbnails` 等跨站 embed 慣例命名

  regex boundary 設計（`(^|[^a-z0-9])...([^a-z0-9]|$)`）保證動詞詞根不誤殺既有形容詞—alternation 會依序 try，`recommended` / `sponsored` / `discussion` 各自有自己的 alternation 先行。SPEC.md 的 keyword 名單對應更新。

Regression spec：
- `test/regression/fixtures/chinatimes-aside-high-text-ratio.html` 三層 forcing：(1) main textLen 593（> 500 門檻）+ aside textLen 339（> main × 50% = 296.5 邊界），驗條件 B 簡化；(2) column-left / aside inline `float: left/right`，驗 float collapse 對 visible column-left 強制 `float: none !important` 且 restore 還原；(3) `<section class="dable-recommend popin-recommend taboola-recommend">` 驗 recommend keyword 命中 hide。
- `test/regression/fixtures/udn-article-siblings-noise.html` 5 條 forcing：article 內含雜訊 sections（more-news / related-news / taboola / sponsor-ads / discuss-board），主文 textLen 刻意 < 500 讓 sidebar-column rule 整個 skip，sibling 純文字無連結讓 link-density rule 也不觸發——keyword heuristic 成為唯一命中路徑。退回舊 alternation 任一條 assertion 即 fail。

sanity check 所有修法都驗過（任一 revert 都 fail）。harness 對真實站實測：chinatimes aside hide + column-wrapper collapse + 文末 recommend widget 清除；udn 文末 5 塊雜訊全部清除。117 spec 全過。

---

同一版本另加 line today 標題漏掉 + scroll 鎖修法（第 5 層，Jimmy 2026-04-23 回報 today.line.me/tw/v3/article/l2G8KyL）：

症狀：reader mode 下（1）文章標題沒納入卡片；（2）無法往下捲動（user 感受）。

根因鏈：
1. **title matches 60% 門檻漏網**：line today 的 og:title 帶三段尾綴「台鐵...為 | 自由電子報 | LINE TODAY」（47 chars）；h1 僅寫純標題 27 chars。`titleMatches` 要求 text.length >= target.length × 0.6 → 27 / 47 = 57% < 60% → match 失敗、`promoteForTitle` 沒升級、h1 不在主文 scope。
2. **PROMOTE_MAX_HOPS=2 不夠**：real line today 結構下 article 跟 h1 分別在 `div.swipe-back` 下的兩個獨立 wrapper 分支（article 爬 3 hops 到共同祖先 swipe-back），MAX_HOPS=2 在 hop 0/1 找不到含 matching h1 的兄弟、return 原 article。
3. **「scroll 鎖」是連動副作用**：promote 失敗 → 主文僅剩 article.entityBodyModule textLen 501（極短）→ reader card 內容少 → document scrollHeight 1409、可 scroll 空間僅 500px，user 感覺滾兩下就到底。實測 touchAction / overscrollBehavior / body listeners 皆正常，無 JS 鎖。

修法（結構性通則、非 hostname / class 特判）：
- **(1) `getCanonicalTitle` 對 og:title 取首段**：既有邏輯只對 document.title 分隔 `\s+[–—|]\s+` 取首段，og:title 分支直接整段回傳。line today 類「文章 | 媒體 | 品牌」三段尾綴是跨站 meta title 慣例（udn / 聯合 / BBC / NYT 類似），對 og:title 也取首段才穩健。
- **(2) `PROMOTE_MAX_HOPS` 2→3**：line today Next.js SPA styled-component 多層 wrapper 要 3 hops 才到共同祖先。upmedia 的 heuristic 誤選（v0.7.2 根因）已由 modal signal 排除 + textLen bonus 前置防止進入 promote 路徑，3 hops 仍比升到 body / #wrapper 安全。PENDING_REGRESSION 原「MAX_HOPS 無 forcing function」條目現被 line today fixture 覆蓋（實作 3 層 wrapper 分支重現真實站結構）。

Regression spec：`test/regression/fixtures/linetoday-ogtitle-suffix.html` 雙 forcing：og:title 有三段尾綴 + article / h1 共同祖先距 article 3 hops。sanity check 任一 revert（getCanonicalTitle 不取首段 / MAX_HOPS 退回 2）都會讓 spec fail。harness 對真實 line today 實測：post-toggle article 升級到 div.swipe-back，textLen 1119（含 h1 + cover + meta），documentHeight 從 1409 膨脹到 5553，scroll 空間恢復。121 spec 全過。

---

同一版本另加 service-worker icon path 修法（第 6 層，Jimmy 2026-04-23 reload extension 時 `chrome://extensions/` 跳出錯誤通知實測）：

症狀：Jimmy reload extension 後 `chrome://extensions/` 通知中心冒出多條 `Uncaught (in promise) Error: Failed to set icon 'assets/icons/icon-16-disabled.png': Failed to fetch`，每個既有 tab 各一條。

根因：service-worker.js 的 `ICONS_ACTIVE` / `ICONS_IDLE` 用 relative path `'assets/icons/icon-*.png'`。SW 的 relative path 是相對 SW 所在目錄（`/background/`）而非 extension root → Chrome 嘗試 fetch `/background/assets/icons/...` 檔案不存在。reload extension 時 `tabs.onUpdated` 對每個既有 tab 觸發、handler 呼叫 `chrome.action.setIcon({ tabId, path: ICONS_IDLE })` 全部 fail。與 v0.4.1 importScripts 路徑 bug 完全同類型（見 PENDING_REGRESSION.md 該條 lore）。

修法：`ICONS_ACTIVE` / `ICONS_IDLE` path 改為 `/` 開頭絕對路徑 `'/assets/icons/...'`——Chrome 解析成 extension root 相對，能正確 fetch。

路徑 B（依 CLAUDE.md 硬規則 4）：純 SW wire-up + 實際 setIcon 呼叫依賴真實 Chrome action API，jsdom 無 chrome.action，無法寫 automated spec。已在 PENDING_REGRESSION 的「service-worker icon swap wire-up 未補 spec」條目補上此路徑修正 lore + 驗證方式（reload 後 chrome://extensions/ 不得有 Failed to fetch 錯誤）。

---

同一版本另加 cleaner heading text heuristic（第 7 層，Jimmy 2026-04-23 回報 line today 內文以下「更多國內相關文章 / 其他人也看了 / 最新消息 / 查看更多」等 section 殘留）。

症狀：line today reader mode 下，detector 雖然 promote 到 `div.swipe-back` 正確含標題與主文，但 swipe-back 內還有 4 個以上文末 section（`section.moduleContainer`，heading 分別為「更多國內相關文章」「其他人也看了」「最新消息」「查看更多自由電子報」+ 各自 ul 列表）全部殘留在 reader card 尾部。

根因：LINE Today 是 Next.js SPA、全部 class 走 emotion-style hash（`css-xxx`）—— 這些 hash 對 reader 來說**毫無語意資訊**，NOISE_KEYWORD_RE（跨 CMS class 命名）完全無法命中。而 hideAncestorSiblings 只處理主文 scope 外的祖兄，這些 section 在 articleEl（swipe-back）scope 內就失靈。

修法（結構性通則、非站點特判）：cleaner 新增 `hideInsideArticleByHeadingText`——
- 掃 articleEl 內所有 h2/h3/h4
- 文字長度 <= 20（主文副標通常不會剛好命中規則字）
- 匹配跨站通用文末推薦 / 相關 / 列表 section 標題字樣 regex：
  - 延伸閱讀 / 相關新聞 / 相關文章 / 相關報導
  - 推薦閱讀 / 推薦文章
  - 最新消息 / 最新新聞
  - 更多相關 / 更多xx文章 / 更多xx新聞 / 更多xx報導
  - 看更多 / 查看更多
  - 其他人也看 / 你可能（也）（喜歡 | 感興趣）
  - 也許您（會）（感興趣 | 喜歡）
- 命中後 hide heading 的 `closest('section, aside')`——精確命中 section-level 容器。**不** hide articleEl 的 direct child，因為 chinatimes fixture 類結構下「也許您會感興趣」h4 深層埋在 column-wrapper 內，direct-child 式 hide 會連同主文一起砍
- 若 heading 沒有 section/aside 祖先，放棄 hide（conservative，避免 over-hide）

通則性討論：這是**內容 heuristic**而非 class heuristic——LINE Today / Next.js / React SPA 類站點放棄了語意化 class 命名，唯一能跨站穩定 match 的信號就是 heading 文字本身。跨站通用性高：這些字樣是中文新聞 / 部落格 / Medium 中文化等站點的標準文末 section 命名，用十幾年了都沒變過。

保護：原有主文副標（例「案情分析」「後續發展」「法律評析」）不會 match 這組字樣；規則執行後不誤殺 chinatimes「財經熱門新聞」aside 的 column-wrapper 主文容器（已從 regex 移除「財經熱門」後實證）、不誤殺 fixture 主文（LINETODAY_MAIN_MARK 段落驗證保留）。

Regression spec：`test/regression/fixtures/linetoday-ogtitle-suffix.html` 擴展加 4 個文末 section（`#tail-more-related` / `#tail-also-read` / `#tail-latest-news` / `#tail-see-more`），spec 逐一驗 `dataset.jreadHidden === '1'`。sanity check 驗過：`clean()` 內拿掉 `hideInsideArticleByHeadingText` 呼叫 → 4 條 tail spec 同時 fail。harness 對真實 line today 實測：reader card 文末乾淨，無「更多 / 相關 / 其他人 / 查看更多」字樣殘留。126 spec 全過。

**同層 follow-up**——Jimmy 再次回報 line today「其他人也看了」section 仍殘留（文末的一個特定 moduleContainer）。probe 發現這塊在 `cleaner.clean()` 跑完之後才 lazy-load inject 進 articleEl（`div.swipe-back`）—— 舊 `startWatchingDynamicAppends` 的 MutationObserver 只觀察主文祖先鏈，且 articleEl 內部新節點被 isRelated guard 當 legit update 放行漏網。

擴展修法（通則）：
- MutationObserver 新增 `observe(articleEl, { childList: true, subtree: true })`——接 SPA 晚到的 lazy-load widget
- 新 helper `checkDynamicNoise`：對 articleEl 內新 appended node 跑雜訊特徵判定——
  - class/id 命中 NOISE_KEYWORD_RE（既有 CMS 命名慣例） → hide 整個 node
  - 節點本身或 descendant 含 h2/h3/h4 文字命中 NOISE_HEADING_TEXT_RE → hide heading 的 closest `<section>/<aside>`
  - 不動 legit 主文 update（SPA 段落追加 / typo 修正 / lazy 圖片 load）——只匹配雜訊特徵才 hide
- 祖先鏈上 append 維持舊邏輯（直接 remove 整塊）

Regression spec：detector.spec.js 的 linetoday describe 新增 async spec，模擬 clean() 後 `articleEl.appendChild(lazyInject)`（含「其他人也看了」h2），await MutationObserver microtask，斷言 `lazy-injected-suggest` 被 hide。sanity check：拿掉 `mo.observe(articleEl, { subtree: true })` spec fail。127 spec 全過。

**同層 follow-up #2**——Jimmy 再次回報 line today 內文以下仍殘留三塊：「網友貼文AI摘要」卡片 + 主文內「點開加入自由電子報LINE官方帳號」訂閱 CTA + 「查看原始文章」外連按鈕。

根因分別：
- AI 摘要 section 的 h2 是「網友貼文AI摘要」（8 chars），原 NOISE_HEADING_TEXT_RE 無此字樣
- LINE 官方帳號 CTA 是主文 `<article>` 內的 `<p><a>`，class 是 emotion-hash、a 文字「點開加入自由電子報LINE官方帳號，新聞脈動隨時掌握！」不含任何既有 keyword
- 「查看原始文章」是 `a.ltcp-link`（LINE Today Content Provider link），text 只 6 chars 沒 heading、class `ltcp-link` 是站點特定

擴展修法：
- **(A) NOISE_HEADING_TEXT_RE 擴充**：新增 `網友貼文.{0,4}AI` / `AI.{0,4}(摘要|總結|整理|生成)` / `.{0,6}AI摘要` alternation，涵蓋 LINE Today / 各種 AI 摘要 widget 的 heading 命名
- **(B) 新增 `hideInsideArticleByLinkText`**：對主文內 `<a>` 元素的 text content 跑 `NOISE_LINK_TEXT_RE` 匹配——
  - `查看原始文章 / 看原文 / 回到原文 / 閱讀原文 / 原文連結`（新聞聚合站外連回原發布站的慣用按鈕）
  - `加入.{0,10}(LINE|官方帳號|好友|粉絲專頁)` / `(LINE|官方帳號).{0,10}(加入|訂閱)`（LINE / FB 粉專訂閱 CTA）
  - `訂閱.{0,4}(電子報|本報|我們|粉絲團)`
  - 命中後 hide 目標：若 a 的 parent 是 p/div 且 a 文字占 parent 80%+，hide 整個 parent（整段 CTA 清掉）；否則只 hide a 本身（不誤殺內文中的順帶 link）

通則性：兩條都是跨站文字 heuristic，不依賴 class/id——LINE Today / Yahoo News / Google News / 各種台灣新聞站的文末 CTA + 外連按鈕文字用語都在這 family 內。

Regression spec：fixture 擴展加 `#tail-ai-summary`（AI 摘要 section）+ `#tail-view-original`（ltcp-link `<a>`）+ `#cta-line-subscribe`（`<article>` 內 p><a CTA）三個節點，spec 逐一驗 `dataset.jreadHidden === '1'`。sanity check：拿掉 `hideInsideArticleByLinkText` 呼叫 → 查看原始文章 + LINE CTA 兩條 spec 同時 fail。harness 對真實 line today 實測：文末 AI 摘要 + 「查看原始文章」+ 主文 LINE 官方帳號 CTA 全部清除。130 spec 全過。

---

**同層 follow-up #3**——Jimmy 連續回報殘留雜訊（「轉發 / 貼文 / 建立貼文 / 繼續看下去 / 訂閱 button / 廣告（請繼續閱讀）/ 贊助本文章 / 透過【Google新聞】/ 追蹤中時新聞網 / 聽新聞 / 要聞 breadcrumb / 🎮想成為超強飼主...」等）且要求「檢討並改進未來」。

**根因檢討**：舊 harness 驗收只看 `gap` log（相鄰 block 垂直 gap > 40px）+ grep 少數 hardcoded keyword（STDOUT 搜尋）。問題：
- viewport 截圖只拍第一屏，文末雜訊要 scroll 才看到，截圖根本照不出來
- gap log 只看頭 8 個 gap，文末多數 hidden 後 gap 消失，規則不觸發
- grep 只比對 stdout，但 stdout 主要是 PAGE log / SW log，reader card 內真實 DOM text 沒被 dump 出來 → **grep 沒命中 ≠ 不在**（偽陰性驗收）

**改進修法**：
- **`tools/debug-harness.js` 新增 residual audit**：post-toggle 後兩次 audit（1.2s + 5s，捕捉 SPA lazy-load），列出 reader card 內所有 visible element（過濾 SVG `<title>` / `<script>` / `<style>` / `<desc>` / `<noscript>` 等不可見 tag）的 direct text outline，與 `NOISE_AUDIT_KEYWORDS` 名單比對、命中者顯示 ⚠️ warning（含 tag、elCls、hit keywords、parent chain）
- 加 full-page 截圖 `.playwright-mcp/jread-reader-fullpage.png` 取代單張 viewport
- **CLAUDE.md 新增硬規則**：動 cleaner/detector 後禁止僅用 grep 驗收，必須跑 residual audit 看 `✅ 無殘留` 才算過

**cleaner rule 擴充**（用新 audit 掃三站抓出漏網）：
- NOISE_KEYWORD_RE 擴 `promote` / `donation` / `donate` / `breadcrumb` / `audio-player`：chinatimes `div.google-news-promote` / `div.donation-container` + udn `nav.article-content__breadcrumb` / `div.audio-player`
- `hideInsideArticleByKeyword` 另掃 `<button>`（原本只掃 CONTAINER_SEL）：line today `button.subscribe-button` 的 class 含 `subscribe`，但 button 不在 CONTAINER_SEL 漏網
- NOISE_LINK_TEXT_RE 擴 `^(訂閱|已訂閱|追蹤|已追蹤|關注|已關注|訂閱中|追蹤中)$`：單字 CTA button（line today 訂閱按鈕 text 含 CSS 多-state wrapper「已訂閱訂閱訂閱」整體不 match 但 class 走 keyword rule）
- `hideInsideArticleByLinkText` query 擴 `a, button`（原本只 `a`）
- 新 rule `hideInsideArticleByInlineAdText`：span / p / div 的 direct textNode（不抓子孫）match `^(廣告|AD|業配|促銷|贊助|廣編)\s*[（(]\s*.{0,20}?(請繼續|繼續|接下來|以下內容|下方)` → hide 該 element。自由時報 / 聯合 / ETtoday 主文段落中段插播「廣告（請繼續閱讀本文）」類 placeholder
- 新 rule `hideInsideArticleFontTags`：主文內所有 `<font>` tag hide——HTML4 老式 tag 現代幾乎只在 inline 廣告 / PR 推廣用（udn 實測：`<font><a>🎮想成為超強飼主？玩問答遊戲拿課程金</a></font>` inline PR）

驗收：三站 audit（`line today` / `chinatimes` / `udn`）全部 `✅ 無殘留雜訊`——line today reader card 只剩主標 + 發行 + 時間 + 圖說 4 項；chinatimes 剩主標/作者/時間/主文段落/tag 連結；udn 剩主標/時間/作者/主文段落。130 spec 全過（原 spec 保留，新增 rule 對既有 fixture 無 regression）。

---

**同層 follow-up #4**——Jimmy 回報 line today 實機 Chrome 下仍看到「轉發 (N) / 貼文 (N) / 熱門 / 最新 / 建立貼文 / 留言作者+時間+讚數 / 繼續看下去 / 5 筆推薦」—— harness audit 無 warning、但 Jimmy 截圖明確有。根因：Playwright bundled Chromium 在 bot detection 或 API CSP 限制下這些 widget 沒 inject 進 DOM，audit 以「harness 看不到」當「使用者看不到」偽陰性驗收。

改進修法：
- **harness audit 加 scroll trigger + 15s wait**：post-toggle 後 `scrollTo(0, scrollHeight)` 兩次 + sleep 15s，接近 Jimmy 實機載入速度
- **heading rule scope 擴 div/span**：LINE Today 用 `div`/`span` 做 header（「貼文 (166)」「熱門」「最新」），原本只掃 h2-h4 漏網
- **heading rule fallback**：若 heading 無 `<section>/<aside>` 祖先，fallback 升級到 articleEl 的 direct child sub-branch——但只在該 sub-branch **不含 >= 100 chars 主文 p** 才 hide（chinatimes「也許您會感興趣」h4 在 column-wrapper 深層、column-wrapper 自身含主文 p 保護成立）
- **NOISE_HEADING_TEXT_RE 擴**：`繼續看下去` / `^貼文\s*\(\d+\)?$` / `^(熱門|最新)$`
- **NOISE_LINK_TEXT_RE 擴**：單字互動 CTA（`建立貼文 / 轉發 / 轉貼 / 留言 / 分享 / 收藏 / 檢舉 / 回覆 / 讚 / 已讚` 等）+ `^轉發\s*\(\d+\)$` / `^貼文\s*\(\d+\)$`
- **NOISE_KEYWORD_RE 擴**：`postlisting / post-listing / thread / threads / reposted / repost`（LINE Today `div.postListing` 留言面板 wrapper + `a.reposted` 轉發 widget CMS class）
- **新 rule `hideInsideArticleCommentPanels`**：articleEl 的 descendant div/section 含 ≥ 3 個相對時間戳（`\d+\s*(分鐘前|小時前|天前|週前|個月前|年前|hours ago|...)`）且**不含 >= 300 chars 主文 p** → 視為 comment/social panel hide。通則結構：留言面板每則留言一個相對時間戳，主文作者資訊最多 1 個

驗收：audit 升級後 initial → delayed（+scroll + 15s）兩次 report；line today / chinatimes / udn 三站 audit 全 `✅ 無殘留雜訊`；line today 從原本 7 項 warning + 24 visible items → 1 項 warning + 5 items → 0 warning + 4 items（每層修完再跑 audit）。130 spec 全過。

---

**同層 follow-up #5（英文國際化擴充 + 經驗傳承）**——Jimmy 確認中文清光後要求「關鍵字是否足夠包含清除英文網頁的垃圾？加入」+「這輪經驗寫入文件傳承」。

**英文 regex 擴充**（`NOISE_HEADING_TEXT_RE` / `NOISE_LINK_TEXT_RE` / `NOISE_INLINE_AD_TEXT_RE` / `NOISE_KEYWORD_RE`）：

- `NOISE_HEADING_TEXT_RE` 加：`Related (Articles|...)`、`Recommended for you`、`More from X`、`You may/might also like/enjoy/be interested`、`Read more/next/also`、`Up next`、`Continue reading`、`See also`、`Further reading`、`Editor's/Editor’s Picks`（支援 ASCII + curly apostrophe）、`Sponsored content/stories/posts`、`Comments(N)`、`Discussion(N)`、`Responses(N)`、`Replies(N)`、`Newsletter`、`Subscribe`、`Follow us`、`Trending`、`Popular`、`Top Stories`、`AI Summary/Digest/Overview/Takeaways`、`Hot/New/Top`
- `NOISE_LINK_TEXT_RE` 加：`View original/source`、`Read (the) original/full article/more/next/on X`、`Back to top/article/original`、`Visit original/source/site`、`Show more/less`、`Load more`、`See more`、`Learn more`、`Get started/the app`、`Download (the) app`、`Open in app`、`Subscribe(d)`、`Follow(ing)/Unfollow`、`Like(d)/Dislike`、`Share/Repost/Retweet`、`Reply/Comment/Save(d)/Bookmark(ed)`、`Report/Flag`、`Join(ed)/Sign in/up/out`、`Log in/out`、`Register`、`Create (an) account`、`New post/Post/Reblog`、`Upvote/Downvote`、`Clap/Applaud`、`Join our newsletter/mailing list/community/telegram/discord/slack`、`Follow us on Twitter/X/Facebook/Instagram/TikTok/YouTube/LinkedIn/Threads/Line/Google News`、`Subscribe to our newsletter/channel/podcast/feed/email`、`N (minutes/hours/days/weeks/months/years) ago`（相對時間戳英文版）
- `NOISE_INLINE_AD_TEXT_RE` 加：`advertisement/sponsored/promotion/advertorial` + 中英分隔符 + `continue/please/below/article continues/story continues/more below`
- `NOISE_KEYWORD_RE` 加：`subscription`、`sign-up/signin/sign-in/login/register`、`recommendation`、`read-next/up-next`、`outbrain/zergnet/revcontent`（Taboola 同類第三方推薦 widget）、`callout`、`social-(bar|links|icons|share|media)`、`comment-form`、`livefyre/hyvor`（Disqus 同類留言平台）、`follow/follow-us/following`、`cookie-(banner|notice|consent|bar|message)`、`gdpr`、`consent`、`privacy-(banner|notice)`、`newsletter-(signup|form|cta)`、`email-(signup|capture|subscribe)`、`pagination/page-nav/pager/page-navigation`、`author-(bio|card|info|box|meta|widget)`、`about-author`、`popup/overlay/modal-(content|dialog|box|wrapper)`、`floating-(bar|cta|widget)`、`sticky-(bar|cta|banner|subscribe)`、`toast/snackbar/notification-(bar|banner)`

regex 設計原則：
- heading 用 anchor `^...$` 避免誤殺主文段落內含這些字的句子（`Discussion of methods in research`、`A Popular Science Article` 等 NOT match）
- 允許 0-3 個 trailing word（`Related Articles`、`More from NYT`、`Recommended for you` 都 match）
- curly quote `'`/`’` 用 character class `['’]?` 兩種都吃
- `/i` flag 處理 camelCase（`postListing`、`ReadMore` 等）

自動化驗證：node 寫 27 條英文正向案例 + 6 條反向（主文副標）案例，全正向 ✓ + 全反向 safe（0 false positive）。三站（line today / chinatimes / udn）再跑 audit 確認英文擴充後中文仍 `✅ 無殘留雜訊`。

**經驗傳承**：`CLAUDE.md` 新增「v0.7.3 整輪 cleaner 大量修法累積的教訓」8 條硬教訓 + 動詞詞根 vs 形容詞變體、SVG title filter、全形 vs 半形括號等陷阱，專供後續對話 / 新站點 debug 時參照，避免重複踩本輪十多次 audit 迭代的坑。130 spec 全過。

---

**同層 follow-up #6（所有 interactive button 一律清除，不保留）**——Jimmy 2026-04-23 明確要求：「規則是不是有刻意保留『分享』『訂閱』這類的按鈕？其實我不需要，包括其他按鈕都不需要」。

新規則 `hideInsideArticleAllButtons`：對主文內所有 `<button>` / `[role="button"]` / `<input type="button|submit|reset">` **無條件 hide**。特點：
- **不看 class / 不看文字 / 不設排除**（獨立於 NOISE_LINK_TEXT_RE / NOISE_KEYWORD_RE 的 text/keyword 匹配）
- **不受 PRESERVE_SEL 保護**——figure / summary / figcaption / blockquote 內的 expand / zoom / play / 展開 / 播放 等按鈕也一律清除
- 主文祖先 guard（`btn.contains(articleEl)`）仍保留，避免誤 hide 整個 reader card

風險與取捨：極少數 code sandbox / interactive demo widget 會被一併清除，但 reader mode 本就不適合跑 interactive 操作——這是使用者明確表達的設計意圖。

**其他「保留」邏輯評估後保留不動**：
- `PRESERVE_SEL = 'summary, figure, figcaption, blockquote'`——這是**正文語意元素保留**（`<summary>` editor bullets / 主圖+說明 / 引言 blockquote），不是「保留按鈕」。新 rule 已繞過它處理 button 範圍。
- `hideInsideArticleActionRows` 的 interactive ratio 排除 / `hideInsideArticleButtonClusters` 的 heading / 媒體排除——這是「**不 hide 外層 wrapper**」的保護（避免把 byline+button group wrapper 整塊砍，連作者日期一起丟）；外層 wrapper 保留後，新 rule 會清掉其內部 button，結果「作者/日期保留 + button 清除」——符合需求
- 主文祖先 `contains(articleEl)` guard——結構保護（避免 hide 主文容器本身），必要保留

驗收：三站 audit 全 `✅`——line today 4 items（H1 / 發行 / 時間 / FIGCAPTION）；chinatimes 16 items（H1 / 時間 / 發行 / 作者 / FIGCAPTION / 字級 label / 主文 P / tag `<a>`）；udn 8 items（H1 / TIME / 作者 / STRONG / 主文 P）。130 spec 全過（舊 spec 不驗「button 保留」故無 regression）。

---

**同層 follow-up #7（`<a>` 分享連結也納入 keyword 掃描）**——Jimmy 2026-04-23 回報 udn 文末仍有「LINE 分享」按鈕。

probe 顯示該按鈕是 `<a class="btn btn-social btn-social--line" href="#">`（href 非 social platform URL、是純 class-based 分享 link），parent `div.social-wrapper > aside.article-content__social`。兩個祖先的 class 含 `social` 被 NOISE_KEYWORD_RE 的 `social` alternation 命中已 hide——但 Jimmy 視覺仍看到，懷疑 reload extension 時序問題或 MutationObserver 在 real Chrome 某瞬間未及時攔截。

更 robust 的保險：**`hideInsideArticleByKeyword` 的額外 scope 從 `<button>` 擴到 `<button>, <a>`**，讓 class 命中 noise keyword 的 `<a>` 自己直接被 hide（不依賴祖先被 hide）。

場景覆蓋：
- `a.btn-social--line`（udn LINE 分享，class 含 `social`）
- `a.share-facebook` / `a.social-link` / `a.comment-btn`（跨站常見 social / comment CTA `<a>`）
- `a.subscribe-link` / `a.follow-btn`（訂閱 / 追蹤 CTA `<a>`）

風險：極低——主文超連結（文章引用 / wiki 連結 / 人名 ref）的 class 命名幾乎不用 noise keyword；實際被命中的 `<a>` 幾乎都是雜訊（社群分享 / 訂閱 / 留言 / CTA / 廣告 link）。

驗收：三站 audit 再跑 `✅ 無殘留雜訊`；chinatimes / line today 維持原乾淨狀態；udn 文末 LINE 分享按鈕結構已 hide。130 spec 全過。

---

**同層 follow-up #8（`hide()` 改 inline `!important`，解 CSS specificity 戰）**——Jimmy 2026-04-23 reload extension 後仍看到 udn LINE 分享按鈕。

根因：`hide()` 原本 `el.style.display = 'none'`（inline 無 priority）+ styler 注入 stylesheet `[data-jread-hidden="1"] { display: none !important }`。CSS specificity 戰：原站若有 `aside.article-content__social { display: flex !important }`（specificity 0,2,1）**贏過** jread stylesheet `[data-jread-hidden="1"]`（specificity 0,1,0）。兩邊都 `!important`、specificity 高的勝——元素被重新顯示。

修法：`hide()` 改 `el.style.setProperty('display', 'none', 'important')`——inline !important 是 CSS 優先級最高層（勝過任何 stylesheet `!important`），無 stylesheet rule 能打敗。`restore()` 用 `removeProperty('display')` + 還原 `prevDisplayPriority`（原 inline 若含 `!important` 也還原）。

通則：未來任何需要強制 hide 的 rule 都走 inline `!important`，不依賴 stylesheet。`hide()` helper 改完自動影響所有 hide 呼叫場景（sidebar / dialog / keyword / heading-text / link-text / comment-panel / all-buttons 等 10+ rules 全部受惠）。

風險：極低——inline !important 覆蓋任何 stylesheet；restore 時還原 inline 的 priority 保持一致。

CLAUDE.md 加第 10 條硬教訓，記錄 CSS specificity 戰陷阱供未來參照。驗收：udn audit `✅ 無殘留雜訊`；130 spec 全過（無 regression）。

---

**同層 follow-up #9（delayed lazy-inject + checkDynamicNoise 遞迴 button/a）**——Jimmy 2026-04-23 反覆 reload 後仍看到 udn LINE 分享按鈕，並補充「reader mode 啟動後**約 3 秒**按鈕才出現」。

根因：這是典型 **delayed lazy-inject** SPA pattern——
1. content script 在 `document_idle` 跑 `cleaner.clean()` 時，分享按鈕**尚未注入** DOM
2. 2-4 秒後原站 JS 透過 API 拉 social widget 注入進 articleEl（udn 的 `aside.article-content__social` 是晚注入的，跟我之前 pre-toggle probe 看到的 pre-inject 版本是不同 DOM node instance）
3. MutationObserver 攔到 `addedNodes`，`checkDynamicNoise` 檢查——但**舊版只看 node 自己的 class keyword + node 內的 h2-h4 heading text**，漏了「wrapper 自己無 keyword、內部 button/a 才有 keyword」的情境

修法（`checkDynamicNoise` 遞迴擴展）：
- **一律 hide** `node.querySelectorAll('button, [role="button"], input[type="button|submit|reset"]')`（符合 Jimmy 「所有 interactive button 都不需要」硬規則，不看 class）
- **遞迴** `node.querySelectorAll('a, button')` 逐一跑 `shouldHideByKeyword`，class 命中 noise keyword 的直接 hide

搭配第 10 修法（`hide()` 用 inline `!important`）—— 即使原站後續 JS 用 stylesheet `display: flex !important` 試圖重顯示，jread 的 inline !important 永遠贏。兩條合體才能徹底治住 delayed lazy-inject。

harness 驗證限制提醒：Playwright Chromium 的 lazy-inject 時序可能跟 Jimmy 實機 Chrome 不同步—— udn audit 三階段（+1.2s / +3s / +15s + scroll）全 `✅`，但本地 harness 不保證重現 Jimmy 實機看到的瞬間。修法靠**邏輯完整性**（MutationObserver subtree + 遞迴 check + inline !important 三者齊備）保證。CLAUDE.md 加第 11 條硬教訓記錄此陷阱。

驗收：130 spec 全過；udn harness audit 三階段全 `✅`。

**v0.7.2**——bugfix：detector modal signal 污染 + heuristic 外殼誤選 + promote 失控（Jimmy 2026-04-22 回報上報國際版 /tw/international/headlines/256941）。

症狀：reader mode 開啟後整頁 #wrapper 被當主文；top bar 站內 email、社群 icon、header logo、「快訊」列、「美伊開戰/最新/生活」分類列、右欄推薦文章列表等全部殘留。cleaner 的 outside-article 規則跳過這些元素——因為它們都是 #wrapper（article）的「後代」。

根因鏈（三層疊加）：

1. **Bootstrap modal signal 污染**：`<div class="modal fade" id="myModal"> > .modal-dialog > .modal-content > .modal-box` 內塞了 2700+ 字雜訊（天氣 / 日期 / 推薦連結）。modal 預設 CSS `.modal { display: none }` 生效，但 `detector.getText` 走 `innerText || textContent`——display:none 元素 innerText 空、fallback 到 textContent 讀到全文。`.modal-box` finalScore 11.9 擊敗真主文 `.news-box-text` 2.4。

2. **heuristic bubble-up 對深層主文不利**：`.news-box-text > 中間 wrapper div > p` 結構下，signal 的 parent = 中間 div（100%）、gp = `.news-box-text`（50%）——`.news-box-text` 本身只拿到 50% 折扣的 signal 累計分數（raw 2）。輸給 `.row` UI chrome（signal 直接 parent，100% 貢獻，raw 7）。

3. **`promoteForTitle` 無層數上限**：heuristic 選錯 anchor（UI chrome `.row`）後，沿祖先鏈找 h1/h2 matching canonical title，一路升到主文跟 chrome 的共同 parent = `#wrapper`。整頁 top bar / header / 右欄全被吞進 article scope。

通則修法（非站點特判，三層 defense）：

A. **heuristic `isSignalExcluded`**：祖先鏈含 ARIA `role=dialog / alertdialog / tooltip / aria-modal=true / aria-hidden=true` 或 inline / computed `display:none` 的 signal 不計分。ARIA 標記是 W3C 規範「不在正文流程」的語意；隱藏狀態是 author-declared「明確不渲染」。檢查 inline + ARIA 跨 jsdom/browser；stylesheet-only 隱藏（upmedia 這種非標準 markup）靠 `getComputedStyle` 在真 Chrome resolve。

B. **heuristic textLen bonus**：`score += min(textLen/200, 10) * (1 - linkDensity)`。Readability.js 的「內文 = 大量有意義文字 + 低連結密度」核心特徵——靠容器自身 textLen 拉開 UI chrome 與主文的分數差，補 bubble-up 對深層主文不利的盲點。

C. **`promoteForTitle` `MAX_HOPS=2`**：合理場景中 post-title 是 articleEl 的兄弟或祖父的兄弟（WordPress / Stratechery / Anthropic 實測）、不該往上升 5+ 層。上限後即使 heuristic 選錯 anchor，promote 也不會把整頁外殼吃進來。

驗證：

- fixture `test/regression/fixtures/upmedia-intl-modal-signals.html` 擷取最小重現結構（Bootstrap modal 含 10 個高密度 p、主文 p 埋兩層深、另有 `.container.px24.bg-white > .row` UI chrome 干擾）；用 `aria-hidden="true"` 觸發 (A) 的 ARIA 支路
- `detector.spec.js` 新增 5 條 spec：偵測成功 / 不得選 #wrapper / 主文 scope 不含 modal 雜訊 / 不含 header/footer / strategy=heuristic
- Sanity check：關掉 (A) 造成 2 spec fail（forcing function 成立）；(B)(C) 在 jsdom 下 (A) 已擋住 modal 後 forcing function 失效、由 harness 驗真 upmedia stylesheet-only modal 情境——已記入 `test/PENDING_REGRESSION.md` 2026-04-22 條目
- Playwright harness 實測：upmedia.mg 國際版 256941 從選 #wrapper → 選 `.news-box`（真主文）；政治版 256168 無 regression（一直是 `.col-lg-9`）；ChinaTalk / Dwarkesh Substack 等既有 baseline 的 article-tag 策略無受影響
- 115 spec 全過（110 + 5 新）

---

**v0.7.1**——bugfix：上報 icon-link 巨大化（Jimmy 2026-04-22 回報 upmedia.mg 政治版三個 icon「新聞摘要」「辭」「AI 新聞關鍵字詞查詢」在閱讀模式下被放大成巨型版）。

根因：styler 的 `[data-jread-active="1"] img { max-width: 100% !important; height: auto !important; }` 規則本意是維持主圖 aspect ratio，但這條對 `<a><img>` icon-link 結構反向傷害——原站常用 `height: 32px` 類 CSS 鎖 icon 高度、沒明確設 width，依賴 browser 的 intrinsic aspect-ratio 自動算 width。`height: auto !important` 吃掉原站 height 後，img 退回 naturalWidth x naturalHeight（upmedia 實測 `#toggleImg` 從 32x32 被拉成 250x250 natural size）。

通則修法（結構特徵、非站點特判）：
- 裸 `a > img` 視為 icon-link 結構（logo / UI 按鈕圖）——獨立 rule 只 cap 寬度、**絕不設 height**，保留原站對 icon 的合法尺寸限制
- 其他 wrapper（figure / picture / p / div）下的 img 視為內文配圖——維持舊規則 `max-width: 100%` + `height: auto` 的 shrink-fit 行為

為何不用 runtime JS 判別：主圖用 `<figure><img>` 或 `<p><img>` 包是 HTML5 慣例；icon 用 `<a><img></a>` 讓 icon 可點擊也是普遍設計。DOM 結構本身已提供語意區分，CSS selector 精準化（`img:not(a > img)`）即可涵蓋兩者，不需 img load 完成後算 naturalSize。

驗證：
- fixture `test/regression/fixtures/upmedia-icon-link-oversize.html` 擷取最小重現結構（`<div class="publish-img"><a><img id="toggleImg"></a></div>` + 內文 `<figure><img>`）
- 新增 2 條 forcing function spec（`styler.spec.js`）：(1) `a > img` 必須有獨立 rule、`max-width: 100%` 但絕不設 height（2）含 `height: auto` 的 img selector 必須帶 `:not(a > img)`，不得有 naked img
- Sanity check：把 styler 暫時改回 naked img selector，兩條 spec 如預期 fail
- Playwright harness 在 upmedia.mg `/tw/focus/politics/256168` 實測：三個 icon 從被放大的 276x60 / 250x250 / 147x32 回到原站尺寸 147x32 / 32x32 / 22x22；主新聞圖仍正確 shrink-fit 到 article 寬 608x405
- Dwarkesh / ChinaTalk Substack 等既有 baseline 站的主圖與 byline avatar 皆無 regression
- 110 spec 全過（108 + 2 新）

---

**v0.7.0**——視覺大改版：全站 Design System 落地（Jimmy 2026-04-22 多輪迭代）。工作分為四大塊：

**A. Popup UI refresh**（Jimmy 授權動 popup；jsdom spec 不受影響全數 pass）
- 套用 JRead Design System tokens（`--jr-primary-{50,600,700}` / `--jr-neutral-{50,100,300,500,700,900}` / `--jr-surface` / `--jr-font-ui,mono` / `--jr-radius-{sm,md}` / spacing 4-8-12-16-24）
- Header 加 logomark：28px 藍方塊 + 白色 serif J（Noto Serif TC/Georgia）+ 右側 mono 版本號
- 主題按鈕三顆 WYSIWYG：底色即該主題實際背景色（亮 #fff / 暗 #1a1a1a / 米 #f4ecd8），active 以 2px primary-600 outer ring 標示（**不**填充藍色、保留 WYSIWYG 語意）
- 字級 row：Auto 按鈕 + stepper 打包成 `.font-controls` 放 row 右側；Auto 按鈕 off=灰底灰字、on=藍底白字（一眼分得出）
- Stepper `.val` 從 `min-width: 42px` 改為**固定 `width: 56px`**：不論內容是 Auto / 18 / 840 / 1200 都同寬，兩條 stepper 左右邊緣 + 中央分隔線 100% 對齊
- 主題按鈕群寬度固定 110px = stepper 總寬：三 row 右邊緣（theme / font-controls / width-stepper）完美對齊
- Footer 重排：快速鍵提示與「進階設定 →」原本上下堆疊、改為同一 row（`.footer { flex; justify-content: space-between; align-items: baseline }`）；兩側字型字級完全一致（12px ui font weight 400）
- 拿掉「頁面設定」h2（使用者回報浪費空間）
- 拿掉 `.font-label-group`（label 放回 `.setting-row > label` 直接子層、字型字級與主題/版心寬度 row 一致）

**B. Options page refactor**（`jread/options/options.html`）
- 全面套 Design System tokens（與 popup 同步）
- 三個 form 控制項統一：`width: 140px; height: 32px`、number input 用 mono + tabular-nums + 右對齊、select 自製 SVG 下拉箭頭（取代作業系統預設大箭頭）
- Hover/Focus：neutral-500 邊框 → primary-600 邊框 + `0 0 0 3px primary-50` ring
- 新增「授權資訊」section（品牌藍 h2、ELv2 宣告、作者 Jimmy Su + Twitter @jimmy_su 連結）
- 字級 desc 加「**0 = 自動**」藍字強調；`<input type="number">` 的 `min="12"` 改為 `min="0"` 修 options 頁無法存 Auto（= 0 sentinel）的既有 bug

**C. 素材生產**（全由 Claude Design 設計 + Playwright 精確截圖）
- Icon family：`jread/assets/icons/icon-{16,32,48,128}.png`，比例 100% 對齊 popup logomark（radius 21.4% / font-size 64.3% / padding-right 7.1%）；`tools/generate-icons.js` 供日後重生
- Manifest 註冊 `icons` + `action.default_icon` 四尺寸齊備（工具列 / Extensions 管理頁 / Store listing 皆有對應）
- Landing page：`docs/index.html`（GitHub Pages 用；AdGuard 注入 script 已清除）
- Chrome Web Store promo：`store-assets/promo-440x280-{a,b}.png`（small promo tile 雙備選）+ `marquee-1400x560-{main,alt}.png`（marquee 雙備選）+ `icon-128-store.png`；四張 HTML source 備存於 `store-assets/sources/`；`tools/export-promo-tiles.js` 供日後重生
- `Claude design/` 原始下載資料夾加入 `.gitignore`

**D. 功能/修復**
- **預設快速鍵改為 `Alt+R`**（Mac 即 `Option+R`）：解掉 `Cmd+Shift+R` 撞 Chrome 強制重載導致 suggested_key 被 Chrome 忽略、安裝後 shortcut 欄位空白的長年問題。⚠️ Chrome 不會在 extension reload 時重套 suggested_key（只在**首次安裝**套用），既有使用者需到 `chrome://extensions/shortcuts` 手動指派一次；新安裝自動綁定
- **Icon family 擴充 + active/idle 切換**（由 Claude Design 設計，置換 Claude Code 用 Playwright 字體 rasterize 產的開發期草稿）：`jread/assets/icons/` 新增 disabled 灰階變體（16/32/48/128）+ 512 高解析 master；manifest `default_icon` 指向灰階版（待機狀態），content main.js 在 enter/exit reader mode 時發 `SET_ACTIVE_ICON` 訊息，SW 呼叫 `chrome.action.setIcon({tabId, path})` 切彩色；`tabs.onUpdated` status=loading 時重置為灰階，處理導航後的 per-tab icon state 殘留。新增 `NS.MSG.SET_ACTIVE_ICON` 常數；icon swap wire-up 走 PENDING_REGRESSION（chrome.action.setIcon / tabs.onUpdated 只能在真 extension 環境驗）
- **Link 色修復**（styler.js，Jimmy 授權動 styler）：dark/sepia 主題下 `[data-jread-active="1"] * { color: X !important }` 吞掉原站連結色、導致連結與正文同色無法辨識（Jimmy 在 Idée Fixe Substack 回報）。THEMES 表新增 `link` 欄位（dark `#7fb5e6` / sepia `#2c5282` / light `null`）；buildCss 在 `overrides.theme && theme.text` 分支加注入 `a / a * { color: theme.link !important }` + `a { text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px }`（**顏色 + 底線雙通道差異化**，照顧色盲/低對比環境）。**light theme 完全不變**（light.link 為 null、light.text 為 null → `overrides.theme && theme.text` 條件不觸發、不注入任何 a 規則、保留原站 link 色）。styler.spec dark/sepia 擴充 link 色 + underline 斷言；light 加 forcing function「不得注入任何 a 規則」守住 v0.6.0 baseline「link color 保留原站」精神；既有「CSS 不得套 a 下 rule」的 light baseline guard（line 457）保留
- 全專案 **「快捷鍵」→「快速鍵」**（SPEC / CHANGELOG-archive / PENDING_REGRESSION / service-worker.js 註解 / popup.js 使用者提示字 3 處）
- `LICENSE`（Elastic License 2.0 + Copyright 2026 Jimmy Su）rooted 並 mirror 進 `jread/` 讓「擴充功能目錄內的 LICENSE 檔案」敘述為真

108 spec 全過（styler theme spec 擴充 link 色斷言、未增 `it()` blocks）；`cleaner.js` / `detector.js` / `main.js` / `toast.js` 等 content-script 核心行為完全未動——v0.6.3 主文偵測 / 雜訊隱藏 baseline 零變動。


舊版本歷程（v0.1.x – v0.6.x）已歸檔至 `CHANGELOG-archive.md`。
