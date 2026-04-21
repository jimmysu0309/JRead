# Changelog

本檔記錄 JRead 每次版本變更。格式參考 [Keep a Changelog](https://keepachangelog.com/)。

---

**v0.2.0**——主文偵測（`detector.js`）實作策略 1（`<article>` / `<main>`）、策略 2（Schema.org `itemtype`）、策略 4（內容密度啟發式）；策略 3（OpenGraph）暫未實作。新增 `test/regression/detector.spec.js` 商周 fixture 回歸測試；`package.json` 加入 `jsdom` 作為測試依賴。

**v0.1.0**——專案骨架初始化。建立 `jread/` 目錄結構、Manifest V3、background service worker、content script 命名空間（`window.__JRead`）、popup 與 options HTML 骨架。detector / cleaner / styler 為介面佔位，尚未實作。
