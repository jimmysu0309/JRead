// JRead — theverge 連結式 section 標題進閱讀模式消失（v0.8.99）
//
// 對應 bug（Jimmy 2026-06-17 截圖）：
//   https://www.theverge.com/tech/933415/google-io-2026-biggest-announcements-ai-gemini
// 進閱讀模式後 14 個 section 標題（Gemini 3.5 / Gemini Omni / …）全部消失。
//
// 根因（兩條獨立 rule 各自誤殺，harness instrument 實證）：
//   1) hideInsideArticleSidebarColumns 條件 A：theverge 文章 body 是扁平 block
//      元件清單，section 標題做成「整個 heading 包連到深入文章的 <a>」，block
//      textLen 極短 + linkDensity 1.0 < 主欄 10% 且 ld > 0.5 → 當 link-heavy
//      sidebar widget 砍。連到別篇文章（非本文 permalink）→ self-link guard 不命中。
//   2) hideInsideArticleByKeyword：CMS 自動產生的標題錨點 id = 標題文字 slug，
//      slug 裡的主題用字「comments」被 markerOf（class + id）當留言區雜訊命中。
//
// 修法：兩條 rule 都加 isLoneSectionHeadingColumn guard（block 內恰一個 heading
// 且 heading 文字佔全文 >= 90% ＝ 內容標題、非 widget）。真噪 section 標題
// （Most Popular 等）由 NOISE_HEADING_TEXT_RE 文字訊號兜底。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'theverge-linked-section-headings.html');

describe('cleaner — theverge 連結式 section 標題不可被 cleaner 砍（v0.8.99）', () => {
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
    articleEl = document.querySelector('article');
    assert.ok(articleEl);
    window.__JRead.cleaner.clean(articleEl);
  });

  function isHiddenWithin(el) {
    // 元素自身或任一祖先被標 hidden
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') return true;
      cur = cur.parentElement;
    }
    return false;
  }

  it('fixture 結構：section 標題 block textLen << main × 10% + linkDensity = 1.0（觸發 sidebar 條件 A）', () => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('[data-test="main-block"]');
    const headBlock = document.querySelector('[data-test="heading-block-gemini"]');
    const mainText = norm(main.textContent);
    const headText = norm(headBlock.textContent);
    let headLink = 0;
    for (const a of headBlock.querySelectorAll('a')) headLink += norm(a.textContent).length;
    assert.ok(mainText.length >= 500, 'main textLen >= MIN_MAIN_TEXT 500');
    assert.ok(headText.length < mainText.length * 0.1, 'heading block textLen < main × 10%');
    assert.ok(headLink / headText.length > 0.5, 'heading block linkDensity > 0.5');
  });

  it('連結式 section 標題（Gemini 3.5）不可被 sidebar-column rule hide（核心保護點 1）', () => {
    const link = document.querySelector('[data-test="heading-link-gemini"]');
    assert.ok(!isHiddenWithin(link),
      'section 標題 block 內容就是一個 heading（heading 文字 ≈ block 全文）＝ 內容標題，' +
      '必須被 isLoneSectionHeadingColumn guard 保護不被 sidebar-column 條件 A 誤殺');
  });

  it('section 標題 wrapper id slug 含「comments」不可被 keyword rule hide（核心保護點 2）', () => {
    const link = document.querySelector('[data-test="heading-link-pics"]');
    assert.ok(!isHiddenWithin(link),
      'wrapper id = 標題文字 slug（…-based-on-comments），slug 裡的主題用字不是 widget ' +
      'class 訊號；lone section 標題須被 guard 保護不被 hideInsideArticleByKeyword 誤殺');
  });

  it('float 排版的連結式 section 標題不可被 inset-link-card rule hide（核心保護點 3）', () => {
    const link = document.querySelector('[data-test="heading-link-inset"]');
    assert.ok(!isHiddenWithin(link),
      'real Chrome 幾何下 theverge 較長 section 標題（>= 15 chars）落入 ' +
      'hideInsideArticleInsetLinkCards 的 text 區間 + linkDensity 1.0 + floated → ' +
      '被當嵌入式相關文章卡誤殺（短標題 < 15 chars 才倖免，即「只有前面幾個出來」病徵）；' +
      'lone section 標題須被 isLoneSectionHeadingColumn guard 保護');
  });

  it('主文 block 保留（main 不可被誤殺）', () => {
    const main = document.querySelector('[data-test="main-block"]');
    assert.notStrictEqual(main.dataset.jreadHidden, '1');
  });

  it('真噪 section 標題（Recommended）仍須被 hide（guard 不可過度保護）', () => {
    const link = document.querySelector('[data-test="noise-heading-link"]');
    assert.ok(isHiddenWithin(link),
      'Recommended 是 lone heading，sidebar/keyword guard 放行後仍須由 ' +
      'NOISE_HEADING_TEXT_RE（^recommended）文字訊號兜底 hide');
  });
});
