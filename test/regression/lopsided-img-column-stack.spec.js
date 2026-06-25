// JRead — styler de-column：窄圖欄擠寬文欄的作者 / meta 卡塌成單欄（v1.0.9）
//
// Bug：autocar.co.uk 作者欄進 reader mode 後「文字疊在一起」（Jimmy 2026-06-25）。
// 根因 = 站點把作者卡排成 flex-row 兩欄——窄欄（頭像 + Title/Follow 標籤）+ 寬欄
// （bio 長文）。reader card 單欄下窄欄被擠到 min-content（.author-left 渲染 39px =
// card 6%），頭像被壓扁、標籤逐字斷行，與寬欄 bio 文字擠在一起（cage probe 實證
// horizOverlap headless 量 0 但 real Chrome 疊字；無論是否真重疊都是破版）。
//
// 既有 decolumnFrom 的 ratio 閘以「主文長段落 anchor 被擠窄（< 70%）」為訊號，但
// 這裡被擠的是窄圖欄、寬 bio 欄佔 82% > 70% → 漏網。新增 stackLopsidedImgCol：
// flex-row / 多欄 grid 內「含圖的內容欄」被擠到 < 25% 容器內容寬、且另有欄 >= 50%
// → 塌成 display:block 讓兩欄垂直堆疊。
//
// 防誤殺：narrow 欄必須含「非 inline」img（小 byline 頭像 <= 48px 標 inline、被
// loop 跳過）；必須有 >= 50% 寬 sibling（排除三等欄）；只認 flex-row / grid-multi
// （flex-column 不命中）；排除 byline root（v1.0.8 BYLINE_ATTR）/ player。
//
// 訊號層次（CLAUDE.md 工作流原則 3）：本 spec 驗「styler stackLopsidedImgCol 的
// 決策邏輯（含寬度比例門檻 + 含圖判定 + 防誤殺 guard）」。stub rect 模擬 jsdom
// 沒有的 layout。真實 Chromium 的 flex 解析寬度走 tools/probe-autocar.js + 截圖。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'lopsided-img-column-stack.html');

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
    viewport: { width: 1000, height: 800 },
    pretendToBeVisual: true
  });
  const { document } = env;
  const $ = (id) => document.getElementById(id);

  // articleEl 卡片寬 600（cardRight = 600）——否則既有 overflow block（v0.8.136）
  // 以 cardRight=0 誤判所有 flex-row 子溢出而全塌，污染本 spec 的負例隔離。
  stubRect($('art'), { top: 0, width: 600, height: 2200 });

  // 頭像一律 rect 80（48 < 80 < 100）：> INLINE_IMG_MAX(48) 不標 inline-img、
  // 又 < 100 不觸發既有 decolumnFrom 的 content-img anchor（隔離本 rule）。
  // 真實 autocar 頭像 classify 時 142（非 inline）、de-column 時被擠成 39；
  // jsdom 靜態 stub 無法兩階段，以 rect 80 表「非 inline 的小圖卡在窄欄」。

  // 正例：personality flex-row 600，author-left 被擠成 39（< 150 = 25%），
  // author-right 561（>= 300 = 50%）。
  stubRect($('personality'), { top: 100, width: 600, height: 400 });
  stubRect($('author-left'), { top: 100, width: 39, height: 400 });
  stubRect($('avatar-wrap'), { top: 100, width: 39, height: 80 });
  stubRect($('avatar'), { top: 100, width: 80, height: 80 });
  stubRect($('author-right'), { top: 100, width: 561, height: 400 });
  stubRect($('bio'), { top: 100, width: 561, height: 380 });

  // 反例 A：圖欄 200（33% >= 25%）→ 未被擠、不塌
  stubRect($('row-notnarrow'), { top: 600, width: 600, height: 160 });
  stubRect($('nn-left'), { top: 600, width: 200, height: 80 });
  stubRect($('nn-img'), { top: 600, width: 80, height: 80 });
  stubRect($('nn-right'), { top: 600, width: 400, height: 160 });

  // 反例 B：窄文字欄（無圖）+ 寬欄（圖在寬欄）→ 不塌
  stubRect($('row-textnarrow'), { top: 800, width: 600, height: 160 });
  stubRect($('tn-left'), { top: 800, width: 39, height: 30 });
  stubRect($('tn-right'), { top: 800, width: 561, height: 160 });
  stubRect($('tn-img'), { top: 800, width: 80, height: 80 });

  // 反例 C：窄圖欄 + 三等欄（無 >= 50% sibling）→ 不塌
  stubRect($('row-equal'), { top: 1000, width: 600, height: 160 });
  stubRect($('eq-a'), { top: 1000, width: 39, height: 80 });
  stubRect($('eq-img'), { top: 1000, width: 80, height: 80 });
  stubRect($('eq-b'), { top: 1000, width: 280, height: 160 });
  stubRect($('eq-c'), { top: 1000, width: 280, height: 160 });

  // 反例 D：flex-column 含窄圖 → 不塌
  stubRect($('col-stack'), { top: 1200, width: 600, height: 300 });
  stubRect($('cs-img-wrap'), { top: 1200, width: 39, height: 80 });
  stubRect($('cs-img'), { top: 1200, width: 80, height: 80 });
  stubRect($('cs-body'), { top: 1350, width: 600, height: 120 });

  // 反例 E：byline 小頭像（36 <= 48）→ 標 inline、loop 跳過 → 不塌
  stubRect($('byline-row'), { top: 1600, width: 600, height: 40 });
  stubRect($('bl-avatar-wrap'), { top: 1600, width: 36, height: 36 });
  stubRect($('bl-avatar'), { top: 1600, width: 36, height: 36 });
  stubRect($('bl-text'), { top: 1600, width: 561, height: 40 });

  stubRect($('body'), { top: 1800, width: 600, height: 200 });

  const art = $('art');
  const snapshot = env.NS.styler.apply(art, DEFAULT_SETTINGS);
  return { env, document, $, art, snapshot };
}

describe('styler — 窄圖欄擠寬文欄的作者卡塌成單欄（v1.0.9）', () => {
  let document, $, env, art, snapshot;

  before(() => {
    const r = setup();
    document = r.document; $ = r.$; env = r.env; art = r.art; snapshot = r.snapshot;
  });

  it('作者卡 flex-row 窄圖欄被擠 < 25% → 容器塌成 block（核心驗證點）', () => {
    assert.strictEqual($('personality').style.display, 'block',
      '窄圖欄（頭像 + 標籤）被擠成 39px、寬 bio 欄 561px = lopsided 分欄，應塌成 block 垂直堆疊，否則標籤逐字斷行疊到 bio 文字');
  });

  it('防誤殺 A：窄圖欄 >= 25%（未被擠）不可塌', () => {
    assert.notStrictEqual($('row-notnarrow').style.display, 'block',
      '圖欄佔 33% > 25%、未被擠窄，不該塌欄');
  });

  it('防誤殺 B：窄欄無圖（圖在寬欄）不可塌——純窄文字欄交給 cleaner', () => {
    assert.notStrictEqual($('row-textnarrow').style.display, 'block',
      'narrow 欄不含 img（圖在寬欄），不該觸發本規則');
  });

  it('防誤殺 C：三等欄（無 >= 50% sibling）不可塌', () => {
    assert.notStrictEqual($('row-equal').style.display, 'block',
      '無 >= 50% 寬 sibling = 非 lopsided sidebar+main，不該塌欄');
  });

  it('防誤殺 D：flex-column（本來就垂直）不可塌', () => {
    assert.notStrictEqual($('col-stack').style.display, 'block',
      'flex-direction:column 非橫向分欄，不該命中');
  });

  it('防誤殺 E：byline 小頭像（<= 48px 標 inline）不可塌', () => {
    assert.notStrictEqual($('byline-row').style.display, 'block',
      '小 byline 頭像被標 inline-img、loop 跳過，一般 byline 列不該被塌');
  });

  it('restore 後塌欄容器的 inline display 還原（無殘留）', () => {
    env.NS.styler.restore(art, snapshot);
    assert.strictEqual($('personality').style.display, 'flex',
      'restore 後容器 display 應還原成原 inline flex');
  });
});
