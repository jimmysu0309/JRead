// JRead — regression spec: 品牌 placeholder lazy 圖 hydration (v0.8.46 tvbs)
// -----------------------------------------------------------------------------
// Jimmy 2026-06-11 cage 回報 tvbs 主圖空白。根因：站點 lazy library
// （img.lazyimage）的 src 停在「真實 URL 的品牌 placeholder 圖」（2017 年
// 灰底品牌圖、檔名是日期 hash），真圖在 data-src——hydrateLazyImages 的
// 前兩類「未 hydrate」判定（LAZY_PLACEHOLDER_RE 的 data: URI / 空 src、
// SPACER_SRC_RE 的 spacer 慣用檔名）全 miss，reader mode 下 lazy library
// 不觸發、真圖永遠補不上。
//
// v0.8.46 第三類判定（結構雙條件，不綁站點）：class 含 lazy 慣用 token
// （lazyload / lazyimage / lazysizes / b-lazy 等 library 跨站慣例）+ 帶
// 指向不同真 URL 的 LAZY_SRC_ATTRS。此路徑不走 srcset fallback——已正常
// 顯示的響應式圖（class lazyloaded、srcset 變體與 src 不同是常態）不可
// 誤改寫。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'branded-lazy-placeholder.html');

describe('cleaner — 品牌 placeholder lazy 圖 hydration（v0.8.46）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.getElementById('post');
    articleEl.setAttribute('data-jread-active', '1');
    env.NS.cleaner.clean(articleEl, []);
  });

  it('lazy class + data-src 的品牌 placeholder 必須被換成真圖', () => {
    const img = document.getElementById('branded-lazy');
    assert.ok(img, 'fixture 應有 branded-lazy img');
    assert.strictEqual(img.getAttribute('src'),
      'https://cc.example.com/img/upload/2026/05/26/20260526121254-72ab98b6.jpg',
      'src 必須被 hydrate 成 data-src 的真圖（品牌 placeholder 檔名無 spacer 慣用語、前兩類判定接不住）');
  });

  it('已 hydrate 的響應式圖（lazyloaded + srcset 變體）不可被誤改寫', () => {
    const img = document.getElementById('already-hydrated');
    assert.ok(img, 'fixture 應有 already-hydrated img');
    assert.strictEqual(img.getAttribute('src'),
      'https://cdn.example.com/dynamic/image/width=1000/photo.png',
      'lazy class 路徑不走 srcset fallback——正常顯示的圖不可被換成其他變體');
  });
});
