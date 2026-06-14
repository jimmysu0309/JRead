// JRead — styler de-column：flex-row / 多欄 grid 把主文擠成半欄 → 塌成單欄
// （v0.8.66）
//
// Bug：christies.com/en/stories/... 進 reader mode 後內文段落只佔卡片版心
// 左半（~292px），右半整片留白。根因 = 原站把主文段落排進 flex-row 容器
// （div.sc-kLokBR 是 display:flex）做雜誌式雙欄 layout，文字欄被擠成半欄、
// 另半欄留給側欄圖說（本文沒側欄時純留白）。
//
// 既有 galleryFlex 只塌「含 picture/img/figure 直接子」的 flex/grid（並列圖），
// 純文字欄分欄漏網。de-column pass 補上：以「主文長段落實際被渲染得比它的
// flex/grid 祖先內容寬窄一截（< 70%）」為結構訊號，把分欄容器塌成 display:block。
//
// 訊號層次（CLAUDE.md 工作流原則 3）：本 spec 驗「styler 的 de-column 決策邏輯
// （含寬度比例門檻 + flex-row/grid-multi 判定 + 防誤殺 guard）」。stub rect 模擬
// jsdom 沒有的 layout（getBoundingClientRect 全回 0）。不驗真實 Chromium 的 flex
// 解析寬度（那層走 tools/probe-christies.js + debug-harness 截圖）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'flex-text-column-decollapse.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

// 容器內容寬 = 600；被擠的文字欄段落 280（< 600 × 70% = 420）→ 命中塌欄。
// 全寬子段落 580（> 420）→ 不命中。
function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler'],
    viewport: { width: 1000, height: 800 },
    pretendToBeVisual: true
  });
  const { document } = env;
  const $ = (id) => document.getElementById(id);

  // 正例 1：flex-row 600，主文 p 280（半欄）
  stubRect($('flexrow'), { top: 100, width: 600, height: 400 });
  stubRect($('p1'), { top: 100, width: 280, height: 120 });
  stubRect($('p2'), { top: 240, width: 280, height: 80 });
  // 正例 2：grid 600，主文 p 280
  stubRect($('gridrow'), { top: 600, width: 600, height: 200 });
  stubRect($('gp1'), { top: 600, width: 280, height: 100 });
  // 反例 A：flex-row 600，單一全寬 p 580
  stubRect($('fullrow'), { top: 900, width: 600, height: 120 });
  stubRect($('fp1'), { top: 900, width: 580, height: 100 });
  // 反例 B：flex-column 600，全寬 p 580
  stubRect($('colstack'), { top: 1100, width: 600, height: 120 });
  stubRect($('cp1'), { top: 1100, width: 580, height: 100 });
  // 反例 C：button row 600，短連結（無長段落）
  stubRect($('btnrow'), { top: 1300, width: 600, height: 40 });
  // 正例 3：flex-row 600，內容圖片鎖在 66.67% 欄 = 397（< 420）。
  // 圖說 p 短（£201,600）→ 只有 image anchor path 能塌這層（隔離新 code path）。
  stubRect($('imgrow'), { top: 1500, width: 600, height: 480 });
  stubRect($('bigimg'), { top: 1500, width: 397, height: 480 });
  // 反例 D：flex-row 600，但欄內只有 emoji / 小 icon（24px）→ 非 content img、不塌
  stubRect($('emojirow'), { top: 2100, width: 600, height: 40 });
  stubRect($('emojiimg'), { top: 2100, width: 24, height: 24 });
  // 正例 4：lazy hero——apply 當下圖 0x0（未載入），naturalWidth=0 走 lazy 分支
  // 掛 load listener；不可在 apply 當下立即塌。
  stubRect($('lazyrow'), { top: 2700, width: 600, height: 480 });
  stubRect($('lazyimg'), { top: 2700, width: 0, height: 0 });
  // 正例 5：小 hero 72%（450/600）——> 0.7 但 < 0.9，v0.8.70 圖片門檻才塌。
  stubRect($('midrow'), { top: 3300, width: 600, height: 300 });
  stubRect($('midimg'), { top: 3300, width: 432, height: 270 });
  // 反例 E：圖片幾乎撐滿（576/600 = 96% >= 0.9）→ 不塌。
  stubRect($('fullimgrow'), { top: 3900, width: 600, height: 360 });
  stubRect($('fullimg'), { top: 3900, width: 576, height: 360 });

  const art = $('art');
  const snapshot = env.NS.styler.apply(art, DEFAULT_SETTINGS);

  // apply 後模擬 hero 載入：rect 變 405（66.67% 欄、< 600×70%），dispatch load
  // → onLoad 重量、補跑 de-column 塌掉 lazyrow。
  const lazyCollapsedBeforeLoad = $('lazyrow').style.display === 'block';
  stubRect($('lazyimg'), { top: 2700, width: 405, height: 300 });
  $('lazyimg').dispatchEvent(new env.window.Event('load'));

  return { env, document, $, art, snapshot, lazyCollapsedBeforeLoad };
}

describe('styler — de-column flex/grid 文字欄塌成單欄（v0.8.66）', () => {
  let document, $, env, art, snapshot, lazyCollapsedBeforeLoad;

  before(() => {
    const r = setup();
    document = r.document; $ = r.$; env = r.env; art = r.art; snapshot = r.snapshot;
    lazyCollapsedBeforeLoad = r.lazyCollapsedBeforeLoad;
  });

  it('flex-row 把主文擠成半欄 → 容器 display 被塌成 block（核心驗證點）', () => {
    assert.strictEqual($('flexrow').style.display, 'block',
      'flex-row 文字欄分欄容器應被塌成 display:block，否則內文只佔版心半欄、右側留白');
  });

  it('grid 多欄把主文擠成半欄 → 容器 display 被塌成 block', () => {
    assert.strictEqual($('gridrow').style.display, 'block',
      'grid 多欄文字欄分欄容器應被塌成 display:block');
  });

  it('防誤殺 A：單一全寬子的 flex-row（沒真的分欄）不可塌', () => {
    assert.notStrictEqual($('fullrow').style.display, 'block',
      '段落已是全寬（> 容器 70%），無分欄，不該動 display');
  });

  it('防誤殺 B：flex-column（本來就垂直堆疊）不可塌', () => {
    assert.notStrictEqual($('colstack').style.display, 'block',
      'flex-direction:column 不是橫向分欄，不該被 de-column 命中');
  });

  it('防誤殺 C：橫向 UI 列（短文字 / 無長段落）不可塌', () => {
    assert.notStrictEqual($('btnrow').style.display, 'block',
      'button / 分享列無 >= 80 字長段落，不該被 de-column 命中');
  });

  it('flex-row 把內容圖片鎖在 66.67% 欄 → 容器塌成 block（v0.8.68 image anchor）', () => {
    assert.strictEqual($('imgrow').style.display, 'block',
      '欄內只有圖、沒有長 <p>，content img 當 anchor 仍應塌欄，否則圖偏左變小');
  });

  it('防誤殺 D：欄內只有 emoji / 小 icon（< 100px）不可塌', () => {
    assert.notStrictEqual($('emojirow').style.display, 'block',
      'inline emoji / 小 icon 非 content img，不該觸發 de-column');
  });

  it('lazy hero：apply 當下圖 0x0 不立即塌（避免誤判）', () => {
    assert.strictEqual(lazyCollapsedBeforeLoad, false,
      'apply 當下 hero 還沒載入（0x0），不該立即塌欄');
  });

  it('lazy hero：載入後（load 事件）補跑 de-column 塌欄（v0.8.69 核心驗證點）', () => {
    assert.strictEqual($('lazyrow').style.display, 'block',
      'hero 載入後量到 405px（撐窄欄），load listener 應補塌欄，否則 hero 卡 66.67% 欄偏左');
  });

  it('小 hero 72%（介於 0.7~0.9）→ 塌欄（v0.8.70 圖片門檻放寬核心驗證點）', () => {
    assert.strictEqual($('midrow').style.display, 'block',
      '440px 級小 hero = 72%、舊 0.7 門檻漏掉；圖片門檻 0.9 後應塌欄置中，否則仍偏左');
  });

  it('防誤殺 E：圖片幾乎撐滿 flex 容器（96% >= 0.9）不可塌', () => {
    assert.notStrictEqual($('fullimgrow').style.display, 'block',
      '圖片已近全寬、沒被分欄擠窄，不該塌欄');
  });

  it('restore 後塌欄容器的 inline display 還原（無殘留）', () => {
    // fixture 原始 inline 是 display:flex / display:grid，restore 應還原回去
    env.NS.styler.restore(art, snapshot);
    assert.strictEqual($('flexrow').style.display, 'flex',
      'restore 後 flex-row 容器 display 應還原成原 inline flex');
    assert.strictEqual($('gridrow').style.display, 'grid',
      'restore 後 grid 容器 display 應還原成原 inline grid');
    assert.strictEqual($('imgrow').style.display, 'flex',
      'restore 後 image 欄容器 display 應還原成原 inline flex');
    assert.strictEqual($('lazyrow').style.display, 'flex',
      'restore 後 lazy hero 欄容器 display 應還原成原 inline flex');
  });
});
