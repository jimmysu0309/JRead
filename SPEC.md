# SPEC.md — JRead 專案規格

> 這是 JRead Chrome Extension 的完整規格。Claude 開始任何工作前必讀。
> 協作規則另見 `CLAUDE.md`。

---

## 目前 Extension 版本

最新：**v0.7.109**。詳細修法見 [`CHANGELOG.md`](CHANGELOG.md) 頂部條目；`package.json` / `jread/manifest.json` 為真實版本號來源（`test/version-check.spec.js` forcing function 強制四邊同步：manifest / package.json / SPEC / CHANGELOG）。

### Baseline（當前所有修法的不可退讓底線）

**當前 baseline：v0.7.32**（2026-04-25 起，承接 v0.6.3 的 styler 瘦身精神 + 累積到 newtalk.tw 非 heading tag title + 非 figure 主圖修法為止的全部 detector/cleaner 能力）。往後 edge case 維修以此版的視覺成果與測試覆蓋為不可退讓底線。

**v0.7.32 baseline 包含**：

1. **styler 瘦身不變**（承接 v0.6.0 精神）：字型 / heading margin / p margin / list style / link color / blockquote border **全部保留原站樣式**；styler 只注入讀者卡片容器 + 祖先鏈 reset + 必要 hack（Bootstrap col-* reset / 裝飾 background transparent / aspect-ratio placeholder）+ 使用者 override。
2. **detector 策略完整**：article-tag → schema-org（含 `itemprop="articleBody"` Layer B fallback）→ heuristic（Readability-style bubble-up + POSITIVE/NEGATIVE regex + textLen bonus + top-5 ambiguous 競爭分析）→ main-tag 兜底。title promote 支援 h1-h4 heading + p/div/span 非 heading tag 包標題（v0.7.22 newtalk.tw 修法，非 heading 加 120 char text 上限）、返回 `promotedTitleHead` 給 cleaner 做白名單保護。
3. **cleaner 規則完整**：16 條 `hideInsideArticle*` rule（keyword / heading text / link text / inline ad / third-party ads / comment panels / font tags / button clusters / action rows / sidebar columns / hr / buttons / spacers）+ dialog/tooltip ARIA + 祖先鏈 sibling + **promote+narrow 聯動（含 promotedTitleHead 白名單 + media-bearing sibling 保護 v0.7.22 / v0.7.24 精修 img-not-in-a）** + grid/flex collapse（articleEl 自身也處理 v0.7.24）+ media placeholder reset + figure/picture 強制 block（v0.7.24） + style-attribute observer 抵禦原站 JS 覆寫 !important priority（v0.7.23） + lazy image hydrate + MutationObserver 動態攔截。
4. **使用者可調設定**：theme（light/dark/sepia）、fontSize（含 0 = Auto 保留原站）、contentWidth。
5. **測試覆蓋**：230 jsdom spec（含 43 條 fixture 重現站點 bug）+ 5 e2e spec（SW wire-up 真 Chrome 驗證）+ e2e harness 基礎設施（`tools/e2e-harness.js` + `test/e2e/`，harness 額外內建 gap audit 警告 >= 80px 可疑留白）。
6. **實測通過站**：Stratechery / ChinaTalk / anthropic / 商業周刊 / Dwarkesh（Substack podcast）/ Medium / BBC / udn / 中時（chinatimes）/ 自由時報（ltn）/ Engadget / 上報（upmedia）/ EBC 東森新聞（v0.7.22 同步修好 article_cover 主圖誤殺）/ LINE Today / ESM China / Newtalk 新聞 / TTV 台視新聞 / techbang T 客邦 / cnyes 鉅亨網 / The Verge（視覺微瑕疵待修，見 PENDING_REGRESSION）。

### 硬規則（繼承）

- **styler.js 仍視為動不得**——要動需 Jimmy 明確授權；禁止恢復 v0.5.x 對 h1-h6 / p / ul / ol / li / blockquote / a 下 rule 的做法。改 styler 類 typography-affecting universal rule 必須用 scoped selector（硬教訓 20，v0.7.17→v0.7.18）。
- **優先順序**：detector → cleaner → styler（最後手段）。
- **修 detector/cleaner/styler 類 DOM 互動 bug 必須先在 harness 驗假設再動 code**（見 CLAUDE.md「假設驗證順序」）。
- **所有 interactive button 一律清**（reader mode = 純閱讀，例外只有 button 內含主文媒體如 img/picture/video 的 wrapper）。
- **hide() 用 inline `!important`**（贏過原站 stylesheet `!important`，見硬教訓十）。

### 跨版本硬教訓（長期適用於未來修法）

1. **Typography-affecting universal rule 必須用 scoped selector**（硬教訓 20，v0.7.17 → v0.7.18）——`width` / `max-width` / `margin` / `padding` 等影響版面的幾何屬性若寫 `* { ... !important }` 會破 drop cap / figure full-bleed / styled-components 既有寬度。universal rule 只適合副作用不影響 layout 的屬性（如 `background-color: transparent`）。改 styler 後**必須** harness 截圖 + Read 自驗整頁排版，不能只看 residual audit。
2. **偽陰性驗收禁止**——harness 必須用 `RESIDUAL AUDIT` 遍歷 reader card visible element 列 outline；grep stdout 沒命中不代表 DOM 沒殘留。
3. **所有 interactive button 一律清**——reader mode 是「純閱讀」，分享/訂閱/追蹤/讚/收藏/播放/展開任何 CTA 無條件 hide；不看 class、不看 text、不設 preserve 例外（除 button 內含 img/picture/video 主文媒體載體才保留 wrapper）。
4. **`hide()` 必須用 inline `!important`**——stylesheet `!important` 會在 specificity 戰輸給原站的 stylesheet `!important`；inline `!important` 是 CSS 優先級最高層。
5. **Delayed lazy-inject 要靠邏輯完整性保證**——MutationObserver subtree + 遞迴 check button/a + inline !important 三者齊備；Playwright harness 的 lazy-inject 時序不一定跟實機 Chrome 同步，「我 audit 看不到」不代表「Jimmy 看不到」，相信 Jimmy 截圖。
6. **假設驗證順序**（詳見 `CLAUDE.md`）——修 detector/cleaner/styler 類 DOM 互動 bug 必須先在 harness 跑一次性 probe 驗假設、再動 extension code；fixture 是 forcing function、不是假設探索工具。

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
| Popup UI | 顯示當前頁面是否可閱讀、版本號、切換按鈕 | ◐ 進行中（基本版已實作） |
| Toast 提示 | **僅** 主文偵測失敗時顯示「此頁無法偵測主文」錯誤 toast；reader mode on/off 不再彈 toast（v0.7.32 Jimmy 要求簡化）。Shadow DOM 封裝 | ✅ v0.4.0 / 縮限 v0.7.32 |
| 快速鍵 | 預設 `Alt+R`（Mac: `Option+R`）切換閱讀模式；若未生效可至 `chrome://extensions/shortcuts` 手動指派。**閱讀模式啟動期間按 `ESC` 可立即退出**（v0.7.101，input/textarea/contenteditable focus 時放行）。 | ✅ v0.4.0 / ESC 退出 v0.7.101 |

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

- `popup → content`：`TOGGLE_READER_MODE` / `GET_READER_STATE`（v0.7.33）/ `EXTRACT_READER_HTML`（v0.7.33）
- `content → popup`：`REPORT_DETECTION_RESULT`（偵測到/沒偵測到、信心分數）
- `popup → background`：`GET_SETTINGS` / `UPDATE_SETTINGS` / `SAVE_TO_READWISE`（v0.7.33）

---

## Readwise Reader 整合（v0.7.33）

popup 加「送到 Readwise Reader」按鈕，把 JRead 處理過的乾淨主文 outerHTML 送到使用者的 Readwise Reader 帳號。動機：Readwise 的官方 extension 在某些難解析的頁面（重 JS、奇異 DOM）會失效，而那些頁面 JRead 多半已經處理乾淨。

### API

- Endpoint：`POST https://readwise.io/api/v3/save/`
- Header：`Authorization: Token <user_access_token>`
- Body：`{ url, html?, title? }`（html / title 可省，Readwise 會自抓，但帶上 JRead 處理過的 html 才能繞過原站 parser 問題）
- 回傳：`200`（已存在）/ `201`（新建）

### 設定

- 欄位：`readwiseToken`（string，預設 `''`），存於 `chrome.storage.sync`
- 取得方式：`https://readwise.io/access_token`
- 設定位置：options 頁「Readwise Reader 整合」區塊（password input）

### Popup UI 行為

- 「送到 Readwise Reader」按鈕放在「切換閱讀模式」下方，次級樣式（白底灰邊）
- popup 開啟時透過 `GET_READER_STATE` 查 reader mode 狀態：
  - 未啟動 → button disabled，title `先啟動閱讀模式才能送出`
  - 已啟動 → button enabled
  - 頁面不支援（chrome:// 等 sendMessage reject）→ button disabled
- 點擊：popup → content（`EXTRACT_READER_HTML` 抽 outerHTML + url + title）→ popup → SW（`SAVE_TO_READWISE` 帶 payload）→ SW 讀 token + fetch + 回結果
- 狀態條訊息：`已送到 Readwise Reader` / `已存在於 Readwise Reader` / `尚未設定 Readwise token` / `Readwise token 無效或已過期` / `網路錯誤` / `送出失敗（HTTP N）`

### 為何 fetch 放 SW 而非 popup

popup 關閉後其 fetch 會中斷；放 SW 即便使用者立刻關掉 popup，fetch 仍會跑完。SW 透過 `sendResponse` 回 popup（若 popup 已關則 silently drop，但伺服器端已收到）。

### 純函式抽離

`jread/popup/popup-core.js` 暴露 `buildReadwisePayload` / `saveToReadwise`（依賴注入 fetchImpl），可被 popup（瀏覽器端）與 SW（importScripts）共用、Node 端直接 require 做單測。`test/regression/readwise-save.spec.js` 14 條 spec 覆蓋 payload 結構 / NO_TOKEN / AUTH(401) / HTTP(500) / NETWORK / 成功 200/201 + forcing function 比對 namespace.js / SW 訊息協定常數。

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
