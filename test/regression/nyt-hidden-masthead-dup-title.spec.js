// JRead — 隱形標題副本不得成為注入來源 regression（v0.8.55）
//
// 對應 bug（Jimmy 2026-06-12 回報 nytimes，Shinkansen translate-first）：
//   翻譯後進閱讀模式出現兩顆標題——上方 sans-serif 英文注入標題（隨後被
//   Shinkansen content guard 譯成另一版中文）+ 下方站方真標題（已翻中文）。
//
// 根因鏈：
//   1. 站方 sticky masthead 留有「當前文章標題」隱形副本（visibility:hidden
//      + opacity≈0，捲動後才顯示）；翻譯擴充只翻可見文字 → 副本維持英文
//   2. markPromotedTitleIfMissing 的 heading guard 拿英文 og:title 比對已翻
//      中文的真 h1 → 不 match → 不收手
//   3. bestCand 掃 p/div/span 命中這顆英文隱形副本 → 注入英文 H1 → 重複標題
//
// 修法（結構性通則）：bestCand 候選必須「視覺上有呈現」（自身 + 祖先鏈無
// display:none / visibility:hidden|collapse / opacity≈0）。注入的存在理由是
// 「站方以非 heading 元素呈現標題」，隱形元素不構成呈現。translate-first
// 兩側閉環：可見副本必然已被翻譯（不 match 英文 og:title 自然落選）、隱形
// 副本被本 guard 排除。
//
// 本 spec 是 forcing function：
//   - 隱形 masthead 副本存在 + 真 h1 已翻譯時，不得注入（不產重複標題）
//   - 正向 control：同結構但副本可見（模擬站方真以非 heading 呈現標題）
//     時，注入照常運作（guard 只擋隱形、不弱化 newtalk 類修法）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'nyt-hidden-masthead-dup-title.html');

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1280, height: 900 },
    pretendToBeVisual: true
  });
  const articleEl = env.document.querySelector('main');
  articleEl.setAttribute('data-jread-active', '1');
  return { ...env, articleEl };
}

describe('detector — 隱形標題副本不得成為注入來源（v0.8.55 nytimes translate-first）', () => {
  it('真 h1 已翻譯 + masthead 隱形英文副本存在時，不得注入重複標題', () => {
    const { document, NS, articleEl } = setup();
    NS.cleaner.clean(articleEl, []);
    NS.detector.markPromotedTitleIfMissing(articleEl);

    const injected = document.querySelector('[data-jread-injected-title="1"]');
    assert.strictEqual(injected, null,
      `不得從隱形 masthead 副本注入標題，實際注入了: "${injected && injected.textContent.slice(0, 50)}"`);

    // 真標題維持唯一可見標題
    const headline = document.querySelector('h1[data-testid="headline"]');
    assert.ok(headline, '真標題 h1 必須存在');
    assert.strictEqual(headline.style.display === 'none', false, '真標題不得被誤 hide');
  });

  it('正向 control：副本可見時注入照常運作（guard 只擋隱形呈現）', () => {
    const { document, NS, articleEl } = setup();
    // 模擬「站方真的以非 heading 元素呈現標題」：masthead 改為可見、
    // 並移除真 h1（newtalk 類站型——標題不在 heading tag 上）
    const masthead = document.querySelector('#in-story-masthead');
    masthead.style.removeProperty('visibility');
    masthead.style.removeProperty('opacity');
    masthead.style.removeProperty('position');
    document.querySelector('h1[data-testid="headline"]').remove();

    NS.cleaner.clean(articleEl, []);
    NS.detector.markPromotedTitleIfMissing(articleEl);

    const injected = document.querySelector('[data-jread-injected-title="1"]');
    assert.ok(injected, '可見的非 heading 標題載體必須照常觸發注入（不可弱化既有修法）');
    assert.ok(injected.textContent.includes('Laughing Well Is the Best Revenge'),
      `注入標題文字不對: "${injected.textContent.slice(0, 50)}"`);
  });
});
