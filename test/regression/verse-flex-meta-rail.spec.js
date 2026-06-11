// JRead — hideInsideArticleSidebarColumns 條件 E：flex 拉伸的近空直立 rail
// （v0.8.23）
//
// 對應 bug：verse.com.tw/article/kanda reader mode 開啟後，主文左側殘留
// 直書 credit rail「文字、攝影／TC 盾」+ 書籤 icon。
// 原頁結構：article > div.content-wrapper(display:flex) >
//   [div.content(主文，textLen 大), div.meta(credit rail，textLen 小)]。
// 既有條件全漏：
//   - A/C 要 linkDensity > 0.5——meta 是純文字 credit + icon，ld 低
//   - B 要 <aside> tag——meta 是 <div>
//   - D 要 sibling 含 heading——meta 無 heading
// 又因 cleaner 跑在 styler 之前，clean-time meta 是 255×9883（非 styler
// reflow 後的 28px 窄），靠絕對窄寬度判斷會漏。
//
// 修法：條件 E——父 flex + sibling 文字極小（< main × 10%）+ 高 > 400 +
// 寬 < main 寬 × 0.5 + 高 > 寬 × 2 + 不含 >= 120×120 真圖片 → hide。
// 連帶修好「rail 吃掉 flex 寬度讓主文窄於版心」（WIDTH AUDIT 同源）。

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const JREAD_DIR = path.join(__dirname, '..', '..', 'jread', 'content');
const DETECTOR_SRC = fs.readFileSync(path.join(JREAD_DIR, 'detector.js'), 'utf8');
const CLEANER_SRC = fs.readFileSync(path.join(JREAD_DIR, 'cleaner.js'), 'utf8');

function stubRect(el, rect) {
  el.getBoundingClientRect = () => ({
    top: rect.top || 0, bottom: (rect.top || 0) + rect.height,
    left: rect.left || 0, right: (rect.left || 0) + rect.width,
    width: rect.width, height: rect.height,
    x: rect.left || 0, y: rect.top || 0
  });
}

describe('cleaner — hideInsideArticleSidebarColumns 條件 E：flex 拉伸的近空直立 rail（v0.8.23）', () => {
  let w, metaRail, mainContent;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'verse-flex-meta-rail.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    w = dom.window;

    mainContent = w.document.getElementById('main-content');
    metaRail = w.document.getElementById('meta-rail');
    assert.ok(mainContent && metaRail);

    // stub rect：clean-time（styler reflow 前）幾何。
    // main.content 704×9883；meta rail 255×9883（被 flex align-stretch 拉到等高）。
    stubRect(mainContent, { top: 100, width: 704, height: 9883 });
    stubRect(metaRail, { top: 100, left: 704, width: 255, height: 9883 });

    // v0.8.37：改載真 namespace.js（stripSiteSuffix 等共用 helper 需要）

    w.chrome = w.chrome || { runtime: { getManifest: () => ({ version: "0.0.0-test" }), id: "t", sendMessage: () => {}, getURL: (p) => "x/" + p } };

    w.eval(require("../helpers").SRC.namespace);
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);

    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中文章根');
    w.__JRead.cleaner.clean(detected.el);
  });

  it('fixture 結構：meta rail 文字 < main × 10% 且高 > 寬 × 2', () => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const mainLen = norm(mainContent.textContent).length;
    const railLen = norm(metaRail.textContent).length;
    assert.ok(railLen < mainLen * 0.1,
      `meta rail textLen(${railLen}) 應 < main(${mainLen}) × 10%`);
    const r = metaRail.getBoundingClientRect();
    assert.ok(r.height >= r.width * 2, 'rail 高 >= 寬 × 2');
  });

  it('meta rail（credit + 書籤 icon）被條件 E hide（核心驗證點）', () => {
    assert.strictEqual(metaRail.dataset.jreadHidden, '1',
      'flex 拉伸的近空直立 credit rail 應被條件 E hide，' +
      '否則 verse 類「文字、攝影／TC」直書 byline + 書籤殘留在主文左側');
  });

  it('主文欄不可被 hide', () => {
    assert.notStrictEqual(mainContent.dataset.jreadHidden, '1');
    for (const p of mainContent.querySelectorAll('p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1', '主文段落須保留');
    }
  });

  it('h1 標題保留', () => {
    const h1 = mainContent.querySelector('h1');
    assert.notStrictEqual(h1.dataset.jreadHidden, '1');
  });
});

describe('cleaner — 條件 E image guard：含真圖片的窄高 flex 欄不被誤殺', () => {
  it('side-figure 欄（含 >= 120×120 img）保留', () => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'verse-flex-image-rail-guard.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;

    const mainContent = w.document.getElementById('main-content');
    const imageRail = w.document.getElementById('image-rail');
    const railImg = w.document.getElementById('rail-img');
    assert.ok(mainContent && imageRail && railImg);

    stubRect(mainContent, { top: 100, width: 704, height: 5000 });
    stubRect(imageRail, { top: 100, left: 704, width: 300, height: 5000 });
    stubRect(railImg, { top: 100, left: 704, width: 300, height: 400 });

    // v0.8.37：改載真 namespace.js（stripSiteSuffix 等共用 helper 需要）

    w.chrome = w.chrome || { runtime: { getManifest: () => ({ version: "0.0.0-test" }), id: "t", sendMessage: () => {}, getURL: (p) => "x/" + p } };

    w.eval(require("../helpers").SRC.namespace);
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);

    const detected = w.__JRead.detector.detect();
    assert.ok(detected);
    w.__JRead.cleaner.clean(detected.el);

    assert.notStrictEqual(imageRail.dataset.jreadHidden, '1',
      '含 >= 120×120 真圖片的窄高 flex 欄應被 image guard 保護，不得誤殺');
  });
});
