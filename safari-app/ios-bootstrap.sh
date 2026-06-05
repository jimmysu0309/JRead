#!/usr/bin/env bash
# ios-bootstrap.sh — Bootstrap or recreate the iOS Xcode project
#
# 用途：
#   一次性 — 用 xcrun safari-web-extension-converter 從 jread/ 產出
#   iOS-only Xcode project 進 safari-app/JRead-iOS/。Xcode 大版本升級或
#   default project 結構改變時可重跑（會覆蓋 safari-app/JRead-iOS/），
#   平常開發 / TestFlight 上傳不要跑。
#
# 警告：
#   會覆蓋 safari-app/JRead-iOS/（包含 host App 的 Swift / storyboard /
#   Info.plist 客製）。重跑前手動備份，完成後再 patch 回去。
#
# 與 macOS 軌（safari-bootstrap.sh → safari-app/JRead/）完全獨立：
#   兩個 Xcode project 各自存在，extension code 都由 build script rsync
#   自 jread/ 單一真實來源，不雙頭維護。
#
# bootstrap 後自動 patch（本 script 已內建，重跑不用手動做）：
#   1. host App PRODUCT_BUNDLE_IDENTIFIER：converter 會給 `app.jread.JRead`
#      （app-name reverse-DNS 推導的老毛病），改成 `app.jread.ios`
#      （Extension 為 `app.jread.ios.Extension`，host 必須是其 prefix）
#   2. 四處 build settings 補 `DEVELOPMENT_TEAM = PR6NG3PH45`
#   3. host App Info.plist 加 `ITSAppUsesNonExemptEncryption = NO`
#      （只用 HTTPS，免出口合規問卷，TestFlight build 上傳後即可測）
#
# 用法：
#   ./safari-app/ios-bootstrap.sh
#
# 需求：
#   - macOS + Xcode 26+
#   - jread/manifest.json 存在
#
# 輸出：
#   safari-app/JRead-iOS/JRead.xcodeproj 與相關目錄結構

set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f "jread/manifest.json" ]; then
  echo "ERROR: jread/manifest.json not found." >&2
  exit 1
fi

if [ -d "safari-app/JRead-iOS" ]; then
  echo "WARN: safari-app/JRead-iOS/ 已存在，會被覆蓋。"
  echo "      請確認 host App 客製（Swift / storyboard / Info.plist）已備份。"
  echo ""
  read -p "      按 Enter 繼續，Ctrl+C 中止... " _ignore
  rm -rf safari-app/JRead-iOS
fi

echo "==> Running xcrun safari-web-extension-converter (iOS)..."
xcrun safari-web-extension-converter jread/ \
  --project-location safari-app/JRead-iOS-staging/ \
  --bundle-identifier app.jread.ios \
  --app-name "JRead" \
  --swift \
  --ios-only \
  --copy-resources \
  --no-prompt \
  --no-open

mv safari-app/JRead-iOS-staging/JRead safari-app/JRead-iOS
rmdir safari-app/JRead-iOS-staging

PBXPROJ="safari-app/JRead-iOS/JRead.xcodeproj/project.pbxproj"

echo "==> Patch host App bundle ID（app.jread.JRead → app.jread.ios）..."
sed -i '' 's/PRODUCT_BUNDLE_IDENTIFIER = app\.jread\.JRead;/PRODUCT_BUNDLE_IDENTIFIER = app.jread.ios;/g' "$PBXPROJ"

echo "==> Patch DEVELOPMENT_TEAM（4 處 build settings）..."
sed -i '' 's/CODE_SIGN_STYLE = Automatic;/CODE_SIGN_STYLE = Automatic;\
				DEVELOPMENT_TEAM = PR6NG3PH45;/g' "$PBXPROJ"

echo "==> Patch ITSAppUsesNonExemptEncryption = NO..."
plutil -insert ITSAppUsesNonExemptEncryption -bool NO safari-app/JRead-iOS/JRead/Info.plist

echo ""
echo "Done。接下來："
echo "  1. 驗證編譯：xcodebuild -project $PBXPROJ -scheme JRead \\"
echo "       -destination 'platform=iOS Simulator,name=iPad Pro 11-inch (M5)' build"
echo "  2. TestFlight 上傳：./safari-app/ios-build.sh"
