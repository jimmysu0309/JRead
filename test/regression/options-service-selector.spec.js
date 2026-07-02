// JRead — options 儲存服務二擇一（v1.6.0）
// options.html / options.js 的「儲存服務整合」段：服務選擇器 + Readwise / Instapaper
// 憑證區二擇一顯示 + Instapaper 連結 / 解除 + reset 保留憑證。options.js 相依大量
// 瀏覽器 / DOM 全域、不易 jsdom 全載，故以 source-level forcing 斷言關鍵接線在位。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'jread', 'options', 'options.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'jread', 'options', 'options.js'), 'utf8');
const DEFAULTS = require(path.join(ROOT, 'jread', 'content', 'settings-defaults.js'));

describe('options-service-selector: settings-defaults 新增欄位', () => {
  it('storageService 預設 readwise、instapaper 三憑證預設空字串', () => {
    assert.strictEqual(DEFAULTS.storageService, 'readwise');
    assert.strictEqual(DEFAULTS.instapaperToken, '');
    assert.strictEqual(DEFAULTS.instapaperTokenSecret, '');
    assert.strictEqual(DEFAULTS.instapaperUsername, '');
  });
});

describe('options-service-selector: options.html 結構', () => {
  it('有 storageService 選擇器，含 readwise / instapaper 兩選項', () => {
    assert.match(HTML, /<select\s+id=["']storageService["']/);
    assert.match(HTML, /value=["']readwise["']/);
    assert.match(HTML, /value=["']instapaper["']/);
  });
  it('Readwise / Instapaper 憑證區各有 data-service-block 標記（二擇一顯示）', () => {
    assert.match(HTML, /data-service-block=["']readwise["']/);
    assert.match(HTML, /data-service-block=["']instapaper["']/);
  });
  it('Instapaper 連結表單有 email / password / 連結 / 解除連結 / 已連結顯示', () => {
    assert.match(HTML, /id=["']instapaper-email["']/);
    assert.match(HTML, /id=["']instapaper-password["']/);
    assert.match(HTML, /id=["']instapaper-connect["']/);
    assert.match(HTML, /id=["']instapaper-unlink["']/);
    assert.match(HTML, /id=["']instapaper-linked["']/);
    assert.match(HTML, /id=["']instapaper-no-keys["']/);
  });
  it('須在 popup-core 之前載入 lib/instapaper(-keys).js', () => {
    const keysIdx = HTML.indexOf('lib/instapaper-keys.js');
    const libIdx = HTML.indexOf('lib/instapaper.js');
    const coreIdx = HTML.indexOf('popup/popup-core.js');
    assert.ok(keysIdx > -1 && libIdx > -1 && coreIdx > -1, '三個 script 都要在');
    assert.ok(libIdx < coreIdx, 'instapaper.js 須在 popup-core.js 之前');
  });
});

describe('options-service-selector: options.js 接線', () => {
  it('storageService 進 fields（自動 change 存檔 + onChanged 同步）', () => {
    assert.match(JS, /const fields = \[[^\]]*'storageService'/);
  });
  it('有 updateServiceVisibility + renderInstapaperLinkState', () => {
    assert.match(JS, /function updateServiceVisibility/);
    assert.match(JS, /function renderInstapaperLinkState/);
  });
  it('連結走 instapaperXAuth，成功存 token/secret/username、密碼清空', () => {
    assert.match(JS, /instapaperXAuth/);
    assert.match(JS, /instapaperToken:\s*r\.token/);
    assert.match(JS, /instapaperTokenSecret:\s*r\.tokenSecret/);
    assert.match(JS, /instapaper-password['"]\)\.value\s*=\s*['"]/, '連結成功後密碼清空');
  });
  it('reset 保留 Instapaper 憑證（不洗掉連結）', () => {
    assert.match(JS, /delete payload\.instapaperToken/);
    assert.match(JS, /delete payload\.instapaperTokenSecret/);
    assert.match(JS, /delete payload\.instapaperUsername/);
  });
  it('load 時渲染連結狀態 + 顯隱', () => {
    assert.match(JS, /renderInstapaperLinkState\(values\.instapaperUsername\)/);
    assert.match(JS, /updateServiceVisibility\(\)/);
  });
});
