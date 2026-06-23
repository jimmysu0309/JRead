// JRead — 行內強調 ≠ section heading（v0.8.169 stratechery 修法）
//
// Bug（Page Rounds 2026-06-23 stratechery）：
//   https://stratechery.com/2026/please-listen-to-my-podcast/ 的主文是一個 <ol>，
//   每個 <li> 是一段實質內文。其中一個 <li>（681 chars）內有一小段 inline
//   <em>see also</em>。em 的 direct text「see also」命中 NOISE_HEADING_TEXT_RE 的
//   base pattern `^see\s+also`，被 hideInsideArticleByHeadingText 當成 section
//   heading 候選，resolveHeadingNoiseTarget 從 em walk-up 把整個 <ol>（含主文第
//   2、3 點）當 safe wrapper hide → reader 內主文第 2、3 點消失。
//
// 根因：strong/em/b/span 候選只要 direct text 命中 noise pattern 就當 heading，
//   沒區分「standalone 雜訊 label」與「埋在長散文塊裡的一小段 inline 強調」。
//
// 修法（結構性通則，非站點特判）：isInlineEmphasisInProse(h)——strong/em/b/span
//   候選若位於某散文塊（li/p/td/dd/blockquote/figcaption）內、且自身文字遠短於
//   所在塊（blockLen - elLen >= 40 且占比 < 0.5），視為內文 inline 強調、跳過。
//   靜態 hideInsideArticleByHeadingText 與動態 checkDynamicNoise 單一資料源。
//
// 無 regression：標準 <strong>延伸閱讀：</strong> label 自身即整個塊（block 文字
//   ≈ 候選文字），不命中「埋在長散文裡」條件，仍照清。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'inline-emphasis-not-heading.html');

describe('cleaner — 行內強調 ≠ section heading（v0.8.169 stratechery）', () => {
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
    articleEl = document.querySelector('article.entry-content');
    assert.ok(articleEl, 'fixture 必須有 article.entry-content');
    window.__JRead.cleaner.clean(articleEl);
  });

  function hidden(id) {
    const el = document.getElementById(id);
    assert.ok(el, `fixture 必須有 #${id}`);
    // 含祖先鏈：祖先被 display:none hide 時子元素也等於不可見（cleaner 只在
    // 祖先 ol 標 jreadHidden、子 li dataset 不標）
    return !!(el.closest && el.closest('[data-jread-hidden="1"]'));
  }

  it('fixture 結構：content <ol> 內 li-2 含 inline <em>see also</em>', () => {
    const em = document.querySelector('#li-2 em');
    assert.ok(em, 'li-2 必須有 inline <em>');
    assert.strictEqual(em.textContent.trim(), 'see also', 'em 內文為 see also（命中 base pattern）');
  });

  it('主文 <ol> 不可因 li 內 inline em「see also」被誤殺 hide', () => {
    assert.strictEqual(hidden('content-list'), false,
      '含主文第 2、3 點的 <ol> 不應被 hide（inline em 非 section heading）');
  });

  it('主文第 2、3 點（li-2 / li-3）必須保留', () => {
    assert.strictEqual(hidden('li-2'), false, 'li-2「What Jensen Huang…」應保留');
    assert.strictEqual(hidden('li-3'), false, 'li-3「Trump\'s Trip…」應保留');
  });

  it('無 regression：standalone <strong>延伸閱讀：</strong> 雜訊 label 仍被清', () => {
    // strong 自身即整個塊內容（block 文字 ≈ 候選 + 連結），不命中「埋在長散文」條件
    assert.strictEqual(hidden('noise-label-block'), true,
      '標準延伸閱讀 inline label（自身即整塊）仍應被 hide');
  });
});
