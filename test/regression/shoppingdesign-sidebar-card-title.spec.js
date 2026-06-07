// JRead — shoppingdesign 側欄推薦卡重複標題誤導 promote regression（v0.7.236）
//
// 對應 bug：https://www.shoppingdesign.com.tw/post/view/13485 進閱讀模式後
// 標題與 hero image 雙雙消失（Jimmy 2026-06-08 回報）。
//
// 根因：頁面結構為
//   div.post-wrapper（共同祖先）
//     ├ div.title-box > h1            ← 真標題（裸 <h1>）
//     ├ figure                        ← hero image
//     └ div.content-row（flex row）
//         ├ ...article.htmlview       ← 主文 body（無 h1）
//         └ aside.sidebar
//             └ a > h2                ← 推薦卡，h2 文字 = 本文標題（重複）
//
// detector article-tag 命中 article.htmlview（無 h1）。promoteForTitle 的寬鬆
// div/span 比對在 sibling-walk 命中**側欄推薦卡**裡那顆與 og:title 相符的
// 標題，把 articleEl 升到 content-row（含主文 + 側欄的共同祖先）就停住——
// 真 <h1> 與 hero figure 是 content-row 的「叔伯層」兄弟、被排除在 scope 外，
// cleaner hideAncestorSiblings 把它們當外部 chrome 清掉 → 標題 + hero 消失。
// ensureArticleContainsTitleH1 兜底又被側欄那顆重複標題 h2 騙到（誤判
// 「scope 內已有標題」）→ 放棄升級。
//
// 修法（結構性通則）：promoteForTitle / ensureArticleContainsTitleH1 比對標題
// 候選時，跳過「祖先含 <a> 的 heading」——卡片連結式標題（推薦 / 相關 / 側欄
// 文章卡）慣例整顆包在 <a> 裡連向該文，常重複當前頁標題文字；本文自身的
// hero 標題慣例為裸 heading，不會整顆被 <a> 包成可點卡片。用 closest('a')
// 判祖先方向，不誤殺「<h1> 內含 <a>」的自連標題。不綁 hostname / class。
//
// 本 spec 是 forcing function：
//   - detector 必須 promote 到含真 <h1> + hero figure 的 wrapper
//   - 側欄重複標題 h2（在 <a> 內）不可被當成 titleHead
//   - 主文內容必須保留

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'shoppingdesign-sidebar-card-title.html');

describe('detector — shoppingdesign 側欄推薦卡重複標題不可阻斷 hero 標題 promote（v0.7.236）', () => {
  let window, document, result;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    result = env.NS.detector.detect();
  });

  it('偵測成功，回傳物件而非 null', () => {
    assert.ok(result, '偵測應成功（不得 no-op）');
  });

  it('主文容器必須包含真標題 <h1>（promote 越過側欄重複標題升到正確 wrapper）', () => {
    const h1 = result.el.querySelector('[data-test="real-title"]');
    assert.ok(h1,
      '主文容器應含真 <h1> 標題；若 promote 被側欄推薦卡的重複標題擋在 content-row，' +
      '真 h1 會落在 scope 外、被 cleaner 當 chrome 清掉。');
  });

  it('主文容器必須包含 hero figure（與 h1 同屬 wrapper 的兄弟分支）', () => {
    const fig = result.el.querySelector('[data-test="hero-figure"]');
    assert.ok(fig, '主文容器應含 hero <figure>；promote 升到 wrapper 後 hero 才會納入 scope。');
  });

  it('主文內容必須保留', () => {
    assert.ok((result.el.textContent || '').includes('MAINTEXT_MARK'),
      '主文容器應包含 article 內文');
  });

  it('promote 命中的 titleHead 不可是側欄 <a> 內的重複標題 h2', () => {
    const dup = document.querySelector('[data-test="sidebar-dup-title"]');
    assert.ok(dup, 'fixture 必須含側欄重複標題 h2');
    assert.notStrictEqual(result.promotedTitleHead, dup,
      'titleHead 不應是側欄推薦卡（<a> 包覆）內的重複標題——那是卡片連結、非本文標題');
  });
});
