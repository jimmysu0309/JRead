// JRead — Reader article（v1.0.22）
//
// article.html?id=<docId>（擴充自有頁）：抓 Readwise 單篇文件（withHtmlContent=
// true），用 html_content 建合成 <article> 容器，呼叫 NS.enterFromContainer 套
// JRead 閱讀版型（重用真 styler / positionMemory，單一資料源）。退出（ESC /
// floating-icon 短按）經 NS.onReaderExit 導回 reader.html feed。
//
// 文章間切換一律整頁載入（feed 的卡片連結是 article.html?id=，退出回 reader.html）
// ——讓 positionMemory 的 spaRouteKey(location.href) 每篇一把乾淨 key。
//
// 純函式（sanitize / buildArticleContainer）dual export 供 jsdom spec 測；init()
// 只在擴充頁環境跑。
(function (global) {
  'use strict';

  // 移除 html_content 內不該在閱讀模式出現的節點（script/style/iframe/link/meta/
  // base/object/embed）。innerHTML 設值本來就不會執行 script，這裡額外清乾淨避免殘留
  // 樣式 / 第三方 iframe 干擾版型。回傳清理後的 innerHTML 字串。
  function sanitizeHtml(html, document) {
    const tmp = document.createElement('div');
    tmp.innerHTML = String(html || '');
    const kill = tmp.querySelectorAll('script, style, iframe, link, meta, base, object, embed, noscript');
    for (const el of Array.from(kill)) el.remove();
    return tmp.innerHTML;
  }

  // 用 Reader API 的 doc 物件建合成 <article>：標題 h1 + byline（作者 · 來源 ·
  // 日期）+ 主文 body。container 結構刻意簡單（styler 對它套 typography）。
  function buildArticleContainer(doc, document) {
    const article = document.createElement('article');
    article.setAttribute('data-jread-reader-doc', (doc && doc.id) || '1');

    if (doc && doc.title) {
      const h1 = document.createElement('h1');
      h1.textContent = doc.title;
      article.appendChild(h1);
    }

    const bylineParts = [];
    if (doc && doc.author) bylineParts.push(String(doc.author));
    if (doc && doc.site_name) bylineParts.push(String(doc.site_name));
    if (doc && doc.published_date) {
      const d = formatDate(doc.published_date);
      if (d) bylineParts.push(d);
    }
    if (bylineParts.length) {
      const byline = document.createElement('p');
      byline.setAttribute('data-jread-reader-byline', '1');
      byline.textContent = bylineParts.join('　·　');
      article.appendChild(byline);
    }

    const body = document.createElement('div');
    body.setAttribute('data-jread-reader-body', '1');
    body.innerHTML = sanitizeHtml(doc && doc.html_content, document);
    article.appendChild(body);
    return article;
  }

  // published_date 可能是 ISO 字串或 epoch 秒/毫秒。轉成 YYYY-MM-DD；失敗回空字串。
  function formatDate(raw) {
    if (raw == null || raw === '') return '';
    try {
      let d;
      if (typeof raw === 'number') {
        d = new Date(raw < 1e12 ? raw * 1000 : raw);
      } else {
        d = new Date(raw);
      }
      if (isNaN(d.getTime())) return '';
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch (_) { return ''; }
  }

  const api = { sanitizeHtml, buildArticleContainer, formatDate };

  // ---- 頁面 bootstrap ----
  function init() {
    const browser = global.browser;
    const NS = global.__JRead;
    const PC = global.__JReadPopup;
    const doc = global.document;
    if (!browser || !browser.storage || !PC || !NS || !doc) return;

    const statusEl = doc.getElementById('jr-status');
    const setStatus = (text, isError) => {
      if (!statusEl) return;
      statusEl.textContent = text || '';
      if (isError) statusEl.style.color = 'var(--muted)';
    };

    const id = new URLSearchParams(global.location.search).get('id');
    if (!id) { setStatus('缺少文章 ID'); return; }

    browser.storage.sync.get({ theme: 'light', readwiseToken: '' }).then((s) => {
      if (s && s.theme) doc.documentElement.setAttribute('data-theme', s.theme);
      const token = s && s.readwiseToken;
      if (!token || !String(token).trim()) {
        setStatus('尚未設定 Readwise token，請到擴充功能的進階設定填入', true);
        return;
      }
      PC.listReaderDocuments({ token, id, withHtmlContent: true }).then((r) => {
        if (!r || !r.ok) {
          setStatus(loadErrorMessage(r), true);
          return;
        }
        const article = (r.results || [])[0];
        if (!article || !article.html_content) {
          setStatus('找不到這篇文章的內容', true);
          return;
        }
        renderArticle(article, { NS, doc });
      });
    }).catch(() => setStatus('讀取設定失敗，請重新整理', true));
  }

  function renderArticle(docData, ctx) {
    const { NS, doc } = ctx;
    if (docData.title) doc.title = docData.title;
    const statusEl = doc.getElementById('jr-status');
    if (statusEl) statusEl.remove();

    const container = buildArticleContainer(docData, doc);
    doc.body.appendChild(container);

    // reader 頁退出語意：回 feed（不剝版型）。必須在 enterFromContainer 之前設好，
    // 之後 ESC / floating-icon 短按都會走到 main.js exitReaderMode 的 hook。
    NS.state.readerHostPage = true;
    NS.onReaderExit = function () { global.location.href = 'reader.html'; };

    if (typeof NS.enterFromContainer === 'function') {
      NS.enterFromContainer(container);
    }
  }

  function loadErrorMessage(result) {
    if (result && result.error === 'AUTH') return 'Readwise token 無效或已過期';
    if (result && result.error === 'NETWORK') return '網路錯誤，載入失敗，請稍後再試';
    const detail = result && result.status ? `（HTTP ${result.status}）` : '';
    return `載入失敗${detail}`;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.__JReadReaderArticle = api;
    if (global.document) {
      if (global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', init);
      } else {
        init();
      }
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
