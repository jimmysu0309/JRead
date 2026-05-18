// JRead — Firefox build forcing function
// 驗 tools/firefox-build.sh 產出的 manifest 結構符合 AMO + Firefox MV3 要求。
//
// 為什麼端到端跑真 script：jq filter 是 build 的單一 transform，最有效驗證就是
// 跑一次拿到 zip 看 manifest——換 jq 寫法 / 改 scripts 順序 / 漏掉 gecko 欄位
// 都能被這條 spec 抓到。

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'tools', 'firefox-build.sh');

describe('firefox-build.sh', function () {
  this.timeout(30000);

  let version;
  let zipPath;
  let manifest;

  before(function () {
    // 若機器沒 jq，跳過整組（Mozilla AMO reviewer 環境一定有 jq；本機驗才需要）。
    try {
      execSync('which jq', { stdio: 'ignore' });
    } catch (e) {
      this.skip();
      return;
    }

    version = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'jread', 'manifest.json'), 'utf8')
    ).version;
    zipPath = path.join(REPO_ROOT, `jread-firefox-v${version}.zip`);

    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    execSync(`bash "${SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' });

    const out = execSync(`unzip -p "${zipPath}" manifest.json`).toString();
    manifest = JSON.parse(out);
  });

  after(function () {
    if (zipPath && fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  });

  it('產出 jread-firefox-v<version>.zip', () => {
    assert.ok(fs.existsSync(zipPath), `zip 不存在：${zipPath}`);
  });

  it('Firefox manifest 不可含 service_worker（Firefox MV3 不支援）', () => {
    assert.strictEqual(
      manifest.background.service_worker,
      undefined,
      'Firefox manifest 仍有 service_worker——load 進 Firefox 會 fail'
    );
  });

  it('Firefox manifest 用 background.scripts，順序為 popup-core 先', () => {
    assert.deepStrictEqual(
      manifest.background.scripts,
      ['popup/popup-core.js', 'background/service-worker.js'],
      'scripts 順序錯：popup-core 必須先 load，service-worker 才看得到全域變數'
    );
  });

  it('Firefox manifest 含 gecko.id（AMO 鎖死的 extension ID）', () => {
    assert.strictEqual(
      manifest.browser_specific_settings.gecko.id,
      'jread@jimmy.zm.su',
      'gecko.id 必須是 jread@jimmy.zm.su（已對應 AMO 上架的 ID，不可改）'
    );
  });

  it('Firefox manifest 含 strict_min_version 128.0', () => {
    assert.strictEqual(
      manifest.browser_specific_settings.gecko.strict_min_version,
      '128.0'
    );
  });

  it('Firefox manifest 含 data_collection_permissions { required: ["none"] }', () => {
    assert.deepStrictEqual(
      manifest.browser_specific_settings.gecko.data_collection_permissions,
      { required: ['none'] },
      'Mozilla 2025 隱私 consent UI 需要這個欄位——JRead 不收集任何使用者資料'
    );
  });

  it('Firefox manifest version 與 jread/manifest.json 同步', () => {
    assert.strictEqual(manifest.version, version);
  });

  it('其餘檔案 byte-for-byte 一致（service-worker.js）', () => {
    const orig = fs.readFileSync(
      path.join(REPO_ROOT, 'jread', 'background', 'service-worker.js')
    );
    const zipped = execSync(
      `unzip -p "${zipPath}" background/service-worker.js`
    );
    assert.ok(
      orig.equals(zipped),
      'service-worker.js 不一致——Firefox build 應該只動 manifest，其他檔不可改'
    );
  });

  it('其餘檔案 byte-for-byte 一致（popup-core.js）', () => {
    const orig = fs.readFileSync(
      path.join(REPO_ROOT, 'jread', 'popup', 'popup-core.js')
    );
    const zipped = execSync(`unzip -p "${zipPath}" popup/popup-core.js`);
    assert.ok(orig.equals(zipped));
  });
});

describe('Chrome manifest（jread/manifest.json）— Firefox build 前置條件', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'jread', 'manifest.json'), 'utf8')
  );

  it('Chrome manifest 用 service_worker（Firefox build 會改寫）', () => {
    assert.strictEqual(
      manifest.background.service_worker,
      'background/service-worker.js'
    );
    assert.strictEqual(manifest.background.scripts, undefined);
  });

  it('Chrome manifest 已含 gecko.id（Chrome 會 ignore；Firefox build 直接沿用）', () => {
    assert.strictEqual(
      manifest.browser_specific_settings.gecko.id,
      'jread@jimmy.zm.su'
    );
  });

  it('service-worker.js 的 importScripts 必須有 typeof guard（Firefox event page 沒有 importScripts）', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'jread', 'background', 'service-worker.js'),
      'utf8'
    );
    assert.match(
      src,
      /typeof\s+importScripts\s*===\s*['"]function['"]/,
      'importScripts call 必須包 typeof guard，否則 Firefox event page 會 ReferenceError'
    );
  });
});
