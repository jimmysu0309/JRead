// JRead 工具看門狗：整體期限 + 心跳檔（2026-11-18）
// -----------------------------------------------------------------------------
// 背景：harness / probe 只有個別步驟的 timeout，沒有「整支程式最多跑多久」。
// page.evaluate 沒有逾時、頁內無窮迴圈或截圖卡死時程式永遠不結束——背景任務
// 因此收不到完成通知，主線一直等（實際發生過卡一整天、Jimmy 手動才發現）。
//
// 這支做兩件事：
//   1. 整體期限：超過 limitSec 就印一行 `WATCHDOG:`（含最後一行輸出＝卡在哪）、
//      以 exit code 124 結束。Playwright 在 process exit 時會自己關掉它開的瀏覽器。
//      「卡住」因此變成幾分鐘內的失敗，而不是無限等待。
//   2. 心跳檔：每 5 秒把 {pid, name, target, 起始時間, 最後輸出時間, 最後一行輸出}
//      寫到 ~/.jread-debug/heartbeat/<pid>.json，正常結束時刪掉。
//      `node tools/watchdog.js` 會列出所有心跳檔並標出死掉 / 久無輸出的行程。
//
// 驗的層次：這支只保證「event loop 還活著時，期限到了一定結束」。
// 不涵蓋：同步阻塞（spawnSync / execFileSync 進行中 timer 不會跑——呼叫端要
// 自己給 spawnSync 的 timeout 選項，並在進 spawnSync 前 stop()）、agent 本身
// 在繞圈（行程沒卡但沒進展——那要靠主線巡查心跳檔的「最後輸出時間」）。
//
// 用法（每支 harness / 自寫 probe 開頭一行）：
//   const wd = require('./watchdog.js').install({ name: 'my-probe', limitSec: 300 });
//   ...                       // console.log 的每一行自動記為「目前進度」
//   wd.stop();                // 可選：互動模式（--keep / --login）或進 spawnSync 前
// 環境變數 JREAD_WATCHDOG_SEC 覆寫期限；設 0 關閉期限（心跳檔照寫）。
// -----------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');

const HEARTBEAT_DIR = process.env.JREAD_HEARTBEAT_DIR
  || path.join(os.homedir(), '.jread-debug', 'heartbeat');
const TIMEOUT_EXIT_CODE = 124; // 與 timeout(1) 同一個慣例
const BEAT_MS = 5000;

function resolveLimitSec(limitSec) {
  const env = process.env.JREAD_WATCHDOG_SEC;
  if (env !== undefined && env !== '' && !Number.isNaN(Number(env))) return Number(env);
  return limitSec;
}

function install(opts) {
  const name = (opts && opts.name) || path.basename(process.argv[1] || 'tool');
  const target = (opts && opts.target) || '';
  const limitSec = resolveLimitSec((opts && opts.limitSec) || 600);
  const startedAt = Date.now();
  const state = { lastLogAt: startedAt, lastLog: '(尚無輸出)' };
  const file = path.join(HEARTBEAT_DIR, `${process.pid}.json`);
  let stopped = false;

  // 把 console.log / console.error 的每一行記成「目前進度」——不用在主流程
  // 逐步插標記，期限到時印得出卡在哪一步之後
  let lastBeatAt = 0;
  let beat = () => {};
  for (const k of ['log', 'error']) {
    const orig = console[k];
    console[k] = (...args) => {
      state.lastLogAt = Date.now();
      try { state.lastLog = args.map(String).join(' ').slice(0, 200); } catch { /* 不可因記錄失敗影響主流程 */ }
      // 有新輸出就順手更新心跳檔（每秒至多一次），巡查看到的進度才即時
      if (!stopped && state.lastLogAt - lastBeatAt > 1000) beat();
      return orig.apply(console, args);
    };
  }

  beat = () => {
    lastBeatAt = Date.now();
    try {
      fs.mkdirSync(HEARTBEAT_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        pid: process.pid, name, target, limitSec,
        startedAt, lastLogAt: state.lastLogAt, lastLog: state.lastLog, beatAt: Date.now()
      }));
    } catch { /* 心跳寫不進去不該讓工具失敗 */ }
  };
  const cleanup = () => { try { fs.unlinkSync(file); } catch { /* 已不在 */ } };

  beat();
  const beatTimer = setInterval(beat, BEAT_MS);
  beatTimer.unref();
  process.on('exit', cleanup);

  let limitTimer = null;
  if (limitSec > 0) {
    limitTimer = setTimeout(() => {
      const idle = Math.round((Date.now() - state.lastLogAt) / 1000);
      // 直接寫 stderr（不走被包過的 console），訊息固定前綴方便 grep
      process.stderr.write(
        `\nWATCHDOG: ${name} 超過 ${limitSec} 秒未結束，強制中止（exit ${TIMEOUT_EXIT_CODE}）\n` +
        `WATCHDOG: 最後輸出在 ${idle} 秒前：${state.lastLog}\n`
      );
      process.exit(TIMEOUT_EXIT_CODE);
    }, limitSec * 1000);
    limitTimer.unref();
  }

  return {
    file,
    limitSec,
    // 停掉期限（心跳檔一併移除）：互動模式、或進同步阻塞前呼叫
    stop() {
      if (stopped) return;
      stopped = true;
      if (limitTimer) clearTimeout(limitTimer);
      clearInterval(beatTimer);
      cleanup();
    }
  };
}

// ---- 巡查：列出心跳檔，標出死掉 / 久無輸出的行程 ------------------------------
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// 回傳每個心跳檔的狀態；staleSec＝最後輸出超過幾秒算「久無輸出」
function scan(staleSec) {
  const stale = staleSec || 120;
  let names = [];
  try { names = fs.readdirSync(HEARTBEAT_DIR).filter((n) => n.endsWith('.json')); } catch { return []; }
  const now = Date.now();
  return names.map((n) => {
    try {
      const h = JSON.parse(fs.readFileSync(path.join(HEARTBEAT_DIR, n), 'utf8'));
      const alive = isAlive(h.pid);
      const idleSec = Math.round((now - h.lastLogAt) / 1000);
      const status = !alive ? 'dead' : (idleSec > stale ? 'stale' : 'ok');
      return { ...h, alive, idleSec, runSec: Math.round((now - h.startedAt) / 1000), status, file: path.join(HEARTBEAT_DIR, n) };
    } catch { return null; }
  }).filter(Boolean);
}

module.exports = { install, scan, HEARTBEAT_DIR, TIMEOUT_EXIT_CODE };

// 直接執行＝巡查。exit 0：全部正常或沒有行程；exit 1：有死掉或久無輸出的
//   node tools/watchdog.js            # 列出
//   node tools/watchdog.js --stale 60 # 久無輸出門檻（秒，預設 120）
//   node tools/watchdog.js --clean    # 順手刪掉已死行程留下的心跳檔
if (require.main === module) {
  const si = process.argv.indexOf('--stale');
  const rows = scan(si > 0 ? Number(process.argv[si + 1]) : 120);
  if (!rows.length) { console.log('沒有執行中的工具（無心跳檔）'); process.exit(0); }
  let bad = 0;
  for (const r of rows) {
    const mark = r.status === 'ok' ? 'OK   ' : (r.status === 'stale' ? 'STALE' : 'DEAD ');
    if (r.status !== 'ok') bad++;
    console.log(`${mark} pid=${r.pid} ${r.name} 已跑 ${r.runSec}s（期限 ${r.limitSec}s）最後輸出 ${r.idleSec}s 前｜${r.target}`);
    console.log(`      ${r.lastLog}`);
    if (r.status === 'dead' && process.argv.includes('--clean')) { try { fs.unlinkSync(r.file); } catch { /* 已不在 */ } }
  }
  process.exit(bad ? 1 : 0);
}
