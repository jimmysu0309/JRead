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

// v0.8.164：browser.storage.* 改用 Promise。本 spec 的多數斷言在呼叫後**同步**檢查
// 狀態（真實 Chrome 的 callback 也是非同步、但舊 mock 同步 resolve 以利測試）。
// 為保留既有同步斷言、又模擬 Promise 介面，mock 回「同步 resolve 的 thenable」
// ——.then 的 callback 在當下同步執行（非 microtask），支援 .then().catch() 與
// .then 內 return 巢狀 thenable（togglePaged 的 get→set 鏈）。
function _syncResolved(value) {
  return {
    then(onF) {
      if (typeof onF !== 'function') return _syncResolved(value);
      let r;
      try { r = onF(value); } catch (e) { return _syncRejected(e); }
      return (r && typeof r.then === 'function') ? r : _syncResolved(r);
    },
    catch() { return this; }
  };
}
function _syncRejected(err) {
  return {
    then(_onF, onR) {
      if (typeof onR === 'function') { try { return _syncResolved(onR(err)); } catch (e) { return _syncRejected(e); } }
      return this;
    },
    catch(onR) { try { return _syncResolved(onR(err)); } catch (e) { return _syncRejected(e); } }
  };
}

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
      sendMessage: (msg) => { sent.push(msg); return _syncResolved(undefined); }
    },
    storage: {
      sync: {
        get(keys) {
          const out = {};
          const list = Array.isArray(keys) ? keys
            : (keys && typeof keys === 'object') ? Object.keys(keys) : [keys];
          for (const k of list) {
            out[k] = (k in data) ? data[k]
              : (keys && typeof keys === 'object' && !Array.isArray(keys)) ? keys[k] : undefined;
          }
          return _syncResolved(out);
        },
        set(obj) {
          const changes = {};
          for (const k of Object.keys(obj)) {
            changes[k] = { oldValue: data[k], newValue: obj[k] };
            data[k] = obj[k];
          }
          onChangedListeners.forEach((fn) => fn(changes, 'sync'));
          return _syncResolved(undefined);
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
      assert.ok(ok, 'icon 走 browser.runtime.getURL("assets/...") 必須列入 web_accessible_resources');
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

    // v0.8.159：shadow 內 CSS 必須走 NS.injectShadowCss（CSP-safe）——嚴格 style-src
    // nonce-only 站（自架 Miniflux）在 WebKit 會擋掉 shadow 內注入的 <style>，使 .fab
    // 拿不到 var(--fab-hit) 寬高、icon 退回 <img> 原生 32px 無視尺寸設定。
    it('shadow CSS 走 NS.injectShadowCss（CSP-safe），不可裸 prepend <style>', () => {
      assert.match(FLOATING_SRC, /NS\.injectShadowCss\(\s*shadow\s*,\s*CSS\s*\)/,
        'floating-icon 必須用 NS.injectShadowCss 注入 shadow CSS（CSP-safe）');
      assert.ok(!/shadow\.prepend\(\s*styleEl\s*\)/.test(FLOATING_SRC),
        '不可裸 shadow.prepend(styleEl)——嚴格 style-src 站在 WebKit 會被擋');
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

    it('sanitizePos 預設左下角（v0.8.160 offsetY=1）、消毒非法值', () => {
      const { NS } = setup();
      const f = NS.floating;
      // 跨 realm（window.eval）物件 prototype ≠ Node，spread 成 Node 物件再比
      assert.deepStrictEqual({ ...f.sanitizePos(undefined) }, { edge: 'left', offsetY: 1 });
      assert.deepStrictEqual({ ...f.sanitizePos({ edge: 'bogus', offsetY: 9 }) }, { edge: 'left', offsetY: 1 });
      assert.deepStrictEqual({ ...f.sanitizePos({ edge: 'right', offsetY: 0.2 }) }, { edge: 'right', offsetY: 0.2 });
    });

    it('未設過 floatingIconPos → host 貼左下角（left=6、top=底）', () => {
      const { NS, document } = setup();
      const host = document.getElementById('__jread-floating-host');
      // innerHeight=800、small footprint 32 → top = 1 * (800-32) = 768
      assert.deepStrictEqual({ ...NS.floating.getPos() }, { edge: 'left', offsetY: 1 });
      assert.strictEqual(host.style.left, '6px');
      assert.strictEqual(host.style.top, '768px');
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

    it('buildMenu 渲染三個 menu-item（readwise / paged / 功能選單）+ 分隔線', () => {
      const { NS, document } = setup();
      NS.floating.buildMenu();
      const shadow = document.getElementById('__jread-floating-host').shadowRoot;
      const items = shadow.querySelectorAll('.menu-item');
      assert.strictEqual(items.length, 3, 'v0.8.162 起含「功能選單」共三項');
      assert.strictEqual(items[0].dataset.action, 'readwise');
      assert.strictEqual(items[1].dataset.action, 'paged');
      assert.strictEqual(items[2].dataset.action, 'feature-menu');
      assert.ok(/Readwise/.test(items[0].textContent));
      assert.ok(/分頁/.test(items[1].textContent));
      assert.ok(/功能選單/.test(items[2].textContent));
      // 「功能選單」前必須有分隔線（與翻譯/閱讀動作區隔）
      assert.ok(shadow.querySelector('.menu-divider'), '功能選單前必須有分隔線');
    });

    // v0.8.165：送 Readwise 依 runtime 分流——Chrome（content fetch 受 CORS 擋）轉 SW；
    // Safari（iOS / iPadOS，SW 背景 fetch 不可靠）改 content script 直送。
    it('Chrome runtime：content fetch 受 CORS 擋 → 轉 SW CUSTOM_COMMAND send-to-readwise', () => {
      const { NS, chrome } = setup({ scheme: 'chrome-extension://' });
      NS.floating.sendToReadwise();
      const msg = chrome._sent.find((m) => m && m.type === NS.MSG.CUSTOM_COMMAND);
      assert.ok(msg, '必須送 CUSTOM_COMMAND');
      assert.strictEqual(msg.payload.command, 'send-to-readwise');
    });

    it('Safari runtime：呼叫 NS.sendCurrentPageToReadwise（content 直送），不送 SW CUSTOM_COMMAND', () => {
      const { NS, chrome } = setup({ scheme: 'safari-web-extension://' });
      let called = 0;
      NS.sendCurrentPageToReadwise = () => { called += 1; };
      NS.floating.sendToReadwise();
      assert.strictEqual(called, 1, 'Safari 必須走 content 端直送');
      assert.ok(!chrome._sent.find((m) => m && m.type === NS.MSG.CUSTOM_COMMAND),
        'Safari 不可再轉 SW CUSTOM_COMMAND（SW 背景 fetch 在 iOS 不可靠）');
    });

    it('Safari runtime 但 sendCurrentPageToReadwise 尚未就緒（注入競態）→ 退回 SW CUSTOM_COMMAND', () => {
      const { NS, chrome } = setup({ scheme: 'safari-web-extension://' });
      // 不設 NS.sendCurrentPageToReadwise（模擬 main.js 尚未 eval）
      NS.floating.sendToReadwise();
      const msg = chrome._sent.find((m) => m && m.type === NS.MSG.CUSTOM_COMMAND);
      assert.ok(msg, '函式缺席時必須 fallback 走 SW CUSTOM_COMMAND，不可靜默失敗');
      assert.strictEqual(msg.payload.command, 'send-to-readwise');
    });

    it('點擊當下先彈 info toast（視覺提示，兩平台都有）', () => {
      const { NS, document } = setup({ scheme: 'safari-web-extension://' });
      NS.sendCurrentPageToReadwise = () => {};
      NS.floating.sendToReadwise();
      const toastHost = document.getElementById('__jread-toast-host');
      const text = toastHost ? (toastHost.shadowRoot || toastHost).textContent : '';
      assert.match(text, /Readwise/, '送出當下必須有「送出到 Readwise Reader…」視覺提示 toast');
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

  // ── 功能選單：叫出工具列圖示選單 popup（v0.8.162，比照 Shinkansen）───────────
  describe('功能選單 → 叫出 popup（v0.8.162）', () => {
    it('Safari runtime → 送 SW OPEN_FEATURE_MENU（不在頁內 iframe，避免 iOS 整頁 refresh）', () => {
      const { NS, chrome, document } = setup({ scheme: 'safari-web-extension://' });
      assert.strictEqual(NS.floating.isSafariRuntime(), true);
      NS.floating.openFeaturePanel();
      const msg = chrome._sent.find((m) => m && m.type === NS.MSG.OPEN_FEATURE_MENU);
      assert.ok(msg, 'Safari 必須送 OPEN_FEATURE_MENU 給 SW');
      // 不可在 Safari 開頁內 iframe 浮層
      assert.strictEqual(document.getElementById('__jread-panel-host'), null);
    });

    it('非 Safari（Chrome）→ 頁內 iframe 浮層載 popup.html?panel=1（不送 SW）', () => {
      const { NS, chrome, document } = setup({ scheme: 'chrome-extension://' });
      assert.strictEqual(NS.floating.isSafariRuntime(), false);
      NS.floating.openFeaturePanel();
      assert.ok(!chrome._sent.find((m) => m && m.type === NS.MSG.OPEN_FEATURE_MENU),
        'Chrome 不可送 OPEN_FEATURE_MENU（走頁內 iframe）');
      const panelHost = document.getElementById('__jread-panel-host');
      assert.ok(panelHost, '必須建立頁內浮層 host');
      assert.strictEqual(panelHost.parentNode, document.documentElement,
        'panel host 掛 documentElement（不掛 body）');
      const frame = panelHost.shadowRoot.querySelector('iframe.frame');
      assert.ok(frame, '浮層內必須有 iframe');
      assert.ok(/popup\/popup\.html\?panel=1$/.test(frame.src), 'iframe 必須載 popup.html?panel=1');
      assert.ok(NS.floating.isPanelOpen(), 'isPanelOpen 應回 true');
    });

    it('重複開啟不產生第二個浮層', () => {
      const { NS, document } = setup({ scheme: 'chrome-extension://' });
      NS.floating.openFeaturePanel();
      NS.floating.openFeaturePanel();
      assert.strictEqual(document.querySelectorAll('#__jread-panel-host').length, 1);
    });

    it('closeFeaturePanel 移除浮層 + 清狀態', () => {
      const { NS, document } = setup({ scheme: 'chrome-extension://' });
      NS.floating.openFeaturePanel();
      assert.ok(NS.floating.isPanelOpen());
      NS.floating.closeFeaturePanel();
      assert.strictEqual(document.getElementById('__jread-panel-host'), null);
      assert.strictEqual(NS.floating.isPanelOpen(), false);
    });

    it('點選單「功能選單」項 → 收選單 + 呼 openFeaturePanel（Chrome 開浮層）', () => {
      const { NS, document, window } = setup({ scheme: 'chrome-extension://' });
      NS.floating.openMenu();
      const featureBtn = document.getElementById('__jread-floating-host')
        .shadowRoot.querySelector('.menu-item[data-action="feature-menu"]');
      assert.ok(featureBtn, '選單必須有功能選單項');
      featureBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      assert.strictEqual(NS.floating.isMenuOpen(), false, '點功能選單後長按選單應收合');
      assert.ok(document.getElementById('__jread-panel-host'), '應開出頁內浮層');
    });

    it('manifest popup/popup.html 列入 web_accessible_resources（iframe 浮層可載）', () => {
      const war = manifest.web_accessible_resources || [];
      const ok = war.some((e) => (e.resources || []).some((r) => r === 'popup/popup.html'));
      assert.ok(ok, 'popup.html 要當 iframe src 必須列入 web_accessible_resources');
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

  // ── 觸控角落保留區（v0.8.161）：iPadOS 左下角 = 視窗縮放把手、上方角落 = 系統手勢區，
  //    按鈕停太靠近會被 OS 攔走觸控而拖不出來，故觸控裝置把 y 夾離上下角落 ───────────
  describe('觸控角落夾邊 cornerClampTop（v0.8.161）', () => {
    it('CORNER_DEADZONE_PX = 44', () => {
      const { NS } = setup();
      assert.strictEqual(NS.floating.CORNER_DEADZONE_PX, 44);
    });

    it('非觸控：只夾在可視範圍、不留角落間距', () => {
      const { NS } = setup();
      const f = NS.floating;
      assert.strictEqual(f.cornerClampTop(768, 800, 32, false), 768);
      assert.strictEqual(f.cornerClampTop(-10, 800, 32, false), 0, '上界夾 0');
      assert.strictEqual(f.cornerClampTop(9999, 800, 32, false), 768, '下界夾 vh-hit');
    });

    it('觸控：top 夾離上下角落 44px', () => {
      const { NS } = setup();
      const f = NS.floating;
      // minTop=44、maxTop=800-32-44=724
      assert.strictEqual(f.cornerClampTop(768, 800, 32, true), 724, '底部角落夾到 maxTop');
      assert.strictEqual(f.cornerClampTop(0, 800, 32, true), 44, '頂部角落夾到 minTop');
      assert.strictEqual(f.cornerClampTop(400, 800, 32, true), 400, '中段不動');
    });

    it('觸控 + 視窗太矮夾不出安全區 → 置中', () => {
      const { NS } = setup();
      // vh=60、hit=32：maxFree=28、maxTop=60-32-44=-16 < minTop=44 → round(28/2)=14
      assert.strictEqual(NS.floating.cornerClampTop(999, 60, 32, true), 14);
    });

    it('setTouchForTest(true)：預設左下角（offsetY=1）被夾離底角', () => {
      const { NS, document } = setup();
      const host = document.getElementById('__jread-floating-host');
      // 桌面（jsdom maxTouchPoints=0）：top = 800-32 = 768
      assert.strictEqual(host.style.top, '768px');
      NS.floating.setTouchForTest(true);
      // 觸控：top 夾到 maxTop = 800-32-44 = 724
      assert.strictEqual(host.style.top, '724px', '觸控時按鈕離底角 44px、不卡縮放把手');
      NS.floating.setTouchForTest(false);
      assert.strictEqual(host.style.top, '768px', '還原非觸控不留間距');
    });
  });

  // ── disable → 重新 enable 回到預設位置（v0.8.161）────────────────────────────
  describe('重新 enable 回預設位置（v0.8.161）', () => {
    it('初始載入不重置：尊重 storage 存的位置', () => {
      const { NS } = setup({ store: { floatingIcon: true, floatingIconPos: { edge: 'right', offsetY: 0.3 } } });
      assert.deepStrictEqual({ ...NS.floating.getPos() }, { edge: 'right', offsetY: 0.3 },
        '初始載入（lastEnabled=null）不可重置位置');
    });

    it('disable 再 enable → 位置回預設左下角 + 持久化', () => {
      const { NS, chrome } = setup({ store: { floatingIcon: true, floatingIconPos: { edge: 'right', offsetY: 0.2 } } });
      assert.deepStrictEqual({ ...NS.floating.getPos() }, { edge: 'right', offsetY: 0.2 });
      chrome._emit({ floatingIcon: { newValue: false } });
      chrome._emit({ floatingIcon: { newValue: true } });
      assert.deepStrictEqual({ ...NS.floating.getPos() }, { edge: 'left', offsetY: 1 },
        'false→true 轉移應重置回預設左下角');
      assert.deepStrictEqual({ ...chrome._data.floatingIconPos }, { edge: 'left', offsetY: 1 },
        '重置後位置應持久化進 storage');
    });

    it('連續 enable（無中間 disable）不重置', () => {
      const { NS, chrome } = setup({ store: { floatingIcon: true, floatingIconPos: { edge: 'right', offsetY: 0.4 } } });
      chrome._emit({ floatingIcon: { newValue: true } });
      assert.deepStrictEqual({ ...NS.floating.getPos() }, { edge: 'right', offsetY: 0.4 },
        'true→true 不算重新 enable，不重置');
    });
  });

  // ── 長按選單比照 Shinkansen 重繪（v0.8.161）──────────────────────────────────
  describe('長按選單 Shinkansen style（v0.8.161）', () => {
    it('menu-item .ico 是藍色圓角 badge（非裸 emoji）', () => {
      assert.match(FLOATING_SRC, /\.menu-item \.ico \{[^}]*background:\s*#0071e3/,
        'menu badge 必須是 Shinkansen 藍色 #0071e3');
      assert.match(FLOATING_SRC, /\.menu-item \.ico \{[^}]*border-radius:\s*5px/,
        'menu badge 必須有圓角');
    });

    it('label 過長 ellipsis 收尾', () => {
      assert.match(FLOATING_SRC, /\.menu-item \.label \{[^}]*text-overflow:\s*ellipsis/);
    });
  });

  describe('options 透明度範例 icon（v0.8.161）', () => {
    const OPTIONS_HTML = fs.readFileSync(path.join(JREAD, 'options', 'options.html'), 'utf8');
    const OPTIONS_JS = fs.readFileSync(path.join(JREAD, 'options', 'options.js'), 'utf8');

    it('options.html opacity-control 含範例 icon（floatingIconOpacityDemo）', () => {
      assert.match(OPTIONS_HTML, /id=["']floatingIconOpacityDemo["']/,
        '缺透明度範例 icon 容器');
      assert.match(OPTIONS_HTML, /floatingIconOpacityDemo["'][^>]*>\s*<img/,
        '範例 icon 容器內必須有 img');
    });

    it('options.js 範例 icon 跟著透明度 + 尺寸變動', () => {
      assert.match(OPTIONS_JS, /function updateOpacityDemo\(\)/,
        '缺 updateOpacityDemo——範例 icon 不會更新');
      // 尺寸 select change → 更新範例 icon 大小
      assert.match(OPTIONS_JS, /floatingIconSize[\s\S]{0,200}addEventListener\(['"]change['"],\s*updateOpacityDemo/,
        '尺寸 select 改變必須即時更新範例 icon 大小');
    });
  });
});
