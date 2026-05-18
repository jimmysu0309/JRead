#!/usr/bin/env bash
# safari-bootstrap.sh — Bootstrap or recreate the Xcode project
#
# 用途：
#   一次性 — 用 xcrun safari-web-extension-converter 從 jread/ 產出
#   Xcode project 進 safari-app/JRead/。Xcode 大版本升級或 default
#   project 結構改變時可重跑（會覆蓋 safari-app/JRead/），平常開發 /
#   release 不要跑。
#
# 警告：
#   會覆蓋 safari-app/JRead/（包含 JReadApp.swift / ContentView.swift 等
#   本機 host App 檔案）。重跑前手動備份這些檔，完成後再 patch 回去。
#   本 script 不動 safari-app/ 根目錄的 build script / plist
#   （safari-build.sh、safari-export-options-developerid.plist）。
#
# 注意：
#   converter 預設 host App Bundle ID 推導用 app-name reverse-DNS（會給
#   `app.jread.JRead`），違反「Extension Bundle ID 必須以 host 為 prefix」
#   的命名慣例。bootstrap 跑完要手動把 project.pbxproj 內的兩處
#   PRODUCT_BUNDLE_IDENTIFIER 改成 `app.jread.macos`（Debug + Release 共兩處）。
#
# 用法：
#   ./safari-app/safari-bootstrap.sh
#
# 需求：
#   - macOS + Xcode 15+
#   - jread/manifest.json 存在
#
# 輸出：
#   safari-app/JRead/JRead.xcodeproj 與相關目錄結構

set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f "jread/manifest.json" ]; then
  echo "ERROR: jread/manifest.json not found." >&2
  exit 1
fi

if [ -d "safari-app/JRead" ]; then
  echo "WARN: safari-app/JRead/ 已存在，會被覆蓋。"
  echo "      請確認 host App 檔案（JReadApp.swift / ContentView.swift 等）已備份。"
  echo ""
  read -p "      按 Enter 繼續，Ctrl+C 中止... " _ignore
  rm -rf safari-app/JRead
fi

echo "==> Running xcrun safari-web-extension-converter..."
xcrun safari-web-extension-converter jread/ \
  --project-location safari-app/ \
  --bundle-identifier app.jread.macos \
  --app-name "JRead" \
  --swift \
  --macos-only \
  --copy-resources \
  --no-prompt \
  --no-open

echo ""
echo "Done。接下來："
echo "  1. 修 project.pbxproj 內兩處 PRODUCT_BUNDLE_IDENTIFIER："
echo "     converter 預設給 host App \`app.jread.JRead\`（用 app-name 推），"
echo "     要改成 \`app.jread.macos\`（Debug + Release 共兩處）。"
echo "  2. 把備份的 host App 檔（JReadApp.swift / ContentView.swift）複製回"
echo "     safari-app/JRead/JRead/"
echo "  3. 在 Xcode 開啟 safari-app/JRead/JRead.xcodeproj："
echo "     - 右鍵 JRead group → Add Files to project → 加入 SwiftUI 檔"
echo "     - Project navigator 刪 AppDelegate.swift / ViewController.swift /"
echo "       Base.lproj/Main.storyboard / Resources/{Main.html,Script.js,Style.css,Icon.png}"
echo "     - Target JRead → Build Settings → 移除 INFOPLIST_KEY_NSMainStoryboardFile"
echo "     - Target JRead → Signing & Capabilities → Team = PR6NG3PH45"
echo "  4. 跑 ./safari-app/safari-build.sh 驗 archive + notarize + staple 流程"
