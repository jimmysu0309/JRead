// JRead — 編輯模式（手動移除雜訊段落）
// v0.8.108：閱讀模式啟動時，使用者可進編輯模式手動點掉 cleaner 漏網的雜訊
// 區塊。
// v0.8.109：段落提示改仿 Shinkansen 編輯模式——進入時枚舉所有可選 block、注入
// CSS 給每塊持久虛線外框，hover 那塊外框加深 + 淡底色（純 CSS，不再需要 shadow
// overlay + mousemove 追蹤）。頁內 toolbar（復原 / 完成）仍走 Shadow DOM。
//
// 設計重點：
//   - block 邊界用「演算法 C」選取（inline-level 正規化到所屬 block → tight-
//     wrapper climb → dominant-wrapper guard），real-site probe 驗證：點段落內
//     連結→整段、點段落→該段、點圖→figure wrapper，且絕不誤選把全文包住的
//     dominant wrapper（probe 抓到演算法 A「爬到 articleEl 直接子」的 over-
//     select 陷阱）。
//   - 段落提示（v0.8.109）：markBlocks 以同一個 chooseBlock 枚舉「使用者可點掉
//     的 block 集合」（單一資料源——提示範圍 = 實際可選範圍），各設
//     data-jread-edit-block，注入單一 stylesheet 畫虛線外框 + hover 強化。
//   - 隱藏複用 NS.cleaner.hideElement(el, NS.state.hiddenEls)：同一條 inline
//     `display:none !important` + restyle observer 機制；記錄塞進 hiddenEls →
//     退出閱讀模式時既有 cleaner.restore 一併還原（單一資料源，本模組不自寫
//     還原路徑）。送 Readwise 的 buildCleanHtml 也已剔除 [data-jread-hidden]，
//     手動移除的段落自動不進 Readwise。
//   - undo：toolbar「復原」+ Cmd/Ctrl+Z 都走 LIFO undo——還原最後一次移除。
//   - keyguard / ESC / space-scroll / paged-mode 的暫停與還原由 main.js 主導
//     （那些 interaction layer 的生命週期本就住在 main.js）；本模組只負責編輯
//     互動本身，退出時透過 onExit callback 通知 main.js 還原。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;
  if (NS.editMode) return; // 重複注入保險

  const HOST_ID = '__jread-editmode-host';
  const STYLE_ID = '__jread-editmode-style';
  const BLOCK_ATTR = 'data-jread-edit-block';

  let active = false;
  let articleEl = null;
  let articleLen = 0;       // 進入時主文字數，dominant-wrapper guard 用
  let onExitCb = null;
  let host = null, shadow = null, hint = null, undoBtn = null, doneBtn = null;
  const editStack = [];     // 本 session 移除的還原記錄（undo 用）

  // ---- block 邊界選取（演算法 C，real-site probe 驗證）-----------------------
  const INLINE_DISPLAYS = new Set(['inline', 'inline-block', 'inline-flex', 'contents']);
  // tight-climb 判定「parent 的其他子元素可忽略」的文字門檻——< 此值視為空殼 /
  // 圖示 / 短分隔，不算「相異的實質行」（v0.8.111）。
  const MIN_SIBLING_TEXT = 8;

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
      // tight = parent 只是 cand 的純包裝：單一子，或「parent 的其他子元素全是
      // 可忽略的」（文字 < MIN_SIBLING_TEXT）——即 cand 承載了 parent 幾乎全部
      // 內容、其餘子是空殼 / void / 圖示。**不可用字數比例邊界**（cLen×1.3 或
      // cLen+30 floor）：對「相異的短行」太脆弱——restofworld 日期行 38 字、同層
      // 『翻譯成中文』連結 12 字，meta=50 與 38×1.3=49.4 只差 0.6 字就決定要不要
      // 把日期併進整個 header（Jimmy 2026-06-18 回報點日期連刪多行）。改判「有沒有
      // 另一個實質子」直接捕捉「parent 是不是純包裝」、不靠邊界：日期的 meta 有個
      // ≥8 字的翻譯連結兄弟 → 不 climb，停在日期行（與確切字數無關）。figure 仍
      // 合併（img 是 0 字 void 子、figcaption 跟 img 同 parent 時其他子皆 tiny）。
      let otherChildrenAllTiny = true;
      for (const ch of p.children) {
        if (ch !== c && textLen(ch) >= MIN_SIBLING_TEXT) { otherChildrenAllTiny = false; break; }
      }
      const tight = p.children.length <= 1 || otherChildrenAllTiny;
      if (!tight) break;
      c = p;
    }
    // 3) dominant-wrapper guard：使用者直接 hover 到「大型多子容器自身的留白」
    //    時 node 就是該 wrapper，上面兩步都不動它 → 會選到整篇。拒絕「字數 ≥
    //    主文 60% 且子元素 ≥ 3」的塊（單一大段落子元素少、不會誤判）。
    if (articleLen > 0 && c.children.length >= 3 && textLen(c) >= articleLen * 0.6) return null;
    return c;
  }

  // ---- 段落提示：枚舉可選 block + 注入外框 CSS（v0.8.109，仿 Shinkansen）-------
  const MEDIA_TAGS = new Set(['IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'IFRAME', 'SVG', 'CANVAS', 'EMBED', 'OBJECT']);

  // 以 chooseBlock 把主文切成「使用者可點掉的 block 集合」——提示範圍 = 實際可
  // 選範圍（單一資料源）。content leaf（直接含文字的元素 + 媒體）各自 resolve
  // 到所屬 block，去重後即自然分割。
  function collectBlocks() {
    const set = new Set();
    if (!articleEl) return [];
    let all;
    try { all = articleEl.querySelectorAll('*'); } catch (_) { return []; }
    for (const el of all) {
      if (el.closest && el.closest('[data-jread-hidden="1"]')) continue;
      const isMedia = MEDIA_TAGS.has(el.tagName);
      let hasDirectText = false;
      if (!isMedia) {
        for (const n of el.childNodes) {
          if (n.nodeType === 3 && n.textContent && n.textContent.trim()) { hasDirectText = true; break; }
        }
      }
      if (!hasDirectText && !isMedia) continue;
      const block = chooseBlock(el);
      if (block) set.add(block);
    }
    let arr = Array.from(set);
    // 去巢狀（保留更精確的內層）：理論上各 leaf resolve 到同一 block、不會巢狀，
    // 但媒體 + 文字混排的邊角可能讓外層也入列——移除「包含集合內另一 block」的
    // 外層。O(n²) 對一般文章（< 400 塊）可忽略；超大文件跳過（提示稍粗無妨）。
    if (arr.length > 1 && arr.length <= 400) {
      arr = arr.filter(b => !arr.some(other => other !== b && b.contains(other)));
    }
    return arr;
  }

  function ensureBlockStyle() {
    if (document.getElementById(STYLE_ID)) return;
    // 持久虛線外框標出每個可選 block（仿 Shinkansen `.shinkansen-editable`）；
    // hover 那塊外框加深 + 淡底色 + cursor:pointer 提示可點移除。!important 勝過
    // 站點 / reader card 樣式。v0.8.130：走 NS.injectCssText（CSP-safe，見 namespace.js）。
    NS.injectCssText(STYLE_ID, [
      `[${BLOCK_ATTR}]{`,
      'outline:1.5px dashed rgba(43,108,176,.45)!important;',
      'outline-offset:2px;border-radius:3px;cursor:pointer!important;',
      'transition:outline-color .1s ease,background-color .1s ease;}',
      `[${BLOCK_ATTR}]:hover{`,
      'outline:2px solid rgba(43,108,176,.9)!important;',
      'background-color:rgba(43,108,176,.1)!important;}',
    ].join(''));
  }

  function markBlocks() {
    try {
      ensureBlockStyle();
      for (const b of collectBlocks()) {
        if (b && b.setAttribute) b.setAttribute(BLOCK_ATTR, '1');
      }
    } catch (_) { /* 提示失敗不阻斷編輯互動本身 */ }
  }

  function unmarkBlocks() {
    try {
      document.querySelectorAll('[' + BLOCK_ATTR + ']').forEach(el => el.removeAttribute(BLOCK_ATTR));
      NS.removeCssText(STYLE_ID);
    } catch (_) { /* noop */ }
  }

  // ---- Shadow DOM toolbar（復原 / 完成）-------------------------------------
  function buildToolbar() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'left: 0', 'right: 0', 'bottom: 0',
      'z-index: 2147483646',
      'pointer-events: none', // 事件穿透到頁面元素；toolbar 子層自行開 auto
    ].join('; ');
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
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
        .undo { background: transparent; color: #fff; border-color: #4a5568; }
        .undo:hover:not(:disabled) { background: #4a5568; }
        .undo:disabled { color: #718096; border-color: #3a4453; cursor: not-allowed; }
        .done { background: #2b6cb0; color: #fff; }
        .done:hover { background: #2c5282; }
      </style>
      <div class="toolbar">
        <span class="hint">點擊有虛線框的雜訊段落即可移除</span>
        <button class="undo" type="button" disabled>復原</button>
        <button class="done" type="button">完成</button>
      </div>
    `;
    hint = shadow.querySelector('.hint');
    undoBtn = shadow.querySelector('.undo');
    doneBtn = shadow.querySelector('.done');
    undoBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); undo(); });
    doneBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); exit(); });
    // 掛 documentElement（<html>）而非 body——閱讀模式中 cleaner 的 dynamic-
    // append observer 監看 body + article 子樹、會把 body 下新 append 的元素當
    // 動態雜訊 hide（display:none !important），toolbar 掛 body 會被整個藏掉、
    // 看不見（與 space-scroll 焦點條 / paged 頁碼指示同款，皆掛 <html> 規避）。
    document.documentElement.appendChild(host);
  }

  function teardownUI() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = shadow = hint = undoBtn = doneBtn = null;
  }

  function updateToolbar() {
    if (!undoBtn || !hint) return;
    const n = editStack.length;
    undoBtn.disabled = n === 0;
    hint.textContent = n === 0
      ? '點擊有虛線框的雜訊段落即可移除'
      : `已移除 ${n}　誤刪可按「復原」或 Cmd/Ctrl+Z`;
  }

  // ---- 互動 -----------------------------------------------------------------
  // host 在 composedPath 內 = 事件落在 toolbar 上（host 是 shadow 邊界、外部
  // 看到的 retarget 目標就是 host）；此時不對頁面元素做隱藏。
  function pathHitsHost(e) {
    const path = e.composedPath ? e.composedPath() : [];
    return host && path.indexOf(host) !== -1;
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
    // 點擊當下即時 resolve block（演算法 C），與虛線外框/hover 標亮同一資料源
    const block = chooseBlock(e.target);
    if (block) hideTarget(block);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' || e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      exit();
      return;
    }
    // Cmd/Ctrl+Z = 復原最後一次移除（誤刪救回；Shift+Z 不接管，留給瀏覽器 redo）
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey &&
        (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ')) {
      e.preventDefault();
      e.stopPropagation();
      undo();
    }
  }

  function hideTarget(el) {
    if (!NS.cleaner || typeof NS.cleaner.hideElement !== 'function') return;
    const rec = NS.cleaner.hideElement(el, NS.state.hiddenEls);
    if (!rec) return;
    editStack.push(rec);
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
  // 模式）——只拆編輯 UI + 提示 + listener，不觸發 onExit（reader teardown 自理
  // 還原）。
  function enter(art, opts) {
    if (active || !art) return false;
    active = true;
    articleEl = art;
    articleLen = textLen(art);
    onExitCb = (opts && opts.onExit) || null;
    editStack.length = 0;
    markBlocks();
    buildToolbar();
    updateToolbar();
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    return true;
  }

  function exit(silent) {
    if (!active) return;
    active = false;
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    unmarkBlocks();
    teardownUI();
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
    // 測試掛載點：jsdom regression 直接驗 block 邊界演算法與 block 枚舉
    _chooseBlock: chooseBlock,
    _collectBlocks: collectBlocks,
  };
})();
