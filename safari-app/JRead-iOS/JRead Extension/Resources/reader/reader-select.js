// JRead — 清單多選（v3.1.0，JReader 專用）
//
// Jimmy 2026-11-24（部署前待辦第 8 項）：在清單勾選多篇，一起封存、搬資料夾、加標籤或刪除。
//
// 進入多選：卡片右鍵（手機長按）「選取」、Shift+點卡片、鍵盤 J / K 選到卡片後按 X。
// 多選中：點卡片＝勾 / 取消（不打開）；X 勾 / 取消鍵盤選到的那張；Esc 或 ✕ 離開；最後一張取消勾選也離開。
// 底部動作列：「已選 N 篇　全選　封存　Later　Inbox　加標籤　刪除　✕」——依目前的頁面：
//   - 一般資料夾分頁：不列「搬到自己這個資料夾」（Archive 沒有「封存」）
//   - Progress、搜尋結果、同作者 / 同網域：三個資料夾都列（結果跨資料夾）
//   - 垃圾桶：「還原」「永久刪除」
// 刪除 / 永久刪除先確認（reader-dialog.js）。一個請求做完（JReader POST /api/v1/documents/batch，
// PC.batchJReaderDocuments），成功後提示、離開多選、重新載入目前的清單（refresh）。
//
// 頁面整合（reader-feed init）：attach(opts) → { start(card), toggle(card), isActive(), exit() }
//   opts：doc, win, listEl, PC, creds, toast(msg, kind), getView() → { kind: 'tab'|'search'|'sub'|'trash', location },
//         refresh(), invalidate(ids, req)（清掉清單快取裡這些篇；req＝送出的批次動作，搬資料夾時文章快取記新位置）
// 卡片右鍵的「選取」由 reader-feed attachContextMenu 依 selectHook 列出。
//
// dual export：module.exports 給 jsdom spec、window.__JReadReaderSelect 給頁面。
(function (global) {
  'use strict';

  const BAR_CLASS = 'jr-select-bar';
  // 完成提示文字的正本在 reader-cache ACTION_DONE
  const RC_MOD = global.__JReadReaderCache ||
    (typeof module !== 'undefined' && module.exports && typeof require === 'function' ? require('./reader-cache.js') : null);
  const DONE = (RC_MOD && RC_MOD.ACTION_DONE) || {};
  const MOVES = [
    { location: 'archive', label: '封存', done: DONE.archive },
    { location: 'later', label: 'Later', done: DONE.later },
    { location: 'new', label: 'Inbox', done: DONE.inbox }
  ];
  const DIALOG = () => global.__JReadReaderDialog ||
    (typeof module !== 'undefined' && module.exports && typeof require === 'function' ? require('./reader-dialog.js') : null);

  function attach(opts) {
    const o = opts || {};
    const { doc, listEl, PC, creds } = o;
    if (!doc || !listEl || !PC || typeof PC.batchJReaderDocuments !== 'function') return null;
    const picked = new Set();
    let active = false;
    let bar = null;
    let busy = false;
    // 加標籤的輸入列開著時的收尾（離開多選時要讓等待中的 askTag 結束，不然 run 永遠卡著）
    let askDone = null;
    // 動作列高度 → body 的 --jr-select-bar-h（清單底部留白用；按鈕折行、標籤輸入列出現都會變高）
    let barRO = null;

    const cardId = (card) => card && card.getAttribute && card.getAttribute('data-doc-id');
    const cards = () => Array.from(listEl.querySelectorAll('.jr-card[data-doc-id]:not(.jr-pending)'));

    function paint() {
      for (const c of cards()) c.classList.toggle('is-picked', picked.has(cardId(c)));
      if (!bar) return;
      bar.querySelector('.jr-select-count').textContent = '已選 ' + picked.size + ' 篇';
      for (const b of bar.querySelectorAll('button[data-act]')) b.disabled = busy || (!picked.size && b.getAttribute('data-act') !== 'all' && b.getAttribute('data-act') !== 'cancel');
    }

    function btn(label, act, extra) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'jr-select-btn' + (extra ? ' ' + extra : '');
      b.setAttribute('data-act', act);
      b.textContent = label;
      return b;
    }

    // 動作列依目前的頁面重建（進入多選時）
    function buildBar() {
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      const view = (typeof o.getView === 'function' && o.getView()) || { kind: 'tab' };
      bar = doc.createElement('div');
      bar.className = BAR_CLASS;
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', '多選動作');
      const count = doc.createElement('span');
      count.className = 'jr-select-count';
      bar.appendChild(count);
      bar.appendChild(btn('全選', 'all'));
      if (view.kind === 'trash') {
        bar.appendChild(btn('還原', 'restore'));
        bar.appendChild(btn('永久刪除', 'purge', 'is-danger'));
      } else {
        for (const m of MOVES) {
          if (view.kind === 'tab' && view.location === m.location) continue;
          bar.appendChild(btn(m.label, 'move:' + m.location));
        }
        bar.appendChild(btn('加標籤', 'tag'));
        bar.appendChild(btn('刪除', 'trash', 'is-danger'));
      }
      const x = btn('✕', 'cancel', 'jr-select-close');
      x.setAttribute('aria-label', '離開多選');
      bar.appendChild(x);
      bar.addEventListener('click', (e) => {
        const b = e.target && e.target.closest && e.target.closest('button[data-act]');
        if (!b || b.disabled) return;
        run(b.getAttribute('data-act'));
      });
      doc.body.appendChild(bar);
      syncBarHeight();
      const RO = doc.defaultView && doc.defaultView.ResizeObserver;
      if (RO) { barRO = new RO(syncBarHeight); barRO.observe(bar); }
    }
    function syncBarHeight() {
      // 寫在 <html>：清單留白（body 規則）繼承得到，掛 <html> 直下的 toast 也讀得到（A-8）
      if (bar && bar.offsetHeight) doc.documentElement.style.setProperty('--jr-select-bar-h', bar.offsetHeight + 'px');
    }

    function start(card) {
      if (!active) {
        active = true;
        picked.clear();
        doc.body.classList.add('jr-selecting');
        buildBar();
      }
      if (card) picked.add(cardId(card));
      paint();
    }
    function exit() {
      if (!active) return;
      active = false;
      picked.clear();
      doc.body.classList.remove('jr-selecting');
      if (askDone) askDone(null);
      if (barRO) { barRO.disconnect(); barRO = null; }
      doc.documentElement.style.removeProperty('--jr-select-bar-h');
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      bar = null;
      for (const c of listEl.querySelectorAll('.jr-card.is-picked')) c.classList.remove('is-picked');
    }
    function toggle(card) {
      const id = cardId(card);
      if (!id) return;
      if (!active) { start(card); return; }
      if (picked.has(id)) picked.delete(id); else picked.add(id);
      if (!picked.size) { exit(); return; }
      paint();
    }

    async function askTag() {
      // 頁內小輸入框（不用 window.prompt：iOS WKWebView 沒實作時一律回 null）。
      // 已經開著就不再開第二列（第一列的 Promise 會永遠等不到），回 null、焦點放回原本那列
      if (askDone) {
        const open = bar && bar.querySelector('.jr-select-tag');
        if (open) open.focus();
        return null;
      }
      return new Promise((resolve) => {
        const row = doc.createElement('form');
        row.className = 'jr-select-tagrow';
        const input = doc.createElement('input');
        input.type = 'text';
        input.className = 'jr-select-tag';
        input.placeholder = '標籤名稱';
        input.setAttribute('aria-label', '要加的標籤');
        input.maxLength = 100;
        const ok = doc.createElement('button');
        ok.type = 'submit';
        ok.className = 'jr-select-btn';
        ok.textContent = '加上';
        row.appendChild(input);
        row.appendChild(ok);
        bar.appendChild(row);
        input.focus();
        const done = (v) => {
          if (askDone !== done) return;
          askDone = null;
          if (row.parentNode) row.parentNode.removeChild(row);
          resolve(v);
        };
        askDone = done;
        row.addEventListener('submit', (e) => { e.preventDefault(); done(input.value.trim() || null); });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); done(null); }
        });
      });
    }

    async function run(act) {
      if (act === 'cancel') { exit(); return; }
      if (act === 'all') {
        for (const c of cards()) picked.add(cardId(c));
        paint();
        return;
      }
      if (!picked.size || busy) return;
      // ids 在要送出的那一刻才取：加標籤 / 確認框等待期間使用者還能勾 / 取消卡片
      // （2026-11-24 審核 A-3：原本在 await askTag() 之前取，輸入時多勾的不會加到）
      let ids = Array.from(picked);
      const D = DIALOG();
      let req = null;
      let done = '';
      if (act.startsWith('move:')) {
        const m = MOVES.find((x) => 'move:' + x.location === act);
        req = { action: 'move', location: m.location };
        done = m.done;
      } else if (act === 'tag') {
        const tag = await askTag();
        if (!tag || !active || !picked.size) return;
        ids = Array.from(picked);
        req = { action: 'tag', tag };
        done = '已加上標籤「' + tag + '」';
      } else if (act === 'trash' || act === 'purge') {
        // 文案與單篇刪除共用 reader-dialog.trashConfirmText（原本這裡有第三份，審核 A-7）
        const text = D && typeof D.trashConfirmText === 'function' ? D.trashConfirmText(act, null, ids.length, typeof o.keepDays === 'function' ? o.keepDays() : undefined) : null;
        if (!text || typeof D.confirm !== 'function' || !(await D.confirm(text))) return;
        if (!active || !picked.size) return;
        ids = Array.from(picked);
        req = { action: act };
        done = DONE[act];
      } else if (act === 'restore') {
        req = { action: 'restore' };
        done = DONE.restore;
      } else {
        return;
      }
      busy = true;
      paint();
      let r;
      try { r = await PC.batchJReaderDocuments(Object.assign({ token: creds.token, base: creds.base, ids }, req)); } catch (_) { r = null; }
      busy = false;
      if (!r || !r.ok) {
        paint();
        if (typeof o.toast === 'function') o.toast(PC.serviceErrorMessage ? PC.serviceErrorMessage(r, { action: '批次處理' }) : '批次處理失敗', 'error');
        return;
      }
      const n = r.data && typeof r.data.updated === 'number' ? r.data.updated : ids.length;
      if (typeof o.toast === 'function') o.toast(done + '（' + n + ' 篇）', 'success');
      if (typeof o.invalidate === 'function') { try { await o.invalidate(ids, req); } catch (_) {} }
      exit();
      if (typeof o.refresh === 'function') o.refresh();
    }

    // 多選中點卡片＝勾選（capture：比卡片連結的導頁早）；Shift+點＝進入多選並勾這張
    doc.addEventListener('click', (e) => {
      const card = e.target && e.target.closest && e.target.closest('.jr-card[data-doc-id]');
      if (!card || !listEl.contains(card) || card.classList.contains('jr-pending')) return;
      if (!active && !e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      toggle(card);
    }, true);

    // 鍵盤：X 勾 / 取消鍵盤選到的卡片（.is-kb）；Esc 離開多選。輸入框裡不收
    doc.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.metaKey || e.ctrlKey || e.altKey) return;
      const N = global.__JRead; // 「在輸入」單一資料源 NS.isTextInputTarget（看穿開放式 shadow root）
      if (N && typeof N.isTextInputTarget === 'function' && N.isTextInputTarget(e.target)) return;
      if (e.key === 'Escape' && active) { e.preventDefault(); exit(); return; }
      if ((e.key === 'x' || e.key === 'X') && !e.shiftKey) {
        const kb = listEl.querySelector('.jr-card.is-kb');
        if (!kb) return;
        e.preventDefault();
        toggle(kb);
      }
    }, true);

    // 清單重畫（背景更新、載入更多）：勾選狀態照 id 補回；已不在清單的拿掉——原本只有註解、沒有修剪，
    // 背景更新後看不見的文章仍會被批次動作作用（2026-11-24 審核 A-6）。全部都不在了＝離開多選
    // （同最後一張取消勾選）。renderFeed 清空與重建在同一個 task，MutationObserver 只在重建完才看
    function prune() {
      if (!active) return;
      const here = new Set(cards().map(cardId));
      for (const id of Array.from(picked)) if (!here.has(id)) picked.delete(id);
      if (!picked.size) { exit(); return; }
      paint();
    }
    const MO = doc.defaultView && doc.defaultView.MutationObserver;
    if (MO) new MO(prune).observe(listEl, { childList: true });

    return { start, toggle, exit, isActive: () => active, picked: () => Array.from(picked), run };
  }

  const api = { attach, MOVES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.__JReadReaderSelect = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
