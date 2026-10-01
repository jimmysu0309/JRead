// JRead — 站點特判的唯一住處（v1.9.16）
// 共用於 content script（main.js keyguard）、regression spec（直接 require）。
//
// CLAUDE.md 硬規則 3：detector / cleaner / styler / main 的主邏輯只能寫結構性
// 通則，「這個 hostname 要特別處理」一律放這個檔——明確隔離、一眼看得到全部例外。
// 這裡只放「規則表 + 純決策函式」，不碰 DOM、不裝 listener；呼叫端（main.js）
// 負責收集事實（hostname / 按鍵 / 選取狀態）再來問。
//
// ── 規則一：放行給原站的按鍵（KEY_PASSTHROUGH）──────────────────────────────
// 閱讀模式的 keyguard（settings.blockPageShortcuts，預設開）會把 ESC 以外的按鍵
// 全部攔下、不讓頁面 JS 收到——防的是 Gmail `e` 封存、`#` 刪除這類「字符快速鍵
// ＝破壞性操作」。副作用是原站「對閱讀本身有用」的快速鍵也一起沒了。
// 哪個站的哪個鍵有用，沒有結構訊號可判（同一個 `h` 在 Reader 是畫重點、在別站
// 可能是別的動作），所以是站點特判。
//
// 欄位：
//   host             hostname 比對；規則同 domain-match（相等，或以 '.' + host 結尾）
//   keys             放行的 KeyboardEvent.key（小寫比對）；只放行「無任何修飾鍵」的按法
//   requireSelection true = 主文內有非 collapsed 選取時才放行
//
// Readwise Reader `h`（Jimmy 2026-10-01）：選取文字後按 H 畫重點。requireSelection
// 必須為 true——Reader 在沒有選取時按 H 會把「Reader 自己的焦點段落」整段畫起來，
// 而那個焦點指示在閱讀模式下看不到（JRead 有自己的段落焦點條），等於盲畫。
//
// 跨環境匯出：content script 走 window 全域、Node require 走 module.exports。
(function (global) {
  'use strict';

  var KEY_PASSTHROUGH = [
    { host: 'read.readwise.io', keys: ['h'], requireSelection: true }
  ];

  function hostMatches(hostname, ruleHost) {
    var h = String(hostname || '').toLowerCase();
    var r = String(ruleHost || '').toLowerCase();
    if (!h || !r) return false;
    return h === r || h.slice(-(r.length + 1)) === '.' + r;
  }

  // facts: { hostname, key, altKey, ctrlKey, metaKey, shiftKey, hasSelectionInArticle }
  // 回傳 true = keyguard 不要攔，讓頁面 JS 收到這個按鍵事件。
  function shouldPassKeyToPage(facts) {
    if (!facts) return false;
    if (facts.altKey || facts.ctrlKey || facts.metaKey || facts.shiftKey) return false;
    var key = String(facts.key || '').toLowerCase();
    if (!key) return false;
    for (var i = 0; i < KEY_PASSTHROUGH.length; i++) {
      var rule = KEY_PASSTHROUGH[i];
      if (!hostMatches(facts.hostname, rule.host)) continue;
      if (rule.keys.indexOf(key) < 0) continue;
      if (rule.requireSelection && !facts.hasSelectionInArticle) continue;
      return true;
    }
    return false;
  }

  var api = {
    KEY_PASSTHROUGH: KEY_PASSTHROUGH,
    hostMatches: hostMatches,
    shouldPassKeyToPage: shouldPassKeyToPage
  };
  if (typeof window !== 'undefined') window.__JReadSiteOverrides = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
