// JRead — 頁內確認對話框（v3.1.0）
//
// 刪除、永久刪除、清空垃圾桶前的確認（Jimmy 2026-11-24「刪除要確認」）。不用 window.confirm：iOS App 的
// WKWebView 沒實作 confirm 委派時一律回 false（按了刪除卻什麼都不發生），樣式也跟 JRead 主題不搭。
//
// confirm({ title, message, confirmLabel, cancelLabel, danger, focusCancel }) → Promise<boolean>
//   - danger：確認鈕用紅色
//   - 預設焦點：danger 或 focusCancel 時放在「取消」（Enter 不會誤刪；刪除到垃圾桶雖可還原也一樣，
//     2026-11-24 審核 B-5），其他放在「確定」
//   - Esc / 點外面＝取消；Enter＝按下目前有焦點的那顆。按住不放的自動重複（e.repeat）不算——
//     按住 Enter 開框後的重複會直接確認（B-5）
//   - 開著時頁面其他快速鍵一律不收（window capture、模組載入就註冊——比 Article View 的 Esc 退出閱讀模式早）
// 浮層用 shadow DOM 掛 <html> 直下（閱讀模式會把 body 底下非主文元素藏起來）。顏色讀頁面主題（RC.pageThemeColors）。
//
// dual export：module.exports 給 jsdom spec、window.__JReadReaderDialog 給頁面。
(function (global) {
  'use strict';

  const HOST_ID = '__jread-dialog-host';
  const RC = global.__JReadReaderCache ||
    (typeof module !== 'undefined' && module.exports && typeof require === 'function' ? require('./reader-cache.js') : null);

  const CSS = `
    :host { all: initial; }
    .backdrop { position: fixed; inset: 0; z-index: 2147483645; background: rgba(0,0,0,.32);
      display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { box-sizing: border-box; width: min(380px, 100%); background: var(--bg); color: var(--fg);
      border-radius: 14px; padding: 20px 20px 16px; box-shadow: 0 14px 40px rgba(0,0,0,.28);
      font: 14px/1.6 system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif; -webkit-font-smoothing: antialiased; }
    h2 { margin: 0 0 6px; font-size: 16px; font-weight: 700; }
    p { margin: 0 0 18px; color: var(--muted); white-space: pre-wrap; }
    .row { display: flex; justify-content: flex-end; gap: 8px; }
    button { height: 36px; min-width: 80px; padding: 0 14px; border-radius: 9px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
    .cancel { background: transparent; color: var(--fg); border: 1px solid var(--line); }
    .ok { background: var(--fg); color: var(--bg); border: 1px solid var(--fg); }
    .ok.danger { background: #c62828; border-color: #c62828; color: #fff; }
    button:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
  `;

  // 垃圾桶相關的確認文案（清單右鍵、文章資訊面板共用一份；Jimmy：「刪除要確認」）。還原不用確認（回 null）
  // count：多選批次的篇數（沒有 doc 時標題寫「N 篇」；清單多選與這裡共用一份文案，審核 A-7）
  // days：呼叫端知道的保留天數（多選沒有 doc）；doc 自己帶 trash_keep_days 時以 doc 為準，都沒有＝30
  function trashConfirmText(kind, doc, count, days) {
    const raw = doc && doc.title ? String(doc.title) : '';
    const t = raw ? '「' + (raw.length > 30 ? raw.slice(0, 30) + '…' : raw) + '」'
      : (!doc && count > 0 && kind !== 'empty' ? ' ' + count + ' 篇' : '這篇');
    // 保留天數讀伺服器給的 trash_keep_days（JReader src/store.ts TRASH_KEEP_DAYS；2026-11-24 起每篇文件都帶）。
    // 精確的剩餘天數由伺服器回的 purge_at 算（文章資訊面板）
    const keep = RC && typeof RC.trashKeepDays === 'function' ? RC.trashKeepDays([doc, { trash_keep_days: days }]) : 30;
    if (kind === 'trash') return { title: '刪除' + t + '？', message: '文章會移到垃圾桶，' + keep + ' 天內可以從清單最下方的「垃圾桶」還原，之後自動永久刪除', confirmLabel: '刪除', danger: false, focusCancel: true };
    if (kind === 'purge') return { title: '永久刪除' + t + '？', message: '文章、重點與筆記會一起刪除，無法復原', confirmLabel: '永久刪除', danger: true };
    if (kind === 'empty') return { title: '清空垃圾桶？', message: (count ? count + ' 篇文章' : '垃圾桶裡的文章') + '會永久刪除，無法復原', confirmLabel: '清空', danger: true };
    return null;
  }

  let current = null; // { resolve, ok, cancel, host }

  function finish(value) {
    if (!current) return;
    const c = current;
    current = null;
    c.host.style.display = 'none';
    c.resolve(value);
  }

  function confirm(opts, env) {
    const o = opts || {};
    const doc = (env && env.doc) || global.document;
    const win = (env && env.win) || global;
    if (!doc) return Promise.resolve(false);
    if (current) finish(false); // 同時只開一個
    let host = doc.getElementById(HOST_ID);
    if (!host) {
      host = doc.createElement('div');
      host.id = HOST_ID;
      host.style.cssText = 'all: initial; display: none;';
      if (host.attachShadow) host.attachShadow({ mode: 'open' });
      doc.documentElement.appendChild(host);
    }
    const root = host.shadowRoot || host;
    const c = RC && typeof RC.pageThemeColors === 'function' ? RC.pageThemeColors(win, doc)
      : { bg: '#fff', fg: '#1a1a1a', muted: 'rgba(26,26,26,.62)', line: 'rgba(26,26,26,.14)', link: '#1a73e8' };
    for (const k of ['bg', 'fg', 'muted', 'line', 'link']) host.style.setProperty('--' + k, c[k]);
    root.textContent = '';
    const style = doc.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    const backdrop = doc.createElement('div');
    backdrop.className = 'backdrop';
    const card = doc.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-modal', 'true');
    const h = doc.createElement('h2');
    h.textContent = o.title || '確定嗎？';
    card.appendChild(h);
    if (o.message) {
      const p = doc.createElement('p');
      p.textContent = o.message;
      card.appendChild(p);
    }
    const row = doc.createElement('div');
    row.className = 'row';
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cancel';
    cancel.textContent = o.cancelLabel || '取消';
    const ok = doc.createElement('button');
    ok.type = 'button';
    ok.className = 'ok' + (o.danger ? ' danger' : '');
    ok.textContent = o.confirmLabel || '確定';
    row.appendChild(cancel);
    row.appendChild(ok);
    card.appendChild(row);
    backdrop.appendChild(card);
    root.appendChild(backdrop);
    host.style.display = 'block';
    return new Promise((resolve) => {
      current = { resolve, ok, cancel, host };
      cancel.addEventListener('click', () => finish(false));
      ok.addEventListener('click', () => finish(true));
      backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) { e.preventDefault(); finish(false); } });
      (o.danger || o.focusCancel ? cancel : ok).focus();
    });
  }

  // 開著時的按鍵：Esc 取消、Enter 按焦點那顆、Tab 在兩顆之間；其餘一律不外漏給頁面快速鍵
  function onKey(e) {
    if (!current) return;
    const root = current.host.shadowRoot || current.host;
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) { e.stopImmediatePropagation(); return; } // 按住的自動重複不算確認
      finish(root.activeElement === current.cancel ? false : root.activeElement === current.ok ? true : false);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      (root.activeElement === current.ok ? current.cancel : current.ok).focus();
    }
    e.stopImmediatePropagation();
  }
  function install(win) {
    if (win && typeof win.addEventListener === 'function') win.addEventListener('keydown', onKey, true);
  }

  const api = { confirm, install, trashConfirmText, isOpen: () => !!current, HOST_ID };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.__JReadReaderDialog = api;
    install(global);
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
