// JRead — regression spec: dev.to 文章 header（含 cover + h1）不被作者 bio 卡規則誤殺（v0.8.79）
// -----------------------------------------------------------------------------
// Trigger: Page Rounds 2026-06-15 第六輪 — dev.to 文章封面大圖未進 reader card。
// probe 確認（修正了報告原本「cover 在 body anchor 外被 detector 排除」的猜測）：
// cover 其實在 reader root 內，但 cover + h1 標題 + 作者頭像列全裝在
// <header class="crayons-article__header">，hideInsideArticleAuthorBioCards 從頭像往上
// walk 吞到整個 header → 連 cover 一起當 bio 卡 hide（標題靠 title-clone 仍顯示，
// 所以表面只少了 cover）。既有 big-img break guard 因 cover rect 在 clean-time 時序
// 未必 > 門檻（avatar*1.5=120px）而失靈。
//
// 修法（v0.8.79）：walk-up 遇到「含 <h1>」的容器即 break——author bio 卡結構上絕不會
// 包文章主標題 <h1>，h1 訊號不受 rect 時序影響、是 bio 卡 vs 文章 header 的可靠結構區分。
//
// 本 spec forcing 的是「header + 標題不被 bio 卡規則吞掉」（rect-independent，jsdom
// 可重現）：拿掉 h1 break guard → #article-header 被 hide、#title 落入 hidden 子樹（實證）。
// cover <img> 本身在 jsdom rect=0 下會被 icon-link 規則另外處理（jsdom-only 假象，真實
// Chrome cover 有 rect 正常顯示——已由 page-rounds harness 截圖驗證），故此處不對 cover
// 自身斷言、只 forcing header/標題的結構保留。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE = path.join(__dirname, 'fixtures', 'devto-article-header-h1-guard.html');

describe('cleaner — dev.to 文章 header（含 cover + h1）不被 bio 卡規則誤殺（v0.8.79）', () => {
  let document;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true,
      url: 'https://dev.to/someauthor/2026-web-dev-trends-5520'
    });
    document = env.document;
    // 幾何 stub：頭像 rendered 24×24（avatar 量級，bio 卡規則錨點）。
    // cover rect 故意留 0（jsdom 預設）——複製 clean-time race，big-img break guard
    // 失靈，這正是 bug 觸發條件。
    stubRect(document.getElementById('avatar'), { top: 200, left: 10, width: 24, height: 24 });
    const r = env.window.__JRead.detector.detect();
    assert.ok(r, 'detector 應命中');
    env.window.__JRead.cleaner.clean(r.el, { promotedFrom: r.promotedFrom });
  });

  it('forcing: 頭像為 avatar 量級（< 80 近方形）且文章 header 含 <h1>', () => {
    const avatarRect = document.getElementById('avatar').getBoundingClientRect();
    assert.ok(avatarRect.width <= 80 && avatarRect.height <= 80,
      'fixture forcing: 頭像須 <= 80（avatar 量級）才會被 bio 卡規則錨定');
    assert.ok(document.getElementById('article-header').querySelector('h1'),
      'fixture forcing: header 須含 <h1>（才 forcing h1 break guard）');
  });

  it('文章 header 不被 bio 卡規則整塊 hide', () => {
    const header = document.getElementById('article-header');
    assert.notStrictEqual(header.dataset.jreadHidden, '1',
      'cover + h1 所在的文章 header 不可被作者 bio 卡規則整塊清掉；' +
      '拿掉 hideInsideArticleAuthorBioCards 的「含 <h1> 即 break」guard → 此 assertion fail');
  });

  it('標題不落入 hidden 子樹（cover 隨 header 一起保留）', () => {
    const title = document.getElementById('title');
    assert.notStrictEqual(title.dataset.jreadHidden, '1');
    assert.ok(!title.closest('[data-jread-hidden="1"]'),
      '標題不可在 hidden 子樹內——header 被吞時標題會連帶落入 hidden 樹');
  });

  it('主文段落保留（sanity）', () => {
    assert.notStrictEqual(document.getElementById('content-p1').dataset.jreadHidden, '1');
  });
});
