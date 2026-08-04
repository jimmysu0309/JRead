// JRead — Toast 提示
// 在頁面右下角顯示短暫提示。以 Shadow DOM 封裝避免被站點 CSS 影響；
// 容器本身 all: initial 阻斷繼承。z-index 頂到最大值以免被站點彈窗蓋過。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;
  if (NS.toast) return; // 已初始化（重複注入保險）

  const DEFAULT_DURATION = 2500;
  const FADE_MS = 200;
  const HOST_ID = '__jread-toast-host';

  // v0.8.160：shadow 內樣式抽成 CSS 字串、改走 NS.injectShadowCss（CSP-safe）——
  // 嚴格 style-src nonce-only 站（自架 Miniflux）在 WebKit 會擋掉 shadow 內注入的
  // <style>，toast 文字會變透明 / 無樣式看不見（與懸浮按鈕 v0.8.159 同根因）。
  // 被擋時退回 shadow.adoptedStyleSheets。詳見 namespace.js injectShadowCss 註解。
  const CSS = `
    .stack {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: flex-end;
    }
    .toast {
      background: #2d3748;
      color: #fff;
      padding: 10px 16px;
      border-radius: 6px;
      font: 14px -apple-system, system-ui, "Noto Sans TC", sans-serif;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      max-width: 320px;
      opacity: 0;
      transform: translateY(6px);
      transition: opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease;
      pointer-events: auto;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast.success { background: #2f855a; }
    .toast.error   { background: #c53030; }
    .toast.info    { background: #2b6cb0; }
  `;

  let host = null;
  let shadow = null;
  let stack = null;

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;

    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'right: 20px',
      'bottom: 20px',
      'z-index: 2147483647',
      'pointer-events: none',
      'display: block'
    ].join('; ');

    // open mode 讓 regression spec 可以驗證內部結構
    shadow = host.attachShadow({ mode: 'open' });
    stack = document.createElement('div');
    stack.className = 'stack';
    shadow.appendChild(stack);
    NS.injectShadowCss(shadow, CSS);

    // v1.6.24：掛 <html> 直下、不掛 body——body 子元素會被 cleaner 動態 observer
    // 與 styler sibling 隱藏規則掃到（floating-icon / paged 指示器 / progress bar
    // 全都掛 documentElement 的既有教訓）。舊掛 body 靠 styler :not(#__jread-toast-host)
    // 與 fb-post __jread 前綴兩條豁免撐著（v0.8.36 曾漏第二條被咬過），掛 html
    // 從結構上根絕、不再依賴逐條豁免。
    document.documentElement.appendChild(host);
  }

  /**
   * 顯示一個 toast。
   * @param {string} message 顯示文字
   * @param {object} [opts]
   * @param {'info'|'success'|'error'} [opts.kind='info']
   * @param {number} [opts.duration=2500] 顯示時間 ms
   * @param {string} [opts.id] 同 id 的既有 toast 會被本次取代（v1.7.36）——
   *   多步驟流程（快速鍵送出：送出中… → 產生摘要中… → 結果）用同一個 id，
   *   讓後一則接替前一則的位置，而不是往下疊成一排殘影。
   * @returns {Element} toast 元素（測試用；一般無需 retain）
   */
  function show(message, opts) {
    const { kind = 'info', duration = DEFAULT_DURATION, id = '' } = opts || {};
    ensureHost();

    // 同 id 的前一則立即移除（不做淡出——視覺上是「同一則換文字」）。
    // 逐個比對 attribute 而非 querySelector：id 由訊息傳入、不保證是合法
    // CSS identifier，selector 字串拼接會炸。
    if (id) {
      for (const prev of Array.from(stack.children)) {
        if (prev.getAttribute('data-jread-toast-id') === id) prev.remove();
      }
    }

    const el = shadow.ownerDocument.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = message;
    if (id) el.setAttribute('data-jread-toast-id', id);
    stack.appendChild(el);

    // 連兩個 rAF 確保 transition 啟動（直接 add 會和 initial state 同 frame）
    const raf = (fn) => (window.requestAnimationFrame || ((cb) => setTimeout(cb, 16)))(fn);
    raf(() => raf(() => el.classList.add('show')));

    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), FADE_MS + 50);
    }, duration);

    return el;
  }

  NS.toast = { show };
})();
