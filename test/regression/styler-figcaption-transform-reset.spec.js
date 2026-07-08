// JRead — figcaption 側欄圖說 transform 位移歸零修法（v1.6.20）
//
// Bug：twreporter.org 進 reader mode 後，圖說（figcaption）跑到圖片右側破版。
//
// 根因：原站用 transform: translateX(100%) 把 multimedia__Caption 推進圖片右側
// sidebar gutter（原站 caption 180px → translateX 180px）。reader mode 下 v1.5.15
// 規則把 figcaption position 打回 static、width 拉回版心寬（608px），但殘留的
// transform 隨 width 變成 translateX(608px)，把已在流內的圖說整條平移出圖片右緣。
// Chromium probe 實證 figcaption computed transform = matrix(1,0,0,1,608,0)。
//
// 修法：v1.5.15 的 figcaption/figcaption * 正規化規則補 transform: none !important。
// position 重置只還原 offset 定位，殘留的 translate 仍需獨立打回。
//
// 通則安全（硬規則 3）：reader scope 內被站點 transform 位移拉出正常位置的圖說
// 子樹一律 transform: none，回到圖片附近的 normal flow。純語意標籤判定、非站點特判。
//
// 註：jsdom 無 layout / transform 計算，本 spec 驗「注入 CSS 的 figcaption 正規化
// 規則區塊含 transform: none !important」這層字串訊號；真實幾何位移由
// tools/probe-twreporter.js 對真站 DOM 驗（圖說 rect 從圖右 L944 回到圖下 L336）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'twreporter-figcaption-transform.html');

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

describe('styler — figcaption 側欄圖說 transform 歸零修法（v1.6.20）', () => {
  it('figcaption / figcaption * 正規化規則必須含 transform: none !important', () => {
    const css = getInjectedCss();
    // 找同時含 position: static 與 width: auto 的 figcaption 正規化規則區塊（v1.5.15）
    const matches = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    let ruleBody = null;
    for (const m of matches) {
      const selectors = m[1];
      const body = m[2];
      if (/figcaption\s*\*/.test(selectors)
          && /position\s*:\s*static\s*!important/.test(body)
          && /width\s*:\s*auto\s*!important/.test(body)) {
        ruleBody = body;
        break;
      }
    }
    assert.ok(ruleBody, '必須找到含 figcaption *、position: static、width: auto 的正規化規則區塊');
    assert.ok(/transform\s*:\s*none\s*!important/.test(ruleBody),
      '正規化規則必須含 transform: none !important（打回 translateX 把圖說推到圖右的殘留位移）');
  });
});
