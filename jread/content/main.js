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

  // v0.7.101：ESC 鍵退出閱讀模式。reader mode 啟動期間 install window keydown
  // capture-phase listener（比原站 bubble listener 早收到 ESC），按下無修飾鍵
  // 的 ESC → exitReaderMode。例外：input / textarea / select / contenteditable
  // focus 時放行——使用者在主文 input 留言或編輯時 ESC 通常用於取消輸入 /
  // 關閉自己 focus 的下拉選單，不該被搶走當退出觸發。退出時必 remove listener
  // 避免 reader mode 關閉後 ESC 仍被攔。
  function onEscKey(e) {
    if (e.key !== 'Escape' && e.code !== 'Escape') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const ae = document.activeElement;
    if (ae) {
      const tag = ae.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (ae.isContentEditable) return;
      const ce = ae.getAttribute && ae.getAttribute('contenteditable');
      if (ce === 'true' || ce === '') return;
    }
    e.preventDefault();
    e.stopPropagation();
    exitReaderMode();
  }

  // v0.7.131：reader mode 啟動時攔截原站快速鍵（settings.blockPageShortcuts=true）。
  // 動機：Jimmy 2026-05-18 — 在 Gmail / YouTube 等 keyboard-shortcut-heavy 站點
  // 開閱讀模式時，誤按 j / k / e / # 等鍵會觸發原站 archive / next / delete 等
  // 破壞性操作。
  //
  // 攔截方式：window keydown/keypress/keyup capture-phase listener、命中即
  // stopImmediatePropagation()——阻止頁面 JS 的後續 listener 收到事件。
  // **不** preventDefault：保留瀏覽器原生 default action（space 滾頁 / tab 跳焦
  // 等），只擋 page JS 監聽。
  //
  // 放行條件：
  //   - IME composition（e.isComposing / keyCode 229）：中文輸入第一階段不擋
  //   - INPUT / TEXTAREA / SELECT / contenteditable focus：使用者打字 / 編輯
  //   - ESC 鍵：讓 onEscKey 處理（雖然 onEscKey 註冊在前先跑，安全冗餘）
  //
  // 與 onEscKey 共存：兩者都 window capture phase。enterReaderMode 內**先**
  // addEventListener(onEscKey) 再 addEventListener(keyguardHandler)——capture
  // phase 同階段 listener 按註冊順序執行，onEscKey 先收到 ESC、處理完已 exit。
  function keyguardHandler(e) {
    // IME 中文輸入第一階段（composition 進行中）不擋。e.isComposing 是標準；
    // 老瀏覽器用 keyCode 229 sentinel 兜底。
    if (e.isComposing || e.keyCode === 229) return;
    // 真正能輸入的 element focus 時不擋（搜尋框、留言、編輯器等）
    const t = e.target;
    if (t) {
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (t.isContentEditable) return;
      const ce = t.getAttribute && t.getAttribute('contenteditable');
      if (ce === 'true' || ce === '') return;
    }
    // ESC 放行給 onEscKey 處理
    if (e.key === 'Escape' || e.code === 'Escape') return;
    // 攔截：阻止 page JS listener 收到（chrome 原生 shortcut 不受影響、由
    // browser 自己處理；瀏覽器原生 default action 也保留）
    e.stopImmediatePropagation();
  }

  let keyguardInstalled = false;
  function installKeyguard() {
    if (keyguardInstalled) return;
    window.addEventListener('keydown',  keyguardHandler, true);
    window.addEventListener('keypress', keyguardHandler, true);
    window.addEventListener('keyup',    keyguardHandler, true);
    keyguardInstalled = true;
  }
  function uninstallKeyguard() {
    if (!keyguardInstalled) return;
    window.removeEventListener('keydown',  keyguardHandler, true);
    window.removeEventListener('keypress', keyguardHandler, true);
    window.removeEventListener('keyup',    keyguardHandler, true);
    keyguardInstalled = false;
  }

  // v0.7.133：YouTube watch page 走 cinema mode 分支（不跑 cleaner/styler，改
  // 注入 player-fixed-center 的 CSS）。ESC listener 仍裝（讓使用者退出），**不**
  // install keyguard——YouTube 的 j/k/l/space/f/m 是 player 控制必備，攔下去會
  // 打殘觀影體驗（reader mode 才需要擋 Gmail j archive 那類）。獨立成 helper
  // 是為了 enterReaderMode body 不被撐大、keyguard.spec 等 forcing function 的
  // slice 假設仍能命中 settings.blockPageShortcuts 那段。
  function enterCinemaMode() {
    if (!NS.cinema) return false;
    const ok = NS.cinema.enter();
    if (!ok) return false;
    NS.state.active = true;
    NS.state.cinemaActive = true;
    NS.state.articleEl = null;
    NS.state.confidence = 1;
    window.removeEventListener('keydown', onEscKey, true);
    window.addEventListener('keydown', onEscKey, true);
    chrome.runtime.sendMessage({
      type: NS.MSG.REPORT_DETECTION_RESULT,
      payload: { ok: true, confidence: 1, strategy: 'youtube-cinema' }
    });
    chrome.runtime.sendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: true } });
    return true;
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
    if (result.isYouTubeCinema) {
      return enterCinemaMode();
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

    // v0.7.101：install ESC listener（capture phase 比原站 bubble listener 早收到）
    window.removeEventListener('keydown', onEscKey, true);
    window.addEventListener('keydown', onEscKey, true);

    // v0.7.131：install keyguard（攔截原站快速鍵），依 settings.blockPageShortcuts。
    // 註冊順序在 onEscKey 之後——同階段 listener 按註冊順序執行，ESC 先給 onEscKey 處理。
    if (settings.blockPageShortcuts !== false) {
      installKeyguard();
    } else {
      uninstallKeyguard();
    }

    chrome.runtime.sendMessage({
      type: NS.MSG.REPORT_DETECTION_RESULT,
      payload: { ok: true, confidence: result.confidence, strategy: result.strategy }
    });
    chrome.runtime.sendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: true } });
    return true;
  }

  function exitReaderMode() {
    if (!NS.state.active) return;
    // v0.7.101：移除 ESC keydown listener（避免 reader mode 關閉後 ESC 仍被攔）
    window.removeEventListener('keydown', onEscKey, true);
    // v0.7.131：一律拆掉 keyguard（即使先前 settings 是 false 也保險呼叫）
    uninstallKeyguard();
    // v0.7.133：cinema mode 走獨立 restore 路徑（沒有 cleaner/styler 副作用要還原）
    if (NS.state.cinemaActive) {
      if (NS.cinema) NS.cinema.exit();
      NS.state.cinemaActive = false;
      NS.state.active = false;
      NS.state.articleEl = null;
      NS.state.confidence = 0;
      chrome.runtime.sendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: false } });
      return;
    }
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
    // v0.7.133：cinema mode 沒主文 outerHTML 可送 Readwise，明確回 NOT_APPLICABLE
    // 而非 NOT_ACTIVE（後者讓 popup 顯示「閱讀模式未啟動」會讓使用者困惑——
    // cinema 是有啟動的）。popup 端 cinema mode 已 hide readwise 按鈕，這是
    // 防呆 fallback。
    if (NS.state.cinemaActive) {
      return { ok: false, reason: 'NOT_APPLICABLE_IN_CINEMA' };
    }
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
      // v0.7.133：siteMode 讓 popup 知道當前頁面型態（'youtube-cinema' /
      // 'article' / null=不適用），用來切換按鈕文字「啟動影院模式」vs
      // 「切換閱讀模式」+ 控制 Readwise 按鈕可見性。
      // 'article' = detector 偵測得到主文；null = 既非 cinema 也偵測不到主文
      // （chrome:// 類禁注入頁面則 sendMessage 直接 reject、popup 走另一路徑）。
      let siteMode = null;
      if (NS.cinema && NS.cinema.isYouTubeWatch && NS.cinema.isYouTubeWatch()) {
        siteMode = 'youtube-cinema';
      } else if (NS.detector && typeof NS.detector.detect === 'function') {
        try {
          const probe = NS.detector.detect();
          if (probe && probe.el) siteMode = 'article';
        } catch (_) { /* 偵測失敗 = null */ }
      }
      sendResponse({
        active: !!NS.state.active,
        cinemaActive: !!NS.state.cinemaActive,
        siteMode
      });
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
      if (!NS.state.active) return;
      // v0.7.131：blockPageShortcuts 即時切換——options 改 toggle 後立刻生效，
      // 不需 toggle reader mode。獨立處理，不走 styler restore/apply 路徑。
      if ('blockPageShortcuts' in changes) {
        const next = changes.blockPageShortcuts.newValue;
        if (next === false) uninstallKeyguard();
        else installKeyguard();
      }
      if (!NS.state.articleEl || !NS.styler) return;
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

  // Page-world debug bridge：允許 main-world JS（chrome-in-chrome MCP /
  // devtools console）透過 dispatchEvent 觸發 reader mode toggle、reload
  // extension、查詢狀態。content script 在 isolated world、page main world
  // 無法直接呼叫；DOM event 跨 world 廣播，是合法的單向 page→isolated 通道。
  // 用法（page world）：
  //   window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'toggle' } }));
  //   window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'enter' } }));
  //   window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'exit' } }));
  //   window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'reload' } }));
  // reload 走 sendMessage('JREAD_RELOAD') → SW handler 呼叫 chrome.runtime.reload()。
  // 不可從 content script 直接呼 chrome.runtime.reload —— 該 API 只 SW / popup /
  // options 可用，content script context 沒此 function，直呼會 TypeError
  // (v0.7.126 修法，v0.7.124-125 曾誤設計成 content script 直呼)。bridge bootstrap
  // 限制：jread 任何 bridge 邏輯改動後仍需先 manual reload 一次讓新 code 生效，
  // 之後 dispatch 'reload' 走 SW 中繼永久零介入。
  window.addEventListener('__jread_debug', (e) => {
    const type = (e && e.detail && e.detail.type) || 'toggle';
    if (type === 'toggle') {
      if (NS.state.active) exitReaderMode();
      else enterReaderMode();
    } else if (type === 'enter') {
      if (!NS.state.active) enterReaderMode();
    } else if (type === 'exit') {
      if (NS.state.active) exitReaderMode();
    } else if (type === 'reload') {
      // v0.7.126：chrome.runtime.reload() 在 content script context 不存在
      // （Uncaught TypeError: chrome.runtime.reload is not a function）——
      // 該 API 僅 SW / popup / options page 可呼叫。改透過 sendMessage 給 SW
      // 中繼觸發 reload。
      if (NS.state.active) exitReaderMode();
      chrome.runtime.sendMessage({ type: 'JREAD_RELOAD' });
    }
  });

  // TODO: SPA 導航偵測（MutationObserver on <title> / history API hook）
})();
