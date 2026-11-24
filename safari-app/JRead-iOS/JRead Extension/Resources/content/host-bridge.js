// JRead — 擴充設定橋（v3.1.0）
//
// JRead 網頁版（web core host 頁，例如 JReader）本身就是 JRead，擴充遇到它時讓位（namespace.js
// 不建立 __JRead，見那邊的註解）。讓位之後這支留下來當「設定橋」：網頁版直接用擴充的設定，
// 在網頁版改的設定也寫回擴充——同一個人只有一份設定（Jimmy 2026-11-24：網頁版「全部都用
// extension 的」）。
//
// 安全：
//   - 只在使用者自己設定的 JReader 網址（storage.sync.jreaderUrl 的 origin）上啟動。別的網站
//     就算放了 #jread-host-config 也拿不到任何設定
//   - 只交出 / 只接受 settings-defaults.js 的 HOST_BRIDGE_SYNC_KEYS（白名單）。憑證、服務選擇、
//     自動啟動網域清單一律不出擴充，網頁版也寫不進來
//   - 訊息只收同源（e.origin）、只發給同源（postMessage targetOrigin）
//
// 協定（window.postMessage，資料帶 { 'jread-bridge': 1, from, type }）：
//   ext → page  snapshot { items, keys }  啟動時、收到 hello 時。keys＝白名單全部，items 裡沒有
//                                          的＝擴充沒設過（用預設值），網頁版要把自己存的拿掉
//   ext → page  changed  { items, removed } 擴充這邊的設定變了（含別台裝置同步過來的）
//   page → ext  hello                     網頁版載入時（擴充若比較早就緒，靠這個拿 snapshot）
//   page → ext  set { items } / remove { keys }  網頁版改了設定
//   page → ext  openOptions               設定浮層的「進階設定」
// 網頁版端在 lib/web-host-shim.js。
(function () {
  'use strict';

  // 防重複注入（2026-11-24 審核 C-2）：SW 的 sendWithInjectionFallback 在送不到回應時會重新注入整組
  // content script；沒守門的話每注入一次就多一組監聽器，網頁版改一次設定擴充寫 sync N 次（撞每分鐘
  // 寫入配額、錯誤被吞）。下面也對 DISPATCH_COMMAND / TOGGLE_READER_MODE 直接回應，不讓 SW 走到重注入
  if (globalThis.__jreadHostBridge) return;
  globalThis.__jreadHostBridge = true;

  const BRIDGE = 'jread-bridge';
  // 與 namespace.js NS.MSG.OPEN_OPTIONS 同值（這支跑在擴充讓位的頁面，沒有 NS 可讀；
  // web-host-settings-bridge.spec 綁兩邊相同、SW 有對應 case）
  const MSG_OPEN_OPTIONS = 'OPEN_OPTIONS';
  // 只有「擴充的內容腳本注入 JRead 網頁版」才啟動：這頁是 JRead 網頁版（判準單一資料源在
  // namespace.js 的 __JReadIsWebHostPage，它比這支早載入），而且這不是 host 自己載入的
  //（host 的替身宣告 globalThis.__jreadHost；內容腳本在 isolated world 看不到）
  const isWebHost = globalThis.__JReadIsWebHostPage;
  if (typeof isWebHost !== 'function' || !isWebHost(document) || globalThis.__jreadHost) return;
  const KEYS = globalThis.__JReadHostBridgeKeys;
  const api = globalThis.browser || globalThis.chrome;
  if (!Array.isArray(KEYS) || !api || !api.storage || !api.storage.sync) return;
  const ALLOWED = new Set(KEYS);
  const ORIGIN = location.origin;

  // 擴充工具列 popup 問「這頁的閱讀狀態」時回答「這是 JRead 網頁版」：namespace.js 已讓位、沒有
  // main.js 回 GET_READER_STATE，popup 會以為是一般網頁而露出「啟動閱讀模式 / 進入 Reader」
  //（Jimmy 2026-11-24）。任何 JRead 網頁版都回，不受下面的網址把關限制（這只是頁面種類、不含設定）
  // 與 namespace.js NS.MSG.GET_READER_STATE 同值（message-protocol-consistency.spec 綁）
  const MSG_GET_READER_STATE = 'GET_READER_STATE';
  // manifest 快速鍵（SW 送 DISPATCH_COMMAND）與 popup 的切換（TOGGLE_READER_MODE）：網頁版自己處理
  // 閱讀模式，擴充這邊什麼都不做，但一定要回應——沒有任何監聽器回應時 SW 當作「內容腳本沒注入」
  // 而重新注入（C-2）。值與 namespace.js NS.MSG 同（message-protocol-consistency.spec 綁）
  const MSG_YIELD = new Set(['DISPATCH_COMMAND', 'TOGGLE_READER_MODE']);
  if (api.runtime && api.runtime.onMessage && typeof api.runtime.onMessage.addListener === 'function') {
    api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg) return undefined;
      let res = null;
      if (msg.type === MSG_GET_READER_STATE) res = { jreadWebHost: true, active: false };
      else if (MSG_YIELD.has(msg.type)) res = { ok: false, jreadWebHost: true };
      if (!res) return undefined;
      try { sendResponse(res); } catch (_) { /* */ }
      return undefined;
    });
  }

  function pick(obj) {
    const out = {};
    for (const k of Object.keys(obj || {})) if (ALLOWED.has(k)) out[k] = obj[k];
    return out;
  }

  // 網頁版寫進來的值先驗過（2026-11-24 審核 C-3）：白名單只擋 key，同源腳本仍能寫進壞掉的值，
  // 經 storage.sync 擴散到所有裝置。規則：
  //   - 每個值 JSON 化後不超過 MAX_ITEM_BYTES（storage.sync 單項上限 8KB）
  //   - profiles / customShortcuts 走既有消毒（settings-defaults 的 __JReadProfiles.sanitize、
  //     shortcut-utils 的 sanitizeTable；後者比這支晚載入，用到時才讀）
  //   - DEFAULT_SETTINGS 有的欄位：型別要跟預設值一樣（數字要是有限值；activeProfile 可為 null 或字串）
  //   - 預設值裡沒有的兩個 runtime 欄位：floatingIcon 布林、floatingIconPos { edge, offsetY }
  //   不合格的那一項丟掉，其他照收
  const MAX_ITEM_BYTES = 8192;
  function cleanValue(k, v) {
    let json;
    try { json = JSON.stringify(v); } catch (_) { return undefined; }
    if (json === undefined || json.length > MAX_ITEM_BYTES) return undefined;
    if (k === 'profiles') {
      const P = globalThis.__JReadProfiles;
      return Array.isArray(v) && P && typeof P.sanitize === 'function' ? P.sanitize(v) : undefined;
    }
    if (k === 'customShortcuts') {
      const SC = globalThis.__JReadShortcuts;
      return v && typeof v === 'object' && !Array.isArray(v) && SC && typeof SC.sanitizeTable === 'function' ? SC.sanitizeTable(v) : undefined;
    }
    if (k === 'activeProfile') return v === null || typeof v === 'string' ? v : undefined;
    if (k === 'floatingIcon') return typeof v === 'boolean' ? v : undefined;
    if (k === 'floatingIconPos') {
      return v && typeof v === 'object' && (v.edge === 'left' || v.edge === 'right') && typeof v.offsetY === 'number' && isFinite(v.offsetY)
        ? { edge: v.edge, offsetY: v.offsetY } : undefined;
    }
    const D = globalThis.__JReadSettingsDefaults;
    if (!D || !(k in D)) return undefined;
    const def = D[k];
    if (typeof def === 'number') return typeof v === 'number' && isFinite(v) ? v : undefined;
    return typeof v === typeof def && v !== null && !Array.isArray(v) ? v : undefined;
  }
  function cleanItems(obj) {
    const out = {};
    const raw = pick(obj);
    for (const k of Object.keys(raw)) {
      const v = cleanValue(k, raw[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  function post(type, payload) {
    try { window.postMessage(Object.assign({ [BRIDGE]: 1, from: 'ext', type }, payload), ORIGIN); } catch (_) { /* */ }
  }
  function sendSnapshot() {
    return Promise.resolve(api.storage.sync.get(KEYS)).then((items) => {
      post('snapshot', { items: pick(items), keys: KEYS.slice() });
    }).catch(() => {});
  }

  function originOf(raw) {
    try { return new URL(String(raw || '').trim()).origin; } catch (_) { return ''; }
  }

  function start() {
    window.addEventListener('message', (e) => {
      if (e.origin !== ORIGIN) return;
      const d = e.data;
      if (!d || d[BRIDGE] !== 1 || d.from !== 'page') return;
      if (d.type === 'hello') { sendSnapshot(); return; }
      if (d.type === 'set') {
        const items = cleanItems(d.items);
        if (Object.keys(items).length) Promise.resolve(api.storage.sync.set(items)).catch(() => {});
        return;
      }
      if (d.type === 'remove') {
        const keys = (Array.isArray(d.keys) ? d.keys : []).filter((k) => ALLOWED.has(k));
        if (keys.length) Promise.resolve(api.storage.sync.remove(keys)).catch(() => {});
        return;
      }
      if (d.type === 'openOptions') {
        try { Promise.resolve(api.runtime.sendMessage({ type: MSG_OPEN_OPTIONS })).catch(() => {}); } catch (_) { /* */ }
      }
    });
    if (api.storage.onChanged && typeof api.storage.onChanged.addListener === 'function') {
      api.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        const items = {};
        const removed = [];
        for (const k of Object.keys(changes || {})) {
          if (!ALLOWED.has(k)) continue;
          if ('newValue' in changes[k]) items[k] = changes[k].newValue;
          else removed.push(k);
        }
        if (Object.keys(items).length || removed.length) post('changed', { items, removed });
      });
    }
    sendSnapshot();
  }

  // 只對使用者自己的 JReader 網址啟動
  Promise.resolve(api.storage.sync.get({ jreaderUrl: '' })).then((s) => {
    if (originOf(s && s.jreaderUrl) === ORIGIN) start();
  }).catch(() => {});
})();
