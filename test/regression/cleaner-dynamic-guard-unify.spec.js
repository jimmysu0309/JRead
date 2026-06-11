// JRead — 靜態 / 動態雙 path 的 hide guard 統一（v0.8.36，code review B2/B3/B8）
//
// Bug（B2）：checkDynamicNoise 缺靜態 rule 的三道主文保護：
//   1. keyword path：靜態有 H1 guard + wrapperContainsMainContentP guard
//      （v0.7.83/0.7.97 twz paywall 主文 wrapper 教訓）；動態零 guard——
//      Shinkansen 翻譯重建 / React reconciliation 把 class 含 paywall/share
//      token 的主文 wrapper re-append 時，整篇主文被藏掉
//   2. button path：靜態有「button 內含 img/picture/video 不 hide」的 Medium
//      click-to-zoom 保護；動態無條件 hide——lazy 注入的圖片 wrapper 連圖消失
//   3. <a> path：靜態 keyword <a> 有 lightbox 大圖豁免；動態直接 hide
// Bug（B8）：靜態 keyword <a> 的大圖豁免漏了 v0.7.212 的「href 指圖檔 / lazy
//   content src」判定——lazy 圖未載入（naturalWidth=0、rect 0×0，jsdom 天然
//   重現此狀態）時 lightbox 連結被誤殺。
// Bug（B3）：title clone 把子樹 data-jread-hidden 全清會「復活」已清雜訊，
//   且 promote 跑在所有 rule 之後、clone 不再被掃——share button 在卡片頂部復活。
//
// 修法：keywordWrapperIsProtected / anchorIsContentImageLink /
// buttonWrapsContentMedia 抽成單一資料源，靜態與動態共用；title clone 加
// sanitizeTitleClone 就地清互動雜訊。

const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

function buildEnv(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
  window.eval(SRC.namespace);
  window.eval(SRC.cleaner);
  return { window, document: window.document, NS: window.__JRead };
}

const flush = () => new Promise(r => setTimeout(r, 0)).then(() => new Promise(r => setTimeout(r, 0)));

const ARTICLE_HTML = `<!DOCTYPE html><html><body><main>
  <article id="art"><h1>標題</h1>
  <p>這是一段夠長的主文內容，包含逗號、句號，足夠通過字數門檻與各種保護判定的長度要求。</p>
  <p>第二段主文內容，繼續描述，維持足夠長度避免被當空容器，並補滿一百個字元的門檻需求。</p>
  </article></main></body></html>`;

describe('cleaner — 動態 path guard 與靜態統一（B2）', () => {
  it('動態 re-append 的「keyword 命中但含主文長 p」wrapper 不可被整塊 hide', async () => {
    const { document, NS } = buildEnv(ARTICLE_HTML);
    const art = document.getElementById('art');
    NS.cleaner.clean(art);

    // 模擬 twz 場景：class 含 paywall（命中 NOISE_KEYWORD_RE）但內含 >= 100
    // chars 主文 p 的 wrapper 被翻譯 / reconciliation 重新 append
    const wrapper = document.createElement('div');
    wrapper.className = 'entry-content paywall';
    const p = document.createElement('p');
    p.textContent = '主文長段落'.repeat(25); // 125 chars，過 wrapperContainsMainContentP 門檻
    wrapper.appendChild(p);
    const cta = document.createElement('button');
    cta.textContent = '訂閱';
    wrapper.appendChild(cta);
    art.appendChild(wrapper);
    await flush();

    assert.notStrictEqual(wrapper.dataset.jreadHidden, '1',
      '含主文長 p 的 keyword wrapper 不可被動態 path 整塊 hide（B2：與靜態 keywordWrapperIsProtected 同源）');
    assert.strictEqual(cta.dataset.jreadHidden, '1',
      'wrapper 被保護後，內部 CTA button 仍須被內層掃描清掉');
  });

  it('動態注入的純雜訊 wrapper（無主文 p）照舊整塊 hide', async () => {
    const { document, NS } = buildEnv(ARTICLE_HTML);
    const art = document.getElementById('art');
    NS.cleaner.clean(art);

    const noise = document.createElement('div');
    noise.className = 'related-news';
    noise.innerHTML = '<p>推薦文章清單</p>';
    art.appendChild(noise);
    await flush();

    assert.strictEqual(noise.dataset.jreadHidden, '1', '純雜訊 wrapper 行為不變、照舊 hide');
  });

  it('動態注入的媒體 button（Medium click-to-zoom 形狀）不可 hide；純 CTA button 照舊 hide', async () => {
    const { document, NS } = buildEnv(ARTICLE_HTML);
    const art = document.getElementById('art');
    NS.cleaner.clean(art);

    const mediaBtn = document.createElement('div');
    mediaBtn.setAttribute('role', 'button');
    mediaBtn.innerHTML = '<img src="https://cdn.example.com/photo.jpg">';
    art.appendChild(mediaBtn);

    const ctaBtn = document.createElement('button');
    ctaBtn.textContent = 'Follow';
    art.appendChild(ctaBtn);
    await flush();

    assert.notStrictEqual(mediaBtn.dataset.jreadHidden, '1',
      '含主文媒體的 button wrapper 不可 hide（B2：與靜態 buttonWrapsContentMedia 同源）');
    assert.strictEqual(ctaBtn.dataset.jreadHidden, '1', '純 CTA button 照舊 hide');
  });

  it('動態 wrapper 內 keyword 命中的 lightbox <a>（lazy 圖未載入）不可 hide', async () => {
    const { document, NS } = buildEnv(ARTICLE_HTML);
    const art = document.getElementById('art');
    NS.cleaner.clean(art);

    const wrap = document.createElement('div');
    const lightbox = document.createElement('a');
    lightbox.className = 'image-popup-vertical-fit'; // popup 命中 keyword
    lightbox.innerHTML = '<img data-src="https://cdn.example.com/full.jpg">'; // lazy、jsdom 下 naturalWidth=0
    wrap.appendChild(lightbox);
    const shareLink = document.createElement('a');
    shareLink.className = 'btn-social btn-social--line';
    shareLink.textContent = '分享';
    wrap.appendChild(shareLink);
    art.appendChild(wrap);
    await flush();

    assert.notStrictEqual(lightbox.dataset.jreadHidden, '1',
      'lazy content 圖的 lightbox <a> 不可被動態 path 誤殺（anchorIsContentImageLink 豁免）');
    assert.strictEqual(shareLink.dataset.jreadHidden, '1', '社群分享 <a> 照舊 hide');
  });
});

describe('cleaner — 靜態 keyword <a> 的 lazy 圖豁免（B8）', () => {
  it('clean() 時 class 命中 keyword 且圖未 lazy-load 的 lightbox <a> 不可 hide', () => {
    // jsdom 天然重現「lazy 圖未載入」：naturalWidth=0、rect 0×0——v0.8.36 前
    // 本 path 只看 natural / rendered 尺寸，必殺；修法補 href 圖檔 + lazy src 判定
    const { document, NS } = buildEnv(`<!DOCTYPE html><html><body><main>
      <article id="art"><h1>標題</h1>
      <p>這是一段夠長的主文內容，包含逗號、句號，足夠通過字數門檻與各種保護判定的長度要求。</p>
      <a id="lb" class="image-popup-vertical-fit"><img data-src="https://cdn.example.com/full.jpg"></a>
      </article></main></body></html>`);
    const art = document.getElementById('art');
    NS.cleaner.clean(art);
    assert.notStrictEqual(document.getElementById('lb').dataset.jreadHidden, '1',
      '靜態 keyword <a> path 必須豁免 lazy content 圖的 lightbox 連結（B8）');
  });
});

describe('cleaner — title clone 雜訊就地清理（B3）', () => {
  it('promote 進卡片的 title clone 內，share button / icon-only a 必須被清、標題保留', () => {
    // 模擬 eet-china 場景：page-wide unique h1 在 articleEl 外、wrapper 內
    // 混有 share buttons + icon-only links
    const { document, NS } = buildEnv(`<!DOCTYPE html><html><head>
      <meta property="og:title" content="這是主文標題完整字串">
      <title>這是主文標題完整字串 - 某站</title></head><body>
      <div id="header-zone">
        <h1>這是主文標題完整字串</h1>
        <button class="share-btn">分享</button>
        <a href="https://line.me/share" class="social-line"><svg></svg></a>
      </div>
      <article id="art">
      <p>這是一段夠長的主文內容，包含逗號、句號，足夠通過字數門檻與各種保護判定的長度要求。</p>
      <p>第二段主文內容，繼續描述，維持足夠長度避免被當空容器，並補滿一百個字元的門檻需求。</p>
      </article></body></html>`);
    const art = document.getElementById('art');
    const hidden = NS.cleaner.clean(art);

    const clone = art.querySelector('[data-jread-title-clone="1"]');
    assert.ok(clone, '必須 promote title clone 進 articleEl');
    assert.ok(clone.querySelector('h1'), 'clone 內標題必須保留');
    const cloneBtn = clone.querySelector('button');
    assert.ok(cloneBtn, '前置：clone 內含複製來的 button');
    assert.strictEqual(cloneBtn.style.getPropertyValue('display'), 'none',
      'clone 內 button 必須被 sanitizeTitleClone 就地清掉（B3：promote 跑在所有 rule 之後、不清就復活）');
    const cloneIconA = clone.querySelector('a');
    assert.strictEqual(cloneIconA.style.getPropertyValue('display'), 'none',
      'clone 內 icon-only <a> 必須被清掉');

    // restore 後 clone 整個移除（__titleClone path 不受 sanitize 影響）
    NS.cleaner.restore(hidden);
    assert.strictEqual(art.querySelector('[data-jread-title-clone="1"]'), null,
      'restore 後 clone 必須整個移除');
  });
});
