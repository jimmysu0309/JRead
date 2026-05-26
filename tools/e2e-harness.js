// JRead — e2e regression harness（供 test/e2e/ 用）
// -----------------------------------------------------------------------------
// 抽 tools/debug-harness.js 的 SW 啟動樣板成可重用 helper。
//
// 為什麼需要 e2e harness：
//   (1) MV3 service worker 的 `importScripts` 路徑解析、
//   (2) chrome.action.setIcon / chrome.tabs.onUpdated 類 wire-up、
//   (3) chrome.commands.onCommand listener 註冊等
// 只能在真實 MV3 extension 環境觀察。jsdom / Node 無對應 API——
// 必須用 Playwright 載 unpacked extension 跑真 Chromium。
//
// 設計：
//   - launchExtension()：啟動 persistent context + 載 JRead unpacked、返回
//     { ctx, sw, cleanup }；所有 e2e spec 共用。
//   - swEval(sw, fn, ...args)：wrap sw.evaluate 方便 test 端呼叫。
//   - openTab(ctx, url)：開新 tab 等 content script 注入完成。
//   - CI 控制：設 JREAD_SKIP_E2E=1 時整包 test 跳過（CI 環境無 display）。
//
// 與 tools/debug-harness.js 的差別：
//   - debug-harness 是互動式手動除錯工具（keep browser 開啟、可 --keep）；
//   - e2e-harness 是自動化 test 支援工具（供 mocha spec import）、cleanup 後關閉。
//   兩者共享相同的 Chromium 啟動策略（bundled Chromium + load-extension），
//   但責任切割清楚：debug 人看、e2e 程式跑。
// -----------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');
const http = require('http');

const PROJECT_ROOT = path.join(__dirname, '..');
const EXT_PATH = path.join(PROJECT_ROOT, 'jread');
// 用 test 專屬 profile 避免跟互動式 debug-harness 互搶
const PROFILE_DIR = '/tmp/jread-e2e-profile';

// 測試用 HTML：有 <article> tag、足夠文字量讓 detector 命中 article-tag
// 策略（confidence 0.9）。保持簡單、無外部依賴、無 JS。
const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><title>E2E Fixture</title></head>
<body>
<article>
<h1>E2E Fixture 文章標題</h1>
<p>這是 e2e harness 用的 fixture 頁面，內含一個 article tag 讓 JRead
detector 策略 1（article-tag）直接命中。本段文字刻意寫長一點以通過
MIN_TEXT_LEN 200 門檻，確保 reader mode 在 e2e test 中能穩定啟動、
進而驗證 service worker 的 SET_ACTIVE_ICON wire-up。</p>
<p>第二段同樣是純文字段落用於驗證 content script 能正常注入並透過
chrome.runtime.sendMessage 與 service worker 溝通，觸發 icon swap、
toast 顯示等一系列 wire-up 邏輯，這個 fixture 的目的就是提供一個
最小可重現環境讓 e2e regression 穩定跑完不依賴外部網路。</p>
</article>
</body>
</html>`;

/**
 * 啟動本機 HTTP server 提供固定 fixture HTML，供 e2e test 用。
 * 優點：不依賴 example.com / 真實網站、不走 HTTPS、無網路延遲、
 * fixture HTML 可控制 detector 能穩定命中。
 */
function startFixtureServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(FIXTURE_HTML);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

/**
 * 啟動一個帶 JRead unpacked extension 的 Chromium persistent context，
 * 等 SW 啟動後返回。
 */
async function launchExtension(opts) {
  opts = opts || {};
  // 每次 launch 清舊 profile，避免 chrome.storage 殘留影響 test
  if (opts.fresh !== false) {
    try { fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch (_) {}
  }
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // playwright 本身的 require 路徑：e2e-harness 被 test/ 下 require、
  // node_modules 位於 PROJECT_ROOT；用絕對路徑避免 cwd 不同導致找不到
  const { chromium } = require(path.join(PROJECT_ROOT, 'node_modules', 'playwright'));

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chromium',          // bundled Chromium（Google Chrome 137+ 擋 load-extension）
    headless: false,
    viewport: { width: 1024, height: 768 },
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-position=-2400,-2400'
    ]
  });

  // 等 SW 起來；第一次載 extension 會觸發 onInstalled
  let sw = ctx.serviceWorkers()[0];
  if (!sw) {
    sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  }
  if (!sw) throw new Error('service worker 未啟動');

  async function cleanup() {
    try { await ctx.close(); } catch (_) {}
  }

  return { ctx, sw, cleanup };
}

/**
 * 在 SW world 執行 fn、回傳 result。wrapper 讓 test 端寫起來乾淨。
 */
async function swEval(sw, fn, ...args) {
  return sw.evaluate(fn, ...args);
}

/**
 * 開新 tab 到指定 URL、等 content script 於 document_idle 注入。
 * MV3 content_scripts 在 document_idle 才 run，需等 networkidle + 一段 sleep。
 */
async function openTab(ctx, url, opts) {
  opts = opts || {};
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  // 等 content script 注入（document_idle）
  await new Promise(r => setTimeout(r, opts.settleMs || 1500));
  return page;
}

/**
 * 透過 SW 查詢 page 在 chrome.tabs 裡的 id。
 * content script 的 isolated world 無法從 page.evaluate 直接拿 tabId——
 * 只有 SW 能呼叫 chrome.tabs.query。
 */
async function getTabId(sw, url) {
  return sw.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({});
    const match = tabs.find(t => t.url === u) ||
                  tabs.find(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'));
    return match && match.id;
  }, url);
}

module.exports = {
  launchExtension, swEval, openTab, getTabId, startFixtureServer,
  EXT_PATH, PROJECT_ROOT
};
