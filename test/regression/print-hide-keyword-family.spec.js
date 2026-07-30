// JRead — printHide / hidden-print 語意 token + related-links 變體 + 動態子孫
// container keyword 掃描 regression spec（v1.7.26）
//
// 根因（2026-07-30 Jimmy 回報 NYT google-ai-open-web「頁面下方有許多雜訊」）：
// NYT 在進入閱讀模式後 lazy 注入三塊文末雜訊，全數殘留：
//   1. 「Explore Our Coverage of X」編輯連結包——SECTION class 為 emotion 合成
//      `css-8tdf5q-printHide-guideContainerClass`。printHide = noprint（v0.8.48）
//      的 camelCase 變體（站方自標「列印時隱藏」＝自我聲明非內容），原 token
//      只認連寫 noprint → miss。模組內編輯摘要 p 皆 100+ chars，會誤觸主文長段
//      guard，故 token 必須 strong（站方已宣告 print-hide，主文 wrapper 絕不會帶）。
//   2. 相關報導卡群 `div.related-links-block`——原 related alternation 無 links
//      變體；`related-block` 因中間隔 `links-` 也不命中。
//   3. 「See more on: <topics>」tag 列 `css-1smpwg-printHide`——同 token 1。
// 且三塊都包在無 class 外層 DIV 內 lazy 注入：checkDynamicNoise 原本只查
// addedNode **自身**的 container keyword、不掃子孫 → 動態全 miss。修法把靜態
// container 迴圈抽成 hideKeywordContainers（單一資料源），動態端傳 addedNode
// 子孫的 CONTAINER_SEL 進去（guard 全套自動帶上）。
//
// 誤殺紅線（負控制）：NYT 主文段落 wrapper class 即 `css-8nuh3b-print`（裸
// `-print` 結尾）——token 不可用裸 print，`print[-_]?hide` 不得命中它。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
);

const LONG_P = '這是一段超過一百字元的編輯摘要文字，模擬新聞站文末連結包內每條推薦條目的長描述。' +
  '這種摘要段落會觸發 wrapperContainsMainContentP 的單段一百字元門檻，讓非 strong 的 ' +
  'keyword 命中被主文保護 guard 誤豁免，導致整個連結包殘留在文末。';

function buildEnv() {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><main id="wrap">
    <article id="art"><h1>主文標題：搜尋引擎與開放網路的未來</h1>
    <div class="css-8nuh3b-print StoryBodyColumn" id="body-col">
    <p>主文第一段。搜尋引擎的生成式回答正在改變使用者抵達開放網路的方式，這段文字刻意寫得足夠長以通過主文長段門檻，維持一百字元以上的篇幅來模擬真實新聞段落的長度與密度，確保偵測與保護邏輯把它當作主文內容。</p>
    <p>主文第二段。出版商的流量結構因此發生變化，同樣維持足夠長度避免被任何空容器或短文字規則誤判，並確保文章整體字數遠高於雜訊區塊。</p>
    </div></article></main></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
  window.eval(SRC.namespace);
  window.eval(SRC.cleaner);
  const doc = window.document;
  return { window, doc, art: doc.getElementById('art'), NS: window.__JRead };
}

// 模擬 NYT「Explore Our Coverage」連結包：printHide SECTION、內含 h2 + 長摘要 li p + 連結
function buildGuideSection(doc) {
  const sec = doc.createElement('section');
  sec.className = 'css-t1x2y3-printHide-guideContainerClass';
  sec.innerHTML = '<hr><h2 class="css-t9z8w7-titleClass">深入我們的人工智慧報導</h2><hr>' +
    '<h3>新聞與分析</h3><ul>' +
    `<li><p><strong>音樂標示：</strong>${LONG_P}<a href="/a1">閱讀報導</a></p></li>` +
    `<li><p><strong>晶片管制：</strong>${LONG_P}<a href="/a2">閱讀報導</a></p></li>` +
    `<li><p><strong>教育應用：</strong>${LONG_P}<a href="/a3">閱讀報導</a></p></li>` +
    '</ul>';
  return sec;
}

describe('print-hide-keyword-family — 結構 forcing', () => {
  it('NOISE_TOKEN_DEFS 必須含 strong 的 print-hide / hidden-print 語意 token', () => {
    assert.ok(/\{\s*t:\s*'print\[-_\]\?hide',\s*strong:\s*true\s*\}/.test(CLEANER_SRC),
      '必須宣告 { t: \'print[-_]?hide\', strong: true }（NYT printHide 連結包需跳主文長段 guard）');
    assert.ok(/\{\s*t:\s*'hidden\?\[-_\]\?print',\s*strong:\s*true\s*\}/.test(CLEANER_SRC),
      '必須宣告 { t: \'hidden?[-_]?print\', strong: true }（Bootstrap hidden-print 慣例變體）');
  });
  it('related alternation 必須含 links 變體', () => {
    assert.ok(/related\[-_\]\?\(\?::?[^)]*\blinks\?/.test(CLEANER_SRC),
      'related token alternation 必須含 links?（related-links-block 命名家族）');
  });
  it('靜態 container 迴圈抽成 hideKeywordContainers、動態 checkDynamicNoise 掃 addedNode 子孫（單一資料源）', () => {
    assert.ok(/function\s+hideKeywordContainers/.test(CLEANER_SRC),
      '必須宣告 hideKeywordContainers（靜態 + 動態共用）');
    const dyn = CLEANER_SRC.match(/function\s+checkDynamicNoise[\s\S]*?\n  \}/)[0];
    assert.ok(/hideKeywordContainers\(articleEl,\s*hiddenList,\s*node\.querySelectorAll\(CONTAINER_SEL\)\)/.test(dyn),
      'checkDynamicNoise 必須把 addedNode 子孫 CONTAINER_SEL 餵給 hideKeywordContainers');
  });
});

describe('print-hide-keyword-family — 行為（靜態 clean）', () => {
  it('printHide 連結包（含 100+ chars 摘要 p）整塊被 hide（strong 跳主文 guard）', () => {
    const { doc, art, NS } = buildEnv();
    const sec = buildGuideSection(doc);
    art.appendChild(sec);
    const hidden = NS.cleaner.clean(art);
    assert.strictEqual(sec.dataset.jreadHidden, '1',
      'printHide SECTION 必須被 hide；forcing：移除 print[-_]?hide token 或降為非 strong → fail');
    NS.cleaner.restore(hidden);
    assert.notStrictEqual(sec.dataset.jreadHidden, '1', 'restore 後必須還原');
  });

  it('related-links-block 相關報導卡群被 hide（links 變體）', () => {
    const { doc, art, NS } = buildEnv();
    const div = doc.createElement('div');
    div.className = 'related-links-block css-a1b2c3-StyledRelatedLinks';
    div.innerHTML = '<span>搜尋引擎專題</span>' +
      '<a href="/r1">搜尋框二十五年來首次改版</a><a href="/r2">生成式搜尋的代價</a>' +
      '<a href="/r3">出版商的下一步</a><a href="/r4">流量重分配</a>';
    art.appendChild(div);
    const hidden = NS.cleaner.clean(art);
    assert.strictEqual(div.dataset.jreadHidden, '1',
      'related-links-block 必須被 hide；forcing：把 alternation 的 links? 拿掉 → fail');
    NS.cleaner.restore(hidden);
  });

  it('負控制：主文段落 wrapper class 裸 -print 結尾（css-xxx-print）不得被誤殺', () => {
    const { doc, NS } = buildEnv();
    const art = doc.getElementById('art');
    const bodyCol = doc.getElementById('body-col');
    const hidden = NS.cleaner.clean(art);
    assert.notStrictEqual(bodyCol.dataset.jreadHidden, '1',
      '裸 -print 結尾的主文 wrapper 不得命中 print[-_]?hide（NYT css-8nuh3b-print 主文段落）');
    NS.cleaner.restore(hidden);
  });
});

describe('print-hide-keyword-family — 行為（動態 lazy 注入）', () => {
  it('clean 後 lazy 注入「無 class 外層 DIV 包 printHide SECTION」→ 子孫掃描命中內層', async () => {
    const { doc, art, NS } = buildEnv();
    const hidden = NS.cleaner.clean(art);

    // NYT 實測時序：注入的 addedNode 是無 class wrapper，printHide 在內層
    const outer = doc.createElement('div');
    const inner = doc.createElement('div');
    outer.appendChild(inner);
    const sec = buildGuideSection(doc);
    inner.appendChild(sec);
    art.appendChild(outer);

    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(sec.dataset.jreadHidden, '1',
      'lazy 注入的內層 printHide SECTION 必須被動態子孫 container 掃描 hide；' +
      'forcing：移除 checkDynamicNoise 的 hideKeywordContainers 子孫掃描 → fail');
    NS.cleaner.restore(hidden);
  });

  it('動態注入不誤殺：無 keyword 的內容區塊（含長 p）不受子孫掃描影響', async () => {
    const { doc, art, NS } = buildEnv();
    const hidden = NS.cleaner.clean(art);

    const outer = doc.createElement('div');
    const contentDiv = doc.createElement('div');
    contentDiv.className = 'css-d4e5f6-print StoryBodyColumn';
    contentDiv.innerHTML = `<p>${LONG_P}</p>`;
    outer.appendChild(contentDiv);
    art.appendChild(outer);

    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    assert.notStrictEqual(contentDiv.dataset.jreadHidden, '1',
      'lazy 注入的主文型區塊（裸 -print、無雜訊 token）不得被子孫掃描誤殺');
    NS.cleaner.restore(hidden);
  });
});
