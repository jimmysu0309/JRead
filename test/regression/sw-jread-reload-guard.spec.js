// JRead — JREAD_RELOAD handler 必須 guard installType=development（v0.7.143）
//
// Bug：page main world JS（廣告 script / 惡意網站）可 dispatch `__jread_debug`
// event type='reload' → content script bridge → SW JREAD_RELOAD → reload。
// reload 不洩漏資料但會打斷使用者所有 tab 的 reader mode（攻擊者：低成本 nuisance）。
//
// 修法：SW JREAD_RELOAD handler 用 browser.management.getSelf() 拿 installType
// （不需 "management" permission，self-query），只在 development（unpacked / Claude
// 自主 debug 場景）允許 reload；store / normal install 拒絕。
//
// 本 spec 是 forcing function：
//   - SW JREAD_RELOAD case body 必須含 browser.management.getSelf
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

  it('JREAD_RELOAD case body 必須呼叫 browser.management.getSelf', () => {
    assert.ok(/browser\.management\.getSelf/.test(caseBody),
      'JREAD_RELOAD handler 必須用 browser.management.getSelf 檢查 installType。實際 case body:\n' + caseBody);
  });

  // v0.8.36：installType check 抽進共用 runIfDevelopmentInstall（JREAD_RELOAD
  // 與 JREAD_DEBUG_SET_THEME 共用同一 gate）。case body 驗「reload 包在 helper
  // callback 內」、helper 驗「installType check 在 fn() 執行之前」。
  it('runIfDevelopmentInstall helper 必須含 installType === "development" check 且先於 fn()', () => {
    const helper = SW_SRC.match(/function\s+runIfDevelopmentInstall[\s\S]*?\n\}/);
    assert.ok(helper, 'SW 必須有 runIfDevelopmentInstall helper');
    const lines = helper[0].split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l));
    let installTypeLine = -1;
    let fnCallLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (installTypeLine === -1 && /installType\s*===\s*['"]development['"]/.test(lines[i])) installTypeLine = i;
      if (fnCallLine === -1 && /^\s*fn\(\);/.test(lines[i])) fnCallLine = i;
    }
    assert.notStrictEqual(installTypeLine, -1, 'helper 必須 check installType === "development"');
    assert.notStrictEqual(fnCallLine, -1, 'helper 必須在 guard 內呼叫 fn()');
    assert.ok(installTypeLine < fnCallLine, 'installType check 必須在 fn() 之前（先驗證再執行）');
  });

  it('JREAD_RELOAD 的 browser.runtime.reload() 必須包在 runIfDevelopmentInstall callback 內', () => {
    assert.ok(/runIfDevelopmentInstall\(\s*['"]JREAD_RELOAD['"]\s*,\s*\(\)\s*=>\s*browser\.runtime\.reload\(\)\s*\)/.test(caseBody),
      'reload 必須委派 runIfDevelopmentInstall（不可裸呼）');
    // 不可有 guard 外的裸 reload 呼叫
    const bare = caseBody.split('\n').filter(l =>
      !/^\s*(\/\/|\*)/.test(l) && /browser\.runtime\.reload\s*\(\)/.test(l) && !/runIfDevelopmentInstall/.test(l) && !/!browser\.runtime\.reload/.test(l));
    assert.strictEqual(bare.length, 0, 'case body 不可有 gate 外的裸 browser.runtime.reload() 呼叫');
  });

  it('JREAD_DEBUG_SET_THEME 也必須走 runIfDevelopmentInstall + theme 白名單（v0.8.36）', () => {
    const m = SW_SRC.match(/case\s+['"]JREAD_DEBUG_SET_THEME['"]:\s*\{([\s\S]*?)\}\s*(case|default)/);
    assert.ok(m, 'SW 必須有 JREAD_DEBUG_SET_THEME case（debug bridge set-theme 改經 SW 中繼）');
    assert.ok(/runIfDevelopmentInstall\(\s*['"]JREAD_DEBUG_SET_THEME['"]/.test(m[1]),
      'set-theme 必須與 reload 同款 development gate——任意網頁可 dispatch __jread_debug，store 安裝不可被改 theme');
    assert.ok(/\[\s*'light',\s*'dark',\s*'sepia',\s*'gray'\s*\]\.includes\(theme\)/.test(m[1]),
      'SW 端必須再驗一次 theme 白名單（第二道防線）');
  });

  it('content set-theme 分支不可再直寫 browser.storage.sync（必須經 SW 中繼）', () => {
    const MAIN_SRC = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8');
    const m = MAIN_SRC.match(/type === 'set-theme'[\s\S]*?else if/);
    assert.ok(m, '抓得到 set-theme 分支');
    assert.ok(!/browser\.storage\.sync\.set/.test(m[0]),
      'set-theme 分支不可直寫 storage.sync（任意網頁 JS 可觸發、會同步到所有裝置）');
    assert.ok(/JREAD_DEBUG_SET_THEME/.test(m[0]), 'set-theme 必須改送 JREAD_DEBUG_SET_THEME 給 SW');
  });

  // v1.7.3：debug bridge 觸發送儲存服務（Claude 自主驗匯出 pipeline 用）。
  // 若不 gate，任意網頁可 dispatch __jread_debug type='send-readwise' 把自己
  // 偷送進使用者的 Readwise / Instapaper 帳號——比 reload / set-theme 更需要 gate。
  it('JREAD_DEBUG_SEND_READWISE 也必須走 runIfDevelopmentInstall + sender.tab 檢查（v1.7.3）', () => {
    const m = SW_SRC.match(/case\s+['"]JREAD_DEBUG_SEND_READWISE['"]:\s*\{([\s\S]*?)\}\s*(case|default)/);
    assert.ok(m, 'SW 必須有 JREAD_DEBUG_SEND_READWISE case（debug bridge 送儲存服務）');
    assert.ok(/runIfDevelopmentInstall\(\s*['"]JREAD_DEBUG_SEND_READWISE['"]/.test(m[1]),
      'send-readwise 必須與 reload 同款 development gate——否則惡意頁可偷送內容進使用者帳號');
    assert.ok(/sender\s*&&\s*sender\.tab\s*&&\s*sender\.tab\.id/.test(m[1]),
      '必須從 sender.tab.id 取目標分頁（來源必須是 content script）');
    assert.ok(/sendToReadwiseFromCommand\(senderTabId\)/.test(m[1]),
      '必須走與快速鍵同一條 sendToReadwiseFromCommand 軌（單一資料源）');
  });

  it('content send-readwise 分支必須經 SW 中繼（JREAD_DEBUG_SEND_READWISE）', () => {
    const MAIN_SRC = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'main.js'), 'utf8');
    const m = MAIN_SRC.match(/type === 'send-readwise'[\s\S]*?else if/);
    assert.ok(m, '__jread_debug bridge 必須有 send-readwise 分支');
    assert.ok(/JREAD_DEBUG_SEND_READWISE/.test(m[0]),
      'send-readwise 分支必須送 JREAD_DEBUG_SEND_READWISE 給 SW（gate 在 SW 端）');
  });

  it('manifest.json 不應加 "management" permission（getSelf 自查不需要）', () => {
    const manifestPath = path.join(__dirname, '..', '..', 'jread', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const perms = manifest.permissions || [];
    assert.ok(!perms.includes('management'),
      'manifest 不應有 "management" permission——browser.management.getSelf 不需要 permission（self-query），加 permission 會觸發 Chrome Store 重審');
  });
});
