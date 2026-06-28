// JRead — 跨瀏覽器 browser shim forcing function（v0.8.164）
//
// 全擴充從 chrome.*（callback shim）遷移到 browser.*（原生 Promise），對齊姊妹專案
// Shinkansen，根治 iOS/iPadOS 通訊不可靠（快速鍵 / 呼叫 popup / popup 套設定常失效）。
// Safari 的 chrome 相容層比原生 browser promise 不可靠；Chrome 上 browser 退回 chrome
// （MV3 無 callback 時 chrome.* 一樣回 Promise，行為零變化）。
//
// shim 機制：`globalThis.browser = globalThis.browser ?? globalThis.chrome`，放在兩個
// bootstrap（互為鏡像、受控雙寫，CLAUDE.md 硬規則 5）：
//   - content/namespace.js     —— content_scripts 第一個檔（後續 content script 繼承）
//   - content/settings-defaults.js —— popup.html / options.html 第一個 <script>，且 SW
//     （Chrome importScripts / Safari·Firefox event page scripts）的早期載入檔
//
// 本檔是 forcing function：兩 bootstrap 都要有 shim、且全擴充原始碼不可殘留任何
// chrome.* 直呼（除了 shim 行本身的 `?? globalThis.chrome` fallback 與註解）。
//
// 訊號層次：本檔驗「shim 存在 + 無 chrome.* 殘留」的原始碼結構。不驗：Safari 真實
// promise 可靠度 / iOS 掛起時序（只能 TestFlight 實機驗）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const JREAD = path.join(__dirname, '..', '..', 'jread');
const read = (p) => fs.readFileSync(path.join(JREAD, p), 'utf8');

const SHIM_RE = /globalThis\.browser\s*=\s*globalThis\.browser\s*\?\?\s*globalThis\.chrome\s*;/;

describe('browser shim — 跨瀏覽器相容（v0.8.164）', () => {
  it('content/namespace.js 頂端必須有 browser shim（content_scripts 第一個檔）', () => {
    const src = read('content/namespace.js');
    assert.ok(SHIM_RE.test(src),
      'namespace.js 必須含 `globalThis.browser = globalThis.browser ?? globalThis.chrome;`');
    // shim 必須在 IIFE（後續使用 browser 的程式碼）之前
    const shimIdx = src.search(SHIM_RE);
    const iifeIdx = src.indexOf('(function ()');
    assert.ok(shimIdx >= 0 && shimIdx < iifeIdx,
      'shim 必須在 namespace IIFE 之前（browser 必須先就緒）');
  });

  it('content/settings-defaults.js 頂端必須有 browser shim（popup/options/SW 入口）', () => {
    const src = read('content/settings-defaults.js');
    assert.ok(SHIM_RE.test(src),
      'settings-defaults.js 必須含 `globalThis.browser = globalThis.browser ?? globalThis.chrome;`');
    const shimIdx = src.search(SHIM_RE);
    const iifeIdx = src.indexOf('(function (global)');
    assert.ok(shimIdx >= 0 && shimIdx < iifeIdx,
      'shim 必須在 settings-defaults IIFE 之前');
  });

  // 全擴充原始碼不可殘留 chrome.*（async API 直呼）——shim 行的 `globalThis.chrome`
  // fallback 與註解除外。掃 content / background / popup / options 全部 .js。
  const FILES = [
    'content/home-launcher.js',
    'content/namespace.js', 'content/keepalive.js', 'content/settings-defaults.js',
    'content/custom-shortcuts.js', 'content/touch-gestures.js', 'content/position-memory.js',
    'content/floating-icon.js', 'content/youtube-borderless.js', 'content/styler.js',
    'content/main.js', 'content/detector.js', 'content/cleaner.js', 'content/edit-mode.js',
    'content/cinema-mode.js', 'content/x-thread.js', 'content/fb-post.js', 'content/toast.js',
    'content/space-scroll.js', 'content/paged-mode.js',
    'background/service-worker.js', 'popup/popup.js', 'options/options.js'
  ];

  // 「非註解行」內出現 chrome.<api> 即視為殘留（排除 shim 的 globalThis.chrome）。
  const CHROME_API = /chrome\.(storage|runtime|tabs|action|browserAction|windows|commands|management|alarms|scripting)\b/;

  for (const rel of FILES) {
    it(`${rel} 不可殘留 chrome.* 直呼（已全改 browser.*）`, () => {
      const src = read(rel);
      const offenders = src.split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line))   // 排除註解行
        .filter(({ line }) => !/globalThis\.chrome/.test(line))   // 排除 shim fallback
        .filter(({ line }) => CHROME_API.test(line));
      assert.strictEqual(offenders.length, 0,
        `${rel} 殘留 chrome.* 直呼（v0.8.164 應全改 browser.*）：\n` +
        offenders.map(({ line, n }) => `  L${n}: ${line.trim()}`).join('\n'));
    });
  }
});
