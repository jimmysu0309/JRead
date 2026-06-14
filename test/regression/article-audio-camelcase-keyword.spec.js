// JRead — article-audio camelCase keyword token（v0.8.61 theatlantic）
//
// 對應 bug：theatlantic「Listen to this article」TTS 播放器進閱讀模式後出現
// 重複 hero。根因：widget wrapper class 為 CSS module camelCase 連寫
// `ArticleAudio_root`（article 與 audio 間無分隔符），原 `article[-_]+audio`
// token 要求至少一個分隔符 → 漏網；widget 內含一張與 hero 同源的縮圖，被
// styler 放大成滿版。修法把 token 放寬為 `article[-_]*audio`（CMS 命名慣例
// 通則，非站點特判）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'article-audio-camelcase.html');

describe('cleaner — article-audio camelCase keyword（v0.8.61）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.querySelector('article#story');
    assert.ok(articleEl);
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('ArticleAudio_root（Listen TTS 播放器）被 hide', () => {
    const widget = document.querySelector('#ttsblock');
    assert.ok(widget);
    assert.strictEqual(widget.dataset.jreadHidden, '1',
      'camelCase ArticleAudio_root 必須命中 article[-_]*audio token');
  });

  it('widget 內的重複 hero 縮圖隨之隱藏', () => {
    const dupImg = document.querySelector('.ArticleAudio_img__BFda3');
    assert.ok(dupImg);
    let hidden = false, p = dupImg;
    while (p) { if (p.dataset && p.dataset.jreadHidden === '1') { hidden = true; break; } p = p.parentElement; }
    assert.ok(hidden, '重複 hero 縮圖應被隱藏的 widget 容器蓋住');
  });

  it('真 hero（ArticleLeadArt_image）保留', () => {
    const hero = document.querySelector('.ArticleLeadArt_image__HZS4B');
    assert.ok(hero);
    let hidden = false, p = hero;
    while (p) { if (p.dataset && p.dataset.jreadHidden === '1') { hidden = true; break; } p = p.parentElement; }
    assert.ok(!hidden, '真 hero 不可被誤殺');
  });

  it('主文 p 全保留', () => {
    for (const para of document.querySelectorAll('article#story > p')) {
      assert.notStrictEqual(para.dataset.jreadHidden, '1',
        `主文 p 不可被 hide: "${para.textContent.slice(0, 30)}…"`);
    }
  });
});
