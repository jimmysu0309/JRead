// JRead — GET_SETTINGS fallback 回應憑證欄位裁剪 regression spec（v1.6.26）
//
// 背景（v1.6.24 review 遺留 #7，Jimmy 2026-07-09 指示修）：SW 的 GET_SETTINGS
// 是 content script 直讀 storage 失效時的 fallback 通道，舊版把 storage.sync
// 整包（含 readwiseToken / instapaper 憑證 / geminiApiKey）回傳給 content——
// content 端從不使用任何憑證（grep 實證零呼叫端），敏感資料流經用不到的路徑。
// isolated world 下頁面 JS 摸不到（非漏洞修補），純最小知情 hardening。
//
// 修法：settings-defaults.js 新增 CREDENTIAL_SETTINGS_KEYS 清單 +
// stripCredentialSettings 純函式（單一資料源），SW GET_SETTINGS 回應前裁剪。
//
// 訊號層次（驗 X、不驗 Y）：
//   驗：純函式行為（裁剪正確、非憑證欄位保留、null/非物件直通）+ 憑證清單
//       與 DEFAULT_SETTINGS 同步 + SW handler 有呼叫（靜態 forcing）。
//   不驗：SW runtime 訊息往返（jsdom 無 SW；行為由 harness / 實機覆蓋）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..', 'jread');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'background', 'service-worker.js'), 'utf8');

// settings-defaults 掛 globalThis（module.exports 契約固定 === DEFAULT_SETTINGS）
const DEFAULT_SETTINGS = require(path.join(ROOT, 'content', 'settings-defaults.js'));
const CREDENTIAL_KEYS = globalThis.__JReadCredentialSettingsKeys;
const strip = globalThis.__JReadStripCredentialSettings;

describe('GET_SETTINGS 憑證欄位裁剪（v1.6.26）', () => {
  it('settings-defaults 必須 export 清單與純函式', () => {
    assert.ok(Array.isArray(CREDENTIAL_KEYS) && CREDENTIAL_KEYS.length > 0);
    assert.strictEqual(typeof strip, 'function');
  });

  it('憑證清單的每個 key 都必須存在於 DEFAULT_SETTINGS（防拼錯 / 欄位改名後清單失效）', () => {
    for (const k of CREDENTIAL_KEYS) {
      assert.ok(Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k),
        `CREDENTIAL_SETTINGS_KEYS 含 DEFAULT_SETTINGS 沒有的 key：${k}`);
    }
  });

  it('已知憑證欄位必須全部在清單內（新增憑證欄位漏列會 fail）', () => {
    // 判準：DEFAULT_SETTINGS 中 key 命中 token / apikey / secret / username
    // 命名慣例者皆屬憑證。新增憑證欄位若沒同步進清單，本條擋下。
    const credLike = Object.keys(DEFAULT_SETTINGS).filter((k) =>
      /token|apikey|secret|username/i.test(k));
    for (const k of credLike) {
      assert.ok(CREDENTIAL_KEYS.includes(k),
        `疑似憑證欄位 ${k} 不在 CREDENTIAL_SETTINGS_KEYS 清單內`);
    }
  });

  it('stripCredentialSettings：剔除憑證、保留其他欄位、不動原物件', () => {
    const input = { theme: 'dark', fontSize: 18, readwiseToken: 'tok',
      instapaperToken: 'it', instapaperTokenSecret: 'its',
      instapaperUsername: 'user@example.com', geminiApiKey: 'gk' };
    const out = strip(input);
    assert.deepStrictEqual(out, { theme: 'dark', fontSize: 18 });
    assert.strictEqual(input.readwiseToken, 'tok', '不可 mutate 原物件');
  });

  it('stripCredentialSettings：null / undefined / 非物件直通（fallback 降級語意不變）', () => {
    assert.strictEqual(strip(null), null);
    assert.strictEqual(strip(undefined), undefined);
    assert.strictEqual(strip('x'), 'x');
  });

  it('SW GET_SETTINGS handler 必須經過 stripCredentialSettings（靜態 forcing）', () => {
    const s = SW_SRC.indexOf("case 'GET_SETTINGS'");
    assert.ok(s >= 0);
    const e = SW_SRC.indexOf('case ', s + 10);
    const body = SW_SRC.slice(s, e);
    assert.match(body, /__JReadStripCredentialSettings/,
      'GET_SETTINGS 回應前必須裁剪憑證欄位');
    assert.ok(!/\.then\(sendResponse\)/.test(body),
      '不可回到整包直傳 sendResponse 的舊寫法');
  });
});
