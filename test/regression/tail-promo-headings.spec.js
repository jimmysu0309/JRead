// JRead — regression spec: 文末推廣區 heading 清除 (v0.8.45 page rounds C2)
// -----------------------------------------------------------------------------
// 2026-06-11 page rounds 第四輪 C2 文末殘留 4 站的最小重現：
//   bbc culture「More like this:」——heading 帶尾隨冒號，NOISE_HEADING_TEXT_RE
//     的 `^more\s+like\s+this(\s+\S+){0,3}$` 錨定 `$` 被冒號擋掉
//   github.blog「Explore more from GitHub」——24 chars 超過 base max_len 20，
//     且 `^more` 錨定不容忍前綴動詞
//   theverge「Follow topics and authors」——STRONG 包裝的 follow CTA
//   slate「Sign up for Executive Dysfunction」——newsletter headline 濫用
//     <h1>，keywordWrapperIsProtected 的「含 h1 一律保留」guard 被騙過
//
// 修法三件組：
//   1. normHeading（heading 比對前剝尾隨標點）
//   2. NOISE_HEADING_TEXT_EXT_RE 加 ^explore\s+more / ^sign\s+up\s+for /
//      ^follow\s+topics
//   3. H1 guard 限縮為 wrapperH1IsMainTitle（canonical title 比對 or
//      文件第一個 h1）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'tail-promo-headings.html');

describe('cleaner — 文末推廣區 heading 清除（v0.8.45）', () => {
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

  function isHidden(el) {
    return !!(el && el.closest('[data-jread-hidden="1"]'));
  }

  it('「More like this:」（尾隨冒號）必須被 hide', () => {
    const h = document.querySelector('h2.noise-more-like');
    assert.ok(h, 'fixture 應有 noise-more-like H2');
    assert.ok(isHidden(h), '尾隨冒號不可讓 ^...$ 錨定 pattern miss（normHeading 剝尾標點）');
  });

  it('「Explore more from GitHub」推薦區必須被 hide', () => {
    const h = document.querySelector('h2.noise-explore');
    assert.ok(h, 'fixture 應有 noise-explore H2');
    assert.ok(isHidden(h), 'EXT regex ^explore\\s+more 必須命中（24 chars 走 EXT max_len 40）');
  });

  it('「Follow topics and authors」CTA（STRONG 包裝）必須被 hide', () => {
    const s = document.querySelector('strong.noise-follow-topics');
    assert.ok(s, 'fixture 應有 noise-follow-topics STRONG');
    assert.ok(isHidden(s), 'EXT regex ^follow\\s+topics 必須命中 STRONG direct text');
  });

  it('newsletter signup 區（h1 headline）必須被 hide——h1 guard 不可被濫用 h1 騙過', () => {
    const sec = document.querySelector('section.newsletter-signup');
    assert.ok(sec, 'fixture 應有 newsletter-signup SECTION');
    assert.ok(isHidden(sec),
      'newsletter[\\w-]* keyword 命中後，非主標的 h1（文字 ≠ canonical title 且非文件第一個 h1）不享 wrapper 保護');
  });

  it('「Subscribe to X」/「Sign Up Now」訂閱連結必須被 hide（cnbc footer 推廣）', () => {
    const a1 = document.querySelector('a.noise-subscribe-to');
    const a2 = document.querySelector('a.noise-signup-now');
    assert.ok(a1 && a2, 'fixture 應有兩個訂閱推廣連結');
    assert.ok(isHidden(a1), '「Subscribe to ...」CTA 連結必須被 link 規則清除');
    assert.ok(isHidden(a2), '「Sign Up Now」CTA 連結必須被 link 規則清除');
  });

  it('真主標 h1（= canonical title）所在 header 不可被誤殺', () => {
    const header = document.querySelector('header.article-header');
    assert.ok(header, 'fixture 應有 article-header');
    assert.ok(!isHidden(header.querySelector('h1')),
      '主標 h1 必須保留（wrapperH1IsMainTitle 的 canonical / 第一個 h1 判定）');
  });

  it('主文段落必須完整保留', () => {
    let visible = 0;
    for (const p of articleEl.querySelectorAll('p')) {
      if (p.closest('section.newsletter-signup')) continue;
      if (p.textContent.replace(/\s+/g, '').length >= 50 && !isHidden(p)) visible++;
    }
    assert.ok(visible >= 2, `主文長段落必須保留（visible=${visible}）`);
  });
});
