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

**第二層：Playwright harness**（`npm run debug` 或 `node tools/debug-harness.js`）——驗真實 Chrome 行為。用 Playwright 內建 Chromium + `launchPersistentContext` 載入 `jread/` 為 unpacked extension，開啟目標頁、透過 SW `chrome.tabs.sendMessage` 觸發閱讀模式，讀 DOM 副作用（`data-jread-active` / injected `<style>` / `getBoundingClientRect`）、算元素間 gap、截圖到 `.playwright-mcp/jread-viewport.png`。Claude 讀 stdout log + 用 Read tool 看截圖即可**自驗**視覺結果，**不用請 Jimmy 貼 console 或截圖**。

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
