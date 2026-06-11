// JRead — Content Script 進入點
// 負責：監聽 popup / background 訊息、串接 detector → cleaner → styler、
// 僅在主文偵測失敗時顯示 toast（v0.7.27 Jimmy 要求移除「已進入/離開
// 閱讀模式」等狀態通知，圖示 + 卡片出現本身就是回饋）、SPA 導航偵測（v0.8.21）。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  function showToast(message, kind) {
    if (NS.toast && typeof NS.toast.show === 'function') {
      NS.toast.show(message, { kind });
    }
  }

  // v0.7.143：safeSendMessage 已提到 namespace.js（NS.safeSendMessage），
  // main.js / youtube-borderless.js / 其他 content script 共用同一個 entry。
  // 此處 const alias 保留檔內 call site 簡潔（safeSendMessage(...) 不必每處寫
  // NS.safeSendMessage(...)）。
  const safeSendMessage = NS.safeSendMessage;

  // v0.7.235：直讀 chrome.storage.sync（defaults 來自單一資料源
  // content/settings-defaults.js），不再 round-trip background 的 GET_SETTINGS。
  // 根因：iOS Safari 的 background event page 訊息會無聲掉包（SW 回收後不再
  // 喚醒 thread 758346；iOS 18.4+ sendMessage 掉包 regression thread 787958），
  // 掉包時舊版 getSettings 回 undefined → 下游所有設定 fallback 預設值——
  // theme / fontSize 靜默退化難察覺，pagedMode 永遠 false（「翻頁模式 iOS
  // 沒功能」根因，simulator instrument 實證 round-trip undefined / 直讀正常）。
  // storage API 在 content script 直接可用、不依賴 background 存活，與
  // v0.7.228 觸發路徑去 SW 化同一條設計原則。
  // fallback：chrome.storage 失效（extension reload 後 context invalidated
  // 會 throw）時退回 GET_SETTINGS round-trip——Chrome 的 SW 正常時仍可救；
  // 兩邊都死則 resolve(null)，與舊行為的降級結果一致。
  async function getSettings() {
    const defaults = window.__JReadSettingsDefaults || {};
    return new Promise(resolve => {
      const fallbackViaBackground = () => {
        safeSendMessage({ type: NS.MSG.GET_SETTINGS }, resolve);
      };
      try {
        chrome.storage.sync.get(defaults, (values) => {
          if (chrome.runtime.lastError || !values) {
            fallbackViaBackground();
            return;
          }
          resolve(values);
        });
      } catch (_) {
        fallbackViaBackground();
      }
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

  // v0.7.216：Space 段落焦點卷動（仿 Readwise Reader）——實作在
  // content/space-scroll.js 的 NS.spaceScroll 模組（焦點段落指示條 + 門檻
  // 卷動 + rAF 動畫）。此 wrapper 負責 main.js 自有的 keyguard 順序
  // invariant：spaceScrollHandler 必須先於 keyguardHandler 註冊（keyguard
  // 對非 ESC 鍵 stopImmediatePropagation，晚註冊的同 phase listener 收不到
  // 事件）。各 enter 路徑在 installKeyguard 之前呼叫本 wrapper 天然滿足；
  // onChanged 把 ratio 從 0 動態改回正值時 sync 內新 install 的 listener 會
  // 排在 keyguard 後面——重掛 keyguard 把它推回隊尾。
  function syncSpaceScrollFromSettings(settings) {
    if (!NS.spaceScroll) return;
    // v0.7.227：翻頁模式啟動時停用 Space 段落卷動——文件已鎖垂直卷動，
    // Space 由 paged-mode.js 接手為「翻下一頁」。兩模組對同一個 Space 鍵
    // 是互斥事實，以 pagedMode installed 狀態作單一判定源。
    if (NS.pagedMode && NS.pagedMode.isInstalled()) {
      NS.spaceScroll.uninstall();
      return;
    }
    const wasInstalled = NS.spaceScroll.isInstalled();
    NS.spaceScroll.sync(settings, NS.state.articleEl);
    if (!wasInstalled && NS.spaceScroll.isInstalled() && keyguardInstalled) {
      uninstallKeyguard();
      installKeyguard();
    }
  }

  // v0.7.227：翻頁模式（paged-mode.js）settings 同步 wrapper。與
  // syncSpaceScrollFromSettings 同款 keyguard 順序 invariant：模組的
  // keydown listener（←/→/Space 翻頁）必須先於 keyguardHandler 收到事件
  // （keyguard 對非 ESC 鍵 stopImmediatePropagation）——onChanged 動態開啟
  // 時新 listener 排在 keyguard 後面，重掛 keyguard 推回隊尾。
  function syncPagedModeFromSettings(settings) {
    if (!NS.pagedMode) return;
    const wasInstalled = NS.pagedMode.isInstalled();
    NS.pagedMode.sync(settings, NS.state.articleEl);
    if (!wasInstalled && NS.pagedMode.isInstalled() && keyguardInstalled) {
      uninstallKeyguard();
      installKeyguard();
    }
  }

  // v0.7.133：YouTube watch page 走 cinema mode 分支（不跑 cleaner/styler，改
  // 注入 player-fixed-center 的 CSS）。ESC listener 仍裝（讓使用者退出），**不**
  // install keyguard——YouTube 的 j/k/l/space/f/m 是 player 控制必備，攔下去會
  // 打殘觀影體驗（reader mode 才需要擋 Gmail j archive 那類）。獨立成 helper
  // 是為了 enterReaderMode body 不被撐大、keyguard.spec 等 forcing function 的
  // slice 假設仍能命中 settings.blockPageShortcuts 那段。
  function enterCinemaMode() {
    if (!NS.cinema) return false;
    // v0.7.143：cinema / borderless 互斥——使用者在 borderless 模式按 cinema 快速鍵
    // 視為「切換到 cinema」，先退掉 borderless 避免兩條 CSS 軸對 #movie_player 打架
    // （cinema 設 fixed center、borderless 設 fullscreen 全屏）。同樣 borderless
    // 入口也會 mutex 退掉 cinema。SPEC.md 從 v0.7.134「可同時開」改為 v0.7.143
    // 「單一 active」單軸設計。
    if (NS.borderless && NS.borderless.isActive && NS.borderless.isActive()) {
      NS.borderless.toggle();
    }
    const ok = NS.cinema.enter();
    if (!ok) return false;
    NS.state.active = true;
    NS.state.cinemaActive = true;
    NS.state.articleEl = null;
    NS.state.confidence = 1;
    window.removeEventListener('keydown', onEscKey, true);
    window.addEventListener('keydown', onEscKey, true);
    safeSendMessage({
      type: NS.MSG.REPORT_DETECTION_RESULT,
      payload: { ok: true, confidence: 1, strategy: 'youtube-cinema' }
    });
    safeSendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: true } });
    return true;
  }

  // v0.7.135：X / Twitter status 頁走合成 reader 容器分支。detector 短路回
  // isXThread=true 時呼叫 NS.xThread.enter() 在 body 開頭注入合成 `<article
  // data-jread-x-reader>`，後續 cleaner / styler / Readwise / keyguard / ESC
  // 流程都對這個合成容器跑——所以這分支只是「在跑 cleaner/styler 之前先建容器」，
  // 退出時除了走 styler.restore / cleaner.restore 之外多 remove 合成容器。
  async function enterXThreadMode() {
    if (!NS.xThread) return false;
    const container = NS.xThread.enter();
    if (!container) {
      showToast('此頁無法偵測主推文', 'error');
      safeSendMessage({
        type: NS.MSG.REPORT_DETECTION_RESULT,
        payload: { ok: false, reason: 'NO_ARTICLE_FOUND' }
      });
      return false;
    }
    const settings = await getSettings();
    NS.state.articleEl = container;
    NS.state.confidence = 1;
    NS.state.hiddenEls = NS.cleaner ? NS.cleaner.clean(container) : [];
    if (NS.xThread && typeof NS.xThread.injectAuthorHeaders === 'function') {
      NS.xThread.injectAuthorHeaders();
    }
    // v0.7.233：styler 注入前捕捉卷動位置（pagedMode CSS 的 overflow hidden
    // 會把 scrollY clamp 成 0）——與 enterReaderModeImpl 同款
    if (NS.pagedMode) NS.pagedMode.captureScrollY();
    NS.state.originalStyles = NS.styler ? NS.styler.apply(container, settings) : null;
    NS.state.active = true;

    window.removeEventListener('keydown', onEscKey, true);
    window.addEventListener('keydown', onEscKey, true);
    // v0.7.233：翻頁模式同步——styler 依 settings.pagedMode 在所有路徑注入翻頁
    // CSS，模組（頁碼指示 / 翻頁手勢鍵盤 / spaceScroll 讓位判定源）必須跟著
    // 裝，否則合成容器路徑變成「視覺翻頁、模組沒裝」：段落指示條殘留（Jimmy
    // 2026-06-07 iOS 回報）、頁碼不顯示、超過一頁翻不動。順序與
    // enterReaderModeImpl 相同：pagedMode → spaceScroll → keyguard。
    syncPagedModeFromSettings(settings);
    // v0.7.216：Space 段落焦點卷動——須在 installKeyguard 之前註冊（見 wrapper 註解）
    syncSpaceScrollFromSettings(settings);
    // X 是 keyboard-shortcut-heavy 站（j/k 換推文、l 點讚、r reply 等），跟 reader
    // mode 純閱讀完全衝突——install keyguard 攔截。
    if (!settings || settings.blockPageShortcuts !== false) {
      installKeyguard();
    } else {
      uninstallKeyguard();
    }

    safeSendMessage({
      type: NS.MSG.REPORT_DETECTION_RESULT,
      payload: { ok: true, confidence: 1, strategy: 'x-thread' }
    });
    safeSendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: true } });
    return true;
  }

  // v0.7.157：Facebook permalink post 走合成 reader 容器分支。fb-post.js 找
  // 到主貼文 wrapper 後 clone 進 `<article data-jread-fb-reader>` 注入 body
  // 開頭，後續 cleaner / styler 流程沿用。FB 跟 X 同樣 keyboard-shortcut-heavy
  // （j/k 換貼文等），install keyguard 攔截。
  async function enterFbPostMode() {
    if (!NS.fbPost) return false;
    // v0.7.204 photo page：先點「查看更多」展開截斷文字，等 React re-render
    if (NS.fbPost.expandSeeMore && NS.fbPost.expandSeeMore()) {
      await new Promise(function (r) { setTimeout(r, 500); });
    }
    const container = NS.fbPost.enter();
    if (!container) {
      showToast('此頁無法偵測主貼文', 'error');
      safeSendMessage({
        type: NS.MSG.REPORT_DETECTION_RESULT,
        payload: { ok: false, reason: 'NO_ARTICLE_FOUND' }
      });
      return false;
    }
    const settings = await getSettings();
    NS.state.articleEl = container;
    NS.state.confidence = 1;
    // FB 合成容器跳過 cleaner.clean——fb-post.js pruneReaderClone 已做精準清理
    // （留言 / button / placeholder / reactions metadata），通用 cleaner 對 FB
    // 巢狀 emotion-hash DIV 結構過於激進、會把主貼文文字 wrapper 也誤殺
    // （probe 實證：cleaner 在 reader card 內把含「川普」1741 字 wrapper 標
    // data-jread-hidden=1）。
    NS.state.hiddenEls = [];
    // v0.7.233：styler 注入前捕捉卷動位置——與 enterReaderModeImpl 同款
    if (NS.pagedMode) NS.pagedMode.captureScrollY();
    NS.state.originalStyles = NS.styler ? NS.styler.apply(container, settings) : null;
    NS.state.active = true;

    window.removeEventListener('keydown', onEscKey, true);
    window.addEventListener('keydown', onEscKey, true);
    // v0.7.233：翻頁模式同步——理由見 enterXThreadMode 同位置註解
    syncPagedModeFromSettings(settings);
    // v0.7.216：Space 段落焦點卷動——須在 installKeyguard 之前註冊（見 wrapper 註解）
    syncSpaceScrollFromSettings(settings);
    if (!settings || settings.blockPageShortcuts !== false) {
      installKeyguard();
    } else {
      uninstallKeyguard();
    }

    safeSendMessage({
      type: NS.MSG.REPORT_DETECTION_RESULT,
      payload: { ok: true, confidence: 1, strategy: 'fb-post' }
    });
    safeSendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: true } });
    return true;
  }

  // v0.7.143：in-flight guard 防快速雙擊快速鍵造成的 race。
  // enterReaderMode 是 async（有 await getSettings），中間時間窗若第二次 toggle
  // 進來會看到 NS.state.active 還是 false、再跑一次 enterReaderMode——
  // NS.state.hiddenEls + originalStyles 被第二輪 snapshot 蓋掉，第一輪 hide 的
  // 元素永遠回不來。同樣 exit 也加 flag 防 enter→exit 中途再來一輪 enter。
  let enterInFlight = false;
  let exitInFlight = false;

  async function enterReaderMode(opts) {
    if (enterInFlight || exitInFlight) return false;
    enterInFlight = true;
    try {
      return await enterReaderModeImpl(opts);
    } finally {
      enterInFlight = false;
    }
  }

  async function enterReaderModeImpl(opts) {
    // v0.7.155：silent flag — auto-enable 網域命中後 caller 沒主動按鈕、偵測
    // 失敗彈「此頁無法偵測主文」反而干擾。手動 toggle / 快速鍵走 opts 預設 falsy
    // 路徑，行為不變。
    const silent = !!(opts && opts.silent);
    const result = NS.detector && NS.detector.detect();
    if (!result) {
      if (!silent) showToast('此頁無法偵測主文', 'error');
      safeSendMessage({
        type: NS.MSG.REPORT_DETECTION_RESULT,
        payload: { ok: false, reason: 'NO_ARTICLE_FOUND' }
      });
      return false;
    }
    if (result.isYouTubeCinema) {
      return enterCinemaMode();
    }
    if (result.isXThread) {
      return await enterXThreadMode();
    }
    if (result.isFbPost) {
      return await enterFbPostMode();
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
    // v0.7.227：styler 注入前捕捉文件卷動位置——pagedMode CSS 的 overflow
    // hidden 會把 scrollY clamp 成 0，退出翻頁模式時靠此值還原（模組內
    // installed guard 防重複覆寫）。
    if (NS.pagedMode) NS.pagedMode.captureScrollY();
    NS.state.originalStyles = NS.styler ? NS.styler.apply(result.el, settings) : null;
    NS.state.active = true;

    // v0.7.101：install ESC listener（capture phase 比原站 bubble listener 早收到）
    window.removeEventListener('keydown', onEscKey, true);
    window.addEventListener('keydown', onEscKey, true);

    // v0.7.227：翻頁模式——須在 syncSpaceScroll 之前（spaceScroll 依
    // pagedMode installed 狀態決定讓位）、在 installKeyguard 之前註冊
    syncPagedModeFromSettings(settings);

    // v0.7.216：Space 段落焦點卷動——須在 installKeyguard 之前註冊（見 wrapper 註解）
    syncSpaceScrollFromSettings(settings);

    // v0.7.131：install keyguard（攔截原站快速鍵），依 settings.blockPageShortcuts。
    // 註冊順序在 onEscKey 之後——同階段 listener 按註冊順序執行，ESC 先給 onEscKey 處理。
    if (!settings || settings.blockPageShortcuts !== false) {
      installKeyguard();
    } else {
      uninstallKeyguard();
    }

    safeSendMessage({
      type: NS.MSG.REPORT_DETECTION_RESULT,
      payload: { ok: true, confidence: result.confidence, strategy: result.strategy }
    });
    safeSendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: true } });
    return true;
  }

  function exitReaderMode() {
    if (!NS.state.active) return;
    if (exitInFlight) return;
    exitInFlight = true;
    try {
      exitReaderModeImpl();
    } finally {
      exitInFlight = false;
    }
  }

  function exitReaderModeImpl() {
    // v0.7.101：移除 ESC keydown listener（避免 reader mode 關閉後 ESC 仍被攔）
    window.removeEventListener('keydown', onEscKey, true);
    // v0.7.131：一律拆掉 keyguard（即使先前 settings 是 false 也保險呼叫）
    uninstallKeyguard();
    // v0.7.216：一律拆掉 Space 段落焦點卷動（listener + 指示條 + 進行中動畫）
    if (NS.spaceScroll) NS.spaceScroll.uninstall();
    // v0.7.227：一律拆掉翻頁模式（listener + 頁碼指示 + 還原文件卷動位置）。
    // 必須在 styler.restore 之前呼叫——uninstall 內的 scrollTo 還原排在
    // rAF，等本輪同步的 restore 移除 overflow hidden 後文件才可卷動。
    // resetPosition：退出 reader mode = 閱讀 session 結束，下次進入從第一頁起。
    if (NS.pagedMode) {
      NS.pagedMode.uninstall();
      NS.pagedMode.resetPosition();
    }
    // v0.7.133：cinema mode 走獨立 restore 路徑（沒有 cleaner/styler 副作用要還原）
    if (NS.state.cinemaActive) {
      if (NS.cinema) NS.cinema.exit();
      NS.state.cinemaActive = false;
      NS.state.active = false;
      NS.state.articleEl = null;
      NS.state.confidence = 0;
      safeSendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: false } });
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
    // v0.7.135：清掉 X / Twitter 合成 reader 容器（NS.xThread.enter() 注入的
    // [data-jread-x-reader]）。styler / cleaner 已 restore 過了，容器自身只是
    // 包裝體、直接 remove 不影響原 X DOM。
    if (NS.xThread && typeof NS.xThread.exit === 'function') {
      NS.xThread.exit();
    }
    // v0.7.157：清掉 Facebook permalink 合成 reader 容器
    if (NS.fbPost && typeof NS.fbPost.exit === 'function') {
      NS.fbPost.exit();
    }
    NS.state.active = false;
    NS.state.articleEl = null;
    NS.state.hiddenEls = [];
    NS.state.originalStyles = null;
    safeSendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: false } });
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
    // 2.5 FB permalink 段落 div → p。fb-post.js markParagraphDivs 把 FB 主貼文的
    // 「直接含文字的 leaf div」標 data-jread-fb-para="1" + 設 inline margin。本地
    // reader card 靠 inline margin（+ styler 注入的 [data-jread-fb-para] 規則）
    // 顯示段落間距，但送 Readwise Reader 後對方 sanitizer 會砍 inline style，
    // 段落全擠在一起。把 div 改寫成 <p> 讓 Readwise 用語意辨識段落結構。
    // 限定 fb-para tag：markParagraphDivs 已 guard「children 只有 text node 或
    // inline element（span / a / strong / em ...）」、不會抓到含 block child 的 div，
    // 因此轉 <p> 不會違反 HTML 規則（p 不可含 block-level child）。
    const fbParas = clone.querySelectorAll('[data-jread-fb-para="1"]');
    fbParas.forEach(div => {
      const p = document.createElement('p');
      for (const attr of Array.from(div.attributes)) {
        p.setAttribute(attr.name, attr.value);
      }
      while (div.firstChild) p.appendChild(div.firstChild);
      div.replaceWith(p);
    });
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

  // v0.7.166：抽 hero / cover image URL 送 Readwise Reader 的 image_url 欄位。
  // 策略（多層 fallback）：
  //   1. reader card 內第一張「visible 主圖」：natural >= 200×200（或無 naturalWidth
  //      時 fallback rect >= 200×120）、不在 [data-jread-hidden] 子孫內、URL 非
  //      data:/blob:。reader card 是 detector + cleaner 之後的主文範圍，第一張
  //      通過大小門檻的圖視為主圖（hero）。
  //   2. <meta property="og:image"> / og:image:url / og:image:secure_url /
  //      twitter:image / twitter:image:src 任一存在（site OG metadata）。做為
  //      reader card 內無圖時的 fallback——Wikipedia / 純文字 blog / Substack
  //      newsletter 等可能主圖只在 OG meta。
  // URL 必須 absolute http(s)——透過 new URL(src, base) 轉、不接受 data:/blob:
  // （Readwise 端不能 fetch 這類 URL 當 cover image）。
  function extractHeroImage(articleEl) {
    if (!articleEl) return '';
    const base = location.href;
    const isUsable = (raw) => {
      if (!raw || typeof raw !== 'string') return null;
      const s = raw.trim();
      if (!s) return null;
      if (/^data:/i.test(s) || /^blob:/i.test(s)) return null;
      try {
        const abs = new URL(s, base).href;
        if (!/^https?:\/\//i.test(abs)) return null;
        return abs;
      } catch (_) {
        return null;
      }
    };
    // 1. reader card 內第一張符合條件的 img
    const imgs = articleEl.querySelectorAll('img');
    for (const img of imgs) {
      if (img.closest('[data-jread-hidden="1"]')) continue;
      const nw = img.naturalWidth || 0;
      const nh = img.naturalHeight || 0;
      if (nw && nh) {
        if (nw < 200 || nh < 200) continue;
      } else {
        const rect = img.getBoundingClientRect && img.getBoundingClientRect();
        if (!rect) continue;
        if (rect.width < 200 || rect.height < 120) continue;
      }
      // srcset 優先取最大解析度（無 srcset 退回 src / currentSrc）
      let candidate = '';
      const srcset = img.getAttribute('srcset');
      if (srcset) {
        const entries = srcset.split(',').map(e => e.trim()).filter(Boolean).map(e => {
          const parts = e.split(/\s+/);
          const url = parts[0];
          const desc = parts[1] || '';
          const wMatch = desc.match(/^(\d+)w$/);
          return { url, w: wMatch ? Number(wMatch[1]) : 0 };
        });
        if (entries.length) {
          entries.sort((a, b) => b.w - a.w);
          candidate = entries[0].url;
        }
      }
      if (!candidate) candidate = img.currentSrc || img.src || img.getAttribute('src') || '';
      const u = isUsable(candidate);
      if (u) return u;
    }
    // 2. fallback：og:image / twitter:image meta
    const metaSelectors = [
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[property="og:image:secure_url"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]'
    ];
    for (const sel of metaSelectors) {
      const m = document.head && document.head.querySelector(sel);
      if (!m) continue;
      const u = isUsable(m.getAttribute('content'));
      if (u) return u;
    }
    return '';
  }

  // v0.7.167：抽 author 字串送 Readwise Reader 的 author 欄位。
  // 三條分支:
  //   1. Facebook 合成 reader（[data-jread-fb-reader]）：優先 URL vanity
  //      username（fb-post.js extractAuthorVanityFromUrl）;reserved path
  //      (groups / story.php / permalink.php / share)沒 vanity → fallback
  //      讀合成 header [data-jread-fb-author] strong 的 displayName。
  //   2. X / Twitter 合成 reader（[data-jread-x-reader]）：URL pathname
  //      第一段是 handle,送 @handle 形式。
  //   3. 一般網站:多層 fallback —— JSON-LD Article.author.name → meta
  //      [name="author"] / [property="article:author"](filter URL 形式)→
  //      [rel="author"] / [itemprop="author"] / .byline 等 byline 元素。
  // 找不到回空字串,buildReadwisePayload 端會省略該欄。
  function extractAuthor() {
    if (document.querySelector('[data-jread-fb-reader]')) {
      const vanity = (NS.fbPost && typeof NS.fbPost.extractAuthorVanityFromUrl === 'function')
        ? NS.fbPost.extractAuthorVanityFromUrl()
        : '';
      if (vanity) return vanity;
      const header = document.querySelector('[data-jread-fb-author] strong');
      if (header) {
        const t = (header.textContent || '').trim();
        if (t) return t;
      }
      return '';
    }
    if (document.querySelector('[data-jread-x-reader]')) {
      return extractXAuthorHandle();
    }
    return extractGenericAuthor();
  }

  function extractXAuthorHandle() {
    try {
      const u = new URL(location.href);
      const host = u.hostname.replace(/^www\./i, '');
      if (host !== 'x.com' && host !== 'twitter.com') return '';
      const m = u.pathname.match(/^\/([A-Za-z0-9_]+)\/status\/\d+/);
      if (!m) return '';
      return '@' + m[1];
    } catch (_) {
      return '';
    }
  }

  // v0.8.18 C8：JSON-LD 共用單次 parse。author / date 抽取原本各自重跑一次
  // LD script 的 querySelectorAll + JSON.parse,同一份 LD 區塊在一次 payload
  // 抽取裡被解析兩次。改成 memoize:同一輪抽取只解析
  // 一次,extractReaderPayload 開頭 resetJsonLdCache() 重置（換頁後重新解析）。
  // 維持兩個 extractXxx 函式空參數列（readwise-save.spec.js forcing 依賴）。
  let _jsonLdCache = null;
  function getJsonLd() {
    if (_jsonLdCache) return _jsonLdCache;
    const out = [];
    const ldNodes = document.querySelectorAll('script[type="application/ld+json"]');
    for (const node of ldNodes) {
      try { out.push(JSON.parse(node.textContent || '')); }
      catch (_) { /* 跳過解析失敗的 LD 區塊 */ }
    }
    _jsonLdCache = out;
    return out;
  }
  function resetJsonLdCache() { _jsonLdCache = null; }

  function extractGenericAuthor() {
    // 1. JSON-LD（Article / NewsArticle / BlogPosting 等 schema 慣用 author.name）
    for (const data of getJsonLd()) {
      const a = findJsonLdAuthor(data);
      if (a) return a;
    }
    // 2. <meta name="author">（純名字最常見載體）
    const m1 = document.head && document.head.querySelector('meta[name="author"]');
    if (m1) {
      const c = (m1.getAttribute('content') || '').trim();
      if (c && c.length < 200) return c;
    }
    // 3. <meta property="article:author">（OG 規範；FB 常用,值可能是 profile URL,排除）
    const m2 = document.head && document.head.querySelector('meta[property="article:author"]');
    if (m2) {
      const c = (m2.getAttribute('content') || '').trim();
      if (c && c.length < 200 && !/^https?:\/\//i.test(c)) return c;
    }
    // 4. byline 元素（[rel=author] / [itemprop=author] / 慣用 class）
    const sels = [
      '[itemprop="author"] [itemprop="name"]',
      '[itemprop="author"]',
      '[rel="author"]',
      '.byline-author',
      '.author-name',
      '.byline .author',
      '.byline'
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && t.length < 100) return t;
    }
    return '';
  }

  function findJsonLdAuthor(data) {
    if (!data) return '';
    if (Array.isArray(data)) {
      for (const item of data) {
        const a = findJsonLdAuthor(item);
        if (a) return a;
      }
      return '';
    }
    if (typeof data !== 'object') return '';
    if (data['@graph']) {
      const a = findJsonLdAuthor(data['@graph']);
      if (a) return a;
    }
    if (data.author) {
      const v = data.author;
      if (typeof v === 'string') return v.trim();
      if (Array.isArray(v)) {
        for (const x of v) {
          if (typeof x === 'string') {
            const t = x.trim();
            if (t) return t;
          } else if (x && typeof x === 'object' && x.name) {
            const t = String(x.name).trim();
            if (t) return t;
          }
        }
      } else if (typeof v === 'object' && v.name) {
        const t = String(v.name).trim();
        if (t) return t;
      }
    }
    return '';
  }

  // v0.7.167：抽 published_date 送 Readwise Reader（ISO 8601 字串)。
  // 多層 fallback:JSON-LD Article.datePublished → meta property=
  // "article:published_time"(OG 規範,最普及)→ 各種 meta 變體 → <time
  // datetime="..."> 第一個 parseable 的。new Date(raw).toISOString() 正規化:
  // raw 可能是 "2026-05-22"(純日期)/ "2026-05-22T10:00:00+08:00"(含時區)/
  // "Fri, 22 May 2026 10:00:00 GMT"(RFC 2822) —— Date 都能解析,toISOString
  // 統一輸出 UTC ISO 8601(Readwise 文件範例格式)。
  //
  // v0.7.168 分流:
  //   - FB 合成 reader([data-jread-fb-reader]):DOM 結構性沒絕對日期
  //     (FB 只用 aria-label="50分鐘前" 相對時間),Jimmy 2026-05-22 確認
  //     寧可不送也不要倒推不精準時間 → 直接 return ''。
  //   - X / Twitter 合成 reader([data-jread-x-reader]):一般 fallback 用
  //     document.querySelectorAll 第一個 time 會抓到 reply article 而非主推
  //     文(Jimmy 2026-05-22 cage probe 實證 article[0]=reply 在前),改從
  //     合成容器的第一個 article(主推文 clone)抓**最後一個** time[datetime]
  //     ——X 主推文 article 慣例:quoted tweet 時間在前、主推文 timestamp
  //     在後;沒 quoted tweet 時 article 內只有 1 個 time 也是主推文。
  function extractPublishedDate() {
    if (document.querySelector('[data-jread-fb-reader]')) {
      return '';
    }
    if (document.querySelector('[data-jread-x-reader]')) {
      return extractXPublishedDate();
    }
    // 1. JSON-LD datePublished / dateCreated（v0.8.18 C8：共用單次 parse）
    for (const data of getJsonLd()) {
      const d = findJsonLdDate(data);
      if (d) {
        const iso = normalizeIsoDate(d);
        if (iso) return iso;
      }
    }
    // 2. meta tags
    const metaSels = [
      'meta[property="article:published_time"]',
      'meta[name="article:published_time"]',
      'meta[name="pubdate"]',
      'meta[name="publishdate"]',
      'meta[name="date"]',
      'meta[name="DC.date"]',
      'meta[name="DC.date.issued"]',
      'meta[itemprop="datePublished"]'
    ];
    for (const sel of metaSels) {
      const m = document.head && document.head.querySelector(sel);
      if (!m) continue;
      const iso = normalizeIsoDate(m.getAttribute('content'));
      if (iso) return iso;
    }
    // 3. <time datetime="...">
    const times = document.querySelectorAll('time[datetime]');
    for (const t of times) {
      const iso = normalizeIsoDate(t.getAttribute('datetime'));
      if (iso) return iso;
    }
    return '';
  }

  function findJsonLdDate(data) {
    if (!data) return '';
    if (Array.isArray(data)) {
      for (const item of data) {
        const d = findJsonLdDate(item);
        if (d) return d;
      }
      return '';
    }
    if (typeof data !== 'object') return '';
    if (data['@graph']) {
      const d = findJsonLdDate(data['@graph']);
      if (d) return d;
    }
    if (typeof data.datePublished === 'string') return data.datePublished;
    if (typeof data.dateCreated === 'string') return data.dateCreated;
    return '';
  }

  function normalizeIsoDate(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const s = raw.trim();
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return d.toISOString();
  }

  // v0.7.168:X / Twitter 合成 reader 容器內取主推文發文時間。
  // 合成容器內第一個 :scope > article 是主推文 clone(x-thread.js
  // collectThreadArticles 把 mainArticle 放在最前)。X 主推文 article 內若
  // 有 quoted tweet 會有 2 個 time(quoted 時間在前、主推文 timestamp 在
  // 後);沒 quoted tweet 時只有 1 個 time。一律取最後一個。
  function extractXPublishedDate() {
    const container = document.querySelector('[data-jread-x-reader]');
    if (!container) return '';
    const firstArticle = container.querySelector(':scope > article');
    if (!firstArticle) return '';
    const times = firstArticle.querySelectorAll('time[datetime]');
    if (!times.length) return '';
    const last = times[times.length - 1];
    return normalizeIsoDate(last.getAttribute('datetime'));
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
    resetJsonLdCache(); // v0.8.18 C8：每輪 payload 抽取重新解析 JSON-LD
    const html = buildCleanHtml(NS.state.articleEl);
    const rawTitle = (document.title || '').trim();
    const title = rawTitle.split(/\s+[|\-—–·]\s+/)[0].trim() || rawTitle;
    const imageUrl = extractHeroImage(NS.state.articleEl);
    const author = extractAuthor();
    const publishedDate = extractPublishedDate();
    return {
      ok: true,
      payload: {
        url: location.href,
        html,
        title,
        imageUrl,
        author,
        publishedDate
      }
    };
  }

  // v0.7.228：toggle 主體抽成具名函式——onMessage handler 與 dispatchLocalCommand
  // 共用，單一資料源。
  async function toggleReader() {
    if (NS.state.active) {
      exitReaderMode();
      return { active: false };
    }
    const ok = await enterReaderMode();
    return { active: ok };
  }

  // v0.7.134 / v0.7.143 語意原樣搬出（原 TOGGLE_YT_BORDERLESS handler 內文）：
  // 啟動 borderless 時若 cinema 已 active 先走完整 exitReaderMode 清狀態 + icon；
  // 退出 borderless 不踩這條（willEnter guard）。
  function toggleBorderless() {
    const willEnter = !(NS.borderless && NS.borderless.isActive && NS.borderless.isActive());
    if (willEnter && NS.state.cinemaActive) {
      exitReaderMode();
    }
    if (NS.borderless && typeof NS.borderless.toggle === 'function') {
      NS.borderless.toggle();
    }
    return { ok: true, active: NS.borderless ? NS.borderless.isActive() : false };
  }

  // v0.7.228：統一指令 dispatch（content 端單一資料源，含 cross-mode 重導）。
  //
  // 動機：iOS Safari 的 MV3 service worker 被系統回收後**不再喚醒**（Apple
  // Forums thread 758346，iOS 17.4 起迄今未修）——任何「content → SW → content」
  // round-trip 在 SW 死亡後石沉大海：3 指手勢 / 自訂快速鍵全部失效，使用者只能
  // 強制關閉 Safari 重建 extension 程序自救。
  //
  // 修法：cross-mode 重導（v0.7.134「任一模式快速鍵都當退出當前 active 模式」）
  // 從 SW dispatchCommand 搬進這裡——重導需要的狀態（NS.state / NS.borderless）
  // 本來就在 content 端，SW 原先還得 GET_READER_STATE round-trip 來問。觸控
  // 手勢與自訂快速鍵直接本地呼叫（零訊息傳遞、SW 死活無關）；manifest 預設鍵
  // （browser 層事件只進得了 SW）由 SW 委派 DISPATCH_COMMAND 訊息接回這條，
  // 重導決策不雙實作。
  async function dispatchLocalCommand(command) {
    const borderlessActive = !!(NS.borderless && NS.borderless.isActive && NS.borderless.isActive());
    if (command === 'toggle-reader-mode') {
      // 重導：borderless active 時改退無邊模式（= 按 ESC 效果）
      if (borderlessActive) return toggleBorderless();
      return toggleReader();
    }
    if (command === 'toggle-youtube-borderless') {
      // 重導：cinema active 時改走 reader toggle 退出影院模式
      if (NS.state.cinemaActive) return toggleReader();
      return toggleBorderless();
    }
    return { ok: false };
  }
  NS.dispatchLocalCommand = dispatchLocalCommand;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === NS.MSG.TOGGLE_READER_MODE) {
      (async () => {
        sendResponse(await toggleReader());
      })();
      return true;
    }

    // v0.7.228：SW dispatchCommand 委派（manifest 預設鍵路徑）。command 白名單
    // ——訊息來源雖限 extension 內部，仍防 payload 偽造 / 打錯字眼靜默 no-op。
    if (msg.type === NS.MSG.DISPATCH_COMMAND) {
      const command = msg.payload && msg.payload.command;
      const allowed = ['toggle-reader-mode', 'toggle-youtube-borderless'];
      if (!allowed.includes(command)) {
        sendResponse({ ok: false });
        return; // sync
      }
      (async () => {
        sendResponse(await dispatchLocalCommand(command));
      })();
      return true;
    }

    if (msg.type === NS.MSG.GET_READER_STATE) {
      // v0.7.133：siteMode 讓 popup 知道當前頁面型態（'youtube-cinema' /
      // 'article' / null=不適用），用來切換按鈕文字「啟動影院模式」vs
      // 「切換閱讀模式」+ 控制 Readwise 按鈕可見性。
      // 'article' = detector 偵測得到主文；null = 既非 cinema 也偵測不到主文
      // （chrome:// 類禁注入頁面則 sendMessage 直接 reject、popup 走另一路徑）。
      // v0.7.143：改走 NS.detector.probe()（輕量、不 mutate DOM）。
      // 既有 detect() 在 popup 開啟時跑完整 promote / narrow / shadow replica
      // appendChild 流程，光是 probe siteMode flag 就在 page DOM 注入 shadow
      // 替身——副作用 + 效能浪費。probe() 只跑 read-only 4 策略決定 siteMode。
      let siteMode = null;
      if (NS.detector && typeof NS.detector.probe === 'function') {
        try {
          const result = NS.detector.probe();
          siteMode = result && result.siteMode ? result.siteMode : null;
        } catch (_) { /* probe 失敗 = null */ }
      }
      sendResponse({
        active: !!NS.state.active,
        cinemaActive: !!NS.state.cinemaActive,
        // v0.7.134：borderless 跟 reader / cinema 完全獨立，自己一條軸；popup
        // 用此值切「啟動 / 退出無邊模式」按鈕文字。
        borderlessActive: !!(NS.borderless && NS.borderless.isActive && NS.borderless.isActive()),
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

    // v0.7.134：YouTube 無邊模式 toggle（SW 快速鍵 / popup 按鈕觸發）。獨立
    // 於 reader mode / cinema mode 之外——不動 NS.state、不切 icon / badge，
    // 純粹委派給 NS.borderless.toggle()。非 YouTube watch 頁 toggle() 自己
    // no-op，這裡不再 guard 一次。
    if (msg.type === NS.MSG.TOGGLE_YT_BORDERLESS) {
      // v0.7.143 互斥邏輯在 toggleBorderless()（v0.7.228 抽出共用，見上方）
      sendResponse(toggleBorderless());
      return; // sync
    }

  });

  // 設定變更即時套用：popup 的加減/切換動作會寫入 chrome.storage.sync，
  // 這裡監聽變更，若閱讀模式正在開啟就 restore + 重新 apply styler。
  // 走 storage.onChanged 而非訊息，好處是即使同時有多個分頁開啟閱讀模式，
  // 每個 tab 的 content script 都會收到事件、各自更新。
  if (chrome.storage && chrome.storage.onChanged) {
    // v0.7.143：reapply 走 debounce 合併。popup 連點 stepper 字級/版心會觸發多次
    // storage.sync.set → 多次 restore + await getSettings + apply 並發纏繞——
    // originalStyles 可能 snapshot 已套樣式的中間狀態，最後 exit 還原不回原貌。
    // 200ms 對人類連點足夠合併、對「單次調整」無感。
    let reapplyTimer = null;
    const scheduleReapply = () => {
      if (reapplyTimer) clearTimeout(reapplyTimer);
      reapplyTimer = setTimeout(async () => {
        reapplyTimer = null;
        // v0.7.143：cinema mode active 時 articleEl=null，styler.restore null 無意義
        // 且可能 throw；明確 guard 避免誤觸發。reader mode 中途切到 cinema 不該踩。
        if (!NS.state.active || NS.state.cinemaActive) return;
        if (!NS.state.articleEl || !NS.styler) return;
        NS.styler.restore(NS.state.articleEl, NS.state.originalStyles);
        const settings = await getSettings();
        // v0.7.227：styler 重注入前捕捉卷動位置（pagedMode 中途開啟場景：
        // 此刻 CSS 已 restore、文件可卷動且停在使用者讀到的位置）
        if (NS.pagedMode) NS.pagedMode.captureScrollY();
        NS.state.originalStyles = NS.styler.apply(NS.state.articleEl, settings);
        // v0.7.227：reapply 後重同步翻頁模組（pagedMode 切換 / 字級版心調整
        // 都會改頁面切割，模組內部重算頁數並回到原閱讀比例）；spaceScroll
        // 跟著重同步（依 pagedMode installed 狀態讓位或恢復）
        syncPagedModeFromSettings(settings);
        syncSpaceScrollFromSettings(settings);
      }, 200);
    };

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
      // v0.7.216：spaceScrollRatio 即時切換——options 改數值後立刻生效
      if ('spaceScrollRatio' in changes) {
        syncSpaceScrollFromSettings({ spaceScrollRatio: changes.spaceScrollRatio.newValue });
      }
      // v0.7.237：showPageNumber 即時切換——純顯示層，直接增/移除頁碼指示器，
      // 不走 styler reapply（避免捲動→翻頁閃爍）。翻頁模式未啟動時無感。
      if ('showPageNumber' in changes && NS.pagedMode) {
        NS.pagedMode.setShowIndicator(changes.showPageNumber.newValue !== false);
      }
      // v0.7.143：cinema mode active 時不走 styler reapply 路徑（articleEl=null）
      if (NS.state.cinemaActive) return;
      if (!NS.state.articleEl || !NS.styler) return;
      // v0.7.227：pagedMode 走 reapply 路徑——CSS 注入/移除需要 styler 重建
      // stylesheet，模組 install/uninstall 在 scheduleReapply 尾端同步
      const relevantKeys = ['theme', 'fontSize', 'contentWidth', 'fontFamily', 'fontWeight', 'lineHeight', 'paragraphSpacing', 'pangu', 'pagedMode'];
      const hasRelevant = relevantKeys.some(k => k in changes);
      if (!hasRelevant) return;
      scheduleReapply();
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
  //   window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'set-theme', theme: 'dark' } }));  // 'light' | 'dark' | 'sepia'
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
    } else if (type === 'set-theme') {
      // Page Rounds 暗色模式驗收用。cage javascript_tool 跑在 main world，
      // 無法存取 chrome.storage.sync；透過 bridge 讓 isolated world 代寫。
      // 寫完後 onChanged listener 自動 scheduleReapply，不需額外觸發。
      const theme = e && e.detail && e.detail.theme;
      if (theme && ['light', 'dark', 'sepia'].includes(theme)) {
        chrome.storage.sync.set({ theme });
      }
    } else if (type === 'translate') {
      // 觸發 Shinkansen 翻譯（跨 extension debug bridge）。
      // Shinkansen 的 content script 監聽 'shinkansen-debug-request' custom
      // event（isolated world 間 DOM event 共享）。支援 engine 參數：
      //   { type: 'translate' }                     → 預設引擎
      //   { type: 'translate', engine: 'google' }   → Google MT（免 API key）
      const engine = e && e.detail && e.detail.engine;
      const action = engine ? 'TRANSLATE_ENGINE' : 'TRANSLATE';
      const detail = engine ? { action, engine } : { action };
      window.dispatchEvent(new CustomEvent('shinkansen-debug-request', { detail }));
    } else if (type === 'reload') {
      // v0.7.126：chrome.runtime.reload() 在 content script context 不存在
      // （Uncaught TypeError: chrome.runtime.reload is not a function）——
      // 該 API 僅 SW / popup / options page 可呼叫。改透過 sendMessage 給 SW
      // 中繼觸發 reload。
      if (NS.state.active) exitReaderMode();
      safeSendMessage({ type: 'JREAD_RELOAD' });
    }
  });

  // v0.7.155：auto-enable 網域 — 當前 hostname 命中 settings.autoEnableDomains
  // 時 silent 進閱讀模式（偵測失敗不彈 toast，避免沒主動觸發卻彈錯誤訊息）。
  // 共用判定：document_idle 首次載入 + SPA 路由變化重觸發都走這條（單一資料源）。
  async function autoEnableMatchesCurrentRoute() {
    const helper = window.__JReadDomainMatch;
    if (!helper) return false;
    const settings = await getSettings();
    if (!settings) return false;
    const list = Array.isArray(settings.autoEnableDomains) ? settings.autoEnableDomains : [];
    return !!helper.matchHostname(location.hostname, list);
  }

  (async function tryAutoEnableOnLoad() {
    try {
      if (window.top !== window.self) return;
      if (!(await autoEnableMatchesCurrentRoute())) return;
      if (NS.state.active) return;
      await enterReaderMode({ silent: true });
    } catch (_) { /* getSettings/detector 失敗：保持原頁面、不打擾 */ }
  })();

  // v0.8.21 C1：SPA 導航偵測。
  //
  // 動機：SPA 站（Next.js / React Router / Vue Router 等）路由切換**不重載
  // content script**——舊版只在 document_idle 注入時跑一次 auto-enable，且
  // reader card 綁的是「舊路由」的 DOM。使用者在 SPA 站 reader mode 下點到
  // 下一篇文章時：(a) 舊 reader card 殘留、新內容被它蓋住；(b) auto-enable
  // 網域不會對新路由重觸發。
  //
  // 對策：偵測路由變化 → 先 exitReaderMode（拆掉綁舊 DOM 的 reader card）→
  // 視情況重觸發（使用者原本就在 reader mode、或新路由命中 auto-enable 網域
  // → 等新內容渲染後 silent 重進）。
  //
  // 為何不 monkey-patch history.pushState / replaceState（review 原始建議）：
  // content script 跑在 **isolated world**，`window.history` 是與頁面 main
  // world 分離的 wrapper——在 isolated world 改寫 history.pushState **攔不到
  // 頁面自己呼叫的 pushState**（頁面看到的是 main world 的原版）。要真正攔
  // 需注入 main-world script（web_accessible_resource），代價與 CSP 風險高。
  // 改用 content script 可靠的三個訊號：
  //   1. popstate（back / forward / hash 路由，window 事件兩個 world 都收得到）
  //   2. <title> childList MutationObserver（SPA 換頁幾乎都更新 document.title，
  //      DOM 共享、content script 收得到）
  //   3. location.href 輪詢（catch-all：少數換頁不動 title 也不發 popstate 的
  //      pushState 路由；800ms 輕量輪詢，成本可忽略）
  // 三者都收斂到 onRouteChange()，以 location.href 是否真的變化為準（去重：
  // title 因未讀數「(1) …」變動但 href 沒變則不誤判為導航）。
  // v0.8.35：路由比對 key 必須剝掉「錨點型 hash」——閱讀模式刻意保留 <a>（硬教訓
  // 九），點文內註腳 / TOC 錨點（href="#fn1"）會讓 location.href 變化，舊版以完整
  // href 比對 → 800ms 輪詢誤判為換頁 → 強制退出再 silent 重進，頁面閃回原站、
  // 捲動位置全失。例外：hash-router SPA（`#/path`、`#!/path`）的 hash 是真路由，
  // 保留進比對 key（剝掉會讓 hash-router 站換頁後 reader card 綁舊內容）。
  // 判別是結構性的：錨點 fragment 不會以 `/` 或 `!` 開頭，router hash 慣例以
  // `#/` 或 `#!` 開頭。
  function spaRouteKey(href) {
    const i = href.indexOf('#');
    if (i === -1) return href;
    const hash = href.slice(i);
    if (hash.startsWith('#/') || hash.startsWith('#!')) return href; // hash-router
    return href.slice(0, i); // 錨點型 hash：不算導航
  }

  let _spaLastUrl = spaRouteKey(location.href);
  let _spaReenterTimer = null;
  let _spaInstalled = false;

  function onSpaRouteChange() {
    const url = spaRouteKey(location.href);
    if (url === _spaLastUrl) return; // 路由 key 沒變 = 非真導航（title 雜訊 / 錨點跳轉等）
    _spaLastUrl = url;
    // 路由變化：reader card 綁的是舊路由 DOM，先同步退出
    const wasActive = NS.state.active && !NS.state.cinemaActive;
    if (NS.state.active) {
      try { exitReaderMode(); } catch (_) { /* 退出失敗不阻斷後續 */ }
    }
    // 視情況重觸發：等新內容渲染後評估。debounce 合併連續路由跳轉。
    if (_spaReenterTimer) clearTimeout(_spaReenterTimer);
    _spaReenterTimer = setTimeout(async () => {
      _spaReenterTimer = null;
      try {
        if (NS.state.active) return; // 期間使用者已手動進入
        // wasActive（保留使用者閱讀意圖跨路由）或新路由命中 auto-enable 網域
        // → silent 重進（偵測失敗 no-op，不彈 toast）。
        const autoMatch = await autoEnableMatchesCurrentRoute();
        if (!wasActive && !autoMatch) return;
        if (NS.state.active) return;
        await enterReaderMode({ silent: true });
      } catch (_) { /* 重觸發失敗：保持原頁面 */ }
    }, 400);
  }

  function installSpaNavigationWatch() {
    if (_spaInstalled) return;
    if (window.top !== window.self) return; // top-level frame 才偵測
    _spaInstalled = true;
    window.addEventListener('popstate', onSpaRouteChange);
    try {
      const titleEl = document.querySelector('title');
      if (titleEl) {
        new MutationObserver(onSpaRouteChange).observe(titleEl, { childList: true });
      }
    } catch (_) { /* 無 <title> / observer 不可用：靠 popstate + 輪詢 */ }
    try {
      setInterval(onSpaRouteChange, 800);
    } catch (_) { /* setInterval 不可用：靠事件 */ }
  }

  installSpaNavigationWatch();
})();
