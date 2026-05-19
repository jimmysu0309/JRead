// JRead — resetMediaPlaceholderPadding visited WeakSet 修正（v0.7.143）
//
// Bug：cleaner resetMediaPlaceholderPadding 對每個 img/picture/video 跑迴圈，
// 用 visited WeakSet 防共享 parent 重複處理。原 code：
//   for (media of ...) {
//     if (visited.has(parent)) continue;
//     visited.add(parent);           // <- 過早 mark
//     if (mediaCs.position !== 'absolute') continue;
//     ...
//   }
// 第一個 media 不是 absolute（continue 前 visited 已 mark parent），
// 第二個共享 parent 的 absolute media 被 visited.has skip，padding-bottom hack
// reset 漏跑、主圖下方留白。
//
// 典型踩雷結構：lazy-load wrapper 含兩個 <img>——placeholder（非 absolute）+
// real（absolute）共享 picture parent。
//
// 修法：visited.add(parent) 移到 absolute check 通過後才執行。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'picture-shared-parent.html');

describe('cleaner resetMediaPlaceholderPadding — 共享 parent 不可漏 reset（v0.7.143）', () => {
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
  });

  it('fixture 結構：picture 含 2 個 img（placeholder + real）', () => {
    const picture = articleEl.querySelector('[data-test="shared-picture"]');
    assert.ok(picture, 'fixture 必須有 data-test="shared-picture"');
    const imgs = picture.querySelectorAll('img');
    assert.strictEqual(imgs.length, 2,
      `picture 必須含 2 個 img（placeholder + real），實際 ${imgs.length}`);
    // placeholder 是 static
    assert.strictEqual(imgs[0].style.position, 'static',
      'placeholder 必須是 position: static');
    // real 是 absolute
    assert.strictEqual(imgs[1].style.position, 'absolute',
      'real img 必須是 position: absolute');
  });

  it('fixture 原始 padding-bottom 是 56.25%（16:9 aspect hack）', () => {
    const picture = articleEl.querySelector('[data-test="shared-picture"]');
    assert.ok(/56\.25%/.test(picture.style.paddingBottom),
      'picture 原始 padding-bottom 必須是 56.25%（aspect hack 必要條件）');
  });

  it('cleaner.clean 跑完後 padding-bottom hack 必須被 reset（forcing function）', () => {
    window.__JRead.cleaner.clean(articleEl);
    const picture = articleEl.querySelector('[data-test="shared-picture"]');
    // resetMediaPlaceholderPadding 走 inline style.setProperty('padding-bottom', '0')
    // 或透過 hidden array 走整套還原機制。實際 cleaner 用 applyImportant 直接 set。
    // 驗證：跑完後 inline padding-bottom 應為 '0' 或空，不可仍是 '56.25%'
    const finalPb = picture.style.paddingBottom;
    assert.notStrictEqual(finalPb, '56.25%',
      `cleaner 跑完後 padding-bottom 不可仍是 56.25% hack（visited WeakSet 過早 mark 會讓共享 parent 漏 reset）。實際 ${finalPb}`);
  });

  it('主文 p 段落不可被誤殺（修法不破壞既有行為）', () => {
    const ps = articleEl.querySelectorAll('[data-test^="body-p-"]');
    assert.ok(ps.length >= 2);
    for (const p of ps) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 ${p.dataset.test} 不可被 hide`);
    }
  });
});
