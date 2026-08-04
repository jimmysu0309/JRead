// JRead — regression spec: 文字包在 inline 子孫裡的段落 div → <p>（v1.7.36）
//
// Trigger: Jimmy 2026-08-04 截圖回報——x.com longform 貼文
// （https://x.com/jeremygiffon/status/2079280687346295184/）翻譯後送到 Readwise
// Reader，段落間距全消失黏成一大坨。
//
// 根因（Readwise API 取回該文件 html_content 直接確認，非推測）：X longform 用
// Draft.js render，段落形態是
//   div.longform-unstyled > div.public-DraftStyleDefault-block
//     > span[data-offset-key] > span[data-text] > 文字
// 段落 div 自己零 direct text node。v1.7.21 的 markParagraphDivs predicate 要求
// 「直接含 text node」→ 整篇零命中，沒有任何 div 被轉成 <p>；段距只靠 X 的 inline
// margin-bottom:16px，被 Readwise sanitizer 剝掉 → 全黏在一起。
//
// 修法（結構性通則，非站點特判）：predicate 改成「整棵子樹只有 inline 元素 +
// 子樹文字 >= 4 字」＝ leaf block 只含 inline 內容 ＝ 段落。同時補兩個 guard：
//   - inline style 宣告 display: inline* / contents / none 的 div 不是 block box
//   - 深掃子孫（`<a><div>` 在 HTML5 合法，只看直系 children 會漏）
//
// 本 spec 驗 predicate；轉 <p> 的 wiring forcing 在
// readwise-bare-div-paragraphs.spec.js (C)。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const NAMESPACE_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'namespace.js'), 'utf8');
const FBPOST_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'fb-post.js'), 'utf8');
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'readwise-inline-wrapped-paragraphs.html'), 'utf8');

function setup() {
  const dom = new JSDOM(FIXTURE, {
    url: 'https://x.com/someone/status/1234567890',
    runScripts: 'outside-only'
  });
  const { window } = dom;
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }) } };
  window.eval(NAMESPACE_SRC);
  window.eval(FBPOST_SRC);
  return { window, document: window.document, NS: window.__JRead };
}

describe('readwise — inline 子孫包文字的段落 div → <p>（v1.7.36）', () => {
  it('(A) 零 direct text node、文字包在巢狀 span 裡的段落 div 必須標記', () => {
    const env = setup();
    env.NS.fbPost.markParagraphDivs(env.document.getElementById('story'));
    for (const id of ['para-1', 'para-2']) {
      assert.strictEqual(
        env.document.getElementById(id).getAttribute('data-jread-fb-para'), '1',
        `${id}（span > span > 文字）必須被標記為段落`);
    }
  });

  it('(B) 外層 wrapper（有 block child）不可標記——避免 <p> 含 block child', () => {
    const env = setup();
    env.NS.fbPost.markParagraphDivs(env.document.getElementById('story'));
    for (const id of ['para-wrap-1', 'para-wrap-2', 'figure-wrap']) {
      assert.strictEqual(
        env.document.getElementById(id).getAttribute('data-jread-fb-para'), null,
        `${id} 含 block child，不可標記`);
    }
  });

  it('(C) display: contents / inline* 的 div 不是 block box，不可標記', () => {
    const env = setup();
    env.NS.fbPost.markParagraphDivs(env.document.getElementById('story'));
    assert.strictEqual(
      env.document.getElementById('meta-contents').getAttribute('data-jread-fb-para'), null,
      'display:contents 的頁尾 meta 列不可轉段落');

    // 同結構、只把 display 換成一般 block → 必須標記（證明 (C) 擋的是 display
    // 而不是「兩個 span」這個形狀）
    const env2 = setup();
    const el = env2.document.getElementById('meta-contents');
    el.style.setProperty('display', 'block', 'important');
    env2.NS.fbPost.markParagraphDivs(env2.document.getElementById('story'));
    assert.strictEqual(el.getAttribute('data-jread-fb-para'), '1',
      '同結構改成 display:block 後必須標記（控制組）');
  });

  it('(D) 直系 children 全 inline 但 <a> 內藏 block 子孫 → 深掃要擋下', () => {
    const env = setup();
    env.NS.fbPost.markParagraphDivs(env.document.getElementById('story'));
    assert.strictEqual(
      env.document.getElementById('deep-block').getAttribute('data-jread-fb-para'), null,
      '<a><div>…</div></a>（HTML5 合法）的外層 div 不可標記');
  });

  it('(E) 文字不足 4 字的 div 不標記（分隔點 / icon 殼）', () => {
    const env = setup();
    env.NS.fbPost.markParagraphDivs(env.document.getElementById('story'));
    assert.strictEqual(
      env.document.getElementById('short').getAttribute('data-jread-fb-para'), null,
      '只有一個「·」的 div 不可當段落');
  });
});
