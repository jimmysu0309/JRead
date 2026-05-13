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
const { loadFixtureWithScripts, SRC } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');
// 同時保留 SRC 常數，供部分 test 直接 `window.eval(DETECTOR_SRC)` 用（ad-hoc fixtures 如 inline HTML）。
const DETECTOR_SRC = SRC.detector;
const CLEANER_SRC = SRC.cleaner;

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
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: VW, height: VH },
    pretendToBeVisual: true
  });
  // stub fixed/sticky 元素的 rect
  for (const [sel, rect] of Object.entries(FIXED_RECTS)) {
    const el = env.document.querySelector(sel);
    assert.ok(el, `fixture 中應存在 ${sel}`);
    stubRect(el, rect);
  }
  return env.window;
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

  it('主文 parent 新 append 的節點會被 hide（v0.7.31 popIn infinite-scroll 攔截 改 hide 不 remove）', async () => {
    // v0.7.31 cnyes 修法：MutationObserver 對 articleEl 外 added node 從
    // `removeChild` 改成 `hide()`——避免跟 React/Next.js reconciliation 競賽
    // 觸發 NotFoundError、整個 SPA layout 崩潰。視覺結果等同（display:none）。
    const parent = articleEl.parentElement;
    assert.ok(parent, '主文必須有 parent');

    const div = await appendFakePopInArticle(parent, 'DYNAMIC_NEXT_ARTICLE_MARK 偷載飛彈推進劑原料？');

    // node 仍在 DOM、但被 hide
    assert.ok(parent.contains(div), 'append 的節點應仍在 DOM（不再 removeChild）');
    assert.strictEqual(div.dataset.jreadHidden, '1',
      '新 append 的節點應被 observer hide；forcing：拿掉 hide(node, hiddenList) 呼叫 → fail');
    assert.strictEqual(div.style.display, 'none',
      'inline display 應為 none');
    assert.strictEqual(div.style.getPropertyPriority('display'), 'important',
      'inline !important priority（贏過原站 stylesheet）');
  });

  it('主文祖先鏈更外層新 append 也會被 hide（多層 parent 都觀察）', async () => {
    const body = document.body;

    const div = document.createElement('div');
    div.className = 'injected-footer-ad';
    div.textContent = 'LATE_AD_MARK';
    body.appendChild(div);
    await new Promise(r => setTimeout(r, 0));

    assert.ok(body.contains(div), 'append 的節點仍在 DOM');
    assert.strictEqual(div.dataset.jreadHidden, '1',
      '祖先鏈更外層（body）新 append 的節點也應被 hide');
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

  it('主文內 <aside> tag sidebar（條件 B，chinatimes 類）：即使 aside textLen > main × 50%（hot-news 列表 10 條超過主文一半）仍應 hide——條件 B 不檢查 textLen 比值，僅靠「aside tag + rectH > 400」絕對結構特徵命中', () => {
    // 2026-04-23 chinatimes.com/realtimenews/20260423000917-260410 實測：
    // article.article-box > column-wrapper > [header, column-left(main),
    // aside.column-right(hot-news), column-left(secondary)]。harness 時序
    // race 下 aside textLen 1389、main column-left textLen 2457，aside/main
    // 比值 0.565，超過原 SIDEBAR_ASIDE_TEXT_RATIO=0.5 門檻漏網，reader
    // mode 下整塊財經熱門新聞 sidebar 殘留。修法：拿掉 condition B 的
    // textLen 比值檢查，只保留「aside tag + rectH > 400」。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'chinatimes-aside-high-text-ratio.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;

    const aside = w.document.querySelector('aside.column-right');
    const mainCol = w.document.querySelector('div.column-left.main');
    assert.ok(aside && mainCol);

    // stub rect：aside 高 1349（> 400 命中），main 高 1500
    stubRect(aside, { top: 100, width: 300, height: 1349 });
    stubRect(mainCol, { top: 100, width: 600, height: 1500 });

    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);

    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    const localHidden = w.__JRead.cleaner.clean(detected.el);

    try {
      // forcing function：若 cleaner 恢復「s.textLen < main.textLen * 0.5」
      // 檢查，chinatimes 這類 aside textLen 超過 main × 50% 的 case 會漏網。
      const mainLen = (mainCol.textContent || '').replace(/\s+/g, ' ').trim().length;
      const asideLen = (aside.textContent || '').replace(/\s+/g, ' ').trim().length;
      assert.ok(asideLen > mainLen * 0.5,
        `fixture 設計要求 aside textLen (${asideLen}) > main × 50% (${mainLen * 0.5}) 才能 forcing——否則修法失效也會過`);

      // 核心斷言 1：aside.column-right 被 hide（新條件 B 只看 rectH > 400）
      assert.strictEqual(aside.dataset.jreadHidden, '1',
        'aside tag + rectH > 400 應被條件 B 命中 hide，不管 textLen 相對比值');

      // 核心斷言 2：主欄 column-left.main 保留
      assert.notStrictEqual(mainCol.dataset.jreadHidden, '1',
        '主欄不得被 hide');
      assert.ok(mainCol.textContent.includes('CHINATIMES_MAIN_MARK'));

      // 核心斷言：文末「也許您會感興趣」第三方推薦 widget section 被 keyword
      // heuristic 命中 hide（class `.dable-recommend .popin-recommend
      // .taboola-recommend` 三個都是動詞詞根 `recommend`，舊名單只有
      // `recommended` 形容詞會漏網）。
      const recommendSection = w.document.querySelector('section.dable-recommend');
      assert.ok(recommendSection, 'fixture 應含 dable-recommend section');
      assert.strictEqual(recommendSection.dataset.jreadHidden, '1',
        'section.dable-recommend.popin-recommend.taboola-recommend 必須被 NOISE_KEYWORD_RE 命中 hide——cleaner 關鍵字名單需含 `recommend` 動詞詞根，不只 `recommended` 形容詞');

      // 核心斷言 3：aside 被 hide 後 column-wrapper 觸發 float-layout collapse
      // —— column-left 身上的 `float: left` 必須被清除，否則主欄仍維持
      // 308px 固定寬、右側空白殘留（本次 bug 的核心症狀）。
      assert.strictEqual(mainCol.style.getPropertyPriority('float'), 'important',
        'float-layout collapse 應對 visible column-left 強制 float: none !important');
      assert.strictEqual(mainCol.style.float, 'none',
        'column-left 的 float 必須被 reset 成 none，才能撐滿整個 column-wrapper');
      assert.strictEqual(mainCol.style.getPropertyPriority('width'), 'important',
        'column-left 的 width 必須 auto !important（配合 float: none 後撐滿 container）');
    } finally {
      w.__JRead.cleaner.restore(localHidden);

      // 核心斷言 4：restore 後 float / width 必須還原（本 fixture 原 inline
      // `float: left; width: 308px;` 應該保留不被吃掉）
      assert.strictEqual(mainCol.style.float, 'left',
        'restore 後 column-left 的 float 必須還原成原 inline 值 left');
      assert.strictEqual(mainCol.style.width, '308px',
        'restore 後 column-left 的 width 必須還原成原 inline 值 308px');
    }
  });

  it('主文內中等大小 sidebar column（條件 C，esmchina /news/14116 Bootstrap col-md-3 widget cluster）：main >= sibling × 3 + sibling linkDensity > 0.5 + sibling textLen >= 200 → hide；條件 A 0.1 ratio 不命中（sibling/main = 0.23）', () => {
    // 2026-05-13 esmchina.com/news/14116.html 實測：detector 選 DIV.container
    // （Bootstrap row + col-md-9 主文 + col-md-3 sidebar 三 children 全在
    // articleEl 內）。sidebar 含「近期热点 / EE直播间 / 在线研讨会 / 热门标签」
    // 整批 widget link cluster——但 sidebar.textLen ≈ 4.7K，main ≈ 20K，
    // sidebar/main = 0.23 > 條件 A 0.1 ratio 漏網；sidebar 是 `<div>` 不是
    // `<aside>` 也不命中條件 B。
    // 新條件 C：main >= sibling × 3 + sibling.ld > 0.5 + sibling.textLen >= 200
    // → 涵蓋「Bootstrap 兩欄主文+widget sidebar」中等大小 sidebar；條件 A
    // （極小極密）與條件 C（中等大小高 ld）互補不重疊。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'esmchina-bootstrap-sidebar.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);

    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中主文容器');

    // 提供 fixture 中 sidebar / main 的真實 textLen 比值給 forcing function
    const sidebar = w.document.querySelector('.col-md-3.rightsection');
    const mainCol = w.document.querySelector('.col-md-9.article-left');
    assert.ok(sidebar && mainCol, 'fixture 必須含 col-md-9 主欄 + col-md-3 sidebar');

    function norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
    function linkDensity(el) {
      const txt = norm(el.textContent);
      if (!txt.length) return 0;
      let linkLen = 0;
      for (const a of el.querySelectorAll('a')) linkLen += norm(a.textContent).length;
      return linkLen / txt.length;
    }
    const sidebarLen = norm(sidebar.textContent).length;
    const mainLen = norm(mainCol.textContent).length;
    const sidebarLd = linkDensity(sidebar);

    // Forcing function（fixture 安全保證）：
    //   - sibling/main 比值 > 0.1（條件 A 漏網，必須靠條件 C）
    //   - main/sibling >= 3（條件 C 命中）
    //   - sibling.ld > 0.5（條件 C 命中）
    //   - sibling.textLen >= 200（條件 C 命中）
    assert.ok(sidebarLen / mainLen > 0.1,
      `fixture forcing: sidebar/main (${(sidebarLen / mainLen).toFixed(3)}) 必須 > 0.1，否則條件 A 命中、無法 forcing 條件 C`);
    assert.ok(mainLen >= sidebarLen * 3,
      `fixture forcing: main (${mainLen}) >= sidebar (${sidebarLen}) × 3 才能 forcing 條件 C`);
    assert.ok(sidebarLd > 0.5,
      `fixture forcing: sidebar linkDensity (${sidebarLd.toFixed(3)}) > 0.5 才能 forcing 條件 C`);
    assert.ok(sidebarLen >= 200,
      `fixture forcing: sidebar textLen (${sidebarLen}) >= 200 才能 forcing 條件 C`);

    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      // 核心斷言 1：col-md-3 sidebar 整塊被 hide
      assert.strictEqual(sidebar.dataset.jreadHidden, '1',
        'col-md-3.rightsection sidebar widget cluster 必須被條件 C 命中 hide');

      // 核心斷言 2：col-md-9 主欄保留
      assert.notStrictEqual(mainCol.dataset.jreadHidden, '1',
        'col-md-9.article-left 主欄不得被 hide');
      assert.ok(mainCol.textContent.includes('ESMCHINA_MAIN_MARK'),
        '主欄應含 ESMCHINA_MAIN_MARK');

      // 核心斷言 3：sidebar 內所有 widget 標題段（近期热点 / EE直播间 /
      // 在线研讨会 / 热门标签）視覺上消失——靠祖先 hide 連帶 invisible
      const widgetLinks = sidebar.querySelectorAll('a');
      assert.ok(widgetLinks.length >= 15, `sidebar 至少含 15 個 widget 連結，實際 ${widgetLinks.length}`);

      // 核心斷言 4：detector 容器本身不被 hide
      assert.notStrictEqual(detected.el.dataset.jreadHidden, '1',
        'detector 選的主文容器本身不得被 hide');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('udn 類 wrapper-promoted article 後方 5 個雜訊 sibling sections 被 NOISE_KEYWORD_RE 擴充名單命中 hide：more-news / related-news / sponsor / discuss / taboola', () => {
    // 2026-04-23 udn.com/news/story/124844/9460037 實測：detector promote 到
    // section.article-content__wrapper（納入 h1 + cover figure），其下 5 個
    // sibling sections（article 之後）靠主文內 keyword heuristic 清。既有
    // 名單缺 more-news / related-news / sponsor / discuss / taboola，全部漏網。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'udn-article-siblings-noise.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);

    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 article / wrapper');
    const localHidden = w.__JRead.cleaner.clean(detected.el);

    try {
      // 逐一驗每個 sibling section 都被 keyword hide
      const more = w.document.querySelector('section.more-news');
      const related = w.document.querySelector('section.related-news');
      const taboola = w.document.querySelector('#taboola-below-article-thumbnails');
      const sponsor = w.document.querySelector('section.sponsor-ads');
      const discuss = w.document.querySelector('section.discuss-board');

      assert.strictEqual(more.dataset.jreadHidden, '1',
        'section.more-news 必須被 NOISE_KEYWORD_RE 的 `more-news` alternation 命中 hide（udn 延伸閱讀）');
      assert.strictEqual(related.dataset.jreadHidden, '1',
        'section.related-news 必須被 `related-news` alternation 命中 hide（原 `related-articles` 不 match `related-news`）');
      assert.strictEqual(taboola.dataset.jreadHidden, '1',
        'div#taboola-below-article-thumbnails 必須被 `taboola` 命中 hide');
      assert.strictEqual(sponsor.dataset.jreadHidden, '1',
        'section.sponsor-ads 必須被 `sponsor` 動詞詞根命中 hide（既有 `sponsored` 不 match `sponsor-ads`）');
      assert.strictEqual(discuss.dataset.jreadHidden, '1',
        'section.discuss-board 必須被 `discuss` 動詞詞根命中 hide（既有 `discussion` 不 match `discuss-board`）');

      // 主文保留（UDN_MAIN_MARK 段落所在的 <p> 不得被 hide）
      const mainP = Array.from(w.document.querySelectorAll('p')).find(
        p => p.textContent.includes('UDN_MAIN_MARK'));
      assert.ok(mainP, 'fixture 應含 UDN_MAIN_MARK 段落');
      assert.notStrictEqual(mainP.dataset.jreadHidden, '1',
        '主文段落不得被 hide');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('twz.com 類 wrapper class 含 `paywall` keyword 但內含 47 個 p + 8 個 h2 主文 → 觸發 wrapperContainsArticleAnchor guard，主文保留；同 article 內短 widget（newsletter / author-bio）仍被 keyword hide', () => {
    // 2026-04-28 twz.com/space/this-is-how-... 實測：detector 選對
    // article#post-6450352，但其內主文 wrapper class 為
    // `entry-content Article-bodyText paywall border-b-2 w-full mb-6`，
    // `paywall` keyword 命中 NOISE_KEYWORD_RE 後整塊主文（47 p + 8 h2 + 23K
    // 字）被 hide，reader card 變空白。CMS（Recurrent Ventures）用
    // `paywall` class 反向標「付費牆已解鎖內文」、語意完全相反。
    // 既有「含 h1 → 跳過」guard 不及（h1 在 article 外層 header、不在此
    // wrapper 內）。修法：keyword 命中後若 wrapper 含主文 anchor（>=100
    // chars 單一 p / 累計 >= 300 / title-anchor element 三道之一），視為
    // 主文容器、不 hide。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'twz-paywall-class-content-wrapper.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);

    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 article#post-6450352');
    const localHidden = w.__JRead.cleaner.clean(detected.el);

    try {
      const paywallWrapper = w.document.querySelector('.entry-content.paywall');
      assert.ok(paywallWrapper, 'fixture 應含 paywall class wrapper');
      assert.notStrictEqual(paywallWrapper.dataset.jreadHidden, '1',
        '主文 wrapper（class 含 paywall keyword 但實際包整篇主文）不得被 hide——wrapperContainsArticleAnchor guard 必須命中');

      // 進一步驗主文內所有 p / h2 都沒被祖先連帶 hide
      const mainPs = paywallWrapper.querySelectorAll('p');
      assert.ok(mainPs.length >= 5, 'fixture paywall wrapper 應含 >= 5 個 p');
      for (const p of mainPs) {
        assert.ok(!p.closest('[data-jread-hidden="1"]'),
          `主文 p 不得有任一祖先被 hide（textHead: "${(p.textContent||'').slice(0,40)}..."）`);
      }
      const mainH2s = paywallWrapper.querySelectorAll('h2');
      for (const h2 of mainH2s) {
        assert.ok(!h2.closest('[data-jread-hidden="1"]'),
          `主文 h2 不得有任一祖先被 hide（text: "${(h2.textContent||'').slice(0,40)}"）`);
      }

      // 短 widget 仍須被 keyword hide（驗 guard 不會把短 widget 也豁免）
      const newsletter = w.document.querySelector('.recurrent-newsletter-block');
      assert.ok(newsletter, 'fixture 應含 newsletter widget');
      assert.strictEqual(newsletter.dataset.jreadHidden, '1',
        'newsletter widget（class 含 newsletter keyword、p 短於 100 chars 不觸發 anchor guard）必須被 hide');

      const authorWidget = w.document.querySelector('.recurrent-author-widget');
      assert.ok(authorWidget, 'fixture 應含 author widget');
      assert.strictEqual(authorWidget.dataset.jreadHidden, '1',
        'author widget（class 含 author-widget keyword、p 短於 100 chars 不觸發 anchor guard）必須被 hide');

      // v0.7.84：右側 article sidebar 必須被 hide
      // class 命中 article-sidebar-wrapper / article-sidebar token。
      const sidebarWrapper = w.document.querySelector('.article-sidebar-wrapper');
      assert.ok(sidebarWrapper, 'fixture 應含 article-sidebar-wrapper');
      assert.strictEqual(sidebarWrapper.dataset.jreadHidden, '1',
        'article-sidebar-wrapper 必須被 NOISE_KEYWORD_RE 新加的 `sidebar-wrapper` alternation 命中 hide（既有 hideInsideArticleSidebarColumns 條件 B 只檢查 direct-child aside、條件 A 對低 linkDensity sidebar 漏網）');
      const sidebarAside = w.document.querySelector('#article-sidebar');
      assert.ok(sidebarAside, 'fixture 應含 #article-sidebar');
      assert.ok(sidebarAside.closest('[data-jread-hidden="1"]'),
        'aside#article-sidebar 必須被祖先 hide（自己也應命中 article-sidebar token）');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('v0.7.85 業界對標 noise keyword 全覆蓋：Mozilla Readability / Postlight Parser / Unclutter / EasyList 蒐集的新 token 各自 wrapper 命中 hide（forcing：退回舊名單會讓對應 token assertion 一條條 fail）', () => {
    // v0.7.85：上網蒐集 Mozilla Readability.js REGEXPS / Postlight Parser
    // UNLIKELY_CANDIDATES_BLACKLIST + NEGATIVE_SCORE_HINTS / Unclutter
    // contentBlock.ts / EasyList element-hiding generic / uBlock annoyances
    // 對應 token list 後的補強。每個新 token 用一個短結構 wrapper，必須被
    // shouldHideByKeyword 命中。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'generic-noise-keyword-coverage.html'),
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
      // 每個 token 對應一個 class，驗該 wrapper 必須被 hide（自身或祖先）
      const expectedHidden = [
        // 品牌/服務名
        '.addthis-toolbox', '.sharedaddy', '.ai2html-graphic', '.sociable-button',
        '.dianomi-context', '.adsense-banner', '.adslot-300x250',
        '.onesignal-prompt', '.intercom-launcher', '.printfriendly-button',
        '.instapaper_ignore', '.blogger-labels-list', '.smartfeed-container',
        '.mpu-slot',
        // 廣告 / 付費牆變體
        '.advert-block', '.adbox-300', '.adhesion-bar', '.metered-content-paywall',
        '.interstitial-ad', '.takeover-banner',
        // 留言 / 社群
        '.replies-thread', '.remark-form', '.shoutbox-widget',
        '#respond', '.composer-textarea', '.combx-list',
        // 結構雜訊
        '.supplemental-block', '.cover-wrap-hero', '.entry-unrelated-block',
        '.crumb-trail', '.recirc-module', '.nag-banner', '.modal-backdrop',
        '.topbar-tools', '.announcement-bar', '.popover-tooltip', '.drawer-menu',
        '.image-loader-spinner', '.contact-us-block', '.shopping-cart-promo',
        '.plea-fundraiser',
        // 推薦 / 相關文章 變體
        '.next-article-card', '.latest-posts-feed', '.mostread-list',
        '.most-read-list'
      ];

      const missed = [];
      for (const sel of expectedHidden) {
        const el = w.document.querySelector(sel);
        if (!el) {
          missed.push(`${sel} (selector 不存在於 fixture)`);
          continue;
        }
        const own = el.dataset.jreadHidden === '1';
        const ancestor = !!el.closest('[data-jread-hidden="1"]');
        if (!own && !ancestor) {
          missed.push(sel);
        }
      }
      assert.deepStrictEqual(missed, [],
        `下列 noise keyword wrapper 沒被 hide（NOISE_KEYWORD_RE 漏 alternation）：${missed.join(', ')}`);

      // 主文段落保留
      const mainPs = w.document.querySelectorAll('article > p');
      assert.ok(mainPs.length >= 3, 'fixture 應有 >= 3 個主文 p');
      for (const p of mainPs) {
        assert.notStrictEqual(p.dataset.jreadHidden, '1',
          `主文 p 不得被 hide（textHead: "${(p.textContent||'').slice(0,40)}..."）`);
        assert.ok(!p.closest('[data-jread-hidden="1"]'),
          `主文 p 祖先不得被 hide`);
      }
      // h1 保留
      const h1 = w.document.querySelector('article > h1');
      assert.ok(h1, 'fixture 應有 article 內 h1');
      assert.notStrictEqual(h1.dataset.jreadHidden, '1', '主文 h1 不得被 hide');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('主文內第三方廣告服務標識符（GAM div-gpt-ad / google_ads_iframe / Taboola trc_*  / popIn _popIn_* / Outbrain / ad-*）→ hideInsideArticleByThirdPartyAds 各 selector branch 全命中，主文保留', () => {
    // 2026-04-23 v0.7.4 EasyList spike 結論：Jimmy 四站實測（line today / udn
    // / chinatimes / upmedia）reader mode 內的殘留廣告指向第三方廣告服務
    // 標準識別（Google Ad Manager 官方推薦命名 `div-gpt-ad-*`、Taboola 官方
    // widget class prefix `trc_*`、popIn 官方 class `_popIn_*`、Outbrain
    // `OUTBRAIN` class）。這些是跨站業界慣例、結構性通則，非站點特判（硬
    // 規則 3）。cleaner 新增 hideInsideArticleByThirdPartyAds 一次解決。
    // Forcing function 設計：每個 selector branch 對應一個 fixture 元素，
    // 移除任一 selector → 對應 assertion fail。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'third-party-ads-inside-article.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);

    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    const localHidden = w.__JRead.cleaner.clean(detected.el);

    try {
      // Google Ad Manager / GPT
      const gptAd = w.document.getElementById('div-gpt-ad-1234567890-0');
      assert.ok(gptAd);
      assert.strictEqual(gptAd.dataset.jreadHidden, '1',
        '`[id^="div-gpt-ad"]` selector 必須命中 hide（Google Ad Manager 官方推薦 id 命名）');

      // google_ads_iframe name / id
      const gaIframe = w.document.getElementById('google_ads_iframe_article_0');
      assert.ok(gaIframe);
      assert.strictEqual(gaIframe.dataset.jreadHidden, '1',
        '`iframe[name^="google_ads_iframe"]` / `iframe[id^="google_ads_iframe"]` 必須命中 hide');

      // googlesyndication / doubleclick iframe src
      const iframes = w.document.querySelectorAll('iframe');
      let synIframe = null, dcIframe = null;
      for (const f of iframes) {
        const src = f.getAttribute('src') || '';
        if (src.includes('googlesyndication.com')) synIframe = f;
        if (src.includes('doubleclick.net')) dcIframe = f;
      }
      assert.ok(synIframe && dcIframe);
      assert.strictEqual(synIframe.dataset.jreadHidden, '1',
        'googlesyndication.com iframe 必須命中 hide');
      assert.strictEqual(dcIframe.dataset.jreadHidden, '1',
        'doubleclick.net iframe 必須命中 hide');

      // Taboola class prefix trc_
      const trcExcl = w.document.querySelector('.trc_excludable');
      const trcRbox = w.document.querySelector('.trc_rbox');
      assert.ok(trcExcl && trcRbox);
      assert.strictEqual(trcExcl.dataset.jreadHidden, '1',
        '`[class*="trc_"]` selector 必須命中 Taboola trc_excludable widget');
      assert.strictEqual(trcRbox.dataset.jreadHidden, '1',
        '`[class*="trc_"]` selector 必須命中 Taboola trc_rbox widget');

      // Taboola id
      const trcId = w.document.getElementById('taboola-below-article-thumbnails');
      assert.ok(trcId);
      assert.strictEqual(trcId.dataset.jreadHidden, '1',
        '`[id*="taboola"]` selector 必須命中 Taboola thumbnails widget');

      // popIn
      const popIn = w.document.querySelector('._popIn_recommend_article');
      assert.ok(popIn);
      assert.strictEqual(popIn.dataset.jreadHidden, '1',
        '`[class*="_popIn_"]` selector 必須命中 popIn Discovery 推薦 widget');

      // Outbrain
      const outbrain = w.document.querySelector('.OUTBRAIN');
      assert.ok(outbrain);
      assert.strictEqual(outbrain.dataset.jreadHidden, '1',
        '`[class*="OUTBRAIN"]` selector 必須命中 Outbrain widget');

      // 通用 ad- prefix id
      const adId = w.document.getElementById('ad-leaderboard-top');
      assert.ok(adId);
      assert.strictEqual(adId.dataset.jreadHidden, '1',
        '`[id^="ad-"]` selector 必須命中通用 ad- prefix id');

      // 通用 ad- prefix class
      const adClass = w.document.querySelector('.ad-detail');
      assert.ok(adClass);
      assert.strictEqual(adClass.dataset.jreadHidden, '1',
        '`[class^="ad-"]` selector 必須命中通用 ad- prefix class');

      // BBC / React component data-testid / data-component pattern
      // （v0.7.8 Jimmy 實測 bbc.com/news/articles/clyepyy82kxo 右側占位）
      // fixture id 刻意無 ad 邊界、class 是 sc-hash，只能靠 data attribute
      // 命中——forcing 退回 THIRD_PARTY_AD_SEL 前版本 → 這三條 assertion fail
      const bbcAdUnit = w.document.getElementById('bbc-react-slot-1');
      assert.ok(bbcAdUnit);
      assert.strictEqual(bbcAdUnit.dataset.jreadHidden, '1',
        '`[data-testid="ad-unit"]` selector 必須命中 BBC styled-components 廣告 wrapper（class 是 sc-hash、id 無 ad 邊界、只有 data-testid="ad-unit" 可識別）');

      const bbcAdSlotTestid = w.document.getElementById('bbc-react-slot-2');
      assert.ok(bbcAdSlotTestid);
      assert.strictEqual(bbcAdSlotTestid.dataset.jreadHidden, '1',
        '`[data-testid="ad-slot"]` selector 必須命中');

      const bbcAdUnitComponent = w.document.getElementById('bbc-react-slot-3');
      assert.ok(bbcAdUnitComponent);
      assert.strictEqual(bbcAdUnitComponent.dataset.jreadHidden, '1',
        '`[data-component="ad-unit"]` selector 必須命中');

      // 主文段落保留（forcing：若 THIRD_PARTY_AD_SEL 寫錯誤殺 <p> 會 fail）
      const mainPs = Array.from(w.document.querySelectorAll('p')).filter(
        p => p.textContent.includes('THIRDPARTY_MAIN_MARK'));
      assert.ok(mainPs.length >= 2,
        'fixture 應含至少 2 個 THIRDPARTY_MAIN_MARK 段落（頭尾）');
      for (const p of mainPs) {
        assert.notStrictEqual(p.dataset.jreadHidden, '1',
          `主文段落「${p.textContent.slice(0, 30)}...」不得被任何第三方廣告 selector 誤殺`);
      }
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('主文內 button cluster（現代 CSS-in-JS 把 button 用 display:contents 包層層 div 的 BBC 類 pattern）→ 專門 hide 該 cluster，保留作者/日期', () => {
    // BBC 文章頭部 byline row 實測：cSUzvu 內 3 個 button（Share/Save/
    // Add as preferred on Google）每個都被 div + display:contents 層層包
    // 起來——direct children 全是 div → 既有 hideInsideArticleActionRows
    // 的「interactive ratio < 50% 且 selfText ≥ 20 字」排除會跳過，盲點。
    // 新 hideInsideArticleButtonClusters 遞迴找 button 數、檢 textLen 上限
    // + button 外文字 < 10 字 → hide 純 cluster，ChinaTalk byline 的
    // meta-group（作者/日期在 button 外 > 10 字）保留。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'bbc-byline-button-cluster.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);

    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    const localHidden = w.__JRead.cleaner.clean(detected.el);

    try {
      // 核心斷言 1：button cluster 被 hide
      const cluster = w.document.getElementById('button-cluster');
      assert.ok(cluster);
      assert.strictEqual(cluster.dataset.jreadHidden, '1',
        'BBC 類 button cluster（純 Share/Save/Add buttons 包 display:contents）' +
        '應被 hideInsideArticleButtonClusters 命中 hide');

      // 核心斷言 2：byline row 外層（含日期 + 作者文字 > 10 chars）保留
      const row = w.document.getElementById('byline-row');
      assert.ok(row);
      assert.notStrictEqual(row.dataset.jreadHidden, '1',
        'byline row 外層（button 外有日期 + 作者 > 10 chars）不得被誤殺');

      // 核心斷言 3：日期、作者 meta 保留
      const dateCol = w.document.getElementById('date-col');
      const authorCol = w.document.getElementById('author-col');
      assert.ok(dateCol && authorCol);
      assert.notStrictEqual(dateCol.dataset.jreadHidden, '1', '日期不得被 hide');
      assert.notStrictEqual(authorCol.dataset.jreadHidden, '1', '作者不得被 hide');
      assert.ok(authorCol.textContent.includes('James Gallagher'));
      assert.ok(dateCol.textContent.includes('3 days ago'));

      // 核心斷言 4：主文內容保留
      const body = w.document.querySelector('p');
      assert.ok(body.textContent.includes('BBC_BODY_MARK'));
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('主文內 button cluster 含「純 a[href] 視覺按鈕 + 真 button」混合（Engadget 類）→ interactive 擴展到 a[href] + 仍需 ≥ 1 真 button 才命中', () => {
    // Engadget 實測結構：byline 右側 cluster 3 direct children：
    //   [<a href="google.com/preferences">Add Engadget on Google</a>,
    //    <button aria-label="Share">, <button>(chat)</button>]
    // a 沒有 role=button（視覺按鈕 但 DOM 是 link）——v0.6.18 原 interactive
    // 定義（button/role=button）不算它、outsideText = 22 > 10 跳過。
    // v0.6.19 擴展 interactive 到 a[href] 命中；同時加「≥ 1 真 button」保護
    // 避免純 a[href] link rail 誤中。
    const html = `<!DOCTYPE html><html><head>
      <title>engadget byline</title><meta property="og:title" content="engadget byline"></head>
      <body>
        <article>
          <header>
            <h1>Engadget article title here about something</h1>
            <div class="byline-buttons" id="byline-buttons">
              <div class="wrap"><a href="https://www.google.com/preferences/source?q=engadget.com">Add Engadget on Google</a></div>
              <div class="wrap"><button aria-label="Share"><svg></svg></button></div>
              <div class="wrap"><button aria-label="Chat"><svg></svg></button></div>
            </div>
          </header>
          <p>ENGADGET_BODY_MARK The article body padding padding padding padding
          padding padding padding padding padding padding padding padding padding.</p>
        </article>
      </body></html>`;
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      const cluster = w.document.getElementById('byline-buttons');
      assert.ok(cluster);
      assert.strictEqual(cluster.dataset.jreadHidden, '1',
        'Engadget 類「a[href]+button 混合 cluster」應被命中 hide');
      // 標題 + 內文保留
      const h1 = w.document.querySelector('h1');
      const body = w.document.querySelector('p');
      assert.notStrictEqual(h1.dataset.jreadHidden, '1', '標題保留');
      assert.ok(body.textContent.includes('ENGADGET_BODY_MARK'));
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('button cluster 規則對「純 a[href] link rail」（無任何 button / role=button）不命中（保護導覽列 / 相關閱讀列表）', () => {
    // 擴展 interactive 到 a[href] 後新風險：3 條 link 堆在 div 裡被誤中。
    // 用「必須至少 1 個真 button / role=button」保護。純 link rail 交給
    // ancestor-sibling / share cluster / keyword heuristic 規則處理。
    const html = `<!DOCTYPE html><html><head>
      <title>link rail</title><meta property="og:title" content="link rail"></head>
      <body>
        <article>
          <h1>Article with link rail</h1>
          <div class="link-rail" id="link-rail">
            <a href="#1">Link 1</a>
            <a href="#2">Link 2</a>
            <a href="#3">Link 3</a>
          </div>
          <p>RAIL_BODY_MARK Article body content padding padding padding padding
          padding padding padding padding padding padding padding padding padding.</p>
        </article>
      </body></html>`;
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      const rail = w.document.getElementById('link-rail');
      assert.ok(rail);
      assert.notStrictEqual(rail.dataset.jreadHidden, '1',
        '純 a[href] link rail（無真 button）不得被 button cluster 規則誤命中');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('button cluster 規則對「button 外文字 > 10 chars」的容器不命中（保護 ChinaTalk byline+btn 混合 wrapper）', () => {
    // 額外 forcing function：直接構造「container 含 >= 2 button + 短 textLen
    // 但 button 外文字（作者名 + 日期）> 10 chars」，確保新規則不會誤殺。
    // 這保護 v0.6.2 baseline（byline+actions wrapper 不被砍）。
    const html = `<!DOCTYPE html><html><head>
      <title>byline mixed</title><meta property="og:title" content="byline mixed"></head>
      <body>
        <article>
          <h1>Byline mixed test</h1>
          <div class="byline-mixed" id="byline-mixed">
            <div class="meta"><a>Jordan Schneider</a> · <span>Apr 21, 2026</span></div>
            <div class="btns">
              <button aria-label="like">Like</button>
              <button aria-label="share">Share</button>
            </div>
          </div>
          <p>BODY_MARK Main body paragraph padding padding padding padding padding
          padding padding padding padding padding padding padding padding padding.</p>
        </article>
      </body></html>`;
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      const byline = w.document.getElementById('byline-mixed');
      assert.ok(byline);
      assert.notStrictEqual(byline.dataset.jreadHidden, '1',
        'byline 混合 wrapper（button 外文字 > 10 chars）不得被新 button cluster 規則誤殺');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('button cluster 規則：button 內部的 <p>/heading（Medium 把 button label 包成 <p>Listen</p>）不得觸發內文保護', () => {
    // Medium 實測（clyepyy82kxo + Monochrome Dreams）：clap+Listen+Share+More
    // action bar 用 1px solid #f2f2f2 上下 border 殘留兩條橫線，textLen 20、
    // 7 個 button、outsideText 0——button cluster 規則本該命中，但每個
    // button label 被包成 `<p>Listen</p>` / `<p>Share</p>` / `<p>More</p>`，
    // 遞迴 querySelector('p') 找到這些深層 p 誤觸發內文保護跳過。修法：
    // 保護條件改成「p/heading/媒體**從 el 到它的路徑上不經過 interactive
    // 節點**」才算真內文——button 內的 p 不算，整個 cluster 仍被命中。
    const html = `<!DOCTYPE html><html><head>
      <title>medium action bar</title><meta property="og:title" content="medium"></head>
      <body>
        <article>
          <h1>Medium article title here</h1>
          <div class="subtitle-wrap"><p>Subtitle paragraph</p></div>
          <div class="action-bar" id="action-bar">
            <div class="clap-wrap">
              <button aria-label="clap"><svg></svg></button>
              <button><p>442</p></button>
              <button><p>10</p></button>
            </div>
            <div class="misc-wrap">
              <button aria-label="listen"><svg></svg></button>
              <button><p>Listen</p></button>
              <button><p>Share</p></button>
              <button><p>More</p></button>
            </div>
          </div>
          <p>MEDIUM_BODY_MARK Article body content padding padding padding padding
          padding padding padding padding padding padding padding padding padding.</p>
        </article>
      </body></html>`;
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      const bar = w.document.getElementById('action-bar');
      assert.ok(bar);
      assert.strictEqual(bar.dataset.jreadHidden, '1',
        'Medium 類 action bar（label 用 <p> 包）應被 button cluster 規則命中 hide');

      // 主文內容保留
      const body = w.document.querySelector('p.body, article > p');
      const allP = w.document.querySelectorAll('article > p');
      let bodyFound = false;
      for (const p of allP) {
        if (p.textContent.includes('MEDIUM_BODY_MARK')) bodyFound = true;
      }
      assert.ok(bodyFound, '主文內容 MEDIUM_BODY_MARK 必須保留');

      // 標題保留
      const h1 = w.document.querySelector('h1');
      assert.notStrictEqual(h1.dataset.jreadHidden, '1', '標題不得被 hide');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('button cluster 規則：path-check 把「已 jread hide 的祖先」視為 interactive—Medium clap count <p> 包在 role=tooltip 內、tooltip 已被 hideDialogs hide、該 p 不得觸發內文保護', () => {
    // Medium clyepyy82kxo 實測：clap/Listen/Share/More action bar 內，clap
    // count "442" 是 `<p>` 外層包 `<div role="tooltip">`（Medium 的 tooltip
    // wrapper 展示 clap 數字）——v0.6.22 hideDialogs 已 hide tooltip，但
    // button cluster 規則 querySelector 仍抓到此 p、path-check 沿祖先到
    // tooltip（不是 interactive）就停 → 過去視為真內文、action bar 被誤
    // 跳過。修法：路徑經 `data-jread-hidden="1"` 祖先也視為「非真內文」。
    const html = `<!DOCTYPE html><html><head>
      <title>medium clap tooltip</title><meta property="og:title" content="medium"></head>
      <body>
        <article>
          <h1>Medium article</h1>
          <p>Opening paragraph padding padding padding padding padding padding padding padding padding.</p>
          <div class="action-bar" id="action-bar">
            <div class="clap-wrap">
              <button aria-label="clap"><svg></svg></button>
              <div role="tooltip" id="clap-tooltip">
                <div class="ba">
                  <p class="bb">442</p>
                </div>
              </div>
              <button aria-label="responses"><p>10</p></button>
            </div>
            <div class="misc-wrap">
              <button><p>Listen</p></button>
              <button><p>Share</p></button>
              <button><p>More</p></button>
            </div>
          </div>
          <p>MEDIUM_CLAP_BODY_MARK Body content padding padding padding padding
          padding padding padding padding padding padding padding padding padding.</p>
        </article>
      </body></html>`;
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      // 前提：tooltip 被 hideDialogs 先 hide
      const tooltip = w.document.getElementById('clap-tooltip');
      assert.ok(tooltip);
      assert.strictEqual(tooltip.dataset.jreadHidden, '1',
        'role="tooltip" 應被 hideDialogs 先命中 hide');

      // 核心：action bar 本體被 hide（path-check 把經 tooltip 的 p 視為非真內文）
      const bar = w.document.getElementById('action-bar');
      assert.ok(bar);
      assert.strictEqual(bar.dataset.jreadHidden, '1',
        'action bar 應被 button cluster 命中 hide');

      // 主文保留
      const allP = w.document.querySelectorAll('article > p');
      let bodyFound = false;
      for (const p of allP) {
        if (p.textContent.includes('MEDIUM_CLAP_BODY_MARK')) bodyFound = true;
      }
      assert.ok(bodyFound, '主文 MEDIUM_CLAP_BODY_MARK 保留');
      const h1 = w.document.querySelector('h1');
      assert.notStrictEqual(h1.dataset.jreadHidden, '1', '標題保留');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('button cluster 規則：非 interactive 內的 <p>（正文段落）仍觸發保護，不得誤殺內文容器', () => {
    // forcing function：若保護條件放得太寬（不論 p 在哪都不算內文），
    // 會誤殺任何「含 p + 2 個 button」的正文 wrapper（例如段落末尾附
    // 「like / share」inline button）。這條確保「p 在 interactive **外**」
    // 仍觸發保護、正文 wrapper 安全。
    const html = `<!DOCTYPE html><html><head>
      <title>body with inline buttons</title>
      <meta property="og:title" content="body"></head>
      <body>
        <article>
          <h1>Article with inline buttons</h1>
          <div class="paragraph-wrap" id="paragraph-wrap">
            <p>This is a body paragraph. It contains real body content padding
            padding padding. At the end there are inline like / share buttons.</p>
            <button aria-label="like"><svg></svg></button>
            <button aria-label="share"><svg></svg></button>
          </div>
          <p>Another body paragraph padding padding padding padding padding
          padding padding padding padding padding padding padding.</p>
        </article>
      </body></html>`;
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      const wrap = w.document.getElementById('paragraph-wrap');
      assert.ok(wrap);
      assert.notStrictEqual(wrap.dataset.jreadHidden, '1',
        '正文 wrapper 含直接 p direct child + inline buttons 不得被誤殺' +
        '（p 在 interactive 外、應觸發保護）');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('主文內 role="tooltip" 元素被 hide（ARIA UI-chrome 語意非正文；修 Medium Member-only 徽章）', () => {
    // Medium 實測：Member-only 徽章（svg sparkle + "Member-only story" 文字）
    // 最外層包 `<div class="bi" role="tooltip">`——ARIA 規範語意為「懸停/
    // 聚焦時顯示的輔助說明」純 UI chrome，不屬於正文。hideDialogs 擴展
    // DIALOG_SEL 加入 `role="tooltip"`——既有 dialog / alertdialog / aria-
    // modal 路徑同質延伸、整個 tooltip wrapper 一次 hide。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'medium-member-only-tooltip.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    const localHidden = w.__JRead.cleaner.clean(detected.el);

    try {
      // 核心斷言 1：role="tooltip" 外層整塊被 hide
      const tooltip = w.document.getElementById('member-only-tooltip');
      assert.ok(tooltip);
      assert.strictEqual(tooltip.dataset.jreadHidden, '1',
        'role="tooltip" 外層 wrapper 應被 hideDialogs 命中 hide');

      // 核心斷言 2：標題 / 副標 / 作者 meta / 主圖 / 主文內容保留
      const h1 = w.document.querySelector('h1');
      const h2 = w.document.querySelector('.subtitle');
      const meta = w.document.querySelector('.post-meta');
      const fig = w.document.getElementById('hero-figure');
      assert.notStrictEqual(h1.dataset.jreadHidden, '1', '標題保留');
      assert.notStrictEqual(h2.dataset.jreadHidden, '1', '副標保留');
      assert.notStrictEqual(meta.dataset.jreadHidden, '1', '作者 meta 保留');
      assert.notStrictEqual(fig.dataset.jreadHidden, '1', '主圖保留');
      assert.ok(h1.textContent.includes('Monochrome Dreams'), '標題文字完整');
      assert.ok(meta.textContent.includes('Retro Tech Show'), '作者名完整');

      // 主文標記
      const allP = w.document.querySelectorAll('article > p');
      let bodyFound = false;
      for (const p of allP) {
        if (p.textContent.includes('MEDIUM_MEMBER_BODY_MARK')) bodyFound = true;
      }
      assert.ok(bodyFound, '主文內容 MEDIUM_MEMBER_BODY_MARK 必須保留');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('主文內所有 <hr> 元素一律 hide（修 Medium 類 post-header 下方「照片上方多出兩條線」artifact）', () => {
    // Medium 實測：post-header（Member-only 標籤 + 標題 + 副標 + 作者 meta）
    // 下方接 1-2 條 <hr> 分隔線，再接首圖 figure——reader mode 卡片排版下
    // 造成「照片上方多出橫線」視覺 artifact。正文中間作者刻意插入的 <hr>
    // 節段分隔也一併 hide（卡片段落 margin 已提供足夠分節視覺）。
    // 所有 baseline fixture（bw / stratechery / chinatalk / anthropic / ltn /
    // engadget / dwarkesh / bbc）皆無 hr，此規則零 regression 風險。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'medium-post-header-hr.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    const localHidden = w.__JRead.cleaner.clean(detected.el);

    try {
      // 核心斷言 1：post-header 下方兩條 hr 皆被 hide
      const hr1 = w.document.getElementById('hr-divider-1');
      const hr2 = w.document.getElementById('hr-divider-2');
      assert.ok(hr1 && hr2);
      assert.strictEqual(hr1.dataset.jreadHidden, '1',
        'post-header 下方第一條 hr 應被 hide');
      assert.strictEqual(hr2.dataset.jreadHidden, '1',
        'post-header 下方第二條 hr 應被 hide');

      // 核心斷言 2：正文中間作者插入的 hr 也被 hide
      const hrSection = w.document.getElementById('hr-section-break');
      assert.ok(hrSection);
      assert.strictEqual(hrSection.dataset.jreadHidden, '1',
        '正文中間的 hr（節段分隔）也應被 hide');

      // 核心斷言 3：主圖 figure + 內文保留
      const fig = w.document.getElementById('hero-figure');
      assert.ok(fig);
      assert.notStrictEqual(fig.dataset.jreadHidden, '1', 'figure 不得被 hide');
      const body = w.document.querySelector('p');
      assert.ok(body.textContent.includes('MEDIUM_BODY_MARK'));
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

  it('主文內 flex-row container wrap 已啟動（healthsystemtracker Bootstrap `.row`）→ collapse 成 block + 子寬 auto', () => {
    // healthsystemtracker.org 實測：`<article>` 內 `.row` 用 Bootstrap-style
    // `display: flex; flex-direction: row` + 多個固定寬度 children（spacer
    // 140px + content 280px + chart 467px ...）。原 design 在 1140px wide
    // container 可一條 row 排開，reader card 720px 下 flex-wrap 啟動讓
    // children 散落多行 → 段落被擠成 256px 窄欄。既有 collapseGridWith-
    // HiddenCell 要 hidden sibling 才 fire；既有 collapseInnerGridFlex
    // 只處理 grid + px column。新 collapseInnerFlexWrap 補上：flex-row
    // + visible children top 差距 > 5px = wrap 已啟動 → collapse 為 block
    // + 子寬度回 auto。
    // 通則：針對任何「flex-row 多 child 在縮窄 viewport 下 wrap」的站點，
    // 非 Bootstrap 或 healthsystemtracker 特判。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'healthsystemtracker-flex-wrap-row.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;

    const row = w.document.getElementById('bootstrap-row');
    const spacerLeft = w.document.getElementById('spacer-left');
    const contentCenter = w.document.getElementById('content-center');
    const chart1 = w.document.getElementById('chart-1');
    const contentCenter2 = w.document.getElementById('content-center-2');
    const spacerRight = w.document.getElementById('spacer-right');
    const absoluteSidebar = w.document.getElementById('absolute-sidebar');
    const absoluteDescendant = w.document.getElementById('absolute-descendant');
    const wrapperNormal = w.document.getElementById('wrapper-normal');
    const singleRowFlex = w.document.getElementById('single-row-flex');
    const authorName = w.document.getElementById('author-name');
    const postDate = w.document.getElementById('post-date');
    assert.ok(row && contentCenter && absoluteSidebar && wrapperNormal && singleRowFlex,
      'fixture 元素齊全');

    // stub rect 模擬 wrap：bootstrap-row 內 5 children 散落到 3 個 top 值
    // （flex-wrap 啟動的真實效果——row 1: left+center+chart=140+280+467=887
    //   超過 row width 560 → chart 換到 row 2；row 2: chart 467 + center2 280
    //   = 747 超過 560 → center2 換到 row 3 ...）
    stubRect(row, { top: 100, width: 560, height: 400 });
    stubRect(spacerLeft, { top: 100, width: 140, height: 50 });
    stubRect(contentCenter, { top: 100, width: 280, height: 300 });
    stubRect(chart1, { top: 200, width: 467, height: 300 });
    stubRect(contentCenter2, { top: 300, width: 280, height: 300 });
    stubRect(spacerRight, { top: 100, width: 140, height: 50 });
    // v0.7.107：absolute child top 與 in-flow children 同（top=100）——
    // 模擬「絕對定位但無 top 設值」case；若 wrap detection 把 absolute
    // 也算進去，top 沒差距會 false negative；新 fix 過濾 absolute 後
    // 仍能 by in-flow children top 差距 (100/200/300) 命中 wrap。
    stubRect(absoluteSidebar, { top: 100, width: 140, height: 200 });
    stubRect(absoluteDescendant, { top: 200, width: 140, height: 100 });
    stubRect(wrapperNormal, { top: 0, width: 608, height: 100 });
    // 單行 flex：top 全同 → 不該被誤觸 collapse
    stubRect(singleRowFlex, { top: 600, width: 608, height: 30 });
    stubRect(authorName, { top: 600, width: 200, height: 30 });
    stubRect(postDate, { top: 600, width: 100, height: 30 });

    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);

    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    const localHidden = w.__JRead.cleaner.clean(detected.el);

    try {
      // 核心斷言 1：wrap 已啟動的 bootstrap-row 被命中 collapse
      assert.strictEqual(row.dataset.jreadCollapsed, '1',
        'flex-row + visible children top 差距 > 5px（wrap 啟動）應命中並 collapse');
      assert.strictEqual(row.style.getPropertyValue('display'), 'block',
        'collapse 後 display 應為 block');
      assert.strictEqual(row.style.getPropertyPriority('display'), 'important',
        'display:block 應 !important（贏過原 inline display:flex）');
      assert.strictEqual(row.style.getPropertyValue('width'), '100%',
        'collapse 後 width 應 reset 為 100%');
      assert.strictEqual(row.style.getPropertyValue('max-width'), 'none',
        'collapse 後 max-width 應 reset 為 none');

      // 核心斷言 2：visible children 的 flex 屬性 + 固定 width 被 force override
      assert.strictEqual(contentCenter.style.getPropertyValue('width'), 'auto',
        'visible child 的 width 應 force 成 auto（覆寫 inline 280px）');
      assert.strictEqual(contentCenter.style.getPropertyPriority('width'), 'important',
        'child width:auto 應 !important');
      assert.strictEqual(contentCenter.style.getPropertyValue('max-width'), 'none',
        'child max-width 應 reset 為 none');
      assert.strictEqual(contentCenter.style.getPropertyValue('flex-grow'), '0',
        'child flex-grow 應 reset 為 0');
      assert.strictEqual(chart1.style.getPropertyValue('width'), 'auto',
        'chart embed child 寬度也應 reset');

      // 核心斷言 2.5（v0.7.111 後）：v0.7.111 `hideInsideArticleAbsoluteOverlays`
      // 直接 hide 整個 absolute overlay sidebar 而非 reset to static——更乾淨。
      // 原 v0.7.107/108 spec 期望 position: static + width: auto，
      // 但「直接 hide」更符合 reader mode「無關 overlay 就移除」原則。
      // collapseInnerFlexWrap 的 absolute reset 邏輯仍保留作 fallback
      //（對含長 <p> 受 v0.7.111 保護而沒被 hide 的 absolute 元素 reset 定位）。
      assert.strictEqual(absoluteSidebar.dataset.jreadHidden, '1',
        'absolute overlay sidebar 應被 v0.7.111 hideInsideArticleAbsoluteOverlays 整段 hide');

      // 核心斷言 2.6（v0.7.111 後）：absolute 後代也被 v0.7.111 hide。
      // descendant 是其 absolute parent 的後代，parent 已被 hide → descendant
      // 視覺上不可見。dataset.jreadHidden 也應為 1（v0.7.111 規則 walk
      // querySelectorAll('*') 命中所有 absolute 元素，含 ancestor 已 hide
      // 者也會自己標 hidden）。
      assert.strictEqual(absoluteDescendant.dataset.jreadHidden, '1',
        'absolute 後代也應被 v0.7.111 整段 hide');

      // 核心斷言 3：非 flex 的 wrapper-normal 不得被誤動
      assert.notStrictEqual(wrapperNormal.dataset.jreadCollapsed, '1',
        '非 flex 的 wrapper 不得被誤觸');

      // 核心斷言 4：單行 flex（children top 全同）不得被誤觸 collapse
      assert.notStrictEqual(singleRowFlex.dataset.jreadCollapsed, '1',
        '單行 flex（visible children top 全同、無 wrap）不得被誤 collapse');
      assert.notStrictEqual(singleRowFlex.style.getPropertyValue('display'), 'block',
        '單行 flex 的 display 應保持原 flex（未被 force block）');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }

    // 核心斷言 5：restore 後 container 的 display / dataset 恢復、child force
    // override 已清除
    assert.strictEqual(row.style.getPropertyValue('display'), 'flex',
      'restore 後原 inline display:flex 應恢復');
    assert.strictEqual(row.dataset.jreadCollapsed, undefined,
      'restore 後 data-jread-collapsed attribute 應被移除');
    assert.notStrictEqual(contentCenter.style.getPropertyPriority('width'), 'important',
      'restore 後 child 的 width !important 覆寫應清除');
    assert.strictEqual(contentCenter.style.getPropertyValue('width'), '280px',
      'restore 後 child 的 width 應回到 fixture 原值 280px');
  });

  it('主文內 float-based 多欄 layout（visible children 全 floated + 無 hidden sibling）→ collapse 為 block + 子 margin/width reset；absolute <aside> overlay 整段 hide（TBIJ 修法）', () => {
    // TBIJ thebureauinvestigates.com 實測：reader mode 進入後 (1) body
    // sidebar (author/date) 與 absolute aside "We expose injustice..."
    // 完全重疊（同 left=366 同 top=856），文字疊在一起；(2) body 段落
    // 寬度被 stylesheet width:50% + margin-left:25% 限制，仍只佔 reader
    // card 約一半，剩下大塊空白。既有兩條 collapse 規則漏網：
    //   - collapseGridWithHiddenCell 條件 C 需 hidden sibling，TBIJ 兩
    //     children (body + sidebar) 都 visible
    //   - collapseInnerFlexWrap 只處理 flex-row，TBIJ 父是 display: block
    //     + children float: left / right
    // v0.7.110 新條件 D：visibleChildren 全 floated + length >= 2 →
    // collapse 為 block + 子 float/width/max-width/margin-left/right reset。
    // 另新 hideInsideArticleAbsoluteAsides：`<aside>` + position
    // absolute/fixed → hide（HTML5 semantic「次要旁支」+ 絕對定位 =
    // overlay 浮動裝飾，跟內文無關）。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'tbij-float-multi-col-and-absolute-aside.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;

    const absoluteAside = w.document.getElementById('absolute-aside');
    const absoluteDivOverlay = w.document.getElementById('absolute-div-overlay');
    const absoluteWithLongP = w.document.getElementById('absolute-with-long-p');
    const storySection = w.document.getElementById('story-section');
    const sectionSidebar = w.document.getElementById('section-sidebar');
    const sectionBody = w.document.getElementById('section-body');
    const storySectionD2 = w.document.getElementById('story-section-d2');
    const sectionBodyD2 = w.document.getElementById('section-body-d2');
    assert.ok(absoluteAside && absoluteDivOverlay && absoluteWithLongP &&
      storySection && sectionSidebar && sectionBody &&
      storySectionD2 && sectionBodyD2, 'fixture 元素齊全');

    // D2 stub rect：jsdom 無 layout engine 必須 stub 才能驗 single-child + rect
    // 寬 < 70% parent 條件
    stubRect(storySectionD2, { top: 0, width: 1152, height: 400 });
    stubRect(sectionBodyD2, { top: 0, width: 576, height: 400 });

    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);

    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    const localHidden = w.__JRead.cleaner.clean(detected.el);

    try {
      // 核心斷言 1：absolute aside 被 hide
      assert.strictEqual(absoluteAside.dataset.jreadHidden, '1',
        'position: absolute 的 <aside> overlay 應被 hideInsideArticleAbsoluteOverlays 整段 hide');

      // 核心斷言 1.5（v0.7.111）：absolute <div> overlay 也被 hide（規則放寬不限 <aside> tag）
      assert.strictEqual(absoluteDivOverlay.dataset.jreadHidden, '1',
        'position: absolute 的 <div> overlay（TBIJ author bios sidebar）也應被 hide');

      // 核心斷言 1.6（v0.7.111 protection）：含 > 500 chars <p> 的 absolute 容器
      // 視為主文段落、不 hide（避免誤殺意外 absolute 的主文 wrapper）
      assert.notStrictEqual(absoluteWithLongP.dataset.jreadHidden, '1',
        'position: absolute 但含 > 500 chars 段落的容器視為主文，不 hide');

      // 核心斷言 2：float multi-col container 被 condition D 命中 collapse
      assert.strictEqual(storySection.dataset.jreadCollapsed, '1',
        'visible children 全 floated 的 float layout 應命中條件 D 並 collapse');
      assert.strictEqual(storySection.style.getPropertyValue('display'), 'block',
        'collapse 後 display 應為 block');

      // 核心斷言 3：floated children 的 float / width / margin 全 reset
      assert.strictEqual(sectionBody.style.getPropertyValue('float'), 'none',
        'floated child 的 float 應 reset 為 none');
      assert.strictEqual(sectionBody.style.getPropertyValue('width'), 'auto',
        'floated child 的 width 應 reset 為 auto（覆寫 inline 576px）');
      const marginLeftVal = sectionBody.style.getPropertyValue('margin-left');
      assert.ok(marginLeftVal === '0' || marginLeftVal === '0px',
        `floated child 的 margin-left 應 reset 為 0 或 0px（避免 stylesheet margin-left 殘留偏移），實得 "${marginLeftVal}"`);
      assert.strictEqual(sectionBody.style.getPropertyPriority('margin-left'), 'important',
        'margin-left:0 應 !important');
      assert.strictEqual(sectionSidebar.style.getPropertyValue('float'), 'none',
        'sidebar floated child 的 float 應 reset');
      assert.strictEqual(sectionSidebar.style.getPropertyValue('width'), 'auto',
        'sidebar floated child 的 width 應 reset');

      // 核心斷言 3.5（v0.7.110 D2）：單 floated child + rect 寬 < 父 70%
      // 也應 collapse（TBIJ 後續段落每個 section 只有 body 一個 child 場景）
      assert.strictEqual(storySectionD2.dataset.jreadCollapsed, '1',
        '單 floated child + 寬 < 父 70% 也應命中條件 D2 並 collapse');
      assert.strictEqual(sectionBodyD2.style.getPropertyValue('float'), 'none',
        'D2 floated child float 應 reset');
      assert.strictEqual(sectionBodyD2.style.getPropertyValue('width'), 'auto',
        'D2 floated child width 應 reset 為 auto');
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }

    // 核心斷言 4：restore 後 inline style 還原
    assert.strictEqual(sectionBody.style.getPropertyValue('width'), '576px',
      'restore 後 body 寬度應回到 fixture 原 576px');
    assert.strictEqual(sectionBody.style.getPropertyValue('margin-left'), '288px',
      'restore 後 body margin-left 應回到 fixture 原 288px');
  });

  it('主文短篇 byline + author <a> 高 link density 不得被 hideInsideArticleSidebarColumns 條件 A 誤殺（healthsystemtracker entry-meta 修法）', () => {
    // healthsystemtracker.org 實測：article 內 `.entry-meta` 含 byline
    // (author 名 + Twitter 連結) + 日期，textLen ~80 chars 遠 < 主文
    // 14K × 10% 1400 → 命中條件 A 的 textLen 比例；author 名都包 `<a>`
    // → link density > 0.5 → 命中 condition A 全部條件 → 作者+日期整段
    // 被當 sidebar widget 砍光。reader 進入後使用者看不到作者/日期是
    // 嚴重 UX 退化（cnyes / Stratechery 類修法後我們已重視 byline 保留）。
    // 新 byline 白名單：textLen < 200 + BYLINE_TEXT_RE 命中（"By X" /
    // 月份+日+年 日期 / "撰文：" / "作者：" 等）→ skip hide。
    // 通則：byline pattern 跨站收斂、誤判風險低；真 widget cluster
    // 不會同時短篇 + 含 byline 文字 pattern。
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'healthsystemtracker-byline-whitelist.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;

    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);

    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    const localHidden = w.__JRead.cleaner.clean(detected.el);

    try {
      const entryMeta = w.document.getElementById('entry-meta');
      const relatedWidget = w.document.getElementById('related-widget');
      const entryContent = w.document.getElementById('entry-content');
      assert.ok(entryMeta && relatedWidget && entryContent, 'fixture 元素齊全');

      // 核心斷言 1：byline (.entry-meta) 不得被 hide
      assert.notStrictEqual(entryMeta.dataset.jreadHidden, '1',
        '.entry-meta（含 "By X" + 月份+日+年 日期 pattern）byline 不得被條件 A 誤殺');

      // 核心斷言 2：真 widget sidebar（無 byline pattern + 高 link density）
      // 仍應被 hide——避免白名單過鬆把真 widget 放過
      assert.strictEqual(relatedWidget.dataset.jreadHidden, '1',
        '無 byline pattern 的真 widget sidebar 仍應被條件 A hide');

      // 核心斷言 3：主文不可動
      assert.notStrictEqual(entryContent.dataset.jreadHidden, '1',
        '主文 .entry-content 不得被誤殺');
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

// -----------------------------------------------------------------------------
// v0.7.5 Readability.js `_fixLazyImages` 精神借鑑：進 reader mode 時補
// placeholder `<img>` 的 src（data-src / data-original / data-lazy-src /
// data-lazy / data-srcset / srcset），restore 時還原為原 src。
// -----------------------------------------------------------------------------
describe('cleaner — lazy-image-hydration（placeholder img src 補正 + 還原）', () => {
  let window, document, articleEl, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'lazy-image-hydration.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    const detected = window.__JRead.detector.detect();
    assert.ok(detected, 'fixture 應有足夠主文信號讓 detector 命中');
    articleEl = detected.el;
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  after(() => {
    // restore 統一放 after，不干擾 it 順序
    window.__JRead.cleaner.restore(hidden);
  });

  it('case 1 — data:image placeholder + data-src：src 被替換成 data-src 值', () => {
    const img = document.getElementById('case-placeholder-gif');
    assert.ok(img);
    assert.strictEqual(img.getAttribute('src'), 'https://example.com/case1-real.jpg',
      'placeholder gif 應被 data-src 取代');
    // data-src 屬性本身不動
    assert.strictEqual(img.getAttribute('data-src'), 'https://example.com/case1-real.jpg',
      'data-src 本身不應被改動');
  });

  it('case 2 — 空 src + data-original：src 補成 data-original 值', () => {
    const img = document.getElementById('case-empty-data-original');
    assert.strictEqual(img.getAttribute('src'), 'https://example.com/case2-real.jpg',
      '空 src 應被 data-original 取代');
  });

  it('case 3 — 正常 src + data-src 並存：src 不得被替換', () => {
    const img = document.getElementById('case-valid-src');
    assert.strictEqual(img.getAttribute('src'), 'https://example.com/case3-actual.jpg',
      'src 已是正常 URL，不得被 data-src 覆蓋');
  });

  it('case 4 — 空 src + srcset：src 補成 srcset 第一個 URL（忽略 descriptor）', () => {
    const img = document.getElementById('case-srcset-fallback');
    assert.strictEqual(img.getAttribute('src'), 'https://example.com/case4-small.jpg',
      'srcset 第一個 URL 應被補到 src，且不含 `300w` descriptor');
  });

  it('case 5 — 全空 fallback：src 保持空字串（不可誤設其他值）', () => {
    const img = document.getElementById('case-all-empty');
    assert.strictEqual(img.getAttribute('src'), '',
      '無任何 fallback 時 src 應保持空字串');
  });
});

describe('cleaner — lazy-image restore（hydration 後還原 round-trip）', () => {
  it('clean → restore 後 src 回到原值（data:image placeholder 或空字串）', () => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'lazy-image-hydration.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    assert.ok(detected);

    const doc = w.document;
    const case1 = doc.getElementById('case-placeholder-gif');
    const case2 = doc.getElementById('case-empty-data-original');
    const case4 = doc.getElementById('case-srcset-fallback');
    const origCase1 = case1.getAttribute('src');
    const origCase2 = case2.getAttribute('src');
    const origCase4 = case4.getAttribute('src');

    const hiddenLocal = w.__JRead.cleaner.clean(detected.el);

    // clean 後 src 應已變動
    assert.notStrictEqual(case1.getAttribute('src'), origCase1,
      'clean 後 case1 的 src 應已被替換（否則 hydration 未生效）');

    // restore
    w.__JRead.cleaner.restore(hiddenLocal);

    // 還原後 src 回到原值
    assert.strictEqual(case1.getAttribute('src'), origCase1,
      'restore 後 case1 src 應回到原 data:image placeholder');
    assert.strictEqual(case2.getAttribute('src'), origCase2,
      'restore 後 case2 src 應回到原空字串');
    assert.strictEqual(case4.getAttribute('src'), origCase4,
      'restore 後 case4 src 應回到原空字串');
  });
});

// -----------------------------------------------------------------------------
// v0.7.14 udn h1 作為 articleEl direct child 時被誤 hide
// narrowPromotedSiblings guard 需加 `sib.tagName === 'H1'`（querySelector
// 不含 sib 自己、sib 自己是 h1 時保留邏輯漏掉）
// -----------------------------------------------------------------------------
describe('cleaner — udn-h1-direct-child-narrow-guard（h1 作為 sibling 時保留）', () => {
  let window, document, result, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'udn-h1-direct-child-narrow-guard.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中');
    hidden = window.__JRead.cleaner.clean(result.el, { promotedFrom: result.promotedFrom });
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('detector 命中 article-tag、promote 升到 article-content__wrapper', () => {
    assert.ok(result.el.classList.contains('article-content__wrapper'),
      `promote 應升到 section.article-content__wrapper；實際 cls="${result.el.className}"`);
    assert.ok(result.promotedFrom,
      'promotedFrom 應紀錄');
    assert.ok(result.promotedFrom.classList.contains('article-content'),
      'promotedFrom 應為 article.article-content');
  });

  it('h1（articleEl direct child）保留，不被 narrow 誤 hide', () => {
    const h1 = document.getElementById('udn-h1');
    assert.ok(h1);
    assert.notStrictEqual(h1.dataset.jreadHidden, '1',
      'h1 作為 sibling（articleEl direct child）時必須保留；forcing：拿掉 `sib.tagName === "H1"` guard → 此 assertion fail');
  });

  it('主文 UDN_CONTENT_MARK 段落保留', () => {
    const marks = Array.from(document.querySelectorAll('p'))
      .filter(p => p.textContent.includes('UDN_CONTENT_MARK'));
    assert.ok(marks.length >= 4);
    for (const p of marks) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });

  it('non-h1 sibling（related-articles aside）仍被 narrow hide', () => {
    const el = document.querySelector('.related-articles');
    assert.ok(el);
    assert.strictEqual(el.dataset.jreadHidden, '1',
      'related-articles sibling chrome 仍由 narrow hide（guard 只保 h1 / h1-containing）');
  });
});

// -----------------------------------------------------------------------------
// v0.7.96 udn /news/story/124844/9460037 主筆室文章
// narrowPromotedSiblings 把含 byline+日期 的 articleEl direct child sibling
// 當 chrome 砍。修法：加「sibling 含 <time> + textLen <= 200 → 保留」guard
// （<time> 是 HTML5 語意 element 專指日期/時間，跨站通用；短文字限制排除
// 「相關新聞」這類也含 time 的大塊 chrome）
// -----------------------------------------------------------------------------
describe('cleaner — udn-byline-subinfo-narrow-guard（含 <time> 的 byline meta 保留）', () => {
  let window, document, result, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'udn-byline-subinfo-narrow-guard.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中');
    hidden = window.__JRead.cleaner.clean(result.el, { promotedFrom: result.promotedFrom });
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('detector 命中 article-tag、promote 升到 article-content__wrapper', () => {
    assert.ok(result.el.classList.contains('article-content__wrapper'),
      `promote 應升到 section.article-content__wrapper；實際 cls="${result.el.className}"`);
    assert.ok(result.promotedFrom,
      'promotedFrom 應紀錄');
    assert.ok(result.promotedFrom.classList.contains('article-content'),
      'promotedFrom 應為 article.article-content');
  });

  it('byline subinfo（含 <time> + textLen <= 200）保留，不被 narrow 誤 hide', () => {
    const subinfo = document.getElementById('byline-subinfo');
    assert.ok(subinfo, 'fixture 須含 byline subinfo');

    // Forcing function：subinfo 必須短小 + 含 <time>，才能 forcing 新 guard
    const sibText = (subinfo.textContent || '').replace(/\s+/g, ' ').trim();
    assert.ok(sibText.length <= 200,
      `fixture forcing: subinfo textLen (${sibText.length}) 須 <= 200`);
    assert.ok(subinfo.querySelector('time'),
      'fixture forcing: subinfo 須含 <time> element');

    assert.notStrictEqual(subinfo.dataset.jreadHidden, '1',
      'byline subinfo（含 <time> + 短文字）必須保留；forcing：拿掉 narrowPromotedSiblings 的「含 time + textLen <= 200」guard → 此 assertion fail');
  });

  it('麵包屑（無 time）仍被 narrow hide', () => {
    const breadcrumb = document.getElementById('breadcrumb-section');
    assert.ok(breadcrumb);
    assert.strictEqual(breadcrumb.dataset.jreadHidden, '1',
      'SECTION.article-content__info 麵包屑（無 time）仍由 narrow hide（guard 嚴格要求 <time>）');
  });

  it('主圖 figure（含 img not in a）保留（v0.7.22 media guard）', () => {
    const cover = document.getElementById('main-cover');
    assert.ok(cover);
    assert.notStrictEqual(cover.dataset.jreadHidden, '1',
      '主圖 figure 含 standalone img、由 v0.7.22 media guard 保留');
  });

  it('相關新聞（含多個 time 但 textLen > 200）仍被 narrow hide', () => {
    const related = document.getElementById('related-section');
    assert.ok(related);
    const rtxt = (related.textContent || '').replace(/\s+/g, ' ').trim();
    assert.ok(rtxt.length > 200,
      `fixture forcing: 相關新聞 textLen (${rtxt.length}) 須 > 200 才能 forcing「短文字限制排除大塊 chrome」`);
    assert.strictEqual(related.dataset.jreadHidden, '1',
      'SECTION.more-news 雖含多個 time 但 textLen > 200 → 仍 hide（guard 限制只保短文字 byline meta）');
  });

  it('主文 UDN_CONTENT_MARK 段落保留', () => {
    const marks = Array.from(document.querySelectorAll('p'))
      .filter(p => p.textContent.includes('UDN_CONTENT_MARK'));
    assert.ok(marks.length >= 4);
    for (const p of marks) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });
});

// -----------------------------------------------------------------------------
// v0.7.13 esmchina 5 層深 single-child wrapper + partner-content sibling
// PROMOTE_MAX_HOPS 4→5、NOISE_KEYWORD_RE 加 `partner` 詞
// -----------------------------------------------------------------------------
describe('cleaner — esmchina-promote-5-hops（5 層深結構 + partner 詞清 sidebar）', () => {
  let window, document, result, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'esmchina-promote-5-hops.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中');
    hidden = window.__JRead.cleaner.clean(result.el, { promotedFrom: result.promotedFrom });
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('promote 升到 .container（PROMOTE_MAX_HOPS 5）', () => {
    assert.ok(result.el.classList.contains('container'),
      `promote 應升 5 hops 到 .container；實際 cls="${result.el.className}"`);
    assert.ok(result.promotedFrom,
      'promotedFrom 紀錄存在');
  });

  it('h1「三安光電並購遇挫」保留（祖先鏈無 hidden）', () => {
    const h1 = document.querySelector('h1');
    assert.ok(h1);
    assert.notStrictEqual(h1.dataset.jreadHidden, '1');
    let cur = h1.parentElement;
    while (cur && cur !== document.body) {
      assert.notStrictEqual(cur.dataset.jreadHidden, '1',
        `h1 祖先 <${cur.tagName}.${cur.className}> 不得 hide`);
      cur = cur.parentElement;
    }
  });

  it('partner-content-article sidebar 被 NOISE_KEYWORD_RE 清（`partner` 詞）', () => {
    const el = document.querySelector('.partner-content-article');
    assert.ok(el);
    assert.strictEqual(el.dataset.jreadHidden, '1',
      '`partner` 詞應命中 NOISE_KEYWORD_RE；forcing：拿掉 partner → 此 assertion fail');
  });

  it('主文 ESM_CONTENT_MARK 段落保留', () => {
    const marks = Array.from(document.querySelectorAll('p'))
      .filter(p => p.textContent.includes('ESM_CONTENT_MARK'));
    assert.ok(marks.length >= 4, '至少 4 段 ESM_CONTENT_MARK');
    for (const p of marks) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });

  it('NOISE_KEYWORD_RE 字面必含 `partner` 詞', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'),
      'utf8'
    );
    const m = src.match(/const NOISE_KEYWORD_RE = \/([^\/]+)\/i;/);
    assert.ok(m);
    assert.ok(/\bpartner\b/.test(m[1]),
      `NOISE_KEYWORD_RE 必須含 \`partner\`；實際 pattern=${m[1]}`);
  });
});

// -----------------------------------------------------------------------------
// v0.7.12 ebc 深層 single-child wrapper + 橫向 sibling chrome 修法
// detector PROMOTE_MAX_HOPS 3→4 + cleaner narrowPromotedSiblings 聯動
// -----------------------------------------------------------------------------
describe('cleaner — ebc-promote-narrow-sibling-chrome（promote+narrow 聯動清 sibling chrome）', () => {
  let window, document, result, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'ebc-promote-narrow-sibling-chrome.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中（heuristic）');
    hidden = window.__JRead.cleaner.clean(result.el, { promotedFrom: result.promotedFrom });
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('detector promote 升到 #main_content（PROMOTE_MAX_HOPS 4）+ result.promotedFrom 紀錄', () => {
    assert.strictEqual(result.el.id, 'main_content',
      'promote 應升 4 hops 到 #main_content；forcing：PROMOTE_MAX_HOPS 退回 3 → promote 失敗、此 assertion fail');
    assert.ok(result.promotedFrom,
      'promotedFrom 應存在（detector 升級了 el）');
    assert.ok(result.el.contains(result.promotedFrom),
      'promotedFrom 必須是 promoted el 的後代');
  });

  it('h1 主文標題保留（article_header + 內含 h1 → narrow 保護）', () => {
    const h1 = document.querySelector('h1');
    assert.ok(h1);
    assert.notStrictEqual(h1.dataset.jreadHidden, '1');
    // 祖先鏈不得有 hidden
    let cur = h1.parentElement;
    while (cur && cur !== document.body) {
      assert.notStrictEqual(cur.dataset.jreadHidden, '1',
        `h1 祖先 <${cur.tagName}.${cur.className}> 不得 hide`);
      cur = cur.parentElement;
    }
  });

  it('article_relevant（hop 1 sibling）被 narrow hide', () => {
    const el = document.querySelector('.article_relevant');
    assert.ok(el);
    assert.strictEqual(el.dataset.jreadHidden, '1',
      'article_main 的 sibling article_relevant 必須被 narrowPromotedSiblings hide；forcing：註釋 narrowPromotedSiblings 呼叫 → 此 assertion fail');
  });

  it('share_box（hop 2 sibling）被 narrow hide', () => {
    const el = document.querySelector('.share_box');
    assert.ok(el);
    assert.strictEqual(el.dataset.jreadHidden, '1',
      'article_main_box 的 sibling share_box 必須被 narrow hide');
  });

  it('article_cover（hop 3 sibling、含 <img>）被 narrow 保留（v0.7.22 media-bearing guard）', () => {
    // v0.7.22 修法：實機 probe 確認 ebc article_cover 是**文章主圖**
    // （810×424 hero image + figcaption），不是裝飾 overlay。v0.7.12 當初
    // 寫這條 fixture 時誤判了 article_cover 的角色、把真主圖當 chrome
    // hide。narrow 加 media-bearing sibling 保護（sib.querySelector(img/
    // picture/video) → keep）後，ebc 主圖得以保留（跟 newtalk div.news_img
    // 同一條通則修好）。
    const el = document.querySelector('.article_cover');
    assert.ok(el);
    assert.notStrictEqual(el.dataset.jreadHidden, '1',
      'article_cover 含 <img> 為主文 hero image，narrow media-bearing guard 應保留；' +
      'forcing：拿掉 narrow 的 `sib.querySelector("img,picture,video")` guard → 主圖誤殺、此 assertion fail');
    assert.ok(el.querySelector('img'),
      'article_cover 必須含 <img>（forcing media guard 的前提）');
  });

  it('主文 EBC_CONTENT_MARK 段落保留', () => {
    const marks = Array.from(document.querySelectorAll('p'))
      .filter(p => p.textContent.includes('EBC_CONTENT_MARK'));
    assert.ok(marks.length >= 4, '至少 4 段 EBC_CONTENT_MARK');
    for (const p of marks) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });

  it('PROMOTE_MAX_HOPS 字面必須 >= 4（forcing：退回 3 或以下 → promote 升不到 #main_content）', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'),
      'utf8'
    );
    const m = src.match(/const PROMOTE_MAX_HOPS = (\d+);/);
    assert.ok(m, 'detector.js 必須含 `const PROMOTE_MAX_HOPS = N;` 常數宣告');
    const n = parseInt(m[1], 10);
    assert.ok(n >= 4, `PROMOTE_MAX_HOPS 必須 >= 4（支援 ebc 類 4 層深結構）；實際值 ${n}`);
  });
});

// -----------------------------------------------------------------------------
// v0.7.21 Stratechery h2 post-title 修法
// WordPress block theme（Stratechery 實測）post-title 預設是 <h2>，narrow
// 的 h1-only guard 漏防、h2 被當 sibling chrome 連帶 hide。修法：
// promoteForTitle 返回命中的 title heading element（h1-h4 任一）、cleaner
// narrowPromotedSiblings 加一條精準白名單（sib === promotedTitleHead 或
// sib 包含 promotedTitleHead → 保留）。
// -----------------------------------------------------------------------------
describe('cleaner — stratechery-h2-post-title（promote+narrow h2 白名單保護）', () => {
  let window, document, result, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'stratechery-h2-post-title.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中 heuristic');
    hidden = window.__JRead.cleaner.clean(result.el, {
      promotedFrom: result.promotedFrom,
      promotedTitleHead: result.promotedTitleHead
    });
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('detector promote 升到 wp-block-column（包含 h2 post-title）+ 紀錄 promotedFrom', () => {
    assert.ok(result.el.className.includes('wp-block-column'),
      `articleEl 應升級到 wp-block-column；實際 class: ${result.el.className}`);
    assert.ok(result.promotedFrom,
      'promotedFrom 必須存在（detector 有升級）');
    assert.ok(result.promotedFrom.className.includes('entry-content'),
      `promotedFrom 應為 entry-content；實際: ${result.promotedFrom.className}`);
  });

  it('detector 返回 promotedTitleHead（命中的 h2 post-title）— 新 API forcing', () => {
    assert.ok(result.promotedTitleHead,
      'promoteForTitle 升級成功必須返回 titleHead element（Stratechery h2 post-title 會在此命中）');
    assert.strictEqual(result.promotedTitleHead.tagName, 'H2',
      'Stratechery 主標題是 h2 tag（WordPress block theme `wp-block-post-title` 預設 h2）');
    assert.ok(result.promotedTitleHead.textContent.includes('Please Listen to My Podcast'),
      `promotedTitleHead 必須是實際 title heading；實際 text: ${result.promotedTitleHead.textContent}`);
  });

  it('h2 post-title 保留（核心 bug forcing）— 主標題不再被 narrow / sidebarColumns 誤殺', () => {
    const h2 = document.querySelector('h2.wp-block-post-title');
    assert.ok(h2, 'fixture 必須含 h2.wp-block-post-title');
    assert.notStrictEqual(h2.dataset.jreadHidden, '1',
      'h2 主標題必須保留；forcing：narrow 的 promotedTitleHead guard 或 sidebarColumns 的 promotedTitleHead guard 被移除 → h2 會被誤殺、此 assertion fail（Jimmy 2026-04-24 / 2026-05-13 baseline regression）');
    assert.ok(h2.textContent.includes('Please Listen to My Podcast'),
      '主標題文字完整保留');
    // v0.7.97 forcing：H2 內含 <a>（WordPress block theme 預設 post-title 自連結）
    // 導致 linkDensity = 1.0，命中 hideInsideArticleSidebarColumns 條件 A
    // （textLen < main×10% + ld > 0.5）被當 sidebar-widget 砍。
    // 此 assertion 確保 fixture 的 H2 真的有內含 <a>（捕捉真實 DOM 結構特徵）。
    const innerA = h2.querySelector('a');
    assert.ok(innerA, 'fixture H2 必須含 <a>（WordPress block theme post-title 自連結結構，linkDensity=1）');
  });

  it('sidebar（stratechery-sidebar）仍被 narrow hide（不過度放寬）', () => {
    const sidebar = document.querySelector('.stratechery-sidebar');
    assert.ok(sidebar);
    assert.strictEqual(sidebar.dataset.jreadHidden, '1',
      'sidebar 必須被 narrow hide——forcing：如果 guard 放寬成「所有 H2 sibling 都保護」，' +
      'sidebar 內含 h2.wp-block-post-title (related card) 會被誤當主標題保護，此 assertion fail');
  });

  it('主文內容保留（STRATECHERY_MAIN_MARK 全留）', () => {
    const paras = document.querySelectorAll('p');
    let mainPs = 0;
    for (const p of paras) {
      if (p.textContent.includes('STRATECHERY_MAIN_MARK')) {
        assert.notStrictEqual(p.dataset.jreadHidden, '1',
          `STRATECHERY_MAIN_MARK 段落不得被 hide：${p.textContent.slice(0, 40)}`);
        mainPs++;
      }
    }
    assert.ok(mainPs >= 5, `fixture 應含 5 個主文段落；實際 ${mainPs}`);
  });

  it('sidebar 內的 related card h2（不是 promotedTitleHead）被隨 sidebar hide', () => {
    const relatedCards = Array.from(document.querySelectorAll('h2'))
      .filter(h => h.textContent.includes('RELATED_CARD_MARK'));
    assert.ok(relatedCards.length >= 2, `fixture 應含至少 2 個 RELATED_CARD_MARK h2；實際 ${relatedCards.length}`);
    for (const h of relatedCards) {
      // h2 自己未必直接 hSelfHidden，但祖先（sidebar）已 hide
      let cur = h;
      let inHidden = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(inHidden, `related card h2 "${h.textContent.slice(0, 30)}" 應在 hidden 祖先內`);
    }
  });
});

// -----------------------------------------------------------------------------
// v0.7.22 newtalk.tw 標題不是 heading tag + 主圖非 figure 修法
// 兩處修法：
//   detector.promoteForTitle 擴 title tag 白名單到 h1-h4 + p + div + span
//     （非 heading 加 120 char text 上限、heads 同時掃 sib 自己 + 子孫）
//   cleaner.narrowPromotedSiblings 保留含 <img>/<picture>/<video> 的 sibling
//     （跨 CMS 通則：主圖與內文常在兄弟層、舊站沒把主圖包進 figure 時）
// Jimmy 2026-04-24 回報：newtalk 新聞閱讀模式標題不見。
// -----------------------------------------------------------------------------
describe('cleaner — newtalk-p-class-title（p 標題 + 非 figure 主圖雙修法）', () => {
  let window, document, result, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'newtalk-p-class-title.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中');
    hidden = window.__JRead.cleaner.clean(result.el, {
      promotedFrom: result.promotedFrom,
      promotedTitleHead: result.promotedTitleHead
    });
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('detector schema-org-body 命中 div.articleBody', () => {
    assert.strictEqual(result.strategy, 'schema-org-body',
      'fixture 無 <article> tag + 掛 itemprop="articleBody"，應走 schema-org-body');
  });

  it('promoteForTitle 升級到 div.left_column（含 title + 主圖 + 內文）', () => {
    assert.ok(result.el.className.includes('left_column'),
      `articleEl 應升級到 div.left_column；實際 class: ${result.el.className}`);
    assert.ok(result.promotedFrom,
      'promotedFrom 必須存在（detector 有升級）');
  });

  it('promoteForTitle 返回 titleHead（命中 <p class="name"> 或 <div class="title">）— 擴 tag 白名單 forcing', () => {
    assert.ok(result.promotedTitleHead,
      '擴 title tag 白名單到 p/div/span 後、<p class="name"> 應被 promoteForTitle 命中並回傳；' +
      'forcing：若只掃 h1-h4（舊邏輯）會漏、titleHead 為 null、此 assertion fail');
    const tag = result.promotedTitleHead.tagName;
    assert.ok(tag === 'P' || tag === 'DIV' || tag === 'SPAN',
      `titleHead 應為 p/div/span 其中之一；實際 ${tag}`);
    assert.ok(result.promotedTitleHead.textContent.includes('川普下達佈雷快艇擊沉令'),
      `titleHead 必須含文章標題；實際 text: ${result.promotedTitleHead.textContent.slice(0, 60)}`);
  });

  it('<p class="name"> 文章標題保留不被 narrow hide（核心 bug forcing）', () => {
    const titleP = document.querySelector('p.name');
    assert.ok(titleP, 'fixture 必須含 p.name');
    // p.name 在 div.news_info > div.title > p.name。narrow 要保留整個 news_info 分支（contains titleHead）。
    let cur = titleP;
    let inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(!inHidden,
      'p.name 及其祖先不得被 hide；forcing：拿掉 promoteForTitle 對 p tag 的擴展 → titleHead=null → narrow 把 news_info 當 sibling chrome hide → 此 assertion fail');
  });

  it('主圖 div.news_img 保留不被 narrow hide（media-bearing sibling 保護 forcing）', () => {
    const newsImg = document.querySelector('.news_img');
    assert.ok(newsImg, 'fixture 必須含 div.news_img');
    assert.notStrictEqual(newsImg.dataset.jreadHidden, '1',
      'div.news_img 含 <img> 為後代，narrow 應保留；forcing：拿掉 narrow 的 ' +
      '`sib.querySelector("img,picture,video")` guard → 主圖會被當 sibling chrome hide、此 assertion fail');
    // 驗主圖 <img> 自己也未被 hide
    const img = newsImg.querySelector('img');
    assert.ok(img, 'news_img 內應含 <img>');
  });

  it('主文內容保留（NEWTALK_MAIN_MARK 全留）', () => {
    const paras = document.querySelectorAll('p');
    let mainPs = 0;
    for (const p of paras) {
      if (p.textContent.includes('NEWTALK_MAIN_MARK')) {
        // 檢查祖先鏈沒被 hide
        let cur = p;
        let inHidden = false;
        while (cur && cur !== document.body) {
          if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
          cur = cur.parentElement;
        }
        assert.ok(!inHidden, `NEWTALK_MAIN_MARK 段落不得在 hidden 祖先內：${p.textContent.slice(0, 40)}`);
        mainPs++;
      }
    }
    assert.ok(mainPs >= 5, `fixture 應含 5 個主文段落；實際 ${mainPs}`);
  });

  it('chrome sibling 仍被清除（延伸閱讀 / 推薦）', () => {
    // 延伸閱讀：class extend_news_url 含 NOISE_KEYWORD_RE 命中（keyword heuristic）
    // 或被 narrow hide（sibling chrome 不含 img）
    const extList = document.querySelector('.extend_news_url');
    assert.ok(extList);
    let cur = extList;
    let inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden, '延伸閱讀 chrome 必須被 hide');

    // popIn 推薦：id _popIn_recommend 含 `recommend` keyword
    const popin = document.querySelector('#_popIn_recommend');
    assert.ok(popin);
    cur = popin;
    inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden, 'popIn 推薦 chrome 必須被 hide');
  });

  it('右欄 sidebar（right_column）在 articleEl 外、由 hideAncestorSiblings hide', () => {
    const sidebar = document.querySelector('#right_column');
    assert.ok(sidebar);
    // right_column 是 articleEl (left_column) 的 sibling，ancestorSiblings 清
    assert.strictEqual(sidebar.dataset.jreadHidden, '1',
      '右欄 sidebar 必須被 hide');
  });

  it('hidden element 的 inline !important priority 被清後會被 observer 自動補回（v0.7.23 newtalk 真正根因）', async () => {
    // newtalk 的 JS handler 在 reader mode 啟動後清掉 jread hide 的 inline
    // !important priority（probe 實測 inline `display: none` 無 priority）、
    // 導致原站 stylesheet `#footer { display: block !important }` 贏回來、
    // footer 重新 visible。修法：MutationObserver watch hidden el 的 style
    // attribute 變動，priority 被清就重新 setProperty。
    const footer = document.querySelector('#footer');
    assert.ok(footer);
    // 模擬 newtalk JS 清掉 !important：直接 assign inline display（無 priority）
    footer.style.display = 'none';  // 這會清掉 !important flag
    assert.strictEqual(footer.style.getPropertyPriority('display'), '',
      '模擬覆寫後 priority 應該是空字串');

    // 等 MutationObserver callback（microtask + 1 frame）
    await new Promise(r => setTimeout(r, 10));

    // observer 應該已經補回 !important
    assert.strictEqual(footer.style.getPropertyPriority('display'), 'important',
      'style-attribute observer 必須把 !important priority 補回；' +
      'forcing：拿掉 watchHiddenInlineRestyle 呼叫 → 此 assertion fail');
    assert.strictEqual(footer.style.display, 'none',
      'display 值仍應為 none');
  });

  // (spec reserved above; ttv describe block added after newtalk block)
  it('site-wide footer（<div id="footer">，非 <footer> tag）必須被 hide（v0.7.23 修法 forcing）', () => {
    // newtalk 用 `<div id="footer">` 而非 HTML5 `<footer>` tag。v0.7.22 僅靠
    // hideAncestorSiblings 祖先鏈遍歷理論上能清（footer 是 DIV.main 的 child、
    // articleEl 走到 DIV.main 那層 sibling iteration 會掃到），但 Jimmy 實機
    // 回報漏網——可能 Playwright vs 實機 Chrome 的 DOM 時序差異。v0.7.23 改
    // 用全頁掃描補洞。
    const footer = document.querySelector('#footer');
    assert.ok(footer, 'fixture 必須含 <div id="footer">');
    assert.strictEqual(footer.dataset.jreadHidden, '1',
      'site-wide footer（id="footer"）必須被 hideOutsideArticleSemantic hide；' +
      'forcing：拿掉 `#footer` 的全頁 selector → 此 assertion fail（jsdom 環境 ' +
      'hideAncestorSiblings 走到 DIV.main 還能清，但實機 Chrome 下漏；全頁 ' +
      'selector 補洞後兩邊都能清）');
    // footer 內所有 SITE_FOOTER_MARK 連結都在 hidden 祖先內
    const marks = Array.from(document.querySelectorAll('a'))
      .filter(a => a.textContent.includes('SITE_FOOTER_MARK'));
    assert.ok(marks.length >= 2, 'fixture 應含至少 2 個 SITE_FOOTER_MARK 連結');
    for (const a of marks) {
      let cur = a;
      let inHidden = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(inHidden, `SITE_FOOTER_MARK 必須在 hidden 祖先內：${a.textContent}`);
    }
  });
});

// -----------------------------------------------------------------------------
// v0.7.24 ttv.com.tw 雙層 figure + 外層 flex 主圖塌 0×0 + sidebar 縮圖列表漏清
// 三處修法：
//   1. narrow media-bearing sibling guard：改成「img 不在 <a> 內才保留」
//      （sidebar 縮圖的 img 都包在 <a>，不再誤保）
//   2. collapseGridWithHiddenCell 掃進 articleEl 自己（articleEl 本身是 flex
//      + 有 hidden sibling child 時退化到 block）
//   3. forceMediaContainerBlock 新規則：figure/picture 若是 flex/grid/inline-*
//      → 強制 block（HTML5 spec 預設就是 block，原站 custom flex layout 在
//      reader mode 下脫離原 context 常失效、壓扁 img）
// Jimmy 2026-04-25 實測回報：ttv 主圖消失 + sidebar 還在。
// -----------------------------------------------------------------------------
describe('cleaner — ttv-flex-layout-hero-figure（三處聯動修法）', () => {
  let window, document, result, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'ttv-flex-layout-hero-figure.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中 <article> tag');
    hidden = window.__JRead.cleaner.clean(result.el, {
      promotedFrom: result.promotedFrom,
      promotedTitleHead: result.promotedTitleHead
    });
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('detector 命中 <article> 後 promote 升到 DIV.news-article（含 sidebar + 主文的共同 parent）', () => {
    // h1 在 article 內，promote 機制會升到含 article-body 的上層（因 h1 match）
    // 這是 fixture 設計的觸發——articleEl 升到 news-article 後變成含 sidebar 的 flex
    assert.ok(result.el);
    // 升級後的 articleEl 必須含 sidebar（fixture forcing：若 promote 沒升、
    // sidebar 是 articleEl 外部 sibling，後續 narrow 不處理）
    assert.ok(result.el.querySelector('.sidebox'),
      'articleEl 必須包含 sidebox（驗 promote 升級的場景）');
    assert.ok(result.el.querySelector('#contentarea'),
      'articleEl 必須仍包含 <article>');
  });

  it('sidebar（img 包在 <a> 內的縮圖列表）必須被 narrow hide（v0.7.24 guard 修法 forcing）', () => {
    const sidebox = document.querySelector('.sidebox');
    assert.ok(sidebox);
    assert.strictEqual(sidebox.dataset.jreadHidden, '1',
      'sidebar 必須被 narrow hide；forcing：舊版 media guard `sib.querySelector("img")` 會誤保（sidebox 內有 img），' +
      '新版「img 不在 <a> 內才保留」應正確識別 sidebar 縮圖連結、清掉整塊。此 assertion 拿掉 `m.closest("a")` 條件 → fail');
    // sidebar 內的 SIDEBAR_MARK 文字都在 hidden 祖先內
    const marks = Array.from(document.querySelectorAll('p')).filter(p => p.textContent.includes('SIDEBAR_MARK'));
    assert.ok(marks.length >= 3, 'fixture 應含至少 3 個 SIDEBAR_MARK');
    for (const p of marks) {
      let cur = p, inHidden = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(inHidden, `SIDEBAR_MARK 段落必須在 hidden 祖先內：${p.textContent.slice(0, 30)}`);
    }
  });

  it('forceMediaContainerBlock：外層 figure.cover.img（display:flex）被強制 block（v0.7.24 forcing）', () => {
    const outerFigure = document.querySelector('figure.cover');
    assert.ok(outerFigure, 'fixture 必須含 figure.cover（外層雙 class figure）');
    // inline !important display: block 被強制套上
    assert.strictEqual(outerFigure.style.getPropertyPriority('display'), 'important',
      'figure 的 inline display 必須帶 !important priority；forcing：拿掉 forceMediaContainerBlock 呼叫 → fail');
    assert.strictEqual(outerFigure.style.display, 'block',
      'figure display 必須是 block');
  });

  it('主圖 <img> 及祖先 figure 不被任何 rule 誤 hide', () => {
    const heroImg = document.querySelector('article#contentarea img');
    assert.ok(heroImg, 'fixture 必須含主圖 img');
    let cur = heroImg, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(!inHidden, '主圖祖先鏈（figure + article + article-body）都不得被 hide');
  });

  it('主文 TTV_MAIN_MARK 段落全保留', () => {
    const marks = Array.from(document.querySelectorAll('p')).filter(p => p.textContent.includes('TTV_MAIN_MARK'));
    assert.ok(marks.length >= 5, `fixture 應含 5 段主文；實際 ${marks.length}`);
    for (const p of marks) {
      let cur = p, inHidden = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(!inHidden, `TTV_MAIN_MARK 段落不得被 hide：${p.textContent.slice(0, 40)}`);
    }
  });
});

// -----------------------------------------------------------------------------
// v0.7.28 cnyes.com 多項末段 widget + 左側社交 nav rail 漏清
// 五處修法（全部結構性通則、非站點特判）：
//   1. 新規則 hideInsideArticleNav：articleEl 內 <nav> 不含主文長段落 → hide
//   2. heading-text rule fallback 改良：從 heading 往上 walk「不含主文長段落」
//      的最深 wrapper 當 target（解決 cnyes 把整片末段 widget 跟主文塞同個
//      ARTICLE 的結構）
//   3. NOISE_HEADING_TEXT_RE 加：文章標籤 / 相關行情 / 想知道更多 / AI來回答 /
//      上一篇 / 下一篇 / .{2,4}號貼文 / prev/next article
//   4. NOISE_LINK_TEXT_RE 加：點我.{0,8}(下載|訂閱...) / 下載APP / 看更多
//   5. NOISE_KEYWORD_RE 加：powered[-_]?by
//   6. heading-text rule 候選擴含 p（short direct text）
//   7. NOISE_LINK_TEXT_RE walk-up parent 加 LI
// -----------------------------------------------------------------------------
describe('cleaner — cnyes-nav-widgets-walkup（社交 nav + 末段 widget 通則修法）', () => {
  let window, document, result, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'cnyes-nav-widgets-walkup.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中 <article>');
    hidden = window.__JRead.cleaner.clean(result.el, {
      promotedFrom: result.promotedFrom,
      promotedTitleHead: result.promotedTitleHead
    });
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('左側社交 <nav> rail 被 hideInsideArticleNav 清（規則 1 forcing）', () => {
    const nav = document.querySelector('nav.social-rail');
    assert.ok(nav);
    assert.strictEqual(nav.dataset.jreadHidden, '1',
      'articleEl 內 <nav> 不含主文 p 應被 hide；forcing：拿掉 hideInsideArticleNav 呼叫 → fail');
  });

  it('「延伸閱讀」widget wrapper 被 walk-up fallback 命中清掉（規則 2 + 結構 h3>div 文字 forcing）', () => {
    const widget = document.querySelector('.widget-wrapper');
    assert.ok(widget);
    assert.strictEqual(widget.dataset.jreadHidden, '1',
      'widget-wrapper 包「延伸閱讀」h3>div 結構：h3.textContent 命中 NOISE_HEADING_TEXT_RE「延伸閱讀」' +
      '→ walk-up 從 h3 往上 → div.card 不含主文 p → div.widget-wrapper 不含主文 p → ' +
      'parent ARTICLE 含主文 break → target=widget-wrapper hide。' +
      'forcing：回退 fallback 到 articleEl direct child only 邏輯 → fail');
  });

  it('「想知道更多? AI來回答」H2 widget 被 hide（規則 3 NOISE_HEADING_TEXT_RE forcing）', () => {
    const wrapper = document.querySelector('.ai-question-wrapper');
    assert.ok(wrapper);
    assert.strictEqual(wrapper.dataset.jreadHidden, '1',
      'h2「想知道更多? AI來回答」應命中新加的 NOISE_HEADING_TEXT_RE 詞、walk-up 到 wrapper hide；' +
      'forcing：拿掉 `想知道更多` / `AI.{0,4}來回答` token → fail');
  });

  it('「鉅亨號貼文」widget 被 hide（.{2,4}號貼文 forcing）', () => {
    const wrapper = document.querySelector('.hao-posts-wrapper');
    assert.ok(wrapper);
    assert.strictEqual(wrapper.dataset.jreadHidden, '1',
      'h3「鉅亨號貼文」(.{2,4}號貼文 命中) → walk-up wrapper hide；' +
      'forcing：拿掉 `.{2,4}號貼文` token → fail');
  });

  it('powered_by widget 被 NOISE_KEYWORD_RE 命中清（規則 5 forcing）', () => {
    const el = document.querySelector('.powered_by');
    assert.ok(el);
    let cur = el, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden,
      '`<div class="powered_by">` class `powered_by` 應命中 NOISE_KEYWORD_RE 新加 token；' +
      'forcing：拿掉 `powered[-_]?by` → fail');
  });

  it('「下一篇」P 當 heading 候選 + walk-up（規則 3 + 6 forcing）', () => {
    const ul = document.querySelector('ul.next-prev');
    assert.ok(ul);
    assert.strictEqual(ul.dataset.jreadHidden, '1',
      '<p>下一篇</p> direct text 命中 NOISE_HEADING_TEXT_RE `^(下一篇|上一篇)$`、' +
      'walk-up 到 ul.next-prev hide；forcing：(a) 候選只掃 div/span 不掃 p → 不命中、' +
      '(b) 拿掉 `下一篇` token → 不命中');
  });

  it('「討論區 回應(0) 看更多」h3 多 inline span 結構 widget 被 hide（v0.7.30 boundary 放寬 forcing）', () => {
    // h3 textContent = "討論區 回應(0) 看更多"，舊 `^討論區$` 不命中（嚴格 =）；
    // v0.7.30 放寬到 `^討論區(\s|$)` 才能 match 後面接空白的串聯文字。
    const wrapper = document.querySelector('.d4xfe2k1');
    assert.ok(wrapper);
    assert.strictEqual(wrapper.dataset.jreadHidden, '1',
      '討論區 wrapper 必須被 hide；forcing：(a) 把 `^討論區(\\s|$)` 退回 `^討論區$` → 不命中、(b) 拿掉整條 token → 不命中');
  });

  it('內層 article 殘留 box-shadow 被 clearDescendantBoxShadow 清成 none（v0.7.30 forcing）', () => {
    const inner = document.querySelector('.inner-article');
    assert.ok(inner);
    // 取 inline style.boxShadow（jsdom 沒 layout 但 inline style 可讀）。
    // v0.7.30 修法用 `applyImportant` 在 inline 寫 box-shadow: none !important，
    // 應 override 原本 inline 的藍色 shadow
    assert.strictEqual(inner.style.getPropertyPriority('box-shadow'), 'important',
      'cleaner 應在 inline 寫 box-shadow: none !important；forcing：拿掉 clearDescendantBoxShadow 呼叫 → priority 為空');
    assert.strictEqual(inner.style.boxShadow, 'none',
      '應為 none、不是原 rgba(0, 65, 143, 0.1) 0px 0px 6px 0px');
  });

  it('anue 討論區 iframe 被 hideInsideArticleThirdPartyIframes 清（v0.7.32 forcing）', () => {
    const ifr = document.querySelector('iframe.i9zk2x4');
    assert.ok(ifr);
    assert.strictEqual(ifr.dataset.jreadHidden, '1',
      'anue 討論區 iframe 不在 KNOWN_MEDIA_IFRAME_SEL whitelist、應被 hide；' +
      'forcing：拿掉 hideInsideArticleThirdPartyIframes 呼叫 → fail');
  });

  it('主文 YouTube embed iframe（在 figure 內 + src 含 youtube-nocookie）保留', () => {
    const yt = document.querySelector('iframe.yt-embed');
    assert.ok(yt);
    let cur = yt, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(!inHidden,
      'YouTube embed 在 figure 內（PRESERVE_SEL 保護）+ src 含 youtube-nocookie ' +
      '（KNOWN_MEDIA_IFRAME_SEL whitelist）應保留；forcing：(a) src whitelist 漏 ' +
      'youtube-nocookie / (b) iframe 規則沒檢 isInPreserved → fail');
  });

  it('「點我下載APP」a 被 link-text 命中清（規則 4 forcing）', () => {
    const a = document.querySelector('a');
    // 確認某個 a 的 text 是「點我下載APP」、且自己被 hide
    const target = Array.from(document.querySelectorAll('a')).find(el => el.textContent.includes('點我下載APP'));
    assert.ok(target);
    assert.strictEqual(target.dataset.jreadHidden, '1',
      'a 文字「點我下載APP」應命中 NOISE_LINK_TEXT_RE 新 token；forcing：拿掉 `點我.{0,8}` 或 `下載\\s*APP` → fail');
  });

  it('主文 CNYES_MAIN_MARK 段落保留（不被誤殺）', () => {
    const marks = Array.from(document.querySelectorAll('p')).filter(p => p.textContent.includes('CNYES_MAIN_MARK'));
    assert.ok(marks.length >= 3, `fixture 應含 3+ 主文段落；實際 ${marks.length}`);
    for (const p of marks) {
      let cur = p, inH = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inH = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(!inH, `主文段落不得被 hide：${p.textContent.slice(0, 30)}`);
    }
  });
});

// -----------------------------------------------------------------------------
// v0.7.26 techbang.com byline 下方 `<div class="content-top">` 空 wrapper 115px
// 殘留空白修法。spacer rule 的 blocker check 不考慮 hidden 狀態——wrapper 內
// DFP 廣告 iframe 雖已被 hideInsideArticleByThirdPartyAds 清掉、仍 match
// `querySelector('iframe')`、spacer rule skip、留下 CSS min-height 撐的 115px
// 可見空白。修法：blocker check 改用 loop，祖先鏈已 jread-hidden 的不算 visible
// blocker、整個 wrapper 可當 empty spacer 清。
// Jimmy 2026-04-25 第二輪回報 + harness gap audit 標 126px warning。
// -----------------------------------------------------------------------------
describe('cleaner — techbang-empty-spacer-hidden-blocker（blocker 已 hide → spacer 可清）', () => {
  let window, document, result, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'techbang-empty-spacer-hidden-blocker.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    // jsdom 無 layout，stub `.content-top` 的 rect 到 115px 讓 spacer rule
    // 的 `rect.height >= 60` 條件成立（真實 Chrome 下 CSS min-height 會直接
    // 反映在 rect）
    const contentTop = document.querySelector('.content-top');
    Object.defineProperty(contentTop, 'getBoundingClientRect', {
      value: () => ({ width: 500, height: 115, top: 0, bottom: 115, left: 0, right: 500, x: 0, y: 0 }),
      configurable: true
    });
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中 <article>');
    hidden = window.__JRead.cleaner.clean(result.el);
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('DFP iframe 先被 hideInsideArticleByThirdPartyAds 清（前提條件）', () => {
    const dfp = document.querySelector('.google-dfp');
    assert.ok(dfp);
    let cur = dfp, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden, 'DFP 廣告應先被 THIRD_PARTY_AD_SEL hide（spacer rule 前置條件）');
  });

  it('`<div class="content-top">` empty wrapper 被 spacer rule hide（v0.7.26 blocker hidden check forcing）', () => {
    const ct = document.querySelector('.content-top');
    assert.ok(ct);
    assert.strictEqual(ct.dataset.jreadHidden, '1',
      '.content-top 內 iframe 已被 hide、應視為空 spacer 被清；forcing：若 spacer rule 的 blocker selector ' +
      '仍用 `el.querySelector("iframe")` 而不 check hidden 祖先，會直接 match hidden iframe 然後 skip、' +
      '.content-top 留下 CSS min-height 115px 可見空白、此 assertion fail');
  });

  it('主文 TECHBANG_MAIN_MARK 段落保留', () => {
    const marks = Array.from(document.querySelectorAll('p')).filter(p => p.textContent.includes('TECHBANG_MAIN_MARK'));
    assert.ok(marks.length >= 4);
    for (const p of marks) {
      let cur = p, inH = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inH = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(!inH, `TECHBANG_MAIN_MARK 段落不得被 hide：${p.textContent.slice(0, 30)}`);
    }
  });
});

// -----------------------------------------------------------------------------
// v0.7.25 techbang.com 主文內嵌「訂閱表單 + DFP 廣告」wrapper 未清殘留 262px 空白
// 兩處修法：
//   1. NOISE_KEYWORD_RE `newsletter` → `newsletter[\w-]*`（吃任意後綴，handle
//      `newsletter2in1` 等 class 變體）
//   2. THIRD_PARTY_AD_SEL 加 `[id^="dfp-"]` + `[class~="google-dfp"]`（Google
//      Ad Manager DFP 跨 CMS 慣用命名）
// Jimmy 2026-04-25 實機回報：主文中段廣告移除後留大段空白。
// -----------------------------------------------------------------------------
describe('cleaner — techbang-newsletter-dfp-inline（newsletter 變體 + DFP 廣告 wrapper）', () => {
  let window, document, result, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'techbang-newsletter-dfp-inline.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中 <article>');
    hidden = window.__JRead.cleaner.clean(result.el, {
      promotedFrom: result.promotedFrom,
      promotedTitleHead: result.promotedTitleHead
    });
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('訂閱表單 wrapper `<div class="newsletter2in1">` 被 hide（v0.7.25 NOISE_KEYWORD_RE 修法 forcing）', () => {
    const el = document.querySelector('.newsletter2in1');
    assert.ok(el, 'fixture 必須含 .newsletter2in1');
    assert.strictEqual(el.dataset.jreadHidden, '1',
      'newsletter2in1 必須命中 NOISE_KEYWORD_RE 被 hide；forcing：若 regex 仍寫 `newsletter` 單詞 + suffix boundary，' +
      '`newsletter` 後面接數字 `2` 不滿足 `[^a-z0-9]|$`、match 失敗。此 assertion 拿掉 `[\\w-]*` 後綴 → fail');
  });

  it('DFP 廣告 `<div class="google-dfp" id="dfp-*">` 被 hide（v0.7.25 THIRD_PARTY_AD_SEL 修法 forcing）', () => {
    const el = document.querySelector('.google-dfp');
    assert.ok(el, 'fixture 必須含 .google-dfp');
    let cur = el, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden,
      'DFP 廣告或其祖先必須被 hide；forcing：若 THIRD_PARTY_AD_SEL 漏 `[id^="dfp-"]` 與 `[class~="google-dfp"]`，' +
      'Google Ad Manager 非 `div-gpt-ad-*` 命名的 DFP slot 漏網、此 assertion fail');
  });

  it('主文 TECHBANG_MAIN_MARK 段落全保留', () => {
    const marks = Array.from(document.querySelectorAll('p')).filter(p => p.textContent.includes('TECHBANG_MAIN_MARK'));
    assert.ok(marks.length >= 5, `fixture 應含 5 段主文；實際 ${marks.length}`);
    for (const p of marks) {
      let cur = p, inHidden = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(!inHidden, `TECHBANG_MAIN_MARK 段落不得被 hide：${p.textContent.slice(0, 40)}`);
    }
  });
});

// -----------------------------------------------------------------------------
// v0.7.11 Medium click-to-zoom button wrapper 修法
// hideInsideArticleAllButtons 加 media guard：button/role="button" wrapper
// 內含 img/picture/video 時保留（Medium 把主文 picture 嵌在 role="button"
// 的 wrapper 裡）。
// -----------------------------------------------------------------------------
describe('cleaner — medium-click-to-zoom-button（button 含媒體時保留 wrapper）', () => {
  let window, document, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'medium-click-to-zoom-button.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    const detected = window.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    hidden = window.__JRead.cleaner.clean(detected.el);
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('含 picture 的 `#zoom-btn` wrapper 保留（guard 生效）', () => {
    const el = document.getElementById('zoom-btn');
    assert.ok(el);
    assert.notStrictEqual(el.dataset.jreadHidden, '1',
      'role="button" 內含 picture 的 wrapper 必須保留；forcing：拿掉 `btn.querySelector("img, picture, video")` guard → 整個 wrapper 被 hide、img 連帶不可見');
  });

  it('主文 img 不可被祖先連帶 hide（祖先鏈上任一層 data-jread-hidden 即 fail）', () => {
    const img = document.getElementById('main-img');
    assert.ok(img);
    let cur = img;
    while (cur) {
      assert.notStrictEqual(cur.dataset && cur.dataset.jreadHidden, '1',
        `img 祖先 <${cur.tagName}#${cur.id || ''}.${(cur.className || '').toString().slice(0, 40)}> 不得被 hide`);
      cur = cur.parentElement;
      if (!cur || cur.tagName === 'BODY') break;
    }
  });

  it('純 CTA `#share-btn`（無媒體）仍被 hide', () => {
    const el = document.getElementById('share-btn');
    assert.ok(el);
    assert.strictEqual(el.dataset.jreadHidden, '1',
      '純 CTA button 應保持 hide（guard 只保護含媒體的 button）');
  });

  it('含 svg icon 的 `#icon-btn` 仍被 hide（svg 不算媒體保護範圍）', () => {
    const el = document.getElementById('icon-btn');
    assert.ok(el);
    assert.strictEqual(el.dataset.jreadHidden, '1',
      'button 含 svg 不在 guard 範圍（svg 多為 icon、非主文媒體）');
  });

  it('主文 MARK 段落保留', () => {
    const marks = Array.from(document.querySelectorAll('p'))
      .filter(p => p.textContent.includes('MEDIUM_MAIN_MARK'));
    assert.ok(marks.length >= 2, '至少 2 段 MEDIUM_MAIN_MARK');
    for (const p of marks) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });
});

// -----------------------------------------------------------------------------
// v0.7.10 BBC /news/articles/clyepyy82kxo 實測根因：articleEl 內部多層
// grid container、`grid-template-columns: 386px` 固定 px 寬鎖住主文 p。
// 既有 `collapseGridWithHiddenCell` 只在有 hidden child 時 collapse、
// 跳過這個 pathological case。新 `collapseInnerGridFlex` 強制 reset 所有
// articleEl 內含 px 值 grid-template-columns 的 grid container → block。
// -----------------------------------------------------------------------------
describe('cleaner — bbc-inner-grid-fixed-column（pathological 固定 px grid reset）', () => {
  let window, document, articleEl, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'bbc-inner-grid-fixed-column.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    const detected = window.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    articleEl = detected.el;
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('pathological-grid（grid-template-columns: 386px 固定 px）被 reset 成 block', () => {
    const el = document.getElementById('pathological-grid');
    assert.ok(el);
    assert.strictEqual(el.style.display, 'block',
      '固定 px 寬 grid 應被強制 display:block；forcing：註釋 collapseInnerGridFlex 呼叫 → 此 assertion fail');
    assert.strictEqual(el.style.getPropertyPriority('display'), 'important',
      'display:block 必須帶 !important priority（勝過 stylesheet 的 display:grid）');
    assert.strictEqual(el.style.getPropertyValue('grid-template-columns'), 'none',
      'grid-template-columns 應被清為 none');
  });

  it('intentional-grid（grid-template-columns: 1fr 1fr 彈性）保留原狀', () => {
    const el = document.getElementById('intentional-grid');
    assert.ok(el);
    assert.strictEqual(el.style.display, 'grid',
      '彈性單位 1fr 1fr 的 intentional grid 應保留原 display:grid（rule 條件 `/\\d+px/` 不命中）');
    assert.strictEqual(el.style.getPropertyValue('grid-template-columns'), '1fr 1fr',
      'intentional grid-template-columns 應保留 1fr 1fr');
  });

  it('主文各段 MARK 保留，未被誤殺', () => {
    const marks = ['BBC_INTRO_MARK', 'BBC_TRAPPED_MARK', 'BBC_OUTRO_MARK',
                   'BBC_INTENTIONAL_LEFT_MARK', 'BBC_INTENTIONAL_RIGHT_MARK'];
    for (const m of marks) {
      const found = Array.from(document.querySelectorAll('p')).find(p => p.textContent.includes(m));
      assert.ok(found, `${m} 段必須存在`);
      assert.notStrictEqual(found.dataset.jreadHidden, '1', `${m} 段不得被誤 hide`);
    }
  });

  it('restore 後 pathological-grid 回到原 inline style（display:grid + 386px）', () => {
    // 這個 it 放最後；after 會呼叫 restore
    // 不能在這裡檢查 restore，因為 after hook 在 it 之後才跑。改加 restore spec
    // 在獨立 describe 內驗 round-trip
    assert.ok(true, 'restore round-trip 另在獨立 spec 驗');
  });
});

describe('cleaner — bbc-inner-grid restore round-trip', () => {
  it('clean → restore 後 pathological-grid 回到原 display:grid + 386px', () => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'bbc-inner-grid-fixed-column.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    assert.ok(detected);
    const h = w.__JRead.cleaner.clean(detected.el);

    const pg = w.document.getElementById('pathological-grid');
    assert.strictEqual(pg.style.display, 'block', 'clean 後應為 block');

    w.__JRead.cleaner.restore(h);

    assert.strictEqual(pg.style.display, 'grid',
      'restore 後 display 應回到原 inline grid');
    assert.strictEqual(pg.style.getPropertyPriority('display'), '',
      'restore 後 display 不應殘留 !important');
    assert.strictEqual(pg.style.getPropertyValue('grid-template-columns'), '386px',
      'restore 後 grid-template-columns 應回到原 386px');
  });
});

// -----------------------------------------------------------------------------
// v0.7.8 ebc 行銷插播 class `marker` keyword 擴充 forcing
// -----------------------------------------------------------------------------
describe('cleaner — ebc-inline-marker-ad（`marker` keyword 擴充清行銷插播）', () => {
  it('wrapper class 含 `marker` 被 hide（NOISE_KEYWORD_RE 擴充 `marker` 詞）', () => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'ebc-inline-marker-ad.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const w = dom.window;
    w.__JRead = { state: {}, MSG: {} };
    w.eval(DETECTOR_SRC);
    w.eval(CLEANER_SRC);
    const detected = w.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    const localHidden = w.__JRead.cleaner.clean(detected.el);
    try {
      const ad = w.document.getElementById('mazu-ad');
      assert.ok(ad);
      assert.strictEqual(ad.dataset.jreadHidden, '1',
        '`.inline_text.has_marker` 必須被 `marker` keyword 命中 hide（舊 NOISE_KEYWORD_RE 無 marker 詞，漏網；forcing：拿掉 marker → fail）');

      // 主文段落保留
      const ps = w.document.querySelectorAll('p');
      for (const p of ps) {
        if (!p.textContent.includes('EBC_MAIN_MARK')) continue;
        assert.notStrictEqual(p.dataset.jreadHidden, '1',
          '主文段落不得被誤殺');
      }
    } finally {
      w.__JRead.cleaner.restore(localHidden);
    }
  });

  it('NOISE_KEYWORD_RE 字面必含 `marker` 詞（forcing：退回舊名單此 spec fail）', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'),
      'utf8'
    );
    const m = src.match(/const NOISE_KEYWORD_RE = \/([^\/]+)\/i;/);
    assert.ok(m, '必須能抓到 NOISE_KEYWORD_RE');
    assert.ok(/\bmarker\b/.test(m[1]),
      `NOISE_KEYWORD_RE 必須含 \`marker\`；實際 pattern=${m[1]}`);
  });
});

// -----------------------------------------------------------------------------
// v0.7.8 含 h1 的 wrapper（article_header / post-header 類）保護 guard
// 場景：wrapper class 含 `header` keyword 原本會被 hide、h1 連帶不可見。
// 修法：hideInsideArticleByKeyword 對含 h1 的 wrapper 跳過不 hide。
// -----------------------------------------------------------------------------
describe('cleaner — h1-wrapper-header-keyword-guard（保護主文標題 wrapper）', () => {
  let window, document, articleEl, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'h1-wrapper-header-keyword-guard.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    const detected = window.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    articleEl = detected.el;
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('`.share-header` 含 h1 → 不得被 hide（guard 生效；若無 guard 會被 `share` keyword hit）', () => {
    const header = document.querySelector('.share-header');
    assert.ok(header);
    assert.notStrictEqual(header.dataset.jreadHidden, '1',
      '含 h1 的 wrapper 必須被 guard 保護；forcing：拿掉 querySelector(h1) guard → `share-header` 會被 share keyword 命中 hide');
  });

  it('h1 必須可見（dataset 不帶 jreadHidden，祖先也不帶）', () => {
    const h1 = document.querySelector('h1');
    assert.ok(h1);
    assert.notStrictEqual(h1.dataset.jreadHidden, '1');
    // 祖先鏈不得有 hidden
    let cur = h1.parentElement;
    while (cur && cur !== document.body) {
      assert.notStrictEqual(cur.dataset.jreadHidden, '1',
        `h1 祖先 <${cur.tagName}.${cur.className}> 不得被 hide`);
      cur = cur.parentElement;
    }
  });

  it('wrapper 內部的 `.share_bar` 仍被 share keyword 命中 hide（guard 只保 wrapper 本身）', () => {
    const share = document.querySelector('.share_bar');
    assert.ok(share);
    assert.strictEqual(share.dataset.jreadHidden, '1',
      'wrapper 內部的分享 bar 應該被 `share` keyword 命中 hide——guard 只保護 header wrapper 本身、內部各 rule 仍 hide');
  });

  it('主文段落保留', () => {
    const ps = document.querySelectorAll('p');
    let found = 0;
    for (const p of ps) {
      if (p.textContent.includes('GUARD_BODY_MARK')) {
        assert.notStrictEqual(p.dataset.jreadHidden, '1');
        found++;
      }
    }
    assert.ok(found >= 2, '至少保留 2 段主文');
  });
});

// -----------------------------------------------------------------------------
// v0.7.35 esmchina.com 文末三類雜訊修法
// Jimmy 2026-04-25 回報：esmchina 主文後出現 Keysight 活動推廣 + 兩個 QR
// code（微信分享）+ 评论(0)區。三條結構性通則修法：
//   A. NOISE_KEYWORD_RE 加 weixin/wechat/weibo/qrcode + ul/ol 進 CONTAINER_SEL
//   B. NOISE_LINK_TEXT_STRICT_RE 強 CTA token（立即报名 等）不受 60 chars 上限限制
//   C. NOISE_HEADING_TEXT_RE 加簡體 alias「评论」「回复」+ 寬化括號 \([^)]*\)
// -----------------------------------------------------------------------------
describe('cleaner — esmchina-tail-widgets（QR 分享 widget + Keysight CTA + 评论區）', () => {
  let window, document, result, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'esmchina-tail-widgets.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中');
    hidden = window.__JRead.cleaner.clean(result.el, {
      promotedFrom: result.promotedFrom,
      promotedTitleHead: result.promotedTitleHead
    });
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('UL.article-weixin（微信 QR 分享 widget）整塊被 hide（forcing：weixin keyword + ul 入 CONTAINER_SEL）', () => {
    const ul = document.querySelector('ul.article-weixin');
    assert.ok(ul, 'fixture 必須含 ul.article-weixin');
    assert.strictEqual(ul.dataset.jreadHidden, '1',
      'ul.article-weixin 必須被 hide；forcing：拿掉 NOISE_KEYWORD_RE 的 weixin token 或 ul 從 CONTAINER_SEL 移除 → 此 assertion fail');
  });

  it('Keysight 活動推廣 <a>（80+ chars 超 NOISE_LINK_TEXT_MAX_LEN）被 strict CTA hide（forcing：「立即报名」strict token）', () => {
    const adLinks = document.querySelectorAll('p.adlink-paragraph a');
    assert.ok(adLinks.length >= 1, 'fixture 必須含 adlink-paragraph 內的廣告 a');
    let hiddenCount = 0;
    for (const a of adLinks) {
      // a 自身或祖先 wrapper 被 hide 都算（hideInsideArticleByLinkText 對 a 含
      // CTA + parent 80% text 比例會 hide parent <p>）
      let cur = a;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { hiddenCount++; break; }
        cur = cur.parentElement;
      }
    }
    assert.strictEqual(hiddenCount, adLinks.length,
      `所有 ${adLinks.length} 個 Keysight CTA <a> 都應被 hide（自身或祖先）；實際 ${hiddenCount}；` +
      'forcing：拿掉 NOISE_LINK_TEXT_STRICT_RE 或在 hideInsideArticleByLinkText 不對 strict 跳過 length cap → 此 assertion fail');
  });

  it('评论(0) 區塊（DIV.pl-520am）被 walk-up hide（forcing：簡體「评论」alias + 括號內容寬化）', () => {
    const plDiv = document.querySelector('.pl-520am');
    assert.ok(plDiv, 'fixture 必須含 .pl-520am');
    let cur = plDiv;
    let inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden,
      '.pl-520am 評論區必須被 hide；forcing：NOISE_HEADING_TEXT_RE 沒「评论」alias 或 \\([^)]*\\) 寬化 → 此 assertion fail');
  });

  it('主文段落（NEWS_MAIN_MARK）保留', () => {
    const ps = document.querySelectorAll('p');
    let mainPs = 0;
    for (const p of ps) {
      if (p.textContent.includes('NEWS_MAIN_MARK')) {
        let cur = p;
        let inHidden = false;
        while (cur && cur !== document.body) {
          if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
          cur = cur.parentElement;
        }
        assert.ok(!inHidden, `NEWS_MAIN_MARK 段落不得在 hidden 祖先內：${p.textContent.slice(0, 40)}`);
        mainPs++;
      }
    }
    assert.ok(mainPs >= 3, `fixture 應含 3 段主文；實際 ${mainPs}`);
  });

  it('主標 H1 保留', () => {
    const h1 = document.querySelector('h1');
    assert.ok(h1);
    assert.notStrictEqual(h1.dataset.jreadHidden, '1');
    let cur = h1.parentElement;
    while (cur && cur !== document.body) {
      assert.notStrictEqual(cur.dataset.jreadHidden, '1',
        `h1 祖先 <${cur.tagName}.${cur.className}> 不得被 hide`);
      cur = cur.parentElement;
    }
  });
});

// -----------------------------------------------------------------------------
// v0.7.36 cna.com.tw 中央社新聞兩大 bug
// Jimmy 2026-04-25 回報：閱讀模式啟動後 (1) 內文消失 (2) 標題下方社群按鈕殘留。
//   修法 A：walk-up 加「累計 p textLen >= 300」保護（中文短段累計門檻）
//   修法 B：新 rule hideInsideArticleJsLinks 清 a[href^="javascript:"]
//   修法 C：NOISE_LINK_TEXT_RE 加「^(小額)?(贊助|赞助|...)$」
//   修法 D：NOISE_KEYWORD_RE 加 app-?download/app-?promo/app-?banner
// -----------------------------------------------------------------------------
describe('cleaner — cna-short-paragraphs-walkup（中文短段 + javascript: a + appDownload widget）', () => {
  let window, document, result, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'cna-short-paragraphs-walkup.html'),
      'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window;
    document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中');
    hidden = window.__JRead.cleaner.clean(result.el, {
      promotedFrom: result.promotedFrom,
      promotedTitleHead: result.promotedTitleHead
    });
  });

  after(() => {
    window.__JRead.cleaner.restore(hidden);
  });

  it('主文 5 段（CNA_MAIN_MARK）保留——walk-up 累計 textLen 保護生效（核心 bug 1 forcing）', () => {
    const ps = document.querySelectorAll('p');
    let mainPs = 0;
    for (const p of ps) {
      if (p.textContent.includes('CNA_MAIN_MARK')) {
        let cur = p, inHidden = false;
        while (cur && cur !== document.body) {
          if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
          cur = cur.parentElement;
        }
        assert.ok(!inHidden, `CNA_MAIN_MARK 段不得在 hidden 祖先內：${p.textContent.slice(0, 40)}`);
        mainPs++;
      }
    }
    assert.strictEqual(mainPs, 5,
      `fixture 含 5 段主文短段（每段 < 100 chars），全部應保留；實際 ${mainPs}；` +
      'forcing：拿掉 walk-up 的「totalPText >= 300」保護 → 外層 DIV.paragraph 整塊 hide → 全部消失');
  });

  it('「延伸閱讀」widget 仍被 hide（walk-up 修法不影響合法清雜訊）', () => {
    const more = document.querySelector('.moreArticl');
    assert.ok(more);
    let cur = more, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden, '.moreArticl 必須被 hide（heading text walk-up 對「延伸閱讀」應命中）');
  });

  it('5 個 javascript: a 全部被 hide（forcing：hideInsideArticleJsLinks rule）', () => {
    const jsLinks = document.querySelectorAll('a[href^="javascript:"]');
    assert.strictEqual(jsLinks.length, 4, 'fixture 應含 4 個 javascript: a');
    let hiddenCount = 0;
    for (const a of jsLinks) {
      let cur = a;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { hiddenCount++; break; }
        cur = cur.parentElement;
      }
    }
    assert.strictEqual(hiddenCount, 4,
      `所有 4 個 javascript: a 都應被 hide；實際 ${hiddenCount}；` +
      'forcing：拿掉 hideInsideArticleJsLinks 呼叫 → 此 assertion fail');
  });

  it('「小額贊助」a 被 NOISE_LINK_TEXT_RE 命中 hide（forcing：贊助 alias）', () => {
    const supportLinks = Array.from(document.querySelectorAll('a')).filter(a =>
      (a.textContent || '').trim() === '小額贊助'
    );
    assert.ok(supportLinks.length >= 1, 'fixture 應含「小額贊助」a');
    for (const a of supportLinks) {
      let cur = a, inHidden = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(inHidden, '「小額贊助」a 必須被 hide');
    }
  });

  it('「支持中央社」appDownload widget 整塊被 hide（forcing：app-?download keyword）', () => {
    const appDl = document.querySelector('.paragraph.appDownload');
    assert.ok(appDl);
    let cur = appDl, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden,
      '.appDownload widget 必須被 hide；forcing：拿掉 NOISE_KEYWORD_RE 的 app-?download token → 此 assertion fail');
  });

  it('主標 H1 保留', () => {
    const h1 = document.querySelector('h1');
    assert.ok(h1);
    assert.notStrictEqual(h1.dataset.jreadHidden, '1');
  });
});

// ---------------------------------------------------------------------------
// 商業周刊 blog 路由 — closest hit 也要套主文 anchor 保護（v0.7.39 修法）
// ---------------------------------------------------------------------------
describe('cleaner — businessweekly-blog-3021238（closest hit 主文 anchor 保護）', () => {
  let window, document, articleEl, hidden;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: path.join(__dirname, 'fixtures', 'businessweekly-blog-3021238.html'),
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    const detected = window.__JRead.detector.detect();
    assert.ok(detected, 'detector 必須命中商周 blog 主文（main.Single 兜底或更窄 promote）');
    articleEl = detected.el;
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  // 核心 forcing function：closest hit 後，target 含主文 anchor 不准砍
  it('SECTION.row（含整篇主文）絕不可被 hide（forcing：closest hit 主文 anchor 保護）', () => {
    const row = document.querySelector('section.row.no-gutters');
    assert.ok(row, 'fixture 必須有 SECTION.row 包整篇主文');
    assert.notStrictEqual(row.dataset.jreadHidden, '1',
      'SECTION.row 含 8+ 個主文 p、3 個 H2、figure，closest hit 必須過主文 anchor 保護不准砍。' +
      '拿掉 wrapperContainsArticleAnchor 保護 → 此 assertion fail（cleaner 把 line-sub-title FOLLOW US 的 closest section 整塊砍）');
  });

  // 主標 + 主文段落必須留下
  it('主標 H1 保留', () => {
    const h1 = document.querySelector('h1.Single-title-main');
    assert.ok(h1);
    assert.notStrictEqual(h1.dataset.jreadHidden, '1');
    // 祖先鏈也不能被 hide
    let cur = h1.parentElement;
    while (cur && cur !== document.body) {
      assert.notStrictEqual(cur.dataset.jreadHidden, '1',
        `H1 祖先 ${cur.tagName}.${cur.className} 不可被 hide`);
      cur = cur.parentElement;
    }
  });

  it('主文 8 個段落（marker A-H）全部保留', () => {
    const markers = ['marker A', 'Marker B', 'Marker C', 'Marker D', 'Marker E', 'Marker F', 'Marker G', 'Marker H'];
    for (const m of markers) {
      const p = [...document.querySelectorAll('p')].find(el => (el.textContent || '').includes(m));
      assert.ok(p, `主文段落 ${m} 必須存在於 fixture`);
      // p 自己 + 所有祖先都不可被 hide
      let cur = p;
      while (cur && cur !== document.body) {
        assert.notStrictEqual(cur.dataset.jreadHidden, '1',
          `主文段落 ${m} 的祖先 ${cur.tagName}.${cur.className} 不可被 hide`);
        cur = cur.parentElement;
      }
    }
  });

  it('文末「精選文章 / 看更多」widget 仍應被 hide（forcing：保護不過寬，雜訊正常清）', () => {
    const promote = document.querySelector('section.Single-promote');
    assert.ok(promote, 'fixture 必須有 .Single-promote 文末 widget');
    // closest hit 命中：Single-promote 自己是 closest target、不含主文 anchor → 應被 hide
    assert.strictEqual(promote.dataset.jreadHidden, '1',
      '.Single-promote 不含主文 anchor、closest hit 應正常砍——保護不應「過保」誤救雜訊');
  });
});

// -----------------------------------------------------------------------------
// v0.7.63 cna 「支持 CNA」icon-only 按鈕修法
// Jimmy 2026-04-28 截圖回報：reader mode 下標題下方仍顯示「支持 CNA」icon。
//   <a class="btn_support"><img src="support.svg"></a> 是 icon-only CTA，
//   既有 hideInsideArticleJsLinks 只攔 href^="javascript:"、NOISE_KEYWORD_RE
//   不含 support、NOISE_LINK_TEXT_RE 攔不到（textContent 空）。
//   修法：hideInsideArticleIconOnlyLinks 通則——主文內 icon-only `<a>`
//   （含 img/svg 但無 visible 文字）一律 hide，figure/picture 內 a 保留
//   （主文圖片可點擊版合法用法）。
// -----------------------------------------------------------------------------
describe('cleaner — cna-icon-only-link（支持 CNA icon-only a 修法）', () => {
  let window, document, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'cna-icon-only-link.html'), 'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window; document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    const result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中');
    hidden = window.__JRead.cleaner.clean(result.el, {
      promotedFrom: result.promotedFrom,
      promotedTitleHead: result.promotedTitleHead
    });
  });

  after(() => { window.__JRead.cleaner.restore(hidden); });

  it('「支持 CNA」icon-only a (.btn_support) 必須被 hide', () => {
    const a = document.querySelector('a[data-marker="cna-support"]');
    assert.ok(a, 'fixture 必須含 a.btn_support');
    let cur = a, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden,
      'icon-only <a class="btn_support"> 必須被 hide；forcing：拿掉 hideInsideArticleIconOnlyLinks → 此 assertion fail');
  });

  it('figure 內的 a > img（圖片可點擊版）保留——不誤殺主文圖片連結', () => {
    const a = document.querySelector('a[data-marker="figure-link"]');
    assert.ok(a, 'fixture 必須含 figure 內 a');
    assert.notStrictEqual(a.dataset.jreadHidden, '1',
      'figure 內 icon-only a 是「圖片可點擊版」合法用法，不可被 hide');
    let cur = a.parentElement;
    while (cur && cur !== document.body) {
      assert.notStrictEqual(cur.dataset.jreadHidden, '1',
        `figure 內 a 的祖先 ${cur.tagName}.${cur.className} 不可被 hide`);
      cur = cur.parentElement;
    }
  });

  // v0.7.64 修法：<div class="lineAd"> 廣告 wrapper class 是 camelCase 連寫
  // ad 後綴（lowercase 為 linead），AD_BOUNDARY_RE 的「邊界 ad 邊界」規則
  // 攔不到（ad 前是 e 不是邊界字元）。新 AD_SUFFIX_RE 對 layout/position/
  // content-type prefix + Ad 後綴（lineAd / articleAd / topAd / sideAd /
  // bannerAd / inlineAd 等）統一命中。
  it('div.lineAd 必須被 hide（v0.7.64 AD_SUFFIX_RE camelCase ad 後綴修法）', () => {
    const ad = document.querySelector('div[data-marker="cna-line-ad"]');
    assert.ok(ad, 'fixture 必須含 div.lineAd');
    let cur = ad, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden,
      'div.lineAd 必須被 hide（forcing：拿掉 AD_SUFFIX_RE 或從 shouldHideByKeyword 移除 → 此 assertion fail）');
  });
});

// -----------------------------------------------------------------------------
// v0.7.67 gvm.com.tw 主文「年前」敘事誤判為留言面板修法
// Jimmy 2026-04-28 截圖回報：reader mode 後內文消失。v0.7.66 hide stack trace
// 揭穿真兇：hideInsideArticleCommentPanels 用 RELATIVE_TIME_RE 數時間戳 >= 3
// 誤判主文容器為留言面板。主文作者寫「20 年前 / 30 年前」等正文敘事性時間
// 描述命中 regex，舊 layer 1 「含 >= 300 chars 單一 p」protection 對中文短段
// 多 p 結構失效。
// 修法 layer 2：textLen / timestamp count 比例 guard，比例 >= 500 跳過 hide。
// -----------------------------------------------------------------------------
describe('cleaner — gvm-comment-panel-false-positive（主文「年前」敘事誤判修法）', () => {
  let window, document, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'gvm-comment-panel-false-positive.html'), 'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window; document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    const result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中');
    hidden = window.__JRead.cleaner.clean(result.el, {
      promotedFrom: result.promotedFrom,
      promotedTitleHead: result.promotedTitleHead
    });
  });

  after(() => { window.__JRead.cleaner.restore(hidden); });

  it('article-content 主文容器不可被 hide（forcing：layer 2 比例 guard 必須 active）', () => {
    const main = document.querySelector('div[data-marker="gvm-main-content"]');
    assert.ok(main, 'fixture 必須含 div.article-content');
    assert.notStrictEqual(main.dataset.jreadHidden, '1',
      '含多個「年前」敘事的主文容器必須保留；forcing：拿掉 layer 2 ratio guard → 此 assertion fail');
    let cur = main.parentElement;
    while (cur && cur !== document.body) {
      assert.notStrictEqual(cur.dataset.jreadHidden, '1',
        `主文容器祖先 ${cur.tagName}.${cur.className} 不可被 hide`);
      cur = cur.parentElement;
    }
  });

  it('6 個主文段落（marker main-p1~p6）全部保留', () => {
    const markers = ['main-p1', 'main-p2', 'main-p3', 'main-p4', 'main-p5', 'main-p6'];
    for (const m of markers) {
      const p = document.querySelector(`p[data-marker="${m}"]`);
      assert.ok(p, `fixture 必須含 ${m}`);
      let cur = p, inHidden = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(!inHidden, `主文段落 ${m} 不可被 hide`);
    }
  });
});

// -----------------------------------------------------------------------------
// v0.7.97 cna 文末三塊雜訊通則修法（Jimmy 2026-05-13 回報 www.cna.com.tw/
// news/aopl/202604240301.aspx）
// 三條獨立通則 + 三組 forcing assertion：
//   (A) hashtag cluster：articlekeywordGroup 內 15 個 <a>#tag</a> → hide
//   (B) NOISE_KEYWORD_RE camelCase boundary：paragraph.moreArticle → hide
//   (C) NOISE_HEADING_TEXT_RE「請繼續下滑」+ walk-up fallback：jsNextLine → hide
// -----------------------------------------------------------------------------
describe('cleaner — cna-article-tail（hashtag cluster + moreArticle camelCase + 請繼續下滑）', () => {
  let window, document, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'cna-article-tail.html'), 'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window; document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    const result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中');
    hidden = window.__JRead.cleaner.clean(result.el, {
      promotedFrom: result.promotedFrom,
      promotedTitleHead: result.promotedTitleHead
    });
  });

  after(() => { window.__JRead.cleaner.restore(hidden); });

  // ---- (A) hashtag cluster ----
  it('articlekeywordGroup（15 個 #hashtag a）被 hide — forcing：hashtag cluster rule', () => {
    const tags = document.querySelector('.articlekeywordGroup');
    assert.ok(tags, 'fixture 必須含 .articlekeywordGroup');
    assert.strictEqual(tags.dataset.jreadHidden, '1',
      'articlekeywordGroup 必須被 hashtag cluster rule 砍——forcing：anchors>=3 + ratio>=0.8 + directText<=5');
  });

  // ---- (B) NOISE_KEYWORD_RE camelCase moreArticle ----
  it('paragraph.moreArticle（相關新聞 list）被 hide — forcing：camelCase boundary', () => {
    const more = document.querySelector('.paragraph.moreArticle');
    assert.ok(more, 'fixture 必須含 .paragraph.moreArticle');
    assert.strictEqual(more.dataset.jreadHidden, '1',
      'paragraph.moreArticle 必須被 NOISE_KEYWORD_RE 砍；forcing：拿掉 camelCase boundary 寬鬆（more[-_]? + articles?）→ 此 assertion fail');
  });

  it('相關新聞 list 內所有 RELATED_NEWS_MARK link 都不可見', () => {
    const links = document.querySelectorAll('a');
    let related = 0;
    for (const a of links) {
      if (!a.textContent.includes('RELATED_NEWS_MARK')) continue;
      related++;
      let cur = a, inHidden = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(inHidden, `RELATED_NEWS_MARK link "${a.textContent.slice(0, 30)}" 必須在 hidden 祖先內`);
    }
    assert.ok(related >= 3, `fixture 應含至少 3 個 RELATED_NEWS_MARK；實際 ${related}`);
  });

  // ---- (C) 底部「請繼續下滑」box 雙通道保護 ----
  // 路徑 1（initial run）：jsNextLine.nextline 是 articleEl 的 direct child、
  //   textLen 短 + linkDensity > 0.5 → 命中 hideInsideArticleSidebarColumns
  //   條件 A。fixture 從一開始就有 jsNextLine、initial clean 命中。
  // 路徑 2（dynamic inject 兜底）：Jimmy 2026-05-13 實機回報——Playwright probe
  //   sidebarColumns 已砍但實機看到、推斷實機是 SPA lazy-hydrate（reader mode
  //   啟動 / sidebarColumns 跑完後才注入 jsNextLine），sidebarColumns 不會
  //   retroactively run、靠 checkDynamicNoise + NOISE_HEADING_TEXT_RE 兜底。
  //   故加「請繼續下滑(閱讀)?」alternation 到 NOISE_HEADING_TEXT_RE，作為
  //   dynamic 注入時的兜底通道。
  it('jsNextLine.nextline（底部「請繼續下滑」box）被 hide — initial sidebarColumns 通道', () => {
    const next = document.querySelector('.jsNextLine.nextline');
    assert.ok(next, 'fixture 必須含 .jsNextLine.nextline');
    let cur = next, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden,
      'jsNextLine.nextline 必須在 hidden 祖先內');
  });

  // 路徑 2 的 forcing：直接斷言 NOISE_HEADING_TEXT_RE 字面含「請繼續下滑」
  // phrase——拿掉 alternation → spec fail（雙通道之一壞掉的 forcing）。
  it('NOISE_HEADING_TEXT_RE 字面必含「請繼續下滑」phrase — forcing：SPA lazy-hydrate dynamic 兜底通道', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
    );
    const m = src.match(/const NOISE_HEADING_TEXT_RE = (\/.*?\/i);/);
    assert.ok(m, 'cleaner.js 必須有 NOISE_HEADING_TEXT_RE 定義');
    assert.ok(m[1].includes('請繼續下滑'),
      'NOISE_HEADING_TEXT_RE 必須含「請繼續下滑」phrase；forcing：SPA lazy-hydrate 場景 sidebarColumns 不會 retroactively run、靠 checkDynamicNoise + heading-text rule 兜底，拿掉此 alternation → 實機 cna 文末 jsNextLine box 仍可見');
  });

  it('NEXT_ARTICLE_MARK link 不可見', () => {
    const link = Array.from(document.querySelectorAll('a'))
      .find(a => a.textContent.includes('NEXT_ARTICLE_MARK'));
    assert.ok(link, 'fixture 必須含 NEXT_ARTICLE_MARK');
    let cur = link, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden, '下一篇 CTA link 必須在 hidden 祖先內');
  });

  // ---- 主文保護 forcing ----
  it('5 段主文（CNA_MAIN_MARK）全保留 — 通則修法不誤殺主文', () => {
    const ps = document.querySelectorAll('p');
    let mainCount = 0;
    for (const p of ps) {
      if (!p.textContent.includes('CNA_MAIN_MARK')) continue;
      mainCount++;
      let cur = p, inHidden = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(!inHidden, `主文段落 "${p.textContent.slice(0, 30)}..." 不可被 hide`);
    }
    assert.strictEqual(mainCount, 5, `fixture 應含 5 個 CNA_MAIN_MARK 主文段落；實際 ${mainCount}`);
  });

  it('H1 主標題保留', () => {
    const h1 = document.querySelector('h1');
    assert.ok(h1);
    let cur = h1, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(!inHidden, 'H1 主標題不可被 hide');
  });
});

// -----------------------------------------------------------------------------
// v0.7.97 chinatimes 文末四塊雜訊修法（Jimmy 2026-05-13 回報 www.chinatimes.com/
// realtimenews/20260423000917-260410）。四條獨立通則 forcing：
//   (A) hash-tag tags 列 → NOISE_KEYWORD_RE 加 `hash[-_]?tag`
//   (B) premium-widget → NOISE_KEYWORD_RE 加 `premium[-_]?(widget|content|trial|banner|box)`
//   (C) subscribe-news-letter 與 (D) recommended-article → 既有 NOISE keyword
//       已命中但被 `hasArticleTitleAnchor` 誤豁免，修法把 hideInsideArticleByKeyword
//       的 anchor guard 從寬鬆版（`wrapperContainsArticleAnchor` 含 title token）
//       改成嚴格版（`wrapperContainsMainContentP` 只看 p 長度）。
// -----------------------------------------------------------------------------
describe('cleaner — chinatimes-article-tail（hash-tag + premium-widget + title-anchor guard 嚴格化）', () => {
  let window, document, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'chinatimes-article-tail.html'), 'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window; document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    const result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中');
    hidden = window.__JRead.cleaner.clean(result.el, {
      promotedFrom: result.promotedFrom,
      promotedTitleHead: result.promotedTitleHead
    });
  });

  after(() => { window.__JRead.cleaner.restore(hidden); });

  // ---- (A) article-hash-tag tags 列 ----
  it('article-hash-tag（tags 列）被 hide — forcing：NOISE_KEYWORD_RE 加 hash-tag alternation', () => {
    const tags = document.querySelector('.article-hash-tag');
    assert.ok(tags, 'fixture 必須含 .article-hash-tag');
    let cur = tags, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden, 'article-hash-tag 必須在 hidden 祖先內');
  });

  it('NOISE_KEYWORD_RE 字面必含 `hash[-_]?tag` alternation', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
    );
    const m = src.match(/const NOISE_KEYWORD_RE = (\/.*?\/i);/);
    assert.ok(m && m[1].includes('hash[-_]?tag'),
      'NOISE_KEYWORD_RE 必須含 `hash[-_]?tag` alternation；forcing：chinatimes 用 `article-hash-tag` 標 hashtag 區，去掉此 alternation → tags 列殘留');
  });

  // ---- (B) premium-widget ----
  it('premium-widget（Prism 付費 widget）被 hide — forcing：NOISE_KEYWORD_RE 加 premium-widget alternation', () => {
    const prism = document.querySelector('.premium-widget');
    assert.ok(prism, 'fixture 必須含 .premium-widget');
    let cur = prism, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden, 'premium-widget 必須在 hidden 祖先內');
  });

  it('NOISE_KEYWORD_RE 字面必含 `premium[-_]?(?:widget|content|trial|banner|box)` alternation', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
    );
    const m = src.match(/const NOISE_KEYWORD_RE = (\/.*?\/i);/);
    assert.ok(m && /premium\[-_\]\?\(\?:widget\|content\|trial\|banner\|box\)/.test(m[1]),
      'NOISE_KEYWORD_RE 必須含 `premium[-_]?(?:widget|content|trial|banner|box)` alternation');
  });

  // ---- (C) subscribe-news-letter ----
  it('subscribe-news-letter（訂閱框）被 hide — forcing：anchor guard 嚴格化（不再因 H3.title 誤豁免）', () => {
    const sub = document.querySelector('.subscribe-news-letter');
    assert.ok(sub, 'fixture 必須含 .subscribe-news-letter');
    let cur = sub, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden, 'subscribe-news-letter 必須在 hidden 祖先內；forcing：把 hideInsideArticleByKeyword 的 anchor guard 換回 wrapperContainsArticleAnchor（含 title token）→ 因 H3.title 子元素被誤豁免、此 assertion fail');
  });

  // ---- (D) recommended-article ----
  it('recommended-article（推薦新聞 section）被 hide — forcing：anchor guard 嚴格化', () => {
    const rec = document.querySelector('#recommended-article');
    assert.ok(rec, 'fixture 必須含 #recommended-article');
    let cur = rec, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(inHidden, 'recommended-article 必須在 hidden 祖先內；forcing：anchor guard 嚴格化（內含多個 H4.title 不再豁免）');
  });

  it('所有 RECOMMEND_MARK link 不可見', () => {
    const links = Array.from(document.querySelectorAll('a'))
      .filter(a => a.textContent.includes('RECOMMEND_MARK'));
    assert.ok(links.length >= 3, `fixture 應含至少 3 個 RECOMMEND_MARK；實際 ${links.length}`);
    for (const a of links) {
      let cur = a, inHidden = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(inHidden, `RECOMMEND_MARK link "${a.textContent.slice(0, 30)}" 必須在 hidden 祖先內`);
    }
  });

  // ---- 主文保護 forcing ----
  it('3 段主文（CHINATIMES_MAIN_MARK）全保留 — 通則修法不誤殺主文', () => {
    const ps = document.querySelectorAll('p');
    let mainCount = 0;
    for (const p of ps) {
      if (!p.textContent.includes('CHINATIMES_MAIN_MARK')) continue;
      mainCount++;
      let cur = p, inHidden = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(!inHidden, `主文段落 "${p.textContent.slice(0, 30)}..." 不可被 hide`);
    }
    assert.strictEqual(mainCount, 3, `fixture 應含 3 個 CHINATIMES_MAIN_MARK 主文段落；實際 ${mainCount}`);
  });

  it('H1 主標題保留', () => {
    const h1 = document.querySelector('h1');
    assert.ok(h1);
    let cur = h1, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(!inHidden, 'H1 主標題不可被 hide');
  });
});

// v0.7.98 BBC Culture figure 內 position:absolute credit overlay 遮文字（Jimmy
// 2026-05-13 截圖回報 bbc.com/culture/article/20260423-the-enchanting-story-of-
// oxfords-medieval-library）。修法：新增 hideInsideArticleAbsoluteCreditOverlays
// ——figure 內含 figcaption 時，同 figure 內 position:absolute|fixed + 帶
// direct text 的 SPAN/DIV/P/SMALL 視為 credit overlay → hide。
describe('cleaner — bbc-figure-credit-overlay（figure 內 absolute SPAN credit overlay）', () => {
  let window, document, hidden;

  before(() => {
    const html = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'bbc-figure-credit-overlay.html'), 'utf8'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    window = dom.window; document = window.document;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(CLEANER_SRC);
    const result = window.__JRead.detector.detect();
    assert.ok(result, 'detector 應命中 ARTICLE');
    hidden = window.__JRead.cleaner.clean(result.el, {
      promotedFrom: result.promotedFrom,
      promotedTitleHead: result.promotedTitleHead
    });
  });

  after(() => { window.__JRead.cleaner.restore(hidden); });

  // ---- (A) figure 1 hero credit overlay ----
  it('figure-hero 內 absolute SPAN credit 被 hide — forcing：absolute + direct text + figure 含 figcaption', () => {
    const span = document.getElementById('hero-credit');
    assert.ok(span, 'fixture 必須含 #hero-credit SPAN');
    assert.strictEqual(span.dataset.jreadHidden, '1',
      'hero-credit SPAN 必須被 hideInsideArticleAbsoluteCreditOverlays 砍——forcing：position:absolute + direct text + 同 figure 含 figcaption');
  });

  // ---- (B) figure 2 portrait credit overlay ----
  it('figure-portrait 內 absolute SPAN credit 被 hide', () => {
    const span = document.getElementById('portrait-credit');
    assert.ok(span);
    assert.strictEqual(span.dataset.jreadHidden, '1',
      'portrait-credit SPAN 必須被 hide');
  });

  // ---- (C) figure 3 placeholder credit overlay ----
  it('figure-with-placeholder 內 absolute SPAN credit 被 hide', () => {
    const span = document.getElementById('placeholder-credit');
    assert.ok(span);
    assert.strictEqual(span.dataset.jreadHidden, '1',
      'placeholder-credit SPAN 必須被 hide');
  });

  // ---- (D) absolute IMG（lazy-load placeholder）不可誤殺 ----
  it('absolute IMG（lazy-load placeholder，無 direct text）不可被誤殺 — direct text guard', () => {
    const img = document.getElementById('lazy-placeholder');
    assert.ok(img);
    assert.notStrictEqual(img.dataset.jreadHidden, '1',
      'absolute lazy-load IMG 不可被砍；forcing：rule 必須限定 SPAN/DIV/P/SMALL，不含 IMG/PICTURE/VIDEO');
  });

  // ---- (E) figure 4 無 figcaption — overlay 是唯一說明，不可砍 ----
  it('figure-no-caption 內 absolute SPAN（figure 無 figcaption）不可砍 — figcaption guard', () => {
    const span = document.getElementById('nocap-only-credit');
    assert.ok(span);
    assert.notStrictEqual(span.dataset.jreadHidden, '1',
      'figure 沒有 figcaption 時，overlay SPAN 是唯一說明文字、不可砍；forcing：rule 必須含 `if (!figcap) continue;` guard');
  });

  // ---- (F) FIGCAPTION 必須保留 ----
  it('所有 figcaption（canonical caption）保留', () => {
    const caps = document.querySelectorAll('figcaption');
    assert.ok(caps.length >= 3, 'fixture 應含至少 3 個 figcaption');
    for (const cap of caps) {
      assert.notStrictEqual(cap.dataset.jreadHidden, '1',
        `figcaption "${cap.textContent.slice(0, 40)}..." 不可被 hide`);
      let cur = cap.parentElement, inHidden = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(!inHidden, `figcaption 祖先不可被 hide（${cap.id}）`);
    }
  });

  // ---- (G) IMG 主圖必保留 ----
  it('所有 IMG 主圖保留（hero / portrait / real / nocap，不含 lazy-placeholder）', () => {
    const ids = ['hero-img', 'portrait-img', 'real-img', 'nocap-img'];
    for (const id of ids) {
      const img = document.getElementById(id);
      assert.ok(img, `fixture 必須含 #${id}`);
      let cur = img, inHidden = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(!inHidden, `IMG #${id} 不可被 hide（祖先也不可）`);
    }
  });

  // ---- (H) 主文 p 全保留 ----
  it('主文段落（BBC_BODY_MARK）全保留 — 通則修法不誤殺主文', () => {
    const ps = document.querySelectorAll('p');
    let mainCount = 0;
    for (const p of ps) {
      if (!p.textContent.includes('BBC_BODY_MARK')) continue;
      mainCount++;
      let cur = p, inHidden = false;
      while (cur && cur !== document.body) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
        cur = cur.parentElement;
      }
      assert.ok(!inHidden, `主文段落 "${p.textContent.slice(0, 30)}..." 不可被 hide`);
    }
    assert.ok(mainCount >= 6, `fixture 應含至少 6 個 BBC_BODY_MARK 主文段落；實際 ${mainCount}`);
  });

  // ---- (I) H1 必保留 ----
  it('H1 主標題保留', () => {
    const h1 = document.querySelector('h1');
    assert.ok(h1);
    let cur = h1, inHidden = false;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') { inHidden = true; break; }
      cur = cur.parentElement;
    }
    assert.ok(!inHidden, 'H1 主標題不可被 hide');
  });

  // ---- (J) hideInsideArticleAbsoluteCreditOverlays 函式存在性 forcing ----
  it('cleaner.js 必須含 hideInsideArticleAbsoluteCreditOverlays 函式 + clean() 呼叫', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
    );
    assert.ok(src.includes('function hideInsideArticleAbsoluteCreditOverlays('),
      'cleaner.js 必須定義 hideInsideArticleAbsoluteCreditOverlays——forcing：函式被誤刪 → spec fail');
    assert.ok(src.includes('hideInsideArticleAbsoluteCreditOverlays(articleEl, hidden);'),
      'clean() 必須呼叫 hideInsideArticleAbsoluteCreditOverlays——forcing：呼叫鏈被刪 → 此 spec fail');
  });
});

// v0.7.103：BBC byline (date+author) collapsed grid descendants 殘留 width/margin
// 修法。難以用 jsdom 行為層測（jsdom 無 layout / computed margin auto resolve），
// 改用 source-level forcing assertion 驗修法存在 + 通則屬性。
describe('cleaner — collapseInnerGridFlex descendants 殘留 auto-center reset (v0.7.103)', () => {
  const fs = require('fs');
  const src = fs.readFileSync(
    require('path').join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
  );

  it('cleaner.js 必須定義 INNER_GRID_DESC_DECLS（descendants reset 宣告表）', () => {
    assert.ok(src.includes('INNER_GRID_DESC_DECLS'),
      'cleaner.js 必須含 INNER_GRID_DESC_DECLS——forcing：常數被誤刪 → BBC byline 修法失效');
  });

  it('INNER_GRID_DESC_DECLS 必須含 width:100% + margin-left/right:0 + grid-area:auto', () => {
    // 對 styled-components fixed-width child + margin auto auto-center 的反制。
    // v0.7.104 修法：width:auto → width:100% ——實測 BBC styled-components 多層
    // nested 下 width:auto 即使 inline !important 仍解析成原 stylesheet 寬度，
    // width:100% 才能可靠覆寫。
    const m = src.match(/const\s+INNER_GRID_DESC_DECLS\s*=\s*\{([\s\S]*?)\}/);
    assert.ok(m, '能找到 INNER_GRID_DESC_DECLS 定義');
    const body = m[1];
    assert.match(body, /['"]width['"]\s*:\s*['"]100%['"]/, '必須含 width: 100%（v0.7.104 width:auto 改 100%）');
    assert.match(body, /['"]margin-left['"]\s*:\s*['"]0['"]/, '必須含 margin-left: 0');
    assert.match(body, /['"]margin-right['"]\s*:\s*['"]0['"]/, '必須含 margin-right: 0');
    assert.match(body, /['"]grid-area['"]\s*:\s*['"]auto['"]/, '必須含 grid-area: auto');
  });

  it('collapseInnerGridFlex 必須對 descendants 跑 symmetric-margin 條件式 reset', () => {
    // forcing：v0.7.103 第一版「全 descendants reset」造成 BBC 外層 grid 套娃
    // 連鎖塌陷的回歸。改用 symmetric margin (margin-left ≈ margin-right > 4px)
    // 條件精準命中 auto-center 殘留，避免誤殺非 auto-center descendants。
    assert.ok(src.includes('SYMMETRIC_MARGIN_MIN'),
      'cleaner.js 必須有 SYMMETRIC_MARGIN_MIN 常數（auto-center 結構特徵的最小 margin 門檻）');
    // collapseInnerGridFlex 內必須有「比較 margin-left 與 margin-right」的邏輯
    const fnStart = src.search(/function\s+collapseInnerGridFlex\s*\(/);
    assert.ok(fnStart >= 0, '能找到 collapseInnerGridFlex 函式');
    const fnRegion = src.slice(fnStart, fnStart + 3000);
    assert.match(fnRegion, /marginLeft/, 'collapseInnerGridFlex 必須讀 computed marginLeft');
    assert.match(fnRegion, /marginRight/, 'collapseInnerGridFlex 必須讀 computed marginRight');
    assert.match(fnRegion, /Math\.abs\s*\(\s*ml\s*-\s*mr\s*\)/, 'collapseInnerGridFlex 必須驗 |ml - mr| ≤ tolerance（symmetric margin 比對）');
  });

  it('collapseInnerGridFlex 必須排除 PRESERVE_SEL + 媒體 tag（避免誤殺）', () => {
    const fnStart = src.search(/function\s+collapseInnerGridFlex\s*\(/);
    const fnRegion = src.slice(fnStart, fnStart + 3000);
    assert.match(fnRegion, /isInPreserved\(desc\)/, 'descendant 迴圈必須跑 isInPreserved guard');
    assert.match(fnRegion, /['"]IMG['"]/, '必須排除 IMG');
    assert.match(fnRegion, /['"]PICTURE['"]/, '必須排除 PICTURE');
    assert.match(fnRegion, /['"]VIDEO['"]/, '必須排除 VIDEO');
    assert.match(fnRegion, /['"]FIGURE['"]/, '必須排除 FIGURE');
  });

  it('restoreInnerGridFlex 必須還原 __innerGridFlexDesc 軌道（reader mode 退出時清乾淨）', () => {
    assert.ok(src.includes('__innerGridFlexDesc'),
      'restoreInnerGridFlex 必須走 __innerGridFlexDesc 軌道——forcing：退出 reader mode 時 descendant inline 樣式必還原');
  });
});
