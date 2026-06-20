// JRead — Miniflux entry-header title-clone 帶入工具列 / byline chrome regression（v0.8.135）
//
// 對應 bug：Miniflux（RSS 閱讀器）文章頁進入閱讀模式後，主文標題下方散落
// 工具列按鈕、來源 icon、作者 / 日期 byline，排版亂七八糟（Jimmy 2026-06-20
// 截圖：asymco 來源連結 + 歪掉的 asymco logo + 飄移的日期與分享鈕）。
//
// 根因：detector 選 article.entry-content（純內文）為 articleEl，主標題 h1 在
// 外層 header.entry-header。promoteUniqueTitleH1Into 把 h1 的 wrapper（整個
// entry-header）cloneNode(true) 進 reader card —— 但 entry-header 還包了
// entry-actions 工具列 + entry-meta + entry-date。原本缺少 wrapper 文字長度
// guard（姊妹函式 promoteArticleTitleClassHeadingInto 早有此 guard），整支帶進來。
//
// 修法：promoteUniqueTitleH1Into 補上 wrapper 文字 >> 標題（差 > 30 chars）
// → 改 clone h1 自己的 guard。
//
// 本 spec 是 forcing function：
//   - title clone 必須存在（標題仍被 promote 進 reader card）
//   - title clone 不可含工具列按鈕文字（標記為未讀 等）與 byline（Horace Dediu）
//   - 主文段落完整保留

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'miniflux-entry-header-title-clone.html');

describe('cleaner — Miniflux entry-header title-clone 不可帶入工具列 / byline chrome（v0.8.135）', () => {
  let document, articleEl, hidden;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.querySelector('article.entry-content');
    hidden = [];
    env.window.__JRead.cleaner.clean(articleEl, hidden);
  });

  it('title clone 必須存在（主標題被 promote 進 reader card）', () => {
    const clone = articleEl.querySelector('[data-jread-title-clone="1"]');
    assert.ok(clone, '應產生 title clone 把主標題帶進 reader card');
    assert.ok(clone.textContent.includes('選項已所剩無幾'),
      `title clone 應含主標題文字，實際: "${clone.textContent.trim().slice(0, 40)}"`);
  });

  it('title clone 不可帶入 entry-actions 工具列按鈕文字', () => {
    const clone = articleEl.querySelector('[data-jread-title-clone="1"]');
    const txt = clone ? clone.textContent : '';
    for (const label of ['標記為未讀', '新增收藏', '儲存', '分享']) {
      assert.ok(!txt.includes(label),
        `title clone 不應含工具列按鈕「${label}」，實際: "${txt.replace(/\s+/g, ' ').trim().slice(0, 60)}"`);
    }
  });

  it('title clone 不可帶入 byline（作者 / 來源 / 日期）', () => {
    const clone = articleEl.querySelector('[data-jread-title-clone="1"]');
    const txt = clone ? clone.textContent : '';
    assert.ok(!txt.includes('Horace Dediu'),
      `title clone 不應含作者 byline，實際: "${txt.replace(/\s+/g, ' ').trim().slice(0, 60)}"`);
    assert.ok(!txt.includes('昨天'),
      `title clone 不應含日期，實際: "${txt.replace(/\s+/g, ' ').trim().slice(0, 60)}"`);
    assert.ok(!clone.querySelector('.entry-meta, .entry-actions, .entry-date'),
      'title clone 不應含 entry-meta / entry-actions / entry-date chrome 容器');
  });

  it('主文段落完整保留', () => {
    const ps = articleEl.querySelectorAll('.entry-content > p, article.entry-content > p');
    let visible = 0;
    for (const p of articleEl.querySelectorAll(':scope > p')) {
      if (p.getAttribute('data-jread-hidden') !== '1') visible++;
    }
    assert.ok(visible >= 4, `entry-content 內應有 >= 4 個 visible <p>，實際 ${visible}`);
  });
});
