// JRead — 媒體祖先固定 px height 撐圖下死空間（v1.6.22 WIRED split-screen header）
//
// Bug：wired.com/story/... 進 reader mode 後 hero 圖與第一段內文之間出現一大塊
// 空白（Jimmy 2026-07-08 截圖回報，實測 gap 580px）。
//
// 根因（cage real-Chrome probe 實證，headless 完全不重現——圖欄固定高只在真站
// 完整載入時生效）：WIRED 桌面版 SplitScreenContentHeader 是雙欄 grid（左文字欄、
// 右圖欄），圖欄三層 wrapper（GridItem / LeadWrapper / LedeBlock）固定 height:895px
// 與文字欄等高。reader 把 grid 線性化成單欄後圖只渲染 356px，但固定 height:895
// 還在 → 圖下方 539px 純死空間頂開後續內文。
//
// galleryFlex 只認 flex/grid（此鏈是 display:block）、ratioBoxes 只認 aspect-ratio
// （此鏈無 aspect-ratio）→ 兩個既有 media pass 都漏網。fixedHeightBoxes 是第三條
// path：mediaAncestors 內、暫設 height:auto 後自然高比原渲染高矮 > 40px 的容器
// 保持 auto、塌掉死空間。collapse guard：塌到比內圖矮 → 還原避免裁切。
//
// 訊號層次（CLAUDE.md 工作流原則 3）：本 spec 驗「styler 的 fixed-height 死空間
// reset 決策邏輯 + 40px 死空間門檻 + collapse guard + restore 可逆」。dynRect 模擬
// jsdom 沒有的 layout——關鍵是「reset 前（height!=auto）量到固定高、reset 後
// （height==auto）量到自然內容高」，styler 靠這個差判定死空間。不驗真實 Chromium
// 的視覺塌陷（那層走 cage probe，已實證 firstP 1266→727 收掉 539px）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'fixed-height-box-deadspace.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

// 動態 rect：height:auto 時回自然（短）高、否則回固定（高）——模擬瀏覽器對
// 「固定 height vs height:auto」的 layout 差異，styler 的死空間判定倚賴此差。
function dynRect(el, tallH, shortH, opts = {}) {
  const width = opts.width || 608;
  const top = opts.top || 200;
  el.getBoundingClientRect = () => {
    const h = el.style.getPropertyValue('height') === 'auto' ? shortH : tallH;
    return { top, bottom: top + h, left: 0, right: width, width, height: h, x: 0, y: top };
  };
}

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler'],
    viewport: { width: 1000, height: 800 },
    pretendToBeVisual: true
  });
  const { document } = env;
  const $ = (id) => document.getElementById(id);

  // 圖欄三層 wrapper：固定高 895、圖只 356（reset 後自然高）→ 死空間 539 → 塌。
  dynRect($('imgcol'), 895, 356, { top: 100 });
  dynRect($('leadwrap'), 895, 356, { top: 100 });
  dynRect($('ledeblock'), 895, 356, { top: 100 });
  // 內圖（picture / img）：collapse guard 用其渲染高度，356 < 塌後 356×0.8 不觸發。
  stubRect($('hero'), { top: 100, width: 548, height: 356 });
  stubRect($('heroimg'), { top: 100, width: 548, height: 356 });

  // collapse guard：guardbox 固定 400、塌到 100（內容脫離 flow）< 內圖 405×0.8=324
  // → 應還原 height，不塌（避免把圖裁掉）。
  dynRect($('guardbox'), 400, 100, { top: 1400 });
  stubRect($('guardpic'), { top: 1400, width: 608, height: 405 });
  stubRect($('guardimg'), { top: 1400, width: 608, height: 405 });

  // 反例：plainbox 高度內容驅動——reset auto 後不變（400→400，差 0）→ 不動。
  dynRect($('plainbox'), 400, 400, { top: 1900 });
  stubRect($('plainimg'), { top: 1900, width: 608, height: 360 });

  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  const art = detected.el;
  const snapshot = env.NS.styler.apply(art, DEFAULT_SETTINGS);

  return { env, document, $, art, snapshot };
}

describe('styler — 媒體祖先固定 px height 撐圖下死空間（v1.6.22 WIRED split-screen）', () => {
  let document, $, env, art, snapshot;

  before(() => {
    const r = setup();
    document = r.document; $ = r.$; env = r.env; art = r.art; snapshot = r.snapshot;
  });

  it('圖欄固定高 wrapper 被歸 auto（核心修法：塌掉死空間）', () => {
    assert.strictEqual($('ledeblock').style.getPropertyValue('height'), 'auto',
      'LedeBlock 固定 height:895 但內容只 356 → 應歸 auto，否則圖下方留 539px 死空間');
    assert.strictEqual($('leadwrap').style.getPropertyValue('height'), 'auto',
      'LeadWrapper 同鏈固定高 → 應歸 auto');
    assert.strictEqual($('imgcol').style.getPropertyValue('height'), 'auto',
      'GridItem 圖欄固定高 → 應歸 auto');
  });

  it('collapse guard：塌到比內圖矮的容器不歸 auto（避免裁圖）', () => {
    assert.notStrictEqual($('guardbox').style.getPropertyValue('height'), 'auto',
      'guardbox 歸 auto 後塌到 100 < 內圖 405×0.8 → 應還原 height，否則絕對定位內容被裁');
  });

  it('反例：內容驅動高度的 wrapper 完全不被動到', () => {
    assert.strictEqual($('plainbox').style.getPropertyValue('height'), '',
      'plainbox 高度由 img + caption 內容驅動（reset 無變化）→ 不該被加任何 inline height');
  });

  it('restore 後歸 auto 的 wrapper height 還原（可逆、無殘留）', () => {
    env.NS.styler.restore(art, snapshot);
    assert.strictEqual($('ledeblock').style.getPropertyValue('height'), '',
      'restore 後 ledeblock 的 inline height:auto 應移除（原高度來自站點 CSS class）');
    assert.strictEqual($('imgcol').style.getPropertyValue('height'), '',
      'restore 後 imgcol 的 inline height:auto 應移除');
  });
});
