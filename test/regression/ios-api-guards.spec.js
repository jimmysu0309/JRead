// JRead — iOS Safari API availability guards（v0.7.217）
//
// 背景：iOS / iPadOS Safari Web Extension（TestFlight 軌）不支援部分
// chrome.* API：
//   - chrome.management（JREAD_RELOAD debug bridge 用 getSelf 查 installType）
//   - chrome.runtime.reload
//   - chrome.commands（popup 快速鍵提示）
//   - chrome.action 子集可能缺 setIcon / badge 系列
//   - chrome.windows（YouTube Borderless RESIZE_OWN_WINDOW）
//
// 缺 API 時直接呼叫會丟 TypeError：
//   - SW 內 → 炸掉 onMessage listener，後續 message 全失效
//   - popup.js top-level → 中斷整個 popup script，連 toggle 按鈕都掛
//
// 修法：所有 iOS 可能缺席的 API 呼叫點前加 existence guard（或包 try/catch）。
// 本 spec 是 forcing function——guard 被移除即 fail。
//
// 注意：這條驗「guard 存在於 source」，不驗「iOS 實機行為」（jsdom 跑不了
// Safari）。iOS 實機行為靠 simulator / TestFlight 實測驗收。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SW_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'background', 'service-worker.js'), 'utf8'
);
const POPUP_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'popup', 'popup.js'), 'utf8'
);

// 切出 switch case body（從 `case 'X':` 到下一個 `case` 或 `default`）
function caseBody(src, name) {
  const m = src.match(new RegExp(`case\\s+['"]${name}['"]:\\s*\\{([\\s\\S]*?)\\}\\s*(case|default)`));
  assert.ok(m, `必須能找到 ${name} case body`);
  return m[1];
}

describe('iOS Safari API availability guards（v0.7.217）', () => {
  it('SW JREAD_RELOAD：chrome.management.getSelf 呼叫前必須有 existence guard', () => {
    const body = caseBody(SW_SRC, 'JREAD_RELOAD');
    // 排除註解行後，guard 必須出現在 getSelf invocation 之前
    // v0.8.36：getSelf 實際呼叫搬進共用 runIfDevelopmentInstall helper
    // （JREAD_RELOAD 與 JREAD_DEBUG_SET_THEME 共用同一 gate）——case body 驗
    // existence guard + helper 委派，helper 內驗 getSelf 呼叫。
    const lines = body.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l));
    let guardLine = -1;
    let callLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (guardLine === -1 && /chrome\.management\s*&&\s*chrome\.management\.getSelf/.test(lines[i])) guardLine = i;
      if (callLine === -1 && /runIfDevelopmentInstall\s*\(/.test(lines[i])) callLine = i;
    }
    assert.notStrictEqual(guardLine, -1,
      'JREAD_RELOAD 必須含 `chrome.management && chrome.management.getSelf` existence guard（iOS 無 management API）');
    assert.notStrictEqual(callLine, -1, 'JREAD_RELOAD 必須委派 runIfDevelopmentInstall');
    assert.ok(guardLine < callLine, 'guard 必須在 helper 呼叫之前');
    const helper = SW_SRC.match(/function\s+runIfDevelopmentInstall[\s\S]*?\n\}/);
    assert.ok(helper && /chrome\.management\.getSelf\s*\(\s*\(/.test(helper[0]),
      'runIfDevelopmentInstall 必須實際呼叫 chrome.management.getSelf');
  });

  it('SW JREAD_RELOAD：guard 必須同時檢查 chrome.runtime.reload 存在', () => {
    const body = caseBody(SW_SRC, 'JREAD_RELOAD');
    assert.ok(/!chrome\.runtime\.reload/.test(body),
      'JREAD_RELOAD guard 必須含 `!chrome.runtime.reload` 檢查（iOS 無 runtime.reload）');
  });

  it('SW SET_ACTIVE_ICON：chrome.action 呼叫前必須有 existence guard', () => {
    const body = caseBody(SW_SRC, 'SET_ACTIVE_ICON');
    const lines = body.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l));
    let guardLine = -1;
    let callLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (guardLine === -1 && /!chrome\.action\s*\|\|/.test(lines[i])) guardLine = i;
      if (callLine === -1 && /chrome\.action\.setIcon\s*\(/.test(lines[i])) callLine = i;
    }
    assert.notStrictEqual(guardLine, -1,
      'SET_ACTIVE_ICON 必須含 `!chrome.action || ...` existence guard（iOS action API 子集可能缺）');
    assert.notStrictEqual(callLine, -1, 'SET_ACTIVE_ICON 必須仍有 setIcon 實際呼叫');
    assert.ok(guardLine < callLine, 'guard 必須在 setIcon 呼叫之前');
  });

  it('SW RESIZE_OWN_WINDOW：chrome.windows.update 必須包在 try block 內', () => {
    const body = caseBody(SW_SRC, 'RESIZE_OWN_WINDOW');
    // windows.update invocation 之前（同 case body 內）必須出現 try {
    const updateIdx = body.search(/chrome\.windows\.update\s*\(/);
    assert.ok(updateIdx > -1, 'RESIZE_OWN_WINDOW 必須仍有 windows.update 呼叫');
    const beforeUpdate = body.slice(0, updateIdx);
    assert.ok(/try\s*\{[^}]*$/.test(beforeUpdate),
      'chrome.windows.update 必須在 try { 內（iOS 無 windows API，TypeError 需被吃掉）');
  });

  it('popup.js：chrome.commands.getAll 呼叫必須在 existence guard 內', () => {
    const lines = POPUP_SRC.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l));
    let guardLine = -1;
    let callLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (guardLine === -1 && /chrome\.commands\s*&&\s*chrome\.commands\.getAll/.test(lines[i])) guardLine = i;
      if (callLine === -1 && /chrome\.commands\.getAll\s*\(\s*\(/.test(lines[i])) callLine = i;
    }
    assert.notStrictEqual(guardLine, -1,
      'popup.js 必須含 `chrome.commands && chrome.commands.getAll` guard（iOS 無 commands API，top-level TypeError 會炸掉整個 popup）');
    assert.notStrictEqual(callLine, -1, 'popup.js 必須仍有 getAll 實際呼叫');
    assert.ok(guardLine < callLine, 'guard 必須在 getAll 呼叫之前');
  });

  it('popup.js：commands API 缺席時必須隱藏快速鍵提示列（else 分支）', () => {
    // v0.7.220：提示改為先讀 storage customShortcuts（自訂鍵優先），結構從
    // top-level `else if (shortcutEl)` 移進 storage callback（callback 開頭
    // shortcutEl null-check early return）——守的行為不變：commands API 缺席
    // 且無自訂鍵時整列 hidden。
    assert.ok(/else\s*\{\s*\n?\s*shortcutEl\.hidden\s*=\s*true/.test(POPUP_SRC),
      'commands API 不存在時 shortcutEl 必須 hidden（iOS 觸控環境沒有鍵盤指派頁可去）');
    assert.ok(/if\s*\(!shortcutEl\)\s*return/.test(POPUP_SRC),
      'storage callback 開頭必須 shortcutEl null-check（取代舊 else-if guard）');
  });
});
