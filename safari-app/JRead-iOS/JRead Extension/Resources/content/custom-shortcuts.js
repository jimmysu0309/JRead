// JRead — 自訂快速鍵 content script（v0.7.218）
//
// 動機：Safari（含 iOS / iPadOS）沒有使用者自訂快速鍵入口（Chrome 有
// chrome://extensions/shortcuts），iPad 外接鍵盤使用者完全無法改鍵。
// Safari 也不支援 commands.update()——manifest suggested_key 是死的。
// 唯一通用解是 content script 層自己攔 keydown：options 錄製的組合存
// storage.sync.customShortcuts，這裡比對命中後送 CUSTOM_COMMAND 給 SW，
// 走與 manifest commands.onCommand 同一條 dispatch（含 YouTube 模式重導
// 邏輯），不另開分支（單一資料源）。
//
// 與 manifest 預設鍵的關係：預設鍵在 browser 層、程式停不掉，兩者並存。
// shortcut-utils.validate 拒絕「自訂值 == 預設值」避免同一按鍵雙觸發。
//
// 已知限制（與 browser 層快速鍵的差異）：
//   - 位址列 / devtools focus 時頁面收不到 keydown，自訂鍵無效
//   - content script 沒注入的頁（chrome:// 等）無效
//   這些情境 manifest 預設鍵（browser 層）仍然有效，作為 fallback。
//
// 順序 invariant：keydown listener 在 content script 載入時註冊——早於
// main.js 的 keyguardHandler（enterReaderMode 時才動態 addEventListener）。
// capture phase 同 phase listener 按註冊順序執行，所以 keyguard 的
// stopImmediatePropagation 擋不到這裡；反向（本檔命中後 stopImmediate-
// Propagation）會擋掉 keyguard / space-scroll，但命中 = 使用者按了含
// ⌥/⌃ 的自訂組合，本來就該被本檔獨佔。
(function () {
  'use strict';

  const NS = window.__JRead;
  const SC = window.__JReadShortcuts;
  if (!NS || !SC) return;
  if (NS.customShortcuts) return; // 防重複注入（SPA 導航再注入保險）

  // command → shortcut 物件（null = 未自訂）。storage 載回前是 null（整張表
  // 還沒到，keydown 全放行——不能用空表代替，否則載入競態時誤判「未設定」）。
  let table = null;

  function loadTable() {
    // context invalidated guard（extension reload 後舊 content script 殘留）
    if (!chrome || !chrome.runtime || !chrome.runtime.id || !chrome.storage || !chrome.storage.sync) return;
    try {
      chrome.storage.sync.get({ customShortcuts: {} }, (values) => {
        if (chrome.runtime.lastError) return;
        table = SC.sanitizeTable(values && values.customShortcuts);
      });
    } catch (_) { /* context 失效 race，silently no-op */ }
  }

  // options 改鍵即時生效（不必 reload 頁面）
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !('customShortcuts' in changes)) return;
      table = SC.sanitizeTable(changes.customShortcuts.newValue);
    });
  }

  function onKeyDown(e) {
    if (!table) return;
    // IME 中文輸入第一階段不攔（與 keyguard 同規則）
    if (e.isComposing || e.keyCode === 229) return;
    for (const cmd of SC.COMMANDS) {
      const s = table[cmd];
      if (s && SC.matches(e, s)) {
        // preventDefault：擋掉 macOS ⌥+字母的 dead-key 字元輸入（® 等）；
        // stopImmediatePropagation：擋掉 page JS 同 phase listener（與
        // browser 層快速鍵「頁面收不到」的行為對齊）。
        e.preventDefault();
        e.stopImmediatePropagation();
        NS.safeSendMessage({ type: NS.MSG.CUSTOM_COMMAND, payload: { command: cmd } });
        return;
      }
    }
  }
  // 注意：input / textarea focus 時也觸發——與 browser 層 commands 行為一致
  // （組合必含 ⌥/⌃，validate 已擋掉會干擾打字的單鍵 / ⇧ 組合）。
  window.addEventListener('keydown', onKeyDown, true);

  NS.customShortcuts = { installed: true };
  loadTable();
})();
