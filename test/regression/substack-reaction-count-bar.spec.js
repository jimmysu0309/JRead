// JRead — Substack 文末「N Likes / N Restacks」reaction count bar 整塊清
// regression（v1.5.14）
//
// 根因（Jimmy 2026-06-29 essesmag.substack.com/p/arvid-lindblad-has-arrived 截圖
// 文末「3 Likes」+ 按讚者頭像殘留）：Substack like bar = 按讚者頭像 img + 「N
// Likes」<a>，整段 textContent 僅一串互動計數。既有規則全數漏網——
//   - hideInsideArticleActionRows：明確排除「含 img/picture/video 的容器」
//     （保護 captioned-image-container），like bar 含頭像 img → 被排除
//   - 讚數做成 <a> 非 <button>，sticker bar 無 data-testid（與
//     recommendation-footer 不同）→ button-cluster / recommendation 規則錯過
//   - class 全是 pencraft / emotion hash（外層 border-top-detail-themed-k9TZAY
//     帶 hash 尾綴）→ keyword / class 軌不可靠
//
// 修法（結構性通則、非站點 hostname / 單站 class 特判，硬規則 3）：以「整個容器
// textContent 僅一串互動計數（N Likes / N Restacks / N Reactions）+ 不含 <p>/
// heading 子 + 含計數連結或頭像 img」當「reaction bar」語意訊號整塊 hide。靜態
// hideInsideArticleReactionBars + 動態 checkDynamicNoise 共用 isReactionCountBar
//（lazy 注入兜底——React 端常在 clean 之後才 hydrate 讚數列）。
//
// 訊號層次（CLAUDE.md 工作流原則 3）：本 spec 驗「純計數文字命中 + 靜態/動態雙
// 路徑 + 主文守衛 + 可逆」。文字計數屬性翻譯後仍為計數 → translate-first Safari
//（Jimmy 實機）同樣命中。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
);

const LONG = '這段是真正的主文內容，必須夠長以通過 hasLongMainParagraph 的 100 字門檻，'
  + 'so we keep adding words about racing and policy to comfortably exceed one hundred characters here.';

// Substack like bar：class 刻意全用 pencraft hash（含 hash 尾綴），唯一穩定訊號是
// 「整段文字 = 純計數」+ 頭像 img + 計數 <a>。複刻 probe 實測的巢狀結構。
function likeBarHtml(countText) {
  return `
    <div class="pencraft pc-display-flex pc-paddingTop-16 pc-paddingBottom-16 pc-reset border-top-detail-themed-k9TZAY" id="likebar">
      <div class="pencraft pc-display-flex pc-gap-16 pc-alignItems-center pc-reset color-secondary-ls1g8s">
        <div class="pencraft pc-display-flex pc-gap-4 pc-alignItems-center pc-reset" id="likeinner">
          <a class="pencraft pc-reset cursor-pointer" href="/p/arvid/comments"><img src="user.jpg" width="32" height="32" alt=""></a>
          <a class="pencraft pc-reset cursor-pointer color-secondary-ls1g8s" href="/p/arvid/comments">${countText || '3 Likes'}</a>
        </div>
      </div>
    </div>`;
}

function buildEnv(opts) {
  opts = opts || {};
  const tail = opts.withBar ? likeBarHtml(opts.countText) : '';
  const dom = new JSDOM(`<!DOCTYPE html><html><body><main id="wrap">
    <article id="art">
      <h1>Arvid Lindblad has Arrived</h1>
      <p id="b1">${LONG}</p>
      <p id="b2">${LONG}</p>
      ${opts.decoyHtml || ''}
      ${tail}
    </article></main></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
  window.eval(SRC.namespace);
  window.eval(SRC.cleaner);
  const doc = window.document;
  return { window, doc, art: doc.getElementById('art'), NS: window.__JRead };
}

describe('substack-reaction-count-bar — 結構 forcing', () => {
  it('必須宣告 isReactionCountBar + hideInsideArticleReactionBars + REACTION_COUNT_RE', () => {
    assert.ok(/function\s+isReactionCountBar/.test(CLEANER_SRC));
    assert.ok(/function\s+hideInsideArticleReactionBars/.test(CLEANER_SRC));
    assert.ok(/REACTION_COUNT_RE\s*=/.test(CLEANER_SRC));
  });
  it('regex 必須以「純計數文字」當訊號（非 hostname / 單站 class）', () => {
    assert.ok(/likes\?\|restacks\?\|reactions\?/.test(CLEANER_SRC),
      'REACTION_COUNT_RE 必須匹配 likes/restacks/reactions 計數詞');
    assert.ok(!/essesmag|substack\.com/i.test(CLEANER_SRC.match(/REACTION_COUNT_RE[\s\S]{0,200}/)[0]),
      '不可綁定 hostname');
  });
  it('靜態 clean 與動態 observer 都使用 isReactionCountBar（單一資料源）', () => {
    assert.ok(/safeRun\(hideInsideArticleReactionBars/.test(CLEANER_SRC), 'clean() 必須 safeRun 靜態 sweep');
    const dyn = CLEANER_SRC.match(/function\s+checkDynamicNoise[\s\S]*?\n  \}/)[0];
    assert.ok(/isReactionCountBar/.test(dyn), 'checkDynamicNoise 必須呼叫共用 predicate（lazy 兜底）');
  });
});

describe('substack-reaction-count-bar — 行為', () => {
  it('靜態：clean 當下的 like bar 從外層 border-top 容器整塊 hide', () => {
    const { doc, art, NS } = buildEnv({ withBar: true });
    const bar = doc.getElementById('likebar');
    const hidden = NS.cleaner.clean(art);
    assert.strictEqual(bar.dataset.jreadHidden, '1',
      '外層 like bar（border-top 那層）應整塊 hide');
    NS.cleaner.restore(hidden);
  });

  it('靜態：「N Restacks」「N Reactions」變體同樣命中', () => {
    for (const ct of ['12 Restacks', '5 Reactions', '1 Like', '1,024 Likes']) {
      const { doc, art, NS } = buildEnv({ withBar: true, countText: ct });
      const hidden = NS.cleaner.clean(art);
      assert.strictEqual(doc.getElementById('likebar').dataset.jreadHidden, '1',
        `計數變體「${ct}」應命中`);
      NS.cleaner.restore(hidden);
    }
  });

  it('靜態：三種圓點分隔符（U+00B7 · / U+2022 • / U+2219 ∙）多計數串皆命中（v1.6.31 culpium ∙）', () => {
    // culpium.com 實測分隔符是 U+2219 BULLET OPERATOR（「13 Likes∙1 Restack」），
    // 與 U+00B7 MIDDLE DOT / U+2022 BULLET 視覺近似但 code point 不同——分隔符類
    // 三者都要涵蓋，否則「N Likes<sep>N Restack」整串比對失敗漏網。
    const variants = ['13 Likes∙1 Restack', '3 Likes · 2 Restacks', '5 Likes • 2 Restacks'];
    for (const ct of variants) {
      const { doc, art, NS } = buildEnv({ withBar: true, countText: ct });
      const hidden = NS.cleaner.clean(art);
      assert.strictEqual(doc.getElementById('likebar').dataset.jreadHidden, '1',
        `分隔符變體「${ct}」應命中`);
      NS.cleaner.restore(hidden);
    }
  });

  it('靜態：translate-first 量詞形態「15 個讚 · 1 次轉發」「1 次轉發」命中（v1.7.2 culpium）', () => {
    // Traditional TW 翻法：Like→個讚、Restack→次轉發——數字與反應名詞之間夾了量詞
    // 「個」「次」，舊 pattern 要求數字後直接接名詞 → 漏網。新 pattern 允許 0–3 字短
    // CJK 前綴（量詞）但仍要求 token 以已知反應名詞收尾。同時涵蓋既有簡體翻法。
    const variants = ['15 個讚 · 1 次轉發', '15 個讚·1 次轉發', '1 次轉發', '15 贊∙1 重新堆疊', '5 次分享 · 3 個讚'];
    for (const ct of variants) {
      const { doc, art, NS } = buildEnv({ withBar: true, countText: ct });
      const hidden = NS.cleaner.clean(art);
      assert.strictEqual(doc.getElementById('likebar').dataset.jreadHidden, '1',
        `量詞翻譯變體「${ct}」應命中`);
      NS.cleaner.restore(hidden);
    }
  });

  it('靜態：translate-first「轉貼」譯法變體「551 個讚 · 72 次轉貼」命中（v1.7.10 honest-broker）', () => {
    // Google MT 對 Restack 的第三種譯法「次轉貼」（Jimmy 實機截圖）；同頁 probe 另一輪
    // 跑出「贊∙重新堆疊」——譯法逐次不穩定，反應名詞清單補 轉貼/转贴。
    const variants = ['551 個讚 · 72 次轉貼', '72 次轉貼', '72 次转贴 · 551 个赞'];
    for (const ct of variants) {
      const { doc, art, NS } = buildEnv({ withBar: true, countText: ct });
      const hidden = NS.cleaner.clean(art);
      assert.strictEqual(doc.getElementById('likebar').dataset.jreadHidden, '1',
        `「轉貼」翻譯變體「${ct}」應命中`);
      NS.cleaner.restore(hidden);
    }
  });

  it('靜態：translate-first「重推」譯法變體「16 個讚 · 1 次重推」命中（v1.7.11 culpium）', () => {
    // Google MT 對 Restack 的第四種譯法「次重推」（Jimmy 實機截圖）；同頁 probe 本輪
    // 跑出「16 贊∙1 重新堆疊」——再證譯法逐次不穩定，反應名詞清單補 重推（簡繁同形）。
    const variants = ['16 個讚 · 1 次重推', '1 次重推', '16 个赞 · 1 次重推'];
    for (const ct of variants) {
      const { doc, art, NS } = buildEnv({ withBar: true, countText: ct });
      const hidden = NS.cleaner.clean(art);
      assert.strictEqual(doc.getElementById('likebar').dataset.jreadHidden, '1',
        `「重推」翻譯變體「${ct}」應命中`);
      NS.cleaner.restore(hidden);
    }
  });

  it('守衛：主文含「數字＋量詞」但不以反應名詞收尾者不誤殺（如「3 個重點」「2024 年」）', () => {
    // 新增的 0–3 字 CJK 前綴不可鬆到把主文短語吃進來——關鍵是 token 必須以「已知反應
    // 名詞」收尾。這些短語結尾（重點 / 年）非反應名詞 → 一律 miss。
    for (const txt of ['3 個重點', '2024 年', '花了 3 天', '共 5 則新聞']) {
      const decoy = `<div id="decoy"><a href="/x"><img src="u.jpg"></a><span>${txt}</span></div>`;
      const { doc, art, NS } = buildEnv({ withBar: false, decoyHtml: decoy });
      const hidden = NS.cleaner.clean(art);
      assert.notStrictEqual(doc.getElementById('decoy').dataset.jreadHidden, '1',
        `「${txt}」不以反應名詞收尾，不可命中 reaction bar 規則`);
      NS.cleaner.restore(hidden);
    }
  });

  it('動態（核心）：lazy 注入的 like bar 經 observer 整塊被 hide', async () => {
    const { doc, art, NS } = buildEnv({ withBar: false });
    const hidden = NS.cleaner.clean(art);
    const tmp = doc.createElement('div');
    tmp.innerHTML = likeBarHtml();
    const bar = tmp.firstElementChild;
    art.appendChild(bar);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(bar.dataset.jreadHidden, '1',
      'lazy 注入的 like bar 必須經 checkDynamicNoise + isReactionCountBar 整塊 hide');
    NS.cleaner.restore(hidden);
  });

  it('守衛：主文長段不被誤殺', () => {
    const { doc, art, NS } = buildEnv({ withBar: true });
    const hidden = NS.cleaner.clean(art);
    assert.notStrictEqual(doc.getElementById('b1').dataset.jreadHidden, '1', '主文段 b1 不可被 hide');
    assert.notStrictEqual(doc.getElementById('b2').dataset.jreadHidden, '1', '主文段 b2 不可被 hide');
    NS.cleaner.restore(hidden);
  });

  it('守衛：文字含計數但非「純計數」的容器不誤殺（如「3 Likes are not enough」）', () => {
    const decoy = `<div id="decoy"><a href="/x"><img src="u.jpg"></a><span>3 Likes are not enough to describe this</span></div>`;
    const { doc, art, NS } = buildEnv({ withBar: false, decoyHtml: decoy });
    const hidden = NS.cleaner.clean(art);
    assert.notStrictEqual(doc.getElementById('decoy').dataset.jreadHidden, '1',
      '非純計數（含其他敘述文字）不可命中 reaction bar 規則');
    NS.cleaner.restore(hidden);
  });

  it('可逆：restore 後 like bar 的 inline display 還原', () => {
    const { doc, art, NS } = buildEnv({ withBar: true });
    const bar = doc.getElementById('likebar');
    const hidden = NS.cleaner.clean(art);
    assert.strictEqual(bar.style.display, 'none');
    NS.cleaner.restore(hidden);
    assert.notStrictEqual(bar.dataset.jreadHidden, '1', 'restore 後 jreadHidden 標記應清除');
    assert.notStrictEqual(bar.style.display, 'none', 'restore 後 display 不應殘留 none');
  });
});
