#!/usr/bin/env bash
# safari-build.sh — Build & notarize Developer ID Safari Extension
#
# 用途：
#   產 Developer ID 簽名 + Apple 公證 + stapled 的 .pkg，給 GitHub Releases
#   公開下載手動安裝用（雙擊 Gatekeeper 認帳）。
#
#   產出：safari-app/jread-macos-v<version>.pkg
#   發布：gh release upload v<version> safari-app/jread-macos-v<version>.pkg
#
# 通常不必手動跑 — `./release.sh` 內已自動呼叫本 script，會 build +
# notarize + 上傳到 GitHub Release。本 script 保留獨立可呼叫，給「release.sh
# 中段出錯後手動補 Developer ID .pkg」這類情境用。
#
# 注意：
#   notarize 等 Apple cloud 時間不固定（實測過 27 秒；Apple 文件聲稱可達
#   30-60 分鐘）。怕等就 SKIP_SAFARI=1 走純 Chrome / Firefox 路。
#
# 用法：
#   ./safari-app/safari-build.sh
#
# 環境變數：
#   NOTARY_PROFILE — notarytool keychain profile 名稱（預設 shinkansen-notary，
#                    沿用 Shinkansen 已設好的 profile；同個 Apple Developer Team
#                    底下的 credentials 通用，profile 名稱只是 Keychain key）
#
# 一次性前置（三步，缺則本 script 開頭 check 失敗會印 step-by-step）：
#   - Developer ID Application cert（Apple Developer Portal 申請 + Keychain 裝）
#   - Developer ID Installer cert（同上）
#   - notarytool keychain profile（xcrun notarytool store-credentials）

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_DIR="safari-app/JRead"
PROJECT_FILE="$PROJECT_DIR/JRead.xcodeproj"
PBXPROJ="$PROJECT_FILE/project.pbxproj"
EXTENSION_RESOURCES="$PROJECT_DIR/JRead Extension/Resources"
EXPORT_OPTS_DEVID="safari-app/safari-export-options-developerid.plist"
# BUILD_DIR 故意放 $TMPDIR 不放 safari-app/build——避開 iCloud Drive fileprovider 互動。
# ~/Documents/Claude/Projects/JRead/ 屬於 iCloud Drive 同步範圍，xcodebuild 產出 signed
# .app bundle 進 build/ 後會被 fileprovider 接管，bundle 內所有檔案 chown 成 root，
# 連 sudo 都不一定能 rm（v0.7.138 release 流程實機踩過）。$TMPDIR 是 macOS per-user
# tmpdir（/var/folders/xx/.../T/），不在 iCloud 同步路徑，重開機系統會清。
BUILD_DIR="${TMPDIR:-/tmp/}jread-safari-build"
NOTARY_PROFILE="${NOTARY_PROFILE:-shinkansen-notary}"
DEVID_INSTALLER_CERT="Developer ID Installer: Zhimin Su (PR6NG3PH45)"

if [ ! -f "jread/manifest.json" ]; then
  echo "ERROR: jread/manifest.json not found." >&2
  exit 1
fi
if [ ! -d "$PROJECT_FILE" ]; then
  echo "ERROR: $PROJECT_FILE 不存在；先跑 ./safari-app/safari-bootstrap.sh。" >&2
  exit 1
fi
if [ ! -f "$EXPORT_OPTS_DEVID" ]; then
  echo "ERROR: $EXPORT_OPTS_DEVID 不存在。" >&2
  exit 1
fi

# 前置 check：三項缺哪項就印對應安裝指引
echo "==> 前置 check（Developer ID cert + notarytool profile）..."
MISSING=""
if ! security find-identity -p codesigning -v 2>/dev/null | grep -q "Developer ID Application: Zhimin Su (PR6NG3PH45)"; then
  MISSING="${MISSING}A"
fi
if ! security find-identity -v 2>/dev/null | grep -q "Developer ID Installer: Zhimin Su (PR6NG3PH45)"; then
  MISSING="${MISSING}I"
fi
if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" &>/dev/null; then
  MISSING="${MISSING}N"
fi

if [ -n "$MISSING" ]; then
  echo "" >&2
  echo "ERROR: 前置不全，以下項目缺失：" >&2
  [[ "$MISSING" == *A* ]] && echo "  ✗ Developer ID Application cert（Keychain）" >&2
  [[ "$MISSING" == *I* ]] && echo "  ✗ Developer ID Installer cert（Keychain）" >&2
  [[ "$MISSING" == *N* ]] && echo "  ✗ notarytool keychain profile '$NOTARY_PROFILE'" >&2
  echo "" >&2
  echo "一次性設定：" >&2
  if [[ "$MISSING" == *A* ]] || [[ "$MISSING" == *I* ]]; then
    echo "  [1] 申請 Developer ID 兩張 cert（Apple Developer Portal）：" >&2
    echo "      https://developer.apple.com/account/resources/certificates → +" >&2
    echo "      選 Developer ID Application + Software 子類型，上傳 CSR，下載 .cer 雙擊裝" >&2
    echo "      重複一次，改選 Developer ID Installer（每張 cert 要用各自獨立的 CSR）" >&2
  fi
  if [[ "$MISSING" == *N* ]]; then
    echo "  [2] notarytool keychain profile：" >&2
    echo "      到 https://appleid.apple.com「登入與安全性」→「App 專用密碼」產一支" >&2
    echo "      跑：" >&2
    echo "        xcrun notarytool store-credentials $NOTARY_PROFILE \\" >&2
    echo "          --apple-id 'jimmy.zm.su@gmail.com' \\" >&2
    echo "          --team-id 'PR6NG3PH45' \\" >&2
    echo "          --password '<上面那支 app-specific password>'" >&2
  fi
  exit 1
fi
echo "    ✓ Developer ID Application cert"
echo "    ✓ Developer ID Installer cert"
echo "    ✓ notarytool keychain profile '$NOTARY_PROFILE'"

VERSION=$(jq -r '.version' jread/manifest.json)
if [ -z "$VERSION" ] || [ "$VERSION" = "null" ]; then
  echo "ERROR: 無法從 manifest 讀 version。" >&2
  exit 1
fi
echo ""
echo "Building Developer ID notarized .pkg for version: $VERSION"
echo "（notarize 步驟等 Apple cloud，預估 ~30-60 分鐘，可背景跑）"

# 1. 同步 jread/ → Resources/（--delete 移除已不存在舊檔）
echo "==> Sync extension Resources..."
mkdir -p "$EXTENSION_RESOURCES"
rsync -a --delete jread/ "$EXTENSION_RESOURCES/"

# 1.5 Safari manifest patch（v0.7.228）：background service worker → event page。
#     iOS Safari 的 MV3 SW 被系統回收後不再喚醒（Apple Forums thread 758346）；
#     macOS Safari 雖未觀察到同等死透行為，但 event page 是 Apple 文件偏好的
#     background 形式、兩平台統一宣告避免 lifecycle 差異。
#     詳見 safari-app/patch-safari-manifest.sh（macOS / iOS build 共用）。
echo "==> Patch Safari manifest（background → event page）..."
bash safari-app/patch-safari-manifest.sh "$EXTENSION_RESOURCES"

# 2. 版本號同步進 pbxproj
echo "==> Sync version to project.pbxproj..."
sed -i '' -E "s/MARKETING_VERSION = [^;]+;/MARKETING_VERSION = ${VERSION};/g" "$PBXPROJ"
sed -i '' -E "s/CURRENT_PROJECT_VERSION = [^;]+;/CURRENT_PROJECT_VERSION = ${VERSION};/g" "$PBXPROJ"

# 3. clean + archive
echo "==> xcodebuild clean..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
xcodebuild -project "$PROJECT_FILE" \
  -scheme JRead \
  -configuration Release \
  clean

echo "==> xcodebuild archive..."
xcodebuild -project "$PROJECT_FILE" \
  -scheme JRead \
  -configuration Release \
  -archivePath "$BUILD_DIR/JRead.xcarchive" \
  archive

# 4. exportArchive Developer ID → .app（注意：此 method 不產 .pkg，只產 .app）
echo "==> Export Developer ID .app..."
xcodebuild -exportArchive \
  -archivePath "$BUILD_DIR/JRead.xcarchive" \
  -exportPath "$BUILD_DIR/safari-export-developerid" \
  -exportOptionsPlist "$EXPORT_OPTS_DEVID"

DEVID_APP="$BUILD_DIR/safari-export-developerid/JRead.app"
if [ ! -d "$DEVID_APP" ]; then
  echo "ERROR: $DEVID_APP 不存在，Developer ID export 失敗。" >&2
  exit 1
fi

# 4.5 清掉舊版 .pkg（每次 bump 只留本次版本，避免 safari-app/ 累積一堆歷史 .pkg）
DEVID_PKG="safari-app/jread-macos-v${VERSION}.pkg"
echo "==> 清除舊版 .pkg（保留本次 v${VERSION}）..."
for old in safari-app/jread-macos-v*.pkg; do
  # glob 沒命中時 $old 會是字面 pattern，-e 檢查擋掉
  [ -e "$old" ] || continue
  if [ "$old" != "$DEVID_PKG" ]; then
    echo "    rm $old"
    rm -f "$old"
  fi
done

# 5. productbuild 把 .app 包進 installer .pkg + Developer ID Installer cert 簽
echo "==> productbuild Developer ID .pkg（install 到 /Applications，Installer cert 簽）..."
productbuild \
  --component "$DEVID_APP" /Applications \
  --sign "$DEVID_INSTALLER_CERT" \
  "$DEVID_PKG"

# 6. notarize submit --wait（這步動輒 ~30-60 分鐘）
echo "==> Submit to Apple notarization service（等 Apple cloud）..."
echo "    Start: $(date +%H:%M:%S)"
xcrun notarytool submit "$DEVID_PKG" \
  --keychain-profile "$NOTARY_PROFILE" \
  --wait
echo "    End:   $(date +%H:%M:%S)"

# 7. staple notarization ticket 進 pkg（離線可驗）
echo "==> Staple 公證 ticket 進 .pkg..."
xcrun stapler staple "$DEVID_PKG"

# 8. 驗證 stapled ticket + Gatekeeper 模擬
echo "==> 驗證..."
xcrun stapler validate "$DEVID_PKG"
spctl -a -t install -vv "$DEVID_PKG" 2>&1 | head -5

# 9. Source drift forcing function
#    manifest.json 是唯一受控差異（event page patch）——diff 以 -x 排除後，
#    交由 patch-safari-manifest.sh（冪等）重跑 verify 補上 manifest 檢查。
echo "==> Source drift check..."
DRIFT=$(diff -r --brief -x manifest.json jread/ "$EXTENSION_RESOURCES/" 2>&1 || true)
if [ -n "$DRIFT" ]; then
  echo "ERROR: source drift between jread/ and Resources/:" >&2
  echo "$DRIFT" >&2
  exit 1
fi
bash safari-app/patch-safari-manifest.sh "$EXTENSION_RESOURCES"

echo ""
echo "Done: ${DEVID_PKG}（已 notarize + stapled）"
echo ""
echo "發布到 GitHub Release（假設 v${VERSION} tag 已存在）："
echo "  gh release upload v${VERSION} ${DEVID_PKG}"
