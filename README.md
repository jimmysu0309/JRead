# JRead

純閱讀模式，一鍵隱藏廣告、側邊欄、彈窗、浮動元素，將主文以乾淨排版呈現。

**目前版本**：見 [CHANGELOG.md](CHANGELOG.md) 頂部條目。

---

## 功能

- 主文偵測（`<article>` / Schema.org / 內容密度啟發式）
- 閱讀模式一鍵切換
- 乾淨排版（字體、字級、字重、行高、版心寬度）；字重三段細/中/粗（v0.7.254，真正的 font-weight、全平台一致生效）；版心自我檢查（v0.7.246／標題列 v0.7.247）確保內文、標題、分類列都撐滿設定寬度，不被原站 wrapper 內距夾窄
- 英文字型自選（v0.8.144，v0.8.146 擴充）：「字型」選襯線或無襯線時，下方多一個「英文字型」選單，可單獨指定英文/數字用哪個拉丁字型，中文仍照襯線/無襯線的字體渲染；襯線、無襯線各自記住選擇。系統字（Georgia / Times / Charter / Palatino / Helvetica / Arial / Verdana / SF Mono / Consolas）外，v0.8.146 起再內附 5 支可變字型 woff2——襯線 Literata / Source Serif / Piazzolla、無襯線 Public Sans / Source Sans，跨平台（含 iOS）皆可用
- 雜訊隱藏（廣告、sticky header、彈窗、相關文章列表）
- 編輯模式（v0.8.108，v0.8.109 段落提示）：閱讀模式下 popup 按「編輯模式：移除雜訊」，頁面上 cleaner 漏掉的雜訊段落會以虛線框標出全部可選範圍，點一下即移除，誤刪可按「復原」或 <strong>Cmd/Ctrl+Z</strong>，頁內有工具列。移除僅當次有效（退出閱讀模式或重新整理頁面即復原），移除的段落也不會被送進 Readwise。不需要此功能可在進階設定「編輯模式」關閉，popup 就不顯示該按鈕
- 偏好設定：主題（亮/暗/米色）、字級、版心寬度
- Space / Shift+Space 段落焦點卷動（v0.7.216）：閱讀模式下左側指示條標記目前段落，按 Space 跳到下一段；段落低於顯示門檻時自動平滑卷回畫面上方（仿 Readwise Reader，門檻可在 options 調整）
- Readwise Reader 整合（v0.7.33）：把 JRead 處理過的乾淨主文一鍵送到 Readwise Reader，繞過原站 parser 問題
- Readwise 摘要（v0.8.72）：選用 Google Gemini Flash Lite，在送出時自動產生文章摘要一起送出，取代 Readwise 內建的英文自動摘要（需在 options 填入自己的 Gemini API key）
- 自訂快速鍵（v0.7.218）：options 「快速鍵」區可為「切換閱讀模式 / 送 Readwise / YouTube 無邊模式」錄製自訂組合鍵——Safari（含 iPad 外接鍵盤）沒有瀏覽器層改鍵入口，這裡是唯一通道；Chrome 也通用
- 3 指輕點切換閱讀模式（v0.7.223）：iPhone / iPad 觸控環境直接 3 指輕點頁面即可進出閱讀模式，不用每次開 Safari 選單找 popup
- 閱讀位置記憶（v0.8.40）：文章看到一半離開（退出閱讀模式、關分頁、瀏覽器重啟）會記住閱讀位置——捲動模式記目前段落、翻頁模式記頁數，效期內重新進入閱讀模式自動回到上次位置。效期可在 options 調整（預設 3 天、最長 7 天、0 = 停用）
- 翻頁模式（v0.7.227）：popup 開啟後像電子書一樣左右翻頁——手機左右滑動、桌面 ← → 鍵或滾輪，圖片自動縮放至單頁內，底部頁碼可開關（v0.7.237）。iOS 翻頁時攔截 Safari 邊緣返回手勢，避免第一頁左滑誤觸返回；iOS 翻頁第一頁垂直滑一下可收合 Safari 工具列、多顯示一行（v0.7.238；v0.7.239 起整頁皆可滑翻頁、工具列收合限第一頁、第二頁起維持鎖定；v0.7.244 把垂直捲動範圍壓到最低、第一頁左右滑更乾淨；v0.7.245 第一頁收合且捲動停止後自動鎖住垂直、維持收合）

詳細規格見 [SPEC.md](SPEC.md)。

---

## 安裝（開發中）

### Chrome

1. Clone 本 repo
2. 打開 Chrome，進入 `chrome://extensions/`
3. 右上角開啟「開發人員模式」
4. 點「載入未封裝項目」，選擇 `jread/` 資料夾
5. 點工具列上的 JRead 圖示即可使用

每次改程式碼後請回 `chrome://extensions/` 按該擴充功能卡片上的重新載入按鈕。

### Firefox

每次 release 會自動產出 `jread-firefox-vX.Y.Z.zip`（見 GitHub Releases）。本機重建：

```bash
./tools/firefox-build.sh   # 需 jq
```

詳細的 Firefox build transform 說明見 [BUILD.md](BUILD.md)。

### macOS Safari

> **v0.7.249 起改用 iOS App 涵蓋 macOS。** 不再產獨立的 Developer ID `.pkg`——Safari 版本由**單一 iOS binary** 提供，在 Apple Silicon Mac 上以「iPad App 在 Mac 執行」模式跑（見下方 iOS / iPadOS 章節）。
>
> 歷史 `.pkg`（v0.7.248 以前）仍保留在 GitHub Releases 可下載，但不再更新；既有以 `.pkg` 安裝的使用者請改裝 iOS App。

### iOS / iPadOS / macOS Safari（TestFlight）

v0.7.217 起提供 Safari Web Extension，**單一 iOS binary 同時涵蓋 iPhone / iPad / Apple Silicon Mac**，目前走 TestFlight internal testing（尚未公開上架 App Store）：

1. 受邀測試者在 iPhone / iPad / Mac 裝 TestFlight App，接受邀請後安裝 JRead
2. 啟用擴充功能：
   - **iPhone / iPad**：設定 → App → Safari → 延伸功能 → 啟用 JRead，並允許「所有網站」
   - **Mac**（以 iPad App 執行）：Safari → 設定 →「擴充功能」分頁勾選 JRead，並允許「所有網站」
3. Safari 工具列點 J 圖示 → 「啟動閱讀模式」（已在閱讀模式時按鈕會顯示「退出閱讀模式」）

發佈走 `safari-app/ios-build.sh`（手動觸發、與 Chrome / Firefox release 解耦；需 Xcode + Apple Distribution cert + ASC API key，簽章資源由 `tools/asc-provision-ios.js` 管理）。

---

## 開發

- 骨架/協作規則：見 [CLAUDE.md](CLAUDE.md)
- 完整規格：見 [SPEC.md](SPEC.md)
- 變更紀錄：見 [CHANGELOG.md](CHANGELOG.md)

### 測試

```bash
npm test
```

`test/version-check.spec.js` 是版本號 forcing function，每次 bump 版本號必須同步更新 `EXPECTED_VERSION`。

### 自動化除錯

```bash
npm install
npx playwright install chromium   # 首次：下載 bundled Chromium
npm run debug                     # 或 node tools/debug-harness.js --fresh
```

會用 Playwright 內建 Chromium 載入 `jread/` 為 unpacked extension，打開目標頁（預設 ChinaTalk，可用 `JREAD_URL` 環境變數覆蓋），觸發閱讀模式，讀 DOM 狀態 + 量測 gap + 截圖到 `.playwright-mcp/jread-viewport.png`。詳見 [docs/CHROME_EXTENSION_DEBUG.md](docs/CHROME_EXTENSION_DEBUG.md)。

### 發佈

```bash
./release.sh
```

`release.sh` 跑完整流程：

1. `npm test`
2. working tree clean check
3. `git tag` + `git push && git push --tags`
4. GitHub Actions（`.github/workflows/release.yml`）build Chrome + Firefox + Firefox source zip 上傳到 Release

Safari（iOS／在 Mac 以 iPad App 執行）走獨立的 TestFlight 軌、與本流程解耦——人工跑 `./safari-app/ios-build.sh`。

Release artifact：

- `jread-vX.Y.Z.zip`（Chrome）
- `jread-firefox-vX.Y.Z.zip`（Firefox sideload）
- `jread-firefox-vX.Y.Z-source.zip`（AMO source 提交用）
