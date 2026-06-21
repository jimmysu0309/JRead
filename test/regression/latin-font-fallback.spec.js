// JRead — 英文（拉丁）fallback 字型自訂 forcing function（v0.8.144）
//
// 功能：popup「字型」選襯線 / 無襯線時，下方多一個「英文字型」select，可單獨指定
// 英文 / 數字用哪個拉丁字型（中文仍由該 stack 的 CJK 字體渲染）。襯線 / 無襯線各自
// 記一個選擇（latinSerif / latinSans）。'auto' = 沿用 base stack 內建西文字型。
//
// 架構：fontFamily 仍存 base stack 整串字面值（既有契約不變、不遷移既有使用者）。
// composeFontStack(settings) 在讀取邊界（main.js getSettings）把選定拉丁字型「前接」
// 到 base stack 前面——CSS 逐字 fallback 下英文先命中前接字型、中文穿到後段 CJK。
// styler 下游維持「只認 fontFamily 整串字面值」不變。
//
// 訊號層次：本檔驗 composeFontStack 純函式邏輯 + 預設值 + popup wiring 結構。
//   不驗：真實瀏覽器逐字 fallback 渲染（靠 harness 截圖 / Jimmy 實機）、popup
//   select 的實際顯隱（jsdom 不跑 popup.js，只驗 HTML 結構與 source pattern）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup', 'popup.js'), 'utf8');
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'content', 'main.js'), 'utf8');

const SHARED = require(path.join(ROOT, 'content', 'settings-defaults.js'));
const FONT_STACKS = globalThis.__JReadFontStacks;
const LATIN_FONTS = globalThis.__JReadLatinFonts;
const compose = globalThis.__JReadComposeFontStack;

describe('英文（拉丁）fallback 字型自訂（v0.8.144）', () => {
  describe('預設值', () => {
    it('DEFAULT_SETTINGS.latinSerif / latinSans 預設 "auto"', () => {
      assert.strictEqual(SHARED.latinSerif, 'auto');
      assert.strictEqual(SHARED.latinSans, 'auto');
    });
  });

  describe('LATIN_FONTS map', () => {
    it('含 auto + 預期的具名字型 key', () => {
      for (const k of ['auto', 'georgia', 'times', 'charter', 'palatino',
        'helvetica', 'arial', 'verdana', 'sfmono', 'consolas']) {
        assert.ok(k in LATIN_FONTS, `LATIN_FONTS 必須含 "${k}"`);
      }
    });
    it('auto = 空字串（不前接）', () => {
      assert.strictEqual(LATIN_FONTS.auto, '');
    });
    it('前接值只放具名字型、不含泛型（iOS WebKit 中段泛型攔截 CJK 防線）', () => {
      for (const [k, v] of Object.entries(LATIN_FONTS)) {
        if (k === 'auto') continue;
        assert.ok(!/\b(serif|sans-serif|monospace)\b/.test(v),
          `LATIN_FONTS.${k}（"${v}"）不可含泛型字型——泛型放中段會被 iOS WebKit 當「只解析拉丁」攔截、CJK 反 fallback 到後綴 sans`);
      }
    });
  });

  describe('composeFontStack()', () => {
    it('latin = auto 時 base stack 原樣不變（襯線 / 無襯線 / 系統 / 等寬）', () => {
      assert.strictEqual(compose({ fontFamily: FONT_STACKS.serif, latinSerif: 'auto', latinSans: 'auto' }), FONT_STACKS.serif);
      assert.strictEqual(compose({ fontFamily: FONT_STACKS.sans, latinSerif: 'auto', latinSans: 'auto' }), FONT_STACKS.sans);
      assert.strictEqual(compose({ fontFamily: FONT_STACKS.system }), FONT_STACKS.system);
      assert.strictEqual(compose({ fontFamily: FONT_STACKS.mono }), FONT_STACKS.mono);
    });

    it('襯線 + 指定英文字型 → 前接到 serif base stack 前', () => {
      assert.strictEqual(
        compose({ fontFamily: FONT_STACKS.serif, latinSerif: 'charter' }),
        'Charter, ' + FONT_STACKS.serif);
      assert.strictEqual(
        compose({ fontFamily: FONT_STACKS.serif, latinSerif: 'palatino' }),
        'Palatino, "Palatino Linotype", "Book Antiqua", ' + FONT_STACKS.serif);
    });

    it('無襯線 + 指定英文字型 → 前接到 sans base stack 前', () => {
      assert.strictEqual(
        compose({ fontFamily: FONT_STACKS.sans, latinSans: 'arial' }),
        'Arial, ' + FONT_STACKS.sans);
    });

    it('latinSerif 只在 base = 襯線時生效；latinSans 只在 base = 無襯線時生效', () => {
      // base 是無襯線時，latinSerif 不該被套用（用 latinSans）
      assert.strictEqual(
        compose({ fontFamily: FONT_STACKS.sans, latinSerif: 'charter', latinSans: 'auto' }),
        FONT_STACKS.sans);
      // base 是襯線時，latinSans 不該被套用
      assert.strictEqual(
        compose({ fontFamily: FONT_STACKS.serif, latinSerif: 'auto', latinSans: 'arial' }),
        FONT_STACKS.serif);
    });

    it('系統預設 / 等寬不前接英文字型（無此維度）', () => {
      assert.strictEqual(
        compose({ fontFamily: FONT_STACKS.system, latinSerif: 'charter', latinSans: 'arial' }),
        FONT_STACKS.system);
      assert.strictEqual(
        compose({ fontFamily: FONT_STACKS.mono, latinSerif: 'charter', latinSans: 'arial' }),
        FONT_STACKS.mono);
    });

    it('未知 / 損壞 latin 值 → 當 auto 處理（不前接）', () => {
      assert.strictEqual(
        compose({ fontFamily: FONT_STACKS.serif, latinSerif: 'bogus-font' }),
        FONT_STACKS.serif);
    });

    it('未遷移的舊 literal / 外部自訂 stack → 原樣回傳', () => {
      const custom = 'Comic Sans MS, cursive';
      assert.strictEqual(compose({ fontFamily: custom, latinSerif: 'charter' }), custom);
    });
  });

  describe('popup.html', () => {
    let dom;
    before(() => { dom = new JSDOM(POPUP_HTML); });

    it('必須含 #latin-font-row（預設 hidden）+ #latin-font-select', () => {
      const row = dom.window.document.getElementById('latin-font-row');
      const sel = dom.window.document.getElementById('latin-font-select');
      assert.ok(row, 'popup.html 必須有 id="latin-font-row"');
      assert.ok(row.hasAttribute('hidden'), 'latin-font-row 預設必須 hidden（系統預設時不顯示）');
      assert.ok(sel, 'popup.html 必須有 id="latin-font-select"');
    });

    it('latin select option value 必須與 LATIN_FONTS key 對齊（含 auto）', () => {
      const sel = dom.window.document.getElementById('latin-font-select');
      const values = Array.from(sel.querySelectorAll('option')).map(o => o.value);
      assert.ok(values.includes('auto'), '必須有「自動」option（value="auto"）');
      for (const v of values) {
        assert.ok(v in LATIN_FONTS, `latin select option value "${v}" 必須是 LATIN_FONTS 的 key`);
      }
    });

    it('latin select 必須有可點擊聚焦的 label', () => {
      const label = dom.window.document.querySelector('label[for="latin-font-select"]');
      assert.ok(label, '必須有 <label for="latin-font-select">');
      assert.strictEqual(label.textContent.trim(), '英文字型');
    });
  });

  describe('popup.js wiring', () => {
    it('render() 依 fontFamily 顯隱 latin row 並載入 latinSerif / latinSans', () => {
      assert.ok(/latinFontRow\.hidden\s*=\s*false/.test(POPUP_JS), 'render 必須能顯示 latin row');
      assert.ok(/settings\.latinSerif/.test(POPUP_JS), 'render 必須讀 settings.latinSerif');
      assert.ok(/settings\.latinSans/.test(POPUP_JS), 'render 必須讀 settings.latinSans');
    });
    it('change handler 依當前字型寫進 latinSerif / latinSans', () => {
      assert.ok(/latinFontSelect\.addEventListener\(['"]change['"]/.test(POPUP_JS),
        'popup.js 必須對 latinFontSelect 綁 change handler');
      assert.ok(/save\(\{\s*latinSerif:/.test(POPUP_JS), 'handler 必須能 save latinSerif');
      assert.ok(/save\(\{\s*latinSans:/.test(POPUP_JS), 'handler 必須能 save latinSans');
    });
  });

  describe('main.js 讀取邊界組合', () => {
    it('getSettings 必須套 composeFontStack 把英文字型前接到 fontFamily', () => {
      assert.ok(/__JReadComposeFontStack/.test(MAIN_JS),
        'main.js getSettings 必須呼叫 window.__JReadComposeFontStack 組合 fontFamily');
    });
    it('storage.onChanged relevantKeys 必須含 latinSerif / latinSans（改英文字型即時重套）', () => {
      const m = MAIN_JS.match(/const relevantKeys = \[([^\]]*)\]/);
      assert.ok(m, '抓不到 relevantKeys');
      assert.ok(/latinSerif/.test(m[1]) && /latinSans/.test(m[1]),
        'relevantKeys 必須含 latinSerif / latinSans');
    });
  });
});
