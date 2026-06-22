// JRead — 閱讀位置記憶（v0.8.40）
//
// 文章看到一半離開（關分頁、退出閱讀模式、SPA 換頁）時記住閱讀位置，
// 在效期內（settings.positionMemoryDays，預設 3 天、上限 7、0 = 停用）
// 重新進入閱讀模式自動回到上次位置：
//
//   - 捲動模式：記「目前閱讀段落」的文字簽名 + 段落 index + 整篇進度比例。
//     回復時先用文字簽名在 space-scroll 的段落清單（NS.spaceScroll.getBlocks，
//     單一資料源——li / 圖庫拆圖等收集規則自動一致）找回同一段、捲到
//     REST_FRACTION 落點並把指示條錨上去；簽名找不到（內容改版）退 index、
//     再退進度比例。
//   - 翻頁模式：記頁碼 + 總頁數。回復時總頁數沒變直接跳同一頁；變了（字級 /
//     版心 / 視窗改變導致重新分頁）按進度比例換算。
//   - 跨模式（存的時候是捲動、回來開了翻頁，或反之）：用進度比例近似換算。
//
// 儲存：chrome.storage.local（快取類資料，依 CLAUDE.md 不放 sync——entry 含
// 段落文字、量大且無跨裝置意義）。單一 key `readingPositions` 存 { urlKey:
// entry } map；每次寫入順手淘汰過期 entry + 超量 entry（舊的先丟，上限
// MAX_ENTRIES）。urlKey 由 main.js 的 spaRouteKey 提供（呼叫端傳入——錨點
// hash 不分流、hash-router 分流，與 SPA 導航偵測同一份 key 語意）。
//
// 追蹤：reader mode 啟動期間 scroll / wheel / touch / keydown / click 觸發
// debounce 寫入；pagehide / 分頁切到背景立即 flush；退出閱讀模式時 main.js
// 在 pagedMode.uninstall **之前**呼叫 endSession()（uninstall 會把頁碼歸零、
// styler.restore 會還原排版——必須趁位置還有效時 flush）。
//
// 位置還在開頭（翻頁第 1 頁 / 捲動進度 < MIN_RATIO 且段落 index 0）時不記、
// 並刪掉舊 entry——「從頭開始」不需要回復，留著反而讓使用者重開時跳到開頭
// 以外的殘留位置。
//
// 跨環境匯出：content script 走 NS.positionMemory；純邏輯（效期 / 淘汰 /
// 段落比對 / 頁碼換算）走 module.exports 給 jsdom regression spec。
(function (global) {
  'use strict';

  const STORAGE_KEY = 'readingPositions';
  const DEFAULT_DAYS = 3;     // 預設效期（settings-defaults.js positionMemoryDays 的鏡像，spec 校對）
  const MAX_DAYS = 7;         // 效期上限（Jimmy 2026-06-11 指定）
  const MAX_ENTRIES = 100;    // map 超量淘汰上限（舊的先丟）
  const SAVE_DEBOUNCE_MS = 1000;
  const REASSERT_MS = 1200;   // lazy-load 內容推移版面後的二次對位延遲
  const MIN_RATIO = 0.02;     // 捲動進度低於此視為「還在開頭」→ 不記
  const SIG_LEN = 120;        // 段落文字簽名長度
  const REST_FRACTION = 0.1;  // 回復落點（space-scroll REST_FRACTION 的鏡像字面值，spec 校對）
  const DAY_MS = 86400000;

  // ---- 純邏輯（jsdom spec 直接測）----

  // 效期天數消毒：缺值 / 非數字回預設、超界 clamp 到 [0, MAX_DAYS]。
  // null / '' 必須先擋——Number(null) === 0 會把「缺值」誤判成「停用」
  //（升版舊 storage 沒這欄時整個功能靜默關閉）。
  function clampDays(v) {
    if (v === null || v === undefined || v === '') return DEFAULT_DAYS;
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_DAYS;
    return Math.max(0, Math.min(MAX_DAYS, Math.round(n)));
  }

  function isFresh(entry, now, days) {
    if (!entry || typeof entry.ts !== 'number') return false;
    if (!(days > 0)) return false;
    return now - entry.ts < days * DAY_MS;
  }

  // 淘汰：過期（依 days）+ 超量（新的留、舊的丟）。回傳新 map、不動原物件。
  function pruneMap(map, now, days, cap) {
    const keep = [];
    for (const k of Object.keys(map || {})) {
      if (isFresh(map[k], now, days)) keep.push([k, map[k]]);
    }
    keep.sort((a, b) => b[1].ts - a[1].ts);
    const out = {};
    for (const [k, e] of keep.slice(0, cap || MAX_ENTRIES)) out[k] = e;
    return out;
  }

  // 段落文字簽名：collapse 空白後取前 SIG_LEN 字。圖片等無文字單位簽名為空字串。
  function blockSignature(text) {
    return (text || '').replace(/\s+/g, ' ').trim().slice(0, SIG_LEN);
  }

  // 在段落簽名清單內找回儲存的段落：
  //   1. 簽名完全相符（同文重複時取離儲存 index 最近者——保護重複句式）
  //   2. fallback：儲存 index 仍在範圍內（內容微改、簽名變了但結構沒大動）
  //   3. 都不行回 -1（caller 退進度比例）
  function findBlockIndex(signatures, savedIndex, savedText) {
    const sig = blockSignature(savedText);
    if (sig) {
      let best = -1;
      for (let i = 0; i < signatures.length; i++) {
        if (signatures[i] !== sig) continue;
        if (best === -1 || Math.abs(i - savedIndex) < Math.abs(best - savedIndex)) best = i;
      }
      if (best !== -1) return best;
    }
    if (Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < signatures.length) {
      return savedIndex;
    }
    return -1;
  }

  // 翻頁模式回復頁碼：總頁數沒變直接用儲存頁碼；變了（重新分頁）/ 跨模式
  // （捲動 entry 回到翻頁模式）按進度比例換算。回 0-based 頁碼。
  function resolvePageIndex(entry, total) {
    if (!entry || !(total > 1)) return 0;
    if (entry.mode === 'paged' && entry.pages === total && Number.isInteger(entry.page)) {
      return Math.max(0, Math.min(total - 1, entry.page));
    }
    const r = Number(entry.ratio);
    if (!Number.isFinite(r) || r <= 0) return 0;
    return Math.max(0, Math.min(total - 1, Math.round(r * (total - 1))));
  }

  // 位置值不值得記：開頭不記（回復無意義，殘留反而誤導）
  function shouldPersist(pos) {
    if (!pos) return false;
    if (pos.mode === 'paged') return pos.page > 0;
    return pos.ratio > MIN_RATIO || pos.blockIndex > 0;
  }

  // ---- DOM 模組 ----

  let sessionKey = null;   // 進入閱讀模式時的 urlKey（SPA 換頁後 location 已變，flush 必須用進場時的 key）
  let days = DEFAULT_DAYS;
  let articleEl = null;
  let listening = false;
  let saveTimer = null;
  let reassertTimer = null;
  let interacted = false;  // 回復後使用者是否互動過（互動過就不做二次對位）

  // keydown 涵蓋翻頁鍵（←/→/Space）；click 涵蓋 space-scroll 點段落移指示條；
  // touchcancel 涵蓋 iOS 圖片上滑動翻頁（paged-mode onTouchCancel 補判路徑）
  const INTERACT_EVENTS = ['wheel', 'touchend', 'touchcancel', 'keydown', 'click'];

  function localGet(cb) {
    // v0.8.164：browser.storage.local.get 原生 Promise（reject → cb(null)，與舊
    // lastError 分支同語意）。
    try {
      browser.storage.local.get({ [STORAGE_KEY]: {} }).then((v) => {
        cb((v && v[STORAGE_KEY]) || {});
      }).catch(() => cb(null));
    } catch (_) { cb(null); }
  }
  function localSet(map) {
    try { browser.storage.local.set({ [STORAGE_KEY]: map }); } catch (_) { /* context invalidated */ }
  }

  // 讀目前閱讀位置。翻頁模式 → 頁碼；捲動模式 → 進度比例 + 段落錨點
  function capture() {
    const NS = global.__JRead;
    if (!NS) return null;
    if (NS.pagedMode && NS.pagedMode.isInstalled()) {
      const p = NS.pagedMode.getPosition();
      if (!p) return null;
      return {
        mode: 'paged',
        page: p.idx,
        pages: p.total,
        ratio: p.total > 1 ? p.idx / (p.total - 1) : 0
      };
    }
    const scroller = document.scrollingElement || document.documentElement;
    if (!scroller) return null;
    const maxTop = Math.max(0, scroller.scrollHeight - window.innerHeight);
    const ratio = maxTop > 0 ? scroller.scrollTop / maxTop : 0;
    let blockIndex = -1;
    let blockText = '';
    if (NS.spaceScroll && typeof NS.spaceScroll.currentAnchor === 'function') {
      const a = NS.spaceScroll.currentAnchor(articleEl);
      if (a) {
        blockIndex = a.index;
        blockText = blockSignature(a.el.textContent);
      }
    }
    return { mode: 'scroll', ratio, blockIndex, blockText };
  }

  function persistNow() {
    if (!sessionKey || !(days > 0)) return;
    const key = sessionKey;
    const pos = capture();
    localGet((map) => {
      if (!map) return;
      const now = Date.now();
      const next = pruneMap(map, now, days, MAX_ENTRIES);
      if (shouldPersist(pos)) {
        next[key] = Object.assign({ ts: now }, pos);
      } else {
        delete next[key]; // 回到開頭：清掉舊記錄
      }
      localSet(next);
    });
  }

  function scheduleSave() {
    if (!sessionKey) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; persistNow(); }, SAVE_DEBOUNCE_MS);
  }

  function onUserInteract() {
    interacted = true;
    if (reassertTimer) { clearTimeout(reassertTimer); reassertTimer = null; }
    scheduleSave();
  }
  function onScroll() { scheduleSave(); }
  function flushNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    persistNow();
  }
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') flushNow();
  }

  function installListeners() {
    if (listening) return;
    // capture phase：必須先於 keyguard 收到 keydown（keyguard 對非 ESC 鍵
    // stopImmediatePropagation，晚註冊的同 phase listener 收不到翻頁鍵）。
    // main.js finalizeEnter 在 installKeyguard 之前呼叫 beginSession 保證順序。
    window.addEventListener('scroll', onScroll, { passive: true });
    for (const t of INTERACT_EVENTS) {
      window.addEventListener(t, onUserInteract, { capture: true, passive: true });
    }
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    listening = true;
  }
  function removeListeners() {
    if (!listening) return;
    window.removeEventListener('scroll', onScroll, { passive: true });
    for (const t of INTERACT_EVENTS) {
      window.removeEventListener(t, onUserInteract, { capture: true, passive: true });
    }
    window.removeEventListener('pagehide', flushNow);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    listening = false;
  }

  // 把儲存的 entry 套到目前版面（restore 主體；lazy-load 二次對位也走這條）
  function applyEntry(entry, el) {
    const NS = global.__JRead;
    if (!NS) return;
    if (NS.pagedMode && NS.pagedMode.isInstalled()) {
      const p = NS.pagedMode.getPosition();
      if (!p) return;
      const n = resolvePageIndex(entry, p.total);
      if (n > 0) NS.pagedMode.goToPage(n);
      return;
    }
    // 捲動模式：段落錨點優先、進度比例 fallback
    let target = null;
    if (entry.mode === 'scroll' && NS.spaceScroll && typeof NS.spaceScroll.getBlocks === 'function') {
      const blocks = NS.spaceScroll.getBlocks(el);
      const sigs = blocks.map((b) => blockSignature(b.textContent));
      const i = findBlockIndex(sigs, entry.blockIndex, entry.blockText);
      if (i >= 0) target = blocks[i];
    }
    const scroller = document.scrollingElement || document.documentElement;
    if (!scroller) return;
    if (target) {
      const r = target.getBoundingClientRect();
      const top = scroller.scrollTop + r.top - window.innerHeight * REST_FRACTION;
      scroller.scrollTop = Math.max(0, top);
      if (NS.spaceScroll && typeof NS.spaceScroll.anchorTo === 'function') {
        NS.spaceScroll.anchorTo(target);
      }
    } else {
      const r = Number(entry.ratio);
      if (Number.isFinite(r) && r > 0) {
        const maxTop = Math.max(0, scroller.scrollHeight - window.innerHeight);
        scroller.scrollTop = maxTop * Math.min(1, r);
      }
    }
  }

  function restore(key, el) {
    localGet((map) => {
      if (!map) return;
      const entry = map[key];
      const now = Date.now();
      if (!isFresh(entry, now, days)) {
        // 過期殘留：順手清掉（不等下次寫入）
        if (entry) localSet(pruneMap(map, now, days, MAX_ENTRIES));
        return;
      }
      applyEntry(entry, el);
      // lazy-load 圖片 / 晚到內容會推移版面——短延遲後使用者還沒互動就再對位一次
      if (reassertTimer) clearTimeout(reassertTimer);
      reassertTimer = setTimeout(() => {
        reassertTimer = null;
        if (!interacted && sessionKey === key) applyEntry(entry, el);
      }, REASSERT_MS);
    });
  }

  // 進入閱讀模式：回復位置 + 開始追蹤。main.js finalizeEnter 在
  // syncPagedMode / syncSpaceScroll 之後（模組已 install、頁數已算好）、
  // installKeyguard 之前（listener 順序 invariant）呼叫。
  function beginSession(key, settings, el) {
    endSession(); // 保險：理論上 enter 前必 exit
    days = clampDays(settings && settings.positionMemoryDays);
    if (!(days > 0) || !key) return;
    sessionKey = key;
    articleEl = el || null;
    interacted = false;
    installListeners();
    restore(key, articleEl);
  }

  // 退出閱讀模式：flush 最後位置 + 停止追蹤。必須在 pagedMode.uninstall /
  // styler.restore 之前呼叫（位置此刻才有效）。未開始 session 時 no-op。
  function endSession() {
    if (!sessionKey) return;
    if (reassertTimer) { clearTimeout(reassertTimer); reassertTimer = null; }
    flushNow();
    removeListeners();
    sessionKey = null;
    articleEl = null;
  }

  // 設定即時變更（storage.onChanged）。改成 0 = 停用：停止追蹤（既有記錄
  // 保留，效期判定在讀取端）；0 → 正值在下次進入閱讀模式生效。
  function setDays(v) {
    days = clampDays(v);
    if (!(days > 0) && sessionKey) {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      if (reassertTimer) { clearTimeout(reassertTimer); reassertTimer = null; }
      removeListeners();
      sessionKey = null;
      articleEl = null;
    }
  }

  const api = {
    clampDays,
    isFresh,
    pruneMap,
    blockSignature,
    findBlockIndex,
    resolvePageIndex,
    shouldPersist,
    beginSession,
    endSession,
    setDays,
    isTracking: () => !!sessionKey,
    STORAGE_KEY, DEFAULT_DAYS, MAX_DAYS, MAX_ENTRIES, MIN_RATIO, REST_FRACTION
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // content script 環境：掛上 NS（namespace.js 先載入）
  if (typeof window !== 'undefined' && global === window && window.__JRead) {
    window.__JRead.positionMemory = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
