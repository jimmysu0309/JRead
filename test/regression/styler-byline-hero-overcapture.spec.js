// JRead — byline 偵測過度捕捉 header → hero img 被套 50% 圓角變橢圓（v1.6.10）
//
// Bug：theatlantic.com 文章 hero image 進 reader mode 變橢圓 / 圓框、應為方形
// （Jimmy 2026-07-02 回報）。
//
// 根因（probe 實測、非站方 border-radius）：站方 <header class="ArticleHero_root">
// 依序含 h1 標題 → 作者「By …」→ hero figure → 日期 <time>。byline 偵測以
// author + date 的 LCA 當 seed，作者在 hero 上方、日期在 hero 下方 → LCA engulf 整個
// header（含 h1 + hero）。climb 的 heading guard 只擋「往上爬進含 heading 的 parent」、
// 擋不住 seed 自身已含 heading → root = header 被標 [data-jread-byline]，JRead 自己的
// byline 頭像規則 [data-jread-byline] img { border-radius:50% } 於是套上 hero img
// （矩形）→ render 成橢圓框。
//
// 修法：LCA seed 自身含 h1/h2/h3 → 退回只用 dateEl 當 seed，climb 在 header 邊界前
// 停住，root 落純日期 wrapper、不罩 h1 與 hero。
//
// 本 spec 驗結構標記（jsdom 不 render border-radius，圓框→方形視覺由 harness 驗）：
// 含 h1 的 header 不被標 byline、hero img 無 byline 祖先。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'atlantic-hero-byline-overcapture.html');

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
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  env.NS.styler.apply(detected.el, DEFAULT_SETTINGS);
  return env;
}

describe('styler — byline 過度捕捉 header（v1.6.10 Atlantic hero 圓框）', () => {
  it('含 h1 標題的 ArticleHero header 不得被標 [data-jread-byline]', () => {
    const env = apply();
    const header = env.document.querySelector('header.ArticleHero_root');
    assert.ok(header, 'fixture 必須有 ArticleHero header');
    assert.ok(header.querySelector('h1'), '前置：header 內含 h1 標題');
    assert.strictEqual(header.getAttribute('data-jread-byline'), null,
      '含標題的 header 不得被當 byline root（否則其內 hero img 被套 50% 頭像圓角）');
  });

  it('hero img 不得有 [data-jread-byline] 祖先（不被頭像圓角規則命中）', () => {
    const env = apply();
    const hero = env.document.querySelector('[data-test="hero-img"]');
    assert.ok(hero, 'fixture 必須有 hero img');
    assert.strictEqual(hero.closest('[data-jread-byline]'), null,
      'hero img 不得落在 byline 子樹（[data-jread-byline] img 會套 border-radius:50%）');
  });

  it('byline 偵測仍運作：日期 <time> 落在 byline 子樹（root 退回日期 wrapper）', () => {
    const env = apply();
    const date = env.document.querySelector('[data-test="date"]');
    assert.ok(date.closest('[data-jread-byline]'),
      '日期仍應被 byline 偵測涵蓋（seed 退回 dateEl、root 罩住日期而非整個 header）');
  });
});
