// JRead — 微信公眾號文章（section 排版內文）偵測（v0.8.132）
// -----------------------------------------------------------------------------
// 對應 bug：https://mp.weixin.qq.com/s/9ICve38TXyVbpTw_uBsvQw 進閱讀模式彈出
// 「此頁無法偵測本文」（Jimmy 2026-06-20 回報）。
//
// 根因（真實頁 probe 確認）：微信公眾號文章整篇內文段落用 <section>（外加 <span>）
// 排版、幾乎不用 <p>，主文容器 #js_content 下只有個位數 <p>。detector heuristic 的
// signal 名單（p / li / h2-4 / pre / blockquote）不認 <section> → 整頁只收到個位數
// signal、bubble-up scoreMap 撐不出任何過門檻的 candidate → heuristic 回 null →
// 偵測失敗。
//
// 修法（結構性通則、非站點特判）：對標 Mozilla Readability 的
// DEFAULT_TAGS_TO_SCORE = "section,h2,h3,h4,h5,h6,p,td,pre"——它把 <section> 當內文
// 段落計分。JRead detector 的 SIGNAL_SEL 加入 section 後，#js_content 以大幅分差
// 勝出（真實頁 probe：score 238.8 vs 第二名 147），promote 升到含標題的 inner
// wrapper。<section> 是 HTML5 通用語意容器，section/p 並存的站點靠 linkDensity
// penalty + textLen bonus 仍讓真主文勝出（既有 MDN / Stratechery 等 spec 護住）。
//
// 本 spec 是 forcing function：sanity 時把 detector.js 的 SIGNAL_SEL 拿掉 ', section'
// → 本檔 detect 應回 null（實證偵測失敗復現），還原 → pass。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'weixin-section-paragraphs.html');

describe('detector — 微信公眾號 section 排版內文偵測（v0.8.132）', () => {
  let document, result;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    document = env.document;
    result = env.NS.detector.detect();
  });

  it('偵測成功，回傳物件而非 null（修「此頁無法偵測本文」）', () => {
    assert.ok(result, '偵測應成功（section 排版內文不得 no-op 回 null）');
  });

  it('走 heuristic 策略（無 <article> / <main>、靠內容密度命中）', () => {
    assert.strictEqual(result.strategy, 'heuristic');
  });

  it('articleEl 含主文容器 #js_content', () => {
    assert.ok(result.el.querySelector('#js_content') || result.el.id === 'js_content',
      'articleEl 應為 #js_content 或其祖先（含主文）');
  });

  it('promote 後 scope 含文章標題 h1（#activity-name）', () => {
    assert.ok(result.el.querySelector('#activity-name'),
      'promote 應把標題 h1.rich_media_title 括進主文 scope');
  });

  it('promotedFrom 為 #js_content（heuristic 落點）', () => {
    assert.ok(result.promotedFrom, 'section 排版下 heuristic 落 #js_content 再 promote 含標題');
    assert.strictEqual(result.promotedFrom.id, 'js_content');
  });

  it('forcing：detector.js 的 SIGNAL_SEL 必須含 section（否則此頁偵測失敗復現）', () => {
    // 純靜態檢查 source——sanity 時實際拿掉 section 重跑會讓上方 detect 回 null。
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'), 'utf8');
    const m = src.match(/const SIGNAL_SEL\s*=\s*'([^']+)'/);
    assert.ok(m, '應找到 SIGNAL_SEL 宣告');
    assert.ok(/(^|[\s,])section([\s,]|$)/.test(m[1]),
      'SIGNAL_SEL 須含 section（對標 Readability DEFAULT_TAGS_TO_SCORE）');
  });
});
