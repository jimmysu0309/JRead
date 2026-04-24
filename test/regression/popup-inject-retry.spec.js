// JRead — popup 主動注入 fallback regression
// 對應 bug：v0.2.1 修復「對 extension reload 前已開啟的既有分頁 toggle 失效」。
// 核心邏輯抽至 jread/popup/popup-core.js（v0.2.2 重構），本 spec 即為當初列入
// PENDING_REGRESSION 的待補測試。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { toggleWithInjectionFallback, CONTENT_SCRIPT_FILES } = require(
  path.join(__dirname, '..', '..', 'jread', 'popup', 'popup-core.js')
);

const MANIFEST_PATH = path.join(__dirname, '..', '..', 'jread', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const MANIFEST_CONTENT_SCRIPT_FILES =
  (manifest.content_scripts && manifest.content_scripts[0] && manifest.content_scripts[0].js) || [];

const TAB_ID = 42;

function makeDeps({ sendMessageImpl, executeScriptImpl }) {
  const calls = { sendMessage: [], executeScript: [] };
  return {
    calls,
    deps: {
      sendMessage: async (tabId, msg) => {
        calls.sendMessage.push({ tabId, msg });
        return sendMessageImpl(calls.sendMessage.length, tabId, msg);
      },
      executeScript: async (opts) => {
        calls.executeScript.push(opts);
        return executeScriptImpl ? executeScriptImpl(opts) : undefined;
      }
    }
  };
}

describe('popup-core.toggleWithInjectionFallback', () => {
  it('一般頁面（sendMessage 成功）：只送一次 message、不注入', async () => {
    const { deps, calls } = makeDeps({
      sendMessageImpl: () => ({ active: true })
    });
    const result = await toggleWithInjectionFallback(TAB_ID, deps);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.injected, false);
    assert.deepStrictEqual(result.res, { active: true });
    assert.strictEqual(calls.sendMessage.length, 1);
    assert.strictEqual(calls.executeScript.length, 0);
  });

  it('既有分頁（首次 sendMessage 失敗）：主動注入後重試一次並成功', async () => {
    const { deps, calls } = makeDeps({
      sendMessageImpl: (attempt) => {
        if (attempt === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
        return { active: false };
      }
    });
    const result = await toggleWithInjectionFallback(TAB_ID, deps);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.injected, true);
    assert.deepStrictEqual(result.res, { active: false });
    assert.strictEqual(calls.sendMessage.length, 2, '應送 sendMessage 兩次（首次失敗 + 注入後重試）');
    assert.strictEqual(calls.executeScript.length, 1, '應呼叫 executeScript 一次');
  });

  it('注入用的 files 清單與 manifest content_scripts 載入順序一致', async () => {
    const { deps, calls } = makeDeps({
      sendMessageImpl: (attempt) => {
        if (attempt === 1) throw new Error('no receiver');
        return { active: true };
      }
    });
    await toggleWithInjectionFallback(TAB_ID, deps);

    const injectCall = calls.executeScript[0];
    assert.deepStrictEqual(injectCall, {
      target: { tabId: TAB_ID },
      files: CONTENT_SCRIPT_FILES
    });
    // 硬編檢查順序（namespace 必須最先，main 最後）
    assert.strictEqual(CONTENT_SCRIPT_FILES[0], 'content/namespace.js');
    assert.strictEqual(CONTENT_SCRIPT_FILES[CONTENT_SCRIPT_FILES.length - 1], 'content/main.js');
  });

  // 真 forcing function：popup-core 的注入清單必須與 manifest.json 完全一致
  // （順序 + 完整項目）。歷史 bug：v0.4.0 引入 toast.js 後忘記同步 popup-core，
  // 對 extension reload 前已開啟的 tab inject fallback 時漏注入 toast.js，
  // 導致 NS.toast=null、所有 toast 提示靜默失效。v0.7.19 補上並加此 spec 防呆。
  it('CONTENT_SCRIPT_FILES 必須與 manifest.json content_scripts[0].js 完全一致', () => {
    assert.deepStrictEqual(
      CONTENT_SCRIPT_FILES,
      MANIFEST_CONTENT_SCRIPT_FILES,
      'popup-core.js 的 CONTENT_SCRIPT_FILES 與 manifest.json 不一致——' +
      '新增/移除 content script 時必須同步更新兩邊，否則 inject fallback 會漏注入。'
    );
  });

  it('禁止注入頁面（兩次都失敗）：回傳 ok=false、帶 error，不拋', async () => {
    const { deps, calls } = makeDeps({
      sendMessageImpl: () => { throw new Error('no receiver'); },
      executeScriptImpl: () => { throw new Error('Cannot access a chrome:// URL'); }
    });
    const result = await toggleWithInjectionFallback(TAB_ID, deps);

    assert.strictEqual(result.ok, false);
    assert.ok(result.error, '失敗時必須帶回 error，供 caller 顯示');
    // 第一次 sendMessage 失敗 → 注入也失敗（拋） → 不會再 sendMessage
    assert.strictEqual(calls.sendMessage.length, 1);
    assert.strictEqual(calls.executeScript.length, 1);
  });
});
