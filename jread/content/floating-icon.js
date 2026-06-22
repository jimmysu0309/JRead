// JRead — 懸浮按鈕（floating action button，v0.8.154）
//
// 設計（參考 Shinkansen content-floating-icon.js）：
// - 頁面左／右緣常駐的浮動 icon，用工具列方形 icon（assets/icons/icon-32.png 經
//   chrome.runtime.getURL 載入；assets/* 已列入 manifest web_accessible_resources）。
//   尺寸由 floatingIconSize 設定切換（v0.8.156）：'small' = 視覺 16×16 / 可點
//   footprint 32×32（預設）、'large' = 視覺 32×32 / footprint 48×48（觸控嫌小者放大）。
//   尺寸走 CSS 變數（--fab-hit / --fab-icon）讓 storage.onChanged 即時生效。
// - 短按（放開前長按計時器未觸發、未拖移）= 切換閱讀模式，走
//   NS.dispatchLocalCommand('toggle-reader-mode')（與 3 指輕點 / 快速鍵同一條
//   content 端本地 dispatch，含 YouTube 模式重導、不 round-trip SW）。
// - 長按（壓住達 LONGPRESS_MS、未拖移）= 跳出選單：送到 Readwise Reader、切換
//   分頁模式。點任一列執行後收選單；點選單外 / 捲動 = 收選單。
// - 拖移（pointermove 超過 DRAG_THRESHOLD_PX）= 進入拖移模式，放開時吸附最近的
//   左／右緣，垂直位置存比例（floatingIconPos = { edge, offsetY }），視窗縮放後
//   按比例還原。預設貼**左緣**、垂直置中。
// - enable / 透明度 / 位置走 storage.sync，onChanged 即時生效（比照 toast.js）。
//   floatingIcon 啟用旗標未設過（非 boolean）時一律預設開（v0.8.158，原平台分流
//   取消，__JReadResolveFloatingIconEnabled，settings-defaults.js 單一資料源）。
// - 比照 toast 用獨立 Shadow DOM host，掛在 documentElement（**不掛 body**——body
//   children 會被 cleaner 動態 observer 當雜訊隱藏，injected UI 一律 append
//   documentElement，CLAUDE.md / memory feedback_reader_injected_ui_append_html）。
// - 只在 top frame 放一顆（window === window.top）；iframe / 非 HTML 文件
//   （XMLDocument，attachShadow 會 throw）一律早退。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;
  if (window !== window.top) return;     // 只在主 frame 放一顆
  if (NS.floating) return;               // 重複注入保險

  const LONGPRESS_MS = 500;              // 壓住達此毫秒 = 長按 → 開選單；之前放開 = 短按
  const DRAG_THRESHOLD_PX = 8;           // pointer 位移超過此距離 = 進入拖移（取消短按 / 長按）
  // 尺寸對照（v0.8.156）：透明 padding 維持每側 8px（icon + 16 = footprint）。
  // 視覺尺寸走 CSS 變數即時切換；hitSize（footprint）同步進 JS 給貼邊 / 拖移夾擠用。
  const SIZE_MAP = {
    small: { icon: 16, hit: 32 },        // 預設（v0.8.154 以來的原始尺寸）
    large: { icon: 32, hit: 48 }         // 觸控嫌小者放大
  };
  let hitSize = SIZE_MAP.small.hit;      // 目前 footprint（applyPos / 拖移用，applySize 更新）
  const EDGE_MARGIN = 6;                 // 吸附邊緣時與視窗邊的間距
  const DEFAULT_OPACITY = 0.7;
  // v0.8.158：長按開選單時把整顆 host（含選單）調到全不透明，避免使用者設的
  // 淡透明度（預設 0.7）讓選單文字看不清；收選單時還原使用者設定的透明度。
  let currentOpacity = DEFAULT_OPACITY;  // 使用者設定的透明度（選單收合時的還原值）
  const HOST_ID = '__jread-floating-host';

  // ─── Shadow DOM host（掛 documentElement，CSP-safe）─────────────────────
  let host, shadow, btn, menuEl;
  try {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483600; display: none; transition: opacity .15s ease;';
    shadow = host.attachShadow({ mode: 'open' }); // open：regression spec 可驗內部結構
  } catch (_e) {
    // 非 HTML 文件（XMLDocument 等）attachShadow / style 會 throw → 不放 icon
    return;
  }

  const iconUrl = (() => {
    try { return chrome.runtime.getURL('assets/icons/icon-32.png'); }
    catch (_e) { return ''; }
  })();

  const CSS = `
    :host, * { box-sizing: border-box; }
    :host { --fab-hit: ${SIZE_MAP.small.hit}px; --fab-icon: ${SIZE_MAP.small.icon}px; }
    .fab {
      position: relative;
      width: var(--fab-hit);
      height: var(--fab-hit);
      border: none;
      padding: 0;
      background: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      touch-action: none;          /* 自行處理拖移，禁瀏覽器捲動 / 手勢介入 */
      user-select: none;
      -webkit-user-select: none;
      -webkit-tap-highlight-color: transparent;
      transition: transform .15s ease;
    }
    .fab:active { transform: scale(.92); }
    .fab img {
      width: var(--fab-icon);
      height: var(--fab-icon);
      display: block;
      border-radius: 4px;
      /* drop-shadow 讓 icon 在淺色 / 同色頁面也看得見 */
      filter: drop-shadow(0 1px 3px rgba(0,0,0,.4));
      pointer-events: none;
      -webkit-user-drag: none;
      user-drag: none;
    }
    .fab.dragging img { filter: drop-shadow(0 4px 10px rgba(0,0,0,.45)); }
    .menu {
      position: absolute;
      bottom: 0;
      min-width: 180px;
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0,0,0,.22);
      padding: 6px;
      display: none;
      flex-direction: column;
      gap: 2px;
      font: 14px -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
    }
    .menu.show { display: flex; }
    .menu.side-left  { left: calc(var(--fab-hit) + 8px); }
    .menu.side-right { right: calc(var(--fab-hit) + 8px); }
    .menu-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      background: none;
      border: none;
      width: 100%;
      text-align: left;
      color: #1d1d1f;
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    .menu-item:hover { background: #f0f0f3; }
    .menu-item .ico {
      flex: 0 0 auto;
      width: 20px;
      text-align: center;
      font-size: 16px;
    }
    .menu-item .label { flex: 1; }
  `;

  shadow.innerHTML = `
    <button class="fab" id="fab" type="button" aria-label="JRead">
      ${iconUrl ? `<img src="${iconUrl}" alt="">` : ''}
    </button>
    <div class="menu" id="menu" role="menu"></div>
  `;
  // v0.8.159：改走 NS.injectShadowCss（CSP-safe）——嚴格 style-src nonce-only 站
  // （自架 Miniflux 閱讀頁）在 WebKit 會擋掉 shadow 內注入的 <style>，使 .fab 拿不到
  // var(--fab-hit) 寬高、icon 退回 <img> 原生 32px 無視尺寸設定。退回
  // shadow.adoptedStyleSheets。詳見 namespace.js injectShadowCss 註解。
  NS.injectShadowCss(shadow, CSS);
  btn = shadow.getElementById('fab');
  menuEl = shadow.getElementById('menu');
  document.documentElement.appendChild(host);

  // ─── 選單動作（長按彈出，spec 點 7）──────────────────────────────────────
  // 送到 Readwise：content script 受 CORS 擋無法直接 fetch Readwise API，轉給
  // background SW 走 sendToReadwiseFromCommand（與快速鍵送出同一條，必要時自動
  // 啟動閱讀模式、SW 端顯示結果 toast）。iOS SW 偶被回收時會失敗——與快速鍵
  // 送出同一先天限制（Jimmy 2026-06-21 確認可接受）。
  function sendToReadwise() {
    NS.safeSendMessage({ type: NS.MSG.CUSTOM_COMMAND, payload: { command: 'send-to-readwise' } });
  }

  // 切換分頁模式：翻轉 storage.sync.pagedMode；閱讀模式啟動時 content 端
  // onChanged → reapply 即時生效，未啟動時下次進閱讀模式生效（與 popup 切換
  // 同一份事實）。本地動作、不依賴 SW。
  function togglePaged() {
    try {
      chrome.storage.sync.get({ pagedMode: false }, (s) => {
        if (chrome.runtime && chrome.runtime.lastError) return;
        const next = !(s && s.pagedMode);
        chrome.storage.sync.set({ pagedMode: next }, () => {
          if (NS.toast) NS.toast.show('分頁模式：' + (next ? '開' : '關'), { kind: 'info' });
        });
      });
    } catch (_e) {}
  }

  const MENU_ITEMS = [
    { id: 'readwise', icon: '↗', label: '送到 Readwise Reader', action: sendToReadwise },
    { id: 'paged', icon: '⇄', label: '切換分頁模式', action: togglePaged }
  ];

  // ─── 設定狀態 ───────────────────────────────────────────────────────────
  let pos = { edge: 'left', offsetY: 0.5 };   // 預設左緣置中（spec 點 4）

  function applyEnabled(enabled) {
    host.style.display = enabled ? 'block' : 'none';
    if (!enabled) closeMenu();
  }

  function applyOpacity(v) {
    const o = typeof v === 'number' ? v : DEFAULT_OPACITY;
    currentOpacity = Math.max(0.1, Math.min(1, o));
    // 選單開著時 host 維持全不透明（見 openMenu）；新設定值記在 currentOpacity，
    // 等 closeMenu 還原。沒開選單時直接套用。
    if (!menuOpen) host.style.opacity = String(currentOpacity);
  }

  // 尺寸切換：寫 CSS 變數（視覺即時生效）+ 同步 hitSize（貼邊 / 拖移夾擠用），
  // 再依新 footprint 重貼一次（offsetY 比例對 vh−hit 重算）。非 'large' 一律 small。
  function applySize(v) {
    const s = SIZE_MAP[v === 'large' ? 'large' : 'small'];
    hitSize = s.hit;
    host.style.setProperty('--fab-hit', s.hit + 'px');
    host.style.setProperty('--fab-icon', s.icon + 'px');
    applyPos(pos);
  }

  function sanitizePos(p) {
    const edge = (p && (p.edge === 'left' || p.edge === 'right')) ? p.edge : 'left';
    let offsetY = p && typeof p.offsetY === 'number' ? p.offsetY : 0.5;
    if (!(offsetY >= 0 && offsetY <= 1)) offsetY = 0.5;
    return { edge, offsetY };
  }

  // 依 pos 把 host 貼到邊緣（offsetY 比例 → top px）
  function applyPos(p) {
    pos = sanitizePos(p);
    const vh = window.innerHeight || 0;
    const top = Math.round(pos.offsetY * Math.max(0, vh - hitSize));
    host.style.top = top + 'px';
    host.style.bottom = 'auto';
    if (pos.edge === 'left') {
      host.style.left = EDGE_MARGIN + 'px';
      host.style.right = 'auto';
    } else {
      host.style.right = EDGE_MARGIN + 'px';
      host.style.left = 'auto';
    }
    menuEl.classList.toggle('side-left', pos.edge === 'left');
    menuEl.classList.toggle('side-right', pos.edge === 'right');
  }

  function persistPos() {
    try { chrome.storage.sync.set({ floatingIconPos: pos }); } catch (_e) {}
  }

  // ─── 長按選單 ───────────────────────────────────────────────────────────
  let menuOpen = false;
  let outsideHandler = null;

  function buildMenu() {
    menuEl.textContent = '';
    for (const it of MENU_ITEMS) {
      const item = document.createElement('button');
      item.className = 'menu-item';
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.dataset.action = it.id;
      const ico = document.createElement('span');
      ico.className = 'ico';
      ico.textContent = it.icon;
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = it.label;
      item.appendChild(ico);
      item.appendChild(label);
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        try { it.action(); } catch (_err) {}
      });
      menuEl.appendChild(item);
    }
  }

  function openMenu() {
    if (host.style.display === 'none') return;
    buildMenu();
    menuEl.classList.add('show');
    menuOpen = true;
    // 選單開著時整顆 host 全不透明，讓選單文字清楚可讀（不受使用者淡透明度影響）
    host.style.opacity = '1';
    outsideHandler = (ev) => {
      const path = ev.composedPath ? ev.composedPath() : [];
      if (path.includes(host)) return;
      closeMenu();
    };
    document.addEventListener('pointerdown', outsideHandler, true);
    window.addEventListener('scroll', closeMenu, { passive: true, capture: true });
  }

  function closeMenu() {
    if (!menuOpen) return;
    menuEl.classList.remove('show');
    menuOpen = false;
    // 還原使用者設定的透明度（選單期間被調成全不透明）
    host.style.opacity = String(currentOpacity);
    if (outsideHandler) {
      document.removeEventListener('pointerdown', outsideHandler, true);
      outsideHandler = null;
    }
    window.removeEventListener('scroll', closeMenu, true);
  }

  // ─── 短按：切換閱讀模式 ──────────────────────────────────────────────────
  function handleShortPress() {
    if (typeof NS.dispatchLocalCommand === 'function') {
      NS.dispatchLocalCommand('toggle-reader-mode');
      return;
    }
    // dispatchLocalCommand 缺席（SPA 注入競態）→ fallback 走 SW 路徑
    NS.safeSendMessage({ type: NS.MSG.CUSTOM_COMMAND, payload: { command: 'toggle-reader-mode' } });
  }

  // ─── pointer 狀態機（短按 / 拖移吸附 / 長按）─────────────────────────────
  let press = null;  // { id, startX, startY, timer, moved, longFired }

  function clearPressTimer() {
    if (press && press.timer) { clearTimeout(press.timer); press.timer = null; }
  }

  btn.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;  // 只認主鍵
    e.preventDefault();
    closeMenu();
    try { btn.setPointerCapture(e.pointerId); } catch (_e) {}
    press = { id: e.pointerId, startX: e.clientX, startY: e.clientY, timer: null, moved: false, longFired: false };
    press.timer = setTimeout(() => {
      if (!press || press.moved) return;
      press.longFired = true;
      press.timer = null;
      openMenu();
    }, LONGPRESS_MS);
  });

  btn.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.startX;
    const dy = e.clientY - press.startY;
    if (!press.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      press.moved = true;
      clearPressTimer();
      closeMenu();
      btn.classList.add('dragging');
    }
    if (press.moved) {
      // 自由跟手（拖移期間），放開再吸附
      const half = hitSize / 2;
      const left = Math.max(0, Math.min(window.innerWidth - hitSize, e.clientX - half));
      const top = Math.max(0, Math.min(window.innerHeight - hitSize, e.clientY - half));
      host.style.left = left + 'px';
      host.style.right = 'auto';
      host.style.top = top + 'px';
      host.style.bottom = 'auto';
    }
  });

  function endPress(e) {
    if (!press || e.pointerId !== press.id) return;
    clearPressTimer();
    try { btn.releasePointerCapture(e.pointerId); } catch (_e) {}
    const { moved, longFired } = press;
    press = null;
    btn.classList.remove('dragging');
    if (moved) {
      // 吸附最近邊緣：pointer 在視窗左半 → 左緣，右半 → 右緣
      const edge = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
      const offsetY = Math.max(0, Math.min(1,
        (e.clientY - hitSize / 2) / Math.max(1, window.innerHeight - hitSize)));
      applyPos({ edge, offsetY });
      persistPos();
      return;
    }
    if (longFired) return;        // 長按已開選單，放開不再短按
    handleShortPress();
  }

  btn.addEventListener('pointerup', endPress);
  btn.addEventListener('pointercancel', (e) => {
    if (!press || e.pointerId !== press.id) return;
    clearPressTimer();
    press = null;
    btn.classList.remove('dragging');
  });

  // 視窗縮放：按既有比例重新貼邊（拖移中不干擾）
  window.addEventListener('resize', () => {
    if (press && press.moved) return;
    applyPos(pos);
  }, { passive: true });

  // ─── 初始化：讀 storage + onChanged 即時生效 ─────────────────────────────
  const RESOLVE = window.__JReadResolveFloatingIconEnabled || ((v) => v === true);

  try {
    chrome.storage.sync.get(['floatingIcon', 'floatingIconOpacity', 'floatingIconPos', 'floatingIconSize'], (s) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        applySize(undefined); applyOpacity(undefined); applyPos(undefined); applyEnabled(RESOLVE(undefined));
        return;
      }
      applySize(s.floatingIconSize);
      applyOpacity(s.floatingIconOpacity);
      applyPos(s.floatingIconPos);
      applyEnabled(RESOLVE(s.floatingIcon));
    });
  } catch (_e) {
    applySize(undefined); applyOpacity(undefined); applyPos(undefined); applyEnabled(RESOLVE(undefined));
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.floatingIcon) applyEnabled(RESOLVE(changes.floatingIcon.newValue));
    if (changes.floatingIconOpacity) applyOpacity(changes.floatingIconOpacity.newValue);
    if (changes.floatingIconPos) applyPos(changes.floatingIconPos.newValue);
    if (changes.floatingIconSize) applySize(changes.floatingIconSize.newValue);
  });

  // regression spec（isolated world）用：暴露內部 handler 與狀態
  NS.floating = {
    host, btn, menuEl, MENU_ITEMS,
    openMenu, closeMenu, buildMenu,
    handleShortPress, sendToReadwise, togglePaged,
    applyEnabled, applyOpacity, applyPos, applySize, sanitizePos,
    isMenuOpen: () => menuOpen,
    getPos: () => ({ ...pos }),
    getHitSize: () => hitSize
  };
})();
