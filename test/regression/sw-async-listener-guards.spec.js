// JRead — SW / popup async listener 防護 forcing function（v0.8.15）
//
// 2026-06-09 code review 發現三處 async 防護缺口：
//   A1. onInstalled 是 async listener 但無 try/catch，且整包 get(null)+set(merged)
//       全量回寫 → unhandled rejection + 不必要的 storage.sync 配額壓力
//   A2. SAVE_TO_READWISE 的 async IIFE 只包了 buildReadwisePayload，storage.get /
//       saveToReadwise 若 throw → IIFE rejection 無人接、sendResponse 永不回 →
//       popup 卡在「送出中…」
//   A4. popup getActiveTabId 失敗判定用 `if (!tabId)`，會把合法的 tab.id===0
//       誤判失敗（SW 端已正確用 typeof，popup 不一致）
//
// 本 spec 是 forcing function（靜態原始碼斷言）：SW handler 行為需在 Jimmy 本機
// Chrome 才能完整重現，這裡守住「防護程式碼存在且未被改回舊寫法」這層。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'background', 'service-worker.js'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup', 'popup.js'), 'utf8');

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s >= 0, `找不到 startMarker: ${startMarker}`);
  const e = src.indexOf(endMarker, s + startMarker.length);
  assert.ok(e >= 0, `找不到 endMarker: ${endMarker}`);
  return src.slice(s, e);
}

// 去掉行內 // 註解（保留字串安全：本專案註解都整行 //，這裡只濾整行/行尾註解
// 即可，避免負向斷言被「描述舊寫法」的註解文字誤命中）
function stripComments(src) {
  return src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

describe('A1: onInstalled async listener 防護（v0.8.15）', () => {
  let body = '';
  before(() => {
    body = sliceBetween(SW_SRC, 'onInstalled.addListener', 'onMessage.addListener');
  });

  it('整段包 try/catch（避免 await reject 變 unhandled rejection）', () => {
    assert.match(body, /try\s*\{/, 'onInstalled body 必須有 try block');
    assert.match(body, /catch\s*\(/, 'onInstalled body 必須有 catch');
  });

  it('不再整包 set(merged) 全量回寫，改為只寫 diff patch', () => {
    assert.ok(!/set\(\s*merged\s*\)/.test(stripComments(body)),
      'onInstalled 不該再 chrome.storage.sync.set(merged) 全量回寫整個物件');
    assert.match(body, /patch/, 'onInstalled 必須建 patch（只收需補/遷移的 key）');
    assert.match(body, /Object\.keys\(\s*patch\s*\)/,
      'onInstalled 必須在 patch 有內容時才 set（Object.keys(patch).length 判斷）');
  });

  it('保留既有遷移邏輯（legacy stack + boldText→fontWeight）', () => {
    assert.match(body, /LEGACY_SERIF_STACK/);
    assert.match(body, /LEGACY_SANS_STACK/);
    assert.match(body, /boldText/);
    assert.match(body, /fontWeight\s*=\s*600/);
  });
});

describe('A2: SAVE_TO_READWISE async IIFE 防護（v0.8.15）', () => {
  let caseBody = '';
  before(() => {
    const m = SW_SRC.match(/case\s+['"]SAVE_TO_READWISE['"]:\s*\{([\s\S]*?)\n\s{4}default:/);
    assert.ok(m, '必須能找到 SAVE_TO_READWISE case body');
    caseBody = m[1];
  });

  it('async IIFE 有外層 try/catch，保證任何路徑都回 sendResponse', () => {
    // 至少兩個 try（外層 IIFE + 內層 buildReadwisePayload）
    const tryCount = (caseBody.match(/try\s*\{/g) || []).length;
    assert.ok(tryCount >= 2,
      `SAVE_TO_READWISE 應有外層 IIFE try + 內層 payload try（至少 2 個 try），實際 ${tryCount}`);
  });

  it('catch 分支會 sendResponse（不讓 popup 卡在送出中）', () => {
    assert.match(caseBody, /INTERNAL/,
      'catch 應回一個 INTERNAL 錯誤碼經 sendResponse 通知 popup');
    const respCount = (caseBody.match(/sendResponse\(/g) || []).length;
    assert.ok(respCount >= 3,
      `成功 / INVALID_PAYLOAD / INTERNAL 三條路徑都要 sendResponse（至少 3 次），實際 ${respCount}`);
  });
});

describe('A4: popup getActiveTabId 失敗判定用 typeof（v0.8.15）', () => {
  it('getActiveTabId 正規化成 number 或 null', () => {
    assert.match(POPUP_JS, /typeof\s+tab\.id\s*===\s*['"]number['"]/,
      'getActiveTabId 必須用 typeof tab.id === "number" 正規化');
  });

  it('呼叫端一律用 typeof tabId !== "number"，不再用 if (!tabId)', () => {
    const guardCount = (POPUP_JS.match(/typeof\s+tabId\s*!==\s*['"]number['"]/g) || []).length;
    assert.ok(guardCount >= 4,
      `4 處呼叫端都要改 typeof tabId !== "number"，實際 ${guardCount}`);
    assert.ok(!/if\s*\(\s*!tabId\s*\)/.test(stripComments(POPUP_JS)),
      'popup.js 不該再殘留 if (!tabId)（會把 tab.id===0 誤判失敗）');
  });
});
