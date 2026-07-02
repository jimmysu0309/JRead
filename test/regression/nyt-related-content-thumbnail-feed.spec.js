// JRead — NYT 文末 lazy「Related Content / 編輯精選」縮圖卡片 feed 整區清除（v1.6.5）
//
// 對應 fixture：test/regression/fixtures/nyt-related-content-thumbnail-feed.html
// Trigger：Jimmy 2026-07-02 截圖——翻譯後閱讀模式捲到文末，作者簡介之後整區「編輯精選 /
// Related Content」推薦卡（大圖 + 短標題）殘留。
//
// 根因：feed 的短圖說累計 >= 300（wrapperContainsMainContentP 判 tooWide 主文保護），
// 且 link 文字占比 < 0.5（NYT 把 teaser 標題 / 圖說放在 <a> 外，實測 0.31）→ 舊
// isLinkFeedContainer（只認 link 文字占比 >= 0.5）不認得這是 feed → resolveHeadingNoiseTarget
// 的 tooWide 保護生效、walk-up 只 hide 得掉 <h2>Related Content>、整區卡片殘留。
//
// 修法（v1.6.5，結構性通則）：isLinkFeedContainer 補媒體訊號——無任一 >= 100 字長段落
// （real 主文段落訊號）+ 縮圖 img/picture >= 3 + link >= 5 = 縮圖卡片 feed，即使 link
// 文字占比低也判為 feed。本函式只在 resolveHeadingNoiseTarget 的 tooWide 判定內呼叫
// （前提已命中 recirculation noise heading 如 Related Content），真主文區塊不帶此類
// heading、且長段落會被 gate 擋、photo essay 主文也不命中，不誤殺。
//
// 這條驗：整區 feed 被 hide + 主文段落 / 標題保留。破壞修法（移除媒體訊號）→ 只 hide
// heading、feed body 殘留 → 立即 fail。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'nyt-related-content-thumbnail-feed.html');

function isHiddenOrAncestorHidden(el) {
  let cur = el;
  while (cur && cur !== cur.ownerDocument.body) {
    if (cur.dataset && cur.dataset.jreadHidden === '1') return true;
    cur = cur.parentElement;
  }
  return false;
}

describe('cleaner — NYT 文末 Related Content 縮圖卡片 feed 整區清除（v1.6.5）', () => {
  let document;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      pretendToBeVisual: true
    });
    document = env.document;
    const detected = env.window.__JRead.detector.detect();
    assert.ok(detected && detected.el, 'detector 應命中 fixture 主文容器');
    document.__articleEl = detected.el;
    env.window.__JRead.cleaner.clean(detected.el);
  });

  const norm = s => (s || '').replace(/\s+/g, ' ').trim();

  it('前置：feed 短圖說累計 >= 300、無 >= 100 字長段落、link 文字占比 < 0.5、縮圖 >= 3', () => {
    const feed = document.querySelector('[data-test="related-feed"]');
    let maxP = 0, accP = 0;
    for (const p of feed.querySelectorAll('p')) { const l = norm(p.textContent).length; maxP = Math.max(maxP, l); accP += l; }
    const links = feed.querySelectorAll('a');
    let linkText = 0; for (const a of links) linkText += norm(a.textContent).length;
    const ratio = linkText / norm(feed.textContent).length;
    assert.ok(maxP < 100, `feed 不可有 >= 100 字長段落（實際 maxP ${maxP}）`);
    assert.ok(accP >= 300, `feed 短圖說累計 >= 300（實際 ${accP}），才會觸發 tooWide 主文保護`);
    assert.ok(ratio < 0.5, `link 文字占比 < 0.5（實際 ${ratio.toFixed(2)}），才 forcing 媒體訊號 path`);
    assert.ok(feed.querySelectorAll('img, picture').length >= 3, 'feed 縮圖 >= 3');
    assert.ok(links.length >= 5, 'feed link >= 5');
  });

  it('核心：整區 Related Content 卡片 feed 被 hide', () => {
    const feed = document.querySelector('[data-test="related-feed"]');
    assert.ok(isHiddenOrAncestorHidden(feed),
      'section.feed（Related Content 縮圖卡片 feed）必須整區 hide，不能只藏 heading');
  });

  it('主文 h1 + 兩段內文保留（feed 是主文 sibling、不可連累）', () => {
    const h1 = document.querySelector('h1');
    assert.ok(h1 && !isHiddenOrAncestorHidden(h1), 'h1 主標題保留');
    for (const sel of ['[data-test="body-p-1"]', '[data-test="body-p-2"]']) {
      const p = document.querySelector(sel);
      assert.ok(p && !isHiddenOrAncestorHidden(p), `主文段落 ${sel} 必須保留`);
    }
  });
});
