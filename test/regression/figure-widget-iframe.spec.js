// JRead — figure 包未知 widget iframe（v0.8.48，page rounds 第五輪 propublica C1/A3）
//
// 對應 bug：propublica.org「Listen to this article」音訊播放器整條殘留 +
// 其下大空白。播放器 iframe 包在 <figure> 內（WordPress block 慣例），
// PRESERVE_SEL 對 figure 的保護讓 hideInsideArticleThirdPartyIframes 掃不進去。
//
// 修法：hideInsideArticleFigureWidgetIframes——figure 內含非白名單 iframe +
// 無 img/picture/video + iframe rendered 高度 0 < h < 200px → hide 整個 figure。
// 控制組：YouTube embed figure（白名單）、真媒體 figure（img）都保留。
//
// jsdom rect 全 0 → 用 stubRect 模擬 iframe rendered 高度。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'figure-widget-iframe.html');

describe('cleaner — figure 包未知 widget iframe（v0.8.48 propublica）', () => {
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
    // 模擬 rendered 高度：播放器 121px（widget 量級）、YouTube 315px
    stubRect(document.querySelector('#player-iframe'), { top: 100, width: 752, height: 121 });
    stubRect(document.querySelector('#youtube-iframe'), { top: 600, width: 560, height: 315 });
    window.__JRead.cleaner.clean(articleEl);
  });

  it('widget iframe 的 figure 整塊被 hide', () => {
    const fig = document.querySelector('#player-figure');
    assert.ok(fig);
    assert.strictEqual(fig.dataset.jreadHidden, '1',
      '未知 src + 高度 < 200px + 無 img 的 iframe figure 必須整塊 hide');
  });

  it('YouTube embed figure（白名單）保留', () => {
    const fig = document.querySelector('#youtube-figure');
    assert.ok(fig);
    assert.notStrictEqual(fig.dataset.jreadHidden, '1');
  });

  it('真媒體 figure（img + figcaption）保留', () => {
    const fig = document.querySelector('#photo-figure');
    assert.ok(fig);
    assert.notStrictEqual(fig.dataset.jreadHidden, '1');
  });

  it('主文 p 全保留', () => {
    for (const p of document.querySelectorAll('article > p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });
});
