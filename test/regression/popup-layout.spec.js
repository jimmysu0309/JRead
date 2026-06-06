// JRead — popup layout forcing function（v0.7.222）
//
// Jimmy 2026-06-06 iPhone 實機回報 popup「擠在左邊」。根因：popup body
// `width: 300px` 是給 Chrome / macOS Safari 的設計寬（popup 視窗會縮到
// body 寬），但 iPhone 的 popup 是整螢幕寬 sheet（iPad 是 OS 固定寬
// popover），viewport 由 OS 給定 ~430pt，body 維持 300px 就釘在左邊。
// 修法：@media (pointer: coarse) and (min-width: 340px) 時 body 撐滿
// （width: auto + max-width cap + margin auto 置中）。
//
// 結構條件拆解（為什麼不是站點 / 平台特判）：
// - pointer: coarse  → 觸控環境（iPhone / iPad；桌面 Chrome / Safari 不中）
// - min-width: 340px → viewport 已寬於設計寬，代表 popup 視窗是 OS 給定
//   固定寬，不是 content-sized；同時排除 width: auto 與桌面 popup 視窗
//   sizing 的循環依賴（桌面視窗寬 == body 300px < 340 永遠不觸發）
//
// 訊號層次：本檔驗 source 字面值（media query 不被改壞 / 誤刪、桌面
// 設計寬 300px 不被動到）。實際視覺（sheet 內撐滿、置中）靠 iOS
// simulator / 實機驗收。
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const POPUP_HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.html'), 'utf8');

describe('popup layout（v0.7.222）', () => {
  it('桌面設計寬：body 必須維持 width: 300px（Chrome popup 視窗 sizing 基準）', () => {
    const m = POPUP_HTML.match(/body\s*\{[\s\S]*?width:\s*(\d+)px/);
    assert.ok(m, '抓不到 popup body width 宣告');
    assert.strictEqual(m[1], '300', `popup body 設計寬必須 300px，實際 ${m[1]}px`);
  });

  it('觸控 sheet media query 必須存在：(pointer: coarse) and (min-width: …px)', () => {
    assert.ok(
      /@media\s*\(pointer:\s*coarse\)\s*and\s*\(min-width:\s*\d+px\)/.test(POPUP_HTML),
      'popup.html 缺 @media (pointer: coarse) and (min-width: …px) —— iPhone sheet 會擠回左邊'
    );
  });

  it('media query 內 body 必須 width: auto + margin auto 置中 + max-width cap', () => {
    const m = POPUP_HTML.match(
      /@media\s*\(pointer:\s*coarse\)[^{]*\{\s*body\s*\{([\s\S]*?)\}/);
    assert.ok(m, '抓不到 media query 內的 body 區塊');
    const block = m[1];
    assert.ok(/width:\s*auto/.test(block), 'media query 內 body 必須 width: auto');
    assert.ok(/margin:\s*0\s+auto/.test(block), 'media query 內 body 必須 margin: 0 auto');
    assert.ok(/max-width:\s*\d+px/.test(block), 'media query 內 body 必須有 max-width cap');
  });

  it('min-width guard 必須 > 300px（排除桌面 content-sized popup 的循環觸發）', () => {
    const m = POPUP_HTML.match(/\(pointer:\s*coarse\)\s*and\s*\(min-width:\s*(\d+)px\)/);
    assert.ok(m, '抓不到 min-width guard');
    assert.ok(Number(m[1]) > 300,
      `min-width guard（${m[1]}px）必須大於桌面設計寬 300px，否則桌面 popup 視窗會循環觸發`);
  });
});
