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
});
