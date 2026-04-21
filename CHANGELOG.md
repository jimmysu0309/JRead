# Changelog

本檔記錄 JRead 每次版本變更。格式參考 [Keep a Changelog](https://keepachangelog.com/)。

---

**v0.4.0**——新增兩項功能。(1) **快捷鍵切換閱讀模式**：manifest `commands` 區塊宣告 `toggle-reader-mode`，預設 `Ctrl+Shift+R` / `Command+Shift+R`。⚠️ **此組合與 Chrome 內建「強制重新載入」衝突，載入 extension 後 Chrome 會忽略 suggested_key**；使用者需到 `chrome://extensions/shortcuts` 手動指派（或改成不衝突的組合）。service-worker 用 `importScripts('popup/popup-core.js')` 複用 `toggleWithInjectionFallback`，新分頁/既有分頁路徑一致；popup-core 的 global 掛載點改為 `globalThis` 相容 window / self。(2) **狀態提示 toast 化**：新增 `content/toast.js`（`NS.toast.show(msg, {kind, duration})`），以 Shadow DOM（open mode）+ `all: initial` 封裝避免被站點 CSS 影響，z-index `2147483647`、`pointer-events: none` 不擋頁面互動。content/main.js 在 enter/exit/偵測失敗時顯示對應 toast；popup toggle 成功改直接 `window.close()`，錯誤（禁止注入頁）才退回 popup 內顯示。popup 新增快捷鍵提示區（依 `chrome.commands.getAll` 動態顯示實際快捷鍵或引導至 shortcuts 頁）。新增 `test/regression/toast.spec.js`（6 個斷言：host 掛載 / 防 XSS textContent / kind class / duration 後移除 / fixed 定位 / 單一 host 共用）。service-worker 的 command handler 走 PENDING_REGRESSION（核心 `toggleWithInjectionFallback` 已有完整 spec，handler 本身是 wire-up）。

**v0.3.0**——雜訊隱藏（`cleaner.js`）實作完成。四條路徑皆為結構性通則：(1) 主文外語意標籤 `header/nav/footer/aside`；(2) 主文外 `position: fixed|sticky` 按 rect 判斷 top bar / side tool / bottom popup；(3) 社群分享 cluster（同 parent 下 ≥3 個 `twitter/x/facebook/linkedin/line/weibo/reddit/pinterest/telegram/whatsapp` 連結摺疊）；(4) 主文內 keyword heuristic 限定容器型元素（`div/section/aside/iframe/form/nav/header/footer`）以避免 Wikipedia `h4#_ad_blocking` 這類標題誤殺。保留元素 `summary/figure/figcaption/blockquote` 永不隱藏（Unclutter 在商周踩過 summary 外移的坑）。`clean()` 回傳 hidden 清單、`restore()` 以原 inline display 還原。新增 `test/regression/cleaner.spec.js`（8 個斷言），jsdom 下對 fixed 元素 stub rect 以覆蓋 fixed 路徑。

**v0.2.2**——將 popup 的注入 fallback 核心函式抽至 `popup-core.js`（依賴注入 chrome API），新增 `test/regression/popup-inject-retry.spec.js`（4 個斷言：一般頁面只送一次 message / 既有分頁注入後重試成功 / 注入 files 順序與 manifest 一致 / 禁止注入頁面回傳 ok=false 而不拋錯）。清除 PENDING_REGRESSION 對應條目。popup.html 多載一個 script，popup.js 行為不變。

**v0.2.1**——修復 popup 對 extension 安裝/重新載入前已開啟分頁無效的問題：`chrome.tabs.sendMessage` 失敗時改以 `chrome.scripting.executeScript` 主動注入 content scripts 再重試一次。此為 MV3 `content_scripts` 只注入「新載入分頁」的通用限制，解法為結構性通則，不綁站點。regression 走 PENDING（`test/PENDING_REGRESSION.md`），理由：popup.js 目前為 entry 腳本，直接測需要 chrome API mock + jsdom，成本與 bug 體積不成比例。

**v0.2.0**——主文偵測（`detector.js`）實作策略 1（`<article>` / `<main>`）、策略 2（Schema.org `itemtype`）、策略 4（內容密度啟發式）；策略 3（OpenGraph）暫未實作。新增 `test/regression/detector.spec.js` 商周 fixture 回歸測試；`package.json` 加入 `jsdom` 作為測試依賴。

**v0.1.0**——專案骨架初始化。建立 `jread/` 目錄結構、Manifest V3、background service worker、content script 命名空間（`window.__JRead`）、popup 與 options HTML 骨架。detector / cleaner / styler 為介面佔位，尚未實作。
