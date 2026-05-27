// JRead — regression spec: thenewslens.com 會員 CTA + 相關議題殘留
//
// 2026-05-27 probe 發現四種雜訊未被 cleaner 清除：
//   1. <a>立刻點擊免費加入會員！</a> — NOISE_LINK_TEXT_RE「加入…會員」
//   2. <p>【加入關鍵評論網會員】…</p> — CTA_PROMO_P_RE 升級 hide
//   3. <span>…的相關議題</span> — NOISE_HEADING_TEXT_RE「相關議題」
//   4. <h2>新聞來源</h2> — NOISE_HEADING_TEXT_RE「新聞來源」
//
// Forcing functions:
//   (a) CTA <a> 或其父層 P 被 hide
//   (b) CTA 父層 P（含「加入…會員」）被 hide
//   (c) 「相關議題」span 或其祖先 section 被 hide
//   (d) H2「新聞來源」被 hide
//   (e) 主文 <p> 保留（sanity）
//   (f) H1 標題保留（sanity）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'thenewslens-member-related.html');

describe('cleaner — thenewslens.com 會員 CTA + 相關議題殘留', () => {
  let window, document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('main.article-page-wrapper');
    assert.ok(articleEl, 'fixture 必須有 main.article-page-wrapper');
    window.__JRead.cleaner.clean(articleEl);
  });

  /** 輔助：el 本身或任一祖先（到 articleEl 為止）被 hide */
  function isHiddenOrAncestorHidden(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') return true;
      cur = cur.parentElement;
    }
    return false;
  }

  it('(a) CTA <a>「加入會員」或其父層被 hide', () => {
    const links = articleEl.querySelectorAll('a');
    let ctaLink = null;
    for (const a of links) {
      if (a.textContent.includes('加入會員')) { ctaLink = a; break; }
    }
    assert.ok(ctaLink, 'fixture 必須有含「加入會員」的 <a>');
    assert.ok(isHiddenOrAncestorHidden(ctaLink),
      '<a>「立刻點擊免費加入會員！」或其父層 P 必須被 hide（NOISE_LINK_TEXT_RE / CTA_PROMO_P_RE）');
  });

  it('(b) CTA 父層 P（含「加入關鍵評論網會員」）被 hide', () => {
    const paragraphs = articleEl.querySelectorAll('p.ck-section');
    let ctaP = null;
    for (const p of paragraphs) {
      if (p.textContent.includes('加入關鍵評論網會員')) { ctaP = p; break; }
    }
    assert.ok(ctaP, 'fixture 必須有含「加入關鍵評論網會員」的 <p>');
    assert.ok(isHiddenOrAncestorHidden(ctaP),
      'P「【加入關鍵評論網會員】…」必須被 hide（CTA_PROMO_P_RE 升級整段 P）');
  });

  it('(c)「相關議題」span 或其祖先 section 被 hide', () => {
    const spans = articleEl.querySelectorAll('.section-title span');
    let relatedSpan = null;
    for (const s of spans) {
      if (s.textContent.includes('相關議題')) { relatedSpan = s; break; }
    }
    assert.ok(relatedSpan, 'fixture 必須有含「相關議題」的 <span>');
    assert.ok(isHiddenOrAncestorHidden(relatedSpan),
      '「相關議題」span 或其祖先 section 必須被 hide（NOISE_HEADING_TEXT_RE「相關議題」）');
  });

  it('(d) H2「新聞來源」被 hide', () => {
    const h2 = articleEl.querySelector('h2.paragraph-title');
    assert.ok(h2, 'fixture 必須有 H2.paragraph-title');
    assert.ok(isHiddenOrAncestorHidden(h2),
      'H2「新聞來源」必須被 hide（NOISE_HEADING_TEXT_RE「新聞來源」）');
  });

  it('(e) 主文 <p>（含 MAIN_MARK）保留', () => {
    const paragraphs = articleEl.querySelectorAll('p.ck-section');
    let preserved = 0;
    for (const p of paragraphs) {
      if (p.textContent.includes('MAIN_MARK') && !isHiddenOrAncestorHidden(p)) {
        preserved++;
      }
    }
    assert.ok(preserved >= 3,
      `至少 3 段含 MAIN_MARK 的主文 <p> 必須保留（實際保留 ${preserved} 段）`);
  });

  it('(f) H1 標題保留', () => {
    const h1 = articleEl.querySelector('h1');
    assert.ok(h1, 'fixture 必須有 H1');
    assert.ok(!isHiddenOrAncestorHidden(h1),
      'H1 標題不可被 hide');
  });
});
