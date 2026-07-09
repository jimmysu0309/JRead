// JRead — LCA promote hop 預算 forcing（v1.6.27）
//
// 背景（v1.6.24 review 遺留 #1，Jimmy 2026-07-09 指示處理）：findTitleViaLca 舊寫法
// `maxDist=5` + 迴圈 `dist <= maxDist` 實際允許 6 hops（off-by-one）——而 6 hops
// 才是被幾十版真實站點（商周等）校準過的行為。v1.6.27 不改行為、把現狀合法化：
// 迴圈改 `dist < maxDist`（maxDist = 最多允許幾個 parent hop 的明確語意）、呼叫端
// 傳 LCA_PROMOTE_MAX_HOPS = 6，行為逐位元不變。
//
// 本 spec 是 forcing function：鎖住 (a) hop 預算常數 = 6、(b) 迴圈語意 =
// 「maxDist 即允許 hop 數」。將來 detector 重構若把 6 誤「修正」回 5（或迴圈
// 改回 <=），行為測試 / 靜態斷言至少一條 fail——改此預算形同重新校準 detector，
// 必須全站 probe 重驗後有意識地更新本 spec。
//
// 訊號層次（驗 X、不驗 Y）：驗 helper 的 hop 語意與呼叫端預算；不驗 promote
// 全流程在真實站的命中（該層由既有 detector spec 群 + harness 覆蓋）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

const DETECTOR_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'), 'utf8'
);

// 建 DOM：lca 容器（含 h1 + 深鏈到 articleEl）。hops = articleEl 沿 parent 到 lca 的步數
function buildChain(hops) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><main id="lca"><h1 id="h">標題</h1></main></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
  window.eval(SRC.namespace);
  window.eval(SRC.detector);
  const doc = window.document;
  const lca = doc.getElementById('lca');
  let cur = lca;
  for (let i = 0; i < hops - 1; i++) {
    const d = doc.createElement('div');
    cur.appendChild(d);
    cur = d;
  }
  const articleEl = doc.createElement('article');
  cur.appendChild(articleEl);
  return { NS: window.__JRead, lca, articleEl, h: doc.getElementById('h') };
}

describe('LCA promote hop 預算（v1.6.27 現狀合法化）', () => {
  it('maxDist 語意 = 最多允許 maxDist 個 parent hop（6 hops 傳 6 → 接受）', () => {
    const { NS, lca, articleEl, h } = buildChain(6);
    const r = NS.detector.findTitleViaLca(articleEl, h, 6);
    assert.ok(r && r.el === lca, '6 hops 在預算 6 內必須接受（= 歷史校準行為）');
  });

  it('7 hops 傳 6 → 拒絕（預算上界）', () => {
    const { NS, articleEl, h } = buildChain(7);
    assert.strictEqual(NS.detector.findTitleViaLca(articleEl, h, 6), null);
  });

  it('Infinity 跳過距離 guard（既有 fallback 路徑不受影響）', () => {
    const { NS, lca, articleEl, h } = buildChain(12);
    const r = NS.detector.findTitleViaLca(articleEl, h, Infinity);
    assert.ok(r && r.el === lca);
  });

  it('LCA === body 仍拒絕（安全 guard 不因語意改寫退步）', () => {
    const { NS, articleEl } = buildChain(2);
    const doc = articleEl.ownerDocument;
    const strayH = doc.createElement('h1');
    doc.body.appendChild(strayH); // 與 articleEl 的 LCA 是 body
    assert.strictEqual(NS.detector.findTitleViaLca(articleEl, strayH, 6), null);
  });

  it('靜態 forcing：呼叫端預算常數 LCA_PROMOTE_MAX_HOPS = 6、迴圈用 dist < maxDist', () => {
    assert.match(DETECTOR_SRC, /const LCA_PROMOTE_MAX_HOPS = 6;/,
      'hop 預算必須是明文常數 6（歷史校準值）——要改必須全站 probe 重驗');
    assert.match(DETECTOR_SRC, /findTitleViaLca\(articleEl, h, LCA_PROMOTE_MAX_HOPS\)/,
      'tryLcaPromote 必須用常數、不可寫死數字');
    assert.match(DETECTOR_SRC, /dist < maxDist/,
      '迴圈必須是 dist < maxDist（maxDist = 允許 hop 數的明確語意）');
    // 負向斷言先剝註解——detector 內的歷史說明註解會描述舊寫法（sw spec 同款手法）
    const stripped = DETECTOR_SRC.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    assert.ok(!/dist <= maxDist/.test(stripped),
      '不可回到 off-by-one 舊寫法 dist <= maxDist');
  });
});
