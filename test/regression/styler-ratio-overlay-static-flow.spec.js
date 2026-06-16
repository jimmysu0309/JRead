// JRead — ratio / object-fit 容器後代拉回 static flow（v0.8.94）
//
// Bug：New Yorker（Condé Nast）文章進 reader mode 後 hero 主圖整張消失
// （Jimmy 2026-06-16 截圖回報，只剩標題 + 圖說 orphan）。
//
// 根因（probe 實證）：hero 結構 DIV.AspectRatioContainer（CSS aspect-ratio 撐高、
// class 含 "ratio"）> SPAN > DIV.aspect-ratio--overlay-container（position:absolute
// inset:0 + overflow:hidden）> picture > img。styler 既有規則把 [class*="ratio"] 的
// aspect-ratio reset 成 auto + height:auto → AspectRatioContainer 失去高度來源；但
// overlay 仍是 absolute（class 含 "ratio" 不是 "placeholder"，而 static-flow 配套
// 規則原本只綁 placeholder）→ overlay 不佔 flow 高度 → 容器塌成 0 → overlay inset:0
// 隨之 0 高 + overflow:hidden 把 166px picture 整個裁掉 → hero 整張不見。
//
// 通則修法：把 static-flow 配套規則的容器集合對齊上方 aspect-ratio/height reset
// （placeholder + ratio + object-fit），讓 ratio 容器內的 absolute overlay 也被拉回
// normal flow，容器自然撐到 picture 實際高度。結構訊號（class 含 "ratio"/"object-fit"
// = aspect-ratio 媒體 wrapper 慣例命名），非站點 hostname/hash class 特判。
//
// 註：jsdom 不算 aspect-ratio / 高度塌陷 layout，本 spec 只驗 styler CSS 字串注入
// （CLAUDE.md「驗哪層訊號」說明）；實際 hero 0→217px 撐高的視覺結果由
// tools/probe-newyorker.js + debug-harness 截圖驗（已實證）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'conde-aspect-ratio-overlay-hero.html');

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

// 抓「position:static + 四向 auto」這條 descendant static-flow rule 的 selector 群
// （以 rule body 特徵定位，避開其他 position:static 規則如 carousel slide）。
function getStaticFlowSelectors(css) {
  // 找出所有 rule 區塊，挑 body 同時含 position:static 與 bottom:auto 的（本規則特徵）
  const blocks = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const sel = m[1].trim();
    const body = m[2];
    if (/position\s*:\s*static\s*!important/.test(body) &&
        /bottom\s*:\s*auto\s*!important/.test(body) &&
        /top\s*:\s*auto\s*!important/.test(body)) {
      blocks.push({ sel, body });
    }
  }
  return blocks;
}

describe('styler — ratio / object-fit 容器後代 static flow（v0.8.94 New Yorker hero）', () => {
  it('static-flow 規則必須覆蓋 [class*="ratio"] 後代（核心修法）', () => {
    const css = getInjectedCss();
    assert.ok(
      /\[class\*="ratio" i\]:not\(\[data-jread-player="1"\]\)\s*\*/.test(css),
      'CSS 必須含 [class*="ratio" i]:not([data-jread-player="1"]) * selector（ratio 容器內 absolute overlay 拉回 static flow）'
    );
  });

  it('static-flow 規則必須覆蓋 [class*="object-fit"] 後代', () => {
    const css = getInjectedCss();
    assert.ok(
      /\[class\*="object-fit" i\]:not\(\[data-jread-player="1"\]\)\s*\*/.test(css),
      'CSS 必須含 [class*="object-fit" i]:not([data-jread-player="1"]) * selector'
    );
  });

  it('既有 [class*="placeholder"] 後代 static-flow 不退步', () => {
    const css = getInjectedCss();
    assert.ok(
      /\[class\*="placeholder" i\]:not\(\[data-jread-player="1"\]\)\s*\*/.test(css),
      'CSS 必須仍含 placeholder 後代 static-flow selector（v0.7.x 行為延續）'
    );
  });

  it('該 static-flow rule body 必須含 position:static + top/left/right/bottom:auto', () => {
    const css = getInjectedCss();
    const blocks = getStaticFlowSelectors(css);
    // 找到「selector 同時含 ratio + placeholder + object-fit」的那一條（本修法合併後的群）
    const target = blocks.find(b =>
      /\[class\*="ratio" i\]/.test(b.sel) &&
      /\[class\*="placeholder" i\]/.test(b.sel) &&
      /\[class\*="object-fit" i\]/.test(b.sel));
    assert.ok(target, '必須找到含 placeholder + ratio + object-fit 三者的 static-flow selector 群');
    const body = target.body;
    for (const prop of ['position\\s*:\\s*static', 'top\\s*:\\s*auto', 'left\\s*:\\s*auto', 'right\\s*:\\s*auto', 'bottom\\s*:\\s*auto']) {
      assert.ok(new RegExp(prop + '\\s*!important').test(body),
        `static-flow rule body 必須含 ${prop} !important`);
    }
  });

  it('static-flow 規則三條 selector 都帶 :not([data-jread-player="1"]) 排除（不誤拉播放器）', () => {
    const css = getInjectedCss();
    const blocks = getStaticFlowSelectors(css);
    const target = blocks.find(b =>
      /\[class\*="ratio" i\]/.test(b.sel) && /\[class\*="placeholder" i\]/.test(b.sel));
    assert.ok(target, '必須找到合併後 static-flow selector 群');
    const lines = target.sel.split(',').filter(s => /\[class\*=/.test(s));
    assert.ok(lines.length >= 3, `應有 3 條 class wrapper selector（實際 ${lines.length}）`);
    for (const line of lines) {
      assert.ok(/:not\(\[data-jread-player="1"\]\)/.test(line),
        `static-flow selector 必須排除 player 容器：${line.trim()}`);
    }
  });
});
