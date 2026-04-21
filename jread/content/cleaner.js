// JRead — 雜訊隱藏（骨架）
// 所有規則必須是 DOM / CSS 結構特徵，不可綁定站點 hostname 或特定 class。
// 站點特判一律放 site-overrides/，不得混入此檔。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  const cleaner = {
    /**
     * 隱藏主文外與主文內的雜訊，記錄還原用的元素清單。
     * @param {Element} articleEl 主文容器
     * @returns {Element[]} 被隱藏的元素清單
     */
    clean(articleEl) {
      // TODO: 實作雜訊隱藏
      //   - 主文外：<header>/<nav>/<footer>/<aside>、fixed/sticky 元素
      //   - 主文內：paywall / subscribe / newsletter / promo / cta / related 等 keyword
      return [];
    },

    /**
     * 還原被隱藏的元素。
     * @param {Element[]} hiddenEls
     */
    restore(hiddenEls) {
      // TODO
    }
  };

  NS.cleaner = cleaner;
})();
