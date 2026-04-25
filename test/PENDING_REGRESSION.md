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
  - p 寬 588-600 + margin 0、實際 left 340-346(比 img 多 4-10px offset)
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

### 2026-04-25 v0.7.37 嘗試教訓（Jimmy 截圖回報「Many startups 段落寬度與上方不一致」後）

- 嘗試 A：`[data-jread-active="1"] p[class*="duet--article"] { width: auto; max-width: 100% }`
  → spec line 432 forcing 已禁 `[data-jread-active="1"] h[1-6]\b`，但對 p 沒禁；
    然而 p 自身 `width: auto` 受 parent wrapper 鎖寬約束、無效。
- 嘗試 B：reset `[class*="duet--layout--entry-body"]` / `[class*="duet--article--article-body"]`
  → 命中 entry-body wrapper、standard p 撐到 608px（內框寬）；但 lede 區（含 H1 +
    subtitle）的 wrapper 是純 hash class `_1p1nf4x0` / `_3zbl0r4` 鎖 588px，跨文章
    不穩定無法可靠 anchor。標準 p 變寬反而拉大左緣偏移：6px → 10-20px。
- 嘗試 C：放寬 anchor 為 `div[class*="duet--"]` / `section` / `article`
  → 仍未命中 lede 區的 hash-class wrapper、效果與嘗試 B 相同。
- 結論：lede 區 588px / 主文 600px 的不對齊**是 Vox design system 刻意設計的「inset
  lede」**，不是 bug；要對齊必須 anchor 到 `_1p1nf4x0` / `_3zbl0r4` 純 hash class
  （styled-components 跨文章重新生成）—— 沒有結構性通則 anchor。
- 不修的理由：修法後反而比 baseline 更糟（拉大偏移）。Jimmy 視覺 complaint 為真，
  但目前沒乾淨的結構性通則修法。等 Vox 改設計或找到 anchor 再動。
