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
  const WHEEL_THRESHOLD = 90;       // 滾輪 delta 累積門檻（像素當量；非像素 deltaMode 先經 normalizeWheelDelta 換算）
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
  // v2.5.49：量化結果與近似值差超過 QUANT_MAX_DRIFT_PX 就不採用、退回近似值。
  // 上面的恆等式假設可捲寬度剛好停在最後一欄右緣；最後一欄裡有元素往右溢出
  //（meta.discourse 文末 flex 列 sw 782 > 框寬 573）時 max scrollLeft 被多撐 265px，
  // 14 格量化出 738.9、實際欄距 720——每翻一頁往左偏 19px，第 9 頁起右緣露出下一欄
  //（語料庫回放＋真站 probe 實測）。量化要修的是次像素格點誤差（iOS 0.333px／頁），
  // 差到 1px 以上就不是格點誤差、是溢出污染
  const QUANT_MAX_DRIFT_PX = 1;
  function quantizeStride(maxScrollLeft, approx) {
    if (!(approx > 0) || !(maxScrollLeft > approx / 2)) return approx;
    const k = Math.max(1, Math.round(maxScrollLeft / approx));
    const q = maxScrollLeft / k;
    return Math.abs(q - approx) > QUANT_MAX_DRIFT_PX ? approx : q;
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
  // 2026-10-07 review D-7：rtl = true 時欄從右往左長，colStart 是第一欄的「右緣」、
  // 每個 fragment 以「colStart − r.right」當邏輯 inline 起點量頁碼（純座標映射）。
  function fragmentPageCoverage(rects, colStart, stride, total, rtl) {
    let min = Infinity, max = -Infinity;
    for (const r of rects) {
      if (!(r.width > 0) || !(r.height > 0)) continue;
      const p = rtl
        ? pageOfLeft(colStart - r.right, 0, stride, total)
        : pageOfLeft(r.left, colStart, stride, total);
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

  // 2026-10-07 review D-11：滾輪 delta 換算成像素當量。Firefox 對實體滾輪常回報
  // `deltaMode = 1`（DOM_DELTA_LINE，一格 deltaY = 3 行）而非像素，WHEEL_THRESHOLD 90
  // 是像素門檻——不換算要連滾 30 格才翻一頁（合成 deltaMode=1 事件 probe：3 格不翻）。
  // 行 → 像素用固定常數 WHEEL_LINE_PX = 100 / 3：Chromium 把一格滾輪派發成 100px，
  // 即「3 行 = 100px」，照這個比例換算讓 Firefox 一格 = Chromium 一格 = 剛好一頁；
  // 不用內文 computed line-height——那會讓滾輪靈敏度隨使用者字級 / 行高設定浮動
  //（probe：預設 17px × 1.5 = 25.5 → 3 行 76px < 90，一格翻不動）。頁模式
  //（DOM_DELTA_PAGE）乘以 viewport 高。像素模式原值不動（Chromium / 觸控板）。
  // 純函式：pageHeightPx 由呼叫端傳入，jsdom spec 直接測。
  const WHEEL_LINE_PX = 100 / 3;
  function normalizeWheelDelta(d, deltaMode, pageHeightPx) {
    const v = Number(d) || 0;
    if (deltaMode === 1) return v * WHEEL_LINE_PX;
    if (deltaMode === 2) return v * (pageHeightPx > 0 ? pageHeightPx : 800);
    return v;
  }

  // swipe 手勢分類。輸入純物件 { dx, dy, startX, viewportW }：
  //   dx/dy = touchend − touchstart 位移；startX = 起點 clientX。
  // 回傳 'next'（往左滑 = 翻下一頁）/ 'prev' / null。
  // 2026-10-07 review D-7：opts.rtl = true 時左右對調——RTL 文章下一頁在左側、
  // 往右滑（把內容往右拉）才是翻下一頁，與書頁翻向一致。
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
    const next = o.rtl ? g.dx > 0 : g.dx < 0;
    return next ? 'next' : 'prev';
  }

  // 鍵盤對映。輸入 event-like { key, code, shiftKey, altKey, ctrlKey, metaKey }。
  // 回傳 'next' / 'prev' / 'first' / 'last' / null。
  // 2026-10-07 review D-7：opts.rtl = true 時 ←/→ 對調（RTL 下一頁在左、← = next）；
  // PageUp / PageDown / Space / Home / End 是邏輯方向鍵、不受書寫方向影響。
  function classifyKey(e, opts) {
    if (!e || e.altKey || e.ctrlKey || e.metaKey) return null;
    const rtl = !!(opts && opts.rtl);
    const k = e.key;
    if (k === 'PageDown') return 'next';
    if (k === 'PageUp') return 'prev';
    if (k === 'ArrowRight') return rtl ? 'prev' : 'next';
    if (k === 'ArrowLeft') return rtl ? 'next' : 'prev';
    if (k === ' ' || e.code === 'Space') return e.shiftKey ? 'prev' : 'next';
    if (k === 'Home') return 'first';
    if (k === 'End') return 'last';
    return null;
  }

  // ---- DOM 模組 ----

  let installed = false;
  const PAGED_ROOT_ATTR = 'data-jread-paged'; // v2.5.53：見 paged-io-guard.js
  let art = null;
  let idx = 0;
  let lastRatio = 0;        // uninstall 後保留，styler reapply 重掛時回到原比例
  let savedScrollY = 0;     // 進翻頁模式前的文件卷動位置，退出還原
  // 2026-10-07 review D-7：卡片 computed direction 是否為 rtl（install / remeasure 時
  // 讀）。RTL 的 multicol 溢出欄長在左側、scroll container 的 scrollLeft 合法範圍是
  // [−max, 0]（Chromium probe：ar 合成頁 pos clamp 0 / neg −4320）——舊版全以正值
  // 假設：量 max 得 0、goTo 寫正值被 clamp 成 0，卡在第 1 頁、頁碼照跳但畫面不動。
  // 修法是純座標映射：對外（idx / stride / 頁數）一律邏輯座標（0 起、往「下一頁」
  // 遞增），只在讀寫 art.scrollLeft 的邊界換號（logicalScrollLeft / setLogicalScrollLeft）。
  let isRtl = false;
  let indicatorEl = null;
  let animFrame = null;
  let resizeRaf = 0;        // v0.8.17：onResize debounce 的 pending rAF handle
  // 卡片尺寸監看（Jimmy 2026-10-29 回報 iPhone App 旋轉後錯開半頁）。iOS WKWebView 轉回直向
  // 只發一次 resize，當下 innerWidth 是過渡值（402 − 橫向左右安全區域 62×2 = 278），之後
  // 寬度回到 402 卻不再補發 resize → stride / 頁數照 278 算、scrollLeft 停在非格點。
  // 改盯卡片本身的 border-box：實際尺寸一變就重測，不依賴 window resize 有沒有補發
  let cardObserver = null;
  let cardObservedSize = '';
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
  // 2026-11-15 review P-5：翻頁期間寫進主文後代的 inline 樣式，一律經「寫入日誌」記原值、
  // uninstall 反序還原。原本五份清單＋五個 WeakSet（overflow / blockify / contain / flex /
  // initial-letter 各一）同形重複，而且各還各的——同一元素的 display 先後被兩條規則寫過時，
  // 還原順序不是反序，退出後殘留 JRead 自己寫的 display:flex !important（P-1）。
  //   structJournal：斷頁前中和結構（NEUTRALIZE_RULES）＋首字補上緣。同元素同屬性只記
  //     第一次的原值（重測重掃、站方 loader 改回去再寫，都不會把 JRead 寫的值當成原值）
  //   mediaFitJournal：媒體貼合。每次寫入都記一筆——fitMediaToPages 每輪重算前先全撤，
  //     量測用的 1px 暫值靠反序撤回，生命週期與上面那份不同所以分開，API 同形
  // 強制 eager 的圖（eagerForced）改的是 attribute 不是 style，不併進來
  // 2026-11-15 review P-2：structJournal 寫 display 時改走 NS.inlineSet 分層登記簿
  //（owner＝PAGED_DISPLAY_OWNER），見 createStyleJournal 註解
  const PAGED_DISPLAY_OWNER = 'paged:struct';
  const structJournal = createStyleJournal(true, PAGED_DISPLAY_OWNER);
  const mediaFitJournal = createStyleJournal(false);
  // v3.7.4：小標跟著下一段換頁（keepHeadingsWithNext）寫的 break-before / margin-top。
  // 每輪 relayout 第一步先全撤（releaseHeadingKeep），量圖與斷頁都看不到上一輪的強制分頁
  const headingKeepJournal = createStyleJournal(false);
  let remeasureDebounce = 0;         // debounce timer handle
  let lastScrollWidth = 0;            // 上次重測時的 scrollWidth（變動偵測 gate）
  let lastMediaSig = '';              // 上次重測時的媒體版面簽名（同上，見 mediaLayoutSignature）
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

  // D-7：書寫方向偵測 + scrollLeft 邏輯座標邊界（見 isRtl 註解）
  function detectRtl() {
    if (!art) return false;
    try { return getComputedStyle(art).direction === 'rtl'; } catch (e) { return false; }
  }
  function logicalScrollLeft() {
    if (!art) return 0;
    return isRtl ? -art.scrollLeft : art.scrollLeft;
  }
  function setLogicalScrollLeft(v) {
    if (!art) return;
    art.scrollLeft = isRtl ? -v : v;
  }

  // 實測 max scrollLeft（同一 frame 同步寫讀還原，無 repaint）。jsdom 無
  // clamp 會原值讀回 sentinel → 視為量不到回 0。
  const MAX_SCROLL_PROBE = 1e7;
  function measureMaxScrollLeft() {
    if (!art) return 0;
    const prev = art.scrollLeft;
    let max = 0;
    try {
      setLogicalScrollLeft(MAX_SCROLL_PROBE); // D-7：rtl 寫負值探底
      max = logicalScrollLeft();
      art.scrollLeft = prev;
    } catch (e) { return 0; }
    return max >= MAX_SCROLL_PROBE ? 0 : max;
  }

  // 內容末端在卷動座標（padding-box 原點）的位置（v2.5.49 起量最後幾個片段的起點，見下）。Safari 對已捲動狀態
  // 的 overflow column fragment rect 回報會偏移——強制 scrollLeft = 0 量測、
  // 量完還原（同一 frame 同步讀寫，無 repaint）。回 0 = 量不到。
  function measureContentEndX() {
    if (!art) return 0;
    const prev = art.scrollLeft;
    let maxRight = 0;
    try {
      art.scrollLeft = 0;
      // D-7：rtl 時內容從右緣往左長，末端是最左緣——以 right 當基準量 base − left
      const rect0 = art.getBoundingClientRect();
      const base = isRtl ? rect0.right : rect0.left;
      // v2.5.49：量每個片段「起點」所在位置（＋1px 落進該欄），不量終點。片段一定從它
      // 所在的那一欄起頭，終點卻可能畫出欄外：meta.discourse 文末燈箱 meta 列的無尺寸
      // SVG 圖示預設 300px 寬，從最後一欄右半部畫進欄間距與下一欄，用終點算會多出一頁
      // 幽靈頁（翻過去只看到上一頁被裁一半）。computePageCountFromExtent 的欄位公式不變
      const extentOf = (r) => (isRtl ? base - r.right : r.left - base) + 1;
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
            maxRight = Math.max(maxRight, extentOf(r));
          }
        }
        if (any) hits++;
      }
      // 替換元素是 atomic fragment、bounding rect 可靠（文末是圖片的文章靠這層）
      for (const el of art.querySelectorAll('img, video, iframe, svg')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) maxRight = Math.max(maxRight, extentOf(r));
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
    isRtl = detectRtl(); // D-7：layout 重測時同步刷新書寫方向（量測全走邏輯座標）
    strideExact = 0; // 先清，strideApprox 才會被重新讀取
    strideExact = quantizeStride(measureMaxScrollLeft(), strideApprox());
    const endX = measureContentEndX();
    if (!(endX > 0)) { measuredPages = 0; return; }
    let padL = 0;
    // D-7：扣的是 inline-start 內距（rtl = padding-right）
    try { padL = parseFloat(getComputedStyle(art)[isRtl ? 'paddingRight' : 'paddingLeft']) || 0; } catch (e) { /* */ }
    measuredPages = computePageCountFromExtent(endX, padL, stride());
  }

  // v1.6.15：重測頁數並和目前狀態對齊——刷新頁碼指示文字；若目前頁碼已超過新頁數
  // （內容縮水）clamp 回最後一頁，不然停在幽靈位置。內容驅動重測與固定計時器共用。
  function remeasureAndReconcile() {
    if (!installed || !art) return;
    // 晚載入內容可能讓 scroll container / inline-* 原子盒事後長高過一頁（v1.7.46 /
    // v1.9.13）、首字段落晚到（v2.4.8）、圖撐開後要重新貼合（v1.9.25）——整套重跑
    relayout();
    const t = pageCount();
    if (idx > t - 1) goTo(t - 1, false);
    else renderIndicator();
    // v2.5.18：版面重排完成 → 通知位置記憶。進場捲動同步的錨點要在這時重新量落在
    // 第幾頁（position-memory onPagedRelayout；使用者動過就不搬，閘門在那邊）。
    // 只通知、不帶資料；對方不在或丟例外都不影響重測
    try {
      const pmem = global.__JRead && global.__JRead.positionMemory;
      if (pmem && typeof pmem.onPagedRelayout === 'function') pmem.onPagedRelayout();
    } catch (e) { /* 通知失敗不影響重測 */ }
  }

  // 2026-11-15 review P-3：媒體版面簽名——主文內每張圖「碎片總高：碎片數」串起來。
  // 用途只有一個：判斷「後代媒體載入後，版面有沒有變到需要整套重跑」。
  //   - 預留尺寸的圖載入：盒子不變 → 簽名不變 → 不重跑（v1.6.15 省成本的原意）
  //   - 沒預留尺寸的圖晚載入：自己的高從 0 變成 N → 簽名變 → 重跑
  //   - 被它推擠而跨頁的其他圖：碎片數變 → 也看得到
  // 只取高與碎片數、不取座標：使用者翻頁後 scrollLeft 不同，座標不可比。
  // 成本：wiki Glass（6K 元素、45 張圖）0.07ms，整套 relayout 是 35ms（CDP 實測）。
  function mediaLayoutSignature() {
    if (!art) return '';
    let sig = '';
    try {
      for (const img of art.querySelectorAll('img')) {
        const rects = img.getClientRects();
        let h = 0;
        for (const r of rects) h += r.height;
        sig += Math.round(h) + ':' + rects.length + ',';
      }
    } catch (e) { return ''; }
    return sig;
  }
  // 純決策函式：媒體載入後要不要整套重跑
  function layoutChangedSince(sw, lastSw, sig, lastSig) {
    return sw !== lastSw || sig !== lastSig;
  }

  // v1.6.15：後代媒體載入 → debounce 重測。版面沒變則跳過（reserved-dimension 站
  // 圖片載入不撐 layout、無需重算，省 relayout 的整套掃描成本）。trailing debounce：
  // 一批同時載入的圖只重測一次，晚到的圖各自再觸發。
  // 2026-11-15 review P-3：「版面沒變」原本只看 scrollWidth——multicol 容器的
  // scrollWidth 只在欄數改變時才變，圖晚載入撐高內容但總欄數沒變（最後一欄的空位
  // 吃掉增量）時直接跳過，fitMediaToPages 不會重跑：那張圖維持單頁 cap 高度，整個
  // figure 被推到下一頁、前一頁留一大片空白（合成頁 probe：5 秒後才給 src 的圖，
  // 兩個引擎都留 249px 空白；v1.9.25 要修的症狀在後段頁面重現）。進場 1s / 3s 的
  // 固定計時器無條件重測，漏的是 3 秒後才載入的圖（站方 JS lazy loader 翻到該頁才換
  // src）。閘門加看媒體版面簽名。
  function scheduleRemeasure() {
    if (remeasureDebounce) clearTimeout(remeasureDebounce);
    remeasureDebounce = setTimeout(function () {
      remeasureDebounce = 0;
      if (!installed || !art) return;
      let sw = 0;
      try { sw = art.scrollWidth; } catch (e) { /* */ }
      // 欄數沒變、每張圖的高與碎片數也沒變（多為 reserved 尺寸圖）→ 不重算
      if (!layoutChangedSince(sw, lastScrollWidth, mediaLayoutSignature(), lastMediaSig)) return;
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

  // ---- 斷頁前處理（2026-11-15 review P-5 收斂）----
  //
  // 多欄分頁靠瀏覽器把內容切成一欄一欄。站方的某些結構會讓引擎「不切」或「不照
  // break-* 控制」，翻頁模式進場後要先把這些結構中和掉，量到的頁數與圖片位置才是真的。
  // 這一段原本散成五份還原清單、兩條硬塞進同一個迴圈的規則、三處手抄的執行順序，
  // 收斂成四件事：
  //   createStyleJournal   寫入日誌：記原值、反序還原
  //   NEUTRALIZE_RULES     規則表：「主文後代符合某個 computed style ＋高度條件 → 寫一條
  //                        inline !important」。加新規則＝表裡加一列
  //   LAYOUT_PASSES        流程表：中和結構 → 首字補上緣 → 媒體貼合 → 量頁數
  //   relayout()           install / remeasureAndReconcile / onResize 唯一入口
  // 順序依賴由 test/regression/paged-layout-pass-order.spec.js 守。
  // 所有規則都不判斷 UA——兩個引擎一體適用，只是各自會踩到的不同。

  // 寫入日誌。firstWriteOnly = true：同元素同屬性只記第一次的原值（之後重掃再寫、
  // 另一條規則寫同一屬性，還原目標仍是站方最初的 inline 狀態）；false：每次寫入各記
  // 一筆，靠反序撤回疊加的暫值。
  //   has(el, prop)            這個元素的這個屬性記過了嗎
  //   record(el, prop, also)   只記原值不寫；also＝還原時要一併寫回的 longhand（overflow-x / -y）
  //   set(el, prop, val)       記原值＋寫 inline !important
  //   undoLast() / restoreAll()  撤最後一筆／反序全撤
  //
  // displayOwner（2026-11-15 review P-2 / B-04）：給了就把 `display` 的寫入與還原交給
  // NS.inlineSet / inlineRelease 分層登記簿（v1.9.18 立的規則：誰寫 inline display 誰登記）。
  // 原本日誌自己記原值、自己寫回——翻頁期間把單圖 flex 殼塌成 block 之後，使用者在編輯
  // 模式點掉那個殼（或動態 observer 把它藏掉），cleaner 那一層記到的「原值」是這裡寫的
  // `block !important`；退出時翻頁先還原、cleaner 後還原，把 block !important 寫回去，
  // 原站的 flex 版面在退出後壞掉（合成頁 probe 兩個引擎都重現）。走登記簿後任何還原
  // 順序都回到站方原值。規則表內兩條寫 display 的規則共用同一個 owner：同元素先後被
  // 兩條命中（P-1）時登記簿只更新值、不疊層，與 firstWriteOnly 的語意一致。
  // 登記簿缺席（最小 NS 的 jsdom 環境）退回日誌自己的快照路徑。
  function createStyleJournal(firstWriteOnly, displayOwner) {
    const ledger = (prop) => {
      if (!displayOwner || prop !== 'display') return null;
      const ns = (typeof window !== 'undefined' && window.__JRead) || null;
      return ns && typeof ns.inlineSet === 'function' && typeof ns.inlineRelease === 'function' ? ns : null;
    };
    let entries = [];
    let seen = new WeakMap(); // el → Set<prop>
    function has(el, prop) {
      const s = seen.get(el);
      return !!s && s.has(prop);
    }
    function record(el, prop, also) {
      if (firstWriteOnly) {
        if (has(el, prop)) return false;
        let s = seen.get(el);
        if (!s) { s = new Set(); seen.set(el, s); }
        s.add(prop);
      }
      const saved = [];
      for (const p of [prop].concat(also || [])) {
        saved.push([p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]);
      }
      entries.push({ el, prop, saved });
      return true;
    }
    function set(el, prop, val) {
      record(el, prop);
      const ns = ledger(prop);
      if (ns) ns.inlineSet(el, prop, val, 'important', displayOwner);
      else el.style.setProperty(prop, val, 'important');
    }
    function undoLast() {
      const r = entries.pop();
      if (!r) return;
      try {
        const ns = ledger(r.prop);
        // 登記簿有這一層 → 由它還原 / 轉交（上面還壓著 cleaner-hide 時不動目前可見狀態）
        if (!(ns && ns.inlineRelease(r.el, r.prop, displayOwner))) {
          r.el.style.removeProperty(r.prop);
          for (const [p, v, pri] of r.saved) if (v) r.el.style.setProperty(p, v, pri);
        }
      } catch (e) { /* */ }
      const s = seen.get(r.el);
      if (s) s.delete(r.prop);
    }
    function restoreAll() {
      while (entries.length) undoLast();
      seen = new WeakMap();
    }
    return { has, record, set, undoLast, restoreAll, size: () => entries.length };
  }

  // 頁面幾何：欄高（＝頁高，art content-box 高）、第 0 欄內容區的頂 / 底 / 左緣
  //（viewport 座標）。量不到（jsdom 無 layout）回 null，呼叫端 no-op
  function pageBox() {
    if (!art) return null;
    try {
      const cs = getComputedStyle(art);
      const pageH = art.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      if (!(pageH > 0)) return null;
      const rect = art.getBoundingClientRect();
      const top = rect.top + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
      return {
        pageH,
        top,
        bottom: top + pageH,
        contentLeft: rect.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0)
      };
    } catch (e) { return null; }
  }

  // 多欄下一個元素被切成幾段就有幾個 rect；getBoundingClientRect 是跨欄聯集，量不到
  // 「實際佔了多少高度」。量高度一律加總各段
  const fragHeight = (el) => {
    let h = 0;
    for (const r of el.getClientRects()) h += r.height;
    return h;
  };

  // 「要貼合的圖」的單一判定（規則 singleMediaFlexShell 與 fitMediaToPages 共用）：
  // 排除行內小圖與 player 內的圖；碎片總高 ≥ FIT_MIN_PX（更矮的是 icon / 隱藏 / 還沒
  // 撐開的圖）。回傳碎片總高，0＝不是候選
  const FIT_MIN_RATIO = 0.5;
  const FIT_MIN_PX = 120;
  function fitImgHeight(img) {
    if (img.hasAttribute('data-jread-inline-img') || img.hasAttribute('data-jread-player')) return 0;
    const h = fragHeight(img);
    return h >= FIT_MIN_PX ? h : 0;
  }
  function isFitCandidateImg(img) {
    return fitImgHeight(img) > 0;
  }
  function countFitImgs(el) {
    let n = 0;
    for (const img of el.querySelectorAll('img')) {
      if (isFitCandidateImg(img)) n++;
      if (n > 1) break;
    }
    return n;
  }

  // ---- NEUTRALIZE_RULES 用到的純函式與常數 ----

  const INLINE_ATOMIC_TO_BLOCK = {
    'inline-block': 'block', 'inline-flex': 'flex', 'inline-grid': 'grid', 'inline-table': 'table'
  };
  const REPLACED_TAG_RE = /^(img|video|iframe|svg|canvas|object|embed|picture)$/i;
  const BODY_BOX_MIN_TEXT_SHARE = 0.5;
  const BODY_BOX_MIN_PAGE_SHARE = 0.25;
  const BODY_BOX_CLIP_TOLERANCE = 2;
  function isUnclippedBodyBox(el, artTextLen) {
    if (REPLACED_TAG_RE.test(el.tagName || '')) return false;
    const textLen = String(el.innerText == null ? el.textContent : el.innerText).trim().length;
    if (!(artTextLen > 0) || textLen / artTextLen < BODY_BOX_MIN_TEXT_SHARE) return false;
    return el.scrollHeight - el.clientHeight <= BODY_BOX_CLIP_TOLERANCE
      && el.scrollWidth - el.clientWidth <= BODY_BOX_CLIP_TOLERANCE;
  }
  // 純函式：回傳去掉 layout 後的 contain 值；本來就沒有 layout containment 回 null
  function stripLayoutContain(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw || raw === 'none' || raw === 'normal') return null;
    const tokens = [];
    for (const t of raw.split(/\s+/)) {
      if (t === 'strict') tokens.push('size', 'layout', 'paint', 'style');
      else if (t === 'content') tokens.push('layout', 'paint', 'style');
      else tokens.push(t);
    }
    if (!tokens.includes('layout')) return null;
    const rest = tokens.filter((t) => t !== 'layout');
    return rest.length ? rest.join(' ') : 'none';
  }
  // v2.5.23：同一種展開法，拿掉 paint（見 NEUTRALIZE_RULES 的 tallPaintContain）
  function stripPaintContain(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw || raw === 'none' || raw === 'normal') return null;
    const tokens = [];
    for (const t of raw.split(/\s+/)) {
      if (t === 'strict') tokens.push('size', 'layout', 'paint', 'style');
      else if (t === 'content') tokens.push('layout', 'paint', 'style');
      else tokens.push(t);
    }
    if (!tokens.includes('paint')) return null;
    const rest = tokens.filter((t) => t !== 'paint');
    return rest.length ? rest.join(' ') : 'none';
  }
  // 2026-11-15 review B-03：「flex / grid 殼要不要塌」的判定表住 NS.flexShellVerdict
  //（styler passGalleryFlex、cleaner collapseInnerFlexWrap 問同一張表）；這裡蒐集的事實
  // 是「子樹內要貼合的大圖張數」（呼叫端用 countFitImgs 數）＋ paged 政策參數。
  // NS 缺席（直接 require 本檔的 node 環境，沒有 layout）一律不塌。
  const flexShellNs = () => {
    const ns = (typeof window !== 'undefined' && window.__JRead) || null;
    return ns && typeof ns.flexShellVerdict === 'function' ? ns : null;
  };
  const isFlexGridDisplay = (display) => {
    const ns = flexShellNs();
    return !!ns && ns.FLEX_SHELL_DISPLAYS.has(String(display || ''));
  };
  function isSingleMediaFlexShell(display, bigImgCount) {
    const ns = flexShellNs();
    return !!ns && ns.flexShellVerdict({ display, subtreeFitMediaCount: bigImgCount, paged: true }).collapse;
  }
  const isClippingOverflow = (v) => v === 'auto' || v === 'scroll' || v === 'hidden';

  // 高度門檻。monolithic 且高過一頁才會裁掉內容；可斷片元素的 fragment 聯集高 ≈ 頁高，
  // 留 TALL_SLACK_PX 不誤中
  const TALL_SLACK_PX = 4;
  const isTallerThanPage = (h, pageH) => h > pageH + TALL_SLACK_PX;
  // clippedScrollBox：被裁掉的高度超過這個值才算「內容藏在框裡」（不到一行的捨入誤差不動）
  const CLIPPED_SCROLL_MIN_PX = 20;
  // 「放得下一張要處理的媒體」的盒子：≥ FIT_MIN_PX（layoutContain / singleMediaFlexShell
  // 共用）。v2.4.12 以前這兩條與 unclippedBodyBox 共用同一個閘門，實際門檻是
  // min(120px, 頁高 × 25%)——手機橫向時 70–120px 的盒子也會被處理。v2.4.14 收緊成單純的
  // FIT_MIN_PX（Jimmy 2026-11-15 裁定）：比它矮的盒子裝不下會被貼合的圖（fitImgHeight 同一
  // 個門檻），處理了也沒有要控制的東西。pageH 參數留著是規則表 minHeight 的統一簽名
  const canHoldFitMedia = (h) => h >= FIT_MIN_PX;

  // 解 overflow 的共用寫入（tallScrollContainer / unclippedBodyBox）：三個 inline 值一起記，
  // 還原時 shorthand 與 longhand 都寫回
  function unclipOverflow(ctx) {
    structJournal.record(ctx.el, 'overflow', ['overflow-x', 'overflow-y']);
    try { ctx.el.style.setProperty('overflow', 'visible', 'important'); } catch (e) { /* */ }
  }
  // v2.5.23：高過一頁的捲動框解開後，裡面的程式碼長行改成自動換行。
  // 解開（overflow: visible）的代價是橫向也不裁了：<pre> 的長行直接畫出框外、伸進
  // 右邊留白；落在最後一頁時還會撐大可捲寬度，翻頁步距跟著偏（react.dev 攤開後的
  // Sandpack：scrollWidth 多 44px，每翻一頁偏 2px，第 7 頁程式碼框已左移 13px——
  // probe 實測；pre 改 pre-wrap 後 scrollWidth 回到頁寬的整數倍）。
  // overflow 兩軸綁在一起（一軸 visible 另一軸不是 → visible 被算成 auto），沒辦法
  // 只解直向，所以改讓內容不要超寬。只在解開前真的有橫向溢出時才動；表格這類不是
  // <pre> 的寬內容不在此列。
  function unclipTallScroller(ctx) {
    let wide = false;
    try { wide = ctx.el.scrollWidth > ctx.el.clientWidth + 1; } catch (e) { /* */ }
    unclipOverflow(ctx);
    if (!wide) return;
    const pres = /^pre$/i.test(ctx.el.tagName || '') ? [ctx.el] : Array.from(ctx.el.querySelectorAll('pre'));
    for (const pre of pres) wrapPreLines(pre);
  }
  // v2.5.42：<pre> 改成可折行時，底下自己宣告不折行的後代一起改。kubernetes 的
  // <pre><code> 裡 code 自己寫了 white-space: pre，pre 上的 pre-wrap 繼承不下去——長行
  // 照樣不折（內容寬 1,448px、框寬 574px，真站 probe），溢出右緣畫進下一頁、蓋在內文上
  const NOWRAP_WS = { pre: 'pre-wrap', nowrap: 'normal' };
  function wrapPreLines(pre) {
    structJournal.set(pre, 'white-space', 'pre-wrap');
    structJournal.set(pre, 'overflow-wrap', 'anywhere');
    let kids;
    try { kids = pre.querySelectorAll('*'); } catch (e) { return; }
    for (const d of kids) {
      let ws = '';
      try { ws = getComputedStyle(d).whiteSpace; } catch (e) { continue; }
      if (!NOWRAP_WS[ws]) continue;
      structJournal.set(d, 'white-space', NOWRAP_WS[ws]);
      structJournal.set(d, 'overflow-wrap', 'anywhere');
    }
  }
  // v2.5.42：站方沒給 <pre> overflow（預設 visible）時，長行直接畫出框外、伸進下一欄，
  // 蓋在下一頁的內文上（stackoverflow 回放實證：站方 pre { overflow: auto } 沒載到的
  // 狀態；任何沒給 pre 設 overflow 的站都一樣）。overflow-x 是 visible 而且內容比框寬
  // 的 <pre> 改成可折行。overflow: auto / scroll 的 <pre>（站方給了橫捲；放得進一頁時
  // 整塊不切、高過一頁時由 tallScrollContainer 解開）不歸這裡。只掃 <pre>，不進
  // NEUTRALIZE_RULES 的逐元素掃描（那張表靠高度門檻篩掉絕大多數元素，pre 沒有高度門檻）
  function wrapSpillingPres() {
    let pres;
    try { pres = art.querySelectorAll('pre'); } catch (e) { return; }
    for (const pre of pres) {
      try {
        const cs = getComputedStyle(pre);
        let ox = cs.overflowX || '';
        // jsdom 不展開 overflow shorthand（見 makeRuleCtx）
        if (!ox) ox = String(cs.overflow || '').trim().split(/\s+/)[0] || '';
        if (ox && ox !== 'visible') continue;
        if (!(pre.scrollWidth > pre.clientWidth + 1)) continue;
        wrapPreLines(pre);
      } catch (e) { /* 單一元素失敗不擋其他 */ }
    }
  }

  // v3.7.7：程式碼與表格整塊推頁（Jimmy 2026-11-27 裁定 C：高度不到半頁的整塊推，超過半頁
  // 的允許從中間切開——表格逐列、程式碼逐行）。語料庫 KNOWN-ISSUES 第四節：MDN、rust、
  // kubernetes、jestjs、sspai、toss、engadget 前一頁大片空白。推頁的兩個來源（probe 實測）：
  //   (a) 翻頁 CSS 對所有 <figure> 下 break-inside: avoid——sspai 的表格包在 figure.table、
  //       rust 的程式碼包在 figure.listing，整個 figure 不可切
  //   (b) 放得進一頁的捲動框（overflow auto / scroll 的 <pre>、<code>、表格外殼）瀏覽器視為
  //       monolithic，整塊不可切（v1.7.46 同一個機制；高過一頁的已由 tallScrollContainer 解開）
  // 兩者都只在「超過半頁」時解開；寬表格（有橫向溢出、裡面沒有 <pre> 可以改成折行）解開
  // 會畫出框外，維持整塊推。
  const SPLIT_BLOCK_PAGE_SHARE = 0.5;
  const SCROLL_SHELL_MIN_PX = 40;
  const isOverHalfPage = (h, pageH) => !isTallerThanPage(h, pageH) && h > pageH * SPLIT_BLOCK_PAGE_SHARE;
  const CODE_TABLE_SEL = 'pre, table';
  const SPLIT_MEDIA_SEL = 'img, picture, video, iframe, canvas, object, embed';
  function isCodeOrTableBlock(el) {
    if (/^(pre|table|code)$/i.test(el.tagName || '')) return true;
    try { return !!el.querySelector(CODE_TABLE_SEL); } catch (e) { return false; }
  }
  const isUserScroll = (v) => v === 'auto' || v === 'scroll';
  // v3.7.7：squidfunk 程式碼推走後上一頁底留一塊沒字的灰框（18–130px）。站方的灰底畫在
  // 外層 <pre>（可切），可捲的是裡面的 <code>（monolithic）——<code> 整塊推到下一頁，
  // <pre> 的第一片只剩上內距與底色留在頁底。把「只包這一個捲動框」的外殼（往上 3 層、
  // 不超過一頁高）一起標成不可切，外殼跟著整塊走。外殼另有別的看得到的子元素或直接文字
  // 就停（那是一般容器，不是程式碼框的殼）
  const SHELL_AVOID_MAX_UP = 3;
  function hasOnlyChild(parent, child) {
    for (const n of parent.childNodes) {
      if (n === child) continue;
      if (n.nodeType === 3) { if (n.nodeValue.trim()) return false; continue; }
      if (n.nodeType !== 1) continue;
      // 看得到＝有框、而且有字或有寬高（squidfunk <pre> 開頭的空 <span> 有一個零寬框，不算）
      let r = null;
      try { r = n.getClientRects().length ? n.getBoundingClientRect() : null; } catch (e) { /* */ }
      if (!r) continue;
      if ((n.textContent || '').trim() || (r.width > 0 && r.height > 0)) return false;
    }
    return true;
  }
  function avoidScrollBoxShells(ctx) {
    let child = ctx.el;
    for (let up = 0; up < SHELL_AVOID_MAX_UP; up++) {
      const parent = child.parentElement;
      if (!parent || parent === art || !art.contains(parent)) return;
      if (!hasOnlyChild(parent, child)) return;
      let h = 0;
      try { h = parent.getBoundingClientRect().height; } catch (e) { return; }
      if (isTallerThanPage(h, ctx.pageH)) return;
      structJournal.set(parent, 'break-inside', 'avoid');
      child = parent;
    }
  }

  // v3.7.7：flex / grid 容器的項目（display: contents 的外殼攤開算到下一層）有沒有非 0 的 order
  function hasOrderedFlexItems(el) {
    const items = [];
    const collect = (p, depth) => {
      for (const c of p.children) {
        let d = '';
        try { d = getComputedStyle(c).display; } catch (e) { continue; }
        if (d === 'contents' && depth < 3) collect(c, depth + 1);
        else if (d !== 'none') items.push(c);
      }
    };
    collect(el, 0);
    for (const c of items) {
      let o = 0;
      try { o = parseInt(getComputedStyle(c).order, 10) || 0; } catch (e) { /* */ }
      if (o !== 0) return true;
    }
    return false;
  }

  // 規則表。neutralizeStructure 對主文每個後代依表序套用：
  //   id          規則名（順序測試與日誌用）
  //   since       加入的版本
  //   minHeight   (h, pageH) → 夠不夠高。只看 getBoundingClientRect 的高，不讀 computed
  //               style——絕大多數元素在這一步就被篩掉，成本結構靠它
  //   match       (ctx) → 命中與否。ctx.cs 是 live 的 computed style：前面的規則寫入後，
  //               後面的規則讀到的是寫入後的值（singleMediaFlexShell 塌成 block 之後，
  //               tallInlineAtomic 同一輪不會再命中同一個元素）
  //   apply       (ctx) → 寫入，一律經 structJournal
  //   once        同一個元素只套一次（之後被站方改回去也不再寫）
  // 表內順序＝執行順序。整張表都排在 fitMediaToPages 之前（LAYOUT_PASSES）：WebKit 在
  // layout containment / flex item 內無視 break-*，貼合寫的東西要等這裡先解開才有效。
  const NEUTRALIZE_RULES = [
    // v2.4.3：layout containment（Jimmy 2026-11-10 Mac Safari 翻頁模式 houseandgarden
    // gallery「第 13、14 頁之間把圖切成兩半」）。站方在 gallery slide 外層掛
    // contain: layout style（li 與多層 wrapper）。WebKit 在 layout-contained 盒子內部
    // 不照 break-before / break-inside: avoid 分頁：fitMediaToPages 寫上的
    // break-before: column 與 figure 的 avoid 全被無視，圖照樣跨頁硬切（Playwright
    // WebKit 實站 probe：7 張圖 3 張被切；把 contain 裡的 layout 拿掉 → 全部從頁頂起、
    // 0 張被切；只拿掉 paint 無效、只留 style 有效＝兇手是 layout）。Chromium 照常分頁
    // 所以只有 Safari 中。修法：翻頁期間把主文後代 computed contain 的 layout 關鍵字
    // 拿掉（strict / content 先展開），其餘 containment（size / paint / style）保留。
    // 高度門檻只是省 getComputedStyle：放不下一張媒體的矮盒子內部不會有要跨頁控制的東西。
    {
      id: 'layoutContain',
      since: 'v2.4.3',
      minHeight: canHoldFitMedia,
      match(ctx) {
        ctx.contain = stripLayoutContain(ctx.cs.contain || ctx.el.style.getPropertyValue('contain'));
        return ctx.contain !== null;
      },
      apply(ctx) {
        structJournal.record(ctx.el, 'contain');
        ctx.el.style.setProperty('contain', ctx.contain, 'important');
      }
    },
    // v2.5.23：高過一頁的盒子帶 paint containment → WebKit 只畫得出第一片，其餘各頁
    // 整塊空白（react.dev Sandpack 外殼 contain: content；上一條拿掉 layout 後剩
    // style paint。Playwright WebKit 實站：2265px 的程式碼框切成 4 片、第 2–4 片全白；
    // 把 contain 設成 none 後各頁正常——截圖對照。Chromium 兩種都正常）。
    // paint containment 的定義就是「不畫出自己的盒子外面」，跨頁的片段落在盒子的
    // 主片段之外。上一條 v2.4.3 的「只拿掉 paint 無效」講的是另一個症狀（break-* 被
    // 無視），兩條互不取代。只動高過一頁的：放得進一頁的盒子不跨頁，paint 留著無妨。
    // 排在 layoutContain 之後：接上一條算出的值（ctx.contain）。
    {
      id: 'tallPaintContain',
      since: 'v2.5.23',
      minHeight: isTallerThanPage,
      match(ctx) {
        // 上一條剛寫過就直接接它的結果（ctx 同元素共用）；不靠 computed style 即時更新
        const cur = typeof ctx.contain === 'string' ? ctx.contain : (ctx.cs.contain || ctx.el.style.getPropertyValue('contain'));
        ctx.containNoPaint = stripPaintContain(cur);
        return ctx.containNoPaint !== null;
      },
      apply(ctx) {
        structJournal.record(ctx.el, 'contain');
        ctx.el.style.setProperty('contain', ctx.containNoPaint, 'important');
      }
    },
    // v2.4.5：媒體在 flex / grid 容器內（Jimmy 2026-11-10 Mac Safari 27 翻頁模式
    // foreignaffairs「第一頁的圖就會被切到」）。hero 與標題區並排在 section.topper
    //（display:flex）裡；cleaner 的 collapseInnerFlexWrap 只在子項已換行時才塌，寬視窗下
    // 沒換行 → flex 留著。WebKit 對 flex / grid item 內部不照 break-before /
    // break-inside: avoid 分頁，fitMediaToPages 的 shrink / break 都失效，圖照樣跨頁硬切
    //（Playwright WebKit 實站 probe：section 留 flex → 圖切成 418 + 148px 兩段，與 Jimmy
    // 截圖寬 364 一致；塌成 block → 縮進第 1 頁、0 段被切）。修法：翻頁期間把「只含一張
    // 要貼合的大圖」的 flex / grid 容器塌成 block，讓媒體回到可分頁的 block flow；含兩張
    // 以上大圖的（並排 gallery）不動，避免把刻意並排的圖拆成上下堆疊。
    // 必須排在 tallInlineAtomic 之前：兩條都寫 display，這條先把殼塌成 block，後者讀到
    // 的 computed display 已不是 inline-*，同一輪不會疊第二層。
    {
      id: 'singleMediaFlexShell',
      since: 'v2.4.5',
      minHeight: canHoldFitMedia,
      once: true,
      match(ctx) {
        // 先看 display 再數圖：countFitImgs 要量每張圖的碎片高，非 flex / grid 的盒子不必數
        // v3.7.7：項目靠 CSS order 排序的不塌——塌成 block 就退回 DOM 順序（propublica 頁首
        // `p-opener` 直向 flex：標題 order 2、導言 3、首圖 4，DOM 裡首圖在前；翻頁模式變成
        //「首圖→標題→導言」，捲動模式是「標題→導言→首圖」）
        return isFlexGridDisplay(ctx.cs.display) && !hasOrderedFlexItems(ctx.el) &&
          isSingleMediaFlexShell(ctx.cs.display, countFitImgs(ctx.el));
      },
      apply(ctx) {
        structJournal.set(ctx.el, 'display', 'block');
      }
    },
    // v2.5.23：高過一頁的直向 flex 容器、裡面只有一個看得到的子元素 → 塌成 block。
    // Chromium 把 flex 容器切成各頁片段時，容器高度照「沒分頁」的排版算；子元素被
    // 分頁後每個頁底會浪費不滿一行的空間、實際要的高度比較多，多出來的部分落在容器
    // 外面被下一段內容蓋住（react.dev 攤開後的 Sandpack 編輯器：pre 片段加總 2362、
    // 外層 flex 直欄 2304，程式碼最後一行半被切掉；改 block 後兩者都是 2362——probe
    // 實測。WebKit 沒有這個落差）。只有一個子元素的直向 flex 與 block 排版等價
    //（沒有 gap、order、分配空間可言），所以只收這種。
    // 排在 tallInlineAtomic 之前，理由同上一條（都寫 display）。
    {
      id: 'tallSingleChildFlexColumn',
      since: 'v2.5.23',
      minHeight: isTallerThanPage,
      once: true,
      match(ctx) {
        const d = ctx.cs.display || '';
        if (d !== 'flex' && d !== 'inline-flex') return false;
        if (!/^column/.test(ctx.cs.flexDirection || '')) return false;
        let shown = 0;
        for (const ch of ctx.el.children) {
          let n = 0;
          try { n = ch.getClientRects().length; } catch (e) { /* */ }
          if (n > 0 && ++shown > 1) return false;
        }
        return shown === 1;
      },
      apply(ctx) {
        structJournal.set(ctx.el, 'display', 'block');
      }
    },
    // v1.7.46：翻頁模式內容整塊消失（Gmail 信件）。瀏覽器把 scroll container（computed
    // overflow-x/y 為 auto / scroll / hidden 任一——三值都建立可捲容器）視為 monolithic：
    // 多欄斷片時整塊不可切（隔離實驗實證；visible / clip 可斷片）。主文包在這種容器裡
    //（Gmail 內文 .ii.gt 是 overflow-y:auto、.a3s 是 overflow-x:auto）且內容比一頁高時，
    // 整塊被推到下一欄、超出部分被卡片的 overflow:hidden 裁掉——第一頁只剩標題、內文全滅
    //（cage 實證：6663px 內文整塊落在第 2 欄）。修法：「高度超過一頁的 scroll container」
    // 強制 overflow:visible（inline !important 蓋過站方 stylesheet）恢復可斷片。
    // 結構性通則、不綁站點：只看「scroll container ＋ 高度 > 頁高」兩個特徵。
    // 高度放得進一頁的 scroll container（如 overflow-x:auto 的寬 <pre>）刻意不動
    // ——整塊進一頁無內容損失，保留內捲行為。
    {
      id: 'tallScrollContainer',
      since: 'v1.7.46',
      minHeight: isTallerThanPage,
      match(ctx) {
        const o = ctx.overflow();
        return isClippingOverflow(o.x) || isClippingOverflow(o.y);
      },
      apply: unclipTallScroller
    },
    // v3.7.7：超過半頁的程式碼 / 表格捲動框解開成可切（見 SPLIT_BLOCK_PAGE_SHARE 註解 (b)）。
    // 只收 auto / scroll；直向有裁到內容的交給下一條 clippedScrollBox；有橫向溢出時只收
    // 含 <pre> 的（長行改折行，同 tallScrollContainer），寬表格維持整塊
    {
      id: 'halfPageScrollBlock',
      since: 'v3.7.7',
      minHeight: isOverHalfPage,
      match(ctx) {
        const o = ctx.overflow();
        if (!isUserScroll(o.x) && !isUserScroll(o.y)) return false;
        const el = ctx.el;
        if (!isCodeOrTableBlock(el)) return false;
        if (el.scrollHeight - el.clientHeight > CLIPPED_SCROLL_MIN_PX) return false;
        if (el.scrollWidth > el.clientWidth + 1) {
          const hasPre = /^pre$/i.test(el.tagName || '') || !!el.querySelector('pre');
          if (!hasPre) return false;
        }
        return true;
      },
      apply: unclipTallScroller
    },
    // v3.7.7：超過半頁、包程式碼或表格的 break-inside: avoid 盒子（翻頁 CSS 的 figure 規則、
    // 站方自己下的）改回可切（見 SPLIT_BLOCK_PAGE_SHARE 註解 (a)）。帶媒體的不動——那是
    // 圖文 figure，圖不跨頁的規則要留
    {
      id: 'halfPageAvoidCodeTable',
      since: 'v3.7.7',
      // 比一頁還高的也要收：Chromium 對放不下的 avoid 盒子仍會先推到新的一頁頂端再切
      //（sspai 第二張表 1,341px，前一頁留 550px 空白——probe 實測）
      minHeight: (h, pageH) => h > pageH * SPLIT_BLOCK_PAGE_SHARE,
      match(ctx) {
        if (ctx.cs.breakInside !== 'avoid' && ctx.cs.breakInside !== 'avoid-column' && ctx.cs.breakInside !== 'avoid-page') return false;
        if (!isCodeOrTableBlock(ctx.el)) return false;
        try { if (ctx.el.querySelector(SPLIT_MEDIA_SEL)) return false; } catch (e) { return false; }
        return true;
      },
      apply(ctx) {
        structJournal.set(ctx.el, 'break-inside', 'auto');
      }
    },
    // v3.7.7：還留著的程式碼 / 表格捲動框（不到半頁、或寬表格），只包它的外殼一起不可切
    //（見 avoidScrollBoxShells）。排在上面兩條之後：解開的框 overflow 已是 visible，不會命中
    {
      id: 'scrollBoxShellAvoid',
      since: 'v3.7.7',
      minHeight: (h, pageH) => !isTallerThanPage(h, pageH) && h >= SCROLL_SHELL_MIN_PX,
      match(ctx) {
        const o = ctx.overflow();
        if (!isUserScroll(o.x) && !isUserScroll(o.y)) return false;
        return isCodeOrTableBlock(ctx.el);
      },
      apply: avoidScrollBoxShells
    },
    // v2.5.49：放得進一頁、但內容被直向裁掉的內捲框（ar 維基參考文獻外層 div.reflist-wrap：
    // max-height 300px、overflow auto，33 條只露出前 4 條半）。上一條「矮的不動、保留內捲」
    // 的前提是使用者捲得動，但翻頁模式滾輪一律轉成翻頁（onWheel），框裡其餘內容等於不見。
    // 只收 auto / scroll（站方給使用者捲的）；hidden 是站方刻意收合，不在此列。有橫向溢出的
    // 不動：overflow 兩軸綁在一起，解開會讓寬內容畫出框外（寬 <pre>、寬表格的內捲照舊）。
    // 攤開＝overflow visible＋max-height none＋height auto，之後比一頁高就照常分頁
    {
      id: 'clippedScrollBox',
      since: 'v2.5.49',
      minHeight: (h, pageH) => !isTallerThanPage(h, pageH) && h >= FIT_MIN_PX,
      match(ctx) {
        if (/^(textarea|select)$/i.test(ctx.el.tagName || '')) return false;
        const o = ctx.overflow();
        if (o.y !== 'auto' && o.y !== 'scroll') return false;
        const el = ctx.el;
        return el.scrollHeight - el.clientHeight > CLIPPED_SCROLL_MIN_PX &&
          el.scrollWidth <= el.clientWidth + 1;
      },
      apply(ctx) {
        unclipOverflow(ctx);
        structJournal.set(ctx.el, 'max-height', 'none');
        structJournal.set(ctx.el, 'height', 'auto');
      }
    },
    // v2.2.21：主文容器放得進一頁但被 overflow:hidden 鎖成 monolithic（關鍵評論網
    // .article-body、中時 .article-body）：內容沒被裁，但本頁剩餘空間不夠時整塊推到
    // 下一頁，前頁留大片空白。上一條「矮的不動」的理由對內捲 UI 成立，對主文容器不成立。
    // 條件三項都要過（92 站實測只命中主文容器）：
    //   1. 只限 hidden——auto / scroll 是站方的內捲 UI（寬 <pre>、參考文獻捲動框）
    //   2. 文字占全文至少一半——圖說、引言、作者卡這類小框占比都在 7% 以下
    //   3. 實際沒裁到東西（scroll 尺寸 ≈ client 尺寸）——解開才不會露出站方藏掉的內容
    // 高度下限只是省掉 getComputedStyle 掃描：矮框整塊推走留的空白本來就小。
    // 高過一頁的歸上一條（不必過這三項）。
    {
      id: 'unclippedBodyBox',
      since: 'v2.2.21',
      minHeight: (h, pageH) => !isTallerThanPage(h, pageH) && h >= pageH * BODY_BOX_MIN_PAGE_SHARE,
      match(ctx) {
        const o = ctx.overflow();
        return o.x === 'hidden' && o.y === 'hidden' && isUnclippedBodyBox(ctx.el, ctx.artTextLen());
      },
      apply: unclipOverflow
    },
    // v1.9.13：inline 層級原子盒（inline-block / inline-flex / inline-grid /
    // inline-table）。Chromium 把它們當一個不可切的 inline 原子（隔離實驗 19 種 display /
    // 定位組合實測：只有這四個 inline-* 不斷片，flex / grid / table / float / abs /
    // contain / transform 都能切；WebKit trunk 全部可切）。主文包在這種容器裡（商周
    // campaign 頁內文外層 .pure-u-1 是 inline-block、2610px 高）→ 內文完全不分欄，超出
    // 頁底的後半段與跨頁底的圖被卡片 overflow:hidden 裁掉、頁數少算（實測 3 頁，應為
    // 5 頁）。修法：「inline-* 原子盒 ＋ 高度 > 頁高」改成對應的 block 層級值（內部排版
    // 模式不變、只把外部顯示型別從 inline 換成 block）。replaced 元素（img / video /
    // iframe…）本質不可切、交給 styler 的單頁 max-height cap，不在此處理。放得進一頁的
    // inline-block（按鈕、chip、小卡）不動。
    {
      id: 'tallInlineAtomic',
      since: 'v1.9.13',
      minHeight: isTallerThanPage,
      match(ctx) {
        ctx.blockDisplay = INLINE_ATOMIC_TO_BLOCK[ctx.cs.display || ''] || null;
        return !!ctx.blockDisplay && !REPLACED_TAG_RE.test(ctx.el.tagName || '');
      },
      apply(ctx) {
        structJournal.set(ctx.el, 'display', ctx.blockDisplay);
      }
    }
  ];
  const onceApplied = new Map(); // 規則 id → WeakSet<el>（once 規則的「套過了」登記，uninstall 清空）
  function resetNeutralizeState() {
    onceApplied.clear();
  }

  // 掃主文所有後代、依表序套用 NEUTRALIZE_RULES。一輪一次 querySelectorAll('*')；
  // 每個元素先量高，沒有任何規則的 minHeight 過關就不讀 computed style
  // 各頁片段高度加總（見 neutralizeStructure 的 v2.5.23 註解）。只有一片＝沒被切，回原值
  const FRAGMENT_UNION_SLACK = 2;
  function fragmentSumHeight(el, fallback) {
    let rects;
    try { rects = el.getClientRects(); } catch (e) { return fallback; }
    if (!rects || rects.length < 2) return fallback;
    let sum = 0;
    for (const r of rects) sum += r.height;
    return Math.max(sum, fallback);
  }
  function neutralizeStructure() {
    const box = pageBox();
    if (!box) return; // jsdom 無 layout → no-op（spec 以 stub 驅動）
    const pageH = box.pageH;
    let els;
    try { els = art.querySelectorAll('*'); } catch (e) { return; }
    let artTextLen = -1; // 只在遇到候選時才量（innerText 會觸發 layout）
    const readArtTextLen = () => {
      if (artTextLen < 0) artTextLen = String(art.innerText == null ? art.textContent : art.innerText).trim().length;
      return artTextLen;
    };
    for (const el of els) {
      let h = 0;
      try { h = el.getBoundingClientRect().height; } catch (e) { continue; }
      // v2.5.23：已被切成各頁片段的元素，外框是各片段的聯集、高度頂多一頁——「高過
      // 一頁」的規則全部量不到。WebKit 會把高過一頁的 scroll container 照樣切開（但
      // 內容畫不出來：react.dev Sandpack 的 overflow:auto 編輯器框，2265px 切成 4 片、
      // 每片 <= 836，整塊空白；Chromium 當 monolithic 不切、外框就是真高度）。
      // 外框高度貼近一頁時改用各片段高度加總。門檻擋掉絕大多數元素，不增加掃描成本
      if (h >= pageH - FRAGMENT_UNION_SLACK) h = fragmentSumHeight(el, h);
      let ctx = null;
      try {
        for (const rule of NEUTRALIZE_RULES) {
          if (!rule.minHeight(h, pageH)) continue;
          if (rule.once && onceApplied.has(rule.id) && onceApplied.get(rule.id).has(el)) continue;
          if (!ctx) ctx = makeRuleCtx(el, h, pageH, readArtTextLen);
          if (!rule.match(ctx)) continue;
          if (rule.once) {
            if (!onceApplied.has(rule.id)) onceApplied.set(rule.id, new WeakSet());
            onceApplied.get(rule.id).add(el);
          }
          rule.apply(ctx);
        }
      } catch (e) { continue; }
    }
    wrapSpillingPres();
  }
  // 規則的輸入。cs 是 live 的 CSSStyleDeclaration（見 NEUTRALIZE_RULES 的 match 說明）；
  // overflow 兩軸第一次用到才讀、同元素共用
  function makeRuleCtx(el, h, pageH, readArtTextLen) {
    const cs = getComputedStyle(el);
    let axes = null;
    return {
      el, h, pageH, cs,
      overflow() {
        if (axes) return axes;
        let x = cs.overflowX || '', y = cs.overflowY || '';
        // jsdom 不展開 overflow shorthand 成 longhand（回空字串）→ 退回讀 shorthand
        if (!x && !y) {
          const t = String(cs.overflow || '').trim().split(/\s+/);
          x = t[0] || ''; y = t[1] || t[0] || '';
        }
        axes = { x, y };
        return axes;
      },
      artTextLen: readArtTextLen
    };
  }

  // v2.4.8：initial-letter 首字的上緣墨跡被畫到上一頁底（Jimmy 2026-11-12 Mac Safari
  // 翻頁模式 foreignaffairs 翻譯後「第二頁文章標題的文字會被切到第一頁裡」——其實是
  // 首段的放大首字「就」）。站方 `p:first-child::first-letter { -webkit-initial-letter }`
  // 依拉丁字 cap-height 對齊首行，CJK 字的字面（em box）比 cap-height 高，墨跡凸出
  // 段落上緣。段落剛好落在某頁頂端時，WebKit multicol 依 flow 座標把凸出的墨跡畫進
  // 上一欄底部（Playwright WebKit 實站 probe：第 1 頁 ED JOHNSON 圖說下方出現
  // 「就」字頂端碎片；拉丁 "I" 沒有凸出所以英文原文看不到）。
  // 修法：翻頁期間給 initial-letter 首字所在的 block 補 padding-top，讓墨跡落在本頁的
  // padding 內（padding 不會在分頁處被截掉，margin 會）。補的量依首字行數 × 行高
  // 估算——probe 實測 4 行首字凸出 < 0.5em（8.5px 已足夠），係數取 0.15 留兩倍餘裕；
  // 只多出首字段落上方一小段空白，不影響其他段落。uninstall 還原（structJournal）。
  // 不進 NEUTRALIZE_RULES：候選集合（區塊元素）與成本結構（讀 pseudo computed style、
  // 不看高度）都不同；執行位置由 LAYOUT_PASSES 決定——補 padding 會改段落高，必須在
  // fitMediaToPages 量圖起點之前。
  // 純決策函式：initialLetter = computed initial-letter 值（'normal' / '4' / '3 2' /
  // '3 drop'），lineHeightPx = 該 block 行高
  const INITIAL_LETTER_INK_RATIO = 0.15;
  const INITIAL_LETTER_HOST_SEL = 'p, div, section, article, blockquote, li, dd';
  function initialLetterPadPx(initialLetter, lineHeightPx) {
    const m = /^\s*(\d+(?:\.\d+)?)/.exec(String(initialLetter || ''));
    if (!m) return 0;
    const n = parseFloat(m[1]);
    if (!(n > 1) || !(lineHeightPx > 0)) return 0;
    return Math.ceil(INITIAL_LETTER_INK_RATIO * n * lineHeightPx);
  }
  function readInitialLetter(cs) {
    if (!cs) return '';
    return cs.initialLetter || cs.webkitInitialLetter ||
      (cs.getPropertyValue && (cs.getPropertyValue('initial-letter') || cs.getPropertyValue('-webkit-initial-letter'))) || '';
  }
  function padInitialLetterBlocks() {
    if (!art) return;
    // 2026-11-15 review P-4：頁面樣式表沒有任何站方 first-letter 規則就不可能有
    // initial-letter 首字，整段跳過（與 styler markFirstLetterColorBlocks 共用同一道
    // gate、同一份快取）。原本每輪 relayout 對主文每個區塊元素各讀一次 pseudo computed
    // style——CDP 實測 wiki Glass（1,005 個區塊）每輪 1.2ms、wired 0.9ms，數字不大，
    // 但絕大多數站是白跑。gate 缺席（最小 NS 環境）照舊逐元素量。
    const ns = (typeof window !== 'undefined' && window.__JRead) || null;
    if (ns && typeof ns.pageHasSiteFirstLetterRule === 'function' &&
        !ns.pageHasSiteFirstLetterRule(art.ownerDocument || document)) return;
    let els;
    try { els = art.querySelectorAll(INITIAL_LETTER_HOST_SEL); } catch (e) { return; }
    for (const el of els) {
      if (structJournal.has(el, 'padding-top')) continue; // 補過的不重複補
      let pad = 0, cs;
      try {
        const il = readInitialLetter(getComputedStyle(el, '::first-letter'));
        if (!il || il === 'normal') continue;
        cs = getComputedStyle(el);
        let lh = parseFloat(cs.lineHeight);
        if (!(lh > 0)) lh = (parseFloat(cs.fontSize) || 16) * 1.2; // line-height: normal
        pad = initialLetterPadPx(il, lh);
      } catch (e) { continue; }
      if (!(pad > 0)) continue;
      const base = parseFloat(cs.paddingTop) || 0;
      structJournal.set(el, 'padding-top', (base + pad) + 'px');
    }
  }

  // v1.9.25：媒體貼合本頁剩餘空間（Readwise Reader 直式 hero，Jimmy 2026-10-16
  // Mac Safari 翻頁模式截圖）。styler 的單頁 cap（頁高 − 120px）＋ figure
  // break-inside: avoid 只保證「一張圖放得進一整頁」，沒考慮圖起點到頁底還剩多少：
  //   - Chromium：放不下就整個 figure 推到下一頁 → 前一頁下半整片空白
  //   - WebKit：break-inside: avoid 推不動時先留一段空白（實測導言底 224 → figure
  //     起點 554，中間零元素）、再把圖硬切成兩半跨頁（279px + 418px）
  // 修法：排版後逐張量「圖在自然起點時，本頁還剩多少高度給圖」——
  //   剩餘 ≥ 原高 FIT_MIN_RATIO → 等比縮到塞進本頁（shrink）
  //   剩餘太少 → figure 明確 break-before: column，下一頁頂端完整顯示（break；
  //   WebKit 不再切圖、Chromium 行為不變）
  // 另外：bare 內容圖的 upscale 規則 width:100% 遇單頁 cap ＋ object-fit:contain，
  // 直式圖盒子仍滿欄寬、圖只佔中間 → 左右露出 img 底色（「兩側灰底」）。高度被
  // 收斂時一併把寬度釘成 高 × 原始長寬比 並置中，盒子＝圖。
  // 純決策函式：jsdom spec 直接驗分支；DOM 量測住 fitMediaToPages。
  //（FIT_MIN_RATIO / FIT_MIN_PX 宣告在上面「要貼合的圖」那段——規則表也要用）
  function decideMediaFit(h0, avail) {
    if (!(h0 > 0)) return { action: 'keep' };
    if (h0 <= avail + 1) return { action: 'keep' };
    if (avail >= FIT_MIN_PX && avail >= h0 * FIT_MIN_RATIO) return { action: 'shrink', maxH: Math.floor(avail) };
    return { action: 'break' };
  }
  // v2.2.6：縮完要實際驗證有沒有留在本頁（Jimmy 2026-10-28 Mac Safari 27 回報 NYT 首頁
  // 空白、圖跑到第二頁）。shrink 依量測縮到剛好貼齊頁底（只留 2px），Chromium / Safari 26
  // 放得下；Safari 27 對 break-inside: avoid 的 figure 多要約 12px 餘裕（Jimmy 實機逐 px
  // 試：figure 底 437.89 留在本頁、438.89 被推走；頁底 450、一般文字照樣排到 448；拿掉
  // figure 下邊距無效），整塊推到下一頁 → 本頁只剩標題。各引擎的判定不必猜：套上高度後
  // 看 unit 是否還在量測時那一欄，被推走就每次再縮 FIT_REFINE_STEP_PX 重試；縮到 shrink
  // 下限仍放不進 → 交給 break 分支（下一頁頂端完整顯示）。
  // 純決策函式：stays(h) 由呼叫端量 DOM（套 max-height 後 unit 是否仍在原欄）
  const FIT_REFINE_STEP_PX = 4;
  function refineShrink(maxH, h0, stays) {
    const minH = Math.max(FIT_MIN_PX, h0 * FIT_MIN_RATIO);
    for (let h = maxH; h >= minH; h -= FIT_REFINE_STEP_PX) {
      if (stays(h)) return { action: 'shrink', maxH: h };
    }
    return { action: 'break' };
  }
  // 媒體貼合的寫入一律經 mediaFitJournal：同元素同屬性會寫好幾次（量測用的 1px 暫值、
  // 逐 4px 試寫），撤回靠反序
  const setFitStyle = (el, prop, val) => mediaFitJournal.set(el, prop, val);
  const undoLastFitStyle = () => mediaFitJournal.undoLast();
  // v2.4.7：縮圖後，圖外層「固定高的純媒體殼」跟著塌回內容高（Jimmy 2026-11-12 Mac
  // Safari 翻頁，wired.com split-screen hero：第 2 頁頂一段空白、圖說被推下去）。
  // 根因：hero 外框 stylesheet `height: calc(100vh - 108px)`。styler
  // passFixedHeightReset 在排版當下量「固定高比自然高多 > 40px 才塌」——當下圖是單頁
  // cap 高、殼只多 18px 不命中；之後 shrink 把圖再縮 142px，殼高不動 → 多出的高度
  // 溢到下一頁頂端成空白。殼高沒跟著圖縮＝高度是寫死的，shrink 本身就證明了這點，
  // 所以這裡不用 40px 門檻：只要 height:auto 後變矮就保留。
  // 收斂：只走「沒有任何文字」的祖先（純媒體包裝；figure 帶圖說即停）、到 art 為止、
  // player 跳過；height:auto 後變高（站方裁切框）或不變 → 撤回。走 setFitStyle，
  // 與其他貼合寫入一併還原。量高度一律 fragHeight——多欄下 getBoundingClientRect
  // 是跨欄聯集，量不到殼被切到下一頁的那段。
  // 這條驗「shrink 後殼有沒有跟著縮」，不驗排版當下就存在的小量死空間（那是 styler 的層次）
  function releaseFixedHeightMediaShells(img) {
    for (let a = img.parentElement; a && a !== art && art.contains(a); a = a.parentElement) {
      if ((a.textContent || '').trim()) break;
      if (a.getAttribute && a.getAttribute('data-jread-player') === '1') break;
      const before = fragHeight(a);
      setFitStyle(a, 'height', 'auto');
      if (!(fragHeight(a) < before - 1)) undoLastFitStyle();
    }
  }
  // v2.5.36：div 圖說（styler findDivCaption 標 data-jread-cap-div）沒有 figure 包著，
  // 貼合單位只剩圖本身——縮圖只算圖的高度，圖塞進本頁底、圖說被擠到下一頁頂（語料庫
  // upmedia 翻頁第 2 → 3 頁實測）。單位改成「圖與圖說的共同容器」：styler markCapPair
  // 把媒體到共同容器之間（不含共同容器）每層標 data-jread-cap-media，最上層標記元素的
  // 父層＝共同容器；它還要真的裝著 div 圖說（figcaption 那條由 closest('figure') 處理）。
  // 這條驗「單位涵蓋圖說」，不驗站方把圖說排在圖上方或並排的版面（findDivCaption 不認）
  const CAP_MEDIA_SEL_ATTR = 'data-jread-cap-media';
  const CAP_DIV_SEL = '[data-jread-cap-div]';
  // 純 DOM 函式（不量 layout）：root＝主文容器，jsdom spec 直接驗
  function divCaptionUnit(img, root) {
    if (!img || !root || !img.getAttribute || img.getAttribute(CAP_MEDIA_SEL_ATTR) !== '1') return null;
    let top = img;
    while (top.parentElement && top.parentElement !== root &&
           top.parentElement.getAttribute(CAP_MEDIA_SEL_ATTR) === '1') top = top.parentElement;
    const common = top.parentElement;
    if (!common || common === root || !root.contains(common)) return null;
    const cap = common.querySelector(CAP_DIV_SEL);
    if (!cap) return null;
    // v2.5.37：styler 的 alt 路徑會在「圖與圖說直接排在內文裡」時命中，共同容器＝內文
    // 容器本身（upmedia 首圖）。把整段內文當成一個 break-inside: avoid 單位會讓整篇
    // 推到下一頁 → 共同容器除了圖說還有別的字，就不當單位（退回只貼合圖本身）
    const sq = (s) => (s || '').replace(/\s+/g, '');
    return sq(common.textContent) === sq(cap.textContent) ? common : null;
  }
  function fitMediaToPages() {
    if (!art) return;
    mediaFitJournal.restoreAll(); // 每輪重算：上一輪寫的先全撤
    const box = pageBox();
    if (!box) return; // jsdom 無 layout → no-op
    const pageBottom = box.bottom;
    const artContentLeft = box.contentLeft;
    // Safari 對已捲動狀態的 column fragment rect 會偏（同 measureContentEndX）→ 量測期間歸零
    const prevScroll = art.scrollLeft;
    try {
      art.scrollLeft = 0;
      for (const img of art.querySelectorAll('img')) {
        const h0 = fitImgHeight(img);
        if (!(h0 > 0)) continue; // 行內小圖 / player / 隱藏 / icon / 未撐開的圖
        const fig = img.closest('figure');
        const divUnit = fig && art.contains(fig) ? null : divCaptionUnit(img, art);
        const unit = fig && art.contains(fig) ? fig : (divUnit || img);
        // figure 的 break-inside: avoid 由 styler 給；div 圖說的共同容器沒有，這裡補上，
        // 圖與圖說才會一起被推到下一頁（refineShrink 靠「unit 有沒有被推走」判定）
        if (divUnit) setFitStyle(divUnit, 'break-inside', 'avoid');
        // 自然起點：圖暫時壓到 1px，unit 必然放得進當頁 → 首個 fragment 頂＝真起點；
        // unit 高 − 1 ＝ 圖說等非圖部分
        setFitStyle(img, 'max-height', '1px');
        const rects = unit.getClientRects();
        const top0 = rects.length ? rects[0].top : 0;
        const left0 = rects.length ? rects[0].left : 0; // 自然起點所在欄（v2.2.6 refineShrink 比對）
        const extra = Math.max(0, fragHeight(unit) - 1);
        let d = decideMediaFit(h0, pageBottom - top0 - extra - 2);
        // 1px 暫值只影響量測——decide 後依分支寫最終值（restore 時反序還原）
        const natW = img.complete ? img.naturalWidth : 0;
        const natH = img.complete ? img.naturalHeight : 0;
        if (d.action === 'shrink') {
          // 比「落在第幾欄」而非 left：置中、寬度跟著圖走的 figure（wiki thumb）縮圖時 left
          // 會跟著移動，比 left 會全數誤判成被推走、一路縮到下限改走 break（Glass 條目實測）。
          // 量不到 stride（jsdom）退回比起點 top——被推到下一欄的 unit 起點會回到頁頂
          const st = stride();
          const colOf = (x) => Math.floor((x - artContentLeft + 1) / st);
          const sameSpot = (r0) => (st > 0 ? colOf(r0.left) === colOf(left0) : Math.abs(r0.top - top0) < 1);
          // 每次試寫都疊在 1px 暫值上、試完撤掉，最後只留定案值
          d = refineShrink(d.maxH, h0, (h) => {
            setFitStyle(img, 'max-height', h + 'px');
            const r = unit.getClientRects();
            const ok = r.length > 0 && sameSpot(r[0]);
            undoLastFitStyle();
            return ok;
          });
        }
        let finalH = h0;
        if (d.action === 'shrink') {
          setFitStyle(img, 'max-height', d.maxH + 'px');
          finalH = d.maxH;
          releaseFixedHeightMediaShells(img);
        } else {
          undoLastFitStyle(); // 撤掉 1px 暫值
          if (d.action === 'break') {
            setFitStyle(unit, 'break-before', 'column');
            // 自然分頁會截掉頁頂 margin，強制分頁會保留（wiki figure 頁頂多 26px 實測）
            setFitStyle(unit, 'margin-top', '0');
          }
        }
        // 去 letterbox：盒子比「高 × 原始長寬比」寬 → 寬度釘成圖本身寬並置中
        if (natW > 0 && natH > 0) {
          const boxW = img.getBoundingClientRect().width;
          const fitW = finalH * natW / natH;
          if (boxW > fitW + 2) {
            // 不取整：取整後盒子與圖差 < 1px，contain 會在右緣露一條 img 底色
            setFitStyle(img, 'width', fitW.toFixed(2) + 'px');
            setFitStyle(img, 'margin-left', 'auto');
            setFitStyle(img, 'margin-right', 'auto');
          }
        }
      }
      fitShadowMediaHosts(box);
    } catch (e) { /* 量測失敗維持 styler 預設 cap */ }
    art.scrollLeft = prevScroll;
  }

  // v2.5.49：媒體畫在 shadow root 裡的元素（quantamagazine 的 <lottie-player>：shadow 裡一張
  // 560×1283 的 SVG）。styler 的單頁高度上限是 `[主文] svg` 這類選擇器，選不到 shadow 內的
  // 元素；上面的貼合也只看 <img>——比一頁高的資訊圖整張跨頁，下半截被頁底裁掉、頁碼壓在圖上。
  // 這種宿主自己沒有文字、內容就是一張圖，當成一張圖處理：先等比縮到一頁放得下（扣掉
  // figure 裡的圖說），本頁剩餘空間不夠就整塊換到下一頁頂。寬高一起寫（shadow 內的 SVG
  // 是 width/height 100%＋preserveAspectRatio，跟著宿主縮）。
  // 這條驗「宿主整張留在一頁內」，不驗 shadow 內部的版面（站方元件自己的事）
  function isShadowMediaHost(el) {
    const root = el.shadowRoot;
    if (!root || (el.textContent || '').trim()) return false;
    let r;
    try { r = el.getBoundingClientRect(); } catch (e) { return false; }
    const area = r.width * r.height;
    if (!(area > 0)) return false;
    for (const m of root.querySelectorAll('svg, canvas, video, img')) {
      const mr = m.getBoundingClientRect();
      if (mr.width * mr.height >= area * SHADOW_MEDIA_MIN_COVER) return true;
    }
    return false;
  }
  const SHADOW_MEDIA_MIN_COVER = 0.8;
  function fitShadowMediaHosts(box) {
    // getElementsByTagName 而非 querySelectorAll('*')：後者是 relayout 次數的觀測點
    //（review-1115-b3 spec 以「neutralizeStructure 每輪掃一次」計數）
    for (const host of art.getElementsByTagName('*')) {
      if (!host.shadowRoot || !isShadowMediaHost(host)) continue;
      const h0 = fragHeight(host);
      if (!(h0 >= FIT_MIN_PX)) continue;
      const fig = host.closest('figure');
      const unit = fig && art.contains(fig) ? fig : host;
      const extra = Math.max(0, fragHeight(unit) - h0);
      const cap = Math.floor(box.pageH - extra - 2);
      const ratio = host.getBoundingClientRect().width / h0;
      if (!(ratio > 0)) continue;
      const sizeTo = (h) => {
        setFitStyle(host, 'display', 'block');
        setFitStyle(host, 'height', h + 'px');
        setFitStyle(host, 'width', (h * ratio).toFixed(2) + 'px');
        setFitStyle(host, 'max-width', '100%');
        setFitStyle(host, 'margin-left', 'auto');
        setFitStyle(host, 'margin-right', 'auto');
      };
      let curH = h0;
      if (h0 > cap && cap >= FIT_MIN_PX) { sizeTo(cap); curH = cap; }
      let rects = unit.getClientRects();
      // 被切開而且不是從頁頂起頭＝本頁剩餘空間不夠 → 整塊從下一頁頂開始
      if (rects.length > 1 && rects[0].top > box.top + 2) {
        setFitStyle(unit, 'break-before', 'column');
        setFitStyle(unit, 'margin-top', '0');
        rects = unit.getClientRects();
      }
      // 從頁頂起頭還被切開＝圖說與 figure 內的邊距比估的多（quanta 圖說被擠到下一頁頂）
      // → 依溢到下一頁的那段高度再縮
      for (let k = 0; k < SHADOW_FIT_RETRIES && rects.length > 1; k++) {
        const next = Math.floor(curH - rects[rects.length - 1].height - FIT_REFINE_STEP_PX);
        if (next < FIT_MIN_PX) break;
        sizeTo(next);
        curH = next;
        rects = unit.getClientRects();
      }
    }
  }
  const SHADOW_FIT_RETRIES = 3;

  // v3.7.4：小標不單獨留在頁底（語料庫 2026-11-23 審查「小標或標籤單獨留在頁底，內容在
  // 下一頁」：hi 維基翻譯後整頁只剩一個小標、fa / he / MDN / python 等約 50 頁都有）。
  // 不用 break-after: avoid：WebKit 的多欄不照做（v2.5.13 ARIA 表頭實測）；也不用表頭那套
  // 「padding 佔位＋負 margin」：小標前後的 margin 會穿過外層一路摺疊（維基 div.mw-heading
  // > h2），要算對整條摺疊鏈，算錯就是每個小標後的間距跑掉。改成排版完再量：
  //   小標最後一段所在欄 ≠ 後面第一個可見內容（字或媒體）所在欄 → 小標就是孤兒，在小標
  //   （連同「它是第一個子元素」的外殼）寫 break-before: column 換到下一頁頂
  // 文件順序逐個處理，每次讀 rect 都是寫完前一個之後的版面。
  //   - 小標已經在頁頂（再換頁也還是孤兒＝後面接的東西比一頁還高）→ 不動
  //   - 後面接的是 fitMediaToPages 換到下一頁的圖（break-before: column）→ 小標換過去
  //     之後那張圖的強制分頁要撤掉，否則圖又被推到再下一頁
  //   - 強制分頁會保留頁頂 margin（自然分頁會截掉），換頁的那一串 margin-top 歸 0
  //     （同 fitMediaToPages break 分支）
  // 這條驗「小標與後面第一個內容在同一頁」，不驗後面接的段落在頁底只剩一行（段落的
  // orphans 歸引擎）、也不驗 div 排的標籤（wikihow 步驟編號）——標籤段落只認 <p>（isHeadingLike）
  const HEADING_KEEP_SEL = 'h1, h2, h3, h4, h5, h6, p';
  const HEADING_KEEP_SKIP_SEL = '[data-jread-hidden="1"], table, figure, li, [data-jread-player="1"]';
  // 「標籤段落」也算小標（qiita「寫法／結果」、論壇的段落標籤）：整段只有一個粗體元素、
  // 字短（CJK 權重 ≤ HEADING_KEEP_LABEL_MAX）、沒有連結。一般段落不算
  const HEADING_KEEP_LABEL_MAX = 40;
  function isHeadingLike(el) {
    if (el.tagName !== 'P') return true;
    if (el.querySelector('a, img, svg, video, iframe')) return false;
    const text = (el.textContent || '').replace(/\s+/g, '');
    if (!text) return false;
    const ns = global.__JRead;
    const w = ns && ns.cjkWeightedLen ? ns.cjkWeightedLen(text) : text.length;
    if (w > HEADING_KEEP_LABEL_MAX) return false;
    const bolds = el.querySelectorAll(':scope > strong, :scope > b');
    if (bolds.length !== 1) return false;
    return (bolds[0].textContent || '').replace(/\s+/g, '') === text;
  }
  function releaseHeadingKeep() { headingKeepJournal.restoreAll(); }
  // 後面第一個看得見的內容（非空白字或媒體）的第一個 rect
  function firstContentRectAfter(h) {
    const doc = h.ownerDocument;
    // 子樹後的下一個節點（n 沒有後續兄弟就往上找）；到 art 為止
    const nextOutside = (n) => {
      while (n && n !== art && !n.nextSibling) n = n.parentNode;
      return n && n !== art ? n.nextSibling : null;
    };
    let node = nextOutside(h);
    let guard = 0;
    while (node && guard++ < 5000) {
      if (node.nodeType === 1) {
        const el = node;
        if (el.getAttribute('data-jread-hidden') === '1' || el.getAttribute('aria-hidden') === 'true') {
          node = nextOutside(el); // 整棵子樹跳過
          continue;
        }
        if (/^(IMG|VIDEO|IFRAME|SVG|CANVAS)$/i.test(el.tagName)) {
          for (const r of el.getClientRects()) if (r.width > 2 && r.height > 2) return { rect: r, node: el };
          node = nextOutside(el);
          continue;
        }
        if (el.firstChild) { node = el.firstChild; continue; }
        node = nextOutside(el);
        continue;
      }
      if (node.nodeType === 3 && /\S/.test(node.nodeValue)) {
        const range = doc.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.width > 2 && r.height > 2) return { rect: r, node };
      }
      node = nextOutside(node);
    }
    return null;
  }
  function keepHeadingsWithNext() {
    if (!art) return;
    const box = pageBox();
    if (!box) return; // jsdom 無 layout → no-op
    const st = stride();
    if (!(st > 0)) return;
    const prevScroll = art.scrollLeft;
    try {
      art.scrollLeft = 0;
      const colOf = (r) => Math.floor((r.left - box.contentLeft + 1) / st);
      const cands = [];
      for (const el of art.querySelectorAll(HEADING_KEEP_SEL)) {
        if (el.closest(HEADING_KEEP_SKIP_SEL)) continue;
        if (!/\S/.test(el.textContent || '')) continue;
        if (!isHeadingLike(el)) continue;
        cands.push(el);
      }
      const lastRect = (el) => { const r = el.getClientRects(); return r.length ? r[r.length - 1] : null; };
      for (let i = 0; i < cands.length; i++) {
        const h = cands[i];
        const last = lastRect(h);
        if (!last || !(last.height > 0)) continue;
        const nx = firstContentRectAfter(h);
        if (!nx) continue;
        if (colOf(nx.rect) === colOf(last)) continue;
        // 連續小標（h2 緊接 h3、中間沒有內容）：前一個小標後面第一個內容就在這個小標裡
        // ＝同一串，整串一起換頁——只換最後一個，前面那個會變成新的孤兒
        let lead = h;
        for (let j = i - 1; j >= 0; j--) {
          const prev = firstContentRectAfter(cands[j]);
          if (!prev || !lead.contains(prev.node)) break;
          lead = cands[j];
        }
        const firstR = lead.getClientRects()[0];
        if (!firstR || firstR.top - box.top < 4) continue; // 已在頁頂：換頁也不會變好
        // 換頁的那一串：往上走，只要它是父層第一個看得見的子元素就把父層也算進來
        let top = lead;
        const chain = [lead];
        for (let p = lead.parentElement; p && p !== art && art.contains(p); p = p.parentElement) {
          let firstVis = null;
          for (const c of p.children) {
            if (c.getAttribute('data-jread-hidden') === '1') continue;
            if (!c.getClientRects().length) continue;
            firstVis = c; break;
          }
          if (firstVis !== top) break;
          top = p;
          chain.push(p);
        }
        const mark = headingKeepJournal.size();
        headingKeepJournal.set(top, 'break-before', 'column');
        for (const el of chain) headingKeepJournal.set(el, 'margin-top', '0');
        // 後面接的若被 fitMediaToPages 強制換頁，撤掉那一筆（小標已經帶著它換頁）：
        // 從那個內容節點往上走到 art，凡是在小標之後、寫著 break-before: column 的都撤
        let after = firstContentRectAfter(h);
        let hl = lastRect(h);
        if (after && hl && colOf(after.rect) !== colOf(hl)) {
          for (let x = after.node.nodeType === 1 ? after.node : after.node.parentElement; x && x !== art; x = x.parentElement) {
            if (x.contains(h)) break;
            if (x.style && x.style.getPropertyValue('break-before') === 'column') headingKeepJournal.set(x, 'break-before', 'auto');
          }
          after = firstContentRectAfter(h);
          hl = lastRect(h);
        }
        // 換頁後內容還是不在同一頁（後面接的東西比剩下的一頁還高）→ 撤回，換了只會多一頁空白
        if (after && hl && colOf(after.rect) !== colOf(hl)) {
          while (headingKeepJournal.size() > mark) headingKeepJournal.undoLast();
        }
      }
    } catch (e) { /* 量測失敗維持自然分頁 */ }
    art.scrollLeft = prevScroll;
  }

  // 斷頁前處理的執行順序——單一資料源。install、remeasureAndReconcile（晚載入內容 /
  // 固定計時器 / 編輯模式 refresh）、onResize 三處都只呼叫 relayout()，不得各自列一份
  //（重構前三處手抄，onResize 那份已經漏了 padInitialLetterBlocks）。
  //   neutralizeStructure     先解開不斷片 / 無視 break-* 的結構，後面量到的才是真的
  //   padInitialLetterBlocks  補 padding 會改段落高，要在量圖起點之前
  //   fitMediaToPages         依本頁剩餘空間縮圖 / 換頁
  //   remeasurePages          頁數要量貼合後的版面
  // 每個 pass 都必須冪等：同篇重掛（pageshow、分頁切回、設定重套）會重跑整套，
  // structJournal 不重複記原值、fitMediaToPages 每輪先全撤再算。
  const LAYOUT_PASSES = [releaseHeadingKeep, neutralizeStructure, padInitialLetterBlocks, fitMediaToPages, keepHeadingsWithNext, remeasurePages];
  function relayout() {
    if (!art) return;
    for (const pass of LAYOUT_PASSES) pass();
    // v1.6.15：保持 scheduleRemeasure 的變動偵測 gate 準確（P-3：連同媒體版面簽名）
    try { lastScrollWidth = art.scrollWidth; } catch (e) { /* */ }
    lastMediaSig = mediaLayoutSignature();
  }

  function pageCount() {
    if (!art) return 1;
    return measuredPages > 0 ? measuredPages : computePageCount(art.scrollWidth, stride());
  }

  // 2026-10-07 review D-12：注入 UI「先撿孤兒、沒有才建」的單一資料源。extension
  // reload 後舊 context 的 DOM 殘留在頁面上（舊 context 的 listener 隨之死亡、無法
  // 自己移除）；v1.6.24 只為頁碼指示器補了撿孤兒，scrub 進度條 / 觸覺載體各自只看
  // 模組變數（新 context 一律 null）→ 再建一份，舊的留在畫面上重複累積（進度條
  // 可能還停在 visible）。三個 ensure 共用：以 id 撿既存節點、沒有才 build + append。
  // 回 { el, adopted }——呼叫端對撿到的孤兒做收尾（清殘留 class、補子節點、重掛 listener）。
  function adoptOrCreate(id, build, parent) {
    let el = document.getElementById(id);
    const adopted = !!el;
    if (!el) {
      el = build();
      el.id = id;
      (parent || document.documentElement).appendChild(el);
    }
    return { el, adopted };
  }
  // 掛 <html> 下（與 styler progressEl 同層），不能掛 body——body 帶
  // data-jread-ancestor，styler 的 sibling 隱藏規則 `[ancestor] > *:not(...)` 會把
  // body 下的非主文子元素全部 display:none，指示器掛 body 下 rect 量出 0×0（udn
  // probe 實證）。html 沒被 markAncestors 標記，不受該規則影響。
  function htmlRoot() {
    return document.head?.parentElement || document.documentElement;
  }

  // v0.7.237：建立底部頁碼指示器（install 時呼叫）。v1.5.4：一律建立——頁碼指示
  // 已是翻頁模式唯一進度載體，不再有開關。uninstall 負責移除。
  function reconcileIndicator() {
    let adopted = false;
    if (!indicatorEl) {
      // 撿既存 DOM（extension reload 後舊 context 殘留的孤兒）或新建，兩者都算
      // adopted = 本 context 第一次接手這個節點、要掛 listener
      indicatorEl = adoptOrCreate(INDICATOR_ID, () => document.createElement('div'), htmlRoot()).el;
      // D-7：頁碼「N / M」是邏輯序（目前頁 / 總頁），RTL 文件的 bidi 會把「1 / 7」
      // 重排成「7 / 1」（ar 合成頁截圖實證）——指示器自宣告 ltr 不受文件方向影響
      indicatorEl.setAttribute('dir', 'ltr');
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
      setLogicalScrollLeft(target); // D-7：rtl 寫負值
      renderIndicator();
      return;
    }
    const from = logicalScrollLeft();
    const delta = target - from;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / TURN_ANIM_MS);
      const ease = 1 - Math.pow(1 - p, 3); // ease-out cubic
      setLogicalScrollLeft(from + delta * ease);
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
    if (imageViewerOpen()) return; // v2.5.27：圖片預覽開著時不翻頁
    if (isEditableFocus()) return;
    const dir = classifyKey(e, { rtl: isRtl }); // D-7：RTL ←/→ 對調
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    turn(dir);
  }

  // 滾輪 / 觸控板：水平或垂直 delta 都映射成翻頁（文件不可垂直卷動，垂直
  // 滾輪閒置不用反而違反直覺）。翻頁後鎖定一段時間吃掉慣性尾巴。
  // v2.5.27：圖片預覽層開著——鍵盤 / 滾輪 / 觸控都不作用在底下的文章。觸控靠
  // isForeignUiTarget（宿主 id 是 `__jread-` 開頭）、滾輪在宿主上就被攔下，這裡是
  // 鍵盤的讓位（key 事件不經過宿主）與滾輪的保險。
  function imageViewerOpen() {
    const ns = global.__JRead;
    return !!(ns && ns.imageViewer && ns.imageViewer.isOpen());
  }

  function onWheel(e) {
    if (imageViewerOpen()) return;
    // 2026-10-07 review D-4：ctrl + wheel 在所有桌面瀏覽器都是「縮放」語意
    //（macOS 觸控板捏合縮放也派發成 ctrlKey=true 的 wheel），不是捲動——不攔、
    // 不累積，讓瀏覽器照常縮放頁面（CDP probe 實證：ctrl+wheel 原本會翻一頁）。
    if (e.ctrlKey) return;
    // 文件鎖卷動下無原生用途；防 macOS 觸控板水平 swipe 觸發歷史導航。
    // 已知取捨：主文內的巢狀可捲元素（overflow-x:auto 的寬 <pre>/表格）滾輪
    // 也被吃掉轉成翻頁——翻頁模式下滾輪語意統一為翻頁，內捲內容用拖曳捲。
    e.preventDefault();
    const now = performance.now();
    if (now < wheelLockUntil) return;
    let d = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    // 2026-10-07 review D-11：行 / 頁模式換算成像素當量（Firefox 實體滾輪 deltaMode=1）
    if (e.deltaMode) d = normalizeWheelDelta(d, e.deltaMode, window.innerHeight || 0);
    // D-7：RTL 下水平 deltaX 的「往右捲」= 翻下一頁（內容往左長），對調號；垂直 deltaY
    // 是邏輯方向（往下 = 下一頁）不動
    if (isRtl && Math.abs(e.deltaX) >= Math.abs(e.deltaY)) d = -d;
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
    // D-12：先撿舊 context 的孤兒進度條（可能停在 visible），沒有才建
    const got = adoptOrCreate(SCRUB_TRACK_ID, () => document.createElement('div'), htmlRoot());
    scrubTrackEl = got.el;
    if (got.adopted) scrubTrackEl.classList.remove('__jread-scrub-visible');
    scrubFillEl = scrubTrackEl.querySelector('#' + SCRUB_FILL_ID);
    if (!scrubFillEl) {
      scrubFillEl = document.createElement('div');
      scrubFillEl.id = SCRUB_FILL_ID;
      scrubTrackEl.appendChild(scrubFillEl);
    }
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
    // D-12：先撿舊 context 的孤兒載體，沒有才建（掛 body——見上方 v0.8.153 說明）
    hapticEl = adoptOrCreate(HAPTIC_ID, () => {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.display = 'none';
      return label;
    }, document.body || document.documentElement).el;
    if (!hapticEl.querySelector('input[type="checkbox"]')) {
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.setAttribute('switch', ''); // iOS 17.4+ 原生 switch，切換時系統發觸覺
      hapticEl.appendChild(inp);
    }
  }
  function triggerHaptic() {
    // v3.5.5：App（JReader 內建）請原生發觸覺——網頁端兩條路在 iOS 真機都不會震（見上）。
    // Safari 擴充的 content script 在 isolated world，看不到 window.__jreadApp，照舊走下面
    try {
      const app = window.__jreadApp;
      if (app && typeof app.haptic === 'function') { app.haptic(); return; }
    } catch (e) { /* */ }
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
    // v3.6.1：App 內先請原生預熱觸覺引擎（跨頁時才發得出來、不慢半拍）
    try {
      const app = window.__jreadApp;
      if (app && typeof app.hapticPrepare === 'function') app.hapticPrepare();
    } catch (e) { /* */ }
  }
  function updateScrub(clientX) {
    if (!scrubState) return;
    // D-7：RTL 的 slider 進度從右往左，拖曳位移對調號
    const dx = clientX - scrubState.startX;
    const target = computeScrubTarget(
      scrubState.startIdx, isRtl ? -dx : dx, scrubState.scrubWidth, pageCount());
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

  // 2026-10-07 review D-5：起點落在 JRead 注入 UI（懸浮按鈕、toast、編輯工具列、
  // scrub 進度條）上的觸控不是翻頁手勢——listener 掛 window capture，shadow host
  // 會 retarget 成帶 `__jread-` id 的宿主，拖懸浮按鈕橫越螢幕放手那一刻原本會翻
  // 一頁（CDP touch probe 實證）；armed 模式下點工具列也不該被當 scrub / disarm。
  // 頁碼指示器自己例外（它就是 scrub 的入口）。判定單一資料源 NS.isInjectedUiTarget。
  function isForeignUiTarget(target) {
    if (isIndicatorTarget(target)) return false;
    const ns = global.__JRead;
    return !!(ns && typeof ns.isInjectedUiTarget === 'function' && ns.isInjectedUiTarget(target));
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) { touchState = null; endScrub(); return; } // 多指讓位（3 指 toggle 等）
    if (isForeignUiTarget(e.target)) { touchState = null; return; }
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
    }, { rtl: isRtl }); // D-7
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
      }, { rtl: isRtl }); // D-7
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
      // 頁高變了：哪些容器高過一頁（v1.7.46）、圖與頁底的剩餘空間（v1.9.25）都要重算
      relayout();
      const total = pageCount();
      goTo(Math.round(lastRatio * (total - 1)), false);
    });
  }

  // 卡片尺寸變了才走 onResize（observe 當下的首次回呼、內容變動但卡片沒變的回呼都略過——
  // 卡片是 fixed 滿版，border-box 只隨 viewport 變）。與 window resize 撞在同一輪時由
  // onResize 的單一 pending rAF 收斂成一次重測
  function observeCardSize() {
    if (cardObserver || typeof ResizeObserver !== 'function' || !art) return;
    const sizeKey = () => {
      const r = art.getBoundingClientRect();
      return r.width + 'x' + r.height;
    };
    cardObservedSize = sizeKey();
    cardObserver = new ResizeObserver(() => {
      if (!art) return;
      const key = sizeKey();
      if (key === cardObservedSize) return;
      cardObservedSize = key;
      onResize();
    });
    cardObserver.observe(art);
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
    isRtl = detectRtl(); // D-7：install 即讀（remeasurePages 會再刷新）
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
    observeCardSize();

    installed = true;
    // v2.5.53：給 main world 的 paged-io-guard.js 看的標記——翻頁期間卡片內元素的「離開
    // 畫面」IO 通知不轉給站方（Chromium IO 對分欄元素一律量第 1 欄，翻到第 2 頁就誤報）
    document.documentElement.setAttribute(PAGED_ROOT_ATTR, '1');
    // v1.6.15：進場強制 lazy 圖 eager（水平溢出的後段圖才會即時載入）
    forceEagerImages();
    // v1.6.16：持續盯後續進 DOM / 被改回 lazy 的圖（涵蓋「載入中就切翻頁模式」的 race）
    observeMediaForEager();
    // 斷頁前處理 → 量頁數（順序見 LAYOUT_PASSES）
    relayout();
    // 進場回到上次比例（同一篇 reapply 場景）；首次進入 lastRatio = 0 = 第一頁
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
  //     還原後的新狀態上。2026-10-07 review D-6：**不論 exitAnchorHandoff 一律回 y**
  //     ——anchor 可能在退出流程中被移除（JRead 自建標題節點），用不用 fallback 由
  //     main.js 在 anchor 套用時刻判定（兩層 fallback 不可共用同一盲點）；舊版
  //     handoff 即回 0，anchor 失效時兩層都不捲、停在翻頁期間被 clamp 的 scrollY 0。
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
    if (cardObserver) { cardObserver.disconnect(); cardObserver = null; }
    cardObservedSize = '';
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = 0; }
    for (const t of remeasureTimers) clearTimeout(t);
    remeasureTimers = [];
    // v1.6.15：移除內容驅動重測的 load 監聽 + debounce timer；還原強制 eager 的圖
    if (art && onDescendantLoadBound) art.removeEventListener('load', onDescendantLoadBound, true);
    onDescendantLoadBound = null;
    if (remeasureDebounce) { clearTimeout(remeasureDebounce); remeasureDebounce = 0; }
    lastScrollWidth = 0;
    lastMediaSig = '';
    // v1.6.16：先斷 observer 再還原——否則還原 setAttribute('loading','lazy') 會被
    // observer 當成「圖變 lazy」又強制回 eager，還原失敗。
    if (mediaObserver) { mediaObserver.disconnect(); mediaObserver = null; }
    restoreEagerImages();
    // 還原翻頁期間寫進主文後代的 inline 樣式（退回捲動模式後站方原排版仍是合理設計）：
    // 兩份日誌各自反序撤回。兩份寫的屬性不重疊，先後順序無關
    structJournal.restoreAll();
    mediaFitJournal.restoreAll();
    headingKeepJournal.restoreAll();
    resetNeutralizeState();
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
        if (y > 0) deferredY = y; // D-6：一律交回 main.js，anchor 失效時才用
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
    document.documentElement.removeAttribute(PAGED_ROOT_ATTR); // v2.5.53
    isRtl = false;
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

  // 2026-10-07 review D-2：編輯模式期間翻頁模組維持安裝，點掉 / 復原 block 後由
  // edit-mode 呼叫——內容末端變了要重測頁數、頁碼對齊（idx 超界時退到末頁）。
  function refresh() {
    if (!installed || !art) return;
    remeasureAndReconcile();
  }

  // v2.5.14：「內容節點 → 落在第幾頁」的量測零件，captureExitAnchor（退出錨點）與
  // pageCoverageOf（進場錨點）共用——同一份量法不寫兩份。三個都假設呼叫端已把
  // art.scrollLeft 歸 0（欄位幾何以第一頁為原點）。
  function firstColumnStartX() {
    const cs = getComputedStyle(art);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const bL = parseFloat(cs.borderLeftWidth) || 0;
    // D-7：rtl 時第一欄貼右緣，colStart 取右緣減 inline-start 內距 / 邊框
    const artRect = art.getBoundingClientRect();
    const padR = parseFloat(cs.paddingRight) || 0;
    const bR = parseFloat(cs.borderRightWidth) || 0;
    return isRtl ? artRect.right - bR - padR : artRect.left + bL + padL;
  }
  const ANCHOR_REPLACED_TAG_RE = /^(IMG|VIDEO|IFRAME|SVG)$/i;
  function contentNodeWalker(root) {
    return document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (n.nodeType === 3) {
          return (n.nodeValue && n.nodeValue.trim())
            ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
        // D-6：JRead 自建標題節點整棵跳過（退出時會被移除，不能當錨點）
        if (n.matches && n.matches(JREAD_OWN_TITLE_SEL)) return NodeFilter.FILTER_REJECT;
        // 替換元素 = atomic fragment，bounding rect 可靠（文首/頁首是圖片的頁靠這層）
        return ANCHOR_REPLACED_TAG_RE.test(n.tagName)
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
  }
  function contentNodeRects(node) {
    if (node.nodeType === 3) {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getClientRects();
    }
    return node.getClientRects();
  }

  // v2.5.14：一批元素各自落在哪幾頁（{ min, max }，0-based；量不到的回 null）。
  // main.js 進場時把「原頁畫面上看得到的段落」換成頁碼用（resolveEnterPagedOverride）。
  // 量法與 captureExitAnchor 相同（逐文字節點 / 替換元素的 fragment rect、scrollLeft=0）。
  // 沒裝好 / 量測失敗回 null（呼叫端維持原行為）。
  function pageCoverageOf(els) {
    if (!installed || !art || !Array.isArray(els)) return null;
    const s = stride();
    const total = pageCount();
    if (!(s > 0)) return null;
    const prev = art.scrollLeft;
    let out = null;
    try {
      art.scrollLeft = 0;
      const colStart = firstColumnStartX();
      out = els.map((el) => {
        if (!el || el.nodeType !== 1 || !art.contains(el)) return null;
        let min = Infinity, max = -Infinity;
        const take = (node) => {
          const cov = fragmentPageCoverage(contentNodeRects(node), colStart, s, total, isRtl);
          if (!cov) return;
          if (cov.min < min) min = cov.min;
          if (cov.max > max) max = cov.max;
        };
        if (ANCHOR_REPLACED_TAG_RE.test(el.tagName)) take(el);
        const walker = contentNodeWalker(el);
        let node;
        while ((node = walker.nextNode())) take(node);
        return min === Infinity ? null : { min, max };
      });
    } catch (e) { out = null; }
    art.scrollLeft = prev;
    return out;
  }

  // v2.5.14：進場時「原頁當下位置」該落在第幾頁（純函式；0-based，量不到回 null）。
  //   anchorCov   原頁畫面上第一個有字的段落，在翻頁版面佔的頁（{ min, max }）
  //   anchorFrac  進場當下那個段落已經捲過頂端的比例（0–1）
  //   visibleCovs 原頁畫面上看得到的每個段落各自佔的頁
  //   local       本機位置記錄（翻頁模式、同一總頁數才有意義）
  // 規則：
  //   1. 本機記錄的頁落在「畫面上看得到的段落」涵蓋的頁範圍內 → 用本機記錄的頁。
  //      原頁位置與本機記錄指向同一處時，本機記錄較準（段落常跨頁，光看段落分不出
  //      是哪一頁；翻頁第 N 頁退出再進場就是這個情境——退出時把原頁捲到第 N 頁的
  //      內容，再進場必須回第 N 頁）
  //   2. 否則 → 錨點段落的起始頁＋依捲過比例往後推（跨頁段落內線性近似）
  function pickEnterPage(anchorCov, anchorFrac, visibleCovs, local, total) {
    if (!(total >= 1)) return null;
    const covs = (Array.isArray(visibleCovs) ? visibleCovs : []).filter(Boolean);
    const a = anchorCov || covs[0] || null;
    if (!a) return null;
    const clamp = (n) => Math.max(0, Math.min(total - 1, n));
    let lo = a.min, hi = a.max;
    for (const c of covs) {
      if (c.min < lo) lo = c.min;
      if (c.max > hi) hi = c.max;
    }
    if (local && local.mode === 'paged' && local.pages === total &&
        Number.isInteger(local.page) && local.page >= lo && local.page <= hi) {
      return clamp(local.page);
    }
    const f = anchorCov && Number.isFinite(anchorFrac) ? Math.max(0, Math.min(1, anchorFrac)) : 0;
    return clamp(a.min + Math.round(f * (a.max - a.min)));
  }

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
  //
  // 2026-10-07 review D-6：跳過 JRead 自建的標題節點——detector 注入的 H1
  //（data-jread-injected-title）、cleaner 升進卡片的標題 clone（data-jread-title-clone）
  // 與翻譯頁外置標題（data-jread-promoted-outside，install 時暫搬進卡片）都會在退出
  // 流程被 remove / 移回，anchor 一旦選到它們就 disconnected、applyExitScrollAnchor
  // 不捲。第 1 頁退出時文件順序第一個節點幾乎必是標題文字，所以第 1 頁退出一律
  // 中招（合成頁 probe：原頁捲 800 進翻頁、第 1 頁 ESC → scrollY 0）。
  const JREAD_OWN_TITLE_SEL = '[data-jread-injected-title], [data-jread-title-clone], [data-jread-promoted-outside]';
  function captureExitAnchor() {
    if (!installed || !art) return null;
    const s = stride();
    const total = pageCount();
    if (!(s > 0)) return null;
    const prev = art.scrollLeft;
    let found = null;
    try {
      art.scrollLeft = 0;
      const colStart = firstColumnStartX();
      const walker = contentNodeWalker(art);
      let node;
      while ((node = walker.nextNode())) {
        const cov = fragmentPageCoverage(contentNodeRects(node), colStart, s, total, isRtl);
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
  // 2026-10-07 review D-1：uninstallOpts 轉給 uninstall（main.js 設定切換路徑傳
  // { deferScrollRestore: true }，捲動由 main.js 以目前頁錨點接管）
  function sync(settings, articleEl, uninstallOpts) {
    const on = !!(settings && settings.pagedMode === true);
    if (on && articleEl) install(articleEl);
    else uninstall(uninstallOpts);
  }

  const api = {
    computePageCount,
    computePageCountFromExtent,
    decideMediaFit,
    stripLayoutContain,
    stripPaintContain,
    isSingleMediaFlexShell,
    initialLetterPadPx,
    refineShrink,
    divCaptionUnit,
    layoutChangedSince,
    quantizeStride,
    computeScrubTarget,
    resolveScrubGesture,
    normalizeWheelDelta,
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
    refresh,
    captureScrollY,
    getPosition,
    goToPage,
    captureExitAnchor,
    pageCoverageOf,
    pickEnterPage,
    isInstalled: () => installed,
    SWIPE_MIN_DX, SWIPE_AXIS_RATIO, EDGE_GUARD_PX, WHEEL_THRESHOLD, WHEEL_LINE_PX,
    INDICATOR_ID
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // content script 環境：掛上 NS（namespace.js 先載入）
  if (typeof window !== 'undefined' && global === window && window.__JRead) {
    window.__JRead.pagedMode = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
