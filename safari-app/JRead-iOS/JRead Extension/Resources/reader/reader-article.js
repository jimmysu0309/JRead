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

  // v1.0.24：文章頁左上角「← Reader」返回鈕——導回 feed（reader.html）。掛
  // documentElement（不掛 body：styler.apply 會隱藏 body 兄弟節點，injected UI
  // 一律 append documentElement，比照 floating-icon）。固定定位、高 z-index、
  // 半透明藥丸樣式在四個主題下都看得到。
  // v1.0.25：返回鈕配色融入背景——bg 對齊 styler THEMES 的閱讀卡片底色
  //（articleBg），arrow 用低調文字色。整顆藥丸跟卡片同色 → 視覺上只剩一個淡箭頭。
  function themeButtonColors(theme) {
    switch (theme) {
      case 'dark':  return { bg: '#4a494d', fg: 'rgba(236,235,241,0.72)' };
      case 'sepia': return { bg: '#eee2cb', fg: 'rgba(0,0,0,0.42)' };
      case 'gray':  return { bg: '#ededed', fg: 'rgba(0,0,0,0.42)' };
      default:      return { bg: '#ffffff', fg: 'rgba(0,0,0,0.42)' }; // light
    }
  }

  function createBackButton(document, onClick, theme) {
    const btn = document.createElement('button');
    btn.id = '__jread-reader-back';
    btn.type = 'button';
    // v1.0.25：只留箭頭、無文字、配色融入背景（Jimmy 回報文字 + 白底干擾閱讀）。
    // aria-label 保留語意給輔助技術。
    btn.textContent = '←';
    btn.setAttribute('aria-label', '返回 Reader');
    const VISIBLE_OPACITY = '0.9';
    const c = themeButtonColors(theme);
    btn.style.cssText = [
      'position:fixed', 'top:4px', 'left:4px', 'z-index:2147483640',
      'font:600 15px/1 -apple-system,system-ui,sans-serif', 'color:' + c.fg,
      'background:' + c.bg, 'border:0',
      'border-radius:999px', 'width:28px', 'height:28px', 'padding:0',
      'display:flex', 'align-items:center', 'justify-content:center',
      'cursor:pointer', 'opacity:' + VISIBLE_OPACITY,
      'transition:opacity 0.2s ease, transform 0.2s ease'
    ].join(';');
    // 主題即時變更時更新配色（reader-article 的 storage.onChanged 呼叫）
    btn.__setTheme = function (t) {
      const cc = themeButtonColors(t);
      btn.style.background = cc.bg;
      btn.style.color = cc.fg;
    };
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof onClick === 'function') onClick();
    });

    // v1.0.25：往下捲（閱讀中）淡出隱藏、往上捲（想離開）淡入——讀文章時完全不
    // 干擾。近頁首一律顯示。位置記憶的瞬跳會觸發一次 onScroll，落在閱讀位置時
    // 自然隱藏（合理）。
    const win = document.defaultView || (typeof window !== 'undefined' ? window : null);
    if (win) {
      let lastY = 0, hidden = false;
      const setHidden = (h) => {
        if (h === hidden) return;
        hidden = h;
        btn.style.opacity = h ? '0' : VISIBLE_OPACITY;
        btn.style.transform = h ? 'translateY(-14px)' : '';
        btn.style.pointerEvents = h ? 'none' : '';
      };
      win.addEventListener('scroll', () => {
        const se = document.scrollingElement || document.documentElement;
        const y = (se && se.scrollTop) || 0;
        if (y <= 80) setHidden(false);          // 近頁首一律顯示
        else if (y > lastY + 4) setHidden(true);  // 往下捲 → 隱藏
        else if (y < lastY - 4) setHidden(false); // 往上捲 → 顯示
        lastY = y;
      }, { passive: true });
    }
    return btn;
  }

  // v1.0.25：返回鈕位置依卡片左緣自適應。窄螢幕（手機，卡片幾乎滿版、cardLeft≈0）
  // 貼左上角；寬螢幕（iPad / 桌面，卡片置中有大留白）往下往右對齊卡片左上、落在卡片上
  //（才能融入卡片底色，不會孤懸在留白的角落）。
  function backButtonPosition(cardLeft) {
    const wide = cardLeft > 20;
    return {
      top: wide ? '14px' : '4px',
      left: wide ? (Math.round(cardLeft) + 8) + 'px' : '4px'
    };
  }

  const api = { sanitizeHtml, buildArticleContainer, formatDate, createBackButton, themeButtonColors, backButtonPosition, preloadImages };

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
        renderArticle(article, { NS, doc, browser, theme: (s && s.theme) || 'light' });
      });
    }).catch(() => setStatus('讀取設定失敗，請重新整理', true));
  }

  function renderArticle(docData, ctx) {
    const { NS, doc, browser, theme } = ctx;
    if (docData.title) doc.title = docData.title;
    const statusEl = doc.getElementById('jr-status');
    if (statusEl) statusEl.remove();

    const container = buildArticleContainer(docData, doc);
    doc.body.appendChild(container);

    // 主動預載全部圖片（翻頁模式 WebKit 遠欄圖延遲載入修法，見 preloadImages 註解）
    preloadImages(container, global.Image);

    // reader 頁退出語意：回 feed（不剝版型）。必須在 enterFromContainer 之前設好，
    // 之後 ESC / floating-icon 短按都會走到 main.js exitReaderMode 的 hook。
    const backToFeed = function () { global.location.href = 'reader.html'; };
    NS.state.readerHostPage = true;
    NS.onReaderExit = backToFeed;

    // 左上角箭頭返回鈕（掛 documentElement，免被 styler 隱藏 body 兄弟；配色融入主題）
    const backBtn = createBackButton(doc, backToFeed, theme);
    doc.documentElement.appendChild(backBtn);
    // 主題即時變更時同步返回鈕配色（與 styler reapply 同步）
    if (browser && browser.storage && browser.storage.onChanged) {
      browser.storage.onChanged.addListener(function (changes, area) {
        if (area === 'sync' && changes.theme && typeof backBtn.__setTheme === 'function') {
          backBtn.__setTheme(changes.theme.newValue);
        }
      });
    }
    // 依卡片左緣自適應定位（窄螢幕貼角、寬螢幕對齊卡片）
    function positionBack() {
      const r = container.getBoundingClientRect();
      const pos = backButtonPosition(r.left);
      backBtn.style.top = pos.top;
      backBtn.style.left = pos.left;
    }
    if (global.addEventListener) global.addEventListener('resize', positionBack);

    if (typeof NS.enterFromContainer === 'function') {
      // styler.apply 後卡片才置中（enterFromContainer 是 async）——等它跑完 + 一個
      // frame 再量卡片左緣定位返回鈕。
      Promise.resolve(NS.enterFromContainer(container)).then(function () {
        if (global.requestAnimationFrame) global.requestAnimationFrame(positionBack);
        else positionBack();
      });
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
