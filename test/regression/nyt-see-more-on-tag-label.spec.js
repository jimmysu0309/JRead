// JRead — NYT 文末「See more on: <tag>」taxonomy 列帶 label 前綴殘留（v1.6.2）
//
// 對應 fixture：test/regression/fixtures/nyt-see-more-on-tag-label.html
// Trigger：Jimmy 2026-07-02 cage 實測 nytimes.com jaguar-russia-hack —— 捲到文末
// lazy load 後 .bottom-of-article 內「See more on: <a>topic</a>…」tag 列殘留。
//
// 根因：tag 列 anchor 全連 /topic/（taxonomy href、ratioPass 過），但該 <div> 的
// direct text「See more on:」len > HASHTAG_NARRATIVE_TEXT_MAX(5)，被敘述文字 guard
// (`directText.length > MAX → continue`) 誤擋、整列漏網。
//
// 修法（v1.6.2）：TAG_LABEL_RE 白名單——剝 chip 間分隔符後整段剛好只是 tag label
// （see more on / filed under / topics / tags …）時豁免敘述文字 guard。
// 錨定 ^…$ 確保只放行純 label，narrative 段落不誤命中。
//
// 這條驗：tag 列被 hide + 作者簡介（Jimmy 決定保留）與主文完好。不驗：真實
// Chrome lazy-inject 時序（dynamic observer path 由 harness 自驗，見對話紀錄）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'nyt-see-more-on-tag-label.html');
const FIXTURE_TRANSLATED_PATH = path.join(__dirname, 'fixtures', 'nyt-see-more-on-tag-label-translated.html');

function isHiddenOrAncestorHidden(el) {
  let cur = el;
  while (cur && cur !== cur.ownerDocument.body) {
    if (cur.dataset && cur.dataset.jreadHidden === '1') return true;
    cur = cur.parentElement;
  }
  return false;
}

describe('cleaner — NYT 文末 See more on tag 列（v1.6.2 tag-label 前綴豁免）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      pretendToBeVisual: true
    });
    document = env.document;
    const detected = env.window.__JRead.detector.detect();
    assert.ok(detected && detected.el, 'detector 應命中 fixture 主文容器');
    articleEl = detected.el;
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('前置：tag 列 3 個 anchor 都連 /topic/、direct text 起手「See more on」', () => {
    const tags = document.querySelector('.css-tags');
    assert.ok(tags, 'fixture 應有 .css-tags');
    const anchors = Array.from(tags.querySelectorAll('a'));
    assert.strictEqual(anchors.length, 3, 'tag 列應有 3 個 anchor');
    assert.ok(anchors.every(a => /^\/topic\//.test(a.getAttribute('href') || '')),
      '所有 tag chip 都連 /topic/ taxonomy 頁');
    const directText = Array.from(tags.childNodes)
      .filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
    assert.ok(directText.length > 5,
      'direct text（含 label）必須 > HASHTAG_NARRATIVE_TEXT_MAX，才能 forcing tag-label 豁免');
  });

  it('核心：「See more on」tag 列被 hide', () => {
    const tags = document.querySelector('.css-tags');
    assert.ok(isHiddenOrAncestorHidden(tags),
      '.css-tags（See more on: 3 個 /topic/ tag chip）必須被 tag-label 豁免後的 tag-bar path hide');
  });

  it('作者簡介區塊保留（anchor 連 /by/、非 taxonomy → 不命中）', () => {
    const bios = document.querySelector('.css-bios');
    assert.ok(bios && !isHiddenOrAncestorHidden(bios), '作者簡介 .css-bios 必須保留（Jimmy 決定不清）');
    for (const bio of document.querySelectorAll('.css-bio')) {
      assert.ok(!isHiddenOrAncestorHidden(bio), `作者簡介「${bio.textContent.slice(0, 14)}…」必須保留`);
    }
  });

  it('主文 h1 + 三段內文保留（含內文引用連結，無誤殺）', () => {
    const h1 = document.querySelector('h1');
    assert.ok(h1 && !isHiddenOrAncestorHidden(h1), 'h1 主標題保留');
    const ps = Array.from(document.querySelectorAll('.css-body > p'));
    assert.strictEqual(ps.length, 3, 'fixture 有三段主文 p');
    for (const p of ps) {
      assert.ok(!isHiddenOrAncestorHidden(p), `主文段落「${p.textContent.slice(0, 14)}…」必須保留`);
    }
  });
});

// v1.6.3：Shinkansen 翻譯後 label 變中文「更多主題：」——既不在英文 TAG_LABEL_RE、
// 也不在中文 NOISE_HEADING_TEXT_RE，靠翻譯無關的「全 anchor taxonomy + 短 label」
// 結構 path 命中。tag anchor href 仍全指 /topic/（翻譯不改 href）。
describe('cleaner — NYT 文末 tag 列翻譯後 label 變中文（v1.6.3 全 taxonomy + 短 label 結構豁免）', () => {
  let document;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_TRANSLATED_PATH,
      scripts: ['detector', 'cleaner'],
      pretendToBeVisual: true
    });
    document = env.document;
    const detected = env.window.__JRead.detector.detect();
    assert.ok(detected && detected.el, 'detector 應命中 fixture 主文容器');
    env.window.__JRead.cleaner.clean(detected.el);
  });

  it('前置：label「更多主題」不在任一文字 regex（確認走純結構 path）', () => {
    const TAG_LABEL_RE = /^(see\s+more\s+(on|about|from)|more\s+(on|from|about)|filed\s+under|related\s+topics?|topics?|tags?|labels?|categor(?:y|ies)|explore\s+(more\s+)?(on|about)|in\s+this\s+(article|story))$/i;
    assert.ok(!TAG_LABEL_RE.test('更多主題'), '「更多主題」不可命中英文 TAG_LABEL_RE（否則非結構 path 驗證）');
    const tags = document.querySelector('.css-tags');
    const anchors = Array.from(tags.querySelectorAll('a'));
    assert.strictEqual(anchors.length, 3, 'tag 列應有 3 個 anchor');
    assert.ok(anchors.every(a => /^\/topic\//.test(a.getAttribute('href') || '')),
      '所有 tag chip 的 href 都仍指 /topic/（翻譯不改 href）');
  });

  it('核心：翻譯後「更多主題」tag 列被 hide', () => {
    const tags = document.querySelector('.css-tags');
    assert.ok(isHiddenOrAncestorHidden(tags),
      '.css-tags（更多主題：3 個 /topic/ tag chip）必須被全-taxonomy 結構 path hide');
  });

  // 註：作者簡介在翻譯後（CJK bio 段落 < 50 字 Latin 門檻）會被 link-block 規則
  // 連坐 hide——與本結構 tag path 無關的獨立議題（raw length 門檻按拉丁校準、遇短
  // 中文誤殺，見 memory cjk-short-title-length-threshold）。bio 保留由英文 fixture
  // 驗證（Jimmy 決定保留、英文情境）；此處只驗結構 tag path 不誤殺主文。

  it('核心不誤殺：tag 列命中不連坐主文（tag 列 hide 但主文段落保留）', () => {
    const ps = Array.from(document.querySelectorAll('.css-body > p'));
    assert.strictEqual(ps.length, 3, 'fixture 有三段主文 p');
    for (const p of ps) {
      assert.ok(!isHiddenOrAncestorHidden(p), `主文段落「${p.textContent.slice(0, 14)}…」必須保留`);
    }
    const h1 = document.querySelector('h1');
    assert.ok(h1 && !isHiddenOrAncestorHidden(h1), 'h1 主標題保留');
  });
});
