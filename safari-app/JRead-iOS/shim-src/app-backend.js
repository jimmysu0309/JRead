// JRead iOS App — App 內 JReader 的擴充 API 替身：App backend（v2.2.0 起；v2.6.0 拆檔）
//
// 本檔不單獨載入。tools/build-host-shims.js 把 jread/lib/host-shim-core.js（跟平台無關的
// browser / chrome 物件形狀、storage 語意、onChanged、跨 frame 廣播）與本檔組成
// safari-app/JRead-iOS/JRead/Resources/jreader-app-shim.js——ViewController.swift 在
// document start 注入的仍是那一支（Swift 與 Xcode 專案不用改）。改本檔或核心後重跑：
//   node tools/build-host-shims.js
// forcing：test/regression/host-shim-build.spec.js 驗產生檔與兩份來源一致。
//
// App 用 WKWebView 以 jread-app:// 載入擴充同一份 reader/reader.html、article.html
// （檔案直接讀 App bundle 裡 JRead Extension.appex 的 Resources，不另存一份）。
// 背後走 WKScriptMessageHandlerWithReply（ViewController.swift 的 "jread" handler）：
//   - storage.sync  ↔ App Group 鏡像（AppSyncStore.swift，與 Safari 擴充雙向同步，逐鍵 LWW）
//   - storage.local ↔ App 自己的檔案（閱讀位置、feed 快取、這台裝置套用的設定檔）
//   - 跨來源 fetch  → 原生 URLSession（Instapaper API 不開 CORS，網頁端直接打會被擋）
//   - runtime.sendMessage 等 background 才有的能力 → 沒有 background，一律 resolve undefined
//     （核心提供，與 Safari 對沒有 listener 的 sendMessage 行為相同，呼叫端本來就要容忍）
//
// 這條驗 X、不驗 Y：test/regression/ios-app-jreader-shim.spec.js 用 jsdom + 假 bridge
// 驗 storage 語意、onChanged、fetch 轉送；WKWebView 實際載入、原生 bridge 回傳格式、
// App Group 跨 process 讀寫只能模擬器驗。

(function (CORE) {
  'use strict';

  if (location.protocol !== 'jread-app:') return;
  if (window.__jreadApp) return;

  const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.jread;
  const call = (msg) => Promise.resolve(handler ? handler.postMessage(msg) : null)
    .then((r) => (typeof r === 'string' ? JSON.parse(r) : (r || {})));

  const BASE = location.protocol + '//' + location.host + '/';
  const MANIFEST = window.__JREAD_APP_MANIFEST || { version: '0.0.0' };
  // 2026-11-15 review E-08：原名 CREDENTIAL_KEYS——語意是「變了就要重載 feed 的 key」，
  // 與 settings-defaults.js 的 CREDENTIAL_SETTINGS_KEYS（憑證欄位）撞名但內容不同，改名避免混淆
  // v2.6.0：加上 JReader 的網址與 token（第三個儲存服務）
  const FEED_RELOAD_KEYS = ['storageService', 'readwiseToken', 'instapaperToken', 'instapaperTokenSecret', 'jreaderUrl', 'jreaderToken'];

  // ---- storage backend ----------------------------------------------------
  function entriesToMap(entries, map) {
    map.clear();
    for (const k of Object.keys(entries || {})) {
      const e = entries[k];
      if (!e || e.del || typeof e.vj !== 'string') continue;
      try { map.set(k, JSON.parse(e.vj)); } catch (_) { /* 壞值略過 */ }
    }
  }
  const mapToObject = (map) => { const o = {}; for (const [k, v] of map) o[k] = v; return o; };

  function load() {
    return Promise.all([call({ op: 'syncLoad' }), call({ op: 'localLoad' })])
      .then(([s, l]) => {
        const sync = new Map();
        entriesToMap(s.entries, sync);
        const local = {};
        for (const k of Object.keys((l && l.items) || {})) {
          try { local[k] = JSON.parse(l.items[k]); } catch (_) { /* 壞值略過 */ }
        }
        return { sync: mapToObject(sync), local };
      });
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

  const host = CORE.create({
    baseUrl: BASE,
    runtimeId: 'jread-app',
    manifest: MANIFEST,
    load,
    persist,
    frameKey: '__jreadApp'
  }, window);
  const ready = host.ready;
  const onChanged = host.onChanged;

  // 回前景（ViewController 在 willEnterForeground 呼叫）：重讀鏡像，Safari 擴充那邊改過的
  // 設定 diff 後發 onChanged——article.html 既有的 storage.onChanged → scheduleReapply 即時重套。
  // feed 頁只在載入時讀一次憑證，憑證 / 儲存服務變了就整頁重載。
  function onForeground() {
    return ready.then(() => call({ op: 'syncLoad' })).then((s) => {
      const next = new Map();
      entriesToMap(s.entries, next);
      const changes = host.replaceArea('sync', next);
      const keys = Object.keys(changes);
      if (!keys.length) return keys;
      if (/\/reader\/reader\.html$/.test(location.pathname) && keys.some((k) => FEED_RELOAD_KEYS.includes(k))) {
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

  // ---- browser / chrome 替身（形狀由核心提供）---------------------------------
  host.install();

  // ---- 安全區域底色（v2.2.1）-----------------------------------------------
  // 狀態列 / Home 指示條那兩條由 App 原生著色：取畫面頂端中央往上找第一個不透明底色
  // （翻頁模式＝卡片色、捲動模式＝頁面底色），變了才回報。主題切換、進出翻頁都會改
  // <html> / <head> / <body> 的屬性或子節點 → MutationObserver（不掃 subtree）+ debounce。
  function isOpaque(c) {
    if (!c || c === 'transparent') return false;
    const m = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(c);
    return !m || parseFloat(m[1]) > 0;
  }
  function pageColor() {
    const root = getComputedStyle(document.documentElement).backgroundColor;
    if (isOpaque(root)) return root;
    return document.body ? getComputedStyle(document.body).backgroundColor : '';
  }
  // 只認縱向蓋滿畫面的容器（翻頁卡片 / 文章版心 / body）：捲到一半時頂端剛好是圖、
  // 程式碼框或列表項目，那些不代表頁面底色
  function opaqueAncestor(el) {
    const h = window.innerHeight;
    while (el && el.nodeType === 1) {
      if (isOpaque(getComputedStyle(el).backgroundColor)) {
        const r = el.getBoundingClientRect();
        if (el === document.body || el === document.documentElement || (r.top <= 2 && r.bottom >= h - 2)) return el;
      }
      el = el.parentElement;
    }
    return null;
  }
  // v2.2.4：頂端色帶要跟畫面一樣分三段（iPad 翻頁卡片不滿版，兩側露出頁面底色；
  // Jimmy 2026-10-28 回報 v2.2.3 頂端整條填卡片色、左右沒配合底色）。回報中段色（color）
  // 與其左右邊界（CSS px＝WebView point）、兩側色（side＝中段元素再往上第一個不透明底色）
  function sampleTopBand() {
    const w = window.innerWidth;
    const card = opaqueAncestor(document.elementFromPoint(Math.floor(w / 2), 2));
    if (!card) { const c = pageColor(); return { color: c, side: c, left: 0, right: w }; }
    const color = getComputedStyle(card).backgroundColor;
    const r = card.getBoundingClientRect();
    const left = Math.max(0, Math.round(r.left));
    const right = Math.min(w, Math.round(r.right));
    const outer = opaqueAncestor(card.parentElement);
    const side = outer ? getComputedStyle(outer).backgroundColor : pageColor();
    return { color, side: isOpaque(side) ? side : color, left, right };
  }
  const sampleTopColor = () => sampleTopBand().color;
  const CHROME_T0 = Date.now();
  const THEME_WAIT_MS = 1500;
  let lastChromeKey = '';
  let chromeTimer = null;
  function reportChromeColor() {
    chromeTimer = null;
    if (window !== window.top) return;
    // v3.5.5：左緣跟手滑動中（<html data-jread-edge-drag>）不取色。拖動會改 body 的 inline 樣式 → 上面的
    // MutationObserver 排程取色；body 往右移後畫面頂端中央取到的是卡片新位置或露出來的 <html> 底色，色帶
    // 跟著變、換頁到列表又變一次＝Jimmy 2026-11-26 回報「左滑回列表後 menubar 閃兩次」。彈回時屬性拿掉
    // 會再排程一次、取回原本的值（key 相同不送）
    if (document.documentElement && document.documentElement.hasAttribute(EDGE_DRAG_ATTR)) return;
    // v3.5.5：JRead 自己的列表 / 文章頁（<html data-jread-page>）要等主題套上（data-theme）才取色。
    // 頁面讀完 storage 才設 data-theme，在那之前系統深色模式會先給深色變數 → 色帶先變深、套上主題後
    // 再變一次＝回列表時狀態列閃兩次（Jimmy 2026-11-26 確認閃的是 iOS 狀態列）。設 data-theme 會改 <html>
    // 屬性、上面的 MutationObserver 會再排程；萬一一直沒設（讀設定失敗），THEME_WAIT_MS 後照取
    const de = document.documentElement;
    if (de && de.hasAttribute('data-jread-page') && !de.hasAttribute('data-theme')) {
      const waited = Date.now() - CHROME_T0;
      if (waited < THEME_WAIT_MS) { scheduleChromeColor(THEME_WAIT_MS - waited); return; }
    }
    const band = sampleTopBand();
    const key = JSON.stringify(band);
    if (!isOpaque(band.color) || key === lastChromeKey) return;
    lastChromeKey = key;
    call(Object.assign({ op: 'chromeColor' }, band)).catch(() => {});
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
  // v3.2.6：EDGE_PX 24 → 44（Jimmy 2026-11-25 回報右滑回列表很容易失敗、變成翻回上一頁）。
  // 手指觸控點落在指腹中心，貼著螢幕邊緣起手的 clientX 實際常在 25–40 之間，24 太窄；
  // 44＝Apple 建議的最小觸控尺寸。代價：從左側 44px 內起手的右滑一律算返回、不翻上一頁
  const EDGE_PX = 44;
  // v3.5.4：跟手滑動（Jimmy 2026-11-26「左滑回到文章列表的動畫能做得更精緻嗎」，選「跟手滑動（iOS 原生感）」）。
  // 原本手指放開才判斷、直接換頁，沒有任何動畫。現在：
  //   - 起手後先看方向：移動超過 EDGE_DECIDE_PX 時水平為主且往右＝拖動；垂直為主＝這段不算返回（仍由這裡接走，
  //     不讓翻頁模組收到）
  //   - 拖動中整個 <body> 跟著手指往右移（translate3d），左緣帶陰影，露出 <html> 的底色；掛 <html> 直下的齒輪、
  //     頁碼、拖曳條、頂端進度條、重點工具列、toast 暫時藏起來（它們不在 body 裡，不會跟著移）
  //   - 放開：移動超過畫面寬 EDGE_COMMIT_RATIO 或往右甩得夠快（≥ EDGE_FLING_PX_PER_MS 且至少 EDGE_FLING_MIN_DX）
  //     ＝滑出畫面後回列表；不夠＝彈回原位。動畫 EDGE_ANIM_MS
  // 為什麼移 <body> 不移 <html>：<html> 加 transform 後 position: fixed 的元素改成相對 <html> 定位，捲動模式下會
  // 整個跳走（Playwright WebKit / Chromium 實測 top 10 → -490）。翻頁卡片是 body 裡的 fixed 元素、翻頁時文件不捲，
  // 移 body 時卡片跟著平移、垂直位置不變（同樣實測）。styler 對 body 下了 transform: none !important，這裡用 inline
  // !important 蓋過
  const EDGE_DECIDE_PX = 8;
  const EDGE_COMMIT_RATIO = 1 / 3;
  const EDGE_FLING_PX_PER_MS = 0.5;
  const EDGE_FLING_MIN_DX = 40;
  const EDGE_ANIM_MS = 260;
  const EDGE_DRAG_ATTR = 'data-jread-edge-drag';
  const EDGE_DRAG_CSS = 'html[' + EDGE_DRAG_ATTR + '] #__jread-floating-host, html[' + EDGE_DRAG_ATTR + '] #__jread-page-indicator, ' +
    'html[' + EDGE_DRAG_ATTR + '] #__jread-scrub-track, html[' + EDGE_DRAG_ATTR + '] #__jread-progress, html[' + EDGE_DRAG_ATTR + '] #__jread-hl-host, html[' + EDGE_DRAG_ATTR + '] #__jread-toast-host' +
    ' { opacity: 0 !important; transition: none !important; }';
  function installEdgeBack(win, goBack) {
    const doc = win.document;
    let edge = null;
    let anim = null;   // 放開後的滑出 / 彈回計時器
    const swallow = (e) => { e.stopImmediatePropagation(); };
    try {
      const st = doc.createElement('style');
      st.id = '__jread-edge-drag-style';
      st.textContent = EDGE_DRAG_CSS;
      doc.documentElement.appendChild(st);
    } catch (_) { /* */ }
    const body = () => doc.body;
    const setX = (x) => {
      const b = body();
      if (b) b.style.setProperty('transform', 'translate3d(' + Math.max(0, Math.round(x)) + 'px, 0, 0)', 'important');
    };
    const begin = () => {
      const b = body();
      if (!b) return false;
      if (anim) { win.clearTimeout(anim); anim = null; }
      doc.documentElement.setAttribute(EDGE_DRAG_ATTR, '');
      b.style.setProperty('transition', 'none', 'important');
      b.style.setProperty('box-shadow', '-8px 0 24px rgba(0, 0, 0, 0.22)', 'important');
      b.style.setProperty('will-change', 'transform', 'important');
      return true;
    };
    const cleanup = () => {
      if (anim) { win.clearTimeout(anim); anim = null; }
      const b = body();
      if (b) for (const k of ['transform', 'transition', 'box-shadow', 'will-change']) b.style.removeProperty(k);
      doc.documentElement.removeAttribute(EDGE_DRAG_ATTR);
    };
    const animateTo = (x, done) => {
      const b = body();
      if (!b) { done(); return; }
      b.style.setProperty('transition', 'transform ' + EDGE_ANIM_MS + 'ms cubic-bezier(0.2, 0.8, 0.2, 1)', 'important');
      setX(x);
      anim = win.setTimeout(() => { anim = null; done(); }, EDGE_ANIM_MS + 20);
    };
    win.addEventListener('touchstart', (e) => {
      edge = null;
      if (!e.touches || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE_PX) return;
      const now = Date.now();
      edge = { x: t.clientX, y: t.clientY, decided: false, drag: false, dx: 0, lastX: t.clientX, lastT: now, vx: 0 };
      swallow(e);
    }, { capture: true, passive: true });
    win.addEventListener('touchmove', (e) => {
      if (!edge) return;
      swallow(e);
      if (e.cancelable) e.preventDefault();
      const t = e.touches && e.touches[0];
      if (!t) return;
      const dx = t.clientX - edge.x;
      const dy = t.clientY - edge.y;
      if (!edge.decided && (Math.abs(dx) > EDGE_DECIDE_PX || Math.abs(dy) > EDGE_DECIDE_PX)) {
        edge.decided = true;
        edge.drag = dx > 0 && dx >= Math.abs(dy) && begin();
      }
      const now = Date.now();
      const dt = now - edge.lastT;
      if (dt >= 8) { edge.vx = (t.clientX - edge.lastX) / dt; edge.lastX = t.clientX; edge.lastT = now; }
      edge.dx = dx;
      if (edge.drag) setX(dx);
    }, { capture: true, passive: false });
    win.addEventListener('touchend', (e) => {
      if (!edge) return;
      const start = edge;
      edge = null;
      swallow(e);
      if (!start.drag) return;
      const t = e.changedTouches && e.changedTouches[0];
      const dx = t ? t.clientX - start.x : start.dx;
      const w = win.innerWidth || 390;
      const commit = dx >= w * EDGE_COMMIT_RATIO || (start.vx >= EDGE_FLING_PX_PER_MS && dx >= EDGE_FLING_MIN_DX);
      if (commit) {
        animateTo(w, () => {
          goBack();
          // 換頁通常立刻開始；萬一沒走（沒有出口）就放回來，別讓畫面停在畫面外
          anim = win.setTimeout(cleanup, 3000);
        });
      } else {
        animateTo(0, cleanup);
      }
    }, { capture: true, passive: true });
    win.addEventListener('touchcancel', () => {
      const start = edge;
      edge = null;
      if (start && start.drag) animateTo(0, cleanup);
    }, { capture: true, passive: true });
    // 從列表按上一頁回到這篇（bfcache）：body 還停在滑出位置，復原。只認 persisted——一般載入也會發 pageshow，
    // 不可在那時清掉（jsdom 載入後非同步才發，曾把滑出中的換頁計時器清掉）
    win.addEventListener('pageshow', (e) => { if (e && e.persisted) cleanup(); });
  }
  // 回列表：走文章頁的退出 hook（NS.onReaderExit，與 ESC / 懸浮按鈕同一個網址＝帶 ?tab=
  // 回到來源分頁）。Jimmy 2026-10-29 回報 Later / JRead 讀完左滑都回 Inbox：舊版判斷
  // referrer 決定 history.back()，但 jread-app:// 自訂 scheme 的 document.referrer 恆為空
  // （模擬器實測），永遠走「直接導向 reader.html」不帶分頁。hook 還沒掛上（文章載入中）
  // 時沿用本頁網址的 ?tab=
  function backToFeed() {
    const NS = window.__JRead;
    if (NS && typeof NS.onReaderExit === 'function') { NS.onReaderExit(); return; }
    let tab = null;
    try { tab = new URLSearchParams(location.search).get('tab'); } catch (_) { /* */ }
    location.href = BASE + 'reader/reader.html' + (tab ? '?tab=' + encodeURIComponent(tab) : '');
  }
  if (window === window.top && /\/reader\/article\.html$/.test(location.pathname)) {
    installEdgeBack(window, backToFeed);
  }

  // ---- 沉浸閱讀：狀態列跟著齒輪藏 / 顯示（v2.2.2；v3.5.0 判定搬到 web core）---------
  // Jimmy 2026-10-28 需求：Article View 進場時狀態列與懸浮按鈕一起藏，點一下畫面切換。
  // v3.5.0：「點一下」的判定（含 v3.2.6 等 click 送出才切換的修法）搬到 jread/reader/reader-immersive.js，
  // App、網頁版、擴充的 Reader 共用一份（Jimmy 2026-11-26 網頁版與擴充也要一樣的行為）。App 這裡只做原生
  // 那一半：聽 'jread:chrome' 事件，轉給 ViewController 藏 / 顯示狀態列（prefersStatusBarHidden）。
  // 模組還沒載入前（document-start 到頁面 script 跑完）狀態列先藏，跟舊版進場即藏一致
  const CHROME_EVENT = 'jread:chrome';
  function installImmersive(win, report) {
    win.addEventListener(CHROME_EVENT, (e) => { report(!(e && e.detail && e.detail.shown)); });
    report(true);
  }

  // ---- 文章頁鎖雙指縮放（v3.2.8）-----------------------------------------------
  // Jimmy 2026-11-25：App 看文章可以雙指把整頁放大，不是預期行為。不能靠 viewport meta 的
  // user-scalable=no——styler 進閱讀模式會把 viewport 正規化成 width=device-width, initial-scale=1
  //（applyViewportFix）蓋掉。改擋 WebKit 的縮放手勢事件（gesturestart / gesturechange / gestureend，
  // preventDefault 就不縮放），雙指 touchmove 也擋一次當第二層。單指捲動、翻頁、選字不受影響
  function installNoPinch(win) {
    const doc = win.document;
    const stop = (e) => { if (e.cancelable) e.preventDefault(); };
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) doc.addEventListener(t, stop, { passive: false });
    doc.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches.length > 1 && e.cancelable) e.preventDefault();
    }, { capture: true, passive: false });
  }

  // ---- 底部安全區域（v2.2.16）---------------------------------------------------
  // 頁面沒宣告 viewport-fit=cover，env(safe-area-inset-bottom) 恆為 0，但 App 的 WebView 畫到
  // Home 指示條底下，翻頁頁碼會落進系統手勢區（Jimmy 2026-10-29 iPhone 回報）。原生把底部安全區域
  // 帶進來（document-start 初值 __JREAD_APP_SAFE_BOTTOM，之後變動呼叫 setSafeBottom），
  // 寫成 :root 的 --__jread-app-safe-bottom，styler 與 env() 取大者
  const SAFE_BOTTOM_VAR = '--__jread-app-safe-bottom';
  let safeBottomStyle = null;
  function setSafeBottom(px) {
    const n = Math.max(0, Number(px) || 0);
    const doc = document;
    if (!safeBottomStyle) {
      safeBottomStyle = doc.createElement('style');
      safeBottomStyle.id = '__jread-app-safe-bottom';
    }
    safeBottomStyle.textContent = ':root { ' + SAFE_BOTTOM_VAR + ': ' + n + 'px; }';
    if (safeBottomStyle.isConnected) return;
    if (doc.documentElement) doc.documentElement.appendChild(safeBottomStyle);
    else doc.addEventListener('DOMContentLoaded', () => doc.documentElement.appendChild(safeBottomStyle), { once: true });
  }
  if (window === window.top) setSafeBottom(window.__JREAD_APP_SAFE_BOTTOM);

  const reportStatusBar = (hidden) => { call({ op: 'statusBar', hidden }).catch(() => {}); };
  if (window === window.top) {
    if (/\/reader\/article\.html$/.test(location.pathname)) {
      installImmersive(window, reportStatusBar);
      installNoPinch(window);
    }
    else window.addEventListener('pageshow', () => reportStatusBar(false));
  }

  // v3.3.0：設定頁（文章頁 J 選單「設定」以 iframe 開 options.html）同樣鎖雙指縮放——
  // WKWebView 的縮放是整個 WebView，iframe 裡捏合一樣會把整頁放大
  if (/\/options\/options\.html$/.test(location.pathname)) installNoPinch(window);

  // ---- 觸覺回饋（v3.5.5）-------------------------------------------------------
  // Jimmy 2026-11-26：翻頁模式拖動頁碼進度條，每跨一頁震一下。網頁端（Safari 擴充 content script）
  // 沒有可靠的觸覺 API（v0.8.151–153 vibrate / switch checkbox 真機全失敗），App 改請原生發
  // UISelectionFeedbackGenerator（滾輪選擇器那種「喀」）。paged-mode.js triggerHaptic 看到這支就只走這條
  function haptic() { call({ op: 'haptic' }).catch(() => {}); }
  // v3.6.1：開始拖動頁碼時先預熱觸覺引擎（paged-mode.js beginScrub）
  function hapticPrepare() { call({ op: 'hapticPrepare' }).catch(() => {}); }

  // ---- 圖卡儲存 / 分享（v3.6.0 Textshot）------------------------------------------
  // WKWebView 的 <a download> 與分享檔案都不可靠 → 交給原生：mode 'save' 存進相簿、'share' 開系統分享面板。
  // 圖以 base64 傳（bridge 只收 JSON 相容值）。回 { ok, message? } 給 textshot 顯示提示
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || '').replace(/^data:[^,]*,/, ''));
      r.onerror = () => reject(r.error || new Error('read'));
      r.readAsDataURL(blob);
    });
  }
  function shareImage(blob, name, mode) {
    return blobToBase64(blob)
      .then((b64) => call({ op: 'shareImage', b64, name: String(name || 'JRead.png'), mode: mode === 'save' ? 'save' : 'share' }))
      .then((r) => (r && r.ok === false
        ? { ok: false, message: r.denied ? '沒有加入相簿的權限，請到「設定」允許 JRead 加入照片' : '圖片處理失敗' }
        : { ok: true, message: mode === 'save' ? '已存到相簿' : '', silent: mode !== 'save' }))
      .catch(() => ({ ok: false, message: '圖片處理失敗' }));
  }

  window.__jreadApp = { haptic, hapticPrepare, shareImage, ready, onForeground, _remoteChange: host.applyRemote, isApp: true, sampleTopColor, sampleTopBand, installEdgeBack, EDGE_DRAG_ATTR, EDGE_ANIM_MS, backToFeed, installImmersive, installNoPinch, setSafeBottom };
})(__JReadHostShimCore);
