# JRead

Chrome Extension「Unclutter」的 clone——純閱讀模式，一鍵隱藏廣告、側邊欄、彈窗、浮動元素，將主文以乾淨排版呈現。

**目前版本**：v0.2.2（主文偵測已實作，雜訊隱藏與排版尚未實作）

---

## 功能

- 主文偵測（`<article>` / Schema.org / 內容密度啟發式）
- 閱讀模式一鍵切換
- 乾淨排版（字體、字級、行高、版心寬度）
- 雜訊隱藏（廣告、sticky header、彈窗、相關文章列表）
- 偏好設定：主題（亮/暗/米色）、字級、版心寬度

詳細規格見 [SPEC.md](SPEC.md)。

---

## 安裝（開發中）

1. Clone 本 repo
2. 打開 Chrome，進入 `chrome://extensions/`
3. 右上角開啟「開發人員模式」
4. 點「載入未封裝項目」，選擇 `jread/` 資料夾
5. 點工具列上的 JRead 圖示即可使用

每次改程式碼後請回 `chrome://extensions/` 按該擴充功能卡片上的重新載入按鈕。

---

## 開發

- 骨架/協作規則：見 [CLAUDE.md](CLAUDE.md)
- 完整規格：見 [SPEC.md](SPEC.md)
- 變更紀錄：見 [CHANGELOG.md](CHANGELOG.md)

### 測試

```bash
npm test
```

`test/version-check.spec.js` 是版本號 forcing function，每次 bump 版本號必須同步更新 `EXPECTED_VERSION`。

### 發佈

```bash
./release.sh
```
