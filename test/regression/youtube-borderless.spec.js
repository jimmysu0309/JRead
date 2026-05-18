// JRead — YouTube Borderless Mode regression (v0.7.134)
//
// 動機：v0.7.134 從 Shinkansen 移植「無邊模式」進 JRead。隱藏所有 YouTube UI、
// 強制 theater、影片 100vw × 100vh 撐滿視窗，並 SW 端 `chrome.windows.update`
// 把瀏覽器視窗高度 resize 成匹配影片比例。功能無 suggested_key，使用者自綁
// 快速鍵；popup 在 YouTube watch 頁多一顆「切換無邊模式」按鈕。
//
// 與 cinema-mode（v0.7.133）兩者完全獨立、可同時 toggle、CSS 會搶
// `#movie_player` rule，spec 不驗它們的互動，只各自管自己的結構。
//
// 本 spec 是 forcing function：每條 assertion 對應一個能讓 feature 跑起來的
// 必要結構，少一塊就會 fail。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const BORDERLESS_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'youtube-borderless.js'), 'utf8');
const NAMESPACE_SRC  = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'namespace.js'), 'utf8');
const MAIN_SRC       = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'main.js'), 'utf8');
const SW_SRC         = fs.readFileSync(path.join(ROOT, 'jread', 'background', 'service-worker.js'), 'utf8');
const POPUP_HTML     = fs.readFileSync(path.join(ROOT, 'jread', 'popup', 'popup.html'), 'utf8');
const POPUP_JS       = fs.readFileSync(path.join(ROOT, 'jread', 'popup', 'popup.js'), 'utf8');
const POPUP_CORE     = fs.readFileSync(path.join(ROOT, 'jread', 'popup', 'popup-core.js'), 'utf8');
const MANIFEST       = JSON.parse(fs.readFileSync(path.join(ROOT, 'jread', 'manifest.json'), 'utf8'));

function setupJsdom(url) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url,
    runScripts: 'outside-only'
  });
  const { window } = dom;
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.7.134' }),
      sendMessage: () => Promise.resolve({ ok: true })
    }
  };
  window.eval(NAMESPACE_SRC);
  window.eval(BORDERLESS_SRC);
  return { window, document: window.document, NS: window.__JRead };
}

describe('youtube-borderless v0.7.134 — module structure', () => {
  it('youtube-borderless.js 必須宣告 toggle / reapplyOnNavigation / isActive / isYouTubeWatch', () => {
    assert.match(BORDERLESS_SRC, /function\s+toggle\s*\(/,
      'youtube-borderless.js 缺 toggle function');
    assert.match(BORDERLESS_SRC, /function\s+reapplyOnNavigation\s*\(/,
      'youtube-borderless.js 缺 reapplyOnNavigation function（SPA 切影片用）');
    assert.match(BORDERLESS_SRC, /function\s+isActive\s*\(/,
      'youtube-borderless.js 缺 isActive function');
    assert.match(BORDERLESS_SRC, /function\s+isYouTubeWatch\s*\(/,
      'youtube-borderless.js 缺 isYouTubeWatch function');
  });

  it('youtube-borderless.js 必須 export NS.borderless 物件含 toggle / isActive / STYLE_ID', () => {
    assert.match(BORDERLESS_SRC,
      /NS\.borderless\s*=\s*\{[\s\S]*toggle[\s\S]*isActive[\s\S]*\}/,
      'NS.borderless 必須暴露 toggle / isActive（main.js / popup.js 依賴）');
    assert.match(BORDERLESS_SRC, /STYLE_ID\s*=\s*['"]__jread_borderless_style['"]/,
      'STYLE_ID 常數必須是 __jread_borderless_style——與 cinema-mode 的 __jread_cinema_style 不同 namespace');
  });

  it('youtube-borderless.js 必須含 yt-navigate-finish listener 註冊（SPA 切影片必備）', () => {
    assert.match(BORDERLESS_SRC, /yt-navigate-finish/,
      'youtube-borderless.js 缺 yt-navigate-finish listener——YouTube SPA 切影片不 reload、不重套會讓新影片 CSS 沒被觸發');
  });

  it('apply() 必須 dispatch resize event（YouTube 內部會根據 resize 重算 video 的 inline width/height）', () => {
    assert.match(BORDERLESS_SRC, /dispatchEvent\(\s*new\s+Event\(\s*['"]resize['"]/,
      'apply() / unapply() 必須 dispatch resize event');
  });

  it('CSS 必須含關鍵 selectors 與 100vw / 100vh 規則', () => {
    // 隱藏 noise
    assert.match(BORDERLESS_SRC, /ytd-masthead/, 'CSS 必須含 ytd-masthead 隱藏規則');
    assert.match(BORDERLESS_SRC, /ytd-comments|#comments/, 'CSS 必須含 comments 隱藏規則');
    assert.match(BORDERLESS_SRC, /ytd-watch-metadata/, 'CSS 必須含 ytd-watch-metadata 隱藏規則');
    // 影片撐滿視窗
    assert.match(BORDERLESS_SRC, /#movie_player[\s\S]*100vw/,
      'CSS 必須含 #movie_player 100vw 規則（影片撐滿視窗寬）');
    assert.match(BORDERLESS_SRC, /100vh/,
      'CSS 必須含 100vh 規則（影片撐滿視窗高）');
    assert.match(BORDERLESS_SRC, /object-fit\s*:\s*contain/,
      'CSS 必須含 object-fit: contain（resize 失敗時影片仍 letterbox 不變形）');
  });

  it('呼叫 SW resize 必須走 NS.MSG.RESIZE_OWN_WINDOW 常數（避免 hardcode 字面）', () => {
    assert.match(BORDERLESS_SRC, /NS\.MSG\.RESIZE_OWN_WINDOW/,
      'requestResize() 必須用 NS.MSG.RESIZE_OWN_WINDOW 常數——避免訊息字面寫錯但 spec 仍綠');
  });
});

describe('youtube-borderless v0.7.134 — isYouTubeWatch URL 判斷', () => {
  let isYouTubeWatch;
  before(() => {
    const env = setupJsdom('https://example.com/');
    isYouTubeWatch = env.NS.borderless.isYouTubeWatch;
  });

  it('https://www.youtube.com/watch?v=xxx → true', () => {
    assert.strictEqual(isYouTubeWatch('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  });

  it('https://m.youtube.com/watch?v=xxx → true', () => {
    assert.strictEqual(isYouTubeWatch('https://m.youtube.com/watch?v=abc'), true);
  });

  it('https://www.youtube.com/ → false（首頁）', () => {
    assert.strictEqual(isYouTubeWatch('https://www.youtube.com/'), false);
  });

  it('https://www.youtube.com/shorts/abc → false', () => {
    assert.strictEqual(isYouTubeWatch('https://www.youtube.com/shorts/abc'), false);
  });

  it('https://www.youtube-nocookie.com/watch?v=xxx → false（embed-only 變體不啟用）', () => {
    assert.strictEqual(isYouTubeWatch('https://www.youtube-nocookie.com/watch?v=xxx'), false);
  });

  it('https://example.com/watch → false（非 youtube hostname）', () => {
    assert.strictEqual(isYouTubeWatch('https://example.com/watch'), false);
  });

  it('無參數呼叫時讀 location.href 作 fallback', () => {
    const env = setupJsdom('https://www.youtube.com/watch?v=abc');
    assert.strictEqual(env.NS.borderless.isYouTubeWatch(), true);
  });
});

describe('youtube-borderless v0.7.134 — _calcTargetWindowHeight 純函式', () => {
  let calc;
  before(() => {
    const env = setupJsdom('https://www.youtube.com/watch?v=xxx');
    calc = env.NS.borderless._calcTargetWindowHeight;
  });

  it('16:9 影片：targetInner = innerW * 9 / 16', () => {
    // videoW=1920, videoH=1080, innerW=1280, outerH=900, innerH=800
    // ratio = 1.7777 → targetInner = round(1280 / 1.7777) = 720
    // chromeH = 900 - 800 = 100 → target = 720 + 100 = 820 (within [200, 0.8*availHeight])
    const result = calc(1920, 1080, 1280, 900, 800);
    assert.ok(result >= 200, `result ${result} 應 >= minOuter 200`);
    // result 應該接近 820（受 maxOuter clamp）
    assert.ok(result === 820 || result < 820,
      `16:9 1280 寬 + 100 chrome = 820，受 maxOuter clamp 可能更小，實際 ${result}`);
  });

  it('4:3 影片：targetInner = innerW * 3 / 4', () => {
    // videoW=640, videoH=480, innerW=1024, outerH=850, innerH=800
    // ratio = 4/3 → targetInner = round(1024 * 3/4) = 768
    // chromeH = 50 → target = 818
    const result = calc(640, 480, 1024, 850, 800);
    assert.ok(result >= 200, `result ${result} 應 >= minOuter 200`);
  });

  it('極端窄影片：受 minOuter 200 clamp', () => {
    // videoW=10000, videoH=100, innerW=100 → targetInner=1（極小）
    // chromeH=0 → target=1 → clamp 到 200
    const result = calc(10000, 100, 100, 100, 100);
    assert.strictEqual(result, 200, '極端寬比影片應被 minOuter 200 clamp 住');
  });
});

describe('youtube-borderless v0.7.134 — namespace + MSG 常數', () => {
  it('namespace.js 必須有 borderless: null 佔位', () => {
    assert.match(NAMESPACE_SRC, /borderless\s*:\s*null/,
      'namespace.js 需 borderless: null 佔位——避免 youtube-borderless.js 載入前 main.js 等存取 NS.borderless 抓到 undefined');
  });

  it('namespace.js MSG 必須含 TOGGLE_YT_BORDERLESS 與 RESIZE_OWN_WINDOW', () => {
    assert.match(NAMESPACE_SRC, /TOGGLE_YT_BORDERLESS\s*:\s*['"]TOGGLE_YT_BORDERLESS['"]/,
      'namespace.js MSG 必須含 TOGGLE_YT_BORDERLESS 常數（SW / popup 觸發無邊模式 toggle）');
    assert.match(NAMESPACE_SRC, /RESIZE_OWN_WINDOW\s*:\s*['"]RESIZE_OWN_WINDOW['"]/,
      'namespace.js MSG 必須含 RESIZE_OWN_WINDOW 常數（content → SW 呼叫 chrome.windows.update）');
  });
});

describe('youtube-borderless v0.7.134 — manifest', () => {
  it('manifest.json content_scripts.js 必須含 content/youtube-borderless.js', () => {
    const files = MANIFEST.content_scripts[0].js;
    assert.ok(files.includes('content/youtube-borderless.js'),
      `manifest content_scripts.js 必須含 content/youtube-borderless.js，實際：${JSON.stringify(files)}`);
  });

  it('manifest.json content_scripts.js 中 youtube-borderless.js 必須在 main.js 之前載入', () => {
    const files = MANIFEST.content_scripts[0].js;
    const idxBorderless = files.indexOf('content/youtube-borderless.js');
    const idxMain = files.indexOf('content/main.js');
    assert.ok(idxBorderless < idxMain,
      `youtube-borderless.js 必須在 main.js 之前載入（main.js 訊息 handler 會呼 NS.borderless.toggle()），實際順序 borderless=${idxBorderless} main=${idxMain}`);
  });

  it('manifest.json commands 必須有 toggle-youtube-borderless（無 suggested_key 隱藏功能）', () => {
    assert.ok(MANIFEST.commands && MANIFEST.commands['toggle-youtube-borderless'],
      'manifest commands 必須有 toggle-youtube-borderless');
    const cmd = MANIFEST.commands['toggle-youtube-borderless'];
    assert.ok(cmd.description && cmd.description.length > 0,
      'toggle-youtube-borderless 必須有 description（給 chrome://extensions/shortcuts 顯示）');
    assert.ok(!cmd.suggested_key,
      'toggle-youtube-borderless 預期無 suggested_key（隱藏功能、避免撞鍵）');
  });

  it('popup-core.js CONTENT_SCRIPT_FILES 必須與 manifest content_scripts.js 完全一致', () => {
    // forcing function：避免新增 content script 後 inject fallback 漏注入
    const manifestFiles = MANIFEST.content_scripts[0].js;
    for (const f of manifestFiles) {
      assert.ok(POPUP_CORE.includes(`'${f}'`),
        `popup-core.js CONTENT_SCRIPT_FILES 缺 ${f}——inject fallback 會漏注入此檔`);
    }
  });
});

describe('youtube-borderless v0.7.134 — SW cross-mode 退出邏輯', () => {
  // v0.7.134：YouTube 影院 / 無邊模式 active 時，任一模式快速鍵都當作退出
  // 當前 active 模式（= 按 ESC 的效果）。SW 先 GET_READER_STATE 拿當前狀態
  // 再依此重導 command。
  //
  // JS regex 沒 balanced brace、抓不出 onCommand listener 完整 block，改用
  // substring 從 onCommand 那行切到檔尾——後續內容（onCommand 後的 helper
  // function 等）不會混入 listener 內部分支字眼，安全。

  const ON_COMMAND_SLICE = SW_SRC.slice(
    SW_SRC.indexOf('chrome.commands.onCommand.addListener')
  );

  it('SW onCommand 必須先 GET_READER_STATE 才決定 command 重導', () => {
    assert.ok(ON_COMMAND_SLICE.length > 0, '抓不到 chrome.commands.onCommand listener');
    assert.match(ON_COMMAND_SLICE, /chrome\.tabs\.sendMessage[\s\S]*?GET_READER_STATE/,
      'SW onCommand 必須在處理 toggle-reader-mode / toggle-youtube-borderless 前 GET_READER_STATE 拿當前 cinema/borderless active 狀態');
  });

  it('SW onCommand 必須有 borderlessActive 時 toggle-reader-mode 改送 TOGGLE_YT_BORDERLESS 的分支', () => {
    // toggle-reader-mode 觸發但 borderless active → 改退出 borderless（送 TOGGLE_YT_BORDERLESS）
    assert.match(ON_COMMAND_SLICE,
      /toggle-reader-mode['"]\s*&&\s*borderlessActive[\s\S]*?TOGGLE_YT_BORDERLESS/,
      'SW onCommand 必須有「toggle-reader-mode 且 borderlessActive=true → 送 TOGGLE_YT_BORDERLESS 退出無邊模式」分支');
  });

  it('SW onCommand 必須有 cinemaActive 時 toggle-youtube-borderless 改走 toggleWithInjectionFallback 的分支', () => {
    // toggle-youtube-borderless 觸發但 cinema active → 改退出 cinema（toggleWithInjectionFallback 走 TOGGLE_READER_MODE）
    assert.match(ON_COMMAND_SLICE,
      /toggle-youtube-borderless['"]\s*&&\s*cinemaActive[\s\S]*?toggleWithInjectionFallback/,
      'SW onCommand 必須有「toggle-youtube-borderless 且 cinemaActive=true → toggleWithInjectionFallback 退出影院模式」分支');
  });

  it('SW onCommand 兩個模式皆 inactive 時走原本各自 path（沒被 redirect 邏輯 short-circuit）', () => {
    // 必須仍有 toggle-reader-mode → toggleWithInjectionFallback 主要分支
    assert.match(ON_COMMAND_SLICE,
      /command\s*===\s*['"]toggle-reader-mode['"][\s\S]*?toggleWithInjectionFallback/,
      'SW 仍須保留「toggle-reader-mode → toggleWithInjectionFallback」主分支供 cinema/borderless 都 inactive 時用');
    // 必須仍有 toggle-youtube-borderless → sendMessage TOGGLE_YT_BORDERLESS 主要分支
    assert.match(ON_COMMAND_SLICE,
      /command\s*===\s*['"]toggle-youtube-borderless['"][\s\S]*?TOGGLE_YT_BORDERLESS/,
      'SW 仍須保留「toggle-youtube-borderless → sendMessage TOGGLE_YT_BORDERLESS」主分支供兩模式都 inactive 時用');
  });
});

describe('youtube-borderless v0.7.134 — SW handler', () => {
  it('SW 必須處理 RESIZE_OWN_WINDOW 訊息呼叫 chrome.windows.update', () => {
    assert.match(SW_SRC, /case\s+['"]RESIZE_OWN_WINDOW['"]/,
      'SW onMessage 必須有 RESIZE_OWN_WINDOW case');
    assert.match(SW_SRC, /chrome\.windows\.update/,
      'SW RESIZE_OWN_WINDOW handler 必須呼叫 chrome.windows.update');
  });

  it('RESIZE_OWN_WINDOW handler 必須吞掉 chrome.windows.update 的 promise reject（PWA / 視窗已關 race）', () => {
    // 抓 RESIZE_OWN_WINDOW case 開始到下一個 case / closing 為止
    const m = SW_SRC.match(/case\s+['"]RESIZE_OWN_WINDOW['"][\s\S]*?(?=case\s+['"]|^\s*default\s*:|^\s*\}\s*\n\s*\})/m);
    assert.ok(m, 'SW 找不到 RESIZE_OWN_WINDOW case slice');
    assert.match(m[0], /\.catch\s*\(/,
      'RESIZE_OWN_WINDOW handler 必須 .catch 吞掉 chrome.windows.update reject——避免 tab 關閉 / PWA 限制時 uncaught rejection');
  });

  it('SW onCommand 必須處理 toggle-youtube-borderless 分支', () => {
    assert.match(SW_SRC, /command\s*===\s*['"]toggle-youtube-borderless['"]/,
      'SW commands.onCommand 必須有 toggle-youtube-borderless 分支');
  });

  it('toggle-youtube-borderless 分支必須 sendMessage TOGGLE_YT_BORDERLESS', () => {
    const m = SW_SRC.match(/command\s*===\s*['"]toggle-youtube-borderless['"][\s\S]{0,500}/);
    assert.ok(m, '抓不到 toggle-youtube-borderless 分支');
    assert.match(m[0], /TOGGLE_YT_BORDERLESS/,
      'toggle-youtube-borderless 分支必須 sendMessage 含 TOGGLE_YT_BORDERLESS type');
    assert.match(m[0], /chrome\.tabs\.sendMessage/,
      'toggle-youtube-borderless 分支必須走 chrome.tabs.sendMessage');
    assert.match(m[0], /\.catch\s*\(/,
      'toggle-youtube-borderless sendMessage 必須 .catch 吞掉 receiving end does not exist');
  });
});

describe('youtube-borderless v0.7.134 — main.js 訊息 listener', () => {
  it('main.js 必須處理 NS.MSG.TOGGLE_YT_BORDERLESS 訊息', () => {
    assert.match(MAIN_SRC, /msg\.type\s*===\s*NS\.MSG\.TOGGLE_YT_BORDERLESS/,
      'main.js onMessage 必須有 NS.MSG.TOGGLE_YT_BORDERLESS case');
  });

  it('TOGGLE_YT_BORDERLESS handler 必須呼 NS.borderless.toggle()', () => {
    const m = MAIN_SRC.match(/NS\.MSG\.TOGGLE_YT_BORDERLESS[\s\S]{0,500}/);
    assert.ok(m, '抓不到 TOGGLE_YT_BORDERLESS handler slice');
    assert.match(m[0], /NS\.borderless[\s\S]*toggle\s*\(\s*\)/,
      'TOGGLE_YT_BORDERLESS handler 必須呼叫 NS.borderless.toggle()');
  });

  it('GET_READER_STATE response 必須含 borderlessActive 欄位', () => {
    assert.match(MAIN_SRC, /borderlessActive\s*:/,
      'GET_READER_STATE response 必須含 borderlessActive 欄位（popup 用此切按鈕文字）');
    assert.match(MAIN_SRC, /NS\.borderless[\s\S]*isActive/,
      'borderlessActive 必須來自 NS.borderless.isActive()，而非寫死 false');
  });
});

describe('youtube-borderless v0.7.134 — popup UI', () => {
  it('popup.html 必須有 #borderless-btn 且初始 hidden', () => {
    assert.match(POPUP_HTML, /id="borderless-btn"[^>]*hidden/,
      'popup.html #borderless-btn 必須含 hidden 屬性——非 YouTube watch 頁不顯示');
  });

  it('popup.js 必須讀 borderless-btn DOM element', () => {
    assert.match(POPUP_JS, /getElementById\(\s*['"]borderless-btn['"]/,
      'popup.js 必須有 document.getElementById("borderless-btn")');
  });

  it('popup.js refreshPopupForActiveTab 必須處理 borderlessBtn 顯示與按鈕文字', () => {
    assert.match(POPUP_JS, /borderlessBtn\.hidden/,
      'popup.js 必須在 refreshPopupForActiveTab 內設定 borderlessBtn.hidden');
    assert.match(POPUP_JS, /borderlessActive/,
      'popup.js 必須讀取 GET_READER_STATE response 的 borderlessActive 欄位');
    assert.match(POPUP_JS, /退出無邊模式|啟動無邊模式/,
      'popup.js 必須切換無邊模式按鈕文字（啟動 / 退出）');
  });

  it('popup.js 必須有 borderlessBtn click handler 送 TOGGLE_YT_BORDERLESS', () => {
    assert.match(POPUP_JS, /borderlessBtn\.addEventListener\(\s*['"]click['"]/,
      'popup.js 必須對 borderlessBtn 註冊 click listener');
    const m = POPUP_JS.match(/borderlessBtn\.addEventListener\([\s\S]{0,500}/);
    assert.ok(m, '抓不到 borderlessBtn click handler slice');
    assert.match(m[0], /TOGGLE_YT_BORDERLESS/,
      'borderlessBtn click handler 必須 sendMessage TOGGLE_YT_BORDERLESS');
  });
});
