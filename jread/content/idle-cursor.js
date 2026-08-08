// JRead — 閒置隱藏滑鼠游標（v1.7.62，Jimmy 2026-08-08）
// -----------------------------------------------------------------------------
// 閱讀模式下滑鼠停著不動超過 IDLE_DELAY_MS 就把游標藏起來（純閱讀時游標壓在
// 字上是干擾），任何真實移動 / 按鍵按下立刻讓它回來。
//
// 隱藏手段：注入 `html[data-jread-cursor-idle], html[...] * { cursor: none
// !important }`。必須連 `*` 一起打且加 !important——站點普遍有 `a { cursor:
// pointer }` 這類規則，只設在 html 上會被子元素自己的宣告蓋掉（probe 2026-08-08
// 實測：對照組 `a.forced { cursor: crosshair !important }` 也被壓成 none）。
//
// ── 三個設計選擇 ─────────────────────────────────────────────────────────
// 1. **捲動不算「動了」**（Jimmy 2026-08-08 裁定）：滾輪 / 空白鍵 / 翻頁捲動時
//    游標維持隱藏——閱讀中最常做的就是捲動，捲動算動作等於功能失效。實作上不
//    掛 wheel / scroll / keydown listener 即可，但還有一層防護見 (2)。
// 2. **座標未變的 mousemove 一律忽略**：內容在靜止游標底下捲過去時，瀏覽器會
//    補發 mousemove 重算 :hover 狀態，座標與前次相同。不擋掉的話捲動就會把游標
//    叫回來（= 1. 的漏洞）。判定用「與上次**採信**的座標比 >= MOVE_THRESHOLD_PX」
//    ——門檻只在採信時才推進錨點，所以每次 1px 的慢速移動也會累加到跨過門檻，
//    不會被門檻永久吃掉。註：Playwright headless 重現不出這種合成事件（無真實
//    游標可重算 hover），這條守衛是對真實 Chrome 行為的防禦，不是 probe 驗出來的。
// 3. **只在有真實指標裝置時啟用**：`(hover: hover) and (pointer: fine)`。觸控
//    裝置（iPhone / iPad）根本沒有游標可藏，整個模組不掛 listener。
//
// 已知界線（可接受，非 bug）：
//   - 跨來源 iframe（嵌入的推文 / 影片）內是各自的 document，注入的 CSS 到不了，
//     游標剛好停在上面時不會消失。content_scripts 未開 all_frames，也不打算為此開。
//   - 注入 UI（懸浮按鈕 / toast / 編輯工具列）在 shadow DOM 內、各自宣告
//     cursor: pointer，同樣蓋不到；但游標一動就現形，實務上碰不到這個狀態。
//   - 影院模式（YouTube）不套用——那條路徑不走 finalizeEnter，且 articleEl 為 null。
//
// 生命週期：finalizeEnter 進場裝、exitReaderModeImpl 退場拆、編輯模式期間暫停
//（游標不見就沒法點雜訊段落），全部由 main.js 的 syncIdleCursorFromSettings 主導。
(function () {
  'use strict';

  const NS = window.__JRead;
  if (!NS) return;

  const STYLE_ID = '__jread-idle-cursor-style';
  const ACTIVE_ATTR = 'data-jread-cursor-idle';
  // 閒置多久後隱藏（Jimmy 2026-08-08 指定 2 秒）
  const IDLE_DELAY_MS = 2000;
  // 視為「真的移動了」的最小位移（px）。1px 用來吸收光學感測器抖動；見上方 (2)
  // 的錨點累加說明。
  const MOVE_THRESHOLD_PX = 2;

  let installed = false;
  let timerId = null;
  // 上次「採信」的游標座標（null = 尚未收過任何真實移動）
  let anchorX = null;
  let anchorY = null;

  // 有真實指標裝置才有意義。matchMedia 不存在（極舊環境 / jsdom 未 stub）視為沒有。
  function hasFinePointer() {
    if (typeof window.matchMedia !== 'function') return false;
    try {
      return !!window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch (_) {
      return false;
    }
  }

  function buildCss() {
    return 'html[' + ACTIVE_ATTR + '], html[' + ACTIVE_ATTR + '] * { cursor: none !important; }';
  }

  function hideCursor() {
    timerId = null;
    if (!installed) return;
    if (document.documentElement.hasAttribute(ACTIVE_ATTR)) return;
    // CSP-safe 注入（嚴格 style-src 站點退回 adoptedStyleSheets，見 namespace.js）
    NS.injectCssText(STYLE_ID, buildCss());
    document.documentElement.setAttribute(ACTIVE_ATTR, '1');
  }

  function showCursor() {
    document.documentElement.removeAttribute(ACTIVE_ATTR);
    NS.removeCssText(STYLE_ID);
  }

  function armTimer() {
    if (timerId !== null) clearTimeout(timerId);
    timerId = setTimeout(hideCursor, IDLE_DELAY_MS);
  }

  function disarmTimer() {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  // 使用者有動作：游標立刻現形 + 重新計時
  function wake() {
    showCursor();
    armTimer();
  }

  function onMouseMove(e) {
    const x = e.clientX;
    const y = e.clientY;
    if (anchorX !== null &&
        Math.abs(x - anchorX) < MOVE_THRESHOLD_PX &&
        Math.abs(y - anchorY) < MOVE_THRESHOLD_PX) {
      // 座標沒變（捲動觸發的 hover 重算）或僅感測器抖動 → 不算動作，錨點不推進
      return;
    }
    anchorX = x;
    anchorY = y;
    wake();
  }

  // 游標藏著時仍可點擊（使用者盲點連結）——按下就讓它現形
  function onMouseDown() {
    wake();
  }

  function install() {
    if (installed) return false;
    if (!hasFinePointer()) return false;
    window.addEventListener('mousemove', onMouseMove, { capture: true, passive: true });
    window.addEventListener('mousedown', onMouseDown, { capture: true, passive: true });
    installed = true;
    anchorX = null;
    anchorY = null;
    armTimer();
    return true;
  }

  // 無條件拆乾淨（listener + timer + 注入的 CSS + attribute），對未 install 的
  // 狀態安全 no-op——退出閱讀模式一律呼叫，不看 installed 旗標。
  function uninstall() {
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mousedown', onMouseDown, true);
    installed = false;
    disarmTimer();
    anchorX = null;
    anchorY = null;
    showCursor();
  }

  // settings → 模組狀態。未設過此欄（升版舊 storage）預設開，明確 false 才關。
  function sync(settings) {
    const enabled = !(settings && settings.idleCursorHide === false);
    if (enabled) install();
    else uninstall();
  }

  NS.idleCursor = {
    sync,
    install,
    uninstall,
    isInstalled: () => installed,
    isHidden: () => document.documentElement.hasAttribute(ACTIVE_ATTR),
    STYLE_ID,
    ACTIVE_ATTR,
    IDLE_DELAY_MS,
    MOVE_THRESHOLD_PX
  };
})();
