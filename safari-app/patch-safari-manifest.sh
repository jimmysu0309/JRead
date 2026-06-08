#!/usr/bin/env bash
# patch-safari-manifest.sh — Safari build 的 manifest background patch + 受控差異驗證
#（由 iOS ios-build.sh 呼叫；event page scripts 清單與 tools/firefox-build.sh 同列同序）
#
# 為什麼存在（v0.7.228）：
#   iOS Safari 的 MV3 background **service worker 被系統回收後不再喚醒**
#   （Apple Developer Forums thread 758346；iOS 17.4 起、迄今 18.6.x 未修）。
#   SW 死後 content script / popup 的 runtime 訊息石沉大海且叫不醒它，使用者
#   只能強制關閉 Safari 重建 extension 程序自救——「用一段時間後 3 指 / popup
#   失效」的根因。Safari 對 background.scripts（non-persistent event page）的
#   生命週期管理正常：卸載後下一個事件會重新喚起。
#
#   因此 Safari build 的 Resources/manifest.json 把 background 從
#   service_worker 改宣告成 event page（scripts + persistent: false）。
#   Chrome 版 manifest（jread/）維持 service_worker 不動——單一真實來源 +
#   唯一一處受控差異（本 script 是該差異的唯一產生者與驗證者）。
#
# 用法：patch-safari-manifest.sh <Extension Resources 目錄>
#   1) patch（冪等）：background = { scripts: [popup/popup-core.js,
#      background/service-worker.js], persistent: false }；其餘欄位保留
#   2) verify：除 background 外必須與 jread/manifest.json 完全一致
#      （jq -S 正規化比對）——build script 的 drift check 以 -x manifest.json
#      排除本檔案後，由這條驗證補上 manifest 的受控差異檢查
#
# scripts 為什麼是三個檔（v0.7.229 修正、v0.7.235 加 settings-defaults，與
# tools/firefox-build.sh 同列同序）：
#   service-worker.js 依賴 popup-core.js 的 __JReadPopup（sendWithInjectionFallback
#   等）與 content/settings-defaults.js 的 __JReadSettingsDefaults（DEFAULT_SETTINGS
#   單一資料源），Chrome SW context 用 importScripts 預載；event page 是網頁
#   context **沒有 importScripts**（SW 內的 typeof guard 會靜默跳過）——清單
#   漏列任一檔會讓對應 global undefined，manifest 快速鍵 dispatch / Readwise
#   快速鍵 / GET_SETTINGS 在 Safari 直接 TypeError。順序必須依賴檔在前、
#   service-worker.js 最後。
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

# scripts 清單與 tools/firefox-build.sh 的 jq 改寫同列同序（雙處硬寫，
# ios-build.spec.js 有 forcing function 比對兩邊一致防 drift）
POPUP_CORE="popup/popup-core.js"
SETTINGS_DEFAULTS="content/settings-defaults.js"
for DEP in "$POPUP_CORE" "$SETTINGS_DEFAULTS"; do
  if [ ! -f "$RES_DIR/$DEP" ]; then
    echo "ERROR: $RES_DIR/$DEP 不存在（scripts 預載依賴）" >&2
    exit 1
  fi
done

# patch（冪等：已是 event page 形式就重打一次確保清單最新，jq 冪等安全）
TMP="$DST_MANIFEST.tmp"
jq --arg sw "$SW_FILE" --arg pc "$POPUP_CORE" --arg sd "$SETTINGS_DEFAULTS" \
  '.background = { scripts: [$pc, $sd, $sw], persistent: false }' \
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

# verify 2：background 必須是預期 event page 形式（依賴檔在前、SW 最後）
BG_OK=$(jq -r --arg sw "$SW_FILE" --arg pc "$POPUP_CORE" --arg sd "$SETTINGS_DEFAULTS" \
  '(.background.scripts == [$pc, $sd, $sw]) and (.background.persistent == false) and (.background | has("service_worker") | not)' \
  "$DST_MANIFEST")
if [ "$BG_OK" != "true" ]; then
  echo "ERROR: Safari manifest background 不是預期 event page 形式：" >&2
  jq '.background' "$DST_MANIFEST" >&2
  exit 1
fi

echo "Safari manifest patched: background = event page（scripts: [$POPUP_CORE, $SETTINGS_DEFAULTS, $SW_FILE], persistent: false）"
