// JRead — keyguard regression (v0.7.131)
//
// Reader mode 啟動時攔截原站快速鍵（Gmail j/k/e、YouTube k 等）避免誤觸。
// 動機：Jimmy 2026-05-18 — 在 Gmail / YouTube 等 keyboard-shortcut-heavy 站點
// 開閱讀模式時，誤按單鍵會觸發原站 archive / send 等破壞性操作。
//
// 攔截方式：window keydown/keypress/keyup capture-phase listener、
// stopImmediatePropagation()（阻 page JS listener），不 preventDefault（保留
// 瀏覽器原生 default action）。settings.blockPageShortcuts 控制 on/off，預設 on。
//
// 本檔做純 source 結構 assertion——chrome.* / window.addEventListener 走真實
// 瀏覽器才能驗，jsdom 跑不到（content script 在 isolated world）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const SW_SRC      = fs.readFileSync(path.join(ROOT, 'jread', 'background', 'service-worker.js'), 'utf8');
const MAIN_SRC    = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'main.js'), 'utf8');
const OPTIONS_HTML = fs.readFileSync(path.join(ROOT, 'jread', 'options', 'options.html'), 'utf8');
const OPTIONS_JS   = fs.readFileSync(path.join(ROOT, 'jread', 'options', 'options.js'), 'utf8');
const POPUP_JS     = fs.readFileSync(path.join(ROOT, 'jread', 'popup', 'popup.js'), 'utf8');

describe('keyguard v0.7.131 — reader mode 攔截原站快速鍵', () => {

  describe('SW DEFAULT_SETTINGS', () => {
    it('必須含 blockPageShortcuts: true（預設 on）', () => {
      // 抓 DEFAULT_SETTINGS object literal body
      const m = SW_SRC.match(/const\s+DEFAULT_SETTINGS\s*=\s*\{([\s\S]*?)\};/);
      assert.ok(m, '能在 SW 找到 DEFAULT_SETTINGS');
      const body = m[1];
      assert.match(body, /blockPageShortcuts\s*:\s*true\b/,
        'SW DEFAULT_SETTINGS 必須含 blockPageShortcuts: true——forcing：欄位缺席會讓 content script 讀回 undefined、條件式 `!== false` 預設啟用 OK，但 storage migration / popup 預設值會不同步');
    });
  });

  describe('popup.js DEFAULT_SETTINGS', () => {
    it('必須含 blockPageShortcuts 欄位（storage.get 的 default fallback）', () => {
      const m = POPUP_JS.match(/const\s+DEFAULT_SETTINGS\s*=\s*\{([\s\S]*?)\};/);
      assert.ok(m, '能在 popup.js 找到 DEFAULT_SETTINGS');
      assert.match(m[1], /blockPageShortcuts\s*:/,
        'popup.js DEFAULT_SETTINGS 必須含 blockPageShortcuts——forcing：storage.get 缺 default 會讀回 undefined');
    });
  });

  describe('main.js keyguard 實作', () => {
    it('必須宣告 keyguardHandler function', () => {
      assert.match(MAIN_SRC, /function\s+keyguardHandler\s*\(/,
        'main.js 必須有 keyguardHandler function——forcing：缺 handler 等於完全沒攔截');
    });

    it('keyguardHandler 必須呼叫 stopImmediatePropagation（不只 stopPropagation）', () => {
      // 抓 keyguardHandler body
      const m = MAIN_SRC.match(/function\s+keyguardHandler\s*\(\s*e\s*\)\s*\{([\s\S]*?)\n\s\s\}/);
      assert.ok(m, '能抓到 keyguardHandler body');
      const body = m[1];
      assert.match(body, /\.stopImmediatePropagation\s*\(/,
        'keyguardHandler 必須 stopImmediatePropagation——forcing：只 stopPropagation 會讓同階段（capture phase）的其他 page listener 仍收到事件、攔截失敗');
    });

    it('keyguardHandler 必須放行 IME composition（e.isComposing 或 keyCode 229）', () => {
      const m = MAIN_SRC.match(/function\s+keyguardHandler\s*\(\s*e\s*\)\s*\{([\s\S]*?)\n\s\s\}/);
      assert.ok(m);
      const body = m[1];
      assert.ok(
        /e\.isComposing/.test(body) || /keyCode\s*===?\s*229/.test(body),
        'keyguardHandler 必須放行 IME composition——forcing：中文輸入第一階段擋掉會破壞使用者打字'
      );
    });

    it('keyguardHandler 必須放行 INPUT / TEXTAREA / SELECT / contenteditable focus', () => {
      const m = MAIN_SRC.match(/function\s+keyguardHandler\s*\(\s*e\s*\)\s*\{([\s\S]*?)\n\s\s\}/);
      assert.ok(m);
      const body = m[1];
      assert.match(body, /INPUT|TEXTAREA/,
        'keyguardHandler 必須放行 INPUT / TEXTAREA——forcing：使用者在搜尋框打字會被擋');
      assert.match(body, /isContentEditable|contenteditable/,
        'keyguardHandler 必須放行 contenteditable——forcing：頁面內 rich editor 編輯會被擋');
    });

    it('必須宣告 installKeyguard / uninstallKeyguard helper（避免重複註冊）', () => {
      assert.match(MAIN_SRC, /function\s+installKeyguard\s*\(/,
        '必須有 installKeyguard helper');
      assert.match(MAIN_SRC, /function\s+uninstallKeyguard\s*\(/,
        '必須有 uninstallKeyguard helper');
    });

    it('installKeyguard 必須 capture phase 註冊（addEventListener 第三參 true）', () => {
      const m = MAIN_SRC.match(/function\s+installKeyguard[\s\S]*?\n\s\s\}/);
      assert.ok(m, '能抓到 installKeyguard body');
      const body = m[0];
      assert.match(body, /addEventListener\s*\(\s*['"]keydown['"]\s*,\s*keyguardHandler\s*,\s*true\s*\)/,
        'installKeyguard 必須 capture phase（第三參 true）註冊 keydown——forcing：bubble phase 會晚於頁面 capture listener，攔不到');
    });

    it('enterReaderMode 必須根據 settings.blockPageShortcuts 決定 installKeyguard', () => {
      // 抓 enterReaderMode body 到第一個 return true / return false 結尾
      const idx = MAIN_SRC.search(/async\s+function\s+enterReaderMode/);
      assert.ok(idx >= 0);
      // 取從 enterReaderMode 開始的後續 2000 字（足以涵蓋全函式）
      const slice = MAIN_SRC.slice(idx, idx + 2000);
      assert.match(slice, /settings\.blockPageShortcuts/,
        'enterReaderMode 必須讀 settings.blockPageShortcuts——forcing：少了條件就變強制攔截、無法 opt-out');
      assert.match(slice, /installKeyguard\s*\(/,
        'enterReaderMode 必須呼叫 installKeyguard——forcing：缺呼叫就完全沒攔截');
    });

    it('exitReaderMode 必須無條件呼叫 uninstallKeyguard', () => {
      const idx = MAIN_SRC.search(/function\s+exitReaderMode/);
      assert.ok(idx >= 0);
      const slice = MAIN_SRC.slice(idx, idx + 2000);
      assert.match(slice, /uninstallKeyguard\s*\(/,
        'exitReaderMode 必須 uninstallKeyguard——forcing：reader mode 關閉後 keyguard 仍掛在 window 上會繼續攔截、影響使用者');
    });

    it('storage.onChanged 必須處理 blockPageShortcuts 動態切換', () => {
      // 抓 storage.onChanged.addListener body
      const m = MAIN_SRC.match(/chrome\.storage\.onChanged\.addListener\(([\s\S]*?)\n\s\s\}\)\s*;/);
      assert.ok(m, '能抓到 storage.onChanged listener body');
      assert.match(m[0], /blockPageShortcuts/,
        'storage.onChanged 必須處理 blockPageShortcuts 變更——forcing：options toggle 後不能即時生效，得退出/重進 reader mode');
    });
  });

  describe('options 設定 UI', () => {
    it('options.html 必須含 #blockPageShortcuts checkbox', () => {
      assert.match(OPTIONS_HTML, /<input[^>]+type=["']checkbox["'][^>]+id=["']blockPageShortcuts["']/,
        'options.html 必須有 <input type="checkbox" id="blockPageShortcuts">——forcing：UI 缺席使用者無法切換');
    });

    it('options.js DEFAULTS / fields 必須含 blockPageShortcuts', () => {
      // DEFAULTS object
      const m = OPTIONS_JS.match(/const\s+DEFAULTS\s*=\s*\{([\s\S]*?)\};/);
      assert.ok(m, '能找到 options.js DEFAULTS');
      assert.match(m[1], /blockPageShortcuts\s*:/,
        'options.js DEFAULTS 必須含 blockPageShortcuts——forcing：load 時讀回 undefined');
      // fields array
      assert.match(OPTIONS_JS, /'blockPageShortcuts'/,
        "options.js fields 陣列必須含 'blockPageShortcuts'——forcing：change 事件未綁定 = toggle 後不存");
    });

    it('options.js save() 必須處理 checkbox.checked → boolean', () => {
      assert.match(OPTIONS_JS, /blockPageShortcuts\s*:\s*document\.getElementById\(\s*['"]blockPageShortcuts['"]\s*\)\.checked/,
        'save() 必須讀 #blockPageShortcuts.checked 寫進 patch——forcing：欄位漏掉 = toggle 後 storage 不更新');
    });

    // v0.7.132：checkbox 在 flex container 內必須 flex-shrink:0 防壓扁。
    // bug：v0.7.131 截圖顯示 checkbox 被壓成細長條 + 對勾位置走位——`.field`
    // 是 flex 且 label 內含長 desc 文字佔據大部分 row，預設 flex-shrink:1
    // 把 18×18 checkbox 壓變形。修法：`flex: 0 0 18px`（不可成長、不可收縮、
    // basis 18px）保住 box 尺寸。
    it('options.html .field checkbox 必須 flex: 0 0 ... 或 flex-shrink: 0（防 flex 壓扁變形）', () => {
      // 抓 .field input[type="checkbox"] 的 CSS rule block
      const m = OPTIONS_HTML.match(
        /\.field\s+input\[type=["']checkbox["']\]\s*\{([\s\S]*?)\}/
      );
      assert.ok(m, '能在 options.html 找到 .field input[type="checkbox"] rule');
      const body = m[1];
      const hasFlexShortcut = /\bflex\s*:\s*0\s+0\b/.test(body);
      const hasFlexShrink   = /flex-shrink\s*:\s*0\b/.test(body);
      assert.ok(hasFlexShortcut || hasFlexShrink,
        '.field checkbox 必須 `flex: 0 0 <basis>` 或 `flex-shrink: 0`——forcing：缺此規則 label 含長 desc 時 checkbox 會被壓變形（v0.7.131 → v0.7.132 hotfix）');
    });
  });
});
