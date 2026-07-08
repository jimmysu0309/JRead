// JRead — late-mount embed 的原站隱藏 fallback img 動態釘死 regression spec（v1.6.25）
//
// 根因（2026-07-09 Chromium probe 於 healthsystemtracker 實證）：靜態
// hideInsideArticleOriginallyHiddenImgs（v0.8.48）只在 clean() 跑一次；lazy
// embed（datawrapper 類）在 clean 之後才 mount 時，其 stylesheet display:none
// 的 no-JS fallback img 被 styler 持久 `display:block !important` 復活——每張
// 圖表出現兩份（probe：clean 後注入 embed clone，fallback img computed block、
// rect 608x316、無任何釘死標記）。
//
// 通則修法（結構性、不綁站點）：MutationObserver 動態 pass 補
// pinDynamicEmbedFallbackImgs——量測用 NS.withInjectedCssDisabled 暫停 JRead
// 注入 stylesheet 還原站方 cascade（styler 生效後直接 getComputedStyle 讀不到
// 「原站隱藏」）；誤殺防護 gate 只釘「embed fallback 簽名」：(A) 近祖先容器內
// 有可見 iframe/embed/object、(B) articleEl 內已有另一張可見同 src img。
// 一般 lazy-load 內容圖（先藏後顯、無簽名）不釘，避免 inline !important 鎖死
// 站方 reveal。
//
// 本 spec 驗訊號層：jsdom 驗「規則會選到哪些 img、釘死結構正確」；不驗
// 「styler stylesheet 在真實 cascade 下真的被暫停」（jsdom 不完整實作
// sheet.disabled 對 computed 的影響）——該層由 Chromium harness probe 驗。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
);
const NAMESPACE_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'namespace.js'), 'utf8'
);

const tick = () => new Promise(r => setTimeout(r, 0));

function buildEnv() {
  const dom = new JSDOM(`<!DOCTYPE html><html><head>
    <style>.embed-fallback { display: none; }</style>
    </head><body><main id="wrap">
    <article id="art"><h1>美國醫療支出成長的驅動因素</h1>
    <p>本文分析 2013 至 2021 年間人均醫療支出各類別的變化，行政成本的增加在美國相對於同儕國家貢獻了可觀的成長份額，這段主文夠長以通過字數門檻。</p>
    <div class="datawrapper-embed" id="static-embed">
      <iframe src="about:blank" title="chart-static"></iframe>
      <img id="static-fallback" class="embed-fallback" src="https://img.example/static/full.png" alt="">
    </div>
    <p>第二段主文內容，繼續描述各支出類別的組成與跨國比較方法，維持足夠長度避免被當空容器誤判。</p>
    </article></main></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
  window.eval(SRC.namespace);
  window.eval(SRC.cleaner);
  const doc = window.document;
  const art = doc.getElementById('art');
  return { window, doc, art, NS: window.__JRead };
}

// 組一個 late-mount embed（可見 iframe + stylesheet 隱藏 fallback img）
function makeEmbed(doc, id) {
  const embed = doc.createElement('div');
  embed.className = 'datawrapper-embed';
  embed.id = id;
  const iframe = doc.createElement('iframe');
  iframe.src = 'about:blank';
  iframe.title = 'chart-' + id;
  const img = doc.createElement('img');
  img.className = 'embed-fallback';
  img.src = `https://img.example/${id}/full.png`;
  embed.appendChild(iframe);
  embed.appendChild(img);
  return { embed, iframe, img };
}

describe('late-mount-embed-fallback-img — 結構 forcing', () => {
  it('cleaner 必須宣告 pinDynamicEmbedFallbackImgs 並在 observer callback 呼叫', () => {
    assert.ok(/function\s+pinDynamicEmbedFallbackImgs/.test(CLEANER_SRC),
      '必須宣告 pinDynamicEmbedFallbackImgs');
    const mo = CLEANER_SRC.match(/function\s+startWatchingDynamicAppends[\s\S]*?\n  \}/)[0];
    assert.ok(/pinDynamicEmbedFallbackImgs\(articleEl,\s*node,\s*hiddenList\)/.test(mo),
      'MutationObserver callback 必須呼叫 pinDynamicEmbedFallbackImgs');
    // 呼叫必須在 isInPreserved guard 之前（figure 內 fallback img 也要釘，與靜態版同）
    const pinIdx = mo.indexOf('pinDynamicEmbedFallbackImgs(articleEl');
    const preservedIdx = mo.indexOf('if (isInPreserved(node)) continue;');
    assert.ok(pinIdx >= 0 && preservedIdx >= 0 && pinIdx < preservedIdx,
      'pin 呼叫必須在 isInPreserved guard 之前');
  });

  it('量測必須走 NS.withInjectedCssDisabled（styler 生效後 computed 讀不到原站隱藏）', () => {
    const fn = CLEANER_SRC.match(/function\s+pinDynamicEmbedFallbackImgs[\s\S]*?\n  \}/)[0];
    assert.ok(/withInjectedCssDisabled/.test(fn),
      '必須用 withInjectedCssDisabled 暫停 JRead 注入 CSS 再量 computed display');
  });

  it('namespace 必須提供 withInjectedCssDisabled 且 injectCssText/removeCssText 維護 id 登記簿', () => {
    assert.ok(/withInjectedCssDisabled\(fn\)/.test(NAMESPACE_SRC), '必須宣告 withInjectedCssDisabled');
    assert.ok(/_injectedCssIds/.test(NAMESPACE_SRC), '必須有 _injectedCssIds 登記簿');
    const inject = NAMESPACE_SRC.match(/injectCssText\(id,\s*css\)\s*\{[\s\S]*?\n    \},/)[0];
    assert.ok(/_injectedCssIds\.add\(id\)/.test(inject), 'injectCssText 必須登記 id');
    const remove = NAMESPACE_SRC.match(/removeCssText\(id\)\s*\{[\s\S]*?\n    \},/)[0];
    assert.ok(/_injectedCssIds\.delete\(id\)/.test(remove), 'removeCssText 必須註銷 id');
  });
});

describe('late-mount-embed-fallback-img — namespace withInjectedCssDisabled 行為', () => {
  it('停用所有注入 sheet、fn 跑完復原（含 fn throw 時）', () => {
    const { window, doc, NS } = buildEnv();
    const styleEl = NS.injectCssText('__test-style', 'div { color: red; }');
    assert.ok(styleEl.sheet, 'jsdom 需產生 sheet 才能驗 disabled 切換');
    let insideDisabled = null;
    NS.withInjectedCssDisabled(() => { insideDisabled = styleEl.sheet.disabled; });
    assert.strictEqual(insideDisabled, true, 'fn 執行期間 sheet 必須 disabled');
    assert.strictEqual(styleEl.sheet.disabled, false, 'fn 跑完必須復原');
    assert.throws(() => NS.withInjectedCssDisabled(() => { throw new Error('boom'); }));
    assert.strictEqual(styleEl.sheet.disabled, false, 'fn throw 也必須復原（finally）');
    NS.removeCssText('__test-style');
  });
});

describe('late-mount-embed-fallback-img — 行為', () => {
  it('clean 當下已存在的 embed fallback img 仍由靜態規則釘住（不退步）', () => {
    const { doc, art, NS } = buildEnv();
    const hidden = NS.cleaner.clean(art);
    const img = doc.getElementById('static-fallback');
    assert.strictEqual(img.dataset.jreadHidden, '1', '靜態路徑必須照舊釘住');
    NS.cleaner.restore(hidden);
  });

  it('clean 後才 mount 的 embed：stylesheet 隱藏 fallback img 被動態釘 inline !important 且進 hidden 清單', async () => {
    const { doc, art, NS } = buildEnv();
    const hidden = NS.cleaner.clean(art);

    const { embed, img } = makeEmbed(doc, 'late1');
    art.appendChild(embed);
    await tick(); await tick();

    assert.strictEqual(img.dataset.jreadHidden, '1', 'late-mount fallback img 必須被釘住');
    assert.strictEqual(img.style.getPropertyValue('display'), 'none');
    assert.strictEqual(img.style.getPropertyPriority('display'), 'important',
      '必須 inline !important 才贏得過 styler 的 display:block !important');
    assert.ok(hidden.some(h => h.el === img), '必須進 hidden 清單（退出 reader 可回復）');
    NS.cleaner.restore(hidden);
  });

  it('一般 lazy-load 內容圖（隱藏但無 embed 簽名）不被釘（先藏後顯不可鎖死）', async () => {
    const { doc, art, NS } = buildEnv();
    const hidden = NS.cleaner.clean(art);

    const img = doc.createElement('img');
    img.className = 'embed-fallback'; // 借同一條 stylesheet 隱藏；無 iframe 兄弟、無同 src 副本
    img.src = 'https://img.example/lazy-content/photo.jpg';
    art.appendChild(img);
    await tick(); await tick();

    assert.notStrictEqual(img.dataset.jreadHidden, '1',
      '無 embed fallback 簽名的隱藏 img 不可釘（站方 reveal 會被 inline !important 鎖死）');
    NS.cleaner.restore(hidden);
  });

  it('iframe 已被 JRead hide（unknown-host embed）時 fallback img 不釘（它是唯一內容）', async () => {
    const { doc, art, NS } = buildEnv();
    const hidden = NS.cleaner.clean(art);

    const { embed, iframe, img } = makeEmbed(doc, 'late2');
    // 模擬 hideInsideArticleThirdPartyIframes 已把 unknown-host iframe 藏掉
    iframe.dataset.jreadHidden = '1';
    iframe.style.setProperty('display', 'none', 'important');
    art.appendChild(embed);
    await tick(); await tick();

    assert.notStrictEqual(img.dataset.jreadHidden, '1',
      'live embed 被藏掉時 fallback img 是唯一內容，釘掉＝圖表整個消失');
    NS.cleaner.restore(hidden);
  });

  it('分段 mount（img 先到、iframe 後到）：iframe 到齊那批補查釘住既有 img', async () => {
    const { doc, art, NS } = buildEnv();
    const hidden = NS.cleaner.clean(art);

    // 第一批：容器 + fallback img（無 iframe → gate 不過、不釘）
    const embed = doc.createElement('div');
    embed.className = 'datawrapper-embed';
    const img = doc.createElement('img');
    img.className = 'embed-fallback';
    img.src = 'https://img.example/staged/full.png';
    embed.appendChild(img);
    art.appendChild(embed);
    await tick(); await tick();
    assert.notStrictEqual(img.dataset.jreadHidden, '1', 'iframe 未到前不可釘');

    // 第二批：iframe 補進同容器 → 近祖先容器內既有 img 納入補查
    const iframe = doc.createElement('iframe');
    iframe.src = 'about:blank';
    embed.appendChild(iframe);
    await tick(); await tick();
    assert.strictEqual(img.dataset.jreadHidden, '1', 'iframe 到齊後必須補釘 fallback img');
    NS.cleaner.restore(hidden);
  });

  it('訊號 B：article 已有可見同 src img 時，動態插入的隱藏同 src 副本被釘（真雙圖）', async () => {
    const { doc, art, NS } = buildEnv();
    // 先放一張可見內容圖
    const visible = doc.createElement('img');
    visible.src = 'https://img.example/hero/photo.png?w=1200';
    art.appendChild(visible);
    const hidden = NS.cleaner.clean(art);

    const dup = doc.createElement('img');
    dup.className = 'embed-fallback';
    dup.src = 'https://img.example/hero/photo.png?w=600'; // query 不同、路徑同（同 src key）
    art.appendChild(dup);
    await tick(); await tick();

    assert.strictEqual(dup.dataset.jreadHidden, '1', '可見同 src 副本已存在＝真雙圖，隱藏份必須釘住');
    NS.cleaner.restore(hidden);
  });
});
