// JRead — regression spec:「繼續閱讀」inline embed 卡片清除 (v0.8.95)
// -----------------------------------------------------------------------------
// Forcing function：NOISE_HEADING_TEXT_RE 的 ^繼續閱讀[：:]?$ 條目 + heading
// walk-up 連坐 hide。
// Trigger: 2026-06-16 page rounds 驗收 https://www.gq.com.tw/article/經典調酒-highball
// 文中 + 文末插播大量「繼續閱讀：<相關文章>」embed 卡片殘留。rubric「繼續閱讀」
// 是 <div> 非 heading tag、class 全 styled-components hash（keyword 軌不可行），
// 只能靠 heading content 匹配。
//
// 規則設計（結構通則，不綁站）：
//   rubric direct text === 繼續閱讀（錨定 ^繼續閱讀[：:]?$）→ resolveHeadingNoiseTarget
//   walk-up 找「不含主文長 p / 標題 anchor」的最深 wrapper → 整張 embed 卡片 hide
//
// 本 spec 4 組 forcing function:
//   (a) fixture 結構數值驗證
//   (b) inline + tail embed 卡片必須被 hide（核心保護點）
//   (c) 主文段落 + 真實 section 副標題必須保留（不誤殺）
//   (d) 錨定有效：句中「繼續閱讀」不被誤判（單元驗 regex）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'gq-continue-reading-embed.html');

describe('cleaner —「繼續閱讀」inline embed 卡片 (GQ / Condé Nast, v0.8.95)', () => {
  let window, document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('article');
    assert.ok(articleEl, 'fixture 必須含 <article>');
    window.__JRead.cleaner.clean(articleEl);
  });

  const isHidden = (el) => el && el.dataset.jreadHidden === '1';

  // -------- (a) fixture 結構數值驗證 --------
  it('(a) fixture: embed 卡片 rubric direct text 為「繼續閱讀」、非 heading tag', () => {
    const inline = articleEl.querySelector('[data-test="inline-embed"]');
    assert.ok(inline, 'fixture 必須含 inline embed');
    const rubric = inline.querySelector('.ExternalLinkEmbedRubric-kzlWok');
    assert.ok(rubric, 'embed 必須含 rubric div');
    assert.strictEqual(rubric.tagName, 'DIV', 'rubric 必須是 <div>（非 heading tag）');
    const direct = Array.from(rubric.childNodes)
      .filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    assert.strictEqual(direct, '繼續閱讀', 'rubric direct text 必須為「繼續閱讀」');
  });

  // -------- (b) embed 卡片必須被 hide（核心保護點）--------
  it('(b1) inline embed 卡片（夾在段落間）必須被 hide', () => {
    const inline = articleEl.querySelector('[data-test="inline-embed"]');
    assert.ok(isHidden(inline), 'inline embed 卡片必須被標記 data-jread-hidden="1"');
    // 連坐：卡片內的相關文章標題連結也被帶走
    const title = articleEl.querySelector('[data-test="inline-embed-title"]');
    assert.ok(title.closest('[data-jread-hidden="1"]'), 'embed 內標題連結必須被祖先 hide 帶走');
  });

  it('(b2) 文末 recirc embed 卡片（tail-embed-1 / 2）必須被 hide', () => {
    for (const sel of ['tail-embed-1', 'tail-embed-2']) {
      const card = articleEl.querySelector(`[data-test="${sel}"]`);
      assert.ok(card.closest('[data-jread-hidden="1"]'),
        `${sel} 必須被 hide（自身或祖先 recirc 容器）`);
    }
  });

  // -------- (c) 主文必須保留（不誤殺）--------
  it('(c1) 主文段落 body-p-1 ~ body-p-3 全部保留', () => {
    for (let i = 1; i <= 3; i++) {
      const p = articleEl.querySelector(`[data-test="body-p-${i}"]`);
      assert.ok(p, `fixture 必須含 body-p-${i}`);
      assert.ok(!isHidden(p), `主文 body-p-${i} 不可被 hide`);
      assert.ok(!p.closest('[data-jread-hidden="1"]'), `主文 body-p-${i} 不可被祖先 hide 帶走`);
    }
  });

  it('(c2) 主文真實 section 副標題「4. 如何調製一杯 Highball」必須保留', () => {
    const h = articleEl.querySelector('[data-test="legit-heading"]');
    assert.ok(h);
    assert.ok(!isHidden(h), '真實 section 副標題不可被誤 hide');
    assert.ok(!h.closest('[data-jread-hidden="1"]'), '真實 section 副標題不可被祖先 hide 帶走');
  });

  // -------- (d) 錨定有效：句中「繼續閱讀」不被誤判 --------
  it('(d) ^繼續閱讀[：:]?$ 只命中 rubric、不命中句中「繼續閱讀」', () => {
    const re = /(^繼續閱讀[：:]?$)/;
    assert.ok(re.test('繼續閱讀'), '裸 rubric 必須命中');
    assert.ok(re.test('繼續閱讀：'), '帶冒號 rubric 必須命中');
    assert.ok(!re.test('請繼續閱讀本文了解更多'), '句中「繼續閱讀」不可命中');
    assert.ok(!re.test('我繼續閱讀了那本書'), '正文句中「繼續閱讀」不可命中');
  });
});
