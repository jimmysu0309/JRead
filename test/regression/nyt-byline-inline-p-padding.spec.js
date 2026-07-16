// JRead — regression spec: inline-flow <p> 豁免水平 padding reset（v1.7.8）
// -----------------------------------------------------------------------------
// Forcing function for styler `markInlineFlowParagraphs` + v0.7.201 規則的
// :not(INLINE_FLOW_P_ATTR) 豁免。
//
// Trigger: Jimmy 2026-07-16 回報 NYT mike-d-new-album byline 黏字
// 「By Ben SisarioVisuals by Ryan Lowry」。cage live probe 實證根因：NYT byline
// 把兩段輸出成相鄰 inline-block <p>（React render、之間無空白 text node），
// 視覺分隔完全靠站方 `.css-1xuzukf { padding-right: 12px }`；v0.7.201 的
// `html [data-jread-active="1"] p { padding-left/right: 0 !important }`
// （The Register 多欄內縮 220px 修法）把分隔 padding 清掉 → 黏字。
//
// 規則（結構通則，不綁站點 / class）：多欄內縮只可能發生在 block-level p
// （水平 padding 內縮的前提是元素撐滿容器寬）；computed display 為 inline*
// 的 p 參與 inline 流動、水平 padding 是分隔用途 → 標 INLINE_FLOW_P_ATTR
// 豁免。The Register 的 block p 不受影響（負控制）。
//
// 驗證層次：本 spec 驗「標記命中對象 + 注入 CSS selector 帶豁免 + restore
// 移除標記」（jsdom 層）。真實 Chrome 的 computed padding 生效由 cage live
// probe 完成（2026-07-16 實測豁免後 byline p padding-right 12px 保留、分隔恢復）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'nyt-byline-inline-p-padding.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

describe('styler — inline-flow <p> 豁免水平 padding reset（v1.7.8）', () => {
  let env, document, articleEl, css, snapshot;

  before(() => {
    env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'styler'],
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.querySelector('article');
    assert.ok(articleEl, 'fixture 須含 <article>');
    snapshot = env.NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const styleEl = document.getElementById('__jread-style');
    assert.ok(styleEl, 'styler 必須注入 __jread-style');
    css = styleEl.textContent;
  });

  it('(a) inline-block byline <p> 被標記 data-jread-inline-flow-p', () => {
    for (const key of ['byline-p-1', 'byline-p-2']) {
      const p = articleEl.querySelector(`[data-test="${key}"]`);
      assert.strictEqual(p.getAttribute('data-jread-inline-flow-p'), '1',
        `${key}（display:inline-block）必須被標記豁免`);
    }
  });

  it('(b) 負控制：block-level 主文 <p> 不被標記（The Register 保護不退步）', () => {
    for (const key of ['body-p-1', 'body-p-2', 'body-p-3']) {
      const p = articleEl.querySelector(`[data-test="${key}"]`);
      assert.strictEqual(p.getAttribute('data-jread-inline-flow-p'), null,
        `${key}（block p）不可被標記——必須繼續吃 v0.7.201 水平 padding reset`);
    }
  });

  it('(c) 注入 CSS 的水平 padding reset 規則帶 :not 豁免 selector', () => {
    const ruleMatch = css.match(
      /\[data-jread-active="1"\]\s*p:not\(\[data-jread-inline-flow-p="1"\]\)\s*\{[^}]*padding-left:\s*0\s*!important[^}]*padding-right:\s*0\s*!important/
    );
    assert.ok(ruleMatch,
      'padding-left/right: 0 規則必須掛在 p:not([data-jread-inline-flow-p="1"]) 上');
  });

  it('(d) 標記的 byline <p> 原站 inline padding 不被 JRead 寫入覆蓋', () => {
    const p = articleEl.querySelector('[data-test="byline-p-1"]');
    assert.strictEqual(p.style.getPropertyValue('padding-right'), '12px',
      'byline p 的原 inline padding-right 必須原樣保留（JRead 不寫入 inline 覆蓋）');
    assert.strictEqual(p.style.getPropertyPriority('padding-right'), '',
      'byline p 的 padding-right 不可被加 !important（未被任何 JS pass 改寫）');
  });

  it('(e) restore：退出 reader mode 後標記移除', () => {
    env.NS.styler.restore(articleEl, snapshot);
    for (const key of ['byline-p-1', 'byline-p-2']) {
      const p = articleEl.querySelector(`[data-test="${key}"]`);
      assert.strictEqual(p.getAttribute('data-jread-inline-flow-p'), null,
        `${key} 的豁免標記必須在 restore 時移除`);
    }
  });
});
