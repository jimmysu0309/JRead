// JRead — 內嵌拉丁可變字型 forcing function（v0.8.146）
//
// 功能：popup「英文字型」選單自帶 woff2 的拉丁字型——襯線群 Source Serif /
// Piazzolla、無襯線群 Public Sans / Source Sans（v0.8.158 移除 literata，剩 4 支）。
// 為什麼要內嵌（而非像 Georgia / Palatino 只點名系統字）：這幾支非系統字，iOS Safari 網頁路徑沒有、
// 只點名不載入會 fall back 到別的字（同 Noto Serif TC 內嵌理由）。自帶 woff2 才能在
// iOS 真的生效。
//
// 為什麼單一 @font-face 用 weight range 不踩 Noto 的坑：這 5 支都是真·可變字型
// （fvar wght 軸），weight range 對映到真實軸值 → 細 300 / 中 400 / 粗 600 各有差別；
// Noto 那組是靜態字面，用 range 會讓三段塌成同一字面（v0.7.257 Bug 二），故拆三檔。
//
// 訊號層次：本檔驗「5 woff2 存在 + 合法 + styler @font-face 接線（family / 檔名 /
// weight range）+ LATIN_FONTS 對映 + composeFontStack 前接 + 只注入被選到那一支 +
// popup option 齊全」。不驗：真實 WebKit 逐字 fallback 渲染（靠 simulator / Jimmy 實機）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const FONT_DIR = path.join(ROOT, 'assets', 'fonts');
const STYLER_SRC = fs.readFileSync(path.join(ROOT, 'content', 'styler.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');

require(path.join(ROOT, 'content', 'settings-defaults.js'));
const FONT_STACKS = globalThis.__JReadFontStacks;
const LATIN_FONTS = globalThis.__JReadLatinFonts;
const compose = globalThis.__JReadComposeFontStack;

// key（popup option value / latinSerif|latinSans 存值）→ { file, family, group }
const BUNDLED = {
  sourceserif: { file: 'source-serif.woff2', family: 'Source Serif', group: 'serif' },
  piazzolla:   { file: 'piazzolla.woff2',    family: 'Piazzolla',    group: 'serif' },
  publicsans:  { file: 'public-sans.woff2',  family: 'Public Sans',  group: 'sans'  },
  sourcesans:  { file: 'source-sans.woff2',  family: 'Source Sans',  group: 'sans'  },
};
const ALL_FILES = Object.values(BUNDLED).map((b) => b.file);

const DEFAULT_SETTINGS = {
  theme: 'light', fontSize: 18, contentWidth: 720,
  fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0
};

describe('內嵌拉丁可變字型（v0.8.146 forcing function）', () => {
  it('4 支 woff2 都存在、為合法 woff2、體積合理（Latin-subset 應 < 200KB）', () => {
    for (const { file } of Object.values(BUNDLED)) {
      const p = path.join(FONT_DIR, file);
      assert.ok(fs.existsSync(p), `jread/assets/fonts/${file} 必須存在`);
      const buf = fs.readFileSync(p);
      assert.strictEqual(buf.slice(0, 4).toString('ascii'), 'wOF2', `${file} 必須是 woff2 檔（magic wOF2）`);
      assert.ok(buf.length > 5 * 1024, `${file} 過小（${buf.length} bytes）——疑似佔位空檔`);
      assert.ok(buf.length < 200 * 1024,
        `${file} 過大（${buf.length} bytes）——Latin-subset 可變 woff2 應 < 200KB`);
    }
  });

  it('LATIN_FONTS 把 4 個 key 對映到對應 family 字面（具名、引號包覆）', () => {
    for (const [key, { family }] of Object.entries(BUNDLED)) {
      assert.strictEqual(LATIN_FONTS[key], `"${family}"`,
        `LATIN_FONTS.${key} 必須是 '"${family}"'（family 名對齊 styler @font-face）`);
    }
  });

  it('styler 為每支宣告 @font-face：family / 檔名 / weight range / woff2', () => {
    for (const { file, family } of Object.values(BUNDLED)) {
      assert.ok(STYLER_SRC.includes(`'${family}'`) || STYLER_SRC.includes(`"${family}"`),
        `styler BUNDLED_LATIN_FACES 必須含 family "${family}"`);
      assert.ok(STYLER_SRC.includes(file), `styler 必須引用字型檔 ${file}`);
    }
    // weight range（非單值）——可變字型才有真實多字重；用 range 註明 fvar 軸
    assert.match(STYLER_SRC, /font-weight:\s*\$\{def\.range\}/,
      '拉丁 @font-face 必須用 weight range（${def.range}）暴露可變字型 wght 軸');
  });

  it('composeFontStack 把選定拉丁字型前接 base stack（襯線群接 serif、無襯線群接 sans）', () => {
    for (const [key, { family, group }] of Object.entries(BUNDLED)) {
      const base = group === 'serif' ? FONT_STACKS.serif : FONT_STACKS.sans;
      const settings = group === 'serif'
        ? { fontFamily: base, latinSerif: key }
        : { fontFamily: base, latinSans: key };
      assert.strictEqual(compose(settings), `"${family}", ` + base,
        `${key}（${group}）必須前接 "${family}" 到對應 base stack`);
    }
  });

  it('選襯線內嵌字型時只注入「被選到」那一支拉丁 @font-face（+ 3 Noto = 4），不含其餘', () => {
    const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['detector', 'styler'] });
    const detected = env.NS.detector.detect();
    assert.ok(detected, 'detector 必須命中主文');
    const fontFamily = compose({ fontFamily: FONT_STACKS.serif, latinSerif: 'sourceserif' });
    env.NS.styler.apply(detected.el, { ...DEFAULT_SETTINGS, fontFamily });
    const css = env.document.getElementById('__jread-style').textContent;

    const faceCount = (css.match(/@font-face/g) || []).length;
    assert.strictEqual(faceCount, 4, `應注入 4 個 @font-face（3 Noto + 1 Source Serif），實得 ${faceCount}`);
    assert.ok(css.includes('"Source Serif"'), '注入 CSS 必須宣告 "Source Serif" family');
    assert.ok(css.includes('assets/fonts/source-serif.woff2'), '必須含 source-serif.woff2 URL');
    // 不可注入其他支（lazy：只注入被選到的）
    for (const file of ALL_FILES.filter((f) => f !== 'source-serif.woff2')) {
      assert.ok(!css.includes(file), `不該注入未選的拉丁字型 ${file}`);
    }
  });

  it('選無襯線內嵌字型（Public Sans）同樣只注入該支拉丁 @font-face', () => {
    const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['detector', 'styler'] });
    const detected = env.NS.detector.detect();
    const fontFamily = compose({ fontFamily: FONT_STACKS.sans, latinSans: 'publicsans' });
    env.NS.styler.apply(detected.el, { ...DEFAULT_SETTINGS, fontFamily });
    const css = env.document.getElementById('__jread-style').textContent;
    assert.ok(css.includes('"Public Sans"'), '注入 CSS 必須宣告 "Public Sans" family');
    assert.ok(css.includes('assets/fonts/public-sans.woff2'), '必須含 public-sans.woff2 URL');
    for (const file of ALL_FILES.filter((f) => f !== 'public-sans.woff2')) {
      assert.ok(!css.includes(file), `不該注入未選的拉丁字型 ${file}`);
    }
  });

  it('latin = auto（系統字 / 預設）時不注入任何拉丁 @font-face', () => {
    const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['detector', 'styler'] });
    const detected = env.NS.detector.detect();
    // 襯線 base、latin auto：只該有 3 個 Noto face、0 個拉丁 face
    const fontFamily = compose({ fontFamily: FONT_STACKS.serif, latinSerif: 'auto' });
    env.NS.styler.apply(detected.el, { ...DEFAULT_SETTINGS, fontFamily });
    const css = env.document.getElementById('__jread-style').textContent;
    for (const file of ALL_FILES) {
      assert.ok(!css.includes(file), `latin auto 不該注入拉丁字型 ${file}`);
    }
  });

  it('popup.html 在正確 optgroup 內含 4 支內嵌字型 option（顯示名稱不帶 VF）', () => {
    const { JSDOM } = require('jsdom');
    const doc = new JSDOM(POPUP_HTML).window.document;
    const sel = doc.getElementById('latin-font-select');
    const optgroups = Array.from(sel.querySelectorAll('optgroup'));
    const serifGroup = optgroups.find((g) => g.label === '襯線');
    const sansGroup = optgroups.find((g) => g.label === '無襯線');
    assert.ok(serifGroup && sansGroup, 'latin select 必須有「襯線」「無襯線」optgroup');

    for (const [key, { family, group }] of Object.entries(BUNDLED)) {
      const g = group === 'serif' ? serifGroup : sansGroup;
      const opt = Array.from(g.querySelectorAll('option')).find((o) => o.value === key);
      assert.ok(opt, `${group} optgroup 必須含 option value="${key}"`);
      assert.strictEqual(opt.textContent.trim(), family,
        `option ${key} 顯示名稱必須是 "${family}"（不帶 VF / 字重後綴）`);
      assert.ok(!/\bVF\b/i.test(opt.textContent), `option ${key} 顯示名稱不可含 "VF"`);
    }
  });
});
