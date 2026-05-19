// JRead — substack reader hub 標題不可消失 regression（v0.7.140）
//
// 對應 bug：https://substack.com/home/post/p-188798414 reader mode 啟動後標題
// 整段（含 publication meta / 標題 <a> / byline / description）連坐消失。
//
// 根因（已 chrome-in-chrome probe 確認）：cleaner 的 hideInsideArticleByHeadingText
// 掃 div/span/p direct text 命中 NOISE_HEADING_TEXT_RE，substack 的 subscribe
// button 是 `<button class="subscribe-btn"><span class="button-text">Subscribe
// </span></button>`，內層 span direct text == "Subscribe"，命中 `^subscribe$`
// rule。span 沒 section/aside 祖先 → 走 walk-up fallback findSafeWrapperForHeading。
// substack 標題用 <a>（非 <h1>）、整個標題區塊沒任何 <p>（byline/description
// 用 div）、class 全是 emotion hash 不含 title-anchor token，**三道 anchor
// guard 全失效** → walk-up 一路走到 article direct child wrapper 才停 → hide
// 整段標題 + meta + byline + description。
//
// 修法：hideInsideArticleByHeadingText 加 `if (h.closest('button')) continue`
// pre-filter。button text 是 CTA word（Subscribe/Follow/Read more 等）撞 heading
// keyword 是結構性 false positive；button 本身會被 hideInsideArticleAllButtons
// 清，不需要 heading rule 走 walk-up。結構性通則，跨站適用、不綁 substack。
//
// 本 spec 是 forcing function：
//   - 標題 <a> 的祖先 chain 全部 visible（不可有 data-jread-hidden）
//   - subscribe-widget 仍被 hide（其他 rule 處理：NOISE_KEYWORD_RE 命中 subscribe）
//   - subscribe-btn 仍被 hide（hideInsideArticleAllButtons）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'substack-reader-hub-title-button-text.html');

describe('cleaner — substack reader hub 標題不可消失（v0.7.140）', () => {
  let window, document, articleEl, hidden;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    const detected = window.__JRead.detector.detect();
    assert.ok(detected && detected.el,
      'detector 應該命中 fixture 內的 <article>（textLen > MIN_TEXT_LEN 200）');
    articleEl = detected.el;
    assert.strictEqual(articleEl.tagName, 'ARTICLE');
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  it('detector 選到的 articleEl 是 fixture 內唯一的 <article>', () => {
    const article = document.querySelector('article');
    assert.strictEqual(articleEl, article);
  });

  it('標題 <a> 自己未被 hide', () => {
    const titleA = document.querySelector('[data-test="article-title"]');
    assert.ok(titleA, 'fixture 必須含 [data-test="article-title"]');
    assert.notStrictEqual(titleA.dataset.jreadHidden, '1',
      '標題 <a> 自己不可被 hide');
  });

  it('標題 <a> 的祖先 chain 全部不可被 hide（v0.7.140 核心保護點）', () => {
    const titleA = document.querySelector('[data-test="article-title"]');
    const hiddenAncestors = [];
    let cur = titleA;
    while (cur && cur !== articleEl.parentElement) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') {
        hiddenAncestors.push({
          tag: cur.tagName,
          className: (typeof cur.className === 'string' ? cur.className : '').slice(0, 100),
          dataTest: cur.dataset.test || ''
        });
      }
      cur = cur.parentElement;
    }
    assert.deepStrictEqual(hiddenAncestors, [],
      '標題 <a> 祖先鏈不可有任何 data-jread-hidden="1" 元素。' +
      '若有，代表 hideInsideArticleByHeadingText 的 walk-up fallback 把標題' +
      'wrapper 連帶 hide（root cause：subscribe-btn 內 <span>Subscribe</span>' +
      '命中 heading rule，cleaner 未 skip button 內 element）。' +
      `實際 hidden ancestors: ${JSON.stringify(hiddenAncestors)}`
    );
  });

  it('標題 wrapper (article first direct child) 未被 hide', () => {
    const wrapper = document.querySelector('[data-test="title-wrapper"]');
    assert.ok(wrapper);
    assert.notStrictEqual(wrapper.dataset.jreadHidden, '1',
      '標題 wrapper 是 article 第一個 direct child，含整段標題 + meta + byline + description，不可被 walk-up fallback 誤殺');
  });

  it('subscribe-widget div 仍被 hide（NOISE_KEYWORD_RE 命中 subscribe）', () => {
    const widget = document.querySelector('[data-test="subscribe-widget"]');
    assert.ok(widget);
    assert.strictEqual(widget.dataset.jreadHidden, '1',
      'subscribe-widget class 含 subscribe keyword，必須仍被 hideInsideArticleByKeyword 清掉');
  });

  it('subscribe-btn button 仍被 hide（hideInsideArticleAllButtons）', () => {
    const btn = document.querySelector('[data-test="subscribe-btn"]');
    assert.ok(btn);
    assert.strictEqual(btn.dataset.jreadHidden, '1',
      'subscribe-btn 是 <button>，必須被 hideInsideArticleAllButtons 無條件 hide');
  });

  it('主文 p 段落全部保留（detector 選到 article，cleaner 不可誤殺主文）', () => {
    const ps = document.querySelectorAll('[data-test^="body-p-"]');
    assert.ok(ps.length >= 4, 'fixture 必須含 4 個 body p 段落');
    for (const p of ps) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 ${p.dataset.test} 不可被 hide`);
    }
  });
});
