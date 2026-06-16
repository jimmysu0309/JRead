// JRead — 老式 table 排版內容頁偵測 + 內文 font 保留（v0.8.82）
//
// Bug（Jimmy 2026-06-16 回報）：paulgraham.com/boss.html「此頁無法偵測主文」。
//
// 根因兩段（probe 真實 DOM 確認）：
//   1. detector：整篇 essay 在一個 <td> 裡（P → FONT → TD），heuristic
//      bubble-up 把 signal <p> 的分數記到 grandparent TD，但候選容器白名單
//      只收 DIV/SECTION/MAIN/ARTICLE → TD 被排除 → candidates 空 → 回 null。
//   2. cleaner：hideInsideArticleFontTags 無條件 hide 主文內所有 <font>，但
//      老式頁整篇主文就包在 <font> 裡 → 偵測修好後 reader card 仍只剩標題。
//
// 修法（結構性通則，非站點特判）：
//   1. 候選白名單加 TD（通用 HTML 容器）。
//   2. font hide 用結構訊號區分：長文 + 低連結密度 = 內文載體（保留）；
//      短 or 高連結密度（udn 式 <font><a>PR</a></font>）= noise（仍 hide）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'oldweb-table-td-font-essay.html');

describe('detector/cleaner — 老式 table 排版內容頁（v0.8.82 paulgraham）', () => {
  let window, articleEl, detected;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    detected = window.__JRead.detector.detect();
  });

  function isHidden(el) {
    return !!(el && el.closest && el.closest('[data-jread-hidden="1"]'));
  }

  it('detector 必須偵測得到主文（不再回 null）', () => {
    assert.ok(detected && detected.el, 'detector 不可回 null');
  });

  it('主文容器是內容 <td>（heuristic 經 TD 白名單命中）', () => {
    assert.strictEqual(detected.el.tagName, 'TD', '主文應命中內容 td');
    assert.strictEqual(detected.strategy, 'heuristic', '應走 heuristic 策略');
    // 內容 td 必須含整篇 essay 文字
    const text = (detected.el.textContent || '').replace(/\s+/g, ' ').trim();
    assert.ok(text.includes('Technology tends to separate'), '內容 td 必須含 essay 本體');
  });

  it('cleaner 保留內文載體 <font>（長文 + 低連結密度）', () => {
    articleEl = detected.el;
    window.__JRead.cleaner.clean(articleEl);
    // 找含 essay 本體的長 font
    const fonts = Array.from(articleEl.querySelectorAll('font'));
    const essayFont = fonts.find(f => (f.textContent || '').includes('Technology tends to separate'));
    assert.ok(essayFont, 'fixture 應有含 essay 的長 font');
    assert.ok(!isHidden(essayFont), '內文載體 font 不可被 hide（否則整篇正文消失）');
  });

  it('cleaner 仍 hide udn 式 PR noise font（短 + 高連結密度）', () => {
    const fonts = Array.from(articleEl.querySelectorAll('font'));
    const prFont = fonts.find(f => (f.textContent || '').includes('想成為超強飼主'));
    assert.ok(prFont, 'fixture 應有 PR noise font');
    assert.ok(isHidden(prFont), 'PR noise font（<font><a>連結</a></font>）必須仍被 hide');
  });
});
