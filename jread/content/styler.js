// JRead — 乾淨排版（骨架）
// 套用使用者偏好設定（theme / fontSize / contentWidth / fontFamily / lineHeight）到主文容器。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  const styler = {
    /**
     * 套用閱讀模式排版到主文容器。
     * @param {Element} articleEl 主文容器
     * @param {object} settings 使用者偏好
     * @returns {string|null} 原始 inline style（還原用）
     */
    apply(articleEl, settings) {
      // TODO: 套用 theme / fontSize / contentWidth / lineHeight
      return null;
    },

    /**
     * 還原主文容器的原始排版。
     */
    restore(articleEl, originalStyles) {
      // TODO
    }
  };

  NS.styler = styler;
})();
