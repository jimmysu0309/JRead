// JRead — lazy-load placeholder ::before aspect 佔位中和 + spinner svg 隱藏（v1.0.5）
//
// Bug：fiaformulae.com 文章進 reader mode 後「標題下方一大段空白」（Jimmy
// 2026-06-25 截圖回報）。
//
// 根因（cage 真實站 probe 實證）：主圖結構
//   DIV.w-embeddable-photo__image-container.o-placeholder
//     （::before { content:""; padding-bottom:56.25% } 撐 aspect 佔位）
//     > SVG（lazy-load spinner，width:20px 但無 height → svg display:block 露出
//       replaced-element 預設 150px 高）
//     > DIV.js-lazy-load { position:absolute; inset:0 }（填滿佔位的真圖 overlay）
//       > PICTURE.object-fit-cover-picture > IMG
// styler 的 [class*="placeholder"] * static-flow reset 把 js-lazy-load 打回
// position:static → 圖掉出 overlay、堆到「仍存活的 ::before 佔位」下方。關鍵漏網：
// ::before 中和規則（content:none）原本只列 picture / figure / object-fit / ratio，
// **沒有 placeholder** → o-placeholder 的 ::before 佔位（342px）存活 → 佔位 + svg
// spinner（150px）+ static 化的圖 = 標題下方 ~517px 空白。
//
// 通則修法（結構性，非站點 hostname/hash class 特判）：
//   1) [class*="placeholder"]::before/::after 補進既有 ::before 中和清單（content:none
//      + padding-bottom:0 + height:0）——object-fit/ratio 早有、placeholder 漏掉。
//   2) [class*="placeholder"/"ratio"/"object-fit"] > svg 隱藏——lazy-load wrapper 的
//      direct child <svg> 是 spinner 載入動畫（內容用 svg 圖表掛 figure/content div、
//      不會是 lazy wrapper 的 direct child），reader mode 下原站 lazy observer 凍結、
//      spinner 不會被站方 JS 收掉，須由 styler 隱藏。
//
// 註：jsdom 不算 ::before padding-bottom / svg replaced 高度 layout，本 spec 驗
// styler CSS 字串注入 + fixture 元素對得上可 match 的 selector（CLAUDE.md「驗哪層
// 訊號」）；實際 860→342px 塌回的視覺結果由 cage 真實站截圖驗（已實證）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'lazy-placeholder-before-aspect-spinner.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function loadEnv() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  env.NS.styler.apply(detected.el, DEFAULT_SETTINGS);
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl, '必須注入 __jread-style');
  return { env, css: styleEl.textContent };
}

// 抓「content:none + padding-bottom:0 + height:0」這條 ::before 中和 rule 的 selector 群
function getBeforeNeutralizeBlock(css) {
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const sel = m[1];
    const body = m[2];
    if (/content\s*:\s*none\s*!important/.test(body) &&
        /padding-bottom\s*:\s*0\s*!important/.test(body) &&
        /height\s*:\s*0\s*!important/.test(body) &&
        /::before/.test(sel)) {
      return { sel: sel.trim(), body };
    }
  }
  return null;
}

describe('styler — lazy placeholder ::before 中和 + spinner svg 隱藏（v1.0.5 fiaformulae）', () => {
  it('::before 中和規則必須涵蓋 [class*="placeholder"]::before（核心修法）', () => {
    const { css } = loadEnv();
    assert.ok(
      /\[class\*="placeholder" i\]::before/.test(css),
      'CSS 必須含 [class*="placeholder" i]::before（lazy-load 佔位 ::before 中和）'
    );
    assert.ok(
      /\[class\*="placeholder" i\]::after/.test(css),
      'CSS 必須含 [class*="placeholder" i]::after'
    );
  });

  it('placeholder ::before 與既有 object-fit/ratio 在同一條 content:none 中和 rule', () => {
    const { css } = loadEnv();
    const block = getBeforeNeutralizeBlock(css);
    assert.ok(block, '必須找到 content:none + padding-bottom:0 + height:0 的 ::before 中和 rule');
    for (const needle of ['placeholder', 'object-fit', 'ratio', 'picture', 'figure']) {
      assert.ok(block.sel.includes(needle),
        `::before 中和 selector 群必須含 ${needle}（合併後不退步）：${block.sel.slice(0, 120)}`);
    }
  });

  it('lazy-load wrapper 的 direct child svg spinner 必須被隱藏', () => {
    const { css } = loadEnv();
    for (const cls of ['placeholder', 'ratio', 'object-fit']) {
      assert.ok(
        new RegExp(`\\[class\\*="${cls}" i\\]\\s*>\\s*svg`).test(css),
        `CSS 必須含 [class*="${cls}" i] > svg 隱藏規則（lazy-load spinner）`
      );
    }
    // 確認該 svg 規則 body 為 display:none
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m, found = false;
    while ((m = re.exec(css)) !== null) {
      if (/\[class\*="placeholder" i\]\s*>\s*svg/.test(m[1]) && /display\s*:\s*none\s*!important/.test(m[2])) {
        found = true;
        break;
      }
    }
    assert.ok(found, 'placeholder > svg 規則 body 必須是 display:none !important');
  });

  it('fixture 的 o-placeholder 容器與 spinner svg 對得上可 match 的 selector', () => {
    const { env } = loadEnv();
    const cont = env.document.querySelector('.w-embeddable-photo__image-container');
    assert.ok(cont, 'fixture 必須有 image-container');
    assert.ok(cont.matches('[class*="placeholder" i]'),
      'o-placeholder 容器必須命中 [class*="placeholder" i]（::before 中和與 svg 隱藏都靠此）');
    const svg = cont.querySelector(':scope > svg');
    assert.ok(svg, 'fixture 必須有 placeholder 容器的 direct child svg spinner');
    assert.ok(svg.matches('[class*="placeholder" i] > svg'),
      'spinner svg 必須命中 [class*="placeholder" i] > svg 隱藏規則');
  });

  it('既有 object-fit/ratio ::before 中和不退步', () => {
    const { css } = loadEnv();
    for (const cls of ['object-fit', 'ratio']) {
      assert.ok(
        new RegExp(`\\[class\\*="${cls}"( i)?\\]::before`).test(css),
        `CSS 必須仍含 [class*="${cls}"]::before（既有行為延續）`
      );
    }
  });
});
