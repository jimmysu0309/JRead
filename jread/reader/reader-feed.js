// JRead — Reader feed（v1.0.22）
//
// reader.html（擴充自有頁）的 feed 模式：列 Readwise inbox（location=new）最新
// 十篇。v2.4.0 起卡片不再有「封存」鈕（Jimmy 2026-11-07）：觸控左滑＝封存、右滑＝
// 加入 Later（Instapaper 為加星）；滑鼠右鍵開同樣兩項的選單。點卡片導到
// article.html?id=<docId> 用 JRead 版型閱讀。
//
// 純渲染 / 封存邏輯抽成可測函式（dual export：module.exports 給 jsdom spec、
// window.__JReadReaderFeed 給頁面）。init() 只在擴充頁環境（有 browser.storage）
// 跑——jsdom require 時不誤觸副作用。
(function (global) {
  'use strict';

  const MAX_ITEMS = 10;

  // v1.6.0：feed 來源分頁，per-service（儲存服務二擇一單一資料源）。reader.html 不再
  // 寫死三顆 tab，由 init() 依 FEED_TABS[service] 動態建立——切服務自動換分頁語意。
  // readwise：Inbox/Later 走 location、JRead 走 tag=jread；instapaper：未讀/已加星/
  // 封存走 folderId。query 由 PC.listDocuments 依 service 解讀（location|tag vs folderId）。
  //
  // v2.4.0 `later`：右滑 / 右鍵「稍後讀」在這個分頁的行為——'remove'＝成功後卡片離開
  // 本分頁（Inbox 移到 Later）、'keep'＝卡片留著只跳 toast（JRead 標籤 / Instapaper
  // 未讀加星後仍在原清單）、未設＝本分頁不提供（Later 本身 / 已加星 / 封存區）。
  const FEED_TABS = {
    readwise: [
      { id: 'new',   label: 'Inbox', query: { location: 'new' },   empty: '收件匣目前沒有文章', later: 'remove' },
      { id: 'later', label: 'Later', query: { location: 'later' }, empty: 'Later 目前沒有文章' },
      // tag 必須小寫：Readwise 每條 tag 存 key（小寫正規化，API filter 比對此值）+
      // name（顯示大小寫，如 'JRead'）；filter 走 key，故此處固定 'jread'——寫 'JRead'
      // 會匹配不到而撈空（2026-07-02 real-account reader_list_tags 實證 key=jread/name=JRead）。
      { id: 'jread', label: 'JRead', query: { tag: 'jread' },      empty: '沒有標記 jread 的文章', later: 'keep' }
    ],
    instapaper: [
      { id: 'unread',  label: '未讀',  query: { folderId: 'unread' },  empty: '未讀清單目前沒有文章', later: 'keep' },
      { id: 'starred', label: '已加星', query: { folderId: 'starred' }, empty: '沒有加星的文章' },
      // 2026-10-07 review F-11：已封存的清單不再提供「封存」動作（對已封存文章再
      // archive：成功 = 卡片從封存清單消失、使用者以為被刪）；`archivable: false`
      // 由 renderFeed / createCard 讀。Readwise 三個分頁都是未封存集合，預設可封存
      { id: 'archive', label: '封存',  query: { folderId: 'archive' }, empty: '封存區目前沒有文章', archivable: false }
    ]
  };

  // v2.4.0：「稍後讀」動作的文字，per-service。Instapaper 沒有 Later，右滑改加星
  //（Jimmy 2026-11-07 裁定）。swipe＝滑動時底下露出的標籤、menu＝右鍵選單項、done＝
  // 'keep' 分頁成功後的 toast
  const LATER_TEXT = {
    readwise:   { swipe: 'Later', menu: '加入 Later', done: '已加入 Later' },
    instapaper: { swipe: '加星',  menu: '加星',       done: '已加星' }
  };

  // 卡片副標：作者 · 來源（空欄略過，無前後贅分隔）。v1.0.24 起不顯示字數
  //（Jimmy 2026-06-27：word_count 中英文語意不一、雜訊）。
  function formatMeta(doc) {
    const parts = [];
    if (doc.author) parts.push(String(doc.author));
    if (doc.site_name) parts.push(String(doc.site_name));
    return parts.join('　·　');
  }

  // v1.6.0：把卡片的最小 metadata（title/author/site_name/published_date/source_url）
  // 編碼成 article.html 的 meta query param。Instapaper get_text 只回文章 HTML、無
  // metadata，靠此把 feed 已知的 metadata 帶進文章頁補 byline；Readwise 文章頁忽略
  // meta（憑 id 一次拿齊）。兩服務統一帶（路徑單一）。全空（只有 id）不帶、保持 URL
  // 精簡。用 encodeURIComponent(JSON) 而非 base64——對中文標題安全（btoa 只吃 Latin1）。
  function encodeMeta(doc) {
    const m = {};
    if (doc.title) m.title = String(doc.title);
    if (doc.author) m.author = String(doc.author);
    if (doc.site_name) m.site_name = String(doc.site_name);
    if (doc.published_date) m.published_date = String(doc.published_date);
    if (doc.source_url) m.source_url = String(doc.source_url);
    if (!Object.keys(m).length) return '';
    try { return encodeURIComponent(JSON.stringify(m)); } catch (_) { return ''; }
  }

  // 卡片可用動作。opts.archivable === false → 不可封存（F-11）；opts.later 為
  // 'remove' | 'keep' 才可稍後讀（FEED_TABS 的 later 欄位）
  function cardCaps(opts) {
    const o = opts || {};
    return {
      archive: o.archivable !== false,
      later: o.later === 'remove' || o.later === 'keep'
    };
  }

  // 建一張 feed 卡片：連結（縮圖 + 標題 + meta，導到 article.html?id=&meta=）疊在
  // 滑動底層（.jr-swipe-bg，左右兩側動作標籤）上方。doc 需含 id；缺 id 的不建
  //（回 null）。v2.2.10：opts.tabId 帶進 &tab=，文章頁退出時導回同一分頁
  //（之前一律回 reader.html = 第一個分頁，Later / JRead 讀完會被丟回 Inbox）。
  // v2.4.0：不再建「封存」鈕；可用動作寫在 data-actions（"archive later" 子集）
  function createCard(doc, document, opts) {
    if (!doc || !doc.id) return null;
    const caps = cardCaps(opts);
    const text = (opts && opts.laterText) || LATER_TEXT.readwise;
    const card = document.createElement('article');
    card.className = 'jr-card';
    card.setAttribute('data-doc-id', doc.id);
    card.setAttribute('data-actions', [caps.archive && 'archive', caps.later && 'later'].filter(Boolean).join(' '));

    if (caps.archive || caps.later) {
      const bg = document.createElement('div');
      bg.className = 'jr-swipe-bg';
      bg.setAttribute('aria-hidden', 'true');
      const left = document.createElement('span');
      left.className = 'jr-swipe-label jr-swipe-later';
      left.textContent = caps.later ? text.swipe : '';
      const right = document.createElement('span');
      right.className = 'jr-swipe-label jr-swipe-archive';
      right.textContent = caps.archive ? '封存' : '';
      bg.appendChild(left);
      bg.appendChild(right);
      card.appendChild(bg);
    }

    const link = document.createElement('a');
    link.className = 'jr-card-link';
    const metaEnc = encodeMeta(doc);
    const tabId = opts && opts.tabId;
    link.href = 'article.html?id=' + encodeURIComponent(doc.id) + (metaEnc ? '&meta=' + metaEnc : '')
      + (tabId ? '&tab=' + encodeURIComponent(tabId) : '');

    if (doc.image_url && /^https?:\/\//i.test(doc.image_url)) {
      const img = document.createElement('img');
      img.className = 'jr-thumb';
      img.src = doc.image_url;
      img.alt = '';
      img.loading = 'lazy';
      img.draggable = false;
      link.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'jr-card-body';
    const h2 = document.createElement('h2');
    h2.className = 'jr-card-title';
    h2.textContent = doc.title || '（無標題）';
    const meta = document.createElement('div');
    meta.className = 'jr-card-meta';
    meta.textContent = formatMeta(doc);
    body.appendChild(h2);
    body.appendChild(meta);
    link.appendChild(body);

    card.appendChild(link);
    return card;
  }

  // ---- 觸控滑動（v2.4.0）----
  // 只認 pointerType 'touch'（滑鼠拖曳不算，桌面走右鍵選單）。卡片 CSS
  // touch-action: pan-y：垂直捲動交給瀏覽器，水平位移才由這裡處理。先移動
  // SWIPE_DECIDE_PX 再判方向——垂直為主就放手（讓頁面捲動），水平為主才接管。
  const SWIPE_DECIDE_PX = 10;
  // 放手時位移超過門檻才執行（卡片寬 30%，夾在 72–140px：手機約 100px、桌面寬卡不用拖到半張）
  function swipeThreshold(width) {
    return Math.max(72, Math.min(140, (width || 0) * 0.3));
  }
  // 放手時要執行的動作：左滑（dx < 0）＝封存、右滑＝稍後讀；該方向沒有動作或沒過門檻 → null
  function swipeDecision(dx, width, caps) {
    const t = swipeThreshold(width);
    if (dx <= -t && caps.archive) return 'archive';
    if (dx >= t && caps.later) return 'later';
    return null;
  }
  // 卡片實際位移：沒有動作的方向給阻尼（最多 24px），拉得動一點但明顯拉不開
  function swipeOffset(dx, caps) {
    if ((dx < 0 && !caps.archive) || (dx > 0 && !caps.later)) {
      return Math.sign(dx) * Math.min(24, Math.abs(dx) * 0.2);
    }
    return dx;
  }

  function resetSwipe(card) {
    const link = card && card.querySelector('.jr-card-link');
    if (link) {
      link.style.transition = '';
      link.style.transform = '';
    }
    if (card) {
      card.removeAttribute('data-swipe');
      card.classList.remove('is-swiping', 'is-armed');
    }
  }

  // onCommit(kind) 在放手且過門檻時呼叫（卡片先滑出畫面再呼叫，見 SWIPE_OUT_MS）
  const SWIPE_OUT_MS = 180;
  function attachSwipe(card, caps, onCommit) {
    if (!caps.archive && !caps.later) return;
    const link = card.querySelector('.jr-card-link');
    if (!link) return;
    const win = card.ownerDocument && card.ownerDocument.defaultView;
    let st = null;
    let suppressClickUntil = 0;

    card.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || e.isPrimary === false) return;
      if (card.classList.contains('is-busy')) return;
      st = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, horizontal: false };
    });

    card.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id) return;
      const dx = e.clientX - st.x;
      const dy = e.clientY - st.y;
      if (!st.horizontal) {
        if (Math.abs(dx) < SWIPE_DECIDE_PX && Math.abs(dy) < SWIPE_DECIDE_PX) return;
        if (Math.abs(dx) <= Math.abs(dy)) { st = null; return; } // 垂直捲動，放手
        st.horizontal = true;
        try { card.setPointerCapture(e.pointerId); } catch (_) {}
        card.classList.add('is-swiping');
        link.style.transition = 'none';
      }
      if (e.cancelable) e.preventDefault();
      st.dx = dx;
      const off = swipeOffset(dx, caps);
      link.style.transform = 'translateX(' + off + 'px)';
      card.setAttribute('data-swipe', off < 0 ? 'archive' : (off > 0 ? 'later' : ''));
      card.classList.toggle('is-armed', !!swipeDecision(dx, card.clientWidth, caps));
    });

    const finish = (e) => {
      if (!st || e.pointerId !== st.id) return;
      const s = st;
      st = null;
      if (!s.horizontal) return;
      suppressClickUntil = Date.now() + 400; // 放手後瀏覽器可能補一發 click，別誤開文章
      const kind = e.type === 'pointercancel' ? null : swipeDecision(s.dx, card.clientWidth, caps);
      card.classList.remove('is-swiping');
      link.style.transition = 'transform ' + SWIPE_OUT_MS + 'ms ease';
      if (!kind) {
        link.style.transform = '';
        card.removeAttribute('data-swipe');
        card.classList.remove('is-armed');
        return;
      }
      link.style.transform = 'translateX(' + (s.dx < 0 ? '-' : '') + '100%)';
      const run = () => onCommit(kind);
      if (win && typeof win.setTimeout === 'function') win.setTimeout(run, SWIPE_OUT_MS);
      else run();
    };
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);

    card.addEventListener('click', (e) => {
      if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  // ---- 右鍵選單（v2.4.0，桌面滑鼠）----
  // 同一時間只有一個選單；點外面 / Esc / 捲動 / 視窗縮放或失焦即關
  let openMenu = null;
  function closeCardMenu() {
    if (!openMenu) return;
    const m = openMenu;
    openMenu = null;
    m.cleanup();
    if (m.el.parentNode) m.el.parentNode.removeChild(m.el);
    if (m.card) m.card.classList.remove('is-menu');
  }

  // items：[{ kind, label }]；onPick(kind)。回傳選單元素（測試用）
  function openCardMenu(card, x, y, items, onPick) {
    closeCardMenu();
    const document = card.ownerDocument;
    const win = document.defaultView;
    const el = document.createElement('div');
    el.className = 'jr-menu';
    el.setAttribute('role', 'menu');
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'jr-menu-item';
      b.setAttribute('role', 'menuitem');
      b.setAttribute('data-kind', it.kind);
      b.textContent = it.label;
      b.addEventListener('click', (e) => {
        e.preventDefault();
        closeCardMenu();
        onPick(it.kind);
      });
      el.appendChild(b);
    }
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    // 貼齊視窗邊：右 / 下放不下就往左 / 上翻
    const vw = win ? win.innerWidth : 0;
    const vh = win ? win.innerHeight : 0;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (vw && w && x + w > vw - 8) el.style.left = Math.max(8, x - w) + 'px';
    if (vh && h && y + h > vh - 8) el.style.top = Math.max(8, y - h) + 'px';
    card.classList.add('is-menu');

    const onDown = (e) => { if (!el.contains(e.target)) closeCardMenu(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeCardMenu(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const btns = Array.from(el.querySelectorAll('.jr-menu-item'));
        const i = btns.indexOf(document.activeElement);
        const n = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
        if (btns[n]) btns[n].focus();
      }
    };
    const onClose = () => closeCardMenu();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    if (win) {
      win.addEventListener('scroll', onClose, true);
      win.addEventListener('resize', onClose);
      win.addEventListener('blur', onClose);
    }
    openMenu = {
      el, card,
      cleanup() {
        document.removeEventListener('pointerdown', onDown, true);
        document.removeEventListener('keydown', onKey, true);
        if (win) {
          win.removeEventListener('scroll', onClose, true);
          win.removeEventListener('resize', onClose);
          win.removeEventListener('blur', onClose);
        }
      }
    };
    const first = el.querySelector('.jr-menu-item');
    if (first && typeof first.focus === 'function') first.focus();
    return el;
  }

  function attachContextMenu(card, caps, laterText, onPick) {
    const items = [];
    if (caps.later) items.push({ kind: 'later', label: laterText.menu });
    if (caps.archive) items.push({ kind: 'archive', label: '封存' });
    if (!items.length) return; // 沒動作的分頁保留瀏覽器原生選單（開新分頁 / 複製連結）
    card.addEventListener('contextmenu', (e) => {
      if (card.classList.contains('is-busy')) return;
      e.preventDefault();
      openCardMenu(card, e.clientX, e.clientY, items, onPick);
    });
  }

  // 渲染整個清單。docs 取前 MAX_ITEMS 篇。onAction(card, id, kind) 由 init 注入
  //（kind＝'archive' | 'later'，滑動與右鍵選單共用）；opts.archivable / opts.later /
  // opts.laterText 決定每張卡可用動作（F-11、v2.4.0）。
  function renderFeed(listEl, docs, onAction, opts) {
    closeCardMenu();
    listEl.textContent = '';
    const slice = (docs || []).slice(0, MAX_ITEMS);
    const caps = cardCaps(opts);
    const laterText = (opts && opts.laterText) || LATER_TEXT.readwise;
    let n = 0;
    for (const doc of slice) {
      const card = createCard(doc, listEl.ownerDocument, opts);
      if (!card) continue;
      if (typeof onAction === 'function') {
        const run = (kind) => onAction(card, doc.id, kind);
        attachSwipe(card, caps, run);
        attachContextMenu(card, caps, laterText, run);
      }
      listEl.appendChild(card);
      n++;
    }
    return n;
  }

  // 樂觀執行卡片動作。deps.remove !== false（封存 / 移出本分頁）：先把卡片從 DOM
  // 移除（記住位置），失敗插回原位 + toast；deps.remove === false（動作後仍留在本
  // 分頁）：卡片彈回、成功跳 deps.successToast。回傳最終結果（{ ok } 物件），便於測試。
  async function actionCard(card, id, deps) {
    const remove = deps.remove !== false;
    const parent = card.parentNode;
    const nextSibling = card.nextSibling;
    card.classList.add('is-busy');
    if (remove) { if (parent) parent.removeChild(card); } else resetSwipe(card);

    let result;
    try {
      result = await deps.actionFn({ id });
    } catch (e) {
      result = { ok: false, error: 'INTERNAL', message: String(e && e.message || e) };
    }
    card.classList.remove('is-busy');

    if (result && result.ok) {
      if (remove) {
        if (typeof deps.onEmpty === 'function' && parent && parent.children.length === 0) deps.onEmpty();
      } else if (deps.successToast && typeof deps.toastFn === 'function') {
        deps.toastFn(deps.successToast, 'success');
      }
      return result;
    }
    // 失敗：插回原位（滑出的位移歸零）+ toast。
    // v1.6.24：nextSibling 可能已不在 parent 內（相鄰卡片也在 in-flight 封存中被
    // 移除）——直接 insertBefore 會丟 NotFoundError、本卡既沒還原也沒 toast。
    // 參照失效時退回 append（位置可能略移，卡片不消失比較重要）。
    resetSwipe(card);
    if (remove && parent) {
      const ref = (nextSibling && nextSibling.parentNode === parent) ? nextSibling : null;
      parent.insertBefore(card, ref);
    }
    if (typeof deps.toastFn === 'function') deps.toastFn(archiveErrorMessage(result, deps.action), 'error');
    return result;
  }

  // 樂觀封存（actionCard 的封存特例；deps.archiveFn）
  function archiveCard(card, id, deps) {
    return actionCard(card, id, Object.assign({}, deps, { actionFn: deps.archiveFn, action: '封存', remove: true }));
  }

  // 2026-10-07 review F-10：錯誤碼 → 文案的單一資料源在 popup-core
  // `serviceErrorMessage(result, { action })`（本頁封存 / reader-article 載入共用，
  // 舊版兩頁各抄一張表、載入端還靠 `.replace('封存','載入')` 借用）。popup-core
  // 缺席（理論上不會：reader.html 先載）時退回最低限度的 generic 字串，不另帶碼表。
  function archiveErrorMessage(result, action) {
    const PC = global.__JReadPopup;
    const act = action || '封存';
    if (PC && typeof PC.serviceErrorMessage === 'function') return PC.serviceErrorMessage(result, { action: act });
    return `${act}失敗`;
  }

  // v2.2.10：reader.html?tab=<id> 指定初始分頁（文章頁退出帶回來的來源分頁）。
  // 不認得的 id（例如切換過儲存服務、舊網址）退回第一個分頁。
  function pickInitialTab(tabs, search) {
    let id = null;
    try { id = new URLSearchParams(search || '').get('tab'); } catch (_) {}
    return (id && tabs.find((t) => t.id === id)) || tabs[0];
  }

  const api = {
    formatMeta, encodeMeta, createCard, pickInitialTab, renderFeed, actionCard, archiveCard, archiveErrorMessage,
    swipeThreshold, swipeDecision, swipeOffset, openCardMenu, closeCardMenu,
    MAX_ITEMS, FEED_TABS, LATER_TEXT, SWIPE_OUT_MS
  };

  // ---- 頁面 bootstrap（只在擴充頁環境跑）----
  function init() {
    const browser = global.browser;
    const NS = global.__JRead;
    const PC = global.__JReadPopup;
    const doc = global.document;
    // 缺關鍵相依（理論上不會發生；iOS 載入順序 / 模組沒掛時 surface 出來，不靜默卡白）
    if (!browser || !browser.storage || !PC || !doc) {
      const m = doc && doc.getElementById('jr-msg');
      if (m) {
        m.hidden = false;
        m.textContent = 'Reader 初始化失敗（缺少：' +
          [!browser && 'browser', !(browser && browser.storage) && 'storage', !PC && 'popup-core'].filter(Boolean).join(' / ') + '）';
      }
      return;
    }

    const listEl = doc.getElementById('jr-list');
    const msgEl = doc.getElementById('jr-msg');

    function showMsg(text, isError) {
      if (listEl) listEl.textContent = '';
      if (!msgEl) return;
      msgEl.textContent = '';
      msgEl.hidden = false;
      msgEl.classList.toggle('jr-error', !!isError);
      // 允許含「進階設定」連結
      if (typeof text === 'string') msgEl.textContent = text;
      else if (text && text.nodeType) msgEl.appendChild(text);
    }
    // 成功渲染卡片時收起「載入中…」訊息
    function hideMsg() { if (msgEl) { msgEl.hidden = true; msgEl.textContent = ''; } }

    function toast(message, kind) {
      if (NS && NS.toast && typeof NS.toast.show === 'function') NS.toast.show(message, { kind });
    }

    // v1.6.0：讀設定（含儲存服務二擇一 + 兩服務憑證），resolveServiceCredentials
    // 決定走 readwise 或 instapaper。套主題底色（對齊閱讀模式 theme）。
    const DEF = global.__JReadSettingsDefaults || {};
    // v1.9.14：theme 讀有效值（這台裝置套用中的設定檔會蓋過 sync flat）
    const PROFILES = global.__JReadProfiles;
    const readSettings = (d) => (PROFILES ? PROFILES.readEffective(d) : browser.storage.sync.get(d));
    readSettings({
      theme: 'light',
      storageService: DEF.storageService || 'readwise',
      readwiseToken: '',
      instapaperToken: '',
      instapaperTokenSecret: ''
    }).then((s) => {
      if (s && s.theme) doc.documentElement.setAttribute('data-theme', s.theme);
      const { service, creds, ok } = PC.resolveServiceCredentials(s);
      if (!ok) {
        const span = doc.createElement('span');
        // v2.2.5：iOS App 內建 JReader 的憑證來自 App Group 鏡像，鏡像要等 Safari 擴充的
        // background 跑過一次（lib/app-sync.js pull 時把本機設定推上去）才有資料——新裝置
        // 第一次開 App 必然走到這裡，App 也叫不醒擴充（Jimmy 2026-10-28 回報）。提示改成
        // 實際可行的動作，並每 3 秒重讀鏡像：憑證一到 shim onForeground 就整頁重載
        // （Split View / 台前調度切 Safari 不一定觸發 App 的回前景通知，不能只靠它）
        if (NS && typeof NS.isAppRuntime === 'function' && NS.isAppRuntime()) {
          span.textContent = '還沒收到 Safari 擴充的設定：請到 Safari 開任一網頁讓 JRead 同步，回到這裡就會自動載入'
            + '（若 Safari 擴充也還沒填憑證，請先到擴充功能的進階設定填入）';
          showMsg(span, true);
          const app = global.__jreadApp;
          if (app && typeof app.onForeground === 'function') setInterval(() => { app.onForeground(); }, 3000);
          return;
        }
        span.textContent = service === 'instapaper'
          ? '尚未連結 Instapaper 帳號，請到擴充功能的進階設定連結後再開啟 Reader'
          : '尚未設定 Readwise token，請到擴充功能的進階設定填入後再開啟 Reader';
        showMsg(span, true);
        return;
      }

      const tabs = FEED_TABS[service] || FEED_TABS.readwise;

      // v1.10.1：本機快取（reader-cache.js）。先畫上次的清單、背景抓新的再替換；
      // 快取模組缺席時照舊只走 API。
      const RC = global.__JReadReaderCache;
      const local = browser.storage.local;
      const account = RC ? RC.accountKey(service, creds) : '';
      // 本頁移走過（含進行中）的 id → 影響範圍：'*'＝所有分頁（封存）、或某個 listKey
      //（Inbox 右滑移到 Later 只離開 Inbox）。背景抓回來的清單可能還沒反映，重畫時濾掉
      const removedIds = new Map();
      const laterText = LATER_TEXT[service] || LATER_TEXT.readwise;

      function showDocs(all, cfg) {
        const listKey = service + ':' + cfg.id;
        const docs = (all || []).filter((d) => {
          if (!d) return false;
          const k = removedIds.get(d.id);
          return !(k === '*' || k === listKey);
        });
        if (!docs.length) {
          showMsg(cfg.empty, false);
          return;
        }
        const onAction = (card, id, kind) => {
          const isArchive = kind === 'archive';
          const remove = isArchive || cfg.later === 'remove';
          const scope = isArchive ? '*' : listKey;
          if (remove) removedIds.set(id, scope);
          actionCard(card, id, {
            actionFn: isArchive
              ? ({ id }) => PC.archiveDocument({ service, creds, id })
              : ({ id }) => PC.laterDocument({ service, creds, id }),
            action: isArchive ? '封存' : laterText.menu,
            remove,
            successToast: isArchive ? null : laterText.done,
            toastFn: toast,
            onEmpty: () => showMsg(cfg.empty, false)
          }).then((r) => {
            if (r && r.ok) {
              if (remove && RC) RC.removeFromFeed(local, account, id, isArchive ? undefined : listKey);
            } else if (remove && removedIds.get(id) === scope) {
              removedIds.delete(id);
            }
          });
        };
        hideMsg();
        renderFeed(listEl, docs, onAction, {
          archivable: cfg.archivable !== false, later: cfg.later, laterText, tabId: cfg.id
        });
      }

      // 載入某個分頁的清單（服務無關，走 PC.listDocuments dispatcher）。
      // v1.6.24：世代 token 防 race——快速切分頁時前一發慢回應晚到，若不丟棄會
      // 蓋掉新分頁已渲染的內容（畫面內容與分頁 highlight 不一致）。
      let loadGen = 0;
      let currentTab = null;
      // v2.2.13：回傳 Promise，API 結果處理完（成功 / 失敗 / 過期丟棄）才 resolve——
      // iOS App 下拉更新的原生 spinner 等它收起（refreshCurrent）。
      // opts.refresh：下拉更新——畫面上已有清單，不清成「載入中…」、不先畫快取
      // （spinner 就是 loading 提示），只等新資料替換
      function loadList(tab, opts) {
        const cfg = tab || tabs[0];
        const refresh = !!(opts && opts.refresh);
        currentTab = cfg;
        const gen = ++loadGen;
        const listKey = service + ':' + cfg.id;
        let freshArrived = false;
        let cachedSig = null;  // 非 null = 畫面上是快取版本
        if (!refresh) showMsg('載入中…', false);

        const cacheRead = RC ? RC.readFeed(local, account, listKey) : Promise.resolve(null);
        cacheRead.then((docs) => {
          if (gen !== loadGen || freshArrived || !docs) return;
          if (refresh) { cachedSig = RC.feedSignature(docs); return; } // 畫面已是這份，只記簽章
          cachedSig = RC.feedSignature(docs);
          showDocs(docs, cfg);
        });

        // 有快取時，背景更新失敗只跳 toast、不把清單換成錯誤訊息。API 可能比讀快取
        // 還早失敗（離線時 fetch 當場 reject）——先等快取讀完再決定，離線才看得到清單
        const fail = (withCache, withoutCache) => {
          cacheRead.then((docs) => {
            if (gen !== loadGen) return;
            if (docs) {
              if (cachedSig === null) { cachedSig = RC.feedSignature(docs); showDocs(docs, cfg); }
              toast(withCache, 'error');
            } else {
              showMsg(withoutCache, true);
            }
          });
        };

        return PC.listDocuments({ service, creds, query: cfg.query }).then((r) => {
          if (gen !== loadGen) return; // 已切到別的分頁——過期回應丟棄
          freshArrived = true;
          if (!r || !r.ok) {
            fail(archiveErrorMessage(r, '更新清單'), archiveErrorMessage(r, '載入'));
            return;
          }
          const docs = (r.results || []).slice(0, MAX_ITEMS);
          if (RC) RC.writeFeed(local, account, listKey, docs, MAX_ITEMS);
          if (cachedSig !== null && RC.feedSignature(docs) === cachedSig) return; // 沒變，不重畫
          showDocs(docs, cfg);
        }, (err) => {
          if (gen !== loadGen) return; // 過期回應丟棄（同上）
          freshArrived = true;
          // list fetch reject（iOS 偶發）：surface 出來，不要卡在「載入中…」
          const detail = String(err && err.message || err);
          fail('更新清單失敗：' + detail, '載入失敗：' + detail);
        });
      }

      // v1.6.0：依 FEED_TABS[service] 動態建分頁（取代 reader.html 寫死的三顆）。
      const initialTab = pickInitialTab(tabs, global.location && global.location.search);
      const tabsEl = doc.getElementById('jr-tabs');
      if (tabsEl) {
        tabsEl.textContent = '';
        tabs.forEach((tab) => {
          const btn = doc.createElement('button');
          btn.className = 'jr-tab' + (tab === initialTab ? ' is-active' : '');
          btn.type = 'button';
          btn.setAttribute('data-src', tab.id);
          btn.textContent = tab.label;
          tabsEl.appendChild(btn);
        });
        tabsEl.addEventListener('click', (e) => {
          const t = e.target && e.target.closest && e.target.closest('.jr-tab');
          if (!t) return;
          const all = tabsEl.querySelectorAll('.jr-tab');
          for (const x of all) x.classList.toggle('is-active', x === t);
          const picked = tabs.find((tb) => tb.id === t.getAttribute('data-src'));
          // 網址同步目前分頁：重新整理 / 上一頁回到這裡時停在同一分頁
          try { global.history.replaceState(null, '', 'reader.html?tab=' + encodeURIComponent(picked.id)); } catch (_) {}
          loadList(picked);
        });
      }

      loadList(initialTab);  // ?tab= 指定的分頁，沒指定 = 第一個
      // v2.2.13：下拉更新入口（iOS App ViewController 的 UIRefreshControl 呼叫）
      api.refreshCurrent = () => loadList(currentTab, { refresh: true });
    }).catch((err) => {
      showMsg('讀取設定失敗：' + String(err && err.message || err), true);
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.__JReadReaderFeed = api;
    // 頁面環境：DOM ready 後 init
    if (global.document) {
      if (global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
