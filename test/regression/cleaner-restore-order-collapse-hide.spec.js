// JRead — cleaner restore 順序：collapse 後又被 hide 的元素必須還原到原站值（v0.8.35）
//
// Bug：collapse 類 producer（collapseGridWithHiddenCell / forceMediaContainerBlock 等）
// 先把 container 寫成 display:block !important、原站 inline 快照進 hidden.__styleResets；
// 之後 collapseEmptyWrappersAfterClean 對同一個（已空的）container 跑 hide()——此時
// hide() 快照到的 prevDisplay 是 JRead 自己寫的 'block' + 'important'，不是原站值。
// 舊 restore 順序是「restoreAllStyleResets 先、hidden display 迴圈後」：styleResets
// 先把 display 還原成原站值，hidden 迴圈接著又把 block !important 寫回去——退出
// 閱讀模式後原站 grid/flex container 永久鎖成 display:block !important，layout 壞掉
// 直到 reload（違反可逆性硬規則）。
//
// 修法：hidden display 迴圈先跑（還原到 collapse 後狀態）、restoreAllStyleResets
// 後跑（還原真正原始 inline 值）。反向交錯（先 hide 後 collapse）不存在：所有
// collapse producer 都跳過 jreadHidden === '1' 的元素（cleaner.js 內各 producer
// 迴圈開頭的 dataset guard）。
//
// fixture 為什麼用手工構造的 hiddenEls 而非 end-to-end clean()：
// collapseEmptyWrappersAfterClean 的觸發 gate 在 getBoundingClientRect 門檻
// （EMPTY_COLLAPSE_MIN_HEIGHT/WIDTH），jsdom 無 layout engine、rect 全 0 必然 skip，
// 「collapse → hide 同一元素」的鏈在 jsdom 內無法經 clean() 重現。本 spec 改驗
// restore() 的順序合約：hiddenEls 結構逐欄位複製兩個 producer 的實際寫入行為
// （snapshotStyles 的 {value, priority} 形狀 + hide() 的 {el, prevDisplay,
// prevDisplayPriority} 形狀），任何欄位形狀改動會讓本 spec 同步壞掉而被發現。

const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

function buildEnv(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'chrome-extension://t/' + p } };
  window.eval(SRC.namespace);
  window.eval(SRC.cleaner);
  return { window, document: window.document, NS: window.__JRead };
}

describe('cleaner — restore 順序：collapse 後被 hide 的元素還原到原站 inline 值', () => {
  it('display 先被 collapse 寫成 block !important、再被 hide，restore 後必須是原站 flex（無 important）', () => {
    const { document, NS } = buildEnv(`<!DOCTYPE html><html><body>
      <article id="art"><div id="wrapper" style="display:flex">cell</div></article>
    </body></html>`);
    const wrapper = document.getElementById('wrapper');
    const hidden = [];

    // 1. 模擬 collapse producer：snapshotStyles 形狀快照原站 inline → 寫 block !important
    hidden.__styleResets = [{
      el: wrapper,
      kind: 'container',
      prev: { display: { value: 'flex', priority: '' } },
    }];
    wrapper.dataset.jreadCollapsed = '1';
    wrapper.style.setProperty('display', 'block', 'important');

    // 2. 模擬 collapseEmptyWrappersAfterClean 的 hide()：快照（此時 inline 是
    //    collapse 寫入值）→ 寫 none !important
    hidden.push({
      el: wrapper,
      prevDisplay: wrapper.style.getPropertyValue('display'),          // 'block'
      prevDisplayPriority: wrapper.style.getPropertyPriority('display'), // 'important'
    });
    wrapper.dataset.jreadHidden = '1';
    wrapper.style.setProperty('display', 'none', 'important');

    NS.cleaner.restore(hidden);

    assert.strictEqual(wrapper.style.getPropertyValue('display'), 'flex',
      'restore 後 display 必須是原站 inline 值 flex，不可殘留 collapse 寫入的 block');
    assert.strictEqual(wrapper.style.getPropertyPriority('display'), '',
      'restore 後不可殘留 important priority');
    assert.strictEqual(wrapper.dataset.jreadHidden, undefined, 'jreadHidden 標記必須清除');
    assert.strictEqual(wrapper.dataset.jreadCollapsed, undefined, 'jreadCollapsed 標記必須清除');
  });

  it('純 hide（無 collapse 交錯）round-trip 不受順序調整影響', () => {
    const { document, NS } = buildEnv(`<!DOCTYPE html><html><body>
      <article id="art"><div id="noise" style="display:grid">noise</div></article>
    </body></html>`);
    const noise = document.getElementById('noise');
    const hidden = [];
    hidden.push({ el: noise, prevDisplay: 'grid', prevDisplayPriority: '' });
    noise.dataset.jreadHidden = '1';
    noise.style.setProperty('display', 'none', 'important');

    NS.cleaner.restore(hidden);

    assert.strictEqual(noise.style.getPropertyValue('display'), 'grid');
    assert.strictEqual(noise.style.getPropertyPriority('display'), '');
  });
});
