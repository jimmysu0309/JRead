// JRead — v1.7.41（review 批次 3 C3 + C4）：hideInsideArticleActionRows 兩處量法修正
// -----------------------------------------------------------------------------
// C3：`c.tagName === 'SVG'` 恆 false——SVG namespace 元素 tagName 保留小寫
//     'svg'（v1.6.24 已修過同型坑、此處殘留）。直接子是裸 svg icon 的 action
//     row interactive 比例恆算 0%，帶 20-79 字文字時被「內容 wrapper」排除
//     整條漏清。修法：改 `c.localName === 'svg'`。
// C4：shell 門檻（<20）與 ACTION_TEXT_MAX（80）都量 raw textContent——HTML
//     多行縮排的 whitespace 灌爆長度，真 action bar raw 破 80 整條漏清。
//     修法：兩處統一走 norm()（與 sidebar / button-cluster 規則同一把尺）。
//
// 訊號層次：jsdom 驗規則命中邏輯；真實 layout 由 harness 驗。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
);

function setupDom(bodyHtml) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><main>${bodyHtml}</main></body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
  window.eval(SRC.namespace);
  window.eval(SRC.cleaner);
  return window;
}

describe('cleaner v1.7.41 — action row 直接子裸 svg 的 interactive 計數（C3）', () => {
  it('直接子多為 svg、帶 20-79 字文字的 action row 必須被 hide', () => {
    const window = setupDom(`
      <article id="art"><h1>主標題</h1>
      <p>這是第一段夠長的主文內容，包含逗號、句號等標點，足夠通過字數門檻與主文保護判定不被誤砍。</p>
      <div id="row"><svg viewBox="0 0 24 24"><path d="M1 1"></path></svg><svg viewBox="0 0 24 24"><path d="M2 2"></path></svg><svg viewBox="0 0 24 24"><path d="M3 3"></path></svg><span>工具列：儲存這篇文章到書籤與稍後閱讀清單</span></div>
      <p>這是第二段主文內容，持續描述補充，維持足夠長度避免整個容器被當成空殼或雜訊處理。</p>
      </article>`);
    const doc = window.document;
    const art = doc.getElementById('art');
    const row = doc.getElementById('row');
    // 前置條件自檢：文字在 [20, 80] 區間（低於 20 走 shell short-circuit、
    // 高於 80 被 ACTION_TEXT_MAX 排除，兩者都測不到 C3 的 interactive 比例判定）
    const textLen = (row.textContent || '').replace(/\s+/g, ' ').trim().length;
    assert.ok(textLen >= 20 && textLen <= 80, `fixture 文字長度 ${textLen} 必須落在 [20, 80]`);
    window.__JRead.cleaner.clean(art);
    assert.strictEqual(row.getAttribute('data-jread-hidden'), '1',
      '直接子 3 svg + 1 短文字 span 的 action row 沒被清——tagName === "SVG" 恆 false 讓 interactive 比例算成 0%、被「內容 wrapper」排除');
  });

  it('結構 forcing：interactive 計數必須用 localName 比對 svg', () => {
    const m = CLEANER_SRC.match(/function hideInsideArticleActionRows[\s\S]*?\n  \}/);
    assert.ok(m, '抓不到 hideInsideArticleActionRows');
    assert.match(m[0], /c\.localName === 'svg'/,
      'interactive 計數必須 localName === "svg"（SVG tagName 是小寫，大寫比對恆 false）');
    // 註：比對限縮在 program code 行（排除註解——修法註解會提到舊寫法字樣）
    const codeLines = m[0].split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/tagName === 'SVG'/.test(codeLines),
      "不得殘留大寫 SVG tagName 死比對");
  });
});

describe('cleaner v1.7.41 — action row 文字長度統一 norm() 量法（C4）', () => {
  it('多行縮排灌爆 raw 長度（>80）但 norm 後短的 action bar 仍要被清', () => {
    // 三顆 button 之間塞大量縮排 whitespace：raw textContent > 80、norm 後 ~20
    const pad = '\n' + ' '.repeat(40) + '\n';
    const window = setupDom(`
      <article id="art"><h1>主標題</h1>
      <p>這是第一段夠長的主文內容，包含逗號、句號等標點，足夠通過字數門檻與主文保護判定不被誤砍。</p>
      <div id="bar">${pad}<button>分享到社群</button>${pad}<button>儲存書籤</button>${pad}<button>複製連結</button>${pad}</div>
      <p>這是第二段主文內容，持續描述補充，維持足夠長度避免整個容器被當成空殼或雜訊處理。</p>
      </article>`);
    const doc = window.document;
    const art = doc.getElementById('art');
    const bar = doc.getElementById('bar');
    const raw = (bar.textContent || '').length;
    const normed = (bar.textContent || '').replace(/\s+/g, ' ').trim().length;
    assert.ok(raw > 80, `fixture raw 長度 ${raw} 必須 > 80（重現縮排灌爆）`);
    assert.ok(normed <= 80, `fixture norm 長度 ${normed} 必須 <= 80`);
    window.__JRead.cleaner.clean(art);
    assert.strictEqual(bar.getAttribute('data-jread-hidden'), '1',
      '縮排灌爆 raw 長度的 action bar 沒被清——ACTION_TEXT_MAX 門檻必須量 norm() 後長度');
  });

  it('結構 forcing：shell 門檻與 ACTION_TEXT_MAX 都必須量 norm()', () => {
    const m = CLEANER_SRC.match(/function hideInsideArticleActionRows[\s\S]*?\n  \}/);
    assert.ok(m, '抓不到 hideInsideArticleActionRows');
    assert.match(m[0], /const selfText = norm\(el\.textContent\)/,
      'shell 門檻（<20）必須量 norm() 後長度');
    assert.match(m[0], /const text = norm\(el\.textContent\)/,
      'ACTION_TEXT_MAX 門檻必須量 norm() 後長度');
  });
});
