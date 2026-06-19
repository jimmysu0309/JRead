// JRead — regression spec: Readwise 匯出移除文首 byline / dateline meta（v0.8.121）
//
// Trigger: Jimmy 2026-06-19 autosport.com 回報——送到 Readwise Reader 的文章開頭
// 出現作者名 +「發表時間：18 Jun 2026, 22:39」+「Add as a preferred source」。
// Readwise Reader metadata 已記錄作者與發表日期，body 內重複留著 = 垃圾，請在送出
// 時隱藏。
//
// 根因：autosport（Motorsport CMS）的 author-toolbar（作者連結 + Published <time>
// + preferred-source CTA + 分享鈕）位於主文容器內、第一個內文 <p> 之前，buildCleanHtml
// 既有清理步驟不涵蓋它 → 帶進 Readwise outerHTML。
//
// 修法（NS.markLeadingBylineForExport，結構通則、非站點/class 特判）：以 <time>
// 為錨，標記「位於首個內文 <p> 之前、<time> 不在 prose 內、往上爬不含 heading /
// <p> / 內容圖的最高 meta 祖先」。buildCleanHtml clone 後移除標記節點、還原 live。
//
// 本 spec 驗 NS.markLeadingBylineForExport 的標記邏輯（jsdom）。真實 Chrome 端到端
// （Readwise outerHTML 不含 byline、閱讀模式仍顯示 byline）在 cage 驗過。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'readwise-leading-byline.html');

describe('readwise — 移除文首 byline / dateline meta（v0.8.121）', () => {
  let document, NS, marked;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: [], // 只需 namespace（helper 必載）
      pretendToBeVisual: true
    });
    document = env.document;
    NS = env.NS;
    assert.ok(NS && typeof NS.markLeadingBylineForExport === 'function',
      'NS.markLeadingBylineForExport 必須存在（namespace.js 單一資料源）');
    const article = document.getElementById('story');
    marked = NS.markLeadingBylineForExport(article);
  });

  it('(A) author-toolbar（作者 + Published time + preferred-source CTA）被標記移除', () => {
    const toolbar = document.getElementById('author-toolbar');
    assert.ok(toolbar.closest('[data-jread-rw-strip="1"]'),
      'author-toolbar 整塊（含作者 / 日期 / Add as a preferred source / 分享鈕）必須被標記');
    // 三項使用者點名的雜訊都落在被標記子樹內
    assert.ok(document.getElementById('author-link').closest('[data-jread-rw-strip="1"]'), '作者連結');
    assert.ok(document.getElementById('pub-time').closest('[data-jread-rw-strip="1"]'), 'Published 日期');
    const pref = [...document.querySelectorAll('span')].find(s => /preferred source/i.test(s.textContent));
    assert.ok(pref && pref.closest('[data-jread-rw-strip="1"]'), 'Add as a preferred source');
  });

  it('(B) h1 標題 / kicker / hero 圖不被標記（heading + content-img guard）', () => {
    assert.ok(!document.getElementById('title').closest('[data-jread-rw-strip="1"]'), 'h1 標題保留');
    assert.ok(!document.getElementById('kicker').closest('[data-jread-rw-strip="1"]'), 'kicker 分類保留');
    assert.ok(!document.getElementById('hero-fig').closest('[data-jread-rw-strip="1"]'), 'hero figure 保留');
    assert.ok(!document.getElementById('hero-img').closest('[data-jread-rw-strip="1"]'), 'hero img 保留');
  });

  it('(C) 內文 <p> 內的 prose <time> 不被標記', () => {
    assert.ok(!document.getElementById('prose-time').closest('[data-jread-rw-strip="1"]'),
      'prose 段落內的日期（<p> 內）不可被當 byline 移除');
    assert.ok(!document.getElementById('p1').closest('[data-jread-rw-strip="1"]'), 'p1 內文保留');
    assert.ok(!document.getElementById('p2').closest('[data-jread-rw-strip="1"]'), 'p2 內文保留');
  });

  it('(D) 標記只加在 author-toolbar 一層（不越界到整個 entity-header）', () => {
    assert.strictEqual(marked.length, 1, '只標記一個 meta 祖先');
    // 被標記者不得含 heading / p / 內容圖（純 meta）
    const top = marked[0];
    assert.strictEqual(top.querySelector('h1, h2, h3, h4, h5, h6, p'), null,
      '被標記的 meta 區塊不可含 heading / 段落');
  });

  it('(E) 無內文 <p> 的文章不標記任何 byline（避免誤殺整篇）', () => {
    const env2 = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: [], pretendToBeVisual: true });
    const d2 = env2.document;
    d2.querySelectorAll('#story p').forEach(p => p.remove());
    const m2 = env2.NS.markLeadingBylineForExport(d2.getElementById('story'));
    assert.strictEqual(m2.length, 0, '無 <p> 時不冒險移除任何區塊');
  });
});
