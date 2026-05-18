#!/usr/bin/env bash
# JRead — release 流程
# 前置條件：版本號同步清單（CLAUDE.md 硬規則 1）已全部更新並 commit。
# 動作：
#   1. 跑測試
#   2. 確認 working tree 乾淨（守門：避免雜進使用者未 commit 編輯）
#   3. 跑 Safari Developer ID build（archive + notarize + staple，產 .pkg）
#      - 同步 jread/ → safari-app/JRead/JRead Extension/Resources/
#      - bump safari-app/JRead/JRead.xcodeproj MARKETING_VERSION / CURRENT_PROJECT_VERSION
#      - 這兩處改動會被視為「Safari sync」auto-commit 進 release 那筆
#   4. 若 Safari sync 改動 pbxproj / Resources，自動 commit "v<ver> — Safari sync"
#   5. 建 git tag v<ver>
#   6. push commits + tags（GitHub Actions 收到 tag 後建 Release 上傳 Chrome / Firefox / Firefox source zip）
#   7. 等 GH Release 建好後 gh release upload .pkg
#
# 用法：
#   ./release.sh                # 完整流程
#   SKIP_PUSH=1 ./release.sh    # 只跑測試 + Safari build + 本機 tag，不 push（debug 用）
#   SKIP_SAFARI=1 ./release.sh  # 緊急只發 Chrome / Firefox，跳過 Safari build（Xcode 或 cert 暫時不能用）
#
# Safari build 失敗（沒 Xcode / cert 過期 / notarize cloud reject）會在 tag 之前 abort，
# 不會留半 release 狀態。notarize 等 Apple cloud 時間不固定（實測 ~25 秒；Apple 文件聲稱
# 可達 30-60 分鐘）。

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

# Safari Developer ID build
if [[ "${SKIP_SAFARI:-0}" = "1" ]]; then
  echo "⚠️  SKIP_SAFARI=1 — 跳過 Safari build，只發 Chrome / Firefox。"
  echo "    下次 Safari release 要手動跑 ./safari-app/safari-build.sh 補上同步。"
else
  echo "==> Safari Developer ID build（archive + notarize + staple，等 Apple cloud）..."
  ./safari-app/safari-build.sh

  # safari-build.sh 改動 pbxproj 的 MARKETING_VERSION / CURRENT_PROJECT_VERSION
  # + rsync jread/ → Resources/。這兩處是 deterministic build artifact，應 commit
  # 進 release tag 的 tree state。其他路徑若有改動則屬於使用者未 commit 編輯，abort。
  SAFARI_DIRTY=$(git status --porcelain -- safari-app/JRead/JRead.xcodeproj "safari-app/JRead/JRead Extension/Resources" | wc -l | tr -d ' ')
  OTHER_DIRTY=$(git status --porcelain | grep -v -E "^.. safari-app/JRead/(JRead\.xcodeproj|JRead Extension/Resources)" | wc -l | tr -d ' ')

  if [[ "${OTHER_DIRTY}" != "0" ]]; then
    echo "ERROR: Safari build 後 working tree 有非預期改動：" >&2
    git status --short >&2
    exit 1
  fi

  if [[ "${SAFARI_DIRTY}" != "0" ]]; then
    echo "==> 自動 commit Safari sync 改動（pbxproj + Resources）"
    git add safari-app/JRead/JRead.xcodeproj "safari-app/JRead/JRead Extension/Resources"
    git commit -m "${TAG} — Safari sync (auto)"
  fi
fi

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

# Safari .pkg 上傳到 GitHub Release。GitHub Actions 收到 tag 後 ~1 分鐘內建出 Release。
# 這邊 poll 等到 release 存在再 upload；SKIP_SAFARI 時沒 .pkg 直接跳過。
if [[ "${SKIP_SAFARI:-0}" != "1" ]]; then
  PKG="safari-app/jread-macos-${TAG}.pkg"
  if [[ ! -f "${PKG}" ]]; then
    echo "⚠️  ${PKG} 不存在，跳過 GitHub Release upload（safari-build.sh 應產此檔）。"
  else
    echo ""
    echo "==> 等 GitHub Release ${TAG} 由 Actions 建出（最多輪詢 3 分鐘）..."
    UPLOADED=0
    for i in $(seq 1 18); do
      if gh release view "${TAG}" >/dev/null 2>&1; then
        echo "    Release 已建立，開始上傳 ${PKG} ..."
        gh release upload "${TAG}" "${PKG}" --clobber
        UPLOADED=1
        break
      fi
      sleep 10
    done
    if [[ "${UPLOADED}" != "1" ]]; then
      echo "⚠️  GitHub Release ${TAG} 3 分鐘內沒出現，手動補上："
      echo "    gh release upload ${TAG} ${PKG}"
    fi
  fi
fi

echo ""
echo "==> ${TAG} 已推送。GitHub Release 內容："
echo "   - jread-${TAG}.zip（Chrome，Actions 產）"
echo "   - jread-firefox-${TAG}.zip（Firefox sideload，Actions 產）"
echo "   - jread-firefox-${TAG}-source.zip（AMO source，Actions 產）"
if [[ "${SKIP_SAFARI:-0}" != "1" ]]; then
  echo "   - jread-macos-${TAG}.pkg（macOS Safari Developer ID，本機 build 上傳，notarize + stapled）"
fi
echo "   進度：https://github.com/jimmysu0309/JRead/actions"
echo "   Release：https://github.com/jimmysu0309/JRead/releases/tag/${TAG}"
