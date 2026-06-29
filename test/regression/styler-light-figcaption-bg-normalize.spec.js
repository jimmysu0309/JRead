// JRead — light theme figcaption 背景正規化（v0.8.169 TWZ 圖說黑條修法）
//
// Bug（Page Rounds 2026-06-23 twz.com）：
//   hero 圖下 figcaption / credit 在亮色 reader card 變成一條黑條、credit 文字
//   完全看不見。contrast audit 命中 19 個 figcaption/credit 元素 ratio 1.01:1。
//
// 根因（兩條 styler 決策在 light theme 互相矛盾）：
//   - v0.7.195 bg-preserve：BG_PRESERVE_NOT 排除 figcaption → 保留站點 figcaption
//     背景（原意：站點「淺字 + 深底」成對圖說保留後仍可讀）
//   - v0.8.123：light theme 強制 figcaption 文字為卡片色深灰 #333（白底可讀）
//   兩者矛盾：站點若給 figcaption 設深底（twz .article-featured-image-caption
//   深底 #2a3439），保留深底 + 強制 #333 深字 = 深字 on 深底（1.01:1）黑條。
//
// 修法（結構性通則，非站點特判）：既然 light theme 已決定 figcaption 用卡片色
//   文字（#333），背景就必須跟著卡片走——同一條 light theme rule 一併把
//   figcaption（含 figcaption *）background-color 強制 transparent，讓 #333 字落
//   在白卡上（twz 修後 12.63:1）。gated 在 !theme.text，dark / sepia 不受影響
//   （那邊 figcaption bg 由 html.__jread-active 中和規則 + theme.text 接管，見
//   styler-dark-contrast-pairs.spec.js）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'dark-contrast-pairs.html');

function lightCss() {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['detector', 'styler'] });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須選到 article');
  env.NS.styler.apply(detected.el, {
    theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7
  });
  return env.document.getElementById('__jread-style').textContent;
}

describe('styler — light theme figcaption 背景正規化（v0.8.169 TWZ）', () => {
  // v1.5.15：figcaption + figcaption * 這個 selector 現在有兩條規則——本條 light
  // theme 色彩正規化（color #333 + bg transparent），以及 styler-figcaption-
  // absolute-static-flow 的版面 static-flow（position:static + width:auto，全主題）。
  // 兩者 selector 相同，因此不能只用 selector 抓「第一條」（會抓到 static-flow 那
  // 條）——改用 rule body 特徵（含 #333333）定位本條色彩規則。
  function lightFigcaptionColorBody(css) {
    const re = /\[data-jread-active="1"\] figcaption,\s*\[data-jread-active="1"\] figcaption \*\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css)) !== null) {
      if (/#333333/.test(m[1])) return m[1];
    }
    return null;
  }

  it('light theme：figcaption rule 同時強制 #333 字色 + 透明背景（成對正規化）', () => {
    const css = lightCss();
    const body = lightFigcaptionColorBody(css);
    assert.ok(body, 'light stylesheet 必須有含 #333 的 figcaption + figcaption * 色彩規則');
    assert.match(body, /color:\s*#333333\s*!important/i,
      'light figcaption 文字色強制 #333（v0.8.123）');
    assert.match(body, /background-color:\s*transparent\s*!important/i,
      'light figcaption 背景強制 transparent（v0.8.169，配 #333 字色避免站點深底黑條）');
  });

  it('color 與 background 必須在同一條 rule（成對，不可只改其一）', () => {
    // 防 drift：若哪天有人把 background-color 從這條 rule 拿掉、只留 color #333，
    // twz 黑條會復發（深字 on 深底）。兩者綁同一 rule body。
    const css = lightCss();
    const body = lightFigcaptionColorBody(css);
    assert.ok(body && /#333333/.test(body) && /transparent/.test(body),
      'figcaption 的 #333 字色與透明背景必須成對出現在同一條 light rule');
  });
});
