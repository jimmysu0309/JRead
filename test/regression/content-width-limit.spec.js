// JRead — regression spec: 版心寬度上限放寬（v0.7.237）
//
// Jimmy 回報：iOS（iPad / 寬視窗）版心寬度上限不夠寬。根因（iPad simulator
// instrument 實證）：iPad Safari 的 layout viewport 可達 1120pt（desktop-class，
// 比實體 834pt 寬），版心 contentWidth 確實正確套用（card max-width = 設定值、
// 置中），但 popup 上限寫死 1200——若使用者 iPad 的 layout viewport >= 1200，
// 版心永遠填不滿螢幕，主觀感受變成「調了沒變寬」。修法：popup CONTENT_WIDTH.max
// 與 options max 從 1200 → 1600；styler clamp [300, 2000] 仍是最終防線。
//
// 訊號層次：驗 popup / options 的上限常數 + styler clamp 容得下。不驗真實
// 視覺（contentWidth 是否套用由 iPad simulator instrument 驗過：innerWidth=1120
// 時 card rect.width 精確 = contentWidth）。

const path = require('path');
const assert = require('assert');
const { readFileSync } = require('fs');
const { JREAD_DIR } = require('../helpers');

const POPUP_SRC = readFileSync(path.join(JREAD_DIR, 'popup', 'popup.js'), 'utf8');
const OPTIONS_HTML = readFileSync(path.join(JREAD_DIR, 'options', 'options.html'), 'utf8');
const STYLER_SRC = readFileSync(path.join(JREAD_DIR, 'content', 'styler.js'), 'utf8');

describe('版心寬度上限放寬（v0.7.237）', () => {
  it('popup CONTENT_WIDTH.max 必須 >= 1600（放寬寬視窗版心上限）', () => {
    const m = POPUP_SRC.match(/const CONTENT_WIDTH = \{[^}]*?max:\s*(\d+)/);
    assert.ok(m, 'popup.js 須宣告 CONTENT_WIDTH.max');
    assert.ok(Number(m[1]) >= 1600, `CONTENT_WIDTH.max 必須 >= 1600（目前 ${m[1]}）`);
  });

  it('options.html contentWidth input max 必須 >= 1600', () => {
    const m = OPTIONS_HTML.match(/id="contentWidth"[^>]*max="(\d+)"/);
    assert.ok(m, 'options.html 須含 #contentWidth max');
    assert.ok(Number(m[1]) >= 1600, `options max 必須 >= 1600（目前 ${m[1]}）`);
  });

  it('styler contentWidth clamp 上限必須容得下 popup max（>= 1600）', () => {
    // styler 是最終防線：clamp [300, 2000]。popup max(1600) 必須 <= styler 上限，
    // 否則使用者調到的值會被 styler 默默截掉。
    const m = STYLER_SRC.match(/Math\.min\((\d+),\s*Math\.max\(300,\s*rawCw\)\)/);
    assert.ok(m, 'styler 須有 contentWidth clamp Math.min(N, Math.max(300, rawCw))');
    assert.ok(Number(m[1]) >= 1600, `styler clamp 上限必須 >= 1600（目前 ${m[1]}）`);
  });
});
