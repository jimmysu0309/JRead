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

## [2026-06-11] tvbs 卡片右側促銷浮窗（含 X 鈕）未清
- 觸發頁面：https://news.tvbs.com.tw/life/3213619
- 症狀：reader 卡片右側外緣浮著「建築奇蹟全解析」促銷浮窗（含 X 關閉鈕），light-page-01 右側 y≈160-250（2026-06-11 page rounds 第四輪抽查）
- 推測根因：position:fixed 促銷浮動元素漏清（疑 campaign 腳本 delayed 注入）
- 未補 spec 原因：promo campaign 已下檔——Playwright 與 cage 實測（2026-06-11）皆無任何 visible fixed/absolute 浮動元素，無法取得 DOM context 做最小重現
- 責任人/目標日期：Jimmy 下次實機遇到同類浮窗時，用 DevTools 抄 DOM 結構（tag / class / position / z-index）回報，再補通則規則與 fixture
