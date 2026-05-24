// JRead — BYLINE_TEXT_RE 擴充：\bby\s + 月份帶點格式（v0.7.181）
//
// 對應 bug：MSNBC/ms.now byline 區被 hideInsideArticleSidebarColumns 條件 A
// 誤殺。byline 文字為「May. 24, 2026, 8:22 AM EDT By Marc Santia, Carol Leonnig」：
//   - "By" 不在字串開頭（日期之後）→ 舊版 ^\s*by 不命中
//   - "May." 帶 AP style 句點 → 舊版 may\s 不命中（may 後接 "." 非空白）
// 兩處同時漏網導致 BYLINE_TEXT_RE guard 失效、整段 byline 被 sidebar-column
// 條件 A hide。
//
// 修法：
//   1. 新增 `\bby\s` 作為獨立 alternation（不限行首）
//   2. 月份縮寫加 `\.?` 容許 AP style 帶點格式
//
// 通則：byline 文字 pattern 跨站收斂（"By Author" / "Month DD, YYYY"），
// word boundary `\b` 避免 "nearby" / "standby" 誤命中。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'msnow-byline-date-format.html');

describe('cleaner — BYLINE_TEXT_RE guard：非行首 "By" + 月份帶點格式（v0.7.181）', () => {
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

  it('fixture 結構：byline-wrapper textLen < main × 10% + linkDensity > 0.5（觸發 sidebar-column 條件 A）', () => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const byline = document.querySelector('[data-test="byline-wrapper"]');
    const content = document.querySelector('[data-test="content-wrapper"]');
    const bylineText = norm(byline.textContent);
    let bylineLinkLen = 0;
    for (const a of byline.querySelectorAll('a')) bylineLinkLen += norm(a.textContent).length;
    const contentText = norm(content.textContent);
    // main textLen >= 500（sidebar-column 門檻）
    assert.ok(contentText.length >= 500, `content textLen ${contentText.length} >= 500`);
    // byline textLen < main × 10%
    assert.ok(bylineText.length < contentText.length * 0.1,
      `byline textLen ${bylineText.length} < main × 10% = ${contentText.length * 0.1}`);
    // byline linkDensity > 0.5
    const ld = bylineLinkLen / bylineText.length;
    assert.ok(ld > 0.5, `byline linkDensity ${ld.toFixed(2)} > 0.5`);
  });

  it('byline-wrapper 不可被 hide（BYLINE_TEXT_RE guard 核心驗證點）', () => {
    const byline = document.querySelector('[data-test="byline-wrapper"]');
    assert.notStrictEqual(byline.dataset.jreadHidden, '1',
      'byline 含 "May. 24, 2026... By Marc Santia"，BYLINE_TEXT_RE 應命中 ' +
      '`\\bby\\s` 或 `may\\.?\\s+\\d{1,2}` 的 alternation，guard 保護不被 hide。');
  });

  it('主文 content-wrapper 保留', () => {
    const content = document.querySelector('[data-test="content-wrapper"]');
    assert.notStrictEqual(content.dataset.jreadHidden, '1');
  });

  it('sanity：非 byline 的 sidebar-widget（短 text + 高 linkDensity）被 hide', () => {
    const widget = document.querySelector('[data-test="sidebar-widget"]');
    assert.strictEqual(widget.dataset.jreadHidden, '1',
      '非 byline 的短 + 高 link-density sidebar widget 應被條件 A hide，' +
      '確認 BYLINE_TEXT_RE guard 只保護真正的 byline、不過度保護。');
  });
});
