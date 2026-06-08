# SPEC.md — JRead 專案規格

> 這是 JRead Chrome Extension 的完整規格。Claude 開始任何工作前必讀。
> 協作規則另見 `CLAUDE.md`。

---

## 目前 Extension 版本

最新：**v0.7.240**。詳細修法見 [`CHANGELOG.md`](CHANGELOG.md) 頂部條目；`package.json` / `jread/manifest.json` 為真實版本號來源（`test/version-check.spec.js` forcing function 強制四邊同步：manifest / package.json / SPEC / CHANGELOG）。

### Baseline（當前所有修法的不可退讓底線）

**當前 baseline：v0.7.135**（2026-05-13 起，Jimmy 在 cn.nytimes col-* margin reset 修法完成後明確指定為新基準；v0.7.135 在此之上新增 X / Twitter status thread 支援）。承接 v0.7.32 的所有能力 + 累積 v0.7.33–128 的 cleaner / styler edge case 修法 + v0.7.133 新增 YouTube Cinema Mode + v0.7.134 新增 YouTube Borderless Mode（從 Shinkansen 移植，與 cinema mode 完全獨立）+ v0.7.135 新增 X / Twitter status 頁合成 reader 容器支援（thread = 同作者連續推文）。往後 edge case 維修以此版的視覺成果與測試覆蓋為不可退讓底線。

**v0.7.134 baseline 包含**（在 v0.7.32 之上累積，完整修法紀錄見 `CHANGELOG.md`）：

1. **styler 瘦身不變**（承接 v0.6.0 / v0.7.32 精神）：字型 / heading margin / p margin / list style / link color / blockquote border **全部保留原站樣式**；styler 只注入讀者卡片容器 + 祖先鏈 reset + 必要 hack + 使用者 override。
2. **styler 增強**：cardArticle rule selector 加 `html` 前綴提升 specificity 到 (0,1,1) 贏過原站單 class !important rule（v0.7.121 cn.nytimes 修法）；col-* reset rule 升級為 `width: auto / max-width: none / float: none / flex: 1 1 auto / margin-left: 0 / margin-right: 0 / padding: 0`（v0.7.122 flex-grow:1 撐父 + v0.7.123 清 Bootstrap col offset margin）；figcaption 從 BODY_TEXT_SEL 排除保留原站 typography hierarchy（v0.7.120）。
3. **cleaner 規則完整 + 新增覆蓋**：v0.7.32 規則全保留 + 後續累積：負 horizontal margin reset（v0.7.115 twz.com full-bleed header）+ 文末 `<footer>` 雙階段 hide（v0.7.116 twz.com category tag）+ aspect-ratio container reset 擴增（v0.7.117 twz.com YouTube facade）+ `collapseGridWithHiddenCell` non-articleSelf wrapper 加 padding-left/right reset（v0.7.118 cna.com.tw inner-padding 溢出）+ `hideInsideArticleAbsoluteOverlays` 排除 IMG/PICTURE/VIDEO/SOURCE 避免主圖誤殺（v0.7.119 ebc.net.tw）+ negative z-index reset（v0.7.114 vocus）+ Bootstrap grid float layout condition D（v0.7.110 TBIJ）+ **`collapseEmptyWrappersAfterClean` 末段空 wrapper collapse**（v0.7.128 Medium top action bar 24px 殘留撐起標題上方空白）。
4. **使用者可調設定**：theme（light/dark/sepia）、fontSize（含 0 = Auto 保留原站）、**titleFontSize**（v0.7.175 標題 h1 字級，0 = Auto 保留原站標題大小；非 0 覆寫 h1 font-size，options 可調）、contentWidth、fontFamily、lineHeight、**autoEnableDomains**（v0.7.155 options 「自動啟動網域」+ popup 「此網域自動啟動」checkbox，命中即頁面載入 silent enterReaderMode）、Readwise Reader 整合、**blockPageShortcuts**（v0.7.131 reader mode 攔截原站快速鍵 Gmail / YouTube 等，預設 on）、**pangu**（v0.7.153 中英文間自動補空白，預設 on）。
5. **測試覆蓋**：448 jsdom regression spec（每條 cn.nytimes / cna / ebc / twz / udn / medium 等實機 bug 都有 forcing function fixture，含 v0.7.125–127 SW badge / JREAD_RELOAD bridge / badge text 純色塊修法 + v0.7.129 swallowTabGone race-condition guard + v0.7.130 popup readwise-btn hidden 可見性 + v0.7.131 reader-mode keyguard 攔截原站 shortcut + v0.7.132 options checkbox flex-shrink 防壓扁結構 spec）+ e2e SW wire-up spec + Playwright harness（`tools/debug-harness.js`）+ `npm test --timeout 30000` 確保 jsdom 重 fixture 不超時（v0.7.118 hotfix）。
6. **實測通過站擴展**（在 v0.7.32 之上累積）：cn.nytimes / cna.com.tw / ebc.net.tw / twz.com / vocus.cc / esmchina / 商業周刊 / synapseching.substack.com / **medium.com**（v0.7.128 top action bar 殘留 24px 修法）等。
7. **Debug 工具鏈**：Claude 自主跑完 reproduce + forensic 循環（Playwright + localStorage instrument bridge），避開 chrome.downloads MV3 SW data URL 限制，免使用者每步截圖（[[feedback-autonomous-debug]] memory 教訓）。
8. **YouTube Cinema Mode**（v0.7.133）：YouTube watch page（`/watch`）detector short-circuit 不跑主文偵測、改注入 CSS 把 `#movie_player` `position: fixed + translate(-50%, -50%)` 釘 viewport 中央、`min(100vw, 177.78vh)` 雙軸 clamp 16:9、黑底鋪滿、隱藏 masthead/留言/描述/推薦/endscreen 浮層。popup 偵測到 youtube-cinema 時 toggle 按鈕文字改「啟動 / 退出影院模式」；ESC 退出；不 install keyguard（保留 YouTube j/k/l/space/f 等 player shortcut）。詳見「YouTube Cinema Mode（v0.7.133）」章節。
9. **YouTube Borderless Mode**（v0.7.134，從 Shinkansen 移植）：YouTube watch page 第二個獨立沉浸模式——影片以 100vw × 100vh 撐滿視窗、強制 theater、隱藏所有 YouTube UI（masthead / secondary / 留言 / 描述 / chat / 推薦），並透過 SW `RESIZE_OWN_WINDOW` 訊息呼叫 `chrome.windows.update` 把瀏覽器視窗高度 resize 成匹配影片寬高比。manifest 註冊 `toggle-youtube-borderless` 命令但**無 suggested_key**，使用者自行至 `chrome://extensions/shortcuts` 綁；popup 在 YouTube watch 頁多一顆「啟動 / 退出無邊模式」按鈕。與 cinema mode **完全獨立**：各自管自己的 state、各自 toggle、各自 CSS（兩者可同時開，但 CSS 會搶 `#movie_player` rule，使用者自決優先順序）。詳見「YouTube Borderless Mode（v0.7.134）」章節。

### 硬規則（繼承）

- **styler.js 仍視為動不得**——要動需 Jimmy 明確授權；禁止恢復 v0.5.x 對 h1-h6 / p / ul / ol / li / blockquote / a 下 rule 的做法。改 styler 類 typography-affecting universal rule 必須用 scoped selector（硬教訓 20，v0.7.17→v0.7.18）。
- **優先順序**：detector → cleaner → styler（最後手段）。
- **修 detector/cleaner/styler 類 DOM 互動 bug 必須先在 harness 驗假設再動 code**（見 CLAUDE.md「假設驗證順序」）。
- **所有 interactive button 一律清**（reader mode = 純閱讀，例外只有 button 內含主文媒體如 img/picture/video 的 wrapper）。
- **hide() 用 inline `!important`**（贏過原站 stylesheet `!important`，見硬教訓十）。

### 跨版本硬教訓（長期適用於未來修法）

1. **Typography-affecting universal rule 必須用 scoped selector**（硬教訓 20，v0.7.17 → v0.7.18）——`width` / `max-width` / `margin` / `padding` 等影響版面的幾何屬性若寫 `* { ... !important }` 會破 drop cap / figure full-bleed / styled-components 既有寬度。universal rule 只適合副作用不影響 layout 的屬性（如 `background-color: transparent`）。改 styler 後**必須** harness 截圖 + Read 自驗整頁排版，不能只看 residual audit。
2. **偽陰性驗收禁止**——harness 必須用 `RESIDUAL AUDIT` 遍歷 reader card visible element 列 outline；grep stdout 沒命中不代表 DOM 沒殘留。
3. **所有 interactive button 一律清**——reader mode 是「純閱讀」，分享/訂閱/追蹤/讚/收藏/播放/展開任何 CTA 無條件 hide；不看 class、不看 text、不設 preserve 例外（除 button 內含 img/picture/video 主文媒體載體才保留 wrapper）。
4. **`hide()` 必須用 inline `!important`**——stylesheet `!important` 會在 specificity 戰輸給原站的 stylesheet `!important`；inline `!important` 是 CSS 優先級最高層。
5. **Delayed lazy-inject 要靠邏輯完整性保證**——MutationObserver subtree + 遞迴 check button/a + inline !important 三者齊備；Playwright harness 的 lazy-inject 時序不一定跟實機 Chrome 同步，「我 audit 看不到」不代表「Jimmy 看不到」，相信 Jimmy 截圖。
6. **假設驗證順序**（詳見 `CLAUDE.md`）——修 detector/cleaner/styler 類 DOM 互動 bug 必須先在 harness 跑一次性 probe 驗假設、再動 extension code；fixture 是 forcing function、不是假設探索工具。

---

## 一句話定位

JRead 是 Chrome Extension「Unclutter」的 clone——提供純閱讀模式，在任一文章頁一鍵隱藏廣告、側邊欄、彈窗、浮動元素等雜訊，將主文以乾淨排版呈現。

---

## 核心功能（MVP）

| 功能 | 說明 | 狀態 |
| --- | --- | --- |
| 主文偵測 | 從 DOM 中找出主要文章內容元素 | ◐ 進行中（策略 1/2/4 已實作；策略 3 OpenGraph 未實作） |
| 閱讀模式切換 | 一鍵開/關閱讀模式 | ✅ v0.4.0（popup 按鈕 + 快速鍵） |
| 乾淨排版 | 套用可讀性佳的字體、字級、行高、版心寬度 | ☐ 未開始 |
| 雜訊隱藏 | 隱藏廣告、sticky header、彈窗、側邊欄、相關文章列表 | ✅ v0.3.0（主文外語意 + fixed/sticky + 社群 cluster + 主文內 keyword） |
| 偏好設定 | 字體、字級、主題色（亮/暗）、行高、版心寬度 | ☐ 未開始 |
| Popup UI | 顯示當前頁面是否可閱讀、版本號、切換按鈕 | ◐ 進行中（基本版已實作） |
| Toast 提示 | **僅** 主文偵測失敗時顯示「此頁無法偵測主文」錯誤 toast；reader mode on/off 不再彈 toast（v0.7.32 Jimmy 要求簡化）。Shadow DOM 封裝 | ✅ v0.4.0 / 縮限 v0.7.32 |
| 快速鍵 | 預設 `Alt+R`（Mac: `Option+R`）切換閱讀模式；若未生效可至 `chrome://extensions/shortcuts` 手動指派。**v0.7.218 自訂快速鍵**：options 「快速鍵」recorder 可為三個指令錄自訂組合（Safari 含 iPad 外接鍵盤唯一改鍵通道，content script 層攔截、與預設鍵並存）。**閱讀模式啟動期間按 `ESC` 可立即退出**（v0.7.101，input/textarea/contenteditable focus 時放行）。**`Space` / `Shift+Space` 段落焦點卷動**（v0.7.216，仿 Readwise Reader：左側指示條標記目前段落、Space 跳下一段；段落低於顯示門檻（viewport × `spaceScrollRatio`% 預設 50%，options 可調、0 = 停用）時以 rAF 動畫卷回畫面上方落點）。 **3 指輕點切換閱讀模式**（v0.7.223，觸控裝置 `navigator.maxTouchPoints >= 3` 才註冊：恰 3 指同落、移動 < 30px、600ms 內全離手 → 觸發；第 4 指 / 移動超容差 / touchcancel（iOS 系統手勢接管）取消；走 content 端 `NS.dispatchLocalCommand('toggle-reader-mode')` 本地 dispatch（v0.7.228 起零訊息傳遞、SW 死活無關——iOS Safari SW 被回收後不再喚醒，Apple Forums 758346）——iOS / iPadOS 觸控環境的主 toggle 通道）。 | ✅ v0.4.0 / ESC 退出 v0.7.101 / Space 段落焦點卷動 v0.7.216 / 3 指輕點 v0.7.223 |
| 翻頁模式 | **電子書式水平翻頁**（v0.7.227，popup「翻頁模式」checkbox 開啟、預設關 = 垂直卷動）：reader card 變 fixed 滿版 multi-column 容器（`column-width: 版心寬` + `column-count: auto` + `column-fill: auto` + 高度約束 → 溢出內容自動長出等寬水平 overflow column = 頁；stride 恆等式 `column-gap = 左右視覺內距和` → 翻一頁 = scrollLeft 跳 `stride = clientWidth − 左右 padding + column-gap`。**v0.7.230**：「一頁一欄」必須用 `column-width` 表達、不可用 `column-count: 1`——WebKit 對 count=1 不建 multicol fragmentation context、scrollWidth 不含 overflow columns、翻頁全滅；真機 Safari probe 實證，spec 設 forcing function。**v0.7.231**：右視覺內距必須用 `border-right: transparent` 表達、`padding-right` 必須為 0——WebKit 的 multicol scrollable overflow 不含尾端 inline-end padding，最後一頁 scrollLeft 被 clamp 短 56px 整頁錯位；頁數不信 `scrollWidth`、改量實際內容末端落在第幾欄（`computePageCountFromExtent`）——正式版 Safari 26.5 scrollable overflow 多報一個無內容幽靈欄，scrollWidth 公式會多算一頁；皆 spec forcing function + 三軌驗收（Chromium / WebKit trunk / safaridriver 真機））。圖片/影片/iframe `max-height: calc(100dvh − 垂直 padding − 120px caption 餘裕)` + `break-inside: avoid` 縮放至單頁不跨頁切割。翻頁通道：單指左右滑（v0.7.239 起全頁起手都認，見下方）/ `←` `→` `PageUp` `PageDown` `Space`(`Shift+Space` 反向) `Home` `End` / 滾輪與觸控板（delta 累積 90 過門檻、翻後 550ms 慣性鎖定）。頁碼指示 `N / M` 固定底部置中（掛 `<html>` 下——掛 body 會被 ancestor sibling 隱藏規則吃掉）+ 進度條寬度 = 已讀頁比例。**v0.7.237 頁碼可關**（popup「頁碼指示」開關 → `showPageNumber` 設定）：`setShowIndicator` 即時增/移除指示器 DOM、不重建 layout。**v0.7.237 擋 iOS Safari 邊緣返回手勢**（Jimmy 回報第一頁左滑誤觸 Safari「back」）：`touchmove` 改 `passive:false`、對水平支配單指滑動 `preventDefault`（翻頁文件已鎖、水平觸控無原生用途；多指讓位 3 指 toggle、垂直放行）——`UIScreenEdgePanGestureRecognizer` 系統手勢無法在 simulator 重現（idb HID 觸發不到），preventDefault 是否真擋住返回待真機驗（`test/PENDING_REGRESSION.md`）。桌面寬視窗頁寬 cap `contentWidth`（**v0.7.234 寬度一致性**：contentWidth 語意 = 卡片總寬、與捲動模式 baseline 同義；`column-width = contentWidth − 左右內距和`——舊版 cap contentWidth + 內距 ×2 讓翻頁模式卡片與內文都比捲動模式寬 112px，Jimmy macOS Chrome / Safari 回報；三軌驗收 Chromium / WebKit trunk / safaridriver 真機 Safari 26.5 寬度逐 px 相等 + 多頁 + 末頁格點對齊）置中（書頁感）。resize/旋轉按閱讀比例回對應頁；lazy-load 增頁即時重算（重測內容末端、頁數縮水時 clamp 回最後一頁）。翻頁模式下 Space 段落卷動（space-scroll）讓位停用；ESC 退出與 3 指輕點不受影響；退出還原進場前文件卷動位置。**v0.7.238 垂直滑收合 iOS Safari 工具列**（Jimmy 回報「工具列隱藏多顯示一行」）：限觸控裝置（`@media (hover:none) and (pointer:coarse)`），翻頁模式放行 html/body 垂直卷動 + body `min-height: 500vh` + 卡片 `touch-action: pan-y`——使用者垂直滑一下 → 底下 document 捲動 → iOS Safari 偵測真實手勢自動收合工具列（卡片 fixed 視覺不動、viewport 變高多顯示內容）。**自動收合做不到**（iOS 只認真實觸控手勢、程式 `scrollTo` 不觸發收合，simulator 對照實證），故半手動。`touch-action: pan-y` 必要（否則 fixed+overflow:hidden 卡片上非被動 touchmove 讓 WebKit 垂直 pan 曖昧、不冒泡捲 document，simulator instrument 揭穿）；`min-height` 不可 <= 200vh（一滑貼底、iOS 接近底部不收合）；`onScrollProgress` 翻頁模式讓位（垂直 scrollTop 非閱讀進度、避免覆寫頁碼進度條）。桌面 base 維持 overflow:hidden 鎖死、不受影響。**v0.7.239 兩項手勢調整**（Jimmy 真機 TestFlight 回報）：(1) **整頁可滑**——`EDGE_GUARD_PX` 28 → 0（「翻頁只在中間生效、太不靈敏」+ 真機實證左邊緣往右滑不會返回只是滑不動；擋返回已由 onTouchMove preventDefault + touch-action 覆蓋，邊緣緩衝多餘）。單指左右滑改為全頁起手都認（不再避開左右 28px）。(2) **工具列收合限第一頁**——`onTouchMove` 改 idx-based（純函式 `shouldBlockTouchMove`）：第一頁只擋水平支配滑動（放行垂直滑收工具列），第二頁起擋全部單指滑動（垂直擋 = 維持收合後 scrollY 不被捲回、工具列保持收合；水平擋 = Safari 返回；翻頁由 touchend JS 處理不受影響）。**不可用 `touch-action: none` 鎖第二頁**——iOS WebKit 有 passive:false touchmove listener 時 touch-action 不可靠（不繼承、手指落在卡片內 auto 後代 `<p>`/`<img>`），simulator instrument 實證 scrollY 仍被捲穿、工具列重新展開；必須用 passive:false 的 preventDefault。卡片 `touch-action: pan-y`（v0.7.238）保留——第一頁垂直 pan 冒泡到 document 收工具列需要它。**v0.7.240 收合後鎖死垂直卷動**（Jimmy 真機回報「可卷動範圍過高（500vh）→ 左右滑被原生垂直 pan 搶走、不靈敏」）：保留 500vh 讓第一次滑動有空間觸發收合，但偵測到 `innerHeight` 變高（= iOS 工具列已收合，純函式 `classifyViewportChange`：寬不變 + 高出 16px = `lock`、變矮 = `lower` 下修 baseline、寬變 = `rotate` 重設+解鎖）即進入 `vLocked`——`shouldBlockTouchMove` 改委派 `blockTouchDecision(dx, dy, pageIdx, vLocked)`，鎖後擋**全部**單指滑動 + 卡片 `touch-action: none`，scrollY 凍結在收合位置（工具列保持收合）、左右滑乾淨。**不縮 `min-height`**——縮回去會 clamp scrollY 反讓工具列重展開；鎖在 JS（`onResize` / `onTouchEnd` 都呼叫 `checkCollapseLock`）。旋轉解鎖讓新方向可再收合一次。**v0.7.233**：三條 enter 路徑（一般 / X thread / FB post 合成容器）都必須 `captureScrollY` + `syncPagedModeFromSettings`（順序 pagedMode → spaceScroll → keyguard）——styler 依 settings 在所有路徑注入翻頁 CSS，模組漏裝會變「視覺翻頁、模組沒裝」（指示條殘留 / 無頁碼 / 翻不了頁）。`content/paged-mode.js`（雙匯出：NS.pagedMode + module.exports 純邏輯給 jsdom spec）。驗收：`debug-harness.js --paged`（印 PAGED AUDIT：column CSS 算出值 / 頁數 / 鍵盤翻頁 stride 實測）；WebKit 軌驗證見 `docs/CHROME_EXTENSION_DEBUG.md` | ✅ v0.7.227 |

---

## 非 MVP 範圍（之後再談）

- 劃重點 / 筆記
- 稍後閱讀 / 書籤
- AI 摘要
- 跨裝置同步閱讀列表

---

## 檔案結構（規劃）

```
JRead/
├── jread/                       # Extension 本體
│   ├── manifest.json            # Manifest V3
│   ├── background/
│   │   └── service-worker.js
│   ├── content/                 # Content scripts（按載入順序）
│   │   ├── namespace.js         # window.__JRead 初始化
│   │   ├── settings-defaults.js # DEFAULT_SETTINGS 單一資料源（content / SW / Safari、Firefox event page 共用，v0.7.235）
│   │   ├── shortcut-utils.js    # 自訂快速鍵 helper（content / options / spec 共用，v0.7.218）
│   │   ├── custom-shortcuts.js  # 自訂快速鍵 keydown 攔截 → 本地 dispatch / CUSTOM_COMMAND（v0.7.218 / v0.7.228）
│   │   ├── touch-gestures.js    # 3 指輕點 toggle 閱讀模式 → 本地 dispatch（v0.7.223 / v0.7.228）
│   │   ├── detector.js          # 主文偵測
│   │   ├── cleaner.js           # 雜訊隱藏
│   │   ├── styler.js            # 套用乾淨排版
│   │   ├── paged-mode.js        # 翻頁模式：手勢/鍵盤/滾輪翻頁 + 頁碼指示（v0.7.227）
│   │   └── main.js              # 進入點、事件串接
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.js
│   ├── options/
│   │   ├── options.html
│   │   └── options.js
│   ├── site-overrides/          # 站點特判隔離區（慎用）
│   └── assets/
├── test/
│   ├── version-check.spec.js    # 版本號 forcing function
│   ├── regression/              # 回歸測試
│   │   ├── fixtures/
│   │   └── *.spec.js
│   └── PENDING_REGRESSION.md
├── tools/
│   ├── debug-harness.js         # Playwright 自動化除錯 harness
│   ├── firefox-build.sh         # Firefox sideload ZIP 重建（jq 改 manifest）
│   └── asc-provision-ios.js     # iOS 簽章資源 bootstrap（憑證 / bundle ID / profiles，idempotent）
├── safari-app/                  # Safari Web Extension（macOS v0.7.138 起 / iOS v0.7.217 起）
│   ├── safari-bootstrap.sh      # 一次性 macOS Xcode project 產出（xcrun safari-web-extension-converter）
│   ├── safari-build.sh          # 每次 release 跑：sync Resources + archive + notarize + staple → .pkg
│   ├── safari-export-options-developerid.plist  # Developer ID 簽章設定
│   ├── ios-bootstrap.sh         # 一次性 iOS Xcode project 產出（converter --ios-only + patch）
│   ├── ios-build.sh             # 手動觸發：sync Resources + archive + export .ipa + altool 上傳 TestFlight
│   ├── ios-export-options.plist # iOS App Store manual signing 設定
│   ├── JRead/                   # macOS Xcode project（host App + Extension target）
│   │   ├── JRead.xcodeproj/
│   │   ├── JRead/               # macOS host App（WKWebView + open Safari prefs）
│   │   └── JRead Extension/     # Safari Web Extension target（Resources/ = jread/ 同步鏡像）
│   └── JRead-iOS/               # iOS Xcode project（與 macOS 完全獨立）
│       ├── JRead.xcodeproj/
│       ├── JRead/               # iOS host App（converter 模板）
│       └── JRead Extension/     # Safari Web Extension target（Resources/ = jread/ 同步鏡像）
├── docs/
│   └── CHROME_EXTENSION_DEBUG.md # 自動化除錯完整指南
├── .github/workflows/
│   └── release.yml              # tag push 觸發 → build Chrome + Firefox + source ZIP
├── BUILD.md                     # AMO reviewer Firefox 重建指引
├── CLAUDE.md
├── SPEC.md                      # 本檔
├── README.md
├── CHANGELOG.md
└── release.sh
```

---

## Firefox 版本（v0.7.136 起）

JRead 同時發佈 Chrome 與 Firefox 兩個版本。

**單一真實來源**：`jread/manifest.json` 永遠對應 Chrome 版（`background.service_worker`）。Firefox manifest 由 `tools/firefox-build.sh` 在 build 時用 `jq` 程式化改寫——沒有兩份 manifest，沒有 minify / bundle / transpile，只動幾行 JSON。

**Build transformation**（`tools/firefox-build.sh`）：

1. `background.service_worker` → `background.scripts: ["popup/popup-core.js", "background/service-worker.js"]`
   - Chrome MV3 拒絕 `scripts`，Firefox MV3 不支援 `service_worker`，兩邊互斥不能共用
   - 順序：`popup-core.js` 先 load（提供共用注入 fallback 函式），`service-worker.js` 後 load（依賴 popup-core 全域變數）
   - Chrome 端透過 `importScripts('/popup/popup-core.js')` 達到同樣依賴關係；該 call 包 `typeof importScripts === 'function'` guard，Firefox event page 跑時直接跳過
2. `browser_specific_settings.gecko.strict_min_version: "128.0"`
3. `browser_specific_settings.gecko.data_collection_permissions: { required: ["none"] }`（Mozilla 2025 consent UI 要求；JRead 不收集任何資料）

`browser_specific_settings.gecko.id = "jread@jimmy.zm.su"` 直接寫在 Chrome manifest 裡（Chrome ignore，Firefox build 沿用）——AMO 上架後 ID 鎖死不可改。

**Release artifact**（每次 tag push 由 `.github/workflows/release.yml` 自動產出）：

| 檔名 | 用途 |
| --- | --- |
| `jread-vX.Y.Z.zip` | Chrome Web Store 上架 / sideload |
| `jread-firefox-vX.Y.Z.zip` | Firefox AMO 上架 / sideload |
| `jread-firefox-vX.Y.Z-source.zip` | AMO reviewer 重建用（含 `tools/firefox-build.sh` + `BUILD.md`） |

`release.sh` 跑完 `npm test` + 確認 working tree 乾淨 → 建 tag → push commits + tags → GitHub Actions 接手。SKIP_PUSH=1 可只跑本機測試 + tag，不 push（debug 用）。

Forcing function：`test/regression/firefox-build.spec.js` 端到端跑 `tools/firefox-build.sh` 驗 manifest 結構（gecko id、strict_min_version、data_collection_permissions、scripts 順序）+ 驗 service-worker.js 內 `typeof importScripts` guard 存在。

---

## macOS Safari 版本（v0.7.138 起）

JRead 同步發佈 macOS Safari 版本（Developer ID 簽章 + Apple notarize + stapled 的 .pkg，給使用者公開下載手動安裝；不走 Mac App Store）。

**單一真實來源**：`jread/manifest.json` + `jread/` 整棵目錄是 Chrome 版本，Safari build 透過 `safari-app/safari-build.sh` 每次 `rsync -a --delete jread/ safari-app/JRead/JRead Extension/Resources/` 把 Chrome 來源完整同步進 Xcode project 的 Extension Resources/——Safari 與 Chrome 共用同一份 extension code，無雙頭維護。**唯一受控差異**（v0.7.228）：rsync 後 `safari-app/patch-safari-manifest.sh` 把 Resources/manifest.json 的 background 改宣告 event page（`scripts + persistent: false`，iOS SW 不喚醒 bug 對策、macOS 統一宣告），drift check `-x manifest.json` 排除、由 patch script verify 補檢查。

**Build 流程**（`safari-app/safari-build.sh`，每次 release 自動跑）：

1. 前置 check：Developer ID Application cert / Developer ID Installer cert / notarytool keychain profile（缺哪項印對應安裝指引）
2. `rsync` jread/ → Extension Resources/ + `patch-safari-manifest.sh`（background → event page）
3. `sed` bump `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` 到 `project.pbxproj`
4. `xcodebuild clean` + `xcodebuild archive`（Release configuration，macOS only）
5. `xcodebuild -exportArchive` 用 `safari-export-options-developerid.plist`（method = developer-id，signingStyle = manual，signingCertificate = "Developer ID Application: Zhimin Su (PR6NG3PH45)"）→ 產 `.app`
6. `productbuild --component .app /Applications --sign "Developer ID Installer: Zhimin Su (PR6NG3PH45)"` → 產 `.pkg`
7. `xcrun notarytool submit --wait`（Apple cloud 公證，實測 ~25 秒；Apple 文件聲稱可達 30-60 分鐘）
8. `xcrun stapler staple` 把公證 ticket 釘進 pkg（離線可驗）
9. `spctl -a -t install -vv` 驗證 Gatekeeper accept
10. source drift forcing function：`diff -r --brief jread/ Resources/` 必須 empty

**Apple Developer 設定**（沿用 Shinkansen 同一個 Apple Developer 帳號 Zhimin Su）：

| 項目 | 值 |
| --- | --- |
| Team ID | `PR6NG3PH45` |
| Host App Bundle ID | `app.jread.macos` |
| Extension Bundle ID | `app.jread.macos.Extension` |
| Signing | Developer ID Application + Developer ID Installer cert（已裝 Keychain） |
| notarize profile | `shinkansen-notary`（沿用，notarytool credentials 是同 Apple ID + Team；不同 profile 名稱只是 Keychain key） |

**Release artifact**（每次 release 由本機 build 上傳到 GitHub Release）：

| 檔名 | 用途 |
| --- | --- |
| `jread-macos-vX.Y.Z.pkg` | macOS Safari（Developer ID notarized）。使用者下載雙擊 → 安裝到 /Applications → 開啟 JRead.app → 點「結束並開啟 Safari 擴充功能偏好設定」啟用 |

**Release 流程整合**（`release.sh`）：本機跑 `./release.sh` 時自動：(1) npm test → (2) working tree clean check → (3) safari-build.sh（archive + notarize + staple）→ (4) auto-commit pbxproj + Resources/ 改動 → (5) tag → (6) push → (7) 等 GitHub Release 由 Actions 建出 → (8) `gh release upload .pkg --clobber`。`SKIP_SAFARI=1` 可緊急只發 Chrome / Firefox 跳過 Safari build。

**Host App 介面**（最小 host App）：基於 xcrun safari-web-extension-converter 預設模板（WKWebView 載入 `Resources/Base.lproj/Main.html`），文字本地化為繁體中文；按鈕 `<button class="open-preferences">` 點擊呼叫 `SFSafariApplication.showPreferencesForExtension` 跳轉 Safari 擴充功能設定。Icon 沿用 `jread/assets/icons/icon-128.png`。

Forcing function：`test/regression/safari-build.spec.js` 驗 (1) scaffold 檔案存在 + executable；(2) `safari-export-options-developerid.plist` 內 method/teamID/signingStyle/cert；(3) `project.pbxproj` 內 host App bundle ID = `app.jread.macos`、Extension bundle ID = `app.jread.macos.Extension`、4 處 `DEVELOPMENT_TEAM = PR6NG3PH45`；(4) `safari-build.sh` 含 rsync / sed bump / xcodebuild archive / exportArchive / productbuild / notarytool submit / stapler staple / source drift check；(5) `release.sh` 串接 safari-build.sh + SKIP_SAFARI escape + auto-commit + `gh release upload --clobber`。**spec 不實際跑 xcodebuild**（那需要 macOS + Xcode + cert + Apple cloud，跨平台 CI 跑不了）。

---

## iOS / iPadOS 版本（v0.7.217 起，TestFlight 軌）

JRead 提供 iOS / iPadOS Safari Web Extension，目前走 **TestFlight internal testing**（免審核、build 上傳後 ASC 處理 5-30 分鐘即可裝；尚未公開上架 App Store）。

**發佈節奏與 Chrome / macOS 解耦**：`safari-app/ios-build.sh` **手動觸發**、不綁 `release.sh`——Chrome / macOS 每版即發，iOS 要發時人工跑一次 build script。同版本號重傳 ASC 會被拒，重傳前先 bump。

**單一真實來源**：與 macOS 軌同模式——`safari-app/ios-build.sh` 每次 `rsync -a --delete jread/ "safari-app/JRead-iOS/JRead Extension/Resources/"`，extension code 不雙頭維護。iOS Xcode project（`safari-app/JRead-iOS/`）與 macOS project（`safari-app/JRead/`）**完全獨立**，由 `safari-app/ios-bootstrap.sh`（converter `--ios-only`）一次性產出。

**Apple Developer 設定**：

| 項目 | 值 |
| --- | --- |
| Host App Bundle ID | `app.jread.ios` |
| Extension Bundle ID | `app.jread.ios.Extension` |
| 簽章 | **manual signing**：Apple Distribution 憑證 + 「JRead iOS App Store」/「JRead iOS Extension App Store」IOS_APP_STORE profiles（Release config；Debug 維持 automatic 供 simulator） |
| 簽章資源管理 | `tools/asc-provision-ios.js`（idempotent；透過 ASC API 建憑證 / bundle ID / profiles；憑證一年到期重跑換發） |
| ASC app record | 「JRead – Privacy Reader Mode」（appId `6776944917`，primaryLocale zh-Hant，SKU `jread-001`） |
| TestFlight | internal group「Internal」（`hasAccessToAllBuilds: true`——新 build 自動可測，tester: jimmy_su@me.com） |
| 出口合規 | host App Info.plist `ITSAppUsesNonExemptEncryption = NO`（只用 HTTPS，上傳後免問卷直接可測） |

**為什麼 manual signing**：team 沒有註冊任何 iOS 裝置，automatic signing 在 archive 階段堅持產 development profile 而失敗（「Your team has no devices」）；App Store distribution profile 不需要裝置清單，manual 直接繞開。

**iOS background lifecycle（v0.7.228 根治「用一段時間後失效」）**：iOS Safari 的 MV3 background **service worker 被系統回收後不再喚醒**（Apple Developer Forums [thread 758346](https://developer.apple.com/forums/thread/758346)；iOS 17.4 起、迄今未修；Chrome / macOS Safari 的 SW 死後下個事件會重生，iOS 實機死透，僅重開機 / Settings 重開 extension / 強制關閉 Safari 可復原）；iOS 18.4+ 另有 `tabs.sendMessage` 無聲掉包 regression（[thread 787958](https://developer.apple.com/forums/thread/787958)）。對策雙管：(1) 觸發路徑去 SW 化——3 指輕點 / 自訂快速鍵 toggle 走 content 端 `dispatchLocalCommand` 本地 dispatch（零訊息傳遞）；(2) Safari build 的 manifest 由 `safari-app/patch-safari-manifest.sh`（macOS / iOS 共用、冪等）把 background 改宣告 event page（`scripts + persistent: false`——Safari 對 event page 生命週期管理正常，卸載後可重生）；Chrome 版 manifest 維持 `service_worker` 不動，build drift check `-x manifest.json` 排除這個唯一受控差異、由 patch script verify 補檢查。**機制限制**：send-to-readwise 的 API 呼叫住在 background，仍依賴 event page 喚醒；若 Apple 再 regress event page lifecycle，僅此功能受影響、toggle 類觸發不受波及。**v0.7.235 補修**：v0.7.228 漏掉 content 端 `getSettings` 也住在 background（`GET_SETTINGS` round-trip）——iOS 掉包時回 `undefined`、所有設定靜默 fallback 預設值（theme / fontSize 接近預設難察覺；pagedMode 永遠 false = Jimmy 回報「翻頁模式 iOS 沒功能」根因，simulator instrument 實證）。已改直讀 `chrome.storage.sync`（defaults 單一資料源 `content/settings-defaults.js`，Safari event page scripts 預載清單同步加檔——v0.7.229 同款坑），round-trip 降為 storage 失效 fallback。background 依賴現況：僅 send-to-readwise + icon badge。

**Build 流程**（`safari-app/ios-build.sh`）：rsync Resources → manifest event page patch（`patch-safari-manifest.sh`）→ sed bump pbxproj 版本 → `xcodebuild archive`（`generic/platform=iOS`）→ `xcodebuild -exportArchive`（`ios-export-options.plist`：method app-store-connect + manual provisioningProfiles mapping）→ `altool --validate-app` → `altool --upload-app`（ASC API key `592WJH7U2F`，與 Shinkansen 共用，env `ASC_KEY_ID` / `ASC_ISSUER_ID` 可覆寫）→ source drift check。`SKIP_UPLOAD=1` 只產 `.ipa` 不上傳。BUILD_DIR 在 `$TMPDIR`（iCloud fileprovider 接管教訓）。

**iOS API 相容性**（v0.7.217 guards，`test/regression/ios-api-guards.spec.js`）：

| API | iOS 狀況 | 處理 |
| --- | --- | --- |
| `chrome.management.getSelf` / `chrome.runtime.reload`（JREAD_RELOAD debug bridge） | 可能缺席 | SW handler 開頭 existence guard，缺 API 直接 reject |
| `chrome.action` badge / setIcon | 子集可能缺 | SET_ACTIVE_ICON case 開頭 guard，缺就整段跳過（badge 純裝飾） |
| `chrome.commands`（popup 快速鍵提示） | iOS Safari 26 實測**有支援** | popup.js 仍包 existence guard 兜底，缺 API 時隱藏提示列。**v0.7.232**：觸控裝置（`maxTouchPoints >= 3`，與 touch-gestures.js 門檻一致）提示改顯示「三指輕點：切換純閱讀」，優先於自訂鍵 / browser 指派 |
| `chrome.windows.update`（YouTube Borderless resize） | iOS 無 windows API | 原有 try/catch 已吃掉 TypeError，Borderless 自動降級（CSS 照套、視窗不 resize） |
| `chrome.storage.sync` | 可用但**不走 iCloud**（Apple 官方：等同 local） | 無修改；Mac ↔ iPad 設定不互通，各裝置各自設定 |

**Simulator 驗證工具鏈**（iPad Pro 11" simulator 實測 v0.7.216 全功能通過）：
- 啟用 extension：Settings UI 無法 scripting——直接對 Safari container 的 `Library/Safari/WebExtensions/Extensions.plist` 注入 `Enabled: true` + `GrantedPermissions` + `GrantedPermissionOrigins`（python plistlib；key 含點號 plutil keypath 解析不了），重啟 MobileSafari 生效
- UI 操作：macOS 輔助使用權限未授予時 osascript 點不了 Simulator——改用 `idb`（`brew install facebook/fb/idb-companion` + `python3 -m venv ~/.idb-venv && pip install fb-idb`；Python 3.14 需 patch `idb/cli/main.py` 的 `asyncio.get_event_loop()` → `new_event_loop()`），`idb_companion --udid <UDID>` 起 gRPC 後 `idb ui tap/swipe` 注入 HID 事件。**v0.7.235 實證**：companion 預設 grpc port 10882 若被其他 simulator 占用會 `bind: Address already in use` → 加 `--grpc-port <自選>` + `idb connect localhost <port>`；popup 內元素座標用 `idb ui describe-all` 拿 AXLabel/frame 反推（popup 是 native popover、不在頁面 DOM 裡）
- **content script `console.log` 不進 unified log（v0.7.235 實證）**：iOS Safari WebKit 的 content script 端 `console.log` **`xcrun simctl spawn <udid> log show` 完全撈不到**（background / SW 端的 log 撈得到——差別在 content 跑在 WebKit web content 程序、不是 extension 程序）。要看 content 端 debug 訊息，在 content code 內建一個 `position:fixed` 紅框 `<div>`、逐行 `appendChild(textContent)` 把訊息印**頁面上**，再 screenshot 讀回；instrument div 要掛 `documentElement`（非 body——會被 styler 的 ancestor-sibling 隱藏規則吃掉）+ 定時 re-assert `display`/重 append 防被自家 DOM 操作蓋掉。這次靠它實證「SW `GET_SETTINGS` round-trip 回 undefined / content 直讀 `storage.sync` 正常」= 翻頁模式 iOS 失效根因
- 座標換算：XcodeBuildMCP screenshot 551px 寬 vs iPad 834pt，×1.5136
- Extension 是否真的載入：看 `Library/WebKit/com.apple.mobilesafari/WebExtensions/Default/<ext>/State.plist` 的 `BackgroundContentEventListeners` + `LastSeenVersion`（SW 跑過才會記錄）
- **simulator WebKit shrink-to-fit 給假的視覺正常（從 Shinkansen 借的教訓）**：simulator 的 WebKit 會把過寬內容 shrink-to-fit 放大填滿，真機不會——popup 缺 viewport meta 之類的 layout bug 在 sim 上看不出來、真機才現形。視覺類驗收 sim 綠不等於真機綠，排版 / viewport 類改動仍需真機 / TestFlight 複驗
- 與 Playwright harness 的分工：cleaner / detector 修法仍以 Playwright harness 為主（跑得快、可 residual audit）；iOS simulator 只驗「iOS 特有行為」（API 缺席、popup popover、觸控），**不重跑整套站點驗收**

Forcing function：`test/regression/ios-build.spec.js`（15 條）驗 scaffold 存在 + executable、pbxproj bundle ID / 4 處 DEVELOPMENT_TEAM / manual signing Release + automatic Debug、Info.plist 出口合規 key、export options mapping、build script 步驟完整性（rsync / 版本 sync / archive / export / validate / upload / drift check / SKIP_UPLOAD）。**spec 不實際跑 xcodebuild / altool**。

---

## 主文偵測策略（優先序）

1. 語意標籤：`<article>`（單一或明顯最長者；多個相近篇幅判為列表頁而降級）
2. Schema.org：`[itemtype*="Article"]`、`[itemtype*="NewsArticle"]`、`[itemtype*="BlogPosting"]`
3. OpenGraph：`meta[property="og:type"][content="article"]` 搭配啟發式（暫未實作）
4. 內容密度啟發式（Readability-style bubble-up）：對 `<p>` / `<li>` / `<h2-4>` / `<blockquote>` / `<pre>` 算 contentScore（文字長 + 逗號數），向 parent 100% / grandparent 50% 累加；容器型元素以累積分勝出。此法避免「站體外殼因後代 p 總數多而贏過真主文容器」
5. 兜底：`<main>` 本身作為主文（順序最後，避免多欄 layout 的 `<main>` 吞 sidebar）
6. 降級：若分數低於閾值，**不啟動閱讀模式**（no-op），不硬套

### Title promote（所有非兜底策略）

Stratechery / Medium / Substack / anthropic.com 等站點常把 post-title 跟 post-content 放兄弟層：WordPress 是 `<h2 post-title>` 跟 `<div entry-content>` 同級（heuristic 選中 content）、anthropic 則是 `<h1>` 放在 `<section hero>` 與 `<article>` 同級（article-tag 選中 article）。detect() 出口統一做 promote：沿主文容器祖先鏈往上，若兄弟中有 h1/h2 文字與 `meta[property="og:title"]` 或 `document.title`（取分隔前首段）雙向包含匹配，把主文容器升級到該共同 parent，使 title 納入主文 scope。作用於 article-tag / schema-org / heuristic；**main-tag 是兜底本身已是最外層，不做 promote**（避免無止盡向上擴散）。

### 內文保留特例（避免誤殺內容）

- **`<summary>` 元素**：雖然在 HTML 語意上是「摘要/提要」，但實際上常被媒體站拿來放文章的 editor bullets（例如 Business Weekly）。偵測主文時 `<summary>` 必須視為內文的一部分保留，**不可**外移到 outline 或砍掉。（Unclutter 在 Business Weekly 上就踩到這個坑，把 intro bullets 從主文移走）
- **`<figure>` + `<figcaption>`**：主圖與圖說一律保留
- **`<blockquote>`**：引言區塊保留

---

## 雜訊隱藏規則（結構性通則）

以下規則必須是 DOM / CSS 結構特徵，**不可**綁定站點或特定 class：

### 主文外雜訊

- 主文容器之外的 `<header>`、`<nav>`、`<footer>`、`<aside>` → 隱藏
- `position: fixed` / `sticky` 且不在主文範圍內的元素 → 候選隱藏
  - 寬度 ≈ viewport 且高度 < 100px → 多半是 top sticky bar / progress bar
  - 寬度 < 100px 且高度 > 200px → 多半是側邊浮動工具列
  - 固定在 viewport 下半區 → 多半是底部彈窗 / cookie / 訂閱 CTA
- `iframe` 中包含第三方廣告網域來源 → 隱藏
- 已知社群分享按鈕模式：連續 3+ 個 `a[href*="twitter.com|facebook.com|linkedin.com..."]` → 摺疊

### 主文內 layout 殘留空欄（結構性通則）

主文內若有 `display: grid` 或 `display: flex; flex-direction: row` 的容器，且其 direct children 中有 ≥ 1 個被 hide（`data-jread-hidden="1"` 或 `display: none` / `visibility: hidden`），代表原站 layout 設計了 N 欄但其中一欄內容已被清空——cleaner 給 container 加 inline `display: block !important; grid-template-columns: none !important` 等規則退化成自然 block。典型場景：Engadget / NYT / 許多新聞站用 CSS Grid 做「主文 + 廣告側欄」layout，AdBlocker 清廣告後殘留的 grid cell 空間壓擠主文。intentional 多欄圖文（無 hidden child）不會觸發。

### 主文內雜訊（跨站通用 keyword heuristic）

主文容器內出現以下 class / id 關鍵字的區塊視為雜訊（不分大小寫）：

- `paywall`、`subscribe`、`newsletter`、`signup`
- `promo`、`promotion`、`advertisement`、`sponsored`、`sponsor`（動詞詞根覆蓋 udn `.sponsor-ads` 類）、`ad-`、`-ad`
- `cta`、`call-to-action`
- `related-(articles|news|posts|stories)`、`more-(news|stories|posts|articles)`、`recommended`、`recommend`、`recommendation`、`read-more`、`read-next`、`up-next`、`taboola`、`outbrain`、`zergnet`、`revcontent`
- `breadcrumb(s)`、`pagination`、`page-nav`、`pager`、`author-(bio|card|info|box|meta|widget)`
- `follow`、`follow-us`、`subscribe`、`subscription`、`newsletter-(signup|form|cta)`、`email-(signup|capture|subscribe)`
- `cookie-(banner|notice|consent|bar)`、`gdpr`、`consent`、`privacy-(banner|notice)`
- `popup`、`overlay`、`modal-(content|dialog|box|wrapper)`、`floating-(bar|cta|widget)`、`sticky-(bar|cta|banner|subscribe)`、`toast`、`snackbar`、`notification-(bar|banner)`
- `audio-(player|widget)`、`postlisting`、`post-listing`、`thread(s)`、`reposted`、`repost`
- `social-(bar|links|icons|share|media)`、`share`、`social`
- `comment`、`comments`、`comment-form`、`discussion`、`discuss`、`disqus`、`livefyre`、`hyvor`（跨站 CMS 留言區 anchor 慣例：Substack `#discussion`、WordPress `.comments-page`、Disqus `#disqus_thread`、Ghost `#comments`）

**英文網頁 heading 文字慣用語**（`NOISE_HEADING_TEXT_RE`）：Related Articles / Recommended for you / More from X / You may also like / Read more / Up next / Continue reading / See also / Further reading / Editor's Picks / Sponsored content / Comments(N) / Discussion(N) / Responses / Replies / Newsletter / Subscribe / Follow us / Trending / Popular / Top Stories / AI Summary / AI Digest / Hot / New / Top

**英文網頁 link/button 文字慣用語**（`NOISE_LINK_TEXT_RE`）：View original / Read the full article / Back to top / Show more / Load more / Learn more / Get the app / Download app / Open in app / Subscribe / Follow / Like / Share / Repost / Reply / Comment / Save / Bookmark / Sign up / Log in / Clap / Join our newsletter / Follow us on Twitter / Subscribe to our newsletter / N hours ago / N minutes ago

### 主文內所有 interactive button 一律清除（無保留）

Reader mode 定位為「純閱讀」——**所有** `<button>` / `[role="button"]` / `<input type="button|submit|reset">` 一律 hide，不看 class、不看文字、不受 `PRESERVE_SEL` 保護（figure/summary/figcaption/blockquote 內的 expand/zoom/play 按鈕也清）。規則 `hideInsideArticleAllButtons` 獨立於 NOISE_LINK_TEXT_RE / NOISE_KEYWORD_RE，對所有 interactive button 無條件 hide——包含分享 / 訂閱 / 追蹤 / 讚 / 收藏 / 播放 / 展開 / 任何 CTA。`<a>` 連結不屬此規則範圍（保留主文內超連結 / 引用 / 人名 wiki 連結），僅由 NOISE_LINK_TEXT_RE 對特定 CTA 文字匹配清除。
- `share`、`social`（配合結構判斷，避免誤殺有意義的 share 圖示）
- `comment`、`comments`、`discussion`、`discuss`（動詞詞根覆蓋 udn `.discuss-board` 類）、`disqus`（跨站 CMS 留言區 anchor 慣例：Substack `#discussion`、WordPress `.comments-page`、Disqus `#disqus_thread`、Ghost `#comments`）

**這不是站點特判**：這些字詞是跨站通用的 CSS 命名習慣，在 Business Weekly、Medium、紐約時報、Substack 上都會命中對應區塊。實作時如果發現某個 keyword 容易誤殺，再逐條評估調整。

---

## 排版樣式策略（v0.6.0 瘦身版）

styler 的設計哲學：**盡量貼近原站點，只清雜訊、提供讀者卡片容器、接使用者 override**。不動原站的 heading margin / p margin / list style / font-family / font-size / line-height / link color / blockquote border 等——原站怎麼排就怎麼排。

### 永遠注入的骨架

1. 頁面 reset：`html` / `body` 背景 + 清 max-width / margin / padding（讓閱讀模式的卡片能置中於整個 viewport）
2. 祖先鏈 reset：`[data-jread-ancestor="1"]` 清 max-width / margin / padding / background / position / transform 等（讓主文脫離原站的多欄 layout 或 sticky 限制）
3. 讀者卡片：`[data-jread-active="1"]` 設 max-width（版心）/ margin auto / padding / background / border-radius / box-shadow——**刻意不設 font-family / font-size / line-height / color**
4. 第一個子元素 margin-top: 0（消頂端留白，配合 JS 對深層 firstInk 的 inline margin-top 覆寫）
5. 圖片 / 影片 max-width: 100%（避免超出卡片寬度）
6. aspect-ratio placeholder 破解：含 `<img>` / `<picture>` / `<video>` 的容器清 padding-bottom 與 aspect-ratio（專門破 Substack / Medium 的 `padding-bottom: 56.25%` hack）
7. `figure` / `picture` 強制 `width: auto !important` + `max-width: 100% !important`（v0.6.10 修商周類原站給 figure 固定寬 CSS 在 reader mode 下失效、figure 退化成 shrink-to-fit 被 figcaption 夾死的場景）
8. `[data-jread-hidden="1"] { display: none !important }`（v0.6.11 補 cleaner hide 漏洞——cleaner 只設 inline `style.display = 'none'` 無 !important，站點 JS scroll/timer handler 主動寫 `el.style.display = 'block'` 會覆寫 inline display + 清掉 priority。stylesheet !important 優先級 > inline 無 priority 值，browser 層級勝出，擋得住 JS 覆寫）
9. 閱讀進度條（v0.7.191）：`#__jread-progress` 固定在 viewport 頂端的 3px 細線，寬度隨捲動即時更新（`scrollTop / (scrollHeight - clientHeight) * 100%`）。顏色跟主題連動：light `#4A90D9` / dark `#7fb5e6` / sepia `#2c5282`。`z-index: 2147483647` + `pointer-events: none`。apply() 建立 DOM + scroll listener、restore() 清除

### 僅在「使用者改過預設值」時才注入的 override

| 欄位 | 預設 | 改過後注入 |
| --- | --- | --- |
| `theme` | `'light'` | dark / sepia → 覆寫文字色 + 頁面/卡片底色 |
| `fontSize` | `18` | 非 18 → `[data-jread-active] { font-size: Npx !important }` |
| `fontFamily` | `'system-ui'` | 改過 → 注入 font-family |
| `lineHeight` | `1.7` | 非 1.7 → 注入 line-height |
| `contentWidth` | `720` | 永遠注入（卡片骨架不可缺） |

這樣「開啟閱讀模式但不改設定」＝ 原站字體 / 字級 / 行高 / 排版 + 讀者卡片容器。最貼近原站視覺。

### 對比守門（contrast guard，v0.7.225，light theme only）

styler 刻意保留 `pre` / `table` 的原站文字色（syntax highlight / cell 色彩），但這些色是配合「原站 effective 背景」設計的——站點走 `prefers-color-scheme: dark` 時 token 色為淺色，reader card 白底會讓對比掉到 1.x:1（tymscar 實測 pre bg = 半透明白疊深 body，白卡下 1.07:1）。`apply()` 內建兩段式 runtime 檢查：

1. **Phase 1（CSS 注入前）**：量每個 `pre` / `table` 的原始 effective bg（ancestor 爬升 + alpha 合成）+ 各文字載體（direct textNode 元素）的色與字數
2. **Phase 2（CSS 全生效後）**：以 card bg 為基底重算新 effective bg + **重量注入後的實際文字色**（繼承類元素如 td 已走新 cascade，不可沿用 phase 1 舊色——誤判會把 table 修壞）。兩種修法形狀：
   - **整容器 bg 還原**：低對比文字（< 3:1）字數占比 >= 40% 且「注入後文字色 + 原始 bg」可讀 → 原始 bg 以 inline `!important` 還給容器（保留 syntax highlight 設計）
   - **per-carrier 色覆寫**：少數載體（如 th 自帶為深底設計的淺色）對最終 bg 仍 < 3:1 且原設計可讀 → 個別 inline 覆寫文字色（依最終 bg 亮度選深字 / 淺字）

保守邊界：原站本來就低對比的不動（不是 jread 造成）；dark / sepia theme 整段跳過（`* { color: theme.text }` 已蓋 token 色 + v0.7.164 已清 bg）。`restore()` 以通用 `{el, prop, prev, prevP}` snapshot 對稱還原。不驗 figcaption / mark / kbd（無回報案例、修法形狀不同）、不驗圖片 / iframe 內部。

配套：`tools/debug-harness.js` 的 **CONTRAST AUDIT**（initial + delayed 兩次）掃 reader card 內 visible 文字 vs effective bg 的 WCAG 對比、< 3:1 印 ⚠️，是修 styler / theme 類改動的驗收 forcing function；`--scheme dark` flag 模擬深色模式使用者（此類 bug 只在 dark scheme 重現）。

另一條同輪通則：video player 標記（`PLAYER_ATTR`）的 container 若含 >= 100 chars 的 p / li = layout wrapper 而非 player 結構，縮回 video 自身——否則 wrapper 內所有元素被豁免色彩保護（tymscar 實測 246/267 元素被誤標、link 留站點綠色在白卡上 1.37:1）。

---

## 設定欄位（預設值）

使用者三項必要設定（來自需求）：**頁面寬度、日夜間模式、字型大小**。其餘欄位先保留後端預設，未來 Options UI 決定是否曝露給使用者。

v0.7.140 起 popup 多了「字型」select，提供 4 個內建 stack：

| popup 選項 | storage `fontFamily` 字面值 |
| --- | --- |
| 系統預設 | `system-ui`（== styler DEFAULTS.fontFamily，**不注入 override**，保留原站字體） |
| 襯線 | `"Noto Serif TC", Georgia, "Times New Roman", "Songti TC", "Songti SC", "Hiragino Mincho ProN", serif`（v0.7.221：CJK 襯線字體必須明寫——iOS WebKit 對清單中段泛型 serif 只解析拉丁，CJK 會穿透到 styler sans 後綴的 PingFang TC；macOS 命中 Songti、iOS 命中 Hiragino Mincho。SW onInstalled 有舊值精準遷移） |
| 無襯線 | `"Noto Sans TC", -apple-system, "Helvetica Neue", sans-serif` |
| 等寬 | `ui-monospace, Menlo, Consolas, monospace` |

option value 寫死在 `popup.html`、與 `popup.js` 的 `FONT_STACKS` 常數逐字一致（forcing function spec 校對）。styler 注入時會在使用者 stack 末尾再串自己的 fallback chain，即使具名字型都沒裝也能 fall back 到對應的 generic family。


| 欄位 | 型別 | 預設值 | 儲存位置 | 使用者可調？ |
| --- | --- | --- | --- | --- |
| `theme` | `'light' \| 'dark' \| 'sepia'` | `'light'` | `storage.sync` | ✅（日/夜間切換） |
| `fontSize` | `number`（px） | `18` | `storage.sync` | ✅ |
| `titleFontSize` | `number`（px） | `0` | `storage.sync` | ✅（options「標題字級」；0 = Auto 保留原站 h1 大小、非 0 覆寫 h1 font-size，v0.7.175） |
| `contentWidth` | `number`（px） | `720` | `storage.sync` | ✅（頁面寬度）—— popup stepper [480, 1600] step 40 / options input [480, 1600] step 20（**v0.7.237 上限 1200 → 1600**：寬視窗 / iPad desktop-class layout viewport 可達 1120pt+，舊上限填不滿螢幕、主觀變「調了沒變寬」；styler clamp [300, 2000] 為最終防線）。注意手機 viewport < contentWidth 時 card 受 viewport clamp，調大無感（物理限制，非 bug；iPad simulator instrument 實證 innerWidth=1120 時 card rect.width 精確 = 設定值） |
| `fontFamily` | `string` | `'system-ui'` | `storage.sync` | ✅（popup「字型」select：系統預設/襯線/無襯線/等寬，v0.7.140） |
| `lineHeight` | `number` | `1.7` | `storage.sync` | ✅（popup「行距」stepper [1.0, 3.0] / step 0.1 / Auto sentinel = 0 不注入 line-height 保留原站，v0.7.162） |
| `paragraphSpacing` | `number` | `1.0` | `storage.sync` | ✅（popup「段落間距」stepper [0, 3.0]em / step 0.25 / Auto sentinel = -1 不注入 p/ul/ol/blockquote margin-bottom 規則保留原站 typography，v0.7.162） |
| `blockPageShortcuts` | `boolean` | `true` | `storage.sync` | ✅（options 「攔截原站快速鍵」） |
| `spaceScrollRatio` | `number`（%） | `50` | `storage.sync` | ✅（options 「Space 顯示門檻」number input [0, 90] / step 5，v0.7.215 固定翻頁 → v0.7.216 改段落焦點模型）—— reader mode 下按 `Space` 把左側 4px 主題色指示條（`#__jread-focus-bar`，`content/space-scroll.js` 建立/定位、CSS rule 在 styler stylesheet 與 `#__jread-progress` 共用 `theme.progressBar` 色）移到下一個段落（`Shift+Space` 回上一段；指示條左錨點固定在 articleEl 左緣 - 14px、水平位置恆定不跟個別 block 漂移）。**此值 = 焦點段落允許的顯示門檻**（top 不可低於 viewport × ratio%）：門檻內只移指示條不卷動；低於門檻 → rAF 動畫（450ms easeInOutCubic）「卷到落點」——讓段落 top 落到 viewport × `REST_FRACTION`(0.1) 處，卷距隨段落位置而定（非固定距離，保證卷完必在門檻內、指示條永不停留頁面底部）。反向：段落 top 高過 viewport 上緣才往上卷、落同一落點。**0 = 停用 sentinel**（不攔截、保留瀏覽器原生跳卷）。段落候選 = articleEl 內 `p / h1-h6 / li / blockquote / pre / figure / table`（**清單以 li 為焦點單位、不收 ul/ol 容器**——newsletter 類 ol 每個 li 是完整段落，收容器會讓 Space 一次跳過整列；排除 data-jread-hidden 子樹、巢狀取最外層、零高度跳過）+ **照片以每張為單位**：多圖容器（含 >= 2 張高度 >= 40px 內容圖、扣除 figcaption 後正文 < 100 字 = 圖庫）讓位給個別 img/video；單圖 figure 整塊當單位（含圖說）；文字段落內插圖不拆；未被任何已收單位覆蓋的內容圖一律獨立成單位（保證不漏圖）、合併後依文件順序排序；手動卷遠（焦點段落離開 viewport）或焦點段落被 SPA 移除後按 Space 重新錨定到可視區第一段。**滑鼠點擊主文內任一段 → 指示條跳到該段**（click capture listener、純觀察不 preventDefault，連結點擊 / 文字選取照常；li 內文字點擊歸最外層 li），之後 Space 從該段接續。放行條件同 keyguard（IME / INPUT / TEXTAREA / SELECT / BUTTON / contenteditable focus），alt / ctrl / meta 修飾鍵不攔；listener 註冊順序必須在 keyguard 之前（keyguard 對非 ESC 鍵 stopImmediatePropagation，main.js wrapper 維護 invariant）。cinema / borderless 模式不裝（YouTube space = play/pause）。storage.onChanged 即時生效。**與 styler v0.7.91 onSpaceScroll 的關係**：模組啟用時 styler 的 SPACE = scrollBy 92% fallback 讓位（onSpaceScroll 開頭檢查 `NS.spaceScroll.isInstalled()`）；ratio = 0 時 fallback 自動回歸——「0 = 停用」實際語意是「回到 v0.7.91 整頁卷動」而非純原生 |
| `pagedMode` | `boolean` | `false` | `storage.sync` | ✅（popup「翻頁模式」checkbox，v0.7.227）——電子書式水平翻頁，詳見核心功能表「翻頁模式」row。嚴格 `=== true` 才啟用（storage 損壞 / 外部寫入非 boolean 視為關）。storage.onChanged 即時切換（走 scheduleReapply：styler 重建 stylesheet + 模組 install/uninstall，閱讀模式開啟中也能直接生效；字級/版心調整時模組重算頁數並按比例回原位）。垂直模式（預設）零行為差異——翻頁 CSS 區塊只在 true 時注入 |
| `showPageNumber` | `boolean` | `true` | `storage.sync` | ✅（popup「頁碼指示」checkbox，v0.7.237，僅翻頁模式開啟時顯示該 row）——翻頁模式底部「目前頁 / 總頁數」指示器開關。預設 true（嚮後相容：原本一律顯示）；`!== false` 視為顯示。storage.onChanged 走獨立輕量路徑 `NS.pagedMode.setShowIndicator`（純顯示層、直接增/移除指示器 DOM，不走 styler full reapply，避免捲動→翻頁閃爍）。翻頁模式未啟動時無感 |
| `pangu` | `boolean` | `true` | `storage.sync` | ✅（options 「中英文間自動補空白 + 中文標點全形化」，v0.7.153 / v0.7.158）—— reader mode 啟動時掃 articleEl 所有 text node：(1) CJK ↔ 英數字 / % / ° 邊界補空白；(2) v0.7.158 新增 CJK 邊界的半形標點 `, . : ; ? !` 轉成 `，。：；？！`，半形括號 `( )` 兩側緊鄰 CJK 時轉 `（）`，引號不在此規則；中文 prose text node 內 ASCII↔ASCII 邊界的半形逗號也轉全形，但**數字千分位逗號**（兩側皆數字，如 `3,610` / `3,610,000`）保半形（v0.7.213，數字格式非標點）；跳過 `<code>` / `<a>` / `<input>` / contenteditable 等 |
| `autoEnableDomains` | `string[]` | `[]` | `storage.sync` | ✅（v0.7.155 options 「自動啟動網域」textarea + popup 「此網域自動啟動」checkbox）—— 命中網域時 content script document_idle 自動 silent enterReaderMode；matching rule：`hostname === pattern OR hostname.endsWith('.' + pattern)`（`abc.com` 涵蓋 `www.abc.com` / 子網域；`www.abc.com` 只匹配自身，不含 `123.abc.com`） |
| `customShortcuts` | `object` | 三 key 全 `null` | `storage.sync` | ✅（v0.7.218 options 「快速鍵」recorder）—— key 與 manifest commands 同字彙（`toggle-reader-mode` / `send-to-readwise` / `toggle-youtube-borderless`）；value = `{ code, alt, shift, ctrl, meta }`（`e.code` 實體鍵位 + modifier booleans）或 `null`（未自訂）。比對在 `content/custom-shortcuts.js` keydown capture listener；v0.7.228 起 toggle 類指令命中後直接走 content 端 `NS.dispatchLocalCommand`（本地 dispatch、SW 死活無關——iOS Safari SW 被回收後不再喚醒），send-to-readwise（API 呼叫住 SW）仍送 `CUSTOM_COMMAND` 給 SW。動機：Safari（含 iOS / iPadOS 外接鍵盤）沒有瀏覽器層改鍵入口，options recorder 是唯一通道。validate 規則：必含 ⌥ 或 ⌃、拒絕 ⌘ 組合（content script 搶不過瀏覽器/系統）、拒絕 ESC（保留退出）、拒絕與內建預設鍵相同（browser 層停不掉、雙觸發 = toggle 兩次）、拒絕與其他指令生效鍵衝突。已知限制：位址列 focus / content script 沒注入的頁面自訂鍵無效（manifest 預設鍵不受此限，作為 fallback） |
| `lastDetectedForUrl` | `object` | `{}` | `storage.local`（快取） | ❌（內部用） |

---

## 訊息協定（content ↔ background ↔ popup）

待實作時補上。目前已知需要：

- `popup → content`：`TOGGLE_READER_MODE` / `GET_READER_STATE`（v0.7.33）/ `EXTRACT_READER_HTML`（v0.7.33）
- `content → popup`：`REPORT_DETECTION_RESULT`（偵測到/沒偵測到、信心分數）
- `popup → background`：`GET_SETTINGS` / `UPDATE_SETTINGS` / `SAVE_TO_READWISE`（v0.7.33）。**v0.7.235**：content 端 `getSettings` 不再走 `GET_SETTINGS` round-trip——改直讀 `chrome.storage.sync.get(defaults)`（defaults 來自 `content/settings-defaults.js` 單一資料源）；iOS Safari background 訊息會無聲掉包（thread 758346 / 787958），掉包時舊版回 `undefined` → 所有設定 fallback 預設值（pagedMode 永遠 false = 「翻頁模式 iOS 沒功能」根因）。`GET_SETTINGS` handler 保留，僅作 content 端 storage 失效（context invalidated）時的 fallback
- `content → background`：`CUSTOM_COMMAND`（v0.7.218，自訂快速鍵命中；payload `{ command }`，SW 白名單驗證後走 `dispatchCommand`。v0.7.228 起僅 send-to-readwise 與 fallback 場景使用——toggle 類指令與 3 指輕點改走 content 端本地 dispatch，不再過 SW）
- `background → content`：`DISPATCH_COMMAND`（v0.7.228，manifest 預設鍵路徑：SW `dispatchCommand` 委派 content 端 `dispatchLocalCommand`（含 cross-mode 重導、單一資料源）；payload `{ command }`，content 端白名單 toggle-reader-mode / toggle-youtube-borderless）

**`GET_READER_STATE` response 結構**（v0.7.133 擴充）：

```
{
  active:       boolean,  // reader OR cinema 任一啟動
  cinemaActive: boolean,  // 是否處於 cinema mode（YouTube 專用）
  siteMode:     'youtube-cinema' | 'article' | null
                          // 當前頁面型態——popup 用來切按鈕文字 +
                          // 控制 Readwise 按鈕可見性
}
```

---

## Readwise Reader 整合（v0.7.33）

popup 加「送到 Readwise Reader」按鈕，把 JRead 處理過的乾淨主文 outerHTML 送到使用者的 Readwise Reader 帳號。動機：Readwise 的官方 extension 在某些難解析的頁面（重 JS、奇異 DOM）會失效，而那些頁面 JRead 多半已經處理乾淨。

### API

- Endpoint：`POST https://readwise.io/api/v3/save/`
- Header：`Authorization: Token <user_access_token>`
- Body：`{ url, html?, title?, image_url?, author?, published_date? }`（除 `url` 外皆可省，Readwise 會自抓，但帶上 JRead 處理過的欄位才能繞過原站 parser 問題與補強冷門站缺漏 metadata）
- 回傳：`200`（已存在）/ `201`（新建）
- **注意**：Readwise Reader API 沒 `language` 欄位（送了會被忽略），JRead 不抽 / 不送 `language`。

### 欄位抽取策略（v0.7.166–167）

- **`image_url`（v0.7.166）**：`main.js extractHeroImage(articleEl)` — reader card 內第一張通過 200×200 / 200×120 門檻的 visible `img`（不在 `[data-jread-hidden]` 子孫內，srcset 取最大解析度 entry）→ fallback `meta[property="og:image"]` / `og:image:url` / `og:image:secure_url` / `meta[name="twitter:image"]` / `twitter:image:src`。URL 必須 absolute `http(s)`,`data:`/`blob:`/相對路徑略過。
- **`author`（v0.7.167）**：`main.js extractAuthor()` — 三條分支：
  - Facebook 合成 reader（`[data-jread-fb-reader]`）：`NS.fbPost.extractAuthorVanityFromUrl()` 抽 `/<user>/posts/<id>` 第一段 vanity username,reserved path(`groups` / `permalink.php` / `story.php` / `share` / `profile.php` / `permalink` / `people` / `pages`)沒 vanity → fallback 讀合成 header `[data-jread-fb-author] strong` 的 displayName。
  - X / Twitter 合成 reader（`[data-jread-x-reader]`）：`/<handle>/status/<id>` → `@handle`（hostname 嚴格比對 `x.com` / `twitter.com`,防 hostname 混淆攻擊）。
  - 一般網站:JSON-LD `Article.author.name`（含 `string` / `object` / `array` / `@graph` 多 schema）→ `meta[name="author"]` → `meta[property="article:author"]`（filter `^https?://` URL 形式）→ byline 元素：`[itemprop="author"] [itemprop="name"]` / `[itemprop="author"]` / `[rel="author"]` / `.byline-author` / `.author-name` / `.byline .author` / `.byline`。文字長度 >= 100 字拒絕（避免抓到段落）。
- **`published_date`（v0.7.167–168）**:`main.js extractPublishedDate()` 三條分支(v0.7.168 加 FB / X 分流):
  - Facebook 合成 reader(`[data-jread-fb-reader]`):**不送**——FB DOM 結構性沒絕對日期(只有「N 分鐘前」相對時間 `aria-label`),倒推精度不夠 Jimmy 寧可空白。
  - X / Twitter 合成 reader(`[data-jread-x-reader]`):從合成容器第一個 `:scope > article`(主推文 clone,`x-thread.js collectThreadArticles` 排序保證)取**最後一個** `<time datetime>` —— X 主推文 article 內若有 quoted tweet,quoted 時間在前、主推文 timestamp 在後;沒 quoted tweet 時只 1 個 time 也是主推文。**不退回** document head meta(X 整站共用 OG metadata 無法代表單則推文)。
  - 一般網站:JSON-LD `datePublished` / `dateCreated`(含 `@graph` 巢狀)→ `meta` 變體(`article:published_time` / `pubdate` / `publishdate` / `date` / `DC.date` / `DC.date.issued` / `itemprop="datePublished"`)→ `<time datetime="...">` 第一個 parseable。一律 `new Date(raw).toISOString()` 正規化為 UTC ISO 8601(純日期 `2026-05-22` → `2026-05-22T00:00:00.000Z`;含時區 `+08:00` 自動轉 UTC)。

### 設定

- 欄位：`readwiseToken`（string，預設 `''`），存於 `chrome.storage.sync`
- 取得方式：`https://readwise.io/access_token`
- 設定位置：options 頁「Readwise Reader 整合」區塊（password input）

### Popup UI 行為

- 「送到 Readwise Reader」按鈕放在「切換閱讀模式」下方，次級樣式（白底灰邊）
- popup 開啟時透過 `GET_READER_STATE` 查 reader mode 狀態：
  - 未啟動 → button disabled，title `先啟動閱讀模式才能送出`
  - 已啟動 → button enabled
  - 頁面不支援（chrome:// 等 sendMessage reject）→ button disabled
- 點擊：popup → content（`EXTRACT_READER_HTML` 抽 outerHTML + url + title）→ popup → SW（`SAVE_TO_READWISE` 帶 payload）→ SW 讀 token + fetch + 回結果
- 狀態條訊息：`已送到 Readwise Reader` / `已存在於 Readwise Reader` / `尚未設定 Readwise token` / `Readwise token 無效或已過期` / `網路錯誤` / `送出失敗（HTTP N）`

## 自動啟動網域（v0.7.155）

使用者可指定一份網域清單，命中時頁面載入即自動進入閱讀模式，不需手動按 popup 或快速鍵。動機：經常閱讀的特定新聞網站每次都按一次切換太繁瑣，列入清單後 content script document_idle 就 silent enterReaderMode。

### Matching 規則

- **本身或子網域**：pattern `'abc.com'` 命中 `abc.com`、`www.abc.com`、`foo.abc.com`、`a.b.abc.com`（所有以 `.abc.com` 結尾的 hostname）。
- **只本身**：pattern `'www.abc.com'` 命中 `www.abc.com`，**不**命中 `123.abc.com`（兄弟子網域，因 `123.abc.com` 不 endsWith `.www.abc.com`），也**不**命中父網域 `abc.com`。
- **形式**：`hostname === pattern OR hostname.endsWith('.' + pattern)`，大小寫不敏感。
- **正規化**：input 自動 lowercase、去 scheme（`https://`）、去 path / query / hash、去 port、去前後 dot。`https://www.abc.com/news/123` → `www.abc.com`。

實作：`jread/content/domain-match.js`，IIFE 掛 `window.__JReadDomainMatch`（content script / popup / options 共用）+ CommonJS 匯出（regression spec 直接 require）。

### 設定 UX

兩個入口共用同一份 `storage.sync.autoEnableDomains` 陣列：

1. **Options 頁「自動啟動網域」textarea**：完整清單管理，一行一個網域。`change` 事件（blur 觸發）才寫 sync，避免每按一鍵踩配額。正規化後寫回 textarea 讓使用者看到實際生效形式。
2. **Popup「此網域自動啟動」checkbox**：當前 tab 是 http/https 才顯示 row（chrome:// / file:// / about: 隱藏）；顯示目前 hostname 在 label 旁的 mono 字小字。
   - **Toggle ON**：把當前 hostname 加進清單（若 helper `matchHostname` 已回 true 則不重複加）
   - **Toggle OFF**：呼叫 `removeMatching` 移除清單中**所有**會命中此 hostname 的 entry（含更寬的 pattern 如 `abc.com`）—— 確保關閉後此頁面真的不會再 auto-enter

兩端透過 `chrome.storage.onChanged` 跨 tab 即時同步：options 編輯時 popup 已開啟也會立刻反映、反之亦然。

### Auto-enter 行為

- **觸發點**：`jread/content/main.js` IIFE 末尾 `tryAutoEnableOnLoad()`，document_idle 時 read settings → `matchHostname(location.hostname, list)` → 命中即 `enterReaderMode({ silent: true })`
- **iframe guard**：`window.top !== window.self` 直接 return，避免 iframe 內 hostname 命中導致一頁多次觸發
- **silent flag**：偵測失敗時**不**彈「此頁無法偵測主文」toast（使用者沒主動按、彈錯誤反而干擾）。手動 toggle / 快速鍵走無 silent 路徑、行為不變。
- **SPA 路由**：不額外處理。content script 每次完整頁面 navigation 重新注入，這層就是天然的「頁面載入」時點。SPA 內部 history.pushState 切頁不會重觸發（與整個 extension 一致）。

## YouTube Cinema Mode（v0.7.133）

YouTube watch page 沒主文可閱讀（detector 預設 no-op），但 YouTube 原生缺一個 niche 場景：viewport-width video 上下置中、黑背景、仍在 browser tab 內（不像 fullscreen 整個吞掉 browser chrome）。Cinema mode 補這個 gap，跟 reader mode 共用同一個 toggle（`Alt+R` / popup 按鈕），由 detector 依站點 dispatch。

### 觸發條件

`isYouTubeWatch(url)`（`jread/content/cinema-mode.js`）：

- hostname 必須是 `youtube.com` / `www.youtube.com` / `m.youtube.com`（排除 `youtube-nocookie.com` 等 embed-only 變體）
- pathname 必須是 `/watch`（排除 `/shorts/` 9:16 / `/@channel` / `/results` / 首頁 `/`）

只有「watch page」一條路徑命中——`/shorts` 是 9:16 影片、`/live` 有 chat sidebar、`premiere` 有倒數階段，這些 cinema CSS 套上去會破，明確 no-op。

### 注入內容

`NS.cinema.enter()` 注入 `<style id="__jread_cinema_style">` 含：

1. **隱藏雜訊**：`ytd-masthead` / `ytd-comments` / `ytd-watch-metadata` / `#meta` / `#info` / `ytd-engagement-panel-section-list-renderer` / `ytd-popup-container` / `ytd-merch-shelf-renderer` 等容器
2. **隱藏 player 內部浮層**：`.ytp-ce-element` / `.ytp-cards-teaser` / `.ytp-suggested-action` / `.ytp-mealbar-promo-renderer` / `.ytp-paid-content-overlay`（autoplay endscreen card / 卡片提示 / 訂閱推薦等 transient 浮出元素）
3. **背景塗黑**：`ytd-page-manager` / `ytd-watch-flexy` / 容器鏈一律 `background: #000`，避免白底透出
4. **player 釘中央**：`#movie_player` `position: fixed + top/left: 50% + transform: translate(-50%, -50%)`，繞過 `ytd-watch-flexy` 的 `#columns` flex layout（從上層 flex-center 反而會跟 player 自己的絕對定位打架）
5. **雙軸 clamp 16:9**：`width: min(100vw, 177.78vh); height: min(56.25vw, 100vh)`，寬高任一觸到 viewport 都不溢出
6. **`dispatchEvent(new Event('resize'))`**：YouTube 內部 resize handler 算 `<video>` 的 inline width/height；不 dispatch resize 會讓 video tag 仍是舊 size、畫面全黑

### SPA navigation

YouTube 切影片不 reload，content script 不會重跑。`NS.cinema.enter()` 同時 `window.addEventListener('yt-navigate-finish', onYtNavigate)`，切影片時 dispatch resize 讓 YouTube 重算 player layout。離開 watch page（切到首頁 / 頻道 / 搜尋）使用者要自己按 toggle 退出（或 ESC）——cinema mode 沒設計成自動 exit-on-navigate，因為使用者切影片時通常還是想保持 cinema 模式。

### 退出

ESC 鍵（`onEscKey` listener 共用，跟 reader mode 一致）或 popup「退出影院模式」按鈕；`NS.cinema.exit()` 移除 style + 清 `data-jread-cinema-active` attribute + uninstall yt-navigate-finish listener。

### 不適用 / 不啟動的設計

- **不 install keyguard**（v0.7.131 reader mode 攔截原站快速鍵的機制）：YouTube 的 j/k/l/space/f/m/`<`/`>` 是 player 控制必備（快轉、暫停、全螢幕、靜音、變速），攔下去會打殘觀影體驗。reader mode 才需要擋 Gmail j archive 那類「字符快速鍵 = 破壞性操作」場景。
- **不跑 cleaner/styler**：cinema mode 沒主文容器（`detect()` 回 `el: null`），main.js 直接走 `enterCinemaMode()` helper 不碰 cleaner/styler。
- **不支援 Readwise**：cinema mode 沒主文 outerHTML 可送，popup 端 readwise 按鈕在 `cinemaActive` 時強制 `hidden`；`EXTRACT_READER_HTML` 回 `{ ok: false, reason: 'NOT_APPLICABLE_IN_CINEMA' }` 作防呆。

### Popup 按鈕文字切換

`refreshPopupForActiveTab()` 開啟 popup 時 `chrome.tabs.sendMessage(tabId, { type: 'GET_READER_STATE' })`，依 response 的 `siteMode` 切按鈕文字：

- `siteMode === 'youtube-cinema'`：`cinemaActive=false → '啟動影院模式'`、`cinemaActive=true → '退出影院模式'`
- 其他站維持 `popup.html` 的 default `切換閱讀模式`（不動）

### 與 reader mode 的關係

- 共用同一 toggle 入口（`TOGGLE_READER_MODE` message / `Alt+R` 快速鍵 / popup 按鈕）
- 共用同一 `NS.state.active` flag（true 代表任一 mode 啟動）+ 新增 `NS.state.cinemaActive` 區分
- 共用同一 ESC 退出 handler
- 不共用 cleaner / styler / Readwise / keyguard

### 已知限制

1. **harness 驗收受限**：Playwright YouTube watch page 易被 bot detection 擋（player 不 load），cinema mode 行為倚賴 chrome-in-chrome MCP 真實 YouTube 環境手動驗（probe Step 1 已驗 2026-05-18）。
2. **未支援的 YouTube 變體**：`/shorts/`（9:16）、`/live`（chat sidebar）、premiere 倒數階段——spec 明確只 match `/watch`，其他 no-op。
3. **endscreen card 殘留可能**：YouTube 偶爾在影片進度條接近結束時跳出 autoplay countdown overlay，雖 CSS 已 hide `.ytp-ce-element` / `.ytp-cards-teaser` / `.ytp-suggested-action`，新版 YouTube 若改 class name 命名 cinema mode 可能漏網——回報時補 selector 即可。

---

## YouTube Borderless Mode（v0.7.134）

從 Shinkansen `SK.YT.Borderless` 移植過來的第二個 YouTube watch page 沉浸模式，跟 cinema mode **完全獨立**。動機：cinema mode 釘 player 在 viewport 中央 + 16:9 雙軸 clamp（保留 browser chrome、不動視窗大小）；borderless mode 走相反方向——影片完全填滿整個視窗、視窗高度被 resize 成匹配影片比例（最沉浸但會動 OS 視窗）。兩者使用情境不同，用什麼由使用者決定。

### 觸發方式

兩條入口、互不依賴：

1. **快速鍵**：manifest 註冊 `toggle-youtube-borderless` 命令但**無 suggested_key**——使用者到 `chrome://extensions/shortcuts` 自行綁。SW `commands.onCommand` 收到後 `chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_YT_BORDERLESS' })` 轉給 active tab。
2. **popup 按鈕**：popup `refreshPopupForActiveTab` 偵測 `siteMode === 'youtube-cinema'`（即任何 YouTube watch 頁）時露出 `#borderless-btn`，按鈕文字依 `borderlessActive` 切「啟動 / 退出無邊模式」；click 後 sendMessage `TOGGLE_YT_BORDERLESS`。

非 YouTube watch 頁 `NS.borderless.toggle()` 自己 no-op，popup 按鈕也不顯示。

### 注入內容

`NS.borderless.apply()` 注入 `<style id="__jread_borderless_style">` 含：

1. **隱藏所有 YouTube UI**：`ytd-masthead` / `#masthead-container` / `#secondary` / `ytd-watch-metadata` / `#below` / `#comments` / `#related` / `#chat` / `ytd-merch-shelf-renderer` / `ytd-engagement-panel-section-list-renderer`
2. **強制 theater 模式**：`snapshotAndSetTheater()` 紀錄原本 `ytd-watch-flexy[theater]` 狀態 + 強制 setAttribute（exit 時若原本沒 theater 才 removeAttribute）
3. **影片撐滿視窗**：`#movie_player` / `#ytd-player` / `.html5-video-player` / `.html5-video-container` 設 `width: 100vw / height: 100vh / position: relative`；`video.html5-main-video` 同步 inline `width/height: 100vw/100vh + object-fit: contain`
4. **`html, body` 黑底 + 隱藏 overflow**：避免捲軸跑出來

### 視窗 resize（核心差異化機能）

`requestResize()` 從 `<video>.videoWidth / videoHeight` 取得真實影片比例，算出 outer 高度 = `round(innerWidth / ratio) + (outerHeight - innerHeight)`，bound 在 `[200, screen.availHeight * 0.8]`。content side 不能直接動視窗，必須透過 SW `RESIZE_OWN_WINDOW` 訊息呼叫 `chrome.windows.update(windowId, { height })`。

失敗（install-as-app PWA 限制 / windowId 不在 / Chrome 版本不支援）`.catch()` 沉默吞掉——CSS 已套上、影片以 `object-fit: contain` 顯示（可能上下/左右黑邊但仍可看），不需要 escalate 給使用者。

### SPA navigation

`apply()` 時掛 `yt-navigate-finish` listener：

- 切到別支影片（仍在 `/watch`）：`setTimeout(() => apply(), 500)` 等 YouTube 內部把新 player DOM 建好再重套
- 切到非 watch 路徑（首頁 / 頻道 / 搜尋）：撤掉 CSS + 清 video inline + reset `prevTheaterValue`，但**保留 `active` flag**——切回 `/watch` 時自動重套（跟 Shinkansen 一致）

### 與 cinema mode 的關係

| 軸 | cinema mode（v0.7.133） | borderless mode（v0.7.134） |
| --- | --- | --- |
| 狀態 flag | `NS.state.cinemaActive` | `NS.borderless` 內部 `active`（不在 `NS.state`） |
| 共用 toggle 入口 | 是（`TOGGLE_READER_MODE` / `Alt+R`） | 否（自己一條 message + command） |
| 動視窗大小 | 否 | **是**（`chrome.windows.update`） |
| 強制 theater | 否 | 是 |
| 退出方式 | ESC / popup 按鈕 | popup 按鈕 / 快速鍵 |
| Readwise 整合 | 不適用 | 不適用 |
| keyguard | 不 install | 不 install（保留 YouTube player shortcut） |

兩者**完全獨立、可同時 toggle**。共同 CSS target 是 `#movie_player`——同時 active 時最後注入 / 最高 specificity / `!important` 的 rule 勝出（cinema 的 `position: fixed + clamp` 與 borderless 的 `position: relative + 100vw/100vh` 互斥，呈現結果視 cascade order 而定）。使用者該擇一啟用，spec 不驗它們的互動。

### 已知限制

1. **harness 驗收受限**：與 cinema mode 同樣的限制——Playwright YouTube watch page 易被 bot detection 擋；視窗 resize 部分還需要真實 OS window manager 才能驗（Playwright headed mode 視窗 detached/embedded 行為與真實 Chrome 不一致），實機驗證為主。
2. **install-as-app / PWA 限制**：使用 Chrome 「install as app」把 YouTube 裝成獨立視窗時，`chrome.windows.update` 對 PWA window 可能無效——`.catch()` 吞掉、CSS 仍生效但 letterboxing 黑邊。
3. **跨 OS 行為差異**：macOS Chrome 視窗最小高度約 200px、Windows / Linux 可能更低；`calcTargetWindowHeight` 用 200 作 minOuter 保守值。
4. **SPA navigation reset theater flag**：切到非 watch 路徑時 `prevTheaterValue` 被 reset，切回再 toggle off 時無法判斷「原本是否在 theater」，可能多 removeAttribute 一次（無副作用，YouTube 自己會 idempotent）。

---

## X / Twitter status thread reader（v0.7.135）

X / Twitter 的 `/<user>/status/<digits>` URL 透過**合成 reader 容器路線**支援。動機：X status 頁 DOM 是 timeline 結構（`[data-testid="cellInnerDiv"]` 平鋪：主推文 + 一堆別人 reply + 推薦 follow 卡），既有 detector 把 8 個 `article[role="article"]` 視為列表頁降級 no-op。Jimmy 2026-05-18 明確要支援「同作者連續推文 = X 原生 thread」，replies 全清。

### 觸發條件

`isXStatusPage(url)`（`jread/content/x-thread.js`）：

- hostname：`x.com / www.x.com / mobile.x.com / m.x.com / twitter.com / www.twitter.com / mobile.twitter.com / m.twitter.com`
- pathname：`^/<username>/status/<digits>`（後可接 `/photo/1` `/analytics` 等變體）

非 `/status/` 子路徑（首頁 / 使用者頁 `/<user>` / 通知 `/notifications` 等）均不命中。

### 注入機制

`NS.xThread.enter()`：

1. `extractStatusId(url)` 從 URL 抓 status digits
2. `findMainTweet(statusId)` 遍歷 `document.querySelectorAll('article[role="article"]')`，命中含 `a[href*="/status/<ID>"]` 的 article 即主推文（X 把該連結作為時間戳）
3. `collectThreadArticles(mainArticle)`：從主推文 `closest('[data-testid="cellInnerDiv"]')` 往前後 walk sibling cell，每個 cell 跑「同作者連續」判定（`getAuthorHandle(art)` 讀第一個 `[data-testid="User-Name"] a[href^="/"]`，跳過 `/status/` 時間戳）；任一方向遇到「非 cellInnerDiv 兄弟」「cell 無 article」「不同作者」即停該方向擴張
4. 建合成 `<article data-jread-x-reader>`，深 clone `cloneNode(true)` 每個 thread article 進去
5. `document.body.insertBefore(container, document.body.firstChild)` 注入 body 開頭——讓 `hideAncestorSiblings` 自然清掉所有原 X UI（masthead / sidebar / 留言 / 推薦 / footer）為合成容器的兄弟

### 跟既有流程的銜接

合成容器是「正常 `<article>` 元素」，articleEl 設成它之後既有所有規則 0 fork 全沿用：

- `cleaner.clean(container)` 跑全套規則：`hideInsideArticleAllButtons` 砍 reply/retweet/like/分析 等按鈕、`hideInsideArticleByLinkText` 命中「Follow」「Subscribe」「N hours ago」等文字
- `styler.apply(container, settings)` 套讀者卡片排版（max-width / margin / padding / background / 字體）
- `extractReaderPayload()` 抽合成容器 outerHTML 給 Readwise
- `installKeyguard()` 攔截 X 的 j/k/l/r 等 keyboard-shortcut

### 退出

`exitReaderMode()` 走既有路徑（styler.restore + cleaner.restore + 各種還原），最後呼叫 `NS.xThread.exit()` 移除合成容器。

### 與 cinema / borderless mode 的關係

X status 是純 reader mode 分支（合成 articleEl + 跑 cleaner/styler），跟 cinema / borderless 完全不同維度——cinema / borderless 是注入全頁 CSS、不動 articleEl 流程。siteMode 在 X status 場景回 `'article'` 讓 popup 視為普通可閱讀頁（按鈕啟用 + Readwise 顯示），不需要新增 `'x-thread'` siteMode。

### 已知限制

1. **SPA navigation 不自動重套**：X 切貼文不 reload、本版未加 `popstate / pushState hook`，使用者切到另一則 status 需手動 toggle off + on
2. **引用推文 (quoted tweet) 一起 clone**：X 用 nested `<article>` 嵌入 quoted tweet，`cloneNode(true)` 會把它連同主推文一起帶進來——視覺保留，但 cleaner 規則對 nested article 可能不完全 idempotent；目前實測 OK
3. **lazy-load 圖片**：X 圖片若是 lazy-load 未觸發狀態（推文還沒進主視窗），clone 後可能無 src；通常推文進 viewport 時就已 load，主推文圖片可正常顯示
4. **harness 驗收受限**：X 易被 bot detection 擋；chrome-in-chrome MCP 不需要 login 即可看到 thread DOM，是主要驗證管道

---

### 為何 fetch 放 SW 而非 popup

popup 關閉後其 fetch 會中斷；放 SW 即便使用者立刻關掉 popup，fetch 仍會跑完。SW 透過 `sendResponse` 回 popup（若 popup 已關則 silently drop，但伺服器端已收到）。

### 純函式抽離

`jread/popup/popup-core.js` 暴露 `buildReadwisePayload` / `saveToReadwise`（依賴注入 fetchImpl），可被 popup（瀏覽器端）與 SW（importScripts）共用、Node 端直接 require 做單測。`test/regression/readwise-save.spec.js` 14 條 spec 覆蓋 payload 結構 / NO_TOKEN / AUTH(401) / HTTP(500) / NETWORK / 成功 200/201 + forcing function 比對 namespace.js / SW 訊息協定常數。

---

## 測試策略

- `test/version-check.spec.js`：forcing function，`EXPECTED_VERSION` 常數每次 bump 必須同步更新
- `test/regression/`：每修一個 bug 補一個 fixture + spec（見 `CLAUDE.md` 硬規則 4）
- `test/PENDING_REGRESSION.md`：抽不出最小重現結構時的待辦佇列

---

## 已知風險 / 待決議

- Readability.js 要不要整包引入，還是自己寫簡化版？
- SPA 導航（Medium、Substack）的 content script 重觸發時機
- 某些新聞網站有「文章分頁」機制，要不要處理？（MVP 範圍外）
- **授權策略**：不參考 Unclutter 原始碼（AGPL-3.0），走 clean-room——只讀 docs、自行實作。JRead 本身未來授權由 Jimmy 決定。

---

## 已驗證站點

實測過主文偵測策略在真實頁面上可否命中、雜訊隱藏規則是否會誤殺內文。每條紀錄包含測試日期、頁面類型、主文容器 selector、特殊注意事項。

### 商業周刊（businessweekly.com.tw）

- **測試日期**：2026-04-21
- **測試頁面**：`/Archive/Article?StrId=7014035`
- **主文容器**：`<article class="article">`（`<article>` 優先策略直接命中）
- **內文結構**：`article.article > div.postbody > { <summary>, <figure.articlephoto>, #DivArticleIndexGetMore }`
- **雜訊清單**：
  - 頁面外：`#header`、`nav.nav`、`#burger-nav`、`.footer-wrap`（語意標籤通則命中）
  - Sticky：`.postnav.fixed`、`#progress-wrapper`、`#gdrp-el`、`.Floating-Setting`、`#shortModel`（fixed 通則命中）
  - 主文內：`div.postbody.paywall`、`#Epaper-subscribe`（keyword `paywall` + `subscribe` 命中）
- **需要保留的特殊元素**：
  - `<summary>`（editor bullets，兩行文章提要）
  - `figure.articlephoto`（主圖 + figcaption）
  - `div.articlbox`（「小檔案」可摺疊資訊卡，強制展開即可，不需保留 JS 互動）
- **付費文章**：內文只有免費摘要 ~540 字，偵測正常不代表擷取到完整文章——這是站點本質，不是偵測失敗

### Stratechery（stratechery.com）

- **測試日期**：2026-04-21
- **測試頁面**：`/2026/please-listen-to-my-podcast/`
- **主文容器**：`div.wp-block-column`（左欄）——由 heuristic bubble-up 選中 `div.entry-content` 後，title promote 升級到左欄共同 parent
- **DOM 結構**：整頁**完全沒有 `<article>` tag**，WordPress 用 `<main>` > `div.wp-block-columns` 做 2 欄 layout，左欄含 `h2.wp-block-post-title` + `div.entry-content` + related/prev-next，右欄含 `div.wp-block-column.stratechery-sidebar` > `<aside>`
- **雜訊清單**：
  - 右欄 sidebar 全欄（search、Strategy Plus、UPDATES、PODCASTS、INTERVIEWS 列表）→ 由 cleaner 的 ancestor-sibling 規則清除
  - 頁面外：site `<header>` / `<footer>` / site-level nav → 語意標籤通則命中
- **觸發新規則**：
  - heuristic bubble-up（取代原「計後代 p 總數」）——避免站體外殼贏過主文
  - title promote——Stratechery 把 post-title 放在 entry-content 兄弟層，需把主文升級到共同 parent 保留標題
- **需要保留的特殊元素**：`h2.wp-block-post-title` 文章標題、主圖 `<figure>` + figcaption

### Dwarkesh Podcast（dwarkesh.com，Substack podcast-post）

- **測試日期**：2026-04-21
- **測試頁面**：`/p/jensen-huang`
- **主文容器**：`<article class="typography podcast-post post shows-post">`（article-tag 策略直接命中，不 narrow）
- **DOM 結構**：Substack 把 `<article>` 包住整個 2-col layout：`article > div > { container-dlhqPD (video-wrapper), main-content-and-sidebar-fw1PHW }`；後者是 `display: flex; flex-direction: row` 的左欄主文 + 右欄 sidebar
- **觸發新規則**：
  - `hideInsideArticleSidebarColumns`（v0.6.8）——主欄文字 2212 / linkDensity 0.013 vs sidebar 文字 155 / linkDensity 0.67，結構性 2-col 特徵命中
  - `hideInsideArticleEmptySpacers` / `hideInsideArticleActionRows` 對 `iframe`/`video`/`audio` tag early-skip（v0.6.8）——避免 cross-origin YouTube iframe 被當空殼誤殺
- **雜訊清單**：
  - 右欄 sidebar（Dwarkesh Podcast 卡片 + Listen on 連結堆 + Appears in episode + Recent Episodes 連結堆）→ 由 v0.6.8 新規則清除
  - 頁面外：site `<header>` / `<footer>` / site-level nav → 語意標籤通則命中
- **需要保留的特殊元素**：
  - `.container-dlhqPD > .video-wrapper-lforaE` 內的 `<video>`（Substack 原生 podcast player）
  - `.youtube-wrap > .youtube-inner > iframe[src*="youtube-nocookie.com/embed"]`（YouTube 縮圖 embed，點了才 load 真正播放器）
  - 標題 / 副標 / 作者 / 日期 / 贊助商段落 / 內文段落
- **切斷點**：主文在「Me too.」對話結尾後乾淨結束。`<div id="discussion">` 包住的整塊留言區（含 H4「Discussion about this video」+ `<textarea>` 留言表單 + `.comment-list-items`）由 v0.6.9 keyword heuristic 命中 hide（`#discussion` id 含 `discussion` 字樣）

---

## 變更紀錄

見 `CHANGELOG.md`。
