// JRead — regression spec: dark/sepia theme img 白底修法 (v0.7.154)
// -----------------------------------------------------------------------------
// Forcing function for v0.7.154 img bg fix。
// Trigger: Jimmy 2026-05-21 回報商周 /Archive/Article?StrId=7014132 dark theme
// 下 chart image 內 x 軸文字（亞馬遜 / 輝達 / Google / Meta / 蘋果）+ 「資料
// 來源：Google Finance」全部消失截圖確認。
//
// Root cause（chrome-in-chrome 連 Jimmy 登入 session probe 確認）：商周 chart
// 是 `<img class="thumb">`、bg transparent + light theme 設計（黑色文字 + 橘柱
// + 紅標題 + 白方框 callout）。light reader card 透出白底正常顯示；dark reader
// card 透出 #1a1a1a → 黑字 vs dark 對比 1:1 直接消失、整張 chart 看起來像
// 「dark 上飄浮幾個白方框」。
//
// 與 v0.7.151 iframe (chart embed) 同邏輯：dark/sepia theme 下 image bitmap
// 透明區域必須透出白色才能看清為 light theme 嵌入站設計的內容。
//
// 修法（v0.7.154）：合併到既有 iframe rule 改成 `iframe, img` 共用 selector：
//   html.__jread-active [data-jread-active="1"] iframe,
//   html.__jread-active [data-jread-active="1"] img {
//     background-color: #fff !important;
//   }
// light theme 不注入（既有 light card 已白底，重複注入無視覺效果）。
//
// jsdom 不算 layout / cascade，spec 驗 stylesheet 字串注入。
//
// 4 條 forcing function:
//   (a) dark theme 注入 img background-color: #fff rule
//   (b) sepia theme 同
//   (c) light theme 不注入（避免多餘 CSS）
//   (d) selector 用 html.__jread-active 提升 specificity（避免被站點覆蓋）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');

function setup(themeName) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected);
  const settings = {
    theme: themeName,
    fontSize: 18,
    contentWidth: 720,
    fontFamily: 'system-ui',
    lineHeight: 1.7
  };
  env.NS.styler.apply(detected.el, settings);
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl);
  return styleEl.textContent;
}

// 嚴格 regex：命中「selector list 內含 img、後接 background-color: #fff」的 rule
// 既有 v0.7.151 iframe rule 已合併到此 selector list（iframe, img 共用）；
// 規則寫法可單獨 `... img { bg }` 也可合併 `iframe, img { bg }`。本 regex 兩種
// 都吃。
const IMG_BG_RULE = /html\.__jread-active\s+\[data-jread-active="1"\]\s+img\s*\{[^}]*background-color:\s*#fff\s*!important/i;
// 合併形式：iframe, ... img { bg }
const IMG_BG_MERGED_RULE = /(html\.__jread-active\s+\[data-jread-active="1"\]\s+iframe\s*,\s*)?html\.__jread-active\s+\[data-jread-active="1"\]\s+img\s*\{[^}]*background-color:\s*#fff\s*!important/i;

describe('styler — dark/sepia theme img bg fix (v0.7.154)', () => {
  it('(a) dark theme: stylesheet 含 img background-color: #fff rule', () => {
    const css = setup('dark');
    assert.ok(IMG_BG_MERGED_RULE.test(css),
      `dark theme stylesheet 必須含「html.__jread-active [data-jread-active="1"] img { background-color: #fff !important }」rule（可獨立或與 iframe 合併），否則 chart PNG transparent bg 在 dark card 上黑字消失`);
  });

  it('(b) sepia theme: stylesheet 含 img background-color: #fff rule', () => {
    const css = setup('sepia');
    assert.ok(IMG_BG_MERGED_RULE.test(css),
      `sepia theme stylesheet 必須含 img background:#fff rule`);
  });

  it('(c) light theme: stylesheet 不注入 img background rule（避免多餘 CSS）', () => {
    const css = setup('light');
    // light theme 不該 override img bg——既有 light card 白底、img 透明背景透出
    // 已是白色，重複注入無視覺效果。
    assert.ok(!IMG_BG_RULE.test(css),
      `light theme 不該注入 img background-color: #fff rule`);
    // 同時驗合併形式 selector 也不在
    assert.ok(!/\[data-jread-active="1"\]\s+img\s*\{[^}]*background-color:\s*#fff/i.test(css),
      `light theme 任何形式的 img bg #fff rule 都不該注入`);
  });

  it('(d) dark theme: img rule selector 用 html.__jread-active 提升 specificity', () => {
    const css = setup('dark');
    // 避免站點 `img.thumb` (0,1,1) / `figure img` (0,0,2) 等 rule 勝出。
    // specificity (0,2,1) > (0,1,1)。
    assert.ok(IMG_BG_MERGED_RULE.test(css),
      `img bg rule 必須用 html.__jread-active + [data-jread-active="1"] 雙層 selector（specificity 0,2,1），避免站點 img.thumb (0,1,1) rule 勝出`);
  });
});
