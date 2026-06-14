// JRead — 內文藝術電商 CTA widget 殘留修正（v0.8.60）
//
// Bug：myartbroker.com 文章內嵌「Interested in buying or selling a print? +
// Buy art + Sell art」促銷 widget（MagazineArticleExpert）未被清，page-rounds
// harness overflow FAIL（widget w382 > card 360，Jimmy 2026-06-14）。
//
// 根因：widget 的 CTA link 是 <a> 非 button（不被「所有 button 無條件清」涵蓋），
// 且桌面版 link 文字帶 SVG arrow 前綴變「ArrowBuy art」→ link 文字 heuristic
// 不穩。widget 也不在 section/aside 內。
//
// 修法（結構通則，不綁站點 / class hash）：穩定訊號是 prompt
// 「Interested in buying or selling a print?」（p.title，各 instance / 各寬度
// 一致）。把 `^interested in (buying|selling|...)` 加進 NOISE_HEADING_TEXT_EXT_RE
// （<= 40 chars 的 div/span/p direct text 掃描），heading walk-up
// （findSafeWrapperForHeading 主文保護）整塊清掉 widget，主文段落不受影響。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'myartbroker-expert-cta-widget.html');

describe('cleaner — 內文藝術電商 CTA widget 整塊清（v0.8.60 myartbroker）', () => {
  let window, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    const detected = window.__JRead.detector.detect();
    assert.ok(detected && detected.el, 'detector 應命中 fixture 主文');
    articleEl = detected.el;
    window.__JRead.cleaner.clean(articleEl);
  });

  function isHidden(el) {
    return !!(el && el.closest && el.closest('[data-jread-hidden="1"]'));
  }

  it('CTA widget（含 prompt + Buy/Sell 連結 + 頭像）整塊被 hide', () => {
    const widget = articleEl.querySelector('.MagazineArticleExpert_sticky__DmZP_');
    assert.ok(widget, 'fixture 應有 CTA widget');
    assert.ok(isHidden(widget), 'CTA widget 必須被 hide（heading walk-up 整塊清）');
  });

  it('widget 內的 prompt / Buy art / Sell art 都不再可見', () => {
    const prompt = articleEl.querySelector('.MagazineArticleExpert_title__6WJPE');
    const links = articleEl.querySelectorAll('.MagazineArticleExpert_ctas__LFZva a');
    assert.ok(isHidden(prompt), 'prompt 必須被 hide');
    assert.ok(links.length === 2, 'fixture 應有 2 個 CTA 連結');
    for (const a of links) assert.ok(isHidden(a), `CTA 連結「${a.textContent}」必須被 hide`);
  });

  it('主文段落（>= 100 chars 的 p）與標題全部保留', () => {
    const ps = articleEl.querySelectorAll('p');
    let longP = 0;
    for (const p of ps) {
      const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
      // prompt 那段（< 60 chars）排除；只看主文長段
      if (text.length >= 100) {
        assert.ok(!isHidden(p), `主文段落不可被誤殺：「${text.slice(0, 30)}…」`);
        longP++;
      }
    }
    assert.ok(longP >= 3, `應保留 >= 3 段主文 p（實際 ${longP}）`);
    const h1 = articleEl.querySelector('h1');
    const h2 = articleEl.querySelector('h2');
    assert.ok(h1 && !isHidden(h1), 'h1 標題必須保留');
    assert.ok(h2 && !isHidden(h2), 'h2 章節標題必須保留');
  });
});
