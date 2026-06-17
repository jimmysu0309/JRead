#!/bin/bash
cd "$(dirname "$0")/.."

# 單一資料源（2026-06-17）：URL 清單直接從 docs/excluded/page-rounds-sites.md 解析，
# 不再硬編在這支腳本——消滅 batch 與 sites.md drift（CLAUDE.md 硬規則 5）。
# 只取 Playwright 段（「## cage 模式」之前）的有編號、非刪除線（| N | …）表格列，
# 抓每列反引號內的 URL。cage 站需登入、不在批次跑。
SITES_MD="docs/excluded/page-rounds-sites.md"
if [ ! -f "$SITES_MD" ]; then
  echo "ERROR: 找不到 $SITES_MD" >&2
  exit 1
fi

URLS=()
while IFS= read -r u; do
  [ -n "$u" ] && URLS+=("$u")
done < <(awk '
  /^## cage 模式/ { exit }                      # 到 cage 段標題就停（^ 錨點，避免內文散提「cage 模式」誤命中提早 exit）
  /^\| [0-9]+ \|/ {                             # 有編號的 active 列（刪除線列開頭是 | ~~ 不命中）
    if (match($0, /`[^`]+`/)) {
      print substr($0, RSTART+1, RLENGTH-2)      # 取反引號內的 URL
    }
  }
' "$SITES_MD")

if [ "${#URLS[@]}" -eq 0 ]; then
  echo "ERROR: 從 $SITES_MD 解析不到任何 URL" >&2
  exit 1
fi

PASS=0
REVIEW=0
FAIL=0
BLOCKED=0
ERROR=0

for i in "${!URLS[@]}"; do
  url="${URLS[$i]}"
  n=$((i+1))
  HOSTNAME=$(echo "$url" | sed 's|https\?://\(www\.\)\?||;s|/.*||')
  echo ""
  echo "[$n/${#URLS[@]}] $HOSTNAME"

  OUTPUT=$(JREAD_URL="$url" node tools/page-rounds-harness.js 2>&1)
  EXIT_CODE=$?

  # harness 在收尾印一行 machine-greppable 的 `VERDICT: <verdict> fail=[...] review=[...]`
  VERDICT_LINE=$(echo "$OUTPUT" | grep "^VERDICT:" | tail -1)
  VERDICT=$(echo "$VERDICT_LINE" | awk '{print $2}')

  if [ $EXIT_CODE -ne 0 ]; then
    echo "  ⛔ ERROR (exit $EXIT_CODE)"
    ERROR=$((ERROR+1))
  elif [ "$VERDICT" = "pass" ]; then
    echo "  ✅ PASS"
    PASS=$((PASS+1))
  elif [ "$VERDICT" = "review" ]; then
    echo "  🔍 REVIEW — $VERDICT_LINE"
    REVIEW=$((REVIEW+1))
  elif [ "$VERDICT" = "failed" ]; then
    echo "  ❌ FAIL — $VERDICT_LINE"
    echo "$OUTPUT" | grep "⚠️" | head -3 | sed 's/^/    /'
    FAIL=$((FAIL+1))
  elif [ "$VERDICT" = "blocked" ]; then
    echo "  ⛔ BLOCKED（bot challenge / 空頁，改用 cage 重測）"
    BLOCKED=$((BLOCKED+1))
  else
    echo "  ❓ UNKNOWN"
    ERROR=$((ERROR+1))
  fi
done

echo ""
echo "=============================="
echo "TOTAL: ${#URLS[@]} sites"
echo "  ✅ PASS:    $PASS"
echo "  🔍 REVIEW:  $REVIEW   （低精度信號，Claude 必看截圖判真偽）"
echo "  ❌ FAIL:    $FAIL   （高精度信號，近乎必為真 bug）"
echo "  ⛔ BLOCKED: $BLOCKED   （環境擋住，改 cage）"
echo "  ⛔ ERROR:   $ERROR"
echo "=============================="
