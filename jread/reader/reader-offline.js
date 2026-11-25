// JRead — App 離線閱讀預載（v3.4.5，Jimmy 2026-11-25「加入 inbox 和 later 抓取各前 20 篇離線內容」）
//
// 原本已有的離線基礎（v1.10.1 reader-cache.js）：開過的文章全文存 IndexedDB、清單存
// storage.local。缺的是「沒開過的文章」——這支在 App 的文章列表頁背景把 Inbox / Later
// 各前 OFFLINE_ITEMS 篇的全文先抓進同一個文章快取，文章頁的讀取流程（快取先、API 後）
// 不用改就能離線開。
//
// 範圍：
//   - 只在 iOS App（NS.isAppRuntime）：Jimmy 要的是 App 離線閱讀；Safari 擴充 / 網頁版不預載
//   - 只在 JReader 服務：Readwise 的取全文是 list API（限流 20 次／分鐘），一次預載 40 篇
//     會把正常使用的額度吃光；Instapaper 不在需求內
//   - v3.4.7 起連內文圖一起存（Jimmy 2026-11-25「離線閱讀可以一併抓圖嗎」，上限放寬到 300M）：
//     文章都到手後，逐篇解析 html_content 的 <img>（RC.pickImageUrl 選網址），沒存過的抓下來存進
//     文章快取的 images store；文章頁開啟時換成本機圖（reader-article applyCachedImages）。
//     App 的 fetch 走原生 URLSession，沒有跨來源限制。單張超過 MAX_IMAGE_BYTES、不是圖片的回應不存
//
// 節流：清單每次載入成功都會呼叫 schedule，實際執行間隔至少 MIN_INTERVAL_MS（記在
// storage.local，App 重開也算數），同一時間只跑一輪；開始前等 START_DELAY_MS，讓清單頁
// 自己的快取寫入先完成（兩邊都改 readerFeedCache，同時讀改寫會互相蓋掉）。
// 失敗（離線、伺服器錯誤）不重試、不跳任何提示，下一次排程再補。
//
// dual export：module.exports 給 jsdom spec、window.__JReadReaderOffline 給頁面。
(function (global) {
  'use strict';

  const OFFLINE_TABS = ['new', 'later'];
  const OFFLINE_ITEMS = 20;
  const MIN_INTERVAL_MS = 10 * 60 * 1000;
  const START_DELAY_MS = 3000;
  const CONCURRENCY = 2;
  const MAX_FAILURES = 3;          // 連續失敗幾篇就收手（多半是斷線）
  const LAST_RUN_KEY = 'readerOfflinePrefetchAt';
  const IMAGE_CONCURRENCY = 3;
  const MAX_IMAGES_PER_DOC = 60;
  const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

  // 純函式：html 字串 → 要存的圖片網址（去重、照出現順序、最多 MAX_IMAGES_PER_DOC 張）
  function imageUrlsOf(html, DOMParserCtor, RC) {
    if (!html || typeof DOMParserCtor !== 'function' || !RC || typeof RC.pickImageUrl !== 'function') return [];
    let d;
    try { d = new DOMParserCtor().parseFromString(String(html), 'text/html'); } catch (_) { return []; }
    const out = [];
    const seen = new Set();
    for (const img of Array.from(d.querySelectorAll('img'))) {
      const u = RC.pickImageUrl(img);
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push(u);
      if (out.length >= MAX_IMAGES_PER_DOC) break;
    }
    return out;
  }

  async function fetchImageBlob(fetchFn, url) {
    try {
      const r = await fetchFn(url);
      if (!r || !r.ok) return null;
      const blob = await r.blob();
      const type = String((blob && blob.type) || (r.headers && r.headers.get && r.headers.get('content-type')) || '');
      if (!blob || !blob.size || blob.size > MAX_IMAGE_BYTES) return null;
      if (type && !/^image\//i.test(type)) return null;
      return blob;
    } catch (_) { return null; }
  }

  // 圖片階段：每篇文章已在快取裡（剛抓的或之前就有的），補上還沒存的圖。回 { saved, failed }
  async function prefetchImages(ctx, store, docs) {
    const { RC, account } = ctx;
    const fetchFn = ctx.fetch || (typeof global.fetch === 'function' ? global.fetch.bind(global) : null);
    const DP = ctx.DOMParser || global.DOMParser;
    const out = { saved: 0, failed: 0 };
    if (!fetchFn || typeof store.getImages !== 'function' || typeof store.putImages !== 'function') return out;
    let streak = 0;
    const seenDoc = new Set();
    for (const d of docs) {
      const id = String(d.id);
      if (seenDoc.has(id)) continue;
      seenDoc.add(id);
      if (streak >= MAX_FAILURES) break; // 多半斷線了
      const entry = await store.get(account, id);
      const html = entry && entry.doc && entry.doc.html_content;
      const urls = imageUrlsOf(html, DP, RC);
      if (!urls.length) continue;
      const have = await store.getImages(account, id);
      const missing = urls.filter((u) => !have.has(u));
      if (!missing.length) continue;
      const got = [];
      await mapLimit(missing, IMAGE_CONCURRENCY, async (u) => {
        if (streak >= MAX_FAILURES) return;
        const blob = await fetchImageBlob(fetchFn, u);
        if (blob) { streak = 0; got.push({ url: u, blob }); } else { streak++; out.failed++; }
      });
      if (got.length) out.saved += await store.putImages(account, id, got);
    }
    return out;
  }

  // 純決策：這一輪要不要跑
  function shouldRun({ isApp, service, lastRunAt, now, force }) {
    if (!isApp || service !== 'jreader') return false;
    if (force) return true;
    const last = Number(lastRunAt) || 0;
    return !(now - last < MIN_INTERVAL_MS && now >= last);
  }

  // 純決策：清單裡哪些文章要抓（沒快取、或快取比清單舊）。cached：id → 快取 entry
  function pickMissing(docs, cached, RC, ownWrites) {
    const out = [];
    const seen = new Set();
    for (const d of docs || []) {
      if (!d || d.id == null) continue;
      const id = String(d.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const entry = cached[id];
      const ok = entry && entry.doc && entry.doc.html_content &&
        !(RC && RC.isStale(entry, d, ownWrites && ownWrites[id]));
      if (!ok) out.push(d);
    }
    return out;
  }

  async function mapLimit(items, limit, fn) {
    let i = 0;
    const workers = [];
    for (let w = 0; w < Math.min(limit, items.length); w++) {
      workers.push((async () => {
        while (i < items.length) {
          const item = items[i++];
          await fn(item);
        }
      })());
    }
    await Promise.all(workers);
  }

  // 跑一輪。回 { ran, fetched, skipped, failed }。永不 reject
  async function run(ctx) {
    const { PC, RC, service, creds, storage, account, tabs } = ctx;
    const log = typeof ctx.log === 'function' ? ctx.log : () => {};
    const result = { ran: true, fetched: 0, skipped: 0, failed: 0 };
    let store = null;
    try {
      store = await RC.openArticleStore(ctx.storeOpts);
      if (!store) { result.ran = false; return result; }
      const ownWrites = typeof RC.readOwnWrites === 'function' ? await RC.readOwnWrites(storage) : {};
      const wanted = [];
      for (const tabId of OFFLINE_TABS) {
        const cfg = (tabs || []).find((t) => t && t.id === tabId);
        if (!cfg) continue;
        let r = null;
        try { r = await PC.listDocuments({ service, creds, query: cfg.query }); } catch (_) { r = null; }
        if (!r || !r.ok) { result.failed++; log('清單取得失敗', { tab: tabId }); return result; }
        const docs = (r.results || []).slice(0, OFFLINE_ITEMS);
        // 清單快取也更新成這 20 篇：沒網路時清單頁列得出來，文章頁的過期判斷也有依據
        if (typeof ctx.listKeyFor === 'function') await RC.writeFeed(storage, account, ctx.listKeyFor(cfg), docs, OFFLINE_ITEMS);
        for (const d of docs) wanted.push(d);
      }
      const cached = {};
      for (const d of wanted) {
        const id = String(d.id);
        if (!(id in cached)) cached[id] = await store.get(account, id);
      }
      const missing = pickMissing(wanted, cached, RC, ownWrites);
      result.skipped = wanted.length - missing.length;
      let streak = 0;
      await mapLimit(missing, CONCURRENCY, async (d) => {
        if (streak >= MAX_FAILURES) return;
        let r = null;
        try { r = await PC.getArticle({ service, creds, id: String(d.id) }); } catch (_) { r = null; }
        if (r && r.ok && r.doc) {
          streak = 0;
          if (await store.put(account, r.doc)) result.fetched++;
          else result.failed++;
        } else {
          streak++;
          result.failed++;
        }
      });
      if (streak < MAX_FAILURES && ctx.images !== false) {
        const im = await prefetchImages(ctx, store, wanted);
        result.images = im.saved;
        result.imageFailed = im.failed;
      }
      return result;
    } catch (err) {
      log('預載例外', { reason: String(err && err.message || err).slice(0, 120) });
      result.failed++;
      return result;
    } finally {
      if (store && typeof store.close === 'function') store.close();
    }
  }

  let running = false;
  let timer = null;

  // 清單頁呼叫：符合條件就排一輪（START_DELAY_MS 後跑）
  function schedule(ctx) {
    if (running || timer) return false;
    const storage = ctx.storage;
    const now = Date.now();
    const isApp = !!(ctx.isApp != null ? ctx.isApp : (global.__JRead && global.__JRead.isAppRuntime && global.__JRead.isAppRuntime()));
    const go = (lastRunAt) => {
      if (!shouldRun({ isApp, service: ctx.service, lastRunAt, now, force: ctx.force })) return;
      const setT = (global.setTimeout || setTimeout);
      timer = setT(async () => {
        timer = null;
        running = true;
        try {
          await Promise.resolve(storage.set({ [LAST_RUN_KEY]: Date.now() })).catch(() => {});
          const r = await run(ctx);
          if (typeof ctx.log === 'function') ctx.log('離線預載完成', r);
        } finally {
          running = false;
        }
      }, ctx.delayMs != null ? ctx.delayMs : START_DELAY_MS);
    };
    if (!isApp || ctx.service !== 'jreader') return false;
    Promise.resolve(storage && storage.get ? storage.get(LAST_RUN_KEY) : {})
      .then((v) => go(v && v[LAST_RUN_KEY]), () => go(0));
    return true;
  }

  const api = {
    OFFLINE_TABS, OFFLINE_ITEMS, MIN_INTERVAL_MS, LAST_RUN_KEY, CONCURRENCY,
    shouldRun, pickMissing, run, schedule, imageUrlsOf, prefetchImages, MAX_IMAGES_PER_DOC, MAX_IMAGE_BYTES,
    _isRunning: () => running
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.__JReadReaderOffline = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
