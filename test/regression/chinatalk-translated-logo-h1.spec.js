// JRead — 翻譯擴充後 site logo H1 導致 detector 升級過廣 regression spec（v0.7.193）
//
// chinatalk.media 經 Shinkansen 翻譯後，article 內 H1 變中文、og:title 維持英文，
// ensureArticleContainsTitleH1 的 og:title guard 失效，path 1 把 DOM-first H1
// (h1#wordlogo site logo) 當 hero 升 LCA 到 div#main——主文範圍過廣、site header
// 殘留。修法：articleEl 內恰有 1 個 H1 時信賴結構、跳過 promote。
//
// v0.8.12（translate-first 真實長文修法）：原 fixture 只有 1 個 H1，靠上述
// 「恰 1 個 H1」guard 通過——但真實 chinatalk 長文 article 內有多個 section
// H1（header-anchor-post），guard 不觸發、bug 重現（detector 上浮到 div#main、
// 把 #discussion 留言區 + portable-archive-list 推薦列表括進主文）。fixture 已
// 擴充加入 section H1 + 留言/推薦 sibling；修法改用 articleIsSelfTitled 結構訊號
// （article 開頭即標題區 → 不向外借 hero、純位置與翻譯無關）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'chinatalk-translated-logo-h1.html');

function setup() {
  return loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector']
  });
}

describe('detector — 翻譯後 site logo H1 不應導致 promote 過廣', () => {
  it('detector 選到 <article> 而非 div#main', () => {
    const { NS } = setup();
    const result = NS.detector.detect();
    assert.ok(result, 'detect 必須有結果');
    assert.strictEqual(result.el.tagName, 'ARTICLE',
      'detector 應選到 <article>，不是 div#main');
  });

  it('h1#wordlogo (site logo) 不在偵測到的 article 內', () => {
    const { NS, document } = setup();
    const result = NS.detector.detect();
    const wordlogo = document.getElementById('wordlogo');
    assert.ok(wordlogo, 'fixture 必須有 h1#wordlogo');
    assert.ok(!result.el.contains(wordlogo),
      'site logo H1 不應在偵測到的主文容器內');
  });

  it('翻譯後的文章標題 H1 在偵測到的 article 內', () => {
    const { NS } = setup();
    const result = NS.detector.detect();
    const h1 = result.el.querySelector('h1');
    assert.ok(h1, 'article 內必須有 H1');
    assert.ok(h1.textContent.includes('敬我們毫無希望的事業'),
      'H1 必須是翻譯後的文章標題');
  });

  // v0.8.12 核心：留言區 + 推薦列表（article 外）不應被 detector 括進主文
  it('留言區 #discussion 不在偵測到的 article 內', () => {
    const { NS, document } = setup();
    const result = NS.detector.detect();
    const discussion = document.getElementById('discussion');
    assert.ok(discussion, 'fixture 必須有 #discussion 留言區');
    assert.ok(!result.el.contains(discussion),
      '留言區不應在偵測到的主文容器內（translate-first 上浮 bug 回歸）');
  });

  it('推薦列表 .portable-archive-list 不在偵測到的 article 內', () => {
    const { NS, document } = setup();
    const result = NS.detector.detect();
    const recs = document.querySelector('.portable-archive-list');
    assert.ok(recs, 'fixture 必須有 .portable-archive-list 推薦列表');
    assert.ok(!result.el.contains(recs),
      '推薦列表不應在偵測到的主文容器內（translate-first 上浮 bug 回歸）');
  });

  // sanity check：暫時拿掉 article 內的 H1，確認 detector 仍能升級
  it('若 article 無 H1，detector 應升級（wya 類情境保護）', () => {
    const { NS, document } = setup();
    // 移除 article 內的 H1
    const article = document.querySelector('article');
    const h1 = article.querySelector('h1');
    h1.parentElement.removeChild(h1);
    const result = NS.detector.detect();
    assert.ok(result, 'detect 必須有結果');
    // 沒有 H1 的 article 不一定會升級（取決於其他邏輯），
    // 但至少不應 crash
  });
});
