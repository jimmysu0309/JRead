// JRead — RESIZE_OWN_WINDOW handler origin + height range guard（v0.7.143）
//
// Bug：SW handler 不檢查 sender.tab.url、不 clamp height range。任何 content
// script context（jread 對所有 URL 注入）可呼 RESIZE_OWN_WINDOW 任意 resize 視窗。
// content 端 calcTargetWindowHeight 有 clamp [200, screen.availHeight * 0.8]，
// 但 SW 沒驗——惡意頁面透過 debug bridge 可繞過。
//
// 修法：SW handler 加 (a) sender.tab.url 必須 match youtube.com/watch；
// (b) height 必須在 [200, 4096] 範圍。
//
// 本 spec 是 forcing function：
//   - case body 必須含 youtube.com/watch URL check
//   - case body 必須含 height range check (>= 200 && <= 4096 或等價)

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SW_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'background', 'service-worker.js'), 'utf8'
);

describe('SW RESIZE_OWN_WINDOW handler 安全 guard（v0.7.143）', () => {
  let caseBody = '';
  before(() => {
    const match = SW_SRC.match(/case\s+['"]RESIZE_OWN_WINDOW['"]:\s*\{([\s\S]*?)\}\s*(case|default)/);
    assert.ok(match, '必須能找到 RESIZE_OWN_WINDOW case body');
    caseBody = match[1];
  });

  it('RESIZE_OWN_WINDOW 必須驗證 sender.tab.url 為 YouTube watch 頁', () => {
    // 排除註解後找實際 invocation 邏輯（用 String.includes 避免 regex literal
    // 中 `\.` `\/` 等 backslash 跟 source 內 regex literal 字面 mismatch）
    const codeOnly = caseBody.split('\n')
      .filter(l => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l))
      .join('\n');
    assert.ok(codeOnly.includes('youtube.com') || codeOnly.includes('youtube\\.com'),
      'RESIZE_OWN_WINDOW handler 必須 check sender.tab.url 含 youtube.com（防其他站點任意 resize）');
    assert.ok(codeOnly.includes('/watch') || codeOnly.includes('\\/watch'),
      'RESIZE_OWN_WINDOW handler 必須 check sender.tab.url 含 /watch path（避免 youtube.com 其他子路徑誤用）');
  });

  it('RESIZE_OWN_WINDOW 必須讀 sender.tab.url（不光是 windowId）', () => {
    const codeOnly = caseBody.split('\n')
      .filter(l => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l))
      .join('\n');
    assert.ok(/sender\s*&&[\s\S]*?\.url|sender\.tab\.url/.test(codeOnly),
      'handler 必須讀 sender.tab.url 作 origin check');
  });

  it('RESIZE_OWN_WINDOW 必須 clamp height 上限（防極端值）', () => {
    // 找 height >= NNN 或 height < NNN 形式的 check
    const codeOnly = caseBody.split('\n')
      .filter(l => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l))
      .join('\n');
    // 至少要有「height > 某數」或「height >= 某數」這類上限 check
    assert.ok(/height\s*[<>]=?\s*\d{3,}/.test(codeOnly),
      'handler 必須含 height 範圍 check（例：height < 200 || height > 4096），實際 codeOnly:\n' + codeOnly);
  });

  it('RESIZE_OWN_WINDOW 範圍 check 應該至少要有 lower bound 200', () => {
    const codeOnly = caseBody.split('\n')
      .filter(l => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l))
      .join('\n');
    assert.ok(/height\s*<\s*200|height\s*<=\s*199/.test(codeOnly),
      'height < 200 應視為 invalid（過矮無法承載 YouTube player）');
  });
});
