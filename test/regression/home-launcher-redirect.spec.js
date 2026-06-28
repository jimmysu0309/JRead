// JRead — 主畫面快速啟動跳板轉址 forcing function（v1.5.12）
//
// 背景：iOS「加入主畫面」沒辦法直接釘擴充自有頁，因為
// `safari-web-extension://<UUID>/` 的 UUID 每次 Safari 重啟換一組
// （project_ios_extension_origin_uuid_rotates）。解法是把穩定 https 跳板頁
// （docs/open.html?jread-open=feed）加入主畫面，由 content/home-launcher.js 在該頁
// 讀 marker、當場用 browser.runtime.getURL 解析「當下」UUID 的擴充頁並 location.replace
// 過去——getURL runtime 即時解析，重啟換 UUID 也對得到。
//
// 訊號層次：本檔驗「marker→正確擴充頁 URL 的轉址決策邏輯」（vm sandbox，mock getURL）+
// 「manifest 載入順序」+「跳板頁不可宣告 standalone」的原始碼結構。
// 不驗：iOS Safari 真的允許 https→safari-web-extension:// 導航（只能模擬器/實機驗）、
// content script 在 standalone WebView 是否被擋（WebKit 行為，TestFlight 實機驗）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const LAUNCHER_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'home-launcher.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'jread', 'manifest.json'), 'utf8'));
const OPEN_HTML = fs.readFileSync(path.join(ROOT, 'docs', 'open.html'), 'utf8');

const UUID = 'TESTUUID-1';
const BASE = 'safari-web-extension://' + UUID + '/';

// 在 vm sandbox 跑 home-launcher.js（jsdom 的 location.replace 不可 redefine，且我們只
// 需要極小 location/browser stub）。回傳 content script 嘗試導向的 URL（沒導向回 null）。
// extensionOk=false 模擬 extension context 失效（runtime.id 不存在）。
function runLauncher(search, { extensionOk = true } = {}) {
  let redirectedTo = null;
  const sandbox = {
    URLSearchParams,
    location: {
      search,
      replace: (u) => { redirectedTo = u; },
      set href(u) { redirectedTo = u; },
      get href() { return ''; }
    },
    browser: {
      runtime: {
        id: extensionOk ? 'jread@test' : undefined,
        getURL: (p) => BASE + (p || '')
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(LAUNCHER_SRC, sandbox);
  return redirectedTo;
}

describe('home-launcher 跳板轉址（v1.5.12）', () => {
  it('?jread-open=feed → 用當下 base 導向 reader/reader.html', () => {
    assert.strictEqual(runLauncher('?jread-open=feed'), BASE + 'reader/reader.html');
  });

  it('轉址用 runtime.getURL 的當下 UUID base（重啟換 UUID 也對得到的關鍵）', () => {
    const dest = runLauncher('?jread-open=feed');
    assert.ok(dest.startsWith(BASE), '目標必須以當下 getURL base 開頭，不可寫死任何 UUID');
  });

  it('?jread-open=article&id=<docId> → 導向 article.html?id=<docId>', () => {
    assert.strictEqual(runLauncher('?jread-open=article&id=abc123'),
      BASE + 'reader/article.html?id=abc123');
  });

  it('?jread-open=article 無 id → 退回 feed', () => {
    assert.strictEqual(runLauncher('?jread-open=article'), BASE + 'reader/reader.html');
  });

  it('article id 經 encodeURIComponent（防注入怪字元）', () => {
    assert.strictEqual(runLauncher('?jread-open=article&id=a%2Fb'),
      BASE + 'reader/article.html?id=a%2Fb');
  });

  it('無 marker 的一般網頁 → 不轉址（content script 跑在 <all_urls>，不可亂動）', () => {
    assert.strictEqual(runLauncher('?utm_source=x'), null);
    assert.strictEqual(runLauncher(''), null);
  });

  it('未知 target → 不轉址', () => {
    assert.strictEqual(runLauncher('?jread-open=bogus'), null);
  });

  it('extension context 失效（無 runtime.id）→ 不轉址', () => {
    assert.strictEqual(runLauncher('?jread-open=feed', { extensionOk: false }), null);
  });
});

describe('home-launcher manifest 接線（v1.5.12）', () => {
  it('content/home-launcher.js 必須緊跟在 namespace.js 後（盡早轉址，但 namespace 仍須最先）', () => {
    const js = MANIFEST.content_scripts[0].js;
    const nsIdx = js.indexOf('content/namespace.js');
    const hlIdx = js.indexOf('content/home-launcher.js');
    assert.ok(hlIdx > -1, 'manifest content_scripts 必須含 home-launcher.js');
    assert.strictEqual(hlIdx, nsIdx + 1,
      'home-launcher.js 必須緊跟在 namespace.js 之後（盡早轉址、其餘 content script 之前）');
  });

  it('home-launcher.js 自帶 browser shim（排在 namespace.js 前、不能依賴它）', () => {
    assert.match(LAUNCHER_SRC,
      /globalThis\.browser\s*=\s*globalThis\.browser\s*\?\?\s*globalThis\.chrome\s*;/,
      'home-launcher.js 必須自帶 browser shim');
  });
});

describe('docs/open.html 跳板頁（v1.5.12）', () => {
  // 去掉 HTML / JS 註解再驗——註解裡會「提到」這些 token（解釋為何刻意不用），
  // 不算實際使用。
  const NOCOMMENT = OPEN_HTML
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('絕不可宣告 apple-mobile-web-app-capable（standalone WebView 不跑擴充 → 轉址失效）', () => {
    assert.ok(!/<meta[^>]*apple-mobile-web-app-capable/i.test(NOCOMMENT),
      'open.html 不可有 apple-mobile-web-app-capable meta，否則開在 standalone 不跑 content script');
  });

  it('頁面自身 JS 不得自行解析擴充頁 URL（拿不到當下 UUID，必須交給 content script）', () => {
    assert.ok(!/runtime\.getURL|safari-web-extension:/.test(NOCOMMENT),
      'open.html 自身不可組擴充頁 URL；轉址唯一可靠路徑是 content script');
  });
});
