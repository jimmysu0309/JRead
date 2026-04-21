# CLAUDE.md — Chrome Extension 專案協作指引模板

> 這份文件給 Claude 讀。每次在這個 Project 內開始新對話時，請先讀本檔與 `SPEC.md`，再動手。
>
> **使用說明**：把所有 `【TODO: ...】` 標記換成你的專案實際內容，再刪掉這段說明。

---

## 使用者資料

- **名字**：Jimmy
- **語言/文化**：台灣使用者，**一律使用繁體中文 + 台灣用語**，絕不使用簡體字或中國大陸用語（例如：軟體不是「軟件」、資料夾不是「文件夾」、影片不是「視頻」、程式不是「程序」、介面不是「界面」、滑鼠不是「鼠標」、網路不是「網絡」）
- **技術背景**：理解概念、會看截圖、會操作 Chrome 擴充功能，非專業開發者
- **環境**：macOS、Chrome 最新版
- **心態**：把 Claude 當協作者，會提供清楚的 bug 回報與方向指引

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

## 環境分工（硬規則）

**Cowork** 負責所有 UI/DOM 相關 bug 的 code 修改——動到 content script / injector / detector 這類渲染相關檔的修正，一律在 Cowork 做。判斷標準：若 bug 的根因需要「實地看真實頁面 DOM」才能確定，就是 Cowork 的工作。

**Claude Code** 負責 git / `npm test` / regression spec / fixture / 文件同步 / release。也含純邏輯模組修正（background service worker 的非渲染路徑、API 呼叫層、快取層、儲存層等）。

**Claude Code 碰到 UI bug 不准自己改**——必須直接跟 Jimmy 說「這要切 Cowork 實地診斷」，不要試圖純推理找結構性通則。

### Cowork 環境（UI/DOM bug 修復主力）

必須切到 Cowork 的情境：
- 任何 UI/DOM 相關 bug 的 code 修改
- 在真實頁面上排版爆掉、某類元素沒處理、某類元素誤處理
- SPA 導航異常
- 任何判斷標準是「實地看真實頁面就知道」的問題

Cowork 有 `mcp__Claude_in_Chrome__*` 可以 navigate / 讀 DOM / 跑 JS，Claude Code 端沒有。

**Cowork 絕對不可以**：
- 自己 bump `manifest.json` 的 version
- 自己改 SPEC.md / README.md / CHANGELOG.md / docs / 測試期望值常數的版本號
- 碰 git（sandbox 的 `.git/` 受保護，`git add` / `commit` / `tag` 會失敗，不要嘗試）

### Claude Code 環境（git / test / release / 文件 / 非渲染邏輯）

- **啟動方式**：【TODO: 你慣用的啟動方式，例如 shell alias `cc` = `claude --dangerously-skip-permissions`】
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
  1. `【TODO: extension 資料夾】/manifest.json` 的 `version`
  2. `SPEC.md` 的「目前 Extension 版本」標頭
  3. `CHANGELOG.md` 頂部新增一條 `**vX.Y.Z**——` 條目
  4. `test/version-check.spec.js` 的 `EXPECTED_VERSION` 常數（此常數是 forcing function，刻意設計成 bump 後不改就 fail）
  5. 【TODO: 其他需要同步的地方，例如 Landing Page、README...】

### 1.5 版本快照備份

**Cowork 環境**：動手改程式碼前必須先快照：
```
cp -a 【TODO: extension 資料夾】 .backups/【資料夾名稱】-v<當前 manifest 版本>
```
冪等：已存在則略過。

**Claude Code 環境**：不需要手動複製，`git checkout v<版本號> -- 【TODO: extension 資料夾】` 即可還原。

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
  - ✅ 可以：描述 DOM 結構特徵、CSS 特性
  - ❌ 不可以：`if (location.hostname === 'example.com')` 綁定站點
  - ❌ 不可以：`el.matches('.some-class')` 綁定特定 class
- 找不到通用規則時的正確反應：**停下來追問根因**，不要先加一個可以矇過當下測試頁的特判

### 4. 修 bug 必須同步寫 regression 測試（不可累積技術債）

每次在 extension 資料夾修 bug + bump 版本號的同一輪對話，**必須**選下面其中一條路徑：

**路徑 A（首選）**，分兩階段：

第一階段（Cowork）：
1. 用 Chrome MCP navigate 到真實 bug 頁面、看 DOM
2. 找結構性根因（見硬規則 3）
3. 改 extension 程式碼
4. `cp -a ...` 快照（冪等）
5. **在 Chrome MCP 上驗**：reload extension → navigate 到原 bug 頁面 → 實地確認修好（不可跳過）
6. 回報 root cause + diff 給 Jimmy，告訴他切回 Claude Code 繼續

第二階段（Claude Code）：
1. 跑 `git status` 確認 Cowork 的改動都在 working tree
2. 在 `test/regression/fixtures/` 建 fixture HTML
3. 在 `test/regression/` 建對應 spec
4. sanity check：暫時破壞修法 → 確認 fail → 還原 fix → 確認 pass
5. 跑完整 `npm test` 確認沒踩既有 spec
6. bump 版本號 + 更新同步清單 + `./release.sh`

**路徑 B（fallback）**：若當下抽不出最小重現結構，在 `test/PENDING_REGRESSION.md` 加一筆條目。

**絕對不可以兩條都不做**。

### 5. Claude Code 側 commit 前必須完整檢查 `git status`

- 每次準備 commit 之前，必須先跑完整 `git status`，把 staged / unstaged / untracked 三欄全部看過
- 若有本次任務沒在改的檔案出現，**必須停下來追問「這個檔案為什麼會在這？」**
- 不可以默默把無關的變更一起 `git add` 混進當前 commit
- Cowork 改完的 UI fix 最常以 unstaged 狀態躺在 working tree 等待，切回 Claude Code 要主動處理

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

### Background Service Worker

- Manifest V3 的 background 是 service worker，不是持續運行的 background page
- 不可依賴全域變數在請求之間保存狀態——用 `chrome.storage` 持久化
- service worker 可能隨時被 Chrome 終止，設計時要考慮重啟後的恢復邏輯

### 儲存

- `chrome.storage.local`：本機持久化，容量較大
- `chrome.storage.sync`：跨裝置同步，有嚴格的配額限制（`QUOTA_BYTES_PER_ITEM` 8KB）
- 快取類資料放 `storage.local`，使用者偏好設定放 `storage.sync`

### Popup / Options

- 版本號必須用 `chrome.runtime.getManifest().version` 動態讀取，絕不寫死在 HTML

---

## Debug Bridge 模式（可選，視專案需要建立）

如果 extension 的 content script 有內建 debug log 系統，可以透過 CustomEvent 橋接讓 Cowork 的 Chrome MCP 讀取 log，省去請使用者截圖的步驟。

參考做法（isolated world ↔ main world）：

```js
// content script 監聽 main world 的請求
window.addEventListener('__ext-debug-request', e => {
  const { action, afterSeq } = e.detail;
  // 回傳 log buffer
  window.dispatchEvent(new CustomEvent('__ext-debug-response', { detail: logs }));
});
```

```js
// Chrome MCP 在 main world 查詢 log
new Promise(r => {
  window.addEventListener('__ext-debug-response', e => r(e.detail), { once: true });
  window.dispatchEvent(new CustomEvent('__ext-debug-request', { detail: { action: 'GET_LOGS', afterSeq: 0 } }));
  setTimeout(() => r('TIMEOUT'), 5000);
});
```

**自動除錯循環**：
1. Chrome MCP navigate 到目標頁面
2. Bridge 清快取（若有）
3. Bridge 清 log
4. Bridge 觸發主要功能
5. 輪詢等待完成
6. Bridge 拉 log，分析 warn / error
7. 有 bug → 改 code → 請使用者 reload extension → 回到步驟 1 驗證

---

## 工作風格偏好

### 除錯方向優先序

1. 送給 API / 服務的輸入是否有噪音
2. 資料擷取邏輯是否抓到正確單位
3. 分批、對齊、邊界是否正確
4. background ↔ content 訊息傳遞是否正確
5. 快取是否殘留舊結果
6. 最後才考慮調整 prompt / 模型參數

### 程式碼風格

- Content script 用 IIFE + `window.__<命名空間>` 模式
- Background / popup / options 可以用 ES module
- 註解用繁體中文
- 不要亂加功能或過度工程；MVP 優先
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
- ❌ 【TODO: 你這個專案特有的禁止事項】
