# SPEC.md — JRead 專案規格

> 這是 JRead Chrome Extension 的完整規格。Claude 開始任何工作前必讀。
> 協作規則另見 `CLAUDE.md`。

---

## 目前 Extension 版本

`0.7.6`（Postlight Parser 研究產物：Schema.org `itemprop="articleBody"` 策略）。Jimmy 2026-04-23 第二輪研究開工——盤點 Postlight Parser `src/extractors/custom/` 120+ 站點 parser，抽樣讀 9 個具代表性的（NYT / Medium / Engadget / CNN / Ars Technica / CNET / Twitter / Blogspot / Wikipedia / BuzzFeed）找跨站通則。結論：**clean selector 幾乎全是站點特判**（`.mw-editsection` / `.js-ad-placement` / `.zn-body-text` / `.stream-item-footer` 類），違反硬規則 3 不收；**transforms 類型不相容**（Postlight 重建 DOM，JRead 保留原 DOM）；唯一可抽的跨站通則是 **Schema.org microdata `itemprop="articleBody"`**——NYT / CNN / Ars Technica 等新聞站 parser 都用 `div[itemprop="articleBody"]` / `section[name="articleBody"]` 當 content selector，說明許多站即便容器沒掛 `itemtype="Article"`，內層仍標了 `itemprop="articleBody"`（SEO 慣例、Google 結構化資料爬取依據）。修法：detector 策略 2 雙層，Layer A 原 `[itemtype*="Article"]` 邏輯保留，Layer B fallback 到 `[itemprop="articleBody"]`，命中 confidence 0.85、strategy `schema-org-body`。fixture `schema-org-articlebody.html` 刻意建構「無 article tag + 無 itemtype、僅內層掛 itemprop」的真實 NYT/CNN 類結構；spec 4 條 assertion；sanity check 通過（註釋 Layer B → strategy + confidence 兩條 assertion fail）。149 spec 全過。

`0.7.5`（Readability.js 演算法借鑑三項：POSITIVE/NEGATIVE regex 擴充 + nbTopCandidates 競爭分析 + lazy-image hydration）。Jimmy 2026-04-23 續問「是否有受推崇的主文偵測/雜訊清理專案可參考」，評估 Mozilla Readability.js（Apache 2.0、Firefox Reader View 引擎）、Postlight Parser（MIT）、Trafilatura（Python）、DOM Distiller（Chromium 內建）四個主流——結論：架構不同（Readability 風格重建 DOM、JRead 覆蓋原 DOM），**不能直接引入整包**；但**借鑑演算法細節**成本極低。本版三項小改動：(A) detector POSITIVE_RE 補 `hentry|h-entry|blog`（microformats + 部落格 CMS 命名）；NEGATIVE_RE 補 `gdpr|outbrain|related|sponsor|shoutbox|widget|skyscraper`（跨 CMS 廣告/推薦/側欄元件命名）。刻意不收 Readability 原版的 `page|pagination`（會讓 `#page-wrapper` 整站殼命中）、不收 `hidden|hid|contact|scroll|shopping|tags|media|meta`（這些詞在正文結構裡也常出現，會把主文 multiplier 砍半）。(B) detector 從「只挑 top 1」改為「收前 5 名競爭分析」——top1/top2 score 比值 < 1.25 時回報 `result.ambiguous=true` + confidence ×0.85 + `promoteForTitle` hops 收緊到 1，避免 heuristic 選錯 anchor 時 promote 升到 common ancestor 吞整頁（v0.7.2 upmedia 國際版坑的一般化防守）。(C) cleaner 新增 `hydrateLazyImages(articleEl, hidden)` 在 clean() 尾段呼叫——掃 articleEl 內 `<img>`，src 空/data:image/about:blank 視為 placeholder，依序嘗試 `data-src` / `data-original` / `data-lazy-src` / `data-lazy` / `srcset`/`data-srcset`（取第一個 URL）補進 `src`；restore 時以 `hadSrcAttr` 區分「原站無 src attribute」vs「原站 src=""」round-trip 還原。對標 Readability.js `_fixLazyImages` 精神。三條 fixture：`readability-class-weights.html` / `readability-ambiguous-candidates.html` / `lazy-image-hydration.html`；5 條 cleaner 驗證 + 2 條 detector 行為 + 2 條字面 regex forcing；sanity check 三輪（退回舊 regex / `ambiguous=false` / 註釋 `hydrateLazyImages` 呼叫）都通過。145 spec 全過、harness 三站無 regression。

> **Engineering note（2026-04-23，無版本變動）**——Jimmy 2026-04-23 續問「有沒有專門攔社群 widget / 訂閱 popup / 通知等『惱人事物』的 list 可以借？」答案是 Fanboy's Social / Newsletter / Notifications `_general_hide.txt` 三份（EasyList 家族、GPL-3.0，同上輪 fetcher/parser 格式可完全複用）、uBO uAssets/filters/annoyances.txt（擴展語法要再寫 parser）、Web Annoyances Ultralist（[yourduskquibbles/webannoyances](https://github.com/yourduskquibbles/webannoyances)、CC-BY-SA-4.0，擴展語法）。**六站 probe（Jimmy 四站 + bbc + theverge）完整走一輪、11264 條 fanboy generic cosmetic selector 在 reader mode 內 articleEl scope 全數 0 命中**（theverge timeout 未計，其餘五站全 0）；baseline（全頁 body）命中的少數元素（udn `.footer-social` / `.fb-share-button`、chinatimes `.social-share` / `.facebook-page-plugin`）都在頁面 footer 或 sidebar、根本不會被 detector 選進 articleEl。結論：**cleaner 現有 `NOISE_KEYWORD_RE`（含 social / social-share / share / subscribe / newsletter 詞根）透過 `markerOf` class+id 比對已完整代理 fanboy list 的跨站通用 pattern**，fanboy 剩下的 9000+ 條是 WordPress / CMS plugin 站點特定 class（`.post-share-twitter` / `.entry-social-buttons` 類），reader mode 架構本身就不會讓這些進 articleEl。不引入任何 list、不動 extension code、不 bump 版本。此結論留給未來對話避免重跑相同 spike。

`0.7.4`（廣告對應強化：EasyList spike 結論 + 第三方廣告服務標識符新 rule）。Jimmy 2026-04-23 詢問「能否借現成 ad-blocker 避免重複造輪子」，spike 走完兩步證實 EasyList 整包對 JRead 邊際效益極低——Jimmy 四站實測（line today / udn / chinatimes / upmedia）在 reader mode 內 40984 條 EasyList generic selector 僅命中 3 個元素（`.udn-ads` x2 + google_ads_iframe x1）。根因：reader mode 架構已把大部分廣告容器「自然繞過」（detector 選 articleEl 時排除廣告 wrapper）。但 baseline（全頁 body）命中揭露有價值的跨站業界慣例 selector：Google Ad Manager `[id^="div-gpt-ad"]` / `[name^="google_ads_iframe"]`、Taboola `[class*="trc_"]` / `[id*="taboola"]`、popIn `[class*="_popIn_"]`、Outbrain `[class*="OUTBRAIN"]`、通用 ad- prefix `[id^="ad-"]` / `[class^="ad-"]` 等 **14 條第三方廣告服務標準命名**。通則：這些是第三方廣告 platform 的官方 class / id 命名（GAM 標準、Taboola 官方 widget prefix、popIn 官方 class），屬結構性通則、非站點特判（硬規則 3）。修法：cleaner 新增 `hideInsideArticleByThirdPartyAds(articleEl, hidden)`，在 articleEl 作用域一次 `querySelectorAll(THIRD_PARTY_AD_SEL)` 命中全 hide；NOISE_KEYWORD_RE 同步擴充 `trc_[a-z_]+` 與 `popin` 詞根（markerOf 走 class+id 能命中 Taboola / popIn 的官方 class 命名）。fixture `third-party-ads-inside-article.html` 涵蓋全部 14 條 selector branch + 主文保留 forcing；sanity check 通過（移除 rule 14 條對應 assertion 同時 fail）。131 spec 全過、harness 三站（chinatimes / line today / udn）residual audit 三次全 `✅ 無殘留雜訊`。

`0.7.3`（bugfix 七層：cleaner sidebar 條件 B 拿掉 textLen 比值 + collapse 擴展至傳統 float layout + NOISE_KEYWORD_RE 擴充跨 CMS 雜訊 family + detector `getCanonicalTitle` 對 og:title 取 `|/–/—` 分隔首段 + `PROMOTE_MAX_HOPS` 2→3 + SW `ICONS_*` path 改絕對路徑 + cleaner 新增 heading text heuristic（`hideInsideArticleByHeadingText`，跨站通用文末推薦 section 標題字樣 regex：延伸閱讀 / 相關新聞 / 更多...文章 / 其他人也看 / 查看更多 / 最新消息 等，hide heading closest `<section>/<aside>`；專治 SPA 類站點 emotion-style hash class 無語意命中的場景）。上報三站實測：chinatimes 即時新聞 sidebar + 「也許您會感興趣」塊、udn 文章尾端「延伸閱讀 / 相關新聞 / taboola / sponsor-ads / discuss-board」5 塊雜訊、line today 標題漏掉（og:title 帶「| 自由電子報 | LINE TODAY」三段尾綴 + h1 佔 og 57% < 60% titleMatches 門檻 → promote 失敗漏 h1；連帶 article textLen 501 太短 scroll 空間縮到 500px，user 覺得「無法往下捲動」——取首段後 og = h1、title match 成功 + real line today 結構要求共同祖先 3 hops、MAX_HOPS 2 不夠放寬到 3、promote 升級到 div.swipe-back、整頁 scrollHeight 5553 scroll 空間恢復）。上報 chinatimes 即時新聞 /realtimenews/20260423000917-260410 實測：reader mode 開啟後右欄「財經熱門新聞」10 條編號列表整塊殘留（aside.column-right 在 article.article-box > column-wrapper 內同層）、且移除後右側空白沒還給主文。根因鏈兩層：(1) `hideInsideArticleSidebarColumns` 條件 B 對 `<aside>` tag 的判定是 `textLen < main × 0.5 + rectH > 400`；harness 時序 race 下主文 column-left textLen 約 2457（相關閱讀未 lazy-load 完時偏低）、aside textLen 1389（10 條 hot-news + section header），aside/main 比值 0.565 打在 0.5 門檻上方漏網；(2) aside 即便被清掉，`.column-wrapper.clear-fix` 內是**傳統 float + 固定 width 多欄 layout**（column-left: float:left width:308px + aside: float:right width:300px），而 `collapseGridWithHiddenCell` 只處理 grid / flex-row、不處理 float，主文 column-left 仍被鎖 308px 寬、右側 300px 空白殘留。通則修法：(A) cleaner 條件 B 拿掉 `s.textLen < main.textLen * 0.5` 檢查，只保留「`<aside>` tag + rectH > 400」絕對結構特徵——rectH 門檻已排除 pull-quote，textLen 比值只會把邊緣場景當 false negative 放過；(B) `collapseGridWithHiddenCell` 新增 float layout 觸發條件——container 非 grid / flex-row 但 direct children 有 `computed float !== 'none'` 且存在 hidden sibling 時，對 visible 的 direct children 強制 `float: none !important`（配合既有的 `width: auto` + `max-width: none`），restore 流程一併記下 `prevFloat` / `prevFloatPriority` 做還原。fixture `chinatimes-aside-high-text-ratio.html` 雙層 forcing：main 593/aside 339 驗條件 B + column-left inline `float: left` 驗 float collapse。sanity check 驗過兩條：拿掉 textLen 檢查或拿掉 float reset 都會 fail。116 spec 全過。

`0.7.2`（bugfix：detector modal signal 污染 + heuristic 外殼誤選 + promote 失控三層防護）。上報國際版 /tw/international/headlines/256941 實測：reader mode 把整頁 #wrapper 當主文、top bar / header / 快訊列 / 分類列 / 右欄推薦列全殘留。根因三層：(1) Bootstrap modal（2700+ 字雜訊 + stylesheet-only `display: none`）的 p 被 detector.getText fallback 到 textContent 讀入計分；(2) heuristic bubble-up 對 signal 埋深層的主文不利，短文字高連結密度的 UI chrome `.row` finalScore 贏過真主文；(3) promoteForTitle 無層數上限、選錯 anchor 時一路升到 body 或 #wrapper 吞整頁 chrome。通則修法：(A) heuristic 加 `isSignalExcluded`——祖先鏈含 ARIA dialog/alertdialog/tooltip/aria-modal、aria-hidden 或 inline/computed `display:none` 的 signal 不計分；(B) heuristic 加 `textLen/200 cap 10 * (1-ld)` 獎勵，讓長文字低連結密度主文贏過短文字 UI chrome；(C) `promoteForTitle` 加 `MAX_HOPS=2` 上限。fixture `upmedia-intl-modal-signals.html` 用 Bootstrap 標準 `aria-hidden="true"` markup 驗 (A)；(B)(C) 由 Playwright harness 對真 upmedia 國際版驗（jsdom 對 stylesheet-only modal 無法 resolve、已記入 PENDING_REGRESSION）。115 spec 全過。

`0.7.1`（bugfix：上報 icon-link 巨大化）。styler `[data-jread-active] img` rule 的 `height: auto !important` 吃掉原站用 `height: 32px` 類 CSS 鎖小尺寸的 icon（沒明確設 width、依賴 intrinsic aspect-ratio 自動算），導致 img 退回 naturalSize（例：upmedia `#toggleImg` 250x250 icon 被拉成巨大化、「新聞摘要」「辭」「AI 新聞關鍵字詞查詢」都中）。通則區分：`[data-jread-active] a > img`（link-wrapped icon / logo / UI 按鈕圖）獨立 rule 只 cap 寬度、不設 height；其他 wrapper（figure / picture / p / div）下的 img 維持 shrink-fit `height: auto`。fixture `upmedia-icon-link-oversize.html` 擷取最小重現結構；styler spec 新增 2 條 forcing function（a > img rule 不得含 height、含 height:auto 的 img selector 必須帶 :not(a > img)）；110 spec 全過。本次修法後 icon 圖保留原站尺寸、主圖仍正確 shrink-fit。

`0.7.0`（視覺大改版：全站 Design System 落地）。(1) **Popup UI refresh**——套用 JRead Design System tokens（品牌藍 #2b6cb0、neutral 階、radius 4/6、spacing 4/8/12/16/24 節奏）；header 加 logomark（藍方塊 + 白色 serif J）；主題按鈕三顆 WYSIWYG（底色即主題色、active 用 2px 藍環）；字級/寬度 stepper 規範化（`.val` 固定 56px、兩條 stepper 左右邊緣完全對齊）；主題按鈕群寬度 = stepper 寬度 = 110px；footer 快速鍵與「進階設定 →」同一 row baseline 對齊；拿掉「頁面設定」h2。(2) **Options page refactor**——全面套 Design System；三個控制項（select + 2 number input）統一 140×32；select 自製 SVG 下拉箭頭；新增授權資訊 section（ELv2、Jimmy Su、Twitter 連結）；字級 desc 加「0 = 自動」藍字標注、input min 放寬至 0。(3) **Icon family**——`jread/assets/icons/icon-{16,32,48,128}.png`，比例完全對齊 popup logomark；manifest `icons` + `action.default_icon` 四尺寸齊備；store-assets/ 另存 128 給 Chrome Web Store listing。(4) **預設快速鍵**改為 `Alt+R`（Mac 即 `Option+R`），解掉 `Cmd+Shift+R` 撞 Chrome 強制重載的問題；新安裝自動綁定、既有安裝需到 `chrome://extensions/shortcuts` 手動指派一次。(5) **Landing page**（`docs/index.html`）+ **Chrome Web Store 素材**（`store-assets/promo-440x280-{a,b}.png`、`marquee-1400x560-{main,alt}.png`）皆由 Claude Design 設計 + Playwright 精確截圖生成。(6) **Link 色修復**（styler.js）——dark/sepia 主題下 `* { color: X !important }` 原本吞掉原站連結色導致連結與正文同色無法辨識；新增 `a / a *` 專屬 link 色（dark: `#7fb5e6`、sepia: `#2c5282`）+ underline 雙通道差異化；light theme baseline 完全不變（保留原站 link 色）。(7) 全專案「快捷鍵」→「**快速鍵**」。LICENSE（Elastic License 2.0）rooted 並 mirror 進 `jread/` 使「擴充功能目錄內的 LICENSE」成真。styler theme spec 擴充 link 色斷言（dark/sepia 必須 inject link 色 + underline、light 不得 inject 任何 a 規則）；108 spec 全過

---

## 一句話定位

JRead 是 Chrome Extension「Unclutter」的 clone——提供純閱讀模式，在任一文章頁一鍵隱藏廣告、側邊欄、彈窗、浮動元素等雜訊，將主文以乾淨排版呈現。

---

## 核心功能（MVP）

| 功能 | 說明 | 狀態 |
| --- | --- | --- |
| 主文偵測 | 從 DOM 中找出主要文章內容元素 | ◐ 進行中（策略 1/2/4 已實作；策略 3 OpenGraph 未實作） |
| 閱讀模式切換 | 一鍵開/關閱讀模式 | ✅ v0.4.0（popup 按鈕 + 快速鍵） |
| 乾淨排版 | 套用可讀性佳的字體、字級、行高、版心寬度 | ☐ 未開始 |
| 雜訊隱藏 | 隱藏廣告、sticky header、彈窗、側邊欄、相關文章列表 | ✅ v0.3.0（主文外語意 + fixed/sticky + 社群 cluster + 主文內 keyword） |
| 偏好設定 | 字體、字級、主題色（亮/暗）、行高、版心寬度 | ☐ 未開始 |
| Popup UI | 顯示當前頁面是否可閱讀、版本號、切換按鈕 | ◐ 進行中（基本版已實作；狀態提示改走 toast） |
| Toast 提示 | 頁面右下角提示閱讀模式狀態（Shadow DOM 封裝） | ✅ v0.4.0 |
| 快速鍵 | 預設 `Alt+R`（Mac: `Option+R`）；若未生效可至 `chrome://extensions/shortcuts` 手動指派 | ✅ v0.4.0 |

---

## 非 MVP 範圍（之後再談）

- 劃重點 / 筆記
- 稍後閱讀 / 書籤
- AI 摘要
- 跨裝置同步閱讀列表

---

## 檔案結構（規劃）

```
JRead/
├── jread/                       # Extension 本體
│   ├── manifest.json            # Manifest V3
│   ├── background/
│   │   └── service-worker.js
│   ├── content/                 # Content scripts（按載入順序）
│   │   ├── namespace.js         # window.__JRead 初始化
│   │   ├── detector.js          # 主文偵測
│   │   ├── cleaner.js           # 雜訊隱藏
│   │   ├── styler.js            # 套用乾淨排版
│   │   └── main.js              # 進入點、事件串接
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.js
│   ├── options/
│   │   ├── options.html
│   │   └── options.js
│   ├── site-overrides/          # 站點特判隔離區（慎用）
│   └── assets/
├── test/
│   ├── version-check.spec.js    # 版本號 forcing function
│   ├── regression/              # 回歸測試
│   │   ├── fixtures/
│   │   └── *.spec.js
│   └── PENDING_REGRESSION.md
├── tools/
│   └── debug-harness.js         # Playwright 自動化除錯 harness
├── docs/
│   └── CHROME_EXTENSION_DEBUG.md # 自動化除錯完整指南
├── CLAUDE.md
├── SPEC.md                      # 本檔
├── README.md
├── CHANGELOG.md
└── release.sh
```

---

## 主文偵測策略（優先序）

1. 語意標籤：`<article>`（單一或明顯最長者；多個相近篇幅判為列表頁而降級）
2. Schema.org：`[itemtype*="Article"]`、`[itemtype*="NewsArticle"]`、`[itemtype*="BlogPosting"]`
3. OpenGraph：`meta[property="og:type"][content="article"]` 搭配啟發式（暫未實作）
4. 內容密度啟發式（Readability-style bubble-up）：對 `<p>` / `<li>` / `<h2-4>` / `<blockquote>` / `<pre>` 算 contentScore（文字長 + 逗號數），向 parent 100% / grandparent 50% 累加；容器型元素以累積分勝出。此法避免「站體外殼因後代 p 總數多而贏過真主文容器」
5. 兜底：`<main>` 本身作為主文（順序最後，避免多欄 layout 的 `<main>` 吞 sidebar）
6. 降級：若分數低於閾值，**不啟動閱讀模式**（no-op），不硬套

### Title promote（所有非兜底策略）

Stratechery / Medium / Substack / anthropic.com 等站點常把 post-title 跟 post-content 放兄弟層：WordPress 是 `<h2 post-title>` 跟 `<div entry-content>` 同級（heuristic 選中 content）、anthropic 則是 `<h1>` 放在 `<section hero>` 與 `<article>` 同級（article-tag 選中 article）。detect() 出口統一做 promote：沿主文容器祖先鏈往上，若兄弟中有 h1/h2 文字與 `meta[property="og:title"]` 或 `document.title`（取分隔前首段）雙向包含匹配，把主文容器升級到該共同 parent，使 title 納入主文 scope。作用於 article-tag / schema-org / heuristic；**main-tag 是兜底本身已是最外層，不做 promote**（避免無止盡向上擴散）。

### 內文保留特例（避免誤殺內容）

- **`<summary>` 元素**：雖然在 HTML 語意上是「摘要/提要」，但實際上常被媒體站拿來放文章的 editor bullets（例如 Business Weekly）。偵測主文時 `<summary>` 必須視為內文的一部分保留，**不可**外移到 outline 或砍掉。（Unclutter 在 Business Weekly 上就踩到這個坑，把 intro bullets 從主文移走）
- **`<figure>` + `<figcaption>`**：主圖與圖說一律保留
- **`<blockquote>`**：引言區塊保留

---

## 雜訊隱藏規則（結構性通則）

以下規則必須是 DOM / CSS 結構特徵，**不可**綁定站點或特定 class：

### 主文外雜訊

- 主文容器之外的 `<header>`、`<nav>`、`<footer>`、`<aside>` → 隱藏
- `position: fixed` / `sticky` 且不在主文範圍內的元素 → 候選隱藏
  - 寬度 ≈ viewport 且高度 < 100px → 多半是 top sticky bar / progress bar
  - 寬度 < 100px 且高度 > 200px → 多半是側邊浮動工具列
  - 固定在 viewport 下半區 → 多半是底部彈窗 / cookie / 訂閱 CTA
- `iframe` 中包含第三方廣告網域來源 → 隱藏
- 已知社群分享按鈕模式：連續 3+ 個 `a[href*="twitter.com|facebook.com|linkedin.com..."]` → 摺疊

### 主文內 layout 殘留空欄（結構性通則）

主文內若有 `display: grid` 或 `display: flex; flex-direction: row` 的容器，且其 direct children 中有 ≥ 1 個被 hide（`data-jread-hidden="1"` 或 `display: none` / `visibility: hidden`），代表原站 layout 設計了 N 欄但其中一欄內容已被清空——cleaner 給 container 加 inline `display: block !important; grid-template-columns: none !important` 等規則退化成自然 block。典型場景：Engadget / NYT / 許多新聞站用 CSS Grid 做「主文 + 廣告側欄」layout，AdBlocker 清廣告後殘留的 grid cell 空間壓擠主文。intentional 多欄圖文（無 hidden child）不會觸發。

### 主文內雜訊（跨站通用 keyword heuristic）

主文容器內出現以下 class / id 關鍵字的區塊視為雜訊（不分大小寫）：

- `paywall`、`subscribe`、`newsletter`、`signup`
- `promo`、`promotion`、`advertisement`、`sponsored`、`sponsor`（動詞詞根覆蓋 udn `.sponsor-ads` 類）、`ad-`、`-ad`
- `cta`、`call-to-action`
- `related-(articles|news|posts|stories)`、`more-(news|stories|posts|articles)`、`recommended`、`recommend`、`recommendation`、`read-more`、`read-next`、`up-next`、`taboola`、`outbrain`、`zergnet`、`revcontent`
- `breadcrumb(s)`、`pagination`、`page-nav`、`pager`、`author-(bio|card|info|box|meta|widget)`
- `follow`、`follow-us`、`subscribe`、`subscription`、`newsletter-(signup|form|cta)`、`email-(signup|capture|subscribe)`
- `cookie-(banner|notice|consent|bar)`、`gdpr`、`consent`、`privacy-(banner|notice)`
- `popup`、`overlay`、`modal-(content|dialog|box|wrapper)`、`floating-(bar|cta|widget)`、`sticky-(bar|cta|banner|subscribe)`、`toast`、`snackbar`、`notification-(bar|banner)`
- `audio-(player|widget)`、`postlisting`、`post-listing`、`thread(s)`、`reposted`、`repost`
- `social-(bar|links|icons|share|media)`、`share`、`social`
- `comment`、`comments`、`comment-form`、`discussion`、`discuss`、`disqus`、`livefyre`、`hyvor`（跨站 CMS 留言區 anchor 慣例：Substack `#discussion`、WordPress `.comments-page`、Disqus `#disqus_thread`、Ghost `#comments`）

**英文網頁 heading 文字慣用語**（`NOISE_HEADING_TEXT_RE`）：Related Articles / Recommended for you / More from X / You may also like / Read more / Up next / Continue reading / See also / Further reading / Editor's Picks / Sponsored content / Comments(N) / Discussion(N) / Responses / Replies / Newsletter / Subscribe / Follow us / Trending / Popular / Top Stories / AI Summary / AI Digest / Hot / New / Top

**英文網頁 link/button 文字慣用語**（`NOISE_LINK_TEXT_RE`）：View original / Read the full article / Back to top / Show more / Load more / Learn more / Get the app / Download app / Open in app / Subscribe / Follow / Like / Share / Repost / Reply / Comment / Save / Bookmark / Sign up / Log in / Clap / Join our newsletter / Follow us on Twitter / Subscribe to our newsletter / N hours ago / N minutes ago

### 主文內所有 interactive button 一律清除（無保留）

Reader mode 定位為「純閱讀」——**所有** `<button>` / `[role="button"]` / `<input type="button|submit|reset">` 一律 hide，不看 class、不看文字、不受 `PRESERVE_SEL` 保護（figure/summary/figcaption/blockquote 內的 expand/zoom/play 按鈕也清）。規則 `hideInsideArticleAllButtons` 獨立於 NOISE_LINK_TEXT_RE / NOISE_KEYWORD_RE，對所有 interactive button 無條件 hide——包含分享 / 訂閱 / 追蹤 / 讚 / 收藏 / 播放 / 展開 / 任何 CTA。`<a>` 連結不屬此規則範圍（保留主文內超連結 / 引用 / 人名 wiki 連結），僅由 NOISE_LINK_TEXT_RE 對特定 CTA 文字匹配清除。
- `share`、`social`（配合結構判斷，避免誤殺有意義的 share 圖示）
- `comment`、`comments`、`discussion`、`discuss`（動詞詞根覆蓋 udn `.discuss-board` 類）、`disqus`（跨站 CMS 留言區 anchor 慣例：Substack `#discussion`、WordPress `.comments-page`、Disqus `#disqus_thread`、Ghost `#comments`）

**這不是站點特判**：這些字詞是跨站通用的 CSS 命名習慣，在 Business Weekly、Medium、紐約時報、Substack 上都會命中對應區塊。實作時如果發現某個 keyword 容易誤殺，再逐條評估調整。

---

## 排版樣式策略（v0.6.0 瘦身版）

styler 的設計哲學：**盡量貼近原站點，只清雜訊、提供讀者卡片容器、接使用者 override**。不動原站的 heading margin / p margin / list style / font-family / font-size / line-height / link color / blockquote border 等——原站怎麼排就怎麼排。

### 永遠注入的骨架

1. 頁面 reset：`html` / `body` 背景 + 清 max-width / margin / padding（讓閱讀模式的卡片能置中於整個 viewport）
2. 祖先鏈 reset：`[data-jread-ancestor="1"]` 清 max-width / margin / padding / background / position / transform 等（讓主文脫離原站的多欄 layout 或 sticky 限制）
3. 讀者卡片：`[data-jread-active="1"]` 設 max-width（版心）/ margin auto / padding / background / border-radius / box-shadow——**刻意不設 font-family / font-size / line-height / color**
4. 第一個子元素 margin-top: 0（消頂端留白，配合 JS 對深層 firstInk 的 inline margin-top 覆寫）
5. 圖片 / 影片 max-width: 100%（避免超出卡片寬度）
6. aspect-ratio placeholder 破解：含 `<img>` / `<picture>` / `<video>` 的容器清 padding-bottom 與 aspect-ratio（專門破 Substack / Medium 的 `padding-bottom: 56.25%` hack）
7. `figure` / `picture` 強制 `width: auto !important` + `max-width: 100% !important`（v0.6.10 修商周類原站給 figure 固定寬 CSS 在 reader mode 下失效、figure 退化成 shrink-to-fit 被 figcaption 夾死的場景）
8. `[data-jread-hidden="1"] { display: none !important }`（v0.6.11 補 cleaner hide 漏洞——cleaner 只設 inline `style.display = 'none'` 無 !important，站點 JS scroll/timer handler 主動寫 `el.style.display = 'block'` 會覆寫 inline display + 清掉 priority。stylesheet !important 優先級 > inline 無 priority 值，browser 層級勝出，擋得住 JS 覆寫）

### 僅在「使用者改過預設值」時才注入的 override

| 欄位 | 預設 | 改過後注入 |
| --- | --- | --- |
| `theme` | `'light'` | dark / sepia → 覆寫文字色 + 頁面/卡片底色 |
| `fontSize` | `18` | 非 18 → `[data-jread-active] { font-size: Npx !important }` |
| `fontFamily` | `'system-ui'` | 改過 → 注入 font-family |
| `lineHeight` | `1.7` | 非 1.7 → 注入 line-height |
| `contentWidth` | `720` | 永遠注入（卡片骨架不可缺） |

這樣「開啟閱讀模式但不改設定」＝ 原站字體 / 字級 / 行高 / 排版 + 讀者卡片容器。最貼近原站視覺。

---

## 設定欄位（預設值）

使用者三項必要設定（來自需求）：**頁面寬度、日夜間模式、字型大小**。其餘欄位先保留後端預設，未來 Options UI 決定是否曝露給使用者。

| 欄位 | 型別 | 預設值 | 儲存位置 | 使用者可調？ |
| --- | --- | --- | --- | --- |
| `theme` | `'light' \| 'dark' \| 'sepia'` | `'light'` | `storage.sync` | ✅（日/夜間切換） |
| `fontSize` | `number`（px） | `18` | `storage.sync` | ✅ |
| `contentWidth` | `number`（px） | `720` | `storage.sync` | ✅（頁面寬度） |
| `fontFamily` | `string` | `'system-ui'` | `storage.sync` | ❌（MVP 固定） |
| `lineHeight` | `number` | `1.7` | `storage.sync` | ❌（MVP 固定） |
| `autoEnableDomains` | `string[]` | `[]` | `storage.sync` | ❌（MVP 不做） |
| `lastDetectedForUrl` | `object` | `{}` | `storage.local`（快取） | ❌（內部用） |

---

## 訊息協定（content ↔ background ↔ popup）

待實作時補上。目前已知需要：

- `popup → content`：`TOGGLE_READER_MODE`
- `content → popup`：`REPORT_DETECTION_RESULT`（偵測到/沒偵測到、信心分數）
- `popup → background`：`GET_SETTINGS` / `UPDATE_SETTINGS`

---

## 測試策略

- `test/version-check.spec.js`：forcing function，`EXPECTED_VERSION` 常數每次 bump 必須同步更新
- `test/regression/`：每修一個 bug 補一個 fixture + spec（見 `CLAUDE.md` 硬規則 4）
- `test/PENDING_REGRESSION.md`：抽不出最小重現結構時的待辦佇列

---

## 已知風險 / 待決議

- Readability.js 要不要整包引入，還是自己寫簡化版？
- SPA 導航（Medium、Substack）的 content script 重觸發時機
- 某些新聞網站有「文章分頁」機制，要不要處理？（MVP 範圍外）
- **授權策略**：不參考 Unclutter 原始碼（AGPL-3.0），走 clean-room——只讀 docs、自行實作。JRead 本身未來授權由 Jimmy 決定。

---

## 已驗證站點

實測過主文偵測策略在真實頁面上可否命中、雜訊隱藏規則是否會誤殺內文。每條紀錄包含測試日期、頁面類型、主文容器 selector、特殊注意事項。

### 商業周刊（businessweekly.com.tw）

- **測試日期**：2026-04-21
- **測試頁面**：`/Archive/Article?StrId=7014035`
- **主文容器**：`<article class="article">`（`<article>` 優先策略直接命中）
- **內文結構**：`article.article > div.postbody > { <summary>, <figure.articlephoto>, #DivArticleIndexGetMore }`
- **雜訊清單**：
  - 頁面外：`#header`、`nav.nav`、`#burger-nav`、`.footer-wrap`（語意標籤通則命中）
  - Sticky：`.postnav.fixed`、`#progress-wrapper`、`#gdrp-el`、`.Floating-Setting`、`#shortModel`（fixed 通則命中）
  - 主文內：`div.postbody.paywall`、`#Epaper-subscribe`（keyword `paywall` + `subscribe` 命中）
- **需要保留的特殊元素**：
  - `<summary>`（editor bullets，兩行文章提要）
  - `figure.articlephoto`（主圖 + figcaption）
  - `div.articlbox`（「小檔案」可摺疊資訊卡，強制展開即可，不需保留 JS 互動）
- **付費文章**：內文只有免費摘要 ~540 字，偵測正常不代表擷取到完整文章——這是站點本質，不是偵測失敗

### Stratechery（stratechery.com）

- **測試日期**：2026-04-21
- **測試頁面**：`/2026/please-listen-to-my-podcast/`
- **主文容器**：`div.wp-block-column`（左欄）——由 heuristic bubble-up 選中 `div.entry-content` 後，title promote 升級到左欄共同 parent
- **DOM 結構**：整頁**完全沒有 `<article>` tag**，WordPress 用 `<main>` > `div.wp-block-columns` 做 2 欄 layout，左欄含 `h2.wp-block-post-title` + `div.entry-content` + related/prev-next，右欄含 `div.wp-block-column.stratechery-sidebar` > `<aside>`
- **雜訊清單**：
  - 右欄 sidebar 全欄（search、Strategy Plus、UPDATES、PODCASTS、INTERVIEWS 列表）→ 由 cleaner 的 ancestor-sibling 規則清除
  - 頁面外：site `<header>` / `<footer>` / site-level nav → 語意標籤通則命中
- **觸發新規則**：
  - heuristic bubble-up（取代原「計後代 p 總數」）——避免站體外殼贏過主文
  - title promote——Stratechery 把 post-title 放在 entry-content 兄弟層，需把主文升級到共同 parent 保留標題
- **需要保留的特殊元素**：`h2.wp-block-post-title` 文章標題、主圖 `<figure>` + figcaption

### Dwarkesh Podcast（dwarkesh.com，Substack podcast-post）

- **測試日期**：2026-04-21
- **測試頁面**：`/p/jensen-huang`
- **主文容器**：`<article class="typography podcast-post post shows-post">`（article-tag 策略直接命中，不 narrow）
- **DOM 結構**：Substack 把 `<article>` 包住整個 2-col layout：`article > div > { container-dlhqPD (video-wrapper), main-content-and-sidebar-fw1PHW }`；後者是 `display: flex; flex-direction: row` 的左欄主文 + 右欄 sidebar
- **觸發新規則**：
  - `hideInsideArticleSidebarColumns`（v0.6.8）——主欄文字 2212 / linkDensity 0.013 vs sidebar 文字 155 / linkDensity 0.67，結構性 2-col 特徵命中
  - `hideInsideArticleEmptySpacers` / `hideInsideArticleActionRows` 對 `iframe`/`video`/`audio` tag early-skip（v0.6.8）——避免 cross-origin YouTube iframe 被當空殼誤殺
- **雜訊清單**：
  - 右欄 sidebar（Dwarkesh Podcast 卡片 + Listen on 連結堆 + Appears in episode + Recent Episodes 連結堆）→ 由 v0.6.8 新規則清除
  - 頁面外：site `<header>` / `<footer>` / site-level nav → 語意標籤通則命中
- **需要保留的特殊元素**：
  - `.container-dlhqPD > .video-wrapper-lforaE` 內的 `<video>`（Substack 原生 podcast player）
  - `.youtube-wrap > .youtube-inner > iframe[src*="youtube-nocookie.com/embed"]`（YouTube 縮圖 embed，點了才 load 真正播放器）
  - 標題 / 副標 / 作者 / 日期 / 贊助商段落 / 內文段落
- **切斷點**：主文在「Me too.」對話結尾後乾淨結束。`<div id="discussion">` 包住的整塊留言區（含 H4「Discussion about this video」+ `<textarea>` 留言表單 + `.comment-list-items`）由 v0.6.9 keyword heuristic 命中 hide（`#discussion` id 含 `discussion` 字樣）

---

## 變更紀錄

見 `CHANGELOG.md`。
