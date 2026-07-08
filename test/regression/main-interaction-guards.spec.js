// JRead — main.js interaction layer guards（v1.6.24）
//
// 三條 race / 懸空防護的 forcing function（source-structure spec；這類 guard 的
// 觸發都需要真實 async race，jsdom 難以穩定重現，故驗「guard 存在於正確位置」）：
//
// 1. restoreReaderInteractions：await getSettings() 之後必須重跑 active guard。
//    失效情境：退出編輯模式觸發本函式 → await 期間閱讀模式被同步退出（SPA 導航
//    / popup toggle / debug bridge）→ await 回來後照樣 installKeyguard + 重掛
//    onEscKey → 非閱讀模式的原站頁面 keyguard 持續吞掉所有頁面快速鍵。
//
// 2. storage.onChanged 的 blockPageShortcuts 分支必須排除 cinemaActive。
//    失效情境：影院模式 active=true 但刻意不裝 keyguard（YouTube j/k/l/space/f/m
//    是 player 控制必備）；cinemaActive 的 early return 排在本分支之後，影院模式
//    中改 options 設定會裝上 keyguard、打殘 player 快速鍵直到退出。
//
// 3. getSettings 的 fallbackViaBackground 必須有 timeout 兜底。
//    失效情境：iOS SW 死亡後 sendMessage 石沉大海（callback 永不回）→ getSettings
//    懸空 → enterReaderMode 的 enterInFlight 永久卡 true → 之後所有 toggle 靜默
//    失效，使用者只能重整頁面。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const MAIN_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'main.js'), 'utf8');

describe('main.js — restoreReaderInteractions await 後重跑 guard（v1.6.24）', () => {
  it('await getSettings() 之後、動 listener 之前必須再查一次 active/cinemaActive/articleEl', () => {
    const m = MAIN_SRC.match(/async function restoreReaderInteractions\(\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(m, '抓不到 restoreReaderInteractions 函式本體');
    const body = m[0];
    const awaitIdx = body.indexOf('await getSettings()');
    assert.ok(awaitIdx !== -1, 'restoreReaderInteractions 必須 await getSettings()');
    const after = body.slice(awaitIdx);
    assert.match(after, /if\s*\(!NS\.state\.active\s*\|\|\s*NS\.state\.cinemaActive\s*\|\|\s*!NS\.state\.articleEl\)\s*return/,
      'await 之後缺重跑 guard——race 會把 keyguard / onEscKey 留在非閱讀模式頁面');
  });
});

describe('main.js — onChanged blockPageShortcuts 排除 cinema mode（v1.6.24）', () => {
  it('blockPageShortcuts 即時切換分支必須帶 !NS.state.cinemaActive 條件', () => {
    assert.match(MAIN_SRC, /if\s*\(\s*['"]blockPageShortcuts['"]\s+in\s+changes\s*&&\s*!NS\.state\.cinemaActive\s*\)/,
      'blockPageShortcuts onChanged 分支缺 cinemaActive 排除——影院模式中改設定會裝上 keyguard 打殘 YouTube player 快速鍵');
  });
});

describe('main.js — getSettings fallback timeout（v1.6.24）', () => {
  it('fallbackViaBackground 必須以 setTimeout 兜底 finish，且 callback 內 clearTimeout', () => {
    const m = MAIN_SRC.match(/const fallbackViaBackground\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\n      \};/);
    assert.ok(m, '抓不到 fallbackViaBackground');
    assert.match(m[0], /setTimeout\(\s*\(\)\s*=>\s*finish\(/,
      'fallbackViaBackground 缺 timeout 兜底——iOS SW 訊息石沉大海時 enterInFlight 永久卡死');
    assert.match(m[0], /clearTimeout\(/,
      'callback 內必須 clearTimeout，避免正常回覆後又 finish(undefined)');
  });
});
