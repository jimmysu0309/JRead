// JRead — styler 寬語意內容水平捲（v0.8.101）
//
// Bug：arxiv.org/html 全文頁進 reader mode 後，LaTeXML 把展示公式輸出成
// <table class="ltx_equation">，內含不可斷行的數學運算式，intrinsic min-width
// 撐破卡片版心；styler 既有全後代 max-width:100% 擋不住內容 min-width，table
// 仍溢出右緣被 card 的 overflow-x:hidden 切掉（probe 實測溢出 54-144px、公式
// 右側 + 式號被截，看不到也捲不到）。
//
// 通則修法（CLAUDE.md 硬規則 3）：table / pre 是「內容無法 wrap」的語意載體，
// 渲染寬撐破 card 時改 display:block + overflow-x:auto + max-width:100% 讓它在
// 卡內水平捲（標準 responsive-table pattern）。只處理「實際溢出右緣 + 非 player
// + 未被既有 overflow-x:auto/scroll 祖先吸收」者，能 wrap 的窄表格不動。
//
// 訊號層次（CLAUDE.md 工作流原則 3）：本 spec 驗 styler 的 wide-scroll 決策邏輯
// （溢出判定 + 吸收祖先排除 + restore 對稱）。stub rect 模擬 jsdom 沒有的 layout
// （getBoundingClientRect 全回 0）。真實 Chromium 的「公式回到卡內 + 可水平捲」
// 由 page-rounds harness 在真實 arxiv 頁驗（overflow audit pass + 截圖）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'wide-content-scroll.html');

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
  const { document } = env;
  const $ = (id) => document.getElementById(id);

  // card right = 1000；溢出元素 right = 1100（> 1000+2）；窄 table right = 400。
  stubRect($('art'), { left: 0, top: 0, width: 1000, height: 2000 });
  stubRect($('wide-eq'), { left: 0, top: 100, width: 1100, height: 60 });
  stubRect($('narrow'), { left: 0, top: 200, width: 400, height: 30 });
  stubRect($('wide-pre'), { left: 0, top: 300, width: 1100, height: 40 });
  // wrapper 在 card 內（right 1000）、overflow-x:auto；內含的寬 table 溢出但被吸收
  stubRect($('scrollwrap'), { left: 0, top: 400, width: 1000, height: 60 });
  stubRect($('absorbed'), { left: 0, top: 400, width: 1100, height: 60 });

  const art = $('art');
  const snapshot = env.NS.styler.apply(art, DEFAULT_SETTINGS);
  return { env, document, $, art, snapshot };
}

describe('styler — 寬語意內容水平捲（v0.8.101 arxiv 寬公式）', () => {
  let document, $, env, art, snapshot;

  before(() => {
    const r = setup();
    document = r.document; $ = r.$; env = r.env; art = r.art; snapshot = r.snapshot;
  });

  it('溢出 card 的寬 table → display:block + overflow-x:auto + max-width:100%（核心驗證點）', () => {
    const t = $('wide-eq');
    assert.strictEqual(t.style.getPropertyValue('display'), 'block',
      '溢出寬 table 應 display:block，否則 table 撐破 card 被 overflow:hidden 切掉');
    assert.strictEqual(t.style.getPropertyValue('overflow-x'), 'auto',
      '溢出寬 table 應 overflow-x:auto，讓公式在卡內水平捲（看得到也捲得到）');
    assert.strictEqual(t.style.getPropertyValue('max-width'), '100%',
      '溢出寬 table 應 max-width:100%，把 box 收進 card 版心');
  });

  it('溢出 card 的寬 pre 同樣套水平捲', () => {
    const p = $('wide-pre');
    assert.strictEqual(p.style.getPropertyValue('overflow-x'), 'auto',
      '溢出寬 pre 應 overflow-x:auto');
    assert.strictEqual(p.style.getPropertyValue('display'), 'block',
      '溢出寬 pre 應 display:block');
  });

  it('防誤殺：窄 table（不溢出）不可被動', () => {
    const t = $('narrow');
    assert.strictEqual(t.style.getPropertyValue('overflow-x'), '',
      '窄 table 不溢出右緣，不該被加 overflow-x（避免拉伸 / 改變 table layout）');
    assert.strictEqual(t.style.getPropertyValue('display'), '',
      '窄 table 不該被改 display');
  });

  it('防誤殺：已被 overflow-x:auto wrapper（在卡內）吸收的寬 table 不重複處理', () => {
    const t = $('absorbed');
    assert.strictEqual(t.style.getPropertyValue('overflow-x'), '',
      '已被既有 scroll wrapper 吸收的 table 不該重複加 overflow-x（避免雙重 scroll container）');
  });

  it('restore 後溢出元素的 inline display / overflow-x / max-width 還原（無殘留）', () => {
    env.NS.styler.restore(art, snapshot);
    const t = $('wide-eq');
    assert.strictEqual(t.style.getPropertyValue('display'), '',
      'restore 後 display 應移除（fixture 原本無 inline display）');
    assert.strictEqual(t.style.getPropertyValue('overflow-x'), '',
      'restore 後 overflow-x 應移除');
    assert.strictEqual(t.style.getPropertyValue('max-width'), '',
      'restore 後 max-width 應移除');
  });
});
