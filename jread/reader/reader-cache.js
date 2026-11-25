// JRead — JReader 本機快取（v1.10.1）
//
// 目的：Article Feed 重新整理 / 切分頁、Article View 換頁回來時不必每次重打 API
//（Readwise list 20/min 限流，withHtmlContent 那支更重）。兩層：
//
//   1. feed 清單 → storage.local `readerFeedCache`（每分頁最多 10 篇的精簡
//      metadata，約 5K）。feed 頁先畫快取、背景抓新的再替換（stale-while-revalidate）。
//   2. 文章 HTML → IndexedDB `jread-reader-cache`（實測一般文章 6–54K，翻譯頁內嵌
//      圖可達 1.9M，storage.local 的 10M 上限裝不下）。總量上限 ARTICLE_BUDGET
//      （50M，Jimmy 2026-10-27 裁定；v3.4.7 放寬到 300M，Jimmy 2026-11-25：App 離線連圖一起存），
//      超過時先淘汰封存（archive）的、再依最後開啟時間淘汰最舊的（v3.4.10；所在資料夾記在 meta.location，
//      由 noteLocations 從清單與本機搬資料夾同步）。
//   3. 文章內文圖（v3.4.7，App 離線預載才寫）→ 同一個 IndexedDB 的 images store，key＝文章 key
//      ＋'|'＋圖片網址、index doc＝文章 key。容量算進那篇文章的 meta.bytes（artBytes＋imgBytes），
//      淘汰 / 刪除 / 清空文章時一起刪。清單卡片縮圖（v3.4.8）存在同一個 store，網址前綴 THUMB_PREFIX
//      （'thumb|'＋縮圖網址），跟內文圖分開——內文換圖查的是原網址，不會撞到縮圖那筆。
//
// 文章內容視為不變；唯一失效條件是 feed 快取裡同 id 的 updated_at 比文章快取新
//（例如在 Readwise 重送過）。updated_at 也會因閱讀進度 / 搬位置變動，最多多抓一次。
//
// 帳號隔離：每筆都帶 accountKey（service + 憑證雜湊，不存憑證本身），換 token /
// 換服務後舊資料一律視為不存在，留給 LRU 淘汰。
//
// 任何快取失敗（IndexedDB 不可用、開庫卡住、寫入配額不足）都退回直接打 API，
// 不影響閱讀。IndexedDB 操作一律帶時限（部分 WebKit 版本 open 會永遠不回）。
//
// dual export：module.exports 給 jsdom spec、window.__JReadReaderCache 給頁面。
(function (global) {
  'use strict';

  const FEED_KEY = 'readerFeedCache';
  // v2.4.11（2026-11-15 review D-04）：JReader 住在 storage.local 的快取 key 清單——
  // options「清除快取」讀這份，不再自己列（v2.0.1 列的時候漏了 v1.10.0 的重點快取）。
  // HIGHLIGHT_KEY 與 reader-highlights.js 的 CACHE_KEY 是同一把（options 頁不載
  // reader-highlights.js，所以正本放這裡；等式由 options-clear-local-cache.spec 守）
  const HIGHLIGHT_KEY = 'readerHighlightCache';
  // v2.5.0：這台寫回閱讀進度的時刻表（見 isStale / planOwnWrite），跟著快取一起清
  const OWN_WRITE_KEY = 'readerProgressWrites';
  // v3.4.5：App 離線預載上次執行時刻（reader-offline.js LAST_RUN_KEY）——清掉快取後下次開清單立刻重新預載
  const OFFLINE_RUN_KEY = 'readerOfflinePrefetchAt';
  const LOCAL_CACHE_KEYS = [FEED_KEY, HIGHLIGHT_KEY, OWN_WRITE_KEY, OFFLINE_RUN_KEY];
  const FEED_VERSION = 1;
  const DB_NAME = 'jread-reader-cache';
  const DB_VERSION = 2;           // v3.4.7：加 images store
  const STORE_ARTICLES = 'articles';
  const STORE_META = 'meta';
  const STORE_IMAGES = 'images';
  const THUMB_PREFIX = 'thumb|';
  const ARTICLE_BUDGET = 300 * 1024 * 1024; // v3.4.7：50M → 300M（Jimmy 2026-11-25）
  const IDB_TIMEOUT_MS = 1500;

  // feed 卡片與文章頁 byline 用得到的欄位；其餘（summary / tags / content…）不存
  const SLIM_FIELDS = ['id', 'title', 'author', 'site_name', 'published_date', 'source_url', 'image_url', 'updated_at',
    // v2.1.0：Readwise 閱讀進度（文章頁走文章快取時，從 feed 快取拿較新的值）
    'reading_progress',
    // v3.4.1：JReader 預設縮圖網址（卡片縮圖載入失敗時換成這張）
    'default_image_url'];
  // v3.1.0：feed 清單快取另外多存卡片要顯示的摘要、存入日期、所在資料夾（文章快取不變）。
  // 不存的話回清單時先畫出沒有摘要的舊卡片，新資料簽章又相同、不會重畫，摘要永遠出不來
  // deleted_at：JReader 垃圾桶（文章資訊面板據此顯示「還原 / 永久刪除」）
  const FEED_FIELDS = SLIM_FIELDS.concat(['summary', 'saved_at', 'location', 'deleted_at', 'purge_at', 'share_url', 'trash_keep_days']);

  // v1.6.0：feed 來源分頁，per-service（儲存服務二擇一單一資料源）。reader.html 不再
  // 寫死三顆 tab，由 reader-feed init() 依 FEED_TABS[service] 動態建立——切服務自動換
  // 分頁語意。正本放這裡（2026-11-15 review D-06）：reader.html 與 article.html 都載本檔。
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
      // 由 reader-feed renderFeed / createCard 與 isTabArchivable 讀。Readwise 三個分頁都是
      // 未封存集合，預設可封存
      { id: 'archive', label: '封存',  query: { folderId: 'archive' }, empty: '封存區目前沒有文章', archivable: false }
    ]
  };
  // v3.1.0：JReader 的分頁是三個資料夾 Inbox / Later / Archive（Jimmy 2026-11-24）。JRead 標籤
  // 分頁拿掉——JReader 有工具列的標籤篩選，選 JRead 標籤即可。
  // `inbox`：右鍵 / 右滑「移回 Inbox」在這個分頁的行為，'remove'＝成功後卡片離開本分頁；
  // 有 `later` 的分頁右滑是稍後讀，沒有才是移回 Inbox
  FEED_TABS.jreader = [
    { id: 'new',     label: 'Inbox',   query: { location: 'new' },     empty: '收件匣目前沒有文章', later: 'remove', deletable: true },
    { id: 'later',   label: 'Later',   query: { location: 'later' },   empty: 'Later 目前沒有文章', inbox: 'remove', deletable: true },
    { id: 'archive', label: 'Archive', query: { location: 'archive' }, empty: '封存區目前沒有文章', archivable: false, inbox: 'remove', deletable: true },
    // v3.1.0（Jimmy 2026-11-24「加一欄 Progress，顯示我剛剛正在看的文章」）：讀到一半、沒封存的，
    // 最近讀的在前（JReader in_progress）。文章來自不同資料夾，卡片標出資料夾（showLocation）
    { id: 'progress', label: 'Progress', query: { inProgress: true }, empty: '沒有讀到一半的文章', showLocation: true, deletable: true },
    // v3.1.0（Jimmy 2026-11-24「加入刪除文章和垃圾桶功能，刪除要確認」）：`deletable`＝右鍵有「刪除」（移到
    // 垃圾桶）；`trash`＝垃圾桶，右鍵是「還原 / 永久刪除」、上方有「清空垃圾桶」。不做滑動刪除（左滑是封存，
    // 滑錯就刪太危險）。`hidden`＝不放分頁列（「很少用，太佔位」），入口是清單最底部的「垃圾桶」連結；
    // 仍是一個分頁設定，?tab=trash、從文章退回都照常
    { id: 'trash', label: '垃圾桶', query: { location: 'trash' }, empty: '垃圾桶是空的', archivable: false, showLocation: true, trash: true, hidden: true }
  ];
  // v3.1.0：頁面目前的主題色（Feed 的 body、Article View 的閱讀卡）——文章資訊面板、快速鍵說明、
  // 確認對話框這些 shadow DOM 浮層共用，讀不到時給中性預設
  function themeColorsOf(win, el) {
    const out = { bg: '#ffffff', fg: '#1a1a1a', muted: 'rgba(26,26,26,0.62)', line: 'rgba(26,26,26,0.14)', link: '#1a73e8' };
    if (!win || !el) return out;
    const solid = (c) => c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c);
    try {
      const cs = win.getComputedStyle(el);
      if (solid(cs.backgroundColor)) out.bg = cs.backgroundColor;
      else if (el.ownerDocument && el.ownerDocument.body && solid(win.getComputedStyle(el.ownerDocument.body).backgroundColor)) {
        out.bg = win.getComputedStyle(el.ownerDocument.body).backgroundColor;
      }
      if (cs.color) out.fg = cs.color;
      const a = el.querySelector && el.querySelector('a[href]');
      if (a) out.link = win.getComputedStyle(a).color || out.link;
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(out.fg);
      if (m) {
        out.muted = 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',0.62)';
        out.line = 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',0.14)';
      }
    } catch (_) { /* 用預設 */ }
    return out;
  }
  // 這一頁的主題色來源：Article View 用閱讀卡（styler 套好的容器），Feed 用 body
  function pageThemeColors(win, doc) {
    const body = doc && doc.querySelector && doc.querySelector('[data-jread-reader-body]');
    return themeColorsOf(win, (body && body.closest && body.closest('article')) || (doc && doc.body));
  }

  // 網址的網域（去 www.）；壞網址回 ''。清單卡片、貼網址的抓取中卡片、文章資訊面板共用
  //（原本三份、壞網址回傳不同——2026-11-24 審核「重複邏輯」）
  function hostOf(url) {
    try { return new URL(String(url == null ? '' : url)).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
  }

  // 動作完成提示（清單右鍵 / 滑動、搜尋結果選單、多選批次、文章資訊面板共用一份；原本五份、
  // 文章資訊面板的「已移到 Inbox」已經跟清單的「已移回 Inbox」drift）。Instapaper 的「稍後讀」是加星，
  // 由 reader-feed LATER_TEXT 自己帶
  const ACTION_DONE = Object.freeze({
    archive: '已封存', later: '已加入 Later', inbox: '已移回 Inbox',
    trash: '已移到垃圾桶', restore: '已還原', purge: '已永久刪除'
  });

  // 垃圾桶保留天數：JReader 每篇文件都帶 trash_keep_days（伺服器 src/store.ts TRASH_KEEP_DAYS 的值）。
  // 收文件或文件陣列，取第一個合法值；舊版 JReader 沒有這個欄位時退回 30
  const TRASH_KEEP_DAYS_FALLBACK = 30;
  function trashKeepDays(docs) {
    const list = Array.isArray(docs) ? docs : [docs];
    for (const d of list) {
      const n = d && d.trash_keep_days;
      if (typeof n === 'number' && Number.isInteger(n) && n > 0) return n;
    }
    return TRASH_KEEP_DAYS_FALLBACK;
  }

  // v3.1.0：開啟原始網址（Jimmy 2026-11-24「加入開啟原始網址功能，由快速鍵 V 及右鍵選單進入」）。
  // 清單卡片右鍵與文章頁 V 鍵共用。只開 http(s)（擋 javascript: 等）；開新分頁、noopener。
  // iOS App 的 WKWebView 由 createWebViewWith 接手、交給外部瀏覽器。回 true＝有開
  function sourceUrlOf(doc) {
    const raw = doc && doc.source_url ? String(doc.source_url).trim() : '';
    try { const u = new URL(raw); return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : ''; } catch (_) { return ''; }
  }
  function openSourceUrl(win, doc) {
    const url = sourceUrlOf(doc);
    if (!url || !win || typeof win.open !== 'function') return false;
    try { win.open(url, '_blank', 'noopener'); return true; } catch (_) { return false; }
  }

  // v3.1.0：同作者 / 同網域的子清單（文章資訊面板點作者、網域進來）。分頁 id 是 'author:<名字>' /
  // 'site:<網域>'，走 ?tab=（文章頁退出照舊帶回同一個分頁）；back＝進來前的分頁（「← 返回」回去那裡）。
  // subviewUrl 給面板、subviewTab 給清單頁組分頁設定——同一份格式只寫在這裡
  const SUBVIEW_KINDS = {
    author: { title: '作者：', query: (v) => ({ author: v }), empty: '找不到這位作者的文章' },
    site: { title: '網站：', query: (v) => ({ domain: v }), empty: '找不到這個網站的文章' }
  };
  function subviewUrl(kind, value, backTab) {
    const v = String(value || '').trim();
    if (!SUBVIEW_KINDS[kind] || !v) return null;
    const back = backTab && !/^(author|site):/.test(String(backTab)) ? '&back=' + encodeURIComponent(backTab) : '';
    return 'reader.html?tab=' + encodeURIComponent(kind + ':' + v) + back;
  }
  function subviewTab(tabId) {
    const m = /^(author|site):([\s\S]+)$/.exec(String(tabId || ''));
    if (!m) return null;
    const k = SUBVIEW_KINDS[m[1]];
    const v = m[2].trim();
    if (!v) return null;
    return {
      id: m[1] + ':' + v, label: v, title: k.title + v, query: k.query(v), empty: k.empty,
      showLocation: true, subview: true, hidden: true, noCache: true, perDocMenu: true
    };
  }

  // 資料夾顯示名稱（搜尋結果與 Progress 分頁的卡片標籤、toast）
  const LOCATION_LABEL = { new: 'Inbox', later: 'Later', shortlist: 'Later', archive: 'Archive', trash: '垃圾桶' };
  function locationLabel(loc) { return LOCATION_LABEL[loc] || ''; }
  // Readwise 的 Later 分頁同樣可以移回 Inbox（Jimmy 2026-11-24「Later 文章右鍵沒有送回 Inbox」）
  FEED_TABS.readwise[1].inbox = 'remove';

  // 2026-11-15 review D-06：這個分頁打開的文章能不能再封存。只有明確標
  // `archivable: false` 的分頁回 false；不認得的服務 / 分頁（直接貼網址、沒帶
  // &tab=）回 true，由呼叫端的其他檢查把關。feed 卡片（renderFeed）與文章頁 E 鍵
  //（reader-article attachArchiveKey）共用。
  function isTabArchivable(service, tabId) {
    const tabs = FEED_TABS[service];
    const cfg = tabs && tabId != null ? tabs.find((t) => t.id === String(tabId)) : null;
    return !(cfg && cfg.archivable === false);
  }

  // ---- 共用 ----------------------------------------------------------------

  function hashString(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(16) + '-' + s.length;
  }

  // service + 憑證的雜湊。instapaper 有 token + secret 兩段，都要納入
  // v2.6.0：jreader 另納入後端網址（同一組 token 換一台伺服器＝另一個帳號）。base 只在
  // jreader 有值，readwise / instapaper 的 key 與舊版相同（既有快取不會全部作廢）
  function accountKey(service, creds) {
    const c = creds || {};
    let raw = String(c.token || '').trim() + '|' + String(c.tokenSecret || '').trim();
    if (c.base) raw += '|' + String(c.base);
    return String(service || 'readwise') + ':' + hashString(raw);
  }

  function pickFields(doc, fields) {
    const out = {};
    if (!doc) return out;
    for (const k of fields) {
      if (doc[k] != null && doc[k] !== '') out[k] = doc[k];
    }
    return out;
  }
  function slimDoc(doc) { return pickFields(doc, SLIM_FIELDS); }
  function feedDoc(doc) { return pickFields(doc, FEED_FIELDS); }

  // v3.1.0：跨頁提示。文章頁做完動作就跳回清單（E 鍵封存），當頁的 toast 跟著頁面消失、
  // 使用者看不到任何回饋（Jimmy 2026-11-24「按了 e 封存，螢幕沒有任何提示」）。動作頁先記一筆，
  // 清單頁載入時取出顯示一次。sessionStorage：只活在這個分頁、關掉就沒了；不能用就略過
  const FEED_NOTICE_KEY = 'jread:feedNotice';
  const FEED_NOTICE_TTL_MS = 30000; // 太舊的不顯示（例如記了之後沒回清單，隔很久才開）
  function setFeedNotice(session, message, kind) {
    try { if (session) session.setItem(FEED_NOTICE_KEY, JSON.stringify({ message: String(message), kind: kind || 'success', t: Date.now() })); } catch (_) {}
  }
  function takeFeedNotice(session, now) {
    let raw = null;
    try { raw = session ? session.getItem(FEED_NOTICE_KEY) : null; if (raw) session.removeItem(FEED_NOTICE_KEY); } catch (_) { return null; }
    if (!raw) return null;
    try {
      const n = JSON.parse(raw);
      if (!n || typeof n.message !== 'string' || !(((now || Date.now()) - n.t) < FEED_NOTICE_TTL_MS)) return null;
      return { message: n.message, kind: n.kind || 'success' };
    } catch (_) { return null; }
  }

  // 日期 → YYYY-MM-DD（ISO 字串或 epoch 秒 / 毫秒）；壞值回 ''。feed 卡片與文章資訊面板共用
  function formatDay(raw) {
    if (raw == null || raw === '') return '';
    const n = typeof raw === 'number' ? raw : (/^\d+$/.test(String(raw)) ? Number(raw) : NaN);
    const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(raw));
    if (isNaN(d.getTime())) return '';
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function byteSize(str) {
    const s = String(str || '');
    try { return new TextEncoder().encode(s).length; } catch (_) { return s.length * 2; }
  }

  function withTimeout(promise, ms, fallback) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
      Promise.resolve(promise).then(
        (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
        () => { if (!done) { done = true; clearTimeout(timer); resolve(fallback); } }
      );
    });
  }

  // ---- feed 清單（storage.local）--------------------------------------------
  // { v, account, lists: { <listKey>: { t, docs: [slimDoc...] } } }
  // 換帳號整份作廢（只有一個帳號在用，不必多帳號並存）

  function readFeedCache(storage) {
    if (!storage || typeof storage.get !== 'function') return Promise.resolve(null);
    return Promise.resolve(storage.get(FEED_KEY))
      .then((v) => {
        const c = v && v[FEED_KEY];
        return (c && c.v === FEED_VERSION && c.lists && typeof c.lists === 'object') ? c : null;
      })
      .catch(() => null);
  }

  function readFeed(storage, account, listKey) {
    return readFeedCache(storage).then((c) => {
      if (!c || c.account !== account) return null;
      const entry = c.lists[listKey];
      return (entry && Array.isArray(entry.docs)) ? entry.docs : null;
    });
  }

  // 改寫整份 feed 快取。mutate(cache) 直接改 cache.lists；回傳寫入結果的 promise
  function updateFeedCache(storage, account, mutate) {
    if (!storage || typeof storage.set !== 'function') return Promise.resolve(false);
    return readFeedCache(storage).then((c) => {
      const cache = (c && c.account === account) ? c : { v: FEED_VERSION, account, lists: {} };
      mutate(cache);
      return Promise.resolve(storage.set({ [FEED_KEY]: cache })).then(() => true);
    }).catch(() => false);
  }

  function writeFeed(storage, account, listKey, docs, maxItems) {
    const slim = (docs || []).slice(0, maxItems || 10).map(feedDoc).filter((d) => d.id);
    return updateFeedCache(storage, account, (cache) => {
      cache.lists[listKey] = { t: Date.now(), docs: slim };
    });
  }

  // 封存成功後把該篇從所有分頁快取移除（否則下次開 feed 會先閃出已封存的卡片）。
  // v2.4.0：onlyListKey 指定時只動該分頁（右滑移到 Later：只離開 Inbox，JRead 分頁仍在）
  function removeFromFeed(storage, account, id, onlyListKey) {
    return updateFeedCache(storage, account, (cache) => {
      for (const k of Object.keys(cache.lists)) {
        if (onlyListKey && k !== onlyListKey) continue;
        const e = cache.lists[k];
        if (e && Array.isArray(e.docs)) e.docs = e.docs.filter((d) => d.id !== id);
      }
    });
  }

  // 文章頁查 feed 快取裡同 id 的 metadata（拿 updated_at 判斷文章快取是否過期）
  function findFeedDoc(storage, account, id) {
    return readFeedCache(storage).then((c) => {
      if (!c || c.account !== account) return null;
      for (const k of Object.keys(c.lists)) {
        const e = c.lists[k];
        const hit = e && Array.isArray(e.docs) && e.docs.find((d) => d.id === id);
        if (hit) return hit;
      }
      return null;
    });
  }

  // 清單內容是否實質相同（決定背景抓回來要不要重畫，避免無謂閃動）
  function feedSignature(docs) {
    return (docs || []).map((d) => {
      const s = feedDoc(d);
      return [s.id, s.updated_at || '', s.title || '', s.author || '', s.site_name || '', s.image_url || '',
        s.default_image_url || '', s.summary || '', s.published_date || '', s.saved_at || '', s.location || ''].join('\u0001');
    }).join('\u0002');
  }

  // ---- 文章（IndexedDB）------------------------------------------------------

  // feed 那邊的 updated_at 比快取新 → 過期。任一方缺 updated_at（Instapaper、
  // feed 沒列到這篇）→ 視為沒過期
  // v2.5.0：ownWriteAt＝這台最後一次把閱讀進度寫回 Readwise 的時刻（ms，這台的時鐘）。
  // 寫進度會讓 Readwise 的 updated_at 前進——不扣掉的話，每次在 JReader 讀過一篇，
  // 下次開它文章快取就被判過期、整篇重抓（慢、吃 list 限流，離線時直接開不了）。
  // feed 的 updated_at 落在「這台寫出時刻 + OWN_WRITE_SLACK_MS」以內 → 視為自己那次
  // 寫入造成的，不算過期。代價：文章內容剛好在這台寫出前後兩分鐘內被改，要等它下次
  // 再更新才會重抓
  const OWN_WRITE_SLACK_MS = 120000;
  function isStale(entry, feedDoc, ownWriteAt) {
    if (!entry) return true;
    const a = entry.updated_at ? Date.parse(entry.updated_at) : NaN;
    const b = feedDoc && feedDoc.updated_at ? Date.parse(feedDoc.updated_at) : NaN;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (!(b > a)) return false;
    if (typeof ownWriteAt === 'number' && Number.isFinite(ownWriteAt) && b <= ownWriteAt + OWN_WRITE_SLACK_MS) return false;
    return true;
  }

  // v2.5.0：這台寫回進度的時刻表 { [docId]: ms }（storage.local，上限 OWN_WRITE_MAX 筆、
  // 舊的先丟）。獨立一把 key 而不放進文章快取的 IndexedDB：寫入發生在頁面退出 /
  // 背景化當下，storage.local.set 的 IPC 同步送得出去，IndexedDB 交易等不到
  const OWN_WRITE_MAX = 60;
  function readOwnWrites(storage) {
    if (!storage || typeof storage.get !== 'function') return Promise.resolve({});
    return Promise.resolve(storage.get(OWN_WRITE_KEY))
      .then((v) => {
        const m = v && v[OWN_WRITE_KEY];
        return (m && typeof m === 'object') ? m : {};
      })
      .catch(() => ({}));
  }
  function planOwnWrite(map, id, now) {
    const next = Object.assign({}, map || {});
    next[String(id)] = now;
    const keys = Object.keys(next);
    if (keys.length > OWN_WRITE_MAX) {
      keys.sort((x, y) => (next[x] || 0) - (next[y] || 0));
      for (const k of keys.slice(0, keys.length - OWN_WRITE_MAX)) delete next[k];
    }
    return next;
  }

  // metas: [{ key, bytes, lastOpened }]。回傳要刪的 key（最久沒開的先刪），
  // 刪到總量 <= budget 為止；keepKey（剛寫入 / 正在讀的那篇）永不刪
  // v3.4.7：一張 <img> 離線要存哪個網址（App 預載與文章頁換成本機圖共用，兩邊必須同一套）。
  // 回屬性原字串（不解析成絕對網址——兩邊都讀同一份 html_content，原字串就是對照 key）：
  // src 是 http(s) 就用 src；沒有的話取 srcset 裡最大的那個（w 或 x 描述最大）；都沒有回 ''
  function pickImageUrl(img) {
    if (!img || typeof img.getAttribute !== 'function') return '';
    const src = String(img.getAttribute('src') || '').trim();
    if (/^https?:\/\//i.test(src)) return src;
    const set = String(img.getAttribute('srcset') || '').trim();
    if (!set) return '';
    let best = '', bestN = -1;
    for (const part of set.split(',')) {
      const bits = part.trim().split(/\s+/);
      const u = bits[0] || '';
      if (!/^https?:\/\//i.test(u)) continue;
      const n = parseFloat(bits[1] || '1') || 1;
      if (n > bestN) { bestN = n; best = u; }
    }
    return best;
  }

  // v3.4.10：封存（meta.location === 'archive'）的先刪（其中最久沒開的先），再依最後開啟時間刪其他的
  //（Jimmy 2026-11-25「cache 滿了優先先從 archive 文章開始移除」）。沒記 location 的舊 meta 視為非封存
  function planEviction(metas, budget, keepKey) {
    const list = (metas || []).filter((m) => m && m.key);
    let total = list.reduce((s, m) => s + (Number(m.bytes) || 0), 0);
    if (total <= budget) return [];
    const archived = (m) => (m.location === 'archive' ? 0 : 1);
    const order = list.filter((m) => m.key !== keepKey)
      .sort((x, y) => (archived(x) - archived(y)) || ((Number(x.lastOpened) || 0) - (Number(y.lastOpened) || 0)));
    const out = [];
    for (const m of order) {
      if (total <= budget) break;
      out.push(m.key);
      total -= Number(m.bytes) || 0;
    }
    return out;
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('abort'));
    });
  }

  // 回傳 store 物件；IndexedDB 不可用 / 開庫失敗 / 卡住 → resolve null（呼叫端走 API）
  function openArticleStore(opts) {
    const o = opts || {};
    const idb = o.indexedDB !== undefined ? o.indexedDB : global.indexedDB;
    const budget = o.budget || ARTICLE_BUDGET;
    const timeoutMs = o.timeoutMs || IDB_TIMEOUT_MS;
    const now = o.now || (() => Date.now());
    if (!idb || typeof idb.open !== 'function') return Promise.resolve(null);

    let openReq;
    const opened = new Promise((resolve, reject) => {
      try { openReq = idb.open(o.dbName || DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
      openReq.onupgradeneeded = () => {
        const db = openReq.result;
        if (!db.objectStoreNames.contains(STORE_ARTICLES)) db.createObjectStore(STORE_ARTICLES, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_IMAGES)) {
          db.createObjectStore(STORE_IMAGES, { keyPath: 'key' }).createIndex('doc', 'doc', { unique: false });
        }
      };
      openReq.onsuccess = () => resolve(openReq.result);
      openReq.onerror = () => reject(openReq.error);
      openReq.onblocked = () => reject(new Error('blocked'));
    });

    return withTimeout(opened, timeoutMs, null).then((db) => {
      if (!db) return null;
      const keyOf = (account, id) => account + '|' + id;

      function get(account, id) {
        const p = (async () => {
          const tx = db.transaction([STORE_ARTICLES], 'readonly');
          return (await reqToPromise(tx.objectStore(STORE_ARTICLES).get(keyOf(account, id)))) || null;
        })();
        return withTimeout(p, timeoutMs, null);
      }

      // 更新最後開啟時間（只改 meta，不重寫整篇 HTML）
      function touch(account, id) {
        const key = keyOf(account, id);
        return (async () => {
          const tx = db.transaction([STORE_META], 'readwrite');
          const store = tx.objectStore(STORE_META);
          const m = await reqToPromise(store.get(key));
          if (m) store.put(Object.assign({}, m, { lastOpened: now() }));
          await txDone(tx);
          return true;
        })().catch(() => false);
      }

      // 同一個交易裡刪掉某篇文章的所有圖（index doc）
      function deleteImagesOf(tx, docKey) {
        const idx = tx.objectStore(STORE_IMAGES).index('doc');
        const req = idx.openKeyCursor(docKey);
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return;
          tx.objectStore(STORE_IMAGES).delete(c.primaryKey);
          c.continue();
        };
      }

      async function evict(keepKey) {
        const tx = db.transaction([STORE_META], 'readonly');
        const metas = await reqToPromise(tx.objectStore(STORE_META).getAll());
        const victims = planEviction(metas, budget, keepKey);
        if (!victims.length) return 0;
        const wtx = db.transaction([STORE_ARTICLES, STORE_META, STORE_IMAGES], 'readwrite');
        for (const k of victims) {
          wtx.objectStore(STORE_ARTICLES).delete(k);
          wtx.objectStore(STORE_META).delete(k);
          deleteImagesOf(wtx, k);
        }
        await txDone(wtx);
        return victims.length;
      }

      // 寫入一篇（doc 需含 id 與 html_content）。單篇超過總量上限不存
      function put(account, doc) {
        return (async () => {
          if (!doc || !doc.id || !doc.html_content) return false;
          const slim = slimDoc(doc);
          slim.html_content = String(doc.html_content);
          if (doc.language) slim.language = doc.language;
          const bytes = byteSize(slim.html_content) + byteSize(JSON.stringify(slimDoc(doc)));
          if (bytes > budget) return false;
          const key = keyOf(account, String(doc.id));
          const tx = db.transaction([STORE_ARTICLES, STORE_META], 'readwrite');
          const metaStore = tx.objectStore(STORE_META);
          const prev = await reqToPromise(metaStore.get(key));
          const imgBytes = (prev && Number(prev.imgBytes)) || 0; // 重抓文章時已存的圖留著、容量照算
          tx.objectStore(STORE_ARTICLES).put({ key, account, id: String(doc.id), updated_at: doc.updated_at || '', doc: slim });
          const m = Object.assign({}, prev || {}, { key, artBytes: bytes, imgBytes, bytes: bytes + imgBytes, lastOpened: now() });
          // v3.4.10：記所在資料夾給淘汰排序用（doc 沒帶就沿用舊值）
          if (doc.location) m.location = String(doc.location);
          metaStore.put(m);
          await txDone(tx);
          await evict(key);
          return true;
        })().catch(() => false);
      }

      // v3.4.10：更新已存文章的所在資料夾（list：[{ id, location }]）。只改已存在的 meta、不新增，
      // 不動最後開啟時間。回實際改了幾篇
      function setLocations(account, list) {
        return (async () => {
          const items = (list || []).filter((x) => x && x.id != null && x.location);
          if (!items.length) return 0;
          const tx = db.transaction([STORE_META], 'readwrite');
          const metaStore = tx.objectStore(STORE_META);
          let n = 0;
          for (const it of items) {
            const key = keyOf(account, String(it.id));
            const m = await reqToPromise(metaStore.get(key));
            if (!m || m.location === it.location) continue;
            metaStore.put(Object.assign({}, m, { location: String(it.location) }));
            n++;
          }
          await txDone(tx);
          return n;
        })().catch(() => 0);
      }

      // 刪掉一篇（v3.4.0：文章頁「重新抓取文章」——刪掉後重新整理，載入流程快取 miss 就從服務重抓）
      function remove(account, id) {
        const key = keyOf(account, String(id));
        return (async () => {
          const tx = db.transaction([STORE_ARTICLES, STORE_META, STORE_IMAGES], 'readwrite');
          tx.objectStore(STORE_ARTICLES).delete(key);
          tx.objectStore(STORE_META).delete(key);
          deleteImagesOf(tx, key);
          await txDone(tx);
          return true;
        })().catch(() => false);
      }

      // v3.4.7：某篇文章已存的圖 → Map(網址 → Blob)。沒有 / 失敗回空 Map
      function getImages(account, id) {
        const docKey = keyOf(account, String(id));
        const p = (async () => {
          const tx = db.transaction([STORE_IMAGES], 'readonly');
          const rows = await reqToPromise(tx.objectStore(STORE_IMAGES).index('doc').getAll(docKey));
          const out = new Map();
          for (const r of rows || []) if (r && r.url && r.blob) out.set(r.url, r.blob);
          return out;
        })().catch(() => new Map());
        return withTimeout(p, timeoutMs, new Map());
      }

      // v3.4.7：存某篇文章的圖（list：[{ url, blob }]）。文章本身要先存在（沒有文章不存圖）；
      // 容量加進 meta.imgBytes / bytes，再跑一次淘汰（這篇本身不淘汰）
      function putImages(account, id, list) {
        const docKey = keyOf(account, String(id));
        return (async () => {
          const items = (list || []).filter((x) => x && x.url && x.blob);
          if (!items.length) return 0;
          const tx = db.transaction([STORE_ARTICLES, STORE_META, STORE_IMAGES], 'readwrite');
          const art = await reqToPromise(tx.objectStore(STORE_ARTICLES).get(docKey));
          if (!art) { try { tx.abort(); } catch (_) {} return 0; }
          const imgStore = tx.objectStore(STORE_IMAGES);
          let added = 0;
          for (const it of items) {
            const key = docKey + '|' + it.url;
            const old = await reqToPromise(imgStore.get(key));
            const size = Number(it.blob.size) || 0;
            imgStore.put({ key, doc: docKey, url: it.url, blob: it.blob, bytes: size });
            added += size - ((old && Number(old.bytes)) || 0);
          }
          const metaStore = tx.objectStore(STORE_META);
          const m = (await reqToPromise(metaStore.get(docKey))) || { key: docKey, artBytes: 0, imgBytes: 0, lastOpened: now() };
          const artBytes = Number(m.artBytes != null ? m.artBytes : m.bytes) || 0;
          const imgBytes = Math.max(0, (Number(m.imgBytes) || 0) + added);
          metaStore.put(Object.assign({}, m, { artBytes, imgBytes, bytes: artBytes + imgBytes }));
          await txDone(tx);
          await evict(docKey);
          return items.length;
        })().catch(() => 0);
      }

      // v3.4.8：這個帳號所有存在本機的清單卡片縮圖 → Map(文章 id → { url: 縮圖原網址, blob })
      function getThumbs(account) {
        const prefix = account + '|';
        const p = (async () => {
          const tx = db.transaction([STORE_IMAGES], 'readonly');
          const rows = await reqToPromise(tx.objectStore(STORE_IMAGES).getAll());
          const out = new Map();
          for (const r of rows || []) {
            if (!r || !r.blob || typeof r.url !== 'string' || r.url.indexOf(THUMB_PREFIX) !== 0) continue;
            if (typeof r.doc !== 'string' || r.doc.indexOf(prefix) !== 0) continue;
            out.set(r.doc.slice(prefix.length), { url: r.url.slice(THUMB_PREFIX.length), blob: r.blob });
          }
          return out;
        })().catch(() => new Map());
        return withTimeout(p, timeoutMs, new Map());
      }

      // 總用量（除錯 / 驗證用）
      function usage() {
        return (async () => {
          const tx = db.transaction([STORE_META], 'readonly');
          const metas = await reqToPromise(tx.objectStore(STORE_META).getAll());
          return { count: metas.length, bytes: metas.reduce((s, m) => s + (Number(m.bytes) || 0), 0) };
        })().catch(() => null);
      }

      // 清空兩個 object store（設定頁「清除快取」用）。不走 deleteDatabase：Article View
      // 分頁開著時連線還在，deleteDatabase 會 blocked 到分頁關掉為止
      function clear() {
        return (async () => {
          const tx = db.transaction([STORE_ARTICLES, STORE_META, STORE_IMAGES], 'readwrite');
          tx.objectStore(STORE_ARTICLES).clear();
          tx.objectStore(STORE_META).clear();
          tx.objectStore(STORE_IMAGES).clear();
          await txDone(tx);
          return true;
        })().catch(() => false);
      }

      return { get, put, touch, evict, remove, setLocations, usage, clear, keyOf, getImages, putImages, getThumbs, close: () => { try { db.close(); } catch (_) {} } };
    });
  }

  // v3.4.10：通知文章快取「這些文章現在在哪個資料夾」（淘汰時封存的先刪）。清單畫出來、本機搬資料夾成功
  // 都呼叫這一支（單一資料源）。先排隊、LOCATION_FLUSH_MS 內的呼叫合併成一次開庫寫入，避免每次畫清單都開
  // IndexedDB；失敗一律靜默（只影響淘汰順序）。list：[{ id, location }]（文件物件直接丟進來也可以）
  const LOCATION_FLUSH_MS = 1500;
  let locQueue = new Map(); // account → Map(id → location)
  let locTimer = null;
  function noteLocations(account, list, opts) {
    if (!account) return;
    let q = null;
    for (const d of list || []) {
      if (!d || d.id == null || !d.location) continue;
      if (!q) { q = locQueue.get(account) || new Map(); locQueue.set(account, q); }
      q.set(String(d.id), d.location === 'shortlist' ? 'later' : String(d.location));
    }
    if (!q || locTimer) return;
    const setT = global.setTimeout || setTimeout;
    locTimer = setT(() => { locTimer = null; flushLocations(opts); }, LOCATION_FLUSH_MS);
  }
  function flushLocations(opts) {
    const batch = locQueue;
    locQueue = new Map();
    if (!batch.size) return Promise.resolve(0);
    return openArticleStore(opts).then(async (store) => {
      if (!store) return 0;
      let n = 0;
      try {
        for (const [account, q] of batch) {
          n += await store.setLocations(account, Array.from(q, ([id, location]) => ({ id, location })));
        }
      } finally { store.close(); }
      return n;
    }).catch(() => 0);
  }

  // 設定頁用：開庫 → 清空 → 關閉。IndexedDB 不可用 / 開庫失敗回 false
  function clearArticleStore(opts) {
    return openArticleStore(opts).then((store) => {
      if (!store) return false;
      return store.clear().then((ok) => { store.close(); return ok; });
    }).catch(() => false);
  }

  // 設定頁用：{ count, bytes }；不可用回 null
  function articleStoreUsage(opts) {
    return openArticleStore(opts).then((store) => {
      if (!store) return null;
      return store.usage().then((u) => { store.close(); return u; });
    }).catch(() => null);
  }

  // v2.5.4（2026-11-15 review 批 6，批 1 遺留）：防嵌入。reader 兩頁列在
  // web_accessible_resources（iOS「加入主畫面」跳板要從 https 頁導過來），第三方
  // 網頁因此可以用 iframe 把它們嵌進去騙點擊（封存 / 滑動動作）。兩頁 init 第一步
  // 都問這支：不是頂層頁面就不載入任何內容。正常開啟（分頁、跳板轉址、iOS App 的
  // jread-app://）都是頂層頁面，不受影響。讀 top 丟例外也當成被嵌入。
  // 單一資料源：reader-article.js 與 reader-feed.js 都委派這支，不各自判斷。
  const EMBEDDED_TEXT = '無法在內嵌框架中開啟';
  function isEmbeddedFrame(win) {
    try {
      return !!win && win.top !== win.self;
    } catch (_) {
      return true;
    }
  }

  const api = {
    isEmbeddedFrame, EMBEDDED_TEXT,
    FEED_KEY, HIGHLIGHT_KEY, LOCAL_CACHE_KEYS, DB_NAME, ARTICLE_BUDGET, IDB_TIMEOUT_MS,
    FEED_TABS, isTabArchivable,
    accountKey, slimDoc, feedDoc, formatDay, locationLabel, themeColorsOf, pageThemeColors, sourceUrlOf, openSourceUrl, hostOf, ACTION_DONE, trashKeepDays, TRASH_KEEP_DAYS_FALLBACK, subviewUrl, subviewTab, FEED_FIELDS, setFeedNotice, takeFeedNotice, FEED_NOTICE_KEY, byteSize, withTimeout,
    readFeed, writeFeed, removeFromFeed, findFeedDoc, feedSignature,
    isStale, planEviction, noteLocations, flushLocations, LOCATION_FLUSH_MS, pickImageUrl, THUMB_PREFIX, openArticleStore, clearArticleStore, articleStoreUsage,
    OWN_WRITE_KEY, OWN_WRITE_MAX, OWN_WRITE_SLACK_MS, readOwnWrites, planOwnWrite
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.__JReadReaderCache = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
