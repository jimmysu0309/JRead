// JRead — cleaner regression spec
// 對應 fixture：test/regression/fixtures/businessweekly-7014035.html
// 涵蓋四條路徑：語意標籤 / fixed-sticky / 社群分享 cluster / 主文內 keyword。
//
// jsdom 不算 layout（getBoundingClientRect 全回 0），所以對 fixture 中帶
// position:fixed/sticky 的元素我們 stub rect，讓 fixed 分支能被覆蓋到。
// 這是測試環境限制的妥協，不是真實世界邏輯變形。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');
const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'),
  'utf8'
);
const DETECTOR_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'),
  'utf8'
);

// viewport 模擬
const VW = 1000;
const VH = 600;

// 手動對應 fixture 中帶 inline position:fixed 的元素預期 rect（px）。
// 原因：fixture 用 100% / 百分比表達寬高與位置，jsdom 不解析，只能預設結果。
const FIXED_RECTS = {
  '.postnav.fixed':      { top: 0,        width: VW, height: 50  }, // top bar
  '#progress-wrapper':   { top: 0,        width: VW, height: 4   }, // progress bar
  '#gdrp-el':            { top: VH - 80,  width: VW, height: 80  }, // bottom popup
  '.Floating-Setting':   { top: VH * 0.4, width: 60, height: 240 }, // side tool
  '#shortModel':         { top: VH * 0.8, width: 120, height: 80 }  // bottom popup
};

function stubRect(el, rect) {
  el.getBoundingClientRect = () => ({
    top: rect.top,
    bottom: rect.top + rect.height,
    left: 0,
    right: rect.width,
    width: rect.width,
    height: rect.height,
    x: 0,
    y: rect.top
  });
}

function loadFixture() {
  const html = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;

  // stub viewport
  Object.defineProperty(window, 'innerWidth',  { value: VW, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: VH, configurable: true });

  // stub fixed/sticky 元素的 rect
  for (const [sel, rect] of Object.entries(FIXED_RECTS)) {
    const el = window.document.querySelector(sel);
    assert.ok(el, `fixture 中應存在 ${sel}`);
    stubRect(el, rect);
  }

  // 最小 NS
  window.__JRead = { state: {}, MSG: {} };
  window.eval(DETECTOR_SRC);
  window.eval(CLEANER_SRC);
  return window;
}

describe('cleaner — businessweekly-7014035', () => {
  let window, document, articleEl, hidden;

  before(() => {
    window = loadFixture();
    document = window.document;
    const detected = window.__JRead.detector.detect();
    assert.ok(detected, 'detector 應成功命中商周主文');
    articleEl = detected.el;
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  it('隱藏總數 ≥ 10（語意 + fixed + keyword 合計）', () => {
    assert.ok(
      hidden.length >= 10,
      `實際隱藏 ${hidden.length} 個元素（期望 ≥ 10）。` +
      `清單：${hidden.map(h => h.el.id || h.el.className || h.el.tagName).join(', ')}`
    );
  });

  it('保留元素一律未被隱藏（summary / figure / figcaption / blockquote）', () => {
    const preserveSel = 'summary, figure, figcaption, blockquote';
    const preserved = document.querySelectorAll(preserveSel);
    assert.ok(preserved.length > 0, 'fixture 中必須有保留元素以供驗證');

    for (const el of preserved) {
      assert.notStrictEqual(
        el.dataset.jreadHidden, '1',
        `保留元素 <${el.tagName.toLowerCase()}> 不應被標記隱藏`
      );
      assert.notStrictEqual(
        el.style.display, 'none',
        `保留元素 <${el.tagName.toLowerCase()}> 的 display 不應為 none`
      );
    }
  });

  it('<summary> 仍可被 querySelector 找到且文字內容保留', () => {
    const summary = document.querySelector('summary');
    assert.ok(summary, '<summary> 必須存在');
    assert.ok(
      summary.textContent.includes('editor bullet'),
      'summary 內 editor bullets 文字必須保留（Unclutter 在商周踩過這坑）'
    );
  });

  it('主文內 paywall 區塊被標記隱藏（keyword: paywall）', () => {
    const el = document.querySelector('.postbody.paywall');
    assert.ok(el, 'fixture 中應有 .postbody.paywall');
    assert.strictEqual(el.dataset.jreadHidden, '1');
  });

  it('#Epaper-subscribe 被標記隱藏（keyword: subscribe）', () => {
    const el = document.getElementById('Epaper-subscribe');
    assert.ok(el);
    assert.strictEqual(el.dataset.jreadHidden, '1');
  });

  it('主文外語意標籤被隱藏（header / footer）', () => {
    assert.strictEqual(document.getElementById('header').dataset.jreadHidden, '1');
    assert.strictEqual(document.querySelector('footer.footer-wrap').dataset.jreadHidden, '1');
  });

  it('fixed/sticky 元素全部被隱藏（top bar / side tool / bottom popup）', () => {
    for (const sel of Object.keys(FIXED_RECTS)) {
      const el = document.querySelector(sel);
      assert.strictEqual(
        el.dataset.jreadHidden, '1',
        `${sel} 應被 fixed/sticky 規則命中隱藏`
      );
    }
  });

  it('含 <img>/<picture>/<video> 的容器即使符合其他 action-toolbar 條件也不隱藏', () => {
    // Substack 的 captioned-image-container：含 img + 多個 svg（zoom / loading）
    // + 短文字，符合 action-toolbar 的 iconCount / text / no-<p> 條件，但它
    // 是內容容器；加 img 排除條件避免誤殺
    const el = document.querySelector('.captioned-image-container');
    assert.ok(el, 'fixture 必須有 .captioned-image-container');
    assert.notStrictEqual(
      el.dataset.jreadHidden, '1',
      '含 <img> 的容器不該被 action-toolbar 規則隱藏'
    );
    const img = el.querySelector('img');
    assert.notStrictEqual(
      img.dataset.jreadHidden, '1',
      '其內的 <img> 不該被隱藏'
    );
  });

  it('主文內 action toolbar 被隱藏（含多個 button/svg、自身文字短、無 <p> 子）', () => {
    // Medium / Substack 類的 post footer：拍手/回應/收藏/更多
    // class 被混淆（xp-1a2b3c）、無 keyword、無法用既有規則命中
    const el = document.querySelector('.xp-1a2b3c');
    assert.ok(el, 'fixture 必須有 action toolbar 模擬元素');
    assert.strictEqual(el.dataset.jreadHidden, '1', 'action toolbar 必須被隱藏');
  });

  it('含 h1-h6 直接子的容器即使符合 action-row 其他條件也不得隱藏（保留 post-header 標題區塊）', () => {
    // ChinaTalk (Substack) quantum-101 實測：div.post-header 包 <h1 post-title>
    // + 作者/日期 meta + 多個 like/comment/share/more button，命中 action-row
    // 的「無 p、無媒體、短文字、多 icon」條件但含 <h1>。若規則不排除，會砍
    // 掉整個標題區塊。通則：action row 是圖示互動列，絕不會包含 heading。
    const el = document.querySelector('.post-header');
    assert.ok(el, 'fixture 必須有 post-header 模擬元素');
    assert.notStrictEqual(
      el.dataset.jreadHidden, '1',
      '含 <h1> 的容器不得被 action-row 規則隱藏'
    );
    // 內部 h1 亦不得被隱藏（容器未隱藏，其子元素 inline display 也不會被改）
    const h1 = el.querySelector('h1.post-title');
    assert.ok(h1, 'fixture post-header 內必須有 h1.post-title');
    assert.notStrictEqual(
      h1.dataset.jreadHidden, '1',
      'h1.post-title 不得被隱藏'
    );
  });

  it('主文內 role="dialog" 元素被隱藏（ARIA 語意 dialog 絕非正文內容）', () => {
    // Substack .subscribeDialog：position:absolute、在 article 內、class 被混淆、
    // 無 keyword、非 fixed——僅 role="dialog" 能命中
    const el = document.querySelector('.subscribeDialog-ApxQJS');
    assert.ok(el, 'fixture 必須有 subscribe dialog 模擬元素');
    assert.strictEqual(el.dataset.jreadHidden, '1', 'role="dialog" 必須被隱藏');
  });

  it('ancestor-siblings 規則命中非語意/非 fixed/無 keyword 的 brand rail', () => {
    // 模擬 Medium / Substack 上方站名 header——舊三條規則全漏，
    // 僅 ancestor-siblings 能命中
    const el = document.querySelector('.brand-rail');
    assert.ok(el, 'fixture 必須有 .brand-rail');
    assert.strictEqual(el.dataset.jreadHidden, '1', '.brand-rail 必須被隱藏');
  });

  it('restore() 移除所有 jreadHidden 標記並還原 display', () => {
    window.__JRead.cleaner.restore(hidden);
    const stillHidden = document.querySelectorAll('[data-jread-hidden="1"]');
    assert.strictEqual(stillHidden.length, 0, '還原後不應有任何元素仍帶 data-jread-hidden');

    for (const item of hidden) {
      assert.notStrictEqual(
        item.el.style.display, 'none',
        '還原後 display 不應留在 none'
      );
    }
  });
});
