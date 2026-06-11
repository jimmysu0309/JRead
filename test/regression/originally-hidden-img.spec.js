// JRead — 原站隱藏 img 釘死（v0.8.48，page rounds 第五輪 healthsystemtracker
// 圖表雙份 + E1/E5 暗色透明副本不可讀）
//
// 對應 bug：datawrapper embed 的 no-JS fallback <img>（stylesheet
// display:none）被 styler 的 `img { display:block !important }`（v0.7.87）
// 復活——每張圖表出現兩份連續副本；fallback full.png 透明底在暗色主題下
// 文字不可讀。
//
// 修法：hideInsideArticleOriginallyHiddenImgs——clean 時 computed
// display:none 的 img 用 hide() 釘 inline !important（贏過 styler
// stylesheet rule），維持原站隱藏狀態；退出 reader 統一回復。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'originally-hidden-img.html');

describe('cleaner — 原站隱藏 img 釘死（v0.8.48 healthsystemtracker）', () => {
  let window, document, articleEl, hidden;

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
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  it('stylesheet display:none 的 fallback img 被釘 inline !important', () => {
    const img = document.querySelector('#fallback-img');
    assert.ok(img);
    assert.strictEqual(img.dataset.jreadHidden, '1');
    assert.strictEqual(img.style.getPropertyValue('display'), 'none');
    assert.strictEqual(img.style.getPropertyPriority('display'), 'important',
      '必須是 inline !important 才贏得過 styler 的 display:block !important');
  });

  it('可見的內容 img 不被動', () => {
    const img = document.querySelector('#visible-img');
    assert.ok(img);
    assert.notStrictEqual(img.dataset.jreadHidden, '1');
  });

  it('釘住的 img 在 hidden 清單內（退出 reader 可回復）', () => {
    const img = document.querySelector('#fallback-img');
    assert.ok(hidden.some(h => h.el === img),
      'fallback img 必須進 hidden 清單，restore 流程才會回復');
  });
});
