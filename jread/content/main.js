// JRead — Content Script 進入點（骨架）
// 負責：監聽 popup 訊息、串接 detector → cleaner → styler、SPA 導航偵測。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  async function getSettings() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: NS.MSG.GET_SETTINGS }, resolve);
    });
  }

  async function enterReaderMode() {
    const result = NS.detector && NS.detector.detect();
    if (!result) {
      // 降級：不硬套排版，回報失敗由 popup 顯示
      chrome.runtime.sendMessage({
        type: NS.MSG.REPORT_DETECTION_RESULT,
        payload: { ok: false, reason: 'NO_ARTICLE_FOUND' }
      });
      return false;
    }

    const settings = await getSettings();
    NS.state.articleEl = result.el;
    NS.state.confidence = result.confidence;
    NS.state.hiddenEls = NS.cleaner.clean(result.el);
    NS.state.originalStyles = NS.styler.apply(result.el, settings);
    NS.state.active = true;

    chrome.runtime.sendMessage({
      type: NS.MSG.REPORT_DETECTION_RESULT,
      payload: { ok: true, confidence: result.confidence, strategy: result.strategy }
    });
    return true;
  }

  function exitReaderMode() {
    if (!NS.state.active) return;
    NS.styler.restore(NS.state.articleEl, NS.state.originalStyles);
    NS.cleaner.restore(NS.state.hiddenEls);
    NS.state.active = false;
    NS.state.articleEl = null;
    NS.state.hiddenEls = [];
    NS.state.originalStyles = null;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== NS.MSG.TOGGLE_READER_MODE) return;
    (async () => {
      if (NS.state.active) {
        exitReaderMode();
        sendResponse({ active: false });
      } else {
        const ok = await enterReaderMode();
        sendResponse({ active: ok });
      }
    })();
    return true; // async
  });

  // TODO: SPA 導航偵測（MutationObserver on <title> / history API hook）
})();
