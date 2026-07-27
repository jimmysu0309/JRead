// JRead — regression spec: Readwise 匯出裸 div 段落 → <p>（v1.7.21）
//
// Trigger: Jimmy 2026-07-27 截圖回報——archive.ph WSJ 存檔頁（翻譯後）送到
// Readwise Reader 段落間距消失全擠在一起；本地 reader card 間距正常。
//
// 根因：archive.today 改寫頁正文段落是裸 <div>（零 <p>）。本地 reader 靠站方
// style 有間距；匯出端 Readwise sanitizer 剝 inline style、raw 模式（翻譯頁
// should_clean_html=false）又不吃站方 stylesheet → 裸 div 無任何段距。
//
// 修法：buildCleanHtml 在 clone 上重用 fb-post.js markParagraphDivs（單一資料
// 源：「直接含 text node + 無 block child 的 leaf div」才標；v1.7.21 加 pre /
// code 內不標 guard），標記後由既有 2.5 步驟統一轉 <p>，Readwise 以語意辨識
// 段落。cage 實測翻譯頁 62 個段落 div 全數命中 predicate、零 miss。
//
// 本 spec 驗：(A) predicate 對 archive 形態裸 div 段落的標記（jsdom 功能面）
// (B) pre/code guard (C) main.js buildCleanHtml wiring（source-regex forcing，
// 與 readwise-embed-proxy-unwrap.spec.js (H) 同款——buildCleanHtml 是 main.js
// closure、jsdom 不易端到端驅動）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const NAMESPACE_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'namespace.js'), 'utf8');
const FBPOST_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'fb-post.js'), 'utf8');
const MAIN_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'main.js'), 'utf8');
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'readwise-bare-div-paragraphs.html'), 'utf8');

function setup() {
  const dom = new JSDOM(FIXTURE, {
    url: 'https://example.com/archived-story',
    runScripts: 'outside-only'
  });
  const { window } = dom;
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }) } };
  window.eval(NAMESPACE_SRC);
  window.eval(FBPOST_SRC);
  return { window, document: window.document, NS: window.__JRead };
}

describe('readwise — 裸 div 段落匯出 → <p>（v1.7.21）', () => {
  it('(A) archive 形態的裸 div 段落被 markParagraphDivs 標記', () => {
    const env = setup();
    const root = env.document.getElementById('story');
    const count = env.NS.fbPost.markParagraphDivs(root);
    assert.ok(count >= 2, `至少兩個裸 div 段落要被標記（實得 ${count}）`);
    assert.strictEqual(
      env.document.getElementById('para-1').getAttribute('data-jread-fb-para'), '1',
      '純 text node 段落 div 必須標記');
    assert.strictEqual(
      env.document.getElementById('para-2').getAttribute('data-jread-fb-para'), '1',
      '含 inline <a> 的段落 div 必須標記');
    assert.strictEqual(
      env.document.getElementById('wrapper').getAttribute('data-jread-fb-para'), null,
      '含 block child 的 wrapper div 不可標記（轉 p 會違反 HTML 結構）');
  });

  it('(B) pre / code 內的 div-per-line 不標記（guard）', () => {
    const env = setup();
    const root = env.document.getElementById('story');
    env.NS.fbPost.markParagraphDivs(root);
    for (const line of env.document.querySelectorAll('#code-block div')) {
      assert.strictEqual(line.getAttribute('data-jread-fb-para'), null,
        'pre 內 code 行 div 不可標記（轉 p 會給每行 code 加段距）');
    }
  });

  it('(C) forcing：main.js buildCleanHtml 必須在 clone 上呼叫 markParagraphDivs', () => {
    assert.match(MAIN_SRC,
      /NS\.fbPost\.markParagraphDivs\)\s*NS\.fbPost\.markParagraphDivs\(clone\)/,
      'buildCleanHtml 必須對 clone 呼叫 NS.fbPost.markParagraphDivs（通用裸 div 段落 → 2.5 轉 <p>）');
    // 呼叫必須排在 2.5 div → p 轉換之前（querySelectorAll [data-jread-fb-para]）
    const callIdx = MAIN_SRC.indexOf('NS.fbPost.markParagraphDivs(clone)');
    const convertIdx = MAIN_SRC.indexOf("clone.querySelectorAll('[data-jread-fb-para=\"1\"]')");
    assert.ok(callIdx > -1 && convertIdx > -1 && callIdx < convertIdx,
      'markParagraphDivs(clone) 必須排在 fb-para → <p> 轉換之前，否則標記不會被轉換');
  });
});
