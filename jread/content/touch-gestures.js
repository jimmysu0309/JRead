// JRead — 3 指輕點切換閱讀模式（v0.7.223）
//
// iOS / iPadOS 觸控裝置上 popup 入口藏在 Safari 位址列選單兩層深、鍵盤
// 快速鍵只有外接鍵盤可用——3 指輕點是觸控環境的主 toggle 通道。
//
// 辨識規則（結構性，不綁平台）：
//   - 同時恰好 3 指落下 → arm；第 4 指出現 → 取消
//   - 任一指移動超過容差（30px）→ 取消（視為捲動 / 系統 3 指手勢）
//   - 全部手指於時限（600ms）內離開 → 觸發
//   - touchcancel（iOS 系統手勢——3 指複製 / 撤銷等——接管時送出）→ 取消，
//     讓系統手勢優先
//
// 觸發走 NS.dispatchLocalCommand('toggle-reader-mode')（main.js 提供，含
// YouTube 模式重導）——v0.7.228 起與自訂快速鍵共用 content 端本地 dispatch，
// 不再 round-trip SW（iOS Safari SW 被回收後不再喚醒，Apple Forums 758346）。
//
// 跨環境匯出：content script 走 window.__JReadTouchGesture、regression
// spec 走 module.exports（jsdom 無 TouchEvent 建構子——狀態機收
// [{id, x, y}] 純物件，spec 直接餵資料不碰 DOM event）。
(function (global) {
  'use strict';

  const FINGERS = 3;
  const MOVE_TOLERANCE_PX = 30;
  const MAX_DURATION_MS = 600;

  // 純邏輯狀態機。touches = 當下螢幕上所有手指的 [{id, x, y}]。
  function createRecognizer(opts) {
    const o = opts || {};
    const tolerance = o.moveTolerancePx || MOVE_TOLERANCE_PX;
    const maxDuration = o.maxDurationMs || MAX_DURATION_MS;
    const now = o.now || (() => Date.now());

    let armed = false;
    let startAt = 0;
    let origin = null; // Map: touch id → 落下座標

    function reset() { armed = false; origin = null; }

    return {
      touchStart(touches) {
        if (touches.length === FINGERS) {
          armed = true;
          startAt = now();
          origin = new Map(touches.map((t) => [t.id, { x: t.x, y: t.y }]));
        } else if (touches.length > FINGERS) {
          reset(); // 第 4 指 = 不是 3 指輕點
        }
        // 1-2 指不動作：3 指常分批落下，等湊滿 3 指的那次 touchstart
      },
      touchMove(touches) {
        if (!armed) return;
        for (const t of touches) {
          const from = origin.get(t.id);
          if (!from) continue;
          if (Math.hypot(t.x - from.x, t.y - from.y) > tolerance) {
            reset();
            return;
          }
        }
      },
      // remainingCount = touchend 後仍在螢幕上的手指數；回傳 true = 觸發
      touchEnd(remainingCount) {
        if (!armed || remainingCount > 0) return false;
        const hit = (now() - startAt) <= maxDuration;
        reset();
        return hit;
      },
      cancel() { reset(); },
      _isArmed() { return armed; } // spec 觀測用
    };
  }

  // DOM 銜接。支援 3 點以上觸控的環境才註冊（桌面滑鼠環境零成本）。
  // capture + passive：頁面 stopPropagation 前就看得到事件、不阻塞捲動。
  function install(doc, nav, onTrigger) {
    if (!doc || !nav || (nav.maxTouchPoints || 0) < FINGERS) return false;
    const rec = createRecognizer();
    const toPlain = (touchList) => Array.from(touchList, (t) => ({
      id: t.identifier, x: t.clientX, y: t.clientY
    }));
    const opts = { capture: true, passive: true };
    doc.addEventListener('touchstart', (e) => rec.touchStart(toPlain(e.touches)), opts);
    doc.addEventListener('touchmove', (e) => rec.touchMove(toPlain(e.touches)), opts);
    doc.addEventListener('touchend', (e) => {
      if (rec.touchEnd(e.touches.length)) onTrigger();
    }, opts);
    doc.addEventListener('touchcancel', () => rec.cancel(), opts);
    return true;
  }

  const api = { createRecognizer, install, FINGERS, MOVE_TOLERANCE_PX, MAX_DURATION_MS };
  if (typeof window !== 'undefined') window.__JReadTouchGesture = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // content script 環境：立即安裝（namespace.js 先載入，NS.safeSendMessage /
  // NS.MSG 已就緒；spec 的 require 走 Node，無 window / chrome，不進這段）
  if (typeof window !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime) {
    const NS = window.__JRead = window.__JRead || {};
    api.install(document, navigator, () => {
      // v0.7.228：直接本地 dispatch、不再 round-trip SW。iOS Safari 的 MV3 SW
      // 被系統回收後不再喚醒（Apple Forums thread 758346）——舊版 CUSTOM_COMMAND
      // → SW → TOGGLE_READER_MODE 的來回在 SW 死亡後石沉大海，3 指輕點（iOS
      // 觸控環境的主 toggle 通道）隨時間失效、只能強制關閉 Safari 自救。
      // dispatchLocalCommand 由 main.js 提供（載入順序在本檔之後，觸發當下才
      // 查），含 cross-mode 重導；缺席時（SPA 注入競態）fallback 走原 SW 路徑。
      if (typeof NS.dispatchLocalCommand === 'function') {
        NS.dispatchLocalCommand('toggle-reader-mode');
        return;
      }
      NS.safeSendMessage({
        type: NS.MSG.CUSTOM_COMMAND,
        payload: { command: 'toggle-reader-mode' }
      });
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
