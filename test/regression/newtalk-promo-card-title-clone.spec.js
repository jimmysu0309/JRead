// JRead — newtalk promo card 誤 clone 進 articleEl regression（v0.7.172）
//
// 對應 bug：newtalk.tw 文章頁進入閱讀模式後，文章開頭出現不相關的推薦
// 新聞圖片和連結（「李四川」相關新聞），不是本文內容。
//
// 根因：promoteArticleTitleClassHeadingInto 找到外部推薦新聞的
// <h3 class="title">——class="title" 命中 TITLE_CLASS_HIT_RE 的
// standalone `title` pattern。但該 h3 在 <a class="trackNewsGA4"> 內
// （推薦卡片連結），不是獨立的文章標題。clone wrapper = <a> + <img> +
// 不相關標題文字整包 prepend 進 articleEl，造成開頭出現亂七八糟的內容。
//
// 修法：promoteArticleTitleClassHeadingInto 改用 TITLE_CLASS_STRICT_RE（只接受
// 複合 token 如 article-title / post-title / wp-block-post-title），不接受
// bare class="title"。bare "title" 太泛——newtalk.tw 的推薦卡片 h3、閒置
// 提醒 dialog h2 都用 class="title"，全部誤命中。
//
// 本 spec 是 forcing function：
//   - 外部 <a> 內的 <h3 class="title"> 不可被 promote 進 articleEl
//   - articleEl 內不可出現 data-jread-title-clone="1"
//   - 主文內容（news_content）必須完整保留

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'newtalk-promo-card-title-clone.html');

describe('cleaner — newtalk promo card <h3 class="title"> 在 <a> 內不可被 title-clone 進 articleEl（v0.7.172）', () => {
  let window, document, articleEl, hidden;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('.left_column');
    hidden = [];
    window.__JRead.cleaner.clean(articleEl, hidden);
  });

  it('articleEl 內不可出現 data-jread-title-clone="1"', () => {
    const clones = articleEl.querySelectorAll('[data-jread-title-clone="1"]');
    assert.strictEqual(clones.length, 0,
      `articleEl 內不應有 title clone，但找到 ${clones.length} 個`);
  });

  it('外部 <a> 內的 <h3 class="title"> 不可被 clone 進 articleEl', () => {
    const allH3 = articleEl.querySelectorAll('h3.title');
    for (const h3 of allH3) {
      const text = h3.textContent.trim();
      assert.ok(!text.includes('李四川'),
        `articleEl 內不應出現推薦新聞標題「李四川」，但找到: "${text}"`);
    }
  });

  it('主文段落必須完整保留', () => {
    const ps = articleEl.querySelectorAll('.news_content p');
    let visibleCount = 0;
    for (const p of ps) {
      if (p.getAttribute('data-jread-hidden') !== '1') visibleCount++;
    }
    assert.ok(visibleCount >= 4,
      `news_content 內應有 >= 4 個 visible <p>，實際 ${visibleCount}`);
  });

  it('文章標題 p.name 必須保留', () => {
    const titleP = articleEl.querySelector('p.name');
    assert.ok(titleP, 'p.name 標題元素必須存在');
    assert.ok(titleP.textContent.includes('川普'),
      `標題應含「川普」，實際: "${titleP.textContent.trim().substring(0, 40)}"`);
  });

  it('閒置 dialog 的 <h2 class="title"> 不可被 clone 進 articleEl', () => {
    const allH2 = articleEl.querySelectorAll('h2');
    for (const h2 of allH2) {
      const text = h2.textContent.trim();
      assert.ok(!text.includes('閒置'),
        `articleEl 內不應出現閒置提醒，但找到: "${text}"`);
    }
  });
});
