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

## [2026-04-21] popup：對既有分頁 toggle 失效

- 觸發頁面：任一網頁（extension 安裝/升級前就已打開的分頁）
- 症狀：按 popup 的「切換閱讀模式」時 `chrome.tabs.sendMessage` 拋
  `Could not establish connection. Receiving end does not exist.`
  導致 popup 顯示「此頁面無法啟動閱讀模式」；實際上頁面本身支援，
  只是 content script 尚未被注入
- 根因：Manifest V3 的 `content_scripts` 只自動注入「新載入的分頁」，
  extension 安裝/重新載入前就開著的分頁不會自動注入
- 修法（已在 v0.2.1 進 popup.js）：catch sendMessage 錯誤 → 用
  `chrome.scripting.executeScript` 主動注入 → 重試一次；仍失敗才報錯
- 未補 spec 原因：popup.js 目前是直接執行的 entry script，測試需要
  全套 chrome API mock（runtime / tabs / scripting）+ jsdom 處理 DOM，
  單為此 bug 寫成本過高。待 popup 重構出 `popup-core.js`（純函式層）
  或 chrome API 統一 facade 後，補一條 spec 驗證「sendMessage throw 時
  會觸發 executeScript 並重試」
- 責任人/目標日期：Jimmy，下次動到 popup.js 結構時一併處理
