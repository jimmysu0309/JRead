// JRead — theverge 文末 follow CTA widget 的譯文變體（v0.8.53）
//
// Bug（Jimmy 2026-06-12 截圖回報）：theverge.com 文章先被 Shinkansen 翻譯成
// 中文、再進閱讀模式送 Readwise Reader 時，文末殘留「追蹤本則報導的主題，
// 我們會持續寄送…電子郵件更新」CTA 文字 + 一排空 bullet。
//
// 根因（cage probe 實證）：該 widget 的英文原文「Follow topics and authors」
// 由 NOISE_HEADING_TEXT_EXT_RE 的 ^follow\s+topics 命中、整塊 hide；翻譯後
// 文字變中文，英文 pattern 失效 → 整塊漏網。譯文措辭隨引擎浮動（「追蹤本則
// 報導的主題」/「追蹤此故事中的主題和作者」實測兩款），不能綁單一字串。
//
// 修法（結構性通則，不綁站點 / class）：EXT_RE 加 ^(追蹤|關注).{0,12}(主題|
// 話題|作者)——CTA 共同句式 = 開頭「追蹤/關注」+ 短距離內出現內容指稱詞。
// ^ 錨定 + 距離上限 12 避免吃到「追蹤報導：…」合法新聞副標。
//
// 空 bullet 部分由 main.js buildCleanHtml 的空殼 prune 處理（readwise-save
// .spec.js v0.8.53 條目）；本 spec 顧 cleaner 層「譯後文字 + 按鈕列整塊隱藏」。

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'theverge-follow-cta-translated.html');

// 從 cleaner.js source 抽出 NOISE_HEADING_TEXT_EXT_RE 字面值直接測 pattern。
// 為什麼不只靠下面的 fixture 整合測試：jsdom 無 layout（rect 全 0），fixture
// 裡的 CTA 區塊會被其他 layout 相關結構規則順手蓋到（sanity check 實證：移除
// 新 pattern 後 fixture spec 仍綠）——fixture 驗「整體結果」、這裡驗「pattern
// 本身」，缺一不可。
function loadExtRe() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8');
  const m = src.match(/const NOISE_HEADING_TEXT_EXT_RE = (\/.+\/i);/);
  assert.ok(m, 'cleaner.js 必須有 NOISE_HEADING_TEXT_EXT_RE 字面值');
  return eval(m[1]); // eslint-disable-line no-eval — 測試端重建 regex 字面值
}

describe('cleaner — NOISE_HEADING_TEXT_EXT_RE 譯文變體 pattern（v0.8.53 forcing function）', () => {
  const re = loadExtRe();

  it('命中實機截圖措辭「追蹤本則報導的主題」', () => {
    assert.ok(re.test('追蹤本則報導的主題'),
      'EXT_RE 必須含 ^(追蹤|關注).{0,12}(主題|話題|作者) 譯文變體 pattern');
  });

  it('命中 Google MT 措辭「追蹤此故事中的主題和作者」', () => {
    assert.ok(re.test('追蹤此故事中的主題和作者'),
      '措辭隨引擎浮動，pattern 必須容忍中段字詞差異');
  });

  it('不命中合法新聞副標「追蹤報導：本週的 Mac 工具」', () => {
    assert.ok(!re.test('追蹤報導：本週的 Mac 工具'),
      '^ 錨定 + 距離上限 12 必須擋掉無內容指稱詞的合法副標');
  });

  it('不命中非開頭出現的「追蹤」句（主文一般敘述）', () => {
    assert.ok(!re.test('我關注這個 Mac 應用程式的開發已經有一段時間'),
      '主文敘述句不可命中（距離上限把關：關注後 12 字內無主題/話題/作者）');
  });
});

describe('cleaner — theverge follow CTA 譯文變體（v0.8.53 translate-first）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.querySelector('article.post-body');
    assert.ok(articleEl, 'fixture 必須有 article.post-body');
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('變體一「追蹤本則報導的主題」：CTA 文字所在區塊必須被 hide', () => {
    const strong = Array.from(document.querySelectorAll('strong'))
      .find(s => s.textContent.includes('追蹤本則報導的主題'));
    assert.ok(strong, 'fixture 必須有變體一 strong');
    assert.ok(strong.closest('[data-jread-hidden="1"]'),
      '「追蹤本則報導的主題」CTA 必須命中 EXT_RE 譯文變體 pattern 被整塊 hide');
  });

  it('變體一的 follow 按鈕 ul 必須跟著整塊不可見', () => {
    const ul = document.querySelector('ul.tly2fw3');
    assert.ok(ul, 'fixture 必須有 tly2fw3 ul');
    assert.ok(ul.closest('[data-jread-hidden="1"]'),
      'follow 按鈕列必須在被 hide 的區塊內（送 Readwise 才不會留下空 bullet 來源）');
  });

  it('變體二「追蹤此故事中的主題和作者」（Google MT 措辭）：同樣被 hide', () => {
    const strong = Array.from(document.querySelectorAll('strong'))
      .find(s => s.textContent.includes('追蹤此故事中的主題和作者'));
    assert.ok(strong, 'fixture 必須有變體二 strong');
    assert.ok(strong.closest('[data-jread-hidden="1"]'),
      '「追蹤此故事中的主題和作者」也必須命中同一 pattern（措辭浮動容忍）');
  });

  it('誤殺保護：合法副標「追蹤報導：本週的 Mac 工具」不可被 hide', () => {
    const h2 = Array.from(document.querySelectorAll('h2'))
      .find(h => h.textContent.includes('追蹤報導'));
    assert.ok(h2, 'fixture 必須有合法 h2 副標');
    assert.ok(!h2.closest('[data-jread-hidden="1"]'),
      '開頭「追蹤」但無內容指稱詞的合法副標不可命中（^ 錨定 + 距離上限把關）');
  });

  it('誤殺保護：主文段落全數保留', () => {
    for (const p of document.querySelectorAll('article > p')) {
      assert.ok(!p.closest('[data-jread-hidden="1"]'),
        `主文段落不可被 hide：${p.textContent.slice(0, 20)}…`);
    }
  });
});
