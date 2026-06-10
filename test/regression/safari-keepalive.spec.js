// JRead — Safari background 存活機制（v0.8.30 引入，v0.8.33 重整）
//
// 機制兩段（content/keepalive.js）：
// (A) wake ping（Safari 全平台）：content 載入發一發 BG_WAKE_PING——macOS WPA
//     的 background 不會因 commands / menu / popup 啟動（2026-06-10 程序層 +
//     行為層實測），Shinkansen 的 content 每頁 sendMessage、其 commands 在 WPA
//     可用，對齊此喚醒路徑。
// (B) keep-alive port（觸控裝置限定 = 真 iOS / iPadOS）：iOS background 閒置
//     被永久回收（Apple Forums 758346）→ 20s ping 防回收。v0.8.33 起 macOS
//     Safari / WPA 不跑——v0.8.30-32 port 無 null guard 疑似 TypeError 中止
//     同批 content script（WPA 內連 ⌃R 都死的回歸根因），且 macOS 本不需要。
//
// 訊號層次說明：本檔驗 (A)(B) 行為邏輯（sandbox 注入 mock）與兩側 wire-up。
// **不驗** Safari 實機回收時序與 WPA 喚醒效果——只能靠 TestFlight 實機驗收。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const KEEPALIVE_SRC = fs.readFileSync(path.join(ROOT, 'content', 'keepalive.js'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'background', 'service-worker.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const PORT_NAME = 'jread-keepalive';

// ── sandbox 載入 keepalive.js ────────────────────────────────────────────
// IIFE 引用的全域（window / document / chrome / navigator / timer）全部以
// Function 參數 shadow 注入，timer 用手動 mock 控制觸發時機。
function loadKeepalive(opts = {}) {
  const {
    scheme = 'safari-web-extension://abc/', // 預設模擬 Safari
    hidden = false,
    runtimeId = 'ext-id',
    touch = 5,                              // 預設模擬 iOS（觸控）
    connectReturnsNull = false
  } = opts;

  const env = {
    connects: [],          // 歷次 connect 產生的 mock port
    intervals: [],         // { fn, ms }
    timeouts: [],          // { fn, ms }
    visibilityHandlers: [],
    sent: [],              // safeSendMessage 收到的訊息
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
      lastError: undefined,
      getURL: () => scheme,
      connect({ name }) {
        if (connectReturnsNull) { env.connects.push(null); return null; }
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

  const navigatorMock = { maxTouchPoints: touch };

  const windowMock = {
    __JRead: {
      safeSendMessage(msg, cb) {
        env.sent.push(msg);
        if (cb) cb({ ok: true });
      }
    }
  };

  const fn = new Function(
    'window', 'document', 'chrome', 'navigator',
    'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
    KEEPALIVE_SRC
  );
  fn(
    windowMock, documentMock, chromeMock, navigatorMock,
    (cb, ms) => { env.intervals.push({ fn: cb, ms }); return env.intervals.length; },
    () => {},
    (cb, ms) => { env.timeouts.push({ fn: cb, ms }); return env.timeouts.length; },
    () => {}
  );

  env.NS = windowMock.__JRead;
  env.realConnects = () => env.connects.filter(Boolean);
  env.setHidden = (h) => { env.document.hidden = h; };
  env.fireVisibility = () => env.visibilityHandlers.forEach((f) => f());
  return env;
}

describe('(A) wake ping — Safari 全平台喚醒訊息', () => {
  it('Safari（觸控）→ 發 BG_WAKE_PING', () => {
    const env = loadKeepalive();
    assert.strictEqual(env.sent.length, 1);
    assert.strictEqual(env.sent[0].type, 'BG_WAKE_PING');
  });

  it('Safari（無觸控 = macOS Safari / WPA）→ 仍發 BG_WAKE_PING、但不開 port', () => {
    const env = loadKeepalive({ touch: 0 });
    assert.strictEqual(env.sent.length, 1, 'macOS Safari 也要發 wake ping（WPA 喚醒 background 的主通道）');
    assert.strictEqual(env.connects.length, 0, 'macOS（無觸控）不得開 keep-alive port');
    assert.strictEqual(env.visibilityHandlers.length, 0, 'macOS 不得掛 visibilitychange listener');
  });

  it('Chrome 軌 → 不發 wake ping、不開 port', () => {
    const env = loadKeepalive({ scheme: 'chrome-extension://abc/' });
    assert.strictEqual(env.sent.length, 0);
    assert.strictEqual(env.connects.length, 0);
    assert.strictEqual(env.visibilityHandlers.length, 0);
  });
});

describe('(B) keep-alive port — 觸控裝置（iOS / iPadOS）限定', () => {
  it('Safari + 觸控 + 分頁可見 → 立即開 port（name=jread-keepalive）', () => {
    const env = loadKeepalive();
    assert.strictEqual(env.realConnects().length, 1, '必須 connect 恰好 1 次');
    assert.strictEqual(env.realConnects()[0].name, PORT_NAME);
  });

  it('connect 回傳 null（WPA background 拉不起來）→ 不 throw、不掛 listener', () => {
    // v0.8.30-32 回歸根因 forcing：port 無 null guard 的 TypeError 可能中止
    // 同批 content script 後續檔案執行（WPA 內連 ⌃R 都死）
    assert.doesNotThrow(() => {
      const env = loadKeepalive({ connectReturnsNull: true });
      assert.strictEqual(env.intervals.length, 0, 'port null 時不得掛 ping interval');
    });
  });

  it('分頁不可見時載入 → 不開 port；轉可見後開', () => {
    const env = loadKeepalive({ hidden: true });
    assert.strictEqual(env.realConnects().length, 0, 'hidden 時不得 connect');
    env.setHidden(false);
    env.fireVisibility();
    assert.strictEqual(env.realConnects().length, 1, '轉可見後必須 connect');
  });

  it('context invalidated（runtime.id 空）→ 不 connect', () => {
    // 註：傳 null 而非 undefined——undefined 會被 loadKeepalive 的 destructuring
    // 預設值蓋回 'ext-id'；keepalive 的 `!chrome.runtime.id` guard 兩者都擋
    const env = loadKeepalive({ runtimeId: null });
    assert.strictEqual(env.realConnects().length, 0);
  });

  it('ping interval 觸發 → port.postMessage；間隔 20s（< Safari ~30s 回收窗）', () => {
    const env = loadKeepalive();
    assert.strictEqual(env.intervals.length, 1, '必須掛恰好 1 個 interval');
    assert.strictEqual(env.intervals[0].ms, 20000, 'ping 間隔必須 20000ms');
    env.intervals[0].fn();
    env.intervals[0].fn();
    assert.strictEqual(env.realConnects()[0].posted.length, 2, '每次 interval 觸發必須 ping 一次');
  });

  it('port 斷線（background 被回收）→ 1s 後重連；重連的 connect 喚回 event page', () => {
    const env = loadKeepalive();
    env.realConnects()[0]._onDisconnect.forEach((f) => f());
    const reconnect = env.timeouts.find((t) => t.ms === 1000);
    assert.ok(reconnect, '斷線後必須排 1s 重連 timeout');
    reconnect.fn();
    assert.strictEqual(env.realConnects().length, 2, '重連必須再 connect 一次');
  });

  it('斷線時分頁不可見 → 不排重連（省電）', () => {
    const env = loadKeepalive();
    env.setHidden(true);
    env.realConnects()[0]._onDisconnect.forEach((f) => f());
    assert.strictEqual(env.timeouts.length, 0, 'hidden 時斷線不得排重連');
  });

  it('轉不可見 → 主動 disconnect 斷線省電', () => {
    const env = loadKeepalive();
    env.setHidden(true);
    env.fireVisibility();
    assert.strictEqual(env.realConnects()[0].disconnected, true, 'hidden 必須 disconnect');
  });

  it('收到 pong → NS.keepalive.alive 記錄存活（自動化 round-trip 驗證點）', () => {
    const env = loadKeepalive();
    assert.strictEqual(env.NS.keepalive.alive, false);
    env.realConnects()[0]._onMessage.forEach((f) => f({ pong: true }));
    assert.strictEqual(env.NS.keepalive.alive, true);
  });
});

describe('(C) wire-up 結構', () => {
  it('manifest content_scripts 必須列 content/keepalive.js，且在 namespace.js 之後', () => {
    const js = MANIFEST.content_scripts[0].js;
    const nsIdx = js.indexOf('content/namespace.js');
    const kaIdx = js.indexOf('content/keepalive.js');
    assert.ok(kaIdx > -1, 'manifest 必須列 content/keepalive.js');
    assert.ok(nsIdx > -1 && nsIdx < kaIdx, 'keepalive.js 必須在 namespace.js 之後（依賴 NS.safeSendMessage）');
  });

  it('SW 必須有 onConnect listener、比對 port 名、回 pong', () => {
    assert.ok(/chrome\.runtime\.onConnect\.addListener/.test(SW_SRC),
      'SW 必須註冊 chrome.runtime.onConnect listener');
    assert.ok(new RegExp(`port\\.name !== '${PORT_NAME}'`).test(SW_SRC),
      `SW onConnect 必須比對 port 名 '${PORT_NAME}'（其他 port 不可誤吃）`);
    assert.ok(/port\.postMessage\(\s*\{\s*pong:\s*true\s*\}\s*\)/.test(SW_SRC),
      'SW 收 ping 必須回 { pong: true }');
  });

  it('SW 必須有 BG_WAKE_PING case 且回 ok（v0.8.33 wake ping 對端）', () => {
    assert.ok(/case\s+'BG_WAKE_PING':/.test(SW_SRC),
      'SW onMessage 必須有 BG_WAKE_PING case');
    const m = SW_SRC.match(/case\s+'BG_WAKE_PING':\s*\{([\s\S]*?)\}\s*case/);
    assert.ok(m && /sendResponse\(\s*\{\s*ok:\s*true\s*\}\s*\)/.test(m[1]),
      'BG_WAKE_PING 必須 sendResponse({ ok: true })（不留 lastError 警告）');
  });

  it('SW 必須註冊 runtime.onStartup listener（WPA background 啟動觸發器，v0.8.32）', () => {
    // 注意帶開括號——guard 行的 `&& chrome.runtime.onStartup.addListener)` 是
    // existence 檢查不是註冊，不可被當成命中（sanity 實測踩過）
    assert.ok(/chrome\.runtime\.onStartup\.addListener\(/.test(SW_SRC),
      'SW 必須實際呼叫 chrome.runtime.onStartup.addListener(...)（空 handler 即可，存在本身是啟動觸發器）');
    assert.ok(/chrome\.runtime\.onStartup\s*&&\s*chrome\.runtime\.onStartup\.addListener/.test(SW_SRC),
      'onStartup 註冊前必須有 existence guard（iOS API 可能缺席）');
  });

  it('port 名常數兩側一致（content PORT_NAME ↔ SW 字面值）', () => {
    assert.ok(new RegExp(`PORT_NAME = '${PORT_NAME}'`).test(KEEPALIVE_SRC),
      `content 端 PORT_NAME 必須是 '${PORT_NAME}'`);
  });

  it('content gate 必須是 safari-web-extension:// scheme + maxTouchPoints（結構性訊號，非 UA 嗅探）', () => {
    assert.ok(/safari-web-extension:\/\//.test(KEEPALIVE_SRC),
      'keepalive.js 必須以 runtime URL scheme 判斷 Safari');
    assert.ok(/maxTouchPoints/.test(KEEPALIVE_SRC),
      'keep-alive port 必須以 maxTouchPoints gate 到觸控裝置（macOS WPA 不可開 port）');
    assert.ok(!/userAgent/.test(KEEPALIVE_SRC), '不得用 UA 嗅探');
  });
});
