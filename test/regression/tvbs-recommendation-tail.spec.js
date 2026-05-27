// JRead — TVBS 文末推薦區塊 + Google News CTA regression spec（v0.7.205）
//
// 對應 fixture：test/regression/fixtures/tvbs-recommendation-tail.html
// 2026-05-27 Page Rounds 報告：news.tvbs.com.tw FAIL（中等）
//   (1) "你可能會喜歡" 推薦區塊殘留
//   (2) "人氣點閱榜" 推薦區塊殘留
//   (3) "其他人都在看" 推薦區塊殘留
//   (4) "在 Google 新聞上關注 TVBS" CTA 殘留
//
// 根因：NOISE_HEADING_TEXT_RE 缺少變體 pattern。
// 修法：擴充 regex alternation + 新增中文 Google News CTA pattern。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'tvbs-recommendation-tail.html');

function isHiddenOrAncestorHidden(el) {
  let cur = el;
  while (cur && cur !== cur.ownerDocument.body) {
    if (cur.dataset && cur.dataset.jreadHidden === '1') return true;
    cur = cur.parentElement;
  }
  return false;
}

describe('cleaner — TVBS 文末推薦 + Google News CTA 殘留修正（v0.7.205）', () => {
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
    const detected = window.__JRead.detector.detect();
    assert.ok(detected && detected.el, 'detector 應命中 fixture 內的 <article>');
    articleEl = detected.el;
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  it('主文 p 段落保留（cleaner 不可誤殺主文）', () => {
    const contentDiv = document.getElementById('news_detail_div');
    assert.ok(contentDiv);
    const ps = contentDiv.querySelectorAll('p');
    let longPCount = 0;
    for (const p of ps) {
      const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 50 && !isHiddenOrAncestorHidden(p)) longPCount++;
    }
    assert.ok(longPCount >= 2,
      '至少 2 段 >= 50 chars 的主文 p 必須保留');
  });

  it('Case 1: "你可能會喜歡" 推薦區塊被 hide', () => {
    const ranks = document.querySelectorAll('.article_rank');
    assert.ok(ranks.length >= 1, 'fixture 應有 .article_rank');
    const firstRank = ranks[0];
    const p = firstRank.querySelector('p');
    assert.ok(p && p.textContent.includes('你可能會喜歡'));
    assert.ok(isHiddenOrAncestorHidden(firstRank),
      '"你可能會喜歡" DIV.article_rank 必須被 hide；' +
      'forcing：NOISE_HEADING_TEXT_RE `你可能(也)?` 不匹配 "會" → 改 `(也|會)?`');
  });

  it('Case 2: "人氣點閱榜" 推薦區塊被 hide', () => {
    const ranks = document.querySelectorAll('.article_rank');
    assert.ok(ranks.length >= 2, 'fixture 應有 2 個 .article_rank');
    const secondRank = ranks[1];
    const p = secondRank.querySelector('p');
    assert.ok(p && p.textContent.includes('人氣點閱榜'));
    assert.ok(isHiddenOrAncestorHidden(secondRank),
      '"人氣點閱榜" DIV.article_rank 必須被 hide；' +
      'forcing：NOISE_HEADING_TEXT_RE 缺 `人氣(精選|點閱榜|排行榜|推薦)` pattern');
  });

  it('Case 3: "其他人都在看" 推薦區塊被 hide', () => {
    const titleDivs = document.querySelectorAll('.article_new > .title_div');
    assert.ok(titleDivs.length >= 1, 'fixture 應有 .article_new > .title_div');
    const otherPeople = titleDivs[0];
    const p = otherPeople.querySelector('p');
    assert.ok(p && p.textContent.includes('其他人都在看'));
    assert.ok(isHiddenOrAncestorHidden(otherPeople),
      '"其他人都在看" DIV.title_div 必須被 hide；' +
      'forcing：`其他人也看` 不匹配 "其他人都在看" → 改 `其他人.{0,3}看`');
  });

  it('Case 4: "在 Google 新聞上關注 TVBS" CTA 被 hide', () => {
    const guangxuan = document.querySelector('.guangxuan');
    assert.ok(guangxuan, 'fixture 應有 .guangxuan');
    assert.ok(isHiddenOrAncestorHidden(guangxuan),
      '"在 Google 新聞上關注 TVBS" DIV.guangxuan 必須被 hide；' +
      'forcing：STRONG direct text 命中新增 `在...Google...新聞...關注` heading text pattern，' +
      'walk-up 到 DIV.guangxuan 停（parent article_content 含主文長 p）');
  });

  it('sanity: hidden array 不為空', () => {
    assert.ok(hidden.length > 0, 'cleaner 應有 hide 動作');
  });
});
