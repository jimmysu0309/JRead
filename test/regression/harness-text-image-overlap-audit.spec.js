// JRead — harness text-image overlap audit（圖疊文偵測，2026-06-25）
// -----------------------------------------------------------------------------
// Forcing function for audit-lib.js auditTextImageOverlap。
// Trigger（Page Rounds 2026-06-25 autocar.co.uk）：作者 bio 區用 float 圓形頭像
// 裁切容器（DIV.personality.clearfix），reader 攤平 float 後 608px 頭像溢出
// 142px 裁切容器、bio 段落落到圖片上 100% 重疊（frac=1.0）。既有 overflow / gap
// / contrast / narrow audit 全測不到（文字 rect 在 card 內、無水平溢出、對比夠、
// 寬度正常），harness 判 review；Jimmy 截圖揭穿實際嚴重破版。補這條「文字 rect
// vs img rect 幾何重疊」audit 才抓得到。
//
// 訊號層次：本 spec 用 stubRect 模擬幾何（jsdom 無 layout engine、rect 全 0），
// 驗演算法的幾何判定（重疊命中 / 不重疊不命中 / 祖孫包含排除 / 小圖忽略 / 無
// reader card 安全回傳）；真實站點 layout 由 page-rounds / debug-harness 實跑驗。

const assert = require('assert');
const path = require('path');
const { JSDOM } = require('jsdom');

const auditLib = require(path.join(__dirname, '..', '..', 'tools', 'audit-lib.js'));

// 在 jsdom window 內重建 pageFn（等價 page.evaluate 序列化），確保自包含。
function rebuild(window) {
  return window.eval(`(${auditLib.pageFns.auditTextImageOverlap.toString()})`);
}

// 給元素掛固定 rect（jsdom getBoundingClientRect 預設全 0）。
function stubRect(el, { left, top, width, height }) {
  el.getBoundingClientRect = () => ({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top
  });
}

function makeDom(bodyHtml) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${bodyHtml}</body>`, {
    runScripts: 'outside-only', pretendToBeVisual: true
  });
  return dom;
}

describe('harness audit — text-image overlap（圖疊文，autocar 補洞）', () => {

  it('段落 rect 與大圖 rect 高度重疊 → overlap=true、列出命中段落', () => {
    const dom = makeDom(`
      <article data-jread-active="1">
        <img id="avatar">
        <p id="bio">Matt is Autocar's lead features writer and presenter</p>
      </article>
    `);
    const { window } = dom;
    const img = window.document.getElementById('avatar');
    const bio = window.document.getElementById('bio');
    // 模擬 autocar：608x608 圓頭像、bio 段落整個落在圖片矩形內（frac≈1）
    stubRect(img, { left: 336, top: 100, width: 608, height: 608 });
    stubRect(bio, { left: 340, top: 300, width: 560, height: 80 });
    const res = rebuild(window)();
    assert.strictEqual(res.overlap, true, '段落整個疊在大圖上應判 overlap=true');
    assert.strictEqual(res.overlapCount, 1);
    assert.ok(res.items[0].text.includes('Matt is Autocar'), '命中項應含該段文字');
    assert.ok(res.items[0].frac >= 0.5, `frac 應 >= 0.5，實得 ${res.items[0].frac}`);
  });

  it('段落與圖片不重疊（圖上方、文字下方正常流）→ overlap=false', () => {
    const dom = makeDom(`
      <article data-jread-active="1">
        <img id="hero">
        <p id="body">Normal linear flow paragraph below the image with no overlap at all</p>
      </article>
    `);
    const { window } = dom;
    stubRect(window.document.getElementById('hero'), { left: 56, top: 100, width: 608, height: 400 });
    // 段落在圖片下方（top 520 > 圖片 bottom 500），零重疊
    stubRect(window.document.getElementById('body'), { left: 56, top: 520, width: 608, height: 80 });
    const res = rebuild(window)();
    assert.strictEqual(res.overlap, false, '線性流（圖上文下）不該誤判圖疊文');
    assert.strictEqual(res.overlapCount, 0);
  });

  it('inline 圖在段落內（祖孫包含）→ 不算圖疊文', () => {
    const dom = makeDom(`
      <article data-jread-active="1">
        <p id="para">Inline image <img id="inline"> inside this paragraph is legitimate</p>
      </article>
    `);
    const { window } = dom;
    const para = window.document.getElementById('para');
    const inline = window.document.getElementById('inline');
    // 圖在段落內、rect 完全落在段落 rect 內——若不排除包含關係會誤報
    stubRect(para, { left: 56, top: 100, width: 608, height: 200 });
    stubRect(inline, { left: 100, top: 120, width: 120, height: 120 });
    const res = rebuild(window)();
    assert.strictEqual(res.overlap, false, '段落自身的 inline 圖是合法包含、不可判圖疊文');
  });

  it('小圖（< 80px 雙維）忽略 → 不算圖疊文', () => {
    const dom = makeDom(`
      <article data-jread-active="1">
        <img id="icon">
        <p id="t">Some text near a tiny icon-sized image element should be ignored</p>
      </article>
    `);
    const { window } = dom;
    // icon 尺寸 40x40，即使與文字重疊也忽略（避免項目符號 / 小 icon 誤報）
    stubRect(window.document.getElementById('icon'), { left: 56, top: 100, width: 40, height: 40 });
    stubRect(window.document.getElementById('t'), { left: 56, top: 100, width: 560, height: 80 });
    const res = rebuild(window)();
    assert.strictEqual(res.overlap, false, '< 80px 小圖不納入幾何比對');
  });

  it('無 reader card → 安全回傳 no article', () => {
    const dom = makeDom('<p>plain page, no reader</p>');
    const res = rebuild(dom.window)();
    assert.strictEqual(res.error, 'no article');
    assert.strictEqual(res.overlap, false);
  });

  it('audit-lib 匯出 runTextImageOverlapAudit wrapper', () => {
    assert.strictEqual(typeof auditLib.runTextImageOverlapAudit, 'function',
      'audit-lib 必須匯出 runTextImageOverlapAudit（harness 接線依賴）');
  });
});
