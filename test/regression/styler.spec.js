// JRead — styler regression spec
// jsdom 不算 layout 與 CSS，所以本 spec 驗的是「注入結構」與「可逆性」，
// 不驗視覺效果。視覺效果由 Jimmy 在 Chrome 上手動驗（見 CLAUDE.md
// 「Claude Code 實作的 Chrome 驗證責任」）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');
const STYLER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'styler.js'),
  'utf8'
);
const DETECTOR_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'detector.js'),
  'utf8'
);

function setup() {
  const html = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const { window } = dom;
  window.__JRead = { state: {}, MSG: {} };
  window.eval(DETECTOR_SRC);
  window.eval(STYLER_SRC);
  const detected = window.__JRead.detector.detect();
  assert.ok(detected, 'detector 必須命中商周主文');
  return { window, document: window.document, NS: window.__JRead, articleEl: detected.el };
}

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7
};

describe('styler — businessweekly-7014035', () => {
  it('apply() 注入 <style id="__jread-style"> 到 head', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const styleEl = document.getElementById('__jread-style');
    assert.ok(styleEl, '必須注入 __jread-style');
    assert.strictEqual(styleEl.tagName.toLowerCase(), 'style');
    assert.ok(styleEl.textContent.length > 0, 'style 元素必須有內容');
  });

  it('apply() 替主文容器打上 data-jread-active="1"', () => {
    const { NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.strictEqual(articleEl.getAttribute('data-jread-active'), '1');
  });

  it('apply() 替主文容器的祖先鏈標 data-jread-ancestor="1"（到 body 為止）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    // fixture 中 article.article 的祖先是 <main>（再上去就是 body）
    const main = document.querySelector('main');
    assert.ok(main, 'fixture 應有 <main>');
    assert.strictEqual(main.getAttribute('data-jread-ancestor'), '1');
    // body 不應被標（祖先鏈到 body 為止）
    assert.strictEqual(document.body.getAttribute('data-jread-ancestor'), null);
  });

  it('apply() 替 <html> 加 class __jread-active（觸發頁面底色 reset）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.ok(document.documentElement.classList.contains('__jread-active'));
  });

  it('CSS 含各 theme 預期底色（light / dark / sepia）', () => {
    for (const theme of ['light', 'dark', 'sepia']) {
      const { document, NS, articleEl } = setup();
      NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, theme });
      const css = document.getElementById('__jread-style').textContent;
      const expectedBg = {
        light: '#ececec',
        dark:  '#0b0b0b',
        sepia: '#cdb891'
      }[theme];
      assert.ok(
        css.includes(expectedBg),
        `${theme} theme 的 CSS 應含頁面底色 ${expectedBg}`
      );
    }
  });

  it('CSS 含 :has(img/picture/video) padding-bottom reset（破 aspect-ratio placeholder 留白）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(css.includes(':has(img)'), 'CSS 必須含 :has(img)');
    assert.ok(css.includes(':has(picture)'), 'CSS 必須含 :has(picture)');
    assert.ok(css.includes(':has(video)'), 'CSS 必須含 :has(video)');
    assert.ok(
      /:has\(img\)[^{]*\{[^}]*padding:\s*0\s*!important/.test(css),
      ':has(img) 規則必須含 padding: 0 !important（清 padding-top 與 padding-bottom placeholder）'
    );
  });

  it('CSS 的媒體容器 margin 規則包含 :has(> figure)（修 Substack captioned-image-container 留白）', () => {
    // Substack 的 .captioned-image-container > figure > a > div > picture > img
    // 結構裡，<a> 不是 container 的直接子，舊 :has(> a > img) 無法命中外層
    // container，站點 CSS 的 32px margin 勝出造成圖文間不自然留白。
    // 必須有 :has(> figure) 這條才能讓 container 繼承 1.2em margin。
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(
      css.includes(':has(> figure)'),
      'CSS 必須含 :has(> figure) 以命中 Substack 類的 figure wrapper container'
    );
    assert.ok(
      /:has\(> figure\)[^{]*\{[^}]*margin-top:\s*1\.2em/.test(css) ||
      /figure[\s\S]{0,800}:has\(> figure\)[\s\S]{0,200}\{[^}]*margin-top:\s*1\.2em/.test(css),
      ':has(> figure) 所在的規則區塊必須套 margin-top: 1.2em'
    );
  });

  it('CSS 強制非 heading 後代繼承 font-size（避免站點 <p> 寫死 px 無視 article fontSize）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(
      /\*:not\(h1\)[^{]*\{\s*font-size:\s*inherit\s*!important/.test(css),
      'CSS 必須含 *:not(h1):... { font-size: inherit !important } 規則'
    );
  });

  it('CSS 注入 settings 指定的 fontSize / contentWidth / lineHeight', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontSize: 21, contentWidth: 880, lineHeight: 1.9 });
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(css.includes('font-size: 21px'));
    assert.ok(css.includes('max-width: 880px'));
    assert.ok(css.includes('line-height: 1.9'));
  });

  it('未指定 settings 時使用預設值（18 / 720 / system-ui / 1.7 / light）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, {});
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(css.includes('font-size: 18px'));
    assert.ok(css.includes('max-width: 720px'));
    assert.ok(css.includes('line-height: 1.7'));
    assert.ok(css.includes('#ececec'), '預設 theme 為 light → 頁面底色 #ececec');
  });

  it('apply() 把主文內第一個 h1/h2/h3/h4/p 的 margin-top 設為 0 !important（消除頂端留白）', () => {
    const { NS, articleEl } = setup();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const firstInk = articleEl.querySelector('h1, h2, h3, h4, p');
    assert.ok(firstInk, 'fixture 主文內必須有 h1/h2/h3/h4/p');
    // jsdom 把 '0' 正規化為 '0px'
    assert.strictEqual(firstInk.style.getPropertyValue('margin-top'), '0px');
    assert.strictEqual(firstInk.style.getPropertyPriority('margin-top'), 'important');
  });

  it('restore() 還原原本 inline margin-top（有值）', () => {
    const { NS, articleEl } = setup();
    const target = articleEl.querySelector('h1');
    assert.ok(target);
    target.style.setProperty('margin-top', '2em');
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.restore(articleEl, snap);
    assert.strictEqual(target.style.getPropertyValue('margin-top'), '2em');
  });

  it('restore() 在原本無 inline margin-top 時清空（避免留 "0px"）', () => {
    const { NS, articleEl } = setup();
    const target = articleEl.querySelector('h1');
    assert.ok(target);
    assert.strictEqual(target.style.marginTop, '', '前提：fixture 中 h1 無 inline margin-top');
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.restore(articleEl, snap);
    assert.strictEqual(target.style.marginTop, '');
  });

  it('restore() 移除 style 元素、所有 dataset 標記與 html class', () => {
    const { document, NS, articleEl } = setup();
    const snapshot = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.restore(articleEl, snapshot);

    assert.strictEqual(document.getElementById('__jread-style'), null,
      'style 元素應被移除');
    assert.strictEqual(articleEl.getAttribute('data-jread-active'), null,
      'article 的 data-jread-active 應被移除');
    const remainingAncestors = document.querySelectorAll('[data-jread-ancestor="1"]');
    assert.strictEqual(remainingAncestors.length, 0,
      '所有祖先的 data-jread-ancestor 應被移除');
    assert.strictEqual(
      document.documentElement.classList.contains('__jread-active'),
      false,
      'html 的 __jread-active class 應被移除'
    );
  });

  it('重複 apply() 不重複注入 style 元素（更新同一個）', () => {
    const { document, NS, articleEl } = setup();
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontSize: 18 });
    NS.styler.apply(articleEl, { ...DEFAULT_SETTINGS, fontSize: 22 });
    const allStyles = document.querySelectorAll('#__jread-style');
    assert.strictEqual(allStyles.length, 1, '只能有一個 __jread-style 元素');
    assert.ok(allStyles[0].textContent.includes('font-size: 22px'),
      '第二次 apply 的 fontSize 應覆蓋第一次');
  });

  it('apply / restore / apply 循環不累積殘留', () => {
    const { document, NS, articleEl } = setup();
    const s1 = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.restore(articleEl, s1);
    const s2 = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    NS.styler.restore(articleEl, s2);

    assert.strictEqual(document.getElementById('__jread-style'), null);
    assert.strictEqual(articleEl.getAttribute('data-jread-active'), null);
    assert.strictEqual(document.querySelectorAll('[data-jread-ancestor="1"]').length, 0);
    assert.strictEqual(document.documentElement.classList.contains('__jread-active'), false);
  });

  it('null / undefined articleEl 不拋錯，回傳 null', () => {
    const { NS } = setup();
    assert.strictEqual(NS.styler.apply(null, DEFAULT_SETTINGS), null);
    assert.strictEqual(NS.styler.apply(undefined, DEFAULT_SETTINGS), null);
  });

  it('restore(null) 不拋錯（snapshot 為 null 即 no-op）', () => {
    const { NS, articleEl } = setup();
    assert.doesNotThrow(() => NS.styler.restore(articleEl, null));
  });
});

// -----------------------------------------------------------------------------
// 結構性連結（heading 包 a、parent 只含此 a 作為文字）：不套 link 色
// -----------------------------------------------------------------------------
// 根因：WordPress / Medium / Substack 類 CMS 的 post-title 與 category label
// 常包成 <a>（點標題跳 permalink）。閱讀模式原本無差別對「主文內所有 <a>」
// 套藍色 + underline，導致標題整行變連結樣式（見 Stratechery 2026-04-21 截圖）。
// 修法為結構性通則：styler.apply() 掃描主文內所有 <a>，若 (A) 位於 h1-h6 內，
// 或 (B) parent 的 textContent 等於 a 的 textContent（parent 沒有其他文字），
// 標 data-jread-structural-link="1"；CSS 對此 attribute 改用繼承色 + 無底線。
// 真 inline link（parent 還有其他文字，例如 "在 <a>設定頁</a> 修改"）不受影響。
// -----------------------------------------------------------------------------
describe('styler — structural link（heading 包 a / parent-only-text a）', () => {
  const STRATECHERY_FIXTURE = path.join(__dirname, 'fixtures', 'stratechery-columns-layout.html');

  function setupStratechery() {
    const html = fs.readFileSync(STRATECHERY_FIXTURE, 'utf8');
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const { window } = dom;
    window.__JRead = { state: {}, MSG: {} };
    window.eval(DETECTOR_SRC);
    window.eval(STYLER_SRC);
    const detected = window.__JRead.detector.detect();
    assert.ok(detected, 'detector 必須命中 stratechery 主文');
    return { window, document: window.document, NS: window.__JRead, articleEl: detected.el };
  }

  it('heading (h1-h6) 內的 <a> 套 data-jread-structural-link="1"', () => {
    const { NS, articleEl } = setupStratechery();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const h2a = articleEl.querySelector('h2.wp-block-post-title a');
    assert.ok(h2a, 'fixture 必須有 h2 內的 <a>');
    assert.strictEqual(
      h2a.getAttribute('data-jread-structural-link'),
      '1',
      'h2 內的 a 必須被標記為 structural link'
    );
  });

  it('parent 只含此 a 作為文字內容的 <a> 被標記（category 標籤 pattern）', () => {
    const { NS, articleEl } = setupStratechery();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const catA = articleEl.querySelector('p.stratechery-display-categories a');
    assert.ok(catA, 'fixture 必須有 category p 內的 <a>');
    assert.strictEqual(
      catA.getAttribute('data-jread-structural-link'),
      '1',
      'parent 只含此 a 為文字的連結必須被標記'
    );
  });

  it('真 inline link（parent 還有其他文字）不被標記', () => {
    const { NS, articleEl } = setupStratechery();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    // fixture 的 "your delivery settings" <a> 在 <p> 裡但 p 還有其他文字
    let inlineA = null;
    for (const a of articleEl.querySelectorAll('a')) {
      if ((a.textContent || '').includes('your delivery settings')) { inlineA = a; break; }
    }
    assert.ok(inlineA, 'fixture 必須含一個真 inline link（your delivery settings）');
    assert.strictEqual(
      inlineA.getAttribute('data-jread-structural-link'),
      null,
      '真 inline link 不得被誤標為 structural'
    );
  });

  it('CSS 含對 [data-jread-structural-link] 的繼承色規則', () => {
    const { document, NS, articleEl } = setupStratechery();
    NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    const css = document.getElementById('__jread-style').textContent;
    assert.ok(
      /\[data-jread-structural-link="1"\]/.test(css),
      'CSS 必須含 [data-jread-structural-link="1"] selector'
    );
    assert.ok(
      /data-jread-structural-link[^}]*color:\s*inherit/.test(css),
      'structural link 規則必須包含 color: inherit'
    );
    assert.ok(
      /data-jread-structural-link[^}]*text-decoration:\s*none/.test(css),
      'structural link 規則必須包含 text-decoration: none'
    );
  });

  it('restore() 清除所有 data-jread-structural-link 標記', () => {
    const { NS, articleEl } = setupStratechery();
    const snap = NS.styler.apply(articleEl, DEFAULT_SETTINGS);
    assert.ok(
      articleEl.querySelector('[data-jread-structural-link="1"]'),
      'apply() 後至少有一個 structural link 標記'
    );
    NS.styler.restore(articleEl, snap);
    assert.strictEqual(
      articleEl.querySelector('[data-jread-structural-link="1"]'),
      null,
      'restore() 後必須清除所有 structural link 標記'
    );
  });
});
