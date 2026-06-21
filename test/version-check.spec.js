// JRead — 版本號 forcing function
// 此常數是刻意設計的強制同步點：每次 bump 版本號必須同步改這裡，否則此測試 fail。
// 連動清單見 CLAUDE.md 硬規則 1。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const EXPECTED_VERSION = '0.8.148';

describe('version-check', () => {
  it('manifest.json 的 version 必須等於 EXPECTED_VERSION', () => {
    const manifestPath = path.join(__dirname, '..', 'jread', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(
      manifest.version,
      EXPECTED_VERSION,
      `manifest.json version (${manifest.version}) 與 EXPECTED_VERSION (${EXPECTED_VERSION}) 不一致——bump 版本號時請同步更新兩邊`
    );
  });

  it('version 必須是三段式 x.y.z（避免 Chrome 前導零被吃掉）', () => {
    assert.match(
      EXPECTED_VERSION,
      /^\d+\.\d+\.\d+$/,
      `EXPECTED_VERSION (${EXPECTED_VERSION}) 必須是三段式數字，如 1.0.0`
    );
  });

  it('SPEC.md 的目前 Extension 版本段落必須包含 EXPECTED_VERSION', () => {
    const specPath = path.join(__dirname, '..', 'SPEC.md');
    const spec = fs.readFileSync(specPath, 'utf8');
    assert.ok(
      spec.includes(EXPECTED_VERSION),
      `SPEC.md 找不到字串 "${EXPECTED_VERSION}"——bump 版本號時請同步更新 SPEC.md 的「目前 Extension 版本」段落`
    );
  });

  it('CHANGELOG.md 頂部必須有 EXPECTED_VERSION 條目', () => {
    const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
    const changelog = fs.readFileSync(changelogPath, 'utf8');
    assert.ok(
      changelog.includes(`v${EXPECTED_VERSION}`),
      `CHANGELOG.md 找不到 "v${EXPECTED_VERSION}" 條目——bump 版本號時請在 CHANGELOG.md 頂部新增對應條目`
    );
  });

  it('package.json 的 version 必須等於 EXPECTED_VERSION', () => {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.strictEqual(
      pkg.version,
      EXPECTED_VERSION,
      `package.json version (${pkg.version}) 與 EXPECTED_VERSION (${EXPECTED_VERSION}) 不一致——bump 版本號時請同步更新`
    );
  });

  // v0.7.89：manifest commands 必須含 send-to-readwise（快速鍵送 Readwise Reader）
  it('manifest.json commands 必須含 send-to-readwise（v0.7.89 快速鍵）', () => {
    const manifestPath = path.join(__dirname, '..', 'jread', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(manifest.commands, 'manifest 必須有 commands 區塊');
    assert.ok(manifest.commands['toggle-reader-mode'],
      'manifest 必須有 toggle-reader-mode command（Alt+R 切換閱讀模式，v0.8.31 起）');
    assert.ok(manifest.commands['send-to-readwise'],
      'manifest 必須有 send-to-readwise command（v0.7.89 新增送 Readwise 快速鍵）');
    const cmd = manifest.commands['send-to-readwise'];
    assert.ok(cmd.suggested_key && cmd.suggested_key.default,
      'send-to-readwise 必須有 suggested_key.default');
    assert.ok(cmd.description && cmd.description.length > 0,
      'send-to-readwise 必須有 description（給 chrome://extensions/shortcuts 顯示）');
  });

  it('namespace.js 必須 export MSG.SHOW_TOAST 常數（SW 透過此訊息給 content script 顯示 toast）', () => {
    const nsPath = path.join(__dirname, '..', 'jread', 'content', 'namespace.js');
    const src = fs.readFileSync(nsPath, 'utf8');
    assert.ok(/SHOW_TOAST:\s*['"]SHOW_TOAST['"]/.test(src),
      'namespace.js MSG 必須含 SHOW_TOAST 常數（SW 快速鍵流程結束後透過此訊息顯示結果 toast）');
  });
});
