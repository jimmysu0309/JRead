// JRead — Safari background 存活機制（v0.8.30 引入，v0.8.33 重整）
//
// 兩段機制，gate 各自獨立：
//
// (A) wake ping（v0.8.33，Safari 全平台）：content 載入時對 background 發一發
//     runtime.sendMessage。動機：macOS Safari WPA（加入 Dock 的 web app）的
//     background 不會因 commands / menu / popup 啟動（2026-06-10 實測），而
//     Shinkansen 的 commands 在 WPA 可用、它的 content 每頁載入都會 sendMessage
//     給 background（sticky query / log）——這發訊息疑似就是把 WPA background
//     拉起來的觸發器。JRead 自 v0.7.235 起 content 直讀 storage、零訊息，補上
//     這一發對齊。Chrome 不發（SW 事件喚醒可靠，不需要）。
//
// (B) keep-alive port（v0.8.30，觸控裝置限定 = 真 iOS / iPadOS）：iOS Safari
//     會把閒置 background 永久回收且喚不醒（Apple Forums 758346）→ 開長連線
//     port + 每 20s ping 讓它不被回收。**v0.8.33 起 gate 收緊到
//     `navigator.maxTouchPoints > 0`**：macOS Safari / WPA 不跑——v0.8.30-32
//     在 WPA 內 port connect 對「拉不起來的 background」的回傳值沒有 null
//     guard，疑似 TypeError 中止同批 content script 後續檔案的執行（JRead 在
//     WPA 全滅、連 v0.8.29 原本可用的 ⌃R 自訂鍵都死掉的回歸根因）。macOS
//     Safari 的 background 生命週期正常，本來就不需要 keep-alive。
//
// gate 訊號：Safari 用 runtime URL scheme（safari-web-extension://，結構性
// 平台訊號、非 UA 嗅探）；iOS 用 maxTouchPoints（與 touch-gestures.js 同款）。
// 「iPad app 跑在 Apple Silicon Mac」時 extension 在 macOS Safari 內執行、
// maxTouchPoints = 0 → 不開 port，正確（macOS 不需要）。
//
// 訊號層次說明：jsdom spec 驗「gate / 連線 / 重連 / 可見性 / null guard」邏輯
// 與兩側 wire-up，**不驗** Safari 實機的回收時序與 WPA 喚醒效果（那層只能靠
// TestFlight 實機驗收）。
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
    // v0.8.33 null guard：background 拉不起來的環境（macOS WPA 實測）connect
    // 可能回傳 falsy / 殘缺 port——整段 listener 掛載包 try/catch，任何一步壞
    // 都不能讓 TypeError 外洩（中止同批 content script 的風險）
    if (!port) return;
    try {
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
    } catch (_) {
      stop();
    }
  }

  const api = { start, stop, alive: false, PORT_NAME, PING_MS };
  NS.keepalive = api;

  if (!isSafariRuntime()) return;

  // (A) wake ping：Safari 全平台。fire-and-forget；callback 讀 lastError
  // 吞掉「background 沒回應」的 console 警告。
  NS.safeSendMessage({ type: 'BG_WAKE_PING' }, () => {
    void (chrome.runtime && chrome.runtime.lastError);
  });

  // (B) keep-alive port：真觸控裝置（iOS / iPadOS）限定
  if ((navigator.maxTouchPoints || 0) === 0) return;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  start();
})();
