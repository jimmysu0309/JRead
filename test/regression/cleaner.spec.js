// JRead — cleaner regression spec
// 對應 fixture：test/regression/fixtures/businessweekly-7014035.html
// 涵蓋四條路徑：語意標籤 / fixed-sticky / 社群分享 cluster / 主文內 keyword。
//
// jsdom 不算 layout（getBoundingClientRect 全回 0），所以對 fixture 中帶
// position:fixed/sticky 的元素我們 stub rect，讓 fixed 分支能被覆蓋到。
// 這是測試環境限制的妥協，不是真實世界邏輯變形。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');
const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'),
  'utf8'
);
const DETECTOR_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'),
  'utf8'
);

// viewport 模擬
const VW = 1000;
const VH = 600;

// 手動對應 fixture 中帶 inline position:fixed 的元素預期 rect（px）。
// 原因：fixture 用 100% / 百分比表達寬高與位置，jsdom 不解析，只能預設結果。
const FIXED_RECTS = {
  '.postnav.fixed':      { top: 0,        width: VW, height: 50  }, // top bar
  '#progress-wrapper':   { top: 0,        width: VW, height: 4   }, // progress bar
  '#gdrp-el':            { top: VH - 80,  width: VW, height: 80  }, // bottom popup
  '.Floating-Setting':   { top: VH * 0.4, width: 60, height: 240 }, // side tool
  '#shortModel':         { top: VH * 0.8, width: 120, height: 80 }  // bottom popup
};

function stubRect(el, rect) {
  el.getBoundingClientRect = () => ({
    top: rect.top,
    bottom: rect.top + rect.height,
    left: 0,
    right: rect.width,
    width: rect.width,
    height: rect.height,
    x: 0,
    y: rect.top
  });
}

function loadFixture() {
  const html = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;

  // stub viewport
  Object.defineProperty(window, 'innerWidth',  { value: VW, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: VH, configurable: true });

  // stub fixed/sticky 元素的 rect
  for (const [sel, rect] of Object.entries(FIXED_RECTS)) {
    const el = window.document.querySelector(sel);
    assert.ok(el, `fixture 中應存在 ${sel}`);
    stubRect(el, rect);
  }

  // 最小 NS
  window.__JRead = { state: {}, MSG: {} };
  window.eval(DETECTOR_SRC);
  window.eval(CLEANER_SRC);
  return window;
}

describe('cleaner — businessweekly-7014035', () => {
  let window, document, articleEl, hidden;

  before(() => {
    window = loadFixture();
    document = window.document;
    const detected = window.__JRead.detector.detect();
    assert.ok(detected, 'detector 應成功命中商周主文');
    articleEl = detected.el;
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  it('隱藏總數 ≥ 10（語意 + fixed + keyword 合計）', () => {
    assert.ok(
      hidden.length >= 10,
      `實際隱藏 ${hidden.length} 個元素（期望 ≥ 10）。` +
      `清單：${hidden.map(h => h.el.id || h.el.className || h.el.tagName).join(', ')}`
    );
  });

  it('保留元素一律未被隱藏（summary / figure / figcaption / blockquote）', () => {
    const preserveSel = 'summary, figure, figcaption, blockquote';
    const preserved = document.querySelectorAll(preserveSel);
    assert.ok(preserved.length > 0, 'fixture 中必須有保留元素以供驗證');

    for (const el of preserved) {
      assert.notStrictEqual(
        el.dataset.jreadHidden, '1',
        `保留元素 <${el.tagName.toLowerCase()}> 不應被標記隱藏`
      );
      assert.notStrictEqual(
        el.style.display, 'none',
        `保留元素 <${el.tagName.toLowerCase()}> 的 display 不應為 none`
      );
    }
  });

  it('<summary> 仍可被 querySelector 找到且文字內容保留', () => {
    const summary = document.querySelector('summary');
    assert.ok(summary, '<summary> 必須存在');
    assert.ok(
      summary.textContent.includes('editor bullet'),
      'summary 內 editor bullets 文字必須保留（Unclutter 在商周踩過這坑）'
    );
  });

  it('主文內 paywall 區塊被標記隱藏（keyword: paywall）', () => {
    const el = document.querySelector('.postbody.paywall');
    assert.ok(el, 'fixture 中應有 .postbody.paywall');
    assert.strictEqual(el.dataset.jreadHidden, '1');
  });

  it('#Epaper-subscribe 被標記隱藏（keyword: subscribe）', () => {
    const el = document.getElementById('Epaper-subscribe');
    assert.ok(el);
    assert.strictEqual(el.dataset.jreadHidden, '1');
  });

  it('主文外語意標籤被隱藏（header / footer）', () => {
    assert.strictEqual(document.getElementById('header').dataset.jreadHidden, '1');
    assert.strictEqual(document.querySelector('footer.footer-wrap').dataset.jreadHidden, '1');
  });

  it('fixed/sticky 元素全部被隱藏（top bar / side tool / bottom popup）', () => {
    for (const sel of Object.keys(FIXED_RECTS)) {
      const el = document.querySelector(sel);
      assert.strictEqual(
        el.dataset.jreadHidden, '1',
        `${sel} 應被 fixed/sticky 規則命中隱藏`
      );
    }
  });

  it('含 <img>/<picture>/<video> 的容器即使符合其他 action-toolbar 條件也不隱藏', () => {
    // Substack 的 captioned-image-container：含 img + 多個 svg（zoom / loading）
    // + 短文字，符合 action-toolbar 的 iconCount / text / no-<p> 條件，但它
    // 是內容容器；加 img 排除條件避免誤殺
    const el = document.querySelector('.captioned-image-container');
    assert.ok(el, 'fixture 必須有 .captioned-image-container');
    assert.notStrictEqual(
      el.dataset.jreadHidden, '1',
      '含 <img> 的容器不該被 action-toolbar 規則隱藏'
    );
    const img = el.querySelector('img');
    assert.notStrictEqual(
      img.dataset.jreadHidden, '1',
      '其內的 <img> 不該被隱藏'
    );
  });

  it('主文內 action toolbar 被隱藏（含多個 button/svg、自身文字短、無 <p> 子）', () => {
    // Medium / Substack 類的 post footer：拍手/回應/收藏/更多
    // class 被混淆（xp-1a2b3c）、無 keyword、無法用既有規則命中
    const el = document.querySelector('.xp-1a2b3c');
    assert.ok(el, 'fixture 必須有 action toolbar 模擬元素');
    assert.strictEqual(el.dataset.jreadHidden, '1', 'action toolbar 必須被隱藏');
  });

  it('外層 byline+actions wrapper（直接子主要是 sub-containers）不得被 action-row 整塊誤殺', () => {
    // ChinaTalk (Substack) quantum-101 實測：作者/日期外層是一個 flex-column
    // wrapper，直接子是兩個 sub-div（meta group + button group），容器自身
    // 符合 action-row 條件但直接子幾乎沒互動元素（2 個 DIV）。若不排除，整
    // 塊 hide 會連帶把作者/日期 sub-div 藉 display:none ancestor 繼承也藏掉。
    // 通則：action row 的直接子必須多數（>= 50%）是互動元素（button / [role=
    // button] / svg），否則視為內容 wrapper。
    const wrapper = document.querySelector('.byline-actions-wrapper');
    assert.ok(wrapper, 'fixture 必須有 byline-actions-wrapper');
    assert.notStrictEqual(
      wrapper.dataset.jreadHidden, '1',
      '外層 byline+actions wrapper 不得被 hide（作者/日期應保留顯示）'
    );
    // meta group 不得被直接 hide
    const metaGroup = wrapper.querySelector('.meta-group');
    assert.ok(metaGroup);
    assert.notStrictEqual(metaGroup.dataset.jreadHidden, '1',
      'meta group（作者/日期）不得被 hide');
    // 內層 btn-group（純 buttons）應該被正確命中 hide
    const btnGroup = wrapper.querySelector('.btn-group');
    assert.ok(btnGroup);
    assert.strictEqual(btnGroup.dataset.jreadHidden, '1',
      '內層 btn-group（純互動列）仍應被 action-row 規則 hide');
  });

  it('含 h1-h6 直接子的容器即使符合 action-row 其他條件也不得隱藏（保留 post-header 標題區塊）', () => {
    // ChinaTalk (Substack) quantum-101 實測：div.post-header 包 <h1 post-title>
    // + 作者/日期 meta + 多個 like/comment/share/more button，命中 action-row
    // 的「無 p、無媒體、短文字、多 icon」條件但含 <h1>。若規則不排除，會砍
    // 掉整個標題區塊。通則：action row 是圖示互動列，絕不會包含 heading。
    const el = document.querySelector('.post-header');
    assert.ok(el, 'fixture 必須有 post-header 模擬元素');
    assert.notStrictEqual(
      el.dataset.jreadHidden, '1',
      '含 <h1> 的容器不得被 action-row 規則隱藏'
    );
    // 內部 h1 亦不得被隱藏（容器未隱藏，其子元素 inline display 也不會被改）
    const h1 = el.querySelector('h1.post-title');
    assert.ok(h1, 'fixture post-header 內必須有 h1.post-title');
    assert.notStrictEqual(
      h1.dataset.jreadHidden, '1',
      'h1.post-title 不得被隱藏'
    );
  });

  it('主文內 role="dialog" 元素被隱藏（ARIA 語意 dialog 絕非正文內容）', () => {
    // Substack .subscribeDialog：position:absolute、在 article 內、class 被混淆、
    // 無 keyword、非 fixed——僅 role="dialog" 能命中
    const el = document.querySelector('.subscribeDialog-ApxQJS');
    assert.ok(el, 'fixture 必須有 subscribe dialog 模擬元素');
    assert.strictEqual(el.dataset.jreadHidden, '1', 'role="dialog" 必須被隱藏');
  });

  it('ancestor-siblings 規則命中非語意/非 fixed/無 keyword 的 brand rail', () => {
    // 模擬 Medium / Substack 上方站名 header——舊三條規則全漏，
    // 僅 ancestor-siblings 能命中
    const el = document.querySelector('.brand-rail');
    assert.ok(el, 'fixture 必須有 .brand-rail');
    assert.strictEqual(el.dataset.jreadHidden, '1', '.brand-rail 必須被隱藏');
  });

  it('restore() 移除所有 jreadHidden 標記並還原 display', () => {
    window.__JRead.cleaner.restore(hidden);
    const stillHidden = document.querySelectorAll('[data-jread-hidden="1"]');
    assert.strictEqual(stillHidden.length, 0, '還原後不應有任何元素仍帶 data-jread-hidden');

    for (const item of hidden) {
      assert.notStrictEqual(
        item.el.style.display, 'none',
        '還原後 display 不應留在 none'
      );
    }
  });
});

// -----------------------------------------------------------------------------
// Reader mode 下凍結主文祖先鏈：MutationObserver 攔截 dynamic append
// 對應 fixture：test/regression/fixtures/ltn-multi-article-siblings.html
// Bug 來源：news.ltn.com.tw 用 popIn Discovery 在 scroll 時把「下一篇」從
// .template 元素 clone 後 append 到主文 parent（section.content-list）。
// cleaner.clean() 是 one-shot snapshot，只 hide 當下存在的節點；新 append
// 的節點沒經過流程 → 混入使用者視野。且 popIn 的 template clone 帶有
// cleaner 之前 hide 的 dataset.jreadHidden，傳統 hide() 的 early-return
// 會 skip；即使 hide 成功 popIn 也會主動設 display:block 覆蓋。
// 修法：cleaner.clean() 結束時啟動 MutationObserver 觀察主文祖先鏈上每一
// 層 parent 的 childList，新 addedNodes（非主文相關、非 structural、非保留）
// 直接 remove。cleaner.restore() 時 disconnect。
// -----------------------------------------------------------------------------
describe('cleaner — reader mode 下 MutationObserver 凍結主文祖先鏈', () => {
  let window, document, articleEl, NS, hidden;

  beforeEach(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'ltn-multi-article-siblings.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    NS = window.__JRead;
    const detected = NS.detector.detect();
    assert.ok(detected, 'detector 必須命中主文');
    articleEl = detected.el;
    hidden = NS.cleaner.clean(articleEl);
  });

  afterEach(() => {
    // 確保 observer disconnected，避免影響下個測試（保險）
    try { NS.cleaner.restore(hidden); } catch {}
  });

  // 模擬 popIn template clone：新節點帶 dataset.jreadHidden（從被 hide 的
  // template 繼承而來），且主動設 display:block。觀察者必須忽略這些殘留
  // attribute 直接 remove。
  async function appendFakePopInArticle(parent, h1Text) {
    const div = document.createElement('div');
    div.className = 'whitecon article template';
    div.dataset.jreadHidden = '1';  // 模擬從 hidden .template clone 來
    div.style.display = 'block';    // popIn 主動設的
    const h1 = document.createElement('h1');
    h1.textContent = h1Text;
    div.appendChild(h1);
    parent.appendChild(div);
    // MutationObserver callback 是 microtask，用 setTimeout 讓它跑
    await new Promise(r => setTimeout(r, 0));
    return div;
  }

  it('主文 parent 新 append 的節點會被 remove（popIn infinite-scroll 攔截）', async () => {
    const parent = articleEl.parentElement;
    assert.ok(parent, '主文必須有 parent');
    const countBefore = parent.children.length;

    await appendFakePopInArticle(parent, 'DYNAMIC_NEXT_ARTICLE_MARK 偷載飛彈推進劑原料？');

    assert.strictEqual(
      parent.children.length, countBefore,
      `新 append 的節點應被 observer remove，parent.children 應回到 ${countBefore}，實際 ${parent.children.length}`
    );
    const txt = parent.textContent || '';
    assert.ok(!txt.includes('DYNAMIC_NEXT_ARTICLE_MARK'),
      '主文 parent 不得殘留新 append 的文字');
  });

  it('主文祖先鏈更外層新 append 也會被 remove（多層 parent 都觀察）', async () => {
    // fixture 結構：body > section.content-list > first-article(articleEl)
    // 觀察鏈應涵蓋 section.content-list + body
    const body = document.body;
    const countBefore = body.children.length;

    const div = document.createElement('div');
    div.className = 'injected-footer-ad';
    div.textContent = 'LATE_AD_MARK';
    body.appendChild(div);
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(body.children.length, countBefore,
      '祖先鏈更外層（body）新 append 的節點也應被 remove');
  });

  it('append 到主文內部的節點不受影響（observer 只管祖先鏈，不管主文後代）', async () => {
    // reader mode 下主文內部的 DOM 改動（例如圖片 lazy-load swap src、
    // 互動元件 state 變化、使用者 copy/paste 自製 HTML）不得被 observer 當
    // 雜訊 remove——只有主文**祖先鏈上**的 childList 才攔截。
    const p = document.createElement('p');
    p.textContent = 'INSIDE_MAIN_TEXT_MARK';
    articleEl.appendChild(p);
    await new Promise(r => setTimeout(r, 0));

    assert.ok(articleEl.contains(p),
      '主文內部新 append 的節點不得被 observer remove');
  });

  // 不是 MutationObserver 分組的一部分，但與 cleaner 流程相關，放在此分組尾
  it('action-bar shell short-circuit：direct children 全 wrapper + textContent 短 → hide', () => {
    // 離題 describe，用獨立 fixture setup 驗（避免 LTN fixture 干擾）
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'medium-action-bar-shell.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中主文');
    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      const shell = w.document.querySelector('.action-bar-outer');
      assert.ok(shell, 'fixture 必須有 .action-bar-outer');
      assert.strictEqual(shell.dataset.jreadHidden, '1',
        'Medium action-bar outer shell（direct children 全 wrapper、textContent < 20 chars、deep button+svg ≥ 2）必須被 hide');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('ChinaTalk 類 byline+actions wrapper 不得因 shell short-circuit 誤殺（textContent 含作者+日期 ≥ 20 chars）', () => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'medium-action-bar-shell.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      const byline = w.document.querySelector('.byline-actions-wrapper');
      assert.ok(byline, 'fixture 必須有 .byline-actions-wrapper');
      assert.notStrictEqual(byline.dataset.jreadHidden, '1',
        'ChinaTalk byline wrapper 的 textContent ~30 chars ≥ 20，shell short-circuit 的 escape hatch 不觸發，outer 應保留');
      // 保留期間，CHINATALK_BYLINE_MARK 必須仍可 querySelector 找到
      const metaTxt = byline.querySelector('.meta-group')?.textContent || '';
      assert.ok(metaTxt.includes('CHINATALK_BYLINE_MARK'),
        '作者/日期 meta 文字必須保留');
      // 內層 btn-group（direct children 100% button）仍應被原 action-row hide
      const btnGroup = w.document.querySelector('.btn-group');
      assert.strictEqual(btnGroup.dataset.jreadHidden, '1',
        '內層 .btn-group（direct children 全 button）仍應由原 action-row 規則 hide');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('主文內 sidebar column：Substack podcast-post 2-col flex wrapper 中，高 linkDensity + 低文字量的欄必須被 hide', () => {
    // Dwarkesh (Substack podcast-post) 實測：<article> tag 包住整個
    // main-content-and-sidebar 2-col flex，sidebar（Listen on / Recent
    // Episodes 連結堆）身為 article 後代躲過 outside / ancestor / keyword
    // 所有規則。通則：articleEl 內任一 container 的 direct children 中，
    // 某個 child 文字量 < 主欄 10% + linkDensity > 0.5 → 視為 sidebar column。
    // 不綁 hostname / class，純結構特徵。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'dwarkesh-substack-sidebar-column.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 Dwarkesh 主文');
    assert.strictEqual(detected.strategy, 'article-tag',
      'detector 應走 article-tag 策略（單一 <article> 直接採用）');
    assert.strictEqual(detected.el.tagName, 'ARTICLE',
      '主文容器應為 article 本身（不改 detector，不 narrow 掉 video wrapper）');

    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      // 核心斷言 1：sidebar column 被 hide
      const sidebar = w.document.querySelector('.border-left-detail-the');
      assert.ok(sidebar, 'fixture 必須有 sidebar column');
      assert.strictEqual(sidebar.dataset.jreadHidden, '1',
        'sidebar column（高 linkDensity + 低文字量）必須被 hide');

      // 核心斷言 2：主欄未被 hide（主文內容保留）
      const mainCol = w.document.querySelector('.main-content-qKkUCg');
      assert.ok(mainCol, 'fixture 必須有 main column');
      assert.notStrictEqual(mainCol.dataset.jreadHidden, '1',
        '主欄（長文字、低 linkDensity）不得被 hide');

      // 核心斷言 3：主文內容標記在主欄內可見
      assert.ok(mainCol.textContent.includes('DWARKESH_BODY_MARK'),
        '主欄應含主文內容標記');

      // 核心斷言 4：article 本身不被 hide
      assert.notStrictEqual(detected.el.dataset.jreadHidden, '1',
        'article 本身不得被 hide');

      // 核心斷言 5：video/audio 播放器容器不被誤殺
      // container-dlhqPD 是 flex-row，direct children 含 video-wrapper-lforaE 一個 div
      // children.length < 2 → early-skip，不會觸發 sidebar 規則
      const playerContainer = w.document.querySelector('.container-dlhqPD');
      assert.ok(playerContainer, 'fixture 必須有 video player 容器');
      assert.notStrictEqual(playerContainer.dataset.jreadHidden, '1',
        'video player 容器不得被 sidebar column 規則誤殺');
      // 其內 video-wrapper 也不得被誤殺——其 children 中雖有 3 個 div 但
      // 皆低 linkDensity，不符合 sidebar 條件
      const videoWrapper = w.document.querySelector('.video-wrapper-lforaE');
      assert.ok(videoWrapper);
      assert.notStrictEqual(videoWrapper.dataset.jreadHidden, '1',
        'video wrapper 不得被誤殺（其 children 皆低 linkDensity）');

      // 核心斷言 6：sidebar 標記文字在 visible tree 外（因祖父被 hide）
      // 視覺上 sidebar 消失——DOM 上仍存在但 display: none
      assert.strictEqual(sidebar.style.display, 'none',
        'sidebar column display 必須為 none');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('主文內 <aside> tag sidebar（條件 B）：textLen < main × 50% + rectH > 400 → hide；pull-quote（短高度）保留（修 Engadget 類 aside 含廣告 placeholder + footer link 稀釋 ld 到 < 0.5 條件 A 命中不了）', () => {
    // Engadget 實測：article > div(grid) > [col-main(7433 chars), aside.col-right(858 chars), ...]。
    // aside.col-right 是 HTML5 語意 sidebar tag，裡面塞廣告 placeholder +
    // Terms/Privacy/About links，textLen 剛好超過 main × 10%=743（858），
    // linkDensity 0.057（placeholder 文字稀釋），條件 A 兩條都差一點不中。
    // 但 aside rectH 5706px，明顯是滿版 sidebar 不是 pull-quote——新條件 B
    // 用 aside tag + textLen < main × 50% + rectH > 400 直接命中。
    // 同 fixture 另放一個 pull-quote aside（簡單 blockquote 結構 + stub 短高
    // < 400），驗 rectH 閾值保護 pull-quote 不被誤殺。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'engadget-aside-sidebar.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;

    const sidebar = w.document.getElementById('aside-sidebar');
    const pullquote = w.document.getElementById('aside-pullquote');
    const mainCol = w.document.getElementById('main-col');
    assert.ok(sidebar && pullquote && mainCol);

    // stub rect：sidebar 高 5000（>400 命中），pull-quote 高 200（<400 保留）
    stubRect(sidebar, { top: 100, width: 528, height: 5000 });
    stubRect(pullquote, { top: 5200, width: 528, height: 200 });
    // main-col 也給 rect，確保 rectH 讀得到（其他 children 不 stub，jsdom 回 0 即可）
    stubRect(mainCol, { top: 100, width: 528, height: 5000 });

    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);

    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    const localHidden = w.__JRead.cleaner.clean(detected.el);

    try {
      // 核心斷言 1：aside.col-right（高 sidebar）被 hide
      assert.strictEqual(sidebar.dataset.jreadHidden, '1',
        'aside tag + textLen < main × 50% + rectH > 400 應被條件 B 命中 hide');

      // 核心斷言 2：pull-quote aside（短高度）保留
      assert.notStrictEqual(pullquote.dataset.jreadHidden, '1',
        'pull-quote aside（rectH < 400 模擬）不得被誤殺——保留內文 aside');

      // 核心斷言 3：main-col 未被動
      assert.notStrictEqual(mainCol.dataset.jreadHidden, '1',
        '主欄不得被 hide');
      assert.ok(mainCol.textContent.includes('ENGADGET_MAIN_MARK'));

      // 核心斷言 4：pull-quote 內容仍在 visible tree
      assert.ok(pullquote.textContent.includes('PULLQUOTE_MARK'));
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('主文內 sidebar column：主欄文字 < 500 時不觸發（避免短文誤判）', () => {
    // 若主欄文字量不足 500 字，視為文章本身就短（非實際 2-col 主文），不觸發。
    // 避免把「作者 header + 短 byline row」這類 flex layout 誤判成 sidebar。
    const html = `
      <!DOCTYPE html>
      <html>
      <body>
        <article>
          <div style="display: flex; flex-direction: row">
            <div class="a-col"><p>Short paragraph maybe 50 chars of body text.</p></div>
            <div class="b-col">
              <a href="#1">Link 1</a> <a href="#2">Link 2</a> <a href="#3">Link 3</a>
            </div>
          </div>
          <p>More body content so article passes MIN_TEXT_LEN detector threshold. This paragraph intentionally contains enough text to cross 200 chars. Filler filler filler filler filler filler filler filler filler filler filler filler filler filler filler filler.</p>
        </article>
      </body>
      </html>
    `;
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      const bCol = w.document.querySelector('.b-col');
      assert.ok(bCol);
      assert.notStrictEqual(bCol.dataset.jreadHidden, '1',
        '主欄文字 < 500 時不觸發 sidebar 規則，.b-col 不得被 hide');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('主文內 CMS 留言區（#discussion / #comments-for-scroll / .comments-page）被 keyword heuristic 命中 hide', () => {
    // Dwarkesh / Substack 實測：主文結尾後緊跟 `<div id="discussion">` 區塊，
    // 內含 H4「Discussion about this video」+ 留言表單 + 留言列表。這塊不是
    // 原頁面 sidebar（在主文 main-content 內），不是 fixed/sticky、不是 article
    // 兄弟——靠擴展的跨站 CMS 留言 keyword（discussion / comment / comments /
    // disqus）hit `hideInsideArticleByKeyword` 被清掉。通則等同 share / social
    // 慣例：id="discussion" 是 Substack anchor、#disqus_thread 是 Disqus、
    // .comments-page 是 Substack comment 頁、#comments 是 Ghost/WordPress。
    // 這四個 keyword 不是任一站點特判，是跨 CMS 的 anchor 命名慣例。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'substack-discussion-comments.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 article');
    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      // 核心斷言 1：#discussion 根容器被 hide（id keyword 命中）
      const discussion = w.document.querySelector('#discussion');
      assert.ok(discussion, 'fixture 必須有 #discussion 容器');
      assert.strictEqual(discussion.dataset.jreadHidden, '1',
        '#discussion 必須被 keyword heuristic hide（id 含 discussion）');

      // 核心斷言 2：主文最後一段（Me too.）保留——切斷點正確
      const lastMain = Array.from(w.document.querySelectorAll('p'))
        .find(p => p.textContent.includes('LAST_MAINTEXT_MARK'));
      assert.ok(lastMain, '主文最後段必須存在');
      assert.notStrictEqual(lastMain.dataset.jreadHidden, '1',
        '主文最後段（LAST_MAINTEXT_MARK Me too.）不得被誤殺——切斷點正確');

      // 核心斷言 3：留言內容因祖先 #discussion 被 hide 而視覺上消失
      // （#discussion display:none 繼承；個別 .comment 不需要獨立 hide）
      const commentEl = Array.from(w.document.querySelectorAll('.comment-body'))
        .find(el => el.textContent.includes('DWARKESH_COMMENT_MARK'));
      assert.ok(commentEl, 'fixture 必須有留言內容節點');
      // 祖先 #discussion 已 display:none，個別 comment 不用自己 hidden；驗證
      // 任一祖先 jreadHidden = '1' 即可
      let cur = commentEl;
      let foundHidden = false;
      while (cur) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { foundHidden = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(foundHidden,
        '留言內容的祖先鏈上必須有一個元素被 hide（#discussion 或其下 wrapper）');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('主文內 grid / flex-row container 若有 child 被 hide → 退化成 block 並清 grid-template（修 AdBlocker 擋廣告後殘留的空欄位壓擠主文）', () => {
    // Engadget 實測：`<article>` 內有個 display:grid 2-col container，
    // grid-template-columns: `[main-start] 1fr [main-end right-start] 300px`。
    // AdBlocker（或 cleaner 的 ad- keyword heuristic）hide 掉右欄廣告後，
    // grid cell 的 300px 寬度硬性保留，主文被擠成 196px 窄欄。修法：進
    // reader mode 時掃 article 內 display:grid / flex-row container，若有
    // direct child 被 hide（data-jread-hidden="1" 或 display:none），給
    // container 加 inline `display:block; grid-template-columns:none` 退化
    // 成自然 block layout，主文回到卡片自然寬度。通則對付任何站點用 grid/
    // flex 做「主文+廣告側欄」layout 的情境，非站點特判。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'engadget-grid-sidebar-cell.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 必須命中 <article>');
    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      // 前提斷言：右欄廣告（class 含 ad-）被 keyword heuristic hide
      const rightCol = w.document.getElementById('right-col');
      assert.ok(rightCol);
      assert.strictEqual(rightCol.dataset.jreadHidden, '1',
        '右欄廣告（class 含 ad- pattern）應被 hideInsideArticleByKeyword hide');

      // 核心斷言 1：有 hidden child 的 grid container 被 collapse
      const adGrid = w.document.getElementById('layout-grid');
      assert.ok(adGrid);
      assert.strictEqual(adGrid.dataset.jreadCollapsed, '1',
        'grid container 有 hidden child 時應被標 data-jread-collapsed="1"');
      assert.strictEqual(adGrid.style.getPropertyValue('display'), 'block',
        'collapsed container 的 inline display 應為 block');
      assert.strictEqual(adGrid.style.getPropertyPriority('display'), 'important',
        'inline display:block 應 !important（贏過原站 grid rule）');
      assert.strictEqual(adGrid.style.getPropertyValue('grid-template-columns'), 'none',
        'collapsed container 的 grid-template-columns 應清為 none');

      // 核心斷言 2：主欄未被動
      const mainCol = w.document.getElementById('main-col');
      assert.ok(mainCol);
      assert.notStrictEqual(mainCol.dataset.jreadHidden, '1',
        '主欄不得被 hide');
      assert.ok(mainCol.textContent.includes('ENGADGET_MAINTEXT_MARK'));

      // 核心斷言 3：intentional 多欄 grid（無 hidden child）不被 collapse
      const intentional = w.document.getElementById('intentional-grid');
      assert.ok(intentional);
      assert.notStrictEqual(intentional.dataset.jreadCollapsed, '1',
        'intentional 多欄 grid（無 hidden child）不得被誤 collapse');
      // fixture 原本 inline 就設 display:grid / grid-template-columns: 1fr 1fr
      // 未觸發 collapse 時應保持原值（沒被改動）
      assert.strictEqual(intentional.style.getPropertyValue('display'), 'grid',
        '未觸發 collapse 的 grid 原 inline display 應保持為 grid');
      assert.strictEqual(intentional.style.getPropertyPriority('display'), '',
        '未觸發 collapse 的 grid 原 inline display 不得被加 !important priority');
      assert.strictEqual(intentional.style.getPropertyValue('grid-template-columns'), '1fr 1fr',
        '未觸發 collapse 的 grid-template-columns 應保持原值');

      // 核心斷言 4：Bootstrap row + col-md-8/col-md-4 情境（Lawfaremedia pattern）
      // flex-row collapse 後，Bootstrap col-md-* class 的 `flex: 0 0 66.67%;
      // max-width: 66.67%` 仍會生效讓 visible child 保持原寬度——必須連 children
      // 的 flex / max-width / width 一起清掉才能讓主欄撐滿卡片。
      const bootstrapRow = w.document.getElementById('bootstrap-row');
      const colMd8 = w.document.getElementById('col-md-8');
      const colMd4 = w.document.getElementById('col-md-4');
      assert.ok(bootstrapRow && colMd8 && colMd4);
      assert.strictEqual(colMd4.dataset.jreadHidden, '1',
        'col-md-4 含 sidebar-ad-widget 應被 keyword 命中 hide');
      assert.strictEqual(bootstrapRow.dataset.jreadCollapsed, '1',
        'bootstrap row（flex-row 有 hidden child）應被 collapse');
      assert.strictEqual(bootstrapRow.style.getPropertyValue('display'), 'block',
        'bootstrap row collapse 後 display 應為 block');
      assert.strictEqual(bootstrapRow.style.getPropertyValue('flex-direction'), 'column',
        'flex-row collapse 後 flex-direction 應設 column');
      // 關鍵斷言：col-md-8（visible child）的 flex longhand / max-width 應被清掉
      // 用 longhand 避免 shorthand serialization 在不同 engine 不一致
      assert.strictEqual(colMd8.style.getPropertyValue('flex-basis'), 'auto',
        'visible col-md-8 的 flex-basis 應被 force 成 auto（清 flex-basis:66.67%）');
      assert.strictEqual(colMd8.style.getPropertyValue('flex-grow'), '0',
        'visible col-md-8 的 flex-grow 應被 force 成 0');
      assert.strictEqual(colMd8.style.getPropertyValue('flex-shrink'), '0',
        'visible col-md-8 的 flex-shrink 應被 force 成 0');
      assert.strictEqual(colMd8.style.getPropertyValue('max-width'), 'none',
        'visible col-md-8 的 max-width 應被 force 成 none（清 max-width:66.67%）');
      assert.strictEqual(colMd8.style.getPropertyValue('width'), 'auto',
        'visible col-md-8 的 width 應被 force 成 auto');
      // hidden child 不動它的 inline width（反正它 display:none 不顯示）
      // 但它也不該被加上我們的 flex 覆寫
      assert.notStrictEqual(colMd4.style.getPropertyValue('flex-basis'), 'auto',
        'hidden child 的 flex-basis 不該被我們改（只處理 visible children）');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }

    // 核心斷言 5：restore 後所有 inline style 都被 revert（container + children）
    const adGridAfter = w.document.getElementById('layout-grid');
    assert.strictEqual(adGridAfter.style.getPropertyValue('display'), 'grid',
      'restore 後原 inline display:grid 應恢復');
    assert.strictEqual(adGridAfter.style.getPropertyValue('grid-template-columns'),
      '[main-start] 1fr [main-end right-start] 300px [right-end]',
      'restore 後原 inline grid-template-columns 應恢復');
    assert.strictEqual(adGridAfter.dataset.jreadCollapsed, undefined,
      'restore 後 data-jread-collapsed attribute 應被移除');
    const colMd8After = w.document.getElementById('col-md-8');
    // restore 後 inline flex-basis / max-width 應回到 fixture 原設值
    // （66.67% longhand，或 shorthand 對應展開）
    assert.strictEqual(colMd8After.style.getPropertyValue('flex-basis'), '66.67%',
      'restore 後 col-md-8 的 flex-basis 應恢復 66.67%');
    assert.strictEqual(colMd8After.style.getPropertyValue('max-width'), '66.67%',
      'restore 後 col-md-8 原 inline max-width 應恢復');
  });

  it('主文內 grid container 無 hidden sibling 但 visible children 寬度總和 < 70% container（grid underfill）→ 仍退化成 block（修 BBC 24-col design system 主文被擠在中間 50% 寬度）', () => {
    // BBC 文章頁實測：<article> 內某些段落 wrapper 用 `display: grid;
    // grid-template-columns: repeat(24, 1fr)`，唯一 direct child 明確
    // `grid-column: 6 / span 12` 只佔中間 12/24 欄——原 design system 預期
    // 右側 6-span 有圖 / 廣告 / 引文，但這段沒放。沒有 hidden sibling，
    // 既有 collapseGridWithHiddenCell 的 hasHiddenChild 條件命中不了；
    // 新 underfill 條件：grid visible children 全在同一 row 但寬度總和
    // < container × 70% → 仍退化成 block、清 grid-template、child 的
    // grid-column 清為 auto，讓主文恢復 block 自然全寬。
    // 通則：針對任何「用 N-column design system 但本頁 children 只佔部分
    // track」的站點，非 BBC 特判。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'bbc-grid-underfill.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;

    // jsdom 無 layout engine（getBoundingClientRect 全回 0），必須 stub rect
    // 才能驗證 underfill 條件（container 寬度、child 寬度比例、same-row 判斷）
    const grid = w.document.getElementById('grid-underfill');
    const mainCol = w.document.getElementById('main-col-span12');
    const wrapperNormal = w.document.getElementById('wrapper-normal');
    assert.ok(grid && mainCol && wrapperNormal, 'fixture 元素齊全');
    stubRect(grid, { top: 100, width: 608, height: 300 });
    stubRect(mainCol, { top: 100, width: 296, height: 300 });
    stubRect(wrapperNormal, { top: 0, width: 608, height: 100 });

    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);

    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    const localHidden = w.__JRead.cleaner.clean(detected.el);

    try {
      // 核心斷言 1：grid-underfill 被 underfill 條件命中、collapse
      assert.strictEqual(grid.dataset.jreadCollapsed, '1',
        'grid underfill（visible children 寬度 296 < 608 × 0.7）應命中並 collapse');
      assert.strictEqual(grid.style.getPropertyValue('display'), 'block',
        'underfill collapse 後 display 應為 block');
      assert.strictEqual(grid.style.getPropertyPriority('display'), 'important',
        'display:block 應 !important（贏過 inline display:grid）');
      assert.strictEqual(grid.style.getPropertyValue('grid-template-columns'), 'none',
        'underfill collapse 後 grid-template-columns 應清為 none');

      // 核心斷言 2：visible child 的 grid-column / width / max-width 被 force override
      //（讓 child 脫離「grid-column: 6/span 12」的中間 12 欄限制，恢復全寬）
      assert.strictEqual(mainCol.style.getPropertyValue('grid-column'), 'auto',
        'visible child 的 grid-column 應 force 成 auto（覆寫 inline 6/span 12）');
      assert.strictEqual(mainCol.style.getPropertyPriority('grid-column'), 'important',
        'grid-column:auto 應 !important');
      assert.strictEqual(mainCol.style.getPropertyValue('width'), 'auto',
        'visible child 的 width 應 force 成 auto');
      assert.strictEqual(mainCol.style.getPropertyValue('max-width'), 'none',
        'visible child 的 max-width 應 force 成 none');

      // 核心斷言 3：wrapper-normal 非 grid，不得被誤動
      assert.notStrictEqual(wrapperNormal.dataset.jreadCollapsed, '1',
        '非 grid 的 wrapper 不得被 underfill 規則誤觸');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }

    // 核心斷言 4：restore 後 container 的 display / dataset 恢復、child 的
    // force override 已清除（priority 不再 important）
    assert.strictEqual(grid.style.getPropertyValue('display'), 'grid',
      'restore 後原 inline display:grid 應恢復');
    assert.strictEqual(grid.dataset.jreadCollapsed, undefined,
      'restore 後 data-jread-collapsed attribute 應被移除');
    assert.notStrictEqual(mainCol.style.getPropertyPriority('grid-column'), 'important',
      'restore 後 child 的 grid-column !important 覆寫應清除（回到原 shorthand 或空）');
    assert.notStrictEqual(mainCol.style.getPropertyValue('grid-column'), 'auto',
      'restore 後 child 的 grid-column value 不應為 auto（應回到 fixture 原值）');
  });

  it('主文內 grid container 單 child 且 child 寬度 ≈ container（無 underfill）→ 不得被誤 collapse', () => {
    // 邊界測試：grid underfill 新條件有 70% 閾值，確保「grid 有一個 child
    // 撐滿容器」（例如 Substack post 內容用 `display: grid` 1-col layout）
    // 不會被誤命中。若誤命中會把正常 block 化的 child 改動 style，
    // restore 時恐有殘餘。
    const html = `<!DOCTYPE html><html><head>
      <title>normal grid single child</title>
      <meta property="og:title" content="normal grid single child">
    </head><body>
      <article id="art">
        <h1>normal grid single child test</h1>
        <div class="grid-full" id="grid-full"
             style="display: grid; grid-template-columns: 1fr;">
          <div id="only-child">
            <p>NORMAL_GRID_MARK This child is spanning the full container width
            in a 1-col grid. Lots of padding text padding text padding text
            padding text padding text padding text padding text to pass detector.</p>
          </div>
        </div>
      </article>
    </body></html>`;
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    const grid = w.document.getElementById('grid-full');
    const child = w.document.getElementById('only-child');
    // container = 608, child = 608（100% 佔滿，不觸發 underfill）
    stubRect(grid, { top: 0, width: 608, height: 200 });
    stubRect(child, { top: 0, width: 608, height: 200 });

    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);

    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中');
    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      assert.notStrictEqual(grid.dataset.jreadCollapsed, '1',
        '單 child 且 child 寬度 ≈ container 的 grid 不得被誤 collapse');
      // inline display 應保持原 grid 不加 !important
      assert.strictEqual(grid.style.getPropertyValue('display'), 'grid',
        '未觸發 collapse 的 grid 原 inline display 應保持');
      assert.strictEqual(grid.style.getPropertyPriority('display'), '',
        '未觸發 collapse 的 grid 原 inline display 不應有 !important');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('主文內 cross-origin iframe（YouTube embed）不得被 empty-spacer / action-row 規則誤殺', () => {
    // Dwarkesh (Substack) YouTube embed 實測：cross-origin iframe 的
    // textContent = ""（跨域讀不到內部 DOM）+ querySelector 讀不到內部媒體
    // + rect.height > 60 → 三條 empty-spacer 條件全命中、被錯殺。iframe
    // 本身就是媒體內容，必須在 empty-spacer / action-row 規則前 early-skip。
    // 通則：iframe / video / audio 這三個「媒體元素 tag」本身是內容不是容器，
    // cleaner 的容器型規則永遠跳過。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'dwarkesh-youtube-embed.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);

    // stub iframe rect 模擬真實 Chrome 下有 600px 高度——這樣 empty-spacer 的
    // rect.height >= 60 條件會命中，唯一能保住 iframe 的就是 tag-name early-skip
    const iframe = w.document.querySelector('iframe');
    assert.ok(iframe, 'fixture 必須含 YouTube iframe');
    iframe.getBoundingClientRect = () => ({
      top: 200, bottom: 800, left: 0, right: 600, width: 600, height: 600, x: 0, y: 200
    });

    const detected = w.__JRead.detector.detect();
    assert.ok(detected);
    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      assert.notStrictEqual(iframe.dataset.jreadHidden, '1',
        'YouTube iframe（cross-origin、textContent 空、高 > 60px）絕不可被 empty-spacer 規則 hide');
      assert.notStrictEqual(iframe.style.display, 'none',
        'YouTube iframe 的 inline display 不得被 cleaner 設為 none');
      // 包住 iframe 的 youtube-inner / youtube-wrap 不該被誤殺
      const inner = w.document.querySelector('.youtube-inner');
      const wrap = w.document.querySelector('.youtube-wrap');
      assert.notStrictEqual(inner.dataset.jreadHidden, '1',
        '.youtube-inner（含 iframe）不得被 hide');
      assert.notStrictEqual(wrap.dataset.jreadHidden, '1',
        '.youtube-wrap（含 iframe 子孫）不得被 hide');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('純 aspect-ratio 容器（Engadget pattern）不得被 reset，padding-hack（Substack pattern）必須被 reset', () => {
    // v0.6.14 修法：CSS `:has(> img)` 無法區分兩種 pattern，搬到 cleaner
    // runtime 以 padding-bottom / width 比例判斷：
    //   A) padding-bottom: 56.25% → reset（img absolute → static）
    //   B) aspect-ratio: 16/9 且 padding-bottom: 0 → 不動
    const engadgetHtml = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'engadget-aspect-ratio-image.html'),
      'utf8'
    );
    const engadgetDom = new JSDOM(engadgetHtml, { runScripts: 'outside-only' });
    const ew = engadgetDom.window;
    ew.__JRead = { state: {}, MSG: {} };
    ew.eval(DETECTOR_SRC);
    ew.eval(CLEANER_SRC);
    const engDet = ew.__JRead.detector.detect();
    assert.ok(engDet, 'Engadget 主文必須被偵測到');
    const engWrap = ew.document.querySelector('.aspect-ratio-wrapper');
    const engImg = ew.document.querySelector('.aspect-ratio-wrapper > img');
    assert.ok(engWrap && engImg);
    // 進閱讀模式前原 inline style snapshot
    const engWrapBefore = engWrap.getAttribute('style');
    const engImgBefore = engImg.getAttribute('style');

    const engHidden = ew.__JRead.cleaner.clean(engDet.el);
    try {
      // 核心斷言：純 aspect-ratio 容器的 padding-bottom、img 的 position 都不得被動
      assert.notStrictEqual(engWrap.style.getPropertyPriority('padding-bottom'), 'important',
        '純 aspect-ratio 容器（padding-bottom: 0）不得被 reset');
      assert.notStrictEqual(engImg.style.getPropertyValue('position'), 'static',
        '純 aspect-ratio 容器內的 img 不得被改成 static（會破壞 absolute inset:0 layout）');
    } finally {
      ew.__JRead.cleaner.restore(engHidden);
    }
    assert.strictEqual(engWrap.getAttribute('style'), engWrapBefore,
      'restore 後 aspect-ratio 容器的 inline style 必須完全還原');
    assert.strictEqual(engImg.getAttribute('style'), engImgBefore,
      'restore 後 img 的 inline style 必須完全還原');

    // --- padding-hack 這邊必須被 reset ---
    const hackHtml = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'substack-padding-hack-image.html'),
      'utf8'
    );
    const hackDom = new JSDOM(hackHtml, { runScripts: 'outside-only' });
    const hw = hackDom.window;
    hw.__JRead = { state: {}, MSG: {} };
    hw.eval(DETECTOR_SRC);
    hw.eval(CLEANER_SRC);
    const hackDet = hw.__JRead.detector.detect();
    assert.ok(hackDet);
    const hackWrap = hw.document.querySelector('.padding-hack-wrapper');
    const hackImg = hw.document.querySelector('.hack-img');
    assert.ok(hackWrap && hackImg);
    const hackWrapBefore = hackWrap.getAttribute('style');
    const hackImgBefore = hackImg.getAttribute('style');

    const hackHidden = hw.__JRead.cleaner.clean(hackDet.el);
    try {
      // padding-hack container：padding-bottom 被 reset 成 0（jsdom 可能 serialize 為 "0" 或 "0px"）
      assert.match(hackWrap.style.getPropertyValue('padding-bottom'), /^0(?:px)?$/,
        'padding-hack container 的 padding-bottom 應被 reset 為 0 / 0px');
      assert.strictEqual(hackWrap.style.getPropertyPriority('padding-bottom'), 'important',
        'padding-bottom reset 必須帶 !important（贏過原站 stylesheet）');
      // img 被改成 static，不再佔 absolute
      assert.strictEqual(hackImg.style.getPropertyValue('position'), 'static',
        'padding-hack 內的 img 應被改成 static，讓它依 intrinsic size 自然流版');
      assert.strictEqual(hackImg.style.getPropertyPriority('position'), 'important',
        'position: static 必須帶 !important');
      // top/left/right/bottom 被清
      assert.strictEqual(hackImg.style.top, '', 'img top 應被清');
      assert.strictEqual(hackImg.style.left, '', 'img left 應被清');
    } finally {
      hw.__JRead.cleaner.restore(hackHidden);
    }
    // 還原後 container padding-bottom 回到 56.25%，img position 回到 absolute
    // （字串比較太嚴——jsdom 會把 `top: 0` serialize 成 `top: 0px`、property 順序也可能重排，
    // 所以只驗語意等價而非完整字串）
    assert.strictEqual(hackWrap.style.paddingBottom, '56.25%',
      'restore 後 padding-hack 容器 padding-bottom 應回到 56.25%');
    assert.strictEqual(hackWrap.style.getPropertyPriority('padding-bottom'), '',
      'restore 後 padding-bottom 不應殘留 !important');
    assert.strictEqual(hackImg.style.position, 'absolute',
      'restore 後 img position 應回到 absolute');
    assert.strictEqual(hackImg.style.getPropertyPriority('position'), '',
      'restore 後 img position 不應殘留 !important');
  });

  it('restore() 後 observer disconnect，新 append 不再被攔截', async () => {
    NS.cleaner.restore(hidden);
    hidden = [];  // 避免 afterEach 重複 restore

    const parent = articleEl.parentElement;
    const countBefore = parent.children.length;

    const div = document.createElement('div');
    div.className = 'post-reader-mode-append';
    div.textContent = 'POST_RESTORE_MARK';
    parent.appendChild(div);
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(parent.children.length, countBefore + 1,
      'reader mode 退出後新 append 應保留（observer 已 disconnect）');
    assert.ok(parent.contains(div),
      'restore() 後新節點不得被誤 remove');
  });
});
