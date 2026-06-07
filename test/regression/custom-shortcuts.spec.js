// JRead — 自訂快速鍵 forcing function（v0.7.218）
//
// 功能：Safari（含 iOS / iPadOS）沒有使用者自訂快速鍵入口（Chrome 有
// chrome://extensions/shortcuts），iPad 外接鍵盤使用者無法改鍵。自訂快速鍵
// 走 content script 層：options recorder 錄 {code+modifiers} 存
// storage.sync.customShortcuts → content/custom-shortcuts.js keydown capture
// 比對命中 → CUSTOM_COMMAND 訊息 → SW dispatchCommand（與 manifest commands
// 同一條 dispatch，單一資料源）。
//
// 訊號層次說明：本檔驗 (A) helper 純邏輯（直接 require 跑真值表）與
// (B)-(F) 各檔 wire-up 的 source 結構。**不驗**真實瀏覽器的 keydown 事件
// 派發順序（keyguard / space-scroll 同 phase listener 競合）與 Safari iOS
// 實機行為——那層只能靠 Playwright harness + Jimmy 實機（iPad 外接鍵盤）。
//
// 覆蓋層次：
// (A) shortcut-utils 純邏輯——eventToShortcut / matches / validate / format /
//     sanitizeTable 真值表
// (B) MANIFEST_DEFAULTS ↔ manifest.json commands suggested_key 鏡像 forcing
//     （改 manifest 沒同步 utils 立刻 fail）
// (C) manifest content_scripts wire-up（檔案在列、順序正確）
// (D) custom-shortcuts.js source 結構（capture listener / stopImmediate-
//     Propagation / IME guard / CUSTOM_COMMAND）
// (E) SW——DEFAULT_SETTINGS.customShortcuts / dispatchCommand 抽出 /
//     CUSTOM_COMMAND case 白名單 + sender.tab.id / commands API guard
// (F) namespace / options / popup wire-up

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const SC = require(path.join(ROOT, 'content', 'shortcut-utils.js'));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const CUSTOM_SRC = fs.readFileSync(path.join(ROOT, 'content', 'custom-shortcuts.js'), 'utf8');
const NS_SRC = fs.readFileSync(path.join(ROOT, 'content', 'namespace.js'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'background', 'service-worker.js'), 'utf8');
// v0.7.235：DEFAULT_SETTINGS 搬到 content/settings-defaults.js 單一資料源
const SHARED_DEFAULTS_SRC = fs.readFileSync(path.join(ROOT, 'content', 'settings-defaults.js'), 'utf8');
const OPTIONS_HTML = fs.readFileSync(path.join(ROOT, 'options', 'options.html'), 'utf8');
const OPTIONS_JS = fs.readFileSync(path.join(ROOT, 'options', 'options.js'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup', 'popup.js'), 'utf8');

// 模擬 KeyboardEvent 的最小物件
function kbd(code, mods = {}) {
  return {
    code,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta
  };
}

describe('(A) shortcut-utils 純邏輯', () => {
  describe('eventToShortcut', () => {
    it('一般鍵 + modifier → shortcut 物件', () => {
      assert.deepStrictEqual(SC.eventToShortcut(kbd('KeyJ', { alt: true })), {
        code: 'KeyJ', alt: true, shift: false, ctrl: false, meta: false
      });
    });
    it('純 modifier 鍵（AltLeft / ShiftRight / MetaLeft / CapsLock）→ null（組合未完成）', () => {
      ['AltLeft', 'ShiftRight', 'ControlLeft', 'MetaLeft', 'CapsLock'].forEach((code) => {
        assert.strictEqual(SC.eventToShortcut(kbd(code, { alt: true })), null, code + ' 必須回 null');
      });
    });
  });

  describe('matches —— modifier 全欄位嚴格比對', () => {
    const altR = { code: 'KeyR', alt: true, shift: false, ctrl: false, meta: false };
    it('⌥R 事件命中 ⌥R', () => {
      assert.strictEqual(SC.matches(kbd('KeyR', { alt: true }), altR), true);
    });
    it('⌥⇧R 事件**不**命中 ⌥R（多按 shift 是不同組合）', () => {
      assert.strictEqual(SC.matches(kbd('KeyR', { alt: true, shift: true }), altR), false);
    });
    it('純 R 事件不命中 ⌥R', () => {
      assert.strictEqual(SC.matches(kbd('KeyR'), altR), false);
    });
    it('shortcut 為 null 時恆 false（未自訂不可命中任何鍵）', () => {
      assert.strictEqual(SC.matches(kbd('KeyR', { alt: true }), null), false);
    });
  });

  describe('validate —— 結構性規則', () => {
    it('⌥J 通過', () => {
      assert.strictEqual(SC.validate(SC.eventToShortcut(kbd('KeyJ', { alt: true }))).ok, true);
    });
    it('⌃⇧K 通過（⌃ 也算合法 modifier）', () => {
      assert.strictEqual(SC.validate(SC.eventToShortcut(kbd('KeyK', { ctrl: true, shift: true }))).ok, true);
    });
    it('單鍵（無 modifier）拒絕——打字誤觸', () => {
      assert.strictEqual(SC.validate(SC.eventToShortcut(kbd('KeyJ'))).ok, false);
    });
    it('只加 ⇧ 拒絕——打大寫字母誤觸', () => {
      assert.strictEqual(SC.validate(SC.eventToShortcut(kbd('KeyJ', { shift: true }))).ok, false);
    });
    it('⌘ 組合拒絕——content script 搶不過瀏覽器 / 系統層', () => {
      assert.strictEqual(SC.validate(SC.eventToShortcut(kbd('KeyJ', { meta: true, alt: true }))).ok, false);
    });
    it('ESC 拒絕——保留給退出閱讀模式', () => {
      assert.strictEqual(SC.validate({ code: 'Escape', alt: true, shift: false, ctrl: false, meta: false }).ok, false);
    });
    it('⌥R 拒絕——已是內建預設（browser 層停不掉，雙觸發 = toggle 兩次）', () => {
      assert.strictEqual(SC.validate(SC.eventToShortcut(kbd('KeyR', { alt: true }))).ok, false);
    });
    it('⌥⇧R 拒絕——已是 send-to-readwise 內建預設', () => {
      assert.strictEqual(SC.validate(SC.eventToShortcut(kbd('KeyR', { alt: true, shift: true }))).ok, false);
    });
  });

  describe('format', () => {
    it('⌃⌥⇧ 順序固定 + KeyX → X', () => {
      assert.strictEqual(SC.format({ code: 'KeyR', alt: true, shift: true, ctrl: true, meta: false }), '⌃⌥⇧R');
    });
    it('DigitN → N、符號鍵走 KEY_LABELS', () => {
      assert.strictEqual(SC.format({ code: 'Digit1', alt: true }), '⌥1');
      assert.strictEqual(SC.format({ code: 'Comma', alt: true }), '⌥,');
    });
  });

  describe('sanitizeTable —— storage 髒資料消毒', () => {
    it('null / undefined / 非物件 → 三 key 全 null', () => {
      [null, undefined, 'junk', 42].forEach((raw) => {
        const t = SC.sanitizeTable(raw);
        assert.deepStrictEqual(Object.keys(t).sort(), SC.COMMANDS.slice().sort());
        SC.COMMANDS.forEach((cmd) => assert.strictEqual(t[cmd], null));
      });
    });
    it('殘缺 value（缺 code / code 非字串）折回 null', () => {
      const t = SC.sanitizeTable({
        'toggle-reader-mode': { alt: true },
        'send-to-readwise': { code: 42 },
        'toggle-youtube-borderless': { code: 'KeyB', ctrl: true }
      });
      assert.strictEqual(t['toggle-reader-mode'], null);
      assert.strictEqual(t['send-to-readwise'], null);
      assert.deepStrictEqual(t['toggle-youtube-borderless'],
        { code: 'KeyB', alt: false, shift: false, ctrl: true, meta: false });
    });
  });
});

describe('(B) MANIFEST_DEFAULTS ↔ manifest.json commands 鏡像 forcing', () => {
  // 把 manifest suggested_key（'Alt+R' / 'Alt+Shift+R'）解析成 shortcut 物件。
  // 只支援目前用到的 Alt / Shift / Ctrl / Command + 單一字母，新 modifier
  // 出現時這裡會 throw —— 刻意，逼同步擴充。
  function parseSuggestedKey(str) {
    const parts = str.split('+');
    const key = parts.pop();
    assert.match(key, /^[A-Z0-9]$/, 'suggested_key 末段必須是單一字母/數字：' + str);
    const s = { code: /\d/.test(key) ? 'Digit' + key : 'Key' + key, alt: false, shift: false, ctrl: false, meta: false };
    parts.forEach((p) => {
      if (p === 'Alt') s.alt = true;
      else if (p === 'Shift') s.shift = true;
      else if (p === 'Ctrl' || p === 'MacCtrl') s.ctrl = true;
      else if (p === 'Command') s.meta = true;
      else assert.fail('未知 modifier：' + p);
    });
    return s;
  }

  SC.COMMANDS.forEach((cmd) => {
    it(cmd + '：utils 鏡像必須與 manifest suggested_key 一致', () => {
      const manifestCmd = MANIFEST.commands[cmd];
      assert.ok(manifestCmd, 'manifest.commands 必須有 ' + cmd);
      const suggested = manifestCmd.suggested_key && manifestCmd.suggested_key.default;
      const mirror = SC.MANIFEST_DEFAULTS[cmd];
      if (!suggested) {
        assert.strictEqual(mirror, null, cmd + ' manifest 無 suggested_key、鏡像必須是 null');
      } else {
        assert.deepStrictEqual(mirror, parseSuggestedKey(suggested),
          cmd + ' 鏡像與 manifest suggested_key (' + suggested + ') 不一致——改 manifest 必須同步 shortcut-utils.MANIFEST_DEFAULTS');
      }
    });
  });

  it('COMMANDS 必須涵蓋 manifest.commands 全部 key（新增 command 要同步開放自訂）', () => {
    assert.deepStrictEqual(Object.keys(MANIFEST.commands).sort(), SC.COMMANDS.slice().sort());
  });
});

describe('(C) manifest content_scripts wire-up', () => {
  const js = MANIFEST.content_scripts[0].js;
  it('shortcut-utils.js / custom-shortcuts.js 必須在 content_scripts 清單', () => {
    assert.ok(js.includes('content/shortcut-utils.js'), '缺 shortcut-utils.js');
    assert.ok(js.includes('content/custom-shortcuts.js'), '缺 custom-shortcuts.js');
  });
  it('載入順序：namespace → shortcut-utils → custom-shortcuts → main', () => {
    const idx = (f) => js.indexOf('content/' + f);
    assert.ok(idx('namespace.js') < idx('shortcut-utils.js'), 'namespace 必須先於 shortcut-utils');
    assert.ok(idx('shortcut-utils.js') < idx('custom-shortcuts.js'), 'shortcut-utils 必須先於 custom-shortcuts（後者 IIFE 立即讀 window.__JReadShortcuts）');
    assert.ok(idx('custom-shortcuts.js') < idx('main.js'),
      'custom-shortcuts 必須先於 main——keydown listener 須早於 keyguard 註冊（capture 同 phase 按註冊順序），否則 keyguard stopImmediatePropagation 會吃掉自訂鍵');
  });
});

describe('(D) custom-shortcuts.js source 結構', () => {
  it('keydown listener 必須掛 capture phase（第三參數 true）', () => {
    assert.match(CUSTOM_SRC, /addEventListener\(\s*['"]keydown['"]\s*,\s*onKeyDown\s*,\s*true\s*\)/,
      '必須 window.addEventListener("keydown", onKeyDown, true)——bubble phase 會被原站 capture listener 搶先');
  });
  it('命中後必須 preventDefault + stopImmediatePropagation', () => {
    assert.match(CUSTOM_SRC, /\.preventDefault\(\)/, '缺 preventDefault——macOS ⌥+字母會輸入 dead-key 字元');
    assert.match(CUSTOM_SRC, /\.stopImmediatePropagation\(\)/, '缺 stopImmediatePropagation——page JS 同 phase listener 仍會收到');
  });
  it('必須有 IME composition guard（isComposing / keyCode 229）', () => {
    assert.match(CUSTOM_SRC, /isComposing/, '缺 isComposing guard——中文輸入第一階段會誤觸');
    assert.match(CUSTOM_SRC, /keyCode\s*===\s*229/, '缺 keyCode 229 sentinel（老瀏覽器兜底）');
  });
  it('必須透過 NS.safeSendMessage 送 CUSTOM_COMMAND（context-invalidated guard）', () => {
    assert.match(CUSTOM_SRC, /safeSendMessage\(\s*\{\s*type:\s*NS\.MSG\.CUSTOM_COMMAND/,
      '必須走 NS.safeSendMessage——直呼 chrome.runtime.sendMessage 在 extension reload 後會 throw');
  });
  it('toggle 類指令必須優先本地 dispatch（v0.7.228：iOS SW 死亡後仍可用）、send-to-readwise 走 SW', () => {
    // iOS Safari SW 被回收後不再喚醒（Apple Forums 758346）——toggle 類指令
    // 的處理本來就在 content 端，繞 SW 一圈只會在 iOS 上隨時間失效。
    // send-to-readwise 的 API 呼叫住在 SW、必須照走 CUSTOM_COMMAND。
    assert.match(CUSTOM_SRC, /cmd\s*!==\s*'send-to-readwise'[\s\S]{0,120}NS\.dispatchLocalCommand/,
      'toggle 類指令必須在 send-to-readwise 排除後走 NS.dispatchLocalCommand（本地 dispatch）');
    const localIdx = CUSTOM_SRC.indexOf('NS.dispatchLocalCommand');
    const swIdx = CUSTOM_SRC.indexOf('NS.MSG.CUSTOM_COMMAND');
    assert.ok(localIdx !== -1 && swIdx !== -1 && localIdx < swIdx,
      '本地 dispatch 必須是主路徑、CUSTOM_COMMAND 是 send-to-readwise 與 fallback 用');
  });
  it('必須監聽 storage.onChanged 即時更新（options 改鍵不必 reload 頁面）', () => {
    assert.match(CUSTOM_SRC, /storage\.onChanged/, '缺 storage.onChanged listener');
  });
  it('storage 載回前（table=null）不可比對——避免空表誤判', () => {
    assert.match(CUSTOM_SRC, /if\s*\(!table\)\s*return/, '缺 table null guard');
  });
});

describe('(E) service worker', () => {
  it('DEFAULT_SETTINGS 必須含 customShortcuts 三 key 全 null', () => {
    const m = SHARED_DEFAULTS_SRC.match(/customShortcuts:\s*\{([\s\S]*?)\}/);
    assert.ok(m, 'shared DEFAULT_SETTINGS 必須含 customShortcuts');
    ['toggle-reader-mode', 'send-to-readwise', 'toggle-youtube-borderless'].forEach((cmd) => {
      assert.match(m[1], new RegExp("'" + cmd + "':\\s*null"), 'customShortcuts 缺 ' + cmd + ': null');
    });
  });
  it('commands dispatch 必須抽成 dispatchCommand(command, tabId)（預設鍵與自訂鍵單一資料源）', () => {
    assert.match(SW_SRC, /async function dispatchCommand\s*\(\s*command\s*,\s*tabId\s*\)/,
      '缺 dispatchCommand——onCommand 與 CUSTOM_COMMAND 必須共用同一條 dispatch（YouTube 模式重導邏輯不可雙實作）');
  });
  it('commands.onCommand 註冊必須在 existence guard 內（iOS 無完整 commands API）', () => {
    assert.match(SW_SRC, /if\s*\(chrome\.commands\s*&&\s*chrome\.commands\.onCommand\)/,
      '缺 chrome.commands guard——iOS API 缺席時 top-level addListener 會 TypeError 炸掉 SW');
  });
  it('onMessage 必須有 CUSTOM_COMMAND case + command 白名單 + sender.tab.id', () => {
    const m = SW_SRC.match(/case 'CUSTOM_COMMAND':\s*\{([\s\S]*?)\n    \}/);
    assert.ok(m, '缺 CUSTOM_COMMAND case');
    const body = m[1];
    assert.match(body, /allowed/, 'CUSTOM_COMMAND 必須有 command 白名單——page 端可偽造任意字串');
    assert.match(body, /sender\s*&&\s*sender\.tab\s*&&\s*sender\.tab\.id/, 'tabId 必須取 sender.tab.id（按鍵發生的 tab）');
    assert.match(body, /dispatchCommand\(command,\s*tabId\)/, '必須走 dispatchCommand');
  });
});

describe('(F) namespace / options / popup wire-up', () => {
  it('namespace.js MSG 必須含 CUSTOM_COMMAND', () => {
    assert.match(NS_SRC, /CUSTOM_COMMAND:\s*'CUSTOM_COMMAND'/);
  });
  it('options.html 必須有快速鍵 section + 三顆 recorder + hint 區', () => {
    assert.match(OPTIONS_HTML, />快速鍵<\/h2>/, '缺「快速鍵」section heading');
    SC.COMMANDS.forEach((cmd) => {
      assert.ok(OPTIONS_HTML.includes('id="sc-' + cmd + '"'), '缺 recorder #sc-' + cmd);
      assert.ok(OPTIONS_HTML.includes('id="sc-clear-' + cmd + '"'), '缺清除鈕 #sc-clear-' + cmd);
    });
    assert.ok(OPTIONS_HTML.includes('id="shortcut-hint"'), '缺 #shortcut-hint（驗證失敗原因顯示區）');
  });
  it('options.html 必須引入 shortcut-utils.js 且先於 options.js', () => {
    const utilIdx = OPTIONS_HTML.indexOf('shortcut-utils.js');
    const optIdx = OPTIONS_HTML.indexOf('"options.js"');
    assert.ok(utilIdx !== -1, '缺 shortcut-utils.js script tag');
    assert.ok(utilIdx < optIdx, 'shortcut-utils.js 必須先於 options.js（後者 top-level 讀 window.__JReadShortcuts）');
  });
  it('options.js DEFAULTS 必須含 customShortcuts、recorder 寫回必須整張表 set', () => {
    assert.match(OPTIONS_JS, /customShortcuts:\s*\{/, 'DEFAULTS 缺 customShortcuts');
    assert.match(OPTIONS_JS, /chrome\.storage\.sync\.set\(\s*\{\s*customShortcuts:\s*shortcutTable\s*\}/,
      '必須整張表寫回（partial set 會讓其他 command 的設定 drift）');
  });
  it('options.js recorder 必須做「與其他指令生效鍵衝突」檢查', () => {
    assert.match(OPTIONS_JS, /shortcutTable\[other\]\s*\|\|\s*SC\.MANIFEST_DEFAULTS\[other\]/,
      '衝突檢查必須比對其他指令的生效鍵（自訂值 || 內建預設），缺了會讓兩個指令吃同一組合');
  });
  it('popup.js DEFAULT_SETTINGS 必須含 customShortcuts（default fallback parity）', () => {
    assert.match(POPUP_JS, /customShortcuts:\s*\{/, 'popup DEFAULT_SETTINGS 缺 customShortcuts——storage.get 缺 default 會讀回 undefined');
  });
});

describe('(G) popup 快速鍵提示（v0.7.220）', () => {
  // Jimmy 2026-06-06 回報：options 已錄自訂鍵，popup footer 仍顯示
  // 「快速鍵未設定，請到 chrome://extensions/shortcuts 指派」——舊版提示
  // 只看 commands.getAll（browser 層），不知道 customShortcuts 存在。
  const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');

  it('提示必須先讀 storage customShortcuts、自訂鍵存在時優先顯示', () => {
    const m = POPUP_JS.match(/chrome\.storage\.sync\.get\(\s*\{\s*customShortcuts:[\s\S]*?\n\}\);/);
    assert.ok(m, 'popup 快速鍵提示必須以 storage.sync.get(customShortcuts) 開頭');
    const body = m[0];
    assert.match(body, /SCU\.format\(custom\)/, '自訂鍵存在時必須 format 顯示');
    // 自訂鍵分支必須在 getAll fallback 之前（順位：自訂 → browser 層 → 未設定）
    assert.ok(body.indexOf('SCU.format(custom)') < body.indexOf('chrome.commands.getAll'),
      '自訂鍵顯示必須先於 commands.getAll fallback');
  });

  it('未設定訊息不可再指向 chrome://extensions/shortcuts（Safari 沒有那頁）', () => {
    assert.ok(!POPUP_JS.includes('快速鍵未設定，請到'),
      '舊訊息「快速鍵未設定，請到 chrome://extensions/shortcuts 指派」必須移除');
    assert.match(POPUP_JS, /快速鍵未設定——可在進階設定錄製/,
      '未設定訊息必須指向進階設定的 recorder');
  });

  it('popup.html 必須引入 shortcut-utils.js 且先於 popup.js', () => {
    const utilIdx = POPUP_HTML.indexOf('shortcut-utils.js');
    const popupIdx = POPUP_HTML.indexOf('"popup.js"');
    assert.ok(utilIdx !== -1, 'popup.html 缺 shortcut-utils.js script tag');
    assert.ok(utilIdx < popupIdx, 'shortcut-utils.js 必須先於 popup.js（提示 callback 讀 window.__JReadShortcuts）');
  });

  it('觸控裝置提示必須顯示 3 指輕點手勢、且優先於自訂鍵（v0.7.232）', () => {
    // Jimmy 2026-06-07：有觸控的版本，popup 下方快速鍵提示以三指觸控代替。
    const m = POPUP_JS.match(/chrome\.storage\.sync\.get\(\s*\{\s*customShortcuts:[\s\S]*?\n\}\);/);
    assert.ok(m, 'popup 快速鍵提示 block 不存在');
    const body = m[0];
    // 注意：必須驗 if 述句本身（含 navigator. 前綴 + 完整條件），不能只 grep
    // 「maxTouchPoints >= 3」——註解裡也有同字樣，鬆 regex 會偽陰性放行。
    const touchIf = /if\s*\(\(navigator\.maxTouchPoints\s*\|\|\s*0\)\s*>=\s*3\)/;
    assert.match(body, touchIf,
      '觸控判定必須用 (navigator.maxTouchPoints || 0) >= 3（與 touch-gestures.js 安裝門檻一致，結構性不綁平台）');
    assert.match(body, /三指輕點/, '觸控提示文字必須含「三指輕點」');
    assert.ok(body.search(touchIf) < body.indexOf('SCU.format(custom)'),
      '觸控手勢分支必須先於自訂鍵顯示（觸控環境手勢恆可用、外接鍵盤未必在）');
  });

  it('iOS guard 保留：commands API 缺席且無自訂時 shortcutEl 必須 hidden', () => {
    assert.match(POPUP_JS, /shortcutEl\.hidden = true/,
      'commands API 缺席 fallback（觸控環境整列隱藏）不可移除');
  });
});
