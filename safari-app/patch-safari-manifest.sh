#!/usr/bin/env bash
# patch-safari-manifest.sh — Safari build 的 manifest background patch + 受控差異驗證
#（由 iOS ios-build.sh 呼叫）
#
# 為什麼存在（v0.7.228）：
#   iOS Safari 的 MV3 background **service worker 被系統回收後不再喚醒**
#   （Apple Developer Forums thread 758346；iOS 17.4 起、迄今未修）。
#   SW 死後 content script / popup 的 runtime 訊息石沉大海且叫不醒它，使用者
#   只能強制關閉 Safari 重建 extension 程序自救——「用一段時間後 3 指 / popup
#   失效」的根因。Safari 對 non-persistent event page 的生命週期管理正常：
#   卸載後下一個事件會重新喚起。
#
#   因此 Safari build 的 Resources/manifest.json 把 background 從
#   service_worker 改宣告成 event page。Chrome 版 manifest（jread/）維持
#   service_worker 不動——單一真實來源 + 唯一一處受控差異（本 script 是該差異
#   的唯一產生者與驗證者）。
#
# 為什麼是 page 而不是 scripts（v1.9.4）：
#   v0.7.228–v1.9.3 用 { scripts: [四檔], persistent: false }。iOS 26 的 Safari
#   對這種形式的 event page **完全不載入**——擴充的 BackgroundContentEventListeners
#   註冊表（State.plist）永遠是空的、background 從不啟動，content → background 的
#   runtime.sendMessage 全部 resolve undefined（懸浮按鈕「功能選單」/「進入
#   Reader」/ keepalive 全滅；Jimmy 2026-09-08 iPad 回報）。iPad 模擬器 iOS 26.5
#   A/B：scripts（含 / 不含 persistent）皆死，service_worker 與 page 皆活。
#   page 形式仍是 non-persistent event page（保留 758346 對策），故改成
#   { page: "background/background.html", persistent: false }。
#   background/background.html 住在 jread/（Chrome 不引用、rsync 同步進
#   Resources，不影響 drift check），<script> 順序 = 依賴檔在前、SW 最後，
#   與 tools/firefox-build.sh 的 background.scripts 清單同列同序
#   （ios-build.spec.js 有 forcing function 比對）。
#
# 用法：patch-safari-manifest.sh <Extension Resources 目錄>
#   1) patch（冪等）：background = { page: background/background.html, persistent: false }；
#      其餘欄位保留
#   2) verify：除 background 外必須與 jread/manifest.json 完全一致
#      （jq -S 正規化比對）——build script 的 drift check 以 -x manifest.json
#      排除本檔案後，由這條驗證補上 manifest 的受控差異檢查；
#      另驗 background.html 存在且 <script src> 清單 == 預期四檔順序
#      （event page 是網頁 context 沒有 importScripts，SW 內的 typeof guard 會靜默
#      跳過——清單漏列任一檔會讓對應 global undefined，manifest 快速鍵 dispatch /
#      Readwise 快速鍵 / GET_SETTINGS 在 Safari 直接 TypeError；v0.7.229 教訓）
set -euo pipefail

RES_DIR="${1:?用法: patch-safari-manifest.sh <Extension Resources 目錄>}"
SRC_MANIFEST="jread/manifest.json"
DST_MANIFEST="$RES_DIR/manifest.json"

if [ ! -f "$SRC_MANIFEST" ]; then
  echo "ERROR: $SRC_MANIFEST 不存在（必須從 repo root 執行）" >&2
  exit 1
fi
if [ ! -f "$DST_MANIFEST" ]; then
  echo "ERROR: $DST_MANIFEST 不存在（先 rsync 再 patch）" >&2
  exit 1
fi

SW_FILE=$(jq -r '.background.service_worker' "$SRC_MANIFEST")
if [ -z "$SW_FILE" ] || [ "$SW_FILE" = "null" ]; then
  echo "ERROR: $SRC_MANIFEST 讀不到 background.service_worker" >&2
  exit 1
fi

# event page 入口 + 預期 <script> 清單（與 tools/firefox-build.sh 的 jq 改寫同列同序；
# 雙處硬寫，ios-build.spec.js 有 forcing function 比對兩邊一致防 drift）
BG_PAGE="background/background.html"
LOGGER="lib/logger.js"
POPUP_CORE="popup/popup-core.js"
SETTINGS_DEFAULTS="content/settings-defaults.js"
for DEP in "$BG_PAGE" "$LOGGER" "$POPUP_CORE" "$SETTINGS_DEFAULTS" "$SW_FILE"; do
  if [ ! -f "$RES_DIR/$DEP" ]; then
    echo "ERROR: $RES_DIR/$DEP 不存在（event page 入口 / 預載依賴）" >&2
    exit 1
  fi
done

# verify 0：background.html 的 <script src> 清單（相對 background/ 目錄解析）必須
# 等於 [logger, popup-core, settings-defaults, SW] 且依此順序
EXPECTED_SCRIPTS="$LOGGER
$POPUP_CORE
$SETTINGS_DEFAULTS
$SW_FILE"
ACTUAL_SCRIPTS=$(grep -o '<script src="[^"]*"' "$RES_DIR/$BG_PAGE" \
  | sed -E 's/<script src="//; s/"$//' \
  | sed -E 's#^\.\./##; s#^([^/]+\.js)$#background/\1#')
if [ "$ACTUAL_SCRIPTS" != "$EXPECTED_SCRIPTS" ]; then
  echo "ERROR: $BG_PAGE 的 <script> 清單不是預期四檔順序：" >&2
  echo "expected:" >&2; echo "$EXPECTED_SCRIPTS" >&2
  echo "actual:" >&2; echo "$ACTUAL_SCRIPTS" >&2
  exit 1
fi

# patch（冪等：已是 event page 形式就重打一次，jq 冪等安全）
TMP="$DST_MANIFEST.tmp"
jq --arg pg "$BG_PAGE" \
  '.background = { page: $pg, persistent: false }' \
  "$DST_MANIFEST" > "$TMP"
mv "$TMP" "$DST_MANIFEST"

# verify 1：除 background 外與 source 完全一致
SRC_REST=$(jq -S 'del(.background)' "$SRC_MANIFEST")
DST_REST=$(jq -S 'del(.background)' "$DST_MANIFEST")
if [ "$SRC_REST" != "$DST_REST" ]; then
  echo "ERROR: Safari manifest 與 source 在 background 以外出現 drift：" >&2
  diff <(echo "$SRC_REST") <(echo "$DST_REST") >&2 || true
  exit 1
fi

# verify 2：background 必須是預期 event page（page）形式，不可殘留 service_worker / scripts
BG_OK=$(jq -r --arg pg "$BG_PAGE" \
  '(.background.page == $pg) and (.background.persistent == false) and (.background | has("service_worker") | not) and (.background | has("scripts") | not)' \
  "$DST_MANIFEST")
if [ "$BG_OK" != "true" ]; then
  echo "ERROR: Safari manifest background 不是預期 event page 形式：" >&2
  jq '.background' "$DST_MANIFEST" >&2
  exit 1
fi

echo "Safari manifest patched: background = event page（page: $BG_PAGE, persistent: false；scripts: [$LOGGER, $POPUP_CORE, $SETTINGS_DEFAULTS, $SW_FILE]）"
