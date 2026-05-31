// JRead — regression spec: 巴哈姆特 photoswipe lazy 內容圖被誤砍（v0.7.212）
//
// Forcing function：lazy 內容圖在 cleaner 於 document_idle 跑時尚未載入
// （jsdom 裡 rect 0×0 + naturalWidth 0），舊規則把包圖的 <a> / wrapper <div>
// 當 icon-only CTA / 空殼砍掉 → reader mode 整片圖消失。
//
// Trigger：Jimmy 2026-05-31 cage 實測 forum.gamer.com.tw —— 34 張 photoswipe
// 內容圖被砍 31 張、只剩進閱讀模式前已載入的 3 張可見。
//
// 兩條修法 forcing：
//   (a) hideInsideArticleIconOnlyLinks：href 指向圖片檔（.JPG）的 <a> 不砍
//   (b) collapseEmptyWrappersAfterClean：img 帶真實 data-src（imgIsContentMedia）
//       的 wrapper 不 collapse

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'gamer-photoswipe-lazy-image.html');

describe('cleaner — 巴哈姆特 photoswipe lazy 內容圖保留（v0.7.212）', () => {
  let window, document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner']
    });
    window = env.window;
    document = env.document;
    const detected = window.__JRead.detector.detect();
    assert.ok(detected, 'detector 必須命中巴哈主文');
    articleEl = detected.el;
    window.__JRead.cleaner.clean(articleEl);
  });

  it('(a) photoswipe-image <a>（href=.JPG）不得被 icon-only 規則砍', () => {
    const links = [...articleEl.querySelectorAll('a.photoswipe-image')];
    assert.ok(links.length >= 3, '須有 >= 3 個 photoswipe-image 連結');
    for (const a of links) {
      assert.notStrictEqual(a.dataset.jreadHidden, '1',
        'href 指向圖片檔的 <a> 是內容圖檢視連結、非 icon CTA，不可砍——' +
        '否則 reader mode 下圖片整片消失');
    }
  });

  it('(b) 包 lazy 內容圖的 wrapper <div> 不得被 collapse 砍', () => {
    const wrappers = [...articleEl.querySelectorAll('div.post-image-wrap')];
    assert.ok(wrappers.length >= 3, '須有 >= 3 個 image wrapper');
    for (const d of wrappers) {
      assert.notStrictEqual(d.dataset.jreadHidden, '1',
        'wrapper 內含帶真實 data-src 的 lazy 內容圖，不可當空殼 collapse');
    }
  });

  it('(c) lazy 內容圖 <img> 本身不得被任何規則砍', () => {
    const imgs = [...articleEl.querySelectorAll('img.lazyload')];
    assert.ok(imgs.length >= 3);
    for (const img of imgs) {
      assert.notStrictEqual(img.dataset.jreadHidden, '1', 'lazy 內容圖不可被砍');
      // 祖先也不可被砍（否則 img 連帶不可見）
      let p = img.parentElement, hiddenAncestor = false;
      while (p && p !== articleEl) {
        if (p.dataset.jreadHidden === '1') { hiddenAncestor = true; break; }
        p = p.parentElement;
      }
      assert.ok(!hiddenAncestor, 'lazy 內容圖的祖先不可被砍（否則圖連帶不可見）');
    }
  });

  it('(d) 主文 <p> 保留', () => {
    const ps = [...articleEl.querySelectorAll('p')].filter(p => p.dataset.jreadHidden !== '1');
    assert.ok(ps.length >= 3, '主文段落必須保留');
  });
});
