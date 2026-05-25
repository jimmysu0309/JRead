# Page Rounds — JRead 批次視覺驗收規格

> **這是什麼**：Claude Code 讀這份文件後，自己批次開網站、觸發 JRead 閱讀模式、
> 截圖、看截圖、逐項用眼睛判定視覺品質、產出報告、再依報告修正問題。
>
> **怎麼啟動**：在新對話中告訴 Claude「讀 `docs/excluded/PAGE-ROUNDS.md`，開始跑 Page Rounds」。
>
> **JRead 閱讀模式長什麼樣**：啟動後，原頁面背景變灰色，中央出現一張白色卡片（reader card），
> 主文內容（標題、圖片、段落）顯示在卡片內，原站的導覽列、側邊欄、廣告等雜訊被隱藏。
> 所有視覺檢查都是在看這張 reader card 的內容。
>
> **核心原則：所有檢查項的最終判定都是 Claude 用 Read tool 看截圖（視覺判定），不是跑程式。**
> 程式化 check（DOM query、rect 計算）只是輔助信號。程式沒報 warning ≠ 沒問題——
> 偽陰性驗收是歷史上最大的時間浪費。

---

## 目標站點清單

站點清單獨立維護在 **`docs/excluded/page-rounds-sites.md`**。

Claude 開始跑之前先讀那份檔案，取得所有測試 URL。新增 / 移除站點在那份檔案維護，本文件不重複列。

---

## 前置條件

首次執行前必須確認環境：

```bash
npm install                        # 安裝 playwright 等依賴
npx playwright install chromium    # 下載 bundled Chromium（幾百 MB，只需跑一次）
```

已經跑過的環境不需要重跑。如果 harness 噴 `Cannot find module 'playwright'` 就補跑。

---

## 執行順序

1. **先跑所有 Playwright 站**（不需登入的站），逐站執行 harness → 看截圖 → 記錄結果
2. **再跑所有 cage 站**（需登入的站 + Playwright fallback 的站），逐站用 MCP tools 操作
3. 全部跑完後彙整總表、寫報告

---

## Harness 策略

| 條件 | 工具 | 理由 |
|------|------|------|
| **需要登入**的站（上方標示 cage） | **cage**（chrome-in-chrome，Jimmy 真實 Chrome） | 必須用已登入的瀏覽器 session 才能看到完整內容 |
| **不需要登入**的站（預設） | **Playwright**（bundled Chromium） | 速度快，大部分公開站點可正常 render |
| Playwright 跑完 Claude **看截圖判定異常** | 自動 **fallback cage** 重跑 | Playwright Chromium 可能被 bot detection 擋、CSP 差異導致內容不完整 |

### Fallback 觸發條件

Playwright 跑完後，Claude 看截圖若判定以下**任一條**，標記該站 fallback、改用 cage 重跑：

- reader mode 沒啟動（截圖裡沒看到灰底白卡片的 reader 介面）
- 頁面明顯不對（cookie banner、bot 驗證頁、空白頁、內容極少）
- 畫面跟預期的文章頁差異太大

### 嚴重問題（critical）必須 cage 重驗

Playwright 判定為 **critical**（B3 內文消失、B7 影片消失、reader mode 未啟動、F1 無法還原）的站，**必須用 cage 重跑一次再下最終判定**。

原因：Playwright bundled Chromium 會被部分站點的 bot detection 擋住，導致 DOM 結構與真實 Chrome 不同——detector 選到錯誤元素、內文看似消失，但實際上是 Playwright 環境問題而非 JRead bug。2026-05-25 businessweekly.com.tw 就是這個案例：Playwright 下 B3 critical（主文消失、只剩推廣卡片），cage 重驗全項通過。

不做 cage 重驗就直接報 critical，會浪費修 code 的時間去追一個不存在的 bug。

---

## Debug Bridge API

Page Rounds 透過 debug bridge（`__jread_debug` CustomEvent）控制 JRead，不用快速鍵、不用 chrome://extensions/。

```js
// 進入閱讀模式
window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'enter' } }));

// 退出閱讀模式（還原檢查用）
window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'exit' } }));

// 切換主題（暗色模式驗收用）
window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'set-theme', theme: 'dark' } }));
// theme: 'light' | 'dark' | 'sepia'

// reload extension
window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'reload' } }));
```

---

## 具體操作方式

### Playwright 模式（不需登入的站）

用 `tools/page-rounds-harness.js`，一個指令跑完整 A-F 流程：

```bash
JREAD_URL="https://udn.com/news/story/124844/9460037" node tools/page-rounds-harness.js
```

harness 會自動完成所有步驟：
1. 用 bundled Chromium 開頁面 + 載入 JRead extension
2. 截原頁面（`original-page-*.png`）— reader mode 前的基準，供 B/F 比對
3. 透過 SW 觸發 reader mode
4. 截亮色截圖（`light-page-*.png`）+ 跑 residual/gap/tail audit
5. 等 5s + scroll 觸發 lazy-load → 截延遲截圖（`delayed-page-*.png`）
6. 切暗色模式 → 截暗色截圖（`dark-page-*.png`）
7. 切回亮色 + 退出 reader mode → 截還原截圖（`restored-page-*.png`）
8. 寫 `audit.json`（輔助信號）

所有截圖存在 `docs/excluded/page-rounds/<hostname>_<path-hash>/` 目錄（同 hostname 不同文章不會互蓋）。

**Claude 跑完 harness 後的動作**：
1. 讀 stdout 的 audit 信號（殘留 warning、gap warning、content stats、**tail audit**）
2. 用 **Read tool** 依序看 `docs/excluded/page-rounds/<hostname>_<hash>/` 下的截圖，**每組都從第一頁看到最後一頁**：
   - `original-page-*.png` — 原頁面基準（知道原文有什麼內容）
   - `light-page-*.png` — 亮色 reader mode → 判定 **A 空白 + B 內容 + C 雜訊 + D 排版**
   - `delayed-page-*.png` — 跟 light 比對，看有無新增雜訊 → 判定 **C7**
   - `dark-page-*.png` — 暗色模式 → 判定 **E**
   - `restored-page-*.png` — 跟 original 比對，看頁面是否恢復 → 判定 **F**
3. **立刻把該站結果寫入 `docs/excluded/page-rounds-report.md`**（不要只貼在對話裡——對話不會留下來，報告檔才會）。格式見本文件「報告格式」章節。
4. 如果該站判定 **PASS**，刪除該站截圖目錄：`rm -rf docs/excluded/page-rounds/<hostname>_<hash>`（PASS 截圖不需留存）。FAIL 的站保留截圖供修正時參考。
5. **如果判定 FAIL**，把 stdout tail audit 裡的問題元素 DOM 資訊（tag + class + text）記進報告的 FAIL 項下方（見「FAIL 報告 DOM context」格式）。這讓新 Claude 不用重跑 harness 就能直接寫 fix。

### cage 模式（需登入的站 + fallback 站）

使用 chrome-in-chrome MCP 工具。Claude 自己當操作者，逐步呼叫 MCP tools。

> **等待方式**：cage 沒有 sleep 指令。用 `javascript_tool` 跑 `await new Promise(r => setTimeout(r, N))` 實現等待，或利用 MCP tool call 之間的自然延遲（每次 call 約 1-2 秒）。

```
步驟 1：取得瀏覽器狀態
  → mcp__claude-in-chrome__tabs_context_mcp

步驟 2：開新 tab
  → mcp__claude-in-chrome__tabs_create_mcp（url: 目標 URL）

步驟 3：等頁面載入
  → mcp__claude-in-chrome__javascript_tool
    code: await new Promise(r => setTimeout(r, 3000))
  → mcp__claude-in-chrome__read_page（確認頁面內容已載入）

步驟 4：截原頁截圖（reader mode 前的基準，供 B/F 比對）
  → mcp__claude-in-chrome__computer（action: screenshot）
  → Claude 看截圖，記住原頁面有什麼內容

步驟 5：觸發 reader mode + 等穩定
  → mcp__claude-in-chrome__javascript_tool
    code: window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'enter' } }));
         await new Promise(r => setTimeout(r, 2000));
         document.body.style.zoom = '0.5';

步驟 6：截亮色截圖 → 判定 A B C D
  → mcp__claude-in-chrome__computer（action: screenshot）
  → Claude 看截圖，逐項判定 A 空白 + B 內容 + C 雜訊 + D 排版
  → 需要看更下面的內容時，用 javascript_tool 執行 window.scrollTo(0, Y) 後再截圖

步驟 7：等 5 秒（捕捉延遲雜訊）→ 截延遲截圖 → 判定 C7
  → mcp__claude-in-chrome__javascript_tool
    code: window.scrollTo(0, document.body.scrollHeight);
         await new Promise(r => setTimeout(r, 5000));
         window.scrollTo(0, 0);
  → mcp__claude-in-chrome__computer（action: screenshot）
  → Claude 跟步驟 6 截圖比對，看有無新增雜訊元素

步驟 8：切暗色模式 → 截暗色截圖 → 判定 E
  → mcp__claude-in-chrome__javascript_tool
    code: window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'set-theme', theme: 'dark' } }));
         await new Promise(r => setTimeout(r, 800));
  → mcp__claude-in-chrome__computer（action: screenshot）
  → Claude 看截圖，判定 E（文字可讀性、連結辨識、引用/程式碼底色、圖片可見）

步驟 9：還原 → 截還原截圖 → 判定 F
  → mcp__claude-in-chrome__javascript_tool
    code: window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'set-theme', theme: 'light' } }));
         await new Promise(r => setTimeout(r, 300));
         window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'exit' } }));
         await new Promise(r => setTimeout(r, 800));
  → mcp__claude-in-chrome__computer（action: screenshot）
  → Claude 跟步驟 4 原頁截圖比對，判定 F（頁面恢復、元素恢復、可互動）

步驟 10：關 tab + 寫入報告
  → mcp__claude-in-chrome__tabs_close_mcp
  → 立刻把該站結果寫入 docs/excluded/page-rounds-report.md（不要只貼在對話裡）
  → 如果 PASS，不需額外動作（cage 模式截圖在 tool result 裡，沒有存檔）
```

> **cage 截圖是螢幕截圖**（`computer` tool 的 screenshot action），Claude 直接在 tool result 裡看到圖片，不需另外用 Read tool。
> cage 模式下截圖無法 zoom 0.5（Jimmy 的 Chrome 視窗大小固定），Claude 需要多次 scroll + 截圖才能看完整頁。

### 看截圖的方法

| 模式 | 截圖來源 | Claude 怎麼看 |
|------|---------|-------------|
| Playwright | `docs/excluded/page-rounds/<hostname>/*-page-*.png` | 用 **Read tool** 讀 PNG 檔（Claude 是多模態 LLM，能直接看圖） |
| cage | `computer` tool 的 screenshot 回傳 | 截圖直接在 tool result 裡，不需另外讀檔 |

---

## 每站執行流程（總覽）

不管 Playwright 或 cage，每站的**判定流程**都是：

```
 1. 開啟頁面 → 等載入完成
 2. 截原頁截圖（reader mode 前的基準，供 B/F 比對）
 3. 觸發 reader mode → 等穩定
 4. 截亮色截圖
 5. Claude 看截圖 → 逐項判定 A（空白）+ B（內容，對照原頁）+ C（雜訊）+ D（排版）
 6. 等 5s → 再截一張 → Claude 比對有無新增雜訊（C7）
 7. set-theme dark → 截暗色截圖
 8. Claude 看截圖 → 逐項判定 E（暗色模式）
 9. set-theme light → exit → 截還原截圖
10. Claude 看截圖 → 對照原頁截圖 → 判定 F（還原）
11. **立刻用 Write/Edit tool 把該站結果寫入 `docs/excluded/page-rounds-report.md`**
12. 如果 PASS → `rm -rf docs/excluded/page-rounds/<hostname>`（不留截圖）
```

> Claude 必須**從卡片頂端看到底端**，不能只看第一屏就判定通過。
> Playwright 模式下每組截圖都是分頁的（page-01、02、03...），每張都要看。

---

## 批次進度追蹤

Claude 用 TaskCreate 建一個總任務，每完成一站用 TaskUpdate 記錄。
報告寫在 `docs/excluded/page-rounds-report.md`。

範例進度：
```
[✅] 1/30 udn.com — PASS
[✅] 2/30 chinatimes.com — FAIL: CT1 hashtag 殘留
[⏳] 3/30 today.line.me — 進行中
[ ] 4/30 chinatalk.media
...
```

---

## 通用檢查項

每個站都必須跑完以下所有項目。**所有項目的最終判定 = Claude 看截圖。**

### A. 空白檢查

| ID | 看什麼 | 有問題的樣子 |
|----|-------|-------------|
| A1 | 標題上方 | 卡片頂端到標題之間有大片空白（超過約 2 行文字高度） |
| A2 | 文末底部 | 最後一段文字到卡片底端之間有大片空白 |
| A3 | 段落之間 | 文章中間突然出現一大塊什麼都沒有的空間（遠大於正常段落間距） |
| A4 | 圖片周圍 | 圖片上方或下方出現不正常的大空白（圖片像浮在空中） |

### B. 內容完整性

| ID | 看什麼 | 有問題的樣子 |
|----|-------|-------------|
| B1 | 標題 | 卡片內看不到文章標題 |
| B2 | 主圖 | 原文有大圖但閱讀模式裡看不到，或圖片位置只剩空框 |
| B3 | 內文 | 文章不完整——只剩標題和圖，中間內文消失（**嚴重**） |
| B4 | 超連結 | 文章裡應有的藍色連結文字消失或看起來跟一般文字沒區別 |
| B5 | 圖說 | 圖片下方的說明文字消失 |
| B6 | 引用區塊 | 原文有 blockquote 引用段落但閱讀模式裡消失 |
| B7 | 影片 | 嵌入影片消失、變空白方塊、或高度歸零看不到 |

### C. 雜訊清除

| ID | 看什麼 | 有問題的樣子 |
|----|-------|-------------|
| C1 | 按鈕 | 看到任何按鈕（分享、按讚、追蹤、收藏、訂閱、播放等） |
| C2 | 推薦區塊 | 看到「延伸閱讀」「相關文章」「推薦」「你可能也想看」「其他人也看了」 |
| C3 | 留言區 | 看到留言、評論、回覆區塊 |
| C4 | 廣告 | 看到廣告橫幅、贊助文字、業配標示 |
| C5 | 導覽列 | 看到頁面頂部的搜尋列、分類選單、網站 header |
| C6 | 側邊欄 | 卡片旁邊看到原站 sidebar 內容，或清掉後留下一整條空白欄 |
| C7 | 延遲雜訊 | 等 5 秒後截的第二張圖比第一張多出新的雜訊元素 |

### D. 排版品質

| ID | 看什麼 | 有問題的樣子 |
|----|-------|-------------|
| D1 | 文字溢出 | 文字跑到白色卡片外面 |
| D2 | 水平捲軸 | 頁面底部出現左右捲動條 |
| D3 | 圖片溢出 | 圖片比卡片寬，超出右邊界 |
| D4 | 表格 | 寬表格被硬切掉（應該要有水平捲動） |

### E. 暗色模式

> 透過 debug bridge `set-theme dark` 切換後截圖判定。

| ID | 看什麼 | 有問題的樣子 |
|----|-------|-------------|
| E1 | 文字可讀性 | 深色背景上出現深色文字，幾乎看不到 |
| E2 | 連結辨識 | 連結跟一般文字完全同色、分不出哪些是連結 |
| E3 | 引用底色 | blockquote 區塊出現刺眼的亮白色底色 |
| E4 | 程式碼底色 | `<pre>` / `<code>` 區塊出現刺眼的亮白色底色 |
| E5 | 圖片可見 | 透明底圖片（如 logo）在暗色背景上完全看不到 |

### F. 還原檢查

> 透過 debug bridge `exit` 退出閱讀模式後截圖判定。

| ID | 看什麼 | 有問題的樣子 |
|----|-------|-------------|
| F1 | 頁面恢復 | 退出後頁面沒有回到原本的樣子（reader card 仍在、背景仍是灰色） |
| F2 | 元素恢復 | 原本的選單、側邊欄、留言區沒有回來 |
| F3 | 可互動 | 頁面上的連結和按鈕無法點擊（被殘留的 overlay 擋住） |

---

## 各站專屬檢查

通用檢查之外，以下站點有歷史上反覆出問題的項目。Claude 看截圖時額外注意這些位置。

### 聯合新聞網（udn.com）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| U1 | 標題下方的作者名 + 日期 | 曾被誤殺消失 |
| U2 | 文末「延伸閱讀」區塊 | 反覆殘留 |
| U3 | 文末「推薦文章」區塊（含長摘要） | 應整塊消失 |
| U4 | LINE 分享按鈕（看 5s 後的截圖） | 延遲載入殘留 |
| U5 | 主圖下方 sponsor-ads 區塊 | 贊助廣告 |
| U6 | 右側有無空白欄 | sidebar 清後殘留空白 |

### 中時新聞網（chinatimes.com）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| CT1 | 文末 hashtag 標籤列 | # 有時是 CSS `::before` 產生 |
| CT2 | 「免費訂閱電子報」區塊 | |
| CT3 | 推薦新聞清單 | |
| CT4 | premium-widget 區塊 | |
| CT5 | 右側有無空白欄 | |
| CT6 | 社群分享列（Facebook / LINE 圖示） | |

### LINE Today（today.line.me）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| LT1 | 留言面板（看 10s 後截圖） | 延遲載入極慢 |
| LT2 | 「其他人也看」區塊 | |
| LT3 | 「網友 AI 摘要」區塊 | |
| LT4 | 訂閱 / Google 新聞 / 追蹤按鈕 | |
| LT5 | 繼續看下去 / 熱門 / 最新區塊 | |
| LT6 | 「贊助本文章」區塊 | |
| LT7 | 「廣告（請繼續閱讀本文）」插播文字 | 文中插播 |

### Medium（medium.com） — 強制 cage

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| M1 | 標題上方有無空白 | action bar 清後殘留 24px |
| M2 | 文章裡的圖片 | 圖片包在 zoom 按鈕內，曾被全清規則誤殺 |
| M3 | 暗色：程式碼區塊字型 | 曾被替換成非等寬字型 |
| M4 | 暗色：程式碼底色 | 是否刺眼 |
| M5 | 頂部 action bar | 寫作/通知/頭像列 |
| M6 | clap 按鈕 / 回應數 | |

### Substack（chinatalk.media）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| SS1 | sidebar + 右側有無空白欄 | |
| SS2 | 圖片上方有無異常空白 | `padding-bottom: 56.25%` hack 殘留 |
| SS3 | YouTube 嵌入影片 | 曾被當空殼 iframe 誤殺 |
| SS4 | 音訊播放器 | 互動元素應清 |
| SS5 | 文末留言區 | |

### Stratechery（stratechery.com）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| ST1 | 標題是否在卡片內 | 標題與內文不同區塊，曾遺失 |
| ST2 | sidebar 是否消失 | |
| ST3 | 主文是否撐滿卡片寬度 | 清 sidebar 後不該留空 |

### BBC News（bbc.com）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| BBC1 | 標題上方 kicker/eyebrow 小標 | 曾殘留 |
| BBC2 | 相關文章區塊 | |
| BBC3 | 主圖 + 圖說 | |

### CNN（cnn.com）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| CNN1 | 分類小標 | |
| CNN2 | 是否退化成單欄 | 原站複雜多欄設計 |
| CNN3 | 廣告 | 數量多 |

### 紐約時報中文版（cn.nytimes.com）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| NYT1 | 主文是否被壓窄（沒撐滿卡片） | 原站 col-* 8/12 欄寬限制 |
| NYT2 | 付費牆提示 | 免費部分正常顯示即可 |

### 東森新聞（ebc.net.tw）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| EBC1 | 主圖是否可見 | absolute 定位曾被誤殺 |
| EBC2 | 主圖上方有無 overlay 殘留 | |

### 新頭殼（newtalk.tw）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| NT1 | 標題是否出現兩次 | promo card clone 導致重複 |
| NT2 | 推廣卡片 | |

### 商業周刊（businessweekly.com.tw）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| BW1 | 開頭提要文字是否保留 | 內文一部分，不該被清 |
| BW2 | 可摺疊資訊卡是否保留 | 內文一部分 |
| BW3 | 付費牆提示 | |

### The War Zone / TWZ（twz.com）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| TWZ1 | 內文是否完整（**嚴重**） | class 含 paywall 字樣曾導致整篇消失 |
| TWZ2 | sidebar | |
| TWZ3 | full-bleed 大圖是否超出卡片 | 負 margin 導致溢出 |

### 方格子 Vocus（vocus.cc）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| VC1 | 字型切換是否生效（cage-only，需操作 popup 切字型） | span 結構問題 |
| VC2 | 有無元素被蓋在下方看不到 | negative z-index |

### MSNBC（msnbc.com）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| MS1 | 標題上方有無大片空白 | category label 隱藏後殘留 |
| MS2 | 作者名 + 日期 | 曾消失 |
| MS3 | 影片是否可見 | player 高度歸零、poster 被清 |
| MS4 | 影片有無遮住文字 | 負 margin 蓋住副標題 |

### 財經站（wealth.com.tw / ctee.com.tw）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| FN1 | 文章開頭內容是否完整 | 開頭數段曾消失 |
| FN2 | hashtag 標籤列（ctee） | |
| FN3 | 灰底引文區塊是否保留 | |

### Wikipedia（zh.wikipedia.org）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| WK1 | 長文捲動是否正常 | |
| WK2 | 目錄是否被清 | |
| WK3 | 參考來源有無造成版面混亂 | |
| WK4 | 編輯按鈕是否被清 | |

### Stack Overflow（stackoverflow.com）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| SO1 | 程式碼區塊 + 等寬字型 | |
| SO2 | 寬程式碼可否水平捲動 | |
| SO3 | 投票按鈕 | |

### MDN Web Docs（developer.mozilla.org）

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| MDN1 | 程式碼完整 + 等寬字型 | |
| MDN2 | 表格有無溢出 | 屬性表格很寬 |
| MDN3 | 側邊導覽 | |

### X / Twitter（x.com） — 強制 cage

| ID | 看什麼 | 歷史問題 |
|----|-------|---------|
| X1 | 主推文 | |
| X2 | thread 同作者推文是否全部保留 | |
| X3 | 他人回覆是否排除 | |
| X4 | reply/retweet/like 按鈕 | |
| X5 | 側邊欄 | |
| X6 | 推文內圖片 | |
| X7 | 引用推文是否保留 | |

### 鉅亨網（cnyes.com）

| ID | 看什麼 | 備註 |
|----|-------|------|
| CY1 | 主文是否完整 | Next.js SPA，harness fullpage 截圖曾出現整片空白 |
| CY2 | 圖表 / 嵌入 iframe 是否可見 | 財經站常嵌股價走勢圖 |
| CY3 | 推薦新聞 / 相關報導區塊 | |

### 上報（upmedia.mg）

| ID | 看什麼 | 備註 |
|----|-------|------|
| UP1 | 主圖是否可見 | |
| UP2 | 文末推薦 / 熱門文章區塊 | |

### 中央社（cna.com.tw）

| ID | 看什麼 | 備註 |
|----|-------|------|
| CNA1 | 作者名 + 日期 | |
| CNA2 | 文末相關新聞區塊 | |

### Lawfare（lawfaremedia.org）

| ID | 看什麼 | 備註 |
|----|-------|------|
| LF1 | 長文內文完整 | 法律分析文通常很長 |
| LF2 | sidebar 清除 | |

### 國際電子商情（esmchina.com）

| ID | 看什麼 | 備註 |
|----|-------|------|
| ESM1 | 簡體中文內文完整 | |
| ESM2 | 圖片是否可見 | |

### Peterson-KFF（healthsystemtracker.org）

| ID | 看什麼 | 備註 |
|----|-------|------|
| KFF1 | 圖表是否可見 | 數據視覺化站，大量 chart |
| KFF2 | 互動圖表有無被清 | chart 是內容核心，不該被清 |

### TBIJ（thebureauinvestigates.com）

| ID | 看什麼 | 備註 |
|----|-------|------|
| TB1 | 內文完整 | |
| TB2 | 主圖 + 圖說 | |

### CNBC（cnbc.com）

| ID | 看什麼 | 備註 |
|----|-------|------|
| CNBC1 | 內文完整 | |
| CNBC2 | 廣告清除 | 廣告很多 |
| CNBC3 | 影片 player 是否可見 | |

---

## 報告格式

報告寫在 `docs/excluded/page-rounds-report.md`。

### 單站報告格式

PASS 的站只列一行，不需要展開全部 ✅ 的表格（30 站有 25 站 PASS 的話，750 行全 ✅ 沒有資訊量）。
FAIL 的站才展開詳細表格，且**只列 FAIL 的項目**。

```
### udn.com — ✅ PASS
（全項通過，無需展開）

### chinatalk.media — ❌ FAIL (medium)

URL: https://www.chinatalk.media/p/quantum-101
Harness: playwright
截圖: `docs/excluded/page-rounds/chinatalk.media_a1b2c3/`

FAIL 項目：
| ID | 說明 |
|----|------|
| C2 | 文末「Subscribe to ChinaTalk」訂閱區塊殘留 |

DOM context（from tail audit）：
| tag | class | text |
|-----|-------|------|
| H4 | pencraft | Subscribe to ChinaTalk |
| DIV | pencraft | Hundreds of paid subscribers |
| DIV | pencraft | By subscribing, you agree Substack's... |
| A | pencraft | Terms of Use |
| A | pencraft | Privacy Policy |
```

> **DOM context 的用途**：新 Claude 看到 `H4 "Subscribe to ChinaTalk"` 就知道可以用
> `NOISE_HEADING_TEXT_RE` 加 `subscribe` pattern，不用重跑 harness probe DOM。

### 嚴重程度定義

| 等級 | 代號 | 觸發條件 |
|------|------|---------|
| 嚴重 | `critical` | B3（內文消失）、B7（影片消失）、reader mode 未啟動、F1（無法還原） |
| 中等 | `medium` | C1-C7（雜訊殘留）、A1-A4（空白）、E1-E4（暗色模式） |
| 輕微 | `low` | D1-D4（排版微調）、E5（透明圖片） |

### 總表（報告開頭）

```
# Page Rounds 報告 — 2026-05-25

## 修正指引

拿到這份報告的新 Claude，照以下順序工作：

1. **先讀專案規則**：讀 `CLAUDE.md` 和 `SPEC.md`，了解 JRead 的架構、硬規則、coding convention
2. **讀修正策略**：讀 `docs/excluded/PAGE-ROUNDS.md` 最末「自動修正策略」章節，知道每種問題該改哪個檔案
3. **看截圖理解問題**：用 Read tool 看報告中提到的截圖路徑（`docs/excluded/page-rounds/<hostname>/*.png`），親眼確認問題
4. **依 CLAUDE.md 硬規則修 code**：
   - 修法必須是結構性通則，不可站點特判（硬規則 3）
   - 修 detector/cleaner/styler 前先跑 harness probe 驗假設（假設驗證順序）
   - 每次修 bug 必須同步寫 regression spec（硬規則 4）
5. **跑 `npm test`** 確認沒破壞既有 spec
6. **重跑該站 harness 驗證修好了**：`JREAD_URL="<該站 URL>" node tools/page-rounds-harness.js`，看截圖確認 FAIL 變 PASS
7. 全部修完 → bump 版本 → commit

### 關鍵原始碼位置

| 問題類型 | 要改的檔案 | 常改的函式 / 變數 |
|---------|-----------|-----------------|
| C 雜訊殘留 | `jread/content/cleaner.js` | `NOISE_KEYWORD_RE`、`NOISE_HEADING_TEXT_RE`、`hideInsideArticleByKeyword`、`hideInsideArticleAllButtons` |
| A 空白 | `jread/content/cleaner.js` | `hide()` 相關 rule，或 `jread/content/styler.js` 的 CSS strip |
| B 內容被誤殺 | `jread/content/cleaner.js` | 過度清除的 rule，檢查 `PRESERVE_SEL`、guard 條件 |
| D 排版溢出 | `jread/content/styler.js` | `buildCss()` 裡的 CSS override |
| E 暗色模式 | `jread/content/styler.js` | `THEMES` 物件、`buildCss()` 裡的 dark theme CSS |

## 總表

30 站測試，26 通過，4 有問題

| 等級 | 站點 | 問題 |
|------|------|------|
| 嚴重 | — | 無 |
| 中等 | udn.com | C1 按鈕殘留、U2 延伸閱讀殘留 |
| 中等 | chinatimes.com | CT1 hashtag 殘留 |
| 輕微 | bbc.com | D3 圖片微溢出 |
| 輕微 | msnbc.com | A1 標題上方空白 |
```

---

## 自動修正策略

報告完成後，Claude 依報告中的 FAIL 項目自動修正：

| 問題類型 | 自動修正可行性 | 修正方式 |
|---------|---------------|---------|
| C2/C4 雜訊文字殘留 | **高** | 加 keyword 到 `NOISE_KEYWORD_RE` / `NOISE_HEADING_TEXT_RE` 等 regex |
| C1 按鈕殘留 | **高** | 擴 `hideInsideArticleAllButtons` scope 或加 selector |
| C3 留言區殘留 | **中** | 調整 `hideInsideArticleCommentPanels` 的 regex / threshold |
| A1-A4 空白 | **中** | 需 probe DOM 找出佔空間的元素，加 hide rule 或 CSS strip |
| B 內容被誤殺 | **需判斷** | 需辨識是哪條 cleaner rule 過度清除，逐案分析 |
| E 暗色模式色彩 | **需判斷** | 可能需調 styler CSS，逐案分析 |
| D 排版溢出 | **低** | 需理解原站 layout 結構，通常要加 CSS override |

**修正流程**：
1. 高可行性問題 → 批次修正 → `npm test` → 重跑該站 Page Rounds 驗證
2. 中/需判斷問題 → 列清單 → 逐站用 probe 或 cage 看 DOM 結構 → 逐案修正
3. 修完所有問題 → 完整重跑一次 Page Rounds 確認無 regression
4. 全部通過 → bump 版本 → commit

### 視覺驗證是硬性要求（不可只看數字）

**harness stdout 的數字（visibleTextLength、residual audit、gap audit）是輔助信號，不是驗收標準。** 數字正常不代表視覺正常——內文可能被壓窄、排版可能炸開、圖片可能錯位，這些都不會反映在 stdout 數字裡。

以下場景**必須用 Read tool 看截圖**或用 **cage 截圖**做視覺判定，不可只看 harness 數字就報 PASS：

1. **修完 FAIL 後的該站驗證**：跑完 harness 後，用 Read tool 看 `light-page-*.png` 從頭到尾，確認主文完整 + 雜訊已清 + 排版正常。只看 stdout 就報 PASS = 偽驗收。
2. **regression check（重跑其他站確認沒壞）**：每站至少看 `light-page-01.png`（首屏）確認 reader card 有正常內容、寬度合理、排版沒炸。「visibleTextLength 正常」不代表「視覺正常」——內文寬度被壓窄、表格溢出、code block 跑版這些問題 stdout 完全看不到。
3. **cage 驗證**：觸發 reader mode 後截圖看首屏 + 滾到底看尾巴。不能只觸發 reader mode 不截圖就報 PASS。

**違反此規則的歷史教訓**：v0.7.190 修 7 站 C2 FAIL 後跑 6 站 regression check，只看 harness stdout 數字（visibleTextLength、residual PASS）就全報 PASS，完全沒有用 Read tool 看任何一張截圖。Jimmy 問「為什麼你認為 MDN 內文寬度正常」時才發現根本沒看過截圖。
