// JRead — Page Rounds v2 七站 C2 FAIL regression spec（v0.7.190）
//
// 對應 fixture：test/regression/fixtures/page-rounds-c2-tail-cta.html
// 2026-05-25 Page Rounds 報告：31 站中 7 站 C2 FAIL，全為文末推薦/訂閱/CTA
// 區塊殘留。共通模式：heading 文字特徵明確（Subscribe / Newsletter / Don't
// miss / 延伸閱讀 / Help improve），可透過 NOISE_HEADING_TEXT_RE 批次加
// pattern + 新增 CTA 段落掃描修正。
//
// 修法（v0.7.190）：
//   1. NOISE_HEADING_MAX_LEN 20→40
//   2. NOISE_HEADING_TEXT_RE 新增 5 個 pattern
//   3. divSpanCandidates 加 strong/em/b（upmedia.mg STRONG 延伸閱讀）
//   4. 新函式 hideInsideArticleCTAParagraphs（BBC CTA 段落）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'page-rounds-c2-tail-cta.html');

describe('cleaner — Page Rounds C2 FAIL 文末 CTA 殘留修正（v0.7.190）', () => {
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
    const ps = articleEl.querySelectorAll(':scope > p');
    let longPCount = 0;
    for (const p of ps) {
      const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 100 && p.dataset.jreadHidden !== '1') longPCount++;
    }
    assert.ok(longPCount >= 2,
      '至少 2 段 >= 100 chars 的主文 p 必須保留（非 hidden）');
  });

  // Case 1: chinatalk.media — H4 "Subscribe to ChinaTalk" (24 chars)
  it('Case 1: H4 "Subscribe to ChinaTalk" 訂閱區塊被 hide（^subscribe\\b 放寬 + max_len 40）', () => {
    const section = document.querySelector('.subscribe-section-1');
    assert.ok(section);
    let cur = section, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden,
      '.subscribe-section-1 包 H4 "Subscribe to ChinaTalk"（24 chars）必須被 hide；' +
      'forcing：(a) ^subscribe$ 不匹配帶後綴的 heading → 改 ^subscribe\\b，' +
      '(b) max_len 20 過濾 24 chars → 改 40');
  });

  // Case 2: stratechery.com — heading "Articles and Updates"
  it('Case 2: H3 "Stratechery Articles and Updates" 推薦彙整被 hide（\\barticles? and updates?\\b）', () => {
    const section = document.querySelector('.promo-section-2');
    assert.ok(section);
    let cur = section, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden,
      '.promo-section-2 包 H3 "Stratechery Articles and Updates"（35 chars）必須被 hide；' +
      'forcing：(a) NOISE_HEADING_TEXT_RE 缺 articles and updates pattern → 加，' +
      '(b) max_len 20 過濾 35 chars → 改 40');
  });

  // Case 3: bbc.com — EM inside P with CTA text
  it('Case 3a: BBC "sign up for ... newsletter" CTA 段落被 hide（hideInsideArticleCTAParagraphs）', () => {
    const p = document.querySelector('.bbc-cta-signup');
    assert.ok(p);
    assert.strictEqual(p.dataset.jreadHidden, '1',
      'P.bbc-cta-signup 含 <em>sign up for ... newsletter</em> CTA 段落必須被 hide；' +
      'forcing：拿掉 hideInsideArticleCTAParagraphs → 漏網');
  });

  it('Case 3b: BBC "follow us on Facebook and Instagram" CTA 段落被 hide', () => {
    const p = document.querySelector('.bbc-cta-follow');
    assert.ok(p);
    assert.strictEqual(p.dataset.jreadHidden, '1',
      'P.bbc-cta-follow 含 <em>follow us on Facebook and Instagram</em> 必須被 hide');
  });

  // Case 4: twz.com — H2 "The TWZ Newsletter" (18 chars)
  it('Case 4: H2 "The TWZ Newsletter" 訂閱區塊被 hide（\\bnewsletter$ 放寬）', () => {
    const section = document.querySelector('.newsletter-section-4');
    assert.ok(section);
    let cur = section, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden,
      '.newsletter-section-4 包 H2 "The TWZ Newsletter"（18 chars）必須被 hide；' +
      'forcing：^newsletter$ 不匹配帶前綴的 heading → 改 \\bnewsletter$');
  });

  // Case 5: upmedia.mg — STRONG "（延伸閱讀：）"
  it('Case 5: STRONG "（延伸閱讀：）" 被 hide（divSpanCandidates 加 strong）', () => {
    const p = document.querySelector('.upmedia-readmore');
    assert.ok(p);
    let cur = p, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden,
      'P.upmedia-readmore 含 <strong>（延伸閱讀：）</strong> 必須被 hide；' +
      'forcing：divSpanCandidates 原只掃 div/span/p，不掃 strong → 延伸閱讀 pattern 漏網');
  });

  // Case 6: cnbc.com — "Like this story? Subscribe to ... YouTube!"
  it('Case 6a: CNBC "Like this story? Subscribe to ... YouTube!" CTA 段落被 hide', () => {
    const p = document.querySelector('.cnbc-cta-like');
    assert.ok(p);
    assert.strictEqual(p.dataset.jreadHidden, '1',
      'P.cnbc-cta-like 含 "Subscribe to ... YouTube" CTA 必須被 hide');
  });

  // Case 6b: "Don't miss:" heading
  it('Case 6b: "Don\'t miss:" 推薦區塊被 hide（^don\'t\\s+miss\\b）', () => {
    const section = document.querySelector('.cnbc-dont-miss-section');
    assert.ok(section);
    let cur = section, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden,
      '.cnbc-dont-miss-section 包 "Don\'t miss:" heading 必須被 hide；' +
      'forcing：NOISE_HEADING_TEXT_RE 缺 don\'t miss pattern → 加');
  });

  // Case 7: developer.mozilla.org — H2 "Help improve MDN"
  it('Case 7: H2 "Help improve MDN" CTA 區塊被 hide（^help\\s+improve\\b）', () => {
    const section = document.querySelector('.mdn-footer-cta');
    assert.ok(section);
    let cur = section, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden,
      '.mdn-footer-cta 包 H2 "Help improve MDN"（16 chars）必須被 hide；' +
      'forcing：NOISE_HEADING_TEXT_RE 缺 help improve pattern → 加');
  });
});
