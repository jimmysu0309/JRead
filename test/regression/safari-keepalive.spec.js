// JRead — Safari background keep-alive port（v0.8.30）
//
// 根因：macOS Safari WPA（加入 Dock）/ iOS Safari 把閒置 background（即使
// 宣告 event page）永久回收且 commands.onCommand / menu「延伸功能動作」喚
// 不醒（Apple Forums 758346）→ ⌥3 / ⌥4 預設鍵與 menu 動作在 WPA 內全滅。
// 修法：content/keepalive.js 在 Safari（runtime scheme safari-web-extension://）
// 開長連線 port + 每 20s ping，讓 background 維持非閒置；SW 端 onConnect 回
// pong。機制移植自 Shinkansen（同場景實證有效的 A/B 對照）。
//
// 訊號層次說明：本檔驗 (A) keepalive.js 行為邏輯（sandbox 注入 mock chrome /
// document / timer）與 (B) 兩側 wire-up 結構。**不驗** Safari 實機的回收時序
// 與「ping 真的阻止回收」——那層 jsdom / Chromium harness 都模擬不到，只能靠
// TestFlight 實機（WPA 加入 Dock）驗收。
//
// 覆蓋層次：
// (A) keepalive.js 行為——Safari gate / 可見性 gate / context-invalidated
//     guard / ping 派送 / 斷線重連 / hidden 斷線
// (B) wire-up——manifest content_scripts 列檔順序、SW onConnect + port 名
//     兩側一致、pong 回覆存在

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const KEEPALIVE_SRC = fs.readFileSync(path.join(ROOT, 'content', 'keepalive.js'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'background', 'service-worker.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const PORT_NAME = 'jread-keepalive';

// ── sandbox 載入 keepalive.js ────────────────────────────────────────────
// IIFE 引用的全域（window / document / chrome / setInterval…）全部以 Function
// 參數 shadow 注入，timer 用手動 mock 控制觸發時機（不等真實時間）。
function loadKeepalive(opts = {}) {
  const {
    scheme = 'safari-web-extension://abc/', // 預設模擬 Safari
    hidden = false,
    runtimeId = 'ext-id'
  } = opts;

  const env = {
    connects: [],          // 歷次 connect 產生的 mock port
    intervals: [],         // { fn, ms }
    timeouts: [],          // { fn, ms }
    visibilityHandlers: [],
    document: { hidden }
  };

  function makePort() {
    const p = {
      name: null,
      posted: [],
      disconnected: false,
      _onMessage: [],
      _onDisconnect: [],
      onMessage: { addListener(fn) { p._onMessage.push(fn); } },
      onDisconnect: { addListener(fn) { p._onDisconnect.push(fn); } },
      postMessage(m) { p.posted.push(m); },
      disconnect() { p.disconnected = true; }
    };
    return p;
  }

  const chromeMock = {
    runtime: {
      id: runtimeId,
      getURL: () => scheme,
      connect({ name }) {
        const p = makePort();
        p.name = name;
        env.connects.push(p);
        return p;
      }
    }
  };

  const documentMock = {
    get hidden() { return env.document.hidden; },
    addEventListener(type, fn) {
      if (type === 'visibilitychange') env.visibilityHandlers.push(fn);
    }
  };

  const windowMock = { __JRead: {} };

  const fn = new Function(
    'window', 'document', 'chrome',
    'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
    KEEPALIVE_SRC
  );
  fn(
    windowMock, documentMock, chromeMock,
    (cb, ms) => { env.intervals.push({ fn: cb, ms }); return env.intervals.length; },
    () => {},
    (cb, ms) => { env.timeouts.push({ fn: cb, ms }); return env.timeouts.length; },
    () => {}
  );

  env.NS = windowMock.__JRead;
  env.setHidden = (h) => { env.document.hidden = h; };
  env.fireVisibility = () => env.visibilityHandlers.forEach((f) => f());
  return env;
}

describe('(A) keepalive.js 行為邏輯', () => {
  it('Safari scheme + 分頁可見 → 立即開 port（name=jread-keepalive）', () => {
    const env = loadKeepalive();
    assert.strictEqual(env.connects.length, 1, '必須 connect 恰好 1 次');
    assert.strictEqual(env.connects[0].name, PORT_NAME);
  });

  it('chrome-extension:// scheme（Chrome 軌）→ 完全不開 port、不掛 visibility listener', () => {
    const env = loadKeepalive({ scheme: 'chrome-extension://abc/' });
    assert.strictEqual(env.connects.length, 0, 'Chrome 軌不得開 keep-alive port');
    assert.strictEqual(env.visibilityHandlers.length, 0, 'Chrome 軌不得掛 visibilitychange listener');
  });

  it('分頁不可見時載入 → 不開 port；轉可見後開', () => {
    const env = loadKeepalive({ hidden: true });
    assert.strictEqual(env.connects.length, 0, 'hidden 時不得 connect');
    env.setHidden(false);
    env.fireVisibility();
    assert.strictEqual(env.connects.length, 1, '轉可見後必須 connect');
  });

  it('context invalidated（runtime.id 空）→ 不 connect', () => {
    // 註：傳 null 而非 undefined——undefined 會被 loadKeepalive 的 destructuring
    // 預設值蓋回 'ext-id'；keepalive 的 `!chrome.runtime.id` guard 兩者都擋
    const env = loadKeepalive({ runtimeId: null });
    assert.strictEqual(env.connects.length, 0);
  });

  it('ping interval 觸發 → port.postMessage；間隔 20s（< Safari ~30s 回收窗）', () => {
    const env = loadKeepalive();
    assert.strictEqual(env.intervals.length, 1, '必須掛恰好 1 個 interval');
    assert.strictEqual(env.intervals[0].ms, 20000, 'ping 間隔必須 20000ms');
    env.intervals[0].fn();
    env.intervals[0].fn();
    assert.strictEqual(env.connects[0].posted.length, 2, '每次 interval 觸發必須 ping 一次');
  });

  it('port 斷線（background 被回收）→ 1s 後重連；重連的 connect 喚回 event page', () => {
    const env = loadKeepalive();
    env.connects[0]._onDisconnect.forEach((f) => f());
    const reconnect = env.timeouts.find((t) => t.ms === 1000);
    assert.ok(reconnect, '斷線後必須排 1s 重連 timeout');
    reconnect.fn();
    assert.strictEqual(env.connects.length, 2, '重連必須再 connect 一次');
  });

  it('斷線時分頁不可見 → 不排重連（省電）', () => {
    const env = loadKeepalive();
    env.setHidden(true);
    env.connects[0]._onDisconnect.forEach((f) => f());
    assert.strictEqual(env.timeouts.length, 0, 'hidden 時斷線不得排重連');
  });

  it('轉不可見 → 主動 disconnect 斷線省電', () => {
    const env = loadKeepalive();
    env.setHidden(true);
    env.fireVisibility();
    assert.strictEqual(env.connects[0].disconnected, true, 'hidden 必須 disconnect');
  });

  it('收到 pong → NS.keepalive.alive 記錄存活（自動化 round-trip 驗證點）', () => {
    const env = loadKeepalive();
    assert.strictEqual(env.NS.keepalive.alive, false);
    env.connects[0]._onMessage.forEach((f) => f({ pong: true }));
    assert.strictEqual(env.NS.keepalive.alive, true);
  });
});

describe('(B) wire-up 結構', () => {
  it('manifest content_scripts 必須列 content/keepalive.js，且在 namespace.js 之後', () => {
    const js = MANIFEST.content_scripts[0].js;
    const nsIdx = js.indexOf('content/namespace.js');
    const kaIdx = js.indexOf('content/keepalive.js');
    assert.ok(kaIdx > -1, 'manifest 必須列 content/keepalive.js');
    assert.ok(nsIdx > -1 && nsIdx < kaIdx, 'keepalive.js 必須在 namespace.js 之後（依賴 NS）');
  });

  it('SW 必須有 onConnect listener、比對 port 名、回 pong', () => {
    assert.ok(/chrome\.runtime\.onConnect\.addListener/.test(SW_SRC),
      'SW 必須註冊 chrome.runtime.onConnect listener');
    assert.ok(new RegExp(`port\\.name !== '${PORT_NAME}'`).test(SW_SRC),
      `SW onConnect 必須比對 port 名 '${PORT_NAME}'（其他 port 不可誤吃）`);
    assert.ok(/port\.postMessage\(\s*\{\s*pong:\s*true\s*\}\s*\)/.test(SW_SRC),
      'SW 收 ping 必須回 { pong: true }');
  });

  it('port 名常數兩側一致（content PORT_NAME ↔ SW 字面值）', () => {
    assert.ok(new RegExp(`PORT_NAME = '${PORT_NAME}'`).test(KEEPALIVE_SRC),
      `content 端 PORT_NAME 必須是 '${PORT_NAME}'`);
  });

  it('SW 必須註冊 runtime.onStartup listener（WPA background 啟動觸發器，v0.8.32）', () => {
    // 2026-06-10 程序層實證：macOS Safari WPA 不會 on-demand spawn extension
    // appex（menu / popup / runtime.connect 都不行），background 只有「session
    // 啟動時被 onStartup 拉起」一條活路；keep-alive port 只負責之後不死。
    // 移除此 listener = WPA 內 ⌥ 預設鍵與 menu 動作回到全滅。
    // 注意帶開括號——guard 行的 `&& chrome.runtime.onStartup.addListener)` 是
    // existence 檢查不是註冊，不可被當成命中（sanity 實測踩過）
    assert.ok(/chrome\.runtime\.onStartup\.addListener\(/.test(SW_SRC),
      'SW 必須實際呼叫 chrome.runtime.onStartup.addListener(...)（空 handler 即可，存在本身是啟動觸發器）');
    assert.ok(/chrome\.runtime\.onStartup\s*&&\s*chrome\.runtime\.onStartup\.addListener/.test(SW_SRC),
      'onStartup 註冊前必須有 existence guard（iOS API 可能缺席）');
  });

  it('content gate 必須是 safari-web-extension:// scheme（結構性平台訊號，非 UA 嗅探）', () => {
    assert.ok(/safari-web-extension:\/\//.test(KEEPALIVE_SRC),
      'keepalive.js 必須以 runtime URL scheme 判斷 Safari');
    assert.ok(!/userAgent/.test(KEEPALIVE_SRC), '不得用 UA 嗅探');
  });
});
