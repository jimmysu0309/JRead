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

  it('必須宣告 BADGE_ACTIVE_TEXT 常數 = ● (U+25CF)', () => {
    assert.match(src, /const\s+BADGE_ACTIVE_TEXT\s*=\s*['"]●['"]/,
      'BADGE_ACTIVE_TEXT 必須是 U+25CF BLACK CIRCLE——forcing：字元改成方塊 / 對勾 / 其他符號會破壞跨專案（與 Shinkansen）badge 語意一致性');
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
});
