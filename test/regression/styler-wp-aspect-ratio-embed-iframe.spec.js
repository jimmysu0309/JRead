// JRead — WP aspect-ratio class 包 responsive iframe 進閱讀模式被壓扁（v0.8.155）
//
// Bug：militaryrealism.blog/2026/04/16/how-to-drive-a-tank/ 的 YouTube 嵌入進
// 閱讀模式後 16:9 影片被壓扁成 608×150。
//
// 根因：WordPress 影片嵌入的 figure class 含 wp-has-aspect-ratio（含 "ratio"
// 子字串）→ 命中 styler 的 [class*="ratio" i] reset。其「後代拉回 static」配套
// 規則 [class*="ratio"] * 把 wrapper（position:relative→static）+ iframe
// （position:absolute→static）一起打回 static：
//   1. iframe 失去 absolute → 高度掉回 HTML 預設 150px（reader iframe 規則只
//      cap 寬不動高）
//   2. wrapper 的 ::before padding-top 16:9 aspect box 仍在 → 上方一塊空白
//   3. FILL_IFRAME 偵測量 computed position 時看到 static → 不標記 → 修不到
//
// 修法（結構性，硬規則 3）：三條後代 static-reset 選擇器各補
// :not(:has(iframe))——aspect 容器內含 iframe 即 responsive 影片嵌入，排除其
// 子樹不被打回 static，讓 wrapper 維持 relative、iframe 維持 absolute，由下方
// FILL_IFRAME 機制接手 pin 回填滿 aspect box。圖片塌陷容器（無 iframe）不受
// 影響、仍走 :has(>img) static 配套兜底。
//
// 註：jsdom 不 cascade stylesheet 的 position（後代 static-reset 是注入 CSS、
// 不影響 jsdom getComputedStyle），故本 fix 的真正 forcing function 是「注入
// CSS 的三條 reset 選擇器必須帶 :not(:has(iframe)) 守衛」。實際 16:9 填滿視覺
// 由 live probe 在真實 Chrome 驗證（修法當輪已確認 iframe absolute 回填、
// height 342px = 608 寬的 16:9）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'wp-aspect-ratio-embed-iframe.html');
const FILL_ATTR = 'data-jread-fill-iframe';

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler'],
    viewport: { width: 1280, height: 900 },
    pretendToBeVisual: true
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  const snapshot = env.NS.styler.apply(detected.el, DEFAULT_SETTINGS);
  return { env, detected, snapshot };
}

describe('styler — WP aspect-ratio class 包 responsive iframe 填滿（v0.8.155 militaryrealism）', () => {
  it('三條後代 static-reset 選擇器（placeholder / ratio / object-fit）都帶 :not(:has(iframe)) 守衛', () => {
    const { env } = setup();
    const css = env.document.getElementById('__jread-style').textContent;
    // 抓住「static !important + 四向 auto」那條 reset 的選擇器群（在 { 之前）
    const block = css.match(/([^{}]*\[class\*="ratio" i\][^{}]*)\{\s*position:\s*static\s*!important;\s*top:\s*auto/);
    assert.ok(block, '必須找到後代 static-reset 規則（ratio/placeholder/object-fit）');
    const selectors = block[1];
    // 三個 aspect 容器選擇器各自都要有 :has(iframe) 排除——少一個就有對應雜訊
    // 模式的影片嵌入會被打回 static 壓扁
    assert.ok(/\[class\*="placeholder" i\][^,]*:not\(:has\(iframe\)\)/.test(selectors),
      'placeholder 容器 reset 須帶 :not(:has(iframe))');
    assert.ok(/\[class\*="ratio" i\][^,]*:not\(:has\(iframe\)\)/.test(selectors),
      'ratio 容器 reset 須帶 :not(:has(iframe))');
    assert.ok(/\[class\*="object-fit" i\][^,]*:not\(:has\(iframe\)\)/.test(selectors),
      'object-fit 容器 reset 須帶 :not(:has(iframe))');
  });

  it('aspect-ratio 容器內的 abs-pos iframe 仍被標 data-jread-fill-iframe（FILL_IFRAME 接手）', () => {
    const { env } = setup();
    const yt = env.document.getElementById('wp-yt-iframe');
    assert.strictEqual(yt.getAttribute(FILL_ATTR), '1',
      'ratio 容器內的 abs-pos iframe 必須被標 fill，由 FILL_IFRAME 規則 pin 回填滿');
  });

  it('FILL_IFRAME pin 規則仍注入（iframe[fill] → absolute + inset:0 + 100%）', () => {
    const { env } = setup();
    const css = env.document.getElementById('__jread-style').textContent;
    const m = css.match(/iframe\[data-jread-fill-iframe\]\[data-jread-fill-iframe\]\s*\{([^}]*)\}/);
    assert.ok(m, '必須注入 iframe[data-jread-fill-iframe] 規則');
    const body = m[1];
    assert.ok(/position\s*:\s*absolute\s*!important/.test(body), '須含 position: absolute !important');
    assert.ok(/width\s*:\s*100%\s*!important/.test(body), '須含 width: 100% !important');
    assert.ok(/height\s*:\s*100%\s*!important/.test(body), '須含 height: 100% !important');
  });

  it('restore 移除 fill 標記', () => {
    const { env, detected, snapshot } = setup();
    env.NS.styler.restore(detected.el, snapshot);
    const yt = env.document.getElementById('wp-yt-iframe');
    assert.ok(!yt.hasAttribute(FILL_ATTR), 'restore 後 iframe fill 標記必須移除');
  });
});
