// JRead iOS App — App 內 JReader 的擴充 API 替身（v2.2.0）
//
// App 用 WKWebView 以 jread-app:// 載入擴充同一份 reader/reader.html、article.html
// （檔案直接讀 App bundle 裡 JRead Extension.appex 的 Resources，不另存一份）。
// 那些頁面呼叫的是擴充 API（browser.storage / runtime…），App 裡沒有，本檔在
// document start 先把 browser / chrome 換成替身，背後走 WKScriptMessageHandlerWithReply
// （ViewController.swift 的 "jread" handler）：
//   - storage.sync  ↔ App Group 鏡像（AppSyncStore.swift，與 Safari 擴充雙向同步，逐鍵 LWW）
//   - storage.local ↔ App 自己的檔案（閱讀位置、feed 快取、這台裝置套用的設定檔）
//   - 跨來源 fetch  → 原生 URLSession（Instapaper API 不開 CORS，網頁端直接打會被擋）
//   - runtime.sendMessage 等 background 才有的能力 → 沒有 background，一律 resolve undefined
//     （與 Safari 對沒有 listener 的 sendMessage 行為相同，呼叫端本來就要容忍）
//
// 這條驗 X、不驗 Y：test/regression/ios-app-jreader-shim.spec.js 用 jsdom + 假 bridge
// 驗 storage 語意、onChanged、fetch 轉送；WKWebView 實際載入、原生 bridge 回傳格式、
// App Group 跨 process 讀寫只能模擬器驗。

(function () {
  'use strict';

  if (location.protocol !== 'jread-app:') return;
  if (window.__jreadApp) return;

  const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.jread;
  const call = (msg) => Promise.resolve(handler ? handler.postMessage(msg) : null)
    .then((r) => (typeof r === 'string' ? JSON.parse(r) : (r || {})));

  const BASE = location.protocol + '//' + location.host + '/';
  const MANIFEST = window.__JREAD_APP_MANIFEST || { version: '0.0.0' };
  const CREDENTIAL_KEYS = ['storageService', 'readwiseToken', 'instapaperToken', 'instapaperTokenSecret'];

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function makeEvent() {
    const ls = new Set();
    return {
      addListener: (fn) => { if (typeof fn === 'function') ls.add(fn); },
      removeListener: (fn) => { ls.delete(fn); },
      hasListener: (fn) => ls.has(fn),
      _fire: (...args) => { for (const fn of Array.from(ls)) { try { fn(...args); } catch (e) { console.error(e); } } }
    };
  }
  const onChanged = makeEvent();

  // ---- storage ------------------------------------------------------------
  const cache = { sync: new Map(), local: new Map() };

  function entriesToMap(entries, map) {
    map.clear();
    for (const k of Object.keys(entries || {})) {
      const e = entries[k];
      if (!e || e.del || typeof e.vj !== 'string') continue;
      try { map.set(k, JSON.parse(e.vj)); } catch (_) { /* 壞值略過 */ }
    }
  }

  const ready = Promise.all([call({ op: 'syncLoad' }), call({ op: 'localLoad' })])
    .then(([s, l]) => {
      entriesToMap(s.entries, cache.sync);
      for (const k of Object.keys((l && l.items) || {})) {
        try { cache.local.set(k, JSON.parse(l.items[k])); } catch (_) { /* 壞值略過 */ }
      }
    })
    .catch((e) => { console.error('[JReader app] storage 載入失敗', e); });

  function fire(changes, area) {
    if (!Object.keys(changes).length) return;
    setTimeout(() => onChanged._fire(changes, area), 0);
  }

  function persist(area, setItems, removeKeys) {
    if (area === 'sync') {
      const now = Date.now();
      const entries = {};
      for (const k of Object.keys(setItems)) entries[k] = { vj: JSON.stringify(setItems[k]), ts: now };
      for (const k of removeKeys) entries[k] = { del: true, ts: now };
      return call({ op: 'syncPut', entries: JSON.stringify(entries) });
    }
    const items = {};
    for (const k of Object.keys(setItems)) items[k] = JSON.stringify(setItems[k]);
    return call({ op: 'localPut', items: JSON.stringify(items), remove: removeKeys });
  }

  function makeArea(area) {
    const map = cache[area];
    return {
      get(keys) {
        return ready.then(() => {
          const out = {};
          if (keys === null || keys === undefined) {
            for (const [k, v] of map) out[k] = clone(v);
          } else if (typeof keys === 'string') {
            if (map.has(keys)) out[keys] = clone(map.get(keys));
          } else if (Array.isArray(keys)) {
            for (const k of keys) if (map.has(k)) out[k] = clone(map.get(k));
          } else if (typeof keys === 'object') {
            for (const k of Object.keys(keys)) out[k] = map.has(k) ? clone(map.get(k)) : clone(keys[k]);
          }
          return out;
        });
      },
      set(items) {
        return ready.then(() => {
          const changes = {};
          const setItems = {};
          for (const k of Object.keys(items || {})) {
            if (items[k] === undefined) continue;
            const v = clone(items[k]);
            const had = map.has(k);
            const old = map.get(k);
            map.set(k, v);
            setItems[k] = v;
            if (!had || !same(old, v)) changes[k] = had ? { oldValue: clone(old), newValue: clone(v) } : { newValue: clone(v) };
          }
          fire(changes, area);
          if (!Object.keys(setItems).length) return undefined;
          return persist(area, setItems, []).then(() => undefined);
        });
      },
      remove(keys) {
        return ready.then(() => {
          const list = (Array.isArray(keys) ? keys : [keys]).filter((k) => typeof k === 'string');
          const changes = {};
          const removed = [];
          for (const k of list) {
            if (!map.has(k)) continue;
            changes[k] = { oldValue: clone(map.get(k)) };
            map.delete(k);
            removed.push(k);
          }
          fire(changes, area);
          if (!removed.length) return undefined;
          return persist(area, {}, removed).then(() => undefined);
        });
      },
      clear() {
        return ready.then(() => this.remove(Array.from(map.keys())));
      }
    };
  }

  // 回前景（ViewController 在 willEnterForeground 呼叫）：重讀鏡像，Safari 擴充那邊改過的
  // 設定 diff 後發 onChanged——article.html 既有的 storage.onChanged → scheduleReapply 即時重套。
  // feed 頁只在載入時讀一次憑證，憑證 / 儲存服務變了就整頁重載。
  function onForeground() {
    return ready.then(() => call({ op: 'syncLoad' })).then((s) => {
      const next = new Map();
      entriesToMap(s.entries, next);
      const changes = {};
      for (const [k, v] of next) {
        if (!cache.sync.has(k)) changes[k] = { newValue: clone(v) };
        else if (!same(cache.sync.get(k), v)) changes[k] = { oldValue: clone(cache.sync.get(k)), newValue: clone(v) };
      }
      for (const [k, v] of cache.sync) if (!next.has(k)) changes[k] = { oldValue: clone(v) };
      cache.sync.clear();
      for (const [k, v] of next) cache.sync.set(k, v);
      const keys = Object.keys(changes);
      if (!keys.length) return keys;
      if (/\/reader\/reader\.html$/.test(location.pathname) && keys.some((k) => CREDENTIAL_KEYS.includes(k))) {
        location.reload();
        return keys;
      }
      onChanged._fire(changes, 'sync');
      return keys;
    }).catch(() => []);
  }

  // ---- fetch：跨來源 http(s) 交給原生 URLSession --------------------------
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  function b64ToBytes(b64) {
    const bin = atob(b64 || '');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function appFetch(input, init) {
    const opts = init || {};
    const req = (typeof Request !== 'undefined' && input instanceof Request) ? input : null;
    const rawUrl = req ? req.url : String(input);
    let abs;
    try { abs = new URL(rawUrl, location.href); } catch (_) { abs = null; }
    if (!abs || !/^https?:$/.test(abs.protocol)) {
      return nativeFetch ? nativeFetch(input, init) : Promise.reject(new TypeError('fetch unavailable'));
    }
    const signal = opts.signal || (req && req.signal) || null;
    if (signal && signal.aborted) return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    const headers = {};
    new Headers(opts.headers || (req && req.headers) || {}).forEach((v, k) => { headers[k] = v; });
    let body = opts.body;
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
      if (!headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
      body = body.toString();
    } else if (body !== undefined && body !== null && typeof body !== 'string') {
      return Promise.reject(new TypeError('JReader App：不支援的 fetch body 型別'));
    }
    const method = String(opts.method || (req && req.method) || 'GET').toUpperCase();
    const p = call({ op: 'fetch', url: abs.href, method, headers, body: body == null ? null : body }).then((r) => {
      if (!r || r.error) throw new TypeError('Load failed' + (r && r.error ? '：' + r.error : ''));
      const status = r.status | 0;
      const nullBody = status === 204 || status === 205 || status === 304 || method === 'HEAD';
      const resp = new Response(nullBody ? null : b64ToBytes(r.bodyB64), {
        status: status >= 200 && status <= 599 ? status : 502,
        statusText: r.statusText || '',
        headers: r.headers || {}
      });
      try { Object.defineProperty(resp, 'url', { value: r.url || abs.href }); } catch (_) { /* 唯讀就算了 */ }
      return resp;
    });
    if (!signal) return p;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }
  window.fetch = appFetch;

  // ---- browser / chrome 替身 ----------------------------------------------
  const noopEvent = () => makeEvent();
  const api = {
    runtime: {
      id: 'jread-app',
      lastError: undefined,
      getURL: (p) => BASE + String(p || '').replace(/^\//, ''),
      getManifest: () => clone(MANIFEST),
      sendMessage: () => Promise.resolve(undefined),
      openOptionsPage: () => Promise.resolve(),
      onMessage: noopEvent(),
      onInstalled: noopEvent(),
      onStartup: noopEvent()
    },
    storage: { sync: makeArea('sync'), local: makeArea('local'), onChanged },
    tabs: {
      query: () => Promise.resolve([]),
      sendMessage: () => Promise.resolve(undefined),
      create: (o) => { if (o && o.url) location.href = o.url; return Promise.resolve({}); }
    },
    i18n: { getMessage: () => '' }
  };
  window.browser = api;
  window.chrome = api;

  // ---- 安全區域底色（v2.2.1）-----------------------------------------------
  // 狀態列 / Home 指示條那兩條由 App 原生著色：取畫面頂端中央往上找第一個不透明底色
  // （翻頁模式＝卡片色、捲動模式＝頁面底色），變了才回報。主題切換、進出翻頁都會改
  // <html> / <head> / <body> 的屬性或子節點 → MutationObserver（不掃 subtree）+ debounce。
  function isOpaque(c) {
    if (!c || c === 'transparent') return false;
    const m = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(c);
    return !m || parseFloat(m[1]) > 0;
  }
  function sampleTopColor() {
    let el = document.elementFromPoint(Math.floor(window.innerWidth / 2), 2);
    while (el && el.nodeType === 1) {
      const c = getComputedStyle(el).backgroundColor;
      if (isOpaque(c)) return c;
      el = el.parentElement;
    }
    const root = getComputedStyle(document.documentElement).backgroundColor;
    if (isOpaque(root)) return root;
    return document.body ? getComputedStyle(document.body).backgroundColor : '';
  }
  let lastChromeColor = '';
  let chromeTimer = null;
  function reportChromeColor() {
    chromeTimer = null;
    if (window !== window.top) return;
    const c = sampleTopColor();
    if (!isOpaque(c) || c === lastChromeColor) return;
    lastChromeColor = c;
    call({ op: 'chromeColor', color: c }).catch(() => {});
  }
  function scheduleChromeColor(ms) {
    if (chromeTimer) clearTimeout(chromeTimer);
    chromeTimer = setTimeout(reportChromeColor, ms == null ? 200 : ms);
  }
  if (window === window.top) {
    onChanged.addListener(() => scheduleChromeColor(400));
    window.addEventListener('resize', () => scheduleChromeColor());
    document.addEventListener('DOMContentLoaded', () => {
      const mo = new MutationObserver(() => scheduleChromeColor());
      mo.observe(document.documentElement, { attributes: true, childList: true });
      if (document.head) mo.observe(document.head, { childList: true });
      if (document.body) mo.observe(document.body, { attributes: true, childList: true });
      scheduleChromeColor(0);
    });
    window.addEventListener('load', () => scheduleChromeColor(300));
  }

  // ---- 左緣滑動回文章列表（v2.2.1）-----------------------------------------
  // Jimmy 2026-10-28 實機回報 Article View 左緣滑動不會返回。原生手勢（WebKit 內建返回 /
  // UIScreenEdgePanGestureRecognizer）在這裡收不到：翻頁模式 touchmove 會 preventDefault，
  // WKWebView 就把原生手勢讓給頁面。改在頁面內判斷——本檔在 document start 先掛 window
  // capture listener，比 paged-mode.js 早註冊、同階段先執行；從左緣 EDGE_PX 內起手的觸控整段
  // 由這裡接走（stopImmediatePropagation，翻頁模組拿不到、不會同時往前翻一頁）。
  const EDGE_PX = 24;
  const EDGE_BACK_MIN_DX = 60;
  function installEdgeBack(win, goBack) {
    let edge = null;
    const swallow = (e) => { e.stopImmediatePropagation(); };
    win.addEventListener('touchstart', (e) => {
      edge = null;
      if (!e.touches || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE_PX) return;
      edge = { x: t.clientX, y: t.clientY };
      swallow(e);
    }, { capture: true, passive: true });
    win.addEventListener('touchmove', (e) => {
      if (!edge) return;
      swallow(e);
      if (e.cancelable) e.preventDefault();
    }, { capture: true, passive: false });
    win.addEventListener('touchend', (e) => {
      if (!edge) return;
      const t = e.changedTouches && e.changedTouches[0];
      const start = edge;
      edge = null;
      swallow(e);
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      if (dx >= EDGE_BACK_MIN_DX && dx > dy) goBack();
    }, { capture: true, passive: true });
    win.addEventListener('touchcancel', () => { edge = null; }, { capture: true, passive: true });
  }
  // 回列表：從列表點進來（referrer 是 reader.html）就 history.back()，保留列表狀態；否則直接導向
  function backToFeed() {
    const feed = BASE + 'reader/reader.html';
    if (history.length > 1 && document.referrer && document.referrer.indexOf(feed) === 0) history.back();
    else location.href = feed;
  }
  if (window === window.top && /\/reader\/article\.html$/.test(location.pathname)) {
    installEdgeBack(window, backToFeed);
  }

  window.__jreadApp = { ready, onForeground, isApp: true, sampleTopColor, installEdgeBack };
})();
