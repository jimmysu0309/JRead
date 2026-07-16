// JRead — byline 偵測過度捕捉「無 heading header」→ hero img 被套 50% 圓角變橢圓（v1.7.9）
//
// Bug：read.readwise.io 文章視圖進 reader mode 後方形 hero image 變橢圓
// （Jimmy 2026-07-16 回報，The Atlantic Lizzo 文）。
//
// 根因（cage probe 實測）：Readwise Reader 把文件標題渲染在 article 容器外，
// article > header 內只有 dek → 作者 → hero figure（608×342）→ 圖說 → 日期 <time>，
// 沒有任何 h1/h2/h3。byline 的 author+date LCA seed engulf 整個 header（含 hero），
// v1.6.10 的 heading guard 不觸發（seed 內無 heading）、climb 的文字門檻也擋不住
// （header 全文 125 字 <= 200）→ header 被標 [data-jread-byline]，頭像規則
// [data-jread-byline] img { border-radius:50% } 套上矩形 hero → 橢圓。
//
// 修法（v1.7.9、結構性通則）：byline meta 區塊結構上絕不含內容尺寸大圖
// （img/picture rect >= 150px，bhasBigImg）。兩層各自加 guard、缺一不可：
//   ① seed guard：LCA seed 含大圖 → 退回 dateEl（只修 climb 擋不住 LCA 直接成 root）
//   ② climb guard：爬進含大圖的 parent → 停住（只修 seed，climb 仍會爬回 header）
//
// 本 spec 驗結構標記（jsdom 不 render border-radius，橢圓→方形視覺由 harness 驗）。
// jsdom rect 全 0，hero img 用 stubRect stub 成 608×342 才會觸發大圖判定。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'readwise-headerless-title-hero-byline.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function apply() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  // jsdom rect 全 0：hero img stub 成真實站量到的 608×342，讓 bhasBigImg 命中
  const hero = env.document.querySelector('[data-test="hero-img"]');
  stubRect(hero, { top: 300, left: 490, width: 608, height: 342 });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  env.NS.styler.apply(detected.el, DEFAULT_SETTINGS);
  return env;
}

describe('styler — byline 過度捕捉無 heading header（v1.7.9 Readwise Reader hero 橢圓）', () => {
  it('含內容大圖（無 h1）的 header 不得被標 [data-jread-byline]', () => {
    const env = apply();
    const header = env.document.querySelector('article > header');
    assert.ok(header, 'fixture 必須有 article > header');
    assert.strictEqual(header.querySelector('h1, h2, h3'), null,
      '前置：header 內不得有 heading（Reader 標題在 article 外，heading guard 不觸發才是本 bug）');
    assert.strictEqual(header.getAttribute('data-jread-byline'), null,
      '含 hero 大圖的 header 不得被當 byline root（否則 hero img 被套 50% 頭像圓角）');
  });

  it('hero img 不得有 [data-jread-byline] 祖先（不被頭像圓角規則命中）', () => {
    const env = apply();
    const hero = env.document.querySelector('[data-test="hero-img"]');
    assert.ok(hero, 'fixture 必須有 hero img');
    assert.strictEqual(hero.closest('[data-jread-byline]'), null,
      'hero img 不得落在 byline 子樹（[data-jread-byline] img 會套 border-radius:50%）');
  });

  it('byline 偵測仍運作：日期 <time> 落在 byline 子樹、root 不含 hero', () => {
    const env = apply();
    const date = env.document.querySelector('[data-test="date"]');
    const root = date.closest('[data-jread-byline]');
    assert.ok(root,
      '日期仍應被 byline 偵測涵蓋（seed 退回 dateEl、root 罩住日期而非整個 header）');
    assert.strictEqual(root.querySelector('[data-test="hero-img"]'), null,
      'byline root 不得含 hero img');
  });
});
