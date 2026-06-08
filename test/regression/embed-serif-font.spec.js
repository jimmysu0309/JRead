// JRead — 內嵌襯線 CJK 字型 forcing function（v0.7.253）
//
// Bug（Jimmy 2026-06-08 iPhone 回報）：襯線模式下「夠」「查」等常用字在 iPhone
// 顯示成黑體（缺字感），macOS Safari 正常。
//
// 根因（iOS 26.5 模擬器 Safari 實證，本輪 4 張對照截圖）：
//   1. iOS Safari「網頁路徑」的預設襯線字型本身缺「夠」「查」字形 → fall back
//      到蘋方黑體；macOS 因內建完整 Songti 故無此問題。
//   2. CSS 指定 "Songti TC" / "Songti SC" / serif 在 iOS 網頁全部 resolve 到
//      同一套有缺漏的預設 serif（Safari 不認系統字型名）——「只點名不載入」無效。
//      v0.7.221 用字型名 stack（含 Hiragino Mincho ProN）只把「整段全黑體」改善到
//      「多數字襯線、少數字仍缺」，夠/查 殘留。
//   3. iOS 內建閱讀模式正常 = Apple 原生排版器用完整系統 Songti，網頁拿不到那套。
//
// 修法：@font-face 內嵌完整 Noto Serif TC（全 TC 集 woff2），family 名 "Noto
// Serif TC" 對齊 popup 襯線 stack 第一順位——CJK 字元由 JRead 自帶的完整字型
// 渲染，不再靠 iOS 系統字型。woff2 lazy-load：未選襯線不下載。
//
// 訊號層次：本檔驗「字型檔存在 + @font-face 接線正確 + buildCss 注入 + manifest
// WAR 可載」。實際 iOS WebKit 渲染（夠/查 變襯線）靠 simulator 截圖 / Jimmy 實機。
// chrome-extension:// 字型在頁面 CSP 下能否載入 → debug-harness（Chrome 軌）驗。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const FONT_PATH = path.join(ROOT, 'assets', 'fonts', 'noto-serif-tc.woff2');
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
  fontFamily: '"Noto Serif TC", Georgia, "Times New Roman", "Songti TC", "Songti SC", "Hiragino Mincho ProN", serif'
};

describe('內嵌襯線 CJK 字型（v0.7.253 forcing function）', () => {
  it('字型檔存在、為合法 woff2、體積合理（非佔位空檔）', () => {
    assert.ok(fs.existsSync(FONT_PATH), 'jread/assets/fonts/noto-serif-tc.woff2 必須存在');
    const buf = fs.readFileSync(FONT_PATH);
    // woff2 magic = 'wOF2'
    assert.strictEqual(buf.slice(0, 4).toString('ascii'), 'wOF2', '必須是 woff2 檔（magic wOF2）');
    assert.ok(buf.length > 500 * 1024,
      `字型檔過小（${buf.length} bytes）——疑似佔位空檔，全 TC 集 woff2 應 > 500KB`);
    assert.ok(buf.length < 4 * 1024 * 1024,
      `字型檔過大（${buf.length} bytes）——超出全 TC 集合理範圍，疑似誤打包完整 CJK`);
  });

  it('styler.js 定義 @font-face：family / weight 範圍 / woff2 src 接線正確', () => {
    assert.match(STYLER_SRC, /font-family:\s*"Noto Serif TC"/,
      '@font-face family 必須是 "Noto Serif TC"（對齊 popup 襯線 stack 第一順位，免遷移生效）');
    assert.match(STYLER_SRC, /font-weight:\s*100 900/,
      'font-weight 必須 100 900——單一 Regular face 涵蓋全 weight，heading bold faux-bold 仍用本字型不 fall back 回缺字系統 serif');
    assert.match(STYLER_SRC, /getURL\(['"]assets\/fonts\/noto-serif-tc\.woff2['"]\)/,
      'src 必須用 chrome.runtime.getURL 指向打包的 woff2');
    assert.match(STYLER_SRC, /format\("woff2"\)/, 'src 必須宣告 format("woff2")');
    assert.match(STYLER_SRC, /overrides\.fontFamily \? FONT_FACE_CSS : ''/,
      '@font-face 必須 gate 在 overrides.fontFamily（與 font-family override 同觸發條件、lazy-load、不污染預設 CSS）');
  });

  it('選襯線（自訂字型）時注入的 CSS 含 @font-face + 字型 URL（runtime）', () => {
    const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['detector', 'styler'] });
    const detected = env.NS.detector.detect();
    assert.ok(detected, 'detector 必須命中主文');
    env.NS.styler.apply(detected.el, SERIF_SETTINGS);
    const css = env.document.getElementById('__jread-style').textContent;
    assert.ok(css.includes('@font-face'), '注入 CSS 必須含 @font-face');
    assert.ok(css.includes('"Noto Serif TC"'), '注入 CSS 必須宣告 "Noto Serif TC" family');
    assert.ok(css.includes('assets/fonts/noto-serif-tc.woff2'), '注入 CSS 必須含字型 URL');
    assert.ok(css.includes('format("woff2")'), '注入 CSS 必須宣告 woff2 format');
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
      p === 'assets/*' || p === 'assets/**' || p === 'assets/fonts/*' ||
      p === 'assets/fonts/noto-serif-tc.woff2' || p === '*');
    assert.ok(covers,
      `web_accessible_resources 未涵蓋字型路徑（現有 patterns: ${JSON.stringify(patterns)}）——chrome-extension:// 字型會被擋、@font-face 載不到`);
  });
});
