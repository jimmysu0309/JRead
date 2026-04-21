# SPEC.md — JRead 專案規格

> 這是 JRead Chrome Extension 的完整規格。Claude 開始任何工作前必讀。
> 協作規則另見 `CLAUDE.md`。

---

## 目前 Extension 版本

`0.6.12`（cleaner 新增 `collapseGridWithHiddenCell`：主文內 display:grid / flex-row container 若有 direct child 被 hide → 給 container 加 inline `display:block; grid-template-columns:none`，退化成自然 block。修 Engadget 類「主文 + 廣告側欄」CSS Grid layout 下 AdBlocker 清掉廣告內容但 grid cell 300px 寬度仍保留、主文被擠成 196px 窄欄的問題）

---

## 一句話定位

JRead 是 Chrome Extension「Unclutter」的 clone——提供純閱讀模式，在任一文章頁一鍵隱藏廣告、側邊欄、彈窗、浮動元素等雜訊，將主文以乾淨排版呈現。

---

## 核心功能（MVP）

| 功能 | 說明 | 狀態 |
| --- | --- | --- |
| 主文偵測 | 從 DOM 中找出主要文章內容元素 | ◐ 進行中（策略 1/2/4 已實作；策略 3 OpenGraph 未實作） |
| 閱讀模式切換 | 一鍵開/關閱讀模式 | ✅ v0.4.0（popup 按鈕 + 快捷鍵） |
| 乾淨排版 | 套用可讀性佳的字體、字級、行高、版心寬度 | ☐ 未開始 |
| 雜訊隱藏 | 隱藏廣告、sticky header、彈窗、側邊欄、相關文章列表 | ✅ v0.3.0（主文外語意 + fixed/sticky + 社群 cluster + 主文內 keyword） |
| 偏好設定 | 字體、字級、主題色（亮/暗）、行高、版心寬度 | ☐ 未開始 |
| Popup UI | 顯示當前頁面是否可閱讀、版本號、切換按鈕 | ◐ 進行中（基本版已實作；狀態提示改走 toast） |
| Toast 提示 | 頁面右下角提示閱讀模式狀態（Shadow DOM 封裝） | ✅ v0.4.0 |
| 快捷鍵 | 預設 `Cmd/Ctrl+Shift+R`（與瀏覽器 hard reload 衝突，需使用者至 `chrome://extensions/shortcuts` 手動指派才生效） | ✅ v0.4.0 |

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
- `promo`、`promotion`、`advertisement`、`sponsored`、`ad-`、`-ad`
- `cta`、`call-to-action`
- `related-articles`、`recommended`、`read-more`
- `share`、`social`（配合結構判斷，避免誤殺有意義的 share 圖示）
- `comment`、`comments`、`discussion`、`disqus`（跨站 CMS 留言區 anchor 慣例：Substack `#discussion`、WordPress `.comments-page`、Disqus `#disqus_thread`、Ghost `#comments`）

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
