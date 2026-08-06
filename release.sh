#!/usr/bin/env bash
# JRead — release 流程
# 前置條件：版本號同步清單（CLAUDE.md 硬規則 1）已全部更新並 commit。
# 動作：
#   1. 同步 landing page（docs/index.html）四顆下載鈕的版本號
#   2. 跑測試
#   3. 確認 working tree 乾淨（守門：避免雜進使用者未 commit 編輯）
#   4. 建 git tag v<ver>
#   5. push commits + tags（GitHub Actions 收到 tag 後建 Release 上傳
#      Chrome / Firefox / Firefox source zip）
#
# 用法：
#   ./release.sh                # 完整流程
#   SKIP_PUSH=1 ./release.sh    # 只跑測試 + 本機 tag，不 push（debug 用）
#
# Safari 軌：macOS 不再產獨立 Developer ID .pkg。Safari 走 iOS 單一 binary
# （TestFlight / App Store），在 Apple Silicon Mac 以 iPad app 執行同時涵蓋
# macOS / iOS / iPadOS。本腳本技術上不處理 iOS，但流程上不是選配——
# Jimmy 2026-06-11 規則：每個 release 都跟發 TestFlight，本腳本成功後一律
# 接跑 ./safari-app/ios-build.sh（步驟與坑見 /release skill 第 5 節 +
# /ios-release skill）。

set -euo pipefail

cd "$(dirname "$0")"

VERSION="$(node -p "require('./jread/manifest.json').version")"
TAG="v${VERSION}"

# ---- landing page 版本號自動同步 -------------------------------------------
# docs/index.html 四顆下載鈕各印一次版本號。它不在 CLAUDE.md 硬規則 1 的 6 檔
# 同步清單裡、也沒有 forcing spec，實際下場是從 v1.6.1 一路 stale 到 v1.7.37
# 才被發現（Jimmy 2026-08-04 要求檢查 landing page 時揪出）。原始碼裡本來就有
# `<!-- version-start -->` 標記、卻沒有任何腳本在用它——這段補上那個缺口。
# 放在 working tree 守門「之前」：替換若造成變更會自動 commit 一筆，否則守門
# 會擋下自己剛改出來的 diff。
LANDING="docs/index.html"
if [[ -f "${LANDING}" ]]; then
  MARKS="$(grep -c '<!-- version-start -->' "${LANDING}" || true)"
  if [[ "${MARKS}" -eq 0 ]]; then
    echo "警告：${LANDING} 找不到 <!-- version-start --> 標記，版本號未同步" >&2
  else
    # 先確認這個檔案沒有「別的」未 commit 編輯——否則下面的 git add 會把使用者
    # 正在改的東西一起 commit 進版本號同步這筆
    if [[ -n "$(git status --porcelain -- "${LANDING}")" ]]; then
      echo "${LANDING} 有未 commit 變更，請先 commit 或 stash 再 release：" >&2
      git status --short -- "${LANDING}"
      exit 1
    fi
    perl -pi -e "s/(<!-- version-start -->)[^<]*(<!-- version-end -->)/\${1}${VERSION}\${2}/g" "${LANDING}"
    if [[ -n "$(git status --porcelain -- "${LANDING}")" ]]; then
      echo "==> landing page 版本號同步至 ${VERSION}（${MARKS} 處）"
      git add "${LANDING}"
      git commit -q -m "chore(docs): landing page 版本號同步至 ${TAG}"
    else
      echo "==> landing page 版本號已是 ${VERSION}，無需同步"
    fi
  fi
fi

echo "==> 跑 npm test"
npm test

echo "==> 檢查 git working tree"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "working tree 不乾淨，請先 commit 或 stash：" >&2
  git status --short
  exit 1
fi

echo "==> 目前版本：${VERSION}"

if git rev-parse "${TAG}" >/dev/null 2>&1; then
  echo "tag ${TAG} 已存在，略過 tag 動作"
else
  echo "==> 建立 tag ${TAG}"
  git tag "${TAG}"
fi

if [[ "${SKIP_PUSH:-0}" = "1" ]]; then
  echo "==> SKIP_PUSH=1，跳過 push。如要推送：git push && git push --tags"
  exit 0
fi

echo "==> 推送 commits + tags 到 origin"
git push
git push --tags

echo ""
echo "==> ${TAG} 已推送。GitHub Release 內容："
echo "   - jread-${TAG}.zip（Chrome，Actions 產）"
echo "   - jread-firefox-${TAG}.zip（Firefox sideload，Actions 產）"
echo "   - jread-firefox-${TAG}-source.zip（AMO source，Actions 產）"
echo "   進度：https://github.com/jimmysu0309/JRead/actions"
echo "   Release：https://github.com/jimmysu0309/JRead/releases/tag/${TAG}"
