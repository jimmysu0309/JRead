// JRead — 測試共用 helpers
// 把 regression spec 重複的 JSDOM setup + content script 載入樣板抽成可共用函式。
// 三個 spec（detector / cleaner / styler）都用 `fs.readFileSync + window.__JRead = {state:{},MSG:{}} + window.eval(SRC)` 這段。

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const JREAD_DIR = path.join(__dirname, '..', 'jread');

// 載入 content script source 字串（Manifest V3 禁止 ES module import，
// 這些檔案都是 IIFE，eval 後 NS 模組會掛上 window.__JRead）。
const SRC = {
  namespace:     fs.readFileSync(path.join(JREAD_DIR, 'content', 'namespace.js'), 'utf8'),
  detector:      fs.readFileSync(path.join(JREAD_DIR, 'content', 'detector.js'), 'utf8'),
  cleaner:       fs.readFileSync(path.join(JREAD_DIR, 'content', 'cleaner.js'), 'utf8'),
  editMode:      fs.readFileSync(path.join(JREAD_DIR, 'content', 'edit-mode.js'), 'utf8'),
  styler:        fs.readFileSync(path.join(JREAD_DIR, 'content', 'styler.js'), 'utf8'),
  toast:         fs.readFileSync(path.join(JREAD_DIR, 'content', 'toast.js'), 'utf8'),
  // SW 不能 eval 在 jsdom（chrome API 不存在），只取 source 給結構 assertion 用
  serviceWorker: fs.readFileSync(path.join(JREAD_DIR, 'background', 'service-worker.js'), 'utf8')
};

/**
 * 用 fixture HTML 建立 JSDOM 環境 + 最小 window.__JRead + eval 指定 content scripts。
 *
 * @param {Object} opts
 * @param {string} opts.fixturePath  fixture HTML 檔絕對路徑
 * @param {Array<keyof typeof SRC>} opts.scripts  要 eval 的 script（namespace 不需手動載，此 helper 用最小 NS 替代）
 * @param {Object} [opts.viewport]   { width, height } 可選；有值時 stub window.innerWidth/innerHeight
 * @param {boolean} [opts.pretendToBeVisual=false]  JSDOM pretendToBeVisual（cleaner 的 fixed/sticky rect 需要）
 * @param {string} [opts.url]        jsdom 的 document URL（預設 about:blank）。驗
 *                                   「自連結 permalink 標題」這類比對 location 的
 *                                   規則時必須給，否則 fixture 內的相對 href 解析
 *                                   不出 origin、guard 永遠 false（偽陰性）
 * @returns {{ window: Window, document: Document, NS: Object }}
 */
function loadFixtureWithScripts(opts) {
  const { fixturePath, scripts, viewport, pretendToBeVisual, url } = opts;
  const html = fs.readFileSync(fixturePath, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: !!pretendToBeVisual,
    ...(url ? { url } : {})
  });
  const { window } = dom;
  if (viewport) {
    Object.defineProperty(window, 'innerWidth',  { value: viewport.width,  configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: viewport.height, configurable: true });
  }
  // 載入「真正的」namespace.js（單一資料源）——含 state / MSG / safeSendMessage
  // / foldTitlePunct 等共用 helper。namespace.js 頂端讀 chrome.runtime.getManifest()，
  // jsdom 無 chrome，先補最小 stub。改用真 namespace（而非舊的 `{state:{},MSG:{}}`
  // 最小替身）的理由：cleaner/detector 的標題折疊倚賴 NS.foldTitlePunct，最小
  // 替身缺這個 helper 會讓 spec 走 fallback、驗不到 fold 行為（v0.7.251 CNBC
  // 智慧撇號修法的 forcing function 需要真 helper 才有意義）。
  // getURL stub：styler 的內嵌字型 @font-face 用 chrome.runtime.getURL 取
  // web_accessible_resource 路徑。缺這個 stub 時 styler 會 guard 成不注入
  // @font-face（embed-serif-font.spec 驗的就是這條），補上才能驗到 runtime 注入。
  window.chrome = window.chrome || {
    runtime: {
      getManifest: () => ({ version: '0.0.0-test' }),
      id: 'test-ext',
      sendMessage: () => {},
      getURL: (p) => 'chrome-extension://test-ext/' + p
    }
  };
  window.eval(SRC.namespace);
  for (const name of scripts) {
    if (name === 'namespace') continue; // 已載入
    if (!SRC[name]) throw new Error(`unknown content script: ${name}`);
    window.eval(SRC[name]);
  }
  return { window, document: window.document, NS: window.__JRead };
}

/**
 * 覆寫 element 的 getBoundingClientRect（jsdom 預設全回 0）。
 * cleaner 的 fixed/sticky 判定倚賴 rect，jsdom 環境下必須人工 stub。
 */
function stubRect(el, rect) {
  el.getBoundingClientRect = () => ({
    top: rect.top,
    bottom: rect.top + rect.height,
    left: rect.left || 0,
    right: (rect.left || 0) + rect.width,
    width: rect.width,
    height: rect.height,
    x: rect.left || 0,
    y: rect.top
  });
}

module.exports = { loadFixtureWithScripts, stubRect, SRC, JREAD_DIR };
