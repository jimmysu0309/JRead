// JRead — v1.7.41（review 批次 3 C5）：checkDynamicNoise「有 hide 才 return」
// -----------------------------------------------------------------------------
// 根因：多個分支（jwplayer / recommendation / Substack / aside 迴圈）「掃到候選
// 就 return」——即使 hide 函式因 guard（preserved 豁免 / 主文段落雙保險 / 巢狀
// 跳過）什麼都沒 hide 也直接 return。React / Shinkansen 整棵 wrapper re-append
// 時，一個被 guard 擋下的 widget 就讓同批 addedNode 內的 keyword container /
// button / heading 全部跳過。
//
// 修法：各分支改「有 hide 才 return」（hide 函式回傳是否處理、迴圈聚合）；
// aside 迴圈掃完所有 aside 再依結果 return（舊版掃到第一個命中就 return）。
//
// 訊號層次：jsdom 驗動態 observer 的分支邏輯；真實 lazy-inject 時序由 harness 驗。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
);

function setupDom(bodyHtml) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><main>${bodyHtml}</main></body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
  window.eval(SRC.namespace);
  window.eval(SRC.cleaner);
  return window;
}

function stubHeight(el, h) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ top: 0, left: 0, right: 600, bottom: h, width: 600, height: h }),
    configurable: true,
  });
}

describe('cleaner v1.7.41 — 動態批次：guard 擋下的分支不得吞掉同批其他雜訊（C5）', () => {
  it('同批 addedNode：preserved 的 recommendation testid（不 hide）+ keyword <a> → 後者仍要清', async () => {
    const window = setupDom(`
      <article id="art"><h1>主標題</h1>
      <p>這是第一段夠長的主文內容，包含逗號、句號等標點，足夠通過字數門檻與主文保護判定不被誤砍。</p>
      <p>這是第二段主文內容，持續描述補充，維持足夠長度避免整個容器被當成空殼或雜訊處理。</p>
      </article>`);
    const doc = window.document;
    const art = doc.getElementById('art');
    window.__JRead.cleaner.clean(art);

    // 單一 addedNode wrapper 同時含：
    //   (a) figure（PRESERVE_SEL）內的 recommendation testid——hide 函式 preserved
    //       豁免、什麼都沒 hide。舊版此分支仍 return → (b) 永遠清不到。
    //   (b) keyword <a>（share-buttons）——同批注入的其他雜訊
    const wrap = doc.createElement('div');
    const fig = doc.createElement('figure');
    const rec = doc.createElement('div');
    rec.setAttribute('data-testid', 'recommendation-footer');
    rec.textContent = '推薦文章';
    fig.appendChild(rec);
    const img = doc.createElement('img');
    img.src = 'https://x/a.jpg';
    fig.appendChild(img);
    wrap.appendChild(fig);
    const a = doc.createElement('a');
    a.className = 'share-buttons';
    a.href = '#';
    a.textContent = '分享';
    wrap.appendChild(a);
    art.appendChild(wrap);
    await new Promise(r => setTimeout(r, 0));

    assert.notStrictEqual(rec.getAttribute('data-jread-hidden'), '1',
      'preserved（figure 內）的 recommendation testid 不得被 hide（豁免要維持）');
    assert.strictEqual(a.getAttribute('data-jread-hidden'), '1',
      '同批注入的 keyword <a> 沒被清——recommendation 分支 guard 擋下後不得 return 吞掉整批');
  });

  it('同批 addedNode 含兩個次要全文 aside → 兩個都要被 hide（迴圈不可掃到第一個就停）', async () => {
    const window = setupDom(`
      <article id="art"><h1>主標題</h1>
      <p>這是第一段夠長的主文內容，包含逗號、句號等標點，足夠通過字數門檻與主文保護判定不被誤砍。</p>
      <p>這是第二段主文內容，持續描述補充，維持足夠長度避免整個容器被當成空殼或雜訊處理。</p>
      </article>`);
    const doc = window.document;
    const art = doc.getElementById('art');
    window.__JRead.cleaner.clean(art);

    const wrap = doc.createElement('div');
    const mkAside = (title) => {
      const aside = doc.createElement('aside');
      const h1 = doc.createElement('h1');
      h1.textContent = title;
      aside.appendChild(h1);
      const p = doc.createElement('p');
      p.textContent = '下一篇文章的導言段落，無限捲動 lazy 注入的完整內容，文字長度足以觸發次要全文判定的 fallback 訊號。'.repeat(8);
      aside.appendChild(p);
      stubHeight(aside, 900);
      return aside;
    };
    const a1 = mkAside('下一篇：第一篇推薦文章標題');
    const a2 = mkAside('下一篇：第二篇推薦文章標題');
    wrap.appendChild(a1);
    wrap.appendChild(a2);
    art.appendChild(wrap);
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(a1.getAttribute('data-jread-hidden'), '1', '第一個次要全文 aside 必須被 hide');
    assert.strictEqual(a2.getAttribute('data-jread-hidden'), '1',
      '第二個次要全文 aside 沒被 hide——aside 迴圈掃到第一個命中就 return 的舊行為');
  });

  it('結構 forcing：三個 widget 分支迴圈聚合「有 hide 才 return」+ hideVideoPlayerWidgetFrom 回傳布林', () => {
    const dyn = CLEANER_SRC.match(/function\s+checkDynamicNoise[\s\S]*?\n  \}/)[0];
    assert.match(dyn, /hidJw/, 'jwplayer 迴圈必須聚合 hide 結果（hidJw）再決定 return');
    assert.match(dyn, /hidRec/, 'recommendation 迴圈必須聚合 hide 結果（hidRec）再決定 return');
    assert.match(dyn, /hidSub/, 'Substack 迴圈必須聚合 hide 結果（hidSub）再決定 return');
    assert.match(dyn, /hidAside/, 'aside 迴圈必須掃完聚合（hidAside）再決定 return');
    const jw = CLEANER_SRC.match(/function hideVideoPlayerWidgetFrom[\s\S]*?\n  \}/)[0];
    assert.match(jw, /hide\(wrapper, hidden\);\s*\n\s*return true;/,
      'hideVideoPlayerWidgetFrom 必須回傳是否處理（checkDynamicNoise 據此決定 early return）');
  });
});
