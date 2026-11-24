// JRead — JReader 書庫工具列（v3.1.0）
//
// Article Feed（reader.html）頂端的一列工具：搜尋框、「＋」貼網址存文章、標籤篩選。
// 只有儲存服務是 JReader 時出現（PC.supportsLibraryTools 單一判準）；擴充與網頁版
// （web core）共用這一份。API 規格在 JReader repo docs/prompt-for-jread-search-and-info.md。
//
// 與 reader-feed.js 的分工：清單的載入 / 快取 / 卡片動作仍住 reader-feed；本檔只管
// 工具列本身，透過 attach(env) 拿到 feed 的掛鉤（換分頁、重新載入、設標籤篩選、
// 讓進行中的清單載入作廢），不另寫一份清單邏輯。卡片一律用 reader-feed 的 createCard。
//
// dual export：module.exports 給 jsdom spec、window.__JReadReaderLibrary 給頁面。
(function (global) {
  'use strict';

  const SEARCH_DEBOUNCE_MS = 250;
  const SEARCH_PAGE = 20;
  const POLL_MS = 3000;
  const POLL_LIMIT_MS = 60000;
  const LAST_SEARCH_KEY = 'jread:lastSearch';
  // 搜尋結果卡片連到文章頁時帶的 tab：退出文章頁回 reader.html?tab=search，工具列
  // 依此把上次的查詢叫回來（pickInitialTab 不認得 search，分頁本身退回第一個）
  const SEARCH_TAB = 'search';

  const LOCATION_LABEL = { new: 'Inbox', later: 'Later', shortlist: 'Later', archive: 'Archive' };
  function locationLabel(loc) {
    return LOCATION_LABEL[loc] || '';
  }

  function hasSearchable(q) {
    return typeof q === 'string' && /[\p{L}\p{N}]/u.test(q);
  }

  // 摘錄文字 → DOM 片段，查詢詞（空白分開的每個詞，不分大小寫）加粗。只產生文字
  // 節點與 <b>，不經 innerHTML（摘錄來自文章內文，不能當 HTML）
  function highlightTerms(text, q, document) {
    const frag = document.createDocumentFragment();
    const src = String(text || '');
    const terms = String(q || '').split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t))
      .map((t) => t.toLowerCase()).sort((a, b) => b.length - a.length);
    if (!terms.length) { frag.appendChild(document.createTextNode(src)); return frag; }
    const lower = src.toLowerCase();
    let i = 0;
    let plainFrom = 0;
    while (i < src.length) {
      const hit = terms.find((t) => lower.startsWith(t, i));
      if (!hit) { i++; continue; }
      if (i > plainFrom) frag.appendChild(document.createTextNode(src.slice(plainFrom, i)));
      const b = document.createElement('b');
      b.textContent = src.slice(i, i + hit.length);
      frag.appendChild(b);
      i += hit.length;
      plainFrom = i;
    }
    if (plainFrom < src.length) frag.appendChild(document.createTextNode(src.slice(plainFrom)));
    return frag;
  }

  // 搜尋結果卡片：reader-feed 的卡片＋副標尾端的資料夾＋摘錄。沒有滑動 / 右鍵動作
  //（結果橫跨各資料夾，動作語意不一，打開文章再處理）
  function createResultCard(doc, document, createCard, q) {
    const card = createCard(doc, document, { archivable: false, tabId: SEARCH_TAB });
    if (!card) return null;
    const meta = card.querySelector('.jr-card-meta');
    const loc = locationLabel(doc.location);
    if (meta && loc) meta.textContent = meta.textContent ? meta.textContent + '　·　' + loc : loc;
    if (doc.snippet) {
      const sn = document.createElement('div');
      sn.className = 'jr-card-snippet';
      sn.appendChild(highlightTerms(doc.snippet, q, document));
      const body = card.querySelector('.jr-card-body');
      if (body) body.appendChild(sn);
    }
    return card;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return String(url || ''); }
  }

  // 貼網址後的暫時卡片（抓取中）。不是 reader-feed 的卡片：沒有文章可開、沒有動作
  function createPendingCard(url, document) {
    const card = document.createElement('article');
    card.className = 'jr-card jr-pending is-busy';
    const link = document.createElement('div');
    link.className = 'jr-card-link';
    const thumb = document.createElement('div');
    thumb.className = 'jr-thumb';
    const body = document.createElement('div');
    body.className = 'jr-card-body';
    const h2 = document.createElement('h2');
    h2.className = 'jr-card-title';
    h2.textContent = hostOf(url);
    const meta = document.createElement('div');
    meta.className = 'jr-card-meta';
    meta.textContent = '正在抓取內文…';
    body.appendChild(h2);
    body.appendChild(meta);
    link.appendChild(thumb);
    link.appendChild(body);
    card.appendChild(link);
    return card;
  }

  // 暫時卡片的副標換成「訊息　·　開原網頁」＋關閉鈕（抓不到 / 太久）
  function settlePendingCard(card, url, message, onDismiss) {
    const document = card.ownerDocument;
    card.classList.remove('is-busy');
    const meta = card.querySelector('.jr-card-meta');
    if (meta) {
      meta.textContent = message + '　·　';
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = '開原網頁';
      meta.appendChild(a);
    }
    if (!card.querySelector('.jr-pending-close')) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'jr-pending-close';
      x.setAttribute('aria-label', '關閉');
      x.textContent = '×';
      x.addEventListener('click', () => onDismiss());
      card.appendChild(x);
    }
  }

  // 輪詢單篇的 status：ready / failed / timeout。deps：getDoc(id) → { ok, doc }、
  // wait(ms)、now()——spec 注入假時鐘
  async function pollUntilSettled(id, deps) {
    const start = deps.now();
    for (;;) {
      await deps.wait(POLL_MS);
      let r = null;
      try { r = await deps.getDoc(id); } catch (_) { r = null; }
      const st = r && r.ok && r.doc ? r.doc.status : null;
      if (st === 'ready' || st === 'failed') return { status: st, doc: r.doc };
      if (deps.now() - start >= POLL_LIMIT_MS) return { status: 'timeout', doc: r && r.doc };
    }
  }

  function el(document, tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // 工具列 DOM（插在分頁列前面）
  function buildToolbar(document) {
    const root = el(document, 'div', 'jr-tools-wrap');
    const bar = el(document, 'div', 'jr-tools');
    const search = el(document, 'input', 'jr-search');
    search.type = 'search';
    search.placeholder = '搜尋文章';
    search.setAttribute('aria-label', '搜尋文章');
    search.autocomplete = 'off';
    search.enterKeyHint = 'search';
    const add = el(document, 'button', 'jr-tool-btn jr-tool-add', '＋');
    add.type = 'button';
    add.title = '貼網址存文章';
    add.setAttribute('aria-label', '貼網址存文章');
    add.setAttribute('aria-expanded', 'false');
    const tags = el(document, 'button', 'jr-tool-btn jr-tool-tags', '標籤');
    tags.type = 'button';
    tags.setAttribute('aria-haspopup', 'menu');
    bar.appendChild(search);
    bar.appendChild(add);
    bar.appendChild(tags);

    const addRow = el(document, 'form', 'jr-addrow');
    addRow.hidden = true;
    const url = el(document, 'input', 'jr-addrow-url');
    url.type = 'url';
    url.placeholder = '貼上文章網址';
    url.setAttribute('aria-label', '文章網址');
    url.autocomplete = 'off';
    const submit = el(document, 'button', 'jr-tool-btn jr-addrow-submit', '儲存');
    submit.type = 'submit';
    addRow.appendChild(url);
    addRow.appendChild(submit);

    const filter = el(document, 'div', 'jr-filter');
    filter.hidden = true;
    const searchHead = el(document, 'div', 'jr-search-head');
    searchHead.hidden = true;
    const pending = el(document, 'div', 'jr-list jr-pending-list');

    root.appendChild(bar);
    root.appendChild(addRow);
    root.appendChild(filter);
    return { root, bar, search, add, tags, addRow, url, submit, filter, searchHead, pending };
  }

  // env：{ doc, win, PC, service, creds, toast, listEl, tabsEl, msgEl, showMsg, hideMsg,
  //        createCard, currentTabId(), switchTab(id), reload(), setTagFilter(name|null),
  //        cancelPending(), sessionStorage? }
  function attach(env) {
    const { doc, win, PC, creds } = env;
    const ui = buildToolbar(doc);
    const tabsEl = env.tabsEl;
    tabsEl.parentNode.insertBefore(ui.root, tabsEl);
    // 抓取中的卡片放在分頁列與清單之間，清單重畫（renderFeed 清空 #jr-list）不會帶走它們
    env.listEl.parentNode.insertBefore(ui.pending, env.listEl);
    env.listEl.parentNode.insertBefore(ui.searchHead, env.listEl);

    const pendingIds = new Set();
    const rw = { token: creds.token, base: creds.base };
    const session = env.sessionStorage !== undefined ? env.sessionStorage : (() => {
      try { return win.sessionStorage; } catch (_) { return null; }
    })();

    // ---- 搜尋 ----
    let searchGen = 0;
    let searching = false;
    let current = null; // { q, offset, count, done }
    let debounce = null;
    let observer = null;
    const sentinel = el(doc, 'div', 'jr-search-more');

    function rememberSearch(q) {
      try { if (session) { if (q) session.setItem(LAST_SEARCH_KEY, q); else session.removeItem(LAST_SEARCH_KEY); } } catch (_) {}
    }

    function exitSearch(reload) {
      if (!searching) return;
      searching = false;
      searchGen++;
      current = null;
      ui.searchHead.hidden = true;
      ui.searchHead.textContent = '';
      tabsEl.hidden = false;
      ui.pending.hidden = false;
      if (observer) { observer.disconnect(); observer = null; }
      if (sentinel.parentNode) sentinel.parentNode.removeChild(sentinel);
      rememberSearch('');
      if (reload !== false) env.reload();
    }

    async function runSearch(q, more) {
      const gen = more ? searchGen : ++searchGen;
      if (!more) {
        env.cancelPending();
        searching = true;
        tabsEl.hidden = true;
        ui.pending.hidden = true;
        current = { q, offset: 0, count: 0, done: false };
        rememberSearch(q);
        if (!env.listEl.children.length) env.showMsg('搜尋中…', false);
      }
      const offset = more ? current.offset : 0;
      const r = await PC.searchJReader(Object.assign({ q, limit: SEARCH_PAGE, offset }, rw));
      if (gen !== searchGen || !searching) return; // 已換查詢或離開搜尋
      if (!r || !r.ok) {
        env.toast(PC.serviceErrorMessage ? PC.serviceErrorMessage(r, { action: '搜尋' }) : '搜尋失敗', 'error');
        return;
      }
      if (!more) {
        env.listEl.textContent = '';
        ui.searchHead.hidden = false;
        ui.searchHead.textContent = r.count ? '找到 ' + r.count + ' 篇' : '';
        if (!r.count) { env.showMsg('找不到含有「' + q + '」的文章', false); return; }
        env.hideMsg();
      }
      for (const d of r.results) {
        const card = createResultCard(d, doc, env.createCard, q);
        if (card) env.listEl.appendChild(card);
      }
      current.offset = offset + r.results.length;
      current.count = r.count;
      current.done = current.offset >= r.count || !r.results.length;
      armMore();
    }

    // 捲到底自動載入下一頁（IntersectionObserver；沒有的環境就只顯示第一頁）
    function armMore() {
      if (observer) { observer.disconnect(); observer = null; }
      if (sentinel.parentNode) sentinel.parentNode.removeChild(sentinel);
      if (!current || current.done || typeof win.IntersectionObserver !== 'function') return;
      env.listEl.parentNode.insertBefore(sentinel, env.listEl.nextSibling);
      observer = new win.IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting) || !current || current.done || current.loading) return;
        current.loading = true;
        const c = current;
        runSearch(c.q, true).finally(() => { c.loading = false; });
      }, { rootMargin: '400px' });
      observer.observe(sentinel);
    }

    ui.search.addEventListener('input', () => {
      if (debounce) win.clearTimeout(debounce);
      const q = ui.search.value.trim();
      debounce = win.setTimeout(() => {
        debounce = null;
        if (hasSearchable(q)) runSearch(q, false);
        else exitSearch(true);
      }, SEARCH_DEBOUNCE_MS);
    });
    ui.search.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return; // 注音 / 拼音選字中的 Enter、Esc 交給輸入法
      if (e.key === 'Escape') {
        e.preventDefault();
        if (debounce) { win.clearTimeout(debounce); debounce = null; }
        ui.search.value = '';
        ui.search.blur();
        exitSearch(true);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (debounce) { win.clearTimeout(debounce); debounce = null; }
        const q = ui.search.value.trim();
        if (hasSearchable(q)) runSearch(q, false);
      }
    });

    // ---- 「＋」貼網址 ----
    function setAddOpen(open) {
      ui.addRow.hidden = !open;
      ui.add.setAttribute('aria-expanded', open ? 'true' : 'false');
      ui.add.classList.toggle('is-on', open);
      if (open) { ui.url.value = ''; ui.url.focus(); }
    }
    ui.add.addEventListener('click', () => setAddOpen(ui.addRow.hidden));
    ui.url.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') { e.preventDefault(); setAddOpen(false); }
    });

    async function trackPending(id, url) {
      const card = createPendingCard(url, doc);
      card.setAttribute('data-doc-id', id);
      pendingIds.add(id);
      ui.pending.insertBefore(card, ui.pending.firstChild);
      const dismiss = () => {
        pendingIds.delete(id);
        if (card.parentNode) card.parentNode.removeChild(card);
        env.reload();
      };
      const res = await pollUntilSettled(id, {
        getDoc: (x) => PC.getJReaderDocument(Object.assign({ id: x }, rw)),
        wait: (ms) => new Promise((r) => win.setTimeout(r, ms)),
        now: () => Date.now()
      });
      if (res.status === 'ready') { dismiss(); return res; }
      settlePendingCard(card, url, res.status === 'failed' ? '抓不到內文' : '仍在處理，稍後重新整理', dismiss);
      return res;
    }

    async function submitUrl(raw) {
      const url = String(raw || '').trim();
      if (!/^https?:\/\/\S+$/i.test(url)) { env.toast('請貼上 http 或 https 開頭的網址', 'error'); return null; }
      ui.submit.disabled = true;
      let r;
      try { r = await PC.saveUrlToJReader(Object.assign({ url }, rw)); } catch (_) { r = null; }
      ui.submit.disabled = false;
      if (!r || !r.ok) {
        const code = r && r.detail;
        env.toast(code === 'INVALID_URL' ? '網址格式不對'
          : (PC.serviceErrorMessage ? PC.serviceErrorMessage(r, { action: '儲存' }) : '儲存失敗'), 'error');
        return r;
      }
      setAddOpen(false);
      const data = r.data || {};
      if (data.existed) {
        const loc = locationLabel(data.location);
        env.toast('這篇已經存過了' + (loc ? '（在 ' + loc + '）' : ''), 'info');
        return r;
      }
      if (searching) { ui.search.value = ''; exitSearch(false); }
      if (env.currentTabId() !== 'new') env.switchTab('new');
      trackPending(String(data.id), url);
      return r;
    }
    ui.addRow.addEventListener('submit', (e) => { e.preventDefault(); submitUrl(ui.url.value); });

    // ---- 標籤篩選 ----
    let activeTag = null;
    let menu = null;
    function closeTagMenu() {
      if (!menu) return;
      menu.cleanup();
      if (menu.el.parentNode) menu.el.parentNode.removeChild(menu.el);
      menu = null;
      ui.tags.setAttribute('aria-expanded', 'false');
    }
    function renderFilterChip() {
      ui.filter.textContent = '';
      ui.filter.hidden = !activeTag;
      ui.tags.classList.toggle('is-on', !!activeTag);
      if (!activeTag) return;
      const chip = el(doc, 'span', 'jr-chip');
      chip.appendChild(el(doc, 'span', 'jr-chip-label', '# ' + activeTag));
      const x = el(doc, 'button', 'jr-chip-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', '取消標籤篩選');
      x.addEventListener('click', () => setTag(null));
      chip.appendChild(x);
      ui.filter.appendChild(chip);
    }
    function setTag(name) {
      activeTag = name || null;
      renderFilterChip();
      if (searching) { ui.search.value = ''; exitSearch(false); }
      env.setTagFilter(activeTag);
    }
    async function openTagMenu() {
      closeTagMenu();
      const box = el(doc, 'div', 'jr-menu jr-tagmenu');
      box.setAttribute('role', 'menu');
      const filterInput = el(doc, 'input', 'jr-tagmenu-filter');
      filterInput.type = 'search';
      filterInput.placeholder = '找標籤';
      filterInput.setAttribute('aria-label', '找標籤');
      const list = el(doc, 'div', 'jr-tagmenu-list');
      list.appendChild(el(doc, 'div', 'jr-tagmenu-empty', '載入中…'));
      box.appendChild(filterInput);
      box.appendChild(list);
      const rect = ui.tags.getBoundingClientRect();
      box.style.top = Math.round(rect.bottom + 6) + 'px';
      box.style.right = Math.max(8, Math.round((win.innerWidth || 0) - rect.right)) + 'px';
      doc.body.appendChild(box);
      ui.tags.setAttribute('aria-expanded', 'true');
      const onDown = (e) => { if (!box.contains(e.target) && e.target !== ui.tags) closeTagMenu(); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeTagMenu(); ui.tags.focus(); } };
      doc.addEventListener('pointerdown', onDown, true);
      doc.addEventListener('keydown', onKey, true);
      menu = { el: box, cleanup() { doc.removeEventListener('pointerdown', onDown, true); doc.removeEventListener('keydown', onKey, true); } };
      filterInput.focus();

      const mine = menu;
      const r = await PC.listJReaderTags(rw);
      if (menu !== mine) return;
      const tags = (r && r.ok ? r.tags : []) || [];
      const draw = () => {
        const f = filterInput.value.trim().toLowerCase();
        list.textContent = '';
        const shown = tags.filter((t) => !f || String(t.name).toLowerCase().includes(f));
        if (!shown.length) {
          list.appendChild(el(doc, 'div', 'jr-tagmenu-empty', r && r.ok ? (tags.length ? '沒有符合的標籤' : '還沒有任何標籤') : '標籤載入失敗'));
          return;
        }
        for (const t of shown) {
          const b = el(doc, 'button', 'jr-menu-item jr-tagmenu-item');
          b.type = 'button';
          b.setAttribute('role', 'menuitem');
          b.appendChild(el(doc, 'span', 'jr-tagmenu-name', t.name));
          b.appendChild(el(doc, 'span', 'jr-tagmenu-count', String(t.count)));
          if (activeTag && activeTag.toLowerCase() === String(t.name).toLowerCase()) b.classList.add('is-on');
          b.addEventListener('click', () => { closeTagMenu(); setTag(String(t.name)); });
          list.appendChild(b);
        }
      };
      filterInput.addEventListener('input', draw);
      filterInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const first = list.querySelector('.jr-tagmenu-item'); if (first) { e.preventDefault(); first.click(); } }
      });
      draw();
    }
    ui.tags.addEventListener('click', () => { if (menu) closeTagMenu(); else openTagMenu(); });

    // ---- 快速鍵：/ 聚焦搜尋（輸入框內不觸發） ----
    doc.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
      e.preventDefault();
      ui.search.focus();
    });

    // 文章頁退出回 reader.html?tab=search：叫回上次的查詢。回 true＝已接手，feed 不必載入分頁
    function restoreSearch(search) {
      let tab = null;
      try { tab = new URLSearchParams(search || '').get('tab'); } catch (_) {}
      if (tab !== SEARCH_TAB) return false;
      let q = null;
      try { q = session ? session.getItem(LAST_SEARCH_KEY) : null; } catch (_) { q = null; }
      if (!hasSearchable(q)) return false;
      ui.search.value = q;
      runSearch(q, false);
      return true;
    }

    return {
      ui,
      isPending: (id) => pendingIds.has(String(id)),
      isSearching: () => searching,
      exitSearch,
      restoreSearch,
      submitUrl,
      runSearch,
      setTag,
      openTagMenu,
      closeTagMenu,
      activeTag: () => activeTag
    };
  }

  const api = {
    attach, highlightTerms, createResultCard, createPendingCard, settlePendingCard, pollUntilSettled,
    locationLabel, hasSearchable, buildToolbar,
    SEARCH_TAB, LAST_SEARCH_KEY, SEARCH_PAGE, POLL_MS, POLL_LIMIT_MS, SEARCH_DEBOUNCE_MS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.__JReadReaderLibrary = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
