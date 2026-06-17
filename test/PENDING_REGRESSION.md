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

<!-- 2026-06-17 Page Rounds FAIL/triage 清單已全數結案：
  - overflow（rust-book / kubernetes / arxiv / python-docs / requests）：
    code/math span 被 scroll 祖先內捲＝近誤報 → v0.8.101 audit scroll-clip 豁免
    （tools/audit-lib.js）解決；arxiv 寬公式被 card overflow:hidden 切掉＝真破版
    → v0.8.101 styler wide-content scroll 修法（table/pre 溢出 display:block+
    overflow-x:auto）解決。regression：audit-overflow-scroll-clip.spec.js +
    styler-wide-content-scroll.spec.js。
  - contrast fa/th/el wiki（2.93–2.98 navbox 邊界近誤報）/ gitbook body-width
    （73% 邊界、視覺無破版）/ distill figcaption（站特殊 margin-figure niche）：
    triage 結論記入 docs/excluded/page-rounds-sites.md 各站備註，Jimmy 2026-06-17
    決定不修。 -->

