// JRead — 自訂快速鍵 helper（v0.7.218）
// 共用於 content script（custom-shortcuts.js 比對 keydown）、options（recorder
// 錄製 / 顯示 / 驗證）、regression spec（直接 require）。
//
// 背景：Safari（含 iOS / iPadOS）沒有 chrome://extensions/shortcuts 這類使用者
// 自訂快速鍵入口，iOS 的 commands API 更是殘缺（v0.7.217 已知 getAll 缺席）。
// 自訂快速鍵因此走 content script 層：options 錄一組 {code+modifiers} 存
// storage.sync，custom-shortcuts.js 在頁面 keydown capture phase 比對命中後
// 送 CUSTOM_COMMAND 給 SW dispatch——與 manifest 預設鍵（browser 層）並存。
//
// shortcut 物件形狀（storage.sync.customShortcuts 的 value）：
//   { code: 'KeyR', alt: true, shift: false, ctrl: false, meta: false } | null
// 用 e.code（實體鍵位）不用 e.key——macOS 上 ⌥R 的 e.key 是 '®'（dead-key
// 變換後字元），跨鍵盤配置不穩定；e.code 是實體位置、不受 modifier 影響。
//
// 跨環境匯出：content script / options 走 window 全域、Node require 走 module.exports。
(function (global) {
  'use strict';

  // 三個可自訂指令（與 manifest.json commands key 同字彙，單一詞彙表）
  var COMMANDS = ['toggle-reader-mode', 'send-to-readwise', 'toggle-youtube-borderless'];

  // manifest.json commands 的 suggested_key 鏡像（瀏覽器層預設鍵）。
  // regression spec 有 forcing function 守這份鏡像與 manifest 逐欄一致——
  // 改 manifest suggested_key 沒同步這裡會 fail。
  // 用途：(1) options 顯示「⌥3（預設）」(2) validate 拒絕「自訂值 == 預設值」
  // （兩層同時觸發會 toggle 兩次 = 視覺上沒反應）。
  // v0.7.251：預設鍵由 ⌥R / ⌥⇧R 改為 ⌥3 / ⌥⇧3，並給 YouTube 無邊模式新增
  // 預設 ⌥4（原本無 suggested_key）。digit 用 e.code 'Digit3' / 'Digit4'。
  var MANIFEST_DEFAULTS = {
    'toggle-reader-mode':        { code: 'Digit3', alt: true, shift: false, ctrl: false, meta: false },
    'send-to-readwise':          { code: 'Digit3', alt: true, shift: true,  ctrl: false, meta: false },
    'toggle-youtube-borderless': { code: 'Digit4', alt: true, shift: false, ctrl: false, meta: false }
  };

  // 純 modifier 鍵的 e.code——按下這些時組合還沒完成，eventToShortcut 回 null
  var MODIFIER_CODES = {
    AltLeft: 1, AltRight: 1,
    ShiftLeft: 1, ShiftRight: 1,
    ControlLeft: 1, ControlRight: 1,
    MetaLeft: 1, MetaRight: 1,
    CapsLock: 1
  };

  // e.code → 顯示字元。沒列的 fallback 用原始 code 字串。
  var KEY_LABELS = {
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Backquote: '`',
    Minus: '-', Equal: '=', Backslash: '\\',
    Space: 'Space', Enter: '↵', Tab: '⇥',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Backspace: '⌫', Delete: '⌦',
    Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn'
  };

  function keyLabel(code) {
    if (KEY_LABELS[code]) return KEY_LABELS[code];
    var m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    m = /^Digit(\d)$/.exec(code);
    if (m) return m[1];
    return code; // F1-F12 / Numpad* 等直接顯示原 code
  }

  // KeyboardEvent → shortcut 物件；純 modifier 鍵（組合未完成）回 null
  function eventToShortcut(e) {
    if (!e || !e.code || MODIFIER_CODES[e.code]) return null;
    return {
      code: e.code,
      alt: !!e.altKey,
      shift: !!e.shiftKey,
      ctrl: !!e.ctrlKey,
      meta: !!e.metaKey
    };
  }

  // KeyboardEvent 是否命中 shortcut。modifier 全欄位嚴格比對——
  // ⌥3 不可命中 ⌥⇧3（多按 shift 是不同組合）。
  function matches(e, s) {
    if (!s || !s.code || !e) return false;
    return e.code === s.code &&
      !!e.altKey === !!s.alt &&
      !!e.shiftKey === !!s.shift &&
      !!e.ctrlKey === !!s.ctrl &&
      !!e.metaKey === !!s.meta;
  }

  function shortcutEquals(a, b) {
    if (!a || !b) return false;
    return a.code === b.code &&
      !!a.alt === !!b.alt &&
      !!a.shift === !!b.shift &&
      !!a.ctrl === !!b.ctrl &&
      !!a.meta === !!b.meta;
  }

  // 顯示用字串。modifier 順序固定 ⌃⌥⇧⌘（macOS 慣例）。
  function format(s) {
    if (!s || !s.code) return '';
    var out = '';
    if (s.ctrl) out += '⌃';
    if (s.alt) out += '⌥';
    if (s.shift) out += '⇧';
    if (s.meta) out += '⌘';
    return out + keyLabel(s.code);
  }

  // 錄製驗證。回 { ok: boolean, reason?: string }。
  // 第二參數 opts.requireCtrl === true 時改用 Safari 規則（見下）。
  // 規則（全是結構性通則，非站點/鍵位特判）：
  //   - 必須含 ⌥ 或 ⌃ —— 單鍵或只加 ⇧ 會在打字 / 閱讀操作時誤觸
  //   - 拒絕 ⌘ 組合 —— content script 搶不過瀏覽器 / 系統層快速鍵（⌘L、⌘R 等
  //     根本到不了頁面），錄了也不會動
  //   - 拒絕 ESC —— 保留給退出閱讀模式（main.js onEscKey）
  //   - 拒絕與內建預設鍵相同 —— browser 層停不掉，兩層同時觸發 = toggle 兩次
  //
  // requireCtrl（Safari runtime 傳 true）：自訂鍵必含 ⌃ Control。
  //   Safari（含 macOS / iPadOS / iOS）把 ⌥ Option 與 ⌘ Command 組合路由到
  //   系統鍵盤指令層，完全不以 keydown 傳給網頁——content script 監聽網頁
  //   keydown 永遠收不到 ⌥/⌘ 組合（實機 probe 實證）。只有 ⌃（及純鍵 / ⇧）
  //   會傳到頁面。為「同一組自訂鍵跨 Apple 裝置一致」，macOS Safari 也統一
  //   要求 ⌃。這是引擎層行為、依 runtime 切（非 OS / build flag）。
  function validate(s, opts) {
    var requireCtrl = !!(opts && opts.requireCtrl);
    if (!s || !s.code) return { ok: false, reason: '請按下含一般按鍵的組合' };
    if (s.code === 'Escape') return { ok: false, reason: 'ESC 保留給退出閱讀模式' };
    if (s.meta) {
      return { ok: false, reason: requireCtrl
        ? 'Safari 需用 ⌃ Control 組合（⌘ 會被系統攔截、傳不到網頁）'
        : '⌘ 組合會被瀏覽器或系統搶走，請改用 ⌥ 或 ⌃ 組合' };
    }
    if (requireCtrl) {
      if (!s.ctrl) return { ok: false, reason: 'Safari 需用 ⌃ Control 組合（⌥ 組合會被 Safari 攔截、傳不到網頁）' };
    } else if (!s.alt && !s.ctrl) {
      return { ok: false, reason: '組合需包含 ⌥ 或 ⌃（避免打字時誤觸）' };
    }
    for (var i = 0; i < COMMANDS.length; i++) {
      var def = MANIFEST_DEFAULTS[COMMANDS[i]];
      if (def && shortcutEquals(s, def)) {
        return { ok: false, reason: format(def) + ' 已是內建預設快速鍵' };
      }
    }
    return { ok: true };
  }

  // storage 讀回值消毒：缺欄 / 型別錯 / 殘缺物件一律折回 null（= 未自訂），
  // 防 sync 髒資料讓 keydown 比對 throw。
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.code !== 'string' || !raw.code) return null;
    return {
      code: raw.code,
      alt: !!raw.alt,
      shift: !!raw.shift,
      ctrl: !!raw.ctrl,
      meta: !!raw.meta
    };
  }

  // 整張表消毒：保證三個 command key 都在、value 是合法 shortcut 或 null
  function sanitizeTable(raw) {
    var table = {};
    for (var i = 0; i < COMMANDS.length; i++) {
      var cmd = COMMANDS[i];
      table[cmd] = raw && typeof raw === 'object' ? sanitize(raw[cmd]) : null;
    }
    return table;
  }

  var api = {
    COMMANDS: COMMANDS,
    MANIFEST_DEFAULTS: MANIFEST_DEFAULTS,
    eventToShortcut: eventToShortcut,
    matches: matches,
    shortcutEquals: shortcutEquals,
    format: format,
    validate: validate,
    sanitize: sanitize,
    sanitizeTable: sanitizeTable
  };
  if (typeof window !== 'undefined') window.__JReadShortcuts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
