// JRead — RSS reader 送 Readwise / Instapaper 用文章原始 URL regression（v1.6.19）
//
// 對應功能：在 RSS reader（Miniflux / FreshRSS 等自架閱讀器）內對某篇文章開閱讀
// 模式、送 Readwise / Instapaper 儲存時，URL 應用文章的原始位置，而非 RSS reader
// 自己的 URL（如 https://miniflux.example/unread/entry/123，點回連的是 reader 不是
// 原文出處）。
//
// 結構訊號（非站點 / class 特判）：RSS reader 一律把「文章主標」渲染成一個指向原文
// 的外連 <a>，且該連結必然**跨網域**（指向文章原始站，與 reader 自身 origin 不同）。
// 一般文章頁主標是純文字、或就算含連結也是**同 origin** 自連結，被 cross-origin
// gate 濾掉 → 不誤觸。單一資料源 NS.findOriginalArticleUrl，main.js extractReaderPayload
// 呼叫，Readwise + Instapaper 共用產出的 payload.url。
//
// 本 spec 是 forcing function：
//   - Miniflux 版面（主標 h1 在 articleEl 外的 header）→ 回傳跨網域原文 URL
//   - 純文字主標（無連結）→ null（退回 location.href）
//   - 同 origin 自連結主標（self-link permalink）→ null
//   - 主標只夾一小段外連（anchor 涵蓋 < 60% 標題）→ null
//   - 目前頁面非 http(s)（擴充自有頁）→ null

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'rss-reader-original-url.html');
const READER_URL = 'https://miniflux.example.com/unread/entry/123';
const ORIGINAL_URL = 'https://asymco.com/2026/06/18/the-range-of-options/';

function fresh() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: [],
    url: READER_URL
  });
  return env;
}

describe('RSS reader 送出儲存用文章原始 URL — NS.findOriginalArticleUrl（v1.6.19）', () => {
  it('Miniflux 版面（主標 h1 在 articleEl 外的 header）回傳跨網域原文 URL', () => {
    const { document, NS } = fresh();
    const articleEl = document.querySelector('article.entry-content');
    const url = NS.findOriginalArticleUrl(articleEl, READER_URL);
    assert.strictEqual(url, ORIGINAL_URL);
  });

  it('主標 h1 在 articleEl 內（promote 進 card 的 title clone）也命中', () => {
    const { document, NS } = fresh();
    // 模擬 promote 後 card 內含帶原連結的 h1 clone
    const card = document.createElement('div');
    card.innerHTML = '<h1><a href="' + ORIGINAL_URL + '">選項已所剩無幾，Apple 何時會調漲價格</a></h1>';
    const url = NS.findOriginalArticleUrl(card, READER_URL);
    assert.strictEqual(url, ORIGINAL_URL);
  });

  it('純文字主標（無連結）→ null（退回 location.href）', () => {
    const { document, NS } = fresh();
    const h1 = document.getElementById('page-header-title');
    h1.textContent = '選項已所剩無幾，Apple 何時會調漲價格'; // 拔掉 anchor
    const articleEl = document.querySelector('article.entry-content');
    const url = NS.findOriginalArticleUrl(articleEl, READER_URL);
    assert.strictEqual(url, null);
  });

  it('同 origin 自連結主標（self-link permalink）→ null', () => {
    const { document, NS } = fresh();
    const a = document.querySelector('#page-header-title a');
    a.setAttribute('href', READER_URL + '#top'); // 同 origin
    const articleEl = document.querySelector('article.entry-content');
    const url = NS.findOriginalArticleUrl(articleEl, READER_URL);
    assert.strictEqual(url, null);
  });

  it('主標只夾一小段外連（anchor 涵蓋 < 60% 標題）→ null', () => {
    const { document, NS } = fresh();
    const h1 = document.getElementById('page-header-title');
    h1.innerHTML = '選項已所剩無幾，Apple 何時會調漲價格，詳見 <a href="' + ORIGINAL_URL + '">來源</a>';
    const articleEl = document.querySelector('article.entry-content');
    const url = NS.findOriginalArticleUrl(articleEl, READER_URL);
    assert.strictEqual(url, null);
  });

  it('目前頁面非 http(s)（擴充自有頁）→ null', () => {
    const { document, NS } = fresh();
    const articleEl = document.querySelector('article.entry-content');
    const url = NS.findOriginalArticleUrl(articleEl, 'safari-web-extension://abc-uuid/reader/reader.html');
    assert.strictEqual(url, null);
  });
});
