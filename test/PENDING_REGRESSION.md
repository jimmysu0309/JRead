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

## [2026-06-08] v0.7.240 收合後鎖死垂直卷動，真機是否維持收合不重展開
- 觸發頁面：任意翻頁模式（pagedMode）文章，iOS Safari（TestFlight v0.7.240）
- 症狀：(待驗) 第一頁垂直滑收合 iOS 工具列後，程式鎖死垂直卷動（vLocked → onTouchMove 擋全部 + 卡片 touch-action:none、scrollY 凍結在收合位置）。預期工具列維持收合、左右滑乾淨；需確認 iOS 不會因 scroll 被鎖而把工具列重新展開、且左右翻頁確實變靈敏。
- 推測根因：N/A（功能驗收，非 bug）。決策邏輯已有 jsdom spec（blockTouchDecision / classifyViewportChange，sanity break 驗過）。
- 未補 spec 原因：iOS Safari 工具列（chrome）收合 / 展開是 WebKit + iOS runtime 行為，jsdom 無 layout、Chromium harness 不跑此 media query、模擬器對 Safari chrome 行為亦非權威（CLAUDE.md WebKit 軌警語）。只能真機 TestFlight 驗。同 v0.7.239「邊緣返回手勢」前例。
- 責任人/目標日期：Jimmy 真機驗（TestFlight v0.7.240 上架後），驗過即清本條。
