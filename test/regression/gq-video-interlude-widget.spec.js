// JRead — regression spec: video interlude widget removal (v0.7.145)
// -----------------------------------------------------------------------------
// Forcing function for cleaner rule `hideInsideArticleVideoInterludes`.
// Trigger: Jimmy 2026-05-20 回報 https://www.gq.com.tw/article/omega-swatch-moonwatch
// 「video 歪右邊」「類似廣告」。probe 確認是 Condé Nast CMS 的「WATCH」插播
// widget——figure 內含 heading + 外連標題 a + iframe video embed。
//
// 規則設計（結構通則，不綁站）：
//   figure 含 iframe/video + figure 含 a[href] textContent >= 20 chars
//   （排除 figcaption 內的 inline a）→ hide 整個 figure
//
// 本 spec 4 條 forcing function:
//   (a) fixture 結構數值驗證（資料完整、可重現）
//   (b) interlude widget figure 必須被 hide（核心保護點）
//   (c) 主文真實 figure（YouTube embed / figcaption inline link / 短 credit）
//       必須保留——確認 rule 不誤殺
//   (d) interlude widget 內的 iframe 也視為 hidden（父被 hide 帶走 sub-tree）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'gq-video-interlude-widget.html');

describe('cleaner — video interlude widget (GQ Taiwan / Condé Nast CMS, v0.7.145)', () => {
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

  // -------- (a) fixture 結構數值驗證 --------
  it('(a) fixture: interlude figure 結構符合最小重現條件', () => {
    const interlude = articleEl.querySelector('[data-test="interlude-figure"]');
    assert.ok(interlude, 'fixture 必須含 data-test="interlude-figure"');
    // 含 iframe
    const iframe = interlude.querySelector('iframe');
    assert.ok(iframe, 'interlude figure 必須含 iframe（媒體 embed 訊號）');
    // 含長文字 a[href]，非 figcaption 內
    const titleLink = interlude.querySelector('[data-test="interlude-title-link"]');
    assert.ok(titleLink, 'interlude figure 必須含 title link a');
    assert.strictEqual(titleLink.closest('figcaption'), null,
      'title link 必須在 figcaption 外（否則合法 caption inline link、不該命中規則）');
    const linkText = (titleLink.textContent || '').replace(/\s+/g, ' ').trim();
    assert.ok(linkText.length >= 20,
      `interlude title link text 必須 >= 20 chars，實際 ${linkText.length}`);
  });

  // -------- (b) interlude widget 必須被 hide（核心保護點）--------
  it('(b) interlude figure 必須被 cleaner hide（data-jread-hidden="1" + inline display:none）', () => {
    const interlude = articleEl.querySelector('[data-test="interlude-figure"]');
    assert.strictEqual(interlude.dataset.jreadHidden, '1',
      'interlude figure 必須被標記 data-jread-hidden="1"');
    assert.strictEqual(interlude.style.display, 'none',
      'interlude figure 必須 inline display:none');
  });

  // -------- (c) 主文真實 figure 必須保留 --------
  it('(c1) 主文真實 YouTube figure（無 a[href]）必須保留', () => {
    const fig = articleEl.querySelector('[data-test="legit-youtube-figure"]');
    assert.ok(fig);
    assert.notStrictEqual(fig.dataset.jreadHidden, '1',
      '主文 figure（含 YouTube iframe + figcaption 無 link）不可被誤 hide');
    assert.notStrictEqual(fig.style.display, 'none');
  });

  it('(c2) 主文真實 figure 含 figcaption 內 inline link（長 text）必須保留', () => {
    // 此 figure 的 a 在 figcaption 內，rule 應排除——figure 不該被 hide
    const fig = articleEl.querySelector('[data-test="legit-figcaption-link-figure"]');
    assert.ok(fig);
    assert.notStrictEqual(fig.dataset.jreadHidden, '1',
      '主文 figure 內 figcaption 含長文字 inline link 屬合法圖說，不可誤 hide');
    assert.notStrictEqual(fig.style.display, 'none');
  });

  it('(c3) 主文真實 figure 含短 source-credit a（< 20 chars）必須保留', () => {
    const fig = articleEl.querySelector('[data-test="legit-short-credit-figure"]');
    assert.ok(fig);
    assert.notStrictEqual(fig.dataset.jreadHidden, '1',
      '主文 figure 含「source: AP」這類短 credit a (< 20 chars) 不可誤 hide');
    assert.notStrictEqual(fig.style.display, 'none');
  });

  // -------- (d) 主文內文 p 保留（確認 rule 不波及主文）--------
  it('(d) 主文內文段落（body-p-1 ~ body-p-6）全部保留', () => {
    for (let i = 1; i <= 6; i++) {
      const p = articleEl.querySelector(`[data-test="body-p-${i}"]`);
      assert.ok(p, `主文 body-p-${i} 必須存在於 fixture`);
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 body-p-${i} 不可被 hide`);
    }
  });
});
