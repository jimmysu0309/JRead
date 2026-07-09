// JRead — regression spec: hollow media embed placeholder removal (v1.7.0)
// -----------------------------------------------------------------------------
// Forcing function for cleaner rule `hideInsideArticleHollowMediaEmbeds`.
// Trigger: Jimmy 2026-07-09 回報
// https://www.wired.com/story/this-buried-apple-feature-turns-an-iphone-into-the-perfect-kids-dumb-phone
// 「頁面中間有一大段空白」。cage probe 確認是 Condé Nast CNE 影片 embed——
// player 未 init、iframe src="" 空、figure 內 0 img / 0 可見文字，但外層容器
// 保留 ~1081px player 高度 → 主文中段空白。
//
// 既有規則漏網：figure 屬 PRESERVE_SEL（hideInsideArticleThirdPartyIframes 的
// isInPreserved 跳過 iframe）；hideInsideArticleVideoInterludes 需 >= 20 字外連
// 標題 a、空 embed 無字不命中。
//
// 規則設計（結構通則，不綁站，純 DOM 屬性、jsdom 可驗）:
//   figure 含 iframe 且每個 iframe src 空/about:blank
//   + figure 內無 <img>（無 poster）
//   + figure 內無帶 src/<source> 的 <video>
//   + figure textContent 為空
//   → hide 整個 figure（外層預留高度容器隨之塌陷）
//
// 本 spec 的 forcing function:
//   (a) fixture 結構數值驗證（空 iframe / 無 img / 無文字，可重現）
//   (b) 空殼影片 / 音訊 embed figure 必須被 hide（核心保護點）
//   (c) 保護 case：真 YouTube embed / 有 poster 的空 iframe / 有圖說文字的空
//       iframe / 真 lead 圖 figure 必須全部保留——確認 rule 不誤殺
//   (d) 主文內文段落全部保留

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { loadFixtureWithScripts, JREAD_DIR } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'wired-hollow-cne-embed.html');
const CLEANER_SRC = fs.readFileSync(path.join(JREAD_DIR, 'content', 'cleaner.js'), 'utf8');

describe('cleaner — hollow media embed placeholder (Wired / Condé Nast CNE, v1.7.0)', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.querySelector('article');
    assert.ok(articleEl, 'fixture 必須含 <article>');
    env.window.__JRead.cleaner.clean(articleEl);
  });

  // -------- (a) fixture 結構數值驗證 --------
  it('(a) fixture: 空殼影片 figure 結構符合最小重現條件', () => {
    const fig = articleEl.querySelector('[data-test="hollow-video-figure"]');
    assert.ok(fig, 'fixture 必須含 hollow-video-figure');
    const iframes = fig.querySelectorAll('iframe');
    assert.strictEqual(iframes.length, 1, '空殼 figure 必須含 1 個 iframe');
    assert.strictEqual((iframes[0].getAttribute('src') || '').trim(), '',
      '空殼 iframe 的 src 必須為空字串（player 未 init 訊號）');
    assert.strictEqual(fig.querySelector('img'), null, '空殼 figure 內不可有 <img>');
    assert.strictEqual((fig.textContent || '').replace(/\s+/g, ' ').trim(), '',
      '空殼 figure 的 textContent 必須為空');
  });

  // -------- (b) 空殼 embed 必須被 hide（核心保護點）--------
  it('(b1) 空殼影片 figure（iframe src=""）必須被 cleaner hide', () => {
    const fig = articleEl.querySelector('[data-test="hollow-video-figure"]');
    assert.strictEqual(fig.dataset.jreadHidden, '1',
      '空殼影片 figure 必須被標記 data-jread-hidden="1"');
    assert.strictEqual(fig.style.display, 'none',
      '空殼影片 figure 必須 inline display:none');
  });

  it('(b2) 空殼音訊 figure（iframe src="about:blank"）必須被 cleaner hide', () => {
    const fig = articleEl.querySelector('[data-test="hollow-audio-figure"]');
    assert.strictEqual(fig.dataset.jreadHidden, '1',
      '空殼音訊 figure（about:blank iframe）必須被 hide');
    assert.strictEqual(fig.style.display, 'none');
  });

  // -------- (c) 保護 case：合法主文媒體必須保留 --------
  it('(c1) 真 YouTube embed figure（iframe 有實 src）必須保留', () => {
    const fig = articleEl.querySelector('[data-test="legit-youtube-figure"]');
    assert.ok(fig);
    assert.notStrictEqual(fig.dataset.jreadHidden, '1',
      '真 YouTube embed（iframe 有實 src）不可被誤 hide');
    assert.notStrictEqual(fig.style.display, 'none');
  });

  it('(c2) 空 iframe 但有 poster <img> 的 figure 必須保留', () => {
    const fig = articleEl.querySelector('[data-test="legit-poster-figure"]');
    assert.ok(fig);
    assert.notStrictEqual(fig.dataset.jreadHidden, '1',
      '空 iframe 但有 poster 縮圖 → 還有東西可看，不可 hide');
    assert.notStrictEqual(fig.style.display, 'none');
  });

  it('(c3) 空 iframe 但有圖說文字的 figure 必須保留', () => {
    const fig = articleEl.querySelector('[data-test="legit-caption-figure"]');
    assert.ok(fig);
    assert.notStrictEqual(fig.dataset.jreadHidden, '1',
      '空 iframe 但有 figcaption 文字 → 有內容，不可 hide');
    assert.notStrictEqual(fig.style.display, 'none');
  });

  it('(c4) 真 lead 圖 figure（含 <img> + 圖說，無 iframe）必須保留', () => {
    const fig = articleEl.querySelector('[data-test="legit-lead-figure"]');
    assert.ok(fig);
    assert.notStrictEqual(fig.dataset.jreadHidden, '1',
      '真 lead 圖 figure 不可被誤 hide');
    assert.notStrictEqual(fig.style.display, 'none');
  });

  // -------- (d) 主文內文段落保留 --------
  it('(d) 主文內文段落（body-p-1 ~ body-p-7）全部保留', () => {
    for (let i = 1; i <= 7; i++) {
      const p = articleEl.querySelector(`[data-test="body-p-${i}"]`);
      assert.ok(p, `主文 body-p-${i} 必須存在於 fixture`);
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 body-p-${i} 不可被 hide`);
    }
  });
});

// -----------------------------------------------------------------------------
// 動態兜底：CNE player lazy-inject 空 iframe 常晚於 clean()（實測 reload 有時
// clean 當下沒 iframe、稍後才注入 1081px 空殼）——checkDynamicNoise 必須接住。
// -----------------------------------------------------------------------------
describe('cleaner — hollow media embed 動態 lazy-inject 兜底 (v1.7.0)', () => {
  // -------- 單一資料源：靜態 + 動態共用 figureIsHollowMediaEmbed --------
  it('靜態 clean 與動態 observer 都使用 figureIsHollowMediaEmbed（單一資料源）', () => {
    assert.ok(/safeRun\(hideInsideArticleHollowMediaEmbeds/.test(CLEANER_SRC),
      'clean() 必須 safeRun 靜態 sweep hideInsideArticleHollowMediaEmbeds');
    // 靜態與動態都收斂到 figureIsHollowMediaEmbed predicate
    assert.ok(/function\s+hideInsideArticleHollowMediaEmbeds[\s\S]*?figureIsHollowMediaEmbed/.test(CLEANER_SRC),
      '靜態 sweep 必須用 figureIsHollowMediaEmbed');
    assert.ok(/function\s+hideHollowMediaEmbedFrom[\s\S]*?figureIsHollowMediaEmbed/.test(CLEANER_SRC),
      '動態 helper hideHollowMediaEmbedFrom 必須用 figureIsHollowMediaEmbed');
    // 動態 observer（startWatchingDynamicAppends）必須在 isInPreserved guard 之前
    // 呼叫 hideHollowMediaEmbedFrom（hollow embed 載體是 preserved figure）
    const obs = CLEANER_SRC.match(/function\s+startWatchingDynamicAppends[\s\S]*?\n  \}/)[0];
    assert.ok(/hideHollowMediaEmbedFrom/.test(obs),
      'startWatchingDynamicAppends 必須呼叫 hideHollowMediaEmbedFrom（lazy 兜底）');
    const beforeGuard = obs.indexOf('hideHollowMediaEmbedFrom');
    const guardIdx = obs.indexOf('if (isInPreserved(node)) continue;');
    assert.ok(beforeGuard >= 0 && guardIdx >= 0 && beforeGuard < guardIdx,
      'hideHollowMediaEmbedFrom 必須排在 observer 的 isInPreserved continue guard 之前');
  });

  function freshEnv() {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    const art = env.document.querySelector('article');
    const hidden = env.window.__JRead.cleaner.clean(art);
    return { doc: env.document, art, NS: env.window.__JRead, hidden };
  }

  it('(e1) clean 後整塊 lazy 注入的空殼 figure 必須被 observer hide', async () => {
    const { doc, art, NS, hidden } = freshEnv();
    const tmp = doc.createElement('div');
    tmp.innerHTML = '<figure class="cne-video-embed" data-test="lazy-hollow">' +
      '<div><iframe src=""></iframe></div></figure>';
    const fig = tmp.firstElementChild;
    art.appendChild(fig);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(fig.dataset.jreadHidden, '1',
      'lazy 注入的空殼 figure 必須經 checkDynamicNoise hide');
    NS.cleaner.restore(hidden);
  });

  it('(e2) clean 後空 iframe 注入既存空 figure（祖先 hydrate 時序）必須 hide 該 figure', async () => {
    const { doc, art, NS, hidden } = freshEnv();
    // 先注入「空 figure 殼」（此刻無 iframe → 尚非 hollow，不該被 hide）
    const tmp = doc.createElement('div');
    tmp.innerHTML = '<figure class="cne-video-embed" data-test="lazy-shell"></figure>';
    const fig = tmp.firstElementChild;
    art.appendChild(fig);
    await new Promise(r => setTimeout(r, 0));
    assert.notStrictEqual(fig.dataset.jreadHidden, '1',
      '空殼 figure（尚無 iframe）此刻不該被 hide（無 media 訊號）');
    // player 稍後把 src="" 空 iframe 注入既存 figure（addedNode 是 iframe、figure 是祖先）
    const iframe = doc.createElement('iframe');
    iframe.setAttribute('src', '');
    fig.appendChild(iframe);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(fig.dataset.jreadHidden, '1',
      'iframe 注入後 checkDynamicNoise 祖先查必須 hide 整個 figure');
    NS.cleaner.restore(hidden);
  });

  it('(e3) 守衛：lazy 注入含實 src 的真 embed figure 不被誤 hide', async () => {
    const { doc, art, NS, hidden } = freshEnv();
    const tmp = doc.createElement('div');
    tmp.innerHTML = '<figure data-test="lazy-real">' +
      '<iframe src="https://www.youtube.com/embed/xyz"></iframe></figure>';
    const fig = tmp.firstElementChild;
    art.appendChild(fig);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    assert.notStrictEqual(fig.dataset.jreadHidden, '1',
      'lazy 注入的真 YouTube embed（iframe 有實 src）不可被誤 hide');
    NS.cleaner.restore(hidden);
  });
});
