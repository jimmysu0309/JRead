// JRead — Safari background keep-alive port（v0.8.30）
//
// 根因（2026-06-10 YouTube WPA 排查）：macOS Safari「加入 Dock」web app（WPA）
// 與 iOS Safari 對擴充 background（即使已宣告成 event page）的生命週期管理
// 相同：閒置約 30s 後被系統回收，之後 commands.onCommand 與 Safari menu
// 「延伸功能動作」都喚不醒它（Apple Developer Forums thread 758346）。JRead
// 的 manifest 預設鍵（⌥3 / ⌥4 / ⌥⇧3）與 menu 動作都走 background 端
// onCommand → 在 WPA 內「從來不會動」。Shinkansen 同場景多半正常，唯一結構
// 差異是它有 content 端 keep-alive port（每 20s ping，讓 background 維持
// 非閒置不被回收）——本檔移植同機制。
//
// 兩個效果：
//   1. port connect 本身會把尚未啟動的 event page 拉起來。WPA 冷啟後 JRead
//      background 可能從沒被載入——content script 不再 round-trip 取設定
//      （v0.7.235 起直讀 storage），沒有任何訊息會喚它。
//   2. 每 20s ping 重置系統閒置計時 → background 不被回收 → onCommand 活著。
//
// gate：只在 Safari 跑（runtime URL scheme 為 safari-web-extension://，結構性
// 平台訊號、非 UA 嗅探）。Chrome / Firefox 的 background 生命週期正常（事件
// 可靠喚醒），長連線 keep-alive 反而違反 MV3 best practice（SW 永不休眠、
// 白耗資源）——不開。只在分頁可見時 ping（hidden 即斷線省電）；JRead content
// script 只注入 top frame（manifest 無 all_frames），不需 frame guard。
//
// 訊號層次說明：jsdom spec 驗「gate / 連線 / 重連 / 可見性」邏輯與兩側 wire-up，
// **不驗** Safari 實機的回收時序（那層只能靠 TestFlight 實機驗收）。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS || NS.keepalive) return; // 避免重複注入

  const PORT_NAME = 'jread-keepalive';
  const PING_MS = 20000; // < Safari ~30s 回收窗，留餘裕（與 Shinkansen 同值）

  let port = null;
  let timer = null;

  function isSafariRuntime() {
    try {
      return chrome.runtime.getURL('').startsWith('safari-web-extension://');
    } catch (_) {
      return false;
    }
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (port) { try { port.disconnect(); } catch (_) {} port = null; }
  }

  function start() {
    if (port || document.hidden) return;               // 已連線 / 不可見 → 不開
    if (!chrome.runtime || !chrome.runtime.id) return; // context 失效（reload 中）
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch (_) {
      port = null;
      return;
    }
    // background 回 pong → 記錄存活（production 不依賴此值，讓自動化測得到
    // 真實 content ↔ background round-trip）
    port.onMessage.addListener(() => { api.alive = true; });
    // background 被回收 / extension reload → port 斷線。仍可見就 1s 後重連
    // （重連的 connect 會重新拉起 event page；context 失效時 start 自會早退，
    // 1s 延遲避免 reload 期間緊迴圈）
    port.onDisconnect.addListener(() => {
      port = null;
      if (timer) { clearInterval(timer); timer = null; }
      if (!document.hidden) setTimeout(start, 1000);
    });
    timer = setInterval(() => {
      if (!port) return;
      try {
        port.postMessage({ t: 'ping' });
      } catch (_) {
        stop();
        if (!document.hidden) setTimeout(start, 1000);
      }
    }, PING_MS);
  }

  const api = { start, stop, alive: false, PORT_NAME, PING_MS };
  NS.keepalive = api;

  if (!isSafariRuntime()) return;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  start();
})();
