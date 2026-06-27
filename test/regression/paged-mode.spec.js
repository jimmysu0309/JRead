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
      // padding 簡寫的 right 槽位必須是 0（4 值簡寫第二值）。v1.5.2：上緣（第一值）
      // 改用 PAGED_TOP_GUTTER = min(16px, 2vw)、下緣（第三值）維持 V_GUTTER = min(48px, 6vw)。
      const padRe = new RegExp('padding:\\s*min\\(16px, 2vw\\) 0 min\\(48px, 6vw\\) ' +
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

    it('pagedMode: true → 頁碼指示器可拖曳（pointer-events:auto + touch-action:none，v0.8.150 scrubber）', () => {
      // 頁碼當 scrubber（按住拖曳快速跳頁）：必須 pointer-events:auto 才會成為
      // touch/mouse hit-test target（paged-mode.js 靠 isIndicatorTarget 判定）；
      // touch-action:none 擋掉 iOS 在指示器上的原生捲動/縮放/返回。forcing：任何人
      // 把 pointer-events 改回 none → 頁碼接不到事件、scrub 全滅。
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      const m = css.match(/#__jread-page-indicator\s*\{([^}]*)\}/);
      assert.ok(m, '須有 #__jread-page-indicator 規則');
      assert.ok(/pointer-events:\s*auto/.test(m[1]),
        '頁碼指示器必須 pointer-events: auto（scrubber 才接得到 touch/mouse）');
      assert.ok(/touch-action:\s*none/.test(m[1]),
        '頁碼指示器必須 touch-action: none（擋 iOS 原生捲動/縮放/返回）');
      assert.ok(!/pointer-events:\s*none/.test(m[1]),
        'forcing：不得殘留 pointer-events: none（會讓頁碼 scrub 全滅）');
    });

    it('pagedMode: true → 注入 scrub 進度條樣式（v0.8.151）', () => {
      const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
      assert.ok(css.includes('#__jread-scrub-track'), '須含 scrub 進度條容器樣式');
      assert.ok(css.includes('#__jread-scrub-fill'), '須含 scrub 進度條 fill 樣式');
      // v0.8.153：觸覺載體 #__jread-haptic 不再用 styler CSS（改 paged-mode.js inline
      // display:none 掛 body，比照 ios-haptics）——styler 不得再注入該規則
      assert.ok(!css.includes('#__jread-haptic'),
        'v0.8.153：觸覺載體不再用 styler CSS（改 JS inline display:none 掛 body）');
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

  describe('quantizeStride（v0.8.56 stride 格點量化）', () => {
    // iOS 模擬器 chinatalk 實測（iPhone 17 Pro 402pt、contentWidth 760）：
    // 引擎實際 stride 402.281（border 16.948 被 snap 成 16.6667 + clientWidth
    // 整數截斷讓近似公式算出 401.948，每頁短 0.333px、64 頁累積 21px →
    // 末頁 scrollLeft 25724 vs 格點 25746、內容整欄右移裁切右緣文字）。
    // maxSL = 25747（引擎讀值）、64 格 → 量化回 402.297，誤差不再累積
    it('iOS chinatalk 實案：maxSL 25747 / 近似 401.948 → 64 格量化 402.297', () => {
      const q = pagedApi.quantizeStride(25747, 401.948);
      assert.ok(Math.abs(q - 25747 / 64) < 1e-9);
      // 末頁 target = 63...64 格都必須落回引擎格點：64 × q = maxSL 本身
      assert.ok(Math.abs(64 * q - 25747) < 1e-6);
      // 舊公式的累積誤差場景：64 × 401.948 = 25724.67，差 22px（本 bug 的症狀）
      assert.ok(25747 - 64 * 401.948 > 20);
    });
    it('Chromium 幽靈欄場景：maxSL 含幽靈欄時量化出的 stride 仍是真值', () => {
      // probe 實測：Chromium scrollWidth 多報一欄，maxSL 29103 = 74 × 393.28
      // （內容實際 74 欄 = 73 格 + 幽靈 1 格）；量化分母 round(29103/393.282)
      // = 74 → 29103 / 74 = 393.28 仍等於引擎 stride，頁數誤差由
      // computePageCountFromExtent 處理，stride 不受幽靈欄污染
      const q = pagedApi.quantizeStride(29103, 393.282);
      assert.ok(Math.abs(q - 29103 / 74) < 1e-9);
      assert.ok(Math.abs(q - 393.28) < 0.01);
    });
    it('單頁（maxSL 0）/ 量不到 → 退回近似值', () => {
      assert.strictEqual(pagedApi.quantizeStride(0, 401.948), 401.948);
      assert.strictEqual(pagedApi.quantizeStride(100, 401.948), 401.948); // < 半格
    });
    it('退化輸入：近似值 0 / 負 / NaN 原樣回傳（caller fallback）', () => {
      assert.strictEqual(pagedApi.quantizeStride(25747, 0), 0);
      assert.strictEqual(pagedApi.quantizeStride(25747, -1), -1);
      assert.ok(Number.isNaN(pagedApi.quantizeStride(25747, NaN)));
    });
  });

  describe('computeScrubTarget（v0.8.150 頁碼 scrubber）', () => {
    const W = 393; // iPhone 視窗寬（scrubWidth = 拖曳走完此寬 = 全部頁範圍）
    it('從第 0 頁往右拖滿整個寬度 → 末頁（total-1）', () => {
      assert.strictEqual(pagedApi.computeScrubTarget(0, W, W, 43), 42);
    });
    it('從末頁往左拖滿整個寬度 → 第 0 頁', () => {
      assert.strictEqual(pagedApi.computeScrubTarget(42, -W, W, 43), 0);
    });
    it('往右拖半個寬度（從第 0 頁）→ 約中間頁（round）', () => {
      // (W/2 / W) * 42 = 21
      assert.strictEqual(pagedApi.computeScrubTarget(0, W / 2, W, 43), 21);
    });
    it('位移 0 → 維持起拖頁（不動）', () => {
      assert.strictEqual(pagedApi.computeScrubTarget(10, 0, W, 43), 10);
    });
    it('往右拖超過末頁 → clamp 在末頁（不溢出）', () => {
      assert.strictEqual(pagedApi.computeScrubTarget(40, W * 2, W, 43), 42);
    });
    it('往左拖超過第 0 頁 → clamp 在 0（不負）', () => {
      assert.strictEqual(pagedApi.computeScrubTarget(2, -W * 2, W, 43), 0);
    });
    it('單頁（total <= 1）→ 恆回 0（無頁可捲）', () => {
      assert.strictEqual(pagedApi.computeScrubTarget(0, W, W, 1), 0);
    });
    it('v0.8.152 靈敏度：few-page 文章每頁拖曳上限 14px（3 頁拖 14px 即換一頁）', () => {
      // 純全寬均分時 3 頁 = W/2 ≈ 196px/頁（要拖很遠）；上限 14px 讓它靈敏
      assert.strictEqual(pagedApi.computeScrubTarget(0, 14, W, 3), 1);
      assert.strictEqual(pagedApi.computeScrubTarget(0, 28, W, 3), 2);
      assert.strictEqual(pagedApi.computeScrubTarget(0, 7, W, 3), 1); // round(0.5)=1
      assert.strictEqual(pagedApi.computeScrubTarget(0, 6, W, 3), 0); // round(0.43)=0
    });
    it('v0.8.152 靈敏度：many-page 文章（均分 < 14px）維持拖滿全寬 ≈ 走完全文', () => {
      // total=43 → 均分 W/42 ≈ 9.4px < 14，上限不生效，拖滿全寬仍到末頁
      assert.strictEqual(pagedApi.computeScrubTarget(0, W, W, 43), 42);
      assert.strictEqual(pagedApi.computeScrubTarget(0, W / 2, W, 43), 21);
    });
    it('退化輸入（scrubWidth 0 / NaN dx / total 0）→ clamp 回起拖頁、不爆', () => {
      assert.strictEqual(pagedApi.computeScrubTarget(5, 100, 0, 43), 5);
      assert.strictEqual(pagedApi.computeScrubTarget(5, NaN, W, 43), 5);
      assert.strictEqual(pagedApi.computeScrubTarget(0, 100, W, 0), 0);
    });
  });

  // v0.8.166：頁碼 scrubber tap-to-arm 互動狀態機。一次手勢結束時依
  // （目前 armed 與否、本次有無拖移 moved）決定動作。Jimmy 2026-06-23 需求：
  //   1. 按住頁碼拖移 → 拖曳翻頁（短暫 scrub，放手收起）= 非 armed + moved → 'end'
  //   2. 點按頁碼放開 → 出現常駐進度條（armed）= 非 armed + !moved → 'arm'
  //      armed 中畫面任意處滑 = scrub 翻頁、armed 維持 = armed + moved → 'keep'
  //      再次點頁碼 = 收起 = armed + !moved → 'disarm'
  //   3. armed 中任意處點按 = 收起 = armed + !moved → 'disarm'（同 2 末項）
  describe('resolveScrubGesture（v0.8.166 tap-to-arm 狀態機）', () => {
    it('非 armed + 點按（!moved）→ arm（展開常駐進度條）', () => {
      assert.strictEqual(pagedApi.resolveScrubGesture(false, false), 'arm');
    });
    it('非 armed + 拖移（moved）→ end（按住拖曳翻頁，放手收起）', () => {
      assert.strictEqual(pagedApi.resolveScrubGesture(false, true), 'end');
    });
    it('armed + 拖移（moved）→ keep（畫面任意處滑翻頁，進度條續留）', () => {
      assert.strictEqual(pagedApi.resolveScrubGesture(true, true), 'keep');
    });
    it('armed + 點按（!moved）→ disarm（再次點頁碼 / 任意處點按收起）', () => {
      assert.strictEqual(pagedApi.resolveScrubGesture(true, false), 'disarm');
    });
    // forcing：四象限互斥且窮舉，狀態機不可漏接任一組合（漏接 = 進度條卡住收不起 /
    // 點按無反應）。改動回傳值映射時這四條同步校對 finishScrubGesture 的分支。
    it('四象限窮舉皆有定義動作（不回 undefined）', () => {
      for (const armed of [true, false]) {
        for (const moved of [true, false]) {
          const a = pagedApi.resolveScrubGesture(armed, moved);
          assert.ok(['arm', 'end', 'keep', 'disarm'].includes(a),
            `armed=${armed} moved=${moved} 必須回有效動作，得到 ${a}`);
        }
      }
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

  // v0.8.57：blockTouchDecision 第 5 參 hasSelection——作用中文字選取時無條件放行
  // （return false），讓 iOS 選取控制點（selection handle）能被拖曳。代理訊號 =
  // 存在非 collapse 選取；onTouchMove 對水平滑動 preventDefault 會把控制點拖曳一併
  // 擋掉（Jimmy 回報「選取段落時手指無法移動游標位置」）。
  describe('blockTouchDecision hasSelection 放行（v0.8.57 選取控制點拖曳）', () => {
    it('有選取 → false（即使第二頁起 / 已鎖 / 水平支配，都放行原生控制點拖曳）', () => {
      assert.strictEqual(pagedApi.blockTouchDecision(40, 5, 1, false, true), false);
      assert.strictEqual(pagedApi.blockTouchDecision(2, 80, 0, true, true), false);
      assert.strictEqual(pagedApi.blockTouchDecision(100, 100, 5, true, true), false);
    });
    it('無選取（hasSelection=false）→ 維持原決策（不影響既有翻頁攔截）', () => {
      assert.strictEqual(pagedApi.blockTouchDecision(40, 5, 1, false, false), true);
      assert.strictEqual(pagedApi.blockTouchDecision(2, 80, 0, false, false), false);
    });
    it('hasSelection 省略（4 參舊呼叫）→ 視為無選取，向後相容', () => {
      assert.strictEqual(pagedApi.blockTouchDecision(40, 5, 1, false), true);
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

    // ---- v1.0.2：翻譯頁外置標題在翻頁模式移進 articleEl（forcing function）----
    // 非翻頁時 cleaner 把翻譯頁主標題放 articleEl 外（data-jread-promoted-outside，
    // 避 Shinkansen guard reconcile）。翻頁模式 articleEl 變 fixed 滿版 multicol 容器、
    // 蓋住外置兄弟 → 標題看不到。install 須把外置標題移進 articleEl 開頭（multicol
    // 流內、出現在第 1 頁），uninstall 移回原位。jsdom 驗 DOM 搬移、不驗 layout。
    it('install：翻譯頁 promoted-outside 標題移進 articleEl 開頭', () => {
      const env = loadModuleEnv();
      const api = env.window.__JRead.pagedMode;
      const art = env.document.querySelector('article');
      const title = env.document.createElement('h2');
      title.setAttribute('data-jread-promoted-outside', '1');
      title.setAttribute('data-jread-title-clone', '1');
      title.textContent = '翻譯後的主標題';
      art.parentNode.insertBefore(title, art); // articleEl 前一個 sibling（cleaner 的放法）
      assert.strictEqual(title.nextElementSibling, art, '前置條件：標題是 articleEl 前一個 sibling');

      api.sync({ pagedMode: true }, art);
      assert.strictEqual(art.firstElementChild, title,
        'install 後外置標題必須變成 articleEl 第一個 child（進 multicol 流）');
      assert.ok(art.contains(title), '標題必須在 articleEl 內');
      api.uninstall();
    });

    it('uninstall：移進的標題移回 articleEl 外（前一個 sibling）', () => {
      const env = loadModuleEnv();
      const api = env.window.__JRead.pagedMode;
      const art = env.document.querySelector('article');
      const title = env.document.createElement('h2');
      title.setAttribute('data-jread-promoted-outside', '1');
      title.textContent = '翻譯後的主標題';
      art.parentNode.insertBefore(title, art);

      api.sync({ pagedMode: true }, art);
      api.sync({ pagedMode: false }, art); // uninstall
      assert.strictEqual(title.nextElementSibling, art,
        'uninstall 後標題必須移回 articleEl 前一個 sibling（還原非翻頁版面契約）');
      assert.ok(!art.contains(title), '標題不可再留在 articleEl 內');
    });

    it('install：無 promoted-outside 兄弟時不動 DOM（非翻譯頁不受影響）', () => {
      const env = loadModuleEnv();
      const api = env.window.__JRead.pagedMode;
      const art = env.document.querySelector('article');
      const firstBefore = art.firstElementChild;
      api.sync({ pagedMode: true }, art);
      assert.strictEqual(art.firstElementChild, firstBefore,
        '無外置標題時 install 不可改 articleEl 第一個 child');
      api.uninstall();
    });
  });

  // ---- C2. 頁碼指示一律顯示（v1.5.4，移除 showPageNumber 開關）----------------
  // v1.5.4：頁碼指示是翻頁模式唯一進度載體（v1.5.2 拿掉頂端進度條後），不再有開關
  // ——install 一律建指示器、忽略任何 showPageNumber 設定。setShowIndicator API 已移除。
  describe('頁碼指示一律顯示（v1.5.4）', () => {
    function loadModuleEnv() {
      const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: [], pretendToBeVisual: true });
      env.window.eval(PAGED_SRC);
      return env;
    }

    it('sync(pagedMode: true) → 頁碼指示器一律出現', () => {
      const env = loadModuleEnv();
      const api = env.window.__JRead.pagedMode;
      const art = env.document.querySelector('article');
      api.sync({ pagedMode: true }, art);
      assert.ok(env.document.getElementById('__jread-page-indicator'),
        'install 必建頁碼指示器（唯一進度載體）');
      api.uninstall();
    });

    it('殘留 showPageNumber: false 設定被忽略——指示器仍顯示（嚮後相容）', () => {
      const env = loadModuleEnv();
      const api = env.window.__JRead.pagedMode;
      const art = env.document.querySelector('article');
      // 舊使用者 storage 可能殘留 showPageNumber:false；v1.5.4 起一律忽略、仍顯示。
      api.sync({ pagedMode: true, showPageNumber: false }, art);
      assert.ok(env.document.getElementById('__jread-page-indicator'),
        '殘留 showPageNumber:false 不得再隱藏指示器（開關已移除）');
      api.uninstall();
    });

    it('setShowIndicator API 已移除（不再有頁碼開關）', () => {
      const env = loadModuleEnv();
      const api = env.window.__JRead.pagedMode;
      assert.strictEqual(typeof api.setShowIndicator, 'undefined',
        'setShowIndicator 不該再 export——forcing：頁碼開關復活 = 唯一進度載體可被關掉');
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

  // ---- C5. 頁碼 scrubber 拖曳（v0.8.150）---------------------------------
  // Jimmy 需求：翻頁模式下按住頁碼滑動 = 快速捲動頁面。修法：頁碼指示器當
  // scrubber，touchstart 起點命中指示器 → 進 scrub，touchmove 依水平位移即時跳頁
  // （computeScrubTarget 全 viewport 寬 = 全部頁範圍），touchend 停在預覽頁、不翻頁。
  // 訊號層次：驗「scrub 起/移/止」對 idx / 指示文字的影響 + scrub 中不誤判翻頁
  // swipe（jsdom 合成事件 + stub layout 讓頁數>1）。不驗真實 iOS 觸控/touch-action
  // 是否尊重 preventDefault（系統行為，只能真機驗）。
  describe('頁碼 scrubber 拖曳（v0.8.150）', () => {
    function loadInstalled() {
      const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: [], pretendToBeVisual: true });
      env.window.eval(PAGED_SRC);
      const api = env.window.__JRead.pagedMode;
      const art = env.document.querySelector('article');
      // jsdom 無 layout：stub 讓 pageCount = round(scrollWidth/stride) = 3
      Object.defineProperty(art, 'clientWidth', { value: 400, configurable: true });
      Object.defineProperty(art, 'scrollWidth', { value: 1200, configurable: true });
      api.sync({ pagedMode: true }, art);
      return { env, api };
    }
    function indicator(env) { return env.document.getElementById('__jread-page-indicator'); }
    function pageText(env) { const i = indicator(env); return i ? i.textContent : null; }
    // touchstart 派發在指定 target（scrub 靠 e.target 命中指示器才啟動）。
    // changed 預設同 touches；touchend 時 touches=[]（手指離開）、changed 帶最終位置。
    function fireTouchOn(env, target, type, touches, changed) {
      const ev = new env.window.Event(type, { bubbles: true, cancelable: true });
      ev.touches = touches;
      ev.changedTouches = changed || touches;
      target.dispatchEvent(ev);
    }

    it('按住頁碼往右拖滿整個寬度 → 跳到末頁（快速捲動）', () => {
      const { env, api } = loadInstalled();
      assert.strictEqual(pageText(env), '1 / 3', '初始第 1 頁');
      const ind = indicator(env);
      const W = env.window.innerWidth;
      fireTouchOn(env, ind, 'touchstart', [{ clientX: 10, clientY: 700 }]);
      fireTouchOn(env, env.window, 'touchmove', [{ clientX: 10 + W, clientY: 700 }]); // 右拖滿寬
      assert.strictEqual(pageText(env), '3 / 3', '拖滿整個寬度 → 末頁');
      fireTouchOn(env, env.window, 'touchend', []);
      assert.strictEqual(pageText(env), '3 / 3', 'touchend 停在預覽頁');
      assert.ok(!ind.classList.contains('__jread-scrubbing'), 'touchend 後移除 scrubbing class');
      api.uninstall();
    });

    it('拖到末頁後往左拖回起點 → 回第 1 頁（雙向）', () => {
      const { env, api } = loadInstalled();
      const ind = indicator(env);
      const W = env.window.innerWidth;
      fireTouchOn(env, ind, 'touchstart', [{ clientX: 200, clientY: 700 }]);
      fireTouchOn(env, env.window, 'touchmove', [{ clientX: 200 + W, clientY: 700 }]);
      assert.strictEqual(pageText(env), '3 / 3');
      fireTouchOn(env, env.window, 'touchmove', [{ clientX: 200, clientY: 700 }]); // 拖回起點 dx=0
      assert.strictEqual(pageText(env), '1 / 3', '拖回起點 → 回起拖頁');
      fireTouchOn(env, env.window, 'touchend', []);
      api.uninstall();
    });

    it('scrub 結束（dx=0 放手）不誤判翻頁 swipe（scrubState 攔截）', () => {
      const { env, api } = loadInstalled();
      const ind = indicator(env);
      // 在頁碼上原地按放（dx=0、不跳頁），不得因 touchend 走 classifySwipe 翻頁
      fireTouchOn(env, ind, 'touchstart', [{ clientX: 200, clientY: 700 }]);
      fireTouchOn(env, env.window, 'touchmove', [{ clientX: 200, clientY: 700 }]);
      fireTouchOn(env, env.window, 'touchend', [], [{ clientX: 200, clientY: 700 }]);
      assert.strictEqual(pageText(env), '1 / 3', 'scrub 路徑不走 swipe 翻頁、dx=0 不跳頁');
      api.uninstall();
    });

    it('touchstart 不在頁碼上 → 維持原翻頁 swipe（scrub 不誤啟動）', () => {
      const { env, api } = loadInstalled();
      // 在內文（非指示器）上左滑 → 翻下一頁（既有 swipe 行為不受 scrub 影響）
      fireTouchOn(env, env.window, 'touchstart', [{ clientX: 400, clientY: 300 }]);
      fireTouchOn(env, env.window, 'touchmove', [{ clientX: 300, clientY: 302 }]);
      fireTouchOn(env, env.window, 'touchend', [], [{ clientX: 300, clientY: 302 }]);
      assert.strictEqual(pageText(env), '2 / 3', '非指示器起點仍走 swipe 翻頁');
      api.uninstall();
    });

    it('桌面滑鼠：頁碼 mousedown + window mousemove 拖曳 → 跳頁', () => {
      const { env, api } = loadInstalled();
      const ind = indicator(env);
      const W = env.window.innerWidth;
      const md = new env.window.Event('mousedown', { bubbles: true, cancelable: true });
      md.button = 0; md.clientX = 10; md.clientY = 700;
      ind.dispatchEvent(md);
      const mm = new env.window.Event('mousemove', { bubbles: true, cancelable: true });
      mm.clientX = 10 + W; mm.clientY = 700;
      env.window.dispatchEvent(mm);
      assert.strictEqual(pageText(env), '3 / 3', '滑鼠右拖滿寬 → 末頁');
      const mu = new env.window.Event('mouseup', { bubbles: true, cancelable: true });
      env.window.dispatchEvent(mu);
      assert.ok(!ind.classList.contains('__jread-scrubbing'), 'mouseup 後移除 scrubbing class');
      api.uninstall();
    });

    // v0.8.151：按住起拖出現 scrub 進度條、fill 寬 = 目前頁占比；放手 / uninstall 清除
    it('按住頁碼起拖 → 出現 scrub 進度條，拖動時 fill 寬隨頁更新', () => {
      const { env, api } = loadInstalled();
      const W = env.window.innerWidth;
      fireTouchOn(env, indicator(env), 'touchstart', [{ clientX: 10, clientY: 700 }]);
      const fill = env.document.getElementById('__jread-scrub-fill');
      assert.ok(env.document.getElementById('__jread-scrub-track'), 'beginScrub 後須建立 scrub 進度條');
      assert.ok(fill, '須有 fill 子元素');
      assert.strictEqual(fill.style.width, '0%', '第一頁 fill = 0%');
      fireTouchOn(env, env.window, 'touchmove', [{ clientX: 10 + W, clientY: 700 }]); // 拖到末頁
      assert.strictEqual(fill.style.width, '100%', '末頁 fill = 100%');
      fireTouchOn(env, env.window, 'touchmove', [{ clientX: 10, clientY: 700 }]); // 拖回起點
      assert.strictEqual(fill.style.width, '0%', '拖回第一頁 fill = 0%');
      fireTouchOn(env, env.window, 'touchend', []);
      assert.ok(!env.document.getElementById('__jread-scrub-track').classList.contains('__jread-scrub-visible'),
        '放手後進度條淡出（移除 visible class）');
      api.uninstall();
      assert.strictEqual(env.document.getElementById('__jread-scrub-track'), null,
        'uninstall 後移除 scrub 進度條');
    });

    it('拖動跨頁觸發觸覺回饋（navigator.vibrate，與 switch 並行）', () => {
      const { env, api } = loadInstalled();
      let vibes = 0;
      Object.defineProperty(env.window.navigator, 'vibrate',
        { value: () => { vibes++; return true; }, configurable: true });
      const W = env.window.innerWidth;
      fireTouchOn(env, indicator(env), 'touchstart', [{ clientX: 10, clientY: 700 }]);
      fireTouchOn(env, env.window, 'touchmove', [{ clientX: 10 + W, clientY: 700 }]); // 0 → 末頁，跨頁
      assert.ok(vibes >= 1, '拖動跨頁必須觸發 navigator.vibrate');
      fireTouchOn(env, env.window, 'touchmove', [{ clientX: 10, clientY: 700 }]); // 同位置不跨頁
      assert.strictEqual(vibes, 2, '每次跨頁各觸發一次（末頁 → 回第一頁 = 第二次）');
      fireTouchOn(env, env.window, 'touchend', []);
      api.uninstall();
    });

    it('iOS switch haptic 載體：inline display:none + 掛 body + switch checkbox（v0.8.153 比照 ios-haptics）', () => {
      const { env, api } = loadInstalled();
      try { delete env.window.navigator.vibrate; } catch (e) { /* */ }
      const W = env.window.innerWidth;
      fireTouchOn(env, indicator(env), 'touchstart', [{ clientX: 10, clientY: 700 }]);
      fireTouchOn(env, env.window, 'touchmove', [{ clientX: 10 + W, clientY: 700 }]);
      const haptic = env.document.getElementById('__jread-haptic');
      assert.ok(haptic, '跨頁時須建立 switch haptic 載體');
      assert.ok(haptic.querySelector('input[type="checkbox"][switch]'),
        'haptic 載體須含 iOS 17.4+ switch checkbox');
      // v0.8.153 forcing：比照實證可動的 ios-haptics——inline display:none + 掛 body
      assert.strictEqual(haptic.style.display, 'none',
        'haptic 載體須 inline display:none（ios-haptics 證明 display:none 不影響觸覺）');
      assert.strictEqual(haptic.parentElement, env.document.body,
        'haptic 載體須掛 document.body（非 <html>）');
      fireTouchOn(env, env.window, 'touchend', []);
      api.uninstall();
      assert.strictEqual(env.document.getElementById('__jread-haptic'), null,
        'uninstall 後移除觸覺載體');
    });
  });

  // ---- C6. 頁碼 tap-to-arm 互動（v0.8.166）------------------------------
  // Jimmy 2026-06-23 需求（分頁模式點頁碼後的動作）：
  //   1. 按住頁碼拖移 → 拖曳翻頁（短暫 scrub，放手收起，= 既有 v0.8.150 行為）
  //   2. 點選頁碼後放開 → 出現常駐進度條（armed），此後畫面任意處左右滑 = scrub 翻頁，
  //      再次點頁碼收起進度條
  //   3. armed 中任意處點選 → 收起進度條
  // 訊號層次：jsdom 合成 touch 事件走真實 handler，以「一次手勢能跨幾頁」觀測 armed
  //   是否生效（armed → scrub 可多頁；非 armed → swipe 單頁）。不驗真實 iOS 觸控時序 /
  //   touch-action / 進度條 fade（rAF visible class）——需 TestFlight 實機驗。
  // tap 與 drag 的純狀態機另見上方 resolveScrubGesture describe。
  describe('頁碼 tap-to-arm 互動 DOM 流（v0.8.166）', () => {
    function loadInstalled() {
      const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: [], pretendToBeVisual: true });
      env.window.eval(PAGED_SRC);
      const api = env.window.__JRead.pagedMode;
      const art = env.document.querySelector('article');
      // jsdom 無 layout：stub 讓 pageCount = round(4000/400) = 10（多頁才看得出 scrub 跨多頁）
      Object.defineProperty(art, 'clientWidth', { value: 400, configurable: true });
      Object.defineProperty(art, 'scrollWidth', { value: 4000, configurable: true });
      api.sync({ pagedMode: true }, art);
      return { env, api, art };
    }
    function indicator(env) { return env.document.getElementById('__jread-page-indicator'); }
    function pageNum(env) { const i = indicator(env); return i ? parseInt(i.textContent, 10) : null; }
    function fireOn(env, target, type, touches, changed) {
      const ev = new env.window.Event(type, { bubbles: true, cancelable: true });
      ev.touches = touches;
      ev.changedTouches = changed || touches;
      target.dispatchEvent(ev);
    }
    // tap = down→up 無拖移（touchstart 在 target、touchend 無位移）
    function tapOn(env, target) {
      fireOn(env, target, 'touchstart', [{ clientX: 200, clientY: 500 }]);
      fireOn(env, env.window, 'touchend', [], [{ clientX: 200, clientY: 500 }]);
    }
    // 內文（非指示器）單頁翻頁 swipe（左滑 100px = next）
    function swipeNext(env) {
      fireOn(env, env.window, 'touchstart', [{ clientX: 400, clientY: 300 }]);
      fireOn(env, env.window, 'touchmove', [{ clientX: 300, clientY: 302 }]);
      fireOn(env, env.window, 'touchend', [], [{ clientX: 300, clientY: 302 }]);
    }

    it('req1：按住頁碼拖移 → 短暫 scrub 翻多頁、放手不進 armed（之後滑動仍單頁）', () => {
      const { env, api } = loadInstalled();
      // 頁碼上拖移（touchstart 命中指示器 + touchmove）→ scrub
      fireOn(env, indicator(env), 'touchstart', [{ clientX: 10, clientY: 500 }]);
      fireOn(env, env.window, 'touchmove', [{ clientX: 110, clientY: 502 }]); // 右拖 100px
      fireOn(env, env.window, 'touchend', []);
      const afterScrub = pageNum(env);
      assert.ok(afterScrub > 2, `按住頁碼拖移必須 scrub 多頁，得到第 ${afterScrub} 頁`);
      // 放手後非 armed：內文滑動只翻一頁
      swipeNext(env);
      assert.strictEqual(pageNum(env), afterScrub + 1, '頁碼拖移放手後非 armed，滑動恢復單頁翻頁');
      api.uninstall();
    });

    it('req2：點選頁碼放開 → 進 armed，此後畫面任意處滑 = scrub 多頁', () => {
      const { env, api } = loadInstalled();
      assert.strictEqual(pageNum(env), 1, '初始第 1 頁');
      tapOn(env, indicator(env)); // 點頁碼 → arm
      // 在內文（非指示器）右拖 100px → scrub 多頁（armed 前同位置同手勢只會單頁翻 / 不動）
      fireOn(env, env.window, 'touchstart', [{ clientX: 50, clientY: 300 }]);
      fireOn(env, env.window, 'touchmove', [{ clientX: 150, clientY: 302 }]); // 右拖 100px
      fireOn(env, env.window, 'touchend', []);
      assert.ok(pageNum(env) > 2, `armed 後畫面任意處滑必須 scrub 多頁，得到第 ${pageNum(env)} 頁`);
      api.uninstall();
    });

    it('req2 末項：再次點頁碼 → 收起 armed（滑動恢復單頁翻頁）', () => {
      const { env, api } = loadInstalled();
      tapOn(env, indicator(env)); // arm
      tapOn(env, indicator(env)); // 再次點頁碼 → disarm
      const before = pageNum(env);
      swipeNext(env);
      assert.strictEqual(pageNum(env), before + 1, '再次點頁碼 disarm 後滑動恢復單頁翻頁');
      api.uninstall();
    });

    it('req3：armed 中任意處點選 → 收起 armed（滑動恢復單頁翻頁）', () => {
      const { env, api } = loadInstalled();
      tapOn(env, indicator(env));      // arm
      tapOn(env, env.document.body);   // 任意處點按 → disarm
      const before = pageNum(env);
      swipeNext(env);
      assert.strictEqual(pageNum(env), before + 1, 'armed 任意處點按 disarm 後滑動恢復單頁翻頁');
      api.uninstall();
    });

    it('armed scrub（多頁手勢）後維持 armed，下一次任意處滑仍 scrub', () => {
      const { env, api } = loadInstalled();
      tapOn(env, indicator(env)); // arm
      // 第一次 armed scrub
      fireOn(env, env.window, 'touchstart', [{ clientX: 10, clientY: 300 }]);
      fireOn(env, env.window, 'touchmove', [{ clientX: 110, clientY: 302 }]);
      fireOn(env, env.window, 'touchend', []);
      const p1 = pageNum(env);
      assert.ok(p1 > 2, 'armed 第一次 scrub 多頁');
      // 第二次仍 scrub（armed 未因拖移而 disarm）→ 從 p1 再往後 scrub
      fireOn(env, env.window, 'touchstart', [{ clientX: 10, clientY: 300 }]);
      fireOn(env, env.window, 'touchmove', [{ clientX: 60, clientY: 302 }]); // 右拖 50px
      fireOn(env, env.window, 'touchend', []);
      assert.ok(pageNum(env) > p1, 'armed 維持 → 第二次滑動仍 scrub 前進');
      api.uninstall();
    });

    it('uninstall 重置 armed（重新 install 後滑動為單頁、不殘留 scrub 模式）', () => {
      const { env, api, art } = loadInstalled();
      tapOn(env, indicator(env)); // arm
      api.uninstall();
      Object.defineProperty(art, 'clientWidth', { value: 400, configurable: true });
      Object.defineProperty(art, 'scrollWidth', { value: 4000, configurable: true });
      api.sync({ pagedMode: true }, art); // 重新 install
      const before = pageNum(env);
      swipeNext(env);
      assert.strictEqual(pageNum(env), before + 1, 'uninstall 後 armed 須重置，滑動回單頁翻頁');
      api.uninstall();
    });
  });

  // ---- D. 跨檔字面值同步（forcing function）------------------------------
  describe('跨檔同步', () => {
    // v1.5.2：翻頁模式不再驅動頂端進度條（重複功能，底部頁碼已表進度；Jimmy
    // 2026-06-27）。進度條生命週期單一資料源回歸 styler.js——paged-mode.js 完全
    // 不碰它。下面三條鎖住「單一資料源 + paged gate」不回退。
    it('paged-mode.js 不可再引用頂端進度條（PROGRESS_ID / #__jread-progress 皆不出現）', () => {
      assert.doesNotMatch(PAGED_SRC, /PROGRESS_ID/,
        'paged-mode.js 不該再宣告或引用 PROGRESS_ID——forcing：回頭驅動進度條 = 翻頁模式重複功能復活');
      assert.doesNotMatch(PAGED_SRC, /__jread-progress/,
        'paged-mode.js 不該再出現 #__jread-progress 字面——進度條生命週期單一資料源在 styler.js');
    });

    it('styler.js 進度條注入必須 gate 在非翻頁模式（opts.pagedMode 時不注入並移除既有）', () => {
      // 抓進度條注入區塊：opts.pagedMode 分支須 remove 既有並把 progressEl 設 null
      const m = STYLER_SRC.match(/閱讀進度條[\s\S]*?onScrollProgress\(\);\s*\n\s*\}/);
      assert.ok(m, '抓不到 styler.js 進度條注入區塊');
      const block = m[0];
      assert.match(block, /if\s*\(\s*opts\.pagedMode\s*\)/,
        'styler 進度條注入必須以 opts.pagedMode 分流——forcing：翻頁模式仍注入 = 重複功能');
      assert.match(block, /getElementById\(PROGRESS_ID\)[\s\S]*?\.remove\(\)/,
        'opts.pagedMode 分支須移除既有進度條（scroll→paged reapply 不殘留）');
    });

    it('styler.js 翻頁卡片上緣用 PAGED_TOP_GUTTER（拿掉進度條後文章往上長）', () => {
      assert.match(STYLER_SRC, /const PAGED_TOP_GUTTER = '[^']+'/,
        'styler.js 必須宣告 PAGED_TOP_GUTTER');
      // 翻頁卡片 padding：上緣 = PAGED_TOP_GUTTER、下緣 = V_GUTTER（不對稱，下緣留給頁碼）
      assert.match(STYLER_SRC, /padding:\s*\$\{PAGED_TOP_GUTTER\}\s+0\s+\$\{V_GUTTER\}\s+\$\{H_GUTTER\}/,
        '翻頁卡片上緣 padding 必須是 PAGED_TOP_GUTTER、下緣 V_GUTTER——forcing：上緣改回 V_GUTTER = 沒利用騰出的區域');
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

    it('settings-defaults.js 不再有 showPageNumber（v1.5.4 開關移除）', () => {
      const sharedDefaults = require('../../jread/content/settings-defaults.js');
      assert.ok(!('showPageNumber' in sharedDefaults),
        'settings-defaults.js 不該再有 showPageNumber——forcing：頁碼開關設定復活 = 唯一進度載體可被關掉');
      assert.match(POPUP_SRC, /const DEFAULT_SETTINGS = window\.__JReadSettingsDefaults\b/,
        'popup.js DEFAULT_SETTINGS 必須取自 window.__JReadSettingsDefaults（單一資料源）');
    });

    it('popup 不再有頁碼指示 toggle（#page-number-cb / #page-number-row 移除）v1.5.4', () => {
      assert.ok(!POPUP_HTML.includes('id="page-number-cb"'), 'popup.html 不該再含頁碼指示 checkbox');
      assert.ok(!POPUP_HTML.includes('id="page-number-row"'), 'popup.html 不該再含頁碼指示 row');
      assert.ok(!/save\(\{\s*showPageNumber:/.test(POPUP_SRC), 'popup.js 不該再 save({ showPageNumber })');
      // .setting-row[hidden] 顯式規則仍需保留——auto-domain-row / latin-font-row 等仍用
      // [hidden] 屬性顯隱，沒這條 JS 設 .hidden=true 對 display:flex 的 setting-row 無效。
      assert.ok(
        /\.setting-row\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(POPUP_HTML),
        'popup.html 須保留 .setting-row[hidden] { display:none !important }（其他動態顯隱 row 仍依賴）');
    });
  });

  // ---- E. main.js wiring 結構順序 ----------------------------------------
  describe('main.js wiring', () => {
    it('storage.onChanged relevantKeys 含 pagedMode（即時切換走 reapply）', () => {
      const m = MAIN_SRC.match(/const relevantKeys = \[([^\]]+)\]/);
      assert.ok(m && m[1].includes("'pagedMode'"), 'relevantKeys 必須含 pagedMode');
    });

    it('main.js 不再引用 showPageNumber / setShowIndicator（v1.5.4 開關移除）', () => {
      assert.ok(!/showPageNumber/.test(MAIN_SRC),
        'main.js 不該再引用 showPageNumber——頁碼開關已移除');
      assert.ok(!/setShowIndicator/.test(MAIN_SRC),
        'main.js 不該再呼叫 setShowIndicator——該 API 已移除');
    });

    it('exitReaderModeImpl 必須 uninstall 翻頁模組 + resetPosition', () => {
      assert.ok(/NS\.pagedMode\.uninstall\(\)/.test(MAIN_SRC), '須呼叫 NS.pagedMode.uninstall()');
      assert.ok(/NS\.pagedMode\.resetPosition\(\)/.test(MAIN_SRC), '須呼叫 NS.pagedMode.resetPosition()');
    });

    // v0.8.37：三條 enter 路徑的共用收尾抽成 finalizeEnter（單一資料源）——
    // 順序合約改驗 finalizeEnter body
    it('finalizeEnter：captureScrollY 在 styler.apply 之前（overflow hidden 注入前捕捉）', () => {
      const enterBody = MAIN_SRC.slice(
        MAIN_SRC.indexOf('function finalizeEnter'),
        MAIN_SRC.indexOf('async function enterXThreadMode'));
      const cap = enterBody.indexOf('captureScrollY');
      const apply = enterBody.indexOf('NS.styler.apply');
      assert.ok(cap >= 0 && apply >= 0 && cap < apply,
        'captureScrollY 必須在 NS.styler.apply 之前呼叫');
    });

    it('finalizeEnter：syncPagedModeFromSettings 在 syncSpaceScrollFromSettings 之前、installKeyguard 之前', () => {
      const enterBody = MAIN_SRC.slice(
        MAIN_SRC.indexOf('function finalizeEnter'),
        MAIN_SRC.indexOf('async function enterXThreadMode'));
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
      // v0.8.36：generic path 抽成 enterGenericReaderMode（enter pipeline 容錯重構）
      // v0.8.37：模組同步收尾抽成 finalizeEnter——三路徑改驗「都走 finalizeEnter」
      // （單一資料源，結構上不可能再 drift），finalizeEnter 內部順序由上方
      // 兩條 it 看守。
      for (const fn of ['enterXThreadMode', 'enterFbPostMode', 'enterGenericReaderMode']) {
        const body = fnBody(fn);
        assert.ok(body.includes('return finalizeEnter(container, settings)'),
          `${fn} 必須走 finalizeEnter 共用收尾（模組同步 / keyguard / captureScrollY 單一資料源）`);
      }
      // captureScrollY：finalizeEnter（三路徑共用）+ onChanged reapply 共 2 處
      const capCalls = MAIN_SRC.match(/NS\.pagedMode\.captureScrollY\(\)/g) || [];
      assert.ok(capCalls.length >= 2,
        `captureScrollY 必須在 finalizeEnter + onChanged reapply 共 >= 2 處呼叫，實際 ${capCalls.length} 處`);
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

  // ---- F. 輸入/捲動 race 修法（v0.8.17 code review C10）---------------------
  // 這些是 module-state 耦合的 runtime 行為（onWheel/onResize/uninstall），純
  // jsdom 難以行為驗（依賴 performance.now / rAF / live layout）；以原始碼結構
  // forcing function 守住修法不被改回，runtime 由 --paged harness 覆蓋。
  describe('輸入/捲動 race 修法（v0.8.17）', () => {
    it('onWheel：方向反轉時先把 wheelAccum 歸零（防門檻變兩倍 / 殘留翻錯向）', () => {
      const m = PAGED_SRC.match(/function onWheel\(e\)\s*\{([\s\S]*?)\n {2}\}/);
      assert.ok(m, '抓不到 onWheel');
      assert.match(m[1], /Math\.sign\(d\)\s*!==\s*Math\.sign\(wheelAccum\)[\s\S]*?wheelAccum = 0/,
        'onWheel 必須在 delta 與累積方向相反時歸零 wheelAccum');
    });

    it('onResize：debounce 單一 pending rAF（取消前一個再排新的）', () => {
      assert.match(PAGED_SRC, /let resizeRaf =/, '必須宣告 resizeRaf handle');
      const m = PAGED_SRC.match(/function onResize\(\)\s*\{([\s\S]*?)\n {2}\}/);
      assert.ok(m, '抓不到 onResize');
      assert.match(m[1], /if \(resizeRaf\) cancelAnimationFrame\(resizeRaf\)/,
        'onResize 必須先取消前一個 pending rAF（旋轉連發 resize 不堆疊）');
      assert.match(m[1], /resizeRaf = requestAnimationFrame/,
        'onResize 必須把新 rAF 存進 resizeRaf');
    });

    it('uninstall：取消 pending resizeRaf + 消費後歸零 savedScrollY', () => {
      const m = PAGED_SRC.match(/function uninstall\(\)\s*\{([\s\S]*?)\n {2}\}/);
      assert.ok(m, '抓不到 uninstall');
      assert.match(m[1], /if \(resizeRaf\)\s*\{\s*cancelAnimationFrame\(resizeRaf\)/,
        'uninstall 必須取消 pending resizeRaf（避免離開後 rAF 仍跑）');
      assert.match(m[1], /savedScrollY = 0/,
        'uninstall 必須在消費 savedScrollY 後歸零（防殘留值誤捲）');
    });
  });
});
