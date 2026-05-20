// JRead — regression spec: chart embed iframe whitelist 擴充 (v0.7.150)
// -----------------------------------------------------------------------------
// Forcing function for KNOWN_MEDIA_IFRAME_SEL v0.7.150 擴充。
// Trigger: Jimmy 2026-05-20 回報 healthsystemtracker.org datawrapper 圖表消失。
//
// Root cause: cleaner.hideInsideArticleThirdPartyIframes (v0.7.32) whitelist
// 只含 YouTube / Vimeo 等影音 embed。datawrapper / flourish / tableau /
// plotly / highcharts / observable / infogram 是新聞站做數據圖最常見服務
// 但不在 whitelist、全被視為 third-party noise hide。
//
// v0.7.150 修法：擴 whitelist 加上述 chart embed services（等同 YouTube 級
// 主文內容）。
//
// 6 條 forcing function:
//   (a) datawrapper iframe 保留
//   (b) flourish iframe 保留
//   (c) tableau iframe 保留
//   (d) plotly iframe 保留
//   (e) infogram iframe 保留
//   (f) 未知 host iframe（例隨機 ad CDN）仍被 hide（v0.7.32 防護不退步）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'health-datawrapper-chart.html');

describe('cleaner — chart embed whitelist (v0.7.150)', function() {
  this.timeout(10000);
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
    articleEl = document.querySelector('article');
    assert.ok(articleEl);
    window.__JRead.cleaner.clean(articleEl);
  });

  function notHidden(testId, label) {
    const el = articleEl.querySelector(`[data-test="${testId}"]`);
    assert.ok(el, `${label} iframe (${testId}) 必須存在於 fixture`);
    assert.notStrictEqual(el.dataset.jreadHidden, '1',
      `${label} iframe 不可被 hide（chart embed whitelist 必須命中），實際 hidden=${el.dataset.jreadHidden}`);
    assert.notStrictEqual(el.style.display, 'none',
      `${label} iframe inline display 不可為 none`);
  }

  it('(a) datawrapper iframe 保留（核心 case—Jimmy 回報）', () => {
    notHidden('datawrapper-iframe', 'datawrapper');
  });

  it('(b) flourish iframe 保留', () => {
    notHidden('flourish-iframe', 'flourish');
  });

  it('(c) tableau iframe 保留', () => {
    notHidden('tableau-iframe', 'tableau');
  });

  it('(d) plotly iframe 保留', () => {
    notHidden('plotly-iframe', 'plotly');
  });

  it('(e) infogram iframe 保留', () => {
    notHidden('infogram-iframe', 'infogram');
  });

  it('(f) 未知 host iframe 仍被 hide（v0.7.32 防護不退步）', () => {
    const unk = articleEl.querySelector('[data-test="unknown-iframe"]');
    assert.ok(unk, '未知 iframe 必須存在於 fixture');
    assert.strictEqual(unk.dataset.jreadHidden, '1',
      '未知 host iframe 必須被 hide（whitelist 沒命中應走 third-party iframe rule），實際 hidden=' + unk.dataset.jreadHidden);
  });
});
