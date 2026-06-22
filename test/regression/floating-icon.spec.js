// JRead — 懸浮按鈕 regression spec（v0.8.154）
//
// 驗 content/floating-icon.js 的 DOM 行為與 wiring：
//   - host 掛 documentElement（不掛 body——body children 會被 cleaner 動態
//     observer 隱藏，memory feedback_reader_injected_ui_append_html）
//   - 啟用旗標未設過一律預設開（v0.8.158，原平台分流取消）
//   - 透明度 clamp、位置 sanitize（預設左緣）
//   - 短按 → NS.dispatchLocalCommand('toggle-reader-mode')
//   - 長按選單兩項：送 Readwise（CUSTOM_COMMAND send-to-readwise）、切換分頁模式
//     （翻轉 storage.sync.pagedMode）
//   - storage.onChanged 即時生效
//
// 訊號層次：本檔驗 jsdom DOM 副作用 + 純邏輯 + wiring 字面值。真實 pointer
// 長按 / 拖移吸附時序、Shadow DOM 視覺、iOS 觸控靠 Playwright harness +
// TestFlight 實機（pointer 狀態機的計時器邏輯不在 jsdom 驗）。
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const JREAD = path.join(ROOT, 'jread');
const NS_SRC = fs.readFileSync(path.join(JREAD, 'content', 'namespace.js'), 'utf8');
const DEFAULTS_SRC = fs.readFileSync(path.join(JREAD, 'content', 'settings-defaults.js'), 'utf8');
const TOAST_SRC = fs.readFileSync(path.join(JREAD, 'content', 'toast.js'), 'utf8');
const FLOATING_SRC = fs.readFileSync(path.join(JREAD, 'content', 'floating-icon.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(JREAD, 'manifest.json'), 'utf8'));
const POPUP_CORE_SRC = fs.readFileSync(path.join(JREAD, 'popup', 'popup-core.js'), 'utf8');

// 可配置的 chrome mock：runtime URL scheme（平台分流訊號）+ storage.sync 假實作
function makeChrome({ scheme = 'chrome-extension://', store = {} } = {}) {
  const data = Object.assign({}, store);
  const onChangedListeners = [];
  const sent = [];
  const chrome = {
    runtime: {
      id: 'test',
      lastError: null,
      getManifest: () => ({ version: '0.0.0-test' }),
      getURL: (p) => scheme + 'abc/' + (p || ''),
      sendMessage: (msg) => { sent.push(msg); }
    },
    storage: {
      sync: {
        get(keys, cb) {
          const out = {};
          const list = Array.isArray(keys) ? keys
            : (keys && typeof keys === 'object') ? Object.keys(keys) : [keys];
          for (const k of list) {
            out[k] = (k in data) ? data[k]
              : (keys && typeof keys === 'object' && !Array.isArray(keys)) ? keys[k] : undefined;
          }
          cb(out);
        },
        set(obj, cb) {
          const changes = {};
          for (const k of Object.keys(obj)) {
            changes[k] = { oldValue: data[k], newValue: obj[k] };
            data[k] = obj[k];
          }
          onChangedListeners.forEach((fn) => fn(changes, 'sync'));
          if (cb) cb();
        }
      },
      onChanged: { addListener(fn) { onChangedListeners.push(fn); } }
    },
    _sent: sent,
    _data: data,
    _emit(changes) { onChangedListeners.forEach((fn) => fn(changes, 'sync')); }
  };
  return chrome;
}

function setup({ scheme, store } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
  window.chrome = makeChrome({ scheme, store });
  window.eval(NS_SRC);
  window.eval(DEFAULTS_SRC);
  window.eval(TOAST_SRC);
  // 短按 dispatch 的接收端（main.js 提供，本 spec 以 stub 觀測呼叫）
  const dispatched = [];
  window.__JRead.dispatchLocalCommand = (cmd) => { dispatched.push(cmd); return { ok: true }; };
  window.eval(FLOATING_SRC);
  return { window, document: window.document, NS: window.__JRead, chrome: window.chrome, dispatched };
}

describe('懸浮按鈕（v0.8.154）', () => {
  describe('wiring forcing function', () => {
    it('manifest content_scripts 含 floating-icon.js，在 namespace.js / toast.js 之後、main.js 之前', () => {
      const js = manifest.content_scripts[0].js;
      const idx = js.indexOf('content/floating-icon.js');
      assert.ok(idx !== -1, 'manifest 缺 content/floating-icon.js');
      assert.ok(idx > js.indexOf('content/namespace.js'), '必須在 namespace.js 之後（依賴 NS）');
      assert.ok(idx > js.indexOf('content/toast.js'), '必須在 toast.js 之後（togglePaged 用 NS.toast）');
      assert.ok(idx < js.indexOf('content/main.js'), '必須在 main.js 之前');
    });

    it('popup-core CONTENT_SCRIPT_FILES 也含 floating-icon.js（inject fallback 不漏）', () => {
      assert.ok(/content\/floating-icon\.js/.test(POPUP_CORE_SRC),
        'popup-core.js CONTENT_SCRIPT_FILES 缺 floating-icon.js——SPA inject fallback 會漏注入');
    });

    it('assets/* 在 web_accessible_resources（icon 經 getURL 載入）', () => {
      const war = manifest.web_accessible_resources || [];
      const ok = war.some((e) => (e.resources || []).some((r) => r === 'assets/*' || r.startsWith('assets/')));
      assert.ok(ok, 'icon 走 chrome.runtime.getURL("assets/...") 必須列入 web_accessible_resources');
    });
  });

  describe('host 注入', () => {
    it('host 掛在 documentElement、不掛 body（避免被 cleaner 動態 observer 隱藏）', () => {
      const { document, NS } = setup();
      const host = document.getElementById('__jread-floating-host');
      assert.ok(host, 'host 必須存在');
      assert.strictEqual(host.parentNode, document.documentElement,
        'host 必須直接掛 documentElement（掛 body 會被 cleaner 隱藏）');
      assert.ok(NS.floating, 'NS.floating 必須暴露給 spec / 觸發');
    });

    it('Shadow DOM 含 .fab 按鈕 + img + .menu', () => {
      const { document } = setup();
      const host = document.getElementById('__jread-floating-host');
      assert.ok(host.shadowRoot, '必須有 shadowRoot');
      assert.ok(host.shadowRoot.querySelector('button.fab'), '必須有 .fab 按鈕');
      assert.ok(host.shadowRoot.querySelector('.fab img'), '必須有 icon img');
      assert.ok(host.shadowRoot.querySelector('.menu'), '必須有長按選單容器');
    });
  });

  describe('啟用旗標未設過一律預設開（v0.8.158）', () => {
    it('未設過時：Safari runtime → 預設顯示（開）', () => {
      const { document } = setup({ scheme: 'safari-web-extension://' });
      const host = document.getElementById('__jread-floating-host');
      assert.strictEqual(host.style.display, 'block', 'Safari 未設過應預設開');
    });

    it('未設過時：Chrome runtime → 預設顯示（開，v0.8.158 改全平台預設開）', () => {
      const { document } = setup({ scheme: 'chrome-extension://' });
      const host = document.getElementById('__jread-floating-host');
      assert.strictEqual(host.style.display, 'block', 'Chrome 未設過 v0.8.158 起也預設開');
    });

    it('使用者明確設 false → 即使 Safari 也隱藏（尊重設定）', () => {
      const { document } = setup({ scheme: 'safari-web-extension://', store: { floatingIcon: false } });
      const host = document.getElementById('__jread-floating-host');
      assert.strictEqual(host.style.display, 'none');
    });

    it('使用者明確設 true → 即使 Chrome 也顯示', () => {
      const { document } = setup({ scheme: 'chrome-extension://', store: { floatingIcon: true } });
      const host = document.getElementById('__jread-floating-host');
      assert.strictEqual(host.style.display, 'block');
    });
  });

  describe('透明度與位置', () => {
    it('applyOpacity clamp 到 0.1–1', () => {
      const { NS, document } = setup();
      const host = document.getElementById('__jread-floating-host');
      NS.floating.applyOpacity(0.5);
      assert.strictEqual(host.style.opacity, '0.5');
      NS.floating.applyOpacity(5);
      assert.strictEqual(host.style.opacity, '1');
      NS.floating.applyOpacity(0);
      assert.strictEqual(host.style.opacity, '0.1');
      NS.floating.applyOpacity(undefined);
      assert.strictEqual(host.style.opacity, '0.7', '非數值退回預設 0.7');
    });

    it('sanitizePos 預設左緣置中、消毒非法值', () => {
      const { NS } = setup();
      const f = NS.floating;
      // 跨 realm（window.eval）物件 prototype ≠ Node，spread 成 Node 物件再比
      assert.deepStrictEqual({ ...f.sanitizePos(undefined) }, { edge: 'left', offsetY: 0.5 });
      assert.deepStrictEqual({ ...f.sanitizePos({ edge: 'bogus', offsetY: 9 }) }, { edge: 'left', offsetY: 0.5 });
      assert.deepStrictEqual({ ...f.sanitizePos({ edge: 'right', offsetY: 0.2 }) }, { edge: 'right', offsetY: 0.2 });
    });

    it('applyPos 左緣 → 設 left、清 right；右緣相反', () => {
      const { NS, document } = setup();
      const host = document.getElementById('__jread-floating-host');
      NS.floating.applyPos({ edge: 'left', offsetY: 0 });
      assert.strictEqual(host.style.left, '6px');
      assert.strictEqual(host.style.right, 'auto');
      NS.floating.applyPos({ edge: 'right', offsetY: 1 });
      assert.strictEqual(host.style.right, '6px');
      assert.strictEqual(host.style.left, 'auto');
      // offsetY=1 → top = (800-32) = 768
      assert.strictEqual(host.style.top, '768px');
    });
  });

  describe('長按選單期間 host 全不透明（v0.8.158）', () => {
    it('openMenu → host opacity 1；closeMenu → 還原使用者設定透明度', () => {
      const { NS, document } = setup();
      const host = document.getElementById('__jread-floating-host');
      NS.floating.applyOpacity(0.4);          // 使用者設淡透明度 0.4
      assert.strictEqual(host.style.opacity, '0.4');
      NS.floating.openMenu();
      assert.ok(NS.floating.isMenuOpen(), '選單應開啟');
      assert.strictEqual(host.style.opacity, '1', '選單開著時 host 全不透明，讓選單看得清楚');
      NS.floating.closeMenu();
      assert.strictEqual(host.style.opacity, '0.4', '收選單還原使用者設定透明度');
    });

    it('選單開著時改透明度設定 → 不覆蓋全不透明，收選單後套用新值', () => {
      const { NS, document } = setup();
      const host = document.getElementById('__jread-floating-host');
      NS.floating.applyOpacity(0.5);
      NS.floating.openMenu();
      assert.strictEqual(host.style.opacity, '1');
      NS.floating.applyOpacity(0.3);          // 選單開著時 onChanged 改值
      assert.strictEqual(host.style.opacity, '1', '選單開著時不被新設定覆蓋');
      NS.floating.closeMenu();
      assert.strictEqual(host.style.opacity, '0.3', '收選單後套用期間更新的新透明度');
    });
  });

  describe('尺寸切換（v0.8.156）', () => {
    it('預設（未設過）→ small：footprint 32 / icon 16', () => {
      const { NS, document } = setup();
      const host = document.getElementById('__jread-floating-host');
      assert.strictEqual(NS.floating.getHitSize(), 32);
      assert.strictEqual(host.style.getPropertyValue('--fab-hit'), '32px');
      assert.strictEqual(host.style.getPropertyValue('--fab-icon'), '16px');
    });

    it('store floatingIconSize=large → footprint 48 / icon 32', () => {
      const { NS, document } = setup({ store: { floatingIconSize: 'large' } });
      const host = document.getElementById('__jread-floating-host');
      assert.strictEqual(NS.floating.getHitSize(), 48);
      assert.strictEqual(host.style.getPropertyValue('--fab-hit'), '48px');
      assert.strictEqual(host.style.getPropertyValue('--fab-icon'), '32px');
    });

    it('applySize 非法值退回 small', () => {
      const { NS, document } = setup({ store: { floatingIconSize: 'large' } });
      const host = document.getElementById('__jread-floating-host');
      NS.floating.applySize('bogus');
      assert.strictEqual(NS.floating.getHitSize(), 32);
      assert.strictEqual(host.style.getPropertyValue('--fab-hit'), '32px');
    });

    it('尺寸變更後 applyPos 依新 footprint 重算 top（offsetY=1）', () => {
      const { NS, document } = setup();
      const host = document.getElementById('__jread-floating-host');
      // small：top = 800 - 32 = 768
      NS.floating.applyPos({ edge: 'left', offsetY: 1 });
      assert.strictEqual(host.style.top, '768px');
      // large：footprint 48 → top = 800 - 48 = 752（applySize 內部已重貼一次）
      NS.floating.applySize('large');
      assert.strictEqual(host.style.top, '752px');
    });

    it('storage.onChanged floatingIconSize 即時生效', () => {
      const { NS, document, chrome } = setup();
      const host = document.getElementById('__jread-floating-host');
      chrome._emit({ floatingIconSize: { newValue: 'large' } });
      assert.strictEqual(NS.floating.getHitSize(), 48);
      assert.strictEqual(host.style.getPropertyValue('--fab-icon'), '32px');
      chrome._emit({ floatingIconSize: { newValue: 'small' } });
      assert.strictEqual(NS.floating.getHitSize(), 32);
    });
  });

  describe('短按：切換閱讀模式', () => {
    it('handleShortPress 呼叫 NS.dispatchLocalCommand("toggle-reader-mode")', () => {
      const { NS, dispatched } = setup();
      NS.floating.handleShortPress();
      assert.deepStrictEqual(dispatched, ['toggle-reader-mode']);
    });

    it('dispatchLocalCommand 缺席時 fallback 走 CUSTOM_COMMAND', () => {
      const { NS, chrome } = setup();
      delete NS.dispatchLocalCommand;
      NS.floating.handleShortPress();
      const msg = chrome._sent.find((m) => m && m.type === NS.MSG.CUSTOM_COMMAND);
      assert.ok(msg, '必須送 CUSTOM_COMMAND');
      assert.strictEqual(msg.payload.command, 'toggle-reader-mode');
    });
  });

  describe('長按選單', () => {
    it('MENU_ITEMS 含 readwise + paged 兩項（順序固定）', () => {
      const { NS } = setup();
      const ids = Array.from(NS.floating.MENU_ITEMS, (i) => i.id);
      assert.deepStrictEqual(ids, ['readwise', 'paged']);
    });

    it('buildMenu 渲染兩個 menu-item，帶 data-action + label', () => {
      const { NS, document } = setup();
      NS.floating.buildMenu();
      const items = document.getElementById('__jread-floating-host')
        .shadowRoot.querySelectorAll('.menu-item');
      assert.strictEqual(items.length, 2);
      assert.strictEqual(items[0].dataset.action, 'readwise');
      assert.strictEqual(items[1].dataset.action, 'paged');
      assert.ok(/Readwise/.test(items[0].textContent));
      assert.ok(/分頁/.test(items[1].textContent));
    });

    it('送 Readwise：CORS 擋直接 fetch → 轉 SW CUSTOM_COMMAND send-to-readwise', () => {
      const { NS, chrome } = setup();
      NS.floating.sendToReadwise();
      const msg = chrome._sent.find((m) => m && m.type === NS.MSG.CUSTOM_COMMAND);
      assert.ok(msg, '必須送 CUSTOM_COMMAND');
      assert.strictEqual(msg.payload.command, 'send-to-readwise');
    });

    it('切換分頁模式：翻轉 storage.sync.pagedMode（false→true）', () => {
      const { NS, chrome } = setup({ store: { pagedMode: false } });
      NS.floating.togglePaged();
      assert.strictEqual(chrome._data.pagedMode, true, 'pagedMode 必須被翻成 true');
    });

    it('切換分頁模式：true→false', () => {
      const { NS, chrome } = setup({ store: { pagedMode: true } });
      NS.floating.togglePaged();
      assert.strictEqual(chrome._data.pagedMode, false);
    });
  });

  describe('settings-defaults 新欄位 + 平台 resolver', () => {
    const DEFAULTS = require(path.join(JREAD, 'content', 'settings-defaults.js'));

    it('threeFingerTap 預設 false（v0.8.157 改預設關，可開）', () => {
      assert.strictEqual(DEFAULTS.threeFingerTap, false);
    });

    it('floatingIconOpacity 預設 0.7', () => {
      assert.strictEqual(DEFAULTS.floatingIconOpacity, 0.7);
    });

    it('floatingIconSize 預設 small（v0.8.156，不動既有使用者尺寸）', () => {
      assert.strictEqual(DEFAULTS.floatingIconSize, 'small');
    });

    it('floatingIcon 不放固定預設（三態，由 resolver 解析）', () => {
      assert.ok(!('floatingIcon' in DEFAULTS),
        'floatingIcon 不可放 DEFAULT_SETTINGS 固定布林——三態（含未設過）由 resolver 解析');
    });

    it('resolveFloatingIconEnabled：boolean 直通、非 boolean 一律預設開（v0.8.158）', () => {
      const resolve = global.__JReadResolveFloatingIconEnabled;
      assert.strictEqual(typeof resolve, 'function', 'resolver 必須掛上 global');
      assert.strictEqual(resolve(true), true);
      assert.strictEqual(resolve(false), false);
      // v0.8.158：未設過（非 boolean）一律預設開，不再依平台分流
      assert.strictEqual(resolve(undefined), true);
      assert.strictEqual(resolve(null), true);
    });
  });

  describe('options UI wiring', () => {
    const OPTIONS_HTML = fs.readFileSync(path.join(JREAD, 'options', 'options.html'), 'utf8');
    const OPTIONS_JS = fs.readFileSync(path.join(JREAD, 'options', 'options.js'), 'utf8');

    it('options.html 含 floatingIcon / threeFingerTap checkbox + floatingIconOpacity range + floatingIconSize select', () => {
      assert.match(OPTIONS_HTML, /<input[^>]+type=["']checkbox["'][^>]+id=["']floatingIcon["']/,
        '缺懸浮 icon 啟用 checkbox');
      assert.match(OPTIONS_HTML, /<input[^>]+type=["']checkbox["'][^>]+id=["']threeFingerTap["']/,
        '缺三指輕點 checkbox');
      assert.match(OPTIONS_HTML, /<input[^>]+type=["']range["'][^>]+id=["']floatingIconOpacity["']/,
        '缺透明度 range 滑桿');
      assert.match(OPTIONS_HTML, /<select[^>]+id=["']floatingIconSize["']/,
        '缺懸浮 icon 尺寸 select');
      assert.match(OPTIONS_HTML, /<option value=["']large["']/,
        '缺尺寸 large 選項');
    });

    it('options.js fields 陣列含四個新欄位（load / save / onChanged 同步）', () => {
      const m = OPTIONS_JS.match(/const fields = \[([^\]]*)\]/);
      assert.ok(m, '找不到 fields 陣列');
      for (const id of ['threeFingerTap', 'floatingIcon', 'floatingIconOpacity', 'floatingIconSize']) {
        assert.ok(m[1].includes(`'${id}'`), `fields 缺 ${id}——options 不會同步該欄`);
      }
    });

    it('options.js 用平台 resolver 顯示 floatingIcon 預設（不另寫一份平台判定）', () => {
      assert.ok(/__JReadResolveFloatingIconEnabled/.test(OPTIONS_JS),
        'options.js 必須共用 settings-defaults 的 resolver');
    });
  });

  describe('storage.onChanged 即時生效', () => {
    it('floatingIcon false → host 隱藏；true → 顯示', () => {
      const { document, chrome } = setup({ scheme: 'safari-web-extension://', store: { floatingIcon: true } });
      const host = document.getElementById('__jread-floating-host');
      assert.strictEqual(host.style.display, 'block');
      chrome._emit({ floatingIcon: { newValue: false } });
      assert.strictEqual(host.style.display, 'none');
      chrome._emit({ floatingIcon: { newValue: true } });
      assert.strictEqual(host.style.display, 'block');
    });

    it('floatingIconOpacity 變更即時套用', () => {
      const { document, chrome } = setup();
      const host = document.getElementById('__jread-floating-host');
      chrome._emit({ floatingIconOpacity: { newValue: 0.3 } });
      assert.strictEqual(host.style.opacity, '0.3');
    });

    it('floatingIconPos 變更即時貼邊', () => {
      const { document, chrome } = setup();
      const host = document.getElementById('__jread-floating-host');
      chrome._emit({ floatingIconPos: { newValue: { edge: 'right', offsetY: 0.5 } } });
      assert.strictEqual(host.style.right, '6px');
      assert.strictEqual(host.style.left, 'auto');
    });
  });
});
