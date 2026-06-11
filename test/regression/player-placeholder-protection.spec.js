// JRead — regression spec: video player 佔位保護 (v0.8.45 ms.now A3)
// -----------------------------------------------------------------------------
// ms.now JW Player 實測：player 佔位被三條 jread 規則圍毆——
//   1. capWrapperSpacing 把 .jw-aspect 的 padding-top: 540px cap 成 16px
//   2. absolute overlay 的 parentHeightResets 把 jw-wrapper 高度打 auto
//   3. collapseInnerGridFlex 把含 player 的固定欄寬 grid collapse
// 佔位塌成 16px 後 JW JS 以負 margin 把 video 置中於塌掉的容器 → video
// 突出 342px 蓋住 dek 文字 + 流空間錯位出 245px 假空白（gap audit y=206）。
//
// v0.8.45 修法（三條 guard，皆結構判定不綁 class）：
//   1. capWrapperSpacing：parent 含 video / iframe sibling 的 wrapper 大
//      padding 是媒體佔位、不 cap（v0.7.181 同款 guard）
//   3. collapseInnerGridFlex：子樹含 visible video / iframe 的 grid 跳過
// （guard 2 在 hideInsideArticleAbsoluteOverlays 的 parent reset，jsdom 無
//  rect 不觸發該規則，由真實 harness 驗，本 spec 驗 1 與 3）
//
// 另驗 styler 媒體規則 min-height: 0（cw.com.tw A4：站點 hero img
// min-height: 645px 頂住 height:auto，object-fit contain letterbox 出
// 上下 ~118px 假空白）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'player-placeholder-protection.html');

describe('cleaner — player 佔位保護（v0.8.45）', () => {
  let document, articleEl, env;

  before(() => {
    env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.getElementById('post');
    articleEl.setAttribute('data-jread-active', '1');
    env.NS.cleaner.clean(articleEl, []);
  });

  it('aspect spacer（大 padding-top + video sibling）不可被 capWrapperSpacing 打掉', () => {
    const spacer = document.querySelector('.aspect-spacer');
    assert.ok(spacer, 'fixture 應有 aspect-spacer');
    const inlinePT = spacer.style.getPropertyValue('padding-top');
    assert.strictEqual(inlinePT, '340px',
      `aspect spacer 的 padding-top 必須保持原值（實際 inline: "${inlinePT}"）——cap 成 16px 會讓 player 佔位塌掉`);
  });

  it('含 visible video 的 grid wrapper 不可被 collapseInnerGridFlex 打掉', () => {
    const grid = document.querySelector('.video-grid');
    assert.ok(grid, 'fixture 應有 video-grid');
    assert.ok(!grid.style.getPropertyValue('grid-template-columns').includes('none'),
      '含 video 的固定欄寬 grid 不可被 collapse（grid rows / 佔位高度會跟著塌）');
  });

  it('主文段落必須保留', () => {
    let visible = 0;
    for (const p of articleEl.querySelectorAll('p')) {
      if (!p.closest('[data-jread-hidden="1"]')) visible++;
    }
    assert.strictEqual(visible, 3, '三段主文全保留');
  });
});

describe('styler — 媒體 min-height 清除（v0.8.45 cw.com.tw A4）', () => {
  it('媒體規則必須含 min-height: 0（站點 min-height 佔位會頂住 height:auto 造成 letterbox）', () => {
    const env2 = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'styler']
    });
    const detected = env2.NS.detector.detect();
    assert.ok(detected);
    env2.NS.styler.apply(detected.el, { theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7 });
    const css = env2.document.getElementById('__jread-style').textContent;
    const mediaRule = css.match(/\[data-jread-active="1"\] img:not\(a > img\),[^{]*\{[^}]*\}/);
    assert.ok(mediaRule, '必須有媒體寬高規則');
    assert.ok(/min-height:\s*0\s*!important/.test(mediaRule[0]),
      '媒體規則必須含 min-height: 0 !important（cw hero img 站點 min-height 645px letterbox 實證）');
  });
});
