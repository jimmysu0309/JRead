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

// 水平 gutter 單一資料源（styler.js H_GUTTER 常數）。連續滑動卡片 padding 與
// 翻頁模式（左 padding + 右 transparent border + column-gap + column-width 扣除）
// 必須共用此值，否則兩模式內文行寬 drift（v0.8.14 修法：Jimmy 2026-06-09 回報
// 「翻頁比捲動窄」——v0.8.1 只改了連續模式的 gutter、翻頁漏改）。
const H_GUTTER = 'clamp(16px, calc(7.4vw - 12.8px), 56px)';

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
    it('pagedMode: true → 注入 column-width + column-fill: auto 翻頁區塊', () => {
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      // 「一頁一欄」必須用 column-width 表達。v0.7.234 寬度一致性：
      // contentWidth 語意 = 卡片總寬（與捲動模式 baseline 同義），欄寬 =
      // contentWidth − 左右內距和——兩模式內文行寬才逐 px 相等（Jimmy
      // 2026-06-07 macOS Chrome / Safari 回報「兩模式頁面寬度不同」）。
      assert.ok(css.includes(`column-width: calc(${BASE_SETTINGS.contentWidth}px - ${H_GUTTER} * 2) !important`),
        '須含 column-width: calc(<contentWidth>px − 左右內距和)');
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

    it('翻頁/捲動模式卡片總寬必須同為 contentWidth（寬度一致性，v0.7.234）', () => {
      // Jimmy 2026-06-07 macOS Chrome / Safari 回報：兩模式頁面寬度不同。
      // 舊版翻頁容器 max-width = contentWidth + 內距 ×2（832）、column-width
      // = contentWidth（720）→ 卡片與內文都比捲動模式寬 112px。forcing：
      // 翻頁容器 max-width 必須恰為 contentWidth（與捲動模式卡片同寬），
      // 不得再出現「contentWidth + 內距」的 cap。
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      const ruleMatch = css.match(/html \[data-jread-active="1"\]\s*\{[^}]*column-width[^}]*\}/s);
      assert.ok(ruleMatch, '須有翻頁容器規則');
      const rule = ruleMatch[0];
      assert.ok(rule.includes(`max-width: ${BASE_SETTINGS.contentWidth}px !important`),
        '翻頁容器 max-width 必須恰為 contentWidth（卡片總寬與捲動模式相等）');
      assert.ok(!rule.includes(`max-width: calc(${BASE_SETTINGS.contentWidth}px +`),
        '不得回退到 max-width: calc(contentWidth + 內距 ×2)（兩模式寬度不一致根因）');
    });

    it('翻頁/捲動模式水平 gutter 必須同值（內文行寬一致，v0.8.14）', () => {
      // Jimmy 2026-06-09 roomie.tw 真機回報：翻頁模式內文比連續滑動窄。
      // 根因：水平 gutter 由兩條 path 各自寫死——v0.8.1 把連續模式卡片
      // padding 從 min(56px,6vw) 改成 clamp(16px,…,56px)（390pt 內文對齊原站
      // 16px 標準 gutter），但翻頁模式漏改、仍停在 min(56px,6vw)（390pt 留
      // 23.4px → 內文窄 15px×2）。forcing function：兩模式都必須用 H_GUTTER。
      const paged = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      const scroll = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: false });
      // 連續模式卡片 padding 用 H_GUTTER
      assert.ok(scroll.includes(`padding: min(48px, 6vw) ${H_GUTTER} !important`),
        '連續模式卡片水平 padding 必須是 H_GUTTER');
      // 翻頁模式左 padding / 右 border / column-width 扣除 / column-gap 全用 H_GUTTER
      const pagedRule = paged.match(/html \[data-jread-active="1"\]\s*\{[^}]*column-width[^}]*\}/s)[0];
      assert.ok(pagedRule.includes(`${H_GUTTER} !important`) &&
        pagedRule.includes(`border-right: ${H_GUTTER} solid transparent`),
        '翻頁模式左 padding + 右 border 必須用同一 H_GUTTER');
      assert.ok(pagedRule.includes(`column-gap: calc(${H_GUTTER} * 2) !important`),
        '翻頁模式 column-gap 必須是 H_GUTTER ×2（維持 stride = column 寬 + gap 恆等式）');
      // forcing function：翻頁模式不得再殘留舊的 min(56px, 6vw) gutter
      assert.ok(!pagedRule.includes('min(56px, 6vw) solid') &&
        !pagedRule.includes('- min(56px, 6vw) * 2'),
        '翻頁模式不得殘留舊 min(56px, 6vw) gutter（兩模式寬度不一致根因）');
    });

    it('pagedMode: true → media/連結補 touch-action: pan-y pinch-zoom + -webkit-user-drag: none（圖片上滑能翻頁，v0.8.7）', () => {
      // Jimmy 2026-06-09 culpium/Substack 真機實證：圖片 draggable=true，iPhone
      // 上水平拖曳圖片啟動 iOS 原生 drag-lift 搶走左右滑 → 圖片上滑不翻頁。
      // 卡片 touch-action: pan-y 不繼承到圖片，須對 media/連結明確補。
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      const ruleMatch = css.match(/html \[data-jread-active="1"\] img,[^{]*\{[^}]*-webkit-user-drag[^}]*\}/s);
      assert.ok(ruleMatch, '翻頁模式須有 media/連結的 touch-action + user-drag 規則');
      const rule = ruleMatch[0];
      assert.ok(rule.includes('touch-action: pan-y pinch-zoom !important'),
        'media/連結須補 touch-action: pan-y pinch-zoom（同卡片，水平 swipe 不被原生攔）');
      assert.ok(rule.includes('-webkit-user-drag: none !important'),
        '須停掉 -webkit-user-drag（擋 iOS image drag-lift 搶手勢）');
      assert.ok(rule.includes('-webkit-touch-callout: none !important'),
        '須停掉 -webkit-touch-callout（長按選單也會干擾）');
    });

    it('pagedMode: false（垂直模式）→ 不注入 media touch-action/user-drag 規則（保留長按存圖）', () => {
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: false });
      assert.ok(!/-webkit-user-drag/.test(css),
        '垂直模式不得注入 -webkit-user-drag（避免犧牲長按存圖等原生互動）');
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
      assert.ok(rule.includes(`border-right: ${H_GUTTER} solid transparent !important`),
        '右內距必須用 transparent border-right（scrollable overflow 不含 border）');
      // padding 簡寫的 right 槽位必須是 0（4 值簡寫第二值）
      const padRe = new RegExp('padding:\\s*min\\(48px, 6vw\\) 0 min\\(48px, 6vw\\) ' +
        H_GUTTER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' !important');
      assert.ok(padRe.test(rule),
        '翻頁容器 padding-right 必須為 0（WebKit 不把尾端 padding 算進 scrollable overflow）');
    });

    it('pagedMode: true → 桌面文件鎖卷動 + overscroll-behavior 防歷史手勢', () => {
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      assert.ok(css.includes('overscroll-behavior: none !important'),
        '須含 overscroll-behavior: none（macOS 觸控板水平 swipe 歷史導航防護）');
      // 桌面（媒體查詢外）html/body 維持 overflow: hidden 鎖死垂直卷動
      const base = css.match(/html\.__jread-active, html\.__jread-active body\s*\{([^}]*)\}/);
      assert.ok(base && /overflow:\s*hidden\s*!important/.test(base[1]),
        '桌面 base 規則須維持 overflow: hidden（無自動收合工具列、撐高會多無用捲軸）');
    });

    it('pagedMode: true → 觸控裝置放行垂直卷動 + 撐高 body（iOS 工具列自動收合 hack，v0.7.238）', () => {
      // Jimmy 2026-06-08 回報：翻頁模式希望進入時自動收合 Safari 工具列多顯示
      // 一行。simulator 對照實證「程式捲動無法觸發收合、只有真實手勢能」——
      // 故 hack = 翻頁 document 在觸控裝置改為可垂直捲、撐高 body，使用者垂直
      // 滑一下 → document 捲動 → iOS 自動收合工具列（卡片 fixed 視覺不動）。
      // forcing function：
      //   1. 必須有 (hover:none) and (pointer:coarse) 觸控媒體查詢區塊
      //   2. 該區塊內 html/body overflow-y 必須是 visible（放行垂直卷動）
      //   3. body 必須 min-height > 100vh（要比視窗高、才有可捲空間觸發收合）
      // 任何人把翻頁 document 改回無條件 overflow:hidden（鎖死垂直卷動）→ 收合
      // hack 失效、本測試 fail。
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      const mqIdx = css.indexOf('@media (hover: none) and (pointer: coarse)');
      assert.ok(mqIdx >= 0, '須有 (hover:none) and (pointer:coarse) 觸控媒體查詢區塊（收合 hack 限觸控裝置）');
      const after = css.slice(mqIdx);
      assert.ok(/overflow-y:\s*visible\s*!important/.test(after),
        '觸控裝置翻頁 document 必須 overflow-y: visible（放行垂直卷動，使用者滑一下觸發 iOS 工具列收合）');
      // v0.7.244：min-height 必須 > 100vh（要比視窗高、才有可捲空間）。Jimmy 真機
      // 實測 iOS 工具列收合看「有沒有在捲」不看「捲多少」——101vh 就收得了；500vh
      // 的大範圍反害第一頁左右滑不靈敏，故縮到剛好 > 100vh。forcing：不得 <= 100vh
      // （body 不比視窗高 = 無可捲空間 = 完全收不了）。
      const mh = after.match(/min-height:\s*(\d+)vh\s*!important/);
      assert.ok(mh, 'body 必須有 min-height: <N>vh（撐高給足垂直捲動距離）');
      assert.ok(parseInt(mh[1], 10) > 100,
        `body min-height 必須 > 100vh（實得 ${mh[1]}vh；<= 100vh 無可捲空間、收不了工具列）`);
    });

    it('pagedMode: true → 翻頁卡片 touch-action: pan-y pinch-zoom（垂直 pan 收工具列 + 雙指捏合呼叫所有標籤頁，v0.7.255）', () => {
      // iOS simulator 真機實證：缺 pan-y 時 document 可捲（scrollH 1508 > 714）、
      // 媒體查詢匹配，但 fixed + overflow:hidden 卡片上的非被動 touchmove
      // listener 讓 WebKit 對垂直 pan 處置變曖昧、scrollY 卡死 0 → 工具列不收。
      // touch-action: pan-y 讓垂直 pan 冒泡去捲 document（水平翻頁仍由 JS
      // 程式控 scrollLeft，touch-action 不影響 JS touch event）。
      // v0.7.255：必須補 pinch-zoom token——純 pan-y 會關掉雙指捏合，iOS Safari
      // 的「呼叫所有標籤頁」是雙指捏合縮放系統手勢，翻頁模式捏不出（Jimmy 回報）。
      // forcing function：任何人拿掉 pan-y → 收合失效；拿掉 pinch-zoom → 捏合失效。
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      const ruleMatch = css.match(/html \[data-jread-active="1"\]\s*\{[^}]*column-width[^}]*\}/s);
      assert.ok(ruleMatch, '須有翻頁容器規則');
      assert.ok(/touch-action:\s*pan-y\s+pinch-zoom\s*!important/.test(ruleMatch[0]),
        '翻頁卡片必須含 touch-action: pan-y pinch-zoom（垂直 pan 收工具列 + 雙指捏合呼叫所有標籤頁）');
    });

    it('applyVLock 收合鎖用 pinch-zoom 而非 none（保留雙指捏合呼叫所有標籤頁，v0.7.255）', () => {
      // 第一頁捲動停止後鎖死垂直 pan，但鎖值必須是 'pinch-zoom' 不是 'none'——
      // none 會連雙指捏合系統手勢一起關掉，使用者在第一頁鎖定後捏不出所有標籤頁。
      // pinch-zoom 只擋單指 pan、放行雙指縮放，鎖死垂直 pan 的目的仍達成。
      const lockMatch = PAGED_SRC.match(/function applyVLock\(\)\s*\{[^}]*\}/s);
      assert.ok(lockMatch, '須有 applyVLock');
      assert.ok(/setProperty\(\s*'touch-action'\s*,\s*'pinch-zoom'\s*,\s*'important'\s*\)/.test(lockMatch[0]),
        'applyVLock 必須用 pinch-zoom（保留雙指捏合）、不可用 none');
      assert.ok(!/'touch-action'\s*,\s*'none'/.test(lockMatch[0]),
        'applyVLock 不可把 touch-action 設成 none（會關掉雙指捏合呼叫所有標籤頁）');
    });

    it('pagedMode: true → 媒體單頁化（max-height dvh + break-inside: avoid）', () => {
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      assert.ok(/img[^{]*\{[^}]*max-height:\s*calc\(100dvh/s.test(css) ||
                css.includes('max-height: calc(100dvh'),
        'img 須有 100dvh 基準的 max-height cap');
      assert.ok(css.includes('break-inside: avoid'), '媒體須 break-inside: avoid 防跨頁切割');
      assert.ok(css.includes('object-fit: contain'), '超尺寸圖片須等比縮放');
    });

    it('pagedMode: true → 媒體單頁化 img 規則必須排除 inline emoji（:not([data-jread-inline-img])，v0.8.10）', () => {
      // Jimmy 2026-06-09 翻頁模式 X Twemoji 實機回報：viewBox-only SVG emoji 被
      // width:auto + max-width:100% 撐成滿欄（150 natural → 608px）。媒體單頁化
      // 規則的 img 選擇器必須排除 [data-jread-inline-img]（與捲動模式 block-image
      // rule 同準則）——inline-img rule 只覆蓋 max-height/object-fit/display、未設
      // width，故 width:auto 仍會命中 emoji，必須在選擇器層排除。
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      // 抓「width: auto + max-width:100% 的媒體單頁化」那條 rule（含 100dvh max-height）
      const m = css.match(/([^\n]*img[^{]*)\{[^}]*max-height:\s*calc\(100dvh[^}]*width:\s*auto[^}]*\}/s);
      assert.ok(m, '須能抓到含 100dvh max-height + width:auto 的媒體單頁化 rule');
      assert.ok(/img:not\(\[data-jread-inline-img\]\)/.test(m[1]),
        '媒體單頁化 rule 的 img 選擇器必須是 img:not([data-jread-inline-img])——forcing：缺排除會把 inline emoji 撐成滿欄（X Twemoji 實機回報）');
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
    // v0.7.239：整頁可滑（EDGE_GUARD_PX = 0）。Jimmy 回報「翻頁只在中間生效、
    // 太不靈敏」+ 真機實證左邊緣往右滑「不會返回、只是滑不動」——擋返回已由
    // onTouchMove preventDefault + 卡片 touch-action 雙重覆蓋，邊緣緩衝是多餘的
    // belt、反害邊緣翻不了頁。forcing：邊緣起手現在必須照常分類，不再回 null。
    it('左邊緣起手 → prev（整頁可滑，v0.7.239；不再讓位邊緣緩衝）', () => {
      assert.strictEqual(
        pagedApi.classifySwipe({ dx: 100, dy: 0, startX: 10, viewportW: W }), 'prev');
    });
    it('右邊緣起手 → next（整頁可滑，v0.7.239）', () => {
      assert.strictEqual(
        pagedApi.classifySwipe({ dx: -100, dy: 0, startX: W - 10, viewportW: W }), 'next');
    });
    it('EDGE_GUARD_PX 必須為 0（整頁可滑 forcing：任何人調回非 0 → 邊緣翻不了頁）', () => {
      assert.strictEqual(pagedApi.EDGE_GUARD_PX, 0);
    });
  });

  // ---- iOS 工具列收合只在第一頁可滑（v0.7.239）----------------------------
  // shouldBlockTouchMove(dx, dy, pageIdx)：onTouchMove 是否 preventDefault。
  // 第一頁只擋水平（放行垂直滑收工具列）、第二頁起擋全部（維持收合 + 鎖定）。
  // HMOVE_BLOCK_PX = 6。
  describe('shouldBlockTouchMove（工具列收合限第一頁）', () => {
    it('第一頁垂直滑（dy 支配）→ false（放行 → 捲 document 收工具列）', () => {
      assert.strictEqual(pagedApi.shouldBlockTouchMove(2, 80, 0), false);
    });
    it('第一頁水平滑（dx 支配且 > 6）→ true（擋 Safari 邊緣返回）', () => {
      assert.strictEqual(pagedApi.shouldBlockTouchMove(40, 5, 0), true);
    });
    it('第一頁水平微動（dx <= 6）→ false（不誤擋）', () => {
      assert.strictEqual(pagedApi.shouldBlockTouchMove(4, 1, 0), false);
    });
    it('第二頁垂直滑 → true（鎖死：維持第一頁收合後的 scrollY 不被捲回）', () => {
      assert.strictEqual(pagedApi.shouldBlockTouchMove(2, 80, 1), true);
    });
    it('第二頁水平滑 → true（擋返回；翻頁由 touchend JS 處理）', () => {
      assert.strictEqual(pagedApi.shouldBlockTouchMove(40, 5, 1), true);
    });
    it('更後面的頁垂直滑 → true', () => {
      assert.strictEqual(pagedApi.shouldBlockTouchMove(0, 100, 5), true);
    });
  });

  // v0.7.245：blockTouchDecision(dx, dy, pageIdx, locked)——第一頁「捲動停止後」鎖死
  // （locked=true）即擋全部單指滑動。locked 由 shouldBlockTouchMove 餵入模組私有 vLocked。
  describe('blockTouchDecision（第一頁收合後鎖死，v0.7.245）', () => {
    it('未鎖 + 第一頁垂直滑 → false（放行去收工具列）', () => {
      assert.strictEqual(pagedApi.blockTouchDecision(2, 80, 0, false), false);
    });
    it('已鎖 + 第一頁垂直滑 → true（維持收合、左右滑乾淨）', () => {
      assert.strictEqual(pagedApi.blockTouchDecision(2, 80, 0, true), true);
    });
    it('已鎖 + 第一頁水平微動（dx <= 6）→ true（鎖蓋過第一頁放行）', () => {
      assert.strictEqual(pagedApi.blockTouchDecision(4, 1, 0, true), true);
    });
    it('已鎖 → 任意滑動恆 true；未鎖第二頁起也恆 true', () => {
      assert.strictEqual(pagedApi.blockTouchDecision(100, 100, 0, true), true);
      assert.strictEqual(pagedApi.blockTouchDecision(2, 80, 1, false), true);
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

  // ---- C2. 頁碼指示開關 showPageNumber（v0.7.237）------------------------
  // Jimmy 回報：翻頁模式底部頁碼「3 / 43」佔顯示空間，做成 option。
  // 訊號層次：驗 sync/setShowIndicator 對指示器 DOM 的增/移除 + 模組不被
  // uninstall（純顯示層）。不驗真實 layout（jsdom 無 layout）。
  describe('頁碼指示開關 showPageNumber（v0.7.237）', () => {
    function loadModuleEnv() {
      const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: [], pretendToBeVisual: true });
      env.window.eval(PAGED_SRC);
      return env;
    }

    it('sync(pagedMode: true, showPageNumber: false) → installed 但無頁碼指示器', () => {
      const env = loadModuleEnv();
      const api = env.window.__JRead.pagedMode;
      const art = env.document.querySelector('article');
      api.sync({ pagedMode: true, showPageNumber: false }, art);
      assert.strictEqual(api.isInstalled(), true, 'showPageNumber=false 不得影響翻頁模式啟動');
      assert.strictEqual(env.document.getElementById('__jread-page-indicator'), null,
        'showPageNumber=false → 不建頁碼指示器');
      api.uninstall();
    });

    it('sync 預設（showPageNumber 未設）→ 顯示頁碼指示器（嚮後相容）', () => {
      const env = loadModuleEnv();
      const api = env.window.__JRead.pagedMode;
      const art = env.document.querySelector('article');
      api.sync({ pagedMode: true }, art);
      assert.ok(env.document.getElementById('__jread-page-indicator'),
        'showPageNumber 未設 → 預設顯示（!== false）');
      api.uninstall();
    });

    it('setShowIndicator 即時增/移除頁碼指示器、不 uninstall 模組（輕量路徑）', () => {
      const env = loadModuleEnv();
      const api = env.window.__JRead.pagedMode;
      const art = env.document.querySelector('article');
      api.sync({ pagedMode: true }, art);
      assert.ok(env.document.getElementById('__jread-page-indicator'), '初始顯示');
      api.setShowIndicator(false);
      assert.strictEqual(env.document.getElementById('__jread-page-indicator'), null,
        'setShowIndicator(false) → 移除指示器');
      assert.strictEqual(api.isInstalled(), true, 'setShowIndicator 不得 uninstall 翻頁模組');
      api.setShowIndicator(true);
      assert.ok(env.document.getElementById('__jread-page-indicator'),
        'setShowIndicator(true) → 重新建立指示器');
      api.uninstall();
    });
  });

  // ---- C3. 邊緣手勢攔截 onTouchMove preventDefault（v0.7.237）-------------
  // Jimmy 回報：翻頁模式第一頁左滑觸發 iOS Safari「back」。修法：水平支配的
  // 單指 touchmove preventDefault，攔住系統邊緣返回手勢（passive:false 才能擋）。
  // 訊號層次：驗「水平 preventDefault / 垂直放行」的判定邏輯 + listener 註冊
  // 為 passive:false。不驗真實 iOS Safari 是否尊重 preventDefault（系統手勢
  // 只能 Jimmy 真機驗——idb 合成 HID 無法觸發 UIScreenEdgePanGestureRecognizer，
  // 2026-06-08 simulator 實證）。
  describe('邊緣手勢攔截 onTouchMove（v0.7.237）', () => {
    function loadModuleEnv() {
      const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: [], pretendToBeVisual: true });
      env.window.eval(PAGED_SRC);
      return env;
    }
    function fireTouch(env, type, touches, cancelable) {
      const ev = new env.window.Event(type, { bubbles: true, cancelable: cancelable !== false });
      ev.touches = touches;
      ev.changedTouches = touches;
      let prevented = false;
      const orig = ev.preventDefault.bind(ev);
      ev.preventDefault = () => { prevented = true; orig(); };
      env.window.dispatchEvent(ev);
      return prevented;
    }

    it('水平支配單指滑動 → preventDefault（擋 Safari 返回手勢）', () => {
      const env = loadModuleEnv();
      const api = env.window.__JRead.pagedMode;
      const art = env.document.querySelector('article');
      api.sync({ pagedMode: true }, art);
      fireTouch(env, 'touchstart', [{ clientX: 400, clientY: 300 }]);
      const prevented = fireTouch(env, 'touchmove', [{ clientX: 360, clientY: 305 }]);
      assert.strictEqual(prevented, true, '|dx| > |dy| 的滑動必須 preventDefault');
      api.uninstall();
    });

    it('垂直支配滑動 → 不 preventDefault（放行 pull-to-refresh / 系統卷動）', () => {
      const env = loadModuleEnv();
      const api = env.window.__JRead.pagedMode;
      const art = env.document.querySelector('article');
      api.sync({ pagedMode: true }, art);
      fireTouch(env, 'touchstart', [{ clientX: 400, clientY: 300 }]);
      const prevented = fireTouch(env, 'touchmove', [{ clientX: 405, clientY: 380 }]);
      assert.strictEqual(prevented, false, '|dy| > |dx| 的滑動不得 preventDefault');
      api.uninstall();
    });

    it('多指 touchmove → 不 preventDefault（讓位 3 指 toggle）', () => {
      const env = loadModuleEnv();
      const api = env.window.__JRead.pagedMode;
      const art = env.document.querySelector('article');
      api.sync({ pagedMode: true }, art);
      fireTouch(env, 'touchstart', [{ clientX: 400, clientY: 300 }]);
      const prevented = fireTouch(env, 'touchmove',
        [{ clientX: 360, clientY: 305 }, { clientX: 200, clientY: 305 }, { clientX: 100, clientY: 305 }]);
      assert.strictEqual(prevented, false, '多指滑動不得 preventDefault（讓位手勢模組）');
      api.uninstall();
    });

    it('touchmove listener 必須 passive:false（否則 preventDefault 無效、擋不住返回手勢）', () => {
      assert.ok(
        /addEventListener\('touchmove', onTouchMove, \{ capture: true, passive: false \}\)/.test(PAGED_SRC),
        'touchmove 必須註冊為 passive:false');
    });
  });

  // ---- C4. touchcancel 補判翻頁（v0.8.5）---------------------------------
  // Jimmy 回報：iPhone 翻頁模式「在可點擊的圖片上左右滑動無法翻頁，必須在內文
  // 上滑」。根因（從 code 推定）：touch listener 掛 window capture，必對所有
  // target 收到 touchstart/move/end——唯一會丟失手勢的路徑是 touchcancel。iOS 在
  // 可點擊圖片/連結上啟動原生 image-drag / callout 時，對進行中的單指水平 swipe
  // 送 touchcancel（非 touchend），舊 onTouchCancel 直接丟棄 → 圖片上滑不翻頁。
  // 修法：onTouchCancel 用 touchmove 累積的 lastX/lastY 補判，構成水平 swipe 就翻頁。
  // 訊號層次：本測驗「touchcancel 後翻頁判定」邏輯（jsdom 合成事件 + stub layout
  // 讓頁數>1 觀測 indicator）。不驗真實 iOS 是否在圖片上送 touchcancel（系統行為，
  // 只能真機/simulator HID 驗）。
  describe('touchcancel 補判翻頁（圖片上滑動，v0.8.5）', () => {
    function loadInstalled() {
      const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: [], pretendToBeVisual: true });
      env.window.eval(PAGED_SRC);
      const api = env.window.__JRead.pagedMode;
      const art = env.document.querySelector('article');
      // jsdom 無 layout：stub clientWidth/scrollWidth 讓 pageCount > 1，才觀測得到翻頁
      Object.defineProperty(art, 'clientWidth', { value: 400, configurable: true });
      Object.defineProperty(art, 'scrollWidth', { value: 1200, configurable: true });
      api.sync({ pagedMode: true }, art);
      return { env, api };
    }
    function fireTouch(env, type, touches, cancelable) {
      const ev = new env.window.Event(type, { bubbles: true, cancelable: cancelable !== false });
      ev.touches = touches;
      ev.changedTouches = touches;
      env.window.dispatchEvent(ev);
    }
    function pageText(env) {
      const ind = env.document.getElementById('__jread-page-indicator');
      return ind ? ind.textContent : null;
    }

    it('水平 swipe 後收到 touchcancel（iOS 圖片 drag）→ 仍翻頁', () => {
      const { env, api } = loadInstalled();
      assert.strictEqual(pageText(env), '1 / 3', '初始應在第 1 頁');
      fireTouch(env, 'touchstart', [{ clientX: 400, clientY: 300 }]);
      fireTouch(env, 'touchmove', [{ clientX: 300, clientY: 302 }]); // 左滑 100px
      fireTouch(env, 'touchcancel', []); // iOS image-drag 中斷
      assert.strictEqual(pageText(env), '2 / 3',
        'touchcancel 中斷的水平 swipe 必須照樣翻到下一頁');
      api.uninstall();
    });

    it('右滑 + touchcancel → 翻回上一頁', () => {
      const { env, api } = loadInstalled();
      // 先到第 2 頁
      fireTouch(env, 'touchstart', [{ clientX: 400, clientY: 300 }]);
      fireTouch(env, 'touchmove', [{ clientX: 300, clientY: 300 }]);
      fireTouch(env, 'touchcancel', []);
      assert.strictEqual(pageText(env), '2 / 3');
      // 右滑回上一頁
      fireTouch(env, 'touchstart', [{ clientX: 300, clientY: 300 }]);
      fireTouch(env, 'touchmove', [{ clientX: 400, clientY: 300 }]); // 右滑 100px
      fireTouch(env, 'touchcancel', []);
      assert.strictEqual(pageText(env), '1 / 3', '右滑 + cancel 必須翻回上一頁');
      api.uninstall();
    });

    it('微動（非 swipe）+ touchcancel → 不翻頁（tap on 圖片不誤翻）', () => {
      const { env, api } = loadInstalled();
      fireTouch(env, 'touchstart', [{ clientX: 400, clientY: 300 }]);
      fireTouch(env, 'touchmove', [{ clientX: 396, clientY: 301 }]); // 僅 4px
      fireTouch(env, 'touchcancel', []);
      assert.strictEqual(pageText(env), '1 / 3',
        '位移不足 SWIPE_MIN_DX 的 touchcancel 不得翻頁');
      api.uninstall();
    });

    it('垂直滑動 + touchcancel → 不翻頁（直向手勢不誤翻）', () => {
      const { env, api } = loadInstalled();
      fireTouch(env, 'touchstart', [{ clientX: 400, clientY: 300 }]);
      fireTouch(env, 'touchmove', [{ clientX: 405, clientY: 400 }]); // 垂直支配
      fireTouch(env, 'touchcancel', []);
      assert.strictEqual(pageText(env), '1 / 3',
        '垂直支配位移的 touchcancel 不得翻頁');
      api.uninstall();
    });

    // v0.8.6：non-cancelable touchmove（iOS 圖片上系統已接管 → touchmove
    // cancelable=false）必須仍追蹤 lastX，否則 onTouchCancel 補判 dx=0。這是
    // v0.8.5「圖片上仍滑不動」的真兇——lastX 追蹤被擋在 `!e.cancelable return` 之後。
    it('non-cancelable touchmove（圖片接管）+ touchcancel → 仍翻頁（v0.8.6 真兇）', () => {
      const { env, api } = loadInstalled();
      fireTouch(env, 'touchstart', [{ clientX: 400, clientY: 300 }]);
      fireTouch(env, 'touchmove', [{ clientX: 300, clientY: 302 }], false); // cancelable:false
      fireTouch(env, 'touchcancel', []);
      assert.strictEqual(pageText(env), '2 / 3',
        'non-cancelable touchmove 仍須追蹤位置，touchcancel 才補得了翻頁');
      api.uninstall();
    });

    // v0.8.6：極端變體——iOS 直接 cancel、幾乎沒派發 touchmove。靠 cancel event
    // 的 changedTouches 補位置（onTouchCancel 取 lastX 與 changedTouches 最大位移者）。
    it('無 touchmove、touchcancel 自帶位移（changedTouches）→ 仍翻頁', () => {
      const { env, api } = loadInstalled();
      fireTouch(env, 'touchstart', [{ clientX: 400, clientY: 300 }]);
      // 不派發 touchmove；cancel 直接帶最終位置
      fireTouch(env, 'touchcancel', [{ clientX: 300, clientY: 302 }]);
      assert.strictEqual(pageText(env), '2 / 3',
        'touchcancel 的 changedTouches 位移足夠時必須翻頁');
      api.uninstall();
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

    it('shared defaults / popup DEFAULT_SETTINGS.pagedMode 預設都是 false', () => {
      // v0.7.235：SW 的 DEFAULT_SETTINGS literal 搬到 content/settings-defaults.js
      // 單一資料源（iOS background 掉包修法），直接 require 驗值。
      // v0.8.16：popup 也收斂到單一資料源（const DEFAULT_SETTINGS =
      // window.__JReadSettingsDefaults），不再自帶 literal——改驗 reference 形式 +
      // shared 正準值（popup 生效值即此值）。
      const sharedDefaults = require('../../jread/content/settings-defaults.js');
      assert.strictEqual(sharedDefaults.pagedMode, false,
        'settings-defaults.js pagedMode 預設必須 false');
      assert.match(POPUP_SRC, /const DEFAULT_SETTINGS = window\.__JReadSettingsDefaults\b/,
        'popup.js DEFAULT_SETTINGS 必須取自 window.__JReadSettingsDefaults（單一資料源）');
    });

    it('popup.html 須含 #paged-mode-cb 開關、popup.js 須有 save wiring', () => {
      assert.ok(POPUP_HTML.includes('id="paged-mode-cb"'), 'popup.html 須含 checkbox');
      assert.ok(/save\(\{\s*pagedMode:/.test(POPUP_SRC), 'popup.js 須在 change 時 save({ pagedMode })');
    });

    it('shared defaults / popup DEFAULT_SETTINGS.showPageNumber 預設都是 true（v0.7.237）', () => {
      // v0.8.16：popup 收斂到單一資料源，不再自帶 literal——驗 reference + shared 正準值。
      const sharedDefaults = require('../../jread/content/settings-defaults.js');
      assert.strictEqual(sharedDefaults.showPageNumber, true,
        'settings-defaults.js showPageNumber 預設必須 true（嚮後相容：原本一律顯示）');
      assert.match(POPUP_SRC, /const DEFAULT_SETTINGS = window\.__JReadSettingsDefaults\b/,
        'popup.js DEFAULT_SETTINGS 必須取自 window.__JReadSettingsDefaults（單一資料源）');
    });

    it('popup.html 須含 #page-number-cb / #page-number-row + .setting-row[hidden] 修正（v0.7.237）', () => {
      assert.ok(POPUP_HTML.includes('id="page-number-cb"'), 'popup.html 須含頁碼指示 checkbox');
      assert.ok(POPUP_HTML.includes('id="page-number-row"'), 'popup.html 須含頁碼指示 row');
      assert.ok(/save\(\{\s*showPageNumber:/.test(POPUP_SRC), 'popup.js 須在 change 時 save({ showPageNumber })');
      // .setting-row { display:flex }（author origin）會蓋過 [hidden] 屬性的 UA
      // display:none——沒這條顯式規則，JS 對 setting-row 設 .hidden=true 完全無效
      // （iOS simulator 實證：頁碼指示 row 在翻頁模式關閉時仍顯示）。
      assert.ok(
        /\.setting-row\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(POPUP_HTML),
        'popup.html 須有 .setting-row[hidden] { display:none !important }（修 hidden 屬性對 setting-row 失效）');
    });
  });

  // ---- E. main.js wiring 結構順序 ----------------------------------------
  describe('main.js wiring', () => {
    it('storage.onChanged relevantKeys 含 pagedMode（即時切換走 reapply）', () => {
      const m = MAIN_SRC.match(/const relevantKeys = \[([^\]]+)\]/);
      assert.ok(m && m[1].includes("'pagedMode'"), 'relevantKeys 必須含 pagedMode');
    });

    it('showPageNumber 走獨立輕量路徑（setShowIndicator）、不在 relevantKeys（v0.7.237）', () => {
      // 頁碼指示是純顯示層——full reapply 會造成捲動→翻頁閃爍，改直接 reconcile。
      assert.ok(/'showPageNumber' in changes/.test(MAIN_SRC),
        'main.js 須獨立處理 showPageNumber 變更');
      assert.ok(/NS\.pagedMode\.setShowIndicator\(/.test(MAIN_SRC),
        'main.js 須呼叫 NS.pagedMode.setShowIndicator');
      const m = MAIN_SRC.match(/const relevantKeys = \[([^\]]+)\]/);
      assert.ok(m && !m[1].includes('showPageNumber'),
        'showPageNumber 不應在 relevantKeys（純顯示層、不需 full styler reapply）');
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

    it('三條 enter 路徑（一般 / X thread / FB post）都必須同步 pagedMode、且先於 spaceScroll（v0.7.233）', () => {
      // Jimmy 2026-06-07 iOS 回報：X thread 翻頁模式下段落指示條殘留。根因：
      // styler 依 settings.pagedMode 在所有路徑注入翻頁 CSS，但 X / FB 合成
      // 容器路徑沒呼叫 syncPagedModeFromSettings——模組沒裝 = spaceScroll 的
      // 「pagedMode installed 才讓位」判定永遠不成立（指示條殘留），且頁碼
      // 不顯示、超過一頁翻不動。
      // 注意：不可用「全檔 call site 計數 >= 3」——onChanged reapply 的同名
      // call 也會被算進去，少一條 enter 路徑仍湊得到 3（sanity check 實證
      // 偽陰性）。必須逐函式 body 驗證。
      const fnBody = (name) => {
        const starts = [
          MAIN_SRC.indexOf(`async function ${name}`),
          MAIN_SRC.indexOf(`function ${name}`)
        ].filter((i) => i >= 0);
        assert.ok(starts.length, `main.js 缺 ${name}`);
        const start = Math.min(...starts);
        // 函式之間以下一個 top-level function 宣告為界（夠粗但對本檢查足夠）
        const next = MAIN_SRC.slice(start + 10).search(/\n  (?:async )?function /);
        return next >= 0 ? MAIN_SRC.slice(start, start + 10 + next) : MAIN_SRC.slice(start);
      };
      for (const fn of ['enterXThreadMode', 'enterFbPostMode', 'enterReaderModeImpl']) {
        const body = fnBody(fn);
        const paged = body.indexOf('syncPagedModeFromSettings(settings)');
        const space = body.indexOf('syncSpaceScrollFromSettings(settings)');
        assert.ok(paged >= 0, `${fn} 必須呼叫 syncPagedModeFromSettings(settings)`);
        assert.ok(space >= 0, `${fn} 必須呼叫 syncSpaceScrollFromSettings(settings)`);
        assert.ok(paged < space,
          `${fn}：pagedMode 同步必須先於 spaceScroll（讓位判定依賴 installed 狀態）`);
        assert.ok(body.includes('captureScrollY'),
          `${fn} 必須在 styler.apply 前呼叫 captureScrollY`);
      }
      // captureScrollY 也必須三路徑齊備（styler 注入 overflow hidden 前捕捉）
      const capCalls = MAIN_SRC.match(/NS\.pagedMode\.captureScrollY\(\)/g) || [];
      assert.ok(capCalls.length >= 4,
        `captureScrollY 必須在三條 enter 路徑 + onChanged reapply 共 >= 4 處呼叫，實際 ${capCalls.length} 處`);
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
