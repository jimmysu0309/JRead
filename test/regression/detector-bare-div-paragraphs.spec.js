// JRead — regression spec: 裸 div 段落納入 heuristic signal（v1.7.22）
// -----------------------------------------------------------------------------
// Forcing function for detector `isParagraphLikeDiv` + SIGNAL_SEL 含 div。
//
// Trigger: 2026-07-30 Jimmy 回報 upmedia.mg /tw/commentary/columnists/262918
// 「頁面下方有許多雜訊」。cage probe 實證：整篇主文（.news-box-text，7,966 字、
// linkDensity 0.004）的段落載體全是無 class 裸 <div>（42 段、0 個 <p>）——
// SIGNAL_SEL 原本只認 p / heading / li 等語意標籤，主文容器一分都拿不到、
// 不進候選；唯一過 MIN_TEXT_LEN 的候選是 footer 含 <p> 的公司簡介 div.row
// （396 字）→ heuristic 拍板 footer → promoteForTitle 把容器升到與標題 h1
// 的 LCA = #wrapper，整頁 chrome（header / modal / 廣告 / footer / copyright）
// 全被當主文渲染。症狀不是 cleaner 漏網、是 detector 選錯 + promote 放大。
//
// 規則（結構通則，Readability.js 原作 div-to-p 同精神，不綁站點 / class）：
// div 若不含任何 block-level 子元素（只有文字 + inline 標記）＝「拿 div 當
// <p> 用」的段落，納入 signal 計分；含 block 子元素的 div 是容器、不算
// signal（否則巢狀 wrapper 層層自我灌分）。
//
// 驗收層次：本 spec 驗 jsdom 端 detect() 選擇；真實 Chrome 端 2026-07-30
// cage probe 重放實證（div signal 後主文 wrapper 434 分 vs footer 6.3 分，
// ratio 1.55 不膠著）。
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

function load() {
  return loadFixtureWithScripts({
    fixturePath: path.join(__dirname, 'fixtures', 'bare-div-paragraph-article.html'),
    scripts: ['detector']
  });
}

describe('detector — 裸 div 段落 signal（v1.7.22）', () => {
  it('(a) 主文段落全為裸 div 的頁面：detect() 必須選中主文、不可含 footer 簡介區', () => {
    const env = load();
    const detected = env.NS.detector.detect();
    assert.ok(detected && detected.el, '主文段落是裸 div 也必須偵測得到');
    const para = env.document.querySelector('[data-test="para-1"]');
    const footer = env.document.querySelector('[data-test="footer-intro"]');
    assert.ok(detected.el.contains(para), '偵測結果必須涵蓋主文段落');
    assert.ok(!detected.el.contains(footer),
      '偵測結果不可涵蓋 footer 公司簡介（誤選 footer 後 promote 會放大到整頁 wrapper）');
  });

  it('(b) fixture 前提：主文容器 0 個 <p>、footer 競爭者字數過 MIN_TEXT_LEN', () => {
    const env = load();
    const root = env.document.querySelector('[data-test="content-root"]');
    assert.strictEqual(root.querySelectorAll('p').length, 0,
      '主文容器不可含 <p>（裸 div 段落是本 spec 驗的前提）');
    assert.ok(root.textContent.replace(/\s+/g, '').length >= 200,
      '主文字數須過 MIN_TEXT_LEN');
    const footer = env.document.querySelector('[data-test="footer-intro"]');
    assert.ok(footer.textContent.replace(/\s+/g, '').length >= 200,
      'footer 簡介須過 MIN_TEXT_LEN（否則驗不到「footer 是合法候選但輸給主文」）');
  });
});
