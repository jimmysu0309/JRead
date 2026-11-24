// JRead — Article View 文章資訊面板（v3.1.0）
//
// 按 I（或懸浮按鈕選單「文章資訊」）從右側滑出的抽屜；窄螢幕（< 720px）改成從底部
// 升起的面板。平常不佔版面——Readwise Reader 的常駐右側欄會擠壓 JRead 的閱讀寬度與
// 翻頁排版，所以改成按需打開、蓋在內容上、不重排內文。
//
// 只有儲存服務是 JReader 時掛上（PC.supportsLibraryTools 單一判準）：標籤編輯走
// JReader 的 PUT /api/v1/documents/<id>/tags，Readwise 沒有對應端點。
//
// 顏色跟著目前的 JRead 主題：打開時讀閱讀卡（styler 套好的容器）的實際背景 / 文字 /
// 連結色，面板放在 shadow DOM 裡，頁面與 styler 的樣式都碰不到它。
//
// dual export：module.exports 給 jsdom spec、window.__JReadReaderInfo 給頁面。
(function (global) {
  'use strict';

  const WIDE_MIN_PX = 720;
  const HOST_ID = '__jread-info-host';
  const DRAG_CLOSE_PX = 80;
  const NOTES_SAVE_MS = 800; // 筆記停頓多久自動存
  // 閱讀速度（成人默讀一般文章）：
  // - 英文 238 詞／分：Brysbaert 2019 統合分析（190 篇研究、1.9 萬人）非小說的平均值
  //   （Journal of Memory and Language 109, 104047）
  // - 中日文 380 字／分：中文沒有同等規模的統合研究，各研究在 250–500 字之間。取最貼近
  //   「默讀一般文章」的心理學報 2020（52(8) 933–945）句子默讀作業快、慢讀者（458 / 299）的平均
  const CJK_CHARS_PER_MIN = 380;
  const LATIN_WORDS_PER_MIN = 238;

  const LOCATIONS = [
    { id: 'new', label: 'Inbox' },
    { id: 'later', label: 'Later' },
    { id: 'archive', label: 'Archive' }
  ];
  const LOCATION_DONE = { new: '已移到 Inbox', later: '已移到 Later', archive: '已封存' };

  function ymd(raw) {
    if (raw == null || raw === '') return '';
    const n = typeof raw === 'number' ? raw : (/^\d+$/.test(String(raw)) ? Number(raw) : NaN);
    const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(raw));
    if (isNaN(d.getTime())) return '';
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // 估計閱讀時間（分鐘，至少 1；沒有字數回 null）。
  // JReader 回中日韓字數（cjk_char_count）與其他語言詞數（latin_word_count）時兩者各用各的
  // 速度再相加——中英混雜的文章才準。沒有這兩欄（舊版伺服器）退回 word_count 整篇套一種速度，
  // cjkFallback＝這篇以中日文為主
  function readingMinutes(doc, cjkFallback) {
    const d = doc || {};
    const cjk = Number(d.cjk_char_count);
    const latin = Number(d.latin_word_count);
    let min;
    if (Number.isFinite(cjk) && Number.isFinite(latin) && d.cjk_char_count != null && d.latin_word_count != null) {
      min = cjk / CJK_CHARS_PER_MIN + latin / LATIN_WORDS_PER_MIN;
    } else {
      const n = Number(d.word_count);
      if (!Number.isFinite(n)) return null;
      min = n / (cjkFallback ? CJK_CHARS_PER_MIN : LATIN_WORDS_PER_MIN);
    }
    if (!(min > 0)) return null;
    return Math.max(1, Math.round(min));
  }

  // Readwise 形狀的 tags（{ key: { name } }）或字串陣列 → 名稱陣列
  function tagNames(tags) {
    if (Array.isArray(tags)) return tags.map(String).filter(Boolean);
    if (tags && typeof tags === 'object') {
      return Object.keys(tags).map((k) => (tags[k] && tags[k].name) || k).filter(Boolean);
    }
    return [];
  }

  // 新增標籤：去頭尾空白、空的不加、大小寫不同視為同一個（與 JReader 伺服器一致）
  function addTag(list, raw) {
    const name = String(raw || '').trim();
    if (!name) return list;
    if (list.some((t) => t.toLowerCase() === name.toLowerCase())) return list;
    return list.concat(name);
  }

  // 自動完成：前綴比對、不分大小寫、排除已加上的，最多 6 個
  function suggestTags(all, typed, current) {
    const q = String(typed || '').trim().toLowerCase();
    if (!q) return [];
    const have = new Set((current || []).map((t) => t.toLowerCase()));
    return (all || []).map((t) => String(t.name || t))
      .filter((n) => n.toLowerCase().startsWith(q) && !have.has(n.toLowerCase()))
      .slice(0, 6);
  }

  // 目前閱讀進度（0–1）：翻頁模式讀頁碼，捲動模式讀捲動位置
  function currentProgress(win, NS) {
    const pm = NS && NS.pagedMode;
    const pos = pm && typeof pm.getPosition === 'function' ? pm.getPosition() : null;
    if (pos && pos.total > 0) return pos.total <= 1 ? 1 : pos.idx / (pos.total - 1);
    const de = win.document.documentElement;
    const max = Math.max(0, (de.scrollHeight || 0) - (win.innerHeight || 0));
    if (!max) return 0;
    return Math.min(1, Math.max(0, (win.scrollY || 0) / max));
  }

  const CSS = `
    :host { all: initial; }
    .backdrop { position: fixed; inset: 0; z-index: 2147483600; background: transparent; }
    .panel {
      position: fixed; z-index: 2147483601; box-sizing: border-box; overflow-y: auto;
      background: var(--bg); color: var(--fg);
      font: 14px/1.55 system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif;
      -webkit-font-smoothing: antialiased; overscroll-behavior: contain;
    }
    .panel.wide {
      top: 0; right: 0; bottom: 0; width: 320px; padding: 20px 20px 28px;
      box-shadow: -8px 0 24px rgba(0,0,0,.14); border-left: 1px solid var(--line);
      transform: translateX(100%); transition: transform 200ms ease-out;
    }
    .panel.sheet {
      left: 0; right: 0; bottom: 0; max-height: 70vh; padding: 8px 20px 28px;
      border-radius: 14px 14px 0 0; box-shadow: 0 -8px 24px rgba(0,0,0,.16);
      transform: translateY(100%); transition: transform 200ms ease-out;
    }
    .panel.open { transform: none; }
    @media (prefers-reduced-motion: reduce) { .panel { transition: none; } }
    .grab { display: block; width: 40px; height: 5px; margin: 0 auto 12px; border-radius: 3px; background: var(--line); touch-action: none; }
    .panel.wide .grab { display: none; }
    .head { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 14px; }
    .title {
      flex: 1 1 auto; margin: 0; font-size: 17px; font-weight: 700; line-height: 1.4;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    }
    .close {
      flex: 0 0 auto; width: 28px; height: 28px; margin: -2px -6px 0 0; border: 0; border-radius: 14px;
      background: transparent; color: var(--muted); font-size: 18px; cursor: pointer;
    }
    .close:hover { background: var(--line); }
    .row { margin: 0 0 12px; }
    .label { display: block; font-size: 12px; color: var(--muted); margin: 0 0 4px; }
    .muted { color: var(--muted); }
    .nowrap { white-space: nowrap; }
    a { color: var(--link); text-decoration: underline; text-underline-offset: 2px; }
    /* 點了看同作者 / 同網域的文章（留在 JReader）：虛線底線；開原文（離開）是實線＋↗ */
    .pivot { padding: 0; border: 0; background: none; font: inherit; color: var(--link); cursor: pointer;
      text-decoration: underline dashed; text-underline-offset: 3px; text-align: left; }
    .pivot:hover { text-decoration-style: solid; }
    .sep { color: var(--muted); }
    .bar { height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; margin: 6px 0 0; }
    .bar > i { display: block; height: 100%; background: var(--link); }
    .seg { display: flex; gap: 4px; padding: 3px; border-radius: 10px; background: var(--line); }
    .seg button {
      flex: 1; height: 30px; border: 0; border-radius: 7px; background: transparent;
      color: var(--muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .seg button.on { background: var(--bg); color: var(--fg); box-shadow: 0 1px 3px rgba(0,0,0,.14); }
    .seg button:disabled { cursor: default; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      display: inline-flex; align-items: center; gap: 2px; height: 26px; padding: 0 2px 0 10px;
      border: 1px solid var(--line); border-radius: 13px; font-size: 13px;
    }
    .chip button {
      width: 20px; height: 20px; border: 0; border-radius: 10px; background: transparent;
      color: var(--muted); font-size: 14px; line-height: 1; cursor: pointer;
    }
    .chip button:hover { background: var(--line); }
    .tag-input-wrap { position: relative; margin-top: 8px; }
    .tag-input {
      box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px;
      border: 1px solid var(--line); border-radius: 8px; background: transparent;
      color: var(--fg); font: inherit; font-size: 13px; outline: none;
    }
    .tag-input:focus { border-color: var(--link); }
    .tag-input::placeholder { color: var(--muted); }
    .suggest {
      position: absolute; left: 0; right: 0; top: 34px; z-index: 1; padding: 4px;
      background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
      box-shadow: 0 6px 18px rgba(0,0,0,.16);
    }
    .suggest[hidden] { display: none; }
    .suggest button {
      display: block; width: 100%; text-align: left; padding: 6px 8px; border: 0; border-radius: 6px;
      background: transparent; color: var(--fg); font: inherit; font-size: 13px; cursor: pointer;
    }
    .suggest button:hover, .suggest button.active { background: var(--line); }
    .linkbtn {
      padding: 0; border: 0; background: none; color: var(--link); font: inherit; cursor: pointer;
      text-decoration: underline; text-underline-offset: 2px;
    }
    .summary { white-space: pre-wrap; }
    .notes {
      box-sizing: border-box; width: 100%; min-height: 64px; padding: 8px 10px; resize: none; overflow: hidden;
      border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--fg);
      font: inherit; font-size: 14px; line-height: 1.55; outline: none;
    }
    .notes:focus { border-color: var(--link); }
    .notes::placeholder { color: var(--muted); }
    .note-status { display: block; min-height: 16px; margin-top: 2px; font-size: 12px; color: var(--muted); }
    .hl-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
    .hl-item {
      display: block; width: 100%; text-align: left; padding: 6px 8px 6px 10px; border: 0; border-left: 3px solid var(--link);
      border-radius: 0 6px 6px 0; background: transparent; color: var(--fg); font: inherit; font-size: 13px; line-height: 1.5;
      cursor: pointer;
    }
    .hl-item:hover, .hl-item:focus-visible { background: var(--line); outline: none; }
    .hl-text { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .danger-row { margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--line); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .act { height: 32px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent;
      color: var(--fg); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .act.danger { color: #c62828; }
    .trash-note { flex: 1 0 100%; font-size: 12px; color: var(--muted); }
    .share-url { display: block; margin: 0 0 8px; font-size: 13px; word-break: break-all; }
    .share-row { display: flex; gap: 8px; flex-wrap: wrap; }
  `;

  function el(document, tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // 從閱讀卡讀目前主題的顏色（styler 已套用）。拿不到就用中性預設
  function themeColors(win, container) {
    const out = { bg: '#ffffff', fg: '#1a1a1a', muted: '#6b6b6b', link: '#1a73e8', line: 'rgba(0,0,0,0.1)' };
    try {
      const cs = win.getComputedStyle(container);
      const bg = cs.backgroundColor;
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) out.bg = bg;
      if (cs.color) out.fg = cs.color;
      const a = container.querySelector('a[href]');
      if (a) out.link = win.getComputedStyle(a).color || out.link;
      // muted / line 由文字色推：同色降透明度
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(out.fg);
      if (m) {
        out.muted = 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',0.62)';
        out.line = 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',0.14)';
      }
    } catch (_) { /* 用預設 */ }
    return out;
  }

  // opts：{ doc, win, NS, PC, service, creds, docData, container, RC?, storage?, toast? }
  // 回 { open, close, toggle, isOpen, render }（spec 用）；不支援的服務回 null
  function attach(opts) {
    const o = opts || {};
    const { doc, win, NS, PC, service, creds, container } = o;
    if (!doc || !win || !PC || typeof PC.supportsLibraryTools !== 'function' || !PC.supportsLibraryTools(service)) return null;
    if (!creds || !creds.token || !o.docData || o.docData.id == null) return null;
    const id = String(o.docData.id);
    const rw = { token: creds.token, base: creds.base };
    const RC = o.RC || global.__JReadReaderCache;
    const storage = o.storage || (global.browser && global.browser.storage && global.browser.storage.local);
    let data = Object.assign({}, o.docData);
    let tags = tagNames(data.tags);
    let allTags = null;
    let opened = false;
    let hostEl = null;
    let shadow = null;
    let panel = null;
    let backdrop = null;
    let hlCursor = -1;
    let tagKeyHandler = null; // 目前畫面上那個標籤輸入框的按鍵處理（render 會重建輸入框）
    // 文章筆記：notesDraft＝輸入框目前的內容（render 重建輸入框時沿用，打到一半不會被洗掉）、
    // notesSaved＝伺服器上的值；停頓 NOTES_SAVE_MS 自動存、失焦 / 關面板立刻存
    let notesSaved = typeof o.docData.notes === 'string' ? o.docData.notes : '';
    let notesDraft = notesSaved;
    let notesTimer = null;
    let notesStatus = '';

    const toast = o.toast || ((msg, kind) => {
      if (NS && NS.toast && typeof NS.toast.show === 'function') NS.toast.show(msg, { kind: kind || 'info', id: 'jr-info' });
    });

    function isCjkDoc() {
      if (/^(zh|ja)/i.test(String(data.language || ''))) return true;
      const text = container ? String(container.textContent || '').slice(0, 2000) : '';
      const han = (text.match(/[㐀-鿿぀-ヿ]/g) || []).length;
      return han > text.replace(/\s/g, '').length * 0.3;
    }

    // 每個重點的完整文字（同一個重點可能跨好幾個 <mark>），照文章裡的順序
    function highlightTexts() {
      const HL = global.__JReadReaderHighlights;
      const attr = (HL && HL.HL_ATTR) || 'data-jread-hl';
      const out = [];
      const byId = new Map();
      if (!container) return out;
      for (const m of container.querySelectorAll('[' + attr + ']')) {
        const k = m.getAttribute(attr);
        if (!byId.has(k)) { byId.set(k, out.length); out.push(''); }
        out[byId.get(k)] += m.textContent;
      }
      return out.map((t) => t.replace(/\s+/g, ' ').trim());
    }

    async function saveNotes() {
      if (notesTimer) { win.clearTimeout(notesTimer); notesTimer = null; }
      const value = notesDraft;
      if (value === notesSaved) return;
      setNotesStatus('儲存中…');
      let r;
      try { r = await PC.setJReaderNotes(Object.assign({ id, notes: value }, rw)); } catch (_) { r = null; }
      if (!r || !r.ok) { setNotesStatus('儲存失敗，稍後再試'); return; }
      notesSaved = value;
      if (o.docData) o.docData.notes = value;
      setNotesStatus(notesDraft === value ? '已儲存' : '');
    }
    function setNotesStatus(text) {
      notesStatus = text;
      const s = shadow && shadow.querySelector && shadow.querySelector('.note-status');
      if (s) s.textContent = text;
    }

    function marks() {
      const HL = global.__JReadReaderHighlights;
      const attr = (HL && HL.HL_ATTR) || 'data-jread-hl';
      if (!container) return [];
      const seen = new Set();
      const firsts = [];
      for (const m of container.querySelectorAll('[' + attr + ']')) {
        const k = m.getAttribute(attr);
        if (seen.has(k)) continue;
        seen.add(k);
        firsts.push(m);
      }
      return firsts;
    }

    // 捲到下一個重點（循環）。翻頁模式用頁碼跳：元素相對目前頁的水平位移 ÷ 頁寬
    function gotoNextHighlight() {
      const list = marks();
      if (!list.length) return;
      gotoHighlight((hlCursor + 1) % list.length);
    }
    // 跳到第 i 個重點。寬畫面（右側抽屜）不關面板，方便沿著清單一個個看；窄畫面（底部面板蓋住文章）關掉
    function gotoHighlight(i) {
      const list = marks();
      if (!list[i]) return;
      hlCursor = i;
      const m = list[i];
      const pm = NS && NS.pagedMode;
      const pos = pm && typeof pm.getPosition === 'function' ? pm.getPosition() : null;
      if (!panel || !panel.classList.contains('wide')) close();
      if (pos && pos.total > 1 && typeof pm.goToPage === 'function') {
        const stride = (container && container.clientWidth) || win.innerWidth || 1;
        const r = m.getBoundingClientRect();
        const cr = container ? container.getBoundingClientRect() : { left: 0 };
        pm.goToPage(Math.max(0, Math.min(pos.total - 1, pos.idx + Math.floor((r.left - cr.left) / stride))));
      } else if (typeof m.scrollIntoView === 'function') {
        m.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }

    async function move(loc) {
      if (loc === data.location) return;
      const prev = data.location;
      data.location = loc;
      render();
      let r;
      try { r = await PC.moveReaderDocument(Object.assign({ id, location: loc }, rw)); } catch (_) { r = null; }
      if (!r || !r.ok) {
        data.location = prev;
        render();
        toast(PC.serviceErrorMessage ? PC.serviceErrorMessage(r, { action: '移動' }) : '移動失敗', 'error');
        return;
      }
      // 原本那份清單快取不再正確（文章換了資料夾），整篇從 feed 快取拿掉，回清單時重抓
      if (RC && typeof RC.removeFromFeed === 'function' && typeof RC.accountKey === 'function' && storage) {
        try { await RC.removeFromFeed(storage, RC.accountKey(service, creds), id); } catch (_) {}
      }
      if (o.docData) o.docData.location = loc;
      toast(LOCATION_DONE[loc] || '已移動', 'success');
    }

    async function saveTags(next) {
      const prev = tags;
      tags = next;
      render();
      let r;
      try { r = await PC.setJReaderTags(Object.assign({ id, tags: next }, rw)); } catch (_) { r = null; }
      if (!r || !r.ok) {
        tags = prev;
        render();
        toast(PC.serviceErrorMessage ? PC.serviceErrorMessage(r, { action: '更新標籤' }) : '更新標籤失敗', 'error');
        return;
      }
      tags = Array.isArray(r.tags) ? r.tags.map(String) : next;
      allTags = null; // 下次自動完成重抓（篇數變了、可能多了新標籤）
      render();
    }

    // 分享：create 產生（成功自動複製）、copy 複製、stop 停止（先確認）
    async function copyText(text) {
      try {
        await win.navigator.clipboard.writeText(text);
        return true;
      } catch (_) { return false; }
    }
    async function shareAction(kind) {
      if (kind === 'copy') {
        toast((await copyText(String(data.share_url || ''))) ? '已複製分享連結' : '複製失敗，請直接選取網址', (data.share_url ? 'success' : 'error'));
        return null;
      }
      if (kind === 'stop') {
        const D = o.dialog || global.__JReadReaderDialog;
        const ok = D && typeof D.confirm === 'function' && await D.confirm({
          title: '停止分享？', message: '已經傳出去的連結會失效。之後再分享會是新的網址', confirmLabel: '停止分享', danger: true
        });
        if (!ok) return null;
      }
      let r;
      try {
        r = kind === 'create'
          ? await PC.shareJReaderDocument(Object.assign({ id }, rw))
          : await PC.unshareJReaderDocument(Object.assign({ id }, rw));
      } catch (_) { r = null; }
      if (!r || !r.ok) {
        toast(PC.serviceErrorMessage ? PC.serviceErrorMessage(r, { action: kind === 'create' ? '分享' : '停止分享' }) : '失敗', 'error');
        return r;
      }
      data.share_url = kind === 'create' ? (r.data && r.data.url) || null : null;
      if (o.docData) o.docData.share_url = data.share_url;
      render();
      if (kind === 'create' && data.share_url) {
        toast((await copyText(data.share_url)) ? '已產生並複製分享連結' : '已產生分享連結', 'success');
      } else if (kind === 'stop') {
        toast('已停止分享', 'success');
      }
      return r;
    }

    // 刪除 / 還原 / 永久刪除。刪除與永久刪除先確認（reader-dialog.js），成功後：刪掉的回清單並留提示
    //（RC.setFeedNotice），還原的留在這頁、面板更新
    const TRASH_FN = { trash: 'trashJReaderDocument', restore: 'restoreJReaderDocument', purge: 'purgeJReaderDocument' };
    const TRASH_DONE = { trash: '已移到垃圾桶', restore: '已還原', purge: '已永久刪除' };
    async function trashAction(kind) {
      const D = o.dialog || global.__JReadReaderDialog;
      const text = D && typeof D.trashConfirmText === 'function' ? D.trashConfirmText(kind, data) : null;
      if (text && !(D && typeof D.confirm === 'function' && await D.confirm(text))) return null;
      let r;
      try { r = await PC[TRASH_FN[kind]](Object.assign({ id }, rw)); } catch (_) { r = null; }
      if (!r || !r.ok) {
        toast(PC.serviceErrorMessage ? PC.serviceErrorMessage(r, { action: kind === 'restore' ? '還原' : '刪除' }) : '失敗', 'error');
        return r;
      }
      if (kind === 'restore') {
        data.deleted_at = null;
        if (o.docData) o.docData.deleted_at = null;
        render();
        toast(TRASH_DONE.restore, 'success');
        return r;
      }
      if (RC && typeof RC.removeFromFeed === 'function' && typeof RC.accountKey === 'function' && storage) {
        try { await RC.removeFromFeed(storage, RC.accountKey(service, creds), id); } catch (_) {}
      }
      if (RC && typeof RC.setFeedNotice === 'function') {
        let session = o.session;
        if (session === undefined) { try { session = win.sessionStorage; } catch (_) { session = null; } }
        const raw = data.title ? String(data.title) : '';
        RC.setFeedNotice(session, TRASH_DONE[kind] + (raw ? '：' + (raw.length > 40 ? raw.slice(0, 40) + '…' : raw) : ''), 'success');
      }
      close();
      const exit = o.exit || (NS && NS.onReaderExit);
      if (typeof exit === 'function') exit();
      return r;
    }

    function ensureHost() {
      if (hostEl && hostEl.isConnected) return;
      hostEl = doc.createElement('div');
      hostEl.id = HOST_ID;
      // 掛 <html> 直下、不進 body（同重點浮動鈕與 toast）：閱讀模式會把 body 底下非主文的
      // 元素全部 display:none（styler 的 ancestor 隱藏規則）
      hostEl.style.cssText = 'all: initial; display: none;';
      shadow = hostEl.attachShadow ? hostEl.attachShadow({ mode: 'open' }) : hostEl;
      const style = doc.createElement('style');
      style.textContent = CSS;
      shadow.appendChild(style);
      backdrop = el(doc, 'div', 'backdrop');
      backdrop.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });
      panel = el(doc, 'aside', 'panel');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', '文章資訊');
      shadow.appendChild(backdrop);
      shadow.appendChild(panel);
      doc.documentElement.appendChild(hostEl);
    }

    // 點了回清單看「同作者 / 同網域」（reader-feed 的子清單，?tab=author:… / site:…；back＝文章原本的分頁）
    function pivot(text, kind, value, title) {
      const b = el(doc, 'button', 'pivot', text);
      b.type = 'button';
      b.setAttribute('data-pivot', kind);
      b.title = title;
      b.addEventListener('click', () => {
        const RCM = RC || global.__JReadReaderCache;
        const url = RCM && typeof RCM.subviewUrl === 'function' ? RCM.subviewUrl(kind, value, o.tab) : null;
        if (!url) return;
        close();
        const nav = o.navigate || ((u) => { win.location.href = u; });
        nav(url);
      });
      return b;
    }

    function row(label, content) {
      const r = el(doc, 'div', 'row');
      if (label) r.appendChild(el(doc, 'span', 'label', label));
      if (typeof content === 'string') r.appendChild(doc.createTextNode(content));
      else if (content) r.appendChild(content);
      return r;
    }

    function render() {
      if (!panel) return;
      const focusedTagInput = shadow.activeElement && shadow.activeElement.classList && shadow.activeElement.classList.contains('tag-input');
      const focusedNotes = !!(shadow.activeElement && shadow.activeElement.classList && shadow.activeElement.classList.contains('notes'));
      const notesCaret = focusedNotes ? shadow.activeElement.selectionStart : null;
      const typed = focusedTagInput ? shadow.activeElement.value : '';
      panel.textContent = '';
      const grab = el(doc, 'span', 'grab');
      grab.setAttribute('aria-hidden', 'true');
      attachDrag(grab);
      panel.appendChild(grab);

      const head = el(doc, 'div', 'head');
      head.appendChild(el(doc, 'h2', 'title', data.title || '（無標題）'));
      const x = el(doc, 'button', 'close', '×');
      x.type = 'button';
      x.setAttribute('aria-label', '關閉文章資訊');
      x.addEventListener('click', close);
      head.appendChild(x);
      panel.appendChild(head);

      // v3.1.0（Jimmy 2026-11-24「側欄點作者，顯示同一個作者的文章，點網域顯示同個網域的文章」）：
      // 網域、作者是按鈕，點了回清單看同網域 / 同作者的文章；開原文另外一個連結
      const host = data.source_url ? hostOf(data.source_url) : '';
      if (data.source_url) {
        const wrap = doc.createDocumentFragment();
        if (host) {
          wrap.appendChild(pivot(host, 'site', host, '看這個網站的其他文章'));
          wrap.appendChild(el(doc, 'span', 'sep', '　·　'));
        }
        const a = el(doc, 'a', null, '開啟原文 ↗');
        a.href = data.source_url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        wrap.appendChild(a);
        panel.appendChild(row('來源', wrap));
      }
      const author = data.author ? String(data.author).trim() : '';
      const date = ymd(data.published_date);
      if (author || date) {
        const by = doc.createDocumentFragment();
        if (author) by.appendChild(pivot(author, 'author', author, '看這位作者的其他文章'));
        if (author && date) by.appendChild(el(doc, 'span', 'sep', '　·　'));
        if (date) by.appendChild(doc.createTextNode(date));
        panel.appendChild(row('作者與發布日期', by));
      }

      const minutes = readingMinutes(data, isCjkDoc());
      const facts = [
        ymd(data.saved_at || data.created_at) && ('存入 ' + ymd(data.saved_at || data.created_at)),
        data.word_count ? Number(data.word_count).toLocaleString('zh-TW') + ' 字' : '',
        minutes ? '約 ' + minutes + ' 分鐘' : ''
      ].filter(Boolean);
      if (facts.length) {
        // 每段各自不斷行（「約 4 分鐘」不會被拆成兩行），段與段之間才換行
        const line = el(doc, 'div', 'facts');
        facts.forEach((f, i) => {
          if (i) line.appendChild(doc.createTextNode('　·　'));
          line.appendChild(el(doc, 'span', 'nowrap', f));
        });
        panel.appendChild(row('', line)).classList.add('muted');
      }

      const p = Math.round(currentProgress(win, NS) * 100);
      const prog = el(doc, 'div');
      prog.appendChild(doc.createTextNode(p + '%'));
      const bar = el(doc, 'div', 'bar');
      const fill = el(doc, 'i');
      fill.style.width = p + '%';
      bar.appendChild(fill);
      prog.appendChild(bar);
      panel.appendChild(row('閱讀進度', prog));

      const seg = el(doc, 'div', 'seg');
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', '資料夾');
      const curLoc = data.location === 'shortlist' ? 'later' : data.location;
      for (const L of LOCATIONS) {
        const b = el(doc, 'button', L.id === curLoc ? 'on' : '', L.label);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', L.id === curLoc ? 'true' : 'false');
        b.addEventListener('click', () => move(L.id));
        seg.appendChild(b);
      }
      panel.appendChild(row('資料夾', seg));

      const tagBox = el(doc, 'div');
      const chips = el(doc, 'div', 'chips');
      for (const t of tags) {
        const c = el(doc, 'span', 'chip');
        c.appendChild(doc.createTextNode(t));
        const rm = el(doc, 'button', null, '×');
        rm.type = 'button';
        rm.setAttribute('aria-label', '移除標籤 ' + t);
        rm.addEventListener('click', () => saveTags(tags.filter((x2) => x2 !== t)));
        c.appendChild(rm);
        chips.appendChild(c);
      }
      if (tags.length) tagBox.appendChild(chips);
      tagBox.appendChild(tagInput(typed, focusedTagInput));
      panel.appendChild(row('標籤', tagBox));

      panel.appendChild(row('筆記', notesBox(focusedNotes, notesCaret)));

      // 重點清單（Jimmy 2026-11-24：比照 Readwise Reader 側欄）：照文章順序、點了跳過去
      const texts = highlightTexts();
      if (texts.length) {
        const ul = el(doc, 'ul', 'hl-list');
        texts.forEach((t, i) => {
          const li = el(doc, 'li');
          const b = el(doc, 'button', 'hl-item');
          b.type = 'button';
          b.title = '跳到這個重點';
          b.appendChild(el(doc, 'span', 'hl-text', t));
          b.addEventListener('click', () => gotoHighlight(i));
          li.appendChild(b);
          ul.appendChild(li);
        });
        panel.appendChild(row('重點（' + texts.length + '）', ul));
      }

      // 摘要全文顯示、不折疊（Jimmy 2026-11-24）：平均約 120 字，折疊又沒有展開提示，等於把第三段藏掉；
      // 少數很長的（最長約 2K 字）面板本身可以捲
      if (data.summary) panel.appendChild(row('摘要', el(doc, 'div', 'summary', String(data.summary))));

      // v3.1.0：公開分享連結（JReader，SPEC §8）。沒分享：「產生分享連結」（產生後自動複製）；
      // 已分享：顯示網址＋「複製」「停止分享」（要確認：傳出去的連結會失效）。垃圾桶裡的不能分享
      if (!data.deleted_at && typeof PC.shareJReaderDocument === 'function') {
        const box = doc.createDocumentFragment();
        const btns = el(doc, 'div', 'share-row');
        const btn = (label, kind, danger) => {
          const b = el(doc, 'button', 'act' + (danger ? ' danger' : ''), label);
          b.type = 'button';
          b.setAttribute('data-share', kind);
          b.addEventListener('click', () => shareAction(kind));
          btns.appendChild(b);
        };
        if (data.share_url) {
          const a = el(doc, 'a', 'share-url', String(data.share_url));
          a.href = String(data.share_url);
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          box.appendChild(a);
          btn('複製連結', 'copy', false);
          btn('停止分享', 'stop', true);
        } else {
          btn('產生分享連結', 'create', false);
        }
        box.appendChild(btns);
        panel.appendChild(row('公開分享', box));
      }

      // v3.1.0：刪除（移到垃圾桶）；在垃圾桶裡的改成「還原 / 永久刪除」。手機沒有右鍵，這裡是主要入口
      const actions = el(doc, 'div', 'danger-row');
      const act = (label, kind, danger) => {
        const b = el(doc, 'button', 'act' + (danger ? ' danger' : ''), label);
        b.type = 'button';
        b.setAttribute('data-act', kind);
        b.addEventListener('click', () => trashAction(kind));
        actions.appendChild(b);
      };
      if (data.deleted_at) {
        actions.appendChild(el(doc, 'span', 'trash-note', trashNote(data.purge_at, Date.now())));
        act('還原', 'restore', false);
        act('永久刪除', 'purge', true);
      } else {
        act('刪除這篇', 'trash', true);
      }
      panel.appendChild(actions);
    }

    function notesBox(refocus, caret) {
      const wrap = el(doc, 'div');
      const ta = el(doc, 'textarea', 'notes');
      ta.placeholder = '寫點筆記';
      ta.setAttribute('aria-label', '文章筆記');
      ta.value = notesDraft;
      const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.max(64, ta.scrollHeight + 2) + 'px'; };
      ta.addEventListener('input', () => {
        notesDraft = ta.value;
        setNotesStatus('');
        fit();
        if (notesTimer) win.clearTimeout(notesTimer);
        notesTimer = win.setTimeout(() => { notesTimer = null; saveNotes(); }, NOTES_SAVE_MS);
      });
      ta.addEventListener('blur', () => { saveNotes(); });
      wrap.appendChild(ta);
      wrap.appendChild(el(doc, 'span', 'note-status', notesStatus));
      (win.requestAnimationFrame || ((cb) => win.setTimeout(cb, 0)))(fit);
      if (refocus) win.setTimeout(() => { ta.focus(); if (caret != null) { try { ta.setSelectionRange(caret, caret); } catch (_) {} } }, 0);
      return wrap;
    }

    function tagInput(typed, refocus) {
      const wrap = el(doc, 'div', 'tag-input-wrap');
      const input = el(doc, 'input', 'tag-input');
      input.type = 'text';
      input.placeholder = '＋ 新增標籤';
      input.setAttribute('aria-label', '新增標籤');
      input.autocomplete = 'off';
      input.value = typed || '';
      const sug = el(doc, 'div', 'suggest');
      sug.hidden = true;
      let active = -1;
      const drawSuggest = () => {
        const items = suggestTags(allTags || [], input.value, tags);
        sug.textContent = '';
        active = -1;
        sug.hidden = !items.length;
        for (const name of items) {
          const b = el(doc, 'button', null, name);
          b.type = 'button';
          b.addEventListener('pointerdown', (e) => { e.preventDefault(); commit(name); });
          sug.appendChild(b);
        }
      };
      const commit = (name) => {
        const next = addTag(tags, name);
        input.value = '';
        sug.hidden = true;
        if (next !== tags) saveTags(next);
      };
      input.addEventListener('focus', async () => {
        if (allTags) return;
        const r = await PC.listJReaderTags(rw);
        allTags = r && r.ok ? r.tags : [];
        drawSuggest();
      });
      input.addEventListener('input', drawSuggest);
      // 按鍵不掛在 input 上：閱讀模式的按鍵守門（main.js keyguard，window capture）看到的
      // target 是 shadow host、不是輸入框，會整個攔掉。改由 attach 時先註冊的 window
      // capture listener 轉進來處理（見下方 onPanelKey）
      tagKeyHandler = (e) => {
        if (e.isComposing || e.keyCode === 229) return; // 注音 / 拼音選字中的 Enter 不算送出
        const btns = Array.from(sug.querySelectorAll('button'));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (!btns.length) return;
          e.preventDefault();
          active = e.key === 'ArrowDown' ? (active + 1) % btns.length : (active - 1 + btns.length) % btns.length;
          btns.forEach((b, i) => b.classList.toggle('active', i === active));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          commit(active >= 0 && btns[active] ? btns[active].textContent : input.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          if (!sug.hidden) sug.hidden = true; else close();
        }
      };
      input.addEventListener('blur', () => { sug.hidden = true; });
      wrap.appendChild(input);
      wrap.appendChild(sug);
      if (refocus) win.setTimeout(() => { input.focus(); }, 0);
      return wrap;
    }

    function attachDrag(grab) {
      let start = null;
      grab.addEventListener('pointerdown', (e) => {
        if (!panel.classList.contains('sheet')) return;
        start = e.clientY;
        try { grab.setPointerCapture(e.pointerId); } catch (_) {}
        panel.style.transition = 'none';
      });
      grab.addEventListener('pointermove', (e) => {
        if (start == null) return;
        panel.style.transform = 'translateY(' + Math.max(0, e.clientY - start) + 'px)';
      });
      const end = (e) => {
        if (start == null) return;
        const dy = e.clientY - start;
        start = null;
        panel.style.transition = '';
        panel.style.transform = '';
        if (dy > DRAG_CLOSE_PX) close();
      };
      grab.addEventListener('pointerup', end);
      grab.addEventListener('pointercancel', end);
    }

    function applyTheme() {
      const c = RC && typeof RC.themeColorsOf === 'function' ? RC.themeColorsOf(win, container || doc.body) : themeColors(win, container || doc.body);
      hostEl.style.setProperty('--bg', c.bg);
      hostEl.style.setProperty('--fg', c.fg);
      hostEl.style.setProperty('--muted', c.muted);
      hostEl.style.setProperty('--link', c.link);
      hostEl.style.setProperty('--line', c.line);
    }

    // 面板開著時的按鍵：attach 時就註冊（window capture），比閱讀模式的 ESC 退出與按鍵守門
    // 早——不然 Esc 會先被拿去退出閱讀模式回清單、輸入框的 Enter 會被守門攔掉。
    // 面板內的按鍵全部自己處理並停止傳遞，不讓頁面快速鍵（H / E / 翻頁）吃到打字
    function onPanelKey(e) {
      if (!opened) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const real = path[0] || e.target;
      const inPanel = !!hostEl && (e.target === hostEl || hostEl.contains(e.target));
      if (inPanel) {
        if (real && real.classList && real.classList.contains('tag-input')) {
          if (tagKeyHandler) tagKeyHandler(e);
        } else if (e.key === 'Escape' && !(e.isComposing || e.keyCode === 229)) {
          e.preventDefault();
          close();
        }
        e.stopImmediatePropagation();
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    }
    win.addEventListener('keydown', onPanelKey, true);

    function open() {
      if (opened) return;
      ensureHost();
      applyTheme();
      panel.classList.toggle('wide', (win.innerWidth || 0) >= WIDE_MIN_PX);
      panel.classList.toggle('sheet', (win.innerWidth || 0) < WIDE_MIN_PX);
      panel.classList.remove('open');
      hostEl.style.display = 'block';
      opened = true;
      render();
      // 下一個 frame 再加 open，讓 transform 動畫跑得出來
      (win.requestAnimationFrame || ((cb) => win.setTimeout(cb, 16)))(() => { if (opened) panel.classList.add('open'); });
      refresh();
    }

    function close() {
      if (!opened) return;
      opened = false;
      saveNotes(); // 打到一半就關面板：立刻存
      if (hostEl) hostEl.style.display = 'none';
      if (panel) panel.classList.remove('open');
    }

    function toggle() { if (opened) close(); else open(); }

    // 打開時重抓一次：文章快取裡的 doc 是精簡版（沒有標籤、字數、存入時間）
    async function refresh() {
      let r;
      try { r = await PC.getJReaderDocument(Object.assign({ id }, rw)); } catch (_) { r = null; }
      if (!r || !r.ok || !r.doc) return;
      data = Object.assign({}, data, r.doc);
      tags = tagNames(r.doc.tags);
      // 伺服器的筆記：使用者還沒動過輸入框才換上（打到一半不蓋掉）
      if (typeof r.doc.notes === 'string' && notesDraft === notesSaved) { notesSaved = r.doc.notes; notesDraft = r.doc.notes; }
      if (opened) render();
    }

    // 快速鍵 I：window capture、須在 main.js keyguard 之前註冊（同 H / E 鍵）
    win.addEventListener('keydown', (e) => {
      if (e.key !== 'i' && e.key !== 'I') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (NS && typeof NS.isTextInputTarget === 'function' && NS.isTextInputTarget(e.target)) return;
      // 面板內的輸入框在 shadow DOM 裡，事件 target 會被重定向成 host 元素
      if (hostEl && e.target === hostEl) return;
      e.preventDefault();
      e.stopPropagation();
      toggle();
    }, true);

    // 快速鍵 L：編輯標籤（Jimmy 2026-11-24）——打開面板（已開就不動）、游標放進「新增標籤」輸入框。
    // 跟 I 同一套條件：輸入框裡、面板裡（shadow DOM host）、選字中、帶修飾鍵都不收
    function editTags() {
      open();
      const input = shadow && shadow.querySelector('.tag-input');
      if (!input) return false;
      input.focus();
      try { input.scrollIntoView({ block: 'nearest' }); } catch (_) { /* jsdom */ }
      return true;
    }
    win.addEventListener('keydown', (e) => {
      if (e.key !== 'l' && e.key !== 'L') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat || e.isComposing || e.keyCode === 229) return;
      if (NS && typeof NS.isTextInputTarget === 'function' && NS.isTextInputTarget(e.target)) return;
      if (hostEl && e.target === hostEl) return;
      e.preventDefault();
      e.stopPropagation();
      editTags();
    }, true);

    // 懸浮按鈕選單的「文章資訊」（floating-icon.js 看到這個掛鉤才列出）
    if (NS) NS.onReaderInfo = toggle;

    return { open, close, toggle, editTags, isOpen: () => opened, render, refresh, gotoNextHighlight, panel: () => panel };
  }

  // 垃圾桶裡的文章：剩幾天自動永久刪除（purge_at 由 JReader 伺服器給，天數規則只在伺服器）
  function trashNote(purgeAt, now) {
    const t = Date.parse(purgeAt || '');
    if (!Number.isFinite(t)) return '這篇在垃圾桶裡';
    const days = Math.ceil((t - now) / 86400000);
    return days >= 1 ? '這篇在垃圾桶裡，' + days + ' 天後自動永久刪除' : '這篇在垃圾桶裡，即將自動永久刪除';
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return String(url || ''); }
  }

  const api = { attach, trashNote, ymd, readingMinutes, CJK_CHARS_PER_MIN, LATIN_WORDS_PER_MIN, tagNames, addTag, suggestTags, currentProgress, themeColors, WIDE_MIN_PX, HOST_ID };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.__JReadReaderInfo = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
