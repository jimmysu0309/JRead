# Changelog

本檔記錄 JRead 每次版本變更。格式參考 [Keep a Changelog](https://keepachangelog.com/)。

---

## Baseline 宣告（v0.6.3 — 2026-04-21 起）

**當前 baseline：v0.6.3**。此版本在 Stratechery / ChinaTalk / anthropic 三站實測通過，Jimmy 明確確認「非常理想」。往後 edge case 維修以這個視覺成果為不可退讓底線：
- **字型 / heading margin / p margin / list style / link color / blockquote border 全部保留原站樣式**（v0.6.0 瘦身後不再覆寫）
- **標題正確顯示**（v0.5.1 + v0.6.3 title promote；涵蓋 WordPress / anthropic 類「h1 在祖兄 section」結構）
- **作者 / 日期保留**（v0.6.1 + v0.6.2 action-row 加 heading / interactive-ratio 排除）

### 修 edge case 時的硬規則

1. **優先順序**：detector → cleaner → styler（最後手段）
2. **styler.js 視為動不得**——要動需 Jimmy 明確授權；禁止恢復 v0.5.x 對 h1-h6 / p / ul / ol / li / blockquote / a 下 rule 的做法
3. 每次修法後 harness 迴歸三站（Stratechery / ChinaTalk / anthropic）確認無 regress
4. 結構性通則、非站點特判（CLAUDE.md 硬規則 3）

v0.5.x 的 styler 堆 ~80 條 !important rule 的做法在 v0.6.0 已被證實有視覺副作用（標題變藍底線、category 間距過大、條列項樣式跑掉），**不要再走回頭路**。

以下是版本歷程（倒序）。

---

**v0.7.14**——udn `narrowPromotedSiblings` 漏 h1-self guard 修法（Jimmy 2026-04-24 回報 udn.com/news/story/124844/9460037 標題消失）。

**根因**（harness probe）：
- detector strategy = `article-tag`（udn 有 `<article class="article-content">`）
- promoteForTitle 升到 `<section class="article-content__wrapper">`（h1 的 parent）
- promotedFrom = `article.article-content`、articleEl = section
- h1 是 articleEl 的 direct child（跟 promotedFrom article 是兄弟）
- v0.7.12 `narrowPromotedSiblings` hop 0（parent === articleEl）掃 children：
  - `sib === cur` (promotedFrom article) → 保留 ✓
  - `sib.contains(promotedFrom)`? no
  - `sib.querySelector('h1')`? **H1.querySelector('h1') 回 null**（querySelector 只找後代、不含 sib 自己）
  - 其他 guard 都不命中 → **h1 被 hide**

**修法一行**：guard 前加 `if (sib.tagName === 'H1') continue;` 處理「sibling 自己就是 h1」case。

**通則**：h1 是主文標題的明確語意 element、即使作為 sibling 也應該保留（與 h1 wrapper 保留同精神）。

**驗收**：
- Fixture `udn-h1-direct-child-narrow-guard.html` 精確重現 udn DOM：
  ```
  section.article-content__wrapper
    h1.article-content__title            ← direct child、sibling
    div.article-content__meta            ← meta bar、narrow 會 hide
    article.article-content (promotedFrom)
      p 主文...
    aside.related-articles              ← sibling chrome、narrow 會 hide
  ```
- 4 條 spec：detector 命中 + promote 升級 + h1 保留 + non-h1 sibling（related-articles aside）仍 hide
- sanity check：註釋 `sib.tagName === 'H1'` guard → 1 條 h1 assertion fail
- harness 五站全驗（ebc / line today / udn / chinatimes / esmchina）`✅ 無殘留雜訊`
- `npm test` 186 passing

**硬教訓追加第 20 條（留給後續對話）**：
> **`querySelector(sel)` 不含 element 自己、只找後代**。寫 guard「sibling 含 X」時、若 sibling 自己就是 X，`querySelector(X)` 回 null、guard 漏 case。正確 pattern：`sib.tagName === 'X'.toUpperCase() || sib.querySelector(X)` 兩個都要檢查。此 pattern 跟 v0.7.8 `hideInsideArticleByKeyword` h1 wrapper guard 相似但有差異——那條 guard 的 wrapper 是 div，一定不會 tagName === H1、所以只靠 querySelector 可（sibling case 會是 h1 本身）。未來寫類似 guard 時要先問：「sibling / wrapper 自己有沒有可能就是目標 tag？」

**另一個觀察**：Jimmy 的回饋「你自己看不到嗎」——提醒我 harness 能直接 probe 的站（Playwright 不被擋的）不該讓使用者每次 DevTools 貼 Console 指令。本輪改用 probe script 自動跑，省了一輪手動往返。未來 bug 回報優先 harness probe、Playwright 被擋才 fallback DevTools。

---

**v0.7.13**——esmchina 5 層深 single-child wrapper 支援 + partner keyword（Jimmy 2026-04-24 回報 esmchina.com/news/14116.html 標題消失）。

**根因**（Console probe）：
- og:title 空 → detector getCanonicalTitle fallback 到 document.title
- document.title = `遺憾！三安光電 2.39 億美元並購遇挫–國際電子商情`（含 en dash `–` 但前後無空格，split regex `/\s+[–—|]\s+/` 不切、target 含整個尾綴）
- titleMatches 仍能過（h1 被 target 包含、ratio 95% > 60%）
- **主文 DOM 5 層深**（container > col-md-9 > unnamed > article-cnt > article-words > article_text）、detector heuristic 選到 article_text
- `PROMOTE_MAX_HOPS=4`（v0.7.12）只爬到 col-md-9、無法到共同祖先 container、h1 漏 scope

**修法**：
1. detector.js `PROMOTE_MAX_HOPS` 4 → 5
2. cleaner.js `NOISE_KEYWORD_RE` 加 `partner` 詞（esmchina `.partner-content-article` / `.partner-title` sidebar 殘留「更多>」CTA）

**為何直接放寬 hops 安全**：v0.7.12 硬教訓 19 已預測「放寬 hops 要配 narrow 機制兜底」，`narrowPromotedSiblings` 會清 sibling chrome、scope 擴大不產生殘留。5 站驗證無 regression。

**驗收**：
- Fixture `esmchina-promote-5-hops.html` 模擬 5 層深 DOM + partner-content sibling
- 5 條新 spec：promote 升 .container、h1 保留、partner sidebar hide、主文保留、字面 regex forcing `partner`
- 既有 ebc fixture 字面 forcing 從 `PROMOTE_MAX_HOPS = 4` 改成 `>= 4`（不鎖死具體值、讓未來再放寬不用改既有 spec）
- sanity check 退回 PROMOTE_MAX_HOPS=4 → 2 條 esmchina spec fail
- harness 五站（ebc / line today / udn / chinatimes / upmedia / **esmchina** 新增）全驗：
  - ebc / line today / chinatimes / esmchina `✅ 無殘留雜訊`
  - udn「更多」A tag 殘留（既有已知 VIP link 問題）
  - upmedia 2 項 audit false positive（既有）
- `npm test` 182 passing

**硬教訓 19 本輪驗證**：v0.7.12 預測「單純放寬 PROMOTE_MAX_HOPS=5 通常仍 OK（narrow 機制會自動兜底）」—— esmchina 實證成立。未來再遇需更多 hops 的站，可繼續沿用此 pattern。

---

**v0.7.12**——ebc 深層 single-child wrapper + 橫向 sibling chrome 修法（v0.7.8 記入 PENDING_REGRESSION 的 h1 missing 問題本輪完整修法）。

**根因回顧**（v0.7.8 已 probe 確認）：
- ebc news.ebc.net.tw /news/society/548318 DOM 結構：
  ```
  #main_content
    article_header (含 h1)
    article_container
      article_cover
      article_main_box
        share_box
        article_main
          article_relevant (相關新聞列表)
          article_content (← detector heuristic 命中 POSITIVE `content`)
  ```
- detector 選到 `article_content`，h1 在兄弟 `article_header` 內
- 共同祖先是 `#main_content`、從 article_content 上走需要 4 hops
- v0.7.3 `PROMOTE_MAX_HOPS=3` 不夠 → h1 漏 scope（使用者截圖看不到標題）
- v0.7.8 嘗試放寬 3→4 後回滾——scope 升到 #main_content 把其他 sibling chrome（相關新聞 / share_box / article_cover）全部納入 → 殘留 regression
- 結論：需 **promote+narrow 聯動**機制

**本輪完整修法三處聯動**：

**(1) detector.js**：
- `PROMOTE_MAX_HOPS` 3 → 4
- `detect()` 記錄 `result.promotedFrom`：
  ```js
  const originalEl = result.el;
  result.el = promoteForTitle(result.el, hopLimit);
  if (result.el !== originalEl) {
    result.promotedFrom = originalEl;
  }
  ```

**(2) cleaner.js** 新 rule `narrowPromotedSiblings(articleEl, promotedFrom, hidden)`：
```js
let cur = promotedFrom;
for (let hops = 0; hops < 10 && cur && cur !== articleEl; hops++) {
  const parent = cur.parentElement;
  for (const sib of parent.children) {
    if (sib === cur) continue;
    if (sib.contains(promotedFrom)) continue;  // content 分支
    if (sib.querySelector('h1')) continue;     // h1 分支
    // ... isInPreserved / jreadHidden guards
    hide(sib, hidden);
  }
  if (parent === articleEl) break;
  cur = parent;
}
```
與既有 `hideAncestorSiblings` 方向相反——那條從 articleEl 往 body 走、此條從 promotedFrom 往 articleEl 走，作用層不重疊互補。

**(3) cleaner.clean()** 簽章擴充 `(articleEl, opts)`、opts.promotedFrom 觸發 narrow。main.js 把 detect() 的 `promotedFrom` 傳進 `cleaner.clean()`。

**順手修**：`NOISE_KEYWORD_RE` 加 `controls` 詞——ebc `article_controls` 內「聽新聞」UI 殘留；`controls` 是 UI 控制列的語意詞、主文不會用。

**驗收**：
- Fixture `ebc-promote-narrow-sibling-chrome.html` 模擬 ebc 實際 DOM（4 層深 content 路徑 + 3 層橫向 sibling chrome + h1 在 hop 4 兄弟）
- 7 條 spec：
  - promote 升到 `#main_content` + `result.promotedFrom` 紀錄
  - h1 保留（祖先鏈無 hidden）
  - article_relevant / share_box / article_cover（hop 1/2/3 sibling）被 narrow hide
  - 主文 EBC_CONTENT_MARK 段落保留
  - 字面 regex forcing `PROMOTE_MAX_HOPS = 4`
- Sanity check：註釋 `narrowPromotedSiblings` 呼叫 → 2 條 sibling hide assertion fail
- Harness 四站全過：
  - ebc ✅ articlePreview 含 h1 標題 + `✅ 無殘留雜訊`
  - line today / chinatimes / udn ✅ 無殘留
  - upmedia audit false positive（「關注」在主文內容、「延伸閱讀」括號引述）與本輪無關
- `npm test` 177 passing
- 從 `test/PENDING_REGRESSION.md` 移除 ebc h1 條目

**硬教訓追加第 19 條（留給後續對話）**：
> **promote 放寬 hops 上限時、必須**同時**配備 narrow 機制清 sibling chrome。** v0.7.3 `PROMOTE_MAX_HOPS` 2→3 + v0.7.12 3→4 是 **hop 數放寬的演進**，每次都伴隨新場景：line today 需要 3 hops、ebc 需要 4 hops。但放寬 hops 意味 scope 擴大——upper bound 跟「單 child wrapper 深度」相關、只會越來越深（未來可能出現需要 5 hops 的站）。**正確架構不是無限放寬 hops、是放寬 hops + 收緊 scope 雙管齊下**：promote 到 common ancestor（允許最大範圍）+ narrow 沿 content 路徑清 sibling chrome（精準 scope）。v0.7.12 的 promotedFrom + narrowPromotedSiblings 就是這個架構。未來若再遇需要 5 hops 的站、單純放寬 PROMOTE_MAX_HOPS=5 通常仍 OK（narrow 機制會自動兜底）。

**Fixture 設計硬教訓**：h1 text 前不能加 MARK prefix——fixture 第一版 h1 text = `"EBC_H1_MARK 台鐵新左營站男廁小便斗驚見針孔！嫌犯竟是高鐵男員工"`，titleMatches 比 og:title 首段分割結果（~12 chars），比值 35% < 60% 門檻、match 失敗、promote 沒升級。修正：h1 用 `id="ebc-h1"` 當驗證標記、text 保持乾淨。**驗 title-based 功能的 fixture 永遠不該在 h1 text 加 forcing prefix**。

---

**v0.7.11**——Medium click-to-zoom button wrapper 保留主文圖片（Jimmy 2026-04-24 回報 Medium 文章圖片不見）。

**根因**（Console probe 揭露）：Medium 把主文 `<picture>/<img>` 嵌在 `<div role="button" tabindex="0">` wrapper 裡讓使用者點擊查看大圖：
```html
<figure class="paragraph-image">
  <div role="button" tabindex="0" class="oi oj ek">
    <span>Press enter or click to view image in full size</span>
    <div>
      <picture>
        <source srcset="..."/>
        <img src="..." width="700" height="472"/>
      </picture>
    </div>
  </div>
</figure>
```
v0.7.3 `hideInsideArticleAllButtons`「所有 button / [role="button"] 無條件清」rule 把這個 wrapper 當純 CTA 給 hide（`display: none !important`）、連帶內部 picture/img 都不可見、`rectW/H = 0×0`。

**修法**：`hideInsideArticleAllButtons` 加 media guard：
```js
if (btn.querySelector && btn.querySelector('img, picture, video')) continue;
```

**通則依據**：button 內含 img/picture/video = 主文載體（不是純 CTA）、保留 wrapper 才能保留主文內容。修法精神與 v0.7.8 的 h1 wrapper guard 一致：button 內含「主文載體」時保留 wrapper、純 CTA 照清。

**精準度設計**：svg 不在 guard 範圍——svg 多為 icon（share / like / comment 常用 svg 圖示），作者 avatar 用 img、有可能誤保留含 avatar 的 button，但主文中這類 case 罕見、trade-off 正向（保主文圖 >> 讓少數 avatar button 殘留）。

**驗收**：
- Fixture `medium-click-to-zoom-button.html` 三條 forcing：
  - `#zoom-btn`（`role="button"` 含 picture）→ 保留
  - `#share-btn`（純 CTA `"Share this article"`）→ hide
  - `#icon-btn`（`role="button"` 含 svg icon）→ hide
- 主文 img 祖先鏈全無 `data-jread-hidden="1"`
- sanity check：註釋 `btn.querySelector` guard → 2 條 assertion fail（zoom-btn 被 hide、img 祖先 hidden）
- `npm test` 170 passing

**硬教訓追加第 18 條（留給後續對話）**：
> **「無條件清」類 rule 遇到「多角色 wrapper」時必然需要 guard。** v0.7.3 `hideInsideArticleAllButtons` 設計時的假設是「button = 純 CTA（分享 / 訂閱 / 追蹤）」，但現代 CMS（Medium / BBC / Vox 等 React 站）常把 `role="button"` 當 **互動式容器**（click-to-zoom / click-to-expand），內含主文 picture / video / heading 等**主文載體**。這類 wrapper 有雙重角色——**互動 + 主文容器**。無條件 hide 會連主文一起消失。guard pattern：`if (el.querySelector(<主文載體 selector>)) continue`。v0.7.8 h1 wrapper guard + v0.7.11 media guard 都是此 pattern 的實例。未來若有新「無條件清 X tag」rule，先問：「X 有沒有可能是多角色 wrapper？內部是否可能含主文載體？」

---

**v0.7.10**——BBC pathological 固定 px grid container 強制 block reset（Jimmy 2026-04-24 v0.7.9 後回報 BBC 主文仍鎖窄欄寬度）。

**根因**：v0.7.9 清掉廣告 wrapper 後，Console probe 揭露 articleEl 內部多層 grid container：
```
p (386px)
  DIV (display: grid, grid-template-columns: 386px) ← 瓶頸
    DIV (block 386px)
      DIV (display: grid, 12 columns)
        DIV (display: grid, ...)
          ARTICLE (block 817px)
```
單欄固定 386px 的 grid container 鎖死主文 p 寬度。既有 cleaner 兩條 rule 都漏網：
- `data-jread-ancestor` CSS reset 只處理 articleEl **外部**祖先
- `collapseGridWithHiddenCell` 只在有 hidden child 時觸發

**修法**：cleaner 新 `collapseInnerGridFlex(articleEl, hidden)` 函式
- 掃 articleEl 內所有 element
- 條件：`display: grid|inline-grid` + `grid-template-columns` 含 `\d+px`
- 操作：強制 `display: block !important` + `grid-template-columns: none !important` + `grid-template-rows: none !important`
- `restoreInnerGridFlex(hidden)` 逆向還原 inline display / grid-template

**精準度設計**：
- `/\d+px/` 只 collapse **hard-coded 固定寬度**（BBC 的 `386px` 是 styled-components JS 計算後的固定值，reader mode 下明顯過窄）
- `1fr 1fr` / `auto` / `minmax(0, 1fr)` 等彈性單位**保留**——這類是 intentional 多欄設計（主文內雙欄引述 / 圖片並列）
- **不動 flex container**——Bootstrap row/col 類 layout 由 `collapseGridWithHiddenCell` 在 hidden child 場景處理，避免誤殺主文中的 flex 排版
- `isInPreserved` 跳過 figure/figcaption/summary/blockquote 內部（figure image gallery 的 grid layout 保留）

**通則依據**：reader mode 精神是「內文撐滿 card」。hard-coded px 固定寬 grid（特別是 styled-components JS 動態算出的）違反此精神——強制 block 化是 reader mode 通則、非站點特判。

**驗收**：
- Fixture `bbc-inner-grid-fixed-column.html`：
  - `#pathological-grid`（`grid-template-columns: 386px` 固定 px）→ 驗被 reset
  - `#intentional-grid`（`1fr 1fr` 彈性）→ 驗保留原 grid
  - 5 個 MARK 段落（INTRO / TRAPPED / OUTRO / INTENTIONAL_LEFT / INTENTIONAL_RIGHT）驗主文保留
- 獨立 round-trip spec：clean → restore 後 pathological grid 回到原 `display:grid` + `386px`
- sanity check：註釋 `collapseInnerGridFlex` 呼叫 → 2 條 assertion fail（pathological 保持 grid、grid-template-columns 未清）
- `npm test` 165 passing

---

**v0.7.9**——BBC React styled-components 廣告 wrapper 清除（Jimmy 2026-04-24 實測 bbc.com/news/articles/clyepyy82kxo 右側 540×1100 灰色占位，DevTools 抓 DOM 確認結構）。

**根因結構**：
```html
<div data-testid="ad-unit" data-component="ad-slot" class="sc-66bf5539-0 euXOeE">
  <div class="dotcom-ad" style="background-color: #f8f8f8">
    <div class="dotcom-ad-inner" data-jread-hidden="1"
         style="display: none !important;">...</div>
  </div>
</div>
```
- 內層 `.dotcom-ad-inner` 已被 AD_BOUNDARY_RE hide（`-ad-` 邊界命中）
- 外層 React wrapper class 是 styled-components hash（`sc-66bf5539-0 euXOeE`）無 keyword 可命中
- 既有 cleaner markerOf 只讀 class + id、看不到 data-* attributes
- 但外層靠 styled-components min-height CSS 仍撐 540×1100 占位空間 → 灰色方塊殘留

**修法**：`THIRD_PARTY_AD_SEL` 擴充 4 條 React component data attribute selector：
- `[data-testid="ad-unit"]`
- `[data-testid="ad-slot"]`
- `[data-component="ad-slot"]`
- `[data-component="ad-unit"]`

**通則依據**：`data-testid="ad-unit"` / `data-component="ad-slot"` 是 **Google Ad Manager + React 新聞站跨站業界標準命名**（BBC / Vox / Vice / Insider / 任何使用 styled-components + GAM 的 React 新聞站皆用此命名慣例），屬結構性通則、非站點特判（硬規則 3）。data-testid 原本是 React 測試工具識別 ID，但社群轉而當廣告 component 的語意標記使用。

**驗收**：
- Fixture `third-party-ads-inside-article.html` 新增 3 條 React wrapper：
  - `<div data-testid="ad-unit" data-component="ad-slot" class="sc-66bf5539-0 euXOeE" id="bbc-react-slot-1">` 模擬 BBC 實際結構
  - 另兩條獨立驗 `[data-testid="ad-slot"]` 與 `[data-component="ad-unit"]`
  - id 刻意改 `bbc-react-slot-1/2/3`（不含 `-ad-` 邊界）、class 是 sc-hash，**只能**靠新 data attribute selector 命中
- 3 條對應 assertion 驗 dataset.jreadHidden === '1'
- **Sanity check 關鍵**：第一版 id 用 `bbc-ad-unit` 含 `-ad-` 邊界、sanity 拿掉 data attribute selector 後 **AD_BOUNDARY_RE 誤救援仍通過**（偽陽性）——這是 v0.7.8 硬教訓第 16 條的延伸實例。改用 `bbc-react-slot-N` id 後 sanity 正確 fail 3 條
- `npm test` 160 passing

**硬教訓追加（第 17 條，延伸第 16 條）**：
> **fixture id / class 裡只要含 `-ad-`、`-ad`、`ad-` 等邊界詞，AD_BOUNDARY_RE 就會誤救援。** 寫第三方廣告相關 fixture 時，**所有 id / class 都要刻意避開 ad 邊界**，才能讓真正的 forcing（`[data-testid="..."]` / `[id^="..."]` 這類 selector）成為唯一命中路徑。第 16 條教訓是「spec 不 fail 不代表 guard 有效」，本條是「sanity 仍 pass 不代表新 selector 沒作用——可能是既有其他 rule 誤救援」。修 ad 相關 rule 的 sanity check 要留意 fixture 裡不能有邊界詞。

---

**v0.7.8**——ebc 媽祖廣告清除 + 主文標題 wrapper 保護 guard（Jimmy 2026-04-24 回報 ebc news.ebc.net.tw /news/society/548318 兩個 bug + bbc /news/articles/clyepyy82kxo 右側廣告占位殘留）。

**修法 (1)：NOISE_KEYWORD_RE 擴充 `marker` 詞**
- 場景：ebc 文末「與媽祖同行！2026 遶境全攻略看東森」行銷插播，wrapper class 是 `.inline_text.has_marker`。class 中 `marker` 詞跨 CMS 幾乎都指「標註 / 插播 / 推薦」特殊內容、非主文
- 通則依據：`marker` 在 class 命名裡的語意幾乎不會是主文結構（主文內容不需要「被標記」），常見於推薦 / 廣告 / 特殊內容標註 wrapper
- Fixture `ebc-inline-marker-ad.html` 驗行為 + 字面 regex forcing（NOISE_KEYWORD_RE 必含 `\bmarker\b`）

**修法 (2)：`hideInsideArticleByKeyword` 加 h1-wrapper guard**
- 通則：article 內含 h1（主文標題）的 wrapper **一律保留**，即使 class 命中 NOISE_KEYWORD_RE
- 場景：許多 CMS 把 share / social / author / comment 等 keyword 與 post header 混在同一 class（例：`.share-header` / `.social-post-header` / `.author-header`），wrapper 本身命中 NOISE_KEYWORD_RE 但實際包主文 h1，hide 會讓 h1 連帶不可見
- 實作：`if (el.querySelector && el.querySelector('h1')) continue;` 簡短一行
- 風險評估：極低。wrapper 內部真正的 share / nav / button 各項由 `hideInsideArticleAllButtons` / `hideInsideArticleByKeyword`（對子 container）各自處理，guard 只保護 wrapper 本身
- Fixture `h1-wrapper-header-keyword-guard.html` 用 `.share-header` wrapper（`share` 詞在 NOISE_KEYWORD_RE 明確命中）forcing：有 guard → wrapper 保留 + h1 可見 + 內部 `.share_bar` 仍 hide；無 guard → share-header 被 hide → h1 祖先 hidden → 2 條 assertion fail

**未修 → PENDING_REGRESSION**：
- **ebc h1 漏 scope**：真實根因是深層 single-child wrapper 結構（4 層 `#main_content > article_container > article_main_box > article_main > article_content`），`PROMOTE_MAX_HOPS=3` 不夠、放寬 4 又讓 scope 擴大吃進其他 sibling（相關新聞列表 / 聽新聞 controls / 更多 link）。需 promote+narrow 聯動架構升級。暫記 `test/PENDING_REGRESSION.md`
- **bbc 右側廣告占位殘留**：Playwright bundled Chromium 下 bbc 廣告 JS 不 inject（bot detection / geo），probe 即便等 18 秒 + 門檻降到 50×50 仍 0 殘留，無法在 harness 重現 → 無最小 fixture。等 Jimmy 實機提供殘留元素的 DOM 結構（class/id/tag）才能寫通則 rule

**驗收**：
- `npm test` 160 passing（+ 6 新 assertion：ebc marker fixture 2 + h1-wrapper fixture 4）
- sanity check：拿掉 marker 詞 → 字面 forcing fail；拿掉 h1 guard → share-header + h1 祖先 2 條 assertion fail
- harness ebc 實測：媽祖廣告 `.inline_text.has_marker` 被 hide、`✅ 無殘留雜訊`

**硬教訓補第 16 條（留給後續對話）**：
> **spec 不 fail 不代表 guard 有效、可能是 forcing 沒觸發。** v0.7.8 寫第一版 h1-wrapper guard spec 時用 `.article_header` 當 wrapper class（模仿 ebc 實測），spec 全過 + sanity 拿掉 guard 也全過——這時該警覺 forcing 沒觸發，不是 guard 的功勞。Node regex test 證實 `header` 詞根本**不在 NOISE_KEYWORD_RE alternation 裡**（只有 `cookie-` / `newsletter-` 等複合詞，沒 bare `header`）、`article_header` 本來就不會被 keyword hit。修正：fixture wrapper class 改用 `share-header`（`share` 在 NOISE_KEYWORD_RE 明確命中），forcing 才真正生效、sanity 才 fail。**修 guard 類 spec 的 sanity check 要拿掉 guard 看 assertion 是否 fail——不 fail 代表 forcing 本身無效**，要改 fixture。

---

**v0.7.7**——修 v0.7.5 regression：ambiguous confidence penalty 改「從 top-5 挑 POSITIVE 命中者」（Jimmy 2026-04-23 回報 upmedia.mg /tw/focus/comprehensive/256956 從 v0.7.5 起無法偵測主文）。

**根因**：Probe 擷取真實頁面 detector 各階段：`<article>` / `[itemtype]` / `[itemprop]` / `<main>` 四個策略全 miss、只剩 heuristic。heuristic 計分：
- top1 = 無 class 的 wrapper DIV（raw 7、textLen 717、score 10.26、無 POSITIVE/NEGATIVE）
- top2 = `.news-box-text` 真主文（raw 3.5、textLen 988、POSITIVE 命中、score 10.17）
- top1/top2 = 1.009 < 1.25 → ambiguous=true
- v0.7.5 邏輯 `confidence *= 0.85`：raw confidence = (10.26-10)/40*0.4+0.30 = 0.3026 → 打折 0.2572 < MIN_CONFIDENCE 0.30 → `return null`
- detector 回 null → 整個網頁無法進閱讀模式

**修法**：回滾 `confidence *= 0.85` 打折邏輯、改動「選哪個」而非「打折 confidence」。`detectByHeuristic` 在 ambiguous 分支從 top-5 裡優先挑 **POSITIVE 命中且 NEGATIVE 沒命中** 的候選：
```js
let chosen = top[0];
if (ambiguous) {
  const preferred = top.find(c => c.posHit && !c.negHit);
  if (preferred) chosen = preferred;
}
```
貼近 Readability.js `nbTopCandidates` 的真實精神（top-N 裡 class weight 最好者勝出）。candidates 物件加 `posHit` / `negHit` flag。保留 `result.ambiguous` 作為 `detect()` → `promoteForTitle` 的 hops 收緊信號（避免誤選 anchor 時 promote 升 common ancestor 吞整頁）。

**驗收**：
- Fixture `upmedia-heuristic-ambiguous-positive-wins.html` 精確設計 seedScore 公式（1+commas+min(3, floor(len/100))）讓 wrapper score 10.5 vs news-box-text POSITIVE 後 9.72、比值 1.03 < 1.25 觸發 ambiguous
- 舊邏輯：conf 0.30 × 0.85 = 0.255 < 0.30 → null fail；新邏輯挑 POSITIVE 勝出、conf 0.30 pass
- **字面 regex forcing**（`top.find\s*\(\s*c\s*=>\s*c\.posHit`）防未來回退
- **字面 regex forcing**（不得包含 `if\s*\(\s*ambiguous\s*\)\s*confidence\s*\*=\s*0\.85`）防打折邏輯被加回
- sanity check：回滾修法 → 5 條 upmedia fixture assertion 全 fail（偵測 / ambig / POSITIVE 勝出 / 主文保留 / 字面 forcing）
- `npm test` 154 passing
- harness 四站全過：upmedia articleFound=true 恢復；line today / chinatimes / udn 無殘留雜訊

**硬教訓補第 15 條（留給後續對話）**：
> **confidence 數值打折是 anti-pattern，應動「選哪個」而非「打折信心」。** v0.7.5 引入的 `if (ambiguous) confidence *= 0.85` 表面上是「降低不確定結果的信心」，實際上在邊界 score 區間（10.0~10.5）會把剛過 MIN_CONFIDENCE 的 heuristic 結果直接殺掉整個偵測。正確模式：根據新資訊（ambiguous flag）**改變決策過程**（從 top-5 挑更可信者），不要事後 scale numerical 信心——那會把「信心不足」變成「完全放棄」，造成比選錯更糟的「無偵測」。Readability.js 的 `nbTopCandidates` 一直是「挑 class weight 最好者」的設計，v0.7.5 只借鑑了 flag 計算、沒借鑑選擇邏輯，本輪補齊。

---

**v0.7.6**——Postlight Parser 研究產物：Schema.org `itemprop="articleBody"` 策略（Jimmy 2026-04-23 第二輪研究）。

**研究範圍**：盤點 [postlight/parser](https://github.com/postlight/parser) `src/extractors/custom/` 120+ 站點 parser，抽樣讀 9 個具代表性的（NYT / Medium / Engadget / CNN / Ars Technica / CNET / Twitter / Blogspot / Wikipedia / BuzzFeed）找跨站通則。

**三類發現**：
- **content selector**：跨站 `article` tag / `[itemtype*="Article"]` JRead 已涵蓋；少數站自訂 class `.zn-body-text` / `.g-blocks` / `.article-text` 等屬 POSITIVE_RE 詞根已 cover；**唯一新增可抽的是 `itemprop="articleBody"`**，多個新聞站（NYT / CNN / Ars Technica）的 parser 用這個 selector
- **clean selector**：Medium `svg` / Wikipedia `.mw-editsection` / BuzzFeed `.js-ad-placement` / Twitter `.stream-item-footer`——**全是站點特判**，違反硬規則 3 不收
- **transforms**：Postlight 改 DOM 結構（`noscript → div` / `h2 → b` / padding-hack img 重排）——JRead 架構保留原 DOM、僅 hide + 覆蓋樣式，**類型不相容**全 skip

**修法**：detector 策略 2 雙層（`detectBySchemaOrg`）
- Layer A（原邏輯保留）：`[itemtype*="NewsArticle" i]` / `[itemtype*="BlogPosting" i]` / `[itemtype*="Article" i]` 容器型，命中 confidence 0.85、strategy `schema-org`
- **Layer B（新增）**：fallback 到 `[itemprop="articleBody"]`，命中 confidence 0.85、strategy `schema-org-body`

**通則依據**：Schema.org 的 `itemprop` 是 W3C 規範的 microdata property 標記，跨站通用、非站點特判（硬規則 3）。`itemprop="articleBody"` 元素的 textLen 通常較緊湊（僅 content 主體、不含 byline / meta），命中即主文。許多站即便外層沒掛 itemtype（SEO 配置較舊），內層仍標了 itemprop——這是 Google 結構化資料爬取依據，SEO 慣例。

**驗收**：
- fixture `schema-org-articlebody.html`：刻意建構「無 `<article>` tag + 無 `[itemtype*="Article"]`、僅內層 `div[itemprop="articleBody"]`」的真實 NYT/CNN 類結構，forcing Layer B 必須觸發才通過
- 4 條 spec：偵測成功 / strategy === 'schema-org-body' / confidence === 0.85 / itemprop 元素命中（含 SCHEMA_BODY_MARK 段落、不含 sidebar）
- sanity check：註釋 Layer B → strategy + confidence assertion fail（heuristic fallback 仍能選到 itemprop 容器，但 strategy 不再是 schema-org-body）
- `npm test` 149 spec passing

**不做的**：
- 各站 clean selector（`.mw-editsection` / `.js-ad-placement` 類全是站點特判、違反硬規則 3）
- 填充 `jread/site-overrides/`（工程量大、reader mode 架構已覆蓋大部分、ROI 低）
- Postlight 的 transforms 類 DOM 重建操作（架構不相容）
- Medium `clean: ['svg']`（其他站點的 SVG 可能是正文圖表——站點特判）

**硬教訓補第 14 條（留給後續對話）**：
> **從 Postlight Parser 120+ 站點 parser 中抽跨站通則的產出極低——9 個樣本僅抽出 1 條（`itemprop="articleBody"`）**。原因：Postlight 架構鼓勵為每站寫客製 parser（`.zn-body-text` 是 CNN 自訂、`.g-blocks` 是 NYT 自訂），跨站通則都已被 Schema.org microdata / ARIA / HTML5 semantic tag 這類 W3C 標準涵蓋。未來若有類似「是否借用 X 個站點 parser 專案」的問題，預期也會得到類似結論：**大部分的 selector 知識屬於各站 CMS 特定，而跨站通則往往能用 Schema.org / W3C 標準找齊**。Schema.org 的 `itemprop` 族還有 `author` / `datePublished` / `headline` 等，未來若 JRead 要抽 byline / 發布日期，同樣可直接走 microdata 通則。

---

**v0.7.5**——Readability.js 演算法借鑑三項：POSITIVE/NEGATIVE regex 擴充 + nbTopCandidates 競爭分析 + lazy-image hydration（Jimmy 2026-04-23 續問「是否有受推崇的主文偵測/雜訊清理專案可參考」）。

**研究四個主流**：Mozilla Readability.js（Apache 2.0、Firefox Reader View 引擎、業界 benchmark median F-score 0.970 / recall 0.929）、Postlight Parser（前身 Mercury Parser、MIT、120+ 站點 custom parser）、Trafilatura（Python、F-score 0.937）、DOM Distiller（Chromium 內建、Java 為主）。結論：**架構不同無法直接引入**——Readability 風格是「parse → 重建 clean DOM tree → 替換原頁面」、JRead 是「覆蓋原 DOM、標 `data-jread-active` + `data-jread-hidden` + 可還原」。硬引入整包等於拋棄 JRead 核心定位。但**借鑑演算法細節**成本極低、可直接落實。

**三項借鑑**：

1. **POSITIVE_RE / NEGATIVE_RE 擴充**（detector.js class-weight multiplier）
   - POSITIVE 補：`hentry|h-entry`（microformats 標記）+ `blog`（部落格 CMS class `.blog-post` / `#blog-content` 常見）
   - NEGATIVE 補：`gdpr|outbrain|related|sponsor|shoutbox|widget|skyscraper`（跨 CMS 廣告 / 相關推薦 / 側欄元件慣用命名）
   - **刻意不收 Readability 原版的 `page|pagination`**——`#page-wrapper` 是整站 wrapper 的常見命名，命中會讓 detector 把 top bar + nav + footer 全當主文；`pagination` 在 Readability 自己的 unlikelyCandidates 也是負面訊號（內部矛盾，歷史包袱）
   - **刻意不收 `hidden|hid|contact|scroll|shopping|tags|media|meta`**——這些詞在正文結構裡也常出現（`.article-meta` / `.category-tags` / `.media-object`），命中會讓真主文的 multiplier 被砍半、誤判

2. **nbTopCandidates 競爭分析**（detector.js `detectByHeuristic` 改寫）
   - 原本：`let best = null; let bestScore = 0` 只挑 top 1
   - 改成：收 `candidates` array、`sort((a,b) => b.score - a.score)`、取前 5
   - `runnerUpScore` = top[1].score；`ambiguous = top1/top2 < 1.25`
   - `ambiguous=true` 時：confidence ×0.85 + `result.ambiguous` flag
   - `detect()` 依 `result.ambiguous` 傳 `hopLimit=1` 給 `promoteForTitle`，避免 heuristic 選錯 anchor 時 promote 沿祖先升到 common ancestor、把整頁 chrome 吞進主文（v0.7.2 upmedia 國際版踩過的坑的結構化一般化防守）
   - 不把 top2 取代 top1——top1 仍是「最高分者」，只是告訴上層「這個 pick 不穩、別硬 promote」

3. **lazy-image hydration**（cleaner.js `hydrateLazyImages` + `restoreLazyImages` 新增）
   - 場景：Medium / WordPress / CMS 類站點用 IntersectionObserver 做 lazy image load，未進視窗的 `<img>` 的 `src` 是 1x1 透明 gif、base64 placeholder 或空字串，真圖 URL 存 `data-src` / `data-original` / `data-lazy-src`。進 reader mode 時 DOM 被大幅改造、排版重置，**原站 lazy observer 常常跟不上新 viewport 定位**，圖片保持空白
   - 修法：進 reader mode 時掃 articleEl 內 `<img>`，`src` match `/^\s*$|^about:blank$|^data:image\//i` 視為 placeholder；依序嘗試 `data-src` / `data-original` / `data-lazy-src` / `data-lazy` 屬性、再 fallback 到 `srcset` / `data-srcset` 第一個 URL，補進 `src`
   - restore：以 `hadSrcAttr` 區分「原站無 `src` attribute」vs「原站 `src=""`」做 round-trip 還原。前者 removeAttribute、後者 setAttribute('src','')
   - 對標 Readability.js `_fixLazyImages` 精神——Readability 是「parse HTML 後修」情境、我們是「瀏覽器已載但 observer 沒跑」情境，attribute 名單與補救邏輯一致

**驗收**：
- 三條 fixture：`readability-class-weights.html`（POSITIVE/NEGATIVE 擴充）、`readability-ambiguous-candidates.html`（ambiguous flag）、`lazy-image-hydration.html`（5 種 lazy case）
- 9 條新 spec：2 條字面 regex forcing（防止未來誤刪名單）+ 3 條行為 assertion（主文選對 / ambiguous flag / confidence 打折）+ 5 條 lazy case 涵蓋 + 1 條 round-trip restore
- Sanity check 三輪：退回舊 regex / `ambiguous=false` / 註釋 `hydrateLazyImages` 呼叫——各自對應的 assertion fail、其他不動，forcing function 有效
- `npm test` 145 passing
- harness 三站（line today / chinatimes / udn）residual audit 三次全 `✅ 無殘留雜訊`，無 regression

**不做的**：
- 硬引入 Readability.js 整包（要拋棄 `data-jread-active` / restore 機制）
- unlikelyCandidates regex 早期排除（detector 目前已有 `isSignalExcluded` 處理 modal/dialog；大規模 class keyword pre-filter 太激進、風險是真主文被誤排除）
- `_unwrapNoscriptImages`（JRead 架構保留原 DOM 結構、不需 unwrap）
- Readability 分數縮放係數 `+=25` 直接照抄（我們是 `*= 1.25`/`*= 0.5` multiplier，內部 scale 不同，照搬會破壞既有 confidence 曲線）

---

**Engineering note（2026-04-23，無版本變動）**——Fanboy social / newsletter / notifications cosmetic list spike 結論。Jimmy 續問「有沒有專門攔社群 widget / 訂閱 popup / 通知等『惱人事物』的 list 可參考」，評估三個候選：

1. **Fanboy's `_general_hide.txt` 三份**（social / newsletter / notifications、EasyList 家族、GPL-3.0）——格式同上輪 EasyList、fetcher/parser 可複用
2. **uBO uAssets/filters/annoyances.txt**——uBO extended syntax（`:has-text()` / `:has()` / `:matches-path()`），純 CSS `querySelectorAll` 吃不下
3. **[Web Annoyances Ultralist](https://github.com/yourduskquibbles/webannoyances)**（CC-BY-SA-4.0）——分類（sticky headers / dickbars / floating boxes / social share bars）高度符合 JRead 目標，但同樣 extended syntax

**spike 執行**：抓 Fanboy 三份 `_general_hide.txt` + 兩份 `_specific_hide.txt`，萃取 11264 條 unique generic cosmetic selector；probe 在六站跑（Jimmy 上輪四站 line today / udn / chinatimes / upmedia + bbc + theverge）。

**結果**：五站（theverge timeout 未計）reader mode 內 articleEl scope **全數 0 命中**。baseline（全頁 body）命中的少數元素（udn `.footer-social` x2、udn `.fb-share-button` x1、chinatimes `.social-share` x2、chinatimes `.facebook-page-plugin` x1、chinatimes `.social-share-wrapper` x1）都在**頁面 footer / sidebar**，根本不會被 detector 選進 articleEl。比上輪 EasyList ad spike 結論還徹底——上輪至少還能抽 14 條跨站第三方廣告 selector 進 cleaner，這輪 fanboy 連一條跨站通則都抽不出。

**根因**：cleaner 現有 `NOISE_KEYWORD_RE`（含 `social` / `social-share` / `share` / `subscribe` / `newsletter` 詞根）透過 `markerOf` 走 class+id 比對，已完整代理 fanboy list 的跨站通用 pattern。fanboy 剩下的 9000+ 條 generic 是 WordPress / CMS plugin 站點特定 class（`.post-share-twitter` / `.entry-social-buttons` / `.wp-social-login-*` 類），reader mode 架構本身就不會讓這些進 articleEl。

**決策**：不引入任何 list / 不動 extension code / 不 bump 版本。spike 產物（fetcher、probe、抓下來的 fanboy json）全刪，符合 CLAUDE.md「probe 腳本用完就刪」硬規則。結論記入 CHANGELOG + SPEC engineering note 段落，供未來對話避免重跑相同 spike。

**硬教訓補（第 13 條，留給後續對話）**：
> **連續兩個 spike 同結論：reader mode 架構本身就是最強的 ad/annoyance blocker。** 廣告容器、社群 widget、newsletter popup、cookie banner 這些東西的共同特徵是「不在主文 DOM 子樹內」——detector 選 articleEl 時本來就不會選到它們。上輪 EasyList 40984 條 → 四站 articleEl 內僅命中 3；這輪 fanboy 11264 條 → 五站全 0。**想借 ad-blocker / annoyance-list 時先問一句：這批 selector 瞄準的雜訊，有多少比例會進 articleEl？**若答案是「幾乎都在 article 外」，就不必引入整包，cleaner 既有 NOISE_KEYWORD_RE + ancestor-sibling / fixed / dialog rule 已經代理。真正要花力氣的是「進得了 articleEl 的殘留雜訊」——這類 bug 由使用者 spot check 回報 + harness residual audit 驗收，走結構性 rule 修法，沒有 filter list 能一次解決。

---

**v0.7.4**——廣告對應強化：EasyList spike 結論 + 第三方廣告服務標識符新 rule（Jimmy 2026-04-23 詢問「能否借現成 ad-blocker 避免重複造輪子」）。

**Spike 結論**：嘗試引入 EasyList（社群維護 10+ 年的 ad filter list）整包前先做驗證。`tools/fetch-easylist.js` 抓 easylist.txt + fanboy-annoyance.txt 萃取 40984 條 generic cosmetic selector（786 KB lite 版）；`tools/probe-easylist.js` 在 Jimmy 提供的四個真實 URL（line today / udn / chinatimes / upmedia）分別測「reader mode OFF / 全頁 body」vs「reader mode ON / articleEl」兩個 scope。結果：四站 reader mode 內合計僅命中 3 個元素（udn 的 `.udn-ads` x2 + google_ads_iframe x1），其餘三站 articleEl 內命中 0。**結論：EasyList 整包對 JRead 邊際效益極低——reader mode 架構（detector 精確選 articleEl + cleaner 結構性 rule）已把大部分廣告容器「自然繞過」**，廣告容器在 detector 階段根本不會被選進 articleEl。Spike 腳本 + 抓下來的 list 用完即刪（符合 CLAUDE.md「probe 腳本用完就刪」硬規則）。

**Spike 增量**：baseline（全頁 body）命中揭露**跨站第三方廣告服務的業界標準命名**：
- **Google Ad Manager (GPT)**：`[id^="div-gpt-ad"]`、`[name^="google_ads_iframe"]`、`iframe[src*="googlesyndication.com"]`、`iframe[src*="doubleclick.net"]`——四站都有，是 GAM 官方推薦 id / name 命名
- **Taboola**：`[class*="trc_"]`（`.trc_excludable` / `.trc_rbox*` / `.trc_related_container`）、`[id*="taboola"]`——udn 大量命中（100 個視覺單位裡 60+ 個）
- **popIn Discovery**（日系推薦平台）：`[class*="_popIn_"]`——chinatimes / upmedia 大量命中
- **Outbrain**：`[class*="OUTBRAIN"]` / `[data-widget-id*="outbrain"]`
- **通用 ad- prefix**：`[id^="ad-"]` / `[class^="ad-"]` / `[id^="ads_"]`

這些屬結構性通則（第三方廣告 platform 官方命名），不是站點 hostname / 特定 class 特判，符合硬規則 3。

**修法**：
1. **cleaner 新 rule `hideInsideArticleByThirdPartyAds(articleEl, hidden)`**——在 articleEl 作用域一次 `querySelectorAll(THIRD_PARTY_AD_SEL)` 命中 14 條 selector branch 全 hide。放在 `hideInsideArticleByKeyword` 之後、`hideInsideArticleByHeadingText` 之前，作為第三方廣告的保險絲層（當 detector 不小心把 ad wrapper 選進 articleEl、或 ad 動態注入到 articleEl 內時擋下）
2. **NOISE_KEYWORD_RE 擴充 `trc_[a-z_]+` + `popin`**——markerOf 走 class+id，Taboola 的 `.trc_excludable` 不含 `taboola` 字樣、原 alternation 漏網；popIn 的 `_popIn_*` 雖已被 `AD_BOUNDARY_RE` 擋（尾端 `_ad` 匹配），加 `popin` 作雙保險

**驗收**：
- `test/regression/fixtures/third-party-ads-inside-article.html` 涵蓋全部 14 條 selector branch + 頭尾 2 段 THIRDPARTY_MAIN_MARK 主文保留 forcing
- `test/regression/cleaner.spec.js` 新增對應 it()，移除 rule 14 條 assertion 同時 fail、主文保留
- Sanity check：註釋掉 `hideInsideArticleByThirdPartyAds(articleEl, hidden)` → 此 spec fail 其他 130 全過，驗證沒踩既有規則
- `npm test` 131 spec 全過
- Playwright harness 三站驗收：chinatimes / line today / udn residual audit 三次 `✅ 無殘留雜訊`

**硬教訓追加（第 12 條，留給後續對話）**：
> **引入外部資料 / 函式庫前先做 spike 驗證 ROI，別先引入再評估。** 本輪差點把 786 KB EasyList lite 塞進 extension runtime 才發現對 reader mode 邊際效益近零。正確順序：(1) 用 fetcher 抓外部資料一次性入手（不 commit）、(2) 寫 probe 腳本在真實目標站點跑對照組（baseline vs 加功能後）、(3) 看 baseline 命中分佈找出真正可借用的**通則**（不是整包）、(4) 只抄通則進 extension、(5) 刪 spike 產物。EasyList 這次給我們的不是「list 本身」，而是「哪些第三方廣告服務命名跨站通用」——這個認知收進 14 條 selector 就夠了。

---

**v0.7.3**——bugfix 八層（cleaner / detector / SW / heuristic 全套）+ harness residual audit 升級（Jimmy 2026-04-23 回報 chinatimes 即時新聞 /realtimenews/20260423000917-260410）。

症狀鏈：
1. reader mode 開啟後右欄「財經熱門新聞」10 條編號列表整塊殘留（aside.column-right）
2. aside 清掉後 column-left 仍鎖 308px 寬、右側 300px 空白沒還給主文
3. 文末「也許您會感興趣」第三方推薦 widget 堆（popIn / dable.io / Taboola）整塊殘留

根因鏈三層：
1. **sidebar 規則 false negative**——`hideInsideArticleSidebarColumns` 條件 B 對 `<aside>` tag 的判定是 `textLen < main × 0.5 + rectH > 400`。harness 時序 race 下主文 column-left textLen 約 2457（相關閱讀未 lazy-load 完時主文文字偏低）、aside textLen 1389（10 條 hot-news + section header），aside/main 比值 0.565 打在保守 0.5 門檻上方漏網，條件 B 整個 early return 沒進 rectH 檢查。
2. **float layout 沒 collapse**——aside 即便被清掉，`.column-wrapper.clear-fix` 內是傳統 float + 固定 width 多欄 layout（column-left: float:left width:308px + aside: float:right width:300px），而 `collapseGridWithHiddenCell` 只處理 grid / flex-row、不處理 float，主文 column-left 仍被鎖 308px 寬、右側 300px 空白殘留。
3. **keyword 名單缺 base form**——文末 `<section class="dable-recommend popin-recommend taboola-recommend">`（含「也許您會感興趣」+ popIn Discovery / dable.io / Taboola 三個第三方推薦 widget iframe）的 class 命名全用 `recommend` 動詞詞根，但 NOISE_KEYWORD_RE 只有 `recommended` 形容詞（覆蓋 `#recommended-article` 類），`recommend` 結尾的 class 全部漏網。

修法（結構性通則、非 hostname / class 特判）：
- **(A) 條件 B 簡化**：cleaner.js `hideInsideArticleSidebarColumns` 條件 B 拿掉 `s.textLen < main.textLen * 0.5` 檢查，只保留「`<aside>` tag + rectH > 400」的絕對結構特徵。aside 是 HTML5 語意「次要內容」tag；rectH > 400 已排除 pull-quote（通常 < 300px 簡單結構）；textLen 相對比值只會把這類邊緣場景當 false negative 放過。Engadget 的條件 B 命中原本也不依賴 textLen ratio（aside 被廣告 placeholder 稀釋 textLen 接近 0），兼容保留。
- **(B) float layout collapse**：`collapseGridWithHiddenCell` 新增 float layout 觸發條件——container 非 grid / flex-row 但 direct children 有 `computed float !== 'none'` 且存在 hidden sibling 時，走既有 hidden-sibling 分支。child loop 加 `float: none !important` 清 float，配合既有的 `width: auto` + `max-width: none` 讓 visible float children 回到自然 block 流、撐滿 container。`prevFloat` / `prevFloatPriority` 記入 collapsed，restore 時復原。
- **(C) NOISE_KEYWORD_RE 全面擴充跨 CMS 雜訊 family keyword**：alternation 加入以下跨站點 CMS 命名慣例 family——
  - `recommend`（動詞詞根）涵蓋 `.dable-recommend` / `.popin-recommend` / `.taboola-recommend` 第三方推薦 widget
  - `more-(news|stories|posts|articles)` 涵蓋 udn `section.more-news`（「延伸閱讀」section）+ 聯合 / 中時 / 各種新聞 CMS 的相應命名
  - `related-(articles|news|posts|stories)` 擴大既有 `related-articles` alternation，涵蓋 udn `section.related-news`（「相關新聞」）
  - `sponsor`（動詞詞根）涵蓋 udn `section.sponsor-ads` / `sponsor-links`——既有 `sponsored` 形容詞不 match `sponsor-ads`
  - `discuss`（動詞詞根）涵蓋 udn `section.discuss-board` / `discuss-form`——既有 `discussion` 名詞不 match `discuss-board`
  - `taboola` 涵蓋 Taboola 第三方 widget `taboola-below-article-thumbnails` 等跨站 embed 慣例命名

  regex boundary 設計（`(^|[^a-z0-9])...([^a-z0-9]|$)`）保證動詞詞根不誤殺既有形容詞—alternation 會依序 try，`recommended` / `sponsored` / `discussion` 各自有自己的 alternation 先行。SPEC.md 的 keyword 名單對應更新。

Regression spec：
- `test/regression/fixtures/chinatimes-aside-high-text-ratio.html` 三層 forcing：(1) main textLen 593（> 500 門檻）+ aside textLen 339（> main × 50% = 296.5 邊界），驗條件 B 簡化；(2) column-left / aside inline `float: left/right`，驗 float collapse 對 visible column-left 強制 `float: none !important` 且 restore 還原；(3) `<section class="dable-recommend popin-recommend taboola-recommend">` 驗 recommend keyword 命中 hide。
- `test/regression/fixtures/udn-article-siblings-noise.html` 5 條 forcing：article 內含雜訊 sections（more-news / related-news / taboola / sponsor-ads / discuss-board），主文 textLen 刻意 < 500 讓 sidebar-column rule 整個 skip，sibling 純文字無連結讓 link-density rule 也不觸發——keyword heuristic 成為唯一命中路徑。退回舊 alternation 任一條 assertion 即 fail。

sanity check 所有修法都驗過（任一 revert 都 fail）。harness 對真實站實測：chinatimes aside hide + column-wrapper collapse + 文末 recommend widget 清除；udn 文末 5 塊雜訊全部清除。117 spec 全過。

---

同一版本另加 line today 標題漏掉 + scroll 鎖修法（第 5 層，Jimmy 2026-04-23 回報 today.line.me/tw/v3/article/l2G8KyL）：

症狀：reader mode 下（1）文章標題沒納入卡片；（2）無法往下捲動（user 感受）。

根因鏈：
1. **title matches 60% 門檻漏網**：line today 的 og:title 帶三段尾綴「台鐵...為 | 自由電子報 | LINE TODAY」（47 chars）；h1 僅寫純標題 27 chars。`titleMatches` 要求 text.length >= target.length × 0.6 → 27 / 47 = 57% < 60% → match 失敗、`promoteForTitle` 沒升級、h1 不在主文 scope。
2. **PROMOTE_MAX_HOPS=2 不夠**：real line today 結構下 article 跟 h1 分別在 `div.swipe-back` 下的兩個獨立 wrapper 分支（article 爬 3 hops 到共同祖先 swipe-back），MAX_HOPS=2 在 hop 0/1 找不到含 matching h1 的兄弟、return 原 article。
3. **「scroll 鎖」是連動副作用**：promote 失敗 → 主文僅剩 article.entityBodyModule textLen 501（極短）→ reader card 內容少 → document scrollHeight 1409、可 scroll 空間僅 500px，user 感覺滾兩下就到底。實測 touchAction / overscrollBehavior / body listeners 皆正常，無 JS 鎖。

修法（結構性通則、非 hostname / class 特判）：
- **(1) `getCanonicalTitle` 對 og:title 取首段**：既有邏輯只對 document.title 分隔 `\s+[–—|]\s+` 取首段，og:title 分支直接整段回傳。line today 類「文章 | 媒體 | 品牌」三段尾綴是跨站 meta title 慣例（udn / 聯合 / BBC / NYT 類似），對 og:title 也取首段才穩健。
- **(2) `PROMOTE_MAX_HOPS` 2→3**：line today Next.js SPA styled-component 多層 wrapper 要 3 hops 才到共同祖先。upmedia 的 heuristic 誤選（v0.7.2 根因）已由 modal signal 排除 + textLen bonus 前置防止進入 promote 路徑，3 hops 仍比升到 body / #wrapper 安全。PENDING_REGRESSION 原「MAX_HOPS 無 forcing function」條目現被 line today fixture 覆蓋（實作 3 層 wrapper 分支重現真實站結構）。

Regression spec：`test/regression/fixtures/linetoday-ogtitle-suffix.html` 雙 forcing：og:title 有三段尾綴 + article / h1 共同祖先距 article 3 hops。sanity check 任一 revert（getCanonicalTitle 不取首段 / MAX_HOPS 退回 2）都會讓 spec fail。harness 對真實 line today 實測：post-toggle article 升級到 div.swipe-back，textLen 1119（含 h1 + cover + meta），documentHeight 從 1409 膨脹到 5553，scroll 空間恢復。121 spec 全過。

---

同一版本另加 service-worker icon path 修法（第 6 層，Jimmy 2026-04-23 reload extension 時 `chrome://extensions/` 跳出錯誤通知實測）：

症狀：Jimmy reload extension 後 `chrome://extensions/` 通知中心冒出多條 `Uncaught (in promise) Error: Failed to set icon 'assets/icons/icon-16-disabled.png': Failed to fetch`，每個既有 tab 各一條。

根因：service-worker.js 的 `ICONS_ACTIVE` / `ICONS_IDLE` 用 relative path `'assets/icons/icon-*.png'`。SW 的 relative path 是相對 SW 所在目錄（`/background/`）而非 extension root → Chrome 嘗試 fetch `/background/assets/icons/...` 檔案不存在。reload extension 時 `tabs.onUpdated` 對每個既有 tab 觸發、handler 呼叫 `chrome.action.setIcon({ tabId, path: ICONS_IDLE })` 全部 fail。與 v0.4.1 importScripts 路徑 bug 完全同類型（見 PENDING_REGRESSION.md 該條 lore）。

修法：`ICONS_ACTIVE` / `ICONS_IDLE` path 改為 `/` 開頭絕對路徑 `'/assets/icons/...'`——Chrome 解析成 extension root 相對，能正確 fetch。

路徑 B（依 CLAUDE.md 硬規則 4）：純 SW wire-up + 實際 setIcon 呼叫依賴真實 Chrome action API，jsdom 無 chrome.action，無法寫 automated spec。已在 PENDING_REGRESSION 的「service-worker icon swap wire-up 未補 spec」條目補上此路徑修正 lore + 驗證方式（reload 後 chrome://extensions/ 不得有 Failed to fetch 錯誤）。

---

同一版本另加 cleaner heading text heuristic（第 7 層，Jimmy 2026-04-23 回報 line today 內文以下「更多國內相關文章 / 其他人也看了 / 最新消息 / 查看更多」等 section 殘留）。

症狀：line today reader mode 下，detector 雖然 promote 到 `div.swipe-back` 正確含標題與主文，但 swipe-back 內還有 4 個以上文末 section（`section.moduleContainer`，heading 分別為「更多國內相關文章」「其他人也看了」「最新消息」「查看更多自由電子報」+ 各自 ul 列表）全部殘留在 reader card 尾部。

根因：LINE Today 是 Next.js SPA、全部 class 走 emotion-style hash（`css-xxx`）—— 這些 hash 對 reader 來說**毫無語意資訊**，NOISE_KEYWORD_RE（跨 CMS class 命名）完全無法命中。而 hideAncestorSiblings 只處理主文 scope 外的祖兄，這些 section 在 articleEl（swipe-back）scope 內就失靈。

修法（結構性通則、非站點特判）：cleaner 新增 `hideInsideArticleByHeadingText`——
- 掃 articleEl 內所有 h2/h3/h4
- 文字長度 <= 20（主文副標通常不會剛好命中規則字）
- 匹配跨站通用文末推薦 / 相關 / 列表 section 標題字樣 regex：
  - 延伸閱讀 / 相關新聞 / 相關文章 / 相關報導
  - 推薦閱讀 / 推薦文章
  - 最新消息 / 最新新聞
  - 更多相關 / 更多xx文章 / 更多xx新聞 / 更多xx報導
  - 看更多 / 查看更多
  - 其他人也看 / 你可能（也）（喜歡 | 感興趣）
  - 也許您（會）（感興趣 | 喜歡）
- 命中後 hide heading 的 `closest('section, aside')`——精確命中 section-level 容器。**不** hide articleEl 的 direct child，因為 chinatimes fixture 類結構下「也許您會感興趣」h4 深層埋在 column-wrapper 內，direct-child 式 hide 會連同主文一起砍
- 若 heading 沒有 section/aside 祖先，放棄 hide（conservative，避免 over-hide）

通則性討論：這是**內容 heuristic**而非 class heuristic——LINE Today / Next.js / React SPA 類站點放棄了語意化 class 命名，唯一能跨站穩定 match 的信號就是 heading 文字本身。跨站通用性高：這些字樣是中文新聞 / 部落格 / Medium 中文化等站點的標準文末 section 命名，用十幾年了都沒變過。

保護：原有主文副標（例「案情分析」「後續發展」「法律評析」）不會 match 這組字樣；規則執行後不誤殺 chinatimes「財經熱門新聞」aside 的 column-wrapper 主文容器（已從 regex 移除「財經熱門」後實證）、不誤殺 fixture 主文（LINETODAY_MAIN_MARK 段落驗證保留）。

Regression spec：`test/regression/fixtures/linetoday-ogtitle-suffix.html` 擴展加 4 個文末 section（`#tail-more-related` / `#tail-also-read` / `#tail-latest-news` / `#tail-see-more`），spec 逐一驗 `dataset.jreadHidden === '1'`。sanity check 驗過：`clean()` 內拿掉 `hideInsideArticleByHeadingText` 呼叫 → 4 條 tail spec 同時 fail。harness 對真實 line today 實測：reader card 文末乾淨，無「更多 / 相關 / 其他人 / 查看更多」字樣殘留。126 spec 全過。

**同層 follow-up**——Jimmy 再次回報 line today「其他人也看了」section 仍殘留（文末的一個特定 moduleContainer）。probe 發現這塊在 `cleaner.clean()` 跑完之後才 lazy-load inject 進 articleEl（`div.swipe-back`）—— 舊 `startWatchingDynamicAppends` 的 MutationObserver 只觀察主文祖先鏈，且 articleEl 內部新節點被 isRelated guard 當 legit update 放行漏網。

擴展修法（通則）：
- MutationObserver 新增 `observe(articleEl, { childList: true, subtree: true })`——接 SPA 晚到的 lazy-load widget
- 新 helper `checkDynamicNoise`：對 articleEl 內新 appended node 跑雜訊特徵判定——
  - class/id 命中 NOISE_KEYWORD_RE（既有 CMS 命名慣例） → hide 整個 node
  - 節點本身或 descendant 含 h2/h3/h4 文字命中 NOISE_HEADING_TEXT_RE → hide heading 的 closest `<section>/<aside>`
  - 不動 legit 主文 update（SPA 段落追加 / typo 修正 / lazy 圖片 load）——只匹配雜訊特徵才 hide
- 祖先鏈上 append 維持舊邏輯（直接 remove 整塊）

Regression spec：detector.spec.js 的 linetoday describe 新增 async spec，模擬 clean() 後 `articleEl.appendChild(lazyInject)`（含「其他人也看了」h2），await MutationObserver microtask，斷言 `lazy-injected-suggest` 被 hide。sanity check：拿掉 `mo.observe(articleEl, { subtree: true })` spec fail。127 spec 全過。

**同層 follow-up #2**——Jimmy 再次回報 line today 內文以下仍殘留三塊：「網友貼文AI摘要」卡片 + 主文內「點開加入自由電子報LINE官方帳號」訂閱 CTA + 「查看原始文章」外連按鈕。

根因分別：
- AI 摘要 section 的 h2 是「網友貼文AI摘要」（8 chars），原 NOISE_HEADING_TEXT_RE 無此字樣
- LINE 官方帳號 CTA 是主文 `<article>` 內的 `<p><a>`，class 是 emotion-hash、a 文字「點開加入自由電子報LINE官方帳號，新聞脈動隨時掌握！」不含任何既有 keyword
- 「查看原始文章」是 `a.ltcp-link`（LINE Today Content Provider link），text 只 6 chars 沒 heading、class `ltcp-link` 是站點特定

擴展修法：
- **(A) NOISE_HEADING_TEXT_RE 擴充**：新增 `網友貼文.{0,4}AI` / `AI.{0,4}(摘要|總結|整理|生成)` / `.{0,6}AI摘要` alternation，涵蓋 LINE Today / 各種 AI 摘要 widget 的 heading 命名
- **(B) 新增 `hideInsideArticleByLinkText`**：對主文內 `<a>` 元素的 text content 跑 `NOISE_LINK_TEXT_RE` 匹配——
  - `查看原始文章 / 看原文 / 回到原文 / 閱讀原文 / 原文連結`（新聞聚合站外連回原發布站的慣用按鈕）
  - `加入.{0,10}(LINE|官方帳號|好友|粉絲專頁)` / `(LINE|官方帳號).{0,10}(加入|訂閱)`（LINE / FB 粉專訂閱 CTA）
  - `訂閱.{0,4}(電子報|本報|我們|粉絲團)`
  - 命中後 hide 目標：若 a 的 parent 是 p/div 且 a 文字占 parent 80%+，hide 整個 parent（整段 CTA 清掉）；否則只 hide a 本身（不誤殺內文中的順帶 link）

通則性：兩條都是跨站文字 heuristic，不依賴 class/id——LINE Today / Yahoo News / Google News / 各種台灣新聞站的文末 CTA + 外連按鈕文字用語都在這 family 內。

Regression spec：fixture 擴展加 `#tail-ai-summary`（AI 摘要 section）+ `#tail-view-original`（ltcp-link `<a>`）+ `#cta-line-subscribe`（`<article>` 內 p><a CTA）三個節點，spec 逐一驗 `dataset.jreadHidden === '1'`。sanity check：拿掉 `hideInsideArticleByLinkText` 呼叫 → 查看原始文章 + LINE CTA 兩條 spec 同時 fail。harness 對真實 line today 實測：文末 AI 摘要 + 「查看原始文章」+ 主文 LINE 官方帳號 CTA 全部清除。130 spec 全過。

---

**同層 follow-up #3**——Jimmy 連續回報殘留雜訊（「轉發 / 貼文 / 建立貼文 / 繼續看下去 / 訂閱 button / 廣告（請繼續閱讀）/ 贊助本文章 / 透過【Google新聞】/ 追蹤中時新聞網 / 聽新聞 / 要聞 breadcrumb / 🎮想成為超強飼主...」等）且要求「檢討並改進未來」。

**根因檢討**：舊 harness 驗收只看 `gap` log（相鄰 block 垂直 gap > 40px）+ grep 少數 hardcoded keyword（STDOUT 搜尋）。問題：
- viewport 截圖只拍第一屏，文末雜訊要 scroll 才看到，截圖根本照不出來
- gap log 只看頭 8 個 gap，文末多數 hidden 後 gap 消失，規則不觸發
- grep 只比對 stdout，但 stdout 主要是 PAGE log / SW log，reader card 內真實 DOM text 沒被 dump 出來 → **grep 沒命中 ≠ 不在**（偽陰性驗收）

**改進修法**：
- **`tools/debug-harness.js` 新增 residual audit**：post-toggle 後兩次 audit（1.2s + 5s，捕捉 SPA lazy-load），列出 reader card 內所有 visible element（過濾 SVG `<title>` / `<script>` / `<style>` / `<desc>` / `<noscript>` 等不可見 tag）的 direct text outline，與 `NOISE_AUDIT_KEYWORDS` 名單比對、命中者顯示 ⚠️ warning（含 tag、elCls、hit keywords、parent chain）
- 加 full-page 截圖 `.playwright-mcp/jread-reader-fullpage.png` 取代單張 viewport
- **CLAUDE.md 新增硬規則**：動 cleaner/detector 後禁止僅用 grep 驗收，必須跑 residual audit 看 `✅ 無殘留` 才算過

**cleaner rule 擴充**（用新 audit 掃三站抓出漏網）：
- NOISE_KEYWORD_RE 擴 `promote` / `donation` / `donate` / `breadcrumb` / `audio-player`：chinatimes `div.google-news-promote` / `div.donation-container` + udn `nav.article-content__breadcrumb` / `div.audio-player`
- `hideInsideArticleByKeyword` 另掃 `<button>`（原本只掃 CONTAINER_SEL）：line today `button.subscribe-button` 的 class 含 `subscribe`，但 button 不在 CONTAINER_SEL 漏網
- NOISE_LINK_TEXT_RE 擴 `^(訂閱|已訂閱|追蹤|已追蹤|關注|已關注|訂閱中|追蹤中)$`：單字 CTA button（line today 訂閱按鈕 text 含 CSS 多-state wrapper「已訂閱訂閱訂閱」整體不 match 但 class 走 keyword rule）
- `hideInsideArticleByLinkText` query 擴 `a, button`（原本只 `a`）
- 新 rule `hideInsideArticleByInlineAdText`：span / p / div 的 direct textNode（不抓子孫）match `^(廣告|AD|業配|促銷|贊助|廣編)\s*[（(]\s*.{0,20}?(請繼續|繼續|接下來|以下內容|下方)` → hide 該 element。自由時報 / 聯合 / ETtoday 主文段落中段插播「廣告（請繼續閱讀本文）」類 placeholder
- 新 rule `hideInsideArticleFontTags`：主文內所有 `<font>` tag hide——HTML4 老式 tag 現代幾乎只在 inline 廣告 / PR 推廣用（udn 實測：`<font><a>🎮想成為超強飼主？玩問答遊戲拿課程金</a></font>` inline PR）

驗收：三站 audit（`line today` / `chinatimes` / `udn`）全部 `✅ 無殘留雜訊`——line today reader card 只剩主標 + 發行 + 時間 + 圖說 4 項；chinatimes 剩主標/作者/時間/主文段落/tag 連結；udn 剩主標/時間/作者/主文段落。130 spec 全過（原 spec 保留，新增 rule 對既有 fixture 無 regression）。

---

**同層 follow-up #4**——Jimmy 回報 line today 實機 Chrome 下仍看到「轉發 (N) / 貼文 (N) / 熱門 / 最新 / 建立貼文 / 留言作者+時間+讚數 / 繼續看下去 / 5 筆推薦」—— harness audit 無 warning、但 Jimmy 截圖明確有。根因：Playwright bundled Chromium 在 bot detection 或 API CSP 限制下這些 widget 沒 inject 進 DOM，audit 以「harness 看不到」當「使用者看不到」偽陰性驗收。

改進修法：
- **harness audit 加 scroll trigger + 15s wait**：post-toggle 後 `scrollTo(0, scrollHeight)` 兩次 + sleep 15s，接近 Jimmy 實機載入速度
- **heading rule scope 擴 div/span**：LINE Today 用 `div`/`span` 做 header（「貼文 (166)」「熱門」「最新」），原本只掃 h2-h4 漏網
- **heading rule fallback**：若 heading 無 `<section>/<aside>` 祖先，fallback 升級到 articleEl 的 direct child sub-branch——但只在該 sub-branch **不含 >= 100 chars 主文 p** 才 hide（chinatimes「也許您會感興趣」h4 在 column-wrapper 深層、column-wrapper 自身含主文 p 保護成立）
- **NOISE_HEADING_TEXT_RE 擴**：`繼續看下去` / `^貼文\s*\(\d+\)?$` / `^(熱門|最新)$`
- **NOISE_LINK_TEXT_RE 擴**：單字互動 CTA（`建立貼文 / 轉發 / 轉貼 / 留言 / 分享 / 收藏 / 檢舉 / 回覆 / 讚 / 已讚` 等）+ `^轉發\s*\(\d+\)$` / `^貼文\s*\(\d+\)$`
- **NOISE_KEYWORD_RE 擴**：`postlisting / post-listing / thread / threads / reposted / repost`（LINE Today `div.postListing` 留言面板 wrapper + `a.reposted` 轉發 widget CMS class）
- **新 rule `hideInsideArticleCommentPanels`**：articleEl 的 descendant div/section 含 ≥ 3 個相對時間戳（`\d+\s*(分鐘前|小時前|天前|週前|個月前|年前|hours ago|...)`）且**不含 >= 300 chars 主文 p** → 視為 comment/social panel hide。通則結構：留言面板每則留言一個相對時間戳，主文作者資訊最多 1 個

驗收：audit 升級後 initial → delayed（+scroll + 15s）兩次 report；line today / chinatimes / udn 三站 audit 全 `✅ 無殘留雜訊`；line today 從原本 7 項 warning + 24 visible items → 1 項 warning + 5 items → 0 warning + 4 items（每層修完再跑 audit）。130 spec 全過。

---

**同層 follow-up #5（英文國際化擴充 + 經驗傳承）**——Jimmy 確認中文清光後要求「關鍵字是否足夠包含清除英文網頁的垃圾？加入」+「這輪經驗寫入文件傳承」。

**英文 regex 擴充**（`NOISE_HEADING_TEXT_RE` / `NOISE_LINK_TEXT_RE` / `NOISE_INLINE_AD_TEXT_RE` / `NOISE_KEYWORD_RE`）：

- `NOISE_HEADING_TEXT_RE` 加：`Related (Articles|...)`、`Recommended for you`、`More from X`、`You may/might also like/enjoy/be interested`、`Read more/next/also`、`Up next`、`Continue reading`、`See also`、`Further reading`、`Editor's/Editor’s Picks`（支援 ASCII + curly apostrophe）、`Sponsored content/stories/posts`、`Comments(N)`、`Discussion(N)`、`Responses(N)`、`Replies(N)`、`Newsletter`、`Subscribe`、`Follow us`、`Trending`、`Popular`、`Top Stories`、`AI Summary/Digest/Overview/Takeaways`、`Hot/New/Top`
- `NOISE_LINK_TEXT_RE` 加：`View original/source`、`Read (the) original/full article/more/next/on X`、`Back to top/article/original`、`Visit original/source/site`、`Show more/less`、`Load more`、`See more`、`Learn more`、`Get started/the app`、`Download (the) app`、`Open in app`、`Subscribe(d)`、`Follow(ing)/Unfollow`、`Like(d)/Dislike`、`Share/Repost/Retweet`、`Reply/Comment/Save(d)/Bookmark(ed)`、`Report/Flag`、`Join(ed)/Sign in/up/out`、`Log in/out`、`Register`、`Create (an) account`、`New post/Post/Reblog`、`Upvote/Downvote`、`Clap/Applaud`、`Join our newsletter/mailing list/community/telegram/discord/slack`、`Follow us on Twitter/X/Facebook/Instagram/TikTok/YouTube/LinkedIn/Threads/Line/Google News`、`Subscribe to our newsletter/channel/podcast/feed/email`、`N (minutes/hours/days/weeks/months/years) ago`（相對時間戳英文版）
- `NOISE_INLINE_AD_TEXT_RE` 加：`advertisement/sponsored/promotion/advertorial` + 中英分隔符 + `continue/please/below/article continues/story continues/more below`
- `NOISE_KEYWORD_RE` 加：`subscription`、`sign-up/signin/sign-in/login/register`、`recommendation`、`read-next/up-next`、`outbrain/zergnet/revcontent`（Taboola 同類第三方推薦 widget）、`callout`、`social-(bar|links|icons|share|media)`、`comment-form`、`livefyre/hyvor`（Disqus 同類留言平台）、`follow/follow-us/following`、`cookie-(banner|notice|consent|bar|message)`、`gdpr`、`consent`、`privacy-(banner|notice)`、`newsletter-(signup|form|cta)`、`email-(signup|capture|subscribe)`、`pagination/page-nav/pager/page-navigation`、`author-(bio|card|info|box|meta|widget)`、`about-author`、`popup/overlay/modal-(content|dialog|box|wrapper)`、`floating-(bar|cta|widget)`、`sticky-(bar|cta|banner|subscribe)`、`toast/snackbar/notification-(bar|banner)`

regex 設計原則：
- heading 用 anchor `^...$` 避免誤殺主文段落內含這些字的句子（`Discussion of methods in research`、`A Popular Science Article` 等 NOT match）
- 允許 0-3 個 trailing word（`Related Articles`、`More from NYT`、`Recommended for you` 都 match）
- curly quote `'`/`’` 用 character class `['’]?` 兩種都吃
- `/i` flag 處理 camelCase（`postListing`、`ReadMore` 等）

自動化驗證：node 寫 27 條英文正向案例 + 6 條反向（主文副標）案例，全正向 ✓ + 全反向 safe（0 false positive）。三站（line today / chinatimes / udn）再跑 audit 確認英文擴充後中文仍 `✅ 無殘留雜訊`。

**經驗傳承**：`CLAUDE.md` 新增「v0.7.3 整輪 cleaner 大量修法累積的教訓」8 條硬教訓 + 動詞詞根 vs 形容詞變體、SVG title filter、全形 vs 半形括號等陷阱，專供後續對話 / 新站點 debug 時參照，避免重複踩本輪十多次 audit 迭代的坑。130 spec 全過。

---

**同層 follow-up #6（所有 interactive button 一律清除，不保留）**——Jimmy 2026-04-23 明確要求：「規則是不是有刻意保留『分享』『訂閱』這類的按鈕？其實我不需要，包括其他按鈕都不需要」。

新規則 `hideInsideArticleAllButtons`：對主文內所有 `<button>` / `[role="button"]` / `<input type="button|submit|reset">` **無條件 hide**。特點：
- **不看 class / 不看文字 / 不設排除**（獨立於 NOISE_LINK_TEXT_RE / NOISE_KEYWORD_RE 的 text/keyword 匹配）
- **不受 PRESERVE_SEL 保護**——figure / summary / figcaption / blockquote 內的 expand / zoom / play / 展開 / 播放 等按鈕也一律清除
- 主文祖先 guard（`btn.contains(articleEl)`）仍保留，避免誤 hide 整個 reader card

風險與取捨：極少數 code sandbox / interactive demo widget 會被一併清除，但 reader mode 本就不適合跑 interactive 操作——這是使用者明確表達的設計意圖。

**其他「保留」邏輯評估後保留不動**：
- `PRESERVE_SEL = 'summary, figure, figcaption, blockquote'`——這是**正文語意元素保留**（`<summary>` editor bullets / 主圖+說明 / 引言 blockquote），不是「保留按鈕」。新 rule 已繞過它處理 button 範圍。
- `hideInsideArticleActionRows` 的 interactive ratio 排除 / `hideInsideArticleButtonClusters` 的 heading / 媒體排除——這是「**不 hide 外層 wrapper**」的保護（避免把 byline+button group wrapper 整塊砍，連作者日期一起丟）；外層 wrapper 保留後，新 rule 會清掉其內部 button，結果「作者/日期保留 + button 清除」——符合需求
- 主文祖先 `contains(articleEl)` guard——結構保護（避免 hide 主文容器本身），必要保留

驗收：三站 audit 全 `✅`——line today 4 items（H1 / 發行 / 時間 / FIGCAPTION）；chinatimes 16 items（H1 / 時間 / 發行 / 作者 / FIGCAPTION / 字級 label / 主文 P / tag `<a>`）；udn 8 items（H1 / TIME / 作者 / STRONG / 主文 P）。130 spec 全過（舊 spec 不驗「button 保留」故無 regression）。

---

**同層 follow-up #7（`<a>` 分享連結也納入 keyword 掃描）**——Jimmy 2026-04-23 回報 udn 文末仍有「LINE 分享」按鈕。

probe 顯示該按鈕是 `<a class="btn btn-social btn-social--line" href="#">`（href 非 social platform URL、是純 class-based 分享 link），parent `div.social-wrapper > aside.article-content__social`。兩個祖先的 class 含 `social` 被 NOISE_KEYWORD_RE 的 `social` alternation 命中已 hide——但 Jimmy 視覺仍看到，懷疑 reload extension 時序問題或 MutationObserver 在 real Chrome 某瞬間未及時攔截。

更 robust 的保險：**`hideInsideArticleByKeyword` 的額外 scope 從 `<button>` 擴到 `<button>, <a>`**，讓 class 命中 noise keyword 的 `<a>` 自己直接被 hide（不依賴祖先被 hide）。

場景覆蓋：
- `a.btn-social--line`（udn LINE 分享，class 含 `social`）
- `a.share-facebook` / `a.social-link` / `a.comment-btn`（跨站常見 social / comment CTA `<a>`）
- `a.subscribe-link` / `a.follow-btn`（訂閱 / 追蹤 CTA `<a>`）

風險：極低——主文超連結（文章引用 / wiki 連結 / 人名 ref）的 class 命名幾乎不用 noise keyword；實際被命中的 `<a>` 幾乎都是雜訊（社群分享 / 訂閱 / 留言 / CTA / 廣告 link）。

驗收：三站 audit 再跑 `✅ 無殘留雜訊`；chinatimes / line today 維持原乾淨狀態；udn 文末 LINE 分享按鈕結構已 hide。130 spec 全過。

---

**同層 follow-up #8（`hide()` 改 inline `!important`，解 CSS specificity 戰）**——Jimmy 2026-04-23 reload extension 後仍看到 udn LINE 分享按鈕。

根因：`hide()` 原本 `el.style.display = 'none'`（inline 無 priority）+ styler 注入 stylesheet `[data-jread-hidden="1"] { display: none !important }`。CSS specificity 戰：原站若有 `aside.article-content__social { display: flex !important }`（specificity 0,2,1）**贏過** jread stylesheet `[data-jread-hidden="1"]`（specificity 0,1,0）。兩邊都 `!important`、specificity 高的勝——元素被重新顯示。

修法：`hide()` 改 `el.style.setProperty('display', 'none', 'important')`——inline !important 是 CSS 優先級最高層（勝過任何 stylesheet `!important`），無 stylesheet rule 能打敗。`restore()` 用 `removeProperty('display')` + 還原 `prevDisplayPriority`（原 inline 若含 `!important` 也還原）。

通則：未來任何需要強制 hide 的 rule 都走 inline `!important`，不依賴 stylesheet。`hide()` helper 改完自動影響所有 hide 呼叫場景（sidebar / dialog / keyword / heading-text / link-text / comment-panel / all-buttons 等 10+ rules 全部受惠）。

風險：極低——inline !important 覆蓋任何 stylesheet；restore 時還原 inline 的 priority 保持一致。

CLAUDE.md 加第 10 條硬教訓，記錄 CSS specificity 戰陷阱供未來參照。驗收：udn audit `✅ 無殘留雜訊`；130 spec 全過（無 regression）。

---

**同層 follow-up #9（delayed lazy-inject + checkDynamicNoise 遞迴 button/a）**——Jimmy 2026-04-23 反覆 reload 後仍看到 udn LINE 分享按鈕，並補充「reader mode 啟動後**約 3 秒**按鈕才出現」。

根因：這是典型 **delayed lazy-inject** SPA pattern——
1. content script 在 `document_idle` 跑 `cleaner.clean()` 時，分享按鈕**尚未注入** DOM
2. 2-4 秒後原站 JS 透過 API 拉 social widget 注入進 articleEl（udn 的 `aside.article-content__social` 是晚注入的，跟我之前 pre-toggle probe 看到的 pre-inject 版本是不同 DOM node instance）
3. MutationObserver 攔到 `addedNodes`，`checkDynamicNoise` 檢查——但**舊版只看 node 自己的 class keyword + node 內的 h2-h4 heading text**，漏了「wrapper 自己無 keyword、內部 button/a 才有 keyword」的情境

修法（`checkDynamicNoise` 遞迴擴展）：
- **一律 hide** `node.querySelectorAll('button, [role="button"], input[type="button|submit|reset"]')`（符合 Jimmy 「所有 interactive button 都不需要」硬規則，不看 class）
- **遞迴** `node.querySelectorAll('a, button')` 逐一跑 `shouldHideByKeyword`，class 命中 noise keyword 的直接 hide

搭配第 10 修法（`hide()` 用 inline `!important`）—— 即使原站後續 JS 用 stylesheet `display: flex !important` 試圖重顯示，jread 的 inline !important 永遠贏。兩條合體才能徹底治住 delayed lazy-inject。

harness 驗證限制提醒：Playwright Chromium 的 lazy-inject 時序可能跟 Jimmy 實機 Chrome 不同步—— udn audit 三階段（+1.2s / +3s / +15s + scroll）全 `✅`，但本地 harness 不保證重現 Jimmy 實機看到的瞬間。修法靠**邏輯完整性**（MutationObserver subtree + 遞迴 check + inline !important 三者齊備）保證。CLAUDE.md 加第 11 條硬教訓記錄此陷阱。

驗收：130 spec 全過；udn harness audit 三階段全 `✅`。

**v0.7.2**——bugfix：detector modal signal 污染 + heuristic 外殼誤選 + promote 失控（Jimmy 2026-04-22 回報上報國際版 /tw/international/headlines/256941）。

症狀：reader mode 開啟後整頁 #wrapper 被當主文；top bar 站內 email、社群 icon、header logo、「快訊」列、「美伊開戰/最新/生活」分類列、右欄推薦文章列表等全部殘留。cleaner 的 outside-article 規則跳過這些元素——因為它們都是 #wrapper（article）的「後代」。

根因鏈（三層疊加）：

1. **Bootstrap modal signal 污染**：`<div class="modal fade" id="myModal"> > .modal-dialog > .modal-content > .modal-box` 內塞了 2700+ 字雜訊（天氣 / 日期 / 推薦連結）。modal 預設 CSS `.modal { display: none }` 生效，但 `detector.getText` 走 `innerText || textContent`——display:none 元素 innerText 空、fallback 到 textContent 讀到全文。`.modal-box` finalScore 11.9 擊敗真主文 `.news-box-text` 2.4。

2. **heuristic bubble-up 對深層主文不利**：`.news-box-text > 中間 wrapper div > p` 結構下，signal 的 parent = 中間 div（100%）、gp = `.news-box-text`（50%）——`.news-box-text` 本身只拿到 50% 折扣的 signal 累計分數（raw 2）。輸給 `.row` UI chrome（signal 直接 parent，100% 貢獻，raw 7）。

3. **`promoteForTitle` 無層數上限**：heuristic 選錯 anchor（UI chrome `.row`）後，沿祖先鏈找 h1/h2 matching canonical title，一路升到主文跟 chrome 的共同 parent = `#wrapper`。整頁 top bar / header / 右欄全被吞進 article scope。

通則修法（非站點特判，三層 defense）：

A. **heuristic `isSignalExcluded`**：祖先鏈含 ARIA `role=dialog / alertdialog / tooltip / aria-modal=true / aria-hidden=true` 或 inline / computed `display:none` 的 signal 不計分。ARIA 標記是 W3C 規範「不在正文流程」的語意；隱藏狀態是 author-declared「明確不渲染」。檢查 inline + ARIA 跨 jsdom/browser；stylesheet-only 隱藏（upmedia 這種非標準 markup）靠 `getComputedStyle` 在真 Chrome resolve。

B. **heuristic textLen bonus**：`score += min(textLen/200, 10) * (1 - linkDensity)`。Readability.js 的「內文 = 大量有意義文字 + 低連結密度」核心特徵——靠容器自身 textLen 拉開 UI chrome 與主文的分數差，補 bubble-up 對深層主文不利的盲點。

C. **`promoteForTitle` `MAX_HOPS=2`**：合理場景中 post-title 是 articleEl 的兄弟或祖父的兄弟（WordPress / Stratechery / Anthropic 實測）、不該往上升 5+ 層。上限後即使 heuristic 選錯 anchor，promote 也不會把整頁外殼吃進來。

驗證：

- fixture `test/regression/fixtures/upmedia-intl-modal-signals.html` 擷取最小重現結構（Bootstrap modal 含 10 個高密度 p、主文 p 埋兩層深、另有 `.container.px24.bg-white > .row` UI chrome 干擾）；用 `aria-hidden="true"` 觸發 (A) 的 ARIA 支路
- `detector.spec.js` 新增 5 條 spec：偵測成功 / 不得選 #wrapper / 主文 scope 不含 modal 雜訊 / 不含 header/footer / strategy=heuristic
- Sanity check：關掉 (A) 造成 2 spec fail（forcing function 成立）；(B)(C) 在 jsdom 下 (A) 已擋住 modal 後 forcing function 失效、由 harness 驗真 upmedia stylesheet-only modal 情境——已記入 `test/PENDING_REGRESSION.md` 2026-04-22 條目
- Playwright harness 實測：upmedia.mg 國際版 256941 從選 #wrapper → 選 `.news-box`（真主文）；政治版 256168 無 regression（一直是 `.col-lg-9`）；ChinaTalk / Dwarkesh Substack 等既有 baseline 的 article-tag 策略無受影響
- 115 spec 全過（110 + 5 新）

---

**v0.7.1**——bugfix：上報 icon-link 巨大化（Jimmy 2026-04-22 回報 upmedia.mg 政治版三個 icon「新聞摘要」「辭」「AI 新聞關鍵字詞查詢」在閱讀模式下被放大成巨型版）。

根因：styler 的 `[data-jread-active="1"] img { max-width: 100% !important; height: auto !important; }` 規則本意是維持主圖 aspect ratio，但這條對 `<a><img>` icon-link 結構反向傷害——原站常用 `height: 32px` 類 CSS 鎖 icon 高度、沒明確設 width，依賴 browser 的 intrinsic aspect-ratio 自動算 width。`height: auto !important` 吃掉原站 height 後，img 退回 naturalWidth x naturalHeight（upmedia 實測 `#toggleImg` 從 32x32 被拉成 250x250 natural size）。

通則修法（結構特徵、非站點特判）：
- 裸 `a > img` 視為 icon-link 結構（logo / UI 按鈕圖）——獨立 rule 只 cap 寬度、**絕不設 height**，保留原站對 icon 的合法尺寸限制
- 其他 wrapper（figure / picture / p / div）下的 img 視為內文配圖——維持舊規則 `max-width: 100%` + `height: auto` 的 shrink-fit 行為

為何不用 runtime JS 判別：主圖用 `<figure><img>` 或 `<p><img>` 包是 HTML5 慣例；icon 用 `<a><img></a>` 讓 icon 可點擊也是普遍設計。DOM 結構本身已提供語意區分，CSS selector 精準化（`img:not(a > img)`）即可涵蓋兩者，不需 img load 完成後算 naturalSize。

驗證：
- fixture `test/regression/fixtures/upmedia-icon-link-oversize.html` 擷取最小重現結構（`<div class="publish-img"><a><img id="toggleImg"></a></div>` + 內文 `<figure><img>`）
- 新增 2 條 forcing function spec（`styler.spec.js`）：(1) `a > img` 必須有獨立 rule、`max-width: 100%` 但絕不設 height（2）含 `height: auto` 的 img selector 必須帶 `:not(a > img)`，不得有 naked img
- Sanity check：把 styler 暫時改回 naked img selector，兩條 spec 如預期 fail
- Playwright harness 在 upmedia.mg `/tw/focus/politics/256168` 實測：三個 icon 從被放大的 276x60 / 250x250 / 147x32 回到原站尺寸 147x32 / 32x32 / 22x22；主新聞圖仍正確 shrink-fit 到 article 寬 608x405
- Dwarkesh / ChinaTalk Substack 等既有 baseline 站的主圖與 byline avatar 皆無 regression
- 110 spec 全過（108 + 2 新）

---

**v0.7.0**——視覺大改版：全站 Design System 落地（Jimmy 2026-04-22 多輪迭代）。工作分為四大塊：

**A. Popup UI refresh**（Jimmy 授權動 popup；jsdom spec 不受影響全數 pass）
- 套用 JRead Design System tokens（`--jr-primary-{50,600,700}` / `--jr-neutral-{50,100,300,500,700,900}` / `--jr-surface` / `--jr-font-ui,mono` / `--jr-radius-{sm,md}` / spacing 4-8-12-16-24）
- Header 加 logomark：28px 藍方塊 + 白色 serif J（Noto Serif TC/Georgia）+ 右側 mono 版本號
- 主題按鈕三顆 WYSIWYG：底色即該主題實際背景色（亮 #fff / 暗 #1a1a1a / 米 #f4ecd8），active 以 2px primary-600 outer ring 標示（**不**填充藍色、保留 WYSIWYG 語意）
- 字級 row：Auto 按鈕 + stepper 打包成 `.font-controls` 放 row 右側；Auto 按鈕 off=灰底灰字、on=藍底白字（一眼分得出）
- Stepper `.val` 從 `min-width: 42px` 改為**固定 `width: 56px`**：不論內容是 Auto / 18 / 840 / 1200 都同寬，兩條 stepper 左右邊緣 + 中央分隔線 100% 對齊
- 主題按鈕群寬度固定 110px = stepper 總寬：三 row 右邊緣（theme / font-controls / width-stepper）完美對齊
- Footer 重排：快速鍵提示與「進階設定 →」原本上下堆疊、改為同一 row（`.footer { flex; justify-content: space-between; align-items: baseline }`）；兩側字型字級完全一致（12px ui font weight 400）
- 拿掉「頁面設定」h2（使用者回報浪費空間）
- 拿掉 `.font-label-group`（label 放回 `.setting-row > label` 直接子層、字型字級與主題/版心寬度 row 一致）

**B. Options page refactor**（`jread/options/options.html`）
- 全面套 Design System tokens（與 popup 同步）
- 三個 form 控制項統一：`width: 140px; height: 32px`、number input 用 mono + tabular-nums + 右對齊、select 自製 SVG 下拉箭頭（取代作業系統預設大箭頭）
- Hover/Focus：neutral-500 邊框 → primary-600 邊框 + `0 0 0 3px primary-50` ring
- 新增「授權資訊」section（品牌藍 h2、ELv2 宣告、作者 Jimmy Su + Twitter @jimmy_su 連結）
- 字級 desc 加「**0 = 自動**」藍字強調；`<input type="number">` 的 `min="12"` 改為 `min="0"` 修 options 頁無法存 Auto（= 0 sentinel）的既有 bug

**C. 素材生產**（全由 Claude Design 設計 + Playwright 精確截圖）
- Icon family：`jread/assets/icons/icon-{16,32,48,128}.png`，比例 100% 對齊 popup logomark（radius 21.4% / font-size 64.3% / padding-right 7.1%）；`tools/generate-icons.js` 供日後重生
- Manifest 註冊 `icons` + `action.default_icon` 四尺寸齊備（工具列 / Extensions 管理頁 / Store listing 皆有對應）
- Landing page：`docs/index.html`（GitHub Pages 用；AdGuard 注入 script 已清除）
- Chrome Web Store promo：`store-assets/promo-440x280-{a,b}.png`（small promo tile 雙備選）+ `marquee-1400x560-{main,alt}.png`（marquee 雙備選）+ `icon-128-store.png`；四張 HTML source 備存於 `store-assets/sources/`；`tools/export-promo-tiles.js` 供日後重生
- `Claude design/` 原始下載資料夾加入 `.gitignore`

**D. 功能/修復**
- **預設快速鍵改為 `Alt+R`**（Mac 即 `Option+R`）：解掉 `Cmd+Shift+R` 撞 Chrome 強制重載導致 suggested_key 被 Chrome 忽略、安裝後 shortcut 欄位空白的長年問題。⚠️ Chrome 不會在 extension reload 時重套 suggested_key（只在**首次安裝**套用），既有使用者需到 `chrome://extensions/shortcuts` 手動指派一次；新安裝自動綁定
- **Icon family 擴充 + active/idle 切換**（由 Claude Design 設計，置換 Claude Code 用 Playwright 字體 rasterize 產的開發期草稿）：`jread/assets/icons/` 新增 disabled 灰階變體（16/32/48/128）+ 512 高解析 master；manifest `default_icon` 指向灰階版（待機狀態），content main.js 在 enter/exit reader mode 時發 `SET_ACTIVE_ICON` 訊息，SW 呼叫 `chrome.action.setIcon({tabId, path})` 切彩色；`tabs.onUpdated` status=loading 時重置為灰階，處理導航後的 per-tab icon state 殘留。新增 `NS.MSG.SET_ACTIVE_ICON` 常數；icon swap wire-up 走 PENDING_REGRESSION（chrome.action.setIcon / tabs.onUpdated 只能在真 extension 環境驗）
- **Link 色修復**（styler.js，Jimmy 授權動 styler）：dark/sepia 主題下 `[data-jread-active="1"] * { color: X !important }` 吞掉原站連結色、導致連結與正文同色無法辨識（Jimmy 在 Idée Fixe Substack 回報）。THEMES 表新增 `link` 欄位（dark `#7fb5e6` / sepia `#2c5282` / light `null`）；buildCss 在 `overrides.theme && theme.text` 分支加注入 `a / a * { color: theme.link !important }` + `a { text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px }`（**顏色 + 底線雙通道差異化**，照顧色盲/低對比環境）。**light theme 完全不變**（light.link 為 null、light.text 為 null → `overrides.theme && theme.text` 條件不觸發、不注入任何 a 規則、保留原站 link 色）。styler.spec dark/sepia 擴充 link 色 + underline 斷言；light 加 forcing function「不得注入任何 a 規則」守住 v0.6.0 baseline「link color 保留原站」精神；既有「CSS 不得套 a 下 rule」的 light baseline guard（line 457）保留
- 全專案 **「快捷鍵」→「快速鍵」**（SPEC / CHANGELOG-archive / PENDING_REGRESSION / service-worker.js 註解 / popup.js 使用者提示字 3 處）
- `LICENSE`（Elastic License 2.0 + Copyright 2026 Jimmy Su）rooted 並 mirror 進 `jread/` 讓「擴充功能目錄內的 LICENSE 檔案」敘述為真

108 spec 全過（styler theme spec 擴充 link 色斷言、未增 `it()` blocks）；`cleaner.js` / `detector.js` / `main.js` / `toast.js` 等 content-script 核心行為完全未動——v0.6.3 主文偵測 / 雜訊隱藏 baseline 零變動。

**v0.6.26**——refactor：cleaner.js 內部重構、行為零變化（Jimmy 2026-04-22 要求）。(1) `norm()` whitespace-normalize helper 從 `hideInsideArticleSidebarColumns` / `hideInsideArticleButtonClusters` 內重複宣告 2 處抽成 module 頂層 helper（`(s || '').replace(/\s+/g, ' ').trim()`），未來新規則直接 reuse。(2) 5 條 CONTAINER_SEL 規則（`hideInsideArticleByKeyword` / `hideInsideArticleActionRows` / `hideInsideArticleButtonClusters` / `hideInsideArticleEmptySpacers` / `hideInsideArticleSidebarColumns`）原本各自呼叫 `articleEl.querySelectorAll(CONTAINER_SEL)`——article 內 descendant 被重複掃 5 次。改為 `clean()` entry point 掃一次、把結果當可選 `containers` 參數傳給各規則；規則 signature 加可選參數 `containers`（未傳時 fallback 呼叫 querySelectorAll，向後相容單獨呼叫）。對大站點（如 Engadget 長文 + 廣告 div 多）的 DOM iterate 次數降到 1/5。(3) CHANGELOG.md 歸檔 v0.3.x–v0.5.x 共 10 條舊條目到新建 `CHANGELOG-archive.md`，主 CHANGELOG 只保留 v0.6.0 baseline 及之後的 v0.6.1–v0.6.26（共 27 條）——日常維護讀起來更精簡，歷史仍完整保存。108 spec 全過、零 regression、baseline 完整保留：所有 cleaner 規則的行為、執行順序、結果一致；只有內部實作細節變化。重構未動 styler.js / detector.js / popup / main.js / toast.js / service-worker.js。

**v0.6.25**——popup 新增「自動」字級選項（觸發情境：Jimmy 2026-04-22 發現 storage 殘留 16 的 fontSize 在 Medium 上看起來比原站 20px 小、但又不想每次切站手動調；且各站原 typography 字級差異大，單一 px 設定難以對每站都合適）。UX 設計：popup 的「字級」row 的 stepper 右側新增「自動」按鈕（active 狀態 = 藍色高亮）——點擊切換 `fontSize = 0`（sentinel）↔ `fontSize = 18`（DEFAULT）。`fontSize = 0` 語意為「Auto / 原站字級」、styler 不注入任何 font-size override、每站保留原 typography。使用者三種模式：(1) Auto = 完全保留各站字級、(2) 預設 18 = 不動原站（跟 Auto 行為相同但明確「手動選擇預設值」）、(3) 自訂 12~32 = 強制注入 px。從 Auto 按「+」直接跳到 DEFAULT 18、不需再按 Auto toggle；Auto 模式下「-」按鈕 disabled。styler 層關鍵修法：(a) `Number(s.fontSize) || DEFAULTS.fontSize` 會把 0 轉成 DEFAULT 失效 sentinel——改用 `Number.isFinite(rawFs) && rawFs >= 0 ? rawFs : DEFAULTS.fontSize` 保留 0；(b) `overrides.fontSize` 判斷加 `> 0` 保護：`opts.fontSize > 0 && opts.fontSize !== DEFAULTS.fontSize`——0 不視為「改過 DEFAULT」、不觸發 font-size/line-height 連帶注入。popup 層：`FONT_SIZE.auto = 0` 常數、`render()` 檢測 `isAuto` 顯示 "Auto" 字樣 + 「-」disabled + 「+」從 Auto 跳 DEFAULT + 「自動」按鈕 active 高亮。storage sync 舊資料（fontSize = 16/18/20 等 legacy number 值）自動相容——非 0 值走原有判斷、行為不變。新 styler.spec 1 條：fontSize = 0 時 CSS 不含 `font-size: Npx !important` 也不含 `line-height: N !important`（連帶注入也不觸發）。sanity check 走過——拿掉 `> 0` 保護時新 spec 正確 fail、既有「預設設定不注入」「非預設 fontSize 注入」等 baseline 斷言仍 pass（證明新條件是補丁非重寫）。108 spec 全過（原 107 + 新 1），v0.6.24 baseline 完整保留——baseline「預設值完全不動原站」精神不變，新增的 Auto 模式也遵守此精神（且更積極保留原站）。popup.js / popup.html 新增 UI 元件（「自動」button + CSS `.auto-btn.active` 樣式）。**未動 cleaner.js / detector.js**。

**v0.6.24**——修 Medium 文章頁使用者調整字級後行高不跟著變（觸發頁：medium.com/read-or-die-hq/1988-monochrome-dreams-...，Jimmy 2026-04-22 把 popup 字級從預設 18 調到 16、reader mode 下 p 字級確實變小但行距看起來不成比例過寬）。Jimmy 手動 DevTools Console probe 精確數據：`pInfo.fontSize = "16px"`（JRead override 生效）、`pInfo.lineHeight = "32px"` + `matchedRules` 顯示 Medium 原站 CSS `.pi { line-height: 32px }` / `.pc { line-height: 32px }`（20px 字級設計、ratio 1.6 倍）鎖死 p 行高；**JRead 注入的 CSS 完全沒出 line-height rule**——因為使用者只改 fontSize、沒改 lineHeight（預設 1.7），既有 `overrides.lineHeight` 分支沒觸發。根因：v0.6.0 baseline「預設值不注入」精神對 line-height 過度嚴格——字級跟行高是一對互相配合的 typography 屬性，使用者改了其中一個就必須連帶調整另一個，否則視覺比例失衡（32/16 = 2.0 過寬 vs 32/18 ≈ 1.78 接近合理）。修法（styler 層 user override 分支，Jimmy 授權動 styler）：`overrides.fontSize` 分支的 rule block 連帶注入 `line-height: ${opts.lineHeight} !important`（使用 opts.lineHeight 的當前值——使用者沒改 lineHeight 就是預設 1.7、有改就用使用者值）。line-height 用 unitless 相對值、隨字級自動縮放。獨立 `overrides.lineHeight` 分支條件改為 `if (overrides.lineHeight && !overrides.fontSize)` 避免同時改兩者時 rule 重複注入。v0.6.0 baseline 精神嚴格保留——使用者**完全沒改任何 override** 時 userOverrides 仍為空、DEFAULT 分支不走此路徑；只有使用者主動改字級才連帶動行高。styler.spec 新 2 條：(a) forcing function 「非預設 fontSize 必須連帶注入 line-height」——驗字級改過時 line-height rule 必須存在、含 body text descendant selector 穿透站點 class；(b) 非預設 fontSize + 非預設 lineHeight 時 line-height rule **只注入一次**（避免 CSS 重複 rule，用 `match(/line-height:/g).length === 1` 檢查）。sanity check 走過——disable 連帶注入時新斷言正確 fail、既有 `預設設定不注入`「非預設 lineHeight 注入」「descendant selector」「不得對 h1-h6 下 rule」等 baseline 斷言全部仍 pass（證明修法只擴展「fontSize 連帶」一個分支、未改動其他路徑）。107 spec 全過（原 105 + 新 2），v0.6.23 baseline 完整保留——button cluster / hr / sidebar / role=tooltip / grid collapse 等所有通則未動。**未動 cleaner.js / detector.js**，只 styler user override 分支行為擴展。通則覆蓋任何把行高以 px 硬鎖 + 字級設定不匹配的場景（Medium / Substack / 類 CMS 用固定 px typography 系統常見 pattern）。

**v0.6.23**——再修 Medium 文章頁主圖上方的那兩條橫線（觸發頁：medium.com/read-or-die-hq/1988-monochrome-dreams-...，Jimmy 2026-04-22 reload v0.6.22 後線又出現、回報「那兩條線又跑出來了」）。Jimmy 手動 DevTools Console probe 診斷每個 p/h/media 候選節點的祖先鏈與是否 wrappedByInteractive：關鍵發現 **clap count `<p class="bb b ec u eb">442</p>` 的祖先鏈中有 `<div class="bi" role="tooltip">`**（Medium clap count tooltip wrapper，同 Member-only 徽章的 role=tooltip pattern）——路徑上**沒有 button / a[href] / [role=button]**，現有 v0.6.21 path-check 將此 p 視為「真內文」→ action bar（container `v ct ks kt ...`）觸發「含內文」保護跳過、8px 上下 border 殘留兩條線回歸。根因追溯：v0.6.22 已把 `role="tooltip"` 加進 `DIALOG_SEL`，`hideDialogs` **成功 hide tooltip**（tooltip.dataset.jreadHidden = '1'）；但 `hideInsideArticleButtonClusters` 在 hideDialogs 之後跑、`querySelectorAll` 仍找到被 display:none 的 tooltip 內的 p——v0.6.21 path-check 只檢「interactive 祖先」不檢「已 hide 祖先」，這個 p 祖先鏈經過已 hide 的 tooltip 但沒經過 interactive，被誤視為真內文。兩條規則修法疊加後本該生效、卻因 path-check 邏輯不認識「已 hide 祖先也等於非內文」而連鎖失效。修法（cleaner 層結構性通則）：`hideInsideArticleButtonClusters` 的 path-check 擴展——沿祖先走時若遇到 `data-jread-hidden="1"` 標記的節點，等同 interactive 處理（視此 p 為「已處理、不算真內文」），繼續掃下一個候選；若掃完所有候選都有 interactive 或 hidden 祖先、才視為「純按鈕 cluster」命中 hide。邏輯設計：hideDialogs 先跑、標記 role=tooltip 與其他 UI chrome；button cluster 跑時信任前輪已標記結果——這是既有 cleaner 多階段規則的自然延伸（`hideAncestorSiblings` 也是在其他規則後跑、跳過已標記 hidden 的 sibling，同 pattern）。新 fixture 內嵌在 cleaner.spec inline HTML（無需新檔）：action-bar 含 clap-wrap + misc-wrap，clap-wrap 內包 `<div role="tooltip">` + `<p>442</p>` 重現真實 Medium clap count 結構；misc-wrap 內 3 個 button 各包 `<p>Listen/Share/More</p>` 維持 v0.6.21 pattern。新 it：(a) 前提斷言 tooltip 被 hideDialogs 先 hide、(b) 核心斷言 action bar 本體被 button cluster 命中 hide（path-check 新條件生效）、(c) 主文 MEDIUM_CLAP_BODY_MARK 保留、(d) 標題保留。sanity check 走過——disable 新「已 hide 祖先」條件時新 spec 正確 fail（action bar dataset.jreadHidden undefined）、既有 v0.6.21 Medium action bar spec（無 tooltip 結構）仍 pass（證明新條件是補丁非重寫）。105 spec 全過（原 104 + 新 1），v0.6.22 baseline 完整保留——button cluster 規則本體流程不動、只在 path-check while 迴圈內加一條 dataset 判斷。通則覆蓋「UI chrome 規則先命中、button cluster 後跑」的規則連鎖場景（適用於未來可能加入的其他 UI chrome ARIA roles 也能自動通過 path-check）。**未動 styler.js / detector.js**。

**v0.6.22**——修 Medium 文章頁閱讀模式下主文頂部殘留「✨ Member-only story」付費徽章（觸發頁：medium.com/read-or-die-hq/1988-monochrome-dreams-...，Jimmy 2026-04-22 截圖顯示標題上方有一個 inline-flex 雙 border 徽章、影響純閱讀體驗）。Jimmy 手動 DevTools Console probe 祖先鏈關鍵數據：leaf `<p class="bb b bc u eb">Member-only story</p>` → parent `<div class="hy j hz hp ia fa ak">` inline-flex 184x34 border-top/bottom 1px（badge 本體）→ parent `<div class="ba">` → **parent `<div class="bi" role="tooltip">` ← 外層 ARIA tooltip wrapper**。根因：Medium 用 ARIA `role="tooltip"` 包 Member-only 徽章，現有 cleaner 規則全漏網——(1) 徽章所有 class 都是混淆 hash（hy j hz hp ia / bi / ba 等），keyword heuristic 抓不到；(2) badge 文字極短（17 chars "Member-only story"）button count = 0，button cluster 規則不命中；(3) 不是 fixed/sticky、在 article 內、不是 ancestor-sibling、不含社群 link——outside/inside 所有規則都跳過。修法（cleaner 層結構性通則，ARIA 語意延伸）：`hideDialogs` 的 `DIALOG_SEL` 常數加入 `[role="tooltip"]`——ARIA 規範 W3C `role="tooltip"` 語意為「懸停/聚焦時顯示的輔助說明」純 UI chrome，依規範不應用於正文內容。既有 `dialog / alertdialog / aria-modal` 路徑同質延伸，`hideDialogs` 函式本體零變動，只擴展 selector。命中 Medium 徽章最外層 `<div class="bi" role="tooltip">`、整個徽章（含內層 svg + p + border wrapper）一次消失。baseline 安全驗證：grep 所有 fixture 零 role=tooltip（既有 businessweekly / stratechery / chinatalk / anthropic / ltn / engadget / dwarkesh / bbc / medium 類 fixture 皆無），零 regression 風險。新 fixture `medium-member-only-tooltip.html`（完整模擬 Medium 徽章祖先鏈 10 層：speechify-ignore → v cf → cm bd ... → cu v fa → bi role="tooltip" → ba → hy j hz hp ia fa ak → svg + `<p class="bb b bc u eb">Member-only story</p>`）+ cleaner.spec 1 條 `it`：(a) `role="tooltip"` wrapper 被 hide、(b) 標題「Monochrome Dreams」+ 副標 + 作者 meta（Retro Tech Show）+ 主圖 + 主文 MEDIUM_MEMBER_BODY_MARK 全部保留。sanity check 走過——還原 DIALOG_SEL 拿掉 `role="tooltip"` 時 spec 正確 fail、既有 `hideDialogs` 對 role="dialog" 的斷言仍 pass。其他站點風險評估：若有網站誤用 role=tooltip 包正文縮寫/術語說明（ARIA 允許但少見），reader mode 下損失僅輔助提示、主文完整——可接受取捨，符合「寧可多清不要留垃圾」的 reader mode 目標。104 spec 全過（原 103 + 新 1），v0.6.21 baseline 完整保留——button cluster / hr / sidebar / grid collapse / aspect-ratio / 字級 override 等所有通則未動。通則覆蓋任何把 badge / callout / 付費提示用 `role="tooltip"` ARIA 包裝的站點（Medium / Substack / modern CMS 常見 pattern）。**未動 styler.js / detector.js**。

**v0.6.21**——真正修 Medium 文章頁「照片上方兩條橫線」artifact（v0.6.20 誤判為 `<hr>` 後實機仍在，本輪追到真兇）。Jimmy 2026-04-22 在登入的 Chrome 手動用 DevTools Console probe 腳本抓到目標 DOM：單一 `<div class="v ct ks kt ku kv kw kx ky kz la lb lc ld le lf lg lh">` 高 8px、寬 640px、**同時** `border-top: 1px solid rgb(242,242,242)` + `border-bottom: 1px solid rgb(242,242,242)`——上下兩條 border 夾在 8px 薄容器上就是截圖看到的「兩條橫線」。進一步 probe 顯示容器內 `textContent = "44210ListenShareMore"`、含 7 個 `<button>`（clap / count 442 / count 10 / listen / Listen label / Share label / More label）、outside_text = 0——**本該被 v0.6.18/19 的 `hideInsideArticleButtonClusters` 命中 hide**，但實測 `has_p_or_heading = true`：Medium 把每個 button label 包成 `<p>Listen</p>` / `<p>Share</p>` / `<p>More</p>`，既有規則用 `querySelector('p, h1-h6, img, picture, video, iframe')` 遞迴查、找到 button 內部深層 p 誤觸發「含內文」保護、跳過整個 action bar。根因：保護條件的語義錯——意圖是「**非互動**後代中有真內文才保護」，但簡單 querySelector 不區分 p 是否在 interactive 內部。修法（cleaner 層結構性通則）：排除條件改為「**路徑判斷**」——對每個 p/h1-h6/media 候選節點，從自身往上走到 container，若**整條路徑都不經過 interactive 節點**（button / a[href] / [role=button]）才算真內文、觸發保護 continue；若路徑中有 interactive 祖先、代表這個 p 是 button label 類裝飾、忽略。實作復用 v0.6.19 的 `isInteractiveLeaf(node)` helper 判斷祖先是否 interactive。baseline 安全邊界：(1) BBC / Engadget fixture button 內沒 p→ 修法前後都不觸發保護、行為一致；(2) ChinaTalk post-header fixture `<h1>Title</h1>` 直接在 div 下（路徑上沒 interactive）→ 保護仍觸發跳過、標題不被誤殺；(3) 正文段落 wrapper `<div><p>body</p>...</div>` → p 在 interactive 外、保護觸發。新增 2 條 cleaner.spec：(a) Medium action bar fixture（button label 用 `<p>` 包）應被命中 hide + 標題 / 主文 MEDIUM_BODY_MARK 保留、(b) forcing function：正文 wrapper 含直接 p child + inline like/share buttons 不得被誤殺（p 在 interactive 外觸發保護）。sanity check 走過——還原保護條件為簡單 `querySelector` 時 Medium spec 正確 fail，正文 wrapper 保護斷言仍 pass（證明修法邏輯對、邊界清楚）。無法實機 harness 驗 Medium live 頁面（Member-only 登入牆），由 Jimmy 手動 probe 提供真實 DOM 數據、修法後 reload 視覺驗證兩條線消失。103 spec 全過（原 101 + 新 2），既有 v0.6.20 所有 baseline 通則完整保留——button cluster 規則本體路徑不動，只修「內文保護條件」的語義。通則覆蓋任何現代 CSS-in-JS 框架（styled-components / emotion）把 button inner content 用 semantic tag（p / span / 甚至 h5）包裹的站點（Medium / Substack / Ghost 常見 pattern）。**未動 styler.js / detector.js**。

**v0.6.20**——修 Medium 文章頁閱讀模式下主圖上方殘留兩條橫線（觸發頁：medium.com/read-or-die-hq/1988-monochrome-dreams-...，Jimmy 2026-04-22 截圖顯示 "11 min read · Apr 12, 2026" 作者 meta 下方到首圖之間有兩條明顯的淺灰橫線，影響閱讀美感）。harness probe 無法 replicate：Medium Member-only story 在未登入 profile 下直接擋主文 DOM（`__jread-style` 未注入、no `data-jread-active`）；freedium.cfd / 公開 mirror 也不可用——放棄 live probe，走「結構性通則推斷 + fixture 驗證 + baseline fixture 零含 hr = 零風險」路徑。推斷根因：Medium 類 CMS 在 post-header（member-tag / h1 / h2 / 作者 meta row）與 content（figure / p）之間慣性插入 1-2 條 `<hr>` 作分隔線——HTML5 `<hr>` 語意是「thematic break」，但 reader mode 卡片式排版下段落 margin 已提供足夠節段視覺，殘留 hr 變成冗餘橫線。CHANGELOG v0.6.7 已提到 Medium 類「border-top + border-bottom 夾圖示」artifact，那輪用 shell short-circuit 處理 action-bar footer；本輪 post-header 下方 hr 是另一個 pattern。修法（cleaner 層結構性通則，非 Medium 特判）：新增 `hideInsideArticleHorizontalRules`——`articleEl.querySelectorAll('hr')` 全部 hide。正文作者刻意插入的節段分隔 hr 一併清（reader mode 卡片間距已夠、損失極小）。零 regression 風險驗證：`grep "<hr" test/regression/fixtures/*.html` 全無匹配——baseline 所有 fixture（businessweekly / stratechery / chinatalk / anthropic / ltn / engadget / dwarkesh / bbc）皆無 hr。新 fixture `medium-post-header-hr.html`（模擬 Medium Member-only story 結構：member-tag + h1 + subtitle + post-meta + 2 條 post-header hr + figure + p + 正文中間 hr + p）+ cleaner.spec 1 條 `it`：(a) post-header 下方 2 條 hr 皆 hide、(b) 正文中間節段 hr 也 hide、(c) 主圖 figure 保留、(d) 主文內容 MEDIUM_BODY_MARK 可查到。sanity check 走過——disable hideInsideArticleHorizontalRules 呼叫時 hr spec 正確 fail。無法 harness 實機驗 Medium（登入牆），依賴 Jimmy reload v0.6.20 在他登入的 Chrome 上視覺確認——若兩條線都消失即修法正確；若仍有殘留表示為 `<div>` + `border-top` 而非 `<hr>`，需下一輪修 border 殘留。101 spec 全過（原 100 + 新 1），v0.6.19 baseline 完整保留——既有 button cluster / sidebar / grid collapse / aspect-ratio / 字級 override 等通則全部未動。**未動 styler.js / detector.js**。

**v0.6.19**——修 Engadget 文章頁閱讀模式下 byline 區塊殘留 "Add Engadget on Google" 連結 + chat bubble 按鈕（觸發頁：engadget.com/science/space/artemis-ii-commander-...，Jimmy 2026-04-22 截圖顯示 byline 右側兩個按鈕仍在主文內呈現）。harness probe 實測結構：cluster 3 direct children `[<div><a href="google.com/preferences">Add Engadget on Google</a></div>, <button aria-label="Share">, <button>(chat)</button>]`——關鍵發現是 **"Add Engadget on Google" 是純 `<a href>`，沒有 `<button>` tag、沒有 `role="button"`**（視覺上是按鈕但 DOM 是 link）。v0.6.18 的 interactive 定義（`button, a[role="button"], [role="button"]`）只算到 Share + chat 2 個 button，a 的 22 chars 文字被歸到 "button 外文字" → outsideText=22 > 10 閾值 → 跳過保留。根因：現代站點（Engadget / Wired / 類 Tailwind design system）把「視覺按鈕 link」做成純 `<a href>` + 按鈕 class（`rounded-full border px-4 py-2`），DOM 語意是 link 但實際是 CTA——舊 interactive 定義漏網。修法（cleaner 層結構性通則，non 站點特判）：(1) `hideInsideArticleButtonClusters` 的 interactive 定義從 `button, [role="button"]` 擴展到 `button, [role="button"], a[href]`；(2) 新增 `topInteractive` 過濾——若 interactive 節點祖先（在 cluster 內）也是 interactive，視為 nested 跳過——避免 `<a><button></button></a>` 結構文字被雙倍計到 outsideText 被壓成負值失去保護；(3) 新增保護「容器遞迴必須至少 1 個真 button / [role=button]」——排除純 a[href] link rail（3 條連結堆在 div 裡的相關閱讀導覽列），那類交給 ancestor-sibling / share cluster / keyword heuristic 處理。Helper 抽成 `isInteractiveLeaf(node)` 函式判斷 button / [role=button] / a[href]。新 2 條 cleaner.spec：(a) Engadget a+button 混合 cluster 命中 hide + 標題內文保留（fixture 3 direct children 都是 `<div class="wrap">` 包 a/button 讓 既有 action-row 排除條件 1 擋下、必須靠新 a[href] 擴展才能命中——sanity 驗這條走過）、(b) 純 a[href] link rail（3 條 a 無任何 button）不得被新規則命中——ChinaTalk meta-group 保護的延伸、forcing function 防 a[href] 擴展後誤傷導覽列。harness 實測 Engadget reader mode：標題「Artemis II commander shares a remarkable video of Earth vanishing behind the Moon」+ 副標 + 作者 Kris Holt + Mon, April 20, 2026 日期 + 主圖 + 內文全部保留，Add Engadget on Google 連結與 chat bubble 按鈕消失。100 spec 全過（原 98 + 新 2），v0.6.18 baseline 完整保留——既有 BBC byline cluster / ChinaTalk byline meta / 純 link rail 保護全部不變。通則覆蓋任何把 CTA 做成「`<a href>` 視覺按鈕 + 真 button 混合」的現代站點（Engadget / Wired / The Verge / 類 Tailwind design system 常見 pattern）。**未動 styler.js / detector.js**。

**v0.6.18**——修 BBC 文章頁閱讀模式下 byline 區塊殘留 "Share / Save / Add as preferred on Google" 按鈕組（觸發頁：bbc.com/news/articles/clyepyy82kxo，Jimmy 2026-04-22 截圖顯示標題下方 byline row 仍有 "Add as preferred on Google" 按鈕在文章頂部呈現，不應作為閱讀內容一部分顯示）。harness probe 實測 DOM 結構：`<article> > DIV.CzlrX(grid) > ... > DIV.jXywqM(grid, 3 children: [日期, button-cluster, 作者]) > DIV.cSUzvu(textLen=35, 3 buttons)`——3 個 button 每個都被 `<div display:contents><div><a><button>` 層層包起來。既有 `hideInsideArticleActionRows` 命中不了：cSUzvu 的 direct children 全是 div → interactive ratio = 0% → 觸發排除條件 1「ratio < 50% 且 selfText ≥ 20 字」→ `continue` 跳過。該排除條件是 v0.6.2 baseline 為保護 ChinaTalk byline+actions wrapper 不被整塊誤殺而設，**不能放寬**。修法（cleaner 層結構性通則，非站點特判）：新增獨立規則 `hideInsideArticleButtonClusters`（與既有 action-row 為 OR 關係、不動既有路徑）——container 需同時滿足 (1) normalize textLen ≤ 80、(2) 遞迴 `querySelectorAll('button, a[role="button"], [role="button"]').length >= 2`、(3) 無 `p / h1-h6 / img / picture / video / iframe`、(4) 不含 articleEl、(5) button 外文字量 ≤ 10 chars（`norm(textContent) - sum(norm(button.textContent))`）。條件 5 是關鍵保護：BBC cSUzvu 所有文字都在 button 內（Share/Save/Add），outsideText = 0 → 命中；ChinaTalk byline-actions-wrapper 的 meta-group 含 `<a>Jordan Schneider</a><span>Apr 21, 2026</span>` 作者+日期在 button 之外（outsideText ≈ 30），> 10 → 跳過保留。whitespace-normalize（replace `\s+` → 單一空白 + trim）確保 jsdom fixture（HTML 縮排含 `\n    `）與真實 Chrome innerText 量到同一個 textLen——與既有 sidebar column 規則一致。新 fixture `bbc-byline-button-cluster.html`（byline row 3 direct children：date-col / button-cluster / author-col，button-cluster 內 3 buttons 各包 display:contents div）+ cleaner.spec 2 條 `it`：(a) button-cluster 被 hide 同時 byline row / date / author 保留 + 主文 BODY_MARK 仍在、(b) 額外 forcing function 斷言「button 外文字 > 10 的混合 wrapper 不被誤殺」（inline fixture 模擬 ChinaTalk byline + button 混合 wrapper 路徑）。sanity check 走過——disable 新規則呼叫時 BBC 斷言正確 fail、既有 ChinaTalk baseline 斷言（外層 byline+actions wrapper 不被 action-row 整塊誤殺 + shell short-circuit 保護）仍全過。harness 實測 BBC reader mode：文章頂部「Should you really trust health advice from an AI chatbot?」標題 + 「3 days ago」日期 + 「James Gallagher / Inside Health presenter, BBC Radio 4」作者完整保留，Share/Save/Add as preferred on Google 按鈕組消失，主圖 + 內文正常顯示。98 spec 全過（原 96 + 新 2），**v0.6.17 baseline 全部保留**——既有 action-row / sidebar column / post-header 保護全部不動，新規則與既有路徑為 OR 關係互不干擾。通則覆蓋任何現代 CSS-in-JS（styled-components / emotion）把 button 用 `display: contents` 層層包 div 導致 direct interactive ratio = 0 的站點（BBC / Guardian / modern publisher 常見 pattern）。**未動 styler.js / detector.js**。

**v0.6.17**——修 Engadget 文章尾端塞一大段長空白（觸發頁：engadget.com/home/smart-home/dyson-pencilvac-fluffycones-review-...，Jimmy 2026-04-22 實機回報主文末段「just wish it were slightly more powerful」之後到 footer 之間有幾千 px 的純空白，閱讀體驗斷掉）。harness probe 實測：空白高度 5770px，由 `<aside class="hidden flex-none md:block col-right">`（Engadget 的右欄 sidebar）在 reader mode 下仍顯示撐出——aside textLen=858、rectH=5706px、是 grid container `grid-cols-1 ... md:grid-cols-[...]` 的 direct child（兄弟為 `div.md:col-main` textLen=7433）。為何既有 v0.6.8 `hideInsideArticleSidebarColumns` 條件 A（`textLen < main × 10% AND linkDensity > 0.5`）沒命中：aside textLen=858 剛好**超過** main×10%=743，linkDensity 僅 0.057（遠 < 0.5）——因為 aside 內塞了多個廣告 placeholder（`<div class="ad-placeholder">Advertisement</div>`）textLen 稀釋，+ Terms/Privacy/About 導覽 link 雖是 link 但整體 link 佔比被 placeholder 文字壓低。兩條件都差一點不滿足。根因：既有規則對「link-heavy sidebar」（Dwarkesh/Substack pattern）有效，對「ad-heavy sidebar」（Engadget/modern publisher pattern）漏網——但這類 aside 仍有結構性強訊號：**HTML5 `<aside>` 語意 tag + rectH 極大**。修法（cleaner 層結構性通則，非站點特判）：`hideInsideArticleSidebarColumns` 新增條件 B——container 內某 direct child 是 `<aside>` tag **且** textLen < main × 50% **且** `getBoundingClientRect().height > 400px` → 直接 hide。與條件 A 為 OR 關係（OR 追加，既有路徑完全不動）。閾值設計：50% textLen 上限排除「aside 誤包主文」的極端情境；400px rectH 下限排除 pull-quote aside（典型 blockquote + 2-3 行文字 rectH < 300px）——保留內文 aside。新常數 `SIDEBAR_ASIDE_TEXT_RATIO = 0.5` + `SIDEBAR_ASIDE_MIN_HEIGHT = 400`。新 fixture `engadget-aside-sidebar.html`（grid container 內 `col-main` 7000+ chars + `aside.col-right` 800 chars 含 ad-placeholder + footer links，對照 `aside-pullquote` 簡單 blockquote 結構）+ cleaner.spec 新 `it`：stub `aside-sidebar` rectH=5000 驗命中 hide、stub `aside-pullquote` rectH=200 驗保留、main-col 完好、pull-quote 內容 PULLQUOTE_MARK 可被 querySelector 到。sanity check 走過——disable 條件 B 時 aside-sidebar 未 hide 斷言正確 fail、pull-quote 保留斷言不受影響。harness 實測 Engadget reader mode：主文 "just wish it were slightly more powerful" 結尾後直接接 footer（Terms/Privacy Dashboard 由 ancestor-sibling rule 處理），5770px 長空白消失。96 spec 全過（既有 v0.6.8 Dwarkesh + v0.6.12/13 grid collapse + v0.6.14 aspect-ratio 等全部迴歸無 regress——條件 A 路徑未動）。通則覆蓋任何 modern publisher（Engadget / The Verge / Wired / modern WordPress 類 2-col layout）把右側 sidebar 用 `<aside>` tag + ad slot 做的站點。**未動 styler.js / detector.js**，v0.6.0 baseline 完整保留。

**v0.6.16**——修 BBC 新聞文章頁 reader mode 下「調整字級設定沒有效果」（觸發頁：bbc.com/news/articles/clyepyy82kxo，Jimmy 2026-04-22 實機回報 popup 按加減字級按鈕 p 文字大小完全不動）。harness probe 實測（set storage.sync fontSize=24 觸發 reader mode）：注入的 `__jread-style` **確實**含 `[data-jread-active="1"] { font-size: 24px !important; }`，article computed font-size = 24px；但 p computed font-size 仍 18px——原站 inline stylesheet rule `.HooNV { color: rgb(32,34,36); font-family: "BBC Reith Serif"...; font-size: 18px; line-height: 26px }` 直接鎖死在每個 `<p>` 身上，CSS inheritance 被子元素自己的 rule 截斷——article 層的 override 對 p 完全沒影響。根因：v0.6.0 baseline 的 user override selector 只作用於 `[${ARTICLE_ATTR}="1"]` 自己，假設 descendant 會 inherit——這在「原站不給 p 下 font-size rule」的情境成立（例如 Stratechery / ChinaTalk / anthropic），但 modern publisher（BBC / NYT / Guardian 等）普遍用 styled-components / CSS-in-JS 把 typography rule 直接鎖在每個文字元素的 class 上，article 層 override 打不穿 class specificity。修法（styler 層，Jimmy 授權動 styler）：user override 分支的 font-size / font-family / line-height 三條 rule 的 selector 擴展為 selector list——`[data-jread-active="1"], [data-jread-active="1"] p, ... li, ... blockquote, ... figcaption, ... dd, ... dt`。heading h1-h6 **刻意不含**（保留原站標題大小分級；使用者設的 px 若強套到所有 heading 會導致 h1=h2=h3 一樣大、更糟）。v0.6.0 baseline 精神「預設值不動原站」嚴格保留：DEFAULT 分支仍完全不走 userOverrides、不注入任何 rule，此修法只影響 non-default 分支（使用者主動改過設定）。既有 styler.spec「預設 fontSize 時不得注入 font-size」+「CSS 不得套 heading / p / ul / ol / li / blockquote / a 的排版 rule」（DEFAULT 下跑）兩條斷言仍過——baseline 檢查未變形。新 styler.spec 1 條 forcing function 斷言：non-default fontSize / fontFamily / lineHeight 三 property 的 rule 必須含 `p / li / blockquote / figcaption` descendant selector + 必不含 h1-h6（防未來改動把 selector 縮回 article-only 或把 heading 納入）。sanity check 走過——把 BODY_TEXT_SEL 縮回 article-only 時新斷言正確 fail。harness 實測 BBC reader mode fontSize=24：article/p 的 computed font-size 同步變 24px、文字實際變大；fontSize=18 預設值下（DEFAULT 分支）article/p 仍各自 16px/18px 不動原站。95 spec 全過，四站 baseline（Stratechery / ChinaTalk / anthropic / LTN）+ Engadget / Lawfare / 商周 / Dwarkesh 迴歸無 regress（DEFAULT 設定行為完全未變）。**未動 detector.js 與 cleaner.js**。通則覆蓋任何把 typography property 用 class rule 鎖在個別 body text 元素身上的站點（styled-components / CSS-in-JS / Tailwind `@apply` 等 modern CSS 架構常見 pattern）。

**v0.6.15**——修 BBC 新聞文章頁 reader mode 下版面「中間突然變窄」（觸發頁：bbc.com/news/articles/clyepyy82kxo，Jimmy 2026-04-22 實機回報前兩段正常全寬、從「But then in January」段開始文字被壓成約 50% 寬度、圖片也窄）。harness probe 實測兩條祖先鏈差異：正常段落的 `div.DQtHs` 已被 v0.6.12 collapseGridWithHiddenCell 命中（其 children 含 `grid-column: 19 / span 6` 的 hidden `bKjgsR`），collapse 成 block 全寬；但窄段落的 `div.DQtHs` 保持 `display: grid; grid-template-columns: repeat(24, 10px)` 24-col design system，**唯一 visible child** `gDQlgg` 用 `grid-column: 6 / span 12` 只佔中間 12/24 欄 → 寬度剩 container 48.7%。根因：BBC 用 24-column CSS grid 排版，某些段落 wrapper 預期「主文 12 欄 + 右側 N 欄放圖/廣告/引文」，某些段落原設計右側本來就沒東西——後者沒 hidden sibling、既有 `hasHiddenChild` 條件命中不了，grid 保留空白欄位壓擠主文。修法（cleaner 層結構性通則，非 BBC 特判）：擴展 `collapseGridWithHiddenCell` 新增條件 B「grid underfill」——`display: grid` 容器若 visible children 全在同一 row（`rect.top` 差異 < 5px）但寬度總和 < container × 70%，即退化成 block、清 grid-template、對 visible children 強制 `grid-column: auto / width: auto / max-width: none !important` 讓主文脫離 track 限制恢復全寬。邊界保護：(1) 僅對 grid 觸發不動 flex-row（後者沒被 template 鎖死是自然寬度流）；(2) `rect.width >= 100` 才處理（jsdom 無 layout engine 全 0 自動 skip、極窄容器排除雜訊）；(3) same-row 要求排除 2D grid（gallery 等 child 跨多 row sum < container 是正常的）。原條件 A（有 hidden sibling）維持 `children.length >= 2` 要求避免單 child container 無意義觸發；條件 B 允許 length >= 1。新 fixture `bbc-grid-underfill.html`（24-col grid child 只 span 12 / 對照非 grid wrapper 不動）+ cleaner.spec 2 條 `it`：(a) underfill container collapse + child grid-column force auto + restore 完整、(b) 單 child 寬度 ≈ container 不得誤 collapse（forcing function 防 70% 閾值被改壞）。stubRect 模擬真實 layout（container 608 / child 296）。sanity check 走過——disable underfill 條件時 BBC 斷言正確 fail、單 child 全寬斷言不受影響。harness 實測 BBC reader mode：全文（含 "But then in January"、"Chat GPT told me..."、"After sitting..." 段落）撐滿卡片 608px 版心、圖片 + figcaption 正常全寬顯示，中段變窄問題消失。94 spec 全過，四站 baseline（Stratechery / ChinaTalk / anthropic / LTN）+ Engadget / Lawfare / 商周 / Dwarkesh 全部迴歸無 regress。**未動 styler.js 與 detector.js**，v0.6.0 baseline 完整保留；通則覆蓋任何使用「N-column CSS grid design system + child `grid-column: M / span K` 但本頁未填滿」pattern 的新聞站（Guardian / BBC / NYT 等 modern publisher 常用）。

**v0.6.14**——修 Engadget 類純 `aspect-ratio` 容器的主圖在 reader mode 下完全消失（觸發頁：engadget.com/.../artemis-ii-commander-...，Jimmy 2026-04-22 實機回報 reader mode 進去主圖不見，只剩下方「NASA」caption）。harness probe 實測：文中 `<figure> > <div style="aspect-ratio: 1.7777...">` 原頁 computed `aspect-ratio: 1.77778 / 1` / `height: 421.875px`、進 reader mode 後 computed `aspect-ratio: auto` / `height: 0px`——`<img>` 仍絕對定位於 inset:0、自己 rectH=297，但 flow 父高為 0 所以**看得到是看不到**。根因：v0.5.x 留下的 styler rule `*:has(> img/picture/video) { padding-bottom: 0 !important; aspect-ratio: auto !important; }` 本意是破 Substack/Medium 的「padding-bottom: 56.25% placeholder」hack，但**誤傷 Engadget 類「純 `aspect-ratio: 16/9` + img absolute inset:0」模式**：後者 padding-bottom 本為 0、aspect-ratio 是容器撐高的唯一來源，被 reset 為 auto 後高度歸零。CSS `:has()` 無法查 computed padding-bottom 的百分比值、樣式層無從區分兩者。修法：styler 刪除該條 blanket rule；cleaner 新增 `resetMediaPlaceholderPadding` runtime 掃 article 內 `img/picture/video`，對 parent 做 padding-bottom/width 比例判斷（inline % > 20% 或 computed px ratio > 0.2）才視為 padding-hack，reset parent `padding-bottom: 0 !important` + 把 media 從 absolute 解放為 `position: static !important` + 清 top/left/right/bottom；純 aspect-ratio 容器完全不碰。restore 用 `hidden.__mediaResets` sidecar array 完整 revert 原 inline 值 + priority。新 fixture `engadget-aspect-ratio-image.html`（純 aspect-ratio pattern，進 reader mode 後斷言 padding-bottom 不帶 !important、img position 不被改成 static）+ `substack-padding-hack-image.html`（padding-bottom: 56.25% + absolute img，斷言 padding reset、img 變 static、top/left 被清）+ cleaner.spec 兩個 fixture 雙向驗證（reset 該做的做、不該做的不做、restore 完整還原到 inline style 字串層級）。styler.spec 原「CSS 含 aspect-ratio placeholder 破解」改成反向斷言「不得含該 blanket rule」作 forcing function 防 regress。sanity check 走過。harness 實測 Engadget 主圖完整顯示。通則覆蓋任何使用 `aspect-ratio` CSS property 維持媒體比例、內部 `<img>` absolute inset:0 填滿的站點（現代 CMS / 自刻 RWD 網站常見 pattern）。

**v0.6.13**——修 Lawfaremedia 類 Bootstrap layout 頁面在 reader mode 下主文仍被擠在卡片左半邊（觸發頁：lawfaremedia.org/article/china-s-agentic-ai-controversy，Jimmy 2026-04-22 實機回報 v0.6.12 修法對此站無效、內容還是偏左）。harness probe 實測：`.post-detail__content` 位於 article 卡片 x=516、width=365px；其 parent chain 為 `.post-detail__content(365) → .col-md-8(405) → .row(block, collapsed=1) → .container(608) → ARTICLE(720)`。**`.row` 確實被 v0.6.12 的 collapseGridWithHiddenCell collapse 了**（data-jread-collapsed="1"，display:block，flex-direction:column），但 **`.col-md-8` 身上的 Bootstrap utility class `flex: 0 0 66.67%; max-width: 66.67%` 仍生效**——row 從 flex 變 block 後，col-md-8 仍佔父 66.67% = 405px，主文被限制在左 2/3。根因：collapseGridWithHiddenCell 只改 container 的 display / grid-template，**沒清理 children 身上的 flex/width/max-width 限制**——Bootstrap / Tailwind utility class 定義的 column widths 獨立於 parent display，是 stylesheet rule 不受 parent display 改變影響。修法：在 collapse container 後，對 visible direct children（非 hidden 的）也強制 `flex-grow:0; flex-shrink:0; flex-basis:auto; width:auto; max-width:none; grid-column:auto` inline !important，讓 children 恢復 block 預設「撐滿父寬度」行為。restore 完整記錄 children 原 inline longhand + priority 並 revert。用 longhand property（非 shorthand）避免不同瀏覽器 / jsdom 的 serialization 差異。擴充 fixture `engadget-grid-sidebar-cell.html` 新增 Bootstrap row + col-md-8/col-md-4 情境 + cleaner.spec 新增 8 條斷言（row collapse、col-md-8 flex-basis/flex-grow/flex-shrink/max-width/width 被清、hidden child 不受影響、restore 完整 revert）。sanity check 走過。harness 實測 Lawfare reader mode 主文撐滿卡片、Engadget 迴歸無 regress。91 spec 全過。通則覆蓋 Bootstrap (`col-*`)、Tailwind (`col-span-*`, `w-*`)、任何 utility-first CSS framework 用 flex/grid utility 做分欄的站點。

**v0.6.12**——修 Engadget 類「主文 + 廣告側欄」CSS Grid layout 下 AdBlocker 清廣告後主文被擠成窄欄（觸發頁：engadget.com/.../artemis-ii-commander-...，Jimmy 2026-04-22 實機回報 reader mode 下內文只佔卡片左半邊、右半邊空白）。harness probe 實測：article 內 `<div style="display: grid; grid-template-columns: [main-start] 1fr [main-end right-start] 300px [right-end]">`——主文 1fr + 廣告 300px 兩欄。AdBlocker 清掉右欄廣告內容後、**grid cell 的 300px 寬度硬性保留**，reader card 縮到 608px 後主文只剩 196px、文字擠成窄欄。根因：原站用 CSS Grid 做多欄 layout 的「廣告側欄」本質上**不是 JRead cleaner 能偵測的「noise container」**（cleaner 只 hide content，不動 layout property）——grid-template-columns 的 track 定義獨立於內容，沒內容也佔空間。修法（cleaner 層結構性通則，非站點特判）：新增 `collapseGridWithHiddenCell`——進 reader mode 時掃 articleEl 內所有 `display: grid` / `display: flex; flex-direction: row` 的 container，若有 direct child 被 hide（`data-jread-hidden="1"` / `display:none` / `visibility:hidden`），給 container 加 inline `display: block !important; grid-template-columns: none !important; grid-template-rows: none !important; grid-template-areas: none !important` +（flex-row）`flex-direction: column !important` 退化成自然 block layout、主欄回到卡片自然寬度。edge case 處理：(1) intentional 多欄圖文 grid（無 hidden child）不觸發、保留；(2) 只處理 grid + flex-row、不動 flex-column / inline-flex；(3) `data-jread-collapsed` 標記追蹤、restore 完整 revert 原 inline style + priority。通則對付 Engadget / NYT / 任何用 CSS Grid 做「主文+廣告側欄」的新聞站。新 fixture `engadget-grid-sidebar-cell.html`（2-col grid 含 ad sidebar + 對照 intentional 2-col grid 無 hidden child）+ cleaner.spec 含 6 條斷言（右欄 ad 被 hide、grid collapse、inline display block + !important、grid-template-columns:none、主欄保留、intentional grid 不誤 collapse、restore 完整 revert）。sanity check 走過——collapse 呼叫註解時斷言正確 fail。harness 實測 Engadget reader mode：主文撐滿卡片寬度、正常行寬；Dwarkesh + 商周迴歸 reader mode 啟動正常。91 spec 全過。

**v0.6.11**——修商周文章底部「上一篇／下一篇」pager 條在滾動到底部後仍顯示（觸發頁：businessweekly.com.tw/Archive/Article?StrId=7014055，Jimmy 2026-04-22 實機回報 reader mode 下 scroll 後底部出現 `<  急催四輕加速更新案... | 從「比便宜」到「搶穩定」...  >` 文章導覽，這塊不該顯示）。interactive harness probe（Jimmy 配合手動操作）找到真正的元素：`<div class="postnav fixed">` + `<div class="postnav bottom">`，**兩個都已經被 cleaner 標了 `data-jread-hidden="1"`**，但 `.postnav.fixed` 的 inline style 卻是 `display: block`——證實商周的 scroll event handler 主動 `el.style.display = 'block'` 覆寫了我們設的 `display: none`。根因：cleaner.hide 只寫無 !important 的 inline `style.display = 'none'`，站點 JS 無 !important 的 inline 寫入會完全覆蓋（value 換掉 + priority 清空）——inline 對 inline 的 race 沒辦法用 inline !important 擋（`el.style.display = 'block'` 這種 setter 會整個 reset property，包括 priority）。實測方案：改 cleaner hide 用 `setProperty('display', 'none', 'important')` 在 jsdom + 真實 Chrome 都擋不住 JS 後續無 priority 的覆寫。真正可行的只有 stylesheet 層 !important：stylesheet `!important` > inline 無 priority 值（browser CSS cascade 層級勝出），站點 JS 再怎麼設 `style.display = 'block'` 也推不翻。修法（styler 層，Jimmy 授權動 styler）：styler 骨架 CSS 永遠注入 `[data-jread-hidden="1"] { display: none !important }` 一條 rule。通則非站點特判——對付任何站點 scroll / resize / timer handler 重設 hide 過元素 display 的情境。不動字體 / 字級 / 行高 / heading margin / list style 等 v0.6.0 baseline 保留的原站樣式，只補「hide 機制 vs 站點 JS race」漏洞。新 styler.spec 1 條斷言驗 CSS rule 存在。sanity check 走過——註解 rule 時斷言正確 fail。harness 實測商周 reader mode scroll 5 輪到底：`.postnav.fixed` 的 inline display 仍是 "block"（商周 JS 確實持續試圖 re-show），但 computed display = "none"，rect 0×0、畫面不可見——stylesheet !important 成功攔下。90 spec 全過，四站 baseline + v0.6.8/0.6.9/0.6.10 迴歸無 regress。

**v0.6.10**——修商周文章頁頂部封面圖在 reader mode 下被壓成 31px 寬幾乎看不見（觸發頁：businessweekly.com.tw/Archive/Article?StrId=7014055，Jimmy 2026-04-21 實機回報封面圖 + figcaption 都變窄條）。harness probe 實測：reader mode 下 `figure.articlephoto` computed width=31px、`img` 30.98×17.5px、`figcaption` 31×133px（中文每字一行豎排）；原頁面則 figure 800px、img 800×452px、figcaption 800×43px 橫一行。根因：商周原站某條 CSS 給 `figure.articlephoto` 顯式 width（如 `width: 800px`），但 reader mode 下我們動了 ancestor reset / body layout → 該 rule selector 不再匹配 → figure 失去顯式寬度、退化成 shrink-to-fit + `min-width:0`，與 figcaption 中文單字寬度互相 lock 死成 ~31px。不是 HTML `width` attribute、inline style、`float`、`display:inline-block` 的問題（全部 probe 排除）。修法（styler 層，Jimmy 授權動 styler）：新增 `[data-jread-active="1"] figure, [data-jread-active="1"] picture { width: auto !important; max-width: 100% !important }` 一條通則——明示媒體容器為 block 預設寬度（100% of parent），不依賴原站殘留 CSS 給 figure 定寬。picture 同理避免類似退化。只處理「媒體容器寬度退化」一件事，不碰字體/字級/行高/heading margin/list style 等 v0.6.0 baseline 保留的原站樣式。新 styler.spec 1 條斷言（figure rule 含 width:auto + max-width:100% + picture selector 存在）。sanity check 走過——註解 rule 時斷言正確 fail。harness 實測商周 reader mode：封面圖（globe + oil barrels 全球化主題圖）撐滿 608px 版心寬度、figcaption「(來源・設計●廖洲文)」橫一行正常顯示、主內文流暢。89 spec 全過，四站 baseline + v0.6.8 Dwarkesh + v0.6.9 discussion keyword 迴歸無 regress。v0.6.0 baseline「保留原站字體排版」精神完整保留，本次只補媒體容器寬度退化。

**v0.6.9**——修 Dwarkesh / Substack 類頁面主文結尾後留言區塊沒被清掉（觸發頁：dwarkesh.com/p/jensen-huang，Jimmy 2026-04-21 實機回報 JRead 在「Me too.」對話結尾後多出 "Discussion about this video" heading + 留言表單 + 留言列表 + "Ready for more?" subscribe CTA，Unclutter 則剛好切在「Me too.」結尾）。harness probe 實測確認：`#discussion` + `#comments-for-scroll` + `.comments-page` + `.comment-list-items` 都是主文 `main-content-qKkUCg > postContentWrapper` 內的後代，躲過 outside / fixed / ancestor 規則；"Ready for more?" subscribe CTA 在 article 外但已被 `hideAncestorSiblings` 清掉。根因：cleaner 的 `NOISE_KEYWORD_RE` 雖有 `share / social / paywall / subscribe` 等跨站慣例，但**沒有留言區 anchor 慣例**。修法（結構性通則，非站點特判）：擴展 `NOISE_KEYWORD_RE` 加入 `comment | comments | discussion | disqus` 四個跨 CMS 留言區 anchor 命名慣例——Substack `#discussion`、WordPress `.comments-page`、Ghost `#comments`、Disqus `#disqus_thread` 皆屬此類，與現有 `share / social` 同性質。regex 單字邊界保護（`(^|[^a-z0-9])(kw)([^a-z0-9]|$)`）避免誤殺 commented / discussing 等文字。新 fixture `substack-discussion-comments.html`（主文末「Me too.」+ 完整 #discussion 結構 + 留言表單 + 2 個 .comment）+ cleaner.spec 3 條斷言（#discussion 必 hide / 主文 LAST_MAINTEXT_MARK 必保留 / 留言祖先鏈至少一個 hidden）。sanity check 走過——移掉 keyword 時 #discussion 未 hide 斷言正確 fail、keyword 存在時 LAST_MAINTEXT_MARK 保留斷言不受影響。harness 實測 Dwarkesh reader mode scroll 至「Me too.」結尾——畫面乾淨結束，沒有 Discussion heading / 留言表單 / 留言列表 / Ready-for-more CTA，卡片邊界切在主文結尾，與 Unclutter 視覺一致。88 spec 全過，四站 baseline（Stratechery / ChinaTalk / anthropic / LTN）+ v0.6.8 Dwarkesh 迴歸無 regress。**未動 styler.js 與 detector.js**，v0.6.0 baseline 完整保留。

**v0.6.8**——修兩個 Dwarkesh (Substack podcast-post) 類頁面問題（觸發頁：dwarkesh.com/p/jensen-huang，Jimmy 2026-04-21 實機回報右欄 sidebar 未隱藏 + YouTube embed 消失）。**bug 1：右欄 sidebar 沒隱藏**——根因 Substack 把 `<article>` tag 包住整個 `main-content-and-sidebar` 2-col flex layout，sidebar（Listen on / Recent Episodes / Dwarkesh Podcast 卡片）身為 article 後代躲過 `hideOutsideArticleSemantic` / `hideFixedOutsideArticle` / `hideAncestorSiblings` / `hideInsideArticleByKeyword` 全部規則。harness probe 實測兩欄結構差異極明顯：主欄文字 2212 chars、linkDensity 0.013；sidebar 文字 155 chars、linkDensity 0.67（文字相差 14x、連結密度相差 23x）。修法（cleaner 層結構性通則，非站點特判）：新增 `hideInsideArticleSidebarColumns`——articleEl 內任一容器的 direct children 中，若某 child 文字量 < 主欄 10% 且 linkDensity > 0.5、主欄 ≥ 500 字才觸發（避免短文 / header row 誤判）→ 視為 sidebar column 隱藏。whitespace-normalized textContent 確保 jsdom 與真實 Chrome innerText 量到同一個字數。不改 detector（若 narrow articleEl 會剝掉 video/audio 容器等非 sidebar 的兄弟）。**bug 2：YouTube iframe 被錯殺**——根因 cross-origin iframe 的 textContent 空（跨域讀不到內部 DOM）+ querySelector 讀不到內部媒體 + rect.height > 60px → 三條 `hideInsideArticleEmptySpacers` 條件全命中、被當空殼 hide。`hideInsideArticleActionRows` 也有同樣風險（iconCount 剛好 = 0 擋下是幸運的 side-effect 不是設計）。修法（結構性通則）：兩條規則對 `iframe` / `video` / `audio` tag 本身 early-skip——媒體元素本身是內容不是容器，絕不能當 spacer / action-row 候選。新 fixture `dwarkesh-substack-sidebar-column.html`（2-col sidebar 主命中 + 單欄不觸發對照）+ `dwarkesh-youtube-embed.html`（iframe 被 stub rect 600px 高，沒 early-skip 會被錯殺） + cleaner.spec 3 條斷言（sidebar column 必 hide / 主欄文字 < 500 不觸發 / iframe 永不被誤殺）。sanity check 走過——sidebar 規則註解時主斷言正確 fail、early-skip 註解時 iframe 斷言正確 fail。harness 實測 Dwarkesh reader mode 下：右欄 sidebar 完全消失 + YouTube 縮圖（Jensen Huang 訪談影片封面）正常顯示 + 主文連貫無空白。87 spec 全過，四站 baseline（Stratechery / ChinaTalk / anthropic / LTN）迴歸無 regress。**未動 styler.js 與 detector.js**，v0.6.0 baseline + v0.6.5 narrow + v0.6.6 observer + v0.6.7 shell short-circuit 完整保留。

**v0.6.7**——修 Medium 類版型閱讀模式下「兩條橫線夾空圖示殼」artifact（觸發頁：medium.com/ddsakura-blog/...claude 幫 side project 產出功能說明文件）。症狀：標題 + 作者列下方出現兩條橫線，中間夾一個小圖示（Jimmy 實機看到 "10" clap count、Playwright 未登入看到 chevron svg；同個 artifact 兩種呈現）。probe 實測確認是 Medium 的 clap/comment/bookmark/more action-bar 外層 shell：`<div class="v ct lc...">`（obfuscated class）帶 `border-top: 1px solid` + `border-bottom: 1px solid`、textContent 幾乎空、deep 含 2 button + 4 svg；**direct children 是 4 個 wrapper div（0% interactive）**——命中 v0.6.2「直接子互動比例 < 50% 則跳過」排除（該排除原為保 ChinaTalk byline+actions wrapper 加的），導致空殼沒被 hide、border 線條 + 漏出的小圖示殘留於版面。根因：v0.6.2 的 ratio 排除對「有文字的 byline wrapper」與「沒文字的空殼」一視同仁，沒區分 shell 與 content wrapper。修法為結構性通則（非站點特判）：action-row 規則在 ratio < 50% 時加 escape hatch——若容器自身 textContent ≥ 20 chars 仍跳過（保留 byline 類）、若 < 20 chars 則放行後面 iconCount/textLen 檢查（空殼繼續 hide）。ChinaTalk byline wrapper textContent「Jordan Schneider · Apr 21, 2026」~30 chars → 保留；Medium outer shell textContent 空 → hide。新 fixture `medium-action-bar-shell.html`（Medium 類空殼 + ChinaTalk 類 byline 對照） + cleaner.spec 2 條斷言（Medium shell 必 hide / ChinaTalk byline 不誤殺且 meta 文字保留 + 內層 btn-group 仍 hide）。sanity check 走過——拿掉 short-circuit 時 shell hide 斷言正確 fail、byline 保留斷言不受影響。harness 實測 Medium reader mode 下標題 → 作者 → 圖片 → 內文連貫、兩條橫線 shell 消失。四站迴歸（Stratechery / ChinaTalk / anthropic / LTN）主文 preview 一致無 regress。**未動 styler.js 與 detector.js**，v0.6.0 baseline + v0.6.5 narrow + v0.6.6 observer 完整保留。

**v0.6.6**——補 v0.6.5 的缺口：自由時報類 infinite-scroll 站點進入 reader mode 後捲動到第一篇結尾時，第二篇、第三篇仍會「跑」出來（Jimmy 2026-04-21 實機回報）。根因：v0.6.5 的 detector narrow 只處理初始 DOM snapshot，cleaner.clean() 是 one-shot 也只 hide 當下存在的節點。捲動時 popIn Discovery 從 section.content940 裡被 cleaner hide 過的 `.whitecon.article.template` clone 出新篇 → append 到 content940 → 設 `display: block` 顯示。新節點帶 `data-jread-hidden="1"` 繼承（cleaner.hide 的 early-return 會 skip）、display 被 popIn 主動覆寫——傳統 hide 機制攔不到。probe 實測 reader mode 下緩慢捲動 15 次，parent.children 41 → 65（+24 個 dynamic append，含 2 個新 `.whitecon.article`）。修法（cleaner 層結構性通則）：cleaner.clean() 結束時啟動 MutationObserver 觀察**主文祖先鏈上每一層 parent** 的 childList（articleEl.parentElement → ... → body，不含主文後代），新 addedNodes（非主文相關、非 structural tag、非保留元素）直接 `removeChild` 從 DOM 移除。cleaner.restore() 時 disconnect observer；dynamic 節點不還原（使用者退出 reader mode 重捲會觸發 site 自己的 lazy-load 邏輯重新 inject）。通則適用於任何 infinite-scroll / lazy-load / 動態廣告 inject 站點——非站點特判、非 popIn 特判。**為何 remove 而非 hide**：(1) popIn 從被 hide 的 template clone 帶來舊 dataset.jreadHidden，hide() early-return 會 skip；(2) popIn 之後會主動設 display:block 覆蓋任何 inline display:none；(3) 直接 remove 不跟 popIn 搶 style property、狀態管理最簡。spec 新增 4 條斷言（主文 parent 新 append remove / 祖先鏈外層新 append remove / 主文內部 append 不受影響 / restore 後 observer disconnect 新 append 保留），sanity check 走過——disable observer 時 2 條核心斷言正確 fail。harness 實測 LTN 捲動 15 次後 parent.children 41 → 41（**0 個新 append 存活**），原本 24 個全被攔下。三站 baseline（Stratechery / ChinaTalk / anthropic）主文 preview 一致、無 regress——MutationObserver 只觀察祖先鏈、不改主文內部，單篇文章站點跟以前完全一樣。**未動 styler.js 與 detector.js**，v0.6.0 baseline 保留、v0.6.5 narrow 邏輯保留（initial snapshot 由 narrow 處理、dynamic append 由 observer 處理，各司其職）。

**v0.6.5**——修自由時報 news.ltn.com.tw 類 infinite-scroll 站點在閱讀模式下會把「第一篇 + 第二篇 + 第三篇 + ...」全部混入主文的 bug（觸發頁：`/news/world/breakingnews/5410861`）。根因：LTN 把多篇新聞塞進同一個 `<section class="content940">`，每篇是一個 `.whitecon.article` 直系子（非 `<article>` tag），前端 popIn Discovery 再 scroll 時 append 下一篇。detector heuristic bubble-up 因 section 是所有 p 的 grandparent、拿到最高累積分，選中 section 作主文——讀者閱讀模式下看到第一篇 + 第二篇 + 第三篇的標題與內文混雜。修法為結構性通則（非站點特判）：detect() 出口對選中的容器做 `narrowToFirstArticleBlock`——若容器的直系子中有 ≥ 2 個獨立子樹各含 h1，認定為「多篇 article 兄弟」結構，限縮到第一個含 h1 的直系子（h1 每頁慣例唯一；多 h1 兄弟即為 multi-article 特徵）。單篇文章（0 或 1 個 h1）不動。放在 `promoteForTitle` 之後：promote 往外升級包住標題，narrow 往內收縮到第一篇，兩者方向相反、能處理「promote 結果含多篇」的邊界情況。新 fixture `ltn-multi-article-siblings.html`（3 個 `.whitecon.article` 兄弟在 section.content-list 裡、長度刻意相近觸發 bubble-up 選中 section）+ detector.spec 5 條斷言（偵測成功 / 主文含第一篇 FIRST_BODY_MARK / 主文絕不含第二篇 NEXT_ARTICLE_MARK 與 NEXT_BODY_MARK / 主文 class 為 `first-article` 而非 `content-list` / 主文只剩 1 個 h1），sanity check 走過——還原 narrow 時 3 條斷言正確 fail、確認 detect 選到 section.content-list（3 個 h1）。harness 實測 LTN 閱讀模式主文 preview 為「航跡圖曝！又1艘伊朗貨輪通過荷姆茲海峽...」（第一篇標題），視覺截圖顯示只有第一篇內容、無後續篇混入。迴歸三站 baseline（Stratechery / ChinaTalk / anthropic）無 regress——narrow 對單 h1 容器 no-op、對 h2-主-heading 站點（Stratechery）不 fire。使用者訴求「阻斷後續載入」：probe 實測 reader mode 下 scroll 到底 infinite scroll 幾乎不 fire（sentinel 元素被 cleaner 的祖先隱藏），自然滿足，未採激進方案（body overflow hidden / 主世界注入）。**styler.js 仍未動，v0.6.0 baseline 完整保留**。

**v0.6.4**——修 WordPress wp-embed / Substack / Medium 類 YouTube 嵌入在閱讀模式下影片被壓扁成 150px 高的 bug（觸發頁：Stratechery `/2026/please-listen-to-my-podcast/`）。根因：styler 對 `img / video / iframe / picture` 共用一條 `{ max-width: 100% !important; height: auto !important; }`——`<img>` 有 intrinsic 尺寸、`height: auto` 能按比例算，但 `<iframe>` **沒有 intrinsic content size**，HTML spec 下 `height: auto` 會掉回瀏覽器預設的 150px，打壞原站「wrapper 維 16:9（padding-top hack 或 aspect-ratio property） + iframe position:absolute 填滿」的 responsive 影片模式。probe 實測 Stratechery YouTube：wrapper 在閱讀模式下仍保持 608×342（16:9，WP aspect-ratio CSS 沒被破壞），但 iframe 被壓成 608×150。修法（styler 層最小破壞通則）：把 iframe 從共用 rule 拆出來，單獨一條只 cap `max-width: 100%`、不設 `height`——讓原站 CSS 的 `height: 100%` 能繼續生效、填滿 wrapper。`img / video / picture` rule 不動（這三者有 intrinsic 尺寸）。styler.spec 新增 2 條斷言（「iframe 有獨立 rule：max-width + 絕不設 height」「iframe 不得出現在含 height:auto rule 的 selector list」；前者若 iframe 被塞回共用 block 會 fail，後者若有人新增含 iframe 的 height:auto rule 會 fail），sanity check 走過——還原修法時兩條都 fail。harness 迴歸三站（Stratechery YouTube 頁 iframe 608×342 正確、ChinaTalk quantum-101 文章無 regress、anthropic.com engineering/desktop-extensions gap 正常）。**這是 v0.6.0 baseline 以來首次動 styler.js**，依 `feedback_preserve_v060_baseline` 規則經 Jimmy 明確授權（detector / cleaner 層無法解：detector 選主文、cleaner 清雜訊都跟 iframe 尺寸無關——bug 本身在 styler 那條 CSS rule 對 iframe 用錯公式）。新 rule 只解 iframe 特例，未覆寫 font / heading / p / list / link / blockquote 任一項。

**v0.6.3**——修 anthropic.com engineering blog 類站點標題遺失。根因：頁面有 `<article>` 但文章 `<h1 class="headline-1">` 放在 `<section class="hero">` 裡，section 是 article 的兄弟。detector 策略 1（article-tag）直接選中 article，v0.5.1 起的 title promote 僅作用於 heuristic 策略——article-tag 結果不做 promote——hideAncestorSiblings 把 hero section 當 chrome 清掉，標題隨之消失。修法（detector 層通則）：把 title promote 從 heuristic-only 擴展到 detect() 出口統一處理，對 article-tag / schema-org / heuristic 所有非兜底策略結果都套 promoteForTitle（main-tag 兜底已是最外層、不做 promote 避免無止盡向上擴散）。新 fixture `anthropic-hero-sibling.html` + detector.spec 5 條斷言（偵測成功 / 策略起點是 article-tag / 主文容器被 promote 到 `<main>` / 含標題 h1 / 含內文），sanity check 走過。harness 驗證：anthropic.com/engineering/advanced-tool-use 標題「Introducing advanced tool use on the Claude Developer Platform」回來，含 category「Engineering at Anthropic」+ 「Published Nov 24, 2025」+ 副標；Stratechery 迴歸無 regress；71 測試全過。**styler.js 仍未動，v0.6.0 baseline 完整保留**（依 memory `feedback_preserve_v060_baseline` 規則：edge case 走 detector 層，不碰 styler）。

**v0.6.2**——修 ChinaTalk / Substack 類站點作者 + 日期遺失。根因：v0.6.1 修好標題後發現作者 / 日期仍然被隱藏——被 post-header **下一個** wrapper 容器連帶 hide（Substack 結構：`<div>` 包 `<div.meta-group>Author · Date</div>` + `<div.btn-group>button button button</div>` 兩個 sub-div）。外層 wrapper 自身 textLen=52、iconCount=9、無 p/h/media，命中 action-row 四條件被整塊 hide，作者 div 藉 display:none ancestor 繼承跟著消失。修法為結構性通則（非站點特判）：**action row 本質是多個互動元素排成一列，直接子中互動元素（button / [role=button] / svg）比例必須 ≥ 50%**，否則視為「內容 wrapper」不 hide。外層 wrapper 直接子是 2 個 DIV（0% 互動）→ 不 hide；內層 btn-group 直接子多為 button（≥ 50%）→ 仍正確 hide；商周 fixture 的 xp-1a2b3c 純 buttons（80%）→ 仍正確 hide。cleaner.spec 新增一條三段式斷言（wrapper 不得 hide / meta group 不得 hide / btn-group 仍須 hide），sanity check 走過。harness 在 ChinaTalk quantum-101 驗證作者「JORDAN SCHNEIDER AND PHOEBE CHOW」+ 日期「APR 21, 2026」回來；Stratechery 迴歸無 regress。**styler.js 仍未動，v0.6.0 baseline 完整保留**。

**v0.6.1**——修 ChinaTalk / Substack 類站點閱讀模式下文章標題遺失。根因：`cleaner.hideInsideArticleActionRows` 的 action-row 規則原本只排除「含 `<p>` 直接子」「含媒體」兩類容器，漏了「含 `<h1>-<h6>` 直接子」。Substack 的 `div.post-header` 同時包 `<h1 post-title>` + 作者/日期 meta + 多個 like/comment/share/more button，剛好命中 action-row 的「無 p、無媒體、短文字、多 icon」四條件——被整塊 hide，標題與作者隨之消失。修法為結構性通則（非站點特判）：action row 本質上是圖示互動列，絕不會包含文章 heading（h1-h6 是內容元素）；因此若容器含 h1-h6 直接子即跳過 action-row 判定。cleaner.spec 新增一條斷言（post-header 不得被 action-row 規則隱藏、其內 h1 不得被隱藏）+ 擴充 businessweekly fixture 加入 `div.post-header` 模擬（h1.post-title + 作者/日期 span + like/comment/share/more buttons），sanity check 走過。harness 在 ChinaTalk quantum-101 驗證標題回來、Stratechery 迴歸驗證無 regress。**styler.js 未動，v0.6.0 baseline 完整保留**。

**v0.6.0**——styler 瘦身重構（c 路線：「盡量貼近原站」）。v0.5.x 的 styler 有 ~80 條 `!important` CSS rule 互相疊加，預設態會覆寫原站的 heading margin / p margin / list style / font-family / font-size / line-height / link color / blockquote border 等，結果在 Stratechery 類站點造成「category 與 title 間距過大」「條列項樣式跑掉」「行距不正確」等視覺問題（見 2026-04-21 Stratechery 截圖）。本次把 styler 砍剩約 10 條骨架 rule：(1) 永遠注入—— html/body reset、祖先鏈 reset、讀者卡片容器（max-width/padding/background/border-radius/box-shadow）、第一子 margin-top:0、圖片 max-width 限制、aspect-ratio placeholder 破解；(2) 使用者 override——僅在 theme/fontSize/fontFamily/lineHeight 「不等於預設值」時才注入對應 CSS。預設態（light / 18px / system-ui / 1.7）＝原站字體排版 + 讀者卡片容器。移除 v0.5.2 的 structural-link 標記機制（既然不套 link 色就不需要 heading 包 a / parent-only-text a 特判）。styler.spec 從 26 條收到 27 條（砍掉 13 條 CSS 細節斷言 + 移除 5 條 structural-link 斷言，新增 10 條 override 行為斷言）。harness 在 Stratechery、ChinaTalk/Substack 兩站驗過：category 緊貼 title、條列項縮排正常、真 inline link 保留原站藍色連結樣式、對話訪談格式的粗體 / 斜體 / 段落間距全部保留。版本 bump minor（0.5 → 0.6）標示 styler 語意介面縮減（不再覆寫內文排版）。


舊版本歷程（v0.3.x – v0.5.x）已歸檔至 `CHANGELOG-archive.md`。
