// JRead — regression spec: Readwise 匯出去除多餘重複 hero 主圖（v0.8.124 → v0.8.125）
//
// Trigger: Jimmy 2026-06-19 theverge.com hands-on 回報——送到 Readwise Reader 後
// hero image 重複顯示（兩張）。
//
// 根因：Readwise reading view 的 hero 完全來自 body（image_url 只當資料庫縮圖、不在
// reading view render）。The Verge 用 art-direction 把 hero 渲染成兩張同圖（桌機
// `_1044qizn` + 手機 `_1044qizm`，?w= 不同、pathname 相同），各自 media query 顯示；
// Readwise 端無 CSS 兩張都現 → 重複。
//
// 修法演進：v0.8.124 移除 body 內**全部**同圖 → hero 消失（Jimmy 回報「不見了」）。
// v0.8.125 正解：**保留第一張（findLeadingHeroImage 選到的可見最佳副本）、只移除其餘
// 多餘副本**。單一 hero 站點不移除任何東西。比對 URL pathname（忽略 ?w= query）。
// figcaption 不在標記範圍 → 圖說保留。
//
// 本 spec 驗 NS 標記邏輯（jsdom，stub naturalWidth）。真實 Chrome 端到端（payload
// body 保留 1 張 hero、image_url 仍為 hero、caption 保留）在 Playwright harness 驗過。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'readwise-hero-dup.html');
const HERO_PATH = '/uploads/2026/06/hero.jpg';

// jsdom 不算 layout：naturalWidth/getBoundingClientRect 皆 0。stub 成實機尺寸讓
// hero finder 的尺寸門檻（natural >= 200×200）命中。
function stubNatural(img, w, h) {
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
}

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: [], // 只需 namespace（helper 必載）
    pretendToBeVisual: true
  });
  const { document, NS } = env;
  // 三張圖都標成內容圖尺寸（hero 兩變體 + inline 配圖）
  stubNatural(document.getElementById('hero-desktop'), 700, 470);
  stubNatural(document.getElementById('hero-mobile'), 700, 470);
  stubNatural(document.getElementById('inline-img'), 700, 470);
  return { document, NS };
}

describe('readwise — 去除多餘重複 hero、保留一張（v0.8.125）', () => {
  it('NS.findLeadingHeroImage / markHeroImageForExport 存在（namespace.js 單一資料源）', () => {
    const { NS } = setup();
    assert.strictEqual(typeof NS.findLeadingHeroImage, 'function');
    assert.strictEqual(typeof NS.markHeroImageForExport, 'function');
  });

  it('findLeadingHeroImage 選到第一張 hero、URL pathname 正確', () => {
    const { document, NS } = setup();
    const hero = NS.findLeadingHeroImage(document.getElementById('story'), 'https://www.theverge.com/article');
    assert.ok(hero && hero.img, '必須選到 hero img');
    assert.strictEqual(hero.img.id, 'hero-desktop', 'DOM order 第一張大圖（srcset 最大變體）');
    assert.strictEqual(new URL(hero.url).pathname, HERO_PATH, 'hero URL pathname = hero.jpg');
  });

  it('(A) 保留第一張 hero、只移除多餘的重複變體（v0.8.125）', () => {
    // Readwise reading view 的 hero 完全來自 body（image_url 只是縮圖、不 in-view
    // render），故必須**保留一張**、只移除 art-direction 多餘副本。全移會讓 hero
    // 消失（Jimmy 2026-06-19 回報「hero 不見了」）。
    const { document, NS } = setup();
    const marked = NS.markHeroImageForExport(document.getElementById('story'));
    assert.ok(!document.getElementById('hero-desktop').closest('[data-jread-rw-strip="1"]'),
      '第一張（findLeadingHeroImage 選到的）hero 必須保留、不可被標記移除');
    assert.ok(document.getElementById('hero-mobile').closest('[data-jread-rw-strip="1"]'),
      '多餘的手機 hero 變體（同 pathname）必須被標記移除');
    assert.strictEqual(marked.length, 1, '只移除 1 張多餘副本、保留 1 張 hero');
  });

  it('(A2) 單一 hero（無 art-direction 副本）不移除任何東西', () => {
    const { document, NS } = setup();
    document.getElementById('hero-mobile').remove(); // 只剩桌機一張 hero
    const marked = NS.markHeroImageForExport(document.getElementById('story'));
    assert.strictEqual(marked.length, 0, '只有一張 hero 時不移除（否則 hero 消失）');
    assert.ok(!document.getElementById('hero-desktop').closest('[data-jread-rw-strip="1"]'),
      '唯一的 hero 必須保留');
  });

  it('(B) 內文配圖（不同 pathname）不被標記', () => {
    const { document, NS } = setup();
    NS.markHeroImageForExport(document.getElementById('story'));
    assert.ok(!document.getElementById('inline-img').closest('[data-jread-rw-strip="1"]'),
      '內文 usbc.jpg 配圖 pathname 不同、不可被當 hero 去重');
  });

  it('(C) hero 圖說（figcaption）不被標記——cover 下方說明保留', () => {
    const { document, NS } = setup();
    NS.markHeroImageForExport(document.getElementById('story'));
    assert.ok(!document.getElementById('hero-cap').closest('[data-jread-rw-strip="1"]'),
      'hero figcaption 必須保留（Readwise 顯示成 cover 說明、資訊不流失）');
  });

  it('(D) 無可用 hero（皆 data:/blob:）時不標記任何 img', () => {
    const { document, NS } = setup();
    ['hero-desktop', 'hero-mobile', 'inline-img'].forEach(id => {
      const img = document.getElementById(id);
      img.setAttribute('src', 'data:image/gif;base64,R0lGOD');
      img.removeAttribute('srcset');
    });
    const marked = NS.markHeroImageForExport(document.getElementById('story'));
    assert.strictEqual(marked.length, 0, 'data:/blob: 不是可用 cover、不去重');
  });
});
