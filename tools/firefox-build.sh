#!/usr/bin/env bash
# firefox-build.sh — 從 source 重建 Firefox sideload ZIP
#
# 用途：Mozilla AMO reviewer 透過此 script 從 source.zip 重建出
# 與 release 上 `jread-firefox-vX.Y.Z.zip` 完全一致的產物。
#
# 用法：
#   chmod +x firefox-build.sh
#   ./firefox-build.sh
#
# 需求：
#   - bash 3.2+
#   - jq 1.6+（用來 patch manifest.json，沒做 minify / bundle / transpile）
#   - zip
#   各 OS 安裝：
#     macOS：   brew install jq
#     Ubuntu：  sudo apt-get install jq
#     Windows： winget install jqlang.jq
#
# 輸出：
#   jread-firefox-v<version>.zip（其中 <version> 從 manifest.json 讀出）
#
# 為什麼需要 jq 改寫 manifest：
#   - Chrome MV3 拒絕 `background.scripts` 鍵（MV2 才合法）
#   - Firefox 不支援 `background.service_worker` 鍵
#   - 兩邊規則互斥，無法共用同一份 manifest
#   - Repo 內 `jread/manifest.json` 永遠對應 Chrome 版（只有 service_worker）
#   - 此 script 把 service_worker 換成 scripts、加 strict_min_version，生成 Firefox 版
#
# 為什麼 scripts 陣列裡有三個檔案（順序重要；v0.7.235 加 settings-defaults）：
#   - JRead 的 service-worker.js 依賴 popup-core.js（注入 fallback 邏輯）與
#     content/settings-defaults.js（DEFAULT_SETTINGS 單一資料源）
#   - Chrome MV3 SW context 用 importScripts 預載
#   - Firefox event page 沒有 importScripts，改由 manifest scripts 陣列依序 load
#   - 順序必須是 [popup/popup-core.js, content/settings-defaults.js,
#     background/service-worker.js]——依賴檔先載，service-worker 才看得到全域變數
#
# 驗證重建一致性（reviewer 用）：
#   1. ./firefox-build.sh
#   2. unzip -p jread-firefox-<v>.zip manifest.json | jq .
#   3. 檢查 background 應是 {"scripts": ["lib/logger.js", "popup/popup-core.js", "content/settings-defaults.js", "background/service-worker.js"]}
#   4. 檢查 browser_specific_settings.gecko.strict_min_version 應是 "128.0"

set -euo pipefail

cd "$(dirname "$0")/.."

# 確認在 source.zip 解壓後的根目錄執行（應該看得到 jread/manifest.json）
if [ ! -f "jread/manifest.json" ]; then
  echo "ERROR: jread/manifest.json not found." >&2
  echo "Please run this script from the source.zip root directory." >&2
  exit 1
fi

# 從 manifest 讀版本號
VERSION=$(jq -r '.version' jread/manifest.json)
if [ -z "$VERSION" ] || [ "$VERSION" = "null" ]; then
  echo "ERROR: Could not read version from jread/manifest.json" >&2
  exit 1
fi
echo "Building Firefox ZIP for version: $VERSION"

# 清掉舊的 build artifacts
rm -rf firefox-build
rm -f "jread-firefox-v${VERSION}.zip"

# 1. 複製整個 jread/ 內容到 firefox-build/（內容物展平，不保留 jread/ 那層）
mkdir -p firefox-build
cp -r jread/* firefox-build/

# 2. 用 jq 程式化改寫 manifest：
#    - background：刪掉 service_worker，改用 scripts（四個檔，依賴檔在前、SW 最後）
#    - browser_specific_settings.gecko：加上 strict_min_version: "128.0"
#    - browser_specific_settings.gecko：加上 data_collection_permissions: { required: ["none"] }
#      （Mozilla 2025 起的隱私 consent UI 規則，JRead 不收集任何使用者資料，僅本地
#       呼叫使用者自填的 Readwise Reader API。）
#    這是唯一的 build transformation。沒有 minify、bundle、transpile。
jq '.background = {"scripts": ["lib/logger.js", "popup/popup-core.js", "content/settings-defaults.js", "background/service-worker.js"]} |
    .browser_specific_settings.gecko.strict_min_version = "128.0" |
    .browser_specific_settings.gecko.data_collection_permissions = {"required": ["none"]}' \
    jread/manifest.json > firefox-build/manifest.json

# 3. 打包成 ZIP（內容物在 ZIP 根目錄，沒包 firefox-build/ 那層）
cd firefox-build
zip -r "../jread-firefox-v${VERSION}.zip" .
cd ..

# 4. 清理暫存
rm -rf firefox-build

echo ""
echo "Done: jread-firefox-v${VERSION}.zip"
echo ""
echo "Verify manifest:"
unzip -p "jread-firefox-v${VERSION}.zip" manifest.json | jq '{version, background, browser_specific_settings}'
