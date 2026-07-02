// JRead — chinatimes 文末「Prism intelligence」AI 推薦 widget 整塊清除
//（v1.6.11，page rounds chinatimes CT3/CT4 殘留實測）
//
// 實測（2026-07-02 page rounds）：chinatimes 文末殘留「Prism intelligence」AI 推薦
// widget——DIV#prism-widget-container，含「您的專屬推薦：深度解析」heading +
// AI Q&A ↗ 連結（item-text）。residual audit 命中 '推薦' 但 cleaner 漏清：
//   - 標題「您的專屬推薦」不在 NOISE_HEADING_TEXT_RE（只有 推薦閱讀/人氣推薦 等變體）
//   - 且標題是 DIV.interest-header 非 h2-h4，heading walk-up 不覆蓋
// 修法：加 `prism-widget` strong token（與 taboola/outbrain/popin/dianomi 同屬
// 第三方推薦 widget 產品名 token 慣例，比對 widget 容器命名而非 hostname）。
// `-widget` 後綴避開 PrismJS 語法高亮的 `prism` code class 碰撞。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'chinatimes-prism-widget.html');

function runClean() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1280, height: 900 },
    pretendToBeVisual: true
  });
  const articleEl = env.document.getElementById('article-body');
  articleEl.setAttribute('data-jread-active', '1');
  env.NS.cleaner.clean(articleEl, []);
  return env.document;
}

function isHidden(el) {
  let cur = el;
  while (cur) {
    if (cur.dataset && cur.dataset.jreadHidden === '1') return true;
    if (cur.style && cur.style.display === 'none') return true;
    cur = cur.parentElement;
  }
  return false;
}

describe('cleaner — chinatimes Prism intelligence AI 推薦 widget（v1.6.11）', () => {
  let document;
  before(() => { document = runClean(); });

  it('整個 #prism-widget-container 必須被 hide', () => {
    const w = document.getElementById('prism-widget-container');
    assert.ok(w, 'fixture 應有 #prism-widget-container');
    assert.ok(isHidden(w),
      '#prism-widget-container 必須整塊被 hide——prism-widget strong token 命中 id');
  });

  it('widget 內的 AI Q&A 推薦連結與「您的專屬推薦」標題全部不可見', () => {
    for (const el of document.querySelectorAll('#prism-widget-container .item-text, #prism-widget-container .interest-header')) {
      assert.ok(isHidden(el),
        `widget 內容「${(el.textContent||'').trim().slice(0,20)}」必須隨容器一起 hide`);
    }
  });

  it('主文長段落不可被誤殺（strong token 只命中 widget、不波及主文）', () => {
    const paras = document.querySelectorAll('.article-body > p');
    assert.ok(paras.length >= 2, 'fixture 應有主文段落');
    for (const p of paras) {
      assert.ok(!isHidden(p),
        `主文段落「${(p.textContent||'').trim().slice(0,24)}…」不可被 hide`);
    }
  });
});
