// JRead — regression spec: 主文內 JS 影片播放器函式庫 widget 清除（v0.8.140）
// -----------------------------------------------------------------------------
// Forcing function for cleaner rule `hideInsideArticleVideoPlayerWidgets`
// （靜態）+ checkDynamicNoise 的 `.jwplayer` 動態接（iOS 晚 init）。
//
// Trigger: Jimmy 2026-06-20 回報 inc.com Domino's 文章 iPhone 進閱讀模式往下捲
// 「影片干擾元素」。cage 真 Chrome probe + iPhone 截圖確認是 inc.com 在主文段落
// 間注入的影片 widget——JWPlayer JS 播放器（內容是無關的「Patty Arvielo on
// Hiring」推薦影片），iPhone 上影片載入後標題 + 畫面疊在內文段落上。
//
// 為何漏網：cage 桌面版靠 hideInsideArticleByHeadingText 命中「Featured Video」
// 標籤清掉，但該標籤 + `.jwplayer` class 是 JWPlayer JS 初始化才加上——iOS 上
// 初始化在 cleaner 之後，clean() 當下 wrapper 空殼、文字 / keyword 軌全認不出。
//
// 規則設計（結構通則，不綁站，硬規則 3）：anchor 在 .jwplayer（函式庫 root class、
// 跨站通用簽章）→ ratio walk-up 找「父層文字未暴增」的最外層 wrapper（碰到 article
// body 段落即停）→ hide。靜態 clean() + 動態 observer 兩 path 共用 hideVideoPlayerWidgetFrom。
//
// ★ 本 fixture 刻意「不放」「Featured Video」標籤文字 → 唯一能 hide 這個 wrapper
//   的就是結構 .jwplayer 軌，破壞它即 fail（純 forcing function、無 heading 軌偽綠）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'inc-featured-video-jwplayer-widget.html');

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1000, height: 800 },
    pretendToBeVisual: true
  });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 必須含 <article>');
  return { env, articleEl };
}

describe('cleaner — JS 影片播放器函式庫 widget（inc.com Featured Video / JWPlayer, v0.8.140）', () => {
  describe('靜態 clean()（.jwplayer 在 clean 時已存在）', () => {
    let articleEl;
    before(() => {
      const s = setup();
      articleEl = s.articleEl;
      s.env.window.__JRead.cleaner.clean(articleEl);
    });

    it('(a) fixture: widget 含 .jwplayer、無「Featured Video」標籤、標題為純 <p>', () => {
      const fv = articleEl.querySelector('[data-test="featured-video"]');
      assert.ok(fv, 'fixture 必須含影片 widget');
      assert.ok(fv.querySelector('[data-test="jwplayer-root"]').classList.contains('jwplayer'),
        'widget 內必須含 .jwplayer root（anchor 訊號）');
      assert.ok(!/Featured Video/i.test(fv.textContent || ''),
        'fixture 不可含「Featured Video」標籤（否則 heading 軌偽綠、無法 forcing 結構軌）');
      const title = articleEl.querySelector('[data-test="featured-video-title"]');
      assert.strictEqual(title.querySelector('a'), null,
        '影片標題 <p> 內不可有 <a>（確認 interlude link 軌命中不了）');
    });

    it('(b) featuredVideo wrapper 必須被 hide（data-jread-hidden="1" + inline display:none）', () => {
      const fv = articleEl.querySelector('[data-test="featured-video"]');
      assert.strictEqual(fv.dataset.jreadHidden, '1', 'wrapper 必須標記 data-jread-hidden="1"');
      assert.strictEqual(fv.style.display, 'none', 'wrapper 必須 inline display:none');
    });

    it('(b2) widget 內的 .jwplayer 隨父被帶走（在 hidden 子樹內）', () => {
      const jw = articleEl.querySelector('[data-test="jwplayer-root"]');
      assert.ok(jw.closest('[data-jread-hidden="1"]'), '.jwplayer 必須落在被 hide 的 wrapper 子樹內');
    });

    it('(c) 主文內普通 <figure><video>（無 .jwplayer）必須保留', () => {
      const fig = articleEl.querySelector('[data-test="legit-editorial-figure"]');
      assert.notStrictEqual(fig.dataset.jreadHidden, '1',
        '編輯性影片 figure（無函式庫 root class）不可被誤 hide');
      assert.notStrictEqual(fig.style.display, 'none');
    });

    it('(d) content-chunk 主文段落（body-p-1~4）全部保留', () => {
      for (let i = 1; i <= 4; i++) {
        const p = articleEl.querySelector(`[data-test="body-p-${i}"]`);
        assert.ok(p, `主文 body-p-${i} 必須存在`);
        assert.notStrictEqual(p.dataset.jreadHidden, '1', `主文 body-p-${i} 不可被 hide`);
        assert.ok(!p.closest('[data-jread-hidden="1"]'),
          `主文 body-p-${i} 不可落在被 hide 的子樹內（walk-up 不可吞 article-container）`);
      }
    });
  });

  describe('動態 observer（iOS 晚 init：clean 後才出現 .jwplayer）', () => {
    it('(e) clean 後動態注入的 .jwplayer widget 被 observer hide', async () => {
      const { env, articleEl } = setup();
      const doc = env.document;
      // 模擬 iOS：clean 當下 wrapper 是空殼（無 .jwplayer / 無標籤）
      const container = articleEl.querySelector('.article-container');
      const wrapper = doc.createElement('div');
      wrapper.className = 'featuredVideo-991 border-y';
      wrapper.setAttribute('data-test', 'late-widget');
      const box = doc.createElement('div');
      box.className = 'min-h-[225px]';
      wrapper.appendChild(box);
      container.appendChild(wrapper);

      env.window.__JRead.cleaner.clean(articleEl);
      // clean 後空殼不該被 hide（無任何雜訊訊號）
      assert.notStrictEqual(wrapper.dataset.jreadHidden, '1',
        'clean 當下空殼（無 .jwplayer）不該被 hide');

      // JWPlayer 晚 init：注入 .jwplayer 子樹 → observer 應 hide wrapper
      const jw = doc.createElement('div');
      jw.className = 'jwplayer jw-reset';
      jw.innerHTML = '<div class="jw-wrapper"><video class="jw-video"></video></div>';
      box.appendChild(jw);

      // 等 MutationObserver microtask flush
      await new Promise((r) => setTimeout(r, 50));

      assert.strictEqual(wrapper.dataset.jreadHidden, '1',
        '動態注入 .jwplayer 後 observer 必須 hide 整個 widget wrapper');
      assert.strictEqual(wrapper.style.display, 'none', 'wrapper 必須 inline display:none');
    });
  });
});
