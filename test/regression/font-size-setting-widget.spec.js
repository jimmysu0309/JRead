// JRead — regression spec: 原站字級設定 UI 清除 (v0.8.45 chinatimes)
// -----------------------------------------------------------------------------
// 2026-06-11 page rounds：chinatimes 圖說下方「字級設定：」原站字級調整 UI
// 殘留（audit 無 button tag / keyword 信號，靠抽查抓到）。
// probe 實測結構：SPAN.title < DIV.font-size-setting < DIV.article-function。
// 修法雙保險（CMS 慣例命名 + UI 慣用語，皆不綁站點）：
//   1. NOISE_TOKEN_DEFS 加 font-?size-?(setting|switcher|control|adjuster?) +
//      article-function
//   2. NOISE_HEADING_TEXT_RE 加 ^字(級|體)(設定|大小)$（normHeading 剝尾冒號）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'font-size-setting-widget.html');

describe('cleaner — 原站字級設定 UI 清除（v0.8.45）', () => {
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

  it('「字級設定」widget 必須被 hide', () => {
    const w = document.querySelector('.font-size-setting');
    assert.ok(w, 'fixture 應有 font-size-setting widget');
    assert.ok(isHidden(w), '字級設定 UI（class token 或文字 pattern）必須被清');
  });

  it('主文段落必須保留', () => {
    let visible = 0;
    for (const p of articleEl.querySelectorAll('p')) {
      if (p.textContent.replace(/\s+/g, '').length >= 50 && !isHidden(p)) visible++;
    }
    assert.strictEqual(visible, 2, '兩段主文都必須保留');
  });
});
