# Code Review 修法批次追蹤（2026-06-09 起）

> 來源：2026-06-09 全碼 review（6 個平行 agent 分區 + 交叉驗證）。
> 此檔為**進度持久化**用，防對話中斷後遺失批次計畫。每完成一項把 `[ ]` 改 `[x]` 並註記版本/commit。
> 全部批次完成且 working tree clean 後可刪除本檔。

---

## Batch A — SW / popup / util 邏輯修正（不需 harness，純邏輯）✅ 完成 v0.8.15

- [x] **A1** onInstalled 包 try/catch + 只寫 diff patch（service-worker.js:89-）
- [x] **A2** SAVE_TO_READWISE 整個 async IIFE 包 try/catch（service-worker.js:226-）
- [x] **A3** domain-match suffix 比對只在 pattern 含點時啟用（matchHostname + removeMatching）
- [x] **A4** popup getActiveTabId 正規化 number|null + 4 處呼叫端改 typeof
- [x] spec：`sw-async-listener-guards.spec.js` 新增 + `auto-enable-domains.spec.js` 擴充 public-suffix；既有 defaults-sync / serif-font-stack spec 同步 merged→patch
- [x] `npm test` 1538 passing → bump 0.8.15 + 同步清單 6 項 → commit + local tag（**push 延後**，3 批一起 push 或待 Jimmy 確認）

## Batch B — 單一資料源整併（CLAUDE.md 工作流原則 5）

- [ ] **B1** `DEFAULT_SETTINGS` 三處（sw / popup / options）整併：popup、options 改讀共用 `settings-defaults.js`（需 `<script src>` 引入，非 content script）；popup 補缺漏的 `titleFontSize`
- [ ] **B2** `SERIF_STACK`/`SANS_STACK`/`LEGACY_*` font stacks 抽進共用層，SW + popup 不再各寫一份字面值
- [ ] **B3** 防-drift spec 補反向檢查（shared 欄位 ⊆ popup 該有的非 token 欄位），堵單向盲點
- [ ] `npm test` 全綠 → bump + 同步清單 → commit + tag + release

## Batch C — 需 harness 驗假設 + 重構（逐項先 probe 再動 code）

- [ ] **C1** `main.js:1126` SPA 導航偵測（history API hook + `<title>` observer），路由變化先 exitReaderMode 再視情況重觸發
- [ ] **C2** `detector.js:39-42` 抽「祖先鏈 hidden」共用 predicate，套到所有 textLen 計分（article-tag / schema-org / 候選容器），消除「隱藏容器吞主文」整類 bug
- [ ] **C3** `cleaner.js` 11 條 `restoreXxx` + sidecar 統一成單一 `__styleResets=[{el,prev}]`，restore() 一個 loop（消對稱性漏接風險）
- [ ] **C4** `cleaner.js:73,247` NOISE regex 改 token 陣列 build-time 組，strong set 從同一份子集衍生（消 drift）
- [ ] **C5** `cleaner.js` heading 雜訊處理靜態/動態雙實作抽共用 `resolveHeadingNoiseTarget`
- [ ] **C6** `styler.js:278-1089` base CSS 拆靜態片段常數（只算一次），只 theme-dependent 片段每次重組
- [ ] **C7** `paged-mode.js`/`space-scroll.js` editable-focus guard 抽共用 util（補 paged 漏的 BUTTON）
- [ ] **C8** `main.js:648,748` JSON-LD 共用單次 parse
- [ ] **C9（效能）** cleaner collapse rule phase1 純讀→phase2 純寫；checkDynamicNoise 動態 hide 補掛 inline-restyle observer
- [ ] **C10（效能）** paged savedScrollY 歸零 / onResize debounce / wheelAccum 反向歸零
- [ ] 每項：harness probe 驗假設 → 改 code → fixture+spec → `npm test` → harness 自驗 → bump + commit

---

## 已駁回（驗證後非 bug）

- ~~paged H4「pagedMode↔spaceScroll 互斥靠巧合」~~ → main.js:144 已 gate（`pagedMode.isInstalled()` 時強制 `spaceScroll.uninstall()`），互斥是設計保證。殘留真問題已收進 C7（BUTTON drift）
