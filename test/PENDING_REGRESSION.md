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

## [2026-06-08] 翻頁模式擋 iOS Safari 邊緣返回手勢——真機端到端待驗
- 觸發頁面：任意內容頁，翻頁模式第一頁，從左邊緣向右滑（iOS Safari 系統返回手勢）
- 症狀：Jimmy 回報第一頁左滑觸發 Safari「back」。修法已套（v0.7.237）：`paged-mode.js` `touchmove` 改 `passive:false`、對水平支配單指滑動 `preventDefault`。
- 推測根因：iOS Safari 的 `UIScreenEdgePanGestureRecognizer`（系統邊緣手勢）在翻頁容器 `overflow:hidden`（無原生捲動、無 overscroll）下直接導航；`preventDefault` 是業界標準擋法。
- 已驗：jsdom spec 證 onTouchMove 對水平滑動 preventDefault / 垂直放行 / 多指讓位、touchmove 註冊 passive:false；iPad simulator 實測翻頁手勢未被破壞（可正常翻頁）。
- 未補 spec 原因：**iOS Safari 系統邊緣手勢無法在 simulator 重現**——2026-06-08 iPad Pro 11" simulator 控制組實證：native 返回鍵可回上一頁（history 存在），但 `idb ui swipe` 從左邊緣注入的 HID 滑動**無法觸發** `UIScreenEdgePanGestureRecognizer`（閱讀與非閱讀模式都不返回）。因此「preventDefault 是否真的擋住 Safari 返回」只能真機觀察。
- 責任人/目標日期：Jimmy 真機（iPhone / iPad Safari）一次翻頁模式第一頁邊緣滑動即可確認；確認後本條清除。
