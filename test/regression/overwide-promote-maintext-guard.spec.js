// JRead — promoteOverwideImages 主文 wrapper 誤殺 guard regression spec（v1.7.27）
//
// 背景（news.agentm.tw/362442 實案，2026-07-31）：WordPress classic editor 產生
// `<div class="wp-caption" style="width: 760px">`（圖寬 750 + 10px，靜態 HTML
// 自帶）。760 > MAX_CARD(720) 命中 overwide 簽名 → hide 目標一路升層到
// articleEl 的 direct child——但該站整篇內文（6K 字）都在唯一的
// `article > div.container` 裡 → 整篇被 hide，reader card 只剩標題 + clone 圖。
//
// 修法（結構性通則）：hide 目標 direct child 的 normalized 文字量 >=
// OVERWIDE_HIDE_TEXT_MAX(300) ＝主文 wrapper 而非 carousel 殼 → 不 promote
// 不 hide，改「拆彈」：中和 overwideAncestor 的 inline width
// （width:auto + max-width:100% !important），img 回歸正常縮放。
//
// 訊號層次：jsdom 驗「guard 判定 + 拆彈樣式 + 可逆性」；不驗真實 viewport 下
// img rendered 寬度收進 card（probe / harness 層，2026-07-31 Chromium 實證
// img 576px < card 720、內文可見、零水平溢出）。

const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

const LONG_TEXT = '三千年前，一位吟遊詩人坐在愛琴海邊，把一個男人的回家之路唱成了史詩。'.repeat(8);

// mainTextInContainer=true：整篇內文與 overwide wrapper 同住 articleEl 唯一
// direct child（agentm 結構）；false：overwide wrapper 是獨立空殼分支（原
// yamatomichi carousel 結構，promote+hide 行為必須維持）
function buildEnv({ mainTextInContainer }) {
  const overwide = '<div id="figwrap" style="width: 760px"><img id="hero" src="https://example.com/hero.jpg" width="750" height="422"><p>圖說短文字</p></div>';
  const body = mainTextInContainer
    ? `<div id="container"><h2>段落標題</h2><p>${LONG_TEXT}</p>${overwide}<p>${LONG_TEXT}</p></div>`
    : `<div id="container">${overwide}</div><p>${LONG_TEXT}</p>`;
  const dom = new JSDOM(`<!DOCTYPE html><html><body><article id="art">
    <h1>主文 wrapper 誤殺 guard 測試</h1>
    ${body}
    </article></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
  window.eval(SRC.namespace);
  window.eval(SRC.cleaner);
  return { window, doc: window.document, art: window.document.getElementById('art'), NS: window.__JRead };
}

describe('promoteOverwideImages 主文 wrapper 誤殺 guard（v1.7.27）', () => {
  it('內文 wrapper 含 overwide 圖：不 hide 主文、不 promote、中和 inline width', () => {
    const { doc, art, NS } = buildEnv({ mainTextInContainer: true });
    const hidden = NS.cleaner.clean(art);
    const container = doc.getElementById('container');
    assert.notStrictEqual(container.dataset.jreadHidden, '1',
      '含主文的 direct child 絕不可 hide（agentm 整篇消失實案）');
    assert.strictEqual(doc.querySelectorAll('[data-jread-promoted-img]').length, 0,
      'guard 命中時不 promote clone');
    const fig = doc.getElementById('figwrap');
    assert.strictEqual(fig.style.getPropertyValue('width'), 'auto', '拆彈：width 中和為 auto');
    assert.strictEqual(fig.style.getPropertyPriority('width'), 'important');
    assert.strictEqual(fig.style.getPropertyValue('max-width'), '100%');
    NS.cleaner.restore(hidden);
  });

  it('restore 可逆：中和的 inline width 還原為原始值', () => {
    const { doc, art, NS } = buildEnv({ mainTextInContainer: true });
    const hidden = NS.cleaner.clean(art);
    NS.cleaner.restore(hidden);
    const fig = doc.getElementById('figwrap');
    assert.strictEqual(fig.style.getPropertyValue('width'), '760px',
      'restore 後原站 inline width 必須回復');
    assert.strictEqual(fig.style.getPropertyPriority('width'), '');
    assert.strictEqual(fig.style.getPropertyValue('max-width'), '');
  });

  it('對照組：低文字 carousel 殼分支維持 promote + hide（不迴歸 yamatomichi 行為）', () => {
    const { doc, art, NS } = buildEnv({ mainTextInContainer: false });
    const hidden = NS.cleaner.clean(art);
    assert.strictEqual(doc.getElementById('container').dataset.jreadHidden, '1',
      '空殼 carousel 分支照舊 hide');
    assert.strictEqual(doc.querySelectorAll('[data-jread-promoted-img]').length, 1,
      '空殼分支照舊 promote 一張');
    NS.cleaner.restore(hidden);
  });
});
