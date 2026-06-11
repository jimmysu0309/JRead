// JRead — main.js enterReaderMode / exitReaderMode 重入保護（v0.7.143）
//
// Bug：enterReaderMode 是 async（await getSettings），中間時間窗若第二次 toggle
// 進來會看到 NS.state.active 仍 false、再跑一次 enterReaderMode；
// NS.state.hiddenEls + originalStyles 被第二輪 snapshot 蓋掉、第一輪 hide 的
// 元素永遠回不來。快速雙擊快速鍵會觸發。
//
// 修法（v0.7.143）：main.js 加 local `enterInFlight` flag。enterReaderMode
// wrapper 在 inFlight 期間直接 return false、finally 清 flag。
//
// v0.8.37：exitInFlight 死 guard 移除——exitReaderModeImpl 全同步、flag 在
// 同一個 task 內 set→clear，沒有任何 async gap 能讓第二個呼叫觀察到 true；
// enterReaderMode 的 `|| exitInFlight` 同理永 false。本 spec 同步改驗
// 「exitInFlight 不得復活」（再加 exit 端 async gap 時必須重新設計互斥，
// 不可沿用舊死 guard）。
//
// jsdom 無法乾淨模擬 chrome.runtime + storage + async race，本 spec 是 forcing
// function：直接掃 main.js source 結構確認 guard 存在。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MAIN_JS_PATH = path.join(__dirname, '..', '..', 'jread', 'content', 'main.js');

describe('main.js — enterReaderMode/exitReaderMode 重入保護（v0.7.143）', () => {
  const src = fs.readFileSync(MAIN_JS_PATH, 'utf8');

  it('main.js 必須宣告 enterInFlight flag', () => {
    assert.ok(
      /let\s+enterInFlight\s*=\s*false/.test(src),
      'main.js 必須宣告 `let enterInFlight = false` 作為重入保護 flag'
    );
  });

  it('exitInFlight 死 guard 不得復活（v0.8.37 移除；exit 全同步、flag 永遠觀察不到 true）', () => {
    // 排除註解行（移除紀錄的註解會提及舊名）
    const codeOnly = src.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    assert.ok(
      !/exitInFlight/.test(codeOnly),
      'main.js 程式碼不得再出現 exitInFlight——exit 端若未來引入 async gap，互斥要重新設計、不可沿用舊死 guard'
    );
  });

  it('enterReaderMode 入口必須先 check inFlight 並 return false', () => {
    // 確認 enterReaderMode 函式 body 第一行包含 enterInFlight check
    // v0.7.155：簽名容許 0 或 1 個參數（auto-enable 新增 opts.silent）；invariant
    // 仍是 enterInFlight guard。
    const match = src.match(/async function enterReaderMode\([^)]*\)\s*\{([\s\S]{0,200})/);
    assert.ok(match, '必須找到 async function enterReaderMode(...) 宣告');
    assert.ok(
      /if\s*\(\s*enterInFlight/.test(match[1]),
      'enterReaderMode 入口必須 check enterInFlight；實際前 200 字元：\n' + match[1]
    );
  });

  it('exitReaderMode 入口必須 check NS.state.active（非 active no-op）', () => {
    const match = src.match(/function exitReaderMode\(\)\s*\{([\s\S]{0,400})/);
    assert.ok(match, '必須找到 function exitReaderMode() 宣告');
    assert.ok(
      /if\s*\(\s*!NS\.state\.active\s*\)\s*return/.test(match[1]),
      'exitReaderMode 入口必須 check !NS.state.active；實際前 400 字元：\n' + match[1]
    );
  });

  it('enterReaderMode wrapper 必須用 try/finally 清 flag（即使 impl throw 也要清）', () => {
    // 找 enterInFlight = true 後面附近必須有 finally { enterInFlight = false }
    const lines = src.split('\n');
    let setTrueLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/enterInFlight\s*=\s*true/.test(lines[i])) {
        setTrueLine = i;
        break;
      }
    }
    assert.notStrictEqual(setTrueLine, -1, '必須有 enterInFlight = true 行');
    // 在 setTrueLine 之後 30 行內必須出現 finally + enterInFlight = false
    const window = lines.slice(setTrueLine, setTrueLine + 30).join('\n');
    assert.ok(
      /finally\s*\{[\s\S]*enterInFlight\s*=\s*false/.test(window),
      'enterInFlight = true 後 30 行內必須有 finally { enterInFlight = false }；實際：\n' + window
    );
  });

});
