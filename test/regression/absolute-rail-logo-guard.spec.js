// JRead — absolute overlay media guard 細分（v0.8.48，page rounds 第五輪
// healthsystemtracker C6+D 0 寬塌縮疊印）
//
// 對應 bug：healthsystemtracker.org「About this site」推廣框住在
// position:absolute 全欄高 sidebar rail 內，rail 含 102×34 小 logo IMG ——
// hideInsideArticleAbsoluteOverlays 的 v0.7.170「含 img 就跳過」guard 被
// logo 誤觸發 → rail 殘留、reader 下塌縮 0 寬、文字疊印在 Methods 內文上
// （narrow-text 信號 boxWidth=0 來源）。
//
// 修法：guard 細分 containsContentScaleImg——已載入的小 logo 不算內容媒體；
// 未載入（naturalWidth <= 8）與內容級尺寸照舊保護（CNBC lazy hero 教訓）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'hst-absolute-rail-logo.html');

function setNatural(img, w, h) {
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
}

describe('cleaner — absolute rail 小 logo guard 細分（v0.8.48 healthsystemtracker）', () => {
  let window, document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('article#story');
    assert.ok(articleEl);
    // 模擬已載入的小 logo（natural 210×70 / rendered 102×34）
    const logo1 = document.querySelector('#small-logo');
    const logo2 = document.querySelector('#small-logo-2');
    setNatural(logo1, 210, 70); stubRect(logo1, { top: 100, width: 102, height: 34 });
    setNatural(logo2, 156, 70); stubRect(logo2, { top: 140, width: 75, height: 34 });
    // 控制組：內容級大圖（已載入 1200×675）
    const hero = document.querySelector('#hero-img');
    setNatural(hero, 1200, 675); stubRect(hero, { top: 600, width: 760, height: 428 });
    window.__JRead.cleaner.clean(articleEl);
  });

  it('absolute rail（內含小 logo）被 hide', () => {
    const rail = document.querySelector('#promo-rail');
    assert.ok(rail);
    assert.strictEqual(rail.dataset.jreadHidden, '1',
      '小 logo 不可再觸發 v0.7.170 media guard 豁免 absolute rail');
  });

  it('absolute 媒體 wrapper（內容級大圖）保留', () => {
    const wrapper = document.querySelector('#media-wrapper');
    assert.ok(wrapper);
    assert.notStrictEqual(wrapper.dataset.jreadHidden, '1',
      'CNBC pattern：absolute wrapper 內含內容級 img 必須照舊保護');
  });

  it('主文 p 全保留', () => {
    for (const p of document.querySelectorAll('.entry-content-center > p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });
});
