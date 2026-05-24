// JRead — hideInsideArticleSidebarColumns 條件 D：分類標籤微型欄
// （v0.7.178）
//
// 對應 bug：CNN reader mode 開啟後，標題左側殘留分類標籤「News」。
// 原頁結構：HEADER 內 flex row 並排兩欄——opinion-column（P "News"，
// textLen 4）+ title-and-dek-column（H1 + subtitle，textLen 278）。
// 既有條件 A/B/C 全漏：
//   - main.textLen 278 < 500 門檻 → 整個 container 被 skip
//   - 即使放寬，linkDensity = 0（label 無 link）→ A/C 不命中
//   - 非 aside tag → B 不命中
//
// 修法：加條件 D pass——容器內至少一個 child 含 heading（h1-h4）且
// textLen ≥ 50 時，textLen ≤ 30 的 sibling 視為分類標籤微型欄 hide。
// guards：promotedTitleHead / canonicalTitle / <time> / byline / heading。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'category-label-micro-column.html');

describe('cleaner — hideInsideArticleSidebarColumns 條件 D：分類標籤微型欄（v0.7.178）', () => {
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
    articleEl = document.querySelector('[data-test="article-root"]');
    assert.ok(articleEl);
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  it('fixture 結構：category-column textLen ≤ 30 且 title-column 含 h1 且 textLen ≥ 50', () => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const catCol = document.querySelector('[data-test="category-column"]');
    const titleCol = document.querySelector('[data-test="title-column"]');
    assert.ok(norm(catCol.textContent).length <= 30,
      'category column textLen <= 30');
    assert.ok(norm(titleCol.textContent).length >= 50,
      'title column textLen >= 50');
    assert.ok(titleCol.querySelector('h1'),
      'title column 含 h1');
  });

  it('category-column（"News" label）被 hide（條件 D 核心驗證點）', () => {
    const catCol = document.querySelector('[data-test="category-column"]');
    assert.strictEqual(catCol.dataset.jreadHidden, '1',
      '分類標籤微型欄（textLen ≤ 30、兄弟含 heading）應被條件 D hide。' +
      '否則新聞站 kicker / eyebrow label 殘留在 reader mode。');
  });

  it('title-column（含 h1 + subtitle）不可被 hide', () => {
    const titleCol = document.querySelector('[data-test="title-column"]');
    assert.notStrictEqual(titleCol.dataset.jreadHidden, '1');
  });

  it('h1 自身不可被 hide', () => {
    const h1 = document.querySelector('h1');
    assert.notStrictEqual(h1.dataset.jreadHidden, '1');
  });

  it('主文段落保留', () => {
    const mainContent = document.querySelector('[data-test="main-content"]');
    assert.notStrictEqual(mainContent.dataset.jreadHidden, '1');
    const paras = mainContent.querySelectorAll('p');
    for (const p of paras) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });
});

describe('cleaner — 條件 D guards：不誤殺含 <time> / byline / heading 的短 sibling', () => {
  it('含 <time> 的短 sibling 不被 hide', () => {
    const env = loadFixtureWithScripts({
      fixturePath: path.join(__dirname, 'fixtures', 'category-label-time-guard.html'),
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    const root = env.document.getElementById('root');
    env.window.__JRead.cleaner.clean(root);
    const dateCol = env.document.getElementById('date-col');
    assert.notStrictEqual(dateCol.dataset.jreadHidden, '1',
      '含 <time> 的短 sibling 應被 time guard 保護');
  });

  it('自身含 heading 的短 sibling 不被 hide', () => {
    const env = loadFixtureWithScripts({
      fixturePath: path.join(__dirname, 'fixtures', 'category-label-heading-guard.html'),
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    const root = env.document.getElementById('root');
    env.window.__JRead.cleaner.clean(root);
    const sectionH = env.document.getElementById('section-heading');
    assert.notStrictEqual(sectionH.dataset.jreadHidden, '1',
      '含 heading 的短 sibling 應被 heading guard 保護');
  });
});
