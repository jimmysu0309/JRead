// JRead — NS.enterFromContainer + reader.html 退出 hook（v1.0.22）
//
// 動機：Readwise Reader 整合需要在 reader.html（擴充自有頁）上把 Reader API 的
// html_content render 成 JRead 閱讀版型。重用既有 finalizeEnter（與 x-thread /
// fb-post 同款「自建 container 繞過 detector」路徑），不另造 styler。
//
// jsdom 無法乾淨 eval main.js（browser.runtime + storage + async 依賴，見
// main-enter-reader-reentrancy.spec.js 同款說明）——本 spec 是 forcing function：
// 掃 main.js / namespace.js source 結構，確認：
//   1. enterFromContainer 存在、跳過 cleaner（hiddenEls=[]）、走 finalizeEnter
//   2. NS.enterFromContainer export（reader-app.js 依賴）
//   3. exitReaderMode 有 readerHostPage hook（退出導回 feed、不剝版型）
//   4. namespace.js 有 readerHostPage / onReaderExit 佔位
//
// 行為（真實版型套用、即時重套、位置記憶）由 Playwright harness + 真機驗，不在此。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const MAIN_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'main.js'), 'utf8');
const NS_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'namespace.js'), 'utf8');

describe('enterFromContainer v1.0.22 — main.js 結構', () => {
  it('main.js 必須宣告 async function enterFromContainer(container)', () => {
    // v1.6.24：移除從未使用的 opts 死參數
    assert.match(MAIN_SRC, /async function\s+enterFromContainer\s*\(\s*container\s*\)/,
      'main.js 缺 enterFromContainer——reader.html 自建 container 的進入點');
  });

  it('enterFromContainer 必須 null-guard、設 articleEl、跳過 cleaner（hiddenEls=[]）、走 finalizeEnter', () => {
    const m = MAIN_SRC.match(/async function\s+enterFromContainer[\s\S]+?(?=\n {0,2}(?:async )?function )/);
    assert.ok(m, '抓不到 enterFromContainer body');
    const body = m[0];
    assert.match(body, /if\s*\(\s*!container\s*\)\s*return false/,
      'enterFromContainer 必須在 container 缺失時 return false');
    assert.match(body, /NS\.state\.articleEl\s*=\s*container/,
      'enterFromContainer 必須設 NS.state.articleEl = container');
    assert.match(body, /NS\.state\.hiddenEls\s*=\s*\[\]/,
      'enterFromContainer 必須設 hiddenEls=[] 跳過通用 cleaner（內容已是 Readwise 乾淨主文，比照 fb-post）');
    assert.match(body, /return finalizeEnter\(container, settings\)/,
      'enterFromContainer 必須走 finalizeEnter 共用收尾（重用 styler / positionMemory，單一資料源）');
    // finalizeEnter 本體仍對容器套 styler + beginSession（單一資料源，順帶確認沒被改壞）
    const fe = MAIN_SRC.match(/function finalizeEnter[\s\S]+?(?=\n {0,2}(?:async )?function )/);
    assert.ok(fe && /NS\.styler\s*\?\s*NS\.styler\.apply\s*\(\s*container/.test(fe[0]),
      'finalizeEnter 必須對容器呼叫 styler.apply(container)');
    assert.match(fe[0], /NS\.positionMemory\.beginSession\(spaRouteKey\(location\.href\)/,
      'finalizeEnter 必須以 spaRouteKey(location.href) 開 positionMemory session（reader.html?id=X 每篇一 key）');
  });

  it('main.js 必須 export NS.enterFromContainer = enterFromContainer', () => {
    assert.match(MAIN_SRC, /NS\.enterFromContainer\s*=\s*enterFromContainer/,
      'main.js 必須掛 NS.enterFromContainer——reader-app.js 依賴');
  });
});

describe('enterFromContainer v1.0.22 — exitReaderMode reader 頁 hook', () => {
  it('exitReaderMode 必須在 active 後、exitReaderModeImpl 前檢查 readerHostPage hook', () => {
    const m = MAIN_SRC.match(/function exitReaderMode\(\)\s*\{([\s\S]{0,500})\}/);
    assert.ok(m, '抓不到 exitReaderMode body');
    const body = m[1];
    // 先 active guard
    assert.match(body, /if\s*\(\s*!NS\.state\.active\s*\)\s*return/,
      'exitReaderMode 必須保留 !NS.state.active 早退');
    // readerHostPage hook：readerHostPage + onReaderExit → 呼叫並 return（不剝版型）
    assert.match(body, /NS\.state\.readerHostPage\s*&&\s*typeof\s+NS\.onReaderExit\s*===\s*['"]function['"]/,
      'exitReaderMode 必須檢查 NS.state.readerHostPage + NS.onReaderExit');
    const hookIdx = body.search(/NS\.onReaderExit\s*\(\s*\)/);
    const implIdx = body.search(/exitReaderModeImpl\s*\(\s*\)/);
    assert.ok(hookIdx >= 0 && implIdx >= 0, 'hook 與 exitReaderModeImpl 都應出現');
    assert.ok(hookIdx < implIdx,
      'readerHostPage hook 必須在 exitReaderModeImpl 之前——reader 頁退出走 hook（導回 feed）不剝版型');
    // hook 內必須 return（不繼續往下走 exitReaderModeImpl）
    assert.match(body, /NS\.onReaderExit\s*\(\s*\)\s*;?\s*\n\s*return\s*;/,
      'hook 命中後必須 return，避免又跑 exitReaderModeImpl');
  });
});

describe('enterFromContainer v1.0.22 — namespace.js 佔位', () => {
  it('namespace.js NS.state 必須有 readerHostPage 佔位（預設 false）', () => {
    assert.match(NS_SRC, /readerHostPage\s*:\s*false/,
      'NS.state 必須有 readerHostPage: false——一般內容頁退出走原本流程');
  });

  it('namespace.js 必須有 onReaderExit 佔位（預設 null）', () => {
    assert.match(NS_SRC, /onReaderExit\s*:\s*null/,
      'NS 必須有 onReaderExit: null 佔位（reader-app.js 掛載）');
  });
});
