// JRead — popup 標題字級 stepper（v0.8.158）
//
// 背景：theme / fontSize / titleFontSize / contentWidth / fontWeight 原本 options
// 與 popup 雙入口（fontSize/contentWidth/fontWeight/theme 在 popup 是 stepper /
// swatch，options 是 select / number input；titleFontSize 只在 options）。Jimmy
// 2026-06-22 要求把這 5 個全收斂到 popup（工具列圖示選單）即時調整、options 拿掉，
// 消除雙入口 drift。titleFontSize 在 popup 沒有對應控制 → 本版新增 stepper（auto
// 按鈕 + ± stepper，0 = Auto 保留原站標題，與字級同模式）。
//
// 訊號層次：驗 popup.html 控制項結構 + popup.js TITLE_FONT_SIZE 常數 / 接線 +
// options 已移除該 input。不驗真實點擊行為（popup.js 完整跑需 chrome stub，結構
// grep 為既有 popup spec 慣例）；styler 端 titleFontSize 渲染由 styler-title-font-size 守。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { JREAD_DIR } = require('../helpers');

const POPUP_HTML = fs.readFileSync(path.join(JREAD_DIR, 'popup', 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(JREAD_DIR, 'popup', 'popup.js'), 'utf8');
const OPTIONS_HTML = fs.readFileSync(path.join(JREAD_DIR, 'options', 'options.html'), 'utf8');
const OPTIONS_JS = fs.readFileSync(path.join(JREAD_DIR, 'options', 'options.js'), 'utf8');

describe('popup 標題字級 stepper（v0.8.158）', () => {
  it('popup.html 有標題字級 row：auto 按鈕 + ± stepper + val', () => {
    const doc = new JSDOM(POPUP_HTML).window.document;
    assert.ok(doc.getElementById('title-font-auto-btn'), '缺自動按鈕 #title-font-auto-btn');
    assert.ok(doc.getElementById('title-font-size-val'), '缺讀數 #title-font-size-val');
    assert.ok(doc.querySelector('[data-action="title-font-dec"]'), '缺減小按鈕');
    assert.ok(doc.querySelector('[data-action="title-font-inc"]'), '缺放大按鈕');
  });

  it('popup.js 宣告 TITLE_FONT_SIZE 常數（auto = 0 sentinel）', () => {
    const m = POPUP_JS.match(/const TITLE_FONT_SIZE = \{([^}]*)\}/);
    assert.ok(m, 'popup.js 必須宣告 TITLE_FONT_SIZE');
    assert.ok(/auto:\s*0\b/.test(m[1]), 'TITLE_FONT_SIZE.auto 必須是 0（保留原站標題 sentinel）');
    assert.ok(/min:\s*\d+/.test(m[1]) && /max:\s*\d+/.test(m[1]) && /step:\s*\d+/.test(m[1]),
      'TITLE_FONT_SIZE 必須有 min / max / step');
  });

  it('popup.js 接線標題字級 dec / inc / auto，存進 titleFontSize', () => {
    assert.ok(/\[data-action="title-font-dec"\]/.test(POPUP_JS), '缺 title-font-dec handler');
    assert.ok(/\[data-action="title-font-inc"\]/.test(POPUP_JS), '缺 title-font-inc handler');
    assert.ok(/save\(\{\s*titleFontSize:/.test(POPUP_JS), 'handler 必須 save titleFontSize');
    assert.ok(/titleFontAutoBtn/.test(POPUP_JS), '必須接 auto 按鈕');
  });

  it('options 已移除 5 個移到 popup 的欄位（theme / fontSize / titleFontSize / contentWidth / fontWeight）', () => {
    for (const id of ['theme', 'fontSize', 'titleFontSize', 'contentWidth', 'fontWeight']) {
      assert.ok(!new RegExp(`id="${id}"`).test(OPTIONS_HTML),
        `options.html 不該再有 #${id}（已移到 popup）`);
    }
    const fields = OPTIONS_JS.match(/const fields = \[([^\]]*)\]/);
    assert.ok(fields, '找不到 options.js fields 陣列');
    for (const id of ['theme', 'fontSize', 'titleFontSize', 'contentWidth', 'fontWeight']) {
      assert.ok(!fields[1].includes(`'${id}'`), `options.js fields 不該再含 '${id}'`);
    }
  });
});
