// JRead — host 替身共用核心（v2.6.0）
//
// JRead 的 reader / content / popup 模組呼叫的是擴充 API（browser.storage / runtime…）。
// 擴充以外的 host 沒有這些 API，由「替身（shim）」在頁面載入最前面裝上。替身分兩層：
//   - 本檔：跟平台無關的部分——browser / chrome 物件形狀、storage 語意（get 的四種 keys
//     形狀、set / remove 只對真的變了的 key 發 onChanged、值一律深拷貝）、onChanged、
//     同頁多個 frame 之間廣播 storage 變更、sendMessage 一律 resolve undefined（沒有
//     background，與 Safari 對沒有 listener 的 sendMessage 行為相同，呼叫端本來就要容忍）
//   - backend：各 host 自己的儲存與網址——
//       iOS App：safari-app/JRead-iOS/shim-src/app-backend.js（WKWebView bridge、App Group
//                鏡像），由 tools/build-host-shims.js 與本檔組成 jreader-app-shim.js
//       網頁版：jread/lib/web-host-shim.js（localStorage、host 宣告的網址）
//
// backend 介面（create(backend)）：
//   baseUrl        runtime.getURL 的前段（結尾帶 /）
//   runtimeId      runtime.id（必須 truthy：NS.safeSendMessage 以它判定 context 有效）
//   manifest       runtime.getManifest() 回傳的物件（每次回深拷貝）
//   load()         → Promise<{ sync: {k: v}, local: {k: v} }>，已解析好的值
//   persist(area, setItems, removeKeys) → Promise，寫入 backend
//   frameKey       掛在 window 上、給同頁其他 frame 找到本 frame 的屬性名（廣播用）
//   pinned         選用：{ sync: {k: v} }——host 釘住的值。get 一律讀到它、set / remove
//                  略過它（不寫入、不發 onChanged）。網頁版用來提供 JReader 網址與 session
//                  sentinel token，憑證不進 localStorage
//   tabsCreate(o)  選用：tabs.create 的實作（預設整頁導向 o.url）
//
// 這條驗 X、不驗 Y：test/regression/host-shim-core.spec.js 與 ios-app-jreader-shim.spec.js
// 用 jsdom 驗 storage 語意 / onChanged / 跨 frame 廣播 / runtime；各 backend 的真實儲存
//（WKWebView bridge、瀏覽器 localStorage 配額）不在範圍內。
(function (root) {
  'use strict';

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

  function create(backend, win) {
    const w = win || root;
    const b = backend || {};
    const onChanged = makeEvent();
    const cache = { sync: new Map(), local: new Map() };
    const pinned = { sync: new Map(), local: new Map() };
    for (const area of ['sync', 'local']) {
      const p = b.pinned && b.pinned[area];
      if (p) for (const k of Object.keys(p)) if (p[k] !== undefined) pinned[area].set(k, clone(p[k]));
    }
    const fillPinned = (area) => { for (const [k, v] of pinned[area]) cache[area].set(k, clone(v)); };

    const ready = Promise.resolve()
      .then(() => b.load())
      .then((loaded) => {
        for (const area of ['sync', 'local']) {
          const items = (loaded && loaded[area]) || {};
          for (const k of Object.keys(items)) cache[area].set(k, items[k]);
          fillPinned(area);
        }
      })
      .catch((e) => {
        for (const area of ['sync', 'local']) fillPinned(area);
        console.error('[JRead host] storage 載入失敗', e);
      });

    // 同一頁裡每個 frame 各有一份替身（各自的 cache / onChanged）。設定浮層是文章頁裡的
    // popup.html iframe，它寫入的設定外層收不到 onChanged → 改了不會即時重套。寫入後把
    // changes 轉給同 top 底下的其他 frame（同源，可直接互呼），收方更新自己的 cache 再發
    // onChanged——等同擴充裡 storage.onChanged 跨頁廣播
    function eachOtherFrame(fn) {
      const key = b.frameKey;
      if (!key) return;
      const walk = (x) => {
        if (x !== w) {
          try { if (x[key] && x[key]._remoteChange) fn(x[key]); } catch (_) { /* 跨源 / 已卸載 */ }
        }
        let n = 0;
        try { n = x.frames.length; } catch (_) { return; }
        for (let i = 0; i < n; i++) walk(x.frames[i]);
      };
      try { walk(w.top); } catch (_) { /* 拿不到 top 就只通知自己 */ }
    }
    function applyRemote(changes, area) {
      const map = cache[area];
      if (!map) return;
      ready.then(() => {
        for (const k of Object.keys(changes)) {
          if (pinned[area].has(k)) continue;
          const c = changes[k];
          if (c && 'newValue' in c) map.set(k, clone(c.newValue));
          else map.delete(k);
        }
        onChanged._fire(clone(changes), area);
      });
    }

    function fire(changes, area) {
      if (!Object.keys(changes).length) return;
      setTimeout(() => onChanged._fire(changes, area), 0);
      eachOtherFrame((other) => other._remoteChange(clone(changes), area));
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
              if (pinned[area].has(k)) continue;
              const v = clone(items[k]);
              const had = map.has(k);
              const old = map.get(k);
              map.set(k, v);
              setItems[k] = v;
              if (!had || !same(old, v)) changes[k] = had ? { oldValue: clone(old), newValue: clone(v) } : { newValue: clone(v) };
            }
            fire(changes, area);
            if (!Object.keys(setItems).length) return undefined;
            return Promise.resolve(b.persist(area, setItems, [])).then(() => undefined);
          });
        },
        remove(keys) {
          return ready.then(() => {
            const list = (Array.isArray(keys) ? keys : [keys]).filter((k) => typeof k === 'string');
            const changes = {};
            const removed = [];
            for (const k of list) {
              if (!map.has(k) || pinned[area].has(k)) continue;
              changes[k] = { oldValue: clone(map.get(k)) };
              map.delete(k);
              removed.push(k);
            }
            fire(changes, area);
            if (!removed.length) return undefined;
            return Promise.resolve(b.persist(area, {}, removed)).then(() => undefined);
          });
        },
        clear() {
          return ready.then(() => this.remove(Array.from(map.keys())));
        }
      };
    }

    // backend 自己的儲存被別處改了（App 回前景重讀鏡像、網頁版其他分頁寫 localStorage）：
    // 用新的整份值取代 cache，回傳 changes（沒變就是空物件）。發不發 onChanged 由呼叫端決定
    function replaceArea(area, next) {
      const map = cache[area];
      const changes = {};
      for (const [k, v] of next) {
        if (pinned[area].has(k)) continue;
        if (!map.has(k)) changes[k] = { newValue: clone(v) };
        else if (!same(map.get(k), v)) changes[k] = { oldValue: clone(map.get(k)), newValue: clone(v) };
      }
      for (const [k, v] of map) if (!next.has(k) && !pinned[area].has(k)) changes[k] = { oldValue: clone(v) };
      map.clear();
      for (const [k, v] of next) if (!pinned[area].has(k)) map.set(k, v);
      fillPinned(area);
      return changes;
    }

    const BASE = String(b.baseUrl || '');
    const MANIFEST = b.manifest || { version: '0.0.0' };
    const noopEvent = () => makeEvent();
    const api = {
      runtime: {
        id: b.runtimeId || 'jread-host',
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
        create: (o) => {
          if (typeof b.tabsCreate === 'function') return Promise.resolve(b.tabsCreate(o)).then(() => ({}));
          if (o && o.url) w.location.href = o.url;
          return Promise.resolve({});
        }
      },
      i18n: { getMessage: () => '' }
    };

    function install() {
      w.browser = api;
      w.chrome = api;
      return api;
    }

    return { api, install, ready, cache, onChanged, applyRemote, replaceArea, makeEvent, clone, same };
  }

  const core = { create, makeEvent, clone, same };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = core;
  } else {
    root.__JReadHostShimCore = core;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
