// JRead — Content Script 進入點
// 負責：監聽 popup / background 訊息、串接 detector → cleaner → styler、
// 僅在主文偵測失敗時顯示 toast（v0.7.27 Jimmy 要求移除「已進入/離開
// 閱讀模式」等狀態通知，圖示 + 卡片出現本身就是回饋）、SPA 導航偵測（TODO）。
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
    // promotedFrom + promotedTitleHead 傳給 cleaner 做 narrowPromotedSiblings
    // （v0.7.12 ebc 深層 single-child wrapper 修法 + v0.7.21 Stratechery h2
    // post-title 白名單保護，讓 WordPress block theme h2 不被 narrow 誤殺）
    NS.state.hiddenEls = NS.cleaner ? NS.cleaner.clean(result.el, {
      promotedFrom: result.promotedFrom,
      promotedTitleHead: result.promotedTitleHead
    }) : [];
    NS.state.originalStyles = NS.styler ? NS.styler.apply(result.el, settings) : null;
    NS.state.active = true;

    chrome.runtime.sendMessage({
      type: NS.MSG.REPORT_DETECTION_RESULT,
      payload: { ok: true, confidence: result.confidence, strategy: result.strategy }
    });
    chrome.runtime.sendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: true } });
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
    chrome.runtime.sendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: false } });
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

  });

  // 設定變更即時套用：popup 的加減/切換動作會寫入 chrome.storage.sync，
  // 這裡監聽變更，若閱讀模式正在開啟就 restore + 重新 apply styler。
  // 走 storage.onChanged 而非訊息，好處是即使同時有多個分頁開啟閱讀模式，
  // 每個 tab 的 content script 都會收到事件、各自更新。
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (!NS.state.active || !NS.state.articleEl || !NS.styler) return;
      const relevantKeys = ['theme', 'fontSize', 'contentWidth', 'fontFamily', 'lineHeight'];
      const hasRelevant = relevantKeys.some(k => k in changes);
      if (!hasRelevant) return;
      (async () => {
        NS.styler.restore(NS.state.articleEl, NS.state.originalStyles);
        const settings = await getSettings();
        NS.state.originalStyles = NS.styler.apply(NS.state.articleEl, settings);
      })();
    });
  }

  // TODO: SPA 導航偵測（MutationObserver on <title> / history API hook）
})();
