// JRead — 媒體 wrapper aspect-ratio 預留 placeholder 撐圖下假空白（v0.8.137）
//
// Bug：theverge.com/column/... 進 reader mode 後 hero / gallery 圖片下方出現
// 一大塊空白（Jimmy 2026-06-20 截圖回報）。
//
// 根因（cage probe 實證）：The Verge 媒體 wrapper 用雜湊 atomic class（_1m5y14k5）
// 設 aspect-ratio:1/1 預留固定比例做 lazy-load placeholder，實際載入的 landscape
// 圖渲染 405px、box 仍按 aspect-ratio 撐 608px → 203px 假空白。既有 CSS
// [class*="ratio" i] reset 只認 class 名含 "ratio" 的容器，hash class 漏網。
//
// 通則修法（結構訊號、非 class/hostname 特判，符合硬規則 3）：apply() runtime
// 對 mediaAncestors 內 computed aspect-ratio !== 'auto' 的 wrapper 一律歸 auto，
// 讓 box 退回圖片 static flow 自然高度。自驗 collapse guard：歸 auto 後 box 若塌到
// 比內圖渲染高度還矮（內容 absolute、aspect-ratio 是唯一高度來源）→ 還原避免裁切。
//
// 訊號層次（CLAUDE.md 工作流原則 3）：本 spec 驗「styler 的 aspect-ratio reset
// 決策邏輯 + collapse guard + lazy 分支 + restore 可逆」。stub rect 模擬 jsdom 沒有的
// layout（box / img 渲染高度）。不驗真實 Chromium 的 aspect-ratio 塌陷視覺（那層
// 走 cage probe + harness 截圖，已實證 608→429 收掉 179px）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'aspect-ratio-box-gap.html');

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

  // 正例：box 撐 608（aspect-ratio:1.5/1）、實際圖 405 → afterH(608) > 405×0.8(324)
  // → 不塌、保留 reset（aspect-ratio: auto）。
  stubRect($('gapbox'), { top: 200, width: 608, height: 608 });
  stubRect($('gapimg'), { top: 200, width: 608, height: 405 });
  // collapse guard：box 渲染 150（< 圖 405×0.8=324）→ 還原 aspect-ratio 避免裁圖。
  stubRect($('guardbox'), { top: 900, width: 608, height: 150 });
  // innerMedia 在 guardbox 內第一個 media 是 <picture>（querySelector tree order）→ 量它的高度
  stubRect($('guardpic'), { top: 900, width: 608, height: 405 });
  stubRect($('guardimg'), { top: 900, width: 608, height: 405 });
  // lazy：圖未載入 0x0 → imgH=0 跳過 guard、保留 reset。
  stubRect($('lazybox'), { top: 1200, width: 608, height: 342 });
  stubRect($('lazyimg'), { top: 1200, width: 0, height: 0 });
  // 反例：figure 無 aspect-ratio → 不在 reset 對象內。
  stubRect($('plainbox'), { top: 1600, width: 608, height: 400 });
  stubRect($('plainimg'), { top: 1600, width: 608, height: 400 });

  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  const art = detected.el;
  const snapshot = env.NS.styler.apply(art, DEFAULT_SETTINGS);

  return { env, document, $, art, snapshot };
}

describe('styler — 媒體 wrapper aspect-ratio 撐圖下假空白（v0.8.137 The Verge）', () => {
  let document, $, env, art, snapshot;

  before(() => {
    const r = setup();
    document = r.document; $ = r.$; env = r.env; art = r.art; snapshot = r.snapshot;
  });

  it('hashed-class aspect-ratio wrapper 被歸 auto（核心修法）', () => {
    assert.strictEqual($('gapbox').style.getPropertyValue('aspect-ratio'), 'auto',
      'aspect-ratio wrapper 應被 reset 成 auto，否則 box 撐出圖下假空白');
  });

  it('collapse guard：歸 auto 後會塌到比內圖矮的 wrapper 還原 aspect-ratio（不裁圖）', () => {
    assert.notStrictEqual($('guardbox').style.getPropertyValue('aspect-ratio'), 'auto',
      'box 歸 auto 後塌到比圖矮 → 應還原 aspect-ratio，否則 absolute 內容被裁切（New Yorker 類）');
  });

  it('lazy：未載入圖（0x0）仍 reset（無要保護的高度）', () => {
    assert.strictEqual($('lazybox').style.getPropertyValue('aspect-ratio'), 'auto',
      'lazy 圖未載入時 box 仍應歸 auto，跟著塌、載入後 height:auto 自然撐起');
  });

  it('反例：無 aspect-ratio 的 figure 完全不被動到', () => {
    assert.strictEqual($('plainbox').style.getPropertyValue('aspect-ratio'), '',
      '正常 figure 沒有 aspect-ratio reservation，不該被加任何 inline aspect-ratio');
  });

  it('restore 後 reset 過的 wrapper aspect-ratio 還原（可逆、無殘留）', () => {
    env.NS.styler.restore(art, snapshot);
    assert.notStrictEqual($('gapbox').style.getPropertyValue('aspect-ratio'), 'auto',
      'restore 後 gapbox aspect-ratio 應還原回原 inline 比例，不可殘留 auto');
    assert.notStrictEqual($('lazybox').style.getPropertyValue('aspect-ratio'), 'auto',
      'restore 後 lazybox aspect-ratio 應還原回原 inline 比例');
  });
});
