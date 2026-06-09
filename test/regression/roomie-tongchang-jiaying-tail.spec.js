// JRead — roomie.tw 文末「同場加映」+ 延伸閱讀 UL regression spec（v0.8.11）
//
// 對應 fixture：test/regression/fixtures/roomie-tongchang-jiaying-tail.html
// 2026-06-09 Page Rounds：roomie.tw/posts/73403 尾段殘留
//   "同場加映" + 3 條延伸閱讀連結（<ul><li><a>）未清。
//
// 根因兩層：
//   (1) NOISE_HEADING_TEXT_RE 缺「同場加映」alternation。
//   (2) 「同場加映」是 DIV.content（主文 body）尾段的純 <p>，parent 非 articleEl
//       （articleEl=ARTICLE/MAIN）。舊 tail-cleanup 只在 `h.parentElement === articleEl`
//       時清 heading + 後續 sibling；此處 parent 是 DIV.content → 只 hide heading 自己、
//       後接的延伸閱讀 UL 留下。
// 修法：
//   (1) regex 加「同場加映」。
//   (2) tail-cleanup 放寬：parent 雖非 articleEl，但只要 parent 在 heading **之前**
//       含主文長 p（確認在內容區尾段、非整塊 noise wrapper），且 heading 之後 sibling
//       全為 widget（無主文長 p），就比照 articleEl 直接子做尾段清除。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'roomie-tongchang-jiaying-tail.html');

function isHiddenOrAncestorHidden(el) {
  let cur = el;
  while (cur && cur !== cur.ownerDocument.body) {
    if (cur.dataset && cur.dataset.jreadHidden === '1') return true;
    cur = cur.parentElement;
  }
  return false;
}

describe('cleaner — roomie.tw 文末「同場加映」+ 延伸閱讀殘留修正（v0.8.11）', () => {
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
    const detected = window.__JRead.detector.detect();
    assert.ok(detected && detected.el, 'detector 應命中 fixture 主文容器');
    articleEl = detected.el;
    window.__JRead.cleaner.clean(articleEl);
  });

  it('前置條件：articleEl 不是「同場加映」的直接 parent（DIV.content）→ 確實走放寬分支', () => {
    const tong = Array.from(document.querySelectorAll('.content > p'))
      .find(p => p.textContent.trim() === '同場加映');
    assert.ok(tong, 'fixture 應有「同場加映」P');
    assert.notStrictEqual(articleEl, tong.parentElement,
      'articleEl 應為 ARTICLE/MAIN、非 DIV.content；否則走的是舊 parent===articleEl 路徑');
  });

  it('Case 1: 「同場加映」P 被 hide', () => {
    const tong = Array.from(document.querySelectorAll('.content > p'))
      .find(p => p.textContent.trim() === '同場加映');
    assert.ok(isHiddenOrAncestorHidden(tong),
      '「同場加映」P 必須被 hide；forcing：NOISE_HEADING_TEXT_RE 缺「同場加映」alternation');
  });

  it('Case 2: 延伸閱讀 UL + 3 條連結被 hide', () => {
    const ul = document.querySelector('.content ul');
    assert.ok(ul, 'fixture 應有延伸閱讀 UL');
    assert.ok(isHiddenOrAncestorHidden(ul),
      '延伸閱讀 UL 必須被 hide；forcing：tail-cleanup 需放寬到 parent!==articleEl 的尾段情境');
    const links = Array.from(document.querySelectorAll('.content ul a'));
    assert.strictEqual(links.length, 3, 'fixture 應有 3 條延伸閱讀連結');
    for (const a of links) {
      assert.ok(isHiddenOrAncestorHidden(a), `延伸閱讀連結「${a.textContent.slice(0, 12)}」必須被 hide`);
    }
  });

  it('主文 5 段長 p 全部保留（cleaner 不可誤殺主文）', () => {
    const mains = Array.from(document.querySelectorAll('.content > p'))
      .filter(p => p.textContent.trim() !== '同場加映' &&
        (p.textContent || '').replace(/\s+/g, ' ').trim().length >= 50);
    assert.ok(mains.length >= 5, `fixture 應有 >= 5 段主文長 p（實際 ${mains.length}）`);
    for (const p of mains) {
      assert.ok(!isHiddenOrAncestorHidden(p),
        `主文長 p「${p.textContent.slice(0, 16)}…」必須保留可見`);
    }
  });
});
