// JRead — Safari 擴充 ↔ iOS 宿主 App 的 storage.sync 雙向同步（v2.2.0）
//
// 動機（Jimmy 2026-10-28）：iOS 宿主 App 內建 JReader（App 以 WKWebView 跑同一份
// reader/reader.html、article.html，見 safari-app/JRead-iOS/JRead/ViewController.swift），
// 設定（主題 / 字型 / Readwise 與 Instapaper 憑證 / 設定檔清單…）要跟 Safari 擴充同一份。
// 擴充與 App 是兩個 sandbox，唯一共用的地方是 App Group 容器。
//
// 架構：
//   - 共用鏡像 = App Group 容器內一份 JSON（safari-app/JRead-iOS/Shared/AppSyncStore.swift），
//     格式 { key: { vj: <JSON 字串>, ts: <ms>, del?: true } }，**逐鍵 last-writer-wins**。
//     合併規則只住 Swift 那一份（App 端寫入、擴充端經 native handler 寫入都走它）。
//   - 擴充端（本檔）：background 用 browser.runtime.sendNativeMessage 讀寫鏡像
//     （JRead Extension 的 SafariWebExtensionHandler 收訊息、呼叫 AppSyncStore.merge）。
//       pull：拿鏡像 → ts 比本機記錄新的鍵套進 storage.sync；再把本機有、鏡像沒有或沒送到的鍵推上去
//       push：storage.onChanged（sync）→ 改到的鍵蓋 ts=now 推上去
//     storage.local META_KEY 記「每個鍵已同步到哪個 ts」，避免把自己推上去的值再拉回來套一次。
//   - App 端：storage.sync 直接讀寫鏡像（jreader-app-shim.js），回前景時重讀鏡像、diff 後發 onChanged。
//
// 只在 Safari build 啟用：sendNativeMessage 需要 nativeMessaging 權限，該權限只由
// safari-app/patch-safari-manifest.sh 加進 Safari manifest（Chrome / Firefox 版沒有，
// runtime.sendNativeMessage 不存在 → install() 回 null、零副作用）。
//
// 這條驗 X、不驗 Y：plan* 純函式由 jsdom spec 驗合併決策；sendNativeMessage 在 iOS 實際
// 送達、event page 被 storage.onChanged 喚醒推送，只能模擬器 / 真機驗。

(function () {
  'use strict';

  const APP_ID = 'app.jread.ios';
  const MSG_TYPE = 'jread.sync';
  const META_KEY = '__jreadAppSyncMeta';
  const PULL_THROTTLE_MS = 30000;
  const REMOVED = '\u0000removed';

  function isEntry(e) {
    return !!e && typeof e === 'object' && typeof e.ts === 'number' && isFinite(e.ts);
  }

  // 鏡像 entries + 本機 meta → 要套進本機 storage.sync 的 set / remove 與新 meta。
  // 只套 ts 比 meta 新的鍵；vj 解析失敗的鍵跳過、不前進 meta（下次再試）。
  function planPull(entries, meta) {
    const set = {};
    const remove = [];
    const nextMeta = Object.assign({}, meta || {});
    for (const k of Object.keys(entries || {})) {
      const e = entries[k];
      if (!isEntry(e) || k === META_KEY) continue;
      if (e.ts <= (nextMeta[k] || 0)) continue;
      if (e.del) {
        remove.push(k);
      } else {
        try { set[k] = JSON.parse(e.vj); } catch (_) { continue; }
      }
      nextMeta[k] = e.ts;
    }
    return { set, remove, meta: nextMeta };
  }

  // pull 套完之後，本機 storage.sync 全量 vs 鏡像 → 要推上去的鍵：
  //   - 鏡像完全沒有的鍵（初次 seed / App 重裝鏡像被清空）
  //   - 鏡像那筆本機已經看過（ts <= meta）、但本機值跟它不同（本機改過、推送失敗沒送到）
  //   - 鏡像有值、本機已刪且看過那筆 → 推刪除
  // 「本機沒看過的鏡像寫入」一律交給 planPull 套用，這裡不碰（對端較新）。
  function planReconcile(localAll, entries, meta, now) {
    const out = {};
    const all = localAll || {};
    const ent = entries || {};
    const m = meta || {};
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    for (const k of Object.keys(all)) {
      if (k === META_KEY || all[k] === undefined) continue;
      const vj = JSON.stringify(all[k]);
      const e = ent[k];
      if (!isEntry(e)) { out[k] = { vj, ts: now }; continue; }
      if (e.ts > (m[k] || 0)) continue;
      if (e.del || e.vj !== vj) out[k] = { vj, ts: now };
    }
    for (const k of Object.keys(ent)) {
      if (k === META_KEY || has(all, k)) continue;
      const e = ent[k];
      if (!isEntry(e) || e.del || e.ts > (m[k] || 0)) continue;
      out[k] = { del: true, ts: now };
    }
    return out;
  }

  // storage.onChanged（sync）的 changes → 要推上去的 entries。
  // applying 是「pull 剛套進來的值」（key → JSON 字串 / REMOVED）：值相同代表是自己
  // 套用引起的 onChanged，不可再推（否則 ts 被蓋成 now、對端較新的寫入會被吃掉）。
  function planPush(changes, applying, now) {
    const out = {};
    for (const k of Object.keys(changes || {})) {
      if (k === META_KEY) continue;
      const c = changes[k] || {};
      const removed = !('newValue' in c) || c.newValue === undefined;
      const sig = removed ? REMOVED : JSON.stringify(c.newValue);
      if (applying && Object.prototype.hasOwnProperty.call(applying, k)) {
        const hit = applying[k] === sig;
        delete applying[k];
        if (hit) continue;
      }
      out[k] = removed ? { del: true, ts: now } : { vj: sig, ts: now };
    }
    return out;
  }

  // background 端掛上同步。回 null = 不是 Safari build（沒有 sendNativeMessage）。
  function install(browser, opts) {
    const o = opts || {};
    if (!browser || !browser.runtime || typeof browser.runtime.sendNativeMessage !== 'function') return null;
    if (!browser.storage || !browser.storage.sync || !browser.storage.local) return null;
    const now = o.now || (() => Date.now());
    const applying = {};
    let lastPull = 0;
    let pulling = null;

    function send(entries) {
      return Promise.resolve(browser.runtime.sendNativeMessage(APP_ID, { type: MSG_TYPE, entries: entries || {} }))
        .then((r) => (r && r.entries && typeof r.entries === 'object') ? r.entries : {});
    }

    function readMeta() {
      return browser.storage.local.get({ [META_KEY]: {} }).then((s) => (s && s[META_KEY]) || {});
    }

    function bumpMeta(entries) {
      const keys = Object.keys(entries);
      if (!keys.length) return Promise.resolve();
      return readMeta().then((meta) => {
        for (const k of keys) meta[k] = Math.max(meta[k] || 0, entries[k].ts);
        return browser.storage.local.set({ [META_KEY]: meta });
      });
    }

    async function doPull() {
      lastPull = now();
      const entries = await send({});
      const meta = await readMeta();
      const plan = planPull(entries, meta);
      const setKeys = Object.keys(plan.set);
      for (const k of setKeys) applying[k] = JSON.stringify(plan.set[k]);
      for (const k of plan.remove) applying[k] = REMOVED;
      // meta 先落盤再套值：套值觸發的 onChanged 就算漏了 applying 比對，推上去的 ts 也只會
      // 比鏡像新、值相同，不會吃掉對端資料
      await browser.storage.local.set({ [META_KEY]: plan.meta });
      if (setKeys.length) await browser.storage.sync.set(plan.set);
      if (plan.remove.length) await browser.storage.sync.remove(plan.remove);
      const all = await browser.storage.sync.get(null);
      const out = planReconcile(all, entries, plan.meta, now());
      if (Object.keys(out).length) {
        await bumpMeta(out);
        await send(out);
      }
      return { applied: setKeys.length + plan.remove.length, pushed: Object.keys(out).length };
    }

    function pull() {
      if (!pulling) {
        pulling = doPull().catch((e) => ({ error: String(e && e.message || e) }))
          .finally(() => { pulling = null; });
      }
      return pulling;
    }

    function pullThrottled() {
      if (now() - lastPull < PULL_THROTTLE_MS) return null;
      return pull();
    }

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const entries = planPush(changes, applying, now());
      if (!Object.keys(entries).length) return;
      // meta 先前進再送：送失敗時本機值 ≠ 鏡像且 meta >= 鏡像 ts，下次 pull 的 planReconcile 會補推
      bumpMeta(entries).then(() => send(entries)).catch(() => {});
    });

    pull();
    return { pull, pullThrottled };
  }

  const api = { APP_ID, MSG_TYPE, META_KEY, planPull, planReconcile, planPush, install };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    const g = (typeof globalThis !== 'undefined') ? globalThis
      : (typeof window !== 'undefined') ? window
        : self;
    g.__JReadAppSync = api;
  }
})();
