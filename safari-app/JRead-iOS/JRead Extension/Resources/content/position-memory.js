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
  const DIAG_KEY = 'readingPositionsDiag';  // 寫入失敗診斷（獨立 key，options 除錯區塊讀取顯示）
  const RESTORE_DIAG_KEY = 'readingPositionsRestoreDiag';  // v1.5.10 診斷：還原當下 found/total/resolved（options 顯示，釘 H2b vs H2c；確認後移除）
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

  // 移除孤兒 surrogate（合法代理對保留、單獨的高位或低位移除）。
  // 兩個來源：① slice(0, SIG_LEN) 可能從中切斷一個代理對、留下孤兒高位；
  // ② 少數頁面文字本身就含非法 UTF-16。孤兒 surrogate 進到 storage 值裡，
  // iOS Safari 的 storage.local.set 可能整包寫入失敗（Chrome 容忍）——一筆壞
  // 簽名就能讓「讀回整包 → 改一筆 → 整包寫回」的後續存檔全部卡死（即使總量
  // 只有幾 KB，與容量無關）。簽名只用於段落比對、丟掉個別字元無損功能。
  function stripLoneSurrogates(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        const n = s.charCodeAt(i + 1);
        if (n >= 0xDC00 && n <= 0xDFFF) { out += s[i] + s[i + 1]; i++; } // 合法代理對
        // else：孤兒高位 → 略過
      } else if (c >= 0xDC00 && c <= 0xDFFF) {
        // 孤兒低位 → 略過
      } else {
        out += s[i];
      }
    }
    return out;
  }

  // 段落文字簽名：collapse 空白後取前 SIG_LEN 字、再消毒孤兒 surrogate。
  // 圖片等無文字單位簽名為空字串。
  function blockSignature(text) {
    return stripLoneSurrogates((text || '').replace(/\s+/g, ' ').trim().slice(0, SIG_LEN));
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

  // v1.0.21：退出同步——把目前閱讀段落的 viewport 相對位置（rectTop）換算成
  // 還原後原網頁該捲到的絕對 scrollTop。錨點段落上方留 margin × viewport 高度
  // 的呼吸空間（不要把段落頂死在 viewport 最上緣）。負值 clamp 到 0。
  // 純函式：DOM 量測（scrollTop / rectTop / innerHeight）在呼叫端取得，這裡只算
  // 數值，jsdom spec 可直接測。
  const EXIT_SCROLL_MARGIN = 0.12;
  function computeExitScrollTop(scrollTop, rectTop, innerHeight, margin) {
    const m = Number.isFinite(margin) ? margin : EXIT_SCROLL_MARGIN;
    const top = Number(scrollTop) + Number(rectTop) - Number(innerHeight) * m;
    return Math.max(0, top);
  }

  // 位置值不值得記：開頭不記（回復無意義，殘留反而誤導）
  function shouldPersist(pos) {
    if (!pos) return false;
    if (pos.mode === 'paged') return pos.page > 0;
    return pos.ratio > MIN_RATIO || pos.blockIndex > 0;
  }

  // 從記憶體 map 算出寫入 payload：先 prune（過期 + 超量）再套用/刪除當前 entry。
  // shouldPersist 為 true → 寫入 { ts, ...pos } 並回該 entry；否則刪掉 key、回
  // null entry（回到開頭，殘留反而誤導）。回 { next, entry }。
  // 抽成純函式：persistNow 的同步寫入路徑（iOS 背景凍結防護）靠它在 handler 內
  // 同步算好 payload，不必先 async 讀回 storage。jsdom spec 直接測。
  function computeNextMap(map, key, pos, now, days, cap) {
    const next = pruneMap(map || {}, now, days, cap || MAX_ENTRIES);
    let entry = null;
    if (shouldPersist(pos)) {
      entry = Object.assign({ ts: now }, pos);
      next[key] = entry;
    } else {
      delete next[key];
    }
    return { next: next, entry: entry };
  }

  // ---- DOM 模組 ----

  let sessionKey = null;   // 進入閱讀模式時的 urlKey（SPA 換頁後 location 已變，flush 必須用進場時的 key）
  let memMap = null;       // 進場 restore 時 seed 的 readingPositions 整包記憶體副本——
                           // 讓 flush 能同步算 payload + 同步發 set（iOS 背景凍結 event
                           // loop 時，先 async 讀回再寫的舊路徑回呼永遠等不到 → set 從未
                           // 發出 → 強制關閉前位置丟失）。endSession 清回 null。
  let days = DEFAULT_DAYS;
  let articleEl = null;
  let listening = false;
  let saveTimer = null;
  let reassertTimer = null;
  let interacted = false;  // 回復後使用者是否互動過（互動過就不做二次對位）
  let _restoreBase = null; // v1.5.10 診斷：restore 算好的 found/page/pages，applyEntry 補 total/resolved 後寫出

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

  // 對 storage.local.set 的單一封裝：一律回 Promise（同步 throw——context
  // invalidated——也包成 reject 統一處理）。
  function rawSet(obj) {
    try { return Promise.resolve(browser.storage.local.set(obj)); }
    catch (e) { return Promise.reject(e); }
  }

  // 寫入失敗診斷：另存獨立 key 給 options 除錯區塊讀。poison 是 readingPositions
  // 值專屬時、乾淨小 key 仍寫得進；整個 store 全 wedge 時這也會失敗（best-effort、
  // 吞掉）。同步印 console 一份。
  function recordWriteError(err) {
    const msg = String((err && (err.message || err)) || 'unknown').slice(0, 200);
    try { rawSet({ [DIAG_KEY]: { ts: Date.now(), error: msg } }).catch(() => {}); } catch (_) {}
    try { if (typeof console !== 'undefined') console.warn('[JRead] 閱讀位置寫入失敗：' + msg); } catch (_) {}
  }

  // v1.5.10 診斷儀器（確認 H2b/H2c 後整段移除）：把還原當下的關鍵事實寫進獨立
  // key，options 除錯區塊讀取顯示。釘「強關後那篇記錄在不在磁碟 / 翻頁總頁數有沒
  // 有算好」——found=false → H2c（記錄沒刷到磁碟）；found=true 但 total<=1 → H2b
  //（冷啟動翻頁總頁數沒就緒）。best-effort、吞掉所有錯。
  function recordRestoreDiag(d) {
    try { rawSet({ [RESTORE_DIAG_KEY]: Object.assign({ ts: Date.now() }, d) }).catch(() => {}); } catch (_) {}
  }

  // 寫入整包 map + 自癒。setter(payloadObj) 回傳 Promise。整包寫入失敗（iOS
  // Safari 偶發 set reject）→ 退回只寫當前這一筆 { key: entry }、丟掉可能毀損的
  // 歷史 map，避免一筆壞資料卡死所有後續存檔（使用者不必手動清快取也會自癒）。
  // setter 注入以利 jsdom spec 純測。回傳 Promise<'ok'|'healed'|'failed'>。
  function writeWithSelfHeal(setter, key, entry, fullMap) {
    return Promise.resolve(setter({ [STORAGE_KEY]: fullMap })).then(
      () => 'ok',
      (err) => {
        recordWriteError(err);
        if (!key || !entry) return 'failed'; // 刪除情境（回到開頭）沒有可救的當前 entry
        const minimal = {}; minimal[key] = entry;
        return Promise.resolve(setter({ [STORAGE_KEY]: minimal })).then(() => 'healed', () => 'failed');
      }
    );
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
    const now = Date.now();
    if (memMap) {
      // 同步寫入路徑（iOS 背景凍結防護）：用進場 seed 的記憶體 map 同步算出
      // payload + 同步發出 set，不先 async 讀回。iOS Safari 頁面背景化會立刻凍結
      // event loop——「先 localGet 再於回呼裡 set」的舊路徑回呼永遠等不到、set 從
      // 未發出 → 使用者強制關閉前的位置丟失（重開停在第 1 頁）。直接 set 的 IPC 在
      // visibilitychange / pagehide handler 內同步送達 background 即落地。
      const r = computeNextMap(memMap, key, pos, now, days, MAX_ENTRIES);
      memMap = r.next;
      writeWithSelfHeal(rawSet, key, r.entry, r.next);
      return;
    }
    // memMap 尚未 seed（剛進場、restore 的讀取還沒回）→ 退回 async 讀改寫，順手 seed
    localGet((map) => {
      if (!map) return;
      const r = computeNextMap(map, key, pos, now, days, MAX_ENTRIES);
      memMap = r.next;
      writeWithSelfHeal(rawSet, key, r.entry, r.next);
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
      // v1.5.10 診斷：補 total / resolved 寫出（reassert 會再寫一次＝版面 settle 後的最終值）
      recordRestoreDiag(Object.assign({ stage: 'apply-paged' }, _restoreBase || {}, { total: p.total, resolved: n, goTo: n > 0 }));
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
      if (!map) { recordRestoreDiag({ stage: 'read-null' }); return; }
      memMap = map; // seed 記憶體 map：之後寫入走同步路徑（不再 async 讀回）
      const entry = map[key];
      const now = Date.now();
      // v1.5.10 診斷：強關後那篇記錄在不在磁碟（found）+ 它的頁碼，applyEntry 補 total/resolved
      _restoreBase = {
        keyTail: String(key).slice(-48), found: !!entry,
        fresh: isFresh(entry, now, days), mode: entry && entry.mode,
        page: entry && entry.page, pages: entry && entry.pages,
        mapCount: Object.keys(map).length
      };
      if (!isFresh(entry, now, days)) {
        recordRestoreDiag(Object.assign({ stage: 'not-fresh' }, _restoreBase));
        // 過期殘留：順手清掉（不等下次寫入）
        if (entry) {
          const pruned = pruneMap(map, now, days, MAX_ENTRIES);
          memMap = pruned;
          rawSet({ [STORAGE_KEY]: pruned }).catch(() => {});
        }
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
    memMap = null; // 下次進場 restore 重新 seed（避免跨 session 用到舊快照）
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
      memMap = null;
    }
  }

  const api = {
    clampDays,
    isFresh,
    pruneMap,
    blockSignature,
    stripLoneSurrogates,
    writeWithSelfHeal,
    findBlockIndex,
    resolvePageIndex,
    computeExitScrollTop,
    shouldPersist,
    computeNextMap,
    beginSession,
    endSession,
    setDays,
    isTracking: () => !!sessionKey,
    STORAGE_KEY, DIAG_KEY, DEFAULT_DAYS, MAX_DAYS, MAX_ENTRIES, MIN_RATIO, REST_FRACTION
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // content script 環境：掛上 NS（namespace.js 先載入）
  if (typeof window !== 'undefined' && global === window && window.__JRead) {
    window.__JRead.positionMemory = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
