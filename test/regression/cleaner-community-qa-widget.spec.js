// JRead — Community Q&A 社群論壇 widget 整塊清除（v0.8.107）
//
// wikiHow Tie-a-Tie 實測（Jimmy 2026-06-18 截圖）：文末 Community Q&A widget
// avatar / label absolute 定位在 reader 單欄流交疊錯亂。Jimmy 決定整塊當雜訊清除
// （主流 reader 都排除社群問答）。
//
// 修法：dedicated hideCommunityQaWidget——heading 命中 /community q&a/（文字
// heuristic、非站點/class 特判），walk-up 到「不含主文標題 anchor + 不含單一
// >= 100 chars 長段落」的最外層 wrapper 整塊 hide。刻意用 hasLongMainParagraph
// 而非 wrapperContainsMainContentP，繞過「累計短問答 >= 300」的誤保護（generic
// heading walk-up 因此只 hide 得掉標題框，實證 resolveTarget 停在 .headline_container）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'wikihow-community-qa.html');

function runClean() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1400, height: 900 },
    pretendToBeVisual: true
  });
  const articleEl = env.document.getElementById('post');
  articleEl.setAttribute('data-jread-active', '1');
  env.NS.cleaner.clean(articleEl, []);
  return env.document;
}

// 元素自身或某祖先被 hide（data-jread-hidden / inline display:none）
function isHidden(el) {
  let cur = el;
  while (cur) {
    if (cur.dataset && cur.dataset.jreadHidden === '1') return true;
    if (cur.style && cur.style.display === 'none') return true;
    cur = cur.parentElement;
  }
  return false;
}

describe('cleaner — Community Q&A widget 整塊清除（v0.8.107）', () => {
  let document;
  before(() => { document = runClean(); });

  it('整個 .qa widget 容器必須被 hide', () => {
    const qa = document.querySelector('.qa.section');
    assert.ok(qa, 'fixture 應有 .qa widget 容器');
    assert.ok(isHidden(qa),
      '.qa widget 必須整塊被 hide——forcing：generic heading walk-up 因累計短問答 >= 300 誤觸主文保護、只 hide 標題框，dedicated hideCommunityQaWidget 才整塊清');
  });

  it('Q&A 問答內容（Question / Community Answer / 答案）全部不可見', () => {
    for (const sel of ['.qa_q', '.qa_a', '.qa_q_label', '.qa_a_label']) {
      for (const el of document.querySelectorAll(sel)) {
        assert.ok(isHidden(el), `${sel} "${(el.textContent||'').trim().slice(0,20)}" 必須被 hide（Q&A widget 整塊清）`);
      }
    }
  });

  it('Q&A 的 Ask a Question 連結與 Submit 按鈕也須隨 widget 一起清除', () => {
    assert.ok(isHidden(document.querySelector('.qa_ask')), 'Ask a Question 連結須被 hide');
    assert.ok(isHidden(document.querySelector('.qa_submit')), 'Submit 按鈕須被 hide');
  });

  it('主文步驟（單一 >= 100 chars 長段落）不可被誤殺', () => {
    const steps = document.querySelectorAll('.steps_list_2 p');
    assert.ok(steps.length >= 2, 'fixture 應有 >= 2 個步驟段落');
    for (const p of steps) {
      assert.ok(!isHidden(p),
        `步驟主文「${(p.textContent||'').trim().slice(0,30)}…」不可被 hide——forcing：hasLongMainParagraph 邊界把含長步驟的 .article-body 擋在 walk-up 外、不誤殺`);
    }
  });

  it('文末主文段落不可被誤殺（widget 清除不波及 widget 外主文）', () => {
    const tail = document.querySelector('.article-tail');
    assert.ok(tail);
    assert.ok(!isHidden(tail), '文末主文段落不可被 hide');
  });
});
