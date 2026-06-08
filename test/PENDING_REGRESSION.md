# Pending Regression Queue

> 當下抽不出最小重現結構的 bug 暫放於此。清空狀態為只保留本 header。
> 流程見 `CLAUDE.md` 硬規則 4（路徑 B）。

每條條目格式:

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

## [2026-06-08] v0.7.245 翻頁第一頁「捲動停止後鎖」最終版 extension 真機 feel-check
- 觸發頁面：任意翻頁模式（pagedMode）文章，iOS Safari（TestFlight v0.7.245）
- 症狀：(待最終確認) 收尾版 = 101vh（範圍極小，Jimmy instrument 逐值實測 101vh 即收得了工具列）+ 第一頁「捲動停止後才鎖」（onScroll debounce 250ms 停止 + scrollY>2 → vLocked + touch-action:none）+ 第二頁起 preventDefault 鎖。各組成都在真機 Pages instrument 驗過：101vh 收得了 / 停止後鎖鎖得住、工具列維持收合不彈回、下滑被擋。剩：組裝成 extension 後整體手感——第一頁上滑收合→停止後鎖→左右滑乾淨；第二頁起垂直鎖住；翻頁正常。
- 推測根因：N/A（功能收尾，非 bug）。失敗教訓（v0.7.240→243）：在慣性中設 touch-action:none 會彈回頂端 + 工具列重展開——鎖必須等捲動「停止後」才設。
- 未補 spec 原因：iOS Safari 工具列收合 + 停止後鎖的真機手感是 WebKit + iOS runtime 行為，jsdom / Chromium harness / 模擬器皆非權威（CLAUDE.md WebKit 軌警語）。可測層已涵蓋：CSS forcing function（min-height > 100vh + overflow-y visible + 觸控 media query）+ blockTouchDecision 鎖後恆 true spec。
- 責任人/目標日期：Jimmy 真機驗（TestFlight v0.7.245 上架後），OK 即清本條 + 移除 docs/instrument.html 與 GitHub Pages。
