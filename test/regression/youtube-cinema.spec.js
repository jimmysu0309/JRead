// JRead — YouTube Cinema Mode regression (v0.7.133)
//
// 動機：YouTube watch page 沒主文可閱讀（detector 預設 no-op、popup 顯示
// 「此頁面無法啟動閱讀模式」）。改提供「影院模式」：detector 在 YouTube watch
// 短路 → main 走 NS.cinema.enter() → 注入 CSS 把 #movie_player 釘 viewport 中央、
// 隱藏 masthead / 推薦 / 留言 / 描述 / 浮層、黑底鋪滿。popup 偵測站點為
// youtube-cinema 時把 toggle 按鈕文字改為「啟動 / 退出影院模式」。
//
// 假設驗證順序見 CLAUDE.md。本 feature 的 layout / player 控制 / SPA 切影片
// 已由 chrome-in-chrome probe 在真實 YouTube watch page 驗過（2026-05-18），
// 本 spec 是 forcing function 而非假設探索工具，覆蓋:
//   1. cinema-mode.js 模組結構（NS.cinema.{isYouTubeWatch, enter, exit, isActive, ...}）
//   2. isYouTubeWatch URL 判斷（www / m / no-www / 子路徑 / shorts / 非 youtube）
//   3. enter / exit / isActive 行為（style 注入、移除、attribute 同步）
//   4. detector.js detect() 開頭的 isYouTubeCinema 短路
//   5. main.js enterReaderMode / exitReaderMode / extractReaderPayload / GET_READER_STATE
//      支援 cinemaActive 分支與 siteMode 回報
//   6. popup.js refreshPopupForActiveTab + 影院模式按鈕文字
//   7. manifest.json content_scripts.js 載入順序（namespace → cinema-mode → detector）
//   8. namespace.js state.cinemaActive 預設值與 NS.cinema 佔位

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const CINEMA_SRC   = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'cinema-mode.js'), 'utf8');
const NAMESPACE_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'namespace.js'), 'utf8');
const DETECTOR_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'detector.js'), 'utf8');
const MAIN_SRC     = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'main.js'), 'utf8');
const POPUP_JS     = fs.readFileSync(path.join(ROOT, 'jread', 'popup', 'popup.js'), 'utf8');
const MANIFEST     = JSON.parse(fs.readFileSync(path.join(ROOT, 'jread', 'manifest.json'), 'utf8'));

// 建立一個帶 url 的 JSDOM 環境，eval namespace.js + cinema-mode.js（+ detector.js
// 視需要）。chrome.runtime.getManifest 要 stub，否則 namespace.js 取版本號會炸。
function setupJsdom(url, extraScripts = []) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url,
    runScripts: 'outside-only'
  });
  const { window } = dom;
  // stub chrome.runtime.getManifest（namespace.js 用來取 version）
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.7.133' })
    }
  };
  window.eval(NAMESPACE_SRC);
  window.eval(CINEMA_SRC);
  for (const src of extraScripts) {
    window.eval(src);
  }
  return { window, document: window.document, NS: window.__JRead };
}

describe('cinema-mode v0.7.133 — module structure', () => {
  it('cinema-mode.js 必須宣告 isYouTubeWatch / enter / exit / isActive', () => {
    assert.match(CINEMA_SRC, /function\s+isYouTubeWatch\s*\(/,
      'cinema-mode.js 缺 isYouTubeWatch function——這是 popup / detector / main 共用的站點判斷');
    assert.match(CINEMA_SRC, /function\s+enter\s*\(/,
      'cinema-mode.js 缺 enter function');
    assert.match(CINEMA_SRC, /function\s+exit\s*\(/,
      'cinema-mode.js 缺 exit function');
    assert.match(CINEMA_SRC, /function\s+isActive\s*\(/,
      'cinema-mode.js 缺 isActive function');
  });

  it('cinema-mode.js 必須 export NS.cinema 物件，含 enter / exit / isYouTubeWatch / STYLE_ID / ACTIVE_ATTR', () => {
    assert.match(CINEMA_SRC, /NS\.cinema\s*=\s*\{[\s\S]*enter[\s\S]*exit[\s\S]*isYouTubeWatch[\s\S]*\}/,
      'NS.cinema 必須暴露 enter / exit / isYouTubeWatch（main.js / detector.js / popup.js 依賴）');
    assert.match(CINEMA_SRC, /STYLE_ID\s*=\s*['"]__jread_cinema_style['"]/,
      'STYLE_ID 常數必須是 __jread_cinema_style——spec 與 source 雙邊綁定，改一邊另一邊立刻 fail');
    assert.match(CINEMA_SRC, /ACTIVE_ATTR\s*=\s*['"]data-jread-cinema-active['"]/,
      'ACTIVE_ATTR 常數必須是 data-jread-cinema-active');
  });

  it('cinema-mode.js 必須包含 yt-navigate-finish listener 註冊（SPA 切影片必備）', () => {
    assert.match(CINEMA_SRC, /yt-navigate-finish/,
      'cinema-mode.js 缺 yt-navigate-finish listener——YouTube SPA 切影片不 reload、不重套會讓新影片 layout 沒被觸發 resize');
  });

  it('cinema-mode.js enter() 必須 dispatch resize event（YouTube 內部會根據 resize 重算 video 的 inline width/height）', () => {
    // probe Step 1 v2 踩過：沒 dispatch resize 時 video.height = 0、畫面全黑
    assert.match(CINEMA_SRC, /dispatchEvent\(\s*new\s+Event\(\s*['"]resize['"]/,
      'enter() / onYtNavigate 必須 dispatch resize event');
  });
});

describe('cinema-mode v0.7.133 — isYouTubeWatch URL 判斷', () => {
  let isYouTubeWatch;
  before(() => {
    const env = setupJsdom('https://example.com/');
    isYouTubeWatch = env.NS.cinema.isYouTubeWatch;
  });

  it('https://www.youtube.com/watch?v=xxx → true', () => {
    assert.strictEqual(isYouTubeWatch('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  });

  it('https://youtube.com/watch?v=xxx（無 www）→ true', () => {
    assert.strictEqual(isYouTubeWatch('https://youtube.com/watch?v=xxx'), true);
  });

  it('https://m.youtube.com/watch?v=xxx（行動版）→ true', () => {
    assert.strictEqual(isYouTubeWatch('https://m.youtube.com/watch?v=xxx'), true);
  });

  it('https://www.youtube.com/（首頁，沒 /watch）→ false', () => {
    assert.strictEqual(isYouTubeWatch('https://www.youtube.com/'), false);
  });

  it('https://www.youtube.com/shorts/xxx → false（shorts 是 9:16 影片，cinema CSS 套上去會破）', () => {
    assert.strictEqual(isYouTubeWatch('https://www.youtube.com/shorts/xxx'), false);
  });

  it('https://www.youtube.com/@channel → false（頻道頁）', () => {
    assert.strictEqual(isYouTubeWatch('https://www.youtube.com/@channel'), false);
  });

  it('https://www.youtube-nocookie.com/watch?v=xxx → false（不是真 youtube.com）', () => {
    assert.strictEqual(isYouTubeWatch('https://www.youtube-nocookie.com/watch?v=xxx'), false);
  });

  it('https://example.com/watch?v=xxx → false（非 youtube）', () => {
    assert.strictEqual(isYouTubeWatch('https://example.com/watch?v=xxx'), false);
  });

  it('無參數呼叫時讀 location.href 作預設', () => {
    const env = setupJsdom('https://www.youtube.com/watch?v=abc');
    assert.strictEqual(env.NS.cinema.isYouTubeWatch(), true,
      '不傳 url 時應以 location.href 判斷');
    const env2 = setupJsdom('https://example.com/');
    assert.strictEqual(env2.NS.cinema.isYouTubeWatch(), false);
  });
});

describe('cinema-mode v0.7.133 — enter / exit / isActive 行為', () => {
  let env;
  beforeEach(() => {
    env = setupJsdom('https://www.youtube.com/watch?v=xxx');
  });

  it('初始 isActive() = false', () => {
    assert.strictEqual(env.NS.cinema.isActive(), false);
  });

  it('enter() 注入 <style id="__jread_cinema_style"> + html 加 data-jread-cinema-active="1"', () => {
    env.NS.cinema.enter();
    const style = env.document.getElementById('__jread_cinema_style');
    assert.ok(style, 'enter() 必須注入 <style id="__jread_cinema_style">');
    assert.strictEqual(style.tagName.toLowerCase(), 'style');
    assert.ok(style.textContent.includes('#movie_player'),
      'style 內容必須含 #movie_player rule（核心：把 player 釘 viewport 中央）');
    assert.ok(style.textContent.includes('position: fixed'),
      'style 內容必須用 position: fixed（繞過 ytd-watch-flexy 的 flex layout）');
    assert.ok(style.textContent.includes('min(100vw, 177.78vh)'),
      'width 必須用 min(100vw, 177.78vh) 雙軸 clamp 16:9——避免寬高任一觸到 viewport 仍能完整露出');
    assert.strictEqual(env.document.documentElement.getAttribute('data-jread-cinema-active'), '1',
      'enter() 必須在 html 加 data-jread-cinema-active="1"——供 chrome devtools / probe 判斷狀態');
    assert.strictEqual(env.NS.cinema.isActive(), true);
  });

  it('exit() 移除 style + 清 attribute', () => {
    env.NS.cinema.enter();
    env.NS.cinema.exit();
    assert.strictEqual(env.document.getElementById('__jread_cinema_style'), null,
      'exit() 必須移除 __jread_cinema_style');
    assert.strictEqual(env.document.documentElement.getAttribute('data-jread-cinema-active'), null,
      'exit() 必須清 data-jread-cinema-active attribute');
    assert.strictEqual(env.NS.cinema.isActive(), false);
  });

  it('enter() 重複呼叫不會注入第二份 style', () => {
    env.NS.cinema.enter();
    env.NS.cinema.enter();
    const styles = env.document.querySelectorAll('style#__jread_cinema_style');
    assert.strictEqual(styles.length, 1, '重複 enter 必須冪等');
  });

  it('exit() 沒 enter 過時也安全（不丟例外）', () => {
    assert.doesNotThrow(() => env.NS.cinema.exit());
  });

  it('CSS 必須含 ytp-ce-element / ytp-cards-teaser / ytp-suggested-action hide rule（autoplay endscreen card 等浮層）', () => {
    env.NS.cinema.enter();
    const css = env.document.getElementById('__jread_cinema_style').textContent;
    assert.ok(css.includes('.ytp-ce-element'),
      'CSS 必須 hide .ytp-ce-element——autoplay endscreen card 浮層');
    assert.ok(css.includes('.ytp-cards-teaser'),
      'CSS 必須 hide .ytp-cards-teaser');
    assert.ok(css.includes('.ytp-suggested-action'),
      'CSS 必須 hide .ytp-suggested-action');
  });

  it('CSS 必須含 ytd-comments / ytd-watch-metadata hide rule（留言 / 影片描述）', () => {
    env.NS.cinema.enter();
    const css = env.document.getElementById('__jread_cinema_style').textContent;
    assert.ok(css.includes('ytd-comments'),
      'CSS 必須 hide ytd-comments——留言區');
    assert.ok(css.includes('ytd-watch-metadata'),
      'CSS 必須 hide ytd-watch-metadata——影片標題 / 描述 / 訂閱按鈕區');
  });
});

describe('cinema-mode v0.7.133 — detector.detect() YouTube short-circuit', () => {
  it('YouTube watch URL → detect() 返回 isYouTubeCinema=true, strategy=youtube-cinema, el=null', () => {
    const env = setupJsdom('https://www.youtube.com/watch?v=xxx', [DETECTOR_SRC]);
    const result = env.NS.detector.detect();
    assert.ok(result, 'YouTube watch 不應 no-op');
    assert.strictEqual(result.isYouTubeCinema, true,
      'detect() 結果必須帶 isYouTubeCinema=true（main.js 依此判斷走 cinema.enter()）');
    assert.strictEqual(result.strategy, 'youtube-cinema');
    assert.strictEqual(result.confidence, 1);
    assert.strictEqual(result.el, null, 'cinema mode 沒主文容器，el 必須是 null');
  });

  it('非 YouTube URL → detect() 走原本偵測（不返回 isYouTubeCinema）', () => {
    const env = setupJsdom('https://example.com/article', [DETECTOR_SRC]);
    // example.com fixture 沒主文 → 應回 null（normal no-op）
    const result = env.NS.detector.detect();
    if (result) {
      assert.notStrictEqual(result.isYouTubeCinema, true,
        '非 YouTube URL 不該被誤判為 cinema candidate');
    }
  });

  it('YouTube 首頁（非 /watch）→ detect() 不返回 isYouTubeCinema', () => {
    const env = setupJsdom('https://www.youtube.com/', [DETECTOR_SRC]);
    const result = env.NS.detector.detect();
    if (result) {
      assert.notStrictEqual(result.isYouTubeCinema, true,
        '首頁不該觸發 cinema mode（會把首頁雜亂的 layout 套黑底）');
    }
  });
});

describe('cinema-mode v0.7.133 — namespace.js state.cinemaActive', () => {
  it('namespace.js 必須含 cinemaActive: false 初始狀態', () => {
    assert.match(NAMESPACE_SRC, /cinemaActive\s*:\s*false/,
      'namespace.js state 必須含 cinemaActive: false——main.js exitReaderMode 讀此 flag 決定走哪條 restore 路徑');
  });

  it('namespace.js 必須含 cinema: null 佔位', () => {
    assert.match(NAMESPACE_SRC, /cinema\s*:\s*null/,
      'namespace.js 必須有 cinema: null 佔位——讓 NS.cinema 在 cinema-mode.js 載入前不是 undefined');
  });
});

describe('cinema-mode v0.7.133 — main.js enter/exit 分支', () => {
  it('main.js 必須宣告 enterCinemaMode helper function', () => {
    assert.match(MAIN_SRC, /function\s+enterCinemaMode\s*\(/,
      'main.js 必須有 enterCinemaMode helper——獨立 function 是為了 enterReaderMode body 不被撐大、keyguard.spec 的 slice 仍能命中 settings.blockPageShortcuts');
  });

  it('enterReaderMode 必須在 result.isYouTubeCinema 時 dispatch 到 enterCinemaMode', () => {
    assert.match(MAIN_SRC, /if\s*\(\s*result\.isYouTubeCinema\s*\)\s*\{\s*return\s+enterCinemaMode\(\)/,
      'enterReaderMode 必須有 `if (result.isYouTubeCinema) return enterCinemaMode()` dispatch——否則 cinema candidate 會走進 cleaner/styler 路徑炸 articleEl=null');
  });

  it('enterCinemaMode 必須呼叫 NS.cinema.enter()', () => {
    const m = MAIN_SRC.match(/function\s+enterCinemaMode\s*\(\s*\)\s*\{([\s\S]*?)\n\s\s\}/);
    assert.ok(m, '能抓到 enterCinemaMode body');
    assert.match(m[1], /NS\.cinema\.enter\(\)/,
      'enterCinemaMode 必須呼叫 NS.cinema.enter()');
  });

  it('enterCinemaMode 必須設 NS.state.cinemaActive = true', () => {
    const m = MAIN_SRC.match(/function\s+enterCinemaMode\s*\(\s*\)\s*\{([\s\S]*?)\n\s\s\}/);
    assert.ok(m);
    assert.match(m[1], /NS\.state\.cinemaActive\s*=\s*true/,
      'enterCinemaMode 必須設 NS.state.cinemaActive = true（exitReaderMode 讀此 flag 決定 restore 路徑）');
  });

  it('enterCinemaMode 必須安裝 ESC listener（讓使用者 ESC 退出）', () => {
    const m = MAIN_SRC.match(/function\s+enterCinemaMode\s*\(\s*\)\s*\{([\s\S]*?)\n\s\s\}/);
    assert.ok(m);
    assert.match(m[1], /addEventListener\(\s*['"]keydown['"]\s*,\s*onEscKey/,
      'enterCinemaMode 必須註冊 onEscKey listener');
  });

  it('enterCinemaMode 不應安裝 keyguard（YouTube j/k/l/space/f 是 player 控制必備）', () => {
    const m = MAIN_SRC.match(/function\s+enterCinemaMode\s*\(\s*\)\s*\{([\s\S]*?)\n\s\s\}/);
    assert.ok(m);
    assert.doesNotMatch(m[1], /installKeyguard\(\)/,
      'enterCinemaMode 不可呼叫 installKeyguard——YouTube 的 player keyboard shortcut 是觀影必備，攔下去會打殘體驗');
  });

  it('exitReaderMode 必須有 cinemaActive 分支走 NS.cinema.exit()', () => {
    assert.match(MAIN_SRC, /if\s*\(\s*NS\.state\.cinemaActive\s*\)/,
      'exitReaderMode 必須先判斷 cinemaActive 分支');
    assert.match(MAIN_SRC, /NS\.cinema\.exit\(\)/,
      'cinema 分支必須呼叫 NS.cinema.exit()');
  });

  it('extractReaderPayload 在 cinemaActive 時回 NOT_APPLICABLE_IN_CINEMA', () => {
    assert.match(MAIN_SRC, /NOT_APPLICABLE_IN_CINEMA/,
      'extractReaderPayload 必須對 cinemaActive 回 NOT_APPLICABLE_IN_CINEMA（而非 NOT_ACTIVE 讓 popup 顯示誤導訊息）');
  });

  it('GET_READER_STATE response 必須含 siteMode 欄位', () => {
    // 抓 GET_READER_STATE handler block
    const m = MAIN_SRC.match(/MSG\.GET_READER_STATE[\s\S]{0,2000}?return;\s*\/\/ sync/);
    assert.ok(m, 'main.js 找不到 GET_READER_STATE handler');
    assert.match(m[0], /siteMode/,
      'GET_READER_STATE response 必須含 siteMode（popup 用來切按鈕文字）');
    assert.match(m[0], /youtube-cinema/,
      'GET_READER_STATE handler 必須判 youtube-cinema 站點');
    assert.match(m[0], /cinemaActive/,
      'GET_READER_STATE response 必須含 cinemaActive 欄位');
  });
});

describe('cinema-mode v0.7.133 — popup.js 影院模式按鈕', () => {
  it('popup.js 必須含 refreshPopupForActiveTab function', () => {
    assert.match(POPUP_JS, /function\s+refreshPopupForActiveTab\s*\(/,
      'popup.js 必須重命名 / 擴增為 refreshPopupForActiveTab（同時管 readwise 按鈕 + toggle 按鈕文字）');
  });

  it('popup.js 必須讀 res.siteMode 判斷', () => {
    assert.match(POPUP_JS, /res\.siteMode|res\s*&&\s*res\.siteMode/,
      'popup.js 必須讀 GET_READER_STATE response 的 siteMode 欄位');
  });

  it('popup.js 必須在 youtube-cinema 時改 toggle 按鈕文字「啟動 / 退出影院模式」', () => {
    assert.match(POPUP_JS, /['"]youtube-cinema['"]/,
      'popup.js 必須判 siteMode === "youtube-cinema"');
    assert.match(POPUP_JS, /影院模式/,
      'popup.js 必須含「影院模式」字串');
    assert.match(POPUP_JS, /啟動影院模式/,
      'popup.js 必須含「啟動影院模式」字串（cinemaActive=false 時）');
    assert.match(POPUP_JS, /退出影院模式/,
      'popup.js 必須含「退出影院模式」字串（cinemaActive=true 時）');
  });

  it('popup.js refreshPopupForActiveTab 必須讓 cinemaActive 時 readwise 按鈕 hidden', () => {
    // 邏輯：readwiseBtn.hidden = !active || cinemaActive
    assert.match(POPUP_JS, /cinemaActive[\s\S]{0,200}?readwiseBtn\.hidden|readwiseBtn\.hidden[\s\S]{0,200}?cinemaActive/,
      'popup.js 必須在 cinema mode 時隱藏 readwise 按鈕（cinema 沒主文 outerHTML 可送）');
  });
});

describe('cinema-mode v0.7.133 — manifest.json content_scripts 載入順序', () => {
  it('content_scripts.js 必須包含 content/cinema-mode.js', () => {
    const list = MANIFEST.content_scripts[0].js;
    assert.ok(list.includes('content/cinema-mode.js'),
      'manifest content_scripts.js 必須含 content/cinema-mode.js');
  });

  it('cinema-mode.js 必須在 namespace.js 之後（依賴 NS）、detector.js 之前（detector 引用 NS.cinema）', () => {
    const list = MANIFEST.content_scripts[0].js;
    const nsIdx = list.indexOf('content/namespace.js');
    const cinemaIdx = list.indexOf('content/cinema-mode.js');
    const detIdx = list.indexOf('content/detector.js');
    assert.ok(nsIdx >= 0 && cinemaIdx >= 0 && detIdx >= 0);
    assert.ok(cinemaIdx > nsIdx,
      `cinema-mode 必須在 namespace 之後（NS 才存在），實際順序：namespace=${nsIdx}, cinema=${cinemaIdx}`);
    assert.ok(cinemaIdx < detIdx,
      `cinema-mode 必須在 detector 之前（detect() 引用 NS.cinema），實際順序：cinema=${cinemaIdx}, detector=${detIdx}`);
  });
});
