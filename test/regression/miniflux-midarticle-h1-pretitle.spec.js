// JRead — hideInsideArticlePreTitleNoise：anchor h1 前已有主文長段落時中止（v0.8.168）
//
// 對應 bug（Jimmy 2026-06-23 回報，Miniflux entry「擲彈訓練所:第一次投擲」）：
// reader mode 後文章標題與開頭兩三段正文（byline + 502 chars）全部消失。
//
// 根因：Miniflux/RSS reader 把 feed body（article.entry-content）當 articleEl，
// 文章真標題在 feed 容器外（Miniflux .entry-title）。feed body 內第一個 h1 是
// 「中段章節標題」，hideInsideArticlePreTitleNoise 誤把它當領頭標題、依「標題前
// 皆雜訊」通則把它前面的 byline + 開頭段落全 hide。
//
// 修法：結構性 guard——anchor h1 之前（DOM order）若已有主文長段落
// （mainContentPrecedesAnchor，門檻沿用 wrapperContainsMainContentP 的
// 單一 p >= 100 / 累計 >= 300），代表這個 h1 不是領頭標題而是章節標題，
// 整條 pre-title 隱藏中止。非站點 / class 特判（硬規則 3）。
//
// 本 spec 驗 clean() 後 DOM 的 jreadHidden 狀態（jsdom 層）；真實 Chrome 的
// 視覺由 /harness-verify 的 page-rounds + probe 覆蓋。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'miniflux-midarticle-h1-pretitle.html');

function loadEnv() {
  return loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1000, height: 800 },
    pretendToBeVisual: true
  });
}

describe('cleaner — pre-title 中止：anchor h1 前有主文長段落（v0.8.168 Miniflux）', () => {
  let document;

  before(() => {
    const env = loadEnv();
    document = env.document;
    const articleEl = document.querySelector('[data-test="article-root"]');
    assert.ok(articleEl);
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('byline 不被當 pre-title 雜訊 hide', () => {
    const byline = document.querySelector('[data-test="byline"]');
    assert.notStrictEqual(byline.dataset.jreadHidden, '1',
      'anchor h1 是中段章節標題、其前已有主文長段落 → pre-title 規則應中止，byline 保留');
  });

  it('開頭兩段正文保留', () => {
    for (const sel of ['[data-test="lead-para"]', '[data-test="second-para"]']) {
      assert.notStrictEqual(document.querySelector(sel).dataset.jreadHidden, '1',
        `${sel} 是 anchor h1 之前的開頭正文，不可被誤殺`);
    }
  });

  it('開頭的 hero / 中段圖保留', () => {
    assert.notStrictEqual(document.querySelector('[data-test="hero"]').dataset.jreadHidden, '1');
    assert.notStrictEqual(document.querySelector('[data-test="mid-img"]').dataset.jreadHidden, '1');
  });

  it('中段章節 h1 與其後段落保留', () => {
    assert.notStrictEqual(document.querySelector('[data-test="section-h1"]').dataset.jreadHidden, '1');
    assert.notStrictEqual(document.querySelector('[data-test="after-h1"]').dataset.jreadHidden, '1');
  });
});

// 同一份 Miniflux fixture 也驗標題 promote（v0.8.168 第二條修法）：
// promoteUniqueTitleH1Into 原本 gate「全頁剛好 1 個 h1」，這頁有 2 個 h1
// （feed 容器外 .entry-title + feed body 內中段章節 h1）→ 原本 bail、標題進不了
// reader card。新路徑：多 h1 時取 articleEl 外唯一 strict-match document.title 的
// h1 promote。
describe('cleaner — Miniflux 多 h1 時 promote 外層 entry-title（v0.8.168）', () => {
  let document, articleEl;

  before(() => {
    const env = loadEnv();
    document = env.document;
    articleEl = document.querySelector('[data-test="article-root"]');
    env.window.__JRead.cleaner.clean(articleEl, []);
  });

  it('title clone 存在且含 entry-title 文字（即使全頁有 2 個 h1）', () => {
    const clone = articleEl.querySelector('[data-jread-title-clone="1"]');
    assert.ok(clone, '多 h1 場景下仍應 promote 外層 entry-title 進 reader card');
    assert.ok(clone.textContent.includes('第一次投擲'),
      `title clone 應含主標題文字，實際: "${clone.textContent.trim().slice(0, 40)}"`);
  });

  it('title clone 不可誤選 article 內的中段章節 h1', () => {
    const clone = articleEl.querySelector('[data-jread-title-clone="1"]');
    assert.ok(!clone.textContent.includes('在極廣的懸吊行程'),
      'strict-match document.title 應只選到 entry-title、不選中段章節 h1');
  });
});
