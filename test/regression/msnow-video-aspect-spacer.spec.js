// JRead — collapseEmptyWrappersAfterClean sibling media guard（v0.7.181）
//
// 對應 bug：JW Player / video.js 等 video embed 的空 div（aspect spacer /
// overlay container）被 collapseEmptyWrappersAfterClean 砍掉後 player 高度
// 歸零。典型 case：`.jw-aspect`（padding-top: 56.25% 撐 16:9 容器）無 text、
// 不含 media 子元素（video 在 sibling `.jw-wrapper` 內），原本看起來 = empty
// wrapper → 被 collapse。
//
// 修法：空 div 的 parent 含 video/iframe 的 sibling → 本 div 可能是 player
// layout 輔助元素（aspect ratio spacer / overlay / controls container），
// collapse 會打壞 player，skip。
//
// 通則：video player 跨站結構高度收斂——aspect-ratio spacer + media wrapper
// 並列在同一 parent 是 JW Player / video.js / Brightcove / 各 CMS embed
// 共用 pattern。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'msnow-video-aspect-spacer.html');

describe('cleaner — collapseEmptyWrappersAfterClean sibling media guard（v0.7.181）', () => {
  let window, document, articleEl, hidden;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('[data-test="article-root"]');
    assert.ok(articleEl);

    // jsdom getBoundingClientRect 預設全回 0；需 stub 使其有非零 rect。
    // aspect-spacer height 設 50（< SPACER_MIN_HEIGHT 60）避免被
    // hideInsideArticleEmptySpacers 先吃掉；50 >= EMPTY_COLLAPSE_MIN_HEIGHT 8
    // 使其進入 collapseEmptyWrappersAfterClean 判定——本 spec 要測的就是這條。
    const spacer = document.querySelector('[data-test="aspect-spacer"]');
    const orphan = document.querySelector('[data-test="orphan-empty"]');
    const playerWrapper = document.querySelector('[data-test="player-wrapper"]');
    const video = document.querySelector('video');
    stubRect(spacer, { top: 0, height: 50, width: 200 });
    stubRect(orphan, { top: 400, height: 50, width: 200 });
    // orphan-wrapper 也需 stub（collapseEmptyWrappersAfterClean 遍歷所有子孫）
    const orphanWrapper = document.querySelector('[data-test="orphan-wrapper"]');
    stubRect(orphanWrapper, { top: 390, height: 100, width: 200 });
    stubRect(playerWrapper, { top: 0, height: 80, width: 200 });
    stubRect(video, { top: 0, height: 80, width: 200 });

    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  it('aspect-spacer（空 div、sibling 含 video）不可被 hide', () => {
    const spacer = document.querySelector('[data-test="aspect-spacer"]');
    assert.notStrictEqual(spacer.dataset.jreadHidden, '1',
      'aspect-spacer 的 sibling player-wrapper 含 <video>，' +
      'sibling media guard 應 skip collapse。砍掉此 div 會讓 video player 高度歸零。');
  });

  it('player-wrapper（含 video）不可被 hide', () => {
    const wrapper = document.querySelector('[data-test="player-wrapper"]');
    assert.notStrictEqual(wrapper.dataset.jreadHidden, '1');
  });

  it('sanity：orphan-empty（空 div、無 media sibling）被 hide', () => {
    const orphan = document.querySelector('[data-test="orphan-empty"]');
    assert.strictEqual(orphan.dataset.jreadHidden, '1',
      '孤立空 div（無 text、無 media、無 media sibling）應被 collapseEmptyWrappersAfterClean hide，' +
      '確認 sibling media guard 只保護 video player 附近的空 div、不過度保護。');
  });

  it('主文段落保留', () => {
    const paras = articleEl.querySelectorAll('p');
    assert.ok(paras.length > 0, '至少有一個 p');
    for (const p of paras) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });
});
