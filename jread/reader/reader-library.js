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
  const FAB_IDLE_MS = 400; // 捲動停下多久後圓鈕回來
  const KB_MIN_PX = 80; // visual viewport 比 layout viewport 矮超過這麼多才算螢幕鍵盤（iPhone 鍵盤至少 200px 以上；
  // 接實體鍵盤時 iOS 只留一條浮動列，模擬器量到差 68px，不算鍵盤、底部墊高照舊）
  // 搜尋結果排序（Jimmy 2026-11-24「加入 相關/最新/最舊」）。最新 / 最舊＝存入日期（JReader sort 參數）
  const SORTS = [{ id: 'relevance', label: '相關' }, { id: 'newest', label: '最新' }, { id: 'oldest', label: '最舊' }];
  const LAST_SORT_KEY = 'jread:lastSearchSort';
  // 資料夾篩選（Jimmy 2026-11-24「搜尋請加入資料夾 filter」）：''＝全部。伺服器 /api/v1/search?location=
  const FOLDERS = [{ id: '', label: '全部' }, { id: 'new', label: 'Inbox' }, { id: 'later', label: 'Later' }, { id: 'archive', label: 'Archive' }];
  const LAST_FOLDER_KEY = 'jread:lastSearchFolder';
  // 搜尋時套用中的標籤（v3.2.3，Jimmy 2026-11-25「標籤和文字搜尋要能同時存在」）：從文章頁退回 tab=search 時一起叫回
  const LAST_TAG_KEY = 'jread:lastSearchTag';
  // 開始搜尋時所在的分頁：從搜尋結果打開文章再退回（網址只剩 tab=search）後按 Esc，要回到這個分頁、不是第一個
  const SEARCH_FROM_KEY = 'jread:searchFrom';
  // 搜尋結果卡片連到文章頁時帶的 tab：退出文章頁回 reader.html?tab=search，工具列
  // 依此把上次的查詢叫回來（pickInitialTab 不認得 search，分頁本身退回第一個）
  const SEARCH_TAB = 'search';

  // 資料夾顯示名稱的正本在 reader-cache.js（feed 卡片標籤共用）
  const RC_MOD = global.__JReadReaderCache ||
    (typeof module !== 'undefined' && module.exports && typeof require === 'function' ? require('./reader-cache.js') : null);
  function locationLabel(loc) {
    return RC_MOD && typeof RC_MOD.locationLabel === 'function' ? RC_MOD.locationLabel(loc) : '';
  }

  function hasSearchable(q) {
    return typeof q === 'string' && /[\p{L}\p{N}]/u.test(q);
  }

  // 摘錄文字 → DOM 片段，查詢詞（空白分開的每個詞，不分大小寫）加粗。只產生文字
  // 節點與 <b>，不經 innerHTML（摘錄來自文章內文，不能當 HTML）
  // terms＝要標粗的字，由 JReader 搜尋回應的 terms 給（伺服器 highlightTermsOf：OR、排除詞、"整句" 的斷詞規則只在
  // 伺服器，這裡不另外解析查詢語法——兩邊各一份會 drift）。不分大小寫、長的先比
  function highlightTerms(text, terms, document) {
    const frag = document.createDocumentFragment();
    const src = String(text || '');
    terms = (Array.isArray(terms) ? terms : []).map((t) => String(t).toLowerCase()).filter(Boolean)
      .sort((a, b) => b.length - a.length);
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

  // 搜尋結果卡片：reader-feed 的卡片＋副標最前面的資料夾標籤＋摘錄。右鍵選單由 reader-feed 依卡片
  // 自己的資料夾掛上（env.attachResultMenu）；不掛滑動。
  // 資料夾標籤放在副標最前面、獨立的小框（Jimmy 2026-11-24：原本接在副標尾端，作者網站一長
  // 就被截掉、也跟作者網站同色看不出來）。有摘錄時拿掉卡片的摘要，不疊四行
  // dateMode 'saved'：依存入日期排序（最新 / 最舊）時卡片日期顯示存入日期，跟排序對得上
  function createResultCard(doc, document, createCard, terms, dateMode) {
    const card = createCard(doc, document, { archivable: false, tabId: SEARCH_TAB, showLocation: true, dateMode });
    if (!card) return null;
    if (doc.snippet) {
      const summary = card.querySelector('.jr-card-summary');
      if (summary) summary.remove();
      const sn = document.createElement('div');
      sn.className = 'jr-card-snippet';
      // 摘錄來自自己劃的重點（伺服器 snippet_source）：前面標「重點」，看得出是因為劃過才找到
      if (doc.snippet_source === 'highlight') {
        const tag = document.createElement('span');
        tag.className = 'jr-snippet-hl';
        tag.textContent = '重點';
        sn.appendChild(tag);
      }
      sn.appendChild(highlightTerms(doc.snippet, terms, document));
      const body = card.querySelector('.jr-card-body');
      if (body) body.appendChild(sn);
    }
    return card;
  }

  // 網域（正本 reader-cache hostOf）；抓取中卡片的標題取不到網域時顯示原網址
  function hostOf(url) {
    const h = RC_MOD && typeof RC_MOD.hostOf === 'function' ? RC_MOD.hostOf(url) : '';
    return h || String(url || '');
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

  // 工具列 DOM：固定在畫面底部（Jimmy 2026-11-24「頂端的工具列搬到底部」）。由下往上：
  // 工具列本身在最底，貼網址輸入列與篩選中的標籤 chip 疊在它上方（往上長，不推動清單）
  function buildToolbar(document) {
    const root = el(document, 'div', 'jr-tools-wrap');
    const inner = el(document, 'div', 'jr-tools-inner');
    root.appendChild(inner);
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
    // 收起鈕：平常只有右下角的搜尋圓鈕（Jimmy 2026-11-24 選 B：「不想要平常就出現固定的工具列」）
    const close = el(document, 'button', 'jr-tool-btn jr-tool-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '收起工具列');
    bar.appendChild(search);
    bar.appendChild(add);
    bar.appendChild(tags);
    bar.appendChild(close);

    const addRow = el(document, 'form', 'jr-addrow');
    addRow.hidden = true;
    // v3.4.0：不用瀏覽器內建的網址驗證——沒寫 https:// 的網址會被它擋下，送出時由 submitUrl 補上
    addRow.noValidate = true;
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
    // 搜尋結果上方：左邊資料夾篩選、右邊排序三段切換，下一行「找到 N 篇」（窄畫面排序會折到下一行）
    const searchHead = el(document, 'div', 'jr-search-head');
    searchHead.hidden = true;
    const searchCount = el(document, 'span', 'jr-search-count');
    // 搜尋語法的淡色提示（Jimmy 2026-11-24 搜尋加 OR / 排除），跟「找到 N 篇」同一行、靠右
    const searchMeta = el(document, 'div', 'jr-search-meta');
    const searchHint = el(document, 'span', 'jr-search-hint', '空白＝都要有　OR＝其中之一　-詞＝排除　"整句"');
    const folderBar = el(document, 'div', 'jr-sort jr-folder');
    folderBar.setAttribute('role', 'radiogroup');
    folderBar.setAttribute('aria-label', '資料夾');
    for (const f of FOLDERS) {
      const b = el(document, 'button', 'jr-folder-btn', f.label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('data-folder', f.id);
      folderBar.appendChild(b);
    }
    const sortBar = el(document, 'div', 'jr-sort');
    sortBar.setAttribute('role', 'radiogroup');
    sortBar.setAttribute('aria-label', '排序');
    for (const s of SORTS) {
      const b = el(document, 'button', 'jr-sort-btn', s.label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('data-sort', s.id);
      sortBar.appendChild(b);
    }
    searchHead.appendChild(folderBar);
    searchHead.appendChild(sortBar);
    searchMeta.appendChild(searchCount);
    searchMeta.appendChild(searchHint);
    searchHead.appendChild(searchMeta);
    const pending = el(document, 'div', 'jr-list jr-pending-list');

    inner.appendChild(filter);
    inner.appendChild(addRow);
    inner.appendChild(bar);
    root.hidden = true;

    // 右下角的搜尋圓鈕（收起狀態唯一看得到的東西）。放大鏡用線條 SVG，不用 emoji（各平台一致）
    const fab = el(document, 'button', 'jr-fab');
    fab.type = 'button';
    fab.title = '搜尋、貼網址、標籤（/）';
    fab.setAttribute('aria-label', '開啟搜尋與工具列');
    fab.setAttribute('aria-expanded', 'false');
    const NSVG = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NSVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const circle = document.createElementNS(NSVG, 'circle');
    circle.setAttribute('cx', '10.5'); circle.setAttribute('cy', '10.5'); circle.setAttribute('r', '6.5');
    const line = document.createElementNS(NSVG, 'path');
    line.setAttribute('d', 'M15.5 15.5L20 20');
    svg.appendChild(circle);
    svg.appendChild(line);
    fab.appendChild(svg);
    return { root, inner, bar, close, fab, search, add, tags, addRow, url, submit, filter, searchHead, searchCount, sortBar, folderBar, pending };
  }

  // env：{ doc, win, PC, service, creds, toast, listEl, tabsEl, msgEl, showMsg, hideMsg,
  //        createCard, currentTabId(), switchTab(id), reload(),
  //        cancelPending(), sessionStorage? }
  // 「焦點在可打字的元素裡」：單一資料源 NS.isTextInputTarget（看穿開放式 shadow root）
  function isTyping(t) {
    const N = global.__JRead;
    return !!(N && typeof N.isTextInputTarget === 'function' && N.isTextInputTarget(t));
  }

  function attach(env) {
    const { doc, win, PC, creds } = env;
    const ui = buildToolbar(doc);
    const tabsEl = env.tabsEl;
    // 掛 body 最後（position: fixed 貼底）；body 加 class 讓清單底部留出圓鈕 / 工具列的高度
    doc.body.appendChild(ui.root);
    doc.body.appendChild(ui.fab);
    doc.body.classList.add('jr-has-tools');
    // 展開的工具列實際高度（含貼網址列、標籤 chip、底部安全距離）→ <html> 的 --jr-tools-h：
    // toast 往上讓出工具列（2026-11-24 審核 A-8；CSS 在 reader.html）
    const RO = win.ResizeObserver;
    const syncToolsHeight = () => {
      if (ui.root.offsetHeight) doc.documentElement.style.setProperty('--jr-tools-h', ui.root.offsetHeight + 'px');
    };
    if (typeof RO === 'function') new RO(syncToolsHeight).observe(ui.root);
    // 抓取中的卡片放在分頁列與清單之間，清單重畫（renderFeed 清空 #jr-list）不會帶走它們
    env.listEl.parentNode.insertBefore(ui.pending, env.listEl);
    env.listEl.parentNode.insertBefore(ui.searchHead, env.listEl);

    const pendingIds = new Set();
    const rw = { token: creds.token, base: creds.base };
    const session = env.sessionStorage !== undefined ? env.sessionStorage : (() => {
      try { return win.sessionStorage; } catch (_) { return null; }
    })();

    // ---- 展開 / 收起（平常只有右下角圓鈕）----
    // 收起的條件：點工具列以外的地方、按 ×、搜尋框 Esc。正在搜尋或貼網址列開著時點外面不收
    //（搜尋結果還在畫面上，搜尋框不能跟著消失）
    let expanded = false;
    function setExpanded(open, opts) {
      expanded = !!open;
      ui.root.hidden = !expanded;
      ui.fab.hidden = expanded;
      ui.fab.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      doc.body.classList.toggle('jr-tools-open', expanded);
      if (expanded && (!opts || opts.focus !== false)) ui.search.focus();
      if (!expanded && menu) closeTagMenu();
      syncKeyboard();
    }
    // opts.clearTag：連標籤篩選一起清（只有工具列的 × 走這條，Jimmy 2026-11-25「× 是全部關掉」；
    // 點外面、Esc 是「先收起來」，篩選留著、圓鈕藍框提醒）。搜尋字一律清掉：還有標籤就留在標籤瀏覽
    //（剛才有字才重抓），沒標籤回到分頁清單
    function collapse(opts) {
      const clearTag = !!(opts && opts.clearTag && activeTag);
      // 停頓中還沒送出的搜尋一起取消，不然收起後才在背景搜尋、清單被換掉
      if (debounce) { win.clearTimeout(debounce); debounce = null; }
      if (clearTag) { activeTag = null; renderFilterChip(); }
      ui.search.value = '';
      if (searching) searchOrBrowse('');
      setAddOpen(false);
      setExpanded(false);
      ui.fab.focus();
    }
    ui.fab.addEventListener('click', () => setExpanded(true));

    // iOS 螢幕鍵盤（v3.2.2 起；v3.2.3 依 iOS 26.5 模擬器實測改寫，App 與 Safari 都量過）：
    // - 鍵盤剛開：iOS 自己把 fixed 元素排在 visual viewport 底部（offsetTop＝頁面被推上去的量），
    //   innerHeight − (vv.height + vv.offsetTop) ＝ 0，不用墊
    // - 搜尋結果換掉清單、文件變矮後 offsetTop 歸 0，fixed 元素回到 layout viewport 底部＝鍵盤後面
    //  （Jimmy 2026-11-25 回報），這時差值＝鍵盤高度，墊上去
    // 「鍵盤開著」另外判斷（innerHeight − vv.height）：兩種狀態都要拿掉底部手勢區的墊高，v3.2.2 只看
    // 墊高量，鍵盤剛開時沒拿掉，App 裡搜尋框和鍵盤之間多出 34pt 空白（Jimmy 2026-11-25 截圖）。
    // 墊高量寫進 <html> 的 --jr-kb、鍵盤開著在 body 加 jr-kb-open，CSS 在 reader.html。
    // 頁面被捏合放大時量不準（offsetTop 混了平移量），不處理
    const vv = win.visualViewport;
    let kbPx = -1;
    let kbOpen = false;
    function syncKeyboard() {
      let lift = 0;
      let open = false;
      if (expanded && vv && !(vv.scale > 1.01) && toolbarInputFocused()) {
        const ih = win.innerHeight || 0;
        open = ih - vv.height >= KB_MIN_PX; // 網址列伸縮、捨入誤差這類小差距不算鍵盤
        if (open) lift = Math.max(0, Math.round(ih - (vv.height + vv.offsetTop)));
      }
      if (lift !== kbPx) {
        kbPx = lift;
        doc.documentElement.style.setProperty('--jr-kb', lift + 'px');
      }
      if (open !== kbOpen) {
        kbOpen = open;
        doc.body.classList.toggle('jr-kb-open', open);
      }
    }
    // 鍵盤是工具列的輸入框（搜尋框、貼網址）叫出來的才算：焦點一離開就停止墊高，不跟著鍵盤收起動畫
    // 一路追 visual viewport（v3.2.4 模擬器實測：追的話收鍵盤那半秒搜尋列亂跳）
    function toolbarInputFocused() {
      const a = doc.activeElement;
      return !!a && ui.root.contains(a) && a.tagName === 'INPUT';
    }
    if (vv && typeof vv.addEventListener === 'function') {
      vv.addEventListener('resize', syncKeyboard);
      vv.addEventListener('scroll', syncKeyboard);
    }
    ui.root.addEventListener('focusin', syncKeyboard);
    ui.root.addEventListener('focusout', syncKeyboard);
    // 鍵盤開著時一滑清單就收起鍵盤（v3.2.4，Jimmy 2026-11-25 選；iOS 郵件、App Store 搜尋的慣例）：
    // iOS 26 鍵盤開著時捲動，fixed 的工具列會被系統來回移動（模擬器實測連完全不墊高的純 fixed 也抖、
    // 還會躲到鍵盤後面），網頁端追位置永遠慢一格。收起鍵盤後工具列回到底部、不再抖；搜尋字與結果留著。
    // 只看觸控、只在螢幕鍵盤開著時（接實體鍵盤的 iPad 不收）；在工具列或標籤選單裡滑不算
    doc.addEventListener('touchmove', (e) => {
      if (!kbOpen) return;
      const t = e.target;
      if (ui.root.contains(t) || (menu && menu.el.contains(t))) return;
      const a = doc.activeElement;
      if (a && typeof a.blur === 'function') a.blur();
    }, { passive: true, capture: true });

    // 捲動時藏圓鈕：往下捲淡出、往上捲立刻回來、停下 FAB_IDLE_MS 後回來（Jimmy 2026-11-24 選 A＋C）
    let lastY = win.scrollY || 0;
    let idleTimer = null;
    win.addEventListener('scroll', () => {
      const y = win.scrollY || 0;
      const dy = y - lastY;
      lastY = y;
      if (expanded) return;
      if (dy > 2) ui.fab.classList.add('is-scroll-hidden');
      else if (dy < -2) ui.fab.classList.remove('is-scroll-hidden');
      if (idleTimer) win.clearTimeout(idleTimer);
      idleTimer = win.setTimeout(() => { idleTimer = null; ui.fab.classList.remove('is-scroll-hidden'); }, FAB_IDLE_MS);
    }, { passive: true });
    ui.close.addEventListener('click', () => collapse({ clearTag: true }));
    // 只用標籤瀏覽（沒有搜尋字）時點外面照樣收：畫面上沒有要留著的搜尋字，圓鈕藍框提醒還在篩選
    doc.addEventListener('pointerdown', (e) => {
      if (!expanded || (searching && hasQuery()) || !ui.addRow.hidden) return;
      const t = e.target;
      if (ui.root.contains(t) || ui.fab.contains(t) || (menu && menu.el.contains(t))) return;
      setExpanded(false);
    }, true);

    // ---- 搜尋 ----
    let searchGen = 0;
    let searching = false;
    let activeTag = null; // 標籤篩選（下方「標籤篩選」段）
    let current = null; // { q, offset, count, done }
    let debounce = null;
    let observer = null;
    const sentinel = el(doc, 'div', 'jr-search-more');

    // 「搜尋」狀態涵蓋兩種：有要找的字（可再疊標籤），或只選了標籤、沒打字（v3.2.5，Jimmy 2026-11-25
    // 「只選 tag 也要有資料夾和排序」，選了「跟搜尋結果一樣」）。後者 q＝''，伺服器 /api/v1/search 收空 q＋tag。
    // 原本只選標籤是疊在分頁清單上篩（清單 API 不能排序），已拿掉，標籤一律走這條
    const canQuery = (q) => hasSearchable(q) || !!activeTag;
    const hasQuery = () => !!(current && hasSearchable(current.q));
    // 沒有要找的字時「相關」沒有意義：按鈕藏起來，照最新排（使用者另外選過最新 / 最舊就照選的）
    const effectiveSort = () => (sortMode === 'relevance' && !hasQuery() ? 'newest' : sortMode);

    function rememberSearch(q) {
      try {
        if (!session) return;
        if (q || activeTag) {
          session.setItem(LAST_SEARCH_KEY, q); session.setItem(LAST_SORT_KEY, sortMode); session.setItem(LAST_FOLDER_KEY, folder);
          if (activeTag) session.setItem(LAST_TAG_KEY, activeTag); else session.removeItem(LAST_TAG_KEY);
        } else { session.removeItem(LAST_SEARCH_KEY); session.removeItem(LAST_SORT_KEY); session.removeItem(LAST_FOLDER_KEY); session.removeItem(LAST_TAG_KEY); }
      } catch (_) {}
    }

    // 排序：預設相關；換排序＝同一個查詢從第一頁重搜。離開搜尋回到預設
    let sortMode = 'relevance';
    function renderSort() {
      const s = effectiveSort();
      const q = hasQuery();
      for (const b of ui.sortBar.querySelectorAll('.jr-sort-btn')) {
        const id = b.getAttribute('data-sort');
        const on = id === s;
        b.hidden = id === 'relevance' && !q;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    }
    renderSort();
    ui.sortBar.addEventListener('click', (e) => {
      const b = e.target && e.target.closest && e.target.closest('.jr-sort-btn');
      if (!b || !current) return;
      const next = b.getAttribute('data-sort');
      if (next === effectiveSort()) return;
      sortMode = next;
      renderSort();
      runSearch(current.q, false);
    });

    // 資料夾篩選：預設全部；換資料夾＝同一個查詢從第一頁重搜。離開搜尋回到全部
    let folder = '';
    function renderFolder() {
      for (const b of ui.folderBar.querySelectorAll('.jr-folder-btn')) {
        const on = b.getAttribute('data-folder') === folder;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
    }
    renderFolder();
    ui.folderBar.addEventListener('click', (e) => {
      const b = e.target && e.target.closest && e.target.closest('.jr-folder-btn');
      if (!b || !current) return;
      const next = b.getAttribute('data-folder');
      if (next === folder) return;
      folder = next;
      renderFolder();
      runSearch(current.q, false);
    });
    function setCount(n) { ui.searchCount.textContent = n ? '找到 ' + n + ' 篇' : ''; }

    // 結果卡片＋右鍵選單。搬資料夾：換成新卡片（資料夾標籤更新）；刪除或搬出目前篩選的資料夾：拿掉卡片，
    // 篇數與下一頁的 offset 跟著減一（伺服器那邊這篇已不在這組結果裡）
    function resultCard(d, terms) {
      const card = createResultCard(d, doc, env.createCard, terms, effectiveSort() === 'relevance' ? null : 'saved');
      if (!card || typeof env.attachResultMenu !== 'function') return card;
      env.attachResultMenu(card, d, {
        changed: (nd) => {
          if (!card.parentNode) return;
          if (!nd || (folder && nd.location !== folder)) {
            card.parentNode.removeChild(card);
            if (current) {
              current.count = Math.max(0, current.count - 1);
              current.offset = Math.max(0, current.offset - 1);
              setCount(current.count);
              if (!current.count) env.showMsg(emptySearchText(current.q), false);
            }
            return;
          }
          const next = resultCard(nd, terms);
          if (next) card.parentNode.replaceChild(next, card);
        }
      });
      return card;
    }
    function emptySearchText(q) {
      const f = FOLDERS.find((x) => x.id === folder);
      if (!hasSearchable(q)) return (folder && f ? f.label + ' 裡' : '') + '沒有標記「' + activeTag + '」的文章';
      const scope = [folder && f ? f.label : '', activeTag ? '# ' + activeTag : ''].filter(Boolean).join('、');
      return (scope ? scope + ' 裡' : '') + '找不到含有「' + q + '」的文章';
    }

    function exitSearch(reload) {
      if (!searching) return;
      if (typeof env.onViewChange === 'function') env.onViewChange();
      searching = false;
      renderFilterChip();
      doc.body.classList.remove('jr-searching');
      searchGen++;
      current = null;
      ui.searchHead.hidden = true;
      ui.searchCount.textContent = '';
      sortMode = 'relevance';
      renderSort();
      folder = '';
      renderFolder();
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
        if (typeof env.onViewChange === 'function') env.onViewChange();
        env.cancelPending();
        searching = true;
        renderFilterChip();
        doc.body.classList.add('jr-searching'); // CSS 藏「載入更多」（分頁清單的翻頁）
        tabsEl.hidden = true;
        ui.pending.hidden = true;
        current = { q, offset: 0, count: 0, done: false };
        renderSort(); // 有沒有要找的字決定「相關」在不在
        rememberSearch(q);
        try {
          const from = typeof env.currentTabId === 'function' ? env.currentTabId() : null;
          if (session && from) session.setItem(SEARCH_FROM_KEY, from);
        } catch (_) {}
        if (!env.listEl.children.length) env.showMsg('搜尋中…', false);
      }
      const offset = more ? current.offset : 0;
      const r = await PC.searchJReader(Object.assign({ q, sort: effectiveSort(), location: folder || undefined, tag: activeTag || undefined, limit: SEARCH_PAGE, offset }, rw));
      if (gen !== searchGen || !searching) return; // 已換查詢或離開搜尋
      if (!r || !r.ok) {
        // 只用標籤瀏覽卻回 INVALID_QUERY＝JReader 伺服器還沒支援空 q（要先部署 JReader 再換 web core）
        if (r && r.status === 400 && r.code === 'INVALID_QUERY' && !more && !hasSearchable(q)) {
          env.listEl.textContent = '';
          ui.searchHead.hidden = true;
          env.showMsg('JReader 伺服器還不支援只用標籤瀏覽，請先更新伺服器', true);
          return;
        }
        // INVALID_QUERY＝沒有要找的詞（例如只打了「-iPhone」）：不是錯誤，提示怎麼用。其他 400（例如 INVALID_SORT）
        // 照一般錯誤處理（2026-11-24 審核 C-7：原本所有 400 都顯示成這句）
        if (r && r.status === 400 && r.code === 'INVALID_QUERY' && !more) {
          env.listEl.textContent = '';
          ui.searchHead.hidden = true;
          env.showMsg('只有排除的詞沒辦法搜尋，請再加一個要找的詞，例如「Apple -iPhone」', false);
          return;
        }
        const msg = PC.serviceErrorMessage ? PC.serviceErrorMessage(r, { action: '搜尋' }) : '搜尋失敗';
        // 第一頁就失敗：清掉畫面上上一份清單（分頁或前一個查詢的結果），不然 J / K / E 會作用在
        // 跟這次搜尋無關的舊卡片上（2026-11-24 審核 A-5）。載入更多失敗只跳 toast，已載入的結果留著
        if (!more) {
          env.listEl.textContent = '';
          ui.searchHead.hidden = true;
          env.showMsg(msg, true);
          return;
        }
        env.toast(msg, 'error');
        return;
      }
      if (!more) {
        env.listEl.textContent = '';
        // 沒有結果時排序沒有意義，整列藏起來——但選了資料夾就留著（要能切回「全部」）
        ui.searchHead.hidden = !r.count && !folder;
        setCount(r.count);
        if (!r.count) { env.showMsg(emptySearchText(q), false); return; }
        env.hideMsg();
      }
      if (typeof env.noteDocs === 'function') env.noteDocs(r.results);
      for (const d of r.results) {
        const card = resultCard(d, r.terms);
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
        searchOrBrowse(q);
      }, SEARCH_DEBOUNCE_MS);
    });
    // 依目前的字與標籤決定：有字＝搜尋；沒字但有標籤＝只用標籤瀏覽（已經在瀏覽就不重抓）；都沒有＝回分頁清單
    function searchOrBrowse(q) {
      if (hasSearchable(q)) { runSearch(q, false); return; }
      if (activeTag) {
        if (!searching || hasQuery()) runSearch('', false);
        return;
      }
      exitSearch(true);
    }
    // Esc 離開搜尋：清空查詢、收起工具列；沒有標籤回到分頁清單，有標籤留在標籤瀏覽（搜尋框裡、頁面層兩個入口共用）
    function escapeSearch() {
      collapse();
    }
    ui.search.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return; // 注音 / 拼音選字中的 Enter、Esc 交給輸入法
      if (e.key === 'Escape') {
        e.preventDefault();
        escapeSearch();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (debounce) { win.clearTimeout(debounce); debounce = null; }
        const q = ui.search.value.trim();
        if (canQuery(q)) searchOrBrowse(q);
      }
    });

    // ---- 「＋」貼網址 ----
    function setAddOpen(open) {
      ui.addRow.hidden = !open;
      ui.add.setAttribute('aria-expanded', open ? 'true' : 'false');
      ui.add.classList.toggle('is-on', open);
      if (open) { if (!expanded) setExpanded(true, { focus: false }); ui.url.value = ''; ui.url.focus(); }
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
      // 抓完（或使用者關掉卡片）：搜尋中不動清單——抓取卡片本來就藏著，離開搜尋時 env.reload 會帶到新文章；
      // 不在搜尋就背景更新目前分頁（不清畫面、不打斷多選）。原本一律 env.reload()，搜尋中抓完會把
      // 搜尋結果換成 Inbox、搜尋框卻還在（2026-11-24 審核 A-1）
      const dismiss = () => {
        pendingIds.delete(id);
        if (card.parentNode) card.parentNode.removeChild(card);
        if (searching) return;
        if (typeof env.refreshView === 'function') env.refreshView(); else env.reload();
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

    // http(s) 網址、主機名有點（或 localhost）：補了 https:// 之後，「notaurl」這種單字不會被當成網址送出
    function looksLikeWebUrl(u) {
      if (!/^https?:\/\/\S+$/i.test(u)) return false;
      try {
        const h = new URL(u).hostname;
        return h === 'localhost' || h.indexOf('.') > 0;
      } catch (_) { return false; }
    }

    async function submitUrl(raw) {
      // v3.4.0：沒寫協定自動補 https://（popup-core.withDefaultScheme 單一資料源）
      const url = typeof PC.withDefaultScheme === 'function' ? PC.withDefaultScheme(raw) : String(raw || '').trim();
      if (!looksLikeWebUrl(url)) { env.toast('請貼上文章網址', 'error'); return null; }
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
      if (!searching) setExpanded(false);
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

    // ---- 標籤篩選 ----（activeTag 宣告在搜尋狀態旁邊：exitSearch / runSearch 也會重畫篩選標記）
    let menu = null;
    function closeTagMenu() {
      if (!menu) return;
      menu.cleanup();
      if (menu.el.parentNode) menu.el.parentNode.removeChild(menu.el);
      menu = null;
      ui.tags.setAttribute('aria-expanded', 'false');
    }
    // 標籤篩選與文字搜尋並存（v3.2.3，Jimmy 2026-11-25）：搜尋帶 tag 參數給伺服器篩（/api/v1/search?tag=），
    // chip 在搜尋中也顯示。v3.1.2（審核 A-4）伺服器還不收 tag 時是搜尋中藏 chip、選標籤就離開搜尋
    function renderFilterChip() {
      const show = !!activeTag;
      ui.filter.textContent = '';
      ui.filter.hidden = !show;
      ui.tags.classList.toggle('is-on', show);
      ui.fab.classList.toggle('is-on', show); // 收起時圓鈕加框：提醒目前在篩選
      if (!show) return;
      const chip = el(doc, 'span', 'jr-chip');
      chip.appendChild(el(doc, 'span', 'jr-chip-label', '# ' + activeTag));
      const x = el(doc, 'button', 'jr-chip-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', '取消標籤篩選');
      x.addEventListener('click', () => setTag(null));
      chip.appendChild(x);
      ui.filter.appendChild(chip);
    }
    // 選標籤：有搜尋字就同一個查詢帶標籤從第一頁重搜，沒有就進標籤瀏覽（資料夾、排序沿用畫面上的）；
    // 拿掉標籤：有搜尋字照舊搜，沒有就回分頁清單
    function setTag(name) {
      activeTag = name || null;
      renderFilterChip();
      if (debounce) { win.clearTimeout(debounce); debounce = null; }
      const q = searching && current ? current.q : ui.search.value.trim();
      if (hasSearchable(q)) { runSearch(q, false); return; }
      if (activeTag) { runSearch('', false); return; }
      exitSearch(true);
    }
    // v3.4.5：iOS 在標籤選單上下滑，常常捲到的是後面的文章卡片（Jimmy 2026-11-25 回報）。WebKit 觸控
    // 捲動會「接力」：清單捲到頂 / 底、清單短到不能捲、或手指落在找標籤輸入框上，那一下就交給整頁捲。
    // 選單裡的觸控移動只准捲清單本身，其餘一律擋掉（CSS overscroll-behavior: contain 是第一層，
    // 舊版 WebKit 不認時靠這層）
    function guardMenuScroll(box, list) {
      let lastY = 0;
      box.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches[0]) lastY = e.touches[0].clientY;
      }, { passive: true });
      box.addEventListener('touchmove', (e) => {
        const t = e.touches && e.touches[0];
        if (!t) return;
        const dy = t.clientY - lastY;
        lastY = t.clientY;
        if (!list.contains(e.target) || list.scrollHeight <= list.clientHeight + 1) { e.preventDefault(); return; }
        const atTop = list.scrollTop <= 0;
        const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
        if ((dy > 0 && atTop) || (dy < 0 && atBottom)) e.preventDefault();
      }, { passive: false });
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
      // 工具列在底部：選單往上開（貼在按鈕上緣之上）
      const rect = ui.tags.getBoundingClientRect();
      box.style.bottom = Math.max(8, Math.round((win.innerHeight || 0) - rect.top + 6)) + 'px';
      box.style.right = Math.max(8, Math.round((win.innerWidth || 0) - rect.right)) + 'px';
      doc.body.appendChild(box);
      guardMenuScroll(box, list);
      ui.tags.setAttribute('aria-expanded', 'true');
      const onDown = (e) => { if (!box.contains(e.target) && e.target !== ui.tags) closeTagMenu(); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeTagMenu(); ui.tags.focus(); } };
      doc.addEventListener('pointerdown', onDown, true);
      doc.addEventListener('keydown', onKey, true);
      menu = { el: box, cleanup() { doc.removeEventListener('pointerdown', onDown, true); doc.removeEventListener('keydown', onKey, true); } };
      filterInput.focus();

      const mine = menu;
      let r = null;
      try { r = await PC.listJReaderTags(rw); } catch (_) { r = null; } // 失敗顯示「標籤載入失敗」（2026-11-24 審核 B-7）
      if (menu !== mine) return;
      const tags = (r && r.ok ? r.tags : []) || [];
      // v3.4.4：有打字時預設選第一個命中的標籤（底色標出），Enter 直接選它；上下鍵換（Jimmy 2026-11-25）
      let active = -1;
      const items = () => Array.from(list.querySelectorAll('.jr-tagmenu-item'));
      const mark = () => items().forEach((b, i) => b.classList.toggle('is-active', i === active));
      const draw = () => {
        const f = filterInput.value.trim().toLowerCase();
        active = -1;
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
        if (f) { active = 0; mark(); }
      };
      filterInput.addEventListener('input', draw);
      filterInput.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) return; // 注音 / 拼音選字中的 Enter、方向鍵不算
        const btns = items();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (!btns.length) return;
          e.preventDefault();
          active = e.key === 'ArrowDown' ? (active + 1) % btns.length : (active <= 0 ? btns.length - 1 : active - 1);
          mark();
          try { btns[active].scrollIntoView({ block: 'nearest' }); } catch (_) { /* jsdom */ }
        } else if (e.key === 'Enter') {
          if (active >= 0 && btns[active]) { e.preventDefault(); btns[active].click(); }
        }
      });
      draw();
    }
    ui.tags.addEventListener('click', () => { if (menu) closeTagMenu(); else openTagMenu(); });

    // ---- 快速鍵：Esc 離開搜尋結果（Jimmy 2026-11-24「搜尋結果按 esc 應該要返回」）----
    // 搜尋框裡的 Esc 原本就會（上面那支）；這支補「焦點不在搜尋框」的情況——點過資料夾 / 排序鈕、
    // 從文章退回 ?tab=search。右鍵選單、標籤選單、確認框、快速鍵說明自己處理 Esc（preventDefault /
    // stopImmediatePropagation）時不重複動作；其他輸入框（貼網址）裡不觸發
    doc.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !searching || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      escapeSearch();
    });

    // ---- 快速鍵：/ 聚焦搜尋（輸入框內不觸發） ----
    doc.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return; // 原本漏了 SELECT（各處各寫一份的 drift）
      e.preventDefault();
      setExpanded(true);
    });

    // 文章頁退出回 reader.html?tab=search：叫回上次的查詢。回 true＝已接手，feed 不必載入分頁
    function restoreSearch(search) {
      let tab = null;
      try { tab = new URLSearchParams(search || '').get('tab'); } catch (_) {}
      if (tab !== SEARCH_TAB) return false;
      let q = null;
      try { q = session ? session.getItem(LAST_SEARCH_KEY) : null; } catch (_) { q = null; }
      let t = null;
      try { t = session ? session.getItem(LAST_TAG_KEY) : null; } catch (_) { t = null; }
      if (!hasSearchable(q)) q = '';
      if (!q && !t) return false; // 只有標籤也叫回（標籤瀏覽，v3.2.5）
      let s = null;
      try { s = session ? session.getItem(LAST_SORT_KEY) : null; } catch (_) { s = null; }
      if (SORTS.some((x) => x.id === s)) { sortMode = s; renderSort(); }
      let f = null;
      try { f = session ? session.getItem(LAST_FOLDER_KEY) : null; } catch (_) { f = null; }
      if (FOLDERS.some((x) => x.id === f)) { folder = f; renderFolder(); }
      if (t) activeTag = t;
      ui.search.value = q;
      setExpanded(true, { focus: false });
      runSearch(q, false);
      return true;
    }

    return {
      ui,
      isPending: (id) => pendingIds.has(String(id)),
      hasPending: () => pendingIds.size > 0, // 清單自動更新等抓取結束再做（reader-feed autoRefresh）
      isSearching: () => searching,
      isExpanded: () => expanded,
      setExpanded,
      collapse,
      exitSearch,
      restoreSearch,
      submitUrl,
      runSearch,
      // 多選做完批次動作後重跑目前的查詢（同一頁、同排序與資料夾）
      refreshSearch: () => (current ? runSearch(current.q, false) : null),
      setTag,
      openTagMenu,
      closeTagMenu,
      activeTag: () => activeTag
    };
  }

  const api = {
    attach, highlightTerms, createResultCard, createPendingCard, settlePendingCard, pollUntilSettled,
    locationLabel, hasSearchable, buildToolbar,
    SEARCH_TAB, LAST_SEARCH_KEY, LAST_SORT_KEY, LAST_FOLDER_KEY, LAST_TAG_KEY, SEARCH_FROM_KEY, SORTS, FOLDERS, FAB_IDLE_MS, KB_MIN_PX, SEARCH_PAGE, POLL_MS, POLL_LIMIT_MS, SEARCH_DEBOUNCE_MS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.__JReadReaderLibrary = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
