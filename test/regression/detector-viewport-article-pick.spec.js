// JRead — regression spec: 多 article 視口相交過濾 (v0.8.45 thenewslens)
// -----------------------------------------------------------------------------
// bug：無限捲動站（thenewslens cage 實證）把「下一篇」preload 成同文件的第二
// 個 <article>，且 preload 篇比本文長。detectByArticleTag 多 article 分支
// 「挑最長」會選到使用者沒在看的那篇——reader card 開出來是下一篇（268193
// sponsored 文，cage 截圖實證），站方視口判定再把 URL 也切過去。
//
// v0.8.45 修法：挑選前先過濾「與視口相交」的候選（rect.height > 0 &&
// rect.bottom > 0 && rect.top < innerHeight）。有相交者只在相交者中挑；
// 全部不相交或 rect 不可用（jsdom 預設 rect 全 0）→ 退回全集合 = 舊行為。
//
// jsdom 不算 layout，rect 由 spec mock。
//
// forcing functions：
//   (a) 視口內較短的本文必須贏過視口外較長的 preload 篇
//   (b) rect 全 0（jsdom 預設 / 不可用）→ 退回舊行為挑最長
//   (c) 兩篇都在視口內 → 仍挑最長（列表頁 / 模糊場景行為不變）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'infinite-scroll-two-articles.html');

function setupWithRects(rects) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector']
  });
  // jsdom 不算 layout——mock 兩個 article 的 rect 模擬視口相對位置。
  // innerHeight 在 jsdom 預設 768。
  for (const [id, rect] of Object.entries(rects)) {
    const el = env.document.getElementById(id);
    el.getBoundingClientRect = () => ({
      top: rect.top, bottom: rect.bottom, height: rect.bottom - rect.top,
      left: 0, right: 800, width: 800, x: 0, y: rect.top
    });
  }
  return env;
}

describe('detector — 多 article 視口相交過濾 (v0.8.45)', () => {
  it('(a) 視口內較短的本文贏過視口外較長的 preload 篇', () => {
    const env = setupWithRects({
      'current-article': { top: -200, bottom: 600 },   // 與視口相交（使用者在讀）
      'preload-article': { top: 1500, bottom: 4000 }   // 視口外下方（preload）
    });
    const detected = env.NS.detector.detect();
    assert.ok(detected, 'detector 必須命中');
    assert.strictEqual(detected.el.id, 'current-article',
      '必須選「視口相交」的本文，不可因 preload 篇字數較多而選錯');
  });

  it('(b) rect 不可用（全 0）時退回舊行為（挑最長），不誤傷一般站', () => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector']
    });
    // 不 mock rect → jsdom 預設全 0 → height 0 → 無相交者 → 全集合挑最長
    const detected = env.NS.detector.detect();
    assert.ok(detected, 'detector 必須命中');
    assert.strictEqual(detected.el.id, 'preload-article',
      'rect 不可用時必須退回「挑最長」舊行為（harness 環境 / 極端捲動位置安全網）');
  });

  it('(c) 兩篇都在視口內 → 仍挑最長（行為與舊版一致）', () => {
    const env = setupWithRects({
      'current-article': { top: 0, bottom: 300 },
      'preload-article': { top: 320, bottom: 700 }
    });
    const detected = env.NS.detector.detect();
    assert.ok(detected, 'detector 必須命中');
    assert.strictEqual(detected.el.id, 'preload-article',
      '兩篇都相交時維持挑最長（使用者意圖模糊區不改變既有行為）');
  });
});
