// JRead — roomie.tw 手機版 hashtag meta bar 殘留修正（v0.8.29）
//
// 對應 fixture：test/regression/fixtures/roomie-mobile-hashtag-meta-bar.html
// iOS 專屬殘留：閱讀模式下 .single-meta 那列 hashtag（#一日百元生活圈
// #公車指南 ...）整列冒出，桌面 Chrome / Safari 不會。
//
// 根因（probe 實測：桌面與 iPhone DOM 完全相同）：
//   .single-meta 內 8 個 anchor = 2 個分類連結（TRAVEL/CULTURE、一日百元生活圈）
//   + 6 個 #hashtag → hashtag ratio = 6/8 = 0.75，卡在 HASHTAG_RATIO=0.8 門檻下。
//   桌面被站方 CSS media query `.mobile-info{display:none}` 藏住、手機才顯示，
//   所以只在 iOS 露餡（非 WebKit 引擎差異，是偵測門檻問題）。
//
// 修法：hideInsideArticleHashtagClusters 新增 tag-bar 判定——hashtag 絕對數 >= 3
//   且其餘非 # anchor 全是短連結（<= TAG_BAR_ANCHOR_MAX_LEN=24 字）時，即使
//   ratio < 0.8 也視為 tag bar → hide。
//
// 此 fixture 的 class（single-meta / mobile-info / .tag）刻意不在 NOISE_KEYWORD_RE
// 內（meta / info / 單字 tag 都被排除），確保 hide 只能來自 hashtag cluster 的
// 新 tag-bar path，是有效 forcing function。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'roomie-mobile-hashtag-meta-bar.html');

function isHiddenOrAncestorHidden(el) {
  let cur = el;
  while (cur && cur !== cur.ownerDocument.body) {
    if (cur.dataset && cur.dataset.jreadHidden === '1') return true;
    cur = cur.parentElement;
  }
  return false;
}

describe('cleaner — roomie.tw 手機版 hashtag meta bar（ratio 0.75）被 tag-bar path hide（v0.8.29）', () => {
  let window, document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 390, height: 844 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    const detected = window.__JRead.detector.detect();
    assert.ok(detected && detected.el, 'detector 應命中 fixture 主文容器');
    articleEl = detected.el;
    window.__JRead.cleaner.clean(articleEl);
  });

  it('前置條件：.single-meta 的 hashtag ratio = 6/8 = 0.75 < 0.8（確認走的是新 tag-bar path）', () => {
    const meta = document.querySelector('.single-meta');
    assert.ok(meta, 'fixture 應有 .single-meta');
    const anchors = Array.from(meta.querySelectorAll('a'));
    const hash = anchors.filter(a => a.textContent.trim().startsWith('#'));
    assert.strictEqual(anchors.length, 8, '.single-meta 應有 8 個 anchor');
    assert.strictEqual(hash.length, 6, '其中 6 個是 #hashtag');
    assert.ok(hash.length / anchors.length < 0.8,
      'ratio 必須 < 0.8，否則走的是舊 ratio path、無法 forcing 新 tag-bar 邏輯');
  });

  it('核心：.single-meta 整列 tag bar 被 hide', () => {
    const meta = document.querySelector('.single-meta');
    assert.ok(isHiddenOrAncestorHidden(meta),
      '.single-meta（分類連結 + hashtag 混排，ratio 0.75）必須被 tag-bar path hide');
  });

  it('每個 #hashtag 連結都不可見', () => {
    const hashAnchors = Array.from(document.querySelectorAll('.single-meta a'))
      .filter(a => a.textContent.trim().startsWith('#'));
    assert.strictEqual(hashAnchors.length, 6);
    for (const a of hashAnchors) {
      assert.ok(isHiddenOrAncestorHidden(a), `hashtag「${a.textContent.trim()}」應被 hide`);
    }
  });

  it('media guard：外層 .mobile-info 含 hero figure → hero 圖必須保留（不被遞迴命中誤殺）', () => {
    const heroImg = document.getElementById('hero-img');
    const heroFig = document.getElementById('hero-fig');
    assert.ok(heroImg && heroFig, 'fixture 應有 hero figure + img');
    assert.ok(!isHiddenOrAncestorHidden(heroImg),
      'hero img 必須保留——media guard 讓含 <img> 的外層 wrapper 被 skip');
    assert.ok(!isHiddenOrAncestorHidden(heroFig), 'hero figure 必須保留');
  });

  it('主文 h1 + 三段內文保留（無誤殺）', () => {
    const h1 = document.querySelector('h1');
    assert.ok(h1 && !isHiddenOrAncestorHidden(h1), 'h1 主標題保留');
    const ps = Array.from(document.querySelectorAll('article > p'));
    assert.strictEqual(ps.length, 3, 'fixture 有三段主文 p');
    for (const p of ps) {
      assert.ok(!isHiddenOrAncestorHidden(p), `主文段落「${p.textContent.slice(0, 12)}…」必須保留`);
    }
  });
});
