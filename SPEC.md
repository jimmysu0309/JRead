# SPEC.md — JRead 專案規格

> 這是 JRead Chrome Extension 的完整規格。Claude 開始任何工作前必讀。
> 協作規則另見 `CLAUDE.md`。

---

## 目前 Extension 版本

最新：**v1.0.1**。詳細修法見 [`CHANGELOG.md`](CHANGELOG.md) 頂部條目；`package.json` / `jread/manifest.json` 為真實版本號來源（`test/version-check.spec.js` forcing function 強制四邊同步：manifest / package.json / SPEC / CHANGELOG）。

### Baseline（當前所有修法的不可退讓底線）

**當前 baseline：v0.7.135**（2026-05-13 起，Jimmy 在 cn.nytimes col-* margin reset 修法完成後明確指定為新基準；v0.7.135 在此之上新增 X / Twitter status thread 支援）。承接 v0.7.32 的所有能力 + 累積 v0.7.33–128 的 cleaner / styler edge case 修法 + v0.7.133 新增 YouTube Cinema Mode + v0.7.134 新增 YouTube Borderless Mode（從 Shinkansen 移植，與 cinema mode 完全獨立）+ v0.7.135 新增 X / Twitter status 頁合成 reader 容器支援（thread = 同作者連續推文）。往後 edge case 維修以此版的視覺成果與測試覆蓋為不可退讓底線。

**v0.7.134 baseline 包含**（在 v0.7.32 之上累積，完整修法紀錄見 `CHANGELOG.md`）：

1. **styler 瘦身不變**（承接 v0.6.0 / v0.7.32 精神）：字型 / heading margin / p margin / list style / link color / blockquote border **全部保留原站樣式**；styler 只注入讀者卡片容器 + 祖先鏈 reset + 必要 hack + 使用者 override。
2. **styler 增強**：cardArticle rule selector 加 `html` 前綴提升 specificity 到 (0,1,1) 贏過原站單 class !important rule（v0.7.121 cn.nytimes 修法）；col-* reset rule 升級為 `width: auto / max-width: none / float: none / flex: 1 1 auto / margin-left: 0 / margin-right: 0 / padding: 0`（v0.7.122 flex-grow:1 撐父 + v0.7.123 清 Bootstrap col offset margin）；figcaption 從 BODY_TEXT_SEL 排除保留原站 typography hierarchy（v0.7.120）。
3. **cleaner 規則完整 + 新增覆蓋**：v0.7.32 規則全保留 + 後續累積：負 horizontal margin reset（v0.7.115 twz.com full-bleed header）+ 文末 `<footer>` 雙階段 hide（v0.7.116 twz.com category tag）+ aspect-ratio container reset 擴增（v0.7.117 twz.com YouTube facade）+ `collapseGridWithHiddenCell` non-articleSelf wrapper 加 padding-left/right reset（v0.7.118 cna.com.tw inner-padding 溢出）+ `hideInsideArticleAbsoluteOverlays` 排除 IMG/PICTURE/VIDEO/SOURCE 避免主圖誤殺（v0.7.119 ebc.net.tw）+ negative z-index reset（v0.7.114 vocus）+ Bootstrap grid float layout condition D（v0.7.110 TBIJ）+ **`collapseEmptyWrappersAfterClean` 末段空 wrapper collapse**（v0.7.128 Medium top action bar 24px 殘留撐起標題上方空白）。
4. **使用者可調設定**：theme（light/dark/sepia/gray，四個主題閱讀區配色 v0.8.143 對齊 Apple Books——white 內文段落純黑 #000000 但維持 light「保留原站色」性質、code/table/figcaption/彩色 inline 不壓黑；dark 底 #4a494d + 字 #ecebf1；sepia 底 #eee2cb + 字 #000000；gray 底 #ededed + 字 #000000）、fontSize（含 0 = Auto 保留原站）、**titleFontSize**（v0.7.175 標題 h1 字級，0 = Auto 保留原站標題大小；非 0 覆寫 h1 font-size，options 可調）、contentWidth、fontFamily、**fontWeight**（v0.7.254 字重三段 細300/中400/粗600，真正的 font-weight 全平台生效、一律注入）、lineHeight、**autoEnableDomains**（v0.7.155 options 「自動啟動網域」+ popup 「此網域自動啟動」checkbox，命中即頁面載入 silent enterReaderMode）、Readwise Reader 整合、**blockPageShortcuts**（v0.7.131 reader mode 攔截原站快速鍵 Gmail / YouTube 等，預設 on）、**pangu**（v0.7.153 中英文間自動補空白，預設 on）、**threeFingerTap**（v0.8.154 三指輕點切換閱讀模式開關，v0.8.157 起預設 off——易誤觸、懸浮 icon 已是觸控主入口；v0.8.163 起 options 該選項只在觸控裝置 `maxTouchPoints ≥ 3` 顯示，桌面 Chrome / macOS Safari / Mac 跑 iOS build 隱藏——非觸控裝置 touch-gestures 根本不安裝辨識器，顯示只會誤導）、**floatingIcon** / **floatingIconOpacity** / **floatingIconSize** / **floatingIconPos**（v0.8.154 懸浮按鈕 啟用 / 透明度 / 尺寸 / 位置——`floatingIcon` 未設過時一律預設開（v0.8.158，原平台分流取消）；**floatingIconSize** v0.8.156 尺寸 `small`（視覺 16px / footprint 32px）/ `medium`（視覺 24px / footprint 40px，v0.8.166 新增並改為**預設**）/ `large`（視覺 32px / footprint 48px，觸控嫌小者放大））。**v0.8.157 回復預設設定**：options 頁最下方「回復預設」按鈕（danger 雙態：第一次點進入「再按一次確認」、4s 未確認自動還原，避免誤觸）一鍵把所有設定複寫回 `settings-defaults.js` 預設值，但**保留 `readwiseToken` / `geminiApiKey` 兩個 API key**（使用者貼過的憑證不洗掉）；`floatingIcon` 回復為未設過（`null` → 預設開）、`floatingIconPos` 拖移位置一併清掉。同版另把 options 各欄位 `.desc` 說明精簡化（保留預設值 / sentinel / 平台註記等必要訊息），並把「觸控與懸浮控制」四欄用 `.field-group` 包住移除彼此間分隔線。
5. **測試覆蓋**：448 jsdom regression spec（每條 cn.nytimes / cna / ebc / twz / udn / medium 等實機 bug 都有 forcing function fixture，含 v0.7.125–127 SW badge / JREAD_RELOAD bridge / badge text 純色塊修法 + v0.7.129 swallowTabGone race-condition guard + v0.7.130 popup readwise-btn hidden 可見性 + v0.7.131 reader-mode keyguard 攔截原站 shortcut + v0.7.132 options checkbox flex-shrink 防壓扁結構 spec）+ e2e SW wire-up spec + Playwright harness（`tools/debug-harness.js`）+ `npm test --timeout 30000` 確保 jsdom 重 fixture 不超時（v0.7.118 hotfix）。
6. **實測通過站擴展**（在 v0.7.32 之上累積）：cn.nytimes / cna.com.tw / ebc.net.tw / twz.com / vocus.cc / esmchina / 商業周刊 / synapseching.substack.com / **medium.com**（v0.7.128 top action bar 殘留 24px 修法）等。
7. **Debug 工具鏈**：Claude 自主跑完 reproduce + forensic 循環（Playwright + localStorage instrument bridge），避開 chrome.downloads MV3 SW data URL 限制，免使用者每步截圖（[[feedback-autonomous-debug]] memory 教訓）。
8. **YouTube Cinema Mode**（v0.7.133）：YouTube watch page（`/watch`）detector short-circuit 不跑主文偵測、改注入 CSS 把 `#movie_player` `position: fixed + translate(-50%, -50%)` 釘 viewport 中央、`min(100vw, 177.78vh)` 雙軸 clamp 16:9、黑底鋪滿、隱藏 masthead/留言/描述/推薦/endscreen 浮層。popup 偵測到 youtube-cinema 時 toggle 按鈕文字改「啟動 / 退出影院模式」；ESC 退出；不 install keyguard（保留 YouTube j/k/l/space/f 等 player shortcut）。詳見「YouTube Cinema Mode（v0.7.133）」章節。
9. **YouTube Borderless Mode**（v0.7.134，從 Shinkansen 移植）：YouTube watch page 第二個獨立沉浸模式——影片以 100vw × 100vh 撐滿視窗、強制 theater、隱藏所有 YouTube UI（masthead / secondary / 留言 / 描述 / chat / 推薦），並透過 SW `RESIZE_OWN_WINDOW` 訊息呼叫 `chrome.windows.update` 把瀏覽器視窗高度 resize 成匹配影片寬高比。manifest 註冊 `toggle-youtube-borderless` 命令但**無 suggested_key**，使用者自行至 `chrome://extensions/shortcuts` 綁；popup 在 YouTube watch 頁多一顆「啟動 / 退出無邊模式」按鈕。與 cinema mode **完全獨立**：各自管自己的 state、各自 toggle、各自 CSS（兩者可同時開，但 CSS 會搶 `#movie_player` rule，使用者自決優先順序）。詳見「YouTube Borderless Mode（v0.7.134）」章節。
10. **編輯模式（手動移除雜訊段落）**（v0.8.108）：閱讀模式啟動時 popup 多一顆「編輯模式：移除雜訊」按鈕（active 且非 cinema 才露出）。進入後 hover 主文以藍框標亮合理 block 邊界、點擊隱藏該塊、頁內 toolbar（復原 / 完成）。block 邊界用演算法 C（inline 正規化 → tight-wrapper climb → dominant-wrapper guard，real-site probe 驗證、避免誤選整篇 dominant wrapper）。隱藏複用 `NS.cleaner.hideElement` 塞進 `NS.state.hiddenEls`，**僅當次有效**——退出閱讀模式 / SPA 導航 / reload 即由既有 `cleaner.restore` 全還原；移除段落自動不進 Readwise。詳見「編輯模式（v0.8.108）」章節。

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
| Popup UI | 顯示當前頁面是否可閱讀、版本號、切換按鈕。**高度約束**（v0.7.248）：瀏覽器 extension popup 有 ~600px 高度上限（Chrome / Firefox / Safari 通用），超過即出捲軸（macOS Safari「不隨內容適應」即此 clip）。全展開內容須壓在上限下——垂直節奏收斂（body 垂直 padding 12、設定列間距、section / footer margin）。**v0.8.166 再收斂**（內容長到 629px、底部「進階設定」footer 被切，Jimmy 2026-06-23 Chrome 截圖）：真正最高狀態 = 一般文章閱讀模式同時顯示「退出閱讀模式 + 送 Readwise + 編輯模式」三顆按鈕 + 翻頁開的頁碼列（12 設定列）；列間距 6→4、**列控制項高度 28→26（theme-btn / stepper / auto-btn / font-family-select 同步等高、維持同列對齊 grid）**、settings / footer / brand margin 12→8、按鈕 padding 收斂 → 壓到 579px。forcing function `test/regression/popup-height-fits.spec.js`（Playwright 量 body.scrollHeight <= 590）——**v0.8.166 修正偽綠燈**：原本只 un-hide readwise + 頁碼 + 自動啟動，漏了 edit-btn 與英文字型列（subset 狀態），改 un-hide「真正同時可見的最高超集」readwise + edit + 頁碼 + 英文字型 + 自動啟動（borderless 是 YouTube cinema 專屬、與 readwise/edit 互斥不計）。**iOS / iPadOS 觸控版**（`@media (pointer: coarse) and (min-width: 340px)`）：iPhone 是整螢幕底部 sheet、iPad 是工具列圖示的 OS 固定高度 popover——viewport 由 OS 給定，body `width:auto` + `max-width:560` + `zoom:1.35`（v0.7.226 放大觸控目標與字級）。**v0.8.163 iPad popover 高度修正**：JRead 全展開內容（12 設定列 + 3 按鈕，zoom 1.35 下視覺 ~845px）超過 iPad popover 高度、底部「此網域自動啟動 / 進階設定」被截斷且不捲動（Jimmy 2026-06-22 iPad 截圖）。CSS `pointer:coarse` 分不出 iPad（popover）與 iPhone（sheet、空間較足），改由 `popup.js` 依 `screen` 短邊 ≥ 600 + `maxTouchPoints ≥ 3` 標記 `body.device-ipad`（screen 回裝置螢幕、popover 內仍可靠；iPad mini 短邊 744、最大 iPhone 約 430，門檻 600 乾淨分離；Mac 跑 iOS build 無觸控螢幕排除）；CSS 對 iPad 降 `zoom:1.35→1.2` + 收斂垂直節奏（brand / 三按鈕 margin、settings margin/padding、setting-row 間距與 min-height），全展開 845→701px 落進 popover；iPhone 維持 1.35 readability 不受影響（Shinkansen v1.10.41 同款「OS 固定高度只能壓矮內容適配」）。forcing `test/regression/popup-ipad-height-fits.spec.js`（iPad 組態視覺高度 ≤ 720 + device-ipad / zoom 1.2 生效，SANITY）；真實 iPad popover 是否完整顯示須 TestFlight 真機驗。 | ◐ 進行中（基本版已實作） |
| Toast 提示 | **僅** 主文偵測失敗時顯示「此頁無法偵測主文」錯誤 toast；reader mode on/off 不再彈 toast（v0.7.32 Jimmy 要求簡化）。Shadow DOM 封裝 | ✅ v0.4.0 / 縮限 v0.7.32 |
| 快速鍵 | 預設 `Alt+R`（Mac: `Option+R`）切換閱讀模式、`Alt+Shift+R` 送 Readwise、`Alt+Y` 切換 YouTube 無邊模式（v0.8.31 起；v0.7.252–v0.8.30 為 `Alt+3` / `Alt+Shift+3` / `Alt+4`，因 macOS Safari WPA 內 ⌥+數字 commands 全滅改回字母鍵——Shinkansen 的 ⌥S 可用、對齊 ⌥+字母 pattern）；若未生效可至 `chrome://extensions/shortcuts` 手動指派。**v0.7.218 自訂快速鍵**：options 「快速鍵」recorder 可為三個指令錄自訂組合（Safari 含 iPad 外接鍵盤唯一改鍵通道，content script 層攔截、與預設鍵並存）。**閱讀模式啟動期間按 `ESC` 可立即退出**（v0.7.101，input/textarea/contenteditable focus 時放行）。**`Space` / `Shift+Space` 段落焦點卷動**（v0.7.216，仿 Readwise Reader：左側指示條標記目前段落、Space 跳下一段；段落低於顯示門檻（viewport × `spaceScrollRatio`% 預設 50%，options 可調、0 = 停用）時以 rAF 動畫卷回畫面上方落點）。 **3 指輕點切換閱讀模式**（v0.7.223，觸控裝置 `navigator.maxTouchPoints >= 3` 才註冊：恰 3 指同落、移動 < 30px、600ms 內全離手 → 觸發；第 4 指 / 移動超容差 / touchcancel（iOS 系統手勢接管）取消；走 content 端 `NS.dispatchLocalCommand('toggle-reader-mode')` 本地 dispatch（v0.7.228 起零訊息傳遞、SW 死活無關——iOS Safari SW 被回收後不再喚醒，Apple Forums 758346）——iOS / iPadOS 觸控環境的主 toggle 通道；**v0.8.154 起可關**：options 「三指輕點切換閱讀模式」開關 → `threeFingerTap` 設定（v0.8.157 起預設 off），install 接 `isEnabled()` gate、listener 常駐、停用時辨識器命中也不觸發）。 | ✅ v0.4.0 / ESC 退出 v0.7.101 / Space 段落焦點卷動 v0.7.216 / 3 指輕點 v0.7.223 / 可關 v0.8.154 |
| 懸浮按鈕 | **頁面邊緣常駐浮動按鈕**（v0.8.154，`content/floating-icon.js`，參考 Shinkansen `content-floating-icon.js`）：方形 icon（用 `assets/icons/icon-32.png` 經 `chrome.runtime.getURL`）+ 透明 padding 包覆的可點 footprint（觸控好點）。**尺寸三段可調**（v0.8.156 `floatingIconSize`，v0.8.166 加 medium，走 CSS 變數 `--fab-hit` / `--fab-icon` 即時切換）：`small`＝視覺 16px / footprint 32px、`medium`＝視覺 24px / footprint 40px（**預設**，v0.8.166 Jimmy 2026-06-23 改——原 small 部分使用者覺得太小；content `applySize` fallback 與 `settings-defaults` 預設一致 = medium）、`large`＝視覺 32px / footprint 48px（透明 padding 維持每側 8px；觸控嫌小者放大）；尺寸變更後 `applyPos` 依新 footprint 重算貼邊 top 夾擠。Shadow DOM host（mode open）掛 `documentElement`（**不掛 body**——body children 會被 cleaner 動態 observer 隱藏，injected UI 一律 append documentElement）。**短按**＝切換閱讀模式（`NS.dispatchLocalCommand('toggle-reader-mode')`，與 3 指輕點 / 快速鍵同一條本地 dispatch、含 YouTube 模式重導；缺席時 fallback `CUSTOM_COMMAND`）；**長按 500ms**＝彈出選單——切換分頁模式（翻轉 `storage.sync.pagedMode`、純 content 本地動作、toast 回饋）+ 功能選單（見下）。**Readwise 送出已不在長按選單**（v0.8.166 移除「送到 Readwise Reader」直送項）：v0.8.165 曾在 Safari 改由 content script 直接 fetch（`NS.sendCurrentPageToReadwise`），iOS 雖可送達但 toast 視覺提示不顯示、無回饋（Jimmy 2026-06-23 實機），故整段移除；Readwise 送出改走唯一可靠且有狀態回饋的入口——長按選單「功能選單」叫出工具列圖示選單（popup），使用者在 popup 按「送到 Readwise Reader」送出（popup 是 extension 頁、直接 fetch 在 iOS 可靠，且有「送出中…/已送到…」狀態文字回饋）+ **功能選單**（v0.8.162，分隔線下方 `☰` 項，比照 Shinkansen `content-floating-icon.js`）＝叫出工具列圖示選單（popup）：**Safari**（getURL scheme 偵測 `safari-web-extension://`）送 SW `OPEN_FEATURE_MENU` → `chrome.action.openPopup()`（Safari 16+ / Chrome 支援，失敗 / 不支援退而 `chrome.tabs.create` 開 `popup/popup.html`），**非 Safari**（Chrome / FF）在頁內用 open Shadow DOM + iframe 浮層載 `popup/popup.html?panel=1`（分頁耦合不斷——iframe 在當前分頁、popup `tabs.query({active:true})` 仍取底層內容頁；避免 iOS iframe 載擴充頁整頁 refresh）；popup.js 偵測 `?panel=1` 後用 `ResizeObserver` 回報內容尺寸 `jread-panel-size`（外層收緊 iframe 不留白）+ 關閉走 `jread-close-panel` postMessage（iframe `window.close` 無效）+ 開設定頁後自收浮層；點浮層外 backdrop / ESC 收浮層；`manifest.web_accessible_resources` 列 `popup/popup.html`（iframe src 需）。點選單外 / 捲動收選單。**拖曳**（位移 > 8px）＝跟手移動、放手吸附最近左 / 右緣（pointer 在視窗左 / 右半判定），垂直位置存比例 `floatingIconPos = { edge, offsetY }`、視窗縮放按比例還原。**預設位置左下角**（`edge: 'left'` + `offsetY: 1`，v0.8.160；原垂直置中 0.5——`sanitizePos` 未設過 / 非法值一律退回 offsetY=1）。**iPadOS 角落保留區**（v0.8.161 `cornerClampTop`，`CORNER_DEADZONE_PX = 44`，比照 Shinkansen；**v0.8.166 起只針對 iPadOS**，原本套到所有觸控裝置含 iPhone）：`isIPadOSEnv(ua, touchPoints)`（觸控 `maxTouchPoints ≥ 1` + iPad UA 訊號——`iPad` 或桌面模式偽裝的 `Macintosh`；先排除 `iPhone`/`iPod`；桌面 / iPad app on Mac `maxTouchPoints = 0` 與 Android 皆排除）為 true 時 `applyPos` 把 top 夾離上下角落 44px——iPadOS 視窗下方角落是縮放拖曳把手、上方角落是系統手勢區，按鈕停太靠近會被 OS 攔走觸控而拖不出來；視窗太矮夾不出安全區則置中；**iPhone / 桌面不設禁制區**（只夾在可視範圍、不留間距）。**disable → 重新 enable 回預設位置**（v0.8.161）：`applyEnabled` 偵測 `false → true` 轉移時 `applyPos(null)` 重置回左下角 + 持久化；初始載入（`lastEnabled = null`）不重置、尊重 storage 存的位置。pointer 狀態機：`pointerdown` 起 500ms 長按計時器、`pointermove` 超 8px 取消長按進拖移、`pointerup` 依 moved/longFired 決定吸附 / 短按。啟用 / 透明度 / 位置走 `storage.sync` + `onChanged` 即時生效（比照 toast）。**啟用旗標三態**（`__JReadResolveFloatingIconEnabled`，settings-defaults 單一資料源、content + options 共用）：值為 boolean 尊重使用者設定，非 boolean（未設過）時一律預設開（v0.8.158，原平台分流取消，全平台一致）。**長按選單比照 Shinkansen 重繪**（v0.8.161）：白底圓角卡片、選單項 icon 為藍色（`#0071e3`）圓角 badge、13px 字、緊湊間距、label 過長 ellipsis。透明度 `floatingIconOpacity` 預設 0.7、clamp 0.1–1。options 「觸控與懸浮控制」區塊：啟用 checkbox + 尺寸 radio 群（小 / 中 / 大，v0.8.166 比照 Shinkansen `.floating-size-options` 改水平 radio 群、不用下拉 select）+ 透明度滑桿（10–100% 即時 % 讀數）+ **透明度範例 icon**（v0.8.161 `floatingIconOpacityDemo`：跟著透明度滑桿即時套不透明度、跟著尺寸 radio 群改 16 / 24 / 32px 大小，固定 32px footprint 不跳版）+ 三指輕點 checkbox。shadow 內 CSS 走 `NS.injectShadowCss`（CSP-safe，v0.8.159——嚴格 style-src nonce-only 站在 WebKit 會擋掉 shadow `<style>` 使尺寸設定失效；退回 `shadow.adoptedStyleSheets`）。spec forcing：`floating-icon.spec.js`（host 掛 documentElement / 預設開 / 透明度 clamp / sanitizePos 預設左下角 / 短按 dispatch / 選單只剩 paged + 功能選單、無 Readwise 直送殘留 / 切分頁 / onChanged / 尺寸 small↔medium↔large CSS 變數 + footprint 重算 + 預設 medium / shadow CSS 走 injectShadowCss）+ wiring（manifest 順序 / popup-core CONTENT_SCRIPT_FILES / web_accessible_resources）；real Chromium probe 實證 imgRect 16×16 / fabRect 32×32；iOS 真機觸控長按 / 拖移 / WebKit CSP 尺寸須 Jimmy / 模擬器驗。 | ✅ v0.8.154 |
| 翻頁模式 | **電子書式水平翻頁**（v0.7.227，popup「翻頁模式」checkbox 開啟、預設關 = 垂直卷動）：reader card 變 fixed 滿版 multi-column 容器（`column-width: 版心寬` + `column-count: auto` + `column-fill: auto` + 高度約束 → 溢出內容自動長出等寬水平 overflow column = 頁；stride 恆等式 `column-gap = 左右視覺內距和` → 翻一頁 = scrollLeft 跳一個 stride。**v0.8.56 stride 格點量化**：stride 真值 = `quantizeStride(maxScrollLeft, 近似值)` = `maxSL / round(maxSL / 近似值)`（依 border-right 設計 `maxSL = (頁數−1) × 引擎 stride` 兩引擎恆成立、幽靈欄不污染）；近似值用分數精度 `getBoundingClientRect().width − padding − border + column-gap`（jsdom 退回整數 clientWidth 公式）——不可信整數 `clientWidth` 或 computed border：iOS WebKit 把 vw 分數 border snap 到 1/3px 裝置像素格、clientWidth 截斷讓每頁 stride 短 0.333px，64 頁累積 21px 整欄右移、右緣文字裁切（chinatalk iPhone 模擬器 instrument 實證；quantizeStride spec forcing function）。**v0.7.230**：「一頁一欄」必須用 `column-width` 表達、不可用 `column-count: 1`——WebKit 對 count=1 不建 multicol fragmentation context、scrollWidth 不含 overflow columns、翻頁全滅；真機 Safari probe 實證，spec 設 forcing function。**v0.7.231**：右視覺內距必須用 `border-right: transparent` 表達、`padding-right` 必須為 0——WebKit 的 multicol scrollable overflow 不含尾端 inline-end padding，最後一頁 scrollLeft 被 clamp 短 56px 整頁錯位；頁數不信 `scrollWidth`、改量實際內容末端落在第幾欄（`computePageCountFromExtent`）——正式版 Safari 26.5 scrollable overflow 多報一個無內容幽靈欄，scrollWidth 公式會多算一頁；皆 spec forcing function + 三軌驗收（Chromium / WebKit trunk / safaridriver 真機））。圖片/影片/iframe `max-height: calc(100dvh − 垂直 padding − 120px caption 餘裕)` + `break-inside: avoid` 縮放至單頁不跨頁切割（**v0.8.10 img 選擇器排除 `[data-jread-inline-img]`**——否則 inline emoji 被 `width:auto` 撐成滿欄，X Twemoji 實機回報；且 inline-img 標記迴圈搬到 `setAttribute(ARTICLE_ATTR)` 之前跑，量原站尺寸避免 reader 規則先撐大 emoji 導致永遠標不到 inline 的 chicken-egg；forcing：x-emoji-inline-img.spec.js + paged-mode.spec.js）。翻頁通道：單指左右滑（v0.7.239 起全頁起手都認，見下方）/ `←` `→` `PageUp` `PageDown` `Space`（`Shift+Space` 反向） `Home` `End` / 滾輪與觸控板（delta 累積 90 過門檻、翻後 550ms 慣性鎖定）。頁碼指示 `N / M` 固定底部置中（掛 `<html>` 下——掛 body 會被 ancestor sibling 隱藏規則吃掉）+ 進度條寬度 = 已讀頁比例。**v0.7.237 頁碼可關**（popup「頁碼指示」開關 → `showPageNumber` 設定）：`setShowIndicator` 即時增/移除指示器 DOM、不重建 layout。**v0.7.237 擋 iOS Safari 邊緣返回手勢**（Jimmy 回報第一頁左滑誤觸 Safari「back」）：`touchmove` 改 `passive:false`、對水平支配單指滑動 `preventDefault`（翻頁文件已鎖、水平觸控無原生用途；多指讓位 3 指 toggle、垂直放行）——`UIScreenEdgePanGestureRecognizer` 系統手勢無法在 simulator 重現（idb HID 觸發不到），preventDefault 是否真擋住返回待真機驗（`test/PENDING_REGRESSION.md`）。桌面寬視窗頁寬 cap `contentWidth`（**v0.7.234 寬度一致性**：contentWidth 語意 = 卡片總寬、與捲動模式 baseline 同義；`column-width = contentWidth − 左右內距和`——舊版 cap contentWidth + 內距 ×2 讓翻頁模式卡片與內文都比捲動模式寬 112px，Jimmy macOS Chrome / Safari 回報；三軌驗收 Chromium / WebKit trunk / safaridriver 真機 Safari 26.5 寬度逐 px 相等 + 多頁 + 末頁格點對齊）置中（書頁感）。resize/旋轉按閱讀比例回對應頁；lazy-load 增頁即時重算（重測內容末端、頁數縮水時 clamp 回最後一頁）。翻頁模式下 Space 段落卷動（space-scroll）讓位停用；ESC 退出與 3 指輕點不受影響；退出還原進場前文件卷動位置。**v0.7.238 垂直滑收合 iOS Safari 工具列**（Jimmy 回報「工具列隱藏多顯示一行」）：限觸控裝置（`@media (hover:none) and (pointer:coarse)`），翻頁模式放行 html/body 垂直卷動 + body `min-height: 101vh`（v0.7.244 由 500vh 縮小）+ 卡片 `touch-action: pan-y`——使用者垂直滑一下 → 底下 document 捲動 → iOS Safari 偵測真實手勢自動收合工具列（卡片 fixed 視覺不動、viewport 變高多顯示內容）。**自動收合做不到**（iOS 只認真實觸控手勢、程式 `scrollTo` 不觸發收合，simulator 對照實證），故半手動。`touch-action: pan-y` 必要（否則 fixed+overflow:hidden 卡片上非被動 touchmove 讓 WebKit 垂直 pan 曖昧、不冒泡捲 document，simulator instrument 揭穿）；`min-height` 必須 > 100vh（要比視窗高才有可捲空間；v0.7.244 真機實測 iOS 收合看「有沒有在捲」不看「捲多少」、101vh 即收得了）；`onScrollProgress` 翻頁模式讓位（垂直 scrollTop 非閱讀進度、避免覆寫頁碼進度條）。桌面 base 維持 overflow:hidden 鎖死、不受影響。**v0.7.239 兩項手勢調整**（Jimmy 真機 TestFlight 回報）：(1) **整頁可滑**——`EDGE_GUARD_PX` 28 → 0（「翻頁只在中間生效、太不靈敏」+ 真機實證左邊緣往右滑不會返回只是滑不動；擋返回已由 onTouchMove preventDefault + touch-action 覆蓋，邊緣緩衝多餘）。單指左右滑改為全頁起手都認（不再避開左右 28px）。(2) **工具列收合限第一頁**——`onTouchMove` 改 idx-based（純函式 `shouldBlockTouchMove`）：第一頁只擋水平支配滑動（放行垂直滑收工具列），第二頁起擋全部單指滑動（垂直擋 = 維持收合後 scrollY 不被捲回、工具列保持收合；水平擋 = Safari 返回；翻頁由 touchend JS 處理不受影響）。**不可用 `touch-action: none` 鎖第二頁**——iOS WebKit 有 passive:false touchmove listener 時 touch-action 不可靠（不繼承、手指落在卡片內 auto 後代 `<p>`/`<img>`），simulator instrument 實證 scrollY 仍被捲穿、工具列重新展開；必須用 passive:false 的 preventDefault。卡片 `touch-action: pan-y`（v0.7.238）保留——第一頁垂直 pan 冒泡到 document 收工具列需要它。**v0.7.244 收尾：縮小垂直範圍、不鎖**（Jimmy 真機 + Pages instrument 實證，2026-06-08，取代 v0.7.240→243 已撤回的鎖機制）：iOS 上「收合後鎖死垂直卷動」**本質做不到**——設 `touch-action: none` 鎖死時慣性捲動彈回頂端（sy 346→-10）、工具列反而重展開；且使用者下滑必能把工具列自然叫回（iOS 原生行為，擋不住也不該擋）。改法：(a) `min-height` 500vh→**101vh**（收合看「有沒有在捲」不看「捲多少」，101vh 可捲僅 ~8px 即收得了；壓最低範圍 → 捲軸幾乎看不到、第一頁左右滑乾淨，解 Jimmy 最初「捲動範圍過高」）；(b) 鎖機制全撤、回 per-page 模型——第一頁放行垂直（可收合 / 可叫回），第二頁起 `onTouchMove` preventDefault 鎖（純擋、不碰 touch-action、無彈回）。**v0.7.245 第一頁「捲動停止後」鎖死**（Jimmy 真機 Pages instrument 驗過，保留「捲軸消失後可鎖住」）：在 v0.7.244 per-page 基礎上，第一頁加「捲動完全停止才鎖」——`onScroll` debounce 250ms（無再 scroll = 捲軸消失 = 停止），停止時 `scrollY > 2`（已收合）且手指不在 → `applyVLock`（vLocked + 卡片 `touch-action: none`），`shouldBlockTouchMove` 委派 `blockTouchDecision(...,vLocked)` 鎖後擋全部。**與 v0.7.240→243 彈回 bug 的區別**：那幾版在慣性中就鎖（打斷 in-flight 捲動 → 彈回頂端 + 工具列重展開）；本版等停止才鎖、無慣性可打斷、不彈回。配 101vh 範圍極小、停止極快，收合後幾乎立刻鎖、左右滑乾淨。v0.7.240→243 的 vLocked / classifyViewportChange / viewportH / scrollY 上鎖等全數移除。**v0.7.255 雙指捏合呼叫所有標籤頁**（Jimmy 真機回報翻頁模式捏不出 Safari「所有標籤頁」）：CSS `touch-action` 一旦明列 pan 值就排除其餘手勢，純 `pan-y` 把雙指捏合（iOS Safari「呼叫所有標籤頁」= 雙指捏合縮放系統手勢）一併關掉；`applyVLock` 的 `none` 更連捏合都鎖死。修法：卡片 `touch-action: pan-y` → **`pan-y pinch-zoom`**（垂直 pan 收工具列 + 雙指捏合並存）、`applyVLock` 鎖值 `none` → **`pinch-zoom`**（只擋單指 pan、放行雙指縮放，鎖死垂直 pan 目的仍達成）。單指水平 swipe 仍由 `onTouchMove` preventDefault 擋（只在 `touches.length === 1` 觸發、雙指捏合不受影響）。spec forcing：paged-mode.spec.js 驗卡片含 `pan-y pinch-zoom` + applyVLock 用 pinch-zoom 不可用 none。**v0.7.233**：三條 enter 路徑（一般 / X thread / FB post 合成容器）都必須 `captureScrollY` + `syncPagedModeFromSettings`（順序 pagedMode → spaceScroll → keyguard）——styler 依 settings 在所有路徑注入翻頁 CSS，模組漏裝會變「視覺翻頁、模組沒裝」（指示條殘留 / 無頁碼 / 翻不了頁）。`content/paged-mode.js`（雙匯出：NS.pagedMode + module.exports 純邏輯給 jsdom spec）。驗收：`debug-harness.js --paged`（印 PAGED AUDIT：column CSS 算出值 / 頁數 / 鍵盤翻頁 stride 實測）；WebKit 軌驗證見 `docs/CHROME_EXTENSION_DEBUG.md`。**v0.8.150 頁碼 scrubber**（Jimmy 需求「按住頁碼滑動快速捲動頁面」）：頁碼指示器 `#__jread-page-indicator` 變成可拖曳 scrubber——按住後水平拖曳即時跳頁，純函式 `computeScrubTarget(startIdx, dx, scrubWidth, total)` 把位移映射成目標頁（往右拖 = 後面的頁、slider 直覺，與左滑翻下一頁的 swipe 方向相反；`scrubWidth = 拖曳起手時的 viewport 寬` → 拖滿整個寬度 = 涵蓋全部頁範圍 = 小空間大跳幅 = 快速捲動；clamp 0..total−1、total≤1 / 退化輸入回起拖頁）。拖曳中 `goTo(target, false)` 無動畫即時 live preview + 指示器顯示目標頁、加 `.__jread-scrubbing` class 淡底回饋；放手停在預覽頁不再翻動。touch 走既有 window touch 管線（`onTouchStart` 起點命中指示器 `isIndicatorTarget(e.target)` → 進 scrub、`scrubState` 攔截不另判翻頁 swipe；`onTouchMove` preventDefault 擋底層捲動 / 返回；touchend/cancel 收尾）；桌面滑鼠走指示器 `mousedown` + window `mousemove`/`mouseup`（touch 裝置不觸發 mouse 事件、兩軌不重複）。styler 端指示器 CSS 必須 `pointer-events: auto`（才成為 hit-test target，原本 `none`）+ `touch-action: none`（擋 iOS 原生捲動/縮放/返回，翻頁全由 JS 程式控）+ padding 放大命中區 + `cursor: ew-resize`。`showPageNumber=false` 無指示器即無 scrub（合理）。spec forcing：`computeScrubTarget` 純函式 + jsdom touch/mouse scrub 互動 + styler `pointer-events:auto`/`touch-action:none`；真實 Chromium probe 實證（indicator 為 hit-test target、mousedown+mousemove → scrollLeft 0→12240、頁碼 1/18→18/18）；iOS 真機觸控 scrub 須 Jimmy / 模擬器驗。**v0.8.151 兩項增強**：(a) **scrub 進度條**（`#__jread-scrub-track` + `#__jread-scrub-fill`）——按住起拖時出現（`beginScrub` → `showScrubTrack`，rAF 加 `.__jread-scrub-visible` fade-in）、放手淡出，位置在頁碼指示器上方置中（`bottom: 30px`、`width: min(72vw, 360px)`、`height: 4px`），fill 寬 = `idx / (total−1)`（第一頁 0%、末頁 100%，對應拖曳位置）、色用 `theme.progressBar`（與頂部進度條同色）；real Chromium probe 實證拖到 60% → fill 58.8% / 頁碼 11/18 / opacity 1。(b) **觸覺回饋**（`triggerHaptic`，每跨一頁觸發 = picker 滾輪式）——`navigator.vibrate(8)` 優先（Android / 支援平台；桌面無馬達 no-op 無害），**iOS Safari 不支援 `navigator.vibrate`** → 退回 iOS 17.4+ 原生 switch checkbox haptic（隱藏 `<label><input type=checkbox switch>`，在 touch 手勢內 `label.click()` 切換 switch 觸發系統觸覺 tick；載體 `#__jread-haptic` 不可 `display:none`、否則 switch 不渲染觸覺不發，改移出畫面外 + `opacity:0` 藏）。spec forcing：scrub 進度條 fill 寬隨頁更新 + 放手/uninstall 清除 + vibrate 跨頁觸發 + 無 vibrate 退回 switch 載體 + styler `#__jread-haptic` 不得 `display:none`。**iOS switch haptic 是 best-effort hack、須 Jimmy 真機確認真的有震動**。**v0.8.152 兩項調整**（Jimmy 回報「拖很遠才換頁、不靈敏」+「沒觸覺」）：(a) **靈敏度**——`computeScrubTarget` 每頁拖曳距離改 `min(全寬均分, SCRUB_MAX_PX_PER_PAGE=14px)`：原本純全寬均分讓 few-page 文章每頁要拖很遠（3 頁 → ~半個螢幕），上限讓少頁文章維持 14px/頁靈敏、多頁文章（均分 < 14px）仍維持拖滿全寬 ≈ 走完全文（forcing：few-page 3 頁拖 14px 換一頁 + many-page 43 頁拖滿全寬到末頁）；(b) **觸覺載體渲染**——`#__jread-haptic` 由 `1px + overflow:hidden`（夾掉 switch 可能不渲染、觸覺不發）改 `left:-200px` 移出畫面外但維持自然尺寸渲染。**沒觸覺很可能是「不靈敏 → 很少真的跨頁 → 觸覺只在跨頁觸發 → 幾乎感覺不到」+ 載體沒渲染雙重疊加**；靈敏度修好後跨頁變頻繁、觸覺才有機會被感知（仍須 Jimmy 真機驗，且若在 Mac 上測本無觸覺硬體）。**v0.8.153 觸覺改比照實證可動的 `ios-haptics` 套件**（Jimmy 實體 iPhone 驗 v0.8.152 仍無觸覺）：`ensureHaptic` 改 (1) 載體掛 `document.body`（非 `<html>`），(2) inline `display:none`（套件證明 display:none 不影響觸覺——觸覺由 `label.click()` 切換 switch *狀態*觸發、與是否渲染無關，v0.8.151/152「維持渲染」方向錯誤），(3) `triggerHaptic` 不論 `navigator.vibrate` 是否存在都跑 switch click（避免 vibrate stub 提早 return）、vibrate 與 switch 並行（各平台恰好一次觸覺）。styler 不再注入 `#__jread-haptic` 規則（改 JS inline）。real Chromium probe 實證 30px 拖曳 → 頁 1→3（靈敏）、載體掛 body + display:none + switch input、無 pageerror。**iOS 真機觸覺仍須 Jimmy 確認**——若此版 ios-haptics 精確寫法仍無觸覺，代表該 hack 在其 iOS 版本不生效、需再評估。**v0.8.162 scrubber 觸控上抬**（Jimmy 2026-06-22 iPad 截圖回報「頁碼太靠底部系統 bar、拖曳選頁拖不動」）：styler 翻頁 CSS 加 `@media (pointer: coarse)` 把頁碼指示器（`bottom` 6→24px）與 scrub 進度條（30→48px）整組抬升、再加 `env(safe-area-inset-bottom, 0px)` 補 home indicator 高度——iPadOS / iPhone Safari 底部系統工具列 + home indicator 手勢區會攔走貼底頁碼的拖曳觸控；指示器與 track 同抬同量維持原 24px 間距（track 在指示器上方）。結構訊號（pointer: coarse + safe-area-inset）、非站點特判；桌面（pointer: fine）維持原貼底值不受影響。**v0.8.166 抬升量依平台分流**（Jimmy 2026-06-23 iPhone 截圖回報「頁碼與內文重疊」）：iPhone 沒有 iPad 的視窗縮放把手問題，原 24px 抬升反而把頁碼推進內文重疊——styler 依 `navigator.userAgent`（`/iPhone|iPod/`）判 iPhone，iPhone 退回近底 `calc(6px / 30px + env(safe-area))`（等同非 coarse base），iPad / 其他 coarse 維持 24/48px。forcing：`styler-paged-scrubber-safe-area.spec.js`（iPad UA → calc(24px/48px + env(safe-area))、iPhone UA → calc(6px/30px + env(safe-area)) 不含 24px、桌面基底 6px/30px 保留）；真實 iPad 拖曳 / iPhone 頁碼位置須 TestFlight 實機驗。**v0.8.166 頁碼 tap-to-arm 互動**（Jimmy 2026-06-23 需求，重整「分頁模式點頁碼後的動作」）：頁碼指示器的「點按」（down→up 未拖移）切換 armed 模式——進度條常駐、整個畫面變成 scrub 面。三條規則：(1) **按住頁碼拖移** → 短暫 scrub 翻頁（放手收起進度條，= 既有 v0.8.150 行為）；(2) **點選頁碼放開** → 出現常駐進度條，此後**畫面任意處左右滑** = scrub 拖曳翻頁，**再次點頁碼** = 收起進度條退出 armed；(3) **armed 中任意處點選** = 收起進度條。tap 與 drag 由位移門檻 `TAP_SLOP_PX=6px` 分流（超門檻或實際跨頁 = drag、否則 = tap）；狀態機純函式 `resolveScrubGesture(armed, moved)` → `'arm'`（非 armed + tap）/ `'end'`（非 armed + drag，短暫 scrub 收起）/ `'keep'`（armed + drag，維持）/ `'disarm'`（armed + tap，收起），DOM 端 `finishScrubGesture` 依回傳值套用 `setArmed`。armed 時整個 window 的單指起手都進 scrub（`onTouchStart` 不再只認指示器命中）；非 armed 維持原行為（指示器拖 = scrub、內文滑 = 單頁翻頁）。桌面滑鼠維持短暫 drag scrub、不進 armed（「畫面任意處滑」是觸控專屬手勢）。`uninstall` 重置 armed。`showScrubTrack` 的 rAF fade-in 加 `scrubArmed || scrubState` 守衛，防「armed 中點按收起」時 touchstart 排的 show rAF 在 touchend 同步 hide 後又把進度條加回 visible（race）。forcing：`paged-mode.spec.js`（`resolveScrubGesture` 四象限純函式 + jsdom 合成 touch DOM 流：頁碼拖移多頁不 armed / 點頁碼進 armed 任意處滑多頁 / 再次點頁碼 disarm / armed 任意處點按 disarm / uninstall 重置）；真實 iOS 觸控時序 / 進度條 fade 須 TestFlight 實機驗 | ✅ v0.7.227 |

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
│   │   ├── namespace.js         # window.__JRead 初始化（含 NS.injectCssText/removeCssText：CSP-safe 樣式注入單一資料源，v0.8.130；NS.injectShadowCss：Shadow DOM 版 CSP-safe 注入，v0.8.159）
│   │   ├── keepalive.js         # Safari 限定 background keep-alive port（v0.8.30，WPA / iOS 回收喚不醒對策）
│   │   ├── settings-defaults.js # DEFAULT_SETTINGS 單一資料源（content / SW / Safari、Firefox event page 共用，v0.7.235）
│   │   ├── domain-match.js      # 萬用字元網域比對（content / popup / options / spec 共用）
│   │   ├── shortcut-utils.js    # 自訂快速鍵 helper（content / options / spec 共用，v0.7.218）
│   │   ├── custom-shortcuts.js  # 自訂快速鍵 keydown 攔截 → 本地 dispatch / CUSTOM_COMMAND（v0.7.218 / v0.7.228）
│   │   ├── touch-gestures.js    # 3 指輕點 toggle 閱讀模式 → 本地 dispatch（v0.7.223 / v0.7.228）
│   │   ├── toast.js             # 頁內 toast 通知
│   │   ├── cinema-mode.js       # YouTube 劇院模式（v0.7.133）
│   │   ├── youtube-borderless.js # YouTube 無邊框模式（v0.7.134）
│   │   ├── x-thread.js          # X（Twitter）thread 合成容器
│   │   ├── fb-post.js           # Facebook post 合成容器
│   │   ├── detector.js          # 主文偵測
│   │   ├── cleaner.js           # 雜訊隱藏（含 hideElement 給編輯模式複用）
│   │   ├── edit-mode.js         # 編輯模式：手動點擊移除雜訊段落（v0.8.108）
│   │   ├── styler.js            # 套用乾淨排版
│   │   ├── space-scroll.js      # Space 段落焦點卷動 + 指示條（v0.7.216）
│   │   ├── paged-mode.js        # 翻頁模式：手勢/鍵盤/滾輪翻頁 + 頁碼指示（v0.7.227）
│   │   ├── position-memory.js   # 閱讀位置記憶：段落/頁碼持久化 + 回復（v0.8.40）
│   │   └── main.js              # 進入點、事件串接
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.js
│   ├── options/
│   │   ├── options.html
│   │   └── options.js
│   └── assets/                  # （站點特判隔離區 site-overrides/ 為規劃保留位置，目前無任何站點特判、目錄未建立）
├── test/
│   ├── version-check.spec.js    # 版本號 forcing function
│   ├── regression/              # 回歸測試
│   │   ├── fixtures/
│   │   └── *.spec.js
│   └── PENDING_REGRESSION.md
├── tools/
│   ├── audit-lib.js             # harness audit 共用 library（NOISE_KEYWORD_TIERS 兩級 keyword + 全部 audit 函式的單一資料源，v0.8.39）
│   ├── debug-harness.js         # Playwright 自動化除錯 harness
│   ├── page-rounds-harness.js   # 批次視覺驗收（5 組分頁截圖 + audit.json + 四態 verdict：pass/review/failed/blocked + failReasons）
│   ├── e2e-harness.js           # e2e spec 用 SW 啟動樣板（test/e2e/ import）
│   ├── firefox-build.sh         # Firefox sideload ZIP 重建（jq 改 manifest）
│   └── asc-provision-ios.js     # iOS 簽章資源 bootstrap（憑證 / bundle ID / profiles，idempotent）
├── safari-app/                  # Safari Web Extension（iOS v0.7.217 起；單一 iOS binary 涵蓋 iOS / iPadOS / macOS）
│   ├── ios-bootstrap.sh         # 一次性 iOS Xcode project 產出（converter --ios-only + patch）
│   ├── ios-build.sh             # 手動觸發：sync Resources + archive + export .ipa + altool 上傳 TestFlight
│   ├── ios-export-options.plist # iOS App Store manual signing 設定
│   ├── patch-safari-manifest.sh # build 時把 manifest background 改宣告 event page（受控差異）
│   └── JRead-iOS/               # iOS Xcode project（在 Apple Silicon Mac 以 iPad App 執行涵蓋 macOS）
│       ├── JRead.xcodeproj/
│       ├── JRead/               # iOS host App（converter 模板 + 繁中啟用引導畫面）
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

## iOS / iPadOS 版本（v0.7.217 起，TestFlight 軌）

JRead 提供 iOS / iPadOS Safari Web Extension，目前走 **TestFlight internal testing**（免審核、build 上傳後 ASC 處理 5-30 分鐘即可裝；尚未公開上架 App Store）。

**發佈節奏與 Chrome / Firefox 解耦**：`safari-app/ios-build.sh` **手動觸發**、不綁 `release.sh`——Chrome / Firefox 每版即發，Safari（iOS／在 Apple Silicon Mac 以 iPad App 執行）要發時人工跑一次 build script。同版本號重傳 ASC 會被拒，重傳前先 bump。

**單一真實來源**：`safari-app/ios-build.sh` 每次 `rsync -a --delete jread/ "safari-app/JRead-iOS/JRead Extension/Resources/"`，extension code 與 Chrome 共用 `jread/`、不雙頭維護。iOS Xcode project（`safari-app/JRead-iOS/`）由 `safari-app/ios-bootstrap.sh`（converter `--ios-only`）一次性產出。

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

**iOS background lifecycle（v0.7.228 根治「用一段時間後失效」）**：iOS Safari 的 MV3 background **service worker 被系統回收後不再喚醒**（Apple Developer Forums [thread 758346](https://developer.apple.com/forums/thread/758346)；iOS 17.4 起、迄今未修；Chrome / macOS Safari 的 SW 死後下個事件會重生，iOS 實機死透，僅重開機 / Settings 重開 extension / 強制關閉 Safari 可復原）；iOS 18.4+ 另有 `tabs.sendMessage` 無聲掉包 regression（[thread 787958](https://developer.apple.com/forums/thread/787958)）。對策雙管：(1) 觸發路徑去 SW 化——3 指輕點 / 自訂快速鍵 toggle 走 content 端 `dispatchLocalCommand` 本地 dispatch（零訊息傳遞）；(2) Safari build 的 manifest 由 `safari-app/patch-safari-manifest.sh`（冪等）把 background 改宣告 event page（`scripts + persistent: false`——Safari 對 event page 生命週期管理正常，卸載後可重生）；Chrome 版 manifest 維持 `service_worker` 不動，build drift check `-x manifest.json` 排除這個唯一受控差異、由 patch script verify 補檢查。**機制限制**：send-to-readwise 的 API 呼叫住在 background，仍依賴 event page 喚醒；若 Apple 再 regress event page lifecycle，僅此功能受影響、toggle 類觸發不受波及。**v0.7.235 補修**：v0.7.228 漏掉 content 端 `getSettings` 也住在 background（`GET_SETTINGS` round-trip）——iOS 掉包時回 `undefined`、所有設定靜默 fallback 預設值（theme / fontSize 接近預設難察覺；pagedMode 永遠 false = Jimmy 回報「翻頁模式 iOS 沒功能」根因，simulator instrument 實證）。已改直讀 `chrome.storage.sync`（defaults 單一資料源 `content/settings-defaults.js`，Safari event page scripts 預載清單同步加檔——v0.7.229 同款坑），round-trip 降為 storage 失效 fallback。background 依賴現況：僅 send-to-readwise + icon badge + manifest 預設鍵 / Safari menu「延伸功能動作」（`commands.onCommand`）。

**Safari keep-alive port（v0.8.30，macOS WPA / iOS 回收喚不醒對策）**：macOS Safari「加入 Dock」web app（WPA）對 background 的生命週期管理與 iOS 相同——閒置約 30s 被系統永久回收、`commands.onCommand`（⌥ 預設鍵與 menu「編輯 → 延伸功能動作」的共同路徑）喚不醒。v0.7.235 起 content 直讀 storage、不再有訊息喚 background，WPA 冷啟後 background 可能從沒被拉起 → ⌥3 / menu「從來不會動」（2026-06-10 YouTube WPA 實證；Shinkansen 同場景多半正常的唯一結構差異 = 它有 keep-alive port，A/B 對照）。對策：`content/keepalive.js`（Safari 限定，gate 在 runtime URL scheme `safari-web-extension://`）開長連線 port（name `jread-keepalive`）+ 每 20s ping；connect 本身會拉起未啟動的 event page、ping 重置閒置計時。分頁 hidden 即斷線省電、斷線 1s 後重連；SW 端 `onConnect` 回 `{ pong: true }`（無條件註冊，Chrome / Firefox content 端不開 port、listener 永不觸發）。已知限制：(1) Safari menu 顯示的快速鍵永遠是 manifest `suggested_key`（⌥3），自訂鍵（如 ⌃R）改不了 menu 標示——Safari 無 `commands.update` API；(2) keep-alive 只能「不讓它睡」，若系統在 ping 間隙仍強制回收（Shinkansen 偶發失效同款），重連的 connect 會試圖重拉 event page，但 iOS 真機「死透」狀態仍需強制關閉 Safari 自救。spec：`test/regression/safari-keepalive.spec.js`。**v0.8.30 實測結果（Jimmy 2026-06-10 TestFlight）**：keep-alive 上線後 WPA 內 ⌥3 / menu 仍無效——「background 沒被拉起」非唯一根因，⌥+數字的 commands 鍵盤對映在 WPA 也可疑（Shinkansen 可用的 ⌥S 是 ⌥+字母；macOS ⌥+數字產生特殊字元）。v0.8.31 改鍵實驗（⌥R / ⌥⇧R / ⌥Y）也無效。**v0.8.32 真根因（程序層實證）**：ps 監看 appex 程序發現 WPA 內「on-demand 啟動 extension appex」全面故障——menu「延伸功能動作」點擊、popup 開啟、content `runtime.connect` 都不會 spawn appex → JRead background 從沒跑過、`onCommand` 無人接；Shinkansen 可用的真正差異 = 它註冊 `runtime.onStartup` listener，WPA session 啟動 2s 內 appex 就被拉起（ps 實證）+ keep-alive port 保活。修法：SW 加 `runtime.onStartup` 空 listener（存在本身是啟動觸發器；iOS guard 同款）。兩段式缺一不可：onStartup 拉起 → keep-alive 保活（WPA 不會 on-demand 重啟死掉的 appex，Shinkansen 偶發全滅 = appex 死後救不回，重啟 WPA 自救）。keep-alive 機制保留（iOS background 回收對策仍然成立）。**v0.8.33 二次修正（WPA 行為層實測後）**：v0.8.32 的 onStartup 在 WPA 實測仍不啟動 background；同 session A/B 實測（⌥S 翻譯成功 / ⌥R 無反應 / **⌃R 也無反應**）+ WPA 設定面板實查（youtube.com=允許、⌥R/⌥⇧R/⌥Y 快速鍵正確註冊、menu enabled）鎖定兩件事（勘誤：當時把「⌃R 無反應」當 content script 注入失敗證據，事後 Jimmy 出示 options 截圖證實自訂鍵全空、⌃R 根本沒設定，「keepalive 炸 content script」回歸宣稱不成立；修法以防禦性理由保留）：(1) **keep-alive port 防禦加固**——background 拉不起來時 `runtime.connect` 回傳值無 null guard 有 TypeError 風險 → gate 收緊到 `maxTouchPoints > 0`（真 iOS / iPadOS；macOS Safari / WPA 不開，macOS 本不需要）+ port null guard + listener 掛載包 try/catch；(2) **Shinkansen commands 在 WPA 可用的疑似差異 = 它的 content 每頁載入 sendMessage**（sticky query / log）把 background 拉起來 → JRead 補 wake ping（content 載入時發 `BG_WAKE_PING`，Safari 全平台、Chrome 不發；SW 回 `{ok:true}`）。**v0.8.34 三次修正（wake ping 實測無效後，Shinkansen 存活配方完整解碼）**：⌃R 復活（content 軌正常）但 ⌥R / menu 仍死 → Shinkansen 的真配方是**兩件組合**：(1) `alarms` 權限 + 24h 週期 alarm——alarm 是持久化排程，WPA 啟動時逾期 alarm 迫使 WebKit 喚 background（每天首開逾期 → 能動；短時間重開未逾期 → 全滅，完美解釋其間歇模式）；(2) keep-alive port 的 gate 是 build-time `IS_IOS_BUILD`（Mac 上也 true）→ alarm 拉起後 port 保活整個 session。JRead v0.8.34 對齊：manifest 加 `alarms` 權限、SW 建 `jread-bg-wake` 5 分鐘週期 alarm（gate `IS_SAFARI_RUNTIME`，Chrome 不建；onAlarm 空 listener 無條件註冊）、keep-alive port gate 改回全 Safari（v0.8.33 null guard 保留）。雞生蛋注意：alarm 由 background 建立，WPA 內 background 第一次跑起來前 alarm 不存在——bootstrap 靠 extension 更新 / 設定頁啟用切換 / 一般 Safari 喚醒（若 alarm 狀態跨 context 共用）。**最終結論（2026-06-10，Jimmy 拍板）**：v0.8.34 完整 bootstrap（Safari 端觸發 background 建 alarm + WPA 設定關開切換）後等 alarm 逾期、開著測 + 重開測都仍無效——**macOS Safari WPA 內 JRead 的 manifest 預設鍵與 menu「延伸功能動作」認定為 WPA 平台層 bug（WONTFIX，等 Apple）**。Shinkansen 同場景可用的完整機制至今未能複製（alarms + keep-alive port + onStartup + wake ping 全部對齊仍不行，殘餘差異：`nativeMessaging` 權限 / native handler 實作 / `type: module` background / all_frames content scripts——不再逐一實驗）。**WPA 的支援路徑 = 自訂快速鍵 ⌃ 組合**（content 軌本地派送、不依賴 background，⌃R 實測穩定）。v0.8.34 的 alarm / wake ping / keep-alive port 保留（iOS 對策 + 無害、移除需再發版不值得）。

**訊息層 `chrome.*` → `browser.*` 原生 Promise（v0.8.164，對齊姊妹專案 Shinkansen）**：JRead 全擴充原本用 `chrome.*`（callback shim）；Safari 的 `chrome` 相容層比原生 `browser.*`（Promise）不可靠，是 Jimmy 2026-06-22 回報「快速鍵 / 懸浮按鈕叫 popup（`OPEN_FEATURE_MENU`）/ popup 套設定字體 +/- 常失效、要重整」的訊息層根因（功能設計與 Shinkansen 等價、壞在底層送達可靠度）。修法：(1) **跨瀏覽器 shim** `globalThis.browser = globalThis.browser ?? globalThis.chrome`——Chrome 退回 `chrome`（MV3 無 callback 時一樣回 Promise，行為零變化）、Safari/Firefox 用原生 `browser.*`；放兩個 bootstrap（互為鏡像、受控雙寫）：`content/namespace.js`（content_scripts 第一個檔，後續 content script 繼承）與 `content/settings-defaults.js`（popup.html / options.html 第一個 `<script>`，且 SW 的 Chrome importScripts / Safari·Firefox event page scripts 早期載入檔，popup-core.js 零 chrome 參照不卡）。(2) 全擴充原始碼（content / SW / popup / options）callback → `.then()`/`await`、`runtime.lastError` guard → `.catch()`；`NS.safeSendMessage` 內部改用 `browser.runtime.sendMessage(msg)` 單一 Promise 呼叫（resolve→cb(res) / reject→cb(null)，對外 callback 介面不變）。(3) **頁面恢復重讀 storage 重套設定兜底層**（不依賴任何訊息送達）：content `main.js` 掛 `pageshow` + `visibilitychange`→`visible` listener，閱讀模式 active 時呼 `reapplyFromStorageOnResume` → `scheduleReapply`（內 `await getSettings()` 直讀 `browser.storage.sync` 拿最新值）——iOS popup 掛起底層頁、`storage.onChanged` 與 `REAPPLY_SETTINGS`（v0.8.148）都掉包時，popup 收合 / 切回分頁的恢復訊號仍能自我修正字級 / 主題（桌機不掛起、onChanged 照收，此處只是 200ms debounce 合併的冪等重套）。forcing function：`test/regression/browser-compat-shim.spec.js`（兩 bootstrap 有 shim + 全擴充零 `chrome.*` 殘留）、`test/regression/ios-resume-reapply.spec.js`（pageshow / visibility→visible listener + guard + scheduleReapply 接線）。**Safari 訊息可靠度提升 + iOS 掛起時序只能 TestFlight 實機驗**——harness 驗邏輯 / 接線 / 恢復重讀那層，不驗 iOS 真實掛起。Chrome / Firefox 行為零變化（`browser === chrome`，2496 spec 全綠 + Chromium harness 閱讀模式 + RESIDUAL / GAP / CONTRAST audit 全過）。

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

1. 語意標籤：`<article>`（單一或明顯最長者；多個相近篇幅判為列表頁而降級）。多個 `<article>` 挑選前先做**視口相交過濾**（v0.8.45）：無限捲動站把「下一篇」preload 成同文件的第二個 article 且可能比本文長（thenewslens 實證），「挑最長」會選到使用者沒在看的那篇——有視口相交者只在相交者中挑；全部不相交或 rect 不可用（jsdom）退回全集合
2. Schema.org：`[itemtype*="Article"]`、`[itemtype*="NewsArticle"]`、`[itemtype*="BlogPosting"]`
3. OpenGraph：`meta[property="og:type"][content="article"]` 搭配啟發式（暫未實作）
4. 內容密度啟發式（Readability-style bubble-up）：對 `<p>` / `<li>` / `<h2-4>` / `<blockquote>` / `<pre>` / `<section>` 算 contentScore（文字長 + 逗號數），向 parent 100% / grandparent 50% 累加；容器型元素（`DIV` / `SECTION` / `MAIN` / `ARTICLE` / `TD`）以累積分勝出。此法避免「站體外殼因後代 p 總數多而贏過真主文容器」。**`<section>` 納入 signal（v0.8.132）**：對標 Mozilla Readability 的 `DEFAULT_TAGS_TO_SCORE = "section,h2,h3,h4,h5,h6,p,td,pre"`——它把 `<section>` 當內文段落計分。微信公眾號文章（mp.weixin.qq.com）整篇內文段落用 `<section>`（外加 `<span>`）排版、幾乎不用 `<p>`，主文容器 `#js_content` 下只有個位數 `<p>`；不收 `<section>` 會讓整頁收不到 signal、`candidates` 為空、heuristic 回 null（「此頁無法偵測本文」）。`<section>` 是 HTML5 通用語意容器、非站點特判；section/p 並存的站點靠 linkDensity penalty + textLen bonus 仍讓真主文勝出。**`TD` 納入候選白名單（v0.8.82）**：老式 table 排版的內容頁（Paul Graham essays、早期手寫 HTML / newsletter）整篇主文放在一個 `<td>` 裡（signal `<p>` 的祖先鏈 `P → FONT → TD`），不收 TD 會讓 `candidates` 為空、整頁偵測失敗（paulgraham.com/boss.html 實證）；linkDensity penalty + textLen bonus 仍讓真內容容器勝出，資料表 / infobox 的高連結密度小 TD 不會搶贏低連結密度的長文 TD
5. 兜底：`<main>` 本身作為主文（順序最後，避免多欄 layout 的 `<main>` 吞 sidebar）
6. 降級：若分數低於閾值，**不啟動閱讀模式**（no-op），不硬套

### Title promote（所有非兜底策略）

Stratechery / Medium / Substack / anthropic.com 等站點常把 post-title 跟 post-content 放兄弟層：WordPress 是 `<h2 post-title>` 跟 `<div entry-content>` 同級（heuristic 選中 content）、anthropic 則是 `<h1>` 放在 `<section hero>` 與 `<article>` 同級（article-tag 選中 article）。detect() 出口統一做 promote：沿主文容器祖先鏈往上，若兄弟中有 h1/h2 文字與 `meta[property="og:title"]` 或 `document.title`（取分隔前首段）雙向包含匹配，把主文容器升級到該共同 parent，使 title 納入主文 scope。作用於 article-tag / schema-org / heuristic；**main-tag 是兜底本身已是最外層，不做 promote**（避免無止盡向上擴散）。

**唯一 H1 結構升級（`ensureArticleContainsTitleH1` path 0，v0.8.58）**：上述 promote 全靠文字比對 og:title，translate-first（Shinkansen 等把 H1 換成中文、`og:title`/`<title>` 維持原文）會讓比對全失效。detect() 結尾無條件兜底加一條純結構訊號：**全頁恰好 1 個 H1 且不在 articleEl 內 → 該 H1 必是文章 hero（section 副標慣例用 H2+，整頁唯一 H1 不可能是某節副標）**，升到 `findLCA(articleEl, h1)`、`dist=Infinity`、不靠文字。場景：myartbroker「5 幅畫作」這類無 `<article>`/`<main>` 的多節長文，每節是深層巢狀獨立容器，heuristic bubble-up（只給 parent/grandparent 2 層）只選中第一節 → 翻譯後卡單一 section（reader 只剩第一幅畫）。安全保證：`findTitleViaLca` 的 body/html guard 確保唯一 H1 與 articleEl 須共享非 body 容器才升、不吞整頁；ChinaTalk（多 H1）/ wya（12 H1）`allH1.length !== 1` 不觸發。

**標題注入 fallback（`markPromotedTitleIfMissing`，v0.7.87/v0.7.88）**：站若把標題寫在非 heading tag（newtalk `<p class="name">` 等），cleaner 跑完後掃 articleEl 內 og:title 相符的 text element（bestCand），注入獨立 `h1[data-jread-injected-title]` 在 articleEl 開頭並 hide 原元素。guard 鏈：可見 h1-h4 文字等同 og:title → 不注入（v0.8.3）；**bestCand 候選必須「視覺上有呈現」——自身 + 祖先鏈無 `display:none` / `visibility:hidden|collapse` / `opacity≈0`（v0.8.55，nytimes translate-first 實證：站方 sticky masthead 留有「當前文章標題」隱形英文副本，翻譯擴充只翻可見文字 → 真 h1 已中文不 match 英文 og:title、bestCand 卻命中隱形英文副本 → 注入英文 H1 又被翻譯 guard 譯成另一版中文 → 重複標題。注入的存在理由是「站方以非 heading 呈現標題」，隱形元素不構成呈現；可見副本必然已被翻譯而自然落選，兩側閉環）**。可見性判定不用 getBoundingClientRect（jsdom fixture rect 全 0 會誤殺），逐祖先檢查各自 computed style。

**翻譯頁標題 clone 放 articleEl 外（`placePromotedTitleClone`，v0.8.131）**：`promoteUniqueTitleH1Into` / `promoteArticleTitleClassHeadingInto` clone 標題後的插入位置統一由 `placePromotedTitleClone` 決定。`translationGuardActive()`（頁面存在 `[data-shinkansen-translated]` / `[data-shinkansen-dual-source]`）為真時，把 clone 插在 articleEl **前一個 sibling**（非 articleEl 子節點）、標 `data-jread-promoted-outside="1"`；否則維持原本 in-article prepend。動機（cage 真實 Chrome + Shinkansen 證實）：翻譯擴充的 content guard 每秒 reconcile 被翻譯 articleEl 的子節點、會把 JRead promote 進去的標題 clone 當外來節點清掉（插入後 ~200ms 內被移走，且 plain h1 / div wrap / 移 Shinkansen 自己的 h1 進去全部撐不過幾秒）；clone 移到 articleEl 外才存活（guard 只碰被翻譯容器的子節點）。styler 對 `[data-jread-promoted-outside]` 套讀者卡片同版心/置中/背景/上圓角、去底 padding/margin，與下方主文卡片合併成單一張卡片；該 attr 也排除在祖先鏈隱藏規則外。restore 走既有 `__titleClone` removeChild path（與 in-article clone 同）。非翻譯頁 baseline 零變動。

**標題最小長度門檻 CJK 加權（`titleTextWeight`，v0.8.141 起）**：`promoteUniqueTitleH1Into`（h1Text / baseTitle）與 `promoteArticleTitleClassHeadingInto`（heading text）三處的「太短不像主標題」過濾，從 raw `text.length < 5` 改用 `titleTextWeight(text) < 5`。`titleTextWeight` 對 CJK 字元（漢字 `㐀-䶿`/`一-鿿` + 假名 `぀-ヿ` + 諺文 `가-힯`）計權重 3、其餘字元權重 1（v0.8.142 由 2 提到 3）。動機：原 `length < 5` 用於過濾 "Home" / "News" 類 site-logo 垃圾 h1，但按拉丁文字校準——中文是表意文字、每字資訊量 ≈ 一個拉丁單詞，4 字標題（Miniflux「儲存空間」entry）被 v0.8.141 前的 `< 5` 誤殺；v0.8.141 設權重 2 時門檻 5 仍需 ≥3 CJK 字才過，2 字標題（Miniflux「微光」entry）照樣被誤殺 → 不 promote → reader card 內無標題。權重 3 後拉丁行為不變（5 字仍過、4 字仍擋）、CJK 只需 ≥2 字即過（2×3=6）、單一 CJK 字（weight 3 < 5）仍被擋保留單字 junk 防線。promote 兩條路徑另有 strict equality（h1===document.title）/ strict title-class guard 擋 junk h1，故放寬門檻不會誤 promote 2 字 site-logo。結構通則、非站點特判。forcing：`miniflux-short-cjk-title.spec.js`（4 字）+ `miniflux-short-cjk-title-2char.spec.js`（2 字）。

### SPA 導航偵測與無限捲動豁免（v0.8.21 / v0.8.45）

三訊號收斂到 `onSpaRouteChange`：popstate、`<title>` childList MutationObserver、800ms href 輪詢；比對 key 走 `spaRouteKey`（錨點 hash 不算導航、`#/` hash-router 算）。路由真變化 → exit 拆舊卡 → 400ms 後視情況 silent 重進（wasActive 或新路由命中 auto-enable）。

v0.8.45 **無限捲動豁免**：URL 變了 ≠ 真導航——先驗 DOM 事實。無限捲動站（thenewslens 實證）preload 下一篇並依「視口在哪篇」replaceState 切 URL / title；進閱讀模式瞬間頁面高度劇變觸發站方視口判定 → URL 被切到下一篇 → 舊版誤判真導航 exit → 還原原頁 → URL 又切回 → 循環（reader 永遠掛不穩）。判別：真 SPA 導航會拆掉舊路由 DOM（articleEl disconnected）；無限捲動的 URL 同步不動原文章 DOM。`NS.state.articleEl.isConnected` 仍為 true → 保持 reader mode、只更新 `_spaLastUrl`。cinema 模式 articleEl 為 null、自然走原 exit 路徑。

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

collapse 後對 visible children 的寬度 reset（`width: auto !important` + flex longhand 清零）**跳過 replaced element**（img / svg / video / picture / canvas / iframe / embed / object，v0.8.43）——reset 的對象是 Bootstrap col-* 類「layout 欄位」children，replaced element 不可能是欄位；且清掉原站 icon 圖的 stylesheet 寬度後，viewBox-only SVG 的 `<img>`（無內在尺寸）依 CSS spec 撐滿 containing block（eettaiwan content-footer tags.svg 18px → 603px 巨型 icon 實測）。`collapseGridWithHiddenCell` 與 `collapseInnerFlexWrap` 兩條 child reset path 同一豁免。

### 標題區（header zone）裝飾 icon（v0.8.43 通則）

標題下方除了必要的作者及日期文字，不出現 icon（Jimmy 2026-06-11 通則）。結構定義：article 開頭到「第一個內容區塊」（首個 ≥ 60 chars 的可見文字段落、或第一張 ≥ 200×100px 媒體）之間是 header zone；zone 內 rect ≤ 32px 見方的 img / svg 視為裝飾性 meta icon（時鐘、人像、書籤、分隔點）一律 hide——資訊已由旁邊的日期 / 作者文字承載。誤殺防線：heading（h1-h6）內小圖不動（標題 emoji 是內容）、preserved 元素內不動、rect 0×0（lazy / 已隱藏）不動、zone 之後的內文 inline emoji 完全不掃、zone 終點找不到整條 no-op。

### 空殼 wrapper collapse 的 icon-size 媒體豁免（v0.8.44 通則）

`collapseEmptyWrappersAfterClean` / `collapseEmptyBlockSpacers` 判定「wrapper 是否含真實內容媒體」（`hasUnhiddenContentMedia`）時，已 layout 且 rendered rect ≤ 32×32 的 img / svg 視為裝飾 icon、不算內容媒體——雜訊列（如 tag 列）被 hide 後 wrapper 只剩孤兒 icon 時，空殼 collapse 不再被 icon 擋下（eettaiwan `.content-footer` 內 24×24 tags icon 實測）。icon 判定必須用 rendered rect、不可用 naturalWidth：viewBox-only SVG 的 `<img>` 無內在尺寸、natural 回 CSS 預設 150×150。rect 0×0（lazy 未載入 / 未 layout）不走此豁免，留給 `imgIsContentMedia` 的 lazy 判定兜底。

### flex-row 殘殼欄（v0.8.45 通則）

flex 兩欄 layout 的推薦 / 廣告 rail 在 clean 當下有完整內容（theverge instrument 實測 2123 chars，sidebar 各條件不命中），之後**內部**被其他 rule 逐個清空只剩殘殼——wrapper 本身仍 visible、`flexGrow:1` 照樣占走 50% 寬、主文被壓到卡片 42%。`hideEmptiedFlexColumns`（跑在所有 hide 規則之後、collapse 之前）：flex-row container 內非主欄（主欄粗文字 ≥ 500）+ **可見**文字 < 100 chars + 含 ≥ 1 個被 jread hide 的後代（證明被清空、非原生 spacer）+ 無 visible 大媒體 → hide 殘殼欄，緊接的 collapse 看到 hidden child 自然觸發退化、主欄回滿寬。

### 次要全文 aside（v0.8.112 通則）

無限捲動 / 嵌入把「下一篇文章」整篇注入成 `<aside>`（womany.net `.article-root` 含自己的 `<h1>` 實證）。`asideIsSecondaryArticleBlock`：`<aside>` 滿足任一 → 「次要全文區塊」整塊 hide——(a) 內含自己的 `<h1>`（次要 aside 不該帶 page-level h1，這是「另一篇完整文章」最強且 **layout-independent** 的訊號，根治偵測選到哪層 articleEl / 注入時序的非決定性漏網）、(b) rectH > `SIDEBAR_ASIDE_MIN_HEIGHT`(400)、(c) textContent > `ASIDE_DYN_MIN_TEXT`(400)（layout 未就緒 fallback：動態一次注入完整 aside 時 `getBoundingClientRect` 回 0）。guard：必須 `<aside>` tag、非 articleEl 自身 / 祖先、非 preserved。pull-quote / infobox（無 h1、矮、短）不命中。靜態 `hideSecondaryArticleAsides` 掃整棵 `querySelectorAll('aside')`（補條件 B 只查 direct-child sibling 的限制）+ 動態 `checkDynamicNoise`（node 自身 / 其內 / `closest('aside')` 祖先補查涵蓋「空殼後 hydrate」時序）共用此 helper 單一資料源。

**圖片式廣告 banner（strong keyword 內容圖連結，v0.8.112）**：`<a class="related-block" href="/redirects/...">` 包大促銷圖（文字烤進圖、a 無文字，womany 塔羅 app 跨宣傳實證）結構與 lightbox 大圖連結撞型，被 `anchorIsContentImageLink` 豁免殘留。修法：(1) `related` 雜訊 token suffix 補 `block`（CMS「相關/推薦內容區塊」通用命名，boundary 後置不誤中 `related-blockquote`）；(2) **strong keyword**（related / sponsored / 品牌 widget 命名）命中時靜態 / 動態 keyword `<a>` path 皆不套內容圖豁免——正當內容照片的 lightbox 連結絕不命名 related/sponsored，零誤殺；weak keyword（popup 等）內容圖連結仍受豁免保護。

### heading 旁動作連結（v0.8.45 通則）

MediaWiki 類站每節標題旁有「[編輯]」動作連結（zh.wikipedia WK4）。結構通則：heading（h1-h6）**內部**或 **heading wrapper 內 sibling**（新版 MediaWiki `DIV.mw-heading > H2 + SPAN`）的含 `<a>` 的 `<span>`、文字 ≤ 12 chars、括號包裹（`[編輯]` / `(edit)` 跨站視覺慣例）或占 heading 文字 < 30% → 連 wrapper 一起 hide（只清 `<a>` 會留括號殘渣）。sibling 掃描限「wrapper 純粹包標題」（wrapper 文字 ≤ heading + 15 chars）。連結式標題（a 占整個 heading）不命中。

### video player 佔位保護（v0.8.45 三 guard）

player 的佔位高度常由 aspect spacer（padding-top hack）/ grid rows / absolute 子層撐著，被一般 spacing / collapse 規則打掉後 player JS 會以負 margin 把 video 置中於塌掉的容器——video 突出蓋字 + 流空間錯位出大片假空白（ms.now JW Player 245px 實證，被三條規則圍毆）。三條結構 guard（皆不綁 class）：

1. `capWrapperSpacing`：parent 含 video / iframe sibling 的 wrapper 大 padding 是媒體佔位、不 cap（v0.7.181 同款判定）
2. absolute overlay 的 parent 高度 reset：parent 是 player 結構（`data-jread-player`）或內含 visible video / iframe → 不 reset
3. `collapseInnerGridFlex`：子樹含 visible video / iframe 的 grid 跳過 collapse

styler 端同輪：gallery flex 規則（v0.7.93）排除 player 結構（與 v0.7.182 bg strip 同原則）；媒體寬高規則加 `min-height: 0 !important`（cw.com.tw 站點對 hero img 設 min-height 645px，height:auto 被頂住、object-fit contain letterbox 出上下假空白）。

### 可播放原生 audio/video 還原寬度（v0.8.116）

站方自訂播放器常用一組 flex wrapper（如 `flex-direction:column; width:0`）把原生 `<audio controls>` / `<video controls>` 擠成 0 寬、改由自訂 JS UI 呈現控制條（Stratechery passport-podcast-player 實證）。reader mode 清掉自訂 UI 後只剩 0 寬裸媒體 + 短標籤＝一大塊空白，但媒體本身 controls + 有效 src 本來可播放。styler 通則（純 CSS `:has`，非站點/class 特判）：reader scope 內任何含 `audio[controls]` / `video[controls]` 的祖先鏈解除 flex/0 寬壓縮（`display:block` + `width:auto` + `min-width:0`），媒體本體還原可用寬度（`width:100%` + `min-width:min(100%,320px)` 兜底）。只命中 `[controls]`（使用者可播放介面），裝飾/背景 JS-driven 媒體不誤撐；`display` 不下在媒體本體（會把原生 replaced 控制條高度壓成 0）。

### 主文內雜訊（跨站通用 keyword heuristic）

主文容器內出現以下 class / id 關鍵字的區塊視為雜訊（不分大小寫）：

- `paywall`、`subscribe`、`newsletter`、`signup`
- `promo`、`promotion`、`advertisement`、`sponsored`、`sponsor`（動詞詞根覆蓋 udn `.sponsor-ads` 類）、`ad-`、`-ad`
- `cta`、`call-to-action`
- `related-(articles|news|posts|stories)`、反序命名 `(post|article|news|story)-related`（v0.8.44 eettaiwan `post-related`）、`more-(news|stories|posts|articles)`、`recommended`、`recommend`、`recommendation`、`read-more`、`read-next`、`up-next`、`taboola`、`outbrain`、`zergnet`、`revcontent`
- `hash-tag`、`tag(s)-list`（v0.8.44 補複數變體：eettaiwan 文末 tag 列 class 用 `tags-list`，原 `tag-list` token 不命中）
  - **結構型 tag chip 列偵測（`hideInsideArticleHashtagClusters`）**：上述靠 class keyword、漏掉 class 不含 tag 字樣的 tag bar。結構通則補強——容器內 `>= 3` 個 anchor 且多數是 tag chip 時整列 hide。tag chip 認定：anchor 文字起手 `#`（文字型 hashtag），**或 href 指向 taxonomy 頁**（v0.8.77，`/tags?/`・`/categor(y\|ies)/`・`/topics?/`・`/labels?/`）。後者解 0xkato.xyz Ghost 站 `<a class="item">機器學習</a>` + `.item::before{content:'#'}`——`#` 是 CSS 裝飾不在 textContent、且翻譯後文字變中文，純看文字 `#` 0 命中整列漏網；href 不隨翻譯改、跨 CMS 通用（Ghost / WP / Medium）。guard：含媒體 / direct text > 5 字 / 內含 >= 50 字長段落的 wrapper 都 skip（防誤殺含主文的外層）。forcing：`ghost-post-tags-taxonomy-href.spec.js` + `roomie-mobile-hashtag-meta-bar.spec.js`
- `breadcrumb(s)`、`pagination`、`page-nav`、`pager`、`author-(bio|card|info|box|meta|widget)`
- `follow`、`follow-us`、`subscribe`、`subscription`、`newsletter-(signup|form|cta)`、`email-(signup|capture|subscribe)`
- `cookie-(banner|notice|consent|bar)`、`gdpr`、`consent`、`privacy-(banner|notice)`
- `popup`、`overlay`、`modal-(content|dialog|box|wrapper)`、`floating-(bar|cta|widget)`、`sticky-(bar|cta|banner|subscribe)`、`toast`、`snackbar`、`notification-(bar|banner)`
- `audio-(player|widget)`、`postlisting`、`post-listing`、`thread(s)`、`reposted`、`repost`
- `social-(bar|links|icons|share|media)`、`share`、`social`
- `comment`、`comments`、`comment-form`、`discussion`、`discuss`、`disqus`、`livefyre`、`hyvor`（跨站 CMS 留言區 anchor 慣例：Substack `#discussion`、WordPress `.comments-page`、Disqus `#disqus_thread`、Ghost `#comments`）

**英文網頁 heading 文字慣用語**（`NOISE_HEADING_TEXT_RE`）：Related Articles / Recommended for you / More from X / More in X（v0.8.54）/ You may also like / Read more / Up next / Continue reading / See also / See more on（v0.8.54）/ Further reading / Editor's Picks（含複數所有格 Editors' Picks，v0.8.54）/ Sponsored content / Comments(N) / Discussion(N) / Responses / Replies / Newsletter / Subscribe / Follow us / Trending / Popular / Top Stories / AI Summary / AI Digest / Hot / New / Top。錨定推薦字樣 `^(related|recommended|popular|trending|latest|featured)…$` 同步收進 EXT 層（max_len 40，v0.8.54——「Trending in The Times」21 chars 超過 base 的 20 漏網實證）。文中雜誌期數推廣 `^explore\s+the\b.*\bissue$`（v0.8.113——The Atlantic「Explore the December 2024 Issue」文中插入的本期雜誌推廣 section，封面圖被 styler 撐成整頁大 + 「View More」連該期 TOC；31 chars 走 EXT max_len，`closest('section')` 整段清除）。譯文變體 `(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*(?:號|刊)$`（v0.8.114——Shinkansen translate-first 後 heading 譯成「探索 2024 年 12 月號」英文 pattern 失效；錨定翻譯無關的「雜誌期數出版標記」語意核心而非賭動詞譯法，純日期無號/刊不命中）

**中文 heading 文字慣用語**：延伸閱讀 / 同場加映 / `相關(新聞｜文章｜報導｜行情｜議題｜貼文｜影片｜內容)`（v0.8.77 補 貼文／影片／內容——Shinkansen 把 Ghost「Related Posts」翻成「相關貼文」，原僅 新聞／文章／報導／行情／議題 不命中、整列 recirculation 漏網；翻譯後文字才現形，href 結構 `resolveHeadingNoiseTarget` 兩模式相同、純卡 regex）/ 推薦閱讀 / 推薦文章 / 最新消息 / 更多相關 / 看更多 / 你可能喜歡 / 繼續看下去 / 文章標籤 等。命中後 `resolveHeadingNoiseTarget` walk-up 到「不含主文長段落 / 標題 anchor」的最深 wrapper 整塊 hide

**英文網頁 link/button 文字慣用語**（`NOISE_LINK_TEXT_RE`）：View original / Read the full article / Back to top / Show more / Load more / Learn more / Get the app / Download app / Open in app / Subscribe / Follow / Like / Share / Repost / Reply / Comment / Save / Bookmark / Sign up / Log in / Clap / Join our newsletter / Follow us on Twitter / Subscribe to our newsletter / N hours ago / N minutes ago / Order Reprints（v0.8.54）/ Today's Paper（v0.8.54）

**byline 文字 pattern**（`BYLINE_TEXT_RE`，保護用——短篇 byline 不被 link-density killer / all-buttons / inset-card 等規則誤殺）：英文前綴 `by` / `written by` / `posted by` / `author(s):`、各式英文 / ISO / 中文年月日日期、中文 byline 前綴 `撰文：` / `作者：` / `編輯：` 等（**帶冒號**形式）。**v0.8.128**：補「行首裸 CJK byline 前綴詞」——`作者` / `撰文` / `編輯` / `整理` / `報導` / `編譯` 出現在字串開頭、後接空白 / 冒號 / 拉丁字母即命中，**不強制冒號**。動機：translate-first 時翻譯引擎把英文前綴 `by` 譯成裸「作者」（無冒號，名字保留英文 → `作者 Andrew Liszewski`），既有 `作者[:：]` 強制冒號全 miss → byline 保護路徑連坐失效、`<span role="button">` 作者名 chip 被 all-buttons 規則清掉（The Verge translate-first 實測、cage real Chrome）。lookahead 後接 CJK 字（作者群 / 作者的話 / 作者簡介）則不命中、避免吃到正文；`^\s*` 錨定 + 短 textLen 雙閘控誤判。Forcing：`theverge-translated-byline.spec.js`

**文末 link-feed 與 curated 區塊（v0.8.54，nytimes 實證）**：
- **link-feed 覆寫 tooWide 主文保護**（`isLinkFeedContainer`）：heading 命中雜訊 pattern 後，目標 section 若「無任何 >= 100 chars `<p>` + link density >= 0.5 + >= 3 連結」即視為推薦 feed，不受 `wrapperContainsMainContentP` 累計門檻（短 teaser p 累計 >= 300）保護，整塊 hide
- **印刷版出處聲明行**（`hideInsideArticlePrintEditionNote`）：`appear(s|ed) in print on/in` 句式 + 區塊總文字 <= 250 + 無長 p → 整行 hide（含 Order Reprints / Today's Paper / Subscribe 連結與分隔符 span）
- **文末 curated 故事集連結卡**（`hideTailCuratedLinkLists`）：位於最後主文長段落之後的 `<section>`、>= 2 個 li 且每 li 含 `<p>` teaser 與站內連結（hostname 相同、pathname 不同、非 # anchor）、無 li 外長 p、文字量 < 主文 30%。guard：Wikipedia References / See also（li 無 p wrapper）、外站 citation list、listicle 主體（占比 > 30%）皆不命中
- **JS 影片播放器函式庫 widget**（`hideInsideArticleVideoPlayerWidgets`，v0.8.140 inc.com 實證）：站點在主文段落間注入的「Featured Video / 推薦影片」widget（JWPlayer 等 JS 播放器，內容與本文無關）。anchor 在函式庫 root class `.jwplayer`（跨站通用簽章、非站點 class），ratio walk-up（父層文字量 > 當前 ×3 + 80 視為碰到主文 body 即停）找出注入 wrapper 整塊 hide；雙保險：wrapper 含 >= 100 chars 主文 `<p>`（不在播放器 root 內）→ 不 hide。**時序覆蓋**：靜態 clean()（`.jwplayer` 已存在）+ `checkDynamicNoise` 動態接（iOS 上 JWPlayer 在 clean() 之後才 init、observer subtree 捕捉新增的 `.jwplayer`）兩 path 共用 `hideVideoPlayerWidgetFrom`。編輯性影片（`<figure><video><figcaption>` / YouTube iframe embed）不走函式庫 root class、不命中。forcing：`inc-featured-video-jwplayer-widget.spec.js`

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
5. 圖片 / 影片 max-width: 100%（避免超出卡片寬度）；同條 rule 一併清 `min-width: 0 !important`（v0.8.75——0xkato.xyz Ghost 站對 `.bigger-image` 設 `min-width: 130%` 讓配圖向版心外 bleed，CSS 規範 min-width 勝過 max-width、max-width:100% 壓不回去、圖被頂在 130% 寬衝出卡片爆版被切；reader 單欄不需 bleed，min-width 歸零讓 max-width 生效縮回版心寬。結構通則、不綁站點 class，與既有 `min-height: 0` 清原站 bleed 用 min 約束同款。forcing：`bigger-image-min-width-bleed.spec.js`）
6. aspect-ratio placeholder 破解：含 `<img>` / `<picture>` / `<video>` 的容器清 padding-bottom 與 aspect-ratio（專門破 Substack / Medium 的 `padding-bottom: 56.25%` hack）
7. `figure` / `picture` 強制 `width: auto !important` + `max-width: 100% !important`（v0.6.10 修商周類原站給 figure 固定寬 CSS 在 reader mode 下失效、figure 退化成 shrink-to-fit 被 figcaption 夾死的場景）
8. `[data-jread-hidden="1"] { display: none !important }`（v0.6.11 補 cleaner hide 漏洞——cleaner 只設 inline `style.display = 'none'` 無 !important，站點 JS scroll/timer handler 主動寫 `el.style.display = 'block'` 會覆寫 inline display + 清掉 priority。stylesheet !important 優先級 > inline 無 priority 值，browser 層級勝出，擋得住 JS 覆寫）
9. 閱讀進度條（v0.7.191）：`#__jread-progress` 固定在 viewport 頂端的 3px 細線，寬度隨捲動即時更新（`scrollTop / (scrollHeight - clientHeight) * 100%`）。顏色跟主題連動：light `#4A90D9` / dark `#7fb5e6` / sepia `#2c5282` / gray `#2c5282`。`z-index: 2147483647` + `pointer-events: none`。apply() 建立 DOM + scroll listener、restore() 清除
10. `<meta name="theme-color">` 覆蓋（v0.8.24）：閱讀模式下 apply() 把頁面所有 theme-color meta 的 `content` 覆蓋成 reader card 色（`theme.articleBg`：light `#ffffff` / dark `#4a494d` / sepia `#eee2cb` / gray `#ededed`），restore() 還原（原有的還回原 content、自建的移除）。多個 light/dark media 變體全部覆蓋成同一 JRead 色、完全沒宣告時自建一個。通則不綁站點。DOM 操作層由 `styler-theme-color-meta.spec.js` 把關。**平台效果**：Chrome / Android Chrome（位址列）/ 桌面會用 theme-color 染瀏覽器 chrome、本覆蓋有效；**iOS Safari 完全不理 theme-color**（2026-06-09 iOS 26.5 模擬器實證），iOS 狀態列/工具列染色取自頁面 `<html>` 背景、載入時取一次後凍結，content script 之後任何背景變更（theme-color / stylesheet / inline / document_start / 程式捲動）都不觸發重取樣，只有真實使用者觸控會（分頁模式又攔掉觸控）。**故 iOS 上分頁模式螢幕上下端的原站色無法由 JRead 代換**——WebKit 架構限制、非 bug，詳見 memory `project_ios_statusbar_chrome_uncontrollable`
11. 裸內容圖放大填欄寬（v0.8.112）：裸 `<img>`（非 `<a>` 包、非 inline emoji、非 capIcon 作者縮小圖）且 content-size（natural / rect 任一維 >= `CONTENT_IMG_MIN`(200)）標 `data-jread-upscale-img`、CSS `width: 100% !important` 撐滿欄寬。站點常把低解析配圖（natural < 版心寬）以原尺寸顯示，reader 的 `img:not(a>img){width:auto}` 退回 naturalWidth → 在 720 版心裡偏小、與 `<a>` 包大圖（填欄寬）不一致（womany.net 卡蘿配圖 natural 285px 在 608px 欄只佔半寬實證）。Safari / Firefox 閱讀模式同款「內容圖一律填欄寬」。icon / logo（< 200px）不標、維持原尺寸（不反向放大成滿版）；裸大圖 width:100% = cap、無害。`max-height: 90vh` + `object-fit: contain` 由既有 MEDIA_CAP_SEL 收斂直式長圖。restore() 移除標記。DOM 標記由 `womany-bare-content-img-upscale.spec.js` 把關
12. `<meta name="viewport">` 正規化（v0.8.139）：閱讀模式下 apply() 把頁面所有 viewport meta 的 `content` 正規化成 `width=device-width, initial-scale=1`（完全沒宣告時自建一個），restore() 還原（原有的還回原 content、自建的移除）。**根因**：行動瀏覽器拿 viewport meta 算 layout viewport 寬度與初始縮放；站點宣告 `initial-scale < 1`（daringfireball `initial-scale=0.5`，故意讓寬版面在手機縮一半顯示）、固定 `width=980`、或根本沒宣告（Safari 預設 980px layout viewport 再縮到螢幕寬）時，reader card 換成行動寬度後整張卡仍被釘在縮小的初始縮放上、視覺上「縮小一半」。通則不綁站點。**平台效果**：桌面瀏覽器忽略 viewport meta、本覆蓋對桌面 no-op；iOS Safari 確實會在 post-load 動態改寫 viewport meta 後重算縮放（2026-06-20 模擬器 standalone HTML 實證 `initial-scale=0.5 → 1` 從縮小跳回滿版），故本修法在 iOS 有效。DOM 操作層由 `styler-viewport-meta.spec.js` 把關

### 版心自我檢查（enforce content width，v0.7.246 / v0.7.247）

`apply()` runtime 自我檢查：圖片撐滿 reader card 版心、但內文 / 標題 / 分類列被中間 wrapper 的水平 padding 夾窄時（roomie.tw 內文 `div.content { padding: 0 20px }`、標題列 `div.mobile-info { padding: 0 24px }`，Jimmy iPhone 回報），把內容撐回滿版。reader card 是單欄 layout、card padding 是唯一應有的閱讀內距——**遍歷 card 內所有通用 block wrapper（`div` / `section` / `article` / `main` / `aside` / `header` / `footer` / `nav`）+ 文字 block（`p` / `h1`–`h6`）**，把水平 `padding` / `margin` 清零（inline `!important`）。

v0.7.247 從「沿段落祖先鏈走」改為「全面遍歷」：roomie 可見標題是 `<span>`（語意 `h1` 是 sr-only `display:none` 又空），沿段落鏈走不到標題 wrapper——直接遍歷才涵蓋標題。排除規則：(1) 語意縮排容器（`blockquote` / `ul` / `ol` / `dl` / `li` / `figure` / `figcaption` / `table` 及其 cell / `pre` / `details`）自身與其後代不動，保留引言 / 清單 / 表格 / 程式碼縮排；(2) `data-jread-hidden`（cleaner 清掉的雜訊）不動。水平 `margin` 清零安全的理由：既有規則已對這些元素設 `width: auto` / `max-width: 100%`，滿版元素的 auto margin 算成 0，故 computed 水平 margin 非 0 必是「顯式非置中 margin」。**v0.8.123：判定改用 `Math.abs(margin) > 0.5`，同時清正 margin（narrowing / offset）與負 margin（full-bleed overhang）**——theverge.com（Duet design system）把 in-body 圖片包在 `div.duet--article--block-placement`（`margin-left: -100px` 讓圖片向版心左外延伸成 full-bleed），reader 單欄 card 下這個負 margin 殘留會把圖片推到內文左側 100px、未與文字欄對齊（Jimmy 2026-06-19 回報「圖片沒置中而破圖」）。舊版 `ml > 0.5` 只清正 margin、且 early-return guard 把 `ml <= 0.5` 當「無事可做」整支跳過 → 漏掉負 margin；改 abs 後負 margin 一併歸零、圖片 wrapper 退回 column 起點對齊文字。媒體置中（img/picture/video/figure `margin: auto`）另由既有規則處理、不在遍歷 TARGET_SEL 內、互不干擾。既有 `width: auto` / `max-width: 100%` 只擋「超寬」、擋不掉「被內距夾窄」或「被負 margin 外移」，此檢查補反向兜底。捲動與翻頁（multicol）模式同根因同修法——走「水平內距和 = 0」不量 card 寬（multicol clientWidth 含全部欄量不準），兩模式通用。`restore()` 對稱還原原 inline 值。Forcing function：`test/regression/content-width-self-check.spec.js`（內文 wrapper + 標題列 wrapper padding 清零 / blockquote + ul 縮排保留 / restore 還原）+ `test/regression/styler-neg-margin-image-tiny-caption.spec.js`（負 margin full-bleed 圖清零 + restore）+ `tools/debug-harness.js` 的 **WIDTH AUDIT**（捲動模式量內文 p content-box 寬 vs card 版心寬，窄 > 2px 印 ⚠️；`--paged` 跳過）。

### 圖說（figcaption）可讀性（v0.8.123）

`figcaption` 自 v0.7.120 起排除在 `BODY_TEXT_SEL` 外、保留原站 caption typography（caption 比 body 小一階是合理階層差異化）。但部分站把 caption 設得過小 / 過淡，淺色模式難讀（theverge.com 實測 `11px` / `#4a4a4a`，Jimmy 2026-06-19 回報）。兩道補強（皆結構通則、非站點特判）：

1. **字級下限（`captionFsSnap`，全 theme）**：`apply()` runtime 量每個 figcaption computed font-size，小於 `floor = max(14px, round(body × 0.78))` 才撐到 floor（已 >= floor 的不動、不縮大字、不抹平正常階層）。floor 隨使用者字級縮放（`opts.fontSize` 為 0 = Auto 時用 18 估計）、`0.78` 係數保留 caption < body 階層。inline `!important` 蓋站點 caption class rule；`restore()` 對稱還原。
2. **顏色加深（light theme 限定）**：dark / sepia 下 figcaption 已由 `* { color: theme.text }` 接管（v0.8.45）；light theme（`!theme.text`）注入 `figcaption, figcaption * { color: #333333 !important }`（白底 12.6:1，比原站 `#4a4a4a` 更深、又仍比內文近黑淺一階保留階層）。`figcaption *` 一併覆寫——photo credit 常包在 figcaption 內 `<em>` / `<span>`、inline 子元素自身有色規則需顯式蓋。規則放進 `(theme, contentWidth)` 記憶化的 base 骨架、cache-safe。

Forcing function：`test/regression/styler-neg-margin-image-tiny-caption.spec.js`（11px→14px floor / body 28→22 縮放 / restore / light 注入 #333 / dark 不注入）。

### 文字欄塌成單欄（de-column flex/grid text columns，v0.8.66）

`apply()` runtime 自我檢查：原站把主文段落排進 **flex-row** 或 **多欄 grid** 容器做雜誌式雙欄 layout 時（christies.com/en/stories `div.sc-kLokBR` 是 `display:flex`，文字欄被擠成 292px 半欄、另半欄留給側欄圖說、本文沒側欄時純留白，Jimmy 2026-06-14 回報「內文寬度不正確」），把分欄容器塌成 `display:block`、讓段落退回正常 block flow 撐滿版心。既有 `galleryFlex`（v0.7.93）只塌「含 `picture` / `img` / `figure` 直接子」的 flex/grid（並列圖），純文字欄分欄是另一條 path——此 pass 補上。

結構訊號（非站點特判）：掃所有 **>= 80 字的長 `<p>`**，沿祖先鏈往上找 `display:flex` 且 `flex-direction:row(-reverse)`、或 `display:grid` 且 `grid-template-columns` >= 2 column track 的容器；若該長段落**實際渲染寬 < 容器內容寬 70%**（確認真的在分欄、非單一全寬子），把容器塌成 `display:block`（inline `!important`）。中間 wrapper 由既有 `[data-jread-active] div { width:auto }` 規則接手撐滿。防誤殺：`flex-direction:column`（本來就垂直堆疊）、橫向 UI 列（button / 分享列無長段落）、單一全寬子（比例接近 1）皆不命中；player 容器（`data-jread-player`）排除。每塌一層後重量段落寬，內層 splitter 塌掉後外層比例回到 ~1 不會被誤塌。`restore()` 還原原 inline `display`。Forcing function：`test/regression/flex-text-column-decollapse.spec.js`（flex-row / grid 正例塌成 block + 三類防誤殺 guard + restore 還原）；真實 Chromium flex 解析寬度走 `tools/debug-harness.js` 截圖自驗。

### 寬語意內容水平捲（wide table / pre overflow scroll，v0.8.101）

`apply()` runtime 自我檢查：`table` / `pre` 是「內容無法 wrap」的語意載體——表格資料、preformatted code、LaTeXML 把展示公式輸出成的 `<table class="ltx_equation">`（內含不可斷行運算式）等。當其內容的 intrinsic min-width 撐破 card 版心時，既有全後代 `max-width:100%`（line 1314）只能限縮 box 寬、擋不住內容 min-width，元素仍溢出右緣被 reader card 的 `overflow-x:hidden` 切掉（arxiv.org/html 全文頁實證：公式溢出 54–144px、右側 + 式號被截，看不到也捲不到）。此 pass 對溢出者改 `display:block` + `overflow-x:auto` + `max-width:100%`（inline `!important`）讓它在卡內水平捲（標準 responsive-table pattern，使用者捲得到 = 視覺無破版）。

結構訊號（非站點特判，硬規則 3）：掃 `table` / `pre`，只處理「**實際渲染右緣 > card 右緣**（真溢出）+ 非 player（`data-jread-player`）+ **未被既有 `overflow-x:auto|scroll` 祖先（自身在卡內）吸收**（原站已給 code block 內捲就不重複處理、避免雙重 scroll container）」者。能正常 wrap 的窄表格、已內捲的 code block 不受影響。`restore()` 對稱還原原 inline `display` / `overflow-x` / `max-width`。同一份「水平溢出」事實在 harness 端由 `tools/audit-lib.js` 的 `auditOverflow` 把關：被 `overflow-x:auto|scroll`（可捲到）祖先吸收的超出元素豁免不報（rust-book / kubernetes code span 近誤報）、`hidden`/clip 或被 card 本身裁切的（看不到也捲不到）仍報。Forcing function：`test/regression/styler-wide-content-scroll.spec.js`（寬 table/pre 套修法 + 窄 table 不動 + 已吸收不重複 + restore 還原）+ `test/regression/audit-overflow-scroll-clip.spec.js`（audit 豁免層）；真實 Chromium overflow 走 `tools/page-rounds-harness.js` 的 OVERFLOW audit + 截圖自驗。

### 僅在「使用者改過預設值」時才注入的 override

| 欄位 | 預設 | 改過後注入 |
| --- | --- | --- |
| `theme` | `'light'` | dark / sepia / gray → 覆寫文字色 + 頁面/卡片底色 |
| `fontSize` | `18` | 非 18 → 對 `BODY_TEXT_SEL` 注入 `font-size: Npx !important`（p/li/blockquote/td/th/**font**/span 等，含裸 div 段落）。**font 進 selector**（v0.8.83）：老式 table 排版頁主文包在 `<font size="2">`、`size` 呈現屬性把字級重設成固定 px 截斷繼承，不列入則 fontSize 設定對 essay 無效（boss.html 實證） |
| `fontFamily` | `'system-ui'` | 改過 → 注入 font-family |
| `fontWeight` | `400`（中） | **一律注入**（含 400）→ 對 `BODY_TEXT_SEL` 注入 `font-weight: N !important`（細 300 / 中 400 / 粗 600，不含 h1-h6）。連 400 也注入是因原站若對內文設非 400 字重時，中（400） 不注入會退回原站值與細撞色 |
| `lineHeight` | `1.7` | 非 1.7 → 注入 line-height |
| `contentWidth` | `720` | 永遠注入（卡片骨架不可缺） |

這樣「開啟閱讀模式但不改設定」＝ 原站字體 / 字級 / 行高 / 排版 + 讀者卡片容器。最貼近原站視覺。

### 對比守門（contrast guard，v0.7.225，light theme only）

styler 刻意保留 `pre` / `table` 的原站文字色（syntax highlight / cell 色彩），但這些色是配合「原站 effective 背景」設計的——站點走 `prefers-color-scheme: dark` 時 token 色為淺色，reader card 白底會讓對比掉到 1.x:1（tymscar 實測 pre bg = 半透明白疊深 body，白卡下 1.07:1）。`apply()` 內建兩段式 runtime 檢查：

1. **Phase 1（CSS 注入前）**：量每個 `pre` / `table` 的原始 effective bg（ancestor 爬升 + alpha 合成）+ 各文字載體（direct textNode 元素）的色與字數
2. **Phase 2（CSS 全生效後）**：以 card bg 為基底重算新 effective bg + **重量注入後的實際文字色**（繼承類元素如 td 已走新 cascade，不可沿用 phase 1 舊色——誤判會把 table 修壞）。兩種修法形狀：
   - **整容器 bg 還原**：低對比文字（< 3:1）字數占比 >= 40% 且「注入後文字色 + 原始 bg」可讀 → 原始 bg 以 inline `!important` 還給容器（保留 syntax highlight 設計）
   - **per-carrier 色覆寫**：少數載體（如 th 自帶為深底設計的淺色）對最終 bg 仍 < 3:1 且原設計可讀 → 個別 inline 覆寫文字色（依最終 bg 亮度選深字 / 淺字）

保守邊界：原站本來就低對比的不動（不是 jread 造成）；dark / sepia theme 整段跳過、改走下方 v0.8.45 兜底層。`restore()` 以通用 `{el, prop, prev, prevP}` snapshot 對稱還原。不驗圖片 / iframe 內部。

### dark / sepia 前景背景成對覆寫 + contrast 兜底層（v0.8.45）

2026-06-11 page rounds 第四輪 dark E1 12 站整治，兩個互補根因都在 dark theme：

- **A 群（暗底暗字）**：dark 字色覆寫曾排除 figcaption（v0.7.196 沿用 light 的「背景文字成對保留」）——但 dark 下背景也會被中和，排除只留下「原站白底設計的深灰圖說疊暗卡」ratio 1.7-2.7。v0.8.45 起 dark / sepia 改**成對覆寫**：字色覆寫不再排除 figcaption。
- **B 群（亮底亮字）**：BG_PRESERVE 保留的元素自帶亮底（Wikipedia figure thumb / mbox table、sspai 表格 TH）+ 字被覆寫成亮灰 → ratio 1.3-1.5。背景中和規則由 blockquote / pre / code 擴到 **figure / figcaption / summary / table 系**（群組常數生成防 drift；mark / kbd 保留語意高亮）。
- **Phase 3 兜底層**（apply() 內、dark / sepia only）：CSS cascade 有結構性輸局——站點高 specificity `!important` rule（twz (0,3,0) 實證）、@layer 反轉、CSS-in-JS——stylesheet 軍備競賽無解。掃 card 內直接文字載體、對 effective bg 對比 < 3:1 才 inline `!important` 修字色（候選色挑對比較高者；連結用 link 色變體維持雙通道）。effective bg 按「中和後目標狀態」算、不照當下 computed（SPA hydration 期 cascade 會翻轉，sspai TH instrument 實證——照當下值會修出「亮底深字」之後變「暗底深字」）。可讀的原站色（表格漲跌紅綠、syntax token）一律不動；修後仍 < 3:1 不動（同 light guard 保守邊界）。restore 走 contrastBgSnap 既有通道。

配套：`tools/debug-harness.js` 的 **CONTRAST AUDIT**（initial + delayed 兩次）掃 reader card 內 visible 文字 vs effective bg 的 WCAG 對比、< 3:1 印 ⚠️，是修 styler / theme 類改動的驗收 forcing function；`--scheme dark` flag 模擬深色模式使用者（此類 bug 只在 dark scheme 重現）。

另一條同輪通則：video player 標記（`PLAYER_ATTR`）的 container 若含 >= 100 chars 的 p / li = layout wrapper 而非 player 結構，縮回 video 自身——否則 wrapper 內所有元素被豁免色彩保護（tymscar 實測 246/267 元素被誤標、link 留站點綠色在白卡上 1.37:1）。

---

## 設定欄位（預設值）

使用者三項必要設定（來自需求）：**頁面寬度、日夜間模式、字型大小**。其餘欄位先保留後端預設，未來 Options UI 決定是否曝露給使用者。

v0.7.140 起 popup 多了「字型」select（v0.8.145 起 label 改「中文字型」，明示這顆控中文 / base 字型、與 v0.8.144 新增的「英文字型」select 區分），提供 4 個內建 stack：

| popup 選項 | storage `fontFamily` 字面值 |
| --- | --- |
| 系統預設 | `system-ui`（== styler DEFAULTS.fontFamily，**不注入 override**，保留原站字體） |
| 襯線 | `Georgia, "Times New Roman", "Noto Serif TC", "Songti TC", "Songti SC", "Hiragino Mincho ProN", serif`（v0.8.25：西文襯線 Georgia/Times 排在 CJK 字體之前，CSS 逐字 fallback 下英文/數字命中 Georgia、中文穿到內嵌 Noto Serif TC——讓英文 fall back 到西文襯線而非吃 Noto Serif TC 拉丁字形。v0.7.221：CJK 襯線字體必須明寫——iOS WebKit 對清單中段泛型 serif 只解析拉丁，CJK 會穿透到 styler sans 後綴的 PingFang TC；macOS 命中 Songti、iOS 命中 Hiragino Mincho。SW onInstalled 有歷代舊值精準遷移） |
| 無襯線 | `-apple-system, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Helvetica Neue", sans-serif`（v0.7.254：系統 CJK 字型優先、`"Noto Sans TC"` 降到末段——部分站點用壞掉的 `@font-face` 劫持「Noto Sans TC」名字、weight→檔案對映錯誤（shoppingdesign 把 weight 400 與 300 都指到 `Light.woff2`），舊 stack 領頭點名就吃到壞 webfont → 字重細/中渲染相同。CJK 逐字 fallback 先命中本機完整字重系統字型（PingFang/JhengHei）即繞過劫持。SW onInstalled 有舊值精準遷移） |
| 等寬 | `ui-monospace, Menlo, Consolas, monospace` |

option value 寫死在 `popup.html`、與 `popup.js` 的 `FONT_STACKS` 常數逐字一致（forcing function spec 校對）。styler 注入時會在使用者 stack 末尾再串自己的 fallback chain，即使具名字型都沒裝也能 fall back 到對應的 generic family。

**英文（拉丁）fallback 字型自訂（v0.8.144，`latinSerif` / `latinSans`）**：「字型」選**襯線 / 無襯線**時，下方多一個「英文字型」select，可單獨指定英文 / 數字用哪個拉丁字型（中文仍由該 stack 的 CJK 字體渲染）。襯線 / 無襯線**各自記一個**選擇（`latinSerif` / `latinSans`，v0.8.158 預設 `'sourceserif'` / `'sourcesans'`——選襯線 / 無襯線時英文 / 數字直接走自帶 Source Serif / Source Sans woff2、iOS 也生效）；系統預設（不覆寫）與等寬沒有這個維度，select 整 row 隱藏（`render()` 依 `fontFamily` 控制顯隱）。清單（鍵集中於 `settings-defaults.js` 的 `LATIN_FONTS`）：

- 自動（沿用 base stack 內建西文字型）
- **襯線群**：Georgia / Palatino（系統字，只點名；v0.8.148 移除 Times New Roman、v0.8.158 移除 Charter）／ **Source Serif / Piazzolla**（v0.8.146 自帶 woff2，見下；v0.8.158 移除 Literata）
- **無襯線群**：Helvetica Neue / Arial / Verdana（系統字）／ **Public Sans / Source Sans**（v0.8.146 自帶 woff2）
- 等寬群（無襯線 base 不顯示，襯線 base 才出現於 select）：SF Mono / Consolas

**內嵌拉丁可變字型（v0.8.146）**：上列 4 支（Source Serif / Piazzolla 襯線、Public Sans / Source Sans 無襯線；v0.8.158 移除 Literata）非系統字、iOS Safari 網頁路徑沒有，只點名載不到——比照 Noto Serif TC 自帶 Latin-subset woff2（各 26–51KB，皆 OFL，授權見 `jread/assets/fonts/LICENSE.txt`），styler 以 `chrome.runtime.getURL` 注入 `@font-face`。4 支都是**真·可變字型**（`fvar` wght 軸），單一 `@font-face` 用 weight range 即真實多字重（細 300 / 中 400 / 粗 600 各有差別），**不踩 Noto 三靜態字面那個「range 涵蓋整段 → 三段塌成同一字面」的坑**（v0.7.257）。`@font-face` 只注入**被選到**那一支（`latinFontFaceFor` 掃 `opts.fontFamily` 是否含該 family）+ `font-display: swap` lazy-load——選 Georgia / 系統字時零下載。顯示名稱不帶 VF / 字重後綴。forcing function `test/regression/bundled-latin-fonts.spec.js`。

組合方式：`fontFamily` **仍存 base stack 整串字面值不變**（既有儲存契約不動、不需遷移既有使用者），`composeFontStack(settings)` 在讀取邊界（`main.js` `getSettings`）把選定拉丁字型**前接**到 base stack 前面——CSS 逐字 fallback 下英文先命中前接字型、中文穿到後段 CJK 字體。前接值只放**具名**字型（不含泛型 serif / sans-serif）：泛型放中段會被 iOS WebKit 當「只解析拉丁」攔截、CJK 反 fallback 到後綴 sans（同襯線 stack 的鐵律）；具名字型缺字時自然往後落到 base stack 原有的 Georgia / -apple-system / 泛型，安全。`'auto'` = 不前接。styler 下游維持「只認 `fontFamily` 整串字面值」不變。forcing function `test/regression/latin-font-fallback.spec.js`。

**v0.8.147 兩項 UI 改進**：① **所見即所得預覽**——`applyLatinPreview()` 把「英文字型」select 的顯示值用**選定字型本身**渲染（`select.style.fontFamily = LATIN_FONTS[value]`，單一資料源同 `composeFontStack`）。iOS Safari 對 `<select>` 自身 font-family 有效（顯示值換字型）；但展開後的原生滾輪清單 iOS 仍以系統字渲染、無法逐項預覽（平台限制，桌機 Chrome 下拉清單才逐項）。popup 為獨立頁面、`popup.html` 自帶這 4 支內嵌字型的 `@font-face`（relative URL `../assets/fonts/*.woff2`，`font-display: swap` lazy-load，與內文 styler 那份不共用）。② **row 永遠顯示不跳版**——中文字型 = 系統預設 / 等寬（或外部自訂 stack）時，英文無 base stack 可前接、不可自訂，select 改為 `disabled` 並顯示「跟隨中文字型」狀態（`__follow` sentinel option，hidden、文字隨系統預設 / 等寬動態切換），取代 v0.8.144 原本的整 row 隱藏。

**內嵌襯線 CJK 字型（v0.7.253 內嵌 / v0.7.257 三字重）**：iOS Safari「網頁路徑」的預設襯線字型缺「夠」「查」等常用字的字形（iOS 26.5 模擬器實證），且 Safari 網頁不認 CSS 指定的系統字型名（`"Songti TC"` 等一律 resolve 到那套有缺漏的預設 serif）——v0.7.221 的字型名 stack 只把「整段全黑體」改善到「多數字襯線、少數字仍缺」。根治：styler 打包完整的 **Noto Serif TC（全 TC 集，6,606 字）**，用 `@font-face`（family 名 `"Noto Serif TC"` 對齊 stack 第一順位）經 `chrome.runtime.getURL` 載入；CJK 字元改由 JRead 自帶完整字型渲染，跨平台（尤其 iOS）零缺字。

**v0.7.257 三字重**：v0.7.253 只內嵌單一 Regular 字面 + `@font-face` 宣告涵蓋整段 100~900 weight 範圍——等於告訴瀏覽器「這一個字面已涵蓋整段 weight」，於是使用者選的細（300）/中（400）/粗（600） 全對映到同一字面、且關閉 faux-bold 合成，**襯線字重三段渲染完全相同（字重選擇沒效果）**；無襯線走系統字（PingFang/JhengHei）有真實多字重故正常。字重無法無中生有（瀏覽器只能合成較粗、不能變細），故改為**三個真實字重各一個靜態字面**：`noto-serif-tc-light.woff2`（300）/ `noto-serif-tc-regular.woff2`（400）/ `noto-serif-tc-semibold.woff2`（600），同一份 6,606 字覆蓋、由 Noto Serif TC 可變字型 pin 出，各約 1.3MB（合計約 3.9MB）。三個 `@font-face` 同 family 名、各自單值 `font-weight`，瀏覽器依 `BODY_TEXT_SEL` 注入的 `font-weight` 精準命中對應字面。

@font-face 只在 `overrides.fontFamily` 為 true（使用者選了自訂字型）時注入、woff2 lazy-load——預設無襯線使用者零成本、不下載。`web_accessible_resources` 的 `assets/*` 涵蓋字型路徑。forcing function `test/regression/embed-serif-font.spec.js`。iOS 內建閱讀模式之所以不缺字，是因為它是 Apple 原生排版器用完整系統 Songti，網頁拿不到那套——故必須自帶。


| 欄位 | 型別 | 預設值 | 儲存位置 | 使用者可調？ |
| --- | --- | --- | --- | --- |
| `theme` | `'light' \| 'dark' \| 'sepia' \| 'gray'` | `'light'` | `storage.sync` | ✅（日/夜間切換） |
| `fontSize` | `number`（px） | `18` | `storage.sync` | ✅ |
| `titleFontSize` | `number`（px） | `0` | `storage.sync` | ✅（popup「標題字級」stepper，v0.8.158 從 options 移來；自動鈕 = 0 = Auto 保留原站 h1 大小，stepper [16, 96] step 2、非 0 覆寫 h1 font-size，styler clamp [8, 200]，v0.7.175） |
| `contentWidth` | `number`（px） | `720` | `storage.sync` | ✅（頁面寬度）—— popup stepper [480, 1600] step 40（**v0.7.237 上限 1200 → 1600**：寬視窗 / iPad desktop-class layout viewport 可達 1120pt+，舊上限填不滿螢幕、主觀變「調了沒變寬」；styler clamp [300, 2000] 為最終防線；v0.8.158 options input 移除、改 popup 唯一入口）。注意手機 viewport < contentWidth 時 card 受 viewport clamp，調大無感（物理限制，非 bug；iPad simulator instrument 實證 innerWidth=1120 時 card rect.width 精確 = 設定值） |
| `fontFamily` | `string` | `'system-ui'` | `storage.sync` | ✅（popup「中文字型」select：系統預設/襯線/無襯線/等寬，v0.7.140；label v0.8.145 由「字型」改「中文字型」） |
| `latinSerif` | `string`（`LATIN_FONTS` key） | `'sourceserif'` | `storage.sync` | ✅（popup「英文字型」select，**僅字型 = 襯線時顯示**；指定襯線下英文/數字的拉丁字型，v0.8.158 預設 `'sourceserif'`（內嵌 Source Serif woff2），v0.8.144） |
| `latinSans` | `string`（`LATIN_FONTS` key） | `'sourcesans'` | `storage.sync` | ✅（popup「英文字型」select，**僅字型 = 無襯線時顯示**；指定無襯線下英文/數字的拉丁字型，v0.8.158 預設 `'sourcesans'`（內嵌 Source Sans woff2），v0.8.144） |
| `fontWeight` | `300 \| 400 \| 600` | `400`（中） | `storage.sync` | ✅（popup「字重」segmented 細/中/粗，v0.7.254；v0.8.158 options select 移除、改 popup 唯一入口）—— 真正的 `font-weight`、**全平台一致生效**（取代 v0.7.157 `boldText` 的 macOS-only `-webkit-font-smoothing`）。只接受 300/400/600 三值（其餘回退 400）。**三段一律注入**（含 400）：原站若對內文設非 400 字重（如 shoppingdesign `.htmlview p { font-weight: 300 }`），中（400） 不注入會退回原站 300 與細（300） 撞成同色——故 400 也強制 `!important` 蓋掉。粗用 **600 Semibold** 而非 700：700 視覺太重，600 比中明顯重又不過粗；**不用 500**（Windows 微軟正黑無 500 face 會退回 400 與中撞色）。只套 `BODY_TEXT_SEL`（內文載體 p/li/blockquote/td/span 等，含 CMS「div 當段落」站的裸 div——`data-jread-text-div` runtime 標記，v0.8.49，**不含 h1-h6**——標題字重交給原站/UA bold 維持章節階層；`strong`/`b` 等有自身明確 weight 的元素也不受影響）。storage.onChanged 即時 reapply（main.js relevantKeys 含 `fontWeight`）。**舊 `boldText` 已退役**：SW `onInstalled` 一次性遷移 `boldText:true → fontWeight 600`、其餘 → 400，並刪除 `boldText` 殘留 key |
| `lineHeight` | `number` | `1.7` | `storage.sync` | ✅（popup「行距」stepper [1.0, 3.0] / step 0.1 / Auto sentinel = 0 不注入 line-height 保留原站，v0.7.162） |
| `paragraphSpacing` | `number` | `1.0` | `storage.sync` | ✅（popup「段落間距」stepper [0, 3.0]em / step 0.25 / Auto sentinel = -1 不注入 p/ul/ol/blockquote margin-bottom 規則保留原站 typography，v0.7.162） |
| `blockPageShortcuts` | `boolean` | `true` | `storage.sync` | ✅（options 「攔截原站快速鍵」） |
| `editModeEnabled` | `boolean` | `true` | `storage.sync` | ✅（options 「編輯模式」，v0.8.109）—— `false` 時 popup 不顯示「編輯模式：移除雜訊」按鈕（`refreshPopupForActiveTab` 的 editBtn 顯隱條件加 `await isEditModeEnabled()`） |
| `spaceScrollRatio` | `number`（%） | `50` | `storage.sync` | ✅（options 「Space 顯示門檻」number input [0, 90] / step 5，v0.7.215 固定翻頁 → v0.7.216 改段落焦點模型）—— reader mode 下按 `Space` 把左側 4px 主題色指示條（`#__jread-focus-bar`，`content/space-scroll.js` 建立/定位、CSS rule 在 styler stylesheet 與 `#__jread-progress` 共用 `theme.progressBar` 色）移到下一個段落（`Shift+Space` 回上一段；指示條左錨點固定在 articleEl 左緣 - 14px、水平位置恆定不跟個別 block 漂移）。**此值 = 焦點段落允許的顯示門檻**（top 不可低於 viewport × ratio%）：門檻內只移指示條不卷動；低於門檻 → **rAF 平滑動畫（450ms easeInOutCubic）+ setTimeout 落點兜底**（v0.8.85）「卷到落點」——讓段落 top 落到 viewport × `REST_FRACTION`(0.1) 處，卷距隨段落位置而定（非固定距離，保證卷完必在門檻內、指示條永不停留頁面底部）。反向：段落 top 高過 viewport 上緣才往上卷、落同一落點。**卷動可靠性（v0.8.85 落點兜底）**：純 rAF 動畫在分頁非 OS 焦點視窗 / 被瀏覽器節流時 rAF callback 不發、動畫到不了落點、頁面幾乎不卷 → 焦點段落停 viewport 外、下次 advance 把它判成 offscreen 往回 re-anchor 到可視區第一段 → 焦點指示條在同一屏內往回循環跳（Jimmy 2026-06-16 實機 paulgraham.com/boss.html 回報）。實證（隱藏分頁直接量）：rAF afterRaf=0、原生 `scrollTo({behavior:'smooth'})` afterNative=0（背景 smooth 被延遲）、**同步 `scrollTop=X` afterSync=900**——只有同步寫入在任何情境即時生效。`startSpaceScrollAnim` 走 rAF 平滑（前景拿到完整動畫）+ `setTimeout(450+80ms)` 兜底：rAF 沒把 scrollTop 帶到落點時同步補到位 + 清 `animId`（讓被 handler guard 吞掉的後續 Space 能繼續）；rAF 正常跑完時 step 內順手清掉兜底計時器；`cancelSpaceScrollAnim`（wheel/touchmove/uninstall）一併清兜底計時器（手動卷動後不被兜底覆寫回舊落點）。（v0.8.84 曾全改同步瞬移、Jimmy 要平滑故 v0.8.85 改回平滑 + 兜底。）**0 = 停用 sentinel**（不攔截、保留瀏覽器原生跳卷）。**v0.8.9 單頁文章不顯示指示條**（Jimmy 回報 X 短推文殘留指示條）：整篇在 viewport 內裝得下（`scrollHeight <= innerHeight + 2`，+2px 容差吸收 sub-pixel rounding）= 不需捲動時 `setFocus` 移除 bar 不顯示——指示條的作用是追蹤捲動閱讀位置，沒有捲動可追蹤即為視覺雜訊；`onResize` 改走 `setFocus` 重評，視窗高度 / 字級改變導致單頁↔多頁互換時指示條即時出現/消失。段落候選 = articleEl 內 `p / h1-h6 / li / blockquote / pre / figure / table`（**清單以 li 為焦點單位、不收 ul/ol 容器**——newsletter 類 ol 每個 li 是完整段落，收容器會讓 Space 一次跳過整列；排除 data-jread-hidden 子樹、巢狀取最外層、零高度跳過）+ **裸文字 block 單位**（v0.8.11，forum.gamer.com.tw 巴哈論壇等 BBS / 老站把每段文字放裸 `div`/`font`/`section`/`td`、不用 `<p>`，與圖交錯——上述 BLOCK_SEL 全漏收會讓焦點只在圖間跳、跳過文字）：block-level 且「直接含 >= `MIN_TEXT_BLOCK`(4) 字文字節點」的元素亦收為焦點單位，三道 guard 確保只收 leaf-most 文字承載層（不含 BLOCK_SEL 後代 / 不含其他文字候選 / 不巢狀於已收 block） + **br 分段虛擬單位**（v0.8.83，paulgraham.com/boss.html：老式 table 排版內容頁整篇主文是「一個 `<p>`/`<font>` 內用 `<br><br>` 分段」、無逐段 `<p>`，上述兩條都只收到單一 block → 焦點條把全文視為一段）：collectBlocks 出口（`expandBrParagraphs`）把「br 容器」（**直接 `<br>` 子數** >= `BR_PARA_MIN_BR`(3)，用直接子計數避免後代 br 冒泡誤判祖先）切成「每段一虛擬焦點單位」——以 `Range`（`setStartBefore`/`setEndAfter`）量段落 rect、**不動 DOM**（不需 restore / 不影響 styler / cleaner / Readwise export）；虛擬單位以段落起始 text node 為 key 快取（`brUnitCache` WeakMap）維持跨 collectBlocks 呼叫的穩定參照（`advance` 的 `indexOf(focusedBlock)` 才找得到、焦點連續推進）；`splitBrRuns` 以 `<br>` 與內嵌 BLOCK_SEL（blockquote / figure）為段落邊界（內嵌 block 各自仍是獨立焦點單位、不被吃進段落）、inline 子（a/i/font…）下探收文字；只取最外層 br 容器、丟掉包住容器的外層 block（boss 的外層 `<p>` 含 `<font>`），最終以 `getBoundingClientRect().top` 排序（虛擬單位無 `compareDocumentPosition`）。容器可為 inline `<font>`（todo.html 的 `<td><font>…<br>…</font>`、被裸文字 block 的 display:block 濾掉），故直接掃 DOM 找 br 容器 + **照片以每張為單位**：多圖容器（含 >= 2 張高度 >= 40px 內容圖、扣除 figcaption 後正文 < 100 字 = 圖庫）讓位給個別 img/video；單圖 figure 整塊當單位（含圖說）；文字段落內插圖不拆；未被任何已收單位覆蓋的內容圖一律獨立成單位（保證不漏圖）、合併後依文件順序排序；手動卷遠（焦點段落離開 viewport）或焦點段落被 SPA 移除後按 Space 重新錨定到可視區第一段。**滑鼠點擊主文內任一段 → 指示條跳到該段**（click capture listener、純觀察不 preventDefault，連結點擊 / 文字選取照常；li 內文字點擊歸最外層 li），之後 Space 從該段接續。放行條件同 keyguard（IME / INPUT / TEXTAREA / SELECT / BUTTON / contenteditable focus），alt / ctrl / meta 修飾鍵不攔；listener 註冊順序必須在 keyguard 之前（keyguard 對非 ESC 鍵 stopImmediatePropagation，main.js wrapper 維護 invariant）。cinema / borderless 模式不裝（YouTube space = play/pause）。storage.onChanged 即時生效。**與 styler v0.7.91 onSpaceScroll 的關係**：模組啟用時 styler 的 SPACE = scrollBy 92% fallback 讓位（onSpaceScroll 開頭檢查 `NS.spaceScroll.isInstalled()`）；ratio = 0 時 fallback 自動回歸——「0 = 停用」實際語意是「回到 v0.7.91 整頁卷動」而非純原生 |
| `pagedMode` | `boolean` | `false` | `storage.sync` | ✅（popup「翻頁模式」checkbox，v0.7.227）——電子書式水平翻頁，詳見核心功能表「翻頁模式」row。嚴格 `=== true` 才啟用（storage 損壞 / 外部寫入非 boolean 視為關）。storage.onChanged 即時切換（走 scheduleReapply：styler 重建 stylesheet + 模組 install/uninstall，閱讀模式開啟中也能直接生效；字級/版心調整時模組重算頁數並按比例回原位）。垂直模式（預設）零行為差異——翻頁 CSS 區塊只在 true 時注入 |
| `showPageNumber` | `boolean` | `true` | `storage.sync` | ✅（popup「頁碼指示」checkbox，v0.7.237，僅翻頁模式開啟時顯示該 row）——翻頁模式底部「目前頁 / 總頁數」指示器開關。預設 true（嚮後相容：原本一律顯示）；`!== false` 視為顯示。storage.onChanged 走獨立輕量路徑 `NS.pagedMode.setShowIndicator`（純顯示層、直接增/移除指示器 DOM，不走 styler full reapply，避免捲動→翻頁閃爍）。翻頁模式未啟動時無感 |
| `pangu` | `boolean` | `true` | `storage.sync` | ✅（options 「中英文間自動補空白 + 中文標點全形化」，v0.7.153 / v0.7.158）—— reader mode 啟動時掃 articleEl 所有 text node：(1) CJK ↔ 英數字 / % / ° 邊界補空白；(2) v0.7.158 新增 CJK 邊界的半形標點 `, . : ; ? !` 轉成 `，。：；？！`，半形括號 `( )` 兩側緊鄰 CJK 時轉 `（）`，引號不在此規則；中文 prose text node 內 ASCII↔ASCII 邊界的半形逗號也轉全形，但**數字千分位逗號**（兩側皆數字，如 `3,610` / `3,610,000`）保半形（v0.7.213，數字格式非標點）；跳過 `<code>` / `<a>` / `<input>` / contenteditable 等 |
| `autoEnableDomains` | `string[]` | `[]` | `storage.sync` | ✅（v0.7.155 options 「自動啟動網域」textarea + popup 「此網域自動啟動」checkbox）—— 命中網域時 content script document_idle 自動 silent enterReaderMode；matching rule：`hostname === pattern OR hostname.endsWith('.' + pattern)`（`abc.com` 涵蓋 `www.abc.com` / 子網域；`www.abc.com` 只匹配自身，不含 `123.abc.com`） |
| `customShortcuts` | `object` | 三 key 全 `null` | `storage.sync` | ✅（v0.7.218 options 「快速鍵」recorder）—— key 與 manifest commands 同字彙（`toggle-reader-mode` / `send-to-readwise` / `toggle-youtube-borderless`）；value = `{ code, alt, shift, ctrl, meta }`（`e.code` 實體鍵位 + modifier booleans）或 `null`（未自訂）。比對在 `content/custom-shortcuts.js` keydown capture listener；v0.7.228 起 toggle 類指令命中後直接走 content 端 `NS.dispatchLocalCommand`（本地 dispatch、SW 死活無關——iOS Safari SW 被回收後不再喚醒），send-to-readwise（API 呼叫住 SW）仍送 `CUSTOM_COMMAND` 給 SW。動機：Safari（含 iOS / iPadOS 外接鍵盤）沒有瀏覽器層改鍵入口，options recorder 是唯一通道。validate 規則：必含 ⌥ 或 ⌃、拒絕 ⌘ 組合（content script 搶不過瀏覽器/系統）、拒絕 ESC（保留退出）、拒絕與內建預設鍵相同（browser 層停不掉、雙觸發 = toggle 兩次）、拒絕與其他指令生效鍵衝突。**v0.7.250 Safari ⌃ Control 強制**：`validate(s, { requireCtrl })`——Safari（含 macOS / iPadOS / iOS）把 **⌥ Option 與 ⌘ Command 組合路由到系統鍵盤指令層、完全不以 keydown 傳給網頁**（content script 永遠收不到，iPad 真機 probe 實證；只有 ⌃ Control 與純鍵 / ⇧ 會傳到頁面），故 Safari runtime 的自訂鍵必含 ⌃，⌥-only / ⌘-only 在錄製時擋下。runtime 偵測依 extension URL 前綴（`chrome-extension://` → Chrome、`moz-extension://` → Firefox、其餘 → Safari），options 加 `body.runtime-*` class、傳 `requireCtrl: isSafariRuntime`（不傳 opts 向後相容、⌥ 仍合法）；說明文字兩版（桌面「需含 ⌥ 或 ⌃」／ Safari「需用 ⌃ Control」）純 CSS 依 body class 切換；錄製被拒時 recorder 紅框 + 抖動（`.invalid`）+ ⚠ amber hint 框。已知限制：位址列 focus / content script 沒注入的頁面自訂鍵無效（manifest 預設鍵不受此限，作為 fallback） |
| `positionMemoryDays` | `number`（天） | `3` | `storage.sync` | ✅（options 「閱讀位置記憶」number input [0, 7] step 1，v0.8.40）—— 閱讀位置記憶效期。**0 = 停用 sentinel**、上限 7 天（`position-memory.js clampDays` 消毒：缺值 / null / 非數字回預設 3——`Number(null) === 0` 不可誤判成停用；超界 clamp）。storage.onChanged 即時生效（改 0 停止當前追蹤；0 → 正值下次進入閱讀模式生效）。詳見「閱讀位置記憶（v0.8.40）」章節 |
| `lastDetectedForUrl` | `object` | `{}` | `storage.local`（快取） | ❌（內部用） |
| `readingPositions` | `object` | `{}` | `storage.local`（快取） | ❌（內部用，v0.8.40）—— 閱讀位置記憶的 entry map（`{ urlKey: { ts, mode, page/pages 或 ratio/blockIndex/blockText } }`），寫入時自動淘汰過期 + 超量（上限 100 筆、舊的先丟） |

---

## 訊息協定（content ↔ background ↔ popup）

詞彙單一資料源：`content/namespace.js` 的 `NS.MSG` 表；三方一致（MSG 表 ↔ content 發送 ↔ SW case）由 `test/regression/message-protocol-consistency.spec.js` 強制（v0.8.37）。

- `popup → content`：`TOGGLE_READER_MODE` / `GET_READER_STATE`（v0.7.33）/ `EXTRACT_READER_HTML`（v0.7.33）/ `TOGGLE_YT_BORDERLESS`（v0.7.134）/ `EDIT_MODE_TOGGLE`（v0.8.108，切換編輯模式；content 端 guard 閱讀模式須 active。`GET_READER_STATE` 回應含 `editModeActive` 供 popup 切「編輯模式 / 完成編輯」按鈕文字）/ `REAPPLY_SETTINGS`（v0.8.148，設定即時重套的 iOS 兜底）
  - **`REAPPLY_SETTINGS`（v0.8.148）**：設定即時重套**主要**走 content script 的 `chrome.storage.onChanged` 廣播（popup 寫 `storage.sync` → content 收到 → `scheduleReapply`），桌機 Chrome 即時生效。但 **iOS Safari popup 開啟時底層頁面被掛起、`storage.onChanged` 事件被丟掉**（不排隊、不補送）→ iPhone 改主題 / 字級閱讀模式不即時生效、要重整。修法：popup 每次 `commitSave` 後額外送 `REAPPLY_SETTINGS` 給當前分頁，content `onMessage` 收到就 `scheduleReapply`（同 `active` / `cinemaActive` / `articleEl` guard）——runtime 訊息在 iOS 仍會送達（`TOGGLE_READER_MODE` 走同路徑、iPhone 可用為證）。`scheduleReapply` 自 `onChanged` 閉包搬到模組層、與訊息 handler 共用（單一資料源）；桌機與 `onChanged` 經 200ms debounce 合併、不雙重重套。forcing function `test/regression/ios-reapply-settings-message.spec.js`
- `content → 翻譯擴充（Shinkansen）`：`jread-reader-mode` DOM CustomEvent（v0.8.149，`detail.active` true/false）
  - **`jread-reader-mode`（v0.8.149）**：Shinkansen 翻譯後進 JRead 閱讀模式，畫面每秒閃一下（像在重排版；未翻譯無）。根因（已知家族，見 `cleaner.js` v0.8.131 註解）：Shinkansen 每秒跑 content guard sweep，把 JRead 重排成閱讀卡片的 `articleEl` 誤判成「譯文被 SPA 覆蓋」而重建子節點 → 每秒 reflow 閃動。閱讀卡片即 `articleEl` 本身、在 guard 管轄區內，無法像 v0.8.131 標題那樣挪到 `articleEl` 外閃避。修法（握手、非站點特判）：JRead 進 / 出閱讀模式時 `window.dispatchEvent(new CustomEvent('jread-reader-mode', { detail: { active } }))`（`signalReaderModeToTranslator`，`finalizeEnter` 送 true、`exitReaderModeImpl` 送 false），Shinkansen content script 收到就暫停 / 恢復其 content guard（跨 extension content script DOM event，同觸發 Shinkansen 翻譯的 `shinkansen-debug-request` 機制、已實證跨 isolated world）。**需搭配 Shinkansen ≥ v1.10.65**（guard 暫停邏輯在 Shinkansen repo）；舊 Shinkansen 無 listener、純 no-op（向後相容）。forcing function `test/regression/shinkansen-guard-pause-handshake.spec.js`
- `popup → background`：（無）。popup / options 的設定讀寫一律直接走 `chrome.storage.sync`、不經 SW。**v0.8.65 起送 Readwise 不再走 SW**——原 `SAVE_TO_READWISE`（v0.7.33）popup → SW 往返已移除，改在 popup（extension 頁、有 `<all_urls>` host_permission）直接 fetch（`popup-core.saveReaderPayload`）。動機：iOS Safari 背景頁（event page、`persistent:false`）被系統掛起得遠比 macOS 積極，popup → SW 非同步往返 + 背景頁 fetch 在 iOS 會 silently 失敗（popup `await` 拿到 `undefined` → 純「送出失敗」無 HTTP 碼；macOS Chrome / Safari 正常）。options「測試 token」的 GET 從 extension 頁直接發、iOS 實測可行，save 改走同一路徑
- `content → background`：
  - `GET_SETTINGS`：**v0.7.235** 起 content 端 `getSettings` 不再走 round-trip——改直讀 `chrome.storage.sync.get(defaults)`（defaults 來自 `content/settings-defaults.js` 單一資料源）；iOS Safari background 訊息會無聲掉包（thread 758346 / 787958），掉包時舊版回 `undefined` → 所有設定 fallback 預設值（pagedMode 永遠 false = 「翻頁模式 iOS 沒功能」根因）。handler 保留，僅作 content 端 storage 失效（context invalidated）時的 fallback
  - `SET_ACTIVE_ICON`：enter/exit 切 action icon 彩色/灰階 + 綠色 badge（`BADGE_ACTIVE_TEXT`）。**v0.8.167 badge 文字平台分流**：iOS / iPadOS Safari 的「管理延伸功能」選單把 badge 文字當字形渲染，'✓'(U+2713) 在該情境無字形 → tofu「◆?」（Jimmy 2026-06-23 iPhone 截圖，閱讀模式啟動後）；故 `IS_IOS_SAFARI`（UA `/iPhone|iPad|iPod/`）為 true 時 `BADGE_ACTIVE_TEXT = ''`（無字形＝無 tofu＝等同無 badge），Chrome / macOS Safari 維持 '✓'。forcing `sw-badge.spec.js`；iOS 真機選單渲染須 TestFlight 驗
  - `RESIZE_OWN_WINDOW`：YouTube 無邊模式視窗高度調整（v0.7.134）
  - `CUSTOM_COMMAND`（v0.7.218，自訂快速鍵命中；payload `{ command }`，SW 白名單驗證後走 `dispatchCommand`。v0.7.228 起僅 send-to-readwise 與 fallback 場景使用——toggle 類指令與 3 指輕點改走 content 端本地 dispatch、不再過 SW）
  - `BG_WAKE_PING`（v0.8.33，Safari 限定喚醒 ping）
  - `JREAD_RELOAD` / `JREAD_DEBUG_SET_THEME`（debug bridge；SW 端 `runIfDevelopmentInstall` gate，僅 unpacked / development 安裝執行）
- `background → content`：`DISPATCH_COMMAND`（v0.7.228，manifest 預設鍵路徑：SW `dispatchCommand` 委派 content 端 `dispatchLocalCommand`（含 cross-mode 重導、單一資料源）；payload `{ command }`，content 端白名單 toggle-reader-mode / toggle-youtube-borderless）/ `SHOW_TOAST`（快速鍵送 Readwise 的結果 toast）

**已退役協定（v0.8.37 移除，不可不加接收端就復活）**：`REPORT_DETECTION_RESULT`（content 7 處發送、全 repo 零接收、每次偵測白喚醒 SW 一次）、`UPDATE_SETTINGS`（SW 有 handler、零發送端——popup / options 都直寫 storage.sync）。
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
- Body：`{ url, html?, title?, image_url?, author?, published_date?, summary? }`（除 `url` 外皆可省，Readwise 會自抓，但帶上 JRead 處理過的欄位才能繞過原站 parser 問題與補強冷門站缺漏 metadata）
- 回傳：`200`（已存在）/ `201`（新建）
- **注意**：Readwise Reader API 沒 `language` 欄位（送了會被忽略），JRead 不抽 / 不送 `language`。
- **`summary`（v0.8.72）**：可選。由 Gemini Flash Lite 端產生的繁中三句摘要（見「Gemini 摘要」章節）。提供時覆蓋 Readwise server 端自動生成的英文摘要；未提供則由 Readwise 自行處理。

### 欄位抽取策略（v0.7.166–167）

- **`html`**：`main.js buildCleanHtml(articleEl, title)` — clone reader card 後依序：(1) 移除 `[data-jread-hidden="1"]` 節點（cleaner 只 inline `display:none` 不刪節點，Readwise parser 不吃本地 CSS 會把雜訊渲染回來）；(2) 移除 jread 注入的 `<style>`；(2.5) FB 段落 div → `<p>`（v0.7.165）；(2.6) **空殼 prune（v0.8.53）**——post-order 走訪移除「無非空白文字、無媒體子孫」的殼元素（cleaner 清掉 li 內 follow / share 按鈕群後留下的空 `<li>` / `<ul>`，在 Readwise 端渲染成一排空 bullet；theverge 頂端 topic chips + 文末 follow widget 實證）。保護邊界：表格結構元素（td/th 等）不 prune、媒體 / void 元素（img / picture / video / audio / iframe / svg / embed / object / canvas / br / hr 等）自身不 prune、`<noscript>`（textContent 為原始 HTML 字串非空）自然保留；(3) 剝掉所有 `data-jread-*` attribute；(3.5) **媒體資源 URL 轉絕對（v0.8.76，`NS.absolutizeResourceUrls(clone, location.href)`）**——`outerHTML` 序列化的是 `img` / `source` / `video` / `audio` / `iframe` 的 `src` / `poster` / `srcset`「屬性原值」（相對路徑），Readwise 伺服器端無原站 base 可解析 → 全部破圖（0xkato.xyz Ghost 站 `/assets/transformer-*.png` 實證，Jimmy 2026-06-15）。序列化前以 `location.href` 為 base 把這些 attribute 轉絕對（`srcset` 只轉 URL 段、保留 `1x`/`2x`/`640w` descriptor；已是絕對 / `data:` / `blob:` URL 經 `new URL` 回原值不變）。結構通則、不綁站點；多數站用絕對 CDN 網址故一直正常、相對路徑站才現形。邏輯抽在 `NS.absolutizeResourceUrls`（單一資料源 + jsdom 可測，`readwise-absolutize-img-url.spec.js` forcing）；(4) **title 去重（v0.8.62）**——折疊標點（`NS.foldTitlePunct`）+ 大小寫後，移除 body 內與 payload `title`（同一輪 `extractReaderTitle()` 結果）全文相等的所有 `h1`-`h6`。動機：Readwise 端用 `title` 欄位另渲染一條主標 header，body 殘留同名 heading 會重複渲染（theatlantic 實測：detector 注入的可見主標 h1 + 站方原生 `ArticleTitle` h1（`display:none` 但未標 `data-jread-hidden`，逃過步驟 1）兩份都進 outerHTML、加 title 欄位共三條）。「主標」這份事實送 Readwise 由 title 欄位單一承擔；比對全文相等（非 includes）避免誤殺合法 section heading、`title` 為空（X / 無標題頁）時不去重。
- **`title`（v0.8.50 / v0.8.74）**：`main.js extractReaderTitle()` → `NS.findCardTitleHeading(NS.state.articleEl)`（選主標 heading 的單一資料源）→ fallback `document.title` + `NS.stripSiteSuffix` 去站名尾綴。`findCardTitleHeading` 取主標規則（tag-agnostic、與 detector `articleIsSelfTitled` 同款）：(1) reader card 內第一個可見 `<h1>` 的 `innerText`；(2) **無 `<h1>` 時 DOM order 走訪，取「第一個內文長段落（`<p>` 文字 > 80 字）之前出現的第一個可見 `<h2>`」**（v0.8.74——Stratechery wp-block post-title 是 `<h2>` 不是 `<h1>`，post-header 主標必在內文之前，藉此避開文中 section `<h2>`）。共同 guard：collapse 空白、跳過 `[data-jread-hidden]` 自身或子孫（站名 logo / cleaner 標記雜訊）、> 300 字視為 detector 誤圈容器不採用。動機：`document.title` 是載入時靜態 metadata，DOM 被翻譯擴充（Shinkansen single 模式原地替換）改寫後不會跟著變——舊版直讀 `document.title` 導致譯後文章送 Readwise 的是原文標題；v0.8.50 只看 `<h1>`，Stratechery 主標是 `<h2>` 時 card 內找不到 h1 → fallback `document.title` 送原文、譯後 h2 主標又留在 body（dedup 比不中）→ Jimmy 2026-06-15 回報重現。card heading 路徑**不做**尾綴切割（站名尾綴是 `document.title` 慣例，標題本文常含合法「 — 」分隔）。X / FB 合成 reader 無 heading，自然走 fallback。
- **`image_url`（v0.7.166）**：`main.js extractHeroImage(articleEl)` — reader card 內第一張通過 200×200 / 200×120 門檻的 visible `img`（不在 `[data-jread-hidden]` 子孫內，srcset 取最大解析度 entry）→ fallback `meta[property="og:image"]` / `og:image:url` / `og:image:secure_url` / `meta[name="twitter:image"]` / `twitter:image:src`。URL 必須 absolute `http(s)`,`data:`/`blob:`/相對路徑略過。**v0.8.124：主圖選擇邏輯抽到 `NS.findLeadingHeroImage(articleEl, base)` 作為單一資料源**——`extractHeroImage` 取其 `.url`、`buildCleanHtml` 的 `NS.markHeroImageForExport` 取同一張圖去重，兩者選同一張杜絕「送的 cover」與「body 去重的圖」drift（硬規則 5）。
- **移除 `display:none` 隱藏子樹（v0.8.127，`buildCleanHtml` 步驟 0，`NS.stripHiddenForExport`）**：站點常用「響應式重複版本」把同塊內容渲染桌機 + 手機兩份、用 media query 顯示其一（The Verge lede 把標題 / dek / byline 各兩份）。reader 內非當前斷點那份是 `display:none`、使用者看不到，但 `outerHTML` 仍序列化 → Readwise 無 CSS 全 render 出來；單語翻譯時 Shinkansen 只譯可見份（中文）、隱藏份留原文（英文）→ Readwise 同段中英重複 + 隱藏 byline 殘留（Jimmy 2026-06-19 cage 真實 DOM probe，實測該頁 12 個 top-level `display:none` 子樹 / 10 含文字）。標記 live（clone 無 layout 量不到 computed display）→ clone 後共用 `data-jread-rw-strip` 移除 → 還原 live；找到 `display:none` 即標整棵不遞迴；排除 `<noscript>`（lazy image 來源）/ script / style。既有清理只剝 `[data-jread-hidden]`（cleaner 設的）、本修法補剝站點 CSS 設的 `display:none`。Forcing：`readwise-hidden-responsive-variant.spec.js` + `readwise-save.spec.js` wiring。
- **Shinkansen 雙語只留中文譯文（v0.8.126，`buildCleanHtml` 步驟 0.5，`NS.collapseShinkansenDual(clone)`）**：Shinkansen dual（雙語對照）模式對每段保留原文 element（標 `data-shinkansen-dual-source`）+ 注入 `<shinkansen-translation>` wrapper（內含 `inner` = 真實 block tag 的譯文），JRead 送 Readwise 的 `outerHTML` 把原文 + 譯文兩份都帶上（theverge.com 翻譯後回報、Jimmy 選「只留中文譯文」）。在 **clone** 上（不動 live reader 雙語顯示）：(1) 每個 `[data-shinkansen-dual-source]` 原文——內含 wrapper（LI/TD/TH append 模式）→ 把自身內容換成 wrapper 的譯文 inner；否則（block/inline sibling 模式）整個移除原文；(2) 剩餘 `<shinkansen-translation>` wrapper → unwrap 成 inner（p/div block）。就地翻譯標題（`data-shinkansen-nodevalue-mutated`，原文已不在 DOM）與未翻譯段落不受影響；未翻譯頁 no-op。殘留 `data-shinkansen*` / `data-sk*` 由步驟 3 `stripDataAttrs` 一併剝。Forcing：`readwise-shinkansen-dual.spec.js` + `readwise-save.spec.js` wiring。
- **重複 hero 去重（v0.8.124 → v0.8.125，`buildCleanHtml` 步驟 0 之一）**：Readwise reading view 的 hero **完全來自 body**（`image_url` 只當資料庫縮圖、不在 reading view render）。站點常用 art-direction 把 hero 渲染成多張同圖 `<img>`（The Verge `duet--layout--entry-image` 內桌機 `_1044qizn` + 手機 `_1044qizm` 兩張、`?w=` 不同、pathname 相同、各自 media query 顯示），Readwise 無 CSS 兩張都現 → 重複（theverge.com hands-on 回報）。`NS.markHeroImageForExport(rootEl)` **保留第一張**（`NS.findLeadingHeroImage` 選到的可見最佳副本）、**只標記其餘 pathname 與 hero 相同的多餘副本**供 clone 移除；單一 hero（無 art-direction）站點不移除任何東西。**v0.8.124 曾誤移除全部同圖 → hero 整個消失（Jimmy 回報「不見了」），v0.8.125 改為保留一張**。比對 URL **pathname**（忽略 `?w=`/`crop=` query）→ 同檔不同尺寸變體都認、含檔名故不同圖不誤中；有 `<picture>` 祖先標 picture 整支移除、裸 img 標 img；`figcaption` 不在標記範圍 → 主圖圖說保留。與 `markLeadingBylineForExport`（v0.8.121）共用 `data-jread-rw-strip` 標記 + 同一段 clone 移除邏輯；閱讀模式顯示不受影響（標記只加在 clone 來源 live DOM、clone 後即移除還原）。Forcing：`readwise-hero-dup.spec.js` + `readwise-save.spec.js` wiring source-string。
- **`author`（v0.7.167）**：`main.js extractAuthor()` — 三條分支：
  - Facebook 合成 reader（`[data-jread-fb-reader]`）：`NS.fbPost.extractAuthorVanityFromUrl()` 抽 `/<user>/posts/<id>` 第一段 vanity username,reserved path（`groups` / `permalink.php` / `story.php` / `share` / `profile.php` / `permalink` / `people` / `pages`）沒 vanity → fallback 讀合成 header `[data-jread-fb-author] strong` 的 displayName。
  - X / Twitter 合成 reader（`[data-jread-x-reader]`）：`/<handle>/status/<id>` → `@handle`（hostname 嚴格比對 `x.com` / `twitter.com`，防 hostname 混淆攻擊）。
  - 一般網站：JSON-LD `Article.author.name`（含 `string` / `object` / `array` / `@graph` 多 schema）→ `meta[name="author"]` → `meta[property="article:author"]`（filter `^https?://` URL 形式）→ byline 元素：`[itemprop="author"] [itemprop="name"]` / `[itemprop="author"]` / `[rel="author"]` / `.byline-author` / `.author-name` / `.byline .author` / `.byline`（文字長度 >= 100 字拒絕，避免抓到段落）→ **`og:site_name` 的「刊物名 by 作者」尾段**（v0.8.73，`extractAuthorFromSiteName`，**最低優先序 fallback**）。動機：單人部落格 / newsletter（Substack / Ghost / 個人 WordPress）常省略文章層級署名，作者只活在站名（`Sharp Text by Andrew Sharp` / `Stratechery by Ben Thompson` / `Money Stuff by Matt Levine`）。結構通則、非站點特判：任何 `og:site_name` 走同一 regex `/(?:^|\s)by\s+(.+?)\s*$/i`。guard 壓低誤判——需空白邊界的 `by`（不誤命中 standby / rugby）、作者段 2–60 字、含字母（含 CJK）、不含 URL / `@` / 斜線（排除把網址或 handle 當作者）。只在前 4 條正規信號全失敗才用，避免誤蓋有正式 byline 的站。
- **`published_date`（v0.7.167–168）**:`main.js extractPublishedDate()` 三條分支（v0.7.168 加 FB / X 分流）:
  - Facebook 合成 reader(`[data-jread-fb-reader]`):**不送**——FB DOM 結構性沒絕對日期（只有「N 分鐘前」相對時間 `aria-label`），倒推精度不夠 Jimmy 寧可空白。
  - X / Twitter 合成 reader(`[data-jread-x-reader]`)：從合成容器第一個 `:scope > article`（主推文 clone,`x-thread.js collectThreadArticles` 排序保證）取**最後一個** `<time datetime>` —— X 主推文 article 內若有 quoted tweet,quoted 時間在前、主推文 timestamp 在後；沒 quoted tweet 時只 1 個 time 也是主推文。**不退回** document head meta（X 整站共用 OG metadata 無法代表單則推文）。
  - 一般網站：JSON-LD `datePublished` / `dateCreated`（含 `@graph` 巢狀）→ `meta` 變體（`article:published_time` / `pubdate` / `publishdate` / `date` / `DC.date` / `DC.date.issued` / `itemprop="datePublished"`）→ `<time datetime="...">` 第一個 parseable。一律 `new Date(raw).toISOString()` 正規化為 UTC ISO 8601（純日期 `2026-05-22` → `2026-05-22T00:00:00.000Z`；含時區 `+08:00` 自動轉 UTC）。

### 設定

- 欄位：`readwiseToken`（string，預設 `''`），存於 `chrome.storage.sync`
- 取得方式：`https://readwise.io/access_token`
- 設定位置：options 頁「Readwise Reader 整合」區塊（password input）
- **測試按鈕（v0.8.64）**：token input 旁的「測試」按鈕，讓使用者在儲存前驗證 token 是否正確。讀 input 目前值（含尚未 blur 存檔的輸入）→ `popup-core.validateReadwiseToken({ token })` 打官方驗證端點 `GET https://readwise.io/api/v2/auth/`（header `Authorization: Token <token>`，有效回 `204 No Content`、無效回 `401`；比 `POST /save/` 輕量、不建任何文件）。fetch 在 options 頁直接發（extension 頁有 `<all_urls>` host_permission、免 CORS）。結果在按鈕下方雙通道呈現（色 + ✓/✗ 符號）：`✓ Token 有效`（綠）/ `✗ Token 無效或已過期`（AUTH，紅）/ `✗ 無法連線，請檢查網路`（NETWORK，紅）/ `✗ 請先貼上 token`（空，紅）/ `✗ 測試失敗（N）`（其他 HTTP，紅）。使用者重新編輯 token（`input` 事件）即清掉上次結果。`validateReadwiseToken` 為 popup-core 純函式（注入 fetch、回傳 `{ ok, error, status }` 與 `saveToReadwise` 對齊），regression 在 `test/regression/readwise-save.spec.js`。

### Gemini 摘要（v0.8.72）

送 Readwise 時可選用 Google Gemini Flash Lite 先產生**繁體中文三句摘要**塞進 `summary` 欄位，取代 Readwise server 端自動生成的英文摘要。動機：Readwise 自動摘要為英文，且品質受其 server parser 影響；改由 client 端用使用者自己的 Gemini key 產生繁中摘要。

- **設定**（皆存 `chrome.storage.sync`，options 頁「Readwise Reader 整合」區塊）：
  - `readwiseSummary`（boolean，預設 `false`）：「送出時自動產生摘要」開關（checkbox）
  - `geminiApiKey`（string，預設 `''`）：Gemini API key（password input），從 `https://aistudio.google.com/apikey` 取得
- **編排（v0.8.74）**：Token / 摘要開關 / Gemini key 三項同屬「Readwise 整合」一個功能，options 頁用 `.field-group` 包住、移除彼此間的分隔線（`.field-group .field { border-bottom: none }`——分隔線只切分不同設定，同功能子設定不切開）。
- **Gemini key 測試按鈕（v0.8.74）**：key input 旁的「測試」按鈕（`#geminiTest` + `#geminiTestResult`），與 Readwise token 測試同款。讀 input 目前值 → `popup-core.validateGeminiKey({ apiKey })` 打 `GET https://generativelanguage.googleapis.com/v1beta/models?key=<KEY>`（models list，零 token 成本、不產生內容；無效 key 回 `400 INVALID_ARGUMENT` / `401` / `403 PERMISSION_DENIED` → AUTH）。雙通道呈現：`✓ API key 有效`（綠）/ `✗ API key 無效`（AUTH）/ `✗ 無法連線，請檢查網路`（NETWORK）/ `✗ 請先貼上 API key`（空）/ `✗ 測試失敗（N）`（其他 HTTP）。`validateGeminiKey` 為 popup-core 純函式（注入 fetch、回傳 `{ ok, error, status }` 與 `validateReadwiseToken` 對齊），regression 在 `test/regression/readwise-save.spec.js`。
- **觸發條件**：`readwiseSummary === true` **且** `geminiApiKey` 非空 **且** payload 有 `text`（主文純文字）才呼叫；任一不成立則不產生、照常送出（由 Readwise 自處理）。
- **API**：`POST https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=<KEY>`，body `{ contents: [{ parts: [{ text: <prompt> }] }] }`，回應取 `candidates[0].content.parts[*].text` 串接。model 用 `-latest` 別名自動指向最新 flash-lite。fetch 在 extension 頁（popup）/ SW 直接發（`<all_urls>` host_permission）。
- **Prompt**：移植自 Readwise Reader 網站內建 summarize prompt（繁中版），去掉 Jinja `num_tokens` 分支（`central_paragraphs` / `central_sentences` 是 Readwise server 端 filter、client 無法重現）——改為 client 端把主文純文字 head-truncate 到 `GEMINI_MAX_CHARS`（40K 字元）內直接送。組裝在 `popup-core.buildSummaryPrompt({ title, author, domain, text })`。
- **payload 新增欄位（content script 端）**：`extractReaderPayload()` 多回 `text`（`articleEl.innerText` collapse 後 head-truncate 50K 字元）+ `domain`（`location.hostname`），供摘要使用；這兩欄**不**送進 Readwise body（只是摘要原料）。
- **fallback**：任何失敗（無 key / 無內文 / 網路 / 非 2xx / 空回應）都不阻斷儲存，照送不帶 `summary`。`generateGeminiSummary` 為 popup-core 純函式（注入 fetch、回 `{ ok, summary }` 或 `{ ok:false, error }`，error 碼 `NO_KEY` / `NO_TEXT` / `NETWORK` / `AUTH` / `HTTP` / `EMPTY` / `NO_FETCH`）。
- **送出軌共用**：popup 按鈕（`popup.js`）與快速鍵（SW `sendToReadwiseFromCommand`）都共用 popup-core 的 `buildReadwisePayload` / `saveToReadwise` / `generateGeminiSummary`，單一資料源。**結果 toast 文字**（`已送到` / `已存在` / `尚未設定 token` / `token 無效` / `網路錯誤` / `送出失敗（HTTP N）`）抽到 popup-core `readwiseResultToast(result) → { message, kind }`，供快速鍵 SW 軌（無 popup UI、結果只能靠 toast）使用（v0.8.165；v0.8.166 起懸浮按鈕長按選單不再有 Readwise 直送項，Readwise 一律走 popup）。regression 在 `test/regression/readwise-save.spec.js`（含 `readwiseResultToast` 對映）。

### Popup UI 行為

- 「送到 Readwise Reader」按鈕放在閱讀模式 toggle 按鈕下方，次級樣式（白底灰邊）
- popup 開啟時透過 `GET_READER_STATE` 查 reader mode 狀態，按鈕可見性（v0.7.130 起整顆 `hidden`、非 disabled；`disabled` 軸保留給送出中防連點）：
  - reader mode 已啟動 **且** 非 cinema mode **且** 已設定 `readwiseToken`（trim 後非空，v0.8.50）→ 按鈕顯示
  - 其餘（未啟動 / cinema / 無 token / chrome:// 等 sendMessage reject / 無 tab）→ 整顆 `hidden`——沒 token 按下去必然失敗，露出只是雜訊
- 點擊（v0.8.65）：popup → content（`EXTRACT_READER_HTML` 抽 outerHTML + url + title + text + domain）→ **若開啟 `readwiseSummary` 且有 `geminiApiKey`**，先 `popup-core.generateGeminiSummary` 產生摘要塞進 payload（v0.8.72）→ **popup 自己**讀 `readwiseToken` + `popup-core.saveReaderPayload`（buildReadwisePayload + fetch `POST /api/v3/save/`）回結果。**不再繞 SW**（iOS 背景頁掛起會 silently 失敗，見訊息協定段 v0.8.65 註）。快速鍵送出（無 popup）走 SW `sendToReadwiseFromCommand`。**懸浮按鈕長按選單**不提供 Readwise 直送（v0.8.166 移除）——改走「功能選單」叫出 popup 後按 popup 內的 Readwise 按鈕（理由：v0.8.165 曾試 Safari content script 直送，iOS 可送達但 toast 不顯示、無回饋，故回退到有狀態文字回饋的 popup 軌）
- 狀態條訊息：`產生摘要中…`（v0.8.72，僅開啟摘要時）/ `送出中…` / `已送到 Readwise Reader` / `已存在於 Readwise Reader` / `尚未設定 Readwise token` / `Readwise token 無效或已過期` / `網路錯誤` / `送出失敗（HTTP N）`／`送出失敗（INTERNAL / INVALID_PAYLOAD）`（v0.8.65 起 generic 分支帶 error code 便於 iOS 真機回報定位）

## 編輯模式（v0.8.108，v0.8.109 段落提示）

閱讀模式啟動時讓使用者手動點掉 cleaner 漏網的雜訊區塊。模組 `content/edit-mode.js`（`NS.editMode`）。

- **入口**：popup「編輯模式：移除雜訊」按鈕——`refreshPopupForActiveTab` 依 `GET_READER_STATE` 的 `active && !cinemaActive` **且 options `editModeEnabled !== false`**（v0.8.109）顯隱、依 `editModeActive` 切「編輯模式：移除雜訊 / 完成編輯」文字。點下送 `EDIT_MODE_TOGGLE` 給 content 後關 popup（編輯互動在頁面內進行）。**options 開關 `editModeEnabled`**（v0.8.109，預設 true）：不需要此功能者可在 options 關掉，popup 不再顯示按鈕。
- **段落提示（v0.8.109，仿 Shinkansen 編輯模式）**：進入時 `markBlocks` 以 `chooseBlock` 枚舉「使用者可點掉的 block 集合」（content leaf 各 resolve 到所屬 block、去重 + 去巢狀 = 主文自然分割，**提示範圍 = 實際可選範圍單一資料源**），各設 `data-jread-edit-block`、注入單一 stylesheet（`__jread-editmode-style`）給每塊持久虛線外框（`1.5px dashed` 藍 + `outline-offset:2px` + `border-radius:3px`），hover 那塊外框加深 + 淡底色——一眼看到所有可選區塊範圍。hover 標亮純 CSS（`[data-jread-edit-block]:hover`）、點擊當下才 `chooseBlock(e.target)` resolve，**不再用 shadow overlay + mousemove 追蹤**（toolbar 仍走 Shadow DOM）。退出 `unmarkBlocks` 清 attr + 移除 style。
- **block 邊界選取（演算法 C，real-site probe 驗證）**：從游標 `e.target` 起——(1) **inline 正規化**：`getComputedStyle.display` 為 inline 系（inline / inline-block / inline-flex / contents）的元素往上爬到所屬 block（點段落內連結 → 選整段而非只選連結）；(2) **tight-wrapper climb**：parent 為純包裝才上爬——`children.length <= 1`，或 parent 的**其他子元素文字皆 < `MIN_SIBLING_TEXT`(8)**（cand 承載 parent 幾乎全部內容、其餘是空殼/void/圖示）。**不用字數比例邊界**（v0.8.111 把 `max(cLen×1.3, cLen+30)` 改掉）——比例對「相異的短行」脆弱：restofworld 日期行 38 字 + 同層翻譯連結 12 字，meta 50 字與 38×1.3=49.4 差 0.6 字就決定要不要把日期併進整個 header（Jimmy 2026-06-18 回報點日期連刪多行）；改判「有沒有另一個 ≥8 字實質子」直接捕捉純包裝、不靠邊界。(3) **dominant-wrapper guard**：拒絕「子 ≥ 3 且文字 ≥ 主文 60%」的塊回 `null`。probe 在 Substack（`<article>` 下單一 div 佔全文 99%）抓到「爬到 articleEl 直接子」會災難性誤選整篇的 over-select 陷阱、演算法 C 在 Substack 巢狀 + Wikipedia 扁平 + restofworld header 多短行結構都正確（硬規則 3 結構通則、非站點/class 特判）。短文字推薦 widget 點單一項目選該項目（per-item），整塊移除可由 hover 容器留白區（單一子 climb）達成。
- **隱藏 / 還原（單一資料源）**：複用 `NS.cleaner.hideElement(el, NS.state.hiddenEls)`——同一條 inline `display:none !important` + restyle observer 機制；記錄塞進 `NS.state.hiddenEls`，退出閱讀模式時既有 `cleaner.restore` 一併還原，**編輯模式不自寫還原路徑**。手動移除**僅當次有效**（退出閱讀模式 / SPA 導航 / reload 即還原）；移除段落自動不進 Readwise（`buildCleanHtml` 已剔除 `[data-jread-hidden]`）。
- **undo（誤刪救回）**：toolbar「復原」按鈕 + **`Cmd/Ctrl+Z` 快速鍵**（v0.8.109）都走 LIFO undo——還原最後一次移除（`editStack` pop → 還原 inline display + 刪 `data-jread-hidden`，restyle observer guard 自動停止補回 `none`、不需 unregister）。toolbar hint 在已移除時顯示「已移除 N　誤刪可按『復原』或 Cmd/Ctrl+Z」。
- **interaction layer 暫停 / 還原（main.js 主導）**：keyguard / ESC / space-scroll / paged-mode 與編輯模式 click 衝突，由 `main.js` 的 `suspendReaderInteractions` / `restoreReaderInteractions` 在進 / 出編輯模式時暫停與依 settings 裝回（生命週期本就住 main.js）；`edit-mode.js` 只負責編輯互動，退出時 `onExit` 回呼通知 main.js 還原。退出閱讀模式 / SPA 導航時 `exitReaderModeImpl` 先 `NS.editMode.exit(true)`（silent，不觸發 onExit）拆編輯 UI + 段落提示。
- **UI**：toolbar（復原 / 完成 + 「已移除 N」提示）以 Shadow DOM（`all:initial` host、`pointer-events:none` 讓事件穿透到頁面元素、toolbar 子層 `pointer-events:auto` 可點）封裝避免站點 CSS 污染；ESC 鍵在編輯模式內改為退出編輯模式。**host 必須掛 `document.documentElement`（`<html>`）而非 body**（v0.8.110）——閱讀模式中 cleaner 的 dynamic-append observer 監看 body + article 子樹、會把 body 下新 append 的元素當動態雜訊 `display:none` 藏掉，toolbar 掛 body 會整條看不見（與 space-scroll 焦點條 / paged 頁碼指示同款規避；forcing：`editmode-block-select.spec.js` 驗 `host.parentNode === documentElement`）。
- **regression**：`test/regression/editmode-block-select.spec.js`（演算法 C 五種顆粒度 + 段落提示 markBlocks/collectBlocks/stylesheet/退出清除 + hideElement/restore 整合）+ `editmode-options-toggle.spec.js`（editModeEnabled 四處 wire-up forcing），fixture `editmode-blocks.html` 仿 Substack dominant-wrapper 結構。

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

**儲存狀態提示條（v0.8.162，`#save-bar`，參考 Shinkansen save-bar）**：options 固定頂端的提示條，取代原本只閃「已儲存」的 inline `#save-status`。三態——任一欄位變更先亮「存檔中…」（`.saving` 紅）→ `chrome.storage.sync.set` callback 轉「已存檔」（`.saved` 綠、3s 後 `hidden`）/ 失敗（`chrome.runtime.lastError`）顯示「儲存失敗，請稍後再試」（`.error` 紅、4s）。`showSaving()` 加在三條寫入 path（欄位 `change` / 快速鍵 `saveShortcuts` / 自動啟動網域 `change`），`flashSaved()` 在 set callback 收尾分流 saved / error。forcing：`options-save-bar.spec.js`（saving→saved 中間態、失敗不誤標 saved、段末不留句號）。

### Auto-enter 行為

- **觸發點**：`jread/content/main.js` IIFE 末尾 `tryAutoEnableOnLoad()`，document_idle 時 read settings → `matchHostname(location.hostname, list)` → 命中即 `enterReaderMode({ silent: true })`
- **iframe guard**：`window.top !== window.self` 直接 return，避免 iframe 內 hostname 命中導致一頁多次觸發
- **silent flag**：偵測失敗時**不**彈「此頁無法偵測主文」toast（使用者沒主動按、彈錯誤反而干擾）。手動 toggle / 快速鍵走無 silent 路徑、行為不變。
- **SPA 路由**：不額外處理。content script 每次完整頁面 navigation 重新注入，這層就是天然的「頁面載入」時點。SPA 內部 history.pushState 切頁不會重觸發（與整個 extension 一致）。

## 閱讀位置記憶（v0.8.40）

文章看到一半離開（退出閱讀模式、關分頁、SPA 換頁、瀏覽器重啟）時記住閱讀位置，效期內（`positionMemoryDays`，預設 3 天、上限 7、0 = 停用）重新進入閱讀模式自動回到上次位置。實作：`content/position-memory.js`（純邏輯 module.exports 給 jsdom spec）。

### 記什麼

- **捲動模式**：「目前閱讀段落」的文字簽名（collapse 空白取前 120 字）+ 段落 index + 整篇進度比例。段落來源 = `NS.spaceScroll.currentAnchor`——焦點段落（指示條）還在 viewport 內就用它，否則 viewport 內第一個段落；段落收集規則與 space-scroll `collectBlocks` 同一份（v0.8.40 起 `collectBlocks(rootEl)` 接受容器參數、匯出 `getBlocks` / `currentAnchor` / `anchorTo`）。
- **翻頁模式**：頁碼 + 總頁數（`NS.pagedMode.getPosition`，v0.8.40 新 API）+ 進度比例。

### 回復策略（多層 fallback）

1. **翻頁模式**：總頁數沒變直接 `goToPage` 同一頁；變了（字級 / 版心 / 視窗改變導致重新分頁）按進度比例換算。
2. **捲動模式**：文字簽名在段落清單找回同一段（簽名重複取離儲存 index 最近者）→ 捲到 REST_FRACTION（0.1，與 space-scroll 落點同值、spec 鏡像校對）落點 + `anchorTo` 把指示條移上去；簽名找不到（內容改版）退儲存 index；再退進度比例。
3. **跨模式**（存的時候是捲動、回來開了翻頁，或反之）：進度比例近似換算。
4. 回復後 1.2s 若使用者未互動再對位一次（lazy-load 圖片推移版面）。

### 儲存與生命週期

- `storage.local.readingPositions` map（快取類不放 sync——entry 含段落文字、量大且無跨裝置意義），urlKey 用 main.js `spaRouteKey`（錨點 hash 不分流、hash-router 分流，與 SPA 導航偵測同一份 key 語意；SPA 換頁後 flush 用進場時捕捉的 key）。
- 追蹤：reader mode 啟動期間 scroll / wheel / touch / keydown / click 觸發 debounce 1s 寫入；pagehide / 分頁切背景立即 flush；`exitReaderModeImpl` 開頭呼叫 `endSession()`——必須在 `pagedMode.uninstall`（頁碼歸零）與 `styler.restore`（捲動位置還原原站排版）**之前**（spec forcing）。
- `beginSession` 在 finalizeEnter 內、`syncPagedModeFromSettings` 之後（翻頁模組裝好才能 goToPage）、`installKeyguard` 之前（keydown listener 先於 keyguard 註冊，否則 stopImmediatePropagation 吃掉翻頁鍵；spec forcing）。
- 位置還在開頭（翻頁第 1 頁 / 捲動進度 < 2% 且段落 index 0）不記、並刪舊 entry；寫入時淘汰過期 + 超量（上限 100 筆）。
- 與 v0.7.227「退出 reader mode 從第一頁起」的關係：`resetPosition()` 照舊歸零，記憶功能啟用且效期內由 restore 蓋回上次頁碼——停用（0）時行為與 v0.8.39 以前完全相同。

### 驗證分層

- jsdom：`test/regression/position-memory.spec.js`（純邏輯 + wiring 順序 forcing）。
- e2e：`test/e2e/position-memory.spec.js`（真 Chromium：捲動 / 翻頁 exit→重進回復、停用不寫）。
- 跨瀏覽器重啟：debug-harness 跨 run 實證（2026-06-11 enter 自動回到上輪第 2 頁）；harness 為保確定性已在 toggle 前 `storage.local.remove('readingPositions')`（debug-harness + page-rounds 兩支都清，位置記憶驗證走獨立 e2e、不靠站點 harness）。

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

`refreshPopupForActiveTab()` 開啟 popup 時 `chrome.tabs.sendMessage(tabId, { type: 'GET_READER_STATE' })`，依 response 的 `siteMode` / `active` 切按鈕文字：

- `siteMode === 'youtube-cinema'`：`cinemaActive=false → '啟動影院模式'`、`cinemaActive=true → '退出影院模式'`
- 其他站（v0.8.104 起反映 reader mode 狀態，不再固定「切換閱讀模式」）：`active=true → '退出閱讀模式'`、`active=false → '啟動閱讀模式'`
- off 狀態 fallback：無有效分頁（早期 return）或 content script 未注入（`GET_READER_STATE` reject 的 catch）一律設回 `'啟動閱讀模式'`；`popup.html` 初始文字亦為 `'啟動閱讀模式'`（最常見 off 開啟態，減少 GET_READER_STATE 回來前的閃動）

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

### VERSE（verse.com.tw，flex 直立 credit rail）

- **測試日期**：2026-06-09
- **測試頁面**：`/article/kanda`
- **DOM 結構**：`article > div.content-wrapper(display:flex) > { div.content(主文), div.meta(直立 credit rail) }`。`.meta` rail 裝 `<ul.authors>` 直書「文字、攝影／TC 盾」+ 書籤 `<button>`，被 flex `align-items: stretch` 拉到與主文等高（clean-time 255×9883px）
- **症狀**：reader mode 開啟後主文左側殘留直書 byline credit + 書籤 icon；rail 吃掉 flex 寬度讓主文窄於版心（580px / 應 608px）
- **既有規則為何漏**：`hideInsideArticleSidebarColumns` 條件 A/C 要 `linkDensity > 0.5`（rail 是純文字 credit + icon、ld 低）、條件 B 要 `<aside>` tag（rail 是 `<div>`）、條件 D 要 sibling 含 heading（rail 無）；又因 cleaner 跑在 styler 之前，clean-time rail 還是 255px 寬（非 styler reflow 後的 28px），靠絕對窄寬度判斷也漏
- **觸發新規則**：`hideInsideArticleSidebarColumns` **條件 E**（v0.8.23）——父容器 `display:flex` + sibling 文字 < main × 10% + rect 高 > 400 + 寬 < main 寬 × 0.5 + 高 > 寬 × 2 + 不含 ≥ 120×120 真圖片 → hide。純結構幾何、clean-time 即成立、不綁 class / hostname。image guard（`railContainsRealImage`）保護雜誌側圖排版的真圖片欄不被誤殺
- **連帶修好**：rail 移除後 flex 寬度回歸主文，27 段內文全部滿版 608px（WIDTH AUDIT 同源警告一併消失）
- **forcing spec**：`test/regression/verse-flex-meta-rail.spec.js`（核心 hide + 主文保留 + image guard 不誤殺）

---

## 變更紀錄

見 `CHANGELOG.md`。
