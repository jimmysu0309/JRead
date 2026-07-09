// JRead — promoteOverwideImages 多 carousel 支援 regression spec（v1.6.28）
//
// 背景（v1.6.24 review 遺留 #11，Jimmy 2026-07-09 指示修）：v0.7.203 原版處理
// 完第一個命中的超寬 carousel 就 break（考古：原 commit 情境只有 yamatomichi
// 單一 hero Swiper、break 無註解＝「做完眼前案例就停」而非文件化決策）——同頁
// 第二個獨立 carousel 不處理、繼續超寬破版。
//
// 修法：break 改計數上限 OVERWIDE_PROMOTE_MAX = 5（保留爆炸半徑保守精神——
// 誤判簽名時最多藏 5 個分支，不會整頁連環藏）。同一 carousel 內其餘 img 由
// 迴圈開頭 closest('[data-jread-hidden]') guard 自動略過。
//
// Chromium probe 實證（yamatomichi journals/345229，2026-07-09）：真實 Swiper
// hero + clone 出的獨立第二分支，兩個都被 promote（各 608x342 可見）、容器
// 正確 hide；probe 第一輪並實證「同分支內的第二 carousel 會被連帶藏掉、
// 不重複 promote」（dedup guard 生效）。
//
// 訊號層次：jsdom 驗「規則選到哪些 img、promote / hide / cap / 還原結構正確」；
// 不驗真實 Swiper runtime 的 inline width 時序（probe / harness 層）。

const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

function buildEnv(carouselCount, { imgsPerCarousel = 1 } = {}) {
  let branches = '';
  for (let i = 0; i < carouselCount; i++) {
    let imgs = '';
    for (let j = 0; j < imgsPerCarousel; j++) {
      imgs += `<img id="car${i}-img${j}" src="https://example.com/c${i}-${j}.jpg" width="800" height="400">`;
    }
    branches += `<div class="widget" id="branch${i}"><div class="swiper" style="width: 912px" id="swiper${i}">${imgs}</div></div>`;
  }
  const dom = new JSDOM(`<!DOCTYPE html><html><body><article id="art">
    <h1>多 carousel 測試</h1>
    <p>第一段內文，長度足夠避免被空容器類規則誤判，描述兩個輪播之間的內容。</p>
    ${branches}
    <div id="narrow"><img id="normal-img" src="https://example.com/n.jpg" width="800" height="400"></div>
    <p>末段內文，同樣保持足夠長度，確認一般內容圖與段落不受本規則影響。</p>
    </article></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
  window.eval(SRC.namespace);
  window.eval(SRC.cleaner);
  return { window, doc: window.document, art: window.document.getElementById('art'), NS: window.__JRead };
}

describe('promoteOverwideImages 多 carousel（v1.6.28）', () => {
  it('兩個獨立 carousel 都被 promote + 容器 hide（v0.7.203 只處理第一個的修正）', () => {
    const { doc, art, NS } = buildEnv(2);
    const hidden = NS.cleaner.clean(art);
    const promoted = doc.querySelectorAll('[data-jread-promoted-img]');
    assert.strictEqual(promoted.length, 2, '兩個 carousel 必須各 promote 一張');
    assert.strictEqual(doc.getElementById('branch0').dataset.jreadHidden, '1');
    assert.strictEqual(doc.getElementById('branch1').dataset.jreadHidden, '1');
    NS.cleaner.restore(hidden);
  });

  it('同一 carousel 內多張 img 只 promote 一張（容器 hide 後其餘由 guard 略過）', () => {
    const { doc, art, NS } = buildEnv(1, { imgsPerCarousel: 3 });
    const hidden = NS.cleaner.clean(art);
    assert.strictEqual(doc.querySelectorAll('[data-jread-promoted-img]').length, 1,
      '同容器只能 promote 一張、不可三張全複製');
    NS.cleaner.restore(hidden);
  });

  it('計數上限：7 個 carousel 只處理 OVERWIDE_PROMOTE_MAX = 5 個（爆炸半徑 guard）', () => {
    const { doc, art, NS } = buildEnv(7);
    const hidden = NS.cleaner.clean(art);
    assert.strictEqual(doc.querySelectorAll('[data-jread-promoted-img]').length, 5,
      '誤判簽名的最壞情況只藏 5 個分支');
    assert.notStrictEqual(doc.getElementById('branch6').dataset.jreadHidden, '1',
      '第 6 個之後不處理');
    NS.cleaner.restore(hidden);
  });

  it('窄容器的一般內容圖不受影響', () => {
    const { doc, art, NS } = buildEnv(2);
    const hidden = NS.cleaner.clean(art);
    assert.notStrictEqual(doc.getElementById('narrow').dataset.jreadHidden, '1');
    assert.notStrictEqual(doc.getElementById('normal-img').dataset.jreadHidden, '1');
    NS.cleaner.restore(hidden);
  });

  it('restore 可逆：promote clone 全移除、容器全還原', () => {
    const { doc, art, NS } = buildEnv(2);
    const hidden = NS.cleaner.clean(art);
    NS.cleaner.restore(hidden);
    assert.strictEqual(doc.querySelectorAll('[data-jread-promoted-img]').length, 0,
      'restore 後 clone 必須全移除');
    assert.notStrictEqual(doc.getElementById('branch0').dataset.jreadHidden, '1');
    assert.notStrictEqual(doc.getElementById('branch1').dataset.jreadHidden, '1');
  });
});
