// JRead — #13 insertion invalidation（v1.6.30）regression
//
// 根因（2026-07-09 probe 實測，wiki 37K 節點）：Chromium 下 stylesheet 內只要
// 同時存在任一 :has 規則（觸發器）與任一「:has 錨點選擇器 + 萬用後代尾巴
// `X:has(...) *`」規則（放大器），每次 DOM 插入都強制整頁 style recalc
// （600 個中性節點插入 recalc 65s；拔掉放大器後 29ms）。修法：三個放大器
// （v0.8.59 min-height / v0.8.155 embed gate / v0.8.129+131 heading link）
// 改 JS 標記 attr + attr-keyed CSS，語意不變。
//
// 訊號層次（CLAUDE.md 工作流原則 3）：
//   驗 —— buildCss 不變式（anti-drift）、marker 標記/清除語意（jsdom 行為）、
//        cleaner↔styler attr 字串同步、動態補標 wire-up
//   不驗 —— 真實 Chromium 的 recalc 時間下降（那層由 release 驗收時的
//          CDP perf probe 量；jsdom 不算 style invalidation）

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, SRC } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'insertion-invalidation.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function setup(scripts) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: scripts || ['detector', 'cleaner', 'styler'],
    url: 'https://example.com/post/1'
  });
  const articleEl = env.document.getElementById('main-article');
  assert.ok(articleEl, 'fixture 必須有 #main-article');
  return { ...env, articleEl };
}

// ---- A. buildCss 結構性不變式（anti-drift forcing）-------------------------
describe('#13 — buildCss 不變式：:has 錨點禁接萬用後代尾巴', () => {
  function injectedCss() {
    const { document, NS, articleEl } = setup(['styler']);
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const styleEl = document.getElementById('__jread-style');
    assert.ok(styleEl && styleEl.textContent.length > 0, '必須注入 __jread-style');
    // 剝掉 CSS 註解——註解文字會提到歷史 :has 寫法，不能混進 selector 掃描
    return styleEl.textContent.replace(/\/\*[\s\S]*?\*\//g, '');
  }

  it('注入 CSS 內不得有任何「含 :has 的複合選擇器以 * 收尾」（放大器 pattern）', () => {
    const css = injectedCss();
    // 取每條 rule 的 selector 前導（{ 之前），逐一拆逗號檢查。
    // 放大器判準：同一個 complex selector 內含 ':has(' 且 trim 後以 '*' 結尾。
    const preludes = css.split('}')
      .map(chunk => chunk.slice(0, chunk.indexOf('{')))
      .filter(p => p && !p.includes('@')); // @font-face / @media 前導不含 selector list
    const offenders = [];
    for (const prelude of preludes) {
      for (const part of prelude.split(',')) {
        const sel = part.trim();
        if (sel.includes(':has(') && /\*$/.test(sel)) offenders.push(sel);
      }
    }
    assert.deepStrictEqual(offenders, [],
      `發現 :has 放大器選擇器（每次 DOM 插入整頁 recalc）：\n${offenders.join('\n')}\n` +
      '——需要「:has 錨點 + 後代」語意時改 JS 標記 attr（見 styler.js 檔頭 v1.6.30 不變式註解）');
  });

  it('三個放大器的 marker attr 替代規則必須存在（正向斷言，防止整條規則被誤刪）', () => {
    const css = injectedCss();
    // 1. v0.8.59 min-height（cleaner hide() 端標記）
    assert.ok(css.includes('[data-jread-hiddenmedia-wrap="1"] *'),
      'v0.8.59 min-height 解除的 marker 後代規則必須存在');
    // 2. v0.8.155 embed gate
    assert.ok(css.includes(':not([data-jread-embed-wrap="1"]) *'),
      'v0.8.155 static-flow 的 embed-wrap 豁免 gate 必須存在');
    assert.ok(!css.includes(':not(:has(iframe))'),
      '舊 :not(:has(iframe)) gate 不得回歸（放大器）');
    // 3. v0.8.129 / v0.8.131 heading link
    assert.ok(css.includes('a[data-jread-heading-link="1"]'),
      'heading-link marker 規則必須存在');
    assert.ok(!/a:not\(\[data-jread-player="1"\]\):has\(:is\(h1/.test(css) &&
              !/a:has\(:is\(h1/.test(css),
      '舊 a:has(:is(h1..h6)) 選擇器不得回歸');
  });

  it('HIDDENMEDIA_WRAP attr 字串必須在 cleaner.js 與 styler.js 兩檔一致（anti-drift）', () => {
    // 設定端在 cleaner hide()、CSS 端在 styler buildCss——字串 drift 會讓
    // min-height 解除靜默失效（CSS 等一個永遠不會出現的 attr）
    assert.ok(SRC.cleaner.includes("'data-jread-hiddenmedia-wrap'"),
      'cleaner.js 必須定義 data-jread-hiddenmedia-wrap（hide() 設定端）');
    assert.ok(SRC.styler.includes("'data-jread-hiddenmedia-wrap'"),
      'styler.js 必須引用同一 attr 字串（CSS 端）');
  });
});

// ---- B. cleaner hide()：隱藏媒體 → parent 標記 -----------------------------
describe('#13 — cleaner hide() 對隱藏 img/picture 的 parent 標 hiddenmedia-wrap', () => {
  it('hideElement(img) → parent 得 attr；同 parent 第二張不重複記錄；restore 清除', () => {
    const { document, NS } = setup(['detector', 'cleaner']);
    const heroWrap = document.getElementById('hero-wrap');
    const hidden = [];
    NS.cleaner.hideElement(document.getElementById('hero-img'), hidden);
    assert.strictEqual(heroWrap.getAttribute('data-jread-hiddenmedia-wrap'), '1',
      '隱藏 img 的當下 parent 必須標記');
    NS.cleaner.hideElement(document.getElementById('hero-img-2'), hidden);
    assert.strictEqual(hidden.__hiddenMediaWrapEls.length, 1,
      '同 parent 第二張隱藏媒體不得重複 push（idempotent）');
    NS.cleaner.restore(hidden);
    assert.strictEqual(heroWrap.getAttribute('data-jread-hiddenmedia-wrap'), null,
      'restore 必須移除標記');
  });

  it('hideElement(picture) → parent 標記；hideElement(div) 不標', () => {
    const { document, NS } = setup(['detector', 'cleaner']);
    const hidden = [];
    NS.cleaner.hideElement(document.getElementById('hero-picture'), hidden);
    assert.strictEqual(
      document.getElementById('pic-wrap').getAttribute('data-jread-hiddenmedia-wrap'), '1',
      'picture 與 img 同等對待');
    NS.cleaner.hideElement(document.getElementById('ratio-no-iframe'), hidden);
    assert.strictEqual(
      document.getElementById('main-article').getAttribute('data-jread-hiddenmedia-wrap'), null,
      '非媒體元素被 hide 時 parent 不得標記');
  });
});

// ---- C. styler 標記 pass + restore 可逆性 ----------------------------------
describe('#13 — styler apply() 標 embed-wrap / heading-link + restore 清除', () => {
  it('apply：含 iframe 的 aspect 容器標 embed-wrap；無 iframe 的不標', () => {
    const { document, NS, articleEl } = setup(['styler']);
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.strictEqual(
      document.getElementById('embed-with-iframe').getAttribute('data-jread-embed-wrap'), '1',
      'placeholder class + 內含 iframe → 必須標記（v0.8.155 豁免語意）');
    assert.strictEqual(
      document.getElementById('ratio-no-iframe').getAttribute('data-jread-embed-wrap'), null,
      'ratio class 但無 iframe → 不得標記（static-flow 配套要套用）');
    NS.styler.restore(articleEl, snap);
    assert.strictEqual(
      document.getElementById('embed-with-iframe').getAttribute('data-jread-embed-wrap'), null,
      'restore 必須移除 embed-wrap 標記');
  });

  it('apply：包住 heading 的 <a> 標 heading-link；一般連結不標', () => {
    const { document, NS, articleEl } = setup(['styler']);
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.strictEqual(
      document.getElementById('wrapping-heading-link').getAttribute('data-jread-heading-link'), '1',
      '<a><h1> permalink 形必須標記（v0.8.129 語意）');
    assert.strictEqual(
      document.getElementById('plain-link').getAttribute('data-jread-heading-link'), null,
      '一般連結不得標記');
    NS.styler.restore(articleEl, snap);
    assert.strictEqual(
      document.getElementById('wrapping-heading-link').getAttribute('data-jread-heading-link'), null,
      'restore 必須移除 heading-link 標記');
  });

  it('apply：promoted-outside 標題 clone 內的 <a><h1> 也在掃描範圍', () => {
    const { document, NS, articleEl } = setup(['styler']);
    // 模擬 cleaner v0.8.131 在 styler.apply 之前建立的 articleEl 外標題 clone
    const clone = document.createElement('div');
    clone.setAttribute('data-jread-promoted-outside', '1');
    clone.innerHTML = '<a href="/post/1"><h1>Clone 標題</h1></a>';
    articleEl.parentElement.insertBefore(clone, articleEl);
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.strictEqual(
      clone.querySelector('a').getAttribute('data-jread-heading-link'), '1',
      'markHeadingLinks 掃描範圍必須含 promoted-outside clone（v0.8.131 場景）');
  });
});

// ---- D. 動態補標（remarkDynamicMarkers）------------------------------------
describe('#13 — remarkDynamicMarkers：晚 mount 的 embed / heading link 補標', () => {
  it('apply 後晚 mount 的 iframe aspect 容器經 remark 補標，restore 一併清除', () => {
    const { document, NS, articleEl } = setup(['styler']);
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const host = document.getElementById('late-mount-host');
    host.innerHTML = '<div class="embed-ratio" id="late-embed"><iframe src="about:blank"></iframe></div>';
    const node = host.firstElementChild;
    NS.styler.remarkDynamicMarkers(node);
    assert.strictEqual(
      document.getElementById('late-embed').getAttribute('data-jread-embed-wrap'), '1',
      '晚 mount 的 responsive embed 必須補標（v0.8.155 動態場景）');
    NS.styler.restore(articleEl, snap);
    assert.strictEqual(
      document.getElementById('late-embed').getAttribute('data-jread-embed-wrap'), null,
      '動態補標的元素也必須在 restore 清除（push 進同一 marked 清單）');
  });

  it('晚 mount 的 <a><h2> 補標；restore 後 remark 為 no-op', () => {
    const { document, NS, articleEl } = setup(['styler']);
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const host = document.getElementById('late-mount-host');
    host.innerHTML = '<a href="/x" id="late-hlink"><h2>晚到標題</h2></a>';
    NS.styler.remarkDynamicMarkers(host.firstElementChild);
    assert.strictEqual(
      document.getElementById('late-hlink').getAttribute('data-jread-heading-link'), '1');
    NS.styler.restore(articleEl, snap);
    // restore 後 activeMarkState 已清，remark 不得再標任何東西
    host.innerHTML = '<div class="ratio-late" id="post-restore"><iframe src="about:blank"></iframe></div>';
    NS.styler.remarkDynamicMarkers(host.firstElementChild);
    assert.strictEqual(
      document.getElementById('post-restore').getAttribute('data-jread-embed-wrap'), null,
      'restore 後 remark 必須 no-op（防退出後殘留標記無人清）');
  });

  it('wire-up：cleaner 的 dynamic-append observer 必須轉呼 remarkDynamicMarkers', () => {
    // source-shape forcing：晚 mount embed 的補標鏈路 = cleaner observer →
    // NS.styler.remarkDynamicMarkers。observer callback 在 jsdom 為 async，
    // 行為驗證見上兩條（直呼），這裡鎖 wire-up 不被重構掉。
    const m = SRC.cleaner.match(
      /function\s+startWatchingDynamicAppends[\s\S]*?\n  function /);
    assert.ok(m, '找不到 startWatchingDynamicAppends 函式本體');
    assert.ok(/remarkDynamicMarkers\(node\)/.test(m[0]),
      'dynamic-append observer 內必須對 articleEl 內新增節點轉呼 NS.styler.remarkDynamicMarkers');
  });
});
