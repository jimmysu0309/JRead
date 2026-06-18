// JRead — 無限捲動 lazy 注入的「下一篇文章」<aside> 動態清除 regression spec（v0.8.112）
//
// 根因（2026-06-18 Jimmy 回報 womany.net article/2823「網頁下方有許多雜訊」）：
// womany 無限捲動把下一篇文章整篇 lazy 注入成 ASIDE.article-root#article33485
// 到內容容器內、跟在真文章後面。靜態 hideInsideArticleSidebarColumns 條件 B
// （aside tag + rectH > SIDEBAR_ASIDE_MIN_HEIGHT=400）本能命中這種結構，但它在
// clean() 之後才注入、靜態 pass 早跑完；而 checkDynamicNoise 原只查雜訊「標題
// 文字」（NOISE_HEADING_TEXT_RE）—— 第二篇文章用真實標題（「專訪 X」）不命中 → 漏網。
//
// 通則修法（結構性、不綁站點 class）：checkDynamicNoise 補上同源結構判定——
// 動態注入的 node 自身 / 其內 / 其祖先出現 <aside> tag + rectH > 400 即整塊 hide。
// 祖先補查涵蓋「先注入空殼 aside、後逐批 hydrate 撐高」的時序（womany 實證）。
//
// 本 spec 驗：(1) 結構 forcing——checkDynamicNoise 內含 aside 結構判定；
// (2) 行為——clean 後動態注入的大型 aside 被 hide、小型 aside（pull-quote）不被誤殺、
// hydrate 撐高的空殼 aside 經祖先補查被 hide。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
);

function stubHeight(el, h) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ top: 0, left: 0, right: 600, bottom: h, width: 600, height: h }),
    configurable: true,
  });
}

function buildEnv() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><main id="wrap">
    <article id="art"><h1>凝觀自己的女性藝術家 芙烈達‧卡蘿</h1>
    <p>女人，不論心是多麼的脆弱如花心，在遭遇苦難後仍能咬著牙自我復原向前走，這段主文夠長以通過字數門檻。</p>
    <p>第二段主文內容，繼續描述卡蘿的畫作與生平，維持足夠長度避免被當空容器誤判。</p>
    </article></main></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
  window.eval(SRC.namespace);
  window.eval(SRC.cleaner);
  const doc = window.document;
  // detected article = wrapper（含主文 article + 之後 lazy 注入的 aside），對齊
  // womany 真實結構（#w-main-content 父容器）
  const wrap = doc.getElementById('wrap');
  return { window, doc, wrap, NS: window.__JRead };
}

describe('dynamic-next-article-aside — 結構 forcing', () => {
  it('asideIsSecondaryArticleBlock 必須含 h1 / 高度 / 文字三訊號 + guard', () => {
    const m = CLEANER_SRC.match(/function\s+asideIsSecondaryArticleBlock[\s\S]*?\n  \}/);
    assert.ok(m, '必須宣告 asideIsSecondaryArticleBlock（靜態 + 動態單一資料源）');
    const body = m[0];
    assert.ok(/tagName\s*!==\s*'ASIDE'/.test(body), '必須判定 ASIDE tag');
    assert.ok(/querySelector\(['"]h1['"]\)/.test(body), '必須有 h1（巢狀完整文章）layout-independent 訊號');
    assert.ok(/SIDEBAR_ASIDE_MIN_HEIGHT/.test(body), '必須有 rectH 訊號');
    assert.ok(/ASIDE_DYN_MIN_TEXT/.test(body), '必須有 textContent 長度 fallback 訊號');
    assert.ok(/contains\s*&&\s*aside\.contains\(articleEl\)/.test(body), '必須 guard：aside 不可含 articleEl');
  });
  it('靜態 clean 與動態 observer 都使用 asideIsSecondaryArticleBlock（單一資料源）', () => {
    assert.ok(/function\s+hideSecondaryArticleAsides/.test(CLEANER_SRC), '必須宣告靜態 sweep hideSecondaryArticleAsides');
    assert.ok(/safeRun\(hideSecondaryArticleAsides/.test(CLEANER_SRC), 'clean() 必須 safeRun 靜態 sweep');
    const dyn = CLEANER_SRC.match(/function\s+checkDynamicNoise[\s\S]*?\n  \}/)[0];
    assert.ok(/asideIsSecondaryArticleBlock/.test(dyn), 'checkDynamicNoise 必須呼叫共用 helper');
    assert.ok(/closest\(['"]aside['"]\)/.test(dyn), 'checkDynamicNoise 必須有祖先 aside 補查（hydrate 時序）');
  });
});

describe('dynamic-next-article-aside — 行為（靜態 sweep）', () => {
  it('clean 當下已存在、巢狀深處的次要全文 aside（含 h1）被靜態 sweep hide', () => {
    const { doc, wrap, NS } = buildEnv();
    // 模擬 womany：偵測選到高層 wrap，下一篇文章 aside 巢在深處（非 direct child）
    const mc = doc.createElement('div');
    mc.id = 'w-main-content';
    const next = doc.createElement('aside');
    next.id = 'article33485';
    next.className = 'article-root';
    next.innerHTML = '<section class="article-header"><a class="article-title"><h1>專訪新北青年局局長邱兆梅</h1></a></section>' +
      '<section class="article-body"><p>在 AI 席捲全世界的時代，當代職涯階梯已然瓦解。</p></section>';
    stubHeight(next, 0); // layout 未就緒也要命中（h1 訊號 layout-independent）
    mc.appendChild(next);
    wrap.appendChild(mc);

    const hidden = NS.cleaner.clean(wrap);
    assert.strictEqual(next.dataset.jreadHidden, '1',
      '巢狀次要全文 aside（含 h1）必須被靜態 sweep hide（條件 B 漏的 direct-child 限制）');
    NS.cleaner.restore(hidden);
  });

});

describe('dynamic-next-article-aside — 行為', () => {
  it('動態注入的大型 <aside>（下一篇文章、h>400）整塊被 hide', async () => {
    const { doc, wrap, NS } = buildEnv();
    const art = doc.getElementById('art');
    const hidden = NS.cleaner.clean(wrap);

    // 無限捲動注入：下一篇文章整篇成 aside、真實標題（不命中 NOISE_HEADING_TEXT_RE）
    const aside = doc.createElement('aside');
    aside.id = 'article33485';
    aside.className = 'article-root';
    aside.innerHTML = '<section class="article-header"><h1>專訪新北青年局局長邱兆梅：談 Z 世代的內在革命</h1></section>' +
      '<section class="article-body"><p>在 AI 席捲全世界的時代，當代職涯階梯已然瓦解。</p></section>';
    stubHeight(aside, 9000);
    wrap.appendChild(aside);

    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(aside.dataset.jreadHidden, '1',
      '大型下一篇文章 aside 必須被 hide（靜態條件 B 同源、純結構通則）');
    NS.cleaner.restore(hidden);
  });

  it('動態注入的小型 <aside>（pull-quote、h<400）不被誤殺', async () => {
    const { doc, wrap, NS } = buildEnv();
    const art = doc.getElementById('art');
    const hidden = NS.cleaner.clean(wrap);

    const pq = doc.createElement('aside');
    pq.className = 'pullquote';
    pq.innerHTML = '<p>「我畫我自己，因為我是最了解的主題。」</p>';
    stubHeight(pq, 120); // pull-quote 通常 < 300
    art.appendChild(pq);

    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    assert.notStrictEqual(pq.dataset.jreadHidden, '1',
      '小型 aside（pull-quote）不該被當次要區塊誤殺（與條件 B 同門檻 400）');
    NS.cleaner.restore(hidden);
  });

  it('先注入空殼 aside（無 h1、矮、短、不命中）、後 hydrate 加 h1 → 經祖先補查被 hide', async () => {
    const { doc, wrap, NS } = buildEnv();
    const hidden = NS.cleaner.clean(wrap);

    // 半殼：無 h1、矮（100）、短文字 → 三訊號皆不命中
    const shell = doc.createElement('aside');
    shell.id = 'article33486';
    shell.className = 'article-root';
    shell.innerHTML = '<div class="placeholder">載入中</div>';
    stubHeight(shell, 100);
    wrap.appendChild(shell);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    assert.notStrictEqual(shell.dataset.jreadHidden, '1', '前置：空殼（無 h1 / 矮 / 短）注入當下不命中');

    // hydrate：append 帶 h1 的完整文章內文（addedNode 祖先為 shell）→ 祖先補查命中
    const body = doc.createElement('section');
    body.className = 'article-body';
    body.innerHTML = '<a class="article-title"><h1>專訪新北青年局局長邱兆梅</h1></a>' +
      '<p>為了回應這樣的時代需求，新北市政府青年局推出系列活動。</p>';
    shell.appendChild(body);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(shell.dataset.jreadHidden, '1',
      'hydrate 加 h1 後、內文 addedNode 的 closest(aside) 補查必須命中並 hide 空殼 aside');
    NS.cleaner.restore(hidden);
  });
});
