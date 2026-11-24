// content/paged-io-guard.js — 翻頁模式中，不讓站方以為主文「離開畫面」（v2.5.53）
//
// 【症狀】meta.discourse（Jimmy 2026-11-24 裁定修）：翻頁模式第 2 頁起整片空白、頁碼照常。
// 【根因】（真站 probe 量測）站方用 IntersectionObserver（IO）做 cloaking：貼文離開畫面就把
//   內容拿掉、換成同高的空殼。翻頁模式的閱讀卡片是 multicol + scrollLeft 翻頁，貼文被切成
//   15 欄；但 Chromium 的 IO 對被分欄切開的元素回報的是「沒分欄時的盒子」——左緣固定在
//   第 1 欄。翻到第 2 頁後 IO 量到 left=-330、被卡片 overflow 裁掉 → isIntersecting:false
//   → 站方收掉貼文（getBoundingClientRect 回的是 15 欄聯集、其實在畫面內）。
// 【修法】（通則，不看站點）在頁面 main world 包一層 IO：翻頁模式進行中（<html> 帶
//   data-jread-paged，paged-mode install / uninstall 寫）時，丟掉「target 在閱讀卡片
//   （[data-jread-active]）裡、而且 isIntersecting:false」的 entry；其餘照常交給站方，
//   全被丟掉就不呼叫 callback。任何用 IO 把畫面外內容拿掉的站（虛擬捲動、cloaking、卸載）
//   在翻頁模式都會中同一型，這裡一次涵蓋。不在翻頁模式時完全等於原生 IO。
// 【代價】翻頁期間站方收不到卡片內元素的「離開畫面」：看得到才播的影片不會自動暫停、
//   曝光統計失準、按需卸載的內容不卸載。
// 【沒涵蓋】IO 對分欄內容一律量第 1 欄，所以站方用 IO 做的 lazy 載入，放在第 2 欄以後的
//   元素可能等不到「進入畫面」——這裡只丟 entry、不補回報（paged-mode 另有 forceEagerImages
//   處理原生 lazy 圖）。
// 【掛在哪】manifest 的 world:MAIN、document_start entry（與 orion-detect.js 同一條）：
//   必須比站方 script 先跑，站方建立 IO 時拿到的才是包過的版本。content script 的隔離
//   世界改不到頁面的 window.IntersectionObserver。
(function () {
  'use strict';
  const Native = window.IntersectionObserver;
  if (typeof Native !== 'function' || Native.__jreadPagedGuard) return;

  const pagedActive = () => {
    const root = document.documentElement;
    return !!(root && root.hasAttribute('data-jread-paged'));
  };
  const inCard = (t) => !!(t && t.closest && t.closest('[data-jread-active]'));
  const keep = (e) => e.isIntersecting || !inCard(e.target);

  const IntersectionObserver = class extends Native {
    constructor(callback, options) {
      // callback 不是函式時讓原生建構子照常丟 TypeError
      if (typeof callback !== 'function') { super(callback, options); return; }
      super(function (entries, observer) {
        if (!pagedActive()) return callback.call(this, entries, observer);
        const kept = entries.filter(keep);
        if (kept.length) return callback.call(this, kept, observer);
      }, options);
    }
    takeRecords() {
      const recs = super.takeRecords();
      return pagedActive() ? recs.filter(keep) : recs;
    }
  };
  Object.defineProperty(IntersectionObserver, '__jreadPagedGuard', { value: true });
  window.IntersectionObserver = IntersectionObserver;
})();
