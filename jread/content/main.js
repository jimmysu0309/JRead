// JRead — Content Script 進入點
// 負責：監聽 popup / background 訊息、串接 detector → cleaner → styler、
// 顯示 toast、SPA 導航偵測（TODO）。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  function showToast(message, kind) {
    if (NS.toast && typeof NS.toast.show === 'function') {
      NS.toast.show(message, { kind });
    }
  }

  async function getSettings() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: NS.MSG.GET_SETTINGS }, resolve);
    });
  }

  async function enterReaderMode() {
    const result = NS.detector && NS.detector.detect();
    if (!result) {
      showToast('此頁無法偵測主文', 'error');
      chrome.runtime.sendMessage({
        type: NS.MSG.REPORT_DETECTION_RESULT,
        payload: { ok: false, reason: 'NO_ARTICLE_FOUND' }
      });
      return false;
    }

    const settings = await getSettings();
    NS.state.articleEl = result.el;
    NS.state.confidence = result.confidence;
    NS.state.hiddenEls = NS.cleaner ? NS.cleaner.clean(result.el) : [];
    NS.state.originalStyles = NS.styler ? NS.styler.apply(result.el, settings) : null;
    NS.state.active = true;

    chrome.runtime.sendMessage({
      type: NS.MSG.REPORT_DETECTION_RESULT,
      payload: { ok: true, confidence: result.confidence, strategy: result.strategy }
    });
    showToast('已進入閱讀模式', 'success');
    return true;
  }

  function exitReaderMode() {
    if (!NS.state.active) return;
    if (NS.styler) NS.styler.restore(NS.state.articleEl, NS.state.originalStyles);
    if (NS.cleaner) NS.cleaner.restore(NS.state.hiddenEls);
    NS.state.active = false;
    NS.state.articleEl = null;
    NS.state.hiddenEls = [];
    NS.state.originalStyles = null;
    showToast('已離開閱讀模式', 'info');
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === NS.MSG.TOGGLE_READER_MODE) {
      (async () => {
        if (NS.state.active) {
          exitReaderMode();
          sendResponse({ active: false });
        } else {
          const ok = await enterReaderMode();
          sendResponse({ active: ok });
        }
      })();
      return true;
    }

    if (msg.type === NS.MSG.SHOW_TOAST) {
      const p = msg.payload || {};
      showToast(p.message || '', p.kind || 'info');
      sendResponse({ ok: true });
      return;
    }
  });

  // TODO: SPA 導航偵測（MutationObserver on <title> / history API hook）
})();
