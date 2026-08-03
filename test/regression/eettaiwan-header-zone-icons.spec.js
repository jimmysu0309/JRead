// JRead — eettaiwan 標題下方裝飾 icon + collapse 後 svg icon 爆大 regression
// 對應 fixture：test/regression/fixtures/eettaiwan-header-zone-icons.html
//
// 兩條通則（v0.8.43）：
// 1) hideHeaderZoneDecorativeIcons：article 開頭到第一個內容區塊（首段長
//    文字 / 第一張內容尺寸媒體）之間是 header zone，zone 內 icon 尺寸
//    （<= 32px 見方）的 img / svg 一律 hide——標題下方除了作者及日期文字
//    不出現 icon（Jimmy 2026-06-11 通則）。heading 內 emoji 與 zone 之後
//    的內文 inline emoji 不可誤殺。
// 2) collapseGridWithHiddenCell child reset 跳過 replaced element：
//    `width: auto !important` 是給 Bootstrap col-* 類 layout 欄位的，套到
//    `<img>`（尤其 viewBox-only SVG 無內在尺寸）會清掉原站 icon 寬度、
//    撐滿容器（eettaiwan tags.svg 18px → 603px 實測）。
//
// jsdom 無 layout engine（getBoundingClientRect 全回 0），icon / 媒體 rect
// 由 spec stub——這是測試環境限制的妥協，不是真實世界邏輯變形。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'eettaiwan-header-zone-icons.html');

function stubRect(el, w, h) {
  el.getBoundingClientRect = () => ({
    top: 0, bottom: h, left: 0, right: w, width: w, height: h, x: 0, y: 0
  });
}

function load() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1000, height: 600 },
    pretendToBeVisual: true
  });
  const d = env.document;
  // icon 尺寸 rect stub（真實站由 site CSS 給 18px）
  stubRect(d.querySelector('.detail-timeicon'), 18, 18);
  stubRect(d.querySelector('.detail-usericon'), 18, 18);
  stubRect(d.querySelector('.title-emoji'), 20, 20);
  stubRect(d.querySelector('.content-emoji'), 20, 20);
  stubRect(d.querySelector('.content-tags'), 18, 18);
  // collapseInnerFlexWrap 的 wrap 判定：in-flow children top 差 > 5px
  const stubRectAt = (el, w, h, top) => {
    el.getBoundingClientRect = () => ({
      top, bottom: top + h, left: 0, right: w, width: w, height: h, x: 0, y: top
    });
  };
  stubRectAt(d.querySelector('.wrap-tags-icon'), 18, 18, 2000);
  stubRectAt(d.querySelector('.wrap-links-a'), 300, 20, 2000);
  stubRectAt(d.querySelector('.wrap-links-b'), 300, 20, 2030);
  // v1.7.30 today.line.me icon cell：byline grid 列的 rect（icon 連結 42px
  // 定寬、名稱欄 200px 有文字、subscribe 按鈕 60px——按鈕會先被 hide）
  stubRectAt(d.querySelector('.pub-row'), 600, 48, 2100);
  stubRectAt(d.querySelector('.pub-icon-link'), 42, 42, 2100);
  stubRectAt(d.querySelector('.pub-icon-figure'), 42, 42, 2100);
  stubRectAt(d.querySelector('.pub-icon-img'), 42, 42, 2100);
  stubRectAt(d.querySelector('.pub-name'), 300, 20, 2100);
  stubRectAt(d.querySelector('.subscribe-button'), 60, 32, 2100);
  // LINE Today 真實條件：icon img 的 natural 是 280×280（retina srcset）→
  // anchorIsContentImageLink 豁免、icon-only <a> 規則不 hide（與真站一致；
  // jsdom naturalWidth 恆 0 需 stub）
  Object.defineProperty(d.querySelector('.pub-icon-img'), 'naturalWidth', { value: 280 });
  Object.defineProperty(d.querySelector('.pub-icon-img'), 'naturalHeight', { value: 280 });
  return env.window;
}

describe('eettaiwan — header zone 裝飾 icon + collapse svg icon 爆大', () => {
  let window, document, hidden;

  before(() => {
    window = load();
    document = window.document;
    const detected = window.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    hidden = window.__JRead.cleaner.clean(detected.el);
  });

  after(() => {
    if (hidden) window.__JRead.cleaner.restore(hidden);
  });

  it('byline 裝飾 icon（detail-timeicon / detail-usericon）被 hide', () => {
    assert.strictEqual(document.querySelector('.detail-timeicon').dataset.jreadHidden, '1',
      '日期旁的時鐘 icon 應被 hideHeaderZoneDecorativeIcons hide');
    assert.strictEqual(document.querySelector('.detail-usericon').dataset.jreadHidden, '1',
      '作者旁的人像 icon 應被 hideHeaderZoneDecorativeIcons hide');
  });

  it('作者與日期文字保留', () => {
    assert.notStrictEqual(document.querySelector('.detail-time').dataset.jreadHidden, '1',
      '日期文字不得被 hide');
    assert.notStrictEqual(document.querySelector('.detail-user').dataset.jreadHidden, '1',
      '作者文字不得被 hide');
  });

  it('heading 內 emoji 不誤殺（標題 emoji 是內容）', () => {
    assert.notStrictEqual(document.querySelector('.title-emoji').dataset.jreadHidden, '1',
      'h1 內的 emoji img 不得被 header zone icon 規則誤殺');
  });

  it('zone 之後的內文 inline emoji 不誤殺', () => {
    assert.notStrictEqual(document.querySelector('.content-emoji').dataset.jreadHidden, '1',
      '首段之後的內文 emoji img 不得被 header zone icon 規則誤殺');
  });

  it('collapse 後 flex container 的 img child 不被套 width:auto（防 viewBox-only SVG 爆大）', () => {
    const footer = document.querySelector('.content-footer');
    assert.strictEqual(footer.dataset.jreadCollapsed, '1',
      'content-footer（flex-row + hidden child）應被 collapseGridWithHiddenCell collapse');
    const tagsImg = document.querySelector('.content-tags');
    assert.strictEqual(tagsImg.style.getPropertyValue('width'), '',
      'replaced element（img）不得被套 child width reset——width:auto 會讓無內在尺寸的 SVG img 撐滿容器');
    assert.strictEqual(tagsImg.style.getPropertyValue('flex-basis'), '',
      'replaced element（img）不得被套 child flex reset');
    // 非 replaced 的 div child 照舊 reset（Bootstrap col-* 場景的既有行為不可退化）
    const links = document.querySelector('.content-tag-links');
    assert.strictEqual(links.style.getPropertyValue('width'), 'auto',
      '非 replaced 的 div child 仍應被套 width:auto reset（既有 Lawfaremedia col-md-8 行為）');
  });

  it('flex-wrap collapse（collapseInnerFlexWrap）的 img child 同樣不被套 width:auto', () => {
    const wrapFooter = document.querySelector('.wrap-footer');
    assert.strictEqual(wrapFooter.dataset.jreadCollapsed, '1',
      'wrap-footer（flex-row + children top 差 > 5px = wrap 已啟動）應被 collapseInnerFlexWrap collapse');
    const icon = document.querySelector('.wrap-tags-icon');
    assert.strictEqual(icon.style.getPropertyValue('width'), '',
      'replaced element（img）不得被 collapseInnerFlexWrap 套 child width reset——真實站 content-footer 走這條 path');
    // 非 replaced 的 div child 照舊 reset（healthsystemtracker 既有行為不可退化）
    const linksA = document.querySelector('.wrap-links-a');
    assert.strictEqual(linksA.style.getPropertyValue('width'), 'auto',
      '非 replaced 的 div child 仍應被套 width:auto reset');
  });

  it('icon 級小 cell（包 figure 的連結）collapse 後釘住原寬、不套 width:auto（v1.7.30 today.line.me 巨圓）', () => {
    const row = document.querySelector('.pub-row');
    const iconLink = document.querySelector('.pub-icon-link');
    const name = document.querySelector('.pub-name');
    assert.strictEqual(document.querySelector('.subscribe-button').dataset.jreadHidden, '1',
      'subscribe 按鈕應先被 hide（觸發 collapse 條件 A 的 hidden sibling）');
    assert.strictEqual(row.dataset.jreadCollapsed, '1',
      'pub-row（grid + hidden child）應被 collapseGridWithHiddenCell collapse');
    assert.strictEqual(iconLink.style.getPropertyValue('width'), '42px',
      'icon 級小 cell（<= 120px、無文字）應被釘住塌欄前量到的寬度');
    assert.strictEqual(iconLink.style.getPropertyValue('display'), 'inline-block',
      'icon 級小 cell 須設 display:inline-block——container 塌成 block 後 inline 元素寬度定義失效，' +
      '內部相對寬度 figure 會撐滿容器（LINE Today 42px icon → 608px 巨圓實測）');
    assert.strictEqual(name.style.getPropertyValue('width'), 'auto',
      '有文字的一般 cell 仍應照舊套 width:auto reset（既有行為不可退化）');
  });

  it('「透過《Google 新聞》追蹤」follow CTA 被 link text heuristic hide', () => {
    const cta = document.querySelector('.google-jump-container a');
    assert.ok(cta, 'fixture 必須有 Google 新聞 CTA 連結');
    // CTA 文字占 parent 比例 >= 80% → 規則升級 hide parent container；驗
    // 祖先鏈上（a 或 container）至少一個被 hide
    let cur = cta, found = false;
    while (cur && cur.tagName !== 'ARTICLE') {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { found = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(found,
      'Google 新聞 follow CTA（透過…追蹤 語序）應被 NOISE_LINK_TEXT_RE 命中、自身或 container 被 hide');
  });
});
