# CLAUDE.md — JRead 專案協作指引

> 這份文件給 Claude 讀。每次在這個 Project 內開始新對話時，請先讀本檔與 `SPEC.md`，再動手。

---

## 使用者資料

- **名字**：Jimmy
- **語言/文化**：台灣使用者，**一律使用繁體中文 + 台灣用語**，絕不使用簡體字或中國大陸用語（例如：軟體不是「軟件」、資料夾不是「文件夾」、影片不是「視頻」、程式不是「程序」、介面不是「界面」、滑鼠不是「鼠標」、網路不是「網絡」）
- **技術背景**：理解概念、會看截圖、會操作 Chrome 擴充功能，非專業開發者
- **環境**：macOS、Chrome 最新版
- **心態**：把 Claude 當協作者，會提供清楚的 bug 回報與方向指引

---

## 專案概觀

- **專案名稱**：JRead
- **類型**：Chrome Extension（Manifest V3）
- **目標**：Clone of Chrome Extension「Unclutter」——提供純閱讀模式，隱藏廣告、側邊欄、彈窗、浮動元素等雜訊，保留主文內容並套用乾淨排版
- **測試目標網站**：
  - 新聞網站（例如 BBC、紐約時報、CNN、天下雜誌、聯合新聞網）
  - 部落格平台（Medium、Substack、WordPress 類站）
  - Wikipedia / 知識庫（Stack Overflow 等）
  - 技術文件（MDN、Dev.to、各種 docs 站）
- **完整規格**：見 `SPEC.md`（**開始任何工作前必讀**）

---

## 開始新對話時的標準動作

1. 讀本檔（`CLAUDE.md`）了解協作規則
2. 讀 `SPEC.md` 了解專案全貌、已完成功能、待辦事項
3. 讀 `jread/manifest.json` 確認目前版本號
4. 讀 `test/PENDING_REGRESSION.md`：**若該檔案非空（除了 header 外有任何待辦條目）**，第一句話必須主動提醒「目前 pending regression queue 還有 N 條未清，要不要先處理？」這條提醒不可省略，也不可放在回應後段
5. 視任務需要讀相關 source
6. 再動手

**絕對不要**憑記憶或猜測就動手改，因為新對話的 Claude 沒有前一次對話的上下文。

---

## 實作流程（硬規則）

所有工作——程式碼新增/修改（含 UI/DOM / content script / detector / cleaner / styler / popup / background / manifest）、git、`npm test`、regression spec、fixture、文件同步、視覺驗證、release——**一律在 Claude Code 端完成**。拿到新功能需求或 bug 報告時，直接開始寫 code，不轉手給其他環境。

### 視覺/行為驗證（自動化優先）

程式碼改完後，驗證分兩層：

**第一層：jsdom regression**（`npm test`）——驗邏輯正確、API 結構、可逆性。DOM attribute、CSS 字串內容、還原流程等。跑得快（< 1s）、不需瀏覽器。

**第二層：Playwright harness**（`npm run debug` 或 `node tools/debug-harness.js`）——驗真實 Chrome 行為。用 Playwright 內建 Chromium + `launchPersistentContext` 載入 `jread/` 為 unpacked extension，開啟目標頁、透過 SW `chrome.tabs.sendMessage` 觸發閱讀模式，讀 DOM 副作用（`data-jread-active` / injected `<style>` / `getBoundingClientRect`）、算元素間 gap、截圖 `.playwright-mcp/jread-viewport.png`（viewport 第一屏）+ `.playwright-mcp/jread-reader-fullpage.png`（整個 reader card）。Claude 讀 stdout log + 用 Read tool 看截圖即可**自驗**視覺結果，**不用請 Jimmy 貼 console 或截圖**。

**截圖前一律套 `document.body.style.zoom = '0.5'`**（Jimmy 2026-04-24 硬規則）：同一張 fullpage 能看更多內容、Claude Read 巡整頁排版時一次吃進更多 vertical 空間；`zoom` 只縮 layout、不降 screenshot 解析度，文字仍清晰。新寫 harness 類 script 都照這個 pattern 加。

### Harness residual audit（硬性驗收——禁止偽陰性驗收）

**動 cleaner / detector 類 rule 後的 harness 驗收**必須用 residual audit mode——`tools/debug-harness.js` 會在 post-toggle 後印出：
1. reader card 內所有 visible h1-h6 / a / button / span / figcaption 的 direct text outline（前 60 項，過濾 SVG `<title>` / `<script>` 等肉眼不可見 tag）
2. 命中 `NOISE_AUDIT_KEYWORDS` 的⚠️ warning 清單（含 parent class，方便辨識 DOM 結構）
3. 初始 1.2s 後 + delayed 5s 後**兩次 audit**（捕捉 SPA 站晚到的 lazy-load 注入）
4. **CONTRAST AUDIT**（v0.7.225）：reader card 內 visible 文字 vs effective bg（ancestor 爬升 + alpha 合成）的 WCAG 對比，< 3:1 印 ⚠️——「東西在、看不見」類 bug（dark scheme 站的色被白卡吃掉）residual / gap audit 都抓不到，**修 styler / theme 類改動後驗收必看本段**。`--scheme dark` flag 模擬深色模式使用者（此類 bug 常只在 dark scheme 重現，tymscar 2026-06-07 實證）
5. **PAGED AUDIT**（v0.7.230）：`--paged` flag 驗收翻頁模式（toggle 前寫 settings.pagedMode=true，印 column CSS 算出值 / 頁數 / 鍵盤翻頁 stride 實測）。v0.7.231 起 stride = `clientWidth − 左右 padding + column-gap`（右視覺內距是 transparent border 不是 padding——WebKit scrollable overflow 不含尾端 padding；`padding-right ≠ 0` 會印 warning）；頁數由內容末端實測（`computePageCountFromExtent`），不信 scrollWidth（正式版 Safari 多報幽靈欄）。**改 background SW 後 harness 必加 `--fresh`**——Chromium 把 unpacked extension 的 SW 快取在 persistent profile，重啟不一定重載（content script 每次從磁碟新載），「content 新 / SW 舊」的不對稱會誤導 debug（v0.7.230 燒 4 輪實證）

**Chromium harness 綠 ≠ WebKit（Safari）綠**：本 harness 只驗 Chrome 軌。v0.7.230 翻頁模式 `column-count: 1` bug 即 Chrome 全綠、所有 Safari 全滅（WebKit 對 count=1 不建 multicol fragmentation context）。Jimmy 回報「Safari / iOS 行為跟 Chrome 不一致」時，WebKit 軌驗證流程（Playwright WebKit 注入法 + safaridriver 真 Safari 法、各自的坑）見 `docs/CHROME_EXTENSION_DEBUG.md`「WebKit（Safari）軌的驗證」章節；**Playwright WebKit 是 trunk build，綠燈不可直接當正式版 Safari 綠**。

**禁止僅用 grep 特定 keyword 判定「清乾淨」** —— 那是**偽陰性驗收**（grep 沒命中 ≠ 不在，可能是 harness 沒 dump 該段 DOM）。殘留雜訊必須由 `RESIDUAL AUDIT` 產生 `✅ 無殘留雜訊` 標示，且 visible outline 無明顯非主文內容，才算驗收過。

Jimmy 連續回報「內文以下殘留」的歷史教訓（chinatimes sidebar / udn 延伸閱讀 / line today 「其他人也看」+「網友AI摘要」+「訂閱」+「廣告（請繼續）」+「贊助本文章」+「Google新聞」+「追蹤中時新聞網」+「聽新聞」+「要聞 breadcrumb」）都是舊 harness 只看 `gaps` / grep 少數 keyword 判定，實際雜訊在 visible outline 裡長期躲過驗收。residual audit 是這個教訓的 forcing function，保留用。

完整流程與常見坑見 `docs/CHROME_EXTENSION_DEBUG.md`。

### 假設驗證順序（硬性要求）

**修 detector / cleaner / styler 這類跟真實網站 DOM 互動的 bug 時，必須先在 harness 上驗證假設、再動 extension code**。jsdom fixture **不是**假設驗證工具——fixture 是你自己寫的最小重現，會漏掉真實站點 candidate 列表裡的元素（例如整站 wrapper、WordPress block wrappers、CMS 自動生成的無 class div），用 fixture 驗「新演算法會選到哪個元素」通常會得到 false positive。

**正確順序**：
1. 在 `tools/` 下寫一次性 probe 腳本（例：`tools/probe-<site>.js`），把**假設的評分/判斷邏輯**直接注入 `page.evaluate` 跑**真實站點 DOM**
2. 列出 top-N 候選 + 各項分數/中間變數 → **肉眼驗證這條演算法會選到正確元素**
3. 假設確認後，才改 detector / cleaner / styler
4. 寫 fixture + spec（forcing function），sanity check 破壞修法驗 fail → 還原驗 pass
5. 跑 `npm test` 全過
6. 再跑 harness 驗實際視覺結果
7. probe 腳本用完就刪（一次性），commit 只留 extension code + fixture + spec

**錯誤順序的代價**：若順序是「改 code → npm test 過 → 才跑 harness → 發現真實 DOM 跟 fixture 不一致」，等於要重改一次。2026-04-21 Stratechery 修 detector 就踩過這個坑——jsdom fixture 裡「多分支懲罰」規則看似夠用，真實頁面卻因 `div.wp-site-blocks`（整站 wrapper）後代 p 數太多而贏過真主文，得重寫成 Readability-style bubble-up。

### v0.7.3 整輪 cleaner 大量修法累積的教訓（2026-04-23，chinatimes + udn + line today 三站反覆驗收）

**硬教訓一：Playwright harness 的 lazy-load 速度 ≠ 使用者實機 Chrome**
LINE Today 類 SPA 站點，留言面板 / 推薦 widget 是 API 異步注入。Playwright Chromium 在 bot detection 或 CSP 下**根本沒 load** 這些 widget，但 Jimmy 實機 Chrome 看得到。我反覆「harness audit 無 warning」判定清乾淨、Jimmy 反覆「看！還有」—— 因為 harness 當下 DOM 根本沒那些 node。對策：harness audit 必須 `scrollTo(0, document.body.scrollHeight)` 兩次 + 等 15s 才做第二次 audit，逼 lazy-load 跑完；即便如此仍可能抓不到（比如需要 user interaction）。遇到「Jimmy 看到 / 我看不到」時，**相信 Jimmy 的截圖，別信 harness silence**。

**硬教訓二：NOISE_KEYWORD_RE 只掃 CONTAINER_SEL、`<button>` 漏網**
`CONTAINER_SEL = 'div, section, aside, iframe, form, nav, header, footer'`——`<button>` 不在。但 button 的 class 常含 `subscribe / follow / donation / share / repost` 等 keyword（典型 CTA button 命名），漏掃。對策：`hideInsideArticleByKeyword` 另掃一輪 `articleEl.querySelectorAll('button')`，直接對 button tag 做 keyword match。

**硬教訓三：heading text rule 掃 h2-h4 不夠，要掃 div/span**
Next.js / emotion-style SPA 站點（LINE Today 代表）把 section header 做成 `<div>` / `<span>`（不用 semantic heading tag）。「貼文 (166)」「熱門」「最新」「繼續看下去」都是 div/span。對策：heading rule 同時掃 `div, span` 但限制 direct-text length <= 20（避免誤殺主文段落）；`textContent` 對 heading tag 用、direct textNode 對 div/span 用（不抓子孫）。

**硬教訓四：heading rule 只找 `closest('section, aside')` 對 div-only 站失靈**
line today 整棵留言面板全是 div，`closest` 返 null 就放棄 hide—— 但這些 div 確實是雜訊。對策：fallback 升級到 heading 所在 articleEl 的 direct child sub-branch，**但該 sub-branch 不含 >= 100 chars 的主文 p 才 hide**。這條「含主文長段落才保護」guard 是 chinatimes「也許您會感興趣」h4 深埋 column-wrapper 的鉤子——拿掉會誤殺主文。

**硬教訓五：留言面板用「相對時間戳 count」辨識最穩**
留言/社群 widget 跨站結構特徵：每則留言一個相對時間戳（「2 小時前」/「3 分鐘前」/「hours ago」）。主文作者資訊最多 1 個。`hideInsideArticleCommentPanels` 用 `/\d+\s*(分鐘前|小時前|天前|週前|個月前|年前|hours? ago|minutes? ago|days? ago|weeks? ago)/g` 數配額 >= 3 判定 panel，配合「含主文長 p 保護」避免誤殺。這個結構特徵跨 LINE Today / Facebook / Twitter / Reddit / Disqus / Medium 都通用。

**硬教訓六：WYSIWYG 文字 heuristic 比 class heuristic 更 portable**
SPA 站 class 全是 emotion hash（`css-1pq3e9u` 等），**class-based keyword 完全失效**。只能靠**文字 heuristic**：
- `NOISE_HEADING_TEXT_RE`：heading 文字慣用語（延伸閱讀 / 相關新聞 / 更多文章 / 其他人也看 / 最新消息 / 繼續看下去 / AI 摘要 / 網友貼文 等）
- `NOISE_LINK_TEXT_RE`：連結/按鈕文字（查看原始文章 / 加入 LINE 官方帳號 / 訂閱 / 追蹤 / 建立貼文 / 轉發 / 留言 等）
- `NOISE_INLINE_AD_TEXT_RE`：內文插播（廣告（請繼續閱讀本文） / AD（please continue）等）
- `relative time regex`：留言/社群面板

新站點若又出現 class hash、先加文字 heuristic 最快見效；遇到語意 class（`breadcrumb` / `audio-player` / `postListing` / `reposted`）再補 NOISE_KEYWORD_RE。**動詞詞根 + 形容詞變體都要加**：`recommend` vs `recommended` / `sponsor` vs `sponsored` / `discuss` vs `discussion` / `promote` vs `promotion` / `donate` vs `donation` —— 只加形容詞會漏動詞命名的 class（本輪三站都踩過）。

**硬教訓七：harness 驗收禁止「grep STDOUT 判定無命中 = 清乾淨」**
舊 harness 只 grep PAGE log / SW log 等 STDOUT 內容，但 reader card 內的 DOM text 根本沒被 dump 出來—— grep 沒命中只代表 harness 沒 print，不代表實際不在。**偽陰性驗收是本輪最大的時間浪費**（反覆「確認清乾淨」後被 Jimmy 截圖打臉 5+ 輪）。對策已實作：`debug-harness.js` 的 `RESIDUAL AUDIT` 直接遍歷 `[data-jread-active]` 的 visible element、dump outline + warning，**reader card 實際可見 text** 才是驗收基準。

**硬教訓八：中文 / 全形字元 regex 邊界與 case sensitivity**
NOISE_KEYWORD_RE 用 `/i` flag（camelCase class 如 `postListing` 能被 `postlisting` alternation 命中）；中文字沒 case 問題但注意**全形 vs 半形括號**（「廣告（請繼續」/「廣告(請繼續」），NOISE_INLINE_AD_TEXT_RE 用 `[（(]` character class 兩種都吃。SVG `<title>` 的 `.tagName` 是小寫（SVG element 保留原 case）、HTML element 大寫；audit filter 用 `.toUpperCase()` 統一比較。

**硬教訓十一：delayed lazy-inject（toggle 後 N 秒才注入）+ 遞迴 checkDynamicNoise 陷阱**
Jimmy 2026-04-23 回報 udn LINE 分享按鈕「reader mode 啟動後約 3 秒才出現」。這是典型 SPA 站 delayed lazy-inject：
1. content script 在 document_idle 跑 cleaner.clean() 時、按鈕尚未注入
2. 2-4 秒後原站 JS 透過 API 拉社群 widget 注入進 articleEl
3. MutationObserver 攔到 addedNodes 但**舊版 checkDynamicNoise 只檢查 node 自己的 class keyword + node 內的 h2-h4 heading**，漏掉「wrapper 本身無 keyword、內部 button/a 才有 keyword」的情境
修法：`checkDynamicNoise` 加兩條：
- **遞迴 `node.querySelectorAll('button, [role="button"], input[type=button|submit|reset]')` 全 hide**（Jimmy 硬規則：所有 interactive button 一律清，不看 class）
- **遞迴 `node.querySelectorAll('a, button')` 逐一跑 `shouldHideByKeyword`**，class 命中 noise keyword 的直接 hide（即使 wrapper 本身無 keyword）
搭配 `hide()` 用 inline `!important`（第十教訓）—— 即使原站後續 JS 再用 stylesheet `display: flex !important` 試圖重顯示也贏不過 inline !important。兩條合體對 delayed lazy-inject 才有效。
harness 限制提醒：Playwright Chromium 的 lazy-inject 時序可能跟 Jimmy 實機 Chrome 不同步，「我 audit 看不到」不代表「Jimmy 看不到」——修法要靠**邏輯完整性**（MutationObserver subtree + 遞迴 check + inline !important 三者齊備）保證，不能靠「harness 無 warning」判定。遇到「Jimmy 看到 / 我看不到」的差異直接相信 Jimmy 截圖。

**硬教訓十：`hide()` 必須用 inline `!important`，不能靠 stylesheet `!important`**
原本 `el.style.display = 'none'`（inline 無 priority）+ styler 注入 stylesheet `[data-jread-hidden="1"] { display: none !important }`—— 看似穩妥，但 **CSS specificity 仍有勝負**。原站若有 `aside.article-content__social { display: flex !important }` (specificity 0,2,1)，會贏過 jread stylesheet `[data-jread-hidden="1"]` (specificity 0,1,0)。兩邊都 `!important` 時，specificity 高的勝——**原站贏**、被 hide 的元素重新顯示。
修法：`hide()` 改成 `el.style.setProperty('display', 'none', 'important')`——inline !important 是 CSS 優先級最高層（高於任何 stylesheet `!important`），沒有任何 stylesheet rule 能打敗它。restore() 時用 `removeProperty('display')` + 還原原始 `prevDisplayPriority`（原本 inline 若有 `!important` 也要還原）。
2026-04-23 udn 的 LINE 分享按鈕實測：祖先 `aside.article-content__social` 已被 cleaner hide（`data-jread-hidden="1"`）+ stylesheet rule 設 display:none !important，但 Jimmy 實機 reload 後按鈕仍顯示。probe 看到 aside 的 `computedDisplay: "none"` 但祖先的 specificity 鬥爭在某些 DOM 層級可能失效；用 inline !important 保底最穩。

**硬教訓九：reader mode「純閱讀」定位下所有 button 一律清（無保留）**
Jimmy 明確表示：分享 / 訂閱 / 追蹤 / 讚 / 收藏 / 播放 / 展開 / 任何 CTA 等**所有** interactive button，reader mode 下都不需要。不要設「保留常用按鈕」這類 heuristic；`hideInsideArticleAllButtons` 對 `<button>` / `[role="button"]` / `<input type="button|submit|reset">` **無條件 hide**，不看 class、不看 text、不受 `PRESERVE_SEL`（figure/summary/figcaption/blockquote）保護——figure 內的 zoom 按鈕也清。
`<a>` 不屬此 rule（連結是主文引用/參考的一部分，全清會破壞閱讀體驗），僅 NOISE_LINK_TEXT_RE 對 CTA 文字匹配清特定外連/訂閱 `<a>`。
`hideInsideArticleActionRows` / `hideInsideArticleButtonClusters` 的「不 hide 外層 wrapper」保護是為了**保留作者/日期 meta**（避免把 byline+button group 整塊砍），不是為了保留 button 本身——這條保護仍保留；新 rule 清掉 wrapper 內的 button，作者日期留下。
新站 debug 時若看到使用者回報「button 沒清」**不需要考慮保留**——直接加新 rule 的 scope 或讓現有 rule 更激進。使用者**想要的是閱讀內容，不是互動功能**。

### 什麼時候還需要 Jimmy 手動 Chrome reload

harness 覆蓋率很高（service worker 啟動、manifest 解析、content script 注入、DOM 操作、CSS 算出值），但以下情境 harness 模擬不到，**commit + release 前**仍需請 Jimmy 到 `chrome://extensions/` reload extension 確認：

- **keyboard shortcut**：Playwright Chromium 的鍵盤對映可能與 Jimmy 本機 Chrome 不同；`chrome://extensions/shortcuts` 的衝突（例如 `Cmd+Shift+R` 撞 Chrome 內建強制重載）只有在 Jimmy 本機才顯現
- **popup 的使用者互動**：harness 只跑 `chrome.tabs.sendMessage` 後端觸發；popup 的點擊、即時 setting 更動需 Jimmy 用實機 popup 操作驗
- **使用體感問題**：字體渲染、配色對比、動畫順暢度等主觀感受

其餘類別（styler 排版、cleaner 隱藏規則、detector 命中、storage listener 觸發、SW 訊息協定）harness 都驗得到，**不用再煩 Jimmy**。

典型流程：
1. 改 code → `npm test` 過
2. `npm run debug` 自驗（讀 stdout + 看 `.playwright-mcp/jread-viewport.png`）
3. 若命中「仍需 Jimmy 手動驗」清單 → 停下來請 Jimmy reload 驗
4. OK → `git status` 全看過 → commit + bump + release

### 環境雜項

- **啟動方式**：shell alias `cc` = `claude --dangerously-skip-permissions`（視 Jimmy 實際慣用而定）
- **改 extension 資料夾前先確認 working tree 乾淨**：若有未 commit 的變更先 commit 或 stash
- **bump 版本號後必須立刻 `git tag v<新版本>`**
- **harness 首次使用**：`npm install` + `npx playwright install chromium`（下載 bundled Chromium，幾百 MB）

---

## 硬規則（不可違反）

### 1. 版本號管理

- 每次修改 Extension 功能、UI、設定結構，**必須** bump `manifest.json` 的 `version`
- 格式：**三段式** `1.0.0`（Chrome 會把 `1.01` 解析成 `1.1`，前導零會被吃掉）
- Popup 顯示的版本號必須用 `chrome.runtime.getManifest().version` 動態讀取，**絕對不可寫死在 HTML**
- **版本 bump 同步清單**（每次 bump 都必須全部更新，少一個測試就會 fail）：
  1. `jread/manifest.json` 的 `version`
  2. `package.json` 的 `version`
  3. `SPEC.md` 的「目前 Extension 版本」標頭
  4. `CHANGELOG.md` 頂部新增一條 `**vX.Y.Z**——` 條目
  5. `test/version-check.spec.js` 的 `EXPECTED_VERSION` 常數（此常數是 forcing function，刻意設計成 bump 後不改就 fail）
  6. `README.md` 若有提到版本號的段落

### 1.5 版本還原

`git checkout v<版本號> -- jread` 即可還原到任一歷史版本。不需要手動快照（git tag 本身就是快照）。`.backups/` 為遺留資料夾，不再使用。

### 2. 文件同步

- 每次修改 Extension 行為、UI、設定，**必須**同步更新所有受影響的文件
- **同步範圍**（不只 SPEC.md）：
  1. `SPEC.md`：功能規格、設定欄位預設值、訊息協定、檔案結構等
  2. `README.md`：版本號、功能特色、安裝/使用說明
  3. `CHANGELOG.md`：版本條目
  4. `CLAUDE.md`：協作規則本身
  5. `test/fixtures/` 下的測試頁期望值（若測試有依賴預設設定）
- **具體數值必須對照程式碼**：預設值、欄位名稱、函式名稱等，必須從程式碼確認，不可憑記憶填寫
- 程式碼改完還沒同步文件 = 工作沒做完

### 3. Bug 修法必須是「結構性通則」，不可以是特判

- 判斷標準：問自己「這條規則描述的是 DOM / CSS 的結構特徵，還是某個網站 / class / selector 的身份？」
  - ✅ 可以：描述 DOM 結構特徵、CSS 特性（例如「`position: fixed` 且高度小於 viewport 10% 的元素視為 sticky header」）
  - ❌ 不可以：`if (location.hostname === 'medium.com')` 綁定站點
  - ❌ 不可以：`el.matches('.ad-banner')` 綁定特定 class
- JRead 是「Unclutter clone」——針對全網通用，**站點特判只能放在 site-overrides 這類明確隔離的檔案**，不能混進主偵測邏輯
- 找不到通用規則時的正確反應：**停下來追問根因**，不要先加一個可以矇過當下測試頁的特判

### 4. 修 bug / 加功能必須同步寫 regression 測試（不可累積技術債）

每次在 extension 資料夾修 bug 或加功能 + bump 版本號的同一輪對話，**必須**選下面其中一條路徑：

**路徑 A（首選）**：

1. **若是 detector / cleaner / styler 類與真實 DOM 互動的修改：先在 harness 上驗假設（見「假設驗證順序」章節）**，確認新演算法/規則會選到正確元素**再**動 code
2. 改 extension 程式碼（結構性根因，見硬規則 3）
3. 在 `test/regression/fixtures/` 建或擴充 fixture HTML（若為 bug，擷取最小可重現結構）
4. 在 `test/regression/` 建或擴充對應 spec
5. sanity check：暫時破壞修法 → 確認 fail → 還原 → 確認 pass
6. 跑完整 `npm test` 確認沒踩既有 spec
7. 若改動影響真實 Chrome 行為 → `npm run debug` 跑 Playwright harness 自驗（讀 stdout + 看截圖）
8. 若命中「仍需 Jimmy 手動驗」清單（見「視覺/行為驗證」章節）→ 停下來請 Jimmy reload 驗
9. bump 版本號 + 更新同步清單 + `./release.sh`

**路徑 B（fallback）**：若當下抽不出最小重現結構（例如純 entry script、wire-up、importScripts 路徑解析、Chrome 鍵盤對映這類只能在 Jimmy 本機 Chrome 觀察的問題），在 `test/PENDING_REGRESSION.md` 加一筆條目，註明未補 spec 的技術原因與將來如何補。

**絕對不可以兩條都不做**。

### 5. Claude Code 側 commit 前必須完整檢查 `git status`

- 每次準備 commit 之前，必須先跑完整 `git status`，把 staged / unstaged / untracked 三欄全部看過
- 若有本次任務沒在改的檔案出現，**必須停下來追問「這個檔案為什麼會在這？」**
- 不可以默默把無關的變更一起 `git add` 混進當前 commit

### 6. 禁止破壞性 git 操作

不可在未先確認的情況下執行：`git reset --hard`、`git push --force`（含 `--force-with-lease`）、`git checkout -- <path>` 覆蓋未 commit 的變更、`git clean -f`、`git branch -D`。

**「結果可逆」不是動手的理由**——必須先跟使用者確認再執行。

---

## 規則變更流程

當使用者在對話中講出聽起來像「長期規則」的內容（帶有「以後都」、「不要再」、「一律」、「預設」、「從現在開始」這類語氣），Claude 必須：

1. **先用一句話確認**是長期規則還是一次性需求
2. **得到明確同意後**，才寫進 SPEC.md 或 CLAUDE.md
3. **判斷該寫進哪一份**：
   - `SPEC.md`：功能行為、設定欄位、訊息協定、UI 規格（Extension 本身的事實）
   - `CLAUDE.md`：協作風格、版本號規則、除錯流程、不要做的事（Claude 該怎麼工作）

---

## Chrome Extension 開發注意事項

### Content Script 限制（Manifest V3）

- Content script **不能**用 ES module import
- 子模組間用 `window.__JRead` 命名空間或 IIFE 模式共用狀態
- `manifest.json` 的 `content_scripts.js` 陣列需按載入順序列出所有 content script 檔案
- Content script 讀不到 background service worker 的記憶體狀態，通訊必須走 `chrome.runtime.sendMessage`

### 主文偵測（Article Detection）

JRead 的核心是「從一堆雜訊 DOM 中找出主文」，這件事沒有銀彈：

- 優先順序：`<article>` → Schema.org `itemtype="Article"` → Readability.js 啟發式 → 備援
- 偵測邏輯必須可被 site-overrides 覆蓋（某些站點的 DOM 結構過於特殊）
- 失敗時的降級策略：不亂套乾淨排版，直接 no-op 而非誤傷原頁面

### Background Service Worker

- Manifest V3 的 background 是 service worker，不是持續運行的 background page
- 不可依賴全域變數在請求之間保存狀態——用 `chrome.storage` 持久化
- service worker 可能隨時被 Chrome 終止，設計時要考慮重啟後的恢復邏輯

### 儲存

- `chrome.storage.local`：本機持久化，容量較大（頁面狀態快取、最近開啟紀錄）
- `chrome.storage.sync`：跨裝置同步，有嚴格的配額限制（`QUOTA_BYTES_PER_ITEM` 8KB）——放使用者偏好（字體、字級、主題色、行高）
- 快取類資料放 `storage.local`，使用者偏好設定放 `storage.sync`

### Popup / Options

- 版本號必須用 `chrome.runtime.getManifest().version` 動態讀取，絕不寫死在 HTML
- Popup 應該能一鍵切換「純閱讀模式開/關」，並顯示目前頁面偵測結果

---

## 自動化除錯 harness

`tools/debug-harness.js` 是主要自驗工具。關鍵細節：

- **為什麼 `page.evaluate(() => !!window.__JRead)` 永遠 false**：content script 在 isolated world，`page.evaluate` 在 main world，兩個 window 互不相通。驗證 content script 的效果必須看「shared DOM 的副作用」——`data-jread-active` / injected `<style id="__jread-style">` / `getBoundingClientRect` 等。
- **為什麼用 Playwright 內建 Chromium、不用系統 Chrome**：Google Chrome 137+ 擋掉 `--load-extension` flag。Playwright bundled Chromium 沒擋。必須 `channel: 'chromium'` + `launchPersistentContext` + `headless: false`。
- **觸發閱讀模式**：不能靠 `page.evaluate` 呼叫 `window.__JRead.enterReaderMode`（isolated world 看不到）。要走 `sw.evaluate(() => chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_READER_MODE' }))` 讓 SW 傳訊息給 content script。
- **DOM 診斷範例**：找相鄰區塊元素間 `getBoundingClientRect` 垂直 gap > 40px 的位置、列出其前後元素，定位「留白哪來」。

完整坑表與移植指南見 `docs/CHROME_EXTENSION_DEBUG.md`（可複製給其他 extension 專案的 Claude Code 套用）。

---

## 工作風格偏好

### 除錯方向優先序

1. 主文偵測是否選到正確元素（最常見根因）
2. 雜訊隱藏規則是否誤傷主文或漏網
3. SPA 導航後 content script 的重新觸發時機
4. background ↔ content 訊息傳遞是否正確
5. 快取（例如頁面指紋 → 偵測結果）是否殘留舊結果
6. 最後才考慮調整 CSS 樣式細節

### 程式碼風格

- Content script 用 IIFE + `window.__JRead` 命名空間模式
- Background / popup / options 可以用 ES module
- 註解用繁體中文
- 不要亂加功能或過度工程；MVP 優先（先做好「開/關閱讀模式」再談書籤、同步）
- 要動沒要求的檔案前先詢問

### 主動建議開新對話的時機

以下條件全部成立時，**在當輪回應的最末加一句**「這是好斷點，要不要開新對話？」：

1. `./release.sh`（或 release 流程）剛成功完成
2. `git status` 是 working tree clean
3. `test/PENDING_REGRESSION.md` 沒有任何未完成的活動條目

---

## 回覆風格

- 簡潔直接，不要過度鋪陳
- 數字用 K / M 縮寫（`1K`、`4M`），不要寫一大串零
- 技術術語可用但要解釋清楚
- 遇到不確定的狀況寧可問一句，不要瞎猜亂改
- 修完 bug 後要告訴使用者具體操作步驟（例如「到 chrome://extensions/ 按 reload」）
- 不要在每次回應後加長篇總結

---

## 不要做的事

- ❌ 不要自行執行財務交易、下單、轉帳
- ❌ 不要寫死版本號到 Popup HTML
- ❌ 不要在沒同步更新 SPEC.md 的情況下結束任務
- ❌ 不要在沒 bump 版本號的情況下結束任務
- ❌ 不要用簡體字或中國大陸用語
- ❌ 不要過度使用 emoji
- ❌ 不要用破壞性 git 操作（見硬規則 6）
- ❌ 不要跳過自動化驗證直接 commit 有視覺風險的改動——`npm run debug` 是 release 流程的一部分
- ❌ 不要在驗證時叫 Jimmy 貼 console 或截圖——harness 讀 stdout + 截圖就夠了，少數 harness 驗不到的情境（見「什麼時候還需要 Jimmy 手動 Chrome reload」清單）才請他 reload
- ❌ 不要用站點 hostname / class selector 做特判（見硬規則 3）；必要時放到明確隔離的 site-overrides
- ❌ 不要在主文偵測失敗時硬套排版——直接 no-op，不要誤傷原頁面
