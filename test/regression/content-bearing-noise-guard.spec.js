// JRead — content-bearing noise 家族 guard（v0.8.48，page rounds 第五輪
// dev.to C3 + propublica C2）
//
// 對應 bug：留言區（dev.to SECTION#comments）與促捐 promo letter（propublica
// .wp-block-*-promo-letter）class 都命中 noise keyword，但區塊自身帶長 p
// （留言內容 / 促捐文案）→ wrapperContainsMainContentP guard 誤豁免 → 殘留。
//
// 修法：CONTENT_BEARING_NOISE_RE 家族（comment / promo / donation 系 token）
// 命中且區塊文字 < article 50% 時，不享長 p 保護。
// 控制組：家族 token 命中但佔比 >= 50%（wrapper 真包主文）仍受保護。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'content-bearing-noise.html');

function loadEnv() {
  return loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1280, height: 900 },
    pretendToBeVisual: true
  });
}

describe('cleaner — content-bearing noise 家族 guard（v0.8.48）', () => {
  describe('雜訊側：佔比 < 50% 的留言區 / promo letter 被 hide', () => {
    let document;

    before(() => {
      const env = loadEnv();
      document = env.document;
      const articleEl = document.querySelector('article#story');
      assert.ok(articleEl);
      env.window.__JRead.cleaner.clean(articleEl);
    });

    it('留言區 section#comments（長 p 留言）被 hide', () => {
      const comments = document.querySelector('#comments');
      assert.ok(comments);
      assert.strictEqual(comments.dataset.jreadHidden, '1',
        'comments token + 佔比 < 50% 不可再被長 p guard 豁免');
    });

    it('促捐 promo letter（長 p 文案）被 hide', () => {
      const promo = document.querySelector('#promo-letter');
      assert.ok(promo);
      assert.strictEqual(promo.dataset.jreadHidden, '1',
        'promo token + 佔比 < 50% 不可再被長 p guard 豁免');
    });

    it('主文 p 全保留', () => {
      for (const p of document.querySelectorAll('article#story > p')) {
        assert.notStrictEqual(p.dataset.jreadHidden, '1',
          `主文 p 不可被 hide: "${p.textContent.slice(0, 30)}…"`);
      }
    });
  });

  describe('v1.7.19：主文先行訊號——佔比 >= 50% 的文末留言區仍要 hide', () => {
    // archive.ph WSJ 存檔頁 + Shinkansen 翻譯實測：重留言頁（727 則）留言字數
    // 佔比 0.51 壓過 0.5 門檻 → 舊佔比 guard 失效、長 p 保護復活 → 留言區整包
    // 殘留。修法：主文內容（含裸 div direct text）在 wrapper 之前已開始 →
    // strip 長 p 保護。本 fixture 主文是裸 div 段落（archive.today 改寫頁特
    // 徵），留言佔比 0.604。
    let document;

    before(() => {
      const env = loadEnv();
      document = env.document;
      const articleEl = document.querySelector('#story3-root');
      assert.ok(articleEl);
      env.window.__JRead.cleaner.clean(articleEl);
    });

    it('佔比 >= 50% 的留言區（前方已有主文裸 div 段落）被 hide', () => {
      const comments = document.querySelector('#comments-block');
      assert.ok(comments);
      assert.strictEqual(comments.dataset.jreadHidden, '1',
        '主文在留言區之前已開始 → 不得再被長 p guard / 佔比 guard 豁免');
    });

    it('主文裸 div 段落全保留', () => {
      const root = document.querySelector('#story3-root');
      for (const div of root.children) {
        if (div.id === 'comments-block') continue;
        assert.notStrictEqual(div.dataset.jreadHidden, '1',
          `主文裸 div 不可被 hide: "${div.textContent.slice(0, 20)}…"`);
      }
    });
  });

  describe('保護側：家族 token 但佔比 >= 50%（wrapper 真包主文）仍受保護', () => {
    it('article-with-comments-wrapper 不被 hide', () => {
      const env = loadEnv();
      const document = env.document;
      const articleEl = document.querySelector('#story2-root');
      assert.ok(articleEl);
      env.window.__JRead.cleaner.clean(articleEl);
      const wrapper = document.querySelector('#protected-wrapper');
      assert.ok(wrapper);
      assert.notStrictEqual(wrapper.dataset.jreadHidden, '1',
        '包住主文多數內容的 wrapper 必須仍受長 p guard 保護');
    });
  });
});
