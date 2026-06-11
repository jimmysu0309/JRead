# Noise Keyword 業界對標研究

> 建檔於 v0.7.85；對標來源與「不可採用」結論至今有效。
> 此檔記錄 JRead 的 `NOISE_KEYWORD_RE` / `STRONG_NOISE_KEYWORD_RE` / `AD_BOUNDARY_RE` / `AD_SUFFIX_RE` 對標的開源專案與研究結論。
> v0.8.18 C4 起，NOISE / STRONG 兩個 regex 改由 `jread/content/cleaner.js` 的單一 token 名單 `NOISE_TOKEN_DEFS`（`{ t, strong? }`）衍生，結構上不再可能 drift；新增 keyword 改動 `NOISE_TOKEN_DEFS`，動手前先讀本檔，避免重複研究 / 採用過已知會誤殺的 token。

---

## 對標來源（按優先級）

1. **Mozilla Readability.js**
   - https://github.com/mozilla/readability/blob/main/Readability.js
   - REGEXPS: `unlikelyCandidates` / `okMaybeItsACandidate` / `negative` / `positive` / `byline` / `shareElements` / `videos`
   - = arc90/readability 同源，是業界 reader-mode 演算法的基礎
2. **Postlight Parser**（Mercury 後身）
   - `src/extractors/generic/content/scoring/constants.js` 的 `UNLIKELY_CANDIDATES_BLACKLIST` / `NEGATIVE_SCORE_HINTS`
3. **Unclutter**（lindylearn/unclutter — 我們 clone 的目標）
   - `apps/unclutter/source/content-script/modifications/contentBlock.ts`
4. **EasyList element-hiding cosmetic filters**
   - https://easylist.to/easylist/easylist_general_hide.txt
5. **uBlock Origin uAssets**
   - filters/annoyances-others.txt
6. **dom-distiller (Chromium)**
   - heuristics/distillable/extract_features.js（與 Readability 子集，貢獻有限）
7. Safari Reader（無 source）/ Pocket / Instapaper / Matter / Readwise Reader（無公開 noise list）

---

## 已採用 token 出處

| Token | 對應 regex | 來源 |
|---|---|---|
| ai2html | NOISE_KEYWORD_RE | Mozilla Readability unlikelyCandidates |
| sharedaddy | NOISE_KEYWORD_RE / STRONG | Mozilla Readability shareElements |
| addthis | NOISE_KEYWORD_RE / STRONG | Postlight + Unclutter |
| dianomi | NOISE_KEYWORD_RE / STRONG | Unclutter |
| disqus | NOISE_KEYWORD_RE / STRONG | Mozilla + Postlight + 自蒐 |
| outbrain | NOISE_KEYWORD_RE / STRONG | Mozilla + 自蒐 |
| taboola | NOISE_KEYWORD_RE / STRONG | 自蒐 + Postlight |
| adsense / adslot / adbox / advert / adhesion | NOISE_KEYWORD_RE | EasyList |
| metered / interstitial / takeover | NOISE_KEYWORD_RE | Unclutter + EasyList |
| sociable / printfriendly / blogger-labels / instapaper_ignore | NOISE_KEYWORD_RE | Postlight |
| onesignal / intercom / smartfeed | NOISE_KEYWORD_RE | Unclutter |
| mpu | NOISE_KEYWORD_RE | EasyList（IAB 廣告標準尺寸別名） |
| replies / remark / shoutbox / respond / composer / combx | NOISE_KEYWORD_RE | Mozilla + Postlight |
| supplemental / cover-wrap / entry-unrelated / crumb | NOISE_KEYWORD_RE | Mozilla + Postlight |
| recirc / next-article / latest-posts / mostread / most-read | NOISE_KEYWORD_RE | Unclutter |
| nag / backdrop / topbar / announcement / popover / drawer | NOISE_KEYWORD_RE | EasyList + Unclutter |
| loader / contact / shopping / plea | NOISE_KEYWORD_RE | Postlight + Unclutter |
| article-sidebar / sidebar-(wrapper\|column\|content\|widget\|primary\|secondary) | NOISE_KEYWORD_RE / STRONG | 自蒐 + Mozilla negative |

---

## 刻意不採用的 token（誤殺風險記錄）

| Token | 為何不加 |
|---|---|
| `gate` | 太短，誤殺 `tailgate` / `stargate` 等罕見主文詞 |
| `wall` | 誤殺 `firewall` / `wall-street` |
| `media` | 主文常用 `.article-media` / `.media-block` |
| `meta` | 主文常用 `.post-meta` / `.entry-meta` 顯示日期署名 |
| `info` | 主文常用 `.post-info` / `.article-info` |
| `tags` | 主文 tag 列表常用 `.post-tags` / `.tags-list` |
| `widget`（單字） | 太通用 |
| `scroll`（單字） | 主文 `.scroll-section` / `.scrollytelling` |
| `disclaimer` | 醫療 / 法律主文有正當用法 |
| `dialog` / `alert` / `prompt` | 主文 callout / code 區塊也用 |
| `commercial` | 主文「commercial real estate」類詞會誤命 |
| `tease` | `.article-teaser` 主文導讀 |
| `splash` | `.splash-image` 主文 hero |
| `bookmark` | 主文 anchor link |
| `tools` | 「文章工具列」與主文 toolbar 歧義 |
| `legends` | 圖表 legend 與圖說歧義 |
| `dateline` | 主文署名（Readability 把它放 NEGATIVE_SCORE_HINTS 給負分，不 hide） |
| `marketing` | 「marketing strategy」類主題詞會誤命 HBR / 商業類站 |
| `aux` | 模糊（auxiliary 縮寫） |
| `featured` | 主文 `.featured-image` 普遍 |
| `recent` / `latest`（單字） | `.recent-comments-by-author` 主文 byline |
| `home`（單字） | 主文 link 文字「home page」常見 |
| `predicta` / `presence_control_external` / `yom-remote` | 站特定（Predicta 廣告廠 / lifehacker / Yahoo），不通用 |
| `protection-notice` / `content-blocker` | 對抗性 niche |
| `com-`（單字） | 太短，會 match 主文 `.complete` / `.commit` |

---

## 規則：未來新增 keyword 流程

1. **先讀本檔**：避免重複研究、避免採用已知誤殺的 token
2. **先比對 Mozilla Readability + Postlight + Unclutter**：3 個源 ≥ 2 個收的 token 通常安全
3. **word boundary 評估**：JRead 用 `[^a-z0-9]` 為 boundary，token 後 `-` `_` `.` ` ` 都算 boundary。新 token 加前先想：有沒有英文常見詞 / 主文 class 慣用名命中？
4. **fixture forcing function**：每個新 token 配一個 wrapper 在 `generic-noise-keyword-coverage.html`，spec 鎖
5. **更新本檔**：「已採用」與「刻意不採用」兩表都要寫
