// JRead — 快速鍵說明（v3.1.0）
//
// Article Feed（reader.html）與 Article View（article.html）按 ?（Shift+/）跳出這一頁能用的快速鍵，
// 再按一次 ? 或 Esc、點外面關掉（Jimmy 2026-11-24「加入按 Shift+? 顯示快速鍵說明」）。
//
// 快速鍵清單只寫在這裡（SHORTCUTS），每項帶「什麼時候能用」的條件，只列這一頁、這個服務真的有的：
// Readwise 看不到 / 與 I（JReader 書庫工具）、封存區打開的文章不列 E、公開分享頁只列閱讀鍵。
// 按鍵本身由各模組處理（space-scroll / paged-mode / reader-highlights / position-memory / reader-info /
// reader-library / main.js），這裡只負責說明——之後加快速鍵記得來這裡登記一筆。
//
// 浮層用 shadow DOM 掛 <html> 直下（閱讀模式會把 body 底下非主文元素藏起來，同重點浮動鈕與文章資訊）。
// 顏色讀頁面目前的背景 / 文字色。
//
// dual export：module.exports 給 jsdom spec、window.__JReadReaderShortcuts 給頁面。
(function (global) {
  'use strict';

  const HOST_ID = '__jread-shortcuts-host';
  // jsdom spec（module 環境）用；頁面上走 global.__JReadReaderCache
  const RC_MOD = typeof module !== 'undefined' && module.exports && typeof require === 'function' ? require('./reader-cache.js') : null;

  // page：'feed' | 'article'。when(ctx)：ctx＝{ page, library, highlights, archivable, readOnly, canExit }
  const SHORTCUTS = [
    { page: 'feed', keys: ['/'], label: '搜尋文章', when: (c) => c.library },
    { page: 'feed', keys: ['Esc'], label: '離開搜尋結果、收起工具列', when: (c) => c.library },
    { page: 'feed', keys: ['J', 'K'], label: '下一篇、上一篇' },
    { page: 'feed', keys: ['Enter'], label: '打開選到的文章' },
    { page: 'feed', keys: ['E'], label: '封存選到的文章' },
    { page: 'feed', keys: ['L'], label: '加入 Later（Instapaper：加星）' },
    { page: 'feed', keys: ['V'], label: '在新分頁開啟原始網址' },
    { page: 'feed', keys: ['X'], label: '多選：勾選 / 取消選到的文章（Shift+點卡片也可以）', when: (c) => c.library },
    { page: 'article', keys: ['Space'], label: '往下一個畫面（翻頁模式：下一頁）' },
    { page: 'article', keys: ['Shift', 'Space'], label: '往上一個畫面（翻頁模式：上一頁）' },
    { page: 'article', keys: ['←', '→'], label: '翻頁模式：上一頁、下一頁' },
    { page: 'article', keys: ['Home', 'End'], label: '翻頁模式：第一頁、最後一頁' },
    { page: 'article', keys: ['H'], label: '把選取的文字畫成重點', when: (c) => c.highlights && !c.readOnly },
    { page: 'article', keys: ['E'], label: '封存這篇', when: (c) => c.archivable && !c.readOnly },
    { page: 'article', keys: ['V'], label: '在新分頁開啟原始網址' },
    { page: 'article', keys: ['I'], label: '文章資訊（來源、標籤、資料夾）', when: (c) => c.library && !c.readOnly },
    { page: 'article', keys: ['L'], label: '編輯標籤', when: (c) => c.library && !c.readOnly },
    { page: 'article', keys: ['Esc'], label: '回到文章列表', when: (c) => c.canExit },
    { page: null, keys: ['?'], label: '顯示 / 關閉這份說明' }
  ];

  function itemsFor(ctx) {
    const c = ctx || {};
    return SHORTCUTS.filter((s) => (s.page === null || s.page === c.page) && (typeof s.when !== 'function' || s.when(c)));
  }

  // ? 鍵：Shift+/ 在多數鍵盤是 '?'；有些配置 e.key 仍是 '/'，用 code 補判
  function isHelpKey(e) {
    if (!e || e.isComposing || e.keyCode === 229) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    return e.key === '?' || (e.shiftKey && e.code === 'Slash');
  }

  // 「焦點在可打字的元素裡」：單一資料源 NS.isTextInputTarget（看穿開放式 shadow root——文章資訊面板的
  // 輸入框在 shadow DOM 裡，e.target 只看得到 host；原本這裡另外看事件路徑的第一個元素）
  function isTypingTarget(t, win) {
    const N = (win && win.__JRead) || global.__JRead;
    return !!(N && typeof N.isTextInputTarget === 'function' && N.isTextInputTarget(t));
  }

  const CSS = `
    :host { all: initial; }
    .backdrop { position: fixed; inset: 0; z-index: 2147483640; background: rgba(0,0,0,.28);
      display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { box-sizing: border-box; width: min(440px, 100%); max-height: 80vh; overflow-y: auto;
      background: var(--bg); color: var(--fg); border-radius: 14px; padding: 18px 20px 14px;
      box-shadow: 0 12px 36px rgba(0,0,0,.24);
      font: 14px/1.5 system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif; -webkit-font-smoothing: antialiased; }
    h2 { margin: 0 0 12px; font-size: 16px; font-weight: 700; }
    .row { display: flex; align-items: baseline; gap: 14px; padding: 7px 0; border-top: 1px solid var(--line); }
    .row:first-of-type { border-top: 0; }
    .keys { flex: 0 0 128px; display: flex; flex-wrap: wrap; gap: 4px; }
    kbd { display: inline-block; min-width: 22px; padding: 1px 7px; box-sizing: border-box; text-align: center;
      border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 6px;
      font: 600 12px/18px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--fg); }
    .label { flex: 1 1 auto; }
    .foot { margin-top: 10px; font-size: 12px; color: var(--muted); }
  `;


  // opts：{ doc, win, getContext() → ctx }。回 { open, close, toggle, isOpen }
  function attach(opts) {
    const o = opts || {};
    const doc = o.doc;
    const win = o.win;
    if (!doc || !win || typeof o.getContext !== 'function') return null;
    let host = null;
    let shadow = null;
    let opened = false;

    function close() {
      if (!opened) return;
      opened = false;
      if (host) host.style.display = 'none';
    }
    function open() {
      const ctx = o.getContext() || {};
      if (!host || !host.isConnected) {
        host = doc.createElement('div');
        host.id = HOST_ID;
        host.style.cssText = 'all: initial; display: none;';
        shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
        doc.documentElement.appendChild(host);
      }
      // 主題色正本 RC.pageThemeColors（文章資訊面板、確認框同一份；原本這裡自帶一份、少了 --link，
      // 2026-11-24 審核收斂）。reader-cache 在 article.html 比這支晚載入：用到時才讀
      const R = global.__JReadReaderCache || RC_MOD;
      const c = R && typeof R.pageThemeColors === 'function' ? R.pageThemeColors(win, doc)
        : { bg: '#ffffff', fg: '#1a1a1a', muted: 'rgba(26,26,26,0.62)', line: 'rgba(26,26,26,0.14)', link: '#1a73e8' };
      for (const k of ['bg', 'fg', 'muted', 'line', 'link']) host.style.setProperty('--' + k, c[k]);
      shadow.textContent = '';
      const style = doc.createElement('style');
      style.textContent = CSS;
      shadow.appendChild(style);
      const backdrop = doc.createElement('div');
      backdrop.className = 'backdrop';
      backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) { e.preventDefault(); close(); } });
      const card = doc.createElement('div');
      card.className = 'card';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', '快速鍵');
      const h = doc.createElement('h2');
      h.textContent = '快速鍵';
      card.appendChild(h);
      for (const s of itemsFor(ctx)) {
        const row = doc.createElement('div');
        row.className = 'row';
        const keys = doc.createElement('span');
        keys.className = 'keys';
        for (const k of s.keys) {
          const kbd = doc.createElement('kbd');
          kbd.textContent = k;
          keys.appendChild(kbd);
        }
        const label = doc.createElement('span');
        label.className = 'label';
        label.textContent = s.label;
        row.appendChild(keys);
        row.appendChild(label);
        card.appendChild(row);
      }
      const foot = doc.createElement('div');
      foot.className = 'foot';
      foot.textContent = '在輸入框裡打字時，這些按鍵不會觸發';
      card.appendChild(foot);
      backdrop.appendChild(card);
      shadow.appendChild(backdrop);
      host.style.display = 'block';
      opened = true;
    }
    function toggle() { if (opened) close(); else open(); }

    // window capture、載入時就註冊（比 Article View 的按鍵守門 main.js keyguard 早）
    win.addEventListener('keydown', (e) => {
      if (opened && e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation(); // Esc 只關說明，不要再退出閱讀模式 / 清空搜尋
        close();
        return;
      }
      if (!isHelpKey(e) || isTypingTarget(e.target, win)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      toggle();
    }, true);

    return { open, close, toggle, isOpen: () => opened };
  }

  // 頁面判定：Article View 有 #jr-status（模板內建），Feed 有 #jr-tabs
  function pageOf(doc) {
    if (doc.getElementById('jr-tabs')) return 'feed';
    if (doc.getElementById('jr-status') || doc.querySelector('[data-jread-reader-body]')) return 'article';
    return null;
  }

  // 頁面 bootstrap：讀設定判斷服務，條件在打開說明的當下才算（翻頁模式、文章是否已渲染等會變）
  function init() {
    const doc = global.document;
    const PC = global.__JReadPopup;
    const RC = global.__JReadReaderCache;
    const browser = global.browser;
    if (!doc || !PC) return;
    let service = 'readwise';
    try {
      Promise.resolve(browser.storage.sync.get(PC.serviceSettingsQuery({}))).then((s) => {
        const r = PC.resolveServiceCredentials(s || {});
        if (r && r.service) service = r.service;
      }).catch(() => {});
    } catch (_) { /* 讀不到就當 Readwise（只會少列 JReader 專屬鍵） */ }
    const host = global.__jreadHost;
    attach({
      doc, win: global,
      getContext: () => {
        const page = pageOf(doc);
        const readOnly = !!(host && host.readOnly);
        let tab = null;
        try { tab = new URLSearchParams(global.location.search).get('tab'); } catch (_) { tab = null; }
        const NS = global.__JRead;
        return {
          page,
          readOnly,
          library: typeof PC.supportsLibraryTools === 'function' && PC.supportsLibraryTools(service),
          highlights: typeof PC.supportsHighlights === 'function' && PC.supportsHighlights(service),
          archivable: !RC || typeof RC.isTabArchivable !== 'function' || RC.isTabArchivable(service, tab),
          canExit: !(NS && NS.state && NS.state.readerNoExit)
        };
      }
    });
  }

  const api = { attach, itemsFor, isHelpKey, pageOf, SHORTCUTS, HOST_ID };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.__JReadReaderShortcuts = api;
    if (global.document) {
      if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', init);
      else init();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
