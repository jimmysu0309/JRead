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

