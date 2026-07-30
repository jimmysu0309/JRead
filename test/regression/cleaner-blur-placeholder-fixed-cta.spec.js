// JRead — regression spec: blur-up placeholder 假 hero + 主文內 fixed CTA +
// Advertisement 純 label（v1.7.24）
// -----------------------------------------------------------------------------
// Trigger: 2026-07-30 Jimmy 截圖回報 nytimes.com/wirecutter podcast 頁兩症狀：
// (1) hero 重複——站方 lazy blur-up pattern 的低解析 placeholder <img>
//     （naturalWidth 150、CSS filter: blur(10px)、原本 absolute 疊在真圖下）
//     被 styler 的媒體 position static reset 拉回 normal flow，與真圖
//     <picture><img>（1861×930）上下排成兩張（一模糊一清晰）。
// (2) 「See all our picks / 查看我們所有的精選清單」浮動 pill——fixed、掛在
//     articleEl 內部，hideFixedOutsideArticle 的 isRelated 對主文內一律跳過
//     ＝規則盲區，pill 疊在正文上跟著捲動。
// harness 驗收時另揪出 (3) 廣告位純 label「Advertisement」殘留（hash-class 站
// keyword 靠不上、原 inline-ad regex 要求後接 continue 類字樣不命中）。
//
// 修法（結構通則）：
// (1) hideBlurredPlaceholderTwins——img 帶 author-declared filter: blur() 且
//     近祖先（<= 4 hops）內有另一張非 blur img twin → placeholder、hide；
//     無 twin 的 blur 圖不動。twin 家族前例：bg-image 雙胞胎（v1.7.17）、
//     Readwise hero 去重（v0.8.125）。
// (2) hideInsideArticleFixedOverlays——主文內 computed position: fixed =
//     UI chrome（內容不會 fixed）；guard：含長段落不清（保險）、含 <video>
//     不清（NYT cinemagraph 家族 v1.0.3 走還原軌）。sticky 刻意不清。
// (3) NOISE_INLINE_AD_TEXT_RE 加 `^(advertisement|廣告|广告)$` alternative。
//
// 兩條新規則**不走 isInPreserved**：hero placeholder / CTA pill 都天生在
// <figure> 內（PRESERVE_SEL 含 figure）——preserve 擋掉規則永遠不命中。本
// fixture 特意把兩者放在 figure 內當 forcing（2026-07-30 harness 實證：無
// figure 的 fixture 對這條是假綠）。
//
// 驗收層次：本 spec 驗 jsdom clean() 行為（filter / position 走 inline style
// ——jsdom 不 resolve stylesheet）；真 Chrome stylesheet class 情境由 harness
// wirecutter 實測覆蓋（blur 可見大圖 0、pill 消失、Advertisement 清除、內容
// 無重複 probe 數值確認）。兩條規則驗靜態 clean，不驗動態 lazy-inject。
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

describe('cleaner — blur placeholder twin + 主文內 fixed CTA + Advertisement label（v1.7.24）', () => {
  let window, document, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'blur-placeholder-fixed-cta.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.chrome = window.chrome || { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
    window.eval(SRC.namespace);
    window.eval(SRC.detector);
    window.eval(SRC.cleaner);
    const result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中');
    hidden = window.__JRead.cleaner.clean(result.el, { promotedFrom: result.promotedFrom });
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('blur placeholder（figure 內、有非 blur twin）必須 hide', () => {
    const ph = document.getElementById('blur-ph');
    assert.ok(ph.closest('figure'), 'fixture forcing：placeholder 必須在 <figure> 內（PRESERVE 陷阱）');
    assert.strictEqual(ph.dataset.jreadHidden, '1',
      'blur placeholder 必須清；forcing：hideBlurredPlaceholderTwins 加回 isInPreserved 或移除規則 → fail');
  });

  it('真 hero（非 blur twin）必須保留', () => {
    const real = document.getElementById('real-hero');
    assert.notStrictEqual(real.dataset.jreadHidden, '1', '真圖不可被誤清');
  });

  it('無 twin 的 blur 頭像不可清（控制組）', () => {
    const lone = document.getElementById('lone-blur-avatar');
    assert.notStrictEqual(lone.dataset.jreadHidden, '1',
      '同容器無非 blur twin 的 blur 圖（裝飾頭像）不動——寧可少清不誤殺');
  });

  it('主文內 fixed CTA pill（figure 內）必須 hide', () => {
    const cta = document.getElementById('fixed-cta');
    assert.ok(cta.closest('figure'), 'fixture forcing：CTA 必須在 <figure> 內（PRESERVE 陷阱）');
    assert.strictEqual(cta.dataset.jreadHidden, '1',
      '主文內 fixed CTA 必須清；forcing：hideInsideArticleFixedOverlays 加回 isInPreserved 或移除規則 → fail');
  });

  it('fixed 容器含 <video> 不可 hide（cinemagraph 家族控制組）', () => {
    const wrap = document.getElementById('fixed-video-wrap');
    assert.notStrictEqual(wrap.dataset.jreadHidden, '1',
      'fixed 媒體層走還原軌（v1.0.3），hide 軌不可踩');
  });

  it('「Advertisement」純 label 必須 hide；提及 advertisement 的長段落保留', () => {
    assert.strictEqual(document.getElementById('slot-label').dataset.jreadHidden, '1',
      '整個元素文字＝單獨 Advertisement 的廣告位 label 必須清');
    assert.notStrictEqual(document.getElementById('mention-para').dataset.jreadHidden, '1',
      '內文長段落提到 advertisement 一詞不可誤清（regex 全等比對天然不命中）');
  });
});
