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

## [2026-06-08] v0.7.240/241 收合後鎖死垂直卷動，真機是否「立刻」維持收合不重展開
- 觸發頁面：任意翻頁模式（pagedMode）文章，iOS Safari（TestFlight v0.7.241）
- 症狀：(待驗) 第一頁垂直滑收合 iOS 工具列後，程式應**立刻**鎖死垂直卷動（vLocked → onTouchMove 擋全部 + 卡片 touch-action:none、scrollY 凍結）。v0.7.240 Jimmy 實測「收合後沒鎖、要滑到第二頁再回第一頁才鎖」——v0.7.241 已修（補 scroll / visualViewport.resize / touchend 延遲重驗 trigger）。需真機確認：(1) 第一頁收合後是否「立刻」鎖死、垂直滑不再能把工具列重新展開；(2) 左右翻頁確實變靈敏。
- 推測根因：N/A（功能驗收，非 bug）。收合偵測決策邏輯已有 jsdom spec（blockTouchDecision / classifyViewportChange）+ scroll listener 註冊 forcing function，sanity break 驗過。
- 未補 spec 原因：iOS Safari 工具列（chrome）收合 / 展開 + window resize / visualViewport / scroll 對工具列變化的觸發時機是 WebKit + iOS runtime 行為，jsdom 無 layout、Chromium harness 不跑此 media query、模擬器對 Safari chrome 行為亦非權威（CLAUDE.md WebKit 軌警語）。只能真機 TestFlight 驗。同 v0.7.239「邊緣返回手勢」前例。
- 責任人/目標日期：Jimmy 真機驗（TestFlight v0.7.241 上架後），驗過即清本條。
