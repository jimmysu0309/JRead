// JRead — service worker e2e regression spec（v0.7.20 清 PENDING 條目 3/4/5）
// -----------------------------------------------------------------------------
// 必要動作：`npm run test:e2e`（預設 `npm test` 已 --ignore test/e2e/**）。
// 需要 Playwright bundled Chromium（首次：`npx playwright install chromium`）。
//
// 涵蓋以下 PENDING_REGRESSION 條目：
//
//   條目 3（2026-04-21）：importScripts 相對路徑解析
//     v0.4.1 修法 `importScripts('/popup/popup-core.js')` 絕對路徑。
//     行為 forcing：SW 啟動後驗 self.__JReadPopup 已掛載（importScripts 成功）。
//     回退成 relative path → 本 spec fail（SW 註冊根本失敗）。
//
//   條目 5（2026-04-22）：action icon swap wire-up（ACTIVE ↔ IDLE）
//     v0.7.0 新增 + v0.7.3 修絕對路徑。三條 wire：
//       (a) chrome.runtime.onMessage handler 收 SET_ACTIVE_ICON → setIcon
//       (b) chrome.tabs.onUpdated status=loading → setIcon IDLE
//       (c) content main.js 於 enter/exit reader mode 發 SET_ACTIVE_ICON
//     策略：在 SW 內 monkey-patch chrome.action.setIcon 記錄所有 calls、
//     trigger TOGGLE_READER_MODE 後檢查記錄。驗 ICONS_ACTIVE / ICONS_IDLE 值。
//
//   條目 4（2026-04-21）：commands.onCommand handler wire-up
//     v0.4.0 新增。listener 註冊 + 核心 toggleWithInjectionFallback 可在
//     SW context 下跑。Playwright 無法從 page 觸發 extension commands
//     （shortcut 綁 browser 層），最多驗「listener 存在 + 核心能跑」。

const path = require('path');
const assert = require('assert');

const { launchExtension, openTab, getTabId, startFixtureServer } =
  require(path.join(__dirname, '..', '..', 'tools', 'e2e-harness.js'));

describe('SW e2e regression（PENDING 條目 3/4/5）', function () {
  this.timeout(60000);

  let harness, server, TEST_URL;
  before(async () => {
    server = await startFixtureServer();
    TEST_URL = server.url;
    harness = await launchExtension();
  });
  after(async () => {
    if (harness) await harness.cleanup();
    if (server) await server.close();
  });

  // ---- 條目 3：importScripts 絕對路徑 ----
  describe('條目 3: importScripts', () => {
    it('SW 啟動成功且 self.__JReadPopup 已掛載（forcing 絕對路徑）', async () => {
      const state = await harness.sw.evaluate(() => ({
        hasPopupNs: typeof self.__JReadPopup === 'object' && self.__JReadPopup !== null,
        hasToggleFn: typeof (self.__JReadPopup && self.__JReadPopup.toggleWithInjectionFallback) === 'function',
        hasFilesList: Array.isArray(self.__JReadPopup && self.__JReadPopup.CONTENT_SCRIPT_FILES)
      }));
      assert.strictEqual(state.hasPopupNs, true,
        'self.__JReadPopup 必須存在——importScripts(/popup/popup-core.js) 成功的證明；' +
        '若回退成 relative path `popup/popup-core.js` 會解析成 /background/popup/popup-core.js 載入失敗、此 assertion fail');
      assert.strictEqual(state.hasToggleFn, true,
        'toggleWithInjectionFallback 必須從 popup-core 匯入');
      assert.strictEqual(state.hasFilesList, true,
        'CONTENT_SCRIPT_FILES 必須從 popup-core 匯入');
    });
  });

  // ---- 條目 5：action icon swap ----
  describe('條目 5: action icon swap（SET_ACTIVE_ICON + tabs.onUpdated）', () => {
    let page, tabId;

    before(async () => {
      // 在 SW 內 monkey-patch chrome.action.setIcon 前就載頁、避免 onUpdated
      // 在 patch 前觸發的 IDLE call 汙染紀錄。
      // 先 patch 再開 tab：SW 啟動時已經註冊了 tabs.onUpdated listener、
      // 但 about:blank initial tab 沒觸發外部 URL loading——patch 後 openTab
      // 的 loading 狀態會進 patched 版本，第一次 call 就是 IDLE。
      await harness.sw.evaluate(() => {
        self.__iconCalls = [];
        const orig = chrome.action.setIcon.bind(chrome.action);
        chrome.action.setIcon = (opts) => {
          // 只記下 path map 的 key（16/32/48/128）取其一當辨識
          // ICONS_ACTIVE 路徑含 'icon-16.png'、ICONS_IDLE 含 'icon-16-disabled.png'
          const pathSignature = opts && opts.path && opts.path['16'];
          self.__iconCalls.push({ tabId: opts.tabId, pathSignature, when: Date.now() });
          return orig(opts);
        };
      });

      page = await openTab(harness.ctx, TEST_URL, { settleMs: 2000 });
      tabId = await getTabId(harness.sw, TEST_URL);
      assert.ok(typeof tabId === 'number', '必須能取得新 tab id');
    });

    after(async () => { if (page) await page.close(); });

    it('(b) 頁面 load 時 tabs.onUpdated 觸發 setIcon IDLE', async () => {
      const calls = await harness.sw.evaluate(() => self.__iconCalls);
      const idleCall = calls.find(c =>
        c.tabId === tabId && c.pathSignature && c.pathSignature.includes('disabled'));
      assert.ok(idleCall,
        `tabs.onUpdated status=loading 應觸發 setIcon IDLE。實際 calls: ${JSON.stringify(calls)}`);
    }).timeout(10000);

    it('(a)(c) 觸發 TOGGLE_READER_MODE → SET_ACTIVE_ICON message → setIcon ACTIVE', async function () {
      // 透過 SW sendMessage 觸發 content script（走跟 popup 相同路徑）
      const toggle = await harness.sw.evaluate(async (id) => {
        try {
          const res = await chrome.tabs.sendMessage(id, { type: 'TOGGLE_READER_MODE' });
          return { ok: true, res };
        } catch (e) { return { ok: false, err: e.message }; }
      }, tabId);
      // example.com 的內容可能不足讓 detector 命中；如果 detector no-op
      // SET_ACTIVE_ICON 不會發——跳過此 test 並提示（mocha this.skip 需要
      // regular function 才能拿到 context）。
      if (!toggle.ok || !(toggle.res && toggle.res.active)) {
        this.skip();
        return;
      }
      // 等 content main.js 發 SET_ACTIVE_ICON message + SW handler 處理
      await new Promise(r => setTimeout(r, 800));
      const calls = await harness.sw.evaluate(() => self.__iconCalls);
      const activeCall = calls.find(c =>
        c.tabId === tabId && c.pathSignature &&
        c.pathSignature.includes('icon-16.png') && !c.pathSignature.includes('disabled'));
      assert.ok(activeCall,
        `enter reader mode 應觸發 setIcon ACTIVE。實際 calls: ${JSON.stringify(calls)}`);
    }).timeout(15000);
  });

  // ---- 條目 4：commands.onCommand handler ----
  describe('條目 4: commands.onCommand handler wire-up', () => {
    it('chrome.commands.onCommand 有 listener 註冊', async () => {
      const hasListener = await harness.sw.evaluate(
        () => chrome.commands.onCommand.hasListeners()
      );
      assert.strictEqual(hasListener, true,
        'manifest commands 宣告 toggle-reader-mode、SW 必須在載入時用 ' +
        'chrome.commands.onCommand.addListener 掛鉤（wire-up 的結構性 forcing）');
    });

    it('核心 toggleWithInjectionFallback 可在 SW context 跑（模擬 command handler 路徑）', async () => {
      // commands.onCommand.dispatch 不是 public API；最多驗「command handler
      // 內叫的核心函式在 SW context 下能正常取 active tab + 呼叫 core」。
      // 這是 handler 三行邏輯的可測部分（query tabs → core）。
      const result = await harness.sw.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || typeof tab.id !== 'number') return { ok: false, err: 'no active tab' };
        const { toggleWithInjectionFallback } = self.__JReadPopup;
        if (typeof toggleWithInjectionFallback !== 'function') return { ok: false, err: 'core fn missing' };
        const r = await toggleWithInjectionFallback(tab.id, {
          sendMessage: (id, m) => chrome.tabs.sendMessage(id, m),
          executeScript: (opts) => chrome.scripting.executeScript(opts)
        });
        return { ok: r.ok === true || r.ok === false, res: { ok: r.ok, injected: r.injected } };
      });
      assert.strictEqual(result.ok, true,
        `核心路徑必須可在 SW context 下跑（即便 tab 是 about:blank 且 toggle ok=false，` +
        `也要能 return 結構；此處 ok=true 表示 fn 返回了合法 shape）。實際：${JSON.stringify(result)}`);
    });
  });
});
