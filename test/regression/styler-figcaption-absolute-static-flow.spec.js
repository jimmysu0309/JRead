// JRead — figcaption 子樹被站點定位 hack 拉出流 → 打回 static flow（v1.5.15）
//
// Bug：New Republic data-center oral history 文章進 reader mode 後，圖說文字
// 一字一行疊在主文上（Jimmy 2026-06-29 灰主題 + 版心 720 截圖回報）。
//
// 根因（Chromium 寬 viewport + 版心 720 probe 實證）：站點寬版面 scrollytelling
// 把 FIGCAPTION 內 .caption-text-wrapper 設成 position:absolute 的側欄 caption。
// JRead 把版心收成 720 但 viewport 仍寬 → 站點 media query（以 viewport 寬為準）
// 誤判寬版、caption-text-wrapper absolute 脫離 normal flow + computed width 塌成 0
// → 圖說文字一字一行疊在主文 paragraph 上。
//
// 通則修法：reader scope 內 figcaption 語意是「圖說文字塊」，本體與後代都應在
// normal flow 內排版於圖片附近——styler 注入 `figcaption, figcaption *` 強制
// position:static + 四向 auto + width:auto，把任何被定位 hack 拉出流的 caption
// 子樹打回 static、解除塌陷寬度。結構 + 語意標籤判定（figcaption 語意元素），
// 非站點 hostname/hash class 特判（硬規則 3）。
//
// 註：jsdom 不算 absolute 塌陷 / width:0 layout，本 spec 只驗 styler 注入的 CSS
// 字串含此規則（CLAUDE.md「驗哪層訊號」）；實際 caption width 0→608 撐回的視覺
// 結果由 debug-harness 寬 viewport probe 截圖驗（已實證）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'newrepublic-scrolly-caption-absolute.html');

const DEFAULT_SETTINGS = {
  theme: 'gray',
  fontSize: 17,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.5,
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

// 找出 selector 含 figcaption 子樹（figcaption *）、且 body 為 static-flow 的規則
function getFigcaptionStaticBlock(css) {
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const sel = m[1].trim();
    const body = m[2];
    if (/figcaption\s*\*/.test(sel) &&
        /position\s*:\s*static\s*!important/.test(body)) {
      return { sel, body };
    }
  }
  return null;
}

describe('styler — figcaption 子樹 static flow（v1.5.15 New Republic scrolly caption）', () => {
  it('注入的 CSS 必須含 figcaption 子樹 selector（figcaption, figcaption *）', () => {
    const css = getInjectedCss();
    assert.ok(
      new RegExp('\\[data-jread-active="1"\\]\\s*figcaption\\s*,\\s*\\[data-jread-active="1"\\]\\s*figcaption\\s*\\*').test(css),
      'CSS 必須含 [data-jread-active="1"] figcaption, [data-jread-active="1"] figcaption * selector'
    );
  });

  it('該規則 body 必須含 position:static + 四向 auto + width:auto', () => {
    const css = getInjectedCss();
    const block = getFigcaptionStaticBlock(css);
    assert.ok(block, '必須找到 figcaption 子樹 static-flow 規則');
    for (const prop of ['position\\s*:\\s*static', 'top\\s*:\\s*auto', 'left\\s*:\\s*auto',
                        'right\\s*:\\s*auto', 'bottom\\s*:\\s*auto', 'width\\s*:\\s*auto']) {
      assert.ok(new RegExp(prop + '\\s*!important').test(block.body),
        `figcaption static-flow rule body 必須含 ${prop} !important`);
    }
  });

  it('規則 scope 在 reader article（data-jread-active="1"）內、不外溢全頁', () => {
    const css = getInjectedCss();
    const block = getFigcaptionStaticBlock(css);
    assert.ok(block, '必須找到 figcaption 子樹 static-flow 規則');
    for (const line of block.sel.split(',')) {
      assert.ok(/\[data-jread-active="1"\]/.test(line),
        `figcaption static-flow selector 每條都須 scope 在 data-jread-active：${line.trim()}`);
    }
  });
});
