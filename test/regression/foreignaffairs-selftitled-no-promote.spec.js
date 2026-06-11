// JRead — self-titled article 不可被 site chrome 的標題複寫誤導 promote（v0.8.42）
//
// 對應 bug：https://www.foreignaffairs.com/united-states/no-substitute-victory-pottinger-gallagher
// 進閱讀模式後文章尾巴出現整串推薦雜訊（Recommended / Most Read 數千 px，
// Jimmy 2026-06-11 回報）。
//
// 根因：頁面結構為
//   div.base
//     ├ div.base__nav > span.site-nav__current-article   ← sticky 導覽列複寫「目前文章標題」
//     └ main.base__main
//         ├ article.article > h1                          ← 真主文，自含 og-match hero H1
//         └ div.row > section.article__related / article__most_read  ← 尾巴推薦雜訊
//
// detector article-tag 正確命中 ARTICLE.article（自含 H1）。但 promoteForTitle
// 沒有「articleEl 已自含標題」的 guard，sibling-walk 在 hop 1（parent=div.base）
// 掃到導覽列那顆與 og:title 完全相同的 span（TITLE_TAG_SEL 含 span、不在 <a>
// 內）→ articleEl 被升到 div.base（近整頁 wrapper）→ MAIN 內 ARTICLE 的兄弟
// （related / most-read section）全部括進主文，cleaner 的 hideAncestorSiblings
// 鞭長莫及、token 規則也咬不中（article__related 缺後綴、article__most_read
// 用底線）→ 文章尾巴整串雜訊殘留。
//
// 修法（結構性通則）：promoteForTitle 進場先跑 findSelfTitleHead——articleEl
// 內已有「非 <a> 包覆、og-match」的 h1-h4 heading 時，promote 的存在理由
// （把 article 外的標題括進 scope）不成立，直接收手不走 sibling-walk。
// helper 與 ensureArticleContainsTitleH1 既有 guard 共用（同一份事實單一資料
// 源，消除兩 path 不對稱）。不綁 hostname / class。
//
// 本 spec 是 forcing function：
//   - detect() 結果必須留在自含 H1 的 ARTICLE，不可升到含推薦 section 的 wrapper
//   - 導覽列的標題複寫 span 不可進 scope

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'foreignaffairs-selftitled-no-promote.html');

describe('detector — self-titled article 不可被導覽列標題複寫誤導 promote（v0.8.42）', () => {
  let document, result;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    document = env.document;
    result = env.NS.detector.detect();
  });

  it('偵測成功，回傳物件而非 null', () => {
    assert.ok(result, '偵測應成功（不得 no-op）');
  });

  it('主文容器必須包含真標題 H1（self-titled）', () => {
    assert.ok(result.el.querySelector('[data-test="real-title"]'),
      '主文容器應含自帶的 hero H1');
  });

  it('主文容器不可包含尾巴推薦 section（promote 不可被導覽列標題複寫誤導升級）', () => {
    const junk = document.querySelector('[data-test="tail-junk"]');
    assert.ok(junk, 'fixture 必須含尾巴推薦區');
    assert.ok(!result.el.contains(junk),
      'articleEl 含推薦區 = promote 被 site chrome 的標題複寫（site-nav__current-article）' +
      '誤導升到近整頁 wrapper——self-titled guard 失效');
  });

  it('主文容器不可包含導覽列的標題複寫 span', () => {
    const echo = document.querySelector('[data-test="nav-title-echo"]');
    assert.ok(echo, 'fixture 必須含導覽列標題複寫 span');
    assert.ok(!result.el.contains(echo),
      'articleEl 含導覽列 = 升過頭（吞進 site chrome）');
  });

  it('不應發生 promote（promotedFrom 未設）', () => {
    assert.strictEqual(result.promotedFrom, undefined,
      'articleEl 已自含 og-match H1，promoteForTitle 應直接收手、不記 promotedFrom');
  });

  it('主文內容必須保留', () => {
    assert.ok((result.el.textContent || '').includes('MAINTEXT_MARK'),
      '主文容器應包含 article 內文');
  });
});
