// JRead — JReader 畫重點（v1.10.0，Jimmy 2026-10-27 需求，只做 Readwise）
//
// Article View（article.html?id=<docId>）內：
//   1. 選取主文文字 → 浮出「畫重點」鈕（或按 H）→ 建 Readwise 重點、主文標 <mark>
//   2. 開文章時把這篇既有的重點（Readwise 網站 / App 畫的）標出來
//   3. 點既有重點 → 浮出「刪除重點」鈕 → 刪 Readwise 重點、拆掉 <mark>
//
// 「顯示既有重點」的資料來源：Readwise v2 export（popup-core exportReaderHighlights），
// 不是 Reader API v3 list——v3 沒有 parent_id 過濾、增量看不到刪除，要對帳只能
// 整批重抓，還跟文章載入共用 20/min 額度（2026-10-27 實測兩輪就把文章載入擠成
// 429）。export 的 book.external_id＝Reader 文件 id，增量（updatedAfter +
// includeDeleted）回「有變動的文章」底下的全部重點 → 整篇替換，刪除自然對帳。
//   - storage.local 快取（readerHighlightCache），開文章先用快取標、背景增量補
//   - 沒快取（第一次 / 換帳號）才全量（577 筆實測 2 頁 ≈ 4.6s，背景跑）
//   - 建立 / 刪除約 6 秒後才反映到 export：本頁的新增 / 刪除記成 local op 保留
//     LOCAL_GRACE_MS，期間的同步結果不能把它蓋回去
//
// 定位（anchoring）：用重點文字在主文裡找，不用 highlight_location——那是
// html_content 原始 DOM 的路徑，sanitizeDom 拆殼 / 移除節點後路徑就對不上。比對
// 時去掉所有空白（跨段落的重點 Readwise 存成 "\n\n" 分隔，主文 textContent 段落
// 之間沒有空白），同一段文字出現多次時用 offset 挑最近的那處。export 的重點文字
// 是 Markdown（粗體 `**`、引言 `> `，2026-10-27 實查），先剝語法再比；還對不上
// 才退到「只比字母數字」的寬鬆比對（代價：頭尾標點可能沒標到）。
//
// 純函式 dual export 供 jsdom spec 測；attach() 只在擴充頁環境跑。
(function (global) {
  'use strict';

  const HL_ATTR = 'data-jread-hl';
  const CACHE_KEY = 'readerHighlightCache';
  const CACHE_VERSION = 2;
  // 增量的 updatedAfter 往回退一段，吸收用戶端與 Readwise 的時鐘差 + export 的
  // 同步延遲（增量是整篇替換，重抓到同一篇沒有副作用）
  const SINCE_SLACK_MS = 5 * 60 * 1000;
  const LOCAL_GRACE_MS = 3 * 60 * 1000;
  const HOST_ID = '__jread-hl-host';
  const STYLE_ID = '__jread-hl-style';
  const TOAST_ID = 'jread-hl';

  // 段落級元素：跨這些元素的選取在送給 Readwise 時要用換行分隔
  const BLOCK_TAGS = new Set([
    'p', 'div', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5',
    'h6', 'blockquote', 'pre', 'figure', 'figcaption', 'table', 'thead', 'tbody',
    'tfoot', 'tr', 'td', 'th', 'caption', 'section', 'article', 'aside', 'header',
    'footer', 'main', 'nav', 'details', 'summary', 'hr', 'address', 'hgroup'
  ]);
  const WS_RE = /\s/;
  // 寬鬆比對只留字母 / 數字（含 CJK）。不支援 \p{} 的舊引擎退回「非空白非 ASCII
  // 標點」
  let ALNUM_RE;
  try { ALNUM_RE = new RegExp('[\\p{L}\\p{N}]', 'u'); } catch (_) { ALNUM_RE = /[^\s!-\/:-@\[-`{-~]/; }
  const keepNonSpace = (ch) => !WS_RE.test(ch);
  const keepAlnum = (ch) => ALNUM_RE.test(ch);

  // ---- 文字索引 ----------------------------------------------------------

  function textNodes(root) {
    const doc = root.ownerDocument;
    const out = [];
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    let n;
    while ((n = walker.nextNode())) out.push(n);
    return out;
  }

  // 扁平字串（只留 keep 判定為真的字元，預設去空白）+ 每個字元對回 (text node,
  // offset)；raw 是含空白的累計位置，給 offset（Readwise 純文字的字元位置）挑最近
  // 的重複出現處用
  function buildIndex(root, keep) {
    const k = keep || keepNonSpace;
    let flat = '';
    const map = [];
    let raw = 0;
    for (const node of textNodes(root)) {
      const s = node.data;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (k(ch)) {
          flat += ch;
          map.push({ node, offset: i, raw: raw + i });
        }
      }
      raw += s.length;
    }
    return { flat, map, keep: k };
  }

  // 找重點文字在主文的位置（needle 用與索引相同的 keep 規則濃縮）。回 { start, end }
  //（flat 座標、end 不含）或 null
  function findMatch(index, content, offsetHint) {
    const k = (index && index.keep) || keepNonSpace;
    const needle = Array.from(String(content || '')).filter(k).join('');
    if (!needle || !index || !index.flat) return null;
    const hits = [];
    let from = 0;
    while (true) {
      const p = index.flat.indexOf(needle, from);
      if (p === -1) break;
      hits.push(p);
      from = p + 1;
    }
    if (!hits.length) return null;
    let best = hits[0];
    if (hits.length > 1 && typeof offsetHint === 'number') {
      let bestDist = Infinity;
      for (const p of hits) {
        const d = Math.abs(index.map[p].raw - offsetHint);
        if (d < bestDist) { bestDist = d; best = p; }
      }
    }
    return { start: best, end: best + needle.length };
  }

  // Readwise export 的 Markdown → 純文字（只處理重點文字實際會出現的語法）
  function markdownToPlain(md) {
    return String(md || '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')               // 圖片
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')             // 連結 → 文字
      .replace(/^[ \t]*(?:>[ \t]?)+/gm, '')                 // 引言
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')                 // 標題
      .replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gm, '')        // 清單
      .replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')    // 粗體 / 刪除線
      .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, '$1$2') // 斜體 *x*
      .replace(/`+/g, '')                                 // 行內程式碼
      .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, '$1');        // 跳脫字元
  }

  // 找重點在 root 內的位置：原文 → 剝 Markdown → 寬鬆（只比字母數字）。回
  // { index, start, end } 或 null
  function locateHighlight(root, h) {
    const content = String((h && h.content) || '');
    const hint = h && h.highlight_offset;
    const plain = markdownToPlain(content);
    const idx = buildIndex(root);
    let m = findMatch(idx, content, hint);
    if (!m && plain !== content) m = findMatch(idx, plain, hint);
    if (m) return { index: idx, start: m.start, end: m.end };
    const loose = buildIndex(root, keepAlnum);
    m = findMatch(loose, plain, hint);
    return m ? { index: loose, start: m.start, end: m.end } : null;
  }

  // flat 範圍 → 逐 text node 的 { node, s, e } 片段（同一節點合併成一段）
  function segmentsForFlatRange(index, start, end) {
    const segs = [];
    for (let i = start; i < end; i++) {
      const m = index.map[i];
      const last = segs[segs.length - 1];
      if (last && last.node === m.node) last.e = m.offset + 1;
      else segs.push({ node: m.node, s: m.offset, e: m.offset + 1 });
    }
    return segs;
  }

  // 選取範圍 → 落在 root 內的 text node 片段（選取超出 root 的部分自動略過）
  function segmentsInRange(root, range) {
    const segs = [];
    if (!root || !range) return segs;
    for (const node of textNodes(root)) {
      if (!range.intersectsNode(node)) continue;
      let s = 0;
      let e = node.data.length;
      if (node === range.startContainer) s = range.startOffset;
      if (node === range.endContainer) e = range.endOffset;
      if (e > s) segs.push({ node, s, e });
    }
    return segs;
  }

  function blockOf(node, root) {
    let el = node.parentNode;
    while (el && el !== root) {
      if (el.nodeType === 1 && BLOCK_TAGS.has(el.localName)) return el;
      el = el.parentNode;
    }
    return root;
  }

  function hasBrBetween(a, b) {
    const doc = a.node.ownerDocument;
    try {
      const r = doc.createRange();
      r.setStart(a.node, a.e);
      r.setEnd(b.node, b.s);
      return !!r.cloneContents().querySelector('br');
    } catch (_) { return false; }
  }

  // 片段 → 送給 Readwise 的文字。跨段落 / <br> 補換行（Readwise 原文在那裡有換行，
  // 直接接起來會 400「Text not found」，2026-10-27 實測）
  function segmentsToText(segs, root) {
    let out = '';
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (i > 0) {
        const prev = segs[i - 1];
        if (blockOf(prev.node, root) !== blockOf(seg.node, root)) out += '\n\n';
        else if (hasBrBetween(prev, seg)) out += '\n';
      }
      out += seg.node.data.slice(seg.s, seg.e);
    }
    return out.trim();
  }

  function isMarked(node) {
    let el = node.parentNode;
    while (el) {
      if (el.nodeType === 1 && el.hasAttribute && el.hasAttribute(HL_ATTR)) return true;
      el = el.parentNode;
    }
    return false;
  }

  // 選取的非空白文字是否已全部在既有重點內（防重複建立——Readwise 對同一段重送
  // 會再建一筆，不會去重）
  function segmentsAllMarked(segs) {
    let any = false;
    for (const seg of segs) {
      const text = seg.node.data.slice(seg.s, seg.e);
      if (!text.trim()) continue;
      any = true;
      if (!isMarked(seg.node)) return false;
    }
    return any;
  }

  // 片段包成 <mark data-jread-hl="id">。純空白片段不包（多半是區塊之間的縮排
  // 換行，包在 <ul> / <tr> 底下是不合法結構）
  function wrapSegments(segs, id) {
    const marks = [];
    for (const seg of segs) {
      const node = seg.node;
      if (!node.parentNode) continue;
      const text = node.data.slice(seg.s, seg.e);
      if (!text.trim()) continue;
      let target = node;
      if (seg.s > 0) target = target.splitText(seg.s);
      if (seg.e - seg.s < target.data.length) target.splitText(seg.e - seg.s);
      const mark = node.ownerDocument.createElement('mark');
      mark.setAttribute(HL_ATTR, id);
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      marks.push(mark);
    }
    return marks;
  }

  function markedIds(root) {
    const ids = new Set();
    for (const m of root.querySelectorAll('mark[' + HL_ATTR + ']')) ids.add(m.getAttribute(HL_ATTR));
    return ids;
  }

  function marksFor(root, id) {
    return Array.from(root.querySelectorAll('mark[' + HL_ATTR + ']'))
      .filter(m => m.getAttribute(HL_ATTR) === id);
  }

  // 拆掉某個重點的 <mark>、合併被切開的 text node。回拆掉的數量
  function unwrapHighlight(root, id) {
    const marks = marksFor(root, id);
    const parents = new Set();
    for (const m of marks) {
      const p = m.parentNode;
      if (!p) continue;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      parents.add(p);
    }
    for (const p of parents) { try { p.normalize(); } catch (_) {} }
    return marks.length;
  }

  // 把一組重點標到 root 上（已標過的 id 跳過）。回成功標上的 id 陣列
  function applyHighlights(root, highlights) {
    const done = [];
    const existing = markedIds(root);
    for (const h of highlights || []) {
      if (!h || !h.id || existing.has(h.id)) continue;
      // 每標一筆 text node 就被切開，索引要重建（locateHighlight 每次重建）
      const loc = locateHighlight(root, h);
      if (!loc) continue;
      const marks = wrapSegments(segmentsForFlatRange(loc.index, loc.start, loc.end), h.id);
      if (marks.length) { done.push(h.id); existing.add(h.id); }
    }
    return done;
  }

  // 對帳：拆掉清單裡已經沒有的重點、補標新的
  function reconcileHighlights(root, highlights) {
    const want = new Set((highlights || []).map(h => h && h.id).filter(Boolean));
    let removed = 0;
    for (const id of markedIds(root)) {
      if (!want.has(id)) removed += unwrapHighlight(root, id) ? 1 : 0;
    }
    const added = applyHighlights(root, highlights);
    return { removed, added: added.length };
  }

  // ---- 快取（storage.local readerHighlightCache）--------------------------
  // { v, account, since, docs: { <文件 id>: [[重點 id, 文字, offset], ...] },
  //   local: { <重點 id>: { t, op:'add'|'del', doc, entry } } }
  // account = token 的雜湊：換帳號 / 換 token 時整份作廢（不存 token 本身）
  // since = 上次同步「開始」的用戶端時間（下次增量從這裡往回退 SINCE_SLACK_MS）

  function accountKey(token) {
    const s = String(token || '').trim();
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'a' + h.toString(16) + '-' + s.length;
  }

  function emptyCache(account) {
    return { v: CACHE_VERSION, account, since: '', docs: {}, local: {} };
  }

  function cacheUsable(cache, account) {
    return !!(cache && cache.v === CACHE_VERSION && cache.account === account &&
      cache.since && cache.docs && typeof cache.docs === 'object');
  }

  function liveEntries(list) {
    return (list || []).filter(h => h && h.id && !h.deleted).map(h => [h.id, h.content, h.offset]);
  }

  // 全量結果 → 新快取（local op 由呼叫端另外接上）
  function cacheFromExport(exportDocs, account, startedAt) {
    const c = emptyCache(account);
    c.since = new Date(startedAt).toISOString();
    for (const docId of Object.keys(exportDocs || {})) {
      const live = liveEntries(exportDocs[docId]);
      if (live.length) c.docs[docId] = live;
    }
    return c;
  }

  // 增量結果 → 有出現的文章整篇替換（增量回的是該篇全部重點，含已刪除）
  function mergeExport(cache, exportDocs, startedAt) {
    const docs = Object.assign({}, cache.docs);
    for (const docId of Object.keys(exportDocs || {})) {
      const live = liveEntries(exportDocs[docId]);
      if (live.length) docs[docId] = live;
      else delete docs[docId];
    }
    return Object.assign({}, cache, { docs, since: new Date(startedAt).toISOString() });
  }

  // 本頁剛做的新增 / 刪除蓋回同步結果（export 還沒反映前不能被蓋掉）；過期的丟掉
  function applyLocalOps(cache, now) {
    const docs = Object.assign({}, cache.docs);
    const local = {};
    for (const id of Object.keys(cache.local || {})) {
      const op = cache.local[id];
      if (!op || !(now - op.t < LOCAL_GRACE_MS)) continue;
      local[id] = op;
      const list = (docs[op.doc] || []).filter(e => e[0] !== id);
      if (op.op === 'add' && op.entry) list.push(op.entry);
      if (list.length) docs[op.doc] = list;
      else delete docs[op.doc];
    }
    return Object.assign({}, cache, { docs, local });
  }

  function cacheAdd(cache, docId, h, now) {
    const entry = [h.id, h.content, h.offset == null ? null : h.offset];
    const local = Object.assign({}, cache.local, { [h.id]: { t: now, op: 'add', doc: docId, entry } });
    return applyLocalOps(Object.assign({}, cache, { local }), now);
  }

  function cacheRemove(cache, docId, id, now) {
    const local = Object.assign({}, cache.local, { [id]: { t: now, op: 'del', doc: docId } });
    return applyLocalOps(Object.assign({}, cache, { local }), now);
  }

  function highlightsForDoc(cache, docId) {
    const list = cache && cache.docs && cache.docs[docId];
    return (list || []).map(e => ({ id: e[0], content: e[1], highlight_offset: e[2] }));
  }

  function incrementalSince(cache) {
    const t = Date.parse(cache && cache.since);
    if (isNaN(t)) return null;
    return new Date(t - SINCE_SLACK_MS).toISOString();
  }

  // ---- 頁面 UI（浮動鈕 + 樣式）--------------------------------------------

  // 半透明黃底 + 文字色沿用主題：淺色 / 灰 / 米色主題是淡黃底深字、深色主題是暗
  // 橄欖底淺字，四主題一份規則不用跟著 data-theme 切。color 的 !important 要贏
  // styler 主題規則 `[ARTICLE] *:where(...) { color }`（0,1,0）——本規則 (0,1,1)
  const PAGE_CSS = `
mark[${HL_ATTR}] {
  background-color: rgba(255, 213, 0, 0.42) !important;
  background-image: none !important;
  color: inherit !important;
  padding: 0 !important;
  border-radius: 2px;
  cursor: pointer;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
mark[${HL_ATTR}][data-jread-hl-active] {
  background-color: rgba(255, 170, 0, 0.6) !important;
}`;

  const BTN_CSS = `
    .btn {
      all: initial;
      display: none;
      position: fixed;
      padding: 7px 14px;
      border-radius: 18px;
      background: #2d3748;
      color: #fff;
      font: 600 13px/1.2 -apple-system, system-ui, "PingFang TC", "Noto Sans TC", sans-serif;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
      -webkit-user-select: none;
      -webkit-tap-highlight-color: transparent;
      pointer-events: auto;
    }
    .btn.show { display: block; }
    .btn.danger { background: #c53030; }
    .btn[aria-busy="true"] { opacity: 0.6; cursor: progress; }
  `;

  const LABEL_CREATE = '畫重點';
  const LABEL_DELETE = '刪除重點';
  const GAP = 10;

  function errorMessage(r, action, PC) {
    if (r && r.error === 'NOT_FOUND') return '這段文字在 Readwise 的原文裡找不到，無法畫重點';
    if (PC && typeof PC.serviceErrorMessage === 'function') return PC.serviceErrorMessage(r, { action });
    return action + '失敗';
  }

  // 主流程。ctx：{ doc, win, bodyEl, docId, token, PC, NS, storage, now? }
  // storage = browser.storage.local（get/set 回 Promise）
  function attach(ctx) {
    const { doc, win, bodyEl, docId, token, PC, NS, storage } = ctx;
    const now = ctx.now || (() => Date.now());
    if (!doc || !win || !bodyEl || !docId || !token || !PC) return null;
    const account = accountKey(token);
    let cache = null;
    let busy = false;
    let mode = null;          // 'create' | 'delete' | null
    let activeId = null;      // delete 模式指向的重點
    let pendingRange = null;  // create 模式的選取（live Range，DOM 變動會自動調整）

    // 樣式
    if (!doc.getElementById(STYLE_ID)) {
      const st = doc.createElement('style');
      st.id = STYLE_ID;
      st.textContent = PAGE_CSS;
      (doc.head || doc.documentElement).appendChild(st);
    }

    // 浮動鈕：shadow host 掛 <html> 直下（同 toast：不進 body、不被 styler 掃到）
    const host = doc.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 2147483646; display: block';
    const shadow = host.attachShadow({ mode: 'open' });
    const btn = doc.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    shadow.appendChild(btn);
    if (NS && typeof NS.injectShadowCss === 'function') NS.injectShadowCss(shadow, BTN_CSS);
    else { const s = doc.createElement('style'); s.textContent = BTN_CSS; shadow.appendChild(s); }
    doc.documentElement.appendChild(host);

    const toast = (msg, kind) => {
      if (NS && NS.toast && typeof NS.toast.show === 'function') NS.toast.show(msg, { kind: kind || 'error', id: TOAST_ID, duration: 3500 });
    };

    function setActive(id) {
      for (const m of bodyEl.querySelectorAll('mark[data-jread-hl-active]')) m.removeAttribute('data-jread-hl-active');
      activeId = id;
      if (id) for (const m of marksFor(bodyEl, id)) m.setAttribute('data-jread-hl-active', '');
    }

    function hide() {
      mode = null;
      pendingRange = null;
      setActive(null);
      btn.classList.remove('show');
    }

    // 鈕放在目標下方置中；下方放不下改放上方；左右夾在視窗內
    function place(rect) {
      if (!rect) return;
      const vw = win.innerWidth || doc.documentElement.clientWidth || 0;
      const vh = win.innerHeight || doc.documentElement.clientHeight || 0;
      const bw = btn.offsetWidth || 90;
      const bh = btn.offsetHeight || 32;
      let top = rect.bottom + GAP;
      if (top + bh > vh - 4) top = rect.top - GAP - bh;
      top = Math.max(4, Math.min(top, vh - bh - 4));
      let left = rect.left + rect.width / 2 - bw / 2;
      left = Math.max(4, Math.min(left, vw - bw - 4));
      btn.style.top = top + 'px';
      btn.style.left = left + 'px';
    }

    function targetRect() {
      if (mode === 'create' && pendingRange) {
        const rects = pendingRange.getClientRects ? Array.from(pendingRange.getClientRects()) : [];
        const last = rects.filter(r => r.width > 0 || r.height > 0).pop();
        return last || (pendingRange.getBoundingClientRect ? pendingRange.getBoundingClientRect() : null);
      }
      if (mode === 'delete' && activeId) {
        const ms = marksFor(bodyEl, activeId);
        if (!ms.length) return null;
        const rects = ms[ms.length - 1].getClientRects();
        return rects.length ? rects[rects.length - 1] : ms[ms.length - 1].getBoundingClientRect();
      }
      return null;
    }

    function show(nextMode) {
      mode = nextMode;
      btn.textContent = nextMode === 'delete' ? LABEL_DELETE : LABEL_CREATE;
      btn.classList.toggle('danger', nextMode === 'delete');
      btn.classList.add('show');
      place(targetRect());
    }

    // 目前選取（限主文 body 內、要有非空白文字）。回 { range, segs } 或 null
    function currentSelection() {
      const sel = doc.getSelection ? doc.getSelection() : null;
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      const range = sel.getRangeAt(0);
      if (!range.intersectsNode(bodyEl)) return null;
      const segs = segmentsInRange(bodyEl, range);
      if (!segs.some(s => s.node.data.slice(s.s, s.e).trim())) return null;
      return { range, segs };
    }

    function onSelectionMaybeChanged() {
      if (busy) return;
      const cur = currentSelection();
      if (cur) {
        setActive(null);
        pendingRange = cur.range.cloneRange();
        show('create');
      } else if (mode === 'create') {
        hide();
      }
    }

    let selTimer = null;
    function scheduleSelectionCheck() {
      if (selTimer) clearTimeout(selTimer);
      selTimer = setTimeout(() => { selTimer = null; onSelectionMaybeChanged(); }, 120);
    }

    async function persist() {
      if (!storage || !cache) return;
      try { await storage.set({ [CACHE_KEY]: cache }); } catch (_) { /* 快取寫不進去不影響功能 */ }
    }

    async function createFromSelection() {
      if (busy) return;
      const cur = currentSelection();
      const range = cur ? cur.range.cloneRange() : pendingRange;
      if (!range) return;
      const segs = segmentsInRange(bodyEl, range);
      if (segmentsAllMarked(segs)) { hide(); return; }
      const content = segmentsToText(segs, bodyEl);
      if (!content) { hide(); return; }
      busy = true;
      btn.setAttribute('aria-busy', 'true');
      let r;
      try {
        r = await PC.createReaderHighlight({ token, parentId: docId, content });
      } catch (err) {
        r = { ok: false, error: 'NETWORK', message: String(err && err.message || err) };
      }
      busy = false;
      btn.removeAttribute('aria-busy');
      if (!r || !r.ok) { toast(errorMessage(r, '畫重點', PC)); return; }
      // range 是 live Range：await 期間背景同步若切開了 text node，它會跟著調整
      wrapSegments(segmentsInRange(bodyEl, range), r.id);
      try { const sel = doc.getSelection(); if (sel) sel.removeAllRanges(); } catch (_) {}
      hide();
      cache = cacheAdd(cache || emptyCache(account), docId, { id: r.id, content, offset: null }, now());
      persist();
    }

    async function deleteActive() {
      if (busy || !activeId) return;
      const id = activeId;
      busy = true;
      btn.setAttribute('aria-busy', 'true');
      let r;
      try {
        r = await PC.deleteReaderDocument({ token, id });
      } catch (err) {
        r = { ok: false, error: 'NETWORK', message: String(err && err.message || err) };
      }
      busy = false;
      btn.removeAttribute('aria-busy');
      if (!r || !r.ok) { toast(errorMessage(r, '刪除重點', PC)); return; }
      hide();
      unwrapHighlight(bodyEl, id);
      cache = cacheRemove(cache || emptyCache(account), docId, id, now());
      persist();
    }

    // 按鈕：pointerdown/mousedown preventDefault——按下去不能把選取清掉
    const keepSelection = (e) => { e.preventDefault(); e.stopPropagation(); };
    btn.addEventListener('pointerdown', keepSelection);
    btn.addEventListener('mousedown', keepSelection);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (mode === 'create') createFromSelection();
      else if (mode === 'delete') deleteActive();
    });

    doc.addEventListener('selectionchange', scheduleSelectionCheck);
    doc.addEventListener('mouseup', scheduleSelectionCheck);
    doc.addEventListener('touchend', scheduleSelectionCheck);

    // 點既有重點（沒有選取時）→ 刪除鈕；點別處 → 收起
    doc.addEventListener('click', (e) => {
      if (busy) return;
      if (e.composedPath && e.composedPath().indexOf(host) !== -1) return;
      const sel = doc.getSelection ? doc.getSelection() : null;
      if (sel && !sel.isCollapsed) return;
      const t = e.target;
      const mark = t && t.closest ? t.closest('mark[' + HL_ATTR + ']') : null;
      if (mark && bodyEl.contains(mark)) {
        setActive(mark.getAttribute(HL_ATTR));
        show('delete');
      } else if (mode) {
        hide();
      }
    });

    // H 鍵：有選取時畫重點。window capture、在 enterFromContainer 之前註冊——
    // main.js keyguard 也掛 window capture 且會 stopImmediatePropagation，同階段
    // 依註冊順序執行，先註冊才收得到
    win.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== 'h' && e.key !== 'H') return;
      if (NS && typeof NS.isTextInputTarget === 'function' && NS.isTextInputTarget(e.target)) return;
      if (!currentSelection()) return;
      e.preventDefault();
      e.stopPropagation();
      createFromSelection();
    }, true);

    // 捲動 / 翻頁 / 縮放時鈕跟著目標走（fixed 定位，目標移動要重算）
    let rafPending = false;
    const reposition = () => {
      if (!mode || rafPending) return;
      rafPending = true;
      (win.requestAnimationFrame || ((cb) => setTimeout(cb, 16)))(() => {
        rafPending = false;
        if (mode) place(targetRect());
      });
    };
    win.addEventListener('scroll', reposition, true);
    win.addEventListener('resize', reposition);

    // 既有重點：先用快取標，再背景同步
    async function sync() {
      let stored = null;
      try {
        const got = storage ? await storage.get(CACHE_KEY) : null;
        stored = got && got[CACHE_KEY];
      } catch (_) { stored = null; }
      if (!cache && cacheUsable(stored, account)) cache = stored;
      if (cache) applyHighlights(bodyEl, highlightsForDoc(cache, docId));

      const full = !cacheUsable(cache, account);
      const startedAt = now();
      const r = await PC.exportReaderHighlights(full ? { token } : { token, updatedAfter: incrementalSince(cache) });
      if (!r || !r.ok) return { ok: false };  // 同步失敗：留著快取標的結果，不打擾使用者
      // await 期間本頁可能新增 / 刪除過（cache 已即時更新）——local op 一併帶過去
      let next = full ? cacheFromExport(r.docs, account, startedAt) : mergeExport(cache, r.docs, startedAt);
      next.local = Object.assign({}, cache && cache.local);
      next = applyLocalOps(next, now());
      cache = next;
      if (!busy) reconcileHighlights(bodyEl, highlightsForDoc(cache, docId));
      await persist();
      return { ok: true, full };
    }

    const ready = sync().catch(() => ({ ok: false }));
    return { ready, hide, host };
  }

  const api = {
    HL_ATTR, CACHE_KEY, LOCAL_GRACE_MS, SINCE_SLACK_MS,
    buildIndex, findMatch, markdownToPlain, locateHighlight, segmentsForFlatRange, segmentsInRange, segmentsToText,
    segmentsAllMarked, wrapSegments, unwrapHighlight, applyHighlights, reconcileHighlights,
    accountKey, emptyCache, cacheUsable, cacheFromExport, mergeExport, applyLocalOps,
    cacheAdd, cacheRemove, highlightsForDoc, incrementalSince, attach
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.__JReadReaderHighlights = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
