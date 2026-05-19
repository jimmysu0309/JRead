// JRead — JREAD_RELOAD handler 必須 guard installType=development（v0.7.143）
//
// Bug：page main world JS（廣告 script / 惡意網站）可 dispatch `__jread_debug`
// event type='reload' → content script bridge → SW JREAD_RELOAD → reload。
// reload 不洩漏資料但會打斷使用者所有 tab 的 reader mode（攻擊者：低成本 nuisance）。
//
// 修法：SW JREAD_RELOAD handler 用 chrome.management.getSelf() 拿 installType
// （不需 "management" permission，self-query），只在 development（unpacked / Claude
// 自主 debug 場景）允許 reload；store / normal install 拒絕。
//
// 本 spec 是 forcing function：
//   - SW JREAD_RELOAD case body 必須含 chrome.management.getSelf
//   - reload() 必須包在 development guard 內

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SW_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'background', 'service-worker.js'), 'utf8'
);

describe('SW JREAD_RELOAD handler 安全 guard（v0.7.143）', () => {
  // 切出 JREAD_RELOAD case body（從 `case 'JREAD_RELOAD':` 到下一個 `case` 或 `default`）
  let caseBody = '';
  before(() => {
    const match = SW_SRC.match(/case\s+['"]JREAD_RELOAD['"]:\s*\{([\s\S]*?)\}\s*(case|default)/);
    assert.ok(match, '必須能找到 JREAD_RELOAD case body');
    caseBody = match[1];
  });

  it('JREAD_RELOAD case body 必須呼叫 chrome.management.getSelf', () => {
    assert.ok(/chrome\.management\.getSelf/.test(caseBody),
      'JREAD_RELOAD handler 必須用 chrome.management.getSelf 檢查 installType。實際 case body:\n' + caseBody);
  });

  it('JREAD_RELOAD case body 必須含 installType === "development" check', () => {
    assert.ok(/installType\s*===\s*['"]development['"]/.test(caseBody),
      'JREAD_RELOAD handler 必須 check installType === "development"（store install 拒絕 reload）');
  });

  it('chrome.runtime.reload() invocation（非註解）必須在 installType check 之後', () => {
    // 排除單行 comment 行，找實際 invocation 行 index
    const lines = caseBody.split('\n');
    let installTypeLine = -1;
    let reloadLine = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\/\//.test(line)) continue;
      if (/^\s*\*/.test(line)) continue;
      if (installTypeLine === -1 && /installType/.test(line)) installTypeLine = i;
      if (reloadLine === -1 && /chrome\.runtime\.reload\s*\(/.test(line)) reloadLine = i;
    }
    assert.notStrictEqual(installTypeLine, -1, 'case body 必須含 installType check（非註解）');
    assert.notStrictEqual(reloadLine, -1, 'case body 必須含 chrome.runtime.reload() invocation（非註解）');
    assert.ok(installTypeLine < reloadLine,
      `installType check 必須出現在 reload() invocation 之前（先驗證再執行）。installType line=${installTypeLine}, reload line=${reloadLine}`);
  });

  it('manifest.json 不應加 "management" permission（getSelf 自查不需要）', () => {
    const manifestPath = path.join(__dirname, '..', '..', 'jread', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const perms = manifest.permissions || [];
    assert.ok(!perms.includes('management'),
      'manifest 不應有 "management" permission——chrome.management.getSelf 不需要 permission（self-query），加 permission 會觸發 Chrome Store 重審');
  });
});
