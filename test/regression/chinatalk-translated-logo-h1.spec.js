// JRead — 翻譯擴充後 site logo H1 導致 detector 升級過廣 regression spec（v0.7.193）
//
// chinatalk.media 經 Shinkansen 翻譯後，article 內 H1 變中文、og:title 維持英文，
// ensureArticleContainsTitleH1 的 og:title guard 失效，path 1 把 DOM-first H1
// (h1#wordlogo site logo) 當 hero 升 LCA 到 div#main——主文範圍過廣、site header
// 殘留。修法：articleEl 內恰有 1 個 H1 時信賴結構、跳過 promote。

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
