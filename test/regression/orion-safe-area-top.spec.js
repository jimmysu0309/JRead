// JRead — regression spec: Orion（Kagi）edge-to-edge top safe-area 補償（v1.5.18）
//
// Jimmy 2026-06-30 實機回報：在 iOS Orion 瀏覽器下，閱讀模式內容（標題）被 Dynamic
// Island 蓋住，捲動與翻頁兩模式都會。實機探針（docs/orion-probe）證實：
//   - UA 死：Orion 把 navigator.userAgent 完全偽裝成 Safari，無 "Orion" 字樣。
//   - env() 死：Orion 不回報 env(safe-area-inset-*)，四向全 0、即使 viewport-fit=cover。
//   - 唯一乾淨指紋：頁面 main world 的 window.kagi / window.KAGI / __kagi_native_*。
//
// 修法：content/orion-detect.js（manifest world:MAIN）在頁面 world 讀 window.kagi →
// 替 <html> 蓋 .jread-orion + 設 --jread-orion-top（依 screen.height 分檔）；styler 注入
// .jread-orion gated CSS（捲動補 body padding-top、翻頁下推 fixed 卡片 top）。
//
// 訊號層次：本 spec 驗（1）orion-detect.js 偵測 + 蓋 class 的行為、（2）styler 注入
// .jread-orion gated 規則、（3）manifest 宣告 world:MAIN 偵測 script。不驗：Orion 真實
// 視覺（只能實機驗）、world:MAIN 在 Orion 是否被支援（實機驗）。

const path = require('path');
const assert = require('assert');
const vm = require('vm');
const { readFileSync } = require('fs');
const { JREAD_DIR } = require('../helpers');

const DETECT_SRC = readFileSync(path.join(JREAD_DIR, 'content', 'orion-detect.js'), 'utf8');
const STYLER_SRC = readFileSync(path.join(JREAD_DIR, 'content', 'styler.js'), 'utf8');
const MANIFEST = JSON.parse(readFileSync(path.join(JREAD_DIR, 'manifest.json'), 'utf8'));

// 在受控 fake 頁面 world 跑 orion-detect.js IIFE，回傳被改動的 documentElement stub。
function runDetect({ kagi = false, screenHeight = 956 } = {}) {
  const classes = new Set();
  const props = {};
  const de = {
    classList: { add: (c) => classes.add(c) },
    style: { setProperty: (k, v) => { props[k] = v; } },
  };
  const sandbox = {
    window: {
      screen: { height: screenHeight },
      addEventListener: () => {},
    },
    document: {
      documentElement: de,
      addEventListener: () => {},
    },
  };
  if (kagi) sandbox.window.kagi = {};
  // window 自我參照（orion-detect 讀 window.kagi 等）
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(DETECT_SRC, sandbox);
  return { classes, props };
}

describe('Orion edge-to-edge top safe-area 補償（v1.5.18）', () => {
  it('orion-detect：偵測到 window.kagi → <html> 蓋 .jread-orion', () => {
    const { classes } = runDetect({ kagi: true });
    assert.ok(classes.has('jread-orion'), '有 window.kagi 時應蓋 .jread-orion');
  });

  it('orion-detect：非 Orion（無 kagi）→ 不蓋 class（Safari 零回歸）', () => {
    const { classes, props } = runDetect({ kagi: false });
    assert.ok(!classes.has('jread-orion'), '無 Orion 指紋時不可蓋 .jread-orion');
    assert.strictEqual(props['--jread-orion-top'], undefined, '非 Orion 不應設 --jread-orion-top');
  });

  it('orion-detect：長螢幕（島/瀏海，screen.height>=812）→ inset 59px', () => {
    const { props } = runDetect({ kagi: true, screenHeight: 956 });
    assert.strictEqual(props['--jread-orion-top'], '59px');
  });

  it('orion-detect：矮螢幕（home button，screen.height<812）→ inset 20px', () => {
    const { props } = runDetect({ kagi: true, screenHeight: 667 });
    assert.strictEqual(props['--jread-orion-top'], '20px');
  });

  it('styler：注入 .jread-orion gated 規則並引用 --jread-orion-top', () => {
    assert.ok(/\.jread-orion/.test(STYLER_SRC), 'styler 必須含 .jread-orion gating');
    assert.ok(/--jread-orion-top/.test(STYLER_SRC), 'styler 必須引用 --jread-orion-top 變數');
    // 捲動模式：body padding-top
    assert.ok(/html\.\$\{HTML_CLASS\}\.jread-orion body/.test(STYLER_SRC),
      '捲動模式須對 .jread-orion body 補 padding-top');
    // 翻頁模式：fixed 卡片 top 下推
    assert.ok(/html\.\$\{HTML_CLASS\}\.jread-orion \[\$\{ARTICLE_ATTR\}="1"\]/.test(STYLER_SRC),
      '翻頁模式須對 .jread-orion 卡片下推 top');
  });

  it('manifest：宣告 world:MAIN 的 orion-detect 偵測 script（document_start）', () => {
    const entries = MANIFEST.content_scripts || [];
    const mainWorld = entries.find((e) => e.world === 'MAIN');
    assert.ok(mainWorld, 'manifest 須有一個 world:MAIN content_scripts entry');
    assert.ok((mainWorld.js || []).includes('content/orion-detect.js'),
      'world:MAIN entry 須載入 content/orion-detect.js');
    assert.strictEqual(mainWorld.run_at, 'document_start',
      'orion-detect 須 run_at document_start（早於頁面初始化蓋 class）');
  });
});
