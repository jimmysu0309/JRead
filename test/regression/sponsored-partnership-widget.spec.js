// JRead — 贊助 / 商業推薦 widget（「in partnership with X」）整塊清 regression（v1.0.9）
//
// 根因（Jimmy 2026-06-25 autocar.co.uk「文末這些都是廣告」）：文末 heycar
// 「USED CARS FOR SALE / in partnership with Autotrader」車輛推薦 carousel
// （heading + 多個車輛連結 + 價格）。server HTML 只有空殼 wrapper + 1 車，heading /
// 品牌 / 多車是 client 端 JS 晚注入——clean() 當下 block 未 populate 時靜態
// hideInsideArticleSidebarColumns 條件 C（link-heavy widget）漏抓，注入後又因 class
// 無 keyword、heading 走 resolveHeadingNoiseTarget 被「累計短文字 >= 300」主文保護
// 擋成只藏 heading（同 Community Q&A 問題）→ 殘留可見（cage 證 harness 靜態抓到但
// real Chrome lazy 時序下漏網）。
//
// 修法（結構性通則、非站點 class 特判，硬規則 3）：heading（h1-h4）文字含贊助標記
// （in partnership with / presented by / brought to you by / sponsored by）→ 用
// hasArticleTitleAnchor / hasLongMainParagraph 邊界 walk-up（繞過累計短文字誤保護，
// 與 hideCommunityQaWidget 同款）找「不含主文長段落的最外層 wrapper」整塊 hide。
// 靜態 hideSponsoredPartnershipWidgets + 動態 checkDynamicNoise 共用
// hideSponsorWidgetFromHeading（lazy 注入兜底）。自帶安全性：只 hide 不含長段落的
// widget block——贊助標記 heading 引導真內容區（含 prose）時 walk-up 第一層即 break、
// 不 hide。
//
// 訊號層次（CLAUDE.md 工作流原則 3）：本 spec 驗「贊助 widget 偵測 + walk-up 邊界 +
// 靜態/動態雙路徑 + 真內容守衛」。動態路徑（lazy 注入兜底）是對 Jimmy 案的真正修法。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
);

const LONG = '這段是真正的主文內容，必須夠長以通過 hasLongMainParagraph 的 100 字門檻，'
  + 'so we keep adding words about steering wheels and cars to comfortably exceed one hundred characters.';

function buildEnv(withWidget) {
  const widgetHtml = withWidget ? `
    <div id="heycar" class="block block-heycar-used-cars-carousel-block odd">
      <h2 id="adtitle" class="block-title"><span>USED CARS FOR SALE</span> In partnership with Autotrader</h2>
      <a href="/c1">Hyundai IONIQ 5 63kWh Advance Auto 5dr</a><span>£23,493</span>
      <a href="/c2">Toyota Auris 1.4 D-4D Sport Euro 5</a><span>£4,850</span>
      <a href="/c3">Vauxhall Corsa 1.2 Turbo Ultimate</a><span>£9,200</span>
    </div>` : '';
  const dom = new JSDOM(`<!DOCTYPE html><html><body><main id="wrap">
    <article id="art">
      <h1>Why steering wheels should always be round</h1>
      <p id="b1">${LONG}</p>
      <p id="b2">${LONG}</p>
      ${widgetHtml}
    </article></main></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
  window.eval(SRC.namespace);
  window.eval(SRC.cleaner);
  const doc = window.document;
  return { window, doc, art: doc.getElementById('art'), NS: window.__JRead };
}

describe('sponsored-partnership-widget — 結構 forcing', () => {
  it('必須宣告 hideSponsorWidgetFromHeading（靜態 + 動態單一資料源）', () => {
    assert.ok(/function\s+hideSponsorWidgetFromHeading/.test(CLEANER_SRC));
    assert.ok(/SPONSOR_WIDGET_HEADING_RE/.test(CLEANER_SRC));
    assert.ok(/in\\s\+partnership\\s\+with/.test(CLEANER_SRC), 'RE 必須含「in partnership with」贊助標記');
  });
  it('walk-up 必須用 hasLongMainParagraph 邊界（繞過累計短文字誤保護）', () => {
    const m = CLEANER_SRC.match(/function\s+hideSponsorWidgetFromHeading[\s\S]*?\n  \}/);
    assert.ok(/hasLongMainParagraph/.test(m[0]), '必須用 hasLongMainParagraph 當邊界（同 hideCommunityQaWidget）');
    assert.ok(/hasArticleTitleAnchor/.test(m[0]), '必須含 title-anchor 邊界保護');
  });
  it('靜態 clean 與動態 observer 都使用此 helper（單一資料源）', () => {
    assert.ok(/safeRun\(hideSponsoredPartnershipWidgets/.test(CLEANER_SRC), 'clean() 必須 safeRun 靜態 sweep');
    const dyn = CLEANER_SRC.match(/function\s+checkDynamicNoise[\s\S]*?\n  \}/)[0];
    assert.ok(/hideSponsorWidgetFromHeading/.test(dyn), 'checkDynamicNoise 必須呼叫共用 helper（lazy 兜底）');
  });
});

describe('sponsored-partnership-widget — 行為', () => {
  it('靜態：clean 當下已存在的贊助 widget 整塊被 hide', () => {
    const { doc, art, NS } = buildEnv(true);
    const hidden = NS.cleaner.clean(art);
    assert.strictEqual(doc.getElementById('heycar').dataset.jreadHidden, '1',
      '含「in partnership with」heading 的車輛推薦 widget 應整塊 hide');
    NS.cleaner.restore(hidden);
  });

  it('動態（核心）：lazy 注入的贊助 widget 經 observer 整塊被 hide', async () => {
    // checkDynamicNoise 不跑 sidebar-column 分類、class 無 keyword、heading 不在
    // NOISE_HEADING_TEXT_RE → 唯有本 sponsor 規則能 hide，乾淨隔離。
    const { doc, art, NS } = buildEnv(false);
    const hidden = NS.cleaner.clean(art);
    const widget = doc.createElement('div');
    widget.id = 'heycar';
    widget.className = 'block block-heycar-used-cars-carousel-block odd';
    widget.innerHTML = '<h2 class="block-title"><span>USED CARS FOR SALE</span> In partnership with Autotrader</h2>'
      + '<a href="/c1">Hyundai IONIQ 5 63kWh Advance Auto 5dr</a><span>£23,493</span>'
      + '<a href="/c2">Toyota Auris 1.4 D-4D Sport Euro 5</a><span>£4,850</span>';
    art.appendChild(widget);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(widget.dataset.jreadHidden, '1',
      'lazy 注入的贊助 widget 必須經 checkDynamicNoise + hideSponsorWidgetFromHeading 整塊 hide');
    NS.cleaner.restore(hidden);
  });

  it('守衛：「in partnership with」heading 引導真內容區（含長段）不被誤殺', () => {
    const { doc, art, NS } = buildEnv(false);
    const sec = doc.createElement('div');
    sec.id = 'realsec';
    sec.innerHTML = '<h2 id="realtitle">In partnership with the local community</h2>'
      + '<p id="realbody">' + LONG + '</p>';
    art.appendChild(sec);
    const hidden = NS.cleaner.clean(art);
    assert.notStrictEqual(doc.getElementById('realsec').dataset.jreadHidden, '1',
      '贊助標記 heading 引導真內容區（同層含長段）時 walk-up 第一層即 break、不該 hide');
    assert.notStrictEqual(doc.getElementById('realbody').dataset.jreadHidden, '1',
      '真內容長段不可被誤殺');
    NS.cleaner.restore(hidden);
  });
});
