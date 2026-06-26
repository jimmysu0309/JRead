// JRead — Substack「Recommend X to your readers」recommendation footer widget 整塊清
// regression（v1.0.11）
//
// 根因（Jimmy 2026-06-26 chinatalk.media/p/wartalk-the-bs-detente 截圖「向您的讀者推薦
// ChinaTalk」小 logo 圖疊在文字上）：文末 Substack publication 推薦卡 = 小 logo img +
// heading「Recommend <pub> to your readers」+ 簡介段 + Subscribe 按鈕，整塊
// data-testid="recommendation-footer"。Substack 的 class 全是 emotion hash（pencraft
// pc-...）無 keyword 可命中 → hideInsideArticleByKeyword 漏；heading walk-up 又因簡介
// 短段時而觸 hasLongMainParagraph 邊界不穩 → heading 軌也不可靠。唯一穩定訊號是
// 平台慣例屬性 data-testid 含「recommendation」。
//
// 修法（結構性通則、非站點 hostname / 單站 class 特判，硬規則 3）：以 data-testid 語意值
// 含「recommendation」當「推薦 widget」語意標記（同 NOISE_KEYWORD_RE 的 recommendation /
// THIRD_PARTY_AD_SEL 的 [data-testid="ad-unit"]）整塊 hide。靜態
// hideRecommendationWidgets + 動態 checkDynamicNoise 共用 hideRecommendationWidgetFrom
//（lazy 注入兜底——React 端常在 clean 之後才 render 推薦卡）。
//
// 訊號層次（CLAUDE.md 工作流原則 3）：本 spec 驗「testid 語意命中 + 靜態/動態雙路徑 +
// 巢狀 testid 去重 + 主文守衛」。data-testid 屬性翻譯不改 → translate-first Safari
//（Jimmy 實機）同樣命中，是本案真正修法路徑。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
);

const LONG = '這段是真正的主文內容，必須夠長以通過 hasLongMainParagraph 的 100 字門檻，'
  + 'so we keep adding words about Taiwan and policy to comfortably exceed one hundred characters here.';

// Substack recommendation footer：class 刻意全用 hash（模擬 emotion / pencraft），
// 只有 data-testid 帶語意——驗 keyword 軌必漏、testid 軌必中。
function widgetHtml() {
  return `
    <div data-testid="recommendation-footer" class="pencraft pc-display-flex pc-flexDirection-column pc-gap-20 pc-padding-32 border-top-detail-bzjFmN">
      <img class="pencraft pc-reset" alt="ChinaTalk" width="48" height="48" src="logo.jpeg">
      <h4 class="pencraft pc-reset font-aBcDeF">Recommend ChinaTalk to your readers</h4>
      <div class="pencraft pc-reset">Deep coverage of technology, China, US policy, and war.</div>
      <button class="pencraft pc-reset">Recommend</button>
    </div>`;
}

function buildEnv(withWidget) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><main id="wrap">
    <article id="art">
      <h1>WarTalk: The BS Détente</h1>
      <p id="b1">${LONG}</p>
      <p id="b2">${LONG}</p>
      ${withWidget ? widgetHtml() : ''}
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

describe('substack-recommendation-footer-widget — 結構 forcing', () => {
  it('必須宣告 hideRecommendationWidgetFrom + RECOMMENDATION_WIDGET_SEL（testid 訊號）', () => {
    assert.ok(/function\s+hideRecommendationWidgetFrom/.test(CLEANER_SRC));
    assert.ok(/RECOMMENDATION_WIDGET_SEL/.test(CLEANER_SRC));
    assert.ok(/data-testid\*=.?recommendation/.test(CLEANER_SRC),
      'selector 必須用 data-testid 含「recommendation」語意值（非 hostname / 單站 class）');
  });
  it('靜態 clean 與動態 observer 都使用此 helper（單一資料源）', () => {
    assert.ok(/safeRun\(hideRecommendationWidgets/.test(CLEANER_SRC), 'clean() 必須 safeRun 靜態 sweep');
    const dyn = CLEANER_SRC.match(/function\s+checkDynamicNoise[\s\S]*?\n  \}/)[0];
    assert.ok(/hideRecommendationWidgetFrom/.test(dyn), 'checkDynamicNoise 必須呼叫共用 helper（lazy 兜底）');
  });
});

describe('substack-recommendation-footer-widget — 行為', () => {
  it('靜態：clean 當下已存在的推薦卡整塊被 hide（class 全 hash、靠 testid 命中）', () => {
    const { doc, art, NS } = buildEnv(true);
    const widget = doc.querySelector('[data-testid="recommendation-footer"]');
    const hidden = NS.cleaner.clean(art);
    assert.strictEqual(widget.dataset.jreadHidden, '1',
      'data-testid="recommendation-footer" 推薦卡應整塊 hide');
    NS.cleaner.restore(hidden);
  });

  it('動態（核心）：lazy 注入的推薦卡經 observer 整塊被 hide', async () => {
    const { doc, art, NS } = buildEnv(false);
    const hidden = NS.cleaner.clean(art);
    const tmp = doc.createElement('div');
    tmp.innerHTML = widgetHtml();
    const widget = tmp.firstElementChild;
    art.appendChild(widget);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(widget.dataset.jreadHidden, '1',
      'lazy 注入的推薦卡必須經 checkDynamicNoise + hideRecommendationWidgetFrom 整塊 hide');
    NS.cleaner.restore(hidden);
  });

  it('守衛：主文長段不被誤殺（testid 只命中 widget 容器）', () => {
    const { doc, art, NS } = buildEnv(true);
    const hidden = NS.cleaner.clean(art);
    assert.notStrictEqual(doc.getElementById('b1').dataset.jreadHidden, '1', '主文段 b1 不可被 hide');
    assert.notStrictEqual(doc.getElementById('b2').dataset.jreadHidden, '1', '主文段 b2 不可被 hide');
    NS.cleaner.restore(hidden);
  });

  it('可逆：restore 後推薦卡的 inline display 還原', () => {
    const { doc, art, NS } = buildEnv(true);
    const widget = doc.querySelector('[data-testid="recommendation-footer"]');
    const hidden = NS.cleaner.clean(art);
    assert.strictEqual(widget.style.display, 'none');
    NS.cleaner.restore(hidden);
    assert.notStrictEqual(widget.dataset.jreadHidden, '1', 'restore 後 jreadHidden 標記應清除');
    assert.notStrictEqual(widget.style.display, 'none', 'restore 後 display 不應殘留 none');
  });
});
