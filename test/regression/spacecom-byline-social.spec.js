// JRead — translate-first byline-social wrapper byline 保護（v1.0.16 space.com）
//
// 對應 bug：space.com translate-first 後進入閱讀模式，作者 + 發佈日期消失。
// 根因：CMS 把作者列 + 日期 + 分享按鈕包在 div.byline-social，class 的 `social`
// token 命中 NOISE_KEYWORD_RE → hideInsideArticleByKeyword 整支砍掉。未翻譯時
// wrapper 內 standfirst <p>（>=100 chars）偶然觸發 mainContentP 保護；翻譯後
// Shinkansen 改寫 <time> + standfirst → 保護失效、整列消失。
// 修法：keywordWrapperIsProtected 新增 keywordWrapperIsByline 豁免——wrapper 的
// class / id 帶 byline / dateline meta 語意 token（CMS 慣例命名）→ 視為 byline/
// meta 容器不整支 hide；內部 share 連結仍由 a/button scan 清。class 訊號翻譯不
// 變、不依賴文字長度（避免 CJK 資訊密度高的短卡片列誤判）。
// 控制組 B：class 不帶 byline/dateline token 的社群 feed 卡片列（即使含 <time>、
// CJK 文字 < 200）仍被 hide。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'spacecom-byline-social-keyword.html');

describe('cleaner — byline-social wrapper byline 保護（v1.0.16 space.com translate-first）', () => {
  let document;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    document = env.document;
    const articleEl = document.querySelector('article#story');
    assert.ok(articleEl);
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('byline-social wrapper（class 含 social）不被整支 hide', () => {
    const wrapper = document.querySelector('#byline-social');
    assert.ok(wrapper);
    assert.notStrictEqual(wrapper.dataset.jreadHidden, '1',
      'byline + 發佈日期 wrapper 不可因 social keyword 被整支清掉');
  });

  it('作者名 + 發佈日期可見（無被隱藏祖先）', () => {
    for (const id of ['#author-chip', '#pubdate']) {
      const el = document.querySelector(id);
      assert.ok(el, id);
      assert.ok(!el.closest('[data-jread-hidden="1"]'),
        `${id} 不可被任何隱藏祖先吃掉`);
    }
  });

  it('byline 內 share 連結（class 含 share）仍被清（控制組 A）', () => {
    const share = document.querySelector('#share-link');
    assert.ok(share);
    assert.strictEqual(share.dataset.jreadHidden, '1',
      '分享連結不享 byline 豁免，照常被 a/button keyword scan 清');
  });

  it('class 不帶 byline token 的社群 feed 卡片列仍被 hide（控制組 B：防過度豁免）', () => {
    const feed = document.querySelector('#social-feed');
    assert.ok(feed);
    assert.strictEqual(feed.dataset.jreadHidden, '1',
      'class 僅含 social（無 byline/dateline token）的卡片列即使含 <time> 也不可被 byline 豁免誤保護');
  });

  it('主文 standfirst + 段落保留', () => {
    for (const p of document.querySelectorAll('article > p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });
});
