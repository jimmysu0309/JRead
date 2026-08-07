# DEV-SETUP — 在新環境把完整開發環境接起來

> Maintainer-only note. This repo is the public half of JRead; tests and internal
> docs live in two private repositories that must be attached manually.
> The instructions below are in Traditional Chinese (the author's working language).

公開 repo 只有 extension 本體與公開說明。**測試套件**與**內部文件（含協作規則）**
住在兩個私有 repo，clone 公開 repo 之後要手動接回來——否則 `npm test` 沒有測試可跑，
協作規則也完全讀不到。

為什麼分開：那些 spec / fixture / 逐版紀錄同時記錄了大量開發過程、試錯輪數與判斷脈絡
（fixture 另含第三方站點 HTML），作者選擇不公開。**檔案路徑刻意維持原位**，接回來之後
所有相對路徑、腳本、測試全部照舊，日常沒有任何差別。

---

## 1. 測試套件 → `test/`

```bash
git clone git@github.com:jimmysu0309/JRead-test.git test
```

沒接的話 `npm test` 找不到任何 spec。`test/` 是獨立 repo，父 repo 的 `git status`
看不到它、`git add -A` 也不會帶到——**改了 spec / fixture 要在 `test/` 內另外 commit + push**。

## 2. 內部文件 → 疊加在根目錄的第二個倉庫

`SPEC.md`、`CHANGELOG.md`、`docs/CHANGELOG-archive.md`、`CLAUDE.md`、`AGENTS.md`、
`.claude/skills/`、`.claude/settings.local.json` 這 8 份**檔案位置就在根目錄**，
但版控走另一個倉庫（`.private-git` 是它的 `.git`、work-tree 指向同一個根目錄）：

```bash
# 在 JRead repo 根目錄執行（2026-08-07 實測過這四行）
git clone --no-checkout https://github.com/jimmysu0309/JRead-docs.git tmpclone
mv tmpclone/.git .private-git && rmdir tmpclone
git --git-dir=.private-git config core.worktree "$(pwd)"
git --git-dir=.private-git checkout main   # 把 8 檔還原到 work-tree
```

（刻意**不用** `clone --bare`：bare clone 的 fetch refspec 是
`+refs/heads/*:refs/heads/*`，接起來會沒有 `origin/main` 這類 remote-tracking ref。
上面這個作法拿到的是正常 clone 的設定。）

日常操作一律加 `--git-dir`：

```bash
git --git-dir=.private-git status --short
git --git-dir=.private-git add -u && git --git-dir=.private-git commit -m "…"
git --git-dir=.private-git push
```

**新增檔案進這個倉庫必須 `git add -f`**：根目錄的 `.gitignore`（公開 repo 那份）
對這個倉庫同樣生效，且優先序高於 `.private-git/info/exclude` 的反向豁免——不加 `-f`
會什麼都加不進去、`status` 也看不到。檔案一旦 tracked 就不再受 ignore 影響。

---

## 為什麼這份要放在公開 repo

接回私有倉庫的指令本身寫在 `CLAUDE.md`，而 `CLAUDE.md` 就住在私有倉庫裡——新環境
clone 完公開 repo 是讀不到的（開保險箱的說明書鎖在保險箱裡）。這份是掛在外面的那把
備用鑰匙，所以它必須留在公開 repo，內容也只到「怎麼接」為止。
