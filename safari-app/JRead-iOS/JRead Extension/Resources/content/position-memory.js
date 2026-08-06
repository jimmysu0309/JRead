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
  // v1.7.42：v1.5.10 的 restore 診斷儀器（RESTORE_DIAG_KEY / recordRestoreDiag /
  // _restoreBase）觀察期結束移除（Jimmy 2026-08-05 裁定）——每次 restore 多
  // 2-3 次 storage 寫入，iOS storage 寫入是本模組痛點。舊 key
  // 'readingPositionsRestoreDiag' 殘值由 options「清除快取」（storage.local.clear）
  // 一併帶走，不另寫遷移碼。
  const DEFAULT_DAYS = 3;     // 預設效期（settings-defaults.js positionMemoryDays 的鏡像，spec 校對）
  const MAX_DAYS = 7;         // 效期上限（Jimmy 2026-06-11 指定）
  const MAX_ENTRIES = 100;    // map 超量淘汰上限（舊的先丟）
  const SAVE_DEBOUNCE_MS = 1000;
  const MIN_WRITE_INTERVAL_MS = 5000; // v1.7.44 E3：可見路徑整包寫入節流窗口（見 writeThrottleDelay）
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

  // v1.7.41（P2）：把其他分頁寫入 storage 的 readingPositions 合併進本分頁的
  // memMap。兩分頁同時可見（並排視窗 / Split View）時 visibilitychange 不觸發、
  // v1.6.24 的可見時 re-seed 接不到——各分頁持 stale 快照整包覆蓋 readingPositions
  // 會互抹 entry（A 分頁關閉後 B 持續以缺 A entry 的快照寫回 → A 位置永久遺失）。
  // 合併策略：以 storage 的 newValue 為基底（其他分頁的 entry 全收），本分頁自己
  // 的 entry 取 ts 較新者保留（自己剛捲動、debounce 還沒 flush 時 memMap 比
  // storage 新，不能被舊值蓋回）。純函式供 jsdom spec 直測。
  function mergeExternalMap(mem, incoming, ownKey) {
    const next = Object.assign({}, incoming || {});
    if (ownKey && mem && mem[ownKey]) {
      const own = mem[ownKey];
      const inc = next[ownKey];
      if (!inc || (own.ts || 0) >= (inc.ts || 0)) next[ownKey] = own;
    }
    return next;
  }

  // v1.7.44（E3）：可見路徑寫入節流決策。捲動中每次 debounce 都整包序列化
  // readingPositions（滿載 ~100 entry 約 20-30KB）寫 storage＝每秒一次白付的
  // 序列化 + IPC。節流成窗口內至多一次；窗口內的呼叫回傳剩餘毫秒數，呼叫端排
  // trailing 寫入把停止捲動後的最後位置補上。force（flush 路徑：pagehide /
  // visibilitychange hidden / endSession）一律立即寫——iOS 背景凍結防護與退出
  // 落盤語意不變，節流只作用在「頁面可見、持續捲動」的中間態。純函式供 spec 直測。
  // 回傳 0 = 立即寫；> 0 = 應延後的毫秒數。
  function writeThrottleDelay(now, lastTs, force) {
    if (force) return 0;
    const elapsed = now - (lastTs || 0);
    return elapsed >= MIN_WRITE_INTERVAL_MS ? 0 : MIN_WRITE_INTERVAL_MS - elapsed;
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
  let lastWriteTs = 0;     // 上次整包寫 storage 的時刻（writeThrottleDelay 節流基準）
  let reassertTimer = null;
  let interacted = false;  // 回復後使用者是否互動過（互動過就不做二次對位）

  // keydown 涵蓋翻頁鍵（←/→/Space）；click 涵蓋 space-scroll 點段落移指示條；
  // touchcancel 涵蓋 iOS 圖片上滑動翻頁（paged-mode onTouchCancel 補判路徑）
  const INTERACT_EVENTS = ['wheel', 'touchend', 'touchcancel', 'keydown', 'click'];

  // v1.5.28：擴充 context 是否仍有效。擴充 reload / 自動更新後，已開分頁的舊
  // content script 變孤兒——`browser.storage`（Chrome 下 = chrome.storage）被
  // 剝離、`browser.runtime.id` 變 undefined（namespace.js 也用此訊號）。此時任何
  // 寫入都會丟「Cannot read properties of undefined (reading 'local')」，那是預期
  // 情況、非真正寫入失敗，應安靜略過不噴 warn 給使用者（Jimmy 2026-07-02 Instapaper
  // 舊分頁實測）。
  function contextValid() {
    try {
      return !!(typeof browser !== 'undefined' && browser &&
        browser.runtime && browser.runtime.id &&
        browser.storage && browser.storage.local);
    } catch (_) { return false; }
  }

  function localGet(cb) {
    // v0.8.164：browser.storage.local.get 原生 Promise（reject → cb(null)，與舊
    // lastError 分支同語意）。context 失效 → cb(null)（安靜略過）。
    if (!contextValid()) { cb(null); return; }
    try {
      browser.storage.local.get({ [STORAGE_KEY]: {} }).then((v) => {
        cb((v && v[STORAGE_KEY]) || {});
      }).catch(() => cb(null));
    } catch (_) { cb(null); }
  }

  // 對 storage.local.set 的單一封裝：一律回 Promise（同步 throw——context
  // invalidated——也包成 reject 統一處理）。context 失效 → resolve no-op（無有效
  // storage 可寫，安靜當成功、不觸發 self-heal / warn）。
  function rawSet(obj) {
    if (!contextValid()) return Promise.resolve();
    try { return Promise.resolve(browser.storage.local.set(obj)); }
    catch (e) { return Promise.reject(e); }
  }

  // 寫入失敗診斷：另存獨立 key 給 options 除錯區塊讀。poison 是 readingPositions
  // 值專屬時、乾淨小 key 仍寫得進；整個 store 全 wedge 時這也會失敗（best-effort、
  // 吞掉）。同步印 console 一份。
  function recordWriteError(err) {
    // context 失效（reload / 更新後舊分頁孤兒）造成的寫入失敗是預期情況，
    // 安靜略過——不寫 diag、不噴 warn（否則使用者看到誤導性錯誤通知）。
    if (!contextValid()) return;
    const msg = String((err && (err.message || err)) || 'unknown').slice(0, 200);
    try { rawSet({ [DIAG_KEY]: { ts: Date.now(), error: msg } }).catch(() => {}); } catch (_) {}
    try { if (typeof console !== 'undefined') console.warn('[JRead] 閱讀位置寫入失敗：' + msg); } catch (_) {}
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

  function persistNow(force) {
    if (!sessionKey || !(days > 0)) return;
    if (!contextValid()) return;  // 擴充 context 失效（reload / 更新後舊分頁孤兒）→ 安靜略過
    const now = Date.now();
    // v1.7.44 E3：可見路徑節流（見 writeThrottleDelay 註解）。窗口內不寫盤、
    // 排 trailing 寫入補最後位置；flush 路徑 force=true 一律立即寫
    const delay = writeThrottleDelay(now, lastWriteTs, !!force);
    if (delay > 0) {
      if (!saveTimer) {
        saveTimer = setTimeout(() => { saveTimer = null; persistNow(); }, delay);
      }
      return;
    }
    lastWriteTs = now;
    const key = sessionKey;
    const pos = capture();
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
    persistNow(true); // flush 語意：略過節流、立即落盤（iOS 背景凍結防護不變）
  }
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') { flushNow(); return; }
    // v1.6.24：恢復可見時重新 seed memMap——同步寫入路徑用「進場 seed 的快照 +
    // 本分頁 entry」整包覆蓋 readingPositions，若使用者在其他分頁也在閱讀並存了
    // 位置，本分頁的舊快照會把對方剛存的 entry 整包抹掉（跨分頁 last-writer-wins）。
    // 頁面可見時 event loop 未凍結、async 讀取安全（iOS 背景凍結防護只影響
    // hidden 路徑）；本分頁最後位置已在轉 hidden 時 flush 落盤，重讀不掉資料。
    if (document.visibilityState === 'visible' && sessionKey) {
      localGet((map) => {
        if (map && sessionKey) memMap = map;
      });
    }
  }

  // v1.7.41（P2）：storage.onChanged 即時合併其他分頁的寫入（詳見 mergeExternalMap
  // 註解）。session 期間才掛（installListeners / removeListeners 生命週期一致）。
  // 自己的寫入也會觸發——merge 冪等（newValue 已含自己剛寫的 entry、ts 相同取
  // memMap 版本，結果不變）。
  function onStorageChanged(changes, area) {
    if (area !== 'local' || !changes || !changes[STORAGE_KEY]) return;
    if (!sessionKey || !memMap) return;
    memMap = mergeExternalMap(memMap, changes[STORAGE_KEY].newValue, sessionKey);
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
    try {
      if (contextValid() && browser.storage.onChanged &&
          typeof browser.storage.onChanged.addListener === 'function') {
        browser.storage.onChanged.addListener(onStorageChanged);
      }
    } catch (_) { /* onChanged 不可用（孤兒 context 等）→ 退化為舊行為 */ }
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
    try {
      if (typeof browser !== 'undefined' && browser && browser.storage &&
          browser.storage.onChanged &&
          typeof browser.storage.onChanged.removeListener === 'function') {
        browser.storage.onChanged.removeListener(onStorageChanged);
      }
    } catch (_) { /* 對稱移除 best-effort */ }
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

  function restore(key, el, entryOverride) {
    // v1.7.49：進場捲動同步 override（main.js captureEnterScrollAnchor）——
    // 使用者在原頁已捲離文首才開閱讀模式，以原頁當下位置為準、不套 storage
    // 的上次位置（兩者衝突時「剛才讀到哪」才是使用者要的）。memMap seed 照舊
    //（之後的寫入路徑需要）；override 是本次進場的即時幾何、不受 isFresh 效期
    // 檢查。同步 apply（不等 storage 往返）——版面此刻已就緒，早一拍到位。
    if (entryOverride) {
      localGet((map) => {
        if (sessionKey !== key) return;
        if (map) memMap = map;
      });
      applyEntry(entryOverride, el);
      if (reassertTimer) clearTimeout(reassertTimer);
      reassertTimer = setTimeout(() => {
        reassertTimer = null;
        if (!interacted && sessionKey === key) applyEntry(entryOverride, el);
      }, REASSERT_MS);
      return;
    }
    localGet((map) => {
      // v1.7.39：storage 往返期間可能已 endSession（快速 ESC / SPA 導航——exit
      // 是同步的，async 讀回來時 session 已結束）。過期回呼不得：① memMap 被
      // 復活成殘留快照；② 對已還原的原站頁面執行捲動；③ 經 spaceScroll
      // .getBlocks → ensureBlocksCacheInvalidators 在 uninstall 之後重掛
      // MutationObserver / ResizeObserver / resize listener（洩漏到下次進
      // reader 才拆）。同函式下方 reassert timer 本就有同款 guard，主路徑補齊。
      if (sessionKey !== key) return;
      if (!map) return;
      memMap = map; // seed 記憶體 map：之後寫入走同步路徑（不再 async 讀回）
      const entry = map[key];
      const now = Date.now();
      if (!isFresh(entry, now, days)) {
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
  // v1.7.49：opts.entryOverride——進場捲動同步的 entry（見 restore 註解）
  function beginSession(key, settings, el, opts) {
    endSession(); // 保險：理論上 enter 前必 exit
    days = clampDays(settings && settings.positionMemoryDays);
    const override = opts && opts.entryOverride;
    if (!(days > 0) || !key) {
      // 位置記憶停用（days=0）時進場同步仍要套——那不是跨 session 記憶，
      // 是「接續使用者剛才在原頁讀到的位置」的當下對位，不受記憶開關管
      if (override && el) applyEntry(override, el);
      return;
    }
    sessionKey = key;
    articleEl = el || null;
    interacted = false;
    installListeners();
    restore(key, articleEl, override);
  }

  // v1.7.43 T11：session 收尾共用（endSession 與 setDays(0) 停用路徑原本各寫
  // 一份、逐項重複）。flush=true 把最後位置立即落盤（flushNow 內含 saveTimer
  // 清理）；flush=false 只停止追蹤、丟棄 pending 寫入（設定改 0 = 使用者要求
  // 停用，既有記錄保留、不再寫入）。
  function teardown(opts) {
    if (opts && opts.flush) {
      flushNow();
    } else if (saveTimer) {
      clearTimeout(saveTimer); saveTimer = null;
    }
    if (reassertTimer) { clearTimeout(reassertTimer); reassertTimer = null; }
    removeListeners();
    sessionKey = null;
    articleEl = null;
    memMap = null; // 下次進場 restore 重新 seed（避免跨 session 用到舊快照）
  }

  // 退出閱讀模式：flush 最後位置 + 停止追蹤。必須在 pagedMode.uninstall /
  // styler.restore 之前呼叫（位置此刻才有效）。未開始 session 時 no-op。
  function endSession() {
    if (!sessionKey) return;
    teardown({ flush: true });
  }

  // 設定即時變更（storage.onChanged）。改成 0 = 停用：停止追蹤（既有記錄
  // 保留，效期判定在讀取端）；0 → 正值在下次進入閱讀模式生效。
  function setDays(v) {
    days = clampDays(v);
    if (!(days > 0) && sessionKey) teardown({ flush: false });
  }

  const api = {
    clampDays,
    isFresh,
    pruneMap,
    blockSignature,
    stripLoneSurrogates,
    writeWithSelfHeal,
    contextValid,
    recordWriteError,
    findBlockIndex,
    resolvePageIndex,
    computeExitScrollTop,
    shouldPersist,
    computeNextMap,
    mergeExternalMap,
    writeThrottleDelay,
    beginSession,
    endSession,
    setDays,
    isTracking: () => !!sessionKey,
    STORAGE_KEY, DIAG_KEY, DEFAULT_DAYS, MAX_DAYS, MAX_ENTRIES, MIN_RATIO, REST_FRACTION,
    MIN_WRITE_INTERVAL_MS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // content script 環境：掛上 NS（namespace.js 先載入）
  if (typeof window !== 'undefined' && global === window && window.__JRead) {
    window.__JRead.positionMemory = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
