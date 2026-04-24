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

## [2026-04-24] theverge styled-components p 鎖寬造成 p/img 4-10px 偏移

- 觸發頁面：https://www.theverge.com/report/914244/
- 症狀：theverge 主文 `<p>` 文字段左緣比同父層 img 左緣右 4-10px，視覺上段落看起來靠右。
- 已知結構（harness probe）：
  - p class `duet--article--dangerously-set-cms-markup _8enl99j _1xwtict1` 等 styled-components
    hash class 設 `width: 588px` 或 `width: 600px`（固定 px 值）
  - img/figure 寬 608px、article content 區邊界 336-944
  - p 寬 588-600 + margin 0、實際 left 340-346（比 img 多 4-10px offset）
- 已嘗試修法（v0.7.17、由 v0.7.18 revert）：styler universal rule 加
  `width: auto !important + max-width: 100% !important` → **造成 regression**：drop cap `D`
  float:left 與首段文字重疊、figure img 部分溢出 card 邊界。硬教訓 20：
  **typography-affecting universal rule 必須用 scoped selector**，universal 只適合 background
  這類不影響 layout 的屬性。
- 推測根因：styled-components 把固定寬度 baked 進 utility hash class，跨站不易通則命中；
  要修得乾淨需用 attribute selector（如 `[class*="duet--article"]`）或更精準的結構 anchor
  （例如只對 `article > p` / `article > div > p` 下 width reset）避開 drop cap 與 figure 內 img。
- 未補 spec 原因：現階段 theverge 4-10px 偏移屬「視覺微瑕疵」級別、修起來若通則不夠精準
  會打破 drop cap/figure 等 intentional 排版（已被 v0.7.17 打臉驗證）。在找到乾淨的
  scoped rule 之前不動，避免再次打破 baseline。
- 責任人/目標日期：Jimmy，下次動 theverge 類 styled-components 站排版時一併處理；
  修法前必須用 harness `jread-reader-fullpage.png` + Read 自驗整頁排版（不光看 residual audit）。

## [2026-04-22] detector textLen bonus 無 jsdom forcing function

- 觸發頁面：https://www.upmedia.mg/tw/international/headlines/256941
- 症狀：reader mode 把整頁 #wrapper 當主文，top bar / header / 右欄推薦
  全殘留。根因鏈三層（modal signal 污染 → heuristic 誤選 `.row` UI
  chrome → promote 升到 #wrapper）。
- 修法（已在 v0.7.2 進 detector.js）：
  (A) `isSignalExcluded` 用 ARIA dialog/tooltip/aria-modal/aria-hidden +
      inline/computed `display:none` 祖先鏈 skip signal
  (B) heuristic 加 `textLen/200 cap 10 * (1-ld)` bonus，讓長文字低
      連結密度主文贏過短文字 UI chrome
  (C) ~~`promoteForTitle` 加 MAX_HOPS 上限~~（v0.7.3 已 forcing function
      化，見 `linetoday-ogtitle-suffix.html` fixture——3 層 wrapper 分支
      結構驗 MAX_HOPS=3 必要性，revert 成 2 會讓 spec fail）
- 已補的 spec：
  - `detector.spec.js` 的 upmedia-intl-modal-signals 4 條 驗 (A)
  - `detector.spec.js` 的 linetoday-ogtitle-suffix 4 條 驗 (C) `PROMOTE_MAX_HOPS=3`
- 未補 spec 原因：
  (B) **textLen bonus**：若 (A) 擋住 modal signal，主文本身的 raw 已夠贏
      UI chrome，jsdom fixture 下無 bonus 也選對；要 forcing function 就
      得關 (A) 再驗 (B)，但 spec 一次只能測一個 path。harness 已在真實
      upmedia (stylesheet-only modal，A 的 ARIA 支路失效、靠 computed
      style) 實測 (B) 的貢獻
- 驗證方式：(B) 由 harness 對真實站實測；revert 會在 upmedia 國際版
  重現整頁被當主文 bug
- 責任人/目標日期：Jimmy，下次導入真 Chrome e2e（Playwright harness 的
  regression 版）時把 (B) defense forcing function 化

## [2026-04-21] service-worker importScripts 相對路徑解析錯誤

- 觸發情境：載入或重新載入 extension
- 症狀：Chrome 回報 `Service worker registration failed. Status code: 15`
  + `Uncaught NetworkError: Failed to execute 'importScripts' on
  'WorkerGlobalScope': The script at
  'chrome-extension://.../background/popup/popup-core.js' failed to load.`
  整個 extension 無法啟動
- 根因：MV3 service worker 的 `importScripts()` 相對路徑是相對
  service worker 自己的所在目錄（`background/`），不是 extension root
- 修法（已在 v0.4.1 進 service-worker.js）：改用絕對路徑
  `/popup/popup-core.js`
- 未補 spec 原因：importScripts 路徑解析只能在真實 MV3 service
  worker 環境觀察。Node 無 importScripts 全域；jsdom 不模擬 service
  worker context。要寫 automated test 需要 Chrome extension harness
  （例如 Puppeteer 啟動 Chrome 載入真 extension），投入與單一路徑
  bug 不符
- 責任人/目標日期：Jimmy，之後若導入 Puppeteer / Playwright
  e2e 一併納入

## [2026-04-21] service-worker：快速鍵 command handler 未補 spec

- 觸發情境：使用者按 `Ctrl/Command+Shift+R` 或到
  `chrome://extensions/shortcuts` 指派的快速鍵
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

## [2026-04-22] service-worker：icon swap（active ↔ idle）wire-up 未補 spec

- 觸發情境：使用者進入/離開閱讀模式；或導航到新 URL
- 邏輯（已在 v0.7.0 進 service-worker.js）：(a) `onMessage` 收到
  `SET_ACTIVE_ICON` → `chrome.action.setIcon({tabId, path: ACTIVE|IDLE})`；
  (b) `tabs.onUpdated` status=loading → 重置為 IDLE；(c) content main.js
  的 enterReaderMode / exitReaderMode 結尾發 `SET_ACTIVE_ICON` 訊息
- v0.7.3 修正：ICONS_ACTIVE / ICONS_IDLE path 必須用 `/` 開頭的絕對路徑
  （`'/assets/icons/...'`），不能用 relative `'assets/icons/...'`——SW
  relative path 是相對 SW 所在目錄（`/background/`）解析，reload extension
  時 `tabs.onUpdated` handler 對每個既有 tab 呼叫 setIcon 全部 fail
  （`Failed to fetch`）。與 v0.4.1 importScripts 相對路徑 bug 同類型
- 未補 spec 原因：純 wire-up——依賴 `chrome.action.setIcon` 與
  `chrome.tabs.onUpdated` 兩個 Chrome API、在真實 extension 環境才驗得
  到效果（Node / jsdom 無 action API）。三條 wire 的邏輯都是單行 `if /
  dispatch`，沒有可測的演算法分支
- 驗證方式：Jimmy 手動 reload extension，觀察工具列 icon 在
  進入/離開閱讀模式時切彩色 ↔ 灰、切換分頁時 icon 狀態跟著 tab 走、
  重新載入頁面時 icon 回到灰；開 `chrome://extensions/` 確認沒有
  `Failed to set icon ... : Failed to fetch` 錯誤
- 責任人/目標日期：Jimmy，下次導入 Puppeteer/Playwright e2e 時一併補
