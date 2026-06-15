// JRead — 配圖 min-width bleed 導致爆版（v0.8.75）
//
// Bug：0xkato.xyz「how-llms-actually-work」進 reader mode 後，文章內所有配圖都沒
// 縮到版心寬、衝出卡片右緣被切斷（Jimmy 2026-06-15 回報）。
//
// 根因：原站對 img.bigger-image 設 min-width: 130%（讓配圖向版心外 bleed 成寬圖）。
// CSS 規範 min-width 勝過 max-width，故 styler 的 max-width:100% 壓不回去、圖被頂在
// 130% 寬（608→790px）衝出 720px 卡片右緣 126px 爆版。probe 實證：注入 min-width:0
// 後 8 張圖全部 790→608px、溢出歸零。
//
// 通則修法：媒體規則（img:not(a > img) / video / picture）一併清 min-width:0，
// 讓 max-width:100% 生效縮回版心寬。不綁站點 class——任何站對媒體設 min-width
// bleed 都被覆蓋（與既有 min-height:0 清掉原站 bleed 用 min 約束同款）。
//
// 註：jsdom 不計算 layout，本 spec 驗 CSS 字串注入（CLAUDE.md「驗哪層訊號」說明）；
// 790→608px 縮回的視覺結果由 harness probe 驗。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'bigger-image-min-width-bleed.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function getInjectedCss() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  env.NS.styler.apply(detected.el, DEFAULT_SETTINGS);
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl, '必須注入 __jread-style');
  return styleEl.textContent;
}

describe('styler — 媒體規則清 min-width 防 bleed 爆版（v0.8.75 0xkato bigger-image）', () => {
  it('img:not(a > img) / video / picture 媒體規則 body 必須含 min-width: 0', () => {
    const css = getInjectedCss();
    // anchor 在 img:not(a > img), video, picture 這條 list 的 rule body
    const m = css.match(/\[data-jread-active="1"\]\s*img:not\(a > img\)[^{]*\{([^}]*)\}/);
    assert.ok(m, '必須找到媒體 cap rule 區塊（img:not(a > img) / video / picture）');
    assert.ok(/min-width\s*:\s*0\s*!important/.test(m[1]),
      'rule body 必須含 min-width: 0 !important（清掉原站 min-width bleed，讓 max-width:100% 生效）');
  });

  it('同一 rule body 仍保留 max-width: 100%（min-width:0 不取代而是配合 max-width 生效）', () => {
    const css = getInjectedCss();
    const m = css.match(/\[data-jread-active="1"\]\s*img:not\(a > img\)[^{]*\{([^}]*)\}/);
    assert.ok(m, '必須找到媒體 cap rule 區塊');
    assert.ok(/max-width\s*:\s*100%\s*!important/.test(m[1]),
      'rule body 必須保留 max-width: 100% !important');
  });
});
