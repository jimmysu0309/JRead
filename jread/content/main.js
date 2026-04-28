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
    // v0.7.87：cleaner 跑完後才 promote 主標——cleaner 已 hide hidden h1-h4
    // 後，articleEl 內若無 visible heading，找等同 og:title 的 text element
    // 加 attribute + inline 大字 style（newtalk.tw 主標寫在 p.name 等非 h1-h4
    // tag 的場景）。需要 cleaner 先跑，guard 才能正確識別「visible heading」。
    if (NS.detector && typeof NS.detector.markPromotedTitleIfMissing === 'function') {
      NS.detector.markPromotedTitleIfMissing(result.el);
    }
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
    // v0.7.86：移除 detector shadow-DOM fallback 建立的 light DOM 替身。
    // 替身是 deepClone 出來的、原 shadow content 不動，移除替身後原站視覺
    // 完全還原。多個替身（理論上不該發生，但保險）一起清。
    const replicas = document.querySelectorAll('[data-jread-shadow-replica="1"]');
    replicas.forEach(r => r.remove());
    // v0.7.88：移除 detector inject 的 H1（data-jread-injected-title）
    // + restore 原 promoted-title-source 元素的 display（detector hide 它
    // 避免標題重複）+ 清原元素的 attribute。
    document.querySelectorAll('[data-jread-injected-title="1"]').forEach(el => el.remove());
    document.querySelectorAll('[data-jread-promoted-title-source="1"]').forEach(el => {
      el.removeAttribute('data-jread-promoted-title-source');
      if (el.style && typeof el.style.removeProperty === 'function') {
        el.style.removeProperty('display');
      }
    });
    document.querySelectorAll('[data-jread-promoted-title="1"]').forEach(el => {
      el.removeAttribute('data-jread-promoted-title');
    });
    NS.state.active = false;
    NS.state.articleEl = null;
    NS.state.hiddenEls = [];
    NS.state.originalStyles = null;
    chrome.runtime.sendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: false } });
  }

  // 抽 reader card 的 outerHTML 給 popup 送 Readwise（v0.7.33）。
  // 取 [data-jread-active] 容器後 clone 一份，把 cleaner 標記為 hidden 的節點
  // 從 clone 裡刪掉（直接送 outerHTML 會帶進雜訊節點——cleaner 只 inline display:none、
  // Readwise parser 不認 jread 的 stylesheet rule 會把那些節點重新渲染出來）；
  // 同時剝掉 jread 內部用的 data-jread-* attribute 和 jread 注入的 style 元素。
  // 抓 document.title 的分隔前首段當 title——多數站把站名接在「| Site Name」之後，
  // 切掉避免 Readwise 顯示「文章標題 | 中央社 CNA」這種尾巴。
  function buildCleanHtml(rootEl) {
    const clone = rootEl.cloneNode(true);
    // 1. 移除被 cleaner 標記隱藏的節點
    const hidden = clone.querySelectorAll('[data-jread-hidden="1"]');
    hidden.forEach(n => n.remove());
    // 2. 移除 jread 注入的 style 元素（避免汙染 Readwise 端）
    const injected = clone.querySelectorAll('style#__jread-style, style[data-jread]');
    injected.forEach(n => n.remove());
    // 3. 剝掉所有 data-jread-* attribute
    function stripDataAttrs(node) {
      if (node.attributes) {
        const toRemove = [];
        for (const attr of node.attributes) {
          if (attr.name.startsWith('data-jread')) toRemove.push(attr.name);
        }
        toRemove.forEach(name => node.removeAttribute(name));
      }
      for (const child of node.children) stripDataAttrs(child);
    }
    stripDataAttrs(clone);
    return clone.outerHTML;
  }

  function extractReaderPayload() {
    if (!NS.state.active || !NS.state.articleEl) {
      return { ok: false, reason: 'NOT_ACTIVE' };
    }
    const html = buildCleanHtml(NS.state.articleEl);
    const rawTitle = (document.title || '').trim();
    const title = rawTitle.split(/\s+[|\-—–·]\s+/)[0].trim() || rawTitle;
    return {
      ok: true,
      payload: {
        url: location.href,
        html,
        title
      }
    };
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

    if (msg.type === NS.MSG.GET_READER_STATE) {
      sendResponse({ active: !!NS.state.active });
      return; // sync
    }

    if (msg.type === NS.MSG.EXTRACT_READER_HTML) {
      sendResponse(extractReaderPayload());
      return; // sync
    }

    // v0.7.89：SW（快速鍵觸發送 Readwise）→ content：顯示結果 toast
    if (msg.type === NS.MSG.SHOW_TOAST) {
      const p = msg.payload || {};
      showToast(p.message || '', p.kind || 'info');
      sendResponse({ ok: true });
      return; // sync
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
