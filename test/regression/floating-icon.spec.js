// JRead — 懸浮按鈕 regression spec（v0.8.154）
//
// 驗 content/floating-icon.js 的 DOM 行為與 wiring：
//   - host 掛 documentElement（不掛 body——body children 會被 cleaner 動態
//     observer 隱藏，memory feedback_reader_injected_ui_append_html）
//   - 啟用旗標未設過一律預設開（v0.8.158，原平台分流取消）
//   - 透明度 clamp、位置 sanitize（預設左緣）
//   - 短按 → NS.dispatchLocalCommand('toggle-reader-mode')
//   - 長按選單：切換分頁模式（翻轉 storage.sync.pagedMode）+ 功能選單（叫出 popup）；
//     v0.8.166 移除「送到 Readwise Reader」直送項（content 直送在 iOS toast 不顯示、
//     無回饋，Readwise 改走 popup 內按鈕）
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

function setup({ scheme, store, url } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', Object.assign({
    runScripts: 'outside-only', pretendToBeVisual: true
  }, url ? { url } : {}));
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
      // 尺寸 pin small（footprint 32）解耦預設尺寸——本案驗位置邏輯非尺寸
      const { NS, document } = setup({ store: { floatingIconSize: 'small' } });
      const host = document.getElementById('__jread-floating-host');
      // innerHeight=800、small footprint 32 → top = 1 * (800-32) = 768
      assert.deepStrictEqual({ ...NS.floating.getPos() }, { edge: 'left', offsetY: 1 });
      assert.strictEqual(host.style.left, '6px');
      assert.strictEqual(host.style.top, '768px');
    });

    it('applyPos 左緣 → 設 left、清 right；右緣相反', () => {
      const { NS, document } = setup({ store: { floatingIconSize: 'small' } });
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
    it('預設（未設過）→ medium：footprint 40 / icon 24（v0.8.166 預設改中）', () => {
      const { NS, document } = setup();
      const host = document.getElementById('__jread-floating-host');
      assert.strictEqual(NS.floating.getHitSize(), 40);
      assert.strictEqual(host.style.getPropertyValue('--fab-hit'), '40px');
      assert.strictEqual(host.style.getPropertyValue('--fab-icon'), '24px');
    });

    it('store floatingIconSize=small → footprint 32 / icon 16', () => {
      const { NS, document } = setup({ store: { floatingIconSize: 'small' } });
      const host = document.getElementById('__jread-floating-host');
      assert.strictEqual(NS.floating.getHitSize(), 32);
      assert.strictEqual(host.style.getPropertyValue('--fab-hit'), '32px');
      assert.strictEqual(host.style.getPropertyValue('--fab-icon'), '16px');
    });

    it('store floatingIconSize=medium → footprint 40 / icon 24（v0.8.166）', () => {
      const { NS, document } = setup({ store: { floatingIconSize: 'medium' } });
      const host = document.getElementById('__jread-floating-host');
      assert.strictEqual(NS.floating.getHitSize(), 40);
      assert.strictEqual(host.style.getPropertyValue('--fab-hit'), '40px');
      assert.strictEqual(host.style.getPropertyValue('--fab-icon'), '24px');
    });

    it('store floatingIconSize=large → footprint 48 / icon 32', () => {
      const { NS, document } = setup({ store: { floatingIconSize: 'large' } });
      const host = document.getElementById('__jread-floating-host');
      assert.strictEqual(NS.floating.getHitSize(), 48);
      assert.strictEqual(host.style.getPropertyValue('--fab-hit'), '48px');
      assert.strictEqual(host.style.getPropertyValue('--fab-icon'), '32px');
    });

    it('applySize 非法值退回預設 medium（v0.8.166）', () => {
      const { NS, document } = setup({ store: { floatingIconSize: 'large' } });
      const host = document.getElementById('__jread-floating-host');
      NS.floating.applySize('bogus');
      assert.strictEqual(NS.floating.getHitSize(), 40);
      assert.strictEqual(host.style.getPropertyValue('--fab-hit'), '40px');
      assert.strictEqual(host.style.getPropertyValue('--fab-icon'), '24px');
    });

    it('尺寸變更後 applyPos 依新 footprint 重算 top（offsetY=1）', () => {
      const { NS, document } = setup({ store: { floatingIconSize: 'small' } });
      const host = document.getElementById('__jread-floating-host');
      // small：top = 800 - 32 = 768
      NS.floating.applyPos({ edge: 'left', offsetY: 1 });
      assert.strictEqual(host.style.top, '768px');
      // large：footprint 48 → top = 800 - 48 = 752（applySize 內部已重貼一次）
      NS.floating.applySize('large');
      assert.strictEqual(host.style.top, '752px');
    });

    it('storage.onChanged floatingIconSize 即時生效（small↔medium↔large）', () => {
      const { NS, document, chrome } = setup();
      const host = document.getElementById('__jread-floating-host');
      chrome._emit({ floatingIconSize: { newValue: 'large' } });
      assert.strictEqual(NS.floating.getHitSize(), 48);
      assert.strictEqual(host.style.getPropertyValue('--fab-icon'), '32px');
      chrome._emit({ floatingIconSize: { newValue: 'medium' } });
      assert.strictEqual(NS.floating.getHitSize(), 40);
      assert.strictEqual(host.style.getPropertyValue('--fab-icon'), '24px');
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
    // v0.8.166：移除「送到 Readwise Reader」直送項——content 直送在 iOS toast 不顯示、
    // 無回饋（Jimmy 2026-06-23 實機）；Readwise 送出改走「功能選單」叫出的 popup 內按鈕。
    it('MENU_ITEMS = paged + reader（v1.0.23 新增進入 Reader；readwise 直送項仍不存在）', () => {
      const { NS } = setup();
      const ids = Array.from(NS.floating.MENU_ITEMS, (i) => i.id);
      assert.deepStrictEqual(ids, ['paged', 'reader']);
      assert.ok(!ids.includes('readwise'), 'Readwise 直送項必須移除（改走 popup）');
    });

    it('floating-icon.js 不再有 sendToReadwise / content 直送殘留（防回歸）', () => {
      assert.ok(!/sendToReadwise/.test(FLOATING_SRC),
        '不可殘留 sendToReadwise（v0.8.166 Readwise 改走 popup）');
      assert.ok(!/sendCurrentPageToReadwise/.test(FLOATING_SRC),
        '不可殘留 content 直送呼叫');
    });

    it('buildMenu 渲染三個 menu-item（paged / reader / 功能選單）+ 分隔線', () => {
      const { NS, document } = setup();
      NS.floating.buildMenu();
      const shadow = document.getElementById('__jread-floating-host').shadowRoot;
      const items = shadow.querySelectorAll('.menu-item');
      assert.strictEqual(items.length, 3, 'v1.0.23 起：切換分頁模式 + 進入 Reader + 功能選單共三項');
      assert.strictEqual(items[0].dataset.action, 'paged');
      assert.strictEqual(items[1].dataset.action, 'reader');
      assert.strictEqual(items[2].dataset.action, 'feature-menu');
      assert.ok(/分頁/.test(items[0].textContent));
      assert.ok(/進入 Reader/.test(items[1].textContent), '第二項必須是「進入 Reader」');
      assert.ok(/功能選單/.test(items[2].textContent));
      // 「功能選單」前必須有分隔線（與一般動作區隔）
      assert.ok(shadow.querySelector('.menu-divider'), '功能選單前必須有分隔線');
    });

    it('openReader 送 OPEN_READER 給 SW（content 無 tabs 權限，交 SW 開 reader.html）', () => {
      const { NS } = setup();
      let sent = null;
      NS.safeSendMessage = (msg) => { sent = msg; };
      NS.floating.openReader();
      assert.ok(sent && sent.type === NS.MSG.OPEN_READER, 'openReader 必須送 OPEN_READER 訊息');
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

  // ── YouTube watch 專屬長按選單（v1.5.13）──────────────────────────────────
  // 在 YouTube /watch 頁，選單改顯示影院模式 + 無邊模式（標籤依 active 動態切「啟動/關閉」），
  // 最下方仍保留功能選單；一般頁不受影響。
  describe('YouTube watch 專屬選單（v1.5.13）', () => {
    const YT_WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

    it('isYouTubeWatchPage：/watch 頁 → true（fallback URL 判定，cinema 模組未載入時）', () => {
      const { NS } = setup({ url: YT_WATCH });
      assert.strictEqual(NS.floating.isYouTubeWatchPage(), true);
    });

    it('isYouTubeWatchPage：YouTube 首頁（非 /watch）→ false', () => {
      const { NS } = setup({ url: 'https://www.youtube.com/' });
      assert.strictEqual(NS.floating.isYouTubeWatchPage(), false);
    });

    it('isYouTubeWatchPage：非 YouTube 站 → false', () => {
      const { NS } = setup({ url: 'https://example.com/watch' });
      assert.strictEqual(NS.floating.isYouTubeWatchPage(), false);
    });

    it('優先用 NS.cinema.isYouTubeWatch（cinema 模組載入後）', () => {
      const { NS } = setup({ url: 'https://example.com/' });
      // 注入後掛上 cinema stub 回 true → 即使 URL 非 YouTube 也以模組判定為準
      NS.cinema = { isYouTubeWatch: () => true };
      assert.strictEqual(NS.floating.isYouTubeWatchPage(), true);
    });

    it('buildMenu 在 YouTube watch → 影院 + 無邊 + 功能選單（三項 + 分隔線）', () => {
      const { NS, document } = setup({ url: YT_WATCH });
      NS.floating.buildMenu();
      const shadow = document.getElementById('__jread-floating-host').shadowRoot;
      const items = shadow.querySelectorAll('.menu-item');
      assert.strictEqual(items.length, 3, 'YouTube watch：影院 + 無邊 + 功能選單共三項');
      assert.strictEqual(items[0].dataset.action, 'yt-cinema');
      assert.strictEqual(items[1].dataset.action, 'yt-borderless');
      assert.strictEqual(items[2].dataset.action, 'feature-menu');
      assert.ok(/影院模式/.test(items[0].textContent), '第一項影院模式');
      assert.ok(/無邊模式/.test(items[1].textContent), '第二項無邊模式');
      assert.ok(/功能選單/.test(items[2].textContent), '最下方仍保留功能選單');
      assert.ok(shadow.querySelector('.menu-divider'), '功能選單前必須有分隔線');
      // 一般動作（分頁 / 進入 Reader）在 YouTube watch 不出現
      assert.ok(!/分頁/.test(shadow.textContent), 'YouTube watch 不應有分頁模式');
      assert.ok(!/進入 Reader/.test(shadow.textContent), 'YouTube watch 不應有進入 Reader');
    });

    it('標籤依 active 狀態動態切「啟動 / 關閉」', () => {
      const { NS, document } = setup({ url: YT_WATCH });
      const shadow = document.getElementById('__jread-floating-host').shadowRoot;
      // 預設都未 active → 「啟動」
      NS.floating.buildMenu();
      let items = shadow.querySelectorAll('.menu-item');
      assert.ok(/啟動影院模式/.test(items[0].textContent));
      assert.ok(/啟動無邊模式/.test(items[1].textContent));
      // cinema active → 影院列改「關閉」
      NS.state.cinemaActive = true;
      NS.floating.buildMenu();
      items = shadow.querySelectorAll('.menu-item');
      assert.ok(/關閉影院模式/.test(items[0].textContent), 'cinema active → 關閉影院模式');
      // borderless active → 無邊列改「關閉」
      NS.state.cinemaActive = false;
      NS.borderless = { isActive: () => true };
      NS.floating.buildMenu();
      items = shadow.querySelectorAll('.menu-item');
      assert.ok(/啟動影院模式/.test(items[0].textContent));
      assert.ok(/關閉無邊模式/.test(items[1].textContent), 'borderless active → 關閉無邊模式');
    });

    it('點影院列 → 收選單 + 呼 NS.toggleYouTubeCinema', () => {
      const { NS, document, window } = setup({ url: YT_WATCH });
      let calledCinema = 0;
      NS.toggleYouTubeCinema = () => { calledCinema++; };
      NS.floating.openMenu();
      const btn = document.getElementById('__jread-floating-host')
        .shadowRoot.querySelector('.menu-item[data-action="yt-cinema"]');
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      assert.strictEqual(calledCinema, 1, '應呼 NS.toggleYouTubeCinema 一次');
      assert.strictEqual(NS.floating.isMenuOpen(), false, '點完應收選單');
    });

    it('點無邊列 → 呼 NS.toggleYouTubeBorderless', () => {
      const { NS, document, window } = setup({ url: YT_WATCH });
      let calledBorderless = 0;
      NS.toggleYouTubeBorderless = () => { calledBorderless++; };
      NS.floating.openMenu();
      const btn = document.getElementById('__jread-floating-host')
        .shadowRoot.querySelector('.menu-item[data-action="yt-borderless"]');
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      assert.strictEqual(calledBorderless, 1, '應呼 NS.toggleYouTubeBorderless 一次');
    });

    it('toggle helper：main.js 未載入時 fallback 走 dispatchLocalCommand', () => {
      const { NS, dispatched } = setup({ url: YT_WATCH });
      delete NS.toggleYouTubeCinema;
      delete NS.toggleYouTubeBorderless;
      NS.floating.toggleYtCinema();
      NS.floating.toggleYtBorderless();
      assert.deepStrictEqual(dispatched, ['toggle-reader-mode', 'toggle-youtube-borderless']);
    });

    it('非 YouTube 頁 buildMenu 仍是一般動作（不受影響）', () => {
      const { NS, document } = setup({ url: 'https://example.com/article' });
      NS.floating.buildMenu();
      const shadow = document.getElementById('__jread-floating-host').shadowRoot;
      const items = shadow.querySelectorAll('.menu-item');
      assert.strictEqual(items[0].dataset.action, 'paged');
      assert.strictEqual(items[1].dataset.action, 'reader');
      assert.strictEqual(items[2].dataset.action, 'feature-menu');
    });
  });

  // ── main.js 暴露的 YouTube 選單 toggle wiring（v1.5.13）─────────────────────
  describe('main.js YouTube toggle 暴露（v1.5.13）', () => {
    const MAIN_SRC = fs.readFileSync(path.join(JREAD, 'content', 'main.js'), 'utf8');
    it('main.js 暴露 NS.toggleYouTubeCinema / NS.toggleYouTubeBorderless（選單用明確語意 toggle）', () => {
      assert.match(MAIN_SRC, /NS\.toggleYouTubeCinema\s*=/, '缺 NS.toggleYouTubeCinema');
      assert.match(MAIN_SRC, /NS\.toggleYouTubeBorderless\s*=/, '缺 NS.toggleYouTubeBorderless');
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

    it('floatingIconSize 預設 medium（v0.8.166 預設改中，Jimmy 2026-06-23）', () => {
      assert.strictEqual(DEFAULTS.floatingIconSize, 'medium');
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

    it('options.html 含 floatingIcon / threeFingerTap checkbox + floatingIconOpacity range + floatingIconSize radio 群', () => {
      assert.match(OPTIONS_HTML, /<input[^>]+type=["']checkbox["'][^>]+id=["']floatingIcon["']/,
        '缺懸浮 icon 啟用 checkbox');
      assert.match(OPTIONS_HTML, /<input[^>]+type=["']checkbox["'][^>]+id=["']threeFingerTap["']/,
        '缺三指輕點 checkbox');
      assert.match(OPTIONS_HTML, /<input[^>]+type=["']range["'][^>]+id=["']floatingIconOpacity["']/,
        '缺透明度 range 滑桿');
      // v0.8.166：尺寸控制改 Shinkansen 風格 radio 群（小 / 中 / 大），不用下拉 select
      assert.match(OPTIONS_HTML, /id=["']floatingIconSize["'][^>]*role=["']radiogroup["']/,
        '尺寸控制必須是 radio 群（role=radiogroup），不可用下拉 select');
      assert.ok(!/<select[^>]+id=["']floatingIconSize["']/.test(OPTIONS_HTML),
        '不可再用下拉 select 做尺寸控制（Jimmy 2026-06-23）');
      assert.match(OPTIONS_HTML, /name=["']floatingIconSize["'][^>]*value=["']small["']/, '缺尺寸 小 radio');
      assert.match(OPTIONS_HTML, /name=["']floatingIconSize["'][^>]*value=["']medium["']/, '缺尺寸 中 radio（v0.8.166）');
      assert.match(OPTIONS_HTML, /name=["']floatingIconSize["'][^>]*value=["']large["']/, '缺尺寸 大 radio');
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

  // ── iPadOS 角落保留區（v0.8.161；v0.8.166 改為僅 iPadOS）：iPadOS 視窗角落 = 縮放把手 /
  //    系統手勢區，按鈕停太靠近會被 OS 攔走觸控而拖不出來，故 iPadOS 把 y 夾離上下角落；
  //    iPhone / 桌面不設禁制區（Jimmy 2026-06-23）───────────────────────────────────
  describe('iPadOS 角落夾邊 cornerClampTop（v0.8.161 / v0.8.166 僅 iPadOS）', () => {
    it('CORNER_DEADZONE_PX = 44', () => {
      const { NS } = setup();
      assert.strictEqual(NS.floating.CORNER_DEADZONE_PX, 44);
    });

    // isIPadOSEnv：禁制區只認 iPadOS（觸控 + iPad/Macintosh UA），iPhone / Android / 桌面排除
    it('isIPadOSEnv：iPad UA + 觸控 → true', () => {
      const { NS } = setup();
      assert.strictEqual(NS.floating.isIPadOSEnv('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5), true);
    });

    it('isIPadOSEnv：iPadOS 13+ 桌面模式偽裝 Macintosh + 觸控 → true', () => {
      const { NS } = setup();
      assert.strictEqual(NS.floating.isIPadOSEnv('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 5), true);
    });

    it('isIPadOSEnv：iPhone（即使帶 like Mac OS X）→ false（不設禁制區）', () => {
      const { NS } = setup();
      assert.strictEqual(NS.floating.isIPadOSEnv('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5), false);
    });

    it('isIPadOSEnv：桌面 Mac / iPad app on Mac（maxTouchPoints=0）→ false', () => {
      const { NS } = setup();
      assert.strictEqual(NS.floating.isIPadOSEnv('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 0), false);
    });

    it('isIPadOSEnv：Android 觸控 → false（無 iPad 視窗縮放角問題）', () => {
      const { NS } = setup();
      assert.strictEqual(NS.floating.isIPadOSEnv('Mozilla/5.0 (Linux; Android 14)', 5), false);
    });

    it('非 iPadOS：只夾在可視範圍、不留角落間距', () => {
      const { NS } = setup();
      const f = NS.floating;
      assert.strictEqual(f.cornerClampTop(768, 800, 32, false), 768);
      assert.strictEqual(f.cornerClampTop(-10, 800, 32, false), 0, '上界夾 0');
      assert.strictEqual(f.cornerClampTop(9999, 800, 32, false), 768, '下界夾 vh-hit');
    });

    it('iPadOS：top 夾離上下角落 44px', () => {
      const { NS } = setup();
      const f = NS.floating;
      // minTop=44、maxTop=800-32-44=724
      assert.strictEqual(f.cornerClampTop(768, 800, 32, true), 724, '底部角落夾到 maxTop');
      assert.strictEqual(f.cornerClampTop(0, 800, 32, true), 44, '頂部角落夾到 minTop');
      assert.strictEqual(f.cornerClampTop(400, 800, 32, true), 400, '中段不動');
    });

    it('iPadOS + 視窗太矮夾不出安全區 → 置中', () => {
      const { NS } = setup();
      // vh=60、hit=32：maxFree=28、maxTop=60-32-44=-16 < minTop=44 → round(28/2)=14
      assert.strictEqual(NS.floating.cornerClampTop(999, 60, 32, true), 14);
    });

    it('setIPadOSForTest(true)：預設左下角（offsetY=1）被夾離底角；false 還原不留間距', () => {
      // 尺寸 pin small（footprint 32）解耦預設尺寸——本案驗夾邊幾何
      const { NS, document } = setup({ store: { floatingIconSize: 'small' } });
      const host = document.getElementById('__jread-floating-host');
      // 桌面 / iPhone（jsdom 非 iPadOS）：top = 800-32 = 768
      assert.strictEqual(host.style.top, '768px');
      NS.floating.setIPadOSForTest(true);
      // iPadOS：top 夾到 maxTop = 800-32-44 = 724
      assert.strictEqual(host.style.top, '724px', 'iPadOS 時按鈕離底角 44px、不卡縮放把手');
      NS.floating.setIPadOSForTest(false);
      assert.strictEqual(host.style.top, '768px', '還原非 iPadOS 不留間距（iPhone / 桌面）');
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
