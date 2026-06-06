# JRead

純閱讀模式，一鍵隱藏廣告、側邊欄、彈窗、浮動元素，將主文以乾淨排版呈現。

**目前版本**：見 [CHANGELOG.md](CHANGELOG.md) 頂部條目。

---

## 功能

- 主文偵測（`<article>` / Schema.org / 內容密度啟發式）
- 閱讀模式一鍵切換
- 乾淨排版（字體、字級、行高、版心寬度）
- 雜訊隱藏（廣告、sticky header、彈窗、相關文章列表）
- 偏好設定：主題（亮/暗/米色）、字級、版心寬度
- Space / Shift+Space 段落焦點卷動（v0.7.216）：閱讀模式下左側指示條標記目前段落，按 Space 跳到下一段；段落低於顯示門檻時自動平滑卷回畫面上方（仿 Readwise Reader，門檻可在 options 調整）
- Readwise Reader 整合（v0.7.33）：把 JRead 處理過的乾淨主文一鍵送到 Readwise Reader，繞過原站 parser 問題
- 自訂快速鍵（v0.7.218）：options 「快速鍵」區可為「切換閱讀模式 / 送 Readwise / YouTube 無邊模式」錄製自訂組合鍵——Safari（含 iPad 外接鍵盤）沒有瀏覽器層改鍵入口，這裡是唯一通道；Chrome 也通用

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

每次 release 會自動產出 `jread-macos-vX.Y.Z.pkg`（Developer ID 簽章 + Apple notarize + stapled，見 GitHub Releases）。安裝步驟：

1. 從 GitHub Releases 下載 `jread-macos-vX.Y.Z.pkg`
2. 雙擊 .pkg 安裝（Gatekeeper 會認 Developer ID notarized 簽章）
3. 打開 `JRead.app`
4. 點「結束並開啟 Safari 擴充功能偏好設定…」
5. 在 Safari 設定的「擴充功能」分頁勾選 JRead 啟用

需 macOS 10.14 以上 + Safari 14 以上。本機重建見 `safari-app/safari-build.sh`（需 Xcode + Apple Developer ID cert + notarytool profile）。

### iOS / iPadOS Safari（TestFlight）

v0.7.217 起提供 iOS / iPadOS Safari Web Extension，目前走 TestFlight internal testing（尚未公開上架 App Store）：

1. 受邀測試者在 iPad / iPhone 裝 TestFlight App，接受邀請後安裝 JRead
2. 設定 → App → Safari → 延伸功能 → 啟用 JRead，並允許「所有網站」
3. Safari 工具列點 J 圖示 → 「切換閱讀模式」

發佈走 `safari-app/ios-build.sh`（手動觸發、與 Chrome / macOS release 解耦；需 Xcode + Apple Distribution cert + ASC API key，簽章資源由 `tools/asc-provision-ios.js` 管理）。

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
3. Safari Developer ID build（`safari-app/safari-build.sh`：archive + notarize + staple → `jread-macos-vX.Y.Z.pkg`；`SKIP_SAFARI=1` 可緊急跳過）
4. auto-commit pbxproj + Resources/ 改動
5. `git tag` + `git push && git push --tags`
6. GitHub Actions（`.github/workflows/release.yml`）build Chrome + Firefox + Firefox source zip 上傳到 Release
7. 本機 `gh release upload .pkg --clobber` 把 macOS .pkg 附到同一個 Release

Release artifact：

- `jread-vX.Y.Z.zip`（Chrome）
- `jread-firefox-vX.Y.Z.zip`（Firefox sideload）
- `jread-firefox-vX.Y.Z-source.zip`（AMO source 提交用）
- `jread-macos-vX.Y.Z.pkg`（macOS Safari Developer ID）
