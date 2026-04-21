// JRead — 主文偵測（骨架）
// 偵測策略優先序（SPEC.md）：
//   1. <article> / <main> 內含 <article>
//   2. Schema.org itemtype="Article"
//   3. OpenGraph og:type="article" + 啟發式
//   4. 內容密度啟發式（Readability.js 風格）
//   5. 分數低於閾值 → no-op，不硬套
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  const detector = {
    /**
     * 偵測主文，回傳 { el, confidence, strategy }。
     * 未達信心分數門檻時回傳 null。
     */
    detect() {
      // TODO: 實作偵測策略
      return null;
    }
  };

  NS.detector = detector;
})();
