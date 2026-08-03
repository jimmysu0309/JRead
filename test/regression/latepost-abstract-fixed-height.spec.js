// JRead — latepost 摘要縮圖盒固定高度裁切（v1.7.34 圖疊文）
// 對應 fixture：test/regression/fixtures/latepost-abstract-fixed-height.html
//
// 根因（真站 probe 實證）：.abstract-pic（flex 兩欄：左摘要文字 + 右封面縮圖
// 267×249）stylesheet 固定 height 2.8rem=249px；collapseInnerFlexWrap 的
// twoColLede 分支塌欄後 child 撐滿容器寬、封面圖（natural 1280×1023）upscale
// 到全寬 486px → 溢出 249px 盒（overflow visible）疊壓後續段落。
// 修法：塌欄時 containerMediaGrowthClips 預測（visible child 子樹內容級圖的
// natural 比例投影到容器全寬 > 容器高 + 40px）→ 連 height / min-height 一起
// reset 為 auto。
//
// 訊號層次：本 spec 驗「inline style 有沒有寫對 + restore 可逆」，不驗真實
// layout 高度（jsdom 無 layout engine）；真實視覺由 debug-harness 圖疊文
// audit 驗（latepost 真站 ✅ 無圖疊文）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'latepost-abstract-fixed-height.html');

function load() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1280, height: 900 },
    pretendToBeVisual: true
  });
  const d = env.document;
  const stubRectAt = (el, w, h, top, left = 0) => {
    el.getBoundingClientRect = () => ({
      top, bottom: top + h, left, right: left + w, width: w, height: h, x: left, y: top
    });
  };
  // 主命中組：容器 670×249、左文字欄 402（60%）、右媒體欄 267（40%）、
  // 圖 267×249 natural 1280×1023 → 投影 670×(1023/1280)=535 > 249+40
  stubRectAt(d.querySelector('.abstract-pic'), 670, 249, 500);
  stubRectAt(d.querySelector('.abstract-pic-left'), 402, 249, 500, 0);
  stubRectAt(d.querySelector('.abstract-pic-right'), 267, 249, 500, 403);
  stubRectAt(d.querySelector('.abstract-cover'), 267, 249, 500, 403);
  Object.defineProperty(d.querySelector('.abstract-cover'), 'naturalWidth', { value: 1280 });
  Object.defineProperty(d.querySelector('.abstract-cover'), 'naturalHeight', { value: 1023 });
  // 負控制組：同幾何、圖 natural 1280×200（寬扁 banner）→ 投影 105 < 249+40
  stubRectAt(d.querySelector('.abstract-pic-flat'), 670, 249, 900);
  stubRectAt(d.querySelector('.flat-left'), 402, 249, 900, 0);
  stubRectAt(d.querySelector('.flat-right'), 267, 249, 900, 403);
  stubRectAt(d.querySelector('.flat-cover'), 267, 249, 900, 403);
  Object.defineProperty(d.querySelector('.flat-cover'), 'naturalWidth', { value: 1280 });
  Object.defineProperty(d.querySelector('.flat-cover'), 'naturalHeight', { value: 200 });
  return env.window;
}

describe('latepost — 摘要縮圖盒固定高度裁切（v1.7.34）', () => {
  let window, document, hidden;

  before(() => {
    window = load();
    document = window.document;
    const detected = window.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    hidden = window.__JRead.cleaner.clean(detected.el);
  });

  it('twoColLede 容器被 collapse（前提）', () => {
    assert.strictEqual(document.querySelector('.abstract-pic').dataset.jreadCollapsed, '1',
      '.abstract-pic（flex 兩欄：媒體欄 40% + 文字欄 60% >= 80 chars）應被 twoColLede collapse');
  });

  it('媒體成長裁切預測命中 → 容器 height / min-height 被 reset 為 auto', () => {
    const el = document.querySelector('.abstract-pic');
    assert.strictEqual(el.style.getPropertyValue('height'), 'auto',
      '固定高度容器（249px）內含會長高的內容圖（投影 535px）→ height 必須 reset 為 auto，' +
      '否則塌欄後圖溢出盒外疊壓後續段落（latepost 真站圖疊文實案）');
    assert.strictEqual(el.style.getPropertyPriority('height'), 'important',
      'height:auto 必須帶 !important（贏過站點 stylesheet 固定高度）');
    assert.strictEqual(el.style.getPropertyValue('min-height'), '0',
      'min-height 一併 reset');
  });

  it('負控制：圖 natural 寬扁（投影 105px < 容器高）→ 不觸發 height reset', () => {
    const flat = document.querySelector('.abstract-pic-flat');
    assert.strictEqual(flat.dataset.jreadCollapsed, '1',
      '負控制容器同樣被 collapse（前提）');
    assert.strictEqual(flat.style.getPropertyValue('height'), '',
      '投影高度不超過容器高的容器不得被加 height reset（閘門不可無條件套用，' +
      '對齊 nyt-fullbleed-hero-height spec (e) 的設計約束）');
  });

  it('restore 還原容器 inline height', () => {
    window.__JRead.cleaner.restore(hidden);
    const el = document.querySelector('.abstract-pic');
    assert.strictEqual(el.style.getPropertyValue('height'), '',
      'restore 後 height inline 必須清空（回到 stylesheet 值）');
    assert.strictEqual(el.dataset.jreadCollapsed, undefined,
      'restore 後 jreadCollapsed 標記必須移除');
  });
});
