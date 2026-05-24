// JRead — STRONG_NOISE_KEYWORD_RE 涵蓋 related/more/recommended 家族（v0.7.184）
//
// 對應 bug：udn section.related-news.more-news 內含推薦文章 100+ chars 摘要 p，
// 觸發 wrapperContainsMainContentP anchor guard，keyword rule 把它豁免 → 推薦區
// 殘留在 reader card 底部。
//
// 根因：related-news / more-news 在 NOISE_KEYWORD_RE 命中，但不在
// STRONG_NOISE_KEYWORD_RE——anchor guard 只對 non-strong keyword 生效。推薦
// 區 section 內含長 p（文章摘要），anchor guard 誤以為是主文 wrapper 保護。
//
// 修法：related/more/recommended 等「推薦/相關文章 section」命名家族加入
// STRONG_NOISE_KEYWORD_RE。主文 wrapper 絕不會命名為 related-news / more-news /
// recommended 等，safe to force-hide 即使內含長 p。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'udn-related-news-with-summaries.html');

describe('cleaner — related-news 含長摘要 p 不得因 anchor guard 豁免（v0.7.184）', () => {
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
    articleEl = document.querySelector('section.article-content__wrapper');
    assert.ok(articleEl, 'fixture 必須有 section.article-content__wrapper');
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  it('fixture 結構：related-news section 內含 >= 100 chars 摘要 p（觸發 anchor guard 前提）', () => {
    const relSec = document.querySelector('section.related-news');
    assert.ok(relSec, 'fixture 必須含 section.related-news');
    const paras = relSec.querySelectorAll('p');
    const hasLongP = Array.from(paras).some(p => p.textContent.trim().length >= 100);
    assert.ok(hasLongP, 'related-news 內必須有 >= 100 chars 摘要 p（重現 anchor guard 條件）');
  });

  it('section.related-news 必須被 hide（核心驗證點：strong keyword 跳過 anchor guard）', () => {
    const relSec = document.querySelector('section.related-news');
    assert.strictEqual(relSec.dataset.jreadHidden, '1',
      'section.related-news 命中 STRONG_NOISE_KEYWORD_RE 後必須跳過 wrapperContainsMainContentP guard 直接 hide');
  });

  it('section.more-news（無 related-news class）也必須被 hide', () => {
    const moreSections = document.querySelectorAll('section.more-news');
    for (const sec of moreSections) {
      assert.strictEqual(sec.dataset.jreadHidden, '1',
        `section class="${sec.className}" 必須被 hide`);
    }
  });

  it('主文 article.article-content 保留', () => {
    const art = document.querySelector('article.article-content');
    assert.ok(art, 'fixture 必須含 article.article-content');
    assert.notStrictEqual(art.dataset.jreadHidden, '1', '主文不可被 hide');
  });

  it('主文內 p 保留', () => {
    const art = document.querySelector('article.article-content');
    const paras = art.querySelectorAll('p');
    for (const p of paras) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1', `主文 p 不可被 hide: "${p.textContent.slice(0, 30)}…"`);
    }
  });

  it('sponsor-ads section 被 hide', () => {
    const sponsor = document.querySelector('section.sponsor-ads');
    assert.ok(sponsor);
    assert.strictEqual(sponsor.dataset.jreadHidden, '1');
  });

  it('discuss-board section 被 hide', () => {
    const discuss = document.querySelector('section.discuss-board');
    assert.ok(discuss);
    assert.strictEqual(discuss.dataset.jreadHidden, '1');
  });
});
