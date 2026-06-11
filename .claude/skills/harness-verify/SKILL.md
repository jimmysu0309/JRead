---
name: harness-verify
description: JRead Playwright harness 驗收決策樹。改 detector / cleaner / styler / theme / paged / background SW 後，依改動類型選對 flag 與 audit、避免偽陰性驗收。Jimmy 回報視覺 bug 要重現時也用這份選 flag
---

# Harness 驗收決策樹

工具：`node tools/debug-harness.js`（單站深驗，= `npm run debug`）、`node tools/page-rounds-harness.js`（單站 5 組分頁截圖 + audit.json）、`tools/batch-page-rounds.sh`（批次站台清單）。audit 邏輯單一資料源在 `tools/audit-lib.js`，改 audit 規則只動 lib（forcing function：`test/regression/harness-audit-lib.spec.js`）。

## 第一步：依改動類型選 flag

| 改了什麼 | 必跑 | 驗收必看 |
|---|---|---|
| cleaner / detector rule | `npm run debug --url <站>` | RESIDUAL AUDIT（兩次：1.2s + 5s delayed）+ visible outline |
| styler / theme / 顏色 | 上述 + `--scheme dark` | CONTRAST AUDIT（< 3:1 ⚠️）；「東西在、看不見」只有這段抓得到 |
| 翻頁模式 | `--paged` | PAGED AUDIT：column 算出值 / 頁數（`computePageCountFromExtent` 實測，不信 scrollWidth）/ stride；`padding-right ≠ 0` warning |
| background SW | **必加 `--fresh`** | Chromium 把 SW 快取在 persistent profile，「content 新 / SW 舊」會誤導 debug（v0.7.230 燒 4 輪實證）。懷疑 SW 行為跟 code 對不上→直接 `--fresh` |
| 排版 / 寬度 / 位移 | `--width 390` 驗手機版心 | zoom 0.5 縮圖有對齊錯覺——必加 probe rect 數值或 zoom 1.0 截圖二次確認 |
| 「只在 Safari」的雜訊回報 | `--translate-first` | 先翻譯→再 toggle（Jimmy 實機順序），主 audit 跑在翻譯後 DOM。能重現 = translation-path bug，可在 Chromium 修。普通 `--shinkansen` 是 toggle→翻譯，抓不到此類 |

其他 flag：`--keep`（跑完不關，肉眼驗）、`--url <URL>` 或 `JREAD_URL` 環境變數。

## 第二步：讀結果

1. 讀 stdout 的各段 AUDIT（RESIDUAL / GAP / CONTRAST / OVERFLOW / PAGED）
2. 用 Read tool 看 `.playwright-mcp/jread-viewport.png` + `jread-reader-fullpage.png`（截圖已內建 zoom 0.5，一張吃整頁）
3. **改 styler / 視覺 code 時必須 Read fullpage 截圖肉眼巡**——residual audit 只覆蓋 cleaner 層，不保證排版正確（drop cap / figure / 對齊）

## 偽陰性禁令（驗收紅線）

- **禁止用 grep keyword 判定「清乾淨」**——grep 沒命中 ≠ 不在。驗收基準是 RESIDUAL AUDIT 印 `✅ 無殘留雜訊` 且 visible outline 無非主文內容
- **harness silence ≠ Jimmy 看不到**：SPA lazy-inject 在 Playwright 可能根本沒 load（bot detection / CSP / 時序）。遇到「Jimmy 看到 / 我看不到」→ **相信 Jimmy 的截圖**，修法靠邏輯完整性（MutationObserver subtree + 遞迴 check + inline `!important` 三者齊備），不靠 harness 無 warning
- **translate-first 的 audit 誤報**：翻譯後內文含「透過 / 更多 / 追蹤」等常用詞會被 keyword 子字串命中——ancestors 在 `body.markup` / `available-content`（主文）即誤報
- **Chromium 綠 ≠ WebKit 綠**：本 harness 只驗 Chrome 軌（v0.7.230 `column-count: 1` Chrome 全綠、Safari 全滅）。WebKit 軌驗證見 `docs/CHROME_EXTENSION_DEBUG.md`「WebKit（Safari）軌的驗證」；Playwright WebKit 是 trunk build，不可直接當正式版 Safari 綠
- **page-rounds 的 dark 截圖**必經 `setThemeAndVerify` 驗 card bg 真的變色（SW gate 後 dispatch 不保證生效）

## Harness 模擬不到、需 Jimmy 實機驗的（僅此三類）

keyboard shortcut 對映與衝突、popup 點擊互動、使用體感（字體渲染 / 對比 / 動畫）。其餘（styler 排版、cleaner 規則、detector 命中、storage listener、SW 協定）harness 都驗得到，不煩 Jimmy。cage 操作一律走 `__jread_debug` event bridge（不用快速鍵、不用 chrome://extensions/）。

完整坑表見 `docs/CHROME_EXTENSION_DEBUG.md`。
