// JRead — 翻譯後「相關貼文」related-posts 區塊殘留（v0.8.77）
//
// 對應 fixture：test/regression/fixtures/related-posts-translated-heading.html
// Trigger：Jimmy 2026-06-15 回報 0xkato.xyz/how-llms-actually-work 用 Shinkansen
// 翻譯後進閱讀模式，文末「Related Posts」相關文章區塊（heading 翻成「相關貼文」）
// 跑進閱讀模式。
//
// 根因（instrument 實證，translate-first vs plain）：英文「Related Posts」被
// NOISE_HEADING_TEXT_RE 的 `^(related|...)` 命中、resolveHeadingNoiseTarget
// walk-up 到 DIV.related 整塊 hide（plain 模式正常）；翻譯後 heading 變「相關貼文」
// （貼文=posts），不在中文 `相關(新聞|文章|報導|行情|議題)` 分支內 → hitBase fail
// → 整列漏網。resolveHeadingNoiseTarget 的 target 解析本身兩模式相同（都會選到
// DIV.related），純粹卡在 regex 不命中翻譯詞。
//
// 修法：中文分支 `相關(?:新聞|文章|報導|行情|議題|貼文|影片|內容)` 涵蓋翻譯變體。
// 「相關」開頭+content 名詞是跨站 recirculation section 慣用語，非站點特判。
//
// fixture class（related / relatedPost）刻意不在 NOISE_KEYWORD_RE 內，確保 hide
// 只能來自 heading-text path，是有效 forcing function。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'related-posts-translated-heading.html');

function isHiddenOrAncestorHidden(el) {
  let cur = el;
  while (cur && cur !== cur.ownerDocument.body) {
    if (cur.dataset && cur.dataset.jreadHidden === '1') return true;
    cur = cur.parentElement;
  }
  return false;
}

describe('cleaner — 翻譯後「相關貼文」related-posts 區塊 hide（v0.8.77 0xkato）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      pretendToBeVisual: true
    });
    document = env.document;
    const detected = env.window.__JRead.detector.detect();
    assert.ok(detected && detected.el, 'detector 應命中 fixture 主文容器');
    articleEl = detected.el;
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('核心：.related（h4「相關貼文」）整塊被 hide', () => {
    const rel = document.querySelector('.related');
    assert.ok(rel, 'fixture 應有 .related');
    assert.ok(isHiddenOrAncestorHidden(rel),
      '.related（翻譯後 heading「相關貼文」）必須被 heading-text path 整塊 hide');
  });

  it('區塊內 relatedPost 連結都不可見', () => {
    const anchors = Array.from(document.querySelectorAll('.relatedPost'));
    assert.strictEqual(anchors.length, 3, 'fixture 有 3 個 relatedPost');
    for (const a of anchors) {
      assert.ok(isHiddenOrAncestorHidden(a), `相關文章「${a.textContent.trim()}」應被 hide`);
    }
  });

  it('主文 h1 + 三段內文保留（無誤殺）', () => {
    const h1 = document.querySelector('h1');
    assert.ok(h1 && !isHiddenOrAncestorHidden(h1), 'h1 主標題保留');
    const ps = Array.from(document.querySelectorAll('.post > p'));
    assert.strictEqual(ps.length, 3, 'fixture 有三段主文 p');
    for (const p of ps) {
      assert.ok(!isHiddenOrAncestorHidden(p), `主文段落「${p.textContent.slice(0, 12)}…」必須保留`);
    }
  });
});
