# JRead

純閱讀模式，一鍵隱藏廣告、側邊欄、彈窗、浮動元素，將主文以乾淨排版呈現。

**目前版本**：v0.7.17（theverge p 鎖寬修法）。theverge styled-components class 設 p `width: 588px` 固定值、img 608px 更寬、造成段落偏右不對齊。擴 v0.7.16 universal rule 加 `width: auto !important + max-width: 100% !important` 覆寫固定 px。不違反 v0.6.0 baseline（禁的是 typography 字面 rule、width reset 非 typography）。188 spec 全過

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

### 自動化除錯

```bash
npm install
npx playwright install chromium   # 首次：下載 bundled Chromium
npm run debug                     # 或 node tools/debug-harness.js --fresh
```

會用 Playwright 內建 Chromium 載入 `jread/` 為 unpacked extension，打開目標頁（預設 ChinaTalk，可用 `JREAD_URL` 環境變數覆蓋），觸發閱讀模式，讀 DOM 狀態 + 量測 gap + 截圖到 `.playwright-mcp/jread-viewport.png`。詳見 [docs/CHROME_EXTENSION_DEBUG.md](docs/CHROME_EXTENSION_DEBUG.md)。

### 發佈

```bash
./release.sh
```
