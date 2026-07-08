// JRead — regression spec: BeyondWords 文章朗讀 TTS widget / 促銷移除（v1.6.18）
//
// Trigger: foxnews.com 文首「新功能／您現在可以聆聽 Fox News 的新聞文章了！」促銷 +
//   「聽這篇文章」播放器殘留（Jimmy 2026-07-08 譯後截圖回報）。
// Root cause: BeyondWords（第三方文章朗讀 TTS 廠商）widget，markup 為
//   `.beyondwords-wrapper`（促銷）+ `.beyondwords-player`（播放器）+ `<script class="beyondwords">`。
// 修法: 加 beyondwords / trinity-audio / speechkit 為 noise brand token（strong）——
//   文章朗讀 TTS 業界品牌名，命中即必然 widget、零誤殺；閱讀模式不需要「聽文章」widget。
//
// Forcing functions:
//   (a) .beyondwords-wrapper 促銷 + .beyondwords-player 播放器被 hide
//   (b) class 含 beyond / words 但非 beyondwords brand token 的內容不被誤殺（boundary 安全）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'foxnews-beyondwords-audio-promo.html');

describe('cleaner — BeyondWords 文章朗讀 TTS widget 移除', () => {
  let document;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    const articleEl = document.querySelector('article');
    assert.ok(articleEl, 'fixture 須含 <article>');
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('(a) .beyondwords-player 播放器被 hide（beyondwords token 唯一命中者 = forcing）', () => {
    // player 內容中性（無促銷 CTA 文字）→ 只有 beyondwords brand token 會命中它；
    // 拿掉 token → 此 player 不被 hide（wrapper 因促銷文字被其他規則兜到、非 forcing）。
    const player = document.getElementById('bw-player');
    assert.ok(player, 'fixture 須含 .beyondwords-player');
    assert.strictEqual(player.dataset.jreadHidden, '1',
      '.beyondwords-player 必須被 beyondwords brand token 命中 hide');
  });

  it('(a) .beyondwords-wrapper 朗讀促銷被 hide', () => {
    const el = document.getElementById('bw-wrapper');
    assert.ok(el, 'fixture 須含 .beyondwords-wrapper');
    assert.strictEqual(el.dataset.jreadHidden, '1',
      '.beyondwords-wrapper 必須被 hide（beyondwords token + 促銷文字規則雙保險）');
  });

  it('(b) class 含 beyond / words 但非 beyondwords 的內容不被誤殺', () => {
    const el = document.getElementById('not-noise');
    assert.notStrictEqual(el.dataset.jreadHidden, '1',
      'class "beyond-repair keywords-list" 不含 beyondwords token → 不可被 hide');
    const p = document.getElementById('body-3');
    assert.notStrictEqual(p.dataset.jreadHidden, '1', '內容段落不可被 hide');
  });

  it('(b) 主文段落保留', () => {
    for (const id of ['body-1', 'body-2']) {
      const p = document.getElementById(id);
      assert.ok(p, `fixture 須含 #${id}`);
      assert.notStrictEqual(p.dataset.jreadHidden, '1', `#${id} 主文段落不可被 hide`);
      let parent = p.parentElement;
      while (parent && parent !== document.body) {
        assert.notStrictEqual(parent.dataset.jreadHidden, '1',
          `#${id} 祖先 ${parent.tagName}.${parent.className} 不該 hide`);
        parent = parent.parentElement;
      }
    }
  });
});
