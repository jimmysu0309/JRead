// JRead — regression spec: icon-only link hero image guard
// Forcing function: hideInsideArticleIconOnlyLinks 不可 hide 含大尺寸圖片
// （naturalWidth >= 200, naturalHeight >= 100）的 <a>——那是 hero / 插圖的
// 可點擊版，不是 icon button。
//
// Root cause: dev.to 的 hero image 結構是 <a class="cover"><img></a>，
// textContent 空、含 img → icon-only rule 命中 hide。修法在 icon-only rule
// 加 naturalWidth/naturalHeight guard。
//
// 同時驗證真正的 icon-only CTA（svg icon、無文字）仍然被 hide。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE = path.join(__dirname, 'fixtures', 'icon-only-hero-image-guard.html');

describe('icon-only hero image guard', () => {
  let doc, win, articleEl;

  before(async () => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE,
      scripts: ['detector', 'cleaner']
    });
    doc = env.document;
    win = env.window;

    // Stub naturalWidth/naturalHeight for the hero cover image
    const coverImg = doc.querySelector('img.cover-image');
    if (coverImg) {
      Object.defineProperty(coverImg, 'naturalWidth', { value: 1000 });
      Object.defineProperty(coverImg, 'naturalHeight', { value: 420 });
    }

    // Stub lazy-loaded hero image: naturalWidth=0 (not loaded yet),
    // but rendered size is large (from HTML width/height attributes).
    const lazyImg = doc.querySelector('img.lazy_imgs');
    if (lazyImg) {
      Object.defineProperty(lazyImg, 'naturalWidth', { value: 0 });
      Object.defineProperty(lazyImg, 'naturalHeight', { value: 0 });
      lazyImg.getBoundingClientRect = () => ({
        width: 800, height: 532, top: 0, left: 0, right: 800, bottom: 532
      });
    }

    articleEl = doc.querySelector('article');
    win.__JRead.cleaner.clean(articleEl);
  });

  it('hero cover link (<a> wrapping large <img>) is NOT hidden', () => {
    const coverLink = doc.querySelector('a.cover-link');
    assert.ok(coverLink, 'cover link exists');
    assert.notStrictEqual(coverLink.dataset.jreadHidden, '1',
      'hero cover link should not be marked jread-hidden');
  });

  it('hero cover image is visible', () => {
    const coverImg = doc.querySelector('img.cover-image');
    assert.ok(coverImg, 'cover image exists');
    const parent = coverImg.closest('[data-jread-hidden="1"]');
    assert.strictEqual(parent, null,
      'hero cover image should not have a hidden ancestor');
  });

  it('lazy-loaded hero image link (naturalWidth=0, rendered large) is NOT hidden', () => {
    const lazyLink = doc.querySelector('a.image-popup-vertical-fit');
    assert.ok(lazyLink, 'lazy hero link exists');
    let hidden = false;
    let cur = lazyLink;
    while (cur && cur !== doc.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { hidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(!hidden,
      'lazy-loaded hero image link should not be hidden — rendered size guard must catch it');
  });

  it('icon-only CTA link (svg, no text) IS hidden', () => {
    const shareBtn = doc.querySelector('a.share-btn');
    assert.ok(shareBtn, 'share btn exists');
    // Either the <a> itself or via js-link rule (href=javascript:)
    const isHidden = shareBtn.dataset.jreadHidden === '1' ||
      shareBtn.style.display === 'none';
    assert.ok(isHidden, 'icon-only CTA link should be hidden');
  });
});
