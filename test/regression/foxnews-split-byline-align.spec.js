// JRead — regression spec: Fox News 分離式 byline 作者列納入正規化（v1.6.18）
//
// Trigger: foxnews.com byline 區「作者列置中、日期列靠左」對齊不一致（Jimmy
//   2026-07-08 回報「byline 排版亂七八糟」）。
// Root cause: header（text-align:center）下作者列（.author-byline）與日期列是分離
//   sibling，author+date 的 LCA=header 含 h1/h2 → v1.6.10 heading guard 退回只用
//   dateEl → 只有日期列被標 byline 左對齊，作者列維持置中。
// 修法: date byline root 的「相鄰前一個 visible sibling」若是純作者 meta 列（不含
//   heading / 大圖、含作者訊號、visible 文字 <= 200）也標成 byline root。
//
// Forcing functions:
//   (a) 日期列被標 byline root（既有行為）
//   (b) 相鄰作者列（.author-byline）也被標 byline root（新行為；拿掉擴充 → fail）
//   (c) 含 h1/h2 的 .article-meta-upper 不被標 byline（heading guard 不誤拉）
//   (d) restore 清乾淨

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'foxnews-split-byline-align.html');
const SETTINGS = { theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0 };

function setup() {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 應有 <article>');
  const snapshot = env.NS.styler.apply(articleEl, SETTINGS);
  return { env, articleEl, snapshot };
}
const q = (env, t) => env.document.querySelector(`[data-test="${t}"]`);

describe('styler — Fox News 分離式 byline 作者列納入正規化 (v1.6.18)', () => {

  it('(a) 日期列被標 byline root（既有行為）', () => {
    const { env } = setup();
    const dateRow = q(env, 'date-row');
    assert.strictEqual(dateRow.getAttribute('data-jread-byline'), '1',
      '含 <time> 的日期列必須被標 byline root');
  });

  it('(b) 相鄰作者列 .author-byline 也被標 byline root（新行為）', () => {
    const { env } = setup();
    const authorByline = q(env, 'author-byline');
    assert.strictEqual(authorByline.getAttribute('data-jread-byline'), '1',
      '日期列相鄰前一個作者 meta 列必須也被標 byline root（左對齊一致）；' +
      '拿掉 v1.6.18 相鄰作者列擴充 → 此 assertion fail');
    // 作者列子項被遞迴標成 byline item（.byline-text 含直接文字「By … Fox News」
    // 為 leaf item；headshot 圖為 media item）
    assert.strictEqual(q(env, 'byline-text').getAttribute('data-jread-byline-item'), '1',
      '作者文字列必須被標 byline item');
    assert.ok(authorByline.querySelector('[data-jread-byline-item]'),
      '作者列子樹至少一個 byline item');
  });

  it('(c) 含 h1/h2 的 .article-meta-upper 不被標 byline（heading guard）', () => {
    const { env } = setup();
    assert.strictEqual(q(env, 'meta-upper').getAttribute('data-jread-byline'), null,
      '含標題/副標的 meta-upper 不可被標 byline root');
    assert.strictEqual(q(env, 'title').getAttribute('data-jread-byline-item'), null,
      'h1 標題不可被標 byline item');
    assert.strictEqual(q(env, 'subtitle').getAttribute('data-jread-byline-item'), null,
      'h2 副標不可被標 byline item');
  });

  it('(d) restore 移除所有 byline 標記', () => {
    const { env, articleEl, snapshot } = setup();
    env.NS.styler.restore(articleEl, snapshot);
    assert.ok(!env.document.querySelector('[data-jread-byline]'), 'restore 應移除 byline root 標記');
    assert.ok(!env.document.querySelector('[data-jread-byline-item]'), 'restore 應移除所有 byline item 標記');
  });
});
