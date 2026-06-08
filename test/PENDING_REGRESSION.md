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

## [2026-06-08] v0.7.240→243 收合後鎖死垂直卷動，真機是否「立刻」鎖死不重展開
- 觸發頁面：任意翻頁模式（pagedMode）文章，iOS Safari（TestFlight v0.7.243）
- 症狀：(待驗) 第一頁垂直滑收合 iOS 工具列後，程式應**立刻**鎖死垂直卷動（vLocked → onTouchMove 擋全部 + 卡片 touch-action:none、scrollY 凍結）。逐版修法：v0.7.240 初版（Jimmy「收合後沒鎖、要滑到第二頁回來才鎖」）→ v0.7.241 補 scroll/visualViewport.resize/touchend 延遲重驗 trigger（Jimmy「會鎖、但要等 scroll bar 消失 ~5s」）→ v0.7.242 改讀 visualViewport.height（Jimmy「仍要等 scroll bar 消失 ~5s」→ **證實 visualViewport.height 在 iOS 也延遲更新**）→ v0.7.243 **棄用 viewport 高度、改用 scrollY 即時上鎖**（scrollY > 100px 即視為已做收合滑動，scrollY 不延遲）。需真機確認：(1) 第一頁收合後是否「立刻」鎖死、垂直滑不再能把工具列重新展開；(2) 左右翻頁確實變靈敏；(3) scrollY 門檻 100px 是否在工具列「確實已收合」之後才鎖（理論上 iOS 捲 50px 內就收合提交，100px 安全；若真機看到「鎖了但工具列還在」代表門檻要再調或 iOS 該裝置收合提交點更高）。
- 推測根因：N/A（功能驗收，非 bug）。決策邏輯已有 jsdom spec（shouldLockByScroll / blockTouchDecision / classifyViewportChange / viewportH）+ scroll listener 註冊 forcing function，sanity break 驗過。
- 未補 spec 原因：iOS Safari 工具列收合提交點對應的 scrollY 門檻、以及 viewport 高度更新時機，都是 WebKit + iOS runtime 行為，jsdom 無 layout、Chromium harness 不跑此 media query、模擬器對 Safari chrome 行為亦非權威（CLAUDE.md WebKit 軌警語）。只能真機 TestFlight 驗。若 v0.7.243 仍不對，下一步上 iOS 模擬器 instrument（紅框 div 印 scrollY / innerHeight / visualViewport.height 逐毫秒時序）。
- 責任人/目標日期：Jimmy 真機驗（TestFlight v0.7.243 上架後），驗過即清本條。
