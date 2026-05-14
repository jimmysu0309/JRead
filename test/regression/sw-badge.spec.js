// JRead — service-worker badge 結構 spec
//
// v0.7.125：reader mode 啟動時 toolbar icon 右下角顯示綠色 ● badge（emerald
// #10b981 + 白文字），與既有彩色 icon 切換構成雙通道狀態指示。退出 reader
// mode 或新頁面 loading 時 clear badge。Shinkansen 翻譯完成 badge 用同字元
// （U+25CF BLACK CIRCLE）但不同色（旭日紅 vs 翠綠），跨專案 badge 語意
// 一致——「狀態完成 / 啟用中」。
//
// jsdom 無法 eval SW（chrome API 不存在），所以此 spec 只走 source 結構
// assertion；行為驗證由 test/e2e/sw-regression.spec.js 接（Playwright + 真實
// chrome SW）。

const assert = require('assert');
const { SRC } = require('../helpers');

describe('background/service-worker.js — v0.7.125 reader-active 綠色 badge', () => {
  const src = SRC.serviceWorker;

  it('必須宣告 BADGE_ACTIVE_COLOR 常數 = #10b981（emerald-500）', () => {
    assert.match(src, /const\s+BADGE_ACTIVE_COLOR\s*=\s*['"]#10b981['"]/,
      'BADGE_ACTIVE_COLOR 必須是 #10b981——forcing：色值偏離（例如改回 #22c55e 等其他綠）會破壞 v0.7.125 視覺設計');
  });

  it('必須宣告 BADGE_ACTIVE_TEXT 常數 = " "（單空格、純色塊角標）', () => {
    // v0.7.127：從 ● 改純空格——chrome macOS 把 ● 字面渲染巨大、background
    // 填滿整個 badge 區、視覺上覆蓋整個 icon 看起來像獨立綠圓 icon 而非小
    // 角標。改純空格後 badge 渲染成「純綠色小色塊」（無字元），符合「綠燈
    // LED」直覺。Shinkansen 用 ● 是該專案的 icon 大小/形狀適合、跨專案不能
    // 直接複用同字元。
    assert.match(src, /const\s+BADGE_ACTIVE_TEXT\s*=\s*['"] ['"]/,
      'BADGE_ACTIVE_TEXT 必須是單空格——forcing：改回 ● 或其他寬字元會讓 macOS chrome 把 badge 渲染撐滿整個 icon 區、視覺破壞');
  });

  // 抓 SET_ACTIVE_ICON case 完整 body：從 `case 'SET_ACTIVE_ICON'` 到下一個
  // `case ` / `default:` 之前。regex 非貪婪會被 case body 內巢狀 `}` 提前
  // 截斷，slice + 終點 marker 較可靠。
  function getCaseBody(name) {
    const start = src.search(new RegExp(`case\\s+['"]${name}['"]:`));
    assert.ok(start >= 0, `能找到 case '${name}'`);
    const rest = src.slice(start);
    const nextCase = rest.search(/\n\s*case\s+['"][A-Z_]+['"]:|\n\s*default:/);
    return nextCase >= 0 ? rest.slice(0, nextCase) : rest;
  }

  it('SET_ACTIVE_ICON handler：active=true 時必須 setBadgeText(BADGE_ACTIVE_TEXT)', () => {
    const body = getCaseBody('SET_ACTIVE_ICON');
    assert.match(body, /setBadgeText\s*\(\s*\{\s*text:\s*BADGE_ACTIVE_TEXT/,
      'active 分支必須呼叫 setBadgeText 傳 BADGE_ACTIVE_TEXT——forcing：漏接 → reader mode 沒綠燈');
    assert.match(body, /setBadgeBackgroundColor\s*\(\s*\{\s*color:\s*BADGE_ACTIVE_COLOR/,
      'active 分支必須呼叫 setBadgeBackgroundColor 傳 BADGE_ACTIVE_COLOR');
  });

  it('SET_ACTIVE_ICON handler：active=false 時必須清空 badge（setBadgeText 空字串）', () => {
    const body = getCaseBody('SET_ACTIVE_ICON');
    // else 分支必須 setBadgeText 空字串
    assert.match(body, /else\s*\{[\s\S]*?setBadgeText\s*\(\s*\{\s*text:\s*['"]['"]/,
      'inactive 分支必須 setBadgeText({ text: "" })——forcing：退出 reader mode 後 badge 仍殘留');
  });

  it('SET_ACTIVE_ICON handler：必須 try 設 white text color（舊版 Chrome 無此 API 則 ignore）', () => {
    const body = getCaseBody('SET_ACTIVE_ICON');
    assert.match(body, /if\s*\(\s*chrome\.action\.setBadgeTextColor\s*\)/,
      '必須 feature-detect chrome.action.setBadgeTextColor（舊 Chrome 版相容）');
    assert.match(body, /setBadgeTextColor\s*\(\s*\{\s*color:\s*['"]#ffffff['"]/,
      'badge text color 必須是白色 #ffffff（綠底白字對比清晰）');
  });

  it('tabs.onUpdated status=loading 必須同步清掉 badge（避免跨頁殘留）', () => {
    // 抓 tabs.onUpdated listener
    const m = src.match(/chrome\.tabs\.onUpdated\.addListener\(([\s\S]*?)\}\s*\}\s*\)\s*;/);
    assert.ok(m, '能找到 tabs.onUpdated.addListener');
    const body = m[1];
    assert.match(body, /info\.status\s*===\s*['"]loading['"]/,
      '必須條件式 status === "loading"');
    assert.match(body, /setBadgeText\s*\(\s*\{\s*tabId,\s*text:\s*['"]['"]/,
      'loading 分支必須 setBadgeText({ tabId, text: "" })——forcing：新頁面 loading 時舊頁的綠 badge 會殘留誤導使用者');
  });

  it('BADGE_ACTIVE_COLOR / BADGE_ACTIVE_TEXT 必須在 SET_ACTIVE_ICON handler 之外宣告（避免每次 handler 都重建）', () => {
    const constIdx = src.search(/const\s+BADGE_ACTIVE_COLOR/);
    const handlerIdx = src.search(/case\s+['"]SET_ACTIVE_ICON['"]/);
    assert.ok(constIdx >= 0 && handlerIdx >= 0);
    assert.ok(constIdx < handlerIdx,
      'BADGE 常數必須在 handler 之前宣告（top-level const）—— forcing：放 handler 內每次重建浪費 + 也不該被 v8 inline');
  });

  // ─── v0.7.126：JREAD_RELOAD handler（content script → SW reload bridge）─
  // chrome.runtime.reload() 在 content script context 不存在
  // （Uncaught TypeError: chrome.runtime.reload is not a function）。
  // 必須 SW 中繼。bridge 從 content script sendMessage 給 SW、SW 收到後呼叫
  // chrome.runtime.reload()。
  describe('v0.7.126 JREAD_RELOAD handler（content → SW reload 中繼）', () => {
    it('SW message handler 必須含 JREAD_RELOAD case 並呼叫 chrome.runtime.reload', () => {
      const start = src.search(/case\s+['"]JREAD_RELOAD['"]:/);
      assert.ok(start >= 0,
        'SW 必須含 JREAD_RELOAD case——forcing：content bridge 觸發 reload 時走 sendMessage 中繼，handler 缺席則 reload 不會發生');
      const rest = src.slice(start);
      const nextCase = rest.search(/\n\s*case\s+['"][A-Z_]+['"]:|\n\s*default:/);
      const body = nextCase >= 0 ? rest.slice(0, nextCase) : rest;
      assert.match(body, /chrome\.runtime\.reload\s*\(\s*\)/,
        'JREAD_RELOAD handler 必須呼叫 chrome.runtime.reload()——forcing：handler 收到但漏接 reload call');
    });
  });

  // ─── content script main.js bridge reload 分支 ──────────────────────
  describe('v0.7.126 main.js bridge reload 分支必須走 sendMessage', () => {
    const mainSrc = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'jread', 'content', 'main.js'),
      'utf8'
    );

    it('reload 分支必須走 chrome.runtime.sendMessage({type:"JREAD_RELOAD"})（不可直接呼 chrome.runtime.reload）', () => {
      // 抓 `else if (type === 'reload')` 分支起點——只命中真實 code、不誤撞
      // 上方 comment 內的 'type: reload' 範例字串。
      const idx = mainSrc.search(/else\s+if\s*\(\s*type\s*===\s*['"]reload['"]\s*\)/);
      assert.ok(idx >= 0, "能找到 else if (type==='reload') 分支");
      // 切出 reload branch body：從匹配點到下一個 else if / listener 結束 `});`
      const after = mainSrc.slice(idx);
      const endIdx = after.search(/}\s*else\s+if|\n\s*}\s*\)\s*;/);
      const body = endIdx >= 0 ? after.slice(0, endIdx + 1) : after;
      assert.match(body, /chrome\.runtime\.sendMessage\s*\(\s*\{\s*type:\s*['"]JREAD_RELOAD['"]/,
        "reload 分支必須 sendMessage({type:'JREAD_RELOAD'})——forcing：直接呼 chrome.runtime.reload() 會炸 TypeError（content script 沒此 API）");
    });
  });
});
