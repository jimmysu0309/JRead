// JRead — Medium 文章頭部 byline（作者 + 日期）不可被誤殺（v1.5）
//
// Bug（Jimmy 2026-06-27 真實 medium.com/it-chronicles probe + cage 實證）：進閱讀
// 模式後作者 + 日期消失。兩條 path 各自誤殺：
//   (1) hideInsideArticleAuthorBioCards 從頭像 walk-up 到 header-block（含副標 +
//       作者 + 日期/閱讀時間 + 動作鈕）整塊砍——既有 byline 保護只看候選前 60 字
//       （`BYLINE_TEXT_RE.test(t.slice(0,60))`），但 Medium 副標排最前佔滿 60 字、
//       byline 日期被擠到後面看不到。修法 ARTICLE_META_RE：候選整段含發表日期 /
//       閱讀時間估計（min read）= 文章頭部 byline/meta，保留。
//   (2) hideInsideArticleButtonClusters 把 author-row（頭像 + 作者名 + Follow 鈕）
//       當 button cluster 整塊砍。修法 clusterContainsAuthorProfileLink：cluster 含
//       作者個人頁連結（/@user、authors/…）= byline 作者列、非純動作叢集，保留。
//
// 真實站修法後 cage 截圖驗過：byline 顯示「huizhou92 · Jun 3, 2026」。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE = path.join(__dirname, 'fixtures', 'medium-byline-header.html');

describe('cleaner — Medium 頭部 byline 作者+日期保護（v1.5）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true,
      url: 'https://medium.com/it-chronicles/the-computer-company-2c756000ead4'
    });
    document = env.document;
    articleEl = document.querySelector('article#story');
    assert.ok(articleEl);
    // 頭像幾何 stub（規則要求小尺寸近方形 rendered img）
    stubRect(document.querySelector('#avatar'), { top: 240, left: 230, width: 24, height: 24 });
    stubRect(document.querySelector('#bottom-avatar'), { top: 1800, left: 230, width: 48, height: 48 });
    document.querySelector('article#story').ownerDocument.defaultView.__JRead.cleaner.clean(articleEl);
  });

  it('header-block（含作者+日期）不可被 author-bio-card 規則整塊砍', () => {
    const hb = document.querySelector('#header-block');
    assert.notStrictEqual(hb.dataset.jreadHidden, '1',
      'header-block 含發表日期/閱讀時間（ARTICLE_META_RE）→ 文章頭部 byline，不可當 bio 卡砍');
  });

  it('author-row（頭像+作者名+Follow）不可被 button-cluster 規則整塊砍', () => {
    const ar = document.querySelector('#author-row');
    assert.notStrictEqual(ar.dataset.jreadHidden, '1',
      'author-row 含作者個人頁連結（clusterContainsAuthorProfileLink）→ byline 作者列，不可當 button cluster 砍');
  });

  it('作者名「huizhou92」可見（不在任何 hidden 子樹）', () => {
    const author = document.querySelector('#author-link');
    assert.ok(!author.closest('[data-jread-hidden="1"]'),
      '作者名連結不可在 hidden 子樹內（Jimmy 報的作者消失）');
  });

  it('日期「Jun 3, 2026」可見（不在任何 hidden 子樹）', () => {
    const date = document.querySelector('#date');
    assert.ok(!date.closest('[data-jread-hidden="1"]'),
      '日期不可在 hidden 子樹內（Jimmy 報的日期消失）');
  });

  it('負控制：底部作者 bio 卡（無發表日期 meta）仍被 hide（不過度保護）', () => {
    const bio = document.querySelector('#bottom-bio');
    assert.strictEqual(bio.dataset.jreadHidden, '1',
      '底部 bio 卡無發表日期/閱讀時間 → 兩修法都不保護，仍應被 bio 卡規則砍掉');
  });

  it('主文段落全保留', () => {
    for (const id of ['p1', 'p2', 'p3']) {
      const p = document.getElementById(id);
      assert.ok(!p.closest('[data-jread-hidden="1"]'), `#${id} 不可被誤殺`);
    }
  });
});

describe('cleaner — ARTICLE_META_RE 純 regex（spacing-robust，v1.5）', () => {
  // 直接驗 regex：Medium flex textContent 元素間無空白，數字會黏在一起
  //（"20261.1K"、"Follow11 min read"），不可依賴年份/前綴數字的 word boundary。
  const SRC = require('fs').readFileSync(
    path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8');
  // 從 source 抽出 ARTICLE_META_RE literal 來測（單一資料源，避免 spec 自寫一份 drift）
  const m = SRC.match(/const ARTICLE_META_RE = (\/[\s\S]*?\/i);/);
  assert.ok(m, 'cleaner.js 必須宣告 ARTICLE_META_RE');
  const RE = eval(m[1]);

  it('「min read」估計閱讀時間命中（含前面黏字 Follow11 min read）', () => {
    assert.ok(RE.test('serioushuizhou92Follow11 min read·Jun 3, 2026'));
    assert.ok(RE.test('5 min read'));
    assert.ok(RE.test('reading: minute read here'));
  });

  it('發表日期命中，且年份後黏數字（20261.1K）仍命中', () => {
    assert.ok(RE.test('read·Jun 3, 20261.1K463'), '年份後接數字不可因 \\b 失配');
    assert.ok(RE.test('Published Dec 25, 2024'));
    assert.ok(RE.test('2026-06-03'));
    assert.ok(RE.test('2026年6月3日'));
  });

  it('純 bio 文字（無日期/閱讀時間）不命中（避免過度保護）', () => {
    assert.ok(!RE.test('huizhou92 writes about computing history and technology'));
    assert.ok(!RE.test('Senior editor. Follow for more stories.'));
  });
});
