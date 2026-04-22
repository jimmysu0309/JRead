# CLAUDE.md — Chrome Extension 專案協作指引模板

> 這份文件給 Claude 讀。每次在這個 Project 內開始新對話時，請先讀本檔與 `SPEC.md`，再動手。
>
> **使用說明**：把所有 `【TODO: ...】` 標記換成你的專案實際內容，再刪掉這段說明。
>
> **全域規則**：跨所有專案的協作規則（使用者資料、台灣用語、UI 設計指引、視覺素材分工、git 安全、回覆風格）已在 `~/.claude/CLAUDE.md`，那份會自動套用、這裡不重複。**這份模板只收 Chrome Extension 專屬的規則與踩坑經驗**。

---

## 使用者資料（專案特有調整）

> 通用使用者資料在 `~/.claude/CLAUDE.md`。這裡只寫專案特有的。

- **專案中的角色**：【TODO: 例如「此 extension 的主要測試者與設計 stakeholder」】
- **本專案相關技術熟悉度**：【TODO: 例如「熟悉 Gmail API / 曾用過 Notion API 但未用過 Chrome Storage」】

---

## 專案概觀

- **專案名稱**：【TODO: 專案名稱】
- **類型**：Chrome Extension（Manifest V3）
- **目標**：【TODO: 一句話說明這個 Extension 要解決什麼問題】
- **測試目標網站**：【TODO: 例如 Gmail、Twitter/X、Wikipedia...】
- **完整規格**：見 `SPEC.md`（**開始任何工作前必讀**）

---

## 開始新對話時的標準動作

1. 讀本檔（`CLAUDE.md`）了解協作規則
2. 讀 `SPEC.md` 了解專案全貌、已完成功能、待辦事項
3. 讀 `【TODO: extension 資料夾】/manifest.json` 確認目前版本號
4. 讀 `test/PENDING_REGRESSION.md`：**若該檔案非空（除了 header 外有任何待辦條目）**，第一句話必須主動提醒「目前 pending regression queue 還有 N 條未清，要不要先處理？」這條提醒不可省略，也不可放在回應後段
5. 視任務需要讀相關 source
6. 再動手

**絕對不要**憑記憶或猜測就動手改，因為新對話的 Claude 沒有前一次對話的上下文。

---

## 實作流程（硬規則）

所有工作——程式碼新增/修改（含 UI/DOM / content script / detector / popup / background / manifest）、git、`npm test`、regression spec、fixture、文件同步、視覺驗證、release——**一律在 Claude Code 端完成**。拿到新功能需求或 bug 報告時，直接開始寫 code。

### 視覺/行為驗證（自動化優先）

程式碼改完後，驗證分兩層：

**第一層：jsdom regression**（`npm test`）——驗邏輯正確、API 結構、可逆性。跑得快、不需瀏覽器。

**第二層：Playwright harness**（`npm run debug` 或 `node tools/debug-harness.js`）——驗真實 Chrome 行為。用 Playwright **內建 Chromium**（不是系統 Chrome，見下方「harness 關鍵坑」）+ `launchPersistentContext` 載入 unpacked extension，透過 SW `chrome.tabs.sendMessage` 觸發功能，讀 DOM 副作用、量測 layout、截圖。Claude 讀 stdout + 用 Read tool 看截圖即可**自驗**視覺結果，**不用請使用者貼 console 或截圖**。

完整流程、七個常見坑、移植到其他 extension 專案的清單見 `docs/CHROME_EXTENSION_DEBUG.md`。

### 什麼時候還需要使用者手動 Chrome reload

harness 覆蓋率很高（service worker 啟動、manifest 解析、content script 注入、DOM 操作、CSS 算出值），但以下情境 harness 模擬不到，**commit + release 前**仍需請使用者到 `chrome://extensions/` reload extension 確認：

- **keyboard shortcut**：Playwright Chromium 的鍵盤對映可能與使用者本機 Chrome 不同；`chrome://extensions/shortcuts` 的衝突只有在實機才顯現
- **popup 的使用者互動**：harness 只跑 SW 後端觸發；popup 的點擊、即時 setting 更動需實機操作驗
- **使用體感問題**：字體渲染、配色對比、動畫順暢度等主觀感受

其餘類別（排版、隱藏規則、偵測、storage listener、SW 訊息協定）harness 都驗得到，**不用再煩使用者**。

典型流程：
1. 改 code → `npm test` 過
2. `npm run debug` 自驗（讀 stdout + 看截圖）
3. 若命中「仍需使用者手動驗」清單 → 停下來請使用者 reload 驗
4. OK → `git status` 全看過 → commit + bump + release

### 環境雜項

- **啟動方式**：【TODO: 你慣用的啟動方式，例如 shell alias `cc` = `claude --dangerously-skip-permissions`】
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
  1. `【TODO: extension 資料夾】/manifest.json` 的 `version`
  2. `package.json` 的 `version`
  3. `SPEC.md` 的「目前 Extension 版本」標頭
  4. `CHANGELOG.md` 頂部新增一條 `**vX.Y.Z**——` 條目
  5. `test/version-check.spec.js` 的 `EXPECTED_VERSION` 常數（此常數是 forcing function，刻意設計成 bump 後不改就 fail）
  6. 【TODO: 其他需要同步的地方，例如 Landing Page、README...】

### 1.5 版本還原

`git checkout v<版本號> -- 【TODO: extension 資料夾】` 即可還原到任一歷史版本。不需要手動快照（git tag 本身就是快照）。

### 2. 文件同步

- 每次修改 Extension 行為、UI、設定，**必須**同步更新所有受影響的文件
- **同步範圍**（不只 SPEC.md）：
  1. `SPEC.md`：功能規格、設定欄位預設值、訊息協定、檔案結構等
  2. `README.md`：版本號、功能特色、安裝/使用說明
  3. `CHANGELOG.md`：版本條目
  4. `CLAUDE.md`：協作規則本身
  5. 【TODO: 其他專案特有的文件】
- **具體數值必須對照程式碼**：預設值、欄位名稱、函式名稱等，必須從程式碼確認，不可憑記憶填寫
- 程式碼改完還沒同步文件 = 工作沒做完

### 3. Bug 修法必須是「結構性通則」，不可以是特判

- 判斷標準：問自己「這條規則描述的是 DOM / CSS 的結構特徵，還是某個網站 / class / selector 的身份？」
  - ✅ 可以：描述 DOM 結構特徵、CSS 特性、ARIA 語意 role 等
  - ❌ 不可以：`if (location.hostname === 'example.com')` 綁定站點
  - ❌ 不可以：`el.matches('.some-class')` 綁定特定 class
- 找不到通用規則時的正確反應：**停下來追問根因**，不要先加一個可以矇過當下測試頁的特判

### 4. 修 bug 必須同步寫 regression 測試（不可累積技術債）

每次在 extension 資料夾修 bug + bump 版本號的同一輪對話，**必須**選下面其中一條路徑：

**路徑 A（首選）**：

1. 改 extension 程式碼（結構性根因，見硬規則 3）
2. 在 `test/regression/fixtures/` 建或擴充 fixture HTML（若為 bug，擷取最小可重現結構）
3. 在 `test/regression/` 建或擴充對應 spec
4. sanity check：暫時破壞修法 → 確認 fail → 還原 → 確認 pass
5. 跑完整 `npm test` 確認沒踩既有 spec
6. 若改動影響真實 Chrome 行為 → `npm run debug` 跑 Playwright harness 自驗（讀 stdout + 看截圖）
7. 若命中「仍需使用者手動驗」清單 → 停下來請使用者 reload 驗
8. bump 版本號 + 更新同步清單 + `./release.sh`

**路徑 B（fallback）**：若當下抽不出最小重現結構（例如純 entry script、wire-up、鍵盤對映這類只能在使用者本機 Chrome 觀察的問題），在 `test/PENDING_REGRESSION.md` 加一筆條目，註明未補 spec 的技術原因與將來如何補。

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
- 子模組間用 `window.__<命名空間>` 或 IIFE 模式共用狀態
- `manifest.json` 的 `content_scripts.js` 陣列需按載入順序列出所有 content script 檔案
- Content script 讀不到 background service worker 的記憶體狀態，通訊必須走 `chrome.runtime.sendMessage`
- Content script 在 **isolated world**，page 的 `window` 看不到 content script 的變數。驗證時要看 DOM 副作用而非 JS 變數

### Background Service Worker

- Manifest V3 的 background 是 service worker，不是持續運行的 background page
- 不可依賴全域變數在請求之間保存狀態——用 `chrome.storage` 持久化
- service worker 可能隨時被 Chrome 終止，設計時要考慮重啟後的恢復邏輯
- `importScripts()` 的相對路徑是相對 SW 自己所在目錄，不是 extension root——跨目錄請用絕對路徑（前置斜線）

### 儲存

- `chrome.storage.local`：本機持久化，容量較大
- `chrome.storage.sync`：跨裝置同步，有嚴格的配額限制（`QUOTA_BYTES_PER_ITEM` 8KB）
- 快取類資料放 `storage.local`，使用者偏好設定放 `storage.sync`
- 跨分頁即時同步用 `chrome.storage.onChanged` listener，不必自建訊息協定

### Popup / Options

- 版本號必須用 `chrome.runtime.getManifest().version` 動態讀取，絕不寫死在 HTML
- Popup 寬度典型 300px——高密度 UI，**全域 CLAUDE.md 的「UI 對齊 grid」與「高密度 UI 空間哲學」全面適用**；兄弟元件（stepper / button group / toggle）左右邊緣與內部分隔線必須對齊、刪除純裝飾 heading、form 控制項設固定寬不讓瀏覽器撐
- **Popup 與 Options 共用 Design System tokens**（`--jr-primary-*` / `--jr-neutral-*` / `--jr-radius-*` / `--jr-space-*`）；options 頁是 popup 的「延伸」不是獨立風格

### 快速鍵（manifest commands）

- **避開與 Chrome 內建衝突的組合**：`Cmd/Ctrl+Shift+R` 撞強制重載、`Cmd+T` 撞新分頁等；衝突時 Chrome 會靜默忽略 `suggested_key`、使用者看到 shortcut 欄位空白
- **推薦組合**：`Alt+<letter>`（Mac 上 Alt = Option，不吃單字母 macOS 特殊字元衝突是小成本換單手觸發效率）
- **Chrome 機制坑**：`suggested_key` **只在首次安裝時套用**，extension reload 不會重套；既有使用者升級後若 shortcut 欄位仍空，必須手動去 `chrome://extensions/shortcuts` 指派。發佈時在 release notes 說明這件事

### Icon family（manifest icons / action.default_icon）

- 4 種尺寸：**16 / 32 / 48 / 128**（工具列 / Windows HiDPI / Extensions 管理頁 / Store listing + 安裝對話框）
- `action.default_icon` 與 `icons` 可以用同一組，但如果要做「active / idle 兩態 icon」：
  - `default_icon` → idle（灰階）
  - SW 在 enter / exit reader mode（或 enable / disable state）時用 `chrome.action.setIcon({tabId, path})` 切彩色
  - `chrome.tabs.onUpdated` status='loading' 時重置為 idle，處理導航後的 per-tab state 殘留
- **Icon 設計本身**：依全域 CLAUDE.md 的「視覺素材分工」，brand-critical → Claude Design；Claude Code 只寫 `tools/generate-icons.js` 當草稿生成器

---

## 自動化除錯 harness 關鍵坑

### 修 DOM 演算法前先 harness 驗假設

改 detector / cleaner / styler / 任何跟真實網站 DOM 互動的邏輯時，**必須先在 harness 上用一次性 probe 腳本驗證假設、再動 extension code**。jsdom fixture 是 forcing function（防止未來 regress），**不是**假設探索工具——fixture 是你自己寫的最小重現，會漏掉真實站點 candidate 列表裡的元素（整站 wrapper、WP block wrapper、CMS 無 class div）。

**正確順序**：
1. `tools/probe-<site>.js` 把**假設的評分/判斷邏輯**注入 `page.evaluate` 跑真實站點
2. 列出 top-N 候選 + 各項分數，**肉眼驗證演算法會選到正確元素**
3. 假設確認後才改 extension code + 補 fixture + spec
4. probe 跑完刪掉（一次性），commit 只留 extension code + fixture + spec

### 常見踩坑（移植到新專案時先看一遍）

以下是 `tools/debug-harness.js` 設計時踩過的坑：

- **`page.evaluate(() => !!window.__MyExt)` 永遠 false**：content script 在 isolated world，page.evaluate 在 main world。驗證要看 DOM 副作用（attribute / injected style / computed value）。
- **Chrome 137+ 擋 `--load-extension`**：必須用 Playwright 內建 Chromium（`channel: 'chromium'`），不是 Google Chrome / Edge。
- **Playwright MCP 不支援 unpacked extension**：MCP server 層不暴露 persistent context 設定（[issue #39569](https://github.com/microsoft/playwright/issues/39569)）。寫 standalone node script 用 `chromium.launchPersistentContext`。
- **第一個 about:blank 分頁 content script 不注入**：Playwright 啟動時 extension 還沒註冊。SW 起來後先 `ctx.pages()[0].close()` 再 `ctx.newPage()`。
- **`waitUntil: 'networkidle'` 卡住**：現代網站永遠沒 idle。用 `'load'` + `sleep(2500)` 等 document_idle。
- **`chrome.tabs.sendMessage` 拋 `Could not establish connection`**：content script 還沒注入，navigate 後至少等 2.5 秒；try/catch 包住。

完整指南見 `docs/CHROME_EXTENSION_DEBUG.md`。

---

## 工作風格偏好

### 除錯方向優先序

1. 【TODO: 專案特有的除錯優先序】
2. background ↔ content 訊息傳遞是否正確
3. 快取是否殘留舊結果
4. 最後才考慮調整 CSS 樣式細節 / prompt / 模型參數

### 程式碼風格

- Content script 用 IIFE + `window.__<命名空間>` 模式
- Background / popup / options 可以用 ES module
- 註解用【TODO: 語言】
- 不要亂加功能或過度工程；MVP 優先
- 要動沒要求的檔案前先詢問

### 主動建議開新對話的時機

以下條件全部成立時，**在當輪回應的最末加一句**「這是好斷點，要不要開新對話？」：

1. `./release.sh`（或 release 流程）剛成功完成
2. `git status` 是 working tree clean
3. `test/PENDING_REGRESSION.md` 沒有任何未完成的活動條目

---

## 回覆風格（Chrome Extension 專案補充）

> 通用回覆風格在 `~/.claude/CLAUDE.md`，此處只補 Chrome Extension 專屬的：

- 修完 bug 後要告訴使用者具體操作步驟（例如「到 `chrome://extensions/` 按 reload」或「到 `chrome://extensions/shortcuts` 指派快速鍵」）
- 提醒「Chrome 只在首次安裝才套用 `suggested_key`」這類 Chrome 機制特性時講明白、不要讓使用者自己猜

---

## 不要做的事（Chrome Extension 專案專屬）

> 通用禁止事項（繁中/台灣用語、破壞性 git、寧可問一句等）在 `~/.claude/CLAUDE.md`。此處只列 Chrome Extension 專屬：

- ❌ 不要寫死版本號到 Popup HTML——必須 `chrome.runtime.getManifest().version` 動態讀取
- ❌ 不要在沒同步更新 SPEC.md 的情況下結束任務
- ❌ 不要在沒 bump 版本號的情況下結束任務
- ❌ 不要跳過自動化驗證直接 commit 有視覺風險的改動——`npm run debug` 是 release 流程的一部分
- ❌ 不要在驗證時叫使用者貼 console 或截圖——harness 讀 stdout + 截圖就夠了，少數 harness 驗不到的情境才請使用者 reload
- ❌ 不要用站點 hostname / class selector 做特判（見硬規則 3）——必須結構性通則
- ❌ 不要自己設計出 brand-critical icon / logo / store promo 當最終版——這些交 Claude Design（見 `~/.claude/CLAUDE.md`）
- ❌ 【TODO: 你這個專案特有的禁止事項】
