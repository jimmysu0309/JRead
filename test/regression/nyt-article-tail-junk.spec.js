// JRead — regression spec: nytimes 文章尾巴垃圾模組清除（v0.8.54）
// -----------------------------------------------------------------------------
// 2026-06-12 Jimmy 回報 nytimes colbert 文章閱讀模式尾巴整串殘留。真站 probe
// （存檔 HTML + route interception）確認五個獨立漏洞：
//   1. 「Editors’ Picks」：base regex `editor[‘’]?s\s+picks?` 只接受撇號在 s
//      前（editor's），複數所有格（editors’）miss
//   2. 「Trending in The Times」21 chars 超過 base max_len（20），EXT 層沒有
//      錨定推薦字樣 pattern
//   3. 「More in Television」：`^more\s+(from|...)` family 缺 in / on
//   4. 「Related Content」推薦 feed 群組：heading 有命中，但 feed 的短 teaser
//      <p> 累計 >= 300 chars 誤觸 wrapperContainsMainContentP 累計門檻 →
//      tooWide 把整個 section 當主文保護，只藏得掉 heading 本身。修法 =
//      isLinkFeedContainer 覆寫（無 >= 100 chars p + link density >= 0.5 +
//      >= 3 連結 = 推薦 feed，不受累計門檻保護）
//   5. 印刷版聲明行（appears in print on ... Order Reprints | Today's Paper）
//      與 styln-guide 故事集導覽卡（heading 是故事專名）三條既有軌都接不住
//      → 新規則 hideInsideArticlePrintEditionNote / hideTailCuratedLinkLists
//
// fixture 的 url 必須給真站 URL：hideTailCuratedLinkLists 的「站內連結」判定
// 比 location.hostname，about:blank 下相對解析不出 hostname 會偽陰性

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'nyt-article-tail-junk.html');

describe('cleaner — nytimes 文章尾巴垃圾模組清除（v0.8.54）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true,
      url: 'https://www.nytimes.com/2026/05/22/arts/television/colbert-last-late-show.html'
    });
    document = env.document;
    articleEl = document.getElementById('story');
    articleEl.setAttribute('data-jread-active', '1');
    env.NS.cleaner.clean(articleEl, []);
  });

  function isHidden(el) {
    return !!(el && el.closest('[data-jread-hidden="1"]'));
  }

  // ---- 1-4：推薦 feed 群組 -------------------------------------------------

  it('「Related Content」推薦 feed 群組必須整個 section 被 hide（link-feed 覆寫 tooWide）', () => {
    const sec = document.getElementById('tail-group');
    assert.ok(sec, 'fixture 應有 recirc section');
    assert.ok(isHidden(sec), '短 teaser p 累計 >= 300 不可再觸發主文保護——' +
      'link-feed 容器（無長 p + density >= 0.5 + >= 3 連結）必須整塊 hide');
  });

  it('「Trending in The Times」（21 chars）必須被 hide（EXT 層錨定推薦字樣）', () => {
    assert.ok(isHidden(document.getElementById('trending-in-the-times-section')));
  });

  it('「More in Television」必須被 hide（more family 加 in/on）', () => {
    assert.ok(isHidden(document.getElementById('more-in-television-section')));
  });

  it('「Editors’ Picks」（複數所有格撇號）必須被 hide', () => {
    assert.ok(isHidden(document.getElementById('editors-picks-section')));
  });

  // ---- 5：印刷版聲明行 -----------------------------------------------------

  it('印刷版出處聲明行（appears in print on）必須整行被 hide（含 CTA 連結與分隔符）', () => {
    const note = document.getElementById('print-note');
    assert.ok(note, 'fixture 應有 print-note');
    assert.ok(isHidden(note), '聲明行 div 必須 hide，不可只清 Subscribe 連結留下「. | |」殘渣');
  });

  it('主文段落內順帶出現 appears in print on 字樣（> 250 chars）不可被誤殺', () => {
    const p = document.getElementById('main-p4');
    assert.ok(/appears in print on/.test(p.textContent), 'fixture main-p4 應含該字樣');
    assert.ok(!isHidden(p), '長度 guard（<= 250）必須擋住主文段落');
  });

  // ---- See more on 主題列 --------------------------------------------------

  it('「See more on:」主題連結列必須被 hide', () => {
    assert.ok(isHidden(document.getElementById('topics-row')));
  });

  // ---- styln-guide 故事集導覽卡 --------------------------------------------

  it('故事集導覽卡（heading 為故事專名、li teaser + 站內連結）必須被 hide', () => {
    const guide = document.getElementById('styln-guide');
    assert.ok(guide, 'fixture 應有 styln-guide');
    assert.ok(isHidden(guide), 'hideTailCuratedLinkLists：tail 區 + 每 li 含 p 與站內連結');
  });

  // ---- 負向控制組（誤殺面） -------------------------------------------------

  it('references 形 section（li 無 p wrapper、# anchor 回鏈）不可被 hide', () => {
    assert.ok(!isHidden(document.getElementById('refs-control')),
      'Wikipedia References 形狀必須存活（li 缺 p wrapper → teaser 條件不滿足）');
  });

  it('外站連結的 curated list 不可被 hide', () => {
    assert.ok(!isHidden(document.getElementById('external-list-control')),
      '「站內連結」條件必須擋住外站 citation / source list');
  });

  it('作者 bio 段落必須保留', () => {
    assert.ok(!isHidden(document.getElementById('bio-p')));
  });

  it('主文段落必須全數保留', () => {
    for (const id of ['main-p1', 'main-p2', 'main-p3', 'main-p4']) {
      assert.ok(!isHidden(document.getElementById(id)), `${id} 不可被誤殺`);
    }
  });
});
