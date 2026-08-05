// JRead — 全面 review 批次 4：content script 防護（v1.7.42）
//
// M4：storage.onChanged 的 spaceScrollRatio 分支缺 cinema guard——影院模式
//     active=true 但 articleEl=null、spaceScroll 刻意不裝，sync 會以 null
//     articleEl 誤裝模組（blockPageShortcuts 分支 v1.6.24 已補同款 guard）。
// M5：main.js 缺重複注入 guard——namespace.js 的 guard 只保護 NS 物件，保不到
//     main.js 掛的 onMessage / onChanged listener（popup injection fallback
//     重跑整包 content scripts 時重複掛 = 每則訊息處理兩次）。
// G2：floating-icon 長按選單固定 bottom:0 錨定（往上長），fab 貼近頂部時選單
//     超出畫面頂。修法：openMenu 依 pos.offsetY 切換上下錨定。
// G3：youtube-borderless pendingLoadedHandler 的 removeEventListener 對「重新
//     querySelector 的新 video」呼叫——SPA 換影片後移不掉舊元素上的 handler。
//     修法：{ el, fn } 成對記錄、移除用記下的 el。
// C7：cleaner hydrateLazyImages 的 hidden.__lazyImages 用賦值非累加，與
//     __phantomText 契約不一致——同 hidden 物件跑第二次會覆蓋前批 hydration
//     記錄、restore 漏還原。
// P5：v1.5.10 restore 診斷儀器（RESTORE_DIAG_KEY / recordRestoreDiag /
//     _restoreBase）觀察期結束移除（Jimmy 2026-08-05 裁定）——每次 restore 多
//     2-3 次 storage 寫入，iOS storage 寫入是 position-memory 痛點。防復活。
//
// 本 spec 是 forcing function（靜態原始碼斷言）：這批 guard 的觸發時序（SPA
// 導航、popup 重注入、影院模式切設定）需真 Chrome 才能完整重現，這裡守住
// 「防護程式碼存在且未被改回舊寫法」這層。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const CONTENT = path.join(__dirname, '..', '..', 'jread', 'content');
const MAIN_SRC = fs.readFileSync(path.join(CONTENT, 'main.js'), 'utf8');
const FLOATING_SRC = fs.readFileSync(path.join(CONTENT, 'floating-icon.js'), 'utf8');
const BORDERLESS_SRC = fs.readFileSync(path.join(CONTENT, 'youtube-borderless.js'), 'utf8');
const CLEANER_SRC = fs.readFileSync(path.join(CONTENT, 'cleaner.js'), 'utf8');
const PM_SRC = fs.readFileSync(path.join(CONTENT, 'position-memory.js'), 'utf8');
const OPTIONS_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'options', 'options.js'), 'utf8');

describe('review-b4 M4 — spaceScrollRatio 分支 cinema guard（v1.7.42）', () => {
  it('spaceScrollRatio in changes 分支必須排除 cinemaActive', () => {
    assert.match(MAIN_SRC,
      /'spaceScrollRatio' in changes && !NS\.state\.cinemaActive/,
      'spaceScrollRatio 即時切換分支必須比照 blockPageShortcuts 補 !NS.state.cinemaActive');
  });
});

describe('review-b4 M5 — main.js 重複注入 guard（v1.7.42）', () => {
  it('main.js 開頭必須有 _mainInstalled guard（比照 touch-gestures）', () => {
    assert.match(MAIN_SRC, /if \(NS\._mainInstalled\) return;/,
      'main.js 必須有重複注入 early return');
    assert.match(MAIN_SRC, /NS\._mainInstalled = true;/,
      'main.js 必須設 _mainInstalled flag');
    // guard 必須在 onMessage 註冊之前（前 1200 字元內——擋在所有 listener 前面）
    const guardIdx = MAIN_SRC.indexOf('NS._mainInstalled = true;');
    const listenerIdx = MAIN_SRC.indexOf('onMessage.addListener');
    assert.ok(guardIdx >= 0 && listenerIdx > guardIdx,
      '_mainInstalled guard 必須在 onMessage listener 註冊之前');
  });
});

describe('review-b4 G2 — floating-icon 選單上下錨定（v1.7.42）', () => {
  it('CSS 必須有 .menu.anchor-top（top:0 往下長）', () => {
    assert.match(FLOATING_SRC, /\.menu\.anchor-top\s*\{\s*top:\s*0;\s*bottom:\s*auto;\s*\}/,
      '必須有 anchor-top class 讓選單改由 top:0 往下長');
  });
  it('openMenu 必須依 pos.offsetY 切換錨定', () => {
    assert.match(FLOATING_SRC,
      /classList\.toggle\('anchor-top',\s*pos\.offsetY\s*<\s*0\.5\)/,
      'openMenu 必須依 fab 垂直位置（offsetY < 0.5 = 上半部）切換 anchor-top');
  });
});

describe('review-b4 G3 — youtube-borderless loadedmetadata 成對移除（v1.7.42）', () => {
  it('pending handler 必須 { el, fn } 成對記錄', () => {
    assert.match(BORDERLESS_SRC, /pendingLoaded\s*=\s*\{\s*el:\s*v,\s*fn\s*\}/,
      'handler 必須與掛載元素成對記錄');
  });
  it('removeEventListener 必須對記下的元素呼叫（不可重新 querySelector）', () => {
    const removals = BORDERLESS_SRC.match(/pendingLoaded\.el\.removeEventListener\('loadedmetadata',\s*pendingLoaded\.fn\)/g) || [];
    assert.ok(removals.length >= 2,
      `requestResize 重掛與 unapply 兩處都必須用 pendingLoaded.el 移除（實際 ${removals.length} 處）`);
    assert.ok(!/pendingLoadedHandler/.test(BORDERLESS_SRC),
      '舊的 pendingLoadedHandler 單變數寫法（對新 querySelector 元素 remove = no-op）不可殘留');
  });
});

describe('review-b4 C7 — hydrateLazyImages 累加契約（v1.7.42）', () => {
  it('hidden.__lazyImages 必須累加（concat）而非賦值', () => {
    assert.match(CLEANER_SRC,
      /hidden\.__lazyImages\s*=\s*\(hidden\.__lazyImages\s*\|\|\s*\[\]\)\.concat\(/,
      '與 __phantomText 契約一致——同 hidden 物件跑第二次不可覆蓋前批 hydration 記錄');
  });
});

describe('review-b4 P5 — restore 診斷儀器移除防復活（v1.7.42）', () => {
  it('position-memory.js 不可再有 RESTORE_DIAG_KEY / recordRestoreDiag / _restoreBase', () => {
    assert.ok(!/const\s+RESTORE_DIAG_KEY/.test(PM_SRC),
      'RESTORE_DIAG_KEY 常數已移除（Jimmy 2026-08-05 裁定觀察期結束），不可復活');
    assert.ok(!/function\s+recordRestoreDiag|recordRestoreDiag\(/.test(PM_SRC),
      'recordRestoreDiag 已移除——每次 restore 多 2-3 次 storage 寫入是 iOS 痛點');
    assert.ok(!/let\s+_restoreBase/.test(PM_SRC),
      '_restoreBase 狀態已移除');
  });
  it('options.js 不可再讀取 readingPositionsRestoreDiag', () => {
    assert.ok(!/readingPositionsRestoreDiag:\s*null/.test(OPTIONS_SRC),
      'options 除錯區塊不可再向 storage.local 要 readingPositionsRestoreDiag');
    assert.ok(!/restoreSuffix/.test(OPTIONS_SRC),
      'restoreSuffix 顯示邏輯已移除');
  });
});
