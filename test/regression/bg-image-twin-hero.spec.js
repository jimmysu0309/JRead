// JRead — background-image hero 雙胞胎還原（v1.7.17 biosmonthly.com）
//
// 對應 bug：站方桌面版 hero 用容器 background-image 呈現、容器內放同一張圖
// 的 <img> 雙胞胎（stylesheet display:none；行動版變體 visibility:hidden 當
// 比例 spacer）。reader mode 下 hideInsideArticleOriginallyHiddenImgs 釘死
// img + styler 裝飾背景 strip 清掉 bg + 高度 flatten 塌容器 → hero 全滅
//（標題上方沒有主圖）。
//
// 修法：restoreBgImageTwinHeroImgs——img src 與祖先（≤3 層）bg URL 指向
// 同一資產＝同一張 hero 的雙實作，還原 img 進 flow（display / visibility
// 打回可見 inline !important）、容器高度 reset 回內容撐出；bg 交給既有
// 裝飾 strip 清除。順序在釘死 pass 之前（先翻可見，釘死 pass 讀 computed
// display 自動跳過）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'bg-image-twin-hero.html');

describe('cleaner — background-image hero 雙胞胎還原（v1.7.17 biosmonthly）', () => {
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

  it('display:none 雙胞胎 img 被還原 inline display:block !important、不被釘死', () => {
    const img = document.querySelector('#twin-img');
    assert.ok(img);
    assert.notStrictEqual(img.dataset.jreadHidden, '1',
      '雙胞胎 img 不可被 hideInsideArticleOriginallyHiddenImgs 釘死');
    assert.strictEqual(img.style.getPropertyValue('display'), 'block');
    assert.strictEqual(img.style.getPropertyPriority('display'), 'important',
      '必須是 inline !important 才贏得過站方 stylesheet display:none');
  });

  it('visibility:hidden spacer 變體被還原 inline visibility:visible !important', () => {
    const img = document.querySelector('#twin-img-vis');
    assert.ok(img);
    assert.strictEqual(img.style.getPropertyValue('visibility'), 'visible');
    assert.strictEqual(img.style.getPropertyPriority('visibility'), 'important');
  });

  it('bg 容器高度 reset 回內容撐出（height:auto + min-height:0 !important）', () => {
    const host = document.querySelector('#bg-host');
    assert.strictEqual(host.style.getPropertyValue('height'), 'auto');
    assert.strictEqual(host.style.getPropertyPriority('height'), 'important');
    assert.strictEqual(host.style.getPropertyValue('min-height'), '0');
  });

  it('祖先無同 URL bg 的隱藏 img 照舊釘死（v0.8.48 行為不回退）', () => {
    const img = document.querySelector('#fallback-img');
    assert.ok(img);
    assert.strictEqual(img.dataset.jreadHidden, '1');
    assert.strictEqual(img.style.getPropertyValue('display'), 'none');
    assert.strictEqual(img.style.getPropertyPriority('display'), 'important');
  });

  it('退出 reader mode 後 inline override 全數還原（可逆性）', () => {
    window.__JRead.cleaner.restore(hidden);
    const img = document.querySelector('#twin-img');
    assert.strictEqual(img.style.getPropertyValue('display'), '',
      '還原後雙胞胎 img 不應殘留 inline display');
    const imgVis = document.querySelector('#twin-img-vis');
    assert.strictEqual(imgVis.style.getPropertyValue('visibility'), '');
    const host = document.querySelector('#bg-host');
    assert.strictEqual(host.style.getPropertyValue('height'), '600px',
      '還原後容器應回到站方 inline height');
  });
});
