#!/usr/bin/env bash
# JRead — release 流程
# 前置條件：版本號同步清單（CLAUDE.md 硬規則 1）已全部更新並 commit。
# 動作：
#   1. 跑測試
#   2. 確認 working tree 乾淨（守門：避免雜進使用者未 commit 編輯）
#   3. 建 git tag v<ver>
#   4. push commits + tags（GitHub Actions 收到 tag 後建 Release 上傳
#      Chrome / Firefox / Firefox source zip）
#
# 用法：
#   ./release.sh                # 完整流程
#   SKIP_PUSH=1 ./release.sh    # 只跑測試 + 本機 tag，不 push（debug 用）
#
# Safari 軌：macOS 不再產獨立 Developer ID .pkg。Safari 走 iOS 單一 binary
# （TestFlight / App Store），在 Apple Silicon Mac 以 iPad app 執行同時涵蓋
# macOS / iOS / iPadOS。要發 Safari 人工跑 ./safari-app/ios-build.sh（與本
# release 流程解耦，見該 script 註解）。

set -euo pipefail

cd "$(dirname "$0")"

echo "==> 跑 npm test"
npm test

echo "==> 檢查 git working tree"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "working tree 不乾淨，請先 commit 或 stash：" >&2
  git status --short
  exit 1
fi

VERSION="$(node -p "require('./jread/manifest.json').version")"
TAG="v${VERSION}"

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
