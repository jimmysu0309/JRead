---
name: ios-release
description: JRead iOS Safari Web Extension 的 TestFlight 出版與模擬器自驗。Jimmy 說「發 iOS / 上 TestFlight / 同步 iOS build」或修 iOS 專屬 bug 要驗證時用。與 release.sh 解耦、人工觸發
---

# iOS 出版（TestFlight 軌）

## 出版

```bash
./safari-app/ios-build.sh                 # 同步 Resources → bump pbxproj → archive → export ipa → altool 上傳 ASC
SKIP_UPLOAD=1 ./safari-app/ios-build.sh   # 只產本機 .ipa 不上傳
```

要點（細節都在 script 開頭註解，這裡只列會踩的）：

- **同版本號重傳 ASC 會被拒**——MARKETING_VERSION 與 CURRENT_PROJECT_VERSION 都取 manifest version，重傳前必先 bump（走 `/release` skill 的同步清單）
- Resources mirror drift 是 script 內建 forcing function：結束前 `diff -r jread/ Resources/`，non-empty 中止
- 簽章走 manual（team 無註冊裝置，automatic 在 archive 會失敗）；Apple Distribution 憑證一年到期，重跑 `tools/asc-provision-ios.js` 換發
- ASC API key 與 Shinkansen 共用（`ASC_KEY_ID=592WJH7U2F`，env 可覆寫）
- build 目錄在 `$TMPDIR`，不可寫進 repo（iCloud fileprovider 會把 signed bundle 接管成 root:wheel）
- **macOS 測試也走這條軌**：Jimmy 在 Apple Silicon Mac 用 iOS TestFlight build（iOS app on Mac）測 Safari extension；macOS .pkg 軌 v0.7.249 已退役

## 模擬器自驗 loop（iOS bug 自己 close，不請 Jimmy 操作）

1. XcodeBuildMCP：先 `session_show_defaults`，再 build / install / launch simulator
2. **免點 UI 啟用擴充**：plist 注入啟用 extension；**免點 UI 重現狀態**：直接寫擴充 SyncStorage.db 設 `autoEnableDomains` + `pagedMode` → openurl 即自動進閱讀模式
3. 手勢 / 觸控類用 idb 注 HID；XcodeBuildMCP 也有 tap / swipe / screenshot
4. content console.log **不進 unified log**——instrument 改成在頁面印 red-border div
5. 取 pixel 色：sips 裁 1×1 + zlib 解 PNG

## iOS 已知 WONTFIX / 平台限制（別再查）

- 狀態列顏色 content script 改不動（載入時取樣一次後凍結，theme-color 在 iOS 無效）
- iOS host 不能做擴充狀態偵測（SFSafariExtensionManager 是 macOS 專屬 API）
- macOS WPA（加入 Dock 的 web app）吞 ⌥ 快速鍵 + 間歇掛起 SW——WONTFIX 定案，支援路徑 = 自訂 ⌃ 快速鍵
- 翻譯後閱讀模式疊影 / 白框 = Shinkansen Content Guard，2026-06-10 決定不修
- 模擬器測不準的 Safari chrome 行為（網址列收合 / 慣性 / cancelable）→ 寫 standalone HTML 放 GitHub Pages 請 Jimmy 真機開，查清後 git rm + 關 Pages

## 真機驗收的不可重現回報

「只在 Safari」的雜訊先懷疑 translate-first 情境（Jimmy 在 Safari 才開 Shinkansen），用 `/harness-verify` 的 `--translate-first` 在 Chromium 重現，不要預設 WebKit 引擎差異。
