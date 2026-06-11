// JRead — 閱讀位置記憶 e2e spec（v0.8.40）
// -----------------------------------------------------------------------------
// 必要動作：`npm run test:e2e`（預設 `npm test` 已 --ignore test/e2e/**）。
//
// 為什麼需要 e2e：jsdom 無 layout——scrollTop 回復落點、翻頁 goToPage 的
// scrollLeft、storage.local 跨 enter/exit 的持久化都只能在真 Chromium 驗。
// jsdom 層的純邏輯（效期 / 段落比對 / 頁碼換算）在
// test/regression/position-memory.spec.js。
//
// 訊號層次：本 spec 驗「同一個瀏覽器 session 內 exit → 重進回復位置」與
// 「停用時不寫記錄」；不驗跨瀏覽器重啟（profile 每次 launch 清掉）——該層
// 由 debug-harness 實測過（2026-06-11：跨 run 重開 enter 自動回到第 2 頁）。

const path = require('path');
const http = require('http');
const assert = require('assert');

const { launchExtension, openTab, getTabId } =
  require(path.join(__dirname, '..', '..', 'tools', 'e2e-harness.js'));

// 長文 fixture：60 段相異文字（段落簽名比對需要 distinct 內容）、總長足以
// 在 768px 高 viewport 捲動數屏、翻頁模式切出多頁。
function buildLongArticle() {
  let paras = '';
  for (let i = 1; i <= 60; i++) {
    paras += `<p>第 ${i} 段：閱讀位置記憶 e2e fixture 的測試段落內容，` +
      `這一段刻意寫得夠長讓整篇文章在預設視窗高度下需要捲動許多屏才能讀完，` +
      `每段開頭的編號保證段落文字簽名彼此相異、簽名比對可以精準找回同一段。</p>\n`;
  }
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><title>Position Memory E2E Fixture</title></head>
<body>
<article>
<h1>閱讀位置記憶 E2E 測試文章</h1>
${paras}
</article>
</body>
</html>`;
}

function startLongFixtureServer() {
  const html = buildLongArticle();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/`,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('閱讀位置記憶 e2e（真 Chromium + storage.local）', function () {
  this.timeout(120000);

  let harness, server, TEST_URL, page, tabId;

  before(async function () {
    if (process.env.JREAD_SKIP_E2E === '1') this.skip();
    server = await startLongFixtureServer();
    TEST_URL = server.url;
    harness = await launchExtension();
    page = await openTab(harness.ctx, TEST_URL);
    tabId = await getTabId(harness.sw, TEST_URL);
    assert.ok(tabId, '必須拿得到 tabId');
  });
  after(async () => {
    if (harness) await harness.cleanup();
    if (server) await server.close();
  });

  function toggle() {
    return harness.sw.evaluate(async (id) => {
      try { return { ok: true, res: await chrome.tabs.sendMessage(id, { type: 'TOGGLE_READER_MODE' }) }; }
      catch (e) { return { ok: false, err: e.message }; }
    }, tabId);
  }
  function setSync(obj) {
    return harness.sw.evaluate((o) => chrome.storage.sync.set(o), obj);
  }
  function clearPositions() {
    return harness.sw.evaluate(() => chrome.storage.local.remove('readingPositions'));
  }
  function readPositions() {
    return harness.sw.evaluate(async () =>
      (await chrome.storage.local.get('readingPositions')).readingPositions || {});
  }

  it('捲動模式：exit 後重進回到上次捲動位置附近（段落錨點）', async () => {
    await setSync({ pagedMode: false, positionMemoryDays: 3 });
    await clearPositions();
    const enter = await toggle();
    assert.strictEqual(enter.res && enter.res.active, true, 'enter 必須成功');
    await sleep(800);

    // 捲到全文 50% 處，等 debounce 寫入
    await page.evaluate(() => {
      const s = document.scrollingElement;
      window.scrollTo(0, Math.round((s.scrollHeight - window.innerHeight) * 0.5));
    });
    await sleep(1600);
    const savedY = await page.evaluate(() => window.scrollY);
    assert.ok(savedY > 500, '捲動後 scrollY 必須離開頁首（fixture 要夠長）');

    await toggle(); // exit（endSession flush）
    await sleep(800);

    const map1 = await readPositions();
    const keys = Object.keys(map1);
    assert.strictEqual(keys.length, 1, 'exit 後 storage.local 必須有一筆記錄');
    assert.strictEqual(map1[keys[0]].mode, 'scroll', '記錄模式 = scroll');
    assert.ok(map1[keys[0]].blockText, '必須帶段落文字簽名');

    await toggle(); // 重進 → restore
    await sleep(2000); // restore + 1.2s 二次對位

    const y = await page.evaluate(() => window.scrollY);
    const vh = await page.evaluate(() => window.innerHeight);
    assert.ok(y > 500, `重進後必須回到文章中段（y=${y}）`);
    assert.ok(Math.abs(y - savedY) < vh,
      `回復位置與離開位置差距須小於一屏（saved=${savedY} restored=${y}）`);

    await toggle(); // 清場
    await sleep(500);
  });

  it('翻頁模式：exit 後重進回到同一頁', async () => {
    await setSync({ pagedMode: true, positionMemoryDays: 3 });
    await clearPositions();
    await toggle();
    await sleep(1200);

    const readIndicator = () => page.evaluate(() => {
      const el = document.getElementById('__jread-page-indicator');
      return el ? el.textContent : null;
    });
    const ind0 = await readIndicator();
    assert.ok(/^1 \/ \d+/.test(ind0 || ''), `進場必須在第 1 頁（indicator=${ind0}）`);
    const total = Number((ind0 || '').split('/')[1]);
    assert.ok(total >= 3, `fixture 必須切出至少 3 頁（total=${total}）`);

    await page.keyboard.press('ArrowRight');
    await sleep(450);
    await page.keyboard.press('ArrowRight');
    await sleep(1500); // 翻頁動畫 + save debounce

    const ind1 = await readIndicator();
    assert.ok((ind1 || '').startsWith('3 /'), `翻兩頁後必須在第 3 頁（indicator=${ind1}）`);

    await toggle(); // exit
    await sleep(800);
    const map = await readPositions();
    const entry = map[Object.keys(map)[0]];
    assert.ok(entry, 'exit 後必須有記錄');
    assert.strictEqual(entry.mode, 'paged', '記錄模式 = paged');
    assert.strictEqual(entry.page, 2, '0-based 頁碼 = 2（第 3 頁）');

    await toggle(); // 重進 → restore
    await sleep(2000);
    const ind2 = await readIndicator();
    assert.ok((ind2 || '').startsWith('3 /'),
      `重進後必須回到第 3 頁（indicator=${ind2}）`);

    await toggle(); // 清場
    await sleep(500);
  });

  it('positionMemoryDays = 0 停用：不寫任何記錄', async () => {
    await setSync({ pagedMode: false, positionMemoryDays: 0 });
    await clearPositions();
    await toggle();
    await sleep(800);
    await page.evaluate(() => {
      const s = document.scrollingElement;
      window.scrollTo(0, Math.round((s.scrollHeight - window.innerHeight) * 0.5));
    });
    await sleep(1600);
    await toggle(); // exit
    await sleep(800);
    const map = await readPositions();
    assert.deepStrictEqual(Object.keys(map), [], '停用時 storage.local 必須沒有記錄');
    await setSync({ positionMemoryDays: 3 }); // 還原預設
  });
});
