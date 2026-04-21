#!/usr/bin/env bash
# JRead — release 流程
# 前置條件：版本號同步清單（CLAUDE.md 硬規則 1）已全部更新。
# 動作：跑測試 → 確認 working tree 乾淨 → 讀取 manifest 版本 → git tag。

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

echo "==> 完成。如要推送：git push && git push --tags"
