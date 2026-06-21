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
//   - 頁碼指示（#__jread-page-indicator，底部置中「3 / 43」）+ 復用
//     styler 的 #__jread-progress 進度條（寬度 = 已讀頁比例）
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
  // styler.js PROGRESS_ID 的鏡像字面值（兩檔是同一事實的雙實作，regression
  // spec paged-mode.spec.js 會校對兩邊字面值一致）
  const PROGRESS_ID = '__jread-progress';

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
  let mouseScrubBound = false; // 桌面滑鼠 scrub 的 window mousemove/up 是否已掛
  let scrubTrackEl = null;     // v0.8.151 scrub 進度條容器
  let scrubFillEl = null;      // v0.8.151 scrub 進度條 fill
  let hapticEl = null;         // v0.8.151 iOS 觸覺載體（switch checkbox）
  let remeasureTimers = [];
  let measuredPages = 0;    // 內容末端實測頁數；0 = 量不到（fallback scrollWidth 公式）
  let showIndicator = true; // v0.7.237：是否顯示底部頁碼指示（settings.showPageNumber）
  // v0.7.245：第一頁「捲動停止後」鎖死垂直卷動（Jimmy 要保留「捲軸消失後可鎖住」）。
  // 與 v0.7.240→243 已撤回的鎖不同：觸發點是「捲動完全停止（debounce）」、不是捲動中
  // ——在慣性中設 touch-action:none 會害捲動彈回頂端 + 工具列重展開（真機 instrument
  // 實證）；等停止才鎖無慣性可打斷、不彈回。配 styler 的 101vh（範圍極小、停止快），
  // 收合後幾乎立刻鎖、左右滑乾淨（真機驗過鎖得住、工具列維持收合）。
  let vLocked = false;
  let settleTimer = null;

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

  function pageCount() {
    if (!art) return 1;
    return measuredPages > 0 ? measuredPages : computePageCount(art.scrollWidth, stride());
  }

  // v0.7.237：依 showIndicator 增/移除底部頁碼指示器。install 與 sync（設定
  // 即時切換）共用——頁碼是純顯示層，切換不需重建 multicol layout。
  function reconcileIndicator() {
    if (showIndicator) {
      if (!indicatorEl) {
        indicatorEl = document.getElementById(INDICATOR_ID);
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
        // v0.8.150：頁碼當 scrubber——桌面滑鼠在指示器上按下起拖（touch 走
        // window touch 管線，靠 isIndicatorTarget 判定，不在此掛）
        indicatorEl.addEventListener('mousedown', onIndicatorMouseDown);
      }
      renderIndicator();
    } else if (indicatorEl) {
      indicatorEl.remove();
      indicatorEl = null;
    }
  }

  function renderIndicator() {
    const total = pageCount();
    if (indicatorEl) indicatorEl.textContent = (idx + 1) + ' / ' + total;
    // 復用 styler 進度條：翻頁模式下文件不卷動、onScrollProgress 收不到事件，
    // 由本模組直接驅動寬度 = 已讀頁比例
    const bar = document.getElementById(PROGRESS_ID);
    if (bar) bar.style.width = (total <= 1 ? 100 : ((idx + 1) / total) * 100) + '%';
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
    e.preventDefault(); // 文件鎖卷動下無原生用途；防 macOS 觸控板水平 swipe 觸發歷史導航
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
  // styler CSS 設 pointer-events:auto 才會成為 hit-test target；showIndicator 關
  // 時無指示器，自然不會命中。
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
    // 建立 + 設 opacity:1 不會有過場）
    requestAnimationFrame(() => { if (scrubTrackEl) scrubTrackEl.classList.add('__jread-scrub-visible'); });
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

  // 開始 / 更新 / 結束 scrub（touch 與 mouse 共用）。
  function beginScrub(clientX) {
    scrubState = { startX: clientX, startIdx: idx, scrubWidth: window.innerWidth || 0 };
    if (indicatorEl) indicatorEl.classList.add('__jread-scrubbing');
    showScrubTrack(); // v0.8.151：按住起拖時出現進度條
  }
  function updateScrub(clientX) {
    if (!scrubState) return;
    const target = computeScrubTarget(
      scrubState.startIdx, clientX - scrubState.startX, scrubState.scrubWidth, pageCount());
    if (target !== idx) {
      goTo(target, false); // 即時跳頁、無動畫（live preview）
      triggerHaptic();     // v0.8.151：每跨一頁觸發觸覺（picker 滾輪式回饋）
    }
    updateScrubFill();
  }
  function endScrub() {
    if (!scrubState) return;
    scrubState = null;
    if (indicatorEl) indicatorEl.classList.remove('__jread-scrubbing');
    hideScrubTrack(); // v0.8.151：放手淡出進度條
  }

  // 桌面滑鼠 scrub：頁碼上 mousedown 起拖，window 收 mousemove/up（拖出指示器
  // 外仍持續）。touch 裝置走 touch 管線、不會觸發 mouse 事件，故兩軌不重複。
  function onIndicatorMouseDown(e) {
    if (e.button !== 0) return; // 只認左鍵
    e.preventDefault();
    beginScrub(e.clientX);
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
    // v0.8.150：起點落在頁碼指示器 → 進 scrub 模式（不另判翻頁 swipe）
    if (isIndicatorTarget(e.target)) {
      touchState = null;
      beginScrub(t.clientX);
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
      updateScrub(e.touches[0].clientX);
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
    if (scrubState) {
      if (e.touches.length > 0) return;
      endScrub();
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
      remeasurePages();
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

    // v0.7.237：頁碼指示器依 showIndicator 增/移除（settings.showPageNumber）
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
    // 進場回到上次比例（同一篇 reapply 場景）；首次進入 lastRatio = 0 = 第一頁
    remeasurePages();
    const total = pageCount();
    goTo(Math.round(lastRatio * (total - 1)), false);

    // lazy-load 圖片 / 晚到內容會讓內容末端移動——延遲重測頁數
    // （刷指示文字；頁數縮水時 clamp 回最後一頁，不然停在幽靈位置）
    remeasureTimers = [1000, 3000].map(ms => setTimeout(() => {
      if (!installed) return;
      remeasurePages();
      const t = pageCount();
      if (idx > t - 1) goTo(t - 1, false);
      else renderIndicator();
    }, ms));
  }

  function uninstall() {
    if (!installed && !indicatorEl) return;
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
    // v0.7.245：清 settle timer + 還原卡片 touch-action（鎖時設過 inline none），避免
    // 元素被 styler reapply 沿用時殘留鎖狀態
    unlockVScroll();
    // v0.8.150：清 scrub 狀態 + 解除桌面滑鼠 scrub 的 window listener（拖曳中離開
    // 也不殘留）。indicator.remove() 連帶移除其 mousedown listener。
    endScrub();
    if (mouseScrubBound) {
      window.removeEventListener('mousemove', onWindowMouseMove, true);
      window.removeEventListener('mouseup', onWindowMouseUp, true);
      mouseScrubBound = false;
    }
    if (indicatorEl) { indicatorEl.remove(); indicatorEl = null; }
    // v0.8.151：移除 scrub 進度條 + 觸覺載體
    if (scrubTrackEl) { scrubTrackEl.remove(); scrubTrackEl = null; scrubFillEl = null; }
    if (hapticEl) { hapticEl.remove(); hapticEl = null; }
    if (art) art.scrollLeft = 0;
    // 還原進場前的文件卷動位置（overflow hidden 期間 scrollTop 歸零，
    // CSS 移除後不還原會讓使用者掉回頁首）。styler restore 在本 uninstall
    // 之後才移除 overflow hidden——延後一個 frame 等文件恢復可卷動。
    const y = savedScrollY;
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
    // v0.8.17：消費後歸零——避免殘留值在下一輪 install 失敗 / captureScrollY
    // 沒重抓時被誤用，把使用者捲到與當前頁面無關的位置。
    savedScrollY = 0;
    art = null;
    installed = false;
    touchState = null;
    wheelAccum = 0;
    idx = 0;
    measuredPages = 0;
    strideExact = 0;
    // lastRatio 刻意保留：settings reapply 的 uninstall→install 要回原位；
    // exitReaderMode 後 main.js 會呼叫 resetPosition() 歸零
  }

  function resetPosition() { lastRatio = 0; }

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

  // v0.7.237：頁碼指示即時切換（popup showPageNumber toggle）。純顯示層——
  // 只增/移除指示器、不重建 multicol layout（避免 full styler reapply 的
  // 捲動→翻頁閃爍）。installed 時才 reconcile（未裝時只更新旗標，下次 install 生效）。
  function setShowIndicator(show) {
    showIndicator = show !== false;
    if (installed) reconcileIndicator();
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
    // v0.7.237：頁碼指示開關（嚴格 !== false → 預設顯示）。install 前先更新，
    // reconcileIndicator 才能據此增/移除。
    showIndicator = !(settings && settings.showPageNumber === false);
    const on = !!(settings && settings.pagedMode === true);
    if (on && articleEl) install(articleEl);
    else uninstall();
  }

  const api = {
    computePageCount,
    computePageCountFromExtent,
    quantizeStride,
    computeScrubTarget,
    classifySwipe,
    classifyKey,
    shouldBlockTouchMove,
    blockTouchDecision,
    sync,
    install,
    uninstall,
    resetPosition,
    setShowIndicator,
    captureScrollY,
    getPosition,
    goToPage,
    isInstalled: () => installed,
    SWIPE_MIN_DX, SWIPE_AXIS_RATIO, EDGE_GUARD_PX, WHEEL_THRESHOLD,
    INDICATOR_ID, PROGRESS_ID
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // content script 環境：掛上 NS（namespace.js 先載入）
  if (typeof window !== 'undefined' && global === window && window.__JRead) {
    window.__JRead.pagedMode = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
