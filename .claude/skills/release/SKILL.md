---
name: release
description: JRead 版本 bump + release 完整流程。每次 bump manifest 版本號、準備 commit + release、或 Jimmy 說「出版 / release / 發版」時必用。包含 6 檔同步清單（少一個測試會 fail）、git status 三欄檢查、release.sh、好斷點提醒
---

# JRead release 流程

每次「修改 extension 後收尾」都走這份 checklist，順序不可跳。

## 1. 前置確認

- [ ] `npm test` 全綠
- [ ] 若改動有視覺風險（detector / cleaner / styler / theme / paged）→ 已照 `/harness-verify` skill 跑過 harness 驗收
- [ ] regression spec 已補（硬規則 4 路徑 A），或 `test/PENDING_REGRESSION.md` 已加條目（路徑 B）——兩條必選一

## 2. 版本 bump 同步清單（單一資料源，6 項全做）

版本格式三段式 `X.Y.Z`（Chrome 會把 `1.01` 解析成 `1.1`，禁前導零）。

1. `jread/manifest.json` 的 `version`
2. `package.json` 的 `version`
3. `SPEC.md` 的「目前 Extension 版本」標頭
4. `CHANGELOG.md` 頂部新增 `**vX.Y.Z**——` 條目
5. `test/version-check.spec.js` 的 `EXPECTED_VERSION`（forcing function：不改必 fail）
6. `README.md` 若有提到版本號的段落

文件同步（硬規則 2）：行為 / UI / 設定有變時，同步 `SPEC.md`、`README.md`、必要時 `CLAUDE.md` 與 `test/regression/fixtures/` 期望值。具體數值對照程式碼，不憑記憶。

## 3. commit 前 git status 檢查（硬規則 5）

- 完整 `git status`，staged / unstaged / untracked 三欄全看
- 出現本次任務沒在改的檔案 → **停下來追問**，不可默默 `git add -A`
- 視覺檔案（icon / promo）不明來源時預設是 Claude Design 產出，不當誤植

## 4. commit + release.sh

```bash
git add <明確列出的檔案> && git commit -m "vX.Y.Z — <摘要>"
./release.sh          # 跑 npm test → 驗 working tree 乾淨 → git tag vX.Y.Z → push commits+tags
```

- `SKIP_PUSH=1 ./release.sh` 只跑測試 + 本機 tag（debug 用）
- push 後 GitHub Actions 自動建 Release：Chrome zip + Firefox sideload zip + AMO source zip
- 進度看 https://github.com/jimmysu0309/JRead/actions

## 5. iOS / Safari 軌（每次 release 都跟發 TestFlight）

**Jimmy 2026-06-11 規則：每個 release 都上傳 TestFlight**。release.sh 成功後接著跑：

```bash
./safari-app/ios-build.sh   # 同步 Resources → bump pbxproj → archive → export ipa → 上傳 ASC
```

- 版本號已在第 2 節 bump 過，ios-build.sh 直接取 manifest version，不會撞「同版本重傳被拒」
- 細節與坑（簽章、Resources mirror、ASC key）見 `/ios-release` skill
- release.sh 本身仍不處理 iOS，TestFlight 上傳是本節的獨立步驟

## 6. 收尾

三條件全成立時，回應末尾加一句「這是好斷點，要不要開新對話？」：

1. release.sh 剛成功完成
2. `git status` working tree clean
3. `test/PENDING_REGRESSION.md` 無活動條目
