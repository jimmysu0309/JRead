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

## 環境分工（硬規則）

**Claude Code** 是**實作主力**——所有程式碼的新增/修改（含 UI/DOM / content script / detector / cleaner / styler / popup / background / manifest）、git、`npm test`、regression spec、fixture、文件同步、release 一律在 Claude Code 做。拿到新功能需求或 bug 報告時，**直接開始寫 code**，不要把需求轉手給 Cowork。

**Cowork** 是**Chrome MCP 驗證工具**——唯一目的是做 Claude Code 做不到的事：用 `mcp__Claude_in_Chrome__*` navigate 到真實頁面、觀察 DOM、執行 JS、肉眼看樣式效果。Cowork **不寫程式碼、不動 extension 檔案**。

### 什麼時候需要切 Cowork

切到 Cowork 的唯一理由是「需要實地看真實頁面才能回答某個問題」。典型情境：

- 我實作的改動需要在多個真實站點上**驗證視覺/行為正確**（Claude Code 端只能跑 jsdom 測，看不到真實 layout / CSS / font rendering）
- 某個 bug 只有在真實頁面重現，我需要當場讀其 DOM 結構 / computed styles / 事件流才能找到根因
- 使用者給的截圖不夠，需要我實地去看該頁的 HTML 結構

Cowork 的產出是**觀察報告**（DOM 片段、computed style、行為描述），不是 code diff。觀察報告帶回 Claude Code 後，我在這裡改 code。

### Cowork 絕對不可以

- 自己改 `jread/` 下任何檔案
- 自己 bump `manifest.json` 的 version
- 自己改 SPEC.md / README.md / CHANGELOG.md / docs / 測試期望值常數
- 碰 git（sandbox 的 `.git/` 受保護，`git add` / `commit` / `tag` 會失敗，不要嘗試）

### Claude Code 實作的 Chrome 驗證責任

因為 Claude Code 沒有 Chrome MCP，動到下列類別的程式碼時，**commit + release 前**必須先請 Jimmy 到 `chrome://extensions/` 重新載入 extension 並回報有無錯誤，才繼續 commit / bump / release：

- `jread/background/service-worker.js`
- `jread/manifest.json`（特別是 `background` / `commands` / `content_scripts` / `permissions` 區塊）
- `jread/popup/*`（任何動到 chrome.* API 呼叫或載入結構的改動）
- 任何用到 `importScripts` / `chrome.scripting.executeScript` 的檔案
- 影響真實頁面排版的 styler / CSS 注入（視覺效果要 Jimmy 肉眼驗）

這類改動的典型流程：
1. Claude Code 寫 code + `npm test` 過 + `git status` 乾淨
2. **停下來，先請 Jimmy 手動驗 Chrome**（reload extension、看錯誤 tab、跑核心流程）
3. Jimmy 回報 OK → `git add` + commit + bump + release
4. Jimmy 回報有問題 → 帶觀察結果回來修 code，回到步驟 1

若 Jimmy 手動驗還不夠（例如需要多個站點 side-by-side 比對、或 DOM 要逐元素讀），再切 Cowork 做 MCP 驗證。

### Claude Code 環境雜項

- **啟動方式**：shell alias `cc` = `claude --dangerously-skip-permissions`（視 Jimmy 實際慣用而定）
- **改 extension 資料夾前先確認 working tree 乾淨**：若有未 commit 的變更先 commit 或 stash
- **bump 版本號後必須立刻 `git tag v<新版本>`**

---

## 硬規則（不可違反）

### 1. 版本號管理

- 每次修改 Extension 功能、UI、設定結構，**必須** bump `manifest.json` 的 `version`
- 格式：**三段式** `1.0.0`（Chrome 會把 `1.01` 解析成 `1.1`，前導零會被吃掉）
- Popup 顯示的版本號必須用 `chrome.runtime.getManifest().version` 動態讀取，**絕對不可寫死在 HTML**
- **bump 版本號是 Claude Code 端的責任**：Cowork 端只改程式碼，不動版本號
- **版本 bump 同步清單**（每次 bump 都必須全部更新，少一個測試就會 fail）：
  1. `jread/manifest.json` 的 `version`
  2. `SPEC.md` 的「目前 Extension 版本」標頭
  3. `CHANGELOG.md` 頂部新增一條 `**vX.Y.Z**——` 條目
  4. `test/version-check.spec.js` 的 `EXPECTED_VERSION` 常數（此常數是 forcing function，刻意設計成 bump 後不改就 fail）
  5. `README.md` 若有提到版本號的段落

### 1.5 版本還原

Claude Code 端：`git checkout v<版本號> -- jread` 即可還原到任一歷史版本。不需要手動快照（git tag 本身就是快照）。`.backups/` 為遺留資料夾，Cowork 不再寫入。

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

1. Claude Code 改 extension 程式碼（結構性根因，見硬規則 3）
2. 在 `test/regression/fixtures/` 建或擴充 fixture HTML（若為 bug，擷取最小可重現結構）
3. 在 `test/regression/` 建或擴充對應 spec
4. sanity check：暫時破壞修法 → 確認 fail → 還原 → 確認 pass
5. 跑完整 `npm test` 確認沒踩既有 spec
6. 若改動影響 Chrome 實際行為（見「Claude Code 實作的 Chrome 驗證責任」清單）→ 先請 Jimmy 手動 reload extension 驗 → OK 後再 bump
7. bump 版本號 + 更新同步清單 + `./release.sh`
8. 若需要多站點視覺比對或 DOM 細讀，切 Cowork 做 MCP 驗證；回來後依結果決定是否追加修正

**路徑 B（fallback）**：若當下抽不出最小重現結構（例如純 entry script、wire-up、importScripts 路徑解析、chrome.* API 行為這類只能在真實 Chrome 觀察的問題），在 `test/PENDING_REGRESSION.md` 加一筆條目，註明未補 spec 的技術原因與將來如何補。

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

## Debug Bridge 模式（可選，視專案需要建立）

如果 JRead 的 content script 有內建 debug log 系統（例如「主文偵測器挑中的元素」、「被隱藏的雜訊數」），可以透過 CustomEvent 橋接讓 Cowork 的 Chrome MCP 讀取 log，省去請使用者截圖的步驟。

參考做法（isolated world ↔ main world）：

```js
// content script 監聽 main world 的請求
window.addEventListener('__jread-debug-request', e => {
  const { action, afterSeq } = e.detail;
  // 回傳 log buffer
  window.dispatchEvent(new CustomEvent('__jread-debug-response', { detail: logs }));
});
```

```js
// Chrome MCP 在 main world 查詢 log
new Promise(r => {
  window.addEventListener('__jread-debug-response', e => r(e.detail), { once: true });
  window.dispatchEvent(new CustomEvent('__jread-debug-request', { detail: { action: 'GET_LOGS', afterSeq: 0 } }));
  setTimeout(() => r('TIMEOUT'), 5000);
});
```

**自動除錯循環**：

1. Chrome MCP navigate 到目標頁面
2. Bridge 清快取（若有）
3. Bridge 清 log
4. Bridge 觸發「開啟閱讀模式」
5. 輪詢等待完成
6. Bridge 拉 log，分析 warn / error（例如「偵測到 0 個候選主文」）
7. 有 bug → 改 code → 請使用者 reload extension → 回到步驟 1 驗證

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
- ❌ 不要在 Cowork 端碰 git
- ❌ 不要在 Cowork 端動 `jread/` 任何檔案（Cowork 只做 Chrome MCP 驗證）
- ❌ 不要把新功能或 UI 修改轉手給 Cowork 去寫——程式碼一律在 Claude Code 端實作
- ❌ 不要用站點 hostname / class selector 做特判（見硬規則 3）；必要時放到明確隔離的 site-overrides
- ❌ 不要在主文偵測失敗時硬套排版——直接 no-op，不要誤傷原頁面
