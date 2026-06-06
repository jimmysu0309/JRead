// JRead — options 頁 layout forcing function（v0.7.219）
//
// Jimmy 2026-06-06 iPad 模擬器驗收反映 options 頁太窄。options 以
// `options_ui.open_in_tab: true` 整頁開啟（非 popup 內嵌），560px 版心在
// iPad / 桌面整頁下留白過多、desc 長段落擠成高窄柱 → 拓寬至 760px。
//
// 訊號層次：本檔驗 source 字面值（max-width 不被改回 / 誤刪）。實際視覺
// （兩端 margin auto 置中、field 右緣對齊）靠 Playwright probe / 實機。
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const OPTIONS_HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'options', 'options.html'), 'utf8');

describe('options 頁 layout（v0.7.219）', () => {
  it('body 版心必須是 max-width: 760px（560px 太窄，Jimmy iPad 驗收反饋）', () => {
    const m = OPTIONS_HTML.match(/body\s*\{[\s\S]*?max-width:\s*(\d+)px/);
    assert.ok(m, '抓不到 options body max-width 宣告');
    assert.strictEqual(m[1], '760', `options body max-width 必須 760px，實際 ${m[1]}px`);
  });

  // v0.7.223：Jimmy iOS 回報 options 字體偏小。根因：無 viewport meta 時
  // iOS 用 980px 預設 layout viewport 整頁縮 ~0.44 倍。配套觸控 zoom 放大。
  it('options.html 必須有 viewport meta（device-width，根因修法）', () => {
    assert.ok(/<meta\s+name="viewport"\s+content="width=device-width/.test(OPTIONS_HTML),
      'options.html 缺 viewport meta —— iOS 會用 980px fallback 整頁縮小');
  });

  it('觸控 media query 必須對 body 套 zoom >= 1.15（device-width 後 15px base 仍偏小）', () => {
    const m = OPTIONS_HTML.match(
      /@media\s*\(pointer:\s*coarse\)\s*\{\s*body\s*\{([\s\S]*?)\}/);
    assert.ok(m, '抓不到 (pointer: coarse) body 區塊');
    const z = m[1].match(/zoom:\s*([\d.]+)/);
    assert.ok(z, '觸控 media query 內 body 缺 zoom');
    assert.ok(Number(z[1]) >= 1.15, `zoom（${z[1]}）必須 >= 1.15`);
  });
});
