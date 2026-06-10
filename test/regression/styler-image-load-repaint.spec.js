// JRead — 圖片載入撐高位移 → 殘影：flush-on-load 修法（v0.8.27）
//
// Bug：telefoncek.si「先 Shinkansen 翻譯 → 進閱讀模式」後，約 1 秒：
//   1. 標題出現「疊影」（同一標題重複/錯位）
//   2. 卡片右邊距出現白色殘框
// 兩者都不是 DOM 元素（cage 真機定位：該點 DOM 算出是 pageBg、pixel 卻是
// 白色；無覆蓋元素、無 pseudo、無溢出；強制背景重繪即消失）。
//
// 根因：文章圖無 width/height/aspect-ratio，進閱讀模式當下未載入（不佔空間）
// → 卡片偏短；約 1s 後圖陸續載入各撐高數百 px（4 張累計 ~2000px）→ 標題以下
// 內容被往下推（使用者語「撐大」）。瀏覽器對「不透明圖層位移」不一定 invalidate
// 舊位置 paint tile，殘留繪製。Blink / WebKit 共用 tile 合成、兩者皆重現。
//
// 修法：未載入的內容圖掛 load listener，載入位移後強制一次背景 re-raster
// （body 背景設 transparent 一幀再還原）清殘影；外加 1.5s / 3s 延遲 flush 兜底
// （涵蓋翻譯擴充 re-render 觸發的晚到位移）。restore 對稱移除 listener + 清 timer。
//
// 本 spec 驗「wiring」這一層（jsdom 不做 layout / GPU 合成，殘影本身只在真機
// 重現、由 cage 驗收）：apply 對未載入圖掛 load listener、建延遲 flush timer、
// snapshot 帶清理資料；restore 移除 listener + 清 timer。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'image-load-repaint.html');

const SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  // jsdom 不載圖——強制 complete=false，模擬「進閱讀模式當下圖未載入」
  const imgs = [...detected.el.querySelectorAll('img')];
  assert.ok(imgs.length >= 2, 'fixture 須有 >= 2 張內容圖');
  for (const img of imgs) {
    Object.defineProperty(img, 'complete', { value: false, configurable: true });
  }
  return { env, detected, imgs };
}

describe('styler — 圖片載入位移殘影 flush-on-load（v0.8.27）', () => {
  it('apply 對未載入內容圖掛 load listener（snapshot.flushImgCleanup 帶該圖 + onLoad）', () => {
    const { env, detected, imgs } = setup();
    const snap = env.NS.styler.apply(detected.el, SETTINGS);
    assert.ok(Array.isArray(snap.flushImgCleanup), 'snapshot 須有 flushImgCleanup 陣列');
    assert.strictEqual(snap.flushImgCleanup.length, imgs.length,
      '每張未載入內容圖都應掛 flush load listener');
    for (const entry of snap.flushImgCleanup) {
      assert.ok(imgs.includes(entry.img), 'cleanup entry 須指向 fixture 內容圖');
      assert.strictEqual(typeof entry.onLoad, 'function', 'entry 須帶 onLoad function');
    }
  });

  it('apply 建立兩個延遲 flush timer（兜底晚到位移）', () => {
    const { env, detected } = setup();
    const snap = env.NS.styler.apply(detected.el, SETTINGS);
    assert.ok(Array.isArray(snap.flushTimers), 'snapshot 須有 flushTimers 陣列');
    assert.strictEqual(snap.flushTimers.length, 2, '須有 1.5s / 3s 兩個延遲 flush timer');
  });

  it('restore 移除 flush load listener + 清延遲 flush timer', () => {
    const { env, detected, imgs } = setup();
    // spy removeEventListener
    const removed = [];
    for (const img of imgs) {
      const orig = img.removeEventListener.bind(img);
      img.removeEventListener = (type, fn, opts) => { if (type === 'load') removed.push({ img, fn }); return orig(type, fn, opts); };
    }
    // spy clearTimeout
    const cleared = [];
    const origClear = env.window.clearTimeout;
    env.window.clearTimeout = (t) => { cleared.push(t); return origClear(t); };
    // 同時也要攔全域 clearTimeout（styler restore 直接呼叫 clearTimeout）
    const globalOrigClear = global.clearTimeout;
    global.clearTimeout = (t) => { cleared.push(t); return globalOrigClear(t); };

    const snap = env.NS.styler.apply(detected.el, SETTINGS);
    const timers = snap.flushTimers.slice();
    env.NS.styler.restore(detected.el, snap);

    global.clearTimeout = globalOrigClear;
    env.window.clearTimeout = origClear;

    // 每張圖的 flush onLoad 都須被移除（圖為 <a> 包覆時亦同時移除既有
    // content-img 標記 listener，故 removed 總數 >= flush 數，不以總數斷言）
    for (const entry of snap.flushImgCleanup) {
      assert.ok(removed.some(r => r.img === entry.img && r.fn === entry.onLoad),
        'restore 須移除該圖的 flush load listener');
    }
    for (const t of timers) {
      assert.ok(cleared.includes(t), 'restore 須 clearTimeout 每個延遲 flush timer');
    }
  });
});
