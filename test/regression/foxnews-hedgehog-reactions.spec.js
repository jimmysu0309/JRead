// JRead — regression spec: Fox News 互動 widget custom element 移除
// （<hedgehog-reactions> / <hedgehog-comment-embed>，v1.6.18）
//
// Trigger: foxnews.com 文首 byline 下反應列（👍/爆米花/國旗/👎）+ 留言嵌入殘留
//   （Jimmy 2026-07-08 截圖回報「那些讚及爆米花的 icon 請拿掉」）。
// Root cause: 反應列是 custom element `<hedgehog-reactions>` / `<hedgehog-comment-embed>`，
//   無 class、id 是 UUID → markerOf（class+id）keyword 規則全數漏網。
// 修法: hideInsideArticleWidgetCustomElements——custom element（hyphenated tag）tag 名
//   帶 reaction(s)/comment(s)/vote 等互動 widget 語意即 hide。內容型 custom element
//   （<mdn-code-example>）tag 不帶這些 token → 不誤傷。
//
// Forcing functions:
//   (a) <hedgehog-reactions> + <hedgehog-comment-embed> 被 hide
//   (b) 內容型 <mdn-code-example> 與主文 p 不被誤殺（tag 訊號精準）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'foxnews-hedgehog-reactions.html');

describe('cleaner — Fox News 互動 widget custom element 移除', () => {
  let document;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    const articleEl = document.querySelector('article');
    assert.ok(articleEl, 'fixture 須含 <article>');
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('(a) <hedgehog-reactions> 反應列被 hide', () => {
    const el = document.querySelector('hedgehog-reactions');
    assert.ok(el, 'fixture 須含 <hedgehog-reactions>');
    assert.strictEqual(el.dataset.jreadHidden, '1',
      '<hedgehog-reactions> tag 名帶 reactions → 必須被 hideInsideArticleWidgetCustomElements hide');
  });

  it('(a) <hedgehog-comment-embed> 留言嵌入被 hide', () => {
    const el = document.querySelector('hedgehog-comment-embed');
    assert.ok(el, 'fixture 須含 <hedgehog-comment-embed>');
    assert.strictEqual(el.dataset.jreadHidden, '1',
      '<hedgehog-comment-embed> tag 名帶 comment → 必須被 hide');
  });

  it('(a) .hedgehog-container 薄 wrapper 隨之收合（避免 min-height/margin 殘留空白）', () => {
    const el = document.getElementById('hh-container');
    assert.ok(el, 'fixture 須含 .hedgehog-container');
    assert.strictEqual(el.dataset.jreadHidden, '1',
      '.hedgehog-container 唯一內容是已隱藏的 widget custom element → 必須被 collapse，' +
      '否則 wrapper 自身 min-height/margin 在 byline 與內文間留下空白');
  });

  it('(b) 內容型 <mdn-code-example> 不被誤殺（tag 訊號精準）', () => {
    const el = document.getElementById('content-widget');
    assert.ok(el, 'fixture 須含 <mdn-code-example>');
    assert.notStrictEqual(el.dataset.jreadHidden, '1',
      '<mdn-code-example> tag 不帶反應/留言 token → 不可被 hide');
    const pre = document.getElementById('content-pre');
    assert.notStrictEqual(pre.dataset.jreadHidden, '1', '內容型 widget 內容不可被 hide');
  });

  it('(b) 主文段落保留', () => {
    for (const id of ['body-1', 'body-2']) {
      const p = document.getElementById(id);
      assert.ok(p, `fixture 須含 #${id}`);
      assert.notStrictEqual(p.dataset.jreadHidden, '1', `#${id} 主文段落不可被 hide`);
    }
  });
});
