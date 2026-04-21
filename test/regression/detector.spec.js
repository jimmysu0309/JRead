// JRead — detector regression spec
// 對應 fixture：test/regression/fixtures/businessweekly-7014035.html
// 依 CLAUDE.md 硬規則 4，每修一個 bug 必須補一條對應 spec。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const DETECTOR_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'),
  'utf8'
);

function loadFixtureAndRunDetector(fileName) {
  const html = fs.readFileSync(path.join(FIXTURE_DIR, fileName), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const { window } = dom;
  // 最小 NS 環境（detector.js 只依賴 window.__JRead 的存在）
  window.__JRead = { state: {}, MSG: {} };
  window.eval(DETECTOR_SRC);
  return { window, result: window.__JRead.detector.detect() };
}

describe('detector — businessweekly-7014035', () => {
  let result;
  before(() => {
    result = loadFixtureAndRunDetector('businessweekly-7014035.html').result;
  });

  it('偵測成功，回傳物件而非 null', () => {
    assert.ok(result, '偵測應成功（不得 no-op）');
  });

  it('策略命中 article-tag（單一 <article> 直接採用）', () => {
    assert.strictEqual(result.strategy, 'article-tag');
  });

  it('信心分數等於 0.9', () => {
    assert.strictEqual(result.confidence, 0.9);
  });

  it('選到 article.article 主文容器', () => {
    assert.ok(result.el);
    assert.strictEqual(result.el.tagName.toLowerCase(), 'article');
    assert.ok(
      result.el.classList.contains('article'),
      `應命中 article.article，實際 className="${result.el.className}"`
    );
  });

  it('主文範圍內必須包含 <summary>（SPEC 內文保留特例）', () => {
    // Unclutter 在商周踩過這坑：<summary> 是 editor bullets，不可外移。
    // 偵測階段 <summary> 必須仍在 el 的子樹中。
    const summary = result.el.querySelector('summary');
    assert.ok(summary, '<summary> 必須留在主文容器內');
    assert.ok(
      summary.textContent.includes('editor bullet'),
      'summary 內的 editor bullets 文字必須保留'
    );
  });
});
