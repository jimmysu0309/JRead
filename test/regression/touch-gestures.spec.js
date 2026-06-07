// JRead — 3 指輕點切換閱讀模式（v0.7.223）
//
// Jimmy 2026-06-06 需求：iOS 觸控環境加 3 指 tap toggle 閱讀模式。
// 實作：content/touch-gestures.js 純邏輯狀態機（touchstart 恰 3 指 arm /
// 第 4 指取消 / 移動超容差取消 / 600ms 內全部離手觸發 / touchcancel 讓位
// 系統手勢），觸發送 CUSTOM_COMMAND('toggle-reader-mode') 走 SW
// dispatchCommand 單一資料源（與 manifest 快速鍵 / 自訂快速鍵同條）。
//
// 訊號層次：本檔驗狀態機邏輯（純物件餵入）+ wiring 字面值（manifest 順序 /
// CUSTOM_COMMAND payload / SW 白名單）。真實 TouchEvent 解析（identifier /
// clientX 映射）與 iOS 實機手勢時序靠 harness CDP 多點觸控 + TestFlight 實機。
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const gesture = require(path.join(ROOT, 'jread', 'content', 'touch-gestures.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'touch-gestures.js'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'background', 'service-worker.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'jread', 'manifest.json'), 'utf8'));

const t = (id, x, y) => ({ id, x, y });
const THREE = [t(1, 100, 100), t(2, 150, 100), t(3, 200, 100)];

describe('3 指輕點手勢（v0.7.223）', () => {
  describe('recognizer 狀態機', () => {
    it('恰好 3 指落下 → 600ms 內全離手 → 觸發', () => {
      let clock = 1000;
      const r = gesture.createRecognizer({ now: () => clock });
      r.touchStart(THREE);
      assert.strictEqual(r._isArmed(), true);
      clock += 300;
      assert.strictEqual(r.touchEnd(0), true);
    });

    it('超過時限（>600ms）才離手 → 不觸發', () => {
      let clock = 1000;
      const r = gesture.createRecognizer({ now: () => clock });
      r.touchStart(THREE);
      clock += 601;
      assert.strictEqual(r.touchEnd(0), false);
    });

    it('第 4 指出現 → 取消', () => {
      const r = gesture.createRecognizer({ now: () => 0 });
      r.touchStart(THREE);
      r.touchStart(THREE.concat([t(4, 250, 100)]));
      assert.strictEqual(r._isArmed(), false);
      assert.strictEqual(r.touchEnd(0), false);
    });

    it('任一指移動超過容差 → 取消（捲動 / 系統手勢不誤觸發）', () => {
      const r = gesture.createRecognizer({ now: () => 0 });
      r.touchStart(THREE);
      r.touchMove([t(1, 100, 140), t(2, 150, 100), t(3, 200, 100)]); // 指 1 下移 40px > 30
      assert.strictEqual(r._isArmed(), false);
      assert.strictEqual(r.touchEnd(0), false);
    });

    it('移動在容差內 → 不取消、照常觸發', () => {
      const r = gesture.createRecognizer({ now: () => 0 });
      r.touchStart(THREE);
      r.touchMove([t(1, 110, 110), t(2, 150, 100), t(3, 200, 100)]); // ~14px < 30
      assert.strictEqual(r.touchEnd(0), true);
    });

    it('部分手指仍在螢幕（remaining > 0）→ 不觸發、保持 arm 等最後一指', () => {
      const r = gesture.createRecognizer({ now: () => 0 });
      r.touchStart(THREE);
      assert.strictEqual(r.touchEnd(2), false); // 先放 1 指
      assert.strictEqual(r.touchEnd(1), false); // 再放 1 指
      assert.strictEqual(r.touchEnd(0), true);  // 最後 1 指離手才觸發
    });

    it('touchcancel（iOS 系統手勢接管）→ 取消', () => {
      const r = gesture.createRecognizer({ now: () => 0 });
      r.touchStart(THREE);
      r.cancel();
      assert.strictEqual(r.touchEnd(0), false);
    });

    it('1-2 指落下不 arm（一般點擊 / 雙指縮放不觸發）', () => {
      const r = gesture.createRecognizer({ now: () => 0 });
      r.touchStart([t(1, 100, 100)]);
      assert.strictEqual(r._isArmed(), false);
      r.touchStart([t(1, 100, 100), t(2, 150, 100)]);
      assert.strictEqual(r._isArmed(), false);
      assert.strictEqual(r.touchEnd(0), false);
    });

    it('觸發後狀態歸零，可重複辨識下一次手勢', () => {
      let clock = 0;
      const r = gesture.createRecognizer({ now: () => clock });
      r.touchStart(THREE);
      assert.strictEqual(r.touchEnd(0), true);
      assert.strictEqual(r.touchEnd(0), false); // 不重複觸發
      r.touchStart(THREE);
      assert.strictEqual(r.touchEnd(0), true);  // 第二次手勢正常
    });
  });

  describe('install 註冊 guard', () => {
    function fakeDoc() {
      const listeners = {};
      return {
        listeners,
        addEventListener(type, fn, opts) { listeners[type] = { fn, opts }; }
      };
    }

    it('maxTouchPoints < 3（桌面）→ 不註冊、回傳 false', () => {
      const doc = fakeDoc();
      assert.strictEqual(gesture.install(doc, { maxTouchPoints: 0 }, () => {}), false);
      assert.strictEqual(Object.keys(doc.listeners).length, 0);
    });

    it('maxTouchPoints >= 3 → 註冊 touchstart/move/end/cancel 四個 capture+passive listener', () => {
      const doc = fakeDoc();
      assert.strictEqual(gesture.install(doc, { maxTouchPoints: 5 }, () => {}), true);
      for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
        assert.ok(doc.listeners[type], `缺 ${type} listener`);
        assert.strictEqual(doc.listeners[type].opts.capture, true, `${type} 必須 capture`);
        assert.strictEqual(doc.listeners[type].opts.passive, true, `${type} 必須 passive`);
      }
    });

    it('端到端：fake TouchEvent 流 → onTrigger 被呼叫一次', () => {
      const doc = fakeDoc();
      let fired = 0;
      gesture.install(doc, { maxTouchPoints: 5 }, () => { fired++; });
      const mk = (arr) => ({ touches: arr.map((p, i) => ({ identifier: i, clientX: p[0], clientY: p[1] })) });
      doc.listeners.touchstart.fn(mk([[100, 100], [150, 100], [200, 100]]));
      doc.listeners.touchend.fn(mk([]));
      assert.strictEqual(fired, 1);
    });
  });

  describe('wiring forcing function', () => {
    it('manifest content_scripts 必須含 touch-gestures.js，且在 namespace.js 之後、main.js 之前', () => {
      const js = manifest.content_scripts[0].js;
      const idx = js.indexOf('content/touch-gestures.js');
      assert.ok(idx !== -1, 'manifest 缺 content/touch-gestures.js');
      assert.ok(idx > js.indexOf('content/namespace.js'), '必須在 namespace.js 之後（依賴 NS.safeSendMessage / NS.MSG）');
      assert.ok(idx < js.indexOf('content/main.js'), '必須在 main.js 之前');
    });

    // 註解剝除後才比對——檔頭/行內註解會提到同字面值（NS.dispatchLocalCommand
    // 等），whole-file regex 會被註解滿足產生偽陰性（sanity check 實證踩過）。
    const CODE = SRC.replace(/^\s*\/\/.*$/gm, '');

    it('觸發必須優先走 NS.dispatchLocalCommand（v0.7.228：iOS SW 死亡後仍可本地觸發）', () => {
      // iOS Safari 的 MV3 SW 被系統回收後不再喚醒（Apple Forums 758346）——
      // 3 指輕點是 iOS 觸控環境的主 toggle 通道，不可依賴 SW round-trip。
      assert.ok(/NS\.dispatchLocalCommand\('toggle-reader-mode'\)/.test(CODE),
        '觸發必須直接呼叫 NS.dispatchLocalCommand（content 端本地 dispatch，零訊息傳遞）');
      const localIdx = CODE.indexOf("NS.dispatchLocalCommand('toggle-reader-mode')");
      const swIdx = CODE.indexOf('NS.MSG.CUSTOM_COMMAND');
      assert.ok(localIdx !== -1 && swIdx !== -1 && localIdx < swIdx,
        '本地 dispatch 必須是主路徑、CUSTOM_COMMAND 只能是 fallback（順序顛倒 = iOS 失效 bug 回歸）');
    });

    it('fallback 必須保留 CUSTOM_COMMAND + safeSendMessage（SPA 注入競態時 main.js 未載）', () => {
      assert.ok(/NS\.MSG\.CUSTOM_COMMAND/.test(CODE), 'fallback 必須用 NS.MSG.CUSTOM_COMMAND');
      assert.ok(/command:\s*'toggle-reader-mode'/.test(CODE), 'payload.command 必須是 toggle-reader-mode');
      assert.ok(/NS\.safeSendMessage/.test(CODE), '必須走 NS.safeSendMessage（context invalidated guard）');
    });

    it('SW CUSTOM_COMMAND 白名單必須仍含 toggle-reader-mode', () => {
      assert.ok(/'toggle-reader-mode',\s*'send-to-readwise'/.test(SW_SRC),
        'SW 白名單被動過——3 指手勢與自訂快速鍵都會失效');
    });
  });
});
