// JRead — 網頁版 host 的擴充 API 替身（v2.6.0）
//
// 第三個 host：一般 https 網頁（JReader 網頁版的 Article Feed / Article View、公開分享頁
// /s/<slug>）。頁面載入的是擴充同一份 reader / content / popup 模組，擴充 API 由本檔替身：
// 形狀與 storage 語意來自 jread/lib/host-shim-core.js（與 iOS App 共用），本檔只提供網頁
// 版的 backend——
//   - storage.sync / storage.local → localStorage（key 前綴 <storagePrefix>sync: /
//     <storagePrefix>local:，值 JSON）。同源的其他分頁改了會收到 storage 事件、發 onChanged
//   - runtime.getURL(path) → host 宣告的 coreBase ＋ path
//   - runtime.getManifest() → { version: <core 版本> }（打包時寫入，見 CORE_VERSION）
//   - 憑證由 host 提供：storageService / jreaderUrl / jreaderToken 被釘住（get 讀到、set 不寫），
//     auth: 'session' 時 token 是 popup-core 的 HOST_SESSION_TOKEN——請求不帶 Authorization、
//     改 credentials: 'include'，cookie 由瀏覽器帶，token 不進 localStorage
//   - runtimeKind：宣告 globalThis.__jreadHost = { kind: 'web', … }（settings-defaults.js
//     runtimeKindOf 讀它；不看 UA）
//
// Host 設定（完整合約見 SPEC.md「Host 合約」）：本檔之前放一個
//   <script type="application/json" id="jread-host-config">{ … }</script>
// （或在 window.__JREAD_HOST_CONFIG 放同一個物件）。沒有設定＝本檔什麼都不做。
// 同源 iframe（設定浮層 popup.html）沒有自己的設定時沿用父頁的。
//
// 這條驗 X、不驗 Y：test/regression/web-host-conformance.spec.js 用 jsdom 載入 core-manifest
// 列出的 article 清單驗進場 / styler / 公開模式零 fetch；web-host-shim.spec.js 驗 storage /
// 設定解析 / 釘住欄位。真瀏覽器 https 頁、跨來源字型、真 cookie session 都不在範圍內。
(function (root, CORE) {
  'use strict';

  if (!CORE || typeof CORE.create !== 'function') return;
  const w = root;
  if (w.__jreadWeb) return;

  // 打包時由 tools/build-web-core.js 換成實際版本（repo 內的原檔保留 dev 標記）
  const CORE_VERSION = '0.0.0-dev';
  // 公開分享頁的 session sentinel——必須與 popup-core.js HOST_SESSION_TOKEN 逐字相同
  //（forcing：web-host-shim.spec.js）。本檔在 popup-core 之前載入，不能讀它
  const HOST_SESSION_TOKEN = '__jread_host_session__';
  const HOST_CONTRACT = 1;

  // ---- 設定 ----------------------------------------------------------------
  function readConfig() {
    if (w.__JREAD_HOST_CONFIG && typeof w.__JREAD_HOST_CONFIG === 'object') return w.__JREAD_HOST_CONFIG;
    try {
      const el = w.document && w.document.getElementById('jread-host-config');
      if (el && el.textContent && el.textContent.trim()) return JSON.parse(el.textContent);
    } catch (e) {
      try { console.error('[JRead web] host 設定 JSON 解析失敗', e); } catch (_) { /* */ }
      return null;
    }
    // 同源 iframe（設定浮層）沿用父頁已解析的設定（不含文章資料）
    try {
      if (w.parent && w.parent !== w && w.parent.__jreadHost && w.parent.__jreadHost.kind === 'web') {
        return w.parent.__jreadHost.frameConfig;
      }
    } catch (_) { /* 跨源 */ }
    return null;
  }
  const cfg = readConfig();
  if (!cfg) return;
  if (cfg.contract != null && Number(cfg.contract) !== HOST_CONTRACT) {
    try { console.error('[JRead web] host 合約版本不符：host 宣告 ' + cfg.contract + '，本 core 為 ' + HOST_CONTRACT); } catch (_) { /* */ }
  }

  const abs = (u) => { try { return new URL(String(u), w.location.href).href; } catch (_) { return ''; } };
  let coreBase = abs(cfg.coreBase || '');
  if (!coreBase) { try { console.error('[JRead web] host 設定缺 coreBase'); } catch (_) { /* */ } return; }
  if (!/\/$/.test(coreBase)) coreBase += '/';
  const readOnly = cfg.mode === 'public';
  const apiBase = typeof cfg.apiBase === 'string' && cfg.apiBase ? abs(cfg.apiBase).replace(/\/+$/, '') : w.location.origin;
  const prefix = typeof cfg.storagePrefix === 'string' && cfg.storagePrefix ? cfg.storagePrefix : 'jread:';

  // ---- 釘住的設定（憑證由 host 提供）-------------------------------------------
  // 公開模式不讀任何憑證（Article View 不打 API）；私人模式一律走 JReader
  const pinnedSync = {};
  if (!readOnly) {
    let token = '';
    if (cfg.auth === 'session') token = HOST_SESSION_TOKEN;
    else if (cfg.auth && typeof cfg.auth.token === 'string') token = cfg.auth.token;
    pinnedSync.storageService = 'jreader';
    pinnedSync.jreaderUrl = apiBase;
    pinnedSync.jreaderToken = token;
  }

  // ---- localStorage backend --------------------------------------------------
  let ls = null;
  try { ls = w.localStorage; ls.getItem('__jread_probe__'); } catch (_) { ls = null; }
  const memory = { sync: {}, local: {} };   // localStorage 不能用（隱私模式 / 被封鎖）時退回記憶體
  const keyOf = (area, k) => prefix + area + ':' + k;
  function readArea(area) {
    if (!ls) return Object.assign({}, memory[area]);
    const out = {};
    const head = prefix + area + ':';
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || k.indexOf(head) !== 0) continue;
      try { out[k.slice(head.length)] = JSON.parse(ls.getItem(k)); } catch (_) { /* 壞值略過 */ }
    }
    return out;
  }
  function load() {
    return Promise.resolve({ sync: readArea('sync'), local: readArea('local') });
  }
  // ---- 擴充設定橋（v3.1.0，擴充端在 content/host-bridge.js）----------------------
  // 裝了 JRead 擴充時網頁版直接用擴充的設定、改了也寫回擴充（Jimmy 2026-11-24：「全部都用
  // extension 的」）。localStorage 仍是本機副本：頁面一開就用上次的設定，不用等擴充；擴充連上
  // 後以擴充為準覆蓋。沒裝擴充＝照舊只用 localStorage。白名單與網址把關都在擴充端
  const BRIDGE = 'jread-bridge';
  const bridgeFlagKey = prefix + 'bridge';
  let applyingBridge = false;
  const bridgeTarget = (() => { try { return w.top || w; } catch (_) { return w; } })();
  function toExt(type, payload) {
    if (readOnly) return; // 公開分享頁不碰訪客的擴充設定
    try { bridgeTarget.postMessage(Object.assign({ [BRIDGE]: 1, from: 'page', type }, payload), w.location.origin); } catch (_) { /* */ }
  }
  function isBridged() {
    try { return !!(ls && ls.getItem(bridgeFlagKey)); } catch (_) { return false; }
  }

  function persist(area, setItems, removeKeys) {
    // 網頁版改的設定（不含套用擴充送來的值）同步寫回擴充。iframe（設定浮層）也直接送到最上層
    if (area === 'sync' && !applyingBridge) {
      if (Object.keys(setItems).length) toExt('set', { items: setItems });
      if (removeKeys.length) toExt('remove', { keys: removeKeys });
    }
    if (!ls) {
      Object.assign(memory[area], setItems);
      for (const k of removeKeys) delete memory[area][k];
      return Promise.resolve();
    }
    try {
      for (const k of Object.keys(setItems)) ls.setItem(keyOf(area, k), JSON.stringify(setItems[k]));
      for (const k of removeKeys) ls.removeItem(keyOf(area, k));
      return Promise.resolve();
    } catch (e) {
      // 配額滿（QuotaExceededError）：與 chrome.storage 超量同樣 reject，呼叫端本來就要容忍
      return Promise.reject(e);
    }
  }

  const host = CORE.create({
    baseUrl: coreBase,
    runtimeId: 'jread-web',
    manifest: { version: CORE_VERSION, name: 'JRead', manifest_version: 3 },
    load,
    persist,
    pinned: { sync: pinnedSync },
    frameKey: '__jreadWeb',
    openOptionsPage: () => toExt('openOptions', {})
  }, w);
  host.install();

  // 擴充送來的設定（只有最上層 frame 收；iframe 靠 localStorage 的 storage 事件跟上）
  let isTop = true;
  try { isTop = w.top === w; } catch (_) { isTop = false; }
  if (isTop && !readOnly) {
    w.addEventListener('message', (e) => {
      if (e.source !== w || e.origin !== w.location.origin) return;
      const d = e.data;
      if (!d || d[BRIDGE] !== 1 || d.from !== 'ext') return;
      if (d.type !== 'snapshot' && d.type !== 'changed') return;
      const items = d.items && typeof d.items === 'object' ? d.items : {};
      host.ready.then(() => {
        const map = host.cache.sync;
        const changes = {};
        const setItems = {};
        const removeKeys = [];
        for (const k of Object.keys(items)) {
          if (pinnedSync[k] !== undefined) continue;
          if (map.has(k) && CORE.same(map.get(k), items[k])) continue;
          changes[k] = map.has(k) ? { oldValue: CORE.clone(map.get(k)), newValue: CORE.clone(items[k]) } : { newValue: CORE.clone(items[k]) };
          setItems[k] = items[k];
        }
        // snapshot：白名單裡擴充沒設過的＝用預設值，網頁版自己存的拿掉；changed：擴充刪掉的
        const gone = d.type === 'snapshot'
          ? (Array.isArray(d.keys) ? d.keys : []).filter((k) => !(k in items))
          : (Array.isArray(d.removed) ? d.removed : []);
        for (const k of gone) {
          if (pinnedSync[k] !== undefined || !map.has(k)) continue;
          changes[k] = { oldValue: CORE.clone(map.get(k)) };
          removeKeys.push(k);
        }
        if (d.type === 'snapshot') { try { if (ls) ls.setItem(bridgeFlagKey, String(Date.now())); } catch (_) { /* */ } }
        if (!Object.keys(changes).length) return;
        applyingBridge = true;
        try { persist('sync', setItems, removeKeys).catch(() => {}); } finally { applyingBridge = false; }
        host.applyRemote(changes, 'sync');
      });
    });
    toExt('hello', {});
  }

  // 同源其他分頁改了 localStorage → 更新本頁 cache、發 onChanged（同頁的 frame 之間走核心的
  // 廣播，storage 事件只在「別的分頁」寫入時觸發）
  try {
    w.addEventListener('storage', (e) => {
      if (!e || !e.key || e.key.indexOf(prefix) !== 0) return;
      const rest = e.key.slice(prefix.length);
      const m = /^(sync|local):(.*)$/.exec(rest);
      if (!m) return;
      const area = m[1];
      const k = m[2];
      const change = {};
      try { if (e.oldValue != null) change.oldValue = JSON.parse(e.oldValue); } catch (_) { /* */ }
      try { if (e.newValue != null) change.newValue = JSON.parse(e.newValue); } catch (_) { return; }
      host.applyRemote({ [k]: change }, area);
    });
  } catch (_) { /* 非瀏覽器環境 */ }

  // 給子 frame 沿用的設定（不含文章與重點：浮層用不到，也不必多複製一份文章）
  const frameConfig = Object.freeze({
    contract: HOST_CONTRACT, coreBase, apiBase, mode: cfg.mode, auth: cfg.auth, storagePrefix: prefix
  });
  const article = readOnly && cfg.article && typeof cfg.article === 'object' ? cfg.article : null;
  const highlights = readOnly && Array.isArray(cfg.highlights) ? cfg.highlights : [];
  w.__jreadHost = Object.freeze({
    kind: 'web',
    contract: HOST_CONTRACT,
    version: CORE_VERSION,
    readOnly,
    coreBase,
    apiBase,
    article,
    highlights,
    exitUrl: typeof cfg.exitUrl === 'string' ? cfg.exitUrl : '',
    frameConfig
  });
  w.__jreadWeb = { ready: host.ready, _remoteChange: host.applyRemote, isWeb: true, isBridged };
})(typeof globalThis !== 'undefined' ? globalThis : window,
   (typeof globalThis !== 'undefined' ? globalThis : window).__JReadHostShimCore);
