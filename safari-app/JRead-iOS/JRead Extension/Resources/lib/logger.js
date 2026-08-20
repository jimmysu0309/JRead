// JRead — 統一除錯記錄（v1.8.0）
//
// 動機（Jimmy 2026-08-20）：使用者回報「翻譯後送出去沒反應」時，擴充端沒有留下
// 任何可回查的軌跡——SW console 要當場開著才看得到、關掉分頁就沒了，於是每次
// 真機 bug 都得靠猜或請 Jimmy 貼 console。移植姊妹專案 Shinkansen 的 log 機制
// （lib/logger.js）：記憶體 ring + storage.local 持久化 ring，事後在偏好設定頁
// 「除錯記錄」直接回查。
//
// 架構：IIFE dual export（與 lib/instapaper.js 同款）
//   - service-worker.js 以 importScripts 載入（掛 self.__JReadLogger）
//   - content script 由 manifest 載入（掛 window.__JReadLogger）
//   - popup / options / reader 等擴充頁以 <script> 載入
//   - jsdom spec 以 require 載入（依賴注入 storage，不碰真實 API）
// 每個 context 有各自的記憶體 ring（互不相通），**持久化 ring 是共用的那一份**
// ——options 頁讀 storage.local 就能看到 SW 與 content 兩端的軌跡合流。
//
// 這條驗 X、不驗 Y：log 是**事後回查**的證據，不是即時監控。SW 被終止時最後一批
// debounce 中的 pending 會掉（best-effort，與 Shinkansen 同一取捨）；也不保證
// 記錄順序在跨 context 時嚴格單調（兩端各自的時鐘與 flush 時機不同，靠 t 排序）。
//
// 分類（category）：
//   save    — 送到儲存服務的完整流程（觸發 → 抽取 → 摘要 → 送出 → 結果）
//   detect  — 主文偵測
//   clean   — 雜訊清除
//   style   — 排版套用
//   paged   — 翻頁模式
//   system  — 啟動 / 設定變更 / 訊息協定
//
// 記錄策略（避免 storage 被高頻 log 灌爆）：
//   - save / system 與任何 level='error'：**一律**記錄並持久化（低頻、診斷價值最高）
//   - detect / clean / style / paged：只在偏好設定的「除錯記錄」開關開啟時記錄
//   - console 輸出一律受開關控制（平時不吵）
(function () {
  'use strict';

  const MAX_MEM = 500;              // 記憶體 ring 上限（每個 context 各一份）
  const PERSIST_KEY = 'jreadDebugLog';
  const PERSIST_MAX = 200;          // 持久化 ring 上限（跨 context 共用）
  const FLUSH_MS = 300;             // 批次寫入 debounce（避免每筆都重寫整個陣列）
  const DATA_MAX_CHARS = 2000;      // 單筆結構化資料序列化上限

  // 高頻分類：只在開關開啟時記錄（開關關閉時完全不進 ring，零成本）
  const HOT_CATEGORIES = ['detect', 'clean', 'style', 'paged'];

  const memBuffer = [];
  let seq = 0;
  let enabled = false;              // 「除錯記錄」開關快取（由 settings 同步）
  let contextName = 'unknown';
  let storageArea = null;           // { get, set, remove } —— 注入或自動偵測
  let pending = [];
  let flushTimer = null;
  let writeQueue = Promise.resolve();

  function detectContext() {
    try {
      if (typeof window === 'undefined') return 'sw';
      const href = (window.location && window.location.href) || '';
      if (/^(chrome|moz|safari)-extension:/.test(href)) {
        const file = href.split('/').pop().split('?')[0];
        return file.replace(/\.html$/, '') || 'page';
      }
      return 'content';
    } catch (_) { return 'unknown'; }
  }

  function detectStorage() {
    try {
      const api = (typeof globalThis !== 'undefined')
        && (globalThis.browser || globalThis.chrome);
      if (api && api.storage && api.storage.local) return api.storage.local;
    } catch (_) { /* 無擴充 API（jsdom spec）→ 只留記憶體 ring */ }
    return null;
  }

  function shouldRecord(level, category) {
    if (level === 'error' || level === 'warn') return true;
    if (HOT_CATEGORIES.indexOf(category) < 0) return true;   // save / system 等一律記
    return enabled;
  }

  // 結構化資料序列化：超長截斷成 preview（截斷後的 JSON 字串不可再 parse，
  // 直接給可讀前段 + 原始長度，與 Shinkansen 同一教訓）
  function sanitize(data) {
    if (data == null) return undefined;
    try {
      const s = JSON.stringify(data);
      if (s.length > DATA_MAX_CHARS) {
        return { _truncated: true, originalLength: s.length, preview: s.slice(0, DATA_MAX_CHARS) };
      }
      return JSON.parse(s);
    } catch (_) {
      return String(data);
    }
  }

  function scheduleFlush() {
    if (flushTimer) return;
    const timerHost = (typeof setTimeout === 'function') ? setTimeout : null;
    if (!timerHost) { flush(); return; }
    flushTimer = timerHost(flush, FLUSH_MS);
  }

  function flush() {
    flushTimer = null;
    if (!pending.length) return;
    const store = storageArea || detectStorage();
    if (!store) { pending = []; return; }
    const batch = pending;
    pending = [];
    // 序列化寫入：避免平行 read-modify-write 互相蓋掉（get → push → set 不是原子操作）
    writeQueue = writeQueue.then(async () => {
      try {
        const got = await store.get(PERSIST_KEY);
        const logs = (got && Array.isArray(got[PERSIST_KEY])) ? got[PERSIST_KEY] : [];
        logs.push.apply(logs, batch);
        if (logs.length > PERSIST_MAX) logs.splice(0, logs.length - PERSIST_MAX);
        await store.set({ [PERSIST_KEY]: logs });
      } catch (_) { /* 寫入失敗不影響記憶體 ring，也不可卡住 queue */ }
    });
    return writeQueue;
  }

  function log(level, category, message, data) {
    const cat = category || 'system';
    const lvl = level || 'info';
    if (!shouldRecord(lvl, cat)) return null;
    const entry = {
      seq: ++seq,
      t: new Date().toISOString(),
      ctx: contextName,
      level: lvl,
      category: cat,
      message: String(message == null ? '' : message),
      data: sanitize(data)
    };
    memBuffer.push(entry);
    while (memBuffer.length > MAX_MEM) memBuffer.shift();
    pending.push(entry);
    if (pending.length > PERSIST_MAX) pending.splice(0, pending.length - PERSIST_MAX);
    scheduleFlush();
    if (enabled && typeof console !== 'undefined') {
      const tag = `[JRead][${cat}]`;
      try {
        if (lvl === 'error') console.error(tag, entry.message, data);
        else if (lvl === 'warn') console.warn(tag, entry.message, data);
        else console.log(tag, entry.message, data);
      } catch (_) { /* console 不可用 */ }
    }
    return entry;
  }

  /** 讀持久化 ring（先 flush 掉 debounce 中的批次，讀取端才不會少最後幾筆）。 */
  async function getPersistedLogs() {
    if (flushTimer && typeof clearTimeout === 'function') {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flush();
    await writeQueue;
    const store = storageArea || detectStorage();
    if (!store) return [];
    try {
      const got = await store.get(PERSIST_KEY);
      return (got && Array.isArray(got[PERSIST_KEY])) ? got[PERSIST_KEY] : [];
    } catch (_) { return []; }
  }

  /** 清空記憶體 ring + 持久化 ring（連 pending 一起丟，否則 flush 會把剛清掉的寫回）。 */
  async function clearLogs() {
    memBuffer.length = 0;
    pending = [];
    if (flushTimer && typeof clearTimeout === 'function') {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await writeQueue;
    const store = storageArea || detectStorage();
    if (!store) return;
    try {
      if (typeof store.remove === 'function') await store.remove(PERSIST_KEY);
      else await store.set({ [PERSIST_KEY]: [] });
    } catch (_) { /* 清不掉就算了，log 是 best-effort */ }
  }

  const api = {
    /**
     * 設定 logger。呼叫端（SW / content / 擴充頁）在啟動時給開關值；
     * 測試走 storage 注入，不碰真實擴充 API。
     * @param {{enabled?:boolean, context?:string, storage?:object}} opts
     */
    configure(opts) {
      const o = opts || {};
      if (typeof o.enabled === 'boolean') enabled = o.enabled;
      if (typeof o.context === 'string' && o.context) contextName = o.context;
      if (o.storage) storageArea = o.storage;
      return api;
    },
    setEnabled(v) { enabled = !!v; return api; },
    isEnabled() { return enabled; },
    log,
    info: (category, message, data) => log('info', category, message, data),
    warn: (category, message, data) => log('warn', category, message, data),
    error: (category, message, data) => log('error', category, message, data),
    /** 記憶體 ring 差量拉取（同一 context 內用）。 */
    getLogs(afterSeq) {
      const after = afterSeq > 0 ? afterSeq : 0;
      return {
        logs: after ? memBuffer.filter((e) => e.seq > after) : memBuffer.slice(),
        latestSeq: seq
      };
    },
    getPersistedLogs,
    clearLogs,
    flush,
    PERSIST_KEY,
    PERSIST_MAX,
    MAX_MEM,
    HOT_CATEGORIES: HOT_CATEGORIES.slice()
  };

  contextName = detectContext();

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.__JReadLogger = api;
})();
