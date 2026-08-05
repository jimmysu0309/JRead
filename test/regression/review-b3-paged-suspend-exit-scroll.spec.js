// JRead — v1.7.41（review 批次 3 P3）：paged uninstall 分「暫停」與「真退出」語意
// -----------------------------------------------------------------------------
// P3a：編輯模式 suspend 路徑（main.js suspendReaderInteractions）舊版走同一個
//      uninstall——savedScrollY 被提前消費 + 排 rAF scrollTo。suspend→restore
//      一輪後（install 不重抓、captureScrollY 只在 !installed 寫入）真退出的
//      fallback 捲回靜默失效（savedScrollY 已歸零）。修法：uninstall({ suspend:
//      true }) 不消費、不捲動。
// P3b：真退出路徑的 rAF 還原違反 v0.8.84 背景分頁教訓（背景分頁 rAF 被
//      throttle / 凍結，晚到的 scrollTo 打在還原後的新狀態上）。修法：
//      uninstall({ deferScrollRestore: true }) 消費 y 但不排 rAF、回傳給
//      main.js 在 styler.restore 之後同步捲回。
//
// 訊號層次：jsdom 驗 opts 語意與 main.js 佈線順序；真實背景分頁 rAF throttle
// 行為由歷史教訓（v0.8.84）背書，不在 jsdom 可驗範圍。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const JREAD_DIR = path.join(__dirname, '..', '..', 'jread');
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'paged-mode.html');
const PAGED_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'paged-mode.js'), 'utf8');
const MAIN_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'main.js'), 'utf8');

function buildEnv() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH, scripts: [], pretendToBeVisual: true
  });
  env.window.eval(PAGED_SRC);
  const api = env.window.__JRead.pagedMode;
  const art = env.document.querySelector('article');
  Object.defineProperty(art, 'clientWidth', { value: 400, configurable: true });
  Object.defineProperty(art, 'scrollWidth', { value: 1200, configurable: true });
  return { env, api, art };
}

function setScrollY(env, v) {
  Object.defineProperty(env.window, 'scrollY', { value: v, configurable: true });
}

describe('paged-mode v1.7.41 — uninstall({ suspend }) 不消費 savedScrollY（P3a）', () => {
  it('suspend → 重新 install → 真退出 deferScrollRestore 仍拿得到進場前位置', () => {
    const { env, api, art } = buildEnv();
    setScrollY(env, 500);
    api.captureScrollY();                    // main.js finalizeEnter：進場前捕捉
    api.sync({ pagedMode: true }, art);      // install
    const scrolls = [];
    env.window.scrollTo = (x, y) => scrolls.push([x, y]);
    const ySuspend = api.uninstall({ suspend: true });   // 編輯模式暫停
    assert.strictEqual(ySuspend, 0, 'suspend 路徑不得回傳 / 消費捲動位置');
    assert.strictEqual(scrolls.length, 0, 'suspend 路徑不得捲動');
    api.sync({ pagedMode: true }, art);      // restoreReaderInteractions 重掛
    const yExit = api.uninstall({ deferScrollRestore: true });  // 真退出
    assert.strictEqual(yExit, 500,
      'suspend 一輪後真退出必須還拿得到進場前位置——舊版 suspend 已把 savedScrollY 消費歸零');
  });
});

describe('paged-mode v1.7.41 — uninstall({ deferScrollRestore }) 同步交棒（P3b）', () => {
  it('deferScrollRestore 回傳 y、不排 rAF scrollTo', async () => {
    const { env, api, art } = buildEnv();
    setScrollY(env, 640);
    api.captureScrollY();
    api.sync({ pagedMode: true }, art);
    const scrolls = [];
    env.window.scrollTo = (x, y) => scrolls.push([x, y]);
    const y = api.uninstall({ deferScrollRestore: true });
    assert.strictEqual(y, 640, '必須回傳消費到的進場前位置');
    await new Promise(r => setTimeout(r, 50));  // 讓 pending rAF（若有）跑完
    assert.strictEqual(scrolls.length, 0,
      'deferScrollRestore 不得自己排 rAF scrollTo（背景分頁 rAF throttle 教訓，由 main.js 同步捲）');
    // 消費後歸零：再次退出拿不到殘留值
    api.sync({ pagedMode: true }, art);
    assert.strictEqual(api.uninstall({ deferScrollRestore: true }), 0,
      '消費後必須歸零（v0.8.17 防殘留值誤捲）');
  });

  it('無 opts（settings 切換路徑）維持原 rAF 還原行為', async () => {
    const { env, api, art } = buildEnv();
    setScrollY(env, 300);
    api.captureScrollY();
    api.sync({ pagedMode: true }, art);
    const scrolls = [];
    env.window.scrollTo = (x, y) => scrolls.push([x, y]);
    api.uninstall();
    await new Promise(r => setTimeout(r, 50));
    assert.deepStrictEqual(scrolls, [[0, 300]], '預設路徑必須照舊 rAF 捲回進場前位置');
  });
});

describe('main.js v1.7.41 — P3 佈線（結構 forcing）', () => {
  it('suspendReaderInteractions 必須以 { suspend: true } 呼叫 uninstall', () => {
    const m = MAIN_SRC.match(/function suspendReaderInteractions[\s\S]*?\n  \}/);
    assert.ok(m, '抓不到 suspendReaderInteractions');
    assert.match(m[0], /NS\.pagedMode\.uninstall\(\{ suspend: true \}\)/,
      '編輯模式暫停路徑必須走 suspend 語意（不消費 savedScrollY）');
  });

  it('exitReaderModeImpl：deferScrollRestore 拿回 y、在 styler.restore 之後同步捲回', () => {
    const m = MAIN_SRC.match(/function exitReaderModeImpl[\s\S]*?\n  \}/);
    assert.ok(m, '抓不到 exitReaderModeImpl');
    const body = m[0];
    assert.match(body, /pagedExitScrollY = NS\.pagedMode\.uninstall\(\{ deferScrollRestore: true \}\)/,
      '真退出必須用 deferScrollRestore 拿回捲動位置');
    const restoreIdx = body.indexOf('NS.styler.restore');
    const scrollIdx = body.indexOf('window.scrollTo(0, pagedExitScrollY)');
    assert.ok(restoreIdx !== -1 && scrollIdx !== -1, '必須有 styler.restore 與同步 scrollTo');
    assert.ok(scrollIdx > restoreIdx,
      '同步捲回必須在 styler.restore 之後（overflow hidden 移除、文件恢復可捲動才有效）');
  });
});
