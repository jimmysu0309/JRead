// JRead — regression spec: heading 內 inline 動作連結清除 (v0.8.45 WK4)
// -----------------------------------------------------------------------------
// zh.wikipedia 每節 heading 旁「[編輯]」動作連結 light / dark 都殘留
// （2026-06-11 page rounds WK4）。結構通則：heading 內、含 <a> 的 <span>
// wrapper、文字遠短於 heading 主文字（< 30% 且 <= 12 chars）= 動作 / 裝飾
// 連結群，連 wrapper 一起 hide（只清 <a> 會留括號殘渣）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'heading-action-links.html');

describe('cleaner — heading 內動作連結清除（v0.8.45 WK4）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.getElementById('post');
    articleEl.setAttribute('data-jread-active', '1');
    env.NS.cleaner.clean(articleEl, []);
  });

  function isHidden(el) {
    return !!(el && el.closest('[data-jread-hidden="1"]'));
  }

  it('「[編輯]」span（中文）必須整個 wrapper 被 hide', () => {
    const spans = document.querySelectorAll('span.edit-section');
    assert.strictEqual(spans.length, 2, 'fixture 應有 2 個 edit-section span');
    assert.ok(isHidden(spans[0]), '中文 [編輯] span 必須被 hide（含括號殘渣）');
  });

  it('「[edit]」span（英文）必須被 hide', () => {
    const spans = document.querySelectorAll('span.edit-section');
    assert.ok(isHidden(spans[1]), '英文 [edit] span 必須被 hide');
  });

  it('sibling 形式（DIV wrapper 內 H2 + span，新版 MediaWiki）必須被 hide', () => {
    const span = document.querySelector('span.edit-section-sibling');
    assert.ok(span, 'fixture 應有 edit-section-sibling span');
    assert.ok(isHidden(span), 'heading wrapper 內的 sibling [編輯] span 必須被 hide');
  });

  it('heading 本文必須保留', () => {
    for (const h of document.querySelectorAll('h2')) {
      assert.ok(!isHidden(h), `heading「${h.textContent.slice(0, 10)}」不可被整個 hide`);
    }
  });

  it('連結式標題（a 占整個 heading）不可誤殺', () => {
    const h = document.querySelector('h3.linked-heading');
    assert.ok(h, 'fixture 應有 linked-heading H3');
    assert.ok(!isHidden(h.querySelector('a')), '連結式標題的 a 必須保留（無 span wrapper / 占比高）');
  });
});
