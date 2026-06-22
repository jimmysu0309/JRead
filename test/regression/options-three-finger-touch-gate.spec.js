// JRead — 三指輕點選項只在觸控裝置顯示（v0.8.163）
//
// Jimmy 2026-06-22：三指輕點切換是觸控裝置（iPhone / iPad，maxTouchPoints >= 3）
// 專屬手勢——桌面 Chrome / macOS Safari（含 iOS build 跑在 Mac，無觸控螢幕
// maxTouchPoints=0）顯示這個開關只會誤導，touch-gestures.js 在非觸控裝置根本不
// 安裝辨識器（同門檻），開了也無效。options.js 在 maxTouchPoints < 3 時隱藏整列。
// 門檻 >= 3 與 popup footer 手勢提示、touch-gestures FINGERS 一致。
//
// 此 spec 是 forcing function：用 Playwright 載真實 options.html + options.js
// （最小 chrome stub 讓頂層跑過），分別在無觸控 / 觸控（覆寫 maxTouchPoints）下
// 量三指列的 rendered display——非觸控未隱藏即 fail。同時驗 .field[hidden] 的
// !important（.field-checkbox 是 display:flex，會蓋過 UA [hidden] 的 display:none，
// 漏這條 JS 設 hidden 也藏不掉）。
//
// 訊號層次（驗 X、不驗 Y）：
//   驗：非觸控 rendered display:none、觸控 display:flex（真實 options.js 跑出來）。
//   不驗：三指手勢本身的觸發行為（touch-gestures harness 另驗）。

const path = require('path');
const assert = require('assert');
const { chromium } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright'));

const OPTIONS_URL = 'file://' + path.join(__dirname, '..', '..', 'jread', 'options', 'options.html');

// 最小 chrome stub：讓 options.js 頂層（getURL runtime 偵測、storage 讀取、
// commands、onChanged）跑過、抵達三指 gate。getURL 回 safari scheme（runtime=safari）。
const CHROME_STUB = `
  window.chrome = {
    runtime: {
      getURL: () => 'safari-web-extension://test/',
      getManifest: () => ({ version: '0.0.0', commands: {} }),
      lastError: null,
      onMessage: { addListener() {} }, sendMessage() {},
      connect: () => ({ onMessage:{addListener(){}}, onDisconnect:{addListener(){}}, postMessage(){}, disconnect(){} })
    },
    storage: {
      sync: { get: (d, cb) => { const v = {}; if (typeof d === 'function') d(v); else if (cb) cb(v); }, set: () => {} },
      onChanged: { addListener() {} }
    },
    tabs: { query: () => Promise.resolve([]), sendMessage: () => Promise.resolve() },
    commands: { getAll: (cb) => cb && cb([]) }
  };
`;

describe('options — 三指選項只在觸控裝置顯示（v0.8.163）', function () {
  this.timeout(30000);
  let browser;

  before(async () => {
    browser = await chromium.launch({ channel: 'chromium', headless: true });
  });
  after(async () => {
    if (browser) await browser.close();
  });

  async function renderDisplay({ touch }) {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
    await ctx.addInitScript(CHROME_STUB);
    if (touch) {
      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5, configurable: true });
      });
    }
    const page = await ctx.newPage();
    await page.goto(OPTIONS_URL);
    const display = await page.evaluate(() => {
      const tf = document.getElementById('threeFingerTap');
      const field = tf && tf.closest('.field');
      return field ? getComputedStyle(field).display : null;
    });
    await ctx.close();
    return display;
  }

  it('非觸控裝置（maxTouchPoints=0）三指列隱藏（display:none）', async () => {
    const display = await renderDisplay({ touch: false });
    assert.strictEqual(display, 'none',
      `非觸控裝置三指列 rendered display 應為 none，實際 ${display}——gate 或 .field[hidden] !important 失效`);
  });

  it('觸控裝置（maxTouchPoints>=3）三指列顯示（display:flex）', async () => {
    const display = await renderDisplay({ touch: true });
    assert.strictEqual(display, 'flex',
      `觸控裝置三指列應顯示（display:flex），實際 ${display}——不可在 iPhone/iPad 誤藏`);
  });
});
