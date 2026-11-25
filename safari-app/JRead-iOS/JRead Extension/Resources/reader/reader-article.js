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

  // jsdom spec（module 環境）用；頁面上 reader-cache.js 比這支早載入、走 global.__JReadReaderCache
  const RC_MOD = typeof module !== 'undefined' && module.exports && typeof require === 'function' ? require('./reader-cache.js') : null;

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
  // 2026-10-07 review F-13：poster 也是 URL 載體（video 海報），一併過 URL 檢查
  const SANITIZE_URL_ATTRS = new Set(['href', 'src', 'srcset', 'poster']);
  // 控制字元 + 空白（"java\tscript:" 這類繞法要擋）；用 RegExp 建構避免字面
  // 值在編輯工具鏈被實體化成控制字元
  const SANITIZE_CTRL_RE = new RegExp('[\\u0000-\\u0020]', 'g');
  // F-13：資源載入屬性（src / srcset / poster）改 scheme **白名單**——只放行
  // https: / http: / data:image/ 與無 scheme 的相對路徑（相對路徑解析到擴充頁
  // origin、頂多 404）；黑名單只擋 javascript: / vbscript: 會怕新 scheme。href
  // 維持黑名單（mailto: / tel: 等合法連結 scheme 太多，列不完）。Readwise
  // html_content 與 Instapaper get_text 的圖片 URL 實務上都是絕對 URL
  //（save 端 `absolutizeResourceUrls` 已轉過），白名單對正常內容零影響。
  const SANITIZE_RESOURCE_ATTRS = new Set(['src', 'srcset', 'poster']);
  const SANITIZE_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/;
  function resourceUrlAllowed(v) {
    const s = String(v || '').replace(SANITIZE_CTRL_RE, '').toLowerCase();
    if (!s) return true;
    if (!SANITIZE_SCHEME_RE.test(s)) return true;           // 相對 / 協定相對（//host）
    return s.startsWith('https:') || s.startsWith('http:') || s.startsWith('data:image/');
  }

  // 回傳承載已清理內容的 off-DOM 容器 div。buildArticleContainer 直接搬移其
  // 子節點——不走「serialize 成字串再二次 innerHTML parse」（兩次 parse 的
  // 語境差是 mXSS 的典型載體）。
  //
  // v2.4.11（2026-11-15 review D-01）：parse 一律在 inert 文件上做。原本在現行文件
  // 的 off-DOM div 上設 innerHTML——off-DOM 不等於 inert：<img> 照樣開始載入、on*
  // handler 照樣編譯，error / load 事件事後觸發。主迴圈對「留下來的元素」同步剝
  // 屬性所以安全，但 EXCISE 整棵移除的子樹（<form><img onerror>）因
  // `!tmp.contains(el)` 跳過、屬性原封不動，handler 仍會跑（Playwright WebKit /
  // Chromium probe 實證兩引擎都觸發）。擴充頁有 MV3 CSP 擋 inline handler，但
  // iOS App 以 jread-app:// 載同一頁時沒有預設 CSP。inert 文件（無 browsing
  // context）不載資源、不跑 script、不編譯 handler；清完的節點由呼叫端
  // appendChild 進現行文件時自動 adopt，此刻 on* 已全數剝除。
  function inertContainer(html, document) {
    const impl = document.implementation;
    const inert = (impl && typeof impl.createHTMLDocument === 'function')
      ? impl.createHTMLDocument('') : null;
    // 退化環境（無 createHTMLDocument）才退回現行文件——所有支援的瀏覽器與 jsdom 都有
    const tmp = (inert || document).createElement('div');
    tmp.innerHTML = String(html || '');
    return tmp;
  }
  function sanitizeDom(html, document) {
    const tmp = inertContainer(html, document);
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
          if (v.indexOf('javascript:') !== -1 || v.indexOf('vbscript:') !== -1) { el.removeAttribute(attr.name); continue; }
          if (SANITIZE_RESOURCE_ATTRS.has(name)) {
            // srcset 逐個 candidate 檢查（"url 2x, url 800w"）
            const urls = name === 'srcset'
              ? String(attr.value || '').split(',').map(c => c.trim().split(/\s+/)[0])
              : [attr.value];
            if (!urls.every(resourceUrlAllowed)) el.removeAttribute(attr.name);
          }
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
  // opts.detectLanguage(text) → BCP-47 字串或 ''（init 傳 popup-core
  // detectHanLanguage；jsdom spec 可注入替身）。
  function buildArticleContainer(doc, document, opts) {
    const o = opts || {};
    const article = document.createElement('article');
    article.setAttribute('data-jread-reader-doc', (doc && doc.id) || '1');
    // 2026-10-07 review F-9：合成容器帶文章語言，不要繼承 article.html 的
    // `lang="zh-Hant"`——瀏覽器依 lang 選字型與漢字變體（日文「直」「骨」會以中文
    // 字形渲染）、英文文章也被當 CJK 處理。Readwise list API 回應沒有 language
    // 欄位（2026-10-07 實查 keys），先看 doc.language（有就用，相容未來 / 其他
    // 服務），沒有就用 detectLanguage 判漢字比例；判不出來設空字串 lang=""
    //（HTML 規範：空值 = 語言未知，覆蓋繼承、交給 UA 預設），總之不是 zh-Hant。
    // v2.4.11（review D-01）：語言判定改吃「清理後」的內容——原本另外把未清理的
    // html_content 再 parse 一次進現行文件的 off-DOM div，只讀 textContent、之後
    // 不處理，裡面的 <img onerror> 原封留著等事件。清理提前到這裡、下方主文直接
    // 沿用同一份（順便省一次 parse）。
    const cleaned = sanitizeDom(doc && doc.html_content, document);
    let lang = (doc && typeof doc.language === 'string') ? doc.language.trim() : '';
    if (!lang && typeof o.detectLanguage === 'function') {
      try {
        lang = o.detectLanguage(((doc && doc.title) || '') + ' ' + (cleaned.textContent || '')) || '';
      } catch (_) { lang = ''; }
    }
    article.setAttribute('lang', lang);

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
    while (cleaned.firstChild) body.appendChild(cleaned.firstChild);
    // v1.0.25：所有圖片明確 eager（退掉任何懶載傾向）——配合 preloadImages 解翻頁
    // 模式 WebKit 對遠處欄位圖片延遲載入的問題。
    const imgs = body.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i++) {
      imgs[i].setAttribute('loading', 'eager');
      imgs[i].setAttribute('decoding', 'async');
    }
    article.appendChild(body);
    // v3.1.0：公開分享頁（opts.sourceFooter）文末放「原文：<網站>」（JReader SPEC §8）。放在主文區外，
    // 不影響重點定位與閱讀位置；只接受 http(s)
    if (o.sourceFooter && doc && /^https?:\/\//i.test(String(doc.source_url || ''))) {
      const p = document.createElement('p');
      p.setAttribute('data-jread-reader-source', '1');
      p.appendChild(document.createTextNode('原文：'));
      const a = document.createElement('a');
      a.href = String(doc.source_url);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      let label = String(doc.source_url);
      try { label = (doc.site_name ? String(doc.site_name) + '（' : '') + new URL(label).hostname.replace(/^www\./, '') + (doc.site_name ? '）' : ''); } catch (_) { /* 用網址 */ }
      a.textContent = label;
      p.appendChild(a);
      article.appendChild(p);
    }
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
  // 日期格式化的正本是 reader-cache RC.formatDay（清單卡片、文章資訊面板、這裡共用）。原本這裡自己一份、
  // 少了「純數字字串＝epoch」那支，"1700000000" 得空字串（2026-11-24 審核：三份已 drift）。保留匯出名稱
  function formatDate(raw) {
    const R = global.__JReadReaderCache || RC_MOD;
    return R && typeof R.formatDay === 'function' ? R.formatDay(raw) : '';
  }

  // v1.5.3：移除文章頁左上角返回箭頭鈕——與「點 JRead 工具列圖示 → 退出閱讀模式」
  // 功能重複（兩者都走 NS.onReaderExit 導回 feed）。退出 hook（NS.onReaderExit）
  // 保留、由 JRead 圖示選單 / ESC / floating-icon 觸發；騰出的左上角區域讓給文章
  //（reader 文章頁卡片上緣留白同步收斂，見 styler READER_HOST_TOP_GUTTER）。
  //
  // v3.4.4：桌面加回左上角「← 列表」鈕（Jimmy 2026-11-25：桌面瀏覽器不用快速鍵時，看不出怎麼回文章
  // 列表；JReader 網頁版沒有 JRead 工具列圖示）。跟 v1.5.3 那顆的差別：只在有滑鼠的裝置
  //（hover + fine pointer，手機 / App 不出現）、平常隱藏，滑鼠一動才浮現、停 BACK_IDLE_MS 淡出
  //（與 idle-cursor.js 的 IDLE_DELAY_MS 同 2 秒——游標藏起來時鈕也一起收），所以不佔文章版面、
  // 卡片上緣留白不用改。fixed 掛 <html> 直下（閱讀模式會藏 body 底下非主文元素）、id 帶 __jread-
  // 前綴（NS.isInjectedUiTarget：翻頁模式的觸控翻頁、編輯模式點選都不會把它當內文）。
  // 點了走 exit（＝NS.onReaderExit，同 Esc）
  const BACK_HOST_ID = '__jread-back-host';
  const BACK_IDLE_MS = 2000;      // = idle-cursor.js IDLE_DELAY_MS
  const BACK_MOVE_MIN_PX = 2;     // = idle-cursor.js MOVE_THRESHOLD_PX（捲動觸發的原地 mousemove 不算）
  const BACK_CSS = `
    :host { all: initial; }
    button { position: fixed; top: 14px; left: 14px; z-index: 2147483000; box-sizing: border-box;
      height: 32px; padding: 0 12px 0 10px; border-radius: 16px; cursor: pointer;
      display: inline-flex; align-items: center; gap: 4px;
      background: var(--bg); color: var(--fg); border: 1px solid var(--line);
      box-shadow: 0 2px 8px rgba(0,0,0,.08);
      font: 500 13px/1 system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif; -webkit-font-smoothing: antialiased;
      opacity: 0; pointer-events: none; transition: opacity .2s ease; }
    button.show { opacity: .85; pointer-events: auto; }
    button.show:hover { opacity: 1; }
    button:focus-visible { opacity: 1; pointer-events: auto; outline: 2px solid var(--link); outline-offset: 2px; }
    .arrow { font-size: 15px; }
  `;
  function attachBackButton(exit, deps) {
    const d = deps || {};
    const win = d.win || global;
    const doc = d.doc || (win && win.document);
    if (!doc || !win || typeof exit !== 'function') return null;
    let fine = false;
    try { fine = !!(win.matchMedia && win.matchMedia('(hover: hover) and (pointer: fine)').matches); } catch (_) { fine = false; }
    if (!fine) return null;
    const old = doc.getElementById(BACK_HOST_ID);
    if (old) old.remove();
    const host = doc.createElement('div');
    host.id = BACK_HOST_ID;
    host.style.cssText = 'all: initial;';
    const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    const style = doc.createElement('style');
    style.textContent = BACK_CSS;
    root.appendChild(style);
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', '回到文章列表');
    btn.title = '回到文章列表（Esc）';
    const arrow = doc.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '←';
    btn.appendChild(arrow);
    btn.appendChild(doc.createTextNode('列表'));
    btn.addEventListener('click', (e) => { e.preventDefault(); exit(); });
    root.appendChild(btn);
    doc.documentElement.appendChild(host);

    // 顏色跟著目前閱讀主題（每次浮現重讀：閱讀中切主題也對）
    const RC = d.RC || global.__JReadReaderCache || RC_MOD;
    function applyTheme() {
      const c = RC && typeof RC.pageThemeColors === 'function' ? RC.pageThemeColors(win, doc)
        : { bg: '#ffffff', fg: '#1a1a1a', line: 'rgba(26,26,26,0.14)', link: '#1a73e8' };
      for (const k of ['bg', 'fg', 'line', 'link']) host.style.setProperty('--' + k, c[k]);
    }
    let timer = null;
    let ax = null;
    let ay = null;
    function hide() {
      timer = null;
      if (btn.matches && btn.matches(':hover')) { timer = win.setTimeout(hide, BACK_IDLE_MS); return; } // 游標停在鈕上不收
      btn.classList.remove('show');
    }
    function show() {
      if (!btn.classList.contains('show')) { applyTheme(); btn.classList.add('show'); }
      if (timer) win.clearTimeout(timer);
      timer = win.setTimeout(hide, BACK_IDLE_MS);
    }
    function onMove(e) {
      const x = e.clientX;
      const y = e.clientY;
      if (ax !== null && Math.abs(x - ax) < BACK_MOVE_MIN_PX && Math.abs(y - ay) < BACK_MOVE_MIN_PX) return;
      ax = x;
      ay = y;
      show();
    }
    win.addEventListener('mousemove', onMove, { capture: true, passive: true });
    applyTheme();
    return { host, button: btn, show, hide, isShown: () => btn.classList.contains('show') };
  }

  // v2.1.0：Readwise reading_progress（0–1）→ positionMemory 的 fallback entry
  //（只有 ratio，applyEntry 走比例對映：捲動按 scrollHeight、翻頁按總頁數）。
  // v2.1.0–v2.4.14 是單向（Readwise → JReader，當時 API 不收進度寫入）；v2.5.0 起
  // 雙向，寫回見 attachProgressSync。
  // 開頭（< MIN_RATIO）不跳；讀完（>= DONE_RATIO）也不跳——重開讀完的文章
  // 落在文末沒有用。
  // v2.5.0：updatedAt＝這個進度值所屬 doc 的 updated_at（ms）。位置記憶拿它分辨
  // 「別處更新過」與「這台自己剛寫出去、快取還沒跟上的舊值」（pickRestoreEntry）
  const PROGRESS_MIN_RATIO = 0.02;   // = positionMemory MIN_RATIO
  const PROGRESS_DONE_RATIO = 0.98;
  function progressFallbackEntry(progress, updatedAt) {
    const r = Number(progress);
    if (progress == null || !Number.isFinite(r)) return null;
    if (r <= PROGRESS_MIN_RATIO || r >= PROGRESS_DONE_RATIO) return null;
    const entry = { mode: 'ratio', ratio: r };
    const at = typeof updatedAt === 'number' ? updatedAt : Date.parse(updatedAt || '');
    if (Number.isFinite(at)) entry.updatedAt = at;
    return entry;
  }

  // 文章快取命中時用哪個進度：feed 快取（每次開 feed 都背景更新）比文章快取
  //（存進去那一刻的值）新，有就用 feed 的
  function pickProgress(cachedDoc, feedDoc) {
    const src = pickProgressDoc(cachedDoc, feedDoc);
    return src ? src.reading_progress : undefined;
  }
  // v2.5.0：進度值取自哪一份 doc（連同它的 updated_at 一起用，兩者不可各取一份）
  function pickProgressDoc(cachedDoc, feedDoc) {
    if (feedDoc && feedDoc.reading_progress != null) return feedDoc;
    return cachedDoc || null;
  }

  // v2.5.0（Jimmy 2026-11-15）：把閱讀位置寫回 Readwise，讓另一台裝置的 JReader（與
  // Readwise 官方 App）接著讀。回傳給 positionMemory.beginSession 的 onPosition 回呼：
  // 位置記憶每次寫本機記錄前呼叫 ({ ratio, final })，回 true＝這個位置已送出。
  //   - 往回重讀也寫（Jimmy 裁定：各裝置跟著最後一次閱讀的位置走）
  //   - final（退出 / 背景化的 flush）：與上次送出的差 ≥ FINAL_MIN_DELTA 就送
  //   - 閱讀中：至少隔 PROGRESS_SYNC_INTERVAL_MS、且差 ≥ READING_MIN_DELTA 才送
  //     （Readwise update 有限流，連續翻頁不必每頁一個請求）
  //   - 不等回應：送出即算（位置記憶端樂觀記錄，失敗的後果見 pickRestoreEntry）
  // 只有 Readwise（PC.supportsProgressWrite）；PDF Readwise 尚未支援。
  // 送出時另把「這台寫出的時刻」記進 RC 的時刻表（storage.local，同步發 set）：
  // 寫進度會讓 Readwise 的 updated_at 前進，文章快取靠它分辨「自己寫的」與「內容
  // 真的更新了」（RC.isStale）。
  // deps 供 spec 注入：now / RC / storage。回 null＝這篇不同步。
  const PROGRESS_SYNC_INTERVAL_MS = 30000;
  const PROGRESS_READING_MIN_DELTA = 0.01;
  const PROGRESS_FINAL_MIN_DELTA = 0.003;
  function attachProgressSync(docData, ctx, deps) {
    const { PC, service, creds } = ctx || {};
    const id = docData && docData.id != null ? String(docData.id) : '';
    if (!PC || typeof PC.updateReadingProgress !== 'function' || !id) return null;
    if (typeof PC.supportsProgressWrite !== 'function' || !PC.supportsProgressWrite(service)) return null;
    if (docData.category === 'pdf') return null;
    const now = (deps && deps.now) || Date.now;
    const RC = (deps && deps.RC) || global.__JReadReaderCache;
    const storage = (deps && deps.storage) || (global.browser && global.browser.storage && global.browser.storage.local);
    let ownWrites = (ctx && ctx.ownWrites) || {};
    const noteOwnWrite = (t) => {
      if (!RC || typeof RC.planOwnWrite !== 'function' || !storage || typeof storage.set !== 'function') return;
      ownWrites = RC.planOwnWrite(ownWrites, id, t);
      try { Promise.resolve(storage.set({ [RC.OWN_WRITE_KEY]: ownWrites })).catch(() => {}); } catch (_) { /* context 失效 */ }
    };
    const initial = Number(docData.reading_progress);
    let lastSent = Number.isFinite(initial) ? initial : NaN;
    let lastSentAt = 0;
    return function onPosition(pos) {
      const ratio = pos ? Number(pos.ratio) : NaN;
      if (!Number.isFinite(ratio)) return false;
      const r = Math.max(0, Math.min(1, ratio));
      const delta = Number.isFinite(lastSent) ? Math.abs(r - lastSent) : Infinity;
      const t = now();
      if (pos.final) {
        if (delta < PROGRESS_FINAL_MIN_DELTA) return false;
      } else if (delta < PROGRESS_READING_MIN_DELTA || t - lastSentAt < PROGRESS_SYNC_INTERVAL_MS) {
        return false;
      }
      lastSent = r;
      lastSentAt = t;
      noteOwnWrite(t);
      try {
        Promise.resolve(PC.updateReadingProgress({ service, creds, id, progress: r })).catch(() => {});
      } catch (_) { return false; }
      return true;
    };
  }

  // v2.2.10：回 feed 的網址。tab = 進文章前所在的分頁（feed 卡片帶入的 &tab=），
  // 沒有就回 reader.html（第一個分頁）。reader-feed pickInitialTab 讀同一個 ?tab=
  function feedUrl(tab) {
    return tab ? 'reader.html?tab=' + encodeURIComponent(tab) : 'reader.html';
  }

  const api = { attachBackButton, BACK_HOST_ID, BACK_IDLE_MS, markOpened, refetchArticle, attachProgressSync, pickProgressDoc, feedUrl, sanitizeHtml, sanitizeDom, buildArticleContainer, formatDate, preloadImages, parseMeta, renderArticle, showEnterFailed, loadFromCache, progressFallbackEntry, pickProgress, attachArchiveKey, archiveKeyShape, attachSourceKey, isSourceKey };

  // ---- 頁面 bootstrap ----
  // v2.5.1（2026-11-15 review D-07）：article.html 補載 lib/logger.js 後，除錯記錄的
  // context 名稱設成 article。main.js 載入時會設成 'content'（它在一般網頁是 content
  // script）；不改回來的話 Article View 的記錄會寫進一般分頁共用的那把 key、偏好設定頁
  // 也分不出來源。App 內建 JReader（jread-app://）自動偵測也會落到 'content'，一併涵蓋。
  // 開關（settings.debugLog）的初始同步與 onChanged 即時同步由 main.js 既有路徑負責
  const LOGGER_CONTEXT = 'article';
  function configureLogger(g) {
    const L = g && g.__JReadLogger;
    if (!L || typeof L.configure !== 'function') return false;
    L.configure({ context: LOGGER_CONTEXT });
    return true;
  }
  api.configureLogger = configureLogger;
  api.LOGGER_CONTEXT = LOGGER_CONTEXT;

  // v2.5.4：Article View 自己的記錄點。v2.5.1 補載 logger 後一筆都沒有——既有記錄點
  // 全是「送到儲存服務」流程（main.js logSave / popup-core jlog / SW，save 分類），
  // Article View 不走那條路。這裡補的是生命週期事件：進場 → 快取 / 取得內容 →
  // 套版 → 位置還原（position-memory.js）→ 重點同步 → 模式切換 → 封存 → 退出。
  //   - 分類用既有的 system（低頻、一律落盤——事後回查不必先開開關；偏好設定頁以
  //     ctx＝article 分辨來源）。每開一篇約 6–8 筆，不記逐頁翻頁這類高頻事件
  //   - 不記憑證、不記內文與標題；文章以文件 id 識別
  //   - 這條驗 X、不驗 Y：記錄是事後回查的線索。退出 / 封存後立刻整頁導航，最後一筆
  //     靠 flushLog 立即送出寫入、不等 300ms debounce，但寫入是非同步的，導航搶先
  //     時仍可能掉（best-effort，不為了記錄延後導航）
  const LOG_CATEGORY = 'system';
  function rlog(message, data, level) {
    const L = global.__JReadLogger;
    if (!L || typeof L.log !== 'function') return;
    try { L.log(level || 'info', LOG_CATEGORY, 'Article View：' + message, data); } catch (_) { /* 記錄不可影響主流程 */ }
  }
  function flushLog() {
    const L = global.__JReadLogger;
    if (!L || typeof L.flush !== 'function') return;
    try { L.flush(); } catch (_) { /* 同上 */ }
  }
  // 翻頁 / 捲動模式目前狀態（讀 paged-mode 既有狀態，不另存一份）
  function layoutMode(NS) {
    const PM = NS && NS.pagedMode;
    if (!PM || typeof PM.isInstalled !== 'function' || !PM.isInstalled()) return { mode: 'scroll' };
    const pos = typeof PM.getPosition === 'function' ? PM.getPosition() : null;
    return pos ? { mode: 'paged', page: pos.idx + 1, pages: pos.total } : { mode: 'paged' };
  }
  // 模式切換：設定變更（任何 storage 變動）後等重套跑完，模式與上次記的不同才記一筆。
  // 不綁設定欄位名——版面欄位有 sync flat 與每台裝置的設定檔兩個來源，這裡只看結果。
  // deps 供 spec 注入：setTimeout。回傳 { check }（立即比對一次）便於測試
  const MODE_CHECK_DELAY_MS = 800;
  function watchLayoutMode(NS, browser, deps) {
    const timer = (deps && deps.setTimeout) || global.setTimeout;
    let last = layoutMode(NS).mode;
    let pending = false;
    const check = () => {
      pending = false;
      const cur = layoutMode(NS);
      if (cur.mode === last) return false;
      rlog('模式切換', Object.assign({ from: last }, cur));
      last = cur.mode;
      return true;
    };
    try {
      const ev = browser && browser.storage && browser.storage.onChanged;
      if (ev && typeof ev.addListener === 'function') {
        ev.addListener(() => {
          if (pending) return;
          pending = true;
          timer(check, MODE_CHECK_DELAY_MS);
        });
      }
    } catch (_) { /* context 失效：不記模式切換，不影響閱讀 */ }
    return { check };
  }
  // v2.5.5：「排版套用完成」那筆的頁數要等版面落定才讀。enterFromContainer 一 resolve
  // 就讀的話，圖片還沒載完、翻頁模式的貼合（縮圖）與重新分頁也還沒跑——v2.5.4 實測
  //（Chromium、5 種視窗 × 15 種內容 × 快取命中與否 150 次）：純文字 0 次不符；有圖的
  // 文章幾乎每次都與落定後不同，預留尺寸的直式圖多 1–3 頁（之後被縮進頁內）、沒預留
  // 尺寸的圖少 1–4 頁。同一批量測「模式切換」「退出回清單」兩筆 150 / 150 相符（它們
  // 讀的是當下已落定的值），所以只動這一筆的讀值時機：
  //   - 捲動模式沒有頁數 → 照舊立刻記
  //   - 翻頁模式：兩個條件都成立才讀——(1) 主文內的圖全部載完（load / error）後再靜置
  //     LAYOUT_SETTLE_QUIET_MS（paged-mode 的媒體載入重測 debounce 是 180ms）；
  //     (2) 距開始等待已滿 LAYOUT_SETTLE_MIN_MS：paged-mode 進場後 1 秒 / 3 秒各有一次
  //     無條件重測（remeasureTimers），預留尺寸的圖載入不觸發媒體重測、要到那兩次才
  //     重新貼合（實測：1440×900 橫式預留尺寸圖，圖 50ms 內載完，頁數到 1 秒那次才從
  //     6 變 9）。最多等 LAYOUT_SETTLE_CAP_MS
  //   - 還沒落定就退出 / 封存 / 關分頁 → 當場補記（flushPendingLayoutLog），不掉這一筆
  //   - 記錄多一欄 settled：false＝等不到落定（逾時或提前離開），頁數僅供參考
  // ms（套版耗時）仍是 enterFromContainer resolve 當下的值，不含等待。
  // 這條驗 X、不驗 Y：只看 <img> 的載入；3 秒後才由 web font 換字造成的重新分頁、
  // video / iframe 晚載入不在判定內（頁數仍可能與之後不同）。
  // deps 供 spec 注入：setTimeout / clearTimeout / now。回傳 { flush }（提前結束，settled=false）
  const LAYOUT_SETTLE_QUIET_MS = 400;
  const LAYOUT_SETTLE_MIN_MS = 3400;  // > paged-mode 最後一次固定重測（3000ms，forcing spec 比對）
  const LAYOUT_SETTLE_CAP_MS = 8000;
  function whenLayoutSettled(container, cb, deps) {
    const setT = (deps && deps.setTimeout) || global.setTimeout;
    const clearT = (deps && deps.clearTimeout) || global.clearTimeout;
    const now = (deps && deps.now) || Date.now;
    const t0 = now();
    const pending = new Set();
    try {
      const imgs = container.querySelectorAll('img');
      for (let i = 0; i < imgs.length; i++) if (!imgs[i].complete) pending.add(imgs[i]);
    } catch (_) { /* 量不到就當沒有待載入的圖 */ }
    let done = false;
    let quiet = null;
    let cap = null;
    const finish = (settled) => {
      if (done) return;
      done = true;
      if (quiet) clearT(quiet);
      if (cap) clearT(cap);
      try {
        container.removeEventListener('load', onMedia, true);
        container.removeEventListener('error', onMedia, true);
      } catch (_) { /* */ }
      cb(settled);
    };
    const arm = () => {
      if (quiet) { clearT(quiet); quiet = null; }
      if (pending.size === 0) {
        const wait = Math.max(LAYOUT_SETTLE_QUIET_MS, LAYOUT_SETTLE_MIN_MS - (now() - t0));
        quiet = setT(() => { quiet = null; finish(true); }, wait);
      }
    };
    // load / error 不 bubble，capture 階段在祖先仍收得到（同 paged-mode onDescendantLoad）
    function onMedia(e) {
      const t = e && e.target;
      if (!t || t.tagName !== 'IMG') return;
      pending.delete(t);
      arm(); // 已經在靜置中又有圖載入（晚插入的圖）→ 重新計時
    }
    try {
      container.addEventListener('load', onMedia, true);
      container.addEventListener('error', onMedia, true);
    } catch (_) { /* */ }
    cap = setT(() => { cap = null; finish(false); }, LAYOUT_SETTLE_CAP_MS);
    arm();
    return { flush: () => finish(false) };
  }
  // 還在等落定的那一筆（同一頁只會有一篇文章）
  let pendingLayoutLog = null;
  function flushPendingLayoutLog() {
    const p = pendingLayoutLog;
    pendingLayoutLog = null;
    if (p) { try { p.flush(); } catch (_) { /* 記錄不可影響主流程 */ } }
  }
  api.rlog = rlog;
  api.layoutMode = layoutMode;
  api.watchLayoutMode = watchLayoutMode;
  api.whenLayoutSettled = whenLayoutSettled;
  api.LAYOUT_SETTLE_QUIET_MS = LAYOUT_SETTLE_QUIET_MS;
  api.LAYOUT_SETTLE_MIN_MS = LAYOUT_SETTLE_MIN_MS;
  api.LAYOUT_SETTLE_CAP_MS = LAYOUT_SETTLE_CAP_MS;

  function init() {
    configureLogger(global);
    const browser = global.browser;
    const NS = global.__JRead;
    const PC = global.__JReadPopup;
    const doc = global.document;
    // 缺關鍵相依時 surface 出來、不靜默卡在「載入中…」（iOS 模組載入問題診斷用）
    if (!browser || !browser.storage || !PC || !NS || !doc) {
      const m = doc && doc.getElementById('jr-status');
      if (m) m.textContent = '初始化失敗（缺少：' +
        [!browser && 'browser', !PC && 'popup-core', !NS && 'namespace'].filter(Boolean).join(' / ') + '）';
      rlog('初始化失敗', { missing: [!browser && 'browser', !PC && 'popup-core', !NS && 'namespace', !doc && 'document'].filter(Boolean) }, 'error');
      return;
    }

    // v2.5.4：被第三方頁面用 iframe 嵌入時不載入（判定住 reader-cache.js）
    const RCG = global.__JReadReaderCache;
    if (RCG && RCG.isEmbeddedFrame(global)) {
      const m = doc.getElementById('jr-status');
      if (m) m.textContent = RCG.EMBEDDED_TEXT;
      rlog('被嵌入框架、不載入', {}, 'warn');
      return;
    }

    // v2.6.0：網頁版公開分享頁（host 宣告唯讀）——文章與重點由 host 直接提供，不讀憑證、
    // 不打任何 API，走同一個 renderArticle（buildArticleContainer ＋ NS.enterFromContainer）
    const HOST = global.__jreadHost;
    if (HOST && HOST.kind === 'web' && HOST.readOnly) { initPublic(HOST, { browser, NS, PC, doc }); return; }

    const statusEl = doc.getElementById('jr-status');
    // 2026-10-07 review F-10：錯誤文字用 --text（加重），與 reader-feed `.jr-error`
    // 一致——錯誤是要使用者讀的訊息，不該比「載入中…」更淡；muted 在深色底只有
    // 約 3.6:1
    const setStatus = (text, isError) => {
      if (!statusEl) return;
      statusEl.textContent = text || '';
      if (isError) statusEl.style.color = 'var(--text)';
    };

    const params = new URLSearchParams(global.location.search);
    const id = params.get('id');
    if (!id) { rlog('缺少文章 ID', {}, 'warn'); setStatus('缺少文章 ID'); return; }
    const meta = parseMeta(params.get('meta'));
    // v2.2.10：feed 卡片帶入的來源分頁，退出 / 封存後導回同一分頁
    const backHref = feedUrl(params.get('tab'));

    // v1.6.0：讀設定（含儲存服務二擇一 + 兩服務憑證），走 PC.getArticle dispatcher。
    const DEF = global.__JReadSettingsDefaults || {};
    // v1.9.14：theme 讀有效值（這台裝置套用中的設定檔會蓋過 sync flat）
    const PROFILES = global.__JReadProfiles;
    const readSettings = (d) => (PROFILES ? PROFILES.readEffective(d) : browser.storage.sync.get(d));
    readSettings(PC.serviceSettingsQuery({
      theme: DEF.theme || 'gray' // review D-05：預設主題讀單一資料源（原寫死 'light'，與 DEFAULTS 的 gray 不一致）
    })).then((s) => {
      if (s && s.theme) doc.documentElement.setAttribute('data-theme', s.theme);
      const { service, creds, ok } = PC.resolveServiceCredentials(s);
      rlog('進場', { id, tab: params.get('tab') || '', service, hasMeta: !!meta, linked: !!ok });
      if (!ok) {
        setStatus(service === 'instapaper'
          ? '尚未連結 Instapaper 帳號，請到擴充功能的進階設定連結'
          : service === 'jreader'
            ? '尚未設定 JReader 網址與 token，請到擴充功能的進階設定填入'
            : '尚未設定 Readwise token，請到擴充功能的進階設定填入', true);
        return;
      }
      // review D-06：tab＝來源分頁 id，E 鍵封存用它查這個分頁可不可封存
      const ctx = { NS, doc, PC, service, creds, backHref, tab: params.get('tab') };
      const fetchT0 = Date.now();
      // v3.4.5：抓不到時用過期的快取頂上（離線閱讀）。回 true＝已用快取畫出
      const renderStale = (stale) => {
        if (!stale) return false;
        rlog('改用過期快取', { id });
        try {
          renderArticle(stale.doc, ctx, { progress: stale.doc.reading_progress, progressAt: stale.doc.updated_at });
        } catch (err) {
          rlog('快取文章組裝拋出例外', { id, reason: String(err && err.message || err).slice(0, 120) }, 'error');
          return false;
        }
        return true;
      };
      const fetchAndRender = (store, account, stale) => PC.getArticle({ service, creds, id, meta }).then((r) => {
        rlog('內容取得', {
          id, ok: !!(r && r.ok), error: r && r.error, status: r && r.status, ms: Date.now() - fetchT0,
          chars: (r && r.doc && typeof r.doc.html_content === 'string') ? r.doc.html_content.length : 0
        }, (r && r.ok) ? 'info' : 'error');
        if (!r || !r.ok) {
          if (r && r.error === 'EMPTY') { setStatus('找不到這篇文章的內容', true); return; }
          if (renderStale(stale)) return;
          setStatus(PC.serviceErrorMessage(r, { action: '載入', service }), true);
          return;
        }
        renderArticle(r.doc, ctx, { progress: r.doc.reading_progress, progressAt: r.doc.updated_at });
        if (store) store.put(account, r.doc);
      }, (err) => {
        // v1.7.41（R1）：getArticle reject（iOS 偶發 / renderArticle 上游同步 throw
        // 包成 rejection）要 surface，不要永遠卡「載入中」——與 reader-feed.js
        // listDocuments 的雙 handler 同一教訓。外層 .catch 只接得到 storage 讀取
        // 那段（本 Promise 沒 return 進外層 chain）。
        rlog('內容取得或組裝拋出例外', { id, reason: String(err && err.message || err).slice(0, 120), ms: Date.now() - fetchT0 }, 'error');
        // 狀態列還在＝還沒開始組裝（getArticle 本身失敗）才換快取；組裝到一半的例外不再畫第二份
        if (doc.getElementById('jr-status') && renderStale(stale)) return;
        setStatus('載入失敗：' + String(err && err.message || err), true);
      });
      loadFromCache(id, service, creds).then((c) => {
        ctx.ownWrites = c.ownWrites || {};
        // progressFrom＝進度值取自哪一份（feed 快取較新就用它，見 pickProgressDoc）
        rlog('文章快取', {
          id, hit: !!c.entry, store: !!c.store, inFeedCache: !!c.feedDoc,
          progressFrom: c.entry ? ((c.feedDoc && c.feedDoc.reading_progress != null) ? 'feed' : 'article') : 'api'
        });
        if (c.entry) {
          try {
            const pd = pickProgressDoc(c.entry.doc, c.feedDoc);
            renderArticle(c.entry.doc, ctx, { progress: pd ? pd.reading_progress : undefined, progressAt: pd ? pd.updated_at : undefined });
          } catch (err) {
            rlog('快取文章組裝拋出例外', { id, reason: String(err && err.message || err).slice(0, 120) }, 'error');
            setStatus('載入失敗：' + String(err && err.message || err), true);
            return;
          }
          c.store.touch(c.account, id);
          return;
        }
        fetchAndRender(c.store, c.account, c.staleEntry);
      });
    }).catch((err) => {
      rlog('讀取設定失敗', { reason: String(err && err.message || err).slice(0, 120) }, 'error');
      setStatus('讀取設定失敗，請重新整理', true);
    });
  }

  // v2.6.0：公開唯讀模式的 bootstrap。host.article＝文章（與 getArticle 回的 doc 同形：
  // id / title / author / site_name / published_date / source_url / image_url /
  // html_content），host.highlights＝唯讀重點清單（{ id, text, offset }），host.exitUrl＝
  // 選用的「離開」網址。版面設定（主題、字級…）照常讀 storage——web shim 存在訪客自己的
  // 瀏覽器。不呼叫 PC 的任何 API 函式、不碰文章快取與重點快取
  function initPublic(host, env) {
    const { browser, NS, PC, doc } = env;
    const statusEl = doc.getElementById('jr-status');
    const setStatus = (text) => {
      if (!statusEl) return;
      statusEl.textContent = text || '';
      statusEl.style.color = 'var(--text)';
    };
    const article = host.article;
    if (!article || typeof article.html_content !== 'string' || !article.html_content.trim()) {
      rlog('公開模式缺少文章資料', {}, 'warn');
      setStatus('找不到這篇文章的內容');
      return;
    }
    const DEF = global.__JReadSettingsDefaults || {};
    const PROFILES = global.__JReadProfiles;
    const readSettings = (d) => (PROFILES ? PROFILES.readEffective(d) : browser.storage.sync.get(d));
    Promise.resolve(readSettings({ theme: DEF.theme || 'gray' })).catch(() => ({})).then((s) => {
      if (s && s.theme) doc.documentElement.setAttribute('data-theme', s.theme);
      const docData = Object.assign({}, article, { id: article.id != null ? String(article.id) : 'public' });
      rlog('進場（公開唯讀）', { id: docData.id, highlights: Array.isArray(host.highlights) ? host.highlights.length : 0 });
      const ctx = {
        NS, doc, PC, readOnly: true,
        highlights: host.highlights,
        exitUrl: typeof host.exitUrl === 'string' && host.exitUrl ? host.exitUrl : ''
      };
      try {
        renderArticle(docData, ctx, {});
      } catch (err) {
        rlog('公開模式組裝拋出例外', { reason: String(err && err.message || err).slice(0, 120) }, 'error');
        setStatus('載入失敗：' + String(err && err.message || err));
      }
    });
  }
  api.initPublic = initPublic;

  // v1.10.1：查本機文章快取（reader-cache.js）。永不 reject，回
  // { store, account, entry }——store 為 null（IndexedDB 不可用 / 模組缺席）或
  // entry 為 null（沒存過 / 換了帳號 / feed 端 updated_at 較新＝過期）都走 API。
  // deps 供 spec 注入（RC / storage）。
  function loadFromCache(id, service, creds, deps) {
    const d = deps || {};
    const RC = d.RC || global.__JReadReaderCache;
    const storage = d.storage || (global.browser && global.browser.storage && global.browser.storage.local);
    const none = { store: null, account: '', entry: null, ownWrites: {} };
    if (!RC) return Promise.resolve(none);
    const account = RC.accountKey(service, creds);
    return Promise.resolve(RC.openArticleStore(d.storeOpts)).then((store) => {
      if (!store) return none;
      // v2.5.0：ownWrites＝這台寫回進度的時刻表——自己那次寫入讓 updated_at 前進不算過期
      const ownP = typeof RC.readOwnWrites === 'function' ? RC.readOwnWrites(storage) : Promise.resolve({});
      return Promise.all([store.get(account, id), RC.findFeedDoc(storage, account, id), ownP]).then(([entry, feedDoc, ownWrites]) => {
        const has = !!(entry && entry.doc && entry.doc.html_content);
        const usable = has && !RC.isStale(entry, feedDoc, ownWrites && ownWrites[id]);
        // v3.4.5：過期的快取另外帶回（staleEntry）——網路抓不到時（離線）拿它頂上，總比錯誤訊息好
        return { store, account, entry: usable ? entry : null, staleEntry: has && !usable ? entry : null, feedDoc: feedDoc || null, ownWrites: ownWrites || {} };
      });
    }).catch(() => none);
  }

  // v1.6.0：解析 feed 卡片帶入的 meta query param（encodeURIComponent(JSON)）。
  // Instapaper 文章頁靠它補 byline（get_text 無 metadata）；Readwise 忽略。壞值回 null。
  function parseMeta(raw) {
    if (!raw) return null;
    try { return JSON.parse(decodeURIComponent(raw)); } catch (_) { return null; }
  }

  function renderArticle(docData, ctx, opts) {
    const { NS, doc, PC } = ctx;
    const backHref = ctx.backHref || feedUrl();
    const fallbackPosition = progressFallbackEntry(opts && opts.progress, opts && opts.progressAt);
    if (docData.title) doc.title = docData.title;
    const statusEl = doc.getElementById('jr-status');
    if (statusEl) statusEl.remove();

    const container = buildArticleContainer(docData, doc, {
      detectLanguage: PC && PC.detectHanLanguage,
      sourceFooter: !!ctx.readOnly // 公開分享頁文末放原文連結
    });
    doc.body.appendChild(container);

    // 主動預載全部圖片（翻頁模式 WebKit 遠欄圖延遲載入修法，見 preloadImages 註解）
    preloadImages(container, global.Image);

    // reader 頁退出語意：回 feed（不剝版型）。必須在 enterFromContainer 之前設好，
    // 之後 JRead 圖示「退出閱讀模式」/ ESC / floating-icon 短按都會走到 main.js
    // exitReaderMode 的這個 hook 導回 feed（v1.5.3 移除返回箭頭後，這是唯一退出入口）。
    // v1.10.0：JReader 畫重點（只做 Readwise）。必須在 enterFromContainer 之前
    // attach——它的 H 鍵 listener 要比 main.js keyguard 早註冊（兩者都是 window
    // capture，keyguard 會 stopImmediatePropagation），見 reader-highlights.js
    // v2.6.0：公開唯讀模式（ctx.readOnly）只標 host 給的重點（定位＋標記層）；不掛 E 鍵
    // 封存、不寫回閱讀進度——這兩支與畫重點都會打 API
    // v3.1.0：文章資訊面板最先掛——它的 window capture 按鍵接手（面板內的輸入框：筆記、標籤）必須比
    // H 鍵畫重點、E 鍵封存早註冊。面板在 shadow DOM，那兩支看到的 target 是 host 不是輸入框，晚掛的話
    // 在筆記裡打 e 會被當成封存鍵吃掉、還真的去封存（Jimmy 2026-11-24 實測打字後跳回清單）
    if (!ctx.readOnly) attachInfoPanel(docData, container, ctx);
    const hl = attachHighlights(docData, container, ctx);
    logHighlightSync(hl, docData, container);
    // v2.1.0：E 鍵封存（同樣要比 keyguard 早註冊）
    if (!ctx.readOnly) attachArchiveKey(docData, ctx);
    // v3.1.0：V 鍵開啟原始網址（公開分享頁也有：只是開連結）
    attachSourceKey(docData, ctx);
    // v3.1.0：告訴 JReader「剛打開這篇」（Progress 分頁排序）
    if (!ctx.readOnly) markOpened(docData, ctx);
    // v2.5.0：閱讀位置寫回 Readwise。「上次送出的值」以這次實際採用的進度為起點
    //（快取命中時 docData 是文章快取、進度可能取自較新的 feed 快取）
    const onPosition = ctx.readOnly ? null : attachProgressSync(
      Object.assign({}, docData, { reading_progress: opts && opts.progress != null ? opts.progress : docData.reading_progress }), ctx);

    // 公開唯讀模式：有 host 給的 exitUrl 就導過去，沒有就沒有出口（ESC / 短按不剝版型、
    // 懸浮按鈕選單不列「回到文章列表」，見 NS.state.readerNoExit）
    const exitHref = ctx.readOnly ? (ctx.exitUrl || '') : backHref;
    const backToFeed = function () {
      if (!exitHref) return;
      flushPendingLayoutLog(); // 還在等版面落定就退出：先補記「排版套用完成」
      rlog('退出回清單', Object.assign({ id: String(docData.id || ''), to: exitHref }, layoutMode(NS)));
      flushLog();
      global.location.href = exitHref;
    };
    NS.state.readerHostPage = true;
    NS.state.readerNoExit = !exitHref;
    NS.onReaderExit = backToFeed;
    // v3.4.4：桌面左上角「← 列表」鈕（沒有出口的公開分享頁不放）
    if (exitHref) attachBackButton(backToFeed, { doc });
    // v3.4.0：懸浮按鈕選單「重新抓取文章」（floating-icon 看到這個 hook 才列）。公開分享頁沒有
    // 服務可重抓，不掛
    NS.onReaderRefetch = ctx.readOnly ? null : () => refetchArticle(docData, ctx);

    // 2026-10-07 review C-22 / F-3：進場失敗（回 false 或 reject）要有出口——
    // 狀態列已拆、容器已掛，若靜默失敗使用者只看到裸文章、ESC 也退不回（main.js
    // 的 exitReaderMode 以 active 為 guard）。把狀態列放回去顯示失敗文案 + 回
    // feed 連結，不依賴 active flag。
    if (typeof NS.enterFromContainer === 'function') {
      const enterT0 = Date.now();
      const onEnterFailed = (err) => {
        rlog('套用閱讀版型失敗', { id: String(docData.id || ''), reason: err ? String(err.message || err).slice(0, 120) : 'enterFromContainer 回 false', ms: Date.now() - enterT0 }, 'error');
        showEnterFailed(doc, statusEl, container, err, backHref);
      };
      Promise.resolve()
        .then(() => NS.enterFromContainer(container, (fallbackPosition || onPosition) ? { fallbackPosition, onPosition } : undefined))
        .then((ok) => {
          if (ok === false) { onEnterFailed(null); return; }
          const applied = {
            id: String(docData.id || ''), ms: Date.now() - enterT0,
            lang: container.getAttribute('lang') || '', category: docData.category || '',
            imgs: container.querySelectorAll('img').length,
            remoteProgress: fallbackPosition ? fallbackPosition.ratio : null,
            progressWrite: !!onPosition
          };
          // v2.5.5：翻頁模式的頁數等版面落定才讀（見 whenLayoutSettled）
          const logApplied = (settled) => rlog('排版套用完成', Object.assign(applied, layoutMode(NS), { settled }));
          if (layoutMode(NS).mode === 'paged') {
            flushPendingLayoutLog();
            const w = whenLayoutSettled(container, (settled) => {
              if (pendingLayoutLog === w) pendingLayoutLog = null;
              logApplied(settled);
            }, opts && opts.deps);
            pendingLayoutLog = w;
            try { global.addEventListener('pagehide', () => { if (pendingLayoutLog) { flushPendingLayoutLog(); flushLog(); } }, { once: true }); } catch (_) { /* 非瀏覽器環境 */ }
          } else {
            logApplied(true);
          }
          watchLayoutMode(NS, global.browser);
        }, onEnterFailed);
    }
  }

  // v3.4.0：重新抓取這篇（Jimmy 2026-11-25「單篇文章加入從稍後閱讀重抓」）。文章頁先讀本機
  // 文章快取，服務端內容更新過（重新解析、修過內文）但 updated_at 沒變時快取一直沿用舊版。
  // 做法：刪掉這篇的快取再重新整理——載入流程（init → loadFromCache miss → fetchAndRender）
  // 就會從服務重抓並寫回快取，不另寫一條抓取＋重繪的路。IndexedDB 不可用時本來就每次走
  // API，直接重新整理。永不 reject，回是否真的刪到快取。deps 供 spec 注入（RC / location）
  function refetchArticle(docData, ctx, deps) {
    const d = deps || {};
    const RC = d.RC || global.__JReadReaderCache;
    const loc = d.location || global.location;
    const id = docData && docData.id != null ? String(docData.id) : '';
    rlog('重新抓取文章', { id });
    flushLog();
    const reload = () => { try { loc.reload(); } catch (_) { /* 非瀏覽器環境 */ } };
    if (!RC || !id || typeof RC.accountKey !== 'function') { reload(); return Promise.resolve(false); }
    const account = RC.accountKey(ctx && ctx.service, ctx && ctx.creds);
    return Promise.resolve()
      .then(() => RC.openArticleStore(d.storeOpts))
      .then((store) => {
        if (!store || typeof store.remove !== 'function') return false;
        return store.remove(account, id).then((ok) => { store.close(); return ok; });
      })
      .catch(() => false)
      .then((ok) => { reload(); return !!ok; });
  }

  // v3.1.0：打開文章時告訴 JReader（PC.markJReaderOpened）。只開沒捲動時閱讀進度不會寫回，Progress
  // 分頁就不會把它排到最前（Jimmy 2026-11-24「在 progress 讀第二篇，退出後應該變第一篇」）。
  // 只對 JReader（Readwise 有呼叫次數限制、也沒有這個欄位）；同一頁快取版與新資料各畫一次，只送一次
  const openedSent = new Set();
  function markOpened(docData, ctx) {
    const { PC, service, creds } = ctx || {};
    const id = docData && docData.id != null ? String(docData.id) : '';
    if (!id || openedSent.has(id)) return false;
    if (!PC || typeof PC.markJReaderOpened !== 'function' || typeof PC.supportsLibraryTools !== 'function') return false;
    if (!PC.supportsLibraryTools(service) || !creds || !creds.token) return false;
    openedSent.add(id);
    try { Promise.resolve(PC.markJReaderOpened({ token: creds.token, base: creds.base, id })).catch(() => {}); } catch (_) { return false; }
    return true;
  }

  // v3.1.0：文章資訊面板（reader-info.js）。掛不上不影響閱讀
  function attachInfoPanel(docData, container, ctx) {
    const INFO = global.__JReadReaderInfo;
    if (!INFO || typeof INFO.attach !== 'function') return null;
    const { NS, doc, PC, service, creds } = ctx;
    try {
      return INFO.attach({ doc, win: global, NS, PC, service, creds, docData, container, tab: ctx.tab });
    } catch (_) { return null; }
  }

  // 重點同步結果摘要（attach 回傳的 ready 是既有 promise；只讀結果，不碰同步流程）
  function logHighlightSync(hl, docData, container) {
    if (!hl || !hl.ready || typeof hl.ready.then !== 'function') return;
    const t0 = Date.now();
    hl.ready.then((r) => {
      const HL = global.__JReadReaderHighlights;
      let marks = 0;
      try { marks = HL && HL.HL_ATTR ? container.querySelectorAll('[' + HL.HL_ATTR + ']').length : 0; } catch (_) { marks = 0; }
      rlog('重點同步', { id: String((docData && docData.id) || ''), ok: !!(r && r.ok), full: !!(r && r.full), marks, ms: Date.now() - t0 },
        (r && r.ok) ? 'info' : 'warn');
    }, () => {});
  }

  function attachHighlights(docData, container, ctx) {
    const HL = global.__JReadReaderHighlights;
    const { NS, doc, PC, service, creds } = ctx;
    // v2.6.0：公開唯讀模式只走「定位＋標記」層（host 給的重點清單），不同步、不編輯
    if (ctx.readOnly) {
      if (!HL || typeof HL.attachReadOnly !== 'function') return null;
      const bodyEl = container.querySelector('[data-jread-reader-body]');
      try { return HL.attachReadOnly({ doc, bodyEl, highlights: ctx.highlights }); } catch (_) { return null; }
    }
    // v2.6.0：能力判斷讀 PC.supportsHighlights（readwise / jreader）
    const supported = PC && typeof PC.supportsHighlights === 'function'
      ? PC.supportsHighlights(service) : service === 'readwise';
    // v2.4.11（review D-04）：換成非 Readwise 服務後，重點快取不會再被覆寫——留著
    // 只是佔 storage.local 配額（與閱讀位置共用）。順手移除；換回 Readwise 時重抓一次
    if (service && !supported) {
      try {
        const st = global.browser && global.browser.storage && global.browser.storage.local;
        const key = HL && HL.CACHE_KEY;
        if (st && key) Promise.resolve(st.remove(key)).catch(() => {});
      } catch (_) { /* 清不掉不影響閱讀 */ }
      return null;
    }
    if (!HL || !supported || !creds || !creds.token) return null;
    const bodyEl = container.querySelector('[data-jread-reader-body]');
    const storage = global.browser && global.browser.storage && global.browser.storage.local;
    try {
      return HL.attach({
        doc, win: global, bodyEl, docId: String(docData.id || ''), token: creds.token, base: creds.base,
        PC, NS, storage
      });
    } catch (_) { return null; }  // 畫重點掛不上不影響閱讀
  }

  // v2.1.0：E 鍵封存這篇（Readwise / Instapaper 都走 PC.archiveDocument）。成功
  // → 從 feed 快取移除（否則回 feed 會先閃出已封存的卡片）+ 回 feed；失敗 →
  // toast、留在本頁。window capture、須在 enterFromContainer 之前註冊（main.js
  // keyguard 同階段 stopImmediatePropagation，同 reader-highlights H 鍵）。
  // deps 供 spec 注入：win / RC / storage / navigate。回傳 { trigger } 便於測試。
  const ARCHIVE_TOAST_ID = 'jr-archive';
  // 封存鍵形狀判定的單一來源在 position-memory.js（article.html 先載入、掛在
  // NS.positionMemory）。ctx.NS 是 spec 注入的替身時退回頁面上的 __JRead；Node 環境
  //（jsdom spec 直接 require 本檔）退回 require 同一個檔——都是同一個函式本體
  function archiveKeyShape(NS) {
    const pm = (NS && NS.positionMemory) || (global.__JRead && global.__JRead.positionMemory);
    if (pm && typeof pm.isArchiveKeyShape === 'function') return pm.isArchiveKeyShape;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try { return require('../content/position-memory.js').isArchiveKeyShape || null; } catch (_) { return null; }
    }
    return null;
  }
  function attachArchiveKey(docData, ctx, deps) {
    const d = deps || {};
    const { NS, PC, service, creds } = ctx || {};
    const win = d.win || global;
    const id = docData && docData.id != null ? String(docData.id) : '';
    if (!win || !PC || typeof PC.archiveDocument !== 'function' || !id) return null;
    const RC = d.RC || global.__JReadReaderCache;
    const storage = d.storage || (global.browser && global.browser.storage && global.browser.storage.local);
    const backHref = (ctx && ctx.backHref) || feedUrl();
    const navigate = d.navigate || (() => { global.location.href = backHref; });
    const toast = (msg, kind, duration) => {
      if (NS && NS.toast && typeof NS.toast.show === 'function') {
        NS.toast.show(msg, { kind: kind || 'error', id: ARCHIVE_TOAST_ID, duration: duration || 3500 });
      }
    };
    let inFlight = false;
    let done = false;

    async function trigger() {
      if (inFlight || done) return null;
      // 已在封存區就不再送（成功 = 什麼都沒變，使用者會以為按了沒反應或被導回 feed
      // 找不到文章）。兩層：
      //   1. 2026-11-15 review D-06：來源分頁（網址 &tab=，feed 卡片帶入）在 FEED_TABS
      //      標為不可封存（RC.isTabArchivable）——與 feed 卡片同一份判定。Instapaper 的 doc 沒有
      //      location，從「封存」分頁打開只能靠這層；原本照送，成功後這篇被從所有分頁
      //      快取移除、導回封存分頁時卡片消失（F-11 描述的「以為被刪」）
      //   2. Readwise doc 帶 location（文章快取命中時 slimDoc 不留這欄，只有直接打
      //      API 那次有值）
      if (RC && typeof RC.isTabArchivable === 'function' && !RC.isTabArchivable(service, ctx && ctx.tab)) {
        rlog('封存略過（來源分頁不可封存）', { id, tab: (ctx && ctx.tab) || '' });
        toast('這篇已在封存區', 'info'); return null;
      }
      if (docData.location === 'archive') { rlog('封存略過（文件已在封存區）', { id }); toast('這篇已在封存區', 'info'); return null; }
      inFlight = true;
      toast('封存中…', 'info', 10000);
      const archiveT0 = Date.now();
      let r;
      try {
        r = await PC.archiveDocument({ service, creds, id });
      } catch (_) {
        r = null; // serviceErrorMessage 對 null 回通用「封存失敗」
      }
      inFlight = false;
      flushPendingLayoutLog(); // 封存成功會直接導回清單，同 backToFeed
      rlog('封存', { id, service, ok: !!(r && r.ok), error: r && r.error, status: r && r.status, ms: Date.now() - archiveT0 },
        (r && r.ok) ? 'info' : 'error');
      flushLog(); // 成功後馬上導回清單，不等 debounce
      if (!r || !r.ok) {
        toast(typeof PC.serviceErrorMessage === 'function'
          ? PC.serviceErrorMessage(r, { action: '封存', service })
          : '封存失敗');
        return r;
      }
      done = true;
      if (RC && typeof RC.removeFromFeed === 'function' && typeof RC.accountKey === 'function') {
        try { await RC.removeFromFeed(storage, RC.accountKey(service, creds), id); } catch (_) {}
      }
      // v3.1.0：成功就跳回清單，這頁的 toast 看不到——記一筆給清單頁顯示
      if (RC && typeof RC.setFeedNotice === 'function') {
        let session = d.session;
        if (session === undefined) { try { session = global.sessionStorage; } catch (_) { session = null; } }
        const title = docData && docData.title ? String(docData.title) : '';
        RC.setFeedNotice(session, title ? '已封存：' + (title.length > 40 ? title.slice(0, 40) + '…' : title) : '已封存', 'success');
      }
      navigate();
      return r;
    }

    win.addEventListener('keydown', (e) => {
      // v2.5.9：按鍵形狀判定與位置記憶「E 不算閱讀互動」共用同一個函式
      //（position-memory.js isArchiveKeyShape）。拿不到就不觸發（不另留一份判定）
      const isShape = archiveKeyShape(NS);
      if (!isShape || !isShape(e, NS)) return;
      // 長按 repeat 不重複觸發——刻意只擋在這邊（位置記憶那邊 repeat 照樣不算互動）
      if (e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      trigger();
    }, true);

    return { trigger };
  }

  // v3.1.0：V 鍵開啟原始網址（新分頁）。window capture、比 keyguard 早註冊；輸入框（含 shadow DOM 裡的，
  // NS.isTextInputTarget 看穿開放式 shadow root）、組字中、帶修飾鍵（⌘V 貼上）、長按 repeat 都不觸發。沒有原始網址就提示
  function isSourceKey(e, NS) {
    if (!e || e.type !== 'keydown') return false;
    if (e.key !== 'v' && e.key !== 'V') return false;
    if (e.isComposing || e.keyCode === 229 || e.repeat) return false;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    // 「在輸入」單一資料源 NS.isTextInputTarget（看穿開放式 shadow root，文章資訊面板的輸入框也算）
    return !(NS && typeof NS.isTextInputTarget === 'function' && NS.isTextInputTarget(e.target));
  }
  function attachSourceKey(docData, ctx, deps) {
    const d = deps || {};
    const NS = ctx && ctx.NS;
    const win = d.win || global;
    const RC = d.RC || global.__JReadReaderCache;
    if (!win || !RC || typeof RC.openSourceUrl !== 'function') return null;
    function trigger() {
      if (RC.openSourceUrl(win, docData)) return true;
      if (NS && NS.toast && typeof NS.toast.show === 'function') NS.toast.show('這篇沒有原始網址', { kind: 'info', id: 'jr-source' });
      return false;
    }
    win.addEventListener('keydown', (e) => {
      if (!isSourceKey(e, NS)) return;
      e.preventDefault();
      e.stopPropagation();
      trigger();
    }, true);
    return { trigger };
  }

  // 進場失敗出口：移除半套容器、把狀態列放回 body 開頭，顯示文案 + 回 feed 連結
  function showEnterFailed(doc, statusEl, container, err, backHref) {
    try { if (container && container.parentNode) container.parentNode.removeChild(container); } catch (_) {}
    const el = statusEl || doc.createElement('div');
    el.id = 'jr-status';
    el.textContent = '';
    const msg = doc.createElement('span');
    msg.textContent = '套用閱讀版型失敗' + (err && err.message ? '：' + String(err.message).slice(0, 80) : '') + '，';
    const back = doc.createElement('a');
    back.href = backHref || feedUrl();
    back.textContent = '回文章清單';
    el.appendChild(msg);
    el.appendChild(back);
    if (!el.parentNode) doc.body.insertBefore(el, doc.body.firstChild);
  }

  // 2026-10-07 review F-10：錯誤碼 → 文案的表住 popup-core `serviceErrorMessage`
  //（reader-feed 封存 / 本頁載入共用，帶 action 參數）；本檔不再自帶一份。

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
