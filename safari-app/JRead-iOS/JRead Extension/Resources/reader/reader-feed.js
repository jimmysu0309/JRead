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

  // 2026-11-15 review D-06：分頁表正本搬到 reader-cache.js（reader.html 與
  // article.html 都載）——文章頁的 E 鍵封存要查來源分頁可不可封存，不能各寫一份。
  // 本檔只引用；jsdom spec 以 require 載入時沒有頁面全域，改 require 同一份。
  const RC_MOD = global.__JReadReaderCache ||
    (typeof module !== 'undefined' && module.exports && typeof require === 'function'
      ? require('./reader-cache.js') : null);
  const FEED_TABS = (RC_MOD && RC_MOD.FEED_TABS) || { readwise: [], instapaper: [] };
  const formatDay = (RC_MOD && RC_MOD.formatDay) || (() => '');
  const locationLabel = (RC_MOD && RC_MOD.locationLabel) || (() => '');

  // v3.1.0：「載入更多」每次多顯示幾篇（第一屏仍是 MAX_ITEMS，快取也只存第一屏）
  const MORE_STEP = 20;

  // v3.1.0：垃圾桶動作（右鍵選單 kind → popup-core 函式 / 錯誤文案的動詞 / 成功提示）
  // 完成提示文字的正本在 reader-cache ACTION_DONE（清單、搜尋結果、多選、文章資訊面板共用）
  const DONE = (RC_MOD && RC_MOD.ACTION_DONE) || {};
  const TRASH_ACTIONS = {
    trash: { fn: 'trashJReaderDocument', action: '刪除', done: DONE.trash },
    restore: { fn: 'restoreJReaderDocument', action: '還原', done: DONE.restore },
    purge: { fn: 'purgeJReaderDocument', action: '永久刪除', done: DONE.purge }
  };
  // 確認文案的正本在 reader-dialog.js（文章資訊面板也用）
  const DIALOG_MOD = global.__JReadReaderDialog ||
    (typeof module !== 'undefined' && module.exports && typeof require === 'function' ? require('./reader-dialog.js') : null);
  function trashConfirmText(kind, doc, count, days) {
    return DIALOG_MOD && typeof DIALOG_MOD.trashConfirmText === 'function' ? DIALOG_MOD.trashConfirmText(kind, doc, count, days) : null;
  }

  // v3.1.0：Later / 封存區的「移回 Inbox」（FEED_TABS 的 inbox 欄位）
  const INBOX_TEXT = { swipe: 'Inbox', menu: '移回 Inbox', done: DONE.inbox };

  // v2.4.0：「稍後讀」動作的文字，per-service。Instapaper 沒有 Later，右滑改加星
  //（Jimmy 2026-11-07 裁定）。swipe＝滑動時底下露出的標籤、menu＝右鍵選單項、done＝
  // 'keep' 分頁成功後的 toast
  const LATER_TEXT = {
    readwise:   { swipe: 'Later', menu: '加入 Later', done: DONE.later },
    jreader:    { swipe: 'Later', menu: '加入 Later', done: DONE.later },
    instapaper: { swipe: '加星',  menu: '加星',       done: '已加星' }
  };

  // 卡片副標：作者 · 來源（空欄略過，無前後贅分隔）。v1.0.24 起不顯示字數
  //（Jimmy 2026-06-27：word_count 中英文語意不一、雜訊）。
  // v3.1.0：沒有網站名稱時用原文網址的網域（Readwise 匯入的文章約兩成沒有 site_name，
  // 卡片只剩作者、看不出是哪個網站）；作者與網站相同（大小寫不計）只列一次
  const hostOf = (RC_MOD && RC_MOD.hostOf) || (() => '');
  function formatMeta(doc) {
    const parts = [];
    const author = doc.author ? String(doc.author) : '';
    const site = doc.site_name ? String(doc.site_name) : hostOf(doc.source_url);
    if (author) parts.push(author);
    if (site && site.toLowerCase() !== author.toLowerCase()) parts.push(site);
    return parts.join('　·　');
  }

  // v3.1.0：卡片日期。有發布日期就用；沒有改用存入日期並標明「存入」（不把存入日期當成發布日期）
  // mode 'saved'：一律顯示存入日期（搜尋依「最新 / 最舊」排序時，排序依據是存入日期，卡片要對得上）
  function formatCardDate(doc, mode) {
    const saved = formatDay(doc && (doc.saved_at || doc.created_at));
    if (mode === 'saved' && saved) return '存入 ' + saved;
    const pub = formatDay(doc && doc.published_date);
    if (pub) return pub;
    return saved ? '存入 ' + saved : '';
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
  // v3.1.0：inbox＝可移回 Inbox（FEED_TABS 的 inbox 欄位）。右滑的動作：有稍後讀就是稍後讀，
  // 沒有才是移回 Inbox（Later / 封存區）
  function cardCaps(opts) {
    const o = opts || {};
    const later = o.later === 'remove' || o.later === 'keep';
    const inbox = o.inbox === 'remove' || o.inbox === 'keep';
    return {
      archive: o.archivable !== false,
      later,
      inbox,
      right: later ? 'later' : (inbox ? 'inbox' : null),
      // v3.1.0：垃圾桶。一般分頁右鍵有「刪除」（移到垃圾桶）；垃圾桶裡是「還原 / 永久刪除」。都不掛滑動
      trash: !!o.deletable && !o.trash,
      restore: !!o.trash,
      purge: !!o.trash
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
    card.setAttribute('data-actions', [caps.archive && 'archive', caps.later && 'later', caps.inbox && 'inbox'].filter(Boolean).join(' '));

    if (caps.archive || caps.right) {
      const bg = document.createElement('div');
      bg.className = 'jr-swipe-bg';
      bg.setAttribute('aria-hidden', 'true');
      const left = document.createElement('span');
      left.className = 'jr-swipe-label jr-swipe-later';
      left.textContent = caps.right === 'later' ? text.swipe : (caps.right === 'inbox' ? INBOX_TEXT.swipe : '');
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
    // v3.1.0：副標＝作者 · 網站 · 日期。日期另放一個不截斷的 span，作者網站太長時截的是前段
    const meta = document.createElement('div');
    meta.className = 'jr-card-meta';
    // v3.1.0：清單混了不同資料夾時（搜尋結果、Progress 分頁）副標最前面標出資料夾
    const loc = opts && opts.showLocation ? locationLabel(doc.location) : '';
    if (loc) {
      const badge = document.createElement('span');
      badge.className = 'jr-loc-badge';
      badge.setAttribute('data-loc', doc.location === 'shortlist' ? 'later' : String(doc.location));
      badge.textContent = loc;
      meta.appendChild(badge);
    }
    const src = document.createElement('span');
    src.className = 'jr-card-src';
    src.textContent = formatMeta(doc);
    meta.appendChild(src);
    const day = formatCardDate(doc, opts && opts.dateMode);
    if (day) {
      const dt = document.createElement('span');
      dt.className = 'jr-card-date';
      dt.textContent = (src.textContent ? '　·　' : '') + day;
      meta.appendChild(dt);
    }
    body.appendChild(h2);
    body.appendChild(meta);
    // v3.1.0：摘要（最多兩行，CSS 截斷）
    if (doc.summary) {
      const sm = document.createElement('div');
      sm.className = 'jr-card-summary';
      sm.textContent = String(doc.summary);
      body.appendChild(sm);
    }
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
  // 放手時要執行的動作：左滑（dx < 0）＝封存、右滑＝稍後讀（Later / 封存區是移回 Inbox，
  // caps.right）；該方向沒有動作或沒過門檻 → null
  function rightKind(caps) {
    return caps.right !== undefined ? caps.right : (caps.later ? 'later' : null);
  }
  function swipeDecision(dx, width, caps) {
    const t = swipeThreshold(width);
    if (dx <= -t && caps.archive) return 'archive';
    if (dx >= t && rightKind(caps)) return rightKind(caps);
    return null;
  }
  // 卡片實際位移：沒有動作的方向給阻尼（最多 24px），拉得動一點但明顯拉不開
  function swipeOffset(dx, caps) {
    if ((dx < 0 && !caps.archive) || (dx > 0 && !rightKind(caps))) {
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
    if (!caps.archive && !rightKind(caps)) return;
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
      if (it.danger) b.classList.add('is-danger');
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

  // v3.1.0：每張卡片能做的動作（與右鍵選單同一份）——清單鍵盤操作（attachKeyboardNav）用。
  // 一般分頁、搜尋結果、同作者 / 同網域都經 attachContextMenu 登記，鍵盤與右鍵不會各算一套
  const CARD_ACTIONS = new WeakMap(); // card → { kinds: Set, pick(kind) }
  // 「焦點在可打字的元素裡」：單一資料源 NS.isTextInputTarget（content/namespace.js，看穿開放式 shadow root）。
  // reader 頁都有載 namespace.js；拿不到 NS（理論上不會）就當不在輸入
  function isTyping(t) {
    const N = global.__JRead;
    return !!(N && typeof N.isTextInputTarget === 'function' && N.isTextInputTarget(t));
  }

  // v3.1.0：清單多選（reader-select.js，JReader 才有）。有它時卡片右鍵多一項「選取」
  let selectHook = null;

  // 沒有任何動作時右鍵保留瀏覽器原生選單；有「刪除」等選單項時才接管
  // v3.1.0：有原始網址就多一項「開啟原始網址」（排第一個、不經 onPick，本頁直接開新分頁），所有服務都有
  function attachContextMenu(card, caps, laterText, onPick, doc) {
    const items = [];
    const RCM = global.__JReadReaderCache;
    const win = card.ownerDocument && card.ownerDocument.defaultView;
    const hasSource = !!(doc && RCM && typeof RCM.sourceUrlOf === 'function' && RCM.sourceUrlOf(doc));
    if (hasSource) items.push({ kind: 'source', label: '開啟原始網址' });
    if (caps.later) items.push({ kind: 'later', label: laterText.menu });
    if (caps.inbox) items.push({ kind: 'inbox', label: INBOX_TEXT.menu });
    if (caps.archive) items.push({ kind: 'archive', label: '封存' });
    if (caps.restore) items.push({ kind: 'restore', label: '還原' });
    if (selectHook) items.push({ kind: 'select', label: '選取' });
    if (caps.trash) items.push({ kind: 'trash', label: '刪除', danger: true });
    if (caps.purge) items.push({ kind: 'purge', label: '永久刪除', danger: true });
    if (!items.length) return; // 沒動作的分頁保留瀏覽器原生選單（開新分頁 / 複製連結）
    const pick = (kind) => {
      if (kind === 'source') { RCM.openSourceUrl(win, doc); return undefined; }
      if (kind === 'select') { if (selectHook) selectHook.start(card); return undefined; }
      return onPick(kind);
    };
    CARD_ACTIONS.set(card, { kinds: new Set(items.map((it) => it.kind)), pick });
    card.addEventListener('contextmenu', (e) => {
      if (card.classList.contains('is-busy')) return;
      e.preventDefault();
      openCardMenu(card, e.clientX, e.clientY, items, pick);
    });
  }

  // 渲染整個清單。docs 取前 MAX_ITEMS 篇。onAction(card, id, kind) 由 init 注入
  //（kind＝'archive' | 'later'，滑動與右鍵選單共用）；opts.archivable / opts.later /
  // opts.laterText 決定每張卡可用動作（F-11、v2.4.0）。
  function renderFeed(listEl, docs, onAction, opts) {
    closeCardMenu();
    listEl.textContent = '';
    const slice = (docs || []).slice(0, (opts && opts.limit) || MAX_ITEMS);
    const caps = cardCaps(opts);
    const laterText = (opts && opts.laterText) || LATER_TEXT.readwise;
    let n = 0;
    for (const doc of slice) {
      const card = createCard(doc, listEl.ownerDocument, opts);
      if (!card) continue;
      if (typeof onAction === 'function') {
        const run = (kind) => onAction(card, doc.id, kind, doc);
        attachSwipe(card, caps, run);
        attachContextMenu(card, caps, laterText, run, doc);
      }
      listEl.appendChild(card);
      n++;
    }
    return n;
  }

  // 樂觀執行卡片動作。deps.remove !== false（封存 / 移出本分頁）：先把卡片從 DOM
  // 移除（記住位置），失敗插回原位 + toast；deps.remove === false（動作後仍留在本
  // 分頁）：卡片彈回、成功跳 deps.successToast。回傳最終結果（{ ok } 物件），便於測試。
  //
  // 2026-11-15 review D-03：deps.isCurrent()（選填）——結果回來時「發動當下那個分頁
  // 的清單還在畫面上嗎」。#jr-list 是所有分頁共用的同一個元素，切走後 parent 仍是它，
  // 所以不能靠 parent 判斷。回 false 時只做資料面（回傳結果、失敗 toast），不把卡片
  // 插回、不呼叫 onEmpty——否則 Inbox 的卡片會被 append 到 Later 清單、或舊分頁的
  // 「清單已空」文案蓋掉新分頁的「載入中…」。沒給 isCurrent ＝ 一律視為還在。
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
    const current = typeof deps.isCurrent !== 'function' || deps.isCurrent() !== false;

    if (result && result.ok) {
      if (!current) return result;
      if (remove) {
        if (typeof deps.onEmpty === 'function' && parent && parent.children.length === 0) deps.onEmpty();
        // v3.1.0：垃圾桶動作卡片離開後也要提示（稍後讀 / 封存照舊不跳，行為不變）
        if (deps.toastOnRemove && deps.successToast && typeof deps.toastFn === 'function') deps.toastFn(deps.successToast, 'success');
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
    if (remove && parent && current) {
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
  // v3.1.0：清單鍵盤操作（Jimmy 2026-11-24）。J / K 下一張 / 上一張（選到的卡片有外框、捲進畫面）、
  // Enter 打開、E 封存、L 加入 Later（Instapaper：加星）、V 開啟原始網址。能不能做照卡片的右鍵選單
  //（CARD_ACTIONS）：封存區沒有 E、沒有原始網址沒有 V。動作讓卡片離開清單時選取移到下一張。
  // 輸入框裡、選字中、帶修飾鍵、事件已被別人處理（右鍵選單、確認框、快速鍵說明開著）都不收
  const KB_KEYS = { j: 'next', k: 'prev', enter: 'open', e: 'archive', l: 'later', v: 'source' };
  function attachKeyboardNav(listEl, doc) {
    if (!listEl || !doc) return null;
    let selId = null;
    const cards = () => Array.from(listEl.querySelectorAll('.jr-card[data-doc-id]:not(.jr-pending)'));
    const find = (id) => (id == null ? null : cards().find((c) => c.getAttribute('data-doc-id') === id) || null);
    function select(card) {
      for (const c of listEl.querySelectorAll('.jr-card.is-kb')) c.classList.remove('is-kb');
      selId = card ? card.getAttribute('data-doc-id') : null;
      if (!card) return;
      card.classList.add('is-kb');
      try { card.scrollIntoView({ block: 'nearest' }); } catch (_) { /* jsdom */ }
    }
    // 清單重畫（背景更新、換分頁、搜尋）後卡片是新的：選到的那篇還在就補回外框
    const MO = doc.defaultView && doc.defaultView.MutationObserver;
    if (MO) {
      new MO(() => {
        const c = find(selId);
        if (c && !c.classList.contains('is-kb')) c.classList.add('is-kb');
      }).observe(listEl, { childList: true });
    }
    function onKey(e) {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (openMenu) return; // 右鍵選單開著：鍵盤歸選單（上下鍵、Esc）
      const t = e.target;
      const tag = t && t.tagName;
      if (isTyping(t)) return;
      const cmd = KB_KEYS[String(e.key || '').toLowerCase()];
      if (!cmd) return;
      // 焦點在按鈕上（點過分頁鈕、排序鈕後焦點留在那裡）：字母鍵照收，Enter 留給按鈕本身
      // （原本整個略過，點完分頁 J / K 就失效——2026-11-24 審核 A-9）
      if (tag === 'BUTTON' && cmd === 'open') return;
      // 多選中只收移動（J / K）；勾選用 X（reader-select），單篇動作暫停
      if (selectHook && selectHook.isActive() && cmd !== 'next' && cmd !== 'prev') return;
      const list = cards();
      if (!list.length) return;
      const cur = find(selId);
      if (cmd === 'next' || cmd === 'prev') {
        e.preventDefault();
        const i = cur ? list.indexOf(cur) : -1;
        select(cmd === 'next' ? list[Math.min(list.length - 1, i + 1)] : list[Math.max(0, i - 1)]);
        return;
      }
      if (!cur) return; // 還沒選卡片：Enter / E / L / V 不動作
      if (cmd === 'open') {
        e.preventDefault();
        const a = cur.querySelector('a.jr-card-link');
        if (a) a.click();
        return;
      }
      const act = CARD_ACTIONS.get(cur);
      if (!act || !act.kinds.has(cmd)) return;
      e.preventDefault();
      // 動作後卡片可能離開清單：先記下一張（沒有下一張就上一張）
      const i = list.indexOf(cur);
      const after = list[i + 1] || list[i - 1] || null;
      const afterId = after ? after.getAttribute('data-doc-id') : null;
      const curId = selId;
      Promise.resolve(act.pick(cmd)).catch(() => {}).then(() => {
        if (selId !== curId) return;
        select(find(curId) || find(afterId));
      });
    }
    doc.addEventListener('keydown', onKey);
    return { select, selectedId: () => selId, onKey };
  }

  function pickInitialTab(tabs, search) {
    let id = null;
    try { id = new URLSearchParams(search || '').get('tab'); } catch (_) {}
    return (id && tabs.find((t) => t.id === id)) || tabs[0];
  }

  const api = {
    formatMeta, formatCardDate, encodeMeta, createCard, cardCaps, attachKeyboardNav, KB_KEYS, trashConfirmText, TRASH_ACTIONS, pickInitialTab, renderFeed, actionCard, archiveCard, archiveErrorMessage,
    swipeThreshold, swipeDecision, swipeOffset, openCardMenu, closeCardMenu,
    MAX_ITEMS, MORE_STEP, FEED_TABS, LATER_TEXT, INBOX_TEXT, SWIPE_OUT_MS
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

    // v2.5.4：被第三方頁面用 iframe 嵌入時不載入（判定住 reader-cache.js）
    const RCG = global.__JReadReaderCache;
    if (RCG && RCG.isEmbeddedFrame(global)) {
      const m = doc.getElementById('jr-msg');
      if (m) { m.hidden = false; m.textContent = RCG.EMBEDDED_TEXT; }
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
    // v3.1.0：文章頁做完動作跳回來（E 鍵封存）留下的提示，顯示一次
    const RCN = global.__JReadReaderCache;
    if (RCN && typeof RCN.takeFeedNotice === 'function') {
      let session = null;
      try { session = global.sessionStorage; } catch (_) { session = null; }
      const notice = RCN.takeFeedNotice(session);
      if (notice) toast(notice.message, notice.kind);
    }

    readSettings(PC.serviceSettingsQuery({
      theme: DEF.theme || 'gray' // review D-05：同 reader-article.js，預設主題讀單一資料源
    })).then((s) => {
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
          : service === 'jreader'
            ? '尚未設定 JReader 網址與 token，請到擴充功能的進階設定填入後再開啟 Reader'
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
      // 本頁移走過（含進行中）的 id → 影響範圍：'*'＝所有分頁（封存、永久刪除）、或某個 listKey
      //（Inbox 右滑移到 Later 只離開 Inbox、從垃圾桶還原只離開垃圾桶）、或 EXCEPT_PREFIX + listKey＝
      // 除了那個分頁以外全部（移到垃圾桶：只該出現在垃圾桶）。背景抓回來的清單可能還沒反映，重畫時濾掉
      const removedIds = new Map();
      // 垃圾桶保留天數（最近畫出的清單裡文件帶的 trash_keep_days；舊版 JReader 沒有時 30）。
      // 垃圾桶說明、刪除確認文案（含多選）讀它
      let keepDays = (RC && RC.TRASH_KEEP_DAYS_FALLBACK) || 30;
      const trashNoteText = () => '放超過 ' + keepDays + ' 天的文章會自動永久刪除';
      const EXCEPT_PREFIX = '*except:';
      const hiddenIn = (k, listKey) => k === '*' || k === listKey ||
        (typeof k === 'string' && k.startsWith(EXCEPT_PREFIX) && k !== EXCEPT_PREFIX + listKey);
      const laterText = LATER_TEXT[service] || LATER_TEXT.readwise;

      // v3.1.0：JReader 書庫工具列（reader-library.js）。標籤篩選疊在分頁的 query 上；
      // 分頁本身已篩某個標籤（JRead 分頁）時 API 只收一個 tag，改在回來的清單上再篩一次。
      // 篩選中的清單用獨立的快取 key，不蓋掉分頁原本的快取
      let tagFilter = null;
      let lib = null;
      const tagKeyOf = (doc) => (doc && doc.tags && typeof doc.tags === 'object' ? Object.keys(doc.tags) : [])
        .map((k) => k.toLowerCase());
      function listKeyFor(cfg) {
        return service + ':' + cfg.id + (tagFilter ? '#' + tagFilter.toLowerCase() : '');
      }
      // 本頁移走的文章「不該出現在哪些分頁」以分頁為單位、不含標籤篩選：原本用 listKeyFor，在標籤篩選中
      // 刪除的文章記成「除了『垃圾桶#標籤』以外都藏」，換掉篩選後垃圾桶裡也看不到它（2026-11-24 審核 A-11）。
      // 快取 key 照舊用 listKeyFor（篩選中的清單有自己的快取）
      function scopeKeyFor(cfg) {
        return service + ':' + cfg.id;
      }
      function queryFor(cfg) {
        if (!tagFilter || (cfg.query && cfg.query.tag)) return cfg.query;
        return Object.assign({}, cfg.query, { tag: tagFilter });
      }
      function postFilter(docs, cfg) {
        if (!tagFilter || !(cfg.query && cfg.query.tag)) return docs;
        const k = tagFilter.toLowerCase();
        return (docs || []).filter((d) => tagKeyOf(d).includes(k));
      }
      function emptyText(cfg) {
        return tagFilter ? '沒有標記「' + tagFilter + '」的文章' : cfg.empty;
      }

      // v2.5.5：畫面上這份清單的來源（未過濾的整份 docs＋分頁設定＋當下的分頁世代）。
      // 動作失敗晚到時用它原地重畫（見 onAction 的 .then）
      let shown = null;
      function showDocs(all, cfg) {
        shown = { all, cfg, gen: tabGen };
        const listKey = listKeyFor(cfg);
        const scopeKey = scopeKeyFor(cfg);
        if (RC && (all || []).some((d) => d && d.trash_keep_days != null)) keepDays = RC.trashKeepDays(all);
        if (trashNoteEl) trashNoteEl.textContent = trashNoteText();
        const docs = postFilter(all, cfg).filter((d) => {
          if (!d) return false;
          if (lib && lib.isPending(d.id)) return false; // 抓取中的那張由工具列畫
          return !hiddenIn(removedIds.get(d.id), scopeKey);
        });
        if (!docs.length) {
          showMsg(emptyText(cfg), false);
          return;
        }
        // v3.1.0：同作者 / 同網域的子清單跨各資料夾——右鍵選單依每張卡自己的資料夾（同搜尋結果），不掛滑動。
        // 搬資料夾：換掉這篇再重畫（資料夾標籤更新）；刪除：記成「只在垃圾桶出現」再重畫
        if (cfg.perDocMenu) {
          hideMsg();
          renderFeed(listEl, docs, null, { showLocation: true, tabId: cfg.id, limit: paging.limit });
          const byId = new Map(docs.map((d) => [String(d.id), d]));
          const trashCfg = tabs.find((t) => t.trash);
          for (const card of listEl.querySelectorAll('.jr-card[data-doc-id]')) {
            const d = byId.get(card.getAttribute('data-doc-id'));
            if (!d) continue;
            attachResultMenu(card, d, {
              changed: (nd) => {
                if (!shown || shown.cfg !== cfg) return;
                if (!nd) {
                  removedIds.set(d.id, trashCfg ? EXCEPT_PREFIX + scopeKeyFor(trashCfg) : '*');
                  if (typeof subCount === 'number') { subCount = Math.max(0, subCount - 1); renderHeadCount(); }
                }
                showDocs(nd ? shown.all.map((x) => (x && x.id === nd.id ? nd : x)) : shown.all, cfg);
              }
            });
          }
          updateMore(docs.length);
          return;
        }
        const onAction = async (card, id, kind, docItem) => {
          // v3.1.0：垃圾桶相關動作先確認（Jimmy：「刪除要確認」），取消就什麼都不做
          if (kind === 'trash' || kind === 'purge' || kind === 'restore') {
            if (!(await confirmTrashAction(kind, docItem))) return;
          }
          // review D-03：記下發動當下的分頁世代，結果回來時不同＝已切走
          const actionTabGen = tabGen;
          const isArchive = kind === 'archive';
          const isInbox = kind === 'inbox';
          const trashKind = TRASH_ACTIONS[kind] || null; // 刪除 / 還原 / 永久刪除：一律離開本分頁
          // v3.1.0：移回 Inbox（Later / 封存區）比照稍後讀：分頁設 'remove' 就離開本分頁
          const remove = isArchive || !!trashKind || (isInbox ? cfg.inbox === 'remove' : cfg.later === 'remove');
          const trashCfg = tabs.find((t) => t.trash);
          const scope = kind === 'trash' && trashCfg ? EXCEPT_PREFIX + scopeKeyFor(trashCfg)
            : kind === 'restore' ? scopeKey
              : isArchive || trashKind ? '*' : scopeKey;
          if (remove) removedIds.set(id, scope);
          const text = isInbox ? INBOX_TEXT : laterText;
          const rw = { token: creds.token, base: creds.base, id };
          return actionCard(card, id, {
            actionFn: trashKind
              ? () => PC[trashKind.fn](rw)
              : isArchive
                ? ({ id }) => PC.archiveDocument({ service, creds, id })
                : isInbox
                  ? ({ id }) => PC.inboxDocument({ service, creds, id })
                  : ({ id }) => PC.laterDocument({ service, creds, id }),
            action: trashKind ? trashKind.action : isArchive ? '封存' : text.menu,
            remove,
            successToast: trashKind ? trashKind.done : isArchive ? null : text.done,
            toastOnRemove: !!trashKind,
            toastFn: toast,
            onEmpty: () => showMsg(emptyText(cfg), false),
            isCurrent: () => actionTabGen === tabGen
          }).then((r) => {
            if (r && r.ok) {
              if (remove && RC) RC.removeFromFeed(local, account, id, isArchive ? undefined : listKey);
            } else if (remove && removedIds.get(id) === scope) {
              removedIds.delete(id);
              // v2.5.5：失敗回來時世代已變（actionCard 因此沒把卡片插回），但使用者已
              // 切回發動當下那個分頁（A→B→A）、而且那份清單已經畫出來了——當時這張卡
              // 還在 removedIds 內被濾掉，之後背景抓回來的清單簽章沒變也不會重畫，卡片
              // 要等下一次載入才回來。這裡用畫面上那份 docs 原地重畫一次。
              //   - 人在別的分頁（shown.cfg 不是發動的分頁）→ 不動（D-03 要擋的情況）
              //   - 切回來但清單還沒畫（shown.gen 落後）→ 不必動，稍後那次繪製自然含這張
              //   - 世代沒變（沒切過分頁）→ actionCard 已插回原位，不重畫
              if (actionTabGen !== tabGen && shown && shown.gen === tabGen && shown.cfg.id === cfg.id) {
                showDocs(shown.all, shown.cfg);
              }
            }
          });
        };
        hideMsg();
        renderFeed(listEl, docs, onAction, {
          archivable: cfg.archivable !== false, later: cfg.later, inbox: cfg.inbox, laterText, tabId: cfg.id,
          showLocation: !!cfg.showLocation, deletable: !!cfg.deletable, trash: !!cfg.trash,
          limit: paging.limit
        });
        updateMore(docs.length);
      }

      // v3.1.0：「載入更多」。paging＝目前這份清單的翻頁狀態：limit＝顯示幾篇、cursor＝API 下一頁、
      // all＝已抓到的整份（未過濾）。第一屏 MAX_ITEMS 篇、之後每次多 MORE_STEP 篇；已抓的不夠就
      // 帶 nextPageCursor 再抓一頁接在後面。只有 API 回來的新資料才有 cursor（快取沒有）
      const paging = { limit: MAX_ITEMS, cursor: null, gen: 0, loading: false };
      let moreBtn = null;
      if (listEl && listEl.parentNode) {
        moreBtn = doc.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'jr-more';
        moreBtn.textContent = '載入更多';
        moreBtn.hidden = true;
        listEl.parentNode.insertBefore(moreBtn, listEl.nextSibling);
        moreBtn.addEventListener('click', () => loadMore());
      }
      // v3.1.0：垃圾桶相關動作的確認（reader-dialog.js）。對話框模組不在（理論上不會）就保守地不動作
      async function confirmTrashAction(kind, docItem, count) {
        const text = trashConfirmText(kind, docItem, count, keepDays);
        if (!text) return true;
        const D = global.__JReadReaderDialog;
        if (!D || typeof D.confirm !== 'function') return false;
        return D.confirm(text);
      }

      // v3.1.0：搜尋結果卡片的右鍵選單（Jimmy 2026-11-24「搜尋結果卡片沒有右鍵選單」）。結果橫跨各資料夾，
      // 選單依這張卡自己的資料夾決定：Inbox → 加入 Later / 封存；Later → 移回 Inbox / 封存；Archive → 移回 Inbox；
      // 都有「開啟原始網址」與「刪除」。不掛滑動（搜尋結果捲動為主，避免誤觸）。
      // 成功後 hooks.changed(新的 doc)：搬資料夾給更新後的 doc（搜尋端換掉卡片的資料夾標籤）、刪除給 null（拿掉卡片）
      function attachResultMenu(card, d, hooks) {
        const loc = d.location === 'shortlist' ? 'later' : d.location;
        const caps = { later: loc === 'new', inbox: loc === 'later' || loc === 'archive', archive: loc !== 'archive', trash: true };
        const TO = { archive: 'archive', inbox: 'new', later: 'later' };
        attachContextMenu(card, caps, laterText, async (kind) => {
          if (kind === 'trash' && !(await confirmTrashAction('trash', d))) return;
          const label = kind === 'trash' ? '刪除' : kind === 'archive' ? '封存' : kind === 'inbox' ? INBOX_TEXT.menu : laterText.menu;
          const done = kind === 'trash' ? DONE.trash : kind === 'archive' ? DONE.archive : kind === 'inbox' ? INBOX_TEXT.done : laterText.done;
          card.classList.add('is-busy');
          let r;
          try {
            r = kind === 'trash' ? await PC.trashJReaderDocument({ token: creds.token, base: creds.base, id: d.id })
              : kind === 'archive' ? await PC.archiveDocument({ service, creds, id: d.id })
                : kind === 'inbox' ? await PC.inboxDocument({ service, creds, id: d.id })
                  : await PC.laterDocument({ service, creds, id: d.id });
          } catch (_) { r = null; }
          card.classList.remove('is-busy');
          if (!r || !r.ok) { toast(archiveErrorMessage(r, label), 'error'); return; }
          // 各分頁快取裡這篇的位置都過期了：拿掉，回到分頁時由網路結果補回正確的地方
          if (RC) { try { await RC.removeFromFeed(local, account, d.id); } catch (_) {} }
          toast(done, 'success');
          if (hooks && typeof hooks.changed === 'function') hooks.changed(kind === 'trash' ? null : Object.assign({}, d, { location: TO[kind] }));
        }, d);
      }

      // v3.1.0：垃圾桶入口（清單最底部的淡色連結，不佔分頁列）與垃圾桶上方的「← 返回　垃圾桶　清空垃圾桶」。
      // 只有分頁設定裡有隱藏的垃圾桶（JReader）才出現
      const trashTab = tabs.find((t) => t.trash && t.hidden) || null;
      let trashLink = null;
      let trashHead = null;
      let headTitle = null;
      let headCount = null;
      let trashNoteEl = null;
      let subCount = null; // 目前子清單的總篇數（伺服器 count；刪除一篇就減一）
      function renderHeadCount() {
        if (!headCount) return;
        headCount.textContent = typeof subCount === 'number' ? subCount + ' 篇' : '';
      }
      let emptyBtn = null;
      // 「← 返回」回去的分頁：最後一個看過的一般分頁；直接從文章資訊面板進子清單時用網址的 back
      //（面板帶上文章原本的分頁），沒有就第一個分頁
      let lastNormalTab = null;
      // 從子清單打開文章再退回時網址沒有 back（文章頁只帶 tab），所以進來時把 back 記在這個分頁的 sessionStorage
      const SUBVIEW_BACK_KEY = 'jread:subviewBack';
      try {
        const sp = new URLSearchParams((global.location && global.location.search) || '');
        let b = sp.get('back');
        const isSub = /^(author|site):/.test(sp.get('tab') || '');
        if (b && isSub) global.sessionStorage.setItem(SUBVIEW_BACK_KEY, b);
        else if (isSub) b = global.sessionStorage.getItem(SUBVIEW_BACK_KEY);
        lastNormalTab = (b && tabs.find((t) => t.id === b && !t.hidden)) || null;
      } catch (_) { lastNormalTab = null; }
      if (trashTab && listEl && listEl.parentNode) {
        trashLink = doc.createElement('button');
        trashLink.type = 'button';
        trashLink.className = 'jr-trash-link';
        trashLink.textContent = '垃圾桶';
        listEl.parentNode.appendChild(trashLink);
        trashLink.addEventListener('click', () => selectTab(trashTab));
        trashHead = doc.createElement('div');
        trashHead.className = 'jr-trash-head';
        trashHead.hidden = true;
        const back = doc.createElement('button');
        back.type = 'button';
        back.className = 'jr-trash-back';
        back.textContent = '← 返回';
        back.addEventListener('click', () => selectTab(lastNormalTab || tabs[0]));
        const title = doc.createElement('span');
        title.className = 'jr-trash-title';
        title.textContent = '垃圾桶';
        headTitle = title;
        // v3.1.0：同作者 / 同網域清單的總篇數（Jimmy 2026-11-24「加上文章數量」），標題後面、淡色
        headCount = doc.createElement('span');
        headCount.className = 'jr-head-count';
        const empty = doc.createElement('button');
        emptyBtn = empty;
        empty.type = 'button';
        empty.className = 'jr-trash-empty';
        empty.textContent = '清空垃圾桶';
        empty.addEventListener('click', async () => {
          const n = shown && shown.cfg === trashTab && !paging.cursor ? postFilter(shown.all, trashTab).length : 0;
          if (!n && shown && shown.cfg === trashTab && !paging.cursor) { toast('垃圾桶是空的', 'info'); return; }
          if (!(await confirmTrashAction('empty', null, n))) return;
          let r;
          try { r = await PC.emptyJReaderTrash({ token: creds.token, base: creds.base }); } catch (_) { r = null; }
          if (!r || !r.ok) { toast(archiveErrorMessage(r, '清空垃圾桶'), 'error'); return; }
          if (RC) RC.writeFeed(local, account, listKeyFor(trashTab), [], MAX_ITEMS);
          toast('已清空垃圾桶', 'success');
          loadList(trashTab);
        });
        trashHead.appendChild(back);
        trashHead.appendChild(title);
        trashHead.appendChild(empty);
        listEl.parentNode.insertBefore(trashHead, listEl);
        // 垃圾桶的自動清除說明：天數讀文件的 trash_keep_days（JReader 伺服器 TRASH_KEEP_DAYS；舊版沒有時 30），
        // 清單畫出來時（showDocs 更新 keepDays）再刷新一次
        trashNoteEl = doc.createElement('div');
        trashNoteEl.className = 'jr-trash-note';
        trashNoteEl.textContent = trashNoteText();
        trashNoteEl.hidden = true;
        listEl.parentNode.insertBefore(trashNoteEl, listEl);
      }
      // 垃圾桶與同作者 / 同網域的子清單共用上方那一列（返回 + 標題）；「清空垃圾桶」只在垃圾桶
      function updateTrashUi(cfg) {
        if (!trashTab) return;
        const inSub = !!cfg.hidden;
        if (!inSub) lastNormalTab = cfg;
        trashHead.hidden = !inSub;
        // 名字太長只截名字（.jr-head-name 省略號），篇數一定看得到
        headTitle.textContent = '';
        const name = doc.createElement('span');
        name.className = 'jr-head-name';
        name.textContent = cfg.title || cfg.label;
        headTitle.appendChild(name);
        subCount = null;
        renderHeadCount();
        if (cfg.subview) headTitle.appendChild(headCount);
        emptyBtn.hidden = cfg !== trashTab;
        trashNoteEl.hidden = cfg !== trashTab;
        trashLink.hidden = inSub;
        if (tabsEl) for (const x of tabsEl.querySelectorAll('.jr-tab')) x.classList.toggle('is-active', !inSub && x.getAttribute('data-src') === cfg.id);
      }

      function updateMore(shownTotal) {
        if (!moreBtn) return;
        const hasBuffered = shown && shownTotal > paging.limit;
        moreBtn.hidden = !(hasBuffered || paging.cursor);
        moreBtn.disabled = paging.loading;
        moreBtn.textContent = paging.loading ? '載入中…' : '載入更多';
      }
      async function loadMore() {
        if (!shown || paging.loading) return;
        const cfg = shown.cfg;
        const gen = loadGen;
        paging.limit += MORE_STEP;
        const visible = postFilter(shown.all, cfg).length;
        if (visible < paging.limit && paging.cursor) {
          paging.loading = true;
          updateMore(visible);
          let r;
          try {
            r = await PC.listDocuments({ service, creds, query: Object.assign({}, queryFor(cfg), { pageCursor: paging.cursor }) });
          } catch (_) { r = null; } // serviceErrorMessage 對 null 回通用文案（錯誤碼表只在 popup-core）
          paging.loading = false;
          if (gen !== loadGen) return; // 已切分頁 / 重新載入
          if (!r || !r.ok) {
            paging.limit -= MORE_STEP;
            toast(archiveErrorMessage(r, '載入更多'), 'error');
            updateMore(visible);
            return;
          }
          paging.cursor = r.nextPageCursor || null;
          const seen = new Set(shown.all.map((d) => d && d.id));
          showDocs(shown.all.concat((r.results || []).filter((d) => d && !seen.has(d.id))), cfg);
          return;
        }
        showDocs(shown.all, cfg);
      }

      // 載入某個分頁的清單（服務無關，走 PC.listDocuments dispatcher）。
      // v1.6.24：世代 token 防 race——快速切分頁時前一發慢回應晚到，若不丟棄會
      // 蓋掉新分頁已渲染的內容（畫面內容與分頁 highlight 不一致）。
      let loadGen = 0;
      // review D-03：分頁世代——只在「換一份清單」（切分頁 / 初次載入）時前進，下拉
      // 更新（opts.refresh）不算：那時畫面上仍是同一個分頁的清單，動作失敗的卡片要照
      // 舊插回（用 loadGen 的話，下拉更新中失敗的卡片會消失到下次載入）
      let tabGen = 0;
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
        if (!refresh) tabGen++;
        const listKey = listKeyFor(cfg);
        if (!refresh) { paging.limit = MAX_ITEMS; paging.cursor = null; paging.loading = false; }
        if (!refresh && selectHook) selectHook.exit(); // 換清單就離開多選
        updateTrashUi(cfg);
        let freshArrived = false;
        let cachedSig = null;  // 非 null = 畫面上是快取版本
        if (!refresh) showMsg('載入中…', false);

        // 子清單（同作者 / 同網域）不進快取：每個作者一把 key 會一直累積
        const useCache = !!RC && !cfg.noCache;
        const cacheRead = useCache ? RC.readFeed(local, account, listKey) : Promise.resolve(null);
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

        return PC.listDocuments({ service, creds, query: queryFor(cfg) }).then((r) => {
          if (gen !== loadGen) return; // 已切到別的分頁——過期回應丟棄
          freshArrived = true;
          if (!r || !r.ok) {
            fail(archiveErrorMessage(r, '更新清單'), archiveErrorMessage(r, '載入'));
            return;
          }
          // v3.1.0：整頁（最多 100 篇）留著給「載入更多」，快取與「沒變不重畫」的比對只看第一屏
          const all = postFilter(r.results || [], cfg);
          const docs = all.slice(0, MAX_ITEMS);
          paging.cursor = r.nextPageCursor || null;
          if (cfg.subview) { subCount = typeof r.count === 'number' ? r.count : null; renderHeadCount(); }
          if (useCache) RC.writeFeed(local, account, listKey, docs, MAX_ITEMS);
          if (cachedSig !== null && RC.feedSignature(docs) === cachedSig && all.length <= MAX_ITEMS && !paging.cursor) return; // 沒變，不重畫
          if (refresh) paging.limit = Math.max(paging.limit, MAX_ITEMS);
          showDocs(all, cfg);
        }, (err) => {
          if (gen !== loadGen) return; // 過期回應丟棄（同上）
          freshArrived = true;
          // list fetch reject（iOS 偶發）：surface 出來，不要卡在「載入中…」
          const detail = String(err && err.message || err);
          fail('更新清單失敗：' + detail, '載入失敗：' + detail);
        });
      }

      // 換分頁（分頁列點擊、垃圾桶連結、垃圾桶的「返回」共用）：亮對應的分頁鈕、離開搜尋、同步網址、載入
      function selectTab(picked) {
        if (!picked) return;
        if (tabsEl) for (const x of tabsEl.querySelectorAll('.jr-tab')) x.classList.toggle('is-active', x.getAttribute('data-src') === picked.id);
        if (lib && lib.isSearching()) lib.exitSearch(false);
        // 網址同步目前分頁：重新整理 / 上一頁回到這裡時停在同一分頁
        try { global.history.replaceState(null, '', 'reader.html?tab=' + encodeURIComponent(picked.id)); } catch (_) {}
        loadList(picked);
      }

      // v1.6.0：依 FEED_TABS[service] 動態建分頁（取代 reader.html 寫死的三顆）。
      let initialTab = pickInitialTab(tabs, global.location && global.location.search);
      // v3.1.0：?tab=author:… / site:…＝同作者 / 同網域的子清單（文章資訊面板點進來、或從子清單打開的文章退回）
      if (RC && typeof RC.subviewTab === 'function' && typeof PC.supportsLibraryTools === 'function' && PC.supportsLibraryTools(service)) {
        let t = null;
        try { t = new URLSearchParams((global.location && global.location.search) || '').get('tab'); } catch (_) { t = null; }
        const sub = RC.subviewTab(t);
        if (sub) initialTab = sub;
      }
      const tabsEl = doc.getElementById('jr-tabs');
      if (tabsEl) {
        tabsEl.textContent = '';
        tabs.forEach((tab) => {
          if (tab.hidden) return; // v3.1.0：垃圾桶不放分頁列（入口在清單最底部）
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
          selectTab(tabs.find((tb) => tb.id === t.getAttribute('data-src')));
        });
      }

      // v3.1.0：JReader 書庫工具列（搜尋 / 貼網址 / 標籤）
      const LIB = global.__JReadReaderLibrary;
      if (LIB && tabsEl && listEl && typeof PC.supportsLibraryTools === 'function' && PC.supportsLibraryTools(service)) {
        const selectTab = (id) => {
          const btn = tabsEl.querySelector('.jr-tab[data-src="' + id + '"]');
          if (btn) btn.click();
        };
        lib = LIB.attach({
          doc, win: global, PC, service, creds, toast, listEl, tabsEl, msgEl, showMsg, hideMsg, createCard,
          attachResultMenu,
          currentTabId: () => (currentTab ? currentTab.id : null),
          switchTab: selectTab,
          // 離開搜尋：回到開始搜尋時的分頁，網址從 tab=search 換回那個分頁（重新整理才不會又叫回搜尋）
          onViewChange: () => { if (selectHook) selectHook.exit(); },
          reload: () => {
            const t = currentTab || initialTab;
            try { global.history.replaceState(null, '', 'reader.html?tab=' + encodeURIComponent(t.id)); } catch (_) {}
            return loadList(t);
          },
          // 背景更新目前的分頁清單（貼網址抓完時）：不清畫面、不離開多選（refresh 模式）
          refreshView: () => loadList(currentTab || initialTab, { refresh: true }),
          setTagFilter: (name) => { tagFilter = name || null; loadList(currentTab || initialTab); },
          cancelPending: () => { loadGen++; }
        });
      }

      attachKeyboardNav(listEl, doc);

      // v3.1.0：清單多選（JReader；reader-select.js）
      const SEL = global.__JReadReaderSelect;
      if (SEL && lib) {
        selectHook = SEL.attach({
          doc, win: global, listEl, PC, creds, toast,
          keepDays: () => keepDays,
          getView: () => {
            if (lib.isSearching()) return { kind: 'search' };
            const t = currentTab || initialTab;
            if (t.trash) return { kind: 'trash' };
            if (t.subview || (t.query && t.query.inProgress)) return { kind: 'sub' };
            return { kind: 'tab', location: t.query && t.query.location };
          },
          refresh: () => (lib.isSearching() ? lib.refreshSearch() : loadList(currentTab || initialTab)),
          invalidate: async (ids) => {
            if (!RC) return;
            for (const id of ids) await RC.removeFromFeed(local, account, id);
          }
        });
      }

      // ?tab= 指定的分頁，沒指定 = 第一個；?tab=search（搜尋結果點進文章再退出）由工具列叫回查詢
      if (lib && lib.restoreSearch(global.location && global.location.search)) {
        // 從搜尋結果的文章退回：記住開始搜尋時的分頁，之後 Esc 離開搜尋回那裡（一般分頁或同作者 / 同網域子清單）
        let from = null;
        try { from = global.sessionStorage.getItem(LIB.SEARCH_FROM_KEY); } catch (_) { from = null; }
        currentTab = (from && (tabs.find((t) => t.id === from) || (RC && typeof RC.subviewTab === 'function' && RC.subviewTab(from)))) || initialTab;
      }
      else loadList(initialTab);
      // v2.2.13：下拉更新入口（iOS App ViewController 的 UIRefreshControl 呼叫）
      // 搜尋中下拉＝重跑這次搜尋，不能把搜尋結果換成分頁清單（2026-11-24 審核 A-1）
      api.refreshCurrent = () => (lib && lib.isSearching() ? lib.refreshSearch() : loadList(currentTab, { refresh: true }));
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
