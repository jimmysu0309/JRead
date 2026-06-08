// JRead — iOS host app 圖示解析度 forcing function（v0.8.0）
//
// 背景：iOS 單一 binary 也涵蓋「在 Apple Silicon Mac 以 iPad App 執行」，Mac 是
// 2x 顯示、所有現代 iPhone/iPad 是 2x/3x。若 imageset 只放 1x、HTML <img> 只放
// 1x 檔，系統只能把低解圖放大 → 啟動畫面 / host app 圖示糊。
//
// 這條驗「資產解析度齊備」這一層：
//   - LargeIcon.imageset（LaunchScreen 用，顯示 128pt）的 1x/2x/3x 三槽都要有
//     filename、且實檔像素 = 128 / 256 / 384
//   - Resources/Icon.png（Main.html <img width=128> 用）至少 256px（Retina 2x 銳利）
// 不驗「視覺設計正確」（那要肉眼 / Claude Design）——本層只擋「解析度缺漏」回歸。
//
// sanity：把 Contents.json 的 2x filename 拿掉 → fail；還原 → pass。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ASSETS_DIR = path.join(
  REPO_ROOT, 'safari-app', 'JRead-iOS', 'JRead', 'Assets.xcassets'
);
const LARGE_ICON_DIR = path.join(ASSETS_DIR, 'LargeIcon.imageset');
const ICON_PNG = path.join(
  REPO_ROOT, 'safari-app', 'JRead-iOS', 'JRead', 'Resources', 'Icon.png'
);

// 純 node 讀 PNG IHDR：width @offset16、height @offset20（big-endian uint32）
function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.strictEqual(buf.toString('ascii', 1, 4), 'PNG', `${file} 不是合法 PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('iOS LargeIcon.imageset 解析度（LaunchScreen 128pt）', () => {
  const contents = JSON.parse(
    fs.readFileSync(path.join(LARGE_ICON_DIR, 'Contents.json'), 'utf8')
  );
  const byScale = {};
  for (const img of contents.images) byScale[img.scale] = img;

  // 顯示 128pt → 1x=128 / 2x=256 / 3x=384
  const EXPECTED = { '1x': 128, '2x': 256, '3x': 384 };

  for (const scale of Object.keys(EXPECTED)) {
    it(`${scale} 槽必須有 filename 且實檔為 ${EXPECTED[scale]}px`, () => {
      const slot = byScale[scale];
      assert.ok(slot, `Contents.json 缺 ${scale} 槽`);
      assert.ok(
        slot.filename,
        `LargeIcon ${scale} 槽沒有 filename——Mac/Retina 會拿低解圖放大、圖示糊`
      );
      const file = path.join(LARGE_ICON_DIR, slot.filename);
      assert.ok(fs.existsSync(file), `${slot.filename} 不存在`);
      const { width, height } = pngSize(file);
      assert.strictEqual(width, EXPECTED[scale], `${slot.filename} 寬應為 ${EXPECTED[scale]}px`);
      assert.strictEqual(height, EXPECTED[scale], `${slot.filename} 高應為 ${EXPECTED[scale]}px`);
    });
  }
});

describe('iOS host app Main.html 圖示（Resources/Icon.png）', () => {
  it('至少 256px（顯示 128pt → Retina/Mac 2x 銳利）', () => {
    assert.ok(fs.existsSync(ICON_PNG), 'Resources/Icon.png 不存在');
    const { width, height } = pngSize(ICON_PNG);
    assert.ok(
      width >= 256 && height >= 256,
      `Icon.png 為 ${width}x${height}，Main.html 以 128pt 顯示需至少 256px 才在 Retina/Mac 不糊`
    );
  });
});
