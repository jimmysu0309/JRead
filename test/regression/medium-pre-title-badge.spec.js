// JRead — hideInsideArticlePreTitleNoise：標題前導雜訊通則（v0.8.51）
//
// 對應 bug：Medium 付費牆文章 reader mode 後，標題上方殘留「Member-only
// story」徽章（Shinkansen 翻譯後顯示「會員限定故事 / 會員專屬內容」等）。
// 徽章 <p> 住在無 class <div>、是 h1 容器的前一個兄弟分支：
//   - class 全 emotion hash → keyword / class 軌不可行
//   - 文字隨 UI 語系與翻譯擴充變動 → 文字軌不穩
//   - 舊版徽章包在 role="tooltip"（hideDialogs 清），改版後裸 <p> miss
//
// 修法：結構性通則——reader card 的版面契約是「主文標題是第一個內容」，
// 從第一個可見 h1 往 articleEl 爬，每層 preceding sibling 都視為前導雜訊
// hide。兩道 guard：分支含主文長段落（wrapperContainsMainContentP）或內容
// 媒體（hasUnhiddenContentMedia）→ 不動。
//
// 本 spec 驗：
//   這條驗「clean() 後 DOM 標記與 display 狀態」（jsdom 層）；不驗真實
//   Chrome 的視覺 layout / gap（那層由 /harness-verify 的 RESIDUAL AUDIT
//   + fullpage 截圖覆蓋）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'medium-pre-title-badge.html');

function loadEnv() {
  return loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1000, height: 800 },
    pretendToBeVisual: true
  });
}

describe('cleaner — hideInsideArticlePreTitleNoise 標題前導雜訊（v0.8.51）', () => {
  let document, badgeBranch, emptyBranch;

  before(() => {
    const env = loadEnv();
    document = env.document;
    const articleEl = document.querySelector('[data-test="article-root"]');
    assert.ok(articleEl);
    env.window.__JRead.cleaner.clean(articleEl);
    badgeBranch = document.querySelector('[data-test="badge-branch"]');
    emptyBranch = document.querySelector('[data-test="empty-pre-branch"]');
  });

  it('會員徽章分支（h1 容器的 preceding sibling）被 hide', () => {
    assert.strictEqual(badgeBranch.dataset.jreadHidden, '1',
      '標題前的徽章分支應被前導雜訊通則 hide，否則 Medium 付費牆' +
      '「Member-only story」徽章殘留在標題上方');
    assert.strictEqual(badgeBranch.style.getPropertyValue('display'), 'none');
    assert.strictEqual(badgeBranch.style.getPropertyPriority('display'), 'important',
      'hide() 必須用 inline !important（硬教訓：stylesheet 軌會輸給原站高 specificity）');
  });

  it('標題前的空 wrapper 分支也被 hide', () => {
    assert.strictEqual(emptyBranch.dataset.jreadHidden, '1');
  });

  it('h1 與標題容器不可被 hide', () => {
    const h1 = document.querySelector('[data-test="main-h1"]');
    const titleBranch = document.querySelector('[data-test="title-branch"]');
    assert.notStrictEqual(h1.dataset.jreadHidden, '1');
    assert.notStrictEqual(titleBranch.dataset.jreadHidden, '1');
  });

  it('副標與主文段落保留', () => {
    assert.notStrictEqual(
      document.querySelector('[data-test="subtitle"]').dataset.jreadHidden, '1');
    const mainContent = document.querySelector('[data-test="main-content"]');
    assert.notStrictEqual(mainContent.dataset.jreadHidden, '1');
    for (const p of mainContent.querySelectorAll('p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });
});

describe('cleaner — hideInsideArticlePreTitleNoise guards：不誤殺標題前正當內容', () => {
  it('media guard：標題前含 hero 圖的分支不被 hide', () => {
    const env = loadEnv();
    const articleEl = env.document.querySelector('[data-test="article-root-media"]');
    // jsdom 不載圖（rect 0×0、naturalWidth 0），imgIsContentMedia 的 rect /
    // natural 軌全 miss——stub rect 模擬真實 Chrome 已 layout 的 hero 圖
    stubRect(env.document.querySelector('[data-test="pre-title-hero"] img'),
      { top: 0, width: 600, height: 400 });
    env.window.__JRead.cleaner.clean(articleEl);
    const hero = env.document.querySelector('[data-test="pre-title-hero"]');
    assert.notStrictEqual(hero.dataset.jreadHidden, '1',
      '標題前含內容媒體（hero 圖）的分支應被 hasUnhiddenContentMedia guard 保護');
  });

  it('long-p guard：標題前含主文長段落的分支不被 hide', () => {
    const env = loadEnv();
    const articleEl = env.document.querySelector('[data-test="article-root-longp"]');
    env.window.__JRead.cleaner.clean(articleEl);
    const longp = env.document.querySelector('[data-test="pre-title-longp"]');
    assert.notStrictEqual(longp.dataset.jreadHidden, '1',
      '標題前含 >= 100 chars 段落的分支應被 wrapperContainsMainContentP guard 保護');
  });
});
