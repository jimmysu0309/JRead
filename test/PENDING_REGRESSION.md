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

## [2026-06-09] C1 SPA 導航偵測 live 行為真機驗證
- 觸發頁面：任一 SPA 站（Next.js / React Router 等，例如 Medium 文章間切換、Substack、X）
- 症狀：v0.8.21 新增 SPA 路由偵測（popstate + `<title>` MutationObserver + href 輪詢 → exitReaderMode → 視情況 silent 重進）。wiring 已有 structural forcing spec（`spa-navigation-watch.spec.js`）+ harness 確認不影響正常頁面載入 / reader mode，但「真實 SPA 換路由時是否正確退出舊卡片 + 重觸發」**harness 模擬不到**（debug-harness 載靜態頁、沒有真 SPA 路由切換）。
- 推測根因：N/A（新功能驗證，非 bug）
- 未補 spec 原因：content script isolated world 的 SPA 路由切換時序 + reader card 跨路由重綁，只能在真實 Chrome SPA 站觀察；jsdom 無法 require main.js（IIFE + chrome.runtime 依賴），且無法擬真 SPA 框架的路由 + DOM 替換。
- 責任人/目標日期：Jimmy 下次在 SPA 站（建議 Medium 文章間點下一篇）reload extension 後手動 spot-check：① reader mode 下換文章舊卡片消失、② auto-enable 網域換路由後自動重進、③ 一般站正常頁面無誤觸發。確認後刪除本條。
