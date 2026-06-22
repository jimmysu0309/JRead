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
// (B) keep-alive port（v0.8.30，Safari 全平台；v0.8.33 曾收緊到觸控裝置、
//     v0.8.34 改回全 Safari）：iOS Safari 會把閒置 background 永久回收且喚
//     不醒（Apple Forums 758346）→ 開長連線 port + 每 20s ping 讓它不被回收。
//     macOS Safari WPA 同樣需要：background 被 SW 端 wake alarm（v0.8.34）
//     拉起後，唯一讓它整個 session 不死的就是這條 port（Shinkansen 同款配方
//     ——它的 port gate 是 build-time IS_IOS_BUILD、在 Mac 上也是 true）。
//     v0.8.33 的 null guard + try/catch 保留：background 拉不起來的環境
//     connect 回傳值不可信，TypeError 不可外洩。
//
// gate 訊號：runtime URL scheme（safari-web-extension://，結構性平台訊號、
// 非 UA 嗅探）。Chrome / Firefox 不開（background 生命週期正常，長連線
// keep-alive 違反 MV3 best practice）。
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
      return browser.runtime.getURL('').startsWith('safari-web-extension://');
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
    if (!browser.runtime || !browser.runtime.id) return; // context 失效（reload 中）
    try {
      port = browser.runtime.connect({ name: PORT_NAME });
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

  // (A) wake ping：Safari 全平台。fire-and-forget。
  // v0.8.164：browser.* Promise 模式無 lastError；safeSendMessage 內部已用
  // .then(onFulfilled, onRejected) 消費 reject（background 沒回應不留 unhandled
  // rejection），這裡 cb 留空即可。
  NS.safeSendMessage({ type: NS.MSG.BG_WAKE_PING }, () => {});

  // (B) keep-alive port：Safari 全平台（iOS 防回收 + macOS WPA 接力 alarm 保活）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  start();
})();
