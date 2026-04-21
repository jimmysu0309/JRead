// JRead — toast regression spec
// 驗 NS.toast.show() 的 DOM 行為：掛 host、Shadow DOM 結構、duration 後移除。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const TOAST_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'toast.js'),
  'utf8'
);

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.__JRead = { state: {}, MSG: {} };
  window.eval(TOAST_SRC);
  return { window, document: window.document, NS: window.__JRead };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('toast', () => {
  it('show() 建立 host 元素並掛到 document', () => {
    const { document, NS } = setup();
    NS.toast.show('hello', { duration: 50 });
    const host = document.getElementById('__jread-toast-host');
    assert.ok(host, '__jread-toast-host 必須存在');
    assert.ok(host.shadowRoot, '必須有 shadowRoot（open mode）');
  });

  it('toast 使用 text content 而非 innerHTML（防 XSS）', () => {
    const { document, NS } = setup();
    NS.toast.show('<script>alert(1)</script>', { duration: 50 });
    const host = document.getElementById('__jread-toast-host');
    const toast = host.shadowRoot.querySelector('.toast');
    assert.ok(toast, 'toast 元素必須存在');
    assert.strictEqual(toast.textContent, '<script>alert(1)</script>');
    assert.strictEqual(
      host.shadowRoot.querySelectorAll('script').length,
      0,
      '不應有 <script> 被實際建立'
    );
  });

  it('kind 對應 CSS class（success / error / info）', () => {
    const { document, NS } = setup();
    NS.toast.show('ok', { kind: 'success', duration: 50 });
    NS.toast.show('bad', { kind: 'error', duration: 50 });
    NS.toast.show('meh', { kind: 'info', duration: 50 });
    const toasts = document.getElementById('__jread-toast-host')
      .shadowRoot.querySelectorAll('.toast');
    assert.strictEqual(toasts.length, 3);
    assert.ok(toasts[0].classList.contains('success'));
    assert.ok(toasts[1].classList.contains('error'));
    assert.ok(toasts[2].classList.contains('info'));
  });

  it('duration 結束後 toast 被移除', async () => {
    const { document, NS } = setup();
    NS.toast.show('bye', { duration: 50 });
    const shadow = document.getElementById('__jread-toast-host').shadowRoot;
    assert.strictEqual(shadow.querySelectorAll('.toast').length, 1);
    // duration 50 + FADE_MS 200 + buffer
    await sleep(400);
    assert.strictEqual(shadow.querySelectorAll('.toast').length, 0);
  });

  it('host 固定右下角、z-index 頂到最大、pointer-events none 不擋頁面互動', () => {
    const { document, NS } = setup();
    NS.toast.show('x', { duration: 50 });
    const host = document.getElementById('__jread-toast-host');
    const s = host.style;
    assert.strictEqual(s.position, 'fixed');
    assert.strictEqual(s.right, '20px');
    assert.strictEqual(s.bottom, '20px');
    assert.strictEqual(s.zIndex, '2147483647');
    assert.strictEqual(s.pointerEvents, 'none');
  });

  it('多次 show 共用同一個 host（不重複建立）', () => {
    const { document, NS } = setup();
    NS.toast.show('a', { duration: 50 });
    NS.toast.show('b', { duration: 50 });
    NS.toast.show('c', { duration: 50 });
    const hosts = document.querySelectorAll('#__jread-toast-host');
    assert.strictEqual(hosts.length, 1);
    const toasts = hosts[0].shadowRoot.querySelectorAll('.toast');
    assert.strictEqual(toasts.length, 3);
  });
});
