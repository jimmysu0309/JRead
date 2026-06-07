// JRead — regression spec: 翻頁模式（v0.7.227）
//
// 功能：電子書式水平翻頁。styler 在 settings.pagedMode === true 時注入
// multi-column overflow columns CSS（column-width: 版心寬 + column-fill: auto
// + fixed 滿版容器），paged-mode.js 負責手勢 / 鍵盤 / 滾輪翻頁 + 頁碼指示。
//
// v0.7.230：「一頁一欄」改用 column-width 表達——WebKit 對 column-count: 1
// 不建 multicol fragmentation context（scrollWidth == clientWidth、scrollLeft
// 永遠 0、翻頁全滅；真機 Safari probe 實證），本 spec 把「不得含
// column-count: 1」設為 forcing function。
//
// 訊號層次（本 spec 驗 X、不驗 Y）：
//   驗：CSS 字串注入條件與內容、純邏輯（swipe / 鍵盤分類、頁數計算）、
//       模組 install/uninstall DOM 副作用、跨檔字面值同步、main.js wiring
//       的結構性順序。
//   不驗：真實瀏覽器的 column fragmentation / scrollLeft 行為（jsdom 無
//       layout）——那層由 Playwright harness 驗（probe 實測 chinatalk 43 頁
//       / udn 4 頁 stride 恆等式零偏移）；iOS 實機的網址列收合 / 邊緣手勢
//       讓位只能 Jimmy 實機驗。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, JREAD_DIR } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'paged-mode.html');
const pagedApi = require(path.join(JREAD_DIR, 'content', 'paged-mode.js'));

const PAGED_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'paged-mode.js'), 'utf8');
const STYLER_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'styler.js'), 'utf8');
const MAIN_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'main.js'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(JREAD_DIR, 'background', 'service-worker.js'), 'utf8');
const POPUP_SRC = fs.readFileSync(path.join(JREAD_DIR, 'popup', 'popup.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(JREAD_DIR, 'popup', 'popup.html'), 'utf8');

const BASE_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function applyAndGetCss(settings) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['styler']
  });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 須含 <article>');
  env.NS.styler.apply(articleEl, settings);
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl, 'styler 必須注入 __jread-style');
  return styleEl.textContent;
}

describe('翻頁模式（v0.7.227）', () => {

  // ---- A. styler CSS 注入條件 ------------------------------------------
  describe('styler pagedMode CSS', () => {
    it('pagedMode: true → 注入 column-width: 版心寬 + column-fill: auto 翻頁區塊', () => {
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      // 「一頁一欄」必須用 column-width（= settings.contentWidth）表達
      assert.ok(css.includes(`column-width: ${BASE_SETTINGS.contentWidth}px !important`),
        '須含 column-width: <contentWidth>px');
      assert.ok(css.includes('column-count: auto !important'),
        '須含 column-count: auto（壓掉原站可能的 column-count 規則）');
      assert.ok(css.includes('column-fill: auto !important'), '須含 column-fill: auto');
      // forcing function：WebKit 對 column-count: 1 不建 fragmentation
      // context（翻頁全滅），任何人改回 count=1 必須在這裡 fail
      assert.ok(!css.includes('column-count: 1'),
        '不得含 column-count: 1（WebKit 翻頁全滅 bug，v0.7.230）');
      // fixed 滿版容器（top/bottom 錨定，不用 vh）
      const ruleMatch = css.match(/html \[data-jread-active="1"\]\s*\{[^}]*position:\s*fixed\s*!important/);
      assert.ok(ruleMatch, '翻頁容器規則須將 reader card 設 position: fixed');
    });

    it('pagedMode: true → 右內距用 transparent border、padding-right 必須為 0（WebKit 尾端 padding 缺陷，v0.7.231）', () => {
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      // forcing function：WebKit（Safari 26.5 真機實證）multicol scrollable
      // overflow 不含尾端 inline-end padding——padding-right > 0 會讓最後一頁
      // scrollLeft 被 clamp 短 56px、整頁右移錯位。右視覺內距必須用
      // transparent border 表達（border 不參與 scrollable overflow）。
      const ruleMatch = css.match(/html \[data-jread-active="1"\]\s*\{[^}]*column-width[^}]*\}/s);
      assert.ok(ruleMatch, '須有翻頁容器規則');
      const rule = ruleMatch[0];
      assert.ok(rule.includes('border-right: min(56px, 6vw) solid transparent !important'),
        '右內距必須用 transparent border-right（scrollable overflow 不含 border）');
      // padding 簡寫的 right 槽位必須是 0（4 值簡寫第二值）
      assert.ok(/padding:\s*min\(48px, 6vw\) 0 min\(48px, 6vw\) min\(56px, 6vw\) !important/.test(rule),
        '翻頁容器 padding-right 必須為 0（WebKit 不把尾端 padding 算進 scrollable overflow）');
    });

    it('pagedMode: true → 文件鎖卷動 + overscroll-behavior 防歷史手勢', () => {
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      assert.ok(css.includes('overscroll-behavior: none !important'),
        '須含 overscroll-behavior: none（macOS 觸控板水平 swipe 歷史導航防護）');
    });

    it('pagedMode: true → 媒體單頁化（max-height dvh + break-inside: avoid）', () => {
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      assert.ok(/img[^{]*\{[^}]*max-height:\s*calc\(100dvh/s.test(css) ||
                css.includes('max-height: calc(100dvh'),
        'img 須有 100dvh 基準的 max-height cap');
      assert.ok(css.includes('break-inside: avoid'), '媒體須 break-inside: avoid 防跨頁切割');
      assert.ok(css.includes('object-fit: contain'), '超尺寸圖片須等比縮放');
    });

    it('pagedMode: true → 頁碼指示 #__jread-page-indicator 樣式', () => {
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      assert.ok(css.includes('#__jread-page-indicator'), '須含頁碼指示樣式');
    });

    it('pagedMode 未設定（預設）→ 翻頁 CSS 一行都不注入（垂直模式零改動）', () => {
      const css = applyAndGetCss(BASE_SETTINGS);
      assert.ok(!css.includes('column-fill'), '預設不得含翻頁 column 規則');
      assert.ok(!css.includes('__jread-page-indicator'), '預設不得含頁碼指示樣式');
    });

    it('pagedMode 非 boolean true（字串 "true" / 1）→ 不注入（嚴格 === true）', () => {
      for (const bad of ['true', 1, {}]) {
        const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: bad });
        assert.ok(!css.includes('column-fill'),
          `pagedMode = ${JSON.stringify(bad)} 不得注入翻頁規則`);
      }
    });
  });

  // ---- B. 純邏輯 ---------------------------------------------------------
  describe('computePageCount', () => {
    it('stride 恆等式：probe 實測值 16899 / 393 = 43 頁', () => {
      assert.strictEqual(pagedApi.computePageCount(16899, 393), 43);
    });
    it('單頁內容 = 1 頁', () => {
      assert.strictEqual(pagedApi.computePageCount(393, 393), 1);
    });
    it('退化輸入（0 / 負值 / NaN）回 1', () => {
      assert.strictEqual(pagedApi.computePageCount(0, 0), 1);
      assert.strictEqual(pagedApi.computePageCount(-5, 393), 1);
      assert.strictEqual(pagedApi.computePageCount(NaN, NaN), 1);
    });
  });

  describe('computePageCountFromExtent（v0.7.231 頁數主路徑）', () => {
    // 正式版 Safari 26.5 chinatalk 實測值：內容末端 20744（25 欄）、padL 56、
    // stride 832——scrollWidth 公式會因幽靈欄多算成 26 頁，extent 公式必須回 25
    it('Safari 幽靈欄場景：內容末端 20744 / padL 56 / stride 832 = 25 頁（scrollWidth 公式誤報 26）', () => {
      assert.strictEqual(pagedApi.computePageCountFromExtent(20744, 56, 832), 25);
      // 對照：同場景 Safari scrollWidth = 21576 → 舊公式多算一頁
      assert.strictEqual(pagedApi.computePageCount(21576, 832), 26);
    });
    it('Chromium 場景：內容末端 19912 / padL 56 / stride 832 = 24 頁（與 scrollWidth 公式一致）', () => {
      assert.strictEqual(pagedApi.computePageCountFromExtent(19912, 56, 832), 24);
    });
    it('內容末端恰落欄界（k×stride + padL）不多算幽靈頁', () => {
      assert.strictEqual(pagedApi.computePageCountFromExtent(56 + 3 * 832, 56, 832), 3);
    });
    it('單頁短文 = 1 頁', () => {
      assert.strictEqual(pagedApi.computePageCountFromExtent(500, 56, 832), 1);
    });
    it('退化輸入（0 / 負 / NaN）回 1', () => {
      assert.strictEqual(pagedApi.computePageCountFromExtent(0, 56, 832), 1);
      assert.strictEqual(pagedApi.computePageCountFromExtent(-10, 0, 832), 1);
      assert.strictEqual(pagedApi.computePageCountFromExtent(NaN, NaN, NaN), 1);
    });
  });

  describe('classifySwipe', () => {
    const W = 393; // iPhone 視窗寬
    it('往左滑（dx 負）= next', () => {
      assert.strictEqual(
        pagedApi.classifySwipe({ dx: -80, dy: 5, startX: 200, viewportW: W }), 'next');
    });
    it('往右滑（dx 正）= prev', () => {
      assert.strictEqual(
        pagedApi.classifySwipe({ dx: 80, dy: -3, startX: 200, viewportW: W }), 'prev');
    });
    it('位移不足門檻 → null', () => {
      assert.strictEqual(
        pagedApi.classifySwipe({ dx: -30, dy: 0, startX: 200, viewportW: W }), null);
    });
    it('垂直支配（|dy| 過大）→ null（避免斜向卷動誤判）', () => {
      assert.strictEqual(
        pagedApi.classifySwipe({ dx: -60, dy: 70, startX: 200, viewportW: W }), null);
    });
    it('左邊緣起手 → null（讓位 iOS Safari 歷史手勢）', () => {
      assert.strictEqual(
        pagedApi.classifySwipe({ dx: 100, dy: 0, startX: 10, viewportW: W }), null);
    });
    it('右邊緣起手 → null', () => {
      assert.strictEqual(
        pagedApi.classifySwipe({ dx: -100, dy: 0, startX: W - 10, viewportW: W }), null);
    });
  });

  describe('classifyKey', () => {
    const k = (key, mods) => pagedApi.classifyKey({ key, ...(mods || {}) });
    it('→ / PageDown / Space = next', () => {
      assert.strictEqual(k('ArrowRight'), 'next');
      assert.strictEqual(k('PageDown'), 'next');
      assert.strictEqual(k(' '), 'next');
    });
    it('← / PageUp / Shift+Space = prev', () => {
      assert.strictEqual(k('ArrowLeft'), 'prev');
      assert.strictEqual(k('PageUp'), 'prev');
      assert.strictEqual(k(' ', { shiftKey: true }), 'prev');
    });
    it('Home / End = first / last', () => {
      assert.strictEqual(k('Home'), 'first');
      assert.strictEqual(k('End'), 'last');
    });
    it('帶 ctrl / meta / alt 修飾 → null（不搶瀏覽器組合鍵）', () => {
      assert.strictEqual(k('ArrowRight', { metaKey: true }), null);
      assert.strictEqual(k(' ', { ctrlKey: true }), null);
      assert.strictEqual(k('ArrowLeft', { altKey: true }), null);
    });
    it('其他鍵 → null', () => {
      assert.strictEqual(k('a'), null);
      assert.strictEqual(k('Escape'), null);
    });
  });

  // ---- C. 模組 install / uninstall DOM 副作用 ----------------------------
  describe('模組 sync / install / uninstall（jsdom）', () => {
    function loadModuleEnv() {
      const env = loadFixtureWithScripts({
        fixturePath: FIXTURE_PATH,
        scripts: [],
        pretendToBeVisual: true // rAF
      });
      env.window.eval(PAGED_SRC);
      return env;
    }

    it('sync(pagedMode: true, articleEl) → installed + 頁碼指示元素出現', () => {
      const env = loadModuleEnv();
      const api = env.window.__JRead.pagedMode;
      assert.ok(api, 'paged-mode.js 須掛上 NS.pagedMode');
      const art = env.document.querySelector('article');
      api.sync({ pagedMode: true }, art);
      assert.strictEqual(api.isInstalled(), true);
      const ind = env.document.getElementById('__jread-page-indicator');
      assert.ok(ind, 'install 後頁碼指示元素必須存在');
      // 指示器必須掛 <html> 下、不可掛 body——body 帶 data-jread-ancestor，
      // styler 的 sibling 隱藏規則會把 body 下非主文子元素全 display:none，
      // 指示器會被隱藏（udn 真實站 probe 實證 rect 0×0）。
      assert.strictEqual(ind.parentElement, env.document.documentElement,
        '頁碼指示必須是 <html> 的 direct child（掛 body 會被 ancestor 隱藏規則吃掉）');
      api.uninstall();
    });

    it('sync(pagedMode: false) → uninstall + 頁碼指示元素移除', () => {
      const env = loadModuleEnv();
      const api = env.window.__JRead.pagedMode;
      const art = env.document.querySelector('article');
      api.sync({ pagedMode: true }, art);
      api.sync({ pagedMode: false }, art);
      assert.strictEqual(api.isInstalled(), false);
      assert.strictEqual(env.document.getElementById('__jread-page-indicator'), null,
        'uninstall 後頁碼指示元素必須移除');
    });

    it('sync(pagedMode: true, null articleEl) → 不 install（防衛）', () => {
      const env = loadModuleEnv();
      const api = env.window.__JRead.pagedMode;
      api.sync({ pagedMode: true }, null);
      assert.strictEqual(api.isInstalled(), false);
    });
  });

  // ---- D. 跨檔字面值同步（forcing function）------------------------------
  describe('跨檔同步', () => {
    it('paged-mode.js PROGRESS_ID 必須與 styler.js PROGRESS_ID 字面一致', () => {
      const m1 = PAGED_SRC.match(/PROGRESS_ID = '([^']+)'/);
      const m2 = STYLER_SRC.match(/PROGRESS_ID = '([^']+)'/);
      assert.ok(m1 && m2, '兩檔都須宣告 PROGRESS_ID');
      assert.strictEqual(m1[1], m2[1],
        'paged-mode.js 與 styler.js 的 PROGRESS_ID 是同一事實的雙實作，必須一致');
    });

    it('SW / popup DEFAULT_SETTINGS.pagedMode 預設都是 false', () => {
      for (const [name, src] of [['service-worker.js', SW_SRC], ['popup.js', POPUP_SRC]]) {
        const m = src.match(/pagedMode:\s*(\S+?),/);
        assert.ok(m, `${name} DEFAULT_SETTINGS 須含 pagedMode`);
        assert.strictEqual(m[1], 'false', `${name} pagedMode 預設必須 false`);
      }
    });

    it('popup.html 須含 #paged-mode-cb 開關、popup.js 須有 save wiring', () => {
      assert.ok(POPUP_HTML.includes('id="paged-mode-cb"'), 'popup.html 須含 checkbox');
      assert.ok(/save\(\{\s*pagedMode:/.test(POPUP_SRC), 'popup.js 須在 change 時 save({ pagedMode })');
    });
  });

  // ---- E. main.js wiring 結構順序 ----------------------------------------
  describe('main.js wiring', () => {
    it('storage.onChanged relevantKeys 含 pagedMode（即時切換走 reapply）', () => {
      const m = MAIN_SRC.match(/const relevantKeys = \[([^\]]+)\]/);
      assert.ok(m && m[1].includes("'pagedMode'"), 'relevantKeys 必須含 pagedMode');
    });

    it('exitReaderModeImpl 必須 uninstall 翻頁模組 + resetPosition', () => {
      assert.ok(/NS\.pagedMode\.uninstall\(\)/.test(MAIN_SRC), '須呼叫 NS.pagedMode.uninstall()');
      assert.ok(/NS\.pagedMode\.resetPosition\(\)/.test(MAIN_SRC), '須呼叫 NS.pagedMode.resetPosition()');
    });

    it('enter 路徑：captureScrollY 在 styler.apply 之前（overflow hidden 注入前捕捉）', () => {
      const enterBody = MAIN_SRC.slice(
        MAIN_SRC.indexOf('async function enterReaderModeImpl'),
        MAIN_SRC.indexOf('function exitReaderMode('));
      const cap = enterBody.indexOf('captureScrollY');
      const apply = enterBody.indexOf('NS.styler.apply');
      assert.ok(cap >= 0 && apply >= 0 && cap < apply,
        'captureScrollY 必須在 NS.styler.apply 之前呼叫');
    });

    it('enter 路徑：syncPagedModeFromSettings 在 syncSpaceScrollFromSettings 之前、installKeyguard 之前', () => {
      const enterBody = MAIN_SRC.slice(
        MAIN_SRC.indexOf('async function enterReaderModeImpl'),
        MAIN_SRC.indexOf('function exitReaderMode('));
      // 抓 call-site（帶引數括號），避免被註解內提及的函式名干擾
      const paged = enterBody.indexOf('syncPagedModeFromSettings(settings)');
      const space = enterBody.indexOf('syncSpaceScrollFromSettings(settings)');
      const guard = enterBody.indexOf('installKeyguard();');
      assert.ok(paged >= 0 && space >= 0 && guard >= 0, '三個呼叫都必須存在');
      assert.ok(paged < space, 'pagedMode 同步必須先於 spaceScroll（讓位判定依賴）');
      assert.ok(space < guard, '兩個模組 listener 都必須先於 keyguard 註冊');
    });

    it('syncSpaceScrollFromSettings 含 pagedMode 讓位 guard（Space 鍵互斥）', () => {
      const fnBody = MAIN_SRC.slice(
        MAIN_SRC.indexOf('function syncSpaceScrollFromSettings'),
        MAIN_SRC.indexOf('function syncPagedModeFromSettings'));
      assert.ok(/NS\.pagedMode\.isInstalled\(\)/.test(fnBody) &&
                /NS\.spaceScroll\.uninstall\(\)/.test(fnBody),
        'spaceScroll 必須在 pagedMode installed 時讓位');
    });
  });

  // ---- F. manifest / inject fallback 清單 --------------------------------
  describe('載入清單', () => {
    it('manifest content_scripts 含 content/paged-mode.js（main.js 之前）', () => {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(JREAD_DIR, 'manifest.json'), 'utf8'));
      const list = manifest.content_scripts[0].js;
      const i = list.indexOf('content/paged-mode.js');
      assert.ok(i >= 0, 'manifest 須含 paged-mode.js');
      assert.ok(i < list.indexOf('content/main.js'), '必須排在 main.js 之前');
    });
  });
});
