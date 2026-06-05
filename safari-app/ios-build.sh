#!/usr/bin/env bash
# ios-build.sh — Build & upload iOS Safari Web Extension（TestFlight 軌）
#
# 用途：
#   把 jread/ 同步進 iOS project Resources/、bump pbxproj 版本、archive、
#   export .ipa、altool 上傳 App Store Connect（→ TestFlight）。
#
#   手動觸發、不綁 release.sh——iOS 走 TestFlight / App Store 節奏，
#   與 Chrome / macOS 每版即發解耦。要發 iOS 時人工跑：
#     ./safari-app/ios-build.sh
#   只想本機產 .ipa 不上傳：
#     SKIP_UPLOAD=1 ./safari-app/ios-build.sh
#
# 需求：
#   - macOS + Xcode 26+、jq 1.6+
#   - safari-app/JRead-iOS/JRead.xcodeproj 已存在（無則先跑 ios-bootstrap.sh）
#   - ASC API key：~/.zshrc 的 ASC_KEY_ID / ASC_ISSUER_ID / ASC_PRIVATE_KEY_PATH
#     （與 Shinkansen 共用同一把 592WJH7U2F；script 內建 fallback 預設值）
#   - ASC 上 app record（bundle ID app.jread.ios）已建立（首次見 SPEC.md iOS 章節）
#
# 簽章（manual）：
#   team 沒有註冊任何 iOS 裝置，automatic signing 在 archive 階段會堅持產
#   development profile 而失敗（「Your team has no devices」）。改走 manual：
#   Apple Distribution 憑證 + IOS_APP_STORE profiles（不需要裝置清單）由
#   tools/asc-provision-ios.js 透過 ASC API 建立並裝進 Keychain / 本機。
#   憑證一年到期重跑該 script 換發即可。Release config 的 manual signing
#   設定在 pbxproj 內（Debug 維持 automatic，simulator build 不受影響）。
#
# Source drift forcing function：
#   結束前 diff -r jread/ Resources/，non-empty 視為 drift，中止。
#
# CFBundleVersion 注意：
#   MARKETING_VERSION 與 CURRENT_PROJECT_VERSION 都用 manifest version。
#   JRead 每改必 bump（三段式遞增），同版本號重傳 ASC 會被拒——重傳前先 bump。

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_DIR="safari-app/JRead-iOS"
PROJECT_FILE="$PROJECT_DIR/JRead.xcodeproj"
PBXPROJ="$PROJECT_FILE/project.pbxproj"
EXTENSION_RESOURCES="$PROJECT_DIR/JRead Extension/Resources"
EXPORT_OPTS="safari-app/ios-export-options.plist"
# BUILD_DIR 用 $TMPDIR：repo 在 ~/Documents/（iCloud Drive 同步範圍）內，
# xcodebuild signed bundle 寫進 repo 內目錄會被 iCloud fileprovider 接管成
# root:wheel ownership 清不掉（Shinkansen v1.9.26 同根因教訓）。
BUILD_DIR="${TMPDIR%/}/jread-ios-build"

# ASC API key（與 Shinkansen 共用；env 可覆寫）
ASC_KEY_ID="${ASC_KEY_ID:-592WJH7U2F}"
ASC_ISSUER_ID="${ASC_ISSUER_ID:-e9b64046-86e6-42a0-b8b6-74e33e91f7f0}"
ASC_PRIVATE_KEY_PATH="${ASC_PRIVATE_KEY_PATH:-$HOME/.appstoreconnect/AuthKey_${ASC_KEY_ID}.p8}"

if [ ! -f "jread/manifest.json" ]; then
  echo "ERROR: jread/manifest.json not found." >&2
  exit 1
fi
if [ ! -d "$PROJECT_FILE" ]; then
  echo "ERROR: $PROJECT_FILE 不存在。請先跑 ./safari-app/ios-bootstrap.sh" >&2
  exit 1
fi
if [ ! -f "$ASC_PRIVATE_KEY_PATH" ]; then
  echo "ERROR: ASC API key 不存在：$ASC_PRIVATE_KEY_PATH" >&2
  exit 1
fi

VERSION=$(jq -r '.version' jread/manifest.json)
if [ -z "$VERSION" ] || [ "$VERSION" = "null" ]; then
  echo "ERROR: 無法從 manifest 讀 version。" >&2
  exit 1
fi
echo "Building iOS Safari Extension for version: ${VERSION}（TestFlight 軌）"

# 1. 同步 jread/ → Resources/（--delete 移除已不存在舊檔）
echo "==> Sync extension Resources..."
mkdir -p "$EXTENSION_RESOURCES"
rsync -a --delete jread/ "$EXTENSION_RESOURCES/"

# 2. 版本號同步進 pbxproj
echo "==> Sync version to project.pbxproj..."
sed -i '' -E "s/MARKETING_VERSION = [^;]+;/MARKETING_VERSION = ${VERSION};/g" "$PBXPROJ"
sed -i '' -E "s/CURRENT_PROJECT_VERSION = [^;]+;/CURRENT_PROJECT_VERSION = ${VERSION};/g" "$PBXPROJ"

# 3. archive（manual signing，profile 缺失時先跑 tools/asc-provision-ios.js）
echo "==> xcodebuild archive（iOS device, manual signing: Apple Distribution）..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
xcodebuild -project "$PROJECT_FILE" \
  -scheme JRead \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$BUILD_DIR/JRead.xcarchive" \
  archive

# 4. exportArchive → .ipa
echo "==> Export .ipa..."
xcodebuild -exportArchive \
  -archivePath "$BUILD_DIR/JRead.xcarchive" \
  -exportPath "$BUILD_DIR/ios-export" \
  -exportOptionsPlist "$EXPORT_OPTS"

IPA="$BUILD_DIR/ios-export/JRead.ipa"
if [ ! -f "$IPA" ]; then
  echo "ERROR: export 後找不到 $IPA" >&2
  ls "$BUILD_DIR/ios-export/" >&2
  exit 1
fi

# 5. Source drift forcing function
echo "==> Source drift check..."
DRIFT=$(diff -r --brief jread/ "$EXTENSION_RESOURCES/" 2>&1 || true)
if [ -n "$DRIFT" ]; then
  echo "ERROR: source drift between jread/ and Resources/:" >&2
  echo "$DRIFT" >&2
  exit 1
fi

# 6. 上傳 App Store Connect（→ TestFlight 處理 5-30 分鐘後可裝）
if [ "${SKIP_UPLOAD:-0}" = "1" ]; then
  echo ""
  echo "SKIP_UPLOAD=1：跳過上傳。.ipa 在 $IPA"
  exit 0
fi
echo "==> altool --validate-app..."
xcrun altool --validate-app -f "$IPA" -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
echo "==> altool --upload-app..."
xcrun altool --upload-app -f "$IPA" -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo ""
echo "Done：v${VERSION} 已上傳 App Store Connect。"
echo "ASC 處理（5-30 分鐘）後在 TestFlight 內部測試群組可裝。"
