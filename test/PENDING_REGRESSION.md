# Pending Regression Queue

> 當下抽不出最小重現結構的 bug 暫放於此。清空狀態為只保留本 header。
> 流程見 `CLAUDE.md` 硬規則 4（路徑 B）。

每條條目格式：

```
## [日期] 簡短標題
- 觸發頁面：<URL>
- 症狀：
- 推測根因：
- 未補 spec 原因：
- 責任人/目標日期：
```

---

<!-- 待辦條目從這裡往下加 -->

## [2026-06-27] Reader 整合 iOS Safari 真機驗證（v1.0.22；v1.0.23 feed 空白硬化待驗）
- 觸發頁面：擴充自有頁 `reader/reader.html`（feed）+ `reader/article.html?id=<docId>`（文章），iOS / iPadOS Safari Web Extension
- **v1.0.23 進展**：Jimmy 2026-06-27 真機回報「iOS 進入 Reader 開出新分頁但空白、沒顯示 feed」。已硬化讓 feed 頁不再靜默空白——下個 TestFlight build 看**頁面顯示什麼訊息**即可定位失敗層：「載入中…」卡住不動＝scripts 沒跑完 / fetch hang；「初始化失敗（缺少 …）」＝模組沒載；「載入失敗：…」＝list fetch reject；「尚未設定 Readwise token…」＝storage 沒讀到 token；仍全白＝scripts 根本沒執行（CSP / WAR / 載入錯誤，需 Safari Web Inspector 連線看 console）。WAR 已補 reader 頁（但 options.html 不在 WAR 也能開，WAR 未必是根因）。**請 Jimmy 裝 v1.0.23 後回報看到的訊息**，據此再修真正失敗點。
- 症狀（其餘維度，Chromium `tools/reader-harness.js` 已實證 styler 套用 / 改主題即時重套 / 位置記憶跨 reload / feed 渲染+封存皆 PASS；但 WebKit 只能真機驗）：
  1. **真實 Readwise fetch 可靠性**：擴充頁直接 fetch readwise.io（list / update）在 iOS 是否穩定（floating-icon.js:205 註解曾實證擴充頁 fetch 在 iOS 可靠、content script 不可靠；reader 頁是擴充頁理應 OK，但 list/update 是新呼叫點待證）
  2. **即時重套兜底**：iOS popup 開啟掛起底層頁時 `storage.onChanged` 會丟事件——reader 文章頁是否靠既有 `visibilitychange` 重套（main.js）+ REAPPLY_SETTINGS onMessage 接回（popup 關閉、reader tab refocus 時重套主題/字型）
  3. **floating-icon 頁內面板降級**：Safari 不能在頁內 iframe 載擴充頁（floating-icon.js:229 `isSafariRuntime` → 改開新分頁載 popup.html）——article.html 上長按 floating-icon 開功能選單在 iOS 是否正常降級
  4. **位置記憶 storage.local**：article.html?id= 的閱讀位置在 iOS storage.local 寫入/回復是否正常（position-memory 已有 stripLoneSurrogates + writeWithSelfHeal 處理 iOS set reject）。**v1.5.9 修強制關閉 Safari 後不記位置**：Jimmy 2026-06-28 真機回報「Reader 文章頁翻頁模式讀到一半、強制關閉 Safari 再開回到第 1 頁」——根因 iOS 背景化凍結 event loop，`persistNow` 舊路徑「先 async `localGet` 讀回再寫」的回呼永遠等不到、`set` 從未發出；修法進場 seed `memMap` 記憶體副本、flush 走同步寫入（`computeNextMap` + 同步 `set`，IPC 在 handler 內送達即落地）。jsdom 驗結構（memMap 分支 set 在 localGet 前 + restore seed + endSession 清回）、Chromium reload 本就正常。**v1.5.9 推測被真機推翻**（Jimmy 2026-06-28 v1.5.9 實測）：session 內回第 6 頁 OK、強關後第 1 頁；強關後 options 顯示 readingPositions 仍 41 筆（資料在）、且先開 options 暖機再進文章仍第 1 頁（排除冷讀 race）。剩 H2b（記錄在磁碟但冷啟動翻頁總頁數沒就緒 total<=1→resolved 0）vs H2c（記錄沒刷到磁碟、強關留舊快照）。**v1.5.10 出診斷儀器**：`readingPositionsRestoreDiag`（found/page/pages/total/resolved）options 顯示。**待 Jimmy 裝 v1.5.10 → 強關→進文章→回 options 讀「上次還原：…」那行**，據 found / 當下total 分辨 H2b/H2c 再出修正版（確認後移除儀器）
- 推測根因：無（功能在 Chromium 正常，純缺 iOS 平台覆驗）
- 未補 spec 原因：需 Jimmy 真機 Readwise 帳號 + token + 網路；jsdom / Chromium harness 模擬不到 WebKit + iOS 訊息層回收 + 真實 API 限流。新增的 reader 頁全部沿用既有 iOS 修法（擴充頁 fetch、visibilitychange 兜底、storage.local 自癒），無新平台機制。
- 將來如何補：TestFlight build（ios-build.sh 已 rsync 自動含 reader/ 新檔，無需改 build 腳本）→ 真機填 token → 進入 Reader → 開一篇 → 切主題/字型驗即時重套 → 捲動退出再進驗位置記憶 → feed 封存一篇驗移除。模擬器可用既有 SyncStorage.db 直寫 readwiseToken + openurl article.html?id= 自驗渲染（需網路）。
- 責任人/目標日期：Jimmy 下次 TestFlight 驗收

## [2026-06-26] 翻頁模式退出捲回閱讀位置（v1.0.21 暫不支援）
- 觸發頁面：任何長文 + 翻頁模式（settings.pagedMode=true），如 chinatalk.media/p/best-books-q1-2026
- 症狀：捲動模式已支援「退出時捲回閱讀段落」（v1.0.21 syncScrollOnExit）；翻頁模式退出仍由 `pagedMode.uninstall` 還原「進場前文件位置」（從頭進入 = 回開頭），未捲到目前頁所讀內容。Jimmy 2026-06-26 問「翻頁能否比照辦理」。
- 推測根因：翻頁模式主文以 CSS multicolumn 水平展開，「目前頁讀到哪一段」對映回文件位置有兩個硬問題——(1) `getBoundingClientRect` 對跨欄續接 block 回 **as-if-unfragmented** rect（left/top 落在較早那一欄），per-page 段落偵測不可靠；(2) 頁碼↔段落數 **非線性**（含圖/標題的頁段落數差異大），ratio 換算偏移大。
- 已試三法（Chromium debug-harness probe 實證皆失準，paged-exit-probe.js）：① 強制 scrollLeft=0 + `round((left−base)/stride)` 反推頁碼 → 偏 1157px（選到別欄段落）；② 量目前 scrollLeft 下 viewport 欄內 top 最小 block（含 0.5×stride 同欄容忍）→ 仍偏（getBlocks 集合含跨欄 block）；③ `ratio=idx/(total−1)` × blocks 數 取段落 → 落點 overlap=0（過衝到 9743/maxY 34335）。
- 未補 spec 原因：jsdom 無 layout（multicolumn rect 全 0），此問題只在真實引擎重現；且需 iOS Safari 覆驗（翻頁主要是 iOS 電子書式入口，WebKit 對 scrolled-state fragment rect 另有偏移）。
- 將來如何補：可行方向是 install/remeasure 時就為每個 block 建「block→頁碼」對映表（趁版面 fresh、用更紮實的量法如逐 block range.getClientRects 取得各 fragment 真實欄位置），退出時以目前 idx 反查該頁首段。屬獨立工程，非 v1.0.21 範圍。
- 責任人/目標日期：未定（Jimmy 視需求決定是否投入）

<!-- 2026-06-17 Page Rounds FAIL/triage 清單已全數結案：
  - overflow（rust-book / kubernetes / arxiv / python-docs / requests）：
    code/math span 被 scroll 祖先內捲＝近誤報 → v0.8.101 audit scroll-clip 豁免
    （tools/audit-lib.js）解決；arxiv 寬公式被 card overflow:hidden 切掉＝真破版
    → v0.8.101 styler wide-content scroll 修法（table/pre 溢出 display:block+
    overflow-x:auto）解決。regression：audit-overflow-scroll-clip.spec.js +
    styler-wide-content-scroll.spec.js。
  - contrast fa/th/el wiki（2.93–2.98 navbox 邊界近誤報）/ gitbook body-width
    （73% 邊界、視覺無破版）/ distill figcaption（站特殊 margin-figure niche）：
    triage 結論記入 docs/excluded/page-rounds-sites.md 各站備註，Jimmy 2026-06-17
    決定不修。 -->

