// JRead — regression spec: udn 討論區內含未載入 emoji <img> 觸發 standalone-img
// 保護而殘留（留言/討論 widget 家族改 strong keyword，v1.6.17）
//
// Trigger: udn.com/news/story/7321/9610701，iPhone Safari 文末殘留「udn 討論區」
//   留言板（Chrome 多半正常）。
// Root cause: detector promote 到 section.article-content__wrapper（含主文 + 討論區
//   兄弟）。.discuss-board 靠 `discuss` class keyword 命中，但因內含 6 張未載入的
//   emoji picker <img>（naturalWidth=0），containsStandaloneContentImg 的
//   「w<=8 未載入圖保守保護」回 true → keywordWrapperIsProtected 誤保護 → 整塊留言
//   板被豁免殘留。`discuss` 原本非 strong keyword，走 guard 路徑才會被誤保護。
//   Chrome/iOS 差異 = emoji 是否在 clean 時已載入的 load-timing flaky。
//
// 修法: 留言/討論 widget 家族（comment(s) / comment-form / discussion / discuss）
//   一律標 strong——這類 class 永遠不是主文容器。shouldHideByStrongKeyword 命中即
//   在 keywordWrapperIsProtected 開頭 return false，跳過所有內容保護 guard。與既有
//   related-* / more-* strong 同型（v0.7.184）。
//
// Forcing functions:
//   (a) #discuss 被 hide（拿掉 discuss 的 strong → 未載入 img 保護復活 → fail）
//   (b) 主文 editor + 段落保留（strong 只清留言板、不誤傷主文）
//   (c) sanity: 討論區確實含未載入 img（naturalWidth=0）且文字量 < 主文 50%
//       ——確認本測試唯一觸發的保護路徑就是 standalone-img guard，非 CBN 50% /
//       mainContentP 分支（否則測試沒驗到 strong 的效果）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'udn-discuss-board-emoji-img-protection.html');

describe('cleaner — udn 討論區未載入 emoji img 保護（討論/留言 widget strong keyword）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.getElementById('wrapper');
    assert.ok(articleEl, 'fixture 須含 section#wrapper（article-content__wrapper）');
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('(a) section#discuss 被 hide（strong keyword 跳過未載入 img 保護）', () => {
    const discuss = document.getElementById('discuss');
    assert.ok(discuss, 'fixture 須含 section#discuss');
    assert.strictEqual(discuss.dataset.jreadHidden, '1',
      'section.discuss-board 必須被 hide；`discuss` 非 strong 時，內含未載入 emoji ' +
      '<img>（naturalWidth=0）觸發 containsStandaloneContentImg 保守保護 → 誤豁免殘留');
  });

  it('(b) 主文 editor 與段落保留（strong 只清留言板、不誤傷主文）', () => {
    const editor = document.getElementById('editor');
    const title = document.getElementById('title');
    assert.notStrictEqual(editor.dataset.jreadHidden, '1', '#editor 主文容器不該被 hide');
    assert.notStrictEqual(title.dataset.jreadHidden, '1', '#title 主標不該被 hide');
    for (const id of ['p1', 'p2', 'p3']) {
      const p = document.getElementById(id);
      assert.ok(p, `fixture 須含 #${id}`);
      assert.notStrictEqual(p.dataset.jreadHidden, '1', `#${id} 主文段落不該被 hide`);
      let parent = p.parentElement;
      while (parent && parent !== document.body) {
        assert.notStrictEqual(parent.dataset.jreadHidden, '1',
          `#${id} 祖先 ${parent.tagName}#${parent.id || ''} 不該 hide`);
        parent = parent.parentElement;
      }
    }
  });

  it('(c) sanity: 討論區含未載入 img（naturalWidth=0）且文字量 < 主文 50%', () => {
    const discuss = document.getElementById('discuss');
    const editor = document.getElementById('editor');
    const imgs = Array.from(discuss.querySelectorAll('img'));
    assert.ok(imgs.length >= 1, '討論區須含 emoji <img> 才能觸發 standalone-img 保護');
    // 非 <a>/<li> 內、且 naturalWidth <= 8（jsdom 恆為 0）→ 觸發 w<=8 保守保護
    const standaloneUnloaded = imgs.filter(img => !img.closest('a, li') && (img.naturalWidth || 0) <= 8);
    assert.ok(standaloneUnloaded.length >= 1,
      '至少一張非連結內、未載入的 <img>，才會讓 containsStandaloneContentImg 回 true');
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const discussLen = norm(discuss.textContent).length;
    const articleLen = norm(articleEl.textContent).length;
    assert.ok(discussLen < articleLen * 0.5,
      `討論區文字量須 < 主文 50%（實測 ${discussLen} / ${articleLen}），` +
      '確認唯一觸發的保護路徑是 standalone-img guard、非 CBN 50% / mainContentP 分支');
  });
});
