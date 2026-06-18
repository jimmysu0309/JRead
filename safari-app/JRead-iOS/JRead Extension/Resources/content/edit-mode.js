// JRead — 編輯模式（手動移除雜訊段落）
// v0.8.108：閱讀模式啟動時，使用者可進編輯模式手動點掉 cleaner 漏網的雜訊
// 區塊。hover 標亮合理 block 邊界、點擊隱藏、頁內 toolbar 提供「復原 / 完成」。
//
// 設計重點：
//   - block 邊界用「演算法 C」選取（inline-level 正規化到所屬 block → tight-
//     wrapper climb），real-site probe 驗證：點段落內連結→整段、點段落→該段、
//     點圖→figure wrapper，且絕不誤選把全文包住的 dominant wrapper（probe 抓到
//     演算法 A「爬到 articleEl 直接子」的 over-select 陷阱）。
//   - 隱藏複用 NS.cleaner.hideElement(el, NS.state.hiddenEls)：同一條 inline
//     `display:none !important` + restyle observer 機制；記錄塞進 hiddenEls →
//     退出閱讀模式時既有 cleaner.restore 一併還原（單一資料源，本模組不自寫
//     還原路徑）。送 Readwise 的 buildCleanHtml 也已剔除 [data-jread-hidden]，
//     手動移除的段落自動不進 Readwise。
//   - overlay + toolbar 以 Shadow DOM 封裝（host pointer-events:none，事件穿透
//     到頁面元素；toolbar 子層 pointer-events:auto 可點）。
//   - keyguard / ESC / space-scroll / paged-mode 的暫停與還原由 main.js 主導
//     （那些 interaction layer 的生命週期本就住在 main.js）；本模組只負責編輯
//     互動本身，退出時透過 onExit callback 通知 main.js 還原。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;
  if (NS.editMode) return; // 重複注入保險

  const HOST_ID = '__jread-editmode-host';

  let active = false;
  let articleEl = null;
  let articleLen = 0;       // 進入時主文字數，dominant-wrapper guard 用
  let onExitCb = null;
  let host = null, shadow = null, overlay = null, hint = null, undoBtn = null, doneBtn = null;
  let hoverTarget = null;   // 目前 hover 選中的 block
  const editStack = [];     // 本 session 移除的還原記錄（undo 用）

  // ---- block 邊界選取（演算法 C，real-site probe 驗證）-----------------------
  const INLINE_DISPLAYS = new Set(['inline', 'inline-block', 'inline-flex', 'contents']);

  function textLen(el) {
    const raw = el.innerText != null ? el.innerText : el.textContent;
    return (raw || '').replace(/\s+/g, ' ').trim().length;
  }

  function isInline(el) {
    try { return INLINE_DISPLAYS.has(getComputedStyle(el).display); } catch (_) { return false; }
  }

  function chooseBlock(node) {
    if (!node || node === articleEl || !articleEl || !articleEl.contains(node)) return null;
    let c = node;
    // 1) inline-level（連結 / span / 粗體等）正規化到所屬 block——點段落內的
    //    連結時要選到整段，而非只選到連結本身。
    while (c !== articleEl && c.parentElement && c.parentElement !== articleEl &&
           articleEl.contains(c.parentElement) && isInline(c)) {
      c = c.parentElement;
    }
    // 2) tight-wrapper climb：parent 幾乎只是 cand 的純包裝（單一子或文字長度
    //    相近）才往上爬，合併 CMS 無謂 wrapper。遇到「含多個實質子的容器」就
    //    停手——避免一路爬到把全文包住的 dominant content wrapper（probe 抓到
    //    的 over-select 陷阱：Substack `<article>` 下單一 div 佔全文 99%）。
    while (c.parentElement && c.parentElement !== articleEl && articleEl.contains(c.parentElement)) {
      const p = c.parentElement;
      const pLen = textLen(p), cLen = textLen(c);
      const tight = p.children.length <= 1 || pLen <= Math.max(cLen * 1.3, cLen + 30);
      if (!tight) break;
      c = p;
    }
    // 3) dominant-wrapper guard：使用者直接 hover 到「大型多子容器自身的留白」
    //    時 node 就是該 wrapper，上面兩步都不動它 → 會選到整篇。拒絕「字數 ≥
    //    主文 60% 且子元素 ≥ 3」的塊（單一大段落子元素少、不會誤判）。
    if (articleLen > 0 && c.children.length >= 3 && textLen(c) >= articleLen * 0.6) return null;
    return c;
  }

  // ---- Shadow DOM overlay + toolbar -----------------------------------------
  function buildUI() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'inset: 0',
      'z-index: 2147483646',
      'pointer-events: none', // 事件穿透到頁面元素；toolbar 子層自行開 auto
    ].join('; ');
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .overlay {
          position: fixed;
          left: 0; top: 0;
          box-sizing: border-box;
          display: none;
          border: 2px solid #2b6cb0;
          background: rgba(43, 108, 176, 0.16);
          border-radius: 4px;
          pointer-events: none;
          z-index: 1;
          transition: none;
        }
        .toolbar {
          position: fixed;
          left: 50%;
          bottom: 24px;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 16px;
          background: #2d3748;
          color: #fff;
          border-radius: 10px;
          box-shadow: 0 6px 24px rgba(0, 0, 0, 0.32);
          font: 14px -apple-system, system-ui, "Noto Sans TC", sans-serif;
          pointer-events: auto;
          z-index: 2;
          user-select: none;
        }
        .hint { color: #cbd5e0; white-space: nowrap; }
        .toolbar button {
          font: inherit;
          font-weight: 500;
          padding: 6px 14px;
          border-radius: 6px;
          border: 1px solid transparent;
          cursor: pointer;
          line-height: 1;
        }
        .undo {
          background: transparent;
          color: #fff;
          border-color: #4a5568;
        }
        .undo:hover:not(:disabled) { background: #4a5568; }
        .undo:disabled { color: #718096; border-color: #3a4453; cursor: not-allowed; }
        .done {
          background: #2b6cb0;
          color: #fff;
        }
        .done:hover { background: #2c5282; }
      </style>
      <div class="overlay"></div>
      <div class="toolbar">
        <span class="hint">點擊要移除的雜訊段落</span>
        <button class="undo" type="button" disabled>復原</button>
        <button class="done" type="button">完成</button>
      </div>
    `;
    overlay = shadow.querySelector('.overlay');
    hint = shadow.querySelector('.hint');
    undoBtn = shadow.querySelector('.undo');
    doneBtn = shadow.querySelector('.done');
    undoBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); undo(); });
    doneBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); exit(); });
    (document.body || document.documentElement).appendChild(host);
  }

  function teardownUI() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = shadow = overlay = hint = undoBtn = doneBtn = null;
  }

  function positionOverlay(el) {
    if (!overlay) return;
    const r = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }

  function clearOverlay() {
    hoverTarget = null;
    if (overlay) overlay.style.display = 'none';
  }

  function updateToolbar() {
    if (!undoBtn || !hint) return;
    const n = editStack.length;
    undoBtn.disabled = n === 0;
    hint.textContent = n === 0 ? '點擊要移除的雜訊段落' : `已移除 ${n}　點擊繼續移除`;
  }

  // ---- 互動 -----------------------------------------------------------------
  // host 在 composedPath 內 = 事件落在 toolbar 上（host 是 shadow 邊界、外部
  // 看到的 retarget 目標就是 host）；此時不對頁面元素做標亮 / 隱藏。
  function pathHitsHost(e) {
    const path = e.composedPath ? e.composedPath() : [];
    return host && path.indexOf(host) !== -1;
  }

  function onMouseMove(e) {
    if (pathHitsHost(e)) { clearOverlay(); return; }
    const block = chooseBlock(e.target);
    if (!block) { clearOverlay(); return; }
    hoverTarget = block;
    positionOverlay(block);
  }

  function onMouseDown(e) {
    if (pathHitsHost(e)) return; // toolbar 互動放行
    // 阻止頁面對 mousedown 的反應（文字選取 / focus / 站點 handler）
    e.preventDefault();
    e.stopPropagation();
  }

  function onClick(e) {
    if (pathHitsHost(e)) return; // toolbar 按鈕自有 listener 處理
    e.preventDefault();
    e.stopPropagation();
    if (hoverTarget) hideTarget(hoverTarget);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' || e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      exit();
    }
  }

  function hideTarget(el) {
    if (!NS.cleaner || typeof NS.cleaner.hideElement !== 'function') return;
    const rec = NS.cleaner.hideElement(el, NS.state.hiddenEls);
    if (!rec) return;
    editStack.push(rec);
    clearOverlay();
    updateToolbar();
  }

  function undo() {
    const rec = editStack.pop();
    if (!rec || !rec.el) { updateToolbar(); return; }
    const el = rec.el;
    // 反向 hide：還原 inline display + priority，刪 data-jread-hidden。刪掉
    // jreadHidden 後 cleaner 的 restyle observer guard 會自動忽略此元素、不再
    // 補回 display:none（不需 unregister observer）。
    if (el.style) {
      el.style.removeProperty('display');
      if (rec.prevDisplay) el.style.setProperty('display', rec.prevDisplay, rec.prevDisplayPriority || '');
    }
    if (el.dataset) delete el.dataset.jreadHidden;
    // 從 NS.state.hiddenEls 移除該記錄——避免退出閱讀模式時 cleaner.restore 再
    // 對已還原元素跑一次（雖無害，保持清單與實際狀態一致）。
    const i = NS.state.hiddenEls.indexOf(rec);
    if (i >= 0) NS.state.hiddenEls.splice(i, 1);
    updateToolbar();
  }

  // ---- 對外介面 -------------------------------------------------------------
  // enter / exit 由 main.js 包在 suspend/restore reader interaction layer 之間
  // 呼叫。exit(silent=true) 用於 reader mode 自身 teardown（SPA 導航 / 退出閱讀
  // 模式）——只拆編輯 UI + listener，不觸發 onExit（reader teardown 自理還原）。
  function enter(art, opts) {
    if (active || !art) return false;
    active = true;
    articleEl = art;
    articleLen = textLen(art);
    onExitCb = (opts && opts.onExit) || null;
    editStack.length = 0;
    buildUI();
    updateToolbar();
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    return true;
  }

  function exit(silent) {
    if (!active) return;
    active = false;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    teardownUI();
    hoverTarget = null;
    editStack.length = 0; // 隱藏記錄續留 NS.state.hiddenEls（隨閱讀 session 還原）
    articleEl = null;
    articleLen = 0;
    const cb = onExitCb;
    onExitCb = null;
    if (silent !== true && cb) { try { cb(); } catch (_) { /* 還原失敗不阻斷 */ } }
  }

  NS.editMode = {
    enter,
    exit,
    isActive() { return active; },
    // 測試掛載點：jsdom regression 直接驗 block 邊界演算法與 hide/undo
    _chooseBlock: chooseBlock,
  };
})();
