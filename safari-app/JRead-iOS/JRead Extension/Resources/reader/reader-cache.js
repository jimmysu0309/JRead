// JRead — JReader 本機快取（v1.10.1）
//
// 目的：Article Feed 重新整理 / 切分頁、Article View 換頁回來時不必每次重打 API
//（Readwise list 20/min 限流，withHtmlContent 那支更重）。兩層：
//
//   1. feed 清單 → storage.local `readerFeedCache`（每分頁最多 10 篇的精簡
//      metadata，約 5K）。feed 頁先畫快取、背景抓新的再替換（stale-while-revalidate）。
//   2. 文章 HTML → IndexedDB `jread-reader-cache`（實測一般文章 6–54K，翻譯頁內嵌
//      圖可達 1.9M，storage.local 的 10M 上限裝不下）。總量上限 ARTICLE_BUDGET
//      （50M，Jimmy 2026-10-27 裁定），超過依最後開啟時間淘汰最舊的。
//
// 文章內容視為不變；唯一失效條件是 feed 快取裡同 id 的 updated_at 比文章快取新
//（例如在 Readwise 重送過）。updated_at 也會因閱讀進度 / 搬位置變動，最多多抓一次。
//
// 帳號隔離：每筆都帶 accountKey（service + 憑證雜湊，不存憑證本身），換 token /
// 換服務後舊資料一律視為不存在，留給 LRU 淘汰。
//
// 任何快取失敗（IndexedDB 不可用、開庫卡住、寫入配額不足）都退回直接打 API，
// 不影響閱讀。IndexedDB 操作一律帶時限（部分 WebKit 版本 open 會永遠不回）。
//
// dual export：module.exports 給 jsdom spec、window.__JReadReaderCache 給頁面。
(function (global) {
  'use strict';

  const FEED_KEY = 'readerFeedCache';
  const FEED_VERSION = 1;
  const DB_NAME = 'jread-reader-cache';
  const DB_VERSION = 1;
  const STORE_ARTICLES = 'articles';
  const STORE_META = 'meta';
  const ARTICLE_BUDGET = 50 * 1024 * 1024;
  const IDB_TIMEOUT_MS = 1500;

  // feed 卡片與文章頁 byline 用得到的欄位；其餘（summary / tags / content…）不存
  const SLIM_FIELDS = ['id', 'title', 'author', 'site_name', 'published_date', 'source_url', 'image_url', 'updated_at'];

  // ---- 共用 ----------------------------------------------------------------

  function hashString(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(16) + '-' + s.length;
  }

  // service + 憑證的雜湊。instapaper 有 token + secret 兩段，都要納入
  function accountKey(service, creds) {
    const c = creds || {};
    const raw = String(c.token || '').trim() + '|' + String(c.tokenSecret || '').trim();
    return String(service || 'readwise') + ':' + hashString(raw);
  }

  function slimDoc(doc) {
    const out = {};
    if (!doc) return out;
    for (const k of SLIM_FIELDS) {
      if (doc[k] != null && doc[k] !== '') out[k] = doc[k];
    }
    return out;
  }

  function byteSize(str) {
    const s = String(str || '');
    try { return new TextEncoder().encode(s).length; } catch (_) { return s.length * 2; }
  }

  function withTimeout(promise, ms, fallback) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
      Promise.resolve(promise).then(
        (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
        () => { if (!done) { done = true; clearTimeout(timer); resolve(fallback); } }
      );
    });
  }

  // ---- feed 清單（storage.local）--------------------------------------------
  // { v, account, lists: { <listKey>: { t, docs: [slimDoc...] } } }
  // 換帳號整份作廢（只有一個帳號在用，不必多帳號並存）

  function readFeedCache(storage) {
    if (!storage || typeof storage.get !== 'function') return Promise.resolve(null);
    return Promise.resolve(storage.get(FEED_KEY))
      .then((v) => {
        const c = v && v[FEED_KEY];
        return (c && c.v === FEED_VERSION && c.lists && typeof c.lists === 'object') ? c : null;
      })
      .catch(() => null);
  }

  function readFeed(storage, account, listKey) {
    return readFeedCache(storage).then((c) => {
      if (!c || c.account !== account) return null;
      const entry = c.lists[listKey];
      return (entry && Array.isArray(entry.docs)) ? entry.docs : null;
    });
  }

  // 改寫整份 feed 快取。mutate(cache) 直接改 cache.lists；回傳寫入結果的 promise
  function updateFeedCache(storage, account, mutate) {
    if (!storage || typeof storage.set !== 'function') return Promise.resolve(false);
    return readFeedCache(storage).then((c) => {
      const cache = (c && c.account === account) ? c : { v: FEED_VERSION, account, lists: {} };
      mutate(cache);
      return Promise.resolve(storage.set({ [FEED_KEY]: cache })).then(() => true);
    }).catch(() => false);
  }

  function writeFeed(storage, account, listKey, docs, maxItems) {
    const slim = (docs || []).slice(0, maxItems || 10).map(slimDoc).filter((d) => d.id);
    return updateFeedCache(storage, account, (cache) => {
      cache.lists[listKey] = { t: Date.now(), docs: slim };
    });
  }

  // 封存成功後把該篇從所有分頁快取移除（否則下次開 feed 會先閃出已封存的卡片）
  function removeFromFeed(storage, account, id) {
    return updateFeedCache(storage, account, (cache) => {
      for (const k of Object.keys(cache.lists)) {
        const e = cache.lists[k];
        if (e && Array.isArray(e.docs)) e.docs = e.docs.filter((d) => d.id !== id);
      }
    });
  }

  // 文章頁查 feed 快取裡同 id 的 metadata（拿 updated_at 判斷文章快取是否過期）
  function findFeedDoc(storage, account, id) {
    return readFeedCache(storage).then((c) => {
      if (!c || c.account !== account) return null;
      for (const k of Object.keys(c.lists)) {
        const e = c.lists[k];
        const hit = e && Array.isArray(e.docs) && e.docs.find((d) => d.id === id);
        if (hit) return hit;
      }
      return null;
    });
  }

  // 清單內容是否實質相同（決定背景抓回來要不要重畫，避免無謂閃動）
  function feedSignature(docs) {
    return (docs || []).map((d) => {
      const s = slimDoc(d);
      return [s.id, s.updated_at || '', s.title || '', s.author || '', s.site_name || '', s.image_url || ''].join('\u0001');
    }).join('\u0002');
  }

  // ---- 文章（IndexedDB）------------------------------------------------------

  // feed 那邊的 updated_at 比快取新 → 過期。任一方缺 updated_at（Instapaper、
  // feed 沒列到這篇）→ 視為沒過期
  function isStale(entry, feedDoc) {
    if (!entry) return true;
    const a = entry.updated_at ? Date.parse(entry.updated_at) : NaN;
    const b = feedDoc && feedDoc.updated_at ? Date.parse(feedDoc.updated_at) : NaN;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return b > a;
  }

  // metas: [{ key, bytes, lastOpened }]。回傳要刪的 key（最久沒開的先刪），
  // 刪到總量 <= budget 為止；keepKey（剛寫入 / 正在讀的那篇）永不刪
  function planEviction(metas, budget, keepKey) {
    const list = (metas || []).filter((m) => m && m.key);
    let total = list.reduce((s, m) => s + (Number(m.bytes) || 0), 0);
    if (total <= budget) return [];
    const order = list.filter((m) => m.key !== keepKey)
      .sort((x, y) => (Number(x.lastOpened) || 0) - (Number(y.lastOpened) || 0));
    const out = [];
    for (const m of order) {
      if (total <= budget) break;
      out.push(m.key);
      total -= Number(m.bytes) || 0;
    }
    return out;
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('abort'));
    });
  }

  // 回傳 store 物件；IndexedDB 不可用 / 開庫失敗 / 卡住 → resolve null（呼叫端走 API）
  function openArticleStore(opts) {
    const o = opts || {};
    const idb = o.indexedDB !== undefined ? o.indexedDB : global.indexedDB;
    const budget = o.budget || ARTICLE_BUDGET;
    const timeoutMs = o.timeoutMs || IDB_TIMEOUT_MS;
    const now = o.now || (() => Date.now());
    if (!idb || typeof idb.open !== 'function') return Promise.resolve(null);

    let openReq;
    const opened = new Promise((resolve, reject) => {
      try { openReq = idb.open(o.dbName || DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
      openReq.onupgradeneeded = () => {
        const db = openReq.result;
        if (!db.objectStoreNames.contains(STORE_ARTICLES)) db.createObjectStore(STORE_ARTICLES, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
      };
      openReq.onsuccess = () => resolve(openReq.result);
      openReq.onerror = () => reject(openReq.error);
      openReq.onblocked = () => reject(new Error('blocked'));
    });

    return withTimeout(opened, timeoutMs, null).then((db) => {
      if (!db) return null;
      const keyOf = (account, id) => account + '|' + id;

      function get(account, id) {
        const p = (async () => {
          const tx = db.transaction([STORE_ARTICLES], 'readonly');
          return (await reqToPromise(tx.objectStore(STORE_ARTICLES).get(keyOf(account, id)))) || null;
        })();
        return withTimeout(p, timeoutMs, null);
      }

      // 更新最後開啟時間（只改 meta，不重寫整篇 HTML）
      function touch(account, id) {
        const key = keyOf(account, id);
        return (async () => {
          const tx = db.transaction([STORE_META], 'readwrite');
          const store = tx.objectStore(STORE_META);
          const m = await reqToPromise(store.get(key));
          if (m) store.put(Object.assign({}, m, { lastOpened: now() }));
          await txDone(tx);
          return true;
        })().catch(() => false);
      }

      async function evict(keepKey) {
        const tx = db.transaction([STORE_META], 'readonly');
        const metas = await reqToPromise(tx.objectStore(STORE_META).getAll());
        const victims = planEviction(metas, budget, keepKey);
        if (!victims.length) return 0;
        const wtx = db.transaction([STORE_ARTICLES, STORE_META], 'readwrite');
        for (const k of victims) {
          wtx.objectStore(STORE_ARTICLES).delete(k);
          wtx.objectStore(STORE_META).delete(k);
        }
        await txDone(wtx);
        return victims.length;
      }

      // 寫入一篇（doc 需含 id 與 html_content）。單篇超過總量上限不存
      function put(account, doc) {
        return (async () => {
          if (!doc || !doc.id || !doc.html_content) return false;
          const slim = slimDoc(doc);
          slim.html_content = String(doc.html_content);
          if (doc.language) slim.language = doc.language;
          const bytes = byteSize(slim.html_content) + byteSize(JSON.stringify(slimDoc(doc)));
          if (bytes > budget) return false;
          const key = keyOf(account, String(doc.id));
          const tx = db.transaction([STORE_ARTICLES, STORE_META], 'readwrite');
          tx.objectStore(STORE_ARTICLES).put({ key, account, id: String(doc.id), updated_at: doc.updated_at || '', doc: slim });
          tx.objectStore(STORE_META).put({ key, bytes, lastOpened: now() });
          await txDone(tx);
          await evict(key);
          return true;
        })().catch(() => false);
      }

      // 總用量（除錯 / 驗證用）
      function usage() {
        return (async () => {
          const tx = db.transaction([STORE_META], 'readonly');
          const metas = await reqToPromise(tx.objectStore(STORE_META).getAll());
          return { count: metas.length, bytes: metas.reduce((s, m) => s + (Number(m.bytes) || 0), 0) };
        })().catch(() => null);
      }

      // 清空兩個 object store（設定頁「清除快取」用）。不走 deleteDatabase：Article View
      // 分頁開著時連線還在，deleteDatabase 會 blocked 到分頁關掉為止
      function clear() {
        return (async () => {
          const tx = db.transaction([STORE_ARTICLES, STORE_META], 'readwrite');
          tx.objectStore(STORE_ARTICLES).clear();
          tx.objectStore(STORE_META).clear();
          await txDone(tx);
          return true;
        })().catch(() => false);
      }

      return { get, put, touch, evict, usage, clear, keyOf, close: () => { try { db.close(); } catch (_) {} } };
    });
  }

  // 設定頁用：開庫 → 清空 → 關閉。IndexedDB 不可用 / 開庫失敗回 false
  function clearArticleStore(opts) {
    return openArticleStore(opts).then((store) => {
      if (!store) return false;
      return store.clear().then((ok) => { store.close(); return ok; });
    }).catch(() => false);
  }

  // 設定頁用：{ count, bytes }；不可用回 null
  function articleStoreUsage(opts) {
    return openArticleStore(opts).then((store) => {
      if (!store) return null;
      return store.usage().then((u) => { store.close(); return u; });
    }).catch(() => null);
  }

  const api = {
    FEED_KEY, DB_NAME, ARTICLE_BUDGET, IDB_TIMEOUT_MS,
    accountKey, slimDoc, byteSize, withTimeout,
    readFeed, writeFeed, removeFromFeed, findFeedDoc, feedSignature,
    isStale, planEviction, openArticleStore, clearArticleStore, articleStoreUsage
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.__JReadReaderCache = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
