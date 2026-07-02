// JRead — Reader feed（v1.0.22）
//
// reader.html（擴充自有頁）的 feed 模式：列 Readwise inbox（location=new）最新
// 十篇，每篇一顆「封存」鈕（按了呼叫 Reader API 歸檔 + 樂觀從清單移除）。點卡片
// 導到 article.html?id=<docId> 用 JRead 版型閱讀。
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
  const FEED_TABS = {
    readwise: [
      { id: 'new',   label: 'Inbox', query: { location: 'new' },   empty: '收件匣目前沒有文章' },
      { id: 'later', label: 'Later', query: { location: 'later' }, empty: 'Later 目前沒有文章' },
      { id: 'jread', label: 'JRead', query: { tag: 'jread' },      empty: '沒有標記 jread 的文章' }
    ],
    instapaper: [
      { id: 'unread',  label: '未讀',  query: { folderId: 'unread' },  empty: '未讀清單目前沒有文章' },
      { id: 'starred', label: '已加星', query: { folderId: 'starred' }, empty: '沒有加星的文章' },
      { id: 'archive', label: '封存',  query: { folderId: 'archive' }, empty: '封存區目前沒有文章' }
    ]
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

  // 建一張 feed 卡片：左側連結（縮圖 + 標題 + meta，導到 article.html?id=&meta=），
  // 右側封存鈕。doc 需含 id；缺 id 的不建（回 null）。
  function createCard(doc, document) {
    if (!doc || !doc.id) return null;
    const card = document.createElement('article');
    card.className = 'jr-card';
    card.setAttribute('data-doc-id', doc.id);

    const link = document.createElement('a');
    link.className = 'jr-card-link';
    const metaEnc = encodeMeta(doc);
    link.href = 'article.html?id=' + encodeURIComponent(doc.id) + (metaEnc ? '&meta=' + metaEnc : '');

    if (doc.image_url && /^https?:\/\//i.test(doc.image_url)) {
      const img = document.createElement('img');
      img.className = 'jr-thumb';
      img.src = doc.image_url;
      img.alt = '';
      img.loading = 'lazy';
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

    const archiveBtn = document.createElement('button');
    archiveBtn.className = 'jr-archive';
    archiveBtn.type = 'button';
    archiveBtn.textContent = '封存';
    archiveBtn.setAttribute('data-doc-id', doc.id);

    card.appendChild(link);
    card.appendChild(archiveBtn);
    return card;
  }

  // 渲染整個清單。docs 取前 MAX_ITEMS 篇。onArchive(card, id) 由 init 注入。
  function renderFeed(listEl, docs, onArchive) {
    listEl.textContent = '';
    const slice = (docs || []).slice(0, MAX_ITEMS);
    let n = 0;
    for (const doc of slice) {
      const card = createCard(doc, listEl.ownerDocument);
      if (!card) continue;
      const btn = card.querySelector('.jr-archive');
      if (btn && typeof onArchive === 'function') {
        btn.addEventListener('click', () => onArchive(card, doc.id));
      }
      listEl.appendChild(card);
      n++;
    }
    return n;
  }

  // 樂觀封存：先把卡片從 DOM 移除（記住位置），呼叫 archiveFn；失敗則插回原位 +
  // toast。回傳最終結果（{ ok } 物件），便於測試。
  async function archiveCard(card, id, deps) {
    const parent = card.parentNode;
    const nextSibling = card.nextSibling;
    const btn = card.querySelector('.jr-archive');
    if (btn) btn.disabled = true;
    if (parent) parent.removeChild(card);

    let result;
    try {
      result = await deps.archiveFn({ id });
    } catch (e) {
      result = { ok: false, error: 'INTERNAL', message: String(e && e.message || e) };
    }

    if (result && result.ok) {
      if (typeof deps.onEmpty === 'function' && parent && parent.children.length === 0) deps.onEmpty();
      return result;
    }
    // 失敗：插回原位 + 還原鈕 + toast
    if (parent) parent.insertBefore(card, nextSibling);
    if (btn) btn.disabled = false;
    if (typeof deps.toastFn === 'function') deps.toastFn(archiveErrorMessage(result), 'error');
    return result;
  }

  function archiveErrorMessage(result) {
    if (result && (result.error === 'AUTH' || result.error === 'NO_CREDENTIALS')) return '登入憑證無效或已過期';
    if (result && result.error === 'NETWORK') return '網路錯誤，封存失敗，請稍後再試';
    const detail = result && result.status ? `（HTTP ${result.status}）` : '';
    return `封存失敗${detail}`;
  }

  const api = { formatMeta, encodeMeta, createCard, renderFeed, archiveCard, archiveErrorMessage, MAX_ITEMS, FEED_TABS };

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
    browser.storage.sync.get({
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
        span.textContent = service === 'instapaper'
          ? '尚未連結 Instapaper 帳號，請到擴充功能的進階設定連結後再開啟 Reader'
          : '尚未設定 Readwise token，請到擴充功能的進階設定填入後再開啟 Reader';
        showMsg(span, true);
        return;
      }

      const tabs = FEED_TABS[service] || FEED_TABS.readwise;

      // 載入某個分頁的清單（服務無關，走 PC.listDocuments dispatcher）
      function loadList(tab) {
        const cfg = tab || tabs[0];
        showMsg('載入中…', false);
        PC.listDocuments({ service, creds, query: cfg.query }).then((r) => {
          if (!r || !r.ok) {
            showMsg(archiveErrorMessage(r).replace('封存', '載入'), true);
            return;
          }
          const docs = r.results || [];
          if (!docs.length) {
            showMsg(cfg.empty, false);
            return;
          }
          const onArchive = (card, id) => {
            archiveCard(card, id, {
              archiveFn: ({ id }) => PC.archiveDocument({ service, creds, id }),
              toastFn: toast,
              onEmpty: () => showMsg(cfg.empty, false)
            });
          };
          hideMsg();
          renderFeed(listEl, docs, onArchive);
        }, (err) => {
          // list fetch reject（iOS 偶發）：surface 出來，不要卡在「載入中…」
          showMsg('載入失敗：' + String(err && err.message || err), true);
        });
      }

      // v1.6.0：依 FEED_TABS[service] 動態建分頁（取代 reader.html 寫死的三顆）。
      const tabsEl = doc.getElementById('jr-tabs');
      if (tabsEl) {
        tabsEl.textContent = '';
        tabs.forEach((tab, i) => {
          const btn = doc.createElement('button');
          btn.className = 'jr-tab' + (i === 0 ? ' is-active' : '');
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
          loadList(picked);
        });
      }

      loadList(tabs[0]);  // 預設第一個分頁
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
