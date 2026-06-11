---
name: new-noise-rule
description: JRead cleaner 新增 / 調整雜訊隱藏規則的操作範本。Jimmy 回報「內文上下還有殘留 / 按鈕沒清 / 推薦列還在」這類 cleaner 漏網時用。濃縮 v0.7.3 整輪三站反覆驗收的硬教訓
---

# 新增雜訊規則範本（cleaner.js）

前置：先走 `/probe` skill 在真實站驗假設，再動 `jread/content/cleaner.js`。修法必須是結構性通則（硬規則 3）：描述 DOM / CSS 結構特徵，禁 hostname / 特定 class 特判；站點特判只能進 site-overrides。

## 規則選型順序（由快到慢見效）

1. **文字 heuristic 優先**（SPA 站 class 全是 emotion hash，class-based 完全失效）：
   - `NOISE_HEADING_TEXT_RE`：heading 慣用語（延伸閱讀 / 相關新聞 / 其他人也看 / 繼續看下去…）
   - `NOISE_LINK_TEXT_RE`：連結 / 按鈕 CTA 文字（查看原始文章 / 訂閱 / 追蹤 / 轉發…）
   - `NOISE_INLINE_AD_TEXT_RE`：內文插播（廣告（請繼續閱讀本文）…），括號用 `[（(]` 全半形都吃
   - 相對時間戳 regex：留言 / 社群面板辨識最穩的跨站特徵（「2 小時前」「hours ago」配額 >= 3 判 panel）
2. **遇到語意 class 才補 `NOISE_KEYWORD_RE`**：**動詞詞根 + 形容詞變體都要加**（`recommend`/`recommended`、`sponsor`/`sponsored`、`donate`/`donation`——只加一種會漏）；用 `/i` flag 讓 camelCase class 命中

## 結構陷阱 checklist（每條都是踩過的坑）

- [ ] **heading 掃描範圍含 `div, span`**：SPA 站 section header 不用 semantic tag；div/span 限 direct textNode 長度 <= 20（防誤殺主文段落），h2-h4 才用 `textContent`
- [ ] **`closest('section, aside')` 失靈時 fallback 到 articleEl direct child sub-branch**，但該 sub-branch 含 >= 100 chars 主文 p 就不 hide（「含主文長段落保護」guard，拿掉會誤殺）
- [ ] **`<button>` 不在 `CONTAINER_SEL` 內**——button 類 rule 要另掃 `articleEl.querySelectorAll('button')`
- [ ] **所有 interactive button 一律清（Jimmy 硬規則，無保留 heuristic）**：`<button>` / `[role="button"]` / `<input type=button|submit|reset>` 無條件 hide，不看 class / text、figure 內 zoom 按鈕也清；`<a>` 不在此列（連結是主文一部分），只清 NOISE_LINK_TEXT_RE 命中的 CTA
- [ ] **`hide()` 用 inline `!important`**（`el.style.setProperty('display','none','important')`）——stylesheet `!important` 會輸給原站高 specificity rule；restore 還原 `prevDisplayPriority`
- [ ] **delayed lazy-inject**（toggle 後 N 秒注入）靠 `checkDynamicNoise` 遞迴：addedNodes 內 `querySelectorAll` button 全 hide + `a, button` 逐一跑 `shouldHideByKeyword`（wrapper 無 keyword、內部才有的情境）
- [ ] 全形 / 半形、大小寫：中文注意全半形括號變體；SVG `tagName` 保留原 case，比較前 `.toUpperCase()`

## 驗收（必走，禁偽陰性）

1. fixture + spec：`test/regression/fixtures/` 最小重現 + spec，破壞修法驗 fail → 還原驗 pass
2. `npm test` 全過
3. `/harness-verify` skill：RESIDUAL AUDIT 出 `✅ 無殘留雜訊` + visible outline 無非主文，才算過；**Jimmy 看到 / harness 看不到 → 信 Jimmy 截圖**，修法靠邏輯完整性（MutationObserver subtree + 遞迴 check + inline `!important` 三者齊備）
4. `/release` skill 收尾
