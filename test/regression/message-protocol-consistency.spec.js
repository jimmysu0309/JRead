// JRead — 訊息協定三方一致 forcing function（v0.8.37）
//
// 動機（code review 批次 3）：訊息 type 字串散落 hardcode、無整體校對——
// 歷史上長出兩個死協定：REPORT_DETECTION_RESULT（content 7 處發送、全 repo
// 零接收、每次偵測白喚醒 SW 一次）與 UPDATE_SETTINGS（SW 有 case、零發送端）。
// 本 spec 把「NS.MSG 詞彙表 ↔ content 發送 ↔ SW switch case」三方綁死：
//   1. content 端 runtime.sendMessage 的 type 一律取自 NS.MSG（不可 inline 字串）
//   2. 「content → SW」的 MSG 常數必須有對應 SW case（防死發送）
//   3. SW 的每個 case 必須有發送端（防死 handler）
//
// 訊號層次：驗 source 字面結構，不驗 runtime 派送行為（jsdom 模擬不了跨
// context messaging；個別協定的功能行為由各自 spec 覆蓋）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JREAD_DIR } = require('../helpers');

const SW_SRC = fs.readFileSync(path.join(JREAD_DIR, 'background', 'service-worker.js'), 'utf8');
const NAMESPACE_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'namespace.js'), 'utf8');

const CONTENT_DIR = path.join(JREAD_DIR, 'content');
const CONTENT_SRCS = fs.readdirSync(CONTENT_DIR)
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({ name: f, src: fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8') }));

// NS.MSG 詞彙表（key: value 形式逐條解析）
function parseMsgTable() {
  const m = NAMESPACE_SRC.match(/MSG:\s*\{([\s\S]*?)\n    \}/);
  assert.ok(m, '抓得到 namespace.js 的 MSG 表');
  const entries = {};
  for (const line of m[1].split('\n')) {
    const e = line.match(/^\s*([A-Z_]+):\s*'([A-Z_]+)'/);
    if (e) entries[e[1]] = e[2];
  }
  return entries;
}

// SW switch case 集合
function parseSwCases() {
  return new Set([...SW_SRC.matchAll(/case\s+'([A-Z_]+)':/g)].map((m) => m[1]));
}

describe('訊息協定三方一致（v0.8.37）', () => {
  const MSG = parseMsgTable();
  const swCases = parseSwCases();

  it('MSG 表 key 與 value 必須同字（避免 alias 混淆）', () => {
    for (const [k, v] of Object.entries(MSG)) {
      assert.strictEqual(k, v, `MSG.${k} 的值必須是同名字串，實際 '${v}'`);
    }
  });

  it('content script 的 sendMessage type 不得 inline 字串（一律走 NS.MSG）', () => {
    for (const { name, src } of CONTENT_SRCS) {
      // 抓 safeSendMessage / sendMessage 呼叫中 type 為字面字串者
      const inline = [...src.matchAll(/(?:safeSendMessage|sendMessage)\(\s*\{\s*type:\s*'([A-Z_]+)'/g)];
      assert.deepStrictEqual(inline.map((m) => m[1]), [],
        `content/${name} 有 inline type 字串（${inline.map((m) => m[1]).join(', ')}）——必須收進 NS.MSG 詞彙表`);
    }
  });

  it('「content → SW」的 MSG 常數必須有對應 SW case（防死發送）', () => {
    // content → SW 的協定（popup → content / SW → content 的不在此列）
    const CONTENT_TO_SW = ['GET_SETTINGS', 'SET_ACTIVE_ICON', 'RESIZE_OWN_WINDOW',
      'CUSTOM_COMMAND', 'BG_WAKE_PING', 'JREAD_RELOAD', 'JREAD_DEBUG_SET_THEME'];
    for (const t of CONTENT_TO_SW) {
      assert.ok(MSG[t], `NS.MSG 必須含 ${t}`);
      assert.ok(swCases.has(t), `SW 必須有 case '${t}'（content 有發送端、SW 沒 handler = 死發送）`);
    }
  });

  it('SW 的每個 case 都必須有發送端（防死 handler，UPDATE_SETTINGS 教訓）', () => {
    const POPUP_SRC = fs.readFileSync(path.join(JREAD_DIR, 'popup', 'popup.js'), 'utf8') +
      fs.readFileSync(path.join(JREAD_DIR, 'popup', 'popup-core.js'), 'utf8');
    const allSenders = CONTENT_SRCS.map((c) => c.src).join('\n') + POPUP_SRC + SW_SRC;
    for (const c of swCases) {
      // 發送端形狀：type: NS.MSG.X / type: 'X'（popup / SW 內部）
      const used = new RegExp(`type:\\s*(?:NS\\.MSG\\.${c}\\b|'${c}')`).test(allSenders);
      assert.ok(used, `SW case '${c}' 找不到任何發送端——死 handler（UPDATE_SETTINGS 同型）`);
    }
  });

  it('死協定不得復活：REPORT_DETECTION_RESULT / UPDATE_SETTINGS', () => {
    // 排除註解行（namespace.js 的移除紀錄註解會提及舊名）
    const all = (CONTENT_SRCS.map((c) => c.src).join('\n') + SW_SRC)
      .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    assert.ok(!/REPORT_DETECTION_RESULT/.test(all),
      'REPORT_DETECTION_RESULT 已移除（零接收端、白喚醒 SW）——要回報偵測結果請先加接收端再恢復');
    assert.ok(!/UPDATE_SETTINGS/.test(all),
      'UPDATE_SETTINGS 已移除（零發送端）——設定寫入一律直寫 browser.storage.sync');
  });
});
