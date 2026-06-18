// JRead — popup toggle 按鈕狀態化文字 regression（v0.8.104）
//
// Jimmy 2026-06-18：啟動按鈕原本固定顯示「切換閱讀模式」，看不出當前頁是不是
// 已在閱讀模式。改為反映狀態——已啟動 → 「退出閱讀模式」、未啟動 → 「啟動閱讀
// 模式」（與影院模式按鈕「啟動 / 退出影院模式」同一套狀態化詞彙）。
//
// 行為靠 popup.js refreshPopupForActiveTab 讀 GET_READER_STATE 的 active 欄位切
// 文字；popup 點擊互動 harness 模擬不到（CLAUDE.md「仍需 Jimmy 手動驗」清單），
// 故以 string-match forcing function 鎖住關鍵賦值路徑（同 popup-readwise-visibility
// 的測法）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const POPUP_HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.html'),
  'utf8'
);
const POPUP_JS = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.js'),
  'utf8'
);

describe('popup v0.8.104 — toggle 按鈕反映 reader mode 狀態', () => {
  it('popup.html toggle-btn 初始文字為「啟動閱讀模式」（off 開啟態，減少閃動）', () => {
    const m = POPUP_HTML.match(/<button\s+id=["']toggle-btn["'][^>]*>([^<]*)<\/button>/);
    assert.ok(m, '能在 popup.html 找到 <button id="toggle-btn">');
    assert.strictEqual(m[1].trim(), '啟動閱讀模式',
      'toggle-btn 初始文字應為「啟動閱讀模式」——forcing：固定寫「切換閱讀模式」會在 popup 開啟瞬間（GET_READER_STATE 回來前）顯示無狀態文字');
  });

  it('popup.js 必須含「啟動閱讀模式」與「退出閱讀模式」兩種狀態文字', () => {
    assert.match(POPUP_JS, /啟動閱讀模式/,
      'popup.js 必須含「啟動閱讀模式」（reader off 時）');
    assert.match(POPUP_JS, /退出閱讀模式/,
      'popup.js 必須含「退出閱讀模式」（reader on 時）');
  });

  it('refreshPopupForActiveTab 主路徑必須依 active 切 toggle 文字（非 cinema 站）', () => {
    const m = POPUP_JS.match(/async\s+function\s+refreshPopupForActiveTab\s*\(\s*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(m, '能在 popup.js 找到 async function refreshPopupForActiveTab');
    const body = m[1];
    // 必須有一處用 active 三元運算決定 toggleBtn 文字（退出 / 啟動）
    assert.match(body, /toggleBtn\.textContent\s*=\s*active\s*\?\s*['"]退出閱讀模式['"]\s*:\s*['"]啟動閱讀模式['"]/,
      'refreshPopupForActiveTab 主路徑必須 `toggleBtn.textContent = active ? 退出閱讀模式 : 啟動閱讀模式`——forcing：拿掉會回退到固定文字，看不出當前狀態');
  });

  it('cinema 站文字切換不可被誤刪（與 reader 狀態並存）', () => {
    // 仍須保留影院模式分支（v0.7.133），新行為只接管「非 cinema」else 分支
    assert.match(POPUP_JS, /啟動影院模式/);
    assert.match(POPUP_JS, /退出影院模式/);
  });

  it('off 狀態（無 tab / 無 content script）也須把 toggle 設回「啟動閱讀模式」', () => {
    const m = POPUP_JS.match(/async\s+function\s+refreshPopupForActiveTab\s*\(\s*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(m);
    const body = m[1];
    // active 三元賦值（主路徑）+ 至少 2 處固定「啟動閱讀模式」賦值（早期 return + catch）
    const offAssignments = (body.match(/toggleBtn\.textContent\s*=\s*['"]啟動閱讀模式['"]/g) || []).length;
    assert.ok(offAssignments >= 2,
      `早期 return（無 tab）與 catch（無 content script）都須把 toggle 設回「啟動閱讀模式」，實測 ${offAssignments} 處——forcing：漏掉會讓禁注入頁殘留上一次的狀態文字`);
  });
});
