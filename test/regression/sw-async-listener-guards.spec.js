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

// v0.8.65：popup SAVE_TO_READWISE 訊息 + SW handler 已移除（popup 改 extension
// 頁直送，見 readwise-save.spec.js）。原 A2 守的「SW 內送 Readwise 的 async 流程
// 不留 unhandled rejection」這層改由鍵盤快速鍵軌 sendToReadwiseFromCommand 承接
// ——它仍在 SW 內 storage.get + buildReadwisePayload + saveToReadwise（無 popup
// 可承接、必須各自 try/catch 給 toast 回饋，不可裸跑 reject 整個 function 靜默死）。
describe('A2: sendToReadwiseFromCommand async 防護（v0.8.65：原 SAVE_TO_READWISE IIFE 退役）', () => {
  let fnBody = '';
  before(() => {
    const m = SW_SRC.match(/async function sendToReadwiseFromCommand\s*\([\s\S]*$/);
    assert.ok(m, '必須能找到 sendToReadwiseFromCommand 函式 body');
    fnBody = m[0];
  });

  it('storage.get / buildReadwisePayload / saveToReadwise 三步都包 try/catch（至少 3 個 try）', () => {
    const tryCount = (fnBody.match(/try\s*\{/g) || []).length;
    assert.ok(tryCount >= 3,
      `三步 async / 可拋呼叫都要 try（至少 3 個 try），實際 ${tryCount}`);
  });

  it('每條失敗路徑都 showToast（不讓 reject 變 unhandled / function 靜默死）', () => {
    // 失敗 toast：storage 讀取失敗 / payload 無效 / 網路錯誤 至少各一
    const toastCount = (fnBody.match(/showToast\(/g) || []).length;
    assert.ok(toastCount >= 4,
      `成功 + 多條失敗路徑都要 showToast（至少 4 次），實際 ${toastCount}`);
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
