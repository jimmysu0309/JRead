// JRead — 自連結 permalink 標題在翻譯後不可被 sidebar-column 規則砍（v0.8.47）
//
// 對應 bug（Jimmy 2026-06-11 回報，兩站、Shinkansen 翻譯後進閱讀模式標題消失）：
//   - sharptext.net /2026/how-spencer-pratt-happens：H1.wp-block-post-title
//     （`<h1><a href=permalink>標題</a></h1>`）翻成中文後被
//     hideInsideArticleSidebarColumns 條件 A 直接 hide（H1 自身被當「欄」）
//   - david-smith.org /blog/2026/06/03/apple-like/：含 h1 的 HEADER 整塊被同
//     規則 hide。Gemini Flash Lite 譯名長 → header linkDensity 0.6 觸發；
//     Google MT 譯名短 → 0.41 躲過——是否觸發取決於譯文長度抽籤
//
// 根因：自連結標題文字短 + 連結密度 100%，形狀同 link-heavy widget，原本全靠
// 文字比對 guard（promotedTitleHead / siblingContainsCanonicalTitle 對 og:title
// / document.title）救。翻譯擴充把 heading 文字換成中文、og:title 是 meta 標籤
// 不被翻譯 → 比對必失敗、保護全滅。
//
// 修法（結構通則）：heading（h1-h4、不被 <a> 包住）內含 href 解析後與本頁同
// origin + 同 pathname（尾斜線不計、無 query / hash）的 <a> → 自連結標題，
// sidebar-column 規則 skip。URL 不會被翻譯改動，訊號 translate-proof。
//
// 本 spec 驗三個形狀（fixture 內無 og:title、document.title 為英文原文、
// heading 文字為中文譯文——重現翻譯後的保護真空）：
//   1. header 包自連結 h1（david-smith 形）→ 不可 hide
//   2. 自連結 H1 自身為 sibling（sharptext 形）→ 不可 hide
//   3. #hash anchor 連結 heading 的 widget（反例）→ 照常 hide，guard 不誤保護

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'self-link-title-translated.html');
// 與 fixture 內自連結 href 對應的頁面 URL（permalink 比對需要真 location）
const PAGE_URL = 'https://example.com/blog/2026/06/03/apple-like/';

describe('cleaner — 自連結 permalink 標題翻譯後不可被 sidebar-column 砍（v0.8.47）', () => {
  let window, document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true,
      url: PAGE_URL
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('article');
    assert.ok(articleEl);
    window.__JRead.cleaner.clean(articleEl);
  });

  it('fixture 結構：兩組標題區皆觸發 sidebar-column 條件 A（textLen < main × 10% + linkDensity > 0.5）', () => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const linkLen = el => {
      let n = 0;
      for (const a of el.querySelectorAll('a')) n += norm(a.textContent).length;
      return n;
    };
    // 形狀一：header vs content
    const header = document.querySelector('[data-test="post-header"]');
    const content = document.querySelector('[data-test="content"]');
    const hText = norm(header.textContent);
    const cText = norm(content.textContent);
    assert.ok(cText.length >= 500, `content textLen ${cText.length} >= MIN_MAIN_TEXT 500`);
    assert.ok(hText.length < cText.length * 0.1, `header ${hText.length} < main × 10%`);
    assert.ok(linkLen(header) / hText.length > 0.5, `header linkDensity ${(linkLen(header) / hText.length).toFixed(2)} > 0.5`);
    // 形狀二：bare H1 vs content2
    const bare = document.querySelector('[data-test="bare-title"]');
    const content2 = document.querySelector('[data-test="content2"]');
    const bText = norm(bare.textContent);
    const c2Text = norm(content2.textContent);
    assert.ok(c2Text.length >= 500, `content2 textLen ${c2Text.length} >= MIN_MAIN_TEXT 500`);
    assert.ok(bText.length < c2Text.length * 0.1, `bare-title ${bText.length} < main × 10%`);
    assert.ok(linkLen(bare) / bText.length > 0.5, 'bare-title linkDensity > 0.5（自連結 = 全連結）');
  });

  it('fixture 前提：canonical 文字比對在翻譯後必失敗（heading 中文 vs document.title 英文）', () => {
    const titleHead = window.__JRead.stripSiteSuffix(document.title);
    const h1Text = document.querySelector('[data-test="post-title"]').textContent.trim();
    assert.notStrictEqual(titleHead, h1Text,
      '若相等代表 fixture 沒重現翻譯態，本 spec 驗的保護真空不存在');
  });

  it('形狀一（david-smith）：含自連結 h1 的 header 不可被 hide', () => {
    const header = document.querySelector('[data-test="post-header"]');
    assert.notStrictEqual(header.dataset.jreadHidden, '1',
      'header 內 h1 的 <a href> 指向本頁 permalink，必須被自連結標題 guard 保護。' +
      '否則翻譯後（文字比對 guard 全滅）整塊標題區被 sidebar-column 條件 A 砍掉');
    const h1 = document.querySelector('[data-test="post-title"]');
    assert.notStrictEqual(h1.dataset.jreadHidden, '1');
  });

  it('形狀二（sharptext）：自連結 H1 自身為 sibling 時不可被 hide', () => {
    const bare = document.querySelector('[data-test="bare-title"]');
    assert.notStrictEqual(bare.dataset.jreadHidden, '1',
      'H1 自己是容器 direct child（wp-block-post-title 形狀）、整顆是自連結，' +
      '條件 A 會把 H1 當「欄」直接砍——guard 必須涵蓋「sibling 自身即 heading」');
  });

  it('反例：#hash anchor 連結 heading 的 widget 照常被清（guard 不誤保護）', () => {
    const widget = document.querySelector('[data-test="anchor-widget"]');
    assert.strictEqual(widget.dataset.jreadHidden, '1',
      '#comments 是站內 anchor、不是 permalink——自連結 guard 必須排除 hash / query，' +
      '否則任何「查看留言」「回到頂部」類 widget 都會被誤保護成標題');
  });

  it('兩組主文欄皆保留', () => {
    assert.notStrictEqual(document.querySelector('[data-test="content"]').dataset.jreadHidden, '1');
    assert.notStrictEqual(document.querySelector('[data-test="content2"]').dataset.jreadHidden, '1');
  });
});
