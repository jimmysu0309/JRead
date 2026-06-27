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

  // 卡片副標：作者 · 來源 · 字數（空欄略過，無前後贅分隔）。
  function formatMeta(doc) {
    const parts = [];
    if (doc.author) parts.push(String(doc.author));
    if (doc.site_name) parts.push(String(doc.site_name));
    if (doc.word_count) parts.push(`${doc.word_count} 字`);
    return parts.join('　·　');
  }

  // 建一張 feed 卡片：左側連結（縮圖 + 標題 + meta，導到 article.html?id=），
  // 右側封存鈕。doc 需含 id；缺 id 的不建（回 null）。
  function createCard(doc, document) {
    if (!doc || !doc.id) return null;
    const card = document.createElement('article');
    card.className = 'jr-card';
    card.setAttribute('data-doc-id', doc.id);

    const link = document.createElement('a');
    link.className = 'jr-card-link';
    link.href = 'article.html?id=' + encodeURIComponent(doc.id);

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
    if (result && result.error === 'AUTH') return 'Readwise token 無效或已過期';
    if (result && result.error === 'NETWORK') return '網路錯誤，封存失敗，請稍後再試';
    const detail = result && result.status ? `（HTTP ${result.status}）` : '';
    return `封存失敗${detail}`;
  }

  const api = { formatMeta, createCard, renderFeed, archiveCard, archiveErrorMessage, MAX_ITEMS };

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
    const subEl = doc.getElementById('jr-sub');

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

    // 套主題底色（對齊閱讀模式 theme）
    browser.storage.sync.get({ theme: 'light', readwiseToken: '' }).then((s) => {
      if (s && s.theme) doc.documentElement.setAttribute('data-theme', s.theme);
      const token = s && s.readwiseToken;
      if (!token || !String(token).trim()) {
        const span = doc.createElement('span');
        span.textContent = '尚未設定 Readwise token，請到擴充功能的進階設定填入後再開啟 Reader';
        showMsg(span, true);
        return;
      }
      if (subEl) subEl.textContent = '載入中…';
      PC.listReaderDocuments({ token: token, location: 'new' }).then((r) => {
        if (!r || !r.ok) {
          if (subEl) subEl.textContent = '';
          showMsg(archiveErrorMessage(r).replace('封存', '載入'), true);
          return;
        }
        const docs = r.results || [];
        if (subEl) subEl.textContent = '';
        if (!docs.length) {
          showMsg('收件匣目前沒有文章', false);
          return;
        }
        const onArchive = (card, id) => {
          archiveCard(card, id, {
            archiveFn: ({ id }) => PC.archiveReaderDocument({ token, id }),
            toastFn: toast,
            onEmpty: () => showMsg('收件匣目前沒有文章', false)
          });
        };
        hideMsg();
        renderFeed(listEl, docs, onArchive);
      }, (err) => {
        // list fetch reject（iOS 偶發）：surface 出來，不要卡在「載入中…」
        if (subEl) subEl.textContent = '';
        showMsg('載入失敗：' + String(err && err.message || err), true);
      });
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
