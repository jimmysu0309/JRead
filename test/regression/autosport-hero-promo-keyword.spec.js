// JRead — hero 主圖容器 class 含非 strong noise keyword 不可被 hide（v0.8.119）
//
// 對應 bug：autosport.com（Motorsport CMS）主圖容器 class `ms-entity-promo`，
// `promo` token 命中 NOISE_KEYWORD_RE。該 div 內只有一張 standalone hero
// <picture>（無 h1 / 無 p / 無文字），keywordWrapperIsProtected 的 h1 guard
// 與 main-content-p guard 全 miss → 整塊被 hide、主圖連帶 0×0 消失。
//
// 修法（cleaner.js keywordWrapperIsProtected）：非 strong keyword 命中、但內含
// standalone content image 的 wrapper 一律保留。strong keyword（related 等
// 明確廣告語意）與「img 包在 <a> 內」的連結縮圖不享此豁免（判別力控制組）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'autosport-hero-promo-keyword.html');

describe('cleaner — hero 主圖容器含 promo keyword 不可被 hide（v0.8.119）', () => {
  let document;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    document = env.document;
    const articleEl = document.querySelector('article#story');
    assert.ok(articleEl);

    // 模擬 hero 圖已載入（natural 1000×665）——驗 containsStandaloneContentImg
    // 的「loaded 大圖」路徑（w>=200 && h>=150），不只靠 unloaded（w<=8）保守豁免。
    const heroImg = document.getElementById('hero-img');
    Object.defineProperty(heroImg, 'naturalWidth', { value: 1000, configurable: true });
    Object.defineProperty(heroImg, 'naturalHeight', { value: 665, configurable: true });
    // 控制組 B 的 related 圖也設成已載入大圖——確認被 hide 不是因為它 unloaded
    const relImg = document.getElementById('related-img');
    Object.defineProperty(relImg, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(relImg, 'naturalHeight', { value: 533, configurable: true });

    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('hero 主圖容器（promo keyword + standalone img）被保留', () => {
    const hero = document.getElementById('hero-promo');
    assert.ok(hero);
    assert.notStrictEqual(hero.dataset.jreadHidden, '1',
      'ms-entity-promo（promo token 命中）內含 standalone hero 圖，不可被 hide');
  });

  it('hero <img> 本身被保留', () => {
    const img = document.getElementById('hero-img');
    assert.notStrictEqual(img.dataset.jreadHidden, '1');
    // 祖先鏈無任何 data-jread-hidden（display:none 祖先會讓圖 0×0 消失）
    let cur = img;
    while (cur && cur.id !== 'story') {
      assert.notStrictEqual(cur.dataset.jreadHidden, '1',
        `hero 祖先不可被 hide: ${cur.tagName}.${cur.className}`);
      cur = cur.parentElement;
    }
  });

  it('控制組 A：連結縮圖式 promo（img 包在 <a> 內）仍被 hide', () => {
    const linked = document.getElementById('linked-promo');
    assert.strictEqual(linked.dataset.jreadHidden, '1',
      'img 包在 <a> 內＝連結縮圖、非 standalone content image，不享豁免');
  });

  it('控制組 B：strong keyword（related-articles）含 standalone 圖仍被 hide', () => {
    const rel = document.getElementById('related-strong');
    assert.strictEqual(rel.dataset.jreadHidden, '1',
      'related-articles 是 strong keyword、明確廣告/推薦語意，standalone 圖不享豁免');
  });

  it('主文 p 全保留', () => {
    for (const p of document.querySelectorAll('article#story > p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 p 不可被 hide: "${p.textContent.slice(0, 30)}…"`);
    }
  });
});
