// JRead — regression spec: 保留原站色容器的對比守門 (v0.7.225)
// -----------------------------------------------------------------------------
// Forcing function for v0.7.225 contrast guard。
// Trigger: Jimmy 2026-06-07 回報 blog.tymscar.com/posts/v100localllm/（站點走
// prefers-color-scheme: dark）code block 在 light theme reader card 內幾乎
// 全白不可讀。
//
// Root cause（probe 實測）：站點 pre bg = srgb 5% 白（半透明、疊 body
// rgb(26,26,26) 視覺上=深底）、syntax token 為 monokai 系淺色。styler 刻意
// 保留 pre 文字色（syntax highlight），但 reader card 白底讓半透明 bg 疊白
// = 白 → token 對比從 4.6~16.3:1 掉到 1.07~3.79:1。
//
// v0.7.225 修法（通則）：apply() 注入前量 pre / table 的原始 effective bg
// （ancestor 爬升 + alpha 合成）+ 文字載體色；注入後以 card bg 重算新
// effective bg。「大部分文字對新 bg < 3:1、但對原始 bg 可讀」→ 原始 bg 以
// inline !important 還給容器。restore() 對稱還原。
//
// 訊號層次：本 spec 驗 jsdom 內 inline style 副作用（guard 觸發 / 不觸發 /
// 還原），不驗真實 Chrome cascade 下 wrapper bg 被 strip 的機制——那層由
// tools/debug-harness.js 的 CONTRAST AUDIT 在真實站點驗。
//
// 6 條 forcing function：
//   (a) dark scheme 設計的 pre：guard 還原原始 effective bg rgb(37, 37, 37)
//       （= 0.05 白疊 rgb(26,26,26)）+ priority important
//   (b) light 設計的 pre（深字無 bg）：guard 不動
//   (c) 原站自身低對比的 pre：guard 保守不動（不是 jread 造成）
//   (d) dark scheme 設計的 table：同條通則修
//   (e) restore：pre inline bg 還回原值 rgba(255, 255, 255, 0.05)（無 priority）
//   (f) dark theme：guard 整段跳過（* { color: theme.text } 已蓋 token 色）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'tymscar-dark-code-contrast.html');

function setup(themeName) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['styler']
  });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 必須有 <article>');
  const settings = {
    theme: themeName,
    fontSize: 18,
    contentWidth: 720,
    fontFamily: 'system-ui',
    lineHeight: 1.7
  };
  const snapshot = env.NS.styler.apply(articleEl, settings);
  return { env, articleEl, snapshot };
}

describe('styler — pre/table contrast guard (v0.7.225)', () => {

  it('(a) light theme：dark scheme 設計的 pre 還原原始 effective bg', () => {
    const { env } = setup('light');
    const pre = env.document.querySelector('[data-test="dark-pre"]');
    assert.strictEqual(pre.style.getPropertyValue('background-color'), 'rgb(37, 37, 37)',
      'guard 必須把 pre 的 inline bg 設成原始 effective bg（0.05 白疊 rgb(26,26,26) = rgb(37,37,37)），否則 dark scheme 站的淺色 token 在白卡上對比 1.1:1 不可讀');
    assert.strictEqual(pre.style.getPropertyPriority('background-color'), 'important',
      'inline bg 必須帶 !important（防原站 stylesheet !important 反覆寫）');
  });

  it('(b) light theme：light 設計的 pre 不動', () => {
    const { env } = setup('light');
    const pre = env.document.querySelector('[data-test="light-pre"]');
    assert.strictEqual(pre.style.getPropertyValue('background-color'), '',
      'light 設計（深字）的 pre 對白卡對比本來就高，guard 不可加 inline bg');
  });

  it('(c) light theme：原站自身低對比的 pre 保守不動', () => {
    const { env } = setup('light');
    const pre = env.document.querySelector('[data-test="bad-origin-pre"]');
    assert.strictEqual(pre.style.getPropertyValue('background-color'), 'rgb(250, 250, 250)',
      '原站本來就低對比（lowOrig >= 0.4）的容器不是 jread 造成、guard 不可動它的 bg');
    assert.strictEqual(pre.style.getPropertyPriority('background-color'), '',
      '不可在原站自身低對比容器上加 !important');
  });

  it('(d) light theme：dark scheme 設計的 table 同條通則修', () => {
    const { env } = setup('light');
    const table = env.document.querySelector('[data-test="dark-table"]');
    assert.strictEqual(table.style.getPropertyValue('background-color'), 'rgb(26, 26, 26)',
      'table 文字色同樣被 styler 保留（color: inherit 排除 th/td），dark scheme 站的淺色表格文字必須由同條 guard 還原 effective bg');
    assert.strictEqual(table.style.getPropertyPriority('background-color'), 'important');
  });

  it('(e) restore：pre inline bg / th inline color 還回原值', () => {
    const { env, articleEl, snapshot } = setup('light');
    env.NS.styler.restore(articleEl, snapshot);
    const pre = env.document.querySelector('[data-test="dark-pre"]');
    assert.strictEqual(pre.style.getPropertyValue('background-color'), 'rgba(255, 255, 255, 0.05)',
      'restore 必須把 pre 的 inline bg 還回 fixture 原有的 rgba(255, 255, 255, 0.05)');
    assert.strictEqual(pre.style.getPropertyPriority('background-color'), '',
      'restore 後不可殘留 !important priority');
    const table = env.document.querySelector('[data-test="dark-table"]');
    assert.strictEqual(table.style.getPropertyValue('background-color'), '',
      'restore 必須把 table 的 inline bg 清掉（fixture 原本沒有 inline bg）');
    const th = env.document.querySelector('[data-test="mixed-th"]');
    assert.strictEqual(th.style.getPropertyValue('color'), 'rgb(240, 240, 240)',
      'restore 必須把 th 的 inline color 還回 fixture 原有的 rgb(240, 240, 240)');
    assert.strictEqual(th.style.getPropertyPriority('color'), '',
      'restore 後 th color 不可殘留 !important priority');
  });

  it('(i) 混色 table：per-carrier 覆寫 th 文字色、不動 bg 與 td', () => {
    const { env } = setup('light');
    const table = env.document.querySelector('[data-test="mixed-table"]');
    assert.strictEqual(table.style.getPropertyValue('background-color'), '',
      '混色 table（th 淺 / td 深）多數文字可讀，bg 還原會弄壞 td——不可整容器還原 bg');
    const th = env.document.querySelector('[data-test="mixed-th"]');
    assert.strictEqual(th.style.getPropertyValue('color'), 'rgb(26, 26, 26)',
      'th 有自己的淺色（為深底設計）在白卡上 1.14:1——per-carrier 覆寫必須把它改成對白卡高對比的深字');
    assert.strictEqual(th.style.getPropertyPriority('color'), 'important',
      'per-carrier 色覆寫必須帶 !important');
    const td = env.document.querySelector('[data-test="mixed-td"]');
    assert.strictEqual(td.style.getPropertyValue('color'), 'rgb(26, 26, 26)',
      'td 深字對白卡可讀，不可被覆寫');
    assert.strictEqual(td.style.getPropertyPriority('color'), '',
      'td 不可被加上 !important（guard 不該動它）');
  });

  it('(f) dark theme：guard 整段跳過', () => {
    const { env } = setup('dark');
    const pre = env.document.querySelector('[data-test="dark-pre"]');
    assert.strictEqual(pre.style.getPropertyValue('background-color'), 'rgba(255, 255, 255, 0.05)',
      'dark theme 下 `* { color: theme.text }` 已蓋掉 token 色 + v0.7.164 已清 pre bg transparent，guard 不可再動 inline bg');
  });

  // --- player 標記外溢 guard（同輪發現的第二條根因，v0.7.225）---
  // tymscar 真實頁面：video 往上找不到 relative+hidden player root，fallback
  // container = vid.parentElement 選到包大半主文的 anon wrapper → 246/267
  // 元素被 PLAYER_ATTR 豁免色彩保護 → 站點 dark scheme 綠 link 留在白卡上
  // 1.37:1（harness CONTRAST AUDIT 抓到）。修法：container 含 >= 100 chars
  // 的 p / li = layout wrapper 而非 player 結構，縮回 video 自身。

  it('(g) 含主文長段落的 video wrapper 不被 player 標記', () => {
    const { env } = setup('light');
    const wrapper = env.document.querySelector('[data-test="video-wrapper"]');
    assert.notStrictEqual(wrapper.getAttribute('data-jread-player'), '1',
      'video 的 fallback container 含長段落時必須縮回 video 自身，不可標 layout wrapper');
    const link = env.document.querySelector('[data-test="green-link"]');
    assert.notStrictEqual(link.getAttribute('data-jread-player'), '1',
      'wrapper 內的 link 不可被 PLAYER_ATTR 豁免——否則站點 dark scheme link 色（綠）留在白卡上不可讀');
  });

  it('(h) video 自身仍被 player 標記', () => {
    const { env } = setup('light');
    const video = env.document.querySelector('[data-test="demo-video"]');
    assert.strictEqual(video.getAttribute('data-jread-player'), '1',
      'guard 縮小範圍後 video 自身仍須標記（背景 / poster 保護的原始動機不可退步）');
  });
});
