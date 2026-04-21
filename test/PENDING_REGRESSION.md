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

## [2026-04-21] service-worker：快捷鍵 command handler 未補 spec

- 觸發情境：使用者按 `Ctrl/Command+Shift+R` 或到
  `chrome://extensions/shortcuts` 指派的快捷鍵
- 邏輯（已在 v0.4.0 進 service-worker.js）：
  `chrome.commands.onCommand` 收到 `toggle-reader-mode` → 取 active tab
  → 走 `self.__JReadPopup.toggleWithInjectionFallback`
- 核心函式 `toggleWithInjectionFallback` 已有完整 spec
  （`test/regression/popup-inject-retry.spec.js`，4 斷言）覆蓋
- 未補 spec 原因：service-worker.js 為 entry script，直接 require 會
  執行 `importScripts`（Node 無此全域）與 `chrome.commands.onCommand.
  addListener`。要測需要完整 stub chrome API 全套（commands / tabs /
  scripting / runtime / storage）與 importScripts polyfill，投入與
  wire-up 層級不符
- 責任人/目標日期：Jimmy，下次動到 background 結構（例如加更多 command
  或把 command handler 抽成可測試 core）時一併處理
