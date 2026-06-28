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
      // v0.8.144：在讀取邊界把英文（拉丁）fallback 字型選擇前接到 fontFamily
      // base stack——styler 下游維持「只認 fontFamily 整串字面值」的契約不變。
      const finish = (values) => {
        const compose = window.__JReadComposeFontStack;
        if (values && typeof compose === 'function') {
          const composed = compose(values);
          if (composed) values.fontFamily = composed;
        }
        resolve(values);
      };
      const fallbackViaBackground = () => {
        safeSendMessage({ type: NS.MSG.GET_SETTINGS }, finish);
      };
      // v0.8.164：browser.storage.sync.get 原生 Promise（無 callback / lastError）；
      // reject 或回空值 → 退回 GET_SETTINGS round-trip（Chrome SW 正常時仍可救），
      // 兩邊都死則 finish(undefined) → resolve(undefined)，與舊行為降級結果一致。
      let p;
      try {
        p = browser.storage.sync.get(defaults);
      } catch (_) {
        fallbackViaBackground();
        return;
      }
      if (p && typeof p.then === 'function') {
        p.then((values) => {
          if (!values) { fallbackViaBackground(); return; }
          finish(values);
        }).catch(() => fallbackViaBackground());
      } else {
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
    safeSendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: true } });
    return true;
  }

  // v0.8.149：通知翻譯擴充（Shinkansen）JRead 閱讀模式進入 / 退出，讓它在閱讀模式
  // 期間暫停每秒的 content guard reconcile。否則 guard 把 JRead 排版誤判成「譯文被
  // 覆蓋」、每秒重建被翻譯 articleEl 的子節點 → 畫面每秒閃一下（translate-first 才會、
  // 與 v0.8.131 標題被清同根因；2026-06-10 曾 WONTFIX，改以本握手根治）。閱讀卡片是
  // articleEl 本身、在 guard 管轄區內，無法像 v0.8.131 標題那樣挪到 articleEl 外閃避。
  // 跨 extension content script 用 DOM CustomEvent 溝通（與 JRead 觸發 Shinkansen 翻譯
  // 的 shinkansen-debug-request 同機制、已實證可跨 isolated world）。無 Shinkansen 時
  // 無 listener、純 no-op；只是一個 window event，零成本。
  function signalReaderModeToTranslator(active) {
    try {
      window.dispatchEvent(new CustomEvent('jread-reader-mode', { detail: { active: !!active } }));
    } catch (_) { /* dispatch 失敗不阻斷 reader 流程 */ }
  }

  // v0.8.37：三條 enter 路徑（generic / x-thread / fb-post）的共用收尾。
  // 歷史上三段 ~80% 重複且實際 drift 過（silent flag 只有 generic path 尊重、
  // v0.8.36 才補齊——同一份事實三實作的典型代價）。差異點只剩「容器怎麼來、
  // cleaner 跑不跑」，由各 caller 設定 state 後呼叫本函式統一收尾。
  // 順序不變（v0.7.233 定案）：captureScrollY（styler 注入 overflow hidden 前
  // 捕捉卷動位置）→ styler.apply → active → ESC listener（remove+add 防重複）
  // → syncPagedMode → syncSpaceScroll（依 pagedMode installed 讓位）→
  // keyguard（依 settings.blockPageShortcuts；註冊順序在 onEscKey 之後，同
  // 階段 listener 按註冊順序執行、ESC 先給 onEscKey）→ SET_ACTIVE_ICON。
  function finalizeEnter(container, settings) {
    // v1.0.21：記住此 session 是否要在退出時把原網頁捲回閱讀段落（退出流程沒有
    // settings 參數，進場時 stash）。預設 true，明確設 false 才關。
    NS.state.syncScrollOnExit = !(settings && settings.syncScrollOnExit === false);
    if (NS.pagedMode) NS.pagedMode.captureScrollY();
    NS.state.originalStyles = NS.styler ? NS.styler.apply(container, settings) : null;
    NS.state.active = true;
    window.removeEventListener('keydown', onEscKey, true);
    window.addEventListener('keydown', onEscKey, true);
    syncPagedModeFromSettings(settings);
    syncSpaceScrollFromSettings(settings);
    // v0.8.40：閱讀位置記憶——回復上次位置 + 開始追蹤。必須在 syncPagedMode
    // 之後（翻頁模組已 install、頁數已算好才能 goToPage）、installKeyguard
    // 之前（模組的 keydown listener 要先於 keyguard 收到翻頁鍵——keyguard 對
    // 非 ESC 鍵 stopImmediatePropagation）。urlKey 用 spaRouteKey（與 SPA
    // 導航偵測同一份 key 語意：錨點 hash 不分流、hash-router 分流）。
    if (NS.positionMemory) {
      NS.positionMemory.beginSession(spaRouteKey(location.href), settings, container);
    }
    if (!settings || settings.blockPageShortcuts !== false) {
      installKeyguard();
    } else {
      uninstallKeyguard();
    }
    safeSendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: true } });
    // v0.8.149：閱讀模式已就緒，叫翻譯擴充暫停 content guard（防每秒閃動）
    signalReaderModeToTranslator(true);
    return true;
  }

  // v0.7.135：X / Twitter status 頁走合成 reader 容器分支。detector 短路回
  // isXThread=true 時呼叫 NS.xThread.enter() 在 body 開頭注入合成 `<article
  // data-jread-x-reader>`，後續 cleaner / styler / Readwise / keyguard / ESC
  // 流程都對這個合成容器跑——所以這分支只是「在跑 cleaner/styler 之前先建容器」，
  // 退出時除了走 styler.restore / cleaner.restore 之外多 remove 合成容器。
  async function enterXThreadMode(opts) {
    // v0.8.36：尊重 silent flag（v0.7.155 漏網——x.com 是 SPA，路由變化
    // silent 重進在容器偵測失敗時不該彈錯誤 toast）
    const silent = !!(opts && opts.silent);
    if (!NS.xThread) return false;
    const container = NS.xThread.enter();
    if (!container) {
      if (!silent) showToast('此頁無法偵測主推文', 'error');
      return false;
    }
    const settings = await getSettings();
    NS.state.articleEl = container;
    NS.state.confidence = 1;
    NS.state.hiddenEls = NS.cleaner ? NS.cleaner.clean(container) : [];
    if (NS.xThread && typeof NS.xThread.injectAuthorHeaders === 'function') {
      NS.xThread.injectAuthorHeaders();
    }
    // X 是 keyboard-shortcut-heavy 站（j/k 換推文、l 點讚、r reply 等），跟
    // reader mode 純閱讀完全衝突——finalizeEnter 內的 keyguard 攔截。
    return finalizeEnter(container, settings);
  }

  // v0.7.157：Facebook permalink post 走合成 reader 容器分支。fb-post.js 找
  // 到主貼文 wrapper 後 clone 進 `<article data-jread-fb-reader>` 注入 body
  // 開頭，後續 cleaner / styler 流程沿用。FB 跟 X 同樣 keyboard-shortcut-heavy
  // （j/k 換貼文等），install keyguard 攔截。
  async function enterFbPostMode(opts) {
    // v0.8.36：尊重 silent flag（理由見 enterXThreadMode 同位置註解）
    const silent = !!(opts && opts.silent);
    if (!NS.fbPost) return false;
    // v0.7.204 photo page：先點「查看更多」展開截斷文字，等 React re-render
    if (NS.fbPost.expandSeeMore && NS.fbPost.expandSeeMore()) {
      await new Promise(function (r) { setTimeout(r, 500); });
    }
    const container = NS.fbPost.enter();
    if (!container) {
      if (!silent) showToast('此頁無法偵測主貼文', 'error');
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
    return finalizeEnter(container, settings);
  }

  // v1.0.22：Readwise Reader 整合——reader.html（擴充自有頁）自建 article 容器
  // （內容來自 Reader API 的 html_content），走與 x-thread / fb-post 同款「繞過
  // detector → finalizeEnter」路徑，重用真 styler + positionMemory（單一資料源，
  // 不另造排版）。container 已是 Readwise 清乾淨的主文，跳過通用 cleaner
  // （hiddenEls=[]，比照 enterFbPostMode——通用 cleaner 為 live web DOM 雜訊調校，
  // 對乾淨文章 HTML 會過度修剪）。reader-app.js 建好 container 後直接呼叫。
  async function enterFromContainer(container, opts) {
    if (!container) return false;
    const settings = await getSettings();
    NS.state.articleEl = container;
    NS.state.confidence = 1;
    NS.state.hiddenEls = [];
    return finalizeEnter(container, settings);
  }

  // v0.7.143：in-flight guard 防快速雙擊快速鍵造成的 race。
  // enterReaderMode 是 async（有 await getSettings），中間時間窗若第二次 toggle
  // 進來會看到 NS.state.active 還是 false、再跑一次 enterReaderMode——
  // NS.state.hiddenEls + originalStyles 被第二輪 snapshot 蓋掉，第一輪 hide 的
  // 元素永遠回不來。
  // v0.8.37：移除 exitInFlight 死 guard——exitReaderModeImpl 全同步、flag 在
  // 同一個 task 內 set→clear，沒有任何 async gap 能讓第二個呼叫觀察到 true
  // （enterReaderMode 開頭的 `|| exitInFlight` 同理永 false）。
  let enterInFlight = false;

  async function enterReaderMode(opts) {
    if (enterInFlight) return false;
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
    // v0.8.36：detect() 會做 DOM mutation（shadow replica appendChild / inject
    // H1），throw 時半套 artifacts 留在頁面（replica 是可見的文章複本）。包
    // try/catch、失敗走 exitReaderModeImpl 清乾淨（該函式無 active guard、
    // 對未設定的 state 各步驟都安全 no-op）。
    let result;
    try {
      result = NS.detector && NS.detector.detect();
    } catch (err) {
      console.warn('[JRead] detector.detect() 失敗，清理半套 artifacts：', err);
      try { exitReaderModeImpl(); } catch (_) { /* 清理失敗：console 已有訊號 */ }
      if (!silent) showToast('此頁無法偵測主文', 'error');
      return false;
    }
    if (!result) {
      if (!silent) showToast('此頁無法偵測主文', 'error');
      return false;
    }
    // v0.8.36：detect 成功後的 enter pipeline 整段包 try/catch。舊行為：cleaner
    // / styler 中途 throw → NS.state.active 停在 false → exitReaderMode() 開頭
    // 的 !active guard 直接 no-op——已 hide 的元素 / shadow replica / injected
    // H1 全部永遠無法還原（使用者只能 reload）；rejection 沿 onMessage 的
    // async IIFE 上傳，sendResponse 懸空。改成 catch 內走完整 exit 流程還原
    // 半套狀態（exitReaderModeImpl 無 active guard，對部分設定的 state 安全）。
    // v0.8.36：silent flag 同時傳進 x-thread / fb-post 分支（v0.7.155 漏網
    // ——x.com 本身是 SPA，路由變化 silent 重進在偵測失敗時會彈錯誤 toast）。
    try {
      if (result.isYouTubeCinema) {
        return enterCinemaMode();
      }
      if (result.isXThread) {
        return await enterXThreadMode(opts);
      }
      if (result.isFbPost) {
        return await enterFbPostMode(opts);
      }
      return await enterGenericReaderMode(result, silent);
    } catch (err) {
      console.warn('[JRead] 進入閱讀模式失敗，還原半套狀態：', err);
      try { exitReaderModeImpl(); } catch (_) { /* 還原失敗：console 已有訊號 */ }
      if (!silent) showToast('此頁無法啟用閱讀模式', 'error');
      return false;
    }
  }

  async function enterGenericReaderMode(result, silent) {
    void silent; // generic path 目前無 toast；參數保留語意對齊三分支
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
    const container = result.el;
    return finalizeEnter(container, settings);
  }

  function exitReaderMode() {
    if (!NS.state.active) return;
    // v1.0.22：reader.html（擴充自有頁）的退出語意是「回 feed」，不是把版型從
    // 合成 article 剝掉留下裸文章。reader-app.js 進文章時設 NS.state.readerHostPage
    // = true + NS.onReaderExit（導回 reader.html feed）。對一般內容頁惰性
    // （flag 預設未設、hook 不存在）。ESC / floating-icon 短按都會走到這裡。
    if (NS.state.readerHostPage && typeof NS.onReaderExit === 'function') {
      NS.onReaderExit();
      return;
    }
    exitReaderModeImpl();
  }

  // v1.0.21：退出捲動同步——抓「目前閱讀段落」的真實 DOM 節點，退出還原雜訊後
  // 把原網頁捲回該節點（否則退出停在原站開頭附近：主文 card 留在原文件流、雜訊
  // 只是被隱藏，還原後版面變高、原 scrollTop 對到的內容偏移）。錨點段落是
  // articleEl 內的真實節點、styler/cleaner.restore 不移除它，故還原後仍可量測。
  // 必須在 spaceScroll.uninstall 之前呼叫——uninstall 清掉 focusedBlock，之後抓
  // 只能退 firstVisibleBlock。與閱讀位置記憶共用同一份「正在讀哪段」事實。
  // 只作用於捲動模式：翻頁模式由 pagedMode.uninstall 還原進場前文件位置，回
  // null 跳過——CSS multicolumn 的 getBoundingClientRect 是 as-if-unfragmented，
  // per-page 段落偵測不可靠、頁碼↔段落數又非線性（三種對位法 Chromium probe
  // 皆失準），暫不支援翻頁退出捲回（見 PENDING_REGRESSION）。
  function captureExitScrollAnchor() {
    if (!NS.state.syncScrollOnExit || !NS.state.articleEl) return null;
    if (NS.pagedMode && NS.pagedMode.isInstalled()) return null;
    if (!NS.spaceScroll || typeof NS.spaceScroll.currentAnchor !== 'function') return null;
    const a = NS.spaceScroll.currentAnchor(NS.state.articleEl);
    return a && a.el ? a.el : null;
  }

  // v1.0.21：原站版面已完全還原——把原網頁捲到退出前讀到的段落（節點仍在 DOM）。
  function applyExitScrollAnchor(el) {
    if (!el || !el.isConnected) return;
    const scroller = document.scrollingElement || document.documentElement;
    if (!scroller) return;
    const rectTop = el.getBoundingClientRect().top;
    const top = NS.positionMemory
      ? NS.positionMemory.computeExitScrollTop(scroller.scrollTop, rectTop, window.innerHeight)
      : Math.max(0, scroller.scrollTop + rectTop - window.innerHeight * 0.12);
    scroller.scrollTo(0, top);
  }

  function exitReaderModeImpl() {
    // v0.8.149：退出閱讀模式——恢復翻譯擴充的 content guard（任一退出路徑都送、
    // idempotent；Shinkansen 端未暫停時設 false 無副作用）。
    signalReaderModeToTranslator(false);
    // v0.8.108：先拆編輯模式（silent：reader teardown 自己會還原 interaction
    // layer + cleaner.restore 還原手動隱藏的元素，不需 editMode 的 onExit 再
    // 裝回 keyguard 等）。必須在 cleaner.restore 之前——只移除編輯 UI / listener，
    // 手動隱藏的記錄續留 NS.state.hiddenEls 由下方 cleaner.restore 一併還原。
    if (NS.editMode && NS.editMode.isActive()) {
      try { NS.editMode.exit(true); } catch (_) { /* 拆 UI 失敗不阻斷退出 */ }
    }
    // v0.8.40：先 flush 閱讀位置記憶——必須在 pagedMode.uninstall（頁碼歸零）
    // 與 styler.restore（捲動位置還原成原站排版）之前，位置此刻才有效。
    // 未開始 session（cinema / 停用 / enter 失敗 rollback）時 no-op。
    if (NS.positionMemory) NS.positionMemory.endSession();
    // v1.0.21：退出捲動同步——還原前先抓閱讀段落（detail + 為何在 uninstall 前見函式）
    const exitScrollAnchorEl = captureExitScrollAnchor();
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
    // v1.0.21：原站版面已完全還原——捲回退出前讀到的段落。
    applyExitScrollAnchor(exitScrollAnchorEl);
    NS.state.active = false;
    NS.state.articleEl = null;
    NS.state.hiddenEls = [];
    NS.state.originalStyles = null;
    NS.state.confidence = 0; // v0.8.37：與 cinema exit 路徑對齊（原本只有 cinema 重置）
    safeSendMessage({ type: NS.MSG.SET_ACTIVE_ICON, payload: { active: false } });
  }

  // 抽 reader card 的 outerHTML 給 popup 送 Readwise（v0.7.33）。
  // 取 [data-jread-active] 容器後 clone 一份，把 cleaner 標記為 hidden 的節點
  // 從 clone 裡刪掉（直接送 outerHTML 會帶進雜訊節點——cleaner 只 inline display:none、
  // Readwise parser 不認 jread 的 stylesheet rule 會把那些節點重新渲染出來）；
  // 同時剝掉 jread 內部用的 data-jread-* attribute 和 jread 注入的 style 元素。
  // 抓 document.title 的分隔前首段當 title——多數站把站名接在「| Site Name」之後，
  // 切掉避免 Readwise 顯示「文章標題 | 中央社 CNA」這種尾巴。
  function buildCleanHtml(rootEl, title) {
    // v0.8.121：先在 live DOM 標記文首 byline meta（邏輯單一資料源在
    // NS.markLeadingBylineForExport），clone 後移除標記節點、再還原 live 標記
    //（不影響閱讀模式顯示）。layout / naturalWidth 在 detached clone 上量不到，
    // 故偵測必須跑在 live rootEl。
    const bylineMarked = (NS && NS.markLeadingBylineForExport)
      ? NS.markLeadingBylineForExport(rootEl) : [];
    // v0.8.124：標記重複的文首 hero 主圖（Readwise 用 image_url 另 render cover、
    // body 殘留同張 hero 會重複）。與 byline 共用 data-jread-rw-strip 標記。
    const heroMarked = (NS && NS.markHeroImageForExport)
      ? NS.markHeroImageForExport(rootEl) : [];
    // v0.8.127：標記 reader 內 display:none 的子樹（站點響應式重複版本中非當前斷點
    // 那份；使用者看不到、但 outerHTML 會序列化 → Readwise 無 CSS 全 render 出來，
    // 翻譯時造成同段中英重複 + 隱藏 byline 殘留）。必須在 clone 前標記 live（clone
    // 無 layout 量不到 computed display）。與 byline / hero 共用 data-jread-rw-strip。
    const hiddenMarked = (NS && NS.stripHiddenForExport)
      ? NS.stripHiddenForExport(rootEl) : [];
    const clone = rootEl.cloneNode(true);
    // 0. 移除文首 byline / dateline meta（Readwise metadata 已記錄作者 + 發表日期）
    //    + 重複的 hero 主圖（image_url 另 render cover）+ display:none 隱藏子樹
    clone.querySelectorAll('[data-jread-rw-strip="1"]').forEach(n => n.remove());
    bylineMarked.forEach(el => el.removeAttribute('data-jread-rw-strip'));
    heroMarked.forEach(el => el.removeAttribute('data-jread-rw-strip'));
    hiddenMarked.forEach(el => el.removeAttribute('data-jread-rw-strip'));
    // 0.5 Shinkansen 雙語（dual）模式：只留中文譯文、移除原文（避免同段原文 + 譯文
    //     重複送進 Readwise）。在 clone 上操作、不動 live reader 的雙語顯示。
    //     未翻譯 / 非 dual 頁面為 no-op。邏輯單一資料源在 NS.collapseShinkansenDual。
    if (NS && NS.collapseShinkansenDual) NS.collapseShinkansenDual(clone);
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
    // 2.6 空殼 prune（v0.8.53）：cleaner 把 li / 容器內部的 interactive 元素
    // （follow / share / topic 按鈕群）標 hidden 後，步驟 1 刪掉那些節點會留下
    // 「沒有任何可見內容的殼」——本地 reader card 殼高度為 0 看不見，但 outerHTML
    // 送到 Readwise Reader 後對方不吃本地 CSS，空 <li> 渲染成一排空 bullet
    // （theverge 頂端 topic chips ul + 文末 follow widget ul 實證）。
    // 結構性通則：post-order 走訪，沒有非空白文字、也沒有媒體子孫的元素整個移除
    // （先清子孫再判自身，讓 li → ul 這類殼鏈逐層塌掉）。保護邊界：
    //   - 表格結構元素不 prune（空 td/th 撐欄位對齊是合法結構）
    //   - 媒體 / void 元素自身不 prune；含媒體子孫的容器視為有內容
    //   - <noscript> 的 textContent 是原始 HTML 字串（非空）→ 自然保留
    //     （站點 lazy image 的 noscript fallback 是 Readwise 端的圖片來源）
    const PRUNE_KEEP_TAGS = new Set([
      'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION',
      'COLGROUP', 'COL', 'BR', 'HR', 'WBR',
      'IMG', 'PICTURE', 'SOURCE', 'TRACK', 'VIDEO', 'AUDIO', 'IFRAME',
      'SVG', 'EMBED', 'OBJECT', 'CANVAS'
    ]);
    const PRUNE_MEDIA_SEL = 'img, picture, video, audio, iframe, svg, embed, object, canvas';
    function pruneEmptyHusks(node) {
      for (const child of Array.from(node.children)) pruneEmptyHusks(child);
      if (node === clone) return;
      if (PRUNE_KEEP_TAGS.has(node.tagName.toUpperCase())) return;
      if ((node.textContent || '').trim()) return;
      if (node.querySelector(PRUNE_MEDIA_SEL)) return;
      node.remove();
    }
    pruneEmptyHusks(clone);
    // 3. 剝掉所有 data-jread-* attribute（v0.8.126：一併剝 data-shinkansen* /
    //    data-sk*——dual collapse 後未翻譯段落 / inner 上殘留的 Shinkansen 標記、
    //    mark 樣式屬性，送 Readwise 是雜訊）
    function stripDataAttrs(node) {
      if (node.attributes) {
        const toRemove = [];
        for (const attr of node.attributes) {
          if (attr.name.startsWith('data-jread') ||
              attr.name.startsWith('data-shinkansen') ||
              attr.name.startsWith('data-sk')) toRemove.push(attr.name);
        }
        toRemove.forEach(name => node.removeAttribute(name));
      }
      for (const child of node.children) stripDataAttrs(child);
    }
    stripDataAttrs(clone);
    // 3.5 媒體資源 URL 轉絕對（v0.8.76）。outerHTML 序列化的是 src / srcset 的
    // 「屬性原值」（相對路徑），Readwise 伺服器端無原站 base 可解析 → 破圖
    // （0xkato.xyz Ghost 站 `/assets/transformer-*.png` 實證，Jimmy 2026-06-15）。
    // 邏輯抽在 NS.absolutizeResourceUrls（單一資料源 + jsdom 可測）。
    if (NS && NS.absolutizeResourceUrls) NS.absolutizeResourceUrls(clone, location.href);
    // 4. 去重「與 payload title 同文的主標 heading」（v0.8.62）。
    // Readwise Reader 端用 payload 的 title 欄位另外渲染一條主標 header，body 內
    // 若殘留同名 heading 會被重複渲染成第 2、第 3 條標題（theatlantic 實證：
    // detector 注入的可見主標 h1 + 站方原生 ArticleTitle h1（被 detector 設
    // display:none 但未標 data-jread-hidden，逃過步驟 1）兩份都進了 outerHTML）。
    // 結構性通則：「主標」這份事實送 Readwise 時由 title 欄位單一承擔，body 不該
    // 再出現——折疊標點 + 大小寫後與 title 文字相等的 h1-h6 全部移除。比對全文
    // 相等（非 includes）避免誤殺「標題是某段 heading 子字串」的合法 section
    // heading；reader card 主標一律 <= 300 字，title 來源同此上限。
    if (title) {
      const fold = (s) => (NS && NS.foldTitlePunct ? NS.foldTitlePunct(s) : (s || '').replace(/\s+/g, ' ').trim()).toLowerCase();
      const foldedTitle = fold(title);
      if (foldedTitle) {
        clone.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
          const t = fold(h.textContent || '');
          if (t && t === foldedTitle) h.remove();
        });
      }
    }
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
    // v0.8.124：選擇邏輯抽到 NS.findLeadingHeroImage——與 markHeroImageForExport
    // 共用同一張 hero（杜絕「送的 cover」與「body 去重的圖」drift，硬規則 5）。
    const hero = (NS && NS.findLeadingHeroImage) ? NS.findLeadingHeroImage(articleEl, base) : null;
    if (hero && hero.url) return hero.url;
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
  //      [rel="author"] / [itemprop="author"] / .byline 等 byline 元素 →
  //      og:site_name 的「刊物名 by 作者」尾段（v0.8.73，最低優先序）。
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
    // 5. og:site_name 的「刊物名 by 作者」格式（v0.8.73）——單人部落格 /
    //    newsletter（Substack / Ghost / 個人 WordPress）常省略文章層級署名，
    //    作者只活在站名裡（Sharp Text by Andrew Sharp / Stratechery by Ben
    //    Thompson / Money Stuff by Matt Levine）。**只在前 4 條正規信號全失敗
    //    才用**（最低優先序 fallback，避免誤蓋有正式 byline 的站）。
    const fromSite = extractAuthorFromSiteName();
    if (fromSite) return fromSite;
    return '';
  }

  // v0.8.73：從 og:site_name 解析「<刊物名> by <作者>」尾段。結構通則、非站點
  // 特判——任何 og:site_name 走同一條 regex。多重 guard 壓低誤判：必須有空白
  // 邊界的「by」（不誤命中 standby / rugby 等）、作者段 2–60 字、含字母、不含
  // URL / @ / 斜線（排除把網址或 handle 當作者）。抓不到回空字串。
  function extractAuthorFromSiteName() {
    const m = document.head && document.head.querySelector('meta[property="og:site_name"]');
    if (!m) return '';
    const site = (m.getAttribute('content') || '').replace(/\s+/g, ' ').trim();
    if (!site) return '';
    const match = site.match(/(?:^|\s)by\s+(.+?)\s*$/i);
    if (!match) return '';
    const name = match[1].trim();
    if (name.length < 2 || name.length > 60) return '';
    if (/[\/@]|https?:/i.test(name)) return '';
    if (!/[A-Za-z一-鿿]/.test(name)) return '';
    return name;
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

  // v0.8.50：title 來源改以 reader card 內第一個可見 <h1> 為主、document.title
  // 為 fallback。動機：document.title 是頁面載入時的靜態 metadata，DOM 後續被
  // 改寫（翻譯擴充原地替換 heading 文字、SPA 換頁）時不會跟著變——使用者在
  // reader card 看到譯後標題、送 Readwise 卻是原文（Jimmy 2026-06-12 回報，
  // Shinkansen 譯後情境）。結構性通則：「使用者看到的主標」單一資料源就是
  // card 內渲染中的 h1，不綁任何翻譯擴充的標記。
  //   - 跳過 cleaner 標記隱藏的 h1（[data-jread-hidden] 自身或子孫——站名
  //     logo h1 類雜訊）
  //   - 用 innerText 取「可見文字」（display:none 子節點不入列）；jsdom 沒
  //     實作 innerText 時退 textContent（僅測試環境會走到）
  //   - 文字過長（> 300 字）視為非標題（detector 誤圈整塊容器時的防線）
  //   - card 內沒 h1（X / FB 合成 reader、無標題頁）→ fallback document.title
  //     並沿用 NS.stripSiteSuffix 去站名尾綴。h1 路徑不做尾綴切割——站名尾綴
  //     是 document.title 的慣例，h1 本文常含合法的「 — 」分隔，切了會截斷標題
  function extractReaderTitle() {
    // v0.8.74：選主標 heading 的邏輯收斂到 NS.findCardTitleHeading（單一資料源
    // + jsdom 可測）。h1 優先、無 h1 時取內文前首個 h2（Stratechery wp-block
    // post-title 是 h2，原本只查 h1 → fallback document.title 送出原文）。
    const fromCard = NS.findCardTitleHeading(NS.state.articleEl);
    if (fromCard) return fromCard;
    const rawTitle = (document.title || '').trim();
    // v0.8.37：站名尾綴切法收斂到 NS.stripSiteSuffix（單一資料源）
    return NS.stripSiteSuffix(rawTitle) || rawTitle;
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
    const title = extractReaderTitle();
    const html = buildCleanHtml(NS.state.articleEl, title);
    const imageUrl = extractHeroImage(NS.state.articleEl);
    const author = extractAuthor();
    const publishedDate = extractPublishedDate();
    // v0.8.72：主文純文字 + domain 供 Gemini 摘要使用（popup / SW 端視
    // readwiseSummary 設定決定是否呼叫）。head-truncate 到 50K 字元——避免極長文
    // 灌爆 message channel；popup-core 端會再依 GEMINI_MAX_CHARS 截一次。
    const rawText = NS.state.articleEl.innerText || NS.state.articleEl.textContent || '';
    const text = rawText.replace(/\n{3,}/g, '\n\n').trim().slice(0, 50000);
    const domain = location.hostname || '';
    // v0.8.138：翻譯頁標記——供 buildReadwisePayload 決定 should_clean_html。
    // 翻譯擴充（Shinkansen）注入的譯文（dual collapse 後留在 body 的 <p> / 就地
    // 譯文）會被 Readwise 的 should_clean_html readability pipeline 當外來節點清掉
    //（reader 端只剩英文原文）；翻譯頁必須關 should_clean_html 原樣保留。偵測在
    // live document（collapse 前），html 字串裡的 data-shinkansen* 已被剝掉、判不了。
    const isTranslated = !!(NS.isTranslatedPage && NS.isTranslatedPage());
    return {
      ok: true,
      payload: {
        url: location.href,
        html,
        title,
        imageUrl,
        author,
        publishedDate,
        text,
        domain,
        isTranslated
      }
    };
  }

  // v0.8.108：編輯模式（手動移除雜訊段落，NS.editMode）的 reader-interaction
  // 暫停 / 還原。編輯模式的 hover / click 與閱讀模式的 keyguard / ESC / space-
  // scroll / paged-mode 互相衝突（capture-phase 鍵盤攔截 + 翻頁鎖捲動）——進
  // 編輯模式前全部暫停，退出時依當前 settings 重新裝回。這些 interaction layer
  // 的生命週期本就住在 main.js，故由 main.js 主導 suspend/restore，edit-mode.js
  // 只負責編輯互動本身、退出時 onExit 回呼通知這裡還原。
  function suspendReaderInteractions() {
    window.removeEventListener('keydown', onEscKey, true);
    uninstallKeyguard();
    if (NS.spaceScroll) NS.spaceScroll.uninstall();
    // 翻頁模式鎖垂直捲動、Space / 方向鍵接管為翻頁，與編輯模式 hover 衝突——
    // 暫時 uninstall，restore 時依 settings 重新 sync（重算頁數）。
    if (NS.pagedMode) NS.pagedMode.uninstall();
  }

  async function restoreReaderInteractions() {
    // 退出編輯模式時 reader mode 可能已被退出（使用者按完成的同時 SPA 導航等）——
    // 守住才還原，否則會對 inactive 狀態裝 listener。
    if (!NS.state.active || NS.state.cinemaActive || !NS.state.articleEl) return;
    const settings = await getSettings();
    window.removeEventListener('keydown', onEscKey, true);
    window.addEventListener('keydown', onEscKey, true);
    syncPagedModeFromSettings(settings);
    syncSpaceScrollFromSettings(settings);
    if (!settings || settings.blockPageShortcuts !== false) installKeyguard();
    else uninstallKeyguard();
  }

  function enterEditMode() {
    if (!NS.state.active || NS.state.cinemaActive || !NS.state.articleEl) {
      return { ok: false, active: false, reason: 'NOT_ACTIVE' };
    }
    if (!NS.editMode) return { ok: false, active: false, reason: 'NO_MODULE' };
    if (NS.editMode.isActive()) return { ok: true, active: true };
    suspendReaderInteractions();
    const ok = NS.editMode.enter(NS.state.articleEl, { onExit: () => { restoreReaderInteractions(); } });
    if (!ok) {
      // enter 失敗（理論上不會）：立即還原 interaction layer，不留半套
      restoreReaderInteractions();
      return { ok: false, active: false, reason: 'ENTER_FAILED' };
    }
    return { ok: true, active: true };
  }

  function exitEditMode() {
    // 使用者主動退出（popup 再點 / 完成 / ESC 已在模組內處理）：exit() 觸發
    // onExit → restoreReaderInteractions。
    if (NS.editMode && NS.editMode.isActive()) NS.editMode.exit();
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
  // v1.0.22：給 reader.html（擴充自有頁）的 reader-app.js 呼叫——自建 container
  // 直接進入閱讀模式，重用 finalizeEnter 全套收尾（styler / positionMemory /
  // keyguard / 模組同步）。
  NS.enterFromContainer = enterFromContainer;

  // v0.7.143：reapply 走 debounce 合併。popup 連點 stepper 字級/版心會觸發多次
  // storage.sync.set → 多次 restore + await getSettings + apply 並發纏繞——
  // originalStyles 可能 snapshot 已套樣式的中間狀態，最後 exit 還原不回原貌。
  // 200ms 對人類連點足夠合併、對「單次調整」無感。
  // v0.8.148：從 storage.onChanged 閉包內搬到模組層——onMessage 的 REAPPLY_SETTINGS
  // handler（iOS onChanged 丟事件的兜底）也要呼叫同一個 scheduleReapply，單一資料源。
  let reapplyTimer = null;
  function scheduleReapply() {
    if (reapplyTimer) clearTimeout(reapplyTimer);
    reapplyTimer = setTimeout(async () => {
      reapplyTimer = null;
      // v0.7.143：cinema mode active 時 articleEl=null，styler.restore null 無意義
      // 且可能 throw；明確 guard 避免誤觸發。reader mode 中途切到 cinema 不該踩。
      if (!NS.state.active || NS.state.cinemaActive) return;
      if (!NS.state.articleEl || !NS.styler) return;
      NS.styler.restore(NS.state.articleEl, NS.state.originalStyles);
      const settings = await getSettings();
      // v0.8.36：await 期間使用者可能已按 ESC 退出 / 切 cinema / SPA 導航
      // 拆卡（exit 是同步的、不被 enterInFlight 擋）——此時 articleEl 已是
      // null，繼續 apply 會注入無主 stylesheet 並在 inactive 狀態下覆寫
      // originalStyles。await 之後必須重跑同一組 guard。
      if (!NS.state.active || NS.state.cinemaActive) return;
      if (!NS.state.articleEl || !NS.styler) return;
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
  }

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === NS.MSG.TOGGLE_READER_MODE) {
      (async () => {
        sendResponse(await toggleReader());
      })();
      return true;
    }

    // v0.8.148：popup commitSave 後送來的「即時重套」訊息——iOS Safari popup 開啟時
    // 底層頁面被掛起、storage.onChanged 廣播被丟掉（桌機 Chrome 無此問題），靠這條
    // 主動訊息補上即時重套。閱讀模式未啟動 / cinema 下 guard no-op（同 onChanged 路徑）。
    // scheduleReapply 200ms debounce 與 onChanged 合併，桌機不會雙重重套。
    if (msg.type === NS.MSG.REAPPLY_SETTINGS) {
      if (NS.state.active && !NS.state.cinemaActive && NS.state.articleEl && NS.styler) {
        scheduleReapply();
      }
      sendResponse({ ok: true });
      return; // 同步回應
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
        // v0.8.108：編輯模式是否啟動——popup 用來切「編輯模式 / 完成編輯」按鈕文字
        editModeActive: !!(NS.editMode && NS.editMode.isActive()),
        // v1.5.1：本頁是否為 reader 自有頁（article feed 閱讀／feed 列表）。popup 用來
        // 隱藏「進入 Reader / 送到 Readwise / 編輯模式」三顆——這些在 Reader 內都是雜訊
        //（已在 Reader、文章本就來自 Readwise、reader 版型無需手動移雜訊）。
        readerHostPage: !!NS.state.readerHostPage,
        siteMode
      });
      return; // sync
    }

    if (msg.type === NS.MSG.EXTRACT_READER_HTML) {
      sendResponse(extractReaderPayload());
      return; // sync
    }

    // v0.8.108：編輯模式 toggle（popup 按鈕觸發）。已啟動 → 退出；未啟動 →
    // 進入（enterEditMode 內 guard 閱讀模式須 active）。
    if (msg.type === NS.MSG.EDIT_MODE_TOGGLE) {
      if (NS.editMode && NS.editMode.isActive()) {
        exitEditMode();
        sendResponse({ ok: true, active: false });
      } else {
        sendResponse(enterEditMode());
      }
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
  if (browser.storage && browser.storage.onChanged) {
    // scheduleReapply 已搬到模組層（v0.8.148，與 onMessage REAPPLY_SETTINGS 共用）。
    browser.storage.onChanged.addListener((changes, area) => {
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
      // v1.5.4：頁碼指示開關已移除（頁碼一律顯示，是翻頁模式唯一進度載體），原本
      // 的即時切換 listener 連同設定一併刪除。
      // v0.8.40：閱讀位置記憶效期即時切換——改成 0 停止當前追蹤；0 → 正值
      // 下次進入閱讀模式生效（當前 session 不回溯補追蹤）。
      if ('positionMemoryDays' in changes && NS.positionMemory) {
        NS.positionMemory.setDays(changes.positionMemoryDays.newValue);
      }
      // v0.7.143：cinema mode active 時不走 styler reapply 路徑（articleEl=null）
      if (NS.state.cinemaActive) return;
      if (!NS.state.articleEl || !NS.styler) return;
      // v0.7.227：pagedMode 走 reapply 路徑——CSS 注入/移除需要 styler 重建
      // stylesheet，模組 install/uninstall 在 scheduleReapply 尾端同步
      const relevantKeys = ['theme', 'fontSize', 'contentWidth', 'fontFamily', 'latinSerif', 'latinSans', 'fontWeight', 'lineHeight', 'paragraphSpacing', 'pangu', 'pagedMode'];
      const hasRelevant = relevantKeys.some(k => k in changes);
      if (!hasRelevant) return;
      scheduleReapply();
    });
  }

  // v0.8.164：頁面恢復（pageshow / 由隱藏轉可見）重讀 storage 重套設定——iOS
  // 訊息不可靠的結構性兜底，與 browser.* Promise 遷移互補。
  //
  // 根因（memory project_ios_popup_suspends_page_onchanged_dropped）：iOS Safari
  // popup 開啟時底層頁面 JS 被掛起，期間的 storage.onChanged 廣播被「丟掉」（不排隊、
  // 不補送）；popup 內改字級 / 主題其實已持久化到 storage.sync.set，但 content 收不到
  // 變更事件→不重套，使用者要重整網頁才生效（= Jimmy 回報「popup 套設定字體 +/- 沒
  // 反應」的直接根因）。popup commitSave 後主動送的 REAPPLY_SETTINGS（v0.8.148）是第一道
  // 兜底，但 iOS 偶發回收整個擴充訊息層時連那發也會掉。
  //
  // 本層是「不依賴任何訊息送達」的最終兜底：頁面恢復可見時，content 自己重讀 storage
  // （scheduleReapply 內 await getSettings 直讀 browser.storage.sync）重套——只要使用者
  // 在 popup 改過設定（已落 storage），回到頁面就一定看到最新版型。閱讀模式未啟動 /
  // cinema 由 scheduleReapply 內 guard no-op；桌機 Chrome 頁面不掛起、onChanged 照收，
  // 此處只是冪等重套（200ms debounce 與 onChanged 合併，無重複套用）。
  function reapplyFromStorageOnResume() {
    if (!NS.state.active || NS.state.cinemaActive || !NS.state.articleEl || !NS.styler) return;
    scheduleReapply();
  }
  // pageshow：bfcache 還原（e.persisted=true）與一般導航顯示都涵蓋；不分 persisted，
  // guard 在 reapplyFromStorageOnResume 內。
  window.addEventListener('pageshow', () => reapplyFromStorageOnResume());
  // visibilitychange → visible：popup 收合 / 切回分頁時底層頁恢復的主訊號（iOS popup
  // 掛起底層頁，收合即觸發 visible）。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reapplyFromStorageOnResume();
  });

  // Page-world debug bridge：允許 main-world JS（chrome-in-chrome MCP /
  // devtools console）透過 dispatchEvent 觸發 reader mode toggle、reload
  // extension、查詢狀態。content script 在 isolated world、page main world
  // 無法直接呼叫；DOM event 跨 world 廣播，是合法的單向 page→isolated 通道。
  // 用法（page world）：
  //   window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'toggle' } }));
  //   window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'enter' } }));
  //   window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'exit' } }));
  //   window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'set-theme', theme: 'dark' } }));  // 'light' | 'dark' | 'sepia' | 'gray'
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
      // v0.8.36 安全 hardening：改經 SW 中繼 + development install gate（與
      // reload 同款防護）。舊版 content 直寫 storage.sync——任意網頁 JS 可
      // dispatch 本 event 改寫使用者 theme（sync 會同步到所有裝置）。Store /
      // 正式安裝一律拒絕；unpacked（Claude 自主 debug / cage）照常可用。
      const theme = e && e.detail && e.detail.theme;
      if (theme && ['light', 'dark', 'sepia', 'gray'].includes(theme)) {
        safeSendMessage({ type: NS.MSG.JREAD_DEBUG_SET_THEME, payload: { theme } });
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
      safeSendMessage({ type: NS.MSG.JREAD_RELOAD });
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
  // 擴充自有頁的 origin 是揮發性的：iOS Safari 的 `safari-web-extension://<UUID>/`
  // host 每次 Safari 重啟換一組新 UUID（2026-06-28 模擬器實證：terminate→relaunch
  // base URL 由 2F7E8BA1… 變 F78F88DC…；磁碟上 readingPositions 的 Article View
  // 記錄散落在多組死 UUID host 下）。位置記憶 key 若含這段 origin，重啟後同一篇
  // JReader Article View（reader/article.html?id=<docId>）就變成新 key、上次存的
  // 記錄變孤兒 → 強制關閉 Safari 後回不到上次頁碼（options 診斷顯示 found=否、但
  // 磁碟筆數沒少＝資料在、key 對不上）。對擴充自有頁改用「path+search(+hash)」當
  // 穩定身分（docId 在 search、跨 UUID 不變）；http(s) 一般網頁 origin 有意義（區
  // 分站點）必須保留。結構性通則（描述 URL scheme 結構、非站點特判）。
  function stripVolatileExtensionOrigin(href) {
    try {
      const u = new URL(href);
      if (u.protocol === 'safari-web-extension:' || u.protocol === 'chrome-extension:' || u.protocol === 'moz-extension:') {
        return u.pathname + u.search + u.hash;
      }
    } catch (_) {}
    return href;
  }

  function spaRouteKey(href) {
    href = stripVolatileExtensionOrigin(href);
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
    // v0.8.45：URL 變了 ≠ 真導航——先驗 DOM 事實。無限捲動站（thenewslens
    // 實證）preload 下一篇 + 依「視口目前在哪篇」replaceState 切 URL 與
    // title；進入 reader mode 的瞬間 cleaner / styler 讓頁面高度劇變，站方
    // 視口判定被觸發、URL 被切到下一篇 → 舊版把這當真導航 exit → 還原原頁
    // → 站方又把 URL 切回 → 再觸發本 handler……reader mode 永遠掛不穩
    // （cage instrument 抓到 exit stack 源頭就是本 handler、當時 href 已是
    // 下一篇）。判別是結構性的：真 SPA 導航會把舊路由的 DOM 拆掉重建——
    // articleEl 必然 disconnected；無限捲動的 URL 同步不動原文章 DOM——
    // articleEl 仍連在文件上。還連著就保持 reader mode、只更新 _spaLastUrl。
    // cinema 模式 articleEl 為 null，自然走原 exit 路徑（YouTube SPA 導航
    // 行為不變）。
    if (NS.state.active && NS.state.articleEl && NS.state.articleEl.isConnected) return;
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
