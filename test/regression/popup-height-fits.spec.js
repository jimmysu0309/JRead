// JRead — popup 全展開高度必須低於瀏覽器 popup 上限（v0.7.248）
//
// Bug：macOS Safari popup 不隨內容適應、出捲軸（Jimmy 回報）。根因 = 全展開
// 內容（10 設定列 + 切換 / Readwise 兩按鈕 + footer）達 623px，超過瀏覽器
// extension popup ~600px 高度上限（Chrome / Firefox / Safari 通用）→ 內容被
// 上限 clip 出捲軸。修法：收斂垂直節奏（body 垂直 padding 16→12、設定列間距
// 12→8、settings / footer margin 16→12）把全展開壓到 ~570px。
//
// 此 spec 是 forcing function：rendered layout 高度 jsdom 量不到，改用 Playwright
// 載 popup.html、把所有條件列 un-hide（reader active + 翻頁 + 有 domain 的最高
// 狀態）量 body.scrollHeight，> MAX_POPUP_HEIGHT 即 fail——未來新增設定列若把
// popup 推回上限以上會被擋下。
//
// 量的是「內容高度」這一層：不驗瀏覽器實際 popover 視窗行為（Safari 的 popover
// sizing 要真機驗，見 CLAUDE.md popup 手動驗清單），但「內容 < 上限」是消捲軸
// 的必要條件。

const path = require('path');
const assert = require('assert');
const { chromium } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright'));

const POPUP_URL = 'file://' + path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.html');
// 瀏覽器 extension popup 高度上限約 600px；留 ~10px 餘裕當門檻
const MAX_POPUP_HEIGHT = 590;

describe('popup — 全展開高度低於瀏覽器 popup 上限（v0.7.248）', function () {
  this.timeout(30000);
  let browser;

  before(async () => {
    browser = await chromium.launch({ channel: 'chromium', headless: true });
  });
  after(async () => {
    if (browser) await browser.close();
  });

  it(`所有條件列展開時 body.scrollHeight 必須 <= ${MAX_POPUP_HEIGHT}px`, async () => {
    const page = await browser.newPage({ viewport: { width: 360, height: 1400 } });
    await page.goto(POPUP_URL);
    // 模擬 macOS 最高內容狀態：reader active（Readwise 鈕）+ 翻頁（頁碼列）+ 有 host（自動啟動列）
    await page.evaluate(() => {
      for (const id of ['readwise-btn', 'page-number-row', 'auto-domain-row']) {
        const el = document.getElementById(id);
        if (el) el.hidden = false;
      }
    });
    const h = await page.evaluate(() => document.body.scrollHeight);
    await page.close();
    assert.ok(h <= MAX_POPUP_HEIGHT,
      `popup 全展開高度 ${h}px 超過上限 ${MAX_POPUP_HEIGHT}px——會在 Chrome / Safari popup 出捲軸；請收斂垂直節奏`);
  });
});
