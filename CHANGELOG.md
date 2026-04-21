# Changelog

本檔記錄 JRead 每次版本變更。格式參考 [Keep a Changelog](https://keepachangelog.com/)。

---

**v0.2.2**——將 popup 的注入 fallback 核心函式抽至 `popup-core.js`（依賴注入 chrome API），新增 `test/regression/popup-inject-retry.spec.js`（4 個斷言：一般頁面只送一次 message / 既有分頁注入後重試成功 / 注入 files 順序與 manifest 一致 / 禁止注入頁面回傳 ok=false 而不拋錯）。清除 PENDING_REGRESSION 對應條目。popup.html 多載一個 script，popup.js 行為不變。

**v0.2.1**——修復 popup 對 extension 安裝/重新載入前已開啟分頁無效的問題：`chrome.tabs.sendMessage` 失敗時改以 `chrome.scripting.executeScript` 主動注入 content scripts 再重試一次。此為 MV3 `content_scripts` 只注入「新載入分頁」的通用限制，解法為結構性通則，不綁站點。regression 走 PENDING（`test/PENDING_REGRESSION.md`），理由：popup.js 目前為 entry 腳本，直接測需要 chrome API mock + jsdom，成本與 bug 體積不成比例。

**v0.2.0**——主文偵測（`detector.js`）實作策略 1（`<article>` / `<main>`）、策略 2（Schema.org `itemtype`）、策略 4（內容密度啟發式）；策略 3（OpenGraph）暫未實作。新增 `test/regression/detector.spec.js` 商周 fixture 回歸測試；`package.json` 加入 `jsdom` 作為測試依賴。

**v0.1.0**——專案骨架初始化。建立 `jread/` 目錄結構、Manifest V3、background service worker、content script 命名空間（`window.__JRead`）、popup 與 options HTML 骨架。detector / cleaner / styler 為介面佔位，尚未實作。
