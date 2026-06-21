// JRead — 內嵌襯線 CJK 字型 forcing function（v0.7.253 內嵌 / v0.7.257 三字重）
//
// Bug 一（Jimmy 2026-06-08 iPhone 回報，v0.7.253 修）：襯線模式下「夠」「查」等
// 常用字在 iPhone 顯示成黑體（缺字感），macOS Safari 正常。
//
// 根因（iOS 26.5 模擬器 Safari 實證）：
//   1. iOS Safari「網頁路徑」的預設襯線字型本身缺「夠」「查」字形 → fall back
//      到蘋方黑體；macOS 因內建完整 Songti 故無此問題。
//   2. CSS 指定 "Songti TC" / "Songti SC" / serif 在 iOS 網頁全部 resolve 到
//      同一套有缺漏的預設 serif（Safari 不認系統字型名）——「只點名不載入」無效。
//   3. iOS 內建閱讀模式正常 = Apple 原生排版器用完整系統 Songti，網頁拿不到那套。
// 修法：@font-face 內嵌完整 Noto Serif TC（全 TC 集 woff2），family 名 "Noto
// Serif TC" 對齊 popup 襯線 stack 中的 CJK family 名——CJK 字元由 JRead 自帶完整
// 字型渲染（v0.8.25 起西文襯線 Georgia/Times 排在前面，英文不吃此字型）。
//
// Bug 二（Jimmy 2026-06-08 回報，v0.7.257 修）：襯線模式下字重三段（細/中/粗）
// 渲染完全相同、字重選擇沒效果（無襯線正常）。
// 根因：v0.7.253 只內嵌單一 Regular 靜態字面 + `@font-face { font-weight: 100 900 }`，
// 等於告訴瀏覽器「這一個字面涵蓋整段 weight」→ 細(300)/中(400)/粗(600) 全對映到
// 同一字面、且關閉 faux-bold 合成。字重無法無中生有（瀏覽器只能合成較粗不能變細）。
// 修法：三個真實字重各一個靜態字面（Light 300 / Regular 400 / SemiBold 600，由
// Noto Serif TC 可變字型 pin 出、同一份 6606 字覆蓋），同 family 名各自單值 weight。
//
// 訊號層次：本檔驗「三個字型檔存在 + 三個 @font-face 接線正確 + buildCss 注入
// font-weight + manifest WAR 可載」。實際 iOS WebKit 渲染（夠/查 變襯線、三字重視覺
// 差異）靠 simulator 截圖 / Jimmy 實機。chrome-extension:// 字型在頁面 CSP 下能否載入
// → debug-harness（Chrome 軌）驗。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const FONT_DIR = path.join(ROOT, 'assets', 'fonts');
const FONT_FILES = {
  300: 'noto-serif-tc-light.woff2',
  400: 'noto-serif-tc-regular.woff2',
  600: 'noto-serif-tc-semibold.woff2',
};
const STYLER_SRC = fs.readFileSync(path.join(ROOT, 'content', 'styler.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');

const DEFAULT_SETTINGS = {
  theme: 'light', fontSize: 18, contentWidth: 720,
  fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0
};
// 襯線 stack（popup 襯線 option 值）——overrides.fontFamily 為 true 時才注入 @font-face
const SERIF_SETTINGS = {
  ...DEFAULT_SETTINGS,
  fontFamily: 'Georgia, "Times New Roman", "Noto Serif TC", "Songti TC", "Songti SC", "Hiragino Mincho ProN", serif'
};

describe('內嵌襯線 CJK 字型（v0.7.253 內嵌 / v0.7.257 三字重 forcing function）', () => {
  it('三個字重檔（Light/Regular/SemiBold）都存在、為合法 woff2、體積合理', () => {
    for (const [weight, file] of Object.entries(FONT_FILES)) {
      const p = path.join(FONT_DIR, file);
      assert.ok(fs.existsSync(p), `jread/assets/fonts/${file} 必須存在（字重 ${weight}）`);
      const buf = fs.readFileSync(p);
      assert.strictEqual(buf.slice(0, 4).toString('ascii'), 'wOF2', `${file} 必須是 woff2 檔（magic wOF2）`);
      assert.ok(buf.length > 500 * 1024,
        `${file} 過小（${buf.length} bytes）——疑似佔位空檔，全 TC 集 woff2 應 > 500KB`);
      assert.ok(buf.length < 2 * 1024 * 1024,
        `${file} 過大（${buf.length} bytes）——單字重全 TC 集應 < 2MB`);
    }
  });

  it('styler.js 定義三個 @font-face：family 一致、weight 300/400/600 各單值、三個 woff2 src', () => {
    assert.match(STYLER_SRC, /font-family:\s*"Noto Serif TC"/,
      '@font-face family 必須是 "Noto Serif TC"（對齊 popup 襯線 stack 中的 CJK family 名，CJK 字元由內嵌字型渲染）');
    // 三個字重檔名都必須出現在 styler（接線正確）
    for (const file of Object.values(FONT_FILES)) {
      assert.ok(STYLER_SRC.includes(file), `styler 必須引用字型檔 ${file}`);
    }
    // 三個單值 weight（取代舊版 100 900——後者讓三段渲染相同，是 Bug 二根因）
    assert.match(STYLER_SRC, /weight:\s*300/, 'Light 字面 weight 必須 300');
    assert.match(STYLER_SRC, /weight:\s*400/, 'Regular 字面 weight 必須 400');
    assert.match(STYLER_SRC, /weight:\s*600/, 'SemiBold 字面 weight 必須 600');
    assert.ok(!/font-weight:\s*100 900/.test(STYLER_SRC),
      '禁止 font-weight: 100 900——單一字面涵蓋整段 weight 會讓襯線字重三段渲染相同（Bug 二）');
    assert.match(STYLER_SRC, /format\("woff2"\)/, 'src 必須宣告 format("woff2")');
    assert.match(STYLER_SRC, /overrides\.fontFamily \? FONT_FACE_CSS/,
      '@font-face 必須 gate 在 overrides.fontFamily（與 font-family override 同觸發條件、lazy-load、不污染預設 CSS）');
  });

  it('選襯線（自訂字型）時注入的 CSS 含三個 @font-face + 三個字型 URL（runtime）', () => {
    const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['detector', 'styler'] });
    const detected = env.NS.detector.detect();
    assert.ok(detected, 'detector 必須命中主文');
    env.NS.styler.apply(detected.el, SERIF_SETTINGS);
    const css = env.document.getElementById('__jread-style').textContent;
    const faceCount = (css.match(/@font-face/g) || []).length;
    assert.strictEqual(faceCount, 3, `注入 CSS 必須含 3 個 @font-face（實得 ${faceCount}）`);
    assert.ok(css.includes('"Noto Serif TC"'), '注入 CSS 必須宣告 "Noto Serif TC" family');
    for (const file of Object.values(FONT_FILES)) {
      assert.ok(css.includes('assets/fonts/' + file), `注入 CSS 必須含字型 URL ${file}`);
    }
    assert.ok(css.includes('format("woff2")'), '注入 CSS 必須宣告 woff2 format');
  });

  it('字重設定真的注入到內文 font-weight（細 300 / 中 400 / 粗 600 各不同）', () => {
    const weights = [300, 400, 600];
    const rendered = weights.map((w) => {
      const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['detector', 'styler'] });
      const detected = env.NS.detector.detect();
      env.NS.styler.apply(detected.el, { ...SERIF_SETTINGS, fontWeight: w });
      const css = env.document.getElementById('__jread-style').textContent;
      return css.includes(`font-weight: ${w} !important`);
    });
    rendered.forEach((ok, i) =>
      assert.ok(ok, `字重 ${weights[i]} 必須注入 font-weight: ${weights[i]} !important 到內文`));
  });

  it('預設（system-ui）時不注入 @font-face——與 font-family override 觸發條件一致、不污染預設 CSS', () => {
    const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['detector', 'styler'] });
    const detected = env.NS.detector.detect();
    env.NS.styler.apply(detected.el, DEFAULT_SETTINGS);
    const css = env.document.getElementById('__jread-style').textContent;
    assert.ok(!css.includes('@font-face'),
      '預設 fontFamily 時不得注入 @font-face（lazy-load 對齊 override，避免污染 styler.spec 的「預設不含 font-family」斷言）');
  });

  it('manifest web_accessible_resources 必須能載入字型路徑', () => {
    const war = MANIFEST.web_accessible_resources || [];
    const patterns = war.flatMap((e) => e.resources || []);
    const covers = patterns.some((p) =>
      p === 'assets/*' || p === 'assets/**' || p === 'assets/fonts/*' || p === '*');
    assert.ok(covers,
      `web_accessible_resources 未涵蓋字型路徑（現有 patterns: ${JSON.stringify(patterns)}）——chrome-extension:// 字型會被擋、@font-face 載不到`);
  });
});
