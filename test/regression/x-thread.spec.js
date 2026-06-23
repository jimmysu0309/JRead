// JRead — X / Twitter status thread reader regression（v0.7.135）
//
// 動機：X status 頁（x.com / twitter.com 的 /<user>/status/<digits>）DOM 是
// timeline 結構，detector 既有策略誤判為列表頁 no-op。Jimmy 2026-05-18 要求
// 支援「X 原生 thread = 同作者連續推文」+ replies 全清。修法：合成 reader
// 容器路線——detector 短路 isXThread=true → main.js 走 enterXThreadMode 呼叫
// NS.xThread.enter() 建 `<article data-jread-x-reader>` clone thread member 進
// 去注入 body firstChild，後續 cleaner / styler / Readwise / keyguard / ESC
// 流程 0 fork 全沿用。
//
// 假設驗證順序見 CLAUDE.md。本 feature 的 URL match / 主推文 / thread member
// 偵測 / 合成容器注入已由 chrome-in-chrome probe 在真實 x.com/<user>/status
// 頁面驗過（2026-05-18 philipinspain status 案例）。本 spec 是 forcing function，
// 覆蓋：
//   1. x-thread.js 模組結構（NS.xThread.{ isXStatusPage, extractStatusId,
//      getAuthorHandle, findMainTweet, collectThreadArticles, enter, exit,
//      isActive, READER_ATTR }）
//   2. isXStatusPage URL 判斷（x.com / twitter.com / www / mobile / m / 非
//      /status/ 路徑 / 非 X 站）
//   3. extractStatusId 抽 status digits
//   4. getAuthorHandle 跳過 /status/ 時間戳 link
//   5. findMainTweet 命中含 a[href*="/status/<ID>"] 的 article
//   6. collectThreadArticles 邊界（單推文 / 同作者連續 thread / 不同作者中斷 /
//      非 cellInnerDiv 中斷 / 無 article cell 中斷 / 前後雙向 walk）
//   7. enter() 注入合成 <article data-jread-x-reader> 到 body 開頭 + exit() 清除
//   8. detector.js detect() X status 短路（回 isXThread=true / el=null）
//   9. main.js enterXThreadMode 流程（NS.xThread.enter + cleaner.clean + 標
//      siteMode='article'）+ exitReaderMode 呼叫 NS.xThread.exit()
//  10. manifest content_scripts 載入順序（x-thread.js 在 detector.js 前）
//  11. namespace.js xThread: null 佔位

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const XTHREAD_SRC   = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'x-thread.js'), 'utf8');
const NAMESPACE_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'namespace.js'), 'utf8');
const DETECTOR_SRC  = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'detector.js'), 'utf8');
const MAIN_SRC      = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'main.js'), 'utf8');
const POPUP_CORE    = fs.readFileSync(path.join(ROOT, 'jread', 'popup', 'popup-core.js'), 'utf8');
const MANIFEST      = JSON.parse(fs.readFileSync(path.join(ROOT, 'jread', 'manifest.json'), 'utf8'));

// 建一個 JSDOM 環境，eval namespace.js + x-thread.js。browser.runtime.getManifest
// 要 stub，否則 namespace.js 取版本號會炸。
function setupJsdom(url, extraScripts = []) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url,
    runScripts: 'outside-only'
  });
  const { window } = dom;
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.7.135' })
    }
  };
  window.eval(NAMESPACE_SRC);
  window.eval(XTHREAD_SRC);
  for (const src of extraScripts) {
    window.eval(src);
  }
  return { window, document: window.document, NS: window.__JRead };
}

// 建一個迷你 X timeline fixture——主推文 + N 個 reply / thread member cell。
// cellSpec: [{ author: 'philipinspain', text: '...', isMain?: bool, statusId?: '123' }, ...]
function buildXTimelineDom(cellSpecs, mainStatusId = '2056') {
  const cellsHtml = cellSpecs.map((s, i) => {
    const isMain = !!s.isMain;
    const statusLink = isMain
      ? `<a href="/${s.author}/status/${mainStatusId}"><time datetime="2026-05-18T00:00:00.000Z">7h</time></a>`
      : `<a href="/${s.author}/status/${i + 10000}"><time datetime="2026-05-18T00:00:00.000Z">5h</time></a>`;
    return `<div data-testid="cellInnerDiv"><div><div>
      <article role="article" data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/${s.author}"><span>${s.author}</span></a>
          <a href="/${s.author}"><span>@${s.author}</span></a>
          ${statusLink}
        </div>
        <div data-testid="tweetText"><span>${s.text}</span></div>
      </article>
    </div></div></div>`;
  }).join('');
  return `<!doctype html><html><body>
    <main role="main"><div data-testid="primaryColumn">
      <section><div>${cellsHtml}</div></section>
    </div></main>
  </body></html>`;
}

function setupJsdomWithBody(url, htmlBody) {
  const dom = new JSDOM(htmlBody, {
    url,
    runScripts: 'outside-only'
  });
  const { window } = dom;
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.7.135' })
    }
  };
  window.eval(NAMESPACE_SRC);
  window.eval(XTHREAD_SRC);
  return { window, document: window.document, NS: window.__JRead };
}

describe('x-thread v0.7.135 — module structure', () => {
  it('x-thread.js 必須宣告 isXStatusPage / extractStatusId / getAuthorHandle / findMainTweet / collectThreadArticles / enter / exit / isActive', () => {
    assert.match(XTHREAD_SRC, /function\s+isXStatusPage\s*\(/,
      'x-thread.js 缺 isXStatusPage——URL 判斷');
    assert.match(XTHREAD_SRC, /function\s+extractStatusId\s*\(/,
      'x-thread.js 缺 extractStatusId——從 URL 抽 status digits');
    assert.match(XTHREAD_SRC, /function\s+getAuthorHandle\s*\(/,
      'x-thread.js 缺 getAuthorHandle——讀作者 handle');
    assert.match(XTHREAD_SRC, /function\s+findMainTweet\s*\(/,
      'x-thread.js 缺 findMainTweet——找主推文 article');
    assert.match(XTHREAD_SRC, /function\s+collectThreadArticles\s*\(/,
      'x-thread.js 缺 collectThreadArticles——同作者連續 thread member walk');
    assert.match(XTHREAD_SRC, /function\s+enter\s*\(/,
      'x-thread.js 缺 enter——建合成 reader 容器');
    assert.match(XTHREAD_SRC, /function\s+exit\s*\(/,
      'x-thread.js 缺 exit——清合成容器');
    assert.match(XTHREAD_SRC, /function\s+isActive\s*\(/,
      'x-thread.js 缺 isActive');
  });

  it('x-thread.js 必須 export NS.xThread 物件，含上述全部 function + READER_ATTR 常數', () => {
    assert.match(XTHREAD_SRC, /NS\.xThread\s*=\s*\{[\s\S]*isXStatusPage[\s\S]*enter[\s\S]*exit[\s\S]*\}/,
      'NS.xThread 必須暴露 isXStatusPage / enter / exit（main.js / detector.js 依賴）');
    assert.match(XTHREAD_SRC, /READER_ATTR\s*=\s*['"]data-jread-x-reader['"]/,
      'READER_ATTR 常數必須是 data-jread-x-reader——合成容器 marker、spec 與 source 雙邊綁定');
  });
});

describe('x-thread v0.7.135 — isXStatusPage URL 判斷', () => {
  let isXStatusPage;
  before(() => {
    const env = setupJsdom('https://example.com/');
    isXStatusPage = env.NS.xThread.isXStatusPage;
  });

  it('https://x.com/<user>/status/<digits> → true', () => {
    assert.strictEqual(isXStatusPage('https://x.com/philipinspain/status/2056152770298675234'), true);
  });

  it('https://www.x.com/<user>/status/<digits> → true', () => {
    assert.strictEqual(isXStatusPage('https://www.x.com/user/status/123'), true);
  });

  it('https://twitter.com/<user>/status/<digits> → true（舊網域）', () => {
    assert.strictEqual(isXStatusPage('https://twitter.com/user/status/123'), true);
  });

  it('https://mobile.twitter.com/<user>/status/<digits> → true', () => {
    assert.strictEqual(isXStatusPage('https://mobile.twitter.com/user/status/123'), true);
  });

  it('https://x.com/<user>/status/<digits>/photo/1 → true（變體後綴）', () => {
    assert.strictEqual(isXStatusPage('https://x.com/user/status/123/photo/1'), true);
  });

  it('https://x.com/<user>/status/<digits>/analytics → true（變體後綴）', () => {
    assert.strictEqual(isXStatusPage('https://x.com/user/status/123/analytics'), true);
  });

  it('https://x.com/<user> 純使用者頁 → false', () => {
    assert.strictEqual(isXStatusPage('https://x.com/philipinspain'), false);
  });

  it('https://x.com/home → false（首頁不算 status）', () => {
    assert.strictEqual(isXStatusPage('https://x.com/home'), false);
  });

  it('https://x.com/notifications → false（通知頁）', () => {
    assert.strictEqual(isXStatusPage('https://x.com/notifications'), false);
  });

  it('https://example.com/user/status/123 → false（非 x / twitter 站）', () => {
    assert.strictEqual(isXStatusPage('https://example.com/user/status/123'), false);
  });

  it('https://youtube.com/watch?v=status/123 → false', () => {
    assert.strictEqual(isXStatusPage('https://youtube.com/watch?v=status/123'), false);
  });

  it('無參數時讀 location.href', () => {
    const env = setupJsdom('https://x.com/user/status/999');
    assert.strictEqual(env.NS.xThread.isXStatusPage(), true);
    const env2 = setupJsdom('https://example.com/');
    assert.strictEqual(env2.NS.xThread.isXStatusPage(), false);
  });
});

describe('x-thread v0.7.135 — extractStatusId', () => {
  let extractStatusId;
  before(() => {
    const env = setupJsdom('https://example.com/');
    extractStatusId = env.NS.xThread.extractStatusId;
  });

  it('抽完整 X status URL 內的 digits', () => {
    assert.strictEqual(
      extractStatusId('https://x.com/philipinspain/status/2056152770298675234'),
      '2056152770298675234'
    );
  });

  it('帶 /photo/1 後綴仍能正確抽出 status digits', () => {
    assert.strictEqual(extractStatusId('https://x.com/user/status/123/photo/1'), '123');
  });

  it('無 status segment → null', () => {
    assert.strictEqual(extractStatusId('https://x.com/user'), null);
  });
});

describe('x-thread v0.7.135 — getAuthorHandle 跳過 /status/ 時間戳 link', () => {
  it('User-Name 區內第一個非 /status/ link 的 handle 視為作者', () => {
    const html = `<!doctype html><html><body>
      <article role="article">
        <div data-testid="User-Name">
          <a href="/philipinspain"><span>Felipe</span></a>
          <a href="/philipinspain"><span>@philipinspain</span></a>
          <a href="/philipinspain/status/2056"><time>7h</time></a>
        </div>
      </article>
    </body></html>`;
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    const article = env.document.querySelector('article');
    assert.strictEqual(env.NS.xThread.getAuthorHandle(article), 'philipinspain');
  });

  it('沒 User-Name 區的 article → null', () => {
    const html = `<!doctype html><html><body><article role="article"></article></body></html>`;
    const env = setupJsdomWithBody('https://x.com/', html);
    const article = env.document.querySelector('article');
    assert.strictEqual(env.NS.xThread.getAuthorHandle(article), null);
  });
});

describe('x-thread v0.7.135 — findMainTweet by status ID', () => {
  it('命中含 a[href*="/status/<ID>"] 的 article', () => {
    const specs = [
      { author: 'philipinspain', text: '主推文', isMain: true },
      { author: 'NYCBossGirl',   text: 'reply 1' }
    ];
    const html = buildXTimelineDom(specs, '2056');
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    const main = env.NS.xThread.findMainTweet('2056');
    assert.ok(main, 'findMainTweet 必須找到主推文');
    const handle = env.NS.xThread.getAuthorHandle(main);
    assert.strictEqual(handle, 'philipinspain');
  });

  it('statusId 對應不到任何 article → null', () => {
    const specs = [
      { author: 'philipinspain', text: '主推文', isMain: true }
    ];
    const html = buildXTimelineDom(specs, '2056');
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/9999', html);
    const main = env.NS.xThread.findMainTweet('9999'); // 對應不到
    assert.strictEqual(main, null);
  });
});

describe('x-thread v0.7.135 — collectThreadArticles 邊界', () => {
  it('單推文 case（後續第一則就是別人 reply）只回主推文', () => {
    const specs = [
      { author: 'philipinspain', text: '主推文', isMain: true },
      { author: 'NYCBossGirl',   text: 'reply 1' },
      { author: 'sixteen6699',   text: 'reply 2' }
    ];
    const html = buildXTimelineDom(specs, '2056');
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    const main = env.NS.xThread.findMainTweet('2056');
    const thread = env.NS.xThread.collectThreadArticles(main);
    assert.strictEqual(thread.length, 1, '單推文 thread 應只含主推文');
  });

  it('同作者連續 thread 都納入', () => {
    const specs = [
      { author: 'philipinspain', text: '主推文 1/3', isMain: true },
      { author: 'philipinspain', text: '推文 2/3' },
      { author: 'philipinspain', text: '推文 3/3' },
      { author: 'NYCBossGirl',   text: 'reply' }
    ];
    const html = buildXTimelineDom(specs, '2056');
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    const main = env.NS.xThread.findMainTweet('2056');
    const thread = env.NS.xThread.collectThreadArticles(main);
    assert.strictEqual(thread.length, 3, 'thread 應含主推文 + 2 條同作者後續');
  });

  it('中間隔別人 reply 後再有同作者 → 不納入後段同作者（i=7 case）', () => {
    const specs = [
      { author: 'philipinspain', text: '主推文', isMain: true },
      { author: 'NYCBossGirl',   text: 'reply 1' },
      { author: 'philipinspain', text: '另一則同作者推文（非 thread continuation）' }
    ];
    const html = buildXTimelineDom(specs, '2056');
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    const main = env.NS.xThread.findMainTweet('2056');
    const thread = env.NS.xThread.collectThreadArticles(main);
    assert.strictEqual(thread.length, 1,
      '中間隔別人 reply 後同作者推文不算 thread member——i=7 case 必須止損在第一個非作者 cell');
  });

  it('往前 walk：thread 起點以前的同作者推文也納入', () => {
    const specs = [
      { author: 'philipinspain', text: 'thread 第 1 則' },
      { author: 'philipinspain', text: 'thread 第 2 則（主推文點進來的）', isMain: true },
      { author: 'philipinspain', text: 'thread 第 3 則' },
      { author: 'NYCBossGirl',   text: 'reply' }
    ];
    const html = buildXTimelineDom(specs, '2056');
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    const main = env.NS.xThread.findMainTweet('2056');
    const thread = env.NS.xThread.collectThreadArticles(main);
    assert.strictEqual(thread.length, 3, 'thread 應含主推文前後共 3 則');
  });
});

describe('x-thread v0.7.135 — enter() / exit() 合成容器', () => {
  it('enter() 注入 <article data-jread-x-reader> 到 body 開頭', () => {
    const specs = [
      { author: 'philipinspain', text: '主推文 850 字', isMain: true },
      { author: 'NYCBossGirl',   text: 'reply' }
    ];
    const html = buildXTimelineDom(specs, '2056');
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    const container = env.NS.xThread.enter();
    assert.ok(container, 'enter() 必須回容器 element');
    assert.strictEqual(container.tagName, 'ARTICLE');
    assert.strictEqual(container.getAttribute('data-jread-x-reader'), '1');
    assert.strictEqual(env.document.body.firstElementChild, container,
      '合成容器必須是 body 第一個 child——讓 hideAncestorSiblings 自然清掉原 X UI');
  });

  it('合成容器內含主推文 article（clone 進去）', () => {
    const specs = [
      { author: 'philipinspain', text: 'unique-keyword-jread-test-123', isMain: true }
    ];
    const html = buildXTimelineDom(specs, '2056');
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    const container = env.NS.xThread.enter();
    assert.ok(container.textContent.includes('unique-keyword-jread-test-123'),
      '合成容器必須含主推文文字（cloneNode 後文字保留）');
    assert.strictEqual(container.querySelectorAll('article').length, 1,
      '單推文 case：合成容器內 1 個 article clone');
  });

  it('thread 多則：合成容器內 N 個 article clone（順序保持）', () => {
    const specs = [
      { author: 'philipinspain', text: '第 1 則', isMain: true },
      { author: 'philipinspain', text: '第 2 則' },
      { author: 'philipinspain', text: '第 3 則' }
    ];
    const html = buildXTimelineDom(specs, '2056');
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    const container = env.NS.xThread.enter();
    const articles = container.querySelectorAll('article');
    assert.strictEqual(articles.length, 3, 'thread 3 則 → 3 個 article clone');
    assert.ok(container.textContent.includes('第 1 則'));
    assert.ok(container.textContent.includes('第 2 則'));
    assert.ok(container.textContent.includes('第 3 則'));
  });

  it('找不到主推文時 enter() 回 null（不注入容器）', () => {
    const html = `<!doctype html><html><body><main></main></body></html>`;
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    const container = env.NS.xThread.enter();
    assert.strictEqual(container, null, '找不到主推文時 enter() 必須回 null');
    assert.strictEqual(env.document.querySelector('[data-jread-x-reader]'), null,
      '不可注入合成容器');
  });

  it('exit() 移除合成容器', () => {
    const specs = [{ author: 'philipinspain', text: 'main', isMain: true }];
    const html = buildXTimelineDom(specs, '2056');
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    env.NS.xThread.enter();
    assert.ok(env.NS.xThread.isActive(), 'enter 後 isActive=true');
    env.NS.xThread.exit();
    assert.strictEqual(env.NS.xThread.isActive(), false, 'exit 後 isActive=false');
    assert.strictEqual(env.document.querySelector('[data-jread-x-reader]'), null,
      'exit 後合成容器必須消失');
  });

  it('enter() 重複呼叫不會注入第二份容器（冪等）', () => {
    const specs = [{ author: 'philipinspain', text: 'main', isMain: true }];
    const html = buildXTimelineDom(specs, '2056');
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    env.NS.xThread.enter();
    env.NS.xThread.enter();
    const containers = env.document.querySelectorAll('[data-jread-x-reader]');
    assert.strictEqual(containers.length, 1, '重複 enter 必須冪等');
  });

  it('exit() 沒 enter 過時也安全（不丟例外）', () => {
    const env = setupJsdom('https://x.com/');
    assert.doesNotThrow(() => env.NS.xThread.exit());
  });
});

describe('x-thread v0.7.135 — detector.detect() X status 短路', () => {
  it('X status URL → detect() 回 isXThread=true / el=null / strategy=x-thread / confidence=1', () => {
    const specs = [{ author: 'philipinspain', text: 'main', isMain: true }];
    const html = buildXTimelineDom(specs, '2056');
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    env.window.eval(DETECTOR_SRC);
    const result = env.NS.detector.detect();
    assert.ok(result, 'X status URL 不應 no-op');
    assert.strictEqual(result.isXThread, true,
      'detect() 必須帶 isXThread=true（main.js 依此判斷走 enterXThreadMode）');
    assert.strictEqual(result.strategy, 'x-thread');
    assert.strictEqual(result.confidence, 1);
    assert.strictEqual(result.el, null,
      'X status 場景 el=null——合成容器在 main.js enterXThreadMode 才建立');
  });

  it('非 X 站 URL → detect() 不回 isXThread（走原本偵測）', () => {
    const env = setupJsdom('https://example.com/article');
    env.window.eval(DETECTOR_SRC);
    const result = env.NS.detector.detect();
    if (result) {
      assert.notStrictEqual(result.isXThread, true);
    }
  });

  it('X 首頁（非 /status/）→ detect() 不回 isXThread', () => {
    const env = setupJsdom('https://x.com/home');
    env.window.eval(DETECTOR_SRC);
    const result = env.NS.detector.detect();
    if (result) {
      assert.notStrictEqual(result.isXThread, true);
    }
  });
});

describe('x-thread v0.7.135 — main.js 整合', () => {
  it('main.js 必須含 enterXThreadMode helper', () => {
    assert.match(MAIN_SRC, /function\s+enterXThreadMode\s*\(/,
      'main.js 缺 enterXThreadMode async function');
  });

  it('main.js enterReaderMode 必須依 result.isXThread dispatch 到 enterXThreadMode', () => {
    assert.match(MAIN_SRC, /result\.isXThread[\s\S]{0,200}enterXThreadMode\s*\(/,
      'enterReaderMode 內必須有 if (result.isXThread) return enterXThreadMode() 分支');
  });

  it('main.js enterXThreadMode 必須呼叫 NS.xThread.enter() + 對合成容器跑 cleaner / styler', () => {
    assert.match(MAIN_SRC, /NS\.xThread\.enter\s*\(/,
      'enterXThreadMode 內必須呼叫 NS.xThread.enter()');
    // v0.8.37：styler.apply 等共用收尾搬進 finalizeEnter（三路徑單一資料源）；
    // cleaner.clean(container) 是 x-thread 路徑特有、仍在本函式內
    const m = MAIN_SRC.match(/function\s+enterXThreadMode[\s\S]+?(?=\n {0,2}(?:async )?function )/);
    assert.ok(m, '抓不到 enterXThreadMode body');
    assert.match(m[0], /NS\.cleaner\s*\?\s*NS\.cleaner\.clean\s*\(\s*container/,
      'enterXThreadMode 必須對合成容器呼叫 cleaner.clean(container)');
    assert.match(m[0], /return finalizeEnter\(container, settings\)/,
      'enterXThreadMode 必須走 finalizeEnter 共用收尾（styler.apply / 模組同步 / keyguard）');
    const fe = MAIN_SRC.match(/function finalizeEnter[\s\S]+?(?=\n {0,2}(?:async )?function )/);
    assert.ok(fe && /NS\.styler\s*\?\s*NS\.styler\.apply\s*\(\s*container/.test(fe[0]),
      'finalizeEnter 必須對容器呼叫 styler.apply(container)');
  });

  it('main.js exitReaderMode 必須呼叫 NS.xThread.exit() 清合成容器', () => {
    assert.match(MAIN_SRC, /NS\.xThread\s*&&[\s\S]{0,80}NS\.xThread\.exit\s*\(/,
      'exitReaderMode 必須呼叫 NS.xThread.exit() 清合成容器');
  });

  it('main.js GET_READER_STATE 必須走 NS.detector.probe()（v0.7.143 取代 detect()）', () => {
    // v0.7.143：GET_READER_STATE handler 改用 probe()——detector probe() 自己對
    // X status 場景回 { siteMode: 'x-thread' }（detector.js 內 NS.xThread.isXStatusPage()
    // 短路在 probe 入口）。popup.js 不認 'x-thread'、走預設 toggle 文字 + readwiseBtn
    // 看 active flag，與 v0.7.135 行為一致。
    assert.match(MAIN_SRC, /NS\.detector\.probe\s*\(/,
      'GET_READER_STATE handler 必須呼 NS.detector.probe()，避免原 detect() 副作用（shadow replica appendChild）');
  });

  it('detector.probe() 必須對 X status 場景回 siteMode=x-thread', () => {
    // probe() body 內必須含 NS.xThread.isXStatusPage check + return siteMode='x-thread'
    const DETECTOR_SRC = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'jread', 'content', 'detector.js'), 'utf8'
    );
    assert.match(DETECTOR_SRC, /isXStatusPage[\s\S]{0,200}siteMode:\s*['"]x-thread['"]/,
      'detector.probe() 必須對 NS.xThread.isXStatusPage() 命中時回 siteMode=x-thread');
  });
});

describe('x-thread v0.7.137 — author header 保留', () => {
  // 動機：v0.7.135 合成容器路線下，原 X header（avatar + display name + handle）
  // clone 進來後被 cleaner 的祖先 wrapper hide rule 連帶 hide（rect=0、整列消
  // 失），使用者看到沒作者的「裸推文」。修法：x-thread.js 新增 extractAuthorInfo
  // + createAuthorHeader + injectAuthorHeaders，main.js 在 cleaner 之後呼叫
  // injectAuthorHeaders 補上合成 author header（cleaner 看不到 = 不會被它的
  // rule 命中）。

  it('x-thread.js 必須宣告 extractAuthorInfo / createAuthorHeader / injectAuthorHeaders', () => {
    assert.match(XTHREAD_SRC, /function\s+extractAuthorInfo\s*\(/,
      'x-thread.js 缺 extractAuthorInfo——從原 article 抽 displayName / handle / avatarSrc');
    assert.match(XTHREAD_SRC, /function\s+createAuthorHeader\s*\(/,
      'x-thread.js 缺 createAuthorHeader——產 <header data-jread-x-author> 合成元素');
    assert.match(XTHREAD_SRC, /function\s+injectAuthorHeaders\s*\(/,
      'x-thread.js 缺 injectAuthorHeaders——在 cleaner 跑完後注入合成 header');
  });

  it('NS.xThread 必須 export injectAuthorHeaders + AUTHOR_ATTR', () => {
    assert.match(XTHREAD_SRC, /NS\.xThread\s*=\s*\{[\s\S]*injectAuthorHeaders[\s\S]*\}/,
      'NS.xThread 必須暴露 injectAuthorHeaders——main.js enterXThreadMode 在 cleaner 後依此呼叫');
    assert.match(XTHREAD_SRC, /AUTHOR_ATTR\s*=\s*['"]data-jread-x-author['"]/,
      'AUTHOR_ATTR 常數必須是 data-jread-x-author——spec 與 source 雙邊綁定');
  });

  it('extractAuthorInfo 從 User-Name span 抽 display name + handle', () => {
    const env = setupJsdom('https://x.com/');
    const article = env.document.createElement('article');
    article.innerHTML = `
      <div data-testid="User-Name">
        <span>Felipe Pasco</span>
        <span>@philipinspain</span>
      </div>
    `;
    const info = env.NS.xThread.extractAuthorInfo(article);
    assert.strictEqual(info.displayName, 'Felipe Pasco');
    assert.strictEqual(info.handle, '@philipinspain');
  });

  it('extractAuthorInfo 從 UserAvatar-* 區的 img 抽 src', () => {
    const env = setupJsdom('https://x.com/');
    const article = env.document.createElement('article');
    article.innerHTML = `
      <div data-testid="UserAvatar-Container-philipinspain">
        <img src="https://pbs.twimg.com/profile_images/abc/photo.jpg" alt="">
      </div>
      <div data-testid="User-Name"><span>Felipe</span></div>
    `;
    const info = env.NS.xThread.extractAuthorInfo(article);
    assert.ok(info.avatarSrc && info.avatarSrc.includes('profile_images'),
      'avatarSrc 必須從 UserAvatar-* div 的 img 抽出');
  });

  it('extractAuthorInfo handle 必須以 @ 開頭、且跳過超長 span（推文本體）', () => {
    const env = setupJsdom('https://x.com/');
    const article = env.document.createElement('article');
    article.innerHTML = `
      <div data-testid="User-Name">
        <span>Felipe Pasco</span>
        <span>@philipinspain</span>
      </div>
      <div data-testid="tweetText"><span>這是很長的推文本文不該被誤認為 handle 或 display name 的 span，長度超過 60 字會被 filter 過濾掉</span></div>
    `;
    const info = env.NS.xThread.extractAuthorInfo(article);
    assert.strictEqual(info.displayName, 'Felipe Pasco');
    assert.strictEqual(info.handle, '@philipinspain');
  });

  it('createAuthorHeader 產 <header data-jread-x-author> + 含 avatar img + strong + span', () => {
    const env = setupJsdom('https://x.com/');
    const header = env.NS.xThread.createAuthorHeader({
      displayName: 'Felipe Pasco',
      handle: '@philipinspain',
      avatarSrc: 'https://example.com/avatar.jpg'
    });
    assert.strictEqual(header.tagName, 'HEADER');
    assert.strictEqual(header.getAttribute('data-jread-x-author'), '1');
    assert.ok(header.querySelector('img[data-jread-x-avatar]'), '必須含 avatar img');
    assert.ok(header.querySelector('strong'), '必須含 strong tag（display name）');
    assert.ok(header.querySelector('span[data-jread-x-handle]'), '必須含 handle span');
    assert.strictEqual(header.querySelector('strong').textContent, 'Felipe Pasco');
    assert.strictEqual(header.querySelector('span[data-jread-x-handle]').textContent, '@philipinspain');
  });

  it('createAuthorHeader 不可含 class（避開 cleaner class-based keyword rule）+ 不可含 button', () => {
    const env = setupJsdom('https://x.com/');
    const header = env.NS.xThread.createAuthorHeader({
      displayName: 'Felipe',
      handle: '@felipe',
      avatarSrc: 'https://example.com/a.jpg'
    });
    // 整棵 subtree 不應有任何 class attribute
    const withClass = header.querySelectorAll('[class]');
    assert.strictEqual(withClass.length, 0,
      '合成 author header 全棵不可有 class——cleaner 的 NOISE_KEYWORD_RE 走 class，data-attr 從根本繞過');
    assert.strictEqual(header.querySelectorAll('button').length, 0,
      '不可有 button——hideInsideArticleAllButtons 會清掉所有 button');
  });

  it('injectAuthorHeaders 在 enter() 後注入 N 個 header 在 N 個 article clone 之前', () => {
    const specs = [
      { author: 'philipinspain', text: 'main tweet', isMain: true },
      { author: 'philipinspain', text: 'continuation' }
    ];
    const html = buildXTimelineDom(specs, '2056');
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    env.NS.xThread.enter();
    const injected = env.NS.xThread.injectAuthorHeaders();
    assert.strictEqual(injected, 2, '兩則 thread member 應該注入 2 個 author header');
    const container = env.document.querySelector('[data-jread-x-reader]');
    const headers = container.querySelectorAll(':scope > header[data-jread-x-author]');
    assert.strictEqual(headers.length, 2);
    // 順序：每個 header 必須緊跟在對應 article clone 之前
    const children = Array.from(container.children);
    assert.strictEqual(children[0].tagName, 'HEADER',
      '第一個 child 必須是 author header（不是 article clone）');
    assert.strictEqual(children[1].tagName, 'ARTICLE');
    assert.strictEqual(children[2].tagName, 'HEADER');
    assert.strictEqual(children[3].tagName, 'ARTICLE');
  });

  it('injectAuthorHeaders 合成 header 必須含 display name + handle 文字（forcing：使用者看得到作者）', () => {
    const specs = [{ author: 'philipinspain', text: 'main', isMain: true }];
    const html = buildXTimelineDom(specs, '2056');
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    env.NS.xThread.enter();
    env.NS.xThread.injectAuthorHeaders();
    const container = env.document.querySelector('[data-jread-x-reader]');
    const header = container.querySelector('header[data-jread-x-author]');
    assert.ok(header, 'reader 容器必須有合成 author header');
    const text = header.textContent;
    assert.ok(text.includes('philipinspain'),
      '合成 header textContent 必須含 handle / display name——使用者看得到作者');
  });

  it('exit() 必須清掉 _lastThreadArticles 內部 state（避免 leak 引用阻 GC）', () => {
    const specs = [{ author: 'philipinspain', text: 'main', isMain: true }];
    const html = buildXTimelineDom(specs, '2056');
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    env.NS.xThread.enter();
    env.NS.xThread.exit();
    // exit 後 injectAuthorHeaders 應無容器可注入，回 0（不丟例外）
    assert.strictEqual(env.NS.xThread.injectAuthorHeaders(), 0,
      'exit 後 injectAuthorHeaders 應安全 no-op 回 0');
  });

  it('main.js enterXThreadMode 必須在 cleaner.clean 之後、finalizeEnter（styler.apply）之前呼叫 NS.xThread.injectAuthorHeaders', () => {
    // v0.8.37：styler.apply 搬進 finalizeEnter 共用收尾——順序合約改成
    // cleaner.clean → injectAuthorHeaders → finalizeEnter（內含 styler.apply）
    const m = MAIN_SRC.match(/function\s+enterXThreadMode[\s\S]+?(?=\n {0,2}(?:async )?function )/);
    assert.ok(m, '抓不到 enterXThreadMode body');
    const body = m[0];
    const cleanerIdx = body.search(/NS\.cleaner\.clean\s*\(/);
    const injectIdx = body.search(/NS\.xThread\.injectAuthorHeaders\s*\(/);
    const finalizeIdx = body.search(/return finalizeEnter\(/);
    assert.ok(cleanerIdx >= 0, 'enterXThreadMode 應有 NS.cleaner.clean call');
    assert.ok(injectIdx >= 0, 'enterXThreadMode 應有 NS.xThread.injectAuthorHeaders call（v0.7.137 新增）');
    assert.ok(finalizeIdx >= 0, 'enterXThreadMode 應走 finalizeEnter 收尾');
    assert.ok(cleanerIdx < injectIdx,
      'injectAuthorHeaders 必須在 cleaner.clean 之後——讓 cleaner 看不到合成 header 不會 hide 它');
    assert.ok(injectIdx < finalizeIdx,
      'injectAuthorHeaders 必須在 finalizeEnter（styler.apply）之前——讓 styler 能 apply typography 到合成 header');
  });
});

// v0.7.160：X 推文 / Article tweetPhoto 圖片 unwrap regression
// 動機：Jimmy 2026-05-22 回報 X article（https://x.com/EEEEYHN/status/2057397813999456759）
// reader mode 進入後缺所有圖片。probe 揭穿：tweetPhoto 多層 wrapper（padding-bottom
// hack + absolute + overflow:hidden）+ a-link 包圖被通用 cleaner 規則
// （hideInsideArticleAbsoluteOverlays / hideInsideArticleIconOnlyLinks /
// resetMediaPlaceholderPadding 只看 direct parent）誤殺。修法：enter() cloneNode
// 後對每個 [data-testid="tweetPhoto"] 找最近 a 祖先 → replaceWith
// <figure data-jread-x-media><img></figure>；figure 是 PRESERVE_SEL 內 tag，
// cleaner 自動 skip 內部 hide rule。
//
// 此 spec 覆蓋 unwrapTweetMedia() 結構行為：
//   - 普通推文：a[href*="/photo/"] 包 img → 用 a 當 replace target
//   - X Article：tweetPhoto 包 img、外層 a[href*="/article/"] 是 photo link → 用 a 當 target
//   - 沒外層 a 時直接 unwrap tweetPhoto 本身
//   - removeAttribute('style') 清原站 inline position:absolute 等
//   - 跳過含 tweetText 的 a（不能跨段落 unwrap）
function buildTweetPhotoCell(author, mainStatusId, photoConfig) {
  // photoConfig: { wrapType: 'photo-link'|'article-link'|'none', count: 1..N }
  const photoEls = [];
  for (let i = 0; i < photoConfig.count; i++) {
    const innerImg = `<img alt="圖片" src="https://pbs.twimg.com/media/test${i}.jpg" data-testid="tweetPhoto-img-${i}">`;
    const tweetPhoto = `<div data-testid="tweetPhoto" aria-label="圖片"><div style="position:absolute;padding-bottom:50%"><div><div>${innerImg}</div></div></div></div>`;
    if (photoConfig.wrapType === 'photo-link') {
      photoEls.push(`<a href="/${author}/status/${mainStatusId}/photo/${i + 1}">${tweetPhoto}</a>`);
    } else if (photoConfig.wrapType === 'article-link') {
      photoEls.push(`<a href="/${author}/article/${mainStatusId}">${tweetPhoto}</a>`);
    } else {
      photoEls.push(tweetPhoto);
    }
  }
  return `<div data-testid="cellInnerDiv"><div><div>
    <article role="article" data-testid="tweet">
      <div data-testid="User-Name">
        <a href="/${author}"><span>${author}</span></a>
        <a href="/${author}"><span>@${author}</span></a>
        <a href="/${author}/status/${mainStatusId}"><time datetime="2026-05-22T00:00:00.000Z">5h</time></a>
      </div>
      <div data-testid="tweetText"><span>主推文文字</span></div>
      ${photoEls.join('')}
    </article>
  </div></div></div>`;
}

describe('x-thread v0.7.160 — unwrapTweetMedia tweetPhoto 圖片解纏', () => {
  it('unwrapTweetMedia 必須 export 在 NS.xThread', () => {
    const env = setupJsdom('https://x.com/');
    assert.strictEqual(typeof env.NS.xThread.unwrapTweetMedia, 'function',
      'NS.xThread.unwrapTweetMedia 必須 export — 後續 main.js / 測試依賴');
  });

  it('普通推文：a[href*="/photo/"] 包 tweetPhoto → unwrap 後 a 被 figure 取代', () => {
    const cells = buildTweetPhotoCell('philipinspain', '2056', { wrapType: 'photo-link', count: 1 });
    const html = `<!doctype html><html><body><main><section><div>${cells}</div></section></main></body></html>`;
    const env = setupJsdomWithBody('https://x.com/philipinspain/status/2056', html);
    const container = env.NS.xThread.enter();
    assert.ok(container);
    // tweetPhoto wrapper + a wrapper 都應被替換掉，剩 figure
    assert.strictEqual(container.querySelectorAll('[data-testid="tweetPhoto"]').length, 0,
      'unwrap 後 [data-testid="tweetPhoto"] 必須消失');
    assert.strictEqual(container.querySelectorAll('a[href*="/photo/"]').length, 0,
      'unwrap 後 photo a 必須消失（被 figure 取代）');
    const figs = container.querySelectorAll('figure[data-jread-x-media]');
    assert.strictEqual(figs.length, 1, '1 張圖 → 1 個 figure');
    assert.strictEqual(figs[0].querySelector('img').getAttribute('data-jread-x-tweet-photo'), '1',
      'img 必須被標記 data-jread-x-tweet-photo（保留 src，從原 tweetPhoto 抽出）');
  });

  it('X Article：a[href*="/article/"] 包 tweetPhoto 不含 tweetText → unwrap 同樣命中', () => {
    // X Article 結構：article-link 包 tweetPhoto 但不跨段落
    const cellsHtml = `<div data-testid="cellInnerDiv"><div><div>
      <article role="article" data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/EEEEYHN"><span>EYHN</span></a>
          <a href="/EEEEYHN/status/2057"><time>5h</time></a>
        </div>
        <div data-testid="tweetText"><span>article 主文</span></div>
        <div data-testid="twitterArticleReadView">
          <a href="/EEEEYHN/article/2057">
            <div data-testid="tweetPhoto"><div><img src="https://pbs.twimg.com/media/x.jpg"></div></div>
          </a>
          <a href="/EEEEYHN/article/2057">
            <div data-testid="tweetPhoto"><div><img src="https://pbs.twimg.com/media/y.jpg"></div></div>
          </a>
        </div>
      </article>
    </div></div></div>`;
    const html = `<!doctype html><html><body><main><section><div>${cellsHtml}</div></section></main></body></html>`;
    const env = setupJsdomWithBody('https://x.com/EEEEYHN/status/2057', html);
    const container = env.NS.xThread.enter();
    assert.ok(container);
    assert.strictEqual(container.querySelectorAll('[data-testid="tweetPhoto"]').length, 0,
      'X Article：2 張 tweetPhoto 必須全 unwrap');
    assert.strictEqual(container.querySelectorAll('a[href*="/article/"]').length, 0,
      '包圖的 article-link a 必須被 figure 取代');
    assert.strictEqual(container.querySelectorAll('figure[data-jread-x-media]').length, 2,
      '2 張圖 → 2 個 figure');
  });

  it('沒外層 a：tweetPhoto 直接被 figure 取代（fallback path）', () => {
    const cellsHtml = `<div data-testid="cellInnerDiv"><div><div>
      <article role="article" data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/user"><span>user</span></a>
          <a href="/user/status/123"><time>5h</time></a>
        </div>
        <div data-testid="tweetPhoto"><div><img src="https://pbs.twimg.com/media/z.jpg"></div></div>
      </article>
    </div></div></div>`;
    const html = `<!doctype html><html><body><main><section><div>${cellsHtml}</div></section></main></body></html>`;
    const env = setupJsdomWithBody('https://x.com/user/status/123', html);
    const container = env.NS.xThread.enter();
    assert.strictEqual(container.querySelectorAll('[data-testid="tweetPhoto"]').length, 0,
      '沒外層 a 也要 unwrap tweetPhoto 自身');
    assert.strictEqual(container.querySelectorAll('figure[data-jread-x-media]').length, 1);
  });

  it('img 必須補 inline opacity:1 !important（v0.7.161：X stylesheet img.css-9pa8cd opacity:0 lazy-load fade 殘留修法）', () => {
    const cellsHtml = `<div data-testid="cellInnerDiv"><div><div>
      <article role="article" data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/u"><span>u</span></a>
          <a href="/u/status/9"><time>5h</time></a>
        </div>
        <div data-testid="tweetPhoto">
          <a href="/u/status/9/photo/1"><img src="x.jpg" class="css-9pa8cd"></a>
        </div>
      </article>
    </div></div></div>`;
    const html = `<!doctype html><html><body><main><section>${cellsHtml}</section></main></body></html>`;
    const env = setupJsdomWithBody('https://x.com/u/status/9', html);
    const container = env.NS.xThread.enter();
    const img = container.querySelector('figure[data-jread-x-media] img');
    assert.ok(img);
    assert.strictEqual(img.style.opacity, '1',
      'img.style.opacity 必須是 1（覆寫 X stylesheet 的 opacity:0 lazy-load placeholder）');
    assert.strictEqual(img.style.getPropertyPriority('opacity'), 'important',
      'opacity 必須是 !important——只 inline 不夠，X stylesheet rule specificity 高，必須 !important 才贏');
  });

  it('img 的原站 inline style 必須清掉（避免 position:absolute / blur 殘留）', () => {
    const cellsHtml = `<div data-testid="cellInnerDiv"><div><div>
      <article role="article" data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/u"><span>u</span></a>
          <a href="/u/status/9"><time>5h</time></a>
        </div>
        <div data-testid="tweetPhoto">
          <a href="/u/status/9/photo/1"><img src="x.jpg" style="position:absolute;top:0;left:0;filter:blur(20px)"></a>
        </div>
      </article>
    </div></div></div>`;
    const html = `<!doctype html><html><body><main><section>${cellsHtml}</section></main></body></html>`;
    const env = setupJsdomWithBody('https://x.com/u/status/9', html);
    const container = env.NS.xThread.enter();
    const img = container.querySelector('figure[data-jread-x-media] img');
    assert.ok(img, 'figure 內必須含 img');
    // 原站 inline style 含 position:absolute / top / left / filter:blur 必須清掉
    // （unwrap 內 removeAttribute('style')）。
    // 但 v0.7.161 之後 unwrap 會接著 setProperty opacity:1 !important，所以
    // style attribute 不可能為 null——驗 position / top / left / filter 個別欄位
    // 都為空字串，opacity 為 1，即清得乾淨。
    assert.strictEqual(img.style.position, '', '原站 position:absolute 必須清掉');
    assert.strictEqual(img.style.top, '', '原站 top 必須清掉');
    assert.strictEqual(img.style.left, '', '原站 left 必須清掉');
    assert.strictEqual(img.style.filter, '', '原站 filter:blur 必須清掉');
    assert.strictEqual(img.style.opacity, '1', 'unwrap 後 opacity 必須補 1');
  });

  it('包 tweetText 的 a 不算 photo link：圖片若在這種 a 內，向上找祖先停在前一層', () => {
    // 邊界：a 同時包 tweetText + tweetPhoto（罕見但 X 某些 inline embed 可能）
    // —— 此時不能 replace 整個 a（會吃掉 tweetText），應 fallback 用 tweetPhoto 當 target
    const cellsHtml = `<div data-testid="cellInnerDiv"><div><div>
      <article role="article" data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/u"><span>u</span></a>
          <a href="/u/status/9"><time>5h</time></a>
        </div>
        <a href="/u/status/9">
          <div data-testid="tweetText"><span>跨段落文字</span></div>
          <div data-testid="tweetPhoto"><img src="x.jpg"></div>
        </a>
      </article>
    </div></div></div>`;
    const html = `<!doctype html><html><body><main><section>${cellsHtml}</section></main></body></html>`;
    const env = setupJsdomWithBody('https://x.com/u/status/9', html);
    const container = env.NS.xThread.enter();
    assert.strictEqual(container.querySelectorAll('[data-testid="tweetPhoto"]').length, 0,
      'tweetPhoto 必須 unwrap');
    assert.ok(container.querySelector('a[href="/u/status/9"]'),
      '包 tweetText 的 a 必須保留（不可被 figure 取代，會丟失 tweetText）');
    assert.ok(container.textContent.includes('跨段落文字'),
      'tweetText 內容必須保留');
  });
});

describe('x-thread v0.7.135 — manifest / popup-core / namespace 同步', () => {
  it('manifest content_scripts 必須含 content/x-thread.js', () => {
    const files = MANIFEST.content_scripts[0].js;
    assert.ok(files.includes('content/x-thread.js'),
      'manifest content_scripts 必須含 content/x-thread.js');
  });

  it('manifest content_scripts 順序：x-thread.js 必須在 detector.js 之前', () => {
    const files = MANIFEST.content_scripts[0].js;
    const xIdx = files.indexOf('content/x-thread.js');
    const dIdx = files.indexOf('content/detector.js');
    assert.ok(xIdx >= 0 && dIdx >= 0);
    assert.ok(xIdx < dIdx,
      'x-thread.js 必須在 detector.js 之前——detector.js eval 時 NS.xThread 必須已掛載');
  });

  it('popup-core.js CONTENT_SCRIPT_FILES 必須含 content/x-thread.js（fallback inject 順序對齊 manifest）', () => {
    assert.ok(/['"]content\/x-thread\.js['"]/.test(POPUP_CORE),
      'popup-core CONTENT_SCRIPT_FILES 必須含 content/x-thread.js——和 manifest 同步、避免 fallback inject 漏載');
  });

  it('namespace.js 必須含 xThread: null 佔位', () => {
    assert.match(NAMESPACE_SRC, /xThread\s*:\s*null/,
      'namespace.js 必須有 xThread: null 佔位——讓 NS.xThread 在 x-thread.js 載入前不是 undefined');
  });
});

// v1.0.0 — normalizeCloneForPaging：翻頁模式 X 推文 layout 正規化
// -----------------------------------------------------------------------------
// Bug（Page Rounds 2026-06-23 cage 補測 x.com #100）：長推文（長文 + 多圖）在
// 翻頁模式下 page 1 只剩合成作者頭 + 一大片空白，內容整塊被推到第 2 欄且寬度
// 不受欄寬約束、右側溢出被 card overflow-x:hidden 裁掉。
//
// 根因（cage rect 實證）：x-thread enter() 用 cloneNode(true) 把 X 推文整套巢狀
// flex 容器 clone 進合成 <article>，最外層 X <article> 帶 overflow:hidden。
// styler 翻頁模式用 CSS 多欄分頁，但 (1) flex/grid 容器不跨欄分裂、(2) overflow
// 非 visible 的元素是 monolithic box 規範上不可被欄邊界分裂 → 整塊被推到下一欄。
//
// 修法 normalizeCloneForPaging：把 clone 內所有容器中和為 display:block +
// overflow:visible（img/figure 排除——媒體排版交給 styler、img overflow:clip 無害），
// 讓推文內容像一般 article 散文流跨欄分頁、受欄寬約束。
//
// 訊號層次：jsdom 不算 CSS 多欄 layout/rect，本 spec 只驗「函式對 flex/grid +
// overflow 非 visible 的容器中和、且 img/figure 不動」的邏輯；真實跨欄分頁
// + page 1 可讀已由 cage rect + 截圖驗過（2026-06-23，text 回 column 1）。

describe('x-thread v1.0.0 — normalizeCloneForPaging（翻頁 layout 正規化）', () => {
  it('x-thread.js 必須宣告 normalizeCloneForPaging 並掛在 NS.xThread', () => {
    assert.match(XTHREAD_SRC, /function\s+normalizeCloneForPaging\s*\(/,
      'x-thread.js 必須有 normalizeCloneForPaging 函式');
    assert.match(XTHREAD_SRC, /normalizeCloneForPaging,/,
      'NS.xThread 必須 export normalizeCloneForPaging');
  });

  it('enter() 必須在合成容器插入 DOM 後呼叫 normalizeCloneForPaging', () => {
    const enterFn = XTHREAD_SRC.match(/function\s+enter\s*\(\)[\s\S]*?\n  \}/);
    assert.ok(enterFn, '必須能抓到 enter() body');
    assert.match(enterFn[0], /insertBefore\(container[\s\S]*normalizeCloneForPaging\(container\)/,
      'normalizeCloneForPaging 必須在 container 插入 DOM 之後呼叫（getComputedStyle 需 live DOM）');
  });

  function setupContainer() {
    const { window, NS } = setupJsdom('https://x.com/u/status/2056');
    const doc = window.document;
    const container = doc.createElement('article');
    container.setAttribute('data-jread-x-reader', '1');
    // 模擬 X clone 結構：flex 容器 + overflow:hidden 的 <article> + 內含 img/figure
    container.innerHTML =
      '<article style="display:flex;overflow:hidden">' +
        '<div id="flexwrap" style="display:flex">' +
          '<div id="tweettext" style="display:block">推文內文</div>' +
          '<div id="gridwrap" style="display:grid;overflow:clip"></div>' +
          '<figure id="fig" style="overflow:hidden"><img id="img" style="display:block;overflow:hidden"></figure>' +
        '</div>' +
      '</article>';
    doc.body.appendChild(container);
    NS.xThread.normalizeCloneForPaging(container);
    return { doc, container };
  }

  it('flex / grid 容器被中和為 display:block !important', () => {
    const { doc } = setupContainer();
    const xArticle = doc.querySelector('[data-jread-x-reader] > article');
    const flexwrap = doc.getElementById('flexwrap');
    const gridwrap = doc.getElementById('gridwrap');
    for (const [name, el] of [['X article', xArticle], ['flexwrap', flexwrap], ['gridwrap', gridwrap]]) {
      assert.strictEqual(el.style.getPropertyValue('display'), 'block', `${name} display 應被中和為 block`);
      assert.strictEqual(el.style.getPropertyPriority('display'), 'important', `${name} display:block 必須帶 !important`);
    }
  });

  it('overflow 非 visible 的容器被中和為 overflow:visible !important（含 hidden / clip）', () => {
    const { doc } = setupContainer();
    const xArticle = doc.querySelector('[data-jread-x-reader] > article');
    const gridwrap = doc.getElementById('gridwrap');
    for (const [name, el] of [['X article(hidden)', xArticle], ['gridwrap(clip)', gridwrap]]) {
      assert.strictEqual(el.style.getPropertyValue('overflow'), 'visible', `${name} overflow 應被中和為 visible`);
      assert.strictEqual(el.style.getPropertyPriority('overflow'), 'important', `${name} overflow:visible 必須帶 !important`);
    }
  });

  it('img / figure 不被動（媒體排版交給 styler、img overflow:clip 無害）', () => {
    const { doc } = setupContainer();
    const img = doc.getElementById('img');
    const fig = doc.getElementById('fig');
    // img 原 inline display:block / overflow:hidden 不被函式改寫成 visible
    assert.strictEqual(img.style.getPropertyValue('overflow'), 'hidden',
      'img overflow 不可被函式改動（函式排除 IMG）');
    assert.strictEqual(fig.style.getPropertyValue('overflow'), 'hidden',
      'figure overflow 不可被函式改動（函式排除 FIGURE）');
  });
});
