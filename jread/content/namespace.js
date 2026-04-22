// JRead — Content Script 命名空間初始化
// Manifest V3 的 content script 不能用 ES module import，
// 因此子模組透過 window.__JRead 共用狀態。此檔必須最先載入。
(function () {
  'use strict';

  if (window.__JRead) return; // 避免重複注入（SPA 導航、重新注入時保險）

  window.__JRead = {
    version: chrome.runtime.getManifest().version,

    // 閱讀模式狀態
    state: {
      active: false,          // 目前是否處於閱讀模式
      articleEl: null,        // 偵測到的主文容器
      confidence: 0,          // 偵測信心分數（0–1）
      hiddenEls: [],          // 被隱藏的雜訊元素快照，還原用
      originalStyles: null    // 主文容器原始 inline style，還原用
    },

    // 子模組佔位，後續由各 script 自行掛載
    detector: null,
    cleaner: null,
    styler: null,
    toast: null,

    // 訊息常數（與 popup / background 對齊）
    MSG: {
      TOGGLE_READER_MODE: 'TOGGLE_READER_MODE',
      REPORT_DETECTION_RESULT: 'REPORT_DETECTION_RESULT',
      GET_SETTINGS: 'GET_SETTINGS',
      UPDATE_SETTINGS: 'UPDATE_SETTINGS',
      SHOW_TOAST: 'SHOW_TOAST',
      SET_ACTIVE_ICON: 'SET_ACTIVE_ICON'
    }
  };
})();
