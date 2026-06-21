// JRead — popup 字型 select regression（v0.7.140）
// 對應功能：popup 設定面板新增「字型」row，提供 4 個內建 stack（系統預設 /
// 襯線 / 無襯線 / 等寬）。預設值（system-ui）對齊 styler DEFAULTS.fontFamily,
// 選預設值時 styler 不注入 font-family override（保留原站字體）。
//
// 本 spec 是 forcing function：
//   - popup.html 必須含字型 select + 4 個 option，value 與 popup.js
//     FONT_STACKS 字面值逐字一致（select.value 從 storage 讀回時必須能 match
//     到 option，否則 select 顯示空白、UI 壞）。
//   - popup.js FONT_STACKS.system 必須與 styler.js DEFAULTS.fontFamily 字面
//     值一致（兩處 drift 會造成「選系統預設仍注入 override」或反之）。
//   - popup.js DEFAULT_SETTINGS.fontFamily 必須存在且 = FONT_STACKS.system
//     （storage.sync.get 預設 fallback；未設過時的初始值）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const POPUP_HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.html'), 'utf8'
);
const POPUP_JS = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.js'), 'utf8'
);
const STYLER_JS = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'styler.js'), 'utf8'
);
// v0.8.16：FONT_STACKS / DEFAULT_SETTINGS 收斂到 content/settings-defaults.js
// 單一資料源。popup.js 改 reference window.__JReadFontStacks / __JReadSettingsDefaults，
// 不再各自宣告 literal。require shared 後從 globalThis 取正準值。
const SHARED = require(path.join(__dirname, '..', '..', 'jread', 'content', 'settings-defaults.js'));
const SHARED_FONT_STACKS = globalThis.__JReadFontStacks;

describe('popup 字型 select（v0.7.140）', () => {
  describe('popup.html', () => {
    let dom;
    before(() => {
      dom = new JSDOM(POPUP_HTML);
    });

    it('必須含 <select id="font-family-select">', () => {
      const select = dom.window.document.getElementById('font-family-select');
      assert.ok(select, 'popup.html 必須有 id="font-family-select" 的 select 元素');
      assert.strictEqual(select.tagName.toLowerCase(), 'select');
    });

    it('select 必須恰好 4 個 option（系統預設 / 襯線 / 無襯線 / 等寬）', () => {
      const select = dom.window.document.getElementById('font-family-select');
      const options = Array.from(select.querySelectorAll('option'));
      assert.strictEqual(options.length, 4,
        `必須恰好 4 個 option（系統預設/襯線/無襯線/等寬），目前 ${options.length}`);
      const texts = options.map(o => o.textContent.trim());
      assert.deepStrictEqual(texts, ['系統預設', '襯線', '無襯線', '等寬']);
    });

    it('option value 必須對齊 popup.js FONT_STACKS 字面值', () => {
      const select = dom.window.document.getElementById('font-family-select');
      const values = Array.from(select.querySelectorAll('option')).map(o => o.value);
      // 對應 popup.js FONT_STACKS.system / .serif / .sans / .mono
      assert.strictEqual(values[0], 'system-ui',
        '「系統預設」option value 必須是 "system-ui"（對齊 styler DEFAULTS.fontFamily）');
      assert.strictEqual(values[1],
        // v0.7.221：補 CJK 襯線字體（macOS Songti / iOS Hiragino Mincho）——
        // 根因與平台實證見 serif-font-stack.spec.js
        // v0.8.25：西文襯線（Georgia / Times）排到 CJK 之前，英文 fall back 到 Georgia
        'Georgia, "Times New Roman", "Noto Serif TC", "Songti TC", "Songti SC", "Hiragino Mincho ProN", serif',
        '「襯線」option value 必須對齊 popup.js FONT_STACKS.serif 字面值');
      assert.strictEqual(values[2],
        // v0.7.254：系統 CJK 字型優先、Noto Sans TC 降後（繞過站點 @font-face
        // 劫持「Noto Sans TC」名字導致字重失效——根因見 popup.js FONT_STACKS.sans 註解）
        '-apple-system, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Helvetica Neue", sans-serif',
        '「無襯線」option value 必須對齊 popup.js FONT_STACKS.sans 字面值');
      assert.strictEqual(values[3], 'ui-monospace, Menlo, Consolas, monospace',
        '「等寬」option value 必須對齊 popup.js FONT_STACKS.mono 字面值');
    });

    it('字型 setting-row 必須含 label[for="font-family-select"] 可點擊聚焦', () => {
      const label = dom.window.document.querySelector(
        'label[for="font-family-select"]'
      );
      assert.ok(label, '必須有 <label for="font-family-select">，點 label 才能聚焦 select');
      // v0.8.145：「字型」→「中文字型」（旁邊已有「英文字型」select，明示這顆控中文/base 字型）
      assert.strictEqual(label.textContent.trim(), '中文字型');
    });
  });

  describe('popup.js', () => {
    it('FONT_STACKS 取自單一資料源、含 system / serif / sans / mono 四個 key', () => {
      // v0.8.16：popup.js FONT_STACKS 改 reference window.__JReadFontStacks。
      // 結構驗 reference 形式；key 集合驗 shared 物件。
      assert.match(POPUP_JS, /const FONT_STACKS = window\.__JReadFontStacks\b/,
        'popup.js FONT_STACKS 必須 = window.__JReadFontStacks（單一資料源）');
      for (const key of ['system', 'serif', 'sans', 'mono']) {
        assert.ok(key in SHARED_FONT_STACKS,
          `shared FONT_STACKS 必須含 "${key}" key`);
        assert.strictEqual(typeof SHARED_FONT_STACKS[key], 'string',
          `shared FONT_STACKS.${key} 必須是字串 stack`);
      }
    });

    it('FONT_STACKS.system 必須是 "system-ui"（與 styler DEFAULTS.fontFamily 對齊）', () => {
      assert.strictEqual(SHARED_FONT_STACKS.system, 'system-ui',
        'shared FONT_STACKS.system 必須等於 "system-ui"');
    });

    it('DEFAULT_SETTINGS.fontFamily 必須等於 FONT_STACKS.system（單一資料源內自洽）', () => {
      // v0.8.16：popup 不再有自己的 DEFAULT_SETTINGS literal——「選系統預設 == 不
      // 注入 override」要成立，shared 的 fontFamily 預設值必須恰為 FONT_STACKS.system。
      assert.strictEqual(SHARED.fontFamily, SHARED_FONT_STACKS.system,
        'shared DEFAULT_SETTINGS.fontFamily 必須等於 FONT_STACKS.system（system-ui）');
    });

    it('必須對 font-family-select 綁 change handler 寫進 storage', () => {
      assert.ok(
        /fontFamilySelect\.addEventListener\(['"]change['"]/.test(POPUP_JS),
        'popup.js 必須對 fontFamilySelect 綁 change event handler'
      );
      assert.ok(/save\(\{\s*fontFamily:/.test(POPUP_JS),
        'change handler 必須呼叫 save({ fontFamily: ... }) 觸發 storage.sync.set'
      );
    });

    it('render() 必須同步 fontFamilySelect.value（讓 storage 變更時 UI 跟上）', () => {
      // 寬鬆 match：可以是 .value = settings.fontFamily / current.fontFamily
      assert.ok(
        /fontFamilySelect\.value\s*=\s*(settings|current)\.fontFamily/.test(POPUP_JS),
        'render() 必須把 settings.fontFamily 寫入 fontFamilySelect.value'
      );
    });
  });

  describe('popup.js ↔ styler.js fontFamily DEFAULT 同步', () => {
    it('styler DEFAULTS.fontFamily 必須等於 "system-ui"（與 popup FONT_STACKS.system 一致）', () => {
      // styler DEFAULTS.fontFamily 字面值；drift 會造成「popup 選『系統預設』
      // 仍注入 override」或反之
      assert.ok(/fontFamily:\s*['"]system-ui['"]/.test(STYLER_JS),
        'styler.js DEFAULTS.fontFamily 必須等於 "system-ui"——與 popup FONT_STACKS.system 對齊');
    });
  });
});
