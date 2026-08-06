// JRead — 翻頁模式（v0.7.227）
//
// 電子書式水平翻頁：CSS 端（styler.js pagedMode 區塊）把 reader card 變成
// fixed 滿版 multi-column 容器（column-width: 版心寬 + column-fill: auto +
// 高度約束 → 溢出內容自動長出等寬水平 overflow column = 頁；v0.7.230 起
// 不可用 column-count: 1——WebKit 對 count=1 不建 fragmentation context、
// scrollWidth 不含 overflow columns，翻頁全滅，詳見 styler.js 註解）；
// 本模組負責行為層：
//
//   - 左右滑動翻頁（touch swipe；起點避開螢幕左右邊緣 EDGE_GUARD_PX，
//     防 iOS Safari 邊緣滑動 = 瀏覽歷史手勢的誤觸）
//   - 鍵盤翻頁：← / PageUp / Shift+Space = 上一頁；→ / PageDown / Space =
//     下一頁；Home / End = 首頁 / 末頁
//   - 滾輪 / 觸控板翻頁（水平或垂直 delta 累積過門檻，含慣性尾巴鎖定）
//   - 頁碼指示（#__jread-page-indicator，底部置中「3 / 43」）= 翻頁模式唯一的
//     進度載體。v1.5.2 起不再驅動 styler 的頂端閱讀進度條（重複功能，
//     styler 端依 opts.pagedMode gate 不注入）
//   - 頁碼 scrubber（v0.8.150）：按住頁碼指示器水平拖曳即時跳頁（快速捲動）。
//     拖曳走完 viewport 寬 = 涵蓋全部頁範圍（小空間大跳幅）；touch 走 window
//     touch 管線（起點命中指示器 → 進 scrub、不另判翻頁 swipe），桌面滑鼠走
//     指示器 mousedown + window mousemove/up；指示器在 styler 設 pointer-events:
//     auto + touch-action:none 才接得到事件。**v0.8.151**：(a) 按住起拖時出現
//     scrub 進度條（#__jread-scrub-track，fill 寬 = 目前頁占全文比例、放手淡出）；
//     (b) 每跨一頁觸發觸覺回饋（triggerHaptic：navigator.vibrate 優先，iOS Safari
//     不支援 vibrate → iOS 17.4+ switch checkbox haptic 的 label.click() hack）。
//     **v0.8.152**：靈敏度——每頁拖曳距離上限 14px（少頁文章不必拖很遠）；觸覺載體
//     改移出畫面外但維持渲染（原 1px 夾掉可能不渲染、觸覺不發）
//     **v0.8.166（tap-to-arm 互動，觸控）**：頁碼點按（down→up 未拖移）切換 armed
//     模式——進度條常駐、整個畫面變成 scrub 面：
//       1. 按住頁碼「拖移」→ 短暫 scrub 翻頁（放手收起進度條，= 原 v0.8.150 行為）
//       2. 點按頁碼「放開」→ 展開常駐進度條，此後畫面任意處左右滑 = scrub 翻頁；
//          再次點頁碼（或任意處點按）= 收起進度條退出 armed
//       3. armed 中任意處點按（無拖移）= 收起進度條
//     tap/drag 由 TAP_SLOP_PX 位移門檻分流；狀態機純邏輯在 resolveScrubGesture
//     （jsdom spec 直接測），DOM 端 finishScrubGesture 套用。桌面滑鼠維持短暫 drag
//     scrub（無 armed——「畫面任意處滑」是觸控專屬手勢）。
//   - resize / 旋轉時重算頁數、保持目前閱讀比例位置
//
// stride 恆等式：styler CSS 設 column-gap = 左右視覺內距和（左 padding +
// 右 transparent border），因此「column 寬 + gap = stride」，翻到第 n 頁 =
// scrollLeft 跳 n × stride。v0.8.56 起 stride 真值以 max scrollLeft 格點
// 量化取得（maxSL = (頁數−1) × stride 恆等式反推）——computed style 推導
// 的近似值在 fractional px 環境每頁有 sub-px 誤差（iOS border snap 至 1/3px
// 格 + clientWidth 整數截斷），多頁累積成可見的整欄右移（chinatalk 64 頁
// 累積 21px、右緣文字被裁切），近似公式只作量化起點與退化 fallback。
//
// 頁數（v0.7.231）：不可信 scrollWidth——正式版 Safari 26.5 的 multicol
// scrollable overflow 會多報一個無內容的幽靈欄（chinatalk 實測 25 欄內容
// 報 26 欄寬），round(scrollWidth / stride) 多算一頁，翻到幽靈頁時
// scrollLeft 被 clamp 在非格點位置 → Safari 把最後一欄重畫在錯位的位置
// （= Jimmy 回報「最後一頁版面寬度沒尊重設定」的根因之二；之一是尾端
// padding 不算進 overflow，styler 端已用 border 修）。改量**實際內容末端**
// 落在第幾欄：最後幾個非空 text node 的 Range rect（line box 按 fragment
// 正確回報；element.getBoundingClientRect 對跨欄 block 回 as-if-unfragmented
// 聯集、兩引擎都會超出實際 layout，不可用）+ 替換元素（img 等，atomic
// fragment，bounding rect 可靠）取 max。Safari 對「已捲動狀態下的 overflow
// column fragment rect」回報會偏移，量測前強制 scrollLeft = 0、量完還原
// （同一 frame 內同步讀寫不觸發 repaint，使用者無感）。scrollWidth 公式
// 保留作 fallback（jsdom / Range rect 全 0 的退化環境）。
//
// 與既有機能的相容（main.js 端 wiring）：
//   - Space 段落卷動（space-scroll.js）在翻頁模式下停用——文件不可垂直卷動，
//     Space 改為翻下一頁（行為由本模組 keydown 接手）
//   - keydown listener 必須先於 keyguard 註冊（keyguard 對非 ESC 鍵
//     stopImmediatePropagation；同 phase listener 按註冊順序執行），
//     main.js 的 syncPagedModeFromSettings 比照 space-scroll 處理重掛順序
//   - ESC 退出不受影響（本模組不攔 Escape；onEscKey 註冊更早）
//   - 3 指輕點 toggle 不受影響（本模組只認單指 swipe）
//
// 跨環境匯出：content script 走 NS.pagedMode；純邏輯（swipe 判定 / 鍵盤
// 對映 / 頁數計算）走 module.exports 給 jsdom regression spec（spec 餵純
// 物件，不碰 TouchEvent / layout）。
(function (global) {
  'use strict';

  const INDICATOR_ID = '__jread-page-indicator';
  const SCRUB_TRACK_ID = '__jread-scrub-track'; // v0.8.151 scrub 進度條容器
  const SCRUB_FILL_ID = '__jread-scrub-fill';   // 進度條 fill（寬 = 目前頁占比）
  const HAPTIC_ID = '__jread-haptic';            // v0.8.151 iOS 觸覺載體（switch checkbox）
  // v1.5.2：翻頁模式不再驅動頂端閱讀進度條（重複功能，styler 端依 opts.pagedMode
  // gate 不注入）；該進度條生命週期單一資料源回歸 styler.js，本模組完全不碰。

  // swipe 判定參數（結構性，不綁平台）
  const SWIPE_MIN_DX = 48;          // 水平位移門檻（px）
  const SWIPE_AXIS_RATIO = 1.4;     // |dx| 必須 > |dy| × ratio（軸向支配）
  // v0.7.239：整頁可滑（Jimmy 回報「翻頁只在中間生效、太不靈敏」）。原本 28px
  // 邊緣緩衝是為閃避 iOS Safari 左邊緣返回手勢，但真機實證「左邊緣往右滑不會
  // 返回、只是滑不動」——擋返回已由 onTouchMove 水平 preventDefault（v0.7.237）+
  // 卡片 touch-action（page1 pan-y / page2+ none，原生水平 pan 一律不放行）雙重
  // 覆蓋，邊緣緩衝是多餘的 belt、反而害整頁邊緣翻不了頁。設 0 = 全頁起手都認。
  const EDGE_GUARD_PX = 0;
  const WHEEL_THRESHOLD = 90;       // 滾輪 delta 累積門檻
  const WHEEL_LOCKOUT_MS = 550;     // 翻頁後滾輪鎖定（吃掉觸控板慣性尾巴）
  const TURN_ANIM_MS = 260;         // 翻頁動畫時長
  const HMOVE_BLOCK_PX = 6;         // v0.7.237：水平位移超此值即 preventDefault（擋 Safari 邊緣返回手勢）
  const SETTLE_LOCK_MS = 250;       // v0.7.245：捲動停止判定（此毫秒內無 scroll = 捲軸消失 = 已停止）
  const SETTLE_LOCK_MIN_SY = 2;     // v0.7.245：停止時 scrollY 超此值（已捲離頂端 = 已收合）才鎖
  // v0.8.152：scrub 每頁拖曳距離上限（px）。原本「全寬均分」讓 few-page 文章每頁要
  // 拖很遠（3 頁 → 半個螢幕才換一頁，Jimmy 回報「相當不靈敏」）；改成「全寬均分」與
  // 此上限取小——少頁文章維持 14px/頁的靈敏度、多頁文章（均分 < 14）仍維持拖滿全寬
  // ≈ 走完全文。
  const SCRUB_MAX_PX_PER_PAGE = 14;
  // v0.8.166：tap（點按）vs drag（拖移）的位移門檻（px）。手指起手後位移未超此值
  // = tap（觸發 armed 模式切換），超過 = drag（即時 scrub 翻頁）。取 6（= HMOVE_BLOCK_PX）：
  // 比「scrub 跨一頁所需最小位移」（perPage/2 ≥ 7px）略小，確保任何實際翻頁都已先判為 drag。
  const TAP_SLOP_PX = 6;

  // ---- 純邏輯（jsdom spec 直接測）----

  // 頁數 fallback：scrollWidth ≈ N × stride + padding − gap（兩引擎的尾端
  // 計入差異都在 ±stride/2 內），round 兜偏差；guard 退化輸入回 1。
  // 注意正式版 Safari 的幽靈欄會讓本公式多算一頁——正常路徑用
  // computePageCountFromExtent（量實際內容末端），本公式只在量不到
  // （jsdom / 空文章）時兜底。
  function computePageCount(scrollWidth, stride) {
    if (!(stride > 0) || !(scrollWidth > 0)) return 1;
    return Math.max(1, Math.round(scrollWidth / stride));
  }

  // 頁數主路徑：內容末端（相對 padding-box 卷動座標的右緣）落在第幾欄。
  // contentEndX 已含 padding-left 起手；第 k 欄（0-based）涵蓋
  // (padLeft + k×stride, padLeft + k×stride + columnWidth]，
  // ceil((contentEndX − padLeft) / stride) = k + 1 = 頁數。
  function computePageCountFromExtent(contentEndX, padLeft, stride) {
    if (!(stride > 0)) return 1;
    const x = contentEndX - (padLeft > 0 ? padLeft : 0);
    if (!(x > 0)) return 1;
    return Math.max(1, Math.ceil(x / stride));
  }

  // stride 格點量化（v0.8.56）：依 styler 的 border-right 設計（v0.7.231），
  // 「max scrollLeft = (頁數 − 1) × 引擎實際 stride」在兩引擎恆成立——border
  // 不參與 scrollable overflow、尾端 padding 為 0。從 computed style 推導的
  // 近似 stride 在 fractional px 環境不可靠：iOS WebKit 把 border-width snap
  // 到裝置像素格（DPR 3 → 16.948px 用值變 16.6667px）且 clientWidth 整數
  // 截斷，每頁誤差 0.333px、64 頁累積 21px → 內容右移、右緣裁切（chinatalk
  // iPhone 模擬器 instrument 實證：引擎 stride 402.28 vs 公式 401.948）。
  // 量化 = maxScrollLeft / round(maxScrollLeft / 近似值)：格數 k 是整數，
  // 近似值相對誤差 < 0.5/k 內都收斂到引擎真值，誤差不再隨頁數累積。
  // 近似值不足 maxSL 半格（單頁 / 量不到）時退回近似值。
  function quantizeStride(maxScrollLeft, approx) {
    if (!(approx > 0) || !(maxScrollLeft > approx / 2)) return approx;
    const k = Math.max(1, Math.round(maxScrollLeft / approx));
    return maxScrollLeft / k;
  }

  // v0.8.150：頁碼指示器當 scrubber——按住頁碼水平拖曳即時跳頁（快速捲動）。
  // 純邏輯：給定起拖時的頁碼 startIdx、本次水平拖曳位移 dx、scrub 寬度
  // scrubWidth（install 時取 viewport 寬）、總頁數 total，回傳目標頁（clamp 0..total-1）。
  //   - 往右拖（dx 正）→ 後面的頁；往左拖（dx 負）→ 前面的頁（slider 直覺，
  //     與左滑翻下一頁的 swipe 方向相反——scrubber 是「把進度條往右拉 = 往後」）。
  //   - v0.8.152 靈敏度：每頁拖曳距離 = min(全寬均分, SCRUB_MAX_PX_PER_PAGE)。原本
  //     純「全寬均分」（scrubWidth/(total-1)）讓 few-page 文章每頁要拖很遠（3 頁 →
  //     ~半個螢幕，Jimmy 回報不靈敏）；上限讓少頁文章維持 14px/頁靈敏，多頁文章
  //     （均分 < 14px）仍維持拖滿全寬 ≈ 走完全文。total <= 1 / 退化輸入 → 回 startIdx。
  function computeScrubTarget(startIdx, dx, scrubWidth, total) {
    const t = total > 0 ? total : 1;
    const base = Math.max(0, Math.min(t - 1, startIdx || 0));
    if (!(t > 1) || !(scrubWidth > 0) || !isFinite(dx)) return base;
    const perPage = Math.min(SCRUB_MAX_PX_PER_PAGE, scrubWidth / (t - 1));
    const n = Math.round(base + dx / perPage);
    return Math.max(0, Math.min(t - 1, n));
  }

  // v1.6.8：退出捲回——fragment rect 左緣 → 頁碼。colStart = 第 0 欄內容左緣
  // 的 viewport x（art rect.left + border-left + padding-left，scrollLeft=0 時量）。
  // +2px epsilon 兜 sub-pixel 抖動（欄左緣理論上恰為 k×stride，浮點誤差可能
  // 落在 k×stride − ε）。line box 永不落在 column-gap 內，floor 即正確欄號。
  function pageOfLeft(left, colStart, stride, total) {
    const t = total > 0 ? total : 1;
    if (!(stride > 0)) return 0;
    return Math.max(0, Math.min(t - 1, Math.floor((left - colStart + 2) / stride)));
  }

  // v1.6.8：一個節點的 fragment rects → 頁碼覆蓋區間 { min, max }；無可見
  // fragment（rect 全 0 = 隱藏節點 / jsdom 無 layout）回 null。輸入 rect-like
  // 陣列（{ left, width, height }），純函式給 jsdom spec 直接測。
  // 為什麼用 per-fragment rect：element.getBoundingClientRect() 對跨欄 block
  // 回 as-if-unfragmented 聯集（左緣落在起始欄），PENDING_REGRESSION 三個舊法
  // 失準的共同根因；Range.getClientRects() 的 line box 按 fragment 正確回報
  //（v0.7.231 頁數計算同款量法，兩引擎實證可靠）。
  function fragmentPageCoverage(rects, colStart, stride, total) {
    let min = Infinity, max = -Infinity;
    for (const r of rects) {
      if (!(r.width > 0) || !(r.height > 0)) continue;
      const p = pageOfLeft(r.left, colStart, stride, total);
      if (p < min) min = p;
      if (p > max) max = p;
    }
    return min === Infinity ? null : { min, max };
  }

  // v0.8.166：頁碼 scrubber 互動狀態機（tap-to-arm）。一次手勢（touchstart→touchend）
  // 結束時，依「目前是否 armed」與「本次手勢有無拖移（moved）」決定下一步動作：
  //   - 非 armed + 點按（!moved）→ 'arm'：展開常駐進度條，進 armed 模式
  //   - 非 armed + 拖移（moved）  → 'end'：本次是「按住頁碼拖曳翻頁」的短暫 scrub，放手收起進度條
  //   - armed   + 拖移（moved）  → 'keep'：本次是「畫面任意處左右滑翻頁」的 scrub，維持 armed、進度條續留
  //   - armed   + 點按（!moved）→ 'disarm'：收起進度條、退出 armed（含「再次點頁碼」與「任意處點按」）
  // 純函式（jsdom spec 直接測）——DOM 端 finishScrubGesture 依此回傳值套用 setArmed / hideScrubTrack。
  function resolveScrubGesture(armed, moved) {
    if (armed) return moved ? 'keep' : 'disarm';
    return moved ? 'end' : 'arm';
  }

  // swipe 手勢分類。輸入純物件 { dx, dy, startX, viewportW }：
  //   dx/dy = touchend − touchstart 位移；startX = 起點 clientX。
  // 回傳 'next'（往左滑 = 翻下一頁）/ 'prev' / null。
  function classifySwipe(g, opts) {
    const o = opts || {};
    const minDx = o.minDx || SWIPE_MIN_DX;
    const axisRatio = o.axisRatio || SWIPE_AXIS_RATIO;
    const edgeGuard = o.edgeGuardPx !== undefined ? o.edgeGuardPx : EDGE_GUARD_PX;
    if (!g) return null;
    // 邊緣起手 = 可能是瀏覽器歷史手勢，讓位
    if (g.startX < edgeGuard || g.startX > g.viewportW - edgeGuard) return null;
    if (Math.abs(g.dx) < minDx) return null;
    if (Math.abs(g.dx) < Math.abs(g.dy) * axisRatio) return null;
    return g.dx < 0 ? 'next' : 'prev';
  }

  // 鍵盤對映。輸入 event-like { key, code, shiftKey, altKey, ctrlKey, metaKey }。
  // 回傳 'next' / 'prev' / 'first' / 'last' / null。
  function classifyKey(e) {
    if (!e || e.altKey || e.ctrlKey || e.metaKey) return null;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown') return 'next';
    if (k === 'ArrowLeft' || k === 'PageUp') return 'prev';
    if (k === ' ' || e.code === 'Space') return e.shiftKey ? 'prev' : 'next';
    if (k === 'Home') return 'first';
    if (k === 'End') return 'last';
    return null;
  }

  // ---- DOM 模組 ----

  let installed = false;
  let art = null;
  let idx = 0;
  let lastRatio = 0;        // uninstall 後保留，styler reapply 重掛時回到原比例
  let savedScrollY = 0;     // 進翻頁模式前的文件卷動位置，退出還原
  let indicatorEl = null;
  let animFrame = null;
  let resizeRaf = 0;        // v0.8.17：onResize debounce 的 pending rAF handle
  let wheelAccum = 0;
  let wheelLockUntil = 0;
  let touchState = null;    // { startX, startY, multi }
  // v0.8.150：頁碼 scrubber 拖曳狀態。{ startX, startIdx, scrubWidth }；非 null =
  // 正在拖頁碼快速捲動（與 touchState swipe 互斥——拖頁碼時不另判翻頁 swipe）。
  let scrubState = null;
  // v0.8.166：armed 模式（頁碼點按後常駐進度條）。true = 進度條常駐、畫面任意處左右滑
  // 即 scrub 翻頁、任意處點按收起。與 scrubState 正交：scrubState 是「當下有手指在拖」、
  // scrubArmed 是「進度條常駐的模式旗標」。
  let scrubArmed = false;
  let mouseScrubBound = false; // 桌面滑鼠 scrub 的 window mousemove/up 是否已掛
  let scrubTrackEl = null;     // v0.8.151 scrub 進度條容器
  let scrubFillEl = null;      // v0.8.151 scrub 進度條 fill
  let hapticEl = null;         // v0.8.151 iOS 觸覺載體（switch checkbox）
  let remeasureTimers = [];
  // v1.6.15：內容驅動重測（lazy-load 圖片修法）。固定 [1000,3000] 計時器只在進場
  // 前 3 秒重算頁數——沒預留 width/height 的 lazy 圖若 3s 後才載完撐高，內容末端
  // 右移但頁數停在舊值，goTo/End clamp 在 stale pageCount → 後段內容留在水平溢出
  // 區外翻不到（probe 實證：注入 3s 後才變長的內容，End 差整整一欄翻不到）。改法：
  //   (a) 進場時把 loading="lazy" 的圖強制 eager，讓水平溢出的圖也即時載入（iOS
  //       WebKit 對 offscreen 欄的 lazy 圖延遲更兇；Chromium 實測仍會漸進載入但
  //       eager 讓內容更快穩定）；uninstall 還原。
  //   (b) 卡片掛 capture 的 load 監聽（img load 事件不 bubble，capture 仍達祖先），
  //       任何後代 img/video/iframe 載入 → debounce 重測。scrollWidth 沒變則跳過
  //       （reserved-dimension 站省成本）。涵蓋整個閱讀期間，不只前 3 秒。
  let onDescendantLoadBound = null;   // 卡片 capture load 監聽（uninstall 移除）
  let eagerForced = [];               // 進場強制 eager 的圖 [{ img, prev }]，uninstall 還原
  let eagerForcedSeen = new WeakSet(); // v1.7.43：同圖去重——lazy loader 反覆把 loading 改回 lazy 時，observer 每次再強制 eager 不重複累積 entry（無上限成長）
  let mediaObserver = null;           // v1.6.16：盯 art 子樹、晚到/被改回 lazy 的圖即時強制 eager
  let unclipForced = [];              // v1.7.46：翻頁期間強制 overflow:visible 的高 scroll container，uninstall 還原
  let unclipForcedSeen = new WeakSet(); // 同元素去重——remeasure 重掃時不重複累積 entry
  let remeasureDebounce = 0;          // debounce timer handle
  let lastScrollWidth = 0;            // 上次重測時的 scrollWidth（變動偵測 gate）
  let measuredPages = 0;    // 內容末端實測頁數；0 = 量不到（fallback scrollWidth 公式）
  // v1.5.4：底部頁碼指示器一律顯示——翻頁模式拿掉頂端進度條（v1.5.2）後它是唯一
  // 進度載體，無理由讓使用者關掉。原 showPageNumber 開關 + setShowIndicator 已移除。
  let relocatedTitle = null; // v1.0.2：翻頁模式期間暫時移進 articleEl 的翻譯頁外置標題（uninstall 時移回）
  // v0.7.245：第一頁「捲動停止後」鎖死垂直卷動（Jimmy 要保留「捲軸消失後可鎖住」）。
  // 與 v0.7.240→243 已撤回的鎖不同：觸發點是「捲動完全停止（debounce）」、不是捲動中
  // ——在慣性中設 touch-action:none 會害捲動彈回頂端 + 工具列重展開（真機 instrument
  // 實證）；等停止才鎖無慣性可打斷、不彈回。配 styler 的 101vh（範圍極小、停止快），
  // 收合後幾乎立刻鎖、左右滑乾淨（真機驗過鎖得住、工具列維持收合）。
  let vLocked = false;
  let settleTimer = null;
  // v1.6.8：退出捲回 handoff——captureExitAnchor 成功抓到 anchor 時設 true，
  // uninstall 據此跳過 savedScrollY 的 rAF 還原（否則該 rAF 晚於 main.js
  // applyExitScrollAnchor 的同步捲動、會把 anchor 位置蓋回進場前位置）。
  // settings reapply 的 uninstall→install 不經 capture，旗標恆 false 不受影響。
  let exitAnchorHandoff = false;

  // stride = column 寬 + gap = (content box 寬) + column-gap。
  // v0.8.56：寬度改用 getBoundingClientRect().width（分數精度）減 computed
  // padding / border——不可用整數 clientWidth（iOS 上 border snap 到 1/3px 格
  // 後 content+padding 寬非整數，clientWidth 截斷讓 stride 每頁短 0.333px、
  // 累積成「越後頁越靠右、右緣裁切」）。rect 量不到（jsdom 無 layout）時
  // 退回 clientWidth 公式（舊恆等式，jsdom spec 環境夠用）。
  function strideApprox() {
    if (!art) return 0;
    try {
      const cs = getComputedStyle(art);
      const padL = parseFloat(cs.paddingLeft);
      const padR = parseFloat(cs.paddingRight);
      const bL = parseFloat(cs.borderLeftWidth) || 0;
      const bR = parseFloat(cs.borderRightWidth) || 0;
      const gap = parseFloat(cs.columnGap);
      const rectW = art.getBoundingClientRect().width;
      let s = rectW - padL - padR - bL - bR + gap;
      if (isFinite(s) && s > 0) return s;
      s = art.clientWidth - padL - padR + gap;
      if (isFinite(s) && s > 0) return s;
    } catch (e) { /* 退化環境 */ }
    return art.clientWidth;
  }

  // 量化後 stride 快取；0 = 尚未量（install / remeasure 時重算）。computed
  // border 用值在 iOS 兩次讀值都不一致（16.948 vs 16.6667），近似公式只當
  // 量化起點，格點真值一律以 max scrollLeft 反推。
  let strideExact = 0;

  function stride() {
    if (!art) return 0;
    return strideExact > 0 ? strideExact : strideApprox();
  }

  // 實測 max scrollLeft（同一 frame 同步寫讀還原，無 repaint）。jsdom 無
  // clamp 會原值讀回 sentinel → 視為量不到回 0。
  const MAX_SCROLL_PROBE = 1e7;
  function measureMaxScrollLeft() {
    if (!art) return 0;
    const prev = art.scrollLeft;
    let max = 0;
    try {
      art.scrollLeft = MAX_SCROLL_PROBE;
      max = art.scrollLeft;
      art.scrollLeft = prev;
    } catch (e) { return 0; }
    return max >= MAX_SCROLL_PROBE ? 0 : max;
  }

  // 內容末端在卷動座標（padding-box 原點）的最大右緣。Safari 對已捲動狀態
  // 的 overflow column fragment rect 回報會偏移——強制 scrollLeft = 0 量測、
  // 量完還原（同一 frame 同步讀寫，無 repaint）。回 0 = 量不到。
  function measureContentEndX() {
    if (!art) return 0;
    const prev = art.scrollLeft;
    let maxRight = 0;
    try {
      art.scrollLeft = 0;
      const base = art.getBoundingClientRect().left;
      // 最後幾個非空 text node 的 line box（從文末往回找，跳過被 cleaner
      // 隱藏的 rect 全 0 節點；取 max 而非只看最後一個——文末可能是隱藏雜訊）
      const walker = document.createTreeWalker(art, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue && node.nodeValue.trim()) textNodes.push(node);
      }
      let hits = 0;
      for (let i = textNodes.length - 1; i >= 0 && hits < 10; i--) {
        const range = document.createRange();
        range.selectNodeContents(textNodes[i]);
        let any = false;
        for (const r of range.getClientRects()) {
          if (r.width > 0) {
            any = true;
            maxRight = Math.max(maxRight, r.right - base);
          }
        }
        if (any) hits++;
      }
      // 替換元素是 atomic fragment、bounding rect 可靠（文末是圖片的文章靠這層）
      for (const el of art.querySelectorAll('img, video, iframe, svg')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) maxRight = Math.max(maxRight, r.right - base);
      }
    } catch (e) {
      maxRight = 0; // jsdom 等無 Range rect 環境 → fallback
    }
    art.scrollLeft = prev;
    return maxRight;
  }

  // 重算實測頁數（install / resize / lazy-load remeasure 時呼叫）。
  // v0.8.56：先重算量化 stride（layout 可能變了），頁數計算與後續 goTo 的
  // 格點跳頁都用同一個引擎真值。
  function remeasurePages() {
    if (!art) { measuredPages = 0; strideExact = 0; return; }
    strideExact = 0; // 先清，strideApprox 才會被重新讀取
    strideExact = quantizeStride(measureMaxScrollLeft(), strideApprox());
    const endX = measureContentEndX();
    if (!(endX > 0)) { measuredPages = 0; return; }
    let padL = 0;
    try { padL = parseFloat(getComputedStyle(art).paddingLeft) || 0; } catch (e) { /* */ }
    measuredPages = computePageCountFromExtent(endX, padL, stride());
  }

  // v1.6.15：重測頁數並和目前狀態對齊——刷新頁碼指示文字；若目前頁碼已超過新頁數
  // （內容縮水）clamp 回最後一頁，不然停在幽靈位置。內容驅動重測與固定計時器共用。
  function remeasureAndReconcile() {
    if (!installed || !art) return;
    // v1.7.46：晚載入內容可能讓 scroll container 事後長高過一頁（lazy 圖撐高），
    // 重測前補掃一輪
    unclipTallScrollContainers();
    remeasurePages();
    try { lastScrollWidth = art.scrollWidth; } catch (e) { /* */ }
    const t = pageCount();
    if (idx > t - 1) goTo(t - 1, false);
    else renderIndicator();
  }

  // v1.6.15：後代媒體載入 → debounce 重測。scrollWidth 未變則跳過（reserved-
  // dimension 站圖片載入不撐 layout、無需重算，省 measureContentEndX 的 treewalker
  // 成本）。trailing debounce：一批同時載入的圖只重測一次，晚到的圖各自再觸發。
  function scheduleRemeasure() {
    if (remeasureDebounce) clearTimeout(remeasureDebounce);
    remeasureDebounce = setTimeout(function () {
      remeasureDebounce = 0;
      if (!installed || !art) return;
      let sw = 0;
      try { sw = art.scrollWidth; } catch (e) { /* */ }
      if (sw === lastScrollWidth) return; // 內容末端沒變（多為 reserved 尺寸圖）→ 不重算
      remeasureAndReconcile();
    }, 180);
  }

  // capture load 監聽 handler：img load 事件不 bubble，但 capture phase 仍會在
  // 祖先觸發（非 bubbling 事件的 capture 監聽照樣跑）——一條卡片層 delegated 監聽
  // 即涵蓋所有後代圖，不必逐圖掛 listener。
  function onDescendantLoad(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'IFRAME') scheduleRemeasure();
  }

  // v1.6.15：進場把 loading="lazy" 的圖強制 eager——水平多欄溢出把後段圖推到畫面
  // 右側外，原生 lazy 判定「不在視窗附近」會延遲（iOS WebKit 尤甚）載入，內容末端
  // 遲遲不穩。強制 eager 讓所有圖即時載入；記錄原值 uninstall 還原（退回捲動模式後
  // lazy 仍是合理的效能預設）。結構性通則、不綁站點。
  // v1.6.16：單圖 helper——供進場掃描與 MutationObserver 共用。只動 loading="lazy"
  // 的圖（設成 eager 後不再是 lazy → observer 再看到不會重觸發、無無限迴圈）。
  function forceEagerImg(img) {
    try {
      if (!img || !img.getAttribute) return;
      if ((img.getAttribute('loading') || '').toLowerCase() === 'lazy') {
        // v1.7.43：只記第一次的原值（之後再看到的 lazy 是站方 loader 改回去的，
        // 還原目標仍是最初原值）；WeakSet 防重複 push
        if (!eagerForcedSeen.has(img)) {
          eagerForcedSeen.add(img);
          eagerForced.push({ img, prev: img.getAttribute('loading') });
        }
        img.setAttribute('loading', 'eager'); // 用 attribute 非 .loading 屬性——瀏覽器讀 attribute、且反射到 jsdom
      }
    } catch (e) { /* 退化環境 */ }
  }
  function forceEagerImages() {
    if (!art) return;
    try {
      for (const img of art.querySelectorAll('img')) forceEagerImg(img);
    } catch (e) { /* 退化環境 */ }
  }
  // v1.6.16：進場一次性 forceEager 只掃「進場當下」的圖。使用者「頁面還在載入時就切
  // 翻頁模式」→ 之後才進 DOM 的圖（框架晚 mount / SPA lazy-render / 框架把 loading
  // 改回 lazy）掃不到，落在畫面外後段欄、翻頁模式無垂直捲動觸發不了原生 lazy → 永遠
  // 空白（probe 實證：進場後注入的 lazy 圖 rectLeft 4085/vw 430，9s 全程 loaded=false）。
  // MutationObserver 盯 art 子樹的整個閱讀期間：新增 img（或既有 img 的 loading 被改回
  // lazy）即時強制 eager。強制後圖載入 → capture load 監聽接手 remeasure，頁數同步更新。
  function observeMediaForEager() {
    if (!art || typeof MutationObserver === 'undefined') return;
    mediaObserver = new MutationObserver((records) => {
      for (const rec of records) {
        if (rec.type === 'attributes') {
          if (rec.target && rec.target.tagName === 'IMG') forceEagerImg(rec.target);
        } else {
          for (const n of rec.addedNodes) {
            if (!n || n.nodeType !== 1) continue;
            if (n.tagName === 'IMG') forceEagerImg(n);
            else if (n.querySelectorAll) { for (const im of n.querySelectorAll('img')) forceEagerImg(im); }
          }
        }
      }
    });
    mediaObserver.observe(art, { childList: true, subtree: true, attributes: true, attributeFilter: ['loading'] });
  }
  function restoreEagerImages() {
    for (const { img, prev } of eagerForced) {
      try { if (img && img.setAttribute) img.setAttribute('loading', prev); } catch (e) { /* */ }
    }
    eagerForced = [];
    eagerForcedSeen = new WeakSet();
  }

  // v1.7.46：翻頁模式內容整塊消失（Gmail 信件）修法。瀏覽器把 scroll container
  // （computed overflow-x/y 為 auto / scroll / hidden 任一——三值都建立可捲容器）
  // 視為 monolithic：多欄斷片時整塊不可切（隔離實驗實證；visible / clip 可斷片）。
  // 主文包在這種容器裡（Gmail 內文 .ii.gt 是 overflow-y:auto、.a3s 是
  // overflow-x:auto）且內容比一頁高時，整塊被推到下一欄、超出部分被卡片的
  // overflow:hidden 裁掉——第一頁只剩標題、內文全滅（cage 實證：6663px 內文
  // 整塊落在第 2 欄）。修法：掃 articleEl 後代，「高度超過一頁的 scroll
  // container」強制 overflow:visible（inline !important 蓋過站方 stylesheet）
  // 恢復可斷片；記錄原 inline 值、uninstall 還原（捲動模式下站方內捲 UI 仍合理）。
  // 結構性通則、不綁站點：只看「scroll container ＋ 高度 > 頁高」兩個特徵。
  // 高度放得進一頁的 scroll container（如 overflow-x:auto 的寬 <pre>）刻意不動
  // ——整塊進一頁無內容損失，保留內捲行為。頁高用 art content-box 高（= 欄高）。
  function unclipTallScrollContainers() {
    if (!art) return;
    let pageH = 0;
    try {
      const cs = getComputedStyle(art);
      pageH = art.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    } catch (e) { return; }
    if (!(pageH > 0)) return; // jsdom 無 layout → no-op（spec 以 stub 驅動）
    const isClipping = (v) => v === 'auto' || v === 'scroll' || v === 'hidden';
    let els;
    try { els = art.querySelectorAll('*'); } catch (e) { return; }
    for (const el of els) {
      let h = 0;
      try { h = el.getBoundingClientRect().height; } catch (e) { continue; }
      // monolithic 且高過一頁才會裁掉內容；可斷片元素的 fragment 聯集高 ≈ 頁高不誤中
      if (!(h > pageH + 4)) continue;
      let ox, oy;
      try {
        const cs = getComputedStyle(el);
        ox = cs.overflowX || ''; oy = cs.overflowY || '';
        // jsdom 不展開 overflow shorthand 成 longhand（回空字串）→ 退回讀 shorthand
        if (!ox && !oy) {
          const t = String(cs.overflow || '').trim().split(/\s+/);
          ox = t[0] || ''; oy = t[1] || t[0] || '';
        }
      } catch (e) { continue; }
      if (!isClipping(ox) && !isClipping(oy)) continue;
      // 只記第一次的原值（站方 loader 之後改回去時，還原目標仍是最初 inline 狀態）
      if (!unclipForcedSeen.has(el)) {
        unclipForcedSeen.add(el);
        unclipForced.push({
          el,
          prev: el.style.getPropertyValue('overflow'), prevPri: el.style.getPropertyPriority('overflow'),
          prevX: el.style.getPropertyValue('overflow-x'), prevXPri: el.style.getPropertyPriority('overflow-x'),
          prevY: el.style.getPropertyValue('overflow-y'), prevYPri: el.style.getPropertyPriority('overflow-y')
        });
      }
      try { el.style.setProperty('overflow', 'visible', 'important'); } catch (e) { /* */ }
    }
  }
  function restoreUnclipped() {
    for (const r of unclipForced) {
      try {
        r.el.style.removeProperty('overflow');
        if (r.prev) r.el.style.setProperty('overflow', r.prev, r.prevPri);
        if (r.prevX) r.el.style.setProperty('overflow-x', r.prevX, r.prevXPri);
        if (r.prevY) r.el.style.setProperty('overflow-y', r.prevY, r.prevYPri);
      } catch (e) { /* */ }
    }
    unclipForced = [];
    unclipForcedSeen = new WeakSet();
  }

  function pageCount() {
    if (!art) return 1;
    return measuredPages > 0 ? measuredPages : computePageCount(art.scrollWidth, stride());
  }

  // v0.7.237：建立底部頁碼指示器（install 時呼叫）。v1.5.4：一律建立——頁碼指示
  // 已是翻頁模式唯一進度載體，不再有開關。uninstall 負責移除。
  function reconcileIndicator() {
    let adopted = false;
    if (!indicatorEl) {
      indicatorEl = document.getElementById(INDICATOR_ID);
      adopted = !!indicatorEl; // 撿到既存 DOM（extension reload 後舊 context 殘留的孤兒）
    }
    if (!indicatorEl) {
      indicatorEl = document.createElement('div');
      indicatorEl.id = INDICATOR_ID;
      // 必須掛在 <html> 下（與 styler progressEl 同層），不能掛 body——
      // body 帶 data-jread-ancestor，styler 的 sibling 隱藏規則
      // `[ancestor] > *:not(...)` 會把 body 下的非主文子元素全部 display:none，
      // 指示器掛 body 下 rect 量出 0×0（udn probe 實證）。html 沒被
      // markAncestors 標記，不受該規則影響。
      (document.head?.parentElement || document.documentElement).appendChild(indicatorEl);
      adopted = true;
    }
    if (adopted) {
      // v0.8.150：頁碼當 scrubber——桌面滑鼠在指示器上按下起拖（touch 走
      // window touch 管線，靠 isIndicatorTarget 判定，不在此掛）。
      // v1.6.24：撿到孤兒 DOM 時也必須掛——舊 context 的 listener 隨 context 死亡
      // 失效，只在「新建」分支掛會讓該 session 桌面滑鼠 scrub 完全沒反應。
      // 先 remove 再 add 保冪等（同 context 重複 reconcile 不會疊 listener）。
      indicatorEl.removeEventListener('mousedown', onIndicatorMouseDown);
      indicatorEl.addEventListener('mousedown', onIndicatorMouseDown);
    }
    renderIndicator();
  }

  function renderIndicator() {
    const total = pageCount();
    if (indicatorEl) indicatorEl.textContent = (idx + 1) + ' / ' + total;
    // v1.5.2：翻頁模式不再驅動 styler 的頂端閱讀進度條——底部頁碼指示器已表閱讀
    // 進度，頂端進度條為重複功能（Jimmy 2026-06-27）。該進度條生命週期單一資料源
    // 在 styler.js（依 opts.pagedMode gate 注入與否），本模組完全不碰。
  }

  // v0.7.239：iOS 工具列收合「只在第一頁可滑」（Jimmy 要求：第一頁垂直滑收
  // 工具列，第二頁起維持原本鎖定行為、不能再垂直滑）。純邏輯：給定本次單指
  // 滑動位移與目前頁碼，回傳 onTouchMove 是否該 preventDefault（= 擋住原生捲動）。
  //   - 第一頁（pageIdx 0）：只擋「水平支配」滑動（Safari 邊緣返回手勢），
  //     放行垂直滑 → 底下 document 捲動 → iOS 收合工具列（styler 卡片
  //     touch-action: pan-y 讓垂直 pan 冒泡到 document）。
  //   - 第二頁起（pageIdx >= 1）：擋「所有」單指滑動——垂直擋住 = 維持第一頁
  //     收合後的 scrollY 不被捲回（工具列保持收合）、水平擋住 = Safari 邊緣返回。
  // 為何用 preventDefault 不用 touch-action：iOS WebKit 在有 passive:false
  // touchmove listener 時 touch-action 不可靠（等 JS 決定、且 touch-action 不
  // 繼承，手指實際落在卡片內 auto 的 <p>/<img>）——simulator 實證 touch-action:
  // none 仍被捲動穿透；passive:false 的 preventDefault 才真正擋得住。
  // 翻頁本身由 touchend 的 JS 程式控 scrollLeft，不受 preventDefault 影響。
  // v0.7.245：加 vLocked——第一頁收合後（捲動停止）鎖死，擋全部單指滑動。
  //   - locked（第一頁已收合鎖定 / 第二頁起）：擋全部
  //   - 第一頁未鎖：只擋水平支配（放行垂直滑去收工具列）
  // 純函式（jsdom spec 直接測），vLocked 由薄包裝 shouldBlockTouchMove 餵入。
  // v0.8.57：hasSelection——作用中文字選取時無條件放行（return false），不擋
  // 任何單指 touchmove。原因：iOS 拖曳選取控制點（selection handle）靠原生 touch
  // 行為，本模組對水平滑動 preventDefault 會一併把控制點拖曳擋掉 → Jimmy 回報
  // 「選取段落時手指無法移動游標位置」。控制點不在 DOM 內、無法以 target 命中，
  // 用「存在非 collapse 選取」這個結構訊號當代理：有選取就交還原生（放行擴選 /
  // 控制點拖曳），代價是選取期間滑動不翻頁（點空白處取消選取後即恢復翻頁）。
  function blockTouchDecision(dx, dy, pageIdx, locked, hasSelection) {
    if (hasSelection) return false;
    if (locked) return true;
    if (pageIdx !== 0) return true;
    return Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > HMOVE_BLOCK_PX;
  }
  function shouldBlockTouchMove(dx, dy, pageIdx) {
    return blockTouchDecision(dx, dy, pageIdx, vLocked, hasActiveSelection());
  }

  // v0.8.57：是否存在「作用中文字選取」——非 collapse 且有實際文字。用於放行 iOS
  // 選取控制點拖曳（見 blockTouchDecision）與避免選取期間 touchend 誤翻頁。
  // 即時讀取（非 touchstart 快照）才能涵蓋「長按選字後不放手直接拖曳擴選」的單一手勢。
  function hasActiveSelection() {
    try {
      const sel = window.getSelection && window.getSelection();
      return !!(sel && !sel.isCollapsed && String(sel).length > 0);
    } catch (e) { return false; }
  }

  // v0.7.245：套用/解除第一頁收合鎖。鎖時把卡片 touch-action 收成擋掉原生 pan
  // （pan-y 是收合入口，收合鎖定後不再需要原生垂直 pan）；解鎖還原成 CSS 的
  // pan-y pinch-zoom。**只在捲動停止後呼叫**（見 onScroll 的 debounce）——慣性中
  // 設鎖會害捲動彈回頂端（真機實證）。
  // v0.7.255：鎖值用 'pinch-zoom' 而非 'none'——保留雙指捏合「呼叫所有標籤頁」
  // 系統手勢（none 會連捏合一起關掉，Jimmy 回報翻頁模式捏不出標籤頁切換器）。
  // pinch-zoom 只放行雙指縮放、不放行單指 pan，鎖死垂直 pan 的目的仍達成。
  function applyVLock() {
    if (vLocked) return;
    vLocked = true;
    if (art) art.style.setProperty('touch-action', 'pinch-zoom', 'important');
  }
  function unlockVScroll() {
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
    if (!vLocked) return;
    vLocked = false;
    if (art) art.style.removeProperty('touch-action');
  }

  // v0.7.245：捲動「停止後」才鎖。每次 scroll 重設 debounce；SETTLE_LOCK_MS 內無再
  // scroll = 捲軸消失 = 已停止。停止時若已捲離頂端（scrollY > 門檻 = 已收合）且手指
  // 不在畫面上、未鎖 → applyVLock。停止後鎖無慣性可打斷、不彈回（與 v0.7.240→243
  // 「捲動中就鎖」的彈回 bug 區別）。第二頁起垂直被擋、不會捲動，故本鎖只由第一頁
  // 收合滑動觸發。
  function onScroll() {
    if (vLocked) return;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      settleTimer = null;
      if (vLocked || touchState) return;
      const y = window.scrollY || window.pageYOffset || 0;
      if (y > SETTLE_LOCK_MIN_SY) applyVLock();
    }, SETTLE_LOCK_MS);
  }

  // rAF ease-out 動畫跳頁。jsdom 無 layout，spec 不測本函式。
  function goTo(n, animate) {
    if (!art) return;
    const total = pageCount();
    idx = Math.max(0, Math.min(total - 1, n));
    lastRatio = total > 1 ? idx / (total - 1) : 0;
    const target = idx * stride();
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    if (!animate) {
      art.scrollLeft = target;
      renderIndicator();
      return;
    }
    const from = art.scrollLeft;
    const delta = target - from;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / TURN_ANIM_MS);
      const ease = 1 - Math.pow(1 - p, 3); // ease-out cubic
      art.scrollLeft = from + delta * ease;
      if (p < 1) animFrame = requestAnimationFrame(step);
      else animFrame = null;
    };
    animFrame = requestAnimationFrame(step);
    renderIndicator();
  }

  function turn(dir) {
    if (dir === 'next') goTo(idx + 1, true);
    else if (dir === 'prev') goTo(idx - 1, true);
    else if (dir === 'first') goTo(0, true);
    else if (dir === 'last') goTo(pageCount() - 1, true);
  }

  // 編輯/互動類 element focus 時放行（與 space-scroll 同準則，共用 NS 單一資料源）。
  // v0.8.17：改用 NS.isEditableTarget——原本本地版漏 BUTTON，按鈕 focus 時方向鍵 /
  // Space 被翻頁攔截、按不到。
  function isEditableFocus() {
    return window.__JRead.isEditableTarget(document.activeElement);
  }

  function onKeydown(e) {
    if (e.isComposing || e.keyCode === 229) return; // IME
    if (isEditableFocus()) return;
    const dir = classifyKey(e);
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    turn(dir);
  }

  // 滾輪 / 觸控板：水平或垂直 delta 都映射成翻頁（文件不可垂直卷動，垂直
  // 滾輪閒置不用反而違反直覺）。翻頁後鎖定一段時間吃掉慣性尾巴。
  function onWheel(e) {
    // 文件鎖卷動下無原生用途；防 macOS 觸控板水平 swipe 觸發歷史導航。
    // 已知取捨：主文內的巢狀可捲元素（overflow-x:auto 的寬 <pre>/表格）滾輪
    // 也被吃掉轉成翻頁——翻頁模式下滾輪語意統一為翻頁，內捲內容用拖曳捲。
    e.preventDefault();
    const now = performance.now();
    if (now < wheelLockUntil) return;
    const d = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    // v0.8.17：方向反轉時先歸零累積——否則往一邊累積未達門檻、改往反向滾要先
    // 抵銷掉舊累積（門檻形同兩倍），且閒置殘留可能讓一個小 delta 跨門檻翻錯向。
    if (d !== 0 && wheelAccum !== 0 && Math.sign(d) !== Math.sign(wheelAccum)) wheelAccum = 0;
    wheelAccum += d;
    if (Math.abs(wheelAccum) < WHEEL_THRESHOLD) return;
    turn(wheelAccum > 0 ? 'next' : 'prev');
    wheelAccum = 0;
    wheelLockUntil = now + WHEEL_LOCKOUT_MS;
  }

  // v0.8.150：本次手勢起點是否落在頁碼指示器上（= 要進 scrub 模式）。指示器在
  // styler CSS 設 pointer-events:auto 才會成為 hit-test target；尚未 install
  // （無指示器）時自然不會命中。
  function isIndicatorTarget(target) {
    if (!indicatorEl || !target) return false;
    if (target === indicatorEl) return true;
    // target 可能不是 Node（如 window，jsdom 對非 Node 的 contains 會 throw）→ 包 try
    try { return indicatorEl.contains(target); } catch (e) { return false; }
  }

  // v0.8.151：scrub 進度條（按住起拖時出現、放手淡出）。掛 <html> 下（同指示器，
  // 避開 styler ancestor-sibling 隱藏規則）；styler CSS 給樣式，本模組只增/移與更新 fill。
  function ensureScrubTrack() {
    if (scrubTrackEl && scrubTrackEl.isConnected) return;
    scrubTrackEl = document.createElement('div');
    scrubTrackEl.id = SCRUB_TRACK_ID;
    scrubFillEl = document.createElement('div');
    scrubFillEl.id = SCRUB_FILL_ID;
    scrubTrackEl.appendChild(scrubFillEl);
    (document.head?.parentElement || document.documentElement).appendChild(scrubTrackEl);
  }
  function updateScrubFill() {
    if (!scrubFillEl) return;
    const total = pageCount();
    // 目前頁占全文比例（第一頁 0%、末頁 100%——對應拖曳位置）
    scrubFillEl.style.width = (total <= 1 ? 100 : (idx / (total - 1)) * 100) + '%';
  }
  function showScrubTrack() {
    ensureScrubTrack();
    updateScrubFill();
    // 下一個 frame 才加 visible class，讓 opacity transition 真的 fade-in（同 frame
    // 建立 + 設 opacity:1 不會有過場）。
    // v0.8.166：rAF 內要再確認「此刻仍該顯示」（scrubArmed 或 scrubState 仍在）——否則
    // 「armed 中點按收起」的 touchstart 排了 show rAF、touchend 同步 hide 後，這個 rAF
    // 才補跑會把已收起的進度條又加回 visible（race）。
    requestAnimationFrame(() => {
      if (scrubTrackEl && (scrubArmed || scrubState)) scrubTrackEl.classList.add('__jread-scrub-visible');
    });
  }
  function hideScrubTrack() {
    if (scrubTrackEl) scrubTrackEl.classList.remove('__jread-scrub-visible');
  }

  // v0.8.151/153：觸覺回饋。iOS Safari 不支援 navigator.vibrate，唯一可行的 web 觸覺是
  // iOS 17.4+ 的原生 switch checkbox——對 <label><input type=checkbox switch>] 程式
  // label.click() 在 user gesture 內切換 switch、系統發觸覺 tick。
  // v0.8.153 比照實證可動的 ios-haptics 套件精確做法（v0.8.151/152 仍無觸覺）：
  //   - 載體掛 document.body（非 <html>）、inline display:none（套件證明 display:none
  //     不影響觸覺——觸覺由 click 切換 switch 狀態觸發、與是否渲染無關）
  //   - aria-hidden（無障礙不讀）
  //   - 不論 navigator.vibrate 是否存在都跑 switch click（避免 vibrate 提早 return：
  //     某些 iOS WebView 可能定義 vibrate stub 但 no-op，舊版會卡在 vibrate 不跑 switch）
  function ensureHaptic() {
    if (hapticEl && hapticEl.isConnected) return;
    hapticEl = document.createElement('label');
    hapticEl.id = HAPTIC_ID;
    hapticEl.setAttribute('aria-hidden', 'true');
    hapticEl.style.display = 'none';
    const inp = document.createElement('input');
    inp.type = 'checkbox';
    inp.setAttribute('switch', ''); // iOS 17.4+ 原生 switch，切換時系統發觸覺
    hapticEl.appendChild(inp);
    (document.body || document.documentElement).appendChild(hapticEl);
  }
  function triggerHaptic() {
    // iOS：switch click（主路徑）。Android / 支援平台：navigator.vibrate 也補一發。
    // 兩者並行：iOS vibrate 不存在只剩 switch、Android switch 不發觸覺只剩 vibrate，
    // 各平台都恰好一次觸覺（桌面兩者皆 no-op、無害）。
    try {
      ensureHaptic();
      hapticEl.click(); // 必須在 user gesture（scrub touchmove）內同步呼叫，不可丟 rAF
    } catch (e) { /* 無 haptic 環境 */ }
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
    } catch (e) { /* 某些平台 vibrate 受限 */ }
  }

  // v0.8.166：armed 模式切換（進度條常駐 + 畫面任意處 scrub）。setArmed 是進度條
  // 可見性在「armed 層」的單一出入口；transient drag 的可見性另由 beginScrub/endScrub 控。
  function setArmed(on) {
    scrubArmed = !!on;
    if (scrubArmed) showScrubTrack();
    else hideScrubTrack();
  }

  // 開始 / 更新 / 結束 scrub（touch 與 mouse 共用）。
  // v0.8.166：moved 旗標記錄本次手勢是否拖移（區分 tap 與 drag，見 resolveScrubGesture）。
  function beginScrub(clientX, onIndicator) {
    scrubState = { startX: clientX, startIdx: idx, scrubWidth: window.innerWidth || 0,
      moved: false, onIndicator: !!onIndicator };
    if (indicatorEl) indicatorEl.classList.add('__jread-scrubbing');
    showScrubTrack(); // v0.8.151：按住起拖時出現進度條
  }
  function updateScrub(clientX) {
    if (!scrubState) return;
    const target = computeScrubTarget(
      scrubState.startIdx, clientX - scrubState.startX, scrubState.scrubWidth, pageCount());
    if (target !== idx) {
      scrubState.moved = true; // v0.8.166：實際翻頁 = 必為 drag（不可能是 tap）
      goTo(target, false); // 即時跳頁、無動畫（live preview）
      triggerHaptic();     // v0.8.151：每跨一頁觸發觸覺（picker 滾輪式回饋）
    }
    updateScrubFill();
  }
  // 中止 scrub 拖曳狀態（不切換 armed）。armed 時進度條續留、非 armed 時淡出。
  // 用於非「乾淨手勢完成」的收尾：多指讓位、touchcancel、uninstall、桌面 mouseup。
  function endScrub() {
    if (!scrubState) return;
    scrubState = null;
    if (indicatorEl) indicatorEl.classList.remove('__jread-scrubbing');
    if (!scrubArmed) hideScrubTrack(); // v0.8.151：放手淡出進度條（armed 時常駐不淡）
  }
  // v0.8.166：一次乾淨手勢（touchstart→touchend）完成 → 依狀態機切換 armed。
  function finishScrubGesture() {
    if (!scrubState) return;
    const moved = scrubState.moved;
    scrubState = null;
    if (indicatorEl) indicatorEl.classList.remove('__jread-scrubbing');
    const action = resolveScrubGesture(scrubArmed, moved);
    if (action === 'arm') setArmed(true);
    else if (action === 'disarm') setArmed(false);
    else if (action === 'end') hideScrubTrack();
    // 'keep'：armed 維持、進度條續留，無動作
  }

  // 桌面滑鼠 scrub：頁碼上 mousedown 起拖，window 收 mousemove/up（拖出指示器
  // 外仍持續）。touch 裝置走 touch 管線、不會觸發 mouse 事件，故兩軌不重複。
  function onIndicatorMouseDown(e) {
    if (e.button !== 0) return; // 只認左鍵
    e.preventDefault();
    // v0.8.166：桌面滑鼠維持「按住拖曳」短暫 scrub（mouseup 走 endScrub、不進 armed）——
    // armed 的「畫面任意處滑」是觸控專屬手勢，桌面無對應，故桌面只保留 transient drag。
    beginScrub(e.clientX, true);
    if (!mouseScrubBound) {
      window.addEventListener('mousemove', onWindowMouseMove, true);
      window.addEventListener('mouseup', onWindowMouseUp, true);
      mouseScrubBound = true;
    }
  }
  function onWindowMouseMove(e) {
    if (!scrubState) return;
    e.preventDefault();
    updateScrub(e.clientX);
  }
  function onWindowMouseUp() {
    endScrub();
    if (mouseScrubBound) {
      window.removeEventListener('mousemove', onWindowMouseMove, true);
      window.removeEventListener('mouseup', onWindowMouseUp, true);
      mouseScrubBound = false;
    }
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) { touchState = null; endScrub(); return; } // 多指讓位（3 指 toggle 等）
    const t = e.touches[0];
    const onIndicator = isIndicatorTarget(e.target);
    // v0.8.166：armed 模式——進度條常駐，整個畫面都是 scrub 面：任何單指起手都進 scrub
    //（拖移 = 即時翻頁、點按 = 收起進度條，由 finishScrubGesture 依 moved 分流）。
    if (scrubArmed) {
      touchState = null;
      beginScrub(t.clientX, onIndicator);
      return;
    }
    // v0.8.150：起點落在頁碼指示器 → 進 scrub（拖移 = 翻頁；v0.8.166 點按 = 展開常駐進度條）
    if (onIndicator) {
      touchState = null;
      beginScrub(t.clientX, true);
      return;
    }
    // lastX/lastY：追蹤手指最後位置——iOS 在可點擊圖片/連結上啟動原生 image-
    // drag / callout 時，會對進行中的單指水平 swipe 送 touchcancel（不送 touchend）。
    // onTouchCancel 靠這個累積位移補判翻頁（changedTouches 在 cancel 時可能位移
    // 不足），讓「圖片上左右滑」也能翻頁。
    touchState = { startX: t.clientX, startY: t.clientY, lastX: t.clientX, lastY: t.clientY };
  }

  // v0.7.237：水平支配的單指滑動 preventDefault——攔住 iOS Safari 的系統級
  // 邊緣返回手勢（swipe-from-edge back/forward），以及任何原生水平卷動。
  // 翻頁模式下文件已 overflow:hidden 鎖死、水平觸控本就無原生用途，攔掉零副作用。
  // 必須 passive:false 才能 preventDefault；只攔單指（多指 = 3 指 toggle，讓位
  // 給 touch-gestures.js）。Jimmy 回報「第一頁左滑觸發 Safari back」即此手勢——
  // 第一頁無上一頁可翻，但 Safari 仍把邊緣滑動解讀成返回；preventDefault 後
  // Safari 收不到該手勢、不再導航（翻頁仍由 touchend 的 classifySwipe 處理）。
  function onTouchMove(e) {
    // v0.8.150：scrub 進行中——拖頁碼即時跳頁，preventDefault 擋住底層文件捲動/
    // iOS 返回手勢（指示器 touch-action:none 已擋大部分，preventDefault 兜底）。
    if (scrubState) {
      if (e.touches.length !== 1) { endScrub(); return; }
      if (e.cancelable) e.preventDefault();
      const x = e.touches[0].clientX;
      // v0.8.166：位移超 tap 門檻即標記 drag（涵蓋「拖很慢還沒跨頁」的情況；跨頁本身
      // 已在 updateScrub 內標 moved）。決定 finishScrubGesture 走 tap 還是 drag 分支。
      if (Math.abs(x - scrubState.startX) > TAP_SLOP_PX) scrubState.moved = true;
      updateScrub(x);
      return;
    }
    if (!touchState) return;
    if (e.touches.length !== 1) { touchState = null; return; }
    const t = e.touches[0];
    // v0.8.6：lastX/lastY 追蹤必須在 cancelable 檢查**之前**——可點擊圖片上 iOS
    // 把 touchmove 標成 non-cancelable（系統已接管準備 image-drag），舊 v0.8.5 把
    // 追蹤放在 `if (!e.cancelable) return` 之後 → lastX 永不更新 → onTouchCancel
    // 補判 dx=0 → 圖片上仍滑不動（Jimmy 2026-06-09 實機回報 v0.8.5 沒修好）。
    // 位置追蹤與「能否 preventDefault」無關，先記下來，cancel/end 才補得了判。
    const dx = t.clientX - touchState.startX;
    const dy = t.clientY - touchState.startY;
    touchState.lastX = t.clientX;
    touchState.lastY = t.clientY;
    if (!e.cancelable) return;
    // v0.7.239：第一頁只擋水平（放行垂直滑收工具列）、第二頁起擋全部（鎖死）
    if (shouldBlockTouchMove(dx, dy, idx)) {
      e.preventDefault();
    }
  }

  function onTouchEnd(e) {
    // v0.8.150：scrub 結束（手指離開 → 停在目前預覽頁，不再翻動）
    // v0.8.166：乾淨手勢完成 → finishScrubGesture 依 tap/drag 切換 armed 模式
    if (scrubState) {
      if (e.touches.length > 0) return;
      finishScrubGesture();
      return;
    }
    if (!touchState || e.touches.length > 0) return;
    // v0.8.57：選取控制點拖曳放手時選取仍在 → 不翻頁（與 onTouchMove 放行一致），
    // 否則拖曳擴選的水平位移會被 classifySwipe 判成翻頁、選到一半被切走。
    if (hasActiveSelection()) { touchState = null; return; }
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) { touchState = null; return; }
    const dir = classifySwipe({
      dx: t.clientX - touchState.startX,
      dy: t.clientY - touchState.startY,
      startX: touchState.startX,
      viewportW: window.innerWidth
    });
    touchState = null;
    if (dir) turn(dir);
  }

  // v0.8.5：iOS 在可點擊圖片/連結上啟動原生 image-drag / callout 時，對進行中
  // 的單指水平 swipe 送 touchcancel（非 touchend）。舊版直接丟棄手勢 → Jimmy
  // 回報「圖片上左右滑無法翻頁，必須在內文上滑」。改成 cancel 時用累積位移補判：
  // 若仍構成水平 swipe（classifySwipe 同款 threshold / 角度 / 邊緣 guard），照樣翻頁。
  // tap / 微動 / 垂直滑 / 邊緣手勢都不會通過 classifySwipe，不會誤翻。
  function onTouchCancel(e) {
    // v0.8.150：scrub 進行中被 cancel（iOS 中斷）→ 收尾停在目前頁，不補判翻頁
    if (scrubState) { endScrub(); touchState = null; return; }
    // v0.8.57：選取作用中時 iOS 對選取手勢送 touchcancel，補判翻頁會誤翻 → 放行
    if (touchState && hasActiveSelection()) { touchState = null; return; }
    if (touchState) {
      // 取「lastX（touchmove 累積）」與「changedTouches（cancel 當下位置）」中
      // 水平位移最大者——涵蓋兩種 iOS 變體：(a) 有派發 touchmove → lastX 準；
      // (b) 圖片上直接 cancel 幾乎沒 touchmove → 靠 cancel event 的 changedTouches。
      let endX = touchState.lastX, endY = touchState.lastY;
      const ct = e && e.changedTouches && e.changedTouches[0];
      if (ct && Math.abs(ct.clientX - touchState.startX) > Math.abs(endX - touchState.startX)) {
        endX = ct.clientX; endY = ct.clientY;
      }
      const dir = classifySwipe({
        dx: endX - touchState.startX,
        dy: endY - touchState.startY,
        startX: touchState.startX,
        viewportW: window.innerWidth
      });
      touchState = null;
      if (dir) turn(dir);
      return;
    }
    touchState = null;
  }

  // resize / 旋轉：stride 變了、頁界全部重排——重測頁數、按 lastRatio 回到對應頁
  // v0.8.17：debounce 單一 pending rAF——行動裝置旋轉會連發多次 resize，原本每次
  // 各排一個 rAF，多個 rAF 在同 frame 依序跑 remeasure（內含強制 scrollLeft=0 再
  // 還原），與彼此的中間值交錯造成錯位。先取消前一個 pending rAF 再排新的。
  function onResize() {
    if (!art) return;
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      if (!art) return;
      // v1.7.46：resize 後頁高改變，重新判定哪些 scroll container 高過一頁
      unclipTallScrollContainers();
      remeasurePages();
      try { lastScrollWidth = art.scrollWidth; } catch (e) { /* */ } // v1.6.15：保持變動偵測 gate 準確
      const total = pageCount();
      goTo(Math.round(lastRatio * (total - 1)), false);
    });
  }

  function install(articleEl) {
    if (installed && art === articleEl) {
      // styler reapply 後重掛：頁碼開關可能變動（reconcile）、重算頁數回原位
      reconcileIndicator();
      onResize();
      return;
    }
    if (installed) uninstall();
    if (!articleEl) return;
    art = articleEl;
    vLocked = false; // v0.7.245：新進場（同篇 reapply 走上面 early return 不重置）

    // v1.0.2：翻譯頁標題消失（翻頁模式）修法。非翻頁模式時 cleaner 把翻譯頁的
    // 主標題 clone 放在 articleEl「外」（前一個 sibling，data-jread-promoted-outside），
    // 避開 Shinkansen content guard 對 articleEl 子節點的 reconcile（v0.8.131）。
    // 但翻頁模式把 articleEl 變成 fixed 滿版 multicol 容器、蓋住所有外置兄弟，
    // 外置標題渲染在卡片底下看不到（cage 實證：page 1 頂端是付費牆內容、無標題）。
    // 翻頁模式需要標題進到 multicol 流裡才會出現在第 1 頁——install 時暫時把這個
    // 外置標題移進 articleEl 開頭，uninstall 時移回原位。in-article 標題在閱讀模式
    // 期間靠 jread-reader-mode 握手暫停 guard 不被清掉（見 main.js
    // signalReaderModeToTranslator + Shinkansen setContentGuardPaused）。
    const prevSib = articleEl.previousElementSibling;
    if (prevSib && prevSib.getAttribute && prevSib.getAttribute('data-jread-promoted-outside') === '1') {
      relocatedTitle = prevSib;
      articleEl.insertBefore(prevSib, articleEl.firstChild);
    } else {
      relocatedTitle = null;
    }

    // 頁碼指示器（v1.5.4 起恆顯示——原 showPageNumber 開關已移除，見檔頭註解）
    reconcileIndicator();

    // keydown 必須 capture（先於原站 listener）；touch passive（不阻塞原生
    // 行為，swipe 判定在 touchend 才做）；wheel passive: false（要 preventDefault）。
    window.addEventListener('keydown', onKeydown, true);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    // touchmove 必須 passive:false——onTouchMove 對水平滑動 preventDefault 擋
    // iOS Safari 邊緣返回手勢（v0.7.237），passive:true 無法 preventDefault。
    window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    window.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    window.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, { passive: true }); // v0.7.245：捲動停止後鎖

    installed = true;
    // v1.6.15：進場強制 lazy 圖 eager（水平溢出的後段圖才會即時載入）
    forceEagerImages();
    // v1.6.16：持續盯後續進 DOM / 被改回 lazy 的圖（涵蓋「載入中就切翻頁模式」的 race）
    observeMediaForEager();
    // v1.7.46：先解開高 scroll container 的 monolithic 裁切，remeasure 才量得到真頁數
    unclipTallScrollContainers();
    // 進場回到上次比例（同一篇 reapply 場景）；首次進入 lastRatio = 0 = 第一頁
    remeasurePages();
    try { lastScrollWidth = art.scrollWidth; } catch (e) { /* */ }
    const total = pageCount();
    goTo(Math.round(lastRatio * (total - 1)), false);

    // v1.6.15：內容驅動重測——卡片掛 capture load 監聽，任何後代 img/video/iframe
    // 載入撐大內容即 debounce 重測（涵蓋整個閱讀期間，不只前 3 秒）。
    onDescendantLoadBound = onDescendantLoad;
    art.addEventListener('load', onDescendantLoadBound, true);

    // lazy-load 圖片 / 晚到內容會讓內容末端移動——固定計時器仍保留當安全網，
    // 涵蓋非媒體載入的 reflow（web font 換字、晚到 CSS）；媒體載入主要靠上面的
    // load 監聽即時接手，不再只賴這兩個時間點。
    remeasureTimers = [1000, 3000].map(ms => setTimeout(remeasureAndReconcile, ms));
  }

  // v1.7.41（P3）：opts——
  //   suspend：編輯模式暫停路徑（main.js suspendReaderInteractions）。不消費
  //     savedScrollY、不捲動——y 是「進場前的原站卷動位置」，對仍在閱讀模式的
  //     版面沒有意義；舊版照消費會讓 suspend→restore 一輪後真退出的 fallback
  //     捲回靜默失效（install 不重抓、captureScrollY 只在 !installed 時寫入）。
  //   deferScrollRestore：真退出路徑（main.js exitReaderModeImpl）。消費 y 但
  //     不排 rAF，改回傳數字給 main.js 在 styler.restore 之後同步捲回——背景
  //     分頁 rAF 被 throttle / 凍結（v0.8.84 教訓），晚到的 scrollTo 會打在
  //     還原後的新狀態上。exitAnchorHandoff 時回 0（anchor 路徑接管捲動）。
  //   無 opts：settings 切換 / reinstall 路徑，維持原 rAF 行為。
  function uninstall(opts) {
    const o = opts || {};
    if (!installed && !indicatorEl) return 0;
    window.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('wheel', onWheel, { passive: false });
    window.removeEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    window.removeEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    window.removeEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    window.removeEventListener('touchcancel', onTouchCancel, { capture: true, passive: true });
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onScroll, { passive: true });
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = 0; }
    for (const t of remeasureTimers) clearTimeout(t);
    remeasureTimers = [];
    // v1.6.15：移除內容驅動重測的 load 監聽 + debounce timer；還原強制 eager 的圖
    if (art && onDescendantLoadBound) art.removeEventListener('load', onDescendantLoadBound, true);
    onDescendantLoadBound = null;
    if (remeasureDebounce) { clearTimeout(remeasureDebounce); remeasureDebounce = 0; }
    lastScrollWidth = 0;
    // v1.6.16：先斷 observer 再還原——否則還原 setAttribute('loading','lazy') 會被
    // observer 當成「圖變 lazy」又強制回 eager，還原失敗。
    if (mediaObserver) { mediaObserver.disconnect(); mediaObserver = null; }
    restoreEagerImages();
    // v1.7.46：還原被強制 overflow:visible 的高 scroll container（退回捲動模式後
    // 站方內捲 UI 仍是合理設計）
    restoreUnclipped();
    // v0.7.245：清 settle timer + 還原卡片 touch-action（鎖時設過 inline none），避免
    // 元素被 styler reapply 沿用時殘留鎖狀態
    unlockVScroll();
    // v0.8.150：清 scrub 狀態 + 解除桌面滑鼠 scrub 的 window listener（拖曳中離開
    // 也不殘留）。indicator.remove() 連帶移除其 mousedown listener。
    // v0.8.166：先退出 armed（進度條常駐旗標），endScrub 才會淡出而非續留。
    scrubArmed = false;
    endScrub();
    if (mouseScrubBound) {
      window.removeEventListener('mousemove', onWindowMouseMove, true);
      window.removeEventListener('mouseup', onWindowMouseUp, true);
      mouseScrubBound = false;
    }
    // v1.0.2：把翻頁模式期間移進 articleEl 的翻譯頁外置標題移回原位（articleEl 前），
    // 還原非翻頁模式的 promoted-outside 版面契約（styler 對 ANCESTOR > promoted-outside
    // 有獨立卡片規則）。art 仍在原 parent 才移得回。
    if (relocatedTitle) {
      if (art && art.parentNode) art.parentNode.insertBefore(relocatedTitle, art);
      relocatedTitle = null;
    }
    if (indicatorEl) { indicatorEl.remove(); indicatorEl = null; }
    // v0.8.151：移除 scrub 進度條 + 觸覺載體
    if (scrubTrackEl) { scrubTrackEl.remove(); scrubTrackEl = null; scrubFillEl = null; }
    if (hapticEl) { hapticEl.remove(); hapticEl = null; }
    if (art) art.scrollLeft = 0;
    // 還原進場前的文件卷動位置（overflow hidden 期間 scrollTop 歸零，
    // CSS 移除後不還原會讓使用者掉回頁首）。styler restore 在本 uninstall
    // 之後才移除 overflow hidden——延後一個 frame 等文件恢復可卷動。
    // v1.6.8：exit anchor handoff 時跳過——退出捲回（applyExitScrollAnchor）
    // 接管捲動目標，這個 rAF 晚一 frame 跑、不跳過會把 anchor 位置蓋掉。
    let deferredY = 0;
    if (!o.suspend) {
      const y = savedScrollY;
      if (o.deferScrollRestore) {
        if (y > 0 && !exitAnchorHandoff) deferredY = y;
      } else if (y > 0 && !exitAnchorHandoff) {
        requestAnimationFrame(() => window.scrollTo(0, y));
      }
      exitAnchorHandoff = false;
      // v0.8.17：消費後歸零——避免殘留值在下一輪 install 失敗 / captureScrollY
      // 沒重抓時被誤用，把使用者捲到與當前頁面無關的位置。
      savedScrollY = 0;
    }
    art = null;
    installed = false;
    touchState = null;
    wheelAccum = 0;
    idx = 0;
    measuredPages = 0;
    strideExact = 0;
    // lastRatio 刻意保留：settings reapply 的 uninstall→install 要回原位；
    // exitReaderMode 後 main.js 會呼叫 resetPosition() 歸零
    return deferredY;
  }

  function resetPosition() { lastRatio = 0; }

  // v1.6.8：退出捲回 anchor——文件順序第一個「fragment 頁碼覆蓋含目前頁」的
  // 內容節點（text node 或 img 等替換元素）。main.js captureExitScrollAnchor
  // 在 uninstall 之前呼叫（此刻 idx / 版面仍有效），退出還原後由
  // applyExitScrollAnchor 以該節點的 Range rect 捲回原網頁對應位置。
  //
  // 量測鐵則：必在 scrollLeft = 0 下量、量完還原（同一 frame 同步讀寫無
  // repaint）——Safari 對已捲動狀態的 overflow column fragment rect 回報會
  // 偏移（measureContentEndX 同款迴避法，頁數計算已在 Safari 實證可靠）。
  //
  // 回傳 node 本身（非 parentElement）：巨型單一容器站（如整篇文章一個
  // <font>）的 parentElement 高數萬 px，捲它的頂 = 回文首（probe 實證假綠燈）。
  // 跨欄段落靠 coverage 區間命中：讀第 k 頁時該段 max >= k，正確選到延續段。
  // 找不到覆蓋節點時取第一個「起始頁 > 目前頁」的節點兜底（該頁唯一內容
  // 是量不到的型態時，就近捲到下一段內容）；全量不到（jsdom）回 null。
  function captureExitAnchor() {
    if (!installed || !art) return null;
    const s = stride();
    const total = pageCount();
    if (!(s > 0)) return null;
    const prev = art.scrollLeft;
    let found = null;
    try {
      art.scrollLeft = 0;
      const cs = getComputedStyle(art);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const bL = parseFloat(cs.borderLeftWidth) || 0;
      const colStart = art.getBoundingClientRect().left + bL + padL;
      const walker = document.createTreeWalker(art, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
        acceptNode(n) {
          if (n.nodeType === 3) {
            return (n.nodeValue && n.nodeValue.trim())
              ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          }
          // 替換元素 = atomic fragment，bounding rect 可靠（文首/頁首是圖片的頁靠這層）
          return /^(IMG|VIDEO|IFRAME|SVG)$/i.test(n.tagName)
            ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
      });
      let node;
      while ((node = walker.nextNode())) {
        let rects;
        if (node.nodeType === 3) {
          const range = document.createRange();
          range.selectNodeContents(node);
          rects = range.getClientRects();
        } else {
          rects = node.getClientRects();
        }
        const cov = fragmentPageCoverage(rects, colStart, s, total);
        // 文件順序下起始頁單調遞增：第一個 max >= idx 的節點即「覆蓋目前頁」
        //（min <= idx）或「目前頁無可量內容時的下一段」（min > idx，兜底就近）
        if (cov && cov.max >= idx) { found = node; break; }
      }
    } catch (e) { found = null; }
    art.scrollLeft = prev;
    if (found) exitAnchorHandoff = true;
    return found;
  }

  // v0.8.40：閱讀位置記憶（position-memory.js）共用 API。getPosition 在
  // exitReaderMode 的 endSession flush 時讀（main.js 保證在 uninstall 之前
  // ——uninstall 會把 idx 歸零）；goToPage 在 restore 時跳回儲存頁（無動畫，
  // 進場直接落點）。goTo 內建 clamp + lastRatio 同步，後續 resize / lazy-load
  // remeasure 的按比例回位自動接手。
  function getPosition() {
    if (!installed) return null;
    return { idx, total: pageCount() };
  }
  function goToPage(n) {
    if (!installed) return;
    goTo(n, false);
  }

  // 文件卷動位置捕捉：必須在 styler 注入 overflow hidden **之前**呼叫——
  // 注入後文件不可卷動、window.scrollY 已被 clamp 成 0，事後讀必丟失。
  // main.js 在 enterReaderMode / scheduleReapply 的 styler.apply 前呼叫；
  // 已 installed 時不覆寫（此刻 scrollY 是被鎖定的 0，不是真位置）。
  function captureScrollY() {
    if (!installed) savedScrollY = window.scrollY || 0;
  }

  // settings → 模組狀態同步（與 space-scroll.sync 同形）：pagedMode = true
  // 且有 articleEl 才 install。
  function sync(settings, articleEl) {
    const on = !!(settings && settings.pagedMode === true);
    if (on && articleEl) install(articleEl);
    else uninstall();
  }

  const api = {
    computePageCount,
    computePageCountFromExtent,
    quantizeStride,
    computeScrubTarget,
    resolveScrubGesture,
    pageOfLeft,
    fragmentPageCoverage,
    classifySwipe,
    classifyKey,
    shouldBlockTouchMove,
    blockTouchDecision,
    sync,
    install,
    uninstall,
    resetPosition,
    captureScrollY,
    getPosition,
    goToPage,
    captureExitAnchor,
    isInstalled: () => installed,
    SWIPE_MIN_DX, SWIPE_AXIS_RATIO, EDGE_GUARD_PX, WHEEL_THRESHOLD,
    INDICATOR_ID
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // content script 環境：掛上 NS（namespace.js 先載入）
  if (typeof window !== 'undefined' && global === window && window.__JRead) {
    window.__JRead.pagedMode = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
