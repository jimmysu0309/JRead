// JRead — 翻頁 scrubber 觸控裝置上抬 regression spec（v0.8.162）
//
// 驗 styler 注入的翻頁 CSS 在觸控裝置（pointer: coarse）把頁碼指示器與 scrub
// 進度條往上抬離視窗底部，並用 env(safe-area-inset-bottom) 補 home indicator
// 高度——iPadOS / iPhone Safari 底部系統 bar + 手勢區會攔走貼底頁碼的拖曳
// 觸控（Jimmy 2026-06-22 iPad 截圖回報「頁碼太靠底部、拖不動選頁」）。
//
// 訊號層次：本檔驗「注入的 CSS 字串含 coarse-pointer 抬升規則 + safe-area-inset」。
// 真實 iPad 上拖曳是否不再被系統攔截需 TestFlight 實機驗（jsdom 無 env() / 系統 bar）。
//
// v0.8.166：抬升量依平台分流——iPhone 退回近底（6 / 30px，等同非 coarse base），iPad /
// 其他 coarse 維持 24 / 48px。原 24px 抬升在 iPhone 把頁碼推進內文重疊（Jimmy 2026-06-23
// iPhone 截圖）。styler 依 navigator.userAgent 判 iPhone（/iPhone|iPod/）。
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');

// ua 可選——覆寫 jsdom navigator.userAgent 以驗 iPhone 分流（預設 jsdom UA = 非 iPhone）
function applyPaged(ua) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  if (ua) {
    Object.defineProperty(env.window.navigator, 'userAgent', { value: ua, configurable: true });
  }
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中主文');
  env.NS.styler.apply(detected.el, {
    theme: 'light', fontSize: 18, contentWidth: 720,
    fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0,
    pagedMode: true
  });
  return env.document.getElementById('__jread-style').textContent;
}

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

describe('styler — 翻頁 scrubber 觸控上抬（v0.8.162）', () => {
  it('翻頁 CSS 注入頁碼指示器 + scrub 進度條', () => {
    const css = applyPaged();
    assert.ok(css.includes('#__jread-page-indicator'), '缺頁碼指示器 CSS');
    assert.ok(css.includes('#__jread-scrub-track'), '缺 scrub 進度條 CSS');
  });

  it('iPad（coarse、非 iPhone）：頁碼指示器抬到 calc(24px + safe-area)', () => {
    const css = applyPaged(IPAD_UA);
    assert.ok(/@media\s*\(pointer:\s*coarse\)/.test(css),
      '必須有 pointer: coarse media query（觸控裝置才抬升）');
    assert.ok(/#__jread-page-indicator\s*\{\s*bottom:\s*calc\(24px \+ env\(safe-area-inset-bottom/.test(css),
      'iPad 頁碼指示器必須抬到 calc(24px + env(safe-area-inset-bottom))');
  });

  it('iPad：scrub 進度條同步上抬、維持在指示器上方（48px > 24px）', () => {
    const css = applyPaged(IPAD_UA);
    assert.ok(/#__jread-scrub-track\s*\{\s*bottom:\s*calc\(48px \+ env\(safe-area-inset-bottom/.test(css),
      'iPad scrub-track 必須抬到 calc(48px + env(safe-area-inset-bottom))，維持在指示器上方');
  });

  // v0.8.166：iPhone 退回近底（6 / 30px），不吃 iPad 的 24px 抬升——避免頁碼推進內文重疊
  it('iPhone（coarse + iPhone UA）：頁碼指示器退回近底 calc(6px + safe-area)，不被推進內文', () => {
    const css = applyPaged(IPHONE_UA);
    assert.ok(/#__jread-page-indicator\s*\{\s*bottom:\s*calc\(6px \+ env\(safe-area-inset-bottom/.test(css),
      'iPhone 頁碼指示器必須退回 calc(6px + env(safe-area-inset-bottom))，不吃 24px 抬升');
    assert.ok(!/#__jread-page-indicator\s*\{\s*bottom:\s*calc\(24px/.test(css),
      'iPhone 不可出現 24px 抬升（那是 iPad 值）');
  });

  it('iPhone：scrub 進度條同步退回近底 calc(30px + safe-area)，維持 24px 間距', () => {
    const css = applyPaged(IPHONE_UA);
    assert.ok(/#__jread-scrub-track\s*\{\s*bottom:\s*calc\(30px \+ env\(safe-area-inset-bottom/.test(css),
      'iPhone scrub-track 必須退回 calc(30px + env(safe-area-inset-bottom))（= 指示器 6 + 24 間距）');
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
