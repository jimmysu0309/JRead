// JRead — regression spec: custom element widget 命中 noise keyword（v0.8.122）
//
// Trigger: Jimmy 2026-06-19 autosport.com 回報——送 Readwise 的文末出現問卷招攬
// 「We want to hear from you / Take our survey / - The Autosport.com Team」。
//
// 根因：該 widget 是 web component <msnt-survey-promo class="msnt-survey-promo">，
// class 帶 noise token `promo`，但 hyphenated custom-element tag 不在 CONTAINER_SEL
// （div/section/aside/...）→ hideInsideArticleByKeyword 的容器掃描漏掉 → 不被 hide
// → reader 0 高度看不見、卻殘留進 buildCleanHtml 的 Readwise outerHTML。
//
// 修法：keyword 掃描 candidates 納入 custom element（tagName 含 '-'）。只有 class/id
// 命中 noise keyword 的才 hide → 內容型 web component（<mdn-code-example> 等）不受影響。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'custom-element-promo-keyword.html');

describe('cleaner — custom element 命中 noise keyword（v0.8.122）', () => {
  let document;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    document = env.document;
    const articleEl = document.querySelector('article#story');
    assert.ok(articleEl);
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('<msnt-survey-promo>（custom element + promo keyword）被 hide', () => {
    const promo = document.getElementById('survey-promo');
    assert.ok(promo);
    assert.strictEqual(promo.dataset.jreadHidden, '1',
      'class 含 promo 的 custom element widget 必須被 keyword 掃描命中並 hide');
  });

  it('內容型 custom element（<mdn-code-example>，class 無 noise token）保留', () => {
    const code = document.getElementById('code-widget');
    assert.ok(code);
    assert.notStrictEqual(code.dataset.jreadHidden, '1',
      'class 不含 noise keyword 的 custom element 不可被誤殺');
  });

  it('主文 h1 / p 全保留', () => {
    assert.notStrictEqual(document.querySelector('article#story > h1').dataset.jreadHidden, '1');
    for (const p of document.querySelectorAll('article#story > p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 p 不可被 hide: "${p.textContent.slice(0, 30)}…"`);
    }
  });
});
