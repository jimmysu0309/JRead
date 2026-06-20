// JRead — styler de-column 互補 case：固定 px grid/flex track 不隨 card 縮窄，
// 內文被撐寬往右溢出 → 塌成單欄（v0.8.136）
//
// Bug：nytimes.com/wirecutter/reviews/snoo-smart-sleeper-what-to-know 進 reader
// mode 後「圖文都偏右」、右側被切。根因 = article 內 display:grid 容器（寬度已
// 正確縮到 card content box 608px）的 grid 子項用站點寫死的固定 1024px content
// track → 內含 h1/p/figure 全部 1024 寬、左緣右移 64px、右緣衝出 card content
// box 被 overflow-x:hidden 切掉。
//
// 既有 decolumnFrom（v0.8.66/68）的 ratio 閘只認「anchor 被擠得比容器窄
// （< 70%/90%）」，認不出「anchor 反而比 card 還寬、右移溢出」——decolumnFrom
// 走到此 grid 時 anchor 寬 1024 > 容器 608、不滿足 narrower 閘漏網。
// overflow pass 補上：以「grid/flex 容器的直接子渲染右緣溢出 card 右緣」為結構
// 訊號，把固定 track / 並列容器塌成 display:block 讓子項退回 block flow。
//
// 訊號層次（CLAUDE.md 工作流原則 3）：本 spec 驗「styler 的 overflow de-column
// 決策邏輯（溢出右緣判定 + grid/flex 判定 + player / 非 grid/flex 防誤殺）」。
// stubRect 模擬 jsdom 沒有的 layout（getBoundingClientRect 全回 0）。不驗真實
// Chromium 的 grid track 解析寬度（那層走 tools/probe-nyt.js + debug-harness 截圖）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'nyt-grid-track-overflow.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

// card 右緣 = 720（article rect right）。grid 子項右緣 1088（> 722）→ 溢出命中。
function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler'],
    viewport: { width: 1000, height: 800 },
    pretendToBeVisual: true
  });
  const { document } = env;
  const $ = (id) => document.getElementById(id);

  // card（article）右緣 720
  stubRect($('art'), { left: 0, top: 0, width: 720, height: 4000 });

  // 正例：grid 容器 fits（right 720），但 wide 子項 left 64 width 1024 → right 1088 溢出
  stubRect($('gridfit'), { left: 0, top: 100, width: 720, height: 600 });
  stubRect($('wideitem'), { left: 64, top: 100, width: 1024, height: 600 });
  stubRect($('title'), { left: 64, top: 100, width: 1024, height: 80 });
  stubRect($('hero'), { left: 64, top: 200, width: 1024, height: 400 });

  // 反例 A：grid 容器子項都 fits（right 700 <= 720）→ 不溢出
  stubRect($('gridok'), { left: 0, top: 800, width: 720, height: 200 });
  stubRect($('okitem'), { left: 0, top: 800, width: 700, height: 200 });

  // 反例 B：player grid 子項溢出（right 1024）→ player 排除
  stubRect($('playergrid'), { left: 0, top: 1100, width: 720, height: 200 });
  stubRect($('playeritem'), { left: 0, top: 1100, width: 1024, height: 200 });

  // 反例 C：block 容器子項溢出（right 1024）→ 非 grid/flex 不動
  stubRect($('blockover'), { left: 0, top: 1400, width: 720, height: 200 });
  stubRect($('blockitem'), { left: 0, top: 1400, width: 1024, height: 200 });

  // 反例 D：flex-column 子項溢出（right 1024）→ 非橫向分欄不動
  stubRect($('colover'), { left: 0, top: 1700, width: 720, height: 200 });
  stubRect($('colitem'), { left: 0, top: 1700, width: 1024, height: 200 });

  // 反例 E：單欄 grid 子項溢出（right 1024）→ 非多欄不動
  stubRect($('singlegrid'), { left: 0, top: 2000, width: 720, height: 200 });
  stubRect($('sgitem'), { left: 0, top: 2000, width: 1024, height: 200 });

  const art = $('art');
  const snapshot = env.NS.styler.apply(art, DEFAULT_SETTINGS);
  return { env, document, $, art, snapshot };
}

describe('styler — 固定 px grid track 溢出右緣塌成單欄（v0.8.136）', () => {
  let document, $, env, art, snapshot;

  before(() => {
    const r = setup();
    document = r.document; $ = r.$; env = r.env; art = r.art; snapshot = r.snapshot;
  });

  it('grid 子項用固定 px track 撐寬溢出 card 右緣 → 容器塌成 display:block（核心驗證點）', () => {
    assert.strictEqual($('gridfit').style.display, 'block',
      '固定 track 撐寬溢出的 grid 容器應塌成 block，否則內文偏右、右側被 card overflow-x:hidden 切掉');
  });

  it('防誤殺 A：grid 子項都在 card 內（不溢出）不可塌', () => {
    assert.notStrictEqual($('gridok').style.display, 'block',
      '子項已在 card 內、無溢出，不該被 overflow pass 命中');
  });

  it('防誤殺 B：player 結構即使子項溢出也不可塌', () => {
    assert.notStrictEqual($('playergrid').style.display, 'block',
      'player layout 由 player JS 管理，溢出也不該動');
  });

  it('防誤殺 C：block 容器（非 grid/flex）子項溢出也不可塌', () => {
    assert.notStrictEqual($('blockover').style.display, 'block',
      'overflow pass 只塌 grid/flex 並列容器，block 容器不該被動');
  });

  it('防誤殺 D：flex-column 子項溢出也不可塌（同 decolumnFrom 守則）', () => {
    assert.notStrictEqual($('colover').style.display, 'block',
      'flex-column 本來就垂直堆疊、非橫向分欄，不該因子項溢出被塌');
  });

  it('防誤殺 E：單欄 grid 子項溢出也不可塌（同 decolumnFrom isGridMulti 守則）', () => {
    assert.notStrictEqual($('singlegrid').style.display, 'block',
      '單欄 grid 沒分欄，不該因子項溢出被塌');
  });

  it('restore 後塌欄容器的 inline display 還原（無殘留）', () => {
    env.NS.styler.restore(art, snapshot);
    assert.strictEqual($('gridfit').style.display, 'grid',
      'restore 後 grid 容器 display 應還原成原 inline grid');
  });
});
