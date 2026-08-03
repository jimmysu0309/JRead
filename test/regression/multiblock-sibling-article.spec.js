// JRead — multi-block 文章接續兄弟區塊吸收 regression spec（v1.7.13）
// 對應 fixture：test/regression/fixtures/multiblock-sibling-article.html
//
// Bug 來源（city.gvm.com.tw/article/130682，Jimmy 2026-07-23 回報「文章被截斷」）：
// CMS 把一篇文章切成多個 body 直下的兄弟容器、中間插廣告區塊，唯一共同祖先
// 是 body。detector 任一策略都只選單一容器（第一塊），後續區塊整段掉出閱讀
// 模式。修法對齊 Readability.js sibling-merge 精神：detect() 選定主容器後
// 唯讀識別「像文章內文」的 following siblings（result.continuationEls），
// main.js 進場移進 articleEl、退出移回原位。
//
// 本 spec 驗四層：
//   1. detect() 識別出正確的接續區塊（含正例與四種反例）
//   2. absorbContinuationSiblings 移入 + 逐筆登記
//   3. restoreAbsorbedSiblings 逆序移回原位（DOM 完全還原）
//   4. main.js 有接 absorb / restore 兩端（wiring forcing）

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, JREAD_DIR } = require('../helpers');

const FIXTURE = path.join(__dirname, 'fixtures', 'multiblock-sibling-article.html');
const MAIN_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'main.js'), 'utf8');

function load() {
  return loadFixtureWithScripts({ fixturePath: FIXTURE, scripts: ['detector'] });
}

describe('detector — multi-block 文章接續兄弟區塊（gvm 截斷修法）', () => {
  let document, NS, result;
  before(() => {
    const env = load();
    document = env.document;
    NS = env.NS;
    result = NS.detector.detect();
  });

  it('偵測成功且主容器含標題 h1（第一塊）', () => {
    assert.ok(result && result.el, '偵測應成功');
    assert.ok(result.el.querySelector('h1'), 'articleEl 應含標題 h1');
    assert.ok(
      result.el.closest('#block-main') || result.el.querySelector('#block-main-content'),
      `articleEl 應落在第一塊主文，實際 id="${result.el.id}" class="${result.el.className}"`
    );
  });

  it('continuationEls 識別出兩個接續區塊（依文件序）', () => {
    assert.ok(Array.isArray(result.continuationEls), 'result.continuationEls 應為陣列');
    // 注意：continuationEls 是 jsdom realm 的 Array（window.eval 產物），
    // deepStrictEqual 會因跨 realm 原型不同而 fail，逐元素比對
    const ids = Array.from(result.continuationEls, el => el.id);
    assert.strictEqual(ids.length, 2, `應識別 2 塊，實際 [${ids.join(', ')}]`);
    assert.strictEqual(ids[0], 'block-cont-a');
    assert.strictEqual(ids[1], 'block-cont-b');
  });

  it('反例不吸收：廣告區塊 / 純連結列表 / 短文字作者簡介', () => {
    const ids = new Set(result.continuationEls.map(el => el.id));
    assert.ok(!ids.has('ad-1') && !ids.has('ad-2'), '廣告區塊不可吸收');
    assert.ok(!ids.has('related-links'), '高連結密度的延伸閱讀列表不可吸收');
    assert.ok(!ids.has('author-bio'), '字數不足的作者簡介不可吸收');
  });

  it('反例不吸收：含 h1 的瀑布流下一篇（掃描終止邊界）', () => {
    const ids = new Set(result.continuationEls.map(el => el.id));
    assert.ok(!ids.has('next-article'), '含 h1 的兄弟是下一篇文章的開頭，不可吸收');
  });

  it('反例不吸收：aside 內的長段落不構成接續證據（v1.7.30 theatlantic 訂閱區）', () => {
    const ids = new Set(result.continuationEls.map(el => el.id));
    assert.ok(!ids.has('reg-aside-block'),
      '段落全在 <aside> 內的兄弟塊不可吸收——aside 語意即非主文附屬內容');
  });

  it('反例不吸收：newsletter / subscribe class 子樹內的長段落不構成接續證據（v1.7.30）', () => {
    const ids = new Set(result.continuationEls.map(el => el.id));
    assert.ok(!ids.has('leaflet-block'),
      '段落全在訂閱 CTA class（CSS-module 命名）子樹內的兄弟塊不可吸收');
  });
});

describe('detector — absorb / restore 接續區塊（DOM 可逆性）', () => {
  it('absorb 移進 articleEl 並逐筆登記；restore 完全還原原位', () => {
    const env = load();
    const { document, NS } = env;
    const result = NS.detector.detect();
    const articleEl = result.el;
    const contA = document.getElementById('block-cont-a');
    const contB = document.getElementById('block-cont-b');
    const ad2 = document.getElementById('ad-2');
    const origParentA = contA.parentElement;
    const origNextA = contA.nextElementSibling; // ad-2

    // ---- absorb ----
    const out = [];
    NS.detector.absorbContinuationSiblings(articleEl, result.continuationEls, out);
    assert.strictEqual(out.length, 2, '兩塊都應登記還原紀錄');
    assert.ok(articleEl.contains(contA) && articleEl.contains(contB), '兩塊應已移入 articleEl');
    assert.strictEqual(contA.getAttribute('data-jread-absorbed-sibling'), '1');
    // 文件序：contA 在 contB 之前
    assert.ok(
      contA.compareDocumentPosition(contB) & 4 /* DOCUMENT_POSITION_FOLLOWING */,
      '吸收後仍維持文件序（contA 在 contB 前）'
    );

    // ---- restore ----
    NS.detector.restoreAbsorbedSiblings(out);
    assert.ok(!articleEl.contains(contA) && !articleEl.contains(contB), '還原後兩塊應離開 articleEl');
    assert.strictEqual(contA.parentElement, origParentA, '還原後 parent 應回到原容器');
    assert.strictEqual(contA.nextElementSibling, origNextA, '還原後 contA 的下一個兄弟應仍是 ad-2');
    assert.strictEqual(contB.previousElementSibling, ad2, '還原後 contB 應回到 ad-2 之後');
    assert.strictEqual(contA.getAttribute('data-jread-absorbed-sibling'), null, '還原後應清掉標記 attribute');
  });

  it('restore 錨點已消失時退回 append、不 throw', () => {
    const env = load();
    const { document, NS } = env;
    const result = NS.detector.detect();
    const out = [];
    NS.detector.absorbContinuationSiblings(result.el, result.continuationEls, out);
    // 站方腳本把原錨點（ad-2）移除
    document.getElementById('ad-2').remove();
    assert.doesNotThrow(() => NS.detector.restoreAbsorbedSiblings(out));
    const contA = document.getElementById('block-cont-a');
    assert.ok(!result.el.contains(contA), '錨點消失時仍應移回原 parent（append 兜底）');
  });
});

describe('main.js — absorb / restore 接線（wiring forcing function）', () => {
  it('enter 路徑呼叫 absorbContinuationSiblings 且累加器先掛 state', () => {
    assert.ok(
      MAIN_SRC.includes('absorbContinuationSiblings'),
      'main.js enter 路徑必須接 NS.detector.absorbContinuationSiblings'
    );
    assert.ok(
      MAIN_SRC.includes('NS.state.absorbedSiblings = absorbedSiblings'),
      '累加器必須先掛上 NS.state 再交給 detector（中途 throw 可還原）'
    );
  });

  it('exit 路徑呼叫 restoreAbsorbedSiblings', () => {
    assert.ok(
      MAIN_SRC.includes('restoreAbsorbedSiblings(NS.state.absorbedSiblings)'),
      'main.js exit 路徑必須接 NS.detector.restoreAbsorbedSiblings'
    );
  });
});
