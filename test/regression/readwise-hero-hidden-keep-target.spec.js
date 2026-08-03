// JRead — regression spec: hero 保留目標不可落在 display:none 副本上（v1.7.31）
//
// Trigger: Jimmy 2026-08-03 回報——The Verge 譯文存 Readwise 後，Reader web（macOS
// Chrome）與 JReader 都看不到 hero，只有手機 Reader app 的 metadata cover 正常；
// 檢查 html_content 發現 hero <img> 整個不在、只剩 figcaption 孤兒。
//
// 根因（probe 於真實 theverge.com 390px viewport 實證）：art-direction 雙副本站點
// 在窄 viewport 下，DOM 第一張 hero 是 display:none 的桌機副本（已載入、natural
// 尺寸過門檻）。findLeadingHeroImage 只跳過 [data-jread-hidden]、不看站方 CSS 的
// display:none → 保留目標選到隱藏副本：
//   1. markHeroImageForExport 把「可見副本」當多餘重複剝除
//   2. stripHiddenForExport 把「隱藏副本」（保留目標自己）整棵剝除
//   → 兩張全滅、Readwise body 無 hero（雙規則共用同一盲點——多層規則的 keep
//   判定不可建立在會被後層剝除的節點上）。
//
// 修法（結構通則）：findLeadingHeroImage 優先選「不在 display:none 子樹內」的可見
// 副本當保留目標；全部隱藏才退回 DOM 第一張可用副本（image_url 仍有值）。
// 單一資料源——extractHeroImage（image_url）與 markHeroImageForExport（body 去重）
// 共用此函式，兩端自動一致。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'readwise-hero-hidden-keep-target.html');
const HERO_PATH = '/uploads/2026/08/hero.jpg';
const BASE = 'https://www.example.com/article';

// jsdom 不算 layout：naturalWidth stub 成實機尺寸讓尺寸門檻（>= 200×200）命中。
// 注意：隱藏副本也要 stub——真實 Chrome 中 lede 圖 loading=eager、display:none
// 仍會載入，natural 尺寸非 0（這正是它能通過門檻被選中的原因）。
function stubNatural(img, w, h) {
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
}

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: [],
    pretendToBeVisual: true
  });
  const { document } = env;
  stubNatural(document.getElementById('hero-desktop'), 700, 470);
  stubNatural(document.getElementById('hero-mobile'), 700, 470);
  stubNatural(document.getElementById('inline-img'), 700, 470);
  return env;
}

describe('readwise — hero 保留目標避開 display:none 副本（v1.7.31）', () => {
  it('findLeadingHeroImage 跳過 DOM 第一張隱藏副本、選可見副本當保留目標', () => {
    const { document, NS } = setup();
    const hero = NS.findLeadingHeroImage(document.getElementById('story'), BASE);
    assert.ok(hero && hero.img, '必須選到 hero');
    assert.strictEqual(hero.img.id, 'hero-mobile',
      '保留目標必須是可見副本（DOM 第一張在 display:none 子樹內、匯出時會被 stripHiddenForExport 剝除）');
    assert.strictEqual(new URL(hero.url).pathname, HERO_PATH);
  });

  it('markHeroImageForExport 剝隱藏副本、保留可見副本', () => {
    const { document, NS } = setup();
    NS.markHeroImageForExport(document.getElementById('story'));
    assert.ok(!document.getElementById('hero-mobile').closest('[data-jread-rw-strip="1"]'),
      '可見副本（保留目標）不可被標記');
    assert.ok(document.getElementById('hero-desktop').closest('[data-jread-rw-strip="1"]'),
      '隱藏的桌機副本是多餘重複、標記剝除');
  });

  it('端到端：markHero + stripHidden + clone 移除後，恰存活 1 張 hero（不可全滅）', () => {
    // 對應 buildCleanHtml 的實際順序：markHeroImageForExport → stripHiddenForExport
    // → clone → 移除 [data-jread-rw-strip]。修法前保留目標在隱藏子樹內，兩條規則
    // 聯手把兩張副本全剝 → clone 內 hero 數 0（Jimmy 回報的症狀）。
    const { document, NS } = setup();
    const story = document.getElementById('story');
    const heroMarked = NS.markHeroImageForExport(story);
    const hiddenMarked = NS.stripHiddenForExport(story);
    const clone = story.cloneNode(true);
    clone.querySelectorAll('[data-jread-rw-strip="1"]').forEach(n => n.remove());
    heroMarked.forEach(el => el.removeAttribute('data-jread-rw-strip'));
    hiddenMarked.forEach(el => el.removeAttribute('data-jread-rw-strip'));
    const survivors = Array.from(clone.querySelectorAll('img')).filter(img => {
      try { return new URL(img.getAttribute('src'), BASE).pathname === HERO_PATH; }
      catch (_) { return false; }
    });
    assert.strictEqual(survivors.length, 1, 'Readwise body 必須恰有 1 張 hero（0 = 全滅回歸、2 = 重複回歸）');
    assert.ok(clone.querySelector('#hero-cap'), 'hero 圖說保留');
    assert.ok(clone.querySelector('#inline-img'), '內文配圖不受影響');
  });

  it('卡片內全部 img 都隱藏時退回 DOM 第一張可用副本（image_url 不可空手而回）', () => {
    const { document, NS } = setup();
    document.getElementById('wrap-mobile').style.display = 'none';
    document.getElementById('inline-fig').remove(); // 只剩兩張全隱藏的 hero 副本
    const hero = NS.findLeadingHeroImage(document.getElementById('story'), BASE);
    assert.ok(hero && hero.url, '全隱藏時仍要回傳 URL 供 image_url 使用（維持修法前行為）');
    assert.strictEqual(new URL(hero.url).pathname, HERO_PATH);
  });

  it('部分隱藏、卡片內另有可見內容圖時，cover 選可見那張（不選隱藏 hero）', () => {
    // 可見優先是通則：hero 副本全隱藏但內文有可見配圖 → cover 用可見配圖
    // （隱藏 hero 匯出後 body 也不會有，metadata cover 與 body 一致性更好）
    const { document, NS } = setup();
    document.getElementById('wrap-mobile').style.display = 'none';
    const hero = NS.findLeadingHeroImage(document.getElementById('story'), BASE);
    assert.strictEqual(hero.img.id, 'inline-img');
  });
});
