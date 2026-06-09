// JRead — Space 段落焦點卷動 regression (v0.7.215 固定翻頁 → v0.7.216 段落焦點)
//
// Reader mode 下 Space / Shift+Space 推進「目前閱讀段落」焦點（左側 4px 主題
// 色指示條 #__jread-focus-bar），新焦點段落 top 超過 viewport 中線門檻才以
// rAF 動畫（450ms easeInOutCubic）卷動 viewport × settings.spaceScrollRatio%。
// 規格：Jimmy 2026-06-05 指定行為（Readwise Reader 截圖）+ cage 對
// read.readwise.io 實機逐 frame 量測（動畫 ~430–450ms、ease-in-out）。
//
// 本檔訊號層次（CLAUDE.md 工作流原則 3）：
//   驗 —— source 結構（handler guard、焦點/門檻邏輯存在、install/uninstall
//          wiring、設定欄位三檔同步、ease 數學正確性、styler CSS rule）
//   不驗 —— 真實瀏覽器的 keydown 事件流 / 指示條視覺位置 / rAF 動畫（content
//          script 在 isolated world，jsdom 摸不到；由 Playwright harness 補）

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
// v0.7.235：DEFAULT_SETTINGS 搬到 content/settings-defaults.js 單一資料源
const SHARED_SRC   = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'settings-defaults.js'), 'utf8');
const MAIN_SRC     = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'main.js'), 'utf8');
const MODULE_SRC   = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'space-scroll.js'), 'utf8');
const STYLER_SRC   = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'styler.js'), 'utf8');
const MANIFEST     = JSON.parse(fs.readFileSync(path.join(ROOT, 'jread', 'manifest.json'), 'utf8'));
const POPUP_JS     = fs.readFileSync(path.join(ROOT, 'jread', 'popup', 'popup.js'), 'utf8');
const OPTIONS_HTML = fs.readFileSync(path.join(ROOT, 'jread', 'options', 'options.html'), 'utf8');
const OPTIONS_JS   = fs.readFileSync(path.join(ROOT, 'jread', 'options', 'options.js'), 'utf8');

// 抓 function body（brace counting，function 內含巢狀 brace 也安全）
function extractFnBody(src, fnName) {
  const m = src.match(new RegExp('function\\s+' + fnName + '\\s*\\([^)]*\\)\\s*\\{'));
  if (!m) return null;
  const start = m.index + m[0].length;
  let balance = 1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') balance++;
    else if (src[i] === '}') {
      balance--;
      if (balance === 0) return src.slice(start, i);
    }
  }
  return null;
}

describe('space-scroll v0.7.216 — Space 段落焦點卷動（仿 Readwise Reader）', () => {

  describe('manifest content_scripts 註冊', () => {
    it('content/space-scroll.js 必須在 js 陣列內、且在 main.js 之前（main.js 引用 NS.spaceScroll）', () => {
      const js = MANIFEST.content_scripts[0].js;
      const moduleIdx = js.indexOf('content/space-scroll.js');
      const mainIdx = js.indexOf('content/main.js');
      assert.ok(moduleIdx >= 0, 'manifest 必須註冊 content/space-scroll.js——forcing：漏註冊 NS.spaceScroll undefined、功能整個不存在');
      assert.ok(moduleIdx < mainIdx, 'space-scroll.js 必須在 main.js 之前載入');
      const nsIdx = js.indexOf('content/namespace.js');
      assert.ok(moduleIdx > nsIdx, 'space-scroll.js 必須在 namespace.js 之後載入（依賴 NS）');
    });
  });

  describe('設定欄位三檔同步（spaceScrollRatio: 50）', () => {
    it('shared DEFAULT_SETTINGS 必須含 spaceScrollRatio: 50', () => {
      const m = SHARED_SRC.match(/const\s+DEFAULT_SETTINGS\s*=\s*\{([\s\S]*?)\};/);
      assert.ok(m, '能在 settings-defaults.js 找到 DEFAULT_SETTINGS');
      assert.match(m[1], /spaceScrollRatio\s*:\s*50\b/,
        'shared DEFAULT_SETTINGS 必須含 spaceScrollRatio: 50——forcing：欄位缺席 GET_SETTINGS 讀回 undefined、content script 雖有 fallback 但 storage migration 會不同步');
    });

    it('popup.js DEFAULT_SETTINGS 必須含 spaceScrollRatio: 50（storage.get default fallback）', () => {
      const m = POPUP_JS.match(/const\s+DEFAULT_SETTINGS\s*=\s*\{([\s\S]*?)\};/);
      assert.ok(m, '能在 popup.js 找到 DEFAULT_SETTINGS');
      assert.match(m[1], /spaceScrollRatio\s*:\s*50\b/,
        'popup.js DEFAULT_SETTINGS 必須含 spaceScrollRatio: 50——forcing：storage.get 缺 default 會讀回 undefined');
    });

    it('options.js DEFAULTS 必須含 spaceScrollRatio: 50', () => {
      const m = OPTIONS_JS.match(/const\s+DEFAULTS\s*=\s*\{([\s\S]*?)\};/);
      assert.ok(m, '能找到 options.js DEFAULTS');
      assert.match(m[1], /spaceScrollRatio\s*:\s*50\b/,
        'options.js DEFAULTS 必須含 spaceScrollRatio: 50——forcing：load 時讀回 undefined、number input 顯示空白');
    });
  });

  describe('options 設定 UI', () => {
    it('options.html 必須含 #spaceScrollRatio number input（min=0 支援停用 sentinel）', () => {
      const m = OPTIONS_HTML.match(/<input[^>]+id=["']spaceScrollRatio["'][^>]*>/);
      assert.ok(m, 'options.html 必須有 <input id="spaceScrollRatio">——forcing：UI 缺席使用者無法調整');
      assert.match(m[0], /type=["']number["']/, '必須是 number input');
      assert.match(m[0], /min=["']0["']/, 'min 必須是 0——0 = 停用 sentinel');
    });

    it('options.html desc 必須標注 0 = 停用 sentinel（UI 語意指引）', () => {
      const idx = OPTIONS_HTML.indexOf('Space 顯示門檻');
      assert.ok(idx >= 0, 'options.html 必須有「Space 顯示門檻」label');
      const block = OPTIONS_HTML.slice(idx, idx + 600);
      assert.match(block, /<strong>0 = 停用<\/strong>/,
        'desc 必須用 <strong> 標注 0 = 停用 sentinel——forcing：sentinel 值不標注使用者只能猜');
    });

    it("options.js fields 必須含 'spaceScrollRatio'（change 綁定）+ save() 必須 Number() 轉型", () => {
      assert.match(OPTIONS_JS, /'spaceScrollRatio'/,
        "options.js fields 陣列必須含 'spaceScrollRatio'——forcing：change 事件未綁定 = 調整後不存");
      assert.match(OPTIONS_JS, /spaceScrollRatio\s*:\s*Number\(\s*document\.getElementById\(\s*['"]spaceScrollRatio['"]\s*\)\.value\s*\)/,
        'save() 必須 Number() 轉型寫進 patch——forcing：number input .value 是字串、模組的 Number.isFinite guard 會拒收字串');
    });
  });

  describe('space-scroll.js spaceScrollHandler / shouldHandle guard', () => {
    const handlerBody = extractFnBody(MODULE_SRC, 'spaceScrollHandler');
    const guardBody = extractFnBody(MODULE_SRC, 'shouldHandle');

    it('必須宣告 spaceScrollHandler + shouldHandle function', () => {
      assert.ok(handlerBody, 'space-scroll.js 必須有 spaceScrollHandler function——forcing：缺 handler 等於整個功能不存在');
      assert.ok(guardBody, 'space-scroll.js 必須有 shouldHandle guard function');
    });

    it('handler 必須先過 shouldHandle 再 preventDefault + stopImmediatePropagation', () => {
      assert.match(handlerBody, /if\s*\(\s*!shouldHandle\s*\(\s*e\s*\)\s*\)\s*return/,
        'handler 必須 !shouldHandle(e) 早退——forcing：guard 沒接上 = 輸入框 / IME / 修飾鍵全被攔');
      assert.match(handlerBody, /e\.preventDefault\s*\(/,
        '必須 preventDefault——forcing：原生 space 跳卷會跟 rAF 動畫疊加、雙重卷動');
      assert.match(handlerBody, /e\.stopImmediatePropagation\s*\(/,
        '必須 stopImmediatePropagation——forcing：page JS 的 space handler（Gmail 等）仍會收到事件');
    });

    it('shouldHandle 必須放行 IME composition（e.isComposing 或 keyCode 229）', () => {
      assert.ok(/e\.isComposing/.test(guardBody) || /keyCode\s*===?\s*229/.test(guardBody),
        '必須放行 IME composition——forcing：中文輸入第一階段按空白選字會被搶走');
    });

    it('shouldHandle 必須放行 INPUT / TEXTAREA / contenteditable focus（打空白是正常輸入）', () => {
      assert.match(guardBody, /INPUT|TEXTAREA/,
        '必須放行 INPUT / TEXTAREA——forcing：使用者在搜尋框打空白會變成卷動');
      assert.match(guardBody, /isContentEditable|contenteditable/,
        '必須放行 contenteditable——forcing：rich editor 內打空白會變成卷動');
    });

    it('shouldHandle 必須擋 alt / ctrl / meta 修飾鍵；handler shift 決定方向', () => {
      assert.match(guardBody, /e\.altKey\s*\|\|\s*e\.ctrlKey\s*\|\|\s*e\.metaKey/,
        '必須擋 alt/ctrl/meta——forcing：OS / 瀏覽器組合鍵（如 alt+space）會被誤吞');
      assert.match(handlerBody, /e\.shiftKey\s*\?\s*-1\s*:\s*1/,
        'shiftKey 必須決定方向（-1 上一段 / 1 下一段）——forcing：Shift+Space 反向是規格核心');
    });

    it('shouldHandle 必須 guard ratio <= 0（停用 sentinel）早退、不攔事件', () => {
      assert.match(guardBody, /ratio\s*<=\s*0/,
        '必須 guard ratio <= 0 早退——forcing：0 = 停用時仍 preventDefault 會吃掉原生卷動、Space 完全失效');
    });
  });

  describe('space-scroll.js 段落焦點邏輯', () => {
    it('BLOCK_SEL 必須涵蓋段落級內容元素；清單以 li 為單位（不收 ul/ol 容器）', () => {
      const m = MODULE_SRC.match(/BLOCK_SEL\s*=\s*'([^']+)'/);
      assert.ok(m, '必須有 BLOCK_SEL 常數');
      for (const tag of ['p', 'h2', 'li', 'blockquote', 'figure', 'pre']) {
        assert.ok(new RegExp(`(^|,\\s*)${tag}(\\s*,|$)`).test(m[1]), `BLOCK_SEL 必須含 ${tag}`);
      }
      // Jimmy 2026-06-05 訂正：newsletter ol 的每個 li 是完整段落，整個 ol 當
      // 一段會讓 Space 一次跳過三大段。收 li、不收 ul/ol 容器（收了容器 li 會
      // 被 nesting filter 當巢狀濾掉、退化回整列一段）。
      for (const tag of ['ul', 'ol']) {
        assert.ok(!new RegExp(`(^|,\\s*)${tag}(\\s*,|$)`).test(m[1]),
          `BLOCK_SEL 不可含 ${tag}（容器收了會把 li 濾成巢狀、清單退化回一段）`);
      }
    });

    it('collectBlocks 必須排除 cleaner 隱藏節點 + 巢狀 block 取最外層 + 零高度元素', () => {
      const body = extractFnBody(MODULE_SRC, 'collectBlocks');
      assert.ok(body, '必須有 collectBlocks function');
      assert.match(body, /data-jread-hidden/,
        '必須排除 data-jread-hidden 子樹——forcing：焦點會跳到 cleaner 已隱藏的雜訊段落、指示條貼在看不見的元素上');
      assert.match(body, /parentElement[\s\S]*closest\s*\(\s*BLOCK_SEL\s*\)/,
        '必須過濾巢狀 block（取最外層）——forcing：blockquote > p 會被當兩段、按一次只前進到內層');
      assert.match(body, /r\.height\s*<\s*\d/,
        '必須排除零高度（display:none / 空段落）——forcing：焦點卡在不可見元素、按 Space 視覺上無反應');
    });

    it('顯示門檻 = viewport × ratio%（options 設定）：門檻內不卷動', () => {
      const body = extractFnBody(MODULE_SRC, 'maybeScroll');
      assert.ok(body, '必須有 maybeScroll function');
      assert.match(body, /threshold\s*=\s*vh\s*\*\s*ratio\s*\/\s*100/,
        '門檻必須 = viewport × ratio / 100——forcing：寫死門檻 options 設定形同虛設');
      assert.match(body, /r\.top\s*<=\s*threshold[\s\S]*?return/,
        'maybeScroll 往下分支必須在 top <= 門檻時 return 不卷——forcing：每按必卷就退化回固定翻頁');
    });

    it('卷動採「卷到落點」模型：delta = r.top - rest、落點不高於門檻', () => {
      // Jimmy 2026-06-05 訂正：固定卷距會讓焦點段落停在頁面底部（卷 50% 不足
      // 以把深處段落帶回門檻內）。卷到落點保證卷完一定在門檻內。
      assert.match(MODULE_SRC, /REST_FRACTION\s*=\s*0\.1\b/,
        '必須有 REST_FRACTION = 0.1 落點常數');
      const body = extractFnBody(MODULE_SRC, 'maybeScroll');
      assert.match(body, /rest\s*=\s*Math\.min\s*\(\s*vh\s*\*\s*REST_FRACTION\s*,\s*threshold\s*\)/,
        '落點必須 Math.min(REST, threshold)——forcing：極小 ratio 設定時落點高於門檻、卷完仍判定超標、每按必卷');
      assert.match(body, /startSpaceScrollAnim\s*\(\s*r\.top\s*-\s*rest\s*\)/,
        '卷距必須 = r.top - rest（段落相依、雙向通用）——forcing：固定卷距會讓深處段落卷不回門檻內（指示條停頁面底部，Jimmy 截圖實證）');
    });

    it('advance 必須處理焦點 resync（offscreen / 被 SPA 移除 → 重新錨定可視區第一段）', () => {
      const body = extractFnBody(MODULE_SRC, 'advance');
      assert.ok(body, '必須有 advance function');
      assert.match(body, /isConnected/,
        '必須檢查 focusedBlock.isConnected——forcing：SPA 移除焦點塊後 advance 對 detached 元素量 rect 全 0、行為錯亂');
      assert.match(body, /firstVisibleBlock/,
        '必須 fallback 到 firstVisibleBlock 重新錨定——forcing：手動卷遠後按 Space 指示條在畫面外亂跳');
    });

    it('點擊段落必須把焦點移到該段（onClickFocus，Jimmy 2026-06-05 指定）', () => {
      const body = extractFnBody(MODULE_SRC, 'onClickFocus');
      assert.ok(body, '必須有 onClickFocus function');
      assert.match(body, /articleEl\.contains\s*\(\s*t\s*\)/,
        '必須 guard 點擊目標在 articleEl 內——forcing：點 reader card 外（popup / 原站殘留）也搬焦點');
      assert.match(body, /data-jread-hidden/,
        '必須排除 cleaner 隱藏子樹');
      assert.match(body, /collectBlocks\s*\(\s*\)[\s\S]*setFocus/,
        '歸屬解析必須直接對 collectBlocks() 結果找（單一資料源）——forcing：另寫一套 closest 規則會跟 li / 圖庫拆圖邏輯 drift');
      assert.ok(!/preventDefault|stopPropagation/.test(body),
        'onClickFocus 不可 preventDefault / stopPropagation——forcing：攔了會弄壞連結點擊與文字選取');
    });

    it('照片以每張為單位：圖庫容器讓位、未被覆蓋的內容圖獨立成單位', () => {
      // Jimmy 2026-06-05 訂正（截圖：兩張賽車照被當一個單位）
      const gal = extractFnBody(MODULE_SRC, 'isMediaGallery');
      assert.ok(gal, '必須有 isMediaGallery function');
      assert.match(gal, /figcaption/,
        'isMediaGallery 正文長度計算必須扣掉 figcaption——forcing：兩張附長圖說的照片會被誤判成文字段落、不拆');
      assert.match(MODULE_SRC, /MEDIA_MIN_HEIGHT\s*=\s*40\b/,
        '必須有 MEDIA_MIN_HEIGHT = 40——forcing：emoji / icon 等 inline 小圖會被當成焦點段落');
      const cb = extractFnBody(MODULE_SRC, 'collectBlocks');
      assert.match(cb, /isMediaGallery\s*\(\s*el\s*\)/,
        'collectBlocks 必須對一般 block 跑 isMediaGallery 排除圖庫容器——forcing：兩張照片被當一個單位（Jimmy 截圖實證）');
      assert.match(cb, /querySelectorAll\s*\(\s*'img, video'\s*\)/,
        'collectBlocks 必須收未被覆蓋的 img / video——forcing：圖庫容器排除後圖片全數漏失');
      assert.match(cb, /compareDocumentPosition/,
        '兩個來源合併後必須依文件順序排序——forcing：焦點推進順序跳脫閱讀順序');
    });

    it('install / uninstall 必須掛 / 拆 click capture listener', () => {
      const installBody = extractFnBody(MODULE_SRC, 'install');
      assert.match(installBody, /addEventListener\s*\(\s*['"]click['"]\s*,\s*onClickFocus\s*,\s*true\s*\)/,
        'install 必須 capture phase 掛 click → onClickFocus');
      const uninstallBody = extractFnBody(MODULE_SRC, 'uninstall');
      assert.match(uninstallBody, /removeEventListener\s*\(\s*['"]click['"]\s*,\s*onClickFocus\s*,\s*true\s*\)/,
        'uninstall 必須拆 click listener——forcing：退出 reader mode 後點擊仍搬（已 remove 的）焦點狀態');
    });

    it('指示條左錨點：必須固定在 articleEl 左緣（水平位置恆定、不跟 block 漂移）', () => {
      // Jimmy 2026-06-05 兩輪訂正：(a) bar 用 li.left 定位會壓在「2.」編號上；
      // (b) 跟個別 block 左緣會讓置中圖片把 bar 拉到頁面中間。固定錨 articleEl
      // 左緣一次解決兩者。
      const body = extractFnBody(MODULE_SRC, 'barAnchorLeft');
      assert.ok(body, '必須有 barAnchorLeft function');
      assert.match(body, /articleEl[\s\S]*getBoundingClientRect/,
        'barAnchorLeft 必須以 articleEl 左緣為錨——forcing：跟 block 左緣會讓置中圖片 / 縮排元素把指示條拉離欄位左側漂移');
      assert.ok(!/block/.test(body),
        'barAnchorLeft 不可引用 block——水平位置必須與焦點 block 無關');
      const posBody = extractFnBody(MODULE_SRC, 'positionBar');
      assert.match(posBody, /barAnchorLeft\s*\(\s*\)/,
        'positionBar 必須走 barAnchorLeft 取左錨點');
    });

    it('單頁文章不顯示指示條（Jimmy 2026-06-09）：isSinglePage 判定 + setFocus 早退移除 bar', () => {
      // 整篇文章在 viewport 內裝得下、不需捲動時，段落焦點指示條只是視覺雜訊
      // （X 短推文 / 短文章常見）——setFocus 必須在單頁時移除 bar 不顯示。
      const single = extractFnBody(MODULE_SRC, 'isSinglePage');
      assert.ok(single, '必須有 isSinglePage function——forcing：無單頁判定則短文章仍顯示指示條');
      assert.match(single, /scrollHeight\s*<=\s*window\.innerHeight/,
        'isSinglePage 必須以 scrollHeight <= innerHeight 判定不需捲動——forcing：判定基礎錯會誤把多頁當單頁、指示條整個消失');
      const setFocusBody = extractFnBody(MODULE_SRC, 'setFocus');
      assert.ok(setFocusBody, '必須有 setFocus function');
      assert.match(setFocusBody, /isSinglePage\s*\(\s*\)/,
        'setFocus 必須呼叫 isSinglePage——forcing：沒接上判定 = 單頁仍顯示指示條（X 短推文 Jimmy 截圖實證）');
      assert.match(setFocusBody, /isSinglePage\s*\(\s*\)[\s\S]*barEl\.remove\s*\(/,
        'setFocus 單頁分支必須 remove barEl 再 return——forcing：只 return 不移除會讓 resize 由多頁變單頁時殘留 bar');
      // onResize 必須重走 setFocus（而非直接 positionBar）才能在單頁↔多頁互換時更新顯示
      const resizeBody = extractFnBody(MODULE_SRC, 'onResize');
      assert.match(resizeBody, /setFocus\s*\(/,
        'onResize 必須重走 setFocus——forcing：直接 positionBar 不會重評單頁判定、resize 改變視窗高度時指示條不跟著出現/消失');
    });

    it('焦點指示條：BAR_ID 必須是 __jread-focus-bar、掛 <html> 直下（逃過 body 內隱藏規則）', () => {
      assert.match(MODULE_SRC, /BAR_ID\s*=\s*'__jread-focus-bar'/,
        'BAR_ID 必須是 __jread-focus-bar（styler CSS rule 對應 id）');
      const body = extractFnBody(MODULE_SRC, 'ensureBar');
      assert.ok(body, '必須有 ensureBar function');
      assert.match(body, /head[\s\S]*parentElement|documentElement/,
        '指示條必須掛 <html> 直下——forcing：掛 body 內會被 styler 的非主文鏈隱藏規則藏掉（v0.7.215 probe input 同坑）');
    });
  });

  describe('styler.js v0.7.91 onSpaceScroll 讓位 guard（雙重卷動根因）', () => {
    // 2026-06-05 Playwright probe 抓到 828px 幽靈卷動：styler 的 onSpaceScroll
    // （SPACE = scrollBy 92% viewport，v0.7.91）在 styler.apply 註冊、早於
    // space-scroll 模組、不看 defaultPrevented——兩條 path 對同一個 SPACE 各卷
    // 各的（單一資料源原則違反的實證）。修法：onSpaceScroll 開頭檢查
    // NS.spaceScroll.isInstalled() 讓位；ratio = 0 停用模組時舊行為自動回歸。
    it('onSpaceScroll 必須在開頭對 NS.spaceScroll.isInstalled() 讓位', () => {
      const body = extractFnBody(STYLER_SRC, 'onSpaceScroll');
      assert.ok(body, 'styler.js 必須有 onSpaceScroll function（v0.7.91 fallback，ratio=0 時的整頁卷動）');
      const guardIdx = body.search(/NS\.spaceScroll[\s\S]{0,60}isInstalled/);
      assert.ok(guardIdx >= 0,
        'onSpaceScroll 必須檢查 NS.spaceScroll.isInstalled() 讓位——forcing：兩條 path 同時處理 SPACE = 段落推進 + 92% scrollBy 疊加雙重卷動（2026-06-05 probe 實證）');
      // 找實際 call（window.scrollBy）——註解文字裡也有「scrollBy」字樣，不可誤抓
      const scrollIdx = body.indexOf('window.scrollBy');
      assert.ok(scrollIdx >= 0, 'onSpaceScroll 必須有 window.scrollBy call');
      assert.ok(guardIdx < scrollIdx, '讓位 guard 必須在 window.scrollBy 之前');
    });
  });

  describe('styler.js 指示條 CSS rule（單一資料源：theme.progressBar 色）', () => {
    it('styler 注入的 stylesheet 必須含 #__jread-focus-bar rule、用 theme.progressBar 色', () => {
      // rule body 內含 ${theme.progressBar} 的 `}`，non-greedy 到單一 `}` 會被
      // 截斷——改抓到行首的 `}`（CSS rule 閉合慣例）
      const m = STYLER_SRC.match(/#__jread-focus-bar\s*\{([\s\S]*?)\n\}/);
      assert.ok(m, 'styler.js 必須有 #__jread-focus-bar CSS rule——forcing：指示條無樣式 = 0×0 透明、視覺上不存在');
      const body = m[1];
      assert.match(body, /\$\{theme\.progressBar\}/,
        '指示條必須用 ${theme.progressBar}——forcing：寫死色票會跟 #__jread-progress drift、主題切換不跟色（單一資料源原則）');
      assert.match(body, /position:\s*absolute/,
        '必須 position: absolute（文件座標）——forcing：fixed 會在卷動時不跟段落走');
      assert.match(body, /pointer-events:\s*none/,
        '必須 pointer-events: none——forcing：指示條會擋到主文左緣的文字選取');
    });
  });

  describe('space-scroll.js 動畫實作', () => {
    it('ease 函式必須是 easeInOutCubic（實測 Readwise 軌跡：慢→快→慢對稱 S 曲線）', () => {
      const easeBody = extractFnBody(MODULE_SRC, 'spaceScrollEase');
      assert.ok(easeBody, '必須有 spaceScrollEase function');
      // eslint-disable-next-line no-new-func
      const ease = new Function('p', 'return (' + easeBody.replace(/^\s*return\s*/, '').replace(/;\s*$/, '') + ');');
      assert.strictEqual(ease(0), 0, 'ease(0) 必須 = 0');
      assert.strictEqual(ease(1), 1, 'ease(1) 必須 = 1');
      assert.strictEqual(ease(0.5), 0.5, 'ease(0.5) 必須 = 0.5（對稱中點）');
      for (const p of [0.1, 0.25, 0.4]) {
        assert.ok(Math.abs(ease(p) + ease(1 - p) - 1) < 1e-9, `ease 必須對稱（p=${p}）`);
      }
      assert.ok(ease(0.1) < 0.1, 'ease-in 慢起步：ease(0.1) < 0.1');
    });

    it('動畫時長必須 450ms（實測 Readwise ~430–450ms）', () => {
      assert.match(MODULE_SRC, /SPACE_SCROLL_DURATION_MS\s*=\s*450\b/,
        '動畫時長常數必須 450——forcing：時長亂改會偏離實測手感規格');
    });

    it('卷動目標必須 clamp 在 [0, scrollHeight - viewport]', () => {
      const animBody = extractFnBody(MODULE_SRC, 'startSpaceScrollAnim');
      assert.ok(animBody, '必須有 startSpaceScrollAnim function');
      assert.match(animBody, /Math\.max\s*\(\s*0\s*,\s*Math\.min\s*\(/,
        '目標位置必須 Math.max(0, Math.min(max, ...)) clamp——forcing：頂/底邊界 overscroll');
    });

    it('wheel / touchmove 必須取消進行中動畫（使用者手動介入優先）', () => {
      const installBody = extractFnBody(MODULE_SRC, 'install');
      assert.ok(installBody, '必須有 install function');
      assert.match(installBody, /addEventListener\s*\(\s*['"]wheel['"]\s*,\s*cancelSpaceScrollAnim/,
        'install 必須掛 wheel → cancelSpaceScrollAnim——forcing：動畫每 frame 覆寫 scrollTop、會跟使用者滾輪打架 450ms');
      assert.match(installBody, /addEventListener\s*\(\s*['"]touchmove['"]\s*,\s*cancelSpaceScrollAnim/,
        'install 必須掛 touchmove → cancelSpaceScrollAnim');
    });
  });

  describe('install / uninstall wiring（space-scroll.js + main.js）', () => {
    it('install 必須 capture phase 註冊 keydown', () => {
      const installBody = extractFnBody(MODULE_SRC, 'install');
      assert.match(installBody, /addEventListener\s*\(\s*['"]keydown['"]\s*,\s*spaceScrollHandler\s*,\s*true\s*\)/,
        '必須 capture phase（第三參 true）——forcing：bubble phase 晚於頁面 capture listener、preventDefault 前事件已被原站消費');
    });

    it('uninstall 必須移除指示條 + 取消進行中動畫 + 清焦點狀態', () => {
      const body = extractFnBody(MODULE_SRC, 'uninstall');
      assert.ok(body, '必須有 uninstall function');
      assert.match(body, /cancelSpaceScrollAnim\s*\(/,
        'uninstall 必須 cancelSpaceScrollAnim——forcing：退出 reader mode 瞬間動畫殘留、繼續覆寫 scrollTop 450ms');
      assert.match(body, /barEl\.remove\s*\(/,
        'uninstall 必須移除指示條元素——forcing：退出後藍色 bar 殘留在原頁面上');
      assert.match(body, /focusedBlock\s*=\s*null/,
        'uninstall 必須清焦點狀態——forcing：重進 reader mode 殘留舊文章的焦點引用');
    });

    it('sync 對缺欄位 / null settings 必須 fallback 50', () => {
      const body = extractFnBody(MODULE_SRC, 'sync');
      assert.ok(body, '必須有 sync function');
      assert.match(body, /Number\.isFinite/,
        '必須 Number.isFinite guard——forcing：升版舊 storage 缺欄位讀回 undefined、Number(undefined)=NaN 會讓比較全 false、功能 silently 失效');
      assert.match(body, /:\s*50\b/, 'fallback 預設必須 50');
    });

    it('main.js wrapper 必須維持「先於 keyguard」順序 invariant（sync 後新 install 且 keyguard 已掛則重掛）', () => {
      const body = extractFnBody(MAIN_SRC, 'syncSpaceScrollFromSettings');
      assert.ok(body, 'main.js 必須有 syncSpaceScrollFromSettings wrapper');
      assert.match(body, /NS\.spaceScroll\.sync\s*\(/,
        'wrapper 必須委派 NS.spaceScroll.sync——forcing：main.js 沒接模組 = 功能不啟動');
      assert.match(body, /keyguardInstalled/,
        'wrapper 必須檢查 keyguardInstalled 並重掛——forcing：onChanged 把 ratio 從 0 動態改回正值時，spaceScrollHandler 排在 keyguard 後面、被 stopImmediatePropagation 吃掉');
    });

    it('三條 enter 路徑（一般 / X thread / FB post）都必須呼叫 syncSpaceScrollFromSettings', () => {
      // 帶分號的 call site——不帶分號會誤匹配 function 宣告自身
      const calls = MAIN_SRC.match(/syncSpaceScrollFromSettings\s*\(\s*settings\s*\)\s*;/g) || [];
      assert.ok(calls.length >= 3,
        `enterReaderModeImpl / enterXThreadMode / enterFbPostMode 三條路徑都必須呼叫 syncSpaceScrollFromSettings(settings)，實際 ${calls.length} 處——forcing：漏一條該模式下 Space 卷動失效`);
    });

    it('enter 路徑內 syncSpaceScrollFromSettings 必須在 installKeyguard 之前', () => {
      const re = /syncSpaceScrollFromSettings\s*\(\s*settings\s*\)\s*;/g;
      let m;
      let checked = 0;
      while ((m = re.exec(MAIN_SRC)) !== null) {
        const after = MAIN_SRC.slice(m.index, m.index + 600);
        assert.match(after, /installKeyguard\s*\(/,
          'syncSpaceScrollFromSettings 之後必須接 installKeyguard（同路徑、後註冊）——forcing：順序反了 Space 事件先被 keyguard stopImmediatePropagation');
        checked++;
      }
      assert.ok(checked >= 3, '至少檢查三個 call site');
    });

    it('exitReaderMode 必須無條件呼叫 NS.spaceScroll.uninstall', () => {
      const idx = MAIN_SRC.search(/function\s+exitReaderModeImpl/);
      assert.ok(idx >= 0);
      const slice = MAIN_SRC.slice(idx, idx + 1200);
      assert.match(slice, /NS\.spaceScroll[\s\S]{0,40}\.uninstall\s*\(/,
        'exitReaderModeImpl 必須 NS.spaceScroll.uninstall——forcing：退出後 Space 仍被攔截 + 指示條殘留原頁面');
    });

    it('storage.onChanged 必須處理 spaceScrollRatio 動態切換', () => {
      const m = MAIN_SRC.match(/chrome\.storage\.onChanged\.addListener\(([\s\S]*?)\n\s\s\}\)\s*;/);
      assert.ok(m, '能抓到 storage.onChanged listener body');
      assert.match(m[0], /spaceScrollRatio/,
        'storage.onChanged 必須處理 spaceScrollRatio 變更——forcing：options 調整後不能即時生效、得退出/重進 reader mode');
    });
  });
});
