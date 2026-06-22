// JRead — 翻頁 scrubber 觸控裝置上抬 regression spec（v0.8.162）
//
// 驗 styler 注入的翻頁 CSS 在觸控裝置（pointer: coarse）把頁碼指示器與 scrub
// 進度條往上抬離視窗底部，並用 env(safe-area-inset-bottom) 補 home indicator
// 高度——iPadOS / iPhone Safari 底部系統 bar + 手勢區會攔走貼底頁碼的拖曳
// 觸控（Jimmy 2026-06-22 iPad 截圖回報「頁碼太靠底部、拖不動選頁」）。
//
// 訊號層次：本檔驗「注入的 CSS 字串含 coarse-pointer 抬升規則 + safe-area-inset」。
// 真實 iPad 上拖曳是否不再被系統攔截需 TestFlight 實機驗（jsdom 無 env() / 系統 bar）。
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');

function applyPaged() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中主文');
  env.NS.styler.apply(detected.el, {
    theme: 'light', fontSize: 18, contentWidth: 720,
    fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0,
    pagedMode: true
  });
  return env.document.getElementById('__jread-style').textContent;
}

describe('styler — 翻頁 scrubber 觸控上抬（v0.8.162）', () => {
  it('翻頁 CSS 注入頁碼指示器 + scrub 進度條', () => {
    const css = applyPaged();
    assert.ok(css.includes('#__jread-page-indicator'), '缺頁碼指示器 CSS');
    assert.ok(css.includes('#__jread-scrub-track'), '缺 scrub 進度條 CSS');
  });

  it('coarse-pointer media query 把頁碼指示器抬離底部（env(safe-area-inset-bottom)）', () => {
    const css = applyPaged();
    assert.ok(/@media\s*\(pointer:\s*coarse\)/.test(css),
      '必須有 pointer: coarse media query（觸控裝置才抬升）');
    // 指示器在 coarse media 內以 calc + safe-area-inset 抬升
    assert.ok(/#__jread-page-indicator\s*\{\s*bottom:\s*calc\(24px \+ env\(safe-area-inset-bottom/.test(css),
      '頁碼指示器在觸控裝置必須抬到 calc(24px + env(safe-area-inset-bottom))');
  });

  it('scrub 進度條同步上抬、維持在指示器上方（48px > 24px）', () => {
    const css = applyPaged();
    assert.ok(/#__jread-scrub-track\s*\{\s*bottom:\s*calc\(48px \+ env\(safe-area-inset-bottom/.test(css),
      'scrub-track 在觸控裝置必須抬到 calc(48px + env(safe-area-inset-bottom))，維持在指示器上方');
  });

  it('桌面基底維持原貼底值（指示器 6px / track 30px，coarse 之外不抬）', () => {
    const css = applyPaged();
    // base 規則仍保留桌面貼底值（媒體查詢只在 coarse 命中時覆蓋）
    assert.ok(/#__jread-page-indicator\s*\{[^}]*bottom:\s*6px/.test(css),
      '桌面基底頁碼仍 bottom:6px');
    assert.ok(/#__jread-scrub-track\s*\{[^}]*bottom:\s*30px/.test(css),
      '桌面基底 scrub-track 仍 bottom:30px');
  });
});
