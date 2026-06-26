// JRead — 翻頁模式祖先鏈 overflow 還原 visible（v1.0.15）
//
// Bug：Readwise Reader 等「文件在內層 overflow:auto/hidden 捲動容器、非 window
// 捲動」的 SPA，在 macOS / iOS Safari 進入翻頁（分頁）模式時整頁空白；捲動模式正常。
//
// 根因：reader card 翻頁模式是 position:fixed；JRead 祖先 reset（ANCESTOR_ATTR
// 規則）收 height:auto / position:static 但**不動 overflow**。這類站祖先鏈多個
// 節點帶 overflow:hidden/auto，reader mode 下非主文兄弟 display:none、祖先 height
// 全塌成 0。WebKit 會把 position:fixed 後代裁切到「帶非 visible overflow 的祖先
// box」——祖先塌 0 高 → 裁成空 → 整頁空白（Chrome 對 viewport-fixed 後代不套此裁切，
// 故只在 Safari 炸；iOS 26.5 模擬器 standalone repro 實證 buggy 空白 / fix 正常）。
//
// 修法：翻頁模式注入 `[data-jread-ancestor="1"] { overflow: visible !important }`
// 拿掉錯誤裁切。本 spec 驗 CSS 字串結構：
//   - pagedMode:true → 出現祖先 overflow:visible 規則，且排在 html/body
//     overflow:hidden 規則之後（body 的 scroll-lock 由更高 specificity 的 html
//     前綴規則維持、不被本規則覆蓋）
//   - pagedMode:false → 不得注入（捲動模式一行不受影響）
// 不驗真實 WebKit multicol 渲染（見 docs/CHROME_EXTENSION_DEBUG.md WebKit 軌 +
// iOS 模擬器 standalone repro）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'paged-mode.html');

const BASE_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

const ANCESTOR_SEL = '[data-jread-ancestor="1"]';

function applyAndGetCss(settings) {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  env.NS.styler.apply(articleEl, settings);
  return env.document.getElementById('__jread-style').textContent;
}

// 找出含 overflow: visible 的祖先規則 block 起點（base line-629 祖先 reset 不設
// overflow，故唯一命中者就是翻頁修法注入的那條）
function findAncestorOverflowBlock(css) {
  let from = 0;
  while (true) {
    const selAt = css.indexOf(ANCESTOR_SEL + ' {', from);
    if (selAt < 0) return null;
    const block = css.slice(selAt, css.indexOf('}', selAt) + 1);
    if (/overflow:\s*visible\s*!important/.test(block)) return { selAt, block };
    from = selAt + 1;
  }
}

describe('styler — 翻頁模式祖先 overflow 還原 visible（v1.0.15）', () => {
  it('pagedMode: true → 注入祖先 overflow:visible，且排在 html/body overflow:hidden 之後', () => {
    const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });

    const hit = findAncestorOverflowBlock(css);
    assert.ok(hit, '翻頁模式必須注入 [data-jread-ancestor="1"] { overflow: visible !important }');

    // body 的 scroll-lock：html 前綴 overflow:hidden 規則必須存在且排在前面
    // （specificity 0,1,1 > 祖先規則 0,1,0，body 維持 hidden 鎖捲動）
    const bodyLock = css.indexOf('html.__jread-active body');
    const bodyLockMatch = /html\.__jread-active[^{]*body[^{]*\{[^}]*overflow:\s*hidden/.test(css);
    assert.ok(bodyLockMatch, 'body scroll-lock（html 前綴 overflow:hidden）必須存在');
    assert.ok(bodyLock >= 0 && bodyLock < hit.selAt,
      'body scroll-lock 規則必須排在祖先 overflow:visible 之前（specificity 已保證 body 維持 hidden，順序佐證）');
  });

  it('pagedMode: false → 不得注入祖先 overflow:visible（捲動模式不受影響）', () => {
    const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: false });
    const hit = findAncestorOverflowBlock(css);
    assert.strictEqual(hit, null,
      '捲動模式不可出現祖先 overflow:visible 規則（base 祖先 reset 不含 overflow）');
  });
});
