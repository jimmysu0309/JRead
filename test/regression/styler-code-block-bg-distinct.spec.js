// JRead — code block 背景辨識度（v1.5.17）
//
// Bug（Jimmy 2026-06-29 medium.com/ddsakura-blog 截圖回報）：sepia（米）/ gray（灰）
// 主題下 code block 背景難以辨識。真兇：原站把 `<pre>` 做成「透明底 + 細淺色邊框」
// （cage 實測 bg rgba(0,0,0,0)、border 1px #e5e5e5）。reader card 在 sepia
// (#eee2cb) / gray(#ededed) 上淺邊框 ≈ 卡片色幾乎不可見、透明底又透出卡片色 →
// code block 與主文完全融在一起、看不出邊界。
//
// 修法（styler apply phase 4，所有主題）：只對「自身 background-color alpha < 0.1
// （透明 / 近透明）」的 pre 補主題協調底色 theme.codeBlockBg（半透明 recessed
// panel）。gate 在 alpha：語法高亮塊（自身實心底，alpha=1）一律跳過、原樣保留，
// 零誤傷其 token 對比。
//
// jsdom getComputedStyle 支援 backgroundColor（透明回 rgba(0,0,0,0)、實心回
// rgb(...)），可直接驗 phase 4 的 gate 分流與 inline 覆寫。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE = path.join(__dirname, 'fixtures', 'code-block-bg.html');

// 從 source 抽出各 theme 的 codeBlockBg（單一資料源，避免 spec 自寫一份 drift）
const SRC = require('fs').readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'styler.js'), 'utf8');
function codeBlockBgOf(themeName) {
  const block = SRC.match(new RegExp(`${themeName}:\\s*\\{[^}]*\\}`));
  assert.ok(block, `styler.js THEMES 必須有 ${themeName}`);
  const m = block[0].match(/codeBlockBg:\s*'([^']+)'/);
  assert.ok(m, `${themeName} 必須定義 codeBlockBg`);
  return m[1];
}

function setup(themeName) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE,
    scripts: ['detector', 'styler'],
    pretendToBeVisual: true
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected);
  env.NS.styler.apply(detected.el, {
    theme: themeName, fontSize: 18, contentWidth: 720,
    fontFamily: 'system-ui', lineHeight: 1.7
  });
  return env.document;
}

describe('styler — code block 背景辨識度（v1.5.17）', () => {
  it('THEMES 四主題全定義 codeBlockBg', () => {
    for (const t of ['light', 'dark', 'sepia', 'gray']) {
      const v = codeBlockBgOf(t);
      assert.ok(v && v.length > 0, `${t}.codeBlockBg 不可為空`);
    }
  });

  for (const theme of ['light', 'sepia', 'gray', 'dark']) {
    it(`${theme}：透明底 pre 補上 theme.codeBlockBg（inline !important）`, () => {
      const doc = setup(theme);
      const pre = doc.getElementById('plain-pre');
      const nospace = s => (s || '').replace(/\s/g, '');
      const bg = pre.style.getPropertyValue('background-color');
      assert.strictEqual(nospace(bg), nospace(codeBlockBgOf(theme)),
        `${theme} 透明底 pre 應補主題 codeBlockBg，實得「${bg}」`);
      assert.strictEqual(pre.style.getPropertyPriority('background-color'), 'important',
        'codeBlockBg 必須 !important（勝過 v0.7.164 dark/sepia transparent rule + 原站 bg）');
    });
  }

  it('負控制：自身實心底的語法高亮 pre 不被覆寫（保留 token 設計）', () => {
    const doc = setup('gray');
    const pre = doc.getElementById('syntax-pre');
    const bg = (pre.style.getPropertyValue('background-color') || '').replace(/\s/g, '');
    // 仍是原站深底（#2d2d2d / rgb(45,45,45)），不是淺色 codeBlockBg
    assert.ok(/2d2d2d|rgb\(45,45,45\)/i.test(bg),
      `語法高亮 pre 自身實心底（alpha=1）應跳過、保留原 bg，實得「${bg}」`);
  });
});
