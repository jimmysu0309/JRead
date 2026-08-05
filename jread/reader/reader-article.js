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

  // 清理 html_content。v1.7.44（X1）：denylist 改 allowlist——article.html 是
  // 擴充頁（有 storage 憑證 + fetch 權限），MV3 預設 CSP 只是兜底層（Safari
  // 轉換 / 未來 CSP 調整都可能讓它裸奔），sanitizer 必須自足。舊 denylist 的
  // 已知缺口（v1.7.38 全面 review X1）：
  //   - `<form action="javascript:">` 沒擋（action 不在 URL 屬性清單）
  //   - SVG SMIL（<animate>）可事後把 href 改回 javascript:
  //   - 未知標籤 / 屬性全數放行，新攻擊面出現即漏
  // Allowlist 三層：
  //   1. 標籤：EXCISE（主動內容 / 表單 / svg / math——文章內容幾乎用不到，
  //      整棵移除；svg/math 同時是 mXSS 與 SMIL 載體）→ ALLOWED（語意內容
  //      標籤，保留）→ 其餘未知標籤 unwrap（拆殼保留子內容，custom element /
  //      舊式標籤不掉字）
  //   2. 屬性：只留內容語意屬性 + data-*（data-jread* 除外——不讓內容預埋
  //      jread 內部 marker 干擾 cleaner/styler）；on* 與其餘未知屬性一律剝除
  //   3. URL：href/src/srcset 去控制字元後含 javascript:/vbscript: 即移除屬性
  // id 保留（footnote 錨點跳轉需要）但 '__' 前綴移除（防與 jread 注入 UI 的
  // id 衝突 / DOM clobbering 指向內部節點）。
  const SANITIZE_EXCISE_TAGS = new Set([
    'script', 'style', 'iframe', 'link', 'meta', 'base', 'object', 'embed',
    'noscript', 'svg', 'math', 'form', 'input', 'button', 'select', 'textarea',
    'option', 'optgroup', 'template', 'slot', 'dialog', 'canvas', 'map', 'area',
    'frame', 'frameset', 'applet', 'portal'
  ]);
  const SANITIZE_ALLOWED_TAGS = new Set([
    'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote',
    'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details',
    'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'i', 'img',
    'ins', 'kbd', 'li', 'main', 'mark', 'nav', 'ol', 'p', 'picture', 'pre',
    'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small', 'source', 'span',
    'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th',
    'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr', 'audio', 'video', 'track'
  ]);
  const SANITIZE_ALLOWED_ATTRS = new Set([
    'href', 'src', 'srcset', 'sizes', 'alt', 'title', 'width', 'height',
    'loading', 'decoding', 'colspan', 'rowspan', 'span', 'datetime', 'lang',
    'dir', 'start', 'reversed', 'type', 'media', 'poster', 'controls',
    'preload', 'kind', 'srclang', 'label', 'cite', 'target', 'rel', 'class', 'id'
  ]);
  const SANITIZE_URL_ATTRS = new Set(['href', 'src', 'srcset']);
  // 控制字元 + 空白（"java\tscript:" 這類繞法要擋）；用 RegExp 建構避免字面
  // 值在編輯工具鏈被實體化成控制字元
  const SANITIZE_CTRL_RE = new RegExp('[\\u0000-\\u0020]', 'g');

  // 回傳承載已清理內容的 off-DOM 容器 div。buildArticleContainer 直接搬移其
  // 子節點——不走「serialize 成字串再二次 innerHTML parse」（兩次 parse 的
  // 語境差是 mXSS 的典型載體）。
  function sanitizeDom(html, document) {
    const tmp = document.createElement('div');
    tmp.innerHTML = String(html || '');
    for (const el of Array.from(tmp.querySelectorAll('*'))) {
      if (!tmp.contains(el)) continue; // 祖先已被整棵移除
      const tag = el.localName;
      if (SANITIZE_EXCISE_TAGS.has(tag)) { el.remove(); continue; }
      if (!SANITIZE_ALLOWED_TAGS.has(tag)) {
        // unwrap：保留子內容、拆掉元素本身（子節點在快照序列內、繼續被檢查）
        const parent = el.parentNode;
        if (parent) {
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          el.remove();
        }
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const isSafeData = name.startsWith('data-') && !name.startsWith('data-jread');
        if (!SANITIZE_ALLOWED_ATTRS.has(name) && !isSafeData) { el.removeAttribute(attr.name); continue; }
        if (name === 'id' && String(attr.value).startsWith('__')) { el.removeAttribute(attr.name); continue; }
        if (SANITIZE_URL_ATTRS.has(name)) {
          const v = String(attr.value || '').replace(SANITIZE_CTRL_RE, '').toLowerCase();
          if (v.indexOf('javascript:') !== -1 || v.indexOf('vbscript:') !== -1) el.removeAttribute(attr.name);
        }
      }
    }
    return tmp;
  }

  // 字串版（dual export 供 spec 與外部呼叫端；內部組裝走 sanitizeDom 搬節點）
  function sanitizeHtml(html, document) {
    return sanitizeDom(html, document).innerHTML;
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
    // v1.7.44（X1）：直接搬移 sanitizeDom 清理後的節點，不再 serialize 成字串
    // 二次 innerHTML parse（mXSS 載體，見 sanitizeDom 註解）
    const cleaned = sanitizeDom(doc && doc.html_content, document);
    while (cleaned.firstChild) body.appendChild(cleaned.firstChild);
    // v1.0.25：所有圖片明確 eager（退掉任何懶載傾向）——配合 preloadImages 解翻頁
    // 模式 WebKit 對遠處欄位圖片延遲載入的問題。
    const imgs = body.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i++) {
      imgs[i].setAttribute('loading', 'eager');
      imgs[i].setAttribute('decoding', 'async');
    }
    article.appendChild(body);
    return article;
  }

  // v1.0.25：主動預載文章內所有圖片 URL。off-DOM 的 Image 物件不在 render tree、
  // 不受多欄翻頁版面的「離視窗很遠 → 延遲載入」WebKit 最佳化影響，會立即抓取；
  // 抓進 HTTP 快取後，翻頁到後面欄位時 in-DOM 的 <img> 即時從快取命中顯示。
  // 修法根因：Chromium 翻頁模式 10/10 圖正常，iOS WebKit 對遠欄圖延遲載入（probe
  // tools/paged-img-probe.js 實證 Chromium 不重現），故 WebKit 軌專屬問題。
  function preloadImages(container, ImageCtor) {
    if (!container || !ImageCtor || !container.querySelectorAll) return 0;
    let n = 0;
    const imgs = container.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i++) {
      const u = imgs[i].getAttribute('src');
      if (u) { try { const p = new ImageCtor(); p.src = u; n++; } catch (_) {} }
    }
    return n;
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

  // v1.5.3：移除文章頁左上角返回箭頭鈕——與「點 JRead 工具列圖示 → 退出閱讀模式」
  // 功能重複（兩者都走 NS.onReaderExit 導回 feed）。退出 hook（NS.onReaderExit）
  // 保留、由 JRead 圖示選單 / ESC / floating-icon 觸發；騰出的左上角區域讓給文章
  //（reader 文章頁卡片上緣留白同步收斂，見 styler READER_HOST_TOP_GUTTER）。

  const api = { sanitizeHtml, sanitizeDom, buildArticleContainer, formatDate, preloadImages, parseMeta };

  // ---- 頁面 bootstrap ----
  function init() {
    const browser = global.browser;
    const NS = global.__JRead;
    const PC = global.__JReadPopup;
    const doc = global.document;
    // 缺關鍵相依時 surface 出來、不靜默卡在「載入中…」（iOS 模組載入問題診斷用）
    if (!browser || !browser.storage || !PC || !NS || !doc) {
      const m = doc && doc.getElementById('jr-status');
      if (m) m.textContent = '初始化失敗（缺少：' +
        [!browser && 'browser', !PC && 'popup-core', !NS && 'namespace'].filter(Boolean).join(' / ') + '）';
      return;
    }

    const statusEl = doc.getElementById('jr-status');
    const setStatus = (text, isError) => {
      if (!statusEl) return;
      statusEl.textContent = text || '';
      if (isError) statusEl.style.color = 'var(--muted)';
    };

    const params = new URLSearchParams(global.location.search);
    const id = params.get('id');
    if (!id) { setStatus('缺少文章 ID'); return; }
    const meta = parseMeta(params.get('meta'));

    // v1.6.0：讀設定（含儲存服務二擇一 + 兩服務憑證），走 PC.getArticle dispatcher。
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
        setStatus(service === 'instapaper'
          ? '尚未連結 Instapaper 帳號，請到擴充功能的進階設定連結'
          : '尚未設定 Readwise token，請到擴充功能的進階設定填入', true);
        return;
      }
      PC.getArticle({ service, creds, id, meta }).then((r) => {
        if (!r || !r.ok) {
          if (r && r.error === 'EMPTY') { setStatus('找不到這篇文章的內容', true); return; }
          setStatus(loadErrorMessage(r), true);
          return;
        }
        renderArticle(r.doc, { NS, doc });
      }, (err) => {
        // v1.7.41（R1）：getArticle reject（iOS 偶發 / renderArticle 上游同步 throw
        // 包成 rejection）要 surface，不要永遠卡「載入中」——與 reader-feed.js
        // listDocuments 的雙 handler 同一教訓。外層 .catch 只接得到 storage 讀取
        // 那段（本 Promise 沒 return 進外層 chain）。
        setStatus('載入失敗：' + String(err && err.message || err), true);
      });
    }).catch(() => setStatus('讀取設定失敗，請重新整理', true));
  }

  // v1.6.0：解析 feed 卡片帶入的 meta query param（encodeURIComponent(JSON)）。
  // Instapaper 文章頁靠它補 byline（get_text 無 metadata）；Readwise 忽略。壞值回 null。
  function parseMeta(raw) {
    if (!raw) return null;
    try { return JSON.parse(decodeURIComponent(raw)); } catch (_) { return null; }
  }

  function renderArticle(docData, ctx) {
    const { NS, doc } = ctx;
    if (docData.title) doc.title = docData.title;
    const statusEl = doc.getElementById('jr-status');
    if (statusEl) statusEl.remove();

    const container = buildArticleContainer(docData, doc);
    doc.body.appendChild(container);

    // 主動預載全部圖片（翻頁模式 WebKit 遠欄圖延遲載入修法，見 preloadImages 註解）
    preloadImages(container, global.Image);

    // reader 頁退出語意：回 feed（不剝版型）。必須在 enterFromContainer 之前設好，
    // 之後 JRead 圖示「退出閱讀模式」/ ESC / floating-icon 短按都會走到 main.js
    // exitReaderMode 的這個 hook 導回 feed（v1.5.3 移除返回箭頭後，這是唯一退出入口）。
    const backToFeed = function () { global.location.href = 'reader.html'; };
    NS.state.readerHostPage = true;
    NS.onReaderExit = backToFeed;

    if (typeof NS.enterFromContainer === 'function') {
      NS.enterFromContainer(container);
    }
  }

  function loadErrorMessage(result) {
    if (result && (result.error === 'AUTH' || result.error === 'NO_CREDENTIALS')) return '登入憑證無效或已過期';
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
