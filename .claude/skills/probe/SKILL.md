---
name: probe
description: 修 JRead detector / cleaner / styler 這類跟真實網站 DOM 互動的 bug 之前的假設驗證流程（硬性順序）。動 extension code 前必走；跳過直接改 code 是已知會重工的錯誤順序
---

# Probe：先驗假設、再動 code（硬性順序）

jsdom fixture **不是**假設驗證工具——fixture 是自己寫的最小重現，會漏掉真實站 candidate 列表裡的元素（整站 wrapper、WordPress block wrappers、CMS 無 class div），用 fixture 驗「演算法會選到哪個元素」通常得到 false positive。2026-04-21 Stratechery 實證：fixture 看似夠用，真實頁面 `div.wp-site-blocks` 後代 p 太多贏過真主文，整套修法重寫。

## 順序（不可顛倒）

1. 在 `tools/` 寫一次性 probe 腳本（例：`tools/probe-<site>.js`），把**假設的評分 / 判斷邏輯**注入 `page.evaluate` 跑**真實站點 DOM**
2. 列 top-N 候選 + 各項分數 / 中間變數 → 肉眼驗證演算法選到正確元素
3. 假設確認後才改 detector / cleaner / styler（修法必須是結構性通則，硬規則 3——禁 hostname / class 特判）
4. 建 fixture + spec（forcing function）：暫時破壞修法→確認 fail→還原→確認 pass
5. `npm test` 全過
6. 照 `/harness-verify` skill 跑 harness 驗視覺結果
7. probe 腳本用完即刪，commit 只留 extension code + fixture + spec

## Instrument log 守則（probe 對不上實機時）

- Playwright probe 結果跟 Jimmy 實機矛盾 → **第二輪直接在 detector / cleaner code 內塞 console.log 揪真兇**，少猜一輪比少寫五行 log 重要
- log 印出反常數據（display:none 元素有非 0 rect 等）→ 先標記反常、查 element 行為，**不要腦補解釋通就修**
- 媒體撐空白找不到根因 → instrument 第一輪就印 `getComputedStyle(el, '::before')` / `'::after'`（pseudo-element 不在 querySelectorAll 裡，是 padding-bottom hack 常見載體）
- instrument 連兩輪沒進展 → 請 Jimmy 開 DevTools Elements panel（pseudo-element / shadow DOM / iframe 從 log 看不到），不要繼續加 log 賭
- **instrument log 等 Jimmy 實機驗證修好才刪**，不要 instrument→修→刪一輪做完
- 多層 fallback：新層 guard 不可共用前層的判定基礎；加完逐層 disable 做 sanity，確認每層獨立兜底

## 何時可跳過 probe

純 popup / options UI、純 styler CSS 數值微調（不涉及「選哪個元素」的判斷）、文件同步。只要涉及「演算法在真實 DOM 上會命中什麼」就不可跳。
