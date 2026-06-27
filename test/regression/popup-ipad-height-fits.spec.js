// JRead — iPad 工具列 popover 全展開高度必須落進 OS 固定高度（v0.8.163）
//
// Bug：iPad 上 popup 是工具列圖示的 OS 固定高度 popover，JRead 的全展開內容
// （12 設定列 + 3 按鈕，觸控版 zoom 1.35 下 visual ~845px）超過 popover 高度，
// 底部「此網域自動啟動 / 進階設定」被截斷且不捲動（Jimmy 2026-06-22 iPad 截圖）。
// iPhone 是整螢幕底部 sheet、空間較足，維持 zoom 1.35 readability、不受影響。
// 修法：popup.js 依 screen 短邊 ≥ 600 + 觸控標記 body.device-ipad，CSS 對 iPad
// 降 zoom 1.35→1.2 + 收斂垂直節奏，把全展開壓到 ~700px 落進 popover。
//
// 此 spec 是 forcing function：用 Playwright iPad 模擬（覆寫 maxTouchPoints=5，
// 模擬器預設只回 1）、un-hide 所有條件列量 body 視覺高度（scrollHeight × zoom），
// > MAX_IPAD_POPUP_HEIGHT 即 fail——未來有人把 zoom 調回 1.35 / 新增設定列把高度
// 推回 popover 上限以上會被擋下。同時驗 device-ipad 標記與 zoom 1.2 確實生效
// （避免修法被 markIpad 失效而靜默繞過）。
//
// 訊號層次（驗 X、不驗 Y）：
//   驗：iPad 觸控組態下「內容視覺高度 < 設定上限」+ 標記/zoom 生效。
//   不驗：真實 iPad popover 的實際 px 高度（OS 給定、無 API 讀取，須真機驗，見
//        CLAUDE.md popup 手動驗清單）；「內容 < 上限」是不被截斷的必要條件。

const path = require('path');
const assert = require('assert');
const { chromium, devices } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright'));

const POPUP_URL = 'file://' + path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.html');
// iPad popover 估計高度上限 ~700–720px；修法後實測 701px，留 ~20px 餘裕當門檻
const MAX_IPAD_POPUP_HEIGHT = 720;

describe('popup — iPad popover 全展開高度落進 OS 固定高（v0.8.163）', function () {
  this.timeout(30000);
  let browser;

  before(async () => {
    browser = await chromium.launch({ channel: 'chromium', headless: true });
  });
  after(async () => {
    if (browser) await browser.close();
  });

  it(`iPad 觸控組態全展開 body 視覺高度必須 <= ${MAX_IPAD_POPUP_HEIGHT}px`, async () => {
    const ctx = await browser.newContext({ ...devices['iPad (gen 7)'] });
    // 模擬器預設 maxTouchPoints=1；真機 iPad 為 5。覆寫成真機值讓 markIpad 命中
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5, configurable: true });
    });
    const page = await ctx.newPage();
    await page.goto(POPUP_URL);
    // 最高內容狀態：reader active（Readwise / 編輯鈕）+ 有 host（自動啟動列）。
    // v1.5.4：頁碼指示 row 已移除（頁碼一律顯示），不再計入。
    await page.evaluate(() => {
      for (const id of ['readwise-btn', 'edit-btn', 'auto-domain-row']) {
        const el = document.getElementById(id);
        if (el) el.hidden = false;
      }
    });
    const r = await page.evaluate(() => {
      const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
      return {
        hasIpadClass: document.body.classList.contains('device-ipad'),
        zoom: z,
        visual: Math.round(document.body.scrollHeight * z)
      };
    });
    await ctx.close();
    assert.ok(r.hasIpadClass, 'markIpad 未標記 device-ipad——iPad 偵測（screen 短邊 ≥ 600 + 觸控）失效，壓縮整段被繞過');
    assert.ok(Math.abs(r.zoom - 1.2) < 0.001, `iPad popup zoom 應為 1.2（壓縮主力），實際 ${r.zoom}`);
    assert.ok(r.visual <= MAX_IPAD_POPUP_HEIGHT,
      `iPad popup 全展開視覺高度 ${r.visual}px 超過上限 ${MAX_IPAD_POPUP_HEIGHT}px——會在 iPad popover 底部被截斷；請降 zoom 或收斂垂直節奏`);
  });
});
